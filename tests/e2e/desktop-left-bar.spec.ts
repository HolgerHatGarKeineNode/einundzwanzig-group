/**
 * **„Deine Leiste" at 1440 × 900 — Start, the pins, and the keyboard (P6/D10).**
 *
 * Plan: `docs/plans/2026-09-17T1946-revamp-ein-eingang.md`, decision D10.
 *
 * The `desktop-` prefix puts this file in the `desktop` project (1440 × 900) and keeps it out
 * of the 1279 px suite, where this column does not exist at all — `desktop-rail.blade.php`
 * hangs in a `<template x-if="$store.viewport?.desktop">`.
 *
 * ── The division of labour with its neighbours ───────────────────────────────────────
 *
 * `desktop-rail-groups.spec.ts` measures the ROOM GROUPS in this column (collapsing, the
 * search field, the scope chip); this file measures what P6 put ABOVE them and the one thing
 * the reshape could have broken without a single test turning red: Alt+↑/↓.
 *
 * ── What only a run can answer ──────────────────────────────────────────────────────
 *
 *  1. **the order is the rendered order** — Start, then the pins, then the groups. The server
 *     test checks the order in the HTML string; a `flex-col` and a stray `order-*` would make
 *     that a different answer from the one the eye gets;
 *  2. **a pin made in this column appears in it** — through the real affordance (the row's
 *     menu), not by writing to the store. That path crosses `pinWriteRoute`, the Alpine store
 *     and the rendered section;
 *  3. **Alt+↑/↓ still switches rooms** — the jump list is built in `js/rail.ts` from the
 *     groups, and P6 put two blocks of non-room rows above them. If they had slipped into
 *     `railTargets`, the keyboard would now walk over Start and every pin, and nothing else
 *     in the suite would have noticed.
 */
import { test, expect, type Page } from './support/fixtures'
import { useZooid } from './support/zooid'
import { loginNsec } from './support/login'

const NSEC = process.env.NOSTR_TEST_NSEC as string

const leiste = (page: Page) => page.locator('[data-rail]')
const startZeile = (page: Page) => leiste(page).locator('[data-rail-start]')
const pins = (page: Page) => leiste(page).locator('[data-rail-pins]')

/** A room row in this column, by the room's name. */
const raumZeile = (page: Page, name: string) => leiste(page).getByRole('button', { name: new RegExp(name) }).first()

async function offen(page: Page): Promise<void> {
    await useZooid(page)
    await loginNsec(page, NSEC)
    await expect(leiste(page)).toBeVisible({ timeout: 25_000 })
}

/** The `y` of an element in this column — the rendered order, not the source order. */
const y = async (locator: ReturnType<typeof startZeile>): Promise<number> => {
    const box = await locator.boundingBox()
    if (box === null) {
        throw new Error('element has no box — it is not rendered, and the order would be unmeasurable')
    }

    return box.y
}

test('Start stands at the top of the column, above the room groups — and it leads to Start', async ({ page }) => {
    await offen(page)
    await expect(startZeile(page)).toBeVisible()

    // The group heads are the first thing of the SPACE in this column; Start is the client's
    // own surface and belongs above them.
    const gruppenkopf = leiste(page).locator('[data-rail-gruppenkopf], [aria-controls^="rail-group-"]').first()
    await expect(gruppenkopf).toBeVisible({ timeout: 25_000 })
    const [yStart, yGruppe] = [await y(startZeile(page)), await y(gruppenkopf)]
    console.log(`[P6] left bar: Start at y=${yStart}, first group head at y=${yGruppe}`)
    expect(yStart).toBeLessThan(yGruppe)

    await startZeile(page).click()
    await page.waitForURL('**/start')
    // And the column survives the SPA navigation — it is mounted outside the page's slot.
    await expect(startZeile(page)).toBeVisible({ timeout: 25_000 })
})

