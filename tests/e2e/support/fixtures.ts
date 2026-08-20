import { test as base, expect, type BrowserContext, type Page, type Locator } from '@playwright/test'
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { erlaubteHerkuenfte, herkunft, verstoesse, verstossMeldung, type Herkunft } from './relayGuard'

/**
 * Pro-Worker-Backend-Isolation für echte Parallelität (§Test-Speed): jeder Playwright-
 * Worker fährt SEINE eigene `php artisan serve`- + zooid-Instanz auf worker-spezifischen
 * Ports hoch (serve = 8137+slot, zooid = 3335+slot; `slot` = parallelIndex). Dadurch
 * teilen sich Tests verschiedener Worker WEDER Nostr-Relay-Räume (Schreib-Kollisionen)
 * NOCH die Laravel-Session/Cache:
 *   - zooid je Worker: eigenes data-/config-Verzeichnis (siehe zooid-testserver.sh).
 *   - serve je Worker: SESSION_DRIVER=cookie + CACHE_STORE=array → KEINE SQLite-Schreib-
 *     Contention über Worker (Domänendaten liegen ohnehin client-seitig in welshman).
 * Der Vite-Build läuft EINMAL in global-setup; hier wird nur noch `serve` gestartet.
 *
 * Specs importieren `test`/`expect` aus DIESER Datei (statt '@playwright/test'), damit
 * das worker-scoped Backend automatisch pro Worker hochfährt.
 */

/**
 * Fester Versatz auf BEIDE Port-Reihen (serve + zooid), Default 0 → Verhalten
 * unverändert. Rettung, wenn ein fremder Prozess einen Slot-Port belegt: sonst bindet
 * der eigene `serve` nicht, `waitForHttp` bejaht die FREMDE App und der Test läuft
 * gegen sie (404 statt Login). Spiegelt `E2E_SLOT_OFFSET` aus support/zooid.ts.
 */
const SLOT_OFFSET = Number(process.env.E2E_SLOT_OFFSET ?? '0')

// `E2E_RELAY=buzz|zooid` (Default zooid) — siehe support/global-setup.ts + support/buzz.ts.
// Im Buzz-Modus seedet global-setup.ts den GETEILTEN Docker-Stack einmalig VOR allen
// Workern; hier gibt es dann nichts pro Worker zu seeden (kein Pro-Worker-zooid-Äquivalent).
const relayMode = (): 'zooid' | 'buzz' => (process.env.E2E_RELAY === 'buzz' ? 'buzz' : 'zooid')

/** Pollt, bis `serve` HTTP beantwortet (< 500). Wirft nach `timeoutMs`. */
const waitForHttp = async (url: string, timeoutMs = 60_000): Promise<void> => {
    const deadline = Date.now() + timeoutMs
    for (;;) {
        try {
            const res = await fetch(url)
            if (res.status < 500) {
                return
            }
        } catch {
            // Port bindet noch nicht — gleich erneut versuchen.
        }
        if (Date.now() > deadline) {
            throw new Error(`php artisan serve auf ${url} kam nicht hoch`)
        }
        await new Promise((r) => setTimeout(r, 250))
    }
}

/**
 * ── Der Relay-Wächter ───────────────────────────────────────────────────────────────
 *
 * Die Entscheidung („welche Herkunft ist erlaubt") steht rein in `relayGuard.ts`; hier
 * steht nur, wo die Beobachtung herkommt und wann sie ausgewertet wird.
 *
 * **Warum die Auswertung am ENDE des Tests steht und nicht beim Öffnen des Sockets:**
 * Ein Wurf im Event-Handler landet nicht zuverlässig im Testergebnis (Playwright zählt
 * ihn je nach Zeitpunkt gar nicht), und eine Freigabe (`erlaube()`) darf auch NACH dem
 * ersten Socket noch gelten — der Test soll seine Absicht erklären dürfen, ohne auf die
 * Reihenfolge der Zeilen zu achten. Gesammelt wird deshalb still, geurteilt einmal.
 * Ein Wurf im Abbau macht den Test rot, auch wenn sein Rumpf durchgelaufen ist — genau
 * das ist gemeint mit fail-closed.
 *
 * **Warum die Aufzeichnung eine Modulvariable ist:** Ein Playwright-Worker ist ein
 * Prozess und fährt genau EINEN Test zur Zeit; die Zuordnung ist damit eindeutig. Der
 * Umweg wird gebraucht, weil die Beobachtung an einem WORKER-Objekt hängt (`browser`),
 * das Urteil aber zu einem TEST gehört.
 */
