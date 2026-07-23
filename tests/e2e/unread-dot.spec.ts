import { test, expect, type Page } from './support/fixtures'
import { execFileSync } from 'node:child_process'
import { useZooid, ZOOID_PORT, ZOOID_URL, ZOOID_WS } from './support/zooid'
import { loginNsec } from './support/login'

/**
 * P3 — der Ungelesen-MARKER im echten Browser (seit P6 in der Raum-Zeile eine
 * Zähler-Pille, in der Bottom-Nav weiterhin ein Punkt — siehe {@link roomDot}).
 *
 * Abgegrenzt gegen die beiden Nachbarn, damit hier nichts doppelt geprüft wird:
 *   - `js/readState.test.ts` / `js/unread.test.ts` (node) decken Merge, Prune,
 *     Migration und die reine Ableitung `computeUnread` ab — REINE LOGIK.
 *   - `read-watermark.spec.ts` deckt das `atBottom`-Gate auf der Ebene des
 *     WASSERZEICHENS ab (schreibt/schreibt nicht in die Lesestand-DB).
 *   - Diese Datei prüft ausschließlich, was der NUTZER sieht: erscheint und
 *     verschwindet der Punkt, und zwar dann, wenn er soll. Vier Anker:
 *       1. Kaltstart aus dem Cache, Relay blockiert → Punkt ist trotzdem da.
 *       2. Lesen löscht ihn — hochgescrolltes Verlassen NICHT (Wirkung des
 *          `atBottom`-Gates auf den Punkt, nicht auf das Wasserzeichen).
 *       3. Zweiter Tab folgt ohne Reload (BroadcastChannel pro pubkey).
 *       4. Fehlender `unread`-Store rendert nichts und wirft nichts.
 *
 * Eigener Seed-Raum `punkt` („Punktprobe", 60 alte Fremd-Nachrichten): die Tests
 * publizieren, dürfen also weder `welcome` (Seed-Guard) noch `scroll`
 * (read-watermark) aufblähen. Die 60 Seed-Nachrichten liegen bewusst in der
 * VERGANGENHEIT — `initReadState()` setzt für einen frischen Account
 * `all = jetzt`, sie gelten damit als gelesen. Jeder Punkt in dieser Datei
 * entsteht ausschließlich durch eine NACH dem Login publizierte Nachricht.
 */

const NSEC = process.env.NOSTR_TEST_NSEC as string
const NAK = '/home/user/go/bin/nak'
const ADMIN = 'b2ee09a54bedf17ee1db562bdddd75c48661d981eb52c49dc206c55ba8439414'
const VIEWER = '2dbaf5f4f86a1eed0948852ad48fa40aae2e48d5e347a77fac2ac936d6c94e7b' // pub von NOSTR_TEST_NSEC
const CACHE_DB = `einundzwanzig-cache-${VIEWER}`
const READSTATE_DB = `einundzwanzig-readstate-${VIEWER}`
const ROOM_H = 'punkt'
const ROOM_NAME = 'Punktprobe'

/** Publiziert eine kind-9-Nachricht als ADMIN (FREMDER Autor — eigene zählen nie). */
function publish(content: string): void {
    execFileSync(NAK, ['event', '--auth', '--sec', ADMIN, '-k', '9', '-t', `h=${ROOM_H}`, '-c', content, ZOOID_WS])
}

const marker = (prefix: string): string => `${prefix}-${Math.floor(Math.random() * 1e9)}`