test('a room pinned in this column appears as a pin in it — and leaves again', async ({ page }) => {
    // Two toggles, each with a 2 s debounced publish behind it.
    test.setTimeout(120_000)
    await offen(page)

    // The starting point is not „empty": `config('group.default_pins')` seeds `area:wallet`
    // LOCALLY on every fresh profile (`pinSetSync.ts`, never published — R2). So the section
    // stands from the first paint, and what this case measures is the TRANSITION: one row
    // more, then one row fewer.
    await expect(pins(page)).toBeVisible({ timeout: 25_000 })
    const vorher = await pins(page).getByRole('link').count()
    expect(vorher, 'the local default seed is the calibration of this case').toBeGreaterThanOrEqual(1)

    const zeile = raumZeile(page, 'Willkommen')
    await expect(zeile).toBeVisible({ timeout: 25_000 })
    // The menu only exists on hover/focus (`opacity-0 group-hover/row:opacity-100`) — the
    // affordance of a 32 px row. Hover the ROW, then open its menu.
    await zeile.hover()
    await leiste(page).getByRole('button', { name: /Einstellungen für Willkommen/ }).click()
    await page.getByRole('menuitem', { name: 'Raum anheften' }).click()

    // Located by the KEY and not by the label: the label is resolved from `roomsById` and
    // arrives with the room's kind 39000, so a name-based locator would measure how fast the
    // relay answered. The key is what the pin IS.
    const pinZeile = pins(page).locator('[data-pin-chip^="room:welcome@"]')
    await expect(pinZeile).toBeVisible({ timeout: 25_000 })
    expect(await pinZeile.getAttribute('href'), 'a pinned room leads to the room').toContain('/rooms/welcome')
    console.log(
        `[P6] pin rows after the toggle: ${JSON.stringify(
            await page.evaluate(() => {
                const store = (window as unknown as {
                    Alpine: { store(n: string): { rows: { key: string; label: string }[] } }
                }).Alpine.store('pinSet')

                return store.rows.map((row) => `${row.key} → ${row.label}`)
            }),
        )}`,
    )
    // The row carries the room's NAME — „Willkommen", not the raw `h` „welcome".
    //
    // P6 measured the opposite here and reported it: `pinRows` (`js/pinSetSync.ts`) looked
    // the label up with `roomsById.get(parts.h)`, while that index is keyed by
    // `makeRoomId(url, h)` (`js/groups.ts`), so the lookup could never hit and every pinned
    // room fell back to its `h` — on Start's chips just the same. P7 fixed it
    // (`roomPinLookup`, unit cases in `js/roomPinLabel.test.ts`), and this is the behaviour
    // half: the name arrives with the room's kind 39000, which no unit test can wait for.
    await expect(pinZeile).toHaveText(/Willkommen/, { timeout: 25_000 })

    // The pins sit ABOVE the groups and BELOW Start — the order D10 asks for, measured on the
    // rendered boxes.
    const gruppenkopf = leiste(page).locator('[aria-controls^="rail-group-"]').first()
    const [yStart, yPins, yGruppe] = [await y(startZeile(page)), await y(pins(page)), await y(gruppenkopf)]
    console.log(`[P6] left bar order: Start y=${yStart} · pins y=${yPins} · groups y=${yGruppe}`)
    expect(yStart).toBeLessThan(yPins)
    expect(yPins).toBeLessThan(yGruppe)

    // And back: removing it takes the row out again — **through the same menu it was made
    // with.** The set keeps a TOMBSTONE rather than dropping the key (`js/pinSet.ts`), which
    // is invisible here on purpose: what the surface has to show is nothing.
    //
    // ── This half is the regression test of the third P6 finding ────────────────────────
    // Until P7 the menu never offered „Anheftung des Raums aufheben" in an installation
    // WITHOUT a configured workspace: `js/rail.ts` armed the pin set inside
    // `if (hasWorkspace())`, so `this.pinned` stayed `[]` and `isPinned(room)` was always
    // false — the entry kept saying „anheften" however often it was pressed. Every spec using
    // `useZooid()` runs in exactly that configuration (it blanks `__nostrWorkspace` on
    // purpose), and so does any space without a Buzz workspace. P6 therefore had to remove
    // the pin through `$store.pinSet.toggle()`; that detour is gone with the defect.
    await zeile.hover()
    await leiste(page).getByRole('button', { name: /Einstellungen für Willkommen/ }).click()
    await page.getByRole('menuitem', { name: 'Anheftung des Raums aufheben' }).click()
    await expect(pinZeile).toHaveCount(0, { timeout: 25_000 })
    await expect
        .poll(async () => pins(page).getByRole('link').count(), { timeout: 25_000 })
        .toBe(vorher)
})

test('Alt+↑/↓ still switches rooms — and walks rooms only', async ({ page }) => {
    test.setTimeout(120_000)
    await offen(page)
    await page.goto('/rooms/welcome')
    await expect(leiste(page)).toBeVisible({ timeout: 25_000 })
    await expect(raumZeile(page, 'Willkommen')).toBeVisible({ timeout: 25_000 })

    // Down: the next row of the jump list. WHICH room comes next is a property of the seed and
    // of `RAIL_GROUP_ORDER`; what is asserted is that it is a ROOM and a different one — a
    // literal name here would pin the seed instead of the keyboard.
    await page.keyboard.press('Alt+ArrowDown')
    await page.waitForURL(/\/rooms\/(?!welcome)[^/?#]+/, { timeout: 25_000 })
    const runter = new URL(page.url()).pathname
    console.log(`[P6] Alt+ArrowDown from /rooms/welcome → ${runter}`)
    expect(runter, 'Alt+↓ must land on a ROOM, not on Start and not on a pin').toMatch(/^\/rooms\/[^/]+$/)

    // Up again: back to where we came from. This is the half that would break if Start or a
    // pin had slipped into `railTargets` — the step would then land on a non-room row and the
    // address would stop being a room.
    await page.keyboard.press('Alt+ArrowUp')
    await page.waitForURL('**/rooms/welcome', { timeout: 25_000 })
    console.log(`[P6] Alt+ArrowUp → ${new URL(page.url()).pathname}`)
})
