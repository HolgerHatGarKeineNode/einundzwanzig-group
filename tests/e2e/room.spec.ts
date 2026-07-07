import { test, expect, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { useZooid } from './support/zooid'

const NSEC = process.env.NOSTR_TEST_NSEC as string
const NAK = '/home/user/go/bin/nak'
const ADMIN = 'b2ee09a54bedf17ee1db562bdddd75c48661d981eb52c49dc206c55ba8439414'

/** Loggt via nsec ein und öffnet den Chat des Rooms „welcome". */
async function openRoom(page: Page): Promise<void> {
    await useZooid(page)
    await page.goto('/nostr-login')
    await page.getByPlaceholder(/nsec1/).fill(NSEC)
    await page.getByRole('button', { name: 'Anmelden' }).click()
    await page.waitForURL('**/spaces')
    await page.goto('/rooms/welcome')
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
        '-c', `E2E ${marker}`, 'ws://localhost:3334',
    ])

    await expect(page.getByText(`E2E ${marker}`)).toBeVisible({ timeout: 15_000 })
})
