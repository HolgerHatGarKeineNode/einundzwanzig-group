/**
 * P4 — Autorenseite (`/articles/autor/{autor}`).
 *
 * **Warum diese Datei im HOST liegt:** Playwright ist ausschließlich hier eingerichtet
 * (`playwright.config.ts`, `tests/e2e/support/`); das Paket bringt kein Browser-Harness
 * mit. Wie `longform-reader.spec.ts` importiert sie `test`/`expect` aus
 * `support/board-fixtures.ts` — dem zweiten `serve` mit gesetzter `NOSTR_BOARD_URL`.
 * `fixtures.ts` bleibt unangetastet.
 *
 * **Der Name darf NICHT mit `buzz-` beginnen** — sonst fiele die Datei aus dem
 * Normal-Lauf in den Buzz-Arm (`playwright.config.ts`, `BUZZ_SPECS`).
 *
 * ── Was hier steht und was NICHT ────────────────────────────────────────────────────
 *
 * Hier steht nur, was einen echten Relay, echtes Alpine und eine echte HTTP-Antwort
 * braucht. Die Regeln selbst (Adresse deuten, Antwort deuten, filtern, gliedern) liegen
 * geprüft in `packages/einundzwanzig-group/js/articleAuthor.test.ts` — **52 Fälle** unter
 * `node --test` (nachgezählt 2026-08-21; hier stand „35", was schon beim Schreiben nicht
 * stimmte), inklusive der beiden Fälle „ein Artikel" und „55 Artikel". Sie hier zu
 * wiederholen kostete Minuten und bewiese nichts Zusätzliches. Dazu 13 Riegel-Fälle in
 * `articleAuthorMarkup.test.ts`.
 *
 * Die serverseitigen Zusagen (Route, Weiche auf die Artikel-Quelle, vier Fehlerblöcke im
 * Markup) stehen in `tests/Feature/ArticleAuthorRouteTest.php` — billigere Schicht, kein
 * Browser.
 */
import { execFileSync } from 'node:child_process'
import { npubEncode } from 'nostr-tools/nip19'
import { test, expect, type Page } from './support/board-fixtures'
import { useZooid } from './support/zooid'
import { loginNsec } from './support/login'
import { testKeys } from './support/keys'
import { cleanupArticles, publishArticle, publishProfile } from './support/articles'

const NAK = process.env.NAK ?? `${process.env.HOME}/go/bin/nak`
const NSEC = process.env.NOSTR_TEST_NSEC as string
/** zooid-Admin-SECRET (Relay-Key) — `self` = `da99fbe3…`, siehe `zooid-testserver.sh`. */
const ADMIN = 'b2ee09a54bedf17ee1db562bdddd75c48661d981eb52c49dc206c55ba8439414'
const ADMIN_PUB = 'da99fbe39247109327ac8504750d0227d50a8f84049ac8bd2f6c7ad0806ed76d'
const ADMIN_NPUB = npubEncode(ADMIN_PUB)

const rnd = (): number => Math.floor(Math.random() * 1e9)

/**
 * Ein Wegwerf-Autor, der auf diesem Relay schreiben darf und **kein kind 0 hat** — der
 * Fixture für DoD 8 („ein Autor ohne Profil bekommt trotzdem seine Liste").
 *
 * **Warum ein eigener Schlüssel sein muss:** die beiden Schlüssel, die dieser Lauf sonst
 * kennt (ADMIN und der Test-User), tragen beide ein Profil aus dem Seed
 * (`zooid-testserver.sh:280-281`), und kind 0 ist ersetzbar, nicht löschbar. Wer das
 * Admin-Profil für diesen einen Fall entfernte, risse dieselben vierzehn fremden Tests,
 * die in P3 schon einmal an einem geteilten kind 0 hingen.
 *
 * Der Relay ist member-only (`public_write=false`, wie Prod), deshalb wird der Schlüssel
 * vor dem Publizieren per NIP-86 `allowpubkey` zugelassen. **Nur `allowpubkey`, kein
 * `assignrole`:** die Rolle schriebe ihn in die 13534-Vereinsliste, an der das
 * Vereins-Gate anderer Specs hängt. Zulassen allein ändert dort nichts.
 *
 * Fest verdrahtet und nicht je Lauf erzeugt, damit die Zulassung beim
 * Relay-Wiederverwenden idempotent bleibt. Der Schlüssel hat außerhalb dieses
 * Testrelays keinen Wert.
 */
