import { createServer } from 'node:http'
import { type AddressInfo } from 'node:net'
import { WebSocketServer, type WebSocket } from 'ws'

type Filter = {
    kinds?: number[]
    authors?: string[]
    ids?: string[]
    [key: `#${string}`]: string[] | undefined
}

type NostrEvent = {
    id: string
    pubkey: string
    kind: number
    tags: string[][]
    content: string
    created_at: number
    sig: string
}

export type LocalRelay = {
    url: string
    close: () => Promise<void>
}

/** Prüft ein Event gegen einen NIP-01-Filter (nur die hier genutzten Felder). */
function matches(filter: Filter, event: NostrEvent): boolean {
    if (filter.kinds && !filter.kinds.includes(event.kind)) {
        return false
    }
    if (filter.authors && !filter.authors.includes(event.pubkey)) {
        return false
    }
    if (filter.ids && !filter.ids.includes(event.id)) {
        return false
    }
    for (const [key, values] of Object.entries(filter)) {
        if (!key.startsWith('#') || !Array.isArray(values)) {
            continue
        }
        const tagName = key.slice(1)
        const eventValues = event.tags.filter((t) => t[0] === tagName).map((t) => t[1])
        if (!(values as string[]).some((v) => eventValues.includes(v))) {
            return false
        }
    }
    return true
}

/**
 * Minimaler In-Process-NIP-01-Relay (EVENT/REQ/CLOSE) als hermetischer
 * Transport für die NIP-46-Tests — kein öffentliches Relay, kein Netzwerk.
 * Store-and-replay macht das Setup timing-robust; der `#p`-Filter trennt
 * Client- und Bunker-Nachrichten sauber.
 */
export async function startRelay(): Promise<LocalRelay> {
    // HTTP-Handler für das NIP-11-Dokument (welshman holt es vor dem Connect) —
    // inkl. CORS, sonst blockt der Browser den Relay-Fetch.
    const httpServer = createServer((_req, res) => {
        res.writeHead(200, {
            'Content-Type': 'application/nostr+json',
            'Access-Control-Allow-Origin': '*',
        })
        res.end(JSON.stringify({ name: 'e2e-local-relay', supported_nips: [1] }))
    })
    const wss = new WebSocketServer({ server: httpServer })
    httpServer.listen(0, '127.0.0.1')
    await new Promise<void>((resolve) => httpServer.once('listening', resolve))
    const port = (httpServer.address() as AddressInfo).port

    const events: NostrEvent[] = []
    const subs = new Map<WebSocket, Map<string, Filter[]>>()

    wss.on('connection', (ws) => {
        subs.set(ws, new Map())

        ws.on('message', (raw) => {
            let msg: unknown[]
            try {
                msg = JSON.parse(raw.toString())
            } catch {
                return
            }
            const [type, ...rest] = msg as [string, ...unknown[]]

            if (type === 'EVENT') {
                const event = rest[0] as NostrEvent
                events.push(event)
                for (const client of wss.clients) {
                    for (const [subId, filters] of subs.get(client) ?? []) {
                        if (filters.some((f) => matches(f, event))) {
                            client.send(JSON.stringify(['EVENT', subId, event]))
                        }
                    }
                }
                ws.send(JSON.stringify(['OK', event.id, true, '']))
            } else if (type === 'REQ') {
                const [subId, ...filters] = rest as [string, ...Filter[]]
                subs.get(ws)?.set(subId, filters)
                for (const event of events) {
                    if (filters.some((f) => matches(f, event))) {
                        ws.send(JSON.stringify(['EVENT', subId, event]))
                    }
                }
                ws.send(JSON.stringify(['EOSE', subId]))
            } else if (type === 'CLOSE') {
                subs.get(ws)?.delete(rest[0] as string)
            }
        })

        ws.on('close', () => subs.delete(ws))
    })

    return {
        url: `ws://127.0.0.1:${port}/`,
        close: () =>
            new Promise<void>((resolve) => {
                for (const client of wss.clients) {
                    client.terminate()
                }
                wss.close(() => httpServer.close(() => resolve()))
            }),
    }
}
