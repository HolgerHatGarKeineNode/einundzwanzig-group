import { test, expect } from '@playwright/test'
import { useZooid } from './support/zooid'

const NSEC = process.env.NOSTR_TEST_NSEC as string

/**
 * M2 — nach Login gegen den lokalen zooid erscheinen der Space + seine Rooms:
 * beigetretene (welcome/general aus der kind-10009-Liste) und entdeckbare (dev).
 * Prüft zugleich, dass NIP-42-AUTH gegen zooid automatisch durchläuft.
 */
test('M2: Spaces + Rooms erscheinen live nach Login gegen zooid', async ({ page }) => {
    await useZooid(page)

    await page.goto('/nostr-login')
    await page.getByPlaceholder(/nsec1/).fill(NSEC)
    await page.getByRole('button', { name: 'Anmelden' }).click()
    await page.waitForURL('**/spaces')

    // Space (Relay-URL als Label)
    await expect(page.getByText('localhost:3334')).toBeVisible({ timeout: 15_000 })

    // Beigetretene Rooms (aus kind 10009)
    await expect(page.getByText('Willkommen')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('Allgemein')).toBeVisible()

    // Entdeckbarer Room (39000 vorhanden, aber nicht in der 10009-Liste)
    await expect(page.getByText('Andere Rooms')).toBeVisible()
    await expect(page.getByText('Dev')).toBeVisible()
})
