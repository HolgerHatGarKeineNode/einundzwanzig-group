import { test, expect, type Locator, type Page } from './support/fixtures'
import { execFileSync } from 'node:child_process'
import { neventEncode, npubEncode } from 'nostr-tools/nip19'
import { useZooid, ZOOID_WS } from './support/zooid'
import { loginNsec } from './support/login'
import { cleanupRooms, trackRoom } from './support/rooms'

/**
 * P5 — Nostr-Zitatkarten im Chat (`js/nostrEventLink.ts` + `js/feeds.ts`
 * `buildRefCard`). Reine Parsing-/Prioritäts-/Klickziel-Logik deckt
 * `js/nostrEventLink.test.ts` (node --test) ab — hier NUR, was einen echten Browser
 * braucht: welshman-Reaktivität (Nachladen), DOM-Klick-Verhalten, die
 * Einstellungs-Persistenz und das geteilte `chat-row`-Markup im Thread-Panel.
 *
 * ── Die Regel, die diese Datei bewacht (2026-08-16) ────────────────────────────────
 * Eine Karte bekommt NUR ein zitiertes EREIGNIS (`nostr:nevent…`/`note1…`) — es bringt
 * fremden Inhalt mit (Autor + Ausschnitt) und rechtfertigt eigene Fläche. Ein im Text
 * referenziertes PROFIL bekommt ausnahmslos keine: es steht inline als `@Name` im
 * Fließtext, auch mehrfach, auch als einziges Element, auch im Thread-Root und in
 * Kommentaren. Bis zum 2026-08-15 gab es dafür einen Profil-Chip über dem Text, dessen
 * `@Name` aus dem Fließtext geschnitten wurde; das zerriss jeden Satz, der mehrere
 * Personen nennt (Befund 2026-08-16, Test 10).
 *
 * Die Erwähnungen werden hier über die KLASSE `.mention` adressiert, nie über ihr Tag:
 * geprüft ist „diese Person steht als Name im Text", nicht „das Element ist ein span".
 * Ein `span.mention` würde bei jedem Umbau des Elements still auf null Treffer fallen
 * und der Test bliebe grün, ohne noch irgendetwas zu messen.
 *
 * ── Determinismus ─────────────────────────────────────────────────────────────────
 * Jeder Test legt seinen EIGENEN Raum an (`trackRoom` + `cleanupRooms` in
 * `afterAll`, Muster `support/rooms.ts`). Räume/Nachrichten kommen ausschließlich per
 * `nak` roh auf den Relay — nicht über den Composer — weil P5 exakte Kontrolle über
 * Event-IDs, Tags und den `nostr:`-Referenztext braucht (dieselbe Begründung wie
 * `room.spec.ts` C0).
 */

const NSEC = process.env.NOSTR_TEST_NSEC as string
const NAK = process.env.NAK ?? `${process.env.HOME}/go/bin/nak`
// Relay-Owner-Secret (= relay.self). Kind-0 „Relay Admin" ist Teil des Seeds
// (zooid-testserver.sh:280) — derselbe Präzedenzfall wie in room.spec.ts/updates.spec.ts.
const ADMIN = 'b2ee09a54bedf17ee1db562bdddd75c48661d981eb52c49dc206c55ba8439414'
const ADMIN_PUB = 'da99fbe39247109327ac8504750d0227d50a8f84049ac8bd2f6c7ad0806ed76d'

type RelayEvent = { id: string; pubkey: string; kind: number; content: string; tags: string[][]; created_at: number }

const rnd = (): number => Math.floor(Math.random() * 1e9)

/** `nak` mit Wiederholung — gegen Umgebungs-Transienz, nicht gegen Produktfehler (Muster updates.spec.ts). */
function nak(args: readonly string[], attempts = 3): string {
    let last: unknown
    for (let i = 0; i < attempts; i++) {
        try {
            return execFileSync(NAK, [...args]).toString()
        } catch (error) {
            last = error
            execFileSync('sleep', ['1'])
        }
    }
    throw last
}

/** Frischer Wegwerf-Raum (kind 9007 + 9002), abgeräumt am Dateiende. */
function createRoomNak(h: string, name: string): void {
    nak(['event', '--auth', '--sec', ADMIN, '-k', '9007', '-t', `h=${h}`, ZOOID_WS])
    nak(['event', '--auth', '--sec', ADMIN, '-k', '9002', '-t', `h=${h}`, '-t', `name=${name}`, ZOOID_WS])
}

/** Erstes Event am Relay, das `pred` erfüllt. */
function findEvent(h: string, kind: number, pred: (e: RelayEvent) => boolean): RelayEvent | undefined {
    return nak(['req', '-k', String(kind), '-t', `h=${h}`, '--auth', '--sec', ADMIN, ZOOID_WS])
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as RelayEvent)
        .find(pred)
}

/**
 * Publiziert eine kind-9-Raumnachricht mit vollständiger Tag-/Zeit-Kontrolle und gibt
 * ihre Event-id zurück (per Requery — nak druckt beim Publish ebenfalls JSON, aber
 * `findEvent` ist der bereits an diesem Relay bewährte Weg, siehe updates.spec.ts).
 */
function publishRaw(h: string, sec: string, content: string, extraTags: string[] = [], ts?: number): string {
    const args = ['event', '--auth', '--sec', sec, '-k', '9', '-t', `h=${h}`, ...extraTags, '-c', content]
    if (ts !== undefined) {
        args.push('--ts', String(ts))
    }
    args.push(ZOOID_WS)
    nak(args)
    return (findEvent(h, 9, (e) => e.content === content) as RelayEvent).id
}

/** NIP-22-Kommentar (kind 1111) auf `rootId` — Tag-Form wie die App sie schreibt (room.spec.ts C6b). */
function publishComment(h: string, rootId: string, rootKind: number, sec: string, content: string): void {
    nak([
        'event', '--auth', '--sec', sec, '-k', '1111',
        '-t', `E=${rootId}`, '-t', `e=${rootId}`, '-t', `k=${rootKind}`, '-t', `h=${h}`,
        '-c', content, ZOOID_WS,
    ])
}

async function openRoom(page: Page, h: string): Promise<void> {
    await useZooid(page)
    await loginNsec(page, NSEC)
    await page.goto(`/rooms/${h}`)
}

