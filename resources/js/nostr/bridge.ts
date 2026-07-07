/**
 * Reaktivitäts-Bridge: welshman-Store (Svelte-Contract) → Alpine.
 *
 * welshman-Stores erfüllen den Svelte-Store-Contract (`subscribe(cb) => unsub`),
 * ohne Svelte-Compiler. `alpineFromStore` koppelt jeden Store an Alpine-State;
 * `init`/`destroy` folgen dem Alpine-Lifecycle (kein Doppel-Alpine).
 */
import type { Readable } from 'svelte/store'
import { repository, pubkey } from '@welshman/app'
import { load } from '@welshman/net'
import { deriveEvents } from '@welshman/store'
import type { TrustedEvent } from '@welshman/util'
import * as nip19 from 'nostr-tools/nip19'
import { DEFAULT_RELAYS } from './core'
import {
    loginWithExtension,
    loginWithSecretKey,
    loginWithBunker,
    logout,
    handoffToServer,
    logoutServer,
} from './session'
import {
    spaceChoices,
    activeSpace,
    activeSpaceView,
    setActiveSpace,
    displayRelayUrl,
    loadUserGroupList,
    loadSpaceRooms,
    listenRoomMembers,
    deriveUserInRoom,
    joinRoom,
    leaveRoom,
    type SpaceView,
} from './groups'
import {
    deriveSpaceDirectory,
    loadSpaceDirectory,
    loadMemberProfiles,
    type DirectoryView,
    type MemberView,
} from './members'
import {
    deriveRoomChat,
    listenRoom,
    loadRoomMessages,
    sendRoomMessage,
    deleteRoomMessage,
    type ChatMessage,
} from './feeds'

/** Alpine-Magics, die auf `this` einer Komponente verfügbar sind. */
type AlpineMagics = { $refs: Record<string, HTMLElement>; $nextTick: (cb: () => void) => void }

/** Generischer Adapter (für M2+): spiegelt einen Store in `this.value`. */
export function alpineFromStore<T>(store: Readable<T>) {
    return {
        value: undefined as T | undefined,
        _unsub: null as null | (() => void),
        init() {
            this._unsub = store.subscribe((v) => {
                this.value = v
            })
        },
        destroy() {
            this._unsub?.()
        },
    }
}

/**
 * Registriert Alpine-Komponenten. Wird in `alpine:init` aufgerufen (= vor dem
 * Alpine/Livewire-Start), damit `x-data="…"` die Komponenten kennt.
 */
type SmokeState = {
    events: TrustedEvent[]
    loading: boolean
    error: string
    _unsub: null | (() => void)
    init(): void
    destroy(): void
}

type AuthState = {
    pubkey: string | null
    npub: string
    hasExtension: boolean
    keyInput: string
    bunkerInput: string
    busy: boolean
    error: string
    _unsub: null | (() => void)
    init(): void
    destroy(): void
    completeLogin(fn: () => void | Promise<void>): Promise<void>
    loginExtension(): Promise<void>
    loginNsec(): Promise<void>
    loginBunker(): Promise<void>
    doLogout(): Promise<void>
}

type SpacesState = {
    space: SpaceView | null
    loading: boolean
    _unsubView: null | (() => void)
    _unsubActive: null | (() => void)
    _loaded: Set<string>
    init(): void
    destroy(): void
}

type DirectoryState = {
    ready: boolean
    members: MemberView[]
    query: string
    _unsubActive: null | (() => void)
    _unsubDir: null | (() => void)
    _loadedDir: Set<string>
    _loadedProfiles: Set<string>
    init(): void
    destroy(): void
    filtered(): MemberView[]
}

type RoomChatState = {
    h: string
    messages: ChatMessage[]
    loading: boolean
    loadingMore: boolean
    hasMore: boolean
    atBottom: boolean
    unread: number
    joined: boolean
    joining: boolean
    membershipReady: boolean
    draft: string
    sending: boolean
    error: string
    _url: string | null
    _unsubActive: null | (() => void)
    _unsub: null | (() => void)
    _unsubJoined: null | (() => void)
    _controller: AbortController | null
    _loadedProfiles: Set<string>
    init(): void
    setup(url: string): void
    teardown(): void
    loadOlder(): void
    onScroll(): void
    scrollToBottom(): void
    send(): Promise<void>
    remove(id: string, createdAt: number): Promise<void>
    join(): Promise<void>
    leave(): Promise<void>
    destroy(): void
}

