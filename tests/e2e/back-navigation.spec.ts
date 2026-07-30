import { test, expect, type Page } from './support/fixtures'
import { useZooid } from './support/zooid'
import { loginNsec } from './support/login'

const NSEC = process.env.NOSTR_TEST_NSEC as string

/**
 * Regressionsanker für den Rückweg aus dem Raum (`backFromRoom`, `js/bridge.ts`):
 * `history.back()`, wenn dieser Tab per `livewire:navigate` schon einen App-internen
 * Vorgänger GENAU DAS UP-ZIEL ist (`sessionStorage['appNavPrev']`, Pfad-Vergleich),
 * sonst `Livewire.navigate(upTarget)`
 * (`/spaces`) — der Fallback für den Deep-Link-Kaltstart, der KEINEN Vorgänger hat.
 *
 * Eigene Datei statt Ergänzung von `spaces.spec.ts`/`room.spec.ts`: der Rückweg ist ein
 * einziges, in sich geschlossenes Verhalten, das beide Screens querschneidet (Start in
 * `⚡spaces.blade.php`, Rücksprungziel in `⚡room.blade.php`/`bridge.ts`). Eine eigene
 * Datei hält ihn isoliert lauf- und wiederholbar (Flake-Diagnose), statt ihn in einer der
 * beiden ohnehin schon sehr großen Dateien zu verstecken.
 *
 * Der Thread-Rückweg (Kopf-Zurück bei offenem Thread → `backFromThread()`, EIGENER Pfad,
 * pusht bewusst keinen History-Eintrag) ist bereits vollständig durch `room.spec.ts`
 * „Thread-Umbau (b)" abgedeckt (inkl. Warm-Beweis per `window`-Sentinel) — hier NICHT
 * dupliziert.
 */

const MEETUP_NAME = 'Meetup Berlin'
const MEETUP_H = 'meetberlin'

async function login(page: Page): Promise<void> {
    await useZooid(page)
    await loginNsec(page, NSEC)
}

/** Setzt einen `window`-Sentinel — überlebt nur eine warme SPA-Navigation, kein Reload. */
async function setWarmSentinel(page: Page): Promise<void> {
    await page.evaluate(() => {
        ;(window as unknown as { __warm?: number }).__warm = 1
    })
}

async function readWarmSentinel(page: Page): Promise<number | undefined> {
    return page.evaluate(() => (window as unknown as { __warm?: number }).__warm)
}

/**
 * Fall 1 — Übersicht → Raum → Zurück landet wieder in der Übersicht, Alpine lebt.
 * `history.back()` trägt hier, weil der Klick auf die Raum-Kachel selbst schon ein
 * `Livewire.navigate()` war (setzt den `appNavPrev`-Wert + pusht einen History-Eintrag).
 */
test('Rückweg (1): Übersicht → Raum → Zurück landet wieder in der Übersicht, warm', async ({ page }) => {
    await login(page)
    await expect(page.getByText('Zooid Test Space')).toBeVisible({ timeout: 15_000 })

    await page.getByRole('button', { name: '# Willkommen', exact: true }).click()
    await expect(page.getByRole('heading', { name: '# Willkommen' })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByPlaceholder('Nachricht schreiben…')).toBeVisible({ timeout: 15_000 })

    // Sentinel NACH dem warmen Betreten des Raums, VOR dem Zurück-Klick — beweist,
    // dass der Rückweg selbst kein Reload/kalter Reboot ist.
    await setWarmSentinel(page)

    await page.getByRole('button', { name: 'Zurück' }).click()
    await expect(page).toHaveURL(/\/spaces$/, { timeout: 15_000 })
    await expect(page.getByText('Zooid Test Space')).toBeVisible({ timeout: 15_000 })
    expect(await readWarmSentinel(page)).toBe(1)
})

/**
 * Fall 2 (Kernfall) — gefilterte Meetup-Liste → Raum → Zurück landet wieder GENAU im
 * Meetup-Fokus mit demselben Land-Filter (statt auf der Standard-Übersicht). Das war
 * vor dem Umbau kaputt: `Livewire.navigate('/spaces')` verwarf jeden Filterzustand.
 */
