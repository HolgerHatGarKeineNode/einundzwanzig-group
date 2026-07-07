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
 * M2 (Single-Space §12) — nach Login zeigt die App genau EINEN aktiven Space mit
 * seinen Räumen (39000). Mitgliedschaft ist relay-seitig (39002): der Seed lässt
 * den Test-User `welcome`+`general` beitreten → „Meine Räume", `dev` bleibt unter
 * „Andere Räume". Prüft zugleich, dass NIP-42-AUTH automatisch durchläuft.
 */
test('M2: aktiver Space + Räume erscheinen live nach Login gegen zooid', async ({ page }) => {
    await login(page)

    // Der eine aktive Space (Relay-URL als Label)
    await expect(page.getByText('localhost:3334')).toBeVisible({ timeout: 15_000 })

    // Beigetretene Räume (39002-Mitglied) + der entdeckbare `dev` unter „Andere Räume"
    await expect(page.getByText('Willkommen')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('Allgemein')).toBeVisible()
    await expect(page.getByText('Andere Räume')).toBeVisible()
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
