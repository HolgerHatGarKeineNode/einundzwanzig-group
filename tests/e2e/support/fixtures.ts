import { test as base, expect, type BrowserContext, type Page, type Locator } from '@playwright/test'
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { erlaubteHerkuenfte, herkunft, verstoesse, verstossMeldung, type Herkunft } from './relayGuard'
import { LOOPBACK_HOSTS, MELDE_BINDUNG, SPERR_MARKE, istLoopbackHerkunft, sperrVermerk, wrapperQuelle } from './hermetik'
import { testServerEnv } from './serverEnv'
import {
    ERLAUBNISLISTE,
    istRauschen,
    pageFehlerMeldung,
    verstoesse as pageFehlerVerstoesse,
    type PageFehler,
} from './pageErrorGuard'

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
type Aufzeichnung = { gesehen: string[]; zusaetzlich: Herkunft[]; quittiert: string[]; pageFehler: PageFehler[] }

let aufzeichnung: Aufzeichnung | null = null

/** Was ein Test dem Wächter über seine Absicht sagen kann. */
export type RelayWaechter = {
    /**
     * Eine zusätzliche Herkunft für DIESEN Test freigeben — z. B. den absichtlich toten
     * Socket (`support/verein.ts` `stubDeadSpace`) oder einen zweiten lokalen Port
     * (`longform-reader.spec.ts` `SILENT_BOARD_PORT`). Nimmt volle URLs.
     *
     * **Nur Loopback.** Eine fremde Herkunft wirft — der Wächter lässt sich von seinem
     * Prüfling nicht entschärfen. Begründung an der werfenden Stelle.
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
    /**
     * **Eine von der Prävention GESPERRTE Verbindung quittieren** — ausschließlich für
     * den Gegenbeweis in `relay-praevention.spec.ts`.
     *
     * Der Gegenbeweis muss absichtlich eine fremde Herkunft ansprechen, um zu zeigen,
     * dass sie nicht durchkommt. Ohne diese Quittung machte ihn der Wächter im Abbau
     * rot — der einzige Test, der die Prävention belegt, wäre damit nicht dauerhaft grün
     * zu halten, und genau solche Belege verschwinden nach dem dritten Mal aus der Suite.
     *
     * **Warum das kein Schlupfloch ist:** quittiert wird nur, was den Vermerk der
     * Prävention trägt (`sperrVermerk`, gesetzt allein im WebSocket-Wrapper). Eine
     * TATSÄCHLICH zustande gekommene fremde Verbindung steht roh in der Aufzeichnung,
     * trägt diesen Vermerk nicht und bleibt deshalb ein Verstoß — auch wenn jemand
     * genau ihre URL hier hineinschriebe. Die Quittung kann also bestätigen, dass etwas
     * verhindert wurde, aber niemals erlauben, dass etwas stattfindet.
     */
    sperreErwartet: (...urls: string[]) => void
}

/** Schon gesicherte Kontexte — ein zweiter Zuhörer brächte nur doppelte Einträge. */
const beobachtet = new WeakSet<BrowserContext>()

/**
 * **Beobachten UND verhindern** — beides je Kontext, in einem Zug.
 *
 * Die Beobachtung: jede Seite dieses Kontexts (auch später geöffnete) meldet ihre
 * WebSockets. `context.pages()` ist für den Fall da, dass der Kontext seine Seite schon
 * hat; `on('page')` für alles danach — Popups, `newPage()` in einem Test, der zweite Tab
 * (`unread-dot.spec.ts:388`).
 *
 * Die Verhinderung (`addInitScript`-Wrapper um `window.WebSocket`, zweite Schicht neben
 * `--host-resolver-rules` in `playwright.config.ts`): der Konstruktor **wirft** für eine
 * fremde Herkunft, es entsteht also gar kein Socket. Belegt gegen einen lokalen
 * TCP-Sonden-Server: die Sonde zählte 0 angenommene Verbindungen, die identische Anfrage
 * ohne Wrapper zählte 1 (Messtabelle in `hermetik.ts`, Gegenbeweis in der Suite:
 * `relay-praevention.spec.ts`).
 *
 * **Warum kein `context.routeWebSocket`, obwohl der Plan es nennt:** es war zuerst so
 * gebaut, sperrte zuverlässig — und machte den Buzz-Arm rot. Eine registrierte
 * `routeWebSocket` ersetzt `window.WebSocket` für die GANZE Seite durch eine Attrappe
 * (`class WebSocket extends WebSocketMock`, `send` nicht mehr nativ), auch für Herkünfte,
 * die ihr Muster nicht trifft. Herleitung und Messtabelle stehen im Kopf von `hermetik.ts`.
 *
 * **Warum der Wrapper selbst meldet:** ein verhinderter Socket entsteht nie und erzeugt
 * deshalb kein `page.on('websocket')`-Ereignis. Ohne die Meldung wäre die Prävention
 * zugleich blind — die Verbindung verhindert und unsichtbar, der Test grün, und dass eine
 * Fläche nach draußen greift, erführe niemand. Der Vermerk ist für `herkunft()` bewusst
 * keine gültige Erlaubnis: er fällt so oder so nach „Verstoß" und macht den Test im Abbau
 * rot. Verhindern ohne Melden wäre die halbe Arbeit.
 *
 * **Die Reihenfolge zählt:** ein `addInitScript` gilt erst ab der nächsten Navigation.
 * Deshalb wird hier direkt beim Anlegen des Kontexts gesichert (und nicht etwa beim ersten
 * `goto`), und deshalb ist `sichere` async.
 */
