#!/usr/bin/env node
/**
 * Relay-Mitglieder-Sync fuer **Buzz** — das Gegenstueck zu `member-sync.mjs` (zooid).
 *
 * Quelle der Wahrheit ist dieselbe wie bei zooid: die Vereins-Mitglieder-API. Ziel ist
 * die Relay-Mitgliederliste des Buzz-Space. **Nur Mitglieder — keine Raeume.** Buzz
 * braucht weder Meetup-Raeume noch sonst welche; wer hier Raeume anlegen will, ist im
 * falschen Skript (`sync-meetup-rooms.sh` gehoert zu zooid und bleibt dort).
 *
 * Warum nicht `member-sync.mjs` erweitern: die beiden Relays haben KEINE gemeinsame
 * Schreib-Schnittstelle.
 *
 * | | zooid | Buzz |
 * |---|---|---|
 * | Schreiben | NIP-86 ueber HTTP (`assignrole`, `unallowpubkey`) | signierte Events ueber WebSocket (9030 / 9031) |
 * | Lesen | `psql` auf `zooid__events` | authentifizierter REQ auf kind 13534 |
 * | Rollen | frei definierbare Rollen-IDs (Vereinsmitglied, Vorstand) | genau drei: `owner`, `admin`, `member` |
 *
 * Buzz beantwortet `POST /` mit `405 Method Not Allowed` — NIP-86 existiert dort nicht.
 * Und ein Datenbankzugriff ist unnoetig: die relay-signierte 13534 ist die autoritative
 * Mitgliederliste und ueber einen normalen REQ lesbar. Am laufenden Relay gemessen hat
 * sie die Form `["member", <hex>, <rolle>]`.
 *
 * **Vorstand hat auf Buzz keine Entsprechung.** Buzz kennt nur die drei Rollen oben;
 * eine zweite verwaltete Rolle gibt es nicht. Alle Vereinsmitglieder werden `member`.
 * `owner` und `admin` fasst das Skript NIE an — weder aufnehmen noch entfernen.
 *
 * Env:
 *   BUZZ_ADMIN_SECRET  nsec oder 64-hex des schreibenden Schluessels (Pflicht).
 *                      Der Pubkey MUSS auf dem Relay Rolle `owner` oder `admin` haben.
 *   BUZZ_RELAY         Default wss://buzz.einundzwanzig.space
 *   MEMBERS_API        Default https://verein.einundzwanzig.space/api/members/2026
 *   APPLY=1            schreiben; ohne die Variable Trockenlauf (nichts wird gesendet)
 *   MAX_REMOVALS       Sicherung gegen Massenentfernung, Default 10
 *   FORCE=1            hebt MAX_REMOVALS auf
 *
 * Idempotent: ein 9030 fuer ein bestehendes Mitglied ist ein stiller No-op, ein 9031
 * fuer einen Nicht-Mitglied ebenso. Das Skript darf beliebig oft laufen.
 */
import { finalizeEvent, getPublicKey } from 'nostr-tools/pure'
import { hexToBytes } from 'nostr-tools/utils'
import { decode } from 'nostr-tools/nip19'

const RELAY = process.env.BUZZ_RELAY || 'wss://buzz.einundzwanzig.space'
const MEMBERS_API = process.env.MEMBERS_API || 'https://verein.einundzwanzig.space/api/members/2026'
const APPLY = process.env.APPLY === '1'
const FORCE = process.env.FORCE === '1'
const MAX_REMOVALS = Number(process.env.MAX_REMOVALS ?? '10')

/** Buzz-Kinds (siehe `crates/buzz-relay/src/handlers/relay_admin.rs`). */
const ADD_MEMBER = 9030
const REMOVE_MEMBER = 9031
/** Relay-signierte Mitgliederliste. */
const MEMBER_LIST = 13534
/** NIP-42. */
const CLIENT_AUTH = 22242

/** Rollen, die dieses Skript niemals vergibt und niemals entzieht. */
const PROTECTED_ROLES = new Set(['owner', 'admin'])

const isHex64 = (s) => typeof s === 'string' && /^[0-9a-f]{64}$/.test(s)

