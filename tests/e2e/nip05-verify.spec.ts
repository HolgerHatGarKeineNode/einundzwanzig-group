import { test, expect } from './support/fixtures'
import { verifiedNip05 } from '../../packages/einundzwanzig-group/js/handles'

/**
 * NIP-05-Verifizierung (B4): die Match-Regel ist sicherheitskritisch — ein Häkchen
 * darf NUR erscheinen, wenn der in nostr.json hinterlegte Handle auf genau diese
 * pubkey zeigt. Reiner Logiktest, kein Browser/kein Netz.
 */
test.describe('verifiedNip05', () => {
    const P = (nip05?: string) => new Map([['pk1', { nip05 }]])
    const H = (pubkey?: string) => new Map([['alice@example.com', { pubkey }]])

    test('verifiziert bei passendem Handle → Anzeige-String', () => {
        expect(verifiedNip05('pk1', P('alice@example.com'), H('pk1'))).toBe('alice@example.com')
    })

    test('kein Häkchen, wenn der Handle auf eine ANDERE pubkey zeigt', () => {
        expect(verifiedNip05('pk1', P('alice@example.com'), H('imposter'))).toBe('')
    })

    test('kein Häkchen ohne nip05 im Profil', () => {
        expect(verifiedNip05('pk1', P(undefined), H('pk1'))).toBe('')
    })

    test('kein Häkchen, solange der Handle noch nicht geladen ist', () => {
        expect(verifiedNip05('pk1', P('alice@example.com'), new Map())).toBe('')
    })

    test('root-Handle `_@domain` zeigt nur die Domain', () => {
        const profiles = new Map([['pk1', { nip05: '_@example.com' }]])
        const handles = new Map([['_@example.com', { pubkey: 'pk1' }]])
        expect(verifiedNip05('pk1', profiles, handles)).toBe('example.com')
    })
})
