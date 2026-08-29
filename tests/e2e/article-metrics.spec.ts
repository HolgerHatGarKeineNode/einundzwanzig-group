/**
 * P6 — die Sozialsignale der Artikelfläche (Reaktionen, Zaps, Kommentare), LESEND.
 *
 * ── Warum diese Datei im HOST-Repo liegt und nicht im Paket ────────────────────────
 *
 * `packages/einundzwanzig-group` hat kein `tests/`-Verzeichnis und keine `autoload-dev`;
 * jeder Feature- und E2E-Test dieses Vorhabens liegt deshalb hier (Präzedenz:
 * `LongformReaderTest.php`, `ArticleAuthorRouteTest.php`, `OrtskartenTest.php`). Das ist
 * keine Bequemlichkeit, sondern die einzige Stelle, an der die Suite läuft.
 *
 * ── Was hier steht und was anderswo ───────────────────────────────────────────────
 *
 * | Frage | Ort |
 * |---|---|
 * | Filterform, Zuordnung `A`/`a`/`e`, Zählregeln, Zap-Validierung | `js/articleMetrics.test.ts` (rein, `node --test`) |
 * | Dedupliziert die Multi-Relay-Ableitung über die Event-Id? | `js/articleMetricsStore.test.ts` (echtes `repository`/`tracker`) |
 * | Emittiert die **Primitive** ein zweites Mal? | ebenda, KERNBEWEIS 2 |
 * | Steht der Eingang wirklich im `derived([…])` der **produktiven** Ableitung? | **hier** |
 * | Erscheint eine 0? | **hier** |
 *
 * Die vorletzte Zeile ist der Grund für diese Datei. Ein Test, der die
 * `derived([…])`-Konstruktion nachbaut, kann per Konstruktion nicht sehen, dass der echte
 * Aufrufer ein Argument nie nachliefert — er bliebe grün, während die Fläche stumm leer
 * bleibt. Nur der echte Browser mit dem echten Modul beantwortet das.
 *
 * ── Und warum ein bloss „sichtbarer Zaehler" hier schon der Reaktivitaetsbeweis ist ─
 *
 * `loadArticleMetrics` startet **nach** `await load(artikel)` (fire-and-forget in
 * `loadArticles`). Die Sekundär-Ereignisse können also frühestens nach dem ersten Emit
 * der Ableitung im `repository` liegen. Fehlte der Eingang im Abhängigkeitsarray, käme
 * der Zähler deshalb **nie** — nicht „später", sondern nie. Genau das belegt die
 * Mutationsprobe im Bericht: typgleicher Ersatz des Eingangs durch ein leeres
 * `readable([])` lässt `tsc` und `test:unit` grün und macht **diese** Datei rot.
 *
 * ── Relays im Test ────────────────────────────────────────────────────────────────
 *
 * Produktiv fragt die Fläche für die Signale zwei FREMDE Relays
 * (`NOSTR_ARTICLE_METRIC_RELAYS`, empfohlen `wss://nos.lol,wss://relay.damus.io`). Im
 * Test zeigt dieselbe Variable auf den worker-eigenen zooid — jede fremde Adresse wäre
 * ein Bruch des Relay-Wächters (`support/fixtures.ts`, fail-closed gegen die Allowlist
 * der eigenen Worker-Ports). Gesetzt wird sie in `support/board-fixtures.ts`.
 */
import { naddrEncode } from 'nostr-tools/nip19'
import { test, expect, type Page } from './support/board-fixtures'
import { useZooid } from './support/zooid'
import { loginNsec } from './support/login'
import { testKeys } from './support/keys'
import {
    artikelAdresse,
    cleanupArticles,
    publishArticle,
    publishCommentRootOnly,
    publishProfile,
    publishReaction,
    publishZapReceipt,
} from './support/articles'

const NSEC = process.env.NOSTR_TEST_NSEC as string
const ADMIN = 'b2ee09a54bedf17ee1db562bdddd75c48661d981eb52c49dc206c55ba8439414'
const ADMIN_PUB = 'da99fbe39247109327ac8504750d0227d50a8f84049ac8bd2f6c7ad0806ed76d'