function secretKey() {
    const raw = (process.env.BUZZ_ADMIN_SECRET || '').trim()
    if (!raw) {
        throw new Error('BUZZ_ADMIN_SECRET fehlt (nsec oder 64-hex)')
    }
    if (raw.startsWith('nsec1')) {
        return decode(raw).data
    }
    if (!isHex64(raw)) {
        throw new Error('BUZZ_ADMIN_SECRET ist weder nsec noch 64-hex')
    }
    return hexToBytes(raw)
}

/**
 * Soll-Liste aus der Vereins-API.
 *
 * Die leere Liste ist hier ein FEHLER, kein Ergebnis — sie kaeme fast immer aus einem
 * API-Ausfall, und das Skript wuerde daraufhin jedes Mitglied entfernen. Dieselbe
 * Sicherung steht aus demselben Grund in `member-sync.mjs`.
 */
async function fetchDesired() {
    const res = await fetch(MEMBERS_API, { signal: AbortSignal.timeout(30_000) })
    if (!res.ok) {
        throw new Error(`Mitglieder-API HTTP ${res.status}`)
    }
    const rows = await res.json()
    if (!Array.isArray(rows)) {
        throw new Error('Mitglieder-API: kein Array')
    }
    const set = new Set()
    for (const r of rows) {
        if (isHex64(r?.pubkey)) {
            set.add(r.pubkey)
        }
    }
    if (set.size === 0) {
        throw new Error('Mitglieder-API lieferte 0 gueltige Pubkeys — Abbruch (sonst wuerde alles entfernt)')
    }
    return set
}

/**
 * Duenner Relay-Client: NIP-42-AUTH, ein REQ, viele EVENTs.
 *
 * Bewusst ohne `ws`-Paket — Node 22 bringt `WebSocket` global mit, und `~/member-sync`
 * hat als einzige Abhaengigkeit `nostr-tools`. Ein zweites npm-Projekt auf dem Server
 * waere Wartungslast ohne Gegenwert.
 */
class Relay {
    constructor(url, sk) {
        this.url = url
        this.sk = sk
        this.pending = new Map()
        this.subs = new Map()
    }

    connect() {
        return new Promise((resolve, reject) => {
            this.ws = new WebSocket(this.url)
            const failEarly = (e) => reject(new Error(`Verbindung zu ${this.url} fehlgeschlagen: ${e?.message ?? 'Socket-Fehler'}`))
            this.ws.addEventListener('error', failEarly, { once: true })
            this.ws.addEventListener('open', () => {
                this.ws.removeEventListener('error', failEarly)
                this.ws.addEventListener('error', () => {})
                resolve()
            })
            this.ws.addEventListener('message', (ev) => this.onMessage(ev))
            this.ws.addEventListener('close', () => {
                for (const { reject: rj } of this.pending.values()) {
                    rj(new Error('Verbindung wurde geschlossen'))
                }
                this.pending.clear()
            })
        })
    }

    onMessage(ev) {
        let msg
        try {
            msg = JSON.parse(String(ev.data))
        } catch {
            return
        }
        const [type] = msg
        if (type === 'AUTH') {
            this.challenge = msg[1]
            if (this.onChallenge) {
                this.onChallenge()
            }
        } else if (type === 'OK') {
            const [, id, ok, message] = msg
            this.pending.get(id)?.resolve({ ok, message: message ?? '' })
            this.pending.delete(id)
        } else if (type === 'EVENT') {
            this.subs.get(msg[1])?.events.push(msg[2])
        } else if (type === 'EOSE') {
            const sub = this.subs.get(msg[1])
            if (sub) {
                this.ws.send(JSON.stringify(['CLOSE', msg[1]]))
                sub.resolve(sub.events)
                this.subs.delete(msg[1])
            }
        } else if (type === 'CLOSED') {
            const sub = this.subs.get(msg[1])
            if (sub) {
                sub.reject(new Error(`Abo abgewiesen: ${msg[2] ?? ''}`))
                this.subs.delete(msg[1])
            }
        }
    }

