import { test, expect } from './support/fixtures'
import { useZooid } from './support/zooid'
import { loginNsec } from './support/login'
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { nsecEncode } from 'nostr-tools/nip19'
import { openedUrls, routeVerein, stubVereinDocument, vereinConfigBody, vereinMeBody } from './support/verein'

/**
 * Regressionsnetz zu den Befunden des `security-auditor` am fertigen
 * Client-Pfad — bewusst eine EIGENE Datei neben `verein-onboarding.spec.ts`,
 * damit die neun dort abgenommenen Fälle unangetastet bleiben.
 *
 * Hier steht nur, was sich ohne Browser nicht belegen lässt. Die Deckelung des
 * Nachfass-Plans (F1) und die Klammer um `Retry-After` sind reine Rechenwege und
 * stehen als erschöpfende Fälle in `packages/einundzwanzig-group/js/vereinFlow.test.ts`;
 * hier geht es um die drei Aussagen, die an der gerenderten Fläche hängen:
 *
 *   F2 — eine gescheiterte Signatur sperrt die Fläche nicht ohne Ausweg.
 *   F3 — ein nicht geöffneter Checkout führt nicht in den Wartezustand.
 *   F4 — ein blosser Adressparameter startet keinen signierenden Plan.
 */

const freshNsec = (): { nsec: string; pk: string } => {
    const sk = generateSecretKey()
    return { nsec: nsecEncode(sk), pk: getPublicKey(sk) }
}

async function setupAndLogin(page: Parameters<typeof useZooid>[0], nsec: string): Promise<void> {
    await stubVereinDocument(page)
    await useZooid(page)
    await loginNsec(page, nsec)
}

// ── F2 — Signatur scheitert: Ausweg statt Sperre ────────────────────────────

/**
 * Bricht `crypto.subtle.digest`.
 *
 * Das ist keine künstliche Konstruktion, sondern einer der drei realen Fälle aus
 * dem Befund: ohne sicheren Kontext gibt es `crypto.subtle` nicht, und
 * `sha256Hex` wirft dann beim Bilden des `payload`-Tags — also GENAU an der
 * Stelle, an der auch eine abgelehnte NIP-07-Signatur und ein NIP-46-Timeout
 * werfen. Alle drei laufen durch denselben `await` in `call()`.
 *
 * Der Weg über `crypto.subtle` ist der einzige davon, der sich ohne Signer-Stub
 * auslösen lässt — die E2E-Suite meldet sich mit einem nsec an, der nie ablehnt.
 */
async function breakSigning(page: Parameters<typeof useZooid>[0]): Promise<void> {
    await page.evaluate(() => {
        Object.defineProperty(crypto.subtle, 'digest', {
            configurable: true,
            value: () => Promise.reject(new Error('E2E: crypto.subtle.digest abgeschaltet')),
        })
    })
}

test('F2: scheitert die Signatur, erscheint ein Ausweg — die Fläche bleibt nicht gesperrt', async ({ page }) => {
    const { nsec } = freshNsec()
    await setupAndLogin(page, nsec)

    await routeVerein(page, {
        config: () => ({ status: 200, body: vereinConfigBody() }),
        me: () => ({ status: 200, body: vereinMeBody() }),
        // Wird nie erreicht: der Antrag scheitert schon beim Signieren, also vor
        // dem `fetch`. Steht hier, damit ein durchgerutschter Aufruf auffiele.
        applications: () => ({ status: 201, body: {} }),
    })

    await page.goto('/verein/beitritt')

    // Statuten → Antrag.
    await expect(page.getByTestId('verein-statuten')).toBeVisible({ timeout: 15_000 })
    await page.getByTestId('verein-statuten-zustimmung').check()
    await page.getByTestId('verein-statuten-weiter').click()
    await expect(page.getByTestId('verein-antrag')).toBeVisible({ timeout: 15_000 })

    await breakSigning(page)
    await page.getByTestId('verein-antrag-senden').click()

    // 1. Es gibt eine sichtbare Meldung. Ohne den Fix blieb `error` null.
    await expect(page.getByTestId('verein-fehler')).toBeVisible({ timeout: 15_000 })

    // 2. Und einen beschrifteten Ausweg — kein leerer Knopf.
    const ausweg = page.getByTestId('verein-fehler-ausweg')
    await expect(ausweg).toBeVisible()
    await expect(ausweg).toHaveText(/\S/)

    // 3. Der Antrags-Knopf ist wieder bedienbar. Ohne den Fix blieb `busy`
    //    stehen und `::disabled="busy !== ''"` sperrte ihn dauerhaft — nur ein
    //    Neuladen half.
    await expect(page.getByTestId('verein-antrag-senden')).toBeEnabled()
})

