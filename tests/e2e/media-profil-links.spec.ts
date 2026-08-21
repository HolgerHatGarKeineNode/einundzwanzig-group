/**
 * Die Profil-Querverlinkung nach `media.einundzwanzig.space` — **am echten Stack.**
 *
 * **Warum diese Datei im HOST liegt:** Playwright ist ausschließlich hier eingerichtet
 * (`playwright.config.ts`, `tests/e2e/support/`); das Paket bringt kein Browser-Harness
 * mit. Sie zieht `test`/`expect` aus `support/board-fixtures.ts` — dem zweiten `serve`
 * mit gesetzter `NOSTR_BOARD_URL` —, weil eine der fünf Zusagen auf der Autorenseite
 * hängt und die ohne Artikel-Quelle ihren Leerzustand zeigt.
 *
 * **Der Name darf NICHT mit `buzz-` beginnen** — sonst fiele die Datei aus dem
 * Normal-Lauf in den Buzz-Arm (`playwright.config.ts`, `BUZZ_SPECS`).
 *
 * ── Was hier steht und was NICHT ────────────────────────────────────────────────────
 *
 * Die Adressbildung selbst ist reine Logik und liegt in
 * `packages/einundzwanzig-group/js/medienProfil.test.ts` (13 Fälle unter `node --test`,
 * inklusive der Verwechslung gegen die ECHTE `verifiedNip05`). Dass beide Flächen sie
 * benutzen, hält `js/medienProfilMarkup.test.ts` fest; die serverseitige Weiche
 * (Konstante, `.env.example`, beide head-Partials) `tests/Feature/MediaProfilLinkTest.php`.
 *
 * Hier steht nur, was diese drei NICHT zeigen können: **dass die Kette Relay → kind 0 →
 * `.well-known` → welshman-Handle → Alpine → `href` im echten Browser wirklich
 * zusammenhängt** — und zwar in beiden Ausgängen. Der teure Teil ist genau der eine
 * Fall, der still falsch sein kann: eine Domain, die den Namen für JEMAND ANDEREN führt.
 *
 * ── Der Testschlüssel und nicht der ADMIN ───────────────────────────────────────────
 *
 * kind 0 ist ersetzbar, und der Relay wird innerhalb eines Laufs von allen Specs dieses
 * Workers geteilt. Das Profil des ADMINS anzufassen hat beim Bau von P3 vierzehn fremde
 * Tests gerissen (`longform-reader.spec.ts`, NIP-05-Test). Deshalb wird ausschließlich
 * das Profil des TEST-USERS gesetzt und im `finally` mit jüngerem Stempel
 * zurückgeschrieben — dasselbe Muster wie im KERNBEWEIS von `article-author.spec.ts`.
 */
import { npubEncode } from 'nostr-tools/nip19'
import { test, expect, type Page, type Locator } from './support/board-fixtures'
import { useZooid } from './support/zooid'
import { loginNsec } from './support/login'
import { testKeys } from './support/keys'
import { publishProfile } from './support/articles'

const NSEC = process.env.NOSTR_TEST_NSEC as string

const rnd = (): number => Math.floor(Math.random() * 1e9)

/** Der Board-Relay dieses Workers — dieselbe Rechnung wie in `article-author.spec.ts`. */
function boardWs(baseURL: string): string {
    const port = Number(new URL(baseURL).port)

    return `ws://localhost:${3335 + (port - 8437)}`
}

/**
 * Die Basis, die dieser Lauf benutzt — **eine eigene, nicht die produktive.**
 *
 * Gesetzt per `addInitScript`, was die `??`-Regel im Head-Partial ausdrücklich zulässt.
 * Zwei Gründe: der Test hängt damit nicht an der `.env` des Rechners, und eine Erwartung
 * auf `media.einundzwanzig.space` prüfte am Ende den Default statt die Kette. **Dass der
 * Default wirklich ankommt, prüft die billigere Schicht** (`MediaProfilLinkTest.php`,
 * Literal-Vergleich) — hier geht es um das, was der Browser daraus baut.
 */
