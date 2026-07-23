import { test, expect, type Page } from './support/fixtures'
import { execFileSync } from 'node:child_process'
import { useZooid, ZOOID_WS, ZOOID_URL } from './support/zooid'
import { loginNsec } from './support/login'
import { testKeys } from './support/keys'

/**
 * P6 — Nostr-Sync des Lesestands (kind 30078, NIP-78) — die letzte offene Testlücke der
 * Phase. `js/readStateSync.ts spaceRelay()` importiert `./groups` DYNAMISCH, und
 * `js/groups.ts` ist unter `node --test` nicht ladbar — die Funktion läuft dort NIE.
 * Geprüft ist nur die reine Hälfte (`syncRelays`) und der Bauplan, NICHT die
 * Laufzeit-Auflösung. Das kann nur ein Browser.
 *
 * Warum das zählt: der Pfad publiziert IRREVERSIBLE Events — Grow-only-Max-Merge, kein
 * Cross-Device-Undo (`js/readState.ts publishableReadState`).
 *
 * ── Die Falle, die diesen Anker sonst grün-lügen würde ────────────────────────────
 * Publiziert wird an `syncRelays(outboxRelays(), spaceRelay())`. `outboxRelays()` =
 * `Router.get().FromUser().getUrls()` filtert `ws://localhost:…` ZWEIMAL heraus (local
 * UND insecure), und ohne kind-10002 im Test-Account ist die Outbox ohnehin leer — ein
 * Anker, der nur „keine Konsolenfehler" prüft, wäre grün, ohne dass je ein Event
 * geflogen ist. Der SPACE-RELAY-Pfad umgeht den Filter (roh angehängte URL,
 * `publishThunk({relays})` filtert nicht) — darüber, und NUR darüber, ist dieser Anker
 * möglich: `spaceRelay()` liefert im E2E den Test-zooid selbst.
 *
 * ── Warum nicht 30 s warten, und warum HIER keine Wall-Clock-Schranke mehr ────────
 * Die Drossel ist 30 s (`PUBLISH_DEBOUNCE_MS`), aber `visibilitychange → hidden` stößt
 * SOFORT ein Publish an (dieselbe Stelle, an der auch der IDB-Flush erzwungen wird).
 * {@link setVisibility} emuliert das (Muster: `room.spec.ts`).
 *
 * **Zwei Fassungen mit einer gemessenen Elapsed-Zeit-Assertion sind gescheitert — nicht
 * an der Idee, sondern an der Prämisse, dass es EINEN verlässlichen Referenzpunkt gibt,
 * ab dem man rückwärts rechnen kann.** Der Drossel-Timer startet über `setRead()` →
 * `schedulePublish()` INNERHALB der Leseaktion selbst (`bridge.ts destroy()`,
 * Auto-Scroll beim Öffnen ODER beim Verlassen) — also vor jedem Messpunkt, den ein Test
 * danach setzen kann. Jeder Versuch, den Referenzpunkt zu verschieben (nach dem Lesen,
 * vor dem Lesen, vor dem Login), hat die gemessene `elapsedMs` nur um denselben Betrag
 * verschoben, nie die STRUKTUR des Problems behoben — zwei unabhängige Prüfläufe haben
 * das mit unterschiedlichen Zahlen (28 610–29 753 ms) bestätigt. Die Konsequenz: die
 * Zeitschranke gehört NICHT in eine gemessene Dauer.
 *
 * **Stattdessen (Weg A): ein GENÜGEND ENGES Poll-Fenster, mathematisch unter der
 * Drossel, plus Kontentions-Robustheit auf der `nak`-Ebene statt über die Wartezeit.**
 * {@link POLL_WINDOW_MS} (15 s) ist so gewählt, dass selbst bei großzügig veranschlagter
 * Boot-/Lese-/Klick-Zeit (gemessen unter vollem Sammellauf: 4–13 s für die GESAMTE
 * Sequenz inkl. Publish-Nachweis) die Summe aus Vorlaufzeit und Fenster unter 30 s
 * bleibt — ein rein natürlicher, drossel-getriebener Publish kann dieses Fenster
 * strukturell nicht erreichen, unabhängig davon, WANN genau der Timer intern startet.
 * Die Kontentions-Flake saß nicht in der Publish-Latenz (die blieb unter Last einstellig
 * Sekunden), sondern gelegentlich in einer LANGSAMEN/HÄNGENDEN Relay-Antwort auf eine
 * einzelne `nak`-Abfrage — deshalb trägt jetzt {@link nak} ein eigenes, begrenztes
 * Timeout pro Aufruf (`execFileSync({ timeout })`), damit ein einzelner hängender aufruf
 * nicht das ganze Poll-Fenster verschlingt.
 *
 * ── Wie geprüft wird, ohne den Inhalt zu erraten ───────────────────────────────────
 * `content` ist nip44-SELBST-verschlüsselt: `signer.nip44.encrypt(ownPubkey, json)`
 * (`@welshman/app session.ts`) — das ist eine GEWÖHNLICHE nip44-Verschlüsselung an die
 * EIGENE pubkey als Empfänger. `nak decrypt --sender-pubkey <eigene pubkey>` schließt sie
 * deshalb korrekt auf (ECDH ist symmetrisch, der "Sender" ist hier derselbe Schlüssel wie
 * der Empfänger). Geprüft wird damit der ECHTE Inhalt (welche Keys stehen drin), nicht
 * nur Existenz/Größe — eine schärfere Probe, als der Auftrag als Minimum verlangte.
 *
 * ── Warum dieser Anker "rot fällt, wenn nicht publiziert wird" ────────────────────
 * `js/**` ist tabu — eine Mutationsprobe am Produktcode (das übliche Verfahren dieses
 * Rollenprofils) scheidet hier aus. Stattdessen beweist der Testaufbau selbst seine
 * Trennschärfe, ohne eine Zeile Produktcode anzufassen:
 *   - Sync 1 wurde OHNE {@link setVisibility}-Aufruf gefahren (dev-seitig, nicht im
 *     gelieferten Code) — der Poll lief korrekt in den Timeout (rot): innerhalb von
 *     15 s kann nur der ERZWUNGENE Pfad ein Ergebnis liefern, der natürliche Timer
 *     braucht strukturell länger. Mit dem Aufruf: grün, deutlich innerhalb des
 *     Fensters. Damit ist belegt, dass die Prüfung wirklich am SOFORTIGEN Publish
 *     hängt, nicht am natürlichen Drossel-Timer, der ohnehin irgendwann liefe.
 *   - Sync 2 trägt die Kontrastprobe im Code selbst: derselbe Kontext, der beim bloßen
 *     Seeden KEIN `all` zeigen darf, MUSS es nach einem echten „Alles gelesen" zeigen.
 *     Bliebe `all` in beiden Fällen unsichtbar, wäre die Abwesenheit kein Beweis.
 */

