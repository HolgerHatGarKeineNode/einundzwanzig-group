/**
 * **Die Artikel-Vollansicht ab `xl` — die Anordnung, die bei 1279 px per Definition nicht
 * existiert.**
 *
 * Diese Datei muss `desktop-*.spec.ts` heißen. Das Playwright-Projekt `chromium` ist auf
 * **1279 px** gepinnt (`playwright.config.ts`, Projekt `chromium`) und ignoriert
 * `desktop-*`; nur das Projekt `desktop` fährt 1440×900 und greift genau dieses Muster.
 * Ein Aside-Test unter dem eigenen Breakpoint prüfte nichts und wäre trotzdem grün — der
 * Plan benennt die Falle für P5, sie gilt aber schon hier.
 *
 * **Warum es diese Datei überhaupt gibt.** Die `xl`-Anordnung war bis 2026-08-21 nur von
 * Hand gemessen (eine Sonde am laufenden Client, kein Test). Eine Handsonde ist ein
 * Beleg für einen Nachmittag, kein Netz: sie fällt nicht auf, wenn jemand `xl:items-start`
 * entfernt oder dem Aside eine Höhe gibt. Genau diese beiden Fehler sind für `sticky`
 * tödlich und für jeden Klicktest unsichtbar.
 *
 * Geprüft wird, was der Entwurf zusagt (Kopfkommentar in `⚡article.blade.php`):
 *   1. GENAU EIN `<aside>` — der Nachspann ist derselbe Knoten wie mobil, keine zweite
 *      Fassung. Ein per `hidden` versteckter Zwilling bliebe für die Tastatur erreichbar.
 *   2. `position: sticky` und 18 rem breit.
 *   3. Kein doppelter Fokus-Stopp gegenüber der Mobil-Anordnung.
 *
 * Artikel kommen roh über `nak` (Muster `longform-reader.spec.ts`), `test`/`expect` aus
 * `support/board-fixtures.ts` — dieselbe Begründung wie dort: `/articles/{naddr}` braucht
 * einen `serve` mit gesetzter `NOSTR_BOARD_URL`.
 */
import { naddrEncode } from 'nostr-tools/nip19'
import { test, expect, type Page } from './support/board-fixtures'
import { useZooid } from './support/zooid'
import { loginNsec } from './support/login'
import { cleanupArticles, publishArticle } from './support/articles'

const NSEC = process.env.NOSTR_TEST_NSEC as string
const ADMIN = 'b2ee09a54bedf17ee1db562bdddd75c48661d981eb52c49dc206c55ba8439414'
const ADMIN_PUB = 'da99fbe39247109327ac8504750d0227d50a8f84049ac8bd2f6c7ad0806ed76d'

const rnd = (): number => Math.floor(Math.random() * 1e9)

/** Siehe die ausführliche Herleitung in `longform-reader.spec.ts` (`boardWs`). */
function boardWs(baseURL: string): string {
    const port = Number(new URL(baseURL).port)
    return `ws://localhost:${3335 + (port - 8437)}`
}

async function loginToBoard(page: Page): Promise<void> {
    await useZooid(page)
    await loginNsec(page, NSEC)
}

test.afterAll(async ({ baseURL }) => {
    if (baseURL) {
        cleanupArticles(boardWs(baseURL), ADMIN)
    }
})

/** Publiziert einen Artikel und liefert seinen `naddr`. */
function artikel(ws: string, kennung: string): string {
    publishArticle(ws, ADMIN, ADMIN_PUB, {
        identifier: kennung,
        title: `LFDesktop-${rnd()}`,
        content: Array.from(
            { length: 40 },
            (_, i) => `Absatz ${i}, lang genug, damit die Bühne wirklich scrollt und das Aside etwas zu kleben hat.`,
        ).join('\n\n'),
        publishedAt: 1_700_000_020,
    })

    return naddrEncode({ kind: 30023, pubkey: ADMIN_PUB, identifier: kennung, relays: [] })
}

