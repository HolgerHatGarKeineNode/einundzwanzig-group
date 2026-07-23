import { test, expect } from './support/fixtures'
import type { TrustedEvent } from '@welshman/util'
import { shouldPersistEvent, messagesToPrune, tombstonedIds } from '../../packages/einundzwanzig-group/js/storage'

/**
 * M3 P0 — Cache-Whitelist (`shouldPersistEvent`, §4.1/4.2). Reiner welshman-app-
 * freier Kern aus `storage.ts` — kein Browser, keine IndexedDB. Der IDB-Round-Trip
 * (put→getAll→load) reitet mit P1, sobald `initStorage()` im Bundle verdrahtet ist.
 */
const ev = (kind: number): TrustedEvent =>
    ({ id: `k${kind}`, pubkey: 'a', kind, created_at: 0, tags: [], content: '', sig: '' }) as TrustedEvent

// kind-9-Nachricht in Raum `h` mit created_at `ts`.
const msg = (id: string, h: string, ts: number): TrustedEvent =>
    ({ id, pubkey: 'a', kind: 9, created_at: ts, tags: [['h', h]], content: '', sig: '' }) as TrustedEvent

const NOW = 1_700_000_000
const DAY = 86_400

test.describe('shouldPersistEvent', () => {
    test('cacht Chat + Control-Plane + Deletes + Thread-Kommentare', () => {
        // Chat (der 13-s-Treiber) + kind 5 (sonst reappearen gelöschte Nachrichten).
        // Vollständige PERSIST_KINDS-Whitelist (15, inkl. 9005 ROOM_DELETE_EVENT) —
        // dieser Test ist bis P1 der EINZIGE Wächter.
        //
        // kind 1111 (NIP-22-Thread-Kommentar) ist mit P3 von der Verwerf- auf die
        // Cache-Liste GEWECHSELT und stand deshalb bis eben in beiden Tests: ohne ihn
        // überlebt kein Thread-Ungelesen-Marker den Kaltstart, weil die Ableitung
        // dieselbe (dann leere) `repository` liest. Bedingung dafür war eine Kappung —
        // Persistenz ohne Deckel wäre der unbegrenzt wachsende Store, vor dem §4.2
        // gewarnt hat; sie steht in `messagesToPrune` (`COMMENT_CAP_TOTAL`) und ist in
        // `js/storagePersistKinds.test.ts` node-getestet.
        for (const kind of [9, 1111, 5, 9005, 0, 3, 10000, 10002, 30078, 39000, 39001, 39002, 13534, 1068, 9041]) {
            expect(shouldPersistEvent(ev(kind)), `kind ${kind} sollte gecacht werden`).toBe(true)
        }
    })

    test('verwirft Ephemeral/AUTH/Reaktionen/Zaps', () => {
        // §4.2: kein `#h` / sekundär / laden lazy nach dem Paint. kind 1111 steht hier
        // seit P3 NICHT mehr (siehe oben) — Lotus' kind-10 (In-Chat-Thread) dagegen
        // schon: den lesen wir nur für die Interop und schreiben ihn nie.
        for (const kind of [7, 9735, 10, 22242, 20000, 24133]) {
            expect(shouldPersistEvent(ev(kind)), `kind ${kind} sollte NICHT gecacht werden`).toBe(false)
        }
    })
})

test.describe('messagesToPrune (§4.3 Per-Raum-Cap + Alters-Backstop)', () => {
    test('kappt pro Raum auf die neuesten N, verwirft den Überschuss', () => {
        // Raum A: 5 Nachrichten (a1=neueste NOW-10 … a5=älteste NOW-50), cap 3 → a4+a5 fallen.
        const events = [1, 2, 3, 4, 5].map((t) => msg(`a${t}`, 'roomA', NOW - t * 10))
        const drop = messagesToPrune(events, NOW, 3)
        expect(drop.sort()).toEqual(['a4', 'a5'])
    })

    test('Cap ist pro Raum unabhängig', () => {
        const events = [
            ...[1, 2, 3].map((t) => msg(`a${t}`, 'roomA', NOW - t)),
            ...[1, 2, 3].map((t) => msg(`b${t}`, 'roomB', NOW - t)),
        ]
        // cap 2 → je Raum fällt genau die älteste (a3, b3).
        expect(messagesToPrune(events, NOW, 2).sort()).toEqual(['a3', 'b3'])
    })

    test('Alters-Backstop verwirft alles älter als maxAge, unabhängig vom Cap', () => {
        const events = [
            msg('fresh', 'roomA', NOW - 10 * DAY),
            msg('old', 'roomA', NOW - 31 * DAY), // > 30 Tage
        ]
        expect(messagesToPrune(events, NOW, 300, 30 * DAY)).toEqual(['old'])
    })

    test('lässt Control-Plane und kind-9 ohne #h unangetastet', () => {
        // ZWEI #h-lose kind-9 bei cap=1: fällt die `if (!h) continue`-Guard weg, würden
        // beide unter demselben (undefined) Key gruppiert → Überschuss → Drop. Also fenced
        // dieser Fall die Guard wirklich (ein einzelnes Event täte es nicht).
        const events = [
            ev(0), // Profile (kein kind 9)
            ev(10002), // Relays
            { id: 'noh1', pubkey: 'a', kind: 9, created_at: NOW, tags: [], content: '', sig: '' } as TrustedEvent,
            { id: 'noh2', pubkey: 'a', kind: 9, created_at: NOW - 1, tags: [], content: '', sig: '' } as TrustedEvent,
        ]
        expect(messagesToPrune(events, NOW, 1)).toEqual([])
    })
})

// kind-9005 (ROOM_DELETE_EVENT) mit `e`-Zielen `ids`.
const del = (id: string, ...ids: string[]): TrustedEvent =>
    ({ id, pubkey: 'a', kind: 9005, created_at: NOW, tags: [['h', 'roomA'], ...ids.map((e) => ['e', e])], content: '', sig: '' }) as TrustedEvent

test.describe('tombstonedIds (B2 Selbstreparatur gegen Limbo-Events)', () => {
    test('sammelt alle e-Ziele aller 9005', () => {
        const events = [msg('m1', 'roomA', NOW), del('t1', 'm1'), del('t2', 'm2', 'm3'), ev(9)]
        expect([...tombstonedIds(events)].sort()).toEqual(['m1', 'm2', 'm3'])
    })

    test('ignoriert Nicht-9005 und leere e-Werte', () => {
        // Nur 9005 zählt; ein `e`-Tag ohne Wert wird übersprungen (kein leerer Eintrag).
        const events = [
            msg('m1', 'roomA', NOW),
            ev(5), // NIP-09-Delete, NICHT 9005 → hier irrelevant
            { id: 'd', pubkey: 'a', kind: 9005, created_at: NOW, tags: [['h', 'roomA'], ['e', '']], content: '', sig: '' } as TrustedEvent,
        ]
        expect(tombstonedIds(events).size).toBe(0)
    })

    test('kein 9005 → leeres Set', () => {
        expect(tombstonedIds([msg('m1', 'roomA', NOW), ev(7)]).size).toBe(0)
    })
})
