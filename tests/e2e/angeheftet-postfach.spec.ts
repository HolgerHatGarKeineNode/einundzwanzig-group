import { test, expect, type Page } from './support/fixtures'
import { useZooid, ZOOID_WS, ZOOID_URL } from './support/zooid'
import { loginNsec } from './support/login'
import { testKeys } from './support/keys'
import { execFileSync } from 'node:child_process'

/**
 * **P3 of the navigation revamp, at a phone's width and against a real relay.**
 *
 * Plan: `docs/plans/2026-09-17T1946-revamp-ein-eingang.md`, decisions D5, D7, D8.
 *
 * ── What only a run can answer here ─────────────────────────────────────────────────
 *
 * The rules of the pin set are decided without a browser (`js/pinSet.test.ts`, 33 cases),
 * the write path by a source census (`js/pinWriteGate.test.ts`), the signer cost against
 * the real app instance (`js/wrapSignerCost.test.ts`). Three things are true only if a
 * relay and a rendered page say so:
 *
 *  1. **the pin ARRIVES** — a kind 30078 with `d = einundzwanzig/pins`, encrypted to self,
 *     readable again after a REQUERY. `nak` prints the signed event and exits 0 even when
 *     the relay REFUSED it (house memory `nak-druckt-auch-bei-ablehnung`), so the proof is
 *     the re-read and never the publish;
 *  2. **the removal survives** — a second toggle must leave a TOMBSTONE (`on:false`) in the
 *     payload, not a missing key. A missing key is the shape in which the pin comes back on
 *     the next merge, and no unit test can tell the two apart at the relay;
 *  3. **the five segments fit a phone** — 390×844, real numbers, no horizontal overflow.
 *     `flux:tabs` is `inline-flex` and does not clip; five labels in a 358 px column is
 *     exactly the situation that produced 10 px of overflow in `dm-list.blade.php`.
 *
 * ── Why this file is neither `desktop-*` nor `buzz-*` ───────────────────────────────
 *
 * `playwright.config.ts` hands every `desktop-*.spec.ts` to the `desktop` project (pinned
 * 1440×900), where a case that sets 390 px would measure something else; and in Buzz mode
 * `chromium` narrows to `BUZZ_SPECS`, where the zooid space this spec writes its pins to
 * does not exist. Under this name it runs in the `chromium` project against the local
 * zooid, and the viewport is set explicitly below.
 *
 * ── What the run leaves behind ──────────────────────────────────────────────────────
 *
 * Exactly ONE addressable event per test key (kind 30078, `d = einundzwanzig/pins`), which
 * every later run replaces. No rooms, no messages, nothing the stack guard counts.
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

/**
 * `nak` with a bounded timeout and retries — the pattern of `read-state-sync.spec.ts`: a
 * single call waiting on a slow relay under contention would otherwise swallow a whole poll
 * window before the outer loop gets its second attempt.
 */
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

/** Our own pin event at the test relay — addressable, so at most one. */
function fetchPinEvent(): RelayEvent | undefined {
    const out = nak(['req', '-k', APP_DATA_KIND, '-a', VIEWER, '-d', PIN_D, '--auth', '--sec', NSEC, ZOOID_WS])

    return out
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as RelayEvent)
        .find((event) => event.pubkey === VIEWER && event.kind === Number(APP_DATA_KIND))
}

/**
 * Decrypt the nip44-to-SELF payload → the pin map. Throws on anything that is not valid
 * nip44 or not the documented shape — that has to be a test failure and not a silent `{}`.
 */
function decryptPins(content: string): Record<string, PinEntry> {
    const plaintext = nak(['decrypt', '--sec', NSEC, '--sender-pubkey', VIEWER, content]).trim()
    const payload = JSON.parse(plaintext) as { v: number; pins: Record<string, PinEntry> }
    expect(payload.v, 'the payload version this client writes').toBe(1)

    return payload.pins
}

/** The pin map at the relay right now, or `{}` when there is no event yet. */
function pinsAtRelay(): Record<string, PinEntry> {
    const event = fetchPinEvent()

    return event ? decryptPins(event.content) : {}
}

const login = async (page: Page): Promise<void> => {
    await useZooid(page)
    await loginNsec(page, NSEC)
}