const OHNE_PROFIL_SEC = 'f8340f584b6ef13467452c530d121c07a56bdca69f1b8afef74b65a5740e7b8c'
const OHNE_PROFIL_PUB = '72785bc226ee86b05086cb777133d1e75f655fdfe87a9a7d817767f4bd351c4a'

/** Die NIP-86-Management-Adresse desselben Relays — gleicher Port, HTTP statt WS. */
function relayHttp(ws: string): string {
    return ws.replace(/^ws/, 'http')
}

/** Der Board-Relay dieses Workers — dieselbe Rechnung wie in `longform-reader.spec.ts`. */
function boardWs(baseURL: string): string {
    const port = Number(new URL(baseURL).port)

    return `ws://localhost:${3335 + (port - 8437)}`
}

async function loginToBoard(page: Page): Promise<void> {
    await useZooid(page)
    await loginNsec(page, NSEC)
}

/**
 * Die Artikel, die der TEST-USER publiziert hat — mit seinem Schlüssel, nicht mit dem des
 * Admins.
 *
 * `cleanupArticles` löscht alles über den EINEN Schlüssel, den es bekommt; ein kind 5 auf
 * ein fremdes Event ist nach NIP-09 keine Löschanfrage, die der Relay befolgen muss. Was
 * der Test-User publiziert, räumt er deshalb hier selbst weg. Beides läuft — eines
 * greift.
 */
const userArtikel: string[] = []

/** Dasselbe für den Wegwerf-Autor aus DoD 8 — er löscht mit seinem eigenen Schlüssel. */
const fremdArtikel: string[] = []

test.afterAll(async ({ baseURL }) => {
    if (!baseURL) {
        return
    }
    const ws = boardWs(baseURL)
    cleanupArticles(ws, ADMIN)
    for (const [sec, ids] of [
        [NSEC, userArtikel] as const,
        [OHNE_PROFIL_SEC, fremdArtikel] as const,
    ]) {
        for (const id of ids.splice(0)) {
            try {
                execFileSync(NAK, ['event', '--auth', '--sec', sec, '-k', '5', '-t', `e=${id}`, ws], {
                    encoding: 'utf8',
                    timeout: 15_000,
                })
            } catch {
                // Still wie `cleanupArticles`: ein werfender Aufräumer überschriebe den
                // Testbefund mit einem Infrastrukturfehler.
            }
        }
    }
})

// ── DER KERNBEWEIS, am echten Stack ────────────────────────────────────────────────

