#!/usr/bin/env node
/**
 * Rollen-Sync fuer das **zooid**-Relay (group.einundzwanzig.space).
 *
 * Nachfolger von `~/member-sync/member-sync.mjs` auf dem Prod-Server. Wirkung
 * unveraendert — zwei verwaltete Rollen, geschrieben ueber NIP-86:
 *
 *   - `Vereinsmitglied` — dynamisch aus der Vereins-Mitglieder-API (Jahrgang)
 *   - `Vorstand`        — statische Liste, siehe VORSTAND_PUBKEYS weiter unten
 *
 * **Was sich geaendert hat und warum.** Der Vorgaenger las die Mitgliederliste per
 * `psql` aus `zooid__events` und brauchte dafuer `DATABASE_URL`. Der Cutover am
 * 2026-07-19 stellte zooid auf embedded SQLite um; die Variable existiert seither
 * nicht mehr, und der naechtliche Lauf endete drei Wochen lang sofort mit
 * "DATABASE_URL fehlt". Ein nachgetragener Postgres-Wert waere die falsche Antwort
 * gewesen — er haette einen eingefrorenen Stand vom 19.07. geliefert.
 *
 * Gelesen wird jetzt ueber Nostr, wie im Buzz-Pendant `buzz-member-sync.mjs`:
 * ein authentifizierter REQ auf kind 13534. Das ist nicht bloss bequemer, sondern
 * die eigentlich richtige Quelle — die 13534 ist die relay-signierte Mitglieder-
 * liste, die zooid selbst als Wahrheit fuehrt (`ManagementStore.GetMembers`,
 * `GetAssignedRoles` lesen exakt dieses Event). Welche Datenbank darunter liegt,
 * ist damit egal: SQLite, Postgres oder was danach kommt.
 *
 * **Form der 13534 in zooid** (verifiziert in `zooid/management.go`, nicht geraten):
 *
 *     ["member", "<pubkey-hex>", "<rolleA>", "<rolleB>", …]
 *
 * Ein Tag je Mitglied, ab Index 2 beliebig viele Rollen-IDs — das ist der
 * Unterschied zu Buzz, wo an Index 2 GENAU EINE Rolle aus {owner,admin,member}
 * steht. Die Rollen-IDs selbst sind an anderer Stelle als kind 33534 definiert
 * (`d`-Tag = Rollen-ID); ohne diese Definition weist zooid `assignrole` mit
 * `role "…" does not exist` ab (`management.go:360-363`). Deshalb prueft dieses
 * Skript die Definitionen VOR dem ersten Schreibversuch — sonst scheitern alle
 * Zuweisungen kaskadierend, wie es dem Testserver-Seed schon einmal passiert ist.
 *
 * Clients koennen die 13534 nicht faelschen: zooid lehnt sie im Publish-Pfad ab
 * (`IsReadOnlyEvent` → "invalid: this event's kind is not accepted"), nur der
 * Relay selbst signiert und speichert sie. Das neueste 13534 auf der Verbindung
 * IST daher die autoritative Liste.
 *
 * **Geschrieben wird weiterhin per NIP-86** (`assignrole`, `unassignrole`,
 * `unallowpubkey`) ueber HTTP — der von zooid vorgesehene Verwaltungsweg, und
 * anders als bei Buzz gibt es hier kein Event-basiertes Gegenstueck.
 *
 * Env:
 *   RELAY_SECRET   64-hex oder nsec. PFLICHT — auch fuer den Trockenlauf, weil
 *                  schon das LESEN NIP-42-AUTH verlangt (`instance.go:286-295`:
 *                  ohne AUTH "auth-required", danach nur Admins und Mitglieder).
 *                  Der Pubkey muss auf dem Relay `can_manage` haben (Relay-Key
 *                  selbst, Owner oder eine Rolle mit `can_manage`).
 *   ZOOID_RELAY    Default wss://group.einundzwanzig.space. ws/wss/http/https
 *                  werden alle angenommen; das Skript leitet beide Formen ab.
 *                  `RELAY_URL` wird als Altname weiter gelesen.
 *   MEMBERS_API    Default https://verein.einundzwanzig.space/api/members/<Jahr>
 *   APPLY=1        schreiben. OHNE die Variable: Trockenlauf, es geht nichts raus.
 *   MAX_REMOVALS   Deckel gegen Massen-Entzug, Default 10 (Details unten).
 *   FORCE=1        hebt MAX_REMOVALS auf.
 *   PROTECTED_PUBKEYS  kommagetrennte Hex-Pubkeys, die nie etwas verlieren.
 *
 * `SCHEMA` und `DATABASE_URL` sind ersatzlos entfallen. Stehen sie noch in einer
 * Cron-Zeile, schadet das nicht — sie werden ignoriert.
 *
 * Idempotent: `assignrole` auf eine bestehende Zuweisung ist ein No-op
 * (`management.go:372-374`), `unassignrole` auf eine nicht vorhandene ebenso.
 */