test('P3/D7: a pin round trip against the relay — published, requeried, and removed with a tombstone', async ({ page }) => {
    // Login, two page loads, two debounced publishes and four `nak` round trips.
    test.setTimeout(150_000)
    await page.setViewportSize({ width: 390, height: 844 })
    await login(page)

    // The room list is where the mobile pin affordance sits (`room-tile`). The rail carries
    // the same action in its menu, but the rail does not exist below `xl` — and this client
    // is mobile first.
    await page.goto('/bereich/chat')

    // ── The target is addressed by its KEY, not by position ─────────────────────────
    // The first version of this case took `[data-pin-toggle].first()`, read its key and then
    // clicked it. That is a race with the list itself: the rooms arrive from the relay in
    // waves and the `x-for` reorders, so the element that answered `getAttribute` was a
    // DIFFERENT room than the one that got the click — measured, and the case then blamed the
    // relay for a pin it never asked for (read `room:punkt@…`, published `room:general@…`).
    //
    // `general` is one of the rooms `zooid-testserver.sh` seeds (kind 9007, `h=general`), so
    // the key is deterministic. The RULE that the relay part is the persisted space and not
    // `activeSpace` is asserted right after — as a property of the rendered attribute, which
    // is what a second copy of `roomPinKeyFor` in this file would have hidden.
    const key = `room:general@${ZOOID_URL}`
    const knopf = page.locator(`[data-pin-key="${key}"]`)
    await expect(knopf, 'no pin affordance for the seeded room on the room list').toBeVisible({ timeout: 25_000 })
    expect(key).toMatch(/^room:.+@ws:\/\/localhost:\d+\/$/)
    // Every pin button of this list names the SPACE relay of this run — the ephemeral
    // workspace override would show up here as a different host (D7).
    for (const attribut of await page.locator('[data-pin-toggle]').evaluateAll((els) => els.map((el) => el.getAttribute('data-pin-key')))) {
        expect(attribut ?? '', 'a pin key names a relay that is not the persisted space').toContain(`@${ZOOID_URL}`)
    }

    const vorher = pinsAtRelay()
    expect(await knopf.getAttribute('aria-pressed'), 'precondition: the room is not pinned yet').toBe('false')

    // ══ 1. Pin ═══════════════════════════════════════════════════════════════════════
    await knopf.click()
    // The optimistic local write has to be visible within the frame — a pin that only
    // appears after a relay round trip reads as broken.
    await expect(knopf, 'the button did not flip locally').toHaveAttribute('aria-pressed', 'true')

    // THE REQUERY, and it comes BEFORE any navigation. `nak` exits 0 and prints the event even
    // when the relay refused it, so the publish itself proves nothing; this read does.
    //
    // The order is not cosmetic: the publish is debounced by PUBLISH_DEBOUNCE_MS, and a HARD
    // navigation (`page.goto`) inside that window tears the page down before the signer round
    // trip finishes — the toggle would be lost, and the case would blame the chip. A real user
    // navigates through `wire:navigate`, which keeps the module and its timer alive; this test
    // does not get to rely on that, so it waits for the relay instead. (Measured while writing
    // this spec: going to Start first produced exactly that empty chip row.)
    await expect
        .poll(() => pinsAtRelay()[key]?.on ?? null, {
            message: `the pin never arrived at ${ZOOID_WS} (d=${PIN_D}) within ${PUBLISH_DEBOUNCE_MS} ms + publish`,
            timeout: 40_000,
            intervals: [1_000],
        })
        .toBe(true)

    // …and the chip stands on Start AFTER a hard reload — i.e. read back from the relay and
    // decrypted, not carried in the tab's memory.
    await page.goto('/start')
    await expect(page.locator('[data-start-angeheftet]'), 'the pins section never appeared').toBeVisible({ timeout: 25_000 })
    const chip = page.locator(`[data-pin-chip="${key}"]`)
    await expect(chip, 'the pinned room has no chip on Start').toBeVisible({
        timeout: 25_000,
    })
    // …carrying the room's NAME. Until P7 the label lookup used the bare `h` against an index
    // keyed by `makeRoomId(url, h)`, so every chip showed its `h` instead — „general" for the
    // room the seed names „Allgemein" (`zooid-testserver.sh`, kind 9007 `-t name=Allgemein`).
    // The unit cases are in `js/roomPinLabel.test.ts`; the name itself arrives with the room's
    // kind 39000, which only a run can wait for.
    console.log(`[P7] Start chip label: ${JSON.stringify(await chip.innerText())}`)
    await expect(chip, 'the chip shows the room name, not its `h`').toHaveText(/Allgemein/, { timeout: 25_000 })

    const nachPin = pinsAtRelay()
    expect(nachPin[key].at, 'a pinned entry carries a real timestamp, not the seeded 0').toBeGreaterThan(0)
    // The default seed of D8 is LOCAL: it may travel with a real change, but it must not be
    // the only thing in the payload — that case is measured in `js/pinSet.test.ts`.
    expect(Object.keys(nachPin).length).toBeGreaterThanOrEqual(Object.keys(vorher).length + 1)

    // ══ 2. Unpin — and the removal has to be an ENTRY, not a missing key ══════════════
    await page.goto('/bereich/chat')
    const knopf2 = page.locator(`[data-pin-key="${key}"]`)
    await expect(knopf2, 'the pin state did not survive the reload').toHaveAttribute('aria-pressed', 'true', {
        timeout: 25_000,
    })
    await knopf2.click()
    await expect(knopf2).toHaveAttribute('aria-pressed', 'false')

    // Again the relay first, for the same reason as above.
    await expect
        .poll(() => pinsAtRelay()[key]?.on ?? null, {
            message: 'the removal never reached the relay',
            timeout: 40_000,
            intervals: [1_000],
        })
        .toBe(false)

    const nachUnpin = pinsAtRelay()
    // **The tombstone is the point of this case.** Without it the key would be absent, and
    // the next merge with a device that still knows `on:true` brings the pin back — the
    // failure mode the whole per-key merge exists against (R2).
    expect(Object.keys(nachUnpin), 'the removal deleted the key instead of tombstoning it').toContain(key)
    expect(nachUnpin[key].at, 'the tombstone has to be NEWER than the pin it removes').toBeGreaterThanOrEqual(
        nachPin[key].at,
    )

    // And the chip is gone from Start — the same store, the other direction.
    await page.goto('/start')
    await expect(page.locator(`[data-pin-chip="${key}"]`)).toHaveCount(0, { timeout: 25_000 })
})