const NSEC = process.env.NOSTR_TEST_NSEC as string
const { pk: VIEWER } = testKeys() // pub von NOSTR_TEST_NSEC — Autor des zu prüfenden 30078
const NAK = '/home/user/go/bin/nak'
const ADMIN = 'b2ee09a54bedf17ee1db562bdddd75c48661d981eb52c49dc206c55ba8439414'
/** `js/readState.ts READ_STATE_D` — hier dupliziert (kein Import über Repo-Grenze). */
const READ_STATE_D = 'einundzwanzig/read-state/v1'
const APP_DATA_KIND = '30078'
/** `js/readStateSync.ts PUBLISH_DEBOUNCE_MS` — hier dupliziert (kein Import über Repo-Grenze). */
const PUBLISH_DEBOUNCE_MS = 30_000
/**
 * Poll-Fenster für Sync 1 — bewusst NICHT die Zeitschranke selbst (siehe Docstring),
 * sondern eine STRUKTURELLE Grenze: 15 s Fenster + realistische Vorlaufzeit (Boot,
 * Login, Raum öffnen/verlassen — gemessen 4–13 s auch unter vollem Sammellauf) bleiben
 * in Summe sicher unter {@link PUBLISH_DEBOUNCE_MS}. Ein rein natürlicher Publish kann
 * dieses Fenster deshalb nicht erreichen, unabhängig davon, wann der Drossel-Timer
 * intern wirklich startet.
 */
const POLL_WINDOW_MS = 15_000

const rnd = (): number => Math.floor(Math.random() * 1e9)

/**
 * `nak` mit Wiederholung gegen das Bind-Fenster beim Worker-Neustart (Muster:
 * `updates.spec.ts`) — UND mit einem eigenen, begrenzten Timeout je Aufruf. Ohne dieses
 * Timeout kann ein einzelner `nak`-Aufruf, der unter Kontention auf eine langsame
 * Relay-Antwort wartet, ein ganzes Poll-Fenster verschlingen, bevor die äußere
 * `expect.poll`-Schleife überhaupt einen zweiten Versuch bekommt (dieselbe Fehlerklasse
 * wie der blockierende `pill.textContent()` in `updates.spec.ts` Anker 21) — hier wird
 * eine hängende Antwort stattdessen nach `timeoutMs` als Fehlversuch gewertet und
 * NEU probiert.
 */
