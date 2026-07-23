import { test, expect, type Page } from './support/fixtures'
import { execFileSync } from 'node:child_process'
import { neventEncode } from 'nostr-tools/nip19'
import { useZooid, ZOOID_PORT, ZOOID_URL, ZOOID_WS } from './support/zooid'
import { loginNsec } from './support/login'

/**
 * P4 — die Benachrichtigungs-View `/updates` im echten Browser.
 *
 * Abgegrenzt gegen die Nachbarn, damit hier nichts doppelt geprüft wird:
 *   - `js/updates.test.ts` / `js/updatesView.test.ts` (node) decken die REINE Logik ab:
 *     Buckets, Aggregation, Paginierungsgrenzen, Untertitel, aria-Label-Bau und die
 *     `?from=`-Whitelist. Das wird hier NICHT wiederholt.
 *   - `back-navigation.spec.ts` deckt den Rückweg OHNE Herkunft ab (Raum → Übersicht,
 *     Filtererhalt, `replaceState` beim Filtern).
 *   - Diese Datei prüft ausschließlich, was nur ein Browser beantworten kann: rendert
 *     die Seite, trifft der Deep-Link, führt der Rückweg zurück, wie groß sind die
 *     Flächen wirklich, und was hört ein Screenreader an einer Zeile.
 *
 * ── Determinismus gegen einen WIEDERVERWENDETEN Seed ──────────────────────────
 * Der zooid-Seed überlebt zwischen Läufen. Zwei Konsequenzen sind hier lasttragend:
 *
 *   1. **Jeder Test legt seinen EIGENEN Raum an** (`h`/Name mit Zufallssuffix) und
 *      tritt ihm bei. Kein Test schreibt in einen geteilten Seed-Raum, keine Zeile
 *      dieser Datei hängt daran, was ein früherer Lauf hinterlassen hat. Muster:
 *      `createRoomNak` aus `spaces.spec.ts` (P5).
 *   2. **Keine Assertion auf eine Zeilen-ANZAHL.** `computeUpdates` hält gelesene
 *      Zeilen 24 h in der Liste (`UPDATES_RETENTION_SEC`) — jeder Lauf der letzten
 *      24 Stunden hinterlässt also gelesene Zeilen für seine Räume. Geprüft wird
 *      immer die EIGENE, per Zufallsname adressierte Zeile, nie „die Liste hat N".
 *
 * Der Leerzustand ist der einzige Fall, der eine wirklich leere Liste braucht. Er
 * wird nicht erhofft, sondern hergestellt: {@link stubEmptyRelay} ersetzt den Relay
 * durch einen, der verbunden ist und auf jedes REQ sofort EOSE schickt. Frischer
 * Browser-Context (leere IndexedDB) + leerer Relay = beweisbar nichts zu zeigen.
 *
 * ── Warum die Anker über die Glocke einsteigen ────────────────────────────────
 * Historie, weil sie die Form dieser Datei erklärt: `/updates` lud die Raum-
 * Mitgliedschaften ursprünglich NICHT selbst (`watchSpaceRooms` rief nur `nostrSpaces`,
 * `nostrDirectory` und die Room-Insel). Ein kalter Direkteinstieg fand damit `joined =
 * []` und rendete dauerhaft „Alles gelesen" (gemessen 2026-07-23: 20 s, 0 Zeilen,
 * `$store.unread.any === false`). **Behoben** — `nostrUpdates` abonniert inzwischen
 * selbst `watchSpaceRooms` mit eigenem `AbortController`.
 *
 * Die übrigen Anker steigen trotzdem weiter über die **Glocke** ein: das ist der vom
 * Plan vorgesehene Einstieg, er ist der Weg des Nutzers, und er hält die Anker vom
 * Ladeverhalten des Direkteinstiegs unabhängig. Der kalte Weg ist damit nicht
 * ungeprüft, im Gegenteil — {@link Anker 14} misst ihn gezielt und ist die EINZIGE
 * Absicherung dieser Ladeentscheidung: sie ist ein Seiteneffekt auf einem
 * welshman/Browser-Pfad ohne prüfbare Rückgabe und deshalb nicht node-testbar.
 */

const NSEC = process.env.NOSTR_TEST_NSEC as string
const NAK = '/home/user/go/bin/nak'
/** Relay-Owner-Secret (= relay.self). FREMDER Autor — eigene Ereignisse zählen nie. */
const ADMIN = 'b2ee09a54bedf17ee1db562bdddd75c48661d981eb52c49dc206c55ba8439414'
const ADMIN_PUB = 'da99fbe39247109327ac8504750d0227d50a8f84049ac8bd2f6c7ad0806ed76d'

type RelayEvent = { id: string; pubkey: string; kind: number; content: string; tags: string[][]; created_at: number }

const rnd = (): number => Math.floor(Math.random() * 1e9)

/**
 * Frischer Test-Raum, dem der Test-User beitritt — pro Test neu (siehe Kopf).
 * `9007` legt den Raum an, `9002` benennt ihn, `9021` ist der Beitritt des Users
 * (Relay antwortet mit der signierten 39002 = das, was die App als „beigetreten" liest).
 */
function makeRoom(): { h: string; name: string } {
    const id = rnd()
    const h = `upd${id}`
    const name = `Meldeprobe-${id}`
    execFileSync(NAK, ['event', '--auth', '--sec', ADMIN, '-k', '9007', '-t', `h=${h}`, ZOOID_WS])
    execFileSync(NAK, ['event', '--auth', '--sec', ADMIN, '-k', '9002', '-t', `h=${h}`, '-t', `name=${name}`, ZOOID_WS])
    execFileSync(NAK, ['event', '--auth', '--sec', NSEC, '-k', '9021', '-t', `h=${h}`, ZOOID_WS])
    return { h, name }
}

/** Fremde kind-9-Nachricht in `h`. Gibt die Event-id zurück (Thread-Wurzel). */
function publishMessage(h: string, content: string): string {
    const out = execFileSync(NAK, ['event', '--auth', '--sec', ADMIN, '-k', '9', '-t', `h=${h}`, '-c', content, ZOOID_WS]).toString()
    return findEvent(h, 9, (e) => e.content === content)?.id ?? out.trim()
}

/**
 * Fremder NIP-22-Kommentar auf `rootId` — Tag-Form wie die App sie schreibt
 * (`E`=Root, `e`=Parent, `k`=Parent-Kind, `h`=Root-Raum, siehe room.spec.ts C6b).
 * Das `h` ist additiv (Thread-Interop) und trägt hier die Raum-Zuordnung, falls die
 * Wurzel noch nicht im Repository liegt.
 */
function publishComment(h: string, rootId: string, content: string): void {
    execFileSync(NAK, [
        'event', '--auth', '--sec', ADMIN, '-k', '1111',
        '-t', `E=${rootId}`, '-t', `e=${rootId}`, '-t', 'k=9', '-t', `h=${h}`,
        '-c', content, ZOOID_WS,
    ])
}

/** Erstes Event am Relay, das `pred` erfüllt. */
function findEvent(h: string, kind: number, pred: (e: RelayEvent) => boolean): RelayEvent | undefined {
    return execFileSync(NAK, ['req', '-k', String(kind), '-t', `h=${h}`, '--auth', '--sec', ADMIN, ZOOID_WS])
        .toString()
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as RelayEvent)
        .find(pred)
}

/**
 * Wartet, bis die Wanduhr eine ganze Sekunde weitergerückt ist (Muster aus
 * `unread-dot.spec.ts`).
 *
 * KEIN „warte mal kurz": Wasserzeichen (`Math.floor(Date.now()/1000)`) und `created_at`
 * rechnen beide in SEKUNDEN, und die Ungelesen-Regel ist bewusst `created_at >
 * watermark` (strikt). Quittieren und Publizieren in derselben Sekunde ergibt völlig
 * korrekt „gelesen" — nur eben nicht den Zustand, den der Test herstellen will. Gewartet
 * wird deshalb auf eine NACHPRÜFBARE Bedingung, nicht auf eine geratene Dauer.
 */
async function awaitNextSecond(page: Page): Promise<void> {
    const start = Math.floor(Date.now() / 1000)
    while (Math.floor(Date.now() / 1000) <= start) {
        await page.waitForTimeout(100)
    }
}

/**
 * Das globale Wasserzeichen `all` aus der Lesestand-DB (0, wenn keins da ist).
 * Dient als Beweis, dass ein Kaltstart die Lesestand-DB NICHT mitgelöscht hat — ohne
 * sie setzte `initReadState()` `all = jetzt` und jede leere Liste hätte eine banale,
 * falsche Erklärung.
 */
function readStateAll(page: Page): Promise<number> {
    return page.evaluate(async () => {
        const dbs = await indexedDB.databases()
        const name = dbs.map((d) => d.name).find((n) => n?.startsWith('einundzwanzig-readstate-'))
        if (!name) {
            return 0
        }
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
            const req = indexedDB.open(name)
            req.onsuccess = () => resolve(req.result)
            req.onerror = () => reject(req.error)
        })
        try {
            if (!db.objectStoreNames.contains('readstate')) {
                return 0
            }
            const rows = await new Promise<{ key: string; ts: number }[]>((resolve, reject) => {
                const req = db.transaction('readstate', 'readonly').objectStore('readstate').getAll()
                req.onsuccess = () => resolve(req.result as { key: string; ts: number }[])
                req.onerror = () => reject(req.error)
            })
            return rows.find((r) => r.key === 'all')?.ts ?? 0
        } finally {
            db.close()
        }
    })
}

/** Login gegen den echten Test-Relay; danach steht das Wasserzeichen `all` auf „jetzt". */
async function login(page: Page): Promise<void> {
    await useZooid(page)
    await loginNsec(page, NSEC)
}

/**
 * Ersetzt den Relay durch einen, der VERBUNDEN, aber LEER ist: jedes REQ bekommt
 * sofort ein EOSE, jedes EVENT ein OK. Kein schwarzes Loch — ein nicht antwortender
 * Socket ließe welshmans `load()` in seinen Timeout laufen, der Skeleton bliebe
 * stehen und der Leerzustand käme nie zur Anzeige (der Test prüfte dann den
 * Ladezustand und nennte ihn „leer").
 */
async function stubEmptyRelay(page: Page): Promise<void> {
    await page.routeWebSocket(new RegExp(`localhost:${ZOOID_PORT}`), (ws) => {
        ws.onMessage((raw) => {
            let msg: unknown[]
            try {
                msg = JSON.parse(String(raw)) as unknown[]
            } catch {
                return
            }
            if (msg[0] === 'REQ') {
                ws.send(JSON.stringify(['EOSE', msg[1]]))
            } else if (msg[0] === 'EVENT') {
                ws.send(JSON.stringify(['OK', (msg[1] as { id?: string })?.id ?? '', true, '']))
            } else if (msg[0] === 'AUTH') {
                ws.send(JSON.stringify(['OK', '', true, '']))
            }
        })
    })
}

/**
 * Spion auf `history.back` — VOR dem Seiten-Skript installiert, überlebt `page.goto`.
 * Der Zähler ist die einzige Möglichkeit, „das UP-Ziel wurde EXPLIZIT angesteuert" von
 * „es sah zufällig so aus, weil der History-Stack passte" zu unterscheiden (§9/19).
 */
async function spyHistoryBack(page: Page): Promise<void> {
    await page.addInitScript(() => {
        const w = window as unknown as { __backCalls: number }
        w.__backCalls = 0
        const original = window.history.back.bind(window.history)
        window.history.back = () => {
            w.__backCalls += 1
            original()
        }
    })
}

const backCalls = (page: Page): Promise<number> =>
    page.evaluate(() => (window as unknown as { __backCalls?: number }).__backCalls ?? 0)

/** Die Header-Glocke auf `/spaces` — der im Plan vorgesehene Einstieg in „Neu". */
const bell = (page: Page) => page.getByRole('link', { name: /^Neu/ })

/**
 * Öffnet „Neu" so, wie ein Nutzer es tut: Glocke auf `/spaces` (`wire:navigate`).
 * Warum nicht `page.goto` — siehe Modul-Docstring.
 */
