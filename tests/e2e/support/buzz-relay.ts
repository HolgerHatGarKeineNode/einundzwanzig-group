import { createServer } from 'node:http'
import { type AddressInfo } from 'node:net'
import { WebSocketServer } from 'ws'

/**
 * P5 — ein winziger, In-Process-Relay, der sich als **Buzz** ausgibt, um
 * `RECONNECT_MIN_GAP_MS` (`js/verein.ts`) ohne den echten Buzz-Rust-Stack zu
 * kalibrieren.
 *
 * Kein Nachbau von Buzz' Protokoll — nur die zwei Dinge, an denen `_reconnectDirectory`
 * überhaupt hängt:
 *   1. Das NIP-11-Dokument trägt `software: block/buzz` (→ `isBuzzRelay` true,
 *      `relayCaps.ts`) und `self` (→ `deriveRelaySelfReady`, `repository.ts`), ohne
 *      beides bliebe der Directory-Lesevorgang für immer im Skeleton.
 *   2. Jedes `REQ` auf 13534/33534 wird SOFORT mit `EOSE` beantwortet — eine leere
 *      Mitgliederliste ist ein gültiger Zustand (kein Mitglied) und hält den
 *      Nachfass-Plan am Laufen (`isMember` bleibt false, `_scheduleFollowUp` reschedult).
 *
 * `connectionCount()` ist die eigentliche Messgröße: `Pool.remove()` (welshman)
 * schließt den bestehenden Socket, der nächste `Pool.get()` öffnet einen NEUEN —
 * der Server zählt seine `connection`-Events selbst, unabhängig vom Browser.
 */
export type FakeBuzzRelay = {
    url: string
    connectionCount: () => number
    close: () => Promise<void>
}

export async function startFakeBuzzRelay(): Promise<FakeBuzzRelay> {
    const selfPubkey = 'f'.repeat(64)

    const httpServer = createServer((_req, res) => {
        res.writeHead(200, {
            'Content-Type': 'application/nostr+json',
            'Access-Control-Allow-Origin': '*',
        })
        res.end(
            JSON.stringify({
                name: 'e2e-fake-buzz',
                software: 'https://github.com/block/buzz',
                supported_nips: [29],
                self: selfPubkey,
            }),
        )
    })

    const wss = new WebSocketServer({ server: httpServer })
    httpServer.listen(0, '127.0.0.1')
    await new Promise<void>((resolve) => httpServer.once('listening', resolve))
    const port = (httpServer.address() as AddressInfo).port

    let connections = 0

    wss.on('connection', (ws) => {
        connections += 1

        ws.on('message', (raw) => {
            let msg: unknown[]

            try {
                msg = JSON.parse(raw.toString())
            } catch {
                return
            }

            const [type, ...rest] = msg as [string, ...unknown[]]

            // Nur REQ zählt hier: keine Events liegen vor (leere Mitgliederliste),
            // ein sofortiges EOSE genügt, damit `markDirectoryLoaded` feuert.
            if (type === 'REQ') {
                const [subId] = rest as [string]
                ws.send(JSON.stringify(['EOSE', subId]))
            }
        })
    })

    return {
        url: `ws://127.0.0.1:${port}/`,
        connectionCount: () => connections,
        close: () =>
            new Promise<void>((resolve) => {
                for (const client of wss.clients) {
                    client.terminate()
                }
                wss.close(() => httpServer.close(() => resolve()))
            }),
    }
}