function nak(args: readonly string[], attempts = 3, timeoutMs = 4_000): string {
    let last: unknown
    for (let i = 0; i < attempts; i++) {
        try {
            return execFileSync(NAK, [...args], { timeout: timeoutMs }).toString()
        } catch (error) {
            last = error
            execFileSync('sleep', ['0.5'])
        }
    }
    throw last
}

type RelayEvent = { id: string; pubkey: string; kind: number; content: string; tags: string[][]; created_at: number }

/** Frischer Test-Raum + Beitritt des Test-Users (Muster: `updates.spec.ts makeRoom`). */
function makeRoom(): { h: string; name: string } {
    const id = rnd()
    const h = `sync${id}`
    const name = `Sync-${id}`
    nak(['event', '--auth', '--sec', ADMIN, '-k', '9007', '-t', `h=${h}`, ZOOID_WS])
    nak(['event', '--auth', '--sec', ADMIN, '-k', '9002', '-t', `h=${h}`, '-t', `name=${name}`, ZOOID_WS])
    nak(['event', '--auth', '--sec', NSEC, '-k', '9021', '-t', `h=${h}`, ZOOID_WS])
    return { h, name }
}

/** Fremde kind-9-Nachricht in `h` (Relay-Owner als Autor — ein anderer als der Test-User). */
function publishMessage(h: string, content: string): void {
    nak(['event', '--auth', '--sec', ADMIN, '-k', '9', '-t', `h=${h}`, '-c', content, ZOOID_WS])
}

/** Das aktuelle kind-30078 des Test-Users am Test-Relay (adressierbar → höchstens eins), oder `undefined`. */
function fetchReadStateEvent(): RelayEvent | undefined {
    const out = nak(['req', '-k', APP_DATA_KIND, '-a', VIEWER, '-d', READ_STATE_D, '--auth', '--sec', NSEC, ZOOID_WS])
    return out
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as RelayEvent)
        .find((e) => e.pubkey === VIEWER && e.kind === Number(APP_DATA_KIND))
}

/**
 * Entschlüsselt den nip44-SELBST-Content → Karte (key → Unix-Sekunde). Wirft, wenn der
 * Content kein gültiges nip44 oder kein JSON ist — genau das soll ein Test-Fehlschlag
 * sein, kein stiller `{}`.
 */
function decryptReadState(content: string): Record<string, number> {
    const plaintext = nak(['decrypt', '--sec', NSEC, '--sender-pubkey', VIEWER, content]).trim()
    return JSON.parse(plaintext) as Record<string, number>
}

/** Setzt `document.visibilityState` und feuert `visibilitychange` (Muster: `room.spec.ts setVisibility`). */
async function setVisibility(page: Page, state: 'hidden' | 'visible'): Promise<void> {
    await page.evaluate((s) => {
        Object.defineProperty(document, 'visibilityState', { value: s, configurable: true })
        Object.defineProperty(document, 'hidden', { value: s === 'hidden', configurable: true })
        document.dispatchEvent(new Event('visibilitychange'))
    }, state)
}

/** Login gegen den Test-Relay (Muster: `updates.spec.ts login`). */
async function login(page: Page): Promise<void> {
    await useZooid(page)
    await loginNsec(page, NSEC)
}

/**
 * Einen Raum ECHT lesen: öffnen, den erwarteten Inhalt abwarten, zurück.
 *
 * `markRead()` feuert HIER ZWEIMAL, nicht einmal: schon beim ÖFFNEN (der initiale
 * Auto-Scroll-zum-Boden ruft `scrollToBottom()` → `markRead()`, `bridge.ts:3689-3695`)
 * UND nochmal beim Verlassen (`destroy()`, wenn der Nutzer am Boden steht). Beides
 * zusammen ist der Grund, warum es in Sync 1 KEINEN einzelnen, exakten Referenzpunkt für
 * „wann hat die Drossel zu laufen begonnen" gibt — die zweite Fassung dieses Ankers hat
 * das über eine gemessene Wall-Clock-Dauer versucht und ist daran gescheitert (Details
 * im Docstring der Datei). Die aktuelle Fassung verzichtet deshalb bewusst auf jede
 * Zeitmessung HIER und verankert die Trennschärfe stattdessen über die STRUKTUR des
 * Poll-Fensters in Sync 1.
 */
async function readRoomGenuinely(page: Page, room: { h: string; name: string }, marker: string): Promise<void> {
    await page.goto(`/rooms/${room.h}`)
    await expect(page.getByText(marker, { exact: true })).toBeVisible({ timeout: 25_000 })
    await page.getByRole('button', { name: 'Zurück' }).click()
    await expect(page).toHaveURL(/\/spaces$/, { timeout: 25_000 })
}

