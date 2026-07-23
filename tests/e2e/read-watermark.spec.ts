import { test, expect, type Page } from './support/fixtures'
import { execFileSync } from 'node:child_process'
import { useZooid, ZOOID_WS, ZOOID_URL } from './support/zooid'
import { loginNsec } from './support/login'

const NSEC = process.env.NOSTR_TEST_NSEC as string
const NAK = '/home/user/go/bin/nak'
const ADMIN = 'b2ee09a54bedf17ee1db562bdddd75c48661d981eb52c49dc206c55ba8439414'

/**
 * Regressionsanker für den `atBottom`-Gate in `RoomChat.destroy()` (`js/bridge.ts`):
 * `markRead()` schreibt das Lese-Wasserzeichen und darf beim Verlassen des Raums NUR
 * quittieren, wenn der Nutzer am Boden stand. Vorher war `destroy()` der einzige
 * UNBEDINGTE Aufrufer von `markRead()`
 * (`onScroll`/`scrollToBottom` waren schon geguardet) — wer im Verlauf hochgescrollt liest,
 * während neue Nachrichten einlaufen, und dann wegnavigiert, hätte sie stillschweigend als
 * gelesen markiert. Das Wasserzeichen ist der einzige Zustand, der die Navigation überlebt
 * — falsch gesetzt ist es nicht reparierbar.
 *
 * Eigene Datei statt Ergänzung in room.spec.ts (135K, siehe back-navigation.spec.ts als
 * Präzedenzfall für dieselbe Begründung): das Verhalten ist in sich geschlossen und
 * schneidet Chat-Scroll + SPA-Navigation quer.
 *
 * Beide Fälle nutzen den bestehenden „scroll"-Testraum (60 vorgeseedete Nachrichten,
 * siehe `support/zooid-testserver.sh` + `room.spec.ts` D1-Tests) — der einzige Raum, der
 * garantiert überläuft, statt neue Seed-Infrastruktur einzuführen.
 */

type RelayEvent = { id: string; pubkey: string; kind: number; content: string; tags: string[][]; created_at: number }

/** Loggt via nsec ein und öffnet den Chat des „scroll"-Testraums. */
async function openScrollRoom(page: Page): Promise<void> {
    await useZooid(page)
    await loginNsec(page, NSEC)
    await page.goto('/rooms/scroll')
}

/** Publiziert eine kind-9-Nachricht als ADMIN (fremder Autor) in den „scroll"-Raum. */
function publishToScroll(content: string): void {
    execFileSync(NAK, ['event', '--auth', '--sec', ADMIN, '-k', '9', '-t', 'h=scroll', '-c', content, ZOOID_WS])
}

/**
 * P3 hat den Speicher UND die Bedeutung des Wasserzeichens gewechselt — dieser Anker
 * musste mitwandern, das geprüfte Verhalten ist unverändert:
 *
 *   vorher: `room:lastread:<url>:<h>` in localStorage, Wert = `created_at` der jüngsten
 *           gelesenen Nachricht (AUTORGESETZT, NIP-01 → manipulierbar);
 *   jetzt:  Zeile `r:<url>|<h>` im Objectstore `readstate` der IndexedDB
 *           `einundzwanzig-readstate-<pubkey>`, Wert = WALL-CLOCK dieses Geräts
 *           (`js/readState.ts`).
 *
 * Deshalb prüft der Kontrollfall unten nicht mehr auf Gleichheit mit `created_at`,
 * sondern auf „nicht älter als die Nachricht, die gerade gelesen wurde".
 */
const FLUSH_DELAY_MS = 2000 // readState.ts schreibt gebündelt, höchstens alle 2 s

/** Liest `created_at` einer per Content-Marker eindeutigen Nachricht direkt vom Relay. */
function findCreatedAt(marker: string): number {
    const out = execFileSync(NAK, ['req', '-k', '9', '-t', 'h=scroll', '--auth', '--sec', ADMIN, ZOOID_WS]).toString().trim()
    const events = out
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as RelayEvent)
    const found = events.find((e) => e.content === marker)
    if (!found) {
        throw new Error(`Marker "${marker}" nicht im "scroll"-Raum gefunden`)
    }
    return found.created_at
}

/**
 * Liest das EFFEKTIVE Wasserzeichen des „scroll"-Raums direkt aus der Lesestand-DB
 * (kein Alpine-Zugriff, kein App-Code). Effektiv heißt `max(all, r:<url>|scroll)` — wie
 * `roomWatermark()`: ein globales „alles gelesen" dominiert den Einzelraum.
 *
 * Fehlt DB oder Objectstore (Gast, noch nichts geschrieben), ist die Antwort 0 statt
 * eines Fehlers — `indexedDB.open` ohne Version LEGT eine leere DB an, wenn keine da
 * ist, und deren fehlender Store würde die Transaktion sonst werfen.
 */
async function readWatermark(page: Page): Promise<number> {
    return page.evaluate(async (url) => {
        const raw = localStorage.getItem('pubkey')
        if (!raw || raw === 'undefined' || raw === 'null') {
            return 0
        }
        const pk = JSON.parse(raw) as string
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
            const req = indexedDB.open('einundzwanzig-readstate-' + pk)
            req.onsuccess = () => resolve(req.result)
            req.onerror = () => reject(req.error)
        })
        if (!db.objectStoreNames.contains('readstate')) {
            db.close()
            return 0
        }
        const rows = await new Promise<{ key: string; ts: number }[]>((resolve, reject) => {
            const req = db.transaction('readstate', 'readonly').objectStore('readstate').getAll()
            req.onsuccess = () => resolve(req.result as { key: string; ts: number }[])
            req.onerror = () => reject(req.error)
        })
        db.close()
        const byKey = new Map(rows.map((row) => [row.key, row.ts]))
        return Math.max(byKey.get('all') ?? 0, byKey.get(`r:${url}|scroll`) ?? 0)
    }, ZOOID_URL)
}

