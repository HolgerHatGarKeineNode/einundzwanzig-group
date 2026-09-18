import { test, expect, type Page } from './support/fixtures'
import { useZooid, ZOOID_PORT } from './support/zooid'
import { generateSecretKey, finalizeEvent } from 'nostr-tools/pure'
import { nsecEncode } from 'nostr-tools/nip19'
import { testKeys } from './support/keys'
import { loginNsec } from './support/login'

// Der geseedete Test-User (VIEWER) trägt die Rolle „member" → steht in der
// relay-signierten 13534-Liste, ist also Vereinsmitglied des lokalen zooid.
const MEMBER_NSEC = process.env.NOSTR_TEST_NSEC as string

// Ein frischer, NICHT geseedeter Schlüssel — kein Mitglied des zooid.
const strangerNsec = (): string => nsecEncode(generateSecretKey())

/** Loggt per nsec ein und öffnet die Zielseite des fixierten Space. */
async function loginAndOpen(page: Page, nsec: string, path = '/bereich/chat'): Promise<void> {
    await useZooid(page)
    await loginNsec(page, nsec)
    // Always navigate: since P2 a login lands on `/start`, not on the room list — an
    // `if (path !== <landing place>)` would silently let the caller measure Start instead.
    await page.goto(path)
}

/**
 * Vereins-Gate: Der lokale zooid ist ein EINUNDZWANZIG-Vereins-Relay
 * (DEFAULT_SPACE_URL). Ein Nicht-Mitglied sieht auf „Räume" und „Mitglieder"
 * den Beitritts-Hinweis mit Link zu verein.einundzwanzig.space.
 */
test('Nicht-Mitglied sieht das Vereins-Gate auf Räume', async ({ page }) => {
    await loginAndOpen(page, strangerNsec(), '/bereich/chat')

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
    await page.getByText(`localhost:${ZOOID_PORT}`).click()

    // Choosing a space sends the client to the ROOM LIST — that is where the rooms of the
    // chosen space are (measured; until P2 the same step landed on `/spaces`).
    await page.waitForURL('**/bereich/chat')
    await expect(page.getByText(/Vereins-Relay/)).toBeVisible({ timeout: 10_000 })
})

/** Ein Mitglied (in der 13534) sieht das Gate NIE — auch nicht kurz (kein Flash). */
test('Mitglied sieht das Vereins-Gate nicht', async ({ page }) => {
    await loginAndOpen(page, MEMBER_NSEC, '/bereich/chat')

    // Space ist geladen (Räume da), aber das Gate bleibt aus.
    await expect(page.getByText('Dev')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('Noch kein Vereinsmitglied')).toBeHidden()

    await page.goto('/bereich/leute')
    await expect(page.locator('.list-stagger').getByText('Relay Admin')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('Noch kein Vereinsmitglied')).toBeHidden()
})

/**
 * Langsamer Signer (z. B. NIP-46-Bunker): auf `public_read=false`-Relays braucht
 * JEDER Read erst NIP-42-AUTH über den Signer. Hier signiert der Signer die
 * AUTH (kind 22242) absichtlich 3 s verzögert. Trotzdem müssen die Räume
 * erscheinen (Live-Sub überlebt die AUTH, `ready` wartet auf AUTH-settled) —
 * kein Steckenbleiben, kein verfrühter „kein Mitglied"-Hinweis.
 */
test('Mitglied: Räume erscheinen auch bei langsamer AUTH (verzögerter Signer)', async ({ page }) => {
    const { sk, pk } = testKeys() // VIEWER = Mitglied (in der 13534)

    // NIP-07-Signer, der NUR die NIP-42-AUTH (kind 22242) verzögert.
    await page.exposeFunction('__slowGetPk', () => pk)
    await page.exposeFunction('__slowSign', async (e: { kind: number }) => {
        if (e.kind === 22242) {
            await new Promise((r) => setTimeout(r, 3000))
        }
        return finalizeEvent(e as Parameters<typeof finalizeEvent>[0], sk)
    })
    await page.addInitScript(() => {
        // @ts-expect-error — window.nostr ist die NIP-07-Schnittstelle.
        window.nostr = {
            // @ts-expect-error — von exposeFunction bereitgestellt.
            getPublicKey: () => window.__slowGetPk(),
            // @ts-expect-error — von exposeFunction bereitgestellt.
            signEvent: (e: unknown) => window.__slowSign(e),
        }
    })

    await useZooid(page)
    await page.goto('/nostr-login')
    await page.getByRole('button', { name: /Browser-Erweiterung/ }).click()
    await page.waitForURL('**/start')
    // The rooms this case is about live on the room list; a login lands on Start since P2.
    await page.goto('/bereich/chat')

    // Trotz 3 s AUTH-Verzögerung: Räume da, Gate bleibt aus.
    await expect(page.getByText('Dev')).toBeVisible({ timeout: 25_000 })
    await expect(page.getByText('Noch kein Vereinsmitglied')).toBeHidden()
})
