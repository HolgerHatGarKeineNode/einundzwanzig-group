/**
 * **Die Ortskarten-Leiste, die Bühnenbreite und der Weg zur Autorenseite (P5).**
 *
 * Diese Datei MUSS `desktop-*.spec.ts` heißen. Das Playwright-Projekt `chromium` ist auf
 * **1279 px** gepinnt und ignoriert `desktop-*`; nur das Projekt `desktop`
 * (`playwright.config.ts`) fährt 1440×900 und greift dieses Muster. Alles, was hier
 * gemessen wird — die dreispaltige Artikelliste, die 96-rem-Bühne, die Rail — existiert
 * unterhalb von `xl` per Definition nicht. Ein Test darunter wäre grün und hätte nichts
 * geprüft.
 *
 * ── Warum die Live-DOM-Prüfung den Kernbeweis trägt und nicht der Feature-Test ──────
 *
 * `tests/Feature/OrtskartenTest.php` prüft dieselbe Zusage am ausgelieferten HTML — das
 * ist die halbe Miete. **Flux setzt `role="tab"` erst im Browser** (`initializeTab`);
 * serverseitig steht die Rolle nirgends. Hätte jemand die Leiste aus `flux:tab` gebaut,
 * wäre der Feature-Test grün und die Rolle stünde trotzdem im fertigen DOM. Erst hier,
 * nach dem Alpine-Boot, ist die Aussage vollständig.
 *
 * Artikel kommen roh über `nak`, `test`/`expect` aus `support/board-fixtures.ts` —
 * dieselbe Begründung wie in `desktop-article.spec.ts`: `/articles` braucht einen `serve`
 * mit gesetzter `NOSTR_BOARD_URL`.
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
        cleanupArticles(boardWs(baseURL as string), ADMIN)
    }
})

/**
 * Der Zustand der Ortskarten-Leiste, aus dem LEBENDEN DOM.
 *
 * **Fail-closed:** ohne Leiste wirft die Sonde. Ein Test, der „kein `role=tab` gefunden"
 * meldet, weil er gar nichts gefunden hat, ist die Bauform, die in P4 einen Beweis
 * ausgehöhlt hat.
 *
 * `[data-ortskarte]` als Attribut-Selektor und nicht als Textsuche: `indexOf('data-ortskarte')`
 * träfe auch ein `data-ortskarten…`.
 */
async function leiste(page: Page): Promise<{
    orte: string[]
    aktiv: string[]
    rollen: string[]
    tags: string[]
}> {
    return page.evaluate(() => {
        const karte = document.querySelector('[data-ortskarte]')
        if (!karte) {
            throw new Error('Keine Ortskarten-Leiste im DOM — die Sonde misst nichts.')
        }
        const nav = karte.closest('nav')
        if (!nav) {
            throw new Error('Ortskarte ohne umschließendes <nav> — Markup umgebaut?')
        }
        const karten = [...nav.querySelectorAll<HTMLElement>('[data-ortskarte]')]

        return {
            orte: karten.map((el) => el.dataset.ortskarte ?? '?'),
            aktiv: karten.filter((el) => el.getAttribute('aria-current') === 'page').map((el) => el.dataset.ortskarte ?? '?'),
            // ALLE Rollen im Teilbaum, nicht nur an den Karten: `flux:tab` setzt seine
            // Rolle auf das gerenderte `<button>`, das irgendwo darin läge.
            rollen: [...nav.querySelectorAll('[role]')].map((el) => el.getAttribute('role') ?? ''),
            tags: karten.map((el) => el.tagName.toLowerCase()),
        }
    })
}

