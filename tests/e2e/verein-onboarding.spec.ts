import { test, expect } from './support/fixtures'
import { useZooid } from './support/zooid'
import { loginNsec } from './support/login'
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { nsecEncode } from 'nostr-tools/nip19'
import { openedUrls, routeVerein, seedWallet, stubDeadSpace, stubVereinDocument, vereinConfigBody, vereinMeBody } from './support/verein'

/**
 * P6 — E2E-Netz für den Onboarding-Flow (`/verein/beitritt`), das dritte Netz
 * neben dem Reduzierer (`js/vereinFlow.test.ts`, 35 Fälle über alle 2¹⁰
 * Eingaben) und dem Pest-Markup-Vertrag (`tests/Feature/VereinOnboardingTest.php`).
 * Geprüft wird hier die GERENDERTE Fläche in einem echten Browser — kein Markup,
 * keine Logik isoliert, sondern die Verdrahtung dazwischen (`js/verein.ts`).
 *
 * Kein Test hier braucht `trackRoom()`/`cleanupRooms()`: der Flow legt keine
 * Nostr-Räume an, nur der übliche zooid-Seed aus `zooid-testserver.sh` wird
 * gelesen (für den Lesefehler-Zweig sogar bewusst NICHT).
 *
 * Alle sechs Proxy-Endpunkte sind über `page.route('**\/api/verein/**', …)`
 * (support/verein.ts `routeVerein`) vollständig gestubbt — nichts hier ruft je
 * BTCPay oder die echte Vereins-API, und kein Test zahlt echtes Geld (P6-DoD
 * Punkt 5). Ein „mit Wallet" verbundenes NWC-Wallet wird direkt in die
 * IndexedDB geseedet (`seedWallet`) — `payInvoice()` wird nie aufgerufen, nur
 * die Weiche `canPayInApp` (bolt11 + Wallet vorhanden) geprüft.
 */

const freshNsec = (): { sk: Uint8Array; nsec: string; pk: string } => {
    const sk = generateSecretKey()
    return { sk, nsec: nsecEncode(sk), pk: getPublicKey(sk) }
}

/** Login + Dokument-Stub in einem Rutsch — der übliche Vorlauf jedes Tests hier. */
async function setupAndLogin(page: Parameters<typeof useZooid>[0], nsec: string): Promise<void> {
    await stubVereinDocument(page)
    await useZooid(page)
    await loginNsec(page, nsec)
}

// ── 1. Der volle Weg: Statuten → Antrag → Zahlung (Checkout-Zweig) ───────────

test('voller Weg ohne Wallet: Statuten, Antrag und Zahlung ohne die App zu verlassen bis zum Checkout', async ({ page }) => {
    const { nsec } = freshNsec()
    await setupAndLogin(page, nsec)

    const { calls } = await routeVerein(page, {
        config: () => ({ status: 200, body: vereinConfigBody() }),
        me: () => ({ status: 200, body: vereinMeBody() }),
        applications: () => ({ status: 201, body: { data: { status: 'ok' } } }),
        invoice: () => ({ status: 200, body: { data: { checkout_url: 'https://checkout.example.test/voller-weg', bolt11: null } } }),
        refresh: () => ({ status: 200, body: vereinMeBody({ statutes_accepted_at: '2025-01-01T00:00:00Z' }) }),
    })

    await page.goto('/verein/beitritt')

    // Schritt 1: Statuten. Fortschritt zeigt den ersten Punkt aktiv.
    await expect(page.getByTestId('verein-statuten')).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('li[data-step="statuten"]')).toHaveAttribute('data-state', 'active')
    await expect(page.locator('li[data-step="antrag"]')).toHaveAttribute('data-state', 'todo')
    await expect(page.getByTestId('verein-statuten-weiter')).toBeDisabled()

    await page.getByTestId('verein-statuten-zustimmung').click()
    await expect(page.getByTestId('verein-statuten-weiter')).toBeEnabled()
    await page.getByTestId('verein-statuten-weiter').click()

    // Schritt 2: Antrag. Statuten-Marke ist jetzt erledigt, Antrag aktiv.
    await expect(page.getByTestId('verein-antrag')).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('li[data-step="statuten"]')).toHaveAttribute('data-state', 'done')
    await expect(page.locator('li[data-step="antrag"]')).toHaveAttribute('data-state', 'active')

    await page.getByTestId('verein-antrag-senden').click()

    // Schritt 3: Zahlung — `submitApplication()` ruft `startPayment()` selbst auf
    // (kein zusätzlicher Klick „jetzt bezahlen"), die Rechnung ist deshalb schon da.
    await expect(page.getByTestId('verein-zahlung')).toBeVisible({ timeout: 15_000 })
    expect(calls.applications, 'genau ein Antrag wurde gesendet').toBe(1)
    await expect(page.getByTestId('verein-checkout')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('verein-wallet-zahlen')).toHaveCount(0)

    await page.getByTestId('verein-checkout').click()

    // Schritt 4: Warten. Checkout öffnet extern (abgefangen), Fortschritt zeigt Warten aktiv.
    await expect(page.getByTestId('verein-warten')).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('li[data-step="zahlung"]')).toHaveAttribute('data-state', 'done')
    await expect(page.locator('li[data-step="warten"]')).toHaveAttribute('data-state', 'active')
    expect(await openedUrls(page)).toContain('https://checkout.example.test/voller-weg')
})

