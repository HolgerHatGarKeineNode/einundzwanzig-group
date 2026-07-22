import { test, expect, type Page } from './support/fixtures'
import { useZooid } from './support/zooid'
import { loginNsec } from './support/login'

const NSEC = process.env.NOSTR_TEST_NSEC as string

/**
 * Regressionsanker für den Rückweg aus dem Raum (`backFromRoom`, `js/bridge.ts`):
 * `history.back()`, wenn dieser Tab per `livewire:navigate` schon einen App-internen
 * Vorgänger gesetzt hat (`sessionStorage['appNav']`), sonst `Livewire.navigate(upTarget)`
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
 * `Livewire.navigate()` war (setzt den `appNav`-Marker + pusht einen History-Eintrag).
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
 * `/nostr-login` o.ä.) — genau das ist der Grund für den `hasInternalHistory()`-Guard.
 */
test('Rückweg (3): Deep-Link-Kaltstart in einen Raum → Zurück landet auf dem UP-Ziel /spaces', async ({ page }) => {
    await login(page)

    // Frischer, direkter Aufruf der Raum-Route — kein Klick, keine Livewire.navigate()-
    // Navigation in diesem Tab, damit der `appNav`-Marker unbeteiligt bleibt.
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
