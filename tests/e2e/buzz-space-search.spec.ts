import { test, expect, type Page } from './support/fixtures'
import { useBuzz, BUZZ_URL, BUZZ_PORT, BUZZ_USER_NSEC, BUZZ_OWNER_SEC_HEX } from './support/buzz'
import { loginNsec } from './support/login'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'

/**
 * P5 des Buzz-Workspace-Plans — die relay-seitige Volltextsuche (NIP-50) über
 * den Workspace.
 *
 * ── Der Dateiname ist Teil der Mechanik ──────────────────────────────────────
 * `playwright.config.ts:57` filtert im Buzz-Modus auf
 * `/(?:buzz-.*|pin-room)\.spec\.ts$/` und überspringt alles andere LAUTLOS
 * („Total: 0 tests", kein Fehler). Ein Name ohne `buzz-`-Präfix hieße: dieser
 * Test läuft nie und niemand merkt es.
 *
 * ── Was hier NICHT geprüft wird, und warum ───────────────────────────────────
 * Kein Typeahead und keine live nachwachsenden Treffer: beides sind
 * Eigenschaften des Relays (`SearchMode::FullText` fest verdrahtet,
 * `req.rs:627`; Such-Filter nicht für Fan-out registriert, `req.rs:205-208`),
 * keine Umsetzungsfehler. Die Filterlogik selbst trägt `spaceSearch.test.ts`.
 * Hier steht nur, was ohne echten Roundtrip nicht prüfbar ist.
 */

const NAK = process.env.NAK ?? `${process.env.HOME}/go/bin/nak`
const WS = (): string => `ws://localhost:${BUZZ_PORT}`

/** Der zweite Seed-Raum aus `buzz-testserver.sh`. */
const GENERAL_H = '99cf94aa-b89d-5545-8905-495ea28a288e'

/**
 * Ein eigener PRIVATER Kanal für den Zugriffstest — **frische UUID je Lauf**.
 *
 * Der erste Entwurf nahm eine feste UUIDv5 wie die Seed-Räume, damit ein
 * zweiter Lauf denselben Kanal wiederverwendet. Das geht nicht, und zwar
 * nachweisbar: kind 9008 löscht **weich** (`channels.deleted_at`), die Zeile
 * bleibt stehen. Ein erneutes 9007 mit derselben UUID ist dann ein Duplikat —
 * der Kanal wird nicht neu angelegt, und die anschließende Nachricht scheitert
 * mit `restricted: not a channel member` (im Lauf vom 2026-08-17 genau so
 * passiert; in der Postgres nachgesehen: Zeile vorhanden, `deleted_at` gesetzt).
 *
 * Gezählt wird vom Bloat-Wächter nur, was ein 39000 aussendet — gelöschte
 * Kanäle tun das nicht (am laufenden Stack gegengezählt: 3 Zeilen in
 * `channels`, 2 Kanäle über Nostr sichtbar). Eine frische UUID je Lauf plus
 * `afterAll`-Löschung ist damit die Form, die weder kollidiert noch wächst.
 */
const PRIVATE_H = randomUUID()

/**
 * Suchbegriffe: **erfundene Einzelwörter, keine Bindestrich-Komposita.**
 * `to_tsvector('simple', …)` zerlegt „E2E-Buzz-welcome" in Teil-Lexeme, und
 * `websearch_to_tsquery` verknüpft die Teile eines Kompositums mit UND — der
 * Seed-String wäre dann je nach Schreibweise nicht wiederzufinden. Einzelne,
 * im Bestand sonst nicht vorkommende Wörter machen jeden Treffer eindeutig
 * zurechenbar.
 */
const WORD = 'Zwergpinguin'
const SECRET_WORD = 'Fledermausohr'
const PERSON_NAME = 'Schneeeulenwart'

const nak = (args: string[]): string => {
    const res = spawnSync(NAK, args, { encoding: 'utf8', timeout: 30_000 })

    return `${res.stdout ?? ''}\n${res.stderr ?? ''}`
}

const seedEvent = (sec: string, args: string[]): string =>
    nak(['event', '--auth', '--sec', sec, ...args, WS()])

/** Sucht per `nak` am Relay — die Gegenprobe außerhalb des Browsers. */
const searchAsRelay = (sec: string, query: string): string =>
    nak(['req', '--auth', '--sec', sec, '-k', '9', '--search', query, WS()])