const sichere = async (context: BrowserContext): Promise<void> => {
    if (beobachtet.has(context)) {
        return
    }
    beobachtet.add(context)
    const anSeite = (page: Page): void => {
        /**
         * **Eine bekannte fail-open-Stelle, bewusst offen gelassen — hier, nicht im Plan.**
         *
         * `aufzeichnung?.` verwirft das Ereignis STILL, wenn gerade keine Aufzeichnung
         * läuft: in einem `beforeAll`, in einem `afterAll`, zwischen zwei Tests eines
         * Workers. Ein Socket, der in einem dieser Fenster aufgeht, wird nicht bewacht und
         * fällt auch niemandem auf.
         *
         * Heute folgenlos: vier Specs haben ein `beforeAll`, keines davon öffnet eine
         * Seite, alle publizieren über `nak`. **Ein künftiges `beforeAll`, das eine Seite
         * öffnet, wäre unbewacht** — und das ist der Satz, wegen dem dieser Kommentar hier
         * steht und nicht in einem Dokument, das beim Schreiben eines `beforeAll` niemand
         * liest.
         *
         * Die PRÄVENTION ist davon unberührt: sie hängt am Kontext, nicht an der
         * Aufzeichnung, und sperrt auch in diesen Fenstern. Was fehlt, ist die Meldung —
         * also genau die Hälfte, die einem sagt, dass etwas zu reparieren ist.
         */
        page.on('websocket', (ws) => aufzeichnung?.gesehen.push(ws.url()))
        /**
         * **Der Laufzeit-Wächter (`pageErrorGuard.ts`) — derselbe blinde Fleck wie oben,
         * bewusst geteilt.** `aufzeichnung?.` verwirft still, außerhalb eines Tests; siehe
         * Begründung am WebSocket-Listener direkt darüber.
         *
         * `pageerror` ist die primäre Quelle: Alpine fängt einen Ausdrucksfehler
         * (`x-text`, `x-on:…`) selbst ab, meldet ihn per `console.warn` UND wirft ihn
         * bewusst erneut in einem `setTimeout` — genau DAS wird hier zur uncaught
         * exception und damit zu diesem Ereignis (Beleg im Kopf von `pageErrorGuard.ts`).
         * `console.error` wird zusätzlich beobachtet und dabei um bekanntes Netzwerk-/
         * Werkzeug-Rauschen bereinigt ({@link istRauschen}) — sonst überwiegt in der
         * Aufzeichnung sofort die Menge der absichtlich provozierten Netzwerkfehler.
         */
        page.on('pageerror', (err) => aufzeichnung?.pageFehler.push({ quelle: 'pageerror', text: err.message }))
        page.on('console', (msg) => {
            if (msg.type() === 'error' && !istRauschen(msg.text())) {
                aufzeichnung?.pageFehler.push({ quelle: 'console', text: msg.text() })
            }
        })
    }
    context.pages().forEach(anSeite)
    context.on('page', anSeite)

    await context.exposeBinding(MELDE_BINDUNG, (_quelle, url: string) => {
        aufzeichnung?.gesehen.push(sperrVermerk(url))
    })
    await context.addInitScript({
        content: wrapperQuelle({ erlaubteHosts: LOOPBACK_HOSTS, marke: SPERR_MARKE, bindung: MELDE_BINDUNG }),
    })
}

/**
 * Introspektion für den Selbstnachweis des Laufzeit-Wächters (`page-error-guard.spec.ts`),
 * genau wie `RelayWaechter.gesehen()` — Begründung dort: ein negativer Nachweis (Test wird
 * rot) lässt sich nicht dauerhaft grün in der Suite halten, ein positiver schon.
 */
export type PageErrorWaechter = {
    gesehen: () => readonly PageFehler[]
}

