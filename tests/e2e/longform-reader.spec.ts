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
import { cleanupArticles, publishArticle, publishProfile } from './support/articles'

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

// ── P3: DER KERNBEWEIS AM LAUFENDEN ALPINE ────────────────────────────────────────
//
// „Die Renderer-Ausgabe enthält kein einziges Attribut, das mit `x-`, `@` oder `:`
// beginnt." Die Zusage steht vollständig und über den ganzen Formen-Satz als reiner Test
// in `packages/einundzwanzig-group/js/articleRenderSicherheit.test.ts` — dort ist sie
// billig, schnell und mutationsgeprüft.
//
// **Warum sie hier trotzdem ein zweites Mal steht:** der reine Test misst die
// ZEICHENKETTE, die der Renderer liefert. Gefährlich wird sie erst, wenn Alpine sie über
// `x-html` einsetzt und `initTree()` auf dem Teilbaum läuft. Diese Hälfte — echtes
// Alpine, echtes `x-html`, echter Teilbaum — kann per Konstruktion kein Modul-Test
// zeigen. Gemessen wird deshalb am DOM NACH dem Einsetzen, nicht an der Ausgabe davor.
//
// Der Artikeltext trägt bewusst mehrere Versuche, ein Alpine-Attribut zu erzeugen.

test('KERNBEWEIS P3: nach dem x-html-Einsetzen traegt KEIN Element im Artikeltext ein x-/@/:-Attribut', async ({
    page,
    baseURL,
}) => {
    const ws = boardWs(baseURL as string)
    const title = `LFSicher-${rnd()}`
    const identifier = `lf-sicher-${rnd()}`
    const marker = `Sichtbar${rnd()}`
    // Rohes HTML, ein Bild mit Alpine-Attribut im Alt-Text, ein Link mit `x-init` im
    // Query-String, eine Codezaun-Sprache und eine Überschrift — dieselben Formen wie im
    // reinen Test, nur diesmal durch das echte `x-html`.
    const content = [
        `<div x-init="window.__gehackt = true">${marker}</div>`,
        '<img src=x @click="window.__gehackt = true">',
        '![:href="window.__gehackt = true"](https://example.com/b.png)',
        '[k](https://example.com/s?x-init=window.__gehackt%3Dtrue)',
        '# x-init="window.__gehackt = true"',
        '```x-init="window.__gehackt = true"\ncode\n```',
        // `wire:init` läuft ohne Nutzerhandlung (Begründung in der Sonde unten),
        // Großschreibung wird vom Parser normalisiert, und die letzte Zeile ist die
        // BLEND-Lage: ein rohes `<br>` im Alt-Text schiebt alles Folgende hinter ein `>`
        // innerhalb eines Attributwerts — daran war der reine Scanner blind.
        '<div wire:init="window.__gehackt = true">w</div>',
        '<div X-INIT="window.__gehackt = true">g</div>',
        '![a<br />b](https://example.com/c.png)',
    ].join('\n\n')

    publishArticle(ws, ADMIN, ADMIN_PUB, { identifier, title, content, publishedAt: 1_700_000_010 })
    const naddr = naddrEncode({ kind: 30023, pubkey: ADMIN_PUB, identifier, relays: [] })

    await loginToBoard(page)
    await page.goto(`/articles/${naddr}`)
    await expect(page.locator('[data-artikel-text]')).toBeVisible({ timeout: 20_000 })
    // Erst wenn der Text wirklich da ist, hat `initTree()` gelaufen. Ohne diese
    // Bedingung prüfte der Test womöglich einen leeren Teilbaum und wäre fail-open.
    await expect(page.locator('[data-artikel-text]')).toContainText(marker, { timeout: 20_000 })

    const befund = await page.evaluate(() => {
        const wurzel = document.querySelector('[data-artikel-text]')
        if (!wurzel) {
            throw new Error('Kein [data-artikel-text] im DOM — die Sonde misst nichts.')
        }
        // `wurzel` selbst ist AUSGENOMMEN: sie trägt `x-html` und `x-on:click` von uns,
        // das ist ihr Zweck. Geprüft wird, was der Renderer HINEINgelegt hat.
        //
        // **`wire:` gehört dazu, obwohl es nach Serverkram klingt.** Diese Seite ist eine
        // Livewire-Full-Page-Komponente, und Livewire hängt sich per
        // `Alpine.interceptInit` in JEDE Element-Initialisierung ein
        // (`vendor/livewire/livewire/dist/livewire.esm.js:13650`) — also auch in den
        // Teilbaum, den `x-html` gerade eingesetzt hat. Dort mappt es `wire:*` auf
        // `x-on:*` mit Ausdrucksauswertung (`:14960`) und `wire:intersect` auf
        // `x-intersect` (`:14833`); `wire:init` läuft ohne jede Nutzerhandlung.
        //
        // Kleingeschrieben verglichen, weil der HTML-Parser Attributnamen normalisiert:
        // ein `X-INIT` im Markup steht im DOM als `x-init` und ist live.
        const gefaehrlich = (name: string): boolean => {
            const klein = name.toLowerCase()
            return klein.startsWith('x-') || klein.startsWith('wire:') || klein.startsWith('@') || klein.startsWith(':')
        }
        const treffer: string[] = []
        for (const el of wurzel.querySelectorAll('*')) {
            for (const attr of el.attributes) {
                if (gefaehrlich(attr.name)) {
                    treffer.push(`${el.tagName.toLowerCase()}[${attr.name}]`)
                }
            }
        }
        return { treffer, kinder: wurzel.querySelectorAll('*').length, gehackt: '__gehackt' in window }
    })

    // Die Schranke zuerst: ein leerer Teilbaum bestünde die Prüfung darunter mühelos.
    expect(befund.kinder).toBeGreaterThan(3)
    expect(befund.treffer).toEqual([])
    // Und die Gegenprobe auf der Wirkung: kein Ausdruck ist gelaufen.
    expect(befund.gehackt).toBe(false)
})

