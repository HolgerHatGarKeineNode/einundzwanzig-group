import { test, expect, type Page } from './support/fixtures'
import { useZooid, ZOOID_URL, ZOOID_WS } from './support/zooid'
import { loginNsec } from './support/login'
import { testKeys } from './support/keys'
import { execFileSync } from 'node:child_process'

const NAK = process.env.NAK ?? `${process.env.HOME}/go/bin/nak`

/**
 * The relay's own key. It stands in for the PORTAL here — a second, member-authorised
 * identity distinct from the logged-in test user.
 *
 * Not the portal's real key, and that is a measured constraint rather than a shortcut:
 * zooid refuses a verbatim, foreign-signed event outright. Measured 2026-09-05 by piping
 * the real kind 31923 `c6619354a2bc…` (signed by `daf83d92…`) into
 * `nak event --auth --sec <member> ws://localhost:…` —
 * `failed: msg: restricted: you cannot publish events on behalf of others`, and the
 * requery afterwards was empty. A local relay therefore cannot hold a real portal event,
 * by construction.
 *
 * What the stand-in preserves is the SHAPE: `d`, `title`, `start`, `D`, `end`,
 * `start_tzid`, `location`, `a` — the tag set `NostrCalendarEventFactory::forMeetupEvent`
 * emits, asserted field for field against the verbatim production event in
 * `packages/einundzwanzig-group/js/calendarModels.test.ts`.
 */
const PORTAL_SEC = 'b2ee09a54bedf17ee1db562bdddd75c48661d981eb52c49dc206c55ba8439414'
const PORTAL_PUB = 'da99fbe39247109327ac8504750d0227d50a8f84049ac8bd2f6c7ad0806ed76d'

/** The seeded meetup rooms (`zooid-testserver.sh`) and their `["i","meetup:<id>"]`. */
const BERLIN = { h: 'meetberlin', meetupId: 'e2e-berlin', slug: 'meetup-berlin-e2e' }
const WIEN = { h: 'meetwien', meetupId: 'e2e-wien', slug: 'meetup-wien-e2e' }

const calendarAddress = (meetupId: string): string => `31924:${PORTAL_PUB}:meetup-${meetupId}`