/**
 * Wartet, bis die Wanduhr eine ganze Sekunde weitergerückt ist.
 *
 * KEIN „warte mal kurz". Alles hier rechnet in Unix-SEKUNDEN: das Wasserzeichen
 * (`setRead` → `Math.floor(Date.now()/1000)`) und das `created_at` der Nachricht. Die
 * Ungelesen-Regel ist bewusst `created_at > watermark` und nicht `>=` — NIP-01-`since`
 * ist inklusiv, sonst wäre das gerade Quittierte sofort wieder ungelesen
 * (`unread.ts`, Regel 3). Quittieren und Publizieren in DERSELBEN Sekunde ergibt also
 * völlig korrekt „gelesen".
 *
 * Genau daran ist die Gegenprobe unter voller Parallellast einmal gescheitert
 * (gemessen: `createdAt=1784800753` gegen `watermark=1784800752` — eine Sekunde
 * Abstand, und in einem Lauf eben null). Der Test wartet deshalb auf eine
 * NACHPRÜFBARE Bedingung (die Sekunde ist umgesprungen), statt auf eine geratene
 * Dauer — und die App bleibt unangetastet.
 */
async function awaitNextSecond(page: Page): Promise<void> {
    const start = Math.floor(Date.now() / 1000)
    while (Math.floor(Date.now() / 1000) <= start) {
        await page.waitForTimeout(100)
    }
}

/** `created_at` einer per Content-Marker eindeutigen Nachricht, direkt vom Relay. */
function createdAt(content: string): number {
    const out = execFileSync(NAK, ['req', '-k', '9', '-t', `h=${ROOM_H}`, '--auth', '--sec', ADMIN, ZOOID_WS]).toString()
    const found = out
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as { content: string; created_at: number })
        .find((e) => e.content === content)
    return found?.created_at ?? -1
}

/**
 * Der Ungelesen-Marker in der Raum-Zeile von „Punktprobe".
 *
 * **Seit P6 ist das eine ZÄHLER-PILLE, kein Punkt mehr** (§4.1 Nr. 1): die Raum-Zeile
 * trägt `x-group::unread-badge` (`bg-brand-500` + `text-zinc-950`), der Punkt lebt nur
 * noch dort weiter, wo eine Ziffer nicht lesbar wäre — an der Bottom-Nav (11-px-Ebene,
 * siehe {@link navDot}). Was die vier Anker prüfen, ändert sich dadurch NICHT: sie
 * fragen „erscheint und verschwindet der Marker, wenn er soll", und das ist unabhängig
 * von seiner Form. Nur der Selektor zieht mit.
 *
 * Adressiert über die gerenderte Form statt über einen Test-Haken: die Komponente
 * rendert per `x-if`, der Marker ist also entweder im DOM oder gar nicht —
 * `toHaveCount(0)` ist damit eine echte Abwesenheits-Aussage. Die beiden Klassen sind
 * theme-unabhängig (die Pille ist DECKEND, sie hat keine `dark:`-Variante) — anders als
 * beim Punkt, wo `dark:bg-brand-400` bewusst außen vor blieb.
 */
const roomDot = (page: Page) =>
    page.getByRole('button', { name: new RegExp(ROOM_NAME) }).locator('span.bg-brand-500.text-zinc-950')

/** Der Punkt an der Ecke des Chat-Icons der Bottom-Nav (speist sich aus `any`). */
const navDot = (page: Page) => page.getByRole('link', { name: /Chat/ }).locator('span.size-2.rounded-full')

/** Liegt GENAU diese kind-9 (+ ihr Tracker-Eintrag) im Kaltstart-Cache? */
function messageCached(page: Page, content: string): Promise<boolean> {
    return page.evaluate(
        async ({ dbName, needle }) => {
            const db = await new Promise<IDBDatabase>((resolve, reject) => {
                const req = indexedDB.open(dbName)
                req.onsuccess = () => resolve(req.result)
                req.onerror = () => reject(req.error)
            })
            try {
                if (!db.objectStoreNames.contains('events')) {
                    return false
                }
                const event = await new Promise<{ id: string } | undefined>((resolve, reject) => {
                    const req = db.transaction('events', 'readonly').objectStore('events').getAll()
                    req.onsuccess = () =>
                        resolve((req.result as { id: string; kind: number; content: string }[]).find((e) => e.kind === 9 && e.content === needle))
                    req.onerror = () => reject(req.error)
                })
                if (!event) {
                    return false
                }
                const trk = await new Promise<{ relays?: string[] } | undefined>((resolve, reject) => {
                    const req = db.transaction('tracker', 'readonly').objectStore('tracker').get(event.id)
                    req.onsuccess = () => resolve(req.result as { relays?: string[] } | undefined)
                    req.onerror = () => reject(req.error)
                })
                return Boolean(trk?.relays?.length)
            } finally {
                db.close()
            }
        },
        { dbName: CACHE_DB, needle: content },
    )
}