export const test = base.extend<{ relayWaechter: RelayWaechter; pageErrorWaechter: PageErrorWaechter }, { workerBackend: void }>({
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
                    // Die gesamte Server-ENV steht seit dem P7-Gate an EINER Stelle:
                    // `support/serverEnv.ts`. Vorher war dieser Block an drei Orten von
                    // Hand dupliziert (hier, `board-fixtures.ts`, und gar nicht in den
                    // beiden `tinker`-Spawns) — zweimal ist dabei ein Relay-Schlüssel
                    // durchgerutscht, beide Male von einem Menschen beim Lesen gefunden
                    // und nie von einem Test. `serverEnv.nodetest.ts` gewinnt die Liste
                    // der zu neutralisierenden Schlüssel jetzt aus `config/`.
                    //
                    // Die Reihenfolge ist tragend: die Überlagerung MUSS hinter
                    // `...process.env` stehen, sonst gewinnt die `.env` des Rechners.
                    env: { ...process.env, ...testServerEnv({ slot }) },
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
                await sichere(context)

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
            const lauf: Aufzeichnung = { gesehen: [], zusaetzlich: [], quittiert: [], pageFehler: [] }
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
                            if (!istLoopbackHerkunft(h)) {
                                // **Eine Freigabe gilt nur fürs Loopback.** Bis P6 prüfte
                                // diese Stelle nur die LESBARKEIT — `erlaube('wss://nostr.
                                // einundzwanzig.space/')` wäre angenommen worden, und der
                                // einzige Riegel gegen einen Produktions-Relay wäre damit
                                // per Einzeiler im Test abschaltbar gewesen. Ein Wächter,
                                // den sein Prüfling selbst entschärfen kann, ist keiner.
                                //
                                // Der Verzicht kostet nichts: alle drei Bestandsaufrufe
                                // geben `ws://127.0.0.1:<port>/` frei (`nostr-login`,
                                // `verein-buzz-reconnect`, `relay-guard`) — sie melden
                                // eigene, im Test gestartete Server an. Und weiter als
                                // hierhin darf keine Freigabe reichen, weil die Prävention
                                // (`hermetik.ts`) fremde Herkünfte ohnehin sperrt: eine
                                // Freigabe darüber hinaus wäre eine Zusage ohne Deckung.
                                throw new Error(
                                    `relayWaechter.erlaube: "${url}" ist keine Loopback-Adresse. Freigeben lassen sich nur ` +
                                        `lokale Server, die der Test selbst startet (localhost, 127.0.0.1, [::1]). Eine fremde ` +
                                        `Herkunft sperrt die Prävention unabhängig davon — siehe support/hermetik.ts.`,
                                )
                            }
                            lauf.zusaetzlich.push(h)
                        }
                    },
                    gesehen: () => [...lauf.gesehen],
                    sperreErwartet: (...urls: string[]) => {
                        // Quittiert wird der VERMERK, nicht die URL: nur was die
                        // Prävention selbst als gesperrt eingetragen hat, kann hier
                        // wegfallen. Begründung am Typ.
                        lauf.quittiert.push(...urls.map(sperrVermerk))
                    },
                })
            } finally {
                aufzeichnung = null
            }

            const treffer = verstoesse(
                lauf.gesehen.filter((eintrag) => !lauf.quittiert.includes(eintrag)),
                erlaubt(),
            )
            // Der Titelpfad (Projekt + Datei + Test), NICHT nur `testInfo.title`: die
            // Erlaubnisliste unterscheidet u. a. zwei gleichnamige Tests in zwei Dateien
            // (`page-error-guard.spec.ts`), und ein Muster gegen den nackten Titel könnte
            // beide zugleich treffen.
            const pageTitel = testInfo.titlePath.join(' > ')
            const pageTreffer = pageFehlerVerstoesse(lauf.pageFehler, pageTitel, ERLAUBNISLISTE)

            // Beide Urteile werden VOR dem ersten Wurf berechnet und, falls nötig, in
            // EINER Meldung zusammengeführt — sonst verdeckt ein früher Wurf den zweiten
            // Befund, und der nächste Lauf entdeckt ihn erst nach dem Beheben des ersten.
            const meldungen: string[] = []
            if (treffer.length > 0) {
                meldungen.push(verstossMeldung(testInfo.title, treffer, erlaubt()))
            }
            if (pageTreffer.length > 0) {
                meldungen.push(pageFehlerMeldung(pageTitel, pageTreffer))
            }
            if (meldungen.length > 0) {
                throw new Error(meldungen.join('\n\n'))
            }
        },
        { auto: true },
    ],

    // Rein lesend, siehe {@link PageErrorWaechter}. Kein `auto`, keine Ordnungs-Abhängigkeit
    // nötig: der Zugriff passiert im Testrumpf, wenn `aufzeichnung` längst gesetzt ist.
    pageErrorWaechter: async ({}, use) => {
        await use({ gesehen: () => [...(aufzeichnung?.pageFehler ?? [])] })
    },

    /**
     * Nur zur Reihenfolge: erzwingt, dass `relayWaechter` fertig ist, bevor der Kontext
     * (und damit die erste Seite) entsteht. Playwright löst Fixtures nach ihren
     * Abhängigkeiten auf; ohne diese Zeile wäre die Reihenfolge zweier gleichrangiger
     * Test-Fixtures nicht zugesichert — dieselbe Begründung wie beim `workerBackend` in
     * `board-fixtures.ts`.
     */
    context: async ({ relayWaechter, context }, use) => {
        void relayWaechter
        await sichere(context)
        await use(context)
    },
})

export { expect, type Page, type Locator }
