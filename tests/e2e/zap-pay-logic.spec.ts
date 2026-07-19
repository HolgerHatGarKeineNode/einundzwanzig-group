import { test, expect } from './support/fixtures'
import { ZAP_RESPONSE, type SignedEvent, type Zapper } from '@welshman/util'
import { request } from '@welshman/net'
import {
    chooseZapMethod,
    payZapAuto,
    payZapPlain,
    watchZapReceipt,
    canPay,
    plainInvoiceUrl,
    RECEIPT_WAIT,
} from '../../packages/einundzwanzig-group/js/zaps'

/**
 * ZAPS.md Z2 JS-Unit (welshman-app-frei): der Zahlweg-Router + die Glue der beiden
 * Zahlwege (Auto-Pay Z2a, QR-Live-Sub Z2b) gegen Stubs. Kein Browser, kein Relay —
 * Wallet/Signer/Relay-Runtime sind über die `deps`-Seams injiziert.
 */

const zapper: Zapper = {
    lnurl: 'lnurl1dp68gurn8ghj7ur',
    callback: 'https://ln.example/lnurl/callback',
    nostrPubkey: 'aa'.repeat(32),
    allowsNostr: true,
    minSendable: 1000,
    maxSendable: 100_000_000,
}

test.describe('chooseZapMethod (flotilla ZapButton-Router)', () => {
    test('info ohne zappbaren Empfänger, sonst auto mit Wallet / invoice ohne', () => {
        expect(chooseZapMethod(undefined, true)).toBe('info')
        expect(chooseZapMethod({ ...zapper, allowsNostr: false }, true)).toBe('info')
        expect(chooseZapMethod({ ...zapper, nostrPubkey: undefined }, true)).toBe('info')
        expect(chooseZapMethod(zapper, true)).toBe('auto')
        expect(chooseZapMethod(zapper, false)).toBe('invoice')
    })
})

test.describe('payZapAuto (Z2a: zahlen + auf das Receipt lauschen)', () => {
    const result = { invoice: 'lnbc210n1teststub', event: {} as SignedEvent, zapper, relays: ['wss://space/'] }
    const input = { pubkey: 'bob', sats: 21, eventId: 'evt123', url: 'wss://space/' }

    /** Sub-Stub: ruft `onEvent` erst nach `delayMs` (bzw. nie), wie ein echter LNURL-Server. */
    const subAfter = (delayMs: number | null) => {
        const calls: Record<string, unknown>[] = []
        const sub = ((opts: Record<string, unknown>) => {
            calls.push(opts)
            if (delayMs !== null) {
                setTimeout(() => (opts.onEvent as (e: unknown, u: string) => void)?.({ kind: ZAP_RESPONSE }, 'wss://space/'), delayMs)
            }
        }) as unknown as typeof request
        return { sub, calls }
    }

    test('zahlt die Rechnung und lauscht mit korrektem Filter/Relays', async () => {
        const paid: string[] = []
        const { sub, calls } = subAfter(10)
        const out = await payZapAuto(input, {
            createInvoice: async () => result,
            pay: async (invoice: string) => {
                paid.push(invoice)
                return { preimage: 'stub' }
            },
            subscribe: sub,
        })

        expect(out).toMatchObject({ ...result, receiptSeen: true })
        expect(paid).toEqual(['lnbc210n1teststub'])
        // Gelauscht wird auf exakt demselben Relay-Satz wie im 9734-relays-Tag.
        expect(calls[0].relays).toBe(result.relays)
        const filter = (calls[0].filters as Record<string, unknown>[])[0]
        expect(filter.kinds).toEqual([ZAP_RESPONSE])
        expect(filter.authors).toEqual([zapper.nostrPubkey])
        expect(filter['#p']).toEqual(['bob'])
        expect(filter['#e']).toEqual(['evt123'])
    })

    // DER Regressionsanker: flotillas einmaliges `load` direkt nach `pay` kommt schon beim
    // EOSE zurück (Bruchteile einer Sekunde), der LNURL-Server stellt das 9735 aber erst
    // 1–3 s später aus. Ein One-Shot-Load verlöre das Receipt dauerhaft — die Live-Sub nicht.
    test('ein erst nach 1,5 s publiziertes Receipt wird noch erkannt (kein One-Shot-Rennen)', async () => {
        const { sub } = subAfter(1500)
        const out = await payZapAuto(input, {
            createInvoice: async () => result,
            pay: async () => ({ preimage: 'stub' }),
            subscribe: sub,
        })
        expect(out.receiptSeen).toBe(true)
    })

    // Nach `pay` darf NICHTS mehr werfen: sonst Fehler-Toast trotz gezahltem Zap → Doppelzahlung.
    test('eine werfende Receipt-Sub kippt die bereits erfolgte Zahlung NICHT', async () => {
        const paid: string[] = []
        const out = await payZapAuto(input, {
            createInvoice: async () => result,
            pay: async (invoice: string) => {
                paid.push(invoice)
                return { preimage: 'stub' }
            },
            subscribe: (() => {
                throw new Error('auth-required: authentication is required for access')
            }) as unknown as typeof request,
        })
        expect(out).toMatchObject({ ...result, receiptSeen: false })
        expect(paid).toEqual(['lnbc210n1teststub'])
    })

    test('bleibt das Receipt aus, meldet payZapAuto nach RECEIPT_WAIT „nicht gesehen" statt zu hängen', async () => {
        const started = Date.now()
        const { sub } = subAfter(null) // Receipt kommt nie
        const out = await payZapAuto(input, {
            createInvoice: async () => result,
            pay: async () => ({ preimage: 'stub' }),
            subscribe: sub,
        })
        expect(out.receiptSeen).toBe(false)
        expect(Date.now() - started).toBeGreaterThanOrEqual(RECEIPT_WAIT - 500)
        expect(Date.now() - started).toBeLessThan(RECEIPT_WAIT + 5000)
    })

    test('schlägt die Zahlung fehl, wird gar nicht erst gelauscht (Reihenfolge)', async () => {
        let subscribed = false
        await expect(
            payZapAuto(input, {
                createInvoice: async () => result,
                pay: async () => {
                    throw new Error('Wallet lehnte ab')
                },
                subscribe: (() => {
                    subscribed = true
                }) as unknown as typeof request,
            }),
        ).rejects.toThrow('Wallet lehnte ab')
        expect(subscribed).toBe(false)
    })
})

