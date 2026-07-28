import { type Page } from '@playwright/test'

// Isolierter Buzz-TEST-Stack (Compose-Projekt `buzz-test`, siehe buzz-testserver.sh).
// Bewusst EIN fester Port, kein Pro-Worker-Versatz wie bei zooid: der Buzz-Stack ist
// ein geteilter Docker-Compose-Stack (Postgres/Redis/MinIO), keine leichte Go-Binary,
// die man pro Worker beliebig oft hochfahren will. Der `buzz`-Modus fährt deshalb
// bewusst mit EINEM Playwright-Worker (siehe playwright.config.ts, E2E_RELAY=buzz
// erzwingt workers:1) — keine Kollisionsgefahr über Räume/Sessions.
// Der Mitschau-Stack `buzz-prod` auf :3000 bleibt davon komplett unberührt.
export const BUZZ_PORT = Number(process.env.BUZZ_TEST_PORT ?? '3001')
export const BUZZ_WS = `ws://localhost:${BUZZ_PORT}`
export const BUZZ_URL = `${BUZZ_WS}/`

// Wegwerf-Testschlüssel des buzz-test-Seeds (siehe tests/e2e/support/buzz-compose/test-keys.env).
// Kein Bezug zu echten Vereinsschlüsseln oder zum zooid-NOSTR_TEST_NSEC.
export const BUZZ_USER_NSEC = 'nsec1txknjn6f6q88c27dpjc8xl6esyjdlu3m824emkez77yyw80ucezsd2tqys'
export const BUZZ_OWNER_SEC_HEX = 'a9f241be4d7001054bf7d825135b95d13b287cb0f4d2865a103073ee38f7cfb8'

// UUIDv5 der beiden Seed-Räume (uuid5(d3a2a246-e0b6-45be-a1c4-367c2bd857ad, "meetup:<slug>"),
// siehe buzz-testserver.sh) — fest, weil deterministisch aus dem Slug abgeleitet.
export const BUZZ_ROOM_WELCOME = 'a956ca5e-f2f7-5bed-bfe9-3313a8ee8718'
export const BUZZ_ROOM_GENERAL = '99cf94aa-b89d-5545-8905-495ea28a288e'

/**
 * Zeigt welshman im Test auf den lokalen buzz-test-Stack statt auf öffentliche Relays
 * — via `window.__nostrRelays`/`window.__nostrSpace`, die core.ts/groups.ts VOR dem
 * Init lesen (siehe useZooid in zooid.ts, identisches Prinzip, anderer Relay).
 */
export async function useBuzz(page: Page): Promise<void> {
    await page.addInitScript((url) => {
        ;(window as unknown as { __nostrRelays: unknown }).__nostrRelays = {
            indexer: [url],
            default: [url],
            signer: [url],
        }
        ;(window as unknown as { __nostrSpace: string }).__nostrSpace = url
    }, BUZZ_URL)
}
