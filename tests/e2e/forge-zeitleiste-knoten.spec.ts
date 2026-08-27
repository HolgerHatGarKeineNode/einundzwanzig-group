import { test, expect, type Page } from './support/fixtures'
import { useZooid, ZOOID_WS } from './support/zooid'
import { loginNsec } from './support/login'
import { spawnSync } from 'node:child_process'
import { nip19 } from 'nostr-tools'

const NSEC = process.env.NOSTR_TEST_NSEC as string
const NAK = process.env.NAK ?? `${process.env.HOME}/go/bin/nak`

/**
 * P7b-N — **DER KNOTEN DER ZEITLEISTE, UND DER WÄCHTER DAGEGEN, DASS ER WIEDER
 * LEER BLEIBT.**
 *
 * Bis zum 2026-08-27 hing die Unterscheidung „Avatar oder 8-px-Marke" an einem
 * Insel-Feld: `<template x-if="zweispaltig">` / `x-if="!zweispaltig"`.
 * `zweispaltig` lebt in `Alpine.data('nostrForge')` — die Detailseite bindet
 * aber `nostrForgeRepo`. Dort warfen **beide** Zweige
 * `Alpine Expression Error: zweispaltig is not defined`, **keiner** rendete, und
 * der Knoten blieb leer.
 *
 * ── Warum dieser Prüfstand existiert ────────────────────────────────────────
 *
 * Der Fehler schrieb **achtmal je Seitenaufruf** in die Konsole und wurde von
 * **619 grünen E2E-Fällen** nicht bemerkt. Ein Defekt, der so laut ist und
 * trotzdem durchrutscht, verdient einen eigenen Wächter — und zwar einen mit
 * zwei Hälften, weil jede allein zu wenig prüft:
 *
 *   1. **Die Konsole bleibt leer.** Das ist der Beweis, dass die BINDUNG lebt.
 *      Alpine meldet einen kaputten Ausdruck als `console.warn` UND als
 *      `pageerror` (der Wurf steht in einem `setTimeout`) — beide werden
 *      gesammelt, sonst hinge die Zusage an einem Kanal, der sich ändern kann.
 *   2. **Genau EIN Knoten ist sichtbar.** Ohne diese Hälfte wäre der Wächter
 *      auch dann grün, wenn die Bindung zwar fehlerfrei ist, aber gar nichts
 *      rendert — exakt der Zustand, der repariert wurde. Und „mindestens einer"
 *      genügt nicht: stünden beide da, hätte die Container-Regel keine Wirkung.
 *
 * ── Und warum die Fassung jetzt an `@container` hängt ───────────────────────
 *
 * Ein Insel-Feld kann ins Leere zeigen, eine CSS-Regel nicht. Dieselbe
 * Zeitleiste steht auf ZWEI Flächen; welcher Knoten passt, hängt an der Breite
 * der Spur und nicht daran, welche Insel gerade bindet. Die Schwelle (24 rem)
 * ist mit ihren zwei gemessenen Randpunkten in `theme.css` hergeleitet — dieser
 * Prüfstand protokolliert die tatsächlichen Breiten mit, damit ein
 * Layout-Umbau, der sie verschiebt, hier sichtbar wird und nicht im Bild.
 *
 * Dieser Prüfstand sät sein eigenes 30617: die Aktivitätsspur speist sich aus
 * dem Repo-Announcement selbst (`repo-created`), ein Verlass auf Reste anderer
 * Läufe wäre in diesem Plan schon einmal schiefgegangen.
 */

const REPO_D = 'e2e-zeitleiste'
/**
 * Die Schwelle aus `theme.css` (`@container zeitleiste`), hier als Zahl.
 *
 * Bewusst ein zweites Literal und keine Ableitung aus dem Stylesheet: der Test
 * soll rot werden, wenn jemand die CSS-Zahl verschiebt, ohne die gemessenen
 * Randpunkte nachzuziehen. Eine Sonde, die ihre Erwartung aus dem Gegenstand
 * holt, prüft nichts.
 */
const SCHWELLE = 352
/** 390 × 844 — ein gewöhnliches Telefon. */
const SCHMAL = { width: 390, height: 844 }
/** 1440 × 900 — dieselbe Lage wie das `desktop`-Projekt. */
const BREIT = { width: 1440, height: 900 }

const nak = (args: readonly string[]): string => {
    const res = spawnSync(NAK, [...args], { encoding: 'utf8', timeout: 30_000 })

    return `${res.stdout ?? ''}\n${res.stderr ?? ''}`
}

let pub = ''
let naddr = ''
let repoId = ''

