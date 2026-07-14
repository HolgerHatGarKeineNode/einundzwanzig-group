import { test, expect, type Page } from './support/fixtures'
import { execFileSync } from 'node:child_process'
import { useZooid, ZOOID_WS, ZOOID_PORT } from './support/zooid'
import { loginNsec } from './support/login'

const NSEC = process.env.NOSTR_TEST_NSEC as string
const NAK = '/home/user/go/bin/nak'
const ADMIN = 'b2ee09a54bedf17ee1db562bdddd75c48661d981eb52c49dc206c55ba8439414'
// Pubkey des „Relay Admin" (ADMIN ist dessen Secret) — Ziel-Pubkey der @-Mention (C4).
const SELF = 'da99fbe39247109327ac8504750d0227d50a8f84049ac8bd2f6c7ad0806ed76d'
// Pubkey des eingeloggten Test-Users (= pub von NOSTR_TEST_NSEC) — Autor der Poll-Votes (C5).
const VIEWER = '2dbaf5f4f86a1eed0948852ad48fa40aae2e48d5e347a77fac2ac936d6c94e7b'

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
    await loginNsec(page, NSEC)
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

    // Ältere Nachrichten laden jetzt automatisch beim Hochscrollen (createScroller, column-reverse)
    // — kein „Ältere laden"-Button mehr. Das Nachladen selbst deckt der D1-Scroll-Test ab.
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
    await rowA.getByRole('button', { name: 'Antworten', exact: true }).click()
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
    await rowA.getByRole('button', { name: 'Antworten', exact: true }).click()
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
    await expect(page.getByRole('menuitem', { name: 'Antworten', exact: true })).toBeVisible()

    // Eintrag setzt den Antwort-Kontext (identisch zur Inline-Aktion).
    await page.getByRole('menuitem', { name: 'Antworten', exact: true }).click()
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
    await modal.getByRole('button', { name: 'Antworten', exact: true }).click()
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
    await page.getByRole('button', { name: 'Reagieren mit Daumen hoch' }).click({ timeout: 15_000 })

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
    await page.getByRole('button', { name: 'Reagieren mit Einhorn' }).click({ timeout: 15_000 })

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
    const customBtn = page.getByRole('button', { name: `Reagieren mit :${code}:` })
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
    await modal.getByRole('button', { name: 'Reagieren mit Konfettibombe' }).click({ timeout: 15_000 })

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
    await page.getByRole('button', { name: 'Reagieren mit Rakete' }).click({ timeout: 15_000 })

    // Erneut öffnen → 🚀 steht jetzt in der „Zuletzt benutzt"-Reihe.
    await row.hover()
    await row.getByRole('button', { name: 'Reagieren', exact: true }).click()
    await expect(
        page.getByRole('group', { name: 'Zuletzt benutzt' }).getByRole('button', { name: 'Reagieren mit Rakete' }),
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
    await page.getByRole('button', { name: 'Reagieren mit Rakete' }).click({ timeout: 15_000 })

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
    await modal.getByRole('button', { name: 'Antworten', exact: true }).click() // Modal schließen

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
 * C3 (Bearbeiten-Grenze) — eine über 30 Minuten alte eigene Nachricht bietet kein
 * „Bearbeiten" mehr (canEdit-Zeitfenster), wohl aber „Zitieren" und „Löschen".
 */
test('C3: >30 min alte Nachricht bietet kein Bearbeiten', async ({ page }) => {
    await openRoom(page, 'edit')
    await expect(page.getByPlaceholder('Nachricht schreiben…')).toBeVisible({ timeout: 15_000 })

    // Eigene, 40 min alte Nachricht seeden (als Test-User → m.mine, aber außerhalb des Fensters).
    const marker = `OLD-${Math.floor(Math.random() * 1e9)}`
    const oldTs = Math.floor(Date.now() / 1000) - 2400
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
    await rowA.getByRole('button', { name: 'Antworten', exact: true }).click()
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
    await rowA.getByRole('button', { name: 'Antworten', exact: true }).click()
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
    await page.routeWebSocket(new RegExp(`localhost:${ZOOID_PORT}`), (ws) => {
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

    await loginNsec(page, NSEC)
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
    // Seit dufflepudUrl='' (Auftraggeber-Entscheidung 2026-07-10) verifiziert welshman
    // NIP-05 DIREKT über .well-known/nostr.json (queryProfile), nicht über dufflepud.
    // Stub liefert `names.admin` = GENAU die Autor-pubkey (Match) + CORS für den Cross-
    // Origin-Fetch nach nip05-test.example.
    await page.route('**/.well-known/nostr.json*', (route) =>
        route.fulfill({
            contentType: 'application/json',
            headers: { 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({ names: { admin: SELF } }),
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

/**
 * C4 (Mention) — `@`-Autocomplete im Composer: nach `@Relay` erscheint der
 * Mitglieder-Vorschlag „Relay Admin"; die Auswahl fügt `nostr:npub… ` ein. Die
 * gesendete kind-9 trägt ein `["p", SELF]`-Tag (NIP-08/27) und rendert als @Name.
 */
test('C4: @-Mention fügt nostr:npub ein, trägt p-Tag, rendert @Name', async ({ page }) => {
    await openRoom(page, 'mention')
    const composer = page.getByPlaceholder('Nachricht schreiben…')
    await expect(composer).toBeVisible({ timeout: 15_000 })

    // Text zuerst, dann `@Relay` → der Vorschlag ersetzt das @-Token an Ort und
    // Stelle (Directory lädt async → tippen wiederholen, bis der Vorschlag steht).
    const marker = `MENTION-${Math.floor(Math.random() * 1e9)}`
    const suggestion = page.getByRole('button', { name: /Relay Admin/ })
    await expect(async () => {
        await composer.fill('')
        await composer.pressSequentially(`${marker} @Relay`)
        await expect(suggestion).toBeVisible({ timeout: 1500 })
    }).toPass({ timeout: 20_000 })

    await suggestion.click()
    // Draft: „<marker> nostr:npub… " — das npub steht an einer Wortgrenze (rendert als Mention).
    await expect(composer).toHaveValue(new RegExp(`^${marker} nostr:npub1[0-9a-z]+ $`))
    await page.getByRole('button', { name: 'Senden' }).click()

    // Gerendert: der Profil-Node löst in DIESER Nachricht zu „@Relay Admin" auf
    // (nicht rohes nprofile). Auf die Marker-Zeile scopen — der mention-Raum wird
    // über Läufe wiederverwendet, es gibt also mehrere @Relay-Admin-Spans.
    const rendered = page.locator('div.group', { hasText: marker })
    await expect(rendered.locator('.mention', { hasText: '@Relay Admin' })).toBeVisible({ timeout: 15_000 })

    // Relay: kind-9 mit nostr:npub… im Content UND p-Tag = SELF (Mention-Ziel).
    let msg: RelayEvent | undefined
    await expect.poll(() => (msg = queryRelayEvent((e) => e.content.includes(marker), 'mention')) !== undefined, { timeout: 15_000 }).toBe(true)
    const m = msg as RelayEvent
    expect(m.content).toMatch(/nostr:npub1[0-9a-z]+/)
    expect(m.tags.find((t) => t[0] === 'p')?.[1]).toBe(SELF)
})

/**
 * C4 (Mention-Popover) — wird die Nachricht per Senden-Button bei offenem
 * Autocomplete abgeschickt, schließt das Popover (kein veralteter Splice-Zustand
 * über dem geleerten Composer). Review-Fix (closeMentions in send()).
 */
test('C4: Senden bei offenem @-Popover schließt das Popover', async ({ page }) => {
    await openRoom(page, 'mention')
    const composer = page.getByPlaceholder('Nachricht schreiben…')
    await expect(composer).toBeVisible({ timeout: 15_000 })

    const suggestion = page.getByRole('button', { name: /Relay Admin/ })
    await expect(async () => {
        await composer.fill('')
        await composer.pressSequentially('@Relay')
        await expect(suggestion).toBeVisible({ timeout: 1500 })
    }).toPass({ timeout: 20_000 })

    // Statt Enter (das würde auswählen) den Senden-Button klicken → Popover weg.
    await page.getByRole('button', { name: 'Senden' }).click()
    await expect(suggestion).toBeHidden()
    await expect(composer).toHaveValue('')
})

/**
 * C4 (Kopieren) — das „…"-Menü kopiert nevent/npub/JSON in die Zwischenablage
 * (nur lesen, kein Publish). Prüft die drei Formate über die Clipboard-API.
 */
test('C4: Kopieren liefert nevent/npub/JSON in die Zwischenablage', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await openRoom(page, 'mention')
    const composer = page.getByPlaceholder('Nachricht schreiben…')
    await expect(composer).toBeVisible({ timeout: 15_000 })

    const marker = `COPY-${Math.floor(Math.random() * 1e9)}`
    await composer.fill(marker)
    await page.getByRole('button', { name: 'Senden' }).click()
    await expect(page.getByText(marker, { exact: true })).toBeVisible({ timeout: 15_000 })

    const row = page.locator('div.group', { hasText: marker })
    const readClip = () => page.evaluate(() => navigator.clipboard.readText())

    // Das „…"-Menü ist ein flux:dropdown, das floating-ui ans schwebende Panel positioniert.
    // Solange der Chat-Virtualizer noch Zeilen/Profile nachlädt, wandert der Anker → das
    // Panel repositioniert → der Eintrag wird nie „stable" (unter Parallel-Last verschärft).
    // Deshalb die GANZE Einheit (öffnen → Eintrag klicken → Clipboard prüfen) als toPass:
    // ein transienter Jank verwirft den Versuch und öffnet frisch, bis es sitzt.
    const copyVia = async (item: string, check: (clip: string) => void) => {
        await expect(async () => {
            await row.hover()
            await row.getByRole('button', { name: 'Weitere Aktionen' }).click()
            await page.getByRole('menuitem', { name: item }).click({ timeout: 2000 })
            check(await readClip())
        }).toPass({ timeout: 20_000 })
    }

    await copyVia('npub kopieren', (clip) => expect(clip).toMatch(/^npub1[0-9a-z]+$/))
    await copyVia('Event-Link kopieren', (clip) => expect(clip).toMatch(/^nostr:nevent1[0-9a-z]+$/))
    await copyVia('JSON kopieren', (clip) => {
        const json = JSON.parse(clip) as RelayEvent
        expect(json.kind).toBe(9)
        expect(json.content).toBe(marker)
    })
})

/**
 * C4 (Info) — das „…"-Menü öffnet ein Nachricht-Info-Modal mit nevent, npub und
 * dem rohen signierten Event (kind 9 + Inhalt). Nur lesen.
 */
test('C4: Info-Modal zeigt nevent/npub/Roh-Event', async ({ page }) => {
    await openRoom(page, 'mention')
    const composer = page.getByPlaceholder('Nachricht schreiben…')
    await expect(composer).toBeVisible({ timeout: 15_000 })

    const marker = `INFO-${Math.floor(Math.random() * 1e9)}`
    await composer.fill(marker)
    await page.getByRole('button', { name: 'Senden' }).click()
    await expect(page.getByText(marker, { exact: true })).toBeVisible({ timeout: 15_000 })

    const row = page.locator('div.group', { hasText: marker })
    await row.hover()
    await row.getByRole('button', { name: 'Weitere Aktionen' }).click()
    await page.getByRole('menuitem', { name: 'Info' }).click()

    const modal = page.locator('dialog[data-modal="message-info"]')
    await expect(modal.getByText('Nachricht-Details')).toBeVisible()
    await expect(modal.getByText(/^nostr:nevent1[0-9a-z]+$/)).toBeVisible()
    await expect(modal.getByText(/^npub1[0-9a-z]+$/)).toBeVisible()
    await expect(modal.locator('pre')).toContainText('"kind": 9')
    await expect(modal.locator('pre')).toContainText(marker)
})

/**
 * C4 (native App) — dieselbe View, Seam auf `isMobile`: das „…"-Vollbild-Modal
 * bietet die Kopier-/Info-Einträge (kein Web-Popover).
 */
test('C4: natives Modal zeigt Kopieren + Info', async ({ page }) => {
    await openRoom(page, 'mention')
    await expect(page.getByPlaceholder('Nachricht schreiben…')).toBeVisible({ timeout: 15_000 })
    await page.addInitScript(() => {
        ;(window as unknown as { __nostrMobile: boolean }).__nostrMobile = true
    })
    await page.goto('/rooms/mention')

    const marker = `NCOPY-${Math.floor(Math.random() * 1e9)}`
    const composer = page.getByPlaceholder('Nachricht schreiben…')
    await expect(composer).toBeVisible({ timeout: 15_000 })
    await composer.fill(marker)
    await page.getByRole('button', { name: 'Senden' }).click()
    await expect(page.getByText(marker, { exact: true })).toBeVisible({ timeout: 15_000 })

    const row = page.locator('div.group', { hasText: marker })
    await row.click()
    await row.getByRole('button', { name: 'Weitere Aktionen' }).click()
    const modal = page.locator('dialog[data-modal="message-menu"]')
    await expect(modal.getByRole('button', { name: 'Event-Link kopieren' })).toBeVisible()
    await expect(modal.getByRole('button', { name: 'npub kopieren' })).toBeVisible()
    await expect(modal.getByRole('button', { name: 'JSON kopieren' })).toBeVisible()
    await expect(modal.getByRole('button', { name: 'Info' })).toBeVisible()
})

/**
 * C5 (Poll-Erstellen, NIP-88 kind 1068) — der Composer-Trigger öffnet das Formular;
 * Frage + zwei Optionen + Einfachwahl erzeugen eine kind-1068 am Relay (option/
 * polltype/relay/h/PROTECTED); die Poll erscheint sofort als Karte im Verlauf.
 */
test('C5: Poll erstellen erzeugt kind-1068 (option/polltype/h/PROTECTED) + Karte', async ({ page }) => {
    await openRoom(page, 'poll')
    await expect(page.getByPlaceholder('Nachricht schreiben…')).toBeVisible({ timeout: 15_000 })

    const q = `PQ-${Math.floor(Math.random() * 1e9)}`
    await page.getByRole('button', { name: 'Anhängen' }).click()
    await page.getByRole('menuitem', { name: 'Umfrage' }).click()
    const modal = page.locator('dialog[data-modal="create-poll"]')
    await expect(modal).toBeVisible()
    await modal.getByPlaceholder('Was möchtest du fragen?').fill(q)
    await modal.getByPlaceholder('Option 1').fill('Apfel')
    await modal.getByPlaceholder('Option 2').fill('Birne')
    await modal.getByRole('button', { name: 'Erstellen' }).click()

    // Poll-Karte im Verlauf (Frage als Titel + beide Optionen als Vote-Buttons).
    await expect(page.getByText(q, { exact: true })).toBeVisible({ timeout: 15_000 })
    const card = page.locator('div.group', { hasText: q })
    await expect(card.getByRole('radio', { name: /Apfel/ })).toBeVisible()
    await expect(card.getByRole('radio', { name: /Birne/ })).toBeVisible()

    // Am Relay: kind-1068 mit option (id+label)/polltype/relay/h/PROTECTED.
    let poll: RelayEvent | undefined
    await expect.poll(() => (poll = queryRelayEvent((e) => e.content === q, 'poll', 1068)) !== undefined, { timeout: 15_000 }).toBe(true)
    const p = poll as RelayEvent
    expect(p.tags.filter((t) => t[0] === 'option').map((t) => t[2])).toEqual(['Apfel', 'Birne'])
    expect(p.tags.find((t) => t[0] === 'polltype')?.[1]).toBe('singlechoice')
    expect(p.tags.find((t) => t[0] === 'h')?.[1]).toBe('poll')
    expect(p.tags.find((t) => t[0] === '-')).toBeTruthy() // PROTECTED (zooid meldet NIP-70)
})

/**
 * C5 (Poll-Vote, kind 1018) — auf die geseedete Poll „Lieblingsfarbe?" abstimmen:
 * Klick erzeugt eine kind-1018 (e=pollId, response=optId, h, PROTECTED), der eigene
 * Vote wird markiert (●); eine zweite Wahl ersetzt die Stimme (Einfachwahl).
 */
test('C5: Abstimmen erzeugt kind-1018 (e/response/h/PROTECTED), Umwahl ersetzt', async ({ page }) => {
    await openRoom(page, 'poll')
    const card = page.locator('div.group', { hasText: 'Lieblingsfarbe?' })
    await expect(card).toBeVisible({ timeout: 15_000 })

    const pollId = queryRelayEvent((e) => e.content === 'Lieblingsfarbe?', 'poll', 1068)?.id as string
    expect(pollId).toBeTruthy()

    // „Rot" wählen → eigener Vote markiert (aria-checked + ● statt ○).
    const rot = card.getByRole('radio', { name: /Rot/ })
    await rot.click()
    await expect(rot).toHaveAttribute('aria-checked', 'true', { timeout: 15_000 })

    // Am Relay: kind-1018 mit e=pollId, response=Rot, h=poll, PROTECTED.
    let vote: RelayEvent | undefined
    await expect
        .poll(
            () =>
                (vote = queryRelayEvent(
                    (e) => e.tags.some((t) => t[0] === 'e' && t[1] === pollId) && e.tags.some((t) => t[0] === 'response' && t[1] === 'Rot'),
                    'poll',
                    1018,
                )) !== undefined,
            { timeout: 15_000 },
        )
        .toBe(true)
    const v = vote as RelayEvent
    expect(v.tags.find((t) => t[0] === 'e')?.[1]).toBe(pollId)
    expect(v.tags.find((t) => t[0] === 'response')?.[1]).toBe('Rot')
    expect(v.tags.find((t) => t[0] === 'h')?.[1]).toBe('poll')
    expect(v.tags.find((t) => t[0] === '-')).toBeTruthy()

    // Umwahl (Einfachwahl): „Blau" → neue kind-1018, Blau markiert, Rot nicht mehr.
    const blau = card.getByRole('radio', { name: /Blau/ })
    await blau.click()
    await expect(blau).toHaveAttribute('aria-checked', 'true', { timeout: 15_000 })
    await expect(rot).toHaveAttribute('aria-checked', 'false')
    await expect
        .poll(
            () =>
                queryRelayEvent(
                    (e) => e.tags.some((t) => t[0] === 'e' && t[1] === pollId) && e.tags.some((t) => t[0] === 'response' && t[1] === 'Blau'),
                    'poll',
                    1018,
                ) !== undefined,
            { timeout: 15_000 },
        )
        .toBe(true)
})

/**
 * C5 (Mehrfachwahl, kind 1018) — Toggle ist zustandsabhängig, darum eine EIGENE frische
 * multiplechoice-Poll erstellen (deterministischer Nullzustand, kein Seed-Reuse-Bloat).
 * Zwei Optionen an-: beide `response`-Tags; eine ab-: Auswahl schrumpft; komplett ab-:
 * KEINE leere Response (Empty-Guard).
 */
test('C5: Mehrfachwahl toggelt Optionen (Add/Remove) + kein Empty-Vote', async ({ page }) => {
    await openRoom(page, 'poll')
    await expect(page.getByPlaceholder('Nachricht schreiben…')).toBeVisible({ timeout: 15_000 })

    // Eigene Mehrfachwahl-Poll mit zwei Optionen anlegen (frisch → nichts vorgewählt).
    const q = `PM-${Math.floor(Math.random() * 1e9)}`
    await page.getByRole('button', { name: 'Anhängen' }).click()
    await page.getByRole('menuitem', { name: 'Umfrage' }).click()
    const modal = page.locator('dialog[data-modal="create-poll"]')
    await expect(modal).toBeVisible()
    await modal.getByPlaceholder('Was möchtest du fragen?').fill(q)
    await modal.getByPlaceholder('Option 1').fill('Apfel')
    await modal.getByPlaceholder('Option 2').fill('Birne')
    await modal.getByLabel('Auswahl').selectOption('multiplechoice')
    await modal.getByRole('button', { name: 'Erstellen' }).click()

    const card = page.locator('div.group', { hasText: q })
    await expect(card).toBeVisible({ timeout: 15_000 })
    let pollId = ''
    await expect.poll(() => (pollId = queryRelayEvent((e) => e.content === q, 'poll', 1068)?.id ?? ''), { timeout: 15_000 }).not.toBe('')

    // Jüngste eigene kind-1018 auf diese Poll (die Umwahl produziert mehrere).
    const latestResponse = (): RelayEvent | undefined =>
        execFileSync(NAK, ['req', '-k', '1018', '-t', 'h=poll', '--auth', '--sec', NSEC, ZOOID_WS])
            .toString()
            .trim()
            .split('\n')
            .filter(Boolean)
            .map((l) => JSON.parse(l) as RelayEvent)
            .filter((e) => e.pubkey === VIEWER && e.tags.some((t) => t[0] === 'e' && t[1] === pollId))
            .sort((a, b) => b.created_at - a.created_at)[0]

    // Zwei Optionen anwählen → beide markiert (Checkbox-Rolle).
    const apfel = card.getByRole('checkbox', { name: /Apfel/ })
    const birne = card.getByRole('checkbox', { name: /Birne/ })
    await apfel.click()
    await expect(apfel).toHaveAttribute('aria-checked', 'true', { timeout: 15_000 })
    await birne.click()
    await expect(birne).toHaveAttribute('aria-checked', 'true', { timeout: 15_000 })

    // UI-erstellte Polls haben UUID-Options-IDs (nicht Label==ID) → am Relay die ANZAHL
    // der response-Tags prüfen; die label-basierten aria-checked-Checks oben belegen, DASS
    // die richtigen Optionen gewählt sind. Jüngste kind-1018 trägt beide (Toggle-Add summiert).
    const respCount = (): number => latestResponse()?.tags.filter((t) => t[0] === 'response').length ?? 0
    await expect.poll(respCount, { timeout: 15_000 }).toBe(2)

    // „Apfel" wieder abwählen → nur noch „Birne" markiert + eine response.
    await apfel.click()
    await expect(apfel).toHaveAttribute('aria-checked', 'false', { timeout: 15_000 })
    await expect(birne).toHaveAttribute('aria-checked', 'true')
    await expect.poll(respCount, { timeout: 15_000 }).toBe(1)

    // Letzte Option abwählen → Guard: keine leere Response, „Birne" bleibt markiert.
    const before = latestResponse()?.id
    await birne.click()
    await page.waitForTimeout(1500)
    await expect(birne).toHaveAttribute('aria-checked', 'true')
    expect(latestResponse()?.id).toBe(before) // keine neue kind-1018 gesendet
})

/**
 * C5 (Poll-Erstellen, Optionen umsortieren) — der Drag-Griff sortiert die Optionen im
 * Formular per HTML5-DnD um; die erstellte kind-1068 trägt die `option`-Tags in der
 * neuen Reihenfolge. DnD wird über dispatchEvent gefeuert (verlässlich, keine Physik).
 */
test('C5: Optionen im Formular per Drag umsortieren, Reihenfolge landet in kind-1068', async ({ page }) => {
    await openRoom(page, 'poll')
    await expect(page.getByPlaceholder('Nachricht schreiben…')).toBeVisible({ timeout: 15_000 })

    const q = `PO-${Math.floor(Math.random() * 1e9)}`
    await page.getByRole('button', { name: 'Anhängen' }).click()
    await page.getByRole('menuitem', { name: 'Umfrage' }).click()
    const modal = page.locator('dialog[data-modal="create-poll"]')
    await expect(modal).toBeVisible()
    await modal.getByPlaceholder('Was möchtest du fragen?').fill(q)
    await modal.getByPlaceholder('Option 1').fill('Eins')
    await modal.getByPlaceholder('Option 2').fill('Zwei')
    await modal.getByRole('button', { name: 'Option hinzufügen' }).click()
    await modal.getByPlaceholder('Option 3').fill('Drei')

    // „Eins" (Griff 1) auf Position 3 („Drei") ziehen → Reihenfolge: Zwei, Drei, Eins.
    await modal.getByLabel('Option 1 verschieben').dispatchEvent('dragstart')
    await modal.getByLabel('Option 3 verschieben').dispatchEvent('dragover', { bubbles: true })
    await modal.getByLabel('Option 3 verschieben').dispatchEvent('drop', { bubbles: true })
    await expect(modal.getByPlaceholder('Option 1')).toHaveValue('Zwei')
    await expect(modal.getByPlaceholder('Option 2')).toHaveValue('Drei')
    await expect(modal.getByPlaceholder('Option 3')).toHaveValue('Eins')

    await modal.getByRole('button', { name: 'Erstellen' }).click()
    await expect(page.getByText(q, { exact: true })).toBeVisible({ timeout: 15_000 })

    // Am Relay: option-Tags in der umsortierten Reihenfolge.
    let poll: RelayEvent | undefined
    await expect.poll(() => (poll = queryRelayEvent((e) => e.content === q, 'poll', 1068)) !== undefined, { timeout: 15_000 }).toBe(true)
    expect((poll as RelayEvent).tags.filter((t) => t[0] === 'option').map((t) => t[2])).toEqual(['Zwei', 'Drei', 'Eins'])
})

/**
 * C6b (Threading, NIP-22 kind 1111, Slack-Modell) — JEDE Nachricht ist thread-fähig
 * (kein Quote-Only nötig): der Hover-Button „Im Thread antworten" öffnet das Overlay,
 * eine Antwort landet als kind-1111 mit `E`(Root=Nachricht selbst)/`e`(Parent)/`k`/`h`/
 * PROTECTED und hebt den Zähler. Eine verschachtelte Antwort trägt `e`=Antwort-id, `E`=Root.
 * Zurück im Feed erscheint der Antworten-Indikator an der Nachricht.
 */
test('C6b: Thread an jeder Nachricht — kind-1111 (E/e/k/h/PROTECTED) + Indikator + verschachtelt', async ({ page }) => {
    // Dedizierter „thread"-Raum (bläht „welcome" nicht auf). Self-contained.
    await openRoom(page, 'thread')
    const composer = page.getByPlaceholder('Nachricht schreiben…')
    await expect(composer).toBeVisible({ timeout: 15_000 })

    // 1) Nachricht senden — sie selbst ist die Thread-Wurzel (jede Nachricht ist thread-fähig).
    const marker = `THREAD-${Math.floor(Math.random() * 1e9)}`
    await composer.fill(marker)
    await page.getByRole('button', { name: 'Senden' }).click()
    await expect(page.getByText(marker, { exact: true })).toBeVisible({ timeout: 15_000 })
    let root: RelayEvent | undefined
    await expect.poll(() => (root = queryRelayEvent((e) => e.content === marker, 'thread')) !== undefined, { timeout: 15_000 }).toBe(true)
    const rootId = (root as RelayEvent).id

    // 2) Thread direkt öffnen: Hover-Toolbar → „Im Thread antworten" (kein Quote-Only mehr).
    const row = page.locator('div.group', { hasText: marker })
    await row.hover()
    await row.getByRole('button', { name: 'Im Thread antworten' }).click()
    const dialog = page.getByRole('dialog', { name: 'Thread' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText(marker).first()).toBeVisible() // Wurzel gerendert

    // 3) Antwort schreiben → kind-1111 am Relay.
    const sendReply = dialog.getByRole('button', { name: 'Antwort senden' })
    const c1 = `REPLY-${Math.floor(Math.random() * 1e9)}`
    await dialog.getByPlaceholder('Im Thread antworten…').fill(c1)
    await expect(sendReply).toBeEnabled({ timeout: 15_000 })
    await sendReply.click()
    await expect(dialog.getByText(c1, { exact: true })).toBeVisible({ timeout: 15_000 })
    await expect(dialog.getByText('1 Antwort', { exact: true })).toBeVisible({ timeout: 15_000 })

    let comment: RelayEvent | undefined
    await expect.poll(() => (comment = queryRelayEvent((e) => e.content === c1, null, 1111)) !== undefined, { timeout: 15_000 }).toBe(true)
    const cm = comment as RelayEvent
    const tag = (name: string) => cm.tags.find((t) => t[0] === name)
    expect(tag('E')?.[1]).toBe(rootId) // Thread-Root = die Nachricht selbst
    expect(tag('e')?.[1]).toBe(rootId) // direktes Parent = Root (Top-Level-Antwort)
    expect(tag('k')?.[1]).toBe('9') // Parent-Kind der Wurzel
    expect(tag('h')?.[1]).toBe('thread') // `h` des Thread-ROOTS (kind 9) — additiv für NIP-29/Lotus-Interop (P1)
    expect(tag('-')).toBeTruthy() // PROTECTED (zooid meldet NIP-70)

    // 4) Auf die Antwort antworten (verschachtelt): e = Antwort-id, E = Root. Der Reply-Button
    // liegt jetzt (P3 4.2) in der Hover-Toolbar der geteilten Row → Kommentar hovern, dann klicken.
    const c1Row = dialog.locator('div.group', { hasText: c1 })
    await c1Row.hover()
    await c1Row.getByRole('button', { name: 'Antworten', exact: true }).click()
    const c2 = `NESTED-${Math.floor(Math.random() * 1e9)}`
    await dialog.getByPlaceholder('Im Thread antworten…').fill(c2)
    await expect(sendReply).toBeEnabled({ timeout: 15_000 })
    await sendReply.click()
    await expect(dialog.getByText(c2, { exact: true })).toBeVisible({ timeout: 15_000 })
    await expect(dialog.getByText('2 Antworten', { exact: true })).toBeVisible({ timeout: 15_000 })
    // Flach/chronologisch (P3 4.2): die verschachtelte Antwort trägt KEINE depth-Einrückung,
    // der Eltern-Bezug erscheint als „Antwort auf <Autor>"-Zeile (replyToName). Genau eine,
    // da c1 top-level (leer) und nur c2 ein Parent im Thread hat.
    await expect(dialog.getByText(/Antwort auf/).first()).toBeVisible({ timeout: 15_000 })

    let nested: RelayEvent | undefined
    await expect.poll(() => (nested = queryRelayEvent((e) => e.content === c2, null, 1111)) !== undefined, { timeout: 15_000 }).toBe(true)
    const nt = nested as RelayEvent
    expect(nt.tags.find((t) => t[0] === 'e')?.[1]).toBe(cm.id) // Parent = die erste Antwort
    expect(nt.tags.find((t) => t[0] === 'E')?.[1]).toBe(rootId) // Root bleibt die Wurzel
    expect(nt.tags.find((t) => t[0] === 'h')?.[1]).toBe('thread') // auch nested trägt das Root-`h` (P1, aus dem Root, nicht dem Parent)

    // 5) Zurück im Feed: der Antworten-Indikator erscheint an der Nachricht.
    await dialog.getByRole('button', { name: 'Zurück' }).click()
    await expect(row.getByText('2 Antworten')).toBeVisible({ timeout: 15_000 })
})

/**
 * P3 (4.2 Schritt 5) — Thread-Kommentare rendern durch die GETEILTE Raum-Row und erben deren
 * Reaktions-Lane. Eine kind-7-Reaktion auf einen Kommentar (trägt `#h` = Root-`h`, via makeReaction)
 * wird über `roomReactionFilter(h)` mitgeladen und je Kommentar (`#e`) aggregiert → Chip erscheint.
 */
test('P3(4.2): Reaktion auf einen Thread-Kommentar erscheint als Chip (geerbte Row)', async ({ page }) => {
    await openRoom(page, 'thread')
    const composer = page.getByPlaceholder('Nachricht schreiben…')
    await expect(composer).toBeVisible({ timeout: 15_000 })

    const marker = `REACTTHREAD-${Math.floor(Math.random() * 1e9)}`
    await composer.fill(marker)
    await page.getByRole('button', { name: 'Senden' }).click()
    await expect(page.getByText(marker, { exact: true })).toBeVisible({ timeout: 15_000 })
    const row = page.locator('div.group', { hasText: marker })
    await row.hover()
    await row.getByRole('button', { name: 'Im Thread antworten' }).click()
    const dialog = page.getByRole('dialog', { name: 'Thread' })
    const c1 = `TC-${Math.floor(Math.random() * 1e9)}`
    await dialog.getByPlaceholder('Im Thread antworten…').fill(c1)
    const send = dialog.getByRole('button', { name: 'Antwort senden' })
    await expect(send).toBeEnabled({ timeout: 15_000 })
    await send.click()
    await expect(dialog.getByText(c1, { exact: true })).toBeVisible({ timeout: 15_000 })

    // Kommentar-Event (kind 1111) am Relay holen, dann eine kind-7-Reaktion darauf publizieren
    // (h=thread = Root-h, e=commentId, k=1111) — genau wie makeReaction sie baut.
    let comment: RelayEvent | undefined
    await expect.poll(() => (comment = queryRelayEvent((e) => e.content === c1, null, 1111)) !== undefined, { timeout: 15_000 }).toBe(true)
    execFileSync(NAK, [
        'event', '--auth', '--sec', ADMIN, '-k', '7', '-t', 'h=thread',
        '-t', `e=${(comment as RelayEvent).id}`, '-t', 'k=1111', '-c', '🔥', ZOOID_WS,
    ])

    // Der Chip erscheint an der Kommentar-Row im Thread (geerbte Reaktions-Lane, Schritt 5).
    await expect(dialog.getByText('🔥')).toBeVisible({ timeout: 15_000 })
})

/**
 * P4 (Interop, bidirektional lesen) — Lotus' In-Chat-Thread ist ein `kind 10` (NIP-29 Group
 * Chat Threading): Root via `["e", rootId, relay, "root"]`, Parent via `["e", parentId, …, "reply"]`,
 * plus `["h", groupId, …]`. Unser Read war doppelt auf NIP-22 (`kind 1111` + `#E`) verriegelt.
 * Test: wir posten eine kind-9-Wurzel, ein FREMDER Client (ADMIN) seedet eine kind-10-Antwort
 * exakt nach Lotus-Spec → sie erscheint als Antworten-Indikator UND als Kommentar-Row im Thread
 * (geteilte Row), eine verschachtelte kind-10 (`reply`-Marker) zeigt den Eltern-Bezug. Kein
 * Geister-Thread (Zähler = genau die kind-10-Events).
 */
test('P4: Lotus kind-10 In-Chat-Thread wird gelesen (Root/Reply-Marker, Indikator, geteilte Row)', async ({ page }) => {
    await openRoom(page, 'thread')
    const composer = page.getByPlaceholder('Nachricht schreiben…')
    await expect(composer).toBeVisible({ timeout: 15_000 })

    // 1) Eigene kind-9-Wurzel senden (Autor = VIEWER), Root-ID am Relay holen.
    const marker = `LOTUSROOT-${Math.floor(Math.random() * 1e9)}`
    await composer.fill(marker)
    await page.getByRole('button', { name: 'Senden' }).click()
    await expect(page.getByText(marker, { exact: true })).toBeVisible({ timeout: 15_000 })
    let root: RelayEvent | undefined
    await expect.poll(() => (root = queryRelayEvent((e) => e.content === marker, 'thread')) !== undefined, { timeout: 15_000 }).toBe(true)
    const rootId = (root as RelayEvent).id

    // 2) Lotus-kind-10-Antwort als FREMDER Client seeden — exakt nach Spec: e=root(marker "root"),
    //    p=Root-Autor, h=Group. (nak: `key=v1;v2;v3` → mehrwertiges Tag mit Marker in Position 3.)
    const l1 = `LOTUSREPLY-${Math.floor(Math.random() * 1e9)}`
    execFileSync(NAK, [
        'event', '--auth', '--sec', ADMIN, '-k', '10',
        '-t', `h=thread;${ZOOID_WS}`,
        '-t', `e=${rootId};${ZOOID_WS};root`,
        '-t', `p=${VIEWER}`,
        '-c', l1, ZOOID_WS,
    ])

    // 3) Der Antworten-Indikator erscheint an der Nachricht (kind-10 in commentsByRoot gebündelt).
    const row = page.locator('div.group', { hasText: marker })
    await expect(row.getByText('1 Antwort', { exact: true })).toBeVisible({ timeout: 15_000 })

    // 4) Thread öffnen → das kind-10 rendert als vollwertige Kommentar-Row (geteilte Raum-Row).
    await row.hover()
    await row.getByRole('button', { name: 'Im Thread antworten' }).click()
    const dialog = page.getByRole('dialog', { name: 'Thread' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText(l1, { exact: true })).toBeVisible({ timeout: 15_000 })

    // 5) Verschachtelte kind-10 (reply-Marker auf die erste Antwort) → Eltern-Bezug als
    //    „Antwort auf <Autor>"-Zeile (commentParentId liest den `reply`-Marker, nicht den ersten `e`).
    let l1Event: RelayEvent | undefined
    await expect.poll(() => (l1Event = queryRelayEvent((e) => e.content === l1, 'thread', 10)) !== undefined, { timeout: 15_000 }).toBe(true)
    const l2 = `LOTUSNESTED-${Math.floor(Math.random() * 1e9)}`
    execFileSync(NAK, [
        'event', '--auth', '--sec', ADMIN, '-k', '10',
        '-t', `h=thread;${ZOOID_WS}`,
        '-t', `e=${rootId};${ZOOID_WS};root`,
        '-t', `p=${VIEWER}`,
        '-t', `e=${(l1Event as RelayEvent).id};${ZOOID_WS};reply`,
        '-c', l2, ZOOID_WS,
    ])
    await expect(dialog.getByText(l2, { exact: true })).toBeVisible({ timeout: 15_000 })
    await expect(dialog.getByText(/Antwort auf/).first()).toBeVisible({ timeout: 15_000 })

    // 6) Kein Geister-Thread: der Zähler ist GENAU die zwei kind-10 (keine Fremd-Buckets).
    await expect(dialog.getByText('2 Antworten', { exact: true })).toBeVisible({ timeout: 15_000 })

    // 7) Regression-Guard: Wir antworten auf das FREMDE kind-10. Unser Write bleibt kind-1111,
    //    MUSS aber an der echten kind-9-Wurzel rooten (E=rootId) — sonst re-rootet welshman den
    //    Reply aufs kind-10 (E=kind10, nur lowercase-Marker) und er verschwände aus dem Thread.
    const l1Row = dialog.locator('div.group', { hasText: l1 })
    await l1Row.hover()
    await l1Row.getByRole('button', { name: 'Antworten', exact: true }).click()
    const r1 = `OURREPLY-${Math.floor(Math.random() * 1e9)}`
    const sendReply = dialog.getByRole('button', { name: 'Antwort senden' })
    await dialog.getByPlaceholder('Im Thread antworten…').fill(r1)
    await expect(sendReply).toBeEnabled({ timeout: 15_000 })
    await sendReply.click()
    // Unsere Antwort bleibt im Thread sichtbar (nicht spurlos verschwunden).
    await expect(dialog.getByText(r1, { exact: true })).toBeVisible({ timeout: 15_000 })
    let ourReply: RelayEvent | undefined
    await expect.poll(() => (ourReply = queryRelayEvent((e) => e.content === r1, null, 1111)) !== undefined, { timeout: 15_000 }).toBe(true)
    const or = ourReply as RelayEvent
    expect(or.tags.find((t) => t[0] === 'E')?.[1]).toBe(rootId) // an der kind-9-Wurzel gerootet, NICHT am kind-10
    expect(or.tags.find((t) => t[0] === 'K')?.[1]).toBe('9') // Root-Kind = 9 (nicht 10)
    await expect(dialog.getByText('3 Antworten', { exact: true })).toBeVisible({ timeout: 15_000 })
})

/**
 * P3 (4.2, Review-Fix) — der Reaktions-Picker der geteilten Row wird nach <body> teleportiert.
 * Ohne `x-on:click.stop` am Panel bubbelt ein Klick darin zum document und triggert den
 * click.outside-Guard des Thread-Overlays (closeThread) → der Thread verschwände beim Emoji-Wählen.
 * Test: Picker im Thread öffnen, Emoji wählen → Reaktion landet UND der Thread bleibt offen.
 */
test('P3(4.2): Reaction-Picker im Thread schließt den Thread nicht (teleportiertes Panel, .stop)', async ({ page }) => {
    await openRoom(page, 'thread')
    const composer = page.getByPlaceholder('Nachricht schreiben…')
    await expect(composer).toBeVisible({ timeout: 15_000 })

    const marker = `PICKTHREAD-${Math.floor(Math.random() * 1e9)}`
    await composer.fill(marker)
    await page.getByRole('button', { name: 'Senden' }).click()
    await expect(page.getByText(marker, { exact: true })).toBeVisible({ timeout: 15_000 })
    const row = page.locator('div.group', { hasText: marker })
    await row.hover()
    await row.getByRole('button', { name: 'Im Thread antworten' }).click()
    const dialog = page.getByRole('dialog', { name: 'Thread' })
    const c1 = `PC-${Math.floor(Math.random() * 1e9)}`
    await dialog.getByPlaceholder('Im Thread antworten…').fill(c1)
    const send = dialog.getByRole('button', { name: 'Antwort senden' })
    await expect(send).toBeEnabled({ timeout: 15_000 })
    await send.click()
    await expect(dialog.getByText(c1, { exact: true })).toBeVisible({ timeout: 15_000 })

    // Reaktions-Picker an der Kommentar-Row öffnen und ein Emoji wählen.
    const c1Row = dialog.locator('div.group', { hasText: c1 })
    await c1Row.hover()
    await c1Row.getByRole('button', { name: 'Reagieren', exact: true }).click()
    // Tippen im teleportierten Suchfeld ist selbst schon ein Klick/Fokus IM Panel → ohne .stop
    // würde er zum document bubbeln und den Thread schließen.
    await page.getByRole('searchbox', { name: 'Emoji suchen' }).fill('daumen')
    await page.getByRole('button', { name: 'Reagieren mit Daumen hoch' }).click({ timeout: 15_000 })

    // KERN: der Thread bleibt offen (vor dem Fix hätte der Klick closeThread ausgelöst) …
    await expect(dialog).toBeVisible()
    // … und die Reaktion erscheint als Chip an der Kommentar-Row.
    await expect(c1Row.getByText('👍')).toBeVisible({ timeout: 15_000 })
})

/**
 * C6b (Startseite) — die raumübergreifende Threads-Übersicht auf `/spaces` listet einen
 * Thread (Root-Snippet + „N Antworten"); Klick öffnet ihn per Deep-Link (`?thread=`)
 * direkt im Raum-Overlay.
 */
test('C6b: Threads-Übersicht auf der Startseite + Deep-Link in den Raum', async ({ page }) => {
    await openRoom(page, 'thread')
    const composer = page.getByPlaceholder('Nachricht schreiben…')
    await expect(composer).toBeVisible({ timeout: 15_000 })

    // Nachricht + eine Antwort erzeugen (Thread entsteht).
    const marker = `SPACETHREAD-${Math.floor(Math.random() * 1e9)}`
    await composer.fill(marker)
    await page.getByRole('button', { name: 'Senden' }).click()
    await expect(page.getByText(marker, { exact: true })).toBeVisible({ timeout: 15_000 })
    const row = page.locator('div.group', { hasText: marker })
    await row.hover()
    await row.getByRole('button', { name: 'Im Thread antworten' }).click()
    const dialog = page.getByRole('dialog', { name: 'Thread' })
    const reply = `SR-${Math.floor(Math.random() * 1e9)}`
    await dialog.getByPlaceholder('Im Thread antworten…').fill(reply)
    const send = dialog.getByRole('button', { name: 'Antwort senden' })
    await expect(send).toBeEnabled({ timeout: 15_000 })
    await send.click()
    await expect(dialog.getByText(reply, { exact: true })).toBeVisible({ timeout: 15_000 })
    // Vor dem HARTEN Reload (page.goto) sicherstellen, dass der Kommentar wirklich am Relay
    // liegt — sonst bricht die Navigation den optimistischen In-Flight-Publish ab (bei echten
    // Nutzern via wire:navigate bleibt der Socket erhalten; hier ist es ein voller Reload).
    await expect.poll(() => queryRelayEvent((e) => e.content === reply, null, 1111) !== undefined, { timeout: 15_000 }).toBe(true)
    await dialog.getByRole('button', { name: 'Zurück' }).click()

    // Startseite → „Threads"-Tab öffnen → Karte zeigt den Thread (Root-Snippet).
    await page.goto('/spaces')
    await page.getByRole('tab', { name: /Threads/ }).click()
    // Tab-Auswahl wird in ?tab= gespiegelt (verlinkbar).
    await expect(page).toHaveURL(/[?&]tab=threads/, { timeout: 10_000 })
    const tile = page.getByRole('button', { name: new RegExp(marker) })
    await expect(tile).toBeVisible({ timeout: 20_000 })

    // Klick → verlinkbarer Deep-Link-PFAD (/rooms/{h}/thread/{nevent}), Thread-Vollansicht offen.
    await tile.click()
    await expect(page).toHaveURL(/\/rooms\/[^/]+\/thread\/nevent1[0-9a-z]+/, { timeout: 15_000 })
    await expect(page.getByRole('dialog', { name: 'Thread' })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('dialog', { name: 'Thread' }).getByText(reply, { exact: true })).toBeVisible({ timeout: 15_000 })
})

/**
 * P2 (Route statt Modal) — die Antworten-Pille an einer Nachricht ist ein echter
 * `<a wire:navigate>` auf die teilbare Thread-Route (/rooms/{h}/thread/{nevent}),
 * NICHT mehr das In-Place-Modal. Klick navigiert die URL + öffnet die Vollansicht.
 */
test('P2: Antworten-Pille navigiert auf die teilbare Thread-Route (kein Modal)', async ({ page }) => {
    await openRoom(page, 'thread')
    const composer = page.getByPlaceholder('Nachricht schreiben…')
    await expect(composer).toBeVisible({ timeout: 15_000 })

    // Nachricht + eine Antwort (via Modal-Button) → an der Nachricht erscheint die Pille.
    const marker = `PILL-${Math.floor(Math.random() * 1e9)}`
    await composer.fill(marker)
    await page.getByRole('button', { name: 'Senden' }).click()
    await expect(page.getByText(marker, { exact: true })).toBeVisible({ timeout: 15_000 })
    const row = page.locator('div.group', { hasText: marker })
    await row.hover()
    await row.getByRole('button', { name: 'Im Thread antworten' }).click()
    const dialog = page.getByRole('dialog', { name: 'Thread' })
    const reply = `PR-${Math.floor(Math.random() * 1e9)}`
    await dialog.getByPlaceholder('Im Thread antworten…').fill(reply)
    const send = dialog.getByRole('button', { name: 'Antwort senden' })
    await expect(send).toBeEnabled({ timeout: 15_000 })
    await send.click()
    await expect(dialog.getByText(reply, { exact: true })).toBeVisible({ timeout: 15_000 })
    await expect.poll(() => queryRelayEvent((e) => e.content === reply, null, 1111) !== undefined, { timeout: 15_000 }).toBe(true)
    await dialog.getByRole('button', { name: 'Zurück' }).click()
    await expect(dialog).toBeHidden()

    // Die Pille ist ein echter Link (teilbar/mittelklick) auf die Thread-Route.
    const pill = row.getByRole('link', { name: /Thread öffnen/ })
    await expect(pill).toBeVisible({ timeout: 15_000 })
    expect(await pill.getAttribute('href')).toMatch(/^\/rooms\/[^/]+\/thread\/nevent1[0-9a-z]+$/)

    // Klick → URL wechselt auf die Route (kein Modal am Pillen-Pfad), Vollansicht offen.
    await pill.click()
    await expect(page).toHaveURL(/\/rooms\/[^/]+\/thread\/nevent1[0-9a-z]+/, { timeout: 15_000 })
    await expect(page.getByRole('dialog', { name: 'Thread' })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('dialog', { name: 'Thread' }).getByText(reply, { exact: true })).toBeVisible({ timeout: 15_000 })
})

/**
 * Feedback-Fix #4 (Composer-Enter, Web) — auf dem Desktop bleibt die Gewohnheit:
 * Enter sendet, Shift+Enter erzeugt einen Zeilenumbruch OHNE zu senden. Der
 * `!isMobile`-Guard darf das Web-Verhalten NICHT verändern (Regression-Schutz).
 */
test('Composer: Enter sendet (Web), Shift+Enter macht Umbruch', async ({ page }) => {
    await openRoom(page, 'thread')
    const composer = page.getByPlaceholder('Nachricht schreiben…')
    await expect(composer).toBeVisible({ timeout: 15_000 })

    const marker = `WEBENTER-${Math.floor(Math.random() * 1e9)}`
    // Shift+Enter → Umbruch mitten im Draft, KEIN Senden.
    await composer.fill('Zeile1')
    await composer.press('Shift+Enter')
    await composer.pressSequentially(marker)
    await expect(composer).toHaveValue(`Zeile1\n${marker}`)

    // Enter → sendet den mehrzeiligen Draft; der Composer leert optimistisch.
    await composer.press('Enter')
    await expect(composer).toHaveValue('')
    await expect(page.getByText(marker).first()).toBeVisible({ timeout: 15_000 })
})

/**
 * Feedback-Fix #4 (Composer-Enter, native App) — auf dem Gerät gibt es keine
 * Shift-Taste. Enter darf daher NICHT senden, sondern erzeugt einen Umbruch;
 * gesendet wird nur über den Button. Seam über `__nostrMobile` (wie C0-Modal).
 */
test('Composer: Enter macht Umbruch statt zu senden (native App)', async ({ page }) => {
    await openRoom(page, 'thread')
    await expect(page.getByPlaceholder('Nachricht schreiben…')).toBeVisible({ timeout: 15_000 })
    // Auf „native App" umschalten und den Raum neu laden (Session überlebt, gleiche Origin).
    await page.addInitScript(() => {
        ;(window as unknown as { __nostrMobile: boolean }).__nostrMobile = true
    })
    await page.goto('/rooms/thread')

    const composer = page.getByPlaceholder('Nachricht schreiben…')
    await expect(composer).toBeVisible({ timeout: 15_000 })
    await composer.fill('Zeile1')
    await composer.press('Enter') // native: Umbruch, KEIN Senden
    await composer.pressSequentially('Zeile2')
    // Draft bleibt (inkl. Umbruch) → Enter hat NICHT gesendet.
    await expect(composer).toHaveValue('Zeile1\nZeile2')

    // Senden nur über den Button → Composer leert.
    await page.getByRole('button', { name: 'Senden' }).click()
    await expect(composer).toHaveValue('', { timeout: 15_000 })
})

/**
 * Feedback-Fix #5 (Thread-Auto-Scroll) — beim Öffnen landet die Thread-Ansicht
 * ganz unten bei der letzten Antwort (Nutzer muss nicht selbst runterscrollen).
 * Kleiner Viewport + mehrere lange Antworten erzwingen Überlauf; nach Schließen +
 * erneutem Öffnen (frischer openThread-Load) muss der Container am Boden stehen.
 */
test('Thread: Ansicht startet beim Laden ganz unten (letzte Antwort)', async ({ page }) => {
    await page.setViewportSize({ width: 500, height: 420 })
    await openRoom(page, 'thread')
    const composer = page.getByPlaceholder('Nachricht schreiben…')
    await expect(composer).toBeVisible({ timeout: 15_000 })

    // Wurzel-Nachricht.
    const marker = `TSCROLL-${Math.floor(Math.random() * 1e9)}`
    await composer.fill(marker)
    await page.getByRole('button', { name: 'Senden' }).click()
    await expect(page.getByText(marker, { exact: true })).toBeVisible({ timeout: 15_000 })

    // Thread öffnen und mehrere lange Antworten posten (überläuft den kleinen Viewport).
    const row = page.locator('div.group', { hasText: marker })
    await row.hover()
    await row.getByRole('button', { name: 'Im Thread antworten' }).click()
    const dialog = page.getByRole('dialog', { name: 'Thread' })
    await expect(dialog).toBeVisible()
    const sendReply = dialog.getByRole('button', { name: 'Antwort senden' })
    const input = dialog.getByPlaceholder('Im Thread antworten…')
    for (let i = 0; i < 6; i++) {
        const reply = `R${i}-${Math.floor(Math.random() * 1e9)} ${'wort '.repeat(14)}`
        await input.fill(reply)
        await expect(sendReply).toBeEnabled({ timeout: 15_000 })
        await sendReply.click()
        await expect(dialog.getByText(new RegExp(`^R${i}-`)).first()).toBeVisible({ timeout: 15_000 })
    }

    // Schließen + erneut öffnen → frischer Load-Pfad (openThread lädt warm aus dem Repo).
    await dialog.getByRole('button', { name: 'Zurück' }).click()
    await expect(dialog).toBeHidden()
    await row.hover()
    await row.getByRole('button', { name: 'Im Thread antworten' }).click()
    await expect(dialog).toBeVisible()

    // Der Kommentar-Container läuft über UND steht ganz unten.
    const scroller = dialog.locator('.overflow-y-auto').first()
    await expect
        .poll(
            () =>
                scroller.evaluate((el) => {
                    const overflow = el.scrollHeight - el.clientHeight
                    const fromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
                    return overflow > 40 && fromBottom < 80 ? 'ok' : `overflow=${overflow} fromBottom=${fromBottom}`
                }),
            { timeout: 15_000 },
        )
        .toBe('ok')
})
