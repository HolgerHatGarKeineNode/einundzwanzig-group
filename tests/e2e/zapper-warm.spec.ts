/**
 * Wächter für den Zapper-Warm-Pfad (`js/zaps.ts` `warmZappers`).
 *
 * Hintergrund: Beim Öffnen eines Raums wärmt der Feed für JEDEN Autor den LNURL-Endpoint
 * seiner Lightning-Adresse vor (⚡-Chip). Ein unerreichbarer Endpoint ist im Alltag ein
 * Normalfall (tote Domain, DNS weg, Wallet-Host down). Über welshmans `loadZapperForPubkey`
 * erzeugte dieser Normalfall eine **unhandled rejection** („TypeError: Failed to fetch"),
 * die kein Aufrufer abfangen kann: `@welshman/lib` `tryCatch` reicht die rejectete Promise
 * durch, und `batcher` wirft die Promise seines `_execute` weg (`setTimeout`) — die
 * Rejection ist eine Waise. Herleitung + Fix stehen im Kommentar zu `warmZappers`.
 *
 * Das war zugleich die Ursache des wochenlangen „Flakes" in `storage-cache.spec.ts` P4:
 * `room.spec.ts:1162` (B3) hinterlässt eine `lud16` auf dem geteilten Worker-Relay; jeder
 * spätere Test desselben Workers lief danach in dieselbe Rejection, und nur P4 prüft darauf.
 * Dieser Anker stellt den Fall direkt her, statt auf die Worker-Lotterie zu warten.
 *
 * Der Anker ist scharf: mit welshmans Loader statt des eigenen Fetches ist er rot
 * (nachgewiesen, 10/10), mit dem Fix grün (10/10).
 */
import { test, expect } from './support/fixtures'
import { execFileSync } from 'node:child_process'
import { useZooid, ZOOID_WS } from './support/zooid'
import { loginNsec } from './support/login'

const NSEC = process.env.NOSTR_TEST_NSEC as string
const NAK = process.env.NAK ?? `${process.env.HOME}/go/bin/nak`
const ADMIN = 'b2ee09a54bedf17ee1db562bdddd75c48661d981eb52c49dc206c55ba8439414'
const WELCOME = 'Willkommen im Space! 👋'

/** kind-0 des Raum-Autors setzen. `ts` explizit, damit die Ersetzung sicher gewinnt. */
function setAdminProfile(content: Record<string, string>, ts: number): void {
    execFileSync(NAK, [
        'event', '--auth', '--sec', ADMIN, '-k', '0',
        '--ts', String(ts),
        '-c', JSON.stringify(content),
        ZOOID_WS,
    ])
}

/** Gültige LUD-06/LUD-16-Antwort (NIP-57-fähig) — der Erfolgsfall des Warmlaufs. */
const LNURL_PAY_DOC = {
    callback: 'https://lnurl-ok.test/lnurl/cb',
    minSendable: 1000,
    maxSendable: 100_000_000,
    metadata: '[["text/plain","E2E"]]',
    tag: 'payRequest',
    allowsNostr: true,
    nostrPubkey: 'da99fbe39247109327ac8504750d0227d50a8f84049ac8bd2f6c7ad0806ed76d',
}

test('Erreichbarer LNURL-Endpoint: Warmlauf verarbeitet die Antwort ohne Fehler', async ({ page }) => {
    const now = Math.floor(Date.now() / 1000)
    setAdminProfile({ name: 'Relay Admin', lud16: 'admin@lnurl-ok.test' }, now)

    try {
        const pageErrors: string[] = []
        page.on('pageerror', (e) => pageErrors.push(e.message))

        await page.addInitScript(() => {
            ;(window as unknown as { __rejections: string[] }).__rejections = []
            window.addEventListener('unhandledrejection', (e) =>
                (window as unknown as { __rejections: string[] }).__rejections.push(String(e.reason)),
            )
        })

        let lnurlHits = 0
        await page.route(/\.well-known\/lnurlp/, (route) => {
            lnurlHits += 1
            return route.fulfill({
                status: 200,
                contentType: 'application/json',
                headers: { 'Access-Control-Allow-Origin': '*' },
                body: JSON.stringify(LNURL_PAY_DOC),
            })
        })

        await useZooid(page)
        await loginNsec(page, NSEC)
        await page.goto('/rooms/welcome')
        await expect(page.getByText(WELCOME)).toBeVisible({ timeout: 15_000 })

        await expect
            .poll(() => lnurlHits, { timeout: 15_000, message: 'LNURL-Warmlauf hat nie stattgefunden' })
            .toBeGreaterThan(0)

        const marker = `LNURL-OK-${Math.floor(Math.random() * 1e9)}`
        execFileSync(NAK, ['event', '--auth', '--sec', ADMIN, '-k', '9', '-t', 'h=welcome', '-c', `E2E ${marker}`, ZOOID_WS])
        await expect(page.getByText(`E2E ${marker}`)).toBeVisible({ timeout: 15_000 })

        const rejections = await page.evaluate(() => (window as unknown as { __rejections: string[] }).__rejections)
        expect(rejections, `unhandled rejections: ${rejections.join(' | ')}`).toEqual([])
        expect(pageErrors, `page errors: ${pageErrors.join(' | ')}`).toEqual([])
    } finally {
        setAdminProfile({ name: 'Relay Admin' }, now + 1)
    }
})

