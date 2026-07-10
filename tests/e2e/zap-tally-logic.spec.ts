import { test, expect } from '@playwright/test'
import { fromMsats, type TrustedEvent, type Zapper } from '@welshman/util'
import { aggregateZaps } from '../../packages/einundzwanzig-group/js/feeds'

/**
 * ZAPS.md Z3 JS-Unit (welshman-app-frei): der 9735-Receipt-Tally des Feeds. Prüft die
 * Anti-Spoof-Validierung (`zapFromEvent` via `aggregateZaps`) — Selbst-Zap/Betrags-
 * Mismatch/falscher Receipt-Signer fliegen raus — plus Summe (msats→sats), `mine`-Flag
 * und deduplizierte Namen. Rohe 9735 NIE summieren; nur validierte Zaps zählen.
 */

const RECIPIENT = 'cc'.repeat(32) // Empfänger (Autor der Nachricht)
const SERVER = 'aa'.repeat(32) // nostrPubkey des LNURL-Servers (signiert das 9735)
const ALICE = 'a1'.repeat(32) // Zapper 1
const BOB = 'b2'.repeat(32) // Zapper 2

const zapper: Zapper = {
    lnurl: 'lnurl1dp68gurn8ghj7ur',
    nostrPubkey: SERVER,
    allowsNostr: true,
    minSendable: 1000,
    maxSendable: 100_000_000,
}

const nameOf = (pk: string): string => ({ [ALICE]: 'Alice', [BOB]: 'Bob' }[pk] ?? pk)

/** bolt11-HRP für einen msats-Betrag (nur `getInvoiceAmount` matcht `lnbc<val>n`). */
const bolt11For = (msats: number): string => `lnbc${msats / 100}n1restwirdignoriert`

/** Ein kind-9735-Receipt bauen: eingebettete 9734 (`description`) + bolt11 + p/e-Tags. */
const makeReceipt = ({
    signer = SERVER,
    sender,
    p = RECIPIENT,
    e = 'msg-1',
    reqMsats,
    invoiceMsats = reqMsats,
    lnurl = zapper.lnurl,
}: {
    signer?: string
    sender: string
    p?: string
    e?: string
    reqMsats: number
    invoiceMsats?: number
    lnurl?: string
}): TrustedEvent => {
    const request = { kind: 9734, pubkey: sender, created_at: 0, tags: [['amount', String(reqMsats)], ['lnurl', lnurl]], content: '⚡' }
    return {
        id: `receipt-${sender}-${e}`,
        kind: 9735,
        pubkey: signer,
        created_at: 0,
        content: '',
        sig: '',
        tags: [
            ['bolt11', bolt11For(invoiceMsats)],
            ['description', JSON.stringify(request)],
            ['p', p],
            ['e', e],
        ],
    } as TrustedEvent
}

test.describe('aggregateZaps (validierter 9735-Tally)', () => {
    test('ein gültiger Zap: count 1, Summe in Sats, mine false, Name gesetzt', () => {
        const zaps = aggregateZaps([makeReceipt({ sender: ALICE, reqMsats: 21_000 })], zapper, null, nameOf)
        expect(zaps.count).toBe(1)
        expect(zaps.sats).toBe(fromMsats(21_000)) // 21
        expect(zaps.mine).toBe(false)
        expect(zaps.names).toBe('Alice')
    })

    test('zwei gültige Zaps: Summe addiert, count 2, Namen kommagetrennt', () => {
        const zaps = aggregateZaps(
            [makeReceipt({ sender: ALICE, reqMsats: 21_000 }), makeReceipt({ sender: BOB, reqMsats: 210_000, e: 'msg-1b' })],
            zapper,
            null,
            nameOf,
        )
        expect(zaps.count).toBe(2)
        expect(zaps.sats).toBe(fromMsats(231_000)) // 21 + 210
        expect(zaps.names).toBe('Alice, Bob')
    })

    test('mine-Flag: eigener Pubkey unter den Zappern', () => {
        const zaps = aggregateZaps([makeReceipt({ sender: ALICE, reqMsats: 21_000 })], zapper, ALICE, nameOf)
        expect(zaps.mine).toBe(true)
    })

    test('doppelter Zapper: count 2, aber Name nur einmal (dedupliziert)', () => {
        const zaps = aggregateZaps(
            [makeReceipt({ sender: ALICE, reqMsats: 21_000 }), makeReceipt({ sender: ALICE, reqMsats: 21_000, e: 'msg-1c' })],
            zapper,
            null,
            nameOf,
        )
        expect(zaps.count).toBe(2)
        expect(zaps.names).toBe('Alice')
    })

    test('falscher Receipt-Signer (≠ zapper.nostrPubkey) wird verworfen', () => {
        const zaps = aggregateZaps([makeReceipt({ sender: ALICE, signer: 'ff'.repeat(32), reqMsats: 21_000 })], zapper, null, nameOf)
        expect(zaps.count).toBe(0)
        expect(zaps.sats).toBe(0)
    })

    test('Betrags-Mismatch (bolt11 ≠ amount-Tag) wird verworfen', () => {
        const zaps = aggregateZaps([makeReceipt({ sender: ALICE, reqMsats: 21_000, invoiceMsats: 210_000 })], zapper, null, nameOf)
        expect(zaps.count).toBe(0)
    })

    test('falscher lnurl in der Zap-Request wird verworfen', () => {
        const zaps = aggregateZaps([makeReceipt({ sender: ALICE, reqMsats: 21_000, lnurl: 'lnurl1fremd' })], zapper, null, nameOf)
        expect(zaps.count).toBe(0)
    })

    test('ohne aufgelösten Zapper zählt nichts (Signer nicht prüfbar)', () => {
        const zaps = aggregateZaps([makeReceipt({ sender: ALICE, reqMsats: 21_000 })], undefined, null, nameOf)
        expect(zaps.count).toBe(0)
    })

    test('keine Receipts: leere, aber wohldefinierte Summary', () => {
        const zaps = aggregateZaps([], zapper, null, nameOf)
        expect(zaps).toEqual({ count: 0, sats: 0, mine: false, names: '' })
    })
})
