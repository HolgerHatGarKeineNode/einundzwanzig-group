import { test, expect } from './support/fixtures'
import { portalAuthEventTemplate } from '../../packages/einundzwanzig-group/js/portal-auth-event'

/**
 * JS-Unit (welshman-app-frei): das kind-22242-Portal-Login-Template, das der
 * welshman-Signer beim Single-Login signiert. Das Portal (NostrLogin::verifyEvent)
 * prüft kind == 22242, den challenge-Tag == k1 und created_at ≤ 300 s — genau die
 * Form, die hier festgenagelt wird. Signieren + HTTP-Handoff leben im Geräte-E2E.
 */
test.describe('portalAuthEventTemplate (kind-22242 über die Portal-Challenge k1)', () => {
    const k1 = 'ab'.repeat(32)

    test('kind 22242, challenge-Tag trägt k1, leerer content', () => {
        const t = portalAuthEventTemplate(k1, 1_700_000_000)
        expect(t.kind).toBe(22242)
        expect(t.content).toBe('')
        expect(t.tags).toEqual([['challenge', k1]])
    })

    test('stempelt das übergebene created_at (Portal-Fenster ≤ 300 s)', () => {
        expect(portalAuthEventTemplate(k1, 1_700_000_042).created_at).toBe(1_700_000_042)
    })
})
