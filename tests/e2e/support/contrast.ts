import { type Page } from '@playwright/test'

/**
 * Kontrastmessung, extrahiert aus `a11y-contrast.spec.ts` (Phase Teambesprechung
 * 2026-08-06): der `design-lead` fand nach einem ACCEPT einen Kontrast von 1:1 im
 * Emoji-Panel — deterministisch testbar, aber die gesamte Mechanik steckte
 * eingeschlossen in einer einzigen Spec-Datei und war aus keinem anderen Spec
 * aufrufbar. Werkzeuglücke, keine Sorgfaltslücke.
 *
 * Farb-Parser + WCAG-Luminanz, als Quelltext in die Seite gereicht (`eval`, weil
 * `page.evaluate` keine Funktionen serialisiert).
 *
 * **Warum ein eigener Parser und nicht `match(/[\d.]+/g)`:** Chromium serialisiert
 * `getComputedStyle().backgroundColor` NICHT einheitlich. Deckende Farben kommen als
 * `rgb(250, 250, 250)` (Komponenten 0–255), von Tailwind v4 halbtransparent gemischte
 * dagegen als `color(srgb 0.985 0.985 0.985 / 0.9)` (Komponenten 0–1) oder gleich als
 * `oklab(0.752353 0.0765812 0.147612 / 0.1)` — das ist `bg-brand-500/10`, also genau
 * der getönte Chip, dessentwegen dieser Anker überhaupt entstand.
 *
 * Ein Parser, der alles für 0–255-RGB hält, liest `0.985` bzw. `0.752` als „fast
 * schwarz" und komponiert einen frei erfundenen Untergrund. Belegbar an zwei
 * Messungen: die Bottom-Nav im HELLEN Theme kam als `rgb(25.9, 25, 25)` heraus
 * (rechnerisch exakt 0.9·0.985 + 0.1·250) — Ratio 3,99 statt der wahren ~4,3. Alle
 * gebrochenen Komponenten in älteren Protokollen (`rgb(20.77, 20.70, …)`) sind
 * dasselbe Symptom. Der Fehler ist NICHT neu: er steckt seit `0a07ac6` im ursprünglichen
 * Anker (`git show HEAD:tests/e2e/a11y-contrast.spec.ts` vor der Extraktion hierher).
 *
 * Unbekannte Formate (lab, hwb, …) werfen ABSICHTLICH: eine lautlos falsche Zahl ist
 * schlimmer als ein roter Test.
 */
export const COLOR_SRC = `(() => {
    // oklab → sRGB (Björn Ottossons Matrizen + sRGB-Transferfunktion). Nötig, weil
    // Chromium getönte Tailwind-v4-Farben genau so serialisiert.
    const oklabToRgb = (L, A, B) => {
        const l_ = L + 0.3963377774 * A + 0.2158037573 * B
        const m_ = L - 0.1055613458 * A - 0.0638541728 * B
        const s_ = L - 0.0894841775 * A - 1.2914855480 * B
        const l = l_ * l_ * l_, m = m_ * m_ * m_, s = s_ * s_ * s_
        const lin = [
            +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
            -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
            -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
        ]
        return lin.map((c) => {
            const v = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(Math.max(c, 0), 1 / 2.4) - 0.055
            return Math.min(255, Math.max(0, v * 255))
        })
    }
    const parse = (css) => {
        const nums = (css.match(/-?\\d*\\.?\\d+(?:e-?\\d+)?/gi) || []).map(Number)
        if (/^\\s*color\\(\\s*srgb/i.test(css)) {
            return { r: nums[0] * 255, g: nums[1] * 255, b: nums[2] * 255, a: nums[3] === undefined ? 1 : nums[3] }
        }
        if (/^\\s*rgba?\\(/i.test(css)) {
            return { r: nums[0], g: nums[1], b: nums[2], a: nums[3] === undefined ? 1 : nums[3] }
        }
        if (/^\\s*oklab\\(/i.test(css)) {
            const [r, g, b] = oklabToRgb(nums[0], nums[1], nums[2])
            return { r, g, b, a: nums[3] === undefined ? 1 : nums[3] }
        }
        if (/^\\s*oklch\\(/i.test(css)) {
            const h = (nums[2] * Math.PI) / 180
            const [r, g, b] = oklabToRgb(nums[0], nums[1] * Math.cos(h), nums[1] * Math.sin(h))
            return { r, g, b, a: nums[3] === undefined ? 1 : nums[3] }
        }
        if (/^\\s*(transparent|)\\s*$/i.test(css)) {
            return { r: 0, g: 0, b: 0, a: 0 }
        }
        throw new Error('unbekanntes Farbformat, Messung waere geraten: ' + css)
    }
    const lum = (css) => {
        const { r, g, b } = parse(css)
        const lin = (v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4) }
        return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
    }
    return { parse, lum }
})()`

