import { test, expect, type Page, type Locator } from './support/fixtures'
import { execFileSync } from 'node:child_process'
import { useZooid, ZOOID_WS } from './support/zooid'
import { loginNsec } from './support/login'
import { cleanupRooms, trackRoom } from './support/rooms'

/**
 * P7 — der Bild-Proxy-Rückfall, `docs/plans/2026-08-11T1321-restposten-aus-ux-plan.md`
 * Punkt 1. Die Fallback-Ketten der Bild-Türen (`Proxy → Original → Initiale/#`) dürfen
 * das Original nur noch nachladen, wenn der Proxy das Ziel nicht schon per POLICY
 * ablehnt (`$imgFallback` → `js/imageFallback.ts`). Diese Spec bewacht beides:
 *
 *   - ANGRIFF (`//evil.example/…`, `http://evil.example/…`): der Browser stellt
 *     NULL Anfragen an den Angreifer-Host, und der ehrliche Rückfall (Initiale/#/
 *     Proxied-src bleibt) rendert. Vor der Reparatur gemessen: 7 rohe Anfragen
 *     (`docs/plans/…/p7-proxy-repro-vorher.log`).
 *   - LEGITIM (absolutes https): scheitert der Proxy am Upstream (hier: 500 auf den
 *     Proxy-Endpoint, Origin dient ein echtes PNG), MUSS das Original erscheinen —
 *     der Regress „legitime Bilder verschwinden" wäre teurer als der Befund.
 *
 * Türen (Mustersuche: 5 Fallback-Türen + 2 rohe src ohne Fallback — Zahl und Kommando
 * in `docs/plans/…/p7-proxy-messung.md`), je einer pro Test:
 *   Tür 1 nostr-avatar    — eigenes Profilbild (kind 0) auf /spaces
 *   Tür 2 room-tile       — Raum-picture (kind 39000) in „Meine Räume"
 *   Tür 3 meetup-tile     — Meetup-picture in „Meetup-Räume entdecken"
 *   Tür 4 rail-room-row   — Rail-Zeile ab 1280 px
 *   Tür 5 ⚡room-Lightbox — Inline-Bild im Raumchat, decode-aus-Proxy-URL
 * Die rohen src ohne Fallback (Raum-Formular-Vorschau `⚡spaces`, Space-Icon-Vorschau
 * `⚡directory`) laufen seit P7 über `$img` — kein Fehlerfall, kein eigener Test nötig.
 *
 * `blob:` ist ohne eigenen Test äquivalent abgedeckt: `proxifyImage` (core.ts) und
 * `mayFallbackToRaw` (imageFallback.ts) entscheiden beide über dieselbe
 * `INLINE_SRC`-Klasse (`data:`/`blob:`), und ein `blob:` kann aus Relay-Daten gar
 * nicht entstehen (dokument-lokal) — getestet am Klassifizierer
 * (`imageFallback.test.ts`, Fall `blob:`).
 *
 * Hermetik: die ANGRIFF-src läuft per `route.continue()` durch den ECHTEN Controller
 * (der lehnt sie mit 400 ab, ohne zu fetchen); nur die Antwort des Angreifer-Hosts
 * beantwortet die Route lokal — Playwright-Interception liegt vor jeder DNS-Auflösung.
 */
const NSEC = process.env.NOSTR_TEST_NSEC as string
const NAK = process.env.NAK ?? `${process.env.HOME}/go/bin/nak`
const ADMIN = 'b2ee09a54bedf17ee1db562bdddd75c48661d981eb52c49dc206c55ba8439414'

const PNG_1X1 = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
)
/** Dieselbe 1×1-Grafik als data:-URL (Inline-Fall, geht nie durch den Proxy).
 *  Byte-weises Percent-Encoding statt `;base64`: nak/zooid splitten ein 39000-Tag
 *  am `;` in zwei Werte (gemessen: aus `data:image/png;base64,…` wurde
 *  `["picture","data:image/png","base64,…"]`) — ohne Semikolon übersteht die URL den Seed. */
const PNG_1X1_DATA = 'data:image/png,' + [...PNG_1X1].map((b) => `%${b.toString(16).padStart(2, '0')}`).join('')

