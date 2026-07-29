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
async function loginAndOpen(page: Page, nsec: string, path = '/spaces'): Promise<void> {
    await useZooid(page)
    await loginNsec(page, nsec)
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
    await page.getByText(`localhost:${ZOOID_PORT}`).click()

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
    // `.first()`, weil „Relay Admin" im Verzeichnis ZWEIMAL stehen kann: einmal als
    // Mitglied der Liste und einmal als gemeldeter Autor in der Melde-Queue. Die
    // Meldungen stammen aus den C2-Moderationstests — je nachdem, ob die vorher
    // gelaufen sind, trifft ein globaler Text-Locator ein oder zwei Elemente, und
    // Playwrights strict mode bricht ab. Genau so ist dieser Fall im Gesamtlauf
    // wiederholt gescheitert, waehrend er einzeln immer gruen war.
    //
    // Geprueft wird hier nur, DASS das Verzeichnis Inhalt zeigt (also das Gate nicht
    // greift) — welcher der beiden Treffer es ist, spielt fuer diese Aussage keine
    // Rolle. Die Zeile darunter traegt die eigentliche Zusicherung.
    await expect(page.getByText('Relay Admin').first()).toBeVisible({ timeout: 15_000 })
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
    await page.waitForURL('**/spaces')

    // Trotz 3 s AUTH-Verzögerung: Räume da, Gate bleibt aus.
    await expect(page.getByText('Dev')).toBeVisible({ timeout: 25_000 })
    await expect(page.getByText('Noch kein Vereinsmitglied')).toBeHidden()
})
