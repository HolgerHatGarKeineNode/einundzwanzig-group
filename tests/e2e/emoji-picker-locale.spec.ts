/**
 * The emoji picker speaks the app language: category names and search terms come from
 * the emojibase locale that matches `<html lang>`, and a language emojibase does not
 * have (Latvian) falls back to English. Before, `emoji.ts` always loaded `de/*`, so an
 * English app showed "Smileys & Emotionen" and found nothing for "face".
 *
 * The language is set the way a real switch leaves it: the unencrypted `locale` cookie
 * (`SetLocale::COOKIE`, excluded from cookie encryption in `bootstrap/app.php`). UI
 * strings are looked up in the package's own catalogues, so the locators follow them.
 */
import { test, expect, type Page } from './support/fixtures'
import { readFileSync } from 'node:fs'
import { useZooid } from './support/zooid'
import { loginNsec } from './support/login'

const NSEC = process.env.NOSTR_TEST_NSEC as string

const ui = (appLocale: string, german: string): string => {
    if (appLocale === 'de') {
        return german
    }
    const catalogue = JSON.parse(readFileSync(`packages/einundzwanzig-group/lang/${appLocale}.json`, 'utf8')) as Record<string, string>
    return catalogue[german] ?? german
}

async function openPicker(page: Page, appLocale: string): Promise<void> {
    await useZooid(page)
    await loginNsec(page, NSEC)
    await page.context().addCookies([{ name: 'locale', value: appLocale, url: new URL(page.url()).origin }])
    await page.goto('/rooms/thread')
    await expect(page.locator('html')).toHaveAttribute('lang', appLocale)
    const placeholder = ui(appLocale, 'Nachricht schreiben…')
    await expect(page.getByPlaceholder(placeholder)).toBeVisible({ timeout: 15_000 })
    await page
        .locator('div.relative.flex.items-end.gap-2')
        .filter({ has: page.getByPlaceholder(placeholder) })
        .getByRole('button', { name: ui(appLocale, 'Emoji einfügen') })
        .click()
    await expect(page.getByRole('tablist', { name: ui(appLocale, 'Emoji-Kategorien') })).toBeVisible({ timeout: 15_000 })
}

for (const c of [
    { appLocale: 'en', firstGroup: 'smileys & emotion', query: 'face' },
    { appLocale: 'de', firstGroup: 'Smileys & Emotionen', query: 'gesicht' },
    { appLocale: 'lv', firstGroup: 'smileys & emotion', query: 'face' },
]) {
    test(`emoji picker with app locale ${c.appLocale}: category names and search terms from the matching emojibase data`, async ({ page }) => {
        const dataRequests: string[] = []
        page.on('request', (r) => {
            if (/\/(compact|messages)-[^/]+\.json$/.test(r.url())) {
                dataRequests.push(new URL(r.url()).pathname)
            }
        })
        await openPicker(page, c.appLocale)
        // Only the chosen locale is downloaded: one compact and one messages file.
        expect(dataRequests.filter((u) => u.includes('/compact-'))).toHaveLength(1)
        expect(dataRequests.filter((u) => u.includes('/messages-'))).toHaveLength(1)
        const tabs = page.getByRole('tablist', { name: ui(c.appLocale, 'Emoji-Kategorien') }).getByRole('tab')
        await expect(tabs.first()).toHaveAttribute('aria-label', c.firstGroup)
        await page.getByLabel(ui(c.appLocale, 'Emoji suchen')).fill(c.query)
        // 😀 is "grinning face" / "grinsendes Gesicht": found only with the right language.
        await expect(page.getByText('😀', { exact: true }).first()).toBeVisible()
        // U+1FAEB (Emoji 18) stays out in every language.
        await expect(page.getByText(String.fromCodePoint(0x1faeb), { exact: true })).toHaveCount(0)
    })
}