// ── P3: Lightbox, Lesefortschritt, Teilen ─────────────────────────────────────────
//
// **Die Überschrift stimmt seit 2026-08-21 wieder mit dem Inhalt überein.** Sie nannte
// „Teilen", und einen Teilen-Test gab es nicht — die Zusage hielt in der Sache (live
// belegt), der Text behauptete aber eine Deckung, die keine war. Statt die Überschrift zu
// kürzen ist der Test nachgezogen: er ist billig, weil `navigator.clipboard.writeText`
// im Browserkontext direkt lesbar ist.
//
// Das ASIDE steht bewusst NICHT in dieser Liste: seine `xl`-Anordnung ist bei den hier
// gefahrenen 1279 px per Definition nicht sichtbar. Sie liegt in
// `desktop-article.spec.ts`, das vom Playwright-Projekt `desktop` (1440×900) gegriffen
// wird — der Dateiname ist dort die Bedingung, nicht eine Konvention.

test('Reader: ein Klick auf ein Artikelbild oeffnet die Lightbox, Escape schliesst sie', async ({ page, baseURL }) => {
    const ws = boardWs(baseURL as string)
    const identifier = `lf-bild-${rnd()}`
    publishArticle(ws, ADMIN, ADMIN_PUB, {
        identifier,
        title: `LFBild-${rnd()}`,
        content: 'Ein Absatz.\n\n![Ein Bild](https://example.com/artikelbild.png)\n\nNoch ein Absatz.',
        publishedAt: 1_700_000_011,
    })
    const naddr = naddrEncode({ kind: 30023, pubkey: ADMIN_PUB, identifier, relays: [] })

    await loginToBoard(page)
    await page.goto(`/articles/${naddr}`)
    const bild = page.locator('[data-artikel-text] img.article-image')
    await expect(bild).toBeVisible({ timeout: 20_000 })
    // Das Attribut, aus dem der Auslöser die Quelle liest — dieselbe Bauform wie im Chat.
    await expect(bild).toHaveAttribute('data-full', /.+/)

    // Über das aria-label und NICHT über `[role="dialog"][aria-modal="true"]`: das
    // Login-Sheet trägt dieselbe Rollen-Kombination, und der Selektor bricht im Vollauf
    // mit einer Strict-Mode-Mehrdeutigkeit (im Haus schon fünfmal passiert).
    const lightbox = page.getByLabel('Bild in voller Größe')
    await expect(lightbox).toBeHidden()
    await bild.click()
    await expect(lightbox).toBeVisible({ timeout: 5_000 })
    await page.keyboard.press('Escape')
    await expect(lightbox).toBeHidden({ timeout: 5_000 })
})

