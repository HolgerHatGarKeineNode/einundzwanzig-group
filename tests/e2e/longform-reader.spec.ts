/**
 * P7 — Longform-Reader (`/articles`, `/articles/{naddr}`).
 *
 * **Eigener Server pro Worker.** Ob `/articles` seinen Leerzustand oder die Insel zeigt,
 * entscheidet `@if (! config('group.board_relay_url'))` — SERVER-seitig. Der geteilte
 * `serve`-Prozess aus `support/fixtures.ts` läuft für ALLE anderen Specs ohne
 * `NOSTR_BOARD_URL` (Hermetik bleibt erhalten, `fixtures.ts` ist unverändert). Diese Datei
 * importiert deshalb `test`/`expect` aus `support/board-fixtures.ts`, die ZUSÄTZLICH einen
 * zweiten `serve` mit gesetzter `NOSTR_BOARD_URL` hochfährt (siehe dortiger Kopfkommentar)
 * — derselbe worker-eigene zooid wie sonst, nur mit der Board-Config scharf.
 *
 * **Die serverseitige Fail-closed-Frage** (`config('group.board_relay_url')` leer → was
 * sieht der Nutzer?) steht bewusst NICHT hier, sondern in
 * `tests/Feature/LongformReaderTest.php` — reines Blade-Markup-Rendering ohne Alpine-Boot
 * und ohne Relay, die billigere Schicht für eine rein server-seitige Bedingung.
 *
 * Artikel kommen roh über `nak` auf den Relay (Muster `support/rooms.ts`/`quote-card.spec.ts`)
 * — exakte Kontrolle über Tags, `d`-Identifier und Inhalt, siehe `support/articles.ts`.
 */
import { execFileSync } from 'node:child_process'
import { naddrEncode } from 'nostr-tools/nip19'
import { test, expect, type Page } from './support/board-fixtures'
import { useZooid } from './support/zooid'
import { loginNsec } from './support/login'
import { cleanupArticles, publishArticle } from './support/articles'

const NSEC = process.env.NOSTR_TEST_NSEC as string
const ADMIN = 'b2ee09a54bedf17ee1db562bdddd75c48661d981eb52c49dc206c55ba8439414'
const ADMIN_PUB = 'da99fbe39247109327ac8504750d0227d50a8f84049ac8bd2f6c7ad0806ed76d'

const rnd = (): number => Math.floor(Math.random() * 1e9)

/** Der Board-Relay dieses Workers — SELBE Instanz wie der reguläre Space (siehe board-fixtures.ts). */
function boardWs(baseURL: string): string {
    // baseURL sieht aus wie `http://127.0.0.1:8437+slot` — der Board-Relay-Port folgt
    // derselben Formel wie in `support/zooid.ts` (`3335 + slot`). `board-fixtures.ts`
    // rechnet denselben Slot; hier wird er aus der URL rückgewonnen, damit diese Datei
    // keinen zweiten Port-Rechner pflegen muss.
    const port = Number(new URL(baseURL).port)
    const slot = port - 8437
    return `ws://localhost:${3335 + slot}`
}

async function loginToBoard(page: Page): Promise<void> {
    await useZooid(page)
    await loginNsec(page, NSEC)
}

test.afterAll(async ({ baseURL }) => {
    if (baseURL) {
        cleanupArticles(boardWs(baseURL), ADMIN)
    }
})

// ── Liste: alle Artikel, kein draft-*-Verlust (wörtlicher DoD-Punkt) ────────────────