test('KERNBEWEIS: kein role="tab" im LEBENDEN DOM, genau ein aria-current — und der Durchklick Chat → Artikel → Forge → Chat', async ({ page }) => {
    await loginToBoard(page)
    await page.goto('/spaces')
    await expect(page.locator('[data-ortskarte="chat"]')).toBeVisible({ timeout: 20_000 })

    // Die Schranke zuerst: lief dieser Test versehentlich unter dem Breakpoint, misst er
    // die falsche Anordnung — und wäre bei mehreren Zusagen trotzdem grün.
    expect(page.viewportSize()?.width ?? 0).toBeGreaterThanOrEqual(1280)

    // **Nach dem Alpine-Boot warten**, sonst prüft die Rollen-Zusage einen Zustand, den
    // auch der Server-Test schon abdeckt. Die Segmented-Bar auf derselben Seite IST ein
    // Tab-Widget — sobald sie ihre Rollen trägt, hat Flux gearbeitet.
    await expect(page.locator('[role="tab"]').first()).toBeVisible({ timeout: 20_000 })

    const start = await leiste(page)
    expect(start.orte).toEqual(['chat', 'artikel', 'forge'])
    expect(start.tags).toEqual(['a', 'a', 'a'])
    expect(start.aktiv).toEqual(['chat'])
    // Die eine Zusage, an der die ganze Entwurfsentscheidung hängt.
    expect(start.rollen).not.toContain('tab')
    expect(start.rollen).not.toContain('tablist')
    expect(start.rollen).not.toContain('tabpanel')

    // ── Der Durchklick. Ohne ihn wäre `aria-current` eine Konstante ──────────────────
    await page.locator('[data-ortskarte="artikel"]').click()
    await page.waitForURL('**/articles', { timeout: 20_000 })
    await expect(page.locator('[data-ortskarte="artikel"]')).toBeVisible({ timeout: 20_000 })
    expect((await leiste(page)).aktiv).toEqual(['artikel'])

    await page.locator('[data-ortskarte="forge"]').click()
    await page.waitForURL('**/forge', { timeout: 20_000 })
    await expect(page.locator('[data-ortskarte="forge"]')).toBeVisible({ timeout: 20_000 })
    expect((await leiste(page)).aktiv).toEqual(['forge'])

    // Und zurück — der Weg funktioniert in beide Richtungen, nicht nur vom Chat weg.
    await page.locator('[data-ortskarte="chat"]').click()
    await page.waitForURL('**/spaces', { timeout: 20_000 })
    await expect(page.locator('[data-ortskarte="chat"]')).toBeVisible({ timeout: 20_000 })
    expect((await leiste(page)).aktiv).toEqual(['chat'])
})

test('die Live-Zeile SPRINGT nicht: die Leiste hat vor und nach der Zahl dieselbe Geometrie', async ({ page, baseURL }) => {
    // Ein Artikel muss existieren, sonst bleibt `artikelZahl` bei 0 und die Live-Zeile
    // erscheint nie — der Test wäre grün, ohne je einen Wechsel gesehen zu haben.
    publishArticle(boardWs(baseURL as string), ADMIN, ADMIN_PUB, {
        identifier: `lf-p5-sprung-${rnd()}`,
        title: `P5Sprung-${rnd()}`,
        content: 'Kurz.',
        publishedAt: 1_700_000_030,
    })

    await loginToBoard(page)
    await page.goto('/articles')
    await expect(page.locator('[data-ortskarte="artikel"]')).toBeVisible({ timeout: 20_000 })

    /** Geometrie der Leiste UND jeder Karte, auf ganze Pixel gerundet. */
    const geometrie = async (): Promise<{ nav: number; karten: number[] }> =>
        page.evaluate(() => {
            const karte = document.querySelector('[data-ortskarte]')
            if (!karte) {
                throw new Error('Keine Ortskarten-Leiste im DOM — die Sonde misst nichts.')
            }
            const nav = karte.closest('nav')!

            return {
                nav: Math.round(nav.getBoundingClientRect().height),
                karten: [...nav.querySelectorAll('[data-ortskarte]')].map((el) =>
                    Math.round(el.getBoundingClientRect().height),
                ),
            }
        })

    const vorher = await geometrie()

    /** Die berechnete Opazität beider Zeilen je Karte — der Zustand, nicht die Klasse. */
    const opazitaeten = async (): Promise<{ ort: string; statisch: string; live: string }[]> =>
        page.evaluate(() =>
            [...document.querySelectorAll<HTMLElement>('[data-ortskarte]')].map((k) => ({
                ort: k.dataset.ortskarte ?? '?',
                statisch: getComputedStyle(k.querySelector('[data-ortskarte-statisch]')!).opacity,
                live: getComputedStyle(k.querySelector('[data-ortskarte-live]')!).opacity,
            })),
        )

    // ── Der Ankunftszustand, und warum er eine eigene Zusicherung braucht ────────────
    //
    // Hier stand einmal nichts, und der erste Entwurf war deshalb kaputt, ohne dass ein
    // Test es sah: die Opazität hing an `x-bind:class`, also trug der Live-Span VOR dem
    // Alpine-Boot gar keine Opazitätsklasse und stand auf 1. Beim ersten Durchlauf sprang
    // er auf 0 — mit `transition-opacity` daran also als sichtbare 150-ms-Blende.
    // Gemessen wurde damals `opacity: 0.5611` in allen drei Karten, mitten im Ausblenden.
    // Bei leerem Text sieht man das nicht; sobald die Zahl beim ersten Durchlauf schon da
    // ist, stehen beide Zeilen übereinander (im Screenshot als „VoamrVteikeeln" gesehen).
    //
    // **EXAKT `'0'` und `'1'`, kein Toleranzband:** ein Zwischenwert IST der Fehler.
    for (const k of await opazitaeten()) {
        expect(k.statisch, `statische Zeile von „${k.ort}" beim Mount`).toBe('1')
        expect(k.live, `Live-Zeile von „${k.ort}" beim Mount — ein Zwischenwert heißt: sie blendet aus`).toBe('0')
    }

    // Vorbedingung, damit der Vergleich überhaupt etwas vergleicht: JETZT ist noch keine
    // Zahl da. Ohne diese Zeile könnte das Nachladen schon durch sein und der Test
    // verglich zweimal denselben Zustand.
    const liveText = async (): Promise<string> =>
        (await page.locator('[data-ortskarte="artikel"] [data-ortskarte-live]').textContent()) ?? ''
    expect((await liveText()).trim()).toBe('')

    // Auf die BEDINGUNG warten, nicht auf eine Zeitspanne: das Nachladen hängt an
    // `requestIdleCallback` plus Relay-Antwort.
    await expect
        .poll(async () => (await liveText()).trim(), { timeout: 20_000, message: 'die Live-Zeile muss eine Zahl bekommen' })
        .not.toBe('')

    const nachher = await geometrie()

    // Die Zusage: kein Skeleton, kein Platzhalter, kein Sprung. Die beiden Spans liegen
    // absolut übereinander in einem Kasten mit fester Höhe — die Zahl kann die Geometrie
    // per Konstruktion nicht ändern. Genau das wird hier gemessen und nicht behauptet.
    expect(nachher.nav).toBe(vorher.nav)
    expect(nachher.karten).toEqual(vorher.karten)

    // Und die statische Zeile ist nicht verschwunden, sondern nur ausgeblendet — sie
    // steht weiter im DOM und hält den Kasten.
    await expect(page.locator('[data-ortskarte="artikel"] [data-ortskarte-statisch]')).toHaveCount(1)

    // Nach der Blende (150 ms, hier großzügig abgewartet) steht GENAU EINE Zeile je
    // Karte — und die beiden Karten ohne Zahl haben sich nicht mitbewegt.
    await page.waitForTimeout(600)
    const danach = Object.fromEntries((await opazitaeten()).map((k) => [k.ort, k]))
    expect(danach.artikel.statisch, 'die statische Zeile muss ganz weg sein, nicht halb').toBe('0')
    expect(danach.artikel.live, 'die Live-Zeile muss ganz da sein, nicht halb').toBe('1')
    expect(danach.chat.live, 'ohne Zahl bleibt die Live-Zeile der Chat-Karte unsichtbar').toBe('0')
    expect(danach.chat.statisch).toBe('1')
})

