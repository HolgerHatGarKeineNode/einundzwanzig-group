/**
 * Tripwire: `global-setup.ts` empties the server's file cache before any `serve` exists.
 *
 *   node --test --experimental-strip-types tests/e2e/support/globalSetupCache.nodetest.ts
 *
 * Why a tripwire and not a behaviour test: `globalSetup()` builds zooid and the Vite bundle, which
 * is not something a unit test can call. The behaviour itself was measured on the real suite
 * (2026-10-25): with the `ProfileCache` miss records of earlier runs in
 * `storage/framework/cache/data`, `person-mute.spec.ts` failed 2 of 3; one `rm -rf` of that
 * directory later it passed 3 of 3. This test only makes sure the line that does the `rm` cannot
 * be dropped, or moved behind the point where servers start, without somebody seeing it.
 */
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'

const quelle = readFileSync(new URL('./global-setup.ts', import.meta.url), 'utf8')

test('global-setup leert storage/framework/cache/data — und lässt die versionierte .gitignore stehen', () => {
    assert.match(quelle, /const cacheDir = 'storage\/framework\/cache\/data'/)
    assert.match(quelle, /readdirSync\(cacheDir\)/)
    assert.match(quelle, /eintrag !== '\.gitignore'/)
})

test('… und zwar vor dem Bau von zooid und Vite (also vor jedem Worker)', () => {
    const wipe = quelle.indexOf("const cacheDir = 'storage/framework/cache/data'")
    const zooidBau = quelle.indexOf('go build')
    const viteBau = quelle.indexOf("execFileSync('npm', ['run', 'build']")
    assert.ok(wipe > 0 && zooidBau > 0 && viteBau > 0, 'Anker nicht gefunden — Test anpassen')
    assert.ok(wipe < zooidBau && wipe < viteBau)
})