test('Liste: ein normaler Artikel UND ein Artikel mit d=draft-<ts> erscheinen BEIDE — kein draft-*-Verlust', async ({
    page,
    baseURL,
}) => {
    const ws = boardWs(baseURL as string)
    const normalTitle = `LFNormal-${rnd()}`
    const draftTitle = `LFDraft-${rnd()}`

    publishArticle(ws, ADMIN, ADMIN_PUB, {
        identifier: `lf-normal-${rnd()}`,
        title: normalTitle,
        content: 'Ein ganz normal identifizierter Artikel.',
        publishedAt: 1_700_000_000,
    })
    // Der teuerste stille Fehler dieser Phase: ein Filter auf das `d`-Muster verschluckt
    // GENAU diesen Artikel, obwohl er ganz normal publiziert ist (siehe LONGFORM_DRAFT-Doku
    // in js/longform.ts).
    publishArticle(ws, ADMIN, ADMIN_PUB, {
        identifier: `draft-${Date.now()}${rnd()}`,
        title: draftTitle,
        content: 'Ein publizierter Artikel, dessen d-Tag zufällig wie ein Entwurf aussieht.',
        publishedAt: 1_700_000_001,
    })

    await loginToBoard(page)
    await page.goto('/articles')

    await expect(page.getByRole('heading', { name: normalTitle, exact: true })).toBeVisible({ timeout: 20_000 })
    await expect(page.getByRole('heading', { name: draftTitle, exact: true })).toBeVisible({ timeout: 20_000 })
})

// ── DER KERNBEWEIS DER P2 (Artikelliste) ───────────────────────────────────────────
//
// „Ein Wort, das NUR im Titel steht, findet den Artikel — und der Bestand wird dabei
// NICHT neu geladen."
//
// Die ERSTE Hälfte steht zusätzlich als reiner Test in `js/articleList.test.ts`
// (`KERNBEWEIS: ein Wort, das NUR im Titel steht, findet den Artikel`). Die ZWEITE ist
// eine Aussage über das NETZ und deshalb hier: ein reines Modul kann per Konstruktion
// nicht zeigen, dass ein Tastendruck keinen REQ auslöst — es kennt gar keinen Relay.
// Genau deshalb liegt diese eine Datei im Host-`tests/`.
//
// Gezählt wird am abgesendeten Rahmen (`framesent`), nicht an einem Zustand im Produkt:
// `window.__reqWatch()` liefert ÜBERFÄLLIGE REQs, nicht die vollständige Liste — es als
// Beweis zu benutzen hieße, das Produkt für den Test umzubauen. Gefiltert wird auf
// Rahmen, die BEIDES tragen: `["REQ"` und `30023`. Der Board-Relay ist dieselbe Instanz
// wie der Space-Relay dieses Workers, es fliegen also ständig fremde REQs (Profile,
// Räume, Lesestand) über dieselbe Leitung; ohne den Kind-Filter zählte der Beweis das
// Rauschen der App mit und wäre wertlos.

/** Zählt abgesendete REQ-Rahmen, die nach kind 30023 fragen. Vor der Navigation setzen. */
function zaehleArtikelReqs(page: Page): () => number {
    let treffer = 0
    page.on('websocket', (ws) => {
        ws.on('framesent', (frame) => {
            const nutzlast = typeof frame.payload === 'string' ? frame.payload : frame.payload.toString()
            if (nutzlast.startsWith('["REQ"') && nutzlast.includes('30023')) {
                treffer += 1
            }
        })
    })

    return () => treffer
}

/**
 * Wartet, bis der Zähler zur Ruhe gekommen ist.
 *
 * Ohne diesen Schritt hinge der Beweis an einem Rennen: die Liste steht schon, während
 * ein nachlaufender `load` noch unterwegs sein kann — der Zuwachs käme dann aus dem
 * Seitenaufbau und würde dem Tastendruck angelastet. Gewartet wird auf eine BEDINGUNG
 * (zwei gleiche Messungen in Folge), nicht auf eine feste Zeitspanne.
 */
async function wartetAufRuhe(page: Page, zaehler: () => number): Promise<number> {
    let letzter = -1
    for (let versuch = 0; versuch < 20; versuch++) {
        const jetzt = zaehler()
        if (jetzt === letzter) {
            return jetzt
        }
        letzter = jetzt
        await page.waitForTimeout(500)
    }

    return zaehler()
}

