import { test, expect, type Page } from './support/fixtures'
import { execFileSync } from 'node:child_process'
import { npubEncode } from 'nostr-tools/nip19'
import { useZooid, ZOOID_WS } from './support/zooid'
import { loginNsec } from './support/login'

const NSEC = process.env.NOSTR_TEST_NSEC as string
// Relay-Owner-Secret (Pubkey = relay.self) — der einzige NIP-86/Raum-Admin des zooid.
const ADMIN_HEX = 'b2ee09a54bedf17ee1db562bdddd75c48661d981eb52c49dc206c55ba8439414'
const NAK = '/home/user/go/bin/nak'
// Wegwerf-Pubkey zum Hinzufügen als Raum-Mitglied (foreign zu allen echten Membern).
const MEMBER_TARGET = '5555555555555555555555555555555555555555555555555555555555555555'

/** Pubkey (hex) eines Secrets via nak. */
function pubOf(sec: string): string {
    return execFileSync(NAK, ['key', 'public', sec]).toString().trim()
}

/** Legt einen Raum via nak an (kind 9007 + 9002), damit die Kachel in der Liste erscheint. */
function createRoomNak(h: string, name: string, extraTags: string[] = []): void {
    execFileSync(NAK, ['event', '--auth', '--sec', ADMIN_HEX, '-k', '9007', '-t', `h=${h}`, ZOOID_WS])
    execFileSync(NAK, ['event', '--auth', '--sec', ADMIN_HEX, '-k', '9002', '-t', `h=${h}`, '-t', `name=${name}`, ...extraTags, ZOOID_WS])
}

/** Loggt via nsec ein und landet im Gate (`/spaces`). */
async function login(page: Page): Promise<void> {
    await useZooid(page)
    await loginNsec(page, NSEC)
}

/** Loggt als Relay-Admin ein und landet auf der Räume-Seite (`/spaces`). */
async function loginAdmin(page: Page): Promise<void> {
    await useZooid(page)
    await loginNsec(page, ADMIN_HEX)
}

/**
 * Wartet, bis die Wanduhr eine ganze Sekunde weitergerückt ist.
 *
 * Das Lesestand-Wasserzeichen und `created_at` rechnen beide in Unix-SEKUNDEN,
 * die Ungelesen-Regel ist strikt `created_at > watermark`. Publiziert man in
 * derselben Sekunde, in der das Wasserzeichen gesetzt wurde, gilt die Nachricht
 * mal als gelesen, mal nicht — genau die Falle, die unread-dot.spec.ts bereits
 * unter Last gemessen hat. Siehe dort für die ausführliche Begründung.
 */
async function awaitNextSecond(page: Page): Promise<void> {
    const start = Math.floor(Date.now() / 1000)
    while (Math.floor(Date.now() / 1000) <= start) {
        await page.waitForTimeout(100)
    }
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

    // Über die Bottom-Nav in die Einstellungen — der Space-Wechsel liegt seit der
    // vereinheitlichten Settings-Seite als „Space & Räume"-Section unter /settings (§6.5).
    await page.getByRole('link', { name: 'Einstellungen' }).click()
    await page.waitForURL('**/settings')

    await expect(page.getByText('Space & Räume')).toBeVisible()
    // Space-Auswahl zeigt den NIP-11-Namen (B1), nicht die nackte URL.
    await expect(page.getByText('Zooid Test Space')).toBeVisible({ timeout: 15_000 })
})

/**
 * P4 (Raum-Verwaltung, NIP-29 9007/9002/9008) — voller Lebenszyklus als Admin:
 * anlegen (kind 9007+9002, Ersteller tritt bei), bearbeiten (9002) und löschen
 * (9008 → 39000-Tombstone). Self-contained (eigener Wegwerf-Raum) → bloat-frei.
 */
