import { test, expect, type Page } from './support/fixtures'
import { useZooid, ZOOID_URL, ZOOID_WS } from './support/zooid'
import { loginNsec } from './support/login'
import { testKeys } from './support/keys'
import { routeVerein, stubVereinDocument, vereinMeBody, vereinPaymentsBody } from './support/verein'
import { execFileSync } from 'node:child_process'

/**
 * **P5 of the navigation revamp — „Zusagen" and „Ich › Verein" on a phone.**
 *
 * Plan: `docs/plans/2026-09-17T1946-revamp-ein-eingang.md`, decisions D11, D12, D12a.
 *
 * ── What only a run can answer ──────────────────────────────────────────────────────
 *
 * The RSVP RULE is decided without a browser (`js/rsvpRule.ts`, 19 cases: no address,
 * cancelled, past, `attendees_public=false`, `rsvp_enabled=false`), the arm choice on the
 * server (`tests/Feature/ZusageTest.php`), the payload shapes of the association API in
 * `js/mitgliedschaftModelle.test.ts`. Four things are true only if a relay and a rendered
 * page say so:
 *
 *  1. **the kind 31925 ARRIVES** — signed in the browser, published to the calendar relay,
 *     found again by a REQUERY. `nak` prints the signed event and exits 0 even when the
 *     relay REFUSED it (house memory `nak-druckt-auch-bei-ablehnung`), so the proof is the
 *     re-read and never the publish;
 *  2. **the disclosure comes FIRST and only once** — the first press opens the sentence and
 *     holds the answer back; the second press on the same device goes straight out. Neither
 *     half is visible in the markup: the acknowledgement lives in `localStorage`;
 *  3. **the row only exists for a date the reader has a relation to** — the pin set arrives
 *     from the relay as an encrypted kind 30078, so „pinned" is relay state and not a flag;
 *  4. **both surfaces fit a phone** — 390×844, real numbers (width, height, position,
 *     overflow), not a class assertion.
 *
 * ── Why this file is neither `desktop-*` nor `buzz-*` ───────────────────────────────
 *
 * `playwright.config.ts` pins every `desktop-*.spec.ts` to 1440×900, where a case that sets
 * 390 px would measure something else; and in Buzz mode `chromium` narrows to `BUZZ_SPECS`,
 * where neither the zooid space this spec writes to nor `useZooid()` exists.
 *
 * ── What the run leaves behind ──────────────────────────────────────────────────────
 *
 * The published kind 31923/31925 are tombstoned in `afterAll`, and the pin set is left as a
 * TOMBSTONE (`on:false`) rather than deleted — a missing key is the shape in which a pin
 * comes back on the next merge. Nothing else: no rooms, no messages.
 */

const NSEC = process.env.NOSTR_TEST_NSEC as string
const { pk: VIEWER } = testKeys()
const NAK = process.env.NAK ?? `${process.env.HOME}/go/bin/nak`

/**
 * The stand-in for the PORTAL — a second identity, distinct from the logged-in reader.
 *
 * Same key and same reason as `meetup-calendar.spec.ts`: zooid refuses a verbatim,
 * foreign-signed event (`restricted: you cannot publish events on behalf of others`), so a
 * local relay cannot hold a real Portal event by construction. What the stand-in preserves
 * is the SHAPE of `NostrCalendarEventFactory::forMeetupEvent`.
 */
const PORTAL_SEC = 'b2ee09a54bedf17ee1db562bdddd75c48661d981eb52c49dc206c55ba8439414'
const PORTAL_PUB = 'da99fbe39247109327ac8504750d0227d50a8f84049ac8bd2f6c7ad0806ed76d'

/** The meetup the reader pins — one of the rooms `zooid-testserver.sh` seeds. */
const MEETUP = { slug: 'meetup-berlin-e2e', name: 'Meetup Berlin' }