test('KERNBEWEIS: zwei Autoren mit identischem Anzeigenamen bleiben getrennt — gefiltert wird der pubkey', async ({
    page,
    baseURL,
}) => {
    const ws = boardWs(baseURL as string)
    const meiner = `AASeine-${rnd()}`
    const fremder = `AAFremde-${rnd()}`
    const ts = Math.floor(Date.now() / 1000)
    const { pk: USER_PUB } = testKeys()

    // **Nur EIN Profil wird angefasst, und es ist das des Test-Users.** Der Relay wird
    // innerhalb eines Laufs von allen Specs dieses Workers geteilt, und kind 0 ist
    // ersetzbar. Den Namen des ADMINS zu ändern hat beim Bau von P3 vierzehn fremde Tests
    // gerissen (siehe `longform-reader.spec.ts`, NIP-05-Test) — deshalb bleibt er hier
    // `Relay Admin`, und der Test-User bekommt DENSELBEN Namen. Die Kollision entsteht
    // damit auf der Seite, die billiger zu reparieren ist; zurückgeschrieben wird im
    // `finally` mit jüngerem Stempel (Muster `room.spec.ts` B4).
    publishProfile(ws, NSEC, { name: 'Relay Admin' }, ts)

    publishArticle(ws, ADMIN, ADMIN_PUB, {
        identifier: `aa-admin-${rnd()}`,
        title: meiner,
        content: 'Ein Artikel des adressierten Autors.',
        publishedAt: 1_700_000_100,
    })
    userArtikel.push(
        publishArticle(ws, NSEC, USER_PUB, {
            identifier: `aa-user-${rnd()}`,
            title: fremder,
            content: 'Ein Artikel eines ANDEREN Autors mit demselben Anzeigenamen.',
            publishedAt: 1_700_000_101,
        }),
    )

    try {
        await loginToBoard(page)
        await page.goto(`/articles/autor/${ADMIN_NPUB}`)

        // Der eigene Artikel steht da …
        await expect(page.getByRole('heading', { name: meiner, exact: true })).toBeVisible({ timeout: 20_000 })

        // **… der des Namensvetters NICHT.** Das ist die ganze Zusage. Ein Filter über
        // `authorName` zeigte hier beide — beide Profile heißen in diesem Moment
        // „Relay Admin".
        await expect(page.getByRole('heading', { name: fremder, exact: true })).toHaveCount(0)

        // Die Schranke: gäbe es den fremden Artikel gar nicht, wäre die Zeile oben
        // trivial erfüllt. Auf der LISTE muss er stehen.
        await page.goto('/articles')
        await expect(page.getByRole('heading', { name: fremder, exact: true })).toBeVisible({ timeout: 20_000 })
        await expect(page.getByRole('heading', { name: meiner, exact: true })).toBeVisible()
    } finally {
        publishProfile(ws, NSEC, { name: 'Alice Test' }, ts + 1)
    }
})

// ── Die Signatur: Monatsmarken, und die Zahlen daneben ────────────────────────────

test('Die Monatsmarken gliedern die Liste, und der Kopf nennt Anzahl und Anfangsjahr', async ({ page, baseURL }) => {
    const ws = boardWs(baseURL as string)
    const alt = `AAAlt-${rnd()}`
    const neu = `AANeu-${rnd()}`

    // Zwei Monate ÜBER die Jahresgrenze — das ist der Fall, an dem eine naive
    // Sortierung (zusammengesetzter String statt `jahr * 12 + monat`) kippt.
    // Die Zeitstempel sind fest gewählt und liegen je in der Monatsmitte, 12:00 UTC:
    // für jede Zeitzone derselbe Kalendermonat, egal wo der Lauf steht.
    publishArticle(ws, ADMIN, ADMIN_PUB, {
        identifier: `aa-monat-a-${rnd()}`,
        title: alt,
        content: 'Der ältere.',
        publishedAt: Math.floor(Date.UTC(2021, 11, 15, 12) / 1000),
    })
    publishArticle(ws, ADMIN, ADMIN_PUB, {
        identifier: `aa-monat-b-${rnd()}`,
        title: neu,
        content: 'Der jüngere.',
        publishedAt: Math.floor(Date.UTC(2022, 0, 15, 12) / 1000),
    })

    await loginToBoard(page)
    await page.goto(`/articles/autor/${ADMIN_NPUB}`)

    await expect(page.getByRole('heading', { name: neu, exact: true })).toBeVisible({ timeout: 20_000 })

    // Beide Monate stehen als Marke. Geprüft wird der MASCHINENLESBARE Wert und nicht
    // der sichtbare Name: „Januar 2022" hinge an der Locale des Laufs, `2022-01` nicht.
    const marken = page.locator('[data-monatsmarke]')
    await expect(page.locator('[data-monatsmarke="2022-01"]')).toHaveCount(1)
    await expect(page.locator('[data-monatsmarke="2021-12"]')).toHaveCount(1)

    // Absteigend, und zwar ÜBER die Jahresgrenze hinweg.
    const werte = await marken.evaluateAll((els) => els.map((e) => e.getAttribute('data-monatsmarke') ?? ''))
    expect(werte).toEqual([...werte].sort().reverse())
    expect(werte.indexOf('2022-01')).toBeLessThan(werte.indexOf('2021-12'))

    // Und der sichtbare Name ist ein NAME, keine Zahl — sonst wäre die Marke nur eine
    // zweite Datumsangabe neben der auf der Karte.
    const sichtbar = (await page.locator('[data-monatsmarke="2022-01"]').innerText()).trim()
    expect(sichtbar).toMatch(/2022/)
    expect(sichtbar).not.toBe('2022-01')

    // Der Kopf nennt beide Zahlen. Die ANZAHL wird bewusst NICHT auf einen festen Wert
    // geprüft: sie hängt am Bestand des geteilten Relays, und ein `toBe(2)` prüfte den
    // Relay statt unseren Code. Geprüft wird, dass die Zeile steht und das Anfangsjahr
    // das ÄLTESTE ist — genau das, was ohne diese Seite niemand sagen könnte.
    const zahlen = page.locator('[data-autor-zahlen]')
    await expect(zahlen).toContainText('seit 2021')
    await expect(zahlen).toContainText('Artikel')
})