/**
 * Liegt die Mitgliedschaft (kind 39002) des Raums im Kaltstart-Cache — SAMT ihrem
 * Tracker-Eintrag?
 *
 * Ohne die 39002 wäre der Raum nach dem Reload nicht in `joined`; `computeUnread`
 * vergibt dann gar keinen Schlüssel, und ein fehlender Punkt hätte nichts mit dem
 * Lesestand zu tun. Der Tracker-Teil ist genauso lasttragend und war der Grund für
 * einen Fehlschlag unter voller Parallellast: die Raum-Mitgliedschaften laufen über
 * `deriveEventsByIdByUrl` (`groups.ts`), und diese Ableitung ist auf die
 * Relay-HERKUNFT gegated. Liegt das Event im Cache, seine Tracker-Zeile aber noch
 * nicht (events und tracker sind ZWEI getrennte 3-s-Batches in `storage.ts`), bleibt
 * `userRooms` nach dem Reload dauerhaft leer — und der Test wäre rot, ohne dass am
 * Ungelesen-Pfad irgendetwas falsch wäre.
 */
function membershipCached(page: Page): Promise<boolean> {
    return page.evaluate(async (dbName) => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
            const req = indexedDB.open(dbName)
            req.onsuccess = () => resolve(req.result)
            req.onerror = () => reject(req.error)
        })
        try {
            if (!db.objectStoreNames.contains('events')) {
                return false
            }
            const event = await new Promise<{ id: string } | undefined>((resolve, reject) => {
                const req = db.transaction('events', 'readonly').objectStore('events').getAll()
                req.onsuccess = () =>
                    resolve(
                        (req.result as { id: string; kind: number; tags: string[][] }[]).find(
                            (e) => e.kind === 39002 && e.tags.some((t) => t[0] === 'd' && t[1] === 'punkt'),
                        ),
                    )
                req.onerror = () => reject(req.error)
            })
            if (!event) {
                return false
            }
            const trk = await new Promise<{ relays?: string[] } | undefined>((resolve, reject) => {
                const req = db.transaction('tracker', 'readonly').objectStore('tracker').get(event.id)
                req.onsuccess = () => resolve(req.result as { relays?: string[] } | undefined)
                req.onerror = () => reject(req.error)
            })
            return Boolean(trk?.relays?.length)
        } finally {
            db.close()
        }
    }, CACHE_DB)
}

/** Der Alpine-Store, wie ihn die Blade-Ausdrücke sehen. Nur für Diagnose-Ausgaben. */
function unreadStore(page: Page): Promise<unknown> {
    return page.evaluate(() => {
        const alpine = (window as unknown as { Alpine?: { store: (n: string) => unknown } }).Alpine
        return alpine ? (alpine.store('unread') ?? null) : 'kein Alpine'
    })
}

/** Alle Zeilen der Lesestand-DB. Fehlt sie/der Store, ist die Antwort `{}` (kein Fehler). */
function readStateRows(page: Page): Promise<Record<string, number>> {
    return page.evaluate(async (dbName) => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
            const req = indexedDB.open(dbName)
            req.onsuccess = () => resolve(req.result)
            req.onerror = () => reject(req.error)
        })
        try {
            if (!db.objectStoreNames.contains('readstate')) {
                return {}
            }
            const rows = await new Promise<{ key: string; ts: number }[]>((resolve, reject) => {
                const req = db.transaction('readstate', 'readonly').objectStore('readstate').getAll()
                req.onsuccess = () => resolve(req.result as { key: string; ts: number }[])
                req.onerror = () => reject(req.error)
            })
            return Object.fromEntries(rows.map((r) => [r.key, r.ts]))
        } finally {
            db.close()
        }
    }, READSTATE_DB)
}

