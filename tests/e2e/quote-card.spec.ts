import { test, expect, type Page } from './support/fixtures'
import { execFileSync } from 'node:child_process'
import { neventEncode, npubEncode } from 'nostr-tools/nip19'
import { useZooid, ZOOID_WS } from './support/zooid'
import { loginNsec } from './support/login'
import { cleanupRooms, trackRoom } from './support/rooms'

/**
 * P5 — Nostr-Zitat- und Profilkarten im Chat (`js/nostrEventLink.ts` + `js/feeds.ts`
 * `buildRefCard`). Reine Parsing-/Prioritäts-/Klickziel-Logik deckt
 * `js/nostrEventLink.test.ts` (node --test) ab — hier NUR, was einen echten Browser
 * braucht: welshman-Reaktivität (Nachladen), DOM-Klick-Verhalten, das bestehende
 * `profile-card`-Modal, die Einstellungs-Persistenz und das geteilte `chat-row`-Markup
 * im Thread-Panel.
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
    // Thread öffnet trotzdem (per id, `bridge.ts:3714-3722`), auch ohne aufgelöstes Zitat.
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
    // eine zusätzliche npub-Erwähnung im Rest-Text, die OHNE die Reply-Vorrangregel
    // ihrerseits eine (Profil-)Karte erzeugen würde.
    publishRaw(h, ADMIN, `nostr:${nevent}\n\n${replyMarker} nostr:${npub}`, ['-t', `q=${rootId}`, '-t', `p=${ADMIN_PUB}`])

    await openRoom(page, h)
    await expect(page.getByText(replyMarker, { exact: false })).toBeVisible({ timeout: 15_000 })

    const row = page.locator('div.group', { hasText: replyMarker })
    // Die Reply-Vorschau selbst ist ein <button> mit dem Autorname + Textausschnitt.
    await expect(row.getByRole('button', { name: new RegExp(rootMarker) })).toBeVisible({ timeout: 15_000 })
    // Weder eine zweite Zitatkarte (<a>) noch ein Profil-Chip für das npub im Rest-Text.
    await expect(row.getByRole('link', { name: /Zitiertes Ereignis|Relay Admin/ })).toHaveCount(0)
    await expect(row.getByRole('button', { name: /Profil anzeigen: Relay Admin/ })).toHaveCount(0)
})

// ── 6) Profil-Chip öffnet das bestehende Modal mit Hex-Pubkey ──────────────────────

test('Profil-Chip: öffnet das bestehende profile-card-Modal mit Hex-Pubkey (nicht npub)', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    const h = trackRoom(`qc6${rnd()}`)
    createRoomNak(h, 'QC6')

    const npub = npubEncode(ADMIN_PUB)
    const refMarker = `QCChip-${rnd()}`
    publishRaw(h, ADMIN, `${refMarker} nostr:${npub}`)

    await openRoom(page, h)
    await expect(page.getByText(refMarker, { exact: false })).toBeVisible({ timeout: 15_000 })

    const row = page.locator('div.group', { hasText: refMarker })
    const chip = row.getByRole('button', { name: /Profil anzeigen: Relay Admin/ })
    await expect(chip).toBeVisible({ timeout: 15_000 })

    // P5.3 (Nutzerentscheidung 2026-08-15): wo der Chip steht, steht der `@Name`-Span
    // NICHT mehr — dieselbe Person stand vorher zweimal untereinander.
    await expect(row.locator('.chat-content span.mention')).toHaveCount(0)

    await chip.click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 10_000 })
    // Der Name löst nur bei korrekt übergebener HEX-pubkey auf (`displayProfileByPubkey`
    // braucht hex) — ein npub-String würde beim `nip19.npubEncode` im Modal werfen und
    // dieses Feld nie erreichen.
    await expect(dialog.getByText('Relay Admin')).toBeVisible()

    await dialog.getByRole('button', { name: 'npub kopieren' }).click()
    const clip = await page.evaluate(() => navigator.clipboard.readText())
    expect(clip).toBe(npub)
})

// ── 7) Abschaltbar, persistiert über Reload ──────────────────────────────────────────

test('Einstellungen: Zitat-/Profilkarten abschaltbar — aus heißt keine Karte, überlebt Reload', async ({ page }) => {
    const h = trackRoom(`qc7${rnd()}`)
    createRoomNak(h, 'QC7')

    const npub = npubEncode(ADMIN_PUB)
    const refMarker = `QCToggle-${rnd()}`
    publishRaw(h, ADMIN, `${refMarker} nostr:${npub}`)

    await openRoom(page, h)
    const row = page.locator('div.group', { hasText: refMarker })
    // Vorbedingung: Default AN, der Chip ist da.
    await expect(row.getByRole('button', { name: /Profil anzeigen: Relay Admin/ })).toBeVisible({ timeout: 15_000 })
    // … und der Span ist deshalb weg (P5.3).
    await expect(row.locator('.chat-content span.mention')).toHaveCount(0)

    // SPA-Navigation statt `page.goto`: Der reale Nutzer schaltet in LEBENDER Session
    // um (wire:navigate), und genau dann ist der `htmlCache` (Modul-Map in feeds.ts)
    // noch warm. Ein voller Reload leert jede Modul-Map und machte diesen Test blind
    // für die Klasse, die er bewachen soll — gemessen in P5: unter der Mutation
    // `cacheKey = event.id` (Chip-pubkey aus dem Schlüssel gestrichen) blieb die
    // goto-Fassung GRÜN, obwohl der Cache dann die Chip-Fassung festhält und der
    // zurück erwartete Mention-Span nach dem Umschalten fehlt. Der Fenster-Marker
    // unten beweist, dass beide Navigationen denselben JS-Kontext benutzten.
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

    // Auch der Rückweg ist SPA — hier entscheidet sich, ob der warme `htmlCache` die
    // abgeschaltete Fassung überschreibt (Soll) oder die Chip-Fassung einfriert
    // (Mutation). `goto` würde die Prämisse ( warmer Cache) selbst zerstören.
    await page.evaluate((room: string) => {
        const w = window as unknown as { Livewire?: { navigate: (url: string) => Promise<unknown> } }
        void w.Livewire?.navigate(`/rooms/${room}`)
    }, h)
    await expect(page.getByText(refMarker, { exact: false })).toBeVisible({ timeout: 15_000 })
    // Kontext-Beweis: der Marker hat beide Navigationen überlebt — kein heimlicher
    // Reload ist passiert, der Cache war während des Umschaltens wirklich warm.
    expect(await page.evaluate(() => (window as unknown as { __p12Qc7SpaKontext?: string }).__p12Qc7SpaKontext)).toBe('qc7-umweg')
    // `/Profil anzeigen: /` (mit Doppelpunkt) ist der CHIP — nicht die Autor-Avatar-
    // Schaltfläche der Zeile, deren aria-label exakt „Profil anzeigen" ohne Namen ist.
    await expect(row.getByRole('button', { name: /Profil anzeigen: / })).toHaveCount(0)
    // **Die eigentliche Prüfung des P5.3-Umbaus.** Ohne Chip MUSS der `@Name`-Span
    // zurück sein — sonst wäre die Erwähnung vollständig unsichtbar und der Satz
    // hätte seinen Bezug verloren, ohne dass irgendwo etwas an seine Stelle tritt.
    await expect(row.locator('.chat-content span.mention')).toHaveText(['@Relay Admin'])

    // Reload als BEWUSSTES Persistenz-Bein: Hier ist der volle Kontextverlust die
    // Aussage — die Abwahl überlebt in localStorage, nicht im Modulzustand. (Das
    // SPA-Bein oben trägt die Cache-Kopplung; der Reload leert den htmlCache, was
    // hier richtig ist, weil Persistenz genau das verlangt.)
    await page.reload()
    await expect(page.getByText(refMarker, { exact: false })).toBeVisible({ timeout: 15_000 })
    // `/Profil anzeigen: /` (mit Doppelpunkt) ist der CHIP — nicht die Autor-Avatar-
    // Schaltfläche der Zeile, deren aria-label exakt „Profil anzeigen" ohne Namen ist.
    await expect(row.getByRole('button', { name: /Profil anzeigen: / })).toHaveCount(0)
    // Auch nach dem Reload trägt der Fließtext die Erwähnung wieder selbst.
    await expect(row.locator('.chat-content span.mention')).toHaveText(['@Relay Admin'])
    expect(await page.evaluate(() => localStorage.getItem('e21:quote-cards'))).toBe('0')
})

// ── 8) Thread-Panel teilt dieselben Karten ──────────────────────────────────────────

test('Thread-Panel: ein Kommentar mit Profil-Referenz zeigt denselben Chip wie im Raum', async ({ page }) => {
    const h = trackRoom(`qc8${rnd()}`)
    createRoomNak(h, 'QC8')

    const rootMarker = `QCThreadRoot-${rnd()}`
    const rootId = publishRaw(h, ADMIN, rootMarker)
    const npub = npubEncode(ADMIN_PUB)
    const commentMarker = `QCThreadChip-${rnd()}`
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
    await expect(commentRow.getByRole('button', { name: /Profil anzeigen: Relay Admin/ })).toBeVisible({ timeout: 15_000 })
    // P5.3 gilt im Thread genauso — Raum und Panel teilen sich `chat-row`.
    await expect(commentRow.locator('.chat-content span.mention')).toHaveCount(0)
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

// ── 10) P5.3: der Chip ERSETZT den Mention-Span — aber nur, wo er wirklich steht ─────

/**
 * Nutzerentscheidung 2026-08-15: „der Profil-Chip ersetzt den `@Name`-Mention-Span im
 * Fließtext". Vorher stand dieselbe Person zweimal untereinander — bei ungeladenem
 * `kind 0` sogar zeichengleich als gekürzte npub-Kette (Chip `n npub18s7…5kgc0`,
 * Span `@npub18s7…5kgc0`).
 *
 * **Der Kern dieses Tests ist die Kopplung, nicht das Entfernen.** Ein Span darf nur
 * verschwinden, wo der Chip WIRKLICH gerendert wird — nicht, wo er es prinzipiell
 * könnte. `buildRefCard` liefert aus VIER unabhängigen Gründen keinen Profil-Chip, und
 * in jedem davon muss die Erwähnung im Text stehen bleiben, sonst ist sie vollständig
 * unsichtbar:
 *   a) ein `nevent`/`note` gewinnt das Rennen (`firstNostrRef` wertet Event-Token VOR
 *      Profil-Token) → Zitatkarte statt Profil-Chip,
 *   b) die Nachricht trägt bereits eine Antwort-Vorschau (`q`-Tag) → gar keine Karte,
 *   c) es ist das ZWEITE npub derselben Nachricht (die Karte ist genau eine),
 *   d) der Nutzer hat die Karten abgeschaltet (eigener Test, Fall 7).
 * Der Thread-ROOT ist ein fünfter Fall: er wird ohne `refCard` gebaut (`ThreadView`),
 * bekommt also nie einen Chip — auch dort bleibt der Span.
 *
 * Alle Zustände am 2026-08-15 am laufenden Client gemessen (Rohausgabe:
 * `docs/plans/2026-08-11T1321-restposten-aus-ux-plan/p5-punkt3-nachher.log`).
 */
