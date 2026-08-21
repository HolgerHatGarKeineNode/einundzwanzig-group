/**
 * **Der Tab der Forge-Übersicht in der Adresse — beide Richtungen (P5).**
 *
 * Die Abweichung `/spaces?tab=workspaces` → `/forge?tab=workspaces` hat DREI Hälften,
 * und jede einzelne genügt allein nicht:
 *
 *   1. die Weiterleitung selbst — gedeckt in `tests/Feature/OrtskartenTest.php`
 *      (`assertRedirect`);
 *   2. der Leser auf der Zielseite — gedeckt in `js/forgeTab.test.ts` (`readForgeTab`);
 *   3. **das Zurückschreiben** (`syncTabParam` im `init()` von `nostrForge`) — DAS HIER.
 *
 * Ohne (3) behauptet die Adresse nach dem ersten Tab-Klick weiter „workspaces", und ein
 * daraus kopierter Link führt den nächsten Leser woandershin als den Absender. Das ist
 * wörtlich der Fehler, gegen den die ganze Vorkehrung gebaut ist — nur an der Stelle,
 * an der ihn niemand vermutet.
 *
 * `syncTabParam` liegt in der Alpine-Closure und ist nicht exportiert: node kommt nicht
 * heran, Pest sieht nur den Server. Es bleibt E2E, und zwar nach dem vorhandenen Muster
 * des Geschwisters auf `/spaces` (`room.spec.ts`, „Tab-Auswahl wird in ?tab= gespiegelt").
 *
 * Kein Buzz-Stack nötig: die Tab-Leiste rendert der SERVER, sobald
 * `config('group.workspace_url')` gesetzt ist — das besorgt `support/fixtures.ts` mit dem
 * worker-eigenen Relay. Ob dahinter Daten liegen, ist für die Adressfrage gleichgültig.
 */
import { test, expect } from './support/fixtures'
import { useZooid } from './support/zooid'
import { loginNsec } from './support/login'

const NSEC = process.env.NOSTR_TEST_NSEC as string

test('der Forge-Tab wird in ?tab= gespiegelt — und der Startwert steht NICHT drin', async ({ page }) => {
    await useZooid(page)
    await loginNsec(page, NSEC)
    await page.goto('/forge')

    const tab = (name: string) => page.getByRole('tab', { name, exact: true })
    await expect(tab('Aktivität')).toBeVisible({ timeout: 20_000 })

    // Startwert: saubere Adresse, kein Parameter. Genau die Zusage aus `forgeTab.ts`.
    await expect(page).toHaveURL(/\/forge$/)

    // Jeder andere Tab landet in der Adresse.
    await tab('Workspaces').click()
    await expect(page).toHaveURL(/[?&]tab=workspaces/, { timeout: 10_000 })

    await tab('Repositories').click()
    await expect(page).toHaveURL(/[?&]tab=repos/, { timeout: 10_000 })

    await tab('Projekte').click()
    await expect(page).toHaveURL(/[?&]tab=projects/, { timeout: 10_000 })

    // …und zurück auf den Startwert räumt ihn wieder WEG, statt `tab=activity`
    // stehen zu lassen. Ohne diesen Zweig wäre die saubere Adresse oben eine
    // Eigenschaft des ersten Aufrufs statt eine Regel.
    await tab('Aktivität').click()
    await expect(page).toHaveURL(/\/forge$/, { timeout: 10_000 })
})

test('die weitergeleitete Adresse kommt an: /forge?tab=workspaces öffnet den vierten Tab', async ({ page }) => {
    await useZooid(page)
    await loginNsec(page, NSEC)

    // Der Zielzustand der Weiterleitung, hier direkt angesteuert — die Kette aus
    // Redirect + Leser + Rückschreiben ist damit über alle drei Hälften geschlossen.
    await page.goto('/forge?tab=workspaces')
    await expect(page.locator('[data-forge-workspaces]')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByRole('tab', { name: 'Workspaces', exact: true })).toHaveAttribute('aria-selected', 'true')

    // Und die Adresse bleibt, was sie war — das Zurückschreiben beim Mount darf einen
    // GÜLTIGEN Parameter nicht wegräumen.
    await expect(page).toHaveURL(/[?&]tab=workspaces/)
})

test('ein ungültiger Tab-Parameter wird aus der Adresse GERÄUMT, nicht stehengelassen', async ({ page }) => {
    await useZooid(page)
    await loginNsec(page, NSEC)

    // `readForgeTab` verwirft ihn (node-getestet). Die Adresse muss nachziehen, sonst
    // behauptet sie weiter etwas, das der Bildschirm nicht zeigt — und der Nutzer teilt
    // genau diesen Link erneut.
    await page.goto('/forge?tab=quatsch')
    await expect(page.getByRole('tab', { name: 'Aktivität', exact: true })).toBeVisible({ timeout: 20_000 })
    await expect(page).toHaveURL(/\/forge$/, { timeout: 10_000 })
})
