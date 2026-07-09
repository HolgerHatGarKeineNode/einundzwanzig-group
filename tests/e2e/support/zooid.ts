import { type Page } from '@playwright/test'

// ISOLIERTER Test-Relay auf :3335 (nicht der Standard-:3334). So bleibt ein lokal
// laufender Mitschau-zooid auf :3334 komplett unberührt — die Tests fassen ihn nie
// an. Der Testserver startet die :3335-Instanz mit eigenem data-/config-Verzeichnis
// (siehe zooid-testserver.sh). `ZOOID_WS` (ohne Slash) ist die nak-CLI-Ziel-URL.
export const ZOOID_WS = 'ws://localhost:3335'
export const ZOOID_URL = `${ZOOID_WS}/`

/**
 * Zeigt welshman im Test auf den lokalen zooid statt auf öffentliche Relays —
 * via `window.__nostrRelays`, das core.ts VOR dem Init liest. Hermetisch.
 */
export async function useZooid(page: Page): Promise<void> {
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
