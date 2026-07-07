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
    userSpaceUrls,
    activeSpace,
    activeSpaceView,
    setActiveSpace,
    displayRelayUrl,
    loadUserGroupList,
    loadSpaceRooms,
    type SpaceView,
} from './groups'

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
    data: (name: string, factory: () => unknown) => void
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
            this._unsubActive = activeSpace.subscribe((url: string | null) => {
                if (url && !this._loaded.has(url)) {
                    this._loaded.add(url)
                    loadSpaceRooms(url)
                }
            })
            this._unsubView = activeSpaceView.subscribe((view: SpaceView | null) => {
                this.space = view
            })
        },
        destroy() {
            this._unsubActive?.()
            this._unsubView?.()
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
            this._unsubUrls = userSpaceUrls.subscribe((urls: string[]) => {
                this.spaces = urls.map((url) => ({ url, label: displayRelayUrl(url) }))
            })
            this._unsubActive = activeSpace.subscribe((url: string | null) => {
                this.active = url
            })
        },
        choose(url: string) {
            setActiveSpace(url)
            window.location.assign('/spaces')
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
