import { type Page } from '@playwright/test'

/**
 * nsec-Login über das GEHÄRTETE Formular (login-form.blade.php): der nsec-Pfad ist bewusst
 * hinter „Andere Optionen" (aufklappen) + einer Risiko-Checkbox („Ich verstehe das Risiko",
 * schaltet das Feld frei) versteckt; der Submit-Button heißt „Trotzdem anmelden (unsicher)".
 * Wartet auf das Gate (/spaces).
 *
 * Ein Helper statt der früher in jedem Spec kopierten 3-Zeilen-Sequenz — die kippte alle E2E-
 * Logins, als das Formular gehärtet wurde (Feld disabled hinter Checkbox, Button umbenannt).
 */
export async function loginNsec(page: Page, nsec: string): Promise<void> {
    await page.goto('/nostr-login')
    await page.getByRole('button', { name: 'Andere Optionen' }).click()
    await page.getByLabel('Ich verstehe das Risiko').check()
    await page.getByPlaceholder(/nsec1/).fill(nsec)
    await page.getByRole('button', { name: /Trotzdem anmelden/ }).click()
    await page.waitForURL('**/spaces')
}