test('Desktop (xl): das Aside steht EINMAL im Dokument, klebt und ist 18 rem breit', async ({ page, baseURL }) => {
    const naddr = artikel(boardWs(baseURL as string), `lf-desktop-${rnd()}`)

    await loginToBoard(page)
    await page.goto(`/articles/${naddr}`)
    await expect(page.locator('[data-artikel-text]')).toBeVisible({ timeout: 20_000 })

    // Die Schranke zuerst: läuft dieser Test versehentlich unter dem Breakpoint, misst er
    // die falsche Anordnung — und wäre bei zwei der drei Zusagen trotzdem grün.
    expect(page.viewportSize()?.width ?? 0).toBeGreaterThanOrEqual(1280)

    // 1. GENAU EIN <aside>. Ein zweiter (etwa eine `xl:hidden`-Mobilfassung) wäre die
    //    Duplikat-Bauform, die der Entwurf ausdrücklich vermeidet.
    await expect(page.locator('aside')).toHaveCount(1)

    const gemessen = await page.evaluate(() => {
        const aside = document.querySelector('aside')
        if (!aside) {
            throw new Error('Kein <aside> im DOM — die Sonde misst nichts.')
        }
        const stil = getComputedStyle(aside)
        return {
            position: stil.position,
            breite: Math.round(aside.getBoundingClientRect().width),
            // Eine definite Cross-Size schlägt `align-self: start` — dann klebt nichts.
            hoeheGesetzt: stil.height !== 'auto' && aside.style.height !== '',
            wurzelSchriftgroesse: parseFloat(getComputedStyle(document.documentElement).fontSize),
        }
    })

    // 2. `sticky` und 18 rem. Die Breite wird gegen die WURZEL-Schriftgröße gerechnet,
    //    nicht gegen angenommene 16 px: bei einem Nutzer mit vergrößerter Schrift wäre
    //    eine harte 288 falsch, die Zusage lautet 18 rem.
    expect(gemessen.position).toBe('sticky')
    expect(gemessen.breite).toBe(Math.round(18 * gemessen.wurzelSchriftgroesse))
    expect(gemessen.hoeheGesetzt).toBe(false)
})

test('Desktop (xl): das Aside KLEBT beim Scrollen wirklich — nicht nur laut CSS', async ({ page, baseURL }) => {
    const naddr = artikel(boardWs(baseURL as string), `lf-desktop-kleben-${rnd()}`)

    await loginToBoard(page)
    await page.goto(`/articles/${naddr}`)
    await expect(page.locator('[data-artikel-text]')).toBeVisible({ timeout: 20_000 })

    const aside = page.locator('aside')

    /**
     * Ab `xl` scrollt die BÜHNE, nicht das Dokument (`app-shell` setzt dort
     * `xl:overflow-y-auto` auf `main`). Ein `window.scrollTo` täte hier gar nichts — und
     * ein Test, der danach „klebt" behauptet, hätte nie gescrollt. Deshalb liefert diese
     * Hilfe die TATSÄCHLICH erreichte Position zurück und wird unten geprüft.
     */
    const scrolleBuehne = async (auf: number): Promise<number> =>
        page.evaluate((ziel) => {
            const buehne = document.getElementById('buehne')
            if (!buehne || buehne.scrollHeight <= buehne.clientHeight) {
                return 0
            }
            buehne.scrollTop = ziel
            return buehne.scrollTop
        }, auf)

    // ── Zwei Schritte, und der erste ist NICHT die Zusage ──
    //
    // Beim ersten Scrollen wandert das Aside noch: es steht im Fluss unter dem Kopf und
    // rutscht nach oben, bis es an `top-6` einrastet. Ein Test, der schon diesen Schritt
    // auf „bewegt sich nicht" prüft, misst das Einrasten und schlägt fehl, obwohl alles
    // stimmt (beim Bauen dieses Tests passiert: gemessen 32 px, erwartet < 4).
    // Die Zusage ist der ZWEITE Schritt — ab dem Einrasten bewegt es sich nicht mehr,
    // egal wie weit noch gescrollt wird.
    const ersterStand = await scrolleBuehne(800)
    expect(ersterStand).toBeGreaterThan(0)
    await page.waitForTimeout(300)
    const nachErstem = (await aside.boundingBox())?.y ?? -1
    expect(nachErstem).toBeGreaterThan(0)

    const zweiterStand = await scrolleBuehne(ersterStand + 800)
    // Ohne diese Prüfung wäre der Test grün, wenn der zweite Schritt gar nicht mehr
    // scrollen KANN — dann stünde „bewegt sich nicht" für „es ist nichts passiert".
    expect(zweiterStand).toBeGreaterThan(ersterStand)
    await page.waitForTimeout(300)
    const nachZweitem = (await aside.boundingBox())?.y ?? -1

    // Ohne `sticky` wäre das Aside um die volle zweite Strecke nach oben gewandert, also
    // aus dem Bild. Die Toleranz deckt Subpixel ab, nicht 800 px.
    expect(Math.abs(nachZweitem - nachErstem)).toBeLessThan(4)
    await expect(aside).toBeInViewport()

    // Und WO es klebt, ist ebenfalls zugesagt: `xl:top-6`, gerechnet ab der Oberkante der
    // scrollenden Bühne — nicht ab der Fensterkante. Eine harte Pixelzahl wäre hier eine
    // zweite Wahrheit über die Kopfhöhe.
    //
    // Gerechnet wird gegen die CONTENT-Box der Bühne, nicht gegen ihre Border-Box: `main`
    // trägt ab `xl` selbst ein `pt-6`, und roh gemessen kommen deshalb 48 px heraus statt
    // 24 (beim Bauen dieses Tests gemessen). Beide Zahlen sind richtig, aber nur die
    // gegen die Content-Box ist die ZUSAGE — `xl:top-6` sagt nichts über das Polster der
    // Bühne, und ein Test, der 48 festnagelt, würde bei einer Änderung daran rot, ohne
    // dass am Aside irgendetwas kaputt wäre.
    const versatz = await page.evaluate(() => {
        const buehne = document.getElementById('buehne')!
        const aside = document.querySelector('aside')!
        const polster = parseFloat(getComputedStyle(buehne).paddingTop)
        return Math.round(aside.getBoundingClientRect().top - buehne.getBoundingClientRect().top - polster)
    })
    const rem = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize))
    expect(versatz).toBe(Math.round(1.5 * rem))
})

