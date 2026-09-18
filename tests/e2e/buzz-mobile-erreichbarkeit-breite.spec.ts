import { test, expect, type Page } from './support/fixtures'
import { useZooid } from './support/zooid'
import { useBuzz, BUZZ_USER_NSEC } from './support/buzz'
import { loginNsec } from './support/login'
import { DESKTOP_QUERY } from '../../packages/einundzwanzig-group/js/viewport'

/**
 * P·mobile-reachability — **die Breitenmessung, die die Phase getragen hat, als
 * eingecheckter Test.**
 *
 * Der Prüfer der Phase musste sich eine eigene Playwright-Sonde bauen, um die
 * DoD-Zeile „gemessen bei 320/369/1280 px, kein waagerechter Überlauf, Ziele
 * ≥ 44×44 auf Touch" zu verifizieren — der Diff brachte keine mit. Diese Datei ist
 * genau diese Sonde, dauerhaft.
 *
 * ── Zwei Ebenen, weil der Prüfgegenstand selbst zweigeteilt ist ──────────────────
 *
 * Die Fläche in `⚡spaces.blade.php`/`dm-list.blade.php` hat ein `x-if`-GATTER, das
 * relay-UNABHÄNGIG ist (`tab === 'rooms' && !focusMode() && !$store.viewport?.desktop`),
 * und einen INHALT, der es nicht ist: `$store.dms?.canDm` ist nur auf einem
 * Buzz-Space wahr (`js/dms.ts`: `mayWriteKind(DM_OPEN, kindOf(activeUrl))`, zooid kennt
 * die Kinds 41010–41012 nicht). Eine leere `<div data-dm-panel>` STEHT deshalb auch
 * gegen zooid im DOM, sobald das Gatter offen ist — nur ohne Kopf, ohne Knopf, ohne
 * Höhe. Was hier wirklich als GEOMETRIE zählt (Kopfzeile, Eröffnen-Knopf, Zielgröße),
 * gibt es nur mit echtem `canDm`, also gegen den Buzz-Teststack.
 *
 * Beschreib A misst deshalb das GATTER (Anwesenheit/Abwesenheit des Knotens, DOM-
 * Ebene, gegen zooid — billig, in jedem Lauf) und trägt die MUTATIONSPROBE. Beschrieb B
 * misst den INHALT (Höhe, Knopf, Touch-Ziel — echte Geometrie, gegen Buzz, nur unter
 * `E2E_RELAY=buzz`). Beide sind Teil dieser einen Zusage; keine der beiden Hälften
 * beweist sie allein.
 */

/** Wartet, bis auf `sel` keine laufende CSS-Transition/-Animation mehr registriert ist. */
async function settled(page: Page, sel: string): Promise<void> {
    await page.waitForFunction(
        (selector) => {
            const el = document.querySelector(selector)
            return el !== null && el.getAnimations().length === 0
        },
        sel,
        { timeout: 5_000 },
    )
}

/** Öffnet das Profil-Popover und wartet, bis es sichtbar UND fertig eingeblendet ist. */
async function openProfilPopover(page: Page): Promise<void> {
    await page.locator('[data-profil-chip]').click()
    await expect(page.locator('[data-profil-popover]')).toBeVisible()
}

// ═══════════════════════════════════════════════════════════════════════════════════
// A — das GATTER (relay-unabhängig, zooid, jeder Lauf)
// ═══════════════════════════════════════════════════════════════════════════════════

