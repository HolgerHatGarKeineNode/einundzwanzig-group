import { test, expect } from '@playwright/test'
import { useZooid } from './support/zooid'

const NSEC = process.env.NOSTR_TEST_NSEC as string

/** Loggt via nsec ein und landet im Gate (`/spaces`). */
async function login(page: import('@playwright/test').Page): Promise<void> {
    await useZooid(page)
    await page.goto('/nostr-login')
    await page.getByPlaceholder(/nsec1/).fill(NSEC)
    await page.getByRole('button', { name: 'Anmelden' }).click()
    await page.waitForURL('**/spaces')
}

/**
 * M2 (Single-Space §12) — nach Login zeigt die App genau EINEN aktiven Space
 * mit seinen Rooms: beigetretene (welcome/general aus kind 10009) und
 * entdeckbare (dev). Prüft zugleich, dass NIP-42-AUTH automatisch durchläuft.
 */
test('M2: aktiver Space + Rooms erscheinen live nach Login gegen zooid', async ({ page }) => {
    await login(page)

    // Der eine aktive Space (Relay-URL als Label)
    await expect(page.getByText('localhost:3334')).toBeVisible({ timeout: 15_000 })

    // Beigetretene Rooms (aus kind 10009)
    await expect(page.getByText('Willkommen')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('Allgemein')).toBeVisible()

    // Entdeckbarer Room (39000 vorhanden, aber nicht in der 10009-Liste)
    await expect(page.getByText('Andere Rooms')).toBeVisible()
    await expect(page.getByText('Dev')).toBeVisible()
})

/**
 * Der Space-Wechsel ist in den Einstellungen versteckt (§12) — die Seite listet
 * die beigetretenen Spaces und markiert den aktiven.
 */
test('M2: Space-Wechsel liegt in den Einstellungen', async ({ page }) => {
    await login(page)

    // Über das Zahnrad in die Einstellungen
    await page.getByRole('link', { name: 'Space wechseln' }).click()
    await page.waitForURL('**/settings/space')

    await expect(page.getByText('Space wählen')).toBeVisible()
    await expect(page.getByText('localhost:3334')).toBeVisible({ timeout: 15_000 })
})