/**
 * Kontrollfall — steht der Nutzer am Boden (Default, kein Scroll) und navigiert weg,
 * MUSS das Wasserzeichen quittieren und auf die jüngste Nachricht vorrücken. Ohne diesen
 * Fall wäre Fall 2 („bleibt unverändert") wertlos: er bestünde auch, wenn Schreiben
 * generell kaputt wäre.
 */
test('Wasserzeichen: am Boden bleiben + wegnavigieren quittiert bis zur jüngsten Nachricht', async ({ page }) => {
    await openScrollRoom(page)
    await expect(page.getByText('Zeile 60', { exact: true })).toBeVisible({ timeout: 15_000 })

    const before = await readWatermark(page)

    // Frische Nachricht, während der Nutzer am Boden steht (atBottom=true per Default,
    // kein Scroll bisher) — column-reverse pinnt sie automatisch ins Bild.
    const marker = `WM-Control-${Math.floor(Math.random() * 1e9)}`
    publishToScroll(marker)
    await expect(page.getByText(marker, { exact: true })).toBeVisible({ timeout: 15_000 })
    const createdAt = findCreatedAt(marker)

    await page.getByRole('button', { name: 'Zurück' }).click()
    await expect(page).toHaveURL(/\/spaces$/, { timeout: 15_000 })

    // Der Schreibpfad bündelt (höchstens ein IDB-Write alle 2 s) → pollen statt raten.
    await expect
        .poll(() => readWatermark(page), { timeout: 15_000 })
        .toBeGreaterThan(before)

    const after = await readWatermark(page)
    console.log(`[read-watermark/Kontrollfall] before=${before} after=${after} createdAt(${marker})=${createdAt}`)
    // Wall-Clock, nicht `created_at`: das Quittieren liegt zeitlich NACH der Nachricht,
    // die dabei gelesen wurde — gleich sein können die beiden nur zufällig.
    expect(after).toBeGreaterThanOrEqual(createdAt)
})

/**
 * Der eigentliche Fall — hochgescrollt (`atBottom=false`), eine neue Fremd-Nachricht läuft
 * ein, dann wegnavigiert: das Wasserzeichen darf sich NICHT bewegen. Vor dem Fix hätte
 * `destroy()` es unbedingt auf die (dem Nutzer nie gezeigte) jüngste Nachricht vorgerückt.
 */
test('Wasserzeichen: hochgescrollt + wegnavigieren lässt es unverändert', async ({ page }) => {
    await openScrollRoom(page)
    await expect(page.getByText('Zeile 60', { exact: true })).toBeVisible({ timeout: 15_000 })

    const before = await readWatermark(page)

    // Robust hochscrollen, bis der Container nachweislich überläuft (gleiche Technik wie
    // die D1-Auto-Load-Tests in room.spec.ts). Schwelle spiegelt onScroll() in bridge.ts:
    // `atBottom = Math.abs(scrollTop) < 60`.
    const log = page.locator('[role=log]')
    let metrics = { scrollTop: 0, scrollHeight: 0, clientHeight: 0 }
    await expect(async () => {
        await log.hover()
        await page.mouse.wheel(0, -6000)
        metrics = await log.evaluate((el) => ({ scrollTop: el.scrollTop, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }))
        expect(Math.abs(metrics.scrollTop)).toBeGreaterThan(60)
    }).toPass({ timeout: 25_000 })
    console.log(
        `[read-watermark/Fall2] nach Hochscrollen: scrollTop=${metrics.scrollTop} scrollHeight=${metrics.scrollHeight} ` +
            `clientHeight=${metrics.clientHeight} overflow=${metrics.scrollHeight - metrics.clientHeight}`,
    )
    expect(metrics.scrollHeight - metrics.clientHeight).toBeGreaterThan(0)

    // Neue Fremd-Nachricht läuft ein, während der Nutzer oben im Verlauf liest — genau das
    // Schadensszenario. Sie landet im Full-DOM (kein Virtualizer), auch außerhalb des
    // sichtbaren Ausschnitts — `toBeVisible()` prüft CSS-Sichtbarkeit, nicht Scroll-Position.
    const marker = `WM-Real-${Math.floor(Math.random() * 1e9)}`
    publishToScroll(marker)
    await expect(page.getByText(marker, { exact: true })).toBeVisible({ timeout: 15_000 })

    // Direkt vor dem Wegnavigieren erneut belegen: wir stehen WIRKLICH noch nicht am Boden.
    const beforeNav = await log.evaluate((el) => Math.abs(el.scrollTop))
    console.log(`[read-watermark/Fall2] unmittelbar vor "Zurück": |scrollTop|=${beforeNav}`)
    expect(beforeNav).toBeGreaterThan(60)

    await page.getByRole('button', { name: 'Zurück' }).click()
    await expect(page).toHaveURL(/\/spaces$/, { timeout: 15_000 })

    // „Es passiert nichts" lässt sich nicht erpollen — hier muss gewartet werden, und
    // zwar länger als das Schreib-Fenster des Lesestands. Sonst prüfte der Test bloß,
    // dass der Write noch nicht durch ist, und wäre auch bei kaputtem Gate grün.
    await page.waitForTimeout(FLUSH_DELAY_MS * 2)

    const after = await readWatermark(page)
    console.log(`[read-watermark/Fall2] before=${before} after=${after} (muss gleich sein)`)
    expect(after).toBe(before)
})
