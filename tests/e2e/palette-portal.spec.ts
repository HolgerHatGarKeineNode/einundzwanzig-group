/**
 * P4/D6 — the Portal sections of the command palette, and the two wallet actions.
 *
 * ── The one promise that needs a BROWSER to be measured ──────────────────────────
 * „The typed query never leaves the device." Every other test of this feature can be
 * written server-side; this one cannot, because it is an assertion about what does NOT
 * happen on the network while somebody types. It is measured with a request listener over
 * the whole palette session: one index load, and nothing after it.
 *
 * ── Why the index is stubbed and not served ──────────────────────────────────────
 * The E2E stack is hermetic — no foreign origin may be reached (`relayGuard`), and the
 * association portal is a foreign origin. The endpoint itself (its ETag, its throttle, the
 * session-less route, the mapping) is measured in Pest (`PortalSeitenTest`,
 * `PortalCatalogTest`); what is left for the browser is the ISLAND, and for that a stub
 * with known rows is the sharper instrument: the assertions can name the row they expect.
 */
import { test, expect, type Page } from './support/fixtures'
import { useZooid } from './support/zooid'
import { loginNsec } from './support/login'

const NSEC = process.env.NOSTR_TEST_NSEC as string

const INDEX_PATH = '/suche/portal-index'

/** The stub index — two rows per section, with names nothing else on the page carries. */
const INDEX = {
    v: 1,
    status: 'fresh',
    rows: [
        { t: 'meetup', r: 'graz-testmeetup', n: 'Graz Testmeetup', s: 'Graz · AT', d: '2026-10-02 19:00' },
        { t: 'meetup', r: 'kempten-testmeetup', n: 'Kempten Testmeetup', s: 'Kempten · DE', d: '' },
        { t: 'event', r: 'graz-testmeetup', n: 'Graz Testmeetup', s: 'Gasthof Testpost', d: '2026-10-02 19:00' },
        { t: 'course', r: '44', n: 'Testkurs Grundlagen', s: 'Johanna Testreferentin', d: '2026-11-25 17:30' },
        { t: 'lecturer', r: '144', n: 'Johanna Testreferentin', s: 'test.example', d: '2026-11-25 17:30' },
    ],
}

const paletteDialog = (page: Page) => page.locator('dialog[data-modal="command-palette"]')
const paletteInput = (page: Page) => page.locator('[data-palette-input]')
const heading = (page: Page, key: string) => page.locator(`[data-palette-heading="${key}"]`)
const visibleSection = (page: Page, key: string) => page.locator(`[data-palette-section="${key}"]:not([data-hidden])`)

/**
 * Stub the index and count every request the page makes from that moment on.
 *
 * The counter records the FULL url of each request, not just a number: a failure has to say
 * WHAT was requested, otherwise the next reader starts from zero.
 */
async function stubIndex(page: Page): Promise<{ index: () => number; alle: () => string[] }> {
    let indexCalls = 0
    const alle: string[] = []

    await page.route(`**${INDEX_PATH}*`, async (route) => {
        indexCalls += 1
        await route.fulfill({
            status: 200,
            contentType: 'application/json; charset=utf-8',
            headers: { ETag: '"stub"', 'Cache-Control': 'public, max-age=300' },
            body: JSON.stringify(INDEX),
        })
    })

    page.on('request', (request) => {
        alle.push(request.url())
    })

    return { index: () => indexCalls, alle: () => alle }
}

async function openApp(page: Page): Promise<void> {
    await useZooid(page)
    await loginNsec(page, NSEC)
    await expect(page.getByText('Start').first()).toBeVisible({ timeout: 15_000 })
}

async function openPalette(page: Page): Promise<void> {
    await page.keyboard.press('Meta+K')
    await expect(paletteDialog(page)).toBeVisible({ timeout: 10_000 })
}

test('the four Portal sections appear with the typed name — out of ONE index load', async ({ page }) => {
    const zaehler = await stubIndex(page)
    await openApp(page)
    await openPalette(page)

    // The index is loaded on the FIRST opening (`_ensureData`), not on every page.
    await expect.poll(() => zaehler.index(), { timeout: 10_000 }).toBe(1)

    await paletteInput(page).fill('test')

    // All four sections carry a row, and each row is the one the stub named.
    await expect(visibleSection(page, 'meetups')).toHaveCount(2)
    await expect(visibleSection(page, 'events')).toHaveCount(1)
    await expect(visibleSection(page, 'courses')).toHaveCount(1)
    await expect(visibleSection(page, 'lecturers')).toHaveCount(1)
    // A heading without a visible row underneath is a lie about the result — the island
    // derives their visibility from Flux' own `[data-hidden]`.
    for (const key of ['meetups', 'events', 'courses', 'lecturers']) {
        await expect(heading(page, key)).toBeVisible()
    }
    await expect(page.locator('[data-palette-portal="course:44"]')).toBeVisible()
})