test('Reader: der Teilen-Knopf legt den KANONISCHEN naddr-Link in die Zwischenablage', async ({
    page,
    baseURL,
    context,
}) => {
    const ws = boardWs(baseURL as string)
    const identifier = `lf-teilen-${rnd()}`
    publishArticle(ws, ADMIN, ADMIN_PUB, {
        identifier,
        title: `LFTeilen-${rnd()}`,
        content: 'Ein Artikel, den man weitergeben können soll.',
        publishedAt: 1_700_000_014,
    })
    const naddr = naddrEncode({ kind: 30023, pubkey: ADMIN_PUB, identifier, relays: [] })

    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await loginToBoard(page)
    await page.goto(`/articles/${naddr}`)
    await expect(page.locator('[data-artikel-text]')).toBeVisible({ timeout: 20_000 })

    // Headless-Chromium hat KEIN `navigator.share` — der Knopf heißt dort „Link kopieren"
    // und kopiert. Das ist kein Sonderfall des Tests, sondern der Normalfall auf jedem
    // Desktop-Firefox und in jedem unsicheren Kontext. Die Beschriftung wird deshalb
    // mitgeprüft: ein Knopf, der etwas anderes verspricht als er tut, wäre schlimmer als
    // der fehlende Systemdialog.
    const knopf = page.getByRole('button', { name: 'Link kopieren' })
    await expect(knopf).toBeVisible({ timeout: 10_000 })
    await expect(knopf).not.toHaveAttribute('aria-disabled', 'true')
    await knopf.click()

    const abgelegt = await page.evaluate(() => navigator.clipboard.readText())
    // Der KANONISCHE `naddr` aus dem Event, nicht die Adresszeile des Browsers: beide
    // zeigen auf denselben Artikel, aber nur der kanonische sagt einem fremden Client
    // auch, WO er ihn findet. Auf `/articles/` geankert statt auf die volle Basis-URL —
    // der Worker-Port wechselt je Lauf.
    expect(abgelegt).toContain('/articles/naddr1')
    expect(abgelegt.endsWith(`/articles/${naddr}`) || /\/articles\/naddr1[0-9a-z]+$/.test(abgelegt)).toBe(true)
    // Und die Erfolgsmeldung — der Nutzer bekommt eine Rückmeldung, nicht nur einen
    // stillen Klick (Sichtbarkeit des Systemstatus).
    await expect(page.getByText('Link kopiert.', { exact: true })).toBeVisible({ timeout: 10_000 })
})

test('Reader: ein KURZER Artikel bekommt keine Leseleiste — und nirgends steht NaN', async ({ page, baseURL }) => {
    const ws = boardWs(baseURL as string)
    const identifier = `lf-kurz-${rnd()}`
    publishArticle(ws, ADMIN, ADMIN_PUB, {
        identifier,
        title: `LFKurz-${rnd()}`,
        // 57 der 104 echten Artikel haben nicht einmal eine Überschrift; viele passen
        // ganz aufs Bild. Das ist der Normalfall dieser Fläche, nicht ihr Rand.
        content: 'Ein einziger kurzer Absatz, der bequem ins Fenster passt.',
        publishedAt: 1_700_000_012,
    })
    const naddr = naddrEncode({ kind: 30023, pubkey: ADMIN_PUB, identifier, relays: [] })

    await loginToBoard(page)
    await page.goto(`/articles/${naddr}`)
    await expect(page.locator('[data-artikel-text]')).toBeVisible({ timeout: 20_000 })

    // Eine Leiste, die dauerhaft auf 100 % steht, ist kein Fortschritt, sondern Dekor —
    // sie erscheint deshalb gar nicht erst.
    await expect(page.locator('[data-leseleiste]')).toBeHidden()
    // Und der eigentliche Punkt: keine kaputte Zahl irgendwo im Dokument.
    await expect(page.locator('body')).not.toContainText('NaN')
    await expect(page.locator('[data-leseleiste-fuellung]')).toHaveAttribute('style', /width:\s*0%/)
})