test('F2: derselbe Fehler sperrt auch die Zahlung nicht', async ({ page }) => {
    // Zweiter Aufrufweg mit eigenem `busy`: `startPayment`. Beide brauchen das
    // `finally`, und ein Fix an nur einer Stelle wäre ein halber Fix.
    const { nsec } = freshNsec()
    await setupAndLogin(page, nsec)

    await routeVerein(page, {
        config: () => ({ status: 200, body: vereinConfigBody() }),
        me: () => ({ status: 200, body: vereinMeBody({ statutes_accepted_at: '2025-01-01T00:00:00Z' }) }),
        invoice: () => ({ status: 200, body: { data: { checkout_url: 'https://checkout.example.test/nie' } } }),
    })

    await page.goto('/verein/beitritt')
    await expect(page.getByTestId('verein-zahlung')).toBeVisible({ timeout: 15_000 })

    await breakSigning(page)
    await page.getByTestId('verein-rechnung-erzeugen').click()

    await expect(page.getByTestId('verein-fehler')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('verein-rechnung-erzeugen')).toBeEnabled()
})

// ── F3 — kein Checkout geöffnet, kein Wartezustand ──────────────────────────

test('F3: blockt der Browser den Checkout, bleibt die Fläche im Zahlschritt', async ({ page }) => {
    const { nsec } = freshNsec()
    await setupAndLogin(page, nsec)

    await routeVerein(page, {
        config: () => ({ status: 200, body: vereinConfigBody() }),
        me: () => ({ status: 200, body: vereinMeBody({ statutes_accepted_at: '2025-01-01T00:00:00Z' }) }),
        invoice: () => ({ status: 200, body: { data: { checkout_url: 'https://checkout.example.test/geblockt' } } }),
    })

    await page.goto('/verein/beitritt')
    await expect(page.getByTestId('verein-zahlung')).toBeVisible({ timeout: 15_000 })
    await page.getByTestId('verein-rechnung-erzeugen').click()
    await expect(page.getByTestId('verein-checkout')).toBeVisible({ timeout: 15_000 })

    // Der Popup-Blocker, nachgestellt: `window.open` liefert `null`. Genau das
    // tut ein Browser, der das Fenster verweigert.
    await page.evaluate(() => {
        window.open = (() => null) as typeof window.open
    })

    await page.getByTestId('verein-checkout').click()

    // Kein Wartezustand — es wurde nichts geöffnet, also ist auch nichts
    // unterwegs. Ohne den Fix stand die Fläche hier auf `warten` und behauptete
    // nach Ablauf des Plans, jemand aus dem Vorstand sehe sich die Zahlung an.
    await expect(page.getByTestId('verein-fehler')).toBeVisible({ timeout: 10_000 })
    await expect(page.getByTestId('verein-warten')).toHaveCount(0)
    await expect(page.getByTestId('verein-zahlung')).toBeVisible()

    // Und der Zustand überlebt auch keinen Reload als „bezahlt".
    await page.reload()
    await expect(page.getByTestId('verein-zahlung')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('verein-warten')).toHaveCount(0)
})

test('F3: der Wartezustand ist verlassbar, solange die Zahlung nicht bestätigt ist', async ({ page }) => {
    const { nsec } = freshNsec()
    await setupAndLogin(page, nsec)

    await routeVerein(page, {
        config: () => ({ status: 200, body: vereinConfigBody() }),
        me: () => ({ status: 200, body: vereinMeBody({ statutes_accepted_at: '2025-01-01T00:00:00Z' }) }),
        invoice: () => ({ status: 200, body: { data: { checkout_url: 'https://checkout.example.test/abbruch' } } }),
        refresh: () => ({ status: 200, body: vereinMeBody({ statutes_accepted_at: '2025-01-01T00:00:00Z' }) }),
    })

    await page.goto('/verein/beitritt')
    await expect(page.getByTestId('verein-zahlung')).toBeVisible({ timeout: 15_000 })
    await page.getByTestId('verein-rechnung-erzeugen').click()
    await expect(page.getByTestId('verein-checkout')).toBeVisible({ timeout: 15_000 })

    await page.getByTestId('verein-checkout').click()
    await expect(page.getByTestId('verein-warten')).toBeVisible({ timeout: 15_000 })
    expect(await openedUrls(page)).toContain('https://checkout.example.test/abbruch')

    // „Geöffnet" ist nicht „bezahlt": der Nutzer kommt zurück, ohne gezahlt zu
    // haben, und muss den Zahlschritt wieder erreichen.
    await page.getByTestId('verein-warten-abbrechen').click()
    await expect(page.getByTestId('verein-zahlung')).toBeVisible({ timeout: 10_000 })

    // Und der lokale Beleg ist weg — sonst käme der Wartezustand nach einem
    // Reload zurück.
    await page.reload()
    await expect(page.getByTestId('verein-zahlung')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('verein-warten')).toHaveCount(0)
})

