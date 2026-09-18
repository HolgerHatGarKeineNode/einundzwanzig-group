import { test, expect, type Page } from './support/fixtures'
import { useZooid, ZOOID_WS, ZOOID_URL } from './support/zooid'
import { loginNsec } from './support/login'
import { testKeys } from './support/keys'
import { execFileSync } from 'node:child_process'

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
 * 4. **"How do I get the room out of my bar?"** (2026-09-18, the rest note
 *    "pin affordances on rooms") — every pin row in the bar and every chip on
 *    Start carried NO way out, and for a dead pin (an `h` no room list knows)
 *    there was no unpin path at all. Since the fix the row itself carries the
 *    pin toggle, and the unknown card offers "Aus der Leiste entfernen" for
 *    exactly the pin that led there. The relay round trip of the removal is
 *    measured here with `nak`, the same tool `angeheftet-postfach.spec.ts`
 *    uses — a removal that dies with the tab is no removal.
 *
 * The workspace deliberately runs WITH `__nostrWorkspace` pointed at the
 * worker relay (the pattern `workspaces.spec.ts` shows): only then do the
 * Forge group and its head render — the very case in which the report saw its
 * empty link. `useZooid` alone switches the workspace off and would measure
 * half a rail.
 */

const NSEC = process.env.NOSTR_TEST_NSEC as string
const { pk: VIEWER } = testKeys()
const NAK = process.env.NAK ?? `${process.env.HOME}/go/bin/nak`

/** `js/pinSet.ts PIN_D` — duplicated here, no import across the repo boundary. */
const PIN_D = 'einundzwanzig/pins'
const APP_DATA_KIND = '30078'
/** `js/pinSetSync.ts PUBLISH_DEBOUNCE_MS` — duplicated for the same reason. */
const PUBLISH_DEBOUNCE_MS = 2_000

type RelayEvent = { id: string; pubkey: string; kind: number; content: string; tags: string[][]; created_at: number }
type PinEntry = { on: boolean; at: number; pos: number }

/** `nak` with bounded retries — the shape `angeheftet-postfach.spec.ts` established. */
function nak(args: readonly string[], attempts = 3, timeoutMs = 5_000): string {
    let last: unknown
    for (let i = 0; i < attempts; i++) {
        try {
            return execFileSync(NAK, [...args], { timeout: timeoutMs }).toString()
        } catch (error) {
            last = error
            execFileSync('sleep', ['0.5'])
        }
    }
    throw last
}

function fetchPinEvent(): RelayEvent | undefined {
    const out = nak(['req', '-k', APP_DATA_KIND, '-a', VIEWER, '-d', PIN_D, '--auth', '--sec', NSEC, ZOOID_WS])

    return out
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as RelayEvent)
        .find((event) => event.pubkey === VIEWER && event.kind === Number(APP_DATA_KIND))
}

/** The pin map at the relay right now, or `{}` when there is no event yet. */
function pinsAtRelay(): Record<string, PinEntry> {
    const event = fetchPinEvent()
    if (!event) {
        return {}
    }
    const plaintext = nak(['decrypt', '--sec', NSEC, '--sender-pubkey', VIEWER, event.content]).trim()
    const payload = JSON.parse(plaintext) as { v: number; pins: Record<string, PinEntry> }

    return payload.pins
}

/**
 * A pin no surface can make any more: an `h` no room list carries, on a relay
 * that is neither the space nor the workspace. The relay part is deliberate —
 * `pinWriteRoute` would send a workspace key into `channel-stars` (the Buzz
 * blob) instead of the 30078 set, and this spec reads the removal back at the
 * 30078 address. The shape is the production report's: the key of a pre-P8
 * encrypted conversation, dead on every relay.
 */
const TOTER_PIN = `room:5802ffbb-1111-4222-8333-444455556666@wss://dead.pin.example/`

/**
 * Seed {@link TOTER_PIN} through the store — the only truthful way in.
 *
 * WAITS FOR `ready` FIRST, and that is not decoration: the initial read of
 * `arm()` runs up to READ_TIMEOUT_MS after the login, and a toggle inside
 * that window is WIPED when the read resolves — it captured its base BEFORE
 * the optimistic write (`pinSetSync.ts arm`/`readPinSet`). That race is a
 * product fact (a pin made in the first seconds after boot can be lost), it
 * is out of this change's scope by brief, and it is reported — here it would
 * blame the row for a store that had not finished listening.
 */
