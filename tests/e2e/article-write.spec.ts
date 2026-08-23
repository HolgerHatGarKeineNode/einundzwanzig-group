/**
 * P7 — die Artikelfläche **schreibt**: Reaktion (kind 7), Kommentar (kind 1111) und der
 * Relay-Grund, wenn beides abgelehnt wird.
 *
 * ── Warum diese Datei im HOST-Repo liegt und nicht im Paket ────────────────────────
 *
 * `packages/einundzwanzig-group` hat kein `tests/`-Verzeichnis und keine `autoload-dev`;
 * jeder Feature- und E2E-Test dieses Vorhabens liegt deshalb hier (Präzedenz:
 * `article-metrics.spec.ts`, `longform-reader.spec.ts`, `LongformReaderTest.php`).
 *
 * ── Was hier steht und was anderswo ───────────────────────────────────────────────
 *
 * | Frage | Ort |
 * |---|---|
 * | Wem gehört ein Kommentar, wer hat reagiert, darf der Entwurf raus? | `js/articleWrite.test.ts` (rein, `node --test`) |
 * | Wird der Relay-Grund WÖRTLICH mitgeführt statt ersetzt? | `js/publishResult.test.ts` (rein) |
 * | Landet das Ereignis wirklich auf dem Relay? | **hier** |
 * | Erreicht die Ablehnung des Relays wirklich die Fläche? | **hier** |
 *
 * Die letzten beiden kann nur ein Browser mit einem echten Relay beantworten — und die
 * dritte nur über eine **Requery**: `nak event` druckt das signierte Ereignis auch bei
 * ABLEHNUNG auf stdout und beendet sich mit 0 (Herleitung in `support/articles.ts`).
 * Dieselbe Falle gilt hier eine Ebene höher: ein grüner Knopf in der Oberfläche ist kein
 * Beleg dafür, dass ein Relay etwas angenommen hat. Der Beleg ist die Rückfrage.
 *
 * ── DER PRODUKTIONS-RELAY WIRD HIER NIE BESCHRIEBEN ───────────────────────────────
 *
 * Alles läuft gegen den **worker-eigenen zooid** (`board-fixtures.ts` setzt Board UND
 * Metrik-Relays auf ihn). Ein publiziertes Nostr-Ereignis ist unwiderruflich; kind 5 ist
 * eine Bitte, kein Löschen. Die Prävention aus `support/hermetik.ts` macht eine fremde
 * Herkunft aus dem Browser zusätzlich unmöglich — sie erreicht aber weder `nak` noch den
 * PHP-Prozess, dieser Absatz ersetzt sie also nicht.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { naddrEncode } from 'nostr-tools/nip19'
import { test, expect, type Page } from './support/board-fixtures'
import { useZooid } from './support/zooid'
import { loginNsec } from './support/login'
import { testKeys } from './support/keys'
import { artikelAdresse, cleanupArticles, publishArticle } from './support/articles'
import { publishVerified } from './support/publishVerified'

const NAK = process.env.NAK ?? `${process.env.HOME}/go/bin/nak`
const NSEC = process.env.NOSTR_TEST_NSEC as string
const ADMIN = 'b2ee09a54bedf17ee1db562bdddd75c48661d981eb52c49dc206c55ba8439414'
const ADMIN_PUB = 'da99fbe39247109327ac8504750d0227d50a8f84049ac8bd2f6c7ad0806ed76d'

const rnd = (): number => Math.floor(Math.random() * 1e9)

/** Der Board-Relay dieses Workers — dieselbe Formel wie in `article-metrics.spec.ts`. */
function boardWs(baseURL: string): string {
    return `ws://localhost:${3335 + (Number(new URL(baseURL).port) - 8437)}`
}

/** Der NIP-86-Endpunkt desselben Relays (HTTP statt WS, gleicher Port). */
function boardHttp(baseURL: string): string {
    return `http://localhost:${3335 + (Number(new URL(baseURL).port) - 8437)}`
}

async function loginToBoard(page: Page): Promise<void> {
    await useZooid(page)
    await loginNsec(page, NSEC)
}

/**
 * Ereignisse eines Filters vom Relay zurücklesen — **der einzige Beleg dafür, dass der
 * Relay etwas angenommen hat.**
 *
 * `stdio[0] = 'ignore'` ist kein Zierrat: `nak req` liest einen Filter von **stdin**, und
 * ohne geschlossene Eingabe wartet es darauf, bis der Test in sein Timeout läuft. Beim
 * Bauen dieser Datei am 2026-08-21 genau so passiert (2 min Hänger); im Haus ist derselbe
 * Fall schon einmal als „leerer Relay" fehlgedeutet worden.
 */
