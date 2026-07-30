import { defineConfig } from '@playwright/test'

// Wegwerf-nsec (NOSTR_TEST_NSEC) + APP-Konfig aus der .env in process.env laden.
process.loadEnvFile('.env')

/**
 * E2E-Suite mit ECHTER Parallelität. Host-Chromium (kein Playwright-Browser-Download).
 * Jeder Worker fährt SEINE eigene `php artisan serve`- + zooid-Instanz auf worker-
 * spezifischen Ports hoch (serve = 8137+slot, zooid = 3335+slot) — siehe
 * tests/e2e/support/fixtures.ts, das auch baseURL pro Worker setzt. Das Vite-Bundle +
 * das zooid-Binary werden EINMAL in global-setup gebaut; der Relay-Seed passiert pro
 * Worker im Fixture. So teilen sich Worker weder Relay-Räume noch Session/Cache.
 *
 * Deshalb KEIN globaler `webServer` mehr: die Server-Lebenszyklen managt das Fixture.
 *
 * `E2E_RELAY=buzz|zooid` (Default zooid, siehe support/global-setup.ts + support/
 * fixtures.ts): schaltet die Suite wahlweise gegen den lokalen Buzz-TEST-Stack
 * (Docker-Compose-Projekt `buzz-test-<port>`) statt zooid. Buzz bekommt einen eigenen
 * Docker-Stack je Worker (Port 3001+slot, eigenes Compose-Projekt, eigene Volumes) —
 * genau wie zooid. Vorher war es EIN geteilter Stack und der Modus auf workers:1
 * festgenagelt; dieselbe Arbeit brauchte damit 13–15 min statt gut 2 (gemessen:
 * 753 s Testzeit Buzz gegen 633 s zooid).
 */
const isBuzz = process.env.E2E_RELAY === 'buzz'

export default defineConfig({
    testDir: './tests/e2e',
    fullyParallel: true,
    // 1 serve + 1 Relay + 1 Chromium je Worker. Auf CI knapper halten.
    // Buzz zieht pro Worker einen eigenen Docker-Stack hoch (4 Container) — deshalb
    // dort weniger Worker als bei zooid, aber eben nicht mehr nur einer.
    // `E2E_BUZZ_WORKERS` überschreibt das, wenn die Maschine mehr oder weniger verträgt.
    workers: isBuzz
        ? Number(process.env.E2E_BUZZ_WORKERS ?? (process.env.CI ? '2' : '4'))
        : process.env.CI
          ? 4
          : 6,
    reporter: [['list']],
    globalSetup: './tests/e2e/support/global-setup.ts',
    use: {
        // baseURL setzt das workerBackend-Fixture pro Worker (worker-eigener serve-Port).
        trace: 'on-first-retry',
    },
    projects: [
        {
            name: 'chromium',
            use: {
                browserName: 'chromium',
                launchOptions: {
                    executablePath: '/bin/chromium',
                    args: ['--no-sandbox'],
                },
            },
        },
    ],
})
