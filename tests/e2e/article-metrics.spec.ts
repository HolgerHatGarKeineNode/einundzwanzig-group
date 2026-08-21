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
    publishZapReceipt(ws, ADMIN, ADMIN_PUB, adresse, 21_000)
    // Ein Kommentar, der den Artikel NUR im grossen `A` nennt — der Fall, an dem ein
    // `#a`-only-Filter stumm leer bliebe.
    publishCommentRootOnly(ws, ADMIN, adresse)

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
})

// ── Der Sicherheitsfall: eine fremde Quittung blaeht die Summe nicht auf ──────────

test('SICHERHEIT: eine selbst signierte Zap-Quittung mit FREMDEM p-Tag aendert die Summe nicht', async ({
    page,
    baseURL,
}) => {
    /*
     * **Der Befund, gegen den dieser Test steht.** welshmans `zapFromEvent` hat vor
     * beiden Signaturprüfungen einen Kurzschluss: trägt eine Quittung im `p`-Tag
     * denselben Pubkey, der sie signiert hat, gilt sie als legitim — ohne
     * `lnurl`-Vergleich und ohne den Signer-Check gegen `zapper.nostrPubkey`. Der Betrag
     * kommt aus einem regulären Ausdruck über den bolt11-HRP, ohne Signatur und ohne
     * Prüfsumme.
     *
     * Da die Zuordnung zum Artikel über `#a`/`#e` läuft und über den EMPFÄNGER nichts
     * sagt, konnte damit jeder Dritte die Sat-Summe eines fremden Artikels frei setzen —
     * und **erst P6 macht das erreichbar**: vorher kamen 9735 nur vom Board-Relay, wo
     * Schreiben an NIP-05 hängt; die beiden Metrik-Relais sind offen.
     *
     * Der Riegel sitzt in `summiereZaps` (`js/articleMetrics.ts`): `p` muss der Autor
     * sein. Hier steht sein Nachweis auf der FLÄCHE — die reine Regel ist in
     * `js/articleMetrics.test.ts` festgenagelt.
     */
    const ws = boardWs(baseURL as string)
    const identifier = `am-fremdzap-${rnd()}`
    const titel = `AMFremdzap-${rnd()}`
    const adresse = artikelAdresse(ADMIN_PUB, identifier)

    publishArticle(ws, ADMIN, ADMIN_PUB, {
        identifier,
        title: titel,
        content: 'Ein Artikel, auf den jemand Fremdes eine Quittung ausstellt.',
        publishedAt: 1_700_000_104,
    })
    // Der ECHTE Zap: 21 Sats, `p` = der Autor.
    publishZapReceipt(ws, ADMIN, ADMIN_PUB, adresse, 21_000)
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

    await loginToBoard(page)
    await page.goto('/articles')

    const karte = page.locator('article', { has: page.getByRole('heading', { name: titel, exact: true }) }).first()
    await expect(karte).toBeVisible({ timeout: 20_000 })

    const gruppe = metriken(karte)
    await expect(gruppe).toBeVisible({ timeout: 20_000 })
    // Der echte Zap steht da — die Gruppe ist also nicht aus einem trivialen Grund
    // „unauffällig", sondern hat den Weg bis zur Anzeige tatsächlich genommen.
    await expect(gruppe.getByText('21', { exact: true })).toBeVisible()
    // Und die 2 100 000 Sats **beider** Angriffsformen nirgends. Ohne den Riegel stünde
    // hier „4.200.021" bzw. die formatierte Form davon.
    await expect(gruppe).not.toContainText('2.100')
    await expect(gruppe).not.toContainText('2100')
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
