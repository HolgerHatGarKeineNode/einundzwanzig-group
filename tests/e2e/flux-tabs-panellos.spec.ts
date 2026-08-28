import { test, expect, type Page } from './support/fixtures'
import { useZooid } from './support/zooid'
import { loginNsec } from './support/login'

const NSEC = process.env.NOSTR_TEST_NSEC as string

/**
 * **Die Schutzhülle um `flux:tabs` OHNE `flux:tab.group`.**
 *
 * Vier Flächen benutzen `flux:tabs` als reinen Alpine-Filter, ohne Panels (`⚡forge`,
 * `⚡forge-repo`, `⚡forge-pull`, `⚡updates`). Flux' `UITabs.mount()` hängt einen
 * MutationObserver an das eigene `<ui-tabs>` und ruft darin ungeprüft
 * `selected.el.closest("ui-tab-group").showPanel(…)` (flux-pro 2.17.0,
 * `dist/flux.js:16137-16138`). Ohne Tab-Gruppe ist das `null` ⇒
 * `Cannot read properties of null (reading 'showPanel')`.
 *
 * ── Was diese Datei bewacht, und was nicht ──────────────────────────────────────────
 *
 * Dass der Fehler AUSBLEIBT, urteilt bereits der Laufzeit-Wächter
 * (`support/pageErrorGuard.ts`) über jeden Test dieser Datei — und für `/forge`
 * zusätzlich über die drei Sonden in `forge-ueberlauf.spec.ts`, die `<ui-tabs>` von
 * aussen anfassen. Hier steht deshalb der MECHANISMUS: dass die Hülle da ist, dass sie
 * layoutneutral ist und dass ihr `showPanel()` folgenlos bleibt. Ohne diese drei
 * Zusagen wäre ein grüner Wächter auch mit einer Hülle vereinbar, die zufällig gerade
 * nichts kaputt macht.
 *
 * `/updates` wird über `Livewire.navigate` angesteuert, nicht über `page.goto`: die
 * Reparatur hat drei Verdrahtungszweige, und `goto` prüfte nur den ersten.
 *   1. erster Boot (`customElements.whenDefined('ui-tabs')`),
 *   2. nach dem Body-Swap (`livewire:navigated`) — die Hülle des alten Baums ist weg,
 *   3. VOR jeder Navigation (`livewire:navigating`) muss die Hülle wieder ausgebaut
 *      sein, weil Livewire dort den HTML-Schnappschuss für den Zurück-Knopf zieht.
 *      Zweig 3 ist der teuerste Fund dieser Reparatur: ohne ihn kommt die Hülle beim
 *      Zurückgehen als HTML wieder herein, und dann verlangt Flux' `initializeTab()`
 *      Panels und wirft `Could not find panel...` — gemessen am 2026-08-28 an
 *      `updates.spec.ts` Anker 2 und Anker 3, je 3×. Der letzte Test unten hält
 *      genau diesen Weg fest.
 */

const HUELLE = 'ui-tab-group[data-flux-tabs-panellos]'

type HuellenBefund = {
    huelleGefunden: boolean
    /** Trägt die Hülle das Merkmal dieser Reparatur (statt einer echten Flux-Gruppe)? */
    istUnsereHuelle: boolean
    /** `contents` — sonst schöbe sich ein Layout-Kasten zwischen Scroll-Area und Leiste. */
    display: string | null
    /** Muss 1 sein und `ui-tabs`: nur dann hat `walkPanels()` nichts zu zeigen/verstecken. */
    kinder: string[]
    /** Existiert die Flux-Methode überhaupt? Sonst ist das Element nicht upgegradet. */
    hatShowPanel: boolean
    /** Eine falsche ARIA-Rolle über der Tablist wäre der Preis einer echten Tab-Gruppe. */
    rollenInDerKette: string[]
}

async function huellenBefund(page: Page): Promise<HuellenBefund> {
    return page.evaluate((sel) => {
        const tabs = document.querySelector('ui-tabs')
        const huelle = tabs?.closest('ui-tab-group') as (HTMLElement & { showPanel?: unknown }) | null
        const rollen: string[] = []
        let el: Element | null = tabs
        while (el && el !== document.body) {
            const rolle = el.getAttribute('role')
            if (rolle) {
                rollen.push(`${el.localName}[role=${rolle}]`)
            }
            el = el.parentElement
        }
        return {
            huelleGefunden: huelle !== null,
            istUnsereHuelle: huelle?.matches(sel) ?? false,
            display: huelle ? getComputedStyle(huelle).display : null,
            kinder: huelle ? Array.from(huelle.children).map((k) => k.localName) : [],
            hatShowPanel: typeof huelle?.showPanel === 'function',
            rollenInDerKette: rollen,
        }
    }, HUELLE)
}

