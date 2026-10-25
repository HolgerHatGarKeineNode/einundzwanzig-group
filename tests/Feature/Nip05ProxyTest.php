<?php

use Einundzwanzig\Group\Nostr\Nip05Resolver;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\RateLimiter;

const NIP05_PUBKEY = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';

/**
 * Swap the resolver's DNS for a fixed table — no test may resolve a real name.
 *
 * @param  array<string, list<string>>  $table
 */
function nip05Dns(array $table): void
{
    app()->bind(Nip05Resolver::class, fn () => new Nip05Resolver(fn (string $host): array => $table[$host] ?? []));
}

/**
 * @param  list<string>  $handles
 */
function nip05Url(array $handles): string
{
    return '/nostr/nip05?'.http_build_query(['h' => $handles]);
}

beforeEach(function () {
    Cache::flush();
    config()->set('group.handle_proxy', true);
    nip05Dns(['primal.net' => ['93.184.216.34'], 'example.org' => ['93.184.216.35']]);
});

it('resolves a handle whose domain gets CORS wrong — the server does not care about CORS', function () {
    Http::fake(['https://primal.net/.well-known/nostr.json*' => Http::response(
        ['names' => ['alice' => NIP05_PUBKEY], 'relays' => [NIP05_PUBKEY => ['wss://relay.primal.net', 'javascript:alert(1)']]],
        200,
        ['Access-Control-Allow-Origin' => '*, *'],
    )]);

    $this->get(nip05Url(['alice@primal.net']))
        ->assertOk()
        ->assertExactJson(['data' => [[
            'handle' => 'alice@primal.net',
            'status' => 'found',
            'info' => ['pubkey' => NIP05_PUBKEY, 'relays' => ['wss://relay.primal.net']],
        ]]]);

    Http::assertSent(fn (Request $request): bool => $request->url() === 'https://primal.net/.well-known/nostr.json?name=alice');
});

it('looks the name up exactly, like welshman, and reports an unknown name as unknown', function () {
    Http::fake(['*' => Http::response(['names' => ['alice' => NIP05_PUBKEY]])]);

    $this->get(nip05Url(['Alice@primal.net']))
        ->assertOk()
        ->assertJsonPath('data.0.status', 'unknown')
        ->assertJsonPath('data.0.info', null);
});

it('treats a bare domain as the _ name', function () {
    Http::fake(['*' => Http::response(['names' => ['_' => NIP05_PUBKEY]])]);

    $this->get(nip05Url(['primal.net']))->assertJsonPath('data.0.info.pubkey', NIP05_PUBKEY);
    Http::assertSent(fn (Request $request): bool => str_ends_with($request->url(), 'name=_'));
});

it('never fetches a host that resolves to a private address, an IP literal or a port', function (string $handle) {
    nip05Dns(['intranet.example' => ['10.0.0.5'], 'mixed.example' => ['93.184.216.34', '127.0.0.1']]);
    Http::fake();

    $this->get(nip05Url([$handle]))->assertOk()->assertJsonPath('data.0.info', null);

    Http::assertNothingSent();
})->with([
    'private A record' => ['alice@intranet.example'],
    'one private record among public ones' => ['alice@mixed.example'],
    'IP literal' => ['alice@127.0.0.1'],
    'port' => ['alice@primal.net:8443'],
    'no DNS answer' => ['alice@nxdomain.example'],
    'name outside the NIP-05 alphabet' => ['al ice@primal.net'],
]);

it('pins the connection to the checked address, follows no redirect and counts raw bytes', function () {
    $options = Nip05Resolver::fetchOptions('primal.net', '93.184.216.34');

    expect($options['allow_redirects'])->toBeFalse()
        ->and($options['decode_content'])->toBeFalse()
        ->and($options['curl'][CURLOPT_RESOLVE])->toBe(['primal.net:443:93.184.216.34'])
        ->and(Nip05Resolver::fetchOptions('primal.net', '2606:4700::1')['curl'][CURLOPT_RESOLVE])->toBe(['primal.net:443:[2606:4700::1]']);

    // The progress callback is what aborts an oversized transfer while it arrives.
    ($options['progress'])(0, Nip05Resolver::MAX_BYTES);
    expect(fn () => ($options['progress'])(0, Nip05Resolver::MAX_BYTES + 1))->toThrow(RuntimeException::class);
    expect(fn () => ($options['progress'])(Nip05Resolver::MAX_BYTES + 1, 0))->toThrow(RuntimeException::class);
});

