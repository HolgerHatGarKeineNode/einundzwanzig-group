/**
 * Touch-Wächter für den Composer-Emoji-Knopf (C1, PLAN4).
 *
 * `$store.viewport.mouse` gatet die EXISTENZ des Knopfes über `<template x-if>`
 * (chat-composer.blade.php) — nicht seine Sichtbarkeit. Genau wie bei der
 * Desktop-Rail (siehe `rail-guard.spec.ts`) bootete ein per CSS verstecktes
 * `x-data` trotzdem mit: der Picker lädt emojibase nach und mountet ein Grid mit
 * hunderten Knoten, das auf einem Touch-Gerät nie jemand sieht.
 *
 * `test.use({ hasTouch: true })` genügt allein, um Chromiums `(hover: hover)`
 * und `(pointer: fine)` auf `false`/`coarse` zu kippen — gemessen per Probe-Skript
 * (kein `isMobile` nötig, keine eigene Geräte-Emulation). Der Viewport bleibt der
 * Standardprojekt-Wert (1279 px, `$store.viewport.desktop=false`) — Breite ist
 * hier absichtlich irrelevant, `mouse` ist eine reine Zeigegerät-Frage.
 */
import { test, expect } from './support/fixtures'
import { useZooid } from './support/zooid'
import { loginNsec } from './support/login'

const NSEC = process.env.NOSTR_TEST_NSEC as string

test.use({ hasTouch: true })

test('Touch-Kontext: der Emoji-Knopf existiert in KEINEM Composer (Raum UND Thread) — nicht nur unsichtbar', async ({ page }) => {
    await useZooid(page)
    await loginNsec(page, NSEC)
    await page.goto('/rooms/thread')

    const composer = page.getByPlaceholder('Nachricht schreiben…')
    await expect(composer).toBeVisible({ timeout: 15_000 })

    // Vorbedingung scharf halten: der Store muss die Touch-Bedienung wirklich sehen,
    // sonst misst dieser Test gar nichts.
    expect(
        await page.evaluate(() => (window as unknown as { Alpine?: { store(n: string): { mouse?: boolean } } })
            .Alpine?.store('viewport')?.mouse),
        'der Viewport-Store muss die Touch-Bedienung erkennen',
    ).toBe(false)

    // Raum-Composer: kein Knoten, nicht bloß versteckt.
    // `[aria-label=…]` statt `getByRole('button', …)`: Playwrights Rollen-Query nimmt
    // die Accessibility-Tree-Sicht ein und blendet per `display:none` verborgene Knoten
    // SELBST aus — ein `toHaveCount(0)` darüber wäre auch dann grün, wenn der Knopf per
    // `x-show` (statt `x-if`) bloß versteckt, aber weiterhin gemountet wäre (samt
    // emojibase-Nachladung + Hunderte-Knoten-Grid). Der rohe Attribut-Selektor prüft den
    // DOM-Knoten selbst, unabhängig von seiner Sichtbarkeit — genau das ist hier gemeint.
    await expect(page.locator('button[aria-label="Emoji einfügen"]')).toHaveCount(0)

    // Thread öffnen (jede Nachricht ist thread-fähig) und denselben Nachweis dort führen.
    const marker = `TG-${Math.floor(Math.random() * 1e9)}`
    await composer.fill(marker)
    await page.getByRole('button', { name: 'Senden' }).click()
    await expect(page.getByText(marker, { exact: true })).toBeVisible({ timeout: 15_000 })

    const row = page.locator('div.group', { hasText: marker })
    await row.click() // Touch: Tap blendet die Aktionen ein (kein verlässliches CSS-:hover unter hasTouch)
    await row.getByRole('button', { name: 'Im Thread antworten' }).click()
    const dialog = page.getByRole('dialog', { name: 'Thread' })
    await expect(dialog).toBeVisible()
    await expect(page.getByPlaceholder('Im Thread antworten…')).toBeVisible({ timeout: 15_000 })

    // Immer noch kein einziger Knoten im gesamten DOM — weder Raum- noch Thread-Composer.
    // `[aria-label=…]` statt `getByRole('button', …)`: Playwrights Rollen-Query nimmt
    // die Accessibility-Tree-Sicht ein und blendet per `display:none` verborgene Knoten
    // SELBST aus — ein `toHaveCount(0)` darüber wäre auch dann grün, wenn der Knopf per
    // `x-show` (statt `x-if`) bloß versteckt, aber weiterhin gemountet wäre (samt
    // emojibase-Nachladung + Hunderte-Knoten-Grid). Der rohe Attribut-Selektor prüft den
    // DOM-Knoten selbst, unabhängig von seiner Sichtbarkeit — genau das ist hier gemeint.
    await expect(page.locator('button[aria-label="Emoji einfügen"]')).toHaveCount(0)
})
