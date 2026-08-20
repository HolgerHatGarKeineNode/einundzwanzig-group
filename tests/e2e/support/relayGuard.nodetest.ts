/**
 * Pure-Tests des Relay-Wächters (Playwright-frei).
 *   node --test --experimental-strip-types tests/e2e/support/relayGuard.nodetest.ts
 *
 * Der Wächter ist selbst ein Tor, und ein Tor ohne eigene Prüfung ist eine Behauptung.
 * Geprüft wird deshalb vor allem die AUSFALLRICHTUNG: jeder Zweifelsfall muss nach
 * „Verstoß" fallen, nicht nach „durch". Ein Wächter, der bei unlesbarer Eingabe schweigt,
 * ist schlimmer als keiner — er erzeugt Vertrauen ohne Deckung.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    BUZZ_BASE_PORT,
    ZOOID_BASE_PORT,
    erlaubteHerkuenfte,
    herkunft,
    verstoesse,
    verstossMeldung,
} from './relayGuard.ts'

// ── Die Basisports als LITERAL ───────────────────────────────────────────────────────
//
// Ohne diesen Fall halten alle übrigen Zusicherungen `ZOOID_BASE_PORT` gegen
// `ZOOID_BASE_PORT` und wären gegen eine Änderung der Konstante blind — dieselbe Lücke,
// an der `DEFAULT_SPACES_TAB` eine Mutation von 'rooms' auf 'threads' 5/5 grün überstand
// (Gegenmittel und Begründung: `packages/einundzwanzig-group/js/spacesTab.test.ts:37-42`).
// Die Zahlen stehen an vier weiteren Stellen im Repo (support/zooid.ts, support/buzz.ts,
// support/runMarkers.ts, zooid-testserver.sh); wandert eine, muss dieser Test reden.
test('die Basisports sind die des Repos — als Literal, nicht gegen sich selbst geprüft', () => {
    assert.equal(ZOOID_BASE_PORT, 3335)
    assert.equal(BUZZ_BASE_PORT, 3001)
})

test('herkunft: dieselbe Instanz in allen vier Schreibweisen ergibt EINE Herkunft', () => {
    assert.equal(herkunft('ws://localhost:3335'), 'localhost:3335')
    assert.equal(herkunft('ws://localhost:3335/'), 'localhost:3335')
    assert.equal(herkunft('ws://localhost:3335/pfad?x=1'), 'localhost:3335')
    assert.equal(herkunft('WS://LocalHost:3335/'), 'localhost:3335')
})

test('herkunft: 127.0.0.1 ist eine EIGENE Herkunft — kein stilles Aliasing auf localhost', () => {
    // Beide stehen ausdrücklich auf der Erlaubnisliste (siehe unten). Sie hier
    // gleichzusetzen wäre bequem und würde eine Aussage verschenken: wer sie aliast,
    // kann nicht mehr sehen, dass eine Fläche plötzlich die andere Schreibweise nimmt.
    assert.equal(herkunft('ws://127.0.0.1:3335/'), '127.0.0.1:3335')
    assert.notEqual(herkunft('ws://127.0.0.1:3335/'), herkunft('ws://localhost:3335/'))
})

test('herkunft: fehlender Port wird aus dem Schema ergänzt (wss ⇒ 443)', () => {
    assert.equal(herkunft('wss://nostr.einundzwanzig.space/'), 'nostr.einundzwanzig.space:443')
    assert.equal(herkunft('ws://relay.example/'), 'relay.example:80')
})

test('herkunft: unlesbare Eingaben liefern null — der Aufrufer wertet das als Verstoß', () => {
    for (const müll of ['', 'kein-url', '://', 'ws://', 'wss://', '   ']) {
        assert.equal(herkunft(müll), null, JSON.stringify(müll))
    }
})

test('erlaubteHerkuenfte: der EIGENE Slot, beide Arme, beide Schreibweisen', () => {
    assert.deepEqual(erlaubteHerkuenfte({ slot: 0 }), [
        'localhost:3335',
        '127.0.0.1:3335',
        'localhost:3001',
        '127.0.0.1:3001',
    ])
    assert.deepEqual(erlaubteHerkuenfte({ slot: 3 }), [
        'localhost:3338',
        '127.0.0.1:3338',
        'localhost:3004',
        '127.0.0.1:3004',
    ])
})

test('erlaubteHerkuenfte: der Slot des NACHBARN ist nicht erlaubt', () => {
    // Der teuerste stille Fall auf dieser Maschine: zwei Suiten gleichzeitig auf
    // verschiedenen `E2E_SLOT_OFFSET`. Ein Test, der den zooid des Nachbarn anspricht,
    // misst dessen Zustand mit — und beide Läufe sind danach unerklärlich.
    const erlaubt = erlaubteHerkuenfte({ slot: 0 })
    assert.equal(erlaubt.includes('localhost:3336'), false)
    assert.deepEqual(verstoesse(['ws://localhost:3336/'], erlaubt), ['ws://localhost:3336/'])
})

test('verstoesse: der eigene Relay in jeder Schreibweise geht durch', () => {
    const erlaubt = erlaubteHerkuenfte({ slot: 2 })
    assert.deepEqual(
        verstoesse(['ws://localhost:3337', 'ws://localhost:3337/', 'ws://127.0.0.1:3337/', 'ws://localhost:3003/'], erlaubt),
        [],
    )
})

test('verstoesse: der Produktions-Relay ist ein Verstoß — der Anlassfall dieses Wächters', () => {
    assert.deepEqual(
        verstoesse(['ws://localhost:3335/', 'wss://nostr.einundzwanzig.space/'], erlaubteHerkuenfte({ slot: 0 })),
        ['wss://nostr.einundzwanzig.space/'],
    )
})

test('verstoesse: unlesbare URL fällt nach VERSTOSS, nicht nach durch', () => {
    assert.deepEqual(verstoesse(['nicht-mal-eine-url'], erlaubteHerkuenfte({ slot: 0 })), ['nicht-mal-eine-url'])
})

test('verstoesse: leere Erlaubnisliste verwirft ausnahmslos alles', () => {
    // Der Ausfall eines Wächters darf nicht „lässt alles durch" heißen. Wäre die
    // Erlaubnisliste je leer (Fehler in der Slot-Rechnung), fällt die ganze Suite auf —
    // laut und sofort statt still und für immer.
    assert.deepEqual(verstoesse(['ws://localhost:3335/'], []), ['ws://localhost:3335/'])
})

test('verstoesse: kein Socket ist kein Verstoß', () => {
    assert.deepEqual(verstoesse([], erlaubteHerkuenfte({ slot: 0 })), [])
})

test('verstoesse: dedupliziert, und der ERSTE Fremde steht vorn', () => {
    const erlaubt = erlaubteHerkuenfte({ slot: 0 })
    assert.deepEqual(
        verstoesse(
            ['wss://a.example/', 'ws://localhost:3335/', 'wss://b.example/', 'wss://a.example/'],
            erlaubt,
        ),
        ['wss://a.example/', 'wss://b.example/'],
    )
})

test('verstossMeldung nennt URL, Test und Erlaubnisliste — sonst kostet sie eine Debug-Runde', () => {
    const text = verstossMeldung('Reader: naddr-Kaltstart', ['wss://nostr.einundzwanzig.space/'], ['localhost:3335'])
    assert.match(text, /wss:\/\/nostr\.einundzwanzig\.space\//)
    assert.match(text, /Reader: naddr-Kaltstart/)
    assert.match(text, /localhost:3335/)
    assert.match(text, /relayWaechter\.erlaube/)
})
