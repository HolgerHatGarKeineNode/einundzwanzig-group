/**
 * Space-Directory: Mitglieder + Rollen — portiert aus Flotillas
 * `src/app/members.ts` (nur der Lese-Teil für M3; Admin-Mutationen via
 * `manageRelay`/NIP-86 kommen mit M6).
 *
 * Autoritativ ist die **relay-signierte** Mitgliederliste (13534) und die
 * Rollendefinitionen (33534, app-lokal). Beide filtert `deriveRelaySignedEvents`
 * auf `pubkey === relay.self`. Rollen-Zuweisungen stehen als Extra-Werte an den
 * `["member", pubkey, ...roleIds]`-Tags der 13534.
 */
import { derived, type Readable } from 'svelte/store'
import { load } from '@welshman/net'
import { profilesByPubkey, loadProfile } from '@welshman/app'
import {
    RELAY_MEMBERS,
    getTags,
    getTagValue,
    getTagValues,
    displayProfile,
    type PublishedProfile,
} from '@welshman/util'
import { first, sortBy, uniq } from '@welshman/lib'
import * as nip19 from 'nostr-tools/nip19'
import { deriveRelaySignedEvents, deriveRelaySelfReady } from './repository'

/** RELAY_ROLE ist app-lokal (kein welshman-Kanon) — als Konstante mitgenommen. */
export const RELAY_ROLE = 33534

// ── Rollenfarbe (HSL) ────────────────────────────────────────────────────────

/**
 * HSL-Tupel aus dem `["color", hue, saturation, lightness]`-Tag; leere
 * Komponenten füllt der Client mit Defaults (lesbar in Light & Dark).
 */
export type SpaceRoleColor = { hue: string; saturation: string; lightness: string }

const DEFAULT_SATURATION = 0.7
const DEFAULT_LIGHTNESS = 0.5

const roleColorValue = (value: string, fallback: number): number => {
    const parsed = parseFloat(value)
    return isNaN(parsed) ? fallback : parsed
}

export const parseRoleColor = (tags: string[][]): SpaceRoleColor => {
    const tag = first(getTags('color', tags)) ?? []
    return { hue: tag[1] ?? '', saturation: tag[2] ?? '', lightness: tag[3] ?? '' }
}

/** `hue, saturation%, lightness%` einer Rollenfarbe (mit Defaults für leere Werte). */
const roleColorParts = (color: SpaceRoleColor): string => {
    const h = roleColorValue(color.hue, 0)
    const s = roleColorValue(color.saturation, DEFAULT_SATURATION)
    const l = roleColorValue(color.lightness, DEFAULT_LIGHTNESS)
    return `${h}, ${s * 100}%, ${l * 100}%`
}

/** `hsl(...)`-String aus einer Rollenfarbe (mit Defaults für leere Werte). */
export const roleColor = (color: SpaceRoleColor): string => `hsl(${roleColorParts(color)})`

/** Durchscheinende Tönung derselben Farbe als Badge-Hintergrund. */
export const roleColorSoft = (color: SpaceRoleColor): string => `hsl(${roleColorParts(color)}, 0.15)`

// ── Rollen (33534) & Mitglieder (13534) ──────────────────────────────────────

export type SpaceRole = {
    id: string
    label: string
    description: string
    color: SpaceRoleColor
    order: number
}

/** Die relay-signierten Rollendefinitionen eines Space, nach `order` sortiert. */
export const deriveSpaceRoles = (url: string): Readable<SpaceRole[]> =>
    derived(deriveRelaySignedEvents(url, [{ kinds: [RELAY_ROLE] }]), ($events) => {
        const roles: SpaceRole[] = []
        for (const event of $events) {
            const id = getTagValue('d', event.tags)
            if (id) {
                roles.push({
                    id,
                    label: getTagValue('label', event.tags) ?? '',
                    description: getTagValue('description', event.tags) ?? '',
                    color: parseRoleColor(event.tags),
                    order: parseInt(getTagValue('order', event.tags) ?? '0', 10) || 0,
                })
            }
        }
        return sortBy((r) => [r.order, r.label] as [number, string], roles)
    })

