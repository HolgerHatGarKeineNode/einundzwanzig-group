import { test, expect, type Page } from './support/fixtures'
import { execFileSync } from 'node:child_process'
import { useZooid, ZOOID_WS } from './support/zooid'
import { loginNsec } from './support/login'
import { cleanupRooms, trackRoom } from './support/rooms'

/**
 * **Video-Stabilität im Chat-Verlauf über die Boot-Phase (Messung, kein UI-Urteil).**
 *
 * Vorfälle-Bericht (Prod, group.einundzwanzig.space): ein HTML-Video in einer Nachricht
 * „flackert" beim Öffnen des Raums mehrfach — jedes Flackern ist ein ersetztes
 * `<video>`-Element mit neuem Ladezyklus. Verdacht: Alpines `x-html` setzt `innerHTML`
 * bei JEDEM Effect-Lauf bedingungslos neu, und der Effect refiret, wenn der Store die
 * Message-Objekte neu mapped (neue Objekt-Identität bei gleichem Inhalt) — die Boot-Phase
 * hat mehrere solcher Wellen (Relay-Sync, Profil-Hydration, Reactions).
 *
 * Diese Spec misst genau das und nichts sonst:
 *
 *  - **Video-Ersetzungen**: ein MutationObserver ab Dokument-Start zählt entfernte und
 *    hinzugefügte `<video>`-Elemente; zusätzlich prüft ein Intervall die Identität des
 *    aktuellen Elements (Catches auch Ersetzungen, die die Knoten-Zählung verfehlen könnte).
 *  - **Netzweg**: jede Anfrage auf die Video-URL wird gezählt — ein ersetztes Element
 *    mit `src` lädt neu, ein stabiles lädt genau einmal (preload=metadata).
 *
 * Das Video läuft über den UNgeschützten Zweig (`src` direkt, Blossom-Origin) — dieselbe
 * Churn-Klasse wie der Marker-Zweig (`data-blossom-src`), nur ohne signierten Fetch, und
 * damit ohne Zooid-Blob-Machinery reproduzierbar. Die bytes sind das vom Buzz-Stack
 * akzeptierte Minimal-MP4 (buzz-chat-attachments.spec.ts) — hier spielt es nur als
 * Metadata-Load, der Inhalt ist gleichgültig.
 *
 * Umgebung: Wegwerf-Raum (9007 + 9002), Video- und Text-Nachrichten per nak, Viewer
 * tritt bei (9021). Der Raum wird in afterAll abgeräumt (support/rooms.ts).
 */

const NSEC = process.env.NOSTR_TEST_NSEC as string
const NAK = process.env.NAK ?? `${process.env.HOME}/go/bin/nak`
const ADMIN_HEX = 'b2ee09a54bedf17ee1db562bdddd75c48661d981eb52c49dc206c55ba8439414'