/** Login + Raumliste. Danach steht das Wasserzeichen `all` auf „jetzt". */
async function openSpaces(page: Page): Promise<void> {
    await useZooid(page)
    await loginNsec(page, NSEC)
    await expect(page.getByRole('button', { name: new RegExp(ROOM_NAME) })).toBeVisible({ timeout: 20_000 })
}

/**
 * ANKER 1 — Kaltstart aus dem Cache, ohne Netz.
 *
 * Der Punkt muss stehen, BEVOR (bzw. ohne dass) das Relay antwortet. Bewiesen wird das
 * adversarial: der WebSocket wird zum schwarzen Loch (`routeWebSocket` ohne
 * `connectToServer`), erst dann der Reload. Was danach leuchtet, kann nur aus der
 * IndexedDB stammen — kind 9 (Nachricht), kind 39002 (Mitgliedschaft) und die Zeile
 * `all` des Lesestands. Alle drei werden vor dem Reload einzeln erpollt, sonst prüfte
 * der Test bloß, ob die 3s-Batches schon durch sind.
 *
 * Nicht verhandelbar an der Reihenfolge: die Nachricht wird NACH dem Login publiziert.
 * Vorher läge sie unter `all = Login-Zeitpunkt` und gälte als gelesen.
 */
test('Anker 1: Punkt steht beim Kaltstart aus dem Cache — Relay blockiert', async ({ page }) => {
    test.setTimeout(120_000) // Reload + IDB-Boot: der ÄUSSERE Timeout deckelt alles

    await openSpaces(page)
    await expect(roomDot(page)).toHaveCount(0) // Ausgangslage: nichts ungelesen

    const cold = marker('Kalt')
    publish(cold)
    await expect(roomDot(page)).toBeVisible({ timeout: 20_000 })

    // Drei Gates, jedes für sich: fehlt eins, wäre ein fehlender Punkt nach dem Reload
    // eine Aussage über den Cache-Füllstand, nicht über den Ungelesen-Pfad.
    await expect.poll(() => messageCached(page, cold), { timeout: 20_000 }).toBe(true)
    await expect.poll(() => membershipCached(page), { timeout: 20_000 }).toBe(true)
    const rows = await readStateRows(page)
    console.log(`[anker1] Lesestand vor dem Reload: ${JSON.stringify(rows)}`)
    expect(rows.all, 'Zeile "all" muss persistiert sein, sonst setzt der Reload sie neu auf jetzt').toBeGreaterThan(0)

    // Ab hier ist das Relay ein schwarzes Loch (kein connectToServer).
    await page.routeWebSocket(new RegExp(`localhost:${ZOOID_PORT}`), () => {})
    await page.reload()

    // Erst den Store, dann den Punkt — so trennt ein Fehlschlag die zwei möglichen
    // Ursachen (Ableitung kam nicht zustande vs. Ableitung stimmt, Blade rendert nicht).
    // Seit P6 trägt der Store eine ZAHL, nicht mehr `true` (`rooms: Record<h, number>`).
    // Geprüft wird deshalb „> 0" statt Gleichheit mit einem Literal: der Anker fragt
    // „meldet die Ableitung Ungelesenes", nicht „genau wie viele" — die exakte Zahl
    // hängt daran, wie viele Nachrichten der Lauf publiziert hat, und wäre gegen einen
    // wiederverwendeten Seed eine Zeitbombe (P5-Lehre).
    await expect
        .poll(async () => ((await unreadStore(page)) as { rooms?: Record<string, number> } | null)?.rooms?.[ROOM_H] ?? 0, {
            timeout: 45_000,
        })
        .toBeGreaterThan(0)
    console.log(`[anker1] Store nach Kaltstart: ${JSON.stringify(await unreadStore(page))}`)

    await expect(roomDot(page)).toBeVisible({ timeout: 45_000 })
    await expect(navDot(page)).toBeVisible({ timeout: 20_000 })

    // Gegenprobe zum Blockade-Anspruch: eine JETZT publizierte Nachricht darf NICHT
    // ankommen. Käme sie an, liefe der Punkt oben womöglich über das Netz statt über
    // den Cache, und der ganze Anker wäre wertlos.
    const blind = marker('Blind')
    publish(blind)
    await page.waitForTimeout(4000)
    await expect(page.getByText(blind, { exact: true })).toHaveCount(0)
})

