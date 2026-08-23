import { test, expect, type Page } from './support/fixtures'
import { execFileSync } from 'node:child_process'
import { npubEncode } from 'nostr-tools/nip19'
import { useZooid, ZOOID_WS } from './support/zooid'
import { loginNsec } from './support/login'
import { cleanupRooms, trackRoom } from './support/rooms'
import { publishVerified } from './support/publishVerified'

/**
 * Die schmale Auszeichnungs-Schicht des Chats (`js/chatMarkup.ts` + der Code-Zweig in
 * `js/feeds.ts`), am echten Verlauf.
 *
 * ── Was hier NICHT geprüft wird ───────────────────────────────────────────────────
 * Die REGELN selbst — welches Muster greift, wo die Grenzen der Ausdrücke liegen,
 * Potenzschreibweise, verschachtelte Marker — decken 15 Pure-Tests ab:
 *   node --test packages/einundzwanzig-group/js/chatMarkup.test.ts
 * Sie laufen ohne Browser und sind dort billiger und schärfer. Diese Spec deckt die
 * NAHT: dass die Auszeichnung durch welshmans Parser, den Renderer, den `htmlCache`
 * und das Blade-Markup wirklich bis in die gerenderte Zeile kommt — und dass sie aus
 * den Ausschnitten wieder VERSCHWINDET, wo kein HTML dargestellt werden kann. Kein
 * Zeichenketten-Vergleich kann das beantworten; ein `<strong>` im DOM schon.
 *
 * ── Determinismus ─────────────────────────────────────────────────────────────────
 * Jeder Test legt seinen EIGENEN Raum an (`trackRoom` + `cleanupRooms` im `afterAll`),
 * Nachrichten kommen roh per `nak` — exakte Kontrolle über den Text ist hier der ganze
 * Punkt (dieselbe Begründung wie `quote-card.spec.ts`).
 */

const NSEC = process.env.NOSTR_TEST_NSEC as string
const NAK = process.env.NAK ?? `${process.env.HOME}/go/bin/nak`
// Relay-Owner-Secret; Kind-0 „Relay Admin" ist Teil des Seeds (zooid-testserver.sh:280).
const ADMIN = 'b2ee09a54bedf17ee1db562bdddd75c48661d981eb52c49dc206c55ba8439414'
const ADMIN_PUB = 'da99fbe39247109327ac8504750d0227d50a8f84049ac8bd2f6c7ad0806ed76d'

type RelayEvent = { id: string; content: string }

const rnd = (): number => Math.floor(Math.random() * 1e9)

/** `nak` mit Wiederholung — gegen Umgebungs-Transienz, nicht gegen Produktfehler. */
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

function createRoomNak(h: string, name: string): void {
    nak(['event', '--auth', '--sec', ADMIN, '-k', '9007', '-t', `h=${h}`, ZOOID_WS])
    nak(['event', '--auth', '--sec', ADMIN, '-k', '9002', '-t', `h=${h}`, '-t', `name=${name}`, ZOOID_WS])
}

/**
 * Publiziert eine kind-9-Nachricht und gibt ihre Event-id zurück — erst wenn sie am
 * Relay LIEGT (`publishVerified`: `nak event` beweist mit Exit 0 nichts über Annahme).
 *
 * Der Inhalt geht als ARGUMENT an `nak` (kein Shell-String): Backticks, Sterne und
 * spitze Klammern müssen den Weg unverändert überstehen — genau sie sind der
 * Prüfgegenstand, eine Shell-Interpretation würde den Test lautlos entwerten.
 */
function publishRaw(h: string, content: string, extraTags: string[] = []): string {
    const args = ['event', '--auth', '--sec', ADMIN, '-k', '9', '-t', `h=${h}`, ...extraTags, '-c', content]
    const finde = (): RelayEvent | undefined =>
        nak(['req', '-k', '9', '-t', `h=${h}`, '--auth', '--sec', ADMIN, ZOOID_WS])
            .trim()
            .split('\n')
            .filter(Boolean)
            .map((l) => JSON.parse(l) as RelayEvent)
            .find((e) => e.content === content)
    return publishVerified(NAK, args, ZOOID_WS, finde, `Raumnachricht in ${h}`).id
}

async function openRoom(page: Page, h: string): Promise<void> {
    await useZooid(page)
    await loginNsec(page, NSEC)
    await page.goto(`/rooms/${h}`)
}

/**
 * Die Chat-Zeile, deren TEXTKÖRPER diesen Marker trägt.
 *
 * Bewusst über `.chat-content` gefiltert und nicht über die ganze Zeile: eine Antwort
 * trägt den Marker der zitierten Nachricht in ihrer Vorschau MIT, und `div.group`
 * mit `hasText` griff dann auch sie. Beim Bau dieser Spec (2026-08-16) traf ein
 * `.last()` deshalb die ANTWORT statt der zitierten Zeile — der Test suchte sein
 * `<strong>` in der falschen Zeile und meldete einen Produktfehler, der keiner war.
 */
