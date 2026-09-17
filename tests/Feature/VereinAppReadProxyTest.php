<?php

declare(strict_types=1);

use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Request as ClientRequest;
use Illuminate\Support\Facades\Http;
use swentel\nostr\Event\Event;
use swentel\nostr\Key\Key;
use swentel\nostr\Sign\Sign;

/*
|--------------------------------------------------------------------------
| D11 — signed app reads: GET /api/app/verein/me and /payments
|--------------------------------------------------------------------------
|
| The app signs a NIP-98 event for the VEREIN URL; the proxy pre-checks it,
| spends nothing upstream on a bad one, and forwards a good one byte for byte
| to the signed branch `/api/v1/membership/...`. The test key is conspicuous
| on purpose, so "never in a response" is a string search.
|
*/

const APP_READ_BASE = 'https://verein.test';

const APP_READ_KEY = 'APP-READ-TESTKEY-DO-NOT-LEAK';

/**
 * Signs a kind-27235 event the way the app would.
 *
 * @param  array<string, mixed>  $override  fields replaced AFTER signing (breaks the signature on purpose)
 * @return array<string, mixed>
 */
function signAppReadAuth(string $url, string $method = 'GET', int $ageSeconds = 0, int $kind = 27235, ?string $privateKey = null, array $override = []): array
{
    // Left-padded: the generator drops leading zero bytes (see VereinProxyTest).
    $key = $privateKey ?? str_pad((new Key)->generatePrivateKey(), 64, '0', STR_PAD_LEFT);
    $tags = [['u', $url], ['method', $method]];

    $event = new Event;
    $event->setKind($kind);
    $event->setContent('');
    $event->setCreatedAt(now()->getTimestamp() - $ageSeconds);
    $event->setTags($tags);

    (new Sign)->signEvent($event, $key);

    return array_merge([
        'id' => $event->getId(),
        'pubkey' => $event->getPublicKey(),
        'created_at' => $event->getCreatedAt(),
        'kind' => $event->getKind(),
        'tags' => $tags,
        'content' => $event->getContent(),
        'sig' => $event->getSignature(),
    ], $override);
}

/**
 * @param  array<string, mixed>  $event
 */
function appReadHeader(array $event): string
{
    return 'Nostr '.base64_encode((string) json_encode($event, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));
}

function appReadPrivateKey(): string
{
    return str_pad((new Key)->generatePrivateKey(), 64, '0', STR_PAD_LEFT);
}

beforeEach(function () {
    config(['verein.base_url' => APP_READ_BASE, 'verein.api_key' => APP_READ_KEY]);
});

dataset('signed read routes', [
    'me' => ['/api/app/verein/me', APP_READ_BASE.'/api/v1/membership/me'],
    'payments' => ['/api/app/verein/payments', APP_READ_BASE.'/api/v1/membership/payments'],
]);

it('answers 401 without a header and never calls the Verein', function (string $route) {
    Http::fake();

    $this->getJson($route)
        ->assertUnauthorized()
        ->assertHeader('Cache-Control', 'no-store, private');

    Http::assertNothingSent();
})->with('signed read routes');

