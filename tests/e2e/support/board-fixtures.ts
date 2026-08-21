import { test as base, expect, type Page, type Locator } from './fixtures'
import { spawn, type ChildProcess } from 'node:child_process'

/**
 * EIGENER `php artisan serve`-Prozess für `longform-reader.spec.ts` (P7) — mit
 * `NOSTR_BOARD_URL` in der SERVER-ENV gesetzt.
 *
 * **Warum nicht einfach `fixtures.ts` erweitern:** Ob `/articles` seinen Leerzustand oder
 * die Insel zeigt, entscheidet `@if (! config('group.board_relay_url'))` — SERVER-seitig,
 * beim Request. `window.__nostrBoard` per `addInitScript` (wie `useZooid()` es für den
 * Space tut) kommt zu spät: das Gate steht schon im ausgelieferten HTML, bevor der Browser
 * überhaupt ein Script ausführt. Der Wert muss also in der ENV des `serve`-Prozesses stehen.
 *
 * `fixtures.ts` spawnt GENAU EINEN `serve`-Prozess je Worker, und ALLE anderen 40+ Specs
 * dieses Workers teilen ihn sich. `NOSTR_BOARD_URL` DORT zu setzen, änderte serverseitig
 * gerendertes Markup, das andere Specs nicht erwarten (z. B. die neue „Artikel
 * lesen"-Zeile auf `⚡spaces.blade.php`, sobald `board_relay_url` nicht mehr leer ist) —
 * und `fixtures.ts` selbst bleibt dafür BYTE-IDENTISCH unverändert (siehe `git diff` im
 * Bericht). Diese Datei ERWEITERT `fixtures.ts` (nicht `@playwright/test` direkt) — der
 * `workerBackend`-Fixture dort bleibt scharf und setzt den worker-eigenen zooid auf
 * `3335+slot` weiterhin auf, genau wie für jede andere Spec. Zusätzlich fährt diese Datei
 * einen ZWEITEN, eigenen `serve`-Prozess auf einem eigenen Port hoch, der GENAU DIESELBE
 * zooid-Instanz als Space UND als Board anspricht — nur Tests, die `boardServer`/die hier
 * überschriebene `baseURL` anfordern (also nur `longform-reader.spec.ts`), zahlen dafür.
 *
 * Der Board-Relay ist hier BEWUSST derselbe zooid wie der reguläre Space: kind 30023 ist
 * ein ganz normales adressierbares NIP-01-Event (`nostr.Kind.IsAddressable()`,
 * `zooid/events.go:415`), am worker-eigenen zooid empirisch bestätigt (`nak event -k 30023
 * -d draft-… --auth --sec $ADMIN`, 2026-08-12 gegen `ws://localhost:3335` — Publish UND
 * Requery erfolgreich). Ein zweiter Relay-Prozess brächte keinen Erkenntnisgewinn, nur
 * mehr Infrastruktur.
 */

const SLOT_OFFSET = Number(process.env.E2E_SLOT_OFFSET ?? '0')

/** Pollt, bis der Board-`serve` HTTP beantwortet — Kopie aus `fixtures.ts` (siehe dortiger
 *  Kommentar zur Duplikation der ARIA-Extraktion in `EmptyStatesAndA11yTest.php`: dieselbe
 *  10-Zeilen-Funktion an zwei Stellen ist billiger als eine gemeinsame Abhängigkeit
 *  zwischen zwei Fixture-Dateien, die sonst nichts teilen). */
async function waitForHttp(url: string, timeoutMs = 60_000): Promise<void> {
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
            throw new Error(`Board-serve auf ${url} kam nicht hoch`)
        }
        await new Promise((r) => setTimeout(r, 250))
    }
}