const rnd = (): number => Math.floor(Math.random() * 1e9)

function nak(args: readonly string[]): string {
    return execFileSync(NAK, [...args], { timeout: 15_000 }).toString()
}

/**
 * Raum anlegen und VERIFIZIEREN: zooid bestätigt einen 9007 mit `OK true`, auch wenn
 * die Gruppe nicht angelegt wurde (an :3355 gemessen; Muster siehe zooid-testserver.sh,
 * „OK true und tat nichts"). Erst der Verifikations-Request macht das sichtbar.
 */
function makeVerifiedRoom(h: string, tags: readonly string[]): void {
    const tagArgs = tags.flatMap((t) => ['-t', t])
    for (let attempt = 0; attempt < 3; attempt++) {
        nak(['event', '--auth', '--sec', ADMIN, '-k', '9007', '-t', `h=${h}`, ...tagArgs, ZOOID_WS])
        if (nak(['req', '-k', '39000', '-d', h, '--auth', '--sec', ADMIN, ZOOID_WS]).includes('"kind":39000')) {
            return
        }
    }
    throw new Error(`raum ${h} wurde nach 3× 9007 nicht angelegt`)
}

/** Wartet, bis kein img mit evil.example im src mehr im DOM ist (Fehlerpfad durchlaufen). */
async function waitForEvilImgGone(page: Page, scope: Page | Locator = page): Promise<void> {
    await expect
        .poll(() => scope.locator('img[src*="evil.example"]').count(), { timeout: 15_000 })
        .toBe(0)
    await page.waitForTimeout(500)
}

type ImageRoutes = { evilHits: () => string[] }

/**
 * Proxy-/Origin-Routing NACH useZooid (zuletzt registrierte Route gewinnt gegen
 * dessen Bild-Stub): evil → echter Controller (400 per Policy); legit → 500
 * (Upstream-Versagen simuliert); alles andere behält Stub-Verhalten (200-PNG).
 */
async function armImageRoutes(page: Page): Promise<ImageRoutes> {
    const evilHits: string[] = []
    await page.route(/\/img\/[a-z]+\?src=/, (route) => {
        const url = route.request().url()
        if (url.includes('evil.example')) {
            return route.continue()
        }
        if (url.includes('legit.example')) {
            return route.fulfill({ status: 500 })
        }
        return route.fulfill({ status: 200, contentType: 'image/png', body: PNG_1X1 })
    })
    await page.route('**evil.example/**', (route) => {
        evilHits.push(route.request().url())
        return route.fulfill({ status: 200, contentType: 'image/png', body: PNG_1X1 })
    })
    await page.route('**legit.example/**', (route) =>
        route.fulfill({ status: 200, contentType: 'image/png', body: PNG_1X1 }),
    )
    return { evilHits: () => evilHits }
}

async function openSpaces(page: Page): Promise<ImageRoutes> {
    await useZooid(page)
    const routes = await armImageRoutes(page)
    await loginNsec(page, NSEC)
    return routes
}

const tile = (page: Page, name: string) => page.getByRole('button').filter({ hasText: name })

test('Tür 2 — Raum-Kachel: protokoll-relative picture → keine Anfrage, ehrlicher #-Chip', async ({ page }) => {
    const uid = rnd()
    const h = trackRoom(`evil${uid}`)
    const name = `Angriff ${uid}`
    makeVerifiedRoom(h, [`name=${name}`, 'picture=//evil.example/room.png'])
    nak(['event', '--auth', '--sec', NSEC, '-k', '9021', '-t', `h=${h}`, ZOOID_WS])

    const routes = await openSpaces(page)
    await expect(tile(page, name)).toBeVisible({ timeout: 20_000 })
    await waitForEvilImgGone(page)

    expect(routes.evilHits(), 'keine Anfrage an den Angreifer-Host').toHaveLength(0)
    await expect(tile(page, name).getByText('#', { exact: true })).toBeVisible()
})

