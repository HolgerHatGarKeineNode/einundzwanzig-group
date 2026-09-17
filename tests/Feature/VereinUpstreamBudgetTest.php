<?php

declare(strict_types=1);

use App\Support\VereinUpstreamBudget;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\RateLimiter;
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

it('caps the unsigned app routes at 10 per minute while web and signed reads keep working', function () {
    expect(VereinUpstreamBudget::ANONYMOUS_MAX_PER_MINUTE)->toBe(10);

    // One IP, random body pubkeys, mixed unsigned routes — the drain attempt.
    for ($i = 0; $i < 10; $i++) {
        $route = ['/api/app/verein/applications', '/api/app/verein/payments/2026/invoice'][$i % 2];

        $this->withServerVariables(['REMOTE_ADDR' => '192.0.2.50'])
            ->postJson($route, ['pubkey' => bin2hex(random_bytes(32))])
            ->assertOk();
    }

    Http::assertSentCount(10);

    $refused = budgetAppConfig(99)->assertStatus(429);
    expect((int) $refused->headers->get('Retry-After'))->toBeGreaterThan(0);

    Http::assertSentCount(10);

    // The remaining 20 of the shared budget stay available to the verified branches.
    for ($i = 0; $i < 10; $i++) {
        budgetWebConfig($i)->assertOk();
        budgetAppRead($i)->assertOk();
    }

    Http::assertSentCount(30);

    // … and the shared cap still holds for them.
    budgetWebConfig(100)->assertStatus(429);
    budgetAppRead(100)->assertStatus(429);

    Http::assertSentCount(30);
});

it('refuses an unsigned call when the shared budget is full even if the sub-budget has room', function () {
    for ($i = 0; $i < 30; $i++) {
        ($i % 2 === 0 ? budgetWebConfig($i) : budgetAppRead($i))->assertOk();
    }

    budgetAppConfig(1)->assertStatus(429);

    Http::assertSentCount(30);
    // Refused by the cheap pre-read: the sub-budget was not touched.
    expect(RateLimiter::attempts(VereinUpstreamBudget::ANONYMOUS_KEY))->toBe(0);
});

it('decides by the count the hit returned, not by the earlier read', function () {
    for ($i = 0; $i < 30; $i++) {
        budgetWebConfig($i)->assertOk();
    }

    // Simulate the race the pre-read cannot see: another worker took the last
    // slot between read and hit. Here the read is simply always stale.
    $stale = new class(app('cache')->driver(config('cache.limiter'))) extends Illuminate\Cache\RateLimiter
    {
        public function tooManyAttempts($key, $maxAttempts): bool
        {
            return false;
        }
    };
    app()->instance(Illuminate\Cache\RateLimiter::class, $stale);
    RateLimiter::clearResolvedInstance(Illuminate\Cache\RateLimiter::class);

    // Called directly: the fresh limiter instance carries no named route limiters.
    expect(VereinUpstreamBudget::reserve()?->getStatusCode())->toBe(429)
        ->and(VereinUpstreamBudget::reserveAnonymous()?->getStatusCode())->toBe(429);

    Http::assertSentCount(30);
});