async function openUpdates(page: Page): Promise<void> {
    await expect(bell(page)).toBeVisible({ timeout: 25_000 })
    await bell(page).click()
    await expect(page).toHaveURL(/\/updates$/, { timeout: 25_000 })
    await expect(page.getByRole('heading', { name: 'Neu', exact: true })).toBeVisible({ timeout: 25_000 })
}

/**
 * Obergrenzen für {@link Anker 15}, am gerenderten Baum GEMESSEN und mit Luft gesetzt —
 * nicht aus Tokens gerechnet (in diesem Projekt lagen gerechnete Werte dreimal in Folge
 * zu optimistisch). Die Schranken sollen einen ausgehebelten Zuschnitt fangen, nicht
 * eine Schriftgrößen-Änderung um zwei Pixel.
 *
 * Messwerte mit demselben ~570-Zeichen-Snippet (2026-07-23, Host-Chromium):
 *   | Zustand                        | Snippet | Zeile  |
 *   | mit `block` (der Defekt)       | 168 px  | 261 px |
 *   | nach dem Fix, 1280 px          |  42 px  | 135 px |
 *   | nach dem Fix,  320 px          |  42 px  | 135 px |
 * Die Schranken liegen ~33 % bzw. ~48 % über dem Ist-Wert und deutlich unter dem
 * Defektwert — sie greifen also bei der Regression, nicht bei Kosmetik.
 */
const SNIPPET_MAX = 56
const ROW_MAX_WIDE = 200
const ROW_MAX_NARROW = 200

/** Zeilen-Buttons der Liste (x-for-Kinder unter dem Bucket-<h2>). */
const rows = (page: Page) => page.locator('.surface-card section > div > button')

/**
 * Der Ungelesen-Zustand steht seit dem A11y-Fix VORNE im Namen (`'Ungelesen. '`), nicht
 * mehr als Suffix: bei einem bis zu dreistellig langen Label hörte man ihn hinten nie,
 * weil man nach dem Snippet unterbricht. Das Präfix ist Teil des Namens und muss in
 * jedem Zeilen-Locator optional zugelassen werden — sonst findet ein Locator, der am
 * Kontext verankert, ausgerechnet die UNGELESENEN Zeilen nicht.
 */
const UNREAD_PREFIX = 'Ungelesen. '

/** Die eine Zeile, die zu diesem Raum gehört — mit oder ohne Zustands-Präfix. */
const roomRow = (page: Page, name: string) =>
    page.getByRole('button', { name: new RegExp(`^(${UNREAD_PREFIX})?${name}\\. `) })
const threadRow = (page: Page, name: string) =>
    page.getByRole('button', { name: new RegExp(`^(${UNREAD_PREFIX})?${name} · Thread\\. `) })

/** Die 2-px-Herkunfts-Rail einer Zeile (`x-show`, bleibt im DOM). */
const rail = (row: ReturnType<typeof roomRow>) => row.locator('span.w-0\\.5').first()

/**
 * Kopf-Pfeil von `/updates` zurück auf die Übersicht. Bewusst als LINK adressiert:
 * ohne `backExpr` rendert `app-header` einen `<a wire:navigate>` (der Raum dagegen
 * einen echten `<button>` mit Alpine-Aktion) — `getByRole('button')` läuft hier in
 * einen Timeout, und der sähe aus wie ein hängender Screen.
 */
const updatesBack = (page: Page) => page.getByRole('link', { name: 'Zurück' })

/** Sammelt `pageerror` + `console.error` — beides muss leer bleiben. */
function collectErrors(page: Page): string[] {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
    page.on('console', (msg) => {
        if (msg.type() === 'error') {
            errors.push(`console.error: ${msg.text()}`)
        }
    })
    return errors
}

/**
 * ANKER 1 — die Seite lebt, und der Leerzustand ist ein ZUSTAND (Plan-DoD, §3.5).
 *
 * Drei Aussagen in einem Test, weil sie denselben Aufbau brauchen:
 *   a) Der Lade-Skeleton steht im SERVER-gerenderten HTML. Gemessen am rohen
 *      Antwort-Body (`page.request`), also vor jedem Byte JavaScript — genau das ist
 *      der Unterschied zwischen `@for` und `<template x-if>`, den man am fertig
 *      gebooteten DOM nicht mehr sehen könnte.
 *   b) `/updates` bootet ohne `pageerror` und ohne Konsolen-`error`.
 *   c) Bei leerer Liste steht deutscher Text + eine Aktion, kein leerer Screen.
 */
