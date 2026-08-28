/**
 * Pure-Tests des Laufzeit-Wächters (Playwright-frei).
 *   node --test --experimental-strip-types tests/e2e/support/pageErrorGuard.nodetest.ts
 *
 * Wie beim Relay-Wächter zählt vor allem die AUSFALLRICHTUNG: ein Fehler ohne passenden
 * Erlaubnis-Eintrag ist immer ein Verstoß, nie eine stille Ausnahme.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    istErlaubt,
    verstoesse,
    pageFehlerMeldung,
    istRauschen,
    ERLAUBNISLISTE,
    type ErlaubnisEintrag,
    type PageFehler,
} from './pageErrorGuard.ts'

const fehler = (text: string, quelle: PageFehler['quelle'] = 'pageerror'): PageFehler => ({ quelle, text })

test('istErlaubt: kein Eintrag ⇒ kein Fehler ist gedeckt', () => {
    assert.equal(istErlaubt(fehler('ReferenceError: pr is not defined'), 'irgendein Test', []), false)
})

test('istErlaubt: beide Muster müssen treffen — Titel allein reicht nicht', () => {
    const liste: ErlaubnisEintrag[] = [
        { titel: /Login: falsche Signatur/, text: /InvalidSignature/, begruendung: 'Testfall' },
    ]
    // Richtiger Test, aber unverwandter Fehlertext — bleibt Verstoß.
    assert.equal(istErlaubt(fehler('ReferenceError: pr is not defined'), 'Login: falsche Signatur', liste), false)
})

test('istErlaubt: Text allein reicht nicht — der Eintrag gilt nur für SEINEN Test', () => {
    const liste: ErlaubnisEintrag[] = [
        { titel: /Login: falsche Signatur/, text: /InvalidSignature/, begruendung: 'Testfall' },
    ]
    assert.equal(istErlaubt(fehler('InvalidSignature: xyz'), 'Ein völlig anderer Test', liste), false)
})

test('istErlaubt: Treffer nur, wenn Titel UND Text zugleich passen', () => {
    const liste: ErlaubnisEintrag[] = [
        { titel: /Login: falsche Signatur/, text: /InvalidSignature/, begruendung: 'Testfall' },
    ]
    assert.equal(istErlaubt(fehler('InvalidSignature: xyz'), 'Login: falsche Signatur — Arm A', liste), true)
})

test('verstoesse: der Anlassfall — ein ReferenceError ohne Erlaubnis bleibt ein Verstoß', () => {
    const treffer = verstoesse([fehler('pageerror: ReferenceError: pr is not defined')], 'Forge-Patches: Kurz-ID', [])
    assert.deepEqual(treffer, [fehler('pageerror: ReferenceError: pr is not defined')])
})

test('verstoesse: keine Beobachtung ⇒ kein Verstoß', () => {
    assert.deepEqual(verstoesse([], 'irgendein Test', []), [])
})

test('verstoesse: erlaubte und unerlaubte Fehler im selben Test werden getrennt beurteilt', () => {
    const liste: ErlaubnisEintrag[] = [
        { titel: /Fehlerpfad-Test/, text: /erwarteter Fehler/, begruendung: 'Testfall' },
    ]
    const treffer = verstoesse(
        [fehler('erwarteter Fehler: X'), fehler('ReferenceError: pr is not defined')],
        'Fehlerpfad-Test',
        liste,
    )
    assert.deepEqual(treffer, [fehler('ReferenceError: pr is not defined')])
})

test('verstoesse: dedupliziert NICHT — Häufung ist Teil der Diagnose', () => {
    const treffer = verstoesse(
        [fehler('ReferenceError: pr is not defined'), fehler('ReferenceError: pr is not defined')],
        'Forge-Patches: Liste',
        [],
    )
    assert.equal(treffer.length, 2)
})

test('pageFehlerMeldung nennt Test, Quelle und Text jedes Verstoßes', () => {
    const text = pageFehlerMeldung('Forge-Patches: Kurz-ID', [fehler('ReferenceError: pr is not defined')])
    assert.match(text, /Forge-Patches: Kurz-ID/)
    assert.match(text, /\[pageerror\] ReferenceError: pr is not defined/)
    assert.match(text, /ERLAUBNISLISTE/)
})

// ── istRauschen: die drei gemessenen Netzwerk-/Werkzeug-Muster ──────────────────────

test('istRauschen: "Failed to load resource" (Chromium, gescheiterter Ressourcen-Request)', () => {
    assert.equal(istRauschen('Failed to load resource: net::ERR_NAME_NOT_RESOLVED'), true)
    assert.equal(istRauschen('Failed to load resource: the server responded with a status of 400 (Bad Request)'), true)
})

test('istRauschen: "WebSocket connection to ... failed" (Chromium, gescheiterter Handshake)', () => {
    assert.equal(istRauschen("WebSocket connection to 'ws://127.0.0.1:8182/' failed: Error during WebSocket handshake: Unexpected response code: 200"), true)
})

test('istRauschen: "Failed to send logs" (Laravel Boosts BrowserLogger, Dev-Werkzeug)', () => {
    assert.equal(istRauschen('Failed to send logs: TypeError: Failed to fetch\n    at flushLogs (http://127.0.0.1:8187/forge:138:9)'), true)
})

test('istRauschen: ein echter Anwendungsfehler ist KEIN Rauschen — sonst filtert das Muster zu weit', () => {
    assert.equal(istRauschen('ReferenceError: pr is not defined'), false)
    assert.equal(istRauschen('Cannot read properties of null (reading \'showPanel\')'), false)
})

test('istRauschen wirkt NUR auf den Konsolentext, verstoesse() ruft es nicht auf pageerror an', () => {
    // pageErrorGuard.ts filtert Rauschen nicht selbst (das übernimmt fixtures.ts VOR der
    // Aufzeichnung) — dieser Fall hält fest, dass `verstoesse()` und `istRauschen()` zwei
    // unabhängige Funktionen sind, die eine bereits gefilterte Liste NICHT doppelt filtert.
    const treffer = verstoesse([fehler('Failed to load resource: net::ERR_FAILED', 'console')], 'irgendein Test', [])
    assert.deepEqual(treffer, [fehler('Failed to load resource: net::ERR_FAILED', 'console')])
})

// ── ERLAUBNISLISTE: jeder Eintrag trifft SEINEN eigenen Anlassfall ──────────────────

test('ERLAUBNISLISTE: die Positivkontrolle in forge-zeitleiste-knoten.spec.ts ist gedeckt', () => {
    const titel = 'chromium > forge-zeitleiste-knoten.spec.ts > Forge: der Knoten der Zeitleiste (P7b-N) > KONTROLLE: der Sammler sieht einen echten Alpine-Fehler'
    assert.equal(istErlaubt(fehler('gibtEsNichtUndWirftDeshalb is not defined'), titel, ERLAUBNISLISTE), true)
})

test('ERLAUBNISLISTE: der Anlassfall (showPanel-Bug in forge-ueberlauf.spec.ts) ist NICHT gedeckt', () => {
    // Bewusst kein Eintrag — das ist der gemeldete, nicht gefixte Produktfehler.
    const titel = 'chromium > forge-ueberlauf.spec.ts > der letzte Tab wird beim Fokussieren vollstaendig sichtbar (Tastatur-Erreichbarkeit, 320px)'
    assert.equal(istErlaubt(fehler("Cannot read properties of null (reading 'showPanel')"), titel, ERLAUBNISLISTE), false)
})

test('ERLAUBNISLISTE: beide Selbsttests des Wächters (page-error-guard.spec.ts) sind gedeckt', () => {
    const seite = 'chromium > page-error-guard.spec.ts > Standard-Seite: ein absichtlich ausgelöster Fehler wird beobachtet'
    const kontext = 'chromium > page-error-guard.spec.ts > Selbst angelegter Kontext (browser.newContext): ebenso beobachtet'
    assert.equal(istErlaubt(fehler('SELBSTTEST-page-error-guard'), seite, ERLAUBNISLISTE), true)
    assert.equal(istErlaubt(fehler('SELBSTTEST-page-error-guard'), kontext, ERLAUBNISLISTE), true)
})
