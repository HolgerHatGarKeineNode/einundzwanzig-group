import { test, expect, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { useZooid, ZOOID_WS } from './support/zooid'
import { loginNsec } from './support/login'

const NSEC = process.env.NOSTR_TEST_NSEC as string
const NAK = '/home/user/go/bin/nak'
// Echtes, ausreichend großes PNG aus dem Repo (OG-Bild) als Crop-Vorlage.
const IMAGE = readFileSync('public/og.png')

type RelayEvent = { id: string; kind: number; content: string; tags: string[][] }

/** Fragt das Test-zooid (member-only → AUTH) nach dem ersten passenden kind-9. */
function queryKind9(pred: (e: RelayEvent) => boolean, h = 'welcome'): RelayEvent | undefined {
    return execFileSync(NAK, ['req', '-k', '9', '-t', `h=${h}`, '--auth', '--sec', NSEC, ZOOID_WS])
        .toString()
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as RelayEvent)
        .find(pred)
}

async function openComposerRoom(page: Page, h = 'welcome'): Promise<void> {
    await useZooid(page)
    await loginNsec(page, NSEC)
    await page.goto(`/rooms/${h}`)
    // Schreibende Tests nutzen dedizierte Räume (nie „welcome" bloaten) → dort ggf. beitreten.
    const join = page.getByRole('button', { name: /Beitreten|Trete bei/ })
    if (await join.isVisible().catch(() => false)) {
        await join.click()
    }
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

/**
 * C6a Copy&Paste: ein Bild aus der Zwischenablage ins Eingabefeld einfügen öffnet
 * denselben Cropper (kein roher Datei-/Text-Paste). Simuliert per ClipboardEvent
 * mit einem File in `clipboardData`.
 */
test('C6a: Bild in den Composer einfügen (Paste) öffnet den Cropper', async ({ page }) => {
    await openComposerRoom(page)

    await page.getByPlaceholder('Nachricht schreiben…').evaluate((ta, bytes) => {
        const dt = new DataTransfer()
        dt.items.add(new File([new Uint8Array(bytes as number[])], 'paste.png', { type: 'image/png' }))
        ta.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
    }, Array.from(IMAGE))

    const overlay = page.getByRole('dialog', { name: 'Bild zuschneiden' })
    await expect(overlay).toBeVisible()
    await expect(page.locator('.cropper-container')).toHaveCount(1, { timeout: 10_000 })
    await expect(page.locator('.cropper-crop-box')).toBeVisible()
})

/**
 * C6a Paste-Vorrang: gemischte Zwischenablage (Text + gerendertes Bild, wie beim
 * Kopieren von Tabellenzellen) darf den Text-Paste NICHT kapern — der Cropper
 * bleibt zu, der Text landet normal im Composer.
 */
test('C6a: Paste mit Text UND Bild öffnet den Cropper NICHT (Text hat Vorrang)', async ({ page }) => {
    await openComposerRoom(page)
    const composer = page.getByPlaceholder('Nachricht schreiben…')

    await composer.evaluate((ta, bytes) => {
        const dt = new DataTransfer()
        dt.items.add('Zelleninhalt', 'text/plain')
        dt.items.add(new File([new Uint8Array(bytes as number[])], 'cells.png', { type: 'image/png' }))
        ta.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
    }, Array.from(IMAGE))

    // Kein Cropper — der Browser fügt den Text via Default-Paste ein.
    await expect(page.getByRole('dialog', { name: 'Bild zuschneiden' })).toBeHidden()
    await expect(page.locator('.cropper-container')).toHaveCount(0)
})

/**
 * C6a Senden mit Anhang: das `imetaTag` liegt im reaktiven Alpine-State (Proxy) —
 * gelangte es roh in die Event-Tags, scheiterte welshmans Event-Klon an
 * „DataCloneError: Proxy object could not be cloned". send() muss den Anhang zu
 * reinen Werten entwickeln. Hier direkt in den State gesetzt (kein echter Blossom-
 * Upload nötig — geprüft wird der SENDE-Pfad), dann gegen das echte zooid gesendet.
 */
test('C6a: Nachricht mit Anhang senden — kein DataCloneError, imeta am kind-9', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await openComposerRoom(page, 'edit') // dedizierter Schreib-Raum
    const marker = `img${Date.now()}`
    const imgUrl = `https://blossom.band/${marker}.webp`

    await page.locator('[x-data^="nostrRoomChat"]').first().evaluate((el, ctx) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const data = (window as any).Alpine.$data(el)
        data.attachment = { url: ctx.url, imetaTag: ['imeta', `url ${ctx.url}`, 'm image/webp', `x ${ctx.marker}`] }
    }, { url: imgUrl, marker })

    const composer = page.getByPlaceholder('Nachricht schreiben…')
    await composer.fill(`Bild Test ${marker}`)
    await page.getByRole('button', { name: 'Senden' }).click()

    // Erfolg (mit dem Bug: Composer bliebe gefüllt + „DataCloneError"-Fehlerzeile):
    // Composer leert, keine Fehlerzeile, Nachricht + Bild-Element erscheinen im Verlauf.
    await expect(composer).toHaveValue('', { timeout: 10_000 })
    await expect(page.locator('text=DataCloneError')).toHaveCount(0)
    await expect(page.getByText(`Bild Test ${marker}`)).toBeVisible()
    await expect(page.locator('img.chat-image').last()).toBeVisible()
    expect(errors.join('\n')).not.toContain('DataCloneError')

    // Relay-Beleg (gepollt — Propagation ist nicht sofort): kind-9 trägt imeta + URL im Content.
    let ev: RelayEvent | undefined
    await expect
        .poll(() => (ev = queryKind9((e) => e.content.includes(marker), 'edit')) !== undefined, { timeout: 15_000 })
        .toBe(true)
    expect(ev!.tags.some((t) => t[0] === 'imeta' && t.includes(`url ${imgUrl}`))).toBe(true)
    expect(ev!.content).toContain(imgUrl)
})