test('Anker 1: /updates rendert, Skeleton kommt vom Server, Leerzustand ist ein Zustand', async ({ page }) => {
    test.setTimeout(120_000)

    const errors = collectErrors(page)

    // Leerer (aber verbundener) Relay VOR dem Login: die IndexedDB des frischen
    // Contexts ist ohnehin leer, damit hat die Liste beweisbar keine Quelle.
    await useZooid(page)
    await stubEmptyRelay(page)
    await loginNsec(page, NSEC)

    // ── a) roher Antwort-Body, kein JS ────────────────────────────────────────
    const res = await page.request.get('/updates')
    expect(res.status(), 'Route /updates muss für den eingeloggten Nutzer 200 liefern').toBe(200)
    const html = await res.text()
    const skeletons = html.match(/skeleton size-10/g)?.length ?? 0
    console.log(`[anker1] server-gerenderte Skeleton-Zeilen: ${skeletons}`)
    expect(skeletons, 'die 5 @for-Skeleton-Zeilen müssen ohne JS im Body stehen').toBe(5)
    expect(html, 'Skeleton darf nicht in einem x-if-Template liegen — das existiert vor dem Alpine-Boot nicht').not.toContain('x-if="loading"')
    expect(html).toContain('Benachrichtigungen werden geladen…')

    // ── b) + c) im Browser ────────────────────────────────────────────────────
    await openUpdates(page)

    // Der Leerzustand: Aussage + Erwartung + Weg heraus.
    await expect(page.getByText('Alles gelesen.', { exact: true })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText('Neue Nachrichten aus deinen Räumen erscheinen hier.')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Zu den Räumen' })).toBeVisible()

    // Der Skeleton ist NICHT mehr sichtbar (loading aufgelöst) — sonst wäre „leer" nur
    // „lädt". Er bleibt im DOM (x-show, nicht x-if); geprüft wird die Sichtbarkeit,
    // denn genau das ist die Zusage des server-gerenderten Markups.
    await expect(page.locator('.skeleton').first()).toBeHidden({ timeout: 20_000 })

    // Alpine lebt wirklich (nicht bloß statisches Markup): der Screen-Scope antwortet.
    const alive = await page.evaluate(() => {
        const alpine = (window as unknown as { Alpine?: { $data: (e: Element) => Record<string, unknown> } }).Alpine
        const el = document.querySelector('[x-data="nostrUpdates"]')
        return alpine && el ? typeof (alpine.$data(el) as { isEmpty?: unknown }).isEmpty : 'kein Alpine/Scope'
    })
    expect(alive, 'Alpine-Insel nostrUpdates ist nicht gebootet').toBe('function')

    console.log(`[anker1] Fehler: ${errors.length ? errors.join(' | ') : 'keine'}`)
    expect(errors, `/updates warf: ${errors.join(' | ')}`).toEqual([])
})

/**
 * ANKER 2 — Deep-Link in den RAUM trifft, und der Rückweg landet wieder in „Neu"
 * (Plan-DoD; §9/15 + 16).
 *
 * Der Rückweg wird ZWEIMAL geprüft, weil zwei verschiedene Mechaniken ihn tragen und
 * ein Test allein nicht sagen könnte, welche gegriffen hat:
 *   - warm (durchgeklickt): `backFromRoom` findet einen App-internen Vorgänger →
 *     `history.back()`.
 *   - kalt (frischer Aufruf mit `?from=updates`): kein Vorgänger → `originHref()` muss
 *     das UP-Ziel aus der Whitelist liefern. Der `history.back`-Spion belegt, dass hier
 *     wirklich das Ziel gewählt und nicht bloß zurückgesprungen wurde.
 */
test('Anker 2: Zeile → /rooms/{h}?from=updates, Kopf-Pfeil führt zurück nach /updates', async ({ page }) => {
    test.setTimeout(120_000)

    await spyHistoryBack(page)
    const room = makeRoom()
    await login(page)
    await expect(page.getByRole('button', { name: new RegExp(room.name) })).toBeVisible({ timeout: 25_000 })

    // NACH dem Login publizieren: vorher läge die Nachricht unter `all = Login-Zeit`
    // und gälte als gelesen — die Zeile entstünde dann aus dem Seed, nicht aus der App.
    const marker = `Deep-${rnd()}`
    publishMessage(room.h, marker)

    await openUpdates(page)
    const row = roomRow(page, room.name)
    await expect(row).toBeVisible({ timeout: 30_000 })
    console.log(`[anker2] Zeilen-Label: ${await row.getAttribute('aria-label')}`)

    // ── warm: Klick auf die Zeile ─────────────────────────────────────────────
    await row.click()
    await expect(page).toHaveURL(new RegExp(`/rooms/${room.h}\\?`), { timeout: 25_000 })
    let url = new URL(page.url())
    expect(url.pathname).toBe(`/rooms/${room.h}`)
    expect(url.searchParams.get('from'), 'Deep-Link muss die Herkunft tragen').toBe('updates')
    await expect(page.getByText(marker, { exact: true })).toBeVisible({ timeout: 25_000 })

    await page.getByRole('button', { name: 'Zurück' }).click()
    await expect(page).toHaveURL(/\/updates$/, { timeout: 25_000 })
    await expect(page.getByRole('heading', { name: 'Neu', exact: true })).toBeVisible({ timeout: 25_000 })

    // ── kalt: derselbe Link, frisch aufgerufen, ohne App-internen Vorgänger ────
    await page.goto(`/rooms/${room.h}?from=updates`)
    await page.evaluate(() => sessionStorage.removeItem('appNav'))
    await expect(page.getByRole('heading', { name: `# ${room.name}` })).toBeVisible({ timeout: 25_000 })
    const before = await backCalls(page)

    await page.getByRole('button', { name: 'Zurück' }).click()
    await expect(page).toHaveURL(/\/updates$/, { timeout: 25_000 })
    url = new URL(page.url())
    expect(url.pathname).toBe('/updates')
    expect(
        (await backCalls(page)) - before,
        'ohne App-Vorgänger muss das UP-Ziel explizit angesteuert werden, nicht history.back()',
    ).toBe(0)
})

/**
 * ANKER 3 — Deep-Link in den THREAD trifft, und zweimal Kopf-Pfeil führt über den Raum
 * zurück nach „Neu" (§9/18).
 *
 * Die Zwischenstation ist der eigentliche Inhalt: nach dem ERSTEN Pfeil muss `from=`
 * die Raum-URL überleben. Ohne das führte der zweite Pfeil beim Deep-Link-Kaltstart
 * (kein `history.back()` verfügbar) auf `/spaces` statt nach „Neu" — der warm
 * durchgeklickte Fall verdeckte den Defekt, weil `history.back()` zufällig dasselbe
 * Ziel trifft. Genau dieser Zustand war am 2026-07-23 im Arbeitsbaum messbar (Query
 * nach dem 1. Pfeil: leer); `backFromThread()` rettet die Herkunft inzwischen über
 * `threadBackTarget`. Die Zeile bleibt als Assertion stehen, damit sie es weiter tut.
 */
test('Anker 3: Thread-Zeile → /rooms/{h}/thread/{nevent}?from=updates, zweimal Zurück endet in /updates', async ({ page }) => {
    test.setTimeout(150_000)

    const room = makeRoom()
    await login(page)
    await expect(page.getByRole('button', { name: new RegExp(room.name) })).toBeVisible({ timeout: 25_000 })

    const rootMarker = `Wurzel-${rnd()}`
    const rootId = publishMessage(room.h, rootMarker)
    expect(rootId, 'Thread-Wurzel muss am Relay auffindbar sein').toMatch(/^[0-9a-f]{64}$/)
    const replyMarker = `Antwort-${rnd()}`
    publishComment(room.h, rootId, replyMarker)

    await openUpdates(page)
    const row = threadRow(page, room.name)
    // 45 s statt 30: die Thread-Zeile hängt an `loadSpaceThreads` (One-Shot beim
    // Insel-Start, lädt ALLE Kommentare des Space und danach deren Wurzeln per id).
    // Das ist der längste Ladeweg dieser Datei; unter voller Parallellast lief er einmal
    // knapp über 30 s. Kein Nachgeben gegenüber Fehlverhalten — die Zeile kam, nur später.
    await expect(row).toBeVisible({ timeout: 45_000 })
    const label = await row.getAttribute('aria-label')
    console.log(`[anker3] Thread-Zeilen-Label: ${label}`)
    expect(label, 'die Thread-Zeile trägt den Text der Antwort als Snippet').toContain(replyMarker)

    await row.click()
    await expect(page).toHaveURL(/\/thread\/nevent1[0-9a-z]+/, { timeout: 30_000 })
    const url = new URL(page.url())
    expect(url.pathname).toMatch(new RegExp(`^/rooms/${room.h}/thread/nevent1[0-9a-z]+$`))
    expect(url.searchParams.get('from'), 'Thread-Deep-Link muss die Herkunft tragen').toBe('updates')
    await expect(page.getByRole('dialog', { name: 'Thread' })).toBeVisible({ timeout: 25_000 })

    // 1. Kopf-Pfeil: Thread zu, zurück auf die Raum-Basis.
    await page.getByRole('button', { name: 'Zurück' }).click()
    await expect(page).toHaveURL(new RegExp(`/rooms/${room.h}(\\?|$)`), { timeout: 25_000 })
    const afterFirst = new URL(page.url())
    console.log(`[anker3] Query nach dem 1. Kopf-Pfeil: "${afterFirst.search}"`)
    expect(afterFirst.pathname).toBe(`/rooms/${room.h}`)
    expect(
        afterFirst.searchParams.get('from'),
        'die Herkunft muss die Zwischenstation überleben — sonst endet der 2. Pfeil beim Kaltstart auf /spaces',
    ).toBe('updates')

    // 2. Kopf-Pfeil: zurück nach „Neu".
    await page.getByRole('button', { name: 'Zurück' }).click()
    await expect(page).toHaveURL(/\/updates$/, { timeout: 25_000 })
    await expect(page.getByRole('heading', { name: 'Neu', exact: true })).toBeVisible({ timeout: 25_000 })
})

/**
 * ANKER 4 — Kaltstart in einen Thread OHNE Herkunft: zweimal Kopf-Pfeil endet auf dem
 * UP-Ziel `/spaces`, und `history.back()` wird dabei NIE gerufen (§9/19).
 *
 * Der Spion ist der eigentliche Inhalt des Ankers. Ohne ihn bestünde der Test auch
 * dann, wenn beide Pfeile blind zurückgesprungen wären — nach dem Login liegt
 * `/spaces` ohnehin im Stack, das Ziel sähe identisch aus.
 */
test('Anker 4: Kaltstart im Thread ohne from → 2× Zurück auf /spaces, ohne history.back()', async ({ page }) => {
    test.setTimeout(120_000)

    const room = makeRoom()
    const rootMarker = `Kalt-${rnd()}`
    const rootId = publishMessage(room.h, rootMarker)
    publishComment(room.h, rootId, `KaltAntwort-${rnd()}`)
    const nevent = neventEncode({ id: rootId, relays: [ZOOID_URL], author: ADMIN_PUB })

    await spyHistoryBack(page)
    await login(page)

    // Frischer, direkter Aufruf — KEIN Klick, kein wire:navigate: der `appNav`-Marker
    // bleibt unbeteiligt, `hasInternalHistory()` ist falsch, das UP-Ziel muss greifen.
    await page.goto(`/rooms/${room.h}/thread/${nevent}`)
    await page.evaluate(() => sessionStorage.removeItem('appNav'))
    await expect(page.getByRole('dialog', { name: 'Thread' })).toBeVisible({ timeout: 30_000 })
    const before = await backCalls(page)

    await page.getByRole('button', { name: 'Zurück' }).click()
    await expect(page).toHaveURL(new RegExp(`/rooms/${room.h}$`), { timeout: 25_000 })

    await page.getByRole('button', { name: 'Zurück' }).click()
    await expect(page).toHaveURL(/\/spaces$/, { timeout: 25_000 })
    await expect(page.getByText('Zooid Test Space')).toBeVisible({ timeout: 25_000 })

    const calls = (await backCalls(page)) - before
    console.log(`[anker4] history.back()-Aufrufe im ganzen Rückweg: ${calls}`)
    expect(calls, 'ohne App-Vorgänger darf kein history.back() fallen — es führte aus der App heraus').toBe(0)
})

/**
 * ANKER 5 — Müll im `?from=` wird verworfen, nie zu einem Ziel (§6.2, Whitelist).
 *
 * Eingaben, die ein naiver „nimm den Parameter als Ziel"-Ansatz durchreichen würde:
 * ein `javascript:`-Schema, ein protokoll-relativer Fremdhost, eine fremde Origin.
 * Beide Hälften der Zusage werden geprüft — der Parameter darf
 *   a) kein Navigationsziel werden (Kopf-Pfeil landet auf `/spaces`), und
 *   b) in KEINER erzeugten Thread-URL wieder auftauchen (`withOrigin` reicht nur
 *      whitelist-gültige Herkünfte durch; sonst trüge ein geteilter Thread-Link den
 *      fremden Wert weiter und der nächste Rückweg wertete ihn erneut aus).
 * Der Spion belegt zusätzlich, dass das UP-Ziel EXPLIZIT gewählt wurde (sonst prüfte
 * der Test nur, was zufällig im History-Stack lag).
 *
 * `?from=room` läuft mit, ist aber KEIN Müll: whitelist-gültig, ohne eigenes Ziel
 * (bestätigte Auslegung) — er fällt korrekt auf den Default und wird in der Thread-URL
 * durchgereicht. Deshalb steht er nur in der Ziel-, nicht in der Durchreich-Prüfung.
 */
test('Anker 5: kaputtes ?from= landet auf /spaces und taucht in keiner Thread-URL auf', async ({ page }) => {
    test.setTimeout(150_000)

    await spyHistoryBack(page)
    const room = makeRoom()
    // Root + Kommentar, damit an der Nachricht die Antworten-Pille steht: sie ist die
    // Stelle, an der `threadHref()` die Herkunft der aktuellen URL weiterreicht.
    const rootMarker = `Muell-${rnd()}`
    const rootId = publishMessage(room.h, rootMarker)
    publishComment(room.h, rootId, `MuellAntwort-${rnd()}`)
    await login(page)

    const JUNK = ['javascript:alert(1)', '//evil.tld', 'https://phish.example']
    for (const junk of [...JUNK, 'room']) {
        await page.goto(`/rooms/${room.h}?from=${encodeURIComponent(junk)}`)
        // Frischen Tab herstellen: der Rückweg des VORIGEN Durchlaufs war ein
        // `Livewire.navigate` und hat den `appNav`-Marker gesetzt. Ohne das Leeren
        // fände `hasInternalHistory()` ab Runde 2 einen Vorgänger, spränge per
        // `history.back()` zurück — und der Test bewiese nichts mehr über `?from=`.
        await page.evaluate(() => sessionStorage.removeItem('appNav'))
        expect(await page.evaluate(() => sessionStorage.getItem('appNav')), 'Vorbedingung: Tab ohne App-Vorgänger').toBeNull()
        await expect(page.getByRole('heading', { name: `# ${room.name}` })).toBeVisible({ timeout: 25_000 })
        // Zwei Stufen, weil zwei Ladepfade: erst der Verlauf (kind 9), dann die
        // Kommentare (kind 1111) — die Pille hängt an letzteren. Ohne die erste Stufe
        // liefe der Pillen-Timeout gegen einen Raum, der noch gar nichts gerendert hat;
        // genau daran ist der Anker unter voller Parallellast einmal gescheitert.
        await expect(page.getByText(rootMarker, { exact: true })).toBeVisible({ timeout: 30_000 })

        // b) Die erzeugte Thread-URL darf den Wert nicht tragen.
        const pill = page.getByRole('link', { name: /Thread öffnen/ }).first()
        await expect(pill).toBeVisible({ timeout: 30_000 })
        const href = (await pill.getAttribute('href')) as string
        console.log(`[anker5] ?from=${junk} → Thread-Pille: ${href}`)
        expect(href).toMatch(new RegExp(`^/rooms/${room.h}/thread/nevent1[0-9a-z]+`))
        if (JUNK.includes(junk)) {
            expect(href, `Müllwert "${junk}" wurde in die Thread-URL durchgereicht`).not.toContain('from=')
        } else {
            expect(href, 'eine whitelist-gültige Herkunft MUSS durchgereicht werden').toContain('from=room')
        }

        // a) Und er darf kein Navigationsziel werden.
        const before = await backCalls(page)
        await page.getByRole('button', { name: 'Zurück' }).click()
        await expect(page).toHaveURL(/\/spaces$/, { timeout: 25_000 })
        const url = new URL(page.url())
        expect(url.pathname, `?from=${junk} führte nicht auf das Default-Ziel`).toBe('/spaces')
        expect((await backCalls(page)) - before, `?from=${junk}: UP-Ziel muss explizit angesteuert werden`).toBe(0)
    }
})

/**
 * ANKER 6 — einen Thread aus dem RAUM zu öffnen erzeugt KEINEN History-Eintrag
 * (§9/17, `replaceState`).
 *
 * Das ist der Wächter über die Stelle, an der ein `pushState` einen kalten Insel-
 * Reboot auslösen würde: der Raum-Eintrag gehört Livewire samt Snapshot; ein Zurück
 * darauf riefe `document.body.replaceWith` + `Alpine.destroyTree`. Zusätzlich hier
 * gemessen und nicht nur behauptet: die Insel bleibt WARM (`window`-Sentinel).
 */
test('Anker 6: Thread aus dem Raum öffnen ändert history.length nicht', async ({ page }) => {
    test.setTimeout(120_000)

    const room = makeRoom()
    const rootMarker = `Pille-${rnd()}`
    const rootId = publishMessage(room.h, rootMarker)
    publishComment(room.h, rootId, `PillenAntwort-${rnd()}`)

    await login(page)
    await page.goto(`/rooms/${room.h}`)
    await expect(page.getByText(rootMarker, { exact: true })).toBeVisible({ timeout: 30_000 })

    const row = page.locator('div.group', { hasText: rootMarker })
    const pill = row.getByRole('link', { name: /Thread öffnen/ })
    await expect(pill).toBeVisible({ timeout: 30_000 })

    const before = await page.evaluate(() => history.length)
    await page.evaluate(() => {
        ;(window as unknown as { __warm?: number }).__warm = 1
    })

    await pill.click()
    await expect(page).toHaveURL(/\/thread\/nevent1[0-9a-z]+/, { timeout: 25_000 })
    await expect(page.getByRole('dialog', { name: 'Thread' })).toBeVisible({ timeout: 25_000 })

    const after = await page.evaluate(() => history.length)
    console.log(`[anker6] history.length: ${before} → ${after}`)
    expect(after, 'Thread-Öffnen darf keinen History-Eintrag pushen (replaceState)').toBe(before)
    expect(
        await page.evaluate(() => (window as unknown as { __warm?: number }).__warm),
        'die Insel wurde neu gebootet — dann wäre die History-Messung nicht die zugesagte Mechanik',
    ).toBe(1)
})

/**
 * ANKER 7 — der barrierefreie Name der Zeile ERSETZT den Kindtext, und „ungelesen"
 * steht VORNE (§7.10 / `updateAriaLabel`).
 *
 * Die 2-px-Rail ist `aria-hidden`, die Typ-Icons tragen keinen Text — der Name ist der
 * einzige Zugang zum Ungelesen-Zustand. **Wo im Namen** er steht, ist deshalb keine
 * Kosmetik: als Suffix am Ende eines mehrhundert Zeichen langen Labels hört ihn
 * niemand, weil man nach dem Snippet unterbricht. Der Zustand gehört ins erste Wort.
 *
 * Zweite Zusage derselben Entscheidung: der Snippet ist IM LABEL gekappt, steht aber
 * VOLLSTÄNDIG in der Zeile. Ein Name ist eine Kennung, kein Vorlesetext — der volle
 * Text darf darüber trotzdem nicht verloren gehen, sonst hätte man ein A11y-Problem
 * gegen ein Informationsproblem getauscht. Beides wird gemessen.
 *
 * Der Zustandswechsel im selben Test ist der Kern: eine Zeile, die das Präfix immer
 * (oder nie) trüge, bestünde eine Einzelmessung genauso.
 */
test('Anker 7: aria-label beginnt mit dem Ungelesen-Zustand, kappt den Snippet und ersetzt den Kindtext', async ({ page }) => {
    test.setTimeout(120_000)

    const room = makeRoom()
    await login(page)
    await expect(page.getByRole('button', { name: new RegExp(room.name) })).toBeVisible({ timeout: 25_000 })
    // Snippet deutlich über der Label-Kappung, damit die zweite Zusage etwas zu prüfen hat.
    const marker = `Label-${rnd()}`
    const longBody = `${LONG_SNIPPET}${marker}`
    publishMessage(room.h, longBody)

    await openUpdates(page)
    const row = roomRow(page, room.name)
    await expect(row).toBeVisible({ timeout: 30_000 })

    const unreadLabel = (await row.getAttribute('aria-label')) as string
    console.log(`[anker7] ungelesen (${unreadLabel.length} Zeichen): "${unreadLabel}"`)
    expect(unreadLabel, 'der Zustand muss im ERSTEN Wort stehen, nicht am Ende').toMatch(new RegExp(`^${UNREAD_PREFIX}`))
    expect(unreadLabel, `Zustand darf nur einmal vorkommen`).toBe(UNREAD_PREFIX + unreadLabel.slice(UNREAD_PREFIX.length))
    expect(unreadLabel.slice(UNREAD_PREFIX.length), 'nach dem Zustand folgt der Kontext').toMatch(new RegExp(`^${room.name}\\. `))

    // Der Snippet ist im NAMEN gekappt …
    expect(unreadLabel, 'der Name trägt eine Kappungs-Ellipse').toContain('…')
    expect(unreadLabel, 'der ungekürzte Snippet gehört NICHT in den Namen').not.toContain(marker)
    expect(unreadLabel.length, `Label bleibt kurz genug zum Anhören (${unreadLabel.length})`).toBeLessThanOrEqual(260)

    // … steht in der ZEILE aber vollständig. Sonst wäre Information verloren statt verlagert.
    await expect(row, 'der volle Text muss sichtbar in der Zeile stehen').toContainText(marker)

    // Der Name IST das Label — nicht Label + Kindtext. Playwright rechnet den
    // barrierefreien Namen aus dem Baum, `exact` schließt jedes Anhängsel aus.
    await expect(page.getByRole('button', { name: unreadLabel, exact: true })).toHaveCount(1)

    // Die Rail zeigt denselben Zustand optisch — und trägt ihn ausdrücklich NICHT
    // zum Namen bei (`aria-hidden`), sonst gäbe es zwei Wahrheiten über dieselbe Sache.
    await expect(rail(row)).toBeVisible()
    expect(await rail(row).getAttribute('aria-hidden')).toBe('true')

    // ── derselbe Knoten, jetzt gelesen ────────────────────────────────────────
    await page.getByRole('button', { name: 'Alles als gelesen markieren' }).click()
    await expect(page.getByText('Alles als gelesen markiert.')).toBeVisible({ timeout: 20_000 })

    const readRow = roomRow(page, room.name)
    await expect
        .poll(async () => (await readRow.getAttribute('aria-label')) ?? '', { timeout: 25_000 })
        .not.toContain(UNREAD_PREFIX)
    const readLabel = (await readRow.getAttribute('aria-label')) as string
    console.log(`[anker7] gelesen:  "${readLabel}"`)
    expect(readLabel, 'die gelesene Zeile beginnt mit dem Kontext').toMatch(new RegExp(`^${room.name}\\. `))
    await expect(readRow, 'gelesene Zeile bleibt 24 h stehen — sie darf nicht verschwinden').toContainText(marker)
    // Die Rail hängt an `x-show`, bleibt also im DOM. Geprüft wird die Sichtbarkeit:
    // sie ist die optische Hälfte derselben Aussage, die das Label hörbar macht.
    await expect(rail(readRow), 'gelesene Zeile darf keine Ungelesen-Rail zeigen').toBeHidden()
})

/**
 * ANKER 8 — die Zahlen-Sperre (P6) hält, gemessen am gerenderten Text.
 *
 * **Abweichung von der Vorgabe, mit Begründung.** Verlangt war „kein sichtbarer Knoten
 * matcht `/\d+\s*(ungelesen|neu)/i`". Der `neu`-Teil ist am realen Baum unerfüllbar und
 * wäre kein Schutz, sondern ein Fehlalarm: die Zeilen-Titelzeile lautet nach
 * `design-konzept.md` §3.2/§3.3 ausdrücklich „Alice · 3 neue Nachrichten" (gebaut in
 * `updates.ts buildItem` über `plural(count, …)`). Diese Zahl ist keine Badge-
 * Behauptung, sondern die Beschriftung der Zeile, die man unmittelbar darunter
 * nachzählen kann.
 *
 * Geprüft wird deshalb, was die Sperre wirklich meint, an fünf Stellen:
 *   1. Kein sichtbarer Knoten trägt eine Zahl mit dem Etikett „ungelesen".
 *   2. Der Ungelesen-MARKER selbst ist ein Punkt: das Marker-Element ist textlos. Genau
 *      hier bräche ein Zahlen-Badge zuerst durch — es wäre derselbe Knoten mit Inhalt.
 *   3. Auf `/updates` existiert überhaupt kein badge-förmiger Zahlenknoten (dort gibt es
 *      keine Bestandszahlen, die Aussage ist also scharf).
 *   4. Die Glocke trägt keinen sichtbaren Text — der Zustand steckt im `aria-label`.
 *   5. Der Untertitel zählt gerenderte Zeilen („N Hinweise"), nie Ungelesenes.
 *
 * **Nicht geprüft, und warum:** auf `/spaces` stehen badge-förmige Zahlen (gemessen:
 * „29"/„2" in den Tab-Pillen „Räume"/„Threads", „11"/„2" in der Meta-Zeile der
 * Thread-Liste). Das sind BESTANDSzahlen, vom Plan ausdrücklich als Absicht benannt;
 * sie sind am gerenderten Text nicht von einem Ungelesen-Badge zu unterscheiden. Eine
 * pauschale Badge-Sperre auf `/spaces` wäre deshalb ein Fehlalarm — die Zahlen werden
 * protokolliert, nicht verboten.
 *
 * Zu §9/13 („genau eine aria-live-Region auf /spaces"): am realen Baum sind es mehrere,
 * alle vorbestehend. Ein Test gegen die Anzahl wäre sofort rot und schützte nichts —
 * geprüft wird stattdessen, dass KEINE aria-live-Region einen Ungelesen-Zähler trägt.
 */
test('Anker 8: keine Ungelesen-Zahl auf /updates und /spaces (P6-Sperre)', async ({ page }) => {
    test.setTimeout(120_000)

    const room = makeRoom()
    await login(page)
    await expect(page.getByRole('button', { name: new RegExp(room.name) })).toBeVisible({ timeout: 25_000 })
    publishMessage(room.h, `Zahl-${rnd()}`)
    publishMessage(room.h, `Zahl-${rnd()}`) // zwei ⇒ die Zeile aggregiert, ein Badge hätte hier „2" gezeigt

    /** Sichtbare Blatt-Texte des Dokuments (kein `sr-only`, keine leeren Knoten). */
    const visibleTexts = (p: Page): Promise<string[]> =>
        p.evaluate(() =>
            [...document.querySelectorAll('body *')]
                .filter((el) => el.children.length === 0)
                .filter((el) => {
                    const st = getComputedStyle(el)
                    const rect = el.getBoundingClientRect()
                    return st.display !== 'none' && st.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
                })
                .map((el) => (el.textContent ?? '').trim())
                .filter(Boolean),
        )

    const liveTexts = (p: Page): Promise<string[]> =>
        p.evaluate(() => [...document.querySelectorAll('[aria-live], [role=status], [role=alert]')].map((el) => (el.textContent ?? '').trim()))

    await openUpdates(page)
    await expect(roomRow(page, room.name)).toBeVisible({ timeout: 30_000 })

    for (const path of ['/updates', '/spaces']) {
        if (path === '/spaces') {
            await updatesBack(page).click()
            await expect(page).toHaveURL(/\/spaces/, { timeout: 25_000 })
            await expect(page.getByRole('button', { name: new RegExp(room.name) })).toBeVisible({ timeout: 30_000 })
        }
        await page.waitForTimeout(1500) // Store-Emits/Throttle ausrechnen lassen

        const texts = await visibleTexts(page)
        const counted = texts.filter((t) => /\d+\s*ungelesen/i.test(t))
        expect(counted, `${path}: Ungelesen-ZAHL im sichtbaren Text — P6 ist gesperrt (${counted.join(' | ')})`).toEqual([])

        const badges = texts.filter((t) => /^(\d{1,3}|9\+|99\+)$/.test(t))
        console.log(`[anker8] ${path}: badge-förmige Knoten: ${badges.length ? badges.join(', ') : 'keine'}`)
        if (path === '/updates') {
            // Scharf, weil `/updates` keine Bestandszahlen kennt (siehe Docstring).
            expect(badges, `/updates: badge-förmiger Zahlenknoten gefunden (${badges.join(', ')})`).toEqual([])
        }

        // Der Ungelesen-Marker ist ein PUNKT — textlos. Ein Zahlen-Badge wäre derselbe
        // Knoten mit Inhalt; das ist die Stelle, an der P6 zuerst durchbräche.
        const dots = await page.locator('span.size-2.rounded-full').all()
        const dotTexts = await Promise.all(dots.map((d) => d.textContent()))
        console.log(`[anker8] ${path}: ${dots.length} Ungelesen-Marker, Inhalte: ${JSON.stringify(dotTexts)}`)
        for (const t of dotTexts) {
            expect((t ?? '').trim(), `${path}: der Ungelesen-Marker trägt Text statt nur ein Punkt zu sein`).toBe('')
        }
        if (path === '/spaces') {
            // Ohne einen einzigen Marker prüfte die Zeile darüber nichts.
            expect(dots.length, 'kein Ungelesen-Marker sichtbar — die Punkt-Prüfung liefe leer').toBeGreaterThan(0)
        }

        const live = await liveTexts(page)
        const liveCounters = live.filter((t) => /\d+\s*(ungelesen|neu)/i.test(t))
        console.log(`[anker8] ${path}: ${live.length} aria-live/status-Regionen, davon mit Zähler: ${liveCounters.length}`)
        expect(liveCounters, `${path}: aria-live-Region trägt einen Ungelesen-Zähler`).toEqual([])
    }

    // Die Glocke selbst trägt keinen Zähler — der Zustand steckt im aria-label
    // („Neu, ungelesene Nachrichten"), also im NAMEN, nicht in einer Ziffer.
    const bellText = ((await bell(page).textContent()) ?? '').trim()
    console.log(`[anker8] Glocken-Label: "${await bell(page).getAttribute('aria-label')}" · sichtbarer Text: "${bellText}"`)
    expect(bellText, 'die Glocke darf keinen sichtbaren Zähler tragen').toBe('')

    // Der Untertitel zählt gerenderte Zeilen, nicht Ungelesenes.
    await openUpdates(page)
    await expect(roomRow(page, room.name)).toBeVisible({ timeout: 30_000 })
    const subtitle = (await page.locator('header span.text-xs').first().textContent())?.trim() ?? ''
    console.log(`[anker8] Untertitel: "${subtitle}"`)
    expect(subtitle).toMatch(/^(Alles gelesen|1 Hinweis|\d+ Hinweise)$/)
})

/**
 * ANKER 9 — Geometrie, gemessen statt gerechnet (§9/4, 5, 8).
 *
 * Die Sollwerte des Design-Strangs sind aus Tokens abgeleitet; in diesem Projekt lagen
 * gerechnete Werte dreimal in Folge zu optimistisch. Hier stehen deshalb nur
 * `getBoundingClientRect`-Messungen am gerenderten Baum.
 */
test('Anker 9: Zeilenhöhe ≥ 76 px, Glocke ≥ 44×44, kein Querlauf bei 320 px', async ({ page }) => {
    test.setTimeout(120_000)

    const room = makeRoom()
    await login(page)
    await expect(page.getByRole('button', { name: new RegExp(room.name) })).toBeVisible({ timeout: 25_000 })
    publishMessage(room.h, `Geometrie-${rnd()} — eine Zeile mit genug Text, damit der Snippet zwei Zeilen füllt.`)

    // ── Glocke auf /spaces ────────────────────────────────────────────────────
    await expect(bell(page)).toBeVisible({ timeout: 25_000 })
    const bellBox = (await bell(page).boundingBox()) as { width: number; height: number }
    console.log(`[anker9] Glocke: ${bellBox.width}×${bellBox.height} px`)
    expect(bellBox.width, 'Glocke unter 44 px breit (WCAG 2.5.8)').toBeGreaterThanOrEqual(44)
    expect(bellBox.height, 'Glocke unter 44 px hoch (WCAG 2.5.8)').toBeGreaterThanOrEqual(44)

    // ── Zeilenhöhe auf /updates ───────────────────────────────────────────────
    await openUpdates(page)
    await expect(roomRow(page, room.name)).toBeVisible({ timeout: 30_000 })
    const heights = await rows(page).evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height))
    console.log(`[anker9] Zeilenhöhen: ${heights.map((h) => Math.round(h)).join(', ')}`)
    expect(heights.length, 'ohne Zeile misst der Anker nichts').toBeGreaterThan(0)
    for (const h of heights) {
        expect(h, `Zeile unter 76 px hoch (${Math.round(h)})`).toBeGreaterThanOrEqual(76)
    }

    // ── 320 px: kein horizontaler Überlauf (WCAG 1.4.10) ──────────────────────
    // Erst /updates messen (wir stehen dort), dann per Kopf-Pfeil auf /spaces —
    // beides warm, damit die Liste auch bei 320 px gefüllt bleibt.
    await page.setViewportSize({ width: 320, height: 720 })
    for (const path of ['/updates', '/spaces']) {
        if (path === '/spaces') {
            await updatesBack(page).click()
            await expect(page).toHaveURL(/\/spaces/, { timeout: 25_000 })
        }
        await expect(page.getByRole('heading').first()).toBeVisible({ timeout: 25_000 })
        await page.waitForTimeout(1000)
        const overflow = await page.evaluate(() => ({
            scrollWidth: document.documentElement.scrollWidth,
            clientWidth: document.documentElement.clientWidth,
        }))
        console.log(`[anker9] ${path} @320px: scrollWidth=${overflow.scrollWidth} clientWidth=${overflow.clientWidth}`)
        expect(overflow.scrollWidth, `${path} läuft bei 320 px quer über`).toBeLessThanOrEqual(overflow.clientWidth)
    }
})

