/**
 * Publishes N kind-9 chat messages into one room over ONE authenticated connection.
 *
 * Why this exists: `zooid-testserver.sh` used to seed the two long rooms ("scroll", "punkt")
 * with 2 × 60 separate `nak event --auth` calls. Each call is a process start, a TCP connect
 * and a NIP-42 round — about 120 of the ~155 process spawns of a worker's setup. Measured
 * (2026-10-25) with 14 synthetic CPU-hog processes standing in for a busy machine: all six
 * workers hit `Fixture "workerBackend" timeout of 120000ms exceeded during setup` and every
 * test of the first six dispatches fell with 0 ms. One connection per room does the same work
 * without a single process start.
 *
 *   node --experimental-strip-types seed-bulk.ts <relay-ws> <sec-hex> <room> <count> <ts-base> <label>
 *
 * Message i (1..count) is `"<label> <i>"` with created_at `ts-base + i`, signed by `sec-hex`.
 * Exit code 1 if any message was not accepted — the old loop swallowed that with `|| true`.
 */
import { finalizeEvent, getPublicKey } from 'nostr-tools/pure'
import { makeAuthEvent } from 'nostr-tools/nip42'
import { WebSocket } from 'ws'

const [relay, secHex, room, countArg, tsBaseArg, label] = process.argv.slice(2)
const count = Number(countArg)
const tsBase = Number(tsBaseArg)

if (!relay || !secHex || !room || !Number.isInteger(count) || !Number.isFinite(tsBase) || !label) {
    console.error('usage: seed-bulk.ts <relay-ws> <sec-hex> <room> <count> <ts-base> <label>')
    process.exit(2)
}

const sk = Uint8Array.from(Buffer.from(secHex, 'hex'))
const pk = getPublicKey(sk)

const events = Array.from({ length: count }, (_, k) =>
    finalizeEvent(
        { kind: 9, created_at: tsBase + k + 1, tags: [['h', room]], content: `${label} ${k + 1}` },
        sk,
    ),
)

const fail = (msg: string): never => {
    console.error(`seed-bulk: ${msg}`)
    process.exit(1)
}

const ws = new WebSocket(relay)
const accepted = new Set<string>()
let authId = ''
let published = false

// A hard stop: this runs inside a fixture with its own timeout, and a hung socket must not
// outlive it. Generous, because the whole point is to survive a busy machine.
const hardStop = setTimeout(() => fail(`timed out with ${accepted.size}/${count} accepted`), 90_000)

const publishAll = (): void => {
    published = true
    for (const e of events) {
        ws.send(JSON.stringify(['EVENT', e]))
    }
}

ws.on('error', (e) => fail(`socket error: ${e.message}`))
ws.on('close', () => {
    if (accepted.size !== count) {
        fail(`closed with ${accepted.size}/${count} accepted`)
    }
})

ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString()) as unknown[]
    if (msg[0] === 'AUTH') {
        const auth = finalizeEvent(makeAuthEvent(relay, msg[1] as string), sk)
        authId = auth.id
        ws.send(JSON.stringify(['AUTH', auth]))
        return
    }
    if (msg[0] !== 'OK') {
        return
    }
    const [, id, ok, reason] = msg as [string, string, boolean, string]
    if (id === authId) {
        if (!ok) {
            fail(`AUTH refused: ${reason}`)
        }
        if (!published) {
            publishAll()
        }
        return
    }
    // `duplicate:` is a success of a kind: the event is there.
    if (ok || /^duplicate/.test(reason)) {
        accepted.add(id)
    } else {
        fail(`event ${id} rejected: ${reason}`)
    }
    if (accepted.size === count) {
        clearTimeout(hardStop)
        console.log(`seed-bulk: ${count} messages in ${room} as ${pk.slice(0, 8)}…`)
        ws.close()
        process.exit(0)
    }
})

// A relay that never sends a challenge (no auth needed) gets the batch after a short grace.
ws.on('open', () => {
    setTimeout(() => {
        if (!published && authId === '') {
            publishAll()
        }
    }, 3_000)
})
