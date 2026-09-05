import { test, expect, type Page } from './support/fixtures'
import { spawnSync } from 'node:child_process'
import { loginNsec } from './support/login'
import {
    BUZZ_PORT,
    BUZZ_ROOM_GENERAL,
    BUZZ_ROOM_WELCOME,
    BUZZ_URL,
    BUZZ_USER_NSEC,
    BUZZ_USER_PUB,
    useBuzz,
} from './support/buzz'

/**
 * **P4 — muting and starring a room, WRITING.** Until this phase both flags were read
 * from Buzz Desktop's kind 30078 and displayed; setting them happened in Buzz Desktop.
 *
 * Only an E2E can hold this promise. The pure half is covered under `node --test`
 * (`channelPrefsData.test.ts`) and the wiring by a source latch
 * (`channelPrefsWriteGate.test.ts`), but neither of them ever encrypts, signs or reaches
 * a relay: `nip44EncryptToSelf` pulls the session signer, and the publish goes through
 * welshman's thunk. Whether Buzz ACCEPTS the event — kind 30078 needs `Scope::UsersWrite`
 * and the timestamp has to sit inside ±900 s of server time
 * (`buzz/crates/buzz-relay/src/handlers/ingest.rs:2005-2012`) — is a question no unit
 * test can answer.
 *
 * ── What is checked at the relay and not in the browser ────────────────────────
 *
 * `nak` prints the signed event on a REJECTION too and exits 0. Every claim here about
 * what arrived is therefore a REQUERY: fetch the addressable event back and decrypt it.
 * The content is nip44 to SELF, so `nak decrypt --sender-pubkey <own pubkey>` opens it —
 * ECDH is symmetric, the same trick `read-state-sync.spec.ts` uses for the same kind.
 *
 * ── The prohibition, measured at the relay ────────────────────────────────────
 *
 * `channel-sections` and `channel-sort` are whole-blob LWW. Writing one would replace
 * the section layout and the channel sorting of Buzz Desktop wholesale. Anchor 1 asks
 * the relay for both `d` tags AFTER our writes: the seed publishes neither, so any event
 * under those addresses could only be ours.
 *
 * ── Viewports ─────────────────────────────────────────────────────────────────
 *
 * The Buzz project runs at 1279 px, one pixel below `xl` — the rail does not exist
 * there. Anchor 1 and 3 therefore measure the MOBILE channel list at 375 px (below `xl`
 * it is the only channel list of the workspace), anchor 4 sets 1280 px for the rail.
 * Same mechanic as `buzz-rail-forge.spec.ts`, which sets its viewport before the app
 * boots for the same reason.
 */

const NAK = process.env.NAK ?? `${process.env.HOME}/go/bin/nak`
const WS = (): string => `ws://localhost:${BUZZ_PORT}`
const APP_DATA_KIND = '30078'
/** `js/channelPrefsData.ts` — duplicated here, no import across the repo boundary. */
const D_CHANNEL_SECTIONS = 'channel-sections'
const D_CHANNEL_SORT = 'channel-sort'
const D_CHANNEL_STARS = 'channel-stars'
const D_CHANNEL_MUTES = 'channel-mutes'
/**
 * `js/channelPrefs.ts PUBLISH_DEBOUNCE_MS` is 2 s. The poll window is generous against
 * it on purpose: the publish additionally fetches its own blob first
 * (`mergeOwnBlobBeforePublish`) and waits for the signer. The window carries no
 * assertion about timing — the assertion is that the event ARRIVES.
 */
const POLL_WINDOW_MS = 25_000

type RelayEvent = { id: string; pubkey: string; kind: number; content: string; tags: string[][]; created_at: number }

const nak = (args: readonly string[]): string => {
    const res = spawnSync(NAK, [...args], { encoding: 'utf8', timeout: 30_000 })

    return res.stdout ?? ''
}

/** The current kind-30078 of the test user under `dTag` — addressable, so at most one. */
function fetchPrefsEvent(dTag: string): RelayEvent | undefined {
    const out = nak([
        'req', '-k', APP_DATA_KIND, '-a', BUZZ_USER_PUB, '-d', dTag,
        '--auth', '--sec', BUZZ_USER_NSEC, WS(),
    ])

    return out
        .trim()
        .split('\n')
        .filter(Boolean)
        .flatMap((line) => {
            try {
                return [JSON.parse(line) as RelayEvent]
            } catch {
                return []
            }
        })
        .find((event) => event.pubkey === BUZZ_USER_PUB && event.kind === Number(APP_DATA_KIND))
}

/**
 * The channel map of a blob, or `{}` when there is no event. Throws on a payload that is
 * present but unreadable — that is a test failure, not an empty result.
 */