test('Rückweg (2): gefilterte Meetup-Liste → Raum → Zurück landet im selben Meetup-Fokus + Land-Filter', async ({ page }) => {
    await login(page)

    await page.getByRole('button', { name: /Meetup-Räume entdecken/ }).click()
    await expect(page.getByPlaceholder('Meetup oder Stadt suchen…')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('button', { name: /^Meetup Berlin/ })).toBeVisible({ timeout: 15_000 })

    // Land-Filter auf Deutschland: Berlin + Hamburg bleiben, Wien fällt raus.
    await page.getByRole('button', { name: 'Land' }).click()
    await page.getByRole('button').filter({ hasText: 'Deutschland' }).click()
    await expect(page).toHaveURL(/[?&]cc=DE\b/, { timeout: 15_000 })
    await expect(page.getByRole('button', { name: /^Meetup Wien/ })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /^Meetup Hamburg/ })).toBeVisible()

    await page.getByRole('button', { name: /^Meetup Berlin/ }).click()
    await expect(page).toHaveURL(new RegExp(`/rooms/${MEETUP_H}$`), { timeout: 15_000 })
    await expect(page.getByRole('heading', { name: `# ${MEETUP_NAME}` })).toBeVisible({ timeout: 15_000 })
    // Alice ist in diesem Test-Setup KEIN Mitglied der Meetup-Räume — statt des Composers
    // zeigt die Insel den Beitreten-Hinweis. Das ist genug Beweis für „warm gerendert",
    // ohne die Mitgliedschaft künstlich herzustellen (irrelevant für den Rückweg).
    await expect(page.getByText('Tritt dem Raum bei, um mitzuschreiben.')).toBeVisible({ timeout: 15_000 })

    await setWarmSentinel(page)
    await page.getByRole('button', { name: 'Zurück' }).click()

    // KERN: zurück auf /spaces, aber weiterhin im Meetup-Fokus mit `cc=DE` in der URL —
    // nicht die parameterlose Standard-Übersicht.
    const url = new URL(page.url())
    expect(url.pathname).toBe('/spaces')
    expect(url.searchParams.get('rt')).toBe('meetups')
    expect(url.searchParams.get('cc')).toBe('DE')
    expect(await readWarmSentinel(page)).toBe(1)

    // UI bestätigt denselben Filterzustand: Wien weiterhin ausgeblendet, Berlin+Hamburg da.
    await expect(page.getByPlaceholder('Meetup oder Stadt suchen…')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('button', { name: /^Meetup Berlin/ })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('button', { name: /^Meetup Hamburg/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /^Meetup Wien/ })).toHaveCount(0)
})

/**
 * Fall 3 — Deep-Link-Kaltstart in einen Raum (frischer `page.goto`, keine App-interne
 * Navigation in diesem Tab zuvor): Zurück muss auf das explizite UP-Ziel `/spaces` gehen,
 * NICHT per `history.back()` irgendwohin (aus der App raus, auf eine Zwischenseite wie
 * `/nostr-login` o.ä.) — genau das ist der Grund für den `backLeadsTo()`-Guard.
 */
test('Rückweg (3): Deep-Link-Kaltstart in einen Raum → Zurück landet auf dem UP-Ziel /spaces', async ({ page }) => {
    await login(page)

    // Frischer, direkter Aufruf der Raum-Route — kein Klick, keine Livewire.navigate()-
    // Navigation in diesem Tab, damit der `appNavPrev`-Wert unbeteiligt bleibt.
    await page.goto(`/rooms/${MEETUP_H}`)
    await expect(page.getByRole('heading', { name: `# ${MEETUP_NAME}` })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('Tritt dem Raum bei, um mitzuschreiben.')).toBeVisible({ timeout: 15_000 })

    await page.getByRole('button', { name: 'Zurück' }).click()
    await expect(page).toHaveURL(/\/spaces$/, { timeout: 15_000 })
    await expect(page.getByText('Zooid Test Space')).toBeVisible({ timeout: 15_000 })
})

/**
 * Fall 5 — Filter-Parameter in der URL: Wechsel in den Meetup-Fokus + Land-Auswahl
 * schreibt `rt`/`cc`; „Räume anzeigen" (resetRoomFilters) entfernt beide wieder.
 */
test('Rückweg (5): Meetup-Fokus + Land-Auswahl schreiben rt/cc in die URL, Zurücksetzen entfernt sie', async ({ page }) => {
    await login(page)
    await expect(page).not.toHaveURL(/[?&](rt|cc)=/)

    await page.getByRole('button', { name: /Meetup-Räume entdecken/ }).click()
    await expect(page).toHaveURL(/[?&]rt=meetups\b/, { timeout: 15_000 })
    await expect(page).not.toHaveURL(/[?&]cc=/)

    await page.getByRole('button', { name: 'Land' }).click()
    await page.getByRole('button').filter({ hasText: 'Deutschland' }).click()
    await expect(page).toHaveURL(/[?&]rt=meetups\b/, { timeout: 15_000 })
    await expect(page).toHaveURL(/[?&]cc=DE\b/, { timeout: 15_000 })

    await page.getByRole('button', { name: 'Räume anzeigen' }).click()
    await expect(page).not.toHaveURL(/[?&]rt=/, { timeout: 15_000 })
    await expect(page).not.toHaveURL(/[?&]cc=/, { timeout: 15_000 })
})

