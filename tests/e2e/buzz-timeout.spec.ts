import { test, expect } from './support/fixtures'
import { useBuzz, BUZZ_OWNER_NSEC, BUZZ_OWNER_SEC_HEX, BUZZ_PORT } from './support/buzz'
import { fetchRestricted, waitForAction } from './support/buzz-moderation'
import { loginNsec } from './support/login'
import { spawnSync } from 'node:child_process'
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { npubEncode } from 'nostr-tools/nip19'

const NAK = process.env.NAK ?? `${process.env.HOME}/go/bin/nak`
const WS = (): string => `ws://localhost:${BUZZ_PORT}`

const nak = (args: string[]): string => {
    const res = spawnSync(NAK, args, { encoding: 'utf8', timeout: 30_000 })

    return `${res.stdout ?? ''}\n${res.stderr ?? ''}`
}

/**
 * Ein frischer Wegwerf-Schlüssel MIT Relay-Mitgliedschaft (kind 9030).
 *
 * Frisch und nicht der geseedete `BUZZ_USER`, weil dieser Test eine **Sperre** setzt:
 * eine Sperre auf den geteilten Testnutzer bliebe in `community_bans` stehen und nähme
 * jedem nachfolgenden Spec das Schreibrecht — ein Fehlschlag mit einer Ursache, die mit
 * dem geprüften Gegenstand nichts zu tun hat. Dieselbe Mechanik wie `freshRelayMember()`
 * in `buzz-forum.spec.ts`.
 */
const freshRelayMember = (): { pub: string; npub: string } => {
    const pub = getPublicKey(generateSecretKey())
    expect(
        nak(['event', '--auth', '--sec', BUZZ_OWNER_SEC_HEX, '-k', '9030', '-t', `p=${pub}`, '-t', 'role=member', WS()]),
        'Relay-Mitgliedschaft für den Wegwerf-Schlüssel konnte nicht gesetzt werden',
    ).toContain('success')

    return { pub, npub: npubEncode(pub) }
}

/** Sekunden seit Epoch aus einem RFC-3339-Zeitstempel des Relays. */
const unix = (rfc3339: string): number => Math.floor(Date.parse(rfc3339) / 1000)

/**
 * P4 (Ernte der ungenutzten Buzz-Kinds) — **befristete Sperre (9042) und ihre Aufhebung
 * (9043)**, die einzige Maßnahme gegen eine Person, die diese Oberfläche noch anbietet.
 *
 * ── Was hier belegt wird, und womit ────────────────────────────────────────
 *
 * 1. Der **Rückbau** ist im Browser sichtbar: das Mitglieder-Menü bietet „Befristet
 *    sperren" an und weder „Entfernen" noch „Bannen".
 * 2. Die **Dauer ist wählbar** — das Auswahlfeld wird bedient, und die gesetzte
 *    `muted_until` am Relay entspricht der gewählten Dauer.
 * 3. Die Sperre **wirkt**, und der Nachweis kommt NICHT aus dem Client: 9042–9044 werden
 *    vom Relay ausgeführt und weder gespeichert noch gefanoutet (ein `nak req -k 9042`
 *    findet strukturell nichts), also wird `GET /moderation/audit` und
 *    `/moderation/restricted` gelesen — über das **unabhängige** NIP-98-Messgerät aus
 *    `support/buzz-moderation.ts`, nicht über `js/nip98.ts`. Eine Messung, die dieselbe
 *    Implementierung benutzt wie das Messobjekt, belegt nichts.
 * 4. Die Sperre ist **aufhebbar** (9043), und danach ist die Zeile aus der Sperrliste weg.
 *
 * Läuft NUR mit `E2E_RELAY=buzz` (isolierter buzz-test-Stack).
 */
