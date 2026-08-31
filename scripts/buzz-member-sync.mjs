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
 *   MEMBERS_API        Default https://verein.einundzwanzig.space/api/members/<Jahr>
 *                      (Kalenderjahr des Laufs — wie zooid-member-sync.mjs; seit 2026-08-16,
 *                      davor hart auf 2026 verdrahtet, was am 2027-01-01 auseinander-
 *                      gelaufen waere)
 *   APPLY=1            schreiben; ohne die Variable Trockenlauf (nichts wird gesendet)
 *   MAX_REMOVALS       Sicherung gegen Massenentfernung, Default 10
 *   FORCE=1            hebt MAX_REMOVALS auf
 *   MANAGED_STATE      Zustandsdatei mit den Pubkeys, die DIESES Skript aufgenommen hat.
 *                      Default `verwaltet-buzz.json` neben dem Skript. Nur wer darin
 *                      steht, wird je entfernt — Begruendung bei MANAGED_PATH.
 *
 * Aufrufe:
 *   node buzz-member-sync.mjs                # Trockenlauf
 *   APPLY=1 node buzz-member-sync.mjs        # schreibt
 *   node buzz-member-sync.mjs --selbsttest   # prueft die Entfernungsregel, ohne Netz
 *
 * Idempotent: ein 9030 fuer ein bestehendes Mitglied ist ein stiller No-op, ein 9031
 * fuer einen Nicht-Mitglied ebenso. Das Skript darf beliebig oft laufen.
 *
 * **Es entfernt nur, wen es selbst aufgenommen hat** (seit 2026-08-31). Wer von Hand
 * auf den Relay kam — Agenten, Dienste, Pilot-Nutzer — bleibt stehen, auch wenn er in
 * keinem Jahrgang der Vereins-API auftaucht. Aufnehmen und Wegraeumen sind zwei
 * Befugnisse; fuer fremde Eintraege hat dieses Skript nur die erste.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { finalizeEvent, getPublicKey } from 'nostr-tools/pure'
import { hexToBytes } from 'nostr-tools/utils'
import { decode } from 'nostr-tools/nip19'

const RELAY = process.env.BUZZ_RELAY || 'wss://buzz.einundzwanzig.space'
const MEMBERS_API =
    process.env.MEMBERS_API ||
    `https://verein.einundzwanzig.space/api/members/${new Date().getFullYear()}`
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

/**
 * Einzelne Pubkeys, die das Skript niemals entfernt, obwohl sie nicht in der
 * Vereins-API stehen. Kommagetrennte 64-stellige Hex-Werte in `PROTECTED_PUBKEYS`.
 *
 * SEIT DEM 2026-08-31 IST DAS DER ZWEITE RIEGEL, NICHT MEHR DER EINZIGE: entfernt
 * wird ohnehin nur, wen dieses Skript selbst aufgenommen hat (siehe MANAGED_PATH).
 * Diese Liste muss deshalb nicht mehr bei jedem neuen Agenten wachsen — sie bleibt
 * als ausdrueckliche Zusage fuer Eintraege, die auch dann stehen sollen, wenn die
 * Zustandsdatei einmal verloren geht und der Erstlauf sie neu aufbaut.
 *
 * WARUM ueber eine Umgebungsvariable und nicht als Liste hier im Code: das sind
 * Bestandsdaten des Betreibers, keine Programmlogik. Sie gehoeren neben den Relay
 * und nicht in ein Repo, das auch anderswo ausgecheckt wird.
 *
 * WARUM es diesen Schutz ueberhaupt gibt (gemessen 2026-08-10): Am 2026-07-29 um
 * 12:42 UTC wurden zehn Pubkeys per `buzz-admin add-member` von Hand aufgenommen —
 * eine Pilot-Runde zum Buzz-Start, erkennbar daran, dass genau diese zehn ab 12:43
 * im Kanal `general` schrieben. Sie stehen in KEINEM Jahrgang der Vereins-API, weil
 * sie nie ueber den offiziellen Mitgliederweg kamen. Der naechtliche Lauf stufte sie
 * deshalb jedes Mal als "zu entfernen" ein: vier belegte Termine (01./05./06./09.08.)
 * mit je zehn kind-8001-Deltas — und weil `require_relay_membership` aktiv ist,
 * scheiterten diese Personen zwischenzeitlich real am NIP-42-AUTH.
 *
 * NICHT ueber die Rolle `admin` loesen: das vergaebe echte Schreibrechte am Relay,
 * nur um eine Entfernung zu verhindern.
 */
