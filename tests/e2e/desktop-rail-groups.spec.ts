/**
 * Der Desktop-Navigator, gruppiert (Projekt `desktop`, 1440 px).
 *
 * **Reshaped by P6/D10 („Deine Leiste"), and this file follows that reshape.** What it
 * measures is unchanged: the ROOM GROUPS — collapsing, the search field, the scope chip, and
 * that the stage does not double the column. What P6 put above them (Start, the pins) and the
 * keyboard are measured in `desktop-left-bar.spec.ts`; the bar above the stage in
 * `desktop-command-bar.spec.ts`. Three files, three subjects, no third copy of the login.
 *
 * Der Name trägt das `desktop-`-Präfix mit Absicht: laut `playwright.config.ts`
 * fährt nur das 1440px-Projekt solche Dateien, und die Bestandssuite (1279 px)
 * ignoriert sie. Was hier steht, wird also garantiert OBERHALB des Breakpoints
 * gemessen — und der Gegenbeweis (unterhalb existiert nichts davon) steht in
 * `rail-guard.spec.ts`, das bewusst KEIN Präfix trägt.
 */
import { test, expect, type Page } from './support/fixtures'
import { useZooid } from './support/zooid'
import { loginNsec } from './support/login'

const NSEC = process.env.NOSTR_TEST_NSEC as string

const rail = (page: Page) => page.locator('[data-rail]')

/**
 * Der Aufklapper einer Gruppe. Adressiert über `aria-controls` statt über den
 * Text: der Kopf enthält Chevron, Label, Bestandszahl und ggf. den Workspace-
 * Namen — ein Text-Locator wäre von der Beschriftung abhängig, `aria-controls`
 * ist der Vertrag zwischen Knopf und Panel.
 */
const groupToggle = (page: Page, key: string) =>
    rail(page).locator(`[aria-controls="rail-group-${key}"]`)

/**
 * Das Suchfeld. NICHT über den Platzhalter: der wechselt bei gesetztem Scope von
 * „Raum springen" auf „Filtern…" — ein Platzhalter-Locator prüft also nebenbei
 * einen Zustand, den er gar nicht meint, und lief prompt in einen Timeout.
 */
const prompt = (page: Page) => rail(page).locator('input[type="search"]')

async function openApp(page: Page): Promise<void> {
    await useZooid(page)
    await loginNsec(page, NSEC)
    await expect(rail(page)).toBeVisible({ timeout: 20_000 })
}

test('Ab 1280 px steht der Navigator — und die Bottom-Nav nicht mehr', async ({ page }) => {
    await openApp(page)

    expect(page.viewportSize()?.width, 'Projekt-Viewport muss über 1280 liegen').toBeGreaterThanOrEqual(1280)
    await expect(rail(page)).toHaveCount(1)

    // The fixed bottom bar is hidden from `xl` up. What replaced it there is the command bar
    // above the stage (P6) — the three global affordances live in it, so this case asserts the
    // handover rather than „three nav targets in the rail", which is what stood here until P6
    // and had been wrong since P2 (that footer row set went away with Concept C).
    await expect(page.locator('nav.fixed')).toBeHidden()
    await expect(page.locator('[data-command-bar]')).toBeVisible()
})

test('Gruppen: Räume offen, die anderen zu — und der Zustand überlebt wire:navigate', async ({ page }) => {
    await openApp(page)

    // Default laut `railGroups.ts`: nur „Räume" offen.
    await expect(rail(page).getByText('Willkommen', { exact: false }).first()).toBeVisible({ timeout: 20_000 })

    // „Meetups" aufklappen …
    await groupToggle(page, 'meetups').click()
    await expect
        .poll(async () => page.evaluate(() => JSON.parse(localStorage.getItem('railGroups.open') ?? '{}').meetups))
        .toBe(true)

    // … und der Zustand muss eine SPA-Navigation überstehen. Genau dafür liegt er in
    // localStorage: `wire:navigate` baut die Insel bei jedem Raumwechsel neu auf,
    // reiner Alpine-State wäre nach dem ersten Klick wieder Default.
    await page.goto('/rooms/welcome')
    await expect(rail(page)).toBeVisible({ timeout: 20_000 })
    expect(
        await page.evaluate(() => JSON.parse(localStorage.getItem('railGroups.open') ?? '{}').meetups),
        'der Auf/Zu-Zustand darf die Navigation nicht verlieren',
    ).toBe(true)
})