/**
 * Alle Referenz-FLÄCHEN einer Zeile — die Frage „hat diese Zeile überhaupt eine Karte?".
 *
 * Die Flächen von `chat-row.blade.php` (Antwort-Vorschau, Zitatkarte und — bis zum
 * 2026-08-16 — der Profil-Chip) teilen sich EINE Randmarke, dort einmal als `$quoteRail`
 * definiert. Der Selektor nennt damit keinen Kartentyp beim Namen: kehrt der Chip zurück
 * ODER kommt eine weitere Kartenart dazu, fällt sie hier auf, ohne dass dieser Test sie
 * kennen müsste. Ein Locator auf `button[aria-label ^= "Profil anzeigen: "]` täte das
 * nicht — er beschriebe eine Fassung, die es nicht mehr gibt, und bliebe gegen jede
 * andere Fläche blind.
 *
 * **Zwei Signale, ODER-verknüpft — und das ist kein Gürtel-und-Hosenträger, sondern deckt
 * zwei verschiedene stille Ausfälle ab (beide 2026-08-16 beim Umbau gemessen bzw. am Code
 * belegt):**
 *   • `[data-quote-rail]` — das ausdrückliche Attribut an jeder Rail-Fläche. Es überlebt
 *     eine Umbenennung der Tailwind-Utility; ohne es wäre der Selektor bei einem
 *     Klassen-Refactoring still auf null Treffer gefallen und jedes `toHaveCount(0)`
 *     wortlos grün geblieben.
 *   • `[class*="border-l-2"]` — die sichtbare Randmarke selbst. Sie fängt eine NEUE Fläche
 *     auch dann, wenn ihr Autor das Attribut vergisst. Genau das wäre bei der M1-Probe
 *     passiert: die zurückgedrehte Chip-Fassung trug `class="{{ $quoteRail }} …"`, aber
 *     kein `data-quote-rail` — mit dem Attribut ALLEIN wäre die Mutation unentdeckt
 *     geblieben und dieser Test hätte den Defekt nicht mehr gefangen.
 * Heute treffen beide Zweige dieselbe Elementmenge; der Nutzen liegt jeweils im Ausfall
 * des anderen.
 */
const kartenFlaechen = (row: Locator): Locator => row.locator('[data-quote-rail], [class*="border-l-2"]')

test.afterAll(() => cleanupRooms(ZOOID_WS, ADMIN))

// ── 1) Im geladenen Fenster: sofort aufgelöst, Klick springt ────────────────────────

test('Zitatkarte: im geladenen Fenster löst sofort auf, Klick springt zur zitierten Nachricht', async ({ page }) => {
    const h = trackRoom(`qc1${rnd()}`)
    createRoomNak(h, 'QC1')

    const rootMarker = `QCRoot-${rnd()}`
    const rootId = publishRaw(h, ADMIN, rootMarker)
    const nevent = neventEncode({ id: rootId, relays: [], author: ADMIN_PUB, kind: 9 })
    const refMarker = `QCRef-${rnd()}`
    publishRaw(h, ADMIN, `${refMarker} nostr:${nevent}`)

    await openRoom(page, h)
    await expect(page.getByText(refMarker, { exact: false })).toBeVisible({ timeout: 15_000 })

    const row = page.locator('div.group', { hasText: refMarker })
    // Resolved sofort (beide Nachrichten im initialen 50er-Fenster): die Karte zeigt
    // Autorname + Textausschnitt, nicht die gekürzte Kennung.
    const card = row.getByRole('link', { name: new RegExp(rootMarker) })
    await expect(card).toBeVisible({ timeout: 15_000 })

    await card.click()
    // Fall A (§3.2 p5-recon.md): aufgelöst UND im Fenster → scrollToMessage, KEINE Navigation.
    await expect(page).toHaveURL(new RegExp(`/rooms/${h}$`))
    await expect(page.locator(`#msg-${rootId}`)).toHaveClass(/ring-brand-500/, { timeout: 5_000 })
})

// ── 2) Außerhalb des Fensters, Selbstzitat: asynchron aufgelöst, Klick öffnet Thread warm, html stabil ──

test('Zitatkarte: außerhalb des Fensters — Selbstzitat löst asynchron auf, Klick öffnet den Thread warm, das gerenderte html bleibt stabil', async ({ page }) => {
    test.setTimeout(60_000)
    // Root lebt in einem ZWEITEN Raum, den der Browser NIE besucht — „außerhalb des
    // Fensters" damit strukturell garantiert (kein Ratespiel über die
    // Auto-Nachlade-Schwelle des Scrollers, `js/scroll.ts` threshold:3000px, die bei
    // kleinen Räumen schon beim Mount die volle Historie zieht). Root bleibt dem
    // Client bis zum expliziten `load({ids})` unbekannt — genau der Fall, den P5s
    // `warmRefEvents` abdecken muss. Cross-Room-Auflösung ist gemessen (nak: ein
    // `{"ids":[…]}`-Filter ohne `#h` liefert das Event unabhängig vom Raum).
    const hRoot = trackRoom(`qc2root${rnd()}`)
    const hRef = trackRoom(`qc2ref${rnd()}`)
    createRoomNak(hRoot, 'QC2Root')
    createRoomNak(hRef, 'QC2Ref')

    const rootMarker = `QCSelf-${rnd()}`
    // Selbstzitat (derselbe Autor wie Root) isoliert den Memo-Key-Fehler: eine andere
    // Autorenschaft würde `profileRefs` beim Auflösen ZUSÄTZLICH ändern und den Cache
    // aus einem anderen Grund busten — genau die Falle, in die der Autor laut Auftrag
    // selbst lief.
    const rootId = publishRaw(hRoot, ADMIN, rootMarker)
    const nevent = neventEncode({ id: rootId, relays: [], author: ADMIN_PUB, kind: 9 })
    const refMarker = `QCSelfRef-${rnd()}`
    publishRaw(hRef, ADMIN, `${refMarker} nostr:${nevent}`)

    await openRoom(page, hRef)
    await expect(page.getByText(refMarker, { exact: false })).toBeVisible({ timeout: 15_000 })
    // Root gehört zu `hRoot`, den dieser Browser nie besucht — die eigene Chat-Zeile
    // des Root-Events kann in `hRef` unter keinen Umständen entstehen (kein
    // Zeit-Wettlauf: das ist strukturell ausgeschlossen, unabhängig davon, wie schnell
    // `warmRefEvents` die Karte auflöst).

    const row = page.locator('div.group', { hasText: refMarker })
    // welshman rendert die Referenz UNABHÄNGIG von der Karte als njump-Link im
    // `m.html`-Fließtext (renderEvent → addEntityLink, render.js:61) — der ist der
    // Beweis für Punkt 6 (§1.5/§6.2 p5-recon.md): sein Text darf sich NICHT ändern,
    // während die Karte von unaufgelöst auf aufgelöst kippt.
    const njumpLink = row.locator('.chat-content a[href^="https://njump.me/"]')
    await expect(njumpLink).toBeVisible({ timeout: 15_000 })

    // Root liegt beim Öffnen von `hRef` GARANTIERT noch nicht im lokalen Repository
    // (anderer Raum, frischer Browser-Kontext) — die Karte MUSS also den asynchronen
    // `warmRefEvents`-Pfad durchlaufen, um von der gekürzten Kennung auf Autorname +
    // Textausschnitt zu kippen. Der Zwischenzustand selbst ist auf einem lokalen Relay
    // zu schnell vorbei, um ihn ohne künstliche Verzögerung deterministisch zu fangen
    // (der unauflösbare Fall dafür: Test 3) — geprüft wird hier das ERGEBNIS des
    // Nachladens (P5-Kernbefund): ohne die reaktive Quelle bliebe das für immer aus.
    const resolvedCard = row.getByRole('link', { name: new RegExp(rootMarker) })
    await expect(resolvedCard).toBeVisible({ timeout: 20_000 })
    await expect(row.getByRole('link', { name: /Zitiertes Ereignis/ })).toHaveCount(0)

    // htmlCache darf keinen Kartenzustand tragen: der gerenderte Nachrichtentext ist
    // rein aus dem EVENT-INHALT bestimmt. welshman rendert das Event als Entity-Link
    // auf `https://njump.me/<entity>` (render.js `renderEvent`/`addEntityLink`); das
    // Package überschreibt nur `renderLink` (`js/feeds.ts linkDisplay`), das den vollen
    // Link-Text aus der href rekonstruiert (KEINE Kürzung) — Anzeigetext ist also exakt
    // die volle njump-URL. `neventEncode` re-kodiert das Pointer-Objekt deterministisch
    // (gemessen 2026-08-11: derselbe Pointer kodiert immer zur selben bech32-Kette), der
    // Vergleich braucht deshalb keinen Zeit-Wettlauf gegen die Auflösung — er gilt für
    // den bereits AUFGELÖSTEN Endzustand genauso wie für den unaufgelösten.
    const expectedNjumpText = `https://njump.me/${nevent}`
    await expect(njumpLink).toHaveText(expectedNjumpText)
    const chatContentText = ((await row.locator('.chat-content').textContent()) ?? '').trim()
    expect(chatContentText, 'htmlCache darf keinen Kartenzustand tragen — kein Zusatztext neben dem reinen Event-Inhalt').toBe(`${refMarker} ${expectedNjumpText}`)

    await resolvedCard.click()
    // Fall B (§3.2): aufgelöst, aber NICHT im Fenster → Thread öffnet WARM (openThread),
    // keine harte Navigation (URL bleibt kosmetisch/replaceState, kein toter Klick).
    const dialog = page.getByRole('dialog', { name: 'Thread' })
    await expect(dialog).toBeVisible({ timeout: 15_000 })
    await expect(dialog.getByText(rootMarker).first()).toBeVisible()
})

