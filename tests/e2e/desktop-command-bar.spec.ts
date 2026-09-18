/**
 * **The command bar at 1440 × 900 — the measurement of the P6 definition of done.**
 *
 * Plan: `docs/plans/2026-09-17T1946-revamp-ein-eingang.md`, decision D10.
 *
 * The `desktop-` prefix is what puts this file in the `desktop` project
 * (`playwright.config.ts`, pinned 1440 × 900) and keeps it out of the existing suite at
 * 1279 px — one pixel below the `xl` breakpoint this bar hangs on. Under any other name it
 * would measure the width at which the bar is deliberately absent.
 *
 * ── What only a run can answer here ─────────────────────────────────────────────────
 *
 * That the bar renders under the right conditions is decided without a browser
 * (`tests/Feature/CommandBarTest.php`), and what its badge counts is a rule without one
 * (`js/updatesView.test.ts`, `countAddressedUpdates`). Four things are true only if a
 * layout engine and a relay say so:
 *
 *  1. **the bar has a place and a size** — real numbers at the top of the stage, next to a
 *     20 rem left bar, with no horizontal overflow of the document;
 *  2. **one avatar per width** — both instances are in the DOM, and exactly the header's is
 *     invisible here. A class assertion would not see that;
 *  3. **⌘K reaches the palette from the bar** — by click and by key, with the palette's own
 *     `<dialog>` open;
 *  4. **the badge counts what addresses the reader** — a room message raises `updates` and
 *     leaves the badge alone, a mention raises both. That split needs a relay: it is the
 *     difference between two derivations over the same event stream.
 *
 * ── What the run leaves behind ──────────────────────────────────────────────────────
 *
 * One room per test that needs one (`trackRoom`, cleaned up in `afterAll`) and its
 * messages. Nothing else.
 */
import { test, expect, type Page } from './support/fixtures'
import { execFileSync } from 'node:child_process'
import { useZooid, ZOOID_WS } from './support/zooid'
import { loginNsec } from './support/login'
import { cleanupRooms, trackRoom } from './support/rooms'
import { testKeys } from './support/keys'

const NSEC = process.env.NOSTR_TEST_NSEC as string
const NAK = process.env.NAK ?? `${process.env.HOME}/go/bin/nak`
/** The relay admin of the test stack — the only key that may open a room. */
const ADMIN = 'b2ee09a54bedf17ee1db562bdddd75c48661d981eb52c49dc206c55ba8439414'
const { npub: VIEWER_NPUB } = testKeys()

/** The viewport of the `desktop` project; the cases pin it themselves as well. */
const BREITE = 1440
/** `xl:grid-cols-[20rem_minmax(0,1fr)]` — 20 rem at the root font size of 16 px. */
const LEISTE_PX = 320

const rnd = (): number => Math.floor(Math.random() * 1e9)

/** `nak` with retries — the pattern of the neighbouring specs (a busy relay answers late). */
function nak(args: readonly string[], attempts = 3): string {
    let last: unknown
    for (let i = 0; i < attempts; i++) {
        try {
            return execFileSync(NAK, [...args], { timeout: 10_000 }).toString()
        } catch (error) {
            last = error
            execFileSync('sleep', ['1'])
        }
    }
    throw last
}

/** A fresh room the test user has joined — `9007` opens it, `9002` names it, `9021` joins. */
function makeRoom(): { h: string; name: string } {
    const id = rnd()
    const h = trackRoom(`bar${id}`)
    const name = `Leistenprobe-${id}`
    nak(['event', '--auth', '--sec', ADMIN, '-k', '9007', '-t', `h=${h}`, ZOOID_WS])
    nak(['event', '--auth', '--sec', ADMIN, '-k', '9002', '-t', `h=${h}`, '-t', `name=${name}`, ZOOID_WS])
    nak(['event', '--auth', '--sec', NSEC, '-k', '9021', '-t', `h=${h}`, ZOOID_WS])

    return { h, name }
}

/**
 * The read-state watermark of the login, and the assurance that it is already WRITTEN.
 *
 * `js/unread.ts` counts a message as unread only when `created_at` is STRICTLY greater than
 * the watermark, and nostr timestamps have second resolution — a message published in the
 * same second as the watermark counts as read, for good. The neighbouring `updates.spec.ts`
 * paid half an hour of diagnosis for that twice; the same assurance stands here, in short
 * form and with the same reference.
 */