async function totenPinAnheften(page: Page): Promise<void> {
    await expect
        .poll(
            () => page.evaluate(() => {
                const store = (window as unknown as {
                    Alpine: { store(name: string): { ready: boolean } }
                }).Alpine.store('pinSet')

                return store.ready
            }),
            { message: 'the pin store never finished its initial read', timeout: 20_000 },
        )
        .toBe(true)
    await page.evaluate((key: string) => {
        const store = (window as unknown as {
            Alpine: { store(name: string): { toggle(key: string): void } }
        }).Alpine.store('pinSet')
        store.toggle(key)
    }, TOTER_PIN)
}

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

    // No matching pin → no removal button either. The card's action is an
    // affordance for exactly the pin that led here; without one there is
    // nothing to act on, and a button that only looks like a way out is the
    // same lie as the join button above (empty-state rule of this card).
    await expect(karte.getByRole('button', { name: 'Aus der Leiste entfernen' })).toHaveCount(0)

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

// ── The way OUT of the bar (rest note "pin affordances on rooms") ──────────────

test('A dead pin row carries its own unpin — gone, and still gone after a reload', async ({ page }) => {
    // One store-injected pin, one unpin with a debounced publish behind it, one
    // `nak` round trip, one hard reload.
    test.setTimeout(150_000)
    await aufsetzen(page)
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/bereich/chat')
    await expect(rail(page)).toBeVisible({ timeout: 20_000 })

    // The report's situation: a pin whose room appears in NO list — so no room
    // tile, no row menu, and until the fix no unpin path at all. No surface can
    // MAKE this pin any more (every pin affordance works from a known object),
    // so the row is seeded through the store — the same detour
    // `desktop-left-bar.spec.ts` had to take while the row menu was broken.
    await totenPinAnheften(page)
    const zeile = rail(page).locator('[data-rail-pins]').locator(`[data-pin-chip="${TOTER_PIN}"]`)
    await expect(zeile, 'the dead pin has no row in the bar').toBeVisible({ timeout: 25_000 })

    // The affordance of the ROW: hidden at rest, revealed on hover — the
    // reserved-column pattern of `rail-room-row`. The state it shows is
    // "pinned" (every row in this list is), the press takes the row out.
    const loeser = rail(page).locator(`[data-pin-toggle][data-pin-key="${TOTER_PIN}"]`)
    await expect(loeser).toHaveAttribute('aria-pressed', 'true')
    await zeile.hover()
    await loeser.click()
    await expect(zeile, 'the row survived its own unpin press').toHaveCount(0, { timeout: 25_000 })

    // The removal has to OUTLIVE the tab: `pinSetSync` keeps a tombstone
    // (`on:false`) in the 30078 payload, and a missing key would bring the pin
    // back on the next merge. `nak` exits 0 even when the relay refused the
    // event, so the re-read is the proof — the rule `angeheftet-postfach.spec.ts`
    // established for the pin direction.
    await expect
        .poll(() => pinsAtRelay()[TOTER_PIN]?.on ?? null, {
            message: `the removal never reached ${ZOOID_WS} (d=${PIN_D}) within ${PUBLISH_DEBOUNCE_MS} ms + publish`,
            timeout: 40_000,
            intervals: [1_000],
        })
        .toBe(false)

    // Hard reload — read back from the relay and decrypted, not carried in the
    // tab's memory. This is the exact moment of the report ("again after a
    // reload" was never tested for the removal before).
    await page.goto('/bereich/chat')
    await expect(rail(page)).toBeVisible({ timeout: 20_000 })
    await expect(
        rail(page).locator(`[data-pin-chip="${TOTER_PIN}"]`),
        'the dead pin came back after the reload',
    ).toHaveCount(0, { timeout: 25_000 })

    await page.screenshot({ path: 'test-results/orientierung-rail-unpin.png' })
})

test('The unknown card removes exactly the pin that led there — and lands on Start', async ({ page }) => {
    test.setTimeout(120_000)
    await aufsetzen(page)
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/bereich/chat')
    await expect(rail(page)).toBeVisible({ timeout: 20_000 })

    await totenPinAnheften(page)
    const zeile = rail(page).locator('[data-rail-pins]').locator(`[data-pin-chip="${TOTER_PIN}"]`)
    await expect(zeile).toBeVisible({ timeout: 25_000 })
    // The row leads to the dead end of the report — the very click a user with
    // this pin makes.
    expect(await zeile.getAttribute('href')).toContain('/rooms/5802ffbb-1111-4222-8333-444455556666')
    await zeile.click()

    const karte = page.locator('[data-room-unbekannt-karte]')
    await expect(karte).toBeVisible({ timeout: 20_000 })
    const loesen = karte.getByRole('button', { name: 'Aus der Leiste entfernen' })
    await expect(loesen, 'the card offers no way out of the bar for the pin that led here').toBeVisible()
    await loesen.click()

    // Soft navigation (Livewire.navigate): the debounced publish survives the
    // page change, and Start is where the bar shows the result.
    await page.waitForURL('**/start', { timeout: 15_000 })
    await expect(rail(page).locator(`[data-pin-chip="${TOTER_PIN}"]`)).toHaveCount(0, { timeout: 25_000 })

    await page.screenshot({ path: 'test-results/orientierung-raum-unbekannt-loesen.png' })
})
