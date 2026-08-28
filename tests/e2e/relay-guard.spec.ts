/**
 * **Selbsttest des Relay-Wächters** (`support/relayGuard.ts` + seine Verdrahtung in
 * `support/fixtures.ts`).
 *
 * Der Wächter ist ein Tor: er entscheidet, ob ein Lauf überhaupt gegen den gemeinten
 * Relay gemessen hat. Ein Tor, das still zu nichts verkommt, ist teurer als keines — es
 * erzeugt Vertrauen, das es nicht deckt. Deshalb prüft diese Datei ausdrücklich die
 * Hälfte, die sonst niemand prüft: **wird ein fremder Socket überhaupt BEOBACHTET?**
 *
 * Die andere Hälfte — welche Herkunft erlaubt ist — steht rein und ohne Browser in
 * `support/relayGuard.nodetest.ts` (14 Fälle, inkl. „unlesbare URL fällt nach Verstoß"
 * und „leere Erlaubnisliste verwirft alles"). Zusammen decken beide den Wächter ganz ab.
 *
 * **Warum die Beobachtung hier positiv geprüft wird und nicht über einen roten Test:**
 * Ein Nachweis der Form „dieser Test wird rot" lässt sich nicht dauerhaft grün in einer
 * Suite halten; er wäre ein einmaliger Wegwerf-Beleg gewesen. Gefahren wurde er trotzdem
 * (P0, 2026-08-20): eine Verbindung nach `wss://nostr.einundzwanzig.space/` aus einem
 * ansonsten grünen Testrumpf ließ der Wächter mit genau der Meldung scheitern, die
 * `verstossMeldung` baut. Was hier bleibt, ist der Teil, der von selbst verrottet, wenn
 * niemand hinsieht: die Verdrahtung an den Browser.
 *
 * ── Die gemessene GRENZE des Wächters ───────────────────────────────────────────────
 *
 * Chromium meldet einen WebSocket erst, wenn die TCP-Verbindung STEHT. Gemessen am
 * 2026-08-20 aus derselben Seite, drei Ziele, direkter `page.on('websocket')` und
 * Wächter sahen jeweils dasselbe:
 *
 * | Ziel                                   | readyState | beobachtet |
 * |----------------------------------------|-----------:|------------|
 * | `ws://localhost:3999/` (niemand hört)  |  3 CLOSED  | **nein**   |
 * | `ws://127.0.0.1:<serve>/` (HTTP, 400)  |  3 CLOSED  | ja         |
 * | `wss://nostr.einundzwanzig.space/`     |  1 OPEN    | ja         |
 *
 * Der blinde Fleck ist also der Fall, in dem die TCP-Verbindung nicht zustande kommt —
 * und der Fall, um den es geht (ein erreichbarer fremder Relay), liegt vollständig im
 * Sichtfeld.
 *
 * **Hier stand „kein Byte erreicht einen fremden Rechner". Das war zu weit gefasst:** für
 * einen fremden Hostnamen, der nicht auflöst, verlässt die DNS-Anfrage sehr wohl die
 * Maschine, und für `wss://` mit ungültigem Zertifikat steht der SNI-Name schon beim
 * Fremden. Gemessen wurde nur ein LOKALER Port ohne Zuhörer. Die Korrektur ändert nichts
 * am Wächter, aber sie ist der Unterschied zwischen einer Grenze, die man kennt, und
 * einer, die man zu kennen glaubt. Die Lücke selbst schließt seit dem P7-Gate die
 * Prävention (`support/hermetik.ts`, Gegenbeweis in `relay-praevention.spec.ts`).
 */
import { test, expect } from './support/fixtures'
import { ZOOID_URL, ZOOID_WS } from './support/zooid'
import { BUZZ_URL, BUZZ_WS } from './support/buzz'

/**
 * Der eigene Relay dieses Laufs — je nach Arm der zooid oder der Buzz-Stack.
 *
 * Diese Datei läuft seit dem P7-Gate in BEIDEN Armen (`BUZZ_SPECS` in
 * `playwright.config.ts`): der Wächter ist im Buzz-Arm genauso scharf, seine
 * Verdrahtungsprüfung lief dort aber nicht mit. Der Fall unten braucht dafür einen Relay,
 * der auch WIRKLICH lauscht — im Buzz-Arm startet `workerBackend` **keinen** zooid, ein
 * `ws://localhost:3335/` liefe dort in einen toten Port, würde von Chromium gar nicht erst
 * gemeldet und die Gegenprobe wäre aus dem falschen Grund rot.
 */
const eigenerRelay = process.env.E2E_RELAY === 'buzz' ? { url: BUZZ_URL, ws: BUZZ_WS } : { url: ZOOID_URL, ws: ZOOID_WS }

