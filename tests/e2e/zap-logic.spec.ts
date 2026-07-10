import { test, expect } from '@playwright/test'
import { requestZap, type SignedEvent, type Zapper } from '@welshman/util'
import { canZap, mapZapError, zapRequestTemplate } from '../../packages/einundzwanzig-group/js/zaps'

/**
 * ZAPS.md Z1 JS-Unit (welshman-app-frei): das Vorabgate + die kind-9734-Tag-Form +
 * der LNURL-Callback-Vertrag, auf dem `js/zaps.ts` baut. Kein Browser, kein Relay.
 * Signieren (`buildZapRequest`) und Zapper-Auflösung leben im E2E (Signer/HTTP).
 */

const zapper: Zapper = {
    lnurl: 'lnurl1dp68gurn8ghj7ur',
    callback: 'https://ln.example/lnurl/callback',
    nostrPubkey: 'aa'.repeat(32),
    allowsNostr: true,
    minSendable: 1000,
    maxSendable: 100_000_000,
}

test.describe('canZap (Vorabgate — getZapResponseFilter wirft sonst)', () => {
    test('nur mit allowsNostr UND nostrPubkey', () => {
        expect(canZap(zapper)).toBe(true)
        expect(canZap(undefined)).toBe(false)
        expect(canZap({ ...zapper, allowsNostr: false })).toBe(false)
        expect(canZap({ ...zapper, nostrPubkey: undefined })).toBe(false)
    })
})

test.describe('zapRequestTemplate (kind-9734-Tag-Form, sats→msats)', () => {
    const tagsOf = (tags: string[][], name: string) => tags.filter((t) => t[0] === name)

    test('relays/amount(msats)/lnurl/p; e-Tag nur mit eventId; content default ⚡', () => {
        const t = zapRequestTemplate({ pubkey: 'bob', zapper, sats: 21, relays: ['wss://r1/', 'wss://r2/'] })
        expect(t.kind).toBe(9734)
        expect(t.content).toBe('⚡')
        expect(tagsOf(t.tags, 'relays')[0]).toEqual(['relays', 'wss://r1/', 'wss://r2/'])
        expect(tagsOf(t.tags, 'amount')[0]).toEqual(['amount', '21000']) // 21 sats = 21000 msats
        expect(tagsOf(t.tags, 'lnurl')[0]).toEqual(['lnurl', zapper.lnurl])
        expect(tagsOf(t.tags, 'p')[0]).toEqual(['p', 'bob'])
        expect(tagsOf(t.tags, 'e')).toHaveLength(0) // Profil-Zap ohne eventId
    })

    test('mit eventId trägt genau ein e-Tag; eigener content bleibt', () => {
        const t = zapRequestTemplate({ pubkey: 'bob', zapper, sats: 210, relays: ['wss://r/'], eventId: 'evt123', content: '🔥' })
        expect(tagsOf(t.tags, 'e')[0]).toEqual(['e', 'evt123'])
        expect(t.content).toBe('🔥')
        expect(tagsOf(t.tags, 'amount')[0]).toEqual(['amount', '210000'])
    })
})

test.describe('requestZap (LNURL-Callback-Vertrag → bolt11)', () => {
    // Signierte 9734 (nur die von requestZap gelesenen Felder: amount-Tag).
    const signed = { kind: 9734, tags: [['amount', '21000']], content: '⚡' } as unknown as SignedEvent

    test('baut ?amount=&nostr=&lnurl= und liefert die bolt11 aus res.pr', async () => {
        let calledUrl = ''
        const orig = globalThis.fetch
        globalThis.fetch = (async (url: string) => {
            calledUrl = String(url)
            return { json: async () => ({ pr: 'lnbc210n1teststub' }) }
        }) as unknown as typeof fetch
        try {
            const res = await requestZap({ zapper, event: signed })
            expect(res.invoice).toBe('lnbc210n1teststub')
            expect(calledUrl).toContain('https://ln.example/lnurl/callback')
            expect(calledUrl).toContain('amount=21000')
            expect(calledUrl).toContain('nostr=')
            expect(calledUrl).toContain(`lnurl=${zapper.lnurl}`)
        } finally {
            globalThis.fetch = orig
        }
    })

    test('ohne pr → Fehler mit reason', async () => {
        const orig = globalThis.fetch
        globalThis.fetch = (async () => ({ json: async () => ({ reason: 'zu klein' }) })) as unknown as typeof fetch
        try {
            const res = await requestZap({ zapper, event: signed })
            expect(res.invoice).toBeUndefined()
            expect(res.error).toBe('zu klein')
        } finally {
            globalThis.fetch = orig
        }
    })
})

test.describe('mapZapError (deutsche Fehler-Übersetzung, ZAPS.md Z6)', () => {
    test('Netzwerkfehler → Zapper nicht erreichbar', () => {
        expect(mapZapError(new TypeError('Failed to fetch'))).toBe('Zapper nicht erreichbar — bitte später erneut versuchen.')
    })

    test('Wallet-Ablehnung → abgelehnt', () => {
        expect(mapZapError(new Error('payment rejected'))).toBe('Wallet hat die Zahlung abgelehnt.')
    })

    test('zu wenig Guthaben → Zahlung fehlgeschlagen', () => {
        expect(mapZapError(new Error('insufficient balance'))).toBe('Zahlung fehlgeschlagen — Wallet-Guthaben reicht nicht.')
    })

    test('kein Signer → anmelden', () => {
        expect(mapZapError(new Error('Kein aktiver Signer.'))).toBe('Bitte zuerst anmelden, um zu zappen.')
    })

    test('bereits deutsche Fehler bleiben unverändert (durchgereicht)', () => {
        expect(mapZapError(new Error('Dieser Empfänger kann keine Zaps annehmen.'))).toBe('Dieser Empfänger kann keine Zaps annehmen.')
        expect(mapZapError(new Error('Rechnung konnte nicht abgerufen werden.'))).toBe('Rechnung konnte nicht abgerufen werden.')
    })

    test('leerer/unbekannter Fehler → generischer Fallback', () => {
        expect(mapZapError(undefined)).toBe('Zap fehlgeschlagen.')
    })
})
