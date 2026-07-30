import { test, expect } from './support/fixtures'
import { useBuzz, BUZZ_OWNER_NSEC, BUZZ_OWNER_SEC_HEX, BUZZ_USER_NSEC, BUZZ_ROOM_WELCOME, BUZZ_PORT } from './support/buzz'
import { fetchReports, waitForReport } from './support/buzz-moderation'
import { loginNsec } from './support/login'
import { execFileSync } from 'node:child_process'

const NAK = process.env.NAK ?? `${process.env.HOME}/go/bin/nak`
const WS = () => `ws://localhost:${BUZZ_PORT}`

/**
 * Schreibt eine kind-9-Nachricht als **Nicht-Admin-Mitglied** in den Welcome-Raum
 * und liefert ihre Event-id vom Relay (nicht aus dem Markup).
 *
 * Der Autor ist bewusst der geseedete User, nicht der Owner: gemeldet wird ein
 * FREMDER Inhalt, so wie im echten Ablauf.
 *
 * Buzz bestätigt das Event, bevor ein frischer REQ es sieht — deshalb wiederholte
 * Lesezugriffe mit Pause statt einer Momentaufnahme.
 */
function seedMessage(content: string): string {
    execFileSync(NAK, ['event', '--auth', '--sec', BUZZ_USER_NSEC, '-k', '9', '-t', `h=${BUZZ_ROOM_WELCOME}`, '-c', content, WS()], {
        encoding: 'utf8',
        timeout: 30_000,
    })
    for (let attempt = 0; attempt < 12; attempt++) {
        const hit = relayEvents().find((e) => e.content === content)
        if (hit) {
            return hit.id
        }
        execFileSync('sleep', ['0.3'])
    }
    throw new Error(`Seed-Nachricht ${content} kam nicht am Relay an`)
}

/**
 * Alle kind-9-Inhalte des Welcome-Raums, authentifiziert als Owner direkt vom
 * Relay gelesen. Wirft, wenn die Abfrage sechsmal nichts liefert: der Welcome-Raum
 * ist immer geseedet, „leer" heißt hier „Abfrage kaputt". Sonst wäre die
 * `not.toContain`-Assertion unten trivial grün.
 */
function relayEvents(): { id: string; content: string }[] {
    for (let attempt = 0; attempt < 6; attempt++) {
        const rows = readRelayEvents()
        if (rows.length > 0) {
            return rows
        }
        execFileSync('sleep', ['0.5'])
    }
    throw new Error(`Relay-Abfrage lieferte sechsmal nichts für Raum ${BUZZ_ROOM_WELCOME} — die Abfrage ist kaputt, nicht der Raum.`)
}

function readRelayEvents(): { id: string; content: string }[] {
    const out = execFileSync(NAK, ['req', '-k', '9', '-t', `h=${BUZZ_ROOM_WELCOME}`, '--auth', '--sec', BUZZ_OWNER_SEC_HEX, WS()], {
        encoding: 'utf8',
        timeout: 20_000,
    })
    return out
        .split('\n')
        .filter(Boolean)
        .flatMap((line) => {
            try {
                const e = JSON.parse(line) as { id?: string; content?: string }
                return e.id ? [{ id: e.id, content: String(e.content ?? '') }] : []
            } catch {
                return []
            }
        })
}

/**
 * P5 (Buzz-Migrationsplan) — die Melde-/Moderations-Queue auf Buzz' **nativer**
 * Moderations-API.
 *
 * **Warum das ein eigenes Spec ist:** Buzz speichert kind 1984 nicht als Event.
 * Der Ingest schreibt den Report nach `moderation_reports` und kehrt VOR der
 * Speicherung zurück (`handlers/ingest.rs:1600-1608`) — `nak req -k 1984` liefert
 * dort 0 Treffer. Die alte Queue war ein REQ auf kind 1984 und blieb deshalb auf
 * Buzz strukturell leer, egal wie viele Meldungen eingingen.
 *
 * Belegt wird die ganze Kette:
 *   1. Melden über die Client-Insel (kind 1984, welshman-Signer)
 *   2. Queue liest `GET /moderation/reports` mit NIP-98-Header (kind 27235)
 *   3. „Inhalt entfernen" → kind 9005 (mit `h` aus `channel_id`) + kind 9044
 *   4. Gegenprobe direkt am Relay: Nachricht weg, Report auf `resolved`
 *
 * Läuft NUR mit `E2E_RELAY=buzz` (isolierter buzz-test-Stack auf :3001).
 */