type SpaceSettingsState = {
    spaces: { url: string; label: string }[]
    active: string | null
    _unsubUrls: null | (() => void)
    _unsubActive: null | (() => void)
    init(): void
    destroy(): void
    choose(url: string): void
}

export function registerNostrComponents(Alpine: {
    data: (name: string, factory: (...args: unknown[]) => unknown) => void
}) {
    // Space/Room-Navigation (M2, Single-Space §12): lädt die 10009-Membership,
    // zieht die Room-Metas (39000) des AKTIVEN Space nach und spiegelt genau
    // diesen einen Space nach Alpine. Kein Multi-Space-Layout, keine Rail.
    // AUTH gegen zooid läuft automatisch (Signer aus der Session).
    Alpine.data('nostrSpaces', (): SpacesState => ({
        space: null,
        loading: true,
        _unsubView: null,
        _unsubActive: null,
        _loaded: new Set<string>(),
        init() {
            loadUserGroupList()?.finally(() => {
                this.loading = false
            })
            // Aktiver Space → dessen Rooms laden (Wechsel baut Subs neu auf).
            this._unsubActive = activeSpace.subscribe((url: string) => {
                if (!this._loaded.has(url)) {
                    this._loaded.add(url)
                    loadSpaceRooms(url)
                }
            })
            this._unsubView = activeSpaceView.subscribe((view: SpaceView) => {
                this.space = view
            })
        },
        destroy() {
            this._unsubActive?.()
            this._unsubView?.()
        },
    }))

    // Space-Directory (M3): Mitglieder + Rollen des AKTIVEN Space. Gated auf
    // relay.self (Fix A) — bis NIP-11 da ist, Skeleton statt „keine Mitglieder".
    // Client-Suche filtert über Name + npub. Kein Multi-Space (§12).
    Alpine.data('nostrDirectory', (): DirectoryState => ({
        ready: false,
        members: [],
        query: '',
        _unsubActive: null,
        _unsubDir: null,
        _loadedDir: new Set<string>(),
        _loadedProfiles: new Set<string>(),
        init() {
            // Aktiver Space → dessen Directory laden + Sub neu aufbauen.
            this._unsubActive = activeSpace.subscribe((url: string) => {
                this._unsubDir?.()
                this._unsubDir = null
                this.ready = false
                this.members = []
                if (!this._loadedDir.has(url)) {
                    this._loadedDir.add(url)
                    loadSpaceDirectory(url)
                }
                this._unsubDir = deriveSpaceDirectory(url).subscribe((view: DirectoryView) => {
                    this.ready = view.ready
                    this.members = view.members
                    // Profile der (neuen) Mitglieder nachladen — einmal je pubkey.
                    // `loadMemberProfiles` ignoriert leere Listen selbst.
                    const missing = view.members
                        .map((m) => m.pubkey)
                        .filter((pk) => !this._loadedProfiles.has(pk))
                    missing.forEach((pk) => this._loadedProfiles.add(pk))
                    loadMemberProfiles(url, missing)
                })
            })
        },
        filtered() {
            const q = this.query.trim().toLowerCase()
            return q ? this.members.filter((m) => m.search.includes(q)) : this.members
        },
        destroy() {
            this._unsubActive?.()
            this._unsubDir?.()
        },
    }))

    // Room-Chat (M4 lesen + M5 schreiben): Verlauf eines Raums im AKTIVEN Space.
    // Live-Sub (limit:0) + Cursor-Pagination. Senden/Löschen = kind 9/5 (optimistisch).
    // Beitreten/Verlassen = NIP-29 (kind 9021/9022) → relay-autoritative 39002-
    // Mitgliedschaft (persistent); der Composer ist an `joined` gekoppelt.
    Alpine.data('nostrRoomChat', (h: unknown): RoomChatState => ({
        h: String(h),
        messages: [],
        loading: true,
        loadingMore: false,
        hasMore: true,
        atBottom: true,
        unread: 0,
        joined: false,
        joining: false,
        membershipReady: false,
        draft: '',
        sending: false,
        error: '',
        _url: null,
        _unsubActive: null,
        _unsub: null,
        _unsubJoined: null,
        _controller: null,
        _loadedProfiles: new Set<string>(),
        init() {
            // Aktiver Space → dessen Room-Feed (Wechsel baut Sub + Live neu auf).
            this._unsubActive = activeSpace.subscribe((url: string) => this.setup(url))
        },
        setup(url: string) {
            this.teardown()
            this._url = url
            this.loading = true
            this.membershipReady = false
            this.messages = []
            this._controller = new AbortController()
            // Raum-Metas + Mitglieder (39002) laden; Live-Sub auf 39002, damit
            // Beitreten/Verlassen sofort reflektiert. `membershipReady` verhindert
            // ein Aufblitzen des Beitreten-Hinweises, bevor die 39002 da ist.
            loadSpaceRooms(url).finally(() => {
                this.membershipReady = true
            })
            listenRoomMembers(url, this._controller.signal)
            this._unsubJoined = deriveUserInRoom(url, this.h).subscribe((isMember: boolean) => {
                this.joined = isMember
            })
            listenRoom(url, this.h, this._controller.signal)
            loadRoomMessages(url, this.h).finally(() => {
                this.loading = false
            })
            this._unsub = deriveRoomChat(url, this.h).subscribe((msgs: ChatMessage[]) => {
                const wasAtBottom = this.atBottom
                const grew = msgs.length > this.messages.length
                this.messages = msgs

                // Profile neuer Autoren nachladen (einmal je pubkey).
                const missing = msgs
                    .map((m) => m.pubkey)
                    .filter((pk) => !this._loadedProfiles.has(pk))
                if (missing.length > 0) {
                    missing.forEach((pk) => this._loadedProfiles.add(pk))
                    loadMemberProfiles(url, missing)
                }

                const magics = this as unknown as AlpineMagics
                magics.$nextTick(() => {
                    if (wasAtBottom) {
                        this.scrollToBottom()
                    } else if (grew) {
                        this.unread++
                    }
                })
            })
        },
        // Ältere Nachrichten vor der aktuell ältesten laden; Scroll-Position halten.
        loadOlder() {
            if (this.loadingMore || !this._url || this.messages.length === 0) {
                return
            }
            this.loadingMore = true
            const el = (this as unknown as AlpineMagics).$refs.scroll
            const prevHeight = el?.scrollHeight ?? 0
            const oldest = this.messages[0].created_at
            loadRoomMessages(this._url, this.h, oldest)
                .then((events) => {
                    if (events.length === 0) {
                        this.hasMore = false
                    }
                })
                .finally(() => {
                    this.loadingMore = false
                    ;(this as unknown as AlpineMagics).$nextTick(() => {
                        if (el) {
                            el.scrollTop = el.scrollHeight - prevHeight
                        }
                    })
                })
        },
        onScroll() {
            const el = (this as unknown as AlpineMagics).$refs.scroll
            if (!el) {
                return
            }
            this.atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60
            if (this.atBottom) {
                this.unread = 0
            }
        },
        scrollToBottom() {
            const el = (this as unknown as AlpineMagics).$refs.scroll
            if (el) {
                el.scrollTop = el.scrollHeight
            }
            this.atBottom = true
            this.unread = 0
        },
        teardown() {
            this._controller?.abort()
            this._unsub?.()
            this._unsub = null
            this._unsubJoined?.()
            this._unsubJoined = null
        },
        // Nachricht senden (kind 9). Optimistisch: die Live-Sub echot sofort.
        async send() {
            const content = this.draft.trim()
            if (!content || this.sending || !this._url) {
                return
            }
            this.sending = true
            this.error = ''
            const draft = this.draft
            this.draft = ''
            try {
                const err = await sendRoomMessage(this._url, this.h, content)
                if (err) {
                    this.error = err
                    this.draft = draft // Text zurückgeben, damit nichts verloren geht
                } else {
                    this.scrollToBottom()
                }
            } finally {
                this.sending = false
            }
        },
        // Eigene Nachricht löschen (kind 5). Repository blendet sie sofort aus.
        async remove(id: string, createdAt: number) {
            if (!this._url) {
                return
            }
            const err = await deleteRoomMessage(this._url, this.h, id, createdAt)
            if (err) {
                this.error = err
            }
        },
        // Beitreten (kind 9021). Round-trip: `joined` flippt, sobald die vom Relay
        // aktualisierte 39002 über die Live-Sub eintrifft (kein optimistischer Fake).
        async join() {
            if (!this._url || this.joining) {
                return
            }
            this.joining = true
            this.error = ''
            try {
                const err = await joinRoom(this._url, this.h)
                if (err) {
                    this.error = err
                }
            } finally {
                this.joining = false
            }
        },
        // Verlassen (kind 9022). `joined` flippt mit der aktualisierten 39002.
        async leave() {
            if (!this._url || this.joining) {
                return
            }
            this.joining = true
            this.error = ''
            try {
                const err = await leaveRoom(this._url, this.h)
                if (err) {
                    this.error = err
                }
            } finally {
                this.joining = false
            }
        },
        destroy() {
            this._unsubActive?.()
            this.teardown()
        },
    }))

    // Space-Auswahl (Einstellungen): listet die beigetretenen Spaces und lässt
    // den aktiven wechseln. Der einzige Ort, an dem gewechselt wird (§12).
    Alpine.data('nostrSpaceSettings', (): SpaceSettingsState => ({
        spaces: [],
        active: null,
        _unsubUrls: null,
        _unsubActive: null,
        init() {
            loadUserGroupList()
            this._unsubUrls = spaceChoices.subscribe((urls: string[]) => {
                this.spaces = urls.map((url) => ({ url, label: displayRelayUrl(url) }))
            })
            this._unsubActive = activeSpace.subscribe((url: string) => {
                this.active = url
            })
        },
        choose(url: string) {
            setActiveSpace(url)
            // SPA-Navigation (welshman bleibt warm) statt Full-Reload.
            ;(window as unknown as { Livewire: { navigate: (u: string) => void } }).Livewire.navigate('/spaces')
        },
        destroy() {
            this._unsubUrls?.()
            this._unsubActive?.()
        },
    }))

    // Nostr-Login: spiegelt den welshman-`pubkey`-Store nach Alpine und bietet
    // die Signer-Pfade (Extension/nsec/Bunker). Signing bleibt im Browser.
    Alpine.data('nostrAuth', (): AuthState => ({
        pubkey: null,
        npub: '',
        hasExtension: false,
        keyInput: '',
        bunkerInput: '',
        busy: false,
        error: '',
        _unsub: null,
        init() {
            this.hasExtension = typeof (window as unknown as { nostr?: unknown }).nostr !== 'undefined'
            this._unsub = pubkey.subscribe((pk: string | undefined) => {
                this.pubkey = pk ?? null
                this.npub = pk ? nip19.npubEncode(pk) : ''
            })
        },
        // welshman-Login (Signer im Browser) → NIP-98-Handoff → Redirect ins Gate.
        // Schlägt der Handoff fehl, wird die welshman-Session zurückgerollt, damit
        // Browser- und Laravel-Zustand konsistent bleiben.
        async completeLogin(fn) {
            this.busy = true
            this.error = ''
            try {
                await fn()
                const redirect = await handoffToServer()
                window.location.assign(redirect)
            } catch (e) {
                this.error = e instanceof Error ? e.message : String(e)
                logout()
            } finally {
                this.busy = false
            }
        },
        loginExtension() {
            return this.completeLogin(loginWithExtension)
        },
        loginNsec() {
            return this.completeLogin(() => loginWithSecretKey(this.keyInput))
        },
        loginBunker() {
            return this.completeLogin(() => loginWithBunker(this.bunkerInput))
        },
        async doLogout() {
            logout()
            await logoutServer()
            this.keyInput = ''
            this.bunkerInput = ''
            window.location.assign('/nostr-login')
        },
        destroy() {
            this._unsub?.()
        },
    }))

    // M0-Smoke: lädt kind:1-Notes ins `repository` und rendert sie live über
    // deriveEvents → subscribe → Alpine. Beweist die komplette Bridge-Kette.
    Alpine.data('nostrSmoke', (): SmokeState => ({
        events: [],
        loading: true,
        error: '',
        _unsub: null,
        init() {
            const store = deriveEvents({ repository, filters: [{ kinds: [1] }] })
            this._unsub = store.subscribe((evs: TrustedEvent[]) => {
                this.events = evs.slice(0, 30)
            })
            load({ filters: [{ kinds: [1], limit: 30 }], relays: DEFAULT_RELAYS })
                .then(() => {
                    this.loading = false
                })
                .catch((e: unknown) => {
                    this.error = String(e)
                    this.loading = false
                })
        },
        destroy() {
            this._unsub?.()
        },
    }))
}