const PROTECTED_PUBKEYS = new Set(
    (process.env.PROTECTED_PUBKEYS || '')
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter((s) => /^[0-9a-f]{64}$/.test(s)),
)

/**
 * WAS DIESES SKRIPT VERWALTET — und was es deshalb NIE anfassen darf.
 *
 * Bis zum 2026-08-31 entfernte der Lauf JEDEN `member`, der nicht in der
 * Vereins-API stand. Das ist eine Aussage ueber die API, nicht ueber die
 * Mitgliedschaft: wer von Hand aufgenommen wurde — Agenten, Dienste,
 * Pilot-Nutzer — steht dort naturgemaess nicht und flog trotzdem raus.
 *
 * Belegt am 2026-08-31: ein am Vortag eingestellter Agent (a558c8c8…) wurde
 * sechsmal in fuenf Stunden entfernt, jedes Mal binnen einer Viertelstunde
 * nach dem Nachtragen. Sein Dienst scheiterte danach an
 * `Auth failed: restricted: not a relay member` und haengte in einer
 * Restart-Schleife, die `systemctl is-active` als `active` meldet — der Ausfall
 * sah wie Betrieb aus. Dieselbe Ursache traf am 01./05./06./09.08. die zehn
 * Pilot-Nutzer vom 2026-07-29; damals wurde sie mit `PROTECTED_PUBKEYS`
 * einzeln zugeklebt, und die Liste musste bei jedem neuen Eintrag wachsen.
 *
 * DIE REGEL LAUTET JETZT: entfernt wird nur, wen dieses Skript selbst
 * aufgenommen hat. Alles andere bleibt stehen, auch wenn es nicht in der API
 * steht — Aufnehmen und Wegräumen sind zwei Befugnisse, und dieses Skript hat
 * nur eine davon fuer fremde Eintraege.
 *
 * WARUM EINE DATEI UND NICHT DER RELAY: `added_by` steht nur in der
 * Relay-Datenbank, an die dieses Skript nicht kommt (es laeuft auf dem Host,
 * die DB liegt im Container). Die Kommando-Events 9030/9031 werden nicht
 * persistiert — am 2026-08-31 gemessen: ein REQ darauf liefert 0 Treffer. Die
 * relay-signierten Deltas 8000/8001 nennen zwar Ziel und Zeitpunkt, aber nicht
 * den Veranlasser. Damit bleibt nur eigene Buchfuehrung.
 *
 * FEHLT DIE DATEI, wird NICHT geraten und NICHTS entfernt: der Lauf legt sie
 * aus `Ist ∩ Soll` an — das sind genau die Eintraege, die aus der API stammen —
 * und meldet das. Ein verlorener Zustand kostet damit einen Lauf ohne
 * Entfernungen, nicht eine Runde falscher.
 */
const MANAGED_PATH =
    process.env.MANAGED_STATE ||
    join(dirname(fileURLToPath(import.meta.url)), 'verwaltet-buzz.json')

function ladeVerwaltet() {
    try {
        const roh = JSON.parse(readFileSync(MANAGED_PATH, 'utf8'))
        const liste = Array.isArray(roh) ? roh : (roh.pubkeys ?? [])
        return new Set(liste.filter((x) => typeof x === 'string' && /^[0-9a-f]{64}$/.test(x)))
    } catch {
        return null // fehlt oder unlesbar — der Aufrufer entscheidet, nicht dieser Helfer
    }
}

function speichereVerwaltet(menge) {
    mkdirSync(dirname(MANAGED_PATH), { recursive: true })
    writeFileSync(
        MANAGED_PATH,
        `${JSON.stringify({ pubkeys: [...menge].sort(), stand: new Date().toISOString() }, null, 1)}\n`,
        { mode: 0o600 },
    )
}

const isHex64 = (s) => typeof s === 'string' && /^[0-9a-f]{64}$/.test(s)

/**
 * Wen entfernt dieser Lauf — und wen laesst er ausdruecklich stehen?
 *
 * ALS REINE FUNKTION, damit `--selbsttest` sie ohne Relay und ohne Schluessel
 * pruefen kann. Die Lagen, um die es geht, sind am laufenden Relay nicht
 * herstellbar, ohne echte Mitglieder zu entfernen — und eine Regel, die man nur
 * im Ernstfall pruefen kann, ist beim naechsten Umbau die erste, die still
 * zurueckfaellt.
 *
 * VIER BEDINGUNGEN, und jede hat ihren eigenen Grund:
 *   · `owner`/`admin` nie          — sie stehen bewusst dort, nicht wegen der API
 *   · PROTECTED_PUBKEYS nie        — Bestandsdaten des Betreibers
 *   · in der API                   — dann ist er Mitglied, es gibt nichts zu tun
 *   · NICHT selbst aufgenommen nie — fremde Eintraege gehen dieses Skript nichts an
 *
 * `fremdeUnbekannte` sind die, die allein an der letzten Bedingung haengen: nach
 * der alten Regel waeren sie geflogen. Sie gehoeren in die Ausgabe, sonst sieht
 * ein Lauf, der zehn Eintraege in Ruhe laesst, aus wie einer ohne Arbeit.
 */
