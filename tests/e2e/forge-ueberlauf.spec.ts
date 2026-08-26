import { test, expect, type Page } from './support/fixtures'
import { useZooid } from './support/zooid'
import { loginNsec } from './support/login'

const NSEC = process.env.NOSTR_TEST_NSEC as string

/**
 * ÜBERLAUF-WÄCHTER — `/forge` läuft bei 320 px nicht waagerecht über (P3, Plan
 * `2026-08-23T1745-forge-mobil-desktop-amethyst.md`, Schritt 11/12).
 *
 * 320 px ist die gemeldete Bruchstelle: die alte Vier-Tab-Bar maß dort 409 px in
 * einem 288-px-Kasten, das Dokument scrollte 105 px waagerecht (Herleitung im
 * Blade-Kommentar an der Reiterreihe in `⚡forge.blade.php`, zu finden über
 * „Gemessen bei 320 px mit den vier alten Tabs").
 *
 * **Der Verweis nennt bewusst KEINE Zeilennummer mehr.** Hier stand
 * `⚡forge.blade.php:193-197`; der Block ist seither zweimal gewandert und lag
 * beim Nachsehen bei ~258. Eine Zeilennummer in Prosa altert still — kein Test
 * wird davon rot, und der nächste Leser landet mitten in einem fremden
 * Kommentar. Ein Suchbegriff wandert mit. `scrollable scrollable:fade`
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
/**
 * Die Tab-Leiste ZWINGEN zu scrollen, bis der letzte Reiter GANZ draussen liegt —
 * Vorbedingung der beiden Erreichbarkeits-Tests unten.
 *
 * ── Warum das seit P1 (2026-08-26) nötig ist ──────────────────────────────────
 * Mit dem Fall von `variant="segmented"` ist die Leiste SCHMALER geworden: Flux'
 * Default gibt jedem Reiter `px-2` statt `px-4` und 16 px Rinne dazwischen, gegen
 * 32 px Polster je Reiter plus 8 px Schienenpolster vorher. Gemessen bei 320 px,
 * DE: der letzte Reiter liegt jetzt **19 px INNERHALB** des Ausschnitts. Drei
 * Reiter passen ohne Scrollen — der beabsichtigte Gewinn, und zugleich das Ende
 * der bisherigen Vorbedingung.
 *
 * ── Und warum die bisherige Vorbedingung ohnehin nichts hielt ─────────────────
 * Gemessen an HEAD, mit gestashter P1-Arbeit, am realen Baum (nicht geschätzt):
 * der Rand-Abstand betrug dort **1 px** bei 74 px Reiterbreite. Die Vorbedingung
 * lautete `> 0`, die Zusage danach `<= 1` — **beide waren mit demselben Wert
 * gleichzeitig erfüllt**. Der Test konnte gar nicht rot werden, egal ob
 * irgendetwas scrollt; die Kontrollgruppe daneben („ohne `scrollIntoView` bleibt
 * er draussen") war aus demselben Grund grün: 1 px bleibt 1 px. Ein toter Anker,
 * der wie ein Riegel aussah.
 *
 * ── Was WIRKLICH scrollt, gemessen ────────────────────────────────────────────
 * Drei Läufe mit verschieden breiter Sonde:
 *   - Reiter zu ~88 % verdeckt (7 px sichtbar): der Fokus scrollt **nicht**.
 *     Weder Flux' `Activatable.activate()` noch der Browser holen ihn herein.
 *   - Reiter GANZ draussen: der Fokus holt ihn auf Rand-Abstand 0 —
 *     **auch dann, wenn `Element.prototype.scrollIntoView` vorher auf ein No-op
 *     gesetzt wurde.** Das ist also nicht Flux, sondern `HTMLElement.focus()`
 *     selbst; dieser Weg läuft nicht über den JS-Prototypen.
 *
 * Daraus folgt beides: die Zusage, die diese Datei prüfen KANN, ist „ein
 * vollständig ausgescrollter Reiter wird beim Fokussieren sichtbar" (WCAG 2.2
 * SC 2.4.11, Focus Not Obscured) — und die alte Kontrollgruppe prüfte den
 * falschen Mechanismus. Sie ist unten durch eine ersetzt, die tatsächlich
 * unterscheidet: OHNE Fokus bleibt der Reiter draussen.
 *
 * Die Sonde wird aus der gemessenen Reiterbreite GERECHNET, nicht als feste Zahl
 * gesetzt — eine feste Zahl wäre sprachabhängig: „Kanäle" misst in acht Sprachen
 * acht Breiten, und in der schmalsten kippte dieselbe Zahl von „ganz draussen"
 * zurück auf „angeschnitten".
 *
 * **Nicht als Assertion festgehalten, dass die Leiste heute passt.** Sie hängt an
 * der Sprache UND am Bestandszähler des Reiters „Repositories" (`counts().repos`,
 * seit P1) — in einem Workspace mit Repos ist sie wieder breiter. Der Docstring
 * dieser Datei sagt seit jeher: der Container DARF scrollen. Die harte Zusage ist
 * der Dokument-Überlauf, und der wird oben geprüft.
 *
 * @returns die Breite der eingesetzten Sonde in px (fürs Protokoll)
 */
