import { test, expect } from './support/fixtures'
import { NIP46_PERMS, nip46PermsAreStale, permsToNip55Json } from '../../packages/einundzwanzig-group/js/nip46-perms'

/**
 * Amber-Stabilität: die NIP-46-Perm-Liste MUSS jeden Kind abdecken, den der Client je
 * signiert — Amber-Default (Policy 1) gewährt sonst nur die gelisteten Kinds vorab und
 * promptet für jeden fehlenden mitten im Flow (Nutzer steckt fest). Dazu die reine
 * Staleness-Entscheidung für den Reconnect-Nudge. welshman-app-frei, kein Browser.
 */

const perms = NIP46_PERMS.split(',')

test.describe('NIP46_PERMS (vollständige Abdeckung)', () => {
    test('deckt alle signierten Kinds ab — inkl. der kritischen 27235 (Login + Admin)', () => {
        // Jeder Kind, den der Client signiert (Kind-Audit). 27235 ist am kritischsten:
        // ohne ihn kein Server-Login-Handoff und kein NIP-86-Relay-Admin.
        //
        // Die Liste war unvollständig und hat damit genau den Bug durchgelassen, den sie
        // fangen soll: 1111 (Thread-Kommentar) fehlte in NIP46_PERMS, der Test fragte ihn
        // nicht ab. Ergänzt wurden 1111 und die Admin-Kinds 9000/9001/9002/9007/9008 —
        // wer hier einen Kind hinzufügt, muss ihn auch in NIP46_PERMS führen.
        const required = [
            0, 5, 7, 9, 1018, 1068, 1111, 1984,
            9000, 9001, 9002, 9005, 9007, 9008, 9021, 9022, 9041, 9734,
            10009, 22242, 27235, 28934, 28936,
            // 30078 (NIP-78 App-Data) = Lesestand. Publiziert wird er erst in P6 —
            // die Berechtigung muss trotzdem heute schon drinstehen, weil welshman die
            // Rechte einer bestehenden Amber-Verbindung nie nachverhandelt.
            30078,
        ]
        for (const kind of required) {
            expect(perms, `sign_event:${kind} muss enthalten sein`).toContain(`sign_event:${kind}`)
        }
    })

    test('enthält nip44 encrypt/decrypt, aber kein nip04 (Client nutzt nur nip44)', () => {
        expect(perms).toContain('nip44_encrypt')
        expect(perms).toContain('nip44_decrypt')
        expect(NIP46_PERMS).not.toContain('nip04')
    })

    test('jeder sign_event trägt einen expliziten :kind — Amber verwirft nacktes sign_event', () => {
        const signEntries = perms.filter((p) => p.startsWith('sign_event'))
        expect(signEntries.length).toBeGreaterThan(0)
        for (const entry of signEntries) {
            expect(entry, `"${entry}" muss sign_event:<kind> sein`).toMatch(/^sign_event:\d+$/)
        }
    })

    test('keine Duplikate', () => {
        expect(new Set(perms).size).toBe(perms.length)
    })
})

test.describe('nip46PermsAreStale (Reconnect-Nudge-Entscheidung)', () => {
    test('NIP-46 ohne Merker (bestehende Alt-Verbindung) → stale', () => {
        expect(nip46PermsAreStale('nip46', null)).toBe(true)
    })

    test('NIP-46 mit aktuellem Perms-String → frisch', () => {
        expect(nip46PermsAreStale('nip46', NIP46_PERMS)).toBe(false)
    })

    test('NIP-46 mit veraltetem (unvollständigem) String → stale', () => {
        expect(nip46PermsAreStale('nip46', 'nip44_encrypt,sign_event:9')).toBe(true)
    })

    test('Nsec/NIP-07 sind nie stale (kein Remote-Perm-Modell)', () => {
        expect(nip46PermsAreStale('nip01', null)).toBe(false)
        expect(nip46PermsAreStale('nip07', null)).toBe(false)
        expect(nip46PermsAreStale(undefined, null)).toBe(false)
    })
})

test.describe('permsToNip55Json (Amber NIP-55 permissions-Array)', () => {
    test('sign_event:<kind> → {type,kind}; Methoden ohne kind → nur {type}', () => {
        const json = JSON.parse(permsToNip55Json('sign_event:9,nip44_encrypt,sign_event:27235'))
        expect(json).toContainEqual({ type: 'sign_event', kind: 9 })
        expect(json).toContainEqual({ type: 'sign_event', kind: 27235 })
        expect(json).toContainEqual({ type: 'nip44_encrypt' })
    })

    test('deckt die volle NIP46_PERMS-Liste ab (jeder sign_event mit numerischem kind)', () => {
        const json = JSON.parse(permsToNip55Json(NIP46_PERMS)) as Array<{ type: string; kind?: number }>
        expect(json.length).toBe(NIP46_PERMS.split(',').length)
        for (const p of json) {
            if (p.type === 'sign_event') {
                expect(typeof p.kind).toBe('number')
                expect(Number.isNaN(p.kind)).toBe(false)
            } else {
                expect(p.kind).toBeUndefined()
            }
        }
        // Die kritische 27235 muss als sign_event-Eintrag vorhanden sein.
        expect(json).toContainEqual({ type: 'sign_event', kind: 27235 })
    })
})
