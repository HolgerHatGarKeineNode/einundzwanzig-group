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
 * Der blinde Fleck ist also genau der Fall, in dem **kein Byte** einen fremden Rechner
 * erreicht hat — und der Fall, um den es geht (ein erreichbarer fremder Relay), liegt
 * vollständig im Sichtfeld. Das ist keine Beschönigung, sondern die Grenze, die ein
 * Leser kennen muss, bevor er dem Wächter mehr zutraut, als er zusagt.
 */
import { test, expect } from './support/fixtures'
import { ZOOID_URL, ZOOID_WS } from './support/zooid'

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
    await oeffne(page, ZOOID_URL)

    expect(relayWaechter.gesehen()).toContain(ZOOID_URL)
    // Kein `erlaube()` in diesem Test: bliebe der eigene Relay hier hängen, machte der
    // Wächter diesen Test im Abbau rot — und das wäre die Regression, die jeden anderen
    // Test der Suite mitrisse.
    expect(ZOOID_WS).toMatch(/^ws:\/\/localhost:33\d\d$/)
})