const rnd = (): number => Math.floor(Math.random() * 1e9)

/** Der Board-Relay dieses Workers — dieselbe Formel wie in `longform-reader.spec.ts`. */
function boardWs(baseURL: string): string {
    const port = Number(new URL(baseURL).port)

    return `ws://localhost:${3335 + (port - 8437)}`
}

async function loginToBoard(page: Page): Promise<void> {
    await useZooid(page)
    await loginNsec(page, NSEC)
}

// ── Der Zapper des Autors: kind 0 + LNURL-Attrappe ────────────────────────────────

/**
 * **Warum ein Zap-Zähler ohne diesen Apparat gar nicht entstehen kann.**
 *
 * Der Weg ist derselbe wie im Chat: `kind 0` des Autors → `lud16` → `getLnUrl` →
 * lnurl-pay-Abruf → `Zappers`-Store → `zapperNachschlag` (`js/longformFeed.ts:363`).
 * Erst mit dem aufgelösten Zapper kann `summiereZaps` eine Quittung überhaupt prüfen:
 * `Zapper.validate` vergleicht den SIGNIERER der Quittung gegen `nostrPubkey` des
 * lnurl-pay-Dokuments. **Ohne Zapper zählt sie null** — so steht es seit jeher im
 * Docblock von `js/longformFeed.ts:358`.
 *
 * ── Was hier bis zum 2026-08-29 stand, und warum es weg musste ────────────────────
 *
 * Die Fixture kam ohne all das aus: sie signierte die Quittung mit dem EMPFÄNGER-
 * schlüssel und legte dem Autor gar keinen Zapper an. Das funktionierte nur, weil
 * welshman 0.8.16 in `zapFromEvent` einen Kurzschluss hatte — trug eine Quittung im
 * `p`-Tag denselben Pubkey, der sie signiert hatte, galt sie ohne Signaturvergleich als
 * legitim. **Der Test war grün, weil er den Anti-Spoof-Riegel umging.** 0.9.5 prüft
 * `receipt.event.pubkey !== this.nostrPubkey` unbedingt (`domain/src/other/Zapper.js:47`),
 * und die Fixture fiel durch — kein Sprungschaden, sondern der Sicherheitsgewinn, der
 * die Lücke im Prüfstand sichtbar gemacht hat.
 *
 * ── Der SIGNIERER ist ADMIN, und das ist Absicht ─────────────────────────────────
 *
 * `nostrPubkey` ist hier der Autorenschlüssel selbst — ein LNURL-Server, der mit dem
 * Schlüssel seines Nutzers signiert, ist NIP-57-konform und bei selbst gehosteten
 * Diensten der Normalfall. Der Grund für diese Wahl ist der Negativfall: er braucht
 * einen zweiten Schlüssel, der am member-only-zooid (`public_write=false`) überhaupt
 * schreiben darf, und das ist der VIEWER. Wäre der Viewer der LNURL-Signierer, wäre er
 * zugleich der Angreifer aus den Fällen darunter — dieselbe Rolle zweimal, und kein
 * Leser könnte die beiden Aussagen noch trennen.
 */
const LNURL_DOMAIN = 'lnurl-am.test'
const AUTOR_LUD16 = `am-autor@${LNURL_DOMAIN}`

/** Gültige LUD-06/LUD-16-Antwort mit den NIP-57-Zusätzen. Trägt KEIN `pubkey` — das gibt es dort nicht. */
const LNURL_PAY_DOC = {
    callback: `https://${LNURL_DOMAIN}/lnurlp/cb`,
    minSendable: 1_000,
    maxSendable: 100_000_000,
    metadata: '[["text/plain","E2E Artikel-Metriken"]]',
    tag: 'payRequest',
    allowsNostr: true,
    nostrPubkey: ADMIN_PUB,
}