type Aufzeichnung = { gesehen: string[]; zusaetzlich: Herkunft[] }

let aufzeichnung: Aufzeichnung | null = null

/** Was ein Test dem Wächter über seine Absicht sagen kann. */
export type RelayWaechter = {
    /**
     * Eine zusätzliche Herkunft für DIESEN Test freigeben — z. B. den absichtlich toten
     * Socket (`support/verein.ts` `stubDeadSpace`) oder einen zweiten lokalen Port
     * (`longform-reader.spec.ts` `SILENT_BOARD_PORT`). Nimmt volle URLs.
     */
    erlaube: (...urls: string[]) => void
    /**
     * Die bisher beobachteten Socket-URLs dieses Tests — roh, in Reihenfolge, mit
     * Wiederholungen.
     *
     * Steht ausschließlich für den Selbsttest des Wächters (`relay-guard.spec.ts`) da.
     * Ohne diesen Zugriff wäre die BEOBACHTUNG nur negativ prüfbar (ein Test wird rot),
     * und ein negativer Nachweis lässt sich nicht dauerhaft grün in der Suite halten —
     * das Ergebnis wäre ein Wegwerf-Beleg statt eines Ankers. Kein Produktivtest sollte
     * das hier brauchen.
     */
    gesehen: () => readonly string[]
}

/** Schon beobachtete Kontexte — ein zweiter Zuhörer brächte nur doppelte Einträge. */
const beobachtet = new WeakSet<BrowserContext>()

/**
 * Jede Seite dieses Kontexts (auch später geöffnete) meldet ihre WebSockets.
 *
 * `context.pages()` ist für den Fall da, dass der Kontext seine Seite schon hat;
 * `on('page')` für alles danach — Popups, `newPage()` in einem Test, der zweite Tab
 * (`unread-dot.spec.ts:388`).
 */
const beobachte = (context: BrowserContext): void => {
    if (beobachtet.has(context)) {
        return
    }
    beobachtet.add(context)
    const anSeite = (page: Page): void => {
        page.on('websocket', (ws) => aufzeichnung?.gesehen.push(ws.url()))
    }
    context.pages().forEach(anSeite)
    context.on('page', anSeite)
}

