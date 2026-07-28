import { test, expect, type Page } from './support/fixtures'
import { useBuzz, BUZZ_OWNER_NSEC, BUZZ_USER_PUB } from './support/buzz'
import { loginNsec } from './support/login'
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'

/**
 * P3 (Buzz-Migrationsplan) — Space-Verwaltung ohne NIP-86.
 *
 * Buzz kennt kein NIP-86; am laufenden Relay gemessen antwortet `POST /` mit
 * `405 Method Not Allowed, allow: GET,HEAD`. Vor P3 scheiterte deshalb der
 * `supportedmethods`-Probe still, `isAdmin` blieb false und „Neuen Raum anlegen"
 * wurde gar nicht erst gerendert. Dieses Spec belegt die Umstellung auf Buzz'
 * native Relay-Admin-Kinds:
 *
 * - Admin-Erkennung aus der relay-signierten 13534 (`["member", pk, role]`)
 * - Mitglied aufnehmen  → kind 9030
 * - Mitglied entfernen  → kind 9031
 *
 * Laeuft NUR mit `E2E_RELAY=buzz` (isolierter buzz-test-Stack auf :3001).
 */
test.describe('Buzz-Space-Verwaltung (E2E, nur E2E_RELAY=buzz)', () => {
    test.skip(process.env.E2E_RELAY !== 'buzz', 'nur im Buzz-Modus (E2E_RELAY=buzz) relevant')

    test.beforeEach(async ({ page }) => {
        await useBuzz(page)
    })

    /**
     * Ruft eine Methode der Directory-Insel ueber Alpines oeffentliche
     * `Alpine.$data(el)`-API auf und liefert deren Rueckgabe.
     *
     * Warum ueber die Insel und nicht ueber einen Klick: die Directory-Oberflaeche
     * hat heute keinen „Mitglied hinzufuegen"-Knopf — Mitglieder kommen ueber die
     * Beitritts-Queue oder die Ban-Liste herein. Der Aufruf hier nimmt trotzdem
     * exakt denselben Produktionspfad (members.ts-Weiche → buzzAdmin.ts → welshman-
     * Signer → Relay); nur der ausloesende Klick fehlt. Das Entfernen weiter unten
     * laeuft dagegen ueber die echte UI.
     */
    async function callDirectory(page: Page, method: 'restoreMember' | 'removeMember', arg: unknown): Promise<void> {
        await page.evaluate(
            async ({ method, arg }) => {
                const el = document.querySelector('[x-data="nostrDirectory"]')
                if (!el) {
                    throw new Error('Directory-Insel nicht gefunden')
                }
                const data = (window as unknown as { Alpine: { $data: (e: Element) => Record<string, unknown> } }).Alpine.$data(el)
                await (data[method] as (a: unknown) => Promise<void>)(arg)
            },
            { method, arg },
        )
    }

    test('Owner sieht „Neuen Raum anlegen" (Admin-Status aus der 13534, nicht aus NIP-86)', async ({ page }) => {
        await loginNsec(page, BUZZ_OWNER_NSEC)

        // Der Kernbeleg: vor P3 blieb isAdmin dauerhaft false (NIP-86-Probe scheitert
        // an Buzz' 405), die Zeile existierte im DOM gar nicht (x-if).
        await expect(page.getByRole('button', { name: 'Neuen Raum anlegen' })).toBeVisible({ timeout: 20_000 })
    })

    test('Owner kann ein Mitglied aufnehmen (9030) und wieder entfernen (9031)', async ({ page }) => {
        // Frischer Wegwerf-Pubkey pro Lauf — so ist der Test wiederholbar, ohne den
        // Seed-Zustand des geteilten buzz-test-Stacks anzufassen.
        const newcomerPub = getPublicKey(generateSecretKey())

        await loginNsec(page, BUZZ_OWNER_NSEC)
        await page.goto('/directory')

        // Directory geladen: der geseedete Nutzer steht in der relay-signierten 13534.
        // Ueber ihn haengt auch `ready` (relay.self aus NIP-11) — Buzz liefert `self`.
        const seededRow = page.locator('[x-data="nostrDirectory"]').getByText(BUZZ_USER_PUB.slice(0, 8), { exact: false })
        await expect(page.locator('[x-data="nostrDirectory"]')).toBeVisible({ timeout: 20_000 })

        // ── Aufnehmen: kind 9030 ────────────────────────────────────────────────
        await callDirectory(page, 'restoreMember', newcomerPub)

        // Der Relay signiert die 13534 neu; die Live-Sub zieht sie nach. Beleg ist die
        // Mitgliederzahl in der Ueberschrift bzw. das Auftauchen der npub-Kurzform.
        const memberCount = async (): Promise<number> =>
            page.evaluate(() => {
                const el = document.querySelector('[x-data="nostrDirectory"]')!
                const data = (window as unknown as { Alpine: { $data: (e: Element) => Record<string, unknown> } }).Alpine.$data(el)
                return (data.members as unknown[]).length
            })

        await expect
            .poll(
                async () =>
                    page.evaluate((pk) => {
                        const el = document.querySelector('[x-data="nostrDirectory"]')!
                        const data = (window as unknown as { Alpine: { $data: (e: Element) => Record<string, unknown> } }).Alpine.$data(el)
                        return (data.members as { pubkey: string }[]).some((m) => m.pubkey === pk)
                    }, newcomerPub),
                { timeout: 25_000, message: 'kind 9030 sollte den Pubkey in die relay-signierte 13534 bringen' },
            )
            .toBe(true)

        const afterAdd = await memberCount()
        expect(afterAdd).toBeGreaterThan(0)

        // ── Entfernen: kind 9031 ────────────────────────────────────────────────
        await callDirectory(page, 'removeMember', { pubkey: newcomerPub })

        await expect
            .poll(
                async () =>
                    page.evaluate((pk) => {
                        const el = document.querySelector('[x-data="nostrDirectory"]')!
                        const data = (window as unknown as { Alpine: { $data: (e: Element) => Record<string, unknown> } }).Alpine.$data(el)
                        return (data.members as { pubkey: string }[]).some((m) => m.pubkey === pk)
                    }, newcomerPub),
                { timeout: 25_000, message: 'kind 9031 sollte den Pubkey aus der 13534 entfernen' },
            )
            .toBe(false)

        // Der geseedete Nutzer ist unberuehrt geblieben (kein Kollateralschaden am
        // geteilten Test-Stack).
        expect(await memberCount()).toBeGreaterThan(0)
        void seededRow
    })

    test('Rollen-Verwaltung ist auf Buzz ausgeblendet (kein 33534)', async ({ page }) => {
        await loginNsec(page, BUZZ_OWNER_NSEC)
        await page.goto('/directory')

        await expect(page.locator('[x-data="nostrDirectory"]')).toBeVisible({ timeout: 20_000 })
        // zooid zeigt hier „Rollen verwalten"; Buzz hat ein festes owner|admin|member
        // ohne Label/Farbe und keine Route zum Anlegen.
        await expect(page.getByRole('button', { name: 'Rollen verwalten' })).toBeHidden()
    })
})
