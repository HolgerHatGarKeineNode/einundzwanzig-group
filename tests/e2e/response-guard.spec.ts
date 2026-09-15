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
 * **In `BUZZ_SPECS` (`playwright.config.ts`) since 2026-09-15 — and the sentence that
 * stood here before was wrong.** It said that leaving the file out avoided putting „a
 * fail-closed judgement on traffic nobody has looked at" on the Buzz arm. Leaving it out
 * never did that: the `relayWaechter` fixture that throws the verdict is `{ auto: true }`,
 * and every Buzz spec draws its `test` from `./support/fixtures` — `support/specImporte
 * .nodetest.ts` holds that down by name. The guard judged every test in the Buzz arm from
 * the first run; only its SELF-PROOF was missing there. A comment that describes a
 * protection which does not exist is the most expensive kind, because the next reader
 * budgets for a gap that is already open.
 *
 * The traffic has been looked at since (2026-09-15, `E2E_RELAY=buzz`, full arm,
 * `E2E_RESPONSE_REPORT`): five observed error responses, one of them an intended 403 that
 * now stands in `ALLOWANCES`, the other four a fixture defect repaired in
 * `support/buzz.ts`. The numbers are in the head of `support/responseGuard.ts`.
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
