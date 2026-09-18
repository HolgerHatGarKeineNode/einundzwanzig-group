import { test, expect, type Page } from './support/fixtures'
import { testKeys } from './support/keys'
import { installNip07 } from './support/nip07'
import { startRelay } from './support/relay'
import { startBunker } from './support/bunker'
import { useZooid } from './support/zooid'
import { loginNsec } from './support/login'

const NSEC = process.env.NOSTR_TEST_NSEC as string

/**
 * Whom is this browser signed in as? Asked on „Ich" — the one page that PRINTS the npub
 * (`partials/ich/identitaet.blade.php`).
 *
 * Until P2 the room list carried it in its profile chip, and these cases read it off
 * `body` wherever the login happened to land. P2 moved the identity to „Ich" (D3), so
 * reading the landing page would now measure a page that never claimed to show it.
 */
async function zeigtNpub(page: Page, npub: string): Promise<void> {
    await page.goto('/ich')
    await expect(page.locator('body')).toContainText(npub, { timeout: 15_000 })
}

/**
 * M1.5 — die Client-Login-Pfade end-to-end: welshman-Signer im Browser →
 * NIP-98-Handoff → Laravel-Gate (`/spaces`). Was PHPUnit nicht abdeckt, weil
 * der Signer nie zum Server geht. Alle Läufe zeigen auf den lokalen zooid.
 */
test.describe('Nostr-Login (E2E)', () => {
    test.beforeEach(async ({ page }) => {
        await useZooid(page)
    })

    test('NIP-07 (Extension) meldet über den Handoff im Gate an', async ({ page }) => {
        const { sk, pk, npub } = testKeys()
        await installNip07(page, sk, pk)

        await page.goto('/nostr-login')
        await page.getByRole('button', { name: /Browser-Erweiterung/ }).click()

        await page.waitForURL('**/start')
        await zeigtNpub(page, npub)
    })

    test('nsec-Login meldet über den Handoff im Gate an', async ({ page }) => {
        const { npub } = testKeys()

        await loginNsec(page, NSEC)
        await zeigtNpub(page, npub)
    })

    test('Reauth: verlorene Server-Session wird auf der Login-Seite automatisch wiederhergestellt', async ({ page, context }) => {
        const { npub } = testKeys()

        // Regulär anmelden → Client-Session (localStorage) + Laravel-Session.
        await loginNsec(page, NSEC)

        // Reboot/Ablauf simulieren: Server-Session (Cookies) weg, Client-Session bleibt.
        await context.clearCookies()

        // A gated surface → the gate throws to /nostr-login → auto re-auth (NIP-98) → back
        // to that same surface. Since P2 the room list is called `/bereich/chat`.
        await page.goto('/bereich/chat')
        await page.waitForURL('**/bereich/chat', { timeout: 15_000 })
        await zeigtNpub(page, npub)
    })

    test('NIP-46-Bunker-Login meldet über den lokalen Relay im Gate an', async ({ page, relayWaechter }) => {
        const { sk, npub } = testKeys()
        const relay = await startRelay()
        const bunker = await startBunker(relay.url, sk)
        // Dieser Test bringt SEINEN EIGENEN Relay mit (`support/relay.ts`, freier Port aus
        // der Ephemeral-Reihe) — die Seite spricht ihn also zu Recht an, und der
        // Relay-Wächter kann das nicht wissen. Die Freigabe steht deshalb hier, mit der
        // Adresse, die der Test selbst erzeugt hat: die Erlaubnisliste des Wächters bleibt
        // unangetastet (sie führt weiterhin nur die beiden Worker-Relays), und ein
        // VERSEHENTLICHER fremder Socket in genau diesem Test fiele nach wie vor auf.
        relayWaechter.erlaube(relay.url)

        try {
            await page.goto('/nostr-login')
            // nsec/Bunker liegen seit dem gehärteten Formular hinter „Andere Optionen".
            await page.getByRole('button', { name: 'Andere Optionen' }).click()
            await page.getByPlaceholder('bunker://…').fill(bunker.uri)
            await page.getByRole('button', { name: 'Mit Bunker verbinden' }).click()

            // A login without a remembered target lands on `/start` since P2.
            await page.waitForURL('**/start', { timeout: 20_000 })
            await zeigtNpub(page, npub)
        } finally {
            bunker.close()
            await relay.close()
        }
    })

    test('NIP-07-Button erscheint auch bei verzögert injizierter Extension', async ({ page }) => {
        await page.goto('/nostr-login')
        const btn = page.getByRole('button', { name: /Browser-Erweiterung/ })
        await expect(btn).toBeHidden()

        // Alby/nos2x setzen window.nostr oft ERST nach dem Alpine-init (der gemeldete Bug).
        await page.evaluate(() => {
            // @ts-expect-error — window.nostr ist die NIP-07-Schnittstelle.
            window.nostr = { getPublicKey: async () => 'a'.repeat(64), signEvent: async (e: unknown) => e }
        })

        await expect(btn).toBeVisible({ timeout: 5_000 })
    })

    test('Amber-QR (nostrconnect) wird erzeugt und angezeigt', async ({ page }) => {
        await page.goto('/nostr-login')
        // Web ohne Erweiterung: der Primär-CTA „Signer per QR verbinden" ist der
        // nostrconnect-Pfad (Amber ist im Web keine eigene Marke mehr, §5.1).
        await page.getByRole('button', { name: 'Signer per QR verbinden' }).click()

        // Desktop-Web: kein nativer Intent → QR zum Scannen mit Amber.
        // Deckt die ganze Kette ab: startConnect → makeNostrconnectUrl → QR-Render.
        // Der Handshake selbst nutzt dieselben Primitive wie der Bunker-Login (dort getestet).
        const qr = page.getByAltText('nostrconnect QR-Code')
        await expect(qr).toBeVisible({ timeout: 15_000 })
        await expect(qr).toHaveAttribute('src', /^data:image\/png/)
    })

    test('Logout leert beide Sessions und das Gate sperrt wieder', async ({ page }) => {
        await loginNsec(page, NSEC)

        // Signing out lives on „Ich" since P3 (`⚡ich.blade.php`) — until then it sat behind
        // the profile-chip popover of the old room-list header. The way there is the avatar in
        // the page header, which carries exactly this `aria-label` (`me-avatar.blade.php`).
        await page.getByRole('link', { name: /Angemeldet als/ }).click()
        await page.waitForURL('**/ich')
        await page.getByRole('button', { name: 'Abmelden' }).click()
        await page.waitForURL('**/nostr-login')

        // The gate applies again: the room list → redirect back to the login.
        await page.goto('/bereich/chat')
        await page.waitForURL('**/nostr-login')
    })
})
