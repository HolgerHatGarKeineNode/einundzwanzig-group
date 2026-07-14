import { test, expect, type Page } from './support/fixtures'
import { execFileSync } from 'node:child_process'
import { useZooid, ZOOID_PORT, ZOOID_WS } from './support/zooid'
import { loginNsec } from './support/login'

const NSEC = process.env.NOSTR_TEST_NSEC as string
const NAK = '/home/user/go/bin/nak'
const ADMIN = 'b2ee09a54bedf17ee1db562bdddd75c48661d981eb52c49dc206c55ba8439414'
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

/** Ist der Cache leer (keine kind-9, kein owner-Meta)? Für den Logout-Beweis. */
function cacheIsEmpty(page: Page): Promise<boolean> {
    return page.evaluate(async () => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
            const req = indexedDB.open('einundzwanzig-cache')
            req.onsuccess = () => resolve(req.result)
            req.onerror = () => reject(req.error)
        })
        try {
            const count = (store: string) =>
                new Promise<number>((resolve, reject) => {
                    const req = db.transaction(store, 'readonly').objectStore(store).count()
                    req.onsuccess = () => resolve(req.result)
                    req.onerror = () => reject(req.error)
                })
            return (await count('events')) === 0 && (await count('tracker')) === 0 && (await count('meta')) === 0
        } finally {
            db.close()
        }
    })
}

/**
 * M3 P3 — Logout leert den Cache (Multi-Account-Isolation). Nach dem Abmelden dürfen
 * KEINE gecachten Räume + kein owner-Meta zurückbleiben → der nächste Boot (Gast oder
 * fremder Account) re-hydratisiert nichts Fremdes. (Der owner-Gate in initStorage ist
 * der Backstop; hier wird der aktive Clear-Pfad bewiesen.)
 */
test('P3: Logout leert den Event-Cache vollständig', async ({ page }) => {
    await useZooid(page)
    await loginNsec(page, NSEC)
    await page.goto('/rooms/welcome')

    await expect(page.getByText(WELCOME)).toBeVisible({ timeout: 15_000 })
    await expect.poll(() => cacheReadiness(page), { timeout: 15_000 }).toBeGreaterThan(0)

    // Abmelden über die Startseite (nostrAuth.doLogout → logout() → clearCache()).
    await page.goto('/')
    await page.getByRole('button', { name: 'Abmelden' }).click()
    await page.waitForURL('**/nostr-login')

    await expect.poll(() => cacheIsEmpty(page), { timeout: 15_000 }).toBe(true)
})

/**
 * M3 P4 — Robustheit: ein IDB-Write-Fehler (Quota/Eviction) darf den Chat NIE brechen.
 * Der eigentliche fail-soft-Zweck ist der LIVE-SYNC-Pfad: syncEvents/syncTracker feuern
 * ihre Writes fire-and-forget (3s-Batch, kein Aufrufer-await) → ohne try/catch gäbe eine
 * fehlschlagende Transaktion eine unhandled rejection. Deshalb: Boot GELINGT (Reads +
 * meta-Writes klappen → startSync registriert), aber events/tracker-WRITES werfen. Eine
 * Live-Nachricht treibt den Sync gegen den kaputten Store; ein unhandledrejection/
 * pageerror-Listener macht das Delta sichtbar (dieser Test wird ROT, wenn man das fail-
 * soft-try/catch entfernt — anders als eine reine „WELCOME sichtbar"-Prüfung).
 */
test('P4: IDB-Write-Fehler bricht Live-Sync/Chat nicht (fail-soft, keine unhandled rejection)', async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', (e) => pageErrors.push(e.message))

    await page.addInitScript(() => {
        ;(window as unknown as { __rejections: string[] }).__rejections = []
        window.addEventListener('unhandledrejection', (e) =>
            (window as unknown as { __rejections: string[] }).__rejections.push(String(e.reason)),
        )
        const realOpen = indexedDB.open.bind(indexedDB)
        indexedDB.open = ((name: string, ...rest: unknown[]) => {
            const req = realOpen(name, ...(rest as [number?]))
            if (name === 'einundzwanzig-cache') {
                req.addEventListener('success', () => {
                    const db = req.result
                    const realTx = db.transaction.bind(db)
                    // Boot-Reads (readonly) + meta-Writes bleiben heil → Boot kommt bis startSync;
                    // NUR events/tracker-Writes werfen → der Live-Sync-Pfad läuft ins Leere.
                    ;(db as unknown as { transaction: unknown }).transaction = (
                        store: string,
                        mode?: IDBTransactionMode,
                        ...r: unknown[]
                    ) => {
                        if (mode === 'readwrite' && (store === 'events' || store === 'tracker')) {
                            throw new DOMException('simulierter Write-Fehler', 'InvalidStateError')
                        }
                        return (realTx as (...a: unknown[]) => IDBTransaction)(store, mode, ...r)
                    }
                })
            }
            return req
        }) as typeof indexedDB.open
    })

    await useZooid(page)
    await loginNsec(page, NSEC)
    await page.goto('/rooms/welcome')
    await expect(page.getByText(WELCOME)).toBeVisible({ timeout: 15_000 })

    // Live-Nachricht → repository 'update' → syncEvents.bulkPut('events','readwrite') wirft
    // (3s-Batch, fire-and-forget). Fail-soft schluckt es; ohne fail-soft → unhandled rejection.
    const marker = `P4-${Math.floor(Math.random() * 1e9)}`
    execFileSync(NAK, ['event', '--auth', '--sec', ADMIN, '-k', '9', '-t', 'h=welcome', '-c', `E2E ${marker}`, ZOOID_WS])
    await expect(page.getByText(`E2E ${marker}`)).toBeVisible({ timeout: 15_000 })

    // Aufs 3s-Batch-Flush (+ Prune-Write) warten, dann: KEIN Fehler durchgesickert.
    await page.waitForTimeout(4000)
    const rejections = await page.evaluate(() => (window as unknown as { __rejections: string[] }).__rejections)
    expect(rejections, `unhandled rejections: ${rejections.join(' | ')}`).toEqual([])
    expect(pageErrors, `page errors: ${pageErrors.join(' | ')}`).toEqual([])
})
