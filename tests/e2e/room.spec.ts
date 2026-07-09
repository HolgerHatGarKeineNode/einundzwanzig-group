import { test, expect, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { useZooid, ZOOID_WS } from './support/zooid'

const NSEC = process.env.NOSTR_TEST_NSEC as string
const NAK = '/home/user/go/bin/nak'
const ADMIN = 'b2ee09a54bedf17ee1db562bdddd75c48661d981eb52c49dc206c55ba8439414'

type RelayEvent = { id: string; pubkey: string; kind: number; content: string; tags: string[][]; created_at: number }

/**
 * Fragt das Test-zooid (member-only → mit AUTH) nach dem ersten passenden Event des
 * Kinds. `h=null` lässt den `#h`-Filter weg (für Events ohne Group-Tag, z.B. kind-1984 Report).
 */
function queryRelayEvent(pred: (e: RelayEvent) => boolean, h: string | null = 'welcome', kind = 9): RelayEvent | undefined {
    const args = ['req', '-k', String(kind), ...(h ? ['-t', `h=${h}`] : []), '--auth', '--sec', NSEC, ZOOID_WS]
    return execFileSync(NAK, args)
        .toString()
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as RelayEvent)
        .find(pred)
}

/** Loggt via nsec ein und öffnet den Chat eines Raums (default „welcome"). */
async function openRoom(page: Page, h = 'welcome'): Promise<void> {
    await useZooid(page)
    await page.goto('/nostr-login')
    await page.getByPlaceholder(/nsec1/).fill(NSEC)
    await page.getByRole('button', { name: 'Anmelden' }).click()
    await page.waitForURL('**/spaces')
    await page.goto(`/rooms/${h}`)
}

/**
 * M4 (Chat lesen) — der Room-Verlauf lädt vom Space-Relay, Text wird gerendert
 * (Emoji + Link als Anchor), Absender-Profile sind aufgelöst (Namen statt npub),
 * und die Pagination-Aktion ist da.
 */
test('M4: Room-Verlauf lädt, Text + Profile gerendert', async ({ page }) => {
    await openRoom(page)

    // Nachrichtentext (inkl. Emoji)
    await expect(page.getByText('Willkommen im Space! 👋')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('Danke!', { exact: true })).toBeVisible()

    // Profile aufgelöst (kind-0-Namen, nicht npub)
    await expect(page.getByText('Alice Test').first()).toBeVisible()
    await expect(page.getByText('Relay Admin').first()).toBeVisible()

    // Link im Inhalt wird als Anchor gerendert (welshman/content)
    await expect(page.getByRole('link', { name: /einundzwanzig\.space/ })).toBeVisible()

    // Pagination-Affordanz
    await expect(page.getByRole('button', { name: /Ältere laden/ })).toBeVisible()
})

test('M4: neue Nachricht erscheint live', async ({ page }) => {
    await openRoom(page)
    await expect(page.getByText('Willkommen im Space! 👋')).toBeVisible({ timeout: 15_000 })

    // Eindeutige Nachricht direkt in den Relay publizieren (nicht über die App —
    // Senden ist M5) und die Live-Subscription der Insel prüfen.
    const marker = `Live-${Math.floor(Math.random() * 1e9)}`
    execFileSync(NAK, [
        'event', '--auth', '--sec', ADMIN, '-k', '9', '-t', 'h=welcome',
        '-c', `E2E ${marker}`, ZOOID_WS,
    ])

    await expect(page.getByText(`E2E ${marker}`)).toBeVisible({ timeout: 15_000 })
})

/**
 * IMG (PLAN4) — eine Bild-URL im Nachrichtentext rendert als Inline-Bild über den
 * Bild-Proxy (Preset `msg`), Klick öffnet die Lightbox (Preset `full`), Esc schließt.
 */
test('IMG: Inline-Bild im Chat + Lightbox', async ({ page }) => {
    await openRoom(page)
    await expect(page.getByText('Willkommen im Space! 👋')).toBeVisible({ timeout: 15_000 })

    const url = `https://robohash.org/e2e-${Math.floor(Math.random() * 1e9)}.png`
    execFileSync(NAK, [
        'event', '--auth', '--sec', ADMIN, '-k', '9', '-t', 'h=welcome',
        '-c', `Bild: ${url}`, ZOOID_WS,
    ])

    // Inline-Bild läuft über den Proxy (msg-Preset), nicht als Text-Link.
    const inline = page.locator('img.chat-image').last()
    await expect(inline).toBeVisible({ timeout: 15_000 })
    await expect(inline).toHaveAttribute('src', /\/img\/msg\?src=.*robohash/)

    // Klick → Lightbox (full-Preset), Esc schließt wieder.
    await inline.click()
    const lightbox = page.locator('img[src*="/img/full"]')
    await expect(lightbox).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(lightbox).toBeHidden()
})

/**
 * B6 (PLAN4) — ein NIP-30 Custom-Emoji (`:shortcode:` + `emoji`-Tag) rendert als
 * kleines Inline-`<img>` über den Bild-Proxy (avatar-Preset), nicht als Text.
 */
test('B6: Custom-Emoji (NIP-30) rendert als Inline-Bild', async ({ page }) => {
    await openRoom(page)
    await expect(page.getByText('Willkommen im Space! 👋')).toBeVisible({ timeout: 15_000 })

    const code = `pepe${Math.floor(Math.random() * 1e9)}`
    const url = `https://robohash.org/${code}.png`
    execFileSync(NAK, [
        'event', '--auth', '--sec', ADMIN, '-k', '9', '-t', 'h=welcome',
        '-t', `emoji=${code};${url}`, '-c', `Gruß :${code}:`, ZOOID_WS,
    ])

    const emoji = page.locator('img.chat-emoji').last()
    await expect(emoji).toBeVisible({ timeout: 15_000 })
    await expect(emoji).toHaveAttribute('src', new RegExp(`/img/avatar\\?src=.*robohash.*${code}`))
    await expect(emoji).toHaveAttribute('alt', `:${code}:`)
})

/**
 * PC (Profil-Cache) — der Seed vom /nostr/profiles-Endpunkt darf NIEMALS Nachrichten
 * oder die Raum-Mitgliedschaft löschen (Regression: `repository.load` LEERT das
 * Repository; korrekt ist `repository.publish`). Endpoint gestubbt, damit er ein
 * echtes kind-0 liefert — genau der Fall, der auf Prod alles wegwischte.
 */
test('PC: Profil-Seed löscht weder Nachrichten noch Mitgliedschaft', async ({ page }) => {
    const kind0 = execFileSync(NAK, [
        'event', '--sec', ADMIN, '-k', '0',
        '-c', '{"name":"Seeded Admin","picture":"https://robohash.org/seed.png"}',
    ]).toString().trim()

    await page.route('**/nostr/profiles*', (route) =>
        route.fulfill({ contentType: 'application/json', body: JSON.stringify({ events: [JSON.parse(kind0)] }) }),
    )

    await openRoom(page)

    // Nachrichten bleiben erhalten (load() hätte sie gewischt).
    await expect(page.getByText('Willkommen im Space! 👋')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('Danke!', { exact: true })).toBeVisible()
    // Mitgliedschaft bleibt: Composer sichtbar, kein „Beitreten"-Fallback.
    await expect(page.getByPlaceholder('Nachricht schreiben…')).toBeVisible()
})

/**
 * M5 (Senden) — der eingeloggte User ist Mitglied von „welcome", schreibt eine
 * Nachricht über den Composer; sie erscheint optimistisch im eigenen Verlauf,
 * der Composer wird geleert.
 */
test('M5: Nachricht senden', async ({ page }) => {
    await openRoom(page)
    await expect(page.getByText('Willkommen im Space! 👋')).toBeVisible({ timeout: 15_000 })

    const marker = `Send-${Math.floor(Math.random() * 1e9)}`
    const composer = page.getByPlaceholder('Nachricht schreiben…')
    await composer.fill(`Hallo ${marker}`)
    await page.getByRole('button', { name: 'Senden' }).click()

    await expect(page.getByText(`Hallo ${marker}`)).toBeVisible({ timeout: 15_000 })
    await expect(composer).toHaveValue('')
})

