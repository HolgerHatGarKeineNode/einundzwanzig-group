/**
 * **Der Gegenbeweis zur Prävention** (`support/hermetik.ts` + ihre Verdrahtung in
 * `playwright.config.ts` und `support/fixtures.ts`).
 *
 * Der Relay-Wächter aus P0 urteilt im Fixture-ABBAU. Das reicht, solange die Suite nur
 * liest: man erfährt hinterher, dass die Messung nichts wert war. Ab der schreibenden
 * Phase reicht es nicht — ein signiertes Nostr-Ereignis ist zu diesem Zeitpunkt bereits
 * publiziert, und publiziert heißt bei Nostr unwiderruflich. Diese Datei belegt die
 * andere Hälfte: **eine fremde Herkunft kommt gar nicht erst zustande.**
 *
 * ── Warum eine lokale Sonde und kein fremder Rechner ────────────────────────────────
 *
 * Ein Beweis der Form „wir haben den Produktions-Relay angesprochen und es kam nichts an"
 * ist keiner: er setzt genau den Kontakt voraus, den er ausschließen soll, und ein
 * Fehlschlag der Prävention wäre unmittelbar der Schaden. Der Aufbau hier dreht das um:
 *
 * - Ein **lokaler TCP-Server** (`net`) zählt angenommene Verbindungen. Er ist die
 *   Messstelle: 0 heißt „nichts hat den Zielrechner erreicht".
 * - `--host-resolver-rules` bildet {@link SONDE_HOST} auf `127.0.0.1` ab (die Regel steht
 *   in `hermetik.ts`, die MAP bewusst VOR der Sperre — sonst gewänne die Sperre). Damit
 *   ist die Sonde ein **fremder Name auf einem lokalen Server**: für die Prävention
 *   ununterscheidbar von `nostr.einundzwanzig.space`, für die Maschine harmlos.
 * - Die **Positivkontrolle steht im selben Test**: derselbe Server, derselbe Browser,
 *   angesprochen über `127.0.0.1` — dort MUSS die Verbindung ankommen. Ohne sie wäre die
 *   0 aus dem Fremdfall nichtssagend (ein nie startender Server zählt auch 0).
 *
 * ── Was hier NICHT bewiesen wird ────────────────────────────────────────────────────
 *
 * Nur der **Browser**. Der PHP-Prozess (`ProfileCache`, Artikel-Flächen) und `nak` öffnen
 * ihre Verbindungen selbst; kein Chromium-Flag und keine Playwright-Route erreicht sie.
 * Deren Absicherung ist der ENV-Riegel (`testServerEnv`, `serverEnv.nodetest.ts`) — und
 * die ist SETZEND, nicht prüfend. Wer aus dieser Datei „die Suite ist hermetisch" liest,
 * liest zwei Drittel zu viel; der Absatz steht ausführlich im Kopf von `hermetik.ts`.
 */
import { test, expect } from './support/fixtures'
import { SCHATTEN_SONDE_HOST, SONDE_HOST, SPERR_MARKE } from './support/hermetik'
import net from 'node:net'

type Sonde = { port: number; treffer: () => number; stop: () => Promise<void> }

/**
 * Ein lokaler TCP-Server auf einem freien Port, der jede angenommene Verbindung zählt
 * und sofort verwirft.
 *
 * Kein WebSocket-Server: Chromium meldet einen Socket bereits, wenn die **TCP-Verbindung
 * steht** (gemessen in P0, Tabelle in `relayGuard.ts`) — und für die Frage „hat etwas den
 * Zielrechner erreicht" ist genau das die Schwelle. Ein vollständiger Handschlag wäre
 * mehr Aufbau ohne mehr Aussage.
 *
 * Port 0 heißt „vom Kernel einen freien geben lassen": kollisionsfrei auch bei sechs
 * parallelen Workern und zwei gleichzeitig laufenden Suiten (`E2E_SLOT_OFFSET`).
 */