// ── F4 — ein Link allein lässt keinen Signer arbeiten ───────────────────────

test('F4: ?schritt=warten allein löst keinen einzigen signierten Aufruf aus', async ({ page }) => {
    const { nsec } = freshNsec()
    await setupAndLogin(page, nsec)

    const { calls } = await routeVerein(page, {
        config: () => ({ status: 200, body: vereinConfigBody() }),
        me: () => ({ status: 200, body: vereinMeBody({ statutes_accepted_at: '2025-01-01T00:00:00Z' }) }),
        refresh: () => ({ status: 200, body: vereinMeBody({ statutes_accepted_at: '2025-01-01T00:00:00Z' }) }),
    })

    // Der Link, den ein Fremder schickt. Kein lokaler Beleg, keine bestätigte
    // Zahlung — nur ein Adressparameter.
    await page.goto('/verein/beitritt?schritt=warten')

    // Der Wartezustand darf gezeigt werden (die Rücksprung-Route lebt davon,
    // und Anzeigen kostet nichts) …
    await expect(page.getByTestId('verein-warten')).toBeVisible({ timeout: 15_000 })

    // … aber es wird nichts signiert. Der Plan startet die erste Runde nach
    // 0 ms; 4 Sekunden decken davon mehrere ab.
    await page.waitForTimeout(4_000)
    expect(calls.refresh, 'ein Adressparameter hat einen signierten Aufruf ausgelöst').toBe(0)

    // Auch der Sichtbarkeitswechsel ist kein Schlupfloch — das war der zweite
    // Weg in denselben Zustand.
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
    await page.waitForTimeout(1_000)
    expect(calls.refresh, 'der Sichtbarkeitswechsel hat den Riegel umgangen').toBe(0)

    // Der ausdrückliche Wunsch des Nutzers bleibt dagegen möglich — sonst wäre
    // der Riegel eine Sackgasse.
    await page.getByTestId('verein-jetzt-pruefen').click()
    await expect.poll(() => calls.refresh, { timeout: 10_000 }).toBeGreaterThan(0)
})

test('F4: der echte Rücksprung nach einer selbst begonnenen Zahlung fasst weiterhin nach', async ({ page }) => {
    // Die Gegenprobe: mit lokalem Beleg — also nach einem Checkout, den DIESER
    // Browser geöffnet hat — muss der Plan laufen. Ohne diesen Fall wäre der
    // Riegel aus F4 nicht von „kaputt" zu unterscheiden.
    const { nsec } = freshNsec()
    await setupAndLogin(page, nsec)

    const { calls } = await routeVerein(page, {
        config: () => ({ status: 200, body: vereinConfigBody() }),
        me: () => ({ status: 200, body: vereinMeBody({ statutes_accepted_at: '2025-01-01T00:00:00Z' }) }),
        invoice: () => ({ status: 200, body: { data: { checkout_url: 'https://checkout.example.test/echt' } } }),
        refresh: () => ({ status: 200, body: vereinMeBody({ statutes_accepted_at: '2025-01-01T00:00:00Z' }) }),
    })

    await page.goto('/verein/beitritt')
    await expect(page.getByTestId('verein-zahlung')).toBeVisible({ timeout: 15_000 })
    await page.getByTestId('verein-rechnung-erzeugen').click()
    await expect(page.getByTestId('verein-checkout')).toBeVisible({ timeout: 15_000 })
    await page.getByTestId('verein-checkout').click()
    await expect(page.getByTestId('verein-warten')).toBeVisible({ timeout: 15_000 })

    // Zurück über die allowlist-fähige Route — wie der Verein es tut.
    await page.goto('/verein/zurueck')
    await expect(page.getByTestId('verein-warten')).toBeVisible({ timeout: 15_000 })
    await expect.poll(() => calls.refresh, { timeout: 15_000 }).toBeGreaterThan(0)
})