function readFlags(dTag: string, field: 'starred' | 'muted'): Record<string, boolean> {
    const event = fetchPrefsEvent(dTag)
    if (!event) {
        return {}
    }
    const plaintext = nak(['decrypt', '--sec', BUZZ_USER_NSEC, '--sender-pubkey', BUZZ_USER_PUB, event.content]).trim()
    const payload = JSON.parse(plaintext) as { channels?: Record<string, Record<string, unknown>> }
    const out: Record<string, boolean> = {}
    for (const [id, entry] of Object.entries(payload.channels ?? {})) {
        out[id] = entry[field] === true
    }

    return out
}

/**
 * **A proxy between page and relay** — `page.routeWebSocket` with a real server side.
 *
 * Two of the four guards of the write path only fire in a state the relay will not
 * produce on request: a foreign event still in flight while we publish, and a relay that
 * refuses. Both are frame-level conditions, so they are produced at the frame level.
 *
 * `connectToServer()` is what makes this usable here, and it was worth measuring rather
 * than assuming: `support/hermetik.ts` carries a measurement from 2026-08-21 that a
 * registered `routeWebSocket` broke the Buzz publish path (NIP-42 AUTH did not get
 * through) — but that route was a MOCK with no server side. With one, measured in this
 * repo on 2026-09-05: the publish arrives, 36 frames page→relay and 59 back, and
 * `page.on('websocket')` still reports the socket, so the relay guard of `fixtures.ts`
 * keeps seeing what it watches.
 *
 * Both filters are OFF by default; a test switches them on for the window it needs.
 */
type RelayProxy = {
    /** Drop kind-30078 events on their way TO the page (the page stays blind to them). */
    dropIncomingPrefs: boolean
    /** Answer our own kind-30078 publish with `OK false` instead of forwarding it. */
    refuseOutgoingPrefs: boolean
    dropped: number
    refused: number
}

const APP_DATA = Number(APP_DATA_KIND)

const parseFrame = (message: string | Buffer): unknown[] | null => {
    try {
        const parsed: unknown = JSON.parse(String(message))

        return Array.isArray(parsed) ? parsed : null
    } catch {
        return null // binary or malformed — never our business, always forwarded
    }
}

/** `["EVENT", <subId>, <event>]` — the relay pushing an event to the page. */
const incomingPrefsEvent = (message: string | Buffer): boolean => {
    const frame = parseFrame(message)
    const event = frame?.[0] === 'EVENT' ? (frame[2] as { kind?: number } | undefined) : undefined

    return event?.kind === APP_DATA
}

/** `["EVENT", <event>]` — the page publishing. Returns the id, because the refusal needs it. */
const outgoingPrefsEventId = (message: string | Buffer): string | null => {
    const frame = parseFrame(message)
    if (frame?.[0] !== 'EVENT' || frame.length !== 2) {
        return null
    }
    const event = frame[1] as { kind?: number; id?: string } | undefined

    return event?.kind === APP_DATA && typeof event.id === 'string' ? event.id : null
}

async function proxyBuzz(page: Page): Promise<RelayProxy> {
    const proxy: RelayProxy = { dropIncomingPrefs: false, refuseOutgoingPrefs: false, dropped: 0, refused: 0 }
    await page.routeWebSocket(new RegExp(`localhost:${BUZZ_PORT}`), (ws) => {
        const server = ws.connectToServer()
        ws.onMessage((message) => {
            const id = outgoingPrefsEventId(message)
            if (id !== null && proxy.refuseOutgoingPrefs) {
                proxy.refused += 1
                // The relay never sees the event; the page gets the verdict a refusing
                // relay would give. `nak` cannot tell this apart from a real rejection —
                // which is the point.
                ws.send(JSON.stringify(['OK', id, false, 'blocked: e2e refusal probe']))

                return
            }
            server.send(message)
        })
        server.onMessage((message) => {
            if (proxy.dropIncomingPrefs && incomingPrefsEvent(message)) {
                proxy.dropped += 1

                return
            }
            ws.send(message)
        })
    })

    return proxy
}

/** Workspace on the test relay, viewport BEFORE boot, logged in — the mobile channel list. */
async function bootChannelList(page: Page, width = 375): Promise<void> {
    await page.setViewportSize({ width, height: 800 })
    await useBuzz(page)
    await page.addInitScript((url) => {
        ;(window as unknown as { __nostrWorkspace: string }).__nostrWorkspace = url
    }, BUZZ_URL)
    await loginNsec(page, BUZZ_USER_NSEC)
    await page.goto('/forge?tab=workspaces')
    await expect(page.locator('[data-forge-workspaces]')).toBeVisible({ timeout: 25_000 })
    await expect(page.locator(`[data-forge-kanalzeile][data-room-h="${BUZZ_ROOM_WELCOME}"]`))
        .toBeVisible({ timeout: 25_000 })
}

