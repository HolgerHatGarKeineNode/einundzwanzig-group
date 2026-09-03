import { test, expect, type Page } from './support/fixtures'
import type { Browser } from '@playwright/test'
import { useBuzz, BUZZ_PORT, BUZZ_URL, BUZZ_USER_NSEC, BUZZ_OWNER_SEC_HEX, BUZZ_ROOM_GENERAL } from './support/buzz'
import { loginNsec } from './support/login'
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { finalizeEvent } from 'nostr-tools/pure'
import { decode } from 'nostr-tools/nip19'

/**
 * P6 — **presence (Buzz kind 20001)** at the real surface, and the frame measurement that
 * decides the typing indicator.
 *
 * ── THIS SPEC HAS NEVER RUN. CALIBRATE IT ON THE FIRST RUN. ────────────────────
 *
 * Written on 2026-09-04 under the explicit instruction not to start Playwright; the runs
 * of this plan are collected and driven once at the end. Everything in here is therefore
 * **an unverified claim** — every selector and every deadline is read off neighbouring
 * specs, not measured. Whoever drives the collected run does two things before believing
 * a green:
 *
 *  1. **Make it red on purpose, at the PRODUCT and not at a test line.** Take the
 *     `document.addEventListener('visibilitychange', …)` out of `js/presence.ts`, or
 *     replace `planPresence` with a hand-built `makeEvent(20001, …)`, or set
 *     `PRESENCE_TTL_SECS` to 1. Each of those must knock over a different case here.
 *  2. **Read the skip count.** If the file reports `skipped` rather than `passed`, the
 *     Buzz branch did not run and this measured nothing.
 *
 * ── Why the file is named `buzz-*` ─────────────────────────────────────────────
 *
 * `playwright.config.ts` runs only `buzz-*|pin-room` in Buzz mode and skips everything
 * else **silently**. 20001 is Buzz dialect and `mayWriteKind` closes the surface on
 * zooid, so on the zooid branch these cases would not be red — they would be pointless.
 * Hence the `test.skip` as well.
 *
 * ══ The measurement is a deliverable of this phase, not a by-product ═══════════
 *
 * Buzz caps WebSocket frames at `human_ws_events_per_sec × 5` — default 10, so **50
 * frames per 5 s per pubkey**, shared across `EVENT`, `REQ` and `COUNT`
 * (`buzz-auth/src/rate_limit.rs`, `buzz-relay/src/admission.rs`). Ephemeral kinds are not
 * exempt: `enforce_ws_admission` matches on `ClientMessage::Event(_)` without looking at
 * the kind (`connection.rs`). And the rejection of an `EVENT` is a **bare NOTICE without
 * an event id** (`sub_id` is `None` for an event), which welshman cannot attribute to any
 * publish — so the mutation that falls through the cap disappears silently, and the first
 * one to fall through would be the message the user just typed.
 *
 * The budget is keyed by **pubkey**, not by connection (`check_principal(… &pubkey …)`),
 * which is why the third run below may open a second socket for its prototype and still
 * measure the right quantity.
 *
 * **Counted at the wire, never in the code path.** A `console.log` inside the client
 * would shift the timing and make the case green. `page.on('websocket')` +
 * `framesent` sees exactly the frames the relay is billed for, and the payload tells us
 * which kind each one carried.
 *
 * ── What the run leaves behind ─────────────────────────────────────────────────
 *
 * Presence events are ephemeral: nothing is stored, and the relay drops the Redis entry
 * three minutes after the last heartbeat. The message typed in each measurement run is a
 * real kind 9 in the seed room and stays. The prototype 20002 frames of run 3 are signed
 * but are expected to be **refused** — the probe socket never runs NIP-42 AUTH. That does
 * not weaken the measurement: what is measured is the number of frames a per-keystroke
 * indicator puts on the wire, and the relay counts a frame before it judges it.
 */

const NAK = process.env.NAK ?? `${process.env.HOME}/go/bin/nak`
const WS = (): string => `ws://localhost:${BUZZ_PORT}`

const nak = (args: string[]): string => {
    const res = spawnSync(NAK, args, { encoding: 'utf8', timeout: 30_000 })

    return `${res.stdout ?? ''}\n${res.stderr ?? ''}`
}

