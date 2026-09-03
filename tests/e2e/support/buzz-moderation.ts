import { finalizeEvent } from 'nostr-tools/pure'
import { BUZZ_OWNER_SEC_HEX, BUZZ_PORT } from './buzz'

/**
 * NIP-98-signierte Lesezugriffe auf Buzz' Moderations-API — die **Gegenprobe am
 * Relay** für die Melde-Queue.
 *
 * Bewusst NICHT über den Client-Code (`js/nip98.ts`): eine Messung, die dieselbe
 * Implementierung benutzt wie das Messobjekt, belegt nichts. Hier wird der Header
 * unabhängig aus `nostr-tools` gebaut, mit dem Owner-Testschlüssel.
 *
 * **Jede Funktion wirft im Fehlerfall.** Ein Messgerät, das bei kaputter Auth ein
 * leeres Array liefert, macht jede Negativ-Assertion trivial grün — genau der
 * Fallstrick aus den Vorrunden (siehe `relayEvents()` in `buzz-admin.spec.ts`).
 */

const HTTP_BASE = `http://localhost:${BUZZ_PORT}`
const SEC = Uint8Array.from(Buffer.from(BUZZ_OWNER_SEC_HEX, 'hex'))

/** Ein Report-Datensatz, so wie `report_json` (`api/bridge.rs:2170-2191`) ihn liefert. */
export type BuzzReportRow = {
    id: string
    report_event_id: string
    reporter_pubkey: string
    target_kind: 'event' | 'pubkey' | 'blob'
    target: string
    channel_id: string | null
    report_type: string
    note: string | null
    status: 'open' | 'resolved' | 'dismissed'
    resolved_by: string | null
    resolved_at: string | null
    created_at: string
}

/**
 * Signierter GET auf eine Moderations-Route. Der `u`-Tag trägt **exakt** den URL,
 * der auch abgerufen wird — Buzz vergleicht gegen `path + "?" + raw_query`
 * (`bridge.rs:2065-2069`); eine Abweichung ergibt `401 … URL mismatch` (am
 * laufenden buzz-test-Stack gemessen).
 */
async function moderationGet(path: string, query: Record<string, string> = {}): Promise<unknown> {
    const qs = new URLSearchParams(query).toString()
    const url = `${HTTP_BASE}${path}${qs ? `?${qs}` : ''}`
    const event = finalizeEvent(
        {
            kind: 27235,
            created_at: Math.floor(Date.now() / 1000),
            // `nonce`: Buzz führt einen Replay-Guard über die Event-id
            // (`bridge.rs:136-176`). Zwei Abrufe derselben URL in derselben Sekunde
            // wären sonst dasselbe Event → `401 NIP-98: replay detected`.
            tags: [
                ['u', url],
                ['method', 'GET'],
                ['nonce', Math.random().toString(16).slice(2)],
            ],
            content: '',
        },
        SEC,
    )
    const auth = `Nostr ${Buffer.from(JSON.stringify(event), 'utf8').toString('base64')}`
    const res = await fetch(url, { headers: { Accept: 'application/json', Authorization: auth } })
    const body = await res.text()
    if (!res.ok) {
        throw new Error(`GET ${path} → HTTP ${res.status}: ${body}`)
    }
    return JSON.parse(body)
}

/** Eine Audit-Zeile, so wie `action_json` (`api/bridge.rs`) sie liefert. */
export type BuzzActionRow = {
    id: string
    actor_pubkey: string
    /** `ban` · `unban` · `timeout` · `untimeout` · `delete` · `resolve:*` · … */
    action: string
    target_pubkey: string | null
    target_event_id: string | null
    channel_id: string | null
    public_reason: string | null
    created_at: string
}

/**
 * Eine Zeile der Sperrliste, so wie `ban_json` (`api/bridge.rs`) sie liefert.
 *
 * `muted_until` ist die laufende **befristete Sperre** (RFC-3339), `banned` der
 * dauerhafte Bann. `list_restricted` (`buzz-db`) liefert nur Zeilen, die JETZT wirken:
 * ein aktiver Bann oder `muted_until > now()`.
 */