/** Das 1610-Byte-MP4, das Buzzs Video-Validator akzeptiert (faststart, keine Metadata-Boxen). */
const MP4 = Buffer.from(
    'AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAM4bW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAAlgAAQAA' +
    'AQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
    'AAAAAgAAAod0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAAlgAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAA' +
    'AAAAAAABAAAAAAAAAAAAAAAAAABAAAAAABAAAAAQAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAAJYAAAQAAABAAAAAAH/' +
    'bWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAAAoAAAAGABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRl' +
    'b0hhbmRsZXIAAAABqm1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAA' +
    'AQAAAWpzdGJsAAAAvnN0c2QAAAAAAAAAAQAAAK5hdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAABAAEABIAAAASAAAAAAA' +
    'AAABDExhdmMgbGlieDI2NAAAAAAAAAAAAAAAAAAAAAAAAAAAGP//AAAANGF2Y0MBZAAK/+EAF2dkAAqs2V7ARAAAAwAEAAAD' +
    'ACg8SJZYAQAGaOvjyyLA/fj4AAAAABBwYXNwAAAAAQAAAAEAAAAUYnRydAAAAAAAACZwAAAAAAAAABhzdHRzAAAAAAAAAAEA' +
    'AAADAAAIAAAAABRzdHNzAAAAAAAAAAEAAAABAAAAKGN0dHMAAAAAAAAAAwAAAAEAABAAAAAAAQAAGAAAAAABAAAIAAAAABxz' +
    'dHNjAAAAAAAAAAEAAAABAAAAAwAAAAEAAAAgc3RzegAAAAAAAAAAAAAAAwAAAsoAAAAMAAAADAAAABRzdGNvAAAAAAAAAAEA' +
    'AANoAAAAPXVkdGEAAAA1bWV0YQAAAAAAAAAhaGRscgAAAAAAAAAAbWRpcmFwcGwAAAAAAAAAAAAAAAAIaWxzdAAAAAhmcmVl' +
    'AAAC6m1kYXQAAAKtBgX//6ncRem95tlIt5Ys2CDZI+7veDI2NCAtIGNvcmUgMTY1IHIzMjIyIGIzNTYwNWEgLSBILjI2NC9N' +
    'UEVHLTQgQVZDIGNvZGVjIC0gQ29weWxlZnQgMjAwMy0yMDI1IC0gaHR0cDovL3d3dy52aWRlb2xhbi5vcmcveDI2NC5odG1s' +
    'IC0gb3B0aW9uczogY2FiYWM9MSByZWY9MyBkZWJsb2NrPTE6MDowIGFuYWx5c2U9MHgzOjB4MTEzIG1lPWhleCBzdWJtZT03' +
    'IHBzeT0xIHBzeV9yZD0xLjAwOjAuMDAgbWl4ZWRfcmVmPTEgbWVfcmFuZ2U9MTYgY2hyb21hX21lPTEgdHJlbGxpcz0xIDh4' +
    'OGRjdD0xIGNxbT0wIGRlYWR6b25lPTIxLDExIGZhc3RfcHNraXA9MSBjaHJvbWFfcXBfb2Zmc2V0PS0yIHRocmVhZHM9MSBs' +
    'b29rYWhlYWRfdGhyZWFkcz0xIHNsaWNlZF90aHJlYWRzPTAgbnI9MCBkZWNpbWF0ZT0xIGludGVybGFjZWQ9MCBibHVyYXlf' +
    'Y29tcGF0PTAgY29uc3RyYWluZWRfaW50cmE9MCBiZnJhbWVzPTMgYl9weXJhbWlkPTIgYl9hZGFwdD0xIGJfYmlhcz0wIGRp' +
    'cmVjdD0xIHdlaWdodGI9MSBvcGVuX2dvcD0wIHdlaWdodHA9MiBrZXlpbnQ9MjUwIGtleWludF9taW49NSBzY2VuZWN1dD00' +
    'MCBpbnRyYV9yZWZyZXNoPTAgcmNfbG9va2FoZWFkPTQwIHJjPWNyZiBtYnRyZWU9MSBjcmY9MjMuMCBxY29tcD0wLjYwIHFw' +
    'bWluPTAgcXBtYXg9NjkgcXBzdGVwPTQgaXBfcmF0aW89MS40MCBhcT0xOjEuMDAAgAAAABVliIQAEf/+5+P8Cm18xHE6dhj6' +
    '9/EAAAAIQZoibEP//uAAAAAIAZ5BeQ//s4E=',
    'base64',
)

/**
 * Zähler ab Dokument-Start installieren — VOR jeder Navigation, damit der erste Render
 * mitgezählt wird und `identitySwitches - 1` die Ersetzungen NACH dem ersten Render sind.
 */