/** A message from the OWNER, so the room has a row whose avatar is not our own. */
const seedMessage = (text: string): void => {
    const out = nak([
        'event', '--auth', '--sec', BUZZ_OWNER_SEC_HEX, '-k', '9',
        '-t', `h=${BUZZ_ROOM_GENERAL}`, '-c', text, WS(),
    ])
    // `nak` prints the signed event and exits 0 even on a REJECTION (documented trap of
    // this repo) — so the acceptance is read off `success`, not off the exit code.
    expect(out, `the message "${text}" was not accepted by the relay`).toContain('success')
}

/**
 * Publish a presence event as the OWNER — the second, genuinely different pubkey.
 *
 * Two tabs of the same identity would prove nothing: presence of a pubkey to itself is
 * not a statement about the surface.
 */
const seedPresence = (status: string): void => {
    const out = nak(['event', '--auth', '--sec', BUZZ_OWNER_SEC_HEX, '-k', '20001', '-c', status, WS()])
    expect(out, `the presence "${status}" was not accepted by the relay`).toContain('success')
}

// ─────────────────────────────────────────────────────────────────────────────
// The frame counter
// ─────────────────────────────────────────────────────────────────────────────

/** One frame the page sent, with the kind it carried (`null` = REQ/CLOSE/AUTH/…). */
type SentFrame = { at: number; kind: number | null }

/**
 * Start counting **before** the first navigation — a listener attached afterwards misses
 * the socket that carries the boot burst, which is exactly the busiest window.
 */
const watchFrames = (page: Page): SentFrame[] => {
    const frames: SentFrame[] = []
    page.on('websocket', (ws) => {
        ws.on('framesent', (frame: { payload: string | Buffer }) => {
            let kind: number | null = null
            try {
                const parsed = JSON.parse(String(frame.payload)) as unknown[]
                if (Array.isArray(parsed) && parsed[0] === 'EVENT') {
                    const event = parsed[parsed.length - 1] as { kind?: number }
                    kind = typeof event?.kind === 'number' ? event.kind : null
                }
            } catch {
                // A binary or truncated frame is still a frame; only its kind is unknown.
            }
            frames.push({ at: Date.now(), kind })
        })
    })

    return frames
}

/** The largest number of frames inside any 5 s window — the quantity the relay bills. */
const maxPerWindow = (frames: SentFrame[], windowMs = 5_000): number => {
    const times = frames.map((frame) => frame.at).sort((a, b) => a - b)
    let best = 0
    for (let start = 0; start < times.length; start++) {
        let end = start
        while (end < times.length && times[end] - times[start] < windowMs) {
            end++
        }
        best = Math.max(best, end - start)
    }

    return best
}

const countKind = (frames: SentFrame[], kind: number): number => frames.filter((frame) => frame.kind === kind).length

/** The relay's WS budget per pubkey: `human_ws_events_per_sec` (10) × 5 s. */
const WS_BUDGET_PER_WINDOW = 50

/** Characters typed in every run — identical activity, so the three runs are comparable. */
const TYPED = 'praesenzmessung-eins-zwei-drei-vier-fuenf-sechs-sieben-acht'

/** Delay between keystrokes: 10 per second, brisk but human (~120 WPM). */
const KEYSTROKE_MS = 100

type RunResult = {
    mode: string
    /** Max frames in any 5 s window over the whole session, boot burst included. */
    max: number
    /** The same, but only for the steady state after the page has settled. */
    maxSteady: number
    total: number
    presenceFrames: number
    typingFrames: number
}

/**
 * One measurement run.
 *
 * `'baseline'` unmounts the presence store right after the page settles — the honest
 * "without presence" comparison, in the same session and with the same activity. The
 * assertion that this run sends **zero** 20001 is what makes the comparison worth
 * anything: without it, "presence costs nothing" would also be the answer if presence
 * had never been on in the first place.
 */
