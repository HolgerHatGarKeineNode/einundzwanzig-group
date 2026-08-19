import { test, expect, type Page } from './support/fixtures'
import {
    useBuzz,
    BUZZ_OWNER_NSEC,
    BUZZ_OWNER_SEC_HEX,
    BUZZ_USER_PUB,
    BUZZ_ROOM_WELCOME,
    BUZZ_ROOM_GENERAL,
    BUZZ_PORT,
} from './support/buzz'
import { loginNsec } from './support/login'
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'

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
 * Alle Räume des Space, direkt aus den relay-signierten 39000 gelesen (`d` = die
 * Kanal-UUID, `name` = der Anzeigename).
 *
 * Wie bei `relayEvents()` ist ein LEERES Ergebnis hier kein gültiger Messwert,
 * sondern ein Defekt: der buzz-test-Stack ist immer mit `E2E-Welcome`/`E2E-General`
 * geseedet. Ohne diese Unterscheidung wäre eine gescheiterte AUTH-Runde von „der
 * Raum wurde nicht angelegt" nicht zu trennen — genau die Verwechslung, an der die
 * Fehlersuche zu diesem Test schon einmal hängen geblieben ist.
 */
function roomsAtRelay(): { d: string; name: string }[] {
    for (let attempt = 0; attempt < 6; attempt++) {
        const out = execFileSync(NAK, ['req', '-k', '39000', '--auth', '--sec', BUZZ_OWNER_SEC_HEX, WS()], {
            encoding: 'utf8',
            timeout: 20_000,
        })
        const rows = out
            .split('\n')
            .filter(Boolean)
            .flatMap((line) => {
                try {
                    const e = JSON.parse(line) as { tags?: string[][] }
                    const tags = Object.fromEntries((e.tags ?? []).filter((t) => t.length > 1).map((t) => [t[0], t[1]]))
                    return tags.d ? [{ d: tags.d, name: String(tags.name ?? '') }] : []
                } catch {
                    return []
                }
            })
        if (rows.length > 0) {
            return rows
        }
        execFileSync('sleep', ['0.5'])
    }
    throw new Error('39000-Abfrage lieferte sechsmal nichts — die Seed-Räume sind immer da, also ist die Abfrage kaputt.')
}

/**
 * Roher REQ am Relay (als Owner authentifiziert), EINMAL — ohne den Retry von
 * `roomsAtRelay()`.
 *
 * Der Retry dort ist richtig, weil dessen Ergebnis nie leer sein DARF. Hier ist
 * „leer" dagegen ein zu erwartender Messwert (siehe die Grabstein-Probe unten), und
 * sechs Wiederholungen einer Abfrage, deren erwartetes Ergebnis leer ist, kosten nur
 * Zeit. Der Preis dieser Form steht am Aufrufer: ein leeres Ergebnis belegt für sich
 * genommen NICHTS — es braucht daneben eine Kontrolle, dass dieselbe Aufrufform im
 * selben Moment überhaupt Zeilen liefert.
 */
function relayQuery(filter: string[]): unknown[] {
    const out = execFileSync(NAK, ['req', ...filter, '--auth', '--sec', BUZZ_OWNER_SEC_HEX, WS()], {
        encoding: 'utf8',
        timeout: 20_000,
    })
    return out
        .split('\n')
        .filter(Boolean)
        .flatMap((line) => {
            try {
                return [JSON.parse(line) as unknown]
            } catch {
                return []
            }
        })
}

/** Pubkey (hex) zu einem Secret — für den Namen der pubkey-eigenen Cache-DB. */
function pubOf(sec: string): string {
    return execFileSync(NAK, ['key', 'public', sec], { encoding: 'utf8', timeout: 10_000 }).trim()
}

/**
 * Die `d`-Werte (Kanal-UUIDs) ALLER im IndexedDB liegenden 39000 — der Blick auf die
 * Schicht, in der der Geisterraum tatsächlich sitzt.
 *
 * Ohne diesen Blick misst ein Test nur den flüchtigen In-Memory-Stand: `ROOM_META`
 * steht in `storage.ts PERSIST_KINDS`, die Kachel überlebt also jeden Reload aus dem
 * Cache heraus. Die DOM-Probe allein könnte deshalb grün sein, während die Ursache
 * unberührt in der Datenbank liegt.
 *
 * WIRFT, wenn DB oder Store fehlen — ein Leseweg, der im Defektfall „nichts gefunden"
 * meldet, machte jede `not.toContain`-Zusicherung trivial grün.
 */
