<?php

declare(strict_types=1);

namespace App\Support;

use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\RateLimiter;

/**
 * The one request budget toward the Verein, shared by every proxy branch.
 *
 * The Verein caps its whole `api/*` group at 60 requests per minute per IP
 * (einundzwanzig-verein bootstrap/app.php, `ThrottleRequests::class.':api'`;
 * its AppServiceProvider: `Limit::perMinute(60)->by($request->ip())`). Every
 * call of the web proxy, the app proxy and the signed app reads leaves this
 * server from the same egress IP, so that cap is one shared good. Separate
 * instance caps per limiter would add up past it, and the Verein would then
 * answer 429 to everyone — after a user has already signed.
 *
 * Why 30 and not 55: both sides count in fixed windows that are not aligned,
 * so two full windows here can fall into one window there — worst case twice
 * this value (same reasoning as the former `verein-proxy` instance bucket in
 * AppServiceProvider).
 *
 * Counted ONLY for requests that are actually about to be sent upstream:
 * callers reserve right before the HTTP call, after every local pre-check
 * passed. A refused credential or a malformed body therefore costs nothing
 * here, and an exhausted budget refuses before the Verein sees — and burns —
 * a signed event.
 */
final class VereinUpstreamBudget
{
    public const KEY = 'verein-upstream';

    public const MAX_PER_MINUTE = 30;

    /**
     * Sub-budget for the UNSIGNED app routes (config, applications, invoice).
     * Anyone can call them without a key or session, so without this cap a
     * single caller could drain the whole shared budget and block web joins,
     * payments and signed reads for everyone. Anonymous traffic gets at most
     * this share of MAX_PER_MINUTE.
     */
    public const ANONYMOUS_KEY = 'verein-upstream:anon';

    public const ANONYMOUS_MAX_PER_MINUTE = 10;

    private const DECAY_SECONDS = 60;

    /**
     * Takes one request from the shared budget (session-verified web calls and
     * signed app reads).
     *
     * @return JsonResponse|null null = reserved, go ahead; otherwise the 429 to return
     */
    public static function reserve(): ?JsonResponse
    {
        return self::reserveAll([self::KEY => self::MAX_PER_MINUTE]);
    }

    /**
     * Takes one request from the anonymous sub-budget AND the shared budget.
     *
     * @return JsonResponse|null null = reserved, go ahead; otherwise the 429 to return
     */
    public static function reserveAnonymous(): ?JsonResponse
    {
        return self::reserveAll([
            self::ANONYMOUS_KEY => self::ANONYMOUS_MAX_PER_MINUTE,
            self::KEY => self::MAX_PER_MINUTE,
        ]);
    }

    /**
     * All buckets must have room. A cheap read first refuses without touching
     * any counter while one is already full; then every counter is hit and the
     * returned counts decide, so on a store with atomic increments two
     * concurrent requests cannot both pass on the same last slot.
     *
     * No rollback: a request refused after the hit keeps its count in every
     * bucket it hit, so under contention a bucket may close a few requests
     * early — never late.
     *
     * @param  array<string, int>  $limits  key => max per minute
     */
    private static function reserveAll(array $limits): ?JsonResponse
    {
        foreach ($limits as $key => $max) {
            if (RateLimiter::tooManyAttempts($key, $max)) {
                return self::tooManyAttempts($key);
            }
        }

        $refusedBy = null;

        foreach ($limits as $key => $max) {
            if (RateLimiter::hit($key, self::DECAY_SECONDS) > $max) {
                $refusedBy ??= $key;
            }
        }

        return $refusedBy === null ? null : self::tooManyAttempts($refusedBy);
    }

    /**
     * A 429 shaped like the one the throttle middleware renders for `api/*`,
     * with the Retry-After the client needs to avoid signing blindly again.
     */
    public static function tooManyAttempts(string $key): JsonResponse
    {
        return response()->json(['message' => 'Too Many Attempts.'], 429, [
            'Retry-After' => (string) max(1, RateLimiter::availableIn($key)),
        ]);
    }
}
