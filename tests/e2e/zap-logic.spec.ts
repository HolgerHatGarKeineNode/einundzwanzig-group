import { test, expect } from './support/fixtures'
import { type SignedEvent, type Zapper } from '@welshman/util'
import {
    canZap,
    invoiceRequestError,
    lnurlCallbackUrl,
    lnurlErrorReason,
    mapZapError,
    requestZapInvoice,
    zapRequestTemplate,
} from '../../packages/einundzwanzig-group/js/zaps'

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

test.describe('lnurlCallbackUrl (LUD-06 `<callback><?|&>amount=`)', () => {
    test('hängt mit ? an, wenn der Callback keinen Query-Teil hat', () => {
        expect(lnurlCallbackUrl('https://ln.example/cb', { amount: '21000' })).toBe('https://ln.example/cb?amount=21000')
    })

    test('hängt mit & an, wenn der Callback schon einen Query-Teil trägt (sonst kaputte URL)', () => {
        const url = lnurlCallbackUrl('https://ln.example/cb?id=7', { amount: '21000' })
        expect(url).toBe('https://ln.example/cb?id=7&amount=21000')
        expect(new URL(url).searchParams.get('amount')).toBe('21000')
    })

    test('leere Werte fallen raus (kein &comment=)', () => {
        expect(lnurlCallbackUrl('https://ln.example/cb', { amount: '1000', comment: '' })).toBe('https://ln.example/cb?amount=1000')
    })
})

test.describe('requestZapInvoice (LNURL-Callback-Vertrag → bolt11)', () => {
    // Signierte 9734 (nur die von requestZapInvoice gelesenen Felder: amount-Tag + Event-JSON).
    const signed = { kind: 9734, tags: [['amount', '21000']], content: '⚡' } as unknown as SignedEvent

    // Stub bildet eine echte Response nach: `requestZapInvoice` liest Status UND rohen
    // Body (reale LNURL-Server antworten im Fehlerfall mit PLAIN TEXT, nicht mit JSON).
    const withFetch = async <T>(handler: (url: string) => unknown, fn: () => Promise<T>, status = 200): Promise<T> => {
        const orig = globalThis.fetch
        globalThis.fetch = (async (url: string) => {
            const out = handler(String(url))
            return { status, text: async () => (typeof out === 'string' ? out : JSON.stringify(out)) }
        }) as unknown as typeof fetch
        try {
            return await fn()
        } finally {
            globalThis.fetch = orig
        }
    }

    test('baut ?amount=&nostr=&lnurl= und liefert die bolt11 aus res.pr', async () => {
        let calledUrl = ''
        const res = await withFetch(
            (url) => {
                calledUrl = url
                return { pr: 'lnbc210n1teststub' }
            },
            () => requestZapInvoice({ zapper, event: signed }),
        )
        expect(res.invoice).toBe('lnbc210n1teststub')
        expect(calledUrl).toContain('https://ln.example/lnurl/callback')
        expect(calledUrl).toContain('amount=21000')
        expect(calledUrl).toContain('nostr=')
        expect(calledUrl).toContain(`lnurl=${zapper.lnurl}`)
    })

    // Der Kern-Regressionstest: `encodeURI` (welshman) lässt `& = + #` stehen → der `nostr`-
    // Parameter wird zerschnitten (`&`,`#`) bzw. der content still verändert (`+`→Leerzeichen),
    // was die Schnorr-Signatur der 9734 bricht. `encodeURIComponent` hält das Event heil.
    for (const content of ['Kaffee & Kuchen', 'a&b=c', '1+1', 'Nr. #21', 'gm ⚡', '100% ja?']) {
        test(`Kommentar ${JSON.stringify(content)} kommt unverändert im nostr-Parameter an`, async () => {
            const event = { ...signed, content } as unknown as SignedEvent
            let calledUrl = ''
            await withFetch(
                (url) => {
                    calledUrl = url
                    return { pr: 'lnbc1stub' }
                },
                () => requestZapInvoice({ zapper, event }),
            )
            const parsed = JSON.parse(new URL(calledUrl).searchParams.get('nostr') ?? '')
            expect(parsed.content).toBe(content)
            expect(new URL(calledUrl).searchParams.get('lnurl')).toBe(zapper.lnurl)
        })
    }

    test('LUD-06-JSON-Fehler: reason landet in der Meldung', async () => {
        const res = await withFetch(
            () => ({ status: 'ERROR', reason: 'zu klein' }),
            () => requestZapInvoice({ zapper, event: signed }),
        )
        expect(res.invoice).toBeUndefined()
        expect(res.error).toContain('zu klein')
    })

    // primal.net antwortet gemessen mit PLAIN TEXT (`invalid zap request`, HTTP 406).
    // welshmans fetchJson wirft daran und der echte Grund ging verloren.
    test('Plain-Text-Fehlerbody wird ausgewertet statt verschluckt', async () => {
        const res = await withFetch(
            () => 'invalid zap request',
            () => requestZapInvoice({ zapper, event: signed }),
            406,
        )
        expect(res.invoice).toBeUndefined()
        expect(res.error).toContain('HTTP 406')
        expect(res.error).toContain('invalid zap request')
    })

    test('Netzwerkfehler wird als UNSER Ende der Leitung benannt', async () => {
        const orig = globalThis.fetch
        globalThis.fetch = (async () => {
            throw new TypeError('NetworkError when attempting to fetch resource.')
        }) as unknown as typeof fetch
        try {
            const res = await requestZapInvoice({ zapper, event: signed })
            expect(res.error).toContain('nicht erreichbar')
            expect(res.error).toContain('NetworkError')
        } finally {
            globalThis.fetch = orig
        }
    })

    test('ohne callback → deutscher Fehler statt Netzwerk-Versuch', async () => {
        const res = await requestZapInvoice({ zapper: { ...zapper, callback: undefined }, event: signed })
        expect(res.error).toBe('Empfänger hat keinen Zahlungs-Endpoint.')
    })
})

