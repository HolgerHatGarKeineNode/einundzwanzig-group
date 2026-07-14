import { test, expect, type Page } from './support/fixtures'
import { useZooid } from './support/zooid'
import { loginNsec } from './support/login'

const NSEC = process.env.NOSTR_TEST_NSEC as string

/** Loggt via nsec ein und öffnet den Einstellungen-Tab (dort liegt der Theme-Switch). */
async function openSettings(page: Page): Promise<void> {
    await useZooid(page)
    await loginNsec(page, NSEC)
    await page.goto('/settings/space')
    await expect(page.getByText('Darstellung')).toBeVisible()
}

/**
 * D4 (Theme) — der Switch bindet an Flux' geteilten `flux.appearance`-Store:
 * „Dunkel" setzt `.dark` am <html> + persistiert localStorage, „Hell" entfernt
 * beides. Das ist die Voraussetzung für den Portal-WebView-Sync (same-origin).
 */
test('D4: Theme-Switch schaltet .dark am <html> und persistiert flux.appearance', async ({ page }) => {
    await openSettings(page)

    // Dunkel wählen → .dark gesetzt + im Store persistiert.
    await page.locator('ui-radio[aria-label="Dunkel"]').click()
    await expect(page.locator('html')).toHaveClass(/dark/)
    expect(await page.evaluate(() => localStorage.getItem('flux.appearance'))).toBe('dark')

    // Hell wählen → .dark weg + Store auf light.
    await page.locator('ui-radio[aria-label="Hell"]').click()
    await expect(page.locator('html')).not.toHaveClass(/dark/)
    expect(await page.evaluate(() => localStorage.getItem('flux.appearance'))).toBe('light')
})

/** Die Präferenz überlebt Navigation (flackerfrei aus dem <head>-Skript). */
test('D4: Theme-Präferenz überlebt wire:navigate', async ({ page }) => {
    await openSettings(page)

    await page.locator('ui-radio[aria-label="Dunkel"]').click()
    await expect(page.locator('html')).toHaveClass(/dark/)

    await page.goto('/directory')
    await expect(page.locator('html')).toHaveClass(/dark/)
})