async function starteSonde(): Promise<Sonde> {
    let treffer = 0
    const server = net.createServer((socket) => {
        treffer += 1
        socket.destroy()
    })
    await new Promise<void>((fertig) => server.listen(0, '127.0.0.1', fertig))
    const adresse = server.address()
    if (adresse === null || typeof adresse === 'string') {
        throw new Error('Sonde: kein Port — ohne Messstelle ist dieser Test wertlos.')
    }

    return {
        port: adresse.port,
        treffer: () => treffer,
        stop: () => new Promise<void>((fertig) => server.close(() => fertig())),
    }
}

/**
 * Öffnet den Socket in der Seite und meldet, wie der Versuch geendet ist.
 *
 * `wurf` ist der interessante Fall: die Prävention verhindert, indem der KONSTRUKTOR
 * wirft — es entsteht kein Socket, es gibt also weder `open` noch `close` noch einen
 * Schließcode. Ein Test, der auf einen Schließcode wartete, liefe hier in seinen Timeout
 * und wäre aus dem falschen Grund rot.
 */
async function versuche(
    page: import('./support/fixtures').Page,
    url: string,
): Promise<{ wurf: string | null; code: number | null; offen: boolean }> {
    return page.evaluate(
        (ziel) =>
            new Promise<{ wurf: string | null; code: number | null; offen: boolean }>((fertig) => {
                let offen = false
                let ws: WebSocket
                try {
                    ws = new WebSocket(ziel)
                } catch (fehler) {
                    fertig({ wurf: String((fehler as Error)?.message ?? fehler), code: null, offen: false })

                    return
                }
                ws.onopen = () => {
                    offen = true
                }
                ws.onclose = (e) => fertig({ wurf: null, code: e.code, offen })
                // Kein `onerror`-Zweig: Chromium feuert `error` und `close` beide, und nur
                // `close` trägt den Code.
                setTimeout(() => fertig({ wurf: null, code: null, offen }), 5000)
            }),
        url,
    )
}

test('Prävention: ein fremder Name erreicht den Zielrechner NICHT — derselbe Server über 127.0.0.1 schon', async ({
    page,
    relayWaechter,
}) => {
    const sonde = await starteSonde()
    const fremd = `ws://${SONDE_HOST}:${sonde.port}/`
    const lokal = `ws://127.0.0.1:${sonde.port}/`
    // Der Fremdfall ist eine erwartete SPERRE (nicht eine Freigabe — die gäbe es für eine
    // fremde Herkunft auch gar nicht mehr); der lokale Fall ist ein zweiter lokaler Port
    // und damit eine gewöhnliche Freigabe.
    relayWaechter.sperreErwartet(fremd)
    relayWaechter.erlaube(lokal)

    try {
        await page.goto('/')

        const gesperrt = await versuche(page, fremd)
        expect(
            sonde.treffer(),
            'die Prävention hat die Verbindung durchgelassen — ein Schreibvorgang wäre hier draußen',
        ).toBe(0)
        expect(gesperrt.offen, 'der Socket ging auf, obwohl er gesperrt sein sollte').toBe(false)
        // Auf die eigene MARKE geprüft, nicht auf „irgendein Fehler": ein Wurf oder ein
        // Fehlschlag käme auch von einem toten Port, und der Fall könnte dann nicht
        // unterscheiden, ob die Prävention gegriffen hat oder ob nur niemand lauschte.
        expect(gesperrt.wurf, 'der Konstruktor hat nicht geworfen — die Sperre kam von woanders').toContain(
            SPERR_MARKE,
        )

        // ── Die Positivkontrolle ────────────────────────────────────────────────────
        // Ohne sie sagte die 0 oben nichts: ein Server, der gar nicht lauscht, zählt
        // ebenfalls 0. Derselbe Server, dieselbe Seite, nur die Herkunft ist loopback.
        const durchgelassen = await versuche(page, lokal)
        expect(
            sonde.treffer(),
            'die Sonde hat auch über 127.0.0.1 nichts gesehen — sie misst nichts',
        ).toBeGreaterThan(0)
        expect(durchgelassen.wurf, 'die Prävention hat AUCH das Loopback gesperrt').toBe(null)
    } finally {
        await sonde.stop()
    }
})

