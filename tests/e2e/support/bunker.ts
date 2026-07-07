import { WebSocket } from 'ws'
import { finalizeEvent, getPublicKey } from 'nostr-tools/pure'
import { nip44 } from 'nostr-tools'

const NOSTR_CONNECT = 24133

export type FakeBunker = {
    /** bunker://-URI zum Einfügen ins Login-Feld. */
    uri: string
    close: () => void
}

/**
 * Minimaler NIP-46-Signer („Bunker") in Node, der über den lokalen Relay auf
 * Signatur-Anfragen des Browser-Clients antwortet — signiert mit dem Wegwerf-Key.
 * Deckt zugleich Amber-als-Nostr-Connect ab (gleiches Protokoll). Verschlüsselung
 * ist NIP-44 (welshman-Default). Signer- und User-pubkey sind identisch (Self-Bunker).
 */
export async function startBunker(relayUrl: string, sk: Uint8Array): Promise<FakeBunker> {
    const signerPk = getPublicKey(sk)
    const secret = 'e2e-connect-secret'

    const ws = new WebSocket(relayUrl)
    await new Promise<void>((resolve, reject) => {
        ws.once('open', () => resolve())
        ws.once('error', reject)
    })

    // Auf Anfragen an unseren pubkey lauschen.
    ws.send(JSON.stringify(['REQ', 'bunker', { kinds: [NOSTR_CONNECT], '#p': [signerPk] }]))

    ws.on('message', (raw) => {
        let msg: unknown[]
        try {
            msg = JSON.parse(raw.toString())
        } catch {
            return
        }
        if (msg[0] !== 'EVENT' || msg[1] !== 'bunker') {
            return
        }

        const event = msg[2] as { pubkey: string; content: string }
        const clientPk = event.pubkey
        const convKey = nip44.getConversationKey(sk, clientPk)

        let request: { id: string; method: string; params: string[] }
        try {
            request = JSON.parse(nip44.decrypt(event.content, convKey))
        } catch {
            return
        }

        let result = ''
        if (request.method === 'get_public_key') {
            result = signerPk
        } else if (request.method === 'ping') {
            result = 'pong'
        } else if (request.method === 'sign_event') {
            const template = JSON.parse(request.params[0])
            result = JSON.stringify(finalizeEvent(template, sk))
        } else {
            // connect, switch_relays und alles andere: bestätigen.
            result = 'ack'
        }

        const response = finalizeEvent(
            {
                kind: NOSTR_CONNECT,
                created_at: Math.floor(Date.now() / 1000),
                tags: [['p', clientPk]],
                content: nip44.encrypt(JSON.stringify({ id: request.id, result }), convKey),
            },
            sk,
        )
        ws.send(JSON.stringify(['EVENT', response]))
    })

    const uri = `bunker://${signerPk}?relay=${encodeURIComponent(relayUrl)}&secret=${secret}`

    return {
        uri,
        close: () => ws.close(),
    }
}