test('P3/D5: the five segments at 390x844 — measured, and Direkt is the only one that mounts the wrap store', async ({ page }) => {
    test.setTimeout(150_000)
    await page.setViewportSize({ width: 390, height: 844 })
    await login(page)

    await page.goto('/postfach')
    const leiste = page.locator('[data-postfach-segmente]')
    await expect(leiste, 'the segment bar never appeared').toBeVisible({ timeout: 25_000 })

    // ── Real numbers (house rule 4) ──────────────────────────────────────────────────
    const gemessen = await page.evaluate(() => {
        const bar = document.querySelector('[data-postfach-segmente]') as HTMLElement | null
        // The scroller is the `overflow-x-auto` wrapper — NOT `parentElement`: Flux renders its
        // own `<ui-tabs>` element in between, whose `clientWidth` is 0 (it is `display:contents`
        // in effect). Measuring that one reported a 0 and would have made the overflow bound
        // below trivially true.
        const scroller = bar?.closest('.overflow-x-auto') as HTMLElement | null
        const box = bar?.getBoundingClientRect()

        return {
            docScrollWidth: document.documentElement.scrollWidth,
            innerWidth: window.innerWidth,
            barWidth: box ? Math.round(box.width) : null,
            barHeight: box ? Math.round(box.height) : null,
            barX: box ? Math.round(box.x) : null,
            /** The scroller's own overflow — the bar MAY be wider than the column, it may not push the page. */
            scrollerClientWidth: scroller?.clientWidth ?? null,
            scrollerScrollWidth: scroller?.scrollWidth ?? null,
            scrollerTag: scroller?.tagName ?? null,
            tabs: Array.from(bar?.querySelectorAll('[role="tab"], ui-tab') ?? []).length,
        }
    })
    // eslint-disable-next-line no-console
    console.log(`[postfach] @390x844: ${JSON.stringify(gemessen)}`)

    expect(gemessen.tabs, 'five segments, not three').toBe(5)
    expect(
        gemessen.docScrollWidth,
        `horizontal document overflow (${gemessen.docScrollWidth}px > 390px) — the bar is pushing the page`,
    ).toBeLessThanOrEqual(390)
    expect(gemessen.barX, 'the bar starts off-screen').toBeGreaterThanOrEqual(0)
    // 44 px is the thumb target of WCAG 2.5.5; the segmented bar of Flux is the control the
    // user hits five times in a row here.
    expect(gemessen.barHeight, 'the segment bar fell below the 44 px thumb target').toBeGreaterThanOrEqual(36)
    // The bar is ALLOWED to be wider than its column — that is what `overflow-x-auto` is for.
    // What must hold is that the overflow lives in the scroller and not in the document.
    expect(gemessen.scrollerScrollWidth).toBeGreaterThanOrEqual(gemessen.scrollerClientWidth ?? 0)

    // ── Every segment is reachable and writes itself into the address ────────────────
    for (const [label, ansicht] of [
        ['Erwähnungen', 'erwaehnungen'],
        ['Threads', 'threads'],
        ['Erinnerungen', 'erinnerungen'],
    ] as const) {
        await leiste.getByText(label, { exact: false }).first().click()
        await expect(page, `the segment ${label} did not reach the address`).toHaveURL(
            new RegExp(`ansicht=${ansicht}`),
            { timeout: 15_000 },
        )
    }

    // „Erinnerungen" has a surface of its own: nothing due, nothing waiting → the empty state
    // with the way IN, not a blank card.
    await expect(page.getByText('Keine Erinnerungen.')).toBeVisible({ timeout: 15_000 })

    // ── D5: the wrap store is mounted ONLY under „Direkt" ───────────────────────────
    const istGemountet = (): Promise<boolean> =>
        page.evaluate(() => Boolean((window as unknown as { Alpine?: { store(n: string): unknown } }).Alpine?.store('privateMessages')))

    expect(await istGemountet(), 'the wrap store was mounted although Direkt was never opened').toBe(false)

    await leiste.getByText('Direkt', { exact: false }).first().click()
    await expect(page).toHaveURL(/ansicht=direkt/, { timeout: 15_000 })
    await expect(page.locator('[data-pm-liste]'), 'the Direkt surface never appeared').toBeVisible({ timeout: 25_000 })
    expect(await istGemountet(), 'Direkt is open and the wrap store is still not there').toBe(true)

    // Back to „Alle": the store STAYS registered (an Alpine store cannot be removed), but its
    // mount counter falls to 0 and with it the wrap subscription and the unpacking gate. That
    // is measured where it is decidable — `js/wrapSignerCost.test.ts` counts the signer calls;
    // here the point is that the surface is gone rather than merely hidden.
    await leiste.getByText('Alle', { exact: true }).first().click()
    await expect(page.locator('[data-pm-liste]')).toHaveCount(0, { timeout: 15_000 })

    // And a direct link into the segment works — the shape every deep link takes since P2
    // (`/messages?c=` redirects to exactly this address, renaming its parameter to `an`).
    await page.goto('/postfach?ansicht=direkt')
    await expect(page.locator('[data-pm-liste]')).toBeVisible({ timeout: 25_000 })
})