// ── 3) Unauflösbares Ereignis: kollabiert nicht, Klick navigiert normal ─────────────

test('Zitatkarte: unauflösbares Ereignis kollabiert nicht und zeigt die gekürzte Kennung, Klick navigiert zum Thread', async ({ page }) => {
    const h = trackRoom(`qc3${rnd()}`)
    createRoomNak(h, 'QC3')

    // Syntaktisch gültige, aber nie publizierte id — löst nie auf (kein Flake durch
    // Netzwerk-Timing, das Ergebnis ist von vornherein feststehend).
    const ghostId = '11'.repeat(32)
    const nevent = neventEncode({ id: ghostId, relays: [], kind: 9 })
    const refMarker = `QCGhost-${rnd()}`
    publishRaw(h, ADMIN, `${refMarker} nostr:${nevent}`)

    await openRoom(page, h)
    await expect(page.getByText(refMarker, { exact: false })).toBeVisible({ timeout: 15_000 })

    const row = page.locator('div.group', { hasText: refMarker })
    const card = row.getByRole('link', { name: /Zitiertes Ereignis/ })
    await expect(card).toBeVisible({ timeout: 15_000 })
    // Zeile 1 UND Zeile 2 sind gefüllt — die Karte fällt nicht auf eine leere/einzeilige
    // Fläche zusammen (Plan P5.4, aus §5 p5-recon.md: Höhe kommt aus CSS, nie aus der Antwort).
    const lines = card.locator('div')
    await expect(lines.nth(0)).toHaveText('Zitiertes Ereignis')
    await expect(lines.nth(1)).not.toBeEmpty()
    const box = await card.boundingBox()
    expect(box?.height ?? 0).toBeGreaterThan(10)

    await card.click()
    // Fall C: unaufgelöst → normale Navigation über den href (kein toter Knopf) — der
    // Thread öffnet trotzdem (per id, `bridge.ts` → `openThread`, lädt Wurzel + Baum per id/`#E` selbst), auch ohne aufgelöstes Zitat.
    await expect(page).toHaveURL(new RegExp(`/rooms/${h}/thread/`))
    await expect(page.getByRole('dialog', { name: 'Thread' })).toBeVisible({ timeout: 15_000 })
})

// ── 4) Keine Schachtelung ────────────────────────────────────────────────────────────

test('Zitatkarte: ein Zitat im Zitat rendert als reiner gekürzter Text, keine zweite Karte', async ({ page }) => {
    const h = trackRoom(`qc4${rnd()}`)
    createRoomNak(h, 'QC4')

    const nestedGhostId = '22'.repeat(32)
    const nestedNevent = neventEncode({ id: nestedGhostId, relays: [], kind: 9 })
    const rootMarker = `QCNest-${rnd()}`
    const rootId = publishRaw(h, ADMIN, `${rootMarker} nostr:${nestedNevent}`)
    const nevent = neventEncode({ id: rootId, relays: [], author: ADMIN_PUB, kind: 9 })
    const refMarker = `QCNestRef-${rnd()}`
    publishRaw(h, ADMIN, `${refMarker} nostr:${nevent}`)

    await openRoom(page, h)
    await expect(page.getByText(refMarker, { exact: false })).toBeVisible({ timeout: 15_000 })

    const row = page.locator('div.group', { hasText: refMarker })
    const card = row.getByRole('link', { name: new RegExp(rootMarker) })
    await expect(card).toBeVisible({ timeout: 15_000 })
    await expect(card).toHaveCount(1) // genau EINE Karte, keine zweite für die verschachtelte Referenz

    const cardText = (await card.textContent()) ?? ''
    expect(cardText).toContain('nevent1')
    expect(cardText).toContain('…')
    expect(cardText, 'die verschachtelte Referenz darf nicht ausgeschrieben im Text stehen').not.toContain(nestedNevent)
})

// ── 5) Priorität: eine vorhandene Antwort-Vorschau schlägt die Karte ────────────────

test('Zitatkarte: eine vorhandene Antwort-Vorschau (q-Tag) schlägt die Karte', async ({ page }) => {
    const h = trackRoom(`qc5${rnd()}`)
    createRoomNak(h, 'QC5')

    const rootMarker = `QCReplyRoot-${rnd()}`
    const rootId = publishRaw(h, ADMIN, rootMarker)
    const nevent = neventEncode({ id: rootId, relays: [], author: ADMIN_PUB, kind: 9 })
    const npub = npubEncode(ADMIN_PUB)
    const replyMarker = `QCReplyBody-${rnd()}`
    // Form wie C0 (room.spec.ts) gemessen: nevent-Präfix + Leerzeile, q/p/h-Tags — UND
    // eine zusätzliche npub-Erwähnung im Rest-Text. Sie steht hier seit dem 2026-08-15
    // und war damals der Kandidat für eine zweite (Profil-)Karte; seit dem 2026-08-16
    // erzeugt ein Profil ohnehin nie eine Karte. Sie bleibt trotzdem stehen, weil sie
    // jetzt die zweite Hälfte der Aussage trägt: die Erwähnung MUSS im Fließtext
    // erscheinen, gerade wenn die Zeile bereits eine fremde Fläche (die Vorschau) hat.
    publishRaw(h, ADMIN, `nostr:${nevent}\n\n${replyMarker} nostr:${npub}`, ['-t', `q=${rootId}`, '-t', `p=${ADMIN_PUB}`])

    await openRoom(page, h)
    await expect(page.getByText(replyMarker, { exact: false })).toBeVisible({ timeout: 15_000 })

    const row = page.locator('div.group', { hasText: replyMarker })
    // Die Reply-Vorschau selbst ist ein <button> mit dem Autorname + Textausschnitt.
    await expect(row.getByRole('button', { name: new RegExp(rootMarker) })).toBeVisible({ timeout: 15_000 })
    // Keine ZWEITE Fläche neben der Vorschau: `buildRefCard` liefert bei gesetztem
    // `reply` grundsätzlich null. Genau EINE Randmarke in dieser Zeile — die Vorschau.
    await expect(kartenFlaechen(row)).toHaveCount(1)
    await expect(row.getByRole('link', { name: /Zitiertes Ereignis|Relay Admin/ })).toHaveCount(0)
    // Und das npub aus dem Rest-Text steht als `@Name` im Fließtext, nicht darüber.
    await expect(row.locator('.chat-content .mention')).toHaveText(['@Relay Admin'])
})