/**
 * The rail at 1280 px, workspace group open.
 *
 * 1280 is the `xl` breakpoint itself — below it the rail does not exist, and the Buzz
 * project runs at 1279 on purpose. The viewport is set before the navigation so the
 * island boots into the desktop layout instead of switching into it.
 */
async function bootRail(page: Page): Promise<void> {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/spaces')
    const rail = page.locator('[data-rail]')
    await expect(rail).toBeVisible({ timeout: 25_000 })
    // Establish the state, do not toggle it — the collapsed default is not this file's
    // subject, and a bare click would close the group the day the default flips.
    const groupToggle = rail.locator('[aria-controls="rail-group-workspace"]')
    await expect(groupToggle).toBeVisible({ timeout: 30_000 })
    if ((await groupToggle.getAttribute('aria-expanded')) !== 'true') {
        await groupToggle.click()
    }
    await expect(groupToggle).toHaveAttribute('aria-expanded', 'true')
}

/**
 * The rail row WRAPPER — the button carries the id, the menu is its sibling.
 *
 * **Scoped to the workspace group, not to the whole rail.** In this test setup home
 * space and workspace are the SAME relay (`useBuzz` points both at the Buzz stack), so
 * every seed room stands twice in the rail — once under RÄUME, once under FORGE. An
 * unscoped locator resolves to two elements. In production the two relays differ and
 * this cannot happen; the duplicate is a property of the fixture, not of the feature.
 */
const railLine = (page: Page, h: string) =>
    page.locator(`#rail-group-workspace [data-room-h="${h}"]`).locator('xpath=..')

const row = (page: Page, h: string) => page.locator(`[data-forge-kanalzeile][data-room-h="${h}"]`)

const menuButtonIn = (line: ReturnType<typeof row>) =>
    line.getByRole('button', { name: /^Einstellungen für / })

const rowMenuButton = (page: Page, h: string) => menuButtonIn(row(page, h))

/**
 * Open the row menu and pick one of its two items.
 *
 * **Scoped to the row, not to the page.** Every row renders its own dropdown, so the
 * same two labels stand in the DOM as often as there are channels — an unscoped text
 * query resolves to several elements. The open menu stays a DOM child of its
 * `ui-dropdown` (`popover="manual"`), so the row is the right scope even while it floats
 * in the top layer.
 */
async function chooseFromRowMenu(page: Page, h: string, label: RegExp): Promise<void> {
    await rowMenuButton(page, h).click()
    const item = row(page, h).getByRole('menuitem', { name: label })
    await expect(item).toBeVisible({ timeout: 15_000 })
    await item.click()
}

/**
 * **Establish the starting state, do not assume it** (the rule `setExpanded` follows for
 * the rail group, applied to relay state).
 *
 * The preference blob is addressable and survives the test that wrote it. An anchor that
 * failed before its own clean-up leaves a muted room behind, and the NEXT anchor then
 * looks for a menu entry that reads "unmute" — it fails for a reason that has nothing to
 * do with what it measures. Measured exactly that way during the mutation probes of this
 * file: with `mergeOwnBlobBeforePublish` disabled, P4/5 failed as intended AND P4/6
 * failed on P4/5's leftovers, which makes the second result unreadable.
 *
 * Reads the state from the row's `aria-label` — the same source the anchors assert on —
 * and only clicks where something has to change.
 */
async function ensureRoomsUnflagged(page: Page, rooms: readonly string[]): Promise<void> {
    for (const h of rooms) {
        const line = row(page, h)
        // `angeheftet` also appears inside "angeheftet und stummgeschaltet", so both
        // probes are substring probes, not anchored ones.
        if (await line.getByRole('button', { name: /stummgeschaltet/ }).count() > 0) {
            await chooseFromRowMenu(page, h, /^Stummschaltung des Raums aufheben$/)
        }
        if (await line.getByRole('button', { name: /angeheftet/ }).count() > 0) {
            await chooseFromRowMenu(page, h, /^Anheftung des Raums aufheben$/)
        }
    }
    // Wait for the relay, not just for the row: the next anchor reads the blob.
    await expect
        .poll(
            () => {
                const muted = readFlags(D_CHANNEL_MUTES, 'muted')
                const starred = readFlags(D_CHANNEL_STARS, 'starred')

                return rooms.every((h) => muted[h] !== true && starred[h] !== true)
            },
            { timeout: POLL_WINDOW_MS },
        )
        .toBe(true)
}

/**
 * ANCHOR 1 — the core case: set both flags in the client, and they are still there after
 * a reload; the relay carries them; the two blob tags stay untouched.
 *
 * Both directions are exercised (mute → reload → unmute → reload). Without the second
 * direction a leftover blob from an earlier run in the same stack would make the first
 * half green without anything having been written.
 */