test('Prävention: die Sperre bleibt nicht still — der Wächter bekommt sie zu sehen', async ({
    page,
    relayWaechter,
}) => {
    // Der teuerste denkbare Fehler an dieser Stelle wäre eine Prävention, die verhindert
    // UND schweigt: gemessen am 2026-08-21 erzeugt ein abgefangener Socket **kein**
    // `page.on('websocket')`-Ereignis mehr — der Wächter wäre also blind geworden, der
    // Test bliebe grün, und dass eine Fläche nach draußen greift, erführe niemand.
    // Deshalb trägt der WebSocket-Wrapper seinen Vermerk selbst in die Aufzeichnung.
    const sonde = await starteSonde()
    const fremd = `ws://${SONDE_HOST}:${sonde.port}/`
    relayWaechter.sperreErwartet(fremd)

    try {
        await page.goto('/')
        await versuche(page, fremd)

        const vermerke = relayWaechter.gesehen().filter((eintrag) => eintrag.includes(SONDE_HOST))
        expect(vermerke, 'der Wächter hat von der gesperrten Verbindung nichts mitbekommen').toHaveLength(1)
        expect(vermerke[0]).toContain(fremd)
        expect(vermerke[0]).toContain(SPERR_MARKE)
    } finally {
        await sonde.stop()
    }
})

test('Prävention: ein nicht gemappter Name löst gar nicht erst auf — die Schicht ohne Fixture', async ({ page }) => {
    // **Warum dieser Fall über HTTP läuft und nicht über einen WebSocket:** der Wrapper aus
    // `fixtures.ts` fängt JEDE fremde WS-Herkunft ab und käme der Resolver-Regel immer
    // zuvor — über einen WebSocket sind die beiden Schichten nicht auseinanderzuhalten.
    // HTTP fasst die Route nicht an, die Resolver-Regel schon. Und genau diese Schicht
    // ist die einzige, die auch für die drei Specs ohne unsere Fixtures greift
    // (`support/specImporte.nodetest.ts` führt sie namentlich).
    const sonde = await starteSonde()
    const hole = async (url: string): Promise<void> => {
        try {
            await page.goto(url, { timeout: 10_000 })
        } catch {
            // Erwartet: die Sonde verwirft die Verbindung sofort (ERR_EMPTY_RESPONSE),
            // ein nicht auflösender Name endet als ERR_NAME_NOT_RESOLVED. Gemessen wird
            // nicht die Fehlermeldung, sondern was am Zielrechner ANKAM.
        }
    }

    try {
        // Gemessen wird der ZUWACHS, nicht der Absolutwert: Chromium baut pro `goto` auf
        // eine sofort verworfene Verbindung zwei TCP-Verbindungen auf (Wiederholversuch
        // nach ERR_EMPTY_RESPONSE, gemessen 2026-08-21). Eine feste Zahl wäre hier ein
        // Test über Chromiums Wiederholstrategie, nicht über unsere Prävention.
        const vorLoopback = sonde.treffer()
        await hole(`http://127.0.0.1:${sonde.port}/`)
        expect(sonde.treffer(), 'die Sonde sieht nicht einmal das Loopback — sie misst nichts').toBeGreaterThan(
            vorLoopback,
        )

        // Positivkontrolle für die MAP: ein FREMDER Name, den die Regel ausdrücklich auf
        // 127.0.0.1 zeigt, kommt an. Ohne diesen Fall wäre der ausbleibende Zuwachs unten
        // auch mit einem grundsätzlich kaputten `.invalid`-Handling vereinbar.
        const vorMap = sonde.treffer()
        await hole(`http://${SONDE_HOST}:${sonde.port}/`)
        expect(sonde.treffer(), 'die gemappte fremde Herkunft kam nicht an — die MAP wirkt nicht').toBeGreaterThan(
            vorMap,
        )

        // Und der eigentliche Fall — mit dem BESCHATTETEN Zwilling, nicht mit irgendeinem
        // fremden Namen. Ein beliebiger `.invalid`-Name löst auch ohne unsere Regel
        // nirgendwohin auf; ein Test mit ihm wäre grün geblieben, als die Sperre zur Probe
        // entzahnt wurde (gemessen 2026-08-21) und hätte nur bewiesen, dass Unauflösbares
        // unauflösbar ist. Der Zwilling IST gemappt — nur eben hinter der Sperre. Fällt
        // sie weg, zeigt er auf diese Sonde hier und der Zähler springt.
        const vorFremd = sonde.treffer()
        await hole(`http://${SCHATTEN_SONDE_HOST}:${sonde.port}/`)
        expect(sonde.treffer(), 'die Resolver-Sperre greift nicht — der fremde Name kam durch').toBe(vorFremd)
    } finally {
        await sonde.stop()
    }
})