/** M5 (Löschen) — eine eigene Nachricht lässt sich löschen und verschwindet. */
test('M5: eigene Nachricht löschen', async ({ page }) => {
    await openRoom(page)
    await expect(page.getByText('Willkommen im Space! 👋')).toBeVisible({ timeout: 15_000 })

    const marker = `Del-${Math.floor(Math.random() * 1e9)}`
    await page.getByPlaceholder('Nachricht schreiben…').fill(marker)
    await page.getByRole('button', { name: 'Senden' }).click()

    const message = page.getByText(marker, { exact: true })
    await expect(message).toBeVisible({ timeout: 15_000 })

    // Zeile antippen blendet die Aktionen ein (Touch/Tap-to-toggle), dann Löschen.
    const row = page.locator('div.group', { hasText: marker })
    await row.click()
    await row.getByRole('button', { name: 'Nachricht löschen' }).click()
    // Bestätigungs-Modal → erst der Klick auf „Löschen" publiziert den Tombstone.
    await page.getByRole('button', { name: 'Löschen', exact: true }).click()
    await expect(page.getByText(marker, { exact: true })).toHaveCount(0, { timeout: 15_000 })
})

/**
 * M5 (Join/Leave) — echte, relay-seitige NIP-29-Mitgliedschaft (39002). „dev" ist
 * ein Raum, dem der User nicht beigetreten ist: Beitreten-Hinweis + kein Composer.
 * Nach Beitreten (kind 9021, auto-approve) erscheint der Composer, die Mitglied-
 * schaft **übersteht einen Reload** (der Kern des Bugs), Verlassen dreht es zurück.
 */
test('M5: Raum beitreten, persistiert über Reload, verlassen', async ({ page }) => {
    await openRoom(page, 'dev')

    const joinBtn = page.getByRole('button', { name: 'Beitreten' })
    const leaveBtn = page.getByRole('button', { name: 'Raum verlassen' })
    const composer = page.getByPlaceholder('Nachricht schreiben…')

    // Nicht Mitglied → Hinweis, kein Composer
    await expect(joinBtn).toBeVisible({ timeout: 15_000 })
    await expect(composer).toBeHidden()

    // Beitreten → relay-seitige Mitgliedschaft → Composer
    await joinBtn.click()
    await expect(composer).toBeVisible({ timeout: 15_000 })
    await expect(leaveBtn).toBeVisible()

    // Persistenz: nach hartem Reload weiterhin Mitglied (39002 liegt auf dem Relay)
    await page.reload()
    await expect(composer).toBeVisible({ timeout: 15_000 })
    await expect(joinBtn).toBeHidden()

    // Verlassen → zurück zum Hinweis (Zustand für Wiederholläufe zurücksetzen)
    await leaveBtn.click()
    await expect(joinBtn).toBeVisible({ timeout: 15_000 })
    await expect(composer).toBeHidden()
})

/**
 * M6 (Reply/Quote) — auf eine Nachricht antworten: der Reply-Kontext erscheint
 * über dem Composer; die gesendete Antwort trägt eine Zitat-Vorschau der
 * Ursprungsnachricht (q-Tag + `nostr:nevent`, im selben Raum aufgelöst).
 */
test('M6: auf eine Nachricht antworten (Zitat)', async ({ page }) => {
    await openRoom(page)
    await expect(page.getByText('Willkommen im Space! 👋')).toBeVisible({ timeout: 15_000 })

    const a = `Frage-${Math.floor(Math.random() * 1e9)}`
    const b = `Antwort-${Math.floor(Math.random() * 1e9)}`
    const composer = page.getByPlaceholder('Nachricht schreiben…')

    // Nachricht A senden
    await composer.fill(a)
    await page.getByRole('button', { name: 'Senden' }).click()
    await expect(page.getByText(a, { exact: true })).toBeVisible({ timeout: 15_000 })

    // Auf A antworten → Zeile antippen (Aktionen einblenden), dann Antworten.
    const rowA = page.locator('div.group', { hasText: a })
    await rowA.click()
    await rowA.getByRole('button', { name: 'Antworten' }).click()
    await expect(page.getByText('Antwort an')).toBeVisible()

    // Antwort B senden → B ist da UND zitiert A (Original + Zitat = 2× A)
    await composer.fill(b)
    await page.getByRole('button', { name: 'Senden' }).click()
    await expect(page.getByText(b, { exact: true })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(a, { exact: true })).toHaveCount(2)
})

/**
 * C0 (Reply-Härtung) — die gesendete Antwort trägt am Relay exakt die Tag-/
 * Content-Form des Referenz-Clients: `q`+`p`+`h` plus `["-"]` (PROTECTED, da das
 * Test-zooid NIP-70 meldet) und ein vorangestelltes `nostr:nevent…` im Content.
 */
test('C0: Antwort trägt am Relay q/p/h/PROTECTED + nevent-Präfix', async ({ page }) => {
    await openRoom(page)
    await expect(page.getByText('Willkommen im Space! 👋')).toBeVisible({ timeout: 15_000 })

    const a = `CQ-${Math.floor(Math.random() * 1e9)}`
    const b = `CA-${Math.floor(Math.random() * 1e9)}`
    const composer = page.getByPlaceholder('Nachricht schreiben…')

    await composer.fill(a)
    await page.getByRole('button', { name: 'Senden' }).click()
    await expect(page.getByText(a, { exact: true })).toBeVisible({ timeout: 15_000 })

    const rowA = page.locator('div.group', { hasText: a })
    await rowA.click()
    await rowA.getByRole('button', { name: 'Antworten' }).click()
    await expect(page.getByText('Antwort an')).toBeVisible()

    await composer.fill(b)
    await page.getByRole('button', { name: 'Senden' }).click()
    await expect(page.getByText(b, { exact: true })).toBeVisible({ timeout: 15_000 })

    // Am Relay: das kind-9, dessen Text auf B endet, trägt Reply- + PROTECTED-Tags.
    // Poll: der Relay-Roundtrip kann dem optimistischen UI kurz hinterherhängen.
    let found: RelayEvent | undefined
    await expect
        .poll(() => (found = queryRelayEvent((e) => e.content.endsWith(b))) !== undefined, { timeout: 15_000 })
        .toBe(true)
    const reply = found as RelayEvent
    expect(reply.content).toMatch(/^nostr:nevent1[0-9a-z]+\n\n/)
    const tag = (name: string) => reply.tags.find((t) => t[0] === name)
    expect(tag('q')?.[1]).toBeTruthy() // zitiert A
    expect(tag('p')).toBeTruthy() // Autor von A
    expect(tag('h')?.[1]).toBe('welcome') // NIP-29 Group
    expect(tag('-')).toBeTruthy() // NIP-70 PROTECTED (zooid meldet 70)
})

/**
 * C0 (Interaktions-Menü, Web) — das „…"-Menü ist der gemeinsame Andockpunkt für
 * alle Folge-Aktionen. Web = Popover (flux:dropdown) an der Zeile mit „Antworten".
 */
test('C0: Interaktions-Menü öffnet als Popover (Web)', async ({ page }) => {
    await openRoom(page)
    const row = page.locator('div.group', { hasText: 'Willkommen im Space!' })
    await expect(row).toBeVisible({ timeout: 15_000 })

    await row.hover()
    await row.getByRole('button', { name: 'Weitere Aktionen' }).click()
    await expect(page.getByRole('menuitem', { name: 'Antworten' })).toBeVisible()

    // Eintrag setzt den Antwort-Kontext (identisch zur Inline-Aktion).
    await page.getByRole('menuitem', { name: 'Antworten' }).click()
    await expect(page.getByText('Antwort an')).toBeVisible()
})

/**
 * C0 (Interaktions-Menü, native App) — dieselbe View, Seam auf `isMobile`
 * (`__nostrMobile`): auf dem Gerät öffnet das „…"-Menü ein Vollbild-Modal.
 */