/**
 * ANKER 2 — Lesen löscht den Punkt; hochgescrolltes Verlassen nicht.
 *
 * Teil 1 ist der Normalfall (Raum öffnen, am Boden stehen, zurück ⇒ Punkt weg).
 * Teil 2 ist die Gegenprobe im selben Test: OHNE sie bestünde Teil 1 auch dann, wenn
 * der Punkt schlicht bei jedem Raumbesuch verschwände — also auch für Nachrichten, die
 * der Nutzer nie gesehen hat.
 *
 * Die Trennung zu `read-watermark.spec.ts` ist Absicht: dort wird das gespeicherte
 * WASSERZEICHEN geprüft, hier die daraus abgeleitete ANZEIGE. Beides kann
 * unabhängig brechen (die Ableitung sitzt in `unread.ts`, nicht in `readState.ts`).
 */
test('Anker 2: Lesen löscht den Punkt — hochgescrollt verlassen lässt ihn stehen', async ({ page }) => {
    test.setTimeout(120_000)

    await openSpaces(page)

    // ── Teil 1: gelesen ⇒ weg ────────────────────────────────────────────────
    const seen = marker('Gelesen')
    publish(seen)
    await expect(roomDot(page)).toBeVisible({ timeout: 20_000 })

    await page.getByRole('button', { name: new RegExp(ROOM_NAME) }).click()
    await expect(page).toHaveURL(new RegExp(`/rooms/${ROOM_H}$`), { timeout: 20_000 })
    // Am Boden (Default, kein Scroll) — column-reverse pinnt die jüngste Nachricht.
    await expect(page.getByText(seen, { exact: true })).toBeVisible({ timeout: 20_000 })

    await page.getByRole('button', { name: 'Zurück' }).click()
    await expect(page).toHaveURL(/\/spaces$/, { timeout: 20_000 })
    await expect(roomDot(page)).toHaveCount(0, { timeout: 20_000 })
    await expect(navDot(page)).toHaveCount(0, { timeout: 20_000 })

    // ── Teil 2: hochgescrollt verlassen ⇒ bleibt ─────────────────────────────
    await page.getByRole('button', { name: new RegExp(ROOM_NAME) }).click()
    await expect(page).toHaveURL(new RegExp(`/rooms/${ROOM_H}$`), { timeout: 20_000 })
    await expect(page.getByText('Punkt Zeile 60', { exact: true })).toBeVisible({ timeout: 20_000 })

    // Robust hochscrollen, bis der Container nachweislich überläuft. Schwelle spiegelt
    // `onScroll()` in bridge.ts: `atBottom = Math.abs(scrollTop) < 60`.
    const log = page.locator('[role=log]')
    let metrics = { scrollTop: 0, scrollHeight: 0, clientHeight: 0 }
    await expect(async () => {
        await log.hover()
        await page.mouse.wheel(0, -6000)
        metrics = await log.evaluate((el) => ({ scrollTop: el.scrollTop, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }))
        expect(Math.abs(metrics.scrollTop)).toBeGreaterThan(60)
    }).toPass({ timeout: 30_000 })
    console.log(`[anker2] hochgescrollt: |scrollTop|=${Math.abs(metrics.scrollTop)} overflow=${metrics.scrollHeight - metrics.clientHeight}`)
    expect(metrics.scrollHeight - metrics.clientHeight).toBeGreaterThan(0)

    // Erst JETZT die neue Fremd-Nachricht: sie erreicht den Bildschirm des Nutzers nie.
    // Das Quittieren beim Betreten des Raums liegt zu diesem Zeitpunkt bereits hinter
    // uns; die Sekundengrenze abzuwarten macht `created_at > watermark` deterministisch
    // (siehe {@link awaitNextSecond}).
    await awaitNextSecond(page)
    const unseen = marker('Ungesehen')
    publish(unseen)
    await expect(page.getByText(unseen, { exact: true })).toBeVisible({ timeout: 20_000 })

    // Unmittelbar vor dem Verlassen belegen: wir stehen wirklich noch nicht am Boden.
    const beforeNav = await log.evaluate((el) => Math.abs(el.scrollTop))
    console.log(`[anker2] vor "Zurück": |scrollTop|=${beforeNav}`)
    expect(beforeNav).toBeGreaterThan(60)

    await page.getByRole('button', { name: 'Zurück' }).click()
    await expect(page).toHaveURL(/\/spaces$/, { timeout: 20_000 })

    // Diagnose VOR der Assertion. Ein Fehlschlag hier hat genau zwei mögliche
    // Ursachen, und die Zeile trennt sie ohne Nachfragen:
    //   Wasserzeichen >= created_at  ⇒ das `atBottom`-Gate hat NICHT gehalten
    //                                  (der Raum wurde beim Verlassen doch quittiert);
    //   Wasserzeichen <  created_at  ⇒ das Gate hielt, die Ableitung/Anzeige hängt.
    const rows = await readStateRows(page)
    const watermark = Math.max(rows.all ?? 0, rows[`r:${ZOOID_URL}|${ROOM_H}`] ?? 0)
    console.log(
        `[anker2] nach "Zurück": createdAt(${unseen})=${createdAt(unseen)} watermark=${watermark} ` +
            `(all=${rows.all ?? 0} raum=${rows[`r:${ZOOID_URL}|${ROOM_H}`] ?? 0}) store=${JSON.stringify(await unreadStore(page))}`,
    )

    await expect(roomDot(page)).toBeVisible({ timeout: 20_000 })
})

