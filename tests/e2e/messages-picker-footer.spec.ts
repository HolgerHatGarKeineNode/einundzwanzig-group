import { test, expect, type Page } from './support/fixtures'
import { useZooid } from './support/zooid'
import { loginNsec } from './support/login'

/**
 * **The action row of the "new conversation" card, measured against the fixed bottom bar
 * at 320 px, 375 px and 1280 px — and the whole page measured for horizontal overflow at
 * the same three widths.**
 *
 * ── The defect this latches ──────────────────────────────────────────────────────────
 *
 * Reported from a device (TWENTY ONE Companion v1.12.0, Android emulator, 1080 × 2424,
 * dark): "Abbrechen" and "Unterhaltung öffnen" were sliced horizontally by the app's
 * five-tab bottom bar. Reproduced here in the browser at 375 × 667, measured with the fix
 * removed: the row sat at y 684–716 the moment the card opened and at y 679–711 after
 * picking somebody, against a bar starting at y 607 — 109 px and 104 px past the usable
 * edge, so the confirm button of a dialog was not visible at all.
 *
 * **The clearance was never missing.** `app-shell.blade.php` reserves `pb-28` (112 px) on
 * the stage, which is more than the bar is tall. It only becomes reachable at the END of
 * a document scroll, and on a touch device that scroll is hard to perform: the card's own
 * suggestion list is a nested scroll region (`max-h-48 overflow-y-auto`) sitting exactly
 * where the thumb lands, so it eats the gesture. The report's second screenshot shows
 * precisely that — the list had scrolled, the page had not.
 *
 * The fix therefore does not add clearance, it removes the scroll: the card pulls its own
 * end into view (`x-effect` → `scrollIntoView({ block: 'end' })`) against a
 * `scroll-margin-bottom` that reads the bar's MEASURED height (`--group-nav-h`, published
 * by `bottom-nav.blade.php`), never a constant.
 *
 * ── What this file measures about ITSELF before it measures the surface ──────────────
 *
 * A green "no overlap" is worthless if there was no bar. Every width therefore asserts
 * what it expects to find: below 1280 px the bar must be present AND visible, at 1280 px
 * it must be gone (`xl:hidden` in the web host). And `--group-nav-h` is checked against
 * the bar's own `getBoundingClientRect().height` on the narrow widths and against `0px`
 * at 1280 px — so the mechanism is measured, not only its outcome.
 *
 * ── Why the file is NOT called `desktop-*` and needs no relay guard ──────────────────
 *
 * Same two mechanics as `rail-footer-widths.spec.ts`: `desktop-*.spec.ts` would run in
 * the `desktop` project, which pins 1440 × 900 — a case logging "1280" from inside it
 * would be lying about its own viewport. And in Buzz mode the `chromium` project narrows
 * to `BUZZ_SPECS`, so this name is excluded there without a `test.skip` nobody reads.
 *
 * ── The second defect this file latches ─────────────────────────────────────────────
 *
 * The first version of this case allowed `scrollWidth - clientWidth <= 31`, because the
 * screen carried that much horizontal overflow: `[data-pm-relay-publish]` is a Flux
 * button whose sentence-long label runs under Flux's own `whitespace-nowrap`, so it
 * shrink-wrapped to a constant 373 px and pushed `scrollWidth` to 406 — against 375 px
 * of client width, and against 288 px of column at 320 px, where the overflow is 86 px.
 * WCAG 1.4.10 names 320 px, which is why the ceiling was read at the wrong width to
 * begin with.
 *
 * The button now wraps, and the ceiling is `scrollWidth === clientWidth`. Because a
 * reflow fix must not be bought by shrinking a target below WCAG 2.5.8, the button's own
 * box is asserted alongside the page width.
 */
const NSEC = process.env.NOSTR_TEST_NSEC as string

type Kasten = { x: number; y: number; w: number; h: number; top: number; bottom: number; right: number }

type Messung = {
    viewport: { w: number; h: number }
    docScrollWidth: number
    docClientWidth: number
    docScrollTop: number
    navVariable: string
    bar: (Kasten & { visible: boolean }) | null
    fuss: Kasten | null
    bestaetigen: Kasten | null
    /** The delivery-address button — the element that used to overflow the document. */
    veroeffentlichen: Kasten | null
    /** Geometric intersection of the action row with the bar, in px. */
    overlapPx: number
    /** How far the action row reaches past the usable edge (bar top, else viewport bottom). */
    unterKantePx: number
}

/**
 * Wait until nothing is moving any more.
 *
 * `.page-enter` translates the whole island for 300 ms, and a box read inside that
 * window carries the offset: the first run of this file logged the action row at x 2 in
 * one pass and x 17 in the next, purely from where the animation happened to be. Same
 * lesson as `resize()` — settle, then measure.
 */
