import { test, expect } from './support/fixtures'
import { useBuzz, BUZZ_USER_NSEC, BUZZ_OWNER_SEC_HEX, BUZZ_ROOM_WELCOME, BUZZ_PORT } from './support/buzz'
import { loginNsec } from './support/login'
import { spawnSync } from 'node:child_process'

/** Pfad zum `nak`-Binary (wie in den Seed-Skripten und buzz-admin.spec.ts). */
const NAK = process.env.NAK ?? `${process.env.HOME}/go/bin/nak`
const WS = () => `ws://localhost:${BUZZ_PORT}`

/**
 * Publiziert ein kind-9 mit den übergebenen `-t`-Tags und gibt zurück, was das Relay
 * geantwortet hat. `accepted` liest das `OK`-Ergebnis: nak schreibt bei Ablehnung
 * `failed: msg: <grund>` auf stderr/stdout und liefert keinen Erfolg.
 *
 * Absichtlich KEIN throw bei Ablehnung — die Ablehnung ist hier teils das erwartete
 * Ergebnis (siehe die Fallen-Prüfung unten).
 */
function publish(tags: string[], content: string): { accepted: boolean; detail: string; id: string } {
    const args = ['event', '--auth', '--sec', BUZZ_OWNER_SEC_HEX, '-k', '9', '-t', `h=${BUZZ_ROOM_WELCOME}`]
    for (const t of tags) {
        args.push('-t', t)
    }
    args.push('-c', content, WS())
    // `spawnSync` statt `execFileSync`: nak schreibt den Publish-Status („success" bzw.
    // „failed: msg: …") auf **stderr**, das Event-JSON auf stdout. Wer nur stdout liest,
    // sieht jede Ablehnung als leeres Ergebnis — und einen erfolgreichen Publish auch.
    const res = spawnSync(NAK, args, { encoding: 'utf8', timeout: 30_000 })
    const out = `${res.stdout ?? ''}\n${res.stderr ?? ''}`
    const id = /"id":"([0-9a-f]{64})"/.exec(out)?.[1] ?? ''
    const failed = /failed: ?(?:msg: ?)?(.*)/.exec(out)?.[1]?.trim() ?? ''
    return { accepted: out.includes('success') && !failed, detail: failed || out.trim(), id }
}

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

    /**
     * **Die Threading-Regeln am echten Relay** — der Gegenpart zu den Client-Prüfungen in
     * `room.spec.ts` (die laufen gegen zooid und belegen, welche Tags der Client ERZEUGT;
     * hier steht, was Buzz damit MACHT).
     *
     * Der wichtigste Satz steht in Schritt 4: **die `root`-only-Form wird angenommen.** Es
     * gibt kein Relay, das den Client vor diesem Fehler bewahrt — kein Reject, kein NOTICE,
     * nur eine Antwort, die niemand je wiederfindet. Genau deshalb ist die Client-Garantie
     * („erzeugt nie `root` ohne `reply`", `js/threading.ts` + `js/threading.test.ts`) die
     * EINZIGE Absicherung, und deshalb steht sie hier als Testfall und nicht als Kommentar.
     *
     * Bewusst ohne Browser: geprüft wird die Relay-Semantik, nicht die Oberfläche. Das macht
     * den Fall schnell und frei von Render-/Live-Sub-Timing.
     */
    test('Threading-Regeln am Relay: reply/root+reply akzeptiert, Verstöße abgelehnt — root-only NICHT', () => {
        const stamp = Math.floor(Math.random() * 1e9)

        // 1) Wurzel.
        const root = publish([], `THREADSPEC-ROOT-${stamp}`)
        expect(root.accepted, `Wurzel abgelehnt: ${root.detail}`).toBe(true)

        // 2) Tiefe 1 — EIN `reply`-Marker. Genau das schreibt der Client.
        const r1 = publish([`e=${root.id};;reply`], `THREADSPEC-R1-${stamp}`)
        expect(r1.accepted, `Antwort auf die Wurzel abgelehnt: ${r1.detail}`).toBe(true)

        // 3) Tiefe 2 — `root` UND `reply`.
        const r2 = publish([`e=${root.id};;root`, `e=${r1.id};;reply`], `THREADSPEC-R2-${stamp}`)
        expect(r2.accepted, `Verschachtelte Antwort abgelehnt: ${r2.detail}`).toBe(true)

        // 4) DIE FALLE: die NIP-10-konforme `root`-only-Form. Buzz nimmt sie an und
        //    verknüpft sie NICHT — kein Fehler, kein Hinweis, nichts. Hier steht sie als
        //    Tatsache fest, damit niemand sie später für „auch erlaubt" hält.
        const trap = publish([`e=${root.id};;root`], `THREADSPEC-TRAP-${stamp}`)
        expect(trap.accepted, 'root-only wird von Buzz ANGENOMMEN — das Relay ist kein Netz').toBe(true)

        // 5) Tiefe 2 OHNE `root`-Tag → harte Ablehnung. Der Beleg, dass Regel 2 keine
        //    Stilfrage ist: liefe der Client hier falsch, verschwände die Antwort mit
        //    einer Fehlermeldung, die der Nutzer nicht einordnen kann.
        const missingRoot = publish([`e=${r1.id};;reply`], `THREADSPEC-NOROOT-${stamp}`)
        expect(missingRoot.accepted).toBe(false)
        expect(missingRoot.detail).toContain('root tag does not match thread ancestry')

        // 6) Antwort auf ein Parent, das das Relay nicht kennt → Ablehnung. Deshalb wartet
        //    `sendThreadReply` auf die Bestätigung der Wurzel, bevor die Antwort rausgeht.
        const orphan = publish([`e=${'1'.repeat(64)};;reply`], `THREADSPEC-ORPHAN-${stamp}`)
        expect(orphan.accepted).toBe(false)
        expect(orphan.detail).toContain('reply parent not found')
    })
})