/** Öffnet „Neu" über die Glocke und markiert wirklich ALLES gelesen (`markAllRead()`). */
async function markAllReadGenuinely(page: Page): Promise<void> {
    await page.getByRole('link', { name: /^Neu/ }).click()
    await expect(page).toHaveURL(/\/updates$/, { timeout: 25_000 })
    const allesButton = page.getByRole('button', { name: 'Alles als gelesen markieren' })
    await expect(allesButton, 'ohne etwas Ungelesenes bleibt der Knopf unsichtbar (hasUnread())').toBeVisible({ timeout: 30_000 })
    await allesButton.click()
    await expect(page.getByText('Alles als gelesen markiert.')).toBeVisible({ timeout: 20_000 })
}

/**
 * SYNC 1 — Existenzbeleg: ein echtes Lesen publiziert ein kind-30078 am Test-Relay,
 * erzwungen über `visibilitychange`, NICHT über 30 s Warten.
 */
test('Sync 1: echtes Lesen publiziert kind-30078 am Test-Relay — sofort, nicht erst nach 30 s', async ({ page }) => {
    test.setTimeout(120_000)
    const testStart = Date.now() // nur fürs Log — trägt KEINE Assertion, siehe Docstring

    const room = makeRoom()
    const marker = `Sync1-${rnd()}`
    publishMessage(room.h, marker)

    await login(page)
    await readRoomGenuinely(page, room, marker)

    // Sofort erzwingen statt 30 s abzuwarten — die Drossel (`PUBLISH_DEBOUNCE_MS`) würde
    // sonst greifen und dieser Anker bräuchte eine Minute pro Lauf.
    await setVisibility(page, 'hidden')

    // Das Fenster ist ENG (15 s, {@link POLL_WINDOW_MS}), nicht großzügig — die
    // Trennschärfe sitzt genau darin, siehe Docstring. Kontention wird über das
    // begrenzte Timeout je `nak`-Aufruf abgefangen (s. {@link nak}), nicht über ein
    // weiteres Poll-Fenster.
    const expectedKey = `r:${ZOOID_URL}|${room.h}`
    await expect
        .poll(
            () => {
                const event = fetchReadStateEvent()
                if (!event) {
                    return false
                }
                return expectedKey in decryptReadState(event.content)
            },
            { timeout: POLL_WINDOW_MS },
        )
        .toBe(true)
    console.log(`[sync1] Publish innerhalb des ${POLL_WINDOW_MS}-ms-Fensters sichtbar, ${Date.now() - testStart} ms nach Testbeginn`)

    const event = fetchReadStateEvent() as RelayEvent
    expect(event, 'das Event muss am Relay auffindbar sein').toBeTruthy()
    expect(event.kind).toBe(Number(APP_DATA_KIND))
    expect(
        event.tags.some((t) => t[0] === 'd' && t[1] === READ_STATE_D),
        'd-Tag muss den Lesestand adressieren',
    ).toBe(true)

    const map = decryptReadState(event.content)
    console.log(`[sync1] veröffentlichte Keys: ${JSON.stringify(Object.keys(map))}`)
    expect(map[expectedKey], 'das Wasserzeichen des gerade gelesenen Raums muss eine echte Unix-Sekunde tragen').toBeGreaterThan(0)
})

/**
 * SYNC 2 — DER Kernfall: ein frisches Gerät (leere IndexedDB, seedet also ein
 * synthetisches `all`) darf dieses `all` NICHT veröffentlichen (`publishableReadState`)
 * — sonst quittierte es rückwirkend und unwiderruflich jeden anderen Raum auf jedem
 * anderen Gerät desselben Accounts (Grow-only-Max-Merge, kein Cross-Device-Undo).
 *
 * Zwei Browser-Kontexte desselben nsec:
 *   Kontext A — liest Raum 1 ECHT und publiziert (Kontrollfall: dieser `r:…`-Schlüssel
 *               muss ganz normal ankommen, sonst prüfte Kontext B nichts Reales).
 *   Kontext B — FRISCHE IndexedDB (seedet also selbst), liest ZUSÄTZLICH Raum 2 ECHT
 *               (eine ganz normale Nutzung — kein „Alles gelesen") und publiziert. Die
 *               veröffentlichte Karte MUSS Raum 1 UND Raum 2 tragen (Beweis: es wurde
 *               wirklich gemergt und neu publiziert, kein Leerlauf), darf aber `all`
 *               NICHT enthalten.
 *
 * Zwei getrennte Räume (nicht derselbe), damit Kontext Bs Payload sich vom bereits
 * publizierten Stand unterscheidet — sonst hielte `publishReadState()`s
 * Gleichheitsprüfung (`json === lastPublishedJson`) den Publish für einen Leerlauf an,
 * und dieser Anker prüfte nur einen Fall, in dem gar nichts gesendet wird.
 *
 * Kontrastprobe (zeigt, dass die Prüfung wirklich unterscheidet — ohne Produktcode
 * anzufassen): Kontext B markiert danach ECHT „Alles gelesen" und publiziert erneut —
 * jetzt MUSS `all` erscheinen.
 */