/**
 * ANKER 3 — zweiter Tab folgt ohne Reload.
 *
 * Zwei Seiten im SELBEN BrowserContext (geteilte Origin ⇒ geteilter
 * `BroadcastChannel`, geteilte IndexedDB, geteilte Session). Gelesen wird in Tab A,
 * geprüft wird Tab B.
 *
 * Das „ohne Reload" ist keine Behauptung, sondern gemessen: Tab B bekommt vor dem
 * Lesen ein `window`-Sentinel gesetzt. Überlebt es bis zur Assertion, hat Tab B
 * weder neu geladen noch die Seite getauscht — sonst wäre der Beweis wertlos,
 * weil ein Reload den Punkt allein aus der IndexedDB korrigiert hätte.
 */
test('Anker 3: zweiter Tab verliert den Punkt ohne Reload', async ({ page, context }) => {
    test.setTimeout(120_000)

    await openSpaces(page)

    const tabB = await context.newPage()
    await useZooid(tabB)
    await tabB.goto('/spaces')
    await expect(tabB.getByRole('button', { name: new RegExp(ROOM_NAME) })).toBeVisible({ timeout: 20_000 })
    await tabB.evaluate(() => {
        ;(window as unknown as { __tabB: number }).__tabB = 1
    })

    const shared = marker('ZweiTabs')
    publish(shared)
    await expect(roomDot(page)).toBeVisible({ timeout: 20_000 })
    await expect(roomDot(tabB)).toBeVisible({ timeout: 20_000 })

    // Tab A liest.
    await page.getByRole('button', { name: new RegExp(ROOM_NAME) }).click()
    await expect(page.getByText(shared, { exact: true })).toBeVisible({ timeout: 20_000 })
    await page.getByRole('button', { name: 'Zurück' }).click()
    await expect(roomDot(page)).toHaveCount(0, { timeout: 20_000 })

    // Tab B folgt — ohne dass dort irgendetwas passiert wäre.
    await expect(roomDot(tabB)).toHaveCount(0, { timeout: 20_000 })
    expect(
        await tabB.evaluate(() => (window as unknown as { __tabB?: number }).__tabB),
        'Tab B hat neu geladen — die Konvergenz wäre dann kein BroadcastChannel-Beweis',
    ).toBe(1)

    await tabB.close()
})