test('C0: Interaktions-Menü öffnet als Modal (native App)', async ({ page }) => {
    // Web einloggen (der native Login-Pfad hat kein Server-Gate, §7) …
    await openRoom(page)
    await expect(page.getByText('Willkommen im Space! 👋')).toBeVisible({ timeout: 15_000 })
    // … dann auf „native App" umschalten und den Raum neu laden: die Insel bootet
    // mit dem Modal-Seam, die welshman-Session überlebt (localStorage, gleiche Origin).
    await page.addInitScript(() => {
        ;(window as unknown as { __nostrMobile: boolean }).__nostrMobile = true
    })
    await page.goto('/rooms/welcome')
    const row = page.locator('div.group', { hasText: 'Willkommen im Space!' })
    await expect(row).toBeVisible({ timeout: 15_000 })

    await row.click() // Touch: Tap blendet die Aktionen ein
    await row.getByRole('button', { name: 'Weitere Aktionen' }).click()

    const modal = page.locator('dialog[data-modal="message-menu"]')
    await expect(modal).toBeVisible()
    await expect(modal.getByText('Nachricht')).toBeVisible()
    await modal.getByRole('button', { name: 'Antworten' }).click()
    await expect(page.getByText('Antwort an')).toBeVisible()
})

/**
 * C1 (Reaction + Toggle) — auf eine Nachricht reagieren (kind 7, NIP-25): der Chip
 * erscheint mit eigenem Zustand; am Relay trägt die kind-7 exakt `e`/`k`/`h` plus
 * `["-"]` (PROTECTED). Erneuter Chip-Klick nimmt zurück (kind-5-Delete am Relay),
 * der Chip verschwindet wieder.
 */
test('C1: Reaktion erzeugt kind-7 (e/k/h/PROTECTED), Toggle löscht via kind-5', async ({ page }) => {
    // Dedizierter „react"-Raum: schreibende C1-Tests bloaten NICHT „welcome" (dessen
    // Seed muss im 50er-Fenster bleiben). Self-contained: eigene frische Nachricht.
    await openRoom(page, 'react')

    const marker = `RX-${Math.floor(Math.random() * 1e9)}`
    const composer = page.getByPlaceholder('Nachricht schreiben…')
    await expect(composer).toBeVisible({ timeout: 15_000 })
    await composer.fill(marker)
    await page.getByRole('button', { name: 'Senden' }).click()
    await expect(page.getByText(marker, { exact: true })).toBeVisible({ timeout: 15_000 })

    // Zeile → Reaktions-Picker (Web-Popover) → 👍
    const row = page.locator('div.group', { hasText: marker })
    await row.hover()
    await row.getByRole('button', { name: 'Reagieren', exact: true }).click()
    // MRU-Reihe ist beim ersten Gebrauch leer → 👍 über die Suche wählen.
    await page.getByRole('searchbox', { name: 'Emoji suchen' }).fill('daumen')
    await page.getByRole('button', { name: 'Mit Daumen hoch reagieren' }).click({ timeout: 15_000 })

    // Chip erscheint mit eigenem Zustand (aria-pressed).
    const chip = row.locator('button[aria-pressed="true"]')
    await expect(chip).toBeVisible({ timeout: 15_000 })
    await expect(chip).toContainText('👍')

    // Am Relay: kind-7 auf die Marker-Nachricht mit e/k/h/PROTECTED.
    let msg: RelayEvent | undefined
    await expect.poll(() => (msg = queryRelayEvent((e) => e.content === marker, 'react')) !== undefined, { timeout: 15_000 }).toBe(true)
    const parentId = (msg as RelayEvent).id
    let reaction: RelayEvent | undefined
    await expect
        .poll(
            () =>
                (reaction = queryRelayEvent(
                    // Der Picker sendet das emojibase-Zeichen inkl. Variation-Selector
                    // (👍️) — wie Flotilla; `includes` ist robust gegen das VS-Suffix.
                    (e) => e.content.includes('👍') && e.tags.some((t) => t[0] === 'e' && t[1] === parentId),
                    'react',
                    7,
                )) !== undefined,
            { timeout: 15_000 },
        )
        .toBe(true)
    const r = reaction as RelayEvent
    const rtag = (name: string) => r.tags.find((t) => t[0] === name)
    expect(rtag('e')?.[1]).toBe(parentId)
    expect(rtag('k')?.[1]).toBe('9')
    expect(rtag('h')?.[1]).toBe('react')
    expect(rtag('-')).toBeTruthy() // PROTECTED (zooid meldet NIP-70)

    // Toggle: Chip klicken → Reaction weg (kind-5-Delete am Relay).
    await chip.click()
    await expect(row.locator('button[aria-pressed="true"]')).toHaveCount(0, { timeout: 15_000 })
    await expect
        .poll(() => queryRelayEvent((e) => e.tags.some((t) => t[0] === 'e' && t[1] === r.id), 'react', 5) !== undefined, {
            timeout: 15_000,
        })
        .toBe(true)
})

/**
 * C1 (Custom-Emoji, NIP-30) — eine kind-7-Reaction mit `:shortcode:` + `emoji`-Tag
 * rendert als Chip mit Inline-`<img>` über den Bild-Proxy (avatar-Preset), nicht als
 * Text. Die Reaction wird direkt am Relay erzeugt (der Picker bietet nur das
 * Standard-Set), aggregiert unter der referenzierten Nachricht.
 */
test('C1: Custom-Emoji-Reaction rendert als Chip-Inline-Bild', async ({ page }) => {
    await openRoom(page, 'react')

    // Self-contained: eigene frische Nachricht senden (immer im Fenster), ihre id holen.
    const marker = `CE-${Math.floor(Math.random() * 1e9)}`
    const composer = page.getByPlaceholder('Nachricht schreiben…')
    await expect(composer).toBeVisible({ timeout: 15_000 })
    await composer.fill(marker)
    await page.getByRole('button', { name: 'Senden' }).click()
    await expect(page.getByText(marker, { exact: true })).toBeVisible({ timeout: 15_000 })

    let parent: RelayEvent | undefined
    await expect.poll(() => (parent = queryRelayEvent((e) => e.content === marker, 'react')) !== undefined, { timeout: 15_000 }).toBe(true)

    const code = `pepe${Math.floor(Math.random() * 1e9)}`
    const url = `https://robohash.org/${code}.png`
    execFileSync(NAK, [
        'event', '--auth', '--sec', ADMIN, '-k', '7', '-t', 'h=react',
        '-t', `e=${(parent as RelayEvent).id}`, '-t', 'k=9', '-t', `emoji=${code};${url}`,
        '-c', `:${code}:`, ZOOID_WS,
    ])

    const chip = page.locator(`img.chat-emoji[alt=":${code}:"]`)
    await expect(chip).toBeVisible({ timeout: 15_000 })
    await expect(chip).toHaveAttribute('src', new RegExp(`/img/avatar\\?src=.*robohash.*${code}`))
})

/**
 * C1 (volles Panel, Suche) — der Picker bietet nicht nur die Schnell-Reihe, sondern
 * das komplette Standard-Set: über die Suche wird ein Emoji AUSSERHALB der sechs
 * Schnell-Reaktionen gefunden (🦄) und erzeugt eine reguläre kind-7.
 */