async function schiebeLetztenTabGanzHinaus(page: Page): Promise<number> {
    return page.evaluate(() => {
        const tabs = document.querySelector('[data-flux-tabs]')
        const area = document.querySelector('ui-tabs-scroll-area')
        const letzter = Array.from(document.querySelectorAll('[data-flux-tab]')).at(-1)
        if (!tabs || !area || !letzter) return Number.NaN

        const tabBreite = letzter.getBoundingClientRect().width
        const jetzt = letzter.getBoundingClientRect().right - area.getBoundingClientRect().right
        // Ziel: der Reiter liegt VOLLSTÄNDIG rechts ausserhalb, plus 8 px Reserve
        // gegen Sub-Pixel-Rundung.
        const breite = Math.max(1, Math.ceil(tabBreite + 8 - jetzt))

        const spacer = document.createElement('div')
        spacer.setAttribute('data-forge-overflow-probe', 'vorbedingung')
        spacer.style.cssText = `display:inline-block;flex:none;min-width:${breite}px;height:1px`
        tabs.prepend(spacer)

        return breite
    })
}

/** Breite des letzten Reiters — die Schwelle für „liegt ganz draussen". */
async function letzterTabBreite(page: Page): Promise<number> {
    return page.evaluate(() => {
        const letzter = Array.from(document.querySelectorAll('[data-flux-tab]')).at(-1)
        return letzter ? Math.round(letzter.getBoundingClientRect().width) : Number.NaN
    })
}

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

    const ohneSonde = await letzterTabUeberstand(page)
    const breite = await letzterTabBreite(page)
    console.log(`[forge-ueberlauf] letzter Tab OHNE Sonde @320px: Rand-Abstand ${ohneSonde}px bei ${breite}px Reiterbreite`)

    // Vorbedingung: der letzte Tab liegt VOLLSTÄNDIG ausserhalb — nicht bloss
    // „irgendwie > 0". Der alte Schwellwert `> 0` war mit der Zusage `<= 1`
    // gleichzeitig erfüllbar und damit vakuös (Messung am HEAD-Stand: 1 px).
    // Begründung und Messprotokoll am Helfer oben.
    const sonde = await schiebeLetztenTabGanzHinaus(page)
    const vorUeberstand = await letzterTabUeberstand(page)
    console.log(`[forge-ueberlauf] Sonde ${sonde}px → Rand-Abstand ${vorUeberstand}px`)
    expect(vorUeberstand, `Der letzte Tab liegt nach der Sonde nicht vollstaendig ausserhalb (Rand-Abstand ${vorUeberstand}px bei ${breite}px Breite) — der Test kann die Erreichbarkeits-Zusage so nicht pruefen.`)
        .toBeGreaterThanOrEqual(breite)

    await letzter.focus()
    // Das Hereinholen laeuft ueber den Fokus-Handler, nicht synchron mit .focus() —
    // 1px Toleranz gegen Rundung (Sub-Pixel-Layout, deviceScaleFactor).
    await expect.poll(() => letzterTabUeberstand(page), { timeout: 5_000, message: 'Der letzte Tab wurde beim Fokussieren nicht vollstaendig sichtbar' })
        .toBeLessThanOrEqual(1)
})

/**
 * KONTROLLGRUPPE zum Erreichbarkeits-Test: OHNE den Fokus bleibt der letzte Tab
 * ausserhalb des sichtbaren Bereichs.
 *
 * **Das ist eine ANDERE Kontrolle als bis P1 (2026-08-26).** Hier stand
 * „`Element.prototype.scrollIntoView` auf ein No-op setzen, dann muss der Tab
 * draussen bleiben" — die Annahme dahinter (Flux' `Activatable.activate()` holt
 * ihn ueber diesen Prototypen herein) ist gemessen FALSCH: mit vollstaendig
 * ausgescrolltem Tab und abgeschaltetem Prototypen landet er trotzdem auf
 * Rand-Abstand 0. Es ist `HTMLElement.focus()` selbst, und dieser Weg laeuft
 * nicht ueber den JS-Prototypen. Die alte Kontrolle blieb nur deshalb gruen, weil
 * der reale Rand-Abstand 1 px betrug und 1 px auch ohne jedes Scrollen `> 0` ist.
 *
 * Was diese Kontrolle stattdessen ausschliesst: dass der Tab aus einem ANDEREN
 * Grund als dem Fokus sichtbar wird (Autoscroll der Scroll-Area, ein spaeter
 * Layout-Lauf, ein Alpine-Effekt). Sie ist damit die Kontrolle, die zum
 * tatsaechlich gemessenen Mechanismus passt.
 */