export const test = base.extend<object, { boardServer: string }>({
    // Worker-scoped, NICHT auto: initialisiert nur, wenn ein Test in DIESER Datei
    // tatsächlich `boardBaseURL` anfordert (Playwright startet Fixtures lazy). Jede
    // andere Spec-Datei im selben Lauf sieht diesen Prozess nie.
    boardServer: [
        // `workerBackend` explizit als Abhängigkeit destrukturiert (auch wenn ungenutzt):
        // erzwingt bei Playwright, dass der zooid-/Seed-Fixture aus `fixtures.ts` ZUERST
        // fertig ist — beide sind worker-scoped, ohne diese Abhängigkeit wäre die
        // Reihenfolge zweier gleichrangiger Worker-Fixtures nicht garantiert, und dieser
        // `serve` verwiese sonst möglicherweise auf einen zooid, der noch gar nicht lauscht.
        async ({ workerBackend }, use, workerInfo) => {
            void workerBackend
            const slot = workerInfo.parallelIndex + SLOT_OFFSET
            // Eigener Port-Bereich, kollidiert mit keinem bestehenden (serve 8137+,
            // zooid 3335+, buzz 3001+ — siehe fixtures.ts/zooid.ts/buzz.ts).
            const port = 8437 + slot
            const zooidPort = 3335 + slot
            const boardUrl = `ws://localhost:${zooidPort}`

            const serve: ChildProcess = spawn(
                'php',
                ['artisan', 'serve', '--port', String(port)],
                {
                    env: {
                        ...process.env,
                        VITE_HOT_FILE: '/tmp/e2e-vite-never-hot',
                        DB_JOURNAL_MODE: 'WAL',
                        DB_BUSY_TIMEOUT: '5000',
                        PHP_CLI_SERVER_WORKERS: '4',
                        NOSTR_PROFILE_INDEXER: '',
                        // Space UND Board zeigen auf denselben worker-eigenen zooid — der
                        // Login-Flow (`loginNsec`) und `useZooid()`-Stubs funktionieren
                        // dadurch unverändert, während `/articles` server-seitig eine
                        // echte Quelle sieht.
                        NOSTR_SPACE_URL: boardUrl,
                        NOSTR_BOARD_URL: boardUrl,
                        // …und der WORKSPACE ebenso, aus demselben Grund eine Variable
                        // weiter. Dieser `serve` erbt `...process.env`, und
                        // `playwright.config.ts` lädt vorher die lokale `.env` hinein — die
                        // trägt dort das PRODUKTIONS-Buzz. Client-seitig fängt `useZooid()`
                        // das ab (`window.__nostrWorkspace = ''`), aber der SERVER sieht
                        // den Wert trotzdem: seit P5 entscheidet er darüber, ob die
                        // Ortskarte „Forge", die Forge-Zeile der Rail-Fußzeile und der
                        // vierte Forge-Tab überhaupt gerendert werden.
                        //
                        // Zwei Dinge auf einmal: der Produktions-Host verlässt die
                        // Server-ENV (dieselbe Klasse wie der `NOSTR_BOARD_URL`-Riegel in
                        // `fixtures.ts`), und das Markup wird von der `.env` des jeweiligen
                        // Rechners unabhängig — ohne diese Zeile rendert dieselbe Spec auf
                        // Rechner A mit und auf Rechner B ohne Forge-Karte.
                        //
                        // Der worker-eigene zooid als Wert: er ist ein echter, LOKALER
                        // Relay. Ein `wss://…`-Platzhalter wäre auch nicht-leer, zeigte aber
                        // nach außen, sobald jemand die Client-Stubs entfernt.
                        NOSTR_WORKSPACE_URL: boardUrl,
                    },
                    stdio: 'ignore',
                },
            )
            await waitForHttp(`http://127.0.0.1:${port}`)

            await use(`http://127.0.0.1:${port}`)

            serve.kill()
        },
        { scope: 'worker', timeout: 120_000 },
    ],

    // Überschreibt NUR für Tests, die diese Datei importieren — die geerbte `baseURL`
    // aus `@playwright/test` (Config-Default) wird hier ersetzt, nicht ergänzt.
    baseURL: async ({ boardServer }, use) => {
        await use(boardServer)
    },
})

export { expect, type Page, type Locator }