test('Reader: ein LANGER Artikel bekommt eine Leseleiste, und der Lesestand zaehlt herunter', async ({
    page,
    baseURL,
}) => {
    const ws = boardWs(baseURL as string)
    const identifier = `lf-lang-${rnd()}`
    publishArticle(ws, ADMIN, ADMIN_PUB, {
        identifier,
        title: `LFLang-${rnd()}`,
        content: Array.from({ length: 120 }, (_, i) => `Absatz ${i} mit genug Text, um die Seite sicher über eine Fensterhöhe hinaus wachsen zu lassen.`).join('\n\n'),
        publishedAt: 1_700_000_013,
    })
    const naddr = naddrEncode({ kind: 30023, pubkey: ADMIN_PUB, identifier, relays: [] })

    await loginToBoard(page)
    await page.goto(`/articles/${naddr}`)
    await expect(page.locator('[data-artikel-text]')).toBeVisible({ timeout: 20_000 })
    // Der RAHMEN ist der Anker für „gibt es eine Leiste?". Die Füllung ist bei 0 % null
    // Pixel breit und gilt jeder Sichtbarkeitsprüfung als unsichtbar — sie hier zu
    // fragen, hieße die falsche Sache messen (beim Bauen dieses Tests passiert).
    await expect(page.locator('[data-leseleiste]')).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('[data-leseleiste-fuellung]')).toHaveAttribute('style', /width:\s*0%/)
    // Am Anfang die GESAMTzeit, nicht der Rest.
    await expect(page.locator('[data-lesestand]')).toContainText('Lesezeit', { timeout: 10_000 })

    // Bis ans Ende scrollen — WELCHER Behälter scrollt, hängt am Breakpoint: unterhalb
    // `xl` das Dokument, ab `xl` die Bühne (`app-shell` setzt dort `xl:overflow-y-auto`).
    // Das Projekt `chromium` fährt auf 1279 px, also das Dokument; die Weiche steht
    // trotzdem hier, damit derselbe Test im Projekt `desktop` nicht still nichts täte.
    await page.evaluate(() => {
        const buehne = document.getElementById('buehne')
        const el = buehne && buehne.scrollHeight > buehne.clientHeight ? buehne : document.scrollingElement!
        el.scrollTop = el.scrollHeight
    })

    await expect(page.locator('[data-lesestand]')).toContainText('Ende erreicht', { timeout: 10_000 })
    await expect(page.locator('[data-leseleiste-fuellung]')).toHaveAttribute('style', /width:\s*100%/, { timeout: 10_000 })
})

// ── P3: die REAKTIVITÄT der Autorenkarte ──────────────────────────────────────────
//
// **Der dritte Eingang von `deriveArticle` hält heute nichts fest, und das ist gemessen.**
// Der `reviewer` hat `throttled(300, handlesByNip05)` durch eine LEERE Map desselben Typs
// ersetzt — `typecheck` 0, `test:unit` 1265/1265 grün. Nichts merkte es, und ohne diesen
// Eingang erschiene das NIP-05-Häkchen nie.
//
// **Warum dieser Test hier steht und nicht als Modultest.** `longformFeed.ts` ist unter
// `node --test` nicht ladbar (endungslose Importe, `localStorage` beim Import von
// `session.ts`) — dieselbe Grenze, die in P1 `toRow` ins reine Modul verschoben hat. Und
// ein Test, der die `derived([…])`-Konstruktion NACHBAUT, kann per Konstruktion nicht
// sehen, dass der echte Aufrufer ein Argument nie nachliefert: er wäre grün, während die
// Fläche stumm bleibt. Das ist die Falle, die der Plan für P6 benennt; hier ist sie schon
// da.
//
// **Warum ein VERZÖGERTES nostr.json der Kern ist.** Der Handle-Store füllt sich erst,
// nachdem welshman die `.well-known/nostr.json` der Domain geholt hat — also
// zwangsläufig NACH dem ersten Emit der Ableitung. Genau dieses zweite Emit ist die
// Zusage. Die Antwort wird hier zusätzlich gebremst, damit der erste Zustand (Name da,
// Häkchen nicht) sicher beobachtbar ist und der Test nicht am Rennen hängt.
//
// **Die Mutationsprobe gehört zu diesem Test**, und die Form ist entscheidend. Beide
// Varianten am 2026-08-21 gefahren, `js/longformFeed.ts`:
//
//   A) Eingang ENTFERNT (so schrieb es der Plan vor):
//      → `tsc` rot, zwei Fehler (TS2493 „Tuple … has no element at index '2'",
//        TS2345 „Argument of type 'undefined'"). **Kein Test läuft dabei überhaupt.**
//        Wer so probiert, sieht Rot und hält die Reaktivität für gedeckt.
//   B) TYPGLEICHER Ersatz `throttled(300, handlesByNip05)` → `readable(new Map())`:
//      → `tsc` **0 Fehler**, `test:unit` grün — und **dieser Test rot**.
//
// Nur B misst die Zusage. Danach zurückgebaut, `git diff --numstat` auf der Datei leer.