import { finalizeEvent, getPublicKey } from 'nostr-tools/pure'
import { hexToBytes } from 'nostr-tools/utils'
import { decode } from 'nostr-tools/nip19'
import { createHash } from 'node:crypto'

/** Relay-signierte Mitgliederliste (zooid: RELAY_MEMBERS). */
const MEMBER_LIST = 13534
/** Rollendefinition, `d`-Tag = Rollen-ID (zooid: RELAY_ROLE). */
const ROLE_DEFINITION = 33534
/** NIP-42. */
const CLIENT_AUTH = 22242
/** NIP-98, Traeger der NIP-86-Autorisierung. */
const HTTP_AUTH = 27235

/**
 * Die beiden verwalteten Rollen-IDs. Undurchsichtige Zahlen, weil zooid Rollen-IDs
 * frei vergibt und diese hier beim Anlegen des Relays entstanden sind — der
 * lesbare Name steht im `label`-Tag der 33534, nicht in der ID. Nicht aendern,
 * ohne die Rollen auf dem Relay mitzuziehen: die ID ist der Schluessel.
 */
const VEREIN = '25546780344136777'
const VORSTAND = '22587314920557555'

/**
 * Statische Vorstands-Liste (hex) — **hier gepflegt, absichtlich, nicht vergessen.**
 *
 * WARUM statisch: die Mitglieder-API unter `/api/members/<jahr>` beantwortet genau
 * eine Frage — wer ist in diesem Jahr Vereinsmitglied. Ein Vorstandsmerkmal wertet
 * dieses Skript dort nicht aus; schon der Vorgaenger fuehrte die Liste deshalb von
 * Hand. Ein Vorstandswechsel ist ausserdem ein seltener, beschlossener Vorgang und
 * kein Datensatz, der sich naechtlich aendert.
 *
 * WO PFLEGEN: in dieser Datei, im Repo — damit die Aenderung durch Review und
 * Git-History laeuft (wer, wann, mit welchem Commit). Danach muss die Datei auf den
 * Server (siehe `zooid-member-sync-run.sh`, das sie bei jedem Lauf frisch aus dem
 * Deploy zieht). Eine Aenderung nur auf dem Server geht beim naechsten Deploy verloren.
 *
 * WENN SIE JE WEGFAELLT: sobald die Vereins-API den Vorstand selbst ausweist, gehoert
 * diese Liste geloescht und `desired` fuer VORSTAND aus der API gefuellt — nicht beides.
 */
const VORSTAND_PUBKEYS = [
    '0adf67475ccc5ca456fd3022e46f5d526eb0af6284bf85494c0dd7847f3e5033',
    '430169631f2f0682c60cebb4f902d68f0c71c498fd1711fd982f052cf1fd4279',
    '7acf30cf60b85c62b8f654556cc21e4016df8f5604b3b6892794f88bb80d7a1d',
    '19e358b8011f5f4fc653c565c6d4c2f33f32661f4f90982c9eedc292a8774ec3',
    'f240be2b684f85cc81566f2081386af81d7427ea86250c8bde6b7a8500c761ba',
    '657e87499e026715f81286030408ac032014eaf9c342ac59017b4472f013a43f',
    'a8fde7c28e1803b3cb62e0e9d1cf65ef36533ddd874cec0bb9fd2a6bc908ff9d',
]

/**
 * Einzeln geschuetzte Pubkeys: verlieren nie eine Rolle und nie die Mitgliedschaft,
 * auch wenn sie in keiner Quelle stehen. Betreiber-Bestandsdaten, deshalb aus der
 * Umgebung und nicht als Liste im Repo — dieselbe Begruendung wie im Buzz-Pendant,
 * wo genau dieser Fall (haendisch aufgenommene Pilot-Nutzer) den naechtlichen Lauf
 * viermal dieselben zehn Leute entfernen liess.
 */
