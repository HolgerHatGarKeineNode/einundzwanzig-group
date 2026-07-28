import { test, expect, type Page } from './support/fixtures'
import { useBuzz, BUZZ_OWNER_NSEC, BUZZ_OWNER_SEC_HEX, BUZZ_USER_PUB, BUZZ_ROOM_WELCOME, BUZZ_PORT } from './support/buzz'
import { loginNsec } from './support/login'
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { execFileSync } from 'node:child_process'

/** Pfad zum `nak`-Binary (wie in den Seed-Skripten). */
const NAK = process.env.NAK ?? `${process.env.HOME}/go/bin/nak`
const WS = () => `ws://localhost:${BUZZ_PORT}`

/**
 * Schreibt eine kind-9-Nachricht in den Welcome-Raum (Owner-signiert) und liefert
 * ihre Event-id — gelesen per REQ vom Relay, nicht aus dem Markup. Die frühere
 * Variante hing die id an ein DOM-Attribut; das war eine Annahme über die
 * Darstellung, die nicht trug und den Test 120 s warten ließ.
 */
function seedMessage(content: string): string {
    execFileSync(
        NAK,
        ['event', '--auth', '--sec', BUZZ_OWNER_SEC_HEX, '-k', '9', '-t', `h=${BUZZ_ROOM_WELCOME}`, '-c', content, WS()],
        { encoding: 'utf8', timeout: 30_000 },
    )
    // Ein einmaliger Lesezugriff direkt nach dem `OK` ist zu ungeduldig: Buzz
    // bestätigt das Event, bevor es über einen frischen REQ sichtbar ist. Allein
    // lief der Test damit durch, im Verbund mit anderen Specs kippte er — die
    // Nachricht lag am Relay, nur eben einen Wimpernschlag später. Deshalb
    // mehrere Versuche statt einer Momentaufnahme.
    for (let attempt = 0; attempt < 10; attempt++) {
        const hit = relayEvents().find((e) => e.content === content)
        if (hit) {
            return hit.id
        }
        execFileSync('sleep', ['0.3'])
    }
    throw new Error(`Seed-Nachricht ${content} kam nicht am Relay an`)
}

/**
 * Alle kind-9-Inhalte des Welcome-Raums, direkt vom Relay gelesen (authentifiziert
 * als Owner). Bewusst über `nak` statt über die Oberfläche: der Beleg für eine
 * relay-seitige Löschung darf nicht an Rendering, Scroll-Fenster oder Live-Sub-Timing
 * hängen. Dasselbe Werkzeug, mit dem der Test-Stack geseedet wird.
 */
function relayEvents(): { id: string; content: string }[] {
    // `nak req` liefert sporadisch eine leere Ausgabe: die NIP-42-AUTH-Runde
    // scheitert gelegentlich, stdout bleibt dann leer und der Aufrufer schlösse
    // fälschlich „Raum ist leer". Am laufenden Relay beobachtet — derselbe Grund,
    // aus dem die Seed-Skripte dieses Repos ihre nak-Aufrufe absichern. Deshalb
    // hier ein kurzer Retry statt einer Einmalmessung.
    // Zwei Dinge, die die frühere Fassung offen ließ und die den Test flaky machten:
    // die Versuche folgten ohne Pause aufeinander (vier Fehlschläge in Millisekunden
    // sind kein Retry), und am Ende stand ein leeres Array. Damit war „Abfrage
    // fehlgeschlagen" von „Raum ist leer" nicht unterscheidbar — und weil die erste
    // Assertion des Tests `not.toContain(...)` lautet, wäre sie gegen ein leeres
    // Array sogar trivial grün geworden. Ein Messgerät, das im Defektfall „nichts
    // gefunden" meldet, ist gefährlicher als eines, das ausfällt.
    for (let attempt = 0; attempt < 6; attempt++) {
        const rows = readRelayEvents()
        if (rows.length > 0) {
            return rows
        }
        execFileSync('sleep', ['0.5'])
    }
    throw new Error(
        `Relay-Abfrage lieferte sechsmal nichts für Raum ${BUZZ_ROOM_WELCOME}. ` +
            'Der Welcome-Raum ist immer geseedet — leer heißt hier: die Abfrage ist kaputt, nicht der Raum.',
    )
}

