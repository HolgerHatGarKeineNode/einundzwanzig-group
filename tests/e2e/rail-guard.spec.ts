/**
 * Mobil-Wächter für den Desktop-Navigator.
 *
 * Bewusst OHNE `desktop-`-Präfix: Dateien mit diesem Präfix laufen laut
 * `playwright.config.ts` NUR im 1440px-Projekt und wären als Mobil-Wächter
 * wirkungslos. Dieser hier läuft im Standardprojekt (1279px) und beantwortet die
 * einzige Frage, die die ganze Desktop-Arbeit trägt: **existiert unterhalb des
 * Breakpoints kein Rail-Knoten?**
 *
 * Warum „existiert" und nicht „ist unsichtbar": Alpine initialisiert `x-data` auch
 * in per CSS versteckten Elementen. Ein `hidden xl:flex` bootete die Rail-Insel
 * samt Relay-Subscription auf jedem Telefon mit. Die Rail steht deshalb in einem
 * `<template x-if="$store.viewport?.desktop">` — und genau das prüft dieser Test.
 */
import { test, expect } from './support/fixtures'
import { useZooid } from './support/zooid'
import { loginNsec } from './support/login'

const NSEC = process.env.NOSTR_TEST_NSEC as string

test('Unter 1280 px existiert kein Rail-Knoten — und keine Rail-Insel', async ({ page }) => {
    await useZooid(page)
    await loginNsec(page, NSEC)
    await expect(page.getByText('Zooid Test Space')).toBeVisible({ timeout: 15_000 })

    // Vorbedingung scharf halten: der Test misst nur etwas, wenn er wirklich
    // unterhalb des Breakpoints läuft.
    expect(page.viewportSize()?.width, 'Projekt-Viewport muss unter 1280 liegen').toBeLessThan(1280)

    await expect(page.locator('[data-rail]')).toHaveCount(0)
    expect(
        await page.evaluate(() => (window as unknown as { Alpine?: { store(n: string): { desktop?: boolean } } })
            .Alpine?.store('viewport')?.desktop),
        'der Viewport-Store muss den Desktop-Modus verneinen',
    ).toBe(false)

    // Auch im Raum — dort hängt die Rail an einer anderen Wurzel (`⚡room`, nicht `app-shell`).
    await page.goto('/rooms/welcome')
    await expect(page.getByRole('heading', { name: '# Willkommen' })).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('[data-rail]')).toHaveCount(0)
})
