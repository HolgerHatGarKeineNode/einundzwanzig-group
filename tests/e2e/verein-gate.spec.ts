import { test, expect, type Page } from '@playwright/test'
import { useZooid } from './support/zooid'
import { generateSecretKey } from 'nostr-tools/pure'
import { nsecEncode } from 'nostr-tools/nip19'

// Der geseedete Test-User (VIEWER) trägt die Rolle „member" → steht in der
// relay-signierten 13534-Liste, ist also Vereinsmitglied des lokalen zooid.
const MEMBER_NSEC = process.env.NOSTR_TEST_NSEC as string

// Ein frischer, NICHT geseedeter Schlüssel — kein Mitglied des zooid.
const strangerNsec = (): string => nsecEncode(generateSecretKey())

/** Loggt per nsec ein und öffnet die Zielseite des fixierten Space. */
async function loginAndOpen(page: Page, nsec: string, path = '/spaces'): Promise<void> {
    await useZooid(page)
    await page.goto('/nostr-login')
    await page.getByPlaceholder(/nsec1/).fill(nsec)
    await page.getByRole('button', { name: 'Anmelden' }).click()
    await page.waitForURL('**/spaces')
    if (path !== '/spaces') {
        await page.goto(path)
    }
}

/**
 * Vereins-Gate: Der lokale zooid ist ein EINUNDZWANZIG-Vereins-Relay
 * (DEFAULT_SPACE_URL). Ein Nicht-Mitglied sieht auf „Räume" und „Mitglieder"
 * den Beitritts-Hinweis mit Link zu verein.einundzwanzig.space.
 */
test('Nicht-Mitglied sieht das Vereins-Gate auf Räume', async ({ page }) => {
    await loginAndOpen(page, strangerNsec(), '/spaces')

    await expect(page.getByText('Noch kein Vereinsmitglied')).toBeVisible({ timeout: 15_000 })
    const cta = page.getByRole('link', { name: 'Vereinsmitglied werden' })
    await expect(cta).toBeVisible()
    await expect(cta).toHaveAttribute('href', 'https://verein.einundzwanzig.space/')
})

test('Nicht-Mitglied sieht das Vereins-Gate auf Mitglieder', async ({ page }) => {
    await loginAndOpen(page, strangerNsec(), '/directory')

    await expect(page.getByText('Noch kein Vereinsmitglied')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('link', { name: 'Vereinsmitglied werden' })).toBeVisible()
})

/**
 * Einstellungen: Wählt man ein EINUNDZWANZIG-Vereins-Relay, erscheint ein Toast
 * mit dem Mitgliedschafts-Hinweis — er übersteht die wire:navigate-Navigation.
 */
test('Vereins-Relay in den Einstellungen zeigt einen Toast', async ({ page }) => {
    await loginAndOpen(page, strangerNsec(), '/settings/space')

    // Der fixierte Default-Space (lokaler zooid) ist der einzige Eintrag.
    await page.getByText('localhost:3334').click()

    await page.waitForURL('**/spaces')
    await expect(page.getByText(/Vereins-Relay/)).toBeVisible({ timeout: 10_000 })
})

/** Ein Mitglied (in der 13534) sieht das Gate NIE — auch nicht kurz (kein Flash). */
test('Mitglied sieht das Vereins-Gate nicht', async ({ page }) => {
    await loginAndOpen(page, MEMBER_NSEC, '/spaces')

    // Space ist geladen (Räume da), aber das Gate bleibt aus.
    await expect(page.getByText('Dev')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('Noch kein Vereinsmitglied')).toBeHidden()

    await page.goto('/directory')
    await expect(page.getByText('Relay Admin')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('Noch kein Vereinsmitglied')).toBeHidden()
})
