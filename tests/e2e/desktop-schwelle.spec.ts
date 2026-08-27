import { test, expect, type Page } from './support/fixtures'
import { useZooid } from './support/zooid'
import { loginNsec } from './support/login'

const NSEC = process.env.NOSTR_TEST_NSEC as string

/**
 * DIE EINE SCHWELLE — die Insel und das Stylesheet schalten bei DERSELBEN Breite
 * um, auch wenn die Standardschrift des Browsers nicht 16 px ist (P2 des Plans
 * `2026-08-26T1912-forge-buzz-gitea-sprache.md`, Schritte 1 und 2).
 *
 * ── Der Befund, der diesen Riegel nötig macht ─────────────────────────────────
 * Tailwind v4 emittiert `@media (width>=80rem)` — am gebauten Stylesheet
 * nachgesehen steht dort KEINE einzige px-Schwelle. `js/viewport.ts` fragte bis
 * P2 `matchMedia('(min-width: 1280px)')`. Bei 16 px Standardschrift fallen beide
 * exakt zusammen; deshalb ist das Paar nie auseinandergelaufen, obwohl es nie
 * dasselbe MASS hatte.
 *
 * `rem` in einer MEDIA QUERY bezieht sich auf den INITIALEN `font-size`-Wert, also
 * auf die Standardschrift des BROWSERS — nicht auf `html { font-size }`. Stellt
 * ein Nutzer sie auf 20 px (eine reguläre Barrierefreiheits-Einstellung, genau der
 * Fall von WCAG 1.4.4), greift `xl:` erst ab 1600 px. Ein px-Literal in der Insel
 * schaltete weiter ab 1280 px. **Dazwischen lag ein 320 px breites Band**, in dem
 * die Insel „Desktop" sagte und das Layout mobil rendert — gemessen, binär
 * eingegrenzt, protokolliert in
 * `docs/plans/2026-08-26T1912-forge-buzz-gitea-sprache/p2-band-messung-VOR-fix.log`
 * (App-Repo).
 *
 * Das war nicht kosmetisch: `⚡room.blade.php` schaltet an genau diesem Flag `role`
 * zwischen `complementary` und `dialog`, entfernt `aria-modal` und setzt den Fokus
 * NUR im Nicht-Desktop-Zweig.
 *
 * ── Warum am ECHTEN Paar gemessen wird und nicht an zwei Zeichenketten ────────
 * „Beide sagen 80rem" ist eine Aussage über Quelltext. Geprüft wird stattdessen
 * das VERHALTEN: `$store.viewport.desktop` gegen die gerenderte `display` der
 * Reiterleiste, die `xl:hidden` trägt (`⚡forge.blade.php`). Das ist genau das
 * Paar, das auseinanderlief — und es bliebe auch dann bewacht, wenn jemand die
 * Schwelle künftig aus einer anderen Quelle zöge.
 *
 * Die Standardschrift wird über CDP `Page.setFontSizes` gestellt; das ist derselbe
 * Weg wie chrome://settings → Schriftgröße und wirkt auf die `rem`-Basis von
 * Media Queries.
 *
 * ── Die 16-px-Reihe ist die NEGATIVKONTROLLE ──────────────────────────────────
 * Sie muss ebenfalls durchlaufen. Wäre sie rot, misst die Sonde etwas anderes als
 * die Schriftgröße — dann sagt eine grüne 20-px-Reihe nichts.
 */

/** Breiten um beide Schwellen herum (1280 bei 16 px, 1600 bei 20 px). */
const BREITEN = [1024, 1279, 1280, 1281, 1440, 1599, 1600, 1601, 1920]

async function stelleStandardschrift(page: Page, px: number): Promise<void> {
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Page.setFontSizes', { fontSizes: { standard: px, fixed: px } })
}

/**
 * Sagt die Insel „Desktop", und was sagt das Stylesheet?
 *
 * `[data-forge-tabs]` trägt `xl:hidden` — ab der xl-Schwelle ist es `display:none`.
 * `desktop === true` und `display === 'none'` gehören also zusammen.
 */
