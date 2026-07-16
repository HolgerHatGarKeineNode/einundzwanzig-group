import { test, expect, type Page } from './support/fixtures'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { useZooid, ZOOID_PORT } from './support/zooid'
import { loginNsec } from './support/login'

const NSEC = process.env.NOSTR_TEST_NSEC as string
// Relay-Owner-Secret (Pubkey = relay.self) — der einzige NIP-86-Admin des zooid.
const ADMIN_HEX = 'b2ee09a54bedf17ee1db562bdddd75c48661d981eb52c49dc206c55ba8439414'
const NAK = '/home/user/go/bin/nak'
const HTTP = `http://localhost:${ZOOID_PORT}/`

/** NIP-86-Management-Call als ADMIN (NIP-98 HTTP-Auth), wie das Seed-Skript. */
function mgmt(body: string): void {
    const hash = createHash('sha256').update(body).digest('hex')
    const evt = execFileSync(NAK, ['event', '-k', '27235', '--sec', ADMIN_HEX, '-t', `u=${HTTP}`, '-t', 'method=POST', '-t', `payload=${hash}`])
        .toString()
        .trim()
    const auth = Buffer.from(evt).toString('base64')
    execFileSync('curl', ['-s', '-X', 'POST', HTTP, '-H', 'Content-Type: application/nostr+json+rpc', '-H', `Authorization: Nostr ${auth}`, '-d', body])
}

/** Der aktuelle NIP-11-`name` des Test-Relays (frischer HTTP-GET, kein Cache). */
function relayName(): string {
    const info = execFileSync('curl', ['-s', '-H', 'Accept: application/nostr+json', HTTP]).toString()
    return (JSON.parse(info).name as string) ?? ''
}

/** Loggt mit einem Secret ein und öffnet das Directory des fixierten Space. */
async function openDirectoryAs(page: Page, secret: string): Promise<void> {
    await useZooid(page)
    await loginNsec(page, secret)
    await page.goto('/directory')
}

/** Standard: als Wegwerf-Test-User (kein Admin). */
const openDirectory = (page: Page): Promise<void> => openDirectoryAs(page, NSEC)

/**
 * M3 (Directory, Fix A) — Mitglieder + Rollen des fixierten Space erscheinen
 * OHNE „keine Mitglieder"-Flackern: der relay-signierte Filter wartet auf
 * `relay.self` (NIP-11), bis dahin Skeleton. Rollen-Badges tragen die
 * HSL-Farbe aus 33534; die Client-Suche filtert über Name + npub.
 */
test('M3: Directory zeigt Members + Rollen, ohne Flackern', async ({ page }) => {
    await openDirectory(page)

    // Beide geseedeten Mitglieder (mit kind-0-Namen)
    await expect(page.getByText('Relay Admin')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('Alice Test')).toBeVisible()

    // Rollen-Badges aus 33534 (exakt — „Mitglied" ≠ Überschrift „Mitglieder").
    // Auf das sichtbare Member-Grid begrenzt: dieselben Labels stehen auch in den
    // (versteckten) Admin-Modals. `.first()`, weil mehrere Mitglieder dasselbe
    // Badge tragen können (Test-User + Entwickler-npub sind beide „Mitglied").
    const grid = page.locator('.list-stagger')
    await expect(grid.getByText('Moderator', { exact: true }).first()).toBeVisible()
    await expect(grid.getByText('Mitglied', { exact: true }).first()).toBeVisible()

    // Fix A: der „leere" Zustand darf nie erscheinen (self war vor dem Filter da)
    await expect(page.getByText('Noch keine Mitglieder')).toBeHidden()
})

test('M3: Client-Suche filtert die Mitglieder', async ({ page }) => {
    await openDirectory(page)
    await expect(page.getByText('Relay Admin')).toBeVisible({ timeout: 15_000 })

    const search = page.getByPlaceholder('Mitglied suchen…')

    // Treffer eingrenzen
    await search.fill('alice')
    await expect(page.getByText('Alice Test')).toBeVisible()
    await expect(page.getByText('Relay Admin')).toBeHidden()

    // Kein Treffer
    await search.fill('zzzzzz')
    await expect(page.getByText(/Kein Mitglied passt/)).toBeVisible()

    // Zurücksetzen zeigt wieder alle
    await search.fill('')
    await expect(page.getByText('Relay Admin')).toBeVisible()
    await expect(page.getByText('Alice Test')).toBeVisible()
})

test('M3: Directory überlebt Reload ohne Flackern', async ({ page }) => {
    await openDirectory(page)
    await expect(page.getByText('Relay Admin')).toBeVisible({ timeout: 15_000 })

    await page.reload()

    await expect(page.getByText('Relay Admin')).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('.list-stagger').getByText('Moderator', { exact: true })).toBeVisible()
    await expect(page.getByText('Noch keine Mitglieder')).toBeHidden()
})

/**
 * M6 (Admin, NIP-86) — der Relay-Owner (self) wird über `supportedmethods`
 * (HTTP + NIP-98, im Browser signiert) als Admin erkannt und sieht die
 * Verwaltungstools; die Rollen-Liste zeigt die geseedeten Rollen.
 */