function requery(relayWs: string, args: readonly string[], sec: string = NSEC): Record<string, unknown>[] {
    const roh = execFileSync(NAK, ['req', '--auth', '--sec', sec, ...args, relayWs], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 20_000,
    })

    return roh
        .trim()
        .split('\n')
        .filter(Boolean)
        .flatMap((zeile) => {
            try {
                return [JSON.parse(zeile) as Record<string, unknown>]
            } catch {
                return []
            }
        })
}

/**
 * Ein NIP-86-Management-Kommando am Test-Relay — dieselbe Bauform wie `mgmt()` in
 * `support/zooid-testserver.sh` (NIP-98-Auth: kind 27235 mit `u`, `method`, `payload`,
 * base64 im `Authorization`-Header).
 */
async function mgmt(http: string, body: Record<string, unknown>): Promise<void> {
    const roh = JSON.stringify(body)
    const payload = createHash('sha256').update(roh).digest('hex')
    const evt = execFileSync(
        NAK,
        ['event', '-k', '27235', '--sec', ADMIN, '-t', `u=${http}`, '-t', 'method=POST', '-t', `payload=${payload}`],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 20_000 },
    ).trim()
    const antwort = await fetch(http, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/nostr+json+rpc',
            Authorization: `Nostr ${Buffer.from(evt).toString('base64')}`,
        },
        body: roh,
    })
    const ergebnis = (await antwort.json()) as { error?: string }
    if (ergebnis.error) {
        throw new Error(`NIP-86 ${String(body.method)} fehlgeschlagen: ${ergebnis.error}`)
    }
}

/** Trägt dieses Ereignis genau dieses Tag mit genau diesem Wert? */
function hatTag(event: Record<string, unknown>, name: string, wert: string): boolean {
    return (event.tags as string[][]).some((t) => t[0] === name && t[1] === wert)
}

/**
 * Ereignisse aufräumen, die die OBERFLÄCHE publiziert hat.
 *
 * `cleanupArticles` kennt nur, was über `support/articles.ts` hinausging — was der Browser
 * schreibt, steht in keiner dieser Listen. Ohne dieses Aufräumen sammelte der über Läufe
 * hinweg wiederverwendete zooid Reaktionen und Kommentare an, die auf einen längst
 * gelöschten Artikel zeigen.
 *
 * Still wie `cleanupArticles`: ein werfender Aufräumer überschriebe den Testbefund mit
 * einem Infrastrukturfehler.
 */
function raeumeSignale(relayWs: string, adresse: string): void {
    try {
        for (const e of requery(relayWs, ['-k', '7', '-k', '1111', '--tag', `a=${adresse}`])) {
            execFileSync(NAK, ['event', '--auth', '--sec', NSEC, '-k', '5', '-t', `e=${String(e.id)}`, relayWs], {
                encoding: 'utf8',
                stdio: ['ignore', 'ignore', 'ignore'],
                timeout: 15_000,
            })
        }
    } catch {
        // siehe oben
    }
}

test.afterAll(async ({ baseURL }) => {
    if (baseURL) {
        cleanupArticles(boardWs(baseURL), ADMIN)
    }
})

// ── KERNBEWEIS 1: die Reaktion landet wirklich auf dem Relay ───────────────────────

