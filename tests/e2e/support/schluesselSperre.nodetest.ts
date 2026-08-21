/**
 * Tests des Schlüssel-Riegels (`schluesselSperre.ts` + seine Auswertung in `keys.ts`).
 *   node --test --experimental-strip-types tests/e2e/support/schluesselSperre.nodetest.ts
 *
 * Der Riegel ist der einzige der vier Schichten, der **unabhängig von jedem Netzpfad**
 * greift — er fragt nicht, wohin geschrieben wird, sondern womit. Genau deshalb muss
 * seine Ausfallrichtung geprüft sein: ein Riegel, der bei unklarer Lage durchwinkt, ist
 * an dem Tag wertlos, an dem er gebraucht wird.
 *
 * **Die Umgebung wird hier immer explizit übergeben.** Kein Fall liest `process.env`:
 * die Tests wären sonst vom `.env` des jeweiligen Rechners abhängig, also grün oder rot
 * je nach Maschine — und ein Fall, der auf dem Rechner des Autors nicht greift, ist kein
 * Riegel, sondern eine Erinnerung.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { nsecEncode } from 'nostr-tools/nip19'
import {
    PRODUKTIONS_SCHREIBER,
    TEST_SCHLUESSEL_VARIABLE,
    kurz,
    nsecVariablen,
    sperrMeldung,
    sperrTreffer,
} from './schluesselSperre.ts'
import { gesperrteSchreiber, pruefeTestschluessel } from './keys.ts'
import { readFileSync } from 'node:fs'

/** Ein frisches Schlüsselpaar als `{ nsec, pk }` — nie ein Wert aus der echten Umgebung. */
const paar = (): { nsec: string; pk: string } => {
    const sk = generateSecretKey()

    return { nsec: nsecEncode(sk), pk: getPublicKey(sk) }
}

test('die Konstanten stehen ausgeschrieben', () => {
    assert.equal(TEST_SCHLUESSEL_VARIABLE, 'NOSTR_TEST_NSEC')
    // Leer ist hier eine AUSSAGE: im Repo steht kein verifizierter Produktions-Pubkey,
    // und ein geratener Eintrag wäre ein Riegel ohne Deckung. Wächst die Liste, muss
    // dieser Fall angefasst werden — genau das ist der Zweck.
    assert.deepEqual([...PRODUKTIONS_SCHREIBER], [])
})

test('nsecVariablen: jede *_NSEC außer dem Testschlüssel, egal wie sie heißt', () => {
    const gefunden = nsecVariablen({
        NOSTR_TEST_NSEC: 'nsec1test',
        NOSTR_BOT_NSEC: 'nsec1bot',
        NOSTR_ANNOUNCE_NSEC: 'nsec1kuenftig',
        NOSTR_BOT_RELAY: 'wss://irgendwo',
        APP_KEY: 'egal',
    })
    // Der künftige Schlüssel ist der Punkt: die Liste wird über das NAMENSMUSTER gewonnen,
    // nicht aufgezählt. Eine Aufzählung ist genau die Bauform, an der die ENV-Riegel in
    // P0 (`NOSTR_BOARD_URL`) und P5 (`NOSTR_WORKSPACE_URL`) je einmal gescheitert sind.
    assert.deepEqual(gefunden, ['NOSTR_ANNOUNCE_NSEC', 'NOSTR_BOT_NSEC'])
})

test('nsecVariablen: eine gesetzte, aber LEERE Variable ist kein Schlüssel', () => {
    assert.deepEqual(nsecVariablen({ NOSTR_BOT_NSEC: '' }), [])
    assert.deepEqual(nsecVariablen({ NOSTR_BOT_NSEC: undefined }), [])
})

test('sperrTreffer: Groß-/Kleinschreibung des Hex darf nicht vorbeigreifen', () => {
    const pk = 'ABCDEF0123456789abcdef0123456789abcdef0123456789abcdef0123456789'
    assert.equal(sperrTreffer(pk.toLowerCase(), [{ pk, quelle: 'Handeintrag' }]).length, 1)
    assert.equal(sperrTreffer(pk, [{ pk: pk.toLowerCase(), quelle: 'Handeintrag' }]).length, 1)
    assert.equal(sperrTreffer('00', [{ pk, quelle: 'Handeintrag' }]).length, 0)
})

test('gesperrteSchreiber gewinnt die Liste aus der Umgebung', () => {
    const bot = paar()
    const liste = gesperrteSchreiber({ NOSTR_BOT_NSEC: bot.nsec, NOSTR_TEST_NSEC: paar().nsec })
    assert.deepEqual(liste, [{ pk: bot.pk, quelle: 'NOSTR_BOT_NSEC' }])
})

test('gesperrteSchreiber: ein unlesbarer Wert kippt nicht den ganzen Riegel', () => {
    const bot = paar()
    const liste = gesperrteSchreiber({ NOSTR_KAPUTT_NSEC: 'kein-nsec', NOSTR_BOT_NSEC: bot.nsec })
    assert.deepEqual(
        liste.map((e) => e.quelle),
        ['NOSTR_BOT_NSEC'],
        'ein kaputter Wert daneben darf die übrigen nicht verschlucken',
    )
})

// ── Der eigentliche Riegel ───────────────────────────────────────────────────────────