test.describe('lnurlErrorReason (auch Nicht-LUD-06-Fehlerformen)', () => {
    test('LUD-06 reason hat Vorrang', () => {
        expect(lnurlErrorReason({ status: 'ERROR', reason: 'Amount too low' })).toBe('Amount too low')
    })

    test('Alby-Form {error,message} wird gelesen statt verschluckt', () => {
        expect(lnurlErrorReason({ error: true, message: 'invalid zap request' })).toBe('invalid zap request')
    })

    test('ohne verwertbaren Grund undefined (→ generische Meldung)', () => {
        expect(lnurlErrorReason({ pr: null })).toBeUndefined()
        expect(lnurlErrorReason(undefined)).toBeUndefined()
    })
})

test.describe('invoiceRequestError (Empfänger-LNURL liefert keine bolt11, ZAPS.md Z6)', () => {
    test('Originaltext des Servers + HTTP-Status bleiben sichtbar', () => {
        const msg = invoiceRequestError('invalid zap request', 406)
        expect(msg).toContain('HTTP 406')
        expect(msg).toContain('invalid zap request')
        // mapZapError reicht die (deutsche) Meldung unverändert bis zum Nutzer durch.
        expect(mapZapError(new Error(msg))).toBe(msg)
    })

    test('erfindet KEINE Ursache, wenn der Server keine Begründung liefert', () => {
        const msg = invoiceRequestError()
        expect(msg).toContain('ohne Begründung')
        // Die alte Fassung behauptete eine Schuldzuweisung — die darf nie zurückkommen.
        expect(msg).not.toContain('nicht an dir')
        expect(msg).not.toContain('liegt beim Empfänger')
    })

    test('nackter Servertext ohne Status wird trotzdem geführt', () => {
        expect(invoiceRequestError('Amount too low')).toContain('Amount too low')
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
