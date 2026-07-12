import { test, expect } from '@playwright/test'
import { useZooid } from './support/zooid'
import { loginNsec } from './support/login'

const NSEC = process.env.NOSTR_TEST_NSEC as string

/** Loggt via nsec ein und landet im Gate (`/spaces`). */
async function login(page: import('@playwright/test').Page): Promise<void> {
    await useZooid(page)
    await loginNsec(page, NSEC)
}

/**
 * M2 (Single-Space §12) — nach Login zeigt die App genau EINEN aktiven Space mit
 * seinen Räumen (39000). Mitgliedschaft ist relay-seitig (39002): der Seed lässt
 * den Test-User `welcome`+`general` beitreten → „Meine Räume", `dev` bleibt unter
 * „Andere Räume". Prüft zugleich, dass NIP-42-AUTH automatisch durchläuft.
 */
test('M2: aktiver Space + Räume erscheinen live nach Login gegen zooid', async ({ page }) => {
    await login(page)

    // Der eine aktive Space — Name + Untertitel aus NIP-11 (B1), nicht die URL.
    // Der Test-Relay meldet name="Zooid Test Space", description="local verify relay".
    await expect(page.getByText('Zooid Test Space')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('local verify relay')).toBeVisible()

    // Beigetretene Räume (39002-Mitglied) + der entdeckbare `dev` unter „Andere Räume"
    await expect(page.getByText('Willkommen')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('Allgemein')).toBeVisible()
    await expect(page.getByText('Andere Räume')).toBeVisible()
    await expect(page.getByText('Dev')).toBeVisible()

    // B2: Raum-`picture` (kind 39000) rendert als Avatar, `private` als Schloss.
    // IMG (PLAN4): der Avatar läuft über den Bild-Proxy ($img → /img/avatar?src=…).
    const vip = page.getByRole('button').filter({ hasText: 'VIP' })
    await expect(vip).toBeVisible()
    await expect(vip.locator('img')).toHaveAttribute('src', /\/img\/avatar\?src=.*robohash\.org.*vip\.png/)
    await expect(vip.locator('[aria-label="Privater Raum"]')).toBeVisible()
})

/**
 * Der Space-Wechsel ist in den Einstellungen versteckt (§12) — die Seite listet
 * die beigetretenen Spaces und markiert den aktiven.
 */
test('M2: Space-Wechsel liegt in den Einstellungen', async ({ page }) => {
    await login(page)

    // Über die Bottom-Nav in die Einstellungen (Space-Wechsel liegt dort, §12)
    await page.getByRole('link', { name: 'Einstellungen' }).click()
    await page.waitForURL('**/settings/space')

    await expect(page.getByText('Space wählen')).toBeVisible()
    // Space-Auswahl zeigt den NIP-11-Namen (B1), nicht die nackte URL.
    await expect(page.getByText('Zooid Test Space')).toBeVisible({ timeout: 15_000 })
})
