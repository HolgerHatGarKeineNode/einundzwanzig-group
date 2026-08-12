/**
 * P7 — Longform-Reader (`/articles`, `/articles/{naddr}`).
 *
 * **Eigener Server pro Worker.** Ob `/articles` seinen Leerzustand oder die Insel zeigt,
 * entscheidet `@if (! config('group.board_relay_url'))` — SERVER-seitig. Der geteilte
 * `serve`-Prozess aus `support/fixtures.ts` läuft für ALLE anderen Specs ohne
 * `NOSTR_BOARD_URL` (Hermetik bleibt erhalten, `fixtures.ts` ist unverändert). Diese Datei
 * importiert deshalb `test`/`expect` aus `support/board-fixtures.ts`, die ZUSÄTZLICH einen
 * zweiten `serve` mit gesetzter `NOSTR_BOARD_URL` hochfährt (siehe dortiger Kopfkommentar)
 * — derselbe worker-eigene zooid wie sonst, nur mit der Board-Config scharf.
 *
 * **Die serverseitige Fail-closed-Frage** (`config('group.board_relay_url')` leer → was
 * sieht der Nutzer?) steht bewusst NICHT hier, sondern in
 * `tests/Feature/LongformReaderTest.php` — reines Blade-Markup-Rendering ohne Alpine-Boot
 * und ohne Relay, die billigere Schicht für eine rein server-seitige Bedingung.
 *
 * Artikel kommen roh über `nak` auf den Relay (Muster `support/rooms.ts`/`quote-card.spec.ts`)
 * — exakte Kontrolle über Tags, `d`-Identifier und Inhalt, siehe `support/articles.ts`.
 */
import { execFileSync } from 'node:child_process'
import { naddrEncode } from 'nostr-tools/nip19'
import { test, expect, type Page } from './support/board-fixtures'
import { useZooid } from './support/zooid'
import { loginNsec } from './support/login'
import { cleanupArticles, publishArticle } from './support/articles'

const NSEC = process.env.NOSTR_TEST_NSEC as string
const ADMIN = 'b2ee09a54bedf17ee1db562bdddd75c48661d981eb52c49dc206c55ba8439414'
const ADMIN_PUB = 'da99fbe39247109327ac8504750d0227d50a8f84049ac8bd2f6c7ad0806ed76d'

const rnd = (): number => Math.floor(Math.random() * 1e9)

/** Der Board-Relay dieses Workers — SELBE Instanz wie der reguläre Space (siehe board-fixtures.ts). */
function boardWs(baseURL: string): string {
    // baseURL sieht aus wie `http://127.0.0.1:8437+slot` — der Board-Relay-Port folgt
    // derselben Formel wie in `support/zooid.ts` (`3335 + slot`). `board-fixtures.ts`
    // rechnet denselben Slot; hier wird er aus der URL rückgewonnen, damit diese Datei
    // keinen zweiten Port-Rechner pflegen muss.
    const port = Number(new URL(baseURL).port)
    const slot = port - 8437
    return `ws://localhost:${3335 + slot}`
}

async function loginToBoard(page: Page): Promise<void> {
    await useZooid(page)
    await loginNsec(page, NSEC)
}

test.afterAll(async ({ baseURL }) => {
    if (baseURL) {
        cleanupArticles(boardWs(baseURL), ADMIN)
    }
})

// ── Liste: alle Artikel, kein draft-*-Verlust (wörtlicher DoD-Punkt) ────────────────

test('Liste: ein normaler Artikel UND ein Artikel mit d=draft-<ts> erscheinen BEIDE — kein draft-*-Verlust', async ({
    page,
    baseURL,
}) => {
    const ws = boardWs(baseURL as string)
    const normalTitle = `LFNormal-${rnd()}`
    const draftTitle = `LFDraft-${rnd()}`

    publishArticle(ws, ADMIN, ADMIN_PUB, {
        identifier: `lf-normal-${rnd()}`,
        title: normalTitle,
        content: 'Ein ganz normal identifizierter Artikel.',
        publishedAt: 1_700_000_000,
    })
    // Der teuerste stille Fehler dieser Phase: ein Filter auf das `d`-Muster verschluckt
    // GENAU diesen Artikel, obwohl er ganz normal publiziert ist (siehe LONGFORM_DRAFT-Doku
    // in js/longform.ts).
    publishArticle(ws, ADMIN, ADMIN_PUB, {
        identifier: `draft-${Date.now()}${rnd()}`,
        title: draftTitle,
        content: 'Ein publizierter Artikel, dessen d-Tag zufällig wie ein Entwurf aussieht.',
        publishedAt: 1_700_000_001,
    })

    await loginToBoard(page)
    await page.goto('/articles')

    await expect(page.getByRole('heading', { name: normalTitle, exact: true })).toBeVisible({ timeout: 20_000 })
    await expect(page.getByRole('heading', { name: draftTitle, exact: true })).toBeVisible({ timeout: 20_000 })
})