test('KERNBEWEIS: eine Reaktion aus der Oberflaeche liegt danach WIRKLICH auf dem Relay — und laesst sich zuruecknehmen', async ({
    page,
    baseURL,
}) => {
    const ws = boardWs(baseURL as string)
    const identifier = `aw-reaktion-${rnd()}`
    const titel = `AWReaktion-${rnd()}`
    const adresse = artikelAdresse(ADMIN_PUB, identifier)
    const ich = testKeys().pk

    publishArticle(ws, ADMIN, ADMIN_PUB, {
        identifier,
        title: titel,
        content: 'Ein Artikel, auf den reagiert wird.',
        publishedAt: 1_700_000_200,
    })

    await loginToBoard(page)
    await page.goto(`/articles/${naddrEncode({ kind: 30023, pubkey: ADMIN_PUB, identifier, relays: [] })}`)
    await expect(page.getByRole('heading', { name: titel, level: 1 })).toBeVisible({ timeout: 20_000 })

    const knopf = page.locator('[data-artikel-reagieren]')
    await expect(knopf).toHaveAttribute('aria-pressed', 'false')

    await knopf.click()

    // Die Fläche sagt „gedrückt" — das ist die HALBE Aussage. Der Knopf hängt an der
    // Ableitung, und die sieht auch ein optimistisch eingelegtes Ereignis, das der Relay
    // nie angenommen hat.
    await expect(knopf).toHaveAttribute('aria-pressed', 'true', { timeout: 20_000 })
    await expect(knopf).toContainText('Reaktion zurücknehmen')

    // Die andere Hälfte: der Relay selbst. `#a` und nicht `#e` — ein 30023 ist ersetzbar,
    // und `makeReaction` hängt beide Tags an; das `a` ist das, worüber der Lesepfad aus
    // P6 die Reaktion wiederfindet.
    //
    // **`expect.poll` und keine einmalige Requery.** Der Knopf springt um, sobald das
    // Ereignis OPTIMISTISCH im Repository liegt — also bevor der Relay geantwortet hat.
    // Eine Requery direkt danach liest das Fenster VOR dem `OK` und meldete null; genau
    // dieser Fehlgriff ist beim Bauen dieser Datei einmal aufgetreten (1 rot / 2 grün).
    await expect
        .poll(() => requery(ws, ['-k', '7', '--tag', `a=${adresse}`]).length, { timeout: 20_000 })
        .toBe(1)
    const reaktionen = requery(ws, ['-k', '7', '--tag', `a=${adresse}`])
    expect(reaktionen[0].pubkey).toBe(ich)
    // Literal und nicht gegen die importierte Konstante: `ARTIKEL_REAKTION` gegen sich
    // selbst zu prüfen liesse jede Änderung durch (Hausregel).
    expect(reaktionen[0].content).toBe('+')
    // Und das `a`-Tag trägt wirklich die Artikeladresse, nicht bloss irgendeinen Wert —
    // sonst wäre schon der Filter oben die halbe Antwort auf seine eigene Frage.
    expect(hatTag(reaktionen[0], 'a', adresse)).toBe(true)

    // Zurücknehmen: kind 5 auf die eigene kind 7. Am Test-zooid gemessen (2026-08-21)
    // verschwindet das Ziel danach hart vom Relay — die Requery ist also aussagekräftig.
    await knopf.click()
    await expect(knopf).toHaveAttribute('aria-pressed', 'false', { timeout: 20_000 })
    await expect.poll(() => requery(ws, ['-k', '7', '--tag', `a=${adresse}`]).length, { timeout: 20_000 }).toBe(0)

    raeumeSignale(ws, adresse)
})

// ── KERNBEWEIS 2: der Kommentar landet, erscheint und leert das Feld ───────────────

test('KERNBEWEIS: ein Kommentar aus der Oberflaeche liegt als kind 1111 am Relay und steht in der Liste', async ({
    page,
    baseURL,
}) => {
    const ws = boardWs(baseURL as string)
    const identifier = `aw-kommentar-${rnd()}`
    const titel = `AWKommentar-${rnd()}`
    const adresse = artikelAdresse(ADMIN_PUB, identifier)
    const text = `Ein Kommentar aus dem Browser ${rnd()}`

    publishArticle(ws, ADMIN, ADMIN_PUB, {
        identifier,
        title: titel,
        content: 'Ein Artikel, der kommentiert wird.',
        publishedAt: 1_700_000_201,
    })

    await loginToBoard(page)
    await page.goto(`/articles/${naddrEncode({ kind: 30023, pubkey: ADMIN_PUB, identifier, relays: [] })}`)
    await expect(page.getByRole('heading', { name: titel, level: 1 })).toBeVisible({ timeout: 20_000 })

    const bereich = page.locator('[data-artikel-kommentare]')
    await expect(bereich.getByText('Noch keine Kommentare.')).toBeVisible({ timeout: 20_000 })

    // Über Label und Rolle, nicht über ein an eine Flux-Komponente durchgereichtes
    // `data-`-Attribut: an welchem Knoten das landet, ist nicht zugesichert.
    const feld = bereich.getByLabel('Kommentar schreiben')

    // **Der Restzähler, bevor der eigentliche Kommentar getippt wird.** Er hängt an
    // `KOMMENTAR_MAX_ZEICHEN` (5000) und einer Schwelle im Markup (500) — beides Zahlen,
    // die sonst nur als Literal dastünden. 4600 Zeichen ⇒ 400 Rest ⇒ unter der Schwelle
    // ⇒ sichtbar, mit genau diesem Wert. Die LITERALE stehen hier absichtlich, nicht die
    // importierte Konstante: eine Konstante gegen sich selbst geprüft lässt jede
    // Änderung durch.
    const rest = bereich.locator('[data-artikel-kommentar-rest]')
    await expect(rest).toBeHidden()
    await feld.fill('x'.repeat(4600))
    await expect(rest).toHaveText('400')
    await feld.fill('x'.repeat(4400))
    await expect(rest).toBeHidden()

    await feld.fill(text)
    await bereich.getByRole('button', { name: 'Veröffentlichen' }).click()

    // In der Liste …
    await expect(bereich.getByText(text)).toBeVisible({ timeout: 20_000 })
    // … und das Feld ist LEER: nur der Erfolg leert es (siehe `kommentarAbschicken`).
    await expect(feld).toHaveValue('')

    // … und am Relay, mit den NIP-22-Wurzeltags. `A` UND `a`: welshmans
    // `tagEventForComment` setzt beide, weil 30023 adressierbar ist — genau das macht den
    // Kommentar für die Union-Abfrage aus P6 auffindbar.
    const kommentare = requery(ws, ['-k', '1111', '--tag', `A=${adresse}`])
    expect(kommentare).toHaveLength(1)
    expect(kommentare[0].content).toBe(text)
    expect(hatTag(kommentare[0], 'A', adresse)).toBe(true)
    expect(hatTag(kommentare[0], 'a', adresse)).toBe(true)
    // Kein `h`: ein Artikel liegt in keiner NIP-29-Gruppe. Ein leeres `["h",""]` legte der
    // Relay in einen falschen Kanal.
    expect((kommentare[0].tags as string[][]).some((t) => t[0] === 'h')).toBe(false)

    raeumeSignale(ws, adresse)
})