test.describe('Buzz-Melde-Queue (E2E, nur E2E_RELAY=buzz)', () => {
    test.skip(process.env.E2E_RELAY !== 'buzz', 'nur im Buzz-Modus (E2E_RELAY=buzz) relevant')

    test.beforeEach(async ({ page }) => {
        await useBuzz(page)
    })

    test('melden → Queue → Inhalt entfernen → Nachricht weg und Report resolved', async ({ page }) => {
        // Login, Raum, Melden, Directory, Löschung, zwei Relay-Gegenproben.
        test.setTimeout(150_000)

        const marker = `P5-Meldeziel-${Math.floor(Math.random() * 1e9)}`
        const keeper = `P5-Bleibt-${Math.floor(Math.random() * 1e9)}`
        const targetId = seedMessage(marker)
        seedMessage(keeper)
        expect(targetId).toMatch(/^[0-9a-f]{64}$/)


        await loginNsec(page, BUZZ_OWNER_NSEC)

        // ── 1. Melden über die Raum-Insel ───────────────────────────────────────
        // Derselbe Produktionspfad wie der Menüeintrag „Fork off!" (askReport →
        // confirmReport → sendReport → kind 1984); nur das Popover-Geklicke fehlt.
        await page.goto(`/rooms/${BUZZ_ROOM_WELCOME}`)
        await expect(page.getByText(marker)).toBeVisible({ timeout: 20_000 })

        const reporterPub = await page.evaluate(
            async ({ id }) => {
                const el = document.querySelector('[x-data^="nostrRoomChat"]')
                if (!el) {
                    throw new Error('Raum-Insel nicht gefunden')
                }
                const data = (window as unknown as { Alpine: { $data: (e: Element) => Record<string, unknown> } }).Alpine.$data(el)
                const msg = (data.messages as { id: string; pubkey: string }[]).find((m) => m.id === id)
                if (!msg) {
                    throw new Error(`Zielnachricht ${id} nicht im Feed der Insel`)
                }
                data.reportFor = msg
                data.reportReason = 'spam'
                data.reportText = 'E2E-Testmeldung'
                await (data.confirmReport as () => Promise<void>)()
                return msg.pubkey
            },
            { id: targetId },
        )
        expect(reporterPub, 'die gemeldete Nachricht muss einen Autor haben').toMatch(/^[0-9a-f]{64}$/)

        // Der Report liegt in `moderation_reports` — Gegenprobe unabhängig vom Client.
        const stored = await waitForReport(targetId)
        expect(stored.status).toBe('open')
        expect(stored.report_type).toBe('spam')
        expect(stored.note).toBe('E2E-Testmeldung')
        // Der Hebel dieser Umstellung: der Raum kommt vom Relay mit, der Client muss
        // das gemeldete Event nicht mehr nachladen, um an sein `h` zu kommen.
        expect(stored.channel_id, '`channel_id` liefert das `h` für die 9005-Löschung').toBe(BUZZ_ROOM_WELCOME)

        // ── 2. Queue: der Report erscheint (GET /moderation/reports, NIP-98) ────
        await page.goto('/directory')
        await expect(page.locator('[x-data="nostrDirectory"]')).toBeVisible({ timeout: 20_000 })

        const queueRow = async (): Promise<{ id: string; reportedId: string; roomH: string } | null> =>
            page.evaluate((id) => {
                const el = document.querySelector('[x-data="nostrDirectory"]')!
                const data = (window as unknown as { Alpine: { $data: (e: Element) => Record<string, unknown> } }).Alpine.$data(el)
                const r = (data.reports as { id: string; reportedId: string; roomH: string }[]).find((x) => x.reportedId === id)
                return r ? { id: r.id, reportedId: r.reportedId, roomH: r.roomH } : null
            }, targetId)

        await expect
            .poll(async () => (await queueRow()) !== null, {
                timeout: 30_000,
                message: 'die Meldung muss über GET /moderation/reports in der Queue landen (vor P5 blieb sie strukturell leer)',
            })
            .toBe(true)

        const row = await queueRow()
        expect(row!.id, 'Report-Kennung ist die 64-hex Event-id des 1984 (Ziel des `report`-Tags von 9044)').toMatch(/^[0-9a-f]{64}$/)
        expect(row!.roomH, '`roomH` kommt aus `channel_id`, nicht mehr aus einem nachgeladenen Event').toBe(BUZZ_ROOM_WELCOME)

        // Die Meldung ist auch sichtbar gerendert (nicht nur im Insel-State).
        // Die Queue liegt im Modal „action-items" (⚡directory.blade.php:51-59) — ohne
        // diesen Klick ist der Knopf nicht im DOM, und der Test prüfte nur den Insel-State.
        await page.getByRole('button', { name: /Meldungen & Beitritte/ }).first().click()
        await expect(page.getByRole('button', { name: 'Inhalt entfernen' }).first()).toBeVisible({ timeout: 10_000 })

        // ── 3. „Inhalt entfernen" über den echten Knopf ─────────────────────────
        // 9005 (mit `h`) löscht das Event, 9044 schließt den Report.
        await page.getByRole('button', { name: 'Inhalt entfernen' }).first().click()

        // ── 4. Gegenproben direkt am Relay ─────────────────────────────────────
        await expect
            .poll(
                async () => {
                    const hit = (await fetchReports()).find((r) => r.target === targetId)
                    return hit?.status ?? 'fehlt'
                },
                { timeout: 40_000, message: 'kind 9044 muss den Report auf `resolved` setzen' },
            )
            .toBe('resolved')

        // Die Löschung braucht einen POLL, keine Momentaufnahme. 9044 (Report schließen)
        // und 9005 (Event löschen) sind ZWEI Events; der Report kann längst `resolved`
        // sein, während das 9005 noch in der Verarbeitung steckt. Buzz bestätigt ein
        // Event, bevor es über einen frischen REQ sichtbar ist — dieselbe Verzögerung
        // ist in `buzz-admin.spec.ts` beim Seeden dokumentiert, hier wirkt sie
        // andersherum.
        //
        // **Das war die Ursache der langen Fehlersuche.** Der Test galt als hart rot und
        // wurde gegen fünf Hypothesen geprüft (Kanal-Admin, synchrone Buzz-Weiche,
        // loadRelay-Cache, busy-Gate, Signer-Rechte) — alle widerlegt, weil er in
        // Wahrheit INTERMITTIEREND ist: am 2026-07-30 isoliert gemessen 3× grün, dann
        // rot, dann wieder mehrfach grün. Eine Momentaufnahme direkt nach dem Klick
        // erwischt die Löschung mal, mal nicht.
        //
        // Die Gegenprobe steckt IM selben Lesevorgang: eine leere oder kaputte Abfrage
        // erfüllt „enthält den Marker nicht" sonst trivial — genau die Grün-Falle, vor
        // der `relayEvents()` oben schon einmal schützt.
        let inRoom: string[] = []
        await expect
            .poll(
                () => {
                    inRoom = relayEvents().map((e) => e.content)
                    return inRoom.includes(keeper) && !inRoom.includes(marker)
                },
                { timeout: 30_000, message: 'das 9005 muss das gemeldete Event am Relay entfernen (Gegenprobe bleibt liegen)' },
            )
            .toBe(true)
        expect(inRoom, 'gelöschtes Event darf nicht mehr am Relay liegen').not.toContain(marker)
        expect(inRoom, 'Gegenprobe muss am Relay liegen (sonst prüft der Test nichts)').toContain(keeper)

        // Und die Queue ist die offenen Meldungen wieder los.
        const stillOpen = (await fetchReports('open')).find((r) => r.target === targetId)
        expect(stillOpen, 'der erledigte Report darf nicht mehr unter `status=open` stehen').toBeUndefined()
    })
})