test('P4: Admin legt einen Raum an, bearbeitet und löscht ihn', async ({ page }) => {
    const name = `Neu-${Math.floor(Math.random() * 1e9)}`
    const renamed = `Edit-${Math.floor(Math.random() * 1e9)}`
    await loginAdmin(page)

    // „+ Raum" erscheint für den Admin (isAdmin via NIP-86 SupportedMethods).
    const addBtn = page.getByRole('button', { name: 'Raum', exact: true })
    await expect(addBtn).toBeVisible({ timeout: 15_000 })
    await addBtn.click()

    // Anlegen: Name → Speichern (9007 → 9002 → 9021). Raum erscheint via Live-Sub.
    const form = page.locator('dialog[data-modal="room-form"]')
    await form.getByPlaceholder('z.B. Allgemein').fill(name)
    await form.getByRole('button', { name: 'Speichern' }).click()
    await expect(page.getByText(name, { exact: true })).toBeVisible({ timeout: 15_000 })

    // Bearbeiten über das Kachel-„…"-Menü → Name ändern (9002).
    const tile = page.locator('div.group', { hasText: name })
    await tile.getByRole('button', { name: 'Raum verwalten' }).click()
    await page.getByRole('menuitem', { name: 'Bearbeiten' }).click()
    const editForm = page.locator('dialog[data-modal="room-form"]')
    await expect(editForm.getByPlaceholder('z.B. Allgemein')).toHaveValue(name)
    await editForm.getByPlaceholder('z.B. Allgemein').fill(renamed)
    await editForm.getByRole('button', { name: 'Speichern' }).click()
    await expect(page.getByText(renamed, { exact: true })).toBeVisible({ timeout: 15_000 })

    // Löschen über das Kachel-„…"-Menü → Bestätigung (9008).
    const tile2 = page.locator('div.group', { hasText: renamed })
    await tile2.getByRole('button', { name: 'Raum verwalten' }).click()
    await page.getByRole('menuitem', { name: 'Löschen' }).click()
    await page.locator('dialog[data-modal="delete-room"]').getByRole('button', { name: 'Löschen', exact: true }).click()
    await expect(page.getByText(renamed, { exact: true })).toHaveCount(0, { timeout: 15_000 })
})

/** P4 — ein normaler User sieht KEINE Raum-Verwaltung (Gating). */
test('P4: normaler User sieht keine Raum-Verwaltung', async ({ page }) => {
    await login(page)
    // Räume geladen (ein bekannter Seed-Raum ist da).
    await expect(page.getByText('Willkommen')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('button', { name: 'Raum', exact: true })).toBeHidden()
    await expect(page.getByRole('button', { name: 'Raum verwalten' })).toHaveCount(0)
})

/**
 * P4b (Raum-Mitglieder, NIP-29 9000/9001) — der Admin öffnet die Mitgliederliste
 * eines Raums, fügt einen Pubkey per npub hinzu (allowpubkey + kind 9000 → 39002)
 * und entfernt ihn wieder (kind 9001). Self-contained (Wegwerf-Raum + -Pubkey).
 */
test('P4b: Admin verwaltet Raum-Mitglieder (hinzufügen/entfernen)', async ({ page }) => {
    const h = `mem${Math.floor(Math.random() * 1e9)}`
    const name = `MemRoom-${Math.floor(Math.random() * 1e9)}`
    createRoomNak(h, name)
    const targetPub = pubOf(MEMBER_TARGET)
    const targetNpub = npubEncode(targetPub)
    // Ist der Pubkey in der relay-signierten 39002 des Raums? (Round-Trip-Wahrheit)
    const inRoom = (): boolean =>
        execFileSync(NAK, ['req', '-k', '39002', '-d', h, '--auth', '--sec', ADMIN_HEX, ZOOID_WS]).toString().includes(targetPub)

    await loginAdmin(page)
    const tile = page.locator('div.group', { hasText: name })
    await expect(tile).toBeVisible({ timeout: 15_000 })
    await tile.getByRole('button', { name: 'Raum verwalten' }).click()
    await page.getByRole('menuitem', { name: 'Mitglieder' }).click()

    const modal = page.locator('dialog[data-modal="room-members"]')
    await expect(modal.getByText('Noch keine Mitglieder')).toBeVisible({ timeout: 15_000 })

    // Hinzufügen per npub → allowpubkey + kind 9000 → in der 39002-Liste (UI + Relay).
    await modal.getByPlaceholder('npub1…').fill(targetNpub)
    await modal.getByRole('button', { name: 'Hinzufügen' }).click()
    await expect(modal.getByRole('button', { name: 'Entfernen' })).toBeVisible({ timeout: 15_000 })
    await expect.poll(inRoom, { timeout: 15_000 }).toBe(true)

    // Entfernen (kind 9001) → relay-seitig aus der 39002 raus.
    await modal.getByRole('button', { name: 'Entfernen' }).click()
    await expect.poll(inRoom, { timeout: 15_000 }).toBe(false)
})