    /** Wartet auf die AUTH-Challenge und beantwortet sie (kind 22242). */
    async authenticate() {
        if (!this.challenge) {
            await new Promise((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error('keine AUTH-Challenge innerhalb von 15 s')), 15_000)
                this.onChallenge = () => {
                    clearTimeout(timer)
                    resolve()
                }
                // Buzz schickt die Challenge von sich aus; ein Ping ist nicht noetig.
            })
        }
        const auth = finalizeEvent(
            {
                kind: CLIENT_AUTH,
                created_at: Math.floor(Date.now() / 1000),
                tags: [
                    ['relay', this.url],
                    ['challenge', this.challenge],
                ],
                content: '',
            },
            this.sk,
        )
        const done = new Promise((resolve, reject) => this.pending.set(auth.id, { resolve, reject }))
        this.ws.send(JSON.stringify(['AUTH', auth]))
        const res = await withTimeout(done, 15_000, 'AUTH')
        if (!res.ok) {
            throw new Error(`AUTH abgelehnt: ${res.message}`)
        }
    }

    async req(filter) {
        const id = `s${Math.floor(Math.random() * 1e9)}`
        const done = new Promise((resolve, reject) => this.subs.set(id, { events: [], resolve, reject }))
        this.ws.send(JSON.stringify(['REQ', id, filter]))
        return withTimeout(done, 20_000, `REQ ${JSON.stringify(filter)}`)
    }

    /** Signiert im Moment des Sendens — Buzz verlangt `created_at` innerhalb ±120 s. */
    async publish(kind, tags) {
        const ev = finalizeEvent({ kind, created_at: Math.floor(Date.now() / 1000), tags, content: '' }, this.sk)
        const done = new Promise((resolve, reject) => this.pending.set(ev.id, { resolve, reject }))
        this.ws.send(JSON.stringify(['EVENT', ev]))
        return withTimeout(done, 20_000, `EVENT kind ${kind}`)
    }

    close() {
        try {
            this.ws?.close()
        } catch {
            /* egal — wir gehen ohnehin */
        }
    }
}

function withTimeout(promise, ms, what) {
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error(`Zeitlimit (${ms} ms) bei ${what}`)), ms)),
    ])
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Aktueller Stand: pubkey → Rolle, aus der neuesten 13534. */
function parseMemberList(events) {
    const newest = events.sort((a, b) => b.created_at - a.created_at)[0]
    const map = new Map()
    if (!newest) {
        return map
    }
    for (const tag of newest.tags) {
        if (tag[0] === 'member' && isHex64(tag[1])) {
            map.set(tag[1], tag[2] || 'member')
        }
    }
    return map
}

/**
 * Sendet ein Event und wiederholt bei Drosselung. Buzz antwortet unter Last mit
 * `rate-limited: quota exceeded; retry in Ns` — am Test-Stack beobachtet. Ein
 * fachlicher Fehlschlag wird NICHT wiederholt, der gehoert in den Bericht.
 */
async function publishWithRetry(relay, kind, tags) {
    for (let attempt = 1; ; attempt++) {
        const res = await relay.publish(kind, tags)
        if (res.ok || !/rate.?limit/i.test(res.message) || attempt >= 4) {
            return res
        }
        await sleep(1000 * attempt)
    }
}

