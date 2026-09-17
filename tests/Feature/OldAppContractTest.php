<?php

declare(strict_types=1);

use Illuminate\Http\Client\Request as ClientRequest;
use Illuminate\Routing\Route as RoutingRoute;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Facades\Storage;

/*
|--------------------------------------------------------------------------
| Old-app contract (R4)
|--------------------------------------------------------------------------
|
| App builds already shipped through Zapstore call this server and cannot be
| updated from here. Their whole server surface is `/nostr/profiles`,
| `/img/{preset}` and `/api/app/verein/*`. This file pins paths, methods,
| middleware and the basic response shapes of exactly that surface, without
| network, so a later refactor fails HERE instead of on a user's phone.
|
| Changing an expectation below means breaking installed apps. Add, do not
| rename or remove.
|
*/

const OLD_APP_VEREIN_BASE = 'https://verein.test';

function contractRoute(string $uri): RoutingRoute
{
    $route = collect(Route::getRoutes()->getRoutes())->first(fn (RoutingRoute $r): bool => $r->uri() === $uri);

    expect($route)->not->toBeNull("route [$uri] is part of the old-app contract");

    return $route;
}

it('keeps every contract route with its methods and middleware', function (string $uri, array $methods, array $middleware) {
    $route = contractRoute($uri);

    expect($route->methods())->toEqualCanonicalizing($methods)
        ->and($route->gatherMiddleware())->toEqualCanonicalizing($middleware);
})->with([
    'profiles' => ['nostr/profiles', ['GET', 'HEAD'], ['web']],
    'image proxy' => ['img/{preset}', ['GET', 'HEAD'], []],
    'verein config' => ['api/app/verein/config', ['GET', 'HEAD'], ['api', 'throttle:verein-app-proxy']],
    'verein applications' => ['api/app/verein/applications', ['POST'], ['api', 'throttle:verein-app-proxy']],
    'verein invoice' => ['api/app/verein/payments/{year}/invoice', ['POST'], ['api', 'throttle:verein-app-proxy']],
    'verein me' => ['api/app/verein/me', ['GET', 'HEAD'], ['api', 'throttle:verein-app-read']],
    'verein payments' => ['api/app/verein/payments', ['GET', 'HEAD'], ['api', 'throttle:verein-app-read']],
]);

it('has no /api/app/verein route outside the contract', function () {
    $uris = collect(Route::getRoutes()->getRoutes())
        ->map(fn (RoutingRoute $r): string => $r->uri())
        ->filter(fn (string $uri): bool => str_starts_with($uri, 'api/app/verein'))
        ->sort()
        ->values()
        ->all();

    expect($uris)->toBe([
        'api/app/verein/applications',
        'api/app/verein/config',
        'api/app/verein/me',
        'api/app/verein/payments',
        'api/app/verein/payments/{year}/invoice',
    ]);
});

it('answers /nostr/profiles with an events list, public caching and open CORS', function () {
    Http::fake();

    $response = $this->getJson('/nostr/profiles?pubkeys=');

    $response->assertOk()
        ->assertExactJson(['events' => []])
        ->assertHeader('Access-Control-Allow-Origin', '*');

    expect($response->headers->get('Cache-Control'))->toContain('public')
        ->and($response->headers->get('Cache-Control'))->toContain('max-age=300');

    Http::assertNothingSent();
});

it('keeps the /img/{preset} error contract without touching the network', function (string $path, int $status) {
    Storage::fake('local');
    Http::fake();

    $response = $this->get($path);

    $response->assertStatus($status);
    // Session-free on purpose (routes/img.php): no cookie on any answer.
    expect($response->headers->getCookies())->toBe([]);

    Http::assertNothingSent();
})->with([
    'unknown preset' => ['/img/nope?src='.urlencode('https://1.1.1.1/a.png'), 404],
    'missing src' => ['/img/avatar', 400],
    'non-https src' => ['/img/avatar?src='.urlencode('http://1.1.1.1/a.png'), 400],
    'private-ip src' => ['/img/avatar?src='.urlencode('https://127.0.0.1/a.png'), 400],
]);

it('keeps the image presets the app requests', function (string $preset) {
    Storage::fake('local');
    Http::fake();

    // A known preset gets past the 404; the private IP stops it before any fetch.
    $this->get('/img/'.$preset.'?src='.urlencode('https://127.0.0.1/a.png'))->assertStatus(400);

    Http::assertNothingSent();
})->with(['avatar', 'banner', 'og', 'msg', 'full']);

it('answers every /api/app/verein route with JSON 503 and no network when unconfigured', function (string $method, string $uri) {
    Http::fake();
    config(['verein.base_url' => '', 'verein.api_key' => '']);

    $this->json($method, $uri, $method === 'POST' ? ['pubkey' => str_repeat('a', 64)] : [])
        ->assertStatus(503)
        ->assertJsonStructure(['message']);

    Http::assertNothingSent();
})->with([
    ['GET', '/api/app/verein/config'],
    ['POST', '/api/app/verein/applications'],
    ['POST', '/api/app/verein/payments/2026/invoice'],
    ['GET', '/api/app/verein/me'],
    ['GET', '/api/app/verein/payments'],
]);

it('passes the Verein answer of the shipped routes through as JSON with its status', function (string $method, string $uri, string $target) {
    config(['verein.base_url' => OLD_APP_VEREIN_BASE, 'verein.api_key' => 'OLD-APP-CONTRACT-TESTKEY']);
    Http::fake([OLD_APP_VEREIN_BASE.'/*' => Http::response(['shape' => 'kept'], 202)]);

    $this->json($method, $uri, $method === 'POST' ? ['pubkey' => str_repeat('a', 64)] : [])
        ->assertStatus(202)
        ->assertExactJson(['shape' => 'kept']);

    Http::assertSent(fn (ClientRequest $r): bool => $r->method() === $method && $r->url() === $target);
})->with([
    ['GET', '/api/app/verein/config', OLD_APP_VEREIN_BASE.'/api/v1/app/membership/config'],
    ['POST', '/api/app/verein/applications', OLD_APP_VEREIN_BASE.'/api/v1/app/membership/applications'],
    ['POST', '/api/app/verein/payments/2026/invoice', OLD_APP_VEREIN_BASE.'/api/v1/app/membership/payments/2026/invoice'],
]);

it('lets the app WebView origin through CORS on /api/app/verein', function () {
    $this->call('OPTIONS', '/api/app/verein/config', [], [], [], [
        'HTTP_ORIGIN' => 'http://127.0.0.1',
        'HTTP_ACCESS_CONTROL_REQUEST_METHOD' => 'POST',
        'HTTP_ACCESS_CONTROL_REQUEST_HEADERS' => 'content-type,authorization',
    ])->assertHeader('Access-Control-Allow-Origin', '*');
});