test('P4/1: mute and star are set in the client, survive a reload, and reach the relay', async ({ page }) => {
    test.skip(process.env.E2E_RELAY !== 'buzz', 'only in Buzz mode (E2E_RELAY=buzz)')
    test.setTimeout(180_000)

    await bootChannelList(page)
    await ensureRoomsUnflagged(page, [BUZZ_ROOM_GENERAL, BUZZ_ROOM_WELCOME])

    // ── mute ────────────────────────────────────────────────────────────────
    await chooseFromRowMenu(page, BUZZ_ROOM_GENERAL, /^Raum stummschalten$/)
    // The row says so itself: the navigate button carries the state in its `aria-label`
    // (one whole translation key with a `:name` placeholder, not a concatenation).
    await expect(
        row(page, BUZZ_ROOM_GENERAL).getByRole('button', { name: /, stummgeschaltet$/ }),
        'the row must announce the state immediately, before any relay round trip',
    ).toBeVisible({ timeout: 10_000 })
    await expect
        .poll(() => readFlags(D_CHANNEL_MUTES, 'muted')[BUZZ_ROOM_GENERAL] === true, { timeout: POLL_WINDOW_MS })
        .toBe(true)

    // ── star ────────────────────────────────────────────────────────────────
    await chooseFromRowMenu(page, BUZZ_ROOM_WELCOME, /^Raum anheften$/)
    await expect
        .poll(() => readFlags(D_CHANNEL_STARS, 'starred')[BUZZ_ROOM_WELCOME] === true, { timeout: POLL_WINDOW_MS })
        .toBe(true)

    // ── the prohibition, at the relay ───────────────────────────────────────
    // The seed writes neither blob; an event under these addresses could only be ours.
    for (const dTag of [D_CHANNEL_SECTIONS, D_CHANNEL_SORT]) {
        expect(
            fetchPrefsEvent(dTag),
            `${dTag} must not exist at the relay — writing it replaces the user's Buzz Desktop layout wholesale`,
        ).toBeUndefined()
    }

    // ── reload: the states come back from the relay, not from the click ─────
    await page.reload()
    await expect(row(page, BUZZ_ROOM_GENERAL)).toBeVisible({ timeout: 25_000 })
    await expect(
        row(page, BUZZ_ROOM_GENERAL).getByRole('button', { name: /, stummgeschaltet$/ }),
        'after the reload the row is still muted — read back from the relay, nothing local survives a reload',
    ).toBeVisible({ timeout: 30_000 })
    await expect(
        row(page, BUZZ_ROOM_WELCOME).getByRole('button', { name: /, angeheftet$/ }),
        'and the star survives too',
    ).toBeVisible({ timeout: 30_000 })

    // ── and back, so the next run in this stack starts clean ────────────────
    await chooseFromRowMenu(page, BUZZ_ROOM_GENERAL, /^Stummschaltung des Raums aufheben$/)
    await expect
        .poll(() => readFlags(D_CHANNEL_MUTES, 'muted')[BUZZ_ROOM_GENERAL] === false, { timeout: POLL_WINDOW_MS })
        .toBe(true)

    await chooseFromRowMenu(page, BUZZ_ROOM_WELCOME, /^Anheftung des Raums aufheben$/)
    await expect
        .poll(() => readFlags(D_CHANNEL_STARS, 'starred')[BUZZ_ROOM_WELCOME] === false, { timeout: POLL_WINDOW_MS })
        .toBe(true)
})

/**
 * ANCHOR 2 — DoD 3: two devices, two DIFFERENT channels, neither statement lost.
 *
 * **What this anchor measures, precisely.** Device B boots AFTER device A has published,
 * so B reads A's blob through its ordinary start-up load and merges it per channel
 * (`mergeFlags`) before it ever writes. What is held here is that chain: read on arming →
 * per-channel merge → publish carries both.
 *
 * **What it does NOT measure, and an earlier version of this comment wrongly claimed it
 * did:** that `mergeOwnBlobBeforePublish` is what saves A's channel. Measured — with that
 * function reduced to a no-op this anchor stays GREEN, because B already has A's entry by
 * the time it clicks. The fetch-before-publish covers the RACE, where B publishes while
 * A's event is still in flight, and that case has its own anchor (P4/5). A comment that
 * claims a cause it does not test is worse than no comment: the next reader stops looking
 * for cover, because it says so here.
 *
 * Two contexts of the SAME key, because that is the real case — one account, two devices.
 */