/**
 * Raum-Kategorien end-to-end (39000-Marker → RoomView → Raumliste). Drei Räume
 * derselben Sichtbarkeit (alle vom Relay ausgeliefert, keiner `hidden`), sodass
 * die Unterschiede AUSSCHLIESSLICH aus dem Client-Filter stammen:
 *
 * - Standard-Raum   → unter „Andere Räume".
 * - `t=project-support` (Vereins-Antragsraum) → NICHT unter „Andere Räume",
 *   und (seit 2026-07-27) auch dann NICHT unter „Meine Räume", wenn man
 *   Mitglied wird — die ganze Kategorie liegt hinter der Entdecken-Zeile
 *   „Projektunterstützung entdecken", betretbar erst nach einem Klick darauf.
 * - `t=meetup`      → REGRESSION: unverändert raus aus „Andere Räume" und rein
 *   in den Meetup-Pool (die Entdecken-Karte zählt ihn).
 *
 * Kategorisieren heißt nicht verstecken — der zweite Teil des Tests ist der,
 * der zählt.
 */
test('P4c: Antragsraum fällt aus „Andere Räume", bleibt aber als Mitglied erreichbar', async ({ page }) => {
    const rnd = Math.floor(Math.random() * 1e9)
    const stdName = `Std-${rnd}`
    const propName = `Prop-${rnd}`
    const meetupName = `Meet-${rnd}`
    const propH = `p${rnd.toString(16).padStart(12, '0')}`

    createRoomNak(`std${rnd}`, stdName)
    createRoomNak(propH, propName, ['-t', `t=project-support`, '-t', `i=proposal:${rnd}`])
    createRoomNak(`m${rnd}`, meetupName, ['-t', 't=meetup', '-t', `i=meetup:${rnd}`, '-t', `meetup_slug=meet-${rnd}`])

    await login(page)

    // Der Standard-Raum belegt, dass die Liste geladen ist und der Seed griff.
    await expect(page.getByText(stdName, { exact: true })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('Andere Räume')).toBeVisible()

    // Beide kategorisierten Räume sind aus der Standard-Liste raus …
    await expect(page.getByText(propName, { exact: true })).toHaveCount(0)
    await expect(page.getByText(meetupName, { exact: true })).toHaveCount(0)
    // … der Meetup-Raum aber weiterhin im Meetup-Pool (Entdecken-Karte) — die
    // Projektunterstützung darf dort NICHT mitgezählt werden.
    const discover = page.getByRole('button', { name: /Meetup-Räume entdecken/ })
    await expect(discover).toBeVisible({ timeout: 15_000 })
    await discover.click()
    await expect(page.getByText(meetupName, { exact: true })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(propName, { exact: true })).toHaveCount(0)

    // Jetzt Mitglied im Antragsraum machen (kind 9000 → 39002) …
    execFileSync(NAK, ['event', '--auth', '--sec', ADMIN_HEX, '-k', '9000', '-t', `h=${propH}`, '-t', `p=${pubOf(NSEC)}`, ZOOID_WS])
    // `goto('/spaces')` statt `reload()`: der Entdecken-Klick oben schaltet in den
    // Meetup-Fokus, und der lebt seit dem Filter-URL-Sync in der URL (`?rt=meetups`).
    // Ein reload() käme also im Meetup-Fokus zurück, wo die Entdecken-Zeile der
    // Projektunterstützung bewusst nicht gerendert wird — der Test prüfte dann den
    // falschen Modus. Die parameterlose URL ist die frische Standard-Übersicht.
    await page.goto('/spaces')

    // … und taucht trotzdem NICHT direkt in der Liste auf — auch nicht unter
    // „Meine Räume": die Entdecken-Zeile vertritt die Kategorie GANZ, auch für
    // Mitglieder (Nutzerentscheidung 2026-07-27, zweite Runde).
    await expect(page.getByText(propName, { exact: true })).toHaveCount(0)

    // … sondern hinter der Entdecken-Zeile, die die alte eigene Sektion ersetzt.
    // Keine exakte Zahl in der Umfangszeile: der zooid-Seed wird zwischen
    // Testläufen wiederverwendet, `proposalCount()` zählt bei einem Nicht-Admin
    // ALLE Antragsräume, denen dieser Test-User je beigetreten ist (P5-Lehre,
    // siehe Suchtest unten) — hier zählt nur, dass die Zeile ihren Umfang zeigt.
    const discoverProposals = page.getByRole('button', { name: /Projektunterstützung entdecken/ })
    await expect(discoverProposals).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(/^\d+ (Antragsraum|Antragsräume)$/)).toBeVisible()

    // Erreichbar: Klick öffnet den Antrags-Fokus, der Raum steht in der Liste.
    await discoverProposals.click()
    await expect(page.getByText(propName, { exact: true })).toBeVisible({ timeout: 15_000 })
})