async function paar(page: Page): Promise<{ insel: boolean; cssVersteckt: boolean; anzeige: string }> {
    return page.evaluate(() => {
        const el = document.querySelector('[data-forge-tabs]')
        const anzeige = el ? getComputedStyle(el).display : 'FEHLT'
        return {
            insel: !!(window as unknown as { Alpine?: { store: (n: string) => { desktop?: boolean } } }).Alpine?.store('viewport')?.desktop,
            cssVersteckt: anzeige === 'none',
            anzeige,
        }
    })
}

for (const schrift of [16, 20] as const) {
    test(`Insel und Stylesheet schalten bei derselben Breite um (Standardschrift ${schrift} px)`, async ({ page }) => {
        await useZooid(page)
        await stelleStandardschrift(page, schrift)
        await page.setViewportSize({ width: 1024, height: 800 })
        await loginNsec(page, NSEC)
        await page.goto('/forge')
        await expect(page.locator('[data-forge-tabs]')).toHaveCount(1, { timeout: 20_000 })

        // Vorbedingung: die Schriftgröße ist wirklich gestellt. Ohne diese Zeile
        // liefe die 20-px-Reihe womöglich mit 16 px und wäre trivial grün.
        const gemesseneSchrift = await page.evaluate(() => {
            const p = document.createElement('p')
            p.style.cssText = 'font-size:medium;position:absolute;visibility:hidden'
            document.body.appendChild(p)
            const px = parseFloat(getComputedStyle(p).fontSize)
            p.remove()
            return px
        })
        expect(gemesseneSchrift, `die Standardschrift steht auf ${gemesseneSchrift}px statt ${schrift}px — die Sonde misst dann etwas anderes`).toBe(schrift)

        const reihe: string[] = []
        const abweichungen: string[] = []
        for (const w of BREITEN) {
            await page.setViewportSize({ width: w, height: 800 })
            // `matchMedia` feuert synchron mit dem Resize, der Alpine-Listener
            // hängt daran — ein Frame Luft gegen die Reihenfolge im Event-Loop.
            await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))))
            const p = await paar(page)
            reihe.push(`${w}px: Insel=${p.insel} CSS-versteckt=${p.cssVersteckt} (display:${p.anzeige})`)
            if (p.insel !== p.cssVersteckt) {
                abweichungen.push(`${w}px — Insel sagt ${p.insel ? 'Desktop' : 'Mobil'}, Stylesheet rendert ${p.cssVersteckt ? 'Desktop' : 'Mobil'}`)
            }
        }
        console.log(`[schwelle] ${schrift}px Standardschrift:\n  ${reihe.join('\n  ')}`)

        // Der Riegel darf nicht dadurch grün werden, dass die Insel NIE „Desktop"
        // sagt: die Reihe muss beide Zustände enthalten, sonst prüft sie nichts.
        const zustaende = new Set(reihe.map((z) => z.includes('Insel=true')))
        expect(zustaende.size, `die Reihe zeigt nur EINEN Zustand — bei ${schrift}px Standardschrift wurde die Schwelle gar nicht überschritten`).toBe(2)

        expect(abweichungen, `Insel und Stylesheet laufen auseinander:\n${abweichungen.join('\n')}`).toEqual([])
    })
}

