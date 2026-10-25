import { test, expect } from './support/fixtures'
import { spaceSupportsRooms, spaceBranding, hasNip70 } from '../../packages/einundzwanzig-group/js/relayCaps'

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
    test('nimmt NIP-11 name/icon/description/banner, wenn vorhanden', () => {
        expect(spaceBranding('localhost:3335', { name: 'Zooid Test Space', icon: 'https://x/i.png', description: 'hi', banner: 'https://x/b.png' })).toEqual({
            label: 'Zooid Test Space',
            icon: 'https://x/i.png',
            description: 'hi',
            banner: 'https://x/b.png',
        })
    })

    test('fällt auf die gekürzte URL zurück, wenn kein Name da ist', () => {
        expect(spaceBranding('localhost:3335', undefined)).toEqual({ label: 'localhost:3335', icon: '', description: '', banner: '' })
        expect(spaceBranding('localhost:3335', { name: '   ' })).toEqual({ label: 'localhost:3335', icon: '', description: '', banner: '' })
    })
})

/**
 * NIP-70 (C0): steuert das `["-"]` PROTECTED-Tag jeder schreibenden Room-Aktion
 * (`roomTags`). Reiner Logiktest des welshman-freien Kerns — kein Browser.
 */
test.describe('hasNip70', () => {
    test('true, wenn supported_nips die 70 führt (zooid Test-Space)', () => {
        expect(hasNip70({ supported_nips: ['1', '11', '42', '70', '29'] })).toBe(true)
    })

    test('false ohne 70', () => {
        expect(hasNip70({ supported_nips: ['1', '11', '29'] })).toBe(false)
    })

    test('false, solange das NIP-11-Profil fehlt (kein PROTECTED beim Boot)', () => {
        expect(hasNip70(undefined)).toBe(false)
        expect(hasNip70({})).toBe(false)
    })
})

/**
 * Sichert die reale Annahme ab, auf der der Filter beruht: die beiden EINUNDZWANZIG-
 * Relays liefern ihr NIP-11 mit bzw. ohne NIP-29. Reißt, falls sich das je ändert.
 *
 * **OPT-IN (`E2E_LIVE_NIP11=1`), nicht Teil des Regellaufs.** Das ist ein Drift-Fühler gegen
 * die ÖFFENTLICHEN Relays: `request` ist der Node-seitige HTTP-Client und läuft an der
 * Chromium-Hermetik (`--host-resolver-rules`, Relay-Wächter) vorbei, der Fall verließ also
 * bei jedem Lauf die Maschine. Das Zeitbudget- und Hermetik-Gebot dieser Suite ("kein Test
 * verlässt die Maschine") verträgt das nicht — und der Fall hat es auch bewiesen: im
 * Vollauf vom 2026-10-25 hingen beide Fälle 90 s (bis zum Test-Timeout), einzeln liefen sie
 * in 0,3 s. Die LOGIK des Filters bleibt im Regellauf durch die vier Fälle oben gedeckt,
 * die genau diese `supported_nips` als aufgezeichnete Werte tragen; was hier fehlt, ist nur
 * der Abgleich der Aufzeichnung mit der Wirklichkeit. Er wird nicht registriert, solange
 * niemand ihn anfordert (kein `test.skip`: ein übersprungener Fall ist ein stiller Fall).
 *
 *   E2E_LIVE_NIP11=1 npx playwright test tests/e2e/space-caps.spec.ts
 */
if (process.env.E2E_LIVE_NIP11 === '1') {
    test.describe('reale NIP-11-Annahme (Drift-Fühler, Netz)', () => {
        for (const [host, expected] of [
            ['group.einundzwanzig.space', true],
            ['nostr.einundzwanzig.space', false],
        ] as const) {
            test(`${host} führt NIP-29: ${expected}`, async ({ request }) => {
                const res = await request.get(`https://${host}/`, {
                    headers: { Accept: 'application/nostr+json' },
                    timeout: 15_000,
                })
                const nips = ((await res.json()).supported_nips ?? []).map(String)
                expect(nips.includes('29')).toBe(expected)
            })
        }
    })
}