test('C1: Suche im Emoji-Panel wählt aus dem vollen Set (kind-7)', async ({ page }) => {
    await openRoom(page, 'react')

    const marker = `SR-${Math.floor(Math.random() * 1e9)}`
    const composer = page.getByPlaceholder('Nachricht schreiben…')
    await expect(composer).toBeVisible({ timeout: 15_000 })
    await composer.fill(marker)
    await page.getByRole('button', { name: 'Senden' }).click()
    await expect(page.getByText(marker, { exact: true })).toBeVisible({ timeout: 15_000 })

    const row = page.locator('div.group', { hasText: marker })
    await row.hover()
    await row.getByRole('button', { name: 'Reagieren', exact: true }).click()
    // 🦄 ist NICHT in der Schnell-Reihe → nur über Suche + Grid erreichbar.
    await page.getByRole('searchbox', { name: 'Emoji suchen' }).fill('einhorn')
    await page.getByRole('button', { name: 'Mit Einhorn reagieren' }).click({ timeout: 15_000 })

    const chip = row.locator('button[aria-pressed="true"]')
    await expect(chip).toContainText('🦄', { timeout: 15_000 })

    let parent: RelayEvent | undefined
    await expect.poll(() => (parent = queryRelayEvent((e) => e.content === marker, 'react')) !== undefined, { timeout: 15_000 }).toBe(true)
    await expect
        .poll(
            () =>
                queryRelayEvent(
                    (e) => e.content === '🦄' && e.tags.some((t) => t[0] === 'e' && t[1] === (parent as RelayEvent).id),
                    'react',
                    7,
                ) !== undefined,
            { timeout: 15_000 },
        )
        .toBe(true)
})

/**
 * C1 (Custom-Emoji-Auswahl, NIP-30) — der Kern-Wunsch: der Picker zieht die eigene
 * kind-10030-Liste (User Emoji List) und bietet sie als „Deine Emojis"-Tab an. Ein
 * dort gewähltes Emoji erzeugt eine kind-7 mit `:shortcode:` + `["emoji", code, url]`.
 */
test('C1: Custom-Emoji aus dem Profil-Tab reagiert (:shortcode: + emoji-Tag)', async ({ page }) => {
    // Eigene User-Emoji-Liste (kind 10030) VOR dem Öffnen seeden — daraus baut der
    // Picker den „Deine Emojis"-Tab. Der Raum-Init wärmt sie vor (loadUserCustomEmojis),
    // solange die Verbindung frisch AUTH'd ist. --auth + eigener nsec: member-only zooid.
    const code = `frog${Math.floor(Math.random() * 1e9)}`
    const url = `https://robohash.org/${code}.png`
    execFileSync(NAK, [
        'event', '--auth', '--sec', NSEC, '-k', '10030',
        '-t', `emoji=${code};${url}`, '-c', '', ZOOID_WS,
    ])

    await openRoom(page, 'react')
    const composer = page.getByPlaceholder('Nachricht schreiben…')
    await expect(composer).toBeVisible({ timeout: 15_000 })

    const marker = `CP-${Math.floor(Math.random() * 1e9)}`
    await composer.fill(marker)
    await page.getByRole('button', { name: 'Senden' }).click()
    await expect(page.getByText(marker, { exact: true })).toBeVisible({ timeout: 15_000 })

    // Picker (erst hier lädt loadUserCustomEmojis) → „Deine Emojis"-Tab → Custom-Emoji.
    const row = page.locator('div.group', { hasText: marker })
    await row.hover()
    await row.getByRole('button', { name: 'Reagieren', exact: true }).click()
    const tab = page.getByRole('tab', { name: 'Deine Emojis' })
    await expect(tab).toBeVisible({ timeout: 15_000 })
    await tab.click()
    // Custom-Emojis erscheinen progressiv, sobald ihr Bild geladen ist (Stub → 1×1-PNG).
    const customBtn = page.getByRole('button', { name: `Mit :${code}: reagieren` })
    await expect(customBtn).toBeVisible({ timeout: 15_000 })
    await customBtn.click()

    // Chip als Inline-Bild (Custom-Emoji, avatar-Proxy).
    await expect(row.locator(`img.chat-emoji[alt=":${code}:"]`)).toBeVisible({ timeout: 15_000 })

    // Am Relay: kind-7 mit `:code:` + rohem emoji-Tag (Original-URL, nicht proxifiziert).
    let parent: RelayEvent | undefined
    await expect.poll(() => (parent = queryRelayEvent((e) => e.content === marker, 'react')) !== undefined, { timeout: 15_000 }).toBe(true)
    let reaction: RelayEvent | undefined
    await expect
        .poll(
            () =>
                (reaction = queryRelayEvent(
                    (e) => e.content === `:${code}:` && e.tags.some((t) => t[0] === 'e' && t[1] === (parent as RelayEvent).id),
                    'react',
                    7,
                )) !== undefined,
            { timeout: 15_000 },
        )
        .toBe(true)
    expect((reaction as RelayEvent).tags.find((t) => t[0] === 'emoji')).toEqual(['emoji', code, url])
})

/**
 * C1 (Reaktion, native App) — dieselbe View, Seam auf `isMobile`: auf dem Gerät
 * reagiert man über die Emoji-Reihe im „…"-Vollbild-Modal (kein Zeilen-Popover).
 */
test('C1: Reaktion über das native Modal', async ({ page }) => {
    // Web einloggen, dann als native App den „react"-Raum laden (Session überlebt).
    await openRoom(page, 'react')
    await expect(page.getByPlaceholder('Nachricht schreiben…')).toBeVisible({ timeout: 15_000 })
    await page.addInitScript(() => {
        ;(window as unknown as { __nostrMobile: boolean }).__nostrMobile = true
    })
    await page.goto('/rooms/react')

    const marker = `RM-${Math.floor(Math.random() * 1e9)}`
    const composer = page.getByPlaceholder('Nachricht schreiben…')
    await expect(composer).toBeVisible({ timeout: 15_000 })
    await composer.fill(marker)
    await page.getByRole('button', { name: 'Senden' }).click()
    await expect(page.getByText(marker, { exact: true })).toBeVisible({ timeout: 15_000 })

    const row = page.locator('div.group', { hasText: marker })
    await row.click() // Touch: Aktionen einblenden
    await row.getByRole('button', { name: 'Weitere Aktionen' }).click()

    const modal = page.locator('dialog[data-modal="message-menu"]')
    await expect(modal).toBeVisible()
    // MRU-Reihe ist beim ersten Gebrauch leer → 🎉 über die Suche im Modal-Panel.
    await modal.getByRole('searchbox', { name: 'Emoji suchen' }).fill('konfetti')
    await modal.getByRole('button', { name: 'Mit Konfettibombe reagieren' }).click({ timeout: 15_000 })

    // Chip erscheint (Modal schließt via react()).
    await expect(row.locator('button[aria-pressed="true"]')).toContainText('🎉', { timeout: 15_000 })
})

/**
 * C1 (MRU) — die obere Reihe zeigt „zuletzt benutzt": beim ersten Gebrauch leer,
 * nach einer Reaktion steht das Emoji dort. Persistiert clientseitig (localStorage).
 */
test('C1: benutztes Emoji erscheint in „Zuletzt benutzt" (MRU)', async ({ page }) => {
    await openRoom(page, 'react')

    const marker = `MRU-${Math.floor(Math.random() * 1e9)}`
    const composer = page.getByPlaceholder('Nachricht schreiben…')
    await expect(composer).toBeVisible({ timeout: 15_000 })
    await composer.fill(marker)
    await page.getByRole('button', { name: 'Senden' }).click()
    await expect(page.getByText(marker, { exact: true })).toBeVisible({ timeout: 15_000 })

    const row = page.locator('div.group', { hasText: marker })
    await row.hover()
    await row.getByRole('button', { name: 'Reagieren', exact: true }).click()
    // Beim ersten Gebrauch keine MRU-Reihe.
    await expect(page.getByRole('group', { name: 'Zuletzt benutzt' })).toHaveCount(0)
    // Über die Suche reagieren → Picker schließt.
    await page.getByRole('searchbox', { name: 'Emoji suchen' }).fill('rakete')
    await page.getByRole('button', { name: 'Mit Rakete reagieren' }).click({ timeout: 15_000 })

    // Erneut öffnen → 🚀 steht jetzt in der „Zuletzt benutzt"-Reihe.
    await row.hover()
    await row.getByRole('button', { name: 'Reagieren', exact: true }).click()
    await expect(
        page.getByRole('group', { name: 'Zuletzt benutzt' }).getByRole('button', { name: 'Mit Rakete reagieren' }),
    ).toBeVisible({ timeout: 15_000 })
})

