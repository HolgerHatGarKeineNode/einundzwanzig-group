<?php

declare(strict_types=1);

use App\Support\VereinUpstreamBudget;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Request as ClientRequest;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\RateLimiter;

/*
|--------------------------------------------------------------------------
| P8 — App-Proxy des Vereins-Beitritts
|--------------------------------------------------------------------------
|
| Drei Türen, keine Session, keine Signatur — und genau das ist der Prüfgegen-
| stand: Der App-Zweig darf KEINE der Web-Bindungen haben (sonst wäre die App
| draußen) und KEINE vierte Tür (sonst wäre er eine offene Fläche). Der
| Testschlüssel heißt wie beim Web-Proxy auffällig, damit „erscheint in keiner
| Antwort und keinem Log" eine Suche ist und keine Beteuerung.
|
*/

const APP_PROXY_BASE = 'https://verein.test';

const APP_PROXY_KEY = 'APP-PROXY-TESTKEY-DO-NOT-LEAK';

beforeEach(function () {
    config(['verein.base_url' => APP_PROXY_BASE, 'verein.api_key' => APP_PROXY_KEY]);

    /*
     * Die Routen registriert bootstrap/app.php selbst (nicht im NativePHP-Lauf,
     * also auch im Test-Bootstrap) — hier steht nur die Konfiguration.
     */
});

it('forwards config without any session or signature and passes the answer through', function () {
    Http::fake([APP_PROXY_BASE.'/api/v1/app/membership/config' => Http::response([
        'membership_fee' => 21000,
    ], 200)]);

    $this->getJson('/api/app/verein/config')
        ->assertOk()
        ->assertJsonPath('membership_fee', 21000);

    Http::assertSent(fn (ClientRequest $r): bool => $r->hasHeader('X-Api-Key', APP_PROXY_KEY)
        && $r->hasHeader('Accept', 'application/json'));
});

it('forwards an application with the body untouched and no Authorization header', function () {
    Http::fake([APP_PROXY_BASE.'/*' => Http::response(['ok' => true], 201)]);

    $body = ['pubkey' => str_repeat('a', 64), 'statutes_accepted' => true];

    $this->postJson('/api/app/verein/applications', $body)->assertCreated();

    Http::assertSent(fn (ClientRequest $r): bool => $r->method() === 'POST'
        && $r->url() === APP_PROXY_BASE.'/api/v1/app/membership/applications'
        && $r->body() === json_encode($body)
        && $r->hasHeader('Authorization') === false);
});

it('forwards an invoice for a year and refuses a non-four-digit year locally', function () {
    Http::fake([APP_PROXY_BASE.'/*' => Http::response(['checkout' => 'x'], 200)]);

    $this->postJson('/api/app/verein/payments/2026/invoice', [
        'pubkey' => str_repeat('b', 64),
    ])->assertOk();

    $this->postJson('/api/app/verein/payments/20x6/invoice', [
        'pubkey' => str_repeat('b', 64),
    ])->assertNotFound();

    Http::assertSentCount(1);
});

it('passes status and body through unchanged, filtering foreign headers', function () {
    /*
     * X-RateLimit-Limit bleibt hier offen bewusst weg: Unser EIGENER Limiter
     * (throttle:verein-app-proxy) stempelt denselben Headernamen auf die
     * Antwort — der Verein-Zähler ist gefiltert, der eigene ist gewollt da.
     */
    Http::fake([APP_PROXY_BASE.'/*' => Http::response('{"message":"validation.failed"}', 422, [
        'Retry-After' => '7',
        'Set-Cookie' => 'session=foreign',
    ])]);

    $response = $this->postJson('/api/app/verein/applications', ['pubkey' => 'x']);

    expect($response->status())->toBe(422)
        ->and($response->headers->get('Retry-After'))->toBe('7')
        ->and($response->headers->get('Set-Cookie'))->toBeNull();
});

