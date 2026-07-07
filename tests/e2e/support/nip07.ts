import { type Page } from '@playwright/test'
import { finalizeEvent } from 'nostr-tools/pure'

type EventTemplate = {
    kind: number
    created_at: number
    tags: string[][]
    content: string
}

/**
 * Injiziert ein NIP-07-`window.nostr` in die Seite. Die Krypto bleibt in Node
 * (via `exposeFunction`), weil der Wegwerf-Key dort liegt — der Browser ruft nur
 * `getPublicKey`/`signEvent` wie bei einer echten Extension.
 */
export async function installNip07(page: Page, sk: Uint8Array, pk: string): Promise<void> {
    await page.exposeFunction('__nip07_getPublicKey', () => pk)
    await page.exposeFunction('__nip07_signEvent', (event: EventTemplate) => finalizeEvent(event, sk))

    await page.addInitScript(() => {
        // @ts-expect-error — window.nostr ist die NIP-07-Schnittstelle.
        window.nostr = {
            // @ts-expect-error — von exposeFunction bereitgestellt.
            getPublicKey: () => window.__nip07_getPublicKey(),
            // @ts-expect-error — von exposeFunction bereitgestellt.
            signEvent: (event: EventTemplate) => window.__nip07_signEvent(event),
        }
    })
}
