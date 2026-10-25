<?php

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;

function fakePng(): string
{
    $img = imagecreatetruecolor(20, 20);
    ob_start();
    imagepng($img);

    return (string) ob_get_clean();
}

beforeEach(function () {
    Storage::fake('local');
});

it('rejects an unknown preset', function () {
    $this->get('/img/nope?src='.urlencode('https://1.1.1.1/a.png'))->assertNotFound();
});

it('rejects non-https src', function () {
    $this->get('/img/avatar?src='.urlencode('http://1.1.1.1/a.png'))->assertStatus(400);
});

it('rejects a private-ip src (SSRF)', function () {
    $this->get('/img/avatar?src='.urlencode('https://127.0.0.1/a.png'))->assertStatus(400);
    $this->get('/img/avatar?src='.urlencode('https://192.168.1.10/a.png'))->assertStatus(400);
});

it('proxies a public image to webp and caches it', function () {
    Http::fake(['*' => Http::response(fakePng(), 200, ['Content-Type' => 'image/png'])]);

    $src = 'https://1.1.1.1/avatar.png';
    $response = $this->get('/img/avatar?src='.urlencode($src));

    $response->assertOk()->assertHeader('Content-Type', 'image/webp');
    Storage::disk('local')->assertExists('img-cache/avatar/'.sha1($src).'.webp');

    // Zweiter Request → Cache-Hit, kein weiterer Fetch.
    $this->get('/img/avatar?src='.urlencode($src))->assertOk();
    Http::assertSentCount(1);
});

it('sends a real user-agent (hosts like wikimedia 403 generic ones)', function () {
    Http::fake(['*' => Http::response(fakePng(), 200, ['Content-Type' => 'image/png'])]);

    $this->get('/img/avatar?src='.urlencode('https://1.1.1.1/a.png'));

    Http::assertSent(fn ($request) => str_contains($request->header('User-Agent')[0] ?? '', 'EinundzwanzigImgProxy'));
});

it('proxies content presets (banner/msg/full) to webp', function () {
    Http::fake(['*' => Http::response(fakePng(), 200, ['Content-Type' => 'image/png'])]);

    foreach (['banner', 'msg', 'full'] as $preset) {
        $this->get('/img/'.$preset.'?src='.urlencode('https://1.1.1.1/pic.png'))
            ->assertOk()
            ->assertHeader('Content-Type', 'image/webp');
    }
});

it('crops the avatar presets to their square size', function (string $preset, int $size) {
    Http::fake(['*' => Http::response(fakePng(), 200, ['Content-Type' => 'image/png'])]);

    $response = $this->get('/img/'.$preset.'?src='.urlencode('https://1.1.1.1/face.png'));

    $response->assertOk()->assertHeader('Content-Type', 'image/webp');
    [$width, $height] = getimagesizefromstring((string) $response->getContent()) ?: [0, 0];
    expect([$width, $height])->toBe([$size, $size]);
})->with([
    'avatar' => ['avatar', 96],
    'avatar-lg' => ['avatar-lg', 192],
]);

it('keeps a gif as gif (animation), not webp', function () {
    $img = imagecreatetruecolor(20, 20);
    ob_start();
    imagegif($img);
    $gif = (string) ob_get_clean();

    Http::fake(['*' => Http::response($gif, 200, ['Content-Type' => 'image/gif'])]);

    $src = 'https://1.1.1.1/anim.gif';
    $response = $this->get('/img/msg?src='.urlencode($src));

    $response->assertOk()->assertHeader('Content-Type', 'image/gif');
    // getContent() ist laut Symfony-Signatur string|false; false träte nur bei
    // einer ungepufferten StreamedResponse auf, die es hier nicht gibt.
    $content = $response->getContent();
    if (! is_string($content)) {
        throw new RuntimeException('getContent() returned false unexpectedly.');
    }
    expect(str_starts_with($content, 'GIF8'))->toBeTrue();
    Storage::disk('local')->assertExists('img-cache/msg/'.sha1($src).'.gif');
});

it('serves a cache hit without the SSRF/DNS check (hot path stays fast)', function () {
    // Vorgecachte Datei direkt ablegen; kein Http-Fake → beweist: kein Fetch/DNS.
    $src = 'https://1.1.1.1/cached.png';
    Storage::disk('local')->put('img-cache/avatar/'.sha1($src).'.webp', 'RIFFfake');

    $this->get('/img/avatar?src='.urlencode($src))
        ->assertOk()
        ->assertHeader('Content-Type', 'image/webp');
});

it('returns 304 on matching ETag', function () {
    Http::fake(['*' => Http::response(fakePng(), 200, ['Content-Type' => 'image/png'])]);

    $src = 'https://1.1.1.1/avatar.png';
    $etag = $this->get('/img/avatar?src='.urlencode($src))->headers->get('ETag');

    $this->get('/img/avatar?src='.urlencode($src), ['If-None-Match' => $etag])
        ->assertStatus(304);
});

