/**
 * welshman-Kern: konfiguriert die globalen Singletons EINMAL app-weit.
 *
 * welshman erzeugt keine eigenen Instanzen — `repository`, `tracker`, `pubkey`,
 * `sessions` sind globale Singletons aus `@welshman/app`; konfiguriert wird über
 * die mutierbaren Kontext-Objekte (`appContext`/`netContext`/`routerContext`).
 * Genau wie Flotillas globaler App-Init (src/routes/+layout.svelte), nur ohne
 * SvelteKit. Persistenz (IndexedDB) folgt später (Fix A, M3).
 */
import { appContext } from '@welshman/app'
import { netContext } from '@welshman/net'
import { routerContext } from '@welshman/router'
import { always } from '@welshman/lib'
import { verifyEvent, type TrustedEvent } from '@welshman/util'

/** Default-Relays (aus Flotilla .env übernommen). NativePHP/Web identisch. */
export const INDEXER_RELAYS = [
    'wss://purplepag.es/',
    'wss://relay.damus.io/',
    'wss://indexer.coracle.social/',
]

export const DEFAULT_RELAYS = [
    'wss://relay.damus.io/',
    'wss://relay.primal.net/',
    'wss://nostr.mom/',
]

export const SIGNER_RELAYS = [
    'wss://relay.nsec.app/',
    'wss://bucket.coracle.social/',
]

appContext.dufflepudUrl = 'https://dufflepud.coracle.social'
routerContext.getIndexerRelays = always(INDEXER_RELAYS)
routerContext.getDefaultRelays = always(DEFAULT_RELAYS)
netContext.isEventValid = (event: TrustedEvent, _url: string) => verifyEvent(event)
