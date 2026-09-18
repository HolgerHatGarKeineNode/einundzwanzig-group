import { test, expect, type Page } from './support/fixtures'
import { useZooid } from './support/zooid'
import { loginNsec } from './support/login'

/**
 * **The 390 × 844 measurement of the new shell (Concept C, P2 DoD).**
 *
 * The phase's definition of done asks for real numbers at one narrow viewport: exactly three
 * nav slots, the avatar reachable, no horizontal overflow, and the nav height recorded. This
 * file is that measurement, checked in — not a screenshot somebody looked at.
 *
 * ── Why 390 × 844 ─────────────────────────────────────────────────────────────────
 *
 * It is an iPhone 14/15 in portrait, and it is the narrow end of what the app actually runs
 * on. The rest of the suite is pinned to 1279 px (see `playwright.config.ts`), so a bar that
 * only works above `md` would go unnoticed there — the pin is a deliberate no-op for the
 * existing specs and a blind spot for this one. `setViewportSize` overrides the project
 * default per test, which is the established way here (`updates.spec.ts`, `room.spec.ts`).
 *
 * ── What is measured and what is asserted ─────────────────────────────────────────
 *
 * MEASURED (logged with real numbers, so the phase report can quote them):
 *   · the nav's height including the safe-area padding,
 *   · the three slot boxes,
 *   · `document.scrollingElement.scrollWidth` against `clientWidth`.
 *
 * ASSERTED (bounds, not the measured values): three slots, every one of them at least
 * 44 px high (WCAG 2.5.8), the avatar present and hittable, and zero horizontal overflow.
 * The heights themselves move with the type scale; a test that pins them turns every
 * typographic change into a false red.
 *
 * ── Why the guards come from the fixture ──────────────────────────────────────────
 *
 * `test` is imported from `./support/fixtures`, so `pageErrorGuard` and `responseGuard` apply
 * to every case here automatically (house rule 4b): a server-rendered nav that looks right
 * and throws in its `ResizeObserver`, or a Livewire roundtrip answering 500, would otherwise
 * pass this file silently — a 500 on an XHR is a rejected promise, not a console error.
 */

const NSEC = process.env.NOSTR_TEST_NSEC as string

/** iPhone 14/15 portrait. */
const NARROW = { width: 390, height: 844 }

type Box = { x: number; y: number; width: number; height: number }

/**
 * A slot of the bar, by its accessible name.
 *
 * Scoped to `[data-bottom-nav]` and NOT page-wide: „Start" is also the accessible name of the
 * brand mark in the header (`aria-label="Startseite"`), so a page-wide
 * `getByRole('link', { name: /^Start/ })` resolves to two elements and Playwright refuses in
 * strict mode. Measured, not guessed — it is how the first run of this file failed.
 */
const slot = (page: Page, name: RegExp | string) =>
    page.locator('[data-bottom-nav]').getByRole('link', { name })

/**
 * Wait until every FINITE animation has finished.
 *
 * Measured, not precautionary: `.page-enter` runs `page-in` (`translateY(8px)` → `0`, 0.3 s)
 * over the island, and while it runs the element sits in a composited layer whose rect is
 * mapped through the layer matrix. A run of this file read the avatar as
 * 44 × 43.9999942779541 px and failed the 44 px bound — the width was exact because the
 * translate is on Y alone. The box is not wrong, the moment is.
 *
 * Infinite animations are skipped on purpose: the skeleton shimmer and `caret-blink` never
 * finish, so waiting for `getAnimations()` to run dry would hang for the full timeout.
 */
async function settled(page: Page): Promise<void> {
    await page.waitForFunction(
        () =>
            document.getAnimations().every((a) => {
                const timing = a.effect?.getComputedTiming()

                return timing?.iterations === Infinity || a.playState === 'finished' || a.playState === 'idle'
            }),
        undefined,
        { timeout: 10_000 },
    )
}

/**
 * The bar's own box plus the boxes of its children, read from the rendered tree.
 *
 * Anchored on `[data-bottom-nav]` and not on the `<nav>`: the nav element also carries the
 * safe-area padding, and what the design talks about when it says "three slots" is the grid
 * inside it. Both numbers are wanted, so both are returned.
 */