test('KONTROLLE: OHNE Fokus bleibt der letzte Tab ausserhalb des sichtbaren Bereichs', async ({ page }) => {
    await openForgeAt320(page)
    const tablist = page.locator('ui-tabs-scroll-area')
    await expect(tablist).toBeVisible({ timeout: 20_000 })
    const tabs = page.getByRole('tab')
    await expect(tabs).toHaveCount(3)

    const breite = await letzterTabBreite(page)
    const sonde = await schiebeLetztenTabGanzHinaus(page)
    const vorUeberstand = await letzterTabUeberstand(page)
    console.log(`[forge-ueberlauf] KONTROLLE: Sonde ${sonde}px → Rand-Abstand ${vorUeberstand}px bei ${breite}px Reiterbreite`)
    expect(vorUeberstand, `Der letzte Tab liegt nach der Sonde nicht vollstaendig ausserhalb (Rand-Abstand ${vorUeberstand}px) — die Kontrolle kann so nichts beweisen.`)
        .toBeGreaterThanOrEqual(breite)

    // Bewusst KEIN focus(). Dieselbe Wartezeit wie im Test oben, damit ein spaet
    // laufender Mechanismus die Gelegenheit haette, den Tab hereinzuholen.
    await page.waitForTimeout(500)

    const nachUeberstand = await letzterTabUeberstand(page)
    expect(nachUeberstand, 'Der letzte Tab wurde OHNE Fokus vollstaendig sichtbar — dann misst der Test oben nicht den Fokus, sondern einen anderen Mechanismus.')
        .toBeGreaterThanOrEqual(breite)
})

/**
 * DIE REITERREIHE, MOBIL: 40 px hoch, und die drei Farbrollen sind die
 * gerechneten (P1, 2026-08-26).
 *
 * ── Warum die HÖHE hier steht ─────────────────────────────────────────────────
 * Unterhalb `xl` ist diese Reihe die EINZIGE Navigation zwischen Aktivität,
 * Repositories und Kanälen. Mit `variant="segmented"` steckten die Reiter in einer
 * Schiene mit `p-1` und maßen 32 px — unter Apples HIG-Maß von 44 und über dem
 * WCAG-2.5.8-Boden von 24. Flux' Default-Variante gibt ihnen die vollen `h-10`.
 * 40 px ist die Zusage, die P1 abgegeben hat; ohne diesen Riegel hinge sie an
 * einer Klasse in einem Vendor-Stub.
 *
 * ── Warum die FARBEN hier stehen ──────────────────────────────────────────────
 * P1 korrigiert zwei Textfarben von Flux' Default, weil sie WCAG reissen
 * (inaktiv `text-zinc-400` = 2,42:1 hell gegen 1.4.3; das Wort des aktiven
 * Reiters in `accent-content` = 4,21:1 und damit 0,29 unter 4,5). Die Korrektur
 * steht als UNGESCHICHTETE Regel in `theme.css` und schlägt damit jede
 * `@layer utilities` — aber genau das ist eine Annahme über die Reihenfolge im
 * GEBAUTEN Stylesheet, und dieses Haus hat schon zweimal dafür bezahlt, sie nicht
 * gemessen zu haben. Hier wird sie gemessen.
 *
 * **Parse-frei.** Verglichen werden zwei COMPUTED-Werte miteinander, nie eine
 * Zeichenkette gegen einen erwarteten Hex: `getComputedStyle` liefert für
 * Tailwind-v4-Farben `oklch`/`oklab`, und ein Zahlen-Regex darauf erfindet
 * Werte. Ein Sondenelement bekommt `color: var(--color-brand-800)`, und der
 * Reiter muss denselben computed String tragen.
 *
 * **Und eine Unterscheidungsprobe dazu**: aktiv ≠ inaktiv, und aktiv ≠ Flux'
 * Default `zinc-400`. Ohne sie wäre der Test grün, wenn ALLE drei Rollen dieselbe
 * Farbe trügen — eine Identität allein sagt nicht, dass sie etwas unterscheidet.
 */