/**
 * C1 (Chip-Tooltip) — der Reaction-Chip trägt als `title` die Nostr-Namen der
 * Reagierenden (kommagetrennt), NICHT das Datum der Nachricht.
 */
test('C1: Reaction-Chip-Tooltip zeigt den Reagierenden-Namen', async ({ page }) => {
    await openRoom(page, 'react')

    const marker = `TT-${Math.floor(Math.random() * 1e9)}`
    const composer = page.getByPlaceholder('Nachricht schreiben…')
    await expect(composer).toBeVisible({ timeout: 15_000 })
    await composer.fill(marker)
    await page.getByRole('button', { name: 'Senden' }).click()
    await expect(page.getByText(marker, { exact: true })).toBeVisible({ timeout: 15_000 })

    const row = page.locator('div.group', { hasText: marker })
    await row.hover()
    await row.getByRole('button', { name: 'Reagieren', exact: true }).click()
    await page.getByRole('searchbox', { name: 'Emoji suchen' }).fill('rakete')
    await page.getByRole('button', { name: 'Mit Rakete reagieren' }).click({ timeout: 15_000 })

    // Tooltip = Name des eingeloggten Reagierenden („Alice Test"), kein Datum.
    const chip = row.locator('button[aria-pressed="true"]')
    await expect(chip).toBeVisible({ timeout: 15_000 })
    await expect(chip).toHaveAttribute('title', 'Alice Test')
})

/**
 * C2 (Löschen über das Menü) — die eigene Nachricht lässt sich über das „…"-Menü
 * (nicht nur den Inline-Trash) löschen: Menüeintrag „Löschen" → Bestätigung →
 * kind-5-Tombstone am Relay, Zeile verschwindet. Dedizierter „mod"-Raum.
 */
test('C2: Löschen über das „…"-Menü entfernt die Nachricht (kind-5)', async ({ page }) => {
    await openRoom(page, 'mod')
    const marker = `MD-${Math.floor(Math.random() * 1e9)}`
    const composer = page.getByPlaceholder('Nachricht schreiben…')
    await expect(composer).toBeVisible({ timeout: 15_000 })
    await composer.fill(marker)
    await page.getByRole('button', { name: 'Senden' }).click()
    await expect(page.getByText(marker, { exact: true })).toBeVisible({ timeout: 15_000 })

    // Parent-id am Relay festhalten, bevor der Tombstone die Nachricht verdeckt.
    let parent: RelayEvent | undefined
    await expect.poll(() => (parent = queryRelayEvent((e) => e.content === marker, 'mod')) !== undefined, { timeout: 15_000 }).toBe(true)
    const parentId = (parent as RelayEvent).id

    // „…"-Menü → Löschen (nur bei eigener Nachricht) → Bestätigungs-Modal.
    const row = page.locator('div.group', { hasText: marker })
    await row.hover()
    await row.getByRole('button', { name: 'Weitere Aktionen' }).click()
    await page.getByRole('menuitem', { name: 'Löschen' }).click()
    await page.getByRole('button', { name: 'Löschen', exact: true }).click()

    await expect(page.getByText(marker, { exact: true })).toHaveCount(0, { timeout: 15_000 })
    // Am Relay: kind-5 auf die Marker-Nachricht.
    await expect
        .poll(() => queryRelayEvent((e) => e.tags.some((t) => t[0] === 'e' && t[1] === parentId), 'mod', 5) !== undefined, {
            timeout: 15_000,
        })
        .toBe(true)
})

/**
 * C2 (Fork off!) — eine fremde Nachricht (ADMIN) anprangern: „…"-Menü → Fork off! → der
 * Default-Grund („spam") wird als kind-1984 (NIP-56) publiziert, mit `["p", autor]`
 * und `["e", id, reason]`, OHNE `h`/PROTECTED (keine Group-Message).
 */
test('C2: Fork off! erzeugt kind-1984 (p + e,reason)', async ({ page }) => {
    await openRoom(page, 'mod')
    await expect(page.getByPlaceholder('Nachricht schreiben…')).toBeVisible({ timeout: 15_000 })

    // Fremde Nachricht (ADMIN) als Fork-off!-Ziel — der Eintrag zeigt sich nur bei !m.mine.
    const marker = `RP-${Math.floor(Math.random() * 1e9)}`
    execFileSync(NAK, ['event', '--auth', '--sec', ADMIN, '-k', '9', '-t', 'h=mod', '-c', marker, ZOOID_WS])
    await expect(page.getByText(marker, { exact: true })).toBeVisible({ timeout: 15_000 })
    let target: RelayEvent | undefined
    await expect.poll(() => (target = queryRelayEvent((e) => e.content === marker, 'mod')) !== undefined, { timeout: 15_000 }).toBe(true)
    const t = target as RelayEvent

    const row = page.locator('div.group', { hasText: marker })
    await row.hover()
    await row.getByRole('button', { name: 'Weitere Aktionen' }).click()
    await page.getByRole('menuitem', { name: 'Fork off!' }).click()
    // Modal offen (Default-Grund „spam") → Fork off!.
    await page.getByRole('button', { name: 'Fork off!', exact: true }).click()

    // Am Relay: kind-1984 auf die Zielnachricht, p = Autor, e trägt den reason.
    let report: RelayEvent | undefined
    await expect
        .poll(() => (report = queryRelayEvent((e) => e.tags.some((tg) => tg[0] === 'e' && tg[1] === t.id), null, 1984)) !== undefined, {
            timeout: 15_000,
        })
        .toBe(true)
    const rep = report as RelayEvent
    expect(rep.tags.find((tg) => tg[0] === 'p')?.[1]).toBe(t.pubkey)
    expect(rep.tags.find((tg) => tg[0] === 'e' && tg[1] === t.id)?.[2]).toBe('spam')
    expect(rep.tags.some((tg) => tg[0] === 'h')).toBe(false) // Report ist keine Group-Message
})

/**
 * C2 (native App) — dieselbe View, Seam auf `isMobile`: im „…"-Vollbild-Modal zeigt
 * sich „Löschen" bei eigener, „Fork off!" bei fremder Nachricht.
 */
test('C2: native Modal zeigt Löschen (eigen) und Fork off! (fremd)', async ({ page }) => {
    await openRoom(page, 'mod')
    await expect(page.getByPlaceholder('Nachricht schreiben…')).toBeVisible({ timeout: 15_000 })
    await page.addInitScript(() => {
        ;(window as unknown as { __nostrMobile: boolean }).__nostrMobile = true
    })
    await page.goto('/rooms/mod')

    // Eigene frische Nachricht → Modal zeigt „Löschen", nicht „Fork off!".
    const own = `NM-${Math.floor(Math.random() * 1e9)}`
    const composer = page.getByPlaceholder('Nachricht schreiben…')
    await expect(composer).toBeVisible({ timeout: 15_000 })
    await composer.fill(own)
    await page.getByRole('button', { name: 'Senden' }).click()
    await expect(page.getByText(own, { exact: true })).toBeVisible({ timeout: 15_000 })

    const ownRow = page.locator('div.group', { hasText: own })
    await ownRow.click()
    await ownRow.getByRole('button', { name: 'Weitere Aktionen' }).click()
    const modal = page.locator('dialog[data-modal="message-menu"]')
    await expect(modal.getByRole('button', { name: 'Löschen' })).toBeVisible()
    await expect(modal.getByRole('button', { name: 'Fork off!' })).toBeHidden()
    await modal.getByRole('button', { name: 'Antworten' }).click() // Modal schließen

    // Fremde (ADMIN) Nachricht → Modal zeigt „Fork off!", nicht „Löschen".
    const foreign = `NF-${Math.floor(Math.random() * 1e9)}`
    execFileSync(NAK, ['event', '--auth', '--sec', ADMIN, '-k', '9', '-t', 'h=mod', '-c', foreign, ZOOID_WS])
    await expect(page.getByText(foreign, { exact: true })).toBeVisible({ timeout: 15_000 })
    const foreignRow = page.locator('div.group', { hasText: foreign })
    await foreignRow.click()
    await foreignRow.getByRole('button', { name: 'Weitere Aktionen' }).click()
    await expect(modal.getByRole('button', { name: 'Fork off!' })).toBeVisible()
    await expect(modal.getByRole('button', { name: 'Löschen' })).toBeHidden()
})

