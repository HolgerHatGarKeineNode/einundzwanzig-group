/**
 * **P7 release sweep: the browser console, the page errors and the response codes over
 * every hub route, at both widths, on the first load AND after a Livewire roundtrip.**
 *
 * Plan: `docs/plans/2026-09-17T1946-revamp-ein-eingang.md`, DoD P7.
 *
 * ── Why this file exists next to the per-phase guard cases ──────────────────────────
 *
 * Every spec of this suite draws its `test` from `support/fixtures`, so both guards judge
 * every case in the run — but they judge whatever that case happened to visit. P2 to P6
 * built seven new surfaces, and no single case walked all of them at both widths. This one
 * does, and it is deliberately dumb: load, refresh, read the two guards, print the numbers.
 *
 * **Server-side tests cannot answer this question.** A green Pest suite says the markup
 * renders; it says nothing about a torn Alpine scope, a missing Livewire snapshot or an
 * exception thrown in an event handler. Measured in a sibling project on 2026-09-08: 1791
 * green tests next to 106 console errors on one page.
 *
 * **And a 500 on a Livewire roundtrip appears in NO console channel** — it is a rejected
 * promise. That is the whole reason the response guard exists, and the reason every route
 * below is refreshed rather than only loaded.
 *
 * ── The positive control ───────────────────────────────────────────────────────────
 *
 * It is NOT in this file, on purpose. `page-error-guard.spec.ts` injects a real `throw` and
 * asserts the guard saw it; `response-guard.spec.ts` provokes a real 404 and asserts the
 * same. Both run in this very sweep, both carry the allowance that lets them stay green,
 * and a second copy here would need a second allowance — i.e. a second hole in the list
 * that must never become a blanket. A „no errors" claim from this file is therefore only
 * worth anything together with those two cases in the same run, which is exactly how the
 * phase report quotes it.
 *
 * ── Two widths, one file ───────────────────────────────────────────────────────────
 *
 * `desktop-*.spec.ts` would run ONLY in the `desktop` project and the 1279 px project would
 * ignore it; a file without that prefix runs in `chromium` alone. Since this sweep needs
 * 390 × 844 AND 1440 × 900, it sets its viewport per case — `setViewportSize` beats the
 * project default, which is what the three existing cases with their own viewport do.
 */
import { test, expect, type Page } from './support/fixtures'
import { useZooid } from './support/zooid'
import { loginNsec } from './support/login'

const NSEC = process.env.NOSTR_TEST_NSEC as string

/**
 * The seven routes of the new shell (D3), in the order a person meets them.
 *
 * `/bereich/forge`, `/bereich/leute` and `/bereich/wallet` are not in this list and that is
 * not an oversight: each of them has a spec of its own that loads it under the same guards
 * (`desktop-forge*.spec.ts`, `directory.spec.ts`, `wallet.spec.ts`). What this sweep adds is
 * coverage for the surfaces that have no such owner at BOTH widths.
 */
const ROUTEN = [
    '/start',
    '/postfach',
    '/bereich/chat',
    '/bereich/meetups',
    '/bereich/artikel',
    '/ich',
    '/ich/verein',
] as const

/** The two widths the plan names: a phone and a desktop. */
const BREITEN = [
    { name: 'mobil', width: 390, height: 844 },
    { name: 'desktop', width: 1440, height: 900 },
] as const

/**
 * One Livewire roundtrip on the page that is open, with the assertion that it HAPPENED.
 *
 * **The endpoint is not `/livewire/update` in this app** — Livewire 4 puts a per-application
 * prefix in front of it (`livewire-<hash>/update`, `php artisan route:list`). A matcher on
 * the plain path waits for a request that was long since sent, which reads like „the
 * roundtrip did not happen" and is the opposite of the truth.
 *
 * Fail-closed: a page without a Livewire component would answer with a roundtrip that never
 * happened, and the guards would have nothing to judge.
 */
async function roundtrip(page: Page, pfad: string): Promise<void> {
    const antwort = page.waitForResponse((res) => /\/livewire[^/]*\/update/.test(res.url()), { timeout: 25_000 })
    const komponenten = await page.evaluate(() => {
        // `Livewire.all()` hands out COMPONENTS; the callable surface is their `$wire`.
        const livewire = (window as unknown as {
            Livewire?: { all(): { $wire: { $refresh(): void } }[] }
        }).Livewire
        const alle = livewire?.all() ?? []
        alle.forEach((component) => component.$wire.$refresh())

        return alle.length
    })
    expect(komponenten, `no Livewire component on ${pfad} — the roundtrip would be fictional`).toBeGreaterThan(0)
    const res = await antwort
    expect(res.status(), `Livewire roundtrip on ${pfad}`).toBe(200)
}

for (const breite of BREITEN) {
    test(`P7 sweep (${breite.name}, ${breite.width}px): console, page errors and response codes stay clean on every hub route`, async ({
        page,
        pageErrorWaechter,
        responseWaechter,
    }) => {
        // Seven loads plus seven roundtrips, each of them waiting on a relay.
        test.setTimeout(300_000)
        await page.setViewportSize({ width: breite.width, height: breite.height })
        await useZooid(page)
        await loginNsec(page, NSEC)

        for (const pfad of ROUTEN) {
            await page.goto(pfad)
            // The stage is the one anchor every one of these pages shares (`app-shell`).
            await expect(page.locator('#buehne'), `no stage on ${pfad}`).toBeVisible({ timeout: 30_000 })
            // And the island is really booted — a page whose Alpine never started throws no
            // error and would make this sweep a measurement of an empty document.
            await page.waitForFunction(() => Boolean((window as unknown as { Alpine?: unknown }).Alpine), {
                timeout: 30_000,
            })

            await roundtrip(page, pfad)
            await expect(page.locator('#buehne'), `the stage survives the roundtrip on ${pfad}`).toBeVisible()

            // Read AFTER every route so the log names the route that produced a finding — the
            // teardown verdict names only the case.
            console.log(
                `[P7 sweep/${breite.name}] ${pfad}: ${pageErrorWaechter.gesehen().length} page errors, `
                    + `${responseWaechter.gesehen().length} error responses (cumulative)`,
            )
        }

        const fehler = pageErrorWaechter.gesehen()
        const antworten = responseWaechter.gesehen()
        console.log(
            `[P7 sweep/${breite.name}] TOTAL over ${ROUTEN.length} routes: `
                + `${fehler.length} page errors, ${antworten.length} error responses`,
        )
        expect(fehler, `browser console/pageerror at ${breite.width}px`).toEqual([])
        expect(antworten, `error response at ${breite.width}px`).toEqual([])
    })
}
