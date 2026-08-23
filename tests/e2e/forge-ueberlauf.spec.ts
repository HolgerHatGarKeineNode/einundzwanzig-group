import { test, expect, type Page } from './support/fixtures'
import { useZooid } from './support/zooid'
import { loginNsec } from './support/login'

const NSEC = process.env.NOSTR_TEST_NSEC as string

/**
 * ÜBERLAUF-WÄCHTER — `/forge` läuft bei 320 px nicht waagerecht über (P3, Plan
 * `2026-08-23T1745-forge-mobil-desktop-amethyst.md`, Schritt 11/12).
 *
 * 320 px ist die gemeldete Bruchstelle: die alte Vier-Tab-Bar maß dort 409 px in
 * einem 288-px-Kasten, das Dokument scrollte 105 px waagerecht (siehe der
 * Blade-Kommentar bei `⚡forge.blade.php:193-197`). `scrollable scrollable:fade`
 * an `flux:tabs` ist die Reparatur — dieser Wächter hält ihre Wirkung fest, nach
 * der vorhandenen, mutationsgeprüften Vorlage `room.spec.ts:2976-3009`.
 *
 * ── Zwei Ebenen, mit UNTERSCHIEDLICHER Bedeutung ───────────────────────────────
 * `flux:tabs scrollable` rendert `<ui-tabs-scroll-area class="overflow-auto">` um
 * die eigentliche Tab-Leiste — ein bewusst gebauter Scroll-CONTAINER, kein Zufall.
 *
 * DOKUMENT darf NIEMALS waagerecht scrollen (WCAG 1.4.10) — das ist der
 * eigentlich gemeldete Fehler, hart geprüft unten.
 *
 * Die TAB-LEISTE selbst darf sehr wohl breiter sein als ihr eigener sichtbarer
 * Ausschnitt — genau DAS ist der Zweck von `overflow-auto` plus
 * `scrollable:fade`. Belegt in der Messung, die zur Auswahl des Attributs
 * geführt hat: `docs/plans/…/messung-b.json`, `scrollable.4-de` zeigt
 * `traegerUeberlauf: 121` als AKZEPTIERTEN Ausgangszustand — ausgewählt, weil
 * `dokumentUeberlauf: 0` war, nicht weil der Container selbst überlauffrei ist.
 * Eine Assertion `container.scrollWidth <= container.clientWidth` auf einem
 * `overflow-auto`-Element verlangt, dass die Scroll-Fläche nie scrollt, und
 * schlägt genau dann fehl, wenn das Attribut wirkt — sie prüft keinen Fehler,
 * sondern die Funktionsweise der Reparatur. Deshalb steht hier KEINE solche
 * Assertion (frühere Fassung hatte eine, per `test.fail()` markiert — ersetzt,
 * s. u.).
 *
 * Was die Tab-Leiste stattdessen schuldet: JEDER Tab bleibt ERREICHBAR — beim
 * Fokussieren holt die Scroll-Area ihn vollständig in den sichtbaren Bereich.
 * Das ist die Zusage, die tatsächlich gilt (und die bislang niemand bewacht
 * hat), geprüft im zweiten Test unten.
 *
 * ── Messprotokoll, kein Testfall ────────────────────────────────────────────────
 * Die Umbenennung „Räume" → „Kanäle" (P1) macht die Beschriftung in den meisten
 * Sprachen breiter und damit die Container-Scrollstrecke länger als in der
 * Messung, die zur Auswahl von `scrollable` führte (dort noch „Räume", 67 px).
 * Das ist ein reales Verschiebe-Protokoll — festgehalten in
 * `docs/plans/2026-08-23T1745-forge-mobil-desktop-amethyst/messung-p3-tabs-
 * kanaele-sprachen.json` (App-Repo, gitignored), NICHT als Assertion hier: der
 * Container DARF scrollen, also ist „er scrollt mehr als vorher" kein
 * Fehlschlag, den ein Test einfordern sollte.
 *
 * ── Kein Buzz-Stack nötig ──────────────────────────────────────────────────────
 * Die Tab-Leiste rendert der SERVER, sobald `config('group.workspace_url')`
 * gesetzt ist (`fixtures.ts`/`serverEnv.ts` setzen das worker-eigene Relay) —
 * ob dahinter Daten liegen, ist für die Breitenfrage gleichgültig. Gleiche
 * Begründung wie in `forge-tab-adresse.spec.ts`.
 */