const measure = async (browser: Browser, mode: 'baseline' | 'presence' | 'typing'): Promise<RunResult> => {
    const context = await browser.newContext()
    const page = await context.newPage()
    const frames = watchFrames(page)
    await useBuzz(page)
    await loginNsec(page, BUZZ_USER_NSEC)
    await page.goto(`/rooms/${BUZZ_ROOM_GENERAL}`)

    const composer = page.getByPlaceholder('Nachricht schreiben…')
    await expect(composer).toBeVisible({ timeout: 30_000 })

    if (mode === 'baseline') {
        const stopped = await page.evaluate(() => {
            const store = (window as unknown as { Alpine?: { store: (name: string) => unknown } }).Alpine?.store(
                'presence',
            ) as { unmount?: () => void } | undefined
            if (!store?.unmount) {
                return false
            }
            store.unmount()

            return true
        })
        expect(stopped, 'the presence store was not reachable — the baseline would not be a baseline').toBe(true)
    }

    if (mode === 'typing') {
        // The prototype lives in the spec, never in the product: P6 delivers presence and
        // deliberately not the typing indicator. Its events are signed here, handed into
        // the page, and sent over a socket the probe opens itself — a page cannot write on
        // the app's own WebSocket, and the relay's budget is per pubkey anyway, so the
        // frame count is the same quantity either way.
        const secret = decode(BUZZ_USER_NSEC).data as Uint8Array
        const events = Array.from({ length: TYPED.length }, () =>
            finalizeEvent(
                {
                    kind: 20002,
                    // `["h", <uuid>]` is de facto mandatory for 20002: without it the event
                    // goes to the GLOBAL topic instead of into the channel.
                    tags: [['h', BUZZ_ROOM_GENERAL]],
                    content: '',
                    created_at: Math.floor(Date.now() / 1000),
                },
                secret,
            ),
        )
        await page.evaluate(
            ({ url, prepared }: { url: string; prepared: unknown[] }) => {
                const socket = new WebSocket(url)
                const queue = [...prepared]
                const probe = { ready: false, sent: 0 }
                ;(window as unknown as { __typingProbe: typeof probe }).__typingProbe = probe
                socket.addEventListener('open', () => {
                    probe.ready = true
                })
                document.addEventListener(
                    'input',
                    () => {
                        if (socket.readyState !== WebSocket.OPEN || queue.length === 0) {
                            return
                        }
                        socket.send(JSON.stringify(['EVENT', queue.shift()]))
                        probe.sent++
                    },
                    true,
                )
            },
            { url: BUZZ_URL, prepared: events },
        )
        await expect
            .poll(
                () =>
                    page.evaluate(
                        () => (window as unknown as { __typingProbe: { ready: boolean } }).__typingProbe.ready,
                    ),
                { message: 'the probe socket never opened', timeout: 20_000 },
            )
            .toBe(true)
    }

    // Let the boot burst finish, then mark where the steady state begins.
    await page.waitForTimeout(3_000)
    const steadyFrom = frames.length

    await composer.click()
    await composer.pressSequentially(TYPED, { delay: KEYSTROKE_MS })
    await composer.press('Enter')
    // Long enough for at least one heartbeat to become due (45 s) plus its tick.
    await page.waitForTimeout(50_000)

    const typingFrames = countKind(frames, 20002)
    if (mode === 'typing') {
        const sent = await page.evaluate(
            () => (window as unknown as { __typingProbe: { sent: number } }).__typingProbe.sent,
        )
        expect(sent, 'the probe fired on no keystroke at all — run 3 measured nothing').toBeGreaterThan(0)
    }

    const result: RunResult = {
        mode,
        max: maxPerWindow(frames),
        maxSteady: maxPerWindow(frames.slice(steadyFrom)),
        total: frames.length,
        presenceFrames: countKind(frames, 20001),
        typingFrames,
    }
    await context.close()

    return result
}