// ── 6) Ein einzelnes Profil im Text: KEINE Karte, `@Name` inline ────────────────────

/**
 * Der Fall, in dem der Profil-Chip am ehesten gerechtfertigt schien: eine Nachricht, die
 * genau EINE Person nennt und sonst fast nichts. Auch hier gibt es seit dem 2026-08-16
 * keine Karte — „manchmal Karte, manchmal inline" wäre eine Regel, die beim Schreiben
 * niemand im Kopf hat (Begründung in `feeds.ts buildRefCard`).
 *
 * **Der zweite Teil ist Erbe des ersetzten Chip-Tests.** Er war die einzige Stelle, die
 * das `profile-card`-Modal am HEX-Vertrag maß: `open-profile` bekommt eine hex-pubkey,
 * und nur daraus rechnet das Modal die npub zurück — ein npub-String im Dispatch würde
 * dort im `npubEncode` werfen und das Feld nie erreichen. Mit dem Chip ist nur die
 * EINSTIEGSSTELLE weggefallen, nicht der Vertrag: der Weg zum Profil führt jetzt über den
 * Autor-Knopf der Zeile, der denselben `open-profile`-Dispatch mit `m.pubkey` fährt.
 * Die Erwähnung im Text ist bewusst kein Steuerelement — sie wird hier nicht geklickt.
 */
test('Profil-Referenz: ein einzelnes nostr:npub erzeugt KEINE Karte und steht inline im Text', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    const h = trackRoom(`qc6${rnd()}`)
    createRoomNak(h, 'QC6')

    const npub = npubEncode(ADMIN_PUB)
    const refMarker = `QCMention-${rnd()}`
    publishRaw(h, ADMIN, `${refMarker} nostr:${npub}`)

    await openRoom(page, h)
    await expect(page.getByText(refMarker, { exact: false })).toBeVisible({ timeout: 15_000 })

    const row = page.locator('div.group', { hasText: refMarker })
    // Der Name steht IM Satz — und der Satz ist vollständig: `toHaveText` auf dem ganzen
    // Textkörper (nicht bloß auf dem Span) fängt beides, das Fehlen des Namens UND einen
    // herausgeschnittenen Rest.
    await expect(row.locator('.chat-content')).toHaveText(`${refMarker} @Relay Admin`, { timeout: 15_000 })
    await expect(row.locator('.chat-content .mention')).toHaveText(['@Relay Admin'])
    // Keine Fläche über dem Text: weder Karte noch Chip noch Vorschau.
    await expect(kartenFlaechen(row)).toHaveCount(0)

    // Erbe-Teil: derselbe HEX-Vertrag, andere Einstiegsstelle (Autor-Knopf der Zeile).
    await row.getByRole('button', { name: 'Relay Admin', exact: true }).first().click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 10_000 })
    await expect(dialog.getByText('Relay Admin')).toBeVisible()

    await dialog.getByRole('button', { name: 'npub kopieren' }).click()
    const clip = await page.evaluate(() => navigator.clipboard.readText())
    expect(clip).toBe(npub)
})

// ── 7) Abschaltbar, persistiert über Reload ──────────────────────────────────────────

/**
 * Der Schalter „Zitat- und Profilkarten" (`e21:quote-cards`) steuert seit dem 2026-08-16
 * nur noch ZITATkarten — deshalb baut dieser Test seine Vorbedingung auf einem `nevent`
 * auf und nicht mehr auf einer Profil-Referenz (die erzeugte nichts mehr, was der
 * Schalter abschalten könnte).
 *
 * Die Nachricht trägt BEIDES, `nevent` und `npub`. Das ist die eigentliche neue Aussage:
 * die Karte kippt mit dem Schalter, der `@Name`-Span im Fließtext NICHT — in beiden
 * Stellungen steht er unverändert da. Vorher war das umgekehrt gekoppelt (Chip aus ⇒
 * Span zurück), und genau diese Kopplung ist jetzt weg. Beim `nevent` gewinnt zudem das
 * Event-Token gegen das Profil-Token (`firstNostrRef`), die Karte ist also die Zitatkarte.
 */
test('Einstellungen: Zitatkarten abschaltbar — aus heißt keine Karte, der Mention bleibt, überlebt Reload', async ({ page }) => {
    const h = trackRoom(`qc7${rnd()}`)
    createRoomNak(h, 'QC7')

    const npub = npubEncode(ADMIN_PUB)
    const zielMarker = `QCToggleZiel-${rnd()}`
    const zielId = publishRaw(h, ADMIN, zielMarker)
    const nevent = neventEncode({ id: zielId, relays: [], author: ADMIN_PUB, kind: 9 })
    const refMarker = `QCToggle-${rnd()}`
    publishRaw(h, ADMIN, `${refMarker} nostr:${nevent} nostr:${npub}`)

    await openRoom(page, h)
    const row = page.locator('div.group', { hasText: refMarker })
    // Vorbedingung: Default AN, die Zitatkarte steht (aufgelöst → Autor + Ausschnitt).
    await expect(row.getByRole('link', { name: new RegExp(zielMarker) })).toBeVisible({ timeout: 15_000 })
    // … und der Mention steht daneben im Fließtext. DIESER Wert darf sich gleich nicht
    // ändern — er ist der Vorher-Wert des Vergleichs, nicht bloß eine Vorbedingung.
    await expect(row.locator('.chat-content .mention')).toHaveText(['@Relay Admin'])

    // SPA-Navigation statt `page.goto`: Der reale Nutzer schaltet in LEBENDER Session
    // um (wire:navigate), und genau dann ist der `htmlCache` (Modul-Map in feeds.ts)
    // noch warm. Ein voller Reload leert jede Modul-Map und machte diesen Test blind
    // für die Klasse, die er bewachen soll — in P5 gemessen an der Mutation, die den
    // Karten-Zustand aus dem Cache-Schlüssel strich: die goto-Fassung blieb GRÜN,
    // obwohl der Cache die alte Fassung festhielt. Der Fenster-Marker unten beweist,
    // dass beide Navigationen denselben JS-Kontext benutzten.
    await page.evaluate(() => {
        const w = window as unknown as {
            __p12Qc7SpaKontext?: string
            Livewire?: { navigate: (url: string) => Promise<unknown> }
        }
        w.__p12Qc7SpaKontext = 'qc7-umweg'
        void w.Livewire?.navigate('/settings/space')
    })
    await expect(page.getByRole('heading', { name: 'Darstellung' })).toBeVisible()
    const toggle = page.getByRole('switch', { name: 'Zitat- und Profilkarten' })
    await expect(toggle).toBeVisible()
    await toggle.click()
    expect(await page.evaluate(() => localStorage.getItem('e21:quote-cards'))).toBe('0')

    // Auch der Rückweg ist SPA — hier entscheidet sich, ob die abgeschaltete Fassung
    // wirklich neu gebaut wird oder der warme `htmlCache`/Memo die alte einfriert.
    // `goto` würde die Prämisse (warmer Cache) selbst zerstören.
    await page.evaluate((room: string) => {
        const w = window as unknown as { Livewire?: { navigate: (url: string) => Promise<unknown> } }
        void w.Livewire?.navigate(`/rooms/${room}`)
    }, h)
    await expect(page.getByText(refMarker, { exact: false })).toBeVisible({ timeout: 15_000 })
    // Kontext-Beweis: der Marker hat beide Navigationen überlebt — kein heimlicher
    // Reload ist passiert, der Cache war während des Umschaltens wirklich warm.
    expect(await page.evaluate(() => (window as unknown as { __p12Qc7SpaKontext?: string }).__p12Qc7SpaKontext)).toBe('qc7-umweg')
    // Aus heißt: gar keine Fläche mehr über dem Text.
    await expect(kartenFlaechen(row)).toHaveCount(0)
    await expect(row.getByRole('link', { name: new RegExp(zielMarker) })).toHaveCount(0)
    // **Die neue Kopplungsaussage.** Der Schalter fasst das Mention-Rendering nicht an:
    // derselbe Span, derselbe Text wie vor dem Umschalten.
    await expect(row.locator('.chat-content .mention')).toHaveText(['@Relay Admin'])

    // Reload als BEWUSSTES Persistenz-Bein: Hier ist der volle Kontextverlust die
    // Aussage — die Abwahl überlebt in localStorage, nicht im Modulzustand. (Das
    // SPA-Bein oben trägt die Cache-Kopplung; der Reload leert den htmlCache, was
    // hier richtig ist, weil Persistenz genau das verlangt.)
    await page.reload()
    await expect(page.getByText(refMarker, { exact: false })).toBeVisible({ timeout: 15_000 })
    await expect(kartenFlaechen(row)).toHaveCount(0)
    // Auch nach dem Reload — also aus kaltem Cache gebaut — steht der Mention inline.
    await expect(row.locator('.chat-content .mention')).toHaveText(['@Relay Admin'])
    expect(await page.evaluate(() => localStorage.getItem('e21:quote-cards'))).toBe('0')
})

