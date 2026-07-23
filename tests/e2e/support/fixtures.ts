import { test as base, expect, type Page } from '@playwright/test'
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'

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

export const test = base.extend<object, { workerBackend: void }>({
    // Worker-scoped + auto: läuft EINMAL je Worker vor dessen Tests. Seedet die worker-
    // eigene zooid-Instanz (blockierend, race-frei) und startet den worker-eigenen serve.
    workerBackend: [
        async ({}, use, workerInfo) => {
            const slot = workerInfo.parallelIndex + SLOT_OFFSET
            const zooidPort = 3335 + slot
            const servePort = 8137 + slot

            execFileSync('bash', ['tests/e2e/support/zooid-testserver.sh'], {
                env: { ...process.env, ZOOID_PORT: String(zooidPort) },
                stdio: 'inherit',
            })

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
})

export { expect, type Page }
