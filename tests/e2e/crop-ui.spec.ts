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

/** Fragt kind-1111 (Kommentar) — OHNE `h`-Filter, weil Kommentare flotilla-kompatibel kein `h` tragen. */
function queryComment(pred: (e: RelayEvent) => boolean): RelayEvent | undefined {
    return execFileSync(NAK, ['req', '-k', '1111', '--auth', '--sec', NSEC, ZOOID_WS])
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

    // Direkt auf das versteckte Datei-Feld des HAUPT-Composers setzen (erstes im DOM;
    // der Thread-Composer hat ein zweites) — change → pickImage, ohne den nativen
    // Datei-Dialog (den Playwright nicht bedienen kann).
    await page.locator('input[type="file"][accept="image/*"]').first().setInputFiles({
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

/**
 * C6b Meme-Thread: der Thread-Composer teilt sich die C6a-Anhang-Maschinerie (Cropper +
 * `attachment`-State) mit dem Haupt-Composer. Eine Antwort MIT Bild landet als kind-1111
 * mit `imeta` (NIP-92) + URL im Content — und weiterhin OHNE `h` (flotilla-kompatibel).
 * Anhang wieder direkt in den State gesetzt (Sende-Pfad, kein echter Blossom-Upload).
 */
test('C6b: Bild im Thread anhängen — kind-1111 trägt imeta + URL, KEIN h (flotilla-kompat)', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await openComposerRoom(page, 'thread') // dedizierter Thread-Raum

    // Root-Nachricht posten — sie ist die Thread-Wurzel.
    const rootMarker = `troot${Date.now()}`
    const composer = page.getByPlaceholder('Nachricht schreiben…')
    await composer.fill(rootMarker)
    await page.getByRole('button', { name: 'Senden' }).click()
    await expect(page.getByText(rootMarker, { exact: true })).toBeVisible({ timeout: 15_000 })

    // Thread öffnen (Hover-Toolbar → „Im Thread antworten").
    const row = page.locator('div.group', { hasText: rootMarker })
    await row.hover()
    await row.getByRole('button', { name: 'Im Thread antworten' }).click()
    const dialog = page.getByRole('dialog', { name: 'Thread' })
    await expect(dialog).toBeVisible()

    // Anhang NACH dem Öffnen setzen (openThread nullt einen mitgeschleppten Anhang).
    const marker = `timg${Date.now()}`
    const imgUrl = `https://blossom.band/${marker}.webp`
    await page.locator('[x-data^="nostrRoomChat"]').first().evaluate((el, ctx) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const data = (window as any).Alpine.$data(el)
        data.threadAttachment = { url: ctx.url, imetaTag: ['imeta', `url ${ctx.url}`, 'm image/webp', `x ${ctx.marker}`] }
    }, { url: imgUrl, marker })

    // Anhang-Vorschau erscheint im Thread-Composer, Senden wird auch ohne Text aktiv.
    await expect(dialog.getByText('Bild angehängt')).toBeVisible()
    const send = dialog.getByRole('button', { name: 'Antwort senden' })
    await expect(send).toBeEnabled({ timeout: 15_000 })
    await dialog.getByPlaceholder('Im Thread antworten…').fill(`Meme ${marker}`)
    await send.click()

    // Am Relay: kind-1111 mit imeta + URL im Content, aber OHNE h (flotilla-kompat).
    let ev: RelayEvent | undefined
    await expect.poll(() => (ev = queryComment((e) => e.content.includes(marker))) !== undefined, { timeout: 15_000 }).toBe(true)
    expect(ev!.tags.some((t) => t[0] === 'imeta' && t.includes(`url ${imgUrl}`))).toBe(true)
    expect(ev!.content).toContain(imgUrl)
    expect(ev!.tags.find((t) => t[0] === 'h')).toBeUndefined() // KEIN h — flotilla-kompatibel
    expect(errors.join('\n')).not.toContain('DataCloneError')
})

/**
 * C6b Cropper-über-Thread: der aus dem Thread geöffnete Cropper (z-[60]) liegt über dem
 * Thread-Overlay (z-50). Beide haben `.window`-Escape- bzw. `click.outside`-Handler.
 * Regressions-Guard (Review-Fund): ESC/Klick-außerhalb zum ABBRECHEN des Zuschnitts darf
 * NUR den Cropper schließen — der Thread muss offen bleiben (kein doppeltes Teardown).
 */
test('C6b: Cropper aus dem Thread — Escape/Klick-außerhalb schließt NUR den Zuschnitt, nicht den Thread', async ({ page }) => {
    await openComposerRoom(page, 'thread')

    // Root-Nachricht + Thread als Modal öffnen.
    const rootMarker = `tesc${Date.now()}`
    await page.getByPlaceholder('Nachricht schreiben…').fill(rootMarker)
    await page.getByRole('button', { name: 'Senden' }).click()
    await expect(page.getByText(rootMarker, { exact: true })).toBeVisible({ timeout: 15_000 })
    const row = page.locator('div.group', { hasText: rootMarker })
    await row.hover()
    await row.getByRole('button', { name: 'Im Thread antworten' }).click()
    const thread = page.getByRole('dialog', { name: 'Thread' })
    await expect(thread).toBeVisible()

    // Aus dem Thread-Composer ein Bild wählen → echter Cropper legt sich über den Thread.
    await thread.locator('input[type="file"][accept="image/*"]').setInputFiles({ name: 'meme.png', mimeType: 'image/png', buffer: IMAGE })
    const crop = page.getByRole('dialog', { name: 'Bild zuschneiden' })
    await expect(crop).toBeVisible()
    await expect(page.locator('.cropper-container')).toHaveCount(1, { timeout: 10_000 })

    // ESC → nur der Cropper schließt, der Thread bleibt offen.
    await page.keyboard.press('Escape')
    await expect(crop).toBeHidden()
    await expect(thread).toBeVisible()

    // Erneut öffnen, diesmal per Klick auf den abgedunkelten Bereich neben der Crop-Karte abbrechen.
    await thread.locator('input[type="file"][accept="image/*"]').setInputFiles({ name: 'meme2.png', mimeType: 'image/png', buffer: IMAGE })
    await expect(crop).toBeVisible()
    await expect(page.locator('.cropper-container')).toHaveCount(1, { timeout: 10_000 })
    await page.mouse.click(8, 8) // linke obere Ecke = Crop-Backdrop, außerhalb beider Karten
    await expect(crop).toBeHidden()
    await expect(thread).toBeVisible() // Thread NICHT mitgeschlossen
})

/** Liest den Alpine-State der Room-Insel (attachment/threadAttachment). */
const islandState = (page: Page, key: string) =>
    page.locator('[x-data^="nostrRoomChat"]').first().evaluate((el, k) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return Boolean((window as any).Alpine.$data(el)[k as string])
    }, key)

