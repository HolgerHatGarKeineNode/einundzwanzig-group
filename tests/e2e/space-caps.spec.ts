import { test, expect } from '@playwright/test'
import { spaceSupportsRooms, spaceBranding } from '../../packages/einundzwanzig-group/js/relayCaps'

/**
 * Space-Filter (NIP-29): nur Group-Relays dürfen in der Auswahl stehen. Reiner
 * Logiktest des Discriminators — kein Browser, keine welshman-Runtime nötig.
 */
test.describe('spaceSupportsRooms', () => {
    test('behält Vereins-Relays immer (auch ohne geladenes Profil)', () => {
        expect(spaceSupportsRooms(true, undefined)).toBe(true)
        expect(spaceSupportsRooms(true, { supported_nips: [] })).toBe(true)
    })

    test('behält Relays optimistisch, solange das NIP-11-Profil fehlt', () => {
        expect(spaceSupportsRooms(false, undefined)).toBe(true)
    })

    test('behält geladene Relays mit NIP-29 (group.einundzwanzig.space)', () => {
        // reale supported_nips von group.einundzwanzig.space (String[], enthält 29)
        expect(spaceSupportsRooms(false, { supported_nips: ['1', '11', '42', '29', '9'] })).toBe(true)
    })

    test('filtert geladene Relays OHNE NIP-29 (nostr.einundzwanzig.space)', () => {
        // reale supported_nips von nostr.einundzwanzig.space (kein 29)
        expect(spaceSupportsRooms(false, { supported_nips: ['1', '2', '9', '11', '40'] })).toBe(false)
    })
})

/**
 * Space-Branding aus NIP-11 (B1): Name/Icon/Description mit URL-Fallback. Reiner
 * Logiktest — kein Browser, keine welshman-Runtime.
 */
test.describe('spaceBranding', () => {
    test('nimmt NIP-11 name/icon/description, wenn vorhanden', () => {
        expect(spaceBranding('localhost:3334', { name: 'Zooid Test Space', icon: 'https://x/i.png', description: 'hi' })).toEqual({
            label: 'Zooid Test Space',
            icon: 'https://x/i.png',
            description: 'hi',
        })
    })

    test('fällt auf die gekürzte URL zurück, wenn kein Name da ist', () => {
        expect(spaceBranding('localhost:3334', undefined)).toEqual({ label: 'localhost:3334', icon: '', description: '' })
        expect(spaceBranding('localhost:3334', { name: '   ' })).toEqual({ label: 'localhost:3334', icon: '', description: '' })
    })
})

/**
 * Sichert die reale Annahme ab, auf der der Filter beruht: die beiden EINUNDZWANZIG-
 * Relays liefern ihr NIP-11 mit bzw. ohne NIP-29. Reißt, falls sich das je ändert.
 */
test.describe('reale NIP-11-Annahme', () => {
    for (const [host, expected] of [
        ['group.einundzwanzig.space', true],
        ['nostr.einundzwanzig.space', false],
    ] as const) {
        test(`${host} führt NIP-29: ${expected}`, async ({ request }) => {
            const res = await request.get(`https://${host}/`, { headers: { Accept: 'application/nostr+json' } })
            const nips = ((await res.json()).supported_nips ?? []).map(String)
            expect(nips.includes('29')).toBe(expected)
        })
    }
})
