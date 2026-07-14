import { test, expect } from './support/fixtures'
import { fromMsats, getInvoiceAmount, getLnUrl, getWalletAddress, toMsats, WalletType } from '@welshman/util'
import { nwc } from '@getalby/sdk'
import { Invoice } from '@getalby/lightning-tools/bolt11'

/**
 * ZAPS.md Z0 JS-Unit: die welshman/@getalby-Primitive, auf die `js/wallet.ts`
 * baut — reine Umrechnung/Parser, kein Browser, keine Relay-Runtime. (Der
 * WebCrypto-/IndexedDB-Round-Trip von secure-storage braucht einen Browser und
 * lebt im E2E-Härtungstest, Z6.)
 */

// BOLT11-Testvektor aus der Spec: 2500u = 250 000 000 msats = 250 000 Sats.
const BOLT11_2500U =
    'lnbc2500u1pvjluezpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdq5xysxxatsyp3k7enxv4jsxqzpuaztrnwngzn3kdzw5hydlzf03qdgm2hdq27cqv3agm2awhz5se903vruatfhq77w3ls4evs3ch9zw97j25emudupq63nyw24cg27h2rspfj9srp'

test('toMsats/fromMsats rechnen Sats↔Millisats (floor)', () => {
    expect(toMsats(21)).toBe(21000)
    expect(fromMsats(21000)).toBe(21)
    expect(fromMsats(21999)).toBe(21)
})

test('getWalletAddress liefert die lud16 nur bei NWC', () => {
    const nwcWallet = {
        type: WalletType.NWC,
        info: { lud16: 'alice@example.com', secret: 's', relayUrl: 'wss://r/', walletPubkey: 'pk', nostrWalletConnectUrl: '' },
    } as const
    expect(getWalletAddress(nwcWallet)).toBe('alice@example.com')
    expect(getWalletAddress({ type: WalletType.WebLN, info: {} } as const)).toBeUndefined()
})

test('NWCClient.parseWalletConnectUrl zerlegt den Verbindungs-String', () => {
    const url =
        'nostr+walletconnect://abc123def456?relay=wss%3A%2F%2Frelay.example%2F&secret=deadbeef&lud16=me%40example.com'
    const o = nwc.NWCClient.parseWalletConnectUrl(url)
    expect(o.walletPubkey).toBe('abc123def456')
    expect(o.relayUrl).toBe('wss://relay.example/')
    expect(o.secret).toBe('deadbeef')
    expect(o.lud16).toBe('me@example.com')
})

test('bolt11 wird zu Betrag geparst (welshman + @getalby stimmen überein)', () => {
    expect(getInvoiceAmount(BOLT11_2500U)).toBe(250_000_000) // msats
    const invoice = new Invoice({ pr: BOLT11_2500U })
    expect(invoice.satoshi).toBe(250_000) // sats
    expect(fromMsats(getInvoiceAmount(BOLT11_2500U))).toBe(invoice.satoshi)
})

test('getLnUrl bildet aus lud16 die .well-known/lnurlp-bech32', () => {
    const lnurl = getLnUrl('alice@example.com')
    expect(lnurl?.startsWith('lnurl1')).toBe(true)
    // rund: idempotent für bereits-lnurl-Eingaben
    expect(getLnUrl(lnurl!)).toBe(lnurl)
})