const zeile = (page: Page, marker: string) =>
    page.locator('div.group', { has: page.locator('.chat-content', { hasText: marker }) }).last()

test.afterAll(() => cleanupRooms(ZOOID_WS, ADMIN))

// ── 1) Die vier gerenderten Formen ──────────────────────────────────────────────────

/**
 * Geprüft wird je das ECHTE Element mit seinem Inhalt, nicht „irgendwo steht fett".
 * Ein `toContainText('fett')` wäre schon vor der Änderung grün gewesen — die Sterne
 * verschwanden ja nicht, sie standen nur als Text da. Erst `strong` mit exakt dem
 * eingeschlossenen Text sagt, dass die Auszeichnung wirklich stattgefunden hat.
 */
test('Die vier Formen kommen im Verlauf an: strong, del, code und pre', async ({ page }) => {
    const h = trackRoom(`mk1${rnd()}`)
    createRoomNak(h, 'MK1')

    const mFett = `MKFett-${rnd()}`
    const mDurch = `MKDurch-${rnd()}`
    const mCode = `MKCode-${rnd()}`
    const mBlock = `MKBlock-${rnd()}`

    publishRaw(h, `${mFett} Das ist **sehr wichtig** gewesen`)
    publishRaw(h, `${mDurch} Das war ~~falsch~~ gemeint`)
    publishRaw(h, `${mCode} ruf \`npm run build\` auf`)
    publishRaw(h, `${mBlock}\n\`\`\`\nconst x = 1\nconst y = 2\n\`\`\``)

    await openRoom(page, h)
    await expect(page.getByText(mFett, { exact: false })).toBeVisible({ timeout: 15_000 })

    const fett = zeile(page, mFett).locator('.chat-content strong')
    await expect(fett).toHaveText('sehr wichtig', { timeout: 15_000 })
    // Und die Marker sind VERBRAUCHT, nicht bloß überdeckt.
    await expect(zeile(page, mFett).locator('.chat-content')).toHaveText(`${mFett} Das ist sehr wichtig gewesen`)

    const durch = zeile(page, mDurch).locator('.chat-content del')
    await expect(durch).toHaveText('falsch', { timeout: 15_000 })
    await expect(zeile(page, mDurch).locator('.chat-content')).toHaveText(`${mDurch} Das war falsch gemeint`)

    // Inline-Code: eigenes Element mit eigener Klasse, Zäune weg.
    const code = zeile(page, mCode).locator('.chat-content code.chat-code')
    await expect(code).toHaveText('npm run build', { timeout: 15_000 })
    await expect(zeile(page, mCode).locator('.chat-content')).toHaveText(`${mCode} ruf npm run build auf`)

    // Block: `pre.chat-pre > code`, Zeilenumbruch ERHALTEN (deshalb `textContent`
    // statt `toHaveText` — Playwright normalisiert dort Leerraum und könnte einen
    // verlorenen Umbruch nicht mehr von einem Leerzeichen unterscheiden).
    const pre = zeile(page, mBlock).locator('.chat-content pre.chat-pre code')
    await expect(pre).toBeVisible({ timeout: 15_000 })
    expect(await pre.textContent(), 'der Block behält seine Zeilenstruktur').toBe('const x = 1\nconst y = 2')
})

// ── 2) Die abgelehnten Formen bleiben Text ──────────────────────────────────────────

/**
 * Jede Ablehnung hat im Kopf von `chatMarkup.ts` ihren eigenen Grund; hier wird
 * gemessen, dass sie auch wirklich abgelehnt WIRD.
 *
 * Bei `[Text](URL)` ist die Aussage schärfer als „kein Link": das Ziel muss SICHTBAR
 * bleiben. Der Ablehnungsgrund ist Phishing — verstecktes Ziel hinter frei wählbarem
 * Text —, und eine Umsetzung, die die URL zwar nicht verlinkt, sie aber trotzdem
 * schluckte, hätte denselben Schaden. Deshalb wird die URL im Text nachgewiesen und
 * nicht nur das Fehlen eines `<a>` mit fremdem Anzeigetext.
 */
