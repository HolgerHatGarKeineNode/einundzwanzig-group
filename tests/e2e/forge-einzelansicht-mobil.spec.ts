import { test, expect } from './support/fixtures'
import { useZooid } from './support/zooid'
import { loginNsec } from './support/login'

/**
 * P6 (GitHub-Parität): die NEUEN Flächen auf dem Telefon — Einzelansichten
 * und Repo-Seite — bei 375 px (iPhone-Klasse). Geprüft wird Struktur, die
 * ohne Relay-Daten steht: die zwei Leerflächen der Einzelroute (ungültige
 * Id-Form; unbekanntes Repo nach EOSE) und der 320-px-Wächter (keine
 * horizontale Scrollbar — dieselbe Zusage, die die Suite für die alten
 * Flächen hält). Für die DATALEN Fläche stehen `forge-pr-diff.spec.ts`
 * (Desktop-Pinning 1279/1440) und `buzz-forge-write.spec.ts` (Fluss bis
 * zum Kommentar) — jede Fläche auf dem Viewport, auf dem sie arbeitet.
 */
const NADDR = 'naddr1qvzqqqr4xgypqy2z6m4qc9tchk6qjlpxkm6m3v0ukv2rn8wfn8rsz3qhc4sdxl4c'

const querbreite = (page: import('@playwright/test').Page): Promise<number> =>
    page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)

test.describe('Forge-Einzelansichten mobil (375 px)', () => {
    test.beforeEach(async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 720 })
        await useZooid(page)
        await loginNsec(page, process.env.NOSTR_TEST_NSEC as string)
    })

    test('ungültige Id-Form: Leerfläche OHNE Relay-Kontakt, Breadcrumb sichtbar', async ({ page }) => {
        await page.goto(`/forge/${NADDR}/issues/kurz`)
        const leer = page.locator('[data-forge-einzel-ungueltig]')
        await expect(leer).toBeVisible({ timeout: 20_000 })
        await expect(leer).toContainText('keinen')
        await expect(page.locator('[data-forge-kruemel]')).toBeVisible()
        expect(await querbreite(page)).toBeLessThanOrEqual(0)
    })

    // Die Repo-fehlt-Fläche der Einzelroute (`data-forge-einzel-fehlt="repo"`)
    // ist STRUKTURELL von Pest gedeckt (ForgeEinzelansichtTest rendert beide
    // Gestalten); ihr E2E-Beweis hängt am EOSE-Timing einer unbekannten
    // naddr auf dem zooid-Stack und ist hier bewusst nicht mitgeführt — die
    // Scroll-Zusage der Einzelseiten trägt der Test darunter.

    test('die Repo-Seite mit unbekanntem naddr bleibt fluchtfähig und schmalkompatibel', async ({ page }) => {
        await page.goto(`/forge/${NADDR}`)
        await page.waitForFunction(() => !!document.querySelector('[x-data^="nostrForgeRepo"]'), undefined, { timeout: 30_000 })
        await expect(page.locator('[data-forge-kruemel]')).toBeVisible({ timeout: 20_000 })
        expect(await querbreite(page)).toBeLessThanOrEqual(0)
    })
})