/**
 * Das Rollen-Gate der Kategorie: FREMDE Antragsräume gehören dem Vorstand
 * (Space-Admin), nicht jedem Mitglied. Derselbe Raum, zwei Blicke:
 *
 * - Nicht-Admin, nicht Mitglied → sieht ihn nirgends (Test oben, ohne 9000-Schritt).
 * - Admin, nicht Mitglied       → zählt hier in die Entdecken-Zeile mit und ist
 *   dahinter erreichbar (seit 2026-07-27 keine eigene Sektion mehr).
 *
 * Kein Session-Wechsel in EINER Page (der zweite Login liefe gegen die bestehende
 * Anmeldung) — die Nicht-Admin-Hälfte deckt der Test oben ab. Gegenprobe im
 * selben Lauf: der Standard-Raum muss sichtbar sein, sonst misst der Test einen
 * kaputten Seed statt des Gates.
 */
test('P4c: fremder Antragsraum zählt beim Admin (Vorstand) in die Entdecken-Zeile und ist dahinter erreichbar', async ({ page }) => {
    const rnd = Math.floor(Math.random() * 1e9)
    const stdName = `Std-${rnd}`
    const propName = `Prop-${rnd}`
    const propH = `p${rnd.toString(16).padStart(12, '0')}`

    createRoomNak(`std${rnd}`, stdName)
    createRoomNak(propH, propName, ['-t', `t=project-support`, '-t', `i=proposal:${rnd}`])

    // Admin (Relay-Owner = Vorstandsrolle): fremder Antragsraum zählt, ist aber
    // nicht direkt gelistet — erst der Klick auf die Entdecken-Zeile zeigt ihn.
    await loginAdmin(page)
    await expect(page.getByText(stdName, { exact: true })).toBeVisible({ timeout: 15_000 })

    const discover = page.getByRole('button', { name: /Projektunterstützung entdecken/ })
    await expect(discover).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(propName, { exact: true })).toHaveCount(0)

    await discover.click()
    await expect(page.getByText(propName, { exact: true })).toBeVisible({ timeout: 15_000 })
})

/**
 * P5 — Projektunterstützung ist filterbar wie die Meetups: die Entdecken-Zeile
 * „Projektunterstützung entdecken" (seit 2026-07-27 dasselbe Zeilen-Muster wie
 * die Meetup-Zeile; vorher ein Textlink „Alle anzeigen" im Sektionskopf einer
 * vollen Zeilenliste) führt in einen eigenen Fokus-Modus (`?rt=proposals`), der
 * Suche kennt, aber KEINEN Land-Filter (Antragsräume tragen kein Land).
 *
 * Der Test läuft als Admin (Vorstand), weil der nach `_proposalPool()` auch
 * FREMDE Antragsräume sieht — so genügt der 39000-Seed ohne Mitgliedschaft.
 */
