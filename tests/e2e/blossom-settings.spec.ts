import { test, expect } from './support/fixtures'
import { execFileSync } from 'node:child_process'
import { useZooid, ZOOID_WS } from './support/zooid'
import { loginNsec } from './support/login'

const NSEC = process.env.NOSTR_TEST_NSEC as string
const NAK = '/home/user/go/bin/nak'

/**
 * Blossom ist auf den Vereins-Server fixiert (alle Nutzer sind Mitglieder): die Profil-
 * Serverliste (kind 10063) wird NICHT mehr aufgelöst. Der Test seedet bewusst einen
 * abweichenden kind-10063-Server und prüft, dass er die Anzeige nicht kapert.
 */
test('Settings: Blossom ist auf den Vereins-Server fixiert (kind 10063 wird ignoriert)', async ({ page }) => {
    execFileSync(NAK, ['event', '--auth', '--sec', NSEC, '-k', '10063', '-t', 'server=https://fremder.example', ZOOID_WS])

    await useZooid(page)
    await loginNsec(page, NSEC)
    await page.goto('/settings')

    const section = page.locator('section[aria-labelledby="settings-blossom"]')
    await expect(section).toBeVisible()
    await expect(section.getByText('blossom.einundzwanzig.space')).toBeVisible()
    await expect(section.getByText('Vereins-Server')).toBeVisible()
    await expect(section.getByText('fremder.example')).toHaveCount(0)

    await section.scrollIntoViewIfNeeded()
    await section.screenshot({ path: 'plans/screenshots/c6a-blossom-settings.png' })
})