async function documentOverflow(page: Page): Promise<{ scrollWidth: number; clientWidth: number }> {
    return page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
    }))
}

async function openForgeAt320(page: Page): Promise<void> {
    await useZooid(page)
    await page.setViewportSize({ width: 320, height: 720 })
    await loginNsec(page, NSEC)
    await page.goto('/forge')
}

/**
 * Rand-Abstand des LETZTEN Tabs zum rechten Rand seiner Scroll-Area, gemessen
 * komplett im Browser-Kontext (kein Round-Trip pro Rect, keine Locator-Handles
 * ueber die Bridge) — negativ/0 heisst „liegt innerhalb", positiv heisst „ragt
 * ueber den sichtbaren Ausschnitt hinaus".
 */
async function letzterTabUeberstand(page: Page): Promise<number> {
    return page.evaluate(() => {
        const area = document.querySelector('ui-tabs-scroll-area')
        const tabs = Array.from(document.querySelectorAll('[data-flux-tab]'))
        const letzter = tabs.at(-1)
        if (!area || !letzter) return Number.NaN
        return Math.round(letzter.getBoundingClientRect().right - area.getBoundingClientRect().right)
    })
}

/**
 * NEGATIVKONTROLLE — beide Richtungen.
 *
 * Ein Prüfstand ohne bestandene Kontrolle ist wertlos: ohne sie wüsste niemand,
 * ob ein grüner Lauf bedeutet „es gibt keinen Überlauf" oder „die Messung
 * greift gar nicht". Die Kontrolle setzt bewusst NICHT voraus, dass die reale
 * Tab-Leiste in ihrem CONTAINER überlauffrei startet (das darf sie nicht sein,
 * s. Dateikopf) — sie beweist nur, dass ein GROSSER, eindeutig künstlicher
 * Ausschlag erkannt wird und dass die Container-Ebene ihren eigenen Überlauf
 * nicht ins Dokument durchreicht.
 *
 *   - bekannt-schlecht „container": ein 900 px breiter Spacer ALS KIND der
 *     Tab-Leiste selbst (innerhalb `[data-flux-tabs]`, also innerhalb des
 *     `overflow-auto`-Containers). Muss die Container-Messung weit über ihren
 *     Ausgangswert heben — und darf, weil der Container selbst scrollt, das
 *     Dokument NICHT mitreißen.
 *   - bekannt-schlecht „document": derselbe Spacer als Kind von `document.body`,
 *     außerhalb jedes Scroll-Containers. Muss die Dokument-Messung rot machen.
 */
