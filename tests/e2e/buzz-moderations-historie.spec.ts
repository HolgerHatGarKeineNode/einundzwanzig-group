import { test, expect, type Page } from './support/fixtures'
import { useBuzz, BUZZ_OWNER_NSEC, BUZZ_OWNER_SEC_HEX, BUZZ_USER_NSEC, BUZZ_PORT } from './support/buzz'
import { waitForAction } from './support/buzz-moderation'
import { loginNsec } from './support/login'
import { spawnSync } from 'node:child_process'
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'

const NAK = process.env.NAK ?? `${process.env.HOME}/go/bin/nak`
const WS = (): string => `ws://localhost:${BUZZ_PORT}`

const nak = (args: string[]): string => {
    const res = spawnSync(NAK, args, { encoding: 'utf8', timeout: 30_000 })

    return `${res.stdout ?? ''}\n${res.stderr ?? ''}`
}

/**
 * Ein frischer Wegwerf-Schlüssel MIT Relay-Mitgliedschaft (kind 9030) — dieselbe Mechanik
 * und derselbe Grund wie in `buzz-timeout.spec.ts`: dieser Test SPERRT jemanden, und eine
 * Sperre auf dem geteilten Testnutzer bliebe in `community_bans` stehen und nähme jedem
 * nachfolgenden Spec das Schreibrecht.
 */
const freshRelayMember = (): string => {
    const pub = getPublicKey(generateSecretKey())
    expect(
        nak(['event', '--auth', '--sec', BUZZ_OWNER_SEC_HEX, '-k', '9030', '-t', `p=${pub}`, '-t', 'role=member', WS()]),
        'Relay-Mitgliedschaft für den Wegwerf-Schlüssel konnte nicht gesetzt werden',
    ).toContain('success')

    return pub
}

/**
 * P1 (Community-Features Herbst) — **die Moderations-Historie: `GET /moderation/audit`,
 * vom Client abgerufen und im Dialog nach Tagen gruppiert.**
 *
 * ── Was hier belegt wird, und womit ────────────────────────────────────────
 *
 * 1. Der **Client** ruft die Route auf — nicht nur das Messgerät. Gemessen wird die
 *    Antwort des Browsers selbst (`page.on('response')`), nicht ein DOM-Zustand, der auch
 *    aus einem Cache stammen könnte. Bis zu dieser Phase war der einzige Aufrufer im
 *    ganzen Repo `tests/e2e/support/buzz-moderation.ts`.
 * 2. Eine ausgeführte Maßnahme ist **nachlesbar**: 9042/9043 werden vom Relay ausgeführt
 *    und weder gespeichert noch gefanoutet (`nak req -k 9042` findet strukturell nichts),
 *    die Audit-Zeile ist der einzige Beleg. Zwei Befehle → zwei Zeilen unter EINER
 *    Tagesüberschrift; das ist die Gruppierung, nicht nur ihre Existenz.
 * 3. **Ohne Moderationsrechte: 403, und die Fläche bleibt leer** — kein Fehlerzustand,
 *    kein Toast. Der Statuscode wird mitgemessen, sonst wäre „nichts zu sehen" auch dann
 *    grün, wenn gar nichts abgerufen wurde.
 * 4. **Geometrie bei 375 px und 1280 px** — echte Zahlen (Breite/Höhe/Position/Überlauf),
 *    keine Klassen-Assertion.
 *
 * Läuft NUR mit `E2E_RELAY=buzz` (isolierter buzz-test-Stack); zooid hat diese Route
 * nicht, und der Client fragt sie dort auch nicht (`spaceIsBuzzAsync` davor).
 */