test('P4/2: two devices mute different channels — the relay keeps both', async ({ browser, baseURL }) => {
    test.skip(process.env.E2E_RELAY !== 'buzz', 'only in Buzz mode (E2E_RELAY=buzz)')
    test.setTimeout(240_000)

    const contextA = await browser.newContext({ baseURL })
    const contextB = await browser.newContext({ baseURL })
    try {
        const pageA = await contextA.newPage()
        await bootChannelList(pageA)
        await ensureRoomsUnflagged(pageA, [BUZZ_ROOM_GENERAL, BUZZ_ROOM_WELCOME])
        await chooseFromRowMenu(pageA, BUZZ_ROOM_WELCOME, /^Raum stummschalten$/)
        await expect
            .poll(() => readFlags(D_CHANNEL_MUTES, 'muted')[BUZZ_ROOM_WELCOME] === true, { timeout: POLL_WINDOW_MS })
            .toBe(true)

        const pageB = await contextB.newPage()
        await bootChannelList(pageB)
        await chooseFromRowMenu(pageB, BUZZ_ROOM_GENERAL, /^Raum stummschalten$/)
        await expect
            .poll(() => readFlags(D_CHANNEL_MUTES, 'muted')[BUZZ_ROOM_GENERAL] === true, { timeout: POLL_WINDOW_MS })
            .toBe(true)

        const flags = readFlags(D_CHANNEL_MUTES, 'muted')
        expect(
            flags[BUZZ_ROOM_WELCOME],
            'device A’s channel must survive device B’s publish — the relay replaces, it does not union',
        ).toBe(true)
        expect(flags[BUZZ_ROOM_GENERAL]).toBe(true)

        // Clean up, so a later run in this stack does not start with two muted rooms.
        await chooseFromRowMenu(pageB, BUZZ_ROOM_WELCOME, /^Stummschaltung des Raums aufheben$/)
        await chooseFromRowMenu(pageB, BUZZ_ROOM_GENERAL, /^Stummschaltung des Raums aufheben$/)
        await expect
            .poll(
                () => {
                    const after = readFlags(D_CHANNEL_MUTES, 'muted')

                    return after[BUZZ_ROOM_WELCOME] === false && after[BUZZ_ROOM_GENERAL] === false
                },
                { timeout: POLL_WINDOW_MS },
            )
            .toBe(true)
    } finally {
        await contextA.close()
        await contextB.close()
    }
})

/**
 * ANCHOR 3 — the geometry, in real numbers at both ends.
 *
 * Not a class assertion: the trigger is a new element in two dense lists, and the rail
 * row is 280 px wide. Measured is what a class cannot say — does the row still fit, does
 * the trigger reach the 24 px of WCAG 2.5.8, is there any name left next to it.
 */
