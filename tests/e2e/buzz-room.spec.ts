import { test, expect } from './support/fixtures'
import { useBuzz, BUZZ_USER_NSEC, BUZZ_ROOM_WELCOME } from './support/buzz'
import { loginNsec } from './support/login'

/**
 * P1 (Buzz-Migrationsplan, docs/plans/2026-07-28T1542-buzz-relay-migration.md) — das
 * Buzz-Pendant zu den zooid-E2E-Specs. Läuft NUR mit `E2E_RELAY=buzz` (siehe
 * playwright.config.ts + support/global-setup.ts, das dann den isolierten
 * buzz-test-Docker-Stack statt zooid aufsetzt/seedet). Im Default-Modus (zooid,
 * unverändert) wird diese Datei übersprungen — kein Einfluss auf die bestehende Suite.
 */
test.describe('Buzz-Relay (E2E, nur E2E_RELAY=buzz)', () => {
    test.skip(process.env.E2E_RELAY !== 'buzz', 'nur im Buzz-Modus (E2E_RELAY=buzz) relevant')

    test.beforeEach(async ({ page }) => {
        await useBuzz(page)
    })

    test('Login + Raumliste + Chat lesen/schreiben gegen den Buzz-Test-Stack', async ({ page }) => {
        await loginNsec(page, BUZZ_USER_NSEC)

        // Raumliste (39000, historisches REQ mit EOSE — Buzz pusht 39000 nicht live,
        // aber der Erstladefall ist ein normales REQ, siehe Plan „Belegte Ausgangslage").
        await expect(page.getByText('E2E-Welcome')).toBeVisible({ timeout: 15_000 })

        await page.goto(`/rooms/${BUZZ_ROOM_WELCOME}`)

        // Seed-Nachrichten (kind 9, buzz-testserver.sh) lesbar.
        await expect(page.getByText('Hallo aus dem Testraum! 👋')).toBeVisible({ timeout: 15_000 })
        await expect(page.getByText('Antwort vom Owner')).toBeVisible()

        // Fund gegenüber zooid: Relay-Mitgliedschaft (kind 9030) reicht bei einem
        // `visibility=open`-Channel zum LESEN, aber die Insel blendet die Eingabe erst
        // nach explizitem Channel-Join (kind 9021) ein ("Tritt dem Raum bei, um
        // mitzuschreiben."). Idempotent beitreten: schon Mitglied (Re-Run) → kein
        // Beitreten-Button mehr, direkt zur Eingabe.
        const joinButton = page.getByRole('button', { name: 'Beitreten' })
        if (await joinButton.isVisible({ timeout: 3_000 }).catch(() => false)) {
            await joinButton.click()
        }

        // Senden + Live-Empfang (kind 9 → OK true → Rendering, wie im P1-Smoke-Test belegt).
        const marker = `Buzz-E2E-${Math.floor(Math.random() * 1e9)}`
        const input = page.getByRole('textbox').first()
        try {
            await input.waitFor({ state: 'visible', timeout: 15_000 })
        } catch {
            // Der Join (9021) selbst kam serverseitig durch (per nak-Gegenprobe belegt,
            // 39002 listet den User bereits als member) — die Live-Sub der 39002 nach
            // dem Join braucht offenbar länger als 15s. Ein Reload liest den Zustand neu
            // vom Relay statt auf die Live-Sub zu warten.
            await page.reload()
            await input.waitFor({ state: 'visible', timeout: 15_000 })
        }
        await input.fill(marker)
        await page.keyboard.press('Enter')
        await expect(page.getByText(marker)).toBeVisible({ timeout: 10_000 })
    })
})