async function installiereChurnZaehler(page: Page): Promise<void> {
    await page.addInitScript(() => {
        const C = {
            added: 0,
            removed: 0,
            identitySwitches: 0,
            /** Wie oft x-html den Inhalt EINES .chat-content-Containers neu gesetzt hat. */
            sets: 0,
            /** Wie oft dabei ein <video> zerstört wurde (der gesuchte Churn). */
            videoErsetzt: 0,
            /** Wie oft der Feed messagesReversed neu zugewiesen hat (nach Erstzuweisung). */
            listeNeuZugewiesen: 0,
            /** Wie oft das Video-Message-Objekt neu gemappt wurde (Identitätswechsel). */
            videoMsgNeuGemappt: 0,
            log: [] as string[],
        }
        ;(window as unknown as { __videoChurn: typeof C }).__videoChurn = C
        const videosIn = (n: Node): number => {
            if (n.nodeType !== 1) {
                return 0
            }
            const el = n as Element
            return el.tagName === 'VIDEO' ? 1 : el.querySelectorAll('video').length
        }
        // `document` (nicht `documentElement`): die Init-Script läuft vor <html>,
        // und document ist selbst ein Node — subtree deckt alles Spätere ab.
        new MutationObserver((muts) => {
            for (const mu of muts) {
                const ziel = mu.target as Element
                const istChatContent = ziel.nodeType === 1 && ziel.classList?.contains('chat-content')
                for (const n of mu.removedNodes) {
                    const c = videosIn(n)
                    if (c) {
                        C.removed += c
                        if (istChatContent) {
                            C.videoErsetzt += c
                            C.log.push(`video entfernt durch innerHTML (${String(ziel.getAttribute('class') ?? '').slice(0, 30)})`)
                        }
                    }
                }
                for (const n of mu.addedNodes) {
                    C.added += videosIn(n)
                }
                if (istChatContent && (mu.addedNodes.length > 0 || mu.removedNodes.length > 0)) {
                    C.sets++
                }
            }
        }).observe(document, { childList: true, subtree: true })
        let last: Element | null = null
        setInterval(() => {
            const v = document.querySelector('video.chat-video')
            if (v && v !== last) {
                last = v
                C.identitySwitches++
            }
        }, 300)
        // Wie oft hat der Raum-Feed die Liste (und das Video-Message-Objekt) neu zugewiesen?
        // Identitätswechsel von messagesReversed[.] = applyMsgs-Läufe mit frisch gemappten
        // Objekten — der vermutete Churn-Auslöser, unabhängig vom DOM sichtbar.
        const feed = () => {
            const root = document.querySelector('div[x-data^="nostrRoomChat"]')
            const w = window as unknown as { Alpine?: { $data: (el: Element) => Record<string, unknown> } }
            if (!root || !w.Alpine) {
                return null
            }
            try {
                return w.Alpine.$data(root) as { messagesReversed?: unknown[] }
            } catch {
                return null
            }
        }
        let lastArr: unknown[] | null = null
        let lastVideoMsg: unknown = null
        setInterval(() => {
            const d = feed()
            const arr = d?.messagesReversed
            if (arr && arr !== lastArr) {
                if (lastArr !== null) {
                    C.listeNeuZugewiesen = (C.listeNeuZugewiesen ?? 0) + 1
                }
                lastArr = arr
            }
            if (arr && arr.length > 0) {
                const videoMsg = (arr as { html?: string }[]).find((m) => typeof m.html === 'string' && m.html.includes('chat-video-box'))
                if (videoMsg && videoMsg !== lastVideoMsg) {
                    if (lastVideoMsg !== null) {
                        C.videoMsgNeuGemappt = (C.videoMsgNeuGemappt ?? 0) + 1
                    }
                    lastVideoMsg = videoMsg
                }
            }
        }, 100)
    })
}

const nak = (args: string[]): string => {
    const aus = execFileSync(NAK, args, { timeout: 20_000, encoding: 'utf8' })
    return aus ?? ''
}

/** Id eines per nak publizierten Events aus dessen stdout-JSON lesen. */
const eventId = (stdout: string): string => {
    for (const zeile of stdout.split('\n')) {
        try {
            const evt = JSON.parse(zeile) as { id?: string }
            if (evt.id) {
                return evt.id
            }
        } catch {
            // nak schreibt auch Statuszeilen — die interessieren hier nicht.
        }
    }
    throw new Error(`nak hat kein Event-JSON geliefert: ${stdout.slice(0, 200)}`)
}