test('Profil-Chip ersetzt den Mention-Span — und NUR dort, wo der Chip wirklich steht', async ({ page }) => {
    const h = trackRoom(`qc10${rnd()}`)
    createRoomNak(h, 'QC10')

    const npub = npubEncode(ADMIN_PUB)
    // Ein pubkey ohne kind 0 → Chip UND Span zeigten vorher dieselbe gekürzte Kette.
    const ghost = npubEncode('3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c')

    const mBekannt = `QCRep1-${rnd()}`
    const mUnbekannt = `QCRep2-${rnd()}`
    const mSatz = `QCRep3-${rnd()}`
    const mEvent = `QCRep4-${rnd()}`
    const mZwei = `QCRep5-${rnd()}`
    const mReply = `QCRep6-${rnd()}`

    publishRaw(h, ADMIN, `${mBekannt} nostr:${npub}`)
    publishRaw(h, ADMIN, `${mUnbekannt} nostr:${ghost}`)
    publishRaw(h, ADMIN, `${mSatz} schaut mal nostr:${npub} an bitte`)
    const zielId = publishRaw(h, ADMIN, `QCRepZiel-${rnd()}`)
    publishRaw(h, ADMIN, `${mEvent} nostr:${neventEncode({ id: zielId, relays: [], kind: 9 })} und nostr:${npub}`)
    publishRaw(h, ADMIN, `${mZwei} nostr:${npub} und nostr:${ghost}`)
    publishRaw(h, ADMIN, `${mReply} nostr:${npub}`, ['-t', `q=${zielId}`])

    await openRoom(page, h)
    await expect(page.getByText(mBekannt, { exact: false })).toBeVisible({ timeout: 15_000 })

    const zeile = (marker: string) => page.locator('div.group', { hasText: marker }).last()

    // 1) Chip da → Span weg. Der Name steht genau EINMAL, nämlich im Chip.
    await expect(zeile(mBekannt).getByRole('button', { name: /Profil anzeigen: Relay Admin/ })).toBeVisible({
        timeout: 15_000,
    })
    await expect(zeile(mBekannt).locator('.chat-content span.mention')).toHaveCount(0)

    // 2) Ohne geladenes kind 0: die gekürzte Kette EINMAL, nicht zweimal untereinander.
    await expect(zeile(mUnbekannt).getByRole('button', { name: /Profil anzeigen: npub18s7…5kgc0/ })).toBeVisible({
        timeout: 15_000,
    })
    await expect(zeile(mUnbekannt).locator('.chat-content span.mention')).toHaveCount(0)
    await expect(zeile(mUnbekannt).locator('.chat-content')).not.toContainText('npub18s7')

    // 3) Mention MITTEN im Satz: kein doppelter Abstand, wo der Span herausfällt.
    //    (`whitespace-pre-wrap` würde zwei Leerzeichen sichtbar stehen lassen.)
    await expect(zeile(mSatz).locator('.chat-content')).toHaveText(`${mSatz} schaut mal an bitte`)

    // 4) a) Ein `nevent` gewinnt gegen das `npub` → Zitatkarte, KEIN Profil-Chip →
    //    der Span bleibt, sonst wäre die Erwähnung spurlos weg.
    await expect(zeile(mEvent).getByRole('button', { name: /Profil anzeigen: / })).toHaveCount(0)
    await expect(zeile(mEvent).locator('.chat-content span.mention')).toHaveText(['@Relay Admin'])

    // 5) c) Zwei npubs, eine Karte: der Chip steht fürs ERSTE, der Span des ZWEITEN bleibt.
    await expect(zeile(mZwei).getByRole('button', { name: /Profil anzeigen: Relay Admin/ })).toBeVisible({
        timeout: 15_000,
    })
    await expect(zeile(mZwei).locator('.chat-content span.mention')).toHaveText(['@npub18s7…5kgc0'])

    // 6) b) Antwort-Vorschau (q-Tag) schlägt die Karte → kein Chip → Span bleibt.
    await expect(zeile(mReply).getByRole('button', { name: /Profil anzeigen: / })).toHaveCount(0)
    await expect(zeile(mReply).locator('.chat-content span.mention')).toHaveText(['@Relay Admin'])
})

// ── 11) P5.3 im Thread: Kommentar ohne Span, ROOT MIT Span ──────────────────────────

test('Thread: der Kommentar verliert seinen Span an den Chip, der Root behält ihn (er hat keinen Chip)', async ({
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

    // Der KOMMENTAR ist eine vollwertige ChatMessage mit `refCard` → Chip da, Span weg.
    const commentRow = dialog.locator('div.group', { hasText: commentMarker }).last()
    await expect(commentRow.getByRole('button', { name: /Profil anzeigen: Relay Admin/ })).toBeVisible({
        timeout: 15_000,
    })
    await expect(commentRow.locator('.chat-content span.mention')).toHaveCount(0)

    // Der ROOT wird über `personFields` OHNE refCard gebaut (`ThreadView`) → kein Chip.
    // Sein Span MUSS deshalb stehen bleiben; ohne ihn stünde im Thread-Kopf eine
    // Erwähnung, die nirgends mehr auftaucht.
    const rootBody = dialog.locator('[x-ref="rootBody"]').first()
    await expect(rootBody.locator('span.mention')).toHaveText(['@Relay Admin'])
})