/**
 * ANKER 10 — der zweite Leerzustand: leer NACH Filter ist ein anderer Zustand als
 * „nichts gewesen" (§3.5).
 *
 * Der Unterschied ist keine Kosmetik: der erste sagt „alles gelesen", der zweite muss
 * den Ausweg zeigen (zurück auf „Alle"), sonst sitzt der Nutzer in einem Filter fest,
 * den er nicht als Ursache erkennt.
 *
 * Voraussetzung ist eine Liste MIT Zeilen, aber OHNE Erwähnung. Erwähnungen entstehen
 * ausschließlich aus `nostr:npub…` im Text einer FREMDEN Nachricht; diese Datei
 * publiziert keine, und die Bestands-Specs schreiben ihre Mentions als der eingeloggte
 * Nutzer selbst (eigene Ereignisse zählen nie). Die Vorbedingung wird trotzdem
 * protokolliert, damit ein späterer Fehlschlag sofort zuzuordnen ist.
 */
test('Anker 10: leer nach Filter zeigt den Ausweg, nicht den Nullzustand', async ({ page }) => {
    test.setTimeout(120_000)

    const room = makeRoom()
    await login(page)
    await expect(page.getByRole('button', { name: new RegExp(room.name) })).toBeVisible({ timeout: 25_000 })
    publishMessage(room.h, `Filter-${rnd()}`)

    await openUpdates(page)
    await expect(roomRow(page, room.name)).toBeVisible({ timeout: 30_000 })
    console.log(`[anker10] Zeilen vor dem Filter: ${await rows(page).count()}`)

    await page.getByRole('tab', { name: 'Erwähnungen' }).click()
    await expect(page.getByText('Keine Erwähnungen in den letzten 30 Tagen.')).toBeVisible({ timeout: 20_000 })
    // Der Nullzustand darf hier ausdrücklich NICHT stehen — sonst wären beide Zustände
    // dasselbe und der Filter bliebe als Ursache unsichtbar. Beide Zustände hängen im
    // SELBEN Wrapper an `isFiltered()` / `!isFiltered()`; ein invertiertes `isFiltered()`
    // bliebe ohne diese Gegenprobe unbemerkt, weil oben trotzdem etwas stünde.
    await expect(page.getByText('Alles gelesen.', { exact: true })).toBeHidden()
    await expect(page.getByText('Neue Nachrichten aus deinen Räumen erscheinen hier.')).toBeHidden()
    await expect(page.getByRole('link', { name: 'Zu den Räumen' })).toBeHidden()

    // Auch der KOPF darf hier nicht „Alles gelesen" behaupten: es gibt Ungelesenes,
    // es passt nur nicht zum Filter — sonst stünde die Entwarnung direkt neben dem
    // „Alles"-Knopf, der genau dann noch etwas zu tun hätte.
    const filteredSubtitle = (await page.locator('header span.text-xs').first().textContent())?.trim() ?? ''
    console.log(`[anker10] Untertitel im leeren Filter: "${filteredSubtitle}"`)
    expect(filteredSubtitle, 'Untertitel widerspricht dem Zustand').not.toBe('Alles gelesen')

    const back = page.getByRole('button', { name: 'Alle anzeigen' })
    await expect(back).toBeVisible()
    await back.click()
    await expect(roomRow(page, room.name)).toBeVisible({ timeout: 20_000 })
})