test.describe('Buzz-Timeout (E2E, nur E2E_RELAY=buzz)', () => {
    test.skip(process.env.E2E_RELAY !== 'buzz', 'nur im Buzz-Modus (E2E_RELAY=buzz) relevant')

    test.beforeEach(async ({ page }) => {
        await useBuzz(page)
    })

    test('sperren → Audit + Sperrliste → aufheben, und das Menü bietet kein Entfernen/Bannen', async ({ page }) => {
        test.setTimeout(150_000)

        const victim = freshRelayMember()
        const reason = `E2E-Timeout-${Math.floor(Math.random() * 1e9)}`

        await loginNsec(page, BUZZ_OWNER_NSEC)
        await page.goto('/directory')
        const island = page.locator('[x-data="nostrDirectory"]')
        await expect(island).toBeVisible({ timeout: 20_000 })

        // Der Wegwerf-Pubkey muss erst in der relay-signierten 13534 ankommen.
        await expect
            .poll(
                async () =>
                    page.evaluate((pk) => {
                        const el = document.querySelector('[x-data="nostrDirectory"]')!
                        const data = (window as unknown as { Alpine: { $data: (e: Element) => Record<string, unknown> } }).Alpine.$data(el)
                        return (data.members as { pubkey: string }[]).some((m) => m.pubkey === pk)
                    }, victim.pub),
                { timeout: 25_000, message: 'kind 9030 sollte den Wegwerf-Pubkey in die 13534 bringen' },
            )
            .toBe(true)

        // Auf genau diese eine Zeile filtern — sonst trifft „das erste Menü" ein fremdes
        // Mitglied, und der Test spräche über jemand anderen.
        await island.getByPlaceholder('Mitglied suchen…').fill(victim.npub.slice(0, 16))
        const rowMenu = island.getByRole('button', { name: 'Mitglied verwalten' })
        await expect(rowMenu).toHaveCount(1, { timeout: 15_000 })
        await rowMenu.click()

        // ── 1. Der Rückbau, im Browser ─────────────────────────────────────────
        // Der Verein entfernt und bannt keine Mitglieder (Entscheidung 2026-09-03).
        await expect(page.getByRole('menuitem', { name: 'Befristet sperren' })).toBeVisible({ timeout: 10_000 })
        await expect(page.getByRole('menuitem', { name: 'Entfernen', exact: true })).toHaveCount(0)
        await expect(page.getByRole('menuitem', { name: 'Bannen', exact: true })).toHaveCount(0)

        // ── 2. Die Dauer ist wählbar ───────────────────────────────────────────
        await page.getByRole('menuitem', { name: 'Befristet sperren' }).click()
        const dialog = page.locator('dialog[data-modal="member-timeout"]')
        await expect(dialog).toBeVisible({ timeout: 10_000 })
        await dialog.getByLabel('Dauer').selectOption('3600')
        await dialog.getByLabel('Grund (optional)').fill(reason)

        const sentAt = Math.floor(Date.now() / 1000)
        await dialog.getByRole('button', { name: 'Sperren' }).click()

        // ── 3. Gegenprobe am Relay, unabhängig vom Client ──────────────────────
        const action = await waitForAction('timeout', victim.pub)
        expect(action.public_reason, 'der Grund wird mitgeschickt und dem Mitglied zugestellt').toBe(reason)

        let restricted = await fetchRestricted()
        let row = restricted.find((r) => r.pubkey === victim.pub)
        expect(row, 'die Sperre muss in `/moderation/restricted` stehen').toBeDefined()
        expect(row!.banned, 'ein Timeout ist KEIN Bann — sonst hätte die Oberfläche gebannt').toBe(false)
        expect(row!.muted_until, 'ohne `expiration` wäre die Sperre gar nicht erst gebaut worden').not.toBeNull()
        expect(row!.mute_reason).toBe(reason)

        // Die gewählte Stunde, nicht irgendeine Dauer. ±120 s ist das Frischefenster des
        // Relays selbst (`MAX_COMMAND_SKEW_SECS`), also die engste ehrliche Toleranz.
        const dauer = unix(row!.muted_until!) - sentAt
        expect(dauer, `muted_until liegt ${dauer}s in der Zukunft, erwartet ~3600s`).toBeGreaterThan(3600 - 120)
        expect(dauer).toBeLessThan(3600 + 120)

        // ── 4. Aufheben (9043) ─────────────────────────────────────────────────
        await page.getByRole('button', { name: 'Gesperrt' }).click()
        const list = page.locator('dialog[data-modal="banned"]')
        await expect(list).toBeVisible({ timeout: 10_000 })
        await expect(list.getByText(reason)).toBeVisible({ timeout: 15_000 })
        await list.getByRole('button', { name: 'Sperre aufheben' }).first().click()

        await waitForAction('untimeout', victim.pub)
        await expect
            .poll(
                async () => (await fetchRestricted()).some((r) => r.pubkey === victim.pub),
                { timeout: 30_000, message: 'kind 9043 muss die Sperre aus `/moderation/restricted` nehmen' },
            )
            .toBe(false)

        // Und die Gegenprobe im selben Lesevorgang: die Abfrage funktioniert noch. Eine
        // kaputte Auth lieferte sonst „nicht enthalten" und der Fall wäre trivial grün —
        // `fetchRestricted` wirft dann allerdings, das ist der eigentliche Schutz.
        restricted = await fetchRestricted()
        expect(Array.isArray(restricted)).toBe(true)
    })

    /**
     * Sichtbare Fläche ist erst fertig, wenn sie GEMESSEN wurde (Nutzeransage
     * 2026-09-03): echte Zahlen, zwei Viewports. Gemessen wird der Bediendialog — die
     * einzige neue Fläche dieser Phase.
     */
    test('Layout: der Sperr-Dialog passt in schmal und Desktop — echte Zahlen', async ({ page }) => {
        test.setTimeout(120_000)

        const victim = freshRelayMember()
        await loginNsec(page, BUZZ_OWNER_NSEC)

        for (const viewport of [
            { name: 'schmal', width: 390, height: 844 },
            { name: 'desktop', width: 1440, height: 900 },
        ]) {
            await page.setViewportSize({ width: viewport.width, height: viewport.height })
            await page.goto('/directory')
            const island = page.locator('[x-data="nostrDirectory"]')
            await expect(island).toBeVisible({ timeout: 20_000 })

            // Den Dialog über die Insel öffnen: gemessen wird das LAYOUT, nicht der Weg
            // dorthin — der steht im Fall darüber.
            await expect
                .poll(
                    async () =>
                        page.evaluate((pk) => {
                            const el = document.querySelector('[x-data="nostrDirectory"]')!
                            const data = (window as unknown as { Alpine: { $data: (e: Element) => Record<string, unknown> } }).Alpine.$data(el)
                            const m = (data.members as { pubkey: string }[]).find((x) => x.pubkey === pk)
                            if (!m) {
                                return false
                            }
                            ;(data.openTimeout as (m: unknown) => void)(m)
                            return true
                        }, victim.pub),
                    { timeout: 25_000, message: 'der Wegwerf-Pubkey muss in der Mitgliederliste stehen' },
                )
                .toBe(true)

            const dialog = page.locator('dialog[data-modal="member-timeout"]')
            await expect(dialog).toBeVisible({ timeout: 10_000 })

            const box = await dialog.boundingBox()
            expect(box, `${viewport.name}: der Dialog hat keine Box`).not.toBeNull()
            expect(
                box!.width,
                `${viewport.name}: Dialog ${Math.round(box!.width)}px breit bei ${viewport.width}px Viewport`,
            ).toBeLessThanOrEqual(viewport.width)
            expect(box!.x, `${viewport.name}: Dialog ragt links heraus (x=${Math.round(box!.x)})`).toBeGreaterThanOrEqual(0)

            // Kein waagerechter Überlauf im Dialog selbst — der Fall, der auf 390px
            // zuschlägt und auf 1440px nie auffällt.
            const overflow = await dialog.evaluate((el) => el.scrollWidth - el.clientWidth)
            expect(overflow, `${viewport.name}: ${overflow}px waagerechter Überlauf im Dialog`).toBeLessThanOrEqual(1)

            // Das Auswahlfeld und der auslösende Knopf liegen INNERHALB des Dialogs.
            const select = await dialog.getByLabel('Dauer').boundingBox()
            const submit = await dialog.getByRole('button', { name: 'Sperren' }).boundingBox()
            for (const [label, part] of [['Dauer-Auswahl', select], ['Sperren-Knopf', submit]] as const) {
                expect(part, `${viewport.name}: ${label} nicht sichtbar`).not.toBeNull()
                expect(
                    part!.x + part!.width,
                    `${viewport.name}: ${label} endet bei ${Math.round(part!.x + part!.width)}px, Dialog bei ${Math.round(box!.x + box!.width)}px`,
                ).toBeLessThanOrEqual(box!.x + box!.width + 1)
            }
        }
    })
})