/**
 * DER INHALTSDECKEL WÄCHST MONOTON — er darf nicht FALLEN, während das Fenster
 * wächst (P2, Schritt 4).
 *
 * ── Der Befund ────────────────────────────────────────────────────────────────
 * `app-shell.blade.php` trug zwei Polsterstufen an derselben Bühne: `xl:px-8` und
 * `2xl:px-12`. An der 2xl-Schwelle springt das Polster von 32 auf 48 px, die
 * Spalte wächst aber nur um 1 px mit — der Inhaltsdeckel FIEL dort um 31 px.
 * Gemessen am gerenderten Element über alle 641 Breiten von 1280 bis 1920 px:
 * 1535 px → 1151 px, **1536 px → 1120 px**. Protokoll (volle Reihe, vorher und
 * nachher):
 * `docs/plans/2026-08-26T1912-forge-buzz-gitea-sprache/p2-inhaltsdeckel-messreihe.log`
 * (App-Repo).
 *
 * Das ist keine Kosmetik: ein Raster, das bei 1535 px vier Spalten trägt, fällt
 * bei 1536 px auf drei zurück — beim Ziehen des Fensters nach RECHTS. Niemand
 * rechnet damit, und niemand findet die Ursache, weil sie in einer Klasse an
 * einem ganz anderen Element steht.
 *
 * Ersetzt durch `xl:px-[clamp(2rem,2.5vw,3rem)]`: trifft beide bisherigen
 * Endpunkte exakt (1280 px → 32 px, 1920 px → 48 px) und verbindet sie stetig.
 *
 * ── Warum nicht jeder Pixel geprüft wird ──────────────────────────────────────
 * Die volle 1-px-Reihe steht im Protokoll; ein Riegel, der sie bei jedem Lauf
 * nachfährt, kostet 641 Layout-Runden. Geprüft wird stattdessen ein Raster von
 * 8 px PLUS die Nachbarschaften der Schwellen, an denen ein Sprung überhaupt
 * entstehen kann (2xl = 1536 px) und der Rand. Ein Rückwärtsschritt entsteht
 * an einer BREAKPOINT-Kante, nicht an einer beliebigen Breite — genau die sind
 * hier einzeln drin.
 */
test('der Inhaltsdeckel faellt nie, waehrend das Fenster waechst (1280–1920 px)', async ({ page }) => {
    await useZooid(page)
    await page.setViewportSize({ width: 1280, height: 900 })
    await loginNsec(page, NSEC)
    await page.goto('/forge')
    await expect(page.locator('#buehne')).toHaveCount(1, { timeout: 20_000 })

    const breiten = new Set<number>()
    for (let w = 1280; w <= 1920; w += 8) breiten.add(w)
    // Die Schwellen-Nachbarschaften und die Ränder einzeln — dort entsteht ein
    // Sprung, wenn er entsteht.
    for (const w of [1280, 1281, 1439, 1440, 1441, 1535, 1536, 1537, 1919, 1920]) breiten.add(w)
    const reihe: { w: number; deckel: number }[] = []
    for (const w of [...breiten].sort((a, b) => a - b)) {
        await page.setViewportSize({ width: w, height: 900 })
        const deckel = await page.evaluate(() => {
            const main = document.querySelector('#buehne') as HTMLElement
            const inner = main.firstElementChild as HTMLElement
            return Math.round(inner.getBoundingClientRect().width)
        })
        reihe.push({ w, deckel })
    }

    // Vorbedingung: der Deckel ändert sich über die Reihe überhaupt. Wäre er
    // konstant, wäre „monoton" trivial wahr und der Riegel wertlos.
    const spanne = Math.max(...reihe.map((r) => r.deckel)) - Math.min(...reihe.map((r) => r.deckel))
    expect(spanne, 'der Inhaltsdeckel ändert sich über 1280–1920 px gar nicht — der Riegel prüft dann nichts').toBeGreaterThan(300)

    const rueckwaerts: string[] = []
    const grosseSpruenge: string[] = []
    for (let i = 1; i < reihe.length; i++) {
        const d = reihe[i].deckel - reihe[i - 1].deckel
        if (d < 0) rueckwaerts.push(`${reihe[i - 1].w}px (${reihe[i - 1].deckel}) → ${reihe[i].w}px (${reihe[i].deckel}): ${d}px`)
        if (Math.abs(d) > 200) grosseSpruenge.push(`${reihe[i - 1].w}px → ${reihe[i].w}px: ${d}px`)
    }
    console.log(`[deckel] ${reihe.length} Breiten, ${reihe[0].deckel}px → ${reihe.at(-1)!.deckel}px, groesster Schritt ${Math.max(...reihe.slice(1).map((r, i) => Math.abs(r.deckel - reihe[i].deckel)))}px`)

    expect(rueckwaerts, `Der Inhaltsdeckel FÄLLT, während das Fenster wächst:\n${rueckwaerts.join('\n')}`).toEqual([])
    expect(grosseSpruenge, `Sprung über 200 px zwischen zwei benachbarten Breiten:\n${grosseSpruenge.join('\n')}`).toEqual([])
})