// ── 8) Thread-Panel teilt dieselbe Regel ────────────────────────────────────────────

/**
 * Raum und Thread-Panel teilen sich `chat-row.blade.php` — die Regel „Profil nie als
 * Karte" darf deshalb nicht am Kontext hängen. Der Kommentar ist eine vollwertige
 * ChatMessage (mit `refCard`-Zweig), also die Stelle, an der ein zurückkehrender Chip
 * zuerst wieder auftauchen würde.
 */
test('Thread-Panel: ein Kommentar mit Profil-Referenz zeigt den Mention inline, keine Karte', async ({ page }) => {
    const h = trackRoom(`qc8${rnd()}`)
    createRoomNak(h, 'QC8')

    const rootMarker = `QCThreadRoot-${rnd()}`
    const rootId = publishRaw(h, ADMIN, rootMarker)
    const npub = npubEncode(ADMIN_PUB)
    const commentMarker = `QCThreadMention-${rnd()}`
    publishComment(h, rootId, 9, ADMIN, `${commentMarker} nostr:${npub}`)

    await openRoom(page, h)
    await expect(page.getByText(rootMarker, { exact: true })).toBeVisible({ timeout: 15_000 })

    const rootRow = page.locator('div.group', { hasText: rootMarker })
    await rootRow.hover()
    await rootRow.getByRole('button', { name: 'Im Thread antworten' }).click()

    const dialog = page.getByRole('dialog', { name: 'Thread' })
    await expect(dialog).toBeVisible({ timeout: 15_000 })
    await expect(dialog.getByText(commentMarker, { exact: false })).toBeVisible({ timeout: 15_000 })

    const commentRow = dialog.locator('div.group', { hasText: commentMarker })
    await expect(commentRow.locator('.chat-content')).toHaveText(`${commentMarker} @Relay Admin`, { timeout: 15_000 })
    await expect(commentRow.locator('.chat-content .mention')).toHaveText(['@Relay Admin'])
    await expect(kartenFlaechen(commentRow)).toHaveCount(0)
})

// ── 9) Thread-Panel: ein RAUMFREMDES Zitat wird nachgeladen ─────────────────────────