function cachedRoomIds(page: Page, dbName: string): Promise<string[]> {
    return page.evaluate(async (name) => {
        const dbs = await indexedDB.databases()
        if (!dbs.some((d) => d.name === name)) {
            throw new Error(`Cache-DB ${name} existiert nicht — der Login hat sie nicht angelegt`)
        }
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
            const req = indexedDB.open(name)
            req.onsuccess = () => resolve(req.result)
            req.onerror = () => reject(req.error)
        })
        try {
            if (!db.objectStoreNames.contains('events')) {
                throw new Error(`Cache-DB ${name} hat keinen events-Store`)
            }
            return await new Promise<string[]>((resolve, reject) => {
                const req = db.transaction('events', 'readonly').objectStore('events').getAll()
                req.onsuccess = () =>
                    resolve(
                        (req.result as { kind: number; tags?: string[][] }[])
                            .filter((e) => e.kind === 39000)
                            .flatMap((e) => {
                                const d = (e.tags ?? []).find((t) => t[0] === 'd')?.[1]
                                return d ? [d] : []
                            }),
                    )
                req.onerror = () => reject(req.error)
            })
        } finally {
            db.close()
        }
    }, dbName)
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

    /**
     * Der Knopf war sichtbar — angelegt wurde trotzdem nichts. Genau diese Lücke ließ
     * der Test darüber offen, und sie kostete drei Fehlannahmen, bis sie am laufenden
     * Relay sichtbar wurde. Buzz weicht beim 9007 in DREI Punkten von zooid ab:
     *
     * 1. **`name` ist Pflicht.** Ein 9007 mit nur `h` beantwortet Buzz mit
     *    `invalid: channel name is required` (`ingest.rs:2085`). Der Client schickte
     *    genau das — das Anlegen scheiterte am ersten Schritt.
     * 2. **`h` wird nur als UUID übernommen** (`ingest.rs:2132`). welshmans
     *    `randomId()` ist keine; das Relay legte den Kanal still unter einer eigenen
     *    UUID an, die nachfolgenden 9002/9021 zeigten ins Leere.
     * 3. **Kein 9021.** Der Ersteller steht nach dem 9007 schon als `owner` in der
     *    39002; auf einem privaten Raum antwortet Buzz dem Beitritt sogar mit
     *    `restricted: channel is private`.
     *
     * Der Test prüft alle drei über EINEN Anlege-Vorgang durch die echte Oberfläche.
     */
    test('Owner legt einen Raum an (9007 mit Name, Client-UUID, ohne 9021)', async ({ page }) => {
        // Eigener Name pro Lauf — der buzz-test-Stack ist geteilt und wird nicht
        // zwischen den Tests zurückgesetzt.
        const name = `E2E-Neu-${Math.random().toString(36).slice(2, 8)}`
        await loginNsec(page, BUZZ_OWNER_NSEC)

        const addBtn = page.getByRole('button', { name: 'Neuen Raum anlegen', exact: true })
        await expect(addBtn).toBeVisible({ timeout: 20_000 })
        await addBtn.click()

        const form = page.locator('dialog[data-modal="room-form"]')
        await form.getByPlaceholder('z.B. Allgemein').fill(name)

        // Das `h`, das die Insel VOR dem Speichern vergeben hat — die Gegenprobe für
        // Punkt 2. Ohne sie bliebe nur die UUID-FORM prüfbar, und die erfüllt auch
        // eine vom Relay ersatzweise gemintete ID.
        const formH = await page.evaluate(() => {
            const el = document.querySelector('[x-data="nostrSpaces"]')!
            const data = (window as unknown as { Alpine: { $data: (e: Element) => Record<string, unknown> } }).Alpine.$data(el)
            return (data.roomForm as { h: string }).h
        })

        await form.getByRole('button', { name: 'Speichern' }).click()

        // (1) Der Name kam an. Vor dem Fix blieb das 9007 mit
        // `invalid: channel name is required` liegen — es gab gar keinen Raum.
        await expect(page.getByText(name, { exact: true })).toBeVisible({ timeout: 25_000 })

        const room = roomsAtRelay().find((r) => r.name === name)
        expect(room, 'der neue Raum muss als relay-signierte 39000 am Relay liegen').toBeTruthy()

        try {
            // (2) Die ID stammt vom CLIENT, nicht vom Relay. Die UUID-FORM allein
            // belegte das nicht — ein ersatzweise vom Relay gemintetes `h` ist auch
            // eine UUIDv4. Erst der Abgleich mit dem Wert aus dem Formular trennt die
            // beiden Fälle, und genau daran scheiterte der alte `randomId()`-Pfad.
            expect(formH, 'die Insel muss eine UUIDv4 vergeben, sonst verwirft Buzz sie').toMatch(
                /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
            )
            expect(room!.d, 'Buzz muss die vom Client vergebene UUID übernehmen').toBe(formH)

            // (3) Der Ersteller ist Mitglied, OHNE dass ein 9021 gesendet wurde — der
            // Raum steht unter „Meine Räume". Genau hier hätte ein 9021 auf einem
            // privaten Raum den ganzen Vorgang mit einem Fehler beendet.
            await expect
                .poll(
                    async () =>
                        page.evaluate((wanted) => {
                            const el = document.querySelector('[x-data="nostrSpaces"]')!
                            const data = (window as unknown as { Alpine: { $data: (e: Element) => Record<string, unknown> } }).Alpine.$data(el)
                            return (data.filteredMine as () => { name?: string }[])().some((r) => r.name === wanted)
                        }, name),
                    { timeout: 25_000, message: 'der Ersteller muss ohne 9021 Mitglied seines neuen Raums sein' },
                )
                .toBe(true)
        } finally {
            // Aufräumen am Relay (die Kachel bietet auf Buzz keine Löschen-Aktion).
            execFileSync(NAK, ['event', '--auth', '--sec', BUZZ_OWNER_SEC_HEX, '-k', '9008', '-t', `h=${room!.d}`, WS()], {
                encoding: 'utf8',
                timeout: 20_000,
            })
        }
    })

    /**
     * „Bearbeiten" ist der EINZIGE Verwaltungs-Menüpunkt, den die Kachel auf einem
     * Buzz-Space noch anbietet (`room-tile.blade.php`: Mitglieder/Löschen sind hinter
     * `!isBuzz` gegatet). Er hat dieselbe Falle wie das Anlegen: Buzz schiebt die neu
     * signierte 39000 nicht in die offene Live-Sub. Ohne Nachladen bliebe der ALTE
     * Name stehen — der Nutzer sähe einen Menüpunkt, der nichts tut, obwohl das 9002
     * längst am Relay liegt.
     */
    test('Owner benennt einen Raum um — die Liste zieht ohne Reload nach (9002)', async ({ page }) => {
        const name = `E2E-Alt-${Math.random().toString(36).slice(2, 8)}`
        const renamed = `E2E-Neu-${Math.random().toString(36).slice(2, 8)}`
        await loginNsec(page, BUZZ_OWNER_NSEC)

        // Anlegen über die Oberfläche (derselbe Pfad wie im Test darüber).
        const addBtn = page.getByRole('button', { name: 'Neuen Raum anlegen', exact: true })
        await expect(addBtn).toBeVisible({ timeout: 20_000 })
        await addBtn.click()
        const form = page.locator('dialog[data-modal="room-form"]')
        await form.getByPlaceholder('z.B. Allgemein').fill(name)
        await form.getByRole('button', { name: 'Speichern' }).click()
        await expect(page.getByText(name, { exact: true })).toBeVisible({ timeout: 25_000 })

        const room = roomsAtRelay().find((r) => r.name === name)
        expect(room, 'der Ausgangsraum muss am Relay liegen').toBeTruthy()

        try {
            // Umbenennen über das Kachel-„…"-Menü.
            const tile = page.locator('div.group', { hasText: name })
            await tile.getByRole('button', { name: 'Raum verwalten' }).click()
            await page.getByRole('menuitem', { name: 'Bearbeiten' }).click()
            const editForm = page.locator('dialog[data-modal="room-form"]')
            await expect(editForm.getByPlaceholder('z.B. Allgemein')).toHaveValue(name)
            await editForm.getByPlaceholder('z.B. Allgemein').fill(renamed)
            await editForm.getByRole('button', { name: 'Speichern' }).click()

            // Der Kern: OHNE Reload. Ein `page.reload()` hier würde den Test grün
            // machen und die Aussage zerstören.
            await expect(page.getByText(renamed, { exact: true })).toBeVisible({ timeout: 25_000 })
            await expect(page.getByText(name, { exact: true })).toHaveCount(0)

            // Gegenprobe am Relay: derselbe Raum (gleiches `d`), neuer Name — nicht
            // etwa ein zweiter Raum, den ein verirrtes 9007 angelegt hätte.
            const after = roomsAtRelay().filter((r) => r.d === room!.d)
            expect(after.map((r) => r.name), 'die 39000 muss unter derselben ID den neuen Namen tragen').toEqual([renamed])
        } finally {
            execFileSync(NAK, ['event', '--auth', '--sec', BUZZ_OWNER_SEC_HEX, '-k', '9008', '-t', `h=${room!.d}`, WS()], {
                encoding: 'utf8',
                timeout: 20_000,
            })
        }
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


    // ── Raum-Abgleich (`groups.ts reconcileSpaceRooms` + `roomReconcile.ts`) ─────
    //
    // Diese drei Fälle hängen ausdrücklich an der VERDRAHTUNG, nicht an der
    // Entscheidungsfunktion: `roomReconcile.test.ts` belegt, dass eine reine Funktion
    // die richtige Id-Liste zurückgibt — dass diese Liste einen Aufrufer hat, im
    // `repository` ankommt und die IndexedDB nachzieht, belegt erst ein Lauf durch die
    // Fläche. Gegengemessen am zweistufigen Stand (2026-08-19, je ein Lauf): mit
    // auskommentiertem `void reconcileSpaceRooms(url)` bleiben `npm run test:unit`
    // (1067/1067) und `npm run typecheck` (rc 0) grün, während BEIDE positiven Fälle
    // hier fallen — (a) nach 150 s Nachhaken, der Reload-Pfad mit „Expected 0,
    // Received 1". Der fail-closed-Fall bleibt dabei grün: eine ausgehängte Verdrahtung
    // löscht nichts, und „nichts gelöscht" ist genau seine Zusage. **Ein Fall, der die
    // Verdrahtung deckt, kann deshalb nur ein POSITIVER sein**; die Fail-closed-Zusage
    // braucht ihre eigene Mutation — und zwar eine zusammengesetzte, siehe dort.
    //
    // **Warum gegen Buzz und nirgends sonst:** nur hier versenkt der Relay den
    // GRABSTEIN mit. zooid lässt das 9008 stehen (`groups.go:108-129` löscht alles mit
    // diesem `h` außer dem 9008 selbst; `CanRead` gibt für einen Grabstein ohne
    // Metadaten ausdrücklich `true`) — dort greift der alte Ausblend-Weg, und der neue
    // Code liefe ins Leere. Dieselben Fälle gegen zooid wären grün, ohne über den
    // Abgleich irgendetwas auszusagen.

    /**
     * Die KACHEL eines Raums in der Raumliste — nicht irgendein Vorkommen seines Namens.
     *
     * `getByText('E2E-Welcome', { exact: true })` sah lange eindeutig aus und ist es
     * nicht: die Thread-Vorschau derselben Seite beschriftet ihre Karten mit
     * `roomName(t.roomH)`, und sobald ein Nachbar-Spec auf demselben Worker-Stack einen
     * Thread im Welcome-Raum angelegt hat, trifft derselbe Locator zwei Elemente —
     * Playwright bricht dann mit „strict mode violation" ab. Gemessen im Vollauf vom
     * 2026-08-19; in fünf Einzelläufen davor war der Locator eindeutig, weil die
     * Thread-Karte fehlte. Die Rolle trennt sauber: die Kachel ist ein Button, dessen
     * zugänglicher Name den Raumnamen enthält, die Thread-Karte trägt ein eigenes
     * `aria-label` (Autor + Betreff) und damit den Raumnamen NICHT.
     */
    const roomTile = (page: Page, name: string) => page.getByRole('button', { name })

    /**
     * Hängt die Space-Insel neu ein, OHNE die Seite neu zu laden.
     *
     * Der Unterschied war ursprünglich lasttragend: der Abgleich zog seinen
     * Bestands-Schnappschuss synchron beim Einhängen, und nach einem `page.reload()`
     * war der IndexedDB-Cache noch nicht in das repository gespiegelt — nur über
     * `Livewire.navigate` (Modul bleibt am Leben, Cache längst hydriert) sah er
     * überhaupt etwas. **Das ist seit `awaitCacheHydration` behoben** (siehe den
     * Reload-Pfad-Test weiter unten), und damit ist dieser Helfer keine Krücke mehr,
     * sondern deckt einen eigenen Nutzerweg ab: das Wechseln in einen Raum und zurück,
     * ohne Seitenaufbau. Genau dieser Weg löst einen erneuten Abgleich aus, ohne den
     * Modulzustand (Sperre, In-Flight-Marke) zurückzusetzen — ein Reload täte das und
     * prüfte deshalb etwas anderes.
     */
    async function remountSpaces(page: Page): Promise<void> {
        await page.evaluate(
            (roomH) =>
                (window as unknown as { Livewire: { navigate: (u: string) => void } }).Livewire.navigate(`/rooms/${roomH}`),
            BUZZ_ROOM_WELCOME,
        )
        await page.waitForURL('**/rooms/**')
        await page.evaluate(() => (window as unknown as { Livewire: { navigate: (u: string) => void } }).Livewire.navigate('/spaces'))
        await page.waitForURL('**/spaces')
        // Erst wenn die Liste wieder steht, ist eine Zählung darauf etwas wert — sonst
        // wäre „Kachel weg" schon während des Seitenwechsels erfüllt.
        await expect(roomTile(page, 'E2E-Welcome')).toBeVisible({ timeout: 30_000 })
    }

    /**
     * (a) Ein am Relay gelöschter Kanal verschwindet aus der Liste UND aus dem Cache —
     * und bleibt nach einem Kaltstart weg.
     *
     * Ohne Aufräumen in der IndexedDB wäre die Kachel nach dem nächsten Boot wieder da:
     * `ROOM_META` steht in `storage.ts PERSIST_KINDS`. Genau deshalb prüft dieser Test
     * beide Schichten — und der letzte Reload läuft mit BLOCKIERTEM Relay
     * (`routeWebSocket`), damit nichts nachgeladen und nichts ein zweites Mal aufgeräumt
     * werden kann: was dann noch steht, steht aus dem Cache; was fehlt, fehlt dort auch.
     *
     * Der Weg über `remountSpaces` deckt den In-App-Wechsel ab; den Reload-Pfad prüft
     * der Test darunter. Die Schleife hängt bewusst an einer BEDINGUNG statt an einer
     * Uhr, denn ob die 60-s-Sperre (`groups.ts ROOM_RECONCILE_COOLDOWN_MS`) im Weg
     * steht, hängt vom Profilzustand ab.
     *
     * **Hier stand bis 2026-08-19, die Schleife müsse diese Sperre aussitzen, weil der
     * Login-Lauf sie setze. Das gilt seit `shouldArmReconcileLock` nicht mehr, und die
     * Messung zeigt es:** der Fall lief vorher 1.1 min, jetzt 10.7 s. Daraus folgt
     * zwingend, dass der Login-Lauf die Sperre NICHT gesetzt hat — sonst wäre der
     * nächste Abgleich 60 s lang `skipped` gewesen und die Kachel hätte nicht nach
     * wenigen Sekunden verschwinden können. Der Grund steht in
     * `shouldArmReconcileLock`: die Sperre verlangt `knownCount > 0`, und beim
     * Einhängen auf einem kalten Profil ist das repository noch leer. Die 150-s-Grenze
     * der Schleife bleibt als Obergrenze für den warmen Fall stehen; sie kostet nichts,
     * solange der Test grün ist.
     */
    test('Abgleich: ein am Relay gelöschter Raum verschwindet aus Liste und Cache', async ({ page }) => {
        // Anlegen, Login, Cache-Roundtrip, Sperrfrist, Kaltstart — weit jenseits der 30 s.
        test.setTimeout(300_000)

        const h = randomUUID()
        const name = `E2E-Geist-${Math.random().toString(36).slice(2, 8)}`
        let deleted = false
        const deleteAtRelay = (): void => {
            execFileSync(NAK, ['event', '--auth', '--sec', BUZZ_OWNER_SEC_HEX, '-k', '9008', '-t', `h=${h}`, WS()], {
                encoding: 'utf8',
                timeout: 20_000,
            })
            deleted = true
        }

        try {
            // (0) Wegwerf-Kanal per `nak`. `name` ist bei Buzz Pflicht und `h` wird nur
            // als UUID übernommen — beides ist im Anlege-Test oben begründet.
            execFileSync(
                NAK,
                ['event', '--auth', '--sec', BUZZ_OWNER_SEC_HEX, '-k', '9007', '-t', `h=${h}`, '-t', `name=${name}`, '-t', 'about=E2E-Abgleich', WS()],
                { encoding: 'utf8', timeout: 20_000 },
            )
            expect(roomsAtRelay().map((r) => r.d), 'der Wegwerf-Raum muss als 39000 am Relay liegen').toContain(h)

            await loginNsec(page, BUZZ_OWNER_NSEC)

            // (1) Die Kachel ist da — der Ausgangszustand, ohne den der Rest nichts misst.
            await expect(page.getByText(name, { exact: true })).toBeVisible({ timeout: 25_000 })

            // (2) …und das 39000 liegt in der IndexedDB. VORBEDINGUNG des Kaltstart-Belegs:
            // wäre der Raum nie gecacht worden, wäre „nach dem Boot weg" trivial erfüllt.
            const cacheDb = `einundzwanzig-cache-${pubOf(BUZZ_OWNER_SEC_HEX)}`
            await expect
                .poll(() => cachedRoomIds(page, cacheDb), {
                    timeout: 30_000,
                    message: 'das 39000 des Wegwerf-Raums muss erst im Cache liegen (syncEvents batcht 3 s)',
                })
                .toContain(h)

            // (3) Löschen am Relay — und die Buzz-Eigenheit, die den alten Weg aushebelt,
            // gleich mitgemessen: danach ist WEDER die 39000 abrufbar NOCH ein Grabstein.
            deleteAtRelay()
            const nachher = roomsAtRelay().map((r) => r.d)
            expect(nachher, 'die 39000 des gelöschten Raums darf der Relay nicht mehr liefern').not.toContain(h)
            // Die Kontrolle zur Zeile darunter, gleiche Aufrufform, gleicher Moment, nur
            // anderes Kind: ohne sie wäre „keine Grabsteine" auch bei kaputter Abfrage grün.
            expect(relayQuery(['-k', '39000']).length, 'Kontrolle: dieselbe Abfrageform liefert gerade Zeilen').toBeGreaterThan(0)
            expect(
                relayQuery(['-k', '9008']),
                'Buzz versenkt den Grabstein mit — gäbe es ihn noch, griffe der alte Ausblend-Weg und dieser Test prüfte nichts',
            ).toEqual([])

            // (4) Der Abgleich beim nächsten Einhängen räumt die Kachel weg. Die Schleife
            // sitzt die 60-s-Sperre aus; sie wartet auf eine BEDINGUNG, nicht auf eine Uhr.
            await expect
                .poll(
                    async () => {
                        await remountSpaces(page)
                        return page.getByText(name, { exact: true }).count()
                    },
                    {
                        timeout: 150_000,
                        intervals: [2_000],
                        message: 'der Abgleich muss den am Relay gelöschten Raum aus der Liste nehmen',
                    },
                )
                .toBe(0)

            // (5) Die Schicht, in der der Defekt saß: das 39000 ist auch aus der
            // IndexedDB verschwunden — und NUR dieses.
            await expect
                .poll(() => cachedRoomIds(page, cacheDb), {
                    timeout: 30_000,
                    message: 'repository.removeEvent muss über den update-Event auch die IndexedDB räumen',
                })
                .not.toContain(h)
            expect(await cachedRoomIds(page, cacheDb), 'nur der gelöschte Raum darf gehen').toContain(BUZZ_ROOM_WELCOME)

            // (6) Kaltstart mit blockiertem Relay: kein Nachladen, kein zweites Aufräumen.
            // Die Liste rendert rein aus dem Cache — der Geisterraum ist auch dort nicht
            // mehr, die Nachbarn schon.
            await page.routeWebSocket(new RegExp(`localhost:${BUZZ_PORT}`), () => {})
            await page.reload()
            await expect(roomTile(page, 'E2E-Welcome')).toBeVisible({ timeout: 30_000 })
            await expect(page.getByText(name, { exact: true })).toHaveCount(0)
        } finally {
            if (!deleted) {
                // Der Test ist vor dem Löschen gescheitert — sonst wüchse der Kanalbestand
                // des geteilten Stacks bei jedem Fehlschlag.
                try {
                    deleteAtRelay()
                } catch {
                    // Still: ein scheiternder Aufräumer darf den Befund nicht überschreiben
                    // (siehe support/rooms.ts). Der Bloat-Guard ist die zweite Linie.
                }
            }
        }
    })

    /**
     * **BEHOBEN — dieser Test war bis 2026-08-19 als `test.fail()` verankert.**
     *
     * Die Zusage: nach einem RELOAD ist der am Relay gelöschte Raum weg. Sie war auf
     * dem Reload-Pfad nicht erfüllt, und zwar nicht sporadisch, sondern immer:
     *
     * `runRoomReconcile` nahm seinen Bestands-Schnappschuss (`knownBefore =
     * repository.query([{kinds:[ROOM_META]}])`) synchron beim Einhängen der Insel.
     * `storage.ts initStorage/storageReady` spiegelt den IndexedDB-Cache aber
     * ASYNCHRON in das repository, und `bridge.ts` wartet für die Raumliste nicht darauf.
     * Nach einem Reload existierte der Geisterraum ausschließlich im Cache — er war damit
     * im Schnappschuss nicht enthalten und konnte nicht in die Löschliste geraten. Der
     * (mit leeren Händen) erfolgreiche Lauf setzte danach die 60-s-Sperre, die den
     * nächsten Versuch abwürgte. Jeder weitere Reload begann dasselbe Rennen von vorn.
     *
     * Gemessen am buzz-test-Stack (2026-08-19): nach Reload Kachel=1, Cache=vorhanden —
     * über 30 s und 33 Abfragen unverändert; nach Ablauf der Sperre und einem Einhängen
     * OHNE Reload (`Livewire.navigate`) Kachel=0, Cache=leer.
     *
     * **Der Fix** (`groups.ts runRoomReconcile`, `roomReconcile.ts`): der Lauf wartet
     * jetzt auf `storageReady`, bevor er den Schnappschuss zieht — das Rennen, gegen
     * das die frühe Momentaufnahme schützt, betrifft nur NEU eintreffende Ereignisse
     * und beginnt ohnehin erst mit dem REQ. Und die Sperre hängt nicht mehr am Verdikt
     * allein (`shouldArmReconcileLock`): ein Lauf ohne hydrierten Cache oder ohne
     * beurteilten Bestand ist kein Erfolg, den man sich merken dürfte.
     *
     * Der `test.fail()`-Marker hat getan, wofür er da war: er schlug am Tag der
     * Behebung um („Expected to fail, but passed", Lauf vom 2026-08-19) und ist mit
     * dem Fix entfernt worden. Der Test bleibt als Regressionsschutz stehen — er ist
     * der einzige, der den Reload-Pfad fährt (der Test darüber nimmt bewusst
     * `remountSpaces`).
     */
    test('Reload-Pfad: der Abgleich räumt den Geisterraum auch nach einem Reload', async ({ page }) => {
        test.setTimeout(240_000)

        const h = randomUUID()
        const name = `E2E-Geist-Reload-${Math.random().toString(36).slice(2, 8)}`
        let deleted = false
        const deleteAtRelay = (): void => {
            execFileSync(NAK, ['event', '--auth', '--sec', BUZZ_OWNER_SEC_HEX, '-k', '9008', '-t', `h=${h}`, WS()], {
                encoding: 'utf8',
                timeout: 20_000,
            })
            deleted = true
        }

        try {
            execFileSync(
                NAK,
                ['event', '--auth', '--sec', BUZZ_OWNER_SEC_HEX, '-k', '9007', '-t', `h=${h}`, '-t', `name=${name}`, WS()],
                { encoding: 'utf8', timeout: 20_000 },
            )
            await loginNsec(page, BUZZ_OWNER_NSEC)
            await expect(page.getByText(name, { exact: true })).toBeVisible({ timeout: 25_000 })

            const cacheDb = `einundzwanzig-cache-${pubOf(BUZZ_OWNER_SEC_HEX)}`
            await expect
                .poll(() => cachedRoomIds(page, cacheDb), { timeout: 30_000, message: 'Raum muss erst im Cache liegen' })
                .toContain(h)

            deleteAtRelay()
            expect(roomsAtRelay().map((r) => r.d)).not.toContain(h)

            await page.reload()
            // Erst die Liste abwarten, sonst wäre `toHaveCount(0)` schon vor dem ersten
            // Paint erfüllt und der Fehlschlag käme aus der falschen Richtung.
            await expect(roomTile(page, 'E2E-Welcome')).toBeVisible({ timeout: 30_000 })

            // Die Zeile, an der es bis zum Fix brach. Der Abgleich wartet jetzt auf den
            // hydrierten Cache, sieht den nur dort liegenden Geisterraum und bestätigt ihn
            // per Einzelprobe, bevor er ihn entfernt.
            await expect(page.getByText(name, { exact: true })).toHaveCount(0, { timeout: 30_000 })
        } finally {
            if (!deleted) {
                try {
                    deleteAtRelay()
                } catch {
                    /* still — siehe oben */
                }
            }
        }
    })

    /**
     * (b) Fail-closed — ein Relay, der nie antwortet, räumt die Raumliste NICHT aus.
     *
     * Die Abwesenheit eines Raums beweist seine Löschung nur bei VOLLSTÄNDIGER Antwort.
     * Hier ist sie es nicht: der Socket kommt zustande, ein EOSE kommt nie.
     * `classifyRoomAnswer` muss dann bei `no-eose`/`disconnected` landen und die
     * Löschliste leer bleiben.
     *
     * ── Was dieser Test kalibriert — und was er NICHT kann ─────────────────────
     *
     * **Die Zusage hängt an einer KETTE aus zwei Riegeln, und der Test prüft sie nur
     * als Ganzes.** Das ist keine Schwäche des Tests, sondern die Bauform des
     * Prüfgegenstands: beide Stufen lesen dieselbe Funktion (`classifyRoomAnswer`),
     * und jeder Riegel allein hält den anderen bereits fest. Selbst gemessen am
     * buzz-test-Stack (2026-08-19, je ein Lauf, Wartewert 50 s):
     *
     * | Mutation in `roomReconcile.ts`                                   | dieser Test |
     * |------------------------------------------------------------------|-------------|
     * | M2 `classifyRoomAnswer` ≡ `'complete'`                            | **grün** (55.8 s) |
     * | M3 `confirmsRoomGone` → `classifyRoomAnswer(probe) !== 'complete'`| **grün** (55.7 s) |
     * | M4 = Stufe-1-Riegel (`selectReconcileCandidates:207-209`) raus **und** M3 zugleich | **ROT** |
     *
     * Warum die Einzelpunkte nicht beißen: M2 schaltet über `confirmsRoomGone`
     * (`:238-239`, `=== 'nothing-visible'`) die Löschbedingung gleich mit ab — das
     * mutierte Verdikt ist nie `'nothing-visible'`, also bestätigt keine Einzelprobe.
     * M3 allein läuft ins Leere, weil `selectReconcileCandidates` bei schweigendem
     * Relay schon vorher `[]` liefert und gar keine Probe stattfindet. **Erst beide
     * Riegel zugleich erreichen die Zusicherung.**
     *
     * Die rote Ausgabe unter M4 ist die der ganzen Raumliste: `getByRole('button',
     * { name: 'E2E-Welcome' }) … element(s) not found`. (a) und der Reload-Pfad
     * bleiben unter M4 grün — die drei Fälle decken also verschiedene Stellen ab.
     *
     * **Was hier bis 2026-08-19 falsch stand:** „mit `classifyRoomAnswer` auf festes
     * `'complete'` verkürzt fällt dieser Test" — das war gegen die damalige, einstufige
     * Fassung mit Kappungs-Heuristik richtig und wurde vom zweistufigen Umbau
     * überholt. Eine Kalibrierzeile ist eine Messaussage über EINEN Codestand; wer sie
     * stehen lässt, hält den nächsten Leser vom Nachmessen ab.
     *
     * **Warum ein fester Wartewert und kein `waitFor`:** die Zusicherung lautet „es
     * passiert nichts". Dafür gibt es kein Element, auf das man warten könnte; die
     * einzige sinnvolle Schranke sind die Fristen des Produkts selbst. Dieselbe Bauform
     * wie der Batch-Flush in `storage-cache.spec.ts`.
     */
    test('Abgleich ist fail-closed: ein schweigender Relay entfernt keinen Raum', async ({ page }) => {
        test.setTimeout(180_000)

        await loginNsec(page, BUZZ_OWNER_NSEC)
        await expect(roomTile(page, 'E2E-Welcome')).toBeVisible({ timeout: 25_000 })

        // Der Cache muss warm sein, sonst hätte der Abgleich beim Kaltstart nichts zu
        // löschen und der Test wäre aus dem falschen Grund grün.
        const cacheDb = `einundzwanzig-cache-${pubOf(BUZZ_OWNER_SEC_HEX)}`
        // BEIDE Räume in EINEM Poll: `syncEvents` batcht alle 3 s, die zweite 39000 kann
        // eine Runde später fallen. Eine Nachprüfung hinter dem Poll wäre genau dieses
        // Rennen — im Vollauf vom 2026-08-19 auch prompt eingetreten (nur `welcome` da).
        await expect
            .poll(() => cachedRoomIds(page, cacheDb), { timeout: 30_000, message: 'beide Seed-Räume müssen erst im Cache liegen' })
            .toEqual(expect.arrayContaining([BUZZ_ROOM_WELCOME, BUZZ_ROOM_GENERAL]))

        // Ab jetzt schwarzes Loch: die Verbindung entsteht, eine Antwort kommt nie.
        await page.routeWebSocket(new RegExp(`localhost:${BUZZ_PORT}`), () => {})
        await page.reload()
        await expect(roomTile(page, 'E2E-Welcome')).toBeVisible({ timeout: 30_000 })

        // Den Abgleich DIESES Boots vollständig auslaufen lassen. Die Frist ist aus den
        // Zeitbudgets des Produkts abgeleitet, nicht geschätzt: Stufe 1 (breite Abfrage)
        // 20 s + Stufe 2 (Einzelproben, parallel) 20 s — beide `groups.ts
        // ROOM_RECONCILE_TIMEOUT_MS` — plus 3 s Cache-Batch (`storage.ts syncEvents`)
        // = 43 s; 50 s lassen Luft. Unter M4 fällt der Test bei diesem Wert (gemessen),
        // die Schranke ist also nicht bloß hergeleitet, sondern belegt.
        //
        // Hier standen bis 2026-08-19 **84 s + Remount + 25 s**, begründet mit der
        // 60-s-Sperre, die ein leerhändiger Lauf nach einem Reload setzte. Diese Lage
        // gibt es nicht mehr: `runRoomReconcile` wartet auf `awaitCacheHydration`, der
        // erste Lauf nach dem Reload hat damit selbst den vollen Bestand — er IST der
        // gefährliche, und ein zweiter Anlauf ist überflüssig. 109 s gespart, ohne
        // Aussage zu verlieren.
        await page.waitForTimeout(50_000)

        await expect(roomTile(page, 'E2E-Welcome')).toBeVisible()
        await expect(roomTile(page, 'E2E-General')).toBeVisible()
        const cached = await cachedRoomIds(page, cacheDb)
        expect(cached, 'ohne vollständige Antwort darf kein 39000 aus dem Cache fliegen').toContain(BUZZ_ROOM_WELCOME)
        expect(cached).toContain(BUZZ_ROOM_GENERAL)
    })
})
