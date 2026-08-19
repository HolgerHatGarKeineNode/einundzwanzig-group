<?php

namespace App\Http\Controllers;

use GuzzleHttp\Psr7\Uri;
use Illuminate\Contracts\Filesystem\Filesystem;
use Illuminate\Http\Request;
use Illuminate\Support\Arr;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Process;
use Illuminate\Support\Facades\Storage;
use Intervention\Image\Drivers\Gd\Driver;
use Intervention\Image\Encoders\WebpEncoder;
use Intervention\Image\ImageManager;
use Psr\Http\Message\RequestInterface;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\UriInterface;
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
        'banner' => ['w' => 1200, 'h' => 400, 'fit' => 'cover'],
        'og' => ['w' => 1200, 'h' => 630, 'fit' => 'cover'],
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

        // ── DER MEDIEN-RIEGEL — bewusst VOR ETag, Cache-Lookup und SSRF-Prüfung ──
        //
        // Er steht hier oben und nicht beim Fetch, weil ein Cache-Hit sonst an ihm
        // vorbeiliefe: eine geschützte URL, die vor der Einführung dieses Riegels
        // (oder über einen künftigen Umweg) einmal auf Platte gelandet ist, würde
        // weiter ausgeliefert. Der Riegel kostet nichts, was den heißen Pfad
        // interessieren müsste — ein Host-Vergleich, kein DNS (anders als
        // `isSafeUrl`, das genau deshalb weiter unten steht).
        //
        // WARUM ES DIESEN RIEGEL GIBT — bitte vor dem „pragmatischen" Öffnen lesen:
        //
        // Der Workspace-Relay liefert seine Medien NUR gegen ein signiertes
        // Blossom-Event aus (kind 24242, BUD-11; blank gemessen 401, signiert 200).
        // Diese Signatur ist an die MITGLIEDSCHAFT des Nutzers gebunden — sie IST
        // die Zugriffskontrolle des Relays. Ein serverseitiger Proxy hat keinen
        // Nutzerschlüssel; „reparieren" ließe sich das nur, indem der SERVER das
        // Blossom-Event signiert. Genau dann ist dieser Endpunkt — der bewusst ohne
        // Session, Cookie und CSRF läuft (`routes/img.php`) — ein öffentliches
        // Orakel für relay-private Medien: wer eine Blob-URL kennt, bekommt sie,
        // ohne Mitglied zu sein, und die mitgliedschaftsgebundene ACL des Relays ist
        // aufgehoben. Der Fehler wäre unsichtbar, weil dabei nichts kaputtgeht —
        // es fingen nur plötzlich Bilder an zu funktionieren.
        //
        // Die Client-Wache (`js/mediaGuard.ts`) schützt nur den Client. An ihr vorbei
        // kommen: gecachtes altes Markup, ein Cache-Warmer, ein Share-Sheet,
        // SSR/`og:image` — und schlicht jeder, der `/img/...?src=` von Hand aufruft.
        // Deshalb steht die Regel zweimal da, client- UND serverseitig; die
        // serverseitige ist die tragende.
        if ($this->isRelayHostedMedia($src)) {
            abort(403);
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
                return $this->accelOrBody("$base.$ext", $disk, $mime, $etag);
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

    /**
     * Cache-Hit ausliefern: wenn `IMG_PROXY_X_ACCEL_PREFIX` gesetzt ist, übergibt
     * PHP nur den Pfad an nginx (`X-Accel-Redirect`) und ist sofort wieder frei —
     * nginx schaufelt die Bytes per sendfile. Sonst (lokal, Tests, Mobile-Host
     * ohne nginx-internal-Location) wie bisher der Body aus PHP.
     *
     * Der Prefix muss in nginx eine `internal;`-Location auf das Cache-Verzeichnis
     * sein; ohne sie liefert nginx 404 — darum ist das Feature opt-in per env.
     */
    private function accelOrBody(string $path, Filesystem $disk, string $mime, string $etag): Response
    {
        $prefix = rtrim((string) config('image-proxy.x_accel_prefix'), '/');

        if ($prefix === '') {
            return $this->respond($disk->get($path), $mime, $etag);
        }

        return response('', 200, [
            'Content-Type' => $mime,
            'Cache-Control' => 'public, max-age=31536000, immutable',
            'ETag' => $etag,
            'X-Accel-Redirect' => $prefix.'/'.$path,
        ]);
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
                ->withOptions($this->fetchOptions())
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
     * Guzzle-Optionen des ausgehenden Fetches.
     *
     * Eigene Methode, weil `on_redirect` die zweite Hälfte des Medien-Riegels trägt
     * und sonst nicht prüfbar wäre: `Http::fake()` schiebt seinen Stub-Handler GANZ
     * nach außen und kurzschließt damit vor Guzzles Redirect-Middleware — im Test
     * wird also nie einer Weiterleitung gefolgt. So lässt sich wenigstens exakt die
     * Closure aufrufen, die Guzzle im Ernstfall aufruft (statt sie nachzubauen).
     *
     * @return array<string, mixed>
     */
    private function fetchOptions(): array
    {
        return [
            'curl' => [CURLOPT_MAXFILESIZE => self::MAX_BYTES],
            'allow_redirects' => [
                'max' => 3,
                'strict' => true,
                'referer' => false,
                'protocols' => ['https'],
                'on_redirect' => function (RequestInterface $request, ResponseInterface $response, UriInterface $uri): void {
                    // Der geschützte Medien-Host zuerst — Host-Vergleich, kein DNS.
                    // Ohne diese Prüfung spazierte ein ERLAUBTER Host, der dorthin
                    // umleitet, an der Host-Prüfung in `__invoke` vorbei: die sieht
                    // nur die URL, die der Aufrufer hineingereicht hat, nie das Ziel
                    // der Umleitung.
                    if ($this->isRelayHostedMedia((string) $uri)) {
                        throw new \RuntimeException('relay-hosted media redirect target');
                    }
                    // Und jeder Redirect-Zielhost muss wieder öffentlich sein.
                    if (! $this->isSafeHost($uri->getHost())) {
                        throw new \RuntimeException('unsafe redirect target');
                    }
                },
            ],
        ];
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

    /**
     * Liegt dieses Medium auf einem Relay, dessen Medien auth-pflichtig sind?
     * (Die Begründung, warum der Server sie nie holen darf, steht in `__invoke`.)
     *
     * ── Warum die Menge der geschützten Hosts NICHT hier im Code steht ──
     *
     * Eine hartkodierte Liste („buzz.einundzwanzig.space") wäre eine Denylist mit
     * genau der Fehlerklasse, die dieses Projekt schon einmal getroffen hat: ein
     * zweiter Workspace/Tenant käme still UNGESCHÜTZT dazu, weil niemand die zweite
     * Stelle mitpflegt. Deshalb ist die Menge abgeleitet: geschützt ist, was in
     * `group.workspace_url` steht — dieselbe Konfiguration, die `partials/head.blade.php`
     * als `window.__nostrWorkspace` an die Client-Wache (`js/mediaGuard.ts`) gibt.
     * EINE Quelle für beide Wachen; sie können nicht auseinanderlaufen. Ein weiterer
     * Tenant wird geschützt, indem der Schlüssel eine Liste wird (`Arr::wrap`) —
     * ohne zweite Code-Änderung.
     *
     * Eine echte Allowlist auf der ANDEREN Achse (nur bestimmte Quell-Hosts dürfen
     * geholt werden) ist hier bewusst nicht möglich: der Proxy existiert, um beliebige
     * Nostr-Medien zu holen (nostr.build, imgur, jeder Blossom-Server). Eine
     * Host-Allowlist dort wäre gleichbedeutend mit „Funktion aus".
     */
    private function isRelayHostedMedia(string $url): bool
    {
        $host = self::hostOf($url);
        if ($host === '') {
            return false;
        }

        foreach (Arr::wrap(config('group.workspace_url')) as $relay) {
            if (! is_string($relay) || trim($relay) === '') {
                // Nicht konfiguriert — legitim inert (einzelne Instanz ohne Workspace).
                continue;
            }

            $relayHost = self::hostOf($relay);

            // F1: „nicht konfiguriert" und „falsch konfiguriert" sind NICHT dasselbe.
            // Der Client normalisiert großzügiger als wir: welshmans `normalizeRelayUrl`
            // setzt bei fehlendem Schema `wss://` davor, `new Uri('host.tld')` liest
            // denselben String als PFAD und liefert einen leeren Host. Eine schemalose
            // Konfiguration lässt damit den Client vollständig korrekt laufen — Workspace-
            // Tab da, Client-Wache aktiv, kein Test rot — und legt AUSGERECHNET die
            // serverseitige, tragende Hälfte still. Ein Kontrollmechanismus, der lautlos
            // verschwindet, ist keiner: deshalb laut werden, statt durchzufallen.
            if ($relayHost === '') {
                Log::warning('group.workspace_url: kein Host ableitbar — der serverseitige Medien-Riegel ist für diesen Eintrag WIRKUNGSLOS. Schema angeben (wss://host.tld).', [
                    'eintrag' => $relay,
                ]);

                continue;
            }

            if ($relayHost === $host) {
                return true;
            }
        }

        return false;
    }

    /**
     * Der vergleichbare Host einer URL — leer, wenn sich keiner bestimmen lässt.
     *
     * **Geparst wird mit demselben Parser, der später auch holt** (`GuzzleHttp\Psr7\Uri`,
     * über den `Http`-Client). Das ist der Kern der Sache: ein handgeschriebener
     * Normalisierer oder ein `parse_url` daneben wäre eine ZWEITE Meinung darüber,
     * welcher Host gemeint ist — und jede Abweichung zwischen Wache und Holer ist ein
     * Bypass. Gemessen: `parse_url(' https://host/x')` findet gar keinen Host, Guzzle
     * findet `host` und würde ihn kontaktieren. Wer hier `parse_url` nimmt, baut die
     * Lücke ein.
     *
     * Guzzle liefert den Host bereits ohne `userinfo@`, ohne Port und ASCII-kleingeschrieben;
     * hier kommen die zwei Dinge dazu, die es nicht tut: der abschließende Punkt der
     * absoluten DNS-Form (`host.` == `host`) und die Unicode-Form eines IDN
     * (`bÜzz.example` → `xn--bzz-hoa.example`), damit beide Schreibweisen desselben
     * Namens denselben Vergleichswert ergeben. Ohne `ext-intl` bleibt nur das
     * Kleinschreiben — dann ist der IDN-Fall unentschieden, nicht falsch positiv.
     *
     * Verglichen wird der HOST, nicht der Origin (so wie clientseitig in
     * `isSpaceHostedMedia`). Das ist hier absichtlich strenger: ein anderer Port oder
     * `http://` auf demselben Host ist derselbe Relay und darf kein Schlupfloch sein.
     */
    private static function hostOf(string $url): string
    {
        try {
            $host = (new Uri($url))->getHost();
        } catch (\Throwable) {
            // Unparsebar → kein Host. Gefahrlos: derselbe Parser holt später, ein
            // String, den er nicht versteht, erreicht den geschützten Relay nie.
            return '';
        }

        // F2: Guzzles `Uri` BEWAHRT Prozent-Escapes im Host, curl dekodiert sie vor
        // der Namensauflösung — `https://%62uzz.example/` wird als `buzz.example`
        // kontaktiert, verglichen würde aber `%62uzz.example`. Genau die Divergenz
        // zwischen Wache und Holer, die dieser Riegel ausschließen soll. Dekodieren
        // macht die Wache strenger, nie lockerer.
        //
        // Heute fängt `isSafeHost` diesen Fall mit ab (PHPs Resolver dekodiert NICHT,
        // findet also nichts) — aber das ist ein Nachbar, der für SSRF gebaut ist und
        // dessen Platz im Ablauf ausdrücklich verschiebbar ist. Der Riegel darf sich
        // nicht darauf stützen.
        $host = rawurldecode($host);

        $host = rtrim($host, '.');
        if ($host === '') {
            return '';
        }

        $ascii = function_exists('idn_to_ascii')
            ? idn_to_ascii($host, IDNA_NONTRANSITIONAL_TO_ASCII, INTL_IDNA_VARIANT_UTS46)
            : false;

        return mb_strtolower(is_string($ascii) ? $ascii : $host, 'UTF-8');
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
