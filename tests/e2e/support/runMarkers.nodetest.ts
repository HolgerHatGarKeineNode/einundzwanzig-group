/**
 * Zusicherung zu N9: **ein Lauf raeumt nur die Marker seiner eigenen Slots ab.**
 *
 * Ausfuehren: **`npm run test:unit`** (Wurzel-`package.json`) — dieselbe Kette, die
 * auch die Paket-Units (`packages/<paket>/js/…test.ts`) faehrt. Einzeln:
 *   node --test --experimental-strip-types tests/e2e/support/runMarkers.nodetest.ts
 *
 * Der Dateiname endet bewusst NICHT auf `.test.ts`/`.spec.ts`: Playwrights Default-
 * `testMatch` (`**\/*.@(spec|test).?(c|m)[jt]s?(x)`) wuerde die Datei sonst als Spec
 * einsammeln, und `node:test` laeuft dort nicht.
 *
 * **Und genau dieser Ausschluss hat sie beim ersten Anlauf aus JEDER Kette gehalten**
 * (Gate-REJECT, 2026-08-18): Die Zahl „JS-Unit 951" stammte aus dem Glob
 * `packages/einundzwanzig-group/js/*.test.ts`, ein `test:unit`-Script gab es nicht,
 * CI gibt es nicht — der einzige Hinweis auf ihre Ausfuehrung stand in genau diesem
 * Kommentar. Eine Zusicherung, die nur bei zufaelligem Lesen laeuft, verrottet stumm
 * beim naechsten Umbau von `global-setup.ts` — also bei dem Ereignis, gegen das sie
 * gebaut ist. Deshalb faengt `test:unit` beide Endungen an beiden Orten ein; die
 * Reichweite ist gemessen (eine Probe-Datei in `tests/e2e/` hob die Zahl auf 956).
 *
 * Der zweite Block ist der eigentliche Waechter: er faehrt die Loeschung wirklich
 * gegen ein Wegwerf-Verzeichnis und prueft, dass der Marker eines FREMDEN Slots
 * ueberlebt. Weicht das Glob je wieder auf, faellt genau dieser Fall.
 *
 * Der dritte Block (`ownedTeardownTargets`) gehört zum Lebenszyklus-Fix (2026-08-27,
 * `fix/teststack-lebenszyklus`): dieselbe Slot-Menge, aber als (Modus, Port)-Ziele für
 * `global-teardown.ts`. Die reale Wirkung (kill+rm, docker down -v) prüft
 * `teststackLifecycle.nodetest.ts` gegen ECHTE Fake-Stacks — hier nur die reine
 * Slot→Ziel-Ableitung.
 */
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ownedRunMarkerPaths, ownedSlots, ownedTeardownTargets, ownsRunMarker } from './runMarkers.ts'

test('ownedSlots: die Reihe beginnt am Offset und ist so lang wie die Worker-Zahl', () => {
    assert.deepEqual(ownedSlots({ workers: 4, slotOffset: 0 }), [0, 1, 2, 3])
    assert.deepEqual(ownedSlots({ workers: 4, slotOffset: 4 }), [4, 5, 6, 7])
    assert.deepEqual(ownedSlots({ workers: 2, slotOffset: 16 }), [16, 17])
    // `--workers=1` besitzt genau einen Slot — und eben nicht mehr.
    assert.deepEqual(ownedSlots({ workers: 1, slotOffset: 4 }), [4])
})

test('ownedRunMarkerPaths: eigene Portreihe, beide Relay-Arme, nichts darueber hinaus', () => {
    assert.deepEqual(ownedRunMarkerPaths({ workers: 2, slotOffset: 4 }), [
        '/tmp/e2e-buzz-3005.run',
        '/tmp/e2e-zooid-3339.run',
        '/tmp/e2e-buzz-3006.run',
        '/tmp/e2e-zooid-3340.run',
    ])
})

test('N9: der Marker eines fremden Slots ist NIE dabei', () => {
    const lauf = { workers: 4, slotOffset: 4 }
    // Slot 16/17 — die Reihe eines parallel arbeitenden Laufs.
    assert.equal(ownsRunMarker(lauf, '/tmp/e2e-buzz-3017.run'), false)
    assert.equal(ownsRunMarker(lauf, '/tmp/e2e-buzz-3018.run'), false)
    assert.equal(ownsRunMarker(lauf, '/tmp/e2e-zooid-3351.run'), false)
    // Der Nachbarslot direkt VOR der eigenen Reihe gehoert ebenfalls nicht dazu.
    assert.equal(ownsRunMarker(lauf, '/tmp/e2e-buzz-3004.run'), false)
    // …und die eigenen vier schon.
    assert.equal(ownsRunMarker(lauf, '/tmp/e2e-buzz-3005.run'), true)
    assert.equal(ownsRunMarker(lauf, '/tmp/e2e-buzz-3008.run'), true)
    assert.equal(ownsRunMarker(lauf, '/tmp/e2e-zooid-3342.run'), true)
})

test('N9-Waechter: die Loeschung selbst laesst fremde Marker stehen', () => {
    const dir = mkdtempSync(join(tmpdir(), 'n9-marker-'))
    try {
        // Zwei Laeufe auf derselben Maschine: eigener Offset 4 (4 Worker),
        // fremder Offset 16 (2 Worker). Alle sechs Marker liegen da.
        const fremd = ownedRunMarkerPaths({ workers: 2, slotOffset: 16, dir })
        const eigen = ownedRunMarkerPaths({ workers: 4, slotOffset: 4, dir })
        for (const p of [...eigen, ...fremd]) {
            writeFileSync(p, '')
        }
        assert.equal(readdirSync(dir).length, eigen.length + fremd.length)

        // Genau das, was global-setup.ts tut.
        for (const p of ownedRunMarkerPaths({ workers: 4, slotOffset: 4, dir })) {
            rmSync(p, { force: true })
        }

        const uebrig = readdirSync(dir).sort()
        assert.deepEqual(
            uebrig,
            fremd.map((p) => p.slice(dir.length + 1)).sort(),
            'nach dem Lauf duerfen GENAU die Marker des fremden Slots uebrig sein',
        )
    } finally {
        rmSync(dir, { recursive: true, force: true })
    }
})

test('ownedTeardownTargets: eigene Portreihe, beide Arme, als (Modus, Port)-Ziele', () => {
    assert.deepEqual(ownedTeardownTargets({ workers: 2, slotOffset: 4 }), [
        { mode: 'buzz', port: 3005 },
        { mode: 'zooid', port: 3339 },
        { mode: 'buzz', port: 3006 },
        { mode: 'zooid', port: 3340 },
    ])
})

test('ownedTeardownTargets: NIE ein Ziel außerhalb der eigenen Slot-Reihe', () => {
    const lauf = { workers: 4, slotOffset: 4 }
    const ziele = ownedTeardownTargets(lauf)
    // Der fremde Nachbarslot (16/17, wie oben) darf unter KEINEM der beiden Arme
    // auftauchen — das ist exakt die Zusage, die `global-teardown.ts` einlösen muss:
    // niemals den Stack eines parallel laufenden, fremden Slots anfassen.
    assert.equal(
        ziele.some((z) => (z.mode === 'buzz' && z.port === 3017) || (z.mode === 'zooid' && z.port === 3351)),
        false,
    )
    assert.equal(ziele.length, lauf.workers * 2)
})