test('die Autorenseite ist über einen LINK erreichbar — kein Weg über die Adresszeile', async ({ page, baseURL }) => {
    // Der Punkt der Sache (Schritt 25a): P4 hat `/articles/autor/{npub}` gebaut, und
    // NICHTS hat dorthin verlinkt. Dieser Test klickt sich hin.
    const kennung = `lf-p5-autor-${rnd()}`
    publishArticle(boardWs(baseURL as string), ADMIN, ADMIN_PUB, {
        identifier: kennung,
        title: `P5Autor-${rnd()}`,
        content: 'Ein Absatz reicht.',
        publishedAt: 1_700_000_040,
    })
    const naddr = naddrEncode({ kind: 30023, pubkey: ADMIN_PUB, identifier: kennung, relays: [] })

    await loginToBoard(page)
    await page.goto(`/articles/${naddr}`)
    await expect(page.locator('[data-artikel-text]')).toBeVisible({ timeout: 20_000 })

    const link = page.locator('[data-autor-link]')
    await expect(link).toBeVisible({ timeout: 20_000 })

    // Das Ziel steht am Element, bevor geklickt wird — und es ist die npub-Form. Ein
    // Hex-Pubkey wäre in der Adresse zwar auflösbar, aber in keinem anderen Client
    // als Identität lesbar.
    const npub = npubEncode(ADMIN_PUB)
    await expect(link).toHaveAttribute('href', new RegExp(`/articles/autor/${npub}$`))

    await link.click()
    await page.waitForURL(`**/articles/autor/${npub}`, { timeout: 20_000 })

    // Angekommen: die Autorenkarte steht, und zwar OHNE Fehlzustand. Beides zusammen,
    // sonst wäre auch ein „diese npub lässt sich nicht lesen" ein bestandener Klick.
    await expect(page.locator('[data-autor-karte]')).toBeVisible({ timeout: 20_000 })
    await expect(page.locator('[data-autor-fehler]')).toHaveCount(0)

    // **Die Autorenseite trägt bewusst KEINE Ortskarten-Leiste** — sie ist eine
    // Detail-Ebene unter „Artikel", kein vierter Ort; dieselbe Regel wie bei der
    // Artikel-Vollansicht und der Repo-Seite. Der Rückweg steht im `app-header`.
    await expect(page.locator('[data-ortskarte]')).toHaveCount(0)

    // Und die Rail-Fußzeile — die Desktop-Entsprechung der Leiste — führt hier weiter
    // „Artikel" als aktiv: wer einen Autor liest, ist unter Artikel.
    await expect(page.locator('[data-rail-fuss="artikel"]')).toHaveAttribute('aria-current', 'page')
})

