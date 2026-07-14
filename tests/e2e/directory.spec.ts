import { test, expect, type Page } from './support/fixtures'
import { useZooid } from './support/zooid'
import { loginNsec } from './support/login'

const NSEC = process.env.NOSTR_TEST_NSEC as string
// Relay-Owner-Secret (Pubkey = relay.self) — der einzige NIP-86-Admin des zooid.
const ADMIN_HEX = 'b2ee09a54bedf17ee1db562bdddd75c48661d981eb52c49dc206c55ba8439414'

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