const PROTECTED_PUBKEYS = new Set(
    (process.env.PROTECTED_PUBKEYS || '')
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter((s) => /^[0-9a-f]{64}$/.test(s)),
)

const APPLY = process.env.APPLY === '1'
const FORCE = process.env.FORCE === '1'
const MAX_REMOVALS = Number(process.env.MAX_REMOVALS ?? '10')
const MEMBERS_API =
    process.env.MEMBERS_API || `https://verein.einundzwanzig.space/api/members/${new Date().getFullYear()}`

const isHex64 = (s) => typeof s === 'string' && /^[0-9a-f]{64}$/.test(s)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * Aus einer Relay-Angabe beide Formen ableiten: WebSocket zum Lesen, HTTP fuer NIP-86.
 *
 * Das ist keine Kosmetik. Die NIP-42-Pruefung vergleicht Schema, Host UND Pfad des
 * `relay`-Tags strikt mit dem, was der Relay aus der Anfrage ableitet (nip42.go:
 * `expected.Scheme != found.Scheme`) — dort steht immer ws/wss. Der NIP-98-`u`-Tag
 * dagegen laeuft auf beiden Seiten durch `NormalizeURL`, das http→ws und https→wss
 * faltet; da ist die Form gleichgueltig. Ein einziger falscher Buchstabe im Schema
 * kostet den AUTH und damit den ganzen Lauf, also wird beides einmal zentral gebaut.
 */
function relayUrls(raw) {
    const trimmed = String(raw).trim().replace(/\/+$/, '')
    const m = /^([a-z]+):\/\/(.*)$/i.exec(trimmed)
    const scheme = m ? m[1].toLowerCase() : ''
    const rest = m ? m[2] : trimmed
    const local = /^(localhost|127\.0\.0\.1)(:|$)/.test(rest)
    const secure = scheme ? scheme === 'wss' || scheme === 'https' : !local
    return {
        ws: `${secure ? 'wss' : 'ws'}://${rest}`,
        http: `${secure ? 'https' : 'http'}://${rest}`,
    }
}

const RELAY = relayUrls(process.env.ZOOID_RELAY || process.env.RELAY_URL || 'wss://group.einundzwanzig.space')

/**
 * Schluessel NUR aus der Umgebung. Kein Vorgabewert, und im Fehlerfall wird der Wert
 * nie ausgegeben — eine Fehlermeldung landet in Logs, Mails und Terminal-Historien.
 */
function secretKey() {
    const raw = (process.env.RELAY_SECRET || '').trim()
    if (!raw) {
        throw new Error('RELAY_SECRET fehlt (64-hex oder nsec) — auch der Trockenlauf braucht ihn, weil das Lesen AUTH verlangt')
    }
    if (raw.startsWith('nsec1')) {
        return decode(raw).data
    }
    if (!isHex64(raw)) {
        throw new Error('RELAY_SECRET ist weder nsec noch 64-hex')
    }
    return hexToBytes(raw)
}

/**
 * Soll-Liste aus der Vereins-API.
 *
 * Die leere Liste ist ein FEHLER, kein Ergebnis: sie kaeme fast immer aus einem
 * API-Ausfall, und das Skript wuerde daraufhin jedem die Rolle entziehen. Die
 * Sicherung stand schon im Vorgaenger und im Buzz-Pendant — sie bleibt.
 */
async function fetchApiSet() {
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
        throw new Error('Mitglieder-API lieferte 0 gueltige Pubkeys — Abbruch (sonst wuerde jede Rolle entzogen)')
    }
    return set
}

/**
 * Duenner Relay-Client: NIP-42-AUTH, REQ, EOSE. Kein `ws`-Paket — Node bringt
 * `WebSocket` global mit, und `~/member-sync` haelt als einzige Abhaengigkeit
 * `nostr-tools`. Uebernommen aus `buzz-member-sync.mjs`; hier ohne den Publish-Teil,
 * denn zooid wird nicht ueber Events verwaltet, sondern ueber NIP-86 (siehe nip86()).
 */
class Relay {
    constructor(url, sk) {
        this.url = url
        this.sk = sk
        this.subs = new Map()
        this.pending = new Map()
    }