test('Die Gruppe des aktiven Raums klappt immer auf — auch wenn sie zugeklappt war', async ({ page }) => {
    await openApp(page)

    // „Räume" bewusst zuklappen, dann in einen Raum navigieren.
    await groupToggle(page, 'rooms').click()
    await expect
        .poll(async () => page.evaluate(() => JSON.parse(localStorage.getItem('railGroups.open') ?? '{}').rooms))
        .toBe(false)

    await page.goto('/rooms/welcome')
    await expect(rail(page)).toBeVisible({ timeout: 20_000 })

    // Der aktive Raum MUSS sichtbar sein: „wo bin ich" ist der erste Zweck der Rail.
    // Der gespeicherte Zustand bleibt dabei unangetastet (er ist eine Vorliebe, keine Anzeige).
    await expect(rail(page).getByRole('button', { name: /Willkommen/ }).first()).toBeVisible({ timeout: 20_000 })
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('railGroups.open') ?? '{}').rooms)).toBe(false)
})

test('Suche findet auch in einer ZUGEKLAPPTEN Gruppe', async ({ page }) => {
    await openApp(page)

    // Meetups sind per Default zu — der Treffer muss trotzdem erscheinen.
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('railGroups.open') ?? '{}').meetups ?? false))
        .toBe(false)

    await prompt(page).fill('Berlin')
    await expect(rail(page).getByRole('button', { name: /Meetup Berlin/ }).first())
        .toBeVisible({ timeout: 20_000 })
})

test('Token-Lift: getipptes `m:` wandert in den Chip und filtert auf Meetups', async ({ page }) => {
    await openApp(page)

    await prompt(page).fill('m:')

    // Das Präfix darf NICHT im Feld stehen bleiben — es ist jetzt der Chip.
    await expect(rail(page).getByText('Meetups', { exact: true }).last()).toBeVisible({ timeout: 10_000 })
    expect(await prompt(page).inputValue(), 'das erkannte Token gehört in den Chip, nicht in den Text').toBe('')

    // Und der Scope wirkt: ein Raum aus der Gruppe „Räume" ist jetzt draußen.
    await expect(rail(page).getByRole('button', { name: /Meetup Berlin/ }).first()).toBeVisible({ timeout: 20_000 })
})

/**
 * P5 — die Bühne doppelt die Rail nicht.
 *
 * Auf `/spaces` standen die Räume ab 1280px zweimal im selben Blick: links im
 * Navigator und rechts in der Karte. Ab xl trägt sie der Navigator; auf der Bühne
 * bleibt, was die Rail bewusst NICHT kann — Banner, Entdecken-Wege, Threads.
 *
 * Ausgeblendet wird per CSS, nicht per `x-if`: unterhalb xl muss der Block
 * zeichengleich bleiben, und eine zweite Breakpoint-Bedingung in Alpine wäre eine
 * zweite Wahrheit. Der Gegenbeweis für Mobil steht in `spaces.spec.ts` (P7) und
 * `rail-guard.spec.ts`.
 */
