import { test, expect, type Page } from './support/fixtures'
import { useZooid, ZOOID_PORT } from './support/zooid'
import { loginNsec } from './support/login'

const NSEC = process.env.NOSTR_TEST_NSEC as string
const WELCOME = 'Willkommen im Space! 👋'

/**
 * Kleinster gefüllter Stand des Caches: gecachte kind-9 UND Tracker-Einträge. Der
 * Tracker (id→relays) batcht separat, ist aber für den url-gescopten Raum-Feed
 * lasttragend (deriveRoomMessages gated auf tracker.hasRelay) → beide müssen vor
 * dem Reload liegen, sonst hydriert der Feed leer. Poll auf das Minimum.
 */
function cacheReadiness(page: Page): Promise<number> {
    return page.evaluate(async () => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
            const req = indexedDB.open('einundzwanzig-cache')
            req.onsuccess = () => resolve(req.result)
            req.onerror = () => reject(req.error)
        })
        try {
            const events = await new Promise<number>((resolve, reject) => {
                const req = db.transaction('events', 'readonly').objectStore('events').getAll()
                req.onsuccess = () => resolve((req.result as { kind: number }[]).filter((e) => e.kind === 9).length)
                req.onerror = () => reject(req.error)
            })
            const tracker = await new Promise<number>((resolve, reject) => {
                const req = db.transaction('tracker', 'readonly').objectStore('tracker').count()
                req.onsuccess = () => resolve(req.result)
                req.onerror = () => reject(req.error)
            })
            return Math.min(events, tracker)
        } finally {
            db.close()
        }
    })
}

/**
 * M3 P1 — der Kaltstart-Cache. Zwei Beweise auf EINEM Pfad:
 *  1. Nach dem ersten Öffnen liegen die kind-9 im IndexedDB (syncEvents persistiert —
 *     das ist der in P0 bewusst verschobene IDB-Round-Trip, jetzt im echten Browser).
 *  2. Nach Reload MIT GEBLOCKTEM Relay ist der Verlauf trotzdem da → er kann NUR aus
 *     dem Cache stammen (repository.load-Hydration + Warm-Peek → Instant-Paint).
 * Bewusst kein flakiges „kein-Skeleton"-Timing (s. Memory zur gelöschten White-Box-Probe).
 */
test('P1: Chat persistiert in IndexedDB und hydriert nach Reload aus dem Cache', async ({ page }) => {
    await useZooid(page)
    await loginNsec(page, NSEC)
    await page.goto('/rooms/welcome')

    await expect(page.getByText(WELCOME)).toBeVisible({ timeout: 15_000 })

    // syncEvents/syncTracker batchen 3 s → poll, bis BEIDE Stores gefüllt sind.
    await expect.poll(() => cacheReadiness(page), { timeout: 15_000 }).toBeGreaterThan(0)

    // Relay ab jetzt schwarzes Loch (kein connectToServer → keine Relay-Daten mehr).
    // Was nach dem Reload rendert, kommt zwingend aus IndexedDB.
    await page.routeWebSocket(new RegExp(`localhost:${ZOOID_PORT}`), () => {})

    await page.reload()

    await expect(page.getByText(WELCOME)).toBeVisible({ timeout: 15_000 })
})