test.describe('Space-Seite: Breite, Mitglieder-Zeile, Profil-Popover und das DM-Gatter (E2E, zooid)', () => {
    test.skip(process.env.E2E_RELAY === 'buzz', 'diese Hälfte braucht zooid, nicht den Buzz-Teststack')

    const NSEC = process.env.NOSTR_TEST_NSEC as string

    /**
     * Einmal einloggen, danach nur noch die Ansicht wechseln.
     *
     * **Warum `login` und `resize` getrennt sind.** Der erste Entwurf rief
     * `loginNsec` bei JEDER Breite neu auf. Nach dem ersten Login trägt die Session
     * bereits ein Cookie; `page.goto('/nostr-login')` leitet dann sofort auf
     * `/spaces` weiter, und der Klick auf „Andere Optionen" wartet 30 s auf ein
     * Element, das nie erscheint — gemessen: alle drei Fälle, die mehr als eine
     * Breite prüften, liefen in genau dieses Timeout. `matchMedia` (nicht
     * `resize`) treibt `$store.viewport`, also reicht `setViewportSize` allein,
     * um zwischen den Breiten zu wechseln — kein Reload nötig.
     */
    async function login(page: Page): Promise<void> {
        await useZooid(page)
        await loginNsec(page, NSEC)
        // Boot-Signal: die Mitglieder-Zeile steht unbedingt (kein `x-if`), sobald
        // `nostrSpaces` initialisiert hat — ab hier sind alle abgeleiteten Werte
        // (`focusMode()`, `tab`, `$store.viewport`) verlässlich gesetzt.
        await expect(page.locator('[data-space-mitglieder]')).toBeVisible({ timeout: 15_000 })
    }

    async function resize(page: Page, width: number): Promise<void> {
        await page.setViewportSize({ width, height: 800 })
        // Media-Query-Listener feuert asynchron — auf das Ergebnis warten, statt
        // sofort zu messen, sonst träfe man den Zustand VOR dem Umschalten. Dieselbe
        // Query wie `viewport.ts` (`DESKTOP_QUERY`, 80rem = 1280px bei 16px
        // Standardschrift — die Chromium-Default in diesem Lauf).
        await page.waitForFunction(
            ({ query, w }) => matchMedia(query).matches === (w >= 1280),
            { query: DESKTOP_QUERY, w: width },
        )
    }

    test('KERNBEWEIS: kein waagerechter Überlauf des Dokuments bei 320/369/1280 px', async ({ page }) => {
        await login(page)
        const bericht: string[] = []
        for (const width of [320, 369, 1280]) {
            await resize(page, width)
            const { scrollWidth, clientWidth } = await page.evaluate(() => ({
                scrollWidth: document.documentElement.scrollWidth,
                clientWidth: document.documentElement.clientWidth,
            }))
            bericht.push(`${width}px: scrollWidth=${scrollWidth} clientWidth=${clientWidth}`)
            expect(
                scrollWidth,
                `${width}px: Dokument läuft waagerecht über (scrollWidth ${scrollWidth} > clientWidth ${clientWidth})`,
            ).toBeLessThanOrEqual(clientWidth)
        }
        console.log(`\n[mobile-erreichbarkeit] Dokumentbreite\n${bericht.join('\n')}`)
    })

    test('Mitglieder-Zeile (data-space-mitglieder): ≥ 44 px Ziel, innerhalb der Spalte, bei 320 und 369', async ({ page }) => {
        await login(page)
        const bericht: string[] = []
        for (const width of [320, 369]) {
            await resize(page, width)
            const row = page.locator('[data-space-mitglieder]')
            await expect(row).toBeVisible()
            const box = (await row.boundingBox()) as { x: number; y: number; width: number; height: number }
            expect(box, `${width}px: keine Geometrie an der Mitglieder-Zeile`).toBeTruthy()
            bericht.push(`${width}px: ${box.width.toFixed(2)}×${box.height.toFixed(2)} @ x=${box.x.toFixed(2)}`)

            // WCAG 2.5.8: das Ziel selbst ist ≥ 44 px hoch (min-h-11).
            expect(box.height, `${width}px: Mitglieder-Ziel ist ${box.height}px hoch, erwartet ≥ 44px`).toBeGreaterThanOrEqual(44)
            // Und es ragt nicht aus dem Dokument — dieselbe Prüfung wie oben, lokal
            // am Element statt global, damit ein Regressions-Diff sofort zeigt, WER
            // schuld ist.
            expect(
                box.x + box.width,
                `${width}px: Mitglieder-Zeile ragt über den rechten Rand (${box.x + box.width}px)`,
            ).toBeLessThanOrEqual(width + 1)
        }
        console.log(`\n[mobile-erreichbarkeit] Mitglieder-Zeile\n${bericht.join('\n')}`)
    })

    test('Profil-Popover-Zeilen (data-profil-ziel): 44 px NACH Abschluss der Öffnen-Animation — die 43,64-px-Frage', async ({ page }) => {
        // ── Warum diese Datei den Wert misst und nicht einfach hinnimmt ──────────
        // Der Prüfer maß 43,64 px statt der zugesagten 44 (min-h-11) und vermutete ein
        // Flex-Rundungsartefakt. Das Popover öffnet über `x-transition` OHNE eigene
        // Klassen — das ist Alpines EINGEBAUTER Default (`scale-95 → scale-100`,
        // 150 ms). Eine Messung, die genau in dieses Fenster fällt, skaliert JEDES
        // Kind mit — 44 × 0,95 = 41,8, und irgendwo zwischen 0,95 und 1 liegt 43,64.
        // Das ist KEIN Layout-Fehler, sondern eine Messung mitten in einer laufenden
        // Transition. Der Beweis steht in den zwei Werten unten: roh (sofort nach
        // dem Klick) gegen abgeklungen (`getAnimations().length === 0`).
        await login(page)
        await resize(page, 320)
        await openProfilPopover(page)

        const zeile = page.locator('[data-profil-ziel]').first()
        await expect(zeile).toBeAttached()

        const roh = (await zeile.boundingBox()) as { height: number }
        await settled(page, '[data-profil-popover]')
        const abgeklungen = (await zeile.boundingBox()) as { height: number }

        console.log(
            `\n[mobile-erreichbarkeit] Profil-Zeile: roh=${roh.height.toFixed(2)}px, ` +
                `abgeklungen=${abgeklungen.height.toFixed(2)}px`,
        )

        // Die zugesagte Zahl gilt für den ABGEKLUNGENEN Zustand — den, in dem ein
        // Nutzer die Zeile tatsächlich antippt. Keine Toleranz: `min-h-11` ist ein
        // striktes CSS-Minimum, und ein Wert darunter wäre ein echter Rückfall.
        expect(abgeklungen.height, `Profil-Zeile ist nach Abschluss der Animation ${abgeklungen.height}px hoch, erwartet ≥ 44px`).toBeGreaterThanOrEqual(44)

        // Und der Beleg für die 43,64-px-Beobachtung des Prüfers: eine Messung mitten
        // in der Transition liegt UNTER dem abgeklungenen Wert (das ist erwartbar, wenn
        // die roh-Messung überhaupt eine laufende Transition getroffen hat — trifft sie
        // eine bereits abgeschlossene, sind beide Werte gleich, und das ist ebenfalls
        // ein gültiges, kein rotes Ergebnis).
        expect(roh.height, 'die rohe Messung ist größer als die abgeklungene — das widerspräche der Transitions-These').toBeLessThanOrEqual(abgeklungen.height + 0.01)
    })

    test('KERNBEWEIS: der DM-Abschnitt (data-dm-panel) existiert bei 320/369, NICHT bei 1280', async ({ page }) => {
        await login(page)
        for (const width of [320, 369]) {
            await resize(page, width)
            await expect(
                page.locator('[data-dm-panel]'),
                `${width}px: der DM-Abschnitt fehlt — das Gatter ("tab==='rooms' && !focusMode() && !desktop") ist unter xl offen`,
            ).toHaveCount(1)
        }

        // Die Gegenprobe, ohne die „existiert bei 320/369" nichts über das Gatter
        // aussagt: ab dem Desktop-Breakpoint trägt die Rail dieselbe Fläche, und der
        // Abschnitt darf dort keine zweite Ableitung anmelden (`armList()` würde ein
        // zweites Mal subscriben — genau die Kostenfrage aus dem Blade-Kommentar).
        await resize(page, 1280)
        await expect(
            page.locator('[data-dm-panel]'),
            '1280px: der DM-Abschnitt existiert — er müsste ab dem xl-Breakpoint verschwinden (Rail übernimmt)',
        ).toHaveCount(0)
    })
})