it('rejects a redirect, an oversized body and a non-json answer as failed', function (int $status, string $body) {
    Http::fake(['*' => Http::response($body, $status, $status === 301 ? ['Location' => 'https://10.0.0.1/'] : [])]);

    $this->get(nip05Url(['alice@primal.net']))->assertJsonPath('data.0.status', 'failed');
})->with([
    // A redirect carrying a perfectly valid body still does not count (NIP-05: ignore redirects).
    'redirect' => [301, '{"names":{"alice":"'.NIP05_PUBKEY.'"}}'],
    'oversized' => [200, '{"names":{"alice":"'.NIP05_PUBKEY.'"},"pad":"'.str_repeat('x', Nip05Resolver::MAX_BYTES).'"}'],
    'html' => [200, '<html>parked</html>'],
    'not a names object' => [200, '{"names":"alice"}'],
]);

it('caches each outcome so the next visitor does not reach the domain again', function () {
    Http::fake(['*' => Http::response(['names' => ['alice' => NIP05_PUBKEY]])]);

    $this->get(nip05Url(['alice@primal.net']))->assertJsonPath('data.0.status', 'found');
    $this->get(nip05Url(['alice@primal.net']))->assertJsonPath('data.0.status', 'found');

    Http::assertSentCount(1);
});

it('spends at most the per-domain budget, and answers the rest as throttled without caching it', function () {
    Http::fake(['*' => Http::response(['names' => []])]);
    RateLimiter::clear('group-nip05-domain:example.org');

    $handles = array_map(fn (int $i): string => 'n'.$i.'@example.org', range(1, Nip05Resolver::DOMAIN_BUDGET_PER_MINUTE));
    $this->get(nip05Url($handles))->assertOk();
    $this->get(nip05Url(['late@example.org']))->assertJsonPath('data.0.status', 'throttled');

    Http::assertSentCount(Nip05Resolver::DOMAIN_BUDGET_PER_MINUTE);
    expect(Cache::get('group:nip05:v1:'.sha1('late@example.org')))->toBeNull();
});

it('answers at most MAX_HANDLES per call', function () {
    Http::fake(['*' => Http::response(['names' => []])]);
    nip05Dns(array_fill_keys(array_map(fn (int $i): string => 'd'.$i.'.example', range(1, 40)), ['93.184.216.34']));

    $handles = array_map(fn (int $i): string => 'a@d'.$i.'.example', range(1, 40));

    expect($this->get(nip05Url($handles))->json('data'))->toHaveCount(Nip05Resolver::MAX_HANDLES);
});

it('makes no outbound request at all when the proxy is switched off', function () {
    config()->set('group.handle_proxy', false);
    Http::fake();

    $this->get(nip05Url(['alice@primal.net']))->assertJsonPath('data.0.status', 'disabled');

    Http::assertNothingSent();
});

it('carries no session cookie (route runs outside the web middleware group)', function () {
    Http::fake(['*' => Http::response(['names' => []])]);

    expect($this->get(nip05Url(['alice@primal.net']))->headers->getCookies())->toBeEmpty();
});

/*
 * The island reads `window.__nostrNip05Proxy` at boot. The web host writes its own head, so
 * the line stands there AND in the package's `partials/globals.blade.php` — measured: with
 * it only in the package, the E2E switch below had no effect on the web host.
 */
it('tells the island where to ask, and an empty value when the proxy is off', function () {
    config()->set('group.handle_proxy', true);
    $on = responseHtml($this->get(route('group.bereich.artikel'))->assertOk());
    expect($on)->toContain("window.__nostrNip05Proxy = window.__nostrNip05Proxy ?? '\\/nostr\\/nip05'");

    config()->set('group.handle_proxy', false);
    $off = responseHtml($this->get(route('group.bereich.artikel'))->assertOk());
    expect($off)->toContain("window.__nostrNip05Proxy = window.__nostrNip05Proxy ?? ''");
});

it('writes the same boot global from the package head used by foreign hosts', function () {
    config()->set('group.handle_proxy', false);

    expect(view('group::partials.globals')->render())
        ->toContain("window.__nostrNip05Proxy = window.__nostrNip05Proxy ?? ''");
});