/**
 * ANKER 11 — „Alles gelesen" ist umkehrbar, auch nach einem ZWEITEN Tap (M1), und der
 * Knopf hängt am Ungelesen-ZUSTAND, nicht an „Liste nicht leer".
 *
 * Der Doppeltap ist kein Laborfall: gelesene Zeilen bleiben 24 h stehen, die Liste ist
 * nach dem Quittieren also nicht leer — und sobald eine neue fremde Nachricht eintrifft,
 * steht der Knopf wieder da, WÄHREND die Undo-Frist noch läuft. Puffert der zweite Klick
 * den Zustand NACH dem ersten, führt „Rückgängig" auf einen Stand, in dem bereits alles
 * quittiert ist: die Wasserzeichen sind dauerhaft weg, der Knopf reagiert und tut nichts.
 *
 * Zwei Zusagen in einem Test, weil sie dieselbe Sequenz brauchen:
 *   a) `undoSnapshotFor(buffered, fresh) => buffered ?? fresh` — Rückgängig führt auf den
 *      Stand vor dem ERSTEN Klick.
 *   b) `x-show="hasUnread()"` am Knopf. Diese Bindung lebt allein im Blade und ist von
 *      KEINEM Node-Test gedeckt — ein Zurückdrehen auf `hasAny()` bliebe auf Modulebene
 *      vollständig grün. Der Anker ist die einzige Stelle, die sie hält.
 *
 * **Zwei Räume, und das ist nicht beliebig.** Die erste Fassung legte beide Nachrichten
 * in DENSELBEN Raum — und blieb unter der zurückgedrehten Mutation grün: `message`-Zeilen
 * aggregieren pro Raum, die zweite (frische) Nachricht machte die gemeinsame Zeile auch
 * dann ungelesen, wenn „Rückgängig" nur bis zum Stand NACH dem ersten Klick zurückführte.
 * Erst getrennte Räume trennen die Fälle: Zeile X (vor Tap 1) kehrt ausschließlich beim
 * korrekten Puffer zurück, Zeile Y (nach Tap 1) ist in beiden Fällen ungelesen.
 */
test('Anker 11: zweiter Tap auf „Alles" zerstört das Rückgängig nicht — Knopf hängt an hasUnread()', async ({ page }) => {
    test.setTimeout(150_000)

    const roomX = makeRoom() // trägt die Nachricht VOR dem ersten Tap
    const roomY = makeRoom() // trägt die Nachricht NACH dem ersten Tap
    await login(page)
    await expect(page.getByRole('button', { name: new RegExp(roomX.name) })).toBeVisible({ timeout: 25_000 })
    await expect(page.getByRole('button', { name: new RegExp(roomY.name) })).toBeVisible({ timeout: 25_000 })
    publishMessage(roomX.h, `Undo-A-${rnd()}`)

    await openUpdates(page)
    const rowA = roomRow(page, roomX.name)
    await expect(rowA).toBeVisible({ timeout: 30_000 })
    expect((await rowA.getAttribute('aria-label')) ?? '').toContain(UNREAD_PREFIX)

    const allesKnopf = page.getByRole('button', { name: 'Alles als gelesen markieren' })
    await expect(allesKnopf, 'mit Ungelesenem muss der Knopf stehen').toBeVisible()

    // ── 1. Tap ───────────────────────────────────────────────────────────────
    const t0 = Date.now()
    await allesKnopf.click()
    await expect(page.getByText('Alles als gelesen markiert.')).toBeVisible({ timeout: 20_000 })
    // (b) Nichts mehr ungelesen ⇒ der Knopf verschwindet. Hinge er weiter an `hasAny()`,
    // stünde er hier — die Liste ist NICHT leer (gelesene Zeilen bleiben 24 h).
    await expect(rowA, 'die gelesene Zeile muss stehen bleiben — sonst prüft (b) nichts').toBeVisible()
    await expect(allesKnopf, 'ohne Ungelesenes darf der Knopf nicht mehr stehen (hasUnread, nicht hasAny)').toBeHidden({ timeout: 20_000 })

    // ── neue fremde Nachricht ⇒ der Knopf kommt zurück, Frist läuft noch ──────
    // Die Sekundengrenze ist hier nicht optional: `markAllRead()` hat das `all`-
    // Wasserzeichen gerade auf die laufende Sekunde gesetzt; eine in DERSELBEN Sekunde
    // publizierte Nachricht gälte korrekt als gelesen und der Knopf bliebe weg.
    await awaitNextSecond(page)
    publishMessage(roomY.h, `Undo-B-${rnd()}`)
    const rowB = roomRow(page, roomY.name)
    await expect(rowB, 'die zweite Nachricht muss als EIGENE Zeile ankommen').toBeVisible({ timeout: 25_000 })
    await expect(allesKnopf, 'neues Ungelesenes ⇒ Knopf wieder da').toBeVisible({ timeout: 25_000 })
    // Ohne laufende Frist wäre der zweite Tap kein Doppeltap und der Test bewiese nichts.
    await expect(page.getByText('Alles als gelesen markiert.'), 'Undo-Frist bereits abgelaufen — Sequenz nicht mehr aussagekräftig').toBeVisible()
    console.log(`[anker11] zweiter Tap ${Date.now() - t0} ms nach dem ersten (Frist: 10 000 ms)`)

    // ── 2. Tap ───────────────────────────────────────────────────────────────
    await allesKnopf.click()
    await expect(allesKnopf).toBeHidden({ timeout: 20_000 })
    await expect
        .poll(async () => (await rowA.getAttribute('aria-label')) ?? '', { timeout: 20_000 })
        .not.toContain(UNREAD_PREFIX)

    // ── Rückgängig ⇒ Stand vor dem ERSTEN Tap ────────────────────────────────
    // KERN: Zeile X. Führte „Rückgängig" nur auf den Stand NACH dem ersten Tap zurück
    // (gepuffert wurde dann der falsche Schnappschuss), bliebe sie gelesen — Zeile Y
    // wäre in beiden Fällen ungelesen und verriete den Unterschied nicht.
    await page.getByRole('button', { name: 'Rückgängig' }).click()
    await expect
        .poll(async () => (await rowA.getAttribute('aria-label')) ?? '', { timeout: 25_000 })
        .toContain(UNREAD_PREFIX)
    await expect(rail(rowA), 'die zurückgeholte Zeile trägt ihre Rail wieder').toBeVisible()
    await expect(allesKnopf, 'mit zurückgeholtem Ungelesenem steht auch der Knopf wieder').toBeVisible({ timeout: 20_000 })
    console.log(`[anker11] nach Rückgängig — Zeile X: "${await rowA.getAttribute('aria-label')}"`)
    console.log(`[anker11] nach Rückgängig — Zeile Y: "${await rowB.getAttribute('aria-label')}"`)
})

