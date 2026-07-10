import { test, expect } from '@playwright/test'
import { NIP46_PERMS, nip46PermsAreStale } from '../../packages/einundzwanzig-group/js/nip46-perms'

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
        const required = [0, 5, 7, 9, 1018, 1068, 1984, 9021, 9022, 9041, 9734, 10009, 22242, 27235, 28934, 28936]
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