test('P4/3: the menu fits — measured at 375 px (mobile list) and 1280 px (rail)', async ({ page }) => {
    test.skip(process.env.E2E_RELAY !== 'buzz', 'only in Buzz mode (E2E_RELAY=buzz)')
    test.setTimeout(180_000)

    // ── 375 px: the mobile channel list ─────────────────────────────────────
    await bootChannelList(page, 375)
    // The UNFLAGGED row is the one being measured. A leftover pin plus mute adds two
    // 16 px icons and shrinks the name span — measured during the mutation probes, where
    // that alone pushed `nameWidth` under half the row and produced a geometry failure
    // that had nothing to do with geometry.
    await ensureRoomsUnflagged(page, [BUZZ_ROOM_WELCOME, BUZZ_ROOM_GENERAL])
    // Assert the trigger EXISTS before measuring it. Without this line a missing menu
    // fails inside `page.evaluate` with a null dereference — red, but with a message
    // about `getBoundingClientRect` instead of about the menu (measured on the probe
    // that forces `isWorkspaceChannel` to false).
    await expect(rowMenuButton(page, BUZZ_ROOM_WELCOME), 'the mobile row must carry the menu trigger')
        .toBeVisible({ timeout: 15_000 })
    const mobile = await page.evaluate((h) => {
        const line = document.querySelector(`[data-forge-kanalzeile][data-room-h="${h}"]`) as HTMLElement
        const trigger = line.querySelector('[data-flux-dropdown] button, [data-flux-dropdown] [role="button"]') as HTMLElement
        const name = line.querySelector('span.min-w-0') as HTMLElement
        const box = line.getBoundingClientRect()
        const triggerBox = trigger.getBoundingClientRect()

        return {
            rowWidth: Math.round(box.width),
            rowHeight: Math.round(box.height),
            rowRight: Math.round(box.right),
            triggerWidth: Math.round(triggerBox.width),
            triggerHeight: Math.round(triggerBox.height),
            triggerRight: Math.round(triggerBox.right),
            nameWidth: Math.round(name.getBoundingClientRect().width),
            docScrollWidth: document.documentElement.scrollWidth,
        }
    }, BUZZ_ROOM_WELCOME)
    console.log(`[p4-geometry] 375px mobile row: ${JSON.stringify(mobile)}`)

    expect(mobile.docScrollWidth, 'no horizontal overflow at 375 px').toBeLessThanOrEqual(375)
    expect(mobile.triggerRight, 'the trigger stays inside the row').toBeLessThanOrEqual(mobile.rowRight)
    expect(mobile.triggerWidth, 'WCAG 2.5.8 asks for 24 px').toBeGreaterThanOrEqual(24)
    expect(mobile.triggerHeight).toBeGreaterThanOrEqual(24)
    expect(mobile.nameWidth, 'the name must keep the bulk of the row').toBeGreaterThan(mobile.rowWidth / 2)

    // ── 1280 px: the rail ───────────────────────────────────────────────────
    await bootRail(page)
    const railRow = page.locator(`#rail-group-workspace [data-room-h="${BUZZ_ROOM_WELCOME}"]`)
    await expect(railRow).toBeVisible({ timeout: 25_000 })
    await expect(menuButtonIn(railLine(page, BUZZ_ROOM_WELCOME)), 'the rail row must carry the menu trigger')
        .toBeVisible({ timeout: 15_000 })
    const railGeometry = await page.evaluate((h) => {
        const button = document.querySelector(`#rail-group-workspace [data-room-h="${h}"]`) as HTMLElement
        const line = button.parentElement as HTMLElement
        const trigger = line.querySelector('[data-flux-dropdown]') as HTMLElement
        const box = line.getBoundingClientRect()
        const triggerBox = trigger.getBoundingClientRect()

        return {
            rowWidth: Math.round(box.width),
            rowHeight: Math.round(box.height),
            rowRight: Math.round(box.right),
            buttonWidth: Math.round(button.getBoundingClientRect().width),
            triggerWidth: Math.round(triggerBox.width),
            triggerRight: Math.round(triggerBox.right),
            triggerOpacityAtRest: getComputedStyle(trigger).opacity,
            docScrollWidth: document.documentElement.scrollWidth,
        }
    }, BUZZ_ROOM_WELCOME)
    console.log(`[p4-geometry] 1280px rail row: ${JSON.stringify(railGeometry)}`)

    expect(railGeometry.docScrollWidth, 'no horizontal overflow at 1280 px').toBeLessThanOrEqual(1280)
    expect(railGeometry.triggerRight, 'the trigger stays inside the row')
        .toBeLessThanOrEqual(railGeometry.rowRight)
    expect(railGeometry.triggerWidth, 'the trigger occupies its column permanently — no layout jump on hover')
        .toBeGreaterThan(0)
    expect(railGeometry.buttonWidth, 'the name button keeps the bulk of the 280 px column')
        .toBeGreaterThan(railGeometry.rowWidth * 0.8)
    expect(railGeometry.triggerOpacityAtRest, 'invisible at rest, visible on hover and focus').toBe('0')

    // Both ways back into sight, measured separately: the pointer (discovery) and the
    // keyboard (WCAG 2.4.11 — a focused control must not stay invisible).
    //
    // **Read AFTER the transition, not in the same turn.** `transition-opacity` runs for
    // 150 ms, and `getComputedStyle` in the turn that triggered the change returns the
    // START value. The first version of this measurement did exactly that and reported
    // `0` for a rule that works — a measurement error that looked like a defect.
    const settle = 400
    const triggerOpacity = (): Promise<string> =>
        page.evaluate((h) => {
            const button = document.querySelector(`#rail-group-workspace [data-room-h="${h}"]`) as HTMLElement
            const trigger = (button.parentElement as HTMLElement).querySelector('[data-flux-dropdown]') as HTMLElement

            return getComputedStyle(trigger).opacity
        }, BUZZ_ROOM_WELCOME)

    await railRow.hover()
    await page.waitForTimeout(settle)
    const hovered = await triggerOpacity()
    console.log(`[p4-geometry] 1280px rail trigger opacity while hovering the row: ${hovered}`)
    expect(hovered, 'hovering the row must reveal the trigger').toBe('1')

    // Pointer away again, so the next measurement really is the focus rule and not a
    // leftover hover.
    await page.mouse.move(0, 0)
    await page.waitForTimeout(settle)
    expect(await triggerOpacity(), 'without pointer and without focus it is invisible again').toBe('0')

    const hasFocus = await page.evaluate((h) => {
        const button = document.querySelector(`#rail-group-workspace [data-room-h="${h}"]`) as HTMLElement
        const trigger = (button.parentElement as HTMLElement).querySelector('[data-flux-dropdown]') as HTMLElement
        const inner = trigger.querySelector('button') as HTMLElement
        inner.focus()

        return document.activeElement === inner
    }, BUZZ_ROOM_WELCOME)
    await page.waitForTimeout(settle)
    const focusedOpacity = await triggerOpacity()
    console.log(`[p4-geometry] 1280px rail trigger while focused: ${JSON.stringify({ hasFocus, focusedOpacity })}`)
    expect(hasFocus, 'the trigger has to be focusable at all').toBe(true)
    expect(focusedOpacity, 'a focused control must not stay invisible').toBe('1')
})