test('Desktop: die Artikelliste ist ab xl dreispaltig, ab 2xl vierspaltig — und die Bühne ist breiter als der Lesedeckel', async ({ page, baseURL }) => {
    // Vier Artikel, damit vier Spalten überhaupt vier Karten haben. Der erste ist die
    // hervorgehobene Karte und spannt zwei Spalten — deshalb fünf.
    for (let i = 0; i < 5; i++) {
        publishArticle(boardWs(baseURL as string), ADMIN, ADMIN_PUB, {
            identifier: `lf-p5-raster-${i}-${rnd()}`,
            title: `P5Raster-${i}-${rnd()}`,
            content: 'Kurz.',
            publishedAt: 1_700_000_050 + i,
        })
    }

    await loginToBoard(page)
    await page.goto('/articles')
    // **Auf das RASTER warten, nicht auf die Leiste.** Die Ortskarten stehen sofort
    // (Server-Markup), die Kartenliste erst nach der Relay-Antwort — und `x-show` hält
    // sie bis dahin auf `display:none`. Wer hier weitermisst, misst ein unsichtbares
    // Raster; die Sonde unten wirft dann, und das ist die richtige Reaktion.
    await expect(page.locator('[data-artikel-raster]')).toBeVisible({ timeout: 30_000 })

    /**
     * Die Spaltenzahl des KARTEN-Rasters, aus dem aufgelösten Layout.
     *
     * ── Zwei Fallen, beide beim Bauen dieses Tests eingetreten ─────────────────────
     *
     * 1. **`#buehne .grid` traf die Ortskarten-Leiste**, nicht die Kartenliste — sie
     *    steht weiter oben in der Bühne und ist selbst ein `grid`. Sie hat drei Spalten,
     *    und zwar bei JEDER Breite. Der Test war damit bei `xl` grün, ohne die
     *    Artikelliste je angesehen zu haben. Deshalb jetzt ein eigener Anker am Raster.
     *
     * 2. **`getComputedStyle().gridTemplateColumns` liefert bei `display:none` den
     *    ANGEGEBENEN Wert** statt der aufgelösten Spuren — also `repeat(4, minmax(0,
     *    1fr))`. Nach Leerzeichen zerlegt sind das drei Stücke, egal ob dort eine 3 oder
     *    eine 4 steht. Ein verstecktes Raster meldete so IMMER „3 Spalten", und genau das
     *    hat den Test bei 1440 px falsch grün und bei 1700 px falsch rot gemacht.
     *    Gezählt werden deshalb nur echte `px`-Spuren, und ein unsichtbares Raster ist
     *    ein Fehler, kein Messwert.
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

    /** Innenbreite der Inhaltsspalte der Bühne und die Wurzel-Schriftgröße dazu. */
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

    // Bei 1440 px greift `xl` (1280), nicht `2xl` (1536).
    expect(page.viewportSize()?.width).toBe(1440)
    await expect.poll(spalten, { timeout: 20_000 }).toBe(3)

    // **Der 62-rem-Lesedeckel BINDET hier nicht mehr.** Das ist die messbare Wirkung der
    // `width`-Prop bei dieser Breite: mit ihm wäre die Inhaltsspalte auf 62 rem gedeckelt,
    // ohne ihn füllt sie die Bühne. Die 96 rem sind erst jenseits von ~1856 px sichtbar —
    // das hier ist die Zusage, die bei 1440 px überhaupt prüfbar ist.
    const vor = await buehne()
    expect(vor.breite).toBeGreaterThan(Math.round(62 * vor.rem))

    // Und die Gegenprobe eine Fläche weiter: `/spaces` behält den Lesedeckel.
    await page.goto('/spaces')
    await expect(page.locator('[data-ortskarte="chat"]')).toBeVisible({ timeout: 20_000 })
    const chat = await buehne()
    expect(chat.breite).toBe(Math.round(62 * chat.rem))

    // 2xl: vier Spalten. `setViewportSize` sticht die Projekt-Vorgabe pro Test.
    await page.goto('/articles')
    await expect(page.locator('[data-artikel-raster]')).toBeVisible({ timeout: 30_000 })
    await page.setViewportSize({ width: 1700, height: 900 })
    await expect.poll(spalten, { timeout: 20_000 }).toBe(4)
})