test('Thread-Panel: ein Kommentar mit raumfremdem Zitat zeigt erst die Kennung und löst nach dem Nachladen auf', async ({ page }) => {
    test.setTimeout(60_000)
    // Das zitierte Ereignis lebt in einem Raum, den dieser Browser NIE besucht — genau
    // wie in Test 2, aber diesmal im THREAD. Der Unterschied ist nicht kosmetisch: der
    // Raum-Feed reicht `collectRefEvents` nur seine kind-9-Nachrichten (feeds.ts:1094),
    // NICHT die kind-1111-Kommentare. Ein Zitat, das nur in einem Kommentar steht, wird
    // also vom Raum-Feed nie angefragt — `deriveThread` ist der einzige Pfad, der es
    // nachlädt, und `throttled(200, refEventStore)` in seiner Ableitungsliste
    // (feeds.ts:1667) die einzige Quelle, die das Ergebnis je meldet. Ohne sie bliebe
    // die Karte für immer bei der gekürzten Kennung stehen (P5, Restposten 2).
    const hQuoted = trackRoom(`qc9q${rnd()}`)
    const hThread = trackRoom(`qc9t${rnd()}`)
    createRoomNak(hQuoted, 'QC9Quoted')
    createRoomNak(hThread, 'QC9Thread')

    // BEIDE Räume liegen auf DEMSELBEN Relay: `warmRefEvents` verwirft die Relay-Hints
    // des `nevent` bewusst (feeds.ts:672-679) und fragt Space-Relay + DEFAULT_RELAYS.
    // Ein Zitat von einem fremden Relay wäre unauffindbar — der Test prüfte dann eine
    // Eigenschaft, die es nicht gibt.
    const quotedMarker = `QCXRoom-${rnd()}`
    const quotedId = publishRaw(hQuoted, ADMIN, quotedMarker)
    // `nostr:`-Präfix ist Pflicht: welshmans `parse()` erkennt nackte bech32-Kennungen
    // nicht, sie blieben reiner Text (gemessen in p5-recon.md des Vorgängerplans).
    const nevent = neventEncode({ id: quotedId, relays: [], author: ADMIN_PUB, kind: 9 })

    const rootMarker = `QCXRoot-${rnd()}`
    const rootId = publishRaw(hThread, ADMIN, rootMarker)
    const commentMarker = `QCXComment-${rnd()}`
    publishComment(hThread, rootId, 9, ADMIN, `${commentMarker} nostr:${nevent}`)

    await openRoom(page, hThread)
    await expect(page.getByText(rootMarker, { exact: true })).toBeVisible({ timeout: 15_000 })

    // Zustandsrekorder VOR dem Öffnen des Threads. Er beantwortet die Frage, die das
    // Endergebnis allein NICHT beantwortet: erschien die Karte aufgelöst, weil sie
    // nachgeladen wurde — oder weil das Ereignis von Anfang an da war? Ein
    // MutationObserver statt eines Polls, damit kein Zwischenzustand durch ein
    // Abtastloch fällt; er feuert nach JEDEM DOM-Stapel, nicht alle n Millisekunden.
    // Die Karte kann im Raum gar nicht existieren (der Kommentar rendert nur im
    // Thread-Panel), der erste aufgezeichnete Zustand ist also der erste GEMALTE.
    await page.evaluate((selector) => {
        const w = window as unknown as { __qcRefStates: string[] }
        w.__qcRefStates = []
        const snapshot = (): void => {
            const line = document.querySelector(selector)?.firstElementChild?.textContent?.trim() ?? ''
            if (line !== '' && w.__qcRefStates[w.__qcRefStates.length - 1] !== line) {
                w.__qcRefStates.push(line)
            }
        }
        new MutationObserver(snapshot).observe(document.body, { subtree: true, childList: true, characterData: true })
        snapshot()
    }, `a[href*="/thread/${nevent}"]`)

    const rootRow = page.locator('div.group', { hasText: rootMarker })
    await rootRow.hover()
    await rootRow.getByRole('button', { name: 'Im Thread antworten' }).click()

    const dialog = page.getByRole('dialog', { name: 'Thread' })
    await expect(dialog).toBeVisible({ timeout: 15_000 })
    await expect(dialog.getByText(commentMarker, { exact: false })).toBeVisible({ timeout: 15_000 })

    const commentRow = dialog.locator('div.group', { hasText: commentMarker })
    const card = commentRow.locator(`a[href*="/thread/${nevent}"]`)
    await expect(card).toBeVisible({ timeout: 15_000 })

    // Endzustand: Autorname + Textausschnitt statt „Zitiertes Ereignis" + Kennung.
    await expect(card.locator('div').nth(0)).toHaveText('Relay Admin', { timeout: 25_000 })
    await expect(card.locator('div').nth(1)).toHaveText(quotedMarker)
    // Der Deep-Link zeigt jetzt in den FREMDEN Raum — dessen `h` kennt die Karte erst
    // aus dem nachgeladenen Ereignis (buildRefCard `quotedRoom`), vorher fällt sie auf
    // den aktuellen Raum zurück. Zweiter, unabhängiger Beleg für dieselbe Auflösung.
    await expect(card).toHaveAttribute('href', new RegExp(`^/rooms/${hQuoted}/thread/`))

    // Und der Weg dorthin: erst die Kennung, dann der Name. Wäre das Ereignis von
    // Anfang an im Repository gewesen, stünde hier NUR der Name — dieser Fall fällt.
    const states = await page.evaluate(() => (window as unknown as { __qcRefStates: string[] }).__qcRefStates)
    expect(states[0], `erster gemalter Kartenzustand (aufgezeichnet: ${JSON.stringify(states)})`).toBe('Zitiertes Ereignis')
    expect(states, `Kartenzustände über die Zeit: ${JSON.stringify(states)}`).toContain('Relay Admin')
})

// ── 10) Regression 2026-08-16: mehrere Profile stehen ALLE inline, der Satz bleibt ──

/**
 * **Der Regressionstest zum gemeldeten Defekt (2026-08-16).**
 *
 * Gemeldet an einer Ankündigung mit drei npubs in der Form „**21Meetup** von
 * nostr:npub1…" je Zeile: die ERSTE Referenz verschwand aus dem Satz — die Zeile endete
 * auf „von " und sonst nichts — und stand stattdessen als Karte über der Nachricht, ohne
 * Bezug zu der Zeile, aus der sie stammte. Die beiden anderen blieben inline. Zwei
 * Fehler in einem: eine Karte, wo keine hingehört, und ein verstümmelter Satz.
 *
 * Der Test bildet genau diese Form nach (drei Zeilen, zwei verschiedene pubkeys, einer
 * davon ohne `kind 0` → gekürzte npub-Kette inline) und prüft BEIDE Hälften getrennt:
 *   • keine Fläche über dem Text — sonst wäre die Karte zurück;
 *   • der Textkörper Zeichen für Zeichen, inklusive der Zeilenumbrüche — sonst wäre der
 *     Schnitt zurück. Ein reiner Span-Vergleich fiele auf einen Text herein, aus dem
 *     drumherum etwas entfernt wurde.
 * Deshalb der Roh-`textContent` statt `toHaveText`: Playwright normalisiert dort
 * Leerraum und würde „von \n" und „von " nicht mehr unterscheiden können — die
 * Zeilenstruktur ist hier aber der Prüfgegenstand (`whitespace-pre-wrap`; welshman
 * rendert Umbrüche als echte `\n`, nicht als `<br>`).
 *
 * Die restlichen Fälle stammen aus dem Vorgänger-Test (Chip-Kopplung, 2026-08-15) und
 * gelten unverändert weiter — sie sagen jetzt nur alle dasselbe: der Mention steht im
 * Text, egal was sonst in der Zeile passiert.
 */
