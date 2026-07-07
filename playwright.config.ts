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
    webServer: {
        command: `npm run build && php artisan serve --port=${PORT}`,
        url: `http://127.0.0.1:${PORT}`,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
    },
})
