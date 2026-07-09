import { defineConfig } from '@playwright/test'

// Wegwerf-nsec (NOSTR_TEST_NSEC) + APP-Konfig aus der .env in process.env laden.
process.loadEnvFile('.env')

const PORT = 8137

/**
 * E2E-Login-Suite (M1.5). Host-Chromium (kein Playwright-Browser-Download);
 * Vite-Build + `php artisan serve` als Testserver. Der In-Process-Relay pro
 * Test wird in den Specs selbst gestartet, nicht hier.
 */
export default defineConfig({
    testDir: './tests/e2e',
    // Seriell: alle Tests teilen sich denselben serve-Prozess + Session-DB.
    workers: 1,
    reporter: [['list']],
    // Test-zooid (:3335) SYNCHRON seeden, BEVOR Tests laufen — nicht im webServer, dessen
    // Port-Probe schon vor Seed-Ende „bereit" meldet (Bind-vor-Seed-Race). Siehe Skript.
    globalSetup: './tests/e2e/support/global-setup.ts',
    use: {
        baseURL: `http://127.0.0.1:${PORT}`,
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
    webServer: [
        {
            // Der Test-zooid (:3335) wird in globalSetup geseedet (Race-frei), nicht hier.
            command: `npm run build && php artisan serve --port=${PORT}`,
            url: `http://127.0.0.1:${PORT}`,
            reuseExistingServer: !process.env.CI,
            timeout: 120_000,
            // Eigener (nicht existierender) Hot-Pfad → Test-Server nutzt immer die
            // Build-Assets, auch wenn parallel `composer run dev` public/hot schreibt.
            // So kann der Dev-Server (Port 8000) beim Testen weiterlaufen.
            env: { ...process.env, VITE_HOT_FILE: '/tmp/e2e-vite-never-hot' },
        },
    ],
})