test('Prävention: ERLAUBTE Sockets laufen weiter auf der nativen Implementierung', async ({ page }) => {
    // **Der Fall, der eine echte Regression gekostet hat.** Gebaut war die Prävention
    // zuerst mit `context.routeWebSocket`. Sie sperrte zuverlässig, die Sonde zählte 0,
    // der Gegenbeweis war grün — und der Buzz-Arm wurde rot: die Seite zeigte eine
    // gesendete Nachricht, der Relay hatte sie nie. Der Grund: eine registrierte
    // `routeWebSocket` ersetzt `window.WebSocket` für die GANZE Seite durch eine Attrappe
    // (`class WebSocket extends WebSocketMock`), auch für Herkünfte, die ihr Muster gar
    // nicht trifft.
    //
    // Die damalige Messung hatte nur GEZÄHLT, ob am Zielrechner etwas ankommt. Die Frage
    // „verhalten sich die erlaubten Sockets noch wie vorher" stand nicht darin — deshalb
    // steht sie jetzt hier, und zwar an der Stelle, an der der Unterschied sichtbar ist:
    // bei der Attrappe ist `send` kein nativer Code mehr.
    await page.goto('/')

    const abdruck = await page.evaluate(() => ({
        konstruktor: String(window.WebSocket),
        sendNativ: String(WebSocket.prototype.send).includes('[native code]'),
        closeNativ: String(WebSocket.prototype.close).includes('[native code]'),
        konstanten: [WebSocket.CONNECTING, WebSocket.OPEN, WebSocket.CLOSING, WebSocket.CLOSED],
    }))

    expect(abdruck.sendNativ, `WebSocket.prototype.send ist nicht mehr nativ — die Seite fährt eine Attrappe`).toBe(
        true,
    )
    expect(abdruck.closeNativ, 'WebSocket.prototype.close ist nicht mehr nativ').toBe(true)
    // Der Proxy erbt die statischen Konstanten vom Original; eine handgeschriebene
    // Wrapper-Funktion hätte sie einzeln kopieren müssen und genau hier verloren.
    expect(abdruck.konstanten).toEqual([0, 1, 2, 3])
    // Und die Attrappe würde sich hier verraten: `class WebSocket extends WebSocketMock`.
    expect(abdruck.konstruktor).not.toContain('WebSocketMock')
})

test('Prävention: eine fremde Herkunft lässt sich nicht per erlaube() freischalten', async ({ relayWaechter }) => {
    // Der Riegel am Riegel. Bis P6 prüfte `erlaube()` nur die Lesbarkeit der URL; eine
    // einzige Zeile im Test hätte den Wächter für den Produktions-Relay geöffnet. Dass
    // die Prävention ihn zusätzlich sperrt, macht die Verengung nicht überflüssig — sie
    // verhindert, dass ein Test GRÜN behauptet, was gar nicht stattgefunden hat.
    expect(() => relayWaechter.erlaube('wss://nostr.einundzwanzig.space/')).toThrow(/Loopback/)
    expect(() => relayWaechter.erlaube('ws://127.0.0.1:3999/')).not.toThrow()
})