/** Mitglieder-Pubkeys aus der relay-signierten 13534-Liste. */
export const deriveSpaceMembers = (url: string): Readable<string[]> =>
    derived(deriveRelaySignedEvents(url, [{ kinds: [RELAY_MEMBERS] }]), ([event]) =>
        uniq(getTagValues('member', event?.tags ?? [])),
    )

/** Map<pubkey, roleId[]> aus den Extra-Werten der `member`-Tags (13534). */
export const deriveSpaceMemberRoles = (url: string): Readable<Map<string, string[]>> =>
    derived(deriveRelaySignedEvents(url, [{ kinds: [RELAY_MEMBERS] }]), ([event]) => {
        const memberRoles = new Map<string, string[]>()
        if (event) {
            for (const tag of getTags('member', event.tags)) {
                const pubkey = tag[1]
                if (pubkey) {
                    memberRoles.set(pubkey, tag.slice(2))
                }
            }
        }
        return memberRoles
    })

// ── Aggregierte UI-Sicht ─────────────────────────────────────────────────────

export type RoleView = { id: string; label: string; color: string; soft: string }
export type MemberView = {
    pubkey: string
    npub: string
    short: string
    name: string
    picture: string
    roles: RoleView[]
    search: string
}
export type DirectoryView = { ready: boolean; members: MemberView[] }

/** Kurzform eines npub für die Anzeige ohne Profil. */
const shortNpub = (npub: string): string => `${npub.slice(0, 12)}…${npub.slice(-6)}`

/**
 * Ein einziger reaktiver Snapshot des Directorys: `ready` (Fix A: relay.self da)
 * + Mitglieder mit aufgelösten Rollen und Profilnamen. Die Insel braucht so nur
 * EIN `subscribe`. Solange `ready` false ist, zeigt die UI einen Skeleton statt
 * einer (falschen) leeren Liste.
 */
export const deriveSpaceDirectory = (url: string): Readable<DirectoryView> =>
    derived(
        [
            deriveRelaySelfReady(url),
            deriveSpaceMembers(url),
            deriveSpaceMemberRoles(url),
            deriveSpaceRoles(url),
            profilesByPubkey,
        ],
        ([ready, members, memberRoles, roles, $profiles]) => {
            const roleById = new Map(roles.map((r) => [r.id, r]))
            const toRoleView = (id: string): RoleView | null => {
                const role = roleById.get(id)
                return role
                    ? { id, label: role.label || id, color: roleColor(role.color), soft: roleColorSoft(role.color) }
                    : null
            }

            const views = members.map((pubkey): MemberView => {
                const npub = nip19.npubEncode(pubkey)
                const profile = $profiles.get(pubkey) as PublishedProfile | undefined
                const name = displayProfile(profile, shortNpub(npub))
                const memberRoleViews = (memberRoles.get(pubkey) ?? [])
                    .map(toRoleView)
                    .filter((r): r is RoleView => r !== null)
                return {
                    pubkey,
                    npub,
                    short: shortNpub(npub),
                    name,
                    picture: profile?.picture ?? '',
                    roles: memberRoleViews,
                    search: `${name} ${npub}`.toLowerCase(),
                }
            })

            return { ready, members: sortBy((m) => m.name.toLowerCase(), views) }
        },
    )

// ── Laden ────────────────────────────────────────────────────────────────────

/** Lädt Mitglieder- und Rollen-Events (13534/33534) vom Space-Relay. */
export const loadSpaceDirectory = (url: string): Promise<unknown> =>
    load({ relays: [url], filters: [{ kinds: [RELAY_MEMBERS, RELAY_ROLE] }] })

/** Lädt die kind-0-Profile der Mitglieder nach (Namen/Avatare). */
export const loadMemberProfiles = (pubkeys: string[]): void => {
    for (const pubkey of pubkeys) {
        loadProfile(pubkey)
    }
}
