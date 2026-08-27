/**
 * P9.2 — die Rail-Träger des Kontrast-Ankers, die nur ab `xl` existieren.
 *
 * Der Name trägt das `desktop-`-Präfix mit Absicht (Muster `desktop-rail-groups.spec.ts`):
 * laut `playwright.config.ts` fährt nur das 1440px-Projekt solche Dateien, die
 * Bestandssuite (1279 px) ignoriert sie. Der Workspace-Label-Träger
 * (`desktop-rail.blade.php:111`) existiert dreifach bedingt: (1) Viewport ≥ 1280 —
 * die Rail steht in einem `<template x-if="$store.viewport?.desktop">`, unterhalb
 * existiert der Knoten nicht einmal; (2) `NOSTR_WORKSPACE_URL`/`__nostrWorkspace`
 * gesetzt — sonst fehlt die ganze Workspace-Gruppe; (3) Workspace-Räume geladen —
 * die Gruppe rendert nur mit Bestand. Alle drei stellt dieser Test her.
 *
 * Der Workspace-Relay ist bewusst derselbe worker-eigene zooid wie der Space
 * (Muster `board-fixtures.ts`, das Board genauso anschließt): die Rail braucht
 * Räume auf der zweiten URL, nicht einen zweiten Relay-Prozess.
 *
 * Bonus (P9-Auftrag, „optional-if-cheap"): eine Raumzeile AKTIV schalten. Die
 * Nutzungsentscheidung P9.1 ist inzwischen getroffen — „Zinc bleibt" steht als
 * Kommentar in `rail-room-row.blade.php` —, ein brand-8xx Spot in der aktiven
 * Zeile ist heute also nicht zu erwarten. Das Netz steht trotzdem: die Kehr-
 * schleife misst alles mit `text-brand-*` im Sichtbereich, und der Aktiv-Balken
 * (`bg-brand-700`) wird hier ausdrücklich verlangt. Käme morgen Markentext in
 * die aktive Zeile, fiele er in dieselbe Messung — ohne dass dieser Test sich
 * ändern muss.
 */
import { test, expect, type Page } from './support/fixtures'
import { useZooid, ZOOID_URL } from './support/zooid'
import { loginNsec } from './support/login'
import { measure } from './support/contrast'

const NSEC = process.env.NOSTR_TEST_NSEC as string

const rail = (page: Page) => page.locator('[data-rail]')