// ── NIP-05: der zweite Adressweg, komplett ─────────────────────────────────────────

test('NIP-05-Adresse löst über die .well-known/nostr.json auf und zeigt die Artikel des Autors', async ({
    page,
    baseURL,
}) => {
    const ws = boardWs(baseURL as string)
    const titel = `AANip05-${rnd()}`
    // `.example` ist per RFC 2606 für Dokumentation reserviert und wird nie aufgelöst —
    // griffe die Route unten nicht, ginge die Anfrage ins Leere statt an einen fremden
    // Rechner. Dieselbe Domain-Wahl wie in `longform-reader.spec.ts`.
    const domain = `aa-nip05-${rnd()}.example`

    publishArticle(ws, ADMIN, ADMIN_PUB, {
        identifier: `aa-nip05-${rnd()}`,
        title: titel,
        content: 'Der Autor ist hier über seinen Handle adressiert.',
        publishedAt: 1_700_000_110,
    })

    const gefragt: string[] = []
    await page.route('**/.well-known/nostr.json*', async (route) => {
        gefragt.push(route.request().url())
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            headers: { 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({ names: { admin: ADMIN_PUB } }),
        })
    })

    await loginToBoard(page)
    await page.goto(`/articles/autor/admin@${domain}`)

    await expect(page.getByRole('heading', { name: titel, exact: true })).toBeVisible({ timeout: 20_000 })

    // **Die Schranke, und sie ist hier nicht schmückend.** Läge der Autor schon aus einem
    // früheren Test im Speicher, sähe die Seite genauso aus, ohne dass je eine Auflösung
    // stattgefunden hätte — der Test wäre grün und der NIP-05-Weg ungeprüft. Geprüft wird
    // deshalb die tatsächlich gerufene URL, inklusive Domain und `name`-Parameter.
    const meine = gefragt.filter((url) => url.includes(domain))
    expect(meine.length).toBeGreaterThan(0)
    expect(meine[0]).toBe(`https://${domain}/.well-known/nostr.json?name=admin`)
})

