import { test, expect, type Page } from './support/fixtures'
import { useZooid } from './support/zooid'
import { loginNsec } from './support/login'

/**
 * A11y-Anker: misst den TATSÄCHLICH gerenderten Kontrast aller Brand-Textfarben
 * statt ihn nur zu rechnen — in BEIDEN Themes.
 *
 * Warum messen und nicht rechnen: eine Rechnung muss den Hintergrund annehmen, und
 * die Annahme „reines Weiß" war hier durchweg falsch. Getönte Chips sitzen auf
 * Karten, Popovers und dem grauen Segmented-Control von `flux:tabs`. Gemessen lag
 * das Tab-Badge mit `brand-800` bei 4,41:1, gerechnet hatte ich 5,92:1 — erst die
 * Messung fand das. Nebenbei fängt der Test den Fall, dass eine Utility-Klasse gar
 * nicht greift (JIT-Miss, überschreibende Regel).
 *
 * Der Anlass: `text-brand-600` auf `bg-brand-500/10` stand an elf Stellen im Repo
 * und lag bei 2,73:1 — unter jeder WCAG-Schwelle, auch der für Grafik.
 *
 * Zwei Schwellen, weil WCAG zwei Kriterien kennt — die Farbwahl folgt genau dem:
 *   Text   → 1.4.3,  4,5:1 → brand-800, auf grauem Grund brand-900 (dark: brand-400)
 *   Icons  → 1.4.11, 3:1   → brand-700                            (dark: brand-400)
 * Klassifiziert wird über die KLASSE, nicht über die gerenderte Farbe: im Dark-Mode
 * tragen Text und Icon dieselbe Farbe (brand-400), die Absicht steht aber weiter im
 * Klassennamen.
 */
const NSEC = process.env.NOSTR_TEST_NSEC as string

/** WCAG relative Luminanz aus einem `rgb(r, g, b)`-String. */
const LUM = `(css) => {
    const [r, g, b] = css.match(/\\d+(\\.\\d+)?/g).slice(0, 3).map(Number)
    const lin = (v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4) }
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}`

type Measured = { label: string; kind: 'text' | 'icon'; fg: string; bg: string; ratio: number }

/** Misst alle sichtbaren Brand-Farbträger im aktuellen Theme. */
const measure = (page: Page): Promise<Measured[]> =>
    page.evaluate(
        ([lumSrc]) => {
            const lum = eval(lumSrc) as (css: string) => number
            // Effektive Hintergrundfarbe: bis zum ersten opaken Vorfahren sammeln und
            // die transparenten Schichten darüber komponieren. Ein einzelnes
            // `backgroundColor` reicht nicht — getönte Chips sind halbtransparent.
            const effectiveBg = (el: Element): string => {
                let node: Element | null = el
                const layers: string[] = []
                while (node) {
                    const bg = getComputedStyle(node).backgroundColor
                    const a = Number(bg.match(/[\d.]+/g)?.[3] ?? '1')
                    if (a > 0) {
                        layers.push(bg)
                        if (a === 1) break
                    }
                    node = node.parentElement
                }
                // Basis ist die Seitenfarbe des Themes, nicht pauschal Weiß.
                const rootBg = getComputedStyle(document.documentElement).backgroundColor
                const rootP = (rootBg.match(/[\d.]+/g) ?? []).map(Number)
                let [r, g, b] = (rootP[3] ?? 1) > 0 && rootP.length >= 3 ? [rootP[0], rootP[1], rootP[2]] : [255, 255, 255]
                for (const layer of layers.reverse()) {
                    const p = (layer.match(/[\d.]+/g) ?? []).map(Number)
                    const a = p[3] ?? 1
                    r = a * p[0] + (1 - a) * r
                    g = a * p[1] + (1 - a) * g
                    b = a * p[2] + (1 - a) * b
                }
                return `rgb(${r}, ${g}, ${b})`
            }
            const out: Measured[] = []
            for (const el of Array.from(document.querySelectorAll('span, div, button'))) {
                if (!el.className || typeof el.className !== 'string') continue
                if (!/text-brand-(700|800|900)/.test(el.className)) continue
                if (!(el as HTMLElement).offsetParent) continue
                const fg = getComputedStyle(el).color
                const bg = effectiveBg(el)
                const lf = lum(fg)
                const lb = lum(bg)
                const ratio = (Math.max(lf, lb) + 0.05) / (Math.min(lf, lb) + 0.05)
                out.push({
                    label: (el.textContent ?? '').trim().slice(0, 24),
                    kind: /text-brand-700/.test(el.className) ? 'icon' : 'text',
                    fg,
                    bg,
                    ratio: Math.round(ratio * 100) / 100,
                })
            }
            return out
        },
        [LUM],
    ) as Promise<Measured[]>

/** Bringt die Seite in den Zustand, in dem alle Brand-Farbträger gerendert sind. */
async function openMeasurableSurfaces(page: Page): Promise<void> {
    // Ohne geladene Raumliste ist das Tab-Badge (standardCount() > 0) nicht da —
    // die Messung ginge am Ursprungsbefund vorbei.
    await expect(page.getByText('Willkommen', { exact: true }).first()).toBeVisible({ timeout: 15_000 })
    // npub-Chip und Signer-Badge leben im Profil-Popover.
    await page.locator('button[aria-haspopup="true"]').first().click()
    await page.waitForTimeout(400)
}

for (const theme of ['light', 'dark'] as const) {
    test(`A11y: gerenderter Kontrast der Brand-Farben erfüllt WCAG (${theme})`, async ({ page }) => {
        await useZooid(page)
        // Theme VOR dem Login setzen, damit die erste Seite schon richtig rendert.
        await page.addInitScript((t) => {
            try {
                localStorage.setItem('flux.appearance', t as string)
            } catch {
                /* kein localStorage → Test misst dann das Default-Theme */
            }
        }, theme)
        await loginNsec(page, NSEC)
        if (theme === 'dark') {
            await expect(page.locator('html')).toHaveClass(/dark/, { timeout: 15_000 })
        } else {
            await expect(page.locator('html')).not.toHaveClass(/dark/, { timeout: 15_000 })
        }
        await openMeasurableSurfaces(page)

        const measured = await measure(page)
        console.log(`KONTRAST[${theme}] ` + JSON.stringify(measured, null, 1))

        // Gegenprobe gegen einen leeren Lauf: misst der Test überhaupt etwas?
        expect(measured.length, 'keine Brand-Farbträger gefunden — Messung wertlos').toBeGreaterThan(0)
        expect(measured.some((m) => m.kind === 'text'), 'kein Text-Träger gemessen').toBe(true)

        for (const m of measured) {
            const min = m.kind === 'text' ? 4.5 : 3
            expect(
                m.ratio,
                `[${theme}] ${m.label || '(Icon)'} — ${m.fg} auf ${m.bg}, verlangt ${min}:1`,
            ).toBeGreaterThanOrEqual(min)
        }
    })
}
