/**
 * **Der Relay-Wächter — welche WebSocket-Herkunft darf ein Test überhaupt anfassen?**
 *
 * Diese Datei ist bewusst **rein**: keine Imports, kein Playwright, kein Dateisystem.
 * Die Verdrahtung an den Browser steht in `fixtures.ts`; hier steht nur die Entscheidung,
 * und die ist damit unter `node --test` prüfbar statt nur im laufenden Playwright
 * (dieselbe Aufteilung wie `runMarkers.ts` — und aus demselben Grund: eine Regel, die
 * nur im Ernstfall ausgewertet wird, wird nie an ihren Rändern gemessen).
 *
 * ── Warum es den Wächter gibt ───────────────────────────────────────────────────────
 *
 * Die Hermetik der Suite hängt an drei Stellen, die alle **setzen** und keine, die
 * **prüft**: `support/serverEnv.ts` überschreibt die sieben `NOSTR_*`-Schlüssel in der
 * Server-ENV jedes gespawnten PHP-Prozesses, `support/zooid.ts` schiebt dem Browser per
 * `addInitScript` seine Quelle unter, und `support/articles.ts` rechnet die nak-Ziel-URL
 * aus dem eigenen Worker-Port. Fällt eine dieser Stellen aus — eine neue Fläche liest
 * ihre Relay-URL woanders her, ein `addInitScript` läuft zu spät, ein Default im
 * Produktcode greift — dann redet der Testlauf mit einem fremden Relay, und **nichts
 * sagt es**. Der Lauf ist grün, die Messung war eine andere.
 *
 * Deshalb ist die Frage hier umgedreht: nicht „haben wir überall den richtigen Wert
 * gesetzt", sondern „hat diese Seite je etwas anderes angefasst als ihre zwei eigenen
 * Ports". Das ist die einzige Formulierung, die auch das fängt, woran niemand gedacht hat.
 *
 * ── Fail-closed, und zwar an jeder Kante ────────────────────────────────────────────
 *
 * Eine URL, die sich nicht parsen lässt, gilt als **Verstoß** — nicht als „unbekannt,
 * also durch". Eine leere Liste gesehener Sockets ist kein Verstoß (viele Tests reden mit
 * keinem Relay), aber eine Erlaubnisliste, die leer ist, verwirft ausnahmslos alles.
 * Der teuerste Fehler, den ein Wächter machen kann, ist still zu nichts zu verkommen.
 *
 * ── Die GRENZE, gemessen statt geschätzt ────────────────────────────────────────────
 *
 * Chromium meldet einen WebSocket erst, wenn die **TCP-Verbindung steht**. Gemessen am
 * 2026-08-20 aus einer Testseite, drei Ziele, direkter `page.on('websocket')` und dieser
 * Wächter sahen jeweils dasselbe: `ws://localhost:3999/` (niemand hört) → readyState 3,
 * **nicht** beobachtet · `ws://127.0.0.1:<serve>/` (HTTP, lehnt den Handschlag ab) →
 * readyState 3, beobachtet · `wss://nostr.einundzwanzig.space/` → readyState 1,
 * beobachtet.
 *
 * **Der blinde Fleck ist damit der Fall, in dem die TCP-Verbindung nicht zustande kommt**
 * — und das ist NICHT dasselbe wie „kein Byte hat einen fremden Rechner erreicht", auch
 * wenn hier ursprünglich genau das stand. Die Aussage hält für den gemessenen Fall (ein
 * lokaler Port, auf dem niemand lauscht: das SYN geht an den eigenen Kernel). Sie hält
 * **nicht** für einen fremden Hostnamen, der nicht auflöst — die DNS-Anfrage verlässt die
 * Maschine —, und für `wss://` mit ungültigem Zertifikat ist sie von den drei Messungen
 * gar nicht abgedeckt: dort steht der SNI-Name bereits beim Fremden, bevor irgendetwas
 * scheitert. Der Schaden ist in beiden Fällen gering, die Behauptung war trotzdem weiter
 * als die Messung. Seit dem P7-Gate deckt die **Prävention** (`hermetik.ts`) genau diese
 * Lücke: eine fremde Herkunft löst gar nicht erst auf.
 *
 * Angenehmer Nebeneffekt der Grenze: die beiden Bestands-Konstruktionen mit absichtlich
 * totem Socket (`support/verein.ts` `stubDeadSpace` auf `ws://127.0.0.1:1/`,
 * `longform-reader.spec.ts` `SILENT_BOARD_PORT`) brauchen keine Freigabe.
 *
 * ── Warum Herkunft (Host + Port) und nicht die ganze URL ────────────────────────────
 *
 * Dieselbe Instanz wird im Repo in vier Schreibweisen genannt: `ws://localhost:3335`,
 * `ws://localhost:3335/` (welshmans `normalizeRelayUrl` hängt den Schrägstrich an),
 * `ws://127.0.0.1:3335` und mit angehängtem Pfad. Ein String-Vergleich über die volle URL
 * wäre an dieser Kosmetik gescheitert und hätte den Wächter zu einer Quelle falscher
 * Alarme gemacht — die schaltet man nach dem dritten Mal ab. Verglichen wird deshalb
 * `host:port`; die **rohe** URL steht trotzdem in der Meldung, denn sie ist das, was der
 * Leser danach sucht.
 */

/** Ein Erlaubnis-Eintrag: `host:port`, kleingeschrieben. */
export type Herkunft = string

/** Standard-Port je Schema — für die Fälle, in denen die URL keinen nennt. */
const STANDARD_PORT: Record<string, string> = {
    'ws:': '80',
    'wss:': '443',
    'http:': '80',
    'https:': '443',
}

