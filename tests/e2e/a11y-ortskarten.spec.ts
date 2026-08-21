/**
 * **Der Kontrast-Anker der Ortskarten-Leiste (P5).**
 *
 * ── Warum es diese Datei gibt ────────────────────────────────────────────────────────
 *
 * Der Docblock der Komponente nennt fünf Kontrastwerte. Fünf Zahlen ohne Riegel sind
 * fünf Behauptungen mit Verfallsdatum: die nächste Änderung an der Tönung der aktiven
 * Karte kippt sie, und niemand rechnet nach. `a11y-contrast.spec.ts` und
 * `desktop-a11y-contrast.spec.ts` kennen die Leiste nicht (`grep -c ortskarte` → 0 in
 * beiden), also fiele sie durch jedes vorhandene Netz.
 *
 * ── Warum `support/contrast.ts` und KEINE eigene Rechnung ───────────────────────────
 *
 * Die erste Messung dieser Werte lief mit einem selbstgebauten Parser
 * (`css.match(/[\d.]+/g)`) — und genau der ist der Fehler, gegen den `COLOR_SRC`
 * geschrieben wurde: **Chromium serialisiert `bg-brand-500/10` als
 * `oklab(0.75 0.077 0.148 / 0.1)`**, nicht als `rgb()`. Ein Parser, der alle Zahlen für
 * 0–255-Komponenten hält, liest `0.75` als „fast schwarz" und komponiert einen frei
 * erfundenen Untergrund. Die aktive Ortskarte ist genau so eine getönte Fläche, also
 * war jede der fünf Zahlen mit dem falschen Werkzeug gewonnen.
 *
 * Der Haus-Helfer löst zusätzlich drei Dinge, die eine Ad-hoc-Rechnung nicht kennt:
 * er komponiert Vordergrund UND Untergrund schichtweise bis zum ersten opaken Vorfahren,
 * er führt die wirksame `opacity` mit (die Unterzeilen dieser Leiste tragen eine!), und
 * er leitet die SCHWELLE aus der Rolle ab — Text 4,5:1, Grafik 3:1, Großschrift 3:1.
 *
 * **Die Methode steht damit fest und ist benannt:** WCAG 2.x relative Luminanz auf
 * sRGB, gemessen am gerenderten Element gegen das GEBAUTE Stylesheet (die Fixture
 * schiebt `VITE_HOT_FILE` beiseite, `public/hot` kann hier nicht blenden), mit
 * Alpha-Komposition beider Seiten. Wer auf andere Zahlen kommt, vergleiche zuerst diese
 * drei Punkte.
 *
 * ── Gemessen wird im RUHEZUSTAND, und das ist keine Bequemlichkeit ─────────────────
 *
 * Der erste Lauf dieses Ankers fiel rot: `opacity 0.655` (hell) bzw. `0.732` (dunkel)
 * an der Standlinie. Ursache ist `.page-enter` (`theme.css`, `animation: page-in 0.3s
 * … backwards`) — die Seite blendet ein, und die Messung fiel mitten hinein. Ein
 * Kontrastwert unter laufender Einblendung ist erfunden; der Deckkraft-Riegel des
 * Haus-Helfers hat ihn zu Recht verworfen.
 *
 * Gelöst über `prefers-reduced-motion: reduce` statt über eine Wartezeit: `theme.css`
 * schaltet `.page-enter` in genau diesem Medienzustand ab (`animation: none`). Das ist
 * kein Trick, sondern der richtige Prüfgegenstand — WCAG-Kontrast ist eine Aussage über
 * den ruhenden Zustand, nicht über einen Übergang. Der Deckkraft-Riegel unten bleibt
 * trotzdem stehen: er ist der fail-closed-Nachweis, dass das auch wirklich gegriffen hat.
 *
 * Nicht `desktop-`: die Leiste steht auf jeder Breite, ihr Kontrast ist keine
 * Desktop-Eigenschaft. Sie läuft deshalb im 1279-px-Arm der Bestandssuite.
 */
import { test, expect } from './support/fixtures'
import { useZooid } from './support/zooid'
import { loginNsec } from './support/login'
import { measure, type Extra } from './support/contrast'

const NSEC = process.env.NOSTR_TEST_NSEC as string