it('rejects non-image bytes (magic-byte sniff, not content-type)', function () {
    Http::fake(['*' => Http::response('<html>not an image</html>', 200, ['Content-Type' => 'image/png'])]);

    $this->get('/img/avatar?src='.urlencode('https://1.1.1.1/a.png'))->assertStatus(502);
});

it('accepts image bytes served as application/octet-stream (Blossom)', function () {
    Http::fake(['*' => Http::response(fakePng(), 200, ['Content-Type' => 'application/octet-stream'])]);

    $this->get('/img/avatar?src='.urlencode('https://1.1.1.1/blossom.png'))
        ->assertOk()
        ->assertHeader('Content-Type', 'image/webp');
});

it('carries no session cookie (route runs outside the web middleware group)', function () {
    Http::fake(['*' => Http::response(fakePng(), 200, ['Content-Type' => 'image/png'])]);

    $response = $this->get('/img/avatar?src='.urlencode('https://1.1.1.1/nocookie.png'));

    // Eine Session-Zeile pro Bild serialisiert auf SQLite alle parallelen
    // Requests — der Endpunkt ist zustandslos und darf keine Session anfassen.
    expect($response->headers->getCookies())->toBeEmpty();
});

it('hands cache hits to nginx via X-Accel-Redirect when configured', function () {
    config()->set('image-proxy.x_accel_prefix', '/img-cache-internal');
    Http::fake(['*' => Http::response(fakePng(), 200, ['Content-Type' => 'image/png'])]);

    $src = 'https://1.1.1.1/accel.png';
    $this->get('/img/avatar?src='.urlencode($src))->assertOk();

    $hit = $this->get('/img/avatar?src='.urlencode($src));

    $hit->assertOk()
        ->assertHeader('Content-Type', 'image/webp')
        ->assertHeader('X-Accel-Redirect', '/img-cache-internal/img-cache/avatar/'.sha1($src).'.webp');
    expect($hit->getContent())->toBe('');
});

it('serves the body itself when no X-Accel prefix is configured', function () {
    Http::fake(['*' => Http::response(fakePng(), 200, ['Content-Type' => 'image/png'])]);

    $src = 'https://1.1.1.1/nobody.png';
    $this->get('/img/avatar?src='.urlencode($src))->assertOk();

    $hit = $this->get('/img/avatar?src='.urlencode($src));

    $hit->assertOk()->assertHeaderMissing('X-Accel-Redirect');
    expect($hit->getContent())->not->toBe('');
});

/*
 * Every refusal must be consumable by a cross-origin <img>: Chromium's Opaque Response
 * Blocking drops a `text/html` error page with `net::ERR_BLOCKED_BY_ORB` (measured on the
 * companion app, origin 127.0.0.1). The body stays empty so `onerror` still fires and the
 * client falls back to its initials.
 */
it('answers every refusal with an empty image-typed body, never an HTML page', function (string $preset, string $src, int $status, ?string $upstreamBody, ?string $upstreamType) {
    config()->set('group.workspace_url', 'wss://workspace.example/');
    if ($upstreamBody !== null) {
        Http::fake(['*' => Http::response($upstreamBody, $upstreamBody === '' ? 404 : 200, ['Content-Type' => (string) $upstreamType])]);
    }

    $response = $this->get('/img/'.$preset.'?src='.urlencode($src));

    $response->assertStatus($status)
        ->assertHeader('Content-Type', 'image/webp')
        ->assertHeader('X-Content-Type-Options', 'nosniff');
    expect($response->getContent())->toBe('');
})->with([
    'unknown preset' => ['nope', 'https://1.1.1.1/a.png', 404, null, null],
    'empty src' => ['avatar', '', 400, null, null],
    'http src' => ['avatar', 'http://1.1.1.1/a.png', 400, null, null],
    'private host' => ['avatar', 'https://127.0.0.1/a.png', 400, null, null],
    'relay-hosted media' => ['avatar', 'https://workspace.example/media/a.jpg', 403, null, null],
    'upstream 404' => ['avatar', 'https://1.1.1.1/gone.png', 502, '', 'text/html'],
    'upstream html' => ['avatar', 'https://1.1.1.1/page.png', 502, '<html>nope</html>', 'text/html'],
    // An SVG stays blocked (script-capable, no magic bytes in the allowlist) — and its
    // markup must not be echoed back through our origin either.
    'upstream svg' => ['avatar', 'https://1.1.1.1/logo.svg', 502, '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', 'image/svg+xml'],
]);

it('lets the browser cache an upstream failure briefly and a policy rejection longer', function () {
    Http::fake(['*' => Http::response('', 404)]);

    expect($this->get('/img/avatar?src='.urlencode('https://1.1.1.1/gone.png'))->headers->get('Cache-Control'))
        ->toContain('max-age=600');
    expect($this->get('/img/avatar?src='.urlencode('http://1.1.1.1/a.png'))->headers->get('Cache-Control'))
        ->toContain('max-age=86400');
});
