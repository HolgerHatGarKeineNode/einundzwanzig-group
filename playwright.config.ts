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
 * (Docker-Compose-Projekt `buzz-test`, :3001) statt zooid. Buzz ist EIN geteilter
 * Docker-Stack, kein Pro-Worker-Prozess — deshalb erzwingt der Buzz-Modus workers:1
 * (keine parallelen Instanzen, keine Raum-/Session-Kollisionen). Der bestehende
 * zooid-Modus bleibt unverändert (Default, volle Parallelität).
 */
const isBuzz = process.env.E2E_RELAY === 'buzz'

export default defineConfig({
    testDir: './tests/e2e',
    fullyParallel: !isBuzz,
    // 1 serve + 1 zooid + 1 Chromium je Worker. Auf CI knapper halten. Buzz: fix 1 (s.o.).
    workers: isBuzz ? 1 : process.env.CI ? 4 : 6,
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