/**
 * C6b confirmCrop-Routing: der ECHTE Zuschnitt→Upload-Pfad aus dem Thread muss in
 * `threadAttachment` landen (nicht im Haupt-`attachment`). Deckt die Kern-Invariante des
 * getrennten States ab (Review-Fund: bisher umgingen alle Tests confirmCrop). Der Blossom-
 * Upload (PUT /upload) wird gestubbt — geprüft wird das State-Routing, nicht der Upload.
 */
test('C6b: confirmCrop aus dem Thread schreibt threadAttachment, NICHT das Haupt-attachment', async ({ page }) => {
    await openComposerRoom(page, 'thread')

    // Blossom-Upload stubben: jede PUT /upload liefert eine bekannte Bild-URL zurück.
    const imgUrl = `https://blossom.band/crop${Date.now()}.webp`
    await page.route(/\/upload$/, (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ url: imgUrl }) }),
    )

    // Root + Thread öffnen.
    const rootMarker = `troute${Date.now()}`
    await page.getByPlaceholder('Nachricht schreiben…').fill(rootMarker)
    await page.getByRole('button', { name: 'Senden' }).click()
    await expect(page.getByText(rootMarker, { exact: true })).toBeVisible({ timeout: 15_000 })
    const row = page.locator('div.group', { hasText: rootMarker })
    await row.hover()
    await row.getByRole('button', { name: 'Im Thread antworten' }).click()
    const thread = page.getByRole('dialog', { name: 'Thread' })
    await expect(thread).toBeVisible()

    // Echtes Bild wählen → Cropper → „Anhängen" (confirmCrop läuft den echten Pfad).
    await thread.locator('input[type="file"][accept="image/*"]').setInputFiles({ name: 'meme.png', mimeType: 'image/png', buffer: IMAGE })
    const crop = page.getByRole('dialog', { name: 'Bild zuschneiden' })
    await expect(crop).toBeVisible()
    await expect(page.locator('.cropper-container')).toHaveCount(1, { timeout: 10_000 })
    await crop.getByRole('button', { name: /Anhängen|Lade hoch/ }).click()

    // Routing-Beleg: der Anhang landet im Thread-Composer, NICHT im Haupt-Composer.
    await expect(thread.getByText('Bild angehängt')).toBeVisible({ timeout: 15_000 })
    expect(await islandState(page, 'threadAttachment')).toBe(true)
    expect(await islandState(page, 'attachment')).toBe(false) // KEIN Übersprechen in den Haupt-Composer
})