/**
 * ANKER 12 — der Rückweg aus einem geteilten THREAD-Link (M2), im frischen Tab.
 *
 * Dieser Pfad ist über die laufende App NICHT prüfbar: dort hat der Tab den
 * `appNav`-Marker, `backFromRoom` nimmt `history.back()` und trifft `/updates`
 * zufällig richtig. Der Defekt zeigt sich nur, wo es keinen Vorgänger gibt — geteilter
 * Link, Notification-Tap, frisch geöffneter Tab. Deshalb ein **eigener Browser-Kontext**
 * (leerer `sessionStorage`, eigene History) statt eines `goto` im laufenden.
 *
 * Die Asymmetrie trägt den Befund und steht deshalb im selben Test: über eine RAUM-Zeile
 * funktionierte der Rückweg schon immer, über eine THREAD-Zeile nicht — weil
 * `backFromThread()` beim deep-gemounteten Thread (`_threadPrevUrl === null`) auf das
 * blanke `/rooms/{h}` zurückschrieb und die Herkunft dabei wegschnitt.
 */
test('Anker 12: geteilter Thread-Link im frischen Tab — zweimal Zurück landet in /updates', async ({ browser, baseURL }) => {
    test.setTimeout(180_000)

    const room = makeRoom()
    const rootId = publishMessage(room.h, `Geteilt-${rnd()}`)
    publishComment(room.h, rootId, `GeteiltAntwort-${rnd()}`)
    const nevent = neventEncode({ id: rootId, relays: [ZOOID_URL], author: ADMIN_PUB })

    const context = await browser.newContext({ baseURL })
    try {
        const fresh = await context.newPage()
        await spyHistoryBack(fresh)
        await useZooid(fresh)
        await loginNsec(fresh, NSEC)

        // ── a) THREAD-Link ────────────────────────────────────────────────────
        await fresh.goto(`/rooms/${room.h}/thread/${nevent}?from=updates`)
        expect(
            await fresh.evaluate(() => sessionStorage.getItem('appNav')),
            'Vorbedingung verletzt: dieser Tab hat einen App-Vorgänger, der Fall wäre nicht der geteilte Link',
        ).toBeNull()
        await expect(fresh.getByRole('dialog', { name: 'Thread' })).toBeVisible({ timeout: 30_000 })
        const before = await backCalls(fresh)

        await fresh.getByRole('button', { name: 'Zurück' }).click()
        await expect(fresh).toHaveURL(new RegExp(`/rooms/${room.h}\\?`), { timeout: 25_000 })
        const middle = new URL(fresh.url())
        console.log(`[anker12] Zwischenstation: ${middle.pathname}${middle.search}`)
        expect(middle.pathname).toBe(`/rooms/${room.h}`)
        expect(
            middle.searchParams.get('from'),
            'die Herkunft überlebt den Thread-Abbau nicht — der nächste Pfeil fällt auf /spaces',
        ).toBe('updates')

        await fresh.getByRole('button', { name: 'Zurück' }).click()
        await expect(fresh).toHaveURL(/\/updates$/, { timeout: 25_000 })
        expect((await backCalls(fresh)) - before, 'im frischen Tab darf kein history.back() fallen').toBe(0)

        // ── b) Kontrast: RAUM-Link im selben frischen Tab ─────────────────────
        await fresh.goto(`/rooms/${room.h}?from=updates`)
        await fresh.evaluate(() => sessionStorage.removeItem('appNav'))
        await expect(fresh.getByRole('heading', { name: `# ${room.name}` })).toBeVisible({ timeout: 25_000 })
        const beforeRoom = await backCalls(fresh)
        await fresh.getByRole('button', { name: 'Zurück' }).click()
        await expect(fresh).toHaveURL(/\/updates$/, { timeout: 25_000 })
        expect((await backCalls(fresh)) - beforeRoom).toBe(0)
        console.log('[anker12] Raum-Link führt ebenfalls nach /updates — die Asymmetrie ist geschlossen')
    } finally {
        await context.close()
    }
})

/**
 * ANKER 13 — die verwaiste Zeile bleibt STEHEN, führt aber nirgendwohin (§8).
 *
 * **Der Zustand wird im Harness erzeugt, und das ist hier keine Bequemlichkeit.** Über
 * die App ist er nicht herstellbar: `joined` und `roomNames` kommen aus DERSELBEN
 * Projektion (`joinedRoomHs`/`joinedRoomNames`, `js/bridge.ts:1042/1051`, beide auf
 * `activeSpaceView.userRooms` derived), ihre Schlüsselmengen sind also stets identisch —
 * und `displayRoom()` fällt ohnehin auf `h` zurück, ein leerer Name entsteht dort nie.
 * Ein Ereignis ohne Namen wird deshalb schon von Regel 5 übersprungen, bevor „verwaist"
 * greifen könnte. Gemeldet; hier geprüft wird folglich genau das, was auch bei künftig
 * anderer Verdrahtung tragen muss: dass die VIEW ein `orphan`-Item beidseitig sperrt.
 *
 * Injiziert wird in `items` der Insel (Präzedenzfall: die Store-Attrappe in
 * `unread-dot.spec.ts` Anker 4B). `toPass` wiederholt die Injektion, falls ein
 * Store-Emit sie überschreibt — die Ableitung schreibt dasselbe Feld.
 */
test('Anker 13: verwaiste Zeile ist deaktiviert und navigiert auch programmatisch nicht', async ({ page }) => {
    test.setTimeout(120_000)

    const room = makeRoom()
    await login(page)
    await expect(page.getByRole('button', { name: new RegExp(room.name) })).toBeVisible({ timeout: 25_000 })
    publishMessage(room.h, `Waise-${rnd()}`)
    await openUpdates(page)
    await expect(roomRow(page, room.name)).toBeVisible({ timeout: 30_000 })

    const ORPHAN_LABEL = 'Unbekannter Raum. Nachricht nicht mehr verfügbar. verwaister Inhalt. gerade eben'
    const inject = () =>
        page.evaluate((label) => {
            const alpine = (window as unknown as { Alpine: { $data: (e: Element) => Record<string, unknown> } }).Alpine
            const el = document.querySelector('[x-data="nostrUpdates"]') as Element
            const data = alpine.$data(el) as { items: unknown[]; _unsubItems?: () => void; _unsubActive?: () => void }
            // Die Ableitung STILLLEGEN, bevor injiziert wird: sie schreibt dasselbe Feld
            // und überschreibt die Attrappe beim nächsten Emit (throttle 300 ms) — ein
            // Rennen, das der Test verlieren kann und einmal verloren HAT. Was hier
            // geprüft wird, ist reine View-Verdrahtung (`:disabled` + der Riegel in
            // `open()`); die Ableitung trägt dazu nichts bei.
            data._unsubItems?.()
            data._unsubActive?.()
            data.items = [
                {
                    key: 'message:waise',
                    type: 'message',
                    context: 'Unbekannter Raum',
                    title: 'Nachricht nicht mehr verfügbar',
                    snippet: 'verwaister Inhalt',
                    timeLabel: 'gerade eben',
                    picture: '',
                    authorName: 'Unbekannt',
                    pubkey: '00',
                    h: 'nichtda',
                    rootId: '',
                    href: '/rooms/nichtda?from=updates',
                    ts: Math.floor(Date.now() / 1000),
                    bucket: 'today',
                    unread: false,
                    count: 1,
                    orphan: true,
                },
            ]
            void label
        }, ORPHAN_LABEL)

    const orphanRow = page.getByRole('button', { name: ORPHAN_LABEL, exact: true })
    await expect(async () => {
        await inject()
        await expect(orphanRow).toBeVisible()
    }).toPass({ timeout: 30_000 })

    // Zusage 1: die Zeile bleibt STEHEN (sie verschwindet nicht) …
    await expect(orphanRow).toBeVisible()
    // … ist aber inaktiv.
    await expect(orphanRow, 'verwaiste Zeile muss disabled sein').toBeDisabled()

    // Zusage 2: der zweite Riegel in `open()`. Ein disabled <button> erzeugt vom Browser
    // aus gar kein Click-Event — der Weg über Tastatur/AT/Programm schon. Genau den
    // stellt `dispatchEvent` nach: kommt der Handler durch, darf er trotzdem nicht
    // navigieren.
    const urlBefore = page.url()
    await orphanRow.dispatchEvent('click')
    await page.waitForTimeout(2000)
    console.log(`[anker13] URL vor/nach dem erzwungenen Klick: ${urlBefore} / ${page.url()}`)
    expect(page.url(), 'verwaiste Zeile hat trotz orphan navigiert').toBe(urlBefore)
})

/**
 * ANKER 14 — der KALTE Direkteinstieg zeigt dasselbe wie der Weg über die Glocke (B1).
 *
 * Die Ladeentscheidung, die das trägt (`nostrUpdates` abonniert selbst
 * `watchSpaceRooms`), ist ein Seiteneffekt auf einem welshman/Browser-Pfad ohne
 * prüfbare Rückgabe — node-testbar ist sie nicht. Ein Zurückdrehen bliebe auf
 * Modulebene vollständig grün; dieser Anker ist die einzige Stelle, die sie hält.
 *
 * **Nur der EREIGNIS-Cache wird gelöscht, niemals `einundzwanzig-readstate-<pk>`.**
 * Diese Unterscheidung ist der ganze Trick: wer die Lesestand-DB mitlöscht, fabriziert
 * einen frischen Account — `initReadState()` setzt `all = jetzt`, `loadRoomActivity`
 * fragt mit `since = jetzt+1`, und die Liste bliebe leer aus einem Grund, der mit dem
 * Ladeweg nichts zu tun hat. Der Test würde dann einen Defekt „belegen", den es nicht
 * gibt. Dass der Lesestand den Kaltstart überlebt hat, wird deshalb ausdrücklich
 * mitgemessen (`all` vorher == nachher).
 *
 * Gelöscht wird in einem `addInitScript`, also VOR dem Seiten-Skript und nach dem
 * Entladen der vorigen Seite — nur dann hält niemand mehr eine Verbindung, und
 * `deleteDatabase` läuft durch statt in `blocked` zu hängen. Genau das wird geprüft:
 * ein `blocked` würde einen NICHT kalten Cache bedeuten und den Anker falsch-positiv
 * machen.
 */
