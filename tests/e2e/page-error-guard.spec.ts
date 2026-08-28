/**
 * **Selbsttest des Laufzeit-Wächters** (`support/pageErrorGuard.ts` + seine Verdrahtung
 * in `support/fixtures.ts`).
 *
 * Dasselbe Muster wie `relay-guard.spec.ts`, aus demselben Grund: ein Nachweis der Form
 * „dieser Test wird rot" lässt sich nicht dauerhaft grün in einer Suite halten. Geprüft
 * wird deshalb positiv über `pageErrorWaechter.gesehen()`, ob die Beobachtung überhaupt
 * bei BEIDEN Kontext-Arten ankommt — die Entscheidungslogik selbst (Erlaubnisliste,
 * Rauschfilter) steht rein und ohne Browser in `support/pageErrorGuard.nodetest.ts`.
 *
 * Beide Tests hier stehen mit Titel UND Textmuster auf der `ERLAUBNISLISTE` in
 * `pageErrorGuard.ts` — ohne diesen Eintrag machte der von ihnen selbst ausgelöste Fehler
 * den Wächter im Abbau zu Recht rot.
 */
import { test, expect } from './support/fixtures'

/**
 * Löst einen ECHTEN uncaught-exception-`pageerror` aus — nicht `page.evaluate()` allein
 * (dessen Wurf landet in der rejecteten Promise des Aufrufs, nie als Browser-Ereignis),
 * sondern derselbe Mechanismus wie Alpines `normalErrorHandler`: ein `throw` in einem
 * `setTimeout`, außerhalb jedes try/catch der Seite.
 */
async function loeseFehlerAus(page: import('./support/fixtures').Page): Promise<void> {
    await page.evaluate(() => {
        setTimeout(() => {
            throw new Error('SELBSTTEST-page-error-guard')
        }, 0)
    })
}

test('Standard-Seite: ein absichtlich ausgelöster Fehler wird beobachtet', async ({ page, pageErrorWaechter }) => {
    await page.goto('/')
    await loeseFehlerAus(page)

    await expect
        .poll(() => pageErrorWaechter.gesehen().some((f) => f.quelle === 'pageerror' && f.text.includes('SELBSTTEST-page-error-guard')), {
            timeout: 5_000,
            message: 'Der Laufzeit-Wächter hat den absichtlich ausgelösten Fehler NICHT gesehen',
        })
        .toBe(true)
})

test('Selbst angelegter Kontext (browser.newContext): ebenso beobachtet', async ({
    browser,
    baseURL,
    pageErrorWaechter,
}) => {
    // Dieselbe Begründung wie im Relay-Wächter-Selbsttest: sechs Bestands-Specs legen
    // ihre Kontexte direkt am `browser` an, nicht am eingebauten `context`-Fixture. Ein
    // Wächter, der nur `page` sieht, wäre dort blind.
    const kontext = await browser.newContext({ baseURL })
    try {
        const seite = await kontext.newPage()
        await seite.goto('/')
        await loeseFehlerAus(seite)

        await expect
            .poll(
                () =>
                    pageErrorWaechter
                        .gesehen()
                        .some((f) => f.quelle === 'pageerror' && f.text.includes('SELBSTTEST-page-error-guard')),
                {
                    timeout: 5_000,
                    message: 'Der Laufzeit-Wächter hat den Fehler aus dem selbst angelegten Kontext NICHT gesehen',
                },
            )
            .toBe(true)
    } finally {
        await kontext.close()
    }
})