test('Abgelehnt bleibt Text: Überschrift, Klammer-Link (URL sichtbar) und einfacher Stern', async ({ page }) => {
    const h = trackRoom(`mk2${rnd()}`)
    createRoomNak(h, 'MK2')

    const mH = `MKH-${rnd()}`
    const mLink = `MKLink-${rnd()}`
    const mStern = `MKStern-${rnd()}`

    publishRaw(h, `${mH}\n# Keine Ueberschrift`)
    publishRaw(h, `${mLink} siehe [harmlos](https://boese.example/phish) dort`)
    publishRaw(h, `${mStern} 3 * 4 und *kein kursiv* hier`)

    await openRoom(page, h)
    await expect(page.getByText(mH, { exact: false })).toBeVisible({ timeout: 15_000 })

    // 1) `#` bleibt stehen, es entsteht keine Überschrift.
    const hZeile = zeile(page, mH).locator('.chat-content')
    await expect(hZeile).toContainText('# Keine Ueberschrift', { timeout: 15_000 })
    await expect(hZeile.locator('h1, h2, h3, h4, h5, h6')).toHaveCount(0)

    // 2) Der Klammer-Link: die URL steht SICHTBAR im Text. Dass welshman die nackte URL
    //    daneben automatisch verlinkt, ist gewollt (`chatLinks.ts`) — entscheidend ist,
    //    dass kein Anker mit dem frei gewählten Text „harmlos" auf sie zeigt, denn genau
    //    das wäre die Phishing-Fläche.
    const linkZeile = zeile(page, mLink).locator('.chat-content')
    await expect(linkZeile).toContainText('https://boese.example/phish', { timeout: 15_000 })
    await expect(linkZeile).toContainText('[harmlos]')
    await expect(
        linkZeile.getByRole('link', { name: 'harmlos', exact: true }),
        'ein Anker, dessen Text das Ziel verbirgt, ist genau der abgelehnte Fall',
    ).toHaveCount(0)

    // 3) Der EINFACHE Stern bleibt Zeichen — sonst würden Multiplikation und
    //    Zensur-Sternchen zu Kursivschrift.
    const sternZeile = zeile(page, mStern).locator('.chat-content')
    await expect(sternZeile).toHaveText(`${mStern} 3 * 4 und *kein kursiv* hier`, { timeout: 15_000 })
    await expect(sternZeile.locator('em, i')).toHaveCount(0)
})

// ── 3) Die Marker sind aus den Ausschnitten raus ────────────────────────────────────

/**
 * Ein Ausschnitt wird als reiner Text gezeigt — er KANN kein `<strong>` tragen. Ohne
 * `stripInlineMarkup` stünde die Auszeichnung dort also wieder sichtbar da, an genau
 * der Stelle, an der sie niemand lesen will. Es ist zugleich ein A11y-Fall: der
 * Vorschautext geht in den barrierefreien Namen der Schaltfläche ein, ein Screenreader
 * spräche die Sterne mit. Deshalb wird BEIDES geprüft — der sichtbare Text und der
 * berechnete Name.
 */
test('Antwort-Vorschau zeigt den Ausschnitt ohne Marker — sichtbar und im barrierefreien Namen', async ({ page }) => {
    const h = trackRoom(`mk3${rnd()}`)
    createRoomNak(h, 'MK3')

    const mZiel = `MKZiel-${rnd()}`
    const mAntwort = `MKAntwort-${rnd()}`
    const zielId = publishRaw(h, `${mZiel} Das ist **wichtig** und ~~das~~ nicht`)
    publishRaw(h, `${mAntwort} stimmt`, ['-t', `q=${zielId}`, '-t', `p=${ADMIN_PUB}`])

    await openRoom(page, h)
    await expect(page.getByText(mAntwort, { exact: false })).toBeVisible({ timeout: 15_000 })

    const antwort = zeile(page, mAntwort)
    // Die Vorschau ist die Rail-Fläche der Zeile (`$quoteRail` in chat-row.blade.php);
    // ihre zweite Zeile trägt den Ausschnitt, die erste den Autornamen.
    const vorschau = antwort.locator('[data-quote-rail]')
    await expect(vorschau).toBeVisible({ timeout: 15_000 })
    await expect(vorschau.locator('div').nth(1)).toHaveText(`${mZiel} Das ist wichtig und das nicht`)
    // Kein Marker-Rest — weder Stern noch Tilde.
    await expect(vorschau).not.toContainText('**')
    await expect(vorschau).not.toContainText('~~')

    // Derselbe Text im berechneten Namen der Schaltfläche: das ist, was vorgelesen wird.
    await expect(
        antwort.getByRole('button', { name: new RegExp(`${mZiel} Das ist wichtig und das nicht`) }),
    ).toHaveCount(1)

    // Gegenprobe zur Aussage „nur der Ausschnitt ist bereinigt": die zitierte Zeile
    // SELBST zeigt weiter echtes `<strong>`. Sonst hätte man die Marker global
    // ausgebaut statt sie an der richtigen Stelle zu entfernen.
    await expect(zeile(page, mZiel).locator('.chat-content strong')).toHaveText('wichtig')
})

// ── 4) Die Grenze am Knoten — bewusst so, kein Wunsch ───────────────────────────────

