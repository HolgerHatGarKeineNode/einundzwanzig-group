import { test, expect, type Page } from '@playwright/test'
import { useZooid } from './support/zooid'

const NSEC = process.env.NOSTR_TEST_NSEC as string

/** Loggt via nsec ein und öffnet das Directory des fixierten Space. */
async function openDirectory(page: Page): Promise<void> {
    await useZooid(page)
    await page.goto('/nostr-login')
    await page.getByPlaceholder(/nsec1/).fill(NSEC)
    await page.getByRole('button', { name: 'Anmelden' }).click()
    await page.waitForURL('**/spaces')
    await page.goto('/directory')
}

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

    // Rollen-Badges aus 33534 (exakt — „Mitglied" ≠ Überschrift „Mitglieder")
    await expect(page.getByText('Moderator', { exact: true })).toBeVisible()
    await expect(page.getByText('Mitglied', { exact: true })).toBeVisible()

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
    await expect(page.getByText('Moderator')).toBeVisible()
    await expect(page.getByText('Noch keine Mitglieder')).toBeHidden()
})