/** `js/pinSet.ts PIN_D` / `js/rsvpRule.ts RSVP_DISCLOSURE_KEY` — duplicated, no cross-repo import. */
const PIN_D = 'einundzwanzig/pins'
const APP_DATA_KIND = '30078'
const DISCLOSURE_KEY = 'e21:rsvp:hinweis'

const nak = (args: readonly string[]): string => {
    try {
        return execFileSync(NAK, [...args], { encoding: 'utf8', timeout: 30_000, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (error) {
        return String((error as { stdout?: string }).stdout ?? '') + String((error as { stderr?: string }).stderr ?? '')
    }
}

/** Everything this file put on the relay, so `afterAll` can tombstone it. */
const published: { id: string; sec: string }[] = []

/** `Y-m-d H:i` in LOCAL time — the form the Portal index carries (`nowIndexKey`). */
const indexDate = (at: Date): string => {
    const pad = (value: number): string => String(value).padStart(2, '0')

    return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`
}

/** Publish a Portal-shaped kind 31923 and prove by REQUERY that the relay took it. */
const publishDate = (dTag: string, title: string, start: number): string => {
    nak([
        'event', '--auth', '--sec', PORTAL_SEC, '-k', '31923',
        '-d', dTag,
        '-t', `title=${title}`,
        '-t', `start=${start}`,
        '-t', `D=${Math.floor(start / 86400)}`,
        '-t', 'start_tzid=Europe/Vienna',
        '-t', `a=31924:${PORTAL_PUB}:meetup-${MEETUP.slug}`,
        '-t', 'location=Bar 21',
        ZOOID_WS,
    ])

    const back = nak(['req', '-k', '31923', '-d', dTag, '--auth', '--sec', PORTAL_SEC, ZOOID_WS])
    const id = /"id":"([0-9a-f]{64})"/.exec(back)?.[1] ?? ''
    expect(id, `the date \`${dTag}\` was not accepted by the relay`).toMatch(/^[0-9a-f]{64}$/)
    published.push({ id, sec: PORTAL_SEC })

    return id
}

/**
 * Seed the reader's pin set AT THE RELAY — an encrypted kind 30078, exactly the shape
 * `js/pinSetSync.ts` writes (`{ v: 1, pins: { <key>: { on, at, pos } } }`, nip44 to self).
 *
 * Seeded rather than clicked: the pin affordance sits on the meetup TILE, and that tile
 * needs the Portal catalog — a foreign origin this hermetic stack does not reach. What the
 * surface under test needs from a pin is only its presence in the relay state.
 */
const seedPin = (on: boolean): void => {
    const payload = JSON.stringify({
        v: 1,
        pins: { [`meetup:${MEETUP.slug}`]: { on, at: Math.floor(Date.now() / 1000), pos: 1 } },
    })
    const content = nak(['encrypt', '--sec', NSEC, '--recipient-pubkey', VIEWER, payload]).trim()
    expect(content, 'nip44 encryption produced nothing').not.toBe('')
    nak(['event', '--auth', '--sec', NSEC, '-k', APP_DATA_KIND, '-d', PIN_D, '-c', content, ZOOID_WS])

    const back = nak(['req', '-k', APP_DATA_KIND, '-a', VIEWER, '-d', PIN_D, '--auth', '--sec', NSEC, ZOOID_WS])
    expect(back, 'the pin set is not on the relay — the row can never appear').toContain('"kind":30078')
}

/** The Start row's own state, read out of Alpine by NAME (a spread of the proxy comes back `{}`). */
const startRow = (page: Page): Promise<{ address: string; name: string; dateLabel: string; location: string }> =>
    page.evaluate(() => {
        const el = document.querySelector('[data-start-naechster-termin]')
        const alpine = (window as unknown as { Alpine: { $data: (e: Element) => Record<string, unknown> } }).Alpine
        if (!el) {
            return { address: '', name: '', dateLabel: '', location: '' }
        }
        const data = alpine.$data(el)

        return {
            address: String(data.address ?? ''),
            name: String(data.name ?? ''),
            dateLabel: String(data.dateLabel ?? ''),
            location: String(data.location ?? ''),
        }
    })

/** One row of the RSVP store (`js/rsvpTermine.ts`), by address. */
const storeRow = (page: Page, address: string): Promise<Record<string, unknown>> =>
    page.evaluate((a) => {
        const alpine = (window as unknown as { Alpine?: { store(n: string): unknown } }).Alpine
        const store = alpine?.store('rsvpTermine') as { row?: (x: string) => Record<string, unknown> } | undefined
        const row = store?.row?.(a) ?? {}

        return {
            ready: Boolean(row.ready), offen: Boolean(row.offen), busy: Boolean(row.busy),
            error: String(row.error ?? ''), grund: String(row.grund ?? ''),
            attending: Number(row.attending ?? -1), myStatus: String(row.myStatus ?? ''),
            partial: row.partial === null ? null : row.partial,
        }
    }, address)

test.describe('P5: „Zusagen" and „Ich › Verein" at 390×844', () => {
    test.afterAll(() => {
        for (const { id, sec } of published) {
            nak(['event', '--auth', '--sec', sec, '-k', '5', '-e', id, ZOOID_WS])
        }
        seedPin(false)
    })

    test('D12: a 31925 written on Start is on the relay — disclosure first, and only once', async ({ page }) => {
        // Login, one seed round trip, two page loads, a relay publish and three `nak` calls.
        test.setTimeout(240_000)
        await page.setViewportSize({ width: 390, height: 844 })

        const stamp = Math.floor(Math.random() * 1e9)
        const dTag = `p5-zusage-${stamp}`
        const title = `Stammtisch ${stamp}`
        const start = Math.floor(Date.now() / 1000) + 5 * 86400
        const address = `31923:${PORTAL_PUB}:${dTag}`

        const dateId = publishDate(dTag, title, start)
        seedPin(true)

        await useZooid(page)
        // The calendar source, exactly as `partials/head.blade.php` injects it — pointed at
        // the WORKER relay. `serverEnv.ts` keeps both variables empty for every other spec,
        // so a public relay is unreachable from here by construction.
        await page.addInitScript(
            ({ url, author }) => {
                ;(window as unknown as { __nostrCalendarRelays: string }).__nostrCalendarRelays = url
                ;(window as unknown as { __nostrCalendarAuthors: string }).__nostrCalendarAuthors = author
            },
            { url: ZOOID_URL, author: PORTAL_PUB },
        )

        // The Portal index is STUBBED and not served: the association portal is a foreign
        // origin, and the endpoint itself (ETag, throttle, the `a` only where RSVP is
        // allowed) is measured in Pest (`ZusageTest`, `PortalSeitenTest`). What is left for
        // the browser is the island — and a stub can name the row the assertions expect.
        const index = {
            v: 1,
            status: 'fresh',
            rows: [
                { t: 'meetup', r: MEETUP.slug, n: MEETUP.name, s: 'Berlin · DE', d: '' },
                { t: 'event', r: MEETUP.slug, n: title, s: 'Bar 21', d: indexDate(new Date(start * 1000)), a: address },
                // A second date of a meetup the reader has NO relation to, carrying a
                // coordinate all the same. It must never reach the row — „the next date of
                // the whole association" is a stranger's meetup 600 km away.
                {
                    t: 'event', r: 'meetup-fremd-e2e', n: `Fremdtermin ${stamp}`, s: 'Nirgendwo',
                    d: indexDate(new Date((start - 2 * 86400) * 1000)),
                    a: `31923:${PORTAL_PUB}:p5-fremd-${stamp}`,
                },
            ],
        }
        await page.route('**/suche/portal-index*', (route) =>
            route.fulfill({
                status: 200,
                contentType: 'application/json; charset=utf-8',
                headers: { ETag: '"stub"', 'Cache-Control': 'public, max-age=300' },
                body: JSON.stringify(index),
            }),
        )

        await loginNsec(page, NSEC)
        await page.goto('/start')

        // ── 1. The row appears, and it is the pinned meetup's date ──────────────────
        const section = page.locator('[data-start-naechster-termin]')
        await expect(section, 'the next-date row never appeared on Start').toBeVisible({ timeout: 30_000 })
        await expect(section).toContainText(title, { timeout: 15_000 })
        await expect(section, 'a stranger\'s date reached the row').not.toContainText(`Fremdtermin ${stamp}`)

        const row = await startRow(page)
        expect(row.address, 'the row answers a different coordinate').toBe(address)
        expect(row.location).toBe('Bar 21')
        expect(row.dateLabel, 'the date is printed unformatted — or not at all').not.toBe('')
        await expect(page.locator('[data-start-termin-link]')).toHaveAttribute(
            'href', `/bereich/meetups/${MEETUP.slug}`,
        )

        // The buttons are pressable only because the 31923 is really on the relay, from the
        // configured author, neither cancelled nor over.
        const rsvp = page.locator('[data-rsvp-termin]')
        await expect(rsvp).toBeVisible({ timeout: 30_000 })
        await expect
            .poll(async () => (await storeRow(page, address)).offen, { timeout: 30_000 })
            .toBe(true)

        // ── 2. The disclosure is a STEP, not a notice ───────────────────────────────
        const hinweis = page.locator('[data-rsvp-hinweis]')
        await expect(hinweis, 'the disclosure stands open before anything was pressed').toBeHidden()

        await page.locator('[data-rsvp-ja]').click()
        await expect(hinweis, 'the first press went out WITHOUT the disclosure').toBeVisible({ timeout: 10_000 })
        await expect(hinweis).toContainText('zählt Signaturen, nicht Personen')

        // Nothing was published yet: the answer waits behind the sentence.
        expect((await storeRow(page, address)).myStatus, 'the answer went out before the disclosure was read').toBe('')
        expect(
            await page.evaluate((k) => window.localStorage.getItem(k), DISCLOSURE_KEY),
            'the disclosure was acknowledged although nobody confirmed it',
        ).toBeNull()

        // Backing out leaves the disclosure owed — and the answer unsent.
        await page.locator('[data-rsvp-hinweis-abbruch]').click()
        await expect(hinweis).toBeHidden({ timeout: 10_000 })
        expect(await page.evaluate((k) => window.localStorage.getItem(k), DISCLOSURE_KEY)).toBeNull()

        // ── 3. The same tap that acknowledges carries the answer out ────────────────
        await page.locator('[data-rsvp-ja]').click()
        await expect(hinweis).toBeVisible({ timeout: 10_000 })
        await page.locator('[data-rsvp-hinweis-ok]').click()
        await expect(hinweis).toBeHidden({ timeout: 10_000 })

        // **The optimistic count is NOT the proof.** `publishSpreadOptimistic` puts the event
        // into the repository before the relay has said anything, so „1 kommt" appears within
        // milliseconds of the click. Wait for the verdict, then look on the relay.
        await expect
            .poll(async () => (await storeRow(page, address)).busy, { timeout: 30_000 })
            .toBe(false)
        const verdict = await storeRow(page, address)
        expect(verdict.error, `the relay rejected the RSVP: ${String(verdict.error)}`).toBe('')
        expect(verdict.myStatus, 'the row does not know its own answer').toBe('accepted')
        expect(verdict.attending, 'the count fell back after the relay answered').toBe(1)
        expect(verdict.partial, 'a single-relay success must not report a partial result').toBeNull()

        const requery = nak(['req', '-k', '31925', '-t', `a=${address}`, '--auth', '--sec', PORTAL_SEC, ZOOID_WS])
        // eslint-disable-next-line no-console
        console.log(`\n[zusage-390] RSVP requery for ${address}\n${requery.trim()}`)
        expect(requery, 'the RSVP published in the client is not on the relay').toContain('"kind":31925')
        expect(requery, 'the RSVP does not answer this date').toContain(address)
        expect(requery, 'the RSVP carries no accepted status').toContain('"accepted"')
        expect(requery, 'the RSVP does not record WHICH version was answered').toContain(dateId)
        expect(requery, 'the RSVP was not signed by the reader').toContain(VIEWER)
        const rsvpId = /"id":"([0-9a-f]{64})"/.exec(requery)?.[1] ?? ''
        published.push({ id: rsvpId, sec: NSEC })

        // ── 4. Once per DEVICE: the second answer needs no second sentence ──────────
        expect(
            await page.evaluate((k) => window.localStorage.getItem(k), DISCLOSURE_KEY),
            'the acknowledgement was not kept — every answer would ask again',
        ).not.toBeNull()

        await page.locator('[data-rsvp-nein]').click()
        await expect(hinweis, 'the disclosure came a second time').toBeHidden()
        await expect
            .poll(async () => (await storeRow(page, address)).myStatus, { timeout: 30_000 })
            .toBe('declined')

        // ── 5. Geometry, at 390×844, with real numbers ──────────────────────────────
        const gemessen = await page.evaluate(() => {
            const section = document.querySelector('[data-start-naechster-termin]')
            const rsvp = document.querySelector('[data-rsvp-termin]')
            const ja = document.querySelector('[data-rsvp-ja]')
            const box = (el: Element | null): { x: number; y: number; w: number; h: number } | null => {
                if (!el) {
                    return null
                }
                const r = el.getBoundingClientRect()

                return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }
            }

            return {
                docScrollWidth: document.documentElement.scrollWidth,
                docClientWidth: document.documentElement.clientWidth,
                section: box(section),
                rsvp: box(rsvp),
                ja: box(ja),
            }
        })
        // eslint-disable-next-line no-console
        console.log(`[zusage-390] Start/RSVP @390x844: ${JSON.stringify(gemessen)}`)

        expect(
            gemessen.docScrollWidth,
            `horizontal document overflow (${gemessen.docScrollWidth}px > 390px) — the RSVP row is pushing the page`,
        ).toBeLessThanOrEqual(390)
        expect(gemessen.section?.x, 'the row starts off-screen').toBeGreaterThanOrEqual(0)
        expect((gemessen.section?.x ?? 0) + (gemessen.section?.w ?? 0)).toBeLessThanOrEqual(390)
        expect((gemessen.rsvp?.x ?? 0) + (gemessen.rsvp?.w ?? 0), 'the buttons leave the column').toBeLessThanOrEqual(390)

        /*
         * ── The thumb target, and why 32 px is the RIGHT number in this run ──────────
         *
         * `size="sm"` measures 32 px and `text-btn-touch` lifts labelled targets to the
         * 44 px of Apple's HIG — but only inside `@media (pointer: coarse)` (`theme.css`,
         * deliberately: on a mouse the same rule would only waste 12 px in a list row).
         * This run drives a headless Chromium with a FINE pointer, so it can never see that
         * rule, and an assertion of 44 here would have been green for a device nobody was
         * emulating. Measured on 2026-09-18: 32 px, `(pointer: coarse)` = false.
         *
         * What CAN be measured without a device is that the lift is wired at all: the class
         * sits on the button, and the rule behind it carries the 44 px. Both below — first
         * that the 32 px is explained, then that the explanation holds.
         */
        const touch = await page.evaluate(() => {
            let coarseMinHeight = ''
            for (const sheet of Array.from(document.styleSheets)) {
                let rules: CSSRuleList
                try {
                    rules = sheet.cssRules
                } catch {
                    continue
                }
                for (const rule of Array.from(rules)) {
                    if (!(rule instanceof CSSMediaRule) || !rule.conditionText.includes('pointer: coarse')) {
                        continue
                    }
                    for (const inner of Array.from(rule.cssRules)) {
                        if (inner instanceof CSSStyleRule && inner.selectorText.includes('.text-btn-touch')) {
                            coarseMinHeight = inner.style.minHeight
                        }
                    }
                }
            }

            return {
                coarse: window.matchMedia('(pointer: coarse)').matches,
                klasse: Boolean(document.querySelector('[data-rsvp-ja].text-btn-touch')),
                coarseMinHeight,
            }
        })
        // eslint-disable-next-line no-console
        console.log(`[zusage-390] thumb target: ${JSON.stringify(touch)}`)

        expect(touch.coarse, 'this run has a coarse pointer — then 44 px is the number to assert').toBe(false)
        expect(gemessen.ja?.h, 'the „Zusagen" button is not even the 32 px of `size="sm"`').toBeGreaterThanOrEqual(32)
        expect(touch.klasse, 'the button does not carry `text-btn-touch` — no lift on a phone').toBe(true)
        expect(touch.coarseMinHeight, 'the coarse-pointer rule does not lift to 44 px').toBe('2.75rem')
    })

    test('D11: „Ich › Verein" reads the membership through the proxy — measured at 390×844', async ({ page }) => {
        test.setTimeout(180_000)
        await page.setViewportSize({ width: 390, height: 844 })

        await useZooid(page)
        // The association is CONFIGURED for this page through the document config — the
        // `serve` process's env has no `VEREIN_API_URL` and a spec cannot set one. `api`
        // itself is never reached: it only feeds the `u` tag of the NIP-98 credential, and
        // the fetch goes to the same-origin proxy path that `routeVerein` intercepts.
        await stubVereinDocument(page, { api: 'https://verein.e2e-test.invalid', proxy: '' })
        const { calls } = await routeVerein(page, {
            me: () => ({
                status: 200,
                body: vereinMeBody({
                    association_status: 'Active',
                    membership_status: 'active',
                    statutes_accepted_at: '2026-01-04T10:12:00+01:00',
                    current_year: {
                        year: 2026, fee: 21, currency: 'EUR', paid: true,
                        receipt_url: 'https://verein.e2e-test.invalid/i/2026',
                    },
                }),
            }),
            payments: () => ({
                status: 200,
                body: vereinPaymentsBody([
                    { year: 2026, amount: 21, currency: 'EUR', paid: true, receipt_url: 'https://verein.e2e-test.invalid/i/2026' },
                    { year: 2025, amount: 21, currency: 'EUR', paid: true, receipt_url: 'https://verein.e2e-test.invalid/i/2025' },
                ]),
            }),
        })

        await loginNsec(page, NSEC)
        await page.goto('/ich/verein')

        // ── 1. One signature on opening, and it says what it read ───────────────────
        await expect(page.locator('[data-verein-status]')).toBeVisible({ timeout: 30_000 })
        await expect(page.locator('[data-verein-satz="mitglied"]')).toBeVisible({ timeout: 30_000 })
        await expect(page.locator('[data-verein-jahr]')).toHaveText('2026')
        await expect(page.locator('[data-verein-bezahlt]')).toBeVisible()
        await expect(page.locator('[data-verein-beleg-aktuell]')).toBeVisible()
        expect(calls.me, 'the page read `/me` more than once for one opening').toBe(1)
        // Nothing was fetched that nobody asked for: the history costs a second signature.
        expect(calls.payments, 'the receipts were loaded although nobody asked').toBe(0)
        // Hidden, not absent: the list is one `x-show` in the always-rendered card — the
        // island owns every state of this page, so there is nothing for Blade to leave out.
        await expect(page.locator('[data-verein-belege]')).toBeHidden()

        // ── 2. The receipts are ASKED for ───────────────────────────────────────────
        await page.locator('[data-verein-belege-laden]').click()
        await expect(page.locator('[data-verein-belege]')).toBeVisible({ timeout: 30_000 })
        await expect(page.locator('[data-verein-beleg="2025"]')).toBeVisible()
        expect(calls.payments).toBe(1)

        // ── 3. Geometry, at 390×844, with real numbers ──────────────────────────────
        // Measured with the receipts OPEN: the list is the tallest thing on this page and
        // the one that can push the column, and after a navigation it is collapsed again
        // (its zero-sized box would pass every bound below without measuring anything).
        const gemessen = await page.evaluate(() => {
            const box = (sel: string): { x: number; y: number; w: number; h: number } | null => {
                const el = document.querySelector(sel)
                if (!el) {
                    return null
                }
                const r = el.getBoundingClientRect()

                return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }
            }

            return {
                docScrollWidth: document.documentElement.scrollWidth,
                docClientWidth: document.documentElement.clientWidth,
                status: box('[data-verein-status]'),
                beitrag: box('[data-verein-beitrag]'),
                belege: box('[data-verein-belege]'),
                extern: box('[data-verein-extern]'),
            }
        })
        // eslint-disable-next-line no-console
        console.log(`[zusage-390] /ich/verein @390x844: ${JSON.stringify(gemessen)}`)

        expect(
            gemessen.docScrollWidth,
            `horizontal document overflow (${gemessen.docScrollWidth}px > 390px)`,
        ).toBeLessThanOrEqual(390)
        for (const [name, box] of Object.entries(gemessen)) {
            if (typeof box !== 'object' || box === null) {
                continue
            }
            expect(box.x, `${name} starts off-screen`).toBeGreaterThanOrEqual(0)
            expect(box.x + box.w, `${name} leaves the 390 px column`).toBeLessThanOrEqual(390)
        }
        expect(gemessen.beitrag?.h, 'the contribution tile collapsed').toBeGreaterThan(40)
        expect(gemessen.belege?.h, 'the receipts list was collapsed — then its bounds measure nothing')
            .toBeGreaterThan(40)

        /*
         * ── 4. The ten-minute cache is a cache, not a wish ──────────────────────────
         *
         * Back and forth THROUGH THE SPA (`wire:navigate`), not with `page.goto`: the cache
         * is module state in the island (deliberately — a membership status has no business
         * surviving the tab it was read in, `mitgliedschaft.ts`), and a full reload drops the
         * module with the page. Measured on 2026-09-18: two `goto`s cost two signatures,
         * which is correct behaviour and simply not what this case is about. Every in-client
         * way back to this page is a `wire:navigate` link (`ich-row`, `app-header`), so the
         * ten minutes are what they promise for the navigation a user actually performs.
         */
        // A marker in the JS context, so that „the cache held" cannot be confused with „the
        // whole page was rebuilt and the island asked again": a full load takes the marker
        // with it, and then the count below would say nothing about a cache.
        await page.evaluate(() => {
            ;(window as unknown as { __spaMarke: number }).__spaMarke = 1
        })

        // Away and back, both through the SPA. The way back is the history step, because the
        // ROW into this page does not exist in an E2E run — it hangs on `verein_api_url` in
        // the `serve` process's config, and that is exactly the value a spec cannot set.
        await page.locator('[aria-label="Zurück"]').first().click()
        await expect(page).toHaveURL(/\/ich$/, { timeout: 15_000 })
        await page.goBack()
        await expect(page).toHaveURL(/\/ich\/verein$/, { timeout: 15_000 })
        await expect(page.locator('[data-verein-satz="mitglied"]')).toBeVisible({ timeout: 30_000 })

        expect(
            await page.evaluate(() => (window as unknown as { __spaMarke?: number }).__spaMarke ?? 0),
            'the page was fully reloaded — then the count below measures a fresh module, not a cache',
        ).toBe(1)
        expect(calls.me, 'the second opening signed again inside the ten minutes').toBe(1)

    })
})