test('Mehrere Profil-Referenzen stehen ALLE inline — der Satz bleibt vollständig, keine Karte', async ({ page }) => {
    const h = trackRoom(`qc10${rnd()}`)
    createRoomNak(h, 'QC10')

    const npub = npubEncode(ADMIN_PUB)
    // Ein pubkey ohne kind 0 → sein Name bleibt die gekürzte npub-Kette. Der Fall gehört
    // dazu, weil der Mention hier auf den ersten Blick wie „Müll im Text" aussieht und
    // genau deshalb der Kandidat wäre, den man wieder wegschneidet.
    const ghost = npubEncode('3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c')

    const mAnk = `QCAnk-${rnd()}`
    const mUnbekannt = `QCRep2-${rnd()}`
    const mSatz = `QCRep3-${rnd()}`
    const mEvent = `QCRep4-${rnd()}`
    const mReply = `QCRep6-${rnd()}`

    // Die gemeldete Form: mehrzeilige Ankündigung, jede Zeile endet auf eine Referenz.
    publishRaw(h, ADMIN, `${mAnk}\n21Meetup von nostr:${npub}\nTWENTY ONE von nostr:${ghost}\nEinundzwanzig von nostr:${npub}`)
    publishRaw(h, ADMIN, `${mUnbekannt} nostr:${ghost}`)
    publishRaw(h, ADMIN, `${mSatz} schaut mal nostr:${npub} an bitte`)
    const zielId = publishRaw(h, ADMIN, `QCRepZiel-${rnd()}`)
    publishRaw(h, ADMIN, `${mEvent} nostr:${neventEncode({ id: zielId, relays: [], kind: 9 })} und nostr:${npub}`)
    publishRaw(h, ADMIN, `${mReply} nostr:${npub}`, ['-t', `q=${zielId}`])

    await openRoom(page, h)
    await expect(page.getByText(mAnk, { exact: false })).toBeVisible({ timeout: 15_000 })

    const zeile = (marker: string) => page.locator('div.group', { hasText: marker }).last()

    // 1) DER DEFEKT. Alle drei Erwähnungen stehen im Text, in Reihenfolge, keine Karte.
    const ank = zeile(mAnk)
    await expect(ank.locator('.chat-content .mention')).toHaveText(
        ['@Relay Admin', '@npub18s7…5kgc0', '@Relay Admin'],
        { timeout: 15_000 },
    )
    await expect(kartenFlaechen(ank)).toHaveCount(0)
    const ankText = (await ank.locator('.chat-content').textContent()) ?? ''
    expect(ankText, 'der Satz muss Zeichen für Zeichen stehen bleiben — nichts herausgeschnitten').toBe(
        `${mAnk}\n21Meetup von @Relay Admin\nTWENTY ONE von @npub18s7…5kgc0\nEinundzwanzig von @Relay Admin`,
    )
    // Die Fehlersignatur des Tickets ausdrücklich benannt: keine Zeile endet auf „von".
    // Redundant zum Vergleich oben und trotzdem gewollt — bricht der Test später aus
    // einem anderen Grund, steht hier im Klartext, welche Aussage gemeint war.
    expect(ankText, 'keine Zeile darf auf „von " enden — genau so sah der gemeldete Defekt aus').not.toMatch(/von\s*(\n|$)/)

    // 2) Ein einzelner unbekannter pubkey: die gekürzte Kette steht EINMAL im Text.
    await expect(zeile(mUnbekannt).locator('.chat-content')).toHaveText(`${mUnbekannt} @npub18s7…5kgc0`)

    // 3) Mention MITTEN im Satz: der Satz läuft ohne Lücke durch, kein doppelter Abstand.
    //    (`whitespace-pre-wrap` würde zwei Leerzeichen sichtbar stehen lassen.)
    await expect(zeile(mSatz).locator('.chat-content')).toHaveText(`${mSatz} schaut mal @Relay Admin an bitte`)

    // 4) Ein `nevent` gewinnt gegen das `npub` (`firstNostrRef` wertet Event-Token VOR
    //    Profil-Token) → es gibt genau EINE Fläche, die Zitatkarte, und der Mention steht
    //    daneben im Text. Der Fall galt schon vor dem 2026-08-16 und gilt unverändert.
    await expect(kartenFlaechen(zeile(mEvent))).toHaveCount(1)
    await expect(zeile(mEvent).locator('.chat-content .mention')).toHaveText(['@Relay Admin'])

    // 5) Antwort-Vorschau (q-Tag) schlägt jede Karte → die eine Fläche ist die Vorschau,
    //    der Mention steht im Text.
    await expect(kartenFlaechen(zeile(mReply))).toHaveCount(1)
    await expect(zeile(mReply).getByRole('link', { name: /Zitiertes Ereignis/ })).toHaveCount(0)
    await expect(zeile(mReply).locator('.chat-content .mention')).toHaveText(['@Relay Admin'])
})

// ── 11) Im Thread: Kommentar UND Root tragen den Mention inline ─────────────────────

/**
 * Bis zum 2026-08-15 liefen Root und Kommentar hier auseinander: der Kommentar ist eine
 * vollwertige ChatMessage (mit `refCard`) und verlor seinen Span an den Chip, der Root
 * wird über `personFields` OHNE `refCard` gebaut (`ThreadView`) und behielt ihn. Genau
 * dieser Unterschied ist mit dem Chip weggefallen — dieselbe Nachricht, zweimal
 * gerendert, muss jetzt zweimal denselben Text zeigen. Der Test misst beide Pfade
 * NEBENEINANDER, weil ein Rückfall nur einen von beiden träfe.
 */
test('Thread: Kommentar und Root zeigen den Mention beide inline — kein Pfad schneidet ihn heraus', async ({
    page,
}) => {
    const h = trackRoom(`qc11${rnd()}`)
    createRoomNak(h, 'QC11')

    const npub = npubEncode(ADMIN_PUB)
    const rootMarker = `QCTRoot-${rnd()}`
    const commentMarker = `QCTKomm-${rnd()}`
    const rootId = publishRaw(h, ADMIN, `${rootMarker} nostr:${npub}`)
    publishComment(h, rootId, 9, ADMIN, `${commentMarker} nostr:${npub}`)

    await openRoom(page, h)
    await expect(page.getByText(rootMarker, { exact: false })).toBeVisible({ timeout: 15_000 })

    const rootRow = page.locator('div.group', { hasText: rootMarker }).last()
    await rootRow.hover()
    await rootRow.getByRole('button', { name: 'Im Thread antworten' }).click()

    const dialog = page.getByRole('dialog', { name: 'Thread' })
    await expect(dialog).toBeVisible({ timeout: 15_000 })
    await expect(dialog.getByText(commentMarker, { exact: false })).toBeVisible({ timeout: 15_000 })

    // Pfad 1 — der KOMMENTAR: vollwertige ChatMessage, der `refCard`-Zweig steht ihm
    // offen. Trotzdem keine Fläche, und der Name im Text.
    const commentRow = dialog.locator('div.group', { hasText: commentMarker }).last()
    await expect(commentRow.locator('.chat-content')).toHaveText(`${commentMarker} @Relay Admin`, { timeout: 15_000 })
    await expect(kartenFlaechen(commentRow)).toHaveCount(0)

    // Pfad 2 — der ROOT: über `personFields` gebaut, ohne `refCard` (`ThreadView`).
    // Derselbe Text, obwohl ein anderer Code-Pfad ihn rendert.
    const rootBody = dialog.locator('[x-ref="rootBody"]').first()
    await expect(rootBody.locator('.mention')).toHaveText(['@Relay Admin'])
    await expect(rootBody).toHaveText(`${rootMarker} @Relay Admin`)
})

// ── 12+13) Die Erwähnung ist der Weg zum Profil — beide Render-Pfade getrennt ────────

/**
 * Das `profile-card`-Modal, unterschieden von jedem anderen Dialog über seinen Inhalt.
 *
 * Nötig, weil im Thread-Fall ZWEI Dialoge gleichzeitig offen sind (Thread-Panel und
 * Profil-Modal) und `getByRole('dialog')` dann in den strict mode liefe. Der npub-Chip ist
 * das Merkmal, das nur diese Karte hat — und zugleich das, was der Test ohnehin prüft.
 */
const profilModal = (page: Page): Locator =>
    page.getByRole('dialog').filter({ has: page.getByRole('button', { name: 'npub kopieren' }) })

/**
 * Der Zeilen-Zustand `activeId` aus dem Alpine-Scope der Zeile (Muster room.spec.ts M4b).
 *
 * Er ist das, was der Klick auf die ZEILE setzt (`chat-row.blade.php`: Tap blendet die
 * Aktionsleiste ein). Über ihn lässt sich „der Mention-Klick ist NICHT durchgeschlagen"
 * direkt am Zustand ablesen statt an der Sichtbarkeit der Leiste — die ist bei Hover
 * ohnehin eingeblendet und taugt deshalb nicht als Messgröße.
 */
const zeilenActiveId = (row: Locator): Promise<string | null> =>
    row.evaluate(
        (el) =>
            (window as unknown as { Alpine: { $data: (e: Element) => { activeId: string | null } } }).Alpine.$data(el)
                .activeId,
    )

