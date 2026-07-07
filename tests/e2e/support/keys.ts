import { getPublicKey } from 'nostr-tools/pure'
import { decode, npubEncode } from 'nostr-tools/nip19'

/**
 * Der Wegwerf-Testschlüssel aus `.env` (`NOSTR_TEST_NSEC`). Kein realer Key —
 * dient nur den E2E-Login-Tests und ist bewusst wiederverwendbar fixiert.
 */
export function testKeys(): { sk: Uint8Array; pk: string; npub: string } {
    const nsec = process.env.NOSTR_TEST_NSEC
    if (!nsec) {
        throw new Error('NOSTR_TEST_NSEC fehlt in .env')
    }

    const decoded = decode(nsec)
    if (decoded.type !== 'nsec') {
        throw new Error('NOSTR_TEST_NSEC ist kein nsec.')
    }

    const sk = decoded.data
    const pk = getPublicKey(sk)

    return { sk, pk, npub: npubEncode(pk) }
}