test('Tür 3 — Meetup-Kachel: http-picture → keine Anfrage, Initiale statt Bild', async ({ page }) => {
    const uid = rnd()
    const h = trackRoom(`meetup${uid}`)
    const name = `Meetup Evil ${uid}`
    makeVerifiedRoom(h, [
        `name=${name}`,
        'about=E2E-P7',
        'picture=http://evil.example/meetup.png',
        't=meetup',
        `i=meetup:e2e-${uid}`,
        `meetup_slug=meetup-evil-${uid}`,
    ])

    const routes = await openSpaces(page)
    await page.getByRole('button').filter({ hasText: 'Meetup-Räume entdecken' }).click()
    await expect(tile(page, name)).toBeVisible({ timeout: 10_000 })
    await waitForEvilImgGone(page)

    expect(routes.evilHits(), 'keine Anfrage an den Angreifer-Host').toHaveLength(0)
    await expect(tile(page, name).locator('img')).toHaveCount(0)
    await expect(tile(page, name).getByText('M', { exact: true })).toBeVisible()
})

test('Tür 4 — Rail-Zeile (1440 px): protokoll-relative picture → keine Anfrage, #', async ({ page }) => {
    const uid = rnd()
    const h = trackRoom(`rail${uid}`)
    const name = `Angriff Rail ${uid}`
    makeVerifiedRoom(h, [`name=${name}`, 'picture=//evil.example/rail.png'])
    nak(['event', '--auth', '--sec', NSEC, '-k', '9021', '-t', `h=${h}`, ZOOID_WS])

    const routes = await openSpaces(page)
    await page.setViewportSize({ width: 1440, height: 900 })
    const rail = page.locator('[data-rail]')
    await expect(rail).toBeVisible({ timeout: 10_000 })
    // rail-room-row ist ein <button> (kein <a>) — wie room-tile über den Namen adressiert.
    const row = rail.getByRole('button').filter({ hasText: name })
    await expect(row).toBeVisible({ timeout: 10_000 })
    await waitForEvilImgGone(page, rail)

    expect(routes.evilHits(), 'keine Anfrage an den Angreifer-Host').toHaveLength(0)
    await expect(row.getByText('#', { exact: true })).toBeVisible()
})

test('Tür 1 — eigenes Profilbild (kind 0): keine Anfrage, Initiale bleibt', async ({ page }) => {
    const routes = await openSpaces(page)
    try {
        nak(['event', '--auth', '--sec', NSEC, '-k', '0', '-c', `{"name":"Alice Test","picture":"//evil.example/alice.png"}`, ZOOID_WS])
        const chip = page.getByRole('button', { name: /Angemeldet als/ })
        await expect(chip).toBeVisible({ timeout: 20_000 })
        await waitForEvilImgGone(page)

        expect(routes.evilHits(), 'keine Anfrage an den Angreifer-Host').toHaveLength(0)
        await expect(chip.getByText('A', { exact: true })).toBeVisible()
        await expect(chip.locator('img')).toHaveCount(0)
    } finally {
        nak(['event', '--auth', '--sec', NSEC, '-k', '0', '-c', '{"name":"Alice Test"}', ZOOID_WS])
    }
})

test('Tür 5 — Lightbox: http-Inline-Bild → keine Anfrage, Proxy-src bleibt stehen', async ({ page }) => {
    const uid = rnd()
    const h = trackRoom(`lbx${uid}`)
    makeVerifiedRoom(h, [`name=Lightbox ${uid}`])
    nak(['event', '--auth', '--sec', NSEC, '-k', '9021', '-t', `h=${h}`, ZOOID_WS])
    nak(['event', '--auth', '--sec', ADMIN, '-k', '9', '-t', `h=${h}`, '-c', 'Bild: http://evil.example/inline.png', ZOOID_WS])

    const routes = await openSpaces(page)
    await page.goto(`/rooms/${h}`)
    const chatImg = page.locator('img.chat-image').first()
    await expect(chatImg).toBeVisible({ timeout: 20_000 })
    await chatImg.click()
    // Ein am Proxy gescheitertes Lightbox-Bild ist 0×0 → für Playwright „hidden";
    // sichtbar ist der Dialog, das Bild ist ATTACHED und bleibt auf der Proxy-URL.
    const lightbox = page.locator('div[role="dialog"] img.rounded-card')
    await expect(page.getByRole('dialog', { name: 'Bild in voller Größe' })).toBeVisible({ timeout: 10_000 })
    await expect(lightbox).toBeAttached()
    await expect
        .poll(() => lightbox.evaluate((el) => (el as HTMLElement).dataset.orig ?? ''), { timeout: 15_000 })
        .toBe('1')
    await page.waitForTimeout(500)

    expect(routes.evilHits(), 'keine Anfrage an den Angreifer-Host').toHaveLength(0)
    await expect(lightbox).toHaveAttribute('src', /\/img\/full\?src=/)
})