/**
 * Die fünf Farbträger der Leiste, namentlich.
 *
 * Vier davon sind der AKTIVE Zustand — er liegt auf der getönten Fläche und ist damit
 * der Fall, den eine naive Rechnung falsch macht. Der fünfte ist eine inaktive Karte
 * als Gegenstück: sie liegt auf `surface-card`, und wenn beide dieselbe Zahl liefern,
 * misst die Sonde die Tönung nicht mit.
 *
 * Die Live-Zeile (`data-ortskarte-live`) steht ABSICHTLICH nicht auf der Liste: sie
 * trägt `opacity: 0`, solange keine Zahl da ist, hat aber weiterhin Client-Rects. Der
 * Deckkraft-Riegel unten würde sie zu Recht verwerfen — sie hier zu führen hieße, einen
 * unsichtbaren Träger zu messen. Ihre Farbe ist dieselbe wie die der statischen Zeile.
 */
const TRAEGER: Extra[] = [
    {
        selector: '[data-ortskarte][aria-current="page"] [data-ortskarte-linie]',
        label: 'Ortskarte: Standlinie (aktiv)',
        kind: 'graphic',
        // FLÄCHE gegen ihren Untergrund — nicht `color`. Ohne `prop` bräche
        // `effectiveBg` an der eigenen deckenden Füllung ab und meldete 1,00:1.
        prop: 'backgroundColor',
    },
    {
        selector: '[data-ortskarte][aria-current="page"] [data-ortskarte-name]',
        label: 'Ortskarte: Ortsname (aktiv)',
        kind: 'text',
    },
    {
        selector: '[data-ortskarte][aria-current="page"] [data-ortskarte-statisch]',
        label: 'Ortskarte: Unterzeile (aktiv)',
        kind: 'text',
    },
    {
        selector: '[data-ortskarte][aria-current="page"] svg',
        label: 'Ortskarte: Icon (aktiv)',
        kind: 'icon',
    },
    {
        selector: '[data-ortskarte]:not([aria-current]) [data-ortskarte-name]',
        label: 'Ortskarte: Ortsname (inaktiv)',
        kind: 'text',
    },
]

/**
 * Die Werte aus dem Docblock von `ortskarten.blade.php` — hier als Assertion, damit der
 * Satz dort wahr ist. Ändert sich ein Ton, wird diese Spec rot und nennt beide Stellen.
 *
 * **Nicht von Hand fortschreiben.** Die Zahlen sind Ausgabe dieser Sonde
 * (`KONTRAST[…]`-Zeile im Testlauf); wer sie anpasst, ohne den neuen Wert dort abzulesen,
 * baut genau die Behauptung zurück, die diese Tabelle ersetzt.
 */
const ERWARTET: Record<'light' | 'dark', Record<string, number>> = {
    light: {
        'Ortskarte: Standlinie (aktiv)': 5.7,
        'Ortskarte: Ortsname (aktiv)': 5.7,
        'Ortskarte: Unterzeile (aktiv)': 6.94,
        'Ortskarte: Icon (aktiv)': 5.7,
        'Ortskarte: Ortsname (inaktiv)': 17.93,
    },
    dark: {
        'Ortskarte: Standlinie (aktiv)': 6.94,
        'Ortskarte: Ortsname (aktiv)': 8.06,
        'Ortskarte: Unterzeile (aktiv)': 6.32,
        'Ortskarte: Icon (aktiv)': 8.06,
        'Ortskarte: Ortsname (inaktiv)': 16.44,
    },
}

