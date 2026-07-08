<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Process;
use Illuminate\Support\Facades\Storage;
use Intervention\Image\Drivers\Gd\Driver;
use Intervention\Image\Encoders\WebpEncoder;
use Intervention\Image\ImageManager;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Process\ExecutableFinder;

/**
 * Bild-Proxy (PLAN4 IMG): lädt ein remote Nostr-Bild (Avatar, Raum-`picture`,
 * Space-`icon`), schneidet auf ein festes Preset zu und liefert WebP — gecacht
 * auf Platte. `src` ist untrusted → SSRF-Schutz ist Pflicht (nur https,
 * öffentliche Ziel-IPs, Bildformat per Magic-Bytes, Größen-/Zeit-Limit).
 */
class ImageProxyController extends Controller
{
    /**
     * Feste Zuschnitte (begrenzt die Cache-Kardinalität — kein beliebiges w/h).
     * Neues Preset = eine Zeile. `cover` = quadratischer Zuschnitt (Avatare);
     * `scale` = proportional in die Box verkleinert (Inhaltsbilder, nie hoch).
     *
     * @var array<string, array{w:int, h:int, fit:string}>
     */
    private const PRESETS = [
        'avatar' => ['w' => 96, 'h' => 96, 'fit' => 'cover'],
        'msg' => ['w' => 600, 'h' => 600, 'fit' => 'scale'],
        'full' => ['w' => 1600, 'h' => 1600, 'fit' => 'scale'],
    ];

    private const MAX_BYTES = 8 * 1024 * 1024;

    private const FETCH_TIMEOUT = 6;

    public function __invoke(Request $request, string $preset): Response
    {
        $spec = self::PRESETS[$preset] ?? null;
        if ($spec === null) {
            abort(404);
        }

        $src = (string) $request->query('src', '');
        if ($src === '') {
            abort(400);
        }

        $etag = '"'.sha1($preset.'|'.$src).'"';
        if ($request->headers->get('If-None-Match') === $etag) {
            return response('', 304);
        }

        $disk = Storage::disk('local');
        $base = 'img-cache/'.$preset.'/'.sha1($src);

        // GIFs bleiben GIF (Animation), sonst WebP — die Extension steht erst nach
        // dem Encode fest, darum beide Cache-Varianten prüfen (Hit ohne Fetch).
        // WICHTIG: der SSRF-Check (DNS-Lookups) läuft NUR beim Miss — sonst würden
        // 2 synchrone `dns_get_record` jeden Cache-Hit um hunderte ms verzögern.
        foreach (['webp' => 'image/webp', 'gif' => 'image/gif'] as $ext => $mime) {
            if ($disk->exists("$base.$ext")) {
                return $this->respond($disk->get("$base.$ext"), $mime, $etag);
            }
        }

        // Cache-Miss → erst jetzt (vor dem ausgehenden Fetch) SSRF prüfen.
        if (! $this->isSafeUrl($src)) {
            abort(400);
        }

        $encoded = $this->fetchAndEncode($src, $spec);
        if ($encoded === null) {
            abort(502);
        }
        [$bytes, $mime] = $encoded;
        $disk->put($base.($mime === 'image/gif' ? '.gif' : '.webp'), $bytes);

        return $this->respond($bytes, $mime, $etag);
    }

    private function respond(string $body, string $mime, string $etag): Response
    {
        return response($body, 200, [
            'Content-Type' => $mime,
            'Cache-Control' => 'public, max-age=31536000, immutable',
            'ETag' => $etag,
        ]);
    }

    /**
     * Bild an den Magic-Bytes erkennen (formatbasiert, header-unabhängig) — deckt
     * PNG/JPEG/GIF/BMP/WebP/AVIF|HEIF ab. Nötig, weil Blossom & Co. Bilder auch als
     * `application/octet-stream` ausliefern. Endgültiger Filter bleibt der Decode.
     */
    private static function isImageData(string $data): bool
    {
        return str_starts_with($data, "\x89PNG")
            || str_starts_with($data, "\xFF\xD8\xFF")
            || str_starts_with($data, 'GIF8')
            || str_starts_with($data, 'BM')
            || (str_starts_with($data, 'RIFF') && substr($data, 8, 4) === 'WEBP')
            || (substr($data, 4, 4) === 'ftyp' && in_array(substr($data, 8, 4), ['avif', 'avis', 'heic', 'heix', 'mif1'], true));
    }

