<?php

declare(strict_types=1);

use App\Support\VereinUpstreamBudget;
use Illuminate\Support\Facades\Http;
use Illuminate\Testing\TestResponse;
use swentel\nostr\Event\Event;
use swentel\nostr\Key\Key;
use swentel\nostr\Sign\Sign;

/*
|--------------------------------------------------------------------------
| One upstream budget for every proxy branch
|--------------------------------------------------------------------------
|
| The Verein allows 60 requests per minute per IP on its whole api group, and
| every proxy call leaves from the same egress IP. Web proxy, app proxy and
| signed app reads therefore draw from ONE budget of 30/min — counted only for
| calls that are really sent, so local refusals cannot exhaust it.
|
*/

const BUDGET_BASE = 'https://verein.test';

function budgetSignedReadHeader(string $url): string
{
    $key = str_pad((new Key)->generatePrivateKey(), 64, '0', STR_PAD_LEFT);
    $tags = [['u', $url], ['method', 'GET']];

    $event = new Event;
    $event->setKind(27235);
    $event->setContent('');
    $event->setCreatedAt(now()->getTimestamp());
    $event->setTags($tags);
    (new Sign)->signEvent($event, $key);

    return 'Nostr '.base64_encode((string) json_encode([
        'id' => $event->getId(),
        'pubkey' => $event->getPublicKey(),
        'created_at' => $event->getCreatedAt(),
        'kind' => $event->getKind(),
        'tags' => $tags,
        'content' => $event->getContent(),
        'sig' => $event->getSignature(),
    ], JSON_UNESCAPED_SLASHES));
}

beforeEach(function () {
    config(['verein.base_url' => BUDGET_BASE, 'verein.api_key' => 'BUDGET-TESTKEY-DO-NOT-LEAK']);
    Http::fake([BUDGET_BASE.'/*' => Http::response('{}', 200)]);
});

/** Web proxy `/config` under a fresh session pubkey (its own 10/min bucket stays out of the way). */
function budgetWebConfig(int $i): TestResponse
{
    return test()->withSession(['nostr_pubkey' => str_pad(dechex($i), 64, '0', STR_PAD_LEFT)])
        ->getJson('/api/verein/config');
}

/** App proxy `/config` from a fresh IP. */
function budgetAppConfig(int $i): TestResponse
{
    return test()->withServerVariables(['REMOTE_ADDR' => '192.0.2.'.(1 + $i)])
        ->getJson('/api/app/verein/config');
}

/** Signed app read with a fresh key from a fresh IP. */
function budgetAppRead(int $i): TestResponse
{
    return test()->call('GET', '/api/app/verein/me', [], [], [], [
        'HTTP_ACCEPT' => 'application/json',
        'HTTP_AUTHORIZATION' => budgetSignedReadHeader(BUDGET_BASE.'/api/v1/membership/me'),
        'REMOTE_ADDR' => '198.18.0.'.(1 + $i),
    ]);
}

it('is one budget shared by web proxy, app proxy and signed app reads', function () {
    expect(VereinUpstreamBudget::MAX_PER_MINUTE)->toBe(30);

    for ($i = 0; $i < 10; $i++) {
        budgetWebConfig($i)->assertOk();
        budgetAppConfig($i)->assertOk();
        budgetAppRead($i)->assertOk();
    }

    Http::assertSentCount(30);

    // Exhausted: every branch refuses with 429 + Retry-After, none calls out.
    foreach ([budgetWebConfig(100), budgetAppConfig(100), budgetAppRead(100)] as $refused) {
        $refused->assertStatus(429);
        expect((int) $refused->headers->get('Retry-After'))->toBeGreaterThan(0);
    }

    Http::assertSentCount(30);
});

it('is not consumed by requests refused in a local pre-check', function () {
    Http::fake();

    for ($i = 0; $i < 31; $i++) {
        // Web: signed route without any credential.
        $this->withSession(['nostr_pubkey' => str_pad(dechex($i), 64, '0', STR_PAD_LEFT)])
            ->getJson('/api/verein/me')
            ->assertUnauthorized();

        // App: a body that is not JSON.
        $this->call('POST', '/api/app/verein/applications', [], [], [], [
            'HTTP_ACCEPT' => 'application/json',
            'CONTENT_TYPE' => 'text/plain',
            'REMOTE_ADDR' => '192.0.2.'.(1 + $i),
        ], 'not json')->assertStatus(415);

        // App read: a valid signature, but for another endpoint.
        $this->call('GET', '/api/app/verein/me', [], [], [], [
            'HTTP_ACCEPT' => 'application/json',
            'HTTP_AUTHORIZATION' => budgetSignedReadHeader(BUDGET_BASE.'/api/v1/membership/payments'),
            'REMOTE_ADDR' => '198.18.0.'.(1 + $i),
        ])->assertUnauthorized();
    }

    Http::assertNothingSent();

    Http::fake([BUDGET_BASE.'/*' => Http::response('{}', 200)]);

    budgetAppRead(200)->assertOk();
    budgetAppConfig(200)->assertOk();
    budgetWebConfig(200)->assertOk();
});