/**
 * Ruft `showPanel()` DIREKT auf der Hülle auf — der Aufruf, den Flux' Observer macht —
 * und meldet, was er im Baum angerichtet hat. Beides muss leer bleiben: eine echte
 * Tab-Gruppe versteckte hier alles, was sie für ein Panel hält, und das wäre bei
 * `scrollable` der Wrapper der Reiterbank selbst (gemessen 2026-08-28: `hidden` +
 * `role="tabpanel"` auf `<ui-tabs-scroll-area>`s Elternteil, Leiste unsichtbar).
 */
async function folgenVonShowPanel(page: Page): Promise<{ versteckt: string[]; tabpanels: string[]; leisteSichtbar: boolean }> {
    return page.evaluate(() => {
        const tabs = document.querySelector('ui-tabs')
        const huelle = tabs?.closest('ui-tab-group') as (HTMLElement & { showPanel?: (n: string) => void }) | null
        huelle?.showPanel?.('ein-name-den-es-nicht-gibt')
        const wurzel = huelle?.parentElement ?? document.body
        return {
            versteckt: Array.from(wurzel.querySelectorAll('[hidden]')).map((e) => e.localName),
            tabpanels: Array.from(wurzel.querySelectorAll('[role="tabpanel"]')).map((e) => e.localName),
            leisteSichtbar: tabs ? (tabs as HTMLElement).checkVisibility() : false,
        }
    })
}

/**
 * Die Mutation, die den Fehler auslöst: ein Element als DIREKTES Kind von `<ui-tabs>`.
 * Der Observer läuft ohne `subtree` — tiefer eingehängt (etwa in `ui-tabs-scroll-area`)
 * erreicht ihn nichts, gemessen am 2026-08-28. Der Rückgabewert belegt, dass die Sonde
 * wirklich dort gelandet ist; sonst prüfte der Test hinterher eine Mutation, die es nie
 * gab.
 */
async function sondeInDieLeiste(page: Page): Promise<boolean> {
    return page.evaluate(() => {
        const tabs = document.querySelector('ui-tabs')
        if (!tabs) {
            return false
        }
        const sonde = document.createElement('div')
        sonde.setAttribute('data-panellos-sonde', '')
        sonde.style.cssText = 'display:inline-block;flex:none;min-width:1px;height:1px'
        tabs.prepend(sonde)
        return tabs.firstElementChild === sonde
    })
}

test('/forge: die Panel-lose Reiterbank steht in einer leeren, layoutneutralen Tab-Gruppe', async ({ page }) => {
    await useZooid(page)
    await page.setViewportSize({ width: 320, height: 720 })
    await loginNsec(page, NSEC)
    await page.goto('/forge')
    await expect(page.getByRole('tab')).toHaveCount(3)
    await expect(page.locator(HUELLE)).toBeAttached({ timeout: 10_000 })

    const befund = await huellenBefund(page)
    console.log(`[panellos] /forge: ${JSON.stringify(befund)}`)
    expect(befund.huelleGefunden, 'Ohne `ui-tab-group`-Vorfahr wirft Flux bei jeder childList-Mutation an <ui-tabs>').toBe(true)
    expect(befund.istUnsereHuelle).toBe(true)
    expect(befund.display, 'Eine Hülle ohne `display: contents` schöbe einen Kasten in die Scroll-Area').toBe('contents')
    expect(befund.kinder, 'Nur <ui-tabs> als Kind — sonst hält Flux das Geschwister für ein Panel und versteckt es').toEqual(['ui-tabs'])
    expect(befund.hatShowPanel, 'Das Element ist kein aufgewertetes Flux-UITabGroup — dann trüge es die Methode nicht').toBe(true)
    expect(befund.rollenInDerKette, 'Über der Tablist darf keine tabpanel-Rolle stehen').toEqual(['ui-tabs[role=tablist]'])
})