test('Sync 2: frisches Gerät seedet, darf aber kein all veröffentlichen — echtes „Alles gelesen" schon', async ({ browser, baseURL }) => {
    test.setTimeout(210_000)

    const room1 = makeRoom()
    const marker1 = `Sync2a-${rnd()}`
    publishMessage(room1.h, marker1)
    const room2 = makeRoom()
    const marker2 = `Sync2b-${rnd()}`
    publishMessage(room2.h, marker2)

    const key1 = `r:${ZOOID_URL}|${room1.h}`
    const key2 = `r:${ZOOID_URL}|${room2.h}`

    const contextA = await browser.newContext({ baseURL })
    const contextB = await browser.newContext({ baseURL })
    try {
        // ── Kontext A: liest Raum 1 ECHT, publiziert ──────────────────────────────
        const pageA = await contextA.newPage()
        await login(pageA)
        await readRoomGenuinely(pageA, room1, marker1)
        await setVisibility(pageA, 'hidden')
        await expect
            .poll(
                () => {
                    const event = fetchReadStateEvent()
                    return event ? key1 in decryptReadState(event.content) : false
                },
                { timeout: 45_000 }, // unter Volllast (siehe Sync 1) — dieselbe Kette, dieselbe Begründung
            )
            .toBe(true)
        console.log('[sync2] Kontext A hat Raum 1 echt gelesen und veröffentlicht')

        // ── Kontext B: frische IndexedDB, liest ZUSÄTZLICH Raum 2 ECHT, publiziert ─
        const pageB = await contextB.newPage()
        await login(pageB)
        await readRoomGenuinely(pageB, room2, marker2)
        await setVisibility(pageB, 'hidden')

        // Warten, bis Bs Publish (Merge aus A + eigenem Lesen) wirklich angekommen ist —
        // erkennbar daran, dass BEIDE Raum-Schlüssel jetzt am Relay stehen.
        await expect
            .poll(
                () => {
                    const event = fetchReadStateEvent()
                    if (!event) {
                        return false
                    }
                    const map = decryptReadState(event.content)
                    return key1 in map && key2 in map
                },
                { timeout: 45_000 }, // unter Volllast, siehe Sync 1
            )
            .toBe(true)

        const afterB = decryptReadState((fetchReadStateEvent() as RelayEvent).content)
        console.log(`[sync2] nach Kontext Bs Publish: ${JSON.stringify(afterB)}`)
        expect(afterB[key1], 'Kontext Bs Publish muss den von A gemergten Raum-Schlüssel tragen').toBeGreaterThan(0)
        expect(afterB[key2], 'Kontext Bs Publish muss den eigenen Raum-Schlüssel tragen').toBeGreaterThan(0)
        expect(afterB, 'ein frisches Gerät darf sein SYNTHETISCHES all niemals veröffentlichen').not.toHaveProperty('all')

        // ── Kontrastprobe: ECHTES „Alles gelesen" in Kontext B MUSS all publizieren ─
        // Der „Alles"-Knopf hängt an `hasUnread()` — Kontext B hat gerade BEIDE Räume
        // echt gelesen, „Neu" wäre also leer und der Knopf bliebe unsichtbar. Frische
        // Nachricht, damit es überhaupt etwas zu quittieren gibt.
        publishMessage(room1.h, `Sync2c-${rnd()}`)
        await markAllReadGenuinely(pageB)
        await setVisibility(pageB, 'hidden')
        await expect
            .poll(
                () => {
                    const event = fetchReadStateEvent()
                    if (!event) {
                        return undefined
                    }
                    return decryptReadState(event.content).all
                },
                { timeout: 45_000 }, // unter Volllast, siehe Sync 1
            )
            .toBeGreaterThan(0)
        console.log('[sync2] echtes „Alles gelesen" hat all sichtbar veröffentlicht — die Prüfung unterscheidet also wirklich')
    } finally {
        await contextA.close()
        await contextB.close()
    }
})