export type Measured = { label: string; kind: 'text' | 'icon' | 'graphic'; fg: string; bg: string; ratio: number; opacity: number }

/**
 * Zusätzlich zu messende Einzelstellen: Farbträger, die sich NICHT über eine
 * Brand-Klasse finden lassen (weil ihre Klasse gerade der Befund ist) oder die auf
 * einer anderen Route leben. `selector` muss genau ein sichtbares Element treffen —
 * trifft er keines, meldet die Messung das als eigenen Eintrag mit `ratio: 0`, statt
 * still nichts zurückzugeben. Ungemessen sähe sonst aus wie grün.
 *
 * `pseudo` misst ein Pseudo-Element statt des Elements selbst (`::placeholder`).
 * Nötig, weil Platzhaltertext eine EIGENE Farbe trägt: im Emoji-Suchfeld stand sie
 * dark auf zinc-600 (1,74:1), während der Eingabetext daneben sauber war.
 *
 * `prop` misst eine andere Farbeigenschaft als `color` — für KANTEN
 * (`borderTopColor`). Die Grenze eines Bedienelements fällt unter 1.4.11 und ist
 * damit ein eigener Prüfgegenstand: sie kann reißen, während Text und Fläche
 * desselben Feldes sauber sind. Absichtlich `borderTopColor` und nicht
 * `borderColor` — die Kurzform liefert vier Werte, sobald sich eine Seite
 * unterscheidet, und daraus wäre keine Zahl mehr zu lesen (an der Flux-Textarea
 * dieser App tritt genau das auf).
 *
 * `prop: 'backgroundColor'` misst eine FLÄCHE gegen ihren Untergrund (z. B. eine
 * Karte gegen die Seite dahinter) — anders als bei Text/Kante ist der Untergrund
 * hier NICHT das Element selbst, sondern sein ELTERN-Element (Teambesprechung
 * 2026-08-12, `design-lead`, vom `reviewer` am Code bestätigt): eine DECKENDE
 * Fläche bricht in `effectiveBg(el)` sofort am ersten Schritt ab (`a === 1`) und
 * liefert die eigene Füllung als „Untergrund" zurück — `fg === bg`, lautlos
 * 1,00:1, unabhängig von der wahren Fläche dahinter. Siehe `measure()` unten.
 */
export type Extra = {
    selector: string
    label: string
    kind: 'text' | 'icon' | 'graphic'
    pseudo?: string
    prop?: 'borderTopColor' | 'backgroundColor'
}

/**
 * Misst alle sichtbaren Brand-Farbträger im aktuellen Theme.
 *
 * Fail-open-Hinweis (aus der Teambesprechung, `security-auditor`-Muster „bestanden
 * statt kann-ich-nicht-messen"): dieser Helfer selbst ist fail-CLOSED, nicht -OPEN.
 * Ein Element, das ein `Extra`-Selektor nicht trifft, taucht als eigener Eintrag mit
 * `ratio: 0` auf (siehe oben) statt zu fehlen — ein Aufrufer, der die erwartete Zahl
 * an Einträgen nicht prüft, kann trotzdem still Löcher lassen. Die Guards dafür
 * gehören in den jeweiligen Test (siehe `a11y-contrast.spec.ts`), nicht hierher: der
 * Helfer kennt die erwartete Oberflächenliste eines Aufrufers nicht.
 */