async function main() {
    const sk = secretKey()
    const signerPub = getPublicKey(sk)

    const desired = await fetchDesired()

    const relay = new Relay(RELAY, sk)
    await relay.connect()
    await relay.authenticate()

    const current = parseMemberList(await relay.req({ kinds: [MEMBER_LIST], limit: 1 }))

    const signerRole = current.get(signerPub)
    if (!PROTECTED_ROLES.has(signerRole)) {
        relay.close()
        throw new Error(
            `Der Signierschluessel ${signerPub.slice(0, 12)}… hat auf ${RELAY} die Rolle ` +
                `"${signerRole ?? 'keine'}" — 9030/9031 verlangen owner oder admin. ` +
                'Der Owner muss ihn einmalig heraufstufen: kind 9030 mit ["role","admin"], wenn der ' +
                'Pubkey noch KEIN Mitglied ist — kind 9032 aendert nur die Rolle eines BESTEHENDEN ' +
                'Mitglieds und antwortet sonst mit "invalid: member not found".',
        )
    }

    // Aufnehmen: in der API, aber nicht auf dem Relay.
    const toAdd = [...desired].filter((pk) => !current.has(pk)).sort()
    // Entfernen: auf dem Relay als `member`, aber nicht mehr in der API. Owner und
    // Admins bleiben aussen vor — sie stehen bewusst dort und nicht wegen der API.
    const toRemove = [...current]
        .filter(([pk, role]) => !PROTECTED_ROLES.has(role) && !desired.has(pk))
        .map(([pk]) => pk)
        .sort()

    console.log(
        `Relay:    ${RELAY}\n` +
            `Absender: ${signerPub} (Rolle ${signerRole})\n` +
            `Soll:     ${desired.size} Vereinsmitglieder | Ist: ${current.size} Eintraege ` +
            `(davon geschuetzt: ${[...current.values()].filter((r) => PROTECTED_ROLES.has(r)).length})\n` +
            `Plan:     +${toAdd.length} aufnehmen  -${toRemove.length} entfernen${APPLY ? '' : '   [TROCKENLAUF]'}`,
    )

    if (toRemove.length > MAX_REMOVALS && !FORCE) {
        relay.close()
        throw new Error(
            `${toRemove.length} Entfernungen ueberschreiten MAX_REMOVALS=${MAX_REMOVALS}. ` +
                'Das ist die Signatur eines unvollstaendigen API-Ergebnisses, nicht eines Vereinsaustritts. ' +
                'Pruefen, dann mit FORCE=1 wiederholen.',
        )
    }

    if (!APPLY) {
        for (const pk of toAdd) {
            console.log(`  + ${pk}`)
        }
        for (const pk of toRemove) {
            console.log(`  - ${pk}`)
        }
        relay.close()
        console.log('Trockenlauf — es wurde nichts gesendet.')
        return 0
    }

    const failed = []
    for (const pk of toAdd) {
        const res = await publishWithRetry(relay, ADD_MEMBER, [['p', pk], ['role', 'member']])
        console.log(`  ${res.ok ? '+' : '!'} ${pk}${res.ok ? '' : ` — ${res.message}`}`)
        if (!res.ok) {
            failed.push([pk, 'aufnehmen', res.message])
        }
        await sleep(100)
    }
    for (const pk of toRemove) {
        const res = await publishWithRetry(relay, REMOVE_MEMBER, [['p', pk]])
        console.log(`  ${res.ok ? '-' : '!'} ${pk}${res.ok ? '' : ` — ${res.message}`}`)
        if (!res.ok) {
            failed.push([pk, 'entfernen', res.message])
        }
        await sleep(100)
    }

    // NACHKONTROLLE. Ein `OK true` heisst: der Relay hat das Event ANGENOMMEN — nicht,
    // dass die Mitgliedschaft in der Datenbank steht. Beim ersten Lauf ueber die
    // 116er-Liste (2026-07-28, zooid-Export) meldete `nak` fuer alle Erfolg, vier
    // fehlten danach trotzdem; einzeln nachgefahren gingen dieselben Pubkeys sofort
    // durch. Deshalb wird der Sollzustand hier gegen die neu gelesene 13534 geprueft
    // und nicht gegen die Antworten von eben.
    await sleep(1500)
    const after = parseMemberList(await relay.req({ kinds: [MEMBER_LIST], limit: 1 }))
    relay.close()

    const stillMissing = [...desired].filter((pk) => !after.has(pk))
    const stillPresent = toRemove.filter((pk) => after.has(pk))

    console.log(`\nNachkontrolle: ${after.size} Eintraege in der 13534.`)
    if (failed.length) {
        console.log('Abgelehnt:')
        for (const [pk, what, msg] of failed) {
            console.log(`  ${pk} (${what}): ${msg}`)
        }
    }
    if (stillMissing.length) {
        console.log(`FEHLEN weiterhin (${stillMissing.length}):`)
        for (const pk of stillMissing) {
            console.log(`  ${pk}`)
        }
    }
    if (stillPresent.length) {
        console.log(`NICHT entfernt (${stillPresent.length}):`)
        for (const pk of stillPresent) {
            console.log(`  ${pk}`)
        }
    }
    if (!failed.length && !stillMissing.length && !stillPresent.length) {
        console.log('Soll und Ist stimmen ueberein.')
        return 0
    }
    return 1
}

main()
    .then((code) => process.exit(code))
    .catch((e) => {
        console.error('FEHLER:', e.message)
        process.exit(1)
    })