/**
 * ANCHOR 4 — the rail writes too.
 *
 * Anchors 1 and 2 run against the mobile channel list; the rail is a SECOND surface with
 * its own island (`rail.ts` against `bridge.ts`). Both call `toggleChannelFlag`, and a
 * source latch holds that (`channelPrefsWriteGate.test.ts`) — but a latch over the
 * wiring says nothing about whether the click arrives. Without this anchor a removed
 * `x-on:click` in `rail-room-row.blade.php` would break nothing measurable.
 */
test('P4/4: the rail row menu writes as well — measured at 1280 px', async ({ page }) => {
    test.skip(process.env.E2E_RELAY !== 'buzz', 'only in Buzz mode (E2E_RELAY=buzz)')
    test.setTimeout(180_000)

    await bootChannelList(page)
    await ensureRoomsUnflagged(page, [BUZZ_ROOM_GENERAL])
    await bootRail(page)

    const line = railLine(page, BUZZ_ROOM_GENERAL)
    await expect(line).toBeVisible({ timeout: 25_000 })
    await expect(menuButtonIn(line), 'the rail row must carry the menu trigger').toBeVisible({ timeout: 15_000 })
    await menuButtonIn(line).click()
    const item = line.getByRole('menuitem', { name: /^Raum stummschalten$/ })
    await expect(item).toBeVisible({ timeout: 15_000 })
    await item.click()

    await expect(
        line.getByRole('button', { name: /, stummgeschaltet$/ }),
        'the rail row has to announce the state immediately',
    ).toBeVisible({ timeout: 10_000 })
    await expect
        .poll(() => readFlags(D_CHANNEL_MUTES, 'muted')[BUZZ_ROOM_GENERAL] === true, { timeout: POLL_WINDOW_MS })
        .toBe(true)

    // Back again, so the next run in this stack starts clean.
    await menuButtonIn(line).click()
    const undo = line.getByRole('menuitem', { name: /^Stummschaltung des Raums aufheben$/ })
    await expect(undo).toBeVisible({ timeout: 15_000 })
    await undo.click()
    await expect
        .poll(() => readFlags(D_CHANNEL_MUTES, 'muted')[BUZZ_ROOM_GENERAL] === false, { timeout: POLL_WINDOW_MS })
        .toBe(true)
})

/**
 * ANCHOR 5 — the RACE that `mergeOwnBlobBeforePublish` exists for.
 *
 * Device A mutes room 1. Device B boots while the relay's copy is kept from it, mutes
 * room 2, and only then may see anything again. B's own store therefore never held A's
 * channel; the only way its publish can still carry it is the fetch-and-merge that runs
 * immediately before the write.
 *
 * Kind 30078 is addressable — the relay replaces, it does not union. Without that fetch,
 * B's publish silently deletes A's mute, on the user's own account, and nothing in either
 * browser says so.
 *
 * **The blindfold is verified, not assumed.** Step 3 asserts that B really does NOT show
 * room 1 as muted. Without that control the anchor would pass even if the drop never
 * worked — B would then have A's entry the ordinary way and the merge would prove nothing
 * (the exact hole the previous version of P4/2 had).
 */
test('P4/5: a second device publishing into a race keeps the first device’s channel', async ({ browser, baseURL }) => {
    test.skip(process.env.E2E_RELAY !== 'buzz', 'only in Buzz mode (E2E_RELAY=buzz)')
    test.setTimeout(240_000)

    const contextA = await browser.newContext({ baseURL })
    const contextB = await browser.newContext({ baseURL })
    try {
        // ── Device A: mute room 1, confirmed at the relay ────────────────────
        const pageA = await contextA.newPage()
        await bootChannelList(pageA)
        await ensureRoomsUnflagged(pageA, [BUZZ_ROOM_GENERAL, BUZZ_ROOM_WELCOME])
        await chooseFromRowMenu(pageA, BUZZ_ROOM_WELCOME, /^Raum stummschalten$/)
        await expect
            .poll(() => readFlags(D_CHANNEL_MUTES, 'muted')[BUZZ_ROOM_WELCOME] === true, { timeout: POLL_WINDOW_MS })
            .toBe(true)

        // ── Device B: boots blindfolded to the preference blob ───────────────
        const pageB = await contextB.newPage()
        const proxy = await proxyBuzz(pageB)
        proxy.dropIncomingPrefs = true
        await bootChannelList(pageB)

        // The control: B must NOT know about A's mute. If this line is ever green by
        // accident, everything below measures nothing.
        await expect(
            row(pageB, BUZZ_ROOM_WELCOME).getByRole('button', { name: /, stummgeschaltet$/ }),
            'device B has to be blind to the relay copy for this anchor to mean anything',
        ).toHaveCount(0)
        expect(proxy.dropped, 'the proxy must actually have dropped preference events').toBeGreaterThan(0)

        // ── B mutes room 2 and the blindfold comes off in the same breath ────
        // From here only ONE code path can still bring A's channel into B's publish:
        // the fetch-and-merge inside `publishChannelFlags`. The live subscription cannot
        // — A's event predates B's connection, and relays do not resend on an open REQ.
        await chooseFromRowMenu(pageB, BUZZ_ROOM_GENERAL, /^Raum stummschalten$/)
        proxy.dropIncomingPrefs = false

        await expect
            .poll(() => readFlags(D_CHANNEL_MUTES, 'muted')[BUZZ_ROOM_GENERAL] === true, { timeout: POLL_WINDOW_MS })
            .toBe(true)
        const flags = readFlags(D_CHANNEL_MUTES, 'muted')
        console.log(`[p4-race] dropped ${proxy.dropped} incoming preference events; blob after B: ${JSON.stringify(flags)}`)
        expect(
            flags[BUZZ_ROOM_WELCOME],
            'device A’s channel must survive a publish from a device that never saw it — that is what '
                + 'the fetch-and-merge before publishing is for',
        ).toBe(true)
        expect(flags[BUZZ_ROOM_GENERAL]).toBe(true)

        // Clean up, so a later run in this stack starts unmuted.
        await chooseFromRowMenu(pageB, BUZZ_ROOM_WELCOME, /^Stummschaltung des Raums aufheben$/)
        await chooseFromRowMenu(pageB, BUZZ_ROOM_GENERAL, /^Stummschaltung des Raums aufheben$/)
        await expect
            .poll(
                () => {
                    const after = readFlags(D_CHANNEL_MUTES, 'muted')

                    return after[BUZZ_ROOM_WELCOME] === false && after[BUZZ_ROOM_GENERAL] === false
                },
                { timeout: POLL_WINDOW_MS },
            )
            .toBe(true)
    } finally {
        await contextA.close()
        await contextB.close()
    }
})