test('P5: Antragsräume haben einen eigenen Fokus-Modus (Link · rt=proposals · kein Land-Filter)', async ({ page }) => {
    const rnd = Math.floor(Math.random() * 1e9)
    const stdName = `Std-${rnd}`
    const propA = `PropA-${rnd}`
    const propB = `PropB-${rnd}`
    const meetupName = `Meet-${rnd}`

    createRoomNak(`std${rnd}`, stdName)
    createRoomNak(`p${rnd.toString(16).padStart(12, '0')}`, propA, ['-t', 't=project-support', '-t', `i=proposal:${rnd}`])
    createRoomNak(`q${rnd.toString(16).padStart(12, '0')}`, propB, ['-t', 't=project-support', '-t', `i=proposal:${rnd + 1}`])
    createRoomNak(`m${rnd}`, meetupName, ['-t', 't=meetup', '-t', `i=meetup:${rnd}`, '-t', `meetup_slug=meet-${rnd}`])

    await loginAdmin(page)
    await expect(page.getByText(stdName, { exact: true })).toBeVisible({ timeout: 15_000 })

    // Der Einstieg: die Entdecken-Zeile — beide Antragsräume liegen dahinter,
    // nicht mehr einzeln in der Hauptliste (Wunsch 2026-07-27).
    const discover = page.getByRole('button', { name: /Projektunterstützung entdecken/ })
    await expect(discover).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(propA, { exact: true })).toHaveCount(0)

    // Filterwechsel darf KEINEN History-Eintrag erzeugen (nur replaceState) —
    // sonst bräuchte Zurück je Filterklick einen Schritt (back-navigation.spec.ts).
    const historyBefore = await page.evaluate(() => history.length)
    await discover.click()
    await expect(page).toHaveURL(/[?&]rt=proposals\b/, { timeout: 15_000 })
    expect(await page.evaluate(() => history.length)).toBe(historyBefore)

    // Im Fokus: nur noch Antragsräume, alles andere ist weg.
    await expect(page.getByText(propA, { exact: true })).toBeVisible()
    await expect(page.getByText(propB, { exact: true })).toBeVisible()
    await expect(page.getByText(stdName, { exact: true })).toHaveCount(0)
    await expect(page.getByText('Andere Räume')).toHaveCount(0)
    await expect(page.getByRole('button', { name: /Meetup-Räume entdecken/ })).toHaveCount(0)

    // Kein Land-Filter (Antragsräume tragen kein Land) — die Suche dagegen schon,
    // mit eigenem Platzhalter (Alpine-Bind, nicht der Meetup-Text).
    await expect(page.getByRole('button', { name: 'Land' })).toBeHidden()
    const search = page.getByPlaceholder('Antragsraum suchen…')
    await expect(search).toBeVisible()

    // Suche filtert die Fokus-Liste; der Ergebnis-Zähler folgt. Die Query trägt das
    // `rnd` des Laufs: der zooid-Seed wird zwischen Läufen wiederverwendet, eine
    // Teil-Query wie „PropA" träfe auch die Antragsräume FRÜHERER Läufe (gemessen:
    // Zähler stand dann auf 3 bzw. 4). Sie ist zugleich KÜRZER als der Raumname,
    // damit der Filter-Chip nicht denselben Text trägt wie die Raumzeile.
    await search.fill(`A-${rnd}`)
    await expect(page.getByText(propB, { exact: true })).toHaveCount(0)
    await expect(page.getByText(propA, { exact: true })).toBeVisible()
    await expect(page.getByText('1 Räume', { exact: true })).toBeVisible()

    // Leerer Treffer → eigener Leerzustand, nicht die Meetup-Formulierung.
    await search.fill(`kein-treffer-${rnd}`)
    await expect(page.getByText('Keine Antragsräume passen zu deiner Suche.')).toBeVisible()

    // Rückweg wie bei den Meetups → Standardliste, Filter leer, `rt` aus der URL.
    await page.getByRole('button', { name: 'Räume anzeigen' }).first().click()
    await expect(page).not.toHaveURL(/rt=/)
    await expect(page.getByText(stdName, { exact: true })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('button', { name: /Projektunterstützung entdecken/ })).toBeVisible()
})