// ── 2. Mit Wallet: BOLT11 + Wallet → Zahlweg in der App ──────────────────────

test('mit Wallet: BOLT11 und verbundene Wallet zusammen zeigen den In-App-Zahlweg, nicht den Checkout', async ({ page }) => {
    const { nsec, pk } = freshNsec()
    await setupAndLogin(page, nsec)
    await seedWallet(page, pk)

    await routeVerein(page, {
        config: () => ({ status: 200, body: vereinConfigBody() }),
        me: () => ({ status: 200, body: vereinMeBody({ statutes_accepted_at: '2025-01-01T00:00:00Z' }) }),
        invoice: () => ({ status: 200, body: { data: { bolt11: 'lnbc210n1pjmitteinverbindungsteste2e', checkout_url: null } } }),
    })

    await page.goto('/verein/beitritt')
    await expect(page.getByTestId('verein-zahlung')).toBeVisible({ timeout: 15_000 })
    await page.getByTestId('verein-rechnung-erzeugen').click()

    await expect(page.getByTestId('verein-wallet-zahlen')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('verein-checkout')).toHaveCount(0)
    // Der Hinweis „mit einer verbundenen Wallet zahlst du direkt in der App" gilt
    // nur für `bolt11 && !hasWallet` — mit Wallet darf er nicht erscheinen.
    await expect(page.getByText('Mit einer verbundenen Wallet zahlst du direkt in der App.')).toBeHidden()
})

// ── 3. Ohne Wallet: keine verbundene Wallet → Checkout, selbst mit vorhandener BOLT11 ──

test('ohne Wallet: eine BOLT11 allein reicht nicht — ohne verbundene Wallet bleibt es beim Checkout', async ({ page }) => {
    // Kein `seedWallet()` — die Gegenprobe zum Test „mit Wallet": dieselbe
    // Rechnung (BOLT11 vorhanden), aber KEINE Wallet verbunden. Die Weiche
    // `canPayInApp` verlangt BEIDES; fällt die `hasWallet`-Bedingung aus dem
    // Reduzierer, zeigt diese Fläche den In-App-Knopf trotzdem — genau das
    // deckt dieser Fall auf (kalibriert, siehe Bericht).
    const { nsec } = freshNsec()
    await setupAndLogin(page, nsec)

    await routeVerein(page, {
        config: () => ({ status: 200, body: vereinConfigBody() }),
        me: () => ({ status: 200, body: vereinMeBody({ statutes_accepted_at: '2025-01-01T00:00:00Z' }) }),
        invoice: () => ({
            status: 200,
            body: { data: { bolt11: 'lnbc210n1pohnewallete2e', checkout_url: 'https://checkout.example.test/ohne-wallet-mit-bolt11' } },
        }),
    })

    await page.goto('/verein/beitritt')
    await expect(page.getByTestId('verein-zahlung')).toBeVisible({ timeout: 15_000 })
    await page.getByTestId('verein-rechnung-erzeugen').click()

    await expect(page.getByTestId('verein-checkout')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('verein-wallet-zahlen')).toHaveCount(0)
    // Der Hinweistext gilt genau für diesen Fall (`bolt11 && !hasWallet`).
    await expect(page.getByText('Mit einer verbundenen Wallet zahlst du direkt in der App.')).toBeVisible()
})

