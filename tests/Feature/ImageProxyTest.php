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

it('returns 304 on matching ETag', function () {
    Http::fake(['*' => Http::response(fakePng(), 200, ['Content-Type' => 'image/png'])]);

    $src = 'https://1.1.1.1/avatar.png';
    $etag = $this->get('/img/avatar?src='.urlencode($src))->headers->get('ETag');

    $this->get('/img/avatar?src='.urlencode($src), ['If-None-Match' => $etag])
        ->assertStatus(304);
});

it('rejects a non-image content-type', function () {
    Http::fake(['*' => Http::response('<html>', 200, ['Content-Type' => 'text/html'])]);

    $this->get('/img/avatar?src='.urlencode('https://1.1.1.1/a.png'))->assertStatus(502);
});