for (const theme of ['light', 'dark'] as const) {
    test(`die Reiterreihe misst mobil 40 px und traegt die gerechneten Farbrollen (${theme})`, async ({ page }) => {
        await page.addInitScript((t) => {
            try {
                localStorage.setItem('flux.appearance', t as string)
            } catch {
                /* kein localStorage → der Lauf misst dann das Default-Theme */
            }
        }, theme)
        await openForgeAt320(page)
        await expect(page.getByRole('tab')).toHaveCount(3)
        if (theme === 'dark') {
            await expect(page.locator('html')).toHaveClass(/dark/, { timeout: 15_000 })
        } else {
            await expect(page.locator('html')).not.toHaveClass(/dark/, { timeout: 15_000 })
        }

        // ── Höhe: jeder Reiter, nicht nur der erste ──────────────────────────
        const hoehen = await page.evaluate(() =>
            Array.from(document.querySelectorAll('[data-flux-tab]')).map((el) =>
                Math.round(el.getBoundingClientRect().height),
            ),
        )
        console.log(`[forge-reiter] ${theme}: Reiterhoehen @320px = ${JSON.stringify(hoehen)}`)
        expect(hoehen.length).toBe(3)
        for (const h of hoehen) {
            expect(h, `Ein Reiter misst ${h}px statt der zugesagten 40 — die mobile Navigation faellt unter das Touch-Mass.`)
                .toBeGreaterThanOrEqual(40)
        }

        // ── Farbrollen, computed gegen computed ─────────────────────────────
        const farben = await page.evaluate(() => {
            const probe = document.createElement('span')
            document.body.appendChild(probe)
            const aufgeloest = (ausdruck: string): string => {
                probe.style.color = ''
                probe.style.color = ausdruck
                return getComputedStyle(probe).color
            }
            const tabs = Array.from(document.querySelectorAll('[data-flux-tab]')) as HTMLElement[]
            const aktiv = tabs.find((t) => t.hasAttribute('data-selected')) ?? null
            const inaktiv = tabs.find((t) => !t.hasAttribute('data-selected')) ?? null
            const ergebnis = {
                aktivText: aktiv ? getComputedStyle(aktiv).color : '',
                aktivLinie: aktiv ? getComputedStyle(aktiv).borderBottomColor : '',
                inaktivText: inaktiv ? getComputedStyle(inaktiv).color : '',
                sollAktivHell: aufgeloest('var(--color-brand-800)'),
                sollAktivDunkel: aufgeloest('var(--color-accent-content)'),
                sollInaktiv: aufgeloest('var(--color-muted)'),
                sollLinie: aufgeloest('var(--color-accent-content)'),
                // Flux' EIGENER Default für die inaktive Beschriftung — hell
                // `text-zinc-400`, dunkel `text-white/50`. Beide Zweige braucht es:
                // im dunklen Modus ist `--color-muted` SELBST zinc-400, ein
                // Vergleich gegen zinc-400 wäre dort per Konstruktion falsch
                // (erster Lauf genau so rot geworden). Gegen `white/50` trennt er.
                fluxDefaultInaktivHell: aufgeloest('var(--color-zinc-400)'),
                fluxDefaultInaktivDunkel: aufgeloest('rgb(255 255 255 / 0.5)'),
            }
            probe.remove()
            return ergebnis
        })
        console.log(`[forge-reiter] ${theme}: ${JSON.stringify(farben)}`)

        expect(farben.aktivText, 'kein aktiver Reiter gefunden — die Messung waere leer').not.toBe('')
        expect(farben.inaktivText, 'kein inaktiver Reiter gefunden — die Messung waere leer').not.toBe('')

        // Die Linie trägt den Zustand (1.4.11, 3:1) und bleibt Flux' accent-content.
        expect(farben.aktivLinie, 'der Unterstrich des aktiven Reiters traegt nicht mehr accent-content — die 1.4.11-Zusage haengt an ihm')
            .toBe(farben.sollLinie)
        // Das Wort trägt 1.4.3 und ist deshalb hell brand-800, dunkel accent-content.
        expect(farben.aktivText, 'das Wort des aktiven Reiters traegt nicht die gerechnete Farbe — die Korrektur in theme.css greift nicht mehr')
            .toBe(theme === 'dark' ? farben.sollAktivDunkel : farben.sollAktivHell)
        expect(farben.inaktivText, 'die inaktive Beschriftung traegt nicht --color-muted — dann steht wieder Flux zinc-400 da und 1.4.3 reisst')
            .toBe(farben.sollInaktiv)

        // Unterscheidungsprobe: die drei Rollen sind nicht dieselbe Farbe.
        expect(farben.aktivText, 'aktiv und inaktiv sind farbgleich — der Zustand haette dann nur noch die Linie').not.toBe(farben.inaktivText)
        expect(
            farben.inaktivText,
            'die inaktive Beschriftung traegt Flux\' unkorrigierten Default — die Korrektur ist wirkungslos',
        ).not.toBe(theme === 'dark' ? farben.fluxDefaultInaktivDunkel : farben.fluxDefaultInaktivHell)
    })
}