test('Desktop (xl): die xl-Anordnung fuegt KEINEN Fokus-Stopp hinzu', async ({ page, baseURL }) => {
    const naddr = artikel(boardWs(baseURL as string), `lf-desktop-fokus-${rnd()}`)

    await loginToBoard(page)
    await page.goto(`/articles/${naddr}`)
    await expect(page.locator('[data-artikel-text]')).toBeVisible({ timeout: 20_000 })

    // ── Erst warten, bis der AUTORENZUSTAND steht ──
    //
    // Ohne diesen Schritt vergleicht der Test zwei Zeitpunkte statt zwei Anordnungen: das
    // kind 0 des Autors trifft asynchron ein, und mit ihm ändert sich der Nachspann
    // (npub-Kurzform → Anzeigename, und der Lightning-Einstieg geht von `unbekannt` — gar
    // keine Zeile — auf `ja`/`nein`). Beim Bauen dieses Tests gemessen: die erste Liste
    // hatte vier Einträge, die zweite fünf, und der Unterschied war ausschließlich das
    // inzwischen eingetroffene Profil. Der Wartepunkt ist eine BEDINGUNG, keine Zeitspanne.
    await expect(page.locator('[data-lightning-einstieg]')).toBeVisible({ timeout: 20_000 })

    /** Fokussierbare Elemente INNERHALB der Artikelbühne, ohne Rail und Kopf. */
    const stopps = async (): Promise<string[]> =>
        page.evaluate(() => {
            const buehne = document.getElementById('buehne')
            if (!buehne) {
                throw new Error('Keine Bühne im DOM — die Sonde misst nichts.')
            }
            return [...buehne.querySelectorAll<HTMLElement>('a[href], button, [tabindex]:not([tabindex="-1"])')]
                .filter((el) => el.offsetParent !== null || getComputedStyle(el).position === 'fixed')
                .map((el) => `${el.tagName.toLowerCase()}:${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 24)}`)
        })

    const beiXl = await stopps()

    // Dieselbe Seite unterhalb des Breakpoints. Die Zusage des Entwurfs lautet: EINE
    // DOM-Reihenfolge, zwei Anordnungen — also identische Fokus-Stopps. Wäre das Aside
    // eine zweite, per `hidden` versteckte Fassung, stünden hier mehr Einträge, und der
    // sichtbar-Filter oben ließe sie durch, weil `xl:hidden` erst ab 1280 greift.
    await page.setViewportSize({ width: 1000, height: 900 })
    await page.waitForTimeout(300)
    const darunter = await stopps()

    expect(beiXl).toEqual(darunter)
})