export const test = base.extend<{ relayWaechter: RelayWaechter }, { workerBackend: void }>({
    // Worker-scoped + auto: läuft EINMAL je Worker vor dessen Tests. Seedet die worker-
    // eigene zooid-Instanz (blockierend, race-frei) und startet den worker-eigenen serve.
    workerBackend: [
        async ({}, use, workerInfo) => {
            const slot = workerInfo.parallelIndex + SLOT_OFFSET
            const zooidPort = 3335 + slot
            const servePort = 8137 + slot

            if (relayMode() === 'zooid') {
                execFileSync('bash', ['tests/e2e/support/zooid-testserver.sh'], {
                    env: { ...process.env, ZOOID_PORT: String(zooidPort) },
                    stdio: 'inherit',
                })
            } else {
                // Buzz genauso pro Worker wie zooid: eigener Compose-Stack auf
                // `3001 + slot`, eigenes Projekt, eigene Volumes. Vorher lief das
                // einmalig in global-setup.ts, und die Suite war auf `workers: 1`
                // festgenagelt — der einzige Grund für 13–15 min statt 2 (siehe
                // support/buzz.ts für die Messung).
                execFileSync('bash', ['tests/e2e/support/buzz-testserver.sh'], {
                    env: { ...process.env, BUZZ_TEST_PORT: String(3001 + slot) },
                    stdio: 'inherit',
                })
            }

            const serve: ChildProcess = spawn(
                'php',
                ['artisan', 'serve', '--port', String(servePort)],
                {
                    // Default-DB-Sessions/-Cache BLEIBEN: der NIP-98-Login-Handoff legt den
                    // k1-Challenge im (geteilten) DB-Cache ab und liest ihn beim POST wieder
                    // — cookie-Sessions/array-Cache brachen genau das. Für die 6 parallelen
                    // serves die geteilte SQLite nebenläufig-tauglich machen: WAL (Leser
                    // blocken den Schreiber nicht) + busy_timeout (Schreib-Lock kurz warten
                    // statt sofort „database is locked"). Rein additiv über env — prod bleibt
                    // bei null (config/database.php).
                    env: {
                        ...process.env,
                        VITE_HOT_FILE: '/tmp/e2e-vite-never-hot',
                        DB_JOURNAL_MODE: 'WAL',
                        DB_BUSY_TIMEOUT: '5000',
                        // Der PHP-Built-in-Server ist sonst single-threaded → serialisiert
                        // schon HTML- + Asset-Chunk-Requests EINES Page-Loads. Server-Workers
                        // bedienen sie parallel → schnellerer Seiten-Aufbau je Test. Mit
                        // DB-Cache (nicht array) teilen alle Worker-Prozesse den k1-Challenge.
                        PHP_CLI_SERVER_WORKERS: '4',
                        // Hermetik des SERVERS. `ProfileCache` (GET /nostr/profiles) fragt
                        // sonst den Profil-Indexer `wss://purplepag.es/` — eine echte
                        // WebSocket-Verbindung ins öffentliche Internet, aus jedem Testlauf.
                        // Leer = nur der eigene Space-Relay wird gefragt.
                        NOSTR_PROFILE_INDEXER: '',
                        // …und der „eigene Space" ist im Test der WORKER-Relay, nicht der
                        // Mitschau-zooid aus der lokalen .env. Ohne das fragte der Server
                        // :3334 nach Profilen, die nur auf :3335+ liegen, und schrieb das
                        // Ergebnis („abwesend", 24 h) in den geteilten Cache-Store.
                        NOSTR_SPACE_URL: `ws://localhost:${zooidPort}`,
                        // …und die ARTIKEL-Quelle bleibt hier ausdrücklich LEER.
                        //
                        // Der Grund ist derselbe Mechanismus wie zwei Zeilen darueber, nur
                        // an einer Variablen, die es hier bis P0 nicht gab: dieser `serve`
                        // erbt `...process.env`, und `playwright.config.ts:3` lädt vorher
                        // die lokale `.env` in genau dieses `process.env`. Steht dort ein
                        // `NOSTR_BOARD_URL` — und `.env.example:27` führt die Variable, das
                        // Longform-Vorhaben ist der Anlass, sie auf den PRODUKTIONS-Board-
                        // Relay zu setzen —, dann rendert dieser GETEILTE Server für alle
                        // ~60 Specs die Artikel-Einstiege (`@if ($hasBoard)`), und jede Seite,
                        // die `/articles` berührt, spricht den öffentlichen Relay an. Lesend
                        // heute, schreibend ab der Kommentar-Phase.
                        //
                        // Leer heißt hier NICHT „Default": die Fläche zeigt dann ihren
                        // ehrlichen „keine Quelle"-Zustand und schickt keinen einzigen REQ
                        // (`⚡articles.blade.php` `@if (! config('group.board_relay_url'))`,
                        // `longformFeed.ts` `BOARD_URL`). Genau dieser Zustand ist es, den
                        // die Bestandssuite bisher gemessen hat — der Riegel hält ihn fest,
                        // statt ihn der `.env` des jeweiligen Rechners zu überlassen.
                        //
                        // `board-fixtures.ts` ist davon unberührt: es spawnt einen ZWEITEN,
                        // eigenen `serve` mit eigenem env-Objekt und setzt `NOSTR_BOARD_URL`
                        // dort selbst auf den worker-eigenen zooid. Diese Zeile kann ihn
                        // nicht erreichen — verifiziert, nicht angenommen (siehe P0-Bericht).
                        NOSTR_BOARD_URL: '',
                    },
                    stdio: 'ignore',
                },
            )
            await waitForHttp(`http://127.0.0.1:${servePort}`)

            await use()

            serve.kill()
        },
        // `timeout` statt der 30-s-Vorgabe: das ERSTE Aufsetzen einer zooid-Instanz
        // (Räume anlegen, 2×60 Nachrichten seeden, NIP-86) dauert seriell gemessen
        // 17-18 s je Relay — sechs Worker parallel reißen die Frist. Der Fehlschlag
        // sieht dann aus wie ein Testfehler, ist aber keiner: Playwright meldet
        // `Fixture "workerBackend" timeout … during setup` und lässt die Tests des
        // Workers mit **0 ms** fallen. Genau das Rauschen, das einen Anker irgendwann
        // weggeklickt statt gelesen bekommt (gemessen 2026-07-23: 10 Tests à 0 ms).
        { scope: 'worker', auto: true, timeout: 120_000 },
    ],

    // baseURL je Worker auf dessen serve-Port (überschreibt use.baseURL aus der Config).
    baseURL: async ({}, use, testInfo) => {
        await use(`http://127.0.0.1:${8137 + testInfo.parallelIndex + SLOT_OFFSET}`)
    },

    /**
     * **Jeder Kontext dieses Workers wird beobachtet — auch die, die ein Test selbst
     * anlegt.**
     *
     * `browser.newContext()` wird hier einmalig umhüllt, statt nur den eingebauten
     * `context`-Fixture zu überschreiben. Der Grund steht in sechs Spec-Dateien:
     * `read-state-sync.spec.ts:295`, `buzz-room.spec.ts:361`, `pin-room.spec.ts:469/608`,
     * `onboarding.spec.ts:165` und `locale-switch.spec.ts:89` legen ihre Kontexte direkt
     * am `browser` an. Ein Wächter, der nur den Standard-Kontext sieht, wäre in genau
     * diesen Tests blind — und ein blinder Fleck in einem fail-closed-Riegel ist
     * schlimmer als kein Riegel, weil er Vertrauen erzeugt, das er nicht deckt.
     *
     * Der eingebaute `context`-Fixture stammt seinerseits aus `browser.newContext()` und
     * ist damit mitgedeckt. Nachgewiesen, nicht angenommen: der Wegwerf-Nachweis in
     * `relay-guard-selbsttest.spec.ts` öffnet den Fremd-Socket EINMAL aus der Standard-
     * Seite und EINMAL aus einem selbst angelegten Kontext.
     */
    browser: [
        async ({ browser }, use) => {
            const original = browser.newContext.bind(browser)
            browser.newContext = async (...args: Parameters<typeof original>) => {
                const context = await original(...args)
                beobachte(context)

                return context
            }

            await use(browser)

            browser.newContext = original
        },
        { scope: 'worker' },
    ],

    /**
     * Der Wächter selbst: `auto`, damit ihn kein Test vergessen kann.
     *
     * `relayWaechter` steht bewusst VOR `context` in dessen Abhängigkeiten (siehe unten)
     * — die Aufzeichnung muss stehen, bevor die erste Seite existiert.
     */
    relayWaechter: [
        async ({}, use, testInfo) => {
            const lauf: Aufzeichnung = { gesehen: [], zusaetzlich: [] }
            aufzeichnung = lauf
            const erlaubt = (): Herkunft[] => [
                ...erlaubteHerkuenfte({ slot: testInfo.parallelIndex + SLOT_OFFSET }),
                ...lauf.zusaetzlich,
            ]

            try {
                await use({
                    erlaube: (...urls: string[]) => {
                        for (const url of urls) {
                            // DIESELBE Umrechnung wie beim Urteil (`herkunft`), nicht eine
                            // zweite daneben — sonst laufen Freigabe und Prüfung
                            // irgendwann auseinander und der Wächter meldet einen Verstoß,
                            // den der Test längst freigegeben hat.
                            const h = herkunft(url)
                            if (h === null) {
                                // Eine unlesbare Freigabe ist ein Tippfehler, und ein
                                // stillschweigend verworfener Tippfehler wäre genau die
                                // Freigabe, die im Ernstfall fehlt.
                                throw new Error(`relayWaechter.erlaube: "${url}" ist keine lesbare WebSocket-URL.`)
                            }
                            lauf.zusaetzlich.push(h)
                        }
                    },
                    gesehen: () => [...lauf.gesehen],
                })
            } finally {
                aufzeichnung = null
            }

            const treffer = verstoesse(lauf.gesehen, erlaubt())
            if (treffer.length > 0) {
                throw new Error(verstossMeldung(testInfo.title, treffer, erlaubt()))
            }
        },
        { auto: true },
    ],

    /**
     * Nur zur Reihenfolge: erzwingt, dass `relayWaechter` fertig ist, bevor der Kontext
     * (und damit die erste Seite) entsteht. Playwright löst Fixtures nach ihren
     * Abhängigkeiten auf; ohne diese Zeile wäre die Reihenfolge zweier gleichrangiger
     * Test-Fixtures nicht zugesichert — dieselbe Begründung wie beim `workerBackend` in
     * `board-fixtures.ts`.
     */
    context: async ({ relayWaechter, context }, use) => {
        void relayWaechter
        beobachte(context)
        await use(context)
    },
})

export { expect, type Page, type Locator }