export type BuzzRestrictionRow = {
    pubkey: string
    banned: boolean
    ban_expires_at: string | null
    ban_reason: string | null
    muted_until: string | null
    mute_reason: string | null
    actor_pubkey: string
    updated_at: string
}

/** Alle Reports des Test-Space (optional nach Status gefiltert). Wirft bei Fehlern. */
export async function fetchReports(status?: string): Promise<BuzzReportRow[]> {
    const rows = await moderationGet('/moderation/reports', { ...(status ? { status } : {}), limit: '100' })
    if (!Array.isArray(rows)) {
        throw new Error(`/moderation/reports lieferte kein Array: ${JSON.stringify(rows)}`)
    }
    return rows as BuzzReportRow[]
}

/**
 * Wartet, bis ein Report zum gemeldeten Event auftaucht, und liefert ihn.
 *
 * Buzz bestätigt ein Event, bevor ein frischer Lesezugriff es sieht — nach dem
 * `OK` einmal nachzusehen ist zu ungeduldig (derselbe Grund wie beim `seedMessage`
 * in `buzz-admin.spec.ts`). Läuft die Frist ab, wirft das hier: „nicht gefunden"
 * darf nie als „leer, also in Ordnung" durchgehen.
 */
export async function waitForReport(targetEventId: string, attempts = 20): Promise<BuzzReportRow> {
    let last: unknown = null
    for (let i = 0; i < attempts; i++) {
        try {
            const hit = (await fetchReports()).find((r) => r.target === targetEventId)
            if (hit) {
                return hit
            }
        } catch (e) {
            last = e
        }
        await new Promise((r) => setTimeout(r, 500))
    }
    throw new Error(
        `Kein Report auf Event ${targetEventId} in der Moderations-Queue (${attempts} Versuche)` +
            (last ? ` — letzter Fehler: ${String(last)}` : ''),
    )
}

/**
 * Die Moderations-Audit-Zeilen des Test-Space, neueste zuerst. Wirft bei Fehlern.
 *
 * **Der einzige Erfolgsnachweis für 9042/9043.** Der Relay fuehrt Moderationsbefehle aus
 * und speichert sie NICHT (`handlers/ingest.rs`: 9042–9044 werden weder abgelegt noch
 * gefanoutet), ein `nak req -k 9042` liefert also strukturell nichts. Was bleibt, ist die
 * Audit-Zeile, die `insert_audit` je Befehl schreibt.
 */
export async function fetchAudit(limit = 100): Promise<BuzzActionRow[]> {
    const rows = await moderationGet('/moderation/audit', { limit: String(limit) })
    if (!Array.isArray(rows)) {
        throw new Error(`/moderation/audit lieferte kein Array: ${JSON.stringify(rows)}`)
    }
    return rows as BuzzActionRow[]
}

/** Die aktuell wirksamen Sperren (Banns UND laufende Timeouts). Wirft bei Fehlern. */
export async function fetchRestricted(): Promise<BuzzRestrictionRow[]> {
    const rows = await moderationGet('/moderation/restricted')
    if (!Array.isArray(rows)) {
        throw new Error(`/moderation/restricted lieferte kein Array: ${JSON.stringify(rows)}`)
    }
    return rows as BuzzRestrictionRow[]
}

/**
 * Wartet auf eine Audit-Zeile mit dieser Aktion gegen diesen Pubkey und liefert sie.
 *
 * Wirft beim Ablauf der Frist — „nicht gefunden" darf nie als „leer, also in Ordnung"
 * durchgehen (derselbe Grund wie bei [[waitForReport]]).
 */
export async function waitForAction(action: string, targetPubkey: string, attempts = 30): Promise<BuzzActionRow> {
    let last: unknown = null
    for (let i = 0; i < attempts; i++) {
        try {
            const hit = (await fetchAudit()).find((r) => r.action === action && r.target_pubkey === targetPubkey)
            if (hit) {
                return hit
            }
        } catch (e) {
            last = e
        }
        await new Promise((r) => setTimeout(r, 500))
    }
    throw new Error(
        `Keine Audit-Zeile `+ JSON.stringify(action) + ` auf ${targetPubkey} (${attempts} Versuche)` +
            (last ? ` — letzter Fehler: ${String(last)}` : ''),
    )
}