/** Ein Zahlender, der mit niemandem sonst in dieser Datei zusammenfällt. */
const ABSENDER_PUB = 'a'.repeat(64)

/**
 * Fängt den lnurl-pay-Abruf ab und zählt die Treffer.
 *
 * **Nichts verlässt die Testmaschine**: `.test` ist per RFC 6761 nicht auflösbar, und der
 * Stub greift ohnehin davor. Der Zähler ist die Positivkontrolle — bleibt er auf 0, hat
 * der Warmlauf nie stattgefunden, und ein fehlender Zap-Zähler unten wäre dann eine
 * Aussage über die Fixture statt über das Produkt.
 */
async function stubLnurl(page: Page): Promise<() => number> {
    let treffer = 0
    await page.route(/\.well-known\/lnurlp/, (route) => {
        treffer += 1

        return route.fulfill({
            status: 200,
            contentType: 'application/json',
            headers: { 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify(LNURL_PAY_DOC),
        })
    })

    return () => treffer
}

/**
 * Setzt dem Autor die Lightning-Adresse und gibt den Rückbau zurück.
 *
 * **`kind 0` ist ERSETZBAR und der zooid wird von allen Tests dieses Workers geteilt** —
 * ein gesetztes `lud16`, das stehen bleibt, lässt jeden späteren Test desselben Workers
 * beim Öffnen eines Raums diesen Endpoint anwärmen. Genau daran hing der wochenlang
 * undiagnostizierte Flake in `storage-cache.spec.ts:196` (siehe `room.spec.ts`, B3).
 *
 * Deshalb **innerhalb des Tests** setzen und im `finally` zurückschreiben, nicht in
 * `beforeAll`/`afterAll`: bei `fullyParallel` laufen zwischen zwei Tests DIESER Datei
 * Tests anderer Dateien auf demselben Worker, und ein `afterAll` käme für sie zu spät.
 * `ts + 1` und nicht weiter in die Zukunft — es gewinnt das grössere `created_at`, ein
 * vorausdatierter Rückbau schlüge den Setz-Aufruf eines kurz danach laufenden Tests.
 */
function setzeAutorLud16(ws: string): () => void {
    const ts = Math.floor(Date.now() / 1000)
    publishProfile(ws, ADMIN, { name: 'Relay Admin', lud16: AUTOR_LUD16 }, ts)

    return () => publishProfile(ws, ADMIN, { name: 'Relay Admin' }, ts + 1)
}

test.afterAll(async ({ baseURL }) => {
    if (baseURL) {
        cleanupArticles(boardWs(baseURL), ADMIN)
    }
})

/**
 * Die Zähler-Gruppe einer Karte bzw. der Vollansicht.
 *
 * `[data-artikel-metriken]` und nicht „das dritte Span in der Meta-Zeile": ein
 * Positions-Locator wäre bei der nächsten Ergänzung still falsch. Das Attribut trägt
 * `components/article-metrics.blade.php` und **nur** diese Komponente.
 */
const metriken = (scope: Page | ReturnType<Page['locator']>) => scope.locator('[data-artikel-metriken]')

// ── Der Kernbeweis dieser Datei ────────────────────────────────────────────────────

test('KERNBEWEIS: Reaktion, Zap und Kommentar erscheinen als Zaehler an der KARTE — obwohl sie NACH den Artikeln geladen werden', async ({
    page,
    baseURL,
}) => {
    const ws = boardWs(baseURL as string)
    const identifier = `am-karte-${rnd()}`
    const titel = `AMKarte-${rnd()}`
    const adresse = artikelAdresse(ADMIN_PUB, identifier)

    const rueckbau = setzeAutorLud16(ws)
    try {
        publishArticle(ws, ADMIN, ADMIN_PUB, {
            identifier,
            title: titel,
            content: 'Ein Artikel mit Sozialsignalen.',
            publishedAt: 1_700_000_100,
        })
        // Zwei Reaktionen mit VERSCHIEDENEN Emojis vom selben Schlüssel: die Zählregel
        // dedupliziert je (Autor, Emoji), also müssen daraus zwei werden. Zweimal dasselbe
        // Emoji wäre eins — das steht als reiner Fall in `js/articleMetrics.test.ts`.
        publishReaction(ws, ADMIN, adresse, '+')
        publishReaction(ws, ADMIN, adresse, '🔥')
        // 21 000 msats = 21 Sats. Die Anzeige zeigt SATS, sobald welche validiert sind.
        // Signiert vom `nostrPubkey` des lnurl-pay-Dokuments (= ADMIN), `p` auf den Autor,
        // Zahlender ein Dritter — das vollständige Bild eines echten Zaps.
        publishZapReceipt(ws, ADMIN, ADMIN_PUB, adresse, 21_000, ABSENDER_PUB)
        // Ein Kommentar, der den Artikel NUR im grossen `A` nennt — der Fall, an dem ein
        // `#a`-only-Filter stumm leer bliebe.
        publishCommentRootOnly(ws, ADMIN, adresse)

        const lnurlTreffer = await stubLnurl(page)
        await loginToBoard(page)
        await page.goto('/articles')

        const karte = page.locator('article', { has: page.getByRole('heading', { name: titel, exact: true }) }).first()
        await expect(karte).toBeVisible({ timeout: 20_000 })

        const gruppe = metriken(karte)
        await expect(gruppe).toBeVisible({ timeout: 20_000 })
        // Die drei Zahlen, jede einzeln. Ein `toContainText('2')` über die ganze Gruppe wäre
        // auch dann grün, wenn nur ein Zähler stünde und zufällig „2" enthielte.
        await expect(gruppe.getByText('2', { exact: true })).toBeVisible()
        await expect(gruppe.getByText('21', { exact: true })).toBeVisible()
        await expect(gruppe.getByText('1', { exact: true })).toBeVisible()
        // Positivkontrolle der Fixture: der Zapper ist wirklich über den lnurl-pay-Abruf
        // gekommen. Ohne diese Zeile bliebe offen, ob die 21 aus dem geprüften Weg stammt
        // oder aus einem Zweig, der die Prüfung gar nicht erst erreicht.
        expect(lnurlTreffer(), 'der lnurl-pay-Abruf hat nie stattgefunden — die 21 kämen dann nicht aus dem geprüften Weg').toBeGreaterThan(0)
    } finally {
        rueckbau()
    }
})

// ── Der Sicherheitsfall: eine fremde Quittung blaeht die Summe nicht auf ──────────

test('SICHERHEIT: drei gefaelschte Zap-Quittungen aendern die Summe nicht', async ({
    page,
    baseURL,
}) => {
    /*
     * **Drei Angriffsformen, zwei Riegel — und der Befund, gegen den das steht.**
     *
     * Eine kind 9735 behauptet eine Zahlung, sie beweist sie nicht: der Betrag kommt aus
     * einem regulären Ausdruck über den bolt11-HRP, ohne Signatur und ohne Prüfsumme. Da
     * die Zuordnung zum Artikel über `#a`/`#e` läuft und über den EMPFÄNGER nichts sagt,
     * könnte jeder Dritte die Sat-Summe eines fremden Artikels frei setzen — und **erst
     * P6 macht das erreichbar**: vorher kamen 9735 nur vom Board-Relay, wo Schreiben an
     * NIP-05 hängt; die beiden Metrik-Relais sind offen.
     *
     * **Riegel 1 — unser eigener** (`summiereZaps`, `js/articleMetrics.ts:612`): das
     * `p`-Tag muss der Artikel-AUTOR sein, gelesen mit `fromPairs` wie welshman selbst.
     * Er fängt die ersten beiden Formen unten.
     *
     * **Riegel 2 — welshmans Signaturvergleich** (`Zapper.validate`,
     * `domain/src/other/Zapper.js:47`): die Quittung muss vom `nostrPubkey` des
     * lnurl-pay-Dokuments signiert sein. Er fängt die dritte Form, die an Riegel 1 glatt
     * vorbeiläuft.
     *
     * **Hier stand bis zum 2026-08-29, welshman habe „vor beiden Signaturprüfungen einen
     * Kurzschluss" — das galt für 0.8.16 und ist seit 0.9.5 falsch.** Der Kurzschluss
     * (`responseMeta.p === response.pubkey` → gültig, ohne jeden Vergleich) ist zu. Er
     * war der Grund, warum die Fixture dieser Datei bis dahin ohne Zapper auskam — und
     * damit der Grund, warum die dritte Angriffsform hier nie geprüft wurde: eine
     * Fixture, die einen Riegel selbst aushebelt, kann ihn nicht messen. Riegel 1 bleibt
     * trotzdem stehen; er kostet nichts, und eine Zusage, die an zwei Stellen gilt,
     * überlebt den nächsten Upstream-Umbau.
     *
     * Die reinen Regeln sind in `js/articleMetrics.test.ts` festgenagelt; hier steht ihr
     * Nachweis auf der FLÄCHE.
     */
    const ws = boardWs(baseURL as string)
    const identifier = `am-fremdzap-${rnd()}`
    const titel = `AMFremdzap-${rnd()}`
    const adresse = artikelAdresse(ADMIN_PUB, identifier)

    const rueckbau = setzeAutorLud16(ws)
    try {
        publishArticle(ws, ADMIN, ADMIN_PUB, {
            identifier,
            title: titel,
            content: 'Ein Artikel, auf den jemand Fremdes eine Quittung ausstellt.',
            publishedAt: 1_700_000_104,
        })
        // Der ECHTE Zap: 21 Sats, `p` = der Autor, signiert vom `nostrPubkey` des
        // lnurl-pay-Dokuments.
        publishZapReceipt(ws, ADMIN, ADMIN_PUB, adresse, 21_000, ABSENDER_PUB)
        /*
         * Der ANGRIFF, und die Bauform ist der ganze Punkt: die Quittung wird vom
         * **VIEWER-Schlüssel** signiert und trägt **dessen eigenen** Pubkey im `p` — genau
         * die Konstellation, die welshmans Kurzschluss `responseMeta.p === response.pubkey`
         * ohne jede weitere Prüfung durchwinkt. Der Artikel gehört dem ADMIN.
         *
         * **Ein früherer Entwurf traf das nicht** und war deshalb wertlos: er signierte mit
         * dem ADMIN und setzte einen erfundenen Pubkey ins `p`. Dann greift der Kurzschluss
         * gar nicht, welshman verwirft ohnehin am Signer-Check, und der Fall blieb unter der
         * Mutationsprobe (p-Riegel entfernt) grün. Gemessen, nicht vermutet.
         *
         * Ein völlig fremder Wegwerf-Schlüssel geht hier NICHT: der Test-zooid ist
         * member-only (`public_write=false`, `zooid-testserver.sh`) und nähme sein Ereignis
         * nicht an. Der VIEWER ist Mitglied und trotzdem nicht der Autor — das genügt.
         */
        const angreifer = testKeys()
        publishZapReceipt(ws, NSEC, angreifer.pk, adresse, 2_100_000_000)
        /*
         * **Die zweite Angriffsform, und sie hat den ersten Riegel dieser Phase gekippt.**
         * Zwei `p`-Tags: der Autor zuerst, der Angreifer zuletzt. Ein selbst gebauter Leser
         * (`tags.find`) sieht den ERSTEN — also den Autor — und lässt durch; welshmans
         * `fromPairs` sieht den LETZTEN und feuert den Kurzschluss. In diesem Spalt lebte der
         * ganze Angriff. Nostr verbietet doppelte Tags nicht, Relays deduplizieren sie nicht.
         *
         * Der Riegel liest deshalb mit derselben Funktion wie welshman. Ohne ihn stünden hier
         * 2 100 000 Sats an einem fremden Artikel — pro Quittung, beliebig oft.
         */
        publishZapReceipt(ws, NSEC, [ADMIN_PUB, angreifer.pk], adresse, 2_100_000_000)
        /*
         * **Die DRITTE Angriffsform, und sie ist die eigentliche Zusage dieses Umbaus
         * (2026-08-29).** `p` ist hier korrekt der AUTOR — sie läuft also am `p`-Riegel in
         * `summiereZaps` glatt vorbei und wird einzig davon gestoppt, dass sie nicht vom
         * `nostrPubkey` des lnurl-pay-Dokuments signiert ist (`Zapper.validate`,
         * `domain/src/other/Zapper.js:47`).
         *
         * **Ohne sie wäre der Fixture-Umbau bloss eine Reparatur.** Die Fixture konnte diese
         * Form vorher gar nicht darstellen: sie umging den Signaturvergleich selbst, und ein
         * Negativfall gegen einen Riegel, den die eigene Fixture aushebelt, prüft nichts.
         * Genau deshalb blieb die Lücke bis zum welshman-Sprung unentdeckt.
         *
         * Der Signierer ist der VIEWER — ein Mitglied des member-only-zooid, das schreiben
         * darf und trotzdem nicht der LNURL-Server des Autors ist. Ein völlig fremder
         * Wegwerf-Schlüssel käme am Relay gar nicht erst an.
         */
        publishZapReceipt(ws, NSEC, ADMIN_PUB, adresse, 2_100_000_000, ABSENDER_PUB)

        const lnurlTreffer = await stubLnurl(page)
        await loginToBoard(page)
        await page.goto('/articles')

        const karte = page.locator('article', { has: page.getByRole('heading', { name: titel, exact: true }) }).first()
        await expect(karte).toBeVisible({ timeout: 20_000 })

        const gruppe = metriken(karte)
        await expect(gruppe).toBeVisible({ timeout: 20_000 })
        // Der echte Zap steht da — die Gruppe ist also nicht aus einem trivialen Grund
        // „unauffällig", sondern hat den Weg bis zur Anzeige tatsächlich genommen.
        await expect(gruppe.getByText('21', { exact: true })).toBeVisible()
        // **Und damit ist der Zapper aufgelöst.** Das ist die Vorbedingung, unter der die
        // drei Abwesenheitsprüfungen unten überhaupt etwas aussagen: ohne Zapper zählte
        // `summiereZaps` alles nicht — auch den echten Zap —, und „keine 2 100 000" wäre dann
        // wahr, ohne dass ein Riegel gegriffen hätte.
        expect(lnurlTreffer(), 'der lnurl-pay-Abruf hat nie stattgefunden — die Abwesenheitsprüfungen unten wären wertlos').toBeGreaterThan(0)
        // Und die 2 100 000 Sats **aller drei** Angriffsformen nirgends. Ohne die Riegel
        // stünde hier „6.300.021" bzw. die formatierte Form davon.
        await expect(gruppe).not.toContainText('2.100')
        await expect(gruppe).not.toContainText('2100')
        await expect(gruppe).not.toContainText('4.200')
        await expect(gruppe).not.toContainText('6.300')
    } finally {
        rueckbau()
    }
})

// ── Dieselben Zahlen in der Vollansicht ───────────────────────────────────────────

test('die Zaehler erscheinen auch in der VOLLANSICHT — dieselbe Komponente, dieselben Zahlen', async ({ page, baseURL }) => {
    const ws = boardWs(baseURL as string)
    const identifier = `am-voll-${rnd()}`
    const adresse = artikelAdresse(ADMIN_PUB, identifier)

    publishArticle(ws, ADMIN, ADMIN_PUB, {
        identifier,
        title: `AMVoll-${rnd()}`,
        content: 'Ein Artikel, den man auch ganz lesen kann.',
        publishedAt: 1_700_000_101,
    })
    publishReaction(ws, ADMIN, adresse, '+')
    publishCommentRootOnly(ws, ADMIN, adresse)

    const naddr = naddrEncode({ kind: 30023, pubkey: ADMIN_PUB, identifier, relays: [] })

    await loginToBoard(page)
    await page.goto(`/articles/${naddr}`)
    await expect(page.locator('[data-artikel-text]')).toBeVisible({ timeout: 20_000 })

    const gruppe = metriken(page).first()
    await expect(gruppe).toBeVisible({ timeout: 20_000 })
    // Eine Reaktion, ein Kommentar, kein Zap: zwei Zahlen, beide „1".
    await expect(gruppe.getByText('1', { exact: true })).toHaveCount(2)
})

// ── Der Nullwert ──────────────────────────────────────────────────────────────────

test('ein Artikel OHNE jedes Signal zeigt KEINE Nullen — die Gruppe steht gar nicht im DOM', async ({ page, baseURL }) => {
    const ws = boardWs(baseURL as string)
    const titel = `AMLeer-${rnd()}`

    publishArticle(ws, ADMIN, ADMIN_PUB, {
        identifier: `am-leer-${rnd()}`,
        title: titel,
        content: 'Ein Artikel, den bisher niemand angefasst hat.',
        publishedAt: 1_700_000_102,
    })

    await loginToBoard(page)
    await page.goto('/articles')

    const karte = page.locator('article', { has: page.getByRole('heading', { name: titel, exact: true }) }).first()
    await expect(karte).toBeVisible({ timeout: 20_000 })
    // Die Lesezeit steht da — die Karte ist also fertig gerendert und der Befund unten
    // ist kein „noch nicht so weit". Ohne diese Zeile wäre `toHaveCount(0)` auch auf
    // einer halb aufgebauten Karte grün.
    await expect(karte.getByText('Min. Lesezeit')).toBeVisible({ timeout: 20_000 })

    // `x-if` statt `x-show`: bei 0 existiert der Knoten NICHT. `toBeHidden()` wäre die
    // schwächere Aussage und ginge auch bei einem unsichtbaren „0"-Chip durch.
    await expect(metriken(karte)).toHaveCount(0)
})

// ── Nachgeladen: die Anzeige aendert sich ─────────────────────────────────────────

test('ein NACH dem ersten Render eingespieltes Signal aendert die Anzeige', async ({ page, baseURL }) => {
    const ws = boardWs(baseURL as string)
    const identifier = `am-nach-${rnd()}`
    const titel = `AMNach-${rnd()}`
    const adresse = artikelAdresse(ADMIN_PUB, identifier)

    publishArticle(ws, ADMIN, ADMIN_PUB, {
        identifier,
        title: titel,
        content: 'Ein Artikel, der erst spaeter Zuspruch bekommt.',
        publishedAt: 1_700_000_103,
    })

    await loginToBoard(page)
    await page.goto('/articles')

    const karte = page.locator('article', { has: page.getByRole('heading', { name: titel, exact: true }) }).first()
    await expect(karte).toBeVisible({ timeout: 20_000 })
    await expect(karte.getByText('Min. Lesezeit')).toBeVisible({ timeout: 20_000 })
    await expect(metriken(karte)).toHaveCount(0)

    // **Jetzt** kommt das Signal — nach dem Render, nicht davor.
    publishReaction(ws, ADMIN, adresse, '+')

    // Die Fläche hält kein Live-Abo auf die Sozialsignale: ein Artikel ist kein Chat, und
    // eine dauerhaft offene Subscription auf drei Relays wäre für einen Zähler zu teuer
    // (Begründung bei `loadArticles` in `js/longformFeed.ts`). Der zweite Ladevorgang
    // entsteht deshalb durch das Öffnen der Vollansicht — der reale Weg eines Lesers.
    const naddr = naddrEncode({ kind: 30023, pubkey: ADMIN_PUB, identifier, relays: [] })
    await page.goto(`/articles/${naddr}`)
    await expect(page.locator('[data-artikel-text]')).toBeVisible({ timeout: 20_000 })

    const gruppe = metriken(page).first()
    await expect(gruppe).toBeVisible({ timeout: 20_000 })
    await expect(gruppe.getByText('1', { exact: true })).toBeVisible()
})