/**
 * ANKER 4 — fehlender `unread`-Store bricht nichts.
 *
 * Zwei Zustände, beide in einem Test, weil sie dieselbe Zusage aus zwei Richtungen
 * treffen (`unread-dot.blade.php`: „fehlt der Store — Gast, Ladephase, Fremdhost ohne
 * Datenstrang — rendert NICHTS"):
 *
 *   A) Gast auf `/nostr-login`. Ein ECHTER Zustand, nichts simuliert — aber ein
 *      SCHWACHER Beleg, und das steht hier, statt es zu verschweigen: in DIESEM Host
 *      rendert die punkttragende `app-shell` (Bottom-Nav) ausschließlich hinter dem
 *      Auth-Gate (`⚡spaces`, `⚡directory`, `⚡settings`, `settings/⚡wallet`) — ein
 *      Gast bekommt sie nie zu sehen. Geprüft ist damit „auf der Gast-Seite existiert
 *      kein Punkt und nichts wirft", NICHT „die Komponente überlebt einen fehlenden
 *      Store". Letzteres leistet B. Zweite Ungenauigkeit, ebenfalls benannt: für
 *      Gäste ist der Store REGISTRIERT (der Datenstrang bootet mit), nur leer.
 *   B) `/spaces`, eingeloggt, mit NACHWEISLICH ungelesenem Raum — aber die
 *      Registrierung von `Alpine.store('unread')` wird unterdrückt. Das ist der
 *      eigentliche „Store fehlt"-Fall: `$store.unread` ist `undefined`, obwohl es
 *      etwas zu melden gäbe. Der Zustand wird im Harness erzeugt, nicht im
 *      Produktivcode (Präzedenzfall: der IDB-Write-Fehler in
 *      `storage-cache.spec.ts` P4). Die Attrappe schluckt NUR die Registrierung und
 *      liefert dem Aufrufer weiter ein Objekt zurück — sonst risse `wireUnread`
 *      selbst, und der Test prüfte einen Fehler, den er selbst gebaut hat.
 *
 * Geprüft wird beides Mal doppelt: kein Punkt UND keine JS-Fehler (`pageerror` +
 * `console.error`). Ein `x-if` über einem `undefined` ist genau die Stelle, an der
 * Alpine sonst pro Frame eine Exception in die Konsole schriebe, ohne dass man der
 * Oberfläche etwas ansieht.
 */