test('KERNBEWEIS P2: ein Wort NUR im Titel findet den Artikel — und es geht KEIN neuer REQ raus', async ({
    page,
    baseURL,
}) => {
    test.setTimeout(90_000)

    const ws = boardWs(baseURL as string)
    // Ein Kunstwort: es darf in KEINEM anderen Artikel des Relays vorkommen, auch nicht
    // in einem, den ein früherer Lauf liegen gelassen hat.
    const stichwort = `Zwiebelfisch${rnd()}`
    const trefferTitel = `${stichwort} im Bleisatz`
    const restTitel = `LFOhneStichwort-${rnd()}`

    publishArticle(ws, ADMIN, ADMIN_PUB, {
        identifier: `lf-suche-treffer-${rnd()}`,
        title: trefferTitel,
        // Weder Kurzfassung noch Fließtext tragen das Wort — der Treffer kann
        // ausschließlich aus dem TITEL kommen. Das ist die Vorbedingung des Beweises.
        summary: 'Eine Betrachtung über Satzfehler im Druck.',
        content: 'Der Text handelt von Blei und Antimon und sonst von gar nichts.',
        publishedAt: 1_700_000_010,
    })
    publishArticle(ws, ADMIN, ADMIN_PUB, {
        identifier: `lf-suche-rest-${rnd()}`,
        title: restTitel,
        content: 'Ein ganz anderer Artikel ohne das Kunstwort.',
        publishedAt: 1_700_000_011,
    })

    const artikelReqs = zaehleArtikelReqs(page)
    await loginToBoard(page)
    await page.goto('/articles')

    const treffer = page.getByRole('heading', { name: trefferTitel, exact: true })
    const rest = page.getByRole('heading', { name: restTitel, exact: true })
    await expect(treffer).toBeVisible({ timeout: 20_000 })
    await expect(rest).toBeVisible({ timeout: 20_000 })

    // Erst wenn der Seitenaufbau seine Anfragen abgeschlossen hat, ist der Zähler ein
    // Nullpunkt und kein bewegtes Ziel.
    const vorher = await wartetAufRuhe(page, artikelReqs)
    expect(vorher, 'der Bestand wurde ueberhaupt geladen').toBeGreaterThanOrEqual(1)

    const suchfeld = page.getByPlaceholder('Artikel suchen…')
    await expect(suchfeld).toBeVisible()
    await suchfeld.fill(stichwort)

    // Erste Haelfte: das Wort steht nur im Titel und findet trotzdem.
    await expect(treffer).toBeVisible({ timeout: 10_000 })
    // Und es FILTERT wirklich — sonst waere „gefunden" nur „stand ohnehin da".
    await expect(rest).toBeHidden({ timeout: 10_000 })
    // ZWEIMAL mit Absicht, und deshalb `toHaveCount(2)` statt `toBeVisible()`: die graue
    // Zahl neben den Bedienelementen UND die `sr-only`-Ansage in der Live-Region
    // (WCAG 4.1.3 — beim Tippen wandert der Fokus nicht, eine Sprachausgabe erfaehrt sonst
    // nichts von der Aenderung). Beide tragen denselben Text; ein `getByText` findet also
    // zwei Knoten, und diese Zusicherung haelt genau das fest, statt es wegzufiltern.
    await expect(page.getByText('1 Artikel', { exact: true })).toHaveCount(2)

    // Zweite Haelfte: die Suche ist clientseitig. Kein einziger neuer REQ nach kind 30023.
    // Nochmals abgewartet, damit ein verzoegerter Request nicht durchrutscht.
    const nachher = await wartetAufRuhe(page, artikelReqs)
    expect(nachher, `Suche hat ${nachher - vorher} zusaetzliche Artikel-REQs ausgeloest`).toBe(vorher)

    console.log(`[p2-kernbeweis] Artikel-REQs vor der Suche=${vorher}, danach=${nachher}`)
})

// ── Podcast-Episoden sind eine eigene Klasse — mit Player, ohne Dauer ───────────────