/**
 * C6b State-Isolation: ein im HAUPT-Composer wartender Anhang muss das Öffnen (und Schließen)
 * eines Threads überleben — Threads werden oft nur zum Lesen geöffnet (Review-Fund #3). Vorher
 * nullte openThread den geteilten Anhang; mit getrenntem State bleibt er erhalten.
 */
test('C6b: Haupt-Composer-Anhang überlebt das Öffnen/Schließen eines Threads', async ({ page }) => {
    await openComposerRoom(page, 'thread')

    // ZUERST die Root-Nachricht posten (send() würde einen gesetzten Anhang verbrauchen).
    const rootMarker = `tkeep${Date.now()}`
    await page.getByPlaceholder('Nachricht schreiben…').fill(rootMarker)
    await page.getByRole('button', { name: 'Senden' }).click()
    await expect(page.getByText(rootMarker, { exact: true })).toBeVisible({ timeout: 15_000 })

    // DANN einen Haupt-Composer-Anhang direkt in den State setzen (State-Übergang wird
    // geprüft, kein Upload nötig).
    const imgUrl = `https://blossom.band/keep${Date.now()}.webp`
    await page.locator('[x-data^="nostrRoomChat"]').first().evaluate((el, url) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(window as any).Alpine.$data(el).attachment = { url, imetaTag: ['imeta', `url ${url}`, 'm image/webp'] }
    }, imgUrl)
    await expect(page.getByText('Bild angehängt').first()).toBeVisible() // Haupt-Composer-Vorschau (erste im DOM)

    // Thread auf der Root-Nachricht öffnen (nur ansehen).
    const row = page.locator('div.group', { hasText: rootMarker })
    await row.hover()
    await row.getByRole('button', { name: 'Im Thread antworten' }).click()
    const thread = page.getByRole('dialog', { name: 'Thread' })
    await expect(thread).toBeVisible()

    // Während der Thread offen ist: Haupt-Anhang unberührt, Thread-Anhang leer.
    expect(await islandState(page, 'attachment')).toBe(true)
    expect(await islandState(page, 'threadAttachment')).toBe(false)

    // Thread schließen → Haupt-Anhang immer noch da.
    await thread.getByRole('button', { name: 'Zurück' }).click()
    await expect(thread).toBeHidden()
    expect(await islandState(page, 'attachment')).toBe(true)
    await expect(page.getByText('Bild angehängt').first()).toBeVisible()
})
