/**
 * Room-Chat-Feed (M4, read-only) — inspiriert von `makeFeed` des Referenz-Clients,
 * aber schlank für die Alpine-Insel: statt bidirektionalem Sliding-Window-Scroller
 * eine Live-Subscription (`limit:0`) + Cursor-Pagination (`until`) über die
 * ohnehin reaktive `deriveEventsForUrl`-Ableitung. Senden kommt mit M5.
 *
 * NIP-29: Room-Nachrichten sind **kind 9** (`MESSAGE`) mit `#h`=Room-ID, auf dem
 * Space-Relay. AUTH (NIP-42) läuft automatisch über die Socket-Policy.
 */
import { derived, type Readable } from 'svelte/store'
import { load, request } from '@welshman/net'
import { profilesByPubkey } from '@welshman/app'
import { parse, renderAsHtml } from '@welshman/content'
import { MESSAGE, sortEventsAsc, displayProfile, type TrustedEvent } from '@welshman/util'
import * as nip19 from 'nostr-tools/nip19'
import { deriveEventsForUrl } from './repository'

const roomFilter = (h: string) => [{ kinds: [MESSAGE], '#h': [h] }]

/** Aufsteigend sortierter Chat-Verlauf eines Rooms (reaktiv aus dem Repository). */
const deriveRoomMessages = (url: string, h: string): Readable<TrustedEvent[]> =>
    derived(deriveEventsForUrl(url, roomFilter(h)), (events) => sortEventsAsc(events))

/** Rendert den Nachrichtentext zu sicherer HTML (Text escaped, URLs sanitized). */
const htmlCache = new Map<string, string>()
const renderMessageHtml = (event: TrustedEvent): string => {
    let html = htmlCache.get(event.id)
    if (html === undefined) {
        html = renderAsHtml(parse({ content: event.content, tags: event.tags })).toString()
        htmlCache.set(event.id, html)
    }
    return html
}

const shortNpub = (npub: string): string => `${npub.slice(0, 12)}…${npub.slice(-6)}`

const dayLabel = (ts: number): string =>
    new Date(ts * 1000).toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' })

const timeLabel = (ts: number): string =>
    new Date(ts * 1000).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })

export type ChatMessage = {
    id: string
    pubkey: string
    created_at: number
    time: string
    name: string
    picture: string
    html: string
    divider: string // Datums-Trenner, wenn der Tag wechselt (sonst '')
    showAuthor: boolean // erster Beitrag eines Autor-Blocks (Gruppierung)
}

/**
 * Aggregierte Chat-Sicht: Nachrichten mit aufgelösten Profilen, Datums-Dividern
 * und Autor-Gruppierung — die Insel braucht nur EIN `subscribe`. HTML wird je
 * Event einmal geparst (Cache), Namen fließen reaktiv aus `profilesByPubkey`.
 */
export const deriveRoomChat = (url: string, h: string): Readable<ChatMessage[]> =>
    derived([deriveRoomMessages(url, h), profilesByPubkey], ([events, $profiles]) => {
        let prevDay = ''
        let prevPubkey = ''
        return events.map((event): ChatMessage => {
            const day = dayLabel(event.created_at)
            const divider = day !== prevDay ? day : ''
            const showAuthor = event.pubkey !== prevPubkey || divider !== ''
            prevDay = day
            prevPubkey = event.pubkey

            const npub = nip19.npubEncode(event.pubkey)
            const profile = $profiles.get(event.pubkey)
            return {
                id: event.id,
                pubkey: event.pubkey,
                created_at: event.created_at,
                time: timeLabel(event.created_at),
                name: displayProfile(profile, shortNpub(npub)),
                picture: profile?.picture ?? '',
                html: renderMessageHtml(event),
                divider,
                showAuthor,
            }
        })
    })

/** Öffnet eine Live-Subscription für NEUE Room-Nachrichten (bleibt bis abort offen). */
export const listenRoom = (url: string, h: string, signal: AbortSignal): void => {
    void request({ relays: [url], signal, filters: roomFilter(h).map((f) => ({ ...f, limit: 0 })) })
}

/**
 * Lädt Room-Nachrichten vom Space-Relay: die jüngsten (initial) oder — mit
 * `until` — die nächstälteren. Gibt die geladenen Events zurück (für „hasMore").
 */
export const loadRoomMessages = (url: string, h: string, until?: number): Promise<TrustedEvent[]> =>
    load({ relays: [url], filters: roomFilter(h).map((f) => ({ ...f, limit: 50, ...(until ? { until } : {}) })) })