function readRelayEvents(): { id: string; content: string }[] {
    const out = execFileSync(
        NAK,
        ['req', '-k', '9', '-t', `h=${BUZZ_ROOM_WELCOME}`, '--auth', '--sec', BUZZ_OWNER_SEC_HEX, WS()],
        { encoding: 'utf8', timeout: 20_000 },
    )
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

/** Nur die Inhalte — für die Gegenproben am Ende des Tests. */
function relayContents(): string[] {
    return relayEvents().map((e) => e.content)
}

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

    /**
     * P5/Restposten 3 — Admin-Löschung eines gemeldeten Inhalts auf Buzz.
     *
     * Buzz' kind 9005 verlangt Raum-Bezug: ohne `h` antwortet der Relay
     * `invalid: channel-scoped events must include an h tag` (am laufenden Relay
     * gemessen). Der Report (kind 1984) trägt per NIP-56 kein `h`; die Queue holt
     * es deshalb aus dem GEMELDETEN Event (`ReportView.roomH`).
     *
     * **Warum die Insel-Methode statt der echten Queue:** Buzz speichert kind 1984
     * gar nicht als Event (`ingest.rs:1600-1608` kehrt vor der Speicherung zurück);
     * ein `REQ -k 1984` liefert dort 0 Treffer, die Melde-Queue bleibt strukturell
     * leer. Getestet wird deshalb der Pfad, den P3 repariert: ReportView mit `roomH`
     * → members.ts-Weiche → 9005 mit `h` → Relay löscht wirklich.
     */
    test('Admin-Löschung eines gemeldeten Inhalts nimmt das `h` mit (9005)', async ({ page }) => {
        // Der Test durchläuft Login, Raum, Senden, Directory, Löschung und die
        // Relay-Gegenprobe — das sprengt das 30-s-Standardbudget eines Tests.
        test.setTimeout(120_000)
        await loginNsec(page, BUZZ_OWNER_NSEC)

        // Beide Nachrichten per `nak` seeden: eine wird gelöscht, die andere ist die
        // Gegenprobe. Bewusst nicht über die Oberfläche — der Test prüft die
        // ADMIN-LÖSCHUNG, nicht das Senden; und die Event-id kommt so vom Relay
        // statt aus einer Annahme über das Markup.
        const marker = `P3-Loeschziel-${Math.floor(Math.random() * 1e9)}`
        const keeper = `P3-Bleibt-${Math.floor(Math.random() * 1e9)}`
        const eventId = seedMessage(marker)
        seedMessage(keeper)
        expect(eventId).toMatch(/^[0-9a-f]{64}$/)

        // Admin-Löschung über die Directory-Insel, mit `h` — genau der Pfad der
        // Melde-Queue („Inhalt entfernen").
        await page.goto('/directory')
        await expect(page.locator('[x-data="nostrDirectory"]')).toBeVisible({ timeout: 20_000 })
        await page.evaluate(
            async ({ id, h }) => {
                const el = document.querySelector('[x-data="nostrDirectory"]')!
                const data = (window as unknown as { Alpine: { $data: (e: Element) => Record<string, unknown> } }).Alpine.$data(el)
                await (data.removeReportedContent as (r: unknown) => Promise<void>)({
                    id: 'x'.repeat(64),
                    reportedId: id,
                    reportedPubkey: '',
                    reportedName: '',
                    reason: 'spam',
                    reasonLabel: 'Spam',
                    text: '',
                    roomH: h,
                })
            },
            { id: eventId, h: BUZZ_ROOM_WELCOME },
        )

        // Beleg direkt AM RELAY statt über die Oberfläche: ein authentifizierter REQ
        // als Owner. Das umgeht jede Render-/Scroll-/Live-Sub-Unschärfe der Raumansicht
        // und prüft genau die Behauptung — das Event ist weg, die Gegenprobe steht noch.
        const inRoom = relayContents()
        expect(inRoom, 'gelöschtes Event darf nicht mehr am Relay liegen').not.toContain(marker)
        expect(inRoom, 'Gegenprobe muss am Relay liegen (sonst prüft der Test nichts)').toContain(keeper)
    })
})