const BASIS = 'https://media.test.example/#'

async function boot(page: Page, medienBasis: string = BASIS): Promise<void> {
    await useZooid(page)
    await page.addInitScript((wert) => {
        ;(window as unknown as { __nostrMedia?: string }).__nostrMedia = wert
    }, medienBasis)
    await loginNsec(page, NSEC)
}

/**
 * Die Profilkarte öffnen — über genau den Weg, den elf Stellen im Haus benutzen.
 *
 * `open-profile` trägt eine HEX-Pubkey (Vertrag, in `quote-card.spec.ts` festgehalten).
 * Der Dispatch statt eines Klicks ist hier richtig: geprüft wird die KARTE, nicht der
 * Auslöser, und jeder echte Auslöser hat seine eigene Spec.
 */
async function oeffneKarte(page: Page, pubkey: string): Promise<Locator> {
    await page.evaluate((pk) => {
        window.dispatchEvent(new CustomEvent('open-profile', { detail: pk }))
    }, pubkey)

    const karte = page.getByRole('dialog').filter({ has: page.getByRole('button', { name: 'npub kopieren' }) })
    await expect(karte).toBeVisible({ timeout: 15_000 })

    return karte
}

/** Der Verweis auf der Karte bzw. auf der Autorenseite. */
const verweis = (wurzel: Page | Locator, flaeche: 'karte' | 'autor'): Locator =>
    wurzel.locator(`[data-medien-profil="${flaeche}"]`)

// ── 1. Der Fall, der still falsch sein kann ────────────────────────────────────────

test('SICHERHEIT: die Domain führt den Namen für JEMAND ANDEREN — der Verweis trägt die npub', async ({
    page,
    baseURL,
}) => {
    /*
     * **Das ist der teure Fall.** Das `nip05`-Feld eines kind 0 ist eine Selbstauskunft:
     * jeder kann `satoshi@…` hineinschreiben. Nähme der Verweis sie ungeprüft, führte er
     * auf eine FREMDE Person — und zwar mit unserer Empfehlung im Rücken. Sichtbar wäre
     * daran nichts, denn der Link funktioniert ja.
     *
     * Die Domain antwortet hier wie eine echte: sie kennt den Namen, führt ihn aber für
     * einen anderen Schlüssel. `.example` ist per RFC 2606 reserviert und wird nie
     * aufgelöst — griffe die Route unten nicht, ginge die Anfrage ins Leere statt an
     * einen fremden Rechner.
     */
    const ws = boardWs(baseURL as string)
    const { pk: USER_PUB } = testKeys()
    const USER_NPUB = npubEncode(USER_PUB)
    const domain = `mp-fremd-${rnd()}.example`
    const behauptet = `satoshi@${domain}`
    const ts = Math.floor(Date.now() / 1000)

    const gefragt: string[] = []
    await page.route('**/.well-known/nostr.json*', async (route) => {
        gefragt.push(route.request().url())
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            headers: { 'Access-Control-Allow-Origin': '*' },
            // Der Name existiert — er gehört nur einem anderen Schlüssel.
            body: JSON.stringify({ names: { satoshi: '1'.repeat(64) } }),
        })
    })

    publishProfile(ws, NSEC, { name: `MPFremd-${rnd()}`, nip05: behauptet, about: 'Behauptet einen fremden Handle.' }, ts)

    try {
        await boot(page)
        await page.goto('/articles')
        const karte = await oeffneKarte(page, USER_PUB)

        const link = verweis(karte, 'karte')
        await expect(link).toBeVisible({ timeout: 15_000 })

        // **Die Schranke, und sie ist hier nicht schmückend.** Ohne sie wäre „trägt die
        // npub" auch dann grün, wenn die Verifikation nie stattgefunden hat — etwa weil
        // das Profil gar nicht ankam. Erst die tatsächlich gerufene URL macht daraus eine
        // Aussage über die PRÜFUNG.
        await expect
            .poll(() => gefragt.filter((url) => url.includes(domain)).length, { timeout: 15_000 })
            .toBeGreaterThan(0)
        expect(gefragt.find((url) => url.includes(domain))).toBe(
            `https://${domain}/.well-known/nostr.json?name=satoshi`,
        )

        // Der Verweis trägt die npub — und die behauptete Adresse steht NIRGENDS darin.
        await expect(link).toHaveAttribute('href', `${BASIS}/u/${USER_NPUB}`)
        expect(await link.getAttribute('href')).not.toContain('satoshi')

        // Und die Karte setzt auch kein Häkchen: dieselbe Prüfung, dieselbe Antwort.
        await expect(karte.getByText(behauptet, { exact: true })).toHaveCount(0)
    } finally {
        publishProfile(ws, NSEC, { name: 'Alice Test' }, ts + 1)
    }
})

