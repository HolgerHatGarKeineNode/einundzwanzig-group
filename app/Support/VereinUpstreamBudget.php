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

    private const DECAY_SECONDS = 60;

    /**
     * Takes one request from the budget.
     *
     * @return JsonResponse|null null = reserved, go ahead; otherwise the 429 to return
     */
    public static function reserve(): ?JsonResponse
    {
        if (RateLimiter::tooManyAttempts(self::KEY, self::MAX_PER_MINUTE)) {
            return self::tooManyAttempts(self::KEY);
        }

        RateLimiter::hit(self::KEY, self::DECAY_SECONDS);

        return null;
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