/**
 * `ws://localhost:3335/` → `localhost:3335`. `null`, wenn die URL unlesbar ist.
 *
 * `null` ist **nicht** „egal": der Aufrufer behandelt es als Verstoß (siehe
 * {@link verstoesse}). Eine URL, die dieser Prozess nicht versteht, hat der Browser
 * sehr wohl verstanden — sonst hätte er keine Verbindung gemeldet.
 */
export const herkunft = (url: string): Herkunft | null => {
    try {
        const u = new URL(url)
        const port = u.port || STANDARD_PORT[u.protocol] || ''
        if (u.hostname === '' || port === '') {
            return null
        }

        return `${u.hostname.toLowerCase()}:${port}`
    } catch {
        return null
    }
}

/** Die Ports, die EIN Playwright-Worker sich selbst aufgesetzt hat. */
export type SlotPorts = {
    /** `workerInfo.parallelIndex + E2E_SLOT_OFFSET` — die Slot-Nummer dieses Workers. */
    slot: number
}

/** Basisport der zooid-Testinstanz (`support/zooid.ts:17`, `runMarkers.ts`). */
export const ZOOID_BASE_PORT = 3335
/** Basisport des Buzz-Test-Relays (`support/buzz.ts:19`, `runMarkers.ts`). */
export const BUZZ_BASE_PORT = 3001

/**
 * Die Herkünfte, die dieser Worker ungefragt anfassen darf: **sein** zooid und **sein**
 * Buzz-Relay, je in beiden Schreibweisen des Loopbacks.
 *
 * **Beide Arme, obwohl ein Lauf nur einen fährt** — genau wie bei den Lauf-Markern
 * (`runMarkers.ts`): `workspaces.spec.ts` braucht beide Stacks gleichzeitig, das ist
 * ausdrücklich seine Aussage. Eine Erlaubnisliste, die den Modus errät, wäre dort falsch.
 *
 * **Was NICHT drinsteht, und warum das Absicht ist:**
 * - Der `serve`-Port (8137+slot) und der Board-`serve` (8437+slot) sprechen HTTP. Taucht
 *   dort je ein WebSocket auf, ist das ein Befund (Vite-HMR im Testlauf), keine Erlaubnis.
 * - **Ein FREMDER Slot ist ein Verstoß, kein Detail.** Zwei gleichzeitig laufende Suiten
 *   auf verschiedenen `E2E_SLOT_OFFSET` sind der Normalfall auf dieser Maschine; ein Test,
 *   der den zooid des Nachbarn anspricht, misst dessen Zustand mit. Genau deshalb steht
 *   hier `slot` und nicht „irgendein Loopback-Port".
 */
export const erlaubteHerkuenfte = ({ slot }: SlotPorts): Herkunft[] => {
    const ports = [ZOOID_BASE_PORT + slot, BUZZ_BASE_PORT + slot]

    return ports.flatMap((port) => [`localhost:${port}`, `127.0.0.1:${port}`])
}

/**
 * Die Verstöße unter den gesehenen Sockets — rohe URLs, dedupliziert, in der Reihenfolge
 * des ersten Auftretens.
 *
 * Die Reihenfolge ist nicht Kosmetik: die ERSTE fremde Verbindung ist die, die den Weg
 * erklärt; alles danach ist oft nur ihr Wiederholungsversuch.
 */
export const verstoesse = (gesehen: readonly string[], erlaubt: readonly Herkunft[]): string[] => {
    const erlaubtSet = new Set(erlaubt)
    const treffer: string[] = []
    const gesehenSet = new Set<string>()
    for (const url of gesehen) {
        if (gesehenSet.has(url)) {
            continue
        }
        gesehenSet.add(url)
        const h = herkunft(url)
        // `h === null` ⇒ unlesbar ⇒ Verstoß. Fail-closed, siehe Modulkopf.
        if (h === null || !erlaubtSet.has(h)) {
            treffer.push(url)
        }
    }

    return treffer
}

/**
 * Die Meldung. Sie nennt **die verletzende URL und den Test** — ein Wächter, der beim
 * Scheitern nur „failed" sagt, kostet eine Debug-Runde, und die ist teurer als er selbst.
 *
 * Dazu die Erlaubnisliste im Klartext: der häufigste echte Fall ist nicht Bösartigkeit,
 * sondern ein Test, der bewusst einen dritten lokalen Port benutzt (ein toter Socket, ein
 * schweigender Relay) und die Freigabe vergessen hat. Wer die Liste sieht, sieht sofort,
 * dass ihm eine Zeile fehlt — und welche.
 */
export const verstossMeldung = (titel: string, treffer: readonly string[], erlaubt: readonly Herkunft[]): string =>
    [
        `Relay-Wächter: dieser Test hat eine WebSocket-Verbindung außerhalb seiner eigenen Worker-Ports geöffnet.`,
        `  Test:      ${titel}`,
        `  Verstöße:  ${treffer.join('\n             ')}`,
        `  Erlaubt:   ${erlaubt.join(', ')}`,
        ``,
        `  Ist die Verbindung beabsichtigt (toter Socket, schweigender Relay, zweiter lokaler Port),`,
        `  dann melde sie IM TEST an: test('…', async ({ page, relayWaechter }) => { relayWaechter.erlaube('ws://localhost:3999/') … })`,
        `  Ist sie es nicht, misst dieser Lauf gegen einen fremden Relay — und sein Grün sagt nichts.`,
    ].join('\n')