/** Alpine-Ausdrucksfehler melden sich auf ZWEI Kanälen — beide werden gesammelt. */
type Sammler = { meldungen: string[] }

function sammleFehler(page: Page): Sammler {
    const sammler: Sammler = { meldungen: [] }
    page.on('console', (m) => {
        if (m.type() === 'warning' || m.type() === 'error') {
            sammler.meldungen.push(`${m.type()}: ${m.text()}`)
        }
    })
    page.on('pageerror', (e) => sammler.meldungen.push(`pageerror: ${e.message}`))

    return sammler
}

async function melde(page: Page, groesse: { width: number; height: number }): Promise<void> {
    await useZooid(page)
    await page.addInitScript((url) => {
        ;(window as unknown as { __nostrWorkspace: string }).__nostrWorkspace = url
    }, `${ZOOID_WS}/`)
    await page.setViewportSize(groesse)
    await loginNsec(page, NSEC)
}

/** Die Übersicht mit ihrer Aktivitätsspur. */
async function oeffneUebersicht(page: Page, groesse: { width: number; height: number }): Promise<void> {
    await melde(page, groesse)
    await page.goto('/forge?tab=activity')
    await expect(page.locator('[data-forge-activity]').first()).toBeVisible({ timeout: 30_000 })
}

/** Die Detailseite mit ihrer Aktivitätsspur — die Fläche, auf der der Knoten leer blieb. */
async function oeffneDetail(page: Page, groesse: { width: number; height: number }): Promise<void> {
    await melde(page, groesse)
    await page.goto(`/forge/${naddr}?tab=activity`)
    await expect(page.locator('[data-forge-activity]').first()).toBeVisible({ timeout: 30_000 })
}

/**
 * Was am gerenderten Baum wirklich dasteht: die Breite des Bezugsrahmens und je
 * Knotenart, wie viele davon eine Box haben (`offsetParent`-frei gemessen über
 * `getClientRects`, damit `display:none` sicher als 0 zählt).
 */
async function knoten(page: Page): Promise<{ breite: number; marken: number; gesichter: number }> {
    return page.evaluate(() => {
        const sichtbar = (wahl: string): number =>
            [...document.querySelectorAll(wahl)].filter((el) => el.getClientRects().length > 0).length

        return {
            breite: Math.round(document.querySelector('.forge-zeitleiste')?.getBoundingClientRect().width ?? 0),
            marken: sichtbar('.forge-knoten-marke'),
            gesichter: sichtbar('.forge-knoten-gesicht'),
        }
    })
}