test('Unerreichbarer LNURL-Endpoint eines Autors: kein unhandled rejection, Chat läuft weiter', async ({ page }) => {
    const now = Math.floor(Date.now() / 1000)
    // Der Autor der Seed-Nachrichten bekommt eine Lightning-Adresse, deren LNURL-Abruf
    // gleich hart scheitert. `.test` ist per RFC 6761 nicht auflösbar — der Route-Stub
    // unten fängt den Abruf ohnehin ab, sodass NICHTS die Testmaschine verlässt.
    setAdminProfile({ name: 'Relay Admin', lud16: 'admin@lnurl-tot.test' }, now)

    try {
        const rejections: string[] = []
        const pageErrors: string[] = []
        page.on('pageerror', (e) => pageErrors.push(e.message))

        await page.addInitScript(() => {
            ;(window as unknown as { __rejections: string[] }).__rejections = []
            window.addEventListener('unhandledrejection', (e) =>
                (window as unknown as { __rejections: string[] }).__rejections.push(String(e.reason)),
            )
        })

        // Der LNURL-Abruf scheitert deterministisch (kein DNS, kein Fremd-Host, kein Timing-
        // Glücksspiel): `route.abort('failed')` erzeugt im Browser exakt "TypeError: Failed
        // to fetch" — denselben Fehler wie eine tote Domain in Produktion.
        let lnurlAborts = 0
        await page.route(/\.well-known\/lnurlp/, (route) => {
            lnurlAborts += 1
            return route.abort('failed')
        })

        await useZooid(page)
        await loginNsec(page, NSEC)
        await page.goto('/rooms/welcome')
        await expect(page.getByText(WELCOME)).toBeVisible({ timeout: 15_000 })

        // Erst wenn der Abbruch NACHWEISLICH stattgefunden hat, ist die Probe überhaupt
        // aussagekräftig — sonst wäre der Test tautologisch grün (kein Fetch, kein Fehler).
        await expect
            .poll(() => lnurlAborts, { timeout: 15_000, message: 'LNURL-Warmlauf hat nie stattgefunden' })
            .toBeGreaterThan(0)

        // Fail-soft-Nachweis mit eingebautem Nachlauf: eine Live-Nachricht muss weiter
        // ankommen. Das Warten darauf ist ereignisgesteuert (kein fixes sleep) und deckt
        // zugleich das Fenster ab, in dem eine Rejection gemeldet würde.
        const marker = `LNURL-${Math.floor(Math.random() * 1e9)}`
        execFileSync(NAK, ['event', '--auth', '--sec', ADMIN, '-k', '9', '-t', 'h=welcome', '-c', `E2E ${marker}`, ZOOID_WS])
        await expect(page.getByText(`E2E ${marker}`)).toBeVisible({ timeout: 15_000 })

        rejections.push(...(await page.evaluate(() => (window as unknown as { __rejections: string[] }).__rejections)))
        expect(rejections, `unhandled rejections: ${rejections.join(' | ')}`).toEqual([])
        expect(pageErrors, `page errors: ${pageErrors.join(' | ')}`).toEqual([])
    } finally {
        // Aufräumen ist Pflicht, nicht Höflichkeit: der Relay lebt für den ganzen Lauf
        // und wird von allen weiteren Tests DIESES Workers geteilt. Genau dieses fehlende
        // Aufräumen in room.spec.ts:1162 hat den P4-„Flake" erzeugt.
        //
        // `now + 1`, NICHT ein weiter in der Zukunft liegender Wert: kind 0 ist ersetzbar,
        // es gewinnt das grössere `created_at`. Ein zu weit vorausdatiertes Aufräum-Event
        // schlägt den Setz-Aufruf eines Tests, der kurz danach läuft — gemessen: mit `+5`
        // fielen 2 von 3 dicht aufeinanderfolgenden Wiederholungen aus, weil ihre `lud16`
        // gar nicht erst gültig wurde. `+1` reicht (dieser Test läuft mehrere Sekunden).
        setAdminProfile({ name: 'Relay Admin' }, now + 1)
    }
})