/**
 * C3 (Bearbeiten) — eine frische eigene Nachricht bearbeiten: „…"-Menü → Bearbeiten
 * füllt den Composer mit dem alten Text; nach dem Speichern liegt am Relay ein kind-5
 * (Delete des Alten) UND eine neue kind-9 mit demselben `created_at` (Position bleibt).
 */
test('C3: Bearbeiten republisht mit gleicher created_at (Delete + kind-9)', async ({ page }) => {
    await openRoom(page, 'edit')
    const composer = page.getByPlaceholder('Nachricht schreiben…')
    await expect(composer).toBeVisible({ timeout: 15_000 })

    const a = `EDIT-a-${Math.floor(Math.random() * 1e9)}`
    const b = `EDIT-b-${Math.floor(Math.random() * 1e9)}`
    await composer.fill(a)
    await page.getByRole('button', { name: 'Senden' }).click()
    await expect(page.getByText(a, { exact: true })).toBeVisible({ timeout: 15_000 })

    // Original am Relay festhalten (id + created_at) — der Republish erbt created_at.
    let orig: RelayEvent | undefined
    await expect.poll(() => (orig = queryRelayEvent((e) => e.content === a, 'edit')) !== undefined, { timeout: 15_000 }).toBe(true)
    const original = orig as RelayEvent

    // „…"-Menü → Bearbeiten → Composer trägt den alten Text, Kontext „Nachricht bearbeiten".
    const row = page.locator('div.group', { hasText: a })
    await row.hover()
    await row.getByRole('button', { name: 'Weitere Aktionen' }).click()
    await page.getByRole('menuitem', { name: 'Bearbeiten' }).click()
    await expect(page.getByText('Nachricht bearbeiten')).toBeVisible()
    await expect(composer).toHaveValue(a)

    await composer.fill(b)
    await page.getByRole('button', { name: 'Senden' }).click()

    // UI: neue Fassung da, alte weg.
    await expect(page.getByText(b, { exact: true })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(a, { exact: true })).toHaveCount(0, { timeout: 15_000 })

    // Relay: kind-5 auf das Original UND neue kind-9 (Text b) mit demselben created_at.
    await expect
        .poll(() => queryRelayEvent((e) => e.tags.some((t) => t[0] === 'e' && t[1] === original.id), 'edit', 5) !== undefined, {
            timeout: 15_000,
        })
        .toBe(true)
    let edited: RelayEvent | undefined
    await expect.poll(() => (edited = queryRelayEvent((e) => e.content === b, 'edit')) !== undefined, { timeout: 15_000 }).toBe(true)
    expect((edited as RelayEvent).created_at).toBe(original.created_at)
    expect((edited as RelayEvent).id).not.toBe(original.id)
})

/**
 * C3 (Bearbeiten-Grenze) — eine über 5 Minuten alte eigene Nachricht bietet kein
 * „Bearbeiten" mehr (canEdit-Zeitfenster), wohl aber „Zitieren" und „Löschen".
 */
