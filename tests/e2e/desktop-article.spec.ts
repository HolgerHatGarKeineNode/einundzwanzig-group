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
import { naddrEncode, npubEncode } from 'nostr-tools/nip19'
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

    // ── The ONE difference, and why it is none in the sense of this promise (P6) ────
    //
    // Since the command bar (D10) IT carries the avatar from `xl` up, and the page header
    // steps aside there (`me-avatar.blade.php`, `xl:hidden` in the web host). From `xl` up the
    // stage therefore LOSES exactly one stop — it gains none, which is what this case
    // promises.
    //
    // Measured rather than assumed: the difference was exactly `a:Angemeldet als …`.
    //
    // The avatar has moved, not vanished. The second assertion below pins that down —
    // otherwise this exception would also cover an accidental deletion.
    const avatarZeile = (liste: string[]): string[] => liste.filter((eintrag) => /^a:Angemeldet als/.test(eintrag))
    expect(avatarZeile(beiXl), 'ab xl trägt die Kommandoleiste den Avatar, nicht die Bühne').toEqual([])
    expect(avatarZeile(darunter), 'darunter steht er im Seitenkopf').toHaveLength(1)

    expect(beiXl).toEqual(darunter.filter((eintrag) => !/^a:Angemeldet als/.test(eintrag)))

    // And it moved rather than got lost: at BOTH widths the document carries exactly one
    // visible way to „Ich" — the bar's from `xl` up, the header's below.
    const wegeZuIch = async (): Promise<number> =>
        page.evaluate(
            () =>
                [...document.querySelectorAll<HTMLElement>('[data-app-header-avatar], [data-command-bar-avatar]')]
                    .filter((el) => el.offsetParent !== null).length,
        )
    expect(await wegeZuIch(), 'unterhalb xl: der Avatar des Kopfes').toBe(1)
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.waitForTimeout(300)
    expect(await wegeZuIch(), 'ab xl: der Avatar der Kommandoleiste').toBe(1)
})

/*
 * ── Folded in from `desktop-p5-navigation.spec.ts` (P7, approved removal) ────────────
 *
 * That file tested the Ortskarten bar, which P2 deleted (D2), so three quarters of it had
 * no surface left — its core case asserted that the bar carries no `role="tab"`, and there
 * is no bar. Two of its promises are about the ARTICLE surface and survive the deletion;
 * they are folded in here rather than dropped, which is the condition D15 puts on a
 * removal: the replacement has to cover what stays true.
 *
 * What was NOT folded in, with the reason:
 *  · „kein role=tab im lebenden DOM" and „die Live-Zeile springt nicht" — both measure the
 *    deleted bar itself;
 *  · the two assertions inside the cases below that read `[data-ortskarte]` (gone with the
 *    component) and `[data-rail-fuss="artikel"]` (the rail footer, deleted in P6 — the
 *    left bar has three children now, and „where am I" is answered by the room rows).
 */

test('the author page is reachable by a LINK — not only through the address bar', async ({ page, baseURL }) => {
    // The point of the case: P4 built `/articles/autor/{npub}` and NOTHING linked there.
    // This one clicks its way to it.
    const kennung = `lf-p7-autor-${rnd()}`
    publishArticle(boardWs(baseURL as string), ADMIN, ADMIN_PUB, {
        identifier: kennung,
        title: `P7Autor-${rnd()}`,
        content: 'Ein Absatz reicht.',
        publishedAt: 1_700_000_040,
    })
    const naddr = naddrEncode({ kind: 30023, pubkey: ADMIN_PUB, identifier: kennung, relays: [] })

    await loginToBoard(page)
    await page.goto(`/articles/${naddr}`)
    await expect(page.locator('[data-artikel-text]')).toBeVisible({ timeout: 20_000 })

    const link = page.locator('[data-autor-link]')
    await expect(link).toBeVisible({ timeout: 20_000 })

    // The target stands on the element BEFORE the click — and it is the npub form. A hex
    // pubkey would resolve in the address just as well, but no other client reads it as an
    // identity.
    const npub = npubEncode(ADMIN_PUB)
    await expect(link).toHaveAttribute('href', new RegExp(`/articles/autor/${npub}$`))

    await link.click()
    await page.waitForURL(`**/articles/autor/${npub}`, { timeout: 20_000 })

    // Arrived: the author card stands, and WITHOUT an error state. Both together — otherwise
    // a „this npub cannot be read" would also count as a successful click.
    await expect(page.locator('[data-autor-karte]')).toBeVisible({ timeout: 20_000 })
    await expect(page.locator('[data-autor-fehler]')).toHaveCount(0)
})