test.describe('Buzz: Präsenz (E2E, nur E2E_RELAY=buzz)', () => {
    test.skip(process.env.E2E_RELAY !== 'buzz', 'nur im Buzz-Modus (E2E_RELAY=buzz) relevant')

    test('ein anderer Pubkey geht online, und die Chat-Zeile zeigt es — bis er offline geht', async ({ page }) => {
        const stamp = Date.now()
        const text = `E2E-PRAESENZ-${stamp}`
        seedMessage(text)

        await useBuzz(page)
        await loginNsec(page, BUZZ_USER_NSEC)
        await page.goto(`/rooms/${BUZZ_ROOM_GENERAL}`)

        const row = page.locator('div.group', { hasText: text }).first()
        await expect(row).toBeVisible({ timeout: 30_000 })

        // **The presence is published only now, and that is the point.** 20001 is
        // ephemeral: there is no backlog, a REQ answers with EOSE and zero events. What
        // the surface can show is what arrives while it is listening — so the subscription
        // has to be open before the peer speaks.
        const dot = row.locator('[data-presence-dot]')
        await expect(dot, 'ohne Aussage darf KEIN Punkt stehen — „nichts gehört" ist nicht „offline"').toHaveCount(0)

        seedPresence('online')
        await expect(dot).toHaveAttribute('data-presence', 'online', { timeout: 30_000 })

        seedPresence('away')
        await expect(dot).toHaveAttribute('data-presence', 'away', { timeout: 30_000 })

        // `offline` is a command, not a state: the relay clears its Redis entry and the
        // client drops the pubkey from the table. Nothing grey stays behind.
        seedPresence('offline')
        await expect(dot).toHaveCount(0, { timeout: 30_000 })
    })

    test('LAYOUT: der Präsenzpunkt bei schmal (390) und Desktop (1440) — echte Zahlen', async ({ page }) => {
        // „Sichtbare UI ist erst fertig, wenn sie GEMESSEN wurde" (Nutzeransage
        // 2026-09-03). Gemessen werden echte Zahlen an zwei Breiten: Größe des Punktes,
        // seine Lage RELATIV zum Avatar (absolute y-Werte verfälscht die `.page-enter`-
        // Animation) und der waagerechte Überlauf des Dokuments.
        const stamp = Date.now()
        const text = `E2E-PRAESENZ-LAYOUT-${stamp}`
        seedMessage(text)

        await useBuzz(page)
        await loginNsec(page, BUZZ_USER_NSEC)

        for (const width of [390, 1440]) {
            await page.setViewportSize({ width, height: 900 })
            await page.goto(`/rooms/${BUZZ_ROOM_GENERAL}`)
            const row = page.locator('div.group', { hasText: text }).first()
            await expect(row).toBeVisible({ timeout: 30_000 })

            seedPresence('online')
            const dot = row.locator('[data-presence-dot]')
            await expect(dot).toHaveAttribute('data-presence', 'online', { timeout: 30_000 })

            const avatar = row.getByRole('button', { name: 'Profil anzeigen' }).first()
            const dotBox = await dot.boundingBox()
            const avatarBox = await avatar.boundingBox()
            expect(dotBox && avatarBox, `${width}px: keine Geometrie`).toBeTruthy()
            const d = dotBox as { x: number; y: number; width: number; height: number }
            const a = avatarBox as { x: number; y: number; width: number; height: number }

            // Sichtbar, aber kein Fleck: an einem 2rem-Avatar sind 30 % ≈ 9,6 px.
            expect(d.width, `${width}px: der Punkt ist zu klein (${d.width}px)`).toBeGreaterThanOrEqual(6)
            expect(d.width, `${width}px: der Punkt ist zu groß (${d.width}px)`).toBeLessThanOrEqual(16)
            expect(Math.abs(d.width - d.height), `${width}px: der Punkt ist nicht rund`).toBeLessThanOrEqual(1)

            // Lage RELATIV zum Avatar: obere rechte Ecke, leicht überstehend. Die untere
            // rechte gehört seit P2 der Status-Plakette — dort dürfen sie sich nicht
            // treffen.
            expect(d.y - a.y, `${width}px: der Punkt sitzt nicht an der OBEREN Kante`).toBeLessThanOrEqual(a.height / 2)
            expect(d.x - a.x, `${width}px: der Punkt sitzt nicht an der RECHTEN Kante`).toBeGreaterThanOrEqual(
                a.width / 2,
            )
            expect(d.x + d.width, `${width}px: der Punkt ragt aus dem Bild`).toBeLessThanOrEqual(width)

            // Und die Zeile schiebt das Dokument nicht in den waagerechten Bildlauf.
            const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth)
            expect(scrollWidth, `${width}px: waagerechter Überlauf des Dokuments`).toBeLessThanOrEqual(width + 1)

            // Der eigene Punkt in der Rail — nur Desktop, die Rail existiert schmal nicht.
            if (width === 1440) {
                const railDot = page.locator('[data-rail] [data-presence-dot]').first()
                await expect(railDot, 'der eigene Präsenzpunkt fehlt in der Rail').toBeVisible({ timeout: 30_000 })
                const r = (await railDot.boundingBox()) as { width: number; height: number }
                expect(r.width, `Rail: der eigene Punkt ist zu klein (${r.width}px)`).toBeGreaterThanOrEqual(6)
            }

            seedPresence('offline')
        }
    })

    test('MESSUNG: Frames je 5-s-Fenster ohne Präsenz, mit Präsenz und mit Tipp-Prototyp', async ({ browser }) => {
        // Drei volle Sitzungen à ~60 s plus Bootzeit. Der Fall ist eine MESSUNG, kein
        // Wächter — er scheitert nur, wenn eine der drei Läufe nichts gemessen hat.
        test.setTimeout(15 * 60_000)

        const baseline = await measure(browser, 'baseline')
        const withPresence = await measure(browser, 'presence')
        const withTyping = await measure(browser, 'typing')

        // Kalibrierung des Vergleichs: ohne diese zwei Zeilen wäre „Präsenz kostet fast
        // nichts" auch dann wahr, wenn Präsenz in keinem der Läufe angeschaltet war.
        expect(baseline.presenceFrames, 'der Grundlast-Lauf hat trotzdem Präsenz gesendet').toBe(0)
        expect(withPresence.presenceFrames, 'der Präsenz-Lauf hat kein einziges 20001 gesendet').toBeGreaterThan(0)
        expect(withTyping.typingFrames, 'der Tipp-Prototyp hat kein einziges 20002 gesendet').toBeGreaterThan(0)

        const runs = [baseline, withPresence, withTyping]
        // Die Empfehlung wird gerechnet, nicht gemeint: verbraucht der Prototyp mehr als
        // die Hälfte des Budgets in irgendeinem Fenster, teilt er sich den Rest mit REQ,
        // COUNT und der gerade getippten Nachricht — und die Ablehnung einer Mutation ist
        // eine nackte NOTICE, die welshman keinem Publish zuordnen kann.
        const verdict =
            withTyping.max > WS_BUDGET_PER_WINDOW / 2
                ? 'GEGEN 20002: der Prototyp beansprucht mehr als die Hälfte des Budgets.'
                : 'FÜR 20002 möglich: der Prototyp bleibt unter der Hälfte des Budgets — die Entscheidung liegt beim Nutzer.'

        const artefaktOrdner = join(import.meta.dirname, '..', '..', 'docs', 'plans', '2026-09-03T1915-buzz-kind-ernte')
        mkdirSync(artefaktOrdner, { recursive: true })
        writeFileSync(
            join(artefaktOrdner, 'p6-frame-messung.md'),
            [
                '# P6 — Frame-Messung am Draht (kind 20001 / 20002)',
                '',
                `Gemessen am ${new Date().toISOString().slice(0, 10)} gegen den lokalen Buzz-Testslot`,
                `(Port ${BUZZ_PORT}). Gezählt wurde mit \`page.on('websocket')\` + \`framesent\`,`,
                'nicht im Code-Pfad. Getippt wurde in jedem Lauf dieselbe Zeichenkette',
                `(${TYPED.length} Zeichen, ${KEYSTROKE_MS} ms Abstand), danach ${50} s Ruhe.`,
                '',
                `Budget des Relays: **${WS_BUDGET_PER_WINDOW} Frames je 5 s und Pubkey**`,
                '(`human_ws_events_per_sec` = 10 × 5 s), geteilt über EVENT, REQ und COUNT.',
                '',
                '| Lauf | max/5 s (gesamt) | max/5 s (nach dem Start) | Frames gesamt | davon 20001 | davon 20002 |',
                '|---|---:|---:|---:|---:|---:|',
                ...runs.map(
                    (run) =>
                        `| ${run.mode} | ${run.max} | ${run.maxSteady} | ${run.total} | ${run.presenceFrames} | ${run.typingFrames} |`,
                ),
                '',
                `**Empfehlung:** ${verdict}`,
                '',
                'Der dritte Lauf ist eine reine Messung. Der Prototyp lebt im Spec',
                '(`tests/e2e/buzz-presence.spec.ts`, `measure(browser, "typing")`) und ist nicht',
                'Teil der Lieferung — im Produktivcode kommt kind 20002 nicht vor',
                '(`js/presenceWiring.test.ts`, „THE 20002 LATCH").',
                '',
            ].join('\n'),
            'utf8',
        )

        // Eine harte Zusage bleibt: die Präsenz selbst darf das Budget nicht spürbar
        // anfassen. Ein Herzschlag alle 45 s ist 0,11 Frames je Fenster.
        expect(
            withPresence.maxSteady,
            `Präsenz beansprucht ${withPresence.maxSteady} von ${WS_BUDGET_PER_WINDOW} Frames je 5 s`,
        ).toBeLessThan(WS_BUDGET_PER_WINDOW / 2)
    })
})