/**
 * **Dieser Test hält eine GRENZE fest, keine Zusage.**
 *
 * `applyInlineMarkup` arbeitet je Text-Knoten (Begründung im Kopf von `chatMarkup.ts`:
 * auf ESCAPTEM HTML, und nur dort, wo kein fremdes Markup mitkommt). welshman zerlegt
 * `**Schaut auf nostr:npub1… und das**` in drei Knoten — Text, Profil, Text —, die
 * beiden Sterne landen also in verschiedenen Knoten und finden einander nie. Die
 * Hervorhebung bleibt aus, die Sterne bleiben sichtbar stehen.
 *
 * Das ist der ehrliche Preis eines Ansatzes, der bewusst kein Dokument-Modell aufbaut.
 * Der Test steht hier, damit die Grenze eine ENTSCHEIDUNG bleibt: wer sie eines Tages
 * verschiebt, muss diesen Fall bewusst umschreiben statt ihn beiläufig „grün zu
 * machen". Ein Rückbau auf Rohtext-Verarbeitung — die naheliegende „Lösung" — würde
 * die Sicherheitsgrenze aufheben, auf der die ganze Schicht steht.
 */
test('Grenze am Knoten: eine Erwähnung mitten in der Hervorhebung lässt sie AUS — bewusst so', async ({ page }) => {
    const h = trackRoom(`mk4${rnd()}`)
    createRoomNak(h, 'MK4')

    const npub = npubEncode(ADMIN_PUB)
    const mGrenze = `MKGrenze-${rnd()}`
    const mGegen = `MKGegen-${rnd()}`
    publishRaw(h, `${mGrenze} **Schaut auf nostr:${npub} und das**`)
    // Gegenprobe im selben Raum: dieselbe Hervorhebung OHNE Erwähnung greift. Damit
    // steht fest, dass der Knoten die Ursache ist und nicht etwa der Satzbau.
    publishRaw(h, `${mGegen} **Schaut auf das und das**`)

    await openRoom(page, h)
    await expect(page.getByText(mGrenze, { exact: false })).toBeVisible({ timeout: 15_000 })

    const grenze = zeile(page, mGrenze).locator('.chat-content')
    await expect(grenze.locator('strong'), 'über Knotengrenzen hinweg wird NICHT ausgezeichnet').toHaveCount(0)
    // Die Sterne bleiben sichtbar — der Text verliert nichts, er wird nur nicht fett.
    await expect(grenze).toHaveText(`${mGrenze} **Schaut auf @Relay Admin und das**`, { timeout: 15_000 })
    // Die Erwähnung selbst funktioniert unverändert.
    await expect(grenze.locator('.mention')).toHaveText(['@Relay Admin'])

    await expect(zeile(page, mGegen).locator('.chat-content strong')).toHaveText('Schaut auf das und das')
})

// ── 5) Ein Skript-Versuch neben einer Auszeichnung ──────────────────────────────────

/**
 * Die Pure-Tests prüfen das auf Zeichenketten-Ebene; hier zählt der gerenderte Baum.
 * `applyInlineMarkup` läuft NACH welshmans Escaping — zu dem Zeitpunkt ist aus `<` ein
 * `&lt;` geworden, und die Funktion fügt nur ihre eigenen festen Tags ein. Der Test
 * misst genau diese Reihenfolge: bräche sie (Auszeichnung auf Rohtext), stünde hier ein
 * echtes `<script>` im Baum.
 */
test('Ein Skript-Versuch bleibt Text — und die Auszeichnung daneben greift trotzdem', async ({ page }) => {
    const h = trackRoom(`mk5${rnd()}`)
    createRoomNak(h, 'MK5')

    const mSkript = `MKSkript-${rnd()}`
    publishRaw(h, `${mSkript} <script>alert(1)</script> **fett**`)

    await openRoom(page, h)
    await expect(page.getByText(mSkript, { exact: false })).toBeVisible({ timeout: 15_000 })

    const inhalt = zeile(page, mSkript).locator('.chat-content')
    // Der Versuch steht als LESBARER Text da — nicht verschluckt, nicht ausgeführt.
    await expect(inhalt).toContainText('<script>alert(1)</script>', { timeout: 15_000 })
    expect(
        await inhalt.evaluate((el) => el.querySelectorAll('script').length),
        'kein Skript-Element im gerenderten Baum',
    ).toBe(0)
    // `innerHTML` statt nur Textprüfung: ein escaptes `&lt;script&gt;` und ein echtes
    // `<script>` sehen im `textContent` identisch aus.
    expect(
        await inhalt.evaluate((el) => el.innerHTML.includes('&lt;script&gt;')),
        'die spitzen Klammern müssen escapt im Markup stehen',
    ).toBe(true)
    // Und die Auszeichnung daneben greift trotzdem.
    await expect(inhalt.locator('strong')).toHaveText('fett')
})