// ── KERNBEWEIS 3: die Ablehnung des Relays erreicht die Flaeche IM WORTLAUT ────────

test.describe('Die Ablehnung des Relays', () => {
    /**
     * **Wie hier eine echte Ablehnung entsteht — und warum ausgerechnet so.**
     *
     * Produktiv lehnt der Board-Relay (`wss://nostr.einundzwanzig.space`,
     * nostr-rs-relay 0.10.0) mit `blocked: NIP-05 verification needed to publish events`
     * ab; das ist der Normalfall für jeden ohne verifizierte NIP-05-Adresse. Dieser Text
     * lässt sich am Test-zooid nicht erzeugen — die Zuordnung „Relay-Grund → Meldung"
     * steht deshalb mit genau diesem Literal als reiner Test in `js/publishResult.test.ts`.
     *
     * **Hier steht die andere Hälfte:** dass der Grund des Relays überhaupt bis in die
     * Fläche kommt und der Entwurf dabei stehen bleibt. Dafür genügt IRGENDEINE echte
     * Ablehnung, und der Test-zooid liefert eine mit lesbarem Grund, sobald der Autor kein
     * Mitglied mehr ist: `restricted: you are not a member of this relay`.
     *
     * **`unallowpubkey` und ausdrücklich NICHT `banpubkey`.** Beide sperren das Schreiben,
     * aber sie sind nicht gleich umkehrbar — am 2026-08-21 am laufenden Test-Relay
     * gemessen:
     *
     * | Weg                          | Schreiben | Lesen  | `allowpubkey` stellt her | 13534 |
     * |------------------------------|-----------|--------|--------------------------|-------|
     * | `unallowpubkey` → `allowpubkey` | gesperrt  | gesperrt | **ja, vollständig**    | unberührt |
     * | `banpubkey` → `unbanpubkey`     | gesperrt  | gesperrt | **NEIN**               | unberührt |
     *
     * `unbanpubkey` hebt den Bann auf, stellt die MITGLIEDSCHAFT aber nicht wieder her —
     * der Relay bleibt danach für den Testnutzer geschlossen, und zwar für alle folgenden
     * Specs dieses Workers. Gemessen, nicht vermutet: die Reparatur brauchte
     * `unbanpubkey` + `allowpubkey` + `assignrole`. `unallowpubkey` hat dagegen genau eine
     * Gegenoperation, und die ist dieselbe, die der Seed ohnehin fährt.
     *
     * `assignrole` wird hier NICHT angefasst: es schriebe in die 13534, an der fremde
     * Specs hängen (dieselbe Begründung wie in P4).
     */
    test.afterEach(async ({ baseURL }) => {
        // **Unbedingt und nicht nur im Erfolgsfall.** Bricht der Test irgendwo ab, wäre der
        // Testnutzer sonst für den Rest dieses Workers kein Mitglied mehr — jede folgende
        // Spec fiele mit „restricted: you are not a member" um, und zwar ohne erkennbaren
        // Zusammenhang zu dieser Datei.
        if (baseURL) {
            await mgmt(boardHttp(baseURL), { method: 'allowpubkey', params: [testKeys().pk] })
        }
    })

    test('KERNBEWEIS: der Grund des Relays steht WOERTLICH am Composer — und der Entwurf bleibt stehen', async ({
        page,
        baseURL,
    }) => {
        const ws = boardWs(baseURL as string)
        const http = boardHttp(baseURL as string)
        const identifier = `aw-abgelehnt-${rnd()}`
        const titel = `AWAbgelehnt-${rnd()}`
        const adresse = artikelAdresse(ADMIN_PUB, identifier)
        const entwurf = `Dieser Text darf nicht verlorengehen ${rnd()}`

        publishArticle(ws, ADMIN, ADMIN_PUB, {
            identifier,
            title: titel,
            content: 'Ein Artikel, dessen Kommentar abgelehnt wird.',
            publishedAt: 1_700_000_202,
        })

        await loginToBoard(page)
        await page.goto(`/articles/${naddrEncode({ kind: 30023, pubkey: ADMIN_PUB, identifier, relays: [] })}`)
        await expect(page.getByRole('heading', { name: titel, level: 1 })).toBeVisible({ timeout: 20_000 })

        // ERST jetzt sperren: der Artikel ist geladen, die Fläche steht. Ein von Anfang an
        // gesperrter Nutzer käme gar nicht bis hierher — der Test-zooid ist member-only
        // (`public_read = false`), er dürfte den Artikel nicht einmal lesen.
        await mgmt(http, { method: 'unallowpubkey', params: [testKeys().pk, 'P7-Ablehnungsprobe'] })

        const bereich = page.locator('[data-artikel-kommentare]')
        const feld = bereich.getByLabel('Kommentar schreiben')
        await feld.fill(entwurf)
        await bereich.getByRole('button', { name: 'Veröffentlichen' }).click()

        const fehler = page.locator('[data-artikel-kommentar-fehler]')
        await expect(fehler).toBeVisible({ timeout: 30_000 })
        // **Der Kern: der Wortlaut des Relays, nicht unsere Deutung davon.** Bis P7 wurde
        // er verworfen und durch „Nachricht vom Relay abgelehnt — du bist evtl. kein
        // Mitglied dieses Raums" ersetzt; für den produktiven NIP-05-Fall war das eine
        // erfundene Ursache, die in die falsche Richtung schickte.
        await expect(fehler).toContainText('restricted: you are not a member of this relay')

        // Und die zweite Hälfte der Zusage: der Entwurf steht noch da. Genau die Nutzer,
        // die diese Ablehnung sehen, können ihren Text nirgendwo sonst loswerden.
        await expect(feld).toHaveValue(entwurf)

        // **Die Sperre ZUERST aufheben, dann gegenprüfen — sonst ist die Gegenprobe
        // vakuum-grün.** Der Test-zooid ist member-only, `unallowpubkey` sperrt auch das
        // LESEN: eine Requery mit dem gesperrten Schlüssel bekäme `CLOSED: restricted…`
        // und lieferte null Zeilen — also genau das erwartete Ergebnis, aus dem falschen
        // Grund. Der `afterEach` bleibt als Netz bestehen; `allowpubkey` ist idempotent.
        await mgmt(http, { method: 'allowpubkey', params: [testKeys().pk] })

        // Gegenprobe am Relay: es liegt wirklich nichts. Ohne sie hiesse „Fehlermeldung
        // sichtbar" nur, dass eine Fehlermeldung sichtbar ist.
        expect(requery(ws, ['-k', '1111', '--tag', `A=${adresse}`])).toHaveLength(0)
        // Und die Positivkontrolle zur Gegenprobe selbst: derselbe Filter FINDET etwas,
        // wenn etwas da ist. Ohne sie belegte die Null oben auch einen kaputten Filter.
        //
        // `publishVerified` statt einer einmaligen `execFileSync` + sofortiger
        // `toHaveLength(1)`: `nak event` beweist mit Exit 0 nichts über die Annahme, und
        // eine einzelne Requery direkt danach kann leer antworten, obwohl das Ereignis
        // liegt (siehe `support/publishVerified.ts`).
        publishVerified(
            NAK,
            ['event', '--auth', '--sec', NSEC, '-k', '1111', '-t', `A=${adresse}`, '-c', 'Positivkontrolle'],
            ws,
            () => requery(ws, ['-k', '1111', '--tag', `A=${adresse}`]).find((e) => e.content === 'Positivkontrolle'),
            'Positivkontrolle-Kommentar',
        )
        expect(requery(ws, ['-k', '1111', '--tag', `A=${adresse}`])).toHaveLength(1)

        raeumeSignale(ws, adresse)
    })
})