test('typing issues NO further request — the query stays on the device (D6)', async ({ page }) => {
    const zaehler = await stubIndex(page)
    await openApp(page)
    await openPalette(page)
    await expect.poll(() => zaehler.index(), { timeout: 10_000 }).toBe(1)

    // Everything up to here may have requested whatever it needed (page, assets, relay).
    // From here on the only thing that happens is typing.
    const vorher = zaehler.alle().length

    for (const stueck of ['g', 'r', 'a', 'z', ' ', 't', 'e', 's', 't']) {
        await paletteInput(page).press(stueck === ' ' ? 'Space' : stueck)
    }
    await expect(visibleSection(page, 'meetups')).toHaveCount(1)

    // The index was NOT asked again …
    expect(zaehler.index()).toBe(1)
    /*
     * … and nothing else went out either.
     *
     * **A lazily imported bundle chunk of the page's own boot does not count, and that is
     * not a softening.** `js/readState.ts` imports `readStateSync.ts` dynamically as the
     * read state comes up — on a slow worker that chunk arrives WHILE this loop types, and
     * the case then failed with `…/build/assets/readStateSync-*.js` in its list (measured
     * in the P7 sweep). Its arrival has nothing to do with the keystrokes: it is scheduled
     * before the palette is even open.
     *
     * What the promise is about is the QUERY, so the assertion says exactly that: no
     * request to anything but the app's own static assets, and no request carrying any of
     * the typed text. The second half is the one that would fall if a keystroke ever
     * reached the network — and a chunk url cannot satisfy it by accident.
     */
    const danach = zaehler.alle().slice(vorher).filter((url) => !/\/build\/assets\//.test(url))
    expect(danach, `requests after the first keystroke: ${danach.join(', ')}`).toEqual([])
    const mitText = zaehler.alle().slice(vorher).filter((url) => /graz|test/i.test(url))
    expect(mitText, `a request carried the typed text: ${mitText.join(', ')}`).toEqual([])
})

test('a scope prefix addresses one section — and it is NOT `m:`', async ({ page }) => {
    await stubIndex(page)
    await openApp(page)
    await openPalette(page)

    // `o:` is the Portal meetups, `m:` stays the chat rooms of a meetup (the collision D6
    // names). Both chips exist, and they are not the same one.
    await paletteInput(page).fill('o:')
    await expect(page.locator('[data-palette-chip]')).toContainText('Meetups im Portal')
    await expect(visibleSection(page, 'meetups')).toHaveCount(2)
    await expect(visibleSection(page, 'rooms')).toHaveCount(0)

    await page.keyboard.press('Escape')
    await paletteInput(page).fill('m:')
    await expect(page.locator('[data-palette-chip]')).toContainText('Meetups')
    await expect(page.locator('[data-palette-chip]')).not.toContainText('Portal')
    await expect(visibleSection(page, 'meetups')).toHaveCount(0)
})

test('a Portal row navigates to the package page, a date to its meetup', async ({ page }) => {
    await stubIndex(page)
    await openApp(page)
    await openPalette(page)
    await paletteInput(page).fill('graz')

    // The DATE row, deliberately: it has no page of its own (D9), so it has to land on the
    // meetup — a row that led nowhere would be the silent failure here.
    await page.locator('[data-palette-section="events"]:not([data-hidden])').first().click()

    await page.waitForURL('**/bereich/meetups/graz-testmeetup')
})

test('the two wallet actions carry their intent in the ADDRESS (D8)', async ({ page }) => {
    await stubIndex(page)
    await openApp(page)
    await openPalette(page)

    // „Rechnung erstellen" → `?aktion=empfangen`. The intent travels in the URL because in
    // the app the wallet island boots only on a full document load; an event dispatched
    // before the navigation would be gone by the time the island exists.
    await paletteInput(page).fill('Rechnung')
    await page.locator('[data-palette-action="wallet-empfangen"]').click()
    await page.waitForURL('**/bereich/wallet?aktion=empfangen')

    await openPalette(page)
    await paletteInput(page).fill('Zahlen')
    await page.locator('[data-palette-action="wallet-senden"]').click()
    await page.waitForURL('**/bereich/wallet?aktion=senden')
})
