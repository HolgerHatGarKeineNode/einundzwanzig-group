/**
 * Nostr-Login: Signer-Auswahl + welshman-Session. Signing bleibt zu 100 % im
 * Browser — der Server sieht später nur den (via NIP-98 verifizierten) pubkey.
 *
 * Portiert aus Flotillas LogIn*.svelte + src/app/session.ts. welshman hält die
 * globalen Stores `pubkey`/`sessions`/`signer`; wir binden `pubkey`+`sessions`
 * an localStorage, damit der Login einen Reload überlebt. Der Signer selbst wird
 * NICHT persistiert — er wird nach Reload aus der Session rekonstruiert.
 */
import {
    pubkey,
    sessions,
    loginWithNip01,
    loginWithNip07,
    loginWithNip46,
    dropSession,
} from '@welshman/app'
import { getNip07, Nip46Broker } from '@welshman/signer'
import { makeSecret } from '@welshman/util'
import { sync, localStorageProvider } from '@welshman/store'
import { bytesToHex } from '@welshman/lib'
import * as nip19 from 'nostr-tools/nip19'
import { SIGNER_RELAYS } from './core'

/** Bindet pubkey + sessions an localStorage. Auflösen = initialer Load fertig. */
export const authReady = Promise.all([
    sync({ key: 'pubkey', store: pubkey, storage: localStorageProvider }),
    sync({ key: 'sessions', store: sessions, storage: localStorageProvider }),
])

/** NIP-07: Browser-Extension (`window.nostr`). Nur im Web verfügbar. */
export async function loginWithExtension(): Promise<void> {
    const pk = await getNip07()?.getPublicKey()
    if (!pk) {
        throw new Error('Keine NIP-07-Erweiterung gefunden (window.nostr).')
    }
    loginWithNip07(pk)
}

/** nsec1… oder 64-stelliger hex-Key. Der Key bleibt lokal (localStorage). */
export function loginWithSecretKey(input: string): void {
    const trimmed = input.trim()
    let secret: string
    if (trimmed.startsWith('nsec1')) {
        const { type, data } = nip19.decode(trimmed)
        if (type !== 'nsec') {
            throw new Error('Ungültiger nsec-Key.')
        }
        secret = bytesToHex(data as Uint8Array)
    } else if (/^[0-9a-f]{64}$/i.test(trimmed)) {
        secret = trimmed.toLowerCase()
    } else {
        throw new Error('Bitte einen nsec1…- oder 64-stelligen hex-Key eingeben.')
    }
    loginWithNip01(secret)
}

/** NIP-46: Bunker-URI (`bunker://…`). Remote-Signer, Key verlässt den Signer nie. */
export async function loginWithBunker(bunkerUri: string): Promise<void> {
    const { signerPubkey, connectSecret, relays } = Nip46Broker.parseBunkerUrl(bunkerUri.trim())
    const clientSecret = makeSecret()
    const broker = new Nip46Broker({
        relays: relays.length ? relays : SIGNER_RELAYS,
        clientSecret,
        signerPubkey,
    })
    const result = await broker.connect(connectSecret)
    const pk = await broker.getPublicKey()
    if (pk && ['ack', connectSecret].includes(result)) {
        broker.cleanup()
        loginWithNip46(pk, clientSecret, signerPubkey, broker.params.relays)
    } else {
        throw new Error('Bunker-Verbindung fehlgeschlagen.')
    }
}

/** Aktive Session beenden (Signer-Cleanup + Store leeren → localStorage folgt). */
export function logout(): void {
    const pk = pubkey.get()
    if (pk) {
        dropSession(pk)
    }
}