for (const theme of ['light', 'dark'] as const) {
    test(`A11y: die Ortskarten-Leiste erfüllt WCAG (${theme})`, async ({ page }) => {
        // Ruhezustand herstellen, BEVOR die Seite lädt — siehe Kopfkommentar.
        await page.emulateMedia({ reducedMotion: 'reduce' })
        await useZooid(page)
        await page.addInitScript((t) => {
            try {
                localStorage.setItem('flux.appearance', t as string)
            } catch {
                /* kein localStorage → Test misst dann das Default-Theme */
            }
        }, theme)
        await loginNsec(page, NSEC)

        await page.goto('/spaces')
        // Auf die AKTIVE Karte warten, nicht auf irgendeine: vier der fünf Träger hängen
        // an ihr. Eine Leiste ohne aktiven Ort läge mit vier `ratio: 0` da.
        await expect(page.locator('[data-ortskarte][aria-current="page"]')).toBeVisible({ timeout: 20_000 })

        // Zweiter Boden neben `reducedMotion`: warten, bis die wirksame Deckkraft der
        // Karte wirklich 1 ist. Eine BEDINGUNG, keine Wartezeit — greift auch, wenn
        // jemand `.page-enter` später anders baut.
        await expect
            .poll(
                () =>
                    page.evaluate(() => {
                        let el: Element | null = document.querySelector('[data-ortskarte][aria-current="page"]')
                        let o = 1
                        while (el) {
                            o *= Number(getComputedStyle(el).opacity)
                            el = el.parentElement
                        }
                        return Math.round(o * 1000) / 1000
                    }),
                { timeout: 10_000, message: 'die Leiste blendet noch ein — jeder Kontrastwert wäre erfunden' },
            )
            .toBe(1)

        const alle = await measure(page, TRAEGER)
        const meine = alle.filter((m) => m.label.startsWith('Ortskarte: '))
        console.log(`KONTRAST[${theme}:ortskarten] ` + JSON.stringify(meine, null, 1))

        // ── Vollständigkeit zuerst: ungemessen sieht aus wie grün ────────────────────
        // `measure` liefert einen nicht getroffenen Selektor als Eintrag mit `ratio: 0`
        // (fail-closed) — aber nur, wenn er überhaupt in der Liste stand. Diese Zeile
        // prüft, dass alle fünf zurückkamen.
        expect(meine.map((m) => m.label).sort()).toEqual(TRAEGER.map((t) => t.label).sort())

        // ── Die Tönung muss sich AUSWIRKEN ───────────────────────────────────────────
        // Aktiver und inaktiver Ortsname liegen auf verschiedenen Flächen und tragen
        // verschiedene Farben. Käme hier dieselbe Zahl heraus, hätte die Sonde entweder
        // die Tönung nicht komponiert oder zweimal dasselbe Element getroffen — genau
        // die Bauform, mit der die erste Messung dieser Werte danebenlag.
        const aktiv = meine.find((m) => m.label === 'Ortskarte: Ortsname (aktiv)')
        const inaktiv = meine.find((m) => m.label === 'Ortskarte: Ortsname (inaktiv)')
        expect(aktiv?.bg, 'aktive und inaktive Karte dürfen nicht denselben Untergrund melden').not.toBe(inaktiv?.bg)
        expect(aktiv?.ratio).not.toBe(inaktiv?.ratio)

        // ── Rollen: die Schwelle muss aus dem Träger kommen, nicht aus dem Wunsch ────
        // Der Ortsname ist 14 px (< 18,66) und damit KEINE Großschrift — 4,5:1. Stünde
        // hier 3, hätte `measure` ihn als Grafik oder als große Schrift eingestuft, und
        // ein echter Verstoß ginge grün durch (die dokumentierte Blindstelle des
        // Bestands-Ankers).
        expect(aktiv?.min, 'der Ortsname muss gegen die TEXT-Schwelle geprüft werden').toBe(4.5)
        expect(meine.find((m) => m.label === 'Ortskarte: Standlinie (aktiv)')?.min).toBe(3)

        for (const m of meine) {
            expect(m.opacity, `[${theme}] ${m.label} unter opacity ${m.opacity} — ${m.ratio}:1 wäre erfunden`).toBe(1)
            expect(
                m.ratio,
                `[${theme}] ${m.label} (${m.kind}) — ${m.fg} auf ${m.bg}, verlangt ${m.min}:1`,
            ).toBeGreaterThanOrEqual(m.min)

            // ── Der WERT, nicht nur die Schwelle ─────────────────────────────────────
            // Die Schwellenprüfung darüber lässt die Standlinie von 5,70 auf 3,91 fallen,
            // ohne rot zu werden — gemessen, nicht vermutet: `bg-brand-800` → `bg-brand-700`
            // ließ diese Spec grün (2 passed), während die Tabelle im Docblock von
            // `ortskarten.blade.php` falsch wurde. Der dortige Satz „die Zahlen sind die
            // Ausgabe eines Tests, der rot wird, wenn sie nicht mehr stimmen" war damit
            // eine Zusage ohne Deckung. Diese Zeile löst sie ein.
            //
            // Warum eine Nachkommastelle: die Werte sind deterministisch aus den Farben —
            // zwei unabhängige Rechnungen (diese Sonde und die analytische aus `theme.css`)
            // stimmten auf zwei Stellen überein. `toBeCloseTo(x, 1)` toleriert ±0,05, also
            // Rundung, und fängt jede Tonänderung, die im Docblock nachzutragen wäre.
            expect(
                m.ratio,
                `[${theme}] ${m.label}: ${m.ratio}:1 statt ${ERWARTET[theme][m.label]}:1 — `
                    + 'die Tabelle im Docblock von ortskarten.blade.php ist damit falsch. '
                    + 'Entweder den Ton zurücknehmen oder beide Stellen nachziehen.',
            ).toBeCloseTo(ERWARTET[theme][m.label], 1)
        }
    })
}
