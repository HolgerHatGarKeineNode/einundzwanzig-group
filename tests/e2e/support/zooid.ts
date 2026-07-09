import { type Page } from '@playwright/test'

// ISOLIERTER Test-Relay auf :3335 (nicht der Standard-:3334). So bleibt ein lokal
// laufender Mitschau-zooid auf :3334 komplett unberührt — die Tests fassen ihn nie
// an. Der Testserver startet die :3335-Instanz mit eigenem data-/config-Verzeichnis
// (siehe zooid-testserver.sh). `ZOOID_WS` (ohne Slash) ist die nak-CLI-Ziel-URL.
export const ZOOID_WS = 'ws://localhost:3335'
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