// ═══════════════════════════════════════════════════════════════════════════════════
// B — der INHALT (Buzz-spezifisch: `canDm` ist nur auf einem Buzz-Space wahr)
// ═══════════════════════════════════════════════════════════════════════════════════

test.describe('space page: the row into the encrypted conversations — geometry (E2E, E2E_RELAY=buzz only)', () => {
    /**
     * ── What this block asserted until P3, and what holds now ───────────────────────
     *
     * Until P3 there was a DM SECTION here with a heading, a stock count, an unread pill and
     * a „Neue Unterhaltung" button (`data-dm-neu`), and that button hung on `canDm` — only
     * true on a Buzz space. That was exactly this block's Buzz specificity.
     *
     * D5 of the navigation revamp removes the list: NIP-17 wraps are only decrypted while the
     * Postfach's „Direkt" segment is open, and a list of conversations IS the decrypted
     * state. What is left is ONE neutral row leading there (`data-dm-oeffnen`) — an ordinary
     * link that depends on no relay property any more.
     *
     * **The block stays here and stays Buzz-bound** (rewritten, not deleted — D15): what is
     * measured is the row on the SPACE page of a Buzz space, and the 320/369 px widths are the
     * reason this file exists. The same row against zooid at 390 px is measured by
     * `dm-nav-widths.spec.ts`.
     *
     * The touch-target case below now measures the ROW instead of the vanished button. It
     * carries `min-h-11` (44 px) on every pointer — the fine/coarse branch the old button had
     * through `icon-btn-touch` does not exist on a row, and that IS the statement: the only
     * way into the conversations is thumb-sized on a phone, whatever the browser reports
     * about the pointer.
     */
    test.skip(process.env.E2E_RELAY !== 'buzz', 'nur im Buzz-Modus (E2E_RELAY=buzz) relevant — gemessen wird die Space-Seite eines Buzz-Space')

    async function loginBuzz(page: Page): Promise<void> {
        await useBuzz(page)
        await loginNsec(page, BUZZ_USER_NSEC)
        await expect(page.locator('[data-space-mitglieder]')).toBeVisible({ timeout: 15_000 })
    }

    async function resize(page: Page, width: number): Promise<void> {
        await page.setViewportSize({ width, height: 800 })
        await page.waitForFunction(
            ({ query, w }) => matchMedia(query).matches === (w >= 1280),
            { query: DESKTOP_QUERY, w: width },
        )
    }

    test('320/369: the row into the conversations stands and fits, with real geometry', async ({ page }) => {
        await loginBuzz(page)
        const bericht: string[] = []
        for (const width of [320, 369]) {
            await resize(page, width)
            const panel = page.locator('[data-dm-panel]')
            await expect(panel, `${width}px: DM-Abschnitt fehlt`).toBeVisible()

            const zeile = page.locator('[data-dm-oeffnen]')
            await expect(zeile, `${width}px: die Zeile „Verschlüsselte Nachrichten öffnen" fehlt`).toBeVisible()
            // No button any more, and therefore no number: D5 forbids any statement about the
            // conversations outside the segment. A digit here would be exactly the return the
            // decision rules out.
            await expect(page.locator('[data-dm-neu]'), `${width}px: der alte Eröffnen-Knopf steht wieder da`).toHaveCount(0)
            expect(
                ((await zeile.textContent()) ?? '').match(/\d+/g),
                `${width}px: die Zeile trägt eine Zahl`,
            ).toBeNull()

            const box = (await panel.boundingBox()) as { width: number; height: number }
            bericht.push(`${width}px: Abschnitt ${box.width.toFixed(2)}×${box.height.toFixed(2)}`)

            // `min-h-11` sits on the ROW (see `dm-list.blade.php`), so the section is at least
            // as tall as the thumb target.
            expect(box.height, `${width}px: DM-Abschnitt ist ${box.height}px hoch, erwartet ≥ 44px`).toBeGreaterThanOrEqual(44)
            expect(box.width, `${width}px: DM-Abschnitt ragt aus dem Viewport (${box.width}px)`).toBeLessThanOrEqual(width)
        }
        console.log(`\n[mobile-erreichbarkeit/buzz] DM-Abschnitt\n${bericht.join('\n')}`)
    })

    test('touch target of the row: 44 px tall on a fine AND on a coarse pointer (measured as rendered)', async ({
        page,
        browser,
    }) => {
        await page.setViewportSize({ width: 390, height: 800 })
        await loginBuzz(page)
        const zeileMaus = page.locator('[data-dm-oeffnen]')
        await expect(zeileMaus).toBeVisible()
        const feinBox = (await zeileMaus.boundingBox()) as { width: number; height: number }
        console.log(`[mobile-erreichbarkeit/buzz] Zeile, feiner Zeiger: ${feinBox.width}×${feinBox.height}`)
        // 44 px on BOTH pointers, and that is the difference to the old button: `min-h-11` is
        // a row height, not a `(pointer: coarse)` branch.
        expect(feinBox.height, `feiner Zeiger: Höhe ${feinBox.height}px, erwartet ≥ 44px`).toBeGreaterThanOrEqual(44)

        // Eigener Context: `hasTouch` ist eine CONTEXT-Option und in einem laufenden
        // Test nicht umschaltbar (gleiche Bauform wie `forge-code-zeile-touch.spec.ts`).
        const ctx = await browser.newContext({ hasTouch: true, viewport: { width: 390, height: 800 } })
        const grob = await ctx.newPage()
        await loginBuzz(grob)

        // Vorbedingung: der Context sieht wirklich `pointer: coarse`, sonst misst die
        // Zusage weiter unten nichts.
        expect(
            await grob.evaluate(() => matchMedia('(pointer: coarse)').matches),
            'hasTouch hat (pointer: coarse) nicht gekippt — die Sonde wäre blind',
        ).toBe(true)

        const zeileGrob = grob.locator('[data-dm-oeffnen]')
        await expect(zeileGrob).toBeVisible()
        const grobBox = (await zeileGrob.boundingBox()) as { width: number; height: number }
        console.log(`[mobile-erreichbarkeit/buzz] Zeile, grober Zeiger: ${grobBox.width}×${grobBox.height}`)
        expect(grobBox.height, `grober Zeiger: Höhe ${grobBox.height}px, erwartet ≥ 44px`).toBeGreaterThanOrEqual(44)

        await ctx.close()
    })
})