async function wasserzeichen(page: Page): Promise<number> {
    const lesen = (): Promise<number> =>
        page.evaluate(() => {
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i) as string
                if (k.startsWith('e21:readstate:bootstrap:')) {
                    return Number(localStorage.getItem(k)) || 0
                }
            }

            return 0
        })
    const frist = Date.now() + 15_000
    let wm = await lesen()
    while (wm === 0 && Date.now() < frist) {
        await page.waitForTimeout(100)
        wm = await lesen()
    }
    if (wm === 0) {
        throw new Error('no read-state watermark after 15 s — publishing before the login, or the bootstrap failed')
    }

    return wm
}

/** A foreign kind 9 in `h`, guaranteed NEWER than the watermark. Returns its `created_at`. */
async function publiziere(page: Page, h: string, content: string, versatz = 0): Promise<number> {
    const wm = await wasserzeichen(page)
    const ts = Math.max(wm + 1, Math.floor(Date.now() / 1000)) + versatz
    nak(['event', '--auth', '--sec', ADMIN, '-k', '9', '-t', `h=${h}`, '-c', content, '--ts', String(ts), ZOOID_WS])
    expect(ts, 'the message has to be strictly younger than the watermark').toBeGreaterThan(wm)

    return ts
}

type Kasten = { x: number; y: number; width: number; height: number }

const leiste = (page: Page) => page.locator('[data-rail]')
const bar = (page: Page) => page.locator('[data-command-bar]')

/** The two numbers of the unread store this bar reads — straight out of the live store. */
const zahlen = (page: Page): Promise<{ updates: number; postfach: number }> =>
    page.evaluate(() => {
        const store = (window as unknown as { Alpine: { store(n: string): Record<string, number> } }).Alpine.store(
            'unread',
        )

        return { updates: store.updates, postfach: store.postfach }
    })

async function geometrie(page: Page): Promise<{ bar: Kasten; leiste: Kasten; scrollWidth: number; clientWidth: number }> {
    return page.evaluate(() => {
        const kasten = (wahl: string): { x: number; y: number; width: number; height: number } => {
            const el = document.querySelector(wahl) as HTMLElement | null
            if (el === null) {
                throw new Error(`${wahl} is not in the document — the measurement would have no subject`)
            }
            const r = el.getBoundingClientRect()

            return {
                x: Math.round(r.x * 10) / 10,
                y: Math.round(r.y * 10) / 10,
                width: Math.round(r.width * 10) / 10,
                height: Math.round(r.height * 10) / 10,
            }
        }

        return {
            bar: kasten('[data-command-bar]'),
            leiste: kasten('[data-rail]'),
            scrollWidth: document.scrollingElement?.scrollWidth ?? 0,
            clientWidth: document.scrollingElement?.clientWidth ?? 0,
        }
    })
}

/**
 * Wait until every FINITE animation has finished — `.page-enter` translates the island over
 * 0.3 s, and a box read while it runs is mapped through the layer matrix (the neighbouring
 * `nav-shell-390.spec.ts` measured 43.9999942779541 px for a 44 px element that way).
 * Infinite ones (skeleton shimmer, caret blink) are skipped on purpose: waiting for them
 * would hang.
 */