async function settle(page: Page): Promise<void> {
    await page.waitForFunction(() => document.getAnimations().every((a) => a.playState === 'finished'), null, {
        timeout: 10_000,
    })
    // One more frame so the layout after the last animation step is committed.
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))))
}

/** Everything both widths need, read in one pass off the rendered tree. */
async function messeFuss(page: Page): Promise<Messung> {
    return page.evaluate(() => {
        const rund = (n: number): number => Math.round(n * 100) / 100
        const kasten = (el: Element | null) => {
            if (!el) {
                return null
            }
            const r = el.getBoundingClientRect()

            return {
                x: rund(r.x),
                y: rund(r.y),
                w: rund(r.width),
                h: rund(r.height),
                top: rund(r.top),
                bottom: rund(r.bottom),
                right: rund(r.right),
            }
        }

        // The FIXED bar, not the rail form of the same component: `bottom-nav.blade.php`
        // renders both under the same `aria-label`, and only the fixed one covers content.
        const bar =
            [...document.querySelectorAll<HTMLElement>('nav[aria-label="Hauptnavigation"]')].find(
                (nav) => getComputedStyle(nav).position === 'fixed' && nav.checkVisibility(),
            ) ?? null
        const fuss = document.querySelector<HTMLElement>('[data-pm-fuss]')
        const se = document.scrollingElement as HTMLElement
        const kante = bar ? bar.getBoundingClientRect().top : window.innerHeight
        const f = fuss?.getBoundingClientRect() ?? null

        return {
            viewport: { w: window.innerWidth, h: window.innerHeight },
            docScrollWidth: se.scrollWidth,
            docClientWidth: se.clientWidth,
            docScrollTop: rund(se.scrollTop),
            navVariable: getComputedStyle(document.documentElement).getPropertyValue('--group-nav-h').trim(),
            bar: bar ? { ...(kasten(bar) as Kasten), visible: bar.checkVisibility() } : null,
            fuss: kasten(fuss),
            bestaetigen: kasten(document.querySelector('[data-pm-oeffnen]')),
            veroeffentlichen: kasten(document.querySelector('[data-pm-relay-publish]')),
            overlapPx:
                f && bar
                    ? rund(
                          Math.max(
                              0,
                              Math.min(f.bottom, bar.getBoundingClientRect().bottom) -
                                  Math.max(f.top, bar.getBoundingClientRect().top),
                          ),
                      )
                    : 0,
            unterKantePx: f ? rund(Math.max(0, f.bottom - kante)) : 0,
        }
    })
}

