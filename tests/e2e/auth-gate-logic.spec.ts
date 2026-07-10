import { test, expect } from '@playwright/test'
import { sanitizeReturnUrl, isAuthed } from '../../packages/einundzwanzig-group/js/auth-gate'

/**
 * JS-Unit (welshman-app-frei): die sicherheitsrelevante Kern-Logik des
 * kontextuellen Auth-Gates (§4.2) — der Session-Check und der Open-Redirect-
 * Schutz. Beides Trust-Grenzen: ein falsch-truthy authed lässt Gäste durch, ein
 * durchgereichtes fremdes `?return` schickt sie nach dem Login off-site.
 */
test.describe('isAuthed (welshman-pubkey aus localStorage, JSON.parse-Falle)', () => {
    test('Gast-Sentinels + Müll → false (JSON.parse("undefined") würde werfen)', () => {
        for (const raw of [null, undefined, '', 'undefined', 'null', '{kaputt', '""']) {
            expect(isAuthed(raw)).toBe(false)
        }
    })

    test('echter JSON-serialisierter pubkey → true', () => {
        expect(isAuthed(JSON.stringify('ab'.repeat(32)))).toBe(true)
    })
})

test.describe('sanitizeReturnUrl (Open-Redirect-Schutz für ?return)', () => {
    test('lässt eigene absolute Pfade durch', () => {
        expect(sanitizeReturnUrl('/spaces')).toBe('/spaces')
        expect(sanitizeReturnUrl('/settings/wallet?tab=1')).toBe('/settings/wallet?tab=1')
        expect(sanitizeReturnUrl('/spaces/evil.com')).toBe('/spaces/evil.com')
    })

    test('verwirft fremde/relative/protokoll-tragende Ziele', () => {
        for (const evil of ['//evil.com', '/\\evil.com', 'https://evil.com', 'spaces', '', null, undefined]) {
            expect(sanitizeReturnUrl(evil)).toBeNull()
        }
    })

    test('verwirft Steuerzeichen (Tab/LF/CR) — sonst strippt der URL-Parser sie zu //evil', () => {
        // Per fromCharCode konstruiert, damit der Quelltext reiner ASCII bleibt
        // (ein echtes LF in einem '…'-Literal wäre ein Syntaxfehler).
        const TAB = String.fromCharCode(9)
        const LF = String.fromCharCode(10)
        const CR = String.fromCharCode(13)
        for (const evil of [`/${TAB}/evil.com`, `/${LF}//evil.com`, `/${CR}/evil.com`]) {
            expect(sanitizeReturnUrl(evil)).toBeNull()
        }
    })
})