test('Liste: eine Audio-Episode bekommt Plakette und Player aus dem imeta, ein Bild-imeta bekommt KEINEN', async ({
    page,
    baseURL,
}) => {
    test.setTimeout(90_000)

    const ws = boardWs(baseURL as string)
    const folgeTitel = `LFFolge-${rnd()}`
    const bildTitel = `LFGalerie-${rnd()}`
    const audioUrl = `https://podcast.test/folge-${rnd()}.mp3`

    publishArticle(ws, ADMIN, ADMIN_PUB, {
        identifier: `lf-folge-${rnd()}`,
        title: folgeTitel,
        content: 'Die Schaunotizen zur Folge.',
        publishedAt: 1_700_000_020,
        imeta: [`url ${audioUrl}`, 'm audio/mpeg'],
    })
    // Die Gegenprobe: GENAU EIN Artikel des echten Bestands traegt ein `imeta` mit
    // `m image/webp`. Ein Audio-Player darunter waere der sichtbare Fehler.
    publishArticle(ws, ADMIN, ADMIN_PUB, {
        identifier: `lf-galerie-${rnd()}`,
        title: bildTitel,
        content: 'Ein Artikel mit einem Bild-imeta.',
        publishedAt: 1_700_000_021,
        imeta: ['url https://bild.test/x.webp', 'm image/webp'],
    })

    await loginToBoard(page)
    await page.goto('/articles')

    const folge = page.locator('article').filter({ has: page.getByRole('heading', { name: folgeTitel, exact: true }) })
    const galerie = page.locator('article').filter({ has: page.getByRole('heading', { name: bildTitel, exact: true }) })
    await expect(folge).toBeVisible({ timeout: 20_000 })
    await expect(galerie).toBeVisible({ timeout: 20_000 })

    // Die Klasse: Plakette und Einstieg zum Hoeren.
    await expect(folge.getByText('Podcast', { exact: true })).toBeVisible()
    const knopf = folge.getByRole('button', { name: `Folge anhören: ${folgeTitel}` })
    await expect(knopf).toBeVisible()

    // Im RUHEZUSTAND existiert kein `<audio>` — die Liste kann also nichts vom fremden
    // Podcast-Host holen, und die Leiste des nativen Players kann kein „0:00" behaupten
    // (genau das tut sie ohne bekannte Laenge, am Bildschirm nachgesehen).
    await expect(folge.locator('audio')).toHaveCount(0)
    await expect(folge).not.toContainText('0:00')

    // Erst der Klick setzt den Player — und seine Quelle stammt aus dem imeta-`url`.
    await knopf.click()
    const player = folge.locator('audio')
    await expect(player).toHaveCount(1)
    await expect(player).toHaveAttribute('src', audioUrl)

    // Die Gegenprobe: das Bild-imeta erzeugt weder Plakette noch Einstieg.
    await expect(galerie.locator('audio')).toHaveCount(0)
    await expect(galerie.getByRole('button', { name: /Folge anhören/ })).toHaveCount(0)
    await expect(galerie.getByText('Podcast', { exact: true })).toHaveCount(0)
})

// ── Reader lädt und rendert; naddr-Kaltstart ist hier strukturell dasselbe ─────────
//
// Jeder Test bekommt einen FRISCHEN Browser-Kontext (Playwright-Fixture) — das
// Repository ist beim `page.goto()` unten also leer, und `/articles/{naddr}` als ERSTE
// Navigation IST der Kaltstart-Fall (kein vorheriger Listenbesuch, der den Artikel schon
// ins lokale Repository geladen hätte). Deshalb erfüllt dieser eine Test beide DoD-Punkte
// „Reader lädt einen Artikel" und „Kaltstart auf einen geteilten naddr-Link funktioniert".

test('Reader: naddr-Kaltstart lädt den Artikel direkt und rendert Titel, Markdown und Themen', async ({
    page,
    baseURL,
}) => {
    const ws = boardWs(baseURL as string)
    const title = `LFReader-${rnd()}`
    const identifier = `lf-reader-${rnd()}`
    const boldMarker = `Fettmarker${rnd()}`
    const content = `# Überschrift ${rnd()}\n\nEin Absatz mit **${boldMarker}** und einem [Link](https://example.com/artikel).`

    publishArticle(ws, ADMIN, ADMIN_PUB, {
        identifier,
        title,
        content,
        publishedAt: 1_700_000_002,
        topics: ['bitcoin', 'freiheit'],
    })

    const naddr = naddrEncode({ kind: 30023, pubkey: ADMIN_PUB, identifier, relays: [] })

    await loginToBoard(page)
    // Kaltstart: direkte Navigation auf den Artikel-Link, KEIN vorheriger /articles-Besuch.
    await page.goto(`/articles/${naddr}`)

    await expect(page.getByRole('heading', { name: title, level: 1 })).toBeVisible({ timeout: 20_000 })

    const body = page.locator('.article-content')
    await expect(body.locator('strong', { hasText: boldMarker })).toBeVisible({ timeout: 20_000 })
    await expect(body.getByRole('link', { name: 'Link' })).toHaveAttribute('href', 'https://example.com/artikel')
    // Themen (t-Tags) rendern als eigene Chips außerhalb von .article-content.
    await expect(page.getByText('#bitcoin', { exact: true })).toBeVisible()
    await expect(page.getByText('#freiheit', { exact: true })).toBeVisible()
})

