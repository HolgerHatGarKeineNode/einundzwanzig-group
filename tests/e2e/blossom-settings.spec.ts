import { test, expect } from './support/fixtures'
import { execFileSync } from 'node:child_process'
import { useZooid, ZOOID_WS } from './support/zooid'
import { loginNsec } from './support/login'

const NSEC = process.env.NOSTR_TEST_NSEC as string
const NAK = '/home/user/go/bin/nak'
const BLOSSOM = 'https://blossom.einundzwanzig.space'

/**
 * C6a Blossom-Anzeige + Bugfix: der im Profil (kind 10063) konfigurierte Blossom-Server
 * muss geladen und in den Einstellungen angezeigt werden — nicht der Standard-Fallback.
 * Deckt den gemeldeten Bug ab (Liste wurde vor dem Auflösen nie geladen → Fallback).
 */
test('C6a Settings: konfigurierter Blossom-Server (kind 10063) wird angezeigt', async ({ page }) => {
    // kind-10063 (Blossom-Server-Liste) für den Test-User seeden.
    execFileSync(NAK, ['event', '--auth', '--sec', NSEC, '-k', '10063', '-t', `server=${BLOSSOM}`, ZOOID_WS])

    await useZooid(page)
    await loginNsec(page, NSEC)
    await page.goto('/settings')

    const section = page.locator('section[aria-labelledby="settings-blossom"]')
    await expect(section).toBeVisible()
    // Der konfigurierte Server erscheint (aus dem Profil geladen), Herkunft „aus Profil".
    await expect(section.getByText('blossom.einundzwanzig.space')).toBeVisible({ timeout: 15_000 })
    await expect(section.getByText('aus Profil')).toBeVisible()
    await expect(section.getByText('Standard')).toHaveCount(0)

    await section.scrollIntoViewIfNeeded()
    await section.screenshot({ path: 'plans/screenshots/c6a-blossom-settings.png' })
})