it('rejects an unfit credential with 401 before any network call', function (string $route, string $target, string $case) {
    Http::fake();

    // Frozen: an event stamped 61 s ahead is only 60 s ahead once the clock
    // ticks between signing and checking — the boundary case would flake.
    $this->freezeTime();

    $header = match ($case) {
        'wrong kind' => appReadHeader(signAppReadAuth($target, kind: 1)),
        'signed for POST' => appReadHeader(signAppReadAuth($target, 'POST')),
        'u is the proxy route' => appReadHeader(signAppReadAuth('http://localhost'.$route)),
        'u is the other endpoint' => appReadHeader(signAppReadAuth(str_ends_with($target, '/me') ? APP_READ_BASE.'/api/v1/membership/payments' : APP_READ_BASE.'/api/v1/membership/me')),
        'u carries a query' => appReadHeader(signAppReadAuth($target.'?x=1')),
        'older than 60 s' => appReadHeader(signAppReadAuth($target, ageSeconds: 61)),
        'more than 60 s ahead' => appReadHeader(signAppReadAuth($target, ageSeconds: -61)),
        'forged signature' => appReadHeader(signAppReadAuth($target, override: ['sig' => str_repeat('0', 128)])),
        'foreign pubkey on a valid signature' => appReadHeader(signAppReadAuth($target, override: ['pubkey' => signAppReadAuth($target)['pubkey']])),
        'uppercase pubkey' => appReadHeader(signAppReadAuth($target, override: ['pubkey' => str_repeat('A', 64)])),
        'scheme Bearer' => 'Bearer '.base64_encode((string) json_encode(signAppReadAuth($target))),
        'not base64' => 'Nostr %%%not-base64%%%',
        'base64 of non-JSON' => 'Nostr '.base64_encode('not json'),
        'JSON missing fields' => 'Nostr '.base64_encode('{"kind":27235}'),
    };

    $this->call('GET', $route, [], [], [], [
        'HTTP_ACCEPT' => 'application/json',
        'HTTP_AUTHORIZATION' => $header,
    ])
        ->assertUnauthorized()
        ->assertHeader('Cache-Control', 'no-store, private');

    Http::assertNothingSent();
})->with('signed read routes')->with([
    'wrong kind', 'signed for POST', 'u is the proxy route', 'u is the other endpoint', 'u carries a query',
    'older than 60 s', 'more than 60 s ahead', 'forged signature', 'foreign pubkey on a valid signature',
    'uppercase pubkey', 'scheme Bearer', 'not base64', 'base64 of non-JSON', 'JSON missing fields',
]);

it('rejects a request body with 401 and calls nothing', function (string $route, string $target) {
    Http::fake();

    $this->call('GET', $route, [], [], [], [
        'HTTP_ACCEPT' => 'application/json',
        'HTTP_AUTHORIZATION' => appReadHeader(signAppReadAuth($target)),
        'CONTENT_TYPE' => 'application/json',
    ], '{"pubkey":"x"}')->assertUnauthorized();

    Http::assertNothingSent();
})->with('signed read routes');

it('forwards a valid credential verbatim with the API key and passes the answer through', function (string $route, string $target) {
    Http::fake([APP_READ_BASE.'/*' => Http::response('{"status":"active","year":2026}', 200, [
        'Content-Type' => 'application/json',
        'Set-Cookie' => 'foreign=1',
    ])]);

    $header = appReadHeader(signAppReadAuth($target));

    $response = $this->call('GET', $route.'?leak=1', [], [], [], [
        'HTTP_ACCEPT' => 'application/json',
        'HTTP_AUTHORIZATION' => $header,
        'HTTP_X_API_KEY' => 'caller-supplied',
    ]);

    $response->assertOk()
        ->assertHeader('Cache-Control', 'no-store, private')
        ->assertHeader('Content-Type', 'application/json');

    expect($response->getContent())->toBe('{"status":"active","year":2026}')
        ->and($response->getContent())->not->toContain(APP_READ_KEY)
        ->and($response->headers->get('Set-Cookie'))->toBeNull();

    Http::assertSentCount(1);
    Http::assertSent(fn (ClientRequest $r): bool => $r->method() === 'GET'
        && $r->url() === $target
        && $r->header('Authorization') === [$header]
        && $r->header('X-Api-Key') === [APP_READ_KEY]
        && $r->body() === '');
})->with('signed read routes');

it('passes an upstream 401 (e.g. replayed event) through once, without retrying', function (string $route, string $target) {
    Http::fake([APP_READ_BASE.'/*' => Http::response('{"message":"Unauthenticated."}', 401, ['Content-Type' => 'application/json'])]);

    $this->call('GET', $route, [], [], [], [
        'HTTP_ACCEPT' => 'application/json',
        'HTTP_AUTHORIZATION' => appReadHeader(signAppReadAuth($target)),
    ])
        ->assertUnauthorized()
        ->assertHeader('Cache-Control', 'no-store, private')
        ->assertExactJson(['message' => 'Unauthenticated.']);

    Http::assertSentCount(1);
})->with('signed read routes');

