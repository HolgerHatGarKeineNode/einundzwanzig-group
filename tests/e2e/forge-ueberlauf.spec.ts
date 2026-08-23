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
 * ── Zwei Ebenen, weil eine nicht reicht (dieselbe Begründung wie dort) ────────
 * `flux:tabs scrollable` rendert `<ui-tabs-scroll-area class="overflow-auto">` um
 * die eigentliche Tab-Leiste. Ein zu breites KIND darin (ein Tab-Label, das durch
 * eine neue Sprache wächst; ein Bug in `scrollable:fade`) erzeugt eine EIGENE
 * horizontale Scrollbar innerhalb dieses Containers — das Dokument bleibt dabei
 * sauber, ein reiner `documentElement`-Wächter meldet grün. Umgekehrt fängt eine
 * Container-Messung allein keinen Überlauf, der AUSSERHALB der Tab-Leiste
 * entsteht. Deshalb werden BEIDE gemessen.
 *
 * ── BEFUND, kein Testfehler: die Tab-Leiste ist bei 320 px/DE derzeit NICHT
 *    überlauffrei ────────────────────────────────────────────────────────────
 * Gemessen (2026-08-23, live gegen diese Fläche): die Tab-Leiste („Aktivität",
 * „Repositories", „Kanäle") misst 293 px Inhalt in einem 288-px-Kasten — 5 px
 * Überlauf, absorbiert vom `overflow-auto`-Container, DOKUMENT bleibt bei
 * 320/320 sauber. Ursache: die Beschriftung „Kanäle" (P1, „Namenskollision beim
 * Workspace-Tab") ist 7 px breiter als „Räume", mit dem die Messungen in
 * `docs/plans/…/messung-b.json` (`scrollable.3-de`: 286/288, KEIN Überlauf)
 * durchgeführt wurden — die Umbenennung wurde nie gegen die 288-px-Passform
 * nachgemessen. Betrifft 7 von 8 Sprachen (nur `pl` passt exakt): en +12, es
 * +12, pt +5, nl +19, hu +33, lv +12 (`docs/plans/…/dbg-forge-ueberlauf-
 * sprachen.json`, in derselben Messung erhoben). Dieser Test bleibt deshalb bei
 * der Tab-Leisten-Assertion ROT — bewusst: er behauptet nicht mehr, als
 * gemessen wurde, und die Alternative (Schwelle aufweichen) würde den Fund
 * verdecken statt ihn zu melden. Siehe Abgabebericht für Einordnung und
 * Fix-Kandidat.
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
 * NEGATIVKONTROLLE — beide Richtungen.
 *
 * Ein Prüfstand ohne bestandene Kontrolle ist wertlos: ohne sie wüsste niemand,
 * ob ein grüner Lauf bedeutet „es gibt keinen Überlauf" oder „die Messung
 * greift gar nicht". Die Kontrolle setzt bewusst NICHT voraus, dass die reale
 * Tab-Leiste sauber startet (das ist die eigenständige Frage des Tests
 * darunter, und sie ist derzeit NICHT sauber, s.o.) — sie beweist nur, dass ein
 * GROSSER, eindeutig künstlicher Ausschlag erkannt wird und dass die
 * Container-Ebene ihren eigenen Überlauf nicht ins Dokument durchreicht.
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
 * DER WÄCHTER SELBST, TABLIST-EBENE — bekannter, offener Befund (s. Dateikopf):
 * die „Kanäle"-Umbenennung (P1) wurde nie gegen die 288-px-Passform der
 * Tab-Leiste nachgemessen und überschreitet sie in 7 von 8 Sprachen (DE +5 px).
 * `test.fail()` MARKIERT das bewusst, statt es zu verschweigen oder die
 * Schwelle aufzuweichen: die Assertion bleibt scharf (`<= clientWidth`, keine
 * Toleranz), der Lauf zählt den derzeitigen Fehlschlag als ERWARTET und bricht
 * das Verkettungs-Tor deshalb nicht ab. Sobald das Layout nachgezogen ist (oder
 * die Toleranz bewusst akzeptiert und die DoD entsprechend korrigiert wird),
 * wird dieser Test unerwartet GRÜN — Playwright meldet das dann als eigenen
 * Fehler, und `test.fail()` fliegt hier raus.
 */
test.fail(
    '/forge laeuft bei 320 px nicht waagerecht ueber — Tab-Leiste (WCAG 1.4.10) — BEKANNTER BEFUND, s. Dateikopf',
    async ({ page }) => {
        await openForgeAt320(page)
        const tablist = page.locator('ui-tabs-scroll-area')
        await expect(tablist).toBeVisible({ timeout: 20_000 })
        await expect(page.getByRole('tab', { name: 'Aktivität', exact: true })).toBeVisible({ timeout: 20_000 })
        await expect(page.getByRole('tab')).toHaveCount(3)

        const container = await tablist.evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }))
        console.log(`[forge-ueberlauf] Tablist @320px: scrollWidth=${container.scrollWidth} clientWidth=${container.clientWidth}`)
        expect(
            container.scrollWidth,
            `Die Tab-Leiste von /forge scrollt bei 320 px horizontal — scrollWidth=${container.scrollWidth} clientWidth=${container.clientWidth}`,
        ).toBeLessThanOrEqual(container.clientWidth)
    },
)