test('KERNBEWEIS Reaktivitaet: ein NACH dem ersten Emit eintreffender Handle setzt das NIP-05-Haekchen', async ({
    page,
    baseURL,
}) => {
    const ws = boardWs(baseURL as string)
    const identifier = `lf-nip05-${rnd()}`
    // `.example` ist per RFC 2606 für Dokumentation reserviert und wird nie aufgelöst —
    // dieselbe Domain-Wahl wie in `room.spec.ts` (B4). Griffe die Route unten nicht, ginge
    // die Anfrage ins Leere statt an einen fremden Rechner.
    const handle = `admin@lf-nip05-${rnd()}.example`
    const ts = Math.floor(Date.now() / 1000)

    // **Der Anzeigename bleibt `Relay Admin`, und das ist keine Bequemlichkeit.** Der
    // zooid-Relay wird innerhalb eines Laufs von allen Specs geteilt, und kind 0 ist
    // ersetzbar: ein Testprofil mit eigenem Namen überschreibt das des Admins für JEDE
    // andere Spec. Beim Bauen dieses Tests genau so passiert — ein Lauf mit
    // `name: 'LFAutor…'` riss vierzehn fremde Tests mit, die `Relay Admin` erwarten
    // (directory, quote-card, room, verein-gate, command-palette). Geändert wird deshalb
    // NUR das Feld, um das es hier geht.
    publishProfile(ws, ADMIN, { name: 'Relay Admin', nip05: handle }, ts)
    publishArticle(ws, ADMIN, ADMIN_PUB, {
        identifier,
        title: `LFNip05-${rnd()}`,
        content: 'Ein Artikel, dessen Autor einen verifizierbaren Handle hat.',
        publishedAt: 1_700_000_015,
    })
    const naddr = naddrEncode({ kind: 30023, pubkey: ADMIN_PUB, identifier, relays: [] })

    let nostrJsonGefragt = 0
    await page.route('**/.well-known/nostr.json*', async (route) => {
        nostrJsonGefragt += 1
        // Die Bremse. Ohne sie könnte die Antwort noch vor dem ersten Emit da sein — der
        // Test prüfte dann einen Zustand statt eines Übergangs und wäre trotzdem grün.
        await new Promise((fertig) => setTimeout(fertig, 2_500))
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            headers: { 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({ names: { admin: ADMIN_PUB } }),
        })
    })

    try {
        await loginToBoard(page)
        await page.goto(`/articles/${naddr}`)
        await expect(page.locator('[data-artikel-text]')).toBeVisible({ timeout: 20_000 })

        const karte = page.locator('aside')
        // ERSTES Emit: der Autorname steht (kind 0 ist da), der Handle noch nicht.
        await expect(karte.getByText('Relay Admin', { exact: true })).toBeVisible({ timeout: 20_000 })
        await expect(karte.getByText(handle, { exact: true })).toBeHidden()

        // ZWEITES Emit — **ohne Navigation, ohne Reload**: allein die Änderung des
        // Handle-Stores muss die Ableitung neu rechnen lassen.
        await expect(karte.getByText(handle, { exact: true })).toBeVisible({ timeout: 20_000 })
        await expect(karte.getByTitle(`NIP-05 verifiziert: ${handle}`)).toBeVisible()

        // Die Schranke: wäre die Verifizierung gar nicht erst angestoßen worden, stünde
        // oben dasselbe Bild („kein Häkchen") — aus einem ganz anderen Grund.
        expect(nostrJsonGefragt).toBeGreaterThan(0)
    } finally {
        // Zurückschreiben mit JÜNGEREM Stempel (Muster `room.spec.ts` B4). Bliebe der
        // `nip05` am Admin kleben, führe jede spätere Spec dieses Workers beim Rendern
        // seines Namens einen echten `.well-known`-Abruf aus — Netz-I/O, das die
        // Testmaschine verlässt und dort nichts zu suchen hat.
        publishProfile(ws, ADMIN, { name: 'Relay Admin' }, ts + 1)
    }
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