test('Legitim — Proxy scheitert am Upstream (500): roher Rückfall zeigt das Bild', async ({ page }) => {
    const uid = rnd()
    const h = trackRoom(`legit${uid}`)
    const name = `Legitim ${uid}`
    makeVerifiedRoom(h, [`name=${name}`, 'picture=https://legit.example/pic.png'])
    nak(['event', '--auth', '--sec', NSEC, '-k', '9021', '-t', `h=${h}`, ZOOID_WS])

    await openSpaces(page)
    await expect(tile(page, name)).toBeVisible({ timeout: 20_000 })
    const img = tile(page, name).locator('img')
    await expect(img).toHaveAttribute('src', 'https://legit.example/pic.png', { timeout: 15_000 })
    await expect
        .poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth), { timeout: 10_000 })
        .toBeGreaterThan(0)
})

test('data:-picture bleibt inline — kein Proxy, kein Fehlerpfad (blob: äquivalent, s. Kopf)', async ({ page }) => {
    const uid = rnd()
    const h = trackRoom(`data${uid}`)
    const name = `Inline ${uid}`
    makeVerifiedRoom(h, [`name=${name}`, `picture=${PNG_1X1_DATA}`])
    nak(['event', '--auth', '--sec', NSEC, '-k', '9021', '-t', `h=${h}`, ZOOID_WS])

    await openSpaces(page)
    await expect(tile(page, name)).toBeVisible({ timeout: 20_000 })
    const img = tile(page, name).locator('img')
    await expect(img).toBeVisible()
    await expect(img).toHaveAttribute('src', /^data:image\/png,/)
    await expect
        .poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth), { timeout: 10_000 })
        .toBeGreaterThan(0)
})

/**
 * ── Der ZWEITE Weg nach `imgBroken` (ergänzt 2026-08-16) ────────────────────────────
 *
 * Die Türen 2/3 erreichen den Rückfall über die POLICY: `$imgFallback` lehnt eine
 * protokoll-relative bzw. http-URL ab, das Original wird nie versucht. Der andere Weg —
 * `$imgFallback` sagt ja, das Original wird geladen und scheitert AUCH — war bis hierher
 * ungeprüft, in beiden Kacheln. Er ist genau der Zweig, den der Umbau vom 2026-08-16
 * (`dataset` → Alpine-Scope, `src` gebunden statt imperativ) neu geschrieben hat.
 *
 * Die beiden Tests unten schließen ihn. Zusammen mit Tür 2/3 ergibt das je Komponente
 * beide Wege und in `meetup-tile` beide sich ausschließenden Rückfall-Zweige:
 *   room-tile    Policy → `#` (Tür 2)              · Original scheitert → `#`      (hier)
 *   meetup-tile  Policy → Initiale (Tür 3)         · Original scheitert → Flagge   (hier)
 *
 * Beide registrieren ihre Routen VOR `loginNsec`: der Meetup-Portal-Join und die ersten
 * Bild-Anfragen laufen beim Space-Mount, also unmittelbar nach dem Login — ein danach
 * registrierter Stub käme zu spät. Playwright befragt Routen in umgekehrter
 * Registrierungsordnung, die späteste gewinnt: `armImageRoutes` liefert für
 * `legit.example` ein 200, die Zeile darunter überschreibt das auf 500.
 */

/** Wie `openSpaces`, aber mit einem Fenster für eigene Routen VOR dem Login. */
async function openSpacesMitRouten(page: Page, extra: (p: Page) => Promise<void>): Promise<ImageRoutes> {
    await useZooid(page)
    const routes = await armImageRoutes(page)
    await extra(page)
    await loginNsec(page, NSEC)
    return routes
}