it('answers 504 once when the Verein is unreachable', function (string $route, string $target) {
    $attempts = 0;

    Http::fake(function () use (&$attempts) {
        $attempts++;

        throw new ConnectionException('cURL error 28: timeout');
    });

    $this->call('GET', $route, [], [], [], [
        'HTTP_ACCEPT' => 'application/json',
        'HTTP_AUTHORIZATION' => appReadHeader(signAppReadAuth($target)),
    ])->assertStatus(504)->assertHeader('Cache-Control', 'no-store, private');

    expect($attempts)->toBe(1);
})->with('signed read routes');

it('answers 503 and calls nothing when unconfigured', function (string $route, string $target) {
    Http::fake();
    config(['verein.base_url' => '', 'verein.api_key' => '']);

    $this->call('GET', $route, [], [], [], [
        'HTTP_ACCEPT' => 'application/json',
        'HTTP_AUTHORIZATION' => appReadHeader(signAppReadAuth($target)),
    ])->assertStatus(503);

    Http::assertNothingSent();
})->with('signed read routes');

it('throttles per verified signer: 6 per minute, and a second pubkey has its own bucket', function () {
    Http::fake([APP_READ_BASE.'/*' => Http::response('{}', 200)]);

    $target = APP_READ_BASE.'/api/v1/membership/me';
    $alice = appReadPrivateKey();
    $bob = appReadPrivateKey();

    $send = fn (string $key, string $ip) => $this->call('GET', '/api/app/verein/me', [], [], [], [
        'HTTP_ACCEPT' => 'application/json',
        'HTTP_AUTHORIZATION' => appReadHeader(signAppReadAuth($target, privateKey: $key)),
        'REMOTE_ADDR' => $ip,
    ]);

    for ($i = 0; $i < 6; $i++) {
        $send($alice, '198.51.100.1')->assertOk();
    }

    $blocked = $send($alice, '198.51.100.1')->assertStatus(429)->assertHeader('Cache-Control', 'no-store, private');
    expect($blocked->headers->has('Retry-After'))->toBeTrue();
    // Keyed on the signer, not on the IP: a different IP does not help Alice …
    $send($alice, '198.51.100.2')->assertStatus(429);
    // … and Alice's bucket does not touch Bob, on the same IP.
    $send($bob, '198.51.100.1')->assertOk();

    // Refused signer requests never reached the Verein.
    Http::assertSentCount(7);
});

it('does not let forged claims lock out the real signer', function () {
    Http::fake([APP_READ_BASE.'/*' => Http::response('{}', 200)]);

    $target = APP_READ_BASE.'/api/v1/membership/me';
    $alice = appReadPrivateKey();
    $alicePubkey = signAppReadAuth($target, privateKey: $alice)['pubkey'];

    // Well-formed events that CLAIM Alice, signed by someone else — well past
    // her 6/min, spread over IPs so the per-IP bucket does not stop them first.
    for ($i = 0; $i < 20; $i++) {
        $this->call('GET', '/api/app/verein/me', [], [], [], [
            'HTTP_ACCEPT' => 'application/json',
            'HTTP_AUTHORIZATION' => appReadHeader(signAppReadAuth($target, override: ['pubkey' => $alicePubkey])),
            'REMOTE_ADDR' => '198.51.100.'.(100 + $i),
        ])->assertUnauthorized();
    }

    $this->call('GET', '/api/app/verein/me', [], [], [], [
        'HTTP_ACCEPT' => 'application/json',
        'HTTP_AUTHORIZATION' => appReadHeader(signAppReadAuth($target, privateKey: $alice)),
        'REMOTE_ADDR' => '198.51.100.1',
    ])->assertOk();

    Http::assertSentCount(1);
});

it('puts a cheap per-IP bucket of 30 per minute in front of every check', function () {
    Http::fake();

    for ($i = 0; $i < 30; $i++) {
        $this->withServerVariables(['REMOTE_ADDR' => '198.51.100.20'])->getJson('/api/app/verein/me')->assertUnauthorized();
    }

    $this->withServerVariables(['REMOTE_ADDR' => '198.51.100.20'])->getJson('/api/app/verein/me')->assertStatus(429);
    $this->withServerVariables(['REMOTE_ADDR' => '198.51.100.21'])->getJson('/api/app/verein/me')->assertUnauthorized();

    Http::assertNothingSent();
});