test('the new-conversation footer clears the bottom bar: measured at 375 px and 1280 px', async ({ page }) => {
    await useZooid(page)
    await loginNsec(page, NSEC)
    await page.goto('/postfach?ansicht=direkt')
    await expect(page.locator('[data-pm-liste]')).toBeVisible({ timeout: 45_000 })

    // Three widths and not the project default. 320 px is the one WCAG 1.4.10 names for
    // reflow, 375 px is the phone the defect was reported from, 1280 px is the first
    // width at which the web host drops the bar entirely.
    //
    // The HEIGHT is part of the measurement and not a decoration: measured with the fix
    // removed, the same card at 375 × 800 put its action row at y 716–748 against a bar
    // at y 740 — an overlap of 8 px, where 375 × 667 gives 109 px. A width on its own
    // does not reproduce a vertical overlap.
    for (const [breite, hoehe] of [
        [320, 667],
        [375, 667],
        [1280, 800],
    ] as const) {
        await page.setViewportSize({ width: breite, height: hoehe })

        // Start every width from a page at rest and at the top. `dispatchEvent` and not
        // `click()` throughout this case: Playwright scrolls an element into view before
        // clicking it, and that scroll is indistinguishable from the one the fix
        // performs. The first version of this file used `click()` and stayed GREEN with
        // the fix removed — it was measuring its own driver.
        await settle(page)
        await page.evaluate(() => document.scrollingElement!.scrollTo(0, 0))
        await page.locator('[data-pm-neu]').dispatchEvent('click')
        await expect(page.locator('[data-pm-picker]')).toBeVisible({ timeout: 20_000 })
        const vorschlag = page.locator('[data-pm-vorschlag]').first()
        await expect(vorschlag, 'the space directory is empty — this case would measure a bare card').toBeVisible({
            timeout: 30_000,
        })
        await settle(page)

        // ── State A: the card as it stands the moment it opens ───────────────────────
        const offen = await messeFuss(page)
        console.log(`[pm-fuss ${breite}x${hoehe} open] ${JSON.stringify(offen)}`)

        // ── State B: after picking somebody, from a page scrolled back to the top ────
        // The chip row is what grows the card past the space below it — that is the
        // state in the report's screenshot. Scrolled back to the top first, so this state
        // does not inherit the scroll that state A already earned.
        await page.evaluate(() => document.scrollingElement!.scrollTo(0, 0))
        await vorschlag.dispatchEvent('click')
        await expect(page.locator('[data-pm-picker] button[aria-label*="Auswahl"]')).toHaveCount(1)
        await settle(page)
        const gewaehlt = await messeFuss(page)

        // Logged by the RUN, not written into a comment: a number in a comment is a claim
        // about a past build, a number in the output is this build.
        console.log(`[pm-fuss ${breite}x${hoehe} picked] ${JSON.stringify(gewaehlt)}`)

        for (const [zustand, gemessen] of [
            ['open', offen],
            ['picked', gewaehlt],
        ] as const) {
            const wo = `${breite}x${hoehe}/${zustand}`
            expect(gemessen.viewport.w, `${wo}: the viewport is not the one this case asked for`).toBe(breite)
            expect(gemessen.fuss, `${wo}: the action row of the picker is missing`).not.toBeNull()
            expect(gemessen.bestaetigen, `${wo}: the confirm button is missing`).not.toBeNull()

            if (breite < 1280) {
                // The control for everything below: without a bar, "no overlap" says nothing.
                expect(gemessen.bar, `${wo}: there is no fixed bottom bar — the case is vacuous`).not.toBeNull()
                expect(gemessen.bar!.visible, `${wo}: the bar is in the DOM but not rendered`).toBe(true)
                // The mechanism, not just its outcome: the variable IS the bar's height.
                expect(gemessen.navVariable, `${wo}: the bar does not publish its measured height`).toBe(
                    `${Math.round(gemessen.bar!.h)}px`,
                )
            } else {
                // The web host drops the bar at `xl` (`xl:hidden`) — its absence is
                // asserted, not assumed, and the variable has to follow it to zero.
                expect(gemessen.bar, `${wo}: a fixed bottom bar is still rendered at 1280 px`).toBeNull()
                expect(gemessen.navVariable, `${wo}: the height variable did not follow the hidden bar to 0`).toBe(
                    '0px',
                )
            }

            expect(gemessen.overlapPx, `${wo}: the action row is overlapped by the bottom bar`).toBe(0)
            expect(gemessen.unterKantePx, `${wo}: the action row reaches past the usable bottom edge`).toBe(0)
            expect(gemessen.bestaetigen!.top, `${wo}: the confirm button is scrolled off the top edge`).toBeGreaterThanOrEqual(0)

            // WCAG 1.4.10 — no horizontal document scroll at all, at any of the three
            // widths. This stood at "at most 31 px" while `[data-pm-relay-publish]`
            // still carried Flux's `whitespace-nowrap`: the button shrink-wrapped to a
            // constant 373 px and pushed `scrollWidth` to 406 against 320 and 375 px of
            // client width. 320 px is the width the criterion names, and it is measured
            // here because the old ceiling of 31 px was read at 375 px, where the same
            // defect is only a third as wide.
            expect(gemessen.docScrollWidth, `${wo}: the page scrolls sideways`).toBe(gemessen.docClientWidth)

            // The button that used to do the overflowing, measured as a target rather
            // than only as a page-width number: it may not fix the reflow by shrinking
            // out of WCAG 2.5.8 (24 × 24). It wraps to two lines below 1280 px and
            // therefore GROWS — 254 × 52 at 320 px, 309 × 52 at 375 px, 373 × 32 at
            // 1280 px. Asserted as bounds, not as literals, so a translation with
            // different word lengths does not turn this red for the wrong reason.
            expect(
                gemessen.veroeffentlichen,
                `${wo}: the delivery-address button is missing — the target check below would be vacuous`,
            ).not.toBeNull()
            expect(gemessen.veroeffentlichen!.w, `${wo}: the button fell below the 24 px target width`).toBeGreaterThanOrEqual(24)
            expect(gemessen.veroeffentlichen!.h, `${wo}: the button fell below the 24 px target height`).toBeGreaterThanOrEqual(24)
            expect(
                gemessen.veroeffentlichen!.right,
                `${wo}: the button still runs past the right edge of the viewport`,
            ).toBeLessThanOrEqual(gemessen.docClientWidth)
        }

        await page.locator('[data-pm-picker] button:has-text("Abbrechen")').click()
        await expect(page.locator('[data-pm-picker]')).toHaveCount(0)
    }
})