test.afterAll(() => cleanupRooms(ZOOID_WS, ADMIN_HEX))

test('Chat-Video bleibt über die Boot-Phase dasselbe Element', async ({ page }) => {
    const h = `flakern${Date.now()}`
    trackRoom(h)
    nak(['event', '--auth', '--sec', ADMIN_HEX, '-k', '9007', '-t', `h=${h}`, ZOOID_WS])
    nak(['event', '--auth', '--sec', ADMIN_HEX, '-k', '9002', '-t', `h=${h}`, '-t', 'name=Flakern-Probe', ZOOID_WS])
    // Viewer beitreten (member-only-Read) + ein paar Nachrichten eines ZWEITEN Autors,
    // damit die Boot-Phase echte Profil-/Sync-Wellen hat (nicht nur eine Nachricht).
    nak(['event', '--auth', '--sec', NSEC, '-k', '9021', '-t', `h=${h}`, ZOOID_WS])
    nak(['event', '--auth', '--sec', ADMIN_HEX, '-k', '9', '-t', `h=${h}`, '-c', 'Erste Zeile für die Boot-Phase.', ZOOID_WS])
    nak(['event', '--auth', '--sec', ADMIN_HEX, '-k', '9', '-t', `h=${h}`, '-c', 'Zweite Zeile, damit der Verlauf atmet.', ZOOID_WS])

    // Eine pro Lauf eindeutige Video-URL → Anfragen darauf sind eindeutig zählbar.
    const videoUrl = `https://blossom.einundzwanzig.space/e2e-flakern-${h}.mp4`
    const videoId = eventId(nak([
        'event', '--auth', '--sec', ADMIN_HEX, '-k', '9', '-t', `h=${h}`,
        '-c', videoUrl,
        '-t', `imeta=url ${videoUrl};m video/mp4;size ${MP4.length}`,
        ZOOID_WS,
    ]))

    await installiereChurnZaehler(page)
    let anfragen = 0
    page.on('request', (r) => {
        if (r.url().includes(`e2e-flakern-${h}`)) {
            anfragen++
        }
    })
    // Der Spieler lädt direkt vom Blossom-Origin (ungeschützter Zweig) — Anfragen nie
    // rauslassen, lokal mit dem akzeptierten Minimal-MP4 beantworten.
    await page.route(`**/e2e-flakern-${h}.mp4`, (route) =>
        route.fulfill({ status: 200, contentType: 'video/mp4', body: MP4 }),
    )

    await useZooid(page)
    await loginNsec(page, NSEC)
    await page.goto(`/rooms/${h}`)

    await expect(page.locator('video.chat-video')).toBeAttached({ timeout: 20_000 })
    await page.waitForTimeout(3_000)

    // Live-Welle provozieren: eine NACH dem Boot eintreffende Nachricht zwingt den Feed
    // zum Re-Map der ganzen Liste — genau die Klasse, auf der das Flackern beruhen soll.
    nak(['event', '--auth', '--sec', ADMIN_HEX, '-k', '9', '-t', `h=${h}`, '-c', 'Nachrücker nach der Boot-Phase.', ZOOID_WS])
    await expect(page.getByText('Nachrücker nach der Boot-Phase.')).toBeVisible({ timeout: 15_000 })

    // Boot-Phase abwarten: Relay-Sync, Profil-Hydration, Reactions/Zaps-Wellen laufen
    // über ~2–3 s ein (throttled-Quellen à 100/200 ms).
    await page.waitForTimeout(4_000)

    // ── Phase 2: der Riegel (x-html-stable) an einer Churn-Quelle, die die stabile
    //    Zeilen-Identität alleine NICHT stilllegt. Eine Reaction auf die Video-Nachricht
    //    ändert legit ihre Kern-Daten (Chip-Zähler) → Zeile wird neu gebaut → x-html-
    //    Effect refiret mit IDENTISCHEM String. Ohne Guard zerstört das innerHTML das
    //    Video. Derselbe Stress für den Thread-Kopf: deriveThread baut threadRoot bei
    //    jeder Welle als frisches Objekt. Deshalb vorher den Thread öffnen — sein Kopf
    //    zeigt dasselbe Video-Markup.
    // Die Zeile mit dem Video: chat-row-Wurzel ist `div.group`; der Video-Text IST nicht
    // Text (der Player ersetzt die URL), also über das Kindelement filtern.
    const videoZeile = page.locator('div.group').filter({ has: page.locator('video.chat-video') }).first()
    await videoZeile.hover()
    await videoZeile.getByRole('button', { name: 'Im Thread antworten' }).click()
    await expect(page.locator('[x-ref="rootBody"] video.chat-video')).toBeAttached({ timeout: 10_000 })
    await page.waitForTimeout(1_500)

    const churn1 = await leseChurn(page)
    const anfragenVorReaction = anfragen
    nak(['event', '--auth', '--sec', ADMIN_HEX, '-k', '7', '-t', `e=${videoId}`, '-t', `h=${h}`, '-c', '+', ZOOID_WS])
    // Reaction-Chip (👍, Zähler erscheint erst ab 2) als Beweis, dass die Welle ankam.
    // toBeAttached: das Thread-Overlay verdeckt die Raum-Zeile — „sichtbar" wäre die
    // falsche Forderung, der Chip muss nur im Baum stehen.
    await expect(page.locator('button[aria-pressed]', { hasText: '👍' })).toBeAttached({ timeout: 15_000 })
    await page.waitForTimeout(3_000)

    const churn = await leseChurn(page)
    const ersetzt = churn.videoErsetzt
    console.log(`[flakern] h=${h} sets=${churn.sets} videoErsetzt=${ersetzt} identitySwitches=${churn.identitySwitches} listeNeuZugewiesen=${churn.listeNeuZugewiesen} videoMsgNeuGemappt=${churn.videoMsgNeuGemappt} mp4Anfragen=${anfragen} (vor Reaction: ${anfragenVorReaction}, Sets vorher: ${churn1.sets})`)
    console.log('[flakern] log:', JSON.stringify(churn.log))

    // Nach dem ersten Render darf das Video-Element nicht mehr ersetzt worden sein —
    // weder in der Raum-Zeile noch im Thread-Kopf, weder durch Re-Map noch durch die
    // Reaction-Welle mit identischem HTML-String.
    expect(ersetzt, 'Video-Element darf nach dem ersten Render nicht ersetzt werden').toBe(0)
    // Genau zwei Video-Elemente existieren legit: Raum-Zeile + Thread-Kopf.
    expect(churn.identitySwitches, 'Video-Element-Identitäten: Raum-Zeile + Thread-Kopf, sonst keine').toBeLessThanOrEqual(2)
    expect(anfragen - anfragenVorReaction, 'die Reaction-Welle darf keinen neuen Video-Load auslösen').toBe(0)
    expect(anfragen, 'stabile Player laden je einmal Metadata (preload=metadata)').toBeLessThanOrEqual(4)

    // Bild-Beleg: Raum-Zeile + geöffneter Thread-Kopf mit ungestörtem Player.
    await page.screenshot({ path: 'test-results/flakern-nachher.png', fullPage: false })
})

async function leseChurn(page: Page): Promise<{ added: number; removed: number; identitySwitches: number; sets: number; videoErsetzt: number; listeNeuZugewiesen: number; videoMsgNeuGemappt: number; log: string[] }> {
    return page.evaluate(() => (window as unknown as { __videoChurn: { added: number; removed: number; identitySwitches: number; sets: number; videoErsetzt: number; listeNeuZugewiesen: number; videoMsgNeuGemappt: number; log: string[] } }).__videoChurn)
}
