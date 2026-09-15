/**
 * **Self-proof of the response-code guard** (`support/responseGuard.ts` and its wiring in
 * `support/fixtures.ts`).
 *
 * Same shape as `relay-guard.spec.ts` and `page-error-guard.spec.ts`, for the same reason:
 * a proof of the form „this test goes red" cannot be kept green in a suite, so what is
 * asserted here is the positive half — that the OBSERVATION arrives at all, on both kinds
 * of context. The decision itself (fail-closed, both patterns must match) is pure and
 * browser-free in `support/responseGuard.nodetest.ts`.
 *
 * Both cases below stand in `ALLOWANCES` with a title AND a url pattern; without that
 * entry the status they provoke themselves would rightly make the guard red in teardown.
 *
 * **Not in `BUZZ_SPECS` (`playwright.config.ts`), and that is a gap rather than a
 * decision.** The two hermetics self-proofs are listed there by name because the thing
 * they check is the run itself, which is equally sharp in the Buzz arm — the same is true
 * of this guard, and the same sentence applies: a bolt proven in one of two arms says
 * nothing about the other. It is left out here because the Buzz arm was not measured
 * before this guard was armed, and adding the file without that measurement would put a
 * fail-closed judgement on traffic nobody has looked at.
 */
import { test, expect } from './support/fixtures'

/** A path this app has no route for — Laravel answers 404, which is the right answer. */
const MISSING = '/selbsttest-response-guard-gibt-es-nicht'

test('Standard page: an intentional 404 is observed', async ({ page, responseWaechter }) => {
    await page.goto(MISSING)

    await expect
        .poll(
            () => responseWaechter.gesehen().some((r) => r.status === 404 && r.url.includes(MISSING)),
            { timeout: 5_000, message: 'The response guard did NOT see the intentional 404' },
        )
        .toBe(true)
})

test('Own context (browser.newContext): observed just the same', async ({ browser, baseURL, responseWaechter }) => {
    // The same reason as in the other two guard self-proofs: six existing specs open their
    // contexts on `browser` rather than on the built-in `context` fixture, and a guard that
    // only sees `page` would be blind in exactly those.
    const context = await browser.newContext({ baseURL })
    try {
        const own = await context.newPage()
        await own.goto(MISSING)

        await expect
            .poll(
                () => responseWaechter.gesehen().some((r) => r.status === 404 && r.url.includes(MISSING)),
                {
                    timeout: 5_000,
                    message: 'The response guard did NOT see the 404 from the self-opened context',
                },
            )
            .toBe(true)
    } finally {
        await context.close()
    }
})