test('Anker 4: fehlender unread-Store rendert nichts und wirft nichts', async ({ page }) => {
    test.setTimeout(120_000)

    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
    page.on('console', (msg) => {
        if (msg.type() === 'error') {
            errors.push(`console.error: ${msg.text()}`)
        }
    })

    // ── A) Gast ──────────────────────────────────────────────────────────────
    await useZooid(page)
    await page.goto('/nostr-login')
    await expect(page.getByRole('button', { name: 'Andere Optionen' })).toBeVisible({ timeout: 20_000 })
    await page.waitForTimeout(2000) // Alpine-Boot + erste Store-Emits abwarten
    // Kein Marker IRGENDWO im Dokument (nicht nur in der Nav — die gibt es hier nicht).
    // Seit P6 sind das zwei Formen: der Punkt (Nav) und die Zähler-Pille (Zeile/Tab/
    // Glocke). Beide einzeln abfragen — eine Oder-Abfrage über einen kombinierten
    // Selektor bestünde auch dann, wenn eine der beiden Formen gar nicht mehr existiert.
    await expect(page.locator('span.size-2.rounded-full')).toHaveCount(0)
    await expect(page.locator('span.bg-brand-500.text-zinc-950')).toHaveCount(0)
    console.log(`[anker4/Gast] Fehler bisher: ${errors.length ? errors.join(' | ') : 'keine'}`)
    expect(errors, `Gast-Ansicht warf: ${errors.join(' | ')}`).toEqual([])

    // ── B) Store unterdrückt, obwohl es etwas zu melden gäbe ─────────────────
    // Der Listener wird VOR dem Seiten-Skript registriert und feuert deshalb vor
    // `app.ts`; ab dann sieht `registerNostrComponents` die Attrappe.
    await page.addInitScript(() => {
        document.addEventListener('alpine:init', () => {
            const alpine = (window as unknown as { Alpine: { store: (n: string, v?: unknown) => unknown } }).Alpine
            const real = alpine.store.bind(alpine)
            let detached: unknown = undefined
            alpine.store = (name: string, value?: unknown) => {
                if (name === 'unread') {
                    // Registrierung schlucken: der Store landet NIE in Alpines
                    // `$store`-Registry, `$store.unread` bleibt undefined. Der
                    // Aufrufer bekommt trotzdem sein Objekt zurück und arbeitet
                    // ins Leere statt zu werfen.
                    if (value !== undefined) {
                        detached = value
                        return undefined
                    }
                    return detached
                }
                return real(name, value)
            }
        })
    })

    await loginNsec(page, NSEC)
    await expect(page.getByRole('button', { name: new RegExp(ROOM_NAME) })).toBeVisible({ timeout: 20_000 })

    // Der Store fehlt NUR in der Oberfläche — der Lesestand-Pfad läuft weiter. Es gibt
    // also echt etwas Ungelesenes; ohne diese Nachricht bewiese der fehlende Punkt nichts.
    const hidden = marker('OhneStore')
    publish(hidden)
    await expect
        .poll(async () => (await readStateRows(page)).all ?? 0, { timeout: 20_000 })
        .toBeGreaterThan(0)
    await page.waitForTimeout(5000) // Zeit für Netz-Delta + Ableitung + Render

    // Gegenprobe, dass die Attrappe wirklich greift (sonst prüfte B dasselbe wie A).
    const storeMissing = await page.evaluate(
        () => (window as unknown as { Alpine: { store: (n: string) => unknown } }).Alpine.store('unread') === undefined,
    )
    // `Alpine.store('unread')` geht durch die Attrappe und liefert das abgelegte Objekt;
    // entscheidend ist die REGISTRY, die Alpine-Ausdrücke lesen.
    const registryMissing = await page.evaluate(() => {
        const el = document.querySelector('[x-data]') as (HTMLElement & { _x_dataStack?: unknown }) | null
        const alpine = (window as unknown as { Alpine: { $data: (e: Element) => Record<string, unknown> } }).Alpine
        if (!el) {
            return 'kein x-data-Element gefunden'
        }
        const stores = (alpine.$data(el) as { $store?: Record<string, unknown> }).$store
        return stores ? Object.prototype.hasOwnProperty.call(stores, 'unread') : 'kein $store im Scope'
    })
    console.log(`[anker4/ohne Store] Alpine.store('unread')===undefined: ${storeMissing} · Registry hat 'unread': ${registryMissing}`)
    expect(registryMissing, 'Attrappe wirkungslos — $store.unread existiert doch, Anker prüft nichts').toBe(false)

    await expect(roomDot(page)).toHaveCount(0)
    await expect(navDot(page)).toHaveCount(0)
    expect(errors, `mit fehlendem Store geworfen: ${errors.join(' | ')}`).toEqual([])
})