test('/forge: showPanel() auf der Hülle bleibt folgenlos, auch nach einer Mutation an <ui-tabs>', async ({ page }) => {
    await useZooid(page)
    await page.setViewportSize({ width: 320, height: 720 })
    await loginNsec(page, NSEC)
    await page.goto('/forge')
    await expect(page.getByRole('tab')).toHaveCount(3)
    await expect(page.locator(HUELLE)).toBeAttached({ timeout: 10_000 })

    const gelandet = await sondeInDieLeiste(page)
    expect(gelandet, 'Die Sonde ist nicht als direktes Kind von <ui-tabs> gelandet — der Test prüft dann nichts').toBe(true)

    // Der Observer feuert asynchron; erst danach hat der Aufruf stattgefunden, den
    // der Laufzeit-Wächter beurteilt.
    await expect(page.locator('ui-tabs-scroll-area')).toBeVisible()
    const folgen = await folgenVonShowPanel(page)
    console.log(`[panellos] /forge nach Sonde + showPanel: ${JSON.stringify(folgen)}`)
    expect(folgen.versteckt).toEqual([])
    expect(folgen.tabpanels).toEqual([])
    expect(folgen.leisteSichtbar).toBe(true)
    await expect(page.getByRole('tab')).toHaveCount(3)
})

test('/updates: die Hülle wird auch nach einer wire:navigate-Navigation gezogen', async ({ page }) => {
    await useZooid(page)
    await page.setViewportSize({ width: 320, height: 720 })
    await loginNsec(page, NSEC)
    await page.goto('/forge')
    await expect(page.getByRole('tab')).toHaveCount(3)

    await page.evaluate(() => (window as unknown as { Livewire: { navigate: (u: string) => void } }).Livewire.navigate('/updates'))
    await expect(page).toHaveURL(/\/updates$/, { timeout: 25_000 })
    await expect(page.getByRole('tab')).toHaveCount(3)
    // Die Hülle wird nach dem Body-Swap erst in einem Makrotask gezogen — auf sie
    // warten, nicht auf eine Wartezeit.
    await expect(page.locator(HUELLE)).toBeAttached({ timeout: 10_000 })

    const befund = await huellenBefund(page)
    console.log(`[panellos] /updates: ${JSON.stringify(befund)}`)
    expect(befund.istUnsereHuelle, 'Nach dem Body-Swap ist die Hülle des alten Baums weg — sie muss neu gezogen werden').toBe(true)
    expect(befund.kinder).toEqual(['ui-tabs'])
    expect(befund.rollenInDerKette).toEqual(['ui-tabs[role=tablist]'])

    const gelandet = await sondeInDieLeiste(page)
    expect(gelandet).toBe(true)
    await expect(page.getByRole('tab')).toHaveCount(3)
})

test('zurueck-Navigation: die Huelle steht in keinem Livewire-Schnappschuss', async ({ page }) => {
    await useZooid(page)
    await page.setViewportSize({ width: 320, height: 720 })
    await loginNsec(page, NSEC)
    await page.goto('/updates')
    await expect(page.getByRole('tab')).toHaveCount(3)
    await expect(page.locator(HUELLE)).toBeAttached({ timeout: 10_000 })

    // Weg von hier — genau hier zieht Livewire den Schnappschuss dieser Seite.
    await page.evaluate(() => (window as unknown as { Livewire: { navigate: (u: string) => void } }).Livewire.navigate('/forge'))
    await expect(page).toHaveURL(/\/forge$/, { timeout: 25_000 })
    await expect(page.getByRole('tab')).toHaveCount(3)

    // ... und zurück: der gespeicherte HTML-Stand wird wieder eingesetzt. Steckte die
    // Hülle darin, fände Flux beim Initialisieren eine Gruppe ohne Panels vor und
    // würfe 3× `Could not find panel...` — der Laufzeit-Wächter urteilt darüber.
    await page.goBack()
    await expect(page).toHaveURL(/\/updates$/, { timeout: 25_000 })
    await expect(page.getByRole('tab')).toHaveCount(3)

    // Und die Hülle ist danach wieder da, sonst wäre die Seite ab hier ungeschützt.
    await expect(page.locator(HUELLE)).toBeAttached({ timeout: 10_000 })
    const befund = await huellenBefund(page)
    console.log(`[panellos] /updates nach goBack: ${JSON.stringify(befund)}`)
    expect(befund.kinder).toEqual(['ui-tabs'])
    expect(befund.rollenInDerKette).toEqual(['ui-tabs[role=tablist]'])

    const gelandet = await sondeInDieLeiste(page)
    expect(gelandet).toBe(true)
    await expect(page.getByRole('tab')).toHaveCount(3)
})