test.describe('Forge: der Knoten der Zeitleiste (P7b-N)', () => {
    test.beforeAll(() => {
        expect(NSEC, 'NOSTR_TEST_NSEC ist nicht gesetzt').toBeTruthy()
        pub = nak(['key', 'public', NSEC]).trim().split('\n')[0]?.trim() ?? ''
        expect(pub).toHaveLength(64)
        naddr = nip19.naddrEncode({ identifier: REPO_D, pubkey: pub, kind: 30617, relays: [] })

        // Ein 30617 genügt: die Aktivitätsspur zeigt es selbst als `repo-created`.
        // Ersetzbar, ein zweiter Lauf überschreibt dieselbe Adresse.
        const aus = nak([
            'event', '--auth', '--sec', NSEC, '-k', '30617',
            '-t', `d=${REPO_D}`, '-t', `name=${REPO_D}`,
            '-t', 'description=E2E Repo fuer den Zeitleisten-Knoten',
            ZOOID_WS,
        ])
        expect(aus, `Der Relay hat ${REPO_D} nicht angenommen: ${aus}`).toContain('success')
        const zeile = aus.split('\n').map((l) => l.trim()).find((l) => l.startsWith('{'))
        repoId = zeile ? (JSON.parse(zeile) as { id: string }).id : ''
        expect(repoId).toHaveLength(64)
    })

    test.afterAll(() => {
        if (repoId) {
            nak(['event', '--auth', '--sec', NSEC, '-k', '5', '-e', repoId, ZOOID_WS])
        }
        nak(['event', '--auth', '--sec', NSEC, '-k', '5', '-t', `a=30617:${pub}:${REPO_D}`, '-t', 'k=30617', ZOOID_WS])
    })

    // ── Beide Zweige, beide Flächen ─────────────────────────────────────────

    for (const [flaeche, oeffne] of [
        ['Übersicht', oeffneUebersicht],
        ['Detailseite', oeffneDetail],
    ] as const) {
        test(`${flaeche}, schmal: die Marke steht, der Avatar nicht`, async ({ page }) => {
            await oeffne(page, SCHMAL)
            const k = await knoten(page)
            console.log(`[zeitleiste] ${flaeche} @${SCHMAL.width}px:`, JSON.stringify(k))
            expect(k.breite, 'Der Bezugsrahmen fehlt — misst diese Sonde noch etwas?').toBeGreaterThan(0)
            expect(k.breite, `Die Spur liegt hier nicht mehr unter der Schwelle (${SCHWELLE}px)`).toBeLessThan(SCHWELLE)
            expect(k.marken, 'Keine Marke sichtbar — der Knoten ist leer').toBeGreaterThan(0)
            expect(k.gesichter, 'Der Avatar steht auf einer schmalen Spur').toBe(0)
        })

        test(`${flaeche}, breit: der Avatar steht, die Marke nicht`, async ({ page }) => {
            await oeffne(page, BREIT)
            const k = await knoten(page)
            console.log(`[zeitleiste] ${flaeche} @${BREIT.width}px:`, JSON.stringify(k))
            expect(k.breite, `Die Spur liegt hier nicht mehr über der Schwelle (${SCHWELLE}px)`).toBeGreaterThanOrEqual(SCHWELLE)
            expect(k.gesichter, 'Kein Avatar sichtbar — der Knoten ist leer').toBeGreaterThan(0)
            expect(k.marken, 'Die Marke steht auf einer breiten Spur').toBe(0)
        })

        /**
         * **Der eigentliche Riegel.** Er hängt weder an einer Breite noch an einer
         * Klasse, sondern an der Aussage, um die es geht: in JEDEM Indikator steht
         * GENAU EIN sichtbarer Knoten. Keiner heißt „leer" (der reparierte Fehler),
         * zwei heißt „die Container-Regel greift nicht".
         */
        test(`${flaeche}: jeder Indikator trägt genau EINEN sichtbaren Knoten`, async ({ page }) => {
            await oeffne(page, BREIT)
            const je = await page.evaluate(() =>
                [...document.querySelectorAll('[data-flux-timeline-indicator]')].map(
                    (ind) =>
                        [...ind.querySelectorAll('.forge-knoten-marke, .forge-knoten-gesicht')].filter(
                            (el) => el.getClientRects().length > 0,
                        ).length,
                ),
            )
            console.log(`[zeitleiste] ${flaeche} Knoten je Indikator:`, JSON.stringify(je))
            expect(je.length, 'Kein einziger Indikator im Baum — diese Sonde misst nichts').toBeGreaterThan(0)
            expect(je, 'Ein Indikator trägt keinen oder zwei Knoten').toEqual(je.map(() => 1))
        })

        /**
         * Die zweite Hälfte: **die Konsole bleibt leer.** Der reparierte Fehler
         * meldete sich hier achtmal je Seitenaufruf.
         */
        test(`${flaeche}: kein Alpine-Ausdrucksfehler in der Konsole`, async ({ page }) => {
            const sammler = sammleFehler(page)
            await oeffne(page, BREIT)
            // Auf einen zweiten Zeichendurchlauf warten: `x-for` rendert die Zeilen
            // nach, und ein kaputter Ausdruck meldet sich JE ZEILE.
            await page.waitForTimeout(500)
            const alpine = sammler.meldungen.filter((m) => m.includes('Alpine Expression Error'))
            expect(alpine, `Alpine-Fehler auf der ${flaeche}: ${alpine.join(' | ')}`).toEqual([])
            expect(
                sammler.meldungen.filter((m) => m.includes('zweispaltig')),
                'Das tote `zweispaltig` ist zurück',
            ).toEqual([])
        })
    }

    /**
     * **KONTROLLE der Sonde selbst.** Ein Sammler, der nie etwas sieht, macht die
     * vier Zusagen darüber vakuum-grün. Hier wird ein Fehler ABSICHTLICH ausgelöst
     * und muss ankommen — ohne diesen Fall wäre „Konsole leer" keine Messung,
     * sondern eine Hoffnung.
     */
    test('KONTROLLE: der Sammler sieht einen echten Alpine-Fehler', async ({ page }) => {
        const sammler = sammleFehler(page)
        await oeffneUebersicht(page, BREIT)
        await page.evaluate(() => {
            const el = document.createElement('div')
            el.setAttribute('x-data', '{}')
            el.setAttribute('x-text', 'gibtEsNichtUndWirftDeshalb')
            document.body.appendChild(el)
        })
        await expect
            .poll(() => sammler.meldungen.filter((m) => m.includes('Alpine Expression Error')).length, {
                timeout: 10_000,
                message: 'Der Sammler hat einen absichtlich ausgelösten Alpine-Fehler NICHT gesehen',
            })
            .toBeGreaterThan(0)
    })
})
