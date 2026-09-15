import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import type { Duplex } from 'node:stream'
import type { AddressInfo } from 'node:net'
import { ZOOID_PORT, ZOOID_WS } from './zooid.ts'
import { freshKeypair } from './keys.ts'

/**
 * ── The wire side of the contact-list tests ─────────────────────────────────────────
 *
 * Everything in here answers one of two questions about a kind 3 on the RELAY: how does a
 * known one get there before a test starts, and what is on it after the surface has acted.
 * No browser, no store, no Alpine — the specs that use this measure the surface, and this
 * module is the independent witness they measure it against.
 *
 * **Why it is a module and not three copies.** `directory.spec.ts` (the P4 cases),
 * `follow.spec.ts` and `follow-bulk.spec.ts` all need a throwaway reader the relay lets
 * in, a seeded contact list of known size and — for two of them — a relay that completes
 * the handshake and then says nothing. The NIP-98 management call is duplicated across
 * seven specs in this suite and stays that way; a 40-line WebSocket handshake and the
 * admission bookkeeping are a different size of thing.
 *
 * **Every reader here is a FRESH keypair, never `NOSTR_TEST_NSEC`.** A kind 3 is
 * replaceable: written under the shared identity there is no second copy, so a parallel
 * spec reading it would be reading whatever another file wrote last. That is not a
 * hypothesis — on 2026-08-21 a replaceable kind 0 published under the shared identity took
 * down 14 unrelated tests.
 */

const NAK = process.env.NAK ?? `${process.env.HOME}/go/bin/nak`
const HTTP = `http://localhost:${ZOOID_PORT}/`

/**
 * Relay-owner secret (its pubkey is `relay.self`) — the only NIP-86 admin of the test
 * zooid, the same constant `zooid-testserver.sh` seeds with.
 */
export const RELAY_OWNER_SEC = 'b2ee09a54bedf17ee1db562bdddd75c48661d981eb52c49dc206c55ba8439414'

/** A NIP-86 management call as the relay owner (NIP-98 HTTP auth), like the seed script. */
export function mgmt(body: string): void {
    const hash = createHash('sha256').update(body).digest('hex')
    const evt = execFileSync(NAK, [
        'event', '-k', '27235', '--sec', RELAY_OWNER_SEC,
        '-t', `u=${HTTP}`, '-t', 'method=POST', '-t', `payload=${hash}`,
    ])
        .toString()
        .trim()
    const auth = Buffer.from(evt).toString('base64')
    execFileSync('curl', [
        '-s', '-X', 'POST', HTTP,
        '-H', 'Content-Type: application/nostr+json+rpc',
        '-H', `Authorization: Nostr ${auth}`,
        '-d', body,
    ])
}

/** A throwaway reader the relay lets in. The key is generated, never read from `.env`. */
export type WireReader = { pk: string; nsec: string; hex: string }

/** Every throwaway reader admitted so far — taken back out by {@link releaseAdmittedReaders}. */
const admitted: string[] = []

/**
 * A fresh keypair the relay admits.
 *
 * The test relay is member-only (`public_write=false`, like production), so a fresh key
 * needs `allowpubkey` before it may read the directory or publish at all — and that call
 * also puts it into the relay-signed 13534: measured on 2026-09-15, the member grid went
 * from 3 rows to 4 the moment one was admitted.
 */
export function admitReader(): WireReader {
    const key = freshKeypair()
    admitted.push(key.pk)
    mgmt(`{"method":"allowpubkey","params":["${key.pk}"]}`)

    return { pk: key.pk, nsec: key.nsec, hex: Buffer.from(key.sk).toString('hex') }
}

/**
 * Take every admitted reader back out of the relay — for an `afterAll`.
 *
 * The zooid instance deliberately survives the run (RUNMARK reuse) and its bloat guard
 * counts rooms, not members, so without this every run would leave its throwaway readers
 * standing in the space forever.
 *
 * Silent on failure and draining: a cleanup that throws would overwrite the finding of the
 * test with an infrastructure error, and a second file's `afterAll` in the same worker
 * must not release a reader twice.
 */
export function releaseAdmittedReaders(): void {
    for (const pk of admitted.splice(0, admitted.length)) {
        try {
            mgmt(`{"method":"unallowpubkey","params":["${pk}"]}`)
        } catch {
            // deliberately silent, see above
        }
    }
}

/** The authoritative base of a follow test: one kind 3 of known size under a fresh key. */
export function seedFollowList(
    reader: WireReader,
    targets: readonly string[],
    options: { content?: string; createdAt?: number } = {},
): void {
    execFileSync(NAK, [
        'event', '--auth', '--sec', reader.hex, '-k', '3',
        ...(options.content === undefined ? [] : ['-c', options.content]),
        ...(options.createdAt === undefined ? [] : ['--created-at', String(options.createdAt)]),
        ...targets.flatMap((pk) => ['-t', `p=${pk}`]), ZOOID_WS,
    ])
}