test('pruefeTestschluessel BRICHT AB, wenn der Testschlüssel der Bot-Schlüssel ist', () => {
    const bot = paar()
    assert.throws(
        () => pruefeTestschluessel({ NOSTR_BOT_NSEC: bot.nsec, NOSTR_TEST_NSEC: bot.nsec }),
        (fehler: Error) => {
            assert.match(fehler.message, /PRODUKTION/)
            assert.match(fehler.message, /NOSTR_BOT_NSEC/)
            // Und niemals das Schlüsselmaterial selbst — weder das nsec noch der volle
            // Pubkey. Ein Secret, das durch ein Transkript läuft, gilt als kompromittiert.
            assert.ok(!fehler.message.includes(bot.nsec), 'die Meldung trägt das nsec')
            assert.ok(!fehler.message.includes(bot.pk), 'die Meldung trägt den vollen Pubkey')
            assert.ok(fehler.message.includes(kurz(bot.pk)), 'die Meldung nennt nicht einmal den gekürzten Pubkey')

            return true
        },
    )
})

test('pruefeTestschluessel greift auch über einen Handeintrag der Liste', () => {
    // Die Mechanik von PRODUKTIONS_SCHREIBER, mit einer literalen Beispielliste geprüft —
    // die ausgelieferte Liste ist leer, ihre Wirkung wäre sonst unbelegt.
    const test = paar()
    const liste = [{ pk: test.pk, quelle: 'Beispiel-Handeintrag' }]
    assert.equal(sperrTreffer(test.pk, liste).length, 1)
    assert.match(sperrMeldung(liste), /Beispiel-Handeintrag/)
})

test('pruefeTestschluessel lässt einen Wegwerf-Schlüssel durch', () => {
    assert.doesNotThrow(() => pruefeTestschluessel({ NOSTR_BOT_NSEC: paar().nsec, NOSTR_TEST_NSEC: paar().nsec }))
})

// Die Ausfallrichtung, Fall für Fall — jede Zeile hier ist eine Entscheidung, die man
// sonst erst im Ernstfall bemerkt.
test('pruefeTestschluessel: fehlende Variable schweigt, kaputte wirft', () => {
    // Fehlt der Testschlüssel, wirft `testKeys()` später mit der besseren Meldung.
    assert.doesNotThrow(() => pruefeTestschluessel({}))
    assert.doesNotThrow(() => pruefeTestschluessel({ NOSTR_TEST_NSEC: '' }))
    // Ein gesetzter, unlesbarer Wert dagegen heißt: der Riegel könnte nichts vergleichen.
    // Still durchwinken wäre hier der teuerste Zustand.
    assert.throws(
        () => pruefeTestschluessel({ NOSTR_TEST_NSEC: 'nsec-kaputt' }),
        /kein lesbarer nsec/,
        'ein unlesbarer Testschlüssel muss den Lauf anhalten',
    )
    // Und ein npub statt eines nsec ist derselbe Fall — lesbar, aber falscher Typ.
    assert.throws(
        () => pruefeTestschluessel({ NOSTR_TEST_NSEC: 'npub1w0rawe7ug9dmz59qpczxqfxk6xr8wmw2suee2gmtvhy8lzs2v9zqzk0m0j' }),
        /kein lesbarer nsec/,
    )
})

// ── Die VERDRAHTUNG ──────────────────────────────────────────────────────────────────

test('global-setup ruft den Riegel — und zwar VOR allem anderen', () => {
    const setup = readFileSync(new URL('./global-setup.ts', import.meta.url), 'utf8')
    // Fail-closed: eine leere Datei bestünde jedes `includes`.
    assert.ok(setup.length > 0, 'global-setup.ts ist leer — diese Sonde misst nichts')

    // Auf den AUFRUF gemustert, nicht auf den Namen — dieselbe Bauform wie in
    // `serverEnv.nodetest.ts` und `hermetik.nodetest.ts`. Ein `indexOf` auf den blossen
    // Bezeichner findet ihn auch in `// pruefeTestschluessel()`, und genau das ist der
    // realistische Ausfall: jemand kommentiert den Riegel zum Debuggen aus und stellt ihn
    // nicht zurück. Gemessen am 2026-08-21: mit dem Namensmuster blieb die Suite bei
    // auskommentiertem Aufruf 11/11 grün, während der Riegel gar nicht mehr lief.
    const aufruf = setup.search(/^[^\n/]*\bpruefeTestschluessel\(\)/m)
    assert.notEqual(aufruf, -1, 'der Schlüssel-Riegel läuft im E2E-Lauf gar nicht (kein AUFRUF gefunden)')

    // Die Reihenfolge ist die halbe Aussage: ein Abbruch NACH dem Aufsetzen eines Relays
    // hinterließe bereits Zustand, und ein Riegel irgendwo in der Mitte rutscht bei der
    // nächsten Umstellung unbemerkt hinter etwas.
    const rumpf = setup.indexOf('export default function globalSetup')
    const relais = Math.min(
        ...['zooid-testserver.sh', 'ownedRunMarkerPaths', "execFileSync('npm'"]
            .map((marke) => setup.indexOf(marke))
            .filter((stelle) => stelle > rumpf),
    )
    assert.ok(aufruf > rumpf, 'der Aufruf steht außerhalb von globalSetup')
    assert.ok(aufruf < relais, 'der Schlüssel-Riegel läuft erst NACH dem Aufsetzen der Infrastruktur')
})
