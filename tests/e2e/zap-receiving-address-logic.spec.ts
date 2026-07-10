import { test, expect } from '@playwright/test'
import type { Profile } from '@welshman/util'
import { buildReceivingAddressEvent } from '../../packages/einundzwanzig-group/js/profiles'

/**
 * ZAPS.md Z4 JS-Unit (welshman-app-frei): der kind-0-Builder für die Lightning-
 * Empfangsadresse. Setzt `lud16`, **löscht `lud06`**, behält übrige Profilfelder,
 * streift den PROTECTED-Tag ab. Kein Browser, kein Signer, kein Relay.
 */
const contentOf = (event: { content: string }) => JSON.parse(event.content) as Profile

test.describe('buildReceivingAddressEvent (kind-0 lud16-Update)', () => {
    test('ohne bestehendes Profil: kind 0, lud16 gesetzt, kein lud06', () => {
        const event = buildReceivingAddressEvent(undefined, 'alice@example.com')
        expect(event.kind).toBe(0)
        const profile = contentOf(event)
        expect(profile.lud16).toBe('alice@example.com')
        expect(profile.lud06).toBeUndefined()
    })

    test('bestehendes Profil: übrige Felder bleiben, lud06 wird gelöscht', () => {
        const current: Profile = { name: 'Alice', about: 'hi', lud06: 'lnurl1old', lud16: 'old@host' }
        const event = buildReceivingAddressEvent(current, 'alice@example.com')
        const profile = contentOf(event)
        expect(profile.name).toBe('Alice')
        expect(profile.about).toBe('hi')
        expect(profile.lud16).toBe('alice@example.com')
        expect(profile.lud06).toBeUndefined()
    })

    test('leere Eingabe entfernt die Adresse (lud16 undefined)', () => {
        const event = buildReceivingAddressEvent({ lud16: 'old@host' }, '   ')
        expect(contentOf(event).lud16).toBeUndefined()
    })

    test('trimmt Whitespace der Adresse', () => {
        const event = buildReceivingAddressEvent(undefined, '  bob@host  ')
        expect(contentOf(event).lud16).toBe('bob@host')
    })

    test('streift einen alten PROTECTED-Tag (["-"]) ab', () => {
        const current = { lud16: 'old@host', event: { tags: [['-']] } } as unknown as Profile
        const event = buildReceivingAddressEvent(current, 'bob@host')
        expect(event.tags.some((t) => t[0] === '-')).toBe(false)
    })
})