// ── Ein kaputter naddr zeigt eine ehrliche Aussage, keine leere Bühne ───────────────

test('Reader: ein syntaktisch kaputter naddr zeigt "gibt es nicht" statt einer leeren/endlos ladenden Seite', async ({
    page,
}) => {
    await loginToBoard(page)
    await page.goto('/articles/naddr1thisisnotvalidbech32atall')

    await expect(page.getByText('Diesen Artikel gibt es nicht.', { exact: true })).toBeVisible({ timeout: 20_000 })
    await expect(page.getByRole('link', { name: 'Alle Artikel' })).toBeVisible()
})

test('Reader: ein syntaktisch gültiger naddr auf einen NIE publizierten Artikel zeigt ebenfalls "gibt es nicht"', async ({
    page,
}) => {
    const ghostNaddr = naddrEncode({ kind: 30023, pubkey: 'f'.repeat(64), identifier: `lf-ghost-${rnd()}`, relays: [] })

    await loginToBoard(page)
    await page.goto(`/articles/${ghostNaddr}`)

    await expect(page.getByText('Diesen Artikel gibt es nicht.', { exact: true })).toBeVisible({ timeout: 20_000 })
})

// ── Schweigender Relay: Fehler-Callout, nicht „gibt es nicht" (Restposten P7 Punkt 2) ─
//
// `missing` („Diesen Artikel gibt es nicht.") ist eine Aussage ÜBER den Relay und nur
// gedeckt, wenn er wirklich geantwortet hat (`LoadOutcome.complete`, `longformFeed.ts`).
// `error` („gerade nicht erreichbar" + „Erneut laden") ist der Zustand für Schweigen.
// Diese zwei Tests bewachen genau diese Trennung — vorher hatte keiner sie im Netz.

/** Port, auf dem kein Relay dieser Suite lauscht — außerhalb aller belegten Bereiche
 *  (serve 8137+, board-serve 8437+, zooid 3335+, buzz 3001+, siehe support/fixtures.ts
 *  und board-fixtures.ts). `routeWebSocket` fängt die Verbindung ab, BEVOR gewählt
 *  wird — der Port muss nur eindeutig und von nichts belegt sein. */
const SILENT_BOARD_PORT = 3999

/** Zwei Zähler über dem stummen Relay: Transport (Sockets) und Anfragen (REQ-Rahmen). */
type SilenceProbe = {
    /** Verbindungsaufbauten zum stummen Relay. Erwartungsgemäß 1 — welshman hält den
     *  Socket im Pool offen; ein zweiter Versuch braucht keinen zweiten Socket. */
    dials: () => number
    /** Abgesendete REQ-Rahmen — JEDER `load()` fragt genau einmal an, auch wenn er
     *  über den gepoolten Socket läuft. Das ist der Versuchszähler des Retry-Tests. */
    reqs: () => number
}

