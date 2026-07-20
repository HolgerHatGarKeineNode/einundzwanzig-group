import { type Page } from '@playwright/test'

// ISOLIERTER Test-Relay (nicht der Standard-:3334). So bleibt ein lokal laufender
// Mitschau-zooid auf :3334 komplett unberührt — die Tests fassen ihn nie an.
//
// PRO WORKER isoliert: `TEST_PARALLEL_INDEX` (0-basierter Worker-Slot, von Playwright je
// Worker-PROZESS gesetzt) verschiebt Relay- UND App-Port. Dieses Modul wird pro Worker-
// Prozess einmal ausgewertet ⇒ jeder Worker bekommt automatisch seine eigenen Ports und
// spricht seine eigene zooid-Instanz + seinen eigenen `php artisan serve` an (siehe
// fixtures.ts + zooid-testserver.sh). `ZOOID_WS` (ohne Slash) ist die nak-CLI-Ziel-URL.
//
// `E2E_SLOT_OFFSET` verschiebt BEIDE Port-Reihen um einen festen Betrag (Default 0 →
// Verhalten unverändert). Nötig, wenn ein fremder Prozess einen der Slot-Ports belegt
// (z.B. ein `php artisan serve` eines Nachbar-Repos auf 8137): dann bindet der eigene
// serve nicht, und der Test spricht unbemerkt die FREMDE App an (404 statt Login).
const SLOT = Number(process.env.TEST_PARALLEL_INDEX ?? '0') + Number(process.env.E2E_SLOT_OFFSET ?? '0')
export const ZOOID_PORT = 3335 + SLOT
export const SERVE_PORT = 8137 + SLOT
export const ZOOID_WS = `ws://localhost:${ZOOID_PORT}`
export const ZOOID_URL = `${ZOOID_WS}/`

// Winziges 1×1-PNG (deterministische Bild-Antwort für alle proxifizierten/externen
// Bilder). So trifft KEIN Test je eine echte Remote-URL → keine Rate-Limits, kein
// Flake durch langsame Fremd-Hosts (robohash & Co.), kein Server-seitiger Proxy-Fetch.
const PNG_1X1 = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
)

/**
 * Fängt alle Bildanfragen im Browser ab und beantwortet sie mit einem lokalen 1×1-PNG:
 * den Bild-Proxy (`/img/{preset}?src=…`) UND direkte externe Bildhosts. Damit lädt der
 * Emoji-Picker (zeigt Custom-Emoji erst nach dem `load`-Event) deterministisch, und
 * keine echte Remote-URL wird je getroffen (nie wieder Rate-Limits). Der Marken-SVG
 * (`/img/…​.svg`, ohne `?src=`) bleibt unangetastet.
 */
async function stubImages(page: Page): Promise<void> {
    await page.route(/(\/img\/[a-z]+\?src=)|robohash\.org|gravatar\.com|imgproxy/i, (route) =>
        route.fulfill({ status: 200, contentType: 'image/png', body: PNG_1X1 }),
    )
}

/**
 * Zeigt welshman im Test auf den lokalen zooid statt auf öffentliche Relays —
 * via `window.__nostrRelays`, das core.ts VOR dem Init liest. Hermetisch. Stubbt
 * zugleich alle Bilder lokal (keine echten Remote-Fetches).
 */
export async function useZooid(page: Page): Promise<void> {
    await stubImages(page)
    await page.addInitScript((url) => {
        ;(window as unknown as { __nostrRelays: unknown }).__nostrRelays = {
            indexer: [url],
            default: [url],
            signer: [url],
        }
        // Space-URL explizit auf den Test-Relay legen. OHNE das fällt sie auf den
        // hardcodierten Default (ws://localhost:3334/) zurück → die Room-Subs gingen
        // an :3334 statt an den isolierten Test-zooid auf :3335 (Chat lud nicht).
        ;(window as unknown as { __nostrSpace: string }).__nostrSpace = url
    }, ZOOID_URL)
}