    /**
     * @param  array{w:int, h:int, fit:string}  $spec
     * @return array{0:string, 1:string}|null [Bytes, MIME]
     */
    private function fetchAndEncode(string $url, array $spec): ?array
    {
        try {
            $response = Http::timeout(self::FETCH_TIMEOUT)
                ->connectTimeout(self::FETCH_TIMEOUT)
                // Echter UA + Kontakt: manche Hosts (z.B. Wikimedia) 403en generische
                // Agents wie „GuzzleHttp/7". Mozilla-Prefix + Kontakt-URL passt deren Policy.
                ->withHeaders([
                    'Accept' => 'image/*',
                    'User-Agent' => 'Mozilla/5.0 (compatible; EinundzwanzigImgProxy/1.0; +https://group.einundzwanzig.space)',
                ])
                ->withOptions([
                    'curl' => [CURLOPT_MAXFILESIZE => self::MAX_BYTES],
                    'allow_redirects' => [
                        'max' => 3,
                        'strict' => true,
                        'referer' => false,
                        'protocols' => ['https'],
                        // Jeder Redirect-Zielhost muss wieder öffentlich sein.
                        'on_redirect' => function ($request, $response, $uri): void {
                            if (! $this->isSafeHost($uri->getHost())) {
                                throw new \RuntimeException('unsafe redirect target');
                            }
                        },
                    ],
                ])
                ->get($url);

            if (! $response->successful()) {
                return null;
            }
            $data = $response->body();
            if ($data === '' || strlen($data) > self::MAX_BYTES) {
                return null;
            }

            if (! self::isImageData($data)) {
                return null;
            }

            // GIF (Magic-Bytes) → animiert lassen, nur optimieren. Sonst WebP.
            if (str_starts_with($data, 'GIF8')) {
                return [$this->optimizeGif($data, $spec), 'image/gif'];
            }

            $image = (new ImageManager(new Driver))->decode($data);
            $image = $spec['fit'] === 'cover'
                ? $image->cover($spec['w'], $spec['h'])
                : $image->scaleDown($spec['w'], $spec['h']);

            return [(string) $image->encode(new WebpEncoder(quality: 80)), 'image/webp'];
        } catch (\Throwable) {
            return null;
        }
    }

    /**
     * Animierte GIFs mit `gifsicle` verlustbehaftet optimieren + auf die Preset-Box
     * verkleinern (Animation bleibt erhalten). `-O3` = maximale Optimierung,
     * `--lossy=80` = aggressive LZW-Kompression (aus der Praxis der beste Trade-off),
     * `--resize-fit` skaliert nur herunter. Ohne gifsicle oder bei Fehler: Original
     * durchreichen (animiert, unkomprimiert) — nie schlechter als vorher.
     *
     * ponytail: Preset-Level `--lossy=80` fix; falls Qualität leidet, runter (30–60).
     *
     * @param  array{w:int, h:int, fit:string}  $spec
     */
    private function optimizeGif(string $data, array $spec): string
    {
        $gifsicle = $this->gifsiclePath();
        if ($gifsicle === null) {
            return $data;
        }

        try {
            $result = Process::timeout(self::FETCH_TIMEOUT)
                ->input($data)
                ->run([$gifsicle, '-O3', '--lossy=80', '--resize-fit', $spec['w'].'x'.$spec['h'], '--no-warnings']);

            $out = $result->output();
            if ($result->successful() && str_starts_with($out, 'GIF8')) {
                return $out;
            }
        } catch (\Throwable) {
            // proc_open/Timeout/… → Original durchreichen (animiert), nie 502.
        }

        return $data;
    }

    /**
     * gifsicle-Pfad: absolute Kandidaten zuerst — unter PHP-FPM ist `env[PATH]` oft
     * leer (Forge kommentiert es aus), dann findet `ExecutableFinder` nichts.
     */
    private function gifsiclePath(): ?string
    {
        foreach (['/usr/bin/gifsicle', '/usr/local/bin/gifsicle'] as $path) {
            if (is_executable($path)) {
                return $path;
            }
        }

        return (new ExecutableFinder)->find('gifsicle');
    }

    private function isSafeUrl(string $url): bool
    {
        $parts = parse_url($url);
        if (($parts['scheme'] ?? '') !== 'https' || empty($parts['host'])) {
            return false;
        }

        return $this->isSafeHost($parts['host']);
    }

    /**
     * Host ist sicher, wenn ALLE aufgelösten IPs öffentlich sind (privat/loopback/
     * link-local/reserved geblockt). Auflösung leer → fail-closed.
     *
     * ponytail: Rest-Risiko DNS-Rebinding (Host löst beim Check öffentlich, beim
     * Connect privat auf) bleibt — Upgrade: IP pinnen (CURLOPT_RESOLVE) statt
     * folgen. Für einen Nischen-Bild-Proxy akzeptiert.
     */
    private function isSafeHost(string $host): bool
    {
        $ips = filter_var($host, FILTER_VALIDATE_IP)
            ? [$host]
            : array_merge(
                array_column(@dns_get_record($host, DNS_A) ?: [], 'ip'),
                array_column(@dns_get_record($host, DNS_AAAA) ?: [], 'ipv6'),
            );

        if ($ips === []) {
            return false;
        }

        foreach ($ips as $ip) {
            if (! filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE)) {
                return false;
            }
        }

        return true;
    }
}