test.describe('Moderations-Historie (E2E, nur E2E_RELAY=buzz)', () => {
    test.skip(process.env.E2E_RELAY !== 'buzz', 'nur im Buzz-Modus (E2E_RELAY=buzz) relevant')

    test.beforeEach(async ({ page }) => {
        await useBuzz(page)
    })

    /** Statuscodes, mit denen der Browser auf `/moderation/audit` geantwortet bekommen hat. */
    const auditStatuses = (page: Page): number[] => {
        const seen: number[] = []
        page.on('response', (res) => {
            if (res.url().includes('/moderation/audit')) {
                seen.push(res.status())
            }
        })

        return seen
    }

    test('Moderator: zwei Maßnahmen unter einer Tagesüberschrift — gemessen bei 375 und 1280 px', async ({ page }) => {
        test.setTimeout(180_000)

        const victim = freshRelayMember()
        const reason = `E2E-Historie-${Math.floor(Math.random() * 1e9)}`
        const statuses = auditStatuses(page)

        // ── Zwei Audit-Zeilen erzeugen: sperren (9042) und wieder freigeben (9043).
        // Über `nak` und nicht über die Oberfläche — der Prüfgegenstand ist das LESEN.
        // Buzz nimmt Moderationsbefehle nur innerhalb von ±120 s an, also wird die
        // `expiration` erst hier gerechnet.
        const expiration = Math.floor(Date.now() / 1000) + 3600
        nak([
            'event', '--auth', '--sec', BUZZ_OWNER_SEC_HEX, '-k', '9042',
            '-t', `p=${victim}`, '-t', `expiration=${expiration}`, '-t', `reason=${reason}`, WS(),
        ])
        // Requery statt Vertrauen auf die `nak`-Ausgabe: sie druckt auch bei Ablehnung das
        // signierte Event und endet mit 0.
        await waitForAction('timeout', victim)
        nak(['event', '--auth', '--sec', BUZZ_OWNER_SEC_HEX, '-k', '9043', '-t', `p=${victim}`, WS()])
        await waitForAction('untimeout', victim)

        await loginNsec(page, BUZZ_OWNER_NSEC)
        await page.goto('/directory')
        await expect(page.locator('[x-data="nostrDirectory"]')).toBeVisible({ timeout: 20_000 })

        await page.getByRole('button', { name: /Meldungen/ }).click()
        const modal = page.locator('dialog[data-modal="action-items"]')
        await expect(modal).toBeVisible({ timeout: 10_000 })

        const historie = modal.locator('[x-data="nostrModerationAudit"]')
        await expect(historie.getByText('Moderations-Verlauf')).toBeVisible({ timeout: 20_000 })

        // ── 1. Der Client hat die Route wirklich gefragt, und sie hat geantwortet.
        expect(statuses, 'der Client hat `/moderation/audit` nicht abgerufen').toContain(200)

        // ── 2. Zwei Maßnahmen, EINE Tagesüberschrift.
        await expect(historie.getByText('Heute', { exact: true })).toHaveCount(1)
        const gesperrt = historie.locator('.surface-card', { hasText: reason })
        await expect(gesperrt).toHaveCount(1, { timeout: 20_000 })
        await expect(gesperrt.getByText('Befristet gesperrt')).toBeVisible()
        await expect(historie.getByText('Sperre aufgehoben')).toBeVisible()

        // ── 3. Geometrie, bei beiden Breiten.
        const bericht: string[] = []
        for (const width of [375, 1280]) {
            await page.setViewportSize({ width, height: 800 })
            // Ein Frame abwarten, sonst misst man das Layout VOR dem Reflow.
            await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))))

            const doc = await page.evaluate(() => ({
                scrollWidth: document.documentElement.scrollWidth,
                clientWidth: document.documentElement.clientWidth,
            }))
            const dialog = await modal.evaluate((el) => ({
                scrollWidth: el.scrollWidth,
                clientWidth: el.clientWidth,
                right: el.getBoundingClientRect().right,
            }))
            const box = (await historie.boundingBox()) as { x: number; y: number; width: number; height: number }
            const zeile = (await gesperrt.boundingBox()) as { x: number; y: number; width: number; height: number }

            bericht.push(
                `${width}px | Dokument scrollWidth=${doc.scrollWidth} clientWidth=${doc.clientWidth}`
                    + ` | Dialog scrollWidth=${dialog.scrollWidth} clientWidth=${dialog.clientWidth} right=${Math.round(dialog.right)}`
                    + ` | Historie x=${Math.round(box.x)} y=${Math.round(box.y)} ${Math.round(box.width)}×${Math.round(box.height)}`
                    + ` | Zeile x=${Math.round(zeile.x)} ${Math.round(zeile.width)}×${Math.round(zeile.height)}`,
            )

            expect(doc.scrollWidth, `${width}px: das Dokument läuft waagerecht über`).toBeLessThanOrEqual(doc.clientWidth)
            expect(dialog.scrollWidth, `${width}px: der Dialog läuft waagerecht über`).toBeLessThanOrEqual(dialog.clientWidth)
            expect(box.width, `${width}px: die Historie hat keine Breite`).toBeGreaterThan(0)
            expect(box.height, `${width}px: die Historie hat keine Höhe`).toBeGreaterThan(0)
            expect(
                Math.round(zeile.x + zeile.width),
                `${width}px: eine Historien-Zeile ragt rechts aus dem Dialog`,
            ).toBeLessThanOrEqual(Math.round(dialog.right) + 1)
        }
        console.log(`\n[moderations-historie] Geometrie\n${bericht.join('\n')}`)
    })

    test('ohne Moderationsrechte: 403, keine Historie, kein Fehlerzustand', async ({ page }) => {
        test.setTimeout(120_000)

        const statuses = auditStatuses(page)

        await loginNsec(page, BUZZ_USER_NSEC)
        await page.goto('/directory')
        await expect(page.locator('[x-data="nostrDirectory"]')).toBeVisible({ timeout: 20_000 })

        // Der Auslöser steht hinter `x-show="isAdmin"` — ein Nicht-Moderator kommt an den
        // Dialog gar nicht heran. Die Insel ist trotzdem montiert (der Dialog liegt im
        // DOM), also wird ihr Ladepfad direkt gefahren: gemessen werden soll, was der
        // Client mit einem 403 MACHT, nicht ob er den Knopf sieht.
        const ergebnis = await page.evaluate(async () => {
            const el = document.querySelector('[x-data="nostrModerationAudit"]')
            if (!el) {
                return { montiert: false, tage: -1, toasts: -1, text: '' }
            }
            let toasts = 0
            const zaehler = (): void => {
                toasts += 1
            }
            document.addEventListener('toast-show', zaehler)
            const alpine = (window as unknown as { Alpine: { $data: (e: Element) => Record<string, unknown> } }).Alpine
            const data = alpine.$data(el) as { days: unknown[]; load: () => Promise<void> }
            await data.load()
            document.removeEventListener('toast-show', zaehler)

            return { montiert: true, tage: data.days.length, toasts, text: (el as HTMLElement).innerText.trim() }
        })

        expect(ergebnis.montiert, 'die Historien-Insel ist gar nicht montiert').toBe(true)
        expect(statuses, 'der Client hat `/moderation/audit` nicht abgerufen').toContain(403)
        expect(statuses, 'ein 403 darf keinen Wiederholungssturm auslösen').toHaveLength(1)
        expect(ergebnis.tage, 'ohne Moderationsrechte darf keine Historie entstehen').toBe(0)
        expect(ergebnis.toasts, 'ein 403 ist eine Antwort — er darf keinen Fehler-Toast auslösen').toBe(0)
        expect(ergebnis.text, 'die Fläche zeigt Text, obwohl es nichts zu zeigen gibt').toBe('')
        console.log(`\n[moderations-historie] 403: Status=${statuses.join(',')} Tage=${ergebnis.tage} Toasts=${ergebnis.toasts}`)
    })
})