/**
 * ANCHOR 6 — a REFUSED publish must not be remembered as delivered.
 *
 * `anyRelayAccepted` decides whether the payload goes into `publishedJson` and the
 * pending mark is cleared. Treat a refusal as success and the client believes the
 * preference is stored: it never tries again, and the switch the user flipped is silently
 * gone at the next reload. Nothing in the interface says so — the row keeps showing the
 * local value until then.
 *
 * The proxy answers our own kind-30078 with `OK false` and does not forward it, so the
 * relay genuinely never receives it. Then the refusal stops and the `hidden` flush gets
 * its one retry — the bounded second chance the module offers instead of a retry timer.
 */
test('P4/6: a relay that refuses the publish does not count as delivered — the retry still gets through', async ({ page }) => {
    test.skip(process.env.E2E_RELAY !== 'buzz', 'only in Buzz mode (E2E_RELAY=buzz)')
    test.setTimeout(180_000)

    const proxy = await proxyBuzz(page)
    await bootChannelList(page)
    await ensureRoomsUnflagged(page, [BUZZ_ROOM_GENERAL])
    // Only now: the clean-up above has to be allowed through.
    proxy.refuseOutgoingPrefs = true

    await chooseFromRowMenu(page, BUZZ_ROOM_GENERAL, /^Raum stummschalten$/)
    await expect(
        row(page, BUZZ_ROOM_GENERAL).getByRole('button', { name: /, stummgeschaltet$/ }),
        'the row shows the local value regardless — that is exactly why the relay side has to be checked',
    ).toBeVisible({ timeout: 10_000 })

    // The control: the refusal really happened and the relay really has nothing.
    await expect.poll(() => proxy.refused, { timeout: POLL_WINDOW_MS }).toBeGreaterThan(0)
    expect(
        readFlags(D_CHANNEL_MUTES, 'muted')[BUZZ_ROOM_GENERAL],
        'the refused event must not be at the relay',
    ).not.toBe(true)
    console.log(`[p4-refusal] refused ${proxy.refused} publish frames`)

    // Refusal over. The `hidden` flush is the one retry the module offers; it only fires
    // if the failed publish is still marked pending.
    proxy.refuseOutgoingPrefs = false
    await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
        Object.defineProperty(document, 'hidden', { value: true, configurable: true })
        document.dispatchEvent(new Event('visibilitychange'))
    })

    await expect
        .poll(() => readFlags(D_CHANNEL_MUTES, 'muted')[BUZZ_ROOM_GENERAL] === true, { timeout: POLL_WINDOW_MS })
        .toBe(true)

    // Clean up.
    await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
        Object.defineProperty(document, 'hidden', { value: false, configurable: true })
        document.dispatchEvent(new Event('visibilitychange'))
    })
    await chooseFromRowMenu(page, BUZZ_ROOM_GENERAL, /^Stummschaltung des Raums aufheben$/)
    await expect
        .poll(() => readFlags(D_CHANNEL_MUTES, 'muted')[BUZZ_ROOM_GENERAL] === false, { timeout: POLL_WINDOW_MS })
        .toBe(true)
})