export const measure = (page: Page, extra: Extra[] = []): Promise<Measured[]> =>
    page.evaluate(
        ([colorSrc, extraJson]) => {
            const extras = JSON.parse(extraJson as string) as {
                selector: string
                label: string
                kind: 'text' | 'icon' | 'graphic'
                pseudo?: string
                prop?: 'borderTopColor' | 'backgroundColor'
            }[]
            const { parse, lum } = eval(colorSrc) as {
                parse: (css: string) => { r: number; g: number; b: number; a: number }
                lum: (css: string) => number
            }
            // Effektive Hintergrundfarbe: bis zum ersten opaken Vorfahren sammeln und
            // die transparenten Schichten darüber komponieren. Ein einzelnes
            // `backgroundColor` reicht nicht — getönte Chips sind halbtransparent.
            const effectiveBg = (from: Element | null): string => {
                let node: Element | null = from
                const layers: string[] = []
                while (node) {
                    const bg = getComputedStyle(node).backgroundColor
                    const { a } = parse(bg)
                    if (a > 0) {
                        layers.push(bg)
                        if (a === 1) break
                    }
                    node = node.parentElement
                }
                // Basis ist die Seitenfarbe des Themes, nicht pauschal Weiß.
                const root = parse(getComputedStyle(document.documentElement).backgroundColor)
                let [r, g, b] = root.a > 0 ? [root.r, root.g, root.b] : [255, 255, 255]
                for (const layer of layers.reverse()) {
                    const p = parse(layer)
                    r = p.a * p.r + (1 - p.a) * r
                    g = p.a * p.g + (1 - p.a) * g
                    b = p.a * p.b + (1 - p.a) * b
                }
                return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`
            }
            /**
             * Vordergrund über seinen eigenen Untergrund komponieren.
             *
             * `getComputedStyle` liefert Farben MIT Alpha, und ein Verhältnis aus dem
             * rohen Wert ist frei erfunden: Flux zeichnet seine Kanten im dunklen Theme
             * als `white/10`. Roh gelesen ist das reines Weiß und ergibt 13,58:1 —
             * tatsächlich komponiert es auf der Feldfläche zu exakt deren Farbe, also
             * 1,00:1. Ohne diese Zeile war der Kanten-Eintrag dieses Ankers im Dunklen
             * NICHT kalibriert: die Gegenprobe (Regel abgeschaltet) blieb grün, obwohl
             * die Kante verschwunden war. Gefunden genau dadurch, dass die Gegenprobe
             * gefahren wurde.
             */
            const compose = (fgCss: string, bgCss: string): string => {
                const f = parse(fgCss)
                if (f.a === 1) {
                    return fgCss
                }
                const b = parse(bgCss)
                return `rgb(${Math.round(f.a * f.r + (1 - f.a) * b.r)}, ${Math.round(f.a * f.g + (1 - f.a) * b.g)}, ${Math.round(f.a * f.b + (1 - f.a) * b.b)})`
            }
            /**
             * Wirksame Deckkraft: Produkt aller `opacity` von hier bis zur Wurzel.
             * `opacity` steht NICHT in `color` — ein Element mit `opacity-70` meldet
             * seine volle Textfarbe, und ein daraus gerechnetes Verhältnis wäre zu
             * gut. Der Wert wird mitgeführt, damit ein solcher Fall auffliegt statt
             * still eine zu schöne Zahl zu liefern (siehe Guard im Test).
             */
            const effectiveOpacity = (from: Element | null): number => {
                let o = 1
                let node: Element | null = from
                while (node) {
                    o *= Number(getComputedStyle(node).opacity)
                    node = node.parentElement
                }
                return Math.round(o * 1000) / 1000
            }
            const out: Measured[] = []
            for (const el of Array.from(document.querySelectorAll('span, div, button'))) {
                if (!el.className || typeof el.className !== 'string') continue
                if (!/text-brand-(700|800|900)/.test(el.className)) continue
                if (!(el as HTMLElement).offsetParent) continue
                const fg = getComputedStyle(el).color
                const bg = effectiveBg(el)
                const fgc = compose(fg, bg)
                const lf = lum(fgc)
                const lb = lum(bg)
                const ratio = (Math.max(lf, lb) + 0.05) / (Math.min(lf, lb) + 0.05)
                out.push({
                    label: (el.textContent ?? '').trim().slice(0, 24),
                    kind: /text-brand-700/.test(el.className) ? 'icon' : 'text',
                    fg: fgc,
                    bg,
                    ratio: Math.round(ratio * 100) / 100,
                    opacity: effectiveOpacity(el),
                })
            }
            // Informationstragende FLÄCHEN (1.4.11): Ungelesen-Punkt + Nav-Indikator.
            // Beide tragen `bg-brand-700` im Klassennamen (dark: brand-400 bzw. accent) —
            // im Gegensatz zu den Text-Trägern oben ist hier die HINTERGRUNDFARBE des
            // Elements der Vordergrund, und der Untergrund kommt vom ELTERN-Element.
            for (const el of Array.from(document.querySelectorAll('span'))) {
                if (!el.className || typeof el.className !== 'string') continue
                if (!/(^|\s)bg-brand-700(\s|$)/.test(el.className)) continue
                if (!(el as HTMLElement).offsetParent) continue
                const fg = getComputedStyle(el).backgroundColor
                const bg = effectiveBg(el.parentElement)
                const fgc = compose(fg, bg)
                const lf = lum(fgc)
                const lb = lum(bg)
                const ratio = (Math.max(lf, lb) + 0.05) / (Math.min(lf, lb) + 0.05)
                out.push({
                    // Beschriftung aus der Rolle, nicht aus Text (alle sind aria-hidden):
                    // `size-2 rounded-full` ist der Ungelesen-Punkt, `inset-x-1` der
                    // Aktiv-Unterstrich der Emoji-Kategorien, alles übrige der Nav-Indikator.
                    label: /(^|\s)size-2(\s|$)/.test(el.className)
                        ? 'Ungelesen-Punkt'
                        : /(^|\s)inset-x-1(\s|$)/.test(el.className)
                          ? 'Emoji-Kategorie aktiv (Unterstrich)'
                          : 'Nav-Indikator',
                    kind: 'graphic',
                    fg: fgc,
                    bg,
                    ratio: Math.round(ratio * 100) / 100,
                    opacity: effectiveOpacity(el),
                })
            }
            // P6 — die Zähler-Pillen (`unread-badge`). Anders als oben ist hier die
            // ZIFFER der Vordergrund und die eigene deckende Fläche der Untergrund;
            // `effectiveBg(el)` bricht am ersten opaken Layer ab, das ist die Pille
            // selbst. Genau deshalb ist der Wert theme-unabhängig — und genau deshalb
            // wird er trotzdem in BEIDEN Themes gemessen: „ist unabhängig" ist eine
            // Behauptung über gerenderte Farben, keine über den Klassennamen.
            for (const el of Array.from(document.querySelectorAll('span'))) {
                if (!el.className || typeof el.className !== 'string') continue
                if (!/(^|\s)bg-brand-500(\s|$)/.test(el.className)) continue
                if (!/(^|\s)text-zinc-950(\s|$)/.test(el.className)) continue
                if (!(el as HTMLElement).offsetParent) continue
                const fg = getComputedStyle(el).color
                const bg = effectiveBg(el)
                const fgc = compose(fg, bg)
                const lf = lum(fgc)
                const lb = lum(bg)
                const ratio = (Math.max(lf, lb) + 0.05) / (Math.min(lf, lb) + 0.05)
                out.push({
                    // Rolle aus der Geometrie-Klasse: die Glocke trägt die kleine
                    // 9+-Variante (`h-4`), das Tab-Badge den Abstand zum Label
                    // (`ms-1.5`), alles übrige ist die Zeilen-Pille.
                    label: /(^|\s)h-4(\s|$)/.test(el.className)
                        ? 'Zähler-Pille Glocke'
                        : /(^|\s)ms-1\.5(\s|$)/.test(el.className)
                          ? 'Zähler-Pille Tab'
                          : 'Zähler-Pille Zeile',
                    kind: 'text',
                    fg: fgc,
                    bg,
                    ratio: Math.round(ratio * 100) / 100,
                    opacity: effectiveOpacity(el),
                })
            }
            // Einzelstellen (siehe {@link Extra}) — bewusst über einen expliziten
            // Selektor statt über die Farbklasse: der Ungelesen-Divider im Raum wird
            // gerade WEGEN seiner Farbklasse geprüft, ein Fund über `text-brand-800`
            // fände ihn erst nach dem Fix und der Ausgangswert bliebe ungemessen.
            for (const spec of extras) {
                const el = document.querySelector(spec.selector) as HTMLElement | null
                if (!el || !el.offsetParent) {
                    out.push({ label: `${spec.label} (NICHT GEFUNDEN)`, kind: spec.kind, fg: '-', bg: '-', ratio: 0, opacity: 1 })
                    continue
                }
                // `pseudo` (z.B. '::placeholder') hat eine eigene Farbe, aber denselben
                // Untergrund wie sein Element — `effectiveBg` bleibt deshalb unverändert.
                // Bei einer KANTE ist der so ermittelte Untergrund die Fläche IM Feld;
                // das ist die strengere der beiden Nachbarfarben (außen liegt die
                // hellere Karte), also die richtige Prüfung.
                //
                // Bei einer FLÄCHE (`backgroundColor`) ist das FALSCH: das Element ist
                // hier der Vordergrund selbst, `effectiveBg(el)` bräche bei einer
                // deckenden Füllung sofort am Element ab und läse dessen eigene Farbe
                // als Untergrund — `fg === bg`, lautlos 1,00:1. Der Untergrund einer
                // Fläche ist das, was DAHINTER liegt: das ELTERN-Element (siehe die
                // „Informationstragende FLÄCHEN"-Schleife oben, die das für ihre beiden
                // Sonderfälle schon richtig macht — hier gilt dieselbe Regel generisch).
                const stil = getComputedStyle(el, spec.pseudo ?? null)
                const fg = spec.prop ? stil[spec.prop] : stil.color
                const bg = spec.prop === 'backgroundColor' ? effectiveBg(el.parentElement) : effectiveBg(el)
                const fgc = compose(fg, bg)
                const lf = lum(fgc)
                const lb = lum(bg)
                const ratio = (Math.max(lf, lb) + 0.05) / (Math.min(lf, lb) + 0.05)
                out.push({
                    label: spec.label,
                    kind: spec.kind,
                    fg: fgc,
                    bg,
                    ratio: Math.round(ratio * 100) / 100,
                    opacity: effectiveOpacity(el),
                })
            }
            return out
        },
        [COLOR_SRC, JSON.stringify(extra)],
    ) as Promise<Measured[]>