/**
 * **A `created_at` in the PAST, `secondsAgo` seconds back.**
 *
 * Every seeded contact list in these tests has to be older than whatever the client signs
 * afterwards, and „older" is not free: `makeEvent` stamps SECONDS, so a seed written in the
 * same second as the write ties — and on a tie zooid keeps the incoming event
 * (`events.go:440`, `<=`) while the client's own NIP-01 comparison decides by id hash. Two
 * different rules on a coin flip is a flake generator.
 *
 * A seed in the FUTURE is the other end of the same trap and it is worse, because it is
 * silent: zooid then drops every later client write without an error, the surface reports
 * success, and the test reads „nothing was written" as a product finding. Measured here on
 * 2026-09-15 — a seed at `now + 5` made a green write path look refused.
 */
export const secondsAgo = (seconds: number): number => Math.floor(Date.now() / 1000) - seconds

/** A kind 10002 under a fresh key: this reader declares where their contact list lives. */
export function seedRelayList(reader: WireReader, urls: readonly string[]): void {
    execFileSync(NAK, [
        'event', '--auth', '--sec', reader.hex, '-k', '10002',
        ...urls.flatMap((url) => ['-t', `r=${url}`]), ZOOID_WS,
    ])
}

/** What one relay holds as this reader's contact list — the witness, parsed. */
export type WireFollowList = {
    id: string
    created_at: number
    content: string
    /** The pubkeys of the `p` tags, in the order the event carries them. */
    p: string[]
    /** Every tag, so a test can assert that columns of an existing entry survived. */
    tags: string[][]
}

/**
 * **Read the reader's kind 3 back OFF THE RELAY.** `null` when there is none.
 *
 * `--auth` is not optional here even though this only reads, and that is measured rather
 * than assumed — the flag was taken out and one case run on 2026-09-15:
 *
 *     ws://localhost:3535 auth failed: auth required, but --auth flag not given
 *     ws://localhost:3535 CLOSED: auth-required: authentication is required for access
 *
 * Both lines go to STDERR; stdout stays empty and `nak` exits 0. So an unauthenticated
 * requery returns `null` here — indistinguishable from „the relay holds no contact list",
 * which is exactly the sentence half of these cases assert. The `-l 1` is the whole point
 * of a replaceable kind: whatever the relay hands back first is what it is holding.
 *
 * This is the one instrument in the follow tests that does not run through the client, and
 * that is why every wire assertion goes through it rather than through the store: the
 * damage state this whole plan exists for — 703 contacts replaced by a one-tag list — was
 * green on every surface the client renders.
 */
export function relayFollowList(reader: WireReader): WireFollowList | null {
    const out = execFileSync(NAK, [
        'req', '-k', '3', '-a', reader.pk, '-l', '1',
        '--auth', '--sec', reader.hex, ZOOID_WS,
    ]).toString()
    const line = out.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('{')).pop()
    if (!line) {
        return null
    }
    const event = JSON.parse(line) as { id: string; created_at: number; content: string; tags: string[][] }

    return {
        id: event.id,
        created_at: event.created_at,
        content: event.content,
        p: event.tags.filter((t) => t[0] === 'p').map((t) => t[1]),
        tags: event.tags,
    }
}

/**
 * **A relay that completes the handshake and then says nothing.**
 *
 * Not a dead port: „connection refused" and „connected, never answers" end at the same
 * verdict (`answered: false`), but only the second one is the state the surface was built
 * for. The read stands open until `READ_TIMEOUT_MS` (6 s, `js/follows.ts`), and that is
 * the wait that used to leave „Lädt…" on the button for the rest of the session.
 *
 * Port 0, so the kernel picks a free one: this cannot collide with any slot port of a
 * parallel worker (serve 8137+, board 8437+, zooid 3335+, buzz 3001+).
 *
 * Moved here out of `directory.spec.ts` when `follow.spec.ts` needed the same fixture for
 * the core proof, byte for byte; that file now imports it from here.
 */
export async function startSilentRelay(): Promise<{ url: string; label: string; close: () => Promise<void> }> {
    const open: Duplex[] = []
    const server = createServer()
    server.on('upgrade', (req, socket) => {
        open.push(socket)
        const key = String(req.headers['sec-websocket-key'] ?? '')
        const accept = createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64')
        socket.write(
            'HTTP/1.1 101 Switching Protocols\r\n'
            + 'Upgrade: websocket\r\n'
            + 'Connection: Upgrade\r\n'
            + `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
        )
        // And nothing after this line, ever. That is the whole fixture.
    })
    await new Promise<void>((resolve) => {
        server.listen(0, '127.0.0.1', resolve)
    })
    const port = (server.address() as AddressInfo).port

    return {
        url: `ws://127.0.0.1:${port}/`,
        // How `relayLabel` in `js/follows.ts` renders it into the refusal.
        label: `127.0.0.1:${port}`,
        close: () => new Promise<void>((resolve) => {
            // An upgraded socket keeps `close()` waiting, so they go first.
            open.forEach((socket) => socket.destroy())
            server.close(() => resolve())
        }),
    }
}