test('M6: Relay-Owner sieht die NIP-86-Verwaltungstools', async ({ page }) => {
    await openDirectoryAs(page, ADMIN_HEX)
    await expect(page.getByText('Relay Admin')).toBeVisible({ timeout: 15_000 })

    await expect(page.getByRole('button', { name: 'Rollen verwalten' })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('button', { name: 'Gebannt' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Einladen' })).toBeVisible()

    // Rollen-Liste öffnet und zeigt die geseedeten 33534-Rollen
    await page.getByRole('button', { name: 'Rollen verwalten' }).click()
    await expect(page.getByRole('dialog').getByText('Moderator', { exact: true }).first()).toBeVisible()
})

/** M6 — ein normaler User sieht KEINE Verwaltungstools (Gating). */
test('M6: normaler User sieht keine Verwaltungstools', async ({ page }) => {
    await openDirectory(page)
    await expect(page.getByText('Relay Admin')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('button', { name: 'Rollen verwalten' })).toBeHidden()
})

/**
 * P2 (Space-Metadaten, NIP-86 changerelay*) — der Admin sieht den „Space"-Editor
 * in der Verwaltungsleiste, das Namensfeld ist aus dem NIP-11 vorbelegt.
 */
test('P2: Admin sieht den Space-Editor mit vorbelegtem Namen', async ({ page }) => {
    await openDirectoryAs(page, ADMIN_HEX)
    await expect(page.getByText('Relay Admin')).toBeVisible({ timeout: 15_000 })

    await page.getByRole('button', { name: 'Space', exact: true }).click()
    const modal = page.locator('dialog[data-modal="space-edit"]')
    await expect(modal.getByText('Space bearbeiten')).toBeVisible()
    // Vorbelegt aus dem NIP-11-Info-Doc (name="Zooid Test Space").
    await expect(modal.getByPlaceholder('Space-Name')).toHaveValue('Zooid Test Space')
})

/** P2 — ein normaler User sieht den Space-Editor NICHT (Gating). */
test('P2: normaler User sieht keinen Space-Editor', async ({ page }) => {
    await openDirectory(page)
    await expect(page.getByText('Relay Admin')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('button', { name: 'Space', exact: true })).toBeHidden()
})

/**
 * P2 — der Admin ändert den Space-Namen; setRelayName (changerelayname) schreibt
 * ihn relay-seitig (NIP-11). Round-Trip mit finally-Restore, weil spaces.spec den
 * Original-Namen „Zooid Test Space" asserted (geteilte Worker-zooid-Instanz).
 */
test('P2: Admin ändert den Space-Namen (changerelayname)', async ({ page }) => {
    const ORIG = 'Zooid Test Space'
    const marker = `Space-${Math.floor(Math.random() * 1e9)}`
    try {
        await openDirectoryAs(page, ADMIN_HEX)
        await expect(page.getByText('Relay Admin')).toBeVisible({ timeout: 15_000 })

        await page.getByRole('button', { name: 'Space', exact: true }).click()
        const modal = page.locator('dialog[data-modal="space-edit"]')
        const nameInput = modal.getByPlaceholder('Space-Name')
        await expect(nameInput).toHaveValue(ORIG)
        await nameInput.fill(marker)
        await modal.getByRole('button', { name: 'Speichern' }).click()

        // Relay-NIP-11 trägt den neuen Namen (zooid SetName), Modal schließt.
        await expect.poll(() => relayName(), { timeout: 15_000 }).toBe(marker)
        await expect(modal).toBeHidden()
    } finally {
        // Immer zurücksetzen — auch bei Fehler (spaces.spec erwartet den Originalnamen).
        mgmt(`{"method":"changerelayname","params":[${JSON.stringify(ORIG)}]}`)
    }
})

/**
 * P2 (Regression, ultracode-Finding) — Öffnen + direkt Speichern OHNE Eingabe darf
 * die Relay-Metadaten NICHT anfassen: saveSpace vergleicht gegen den Prefill-Snapshot
 * (_spaceInitial), also wird ein unverändertes (oder aus noch nicht geladenem Profil
 * leeres) Feld nie gesendet → kein Whitespace-No-op, kein Namens-Wipe.
 */
test('P2: No-op-Save lässt den Space-Namen unverändert', async ({ page }) => {
    const ORIG = 'Zooid Test Space'
    try {
        await openDirectoryAs(page, ADMIN_HEX)
        await expect(page.getByText('Relay Admin')).toBeVisible({ timeout: 15_000 })

        await page.getByRole('button', { name: 'Space', exact: true }).click()
        const modal = page.locator('dialog[data-modal="space-edit"]')
        await expect(modal.getByPlaceholder('Space-Name')).toHaveValue(ORIG)
        await modal.getByRole('button', { name: 'Speichern' }).click()
        await expect(modal).toBeHidden()

        // Kurz warten, dann prüfen: der Name ist unangetastet (kein stray changerelayname).
        await page.waitForTimeout(1000)
        expect(relayName()).toBe(ORIG)
    } finally {
        mgmt(`{"method":"changerelayname","params":[${JSON.stringify(ORIG)}]}`)
    }
})