// ── 3b. `bolt11 === null` UND fehlendes Feld führen beide in den Checkout ────

test('ohne Wallet, bolt11 explizit null: Checkout-Zweig, kein Wallet-Knopf', async ({ page }) => {
    const { nsec } = freshNsec()
    await setupAndLogin(page, nsec)

    await routeVerein(page, {
        config: () => ({ status: 200, body: vereinConfigBody() }),
        me: () => ({ status: 200, body: vereinMeBody({ statutes_accepted_at: '2025-01-01T00:00:00Z' }) }),
        invoice: () => ({ status: 200, body: { data: { bolt11: null, checkout_url: 'https://checkout.example.test/ohne-wallet-null' } } }),
    })

    await page.goto('/verein/beitritt')
    await expect(page.getByTestId('verein-zahlung')).toBeVisible({ timeout: 15_000 })
    await page.getByTestId('verein-rechnung-erzeugen').click()

    await expect(page.getByTestId('verein-checkout')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('verein-wallet-zahlen')).toHaveCount(0)
})

test('ohne Wallet, bolt11 fehlt als Feld ganz: derselbe Checkout-Zweig wie bei null', async ({ page }) => {
    const { nsec } = freshNsec()
    await setupAndLogin(page, nsec)

    await routeVerein(page, {
        config: () => ({ status: 200, body: vereinConfigBody() }),
        me: () => ({ status: 200, body: vereinMeBody({ statutes_accepted_at: '2025-01-01T00:00:00Z' }) }),
        // `bolt11` steht hier gar nicht im Objekt — anders als der Fall oben.
        invoice: () => ({ status: 200, body: { data: { checkout_url: 'https://checkout.example.test/ohne-wallet-fehlt' } } }),
    })

    await page.goto('/verein/beitritt')
    await expect(page.getByTestId('verein-zahlung')).toBeVisible({ timeout: 15_000 })
    await page.getByTestId('verein-rechnung-erzeugen').click()

    await expect(page.getByTestId('verein-checkout')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('verein-wallet-zahlen')).toHaveCount(0)
})

// ── 4. Rechnung abgelaufen: „Neue Rechnung erzeugen" ersetzt die alte ────────

test('Rechnung abgelaufen: „Neue Rechnung erzeugen" ersetzt die Checkout-Adresse wirklich', async ({ page }) => {
    const { nsec } = freshNsec()
    await setupAndLogin(page, nsec)

    const { calls } = await routeVerein(page, {
        config: () => ({ status: 200, body: vereinConfigBody() }),
        me: () => ({ status: 200, body: vereinMeBody({ statutes_accepted_at: '2025-01-01T00:00:00Z' }) }),
        invoice: (idx) => ({
            status: 200,
            body: { data: { bolt11: null, checkout_url: idx === 0 ? 'https://checkout.example.test/ALT' : 'https://checkout.example.test/NEU' } },
        }),
    })

    await page.goto('/verein/beitritt')
    await expect(page.getByTestId('verein-zahlung')).toBeVisible({ timeout: 15_000 })
    await page.getByTestId('verein-rechnung-erzeugen').click()
    await expect(page.getByTestId('verein-checkout')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('verein-neue-rechnung')).toBeVisible()

    await page.getByTestId('verein-neue-rechnung').click()
    await expect.poll(() => calls.invoice, { timeout: 15_000 }).toBe(2)
    await expect(page.getByTestId('verein-checkout')).toBeVisible({ timeout: 15_000 })

    // Die eigentliche Zusicherung: der Knopf öffnet jetzt die NEUE Adresse, nicht
    // mehr die alte — eine tote Rechnung wird wirklich verworfen, nicht nur ein
    // zweiter Aufruf gestartet, dessen Ergebnis am Bildschirm nirgends ankommt.
    await page.getByTestId('verein-checkout').click()
    const opened = await openedUrls(page)
    expect(opened.at(-1)).toBe('https://checkout.example.test/NEU')
    expect(opened).not.toContain('https://checkout.example.test/ALT')
})