/**
 * Eine Nachricht nur dann anlegen, wenn ihr Wortlaut noch nicht im Kanal steht.
 *
 * **Ohne diese Bremse wächst der Bestand bei jedem Lauf** — kind 9 ist nicht
 * ersetzbar, und der Bloat-Wächter in `buzz-testserver.sh` zählt ausschließlich
 * Nachrichten im `welcome`-Kanal sowie die Kanalzahl; im `general`-Kanal räumt
 * niemand auf. Im Lauf vom 2026-08-17 standen nach wenigen Durchgängen bereits
 * vier gleichlautende Treffer in der Liste, und die Prüfung scheiterte an
 * Playwrights Strict-Mode statt an der Sache. Dieselbe Inhalts-Sperre benutzt
 * `buzz-testserver.sh` für seine eigenen Seeds.
 */
const seedMessageOnce = (sec: string, h: string, content: string): void => {
    const existing = nak(['req', '--auth', '--sec', sec, '-k', '9', '-t', `h=${h}`, WS()])
    if (existing.includes(content)) {
        return
    }
    expect(seedEvent(sec, ['-k', '9', '-t', `h=${h}`, '-c', content])).toContain('success')
}

const palette = (page: Page) => page.locator('dialog[data-modal="command-palette"]')
const paletteInput = (page: Page) => page.locator('[data-palette-input]')
const results = (page: Page) => page.locator('[data-space-search]')

/**
 * Palette öffnen und einen Workspace-Suchtext eintippen — ohne Enter.
 *
 * `fill()` statt `type()`: Flux hängt seinen Filter an den `value`-Setter, und
 * Alpines `x-model` schreibt zurück; beides greift bei `fill` genauso, nur ohne
 * eine Sekunde Tastaturtakt.
 */
async function openWorkspaceScope(page: Page, text: string): Promise<void> {
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('open-command-palette')))
    await expect(palette(page)).toBeVisible({ timeout: 15_000 })
    // `w:` wird beim `input` in den Chip gehoben (`lift()`), der Rest bleibt im Feld.
    await paletteInput(page).fill(`w: ${text}`)
    await expect(results(page)).toBeVisible({ timeout: 15_000 })
}

/**
 * Liegt ein kind-0-Ereignis dieses Pubkeys im lokalen Bestand?
 *
 * Gemessen wird am IndexedDB-Spiegel des welshman-Repositories: `storage.ts`
 * persistiert `PROFILE` (kind 0), also ist ein dort fehlendes Profil auch im
 * Repository nie angekommen. Ein direkter Zugriff auf `repository` gäbe es
 * nicht — die Insel exportiert nichts ans `window`, und das soll sie auch nicht.
 */
async function profileCached(page: Page, pubkey: string): Promise<boolean> {
    return page.evaluate(async (pk) => {
        const names = await indexedDB.databases()
        for (const { name } of names) {
            if (!name) {
                continue
            }
            const db = await new Promise<IDBDatabase | null>((resolve) => {
                const req = indexedDB.open(name)
                req.onsuccess = () => resolve(req.result)
                req.onerror = () => resolve(null)
            })
            if (!db || !db.objectStoreNames.contains('events')) {
                db?.close()
                continue
            }
            const rows = await new Promise<unknown[]>((resolve) => {
                const req = db.transaction('events', 'readonly').objectStore('events').getAll()
                req.onsuccess = () => resolve(req.result as unknown[])
                req.onerror = () => resolve([])
            })
            db.close()
            const hit = rows.some((row) => {
                const event = row as { kind?: number; pubkey?: string }

                return event.kind === 0 && event.pubkey === pk
            })
            if (hit) {
                return true
            }
        }

        return false
    }, pubkey)
}