/**
 * Macht NUR den Artikel-Relay stumm — der Space-Relay (Login, App-Shell) läuft auf
 * seinem eigenen Port weiter. Zwei Hebel:
 *
 *  - `addInitScript` setzt `window.__nostrBoard`, bevor irgendein Seitenscript läuft;
 *    das `??` im Head-Partial (`partials/head.blade.php:30`) lässt den Test gewinnen
 *    (derselbe dokumentierte Eingriff wie `__nostrSpace` in `support/zooid.ts`).
 *  - `routeWebSocket` OHNE `connectToServer` macht die Verbindung zum schwarzen Loch
 *    (Muster `unread-dot.spec.ts:260`): kein EOSE, `load()` löst mit `complete: false`
 *    auf — das ist exakt der Zustand „Relay hat nicht geantwortet".
 *
 * Gezählt wird auf BEIDEN Ebenen (Muster `room.spec.ts:1382`, Frame-Sniffing im
 * Route-Handler): Sockets und REQ-Rahmen. Gemessen am 2026-08-15: der Retry-`load`
 * wählt KEINEN zweiten Socket — welshman verwaltet die Verbindung im Pool und sendet
 * den zweiten REQ über dieselbe (stumme) Leitung. Der Versuchsbeweis kann deshalb
 * nicht am Socket hängen, er hängt am REQ.
 */
async function silenceArticleRelay(page: Page): Promise<SilenceProbe> {
    let dialCount = 0
    let reqCount = 0
    await page.routeWebSocket(new RegExp(`localhost:${SILENT_BOARD_PORT}`), (ws) => {
        dialCount++
        ws.onMessage((raw) => {
            const s = typeof raw === 'string' ? raw : raw.toString()
            try {
                const parsed = JSON.parse(s) as unknown[]
                if (parsed[0] === 'REQ') {
                    reqCount++
                }
            } catch {
                // Kein JSON → kein Nostr-Rahmen, zählt nicht.
            }
        })
    })
    await page.addInitScript((url) => {
        ;(window as unknown as { __nostrBoard?: string }).__nostrBoard = url
    }, `ws://localhost:${SILENT_BOARD_PORT}/`)

    return { dials: () => dialCount, reqs: () => reqCount }
}

test('Reader: schweigender Relay zeigt Fehler-Callout und Erneut laden — NICHT „gibt es nicht"', async ({
    page,
    baseURL,
}) => {
    test.setTimeout(60_000) // EOSE-Timeout des schwarzen Lochs (~3 s) + Login — äußerer Deckel

    const ws = boardWs(baseURL as string)
    const identifier = `lf-silent-${rnd()}`

    // Der Artikel EXISTIERT auf dem Relay (`publishArticle` requiriert ihn zurück) —
    // jede „gibt es nicht"-Aussage wäre damit nachweislich falsch. Genau diese Lüge
    // ist es, die die error/missing-Trennung verhindern soll: der Client weiß nichts
    // über den Relay, und „kennt ihn nicht" behauptet trotzdem etwas über ihn.
    publishArticle(ws, ADMIN, ADMIN_PUB, {
        identifier,
        title: `LFSilent-${rnd()}`,
        content: 'Ein Artikel, den der Relay kennt, aber gerade nicht herausrückt.',
        publishedAt: 1_700_000_003,
    })
    const naddr = naddrEncode({ kind: 30023, pubkey: ADMIN_PUB, identifier, relays: [] })

    await loginToBoard(page)
    const probe = await silenceArticleRelay(page)
    await page.goto(`/articles/${naddr}`)

    await expect(page.getByText('Der Artikel ist gerade nicht erreichbar.', { exact: true })).toBeVisible({
        timeout: 20_000,
    })
    await expect(page.getByRole('button', { name: 'Erneut laden' })).toBeVisible()

    // Die Unterscheidung selbst: Schweigen darf keine Relay-Aussage produzieren. Erst
    // NACH dem Callout geprüft — zu diesem Zeitpunkt ist `loading` vorbei, der Zustand
    // hat sich eingeschwungen, die Prüfung kann nicht auf einem Übergang bestehen.
    await expect(page.getByText('Diesen Artikel gibt es nicht.', { exact: true })).toBeHidden()
    await expect(page.getByText('Dieser Link führt zu keinem Artikel.', { exact: true })).toBeHidden()

    // Das Schweigen wurde wirklich befragt (belegt den Hebel, nicht nur die Aussage):
    expect(probe.reqs(), 'mindestens ein REQ gegen das stumme Relay').toBeGreaterThanOrEqual(1)
})