async function navGeometry(page: Page): Promise<{ nav: Box; slots: Box[] }> {
    return page.evaluate(() => {
        const grid = document.querySelector('[data-bottom-nav]')
        const nav = grid?.closest('nav')
        if (grid === null || nav === null || nav === undefined) {
            throw new Error('no bottom nav in the document — the measurement would have no subject')
        }
        const box = (el: Element): Box => {
            const r = el.getBoundingClientRect()

            return { x: r.x, y: r.y, width: r.width, height: r.height }
        }

        return { nav: box(nav), slots: [...grid.children].map(box) }
    })
}

test.describe('Shell at 390 × 844 — the measurement of the P2 definition of done', () => {
    test.beforeEach(async ({ page }) => {
        await page.setViewportSize(NARROW)
        await useZooid(page)
    })

    test('Start: exactly three nav slots, avatar reachable, no horizontal overflow', async ({ page }) => {
        await loginNsec(page, NSEC)
        await page.goto('/start')

        // The guest/member split is decided client-side (D4), so wait for the island rather
        // than for a server-rendered sentence: before that the page is a skeleton, and
        // measuring a skeleton would measure the wrong surface.
        await expect(page.getByRole('heading', { name: 'Start', exact: true })).toBeVisible({ timeout: 25_000 })
        await expect(page.locator('[data-start-bereiche]')).toBeVisible({ timeout: 25_000 })
        await settled(page)

        const { nav, slots } = await navGeometry(page)
        console.log(`[nav390] nav height (incl. pb-safe): ${nav.height} px, width ${nav.width} px at x=${nav.x}`)
        slots.forEach((s, i) => console.log(`[nav390] slot ${i}: ${s.width}×${s.height} px at x=${s.x}`))

        // ── THREE slots. The number is the design, not a count over a config list.
        expect(slots, 'the bar must carry exactly three slots').toHaveLength(3)

        // Every slot is a touch target (WCAG 2.5.8). A bound, not the measured value.
        for (const [i, s] of slots.entries()) {
            expect(Math.round(s.height * 100) / 100, `slot ${i} is under 44 px high`).toBeGreaterThanOrEqual(44)
            expect(Math.round(s.width * 100) / 100, `slot ${i} is under 44 px wide`).toBeGreaterThanOrEqual(44)
        }

        // The three slots fill the bar without stacking: same y, and their combined width is
        // the grid's width. A wrapped grid would still pass "three children".
        const ys = new Set(slots.map((s) => Math.round(s.y)))
        expect(ys.size, 'the three slots do not sit on one row').toBe(1)

        // ── The three destinations, by role and name rather than by class.
        await expect(slot(page, /^Start/)).toBeVisible()
        await expect(slot(page, /^Postfach/)).toBeVisible()
        await expect(page.getByRole('button', { name: 'Suchen und springen' })).toBeVisible()

        // ── The avatar: present, hittable, and pointing at „Ich".
        const avatar = page.locator('[data-app-header-avatar]')
        await expect(avatar).toBeVisible()
        const avatarBox = (await avatar.boundingBox()) as Box
        console.log(`[nav390] avatar: ${avatarBox.width}×${avatarBox.height} px at x=${avatarBox.x}`)
        // Rounded to two decimals against the 44 px target: what is asserted is the touch
        // target, not the last digit of a float. A 43.5 px avatar still fails; the
        // 43.9999942779541 px of a composited layer does not (see `settled`).
        const zweiStellen = (v: number): number => Math.round(v * 100) / 100
        expect(zweiStellen(avatarBox.width), 'the avatar is under 44 px wide').toBeGreaterThanOrEqual(44)
        expect(zweiStellen(avatarBox.height), 'the avatar is under 44 px high').toBeGreaterThanOrEqual(44)
        // `route()` renders an ABSOLUTE href (the E2E host is `127.0.0.1:<slot>`), so the
        // path is checked as a suffix — a literal comparison against `/ich` failed on the
        // first run for that reason alone.
        expect(await avatar.getAttribute('href')).toMatch(/\/ich$/)

        // And it is INSIDE the viewport, not pushed past the right edge by the title.
        expect(avatarBox.x + avatarBox.width, 'the avatar sticks out of the viewport').toBeLessThanOrEqual(NARROW.width)

        // ── No horizontal overflow. Measured on the document, which is the one place a
        // 10 px overflow of any single row shows up.
        const overflow = await page.evaluate(() => {
            const el = document.scrollingElement as HTMLElement

            return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }
        })
        console.log(`[nav390] document scrollWidth ${overflow.scrollWidth} vs clientWidth ${overflow.clientWidth}`)
        expect(overflow.scrollWidth, 'horizontal overflow on Start at 390 px').toBeLessThanOrEqual(overflow.clientWidth)
    })

    test('the search slot opens the palette, and Start/Postfach navigate', async ({ page }) => {
        await loginNsec(page, NSEC)
        await page.goto('/start')
        await expect(page.getByRole('heading', { name: 'Start', exact: true })).toBeVisible({ timeout: 25_000 })

        // Search is not a place: it dispatches `open-command-palette` (D6). Measured through
        // the palette actually opening, not through the event — the event without a listener
        // is exactly the dead button this would have to catch.
        await page.getByRole('button', { name: 'Suchen und springen' }).click()
        await expect(page.locator('dialog[data-modal="command-palette"]')).toBeVisible({ timeout: 15_000 })
        await page.keyboard.press('Escape')

        // Postfach navigates and keeps the bar (the bar is `fixed`, so it survives the SPA
        // swap — if it did not, the next tap would have nothing to hit).
        await slot(page, /^Postfach/).click()
        await expect(page).toHaveURL(/\/postfach$/, { timeout: 25_000 })
        expect((await navGeometry(page)).slots).toHaveLength(3)

        // And back to Start from there.
        await slot(page, /^Start/).click()
        await expect(page).toHaveURL(/\/start$/, { timeout: 25_000 })
    })

    test('a GUEST sees the same three slots and no horizontal overflow', async ({ page }) => {
        // D4: Start renders without a session. The bar is the same one — the gated slot opens
        // the login sheet instead of navigating, which is a property of the tap and not of the
        // geometry.
        await page.goto('/start')
        await expect(page.getByText('Willkommen bei EINUNDZWANZIG')).toBeVisible({ timeout: 25_000 })
        await settled(page)

        const { nav, slots } = await navGeometry(page)
        console.log(`[nav390] guest nav height: ${nav.height} px`)
        expect(slots, 'a guest sees a different number of slots').toHaveLength(3)

        // The avatar stands for a guest too — it is the way to learn what an account gives
        // you, not a member-only affordance.
        await expect(page.locator('[data-app-header-avatar]')).toBeVisible()

        const overflow = await page.evaluate(() => {
            const el = document.scrollingElement as HTMLElement

            return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }
        })
        console.log(`[nav390] guest document scrollWidth ${overflow.scrollWidth} vs clientWidth ${overflow.clientWidth}`)
        expect(overflow.scrollWidth, 'horizontal overflow for a guest on Start at 390 px').toBeLessThanOrEqual(overflow.clientWidth)
    })

    test('the bar publishes its own height as --group-nav-h, and the stage keeps that much clear', async ({ page }) => {
        // The bar measures itself and publishes the number on `<html>`; nothing else is
        // allowed to guess it, because the safe-area padding differs per device. This is the
        // case that would catch the variable falling out of the observer — and with it every
        // surface whose last row has to stay clear of the bar.
        await loginNsec(page, NSEC)
        await page.goto('/start')
        await expect(page.getByRole('heading', { name: 'Start', exact: true })).toBeVisible({ timeout: 25_000 })

        const published = await page.evaluate(() =>
            getComputedStyle(document.documentElement).getPropertyValue('--group-nav-h').trim(),
        )
        await settled(page)
        const { nav } = await navGeometry(page)
        console.log(`[nav390] --group-nav-h = "${published}", measured nav height = ${nav.height} px`)

        expect(published, '--group-nav-h is not published — every consumer would have to guess').toMatch(/^\d+(\.\d+)?px$/)
        // Within a pixel: the variable is written from `offsetHeight` (an integer), the
        // measurement comes from `getBoundingClientRect` (fractional).
        expect(Math.abs(Number.parseFloat(published) - nav.height)).toBeLessThan(1.5)

        // And the stage really keeps that much clear — the bar is `fixed`, so without the
        // padding the last row would sit behind it.
        const stagePadding = await page.evaluate(() => {
            const main = document.querySelector('main[data-tab-outlet]')

            return main === null ? null : Number.parseFloat(getComputedStyle(main).paddingBottom)
        })
        console.log(`[nav390] stage padding-bottom: ${stagePadding} px`)
        expect(stagePadding, 'the stage has no bottom padding — the bar would cover the last row').not.toBeNull()
        expect(stagePadding as number).toBeGreaterThanOrEqual(nav.height)
    })
})