test('Anker 14: kalter Direkteinstieg auf /updates zeigt dieselbe Zeile wie die Glocke', async ({ page }) => {
    test.setTimeout(150_000)

    const room = makeRoom()
    await login(page)
    await expect(page.getByRole('button', { name: new RegExp(room.name) })).toBeVisible({ timeout: 25_000 })
    const marker = `Kalt-${rnd()}`
    publishMessage(room.h, marker)

    // ── warm: über die Glocke ────────────────────────────────────────────────
    await openUpdates(page)
    const warmRow = roomRow(page, room.name)
    await expect(warmRow).toBeVisible({ timeout: 30_000 })
    const warmLabel = (await warmRow.getAttribute('aria-label')) as string
    console.log(`[anker14] warm : "${warmLabel}"`)

    // Ausgangslage belegen: der Ereignis-Cache ist gefüllt (sonst löschte der nächste
    // Schritt nichts und „kalt" wäre nur ein Wort).
    const cachedBefore = await page.evaluate(async () => {
        const dbs = await indexedDB.databases()
        const name = dbs.map((d) => d.name).find((n) => n?.startsWith('einundzwanzig-cache-'))
        if (!name) {
            return -1
        }
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
            const req = indexedDB.open(name)
            req.onsuccess = () => resolve(req.result)
            req.onerror = () => reject(req.error)
        })
        try {
            if (!db.objectStoreNames.contains('events')) {
                return 0
            }
            return await new Promise<number>((resolve, reject) => {
                const req = db.transaction('events', 'readonly').objectStore('events').count()
                req.onsuccess = () => resolve(req.result)
                req.onerror = () => reject(req.error)
            })
        } finally {
            db.close()
        }
    })
    console.log(`[anker14] Ereignisse im Cache vor dem Kaltstart: ${cachedBefore}`)
    expect(cachedBefore, 'ohne gefüllten Cache belegt der Kaltstart nichts').toBeGreaterThan(0)

    const readStateWarm = await readStateAll(page)
    expect(readStateWarm, 'ohne Lesestand wäre der Vergleich wertlos').toBeGreaterThan(0)

    // ── kalt: Ereignis-Cache weg, direkter Aufruf ────────────────────────────
    await page.addInitScript(() => {
        const w = window as unknown as { __cacheDrop: string[] }
        w.__cacheDrop = []
        void (async () => {
            for (const { name } of await indexedDB.databases()) {
                // NUR der Ereignis-Cache. Die Lesestand-DB bleibt unangetastet.
                if (!name || !name.startsWith('einundzwanzig-cache-')) {
                    continue
                }
                const req = indexedDB.deleteDatabase(name)
                req.onsuccess = () => w.__cacheDrop.push(`success:${name}`)
                req.onblocked = () => w.__cacheDrop.push(`blocked:${name}`)
                req.onerror = () => w.__cacheDrop.push(`error:${name}`)
            }
        })()
    })

    await page.goto('/updates')
    await expect(page.getByRole('heading', { name: 'Neu', exact: true })).toBeVisible({ timeout: 25_000 })

    const coldRow = roomRow(page, room.name)
    try {
        await expect(coldRow, 'kalter Direkteinstieg findet die Zeile nicht — die Raumliste wird nicht geladen').toBeVisible({ timeout: 45_000 })
    } catch (error) {
        // Diagnose statt Rätselraten: der Screen wartet nur `ROOM_LIST_WAIT_MS` (10 s)
        // auf die Mitgliedschaften und rechnet danach mit dem, was da ist. Unter voller
        // Parallellast kann das Relay länger brauchen — dann ist ein leerer Screen eine
        // Aussage über die FRIST, nicht über den Ladeweg. Die beiden Zahlen trennen das:
        //   joined = 0 → die Raumliste kam nicht (rechtzeitig) an,
        //   joined > 0, items = 0 → sie kam an, die Ableitung hängt woanders.
        const state = await page.evaluate(() => {
            const alpine = (window as unknown as { Alpine?: { $data: (e: Element) => Record<string, unknown>; store: (n: string) => unknown } }).Alpine
            const el = document.querySelector('[x-data="nostrUpdates"]')
            const data = alpine && el ? (alpine.$data(el) as { items?: unknown[]; loading?: boolean }) : null
            const unread = alpine ? (alpine.store('unread') as { rooms?: Record<string, boolean> } | null) : null
            return { items: data?.items?.length ?? -1, loading: data?.loading, joined: Object.keys(unread?.rooms ?? {}).length }
        })
        console.log(`[anker14] FEHLSCHLAG-Diagnose: joined=${state.joined} items=${state.items} loading=${state.loading}`)
        throw error
    }
    const coldLabel = (await coldRow.getAttribute('aria-label')) as string
    console.log(`[anker14] kalt : "${coldLabel}"`)

    const drop = await page.evaluate(() => (window as unknown as { __cacheDrop?: string[] }).__cacheDrop ?? [])
    console.log(`[anker14] Cache-Löschung: ${JSON.stringify(drop)}`)
    expect(drop.length, 'es wurde keine Cache-DB gelöscht — der Einstieg war gar nicht kalt').toBeGreaterThan(0)
    expect(
        drop.filter((d) => !d.startsWith('success:')),
        'eine Cache-DB blieb blockiert — der Cache war beim Boot noch da, der Anker wäre falsch-positiv',
    ).toEqual([])

    // Der Lesestand hat den Kaltstart überlebt: KEIN frisch fabrizierter Account.
    const readStateCold = await readStateAll(page)
    console.log(`[anker14] Lesestand all: warm ${readStateWarm} → kalt ${readStateCold}`)
    expect(readStateCold, 'die Lesestand-DB wurde mitgelöscht — dann prüfte der Anker den falschen Effekt').toBe(readStateWarm)

    // KERN: dieselbe Zeile. Zwei Bestandteile des Namens sind dabei ausgenommen, beide
    // aus gemessenem Grund — nicht, um den Vergleich weichzuspülen:
    //
    //   • das ZEIT-Label (letzter Abschnitt) altert zwischen den Messungen von
    //     „gerade eben" zu „vor 1 Min";
    //   • der AUTORNAME löst asynchron nach. `warmProfiles()` wird pro Emit gefeuert,
    //     ohne dass jemand darauf wartet; im Sammellauf reproduzierbar gemessen
    //     (2026-07-23): warm noch „npub1m2v…rz90g", kalt bereits „Relay Admin" — beides
    //     DIESELBE Zeile. Wer den Namen mitvergleicht, baut die Laufzeit eines fremden
    //     Profil-Ladewegs in einen Anker über die Raumliste ein und bekommt genau die
    //     Sorte Rot, die man nach drei Wochen wegklickt statt liest.
    //
    // Was übrig bleibt, trägt die Aussage vollständig: Raum (Kontext), Aggregat
    // („· N neue Nachricht(en)") und der Snippet-Marker.
    // Das Zustands-Präfix fällt ZUERST weg — sonst zielte die Autor-Regex auf den
    // Punkt hinter „Ungelesen." und schnitte ausgerechnet den Raumnamen mit heraus,
    // also die Größe, um die es hier geht. Der Zustand wird separat geprüft.
    const comparable = (label: string): string =>
        label
            .replace(new RegExp(`^${UNREAD_PREFIX}`), '')
            .replace(/\.\s[^.]*$/, '')
            .replace(/\.\s[^·]*·/, '. ·')
    console.log(`[anker14] vergleichbar — warm: "${comparable(warmLabel)}" · kalt: "${comparable(coldLabel)}"`)
    expect(comparable(coldLabel), 'kalt und warm zeigen nicht dieselbe Zeile').toBe(comparable(warmLabel))
    expect(coldLabel).toContain(marker)
    expect(coldLabel, 'auch kalt muss die Zeile ungelesen sein').toContain(UNREAD_PREFIX)
})

/**
 * ANKER 15 — die Zeile hat eine OBERGRENZE, nicht nur eine Untergrenze.
 *
 * Anker 9 prüft `height >= 76` und konnte deshalb nicht sehen, dass eine einzelne
 * Meldung den halben Bildschirm füllt: `line-clamp-2` kürzt den Snippet nur, wenn das
 * Element `display: -webkit-box` behält. Steht daneben ein `block`, gewinnt bei
 * gleicher Spezifität die später gebaute Regel — `-webkit-line-clamp` läuft dann ins
 * Leere, ohne dass irgendetwas fehlschlägt. Genau die Klasse Fehler, die eine
 * Untergrenze offen lässt.
 *
 * Gemessen wird deshalb dreifach, von der Ursache zur Wirkung:
 *   1. der berechnete `display` des Snippet-Elements (`-webkit-box`) + `webkitLineClamp`,
 *   2. seine gerenderte HÖHE bei einem Snippet weit jenseits zweier Zeilen,
 *   3. die Gesamthöhe der Zeile — bei 1280 px UND bei 320 px, wo der Defekt am
 *      teuersten war.
 * Dazu die Gegenprobe, dass wirklich gekürzt wird und nicht bloß wenig Text da ist:
 * `scrollHeight > clientHeight`, und der VOLLE Text steht weiterhin im DOM (das
 * Kürzen ist optisch, nicht inhaltlich — sonst verlöre das `aria-label` seine Quelle).
 *
 * Das Snippet-Element wird über seinen INHALT gesucht, nicht über eine Klasse: welche
 * Utility den Zuschnitt am Ende leistet, ist eine Implementierungsfrage, die dieser
 * Anker nicht festschreiben soll.
 */
const LONG_SNIPPET =
    'Dies ist eine absichtlich sehr lange Meldung, die weit über zwei Zeilen hinausgeht und deshalb gekürzt werden muss, ' +
    'damit eine einzelne Zeile der Liste nicht den halben Bildschirm einnimmt. Sie enthält keinerlei Zeilenumbrueche, ' +
    'sondern nur Fliesstext, damit die Kuerzung ausschliesslich an der CSS-Regel haengt und nicht an harten Umbruechen. ' +
    'Sie ist lang genug, dass sie auf einem 320-px-Viewport ohne Kuerzung ueber den gesamten sichtbaren Bereich liefe. ' +
    'Und sie endet mit einer eindeutigen Marke, damit der Test sie im Baum wiederfindet: '

/** Misst das Element, das den Snippet trägt — klassenunabhängig über den Inhalt. */
async function measureSnippet(
    row: ReturnType<typeof roomRow>,
    needle: string,
): Promise<{ height: number; scrollHeight: number; clientHeight: number; display: string; clamp: string; fullText: boolean }> {
    return row.evaluate((el, mark) => {
        const nodes = [...el.querySelectorAll('span')].filter(
            (n) => n.children.length === 0 && (n.textContent ?? '').includes(mark),
        )
        const target = nodes[nodes.length - 1]
        if (!target) {
            return { height: -1, scrollHeight: -1, clientHeight: -1, display: 'nicht gefunden', clamp: '', fullText: false }
        }
        const style = getComputedStyle(target)
        return {
            height: target.getBoundingClientRect().height,
            scrollHeight: target.scrollHeight,
            clientHeight: target.clientHeight,
            display: style.display,
            clamp: style.webkitLineClamp,
            fullText: (target.textContent ?? '').length > 400,
        }
    }, needle)
}

test('Anker 15: langer Snippet wird gekürzt — Zeile bleibt unter der Obergrenze', async ({ page }) => {
    test.setTimeout(150_000)

    const room = makeRoom()
    await login(page)
    await expect(page.getByRole('button', { name: new RegExp(room.name) })).toBeVisible({ timeout: 25_000 })
    const mark = `Lang-${rnd()}`
    publishMessage(room.h, LONG_SNIPPET + mark)

    await openUpdates(page)
    const row = roomRow(page, room.name)
    await expect(row).toBeVisible({ timeout: 30_000 })

    // ── 1280 px ──────────────────────────────────────────────────────────────
    const wide = await measureSnippet(row, mark)
    const wideRow = (await row.boundingBox())?.height ?? -1
    console.log(`[anker15] 1280px — Snippet ${Math.round(wide.height)} px (scroll ${wide.scrollHeight}/${wide.clientHeight}, display ${wide.display}, clamp ${wide.clamp}) · Zeile ${Math.round(wideRow)} px`)

    expect(wide.height, 'Snippet-Element nicht gefunden').toBeGreaterThan(0)
    expect(wide.fullText, 'der volle Text muss im DOM stehen — gekürzt wird optisch, nicht inhaltlich').toBe(true)
    /**
     * **Bewusst KEINE `display`-Assertion, in keiner Richtung.** Das gebaute CSS setzt
     * `display:-webkit-box` (im Bundle nachgelesen), Chromium meldet über
     * `getComputedStyle` aber `flow-root`. Und die naheliegende Gegenprobe trägt
     * genauso wenig: ich habe `block` in einer Mutationsprobe WIEDER EINGESETZT — die
     * Kappung blieb intakt (42 px, `clamp: 2`), obwohl `.block` im Bundle nach
     * `.line-clamp-2` steht. Ein Anker auf irgendeinen `display`-Wert prüfte hier also
     * die Engine, nicht die Anwendung, und wäre in beide Richtungen falsch.
     *
     * Der Wächter sind die HÖHEN und die Tatsache, dass überhaupt abgeschnitten wird.
     */
    expect(wide.clamp, 'die Kürzung soll bei zwei Zeilen greifen').toBe('2')
    expect(wide.scrollHeight, 'nichts wird abgeschnitten — dann prüft der Anker gar keine Kürzung').toBeGreaterThan(wide.clientHeight)
    expect(wide.height, `Snippet läuft über zwei Zeilen hinaus (${Math.round(wide.height)} px)`).toBeLessThanOrEqual(SNIPPET_MAX)
    expect(wideRow, `Zeile zu hoch (${Math.round(wideRow)} px)`).toBeLessThanOrEqual(ROW_MAX_WIDE)

    // ── 320 px: hier war der Defekt am teuersten (eine Meldung > ein Bildschirm) ──
    await page.setViewportSize({ width: 320, height: 720 })
    await expect(row).toBeVisible({ timeout: 20_000 })
    const narrow = await measureSnippet(row, mark)
    const narrowRow = (await row.boundingBox())?.height ?? -1
    console.log(`[anker15] 320px  — Snippet ${Math.round(narrow.height)} px · Zeile ${Math.round(narrowRow)} px (Viewport-Höhe 720)`)

    expect(narrow.height, `Snippet läuft bei 320 px über (${Math.round(narrow.height)} px)`).toBeLessThanOrEqual(SNIPPET_MAX)
    expect(narrowRow, `eine einzelne Zeile füllt bei 320 px zu viel Bildschirm (${Math.round(narrowRow)} px)`).toBeLessThanOrEqual(ROW_MAX_NARROW)
})