test.describe('Buzz-Workspace: NIP-50-Suche (E2E, nur E2E_RELAY=buzz)', () => {
    test.skip(process.env.E2E_RELAY !== 'buzz', 'nur im Buzz-Modus (E2E_RELAY=buzz) relevant')

    test.beforeAll(() => {
        // Öffentlicher Bestand im zweiten Seed-Raum — nur beim ersten Lauf.
        seedMessageOnce(BUZZ_USER_NSEC, GENERAL_H, `${WORD} am See`)

        // Ein PRIVATER Kanal des Owners mit einem Geheimwort — die Grundlage des
        // Zugriffstests. `visibility=private` ist die Stellschraube:
        // `get_accessible_channel_ids` (`buzz-db/src/channel.rs:754-777`) nimmt
        // nur eigene Mitgliedschaften UND Kanäle mit `visibility = 'open'`.
        expect(
            seedEvent(BUZZ_OWNER_SEC_HEX, [
                '-k', '9007',
                '-t', `h=${PRIVATE_H}`,
                '-t', 'name=E2E-Privat',
                '-t', 'visibility=private',
            ]),
        ).toContain('success')
        // Der private Kanal ist je Lauf frisch — hier braucht es keine Sperre.
        expect(
            seedEvent(BUZZ_OWNER_SEC_HEX, ['-k', '9', '-t', `h=${PRIVATE_H}`, '-c', `${SECRET_WORD} im privaten Kanal`]),
        ).toContain('success')

        // Ein Profil (kind 0) des Owners AM WORKSPACE-RELAY — genau die Sorte
        // Ereignis, die `core.ts` nicht ins Repository lässt.
        expect(
            seedEvent(BUZZ_OWNER_SEC_HEX, ['-k', '0', '-c', JSON.stringify({ name: PERSON_NAME, about: 'E2E-Profil' })]),
        ).toContain('success')
    })

    test.afterAll(() => {
        // Der private Kanal wird abgeräumt (kind 9008). Ohne das wächst der
        // Kanalbestand je Lauf, und der Wächter reißt den ganzen Stack neu auf.
        seedEvent(BUZZ_OWNER_SEC_HEX, ['-k', '9008', '-t', `h=${PRIVATE_H}`])
    })

    /**
     * **Der wichtigste Test dieser Phase.** Buzz sagt über seine eigene
     * Suchschicht: „Search is never the access boundary — it cannot widen
     * visibility" (`crates/buzz-search/src/query.rs:1-7`). Bricht das, ist es
     * ein Leck und kein UI-Fehler.
     *
     * Er läuft bewusst OHNE Browser: geprüft wird die Zugriffsgrenze des
     * Relays, nicht unsere Fläche. Ein Browser dazwischen könnte einen echten
     * Treffer verschlucken und den Test grün färben, obwohl der Relay ihn
     * herausgegeben hat — die Aussage wäre dann wertlos.
     *
     * Die Positivkontrolle steht daneben und ist nicht verhandelbar: ohne sie
     * hieße „null Treffer für den Fremden" auch dann bestanden, wenn der Inhalt
     * überhaupt nicht indiziert ist.
     */
    test('Zugriffsgrenze: ein Nicht-Mitglied findet den privaten Kanal über die Suche NICHT', () => {
        // Positivkontrolle: der Kanal-Eigentümer findet sein Geheimwort.
        const asOwner = searchAsRelay(BUZZ_OWNER_SEC_HEX, SECRET_WORD.toLowerCase())
        expect(asOwner.toLowerCase()).toContain(SECRET_WORD.toLowerCase())

        // Der eigentliche Fall: derselbe Suchbegriff, gestellt von einem
        // Relay-MITGLIED, das dem Kanal nicht angehört.
        const asStranger = searchAsRelay(BUZZ_USER_NSEC, SECRET_WORD.toLowerCase())
        expect(asStranger.toLowerCase()).not.toContain(SECRET_WORD.toLowerCase())

        // Und die Gegenprobe, dass derselbe Nutzer überhaupt suchen KANN —
        // sonst bewiese der Fall oben nur, dass seine Anfrage scheiterte.
        expect(searchAsRelay(BUZZ_USER_NSEC, WORD.toLowerCase()).toLowerCase()).toContain(WORD.toLowerCase())
    })

    test('Enter sucht am Relay und die Treffer erscheinen; ohne Enter passiert nichts', async ({ page }) => {
        await useBuzz(page)
        // `useBuzz` schaltet den Workspace bewusst AUS (sonst spräche der Lauf
        // das Produktions-Buzz an). Hier IST der Testrelay der Workspace — die
        // spätere Zuweisung gewinnt, es bleibt derselbe lokale Port.
        await page.addInitScript((url) => {
            ;(window as unknown as { __nostrWorkspace: string }).__nostrWorkspace = url
        }, BUZZ_URL)
        await loginNsec(page, BUZZ_USER_NSEC)
        await page.goto('/spaces')

        await openWorkspaceScope(page, WORD.toLowerCase())

        // Ohne Enter: kein Relay-Treffer. Das ist die sichtbare Form der
        // Relay-Eigenschaft „kein Typeahead" — und sie muss benannt sein, sonst
        // hält der Nutzer die Fläche für kaputt.
        await expect(page.locator('[data-space-search-idle]')).toBeVisible()
        await expect(page.locator('[data-space-search-message]')).toHaveCount(0)

        await paletteInput(page).press('Enter')

        // `.first()`, weil der Testrelay zwischen Läufen bestehen bleibt und aus
        // früheren Durchgängen gleichlautende Nachrichten tragen kann. Geprüft
        // wird, DASS der Treffer erscheint — nicht, wie oft er im Bestand steht.
        const hit = page.locator('[data-space-search-message]').filter({ hasText: WORD }).first()
        await expect(hit).toBeVisible({ timeout: 30_000 })
        await expect(page.locator('[data-space-search-idle]')).toHaveCount(0)
        // Kein „nichts gefunden" über einer gefüllten Liste, und keine Ablehnung.
        await expect(page.locator('[data-space-search-empty]')).toHaveCount(0)
        await expect(page.locator('[data-space-search-rejected]')).toHaveCount(0)
    })

    /**
     * Der Nachweis für Punkt 4 an der echten Strecke.
     *
     * `websearch_to_tsquery` versteht `or`, `matchFilter` nicht — es wertet nur
     * das erste Wort aus. Der Relay liefert also einen Treffer, dessen erstes
     * Suchwort im Text gar nicht vorkommt; welshman schiebt ihn nach
     * `onFiltered`, und ohne dessen Auswertung wäre die Liste leer.
     *
     * Am Relay vorab gemessen (2026-08-17): `--search 'kupferzwerg or
     * zwergpinguin'` liefert das Ereignis „Zwergpinguin am See",
     * `matchFilters([{kinds:[9],search:'kupferzwerg or zwergpinguin'}], event)`
     * derselben installierten Fassung liefert `false`.
     */
    test('ein Treffer, den matchFilters verwirft, steht trotzdem in der Liste', async ({ page }) => {
        await useBuzz(page)
        await page.addInitScript((url) => {
            ;(window as unknown as { __nostrWorkspace: string }).__nostrWorkspace = url
        }, BUZZ_URL)
        await loginNsec(page, BUZZ_USER_NSEC)
        await page.goto('/spaces')

        await openWorkspaceScope(page, `kupferzwerg or ${WORD.toLowerCase()}`)
        await paletteInput(page).press('Enter')

        await expect(
            page.locator('[data-space-search-message]').filter({ hasText: WORD }).first(),
        ).toBeVisible({ timeout: 30_000 })
    })

    /**
     * Der Nachweis für Punkt 5, als Differenz geführt: dasselbe kind 0 muss in
     * der Insel ankommen UND im Repository fehlen. Eine der beiden Hälften
     * allein bewiese nichts — „nicht im Cache" könnte auch heißen, dass es nie
     * jemand angefragt hat.
     */
    test('Personensuche liefert Treffer, ohne dass kind 0 im Repository landet', async ({ page }) => {
        await useBuzz(page)
        await page.addInitScript((url) => {
            ;(window as unknown as { __nostrWorkspace: string }).__nostrWorkspace = url
        }, BUZZ_URL)
        await loginNsec(page, BUZZ_USER_NSEC)
        await page.goto('/spaces')

        await openWorkspaceScope(page, PERSON_NAME.toLowerCase())
        await paletteInput(page).press('Enter')

        const person = page.locator('[data-space-search-person]').filter({ hasText: PERSON_NAME }).first()
        await expect(person).toBeVisible({ timeout: 30_000 })

        // Hälfte 2: derselbe Pubkey darf kein kind 0 im lokalen Bestand haben.
        // `syncEvents` batcht ~3 s — deshalb ein Poll-Fenster statt einer
        // Momentaufnahme, sonst prüfte der Test nur, dass noch nichts
        // geschrieben WURDE.
        const ownerPubkey = (await person.getAttribute('data-pubkey')) ?? ''
        expect(ownerPubkey).toHaveLength(64)
        await expect
            .poll(() => profileCached(page, ownerPubkey), { timeout: 8_000, intervals: [1_000] })
            .toBe(false)
    })

    /**
     * Der Leerzustand muss zwischen „nichts gefunden" und „nicht vollständig
     * geantwortet" unterscheiden. Hier ist der erste Fall dran: ein Wort, das
     * es im Bestand garantiert nicht gibt, bei einem Relay, der antwortet.
     */
    test('ein Wort ohne Treffer meldet „keine Treffer", nicht Stille', async ({ page }) => {
        await useBuzz(page)
        await page.addInitScript((url) => {
            ;(window as unknown as { __nostrWorkspace: string }).__nostrWorkspace = url
        }, BUZZ_URL)
        await loginNsec(page, BUZZ_USER_NSEC)
        await page.goto('/spaces')

        await openWorkspaceScope(page, 'quastenflossergrossmutter')
        await paletteInput(page).press('Enter')

        await expect(page.locator('[data-space-search-empty]')).toBeVisible({ timeout: 30_000 })
        await expect(page.locator('[data-space-search-message]')).toHaveCount(0)
    })
})