test('Desktop: the article list is three columns from xl and four from 2xl — and the stage is wider than the reading cap', async ({ page, baseURL }) => {
    // Four articles so four columns have four cards. The first one is the highlighted card
    // and spans two columns — hence five.
    for (let i = 0; i < 5; i++) {
        publishArticle(boardWs(baseURL as string), ADMIN, ADMIN_PUB, {
            identifier: `lf-p7-raster-${i}-${rnd()}`,
            title: `P7Raster-${i}-${rnd()}`,
            content: 'Kurz.',
            publishedAt: 1_700_000_050 + i,
        })
    }

    await loginToBoard(page)
    await page.goto('/bereich/artikel')
    // **Wait for the GRID.** The card list only stands after the relay answered, and
    // `x-show` keeps it at `display:none` until then. Measuring before that measures an
    // invisible grid; the probe below throws in that case, which is the right reaction.
    await expect(page.locator('[data-artikel-raster]')).toBeVisible({ timeout: 30_000 })

    /**
     * The column count of the CARD grid, from the resolved layout.
     *
     * **`getComputedStyle().gridTemplateColumns` returns the DECLARED value for a
     * `display:none` element** instead of the resolved tracks — i.e. `repeat(4, minmax(0,
     * 1fr))`. Split on spaces that is three pieces, whether it says 3 or 4. A hidden grid
     * therefore ALWAYS reported „3 columns", and that is what once made this case falsely
     * green at 1440 px and falsely red at 1700 px. Only real `px` tracks are counted, and an
     * invisible grid is an error rather than a measurement.
     */
    const spalten = async (): Promise<number> =>
        page.evaluate(() => {
            const raster = document.querySelector<HTMLElement>('[data-artikel-raster]')
            if (!raster) {
                throw new Error('Kein Karten-Raster in der Bühne — die Sonde misst nichts.')
            }
            if (raster.offsetParent === null) {
                throw new Error('Das Karten-Raster ist unsichtbar — dann ist jede Spaltenzahl geraten.')
            }
            const spuren = getComputedStyle(raster).gridTemplateColumns.split(' ').filter(Boolean)
            if (!spuren.every((s) => s.endsWith('px'))) {
                throw new Error(`Keine aufgelösten Spuren, sondern „${spuren.join(' ')}" — die Sonde misst den Klassennamen.`)
            }

            return spuren.length
        })

    /** Inner width of the stage's content column and the root font size that goes with it. */
    const buehne = async (): Promise<{ breite: number; rem: number }> =>
        page.evaluate(() => {
            const outlet = document.getElementById('buehne')
            if (!outlet) {
                throw new Error('Keine Bühne im DOM — die Sonde misst nichts.')
            }
            const deckel = outlet.firstElementChild as HTMLElement | null
            if (!deckel) {
                throw new Error('Die Bühne hat kein Deckel-Element — app-shell umgebaut?')
            }

            return {
                breite: Math.round(deckel.getBoundingClientRect().width),
                rem: parseFloat(getComputedStyle(document.documentElement).fontSize),
            }
        })

    // At 1440 px `xl` (1280) applies, not `2xl` (1536).
    expect(page.viewportSize()?.width).toBe(1440)
    await expect.poll(spalten, { timeout: 20_000 }).toBe(3)

    // **The 62 rem reading cap does NOT bind here.** That is the measurable effect of
    // `width="wide"` at this width: with the cap the content column would stop at 62 rem,
    // without it, it fills the stage. The 96 rem only show beyond ~1856 px — this is the
    // promise that is testable at all at 1440 px.
    const vor = await buehne()
    expect(vor.breite).toBeGreaterThan(Math.round(62 * vor.rem))

    // And the counter-probe one surface over: `/bereich/chat` keeps the reading cap.
    await page.goto('/bereich/chat')
    await expect(page.locator('[data-rail]')).toBeVisible({ timeout: 25_000 })
    const chat = await buehne()
    expect(chat.breite).toBe(Math.round(62 * chat.rem))

    // 2xl: four columns. `setViewportSize` beats the project default per case.
    await page.goto('/bereich/artikel')
    await expect(page.locator('[data-artikel-raster]')).toBeVisible({ timeout: 30_000 })
    await page.setViewportSize({ width: 1700, height: 900 })
    await expect.poll(spalten, { timeout: 20_000 }).toBe(4)
})