/**
 * ANKER 16 — eine Admin-Löschung erreicht den OFFENEN Screen (NIP-29 kind 9005).
 *
 * Der Kaltstart taugt dafür ausdrücklich NICHT: zooid entfernt das Ziel beim 9005
 * **serverseitig**, ein frischer Fetch bekommt die Nachricht ohnehin nie zurück — die
 * Zeile verschwände auch ohne jede Client-Logik. Diskriminierend ist allein der LIVE-
 * Fall: der Screen steht offen, die Nachricht liegt bereits im Repository, und nur
 * `watchRoomActivity` (`ROOM_DELETE_EVENT` im Filter + `onEvent: honorDeleteEvent`)
 * lässt sie dort verschwinden. Kind 9005 ist kein NIP-09-Tombstone; das Repository
 * räumt sein Ziel nicht von selbst weg.
 *
 * Der `window`-Sentinel ist der Kern des Beweises: überlebt er, hat die Seite weder neu
 * geladen noch die Insel getauscht — dann kann das Verschwinden nur aus der Live-Sub
 * stammen und nicht aus einem beiläufigen Neuaufbau.
 */
test('Anker 16: Admin-Löschung (9005) räumt die Zeile im offenen /updates ab', async ({ page }) => {
    test.setTimeout(150_000)

    const room = makeRoom()
    await login(page)
    await expect(page.getByRole('button', { name: new RegExp(room.name) })).toBeVisible({ timeout: 25_000 })

    const marker = `Loesch-${rnd()}`
    const messageId = publishMessage(room.h, marker)
    expect(messageId, 'ohne Event-id lässt sich nichts löschen').toMatch(/^[0-9a-f]{64}$/)

    await openUpdates(page)
    const row = roomRow(page, room.name)
    await expect(row, 'ohne sichtbare Zeile prüft das Löschen nichts').toBeVisible({ timeout: 30_000 })
    await expect(row).toContainText(marker)

    // Sentinel NACH dem Rendern, VOR der Löschung.
    await page.evaluate(() => {
        ;(window as unknown as { __warm?: number }).__warm = 1
    })

    // **Vorbedingung nachprüfbar machen, statt sie zu hoffen.** Das 9005 wirkt nur, wenn
    // die Live-Subscription (`watchRoomActivity`) bereits steht — sie wird asynchron
    // aufgebaut und braucht NIP-42-AUTH. Fällt das Löschereignis davor, sieht der Client
    // es nie und der Anker wäre unter Last rot, ohne dass am Produkt etwas falsch ist
    // (einmal gemessen: 49 s Timeout in einem Lauf, der insgesamt 1,1 min statt 25 s
    // brauchte). Bewiesen wird der Sub-Aufbau mit einer Nachricht in einem ZWEITEN Raum:
    // erscheint sie live, ist der Kanal offen. Der zweite Raum, damit die Zielzeile
    // unberührt bleibt — eine zweite Nachricht im selben Raum hielte sie am Leben.
    const probeRoom = makeRoom()
    const probeMarker = `Live-${rnd()}`
    publishMessage(probeRoom.h, probeMarker)
    await expect(
        roomRow(page, probeRoom.name),
        'die Live-Subscription steht nicht — ohne sie sagt das Löschen nichts aus',
    ).toBeVisible({ timeout: 45_000 })

    // Admin löscht live: kind 9005 mit `h` (Raum) + `e` (Ziel-Event).
    execFileSync(NAK, ['event', '--auth', '--sec', ADMIN, '-k', '9005', '-t', `h=${room.h}`, '-t', `e=${messageId}`, ZOOID_WS])

    // Der volle Text muss verschwinden — ohne die Live-Behandlung bliebe er stehen.
    await expect(page.getByText(marker, { exact: false }), 'gelöschter Inhalt steht weiter auf dem offenen Screen').toHaveCount(0, {
        timeout: 45_000,
    })
    await expect(row, 'die Zeile trug nur dieses eine Ereignis und muss mitgehen').toHaveCount(0, { timeout: 20_000 })

    expect(
        await page.evaluate(() => (window as unknown as { __warm?: number }).__warm),
        'die Seite hat neu geladen — dann wäre das Verschwinden kein Beweis für die Live-Sub',
    ).toBe(1)
})

/**
 * ANKER 17 — der Fokus wird nach jeder Aktion ÜBERGEBEN, nicht fallen gelassen (B3).
 *
 * Wer per Tastatur bedient, verliert nach einem Klick auf `BODY` seine Position und
 * beginnt die Seite von vorn. Die Übergaben liegen bewusst im Blade (`x-ref` +
 * `$nextTick`), nicht in der Insel — Fokus ist Ansicht, nicht Zustand. Auf Modulebene
 * ist davon nichts prüfbar; dieser Anker ist die einzige Absicherung.
 *
 * **Ohne das Warten wäre er flaky, und das ist gemessen, nicht befürchtet:** eine
 * Messung direkt nach dem Klick zeigt noch den QUELL-Knopf, obwohl die Übergabe
 * korrekt läuft — `focus()` steht hinter `$nextTick`, und das Ziel hängt an einem
 * `x-show`, das erst im selben Tick sichtbar wird. Deshalb hier immer erst
 * `toBeVisible()` auf das Ziel, dann `document.activeElement` lesen.
 */
const activeInfo = (page: Page): Promise<{ tag: string; label: string; text: string; tabindex: string }> =>
    page.evaluate(() => {
        const el = document.activeElement
        return {
            tag: el?.tagName ?? '(kein activeElement)',
            label: el?.getAttribute('aria-label') ?? '',
            text: (el?.textContent ?? '').trim().slice(0, 40),
            tabindex: el?.getAttribute('tabindex') ?? '',
        }
    })

test('Anker 17: Fokus wandert nach „Alles", „Rückgängig" und „Alle anzeigen" auf ein Ziel, nie auf BODY', async ({ page }) => {
    test.setTimeout(150_000)

    const room = makeRoom()
    await login(page)
    await expect(page.getByRole('button', { name: new RegExp(room.name) })).toBeVisible({ timeout: 25_000 })
    publishMessage(room.h, `Fokus-${rnd()}`)

    await openUpdates(page)
    await expect(roomRow(page, room.name)).toBeVisible({ timeout: 30_000 })

    const allesKnopf = page.getByRole('button', { name: 'Alles als gelesen markieren' })
    const undoKnopf = page.getByRole('button', { name: 'Rückgängig' })

    // ── 1) „Alles" → Undo-Knopf ──────────────────────────────────────────────
    await expect(allesKnopf).toBeVisible()
    await allesKnopf.click()
    await expect(undoKnopf, 'erst das Ziel sichtbar, dann messen — sonst misst man den Quellknopf').toBeVisible({ timeout: 20_000 })
    let active = await activeInfo(page)
    console.log(`[anker17] nach „Alles": <${active.tag}> label="${active.label}" text="${active.text}"`)
    expect(active.tag, 'Fokus auf BODY = verloren').not.toBe('BODY')
    expect(active.text, 'Fokus muss auf dem Rückgängig-Knopf liegen').toContain('Rückgängig')

    // ── 2) „Rückgängig" → „Alles"-Knopf ──────────────────────────────────────
    await undoKnopf.click()
    await expect(allesKnopf, 'nach dem Zurückholen gibt es wieder Ungelesenes ⇒ der Knopf steht').toBeVisible({ timeout: 20_000 })
    active = await activeInfo(page)
    console.log(`[anker17] nach „Rückgängig": <${active.tag}> label="${active.label}" text="${active.text}"`)
    expect(active.tag).not.toBe('BODY')
    expect(active.label, 'Fokus muss zurück auf den „Alles"-Knopf').toBe('Alles als gelesen markieren')

    // ── 3) „Alle anzeigen" (Filter-Leerzustand) → Listen-Container ───────────
    await page.getByRole('tab', { name: 'Erwähnungen' }).click()
    const zurueckKnopf = page.getByRole('button', { name: 'Alle anzeigen' })
    await expect(zurueckKnopf).toBeVisible({ timeout: 20_000 })
    await zurueckKnopf.click()
    // Ziel ist der Container, kein Knopf — gewartet wird auf die wiederhergestellte Liste.
    await expect(roomRow(page, room.name)).toBeVisible({ timeout: 20_000 })
    active = await activeInfo(page)
    console.log(`[anker17] nach „Alle anzeigen": <${active.tag}> tabindex="${active.tabindex}" text="${active.text.slice(0, 20)}…"`)
    expect(active.tag, 'Fokus auf BODY = verloren').not.toBe('BODY')
    expect(active.tag, 'der Auffang ist der Listen-Container').toBe('DIV')
    expect(active.tabindex, 'der Container fängt den Fokus per tabindex="-1"').toBe('-1')

    // ── 4) „Ältere anzeigen", LETZTER Klick → Listen-Container ───────────────
    //
    // Die Seitenlänge ist 30; für diesen Fall braucht es also >30 Zeilen. Die werden
    // hier INJIZIERT statt publiziert, und das ist eine bewusste Abwägung: 31 echte
    // Thread-Wurzeln blieben 24 h im geteilten Relay stehen und wüchsen mit jedem Lauf
    // — genau die Seed-Vergiftung, an der `spaces.spec.ts` gerade gescheitert ist. Was
    // hier geprüft wird, ist ohnehin reine ANSICHT (`x-ref="olderBtn"` → `$nextTick`
    // → Fokus), und die hängt nicht daran, woher die Zeilen kommen. Präzedenzfall:
    // `unread-dot.spec.ts` Anker 4B, hier schon in Anker 13 verwendet.
    const injectMany = () =>
        page.evaluate(() => {
            const alpine = (window as unknown as { Alpine: { $data: (e: Element) => Record<string, unknown> } }).Alpine
            const el = document.querySelector('[x-data="nostrUpdates"]') as Element
            const data = alpine.$data(el) as { items: unknown[]; feed: string; limit: number }
            data.feed = 'all'
            data.limit = 30
            const now = Math.floor(Date.now() / 1000)
            data.items = Array.from({ length: 31 }, (_, i) => ({
                key: `message:viele-${i}`,
                type: 'message',
                context: `Seitenprobe ${i}`,
                title: 'Relay Admin · 1 Nachricht',
                snippet: `Zeile ${i}`,
                timeLabel: 'gerade eben',
                picture: '',
                authorName: 'Relay Admin',
                pubkey: '00',
                h: `viele${i}`,
                rootId: '',
                href: `/rooms/viele${i}?from=updates`,
                ts: now - i,
                bucket: 'today',
                unread: false,
                count: 1,
                orphan: false,
            }))
        })

    const olderBtn = page.getByRole('button', { name: 'Ältere anzeigen' })
    await expect(async () => {
        await injectMany()
        await expect(olderBtn).toBeVisible()
    }).toPass({ timeout: 30_000 })

    // Der Klick deckt die letzte Seite auf ⇒ der Knopf verschwindet ⇒ der Container fängt.
    await olderBtn.click()
    await expect(olderBtn, 'nach der letzten Seite darf der Knopf nicht mehr stehen').toBeHidden({ timeout: 20_000 })
    active = await activeInfo(page)
    console.log(`[anker17] nach „Ältere anzeigen" (letzter Klick): <${active.tag}> tabindex="${active.tabindex}"`)
    expect(active.tag, 'Fokus auf BODY = verloren').not.toBe('BODY')
    expect(active.tag).toBe('DIV')
    expect(active.tabindex).toBe('-1')
})