const nak = (args: readonly string[]): string => {
    try {
        return execFileSync(NAK, [...args], { encoding: 'utf8', timeout: 30_000, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (error) {
        return String((error as { stdout?: string }).stdout ?? '') + String((error as { stderr?: string }).stderr ?? '')
    }
}

/**
 * The event ids this file published, so `afterAll` can tombstone them.
 *
 * The worker relay outlives the run (RUNMARK reuse), and a kind 31923 left behind would
 * be counted by the NEXT run's card — a "2 attending" that nobody produced looks exactly
 * like a defect of the product. Same discipline as `support/articles.ts`.
 */
const published: { id: string; sec: string }[] = []

/** Publish a portal-shaped kind 31923 and return its event id, verified by requery. */
const publishDate = (opts: {
    dTag: string
    title: string
    start: number
    end?: number
    location?: string
    meetupId: string
    sec?: string
}): string => {
    const sec = opts.sec ?? PORTAL_SEC
    const args = [
        'event', '--auth', '--sec', sec, '-k', '31923',
        '-d', opts.dTag,
        '-t', `title=${opts.title}`,
        '-t', `start=${opts.start}`,
        '-t', `D=${Math.floor(opts.start / 86400)}`,
        '-t', 'start_tzid=Europe/Berlin',
        '-t', `a=${calendarAddress(opts.meetupId)}`,
    ]
    if (opts.end !== undefined) {
        args.push('-t', `end=${opts.end}`)
    }
    if (opts.location !== undefined) {
        args.push('-t', `location=${opts.location}`)
    }
    nak([...args, ZOOID_WS])

    // A requery, not the `nak` output: it prints the signed event on a rejection too and
    // exits 0 — the one thing that tells acceptance from rejection apart is asking back.
    const back = nak(['req', '-k', '31923', '-d', opts.dTag, '--auth', '--sec', sec, ZOOID_WS])
    const id = /"id":"([0-9a-f]{64})"/.exec(back)?.[1] ?? ''
    expect(id, `the date \`${opts.dTag}\` was not accepted by the relay`).toMatch(/^[0-9a-f]{64}$/)
    published.push({ id, sec })

    return id
}

type CardState = {
    mounted: boolean
    source: string
    title: string
    dateLabel: string
    attending: number
    myStatus: string
    canRsvp: boolean
    busy: boolean
    error: string
}

/**
 * The card's own state, read out of Alpine — the fields the markup binds to.
 *
 * The fields are named one by one and NOT spread. Measured 2026-09-05: `{...Alpine.$data(el)}`
 * serialises to `{}` across the Playwright bridge — the data stack is a Proxy, and the
 * spread came back empty while the very same card was visibly rendering the right title.
 * Reading through the proxy by name works; enumerating it does not.
 */
const cardState = async (page: Page): Promise<CardState> =>
    page.evaluate(() => {
        const el = document.querySelector('[x-data^="nostrMeetupEvent"]')
        if (!el) {
            return {
                mounted: false, source: '', title: '', dateLabel: '',
                attending: -1, myStatus: '', canRsvp: false, busy: false, error: '',
            }
        }
        const alpine = (window as unknown as { Alpine: { $data: (e: Element) => Record<string, unknown> } }).Alpine
        const data = alpine.$data(el)

        return {
            mounted: true,
            source: String(data.source ?? ''),
            title: String(data.title ?? ''),
            dateLabel: String(data.dateLabel ?? ''),
            attending: Number(data.attending ?? -1),
            myStatus: String(data.myStatus ?? ''),
            canRsvp: Boolean(data.canRsvp),
            busy: Boolean(data.busy),
            error: String(data.error ?? ''),
        }
    })

/**
 * P2 (community features autumn) — **meetup dates as NIP-52: read them, and answer them.**
 *
 * ── What is proven here, and with what ──────────────────────────────────────────────
 *
 * 1. A **kind 31923 published to the relay reaches the room header** — title, date and
 *    venue, joined through the `a` coordinate that the room's `["i","meetup:<id>"]` tag
 *    builds. Nothing in the markup knows the meetup id; the island resolves it.
 * 2. **The author filter holds.** A second kind 31923 with the SAME `a` tag, signed by
 *    the logged-in user instead of the portal, is on the same relay and must not appear.
 *    That event is what the surface would render without `authors` — the `a` tag is a
 *    claim, not a capability.
 * 3. **An RSVP written in the browser is on the relay**: the client signs a kind 31925,
 *    and `nak req` finds it again afterwards. The count in the header moves with it.
 * 4. **The HTTP source still catches the card** when the relays hold no date — with the
 *    fallback saying so, instead of showing two dead buttons.
 * 5. **Geometry at 375 px and 1280 px** — real numbers (width/height/position/overflow),
 *    not a class assertion.
 *
 * The German strings this spec looks for are the interface of the product under test, not
 * prose of its own — they are quoted, not translated.
 */
test.describe('Meetup dates (NIP-52)', () => {
    test.beforeEach(async ({ page }) => {
        await useZooid(page)
        // The calendar source, exactly as `partials/head.blade.php` would inject it —
        // pointed at the WORKER relay. `serverEnv.ts` keeps both variables empty for
        // every other spec, so this is the only place in the suite that switches the
        // surface on, and it can never reach a public relay.
        await page.addInitScript(
            ({ url, author }) => {
                ;(window as unknown as { __nostrCalendarRelays: string }).__nostrCalendarRelays = url
                ;(window as unknown as { __nostrCalendarAuthors: string }).__nostrCalendarAuthors = author
            },
            { url: ZOOID_URL, author: PORTAL_PUB },
        )
    })

    test.afterAll(() => {
        for (const { id, sec } of published) {
            nak(['event', '--auth', '--sec', sec, '-k', '5', '-e', id, ZOOID_WS])
        }
    })

    test('the date lands in the room header, a stranger\'s does not, and an RSVP goes out — measured at 375 and 1280 px', async ({ page }) => {
        test.setTimeout(180_000)

        const now = Math.floor(Date.now() / 1000)
        const stamp = Math.floor(Math.random() * 1e9)
        const soonTitle = `Stammtisch ${stamp}`
        const laterTitle = `Jahrestreffen ${stamp}`
        const strangerTitle = `Fremdtermin ${stamp}`

        // Two real dates, the nearer one four days out. The order of publication is the
        // reverse of the expected order, so that "the first one that arrived" cannot pass
        // for "the next one".
        publishDate({
            dTag: `meetup-event-${stamp}-later`, title: laterTitle, meetupId: BERLIN.meetupId,
            start: now + 40 * 86400, location: 'Halle 21',
        })
        const soonId = publishDate({
            dTag: `meetup-event-${stamp}-soon`, title: soonTitle, meetupId: BERLIN.meetupId,
            start: now + 4 * 86400, end: now + 4 * 86400 + 7200, location: 'Bar 21',
        })
        // And a date from a stranger, pointing at the SAME meetup calendar. Everything
        // about it is legal Nostr; only the author is wrong.
        const { sk } = testKeys()
        const strangerSec = Buffer.from(sk).toString('hex')
        publishDate({
            dTag: `meetup-event-${stamp}-stranger`, title: strangerTitle, meetupId: BERLIN.meetupId,
            start: now + 2 * 86400, location: 'Nirgendwo', sec: strangerSec,
        })

        await loginNsec(page, process.env.NOSTR_TEST_NSEC as string)
        await page.goto(`/rooms/${BERLIN.h}`)

        const card = page.locator('[data-testid="meetup-event-card"]')
        await expect(card).toBeVisible({ timeout: 30_000 })
        await expect(card.locator('[data-testid="meetup-event-title"]')).toHaveText(soonTitle, { timeout: 30_000 })
        await expect(card.locator('[data-testid="meetup-event-location"]')).toHaveText('Bar 21')

        // ── 1. The nearer date wins, and the further one is not shown.
        await expect(card).not.toContainText(laterTitle)

        // ── 2. The author filter. The stranger's date starts SOONER than both real ones,
        // so without the filter it would be the one on screen — this is not a subtle
        // difference, it is the whole card.
        await expect(card).not.toContainText(strangerTitle)
        const strangerOnRelay = nak([
            'req', '-k', '31923', '-t', `a=${calendarAddress(BERLIN.meetupId)}`,
            '--auth', '--sec', strangerSec, ZOOID_WS,
        ])
        expect(strangerOnRelay, 'the stranger\'s date is not on the relay at all — the filter proves nothing')
            .toContain(strangerTitle)

        const before = await cardState(page)
        expect(before.source, 'the card is not reading from the relay').toBe('nostr')
        expect(before.attending, 'somebody has answered before the test did').toBe(0)

        // ── 3. RSVP: signed in the browser, then found again on the relay.
        await card.locator('[data-testid="meetup-event-yes"]').click()
        await expect(card.locator('[data-testid="meetup-event-attending"]')).toHaveText('1 kommt', { timeout: 30_000 })

        // **The count above is NOT the proof, and this is the reason the requery exists.**
        // `publishOptimistic` puts the event into the repository before the relay has
        // said anything, so "1 kommt" appears within milliseconds of the click — measured
        // 2026-09-05: the first version of this test asked `nak` right here and got an
        // empty answer, because the relay round trip had not finished. Wait for the
        // verdict, then look on the relay.
        await expect
            .poll(async () => (await cardState(page)).busy, { timeout: 30_000 })
            .toBe(false)
        const verdict = await cardState(page)
        expect(verdict.error, `the relay rejected the RSVP: ${verdict.error}`).toBe('')
        expect(verdict.attending, 'the count fell back after the relay answered — the write was rolled back').toBe(1)

        const address = `31923:${PORTAL_PUB}:meetup-event-${stamp}-soon`
        const requery = nak(['req', '-k', '31925', '-t', `a=${address}`, '--auth', '--sec', strangerSec, ZOOID_WS])
        console.log(`\n[meetup-calendar] RSVP requery for ${address}\n${requery.trim()}`)
        expect(requery, 'the RSVP published in the client is not on the relay').toContain('"kind":31925')
        expect(requery, 'the RSVP does not answer this date').toContain(address)
        expect(requery, 'the RSVP carries no accepted status').toContain('"accepted"')
        expect(requery, 'the RSVP does not record WHICH version was answered').toContain(soonId)
        const rsvpId = /"id":"([0-9a-f]{64})"/.exec(requery)?.[1] ?? ''
        published.push({ id: rsvpId, sec: strangerSec })

        expect(verdict.myStatus, 'the card does not know its own answer').toBe('accepted')

        // ── 4. Geometry, at both widths.
        const report: string[] = []
        for (const width of [375, 1280]) {
            await page.setViewportSize({ width, height: 800 })
            // One frame, otherwise the layout is measured BEFORE the reflow.
            await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))))

            const doc = await page.evaluate(() => ({
                scrollWidth: document.documentElement.scrollWidth,
                clientWidth: document.documentElement.clientWidth,
            }))
            const box = (await card.boundingBox()) as { x: number; y: number; width: number; height: number }
            const titleBox = (await card.locator('[data-testid="meetup-event-title"]').boundingBox()) as {
                x: number; width: number
            }
            const yes = (await card.locator('[data-testid="meetup-event-yes"]').boundingBox()) as {
                x: number; y: number; width: number; height: number
            }
            const count = (await card.locator('[data-testid="meetup-event-attending"]').boundingBox()) as {
                x: number; width: number
            }

            report.push(
                `${width}px | document scrollWidth=${doc.scrollWidth} clientWidth=${doc.clientWidth}`
                    + ` | card x=${Math.round(box.x)} y=${Math.round(box.y)} ${Math.round(box.width)}×${Math.round(box.height)}`
                    + ` | title x=${Math.round(titleBox.x)} w=${Math.round(titleBox.width)}`
                    + ` | count x=${Math.round(count.x)} w=${Math.round(count.width)}`
                    + ` | yes ${Math.round(yes.width)}×${Math.round(yes.height)} at ${Math.round(yes.x)},${Math.round(yes.y)}`,
            )

            expect(doc.scrollWidth, `${width}px: the document overflows horizontally`).toBeLessThanOrEqual(doc.clientWidth)
            expect(box.width, `${width}px: the card has no width`).toBeGreaterThan(0)
            expect(box.height, `${width}px: the card has no height`).toBeGreaterThan(0)
            expect(
                Math.round(box.x + box.width),
                `${width}px: the card sticks out of the viewport on the right`,
            ).toBeLessThanOrEqual(doc.clientWidth + 1)
            // The count sits to the right of the title and must not be pushed off: on a
            // 375 px screen the title is the elastic part, the number is not.
            expect(count.width, `${width}px: the attendance count was squeezed to nothing`).toBeGreaterThan(0)
            expect(
                Math.round(count.x),
                `${width}px: the attendance count overlaps the title`,
            ).toBeGreaterThanOrEqual(Math.round(titleBox.x + titleBox.width) - 1)
            // A touch target a thumb can hit. **This assertion has already caught one:**
            // with `size="xs"` (the shape of the pin bar's buttons) the button measured
            // 24 px here — WCAG 2.5.8 met by a hair, Apple's HIG missed by 20 px. The
            // floor is 32 px because that is what this project measures at: `text-btn-touch`
            // lifts labelled targets to 44 px only under `@media (pointer: coarse)`, and
            // the E2E browser has a FINE pointer, so that rule is out of reach here.
            expect(yes.height, `${width}px: the RSVP button is smaller than 32 px high`).toBeGreaterThanOrEqual(32)
        }
        console.log(`\n[meetup-calendar] geometry\n${report.join('\n')}`)
    })

    test('no date on the relay: the card falls back to the portal HTTP list and says so', async ({ page }) => {
        test.setTimeout(120_000)

        // The stub of `useZooid()` answers with `next_event_start: null` for all three
        // seeded meetups. This registration comes AFTER it and therefore wins (Playwright
        // matches routes in reverse order of registration) — with a date for Vienna, and
        // only for Vienna.
        const iso = new Date(Date.now() + 9 * 86400 * 1000).toISOString().slice(0, 16).replace('T', ' ')
        await page.route('https://portal.einundzwanzig.space/api/mobile/meetups', (route) =>
            route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify([
                    { name: 'Meetup Wien', slug: WIEN.slug, city: 'Wien', country: 'AT', logo: null, next_event_start: iso },
                ]),
            }),
        )

        await loginNsec(page, process.env.NOSTR_TEST_NSEC as string)
        await page.goto(`/rooms/${WIEN.h}`)

        const card = page.locator('[data-testid="meetup-event-card"]')
        await expect(card).toBeVisible({ timeout: 30_000 })
        await expect(card.locator('[data-testid="meetup-event-fallback"]')).toBeVisible()

        const state = await cardState(page)
        expect(state.source, 'the card is not on the HTTP fallback').toBe('http')
        expect(state.dateLabel, 'the fallback shows no date').not.toBe('')
        expect(state.canRsvp, 'there is nothing to answer without a signed date').toBe(false)

        // And the two things the fallback must NOT pretend to have.
        await expect(card.locator('[data-testid="meetup-event-attending"]')).toBeHidden()
        await expect(card.locator('[data-testid="meetup-event-yes"]')).toBeHidden()

        // The relay really has nothing for this meetup — otherwise "fallback" would be
        // measured against a source that was never asked.
        const onRelay = nak([
            'req', '-k', '31923', '-t', `a=${calendarAddress(WIEN.meetupId)}`,
            '--auth', '--sec', PORTAL_SEC, ZOOID_WS,
        ])
        expect(onRelay.trim(), 'Vienna does have a date on the relay — this is not a fallback measurement')
            .not.toContain('"kind":31923')
        console.log(`\n[meetup-calendar] fallback: source=${String(state.source)} date="${String(state.dateLabel)}"`)
    })

    test('an ordinary room shows no card at all', async ({ page }) => {
        test.setTimeout(120_000)

        await loginNsec(page, process.env.NOSTR_TEST_NSEC as string)
        await page.goto('/rooms/welcome')
        await expect(page.locator('[x-data^="nostrRoomChat"]')).toBeVisible({ timeout: 30_000 })

        // Mounted (the island is mounted for every room), but silent: the card only
        // renders when it resolved a meetup binding.
        const state = await cardState(page)
        expect(state.mounted, 'the island is not mounted — then the assertion below is empty').toBe(true)
        expect(state.source, 'a room without a meetup binding shows a date card').toBe('')
        await expect(page.locator('[data-testid="meetup-event-card"]')).toBeHidden()
    })
})