test('der Ueberlauf-Waechter erkennt eine grob injizierte Sonde in BEIDEN Ebenen', async ({ page }) => {
    await openForgeAt320(page)
    const tablist = page.locator('ui-tabs-scroll-area')
    await expect(tablist).toBeVisible({ timeout: 20_000 })
    await expect(page.getByRole('tab', { name: 'Aktivität', exact: true })).toBeVisible({ timeout: 20_000 })

    const containerVorher = await tablist.evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }))

    // ── bekannt-schlecht: Sonde INNERHALB der Tab-Leiste (Container-Ebene) ────
    await page.evaluate(() => {
        const tabs = document.querySelector('[data-flux-tabs]')
        const spacer = document.createElement('div')
        spacer.setAttribute('data-forge-overflow-probe', 'container')
        spacer.style.cssText = 'display:inline-block;flex:none;min-width:900px;height:1px'
        tabs?.appendChild(spacer)
    })
    const containerSchlecht = await tablist.evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }))
    expect(
        containerSchlecht.scrollWidth,
        `Ein 900px-Spacer als Kind der Tab-Leiste wurde von der Container-Messung nicht erkannt (vorher ${containerVorher.scrollWidth}, nachher ${containerSchlecht.scrollWidth}) — der Wächter ist blind.`,
    ).toBeGreaterThan(containerVorher.scrollWidth + 800)
    // Der Container fängt seinen eigenen Überlauf (overflow-auto) — das Dokument
    // darf davon NICHT mitgerissen werden, sonst wäre die Container-Ebene
    // redundant zur Dokument-Ebene statt ein eigener Fang.
    const dokWaehrendContainerSchlecht = await documentOverflow(page)
    expect(
        dokWaehrendContainerSchlecht.scrollWidth,
        'Ein Überlauf innerhalb der Tab-Leiste hat das Dokument mitgerissen — die Container-Ebene ist dann redundant, keine eigene Sonde.',
    ).toBeLessThanOrEqual(dokWaehrendContainerSchlecht.clientWidth)

    // ── frischer Zustand vor der zweiten Sonde ────────────────────────────────
    await page.goto('/forge')
    await expect(page.getByRole('tab', { name: 'Aktivität', exact: true })).toBeVisible({ timeout: 20_000 })
    const dokVorher = await documentOverflow(page)

    // ── bekannt-schlecht: Sonde AUSSERHALB jedes Scroll-Containers (Dokument-Ebene) ──
    await page.evaluate(() => {
        const spacer = document.createElement('div')
        spacer.setAttribute('data-forge-overflow-probe', 'document')
        spacer.style.cssText = 'display:block;min-width:900px;height:1px'
        document.body.appendChild(spacer)
    })
    const dokSchlecht = await documentOverflow(page)
    // Der Spacer ist BLOCK-level (eigene Zeile): sein scrollWidth-Beitrag ist sein
    // eigener min-width (900), nicht additiv zum vorhandenen Inhalt — anders als
    // der inline-block-Spacer der Container-Sonde oben, der der bestehenden Zeile
    // hinzugefügt wird. Erwartet wird deshalb ein Wert nahe 900, nicht 900+vorher.
    expect(
        dokSchlecht.scrollWidth,
        `Ein 900px-Spacer im Dokument (außerhalb jedes Scroll-Containers) wurde von der Dokument-Messung nicht erkannt (vorher ${dokVorher.scrollWidth}, nachher ${dokSchlecht.scrollWidth}) — der Wächter ist blind.`,
    ).toBeGreaterThanOrEqual(900)
    expect(dokSchlecht.scrollWidth).toBeGreaterThan(dokSchlecht.clientWidth + 400)
})

/**
 * DER WÄCHTER SELBST, DOKUMENT-EBENE — läuft ohne Injektion gegen die echte
 * Fläche, DE, 320 px (die gemeldete Bruchstelle). Prüft den eigentlich
 * gemeldeten Fehler (409 px in einem 288-px-Kasten, 105 px Dokument-Überlauf).
 * Grün — `scrollable` trägt (mutationsgeprüft, s. Abgabebericht: mit `scrollable`
 * entfernt und HU-Labels — die größten aller acht Sprachen — läuft das Dokument
 * bei 337/320, 17 px Überlauf; mit `scrollable` wieder bei 320/320).
 */
test('/forge laeuft bei 320 px nicht waagerecht ueber — Dokument (WCAG 1.4.10)', async ({ page }) => {
    await openForgeAt320(page)
    await expect(page.getByRole('tab', { name: 'Aktivität', exact: true })).toBeVisible({ timeout: 20_000 })
    // Vorbedingung: alle drei Tabs sind wirklich gerendert, sonst misst der
    // Wächter eine leere/verkürzte Leiste und ist Dekoration.
    await expect(page.getByRole('tab')).toHaveCount(3)

    const dok = await documentOverflow(page)
    console.log(`[forge-ueberlauf] Dokument @320px: scrollWidth=${dok.scrollWidth} clientWidth=${dok.clientWidth}`)
    expect(dok.scrollWidth, `/forge läuft bei 320 px quer über — Dokument scrollWidth=${dok.scrollWidth} clientWidth=${dok.clientWidth}`)
        .toBeLessThanOrEqual(dok.clientWidth)
})