/**
 * **Test 12 — der Ersatz für den Chip-Klick, Pfad `chat-row.blade.php`.**
 *
 * Seit dem Wegfall des Profil-Chips (2026-08-16) ist die Erwähnung im Text die EINZIGE
 * Art, ein dort genanntes Profil zu öffnen. Fällt der delegierte Handler still aus, ist
 * das Feature weg, ohne dass irgendetwas anderes rot wird — der Text sieht unverändert aus.
 *
 * Vier Beine, weil vier verschiedene Dinge still brechen können:
 *   1. **HEX-Vertrag** — `data-pubkey` trägt hex. `open-profile` erwartet hex; eine npub
 *      würfe im Modal beim Kodieren. Geprüft doppelt: am Attribut gegen die im Test
 *      bekannte Konstante (unabhängig vom Produkt) UND am Ergebnis, dem aufgelösten Namen
 *      plus der zurückkopierten npub.
 *   2. **Klick** — öffnet das Modal.
 *   3. **Tastatur** — der Grund, warum es ein echtes `<button>` ist und kein
 *      `<span role="button">`: `tabIndex === 0` (natürliche Tab-Reihenfolge; ein `<span>`
 *      ohne `tabindex` liefert −1), Fokussierbarkeit, und Enter löst NATIV aus. Ohne
 *      dieses Bein ist die Elementwahl unbelegt und ein späterer „Vereinfacher" macht
 *      wieder einen `<span>` daraus. Bewusst KEIN `page.keyboard.press('Tab')` in einer
 *      gezählten Schleife: die Zahl der Tab-Schritte hängt an jedem Knopf, der vor der
 *      Zeile liegt, und wäre bei der nächsten Toolbar-Änderung falsch — `tabIndex` misst
 *      dieselbe Eigenschaft ohne diese Kopplung.
 *   4. **Kein Durchschlagen** — der Handler trägt `stopPropagation`, weil die Zeile selbst
 *      ein Klickziel ist. Ohne das öffnete ein Mention-Klick zusätzlich die Aktionsleiste.
 */
test('Erwähnung in der Raumzeile: Klick und Enter öffnen das Profil, der Klick schlägt nicht auf die Zeile durch', async ({
    page,
    context,
}) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    const h = trackRoom(`qc12${rnd()}`)
    createRoomNak(h, 'QC12')

    const npub = npubEncode(ADMIN_PUB)
    const refMarker = `QCKlick-${rnd()}`
    publishRaw(h, ADMIN, `${refMarker} nostr:${npub}`)

    await openRoom(page, h)
    await expect(page.getByText(refMarker, { exact: false })).toBeVisible({ timeout: 15_000 })

    const row = page.locator('div.group', { hasText: refMarker })
    const mention = row.locator('.chat-content .mention')
    await expect(mention).toHaveText('@Relay Admin', { timeout: 15_000 })

    // 1) HEX am Element. ADMIN_PUB ist eine Konstante DIESER Datei — der Erwartungswert
    //    kommt also nicht aus der geprüften Funktion.
    await expect(mention).toHaveAttribute('data-pubkey', ADMIN_PUB)

    // 3a) Tab-Reihenfolge und Fokussierbarkeit. `tabIndex` ist die Eigenschaft, die ein
    //     `<span>` ohne `tabindex` verliert (−1) — hier fällt eine Rückkehr zum span auf.
    expect(await mention.evaluate((el) => el.tabIndex), 'die Erwähnung muss in der natürlichen Tab-Reihenfolge liegen').toBe(0)

    // 4) Vorher-Wert der Zeilen-Aktion: nichts aktiv.
    expect(await zeilenActiveId(row), 'Vorbedingung: die Zeile ist nicht aktiv').toBeNull()

    // 2) Klick öffnet das Modal — mit aufgelöstem Namen, nicht mit einer npub-Kette.
    await mention.click()
    const modal = profilModal(page)
    await expect(modal).toBeVisible({ timeout: 10_000 })
    await expect(modal.getByText('Relay Admin', { exact: true })).toBeVisible()

    // 1b) Der HEX-Vertrag am ERGEBNIS: das Modal rechnet die npub aus der hex zurück.
    //     Käme dort eine npub an, würfe `npubEncode` und dieser Knopf lieferte nichts.
    await modal.getByRole('button', { name: 'npub kopieren' }).click()
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(npub)

    // 4b) Und die Zeile hat den Klick NICHT mitbekommen.
    expect(await zeilenActiveId(row), 'der Mention-Klick darf die Zeilen-Aktion nicht auslösen').toBeNull()

    await page.keyboard.press('Escape')
    await expect(modal).toBeHidden({ timeout: 10_000 })

    // 3b) Dasselbe Ziel über die Tastatur: fokussieren, Enter — nativ, ohne dass ein
    //     `x-html`-Container Tastatur-Ereignisse delegieren müsste.
    await mention.focus()
    await expect(mention).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(modal).toBeVisible({ timeout: 10_000 })
    await expect(modal.getByText('Relay Admin', { exact: true })).toBeVisible()
})

/**
 * **Test 13 — derselbe Weg, anderer Pfad: der Thread-ROOT (`⚡room.blade.php`).**
 *
 * Der Root rendert NICHT über `chat-row.blade.php`, sondern über eigenes Markup mit einem
 * ZWEITEN, getrennt gepflegten Klick-Handler am `x-ref="rootBody"`. Ein Test nur auf dem
 * Raum-Pfad ließe genau diesen ungedeckt — und dort ist der Fehler wahrscheinlicher, weil
 * ihn niemand im Blick hat.
 *
 * Bewusst ein EIGENER Test und kein zweites Bein von Test 12: nur getrennt ist sichtbar,
 * dass die beiden Pfade wirklich unabhängig messen. Fällt der Handler in `chat-row`, muss
 * DIESER Test grün bleiben (belegt mit Mutation M4, 2026-08-16).
 */
test('Erwähnung im Thread-Root: der zweite Klick-Handler öffnet dasselbe Profil', async ({ page }) => {
    const h = trackRoom(`qc13${rnd()}`)
    createRoomNak(h, 'QC13')

    const npub = npubEncode(ADMIN_PUB)
    const rootMarker = `QCRootKlick-${rnd()}`
    publishRaw(h, ADMIN, `${rootMarker} nostr:${npub}`)

    await openRoom(page, h)
    await expect(page.getByText(rootMarker, { exact: false })).toBeVisible({ timeout: 15_000 })

    const rootRow = page.locator('div.group', { hasText: rootMarker }).last()
    await rootRow.hover()
    await rootRow.getByRole('button', { name: 'Im Thread antworten' }).click()

    const dialog = page.getByRole('dialog', { name: 'Thread' })
    await expect(dialog).toBeVisible({ timeout: 15_000 })

    const rootBody = dialog.locator('[x-ref="rootBody"]').first()
    const mention = rootBody.locator('.mention')
    await expect(mention).toHaveText('@Relay Admin', { timeout: 15_000 })
    await expect(mention).toHaveAttribute('data-pubkey', ADMIN_PUB)

    await mention.click()
    // Zwei Dialoge sind jetzt offen — der Thread bleibt stehen, das Profil kommt dazu.
    const modal = profilModal(page)
    await expect(modal).toBeVisible({ timeout: 10_000 })
    await expect(modal.getByText('Relay Admin', { exact: true })).toBeVisible()
    await expect(dialog).toBeVisible()
})