for (const theme of ['light', 'dark'] as const) {
    test(`A11y: Rail-Träger im xl-Viewport erfüllen WCAG (${theme})`, async ({ page }) => {
        await useZooid(page)
        // Der zweite Space wird injiziert wie in Produktion durch `partials/head.blade.php`
        // — NACH useZooid registriert, denn dessen Init-Script löscht den Workspace
        // bewusst (Hermetik), und das später registriert gewinnt (Muster workspaces.spec.ts).
        await page.addInitScript((url) => {
            ;(window as unknown as { __nostrWorkspace: string }).__nostrWorkspace = url
        }, ZOOID_URL)
        await page.addInitScript((t) => {
            try {
                localStorage.setItem('flux.appearance', t as string)
            } catch {
                /* kein localStorage → Test misst dann das Default-Theme */
            }
        }, theme)
        await loginNsec(page, NSEC)

        await expect(rail(page)).toBeVisible({ timeout: 20_000 })
        // Auf die Workspace-GRUPPE warten, nicht nur auf die Rail: sie rendert erst
        // mit geladenen Workspace-Räumen, und eine Rail, die noch lädt, misst die
        // halbe Spalte nicht — ungemessen sieht aus wie grün (die Lehre aus P2 §10).
        //
        // Hier stand bis 2026-08-17 `getByText('· Zooid Test Space')`: der
        // Relay-Name hinter „WORKSPACE". Er ist mit dem Redesign des
        // Sektionskopfes aus der Zeile verschwunden (er kappte bei 295 px Rail-
        // Breite BEIDE Teile der Beschriftung) und steht jetzt im `title`. Der
        // Anker misst deshalb einen anderen Träger derselben Klasse — siehe unten.
        await expect(rail(page).locator('[aria-controls="rail-group-workspace"]')).toBeVisible({ timeout: 20_000 })

        const railMessung = await measure(page)

        // Bonus: eine Raumzeile aktiv schalten — über den echten Klickpfad. „Räume"
        // ist als einzige Gruppe default offen (railGroups.ts), die Zeile ist also
        // ohne Vorarbeit klickbar. Auf die Gruppe GESCOPED: der Workspace zeigt
        // denselben Relay und damit auch einen „Willkommen"-Raum — ein Treffer ohne
        // Scope hätte (Lauf 1) die Workspace-Zeile erwischt. Der Query-Parameter
        // ist erwartbar: `openRoom` klassifiziert jeden Raum, der AUCH auf dem
        // Workspace-Relay liegt, als Workspace-Raum — und hier sind es dieselben.
        await rail(page).locator('#rail-group-rooms').getByRole('button', { name: /^Willkommen/ }).first().click()
        await page.waitForURL(/\/rooms\/welcome/)
        await expect(rail(page).locator('[aria-current="page"]').first()).toBeVisible({ timeout: 15_000 })
        const aktivMessung = await measure(page)

        const measured = [...railMessung, ...aktivMessung]
        console.log(`KONTRAST[${theme}:rail] ` + JSON.stringify(measured, null, 1))

        // Der namentliche Träger dieser Spec: kleiner MARKEN-Text in der Rail, als
        // TEXT verlangt — genau die Fehleinstufung als Grafik war der P2-Blinde
        // Fleck derselben Farbe (`text-brand-800` / `dark:text-brand-400`).
        //
        // Das war bis 2026-08-17 das Workspace-Label und ist jetzt der `#`-Prompt
        // des Suchfelds (`desktop-rail.blade.php`, `text-sm font-bold
        // text-brand-800 dark:text-brand-400`). Dieselbe Farbe, dieselbe
        // Größenklasse (14 px < 18,66 px ⇒ Schwelle 4,5:1), aber OHNE die drei
        // Bedingungen, an denen der alte Träger hing (Relay gesetzt, Räume geladen,
        // Gruppe gerendert): der Prompt steht in jeder Rail, immer. Der Anker ist
        // damit unbedingter geworden, nicht schwächer — und er misst weiter GENAU
        // die Klasse, für die er gebaut wurde.
        //
        // (2026-08-27: `font-mono` aus dem Zitat gestrichen. P6b hat die Klasse
        // dort entfernt — dieser Anker findet über den TEXT `#` und war deshalb
        // nie betroffen, aber ein Zitat, das die Klassenliste falsch wiedergibt,
        // schickt den nächsten Leser in die falsche Datei. Der Schwesterfall in
        // `buzz-agent-mention-form.spec.ts` fand über die Klasse und war rot.)
        const label = measured.find((m) => m.kind === 'text' && m.label.trim() === '#')
        expect(
            label,
            'Marken-Textträger „#" (desktop-rail, Suchfeld-Prompt) nicht gemessen — Rail nicht im xl-Viewport, oder die Farbklasse ist weg',
        ).toBeDefined()
        expect(label?.min, 'Marken-Textträger wird nicht gegen die TEXT-Schwelle geprüft').toBe(4.5)

        // Der Aktiv-Balken der Raum-Zeile: Informationstragende Fläche (1.4.11) —
        // heute zinc-Text + brand-700-Balken; fällt der Balken aus der bg-brand-700-
        // Regel, sagt genau diese Zeile es (Kalibrierung siehe Anker-Hauptdatei).
        expect(
            aktivMessung.some((m) => m.kind === 'graphic' && m.label === 'Nav-Indikator'),
            'Aktiv-Balken der Rail-Zeile nicht gemessen — keine Zeile aktiv, oder der Balken trägt die bg-brand-700-Klasse nicht mehr',
        ).toBe(true)

        expect(measured.length, 'keine Rail-Farbträger gefunden — Messung wertlos').toBeGreaterThan(0)
        for (const m of measured) {
            expect(m.opacity, `[${theme}:rail] ${m.label || '(Icon)'} unter opacity ${m.opacity} — Verhältnis ${m.ratio}:1 wäre erfunden`).toBe(1)
            expect(m.ratio, `[${theme}:rail] ${m.label} (${m.kind}) — ${m.fg} auf ${m.bg}, verlangt ${m.min}:1`).toBeGreaterThanOrEqual(m.min)
        }
    })
}
