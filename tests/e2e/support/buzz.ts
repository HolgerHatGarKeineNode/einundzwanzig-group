import { type Page } from '@playwright/test'

// Isolierter Buzz-TEST-Stack — **ein eigener Stack je Worker**, wie es zooid längst hält.
//
// Hier stand vorher ein fester Port mit der Begründung, ein Docker-Stack sei zu schwer,
// um ihn zu vervielfachen. Das hat die Buzz-Suite auf `workers: 1` festgenagelt und war
// der einzige Grund, warum sie 13–15 min brauchte statt 2 — GEMESSEN: 753 s Testzeit im
// Buzz-Modus gegen 633 s im zooid-Modus, also praktisch dieselbe Arbeit, nur einmal
// serialisiert und einmal auf sechs Worker verteilt.
//
// Was die alte Begründung übersah: von den vier Containern veröffentlicht nur der Relay
// einen Host-Port (`compose.yml:22`, `${BUZZ_HTTP_PORT:-3000}:3000`) — Postgres, Redis
// und MinIO bleiben im Compose-Netz. Verschiedene Projektnamen kollidieren also nicht,
// und Volumes/Netzwerke trennt Compose ohnehin je Projekt.
//
// `BUZZ_TEST_PORT` überschreibt den Versatz (Einzelaufruf des Skripts von Hand).
// Der Mitschau-Stack `buzz-prod` auf :3000 bleibt unberührt.
const SLOT = Number(process.env.TEST_PARALLEL_INDEX ?? '0') + Number(process.env.E2E_SLOT_OFFSET ?? '0')
export const BUZZ_PORT = Number(process.env.BUZZ_TEST_PORT ?? String(3001 + SLOT))
export const BUZZ_WS = `ws://localhost:${BUZZ_PORT}`
export const BUZZ_URL = `${BUZZ_WS}/`

// Wegwerf-Testschlüssel des buzz-test-Seeds (siehe tests/e2e/support/buzz-compose/test-keys.env).
// Kein Bezug zu echten Vereinsschlüsseln oder zum zooid-NOSTR_TEST_NSEC.
export const BUZZ_USER_NSEC = 'nsec1txknjn6f6q88c27dpjc8xl6esyjdlu3m824emkez77yyw80ucezsd2tqys'
export const BUZZ_OWNER_SEC_HEX = 'a9f241be4d7001054bf7d825135b95d13b287cb0f4d2865a103073ee38f7cfb8'
// Derselbe Owner-Key als nsec (fuer den nsec-Login im Browser). Er ist der
// RELAY_OWNER_PUBKEY des buzz-test-Stacks und traegt damit in der 13534 die Rolle
// `owner` — die Grundlage der Admin-Erkennung nach P3.
export const BUZZ_OWNER_NSEC = 'nsec148eyr0jdwqqs2jlhmqj3xku46yajsl9s7nfgvkssxpe7uw8he7uq69wldr'
/** Pubkey des geseedeten Nicht-Admin-Mitglieds (test-keys.env, USER_PUB). */
export const BUZZ_USER_PUB = '9db3b9da10ee79e56871f101051d2df7693b07927733dd12d0f73ee72e707192'

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
        // Zweiten Space abschalten — dieselbe Falle wie in `useZooid`, hier bis 2026-07-31
        // unbemerkt: `partials/head.blade.php` injiziert `config('group.workspace_url')`,
        // und die lokale `.env` trägt dort das **Produktions**-Buzz. Im Frame-Mitschnitt
        // eines Buzz-Modus-Laufs stand deshalb eine zweite Verbindung nach
        // `wss://buzz.einundzwanzig.space/`, die der Prod-Relay mit
        // `restricted: not a relay member` beantwortete. Ein Testlauf, der nebenbei einen
        // Produktions-Relay anspricht, ist nicht nur langsam — er misst auch etwas, das mit
        // dem Test nichts zu tun hat.
        ;(window as unknown as { __nostrWorkspace: string }).__nostrWorkspace = ''
    }, BUZZ_URL)
}