// ── F5 — der Sichtbarkeitswechsel umgeht die Deckelung nicht ────────────────

test('F5: nach Ablauf des Plans fasst kein App-Wechsel mehr von selbst nach', async ({ page }) => {
    // Der Befund war aus dem Quelltext gelesen, nicht gemessen: `_onVisible`
    // prüfte `exhausted` nicht. Jede Rückkehr in den Vordergrund war damit eine
    // weitere Runde — unbegrenzt oft, und auf Buzz riss jede davon über
    // `_reconnectDirectory` den Socket ab (`Pool.remove`), was JEDE andere
    // Subscription auf demselben Relay mitnimmt und ein NIP-42-AUTH kostet.
    //
    // Hier gemessen wird die Ursache, nicht die Wirkung: der Plan ist durch, und
    // ein Sichtbarkeitswechsel darf keine zehnte Runde erzeugen.
    test.setTimeout(45_000)
    const { nsec } = freshNsec()
    await setupAndLogin(page, nsec)

    const { calls } = await routeVerein(page, {
        config: () => ({ status: 200, body: vereinConfigBody() }),
        me: () => ({ status: 200, body: vereinMeBody({ statutes_accepted_at: '2025-01-01T00:00:00Z' }) }),
        invoice: () => ({ status: 200, body: { data: { bolt11: null, checkout_url: 'https://checkout.example.test/f5' } } }),
        refresh: () => ({ status: 200, body: vereinMeBody({ statutes_accepted_at: '2025-01-01T00:00:00Z' }) }),
    })

    await page.goto('/verein/beitritt')
    await expect(page.getByTestId('verein-zahlung')).toBeVisible({ timeout: 15_000 })
    await page.getByTestId('verein-rechnung-erzeugen').click()
    await expect(page.getByTestId('verein-checkout')).toBeVisible({ timeout: 15_000 })

    // Fake-Clock vor dem ersten Timer, gleiche Begründung wie in
    // `verein-onboarding.spec.ts`: `runFor` feuert je Aufruf nur den zunächst
    // fälligen Timer, deshalb viele kleine Schritte.
    await page.clock.install({ time: Date.now() })
    await page.getByTestId('verein-checkout').click()
    await expect(page.getByTestId('verein-warten')).toBeVisible({ timeout: 5_000 })

    for (let i = 0; i < 30 && calls.refresh < 9; i++) {
        await page.clock.runFor(305_000)
        await page.waitForTimeout(50)
    }

    expect(calls.refresh, 'Vorbedingung: der Plan muss durchgelaufen sein').toBe(9)
    await expect(page.getByTestId('verein-warten-ende')).toBeVisible()

    /*
     * Die Uhr MUSS hier noch einmal vorlaufen, sonst prüft der Test nichts.
     *
     * `_lastAttemptAt` wird aus `Date.now()` gesetzt — und `Date.now()` ist
     * gefälscht. Direkt nach der letzten Runde liegt der Zeitpunkt also nur
     * Millisekunden zurück, und `shouldFollowUpOnResume` (20-s-Sperre) verweigert
     * das Nachfassen ganz von selbst. Der Test wäre grün geblieben, auch ohne die
     * `exhausted`-Prüfung — beim ersten Kalibrierungslauf ist er das prompt.
     *
     * Nach Ablauf des Plans steht kein Timer mehr aus, `runFor` lässt hier also
     * nur Zeit vergehen. Danach greift die 20-s-Sperre nicht mehr, und es hält
     * allein `exhausted` — genau die Aussage, um die es geht.
     */
    await page.clock.runFor(60_000)

    for (let i = 0; i < 3; i++) {
        await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
        await page.waitForTimeout(200)
    }

    expect(calls.refresh, 'ein App-Wechsel hat den abgelaufenen Plan wiederbelebt').toBe(9)

    // Der ausdrückliche Weg bleibt offen — sonst wäre die Deckelung eine Sackgasse.
    await page.getByTestId('verein-jetzt-pruefen').click()
    await expect.poll(() => calls.refresh, { timeout: 10_000 }).toBe(10)
})
