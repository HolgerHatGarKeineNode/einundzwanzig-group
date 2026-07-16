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