function planeEntfernungen({ current, desired, verwaltet, erstlauf }) {
    const kandidat = ([pk, role]) =>
        !PROTECTED_ROLES.has(role) && !PROTECTED_PUBKEYS.has(pk) && !desired.has(pk)

    const fremdeUnbekannte = [...current]
        .filter((e) => kandidat(e) && !verwaltet.has(e[0]))
        .map(([pk]) => pk)
        .sort()

    // Beim Erstlauf wird NICHTS entfernt: die Zustandsdatei ist gerade erst aus
    // `Ist ∩ Soll` entstanden und beweist nichts ueber die Vergangenheit.
    const toRemove = erstlauf
        ? []
        : [...current]
              .filter((e) => kandidat(e) && verwaltet.has(e[0]))
              .map(([pk]) => pk)
              .sort()

    return { toRemove, fremdeUnbekannte }
}

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

    /**
     * Verbindung verwerfen und neu aufbauen (inkl. AUTH). Wird gebraucht, wenn der
     * Relay auf ein Event nicht antwortet — der Socket ist dann oft schon tot, und
     * jedes weitere Senden liefe nur in dasselbe Zeitlimit.
     */
    async reconnect() {
        this.close()
        this.pending.clear()
        this.subs.clear()
        this.challenge = undefined
        this.onChallenge = undefined
        await sleep(2000)
        await this.connect()
        await this.authenticate()
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
 * Sendet ein Event und wiederholt bei Drosselung ODER ausbleibender Antwort.
 *
 * Zwei verschiedene Stoerungen, beide am echten Relay erlebt:
 *
 * 1. **Drosselung** — Buzz antwortet unter Last mit `rate-limited: quota exceeded;
 *    retry in Ns`. Warten und nochmal.
 * 2. **Keine Antwort.** Beim ersten Prod-Lauf ueber die 116er-Liste (2026-07-30) blieb
 *    nach 60 erfolgreichen Events das `OK` zum 61. einfach aus. Dieselbe Beobachtung
 *    steht in `buzz-add-members.sh`: der Relay haengt gelegentlich am WebSocket, dort
 *    gemessen bis ~9 min. Ein Zeitlimit, das den GESAMTEN Lauf abbricht, ist hier die
 *    falsche Antwort — 60 Mitglieder waren bereits eingetragen, der Rest blieb liegen.
 *    Deshalb: neu verbinden, neu authentifizieren, nochmal senden. Erst wenn auch das
 *    scheitert, wird dieses EINE Event als Fehlschlag verbucht und der Lauf geht
 *    weiter. Was dann fehlt, benennt die Nachkontrolle namentlich.
 *
 * Ein FACHLICHER Fehlschlag (`OK false` mit Begruendung) wird nie wiederholt — das ist
 * eine Aussage des Relays und gehoert in den Bericht, nicht in vier Runden.
 */
async function publishWithRetry(relay, kind, tags) {
    for (let attempt = 1; ; attempt++) {
        let res
        try {
            res = await relay.publish(kind, tags)
        } catch (e) {
            if (attempt >= 3) {
                return { ok: false, message: `keine Antwort (${e.message})` }
            }
            await relay.reconnect()
            continue
        }
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

    // WAS DIESES SKRIPT VERWALTET — die Datei, nicht die Abwesenheit in der API.
    // Fehlt sie, wird sie aus `Ist ∩ Soll` angelegt und in DIESEM Lauf nichts
    // entfernt; die Begruendung steht bei MANAGED_PATH.
    let verwaltet = ladeVerwaltet()
    const erstlauf = verwaltet === null
    if (erstlauf) {
        verwaltet = new Set([...current.keys()].filter((pk) => desired.has(pk)))
    }

    const { toRemove, fremdeUnbekannte } = planeEntfernungen({ current, desired, verwaltet, erstlauf })

    const protectedByRole = [...current.values()].filter((r) => PROTECTED_ROLES.has(r)).length
    const protectedByKey = [...current.keys()].filter((pk) => PROTECTED_PUBKEYS.has(pk)).length

    console.log(
        `Relay:    ${RELAY}\n` +
            `Absender: ${signerPub} (Rolle ${signerRole})\n` +
            `Soll:     ${desired.size} Vereinsmitglieder | Ist: ${current.size} Eintraege ` +
            `(geschuetzt: ${protectedByRole} per Rolle, ${protectedByKey} per Pubkey)\n` +
            `Plan:     +${toAdd.length} aufnehmen  -${toRemove.length} entfernen${APPLY ? '' : '   [TROCKENLAUF]'}`,
    )
    if (erstlauf) {
        console.log(
            `Hinweis:  keine Zustandsdatei (${MANAGED_PATH}) — sie wird aus Ist ∩ Soll ` +
                `mit ${verwaltet.size} Eintraegen angelegt. In diesem Lauf wird NICHTS entfernt.`,
        )
    }
    if (fremdeUnbekannte.length > 0) {
        console.log(
            `Fremd:    ${fremdeUnbekannte.length} Eintraege stehen weder in der API noch in der ` +
                `Zustandsdatei und bleiben unberuehrt ` +
                `(${fremdeUnbekannte.slice(0, 6).map((pk) => pk.slice(0, 8)).join(', ')}` +
                `${fremdeUnbekannte.length > 6 ? ', …' : ''}) — von Hand aufgenommen, nicht von hier.`,
        )
    }

    // Wer geschuetzt ist, aber nicht in der API steht, wird benannt statt stillschweigend
    // uebergangen — sonst waechst die Ausnahmeliste unbemerkt und niemand raeumt sie je auf.
    const protectedAndUnknown = [...current.keys()].filter((pk) => PROTECTED_PUBKEYS.has(pk) && !desired.has(pk))
    if (protectedAndUnknown.length > 0) {
        console.log(
            `Hinweis:  ${protectedAndUnknown.length} geschuetzte Pubkeys stehen nicht in der Vereins-API ` +
                `(${protectedAndUnknown.map((pk) => pk.slice(0, 8)).join(', ')}) — bewusste Ausnahme, siehe PROTECTED_PUBKEYS.`,
        )
    }

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
        // AUCH DIE ZUSTANDSDATEI BLEIBT UNBERUEHRT. Ein Trockenlauf, der sie
        // anlegt, waere kein Trockenlauf: der naechste echte Lauf faende sie vor
        // und entfernte sofort, statt einmal auszusetzen.
        console.log('Trockenlauf — es wurde nichts gesendet.')
        return 0
    }

    const failed = []
    for (const pk of toAdd) {
        const res = await publishWithRetry(relay, ADD_MEMBER, [['p', pk], ['role', 'member']])
        console.log(`  ${res.ok ? '+' : '!'} ${pk}${res.ok ? '' : ` — ${res.message}`}`)
        if (res.ok) {
            // Ab jetzt gehoert er diesem Skript — und nur, was ihm gehoert, darf es
            // spaeter wieder entfernen.
            verwaltet.add(pk)
        } else {
            failed.push([pk, 'aufnehmen', res.message])
        }
        await sleep(100)
    }
    for (const pk of toRemove) {
        const res = await publishWithRetry(relay, REMOVE_MEMBER, [['p', pk]])
        console.log(`  ${res.ok ? '-' : '!'} ${pk}${res.ok ? '' : ` — ${res.message}`}`)
        if (res.ok) {
            verwaltet.delete(pk)
        } else {
            failed.push([pk, 'entfernen', res.message])
        }
        await sleep(100)
    }

    // NACH DEN EVENTS, VOR DER NACHKONTROLLE. Wer aufgenommen wurde, steht in der
    // Datei — auch wenn die Nachkontrolle gleich Luecken findet: der Eintrag sagt
    // „dieses Skript hat ihn aufgenommen", nicht „er ist bestimmt drin". Andersherum
    // waere schlimmer: ein Absturz zwischen Aufnahme und Datei erzeugte einen
    // Eintrag, den niemand mehr entfernen darf.
    try {
        speichereVerwaltet(verwaltet)
    } catch (e) {
        console.log(`WARNUNG: Zustandsdatei nicht geschrieben (${String(e.message).slice(0, 120)}).`)
        console.log(`         Der naechste Lauf legt sie neu an und entfernt dabei nichts.`)
    }

    // NACHKONTROLLE. Ein `OK true` heisst: der Relay hat das Event ANGENOMMEN — nicht,
    // dass die Mitgliedschaft in der Datenbank steht. Beim ersten Lauf ueber die
    // 116er-Liste (2026-07-28, zooid-Export) meldete `nak` fuer alle Erfolg, vier
    // fehlten danach trotzdem; einzeln nachgefahren gingen dieselben Pubkeys sofort
    // durch. Deshalb wird der Sollzustand hier gegen die neu gelesene 13534 geprueft
    // und nicht gegen die Antworten von eben.
    await sleep(1500)
    let after
    try {
        after = parseMemberList(await relay.req({ kinds: [MEMBER_LIST], limit: 1 }))
    } catch {
        // Der Socket kann nach einem Haenger tot sein. Die Nachkontrolle ist der
        // wichtigste Teil des Laufs — sie darf nicht daran scheitern.
        await relay.reconnect()
        after = parseMemberList(await relay.req({ kinds: [MEMBER_LIST], limit: 1 }))
    }
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

/**
 * `--selbsttest`: prueft die Entfernungsregel gegen nachgestellte Lagen.
 *
 * Ohne Relay, ohne Schluessel, ohne Netz — genau deshalb gibt es ihn. Die Lage,
 * um die es geht (ein von Hand aufgenommener Pubkey, der nicht in der API
 * steht), laesst sich am laufenden Relay nur herstellen, indem man sie
 * herbeifuehrt; und wer sie dort prueft, hat den Schaden schon.
 */
function selbsttest() {
    let schlecht = 0
    const pk = (n) => String(n).repeat(64).slice(0, 64)
    const API = pk(1) // in der Vereins-API
    const WEG = pk(2) // war in der API, ist ausgetreten — vom Skript aufgenommen
    const HAND = pk(3) // von Hand aufgenommen, nie in der API
    const ADMIN = pk(4)

    const faelle = [
        {
            name: 'ein Ausgetretener, den dieses Skript aufgenommen hat, wird entfernt',
            current: new Map([[API, 'member'], [WEG, 'member']]),
            desired: new Set([API]),
            verwaltet: new Set([API, WEG]),
            erstlauf: false,
            entfernt: [WEG],
            fremd: [],
        },
        {
            name: 'ein von Hand aufgenommener Pubkey bleibt — DER FALL VOM 2026-08-31',
            current: new Map([[API, 'member'], [HAND, 'member']]),
            desired: new Set([API]),
            verwaltet: new Set([API]),
            erstlauf: false,
            entfernt: [],
            fremd: [HAND],
        },
        {
            name: 'owner und admin fasst das Skript nie an',
            current: new Map([[ADMIN, 'admin'], [HAND, 'owner']]),
            desired: new Set(),
            verwaltet: new Set([ADMIN, HAND]),
            erstlauf: false,
            entfernt: [],
            fremd: [],
        },
        {
            name: 'beim Erstlauf wird nichts entfernt',
            current: new Map([[API, 'member'], [WEG, 'member']]),
            desired: new Set([API]),
            verwaltet: new Set([API, WEG]),
            erstlauf: true,
            entfernt: [],
            fremd: [],
        },
        {
            name: 'wer in der API steht, wird nie entfernt — auch nicht als fremd gemeldet',
            current: new Map([[API, 'member']]),
            desired: new Set([API]),
            verwaltet: new Set(),
            erstlauf: false,
            entfernt: [],
            fremd: [],
        },
    ]

    for (const f of faelle) {
        const { toRemove, fremdeUnbekannte } = planeEntfernungen(f)
        const gut =
            JSON.stringify(toRemove) === JSON.stringify(f.entfernt) &&
            JSON.stringify(fremdeUnbekannte) === JSON.stringify(f.fremd)
        if (!gut) schlecht++
        console.log(
            `${gut ? 'ok' : 'FEHLER'} - ${f.name}` +
                (gut
                    ? ''
                    : `\n         entfernt=${JSON.stringify(toRemove.map((x) => x.slice(0, 4)))} ` +
                      `erwartet=${JSON.stringify(f.entfernt.map((x) => x.slice(0, 4)))} | ` +
                      `fremd=${JSON.stringify(fremdeUnbekannte.map((x) => x.slice(0, 4)))} ` +
                      `erwartet=${JSON.stringify(f.fremd.map((x) => x.slice(0, 4)))}`),
        )
    }
    return schlecht === 0 ? 0 : 1
}

if (process.argv.includes('--selbsttest')) {
    process.exit(selbsttest())
}

main()
    .then((code) => process.exit(code))
    .catch((e) => {
        console.error('FEHLER:', e.message)
        process.exit(1)
    })
