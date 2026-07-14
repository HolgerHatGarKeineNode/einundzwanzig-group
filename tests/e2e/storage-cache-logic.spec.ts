import { test, expect } from './support/fixtures'
import type { TrustedEvent } from '@welshman/util'
import { shouldPersistEvent } from '../../packages/einundzwanzig-group/js/storage'

/**
 * M3 P0 — Cache-Whitelist (`shouldPersistEvent`, §4.1/4.2). Reiner welshman-app-
 * freier Kern aus `storage.ts` — kein Browser, keine IndexedDB. Der IDB-Round-Trip
 * (put→getAll→load) reitet mit P1, sobald `initStorage()` im Bundle verdrahtet ist.
 */
const ev = (kind: number): TrustedEvent =>
    ({ id: `k${kind}`, pubkey: 'a', kind, created_at: 0, tags: [], content: '', sig: '' }) as TrustedEvent

test.describe('shouldPersistEvent', () => {
    test('cacht Chat + Control-Plane + Deletes', () => {
        // Chat (der 13-s-Treiber) + kind 5 (sonst reappearen gelöschte Nachrichten).
        // Vollständige PERSIST_KINDS-Whitelist (13) — dieser Test ist bis P1 der EINZIGE Wächter.
        for (const kind of [9, 5, 0, 3, 10000, 10002, 30078, 39000, 39001, 39002, 13534, 1068, 9041]) {
            expect(shouldPersistEvent(ev(kind)), `kind ${kind} sollte gecacht werden`).toBe(true)
        }
    })

    test('verwirft Ephemeral/AUTH/Reaktionen/Zaps/Kommentare', () => {
        // §4.2: kein `#h` / sekundär / laden lazy nach dem Paint.
        for (const kind of [7, 9735, 1111, 22242, 20000, 24133]) {
            expect(shouldPersistEvent(ev(kind)), `kind ${kind} sollte NICHT gecacht werden`).toBe(false)
        }
    })
})