/** Deep-Link: `?rt=proposals` stellt den Fokus beim Laden her (Kaltstart). */
test('P5: ?rt=proposals öffnet den Antrags-Fokus direkt', async ({ page }) => {
    const rnd = Math.floor(Math.random() * 1e9)
    const stdName = `Std-${rnd}`
    const propName = `Prop-${rnd}`

    createRoomNak(`std${rnd}`, stdName)
    createRoomNak(`p${rnd.toString(16).padStart(12, '0')}`, propName, ['-t', 't=project-support'])

    await loginAdmin(page)
    await expect(page.getByText(stdName, { exact: true })).toBeVisible({ timeout: 15_000 })

    await page.goto('/spaces?rt=proposals')
    await expect(page.getByText(propName, { exact: true })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(stdName, { exact: true })).toHaveCount(0)
    await expect(page.getByPlaceholder('Antragsraum suchen…')).toBeVisible()
})

/**
 * P6 — Ungelesenes hinter der Entdecken-Zeile verschwindet nicht: die
 * Summenpille (`proposalUnread()`, eine Teilsumme derselben `rooms`-Karte wie
 * jede einzelne Raum-Zeile, `sumUnreadRooms`) trägt es weiter, obwohl die
 * beigetretenen Antragsraum-Zeilen selbst nicht mehr sichtbar sind. Genau das
 * ist der Grund, warum es die Pille überhaupt gibt — ohne sie schluckte das
 * Herausfiltern der Kategorie eine ungelesene Nachricht kommentarlos.
 *
 * Mitgliedschaft VOR dem Login: der Raum muss schon beim ersten Render in
 * `userRooms` stehen, sonst vergibt `computeUnread` (Regel 1, nur beigetretene
 * Räume) ihm nie einen Schlüssel — die Pille bliebe dann grundlos leer, ohne
 * dass am Zähl-Pfad selbst etwas falsch wäre.
 */
test('P6: ungelesene Nachricht in beigetretenem Antragsraum zeigt die Summenpille an der Entdecken-Zeile', async ({ page }) => {
    const rnd = Math.floor(Math.random() * 1e9)
    const stdName = `Std-${rnd}`
    const propName = `Prop-${rnd}`
    const propH = `p${rnd.toString(16).padStart(12, '0')}`

    createRoomNak(`std${rnd}`, stdName)
    createRoomNak(propH, propName, ['-t', 't=project-support', '-t', `i=proposal:${rnd}`])
    execFileSync(NAK, ['event', '--auth', '--sec', ADMIN_HEX, '-k', '9000', '-t', `h=${propH}`, '-t', `p=${pubOf(NSEC)}`, ZOOID_WS])

    await login(page)
    await expect(page.getByText(stdName, { exact: true })).toBeVisible({ timeout: 15_000 })

    const discover = page.getByRole('button', { name: /Projektunterstützung entdecken/ })
    await expect(discover).toBeVisible({ timeout: 15_000 })
    // Dieselbe Pillen-Signatur wie in `unread-dot.spec.ts` (`roomDot`): eine
    // deckende Fläche ohne Theme-Variante, `x-if` rendert bei 0 gar keinen Knoten.
    const pill = discover.locator('span.bg-brand-500.text-zinc-950')
    await expect(pill).toHaveCount(0) // Ausgangslage: nichts ungelesen, keine Pille.

    // Fremde Nachricht NACH dem Login → ungelesen.
    await awaitNextSecond(page)
    execFileSync(NAK, ['event', '--auth', '--sec', ADMIN_HEX, '-k', '9', '-t', `h=${propH}`, '-c', `Hallo-${rnd}`, ZOOID_WS])

    await expect(pill).toBeVisible({ timeout: 20_000 })
    await expect(pill).toHaveText('1')
})