test('FEHLZUSTAND 3: die Domain antwortet und kennt den Namen nicht — eigener Satz, KEIN zweiter Versuch', async ({
    page,
}) => {
    const domain = `aa-leer-${rnd()}.example`
    await page.route('**/.well-known/nostr.json*', (route) =>
        route.fulfill({
            status: 200,
            contentType: 'application/json',
            headers: { 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({ names: { jemandanders: ADMIN_PUB } }),
        }),
    )

    await loginToBoard(page)
    await page.goto(`/articles/autor/niemand@${domain}`)

    await expect(page.locator('[data-autor-fehler="nip05-unbekannt"]')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText('Diese Domain kennt den Namen nicht.', { exact: true })).toBeVisible()
    // Die Domain wird genannt — sie ist der einzige Teil der Eingabe, den diese Fläche zeigt.
    await expect(page.getByText(domain, { exact: false })).toBeVisible()
    // Eine Domain, die den Namen nicht kennt, kennt ihn beim zehnten Versuch auch nicht.
    await expect(page.getByRole('button', { name: 'Erneut versuchen' })).toHaveCount(0)
})

test('FEHLZUSTAND 4: die Domain antwortet gar nicht — anderer Satz, und DIESER bietet einen zweiten Versuch', async ({
    page,
}) => {
    const domain = `aa-tot-${rnd()}.example`
    await page.route('**/.well-known/nostr.json*', (route) => route.abort('connectionfailed'))

    await loginToBoard(page)
    await page.goto(`/articles/autor/niemand@${domain}`)

    await expect(page.locator('[data-autor-fehler="nip05-fehlgeschlagen"]')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText('Diese Domain hat nicht geantwortet.', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Erneut versuchen' })).toBeVisible()
    // Und die beiden Sätze sind wirklich verschieden — sonst trüge die Unterscheidung nichts.
    await expect(page.getByText('Diese Domain kennt den Namen nicht.', { exact: true })).toHaveCount(0)
})

// ── Die beiden Fehlzustände ohne Netz ──────────────────────────────────────────────

test('FEHLZUSTAND 2: eine unlesbare npub — eigener Satz, und KEINE Anfrage ins Netz', async ({ page }) => {
    let angefragt = 0
    await page.route('**/.well-known/nostr.json*', (route) => {
        angefragt += 1

        return route.abort()
    })

    await loginToBoard(page)
    await page.goto('/articles/autor/npub1dasistkaputtundgehtnicht')

    await expect(page.locator('[data-autor-fehler="npub"]')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText('Diese npub lässt sich nicht lesen.', { exact: true })).toBeVisible()
    // Eine kaputte Adresse ist kein Grund, irgendwo anzuklopfen.
    expect(angefragt).toBe(0)
})

test('FEHLZUSTAND 1: gar keine Adresse — eigener Satz, und ebenfalls keine Anfrage', async ({ page }) => {
    let angefragt = 0
    await page.route('**/.well-known/nostr.json*', (route) => {
        angefragt += 1

        return route.abort()
    })

    await loginToBoard(page)
    await page.goto('/articles/autor/satoshi')

    await expect(page.locator('[data-autor-fehler="format"]')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText('Das ist keine Autoren-Adresse.', { exact: true })).toBeVisible()
    expect(angefragt).toBe(0)
})

// ── Ein Autor ohne Artikel, und ein Autor ohne Lightning ───────────────────────────

test('Ein Autor, von dem hier nichts liegt, bekommt eine ehrliche Auskunft statt einer leeren Bühne', async ({
    page,
}) => {
    // Gültige npub, aber ein Pubkey, der auf diesem Relay nie publiziert hat.
    const fremd = npubEncode('a'.repeat(63) + '1')

    await loginToBoard(page)
    await page.goto(`/articles/autor/${fremd}`)

    await expect(page.getByText('Von diesem Autor liegt hier noch kein Artikel.', { exact: true })).toBeVisible({
        timeout: 20_000,
    })
    await expect(page.getByRole('link', { name: 'Alle Artikel' })).toBeVisible()
    // Kein Fehlzustand: die Adresse war in Ordnung.
    await expect(page.locator('[data-autor-fehler]')).toHaveCount(0)
})

test('Ohne lud16 ist der Lightning-Einstieg sichtbar INERT — fokussierbar, mit Grund, nie „unbekannt"', async ({
    page,
    baseURL,
}) => {
    const ws = boardWs(baseURL as string)
    const titel = `AAInert-${rnd()}`

    // Das Seed-Profil des Admins trägt kein `lud16` — genau die Lage der vier
    // Podcast-Bridges des echten Bestands.
    publishArticle(ws, ADMIN, ADMIN_PUB, {
        identifier: `aa-inert-${rnd()}`,
        title: titel,
        content: 'Ein Artikel eines Autors ohne Lightning-Adresse.',
        publishedAt: 1_700_000_120,
    })

    await loginToBoard(page)
    await page.goto(`/articles/autor/${ADMIN_NPUB}`)

    const knopf = page.locator('[data-lightning-einstieg]')
    await expect(knopf).toBeVisible({ timeout: 20_000 })
    await expect(knopf).toHaveAttribute('data-lightning-zustand', 'nein')
    // `aria-disabled` statt `disabled`: der Knopf behält seinen Fokus, sonst käme eine
    // Tastatur nie an die Begründung.
    await expect(knopf).toHaveAttribute('aria-disabled', 'true')
    await expect(knopf).not.toHaveAttribute('disabled', /.*/)
    await knopf.focus()
    await expect(knopf).toBeFocused()

    // **Ausgelöst wird über die TASTATUR, und das ist kein Umweg — es ist der Punkt.**
    // `aria-disabled` statt `disabled` wurde genau deshalb gewählt: der Knopf behält
    // seinen Fokus, damit ein Tastaturnutzer die Begründung überhaupt erreichen kann.
    // Genau dieser Weg wird hier gegangen.
    //
    // Er ist zugleich der EINZIGE, der in Playwright funktioniert: `locator.click()`
    // wartet auf „visible, enabled and stable" und wertet `aria-disabled="true"` als
    // NICHT enabled — der Aufruf lief 30 s in den Timeout, mit
    // „element is not enabled" im Log (gemessen 2026-08-21, voller Lauf). Ein Browser
    // hält den Knopf dagegen für ganz normal klickbar; `aria-disabled` ist eine Aussage
    // an Hilfstechnik, keine an den Ereignispfad. `page.keyboard` prüft keine
    // Aktionierbarkeit und trifft deshalb, was der Nutzer trifft.
    await page.keyboard.press('Enter')
    await expect(page.getByText('Dieser Autor hat keine Lightning-Adresse hinterlegt.')).toBeVisible()

    // **Der dritte Zustand darf NIE im DOM stehen.** `unbekannt` heißt „das Profil ist
    // noch nicht da", und dann wird gar nichts behauptet — der Knopf entsteht erst
    // danach. Würde aus dem `x-if` je ein `x-show`, stünde hier ein Element mit genau
    // diesem Zustand, und die Fläche behauptete „keine Lightning-Adresse" über einen
    // Autor, über den nichts bekannt ist. Genau der Fehler, den P3 am laufenden Client
    // gefunden hat.
    await expect(page.locator('[data-lightning-zustand="unbekannt"]')).toHaveCount(0)
})

// ── DoD 8: ein Autor OHNE kind 0 ───────────────────────────────────────────────────

test('Ein Autor OHNE kind 0 bekommt trotzdem seine Liste — nur die Autorenkarte fehlt', async ({
    page,
    baseURL,
}) => {
    // **Warum dieser Fall einen eigenen Test bekommt.** Er war bis zur Nachbesserung nur
    // durch Code-Lesen belegt („die Liste hängt strukturell nicht an der Karte"), und
    // genau in dieser Form ist in diesem Vorhaben mehrfach etwas durchgerutscht. Der
    // strukturelle Riegel steht jetzt zusätzlich in `articleAuthorMarkup.test.ts`; hier
    // läuft die Lage am echten Stack.
    const ws = boardWs(baseURL as string)
    const titel = `AAOhneProfil-${rnd()}`

    // Zulassen (member-only Relay). Idempotent gemeint: läuft der Test auf einem
    // wiederverwendeten Relay, ist der Schlüssel schon zugelassen und die Antwort ein
    // Fehler, der hier nichts bedeutet.
    try {
        execFileSync(
            NAK,
            ['admin', 'allowpubkey', relayHttp(ws), '--pubkey', OHNE_PROFIL_PUB, '--sec', ADMIN],
            { encoding: 'utf8', timeout: 15_000 },
        )
    } catch {
        // Schon zugelassen — das Publizieren unten ist die eigentliche Probe.
    }

    fremdArtikel.push(
        publishArticle(ws, OHNE_PROFIL_SEC, OHNE_PROFIL_PUB, {
            identifier: `aa-ohneprofil-${rnd()}`,
            title: titel,
            content: 'Ein Artikel eines Autors, von dem kein Profil existiert.',
            publishedAt: Math.floor(Date.UTC(2023, 4, 15, 12) / 1000),
        }),
    )

    // **Die Schranke, und sie ist der ganze Punkt.** Gäbe es für diesen Pubkey doch ein
    // kind 0, prüfte der Test unten etwas anderes als DoD 8 — und wäre grün.
    const profil = execFileSync(
        NAK,
        ['req', '-k', '0', '-a', OHNE_PROFIL_PUB, '--auth', '--sec', ADMIN, ws],
        { encoding: 'utf8', timeout: 15_000 },
    ).trim()
    expect(profil, 'Dieser Autor trägt ein kind 0 — dann misst dieser Test DoD 8 nicht mehr.').toBe('')

    await loginToBoard(page)
    await page.goto(`/articles/autor/${npubEncode(OHNE_PROFIL_PUB)}`)

    // Die Liste steht.
    await expect(page.getByRole('heading', { name: titel, exact: true })).toBeVisible({ timeout: 20_000 })
    // Mit ihrer Monatsmarke und den zwei Zahlen im Kopf — beide kommen aus den Artikeln,
    // nicht aus dem Profil.
    await expect(page.locator('[data-monatsmarke="2023-05"]')).toHaveCount(1)
    await expect(page.locator('[data-autor-zahlen]')).toContainText('seit 2023')

    // **Die Karte fehlt — und das ist richtig, nicht ein Mangel.** Ohne kind 0 wäre sie
    // eine leere Box mit einem Knopf, und der dreiwertige Lightning-Zustand stünde auf
    // `unbekannt`: über eine Zahlungsadresse wird dann gar nichts behauptet.
    await expect(page.locator('[data-autor-karte]')).toHaveCount(0)
    await expect(page.locator('[data-lightning-einstieg]')).toHaveCount(0)
    // Und kein Fehlzustand: die Adresse war in Ordnung.
    await expect(page.locator('[data-autor-fehler]')).toHaveCount(0)
})

// ── Der Wiederholungsknopf tut auch etwas ─────────────────────────────────────────

test('„Erneut versuchen" holt die Seite wirklich zurück — die zweite Antwort der Domain zählt', async ({
    page,
    baseURL,
}) => {
    // Bis zur Nachbesserung war nur geprüft, dass der Knopf DA ist. Ob er etwas bewirkt,
    // stand nirgends — und `retry()` ist die einzige Stelle dieser Fläche, die den
    // Zustand eines vorigen Versuchs abräumen muss.
    const ws = boardWs(baseURL as string)
    const titel = `AARetry-${rnd()}`
    const domain = `aa-retry-${rnd()}.example`

    publishArticle(ws, ADMIN, ADMIN_PUB, {
        identifier: `aa-retry-${rnd()}`,
        title: titel,
        content: 'Erst nach dem zweiten Versuch zu sehen.',
        publishedAt: 1_700_000_130,
    })

    let versuche = 0
    await page.route('**/.well-known/nostr.json*', async (route) => {
        versuche += 1
        if (versuche === 1) {
            await route.abort('connectionfailed')

            return
        }
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            headers: { 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({ names: { admin: ADMIN_PUB } }),
        })
    })

    await loginToBoard(page)
    await page.goto(`/articles/autor/admin@${domain}`)

    await expect(page.locator('[data-autor-fehler="nip05-fehlgeschlagen"]')).toBeVisible({ timeout: 20_000 })
    await page.getByRole('button', { name: 'Erneut versuchen' }).click()

    // Der Fehlzustand ist weg — und zwar vollständig, nicht nur der Kasten. Stünde
    // `fehlerDomain` noch, trüge der nächste Fehlersatz die Domain des vorigen Versuchs.
    await expect(page.getByRole('heading', { name: titel, exact: true })).toBeVisible({ timeout: 20_000 })
    await expect(page.locator('[data-autor-fehler]')).toHaveCount(0)
    // Die Schranke: der erste Versuch muss wirklich gescheitert sein, sonst prüft der
    // Klick oben nichts.
    expect(versuche).toBeGreaterThan(1)
})
