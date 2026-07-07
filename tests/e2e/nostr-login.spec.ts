import { test, expect } from '@playwright/test'
import { testKeys } from './support/keys'
import { installNip07 } from './support/nip07'
import { startRelay } from './support/relay'
import { startBunker } from './support/bunker'
import { useZooid } from './support/zooid'

const NSEC = process.env.NOSTR_TEST_NSEC as string

/**
 * M1.5 — die Client-Login-Pfade end-to-end: welshman-Signer im Browser →
 * NIP-98-Handoff → Laravel-Gate (`/spaces`). Was PHPUnit nicht abdeckt, weil
 * der Signer nie zum Server geht. Alle Läufe zeigen auf den lokalen zooid.
 */
test.describe('Nostr-Login (E2E)', () => {
    test.beforeEach(async ({ page }) => {
        await useZooid(page)
    })

    test('NIP-07 (Extension) meldet über den Handoff im Gate an', async ({ page }) => {
        const { sk, pk, npub } = testKeys()
        await installNip07(page, sk, pk)

        await page.goto('/nostr-login')
        await page.getByRole('button', { name: /Browser-Erweiterung/ }).click()

        await page.waitForURL('**/spaces')
        await expect(page.locator('body')).toContainText(npub)
    })

    test('nsec-Login meldet über den Handoff im Gate an', async ({ page }) => {
        const { npub } = testKeys()

        await page.goto('/nostr-login')
        await page.getByPlaceholder(/nsec1/).fill(NSEC)
        await page.getByRole('button', { name: 'Anmelden' }).click()

        await page.waitForURL('**/spaces')
        await expect(page.locator('body')).toContainText(npub)
    })

    test('NIP-46-Bunker-Login meldet über den lokalen Relay im Gate an', async ({ page }) => {
        const { sk, npub } = testKeys()
        const relay = await startRelay()
        const bunker = await startBunker(relay.url, sk)

        try {
            await page.goto('/nostr-login')
            await page.getByRole('tab', { name: 'Bunker' }).click()
            await page.getByPlaceholder('bunker://…').fill(bunker.uri)
            await page.getByRole('button', { name: 'Verbinden' }).click()

            await page.waitForURL('**/spaces', { timeout: 20_000 })
            await expect(page.locator('body')).toContainText(npub)
        } finally {
            bunker.close()
            await relay.close()
        }
    })

    test('Logout leert beide Sessions und das Gate sperrt wieder', async ({ page }) => {
        await page.goto('/nostr-login')
        await page.getByPlaceholder(/nsec1/).fill(NSEC)
        await page.getByRole('button', { name: 'Anmelden' }).click()
        await page.waitForURL('**/spaces')

        await page.getByRole('button', { name: 'Abmelden' }).click()
        await page.waitForURL('**/nostr-login')

        // Gate greift jetzt wieder: /spaces → Redirect zurück zum Login.
        await page.goto('/spaces')
        await page.waitForURL('**/nostr-login')
    })
})
