import { test, expect, type Page } from './support/fixtures'
import { type Locator } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { useZooid, ZOOID_WS } from './support/zooid'
import { loginNsec } from './support/login'

const NSEC = process.env.NOSTR_TEST_NSEC as string
const NAK = '/home/user/go/bin/nak'
const ADMIN = 'b2ee09a54bedf17ee1db562bdddd75c48661d981eb52c49dc206c55ba8439414' // zooid-Admin-SECRET (wie in den Nachbar-Specs)
// Echtes, ausreichend großes PNG (wie crop-ui.spec.ts) für Tests, die das Lightbox-<img>
// selbst anfassen (Klick/Hover) — s. Kommentar bei `openEditRoom(realImage)` unten.
const IMAGE = readFileSync('public/og.png')

/**
 * Lightbox-Verdrahtung (js/lightbox.ts + ⚡room.blade.php): nur, was die reine Logic-
 * Spec (lightbox-logic.spec.ts) NICHT prüfen kann — echtes Alpine/DOM. Die Zoom-
 * Mathematik selbst ist dort abgedeckt, hier nur Öffnen/Schließen + Verdrahtung.
 *
 * Bilder postet der ADMIN direkt per `nak` (wie IMG-Test in room.spec.ts) in den
 * bereits dedizierten C3-Schreib-Raum „edit" (Test-User ist dort schon Mitglied) —
 * kein neuer Raum nötig, „welcome" bleibt unangetastet. `useZooid()` stubbt alle
 * Bild-Requests lokal (1×1-PNG), das Bild lädt also deterministisch.
 */

/** Postet ein Bild-Nachricht (kind 9) in den „edit"-Raum, eindeutig per `marker`. */
function postImage(marker: string): void {
    const url = `https://robohash.org/${marker}.png`
    execFileSync(NAK, ['event', '--auth', '--sec', ADMIN, '-k', '9', '-t', 'h=edit', '-c', `Bild ${marker}: ${url}`, ZOOID_WS])
}

/**
 * `realImage`: überschreibt NUR den `full`-Preset-Proxy mit einem echten, groß
 * gerenderten Bild statt dem repo-globalen 1×1-Stub aus `useZooid()`. NICHT mehr wegen
 * des ✕-Button-Bugs nötig (der ist gefixt, `!absolute` pinnt den Button jetzt fest in die
 * Ecke, unabhängig von der Bildgröße) — sondern weil `page.locator(...).hover()` auf einer
 * 1×1px-Box (kein explizites CSS-`width`/`height` am `<img>`, nur `max-w/h-full`) ein
 * inhärent fragiles Ziel ist: Playwright markiert eine so winzige Box wiederholt als
 * „nicht sichtbar/stabil" und läuft in den 30s-Timeout, obwohl nichts falsch ist. Reine
 * `click()`-Tests kommen inzwischen mit dem Stub klar (s. „schließt NICHT mehr"-Test).
 */
async function openEditRoom(page: Page, { realImage = false }: { realImage?: boolean } = {}): Promise<void> {
    await useZooid(page)
    if (realImage) {
        await page.route(/\/img\/full\?src=/, (route) => route.fulfill({ status: 200, contentType: 'image/png', body: IMAGE }))
    }
    await loginNsec(page, NSEC)
    await page.goto('/rooms/edit')
}

/** Liest die aktuelle `scale(…)`-Zahl aus dem inline `style` des Lightbox-`<img>`. */
async function scaleOf(img: Locator): Promise<number> {
    const style = (await img.getAttribute('style')) ?? ''
    const m = style.match(/scale\(([\d.]+)\)/)
    return m ? parseFloat(m[1]) : NaN
}

test('Lightbox öffnet per Klick auf ein Bild', async ({ page }) => {
    const marker = `open${Date.now()}`
    postImage(marker)
    await openEditRoom(page)

    const inline = page.locator(`img.chat-image[src*="${marker}"]`)
    await expect(inline).toBeVisible({ timeout: 15_000 })

    const lightbox = page.getByRole('dialog', { name: 'Bild in voller Größe' })
    await expect(lightbox).toBeHidden()
    await inline.click()
    await expect(lightbox).toBeVisible()
})

test('Klick aufs Bild schließt die Lightbox NICHT mehr (Erst-Klick ist für Doppeltipp/-klick reserviert)', async ({ page }) => {
    const marker = `noclose${Date.now()}`
    postImage(marker)
    await openEditRoom(page)

    const inline = page.locator(`img.chat-image[src*="${marker}"]`)
    await expect(inline).toBeVisible({ timeout: 15_000 })
    await inline.click()
    const lightbox = page.getByRole('dialog', { name: 'Bild in voller Größe' })
    await expect(lightbox).toBeVisible()

    await lightbox.locator('img').click()
    await expect(lightbox).toBeVisible() // bewusste Verhaltensänderung: bleibt offen
})

test('Klick auf den Hintergrund schließt die Lightbox', async ({ page }) => {
    const marker = `bgclose${Date.now()}`
    postImage(marker)
    await openEditRoom(page)

    const inline = page.locator(`img.chat-image[src*="${marker}"]`)
    await expect(inline).toBeVisible({ timeout: 15_000 })
    await inline.click()
    const lightbox = page.getByRole('dialog', { name: 'Bild in voller Größe' })
    await expect(lightbox).toBeVisible()

    // Ecke des Overlays, deutlich außerhalb des zentrierten Bilds.
    await lightbox.click({ position: { x: 5, y: 5 } })
    await expect(lightbox).toBeHidden()
})

