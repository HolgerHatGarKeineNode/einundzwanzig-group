/**
 * Zusicherung zu N9: **ein Lauf raeumt nur die Marker seiner eigenen Slots ab.**
 *
 * Ausfuehren:
 *   node --test --experimental-strip-types tests/e2e/support/runMarkers.nodetest.ts
 *
 * Der Dateiname endet bewusst NICHT auf `.test.ts`/`.spec.ts`: Playwrights Default-
 * `testMatch` (`**\/*.@(spec|test).?(c|m)[jt]s?(x)`) wuerde die Datei sonst als Spec
 * einsammeln, und `node:test` laeuft dort nicht.
 *
 * Der zweite Block ist der eigentliche Waechter: er faehrt die Loeschung wirklich
 * gegen ein Wegwerf-Verzeichnis und prueft, dass der Marker eines FREMDEN Slots
 * ueberlebt. Weicht das Glob je wieder auf, faellt genau dieser Fall.
 */
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ownedRunMarkerPaths, ownedSlots, ownsRunMarker } from './runMarkers.ts'

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