test('C3: >5 min alte Nachricht bietet kein Bearbeiten', async ({ page }) => {
    await openRoom(page, 'edit')
    await expect(page.getByPlaceholder('Nachricht schreiben…')).toBeVisible({ timeout: 15_000 })

    // Eigene, 10 min alte Nachricht seeden (als Test-User → m.mine, aber außerhalb des Fensters).
    const marker = `OLD-${Math.floor(Math.random() * 1e9)}`
    const oldTs = Math.floor(Date.now() / 1000) - 600
    execFileSync(NAK, ['event', '--auth', '--sec', NSEC, '-k', '9', '-t', 'h=edit', '--ts', String(oldTs), '-c', marker, ZOOID_WS])
    await expect(page.getByText(marker, { exact: true })).toBeVisible({ timeout: 15_000 })

    const row = page.locator('div.group', { hasText: marker })
    await row.hover()
    await row.getByRole('button', { name: 'Weitere Aktionen' }).click()
    await expect(page.getByRole('menuitem', { name: 'Bearbeiten' })).toHaveCount(0)
    await expect(page.getByRole('menuitem', { name: 'Zitieren' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Löschen' })).toBeVisible()
})

/**
 * C3 (Zitieren) — eine Nachricht ohne Kommentar teilen (Quote-Only): „…"-Menü →
 * Zitieren → leer senden → am Relay eine kind-9 mit `q`+`p`+`h` und einem Body, der
 * nur aus dem `nostr:nevent…`-Präfix besteht. Im Verlauf rendert die bestehende
 * Zitat-Vorschau (Original + Vorschau = 2× Markertext).
 */
test('C3: Zitieren erzeugt Quote-Only (q/p, leerer Body)', async ({ page }) => {
    await openRoom(page, 'edit')
    const composer = page.getByPlaceholder('Nachricht schreiben…')
    await expect(composer).toBeVisible({ timeout: 15_000 })

    const marker = `QUOTE-${Math.floor(Math.random() * 1e9)}`
    await composer.fill(marker)
    await page.getByRole('button', { name: 'Senden' }).click()
    await expect(page.getByText(marker, { exact: true })).toBeVisible({ timeout: 15_000 })
    let target: RelayEvent | undefined
    await expect.poll(() => (target = queryRelayEvent((e) => e.content === marker, 'edit')) !== undefined, { timeout: 15_000 }).toBe(true)
    const t = target as RelayEvent

    // „…"-Menü → Zitieren → Kontext „Zitieren", Composer leer, Senden trotzdem aktiv.
    const row = page.locator('div.group', { hasText: marker })
    await row.hover()
    await row.getByRole('button', { name: 'Weitere Aktionen' }).click()
    await page.getByRole('menuitem', { name: 'Zitieren' }).click()
    // Share-Modus aktiv: Composer bleibt leer, Senden ist trotzdem freigeschaltet.
    await expect(composer).toHaveValue('')
    const send = page.getByRole('button', { name: 'Senden' })
    await expect(send).toBeEnabled()
    await send.click()

    // Relay: Quote-Only kind-9 auf die Zielnachricht — q + p + h, Body nur nevent-Präfix.
    let quote: RelayEvent | undefined
    await expect
        .poll(() => (quote = queryRelayEvent((e) => e.tags.some((tg) => tg[0] === 'q' && tg[1] === t.id), 'edit')) !== undefined, {
            timeout: 15_000,
        })
        .toBe(true)
    const q = quote as RelayEvent
    expect(q.content).toMatch(/^nostr:nevent1[0-9a-z]+\s*$/)
    expect(q.tags.find((tg) => tg[0] === 'p')?.[1]).toBe(t.pubkey)
    expect(q.tags.find((tg) => tg[0] === 'h')?.[1]).toBe('edit')

    // UI: die Zitat-Vorschau rendert das Original → Markertext erscheint zweimal.
    await expect(page.getByText(marker, { exact: true })).toHaveCount(2, { timeout: 15_000 })
})

/**
 * C3 (native App) — dieselbe View, Seam auf `isMobile`: das „…"-Vollbild-Modal zeigt
 * bei eigener frischer Nachricht „Bearbeiten" und „Zitieren".
 */
test('C3: native Modal zeigt Bearbeiten + Zitieren', async ({ page }) => {
    await openRoom(page, 'edit')
    await expect(page.getByPlaceholder('Nachricht schreiben…')).toBeVisible({ timeout: 15_000 })
    await page.addInitScript(() => {
        ;(window as unknown as { __nostrMobile: boolean }).__nostrMobile = true
    })
    await page.goto('/rooms/edit')

    const own = `NEDIT-${Math.floor(Math.random() * 1e9)}`
    const composer = page.getByPlaceholder('Nachricht schreiben…')
    await expect(composer).toBeVisible({ timeout: 15_000 })
    await composer.fill(own)
    await page.getByRole('button', { name: 'Senden' }).click()
    await expect(page.getByText(own, { exact: true })).toBeVisible({ timeout: 15_000 })

    const ownRow = page.locator('div.group', { hasText: own })
    await ownRow.click()
    await ownRow.getByRole('button', { name: 'Weitere Aktionen' }).click()
    const modal = page.locator('dialog[data-modal="message-menu"]')
    await expect(modal.getByRole('button', { name: 'Bearbeiten' })).toBeVisible()
    await expect(modal.getByRole('button', { name: 'Zitieren' })).toBeVisible()
})

/**
 * C3 (Bearbeiten eines Zitats) — wird eine ANTWORT bearbeitet, bleiben `q`/`p`-Tag
 * und der `nostr:nevent…`-Präfix erhalten (der Erhaltungszweig von editRoomMessage).
 * Sonst verlöre ein bearbeiteter Reply still seinen Thread-Bezug.
 */
test('C3: Bearbeiten einer Antwort erhält q/p + nevent-Präfix', async ({ page }) => {
    await openRoom(page, 'edit')
    const composer = page.getByPlaceholder('Nachricht schreiben…')
    await expect(composer).toBeVisible({ timeout: 15_000 })

    const a = `RE-a-${Math.floor(Math.random() * 1e9)}`
    const b = `RE-b-${Math.floor(Math.random() * 1e9)}`
    const b2 = `RE-b2-${Math.floor(Math.random() * 1e9)}`
    await composer.fill(a)
    await page.getByRole('button', { name: 'Senden' }).click()
    await expect(page.getByText(a, { exact: true })).toBeVisible({ timeout: 15_000 })
    let aEv: RelayEvent | undefined
    await expect.poll(() => (aEv = queryRelayEvent((e) => e.content === a, 'edit')) !== undefined, { timeout: 15_000 }).toBe(true)
    const aRelay = aEv as RelayEvent

    // Auf A antworten → B trägt q/p + Präfix.
    const rowA = page.locator('div.group', { hasText: a })
    await rowA.click()
    await rowA.getByRole('button', { name: 'Antworten' }).click()
    await composer.fill(b)
    await page.getByRole('button', { name: 'Senden' }).click()
    await expect(page.getByText(b, { exact: true })).toBeVisible({ timeout: 15_000 })
    let bEv: RelayEvent | undefined
    await expect.poll(() => (bEv = queryRelayEvent((e) => e.content.endsWith(b), 'edit')) !== undefined, { timeout: 15_000 }).toBe(true)
    const bOrig = bEv as RelayEvent

    // B bearbeiten: Composer zeigt nur B's Klartext (ohne Präfix) → auf B2 ändern.
    const rowB = page.locator('div.group', { hasText: b })
    await rowB.hover()
    await rowB.getByRole('button', { name: 'Weitere Aktionen' }).click()
    await page.getByRole('menuitem', { name: 'Bearbeiten' }).click()
    await expect(composer).toHaveValue(b)
    await composer.fill(b2)
    await page.getByRole('button', { name: 'Senden' }).click()
    await expect(page.getByText(b2, { exact: true })).toBeVisible({ timeout: 15_000 })

    // Relay: neue kind-9 (Text b2) behält q=A.id + p=A.pubkey + nevent-Präfix, created_at = B.
    let edited: RelayEvent | undefined
    await expect.poll(() => (edited = queryRelayEvent((e) => e.content.endsWith(b2), 'edit')) !== undefined, { timeout: 15_000 }).toBe(true)
    const ed = edited as RelayEvent
    expect(ed.content).toMatch(/^nostr:nevent1[0-9a-z]+\n\n/)
    expect(ed.tags.find((t) => t[0] === 'q')?.[1]).toBe(aRelay.id)
    expect(ed.tags.find((t) => t[0] === 'p')?.[1]).toBe(aRelay.pubkey)
    expect(ed.created_at).toBe(bOrig.created_at)
    expect(ed.id).not.toBe(bOrig.id)
})

/**
 * B3 (Profil-Karte) — Klick auf den Autor-Namen im Chat öffnet eine Profil-Karte
 * mit den kind-0-Tiefen-Feldern (about/website/lud16), die sonst brachliegen.
 * Ein reicheres (neueres) kind-0 für den Admin wird vorab publiziert; deriveProfile
 * lädt es beim Öffnen lazy nach.
 */
test('B3: Autor-Profil-Karte zeigt about/website/lud16', async ({ page }) => {
    const bio = `E2E-Bio-${Math.floor(Math.random() * 1e9)}`
    execFileSync(NAK, [
        'event', '--auth', '--sec', ADMIN, '-k', '0',
        '-c', JSON.stringify({ name: 'Relay Admin', about: bio, website: 'https://profil-test.example', lud16: 'admin@ln.test' }),
        ZOOID_WS,
    ])

    await openRoom(page)
    await expect(page.getByText('Willkommen im Space! 👋')).toBeVisible({ timeout: 15_000 })

    // Autor-Namen anklicken → Karte (Dialog) mit den Tiefen-Feldern.
    await page.getByRole('button', { name: 'Relay Admin' }).first().click()
    const card = page.getByRole('dialog')
    await expect(card.getByText(bio)).toBeVisible({ timeout: 15_000 })
    await expect(card.getByRole('link', { name: /profil-test\.example/ })).toBeVisible()
    await expect(card.getByText('admin@ln.test')).toBeVisible()
})

/** Publiziert eine kind-9-Nachricht direkt in „scroll" (fremder Autor = ADMIN). */
function publishToScroll(content: string): void {
    execFileSync(NAK, [
        'event', '--auth', '--sec', ADMIN, '-k', '9', '-t', 'h=scroll',
        '-c', content, ZOOID_WS,
    ])
}

/**
 * D1 (Auto-Load-Older) — „scroll" hat 60 Nachrichten, initial werden nur die
 * jüngsten 50 geladen (Zeile 11–60). Am oberen Rand lädt der Verlauf die ältere
 * Seite automatisch nach; „Zeile 1" erscheint, ohne den Button zu klicken.
 */
test('D1: Ältere laden automatisch beim Hochscrollen', async ({ page }) => {
    await openRoom(page, 'scroll')
    await expect(page.getByText('Zeile 60', { exact: true })).toBeVisible({ timeout: 15_000 })

    // Älteste Nachricht ist initial nicht geladen (jenseits des 50er-Limits).
    await expect(page.getByText('Zeile 1', { exact: true })).toHaveCount(0)

    // Wiederholt an den oberen Rand scrollen, bis die ältere Seite nachgeladen ist.
    // (toPass fängt den seltenen Fall ab, dass ein Live-Emit im 50-ms-Scroll-Debounce
    // kurz ans Ende zurückspringt.)
    const log = page.locator('[role=log]')
    await expect(async () => {
        await log.hover()
        await page.mouse.wheel(0, -6000)
        await expect(page.getByText('Zeile 1', { exact: true })).toBeVisible({ timeout: 1500 })
    }).toPass({ timeout: 25_000 })
})

/**
 * D1 (Unread-Zähler + Jump) — hochgescrollt erscheint der Zurück-ans-Ende-Button;
 * zwei live eintreffende Fremd-Nachrichten ergeben „2 neue" (der alte Zähler
 * addierte pro Emit statt echte Nachrichten). Der Klick springt ans Ende und
 * blendet Zähler + Button aus.
 */
test('D1: Unread-Zähler zählt Nachrichten, Jump springt ans Ende', async ({ page }) => {
    await openRoom(page, 'scroll')
    await expect(page.getByText('Zeile 60', { exact: true })).toBeVisible({ timeout: 15_000 })

    const jumpBtn = page.getByRole('button', { name: 'Zum Ende springen' })
    // Am Ende → kein Jump-Button.
    await expect(jumpBtn).toBeHidden()

    // Robust hochscrollen, bis der Jump-Button hält (siehe Auto-Load-Test). Löst
    // evtl. Auto-Load älterer Seiten aus — die dürfen den Unread-Zähler NICHT
    // hochtreiben.
    const log = page.locator('[role=log]')
    await expect(async () => {
        await log.hover()
        await page.mouse.wheel(0, -1200)
        await expect(jumpBtn).toBeVisible({ timeout: 1500 })
    }).toPass({ timeout: 15_000 })

    // Zwei Live-Nachrichten → Zähler = 2 (nicht am Ende → wird nicht mitgescrollt).
    const marker = `Zaehl-${Math.floor(Math.random() * 1e9)}`
    publishToScroll(`${marker}-a`)
    publishToScroll(`${marker}-b`)
    await expect(page.getByText('2 neue')).toBeVisible({ timeout: 15_000 })

    // Jump → ans Ende, Zähler + Button verschwinden.
    await jumpBtn.click()
    await expect(jumpBtn).toBeHidden()
})

/**
 * D2 (Shift+Enter) — der alte `.prevent` verschluckte JEDEN Enter, mehrzeilige
 * Nachrichten waren unmöglich. Shift+Enter fügt jetzt einen Umbruch ein (kein
 * Senden), Enter allein sendet.
 */
test('D2: Shift+Enter macht Umbruch, Enter sendet', async ({ page }) => {
    await openRoom(page)
    await expect(page.getByText('Willkommen im Space! 👋')).toBeVisible({ timeout: 15_000 })

    const marker = `ML-${Math.floor(Math.random() * 1e9)}`
    const composer = page.getByPlaceholder('Nachricht schreiben…')
    await composer.click()
    await page.keyboard.type(marker)
    await page.keyboard.press('Shift+Enter')
    await page.keyboard.type('zeile2')

    // Shift+Enter: Umbruch bleibt, nichts gesendet.
    await expect(composer).toHaveValue(`${marker}\nzeile2`)

    // Enter ohne Shift: sendet → Composer leert, mehrzeilige Nachricht erscheint.
    await page.keyboard.press('Enter')
    await expect(composer).toHaveValue('')
    await expect(page.getByText(marker)).toBeVisible({ timeout: 15_000 })
})

/**
 * D2 (Zitat-Sprung) — die Zitat-Vorschau einer Antwort ist klickbar und springt
 * zur zitierten Original-Nachricht, die kurz mit einem Brand-Ring hervorgehoben wird.
 */
test('D2: Klick aufs Zitat hebt die Original-Nachricht hervor', async ({ page }) => {
    await openRoom(page)
    await expect(page.getByText('Willkommen im Space! 👋')).toBeVisible({ timeout: 15_000 })

    const a = `Q-${Math.floor(Math.random() * 1e9)}`
    const b = `R-${Math.floor(Math.random() * 1e9)}`
    const composer = page.getByPlaceholder('Nachricht schreiben…')

    await composer.fill(a)
    await page.getByRole('button', { name: 'Senden' }).click()
    await expect(page.getByText(a, { exact: true })).toBeVisible({ timeout: 15_000 })

    const rowA = page.locator('div.group', { hasText: a })
    await rowA.click()
    await rowA.getByRole('button', { name: 'Antworten' }).click()
    await composer.fill(b)
    await page.getByRole('button', { name: 'Senden' }).click()
    await expect(page.getByText(b, { exact: true })).toBeVisible({ timeout: 15_000 })

    // Zitat-Vorschau in B (enthält A's Text) anklicken → Original hervorgehoben.
    await page.getByRole('button').filter({ hasText: a }).first().click()
    await expect(page.locator('div.group[class*="ring-brand-500"]')).toBeVisible({ timeout: 3_000 })
})

/**
 * D2 (Fehler-Retry) — lehnt der Relay die kind-9-Publikation ab, erscheint statt
 * eines flüchtigen Toasts eine aktionable Hinweiszeile mit gefülltem Draft; die
 * optimistische Nachricht wird zurückgenommen (kein Doppel), „Erneut senden" nach
 * Freigabe des Relays sendet erfolgreich. Der Reject wird per WebSocket-Route
 * erzwungen (nur kind-9-EVENTs, alles andere läuft durch).
 */
test('D2: Publish-Fehler zeigt Retry-Zeile, erneutes Senden räumt sie', async ({ page }) => {
    await useZooid(page)

    let blockKind9 = true
    await page.routeWebSocket(/localhost:3335/, (ws) => {
        const server = ws.connectToServer()
        ws.onMessage((raw) => {
            const s = typeof raw === 'string' ? raw : raw.toString()
            if (blockKind9) {
                try {
                    const parsed = JSON.parse(s)
                    if (parsed[0] === 'EVENT' && parsed[1]?.kind === 9) {
                        ws.send(JSON.stringify(['OK', parsed[1].id, false, 'blocked: test']))
                        return
                    }
                } catch {
                    // Kein JSON → einfach durchreichen.
                }
            }
            server.send(s)
        })
        server.onMessage((raw) => ws.send(raw))
    })

    await page.goto('/nostr-login')
    await page.getByPlaceholder(/nsec1/).fill(NSEC)
    await page.getByRole('button', { name: 'Anmelden' }).click()
    await page.waitForURL('**/spaces')
    await page.goto('/rooms/welcome')
    await expect(page.getByText('Willkommen im Space! 👋')).toBeVisible({ timeout: 15_000 })

    const marker = `Fail-${Math.floor(Math.random() * 1e9)}`
    const composer = page.getByPlaceholder('Nachricht schreiben…')
    await composer.fill(marker)
    await page.getByRole('button', { name: 'Senden' }).click()

    // Fehler-Zeile erscheint, Draft bleibt, optimistische Nachricht ist zurückgenommen.
    await expect(page.getByRole('button', { name: 'Erneut senden' })).toBeVisible({ timeout: 15_000 })
    await expect(composer).toHaveValue(marker)
    await expect(page.getByText(marker, { exact: true })).toHaveCount(0)

    // Relay freigeben und erneut senden → Nachricht kommt an, Fehler-Zeile weg.
    blockKind9 = false
    await page.getByRole('button', { name: 'Erneut senden' }).click()
    await expect(page.getByText(marker, { exact: true })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('button', { name: 'Erneut senden' })).toBeHidden()
})

/**
 * B4 (NIP-05) — der Admin bekommt ein kind-0 mit `nip05`; der nostr.json-Fetch wird
 * gestubbt, sodass der Handle auf genau seine pubkey zeigt (Match). Die Profil-Karte
 * zeigt dann das verifizierte Häkchen samt Handle. Die Verifizierung ist Netz-I/O,
 * darum der Route-Stub — kein echter `.well-known`-Abruf.
 */
test('B4: verifizierter NIP-05-Handle zeigt Häkchen in der Profil-Karte', async ({ page }) => {
    const handle = 'admin@nip05-test.example'
    // ADMIN ist der SECRET; die zugehörige Autor-pubkey im Chat ist SELF (Relay-Owner).
    const SELF = 'da99fbe39247109327ac8504750d0227d50a8f84049ac8bd2f6c7ad0806ed76d'
    execFileSync(NAK, [
        'event', '--auth', '--sec', ADMIN, '-k', '0',
        '-c', JSON.stringify({ name: 'Relay Admin', nip05: handle }),
        ZOOID_WS,
    ])
    // welshman löst NIP-05 privacy-schonend über dufflepud auf (kein direkter
    // .well-known-Abruf) — Stub liefert den Handle mit GENAU der Autor-pubkey (Match).
    await page.route('**/handle/info', (route) =>
        route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify({ data: [{ handle, info: { pubkey: SELF, nip05: handle } }] }),
        }),
    )

    await openRoom(page)
    await expect(page.getByText('Willkommen im Space! 👋')).toBeVisible({ timeout: 15_000 })

    await page.getByRole('button', { name: 'Relay Admin' }).first().click()
    const card = page.getByRole('dialog')
    // Häkchen (Titel „NIP-05 verifiziert: …") + Handle-Text erscheinen nur bei Match.
    await expect(card.getByText(handle)).toBeVisible({ timeout: 15_000 })
    await expect(card.getByTitle(`NIP-05 verifiziert: ${handle}`)).toBeVisible()
})
