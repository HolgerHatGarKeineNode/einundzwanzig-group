import { test, expect } from '@playwright/test'
import { testKeys } from './support/keys'
import { installNip07 } from './support/nip07'
import { startRelay } from './support/relay'
import { startBunker } from './support/bunker'
import { useZooid } from './support/zooid'
import { loginNsec } from './support/login'

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

        await loginNsec(page, NSEC)
        await expect(page.locator('body')).toContainText(npub)
    })

    test('Reauth: verlorene Server-Session wird auf der Login-Seite automatisch wiederhergestellt', async ({ page, context }) => {
        const { npub } = testKeys()

        // Regulär anmelden → Client-Session (localStorage) + Laravel-Session.
        await loginNsec(page, NSEC)

        // Reboot/Ablauf simulieren: Server-Session (Cookies) weg, Client-Session bleibt.
        await context.clearCookies()

        // /spaces → Gate wirft auf /nostr-login → Auto-Reauth (NIP-98) → zurück zu /spaces.
        await page.goto('/spaces')
        await page.waitForURL('**/spaces', { timeout: 15_000 })
        await expect(page.locator('body')).toContainText(npub)
    })

    test('NIP-46-Bunker-Login meldet über den lokalen Relay im Gate an', async ({ page }) => {
        const { sk, npub } = testKeys()
        const relay = await startRelay()
        const bunker = await startBunker(relay.url, sk)

        try {
            await page.goto('/nostr-login')
            // nsec/Bunker liegen seit dem gehärteten Formular hinter „Andere Optionen".
            await page.getByRole('button', { name: 'Andere Optionen' }).click()
            await page.getByPlaceholder('bunker://…').fill(bunker.uri)
            await page.getByRole('button', { name: 'Mit Bunker verbinden' }).click()

            await page.waitForURL('**/spaces', { timeout: 20_000 })
            await expect(page.locator('body')).toContainText(npub)
        } finally {
            bunker.close()
            await relay.close()
        }
    })

    test('NIP-07-Button erscheint auch bei verzögert injizierter Extension', async ({ page }) => {
        await page.goto('/nostr-login')
        const btn = page.getByRole('button', { name: /Browser-Erweiterung/ })
        await expect(btn).toBeHidden()

        // Alby/nos2x setzen window.nostr oft ERST nach dem Alpine-init (der gemeldete Bug).
        await page.evaluate(() => {
            // @ts-expect-error — window.nostr ist die NIP-07-Schnittstelle.
            window.nostr = { getPublicKey: async () => 'a'.repeat(64), signEvent: async (e: unknown) => e }
        })

        await expect(btn).toBeVisible({ timeout: 5_000 })
    })

    test('Amber-QR (nostrconnect) wird erzeugt und angezeigt', async ({ page }) => {
        await page.goto('/nostr-login')
        // Web ohne Erweiterung: der Primär-CTA „Signer per QR verbinden" ist der
        // nostrconnect-Pfad (Amber ist im Web keine eigene Marke mehr, §5.1).
        await page.getByRole('button', { name: 'Signer per QR verbinden' }).click()

        // Desktop-Web: kein nativer Intent → QR zum Scannen mit Amber.
        // Deckt die ganze Kette ab: startConnect → makeNostrconnectUrl → QR-Render.
        // Der Handshake selbst nutzt dieselben Primitive wie der Bunker-Login (dort getestet).
        const qr = page.getByAltText('nostrconnect QR-Code')
        await expect(qr).toBeVisible({ timeout: 15_000 })
        await expect(qr).toHaveAttribute('src', /^data:image\/png/)
    })

    test('Logout leert beide Sessions und das Gate sperrt wieder', async ({ page }) => {
        await loginNsec(page, NSEC)

        await page.getByRole('button', { name: 'Abmelden' }).click()
        await page.waitForURL('**/nostr-login')

        // Gate greift jetzt wieder: /spaces → Redirect zurück zum Login.
        await page.goto('/spaces')
        await page.waitForURL('**/nostr-login')
    })
})