it('answers 504 when the association is unreachable and does not retry', function () {
    $versuche = 0;

    Http::fake(function () use (&$versuche) {
        $versuche++;

        throw new ConnectionException('cURL error 28: timeout');
    });

    $this->postJson('/api/app/verein/applications', ['pubkey' => str_repeat('c', 64)])
        ->assertStatus(504)
        ->assertJsonPath('message', 'Der Verein ist derzeit nicht erreichbar.');

    expect($versuche)->toBe(1);
});

it('answers 503 and calls nothing when base URL or key are unconfigured', function () {
    config(['verein.base_url' => '', 'verein.api_key' => '']);

    $this->getJson('/api/app/verein/config')->assertStatus(503);

    Http::assertNothingSent();
});

it('rejects a non-JSON body before the network', function () {
    $this->call('POST', '/api/app/verein/applications', [], [], [], [
        'HTTP_ACCEPT' => 'application/json',
        'CONTENT_TYPE' => 'text/plain',
    ], 'not json')->assertStatus(415);

    Http::assertNothingSent();
});

it('never puts the API key into a response body', function () {
    /*
     * Der Schlüssel reist NUR als Header nach draußen. Positivkontrolle ist
     * der ausgehende Request (trägt ihn), Negativkontrolle jede Antwort.
     */
    Http::fake([APP_PROXY_BASE.'/*' => Http::response(['ok' => true], 200)]);

    $response = $this->getJson('/api/app/verein/config');

    expect($response->getContent())->not->toContain(APP_PROXY_KEY);

    Http::assertSent(fn (ClientRequest $r): bool => $r->hasHeader('X-Api-Key', APP_PROXY_KEY));
});

/**
 * These limiter tests send more calls than the upstream budgets allow; the
 * budgets are emptied between calls so only the limiter under test decides
 * (the budgets have their own tests in VereinUpstreamBudgetTest).
 */
function resetUpstreamBudgets(): void
{
    RateLimiter::clear(VereinUpstreamBudget::KEY);
    RateLimiter::clear(VereinUpstreamBudget::ANONYMOUS_KEY);
}

/*
 * Limiter key of `throttle:verein-app-proxy`. A body-less request used to land
 * in ONE literal `pubkey:none` bucket shared by every caller, so 20 `/config`
 * calls anywhere locked `/config` for everyone.
 */
it('does not share one subject bucket between body-less requests of different IPs', function () {
    Http::fake([APP_PROXY_BASE.'/*' => Http::response(['ok' => true], 200)]);

    for ($i = 0; $i < 20; $i++) {
        $this->withServerVariables(['REMOTE_ADDR' => '203.0.113.1'])
            ->getJson('/api/app/verein/config')
            ->assertOk();

        resetUpstreamBudgets();
    }

    $this->withServerVariables(['REMOTE_ADDR' => '203.0.113.1'])
        ->getJson('/api/app/verein/config')
        ->assertStatus(429);

    $this->withServerVariables(['REMOTE_ADDR' => '203.0.113.2'])
        ->getJson('/api/app/verein/config')
        ->assertOk();
});

it('still keys a body pubkey across IPs', function () {
    Http::fake([APP_PROXY_BASE.'/*' => Http::response(['ok' => true], 201)]);

    $body = ['pubkey' => str_repeat('d', 64)];

    for ($i = 0; $i < 20; $i++) {
        $this->withServerVariables(['REMOTE_ADDR' => '203.0.113.'.(10 + $i)])
            ->postJson('/api/app/verein/applications', $body)
            ->assertCreated();

        resetUpstreamBudgets();
    }

    $this->withServerVariables(['REMOTE_ADDR' => '203.0.113.99'])
        ->postJson('/api/app/verein/applications', $body)
        ->assertStatus(429);
});

it('does not fail on a body pubkey that is not a string', function () {
    Http::fake([APP_PROXY_BASE.'/*' => Http::response(['message' => 'validation.failed'], 422)]);

    $this->postJson('/api/app/verein/applications', ['pubkey' => ['a']])
        ->assertStatus(422);
});