async function ruhig(page: Page): Promise<void> {
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

// The rooms this file opens are removed again (kind 9008 by the relay admin). Failures in
// there are silent by construction — see the head of `support/rooms.ts`.
test.afterAll(() => {
    cleanupRooms(ZOOID_WS, ADMIN)
})

test('the bar sits above the stage, the left bar next to it — measured at 1440 × 900', async ({ page }) => {
    await useZooid(page)
    await loginNsec(page, NSEC)
    await expect(leiste(page)).toBeVisible({ timeout: 25_000 })
    await expect(bar(page)).toBeVisible()
    await ruhig(page)

    const mass = await geometrie(page)
    console.log(
        `[P6] command bar ${mass.bar.width} × ${mass.bar.height} at (${mass.bar.x}, ${mass.bar.y}) · ` +
            `left bar ${mass.leiste.width} × ${mass.leiste.height} · ` +
            `document scrollWidth ${mass.scrollWidth} / clientWidth ${mass.clientWidth}`,
    )

    expect(page.viewportSize()?.width, 'this file must run above the xl breakpoint').toBe(BREITE)

    // The bar belongs to the STAGE, not across both columns: the left bar keeps the full
    // height of the window, which is what makes it a column of places rather than a panel.
    expect(mass.bar.x, 'the bar starts where the left bar ends').toBe(LEISTE_PX)
    expect(mass.bar.y, 'the bar sits at the top edge').toBe(0)
    expect(mass.bar.width, 'the bar fills the stage').toBe(BREITE - LEISTE_PX)
    // A BOUND and not the measured value: the height follows the type scale, and pinning it
    // would turn every typographic change into a false red. 44 px is the floor the 44 px
    // targets inside it (inbox, avatar) impose anyway.
    expect(mass.bar.height, 'the bar has to carry its 44 px targets').toBeGreaterThanOrEqual(44)

    expect(mass.leiste.x).toBe(0)
    expect(mass.leiste.width, '20 rem').toBe(LEISTE_PX)
    expect(mass.leiste.y, 'the left bar starts at the top edge, beside the bar and not below it').toBe(0)
    expect(mass.leiste.height, 'the left bar keeps the full window height').toBe(900)

    // No horizontal overflow of the DOCUMENT: at `xl` the stage scrolls, not the page, and a
    // page-wide scrollbar would mean the grid is wider than the window.
    expect(mass.scrollWidth, 'no horizontal overflow').toBe(mass.clientWidth)

    // One avatar per width — both are server-rendered, and here exactly the bar's shows.
    await expect(page.locator('[data-command-bar-avatar]')).toBeVisible()
    await expect(page.locator('[data-app-header-avatar]')).toBeHidden()
    // And the way to „Ich" really is in the bar.
    expect(await page.locator('[data-command-bar-avatar]').getAttribute('href')).toContain('/ich')
})

test('⌘K: the field opens the palette, and so does the key', async ({ page }) => {
    await useZooid(page)
    await loginNsec(page, NSEC)
    await expect(bar(page)).toBeVisible({ timeout: 25_000 })

    const dialog = page.locator('dialog[data-modal="command-palette"]')
    await expect(dialog, 'the palette must be closed before the click — otherwise this measures nothing').toBeHidden()

    // 1) The field. It is a BUTTON that looks like a field: the palette brings its own input,
    //    and a second one here would be a second text state for one query.
    await page.locator('[data-command-bar-search]').click()
    await expect(dialog).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('[data-palette-input]')).toBeFocused()

    // 2) The key still does it too. The bar advertises the shortcut
    //    (`aria-keyshortcuts="Meta+K Control+K"`), so the shortcut has to exist — otherwise
    //    the cap on the button promises a key that does nothing.
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden({ timeout: 10_000 })
    await page.keyboard.press('Control+k')
    await expect(dialog).toBeVisible({ timeout: 10_000 })
})

test('the inbox badge counts a mention — and stays silent about room traffic', async ({ page }) => {
    // Two relay round trips plus two derivations over them.
    test.setTimeout(120_000)
    const room = makeRoom()
    await useZooid(page)
    await loginNsec(page, NSEC)
    await expect(bar(page)).toBeVisible({ timeout: 25_000 })
    // The room has to be known before its messages mean anything: `deriveUpdates` drops an
    // event whose `h` is not among the joined rooms (rule 5).
    await page.goto('/bereich/chat')
    await expect(page.getByRole('button', { name: new RegExp(room.name) }).first()).toBeVisible({ timeout: 25_000 })

    const pille = page.locator('[data-command-bar-postfach] .chip-in')

    // ── 1) A plain room message ───────────────────────────────────────────────────────
    await publiziere(page, room.h, `Raumverkehr-${rnd()}`)
    // CALIBRATION: the notice list DOES see it. Without this the case below would also pass
    // on a page where nothing arrived at all.
    await expect.poll(async () => (await zahlen(page)).updates, { timeout: 30_000 }).toBeGreaterThanOrEqual(1)

    expect((await zahlen(page)).postfach, 'room traffic does not address the reader').toBe(0)
    await expect(pille, 'no pill for a room message').toHaveCount(0)
    expect(
        await page.locator('[data-command-bar-postfach]').getAttribute('aria-label'),
        'and the spoken label says nothing about hints either',
    ).toBe('Postfach')

    // ── 2) A mention ──────────────────────────────────────────────────────────────────
    // NIP-27 in the PLAIN TEXT and not a `p` tag: `updatesMentionsPubkey` reads the content
    // on purpose, because every NIP-22 reply carries the parent author as `p` and would
    // otherwise count as a mention.
    await publiziere(page, room.h, `Hallo nostr:${VIEWER_NPUB}, schaust du mal?`, 1)

    await expect(pille, 'a mention has to reach the badge').toHaveText('1', { timeout: 30_000 })
    const gezaehlt = await zahlen(page)
    console.log(`[P6] badge after one room message and one mention: postfach=${gezaehlt.postfach} updates=${gezaehlt.updates}`)
    expect(gezaehlt.postfach).toBe(1)
    // The two numbers DIFFER, and the difference is exactly the room row — the proof that
    // the badge is a second derivation and not the same figure under another name.
    expect(gezaehlt.updates).toBeGreaterThan(gezaehlt.postfach)
    expect(
        await page.locator('[data-command-bar-postfach]').getAttribute('aria-label'),
        'the spoken form names the same number',
    ).toBe('Postfach, 1 ungelesener Hinweis')
})

