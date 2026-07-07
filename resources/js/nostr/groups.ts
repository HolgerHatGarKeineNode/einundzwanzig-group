/**
 * Space/Room-Datenschicht — portiert aus Flotillas `src/app/groups.ts` (nur der
 * Lese-Teil für M2; Schreib-Ops/Join kommen mit M5).
 *
 * Modell (zooid/NIP-29): Ein **Space** ist eine Relay-URL (kein Event). Die
 * Membership steht in der **kind-10009**-Liste des Users (`["r",url]` = Space,
 * `["group",h,url]` = Room). Ein **Room** ist ein **kind-39000**-Event
 * (ROOM_META) auf genau diesem Relay; die Room→Space-Bindung entsteht über den
 * `tracker` (von welchem Relay das Event kam), nicht über ein Tag.
 */
import { derived, type Readable } from 'svelte/store'
import { repository, tracker, pubkey, makeUserData, makeOutboxLoader } from '@welshman/app'
import { deriveItemsByKey, deriveEventsByIdByUrl } from '@welshman/store'
import { load } from '@welshman/net'
import {
    ROOMS,
    ROOM_META,
    ROOM_DELETE,
    readList,
    readRoomMeta,
    asDecryptedEvent,
    getListTags,
    getRelayTagValues,
    getGroupTags,
    getTagValues,
    normalizeRelayUrl,
    isRelayUrl,
    type PublishedList,
    type TrustedEvent,
} from '@welshman/util'
import { uniq, sortBy, partition } from '@welshman/lib'

export type Room = ReturnType<typeof readRoomMeta> & { id: string; url: string }

/** Room-ID = `${url}'${h}` (Trennzeichen wie in Flotilla). */
export const makeRoomId = (url: string, h: string): string => `${url}'${h}`

// ── Space-Membership (kind 10009) ────────────────────────────────────────────

/** Die 10009-Liste je pubkey (nur public Tags — private Entschlüsselung: später). */
export const groupListsByPubkey = deriveItemsByKey<PublishedList>({
    repository,
    filters: [{ kinds: [ROOMS] }],
    eventToItem: (event) => readList(asDecryptedEvent(event)),
    getKey: (list) => list.event.pubkey,
})

/** Die 10009-Liste des eingeloggten Users. */
export const userGroupList = makeUserData(groupListsByPubkey)

/** Space-URLs aus der 10009-Liste: `r`-Tags + drittes Element der `group`-Tags. */
export const getSpaceUrlsFromGroupList = (groupList?: PublishedList): string[] => {
    if (!groupList) {
        return []
    }
    const tags = getListTags(groupList)
    const urls = getRelayTagValues(tags)
    for (const tag of getGroupTags(tags)) {
        const url = tag[2] || ''
        if (isRelayUrl(url)) {
            urls.push(url)
        }
    }
    return uniq(urls.map(normalizeRelayUrl))
}

/** Beigetretene Rooms (`h`) eines Space aus den `group`-Tags der 10009-Liste. */
export const getSpaceRoomsFromGroupList = (url: string, groupList?: PublishedList): string[] => {
    if (!groupList) {
        return []
    }
    const rooms: string[] = []
    for (const [, h, relay] of getGroupTags(getListTags(groupList))) {
        if (h && relay && normalizeRelayUrl(url) === normalizeRelayUrl(relay)) {
            rooms.push(h)
        }
    }
    return uniq(rooms)
}

/** Alle Spaces (Relay-URLs) des eingeloggten Users — Quelle der Space-Rail. */
export const userSpaceUrls = derived(userGroupList, getSpaceUrlsFromGroupList)

// ── Rooms (kind 39000 / 9008) ────────────────────────────────────────────────

/** Room-Meta-Events, nach Herkunfts-Relay gruppiert (via tracker). */
export const roomMetaEventsByIdByUrl = deriveEventsByIdByUrl({
    tracker,
    repository,
    filters: [{ kinds: [ROOM_META, ROOM_DELETE] }],
})

/** Rooms je Space-URL — 39000 zu `Room` geparst, 9008-Tombstones berücksichtigt. */
export const roomsByUrl = derived(roomMetaEventsByIdByUrl, ($byUrl) => {
    const result = new Map<string, Room[]>()
    for (const [url, eventsById] of $byUrl) {
        const events = Array.from(eventsById.values()) as TrustedEvent[]
        const [metas, deletes] = partition((e: TrustedEvent) => e.kind === ROOM_META, events)

        const deletedByH = new Map<string, number>()
        for (const del of deletes) {
            for (const h of getTagValues('h', del.tags)) {
                deletedByH.set(h, Math.max(deletedByH.get(h) ?? 0, del.created_at))
            }
        }

        const rooms: Room[] = []
        for (const event of metas) {
            const meta = readRoomMeta(event)
            if ((deletedByH.get(meta.h) ?? 0) >= event.created_at) {
                continue
            }
            rooms.push({ ...meta, url, id: makeRoomId(url, meta.h) })
        }
        result.set(url, rooms)
    }
    return result
})