/**
 * Ein erreichbarer Socket AUSSERHALB der Erlaubnisliste, ohne Fremd-Rechner: der eigene
 * `serve`-Port. Er spricht HTTP, lehnt den WS-Handschlag also ab — die TCP-Verbindung
 * steht dabei trotzdem, und genau das ist die Bedingung fürs Beobachtetwerden (s. o.).
 * Die Erlaubnisliste führt bewusst nur die beiden RELAY-Ports; der `serve`-Port gehört
 * nicht dazu.
 */
const serveWs = (baseURL: string): string => `ws://127.0.0.1:${new URL(baseURL).port}/`

/** Öffnet den Socket in der Seite und wartet, bis er entschieden ist. */
async function oeffne(page: import('./support/fixtures').Page, url: string): Promise<void> {
    await page.evaluate(async (ziel) => {
        const ws = new WebSocket(ziel)
        await new Promise((r) => {
            ws.onopen = r
            ws.onerror = r
            ws.onclose = r
            setTimeout(r, 2000)
        })
        ws.close()
    }, url)
}

test('Standard-Seite: ein Socket außerhalb der Erlaubnisliste wird beobachtet', async ({
    page,
    baseURL,
    relayWaechter,
}) => {
    const fremd = serveWs(baseURL as string)
    // Freigabe, damit dieser Test grün bleiben DARF — der Nachweis steckt in `gesehen()`,
    // nicht in der Farbe. Ohne die Freigabe wäre er rot, und zwar zu Recht.
    relayWaechter.erlaube(fremd)

    await page.goto('/')
    await oeffne(page, fremd)

    expect(relayWaechter.gesehen()).toContain(fremd)
})

test('Selbst angelegter Kontext (browser.newContext): ebenso beobachtet', async ({
    browser,
    baseURL,
    relayWaechter,
}) => {
    // Sechs Bestands-Specs legen ihre Kontexte direkt am `browser` an
    // (`read-state-sync.spec.ts:295`, `buzz-room.spec.ts:361`, `pin-room.spec.ts:469/608`,
    // `onboarding.spec.ts:165`, `locale-switch.spec.ts:89`). Ein Wächter, der nur den
    // Standard-Kontext sieht, wäre dort blind — dieser Fall hält die Umhüllung von
    // `browser.newContext` fest.
    const fremd = serveWs(baseURL as string)
    relayWaechter.erlaube(fremd)

    const kontext = await browser.newContext({ baseURL })
    try {
        const seite = await kontext.newPage()
        await seite.goto('/')
        await oeffne(seite, fremd)
    } finally {
        await kontext.close()
    }

    expect(relayWaechter.gesehen()).toContain(fremd)
})

test('Der eigene Relay steht auf der Erlaubnisliste — kein Fehlalarm', async ({ page, relayWaechter }) => {
    // Die Gegenprobe. Ohne sie wäre nicht auszuschließen, dass der Wächter schlicht ALLES
    // beanstandet und die beiden Fälle oben nur wegen ihrer Freigabe grün sind.
    await page.goto('/')
    await oeffne(page, eigenerRelay.url)

    expect(relayWaechter.gesehen()).toContain(eigenerRelay.url)
    // Kein `erlaube()` in diesem Test: bliebe der eigene Relay hier hängen, machte der
    // Wächter diesen Test im Abbau rot — und das wäre die Regression, die jeden anderen
    // Test der Suite mitrisse.
    //
    // Die BASIS ausgeschrieben, je Arm: zooid 3335, Buzz 3001 — plus die Slot-Nummer.
    // Ohne diese Zeile prüfte der Fall die Konstante gegen sich selbst und bliebe grün,
    // wenn `ZOOID_WS` eines Tages auf einen fremden Host zeigte.
    //
    // Hier stand bis zum 2026-08-28 eine Portreihe als Muster (`33\d\d` / `30\d\d`).
    // Das trug nur bis `E2E_SLOT_OFFSET` 64: ab 65 ist der zooid-Port 3400 und die
    // Zusage fiel, obwohl nichts kaputt war. Genau dieser Fehlschlag ist an einem Tag
    // mit 27 verschiedenen Offsets (bis 90) zweimal aufgetreten und hat Fehlersuche
    // gekostet — der Offset-Mechanismus ist ausdrücklich dafür gebaut, dass mehrere
    // Agenten gleichzeitig messen, und eine Zusage darüber muss das aushalten.
    // Die Basis bleibt die festgehaltene Zahl: zeigte das Modul auf einen fremden
    // Host oder auf den Mitschau-zooid (:3334), fällt der Test weiterhin.
    const slot = Number(process.env.TEST_PARALLEL_INDEX ?? '0') + Number(process.env.E2E_SLOT_OFFSET ?? '0')
    const basis = process.env.E2E_RELAY === 'buzz' ? 3001 : 3335
    expect(eigenerRelay.ws).toBe(`ws://localhost:${basis + slot}`)
})