// ── 5. Zahlung in Prüfung: Nachfass-Plan durch, immer noch nicht bestätigt ───

test('Zahlung in Prüfung: nach neun erfolglosen Nachfass-Runden erklärt die Fläche „wird geprüft"', async ({ page }) => {
    test.setTimeout(30_000)
    const { nsec } = freshNsec()
    await setupAndLogin(page, nsec)

    const { calls } = await routeVerein(page, {
        config: () => ({ status: 200, body: vereinConfigBody() }),
        me: () => ({ status: 200, body: vereinMeBody({ statutes_accepted_at: '2025-01-01T00:00:00Z' }) }),
        invoice: () => ({ status: 200, body: { data: { bolt11: null, checkout_url: 'https://checkout.example.test/pruefung' } } }),
        // Der Verein bestätigt die Zahlung NIE — genau der Fall, der den
        // Nachfass-Plan (`FOLLOW_UP_SECONDS`, 9 Runden über 20 Minuten) durchlaufen lässt.
        refresh: () => ({ status: 200, body: vereinMeBody({ statutes_accepted_at: '2025-01-01T00:00:00Z' }) }),
    })

    await page.goto('/verein/beitritt')
    await expect(page.getByTestId('verein-zahlung')).toBeVisible({ timeout: 15_000 })
    await page.getByTestId('verein-rechnung-erzeugen').click()
    await expect(page.getByTestId('verein-checkout')).toBeVisible({ timeout: 15_000 })

    // Fake-Clock installieren, BEVOR der erste Nachfass-Timer entsteht (der Klick
    // unten löst ihn synchron aus) — Playwrights `page.clock` feuert pro Aufruf
    // JEWEILS NUR den zunächst fälligen Timer, nicht die per Folge-`fetch()`
    // NEU registrierten (empirisch geprüft: ein einzelner `runFor('20:05')` über
    // die vollen 1205 s feuerte nur EINE Runde). Deshalb: viele kleine Aufrufe in
    // einer Schleife, mit einer winzigen ECHTEN Wartezeit dazwischen, damit die
    // async `fetch`-Kette (läuft in Echtzeit, nur `setTimeout`/`Date` sind
    // gefälscht) den nächsten Timer registrieren kann, bevor der nächste
    // `runFor` danach sucht.
    await page.clock.install({ time: Date.now() })
    await page.getByTestId('verein-checkout').click()
    await expect(page.getByTestId('verein-warten')).toBeVisible({ timeout: 5_000 })
    await expect(page.getByTestId('verein-warten')).toHaveAttribute('data-stage', 'zahlung-offen')

    for (let i = 0; i < 30 && calls.refresh < 9; i++) {
        await page.clock.runFor(305_000)
        await page.waitForTimeout(50)
    }

    // Kalibrierbarer Kern: GENAU neun Runden, nicht „irgendwann exhausted" —
    // eine Abweichung hier deckt sowohl einen zu frühen als auch einen nie
    // eintretenden Abbruch auf.
    expect(calls.refresh, 'der Nachfass-Plan hat nicht exakt neun Runden durchlaufen').toBe(9)
    await expect(page.getByTestId('verein-warten')).toHaveAttribute('data-stage', 'zahlung-geprueft')
    await expect(page.getByTestId('verein-warten-pruefung')).toBeVisible()
    await expect(page.getByText('Jemand aus dem Vorstand sieht sich das an', { exact: false })).toBeVisible()
    // Die Fläche sagt auch AN, dass sie aufgehört hat automatisch nachzufragen —
    // sonst sieht ein zwei Minuten stiller Bildschirm aus, als hinge er.
    await expect(page.getByTestId('verein-warten-ende')).toBeVisible()
})

// ── 6. Lesefehler ist kein „kein Mitglied" ───────────────────────────────────