// ── 2. Die Positivkontrolle dazu ───────────────────────────────────────────────────

test('BESTÄTIGT: nennt die .well-known genau diesen Schlüssel, trägt der Verweis die Adresse', async ({
    page,
    baseURL,
}) => {
    // Ohne diesen Test wäre der obige auch dann grün, wenn die Fläche NIE eine Adresse in
    // den Link setzte — der ganze NIP-05-Zweig wäre tot und niemand merkte es.
    const ws = boardWs(baseURL as string)
    const { pk: USER_PUB } = testKeys()
    const domain = `mp-echt-${rnd()}.example`
    const handle = `alice@${domain}`
    const ts = Math.floor(Date.now() / 1000)

    await page.route('**/.well-known/nostr.json*', (route) =>
        route.fulfill({
            status: 200,
            contentType: 'application/json',
            headers: { 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({ names: { alice: USER_PUB } }),
        }),
    )

    publishProfile(ws, NSEC, { name: `MPEcht-${rnd()}`, nip05: handle, about: 'Bestätigter Handle.' }, ts)

    try {
        await boot(page)
        await page.goto('/articles')
        const karte = await oeffneKarte(page, USER_PUB)

        const link = verweis(karte, 'karte')
        // Die Adresse trifft ASYNCHRON ein (kind 0, dann `.well-known`). Bis dahin steht
        // dort die npub — deshalb wird auf den Endzustand gewartet, nicht einmal gelesen.
        await expect(link).toHaveAttribute('href', `${BASIS}/u/${handle}`, { timeout: 20_000 })
    } finally {
        publishProfile(ws, NSEC, { name: 'Alice Test' }, ts + 1)
    }
})

// ── 3. Der Rückfallweg trägt immer ─────────────────────────────────────────────────

test('OHNE NIP-05 steht der Verweis trotzdem — und ist ein echter externer Anker', async ({ page, baseURL }) => {
    const ws = boardWs(baseURL as string)
    const { pk: USER_PUB } = testKeys()
    const USER_NPUB = npubEncode(USER_PUB)
    const ts = Math.floor(Date.now() / 1000)

    // Keine `.well-known`-Route: es darf gar keine Anfrage geben, wenn das Profil keinen
    // Handle trägt. Eine abgebrochene Anfrage würde das hier nicht unterscheidbar machen,
    // deshalb wird gezählt.
    let angefragt = 0
    await page.route('**/.well-known/nostr.json*', (route) => {
        angefragt += 1

        return route.abort()
    })

    publishProfile(ws, NSEC, { name: `MPOhne-${rnd()}`, about: 'Kein Handle.' }, ts)

    try {
        await boot(page)
        await page.goto('/articles')
        const karte = await oeffneKarte(page, USER_PUB)

        const link = verweis(karte, 'karte')
        await expect(link).toHaveAttribute('href', `${BASIS}/u/${USER_NPUB}`, { timeout: 20_000 })

        // Ein externer Anker, kein SPA-Sprung. `noreferrer` steht dabei nicht nur zur
        // Zierde: das Ziel bekommt sonst die vollständige URL der Seite mit, von der aus
        // jemand ein Profil aufgerufen hat.
        await expect(link).toHaveAttribute('target', '_blank')
        await expect(link).toHaveAttribute('rel', 'noopener noreferrer')
        expect(await link.getAttribute('wire:navigate')).toBeNull()

        expect(angefragt, 'ein Profil ohne nip05 ist kein Grund, irgendwo anzuklopfen').toBe(0)
    } finally {
        publishProfile(ws, NSEC, { name: 'Alice Test' }, ts + 1)
    }
})

// ── 4. Die zweite Fläche ───────────────────────────────────────────────────────────

test('Die AUTORENSEITE trägt denselben Verweis — mit demselben Ziel', async ({ page, baseURL }) => {
    const ws = boardWs(baseURL as string)
    const { pk: USER_PUB } = testKeys()
    const USER_NPUB = npubEncode(USER_PUB)
    const ts = Math.floor(Date.now() / 1000)

    // Die Autorenkarte erscheint nur, wenn sie etwas TRÄGT (P4-Entwurf: eine leere Box
    // mit einem Knopf wäre schlimmer als keine Karte). `about` genügt dafür.
    publishProfile(ws, NSEC, { name: `MPAutor-${rnd()}`, about: 'Ein Autor mit Karte.' }, ts)

    try {
        await boot(page)
        await page.goto(`/articles/autor/${USER_NPUB}`)

        const link = verweis(page, 'autor')
        await expect(link).toHaveAttribute('href', `${BASIS}/u/${USER_NPUB}`, { timeout: 20_000 })
        await expect(link).toBeVisible()

        // **Beide Flächen, ein Ziel.** Steht die Karte offen, muss ihr Verweis dieselbe
        // Adresse tragen wie die Zeile darüber — zwei Wahrheiten über „wo ist dieses
        // Profil öffentlich" wären genau der Zustand, den dieses Vorhaben beseitigt.
        const karte = await oeffneKarte(page, USER_PUB)
        await expect(verweis(karte, 'karte')).toHaveAttribute('href', `${BASIS}/u/${USER_NPUB}`)
    } finally {
        publishProfile(ws, NSEC, { name: 'Alice Test' }, ts + 1)
    }
})

// ── 5. Leere Basis heißt: kein Ziel ────────────────────────────────────────────────

test('LEERE Basis: die Zeile bleibt verborgen und hat kein href — kein Tabstopp ins Leere', async ({
    page,
    baseURL,
}) => {
    /*
     * Der zweite Riegel neben dem serverseitigen `@if`. Er greift dort, wo der Server
     * nichts weiß: `window.__nostrMedia` kann von einem Fremdhost oder einem Testlauf
     * geleert werden, nachdem das Markup schon steht.
     *
     * `''` und nicht „nicht gesetzt": `??` fällt nur bei `null`/`undefined` zurück, ein
     * leerer String gewinnt also — genau die Eigenschaft, die einen Lauf die Basis
     * ausdrücklich WEGnehmen lässt.
     */
    const ws = boardWs(baseURL as string)
    const { pk: USER_PUB } = testKeys()
    const ts = Math.floor(Date.now() / 1000)

    publishProfile(ws, NSEC, { name: `MPLeer-${rnd()}`, about: 'Ohne Verweis.' }, ts)

    try {
        await boot(page, '')
        await page.goto('/articles')
        const karte = await oeffneKarte(page, USER_PUB)

        const link = verweis(karte, 'karte')
        // Das Element steht im Dokument (der SERVER hat eine Basis konfiguriert) …
        await expect(link).toHaveCount(1)
        // … aber es ist weder sichtbar noch ein Ziel. Ohne `href` ist ein `<a>` kein
        // Tabstopp — ein leerer String stattdessen ergäbe einen fokussierbaren Link auf
        // die aktuelle Seite.
        await expect(link).toBeHidden()
        expect(await link.getAttribute('href')).toBeNull()
    } finally {
        publishProfile(ws, NSEC, { name: 'Alice Test' }, ts + 1)
    }
})