test('Reader: „Erneut laden" wählt den Relay neu an — am Verbindungszähler belegt', async ({ page, baseURL }) => {
    test.setTimeout(60_000) // zwei EOSE-Timeouts des schwarzen Lochs + Login

    const ws = boardWs(baseURL as string)
    const identifier = `lf-retry-${rnd()}`

    publishArticle(ws, ADMIN, ADMIN_PUB, {
        identifier,
        title: `LFRetry-${rnd()}`,
        content: 'Ein Artikel für den zweiten Versuch.',
        publishedAt: 1_700_000_004,
    })
    const naddr = naddrEncode({ kind: 30023, pubkey: ADMIN_PUB, identifier, relays: [] })

    await loginToBoard(page)
    const probe = await silenceArticleRelay(page)
    await page.goto(`/articles/${naddr}`)

    await expect(page.getByText('Der Artikel ist gerade nicht erreichbar.', { exact: true })).toBeVisible({
        timeout: 20_000,
    })
    // Steht das Callout, ist der erste `load()` aufgelöst — die Zähler ruhen.
    const before = probe.reqs()
    expect(before, 'erster Versuch muss angefragt haben').toBeGreaterThanOrEqual(1)

    await page.getByRole('button', { name: 'Erneut laden' }).click()

    // Der Netzwerkbeweis: der Klick führt zu einer NEUEN Anfrage, nicht nur zu einem
    // UI-Toggle — am REQ-Zähler des schwarzen Lochs, ohne Timing. (Sockets reichen
    // hier nicht: der Pool hält die stumme Leitung offen, siehe silenceArticleRelay.)
    await expect.poll(() => probe.reqs() - before, { timeout: 10_000 }).toBeGreaterThanOrEqual(1)

    // Nach dem zweiten scheiternden Versuch steht derselbe ehrliche Satz wieder da …
    await expect(page.getByText('Der Artikel ist gerade nicht erreichbar.', { exact: true })).toBeVisible({
        timeout: 20_000,
    })
    // … und wieder kein „gibt es nicht" (auch nicht nach dem Retry).
    await expect(page.getByText('Diesen Artikel gibt es nicht.', { exact: true })).toBeHidden()

    // Rohbeweis fürs Protokoll: beide Zählerstufen nach dem Lauf.
    console.log(`[p7-retry] Sockets=${probe.dials()} REQs=${probe.reqs()} (vor dem Retry: REQs=${before})`)
})

// ── Einstiege: /spaces-Zeile, Rail (Desktop), Befehlspalette ────────────────────────

test('Einstieg: /spaces zeigt die Zeile "Artikel lesen" und führt zu /articles', async ({ page }) => {
    await loginToBoard(page)
    await page.goto('/spaces')

    const entry = page.getByRole('link', { name: 'Artikel lesen' })
    await expect(entry).toBeVisible({ timeout: 20_000 })
    await entry.click()
    await expect(page).toHaveURL(/\/articles$/)
})

test('Einstieg: die Desktop-Rail-Fußzeile trägt "Artikel" und führt zu /articles', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await loginToBoard(page)
    await page.goto('/spaces')

    const rail = page.locator('[data-rail]')
    await expect(rail).toBeVisible({ timeout: 20_000 })
    const entry = rail.getByRole('link', { name: 'Artikel', exact: true })
    await expect(entry).toBeVisible()
    await entry.click()
    await expect(page).toHaveURL(/\/articles$/)
})

test('Einstieg: die Befehlspalette findet "Artikel" unter Aktionen und führt zu /articles', async ({ page }) => {
    await loginToBoard(page)
    await page.goto('/spaces')
    await expect(page.getByText('Zooid Test Space').first()).toBeVisible({ timeout: 15_000 })

    await page.keyboard.press('Meta+K')
    const dialog = page.locator('dialog[data-modal="command-palette"]')
    await expect(dialog).toBeVisible({ timeout: 10_000 })

    await page.locator('[data-palette-input]').fill('>artikel')
    const row = page.locator('[data-palette-section="actions"]').getByText('Artikel', { exact: true })
    await expect(row).toBeVisible({ timeout: 10_000 })
    await row.click()

    await expect(dialog).toBeHidden({ timeout: 10_000 })
    await expect(page).toHaveURL(/\/articles$/)
})