test.describe('plainInvoiceUrl (Callback-URL ohne nostr)', () => {
    const cb = 'https://ln.example/lnurl/callback'

    test('nur amount in msats, wenn kein Kommentar/commentAllowed', () => {
        expect(plainInvoiceUrl(zapper, 21)).toBe(`${cb}?amount=21000`)
    })

    test('Kommentar nur wenn der Server ihn erlaubt (commentAllowed > 0), URL-kodiert', () => {
        const z = { ...zapper, commentAllowed: 50 } as Zapper
        expect(plainInvoiceUrl(z, 21, 'gm ⚡')).toBe(`${cb}?amount=21000&comment=gm%20%E2%9A%A1`)
    })

    test('ohne commentAllowed wird der Kommentar weggelassen', () => {
        expect(plainInvoiceUrl(zapper, 5, 'hallo')).toBe(`${cb}?amount=5000`)
    })

    test('Kommentar wird auf die erlaubte Länge gekürzt', () => {
        const z = { ...zapper, commentAllowed: 3 } as Zapper
        expect(plainInvoiceUrl(z, 1, 'abcdef')).toBe(`${cb}?amount=1000&comment=abc`)
    })

    test('kürzt nach Code-Points, ohne astrales Emoji zu zerteilen (kein URIError)', () => {
        const z = { ...zapper, commentAllowed: 3 } as Zapper
        // 'ab😀' = 3 Code-Points → bleibt vollständig; naives slice(0,3) hätte das 😀 zerschnitten.
        expect(() => plainInvoiceUrl(z, 1, 'ab😀x')).not.toThrow()
        expect(plainInvoiceUrl(z, 1, 'ab😀x')).toBe(`${cb}?amount=1000&comment=ab%F0%9F%98%80`)
    })

    test('Callback mit eigenem Query-Teil wird mit & erweitert (LUD-06)', () => {
        const z = { ...zapper, callback: 'https://ln.example/cb?id=7' } as Zapper
        expect(plainInvoiceUrl(z, 21)).toBe('https://ln.example/cb?id=7&amount=21000')
    })
})

test.describe('payZapPlain (Rechnung holen + zahlen, KEIN Receipt-Load)', () => {
    test('holt die Plain-Rechnung und zahlt sie', async () => {
        const paid: string[] = []
        await payZapPlain(
            { zapper, sats: 21, comment: '⚡' },
            {
                request: async () => 'lnbc210n1plainstub',
                pay: async (inv: string) => {
                    paid.push(inv)
                    return { preimage: 'stub' }
                },
            },
        )
        expect(paid).toEqual(['lnbc210n1plainstub'])
    })
})