/**
 * Fall 6 — Filtern darf keinen zusätzlichen History-Eintrag erzeugen (`replaceState`,
 * nie `pushState`): sonst wäre der Zurück-Button eine Falle (ein Klick müsste durch N
 * Filter-Zwischenzustände statt direkt zur vorherigen Seite). Mehrfaches Tippen im
 * Suchfeld + ein Moduswechsel + eine Landauswahl — `history.length` bleibt konstant.
 */
test('Rückweg (6): mehrfaches Filtern erhöht history.length NICHT', async ({ page }) => {
    await login(page)
    await expect(page.getByText('Zooid Test Space')).toBeVisible({ timeout: 15_000 })
    const before = await page.evaluate(() => window.history.length)

    await page.getByRole('button', { name: /Meetup-Räume entdecken/ }).click()
    await expect(page.getByPlaceholder('Meetup oder Stadt suchen…')).toBeVisible({ timeout: 15_000 })

    // Mehrfaches Tippen: jeder Tastendruck triggert den `$watch('roomQuery', …)`.
    await page.getByPlaceholder('Meetup oder Stadt suchen…').pressSequentially('Berlin')

    await page.getByRole('button', { name: 'Land' }).click()
    await page.getByRole('button').filter({ hasText: 'Deutschland' }).click()

    await expect(page).toHaveURL(/[?&]q=Berlin\b/, { timeout: 15_000 })
    await expect(page).toHaveURL(/[?&]cc=DE\b/, { timeout: 15_000 })

    const after = await page.evaluate(() => window.history.length)
    expect(after).toBe(before)
})

/**
 * Fall 4 — Raum → Raum → Zurück landet in der ÜBERSICHT, nicht im vorigen Raum.
 *
 * Der Fall, den der Desktop-Navigator alltäglich gemacht hat: mit stehender Rail
 * springt man Raum→Raum→Raum, ohne die Liste je zu sehen. Der Vorgänger im
 * History-Stack ist dann ein anderer RAUM — und der Kopf-Pfeil ist UP (Hierarchie),
 * nicht BACK. Er muss auf die Liste führen.
 *
 * Bis 2026-07-30 tat er das nicht: der Guard fragte nur „hat dieser Tab schon einmal
 * app-intern navigiert?" (ein sessionStorage-BIT, nach der ersten Navigation für immer
 * gesetzt) und nahm dann blind `history.back()`. Aus Raum B landete man in Raum A,
 * aus einem Raum nach einem Wallet-Besuch in der Wallet. Vom Nutzer als „der Back-Pfeil
 * führt komisch zurück" gemeldet.
 *
 * Der Anker läuft ohne Rail — er braucht sie nicht: entscheidend ist allein, dass der
 * VORGÄNGER kein `/spaces` ist. Zwei aufeinanderfolgende Raum-Navigationen stellen das
 * unabhängig vom Viewport her, und der Test bleibt damit auch im 1279er Projekt gültig.
 */
test('Rückweg (4): Raum → Raum → Zurück führt in die Übersicht, nicht in den vorigen Raum', async ({ page }) => {
    await login(page)
    await expect(page.getByText('Zooid Test Space')).toBeVisible({ timeout: 15_000 })

    // Raum 1 über die Liste betreten (Vorgänger = /spaces).
    await page.getByRole('button', { name: '# Willkommen', exact: true }).click()
    await expect(page.getByRole('heading', { name: '# Willkommen' })).toBeVisible({ timeout: 15_000 })

    // Raum 2 OHNE Umweg über die Liste — wie ein Rail-Sprung. Danach ist der
    // History-Vorgänger Raum 1, nicht die Übersicht.
    await page.evaluate((h) => {
        ;(window as unknown as { Livewire: { navigate(u: string): void } }).Livewire.navigate(`/rooms/${h}`)
    }, MEETUP_H)
    await expect(page.getByRole('heading', { name: `# ${MEETUP_NAME}` })).toBeVisible({ timeout: 15_000 })

    // Vorbedingung scharf halten: der zuletzt verlassene Ort war Raum 1, NICHT /spaces.
    expect(
        await page.evaluate(() => sessionStorage.getItem('appNavPrev')),
        'Vorbedingung: der Vorgänger muss ein Raum sein, sonst prüft der Test den alten Fall',
    ).toContain('/rooms/')

    await page.getByRole('button', { name: 'Zurück' }).click()

    // Die Übersicht — nicht Raum 1.
    await expect(page).toHaveURL(/\/spaces/, { timeout: 15_000 })
    await expect(page.getByText('Zooid Test Space')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('heading', { name: '# Willkommen' })).toHaveCount(0)
})
