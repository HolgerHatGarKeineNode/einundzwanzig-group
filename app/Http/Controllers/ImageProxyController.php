<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;
use Intervention\Image\Drivers\Gd\Driver;
use Intervention\Image\Encoders\WebpEncoder;
use Intervention\Image\ImageManager;
use Symfony\Component\HttpFoundation\Response;

/**
 * Bild-Proxy (PLAN4 IMG): lädt ein remote Nostr-Bild (Avatar, Raum-`picture`,
 * Space-`icon`), schneidet auf ein festes Preset zu und liefert WebP — gecacht
 * auf Platte. `src` ist untrusted → SSRF-Schutz ist Pflicht (nur https,
 * öffentliche Ziel-IPs, Content-Type image/*, Größen-/Zeit-Limit).
 */
class ImageProxyController extends Controller
{
    /**
     * Feste Zuschnitte (begrenzt die Cache-Kardinalität — kein beliebiges w/h).
     * Neues Preset = eine Zeile. Retina-96px deckt alle heutigen Avatar-Größen ab.
     *
     * @var array<string, array{w:int, h:int}>
     */
    private const PRESETS = [
        'avatar' => ['w' => 96, 'h' => 96],
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
        if (! $this->isSafeUrl($src)) {
            abort(400);
        }

        $etag = '"'.sha1($preset.'|'.$src).'"';
        if ($request->headers->get('If-None-Match') === $etag) {
            return response('', 304);
        }

        $disk = Storage::disk('local');
        $cacheKey = 'img-cache/'.$preset.'/'.sha1($src).'.webp';

        if (! $disk->exists($cacheKey)) {
            $webp = $this->fetchAndEncode($src, $spec);
            if ($webp === null) {
                abort(502);
            }
            $disk->put($cacheKey, $webp);
        }

        return response($disk->get($cacheKey), 200, [
            'Content-Type' => 'image/webp',
            'Cache-Control' => 'public, max-age=31536000, immutable',
            'ETag' => $etag,
        ]);
    }

    /**
     * @param  array{w:int, h:int}  $spec
     */
    private function fetchAndEncode(string $url, array $spec): ?string
    {
        try {
            $response = Http::timeout(self::FETCH_TIMEOUT)
                ->connectTimeout(self::FETCH_TIMEOUT)
                ->withHeaders(['Accept' => 'image/*'])
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
            if (! str_starts_with(strtolower($response->header('Content-Type')), 'image/')) {
                return null;
            }
            $data = $response->body();
            if ($data === '' || strlen($data) > self::MAX_BYTES) {
                return null;
            }

            $image = (new ImageManager(new Driver))->decode($data)->cover($spec['w'], $spec['h']);

            return (string) $image->encode(new WebpEncoder(quality: 80));
        } catch (\Throwable) {
            return null;
        }
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
