import { test, expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { useZooid } from './support/zooid'
import { loginNsec } from './support/login'

const NSEC = process.env.NOSTR_TEST_NSEC as string
// Echtes, ausreichend großes PNG aus dem Repo (OG-Bild) als Crop-Vorlage.
const IMAGE = readFileSync('public/og.png')

async function openComposerRoom(page: Page): Promise<void> {
    await useZooid(page)
    await loginNsec(page, NSEC)
    await page.goto('/rooms/welcome')
    await expect(page.getByPlaceholder('Nachricht schreiben…')).toBeVisible({ timeout: 15_000 })
}

/**
 * C6a Cropper-UI: das Anhängen eines Bildes öffnet EIN sauberes Crop-Overlay —
 * genau eine `.cropper-container` (keine versetzte Doppelanzeige), Original-<img>
 * versteckt, Crop-Box wählbar. Deckt den vom Nutzer gemeldeten Doppelbild-/
 * „nichts wählbar"-Bug ab (Ursache: reaktiver Proxy + Container ohne feste Höhe).
 */
test('C6a: Bild anhängen öffnet genau EINEN funktionierenden Cropper', async ({ page }) => {
    await openComposerRoom(page)

    // Direkt auf das versteckte Datei-Feld setzen (change → pickImage), ohne den
    // nativen Datei-Dialog (den Playwright nicht bedienen kann).
    await page.locator('input[type="file"][accept="image/*"]').setInputFiles({
        name: 'meme.png',
        mimeType: 'image/png',
        buffer: IMAGE,
    })

    // Overlay erscheint …
    const overlay = page.getByRole('dialog', { name: 'Bild zuschneiden' })
    await expect(overlay).toBeVisible()

    // … cropperjs baut GENAU EINE Container-Instanz (kein Doppelbild) …
    await expect(page.locator('.cropper-container')).toHaveCount(1, { timeout: 10_000 })
    // … das Original-<img> ist versteckt (sonst läge es sichtbar über dem Cropper) …
    await expect(page.locator('img.cropper-hidden')).toHaveCount(1)
    // … und es gibt eine wählbare Crop-Box.
    await expect(page.locator('.cropper-crop-box')).toBeVisible()

    // Ratio-Umschalten funktioniert (aria-pressed spiegelt den Zustand).
    const oneToOne = overlay.getByRole('button', { name: '1:1', exact: true })
    await oneToOne.click()
    await expect(oneToOne).toHaveAttribute('aria-pressed', 'true')

    await page.screenshot({ path: 'plans/screenshots/c6a-cropper.png' })

    // Schließen räumt auf: Overlay weg, keine Cropper-DOM-Reste.
    await overlay.getByRole('button', { name: 'Abbrechen' }).click()
    await expect(overlay).toBeHidden()
    await expect(page.locator('.cropper-container')).toHaveCount(0)
})