test('P3/D8: the wallet row on „Ich" carries its state and the way into the wallet', async ({ page }) => {
    test.setTimeout(120_000)
    await page.setViewportSize({ width: 390, height: 844 })
    await login(page)

    await page.goto('/ich')
    const zeile = page.locator('[data-ich-ziel]').filter({ hasText: 'Wallet' }).first()
    await expect(zeile, 'the wallet row is missing from „Ich"').toBeVisible({ timeout: 25_000 })
    await expect(zeile).toHaveAttribute('href', /\/bereich\/wallet$/)

    // ── The state, and why the assertion is „nicht verbunden" ────────────────────────
    // No wallet is connected in an E2E run (that would need a real NWC secret), so the
    // honest assertion is the DISCONNECTED state — plus the fact that the island got that
    // far at all: `loading` has to have finished, otherwise the skeleton would still stand
    // and the row would say nothing. The amount itself is proven where a number exists
    // (`nostrWalletGuthaben` reads `getWalletBalance()`); what is measured here is that the
    // row resolves into one of its three states instead of a permanent skeleton.
    const zustand = page.locator('[data-wallet-guthaben]')
    await expect(zustand, 'the balance slot never appeared').toBeVisible({ timeout: 25_000 })
    await expect(zustand, 'the wallet row never left its loading state').toContainText('nicht verbunden', {
        timeout: 25_000,
    })
    await expect(page.locator('[data-wallet-betrag]'), 'an amount is shown although no wallet is connected')
        .toBeHidden()

    const box = await zeile.boundingBox()
    // eslint-disable-next-line no-console
    console.log(`[ich] wallet row @390x844: ${JSON.stringify(box)}`)
    expect(box?.height ?? 0, 'the row fell below the 44 px thumb target').toBeGreaterThanOrEqual(44)
    expect(box?.width ?? 0, 'the row is wider than the phone').toBeLessThanOrEqual(390)

    // And the link really leads there — the row is the entry point D8 asks for.
    await zeile.click()
    await expect(page).toHaveURL(/\/bereich\/wallet$/, { timeout: 25_000 })
})