/**
 * Dritter Anker: der **Zap-Sheet-Pfad** (expliziter Nutzer-Tap), nicht der Warmlauf.
 *
 * Er lief bis 2026-07-30 über welshmans `forceLoadZapper` und damit durch denselben
 * kaputten Batcher: bei totem Endpoint settlete dessen Promise NIE (nur der
 * `withTimeout(…, 15000)` in `bridge.ts` rettete die UI) UND es feuerte dieselbe
 * verwaiste Rejection wie der Warmlauf. Seither geht auch dieser Pfad über
 * `loadZapperNow` (`js/zaps.ts`) — dieselbe Funktion, die die beiden Anker oben decken.
 *
 * Geprüft wird deshalb genau das, was hier ANDERS ist als im Warmlauf: dass der Tap
 * zu einem ERGEBNIS führt (die „nicht erreichbar"-Meldung) statt in den 15-s-Timeout
 * zu laufen — und dass dabei keine Rejection entsteht.
 */
test('Zap-Sheet bei totem Endpoint: klare Meldung statt Timeout, keine unhandled rejection', async ({ page }) => {
    const now = Math.floor(Date.now() / 1000)
    setAdminProfile({ name: 'Relay Admin', lud16: 'admin@lnurl-dead.test' }, now)

    try {
        const pageErrors: string[] = []
        page.on('pageerror', (e) => pageErrors.push(e.message))

        await page.addInitScript(() => {
            ;(window as unknown as { __rejections: string[] }).__rejections = []
            window.addEventListener('unhandledrejection', (e) =>
                (window as unknown as { __rejections: string[] }).__rejections.push(String(e.reason)),
            )
        })

        // Deterministisch tot: `abort('failed')` erzeugt exakt „TypeError: Failed to fetch".
        // Kein DNS, nichts verlässt die Maschine.
        let lnurlHits = 0
        await page.route(/\.well-known\/lnurlp/, (route) => {
            lnurlHits += 1

            return route.abort('failed')
        })

        await useZooid(page)
        await loginNsec(page, NSEC)
        await page.goto('/rooms/welcome')
        await expect(page.getByText(WELCOME)).toBeVisible({ timeout: 15_000 })

        // Der Warmlauf muss den toten Endpoint bereits angefasst haben — sonst prüfte
        // der Rest dieses Tests einen Zustand, den es gar nicht gab.
        await expect
            .poll(() => lnurlHits, { timeout: 15_000, message: 'LNURL-Abruf hat nie stattgefunden' })
            .toBeGreaterThan(0)

        // Zap-Sheet braucht eine FREMDE Nachricht: `zappable = !mine && Boolean(lnurl)`
        // (`feeds.ts:551`). Die Willkommens-Nachricht des Seeds stammt vom Test-USER selbst
        // (`zooid-testserver.sh:223`) und ist damit nie zappbar — deshalb hier eine eigene
        // Admin-Nachricht.
        const zapMarker = `ZAP-DEAD-${Math.floor(Math.random() * 1e9)}`
        execFileSync(NAK, ['event', '--auth', '--sec', ADMIN, '-k', '9', '-t', 'h=welcome', '-c', `E2E ${zapMarker}`, ZOOID_WS])
        await expect(page.getByText(`E2E ${zapMarker}`)).toBeVisible({ timeout: 15_000 })

        const row = page.locator('div.chat-row', { hasText: zapMarker }).first()
        await row.hover()
        await row.getByRole('button', { name: 'Zap', exact: true }).click()

        // Das Ergebnis, auf das es ankommt: eine AUSSAGE, und zwar deutlich schneller als
        // der 15-s-Notausgang. Mit der verwaisten Promise kam hier nie etwas an.
        await expect(page.getByText('Der Zahlungs-Endpoint des Empfängers ist nicht erreichbar.', { exact: false }))
            .toBeVisible({ timeout: 10_000 })

        const rejections = await page.evaluate(() => (window as unknown as { __rejections: string[] }).__rejections)
        expect(rejections, `unhandled rejections: ${rejections.join(' | ')}`).toEqual([])
        expect(pageErrors, `page errors: ${pageErrors.join(' | ')}`).toEqual([])
    } finally {
        setAdminProfile({ name: 'Relay Admin' }, now + 1)
    }
})