/** Flacher Index aller Rooms nach `id`. */
export const roomsById = derived(roomsByUrl, ($byUrl) => {
    const result = new Map<string, Room>()
    for (const rooms of $byUrl.values()) {
        for (const room of rooms) {
            result.set(room.id, room)
        }
    }
    return result
})

/** Anzeigename eines Rooms (Name oder Fallback auf `h`). */
export const displayRoom = (room: Room | undefined, h: string): string => room?.name || h

const roomSortKey = ($byId: Map<string, Room>, url: string) => (h: string) =>
    displayRoom($byId.get(makeRoomId(url, h)), h).toLowerCase()

/** Beigetretene Rooms eines Space: 10009-`group`-Tags ∩ existierende 39000. */
export const deriveUserRooms = (url: string): Readable<string[]> =>
    derived([userGroupList, roomsById], ([$list, $byId]) => {
        const rooms: string[] = []
        for (const h of getSpaceRoomsFromGroupList(url, $list as PublishedList | undefined)) {
            if ($byId.has(makeRoomId(url, h))) {
                rooms.push(h)
            }
        }
        return sortBy(roomSortKey($byId, url), rooms)
    })

/** Entdeckbare (nicht beigetretene) Text-Rooms eines Space. */
export const deriveOtherRooms = (url: string): Readable<string[]> =>
    derived([deriveUserRooms(url), roomsByUrl, roomsById], ([$user, $byUrl, $byId]) => {
        const rooms: string[] = []
        for (const room of $byUrl.get(url) ?? []) {
            if (!$user.includes(room.h) && !room.livekit) {
                rooms.push(room.h)
            }
        }
        return sortBy(roomSortKey($byId, url), uniq(rooms))
    })

// ── Aggregierte Sicht für die UI ─────────────────────────────────────────────

export type RoomView = { h: string; name: string }
export type SpaceView = {
    url: string
    label: string
    userRooms: RoomView[]
    otherRooms: RoomView[]
}

/** Kürzt eine Relay-URL für die Anzeige (Schema/Trailing-Slash weg). */
export const displayRelayUrl = (url: string): string =>
    url.replace(/^wss?:\/\//, '').replace(/\/$/, '')

/**
 * Ein einziger reaktiver Snapshot aller Spaces des Users mit ihren beigetretenen
 * und entdeckbaren Rooms — die Alpine-Insel braucht so nur EIN `subscribe`, und
 * Space-/Room-Änderungen fließen automatisch (kein manuelles Sub-Management).
 */
export const userSpacesView: Readable<SpaceView[]> = derived(
    [userSpaceUrls, userGroupList, roomsByUrl, roomsById],
    ([$urls, $list, $byUrl, $byId]) => {
        const list = $list as PublishedList | undefined
        return $urls.map((url): SpaceView => {
            const nameOf = (h: string) => displayRoom($byId.get(makeRoomId(url, h)), h)

            const joined = getSpaceRoomsFromGroupList(url, list).filter((h) =>
                $byId.has(makeRoomId(url, h)),
            )
            const joinedSet = new Set(joined)
            const other = ($byUrl.get(url) ?? [])
                .filter((room) => !joinedSet.has(room.h) && !room.livekit)
                .map((room) => room.h)

            const toView = (hs: string[]) =>
                sortBy(nameOf, uniq(hs)).map((h) => ({ h, name: nameOf(h) }))

            return { url, label: displayRelayUrl(url), userRooms: toView(joined), otherRooms: toView(other) }
        })
    },
)

// ── Laden ────────────────────────────────────────────────────────────────────

/** Lädt die 10009-Liste des Users über dessen Outbox-Relays. */
export const loadUserGroupList = (): Promise<void> | undefined => {
    const pk = pubkey.get()
    return pk ? makeOutboxLoader(ROOMS)(pk) : undefined
}

/** Lädt die Room-Metas (39000/9008) eines Space direkt vom Space-Relay. */
export const loadSpaceRooms = (url: string): Promise<unknown> =>
    load({ relays: [url], filters: [{ kinds: [ROOM_META, ROOM_DELETE] }] })