// ── Reader lädt und rendert; naddr-Kaltstart ist hier strukturell dasselbe ─────────
//
// Jeder Test bekommt einen FRISCHEN Browser-Kontext (Playwright-Fixture) — das
// Repository ist beim `page.goto()` unten also leer, und `/articles/{naddr}` als ERSTE
// Navigation IST der Kaltstart-Fall (kein vorheriger Listenbesuch, der den Artikel schon
// ins lokale Repository geladen hätte). Deshalb erfüllt dieser eine Test beide DoD-Punkte
// „Reader lädt einen Artikel" und „Kaltstart auf einen geteilten naddr-Link funktioniert".

test('Reader: naddr-Kaltstart lädt den Artikel direkt und rendert Titel, Markdown und Themen', async ({
    page,
    baseURL,
}) => {
    const ws = boardWs(baseURL as string)
    const title = `LFReader-${rnd()}`
    const identifier = `lf-reader-${rnd()}`
    const boldMarker = `Fettmarker${rnd()}`
    const content = `# Überschrift ${rnd()}\n\nEin Absatz mit **${boldMarker}** und einem [Link](https://example.com/artikel).`

    publishArticle(ws, ADMIN, ADMIN_PUB, {
        identifier,
        title,
        content,
        publishedAt: 1_700_000_002,
        topics: ['bitcoin', 'freiheit'],
    })

    const naddr = naddrEncode({ kind: 30023, pubkey: ADMIN_PUB, identifier, relays: [] })

    await loginToBoard(page)
    // Kaltstart: direkte Navigation auf den Artikel-Link, KEIN vorheriger /articles-Besuch.
    await page.goto(`/articles/${naddr}`)

    await expect(page.getByRole('heading', { name: title, level: 1 })).toBeVisible({ timeout: 20_000 })

    const body = page.locator('.article-content')
    await expect(body.locator('strong', { hasText: boldMarker })).toBeVisible({ timeout: 20_000 })
    await expect(body.getByRole('link', { name: 'Link' })).toHaveAttribute('href', 'https://example.com/artikel')
    // Themen (t-Tags) rendern als eigene Chips außerhalb von .article-content.
    await expect(page.getByText('#bitcoin', { exact: true })).toBeVisible()
    await expect(page.getByText('#freiheit', { exact: true })).toBeVisible()
})

// ── Ein kaputter naddr zeigt eine ehrliche Aussage, keine leere Bühne ───────────────

test('Reader: ein syntaktisch kaputter naddr zeigt "gibt es nicht" statt einer leeren/endlos ladenden Seite', async ({
    page,
}) => {
    await loginToBoard(page)
    await page.goto('/articles/naddr1thisisnotvalidbech32atall')

    await expect(page.getByText('Diesen Artikel gibt es nicht.', { exact: true })).toBeVisible({ timeout: 20_000 })
    await expect(page.getByRole('link', { name: 'Alle Artikel' })).toBeVisible()
})

test('Reader: ein syntaktisch gültiger naddr auf einen NIE publizierten Artikel zeigt ebenfalls "gibt es nicht"', async ({
    page,
}) => {
    const ghostNaddr = naddrEncode({ kind: 30023, pubkey: 'f'.repeat(64), identifier: `lf-ghost-${rnd()}`, relays: [] })

    await loginToBoard(page)
    await page.goto(`/articles/${ghostNaddr}`)

    await expect(page.getByText('Diesen Artikel gibt es nicht.', { exact: true })).toBeVisible({ timeout: 20_000 })
})

// ── Einstiege: /spaces-Zeile, Rail (Desktop), Befehlspalette ────────────────────────

test('Einstieg: /spaces zeigt die Zeile "Artikel lesen" und führt zu /articles', async ({ page }) => {
    await loginToBoard(page)
    await page.goto('/spaces')

    const entry = page.getByRole('link', { name: 'Artikel lesen' })
    await expect(entry).toBeVisible({ timeout: 20_000 })
    await entry.click()
    await expect(page).toHaveURL(/\/articles$/)
})

test('Einstieg: die Desktop-Rail-Fußzeile trägt "Artikel" und führt zu /articles', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await loginToBoard(page)
    await page.goto('/spaces')

    const rail = page.locator('[data-rail]')
    await expect(rail).toBeVisible({ timeout: 20_000 })
    const entry = rail.getByRole('link', { name: 'Artikel', exact: true })
    await expect(entry).toBeVisible()
    await entry.click()
    await expect(page).toHaveURL(/\/articles$/)
})

test('Einstieg: die Befehlspalette findet "Artikel" unter Aktionen und führt zu /articles', async ({ page }) => {
    await loginToBoard(page)
    await page.goto('/spaces')
    await expect(page.getByText('Zooid Test Space').first()).toBeVisible({ timeout: 15_000 })

    await page.keyboard.press('Meta+K')
    const dialog = page.locator('dialog[data-modal="command-palette"]')
    await expect(dialog).toBeVisible({ timeout: 10_000 })

    await page.locator('[data-palette-input]').fill('>artikel')
    const row = page.locator('[data-palette-section="actions"]').getByText('Artikel', { exact: true })
    await expect(row).toBeVisible({ timeout: 10_000 })
    await row.click()

    await expect(dialog).toBeHidden({ timeout: 10_000 })
    await expect(page).toHaveURL(/\/articles$/)
})
