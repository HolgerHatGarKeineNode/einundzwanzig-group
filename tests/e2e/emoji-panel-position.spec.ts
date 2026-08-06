/**
 * Regression: das Emoji-Panel muss beim ERSTEN Öffnen vollständig im Viewport stehen.
 *
 * Im Betrieb gemeldet (Screenshot): beim ersten Klick öffnete sich das Panel unten
 * abgeschnitten, die untersten Emoji-Reihen lagen außerhalb des Bildes. Ursache war
 * die Positionsrechnung in `reactionPopover.reposition()` (bridge.ts): sie las die
 * Panelhöhe EINMAL im `$nextTick` nach dem Öffnen und leitete daraus `top` ab. Beim
 * ersten Öffnen einer Sitzung steht dort aber noch „Emojis laden…" — 132 px statt
 * 292 px. Das Panel bekam ein `top` für die kleine Höhe und wuchs danach nach unten
 * aus dem Bild: **98 px** über den Viewport-Rand.
 *
 * Der Fix nimmt die Höhe aus der Rechnung: das nach oben öffnende Panel ankert an
 * seiner UNTERkante, `max-height` deckelt es auf den freien Platz. Dieser Test hält
 * beides fest — kein Überlauf nach dem Laden, und die Unterkante bleibt bei einer
 * Höhenänderung (Suchfilter) am Trigger kleben statt davonzudriften.
 *
 * Kalibriert: mit der alten Rechnung (`top = trigger.top - 132 - gap`) meldet die
 * erste Assertion `ueberlaufUnten: 98` und der Test wird rot.
 */
import { test, expect, type Page } from './support/fixtures'
import { useZooid } from './support/zooid'
import { loginNsec } from './support/login'
import { viewportOverflow } from './support/viewport'

const NSEC = process.env.NOSTR_TEST_NSEC as string

/**
 * Geometrie des teleportierten Panels relativ zum Viewport, über den generischen
 * Helfer (`support/viewport.ts`, seit 2026-08-06). Vorher stand diese Funktion nur
 * hier — der Auslöser für die Extraktion war genau dieser Test.
 */
const panelGeometry = (page: Page) => viewportOverflow(page, 'body > div.fixed.z-50')

test('C1: das Emoji-Panel steht beim ersten Öffnen vollständig im Viewport', async ({ page }) => {
    await useZooid(page)
    await loginNsec(page, NSEC)
    await page.goto('/rooms/thread')
    await expect(page.getByPlaceholder('Nachricht schreiben…')).toBeVisible({ timeout: 15_000 })

    const trigger = page
        .locator('div.relative.flex.items-end.gap-2')
        .filter({ has: page.getByPlaceholder('Nachricht schreiben…') })
        .getByRole('button', { name: 'Emoji einfügen' })
    await expect(trigger).toBeVisible({ timeout: 10_000 })

    // ERSTES Öffnen dieser Sitzung — genau der Fall aus der Meldung.
    await trigger.click()
    await expect(page.getByLabel('Emoji suchen')).toBeVisible({ timeout: 10_000 })

    // Auf das volle Grid warten: die Kategorie-Tabs erscheinen erst mit `ready`,
    // also nachdem emojibase geladen ist und das Panel seine Endhöhe erreicht hat.
    // Das ist der Moment, in dem das Panel früher aus dem Bild gewachsen war.
    await expect(page.getByRole('tablist', { name: 'Emoji-Kategorien' })).toBeVisible({ timeout: 15_000 })

    await expect
        .poll(async () => (await panelGeometry(page))?.ueberlaufUnten, {
            message: 'Panel darf unten nicht aus dem Viewport ragen',
            timeout: 5_000,
        })
        .toBeLessThanOrEqual(0)

    const geladen = await panelGeometry(page)
    expect(geladen!.ueberlaufOben, 'Panel darf oben nicht aus dem Viewport ragen').toBeLessThanOrEqual(0)

    // Höhenänderung: der Suchfilter schrumpft das Grid. Die Unterkante gehört weiter
    // an den Trigger — driftet sie, hängt das Panel frei in der Luft.
    await page.getByLabel('Emoji suchen').fill('lach')
    await expect
        .poll(async () => (await panelGeometry(page))?.height, { timeout: 5_000 })
        .toBeLessThan(geladen!.height)

    const gefiltert = await panelGeometry(page)
    const triggerBox = (await trigger.boundingBox())!
    expect(
        Math.abs(gefiltert!.bottom - Math.round(triggerBox.y)),
        'Unterkante des Panels bleibt am Trigger (6 px Abstand + Rundung)',
    ).toBeLessThanOrEqual(14)
    expect(gefiltert!.ueberlaufUnten, 'auch nach dem Filtern kein Überlauf').toBeLessThanOrEqual(0)
})