/**
 * DER WÄCHTER SELBST, ERREICHBARKEIT — die Zusage, die die Tab-Leiste bei 320 px
 * WIRKLICH schuldet: nicht „nie scrollen" (das ist ihre Funktion), sondern
 * „jeder Tab ist per Tastatur erreichbar". `Activatable.activate()`
 * (flux-pro `js/mixins/activatable.js`, kompiliert in `dist/flux.module.js`)
 * ruft beim Fokussieren `this.el.scrollIntoView({ block: "nearest" })` — dieser
 * Test hält fest, dass das für den LETZTEN, potenziell ausgescrollten Tab
 * tatsächlich passiert. Ohne diesen Mechanismus (oder bei einem Regressions-Bug
 * darin) bliebe ein Tab hinter dem sichtbaren Rand stehen — ERREICHBAR über
 * Tastatur, aber ohne dass irgendjemand ihn SEHEN kann.
 *
 * Negativkontrolle: `Element.prototype.scrollIntoView` wird vor dem Fokus zu
 * einem No-op — das MUSS die Erreichbarkeits-Prüfung rot machen, sonst prüft
 * sie nicht den Scroll-Mechanismus, sondern nur, dass der letzte Tab zufällig
 * schon im sichtbaren Bereich lag.
 */
test('der letzte Tab wird beim Fokussieren vollstaendig sichtbar (Tastatur-Erreichbarkeit, 320px)', async ({ page }) => {
    await openForgeAt320(page)
    const tablist = page.locator('ui-tabs-scroll-area')
    await expect(tablist).toBeVisible({ timeout: 20_000 })
    const tabs = page.getByRole('tab')
    await expect(tabs).toHaveCount(3)
    const letzter = tabs.last()

    // Vorbedingung: der letzte Tab ist überhaupt AUSGESCROLLT, sonst prüft der Test
    // nichts (ein Tab, der schon sichtbar ist, kann nicht unsichtbar werden).
    const vorUeberstand = await letzterTabUeberstand(page)
    expect(vorUeberstand, `Der letzte Tab liegt schon vor dem Fokus (Rand-Abstand ${vorUeberstand}px) im sichtbaren Bereich — der Test kann die Erreichbarkeits-Zusage so nicht prüfen.`)
        .toBeGreaterThan(0)

    await letzter.focus()
    // scrollIntoView läuft über den Fokus-Handler, nicht synchron mit .focus() —
    // 1px Toleranz gegen Rundung (Sub-Pixel-Layout, deviceScaleFactor).
    await expect.poll(() => letzterTabUeberstand(page), { timeout: 5_000, message: 'Der letzte Tab wurde beim Fokussieren nicht vollstaendig sichtbar' })
        .toBeLessThanOrEqual(1)
})

/**
 * KONTROLLGRUPPE zum Erreichbarkeits-Test: OHNE `scrollIntoView` bleibt der
 * letzte Tab nach dem Fokus ausserhalb des sichtbaren Bereichs — der Test oben
 * prueft also wirklich den Scroll-Mechanismus, nicht einen Zufallstreffer.
 */
test('KONTROLLE: ohne scrollIntoView bleibt der letzte Tab nach Fokus UNSICHTBAR', async ({ page }) => {
    await openForgeAt320(page)
    const tablist = page.locator('ui-tabs-scroll-area')
    await expect(tablist).toBeVisible({ timeout: 20_000 })
    const tabs = page.getByRole('tab')
    await expect(tabs).toHaveCount(3)
    const letzter = tabs.last()

    const vorUeberstand = await letzterTabUeberstand(page)
    expect(vorUeberstand, `Der letzte Tab liegt schon vor dem Fokus (Rand-Abstand ${vorUeberstand}px) im sichtbaren Bereich — die Kontrolle kann so nichts beweisen.`)
        .toBeGreaterThan(0)

    await page.evaluate(() => {
        Element.prototype.scrollIntoView = () => undefined
    })

    await letzter.focus()
    await page.waitForTimeout(500)
    const nachUeberstand = await letzterTabUeberstand(page)
    expect(nachUeberstand, 'Mit deaktiviertem scrollIntoView wurde der letzte Tab dennoch vollstaendig sichtbar — die Kontrolle beweist nichts, weil ein anderer Mechanismus denselben Effekt erzeugt.')
        .toBeGreaterThan(0)
})
