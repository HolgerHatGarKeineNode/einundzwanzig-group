import { test, expect } from './support/fixtures'
import { ZAP_RESPONSE, type SignedEvent, type Zapper } from '@welshman/util'
import { request } from '@welshman/net'
import { chooseZapMethod, payZapAuto, payZapPlain, watchZapReceipt, canPay, plainInvoiceQuery } from '../../packages/einundzwanzig-group/js/zaps'

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

test.describe('payZapAuto (Z2a: zahlen + Receipt nachladen)', () => {
    const result = { invoice: 'lnbc210n1teststub', event: {} as SignedEvent, zapper, relays: ['wss://space/'] }

    test('zahlt die Rechnung und lädt das 9735-Receipt mit korrektem Filter/Relays', async () => {
        const paid: string[] = []
        let loaded: { relays: string[]; filters: Record<string, unknown>[] } | undefined

        const out = await payZapAuto(
            { pubkey: 'bob', sats: 21, eventId: 'evt123', url: 'wss://space/' },
            {
                createInvoice: async () => result,
                pay: async (invoice: string) => {
                    paid.push(invoice)
                    return { preimage: 'stub' }
                },
                loadReceipt: async (opts) => {
                    loaded = opts as typeof loaded
                    return []
                },
            },
        )

        expect(out).toBe(result)
        expect(paid).toEqual(['lnbc210n1teststub'])
        // Receipt wird über exakt denselben Relay-Satz geladen wie im 9734-relays-Tag.
        expect(loaded?.relays).toBe(result.relays)
        const filter = loaded!.filters[0]
        expect(filter.kinds).toEqual([ZAP_RESPONSE])
        expect(filter.authors).toEqual([zapper.nostrPubkey])
        expect(filter['#p']).toEqual(['bob'])
        expect(filter['#e']).toEqual(['evt123'])
    })

    test('schlägt die Zahlung fehl, wird das Receipt NICHT geladen (Reihenfolge)', async () => {
        let loadCalled = false
        await expect(
            payZapAuto(
                { pubkey: 'bob', sats: 21, url: 'wss://space/' },
                {
                    createInvoice: async () => result,
                    pay: async () => {
                        throw new Error('Wallet lehnte ab')
                    },
                    loadReceipt: async () => {
                        loadCalled = true
                        return []
                    },
                },
            ),
        ).rejects.toThrow('Wallet lehnte ab')
        expect(loadCalled).toBe(false)
    })
})

test.describe('watchZapReceipt (Z2b: Live-Sub auf 9735)', () => {
    test('öffnet die Sub mit Filter/Relays/Signal und feuert onReceived genau einmal', () => {
        type SubOpts = { relays: string[]; signal: AbortSignal; filters: Record<string, unknown>[]; onEvent: () => void }
        let opts: SubOpts | undefined
        let received = 0
        const controller = new AbortController()

        watchZapReceipt(
            { zapper, pubkey: 'bob', eventId: 'evt123', relays: ['wss://space/'], signal: controller.signal, onReceived: () => received++ },
            (async (o: SubOpts) => {
                opts = o
                return []
            }) as unknown as typeof request,
        )

        expect(opts?.relays).toEqual(['wss://space/'])
        expect(opts?.signal).toBe(controller.signal)
        expect(opts!.filters[0].authors).toEqual([zapper.nostrPubkey])

        opts!.onEvent()
        opts!.onEvent()
        expect(received).toBe(1)
    })

    test('Profil-Zap ohne eventId → Filter ohne #e (nur #p/authors)', () => {
        let opts: { filters: Record<string, unknown>[] } | undefined
        const controller = new AbortController()

        watchZapReceipt(
            { zapper, pubkey: 'bob', relays: ['wss://space/'], signal: controller.signal, onReceived: () => {} },
            (async (o: { filters: Record<string, unknown>[] }) => {
                opts = o
                return []
            }) as unknown as typeof request,
        )

        expect(opts!.filters[0]['#e']).toBeUndefined()
        expect(opts!.filters[0]['#p']).toEqual(['bob'])
    })
})

/**
 * Plain-LNURL-Pay (nostrless, Empfänger ohne NIP-57 wie bitrefill.com): der Callback wird
 * NUR mit amount(+comment) aufgerufen, es entsteht kein 9734/9735 → im Raum nicht sichtbar.
 */
test.describe('canPay (LNURL-Callback vorhanden = zahlbar, schwächer als canZap)', () => {
    test('true mit callback, false ohne', () => {
        expect(canPay(zapper)).toBe(true)
        expect(canPay({ ...zapper, callback: undefined })).toBe(false)
        expect(canPay(undefined)).toBe(false)
    })
})

test.describe('plainInvoiceQuery (Callback-Query ohne nostr)', () => {
    test('nur amount in msats, wenn kein Kommentar/commentAllowed', () => {
        expect(plainInvoiceQuery(zapper, 21)).toBe('?amount=21000')
    })

    test('Kommentar nur wenn der Server ihn erlaubt (commentAllowed > 0), URL-kodiert', () => {
        const z = { ...zapper, commentAllowed: 50 } as Zapper
        expect(plainInvoiceQuery(z, 21, 'gm ⚡')).toBe('?amount=21000&comment=gm%20%E2%9A%A1')
    })

    test('ohne commentAllowed wird der Kommentar weggelassen', () => {
        expect(plainInvoiceQuery(zapper, 5, 'hallo')).toBe('?amount=5000')
    })

    test('Kommentar wird auf die erlaubte Länge gekürzt', () => {
        const z = { ...zapper, commentAllowed: 3 } as Zapper
        expect(plainInvoiceQuery(z, 1, 'abcdef')).toBe('?amount=1000&comment=abc')
    })

    test('kürzt nach Code-Points, ohne astrales Emoji zu zerteilen (kein URIError)', () => {
        const z = { ...zapper, commentAllowed: 3 } as Zapper
        // 'ab😀' = 3 Code-Points → bleibt vollständig; naives slice(0,3) hätte das 😀 zerschnitten.
        expect(() => plainInvoiceQuery(z, 1, 'ab😀x')).not.toThrow()
        expect(plainInvoiceQuery(z, 1, 'ab😀x')).toBe('?amount=1000&comment=ab%F0%9F%98%80')
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