    connect() {
        return new Promise((resolve, reject) => {
            this.ws = new WebSocket(this.url)
            const failEarly = (e) =>
                reject(new Error(`Verbindung zu ${this.url} fehlgeschlagen: ${e?.message ?? 'Socket-Fehler'}`))
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

    /**
     * Wartet auf die AUTH-Challenge und beantwortet sie. zooid schickt sie von sich
     * aus beim Verbindungsaufbau (`Instance.OnConnect` → `khatru.RequestAuth`), ein
     * Anstoss durch einen REQ ist nicht noetig.
     */
    async authenticate() {
        if (!this.challenge) {
            await new Promise((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error('keine AUTH-Challenge innerhalb von 15 s')), 15_000)
                this.onChallenge = () => {
                    clearTimeout(timer)
                    resolve()
                }
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

/**
 * NIP-86-Aufruf (NIP-98-signiert). Zwei Fallen, beide hier beruecksichtigt:
 *
 *  1. khatru antwortet auf einen FACHLICHEN Fehler mit **HTTP 200** und einem
 *     `error`-Feld im Rumpf. Wer nur `res.ok` prueft, haelt jeden Fehlschlag fuer
 *     Erfolg — deshalb wird `json.error` VOR dem Statuscode geprueft.
 *  2. Das Auth-Event darf hoechstens 30 s alt sein (`nip86.go`), also wird pro
 *     Aufruf frisch signiert und nicht einmal fuer den ganzen Lauf.
 */
async function nip86(sk, method, params) {
    const body = JSON.stringify({ method, params })
    const payload = createHash('sha256').update(body).digest('hex')
    const auth = finalizeEvent(
        {
            kind: HTTP_AUTH,
            created_at: Math.floor(Date.now() / 1000),
            tags: [
                ['u', RELAY.http],
                ['method', 'POST'],
                ['payload', payload],
            ],
            content: '',
        },
        sk,
    )
    const res = await fetch(RELAY.http, {
        method: 'POST',
        body,
        headers: {
            'Content-Type': 'application/nostr+json+rpc',
            Authorization: 'Nostr ' + Buffer.from(JSON.stringify(auth)).toString('base64'),
        },
        signal: AbortSignal.timeout(30_000),
    })
    const json = await res.json().catch(() => ({}))
    if (json.error) {
        throw new Error(json.error)
    }
    if (!res.ok) {
        throw new Error(`HTTP ${res.status}`)
    }
    return json.result
}

/**
 * Aktueller Stand aus der neuesten 13534: pubkey → Set aller Rollen-IDs.
 *
 * Bewusst ALLE Rollen, nicht nur die beiden verwalteten. Der Vorgaenger warf hier
 * fremde Rollen weg und konnte deshalb jemandem die Mitgliedschaft entziehen, der
 * z. B. `mod` traegt — die Rolle ueberlebte den Entzug nicht, weil `unallowpubkey`
 * die ganze Zeile aus der Liste nimmt. Wer eine nicht von hier verwaltete Rolle
 * haelt, ist aus einem anderen Grund Mitglied und geht uns nichts an.
 */
function parseMemberList(events) {
    const newest = [...events].sort((a, b) => b.created_at - a.created_at)[0]
    const map = new Map()
    if (!newest) {
        return { map, author: null }
    }
    for (const tag of newest.tags) {
        if (tag[0] === 'member' && isHex64(tag[1])) {
            map.set(tag[1], new Set(tag.slice(2).filter((r) => typeof r === 'string' && r !== '')))
        }
    }
    return { map, author: newest.pubkey }
}

async function main() {
    const sk = secretKey()
    const signerPub = getPublicKey(sk)

    const roles = [
        { id: VEREIN, label: 'Vereinsmitglied', desired: await fetchApiSet() },
        { id: VORSTAND, label: 'Vorstand', desired: new Set(VORSTAND_PUBKEYS.filter(isHex64)) },
    ]
    const managedIds = new Set(roles.map((r) => r.id))

    const relay = new Relay(RELAY.ws, sk)
    await relay.connect()
    await relay.authenticate()

    // Rollendefinitionen zuerst. Fehlt eine, scheitert JEDE Zuweisung an ihr
    // (`role "…" does not exist`) — dann lieber einmal klar abbrechen als
    // hunderte Einzelfehler zu protokollieren.
    const defs = await relay.req({ kinds: [ROLE_DEFINITION], '#d': [VEREIN, VORSTAND] })
    const definedIds = new Set(defs.map((e) => e.tags.find((t) => t[0] === 'd')?.[1]).filter(Boolean))
    const missingDefs = roles.filter((r) => !definedIds.has(r.id))
    if (missingDefs.length > 0) {
        relay.close()
        throw new Error(
            `Auf ${RELAY.ws} fehlt die Rollendefinition (kind ${ROLE_DEFINITION}) fuer: ` +
                missingDefs.map((r) => `${r.label} (${r.id})`).join(', ') +
                '. Ohne sie weist zooid jedes assignrole ab. Anlegen per NIP-86 `createrole` ' +
                '(Params: [id, label, description, hue:int 0-360, order:int]) — Hue als ZAHL, nicht als Array.',
        )
    }

    const { map: current, author } = parseMemberList(await relay.req({ kinds: [MEMBER_LIST], limit: 1 }))

    // Soll-Endzustand je Pubkey (nur verwaltete Rollen).
    const desiredByPk = new Map()
    for (const r of roles) {
        for (const pk of r.desired) {
            if (!desiredByPk.has(pk)) {
                desiredByPk.set(pk, new Set())
            }
            desiredByPk.get(pk).add(r.id)
        }
    }

    const assigns = []
    const unassigns = []
    for (const r of roles) {
        for (const pk of r.desired) {
            if (!current.get(pk)?.has(r.id)) {
                assigns.push([pk, r.id, r.label])
            }
        }
        for (const [pk, held] of current) {
            if (held.has(r.id) && !r.desired.has(pk) && !PROTECTED_PUBKEYS.has(pk)) {
                unassigns.push([pk, r.id, r.label])
            }
        }
    }

    // Mitgliedschaft entziehen: hielt verwaltete Rolle(n), soll keine mehr haben —
    // und haelt auch sonst keine. Relay-Admins (config `can_manage`) sind zusaetzlich
    // relay-seitig geschuetzt: `RemoveMember` verweigert sie ("Can't remove permanent
    // admins from relay."), das Skript kann sie also gar nicht herauswerfen.
    const removals = []
    for (const [pk, held] of current) {
        const managedHeld = [...held].filter((id) => managedIds.has(id))
        const foreignHeld = [...held].filter((id) => !managedIds.has(id))
        if (managedHeld.length > 0 && !desiredByPk.get(pk)?.size && foreignHeld.length === 0 && !PROTECTED_PUBKEYS.has(pk)) {
            removals.push(pk)
        }
    }

    const protectedByForeignRole = [...current.values()].filter((held) =>
        [...held].some((id) => !managedIds.has(id)),
    ).length
    const protectedByKey = [...current.keys()].filter((pk) => PROTECTED_PUBKEYS.has(pk)).length

    console.log(
        `Relay:    ${RELAY.ws} (Verwaltung ueber ${RELAY.http})\n` +
            `Absender: ${signerPub}\n` +
            `Liste:    ${current.size} Eintraege in der 13534${author ? `, signiert von ${author.slice(0, 12)}…` : ' — KEINE Liste gefunden'} ` +
            `(geschuetzt: ${protectedByForeignRole} durch fremde Rolle, ${protectedByKey} per Pubkey)\n` +
            `Soll:     ${roles[0].desired.size} Vereinsmitglieder / ${roles[1].desired.size} Vorstand\n` +
            `Plan:     +${assigns.length} zuweisen  -${unassigns.length} entziehen  x${removals.length} Mitgliedschaft entziehen` +
            (APPLY ? '' : '   [TROCKENLAUF]'),
    )

    // Geschuetzte Pubkeys benennen statt stillschweigend uebergehen — sonst waechst
    // die Ausnahmeliste unbemerkt und niemand raeumt sie je auf.
    const protectedAndUnknown = [...current.keys()].filter((pk) => PROTECTED_PUBKEYS.has(pk) && !desiredByPk.has(pk))
    if (protectedAndUnknown.length > 0) {
        console.log(
            `Hinweis:  ${protectedAndUnknown.length} geschuetzte Pubkeys stehen in keiner Quelle ` +
                `(${protectedAndUnknown.map((pk) => pk.slice(0, 8)).join(', ')}) — bewusste Ausnahme, siehe PROTECTED_PUBKEYS.`,
        )
    }

    // DECKEL. Gezaehlt werden PERSONEN, die etwas verlieren (Rollenentzug und/oder
    // Mitgliedschaft), nicht Aufrufe — sonst zaehlte ein Doppelrollen-Entzug doppelt
    // und der Deckel schluege bei der halben Menge an. Eine dreistellige Zahl hier ist
    // die Signatur eines unvollstaendigen API-Ergebnisses, nicht die von Austritten.
    const losers = new Set([...unassigns.map(([pk]) => pk), ...removals])
    if (losers.size > MAX_REMOVALS && !FORCE) {
        relay.close()
        throw new Error(
            `${losers.size} Pubkeys wuerden Rolle oder Mitgliedschaft verlieren — ueber MAX_REMOVALS=${MAX_REMOVALS}. ` +
                'Erst pruefen (Trockenlauf, Mitglieder-API), dann mit FORCE=1 wiederholen.',
        )
    }

    if (!APPLY) {
        for (const [pk, , label] of assigns) {
            console.log(`  + ${label} ${pk}`)
        }
        for (const [pk, , label] of unassigns) {
            console.log(`  - ${label} ${pk}`)
        }
        for (const pk of removals) {
            console.log(`  x Mitgliedschaft ${pk}`)
        }
        relay.close()
        console.log('Trockenlauf — es wurde nichts geschrieben.')
        return 0
    }

    const failed = []
    // Reihenfolge wie im Vorgaenger: erst zuweisen, dann entziehen, zuletzt die
    // Mitgliedschaft. `assignrole` macht den Pubkey noetigenfalls zum Mitglied
    // (`management.go:365-368`), deshalb darf Zuweisen nie hinter einem Entzug stehen.
    for (const [pk, id, label] of assigns) {
        try {
            await nip86(sk, 'assignrole', [pk, id])
            console.log(`  + ${label} ${pk}`)
        } catch (e) {
            console.error(`  ! assign ${label} ${pk}: ${e.message}`)
            failed.push([pk, `assign ${label}`, e.message])
        }
    }
    for (const [pk, id, label] of unassigns) {
        try {
            await nip86(sk, 'unassignrole', [pk, id])
            console.log(`  - ${label} ${pk}`)
        } catch (e) {
            console.error(`  ! unassign ${label} ${pk}: ${e.message}`)
            failed.push([pk, `unassign ${label}`, e.message])
        }
    }
    for (const pk of removals) {
        try {
            await nip86(sk, 'unallowpubkey', [pk, 'keine verwaltete Rolle mehr'])
            console.log(`  x Mitgliedschaft ${pk}`)
        } catch (e) {
            console.error(`  ! Mitgliedschaft ${pk}: ${e.message}`)
            failed.push([pk, 'Mitgliedschaft entziehen', e.message])
        }
    }

    // NACHKONTROLLE gegen die neu gelesene Liste, nicht gegen die Antworten von eben.
    // Eine angenommene Anfrage ist keine vollzogene Aenderung — im Buzz-Pendant steht
    // derselbe Absatz, dort ausgeloest durch vier Mitglieder, die nach lauter
    // Erfolgsmeldungen trotzdem fehlten.
    await sleep(1500)
    const { map: after } = parseMemberList(await relay.req({ kinds: [MEMBER_LIST], limit: 1 }))
    relay.close()

    const stillMissing = assigns.filter(([pk, id]) => !after.get(pk)?.has(id))
    const stillAssigned = unassigns.filter(([pk, id]) => after.get(pk)?.has(id))
    const stillMember = removals.filter((pk) => after.has(pk))

    console.log(`\nNachkontrolle: ${after.size} Eintraege in der 13534.`)
    if (failed.length) {
        console.log('Abgelehnt:')
        for (const [pk, what, msg] of failed) {
            console.log(`  ${pk} (${what}): ${msg}`)
        }
    }
    for (const [titel, liste] of [
        ['NICHT zugewiesen', stillMissing.map(([pk, , label]) => `${label} ${pk}`)],
        ['NICHT entzogen', stillAssigned.map(([pk, , label]) => `${label} ${pk}`)],
        ['NOCH Mitglied', stillMember],
    ]) {
        if (liste.length) {
            console.log(`${titel} (${liste.length}):`)
            for (const zeile of liste) {
                console.log(`  ${zeile}`)
            }
        }
    }
    if (!failed.length && !stillMissing.length && !stillAssigned.length && !stillMember.length) {
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
