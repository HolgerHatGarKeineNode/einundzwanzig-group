import { type Page } from '@playwright/test'

/** Lokaler zooid-Relay (aus /home/user/Code/zooid, config/test.toml). */
export const ZOOID_URL = 'ws://localhost:3334/'

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
    }, ZOOID_URL)
}