const MEETUP_API = 'https://portal.einundzwanzig.space/api/mobile/meetups'

test('Raum-Kachel: auch das Original scheitert (500/500) → ehrlicher #-Chip, kein Bild', async ({ page }) => {
    const uid = rnd()
    const h = trackRoom(`legitbad${uid}`)
    const name = `Kaputt ${uid}`
    makeVerifiedRoom(h, [`name=${name}`, 'picture=https://legit.example/pic.png'])
    nak(['event', '--auth', '--sec', NSEC, '-k', '9021', '-t', `h=${h}`, ZOOID_WS])

    const originHits: string[] = []
    await openSpacesMitRouten(page, async (p) => {
        await p.route('**legit.example/**', (route) => {
            originHits.push(route.request().url())
            return route.fulfill({ status: 500 })
        })
    })

    await expect(tile(page, name)).toBeVisible({ timeout: 20_000 })
    await expect(tile(page, name).locator('img')).toHaveCount(0, { timeout: 15_000 })
    await expect(tile(page, name).getByText('#', { exact: true })).toBeVisible()

    // **Ohne diese Zeile misst der Test den Policy-Zweig und wäre eine Dublette von
    // Tür 2.** Sie belegt, dass der Rückfall wirklich über `imgOrig = true` lief: das
    // Original wurde angefragt (und hat 500 geliefert).
    expect(originHits.length, 'das Original MUSS versucht worden sein — sonst prüft der Test den falschen Zweig').toBeGreaterThan(0)
})

test('Meetup-Kachel: auch das Original scheitert (500/500) → die Länderflagge tritt an die Stelle des Logos, GENAU einmal', async ({
    page,
}) => {
    const uid = rnd()
    const h = trackRoom(`meetflag${uid}`)
    const name = `Meetup Flagge ${uid}`
    const slug = `meetup-flag-e2e-${uid}`
    makeVerifiedRoom(h, [
        `name=${name}`,
        'about=E2E-P7',
        'picture=https://legit.example/logo.png',
        't=meetup',
        `i=meetup:e2e-${uid}`,
        `meetup_slug=${slug}`,
    ])

    const originHits: string[] = []
    await openSpacesMitRouten(page, async (p) => {
        // Eigener Portal-Join für DIESEN Slug — sonst bliebe `meetup(slug)` null und die
        // Kachel fiele auf die Initiale, also auf den Zweig, den Tür 3 schon abdeckt.
        await p.route(MEETUP_API, (route) =>
            route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify([{ name, slug, city: 'Berlin', country: 'DE', logo: null, next_event_start: null }]),
            }),
        )
        await p.route('**legit.example/**', (route) => {
            originHits.push(route.request().url())
            return route.fulfill({ status: 500 })
        })
    })

    await page.getByRole('button').filter({ hasText: 'Meetup-Räume entdecken' }).click()
    const kachel = tile(page, name)
    await expect(kachel).toBeVisible({ timeout: 15_000 })

    await expect(kachel.locator('img')).toHaveCount(0, { timeout: 15_000 })
    expect(originHits.length, 'das Original MUSS versucht worden sein — sonst prüft der Test den falschen Zweig').toBeGreaterThan(0)

    // Die Flagge ersetzt das Logo — und steht GENAU EINMAL da. Der Eck-Pin
    // (`x-if="room.picture && meetup(...)?.flag"`) ist ein DRITTER Zweig derselben
    // Fläche; er kennt `imgBroken` nicht. Solange `room.picture` gesetzt bleibt — und
    // das tut es seit dem Umbau, weil der Fehlerpfad die Daten nicht mehr überschreibt —
    // rendert er zusätzlich zur großen Flagge. Die Zahl ist deshalb die Aussage, nicht
    // die Sichtbarkeit.
    await expect(kachel.getByText('🇩🇪', { exact: true })).toHaveCount(1)
    // Und die Initiale bleibt aus: die beiden Rückfall-Zweige schließen sich aus.
    await expect(kachel.getByText('M', { exact: true })).toHaveCount(0)
})

test.afterAll(() => {
    cleanupRooms(ZOOID_WS, ADMIN)
})
