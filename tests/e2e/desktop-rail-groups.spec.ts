/**
 * Der Desktop-Navigator, gruppiert (Projekt `desktop`, 1440 px).
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

    // Die drei Nav-Ziele liegen jetzt IN der Rail; die fixe Bar ist ab xl versteckt.
    await expect(rail(page).getByText('Chat', { exact: true })).toBeVisible()
    await expect(page.locator('nav.fixed')).toBeHidden()
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

    // Der Navigator führt die Räume.
    await expect(rail(page).getByRole('button', { name: /Willkommen/ }).first())
        .toBeVisible({ timeout: 20_000 })

    // Die Bühne nicht mehr: das Sektionslabel existiert dort zwar im DOM, ist aber
    // ab xl unsichtbar. Auf „unsichtbar" prüfen und nicht auf „weg", weil genau das
    // der Mechanismus ist — ein `toHaveCount(0)` liefe grün, wenn jemand den Block
    // versehentlich ganz entfernte, und würde den Mobil-Fall stillschweigend decken.
    const buehne = page.locator('main')
    await expect(buehne.locator('span').filter({ hasText: /^Meine Räume$/ })).toBeHidden()

    // Was bleiben MUSS: die Wege, die es in der Rail nicht gibt.
    // Nur die Meetup-Zeile: „Projektunterstützung entdecken" erscheint erst, wenn
    // Antragsräume existieren, und der zooid-Seed hat keine. Eine Zusicherung über
    // eine Zeile, die im Seed gar nicht vorkommt, prüfte den Seed, nicht den Umbau.
    await expect(buehne.getByText('Meetup-Räume entdecken')).toBeVisible({ timeout: 20_000 })

    // Und die Trennlinie über den Entdecken-Wegen ist weg: sie trennt von den
    // Raumlisten, die es hier nicht mehr gibt. Ein Strich am oberen Rand der Karte
    // trennt nichts von nichts.
    // Gemessen an der GERENDERTEN Kante, nicht an einer Klassenliste: die Klasse
    // hängt an einer Alpine-Bindung, und ein Klassen-Locator prüfte den Ausdruck
    // statt seiner Wirkung.
    const borderTop = await buehne.locator('[data-discover]').evaluate(
        (el) => getComputedStyle(el).borderTopWidth,
    )
    expect(borderTop, 'kein Strich am oberen Rand der Karte').toBe('0px')
})
