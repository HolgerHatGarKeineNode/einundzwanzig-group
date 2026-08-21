/**
 * Pure-Tests der PRÄVENTION (Playwright-frei).
 *   node --test --experimental-strip-types tests/e2e/support/hermetik.nodetest.ts
 *
 * Zwei Dinge werden hier geprüft und ein drittes ausdrücklich nicht:
 *
 * 1. **Die Entscheidung** — welche Herkunft gilt als loopback. Fail-closed: alles
 *    Unbekannte fällt nach „fremd".
 * 2. **Die Regel-ZEICHENKETTE** für Chromium. Sie ist kein Kosmetikum: ihre Reihenfolge
 *    und die IPv6-Schreibweise sind gemessene Eigenschaften (siehe `hermetik.ts`), und
 *    beide Fehler wären STILL — Chromium parst die falsche Regel klaglos und tut nichts.
 * 3. Ob Chromium sich daran hält, kann hier nicht stehen: das ist die Aufgabe von
 *    `relay-praevention.spec.ts`, das den Gegenbeweis gegen einen echten lokalen
 *    Sonden-Server fährt. Ein Nodetest über eine Zeichenkette ist eine Zusage, kein Beleg.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
    LOOPBACK_HOSTS,
    MELDE_BINDUNG,
    SCHATTEN_SONDE_HOST,
    SONDE_HOST,
    SPERR_MARKE,
    alsResolverName,
    chromiumHermetikArgs,
    hostResolverRegel,
    istLoopbackHerkunft,
    istLoopbackHost,
    sperrVermerk,
    wrapperQuelle,
} from './hermetik.ts'
import { erlaubteHerkuenfte, herkunft } from './relayGuard.ts'

// ── Die Konstanten als LITERAL ───────────────────────────────────────────────────────
//
// Ohne diesen Fall prüften alle folgenden Zusicherungen die Konstanten gegen sich selbst
// und blieben grün, wenn jemand `LOOPBACK_HOSTS` um `nostr.einundzwanzig.space` ergänzt.
test('die Konstanten stehen ausgeschrieben — nicht gegen sich selbst geprüft', () => {
    assert.deepEqual([...LOOPBACK_HOSTS], ['localhost', '127.0.0.1', '[::1]'])
    assert.equal(SPERR_MARKE, 'HERMETIK-SPERRE')
    assert.equal(SONDE_HOST, 'relay-sonde.invalid')
    assert.equal(SCHATTEN_SONDE_HOST, 'relay-sonde-beschattet.invalid')
})

test('istLoopbackHost: die drei erlaubten Schreibweisen, groß wie klein', () => {
    assert.equal(istLoopbackHost('localhost'), true)
    assert.equal(istLoopbackHost('LOCALHOST'), true)
    assert.equal(istLoopbackHost('127.0.0.1'), true)
    assert.equal(istLoopbackHost('[::1]'), true)
})

// Die Ausfallrichtung. Jeder Eintrag hier ist eine Schreibweise, mit der ein Fremder
// versucht, wie ein Loopback auszusehen — dieselbe Klasse, die der `security-auditor` in
// P0 gegen `erlaubteHerkuenfte` gefahren hat (31 Schreibweisen).
test('istLoopbackHost: alles andere ist fremd — auch was danach aussieht', () => {
    for (const fremd of [
        'nostr.einundzwanzig.space',
        'localhost.evil.example',
        'evil-localhost',
        'notlocalhost',
        '127.0.0.1.evil.example',
        '0.0.0.0',
        '127.0.0.2',
        'localhost.',
        '::1',
        '',
        '2130706433',
    ]) {
        assert.equal(istLoopbackHost(fremd), false, `„${fremd}" darf NICHT als loopback gelten`)
    }
})

// ── Die Freigabe darf nie weiter reichen als die Prävention ──────────────────────────
//
// `relayWaechter.erlaube()` prüfte bis P6 nur die LESBARKEIT der URL; eine Zeile
// `erlaube('wss://nostr.einundzwanzig.space/')` im Test hätte den einzigen Riegel gegen
// den Produktions-Relay abgeschaltet. Diese Fälle halten die Verengung fest.
test('istLoopbackHerkunft: die Freigabe gilt nur fürs Loopback', () => {
    assert.equal(istLoopbackHerkunft('localhost:3335'), true)
    assert.equal(istLoopbackHerkunft('127.0.0.1:8137'), true)
    assert.equal(istLoopbackHerkunft('[::1]:3335'), true)
    assert.equal(istLoopbackHerkunft('nostr.einundzwanzig.space:443'), false)
    assert.equal(istLoopbackHerkunft('localhost.evil.example:443'), false)
    assert.equal(istLoopbackHerkunft('localhost'), false, 'ohne Port ist es keine Herkunft')
    assert.equal(istLoopbackHerkunft(''), false)
})

// Die beiden Module müssen zueinander passen: was der Wächter ohne Nachfrage erlaubt,
// muss die Prävention durchlassen. Sonst gibt es eine Herkunft, die der eine erlaubt und
// die andere sperrt — und der Test wäre grün über eine Verbindung, die nie stattfand.
test('jede Herkunft der Wächter-Erlaubnisliste ist für die Prävention loopback', () => {
    const liste = erlaubteHerkuenfte({ slot: 0 })
    assert.ok(liste.length > 0, 'leere Erlaubnisliste — diese Sonde misst dann nichts')
    for (const h of liste) {
        assert.equal(istLoopbackHerkunft(h), true, `${h} wäre vom Wächter erlaubt, von der Prävention gesperrt`)
    }
})

// Und die Gegenrichtung, an der echten URL-Zerlegung des Wächters entlang: der
// Produktions-Relay dieses Vorhabens fällt durch beide Siebe.
test('der Produktions-Relay fällt durch beide Siebe', () => {
    const h = herkunft('wss://nostr.einundzwanzig.space/')
    assert.equal(h, 'nostr.einundzwanzig.space:443')
    assert.equal(istLoopbackHerkunft(h as string), false)
    assert.equal(istLoopbackHost('nostr.einundzwanzig.space'), false)
})

// `::1` ohne Klammern ist auf der URL-Ebene bewusst FREMD: `new URL(...).hostname` liefert
// für IPv6 immer die Klammerform. Ein nackter `::1` kann dort also gar nicht herkommen —
// er stünde für eine handgeschriebene Erlaubnis, und die soll nicht durchrutschen. Für
// Chromiums Resolver gilt die umgekehrte Schreibweise; das ist diese Übersetzung.
test('alsResolverName: die Übersetzung zwischen URL- und Resolver-Schreibweise', () => {
    assert.equal(alsResolverName('[::1]'), '::1')
    assert.equal(alsResolverName('localhost'), 'localhost')
    assert.equal(alsResolverName('127.0.0.1'), '127.0.0.1')
})

test('hostResolverRegel: die Sonden-MAP steht VOR der Sperre, sonst gewinnt die Sperre', () => {
    const regel = hostResolverRegel()
    const sonde = regel.indexOf(`MAP ${SONDE_HOST} 127.0.0.1`)
    const sperre = regel.indexOf('MAP * ~NOTFOUND')
    assert.notEqual(sonde, -1, 'die Sonden-MAP fehlt — der Gegenbeweis prüfte dann nur das DNS')
    assert.notEqual(sperre, -1, 'die Sperre fehlt — die Regel wäre wirkungslos')
    assert.ok(sonde < sperre, `Reihenfolge verdreht: MAP * ~NOTFOUND gewinnt als erste Übereinstimmung (${regel})`)

    // Und der beschattete Zwilling steht DAHINTER — genau darum ist er wirkungslos, und
    // genau darum macht er die Sperre im Gegenbeweis messbar. Wandert er nach vorn, wird
    // aus dem Prüfstein ein Loch: der Name löste dann tatsächlich auf.
    const schatten = regel.indexOf(`MAP ${SCHATTEN_SONDE_HOST} 127.0.0.1`)
    assert.notEqual(schatten, -1, 'der beschattete Zwilling fehlt — die Resolver-Sperre wäre unmessbar')
    assert.ok(schatten > sperre, `der Zwilling steht VOR der Sperre und ist damit wirksam (${regel})`)
})

// Die Schreibweise der IPv6-Ausnahme, ausgeschrieben. Gemessen am 2026-08-21: mit
// Klammern wirkt die Ausnahme NICHT (ein auf `::1` lauschender Server war dann
// ERR_NAME_NOT_RESOLVED), ohne Klammern wirkt sie. Der Fehler wäre still.
test('hostResolverRegel: loopback ist ausgenommen, IPv6 OHNE Klammern', () => {
    const regel = hostResolverRegel()
    assert.ok(regel.includes('EXCLUDE localhost'), regel)
    assert.ok(regel.includes('EXCLUDE 127.0.0.1'), regel)
    assert.ok(regel.includes('EXCLUDE ::1'), regel)
    assert.ok(!regel.includes('EXCLUDE [::1]'), `mit Klammern wirkungslos: ${regel}`)
})

test('chromiumHermetikArgs trägt die Regel und das Sandbox-Flag', () => {
    const args = chromiumHermetikArgs()
    assert.ok(args.includes('--no-sandbox'), args.join(' '))
    assert.ok(
        args.some((a) => a === `--host-resolver-rules=${hostResolverRegel()}`),
        args.join(' '),
    )
})

// ── Die VERDRAHTUNG, nicht nur die Regel ─────────────────────────────────────────────
//
// Eine perfekte Regel, die niemand an Chromium reicht, ist genau das Loch, das dieser
// Auftrag schließen soll. Die beiden folgenden Fälle lesen die echten Dateien.
//
// Die Sonde ist fail-closed: findet sie ihren Gegenstand nicht, wirft sie, statt still
// „nichts gefunden, also in Ordnung" zu melden.
const lies = (pfad: string): string => {
    const inhalt = readFileSync(new URL(pfad, import.meta.url), 'utf8')
    assert.ok(inhalt.length > 0, `${pfad} ist leer — diese Sonde misst dann nichts`)

    return inhalt
}

test('playwright.config.ts reicht die Argumente an JEDES Projekt', () => {
    const config = lies('../../../playwright.config.ts')
    // Auf den AUFRUF gemustert, nicht auf den Namen: eine stehen gebliebene Importzeile
    // erfüllt `/chromiumHermetikArgs/` auch dann noch, wenn `args:` längst wieder ein
    // Literal ist — die Mutationsprobe hat genau das durchgehen lassen (2026-08-21).
    assert.match(config, /args: chromiumHermetikArgs\(\),/, 'die Start-Argumente kommen nicht aus hermetik.ts')
    assert.match(config, /from '\.\/tests\/e2e\/support\/hermetik(\.ts)?'/, 'kein Import aus hermetik.ts')
    // Positivkontrolle für die Sonde selbst: der Scanner liest wirklich diese Datei.
    assert.match(config, /executablePath: '\/bin\/chromium'/, 'die gelesene Datei ist nicht die Playwright-Config')
    // Beide Projekte teilen sich EIN `hostChromium`-Objekt; wer ein drittes Projekt
    // anlegt und es dort vergisst, hat einen unbewachten Browser.
    assert.equal(
        (config.match(/^\s+\.\.\.hostChromium,$/gm) ?? []).length,
        (config.match(/^\s+name: '\w+',$/gm) ?? []).length,
        'nicht jedes Projekt zieht `hostChromium` — ein Projekt fährt ohne Prävention',
    )
})

test('fixtures.ts verdrahtet den Wrapper je Kontext und meldet die Sperre', () => {
    const fixtures = lies('./fixtures.ts')
    // Auf den AUFRUF gemustert, nicht auf den Namen — eine stehen gebliebene Importzeile
    // hat diese Sonde am 2026-08-21 schon einmal grün gehalten.
    assert.match(fixtures, /await context\.addInitScript\(\{/, 'kein Wrapper je Kontext')
    assert.match(fixtures, /content: wrapperQuelle\(\{/, 'der Wrapper kommt nicht aus hermetik.ts')
    assert.match(fixtures, /await context\.exposeBinding\(MELDE_BINDUNG/, 'die Sperre kann nicht melden')
    assert.match(fixtures, /sperrVermerk\(url\)/, 'die Meldung landet nicht in der Aufzeichnung')

    // **Und ausdrücklich NICHT `routeWebSocket`.** Es hat funktioniert und war trotzdem
    // falsch: es ersetzt `window.WebSocket` für die ganze Seite durch eine Attrappe und
    // machte den Buzz-Arm rot (Herleitung im Kopf von `hermetik.ts`). Ohne diese Zeile
    // wäre der nächste Griff danach wieder der naheliegende.
    // Auf den AUFRUF, nicht auf das Wort: die Begründung, warum es NICHT benutzt wird,
    // steht im Docblock derselben Datei und darf dort stehen bleiben.
    assert.ok(
        !/context\.routeWebSocket\(/.test(fixtures),
        'routeWebSocket ist zurück — es legt eine WebSocket-Attrappe über JEDE Seite, siehe hermetik.ts',
    )
})

test('sperrVermerk nennt die URL und bleibt für den Wächter ein Verstoß', () => {
    const vermerk = sperrVermerk('wss://nostr.einundzwanzig.space/')
    assert.ok(vermerk.includes('wss://nostr.einundzwanzig.space/'), vermerk)
    assert.ok(vermerk.includes(SPERR_MARKE), vermerk)
})

// ── Der Wrapper-Quelltext ────────────────────────────────────────────────────────────
//
// Er geht als STRING in die Seite (Playwright serialisiert ihn), lässt sich hier also
// nicht ausführen — prüfbar ist seine FORM. Die drei Fälle unten sind genau die
// Eigenschaften, an denen die verworfene `routeWebSocket`-Variante gescheitert ist.
test('wrapperQuelle: erlaubte Sockets gehen in die NATIVE Implementierung', () => {
    const quelle = wrapperQuelle({ erlaubteHosts: LOOPBACK_HOSTS, marke: SPERR_MARKE, bindung: MELDE_BINDUNG })
    // `Reflect.construct(ziel, …)` auf dem ORIGINAL — nicht ein Nachbau, nicht eine
    // Attrappe. Fehlt das, fährt die Seite eine fremde WebSocket-Implementierung.
    assert.match(quelle, /Reflect\.construct\(ziel, argumente\)/)
    assert.match(quelle, /new Proxy\(Original,/)
    // Die Hosts stehen als Literal in der Quelle — der Wrapper kann nichts aus diesem
    // Modul nachschlagen, er läuft in der Seite.
    for (const host of LOOPBACK_HOSTS) {
        assert.ok(quelle.includes(JSON.stringify(host)), `${host} fehlt im Wrapper: ${quelle}`)
    }
    assert.ok(!quelle.includes('nostr.einundzwanzig.space'), 'eine fremde Herkunft steht im Wrapper')
})

test('wrapperQuelle: erst melden, dann werfen — und der Wurf hängt nicht an der Meldung', () => {
    const quelle = wrapperQuelle({ erlaubteHosts: LOOPBACK_HOSTS, marke: SPERR_MARKE, bindung: MELDE_BINDUNG })
    const meldung = quelle.indexOf(MELDE_BINDUNG)
    const wurf = quelle.indexOf('throw new Error')
    assert.notEqual(meldung, -1, 'der Wrapper meldet nicht — die Sperre wäre still')
    assert.notEqual(wurf, -1, 'der Wrapper wirft nicht — er verhindert dann gar nichts')
    assert.ok(meldung < wurf, 'gemeldet wird nach dem Wurf, also nie')
    // Die Meldung liegt in einem eigenen try/catch: eine fehlende Bindung (fremder
    // Kontext, früher Zeitpunkt) darf die SPERRE nicht aushebeln.
    assert.match(quelle, /try \{[^}]*MELDE|try \{\s*\n\s*window\[/)
})