test('Ab 1280 px zeigt die Bühne die Raumliste nicht mehr — die Rail trägt sie', async ({ page }) => {
    await openApp(page)
    // The discovery rows this case is about live on the CHAT AREA, and since P2 the login
    // lands on Start — so the surface has to be opened explicitly. Without this line the
    // assertions below ran against Start, where none of those labels exists; the case was red
    // for that reason and not for the one it is about.
    await page.goto('/bereich/chat')
    await expect(rail(page)).toBeVisible({ timeout: 20_000 })

    // Der Navigator führt die Räume.
    await expect(rail(page).getByRole('button', { name: /Willkommen/ }).first())
        .toBeVisible({ timeout: 20_000 })

    // Die Bühne nicht mehr: das Sektionslabel existiert dort zwar im DOM, ist aber
    // ab xl unsichtbar. Auf „unsichtbar" prüfen und nicht auf „weg", weil genau das
    // der Mechanismus ist — ein `toHaveCount(0)` liefe grün, wenn jemand den Block
    // versehentlich ganz entfernte, und würde den Mobil-Fall stillschweigend decken.
    const buehne = page.locator('main')
    await expect(buehne.locator('span').filter({ hasText: /^Meine Räume$/ })).toBeHidden()

    // ── What stood here until P6, and why it is gone ──────────────────────────────
    // Two assertions about the discovery ways at the foot of the card: that the row
    // "Meetup-Räume entdecken" stays, and that the rule above it disappears from `xl` up.
    // **Both lost their subject with P2.** The four discovery rows were deleted with D2
    // (Start carries "Alle Bereiche", the palette finds the rest), and the only content left
    // in that block — "Neuen Raum anlegen" — hangs on `isAdmin`, which the test user does not
    // have. Measured: `[data-discover]` is not in the DOM in this run at all, so the probe
    // would have judged the empty set.
    //
    // What REMAINS of the promise stands above and below: the stage no longer shows the room
    // list, and it does not double the pins either.

    // P6 extends the same rule to the PINS: Start shows them as chips, the column shows them
    // as rows, and from `xl` up only the column does. Measured on Start, because that is the
    // only surface carrying the chips — and on „hidden" rather than „absent", because the
    // mechanism is CSS (`xl:hidden`) and a `toHaveCount(0)` would pass if someone deleted the
    // block altogether, quietly covering the mobile case.
    await page.goto('/start')
    await expect(rail(page)).toBeVisible({ timeout: 20_000 })
    await expect(rail(page).locator('[data-rail-pins]'), 'the column carries the pins').toBeVisible({ timeout: 20_000 })
    await expect(page.locator('[data-start-angeheftet]'), 'the stage must not double them').toBeHidden()
})

/**
 * Der Lupenknopf am Gruppenkopf — `scopeToGroup()`.
 *
 * Bis 2026-08-27 hatte er **keinen einzigen** E2E-Anker (`grep scopeToGroup
 * tests/e2e/*.spec.ts` = 0), obwohl er eines von zwei Bedienelementen ist, die
 * `flux:navlist.group` unmöglich machen — also genau das, was ein künftiger
 * Umbau auf die Flux-Komponente stillschweigend verlöre.
 *
 * Gemessen wird die WIRKUNG, nicht das Vorhandensein: `scopeToGroup` setzt
 * `scope` UND ruft `focusPrompt()` (`js/rail.ts:693-696`). Beide Hälften stehen
 * hier, weil ein Anker auf nur eine von ihnen die andere stillschweigend
 * freigäbe. Die Filterwirkung ist die dritte Zusage — ohne sie bliebe der Test
 * grün, wenn `scope` zwar gesetzt würde, die Liste aber nicht darauf hörte.
 */
test('Lupe am Gruppenkopf: Scope gesetzt, Fokus im Feld, Liste gefiltert', async ({ page }) => {
    await openApp(page)

    // Ausgangslage festhalten — sonst prüft der Test unten gegen sich selbst.
    await expect(rail(page).getByRole('button', { name: /Willkommen/ }).first())
        .toBeVisible({ timeout: 20_000 })
    expect(await prompt(page).getAttribute('placeholder')).toBe('Raum springen')

    await rail(page).getByRole('button', { name: 'In Meetups suchen' }).click()

    // 1. Der Scope steht — sichtbar am gewechselten Platzhalter und am Chip,
    //    nicht an einer Alpine-Variable: der Nutzer sieht das Markup, nicht `scope`.
    await expect(prompt(page)).toHaveAttribute('placeholder', 'Filtern…')
    await expect(rail(page).getByRole('button', { name: /Suchbereich aufheben/ }))
        .toBeVisible({ timeout: 10_000 })

    // 2. Der Fokus liegt im Feld. Das ist die halbe Funktion — wer die Lupe
    //    drückt, will tippen, nicht danach noch einmal klicken.
    await expect(prompt(page)).toBeFocused()

    // 3. Und der Scope WIRKT: „Willkommen" gehört zur Gruppe „Räume" und ist
    //    jetzt draußen, ein Meetup ist drin. Ohne diese Zusage bliebe der Test
    //    grün, wenn `scope` gesetzt würde und die Liste ihn ignorierte.
    await expect(rail(page).getByRole('button', { name: /Meetup Berlin/ }).first())
        .toBeVisible({ timeout: 20_000 })
    await expect(rail(page).getByRole('button', { name: /Willkommen/ })).toHaveCount(0)
})