/**
 * Regression: derselbe Fehler, zweiter Trigger — der Reaktions-Popover einer
 * Nachrichtenzeile (`chat-row.blade.php`, Knopf „Reagieren"). Er hängt an
 * DERSELBEN `reactionPopover`-Komponente (bridge.ts) wie der Composer-Emoji-Knopf
 * oben — der Name ist trotz seiner Herkunft der generische Panel-Positionierer,
 * siehe Kommentar dort. Gefunden vom `design-lead` nach einem ACCEPT (Teambesprechung
 * 2026-08-06): **9 px Überlauf** unten beim ERSTEN Öffnen, gemessen an genau dieser
 * Stelle — kleiner als beim Composer-Knopf (98 px), weil der Trigger einer
 * Nachrichtenzeile näher am unteren Bildrand sitzt, aber dieselbe Ursache: die alte
 * Rechnung las die Panelhöhe („Emojis laden…", 132 px) VOR dem vollen Grid (292 px).
 *
 * Bis zu diesem Test war dieser Pfad ungetestet — `emoji-panel-position.spec.ts` deckte
 * nur den Composer-Picker ab, der Reaktions-Popover keinen. Ein behobener Bug ohne
 * Test kommt zurück; dieser Test hält ihn fest.
 *
 * Kalibriert: mit der alten Rechnung (`top = trigger.top - 132 - gap`, ohne
 * Unterkanten-Ankerung) meldet die erste Assertion in DIESEM Test `ueberlaufUnten: 27`
 * und wird rot — abweichend von den am Bildschirm gemeldeten 9 px, weil Trigger-Position
 * und Fensterhöhe hier anders liegen als in der Original-Meldung; dieselbe Ursache,
 * derselbe Fehlerpfad.
 */
test('C2: der Reaktions-Popover einer Nachrichtenzeile steht beim ersten Öffnen vollständig im Viewport', async ({
    page,
}) => {
    await useZooid(page)
    await loginNsec(page, NSEC)
    // Dedizierter „react"-Raum wie in room.spec.ts (C1): schreibende Tests bloaten
    // nicht „welcome"; eigene frische Nachricht macht die Zeile eindeutig auffindbar.
    await page.goto('/rooms/react')

    const marker = `RXPOS-${Math.floor(Math.random() * 1e9)}`
    const composer = page.getByPlaceholder('Nachricht schreiben…')
    await expect(composer).toBeVisible({ timeout: 15_000 })
    await composer.fill(marker)
    await page.getByRole('button', { name: 'Senden' }).click()
    await expect(page.getByText(marker, { exact: true })).toBeVisible({ timeout: 15_000 })

    const row = page.locator('div.group', { hasText: marker })
    await row.hover()
    const trigger = row.getByRole('button', { name: 'Reagieren', exact: true })
    await expect(trigger).toBeVisible({ timeout: 10_000 })

    // ERSTES Öffnen dieser Sitzung — genau der Fall, den der `design-lead` fand.
    await trigger.click()
    await expect(page.getByLabel('Emoji suchen')).toBeVisible({ timeout: 10_000 })
    await expect(page.getByRole('tablist', { name: 'Emoji-Kategorien' })).toBeVisible({ timeout: 15_000 })

    await expect
        .poll(async () => (await panelGeometry(page))?.ueberlaufUnten, {
            message: 'Reaktions-Popover darf unten nicht aus dem Viewport ragen',
            timeout: 5_000,
        })
        .toBeLessThanOrEqual(0)
    const geladen = await panelGeometry(page)
    expect(geladen!.ueberlaufOben, 'Reaktions-Popover darf oben nicht aus dem Viewport ragen').toBeLessThanOrEqual(0)
})
