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
    method: 'nsec' | 'bunker'
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

export function registerNostrComponents(Alpine: {
    data: (name: string, factory: () => unknown) => void
}) {
    // Nostr-Login: spiegelt den welshman-`pubkey`-Store nach Alpine und bietet
    // die Signer-Pfade (Extension/nsec/Bunker). Signing bleibt im Browser.
    Alpine.data('nostrAuth', (): AuthState => ({
        pubkey: null,
        npub: '',
        hasExtension: false,
        method: 'nsec',
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
        events: [] as TrustedEvent[],
        loading: true,
        error: '',
        _unsub: null as null | (() => void),
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
