import { test, expect } from './support/fixtures'
import { useZooid } from './support/zooid'
import { loginNsec } from './support/login'

/**
 * A11y-Anker: misst den TATSÄCHLICH gerenderten Kontrast aller Brand-Textfarben
 * statt ihn nur zu rechnen. Eine Rechnung nimmt einen Hintergrund an; gemessen wird
 * der echte — und der ist hier durchweg schlechter als reines Weiß (gemessen
 * 4,41–5,12:1 statt der gerechneten 5,92:1). Fängt außerdem den Fall, dass eine
 * Utility-Klasse gar nicht greift (JIT-Miss, überschreibende Regel).
 *
 * Der Anlass: `text-brand-600` auf `bg-brand-500/10` stand an elf Stellen im Repo
 * und lag bei 2,73:1 — unter jeder WCAG-Schwelle, auch der für Grafik.
 */
const NSEC = process.env.NOSTR_TEST_NSEC as string

/** WCAG relative Luminanz aus einem `rgb(r, g, b)`-String. */
const LUM = `(css) => {
    const [r, g, b] = css.match(/\\d+(\\.\\d+)?/g).slice(0, 3).map(Number)
    const lin = (v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4) }
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}`

test('A11y: gerenderter Kontrast der Brand-Zähler erfüllt WCAG 1.4.3', async ({ page }) => {
    await useZooid(page)
    await loginNsec(page, NSEC)
    // Warten, bis die Raumliste da ist — sonst ist das Tab-Badge (standardCount() > 0)
    // noch nicht gerendert und die Messung überspringt genau den Ursprungsbefund.
    await expect(page.getByText('Willkommen', { exact: true }).first()).toBeVisible({ timeout: 15_000 })
    // Profil-Popover öffnen: npub-Chip und Signer-Badge leben darin.
    await page.locator('button[aria-haspopup="true"]').first().click()
    await page.waitForTimeout(400)

    const measured = await page.evaluate(
        ([lumSrc]) => {
            const lum = eval(lumSrc) as (css: string) => number
            // Effektive Hintergrundfarbe: den ersten Vorfahren mit nicht-transparentem
            // Hintergrund suchen und die getönte Fläche darüber komponieren.
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
                let [r, g, b] = [255, 255, 255]
                for (const layer of layers.reverse()) {
                    const p = (layer.match(/[\d.]+/g) ?? []).map(Number)
                    const a = p[3] ?? 1
                    r = a * p[0] + (1 - a) * r
                    g = a * p[1] + (1 - a) * g
                    b = a * p[2] + (1 - a) * b
                }
                return `rgb(${r}, ${g}, ${b})`
            }
            const out: Array<{ label: string; fg: string; bg: string; ratio: number }> = []
            for (const el of Array.from(document.querySelectorAll('span, div, button'))) {
                const cs = getComputedStyle(el)
                if (!el.className || typeof el.className !== 'string') continue
                if (!/text-brand-(700|800|900)/.test(el.className)) continue
                if (!(el as HTMLElement).offsetParent) continue
                const fg = cs.color
                const bg = effectiveBg(el)
                const lf = lum(fg)
                const lb = lum(bg)
                const ratio = (Math.max(lf, lb) + 0.05) / (Math.min(lf, lb) + 0.05)
                out.push({ label: (el.textContent ?? '').trim().slice(0, 24), fg, bg, ratio: Math.round(ratio * 100) / 100 })
            }
            return out
        },
        [LUM],
    )

    console.log('KONTRAST ' + JSON.stringify(measured, null, 1))
    expect(measured.length).toBeGreaterThan(0)

    // Zwei Schwellen, weil WCAG zwei Kriterien kennt — und die Farbwahl folgt genau dem:
    //   brand-800 (#98480f) trägt TEXT      → 1.4.3, 4,5:1
    //   brand-700 (#c05c08) trägt ICONS     → 1.4.11 (UI-Komponenten/Grafik), 3:1
    // Eine pauschale 4,5-Schwelle wäre für Icons falsch streng und würde die
    // bewusste Zwei-Stufen-Wahl kaputt-„reparieren".
    const TEXT_FG = new Set(['rgb(152, 72, 15)', 'rgb(123, 61, 16)']) // brand-800, brand-900
    for (const m of measured) {
        const min = TEXT_FG.has(m.fg) ? 4.5 : 3
        expect(m.ratio, `${m.label || '(Icon)'} — ${m.fg} auf ${m.bg}, verlangt ${min}:1`).toBeGreaterThanOrEqual(min)
    }
})