test('Escape schließt die Lightbox', async ({ page }) => {
    const marker = `escclose${Date.now()}`
    postImage(marker)
    await openEditRoom(page)

    const inline = page.locator(`img.chat-image[src*="${marker}"]`)
    await expect(inline).toBeVisible({ timeout: 15_000 })
    await inline.click()
    const lightbox = page.getByRole('dialog', { name: 'Bild in voller Größe' })
    await expect(lightbox).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(lightbox).toBeHidden()
})

test('Der ✕-Button schließt die Lightbox', async ({ page }) => {
    const marker = `xclose${Date.now()}`
    postImage(marker)
    await openEditRoom(page)

    const inline = page.locator(`img.chat-image[src*="${marker}"]`)
    await expect(inline).toBeVisible({ timeout: 15_000 })
    await inline.click()
    const lightbox = page.getByRole('dialog', { name: 'Bild in voller Größe' })
    await expect(lightbox).toBeVisible()

    await lightbox.getByRole('button', { name: 'Schließen' }).click()
    await expect(lightbox).toBeHidden()
})

/**
 * Regressions-Guard (Review-Fund): `<flux:button>` bringt eigenes `position:relative`
 * mit — das schlägt in der Tailwind-Kaskade das ohne `!` gesetzte `absolute` aus der
 * Blade-Klasse. Der Button landete dadurch in Fluss-Position bei der Bildmitte statt in
 * der oberen rechten Ecke (bei kleinen Bildern lag er sogar MITTEN im Bild und blockierte
 * jeden Klick/Hover dorthin). Fix: `!absolute` erzwingt die Position gegen die Kaskade —
 * dieser Test prüft BEIDES: die berechnete CSS-Position UND dass die Box wirklich in der
 * Ecke sitzt (rechts + oben), nicht nur zufällig irgendwo mit `position:absolute`.
 */
test('✕-Button sitzt in der oberen rechten Ecke (position:absolute gegen Flux‘ eigenes position:relative)', async ({ page }) => {
    const marker = `btnpos${Date.now()}`
    postImage(marker)
    await openEditRoom(page)

    const inline = page.locator(`img.chat-image[src*="${marker}"]`)
    await expect(inline).toBeVisible({ timeout: 15_000 })
    await inline.click()
    const lightbox = page.getByRole('dialog', { name: 'Bild in voller Größe' })
    await expect(lightbox).toBeVisible()

    const closeBtn = lightbox.getByRole('button', { name: 'Schließen' })
    await expect(closeBtn).toHaveCSS('position', 'absolute')

    const overlayBox = (await lightbox.boundingBox())!
    const btnBox = (await closeBtn.boundingBox())!
    // Rechte Kante nahe dem rechten Overlay-Rand (top-4 right-4 ⇒ 16px Abstand) …
    expect(overlayBox.x + overlayBox.width - (btnBox.x + btnBox.width)).toBeLessThan(20)
    // … Oberkante nahe dem oberen Overlay-Rand — NICHT vertikal zentriert (das war der Bug).
    expect(btnBox.y - overlayBox.y).toBeLessThan(20)
    expect(btnBox.y).toBeLessThan(overlayBox.y + overlayBox.height / 2 - 50)
})

test('Mausrad über dem Bild zoomt hinein (transform enthält scale(…) > 1)', async ({ page }) => {
    const marker = `wheel${Date.now()}`
    postImage(marker)
    await openEditRoom(page, { realImage: true })

    const inline = page.locator(`img.chat-image[src*="${marker}"]`)
    await expect(inline).toBeVisible({ timeout: 15_000 })
    await inline.click()
    const lightbox = page.getByRole('dialog', { name: 'Bild in voller Größe' })
    const lightboxImg = lightbox.locator('img')
    await expect(lightbox).toBeVisible()
    await expect.poll(() => scaleOf(lightboxImg)).toBe(1)

    await lightboxImg.hover()
    await page.mouse.wheel(0, -300) // negatives deltaY = reinzoomen
    await expect.poll(() => scaleOf(lightboxImg)).toBeGreaterThan(1)
})

test('Ein neu geöffnetes Bild startet wieder bei scale=1 (x-effect reset() beim Bildwechsel)', async ({ page }) => {
    // Die Lightbox-Komponente wird NUR einmal gemountet (x-show togglet nur die Sichtbarkeit,
    // kein Neu-Mount) — ohne den `x-effect="lightboxSrc, reset()"`-Pfad bliebe der Zoom des
    // ersten Bilds beim zweiten Bild hängen. Genau das deckt dieser Test ab.
    const markerA = `resetA${Date.now()}`
    const markerB = `resetB${Date.now()}`
    postImage(markerA)
    postImage(markerB)
    await openEditRoom(page, { realImage: true })

    const imgA = page.locator(`img.chat-image[src*="${markerA}"]`)
    const imgB = page.locator(`img.chat-image[src*="${markerB}"]`)
    await expect(imgA).toBeVisible({ timeout: 15_000 })
    await expect(imgB).toBeVisible({ timeout: 15_000 })

    const lightbox = page.getByRole('dialog', { name: 'Bild in voller Größe' })
    const lightboxImg = lightbox.locator('img')

    await imgA.click()
    await expect(lightbox).toBeVisible()
    await lightboxImg.hover()
    await page.mouse.wheel(0, -300)
    await expect.poll(() => scaleOf(lightboxImg)).toBeGreaterThan(1)

    await page.keyboard.press('Escape')
    await expect(lightbox).toBeHidden()

    await imgB.click()
    await expect(lightbox).toBeVisible()
    await expect.poll(() => scaleOf(lightboxImg)).toBe(1)
})