test('the guards stay silent on the four surfaces — first load and after a roundtrip', async ({
    page,
    pageErrorWaechter,
    responseWaechter,
}) => {
    // Four page loads plus four Livewire roundtrips.
    test.setTimeout(150_000)
    await useZooid(page)
    await loginNsec(page, NSEC)

    for (const pfad of ['/start', '/postfach', '/bereich/chat', '/ich']) {
        await page.goto(pfad)
        await expect(bar(page), `no command bar on ${pfad}`).toBeVisible({ timeout: 25_000 })

        // A 500 on a Livewire roundtrip is a rejected promise, not a console error — it shows
        // up in NO console channel (house rule 4b). `$refresh` through the component is the
        // cheapest form of that round trip, and it is the one an open tab performs.
        // **The endpoint is NOT `/livewire/update` in this app.** Livewire 4 puts a
        // per-application prefix in front of it — measured here: `livewire-741f54e8/update`
        // (`php artisan route:list`, route name `default-livewire.update`). A matcher on the
        // plain path waited 20 s for a request that had long since been sent, which reads like
        // "the roundtrip did not happen" and is the opposite of the truth.
        const antwort = page.waitForResponse((res) => /\/livewire[^/]*\/update/.test(res.url()), {
            timeout: 20_000,
        })
        const komponenten = await page.evaluate(() => {
            // `Livewire.all()` hands out COMPONENTS, and the callable surface is their `$wire`
            // (`vendor/livewire/livewire/dist/livewire.esm.js`: `find()` returns `$wire`,
            // `all()` does not). Measured, not read off a doc page: `component.call('$refresh')`
            // throws `not a function` here.
            const livewire = (window as unknown as {
                Livewire?: { all(): { $wire: { $refresh(): void } }[] }
            }).Livewire
            const alle = livewire?.all() ?? []
            alle.forEach((component) => component.$wire.$refresh())

            return alle.length
        })
        // Fail-closed: a page without a Livewire component would answer this case with a
        // roundtrip that never happened, and the guard would have nothing to judge.
        expect(komponenten, `no Livewire component on ${pfad} — the roundtrip would be fictional`).toBeGreaterThan(0)
        const res = await antwort
        expect(res.status(), `Livewire roundtrip on ${pfad}`).toBe(200)
        await expect(bar(page), `the bar survives the roundtrip on ${pfad}`).toBeVisible()
    }

    // The fixture judges both guards at teardown anyway; read them here so the phase report
    // can quote the number instead of "it was green". The self-proof that they can FAIL is in
    // `page-error-guard.spec.ts` and `response-guard.spec.ts` — a positive control belongs to
    // the guard, not to every spec that draws on it.
    const fehler = pageErrorWaechter.gesehen()
    const antworten = responseWaechter.gesehen()
    console.log(`[P6] guards over four surfaces: ${fehler.length} page errors, ${antworten.length} error responses`)
    expect(fehler, 'browser console/pageerror on one of the four surfaces').toEqual([])
    expect(antworten, 'error response on one of the four surfaces').toEqual([])
})
