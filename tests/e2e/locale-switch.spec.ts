import { test, expect, type Page } from './support/fixtures'
import { useZooid } from './support/zooid'
import { loginNsec } from './support/login'

const NSEC = process.env.NOSTR_TEST_NSEC as string

/**
 * P2 (Strang A) — Locale-Mechanik im echten Browser.
 *
 * Bewusst OHNE Assertion gegen konkret übersetzten Wortlaut: `lang/*.json`
 * wird gerade weiter befüllt (Strang B, parallel im selben Repo). Geprüft
 * wird die Mechanik — welcher `lang`-Code am `<html>`-Element ankommt und ob
 * er einen Reload/eine Navigation/einen Browser-Neustart überlebt — nicht
 * der übersetzte Text selbst.
 *
 * `playwright.config.ts` pinnt `locale: 'de-DE'` für den ganzen Lauf; ohne
 * eigenes Cookie/eigenen Header rendert die Seite deshalb deutsch (`lang="de"`).
 */

async function openSettings(page: Page): Promise<void> {
    await useZooid(page)
    await loginNsec(page, NSEC)
    await page.goto('/settings')
    await expect(page.getByRole('heading', { name: 'Sprache' })).toBeVisible()
}

test('P2: Sprachwechsel löst einen vollen Reload aus und "<html lang>" folgt', async ({ page }) => {
    await openSettings(page)

    await expect(page.locator('html')).toHaveAttribute('lang', 'de')

    await page.locator('select[name="locale"]').selectOption('es')
    await page.getByRole('button', { name: 'Sprache wechseln' }).click()

    // Der Submit ist ein normaler Formular-POST (kein wire:navigate) — die
    // Seite lädt komplett neu und landet wieder auf /settings (back()-Fallback).
    await page.waitForURL('**/settings')
    await expect(page.locator('html')).toHaveAttribute('lang', 'es')
})

test('P2: die Sprachwahl überlebt wire:navigate (Cookie bleibt, <html lang> bleibt)', async ({ page }) => {
    await openSettings(page)

    await page.locator('select[name="locale"]').selectOption('es')
    await page.getByRole('button', { name: 'Sprache wechseln' }).click()
    await page.waitForURL('**/settings')
    await expect(page.locator('html')).toHaveAttribute('lang', 'es')

    // SPA-Navigation über die Shell-Nav (wire:navigate, tauscht nur den Body) —
    // kein page.goto(), sonst wäre es wieder ein voller Reload und der eigentliche
    // Beweis (Head/<html> überlebt die Navigation) entfiele.
    // `route()` rendert eine ABSOLUTE href (http://127.0.0.1:PORT/spaces) — auf das
    // Pfadende matchen, nicht auf einen relativen String. `.last()`, nicht
    // `.first()`: das DOM trägt ZWEI Nav-Kopien (Desktop-Rail zuerst, dann die
    // Mobil-Bottom-Bar — beide teilen `aria-label="Hauptnavigation"`), bei
    // 1279px ist nur die zweite (Bottom-Bar) sichtbar, die erste ist `hidden`
    // und darauf klicken würde mit einem Actionability-Timeout scheitern.
    await page.locator('a[href$="/spaces"]').last().click()
    await page.waitForURL('**/spaces')
    await expect(page.locator('html')).toHaveAttribute('lang', 'es')

    await page.locator('a[href$="/settings"]').last().click()
    await page.waitForURL('**/settings')
    await expect(page.locator('html')).toHaveAttribute('lang', 'es')
})

test('P2: die Sprachwahl ist persistent (Cookie), nicht an die Session gebunden — überlebt einen Browser-Neustart', async ({
    page,
    browser,
    baseURL,
}) => {
    await openSettings(page)

    await page.locator('select[name="locale"]').selectOption('es')
    await page.getByRole('button', { name: 'Sprache wechseln' }).click()
    await page.waitForURL('**/settings')

    // "Browser-Neustart" simuliert: NUR das langlebige `locale`-Cookie in einen
    // frischen, ansonsten leeren Context kopieren — explizit OHNE das
    // Session-Cookie. Ein echter Neustart löscht Session-Cookies (kein
    // expliziter Ablauf) und behält nur Cookies mit expliziter Lebensdauer
    // (das `locale`-Cookie: 1 Jahr). Wäre die Sprache an die Session gebunden,
    // fiele sie hier auf Deutsch zurück.
    const cookies = await page.context().cookies()
    const localeCookie = cookies.find((c) => c.name === 'locale')
    expect(localeCookie, 'locale-Cookie fehlt nach dem Wechsel').toBeTruthy()
    expect(localeCookie!.value).toBe('es')

    const freshContext = await browser.newContext({ baseURL })
    await freshContext.addCookies([localeCookie!])

    const freshPage = await freshContext.newPage()
    await freshPage.goto('/')
    await expect(freshPage.locator('html')).toHaveAttribute('lang', 'es')

    await freshContext.close()
})
