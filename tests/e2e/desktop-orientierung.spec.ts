import { test, expect, type Page } from './support/fixtures'
import { useZooid, ZOOID_URL } from './support/zooid'
import { loginNsec } from './support/login'

/**
 * ORIENTATION IN THE DESKTOP SHELL — the permanent form of the throwaway probe
 * from 2026-09-18 (`rail-bereich-diagnose.spec.ts`, a production user report).
 *
 * Three symptoms, and all three are nailed down here as promises:
 *
 * 1. **"Why do I have this in my bar?"** — the `</>` icon link to the Forge
 *    overview, empty textContent, named only via `aria-label`. In a column
 *    where every row carries text it read as an intruder; it is removed (the
 *    reasoning sits at its former place in `rail-group.blade.php`). The rule
 *    that remains, and that is checked here, is the one from the report: NO
 *    interactive row of the rail without visible text AND without an
 *    `aria-label`. Deliberately icon-only WITH `aria-label` (chevrons, the
 *    loupe) stays allowed — that is the standard disclosure affordance, not a
 *    place target.
 *
 * 2. **"A /rooms/{h} link leads to nothing"** — a pin onto a NIP-17
 *    conversation carries a key in its `h` field that no relay knows. The room
 *    page answered with the empty-room card plus a join button, both promises
 *    that do not hold. Since the fix it shows its unknown state with a way
 *    back. `raumUnbekannt` is pure presentation on the room list the island
 *    subscribes to anyway — no decryption logic.
 *
 * 3. **"On desktop the room list is gone"** — Concept C takes the list from
 *    the stage at `xl` (the rail carries it; `desktop-rail-groups.spec.ts`
 *    test 5 holds that). Without a hint the card read as broken; since the
 *    fix one line in the surface's side-note voice stands, ONLY from `xl` up.
 *
 * The workspace deliberately runs WITH `__nostrWorkspace` pointed at the
 * worker relay (the pattern `workspaces.spec.ts` shows): only then do the
 * Forge group and its head render — the very case in which the report saw its
 * empty link. `useZooid` alone switches the workspace off and would measure
 * half a rail.
 */

const NSEC = process.env.NOSTR_TEST_NSEC as string

const rail = (page: Page) => page.locator('[data-rail]')

async function aufsetzen(page: Page): Promise<void> {
    await useZooid(page)
    await page.addInitScript((url) => {
        ;(window as unknown as { __nostrWorkspace: string }).__nostrWorkspace = url
    }, ZOOID_URL)
    await loginNsec(page, NSEC)
}

/** Every interactive rail element with empty textContent, split by aria-label presence. */
const namenlose = (page: Page): Promise<{ mitLabel: number; ohneAlles: string[] }> =>
    page.evaluate(() => {
        const mitLabel: string[] = []
        const ohneAlles: string[] = []
        for (const el of document.querySelector('[data-rail]')?.querySelectorAll('a, button') ?? []) {
            if ((el.textContent ?? '').trim() !== '') {
                continue
            }
            if (el.getAttribute('aria-label')) {
                mitLabel.push(el.getAttribute('aria-label') ?? '')
            } else {
                ohneAlles.push(el.outerHTML.slice(0, 160))
            }
        }

        return { mitLabel: mitLabel.length, ohneAlles }
    })

test('The rail has no unnamed row — the icon way to the Forge overview is gone', async ({ page }) => {
    await aufsetzen(page)
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/bereich/chat')
    await expect(rail(page)).toBeVisible({ timeout: 20_000 })
    // Wait for the relay sync: groups and the Forge head must stand, or the
    // probe measures a half-built column and would be green for the wrong
    // reason.
    await expect(rail(page).locator('a[href$="/bereich/forge"]')).toBeVisible({ timeout: 20_000 })

    const befund = await namenlose(page)
    // The rule from the report: no row WITHOUT visible text AND without an
    // aria-label. (Chevron buttons and the loupe are deliberately icon-only
    // and named — they count towards `mitLabel`, so a dropped aria-label
    // shows up here instead of letting the probe pass silently.)
    expect(befund.ohneAlles, `unbenannte Zeilen: ${befund.ohneAlles.join(' | ')}`).toEqual([])

    // The measured culprit specifically: no link to the Forge overview without
    // visible text any more. The section NAME is the one labeled way.
    const uebersicht = rail(page).locator('a[href$="/bereich/forge"]')
    await expect(uebersicht).toHaveCount(1)
    await expect(uebersicht).toContainText('Forge', { ignoreCase: true })

    await page.screenshot({ path: 'test-results/orientierung-rail-1440.png' })
})

test('An unknown room h shows its honest state — with a way back', async ({ page }) => {
    await aufsetzen(page)
    await page.setViewportSize({ width: 1440, height: 900 })
    // A UUID no relay knows — the same shape as the key of a NIP-17
    // conversation from the report. The space's room list must be loaded and
    // non-empty for this (12 seed rooms), or the flag never flips.
    await page.goto('/rooms/5802ffbb-1111-4222-8333-444455556666')
    await expect(rail(page)).toBeVisible({ timeout: 20_000 })

    const karte = page.locator('[data-room-unbekannt-karte]')
    await expect(karte).toBeVisible({ timeout: 20_000 })
    await expect(karte).toContainText('Raum nicht gefunden')
    // The way back: BOTH targets, as real links (not a button that only looks
    // like one).
    await expect(karte.getByRole('link', { name: 'Zur Startseite' })).toBeVisible()
    await expect(karte.getByRole('link', { name: 'Zum Postfach' })).toHaveAttribute(
        'href',
        /\/postfach\?ansicht=direkt$/,
    )

    // And the two old lies are gone: no empty-room card, no join button (a
    // join onto an unknown h fails with `invalid: group not found`).
    await expect(page.getByText('Noch keine Nachrichten in diesem Raum.')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Beitreten' })).toHaveCount(0)

    await page.screenshot({ path: 'test-results/orientierung-raum-unbekannt.png' })
})

test('On /bereich/chat one line points to the bar from xl up — below it does not stand', async ({ page }) => {
    await aufsetzen(page)

    // Wide: the hint stands (it is the list that has gone).
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/bereich/chat')
    await expect(rail(page)).toBeVisible({ timeout: 20_000 })
    const hinweis = page.locator('[data-roomlist-rail-hinweis]')
    await expect(hinweis).toBeVisible({ timeout: 20_000 })
    await expect(hinweis).toContainText('Leiste links')
    await page.screenshot({ path: 'test-results/orientierung-bereich-chat-1440.png' })

    // Narrow: the same card shows the list itself — the hint would answer a
    // question nobody asks here. Asserting "hidden" and not "absent": the
    // mechanism is CSS (`hidden xl:block`), and a `toHaveCount(0)` would also
    // pass if someone deleted the block altogether (same reason as in
    // desktop-rail-groups test 5).
    await page.setViewportSize({ width: 1279, height: 800 })
    await expect(hinweis).toBeHidden()
    await expect(page.locator('span').filter({ hasText: /^Meine Räume$/ }).first()).toBeVisible({ timeout: 20_000 })
    await page.screenshot({ path: 'test-results/orientierung-bereich-chat-1279.png' })
})