test('Lesefehler: ein nicht lesbarer Space behauptet nicht „kein Mitglied"', async ({ page }) => {
    test.setTimeout(30_000)
    const { nsec } = freshNsec()
    await stubVereinDocument(page)
    await useZooid(page)
    // NACH useZooid registrieren, damit die Vereins-Directory-Subscription ins
    // Leere läuft: der Relay bekommt nie eine Antwort (kein EOSE, kein CLOSED),
    // der `DIRECTORY_TIMEOUT_MS`-Riegel (12 s) muss also selbst eingreifen.
    await stubDeadSpace(page)
    await loginNsec(page, nsec)

    await routeVerein(page, {
        config: () => ({ status: 200, body: vereinConfigBody() }),
        // Bereits bezahlt UND Statuten akzeptiert — sonst würde der Flow schon
        // aus einem ANDEREN Grund nicht in den Wartezustand kommen. Nur SO ist
        // die einzige verbliebene Ursache für „kein `freischaltung`" wirklich der
        // Lesefehler und nichts anderes.
        me: () => ({ status: 200, body: vereinMeBody({ statutes_accepted_at: '2025-01-01T00:00:00Z', current_year: { year: 2026, paid: true } }) }),
    })

    // Volle Navigation (kein `wire:navigate`): `groups.ts` liest `__nostrSpace`
    // erst beim Modul-Load neu ein.
    await page.goto('/verein/beitritt')
    await expect(page.getByTestId('verein-warten')).toBeVisible({ timeout: 15_000 })

    // Vor dem Timeout: „wird geprüft", KEINE Aussage über Mitgliedschaft.
    await expect(page.getByTestId('verein-warten')).toHaveAttribute('data-stage', 'zugang-pruefen')

    // Nach dem Timeout: Lesefehler mit Ausweg statt Behauptung.
    await expect(page.getByTestId('verein-warten')).toHaveAttribute('data-stage', 'lesefehler', { timeout: 15_000 })
    await expect(page.getByTestId('verein-warten-lesefehler')).toBeVisible()
    await expect(page.getByText('Zugang konnte nicht geprüft werden')).toBeVisible()
    await expect(page.getByText('Das sagt nichts über deine Mitgliedschaft', { exact: false })).toBeVisible()
    await expect(page.getByTestId('verein-jetzt-pruefen')).toBeVisible()

    // Die teuerste Verwechslung überhaupt: nirgends auf der Fläche darf die
    // Gate-Formulierung stehen — weder jetzt noch je während des Ladens.
    await expect(page.getByText('Noch kein Vereinsmitglied')).toHaveCount(0)
    await expect(page.getByTestId('verein-warten-freischaltung')).toHaveCount(0)
})

// ── 7. Rücksprung aus dem Checkout ────────────────────────────────────────────

test('GET /verein/zurueck setzt im Wartezustand ab, nie im Zahlschritt', async ({ page }) => {
    const { nsec } = freshNsec()
    await stubVereinDocument(page)
    await useZooid(page)
    await loginNsec(page, nsec)

    await routeVerein(page, {
        config: () => ({ status: 200, body: vereinConfigBody() }),
        // Verzögert, absichtlich: die Zusicherung ist NICHT „irgendwann kommt der
        // Wartezustand", sondern „der Zahlschritt wird an KEINER Stelle gezeigt" —
        // auch nicht während `/me` noch unterwegs ist.
        me: async () => {
            await new Promise((r) => setTimeout(r, 2000))
            return { status: 200, body: vereinMeBody({ statutes_accepted_at: '2025-01-01T00:00:00Z' }) }
        },
    })

    await page.goto('/verein/zurueck')
    await expect(page).toHaveURL(/\/verein\/beitritt\?schritt=warten/)

    await expect(page.getByTestId('verein-zahlung')).toBeHidden()
    await expect(page.getByTestId('verein-warten')).toBeVisible({ timeout: 5_000 })
    await expect(page.getByTestId('verein-zahlung')).toBeHidden()
    await expect(page.getByTestId('verein-warten')).toHaveAttribute('data-stage', 'zahlung-offen')
})
