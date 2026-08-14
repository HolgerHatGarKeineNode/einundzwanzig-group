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

/**
 * `min` ist die Schwelle, die DIESER Träger erfüllen muss — sie wird dort bestimmt,
 * wo das Wissen liegt (am gerenderten Knoten), nicht im Aufrufer. Vorher rechnete der
 * Test sie aus `kind` (`kind === 'text' ? 4.5 : 3`) und konnte die Großschrift-Regel
 * aus 1.4.3 (ab 18,66 px fett bzw. 24 px genügen 3:1) gar nicht kennen: die hängt an
 * `font-size`/`font-weight` des Knotens, den nur die Messung sieht.
 */
export type Measured = { label: string; kind: 'text' | 'icon' | 'graphic'; fg: string; bg: string; ratio: number; opacity: number; min: number }

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
            /**
             * Klassenliste eines Knotens — als STRING, für HTML wie SVG.
             *
             * `el.className` ist bei einem `<svg>` KEIN String, sondern ein
             * `SVGAnimatedString`. Die alte Zeile `typeof el.className !== 'string'`
             * warf jedes SVG lautlos weg — und `flux:icon.*` rendert genau das.
             */
            const klassen = (el: Element): string => el.getAttribute('class') ?? ''
            /**
             * Sichtbar = tatsächlich auf dem Schirm. NICHT über `offsetParent`:
             * (a) SVG-Elemente haben die Eigenschaft gar nicht (`undefined` → wäre
             * immer „unsichtbar"), (b) `position: fixed` liefert `null`, obwohl das
             * Element steht. `getClientRects()` beantwortet beides richtig und gilt
             * für HTML wie SVG.
             */
            const sichtbar = (el: Element): boolean => el.getClientRects().length > 0
            /**
             * Große Schrift im Sinne von WCAG 1.4.3: ab 18,66 px FETT bzw. ab 24 px
             * genügen 3:1 statt 4,5:1. Wer stur 4,5 fordert, färbt legitime
             * Überschriften rot — und wer die Regel auf einen gemischten Träger
             * anwendet, dessen Label 11 px hat, färbt einen echten Verstoß grün.
             * Deshalb wird sie pro TEXT-HALTENDEM Knoten ausgewertet, nicht am
             * Farbträger (siehe `schwelle` unten).
             */
            const grosseSchrift = (el: Element): boolean => {
                const s = getComputedStyle(el)
                const px = parseFloat(s.fontSize)
                const w = s.fontWeight === 'bold' ? 700 : s.fontWeight === 'normal' ? 400 : Number(s.fontWeight) || 400
                return px >= 24 || (px >= 18.66 && w >= 700)
            }
            /**
             * **Der Kern der Einstufung: was MALT diese Farbe eigentlich?**
             *
             * Vorher hing sie am Klassennamen (`/text-brand-700/ ? 'icon' : 'text'`).
             * Das war die Blindstelle dieses Ankers: jeder `text-brand-700`-Träger galt
             * als Icon und wurde gegen 3:1 geprüft — ein Textträger mit 4,40:1 ging
             * damit grün durch, obwohl 1.4.3 4,5:1 verlangt. Die Umkehrung wäre genauso
             * falsch gewesen: sechs Träger im Repo sind echte Grafik (Icon-Spans,
             * Emoji-Knopf, Häkchen) und tragen mit gemessenen 3,82–4,40 gegen ihre
             * 3:1 zu Recht.
             *
             * Also gefragt, was das Element TRÄGT: gesammelt werden alle sichtbaren
             * Textknoten im Teilbaum, die von DIESER Farbe gemalt werden.
             *   · Ein Kind mit eigener `color` malt nicht mehr unsere → abgeschnitten.
             *   · `<svg>` trägt keinen Text → übersprungen (sonst zählte ein
             *     `<title>`/`<desc>` als Beschriftung).
             *   · `display:none`/`visibility:hidden`/`sr-only` sind unsichtbar; ein
             *     Screenreader-Text macht aus einem Icon keinen Textträger.
             *
             * Damit ist die Einstufung THEME-STABIL — genau die Eigenschaft, wegen der
             * hier ursprünglich der Klassenname stand: im Dunklen tragen Text und Icon
             * dieselbe Farbe (brand-400), aber der Inhalt bleibt derselbe.
             *
             * Verschachtelung ist der Grund für die Rekursion: ein Wrapper mit
             * `text-brand-*`, der nur ein Icon-Kind enthält, das SEINERSEITS Text hat
             * (`meetup-tile:76`: Kalender-Icon + Datum), ist ein Textträger — mit
             * `el.childNodes` allein wäre er als Grafik durchgegangen.
             */
            const gemalteTexte = (root: Element): Element[] => {
                const farbe = getComputedStyle(root).color
                const treffer: Element[] = []
                const lauf = (node: Element): void => {
                    for (const k of Array.from(node.childNodes)) {
                        if (k.nodeType === 3 && (k.textContent ?? '').trim()) {
                            treffer.push(node)
                            break
                        }
                    }
                    for (const k of Array.from(node.children)) {
                        if (k instanceof SVGElement) continue
                        const s = getComputedStyle(k)
                        if (s.display === 'none' || s.visibility === 'hidden') continue
                        if (klassen(k).split(/\s+/).includes('sr-only')) continue
                        if (s.color !== farbe) continue
                        lauf(k)
                    }
                }
                lauf(root)
                return treffer
            }
            /**
             * Schwelle aus der Rolle: Grafik/Icon → 1.4.11 (3:1). Text → 1.4.3 (4,5:1),
             * es sei denn JEDER gemalte Textknoten ist große Schrift (dann 3:1). Die
             * strengere Anforderung gewinnt — bei einem gemischten Träger wie `nav-tab`
             * (Icon + 11-px-Label an EINER Klasse) gibt das kleine Label die Schwelle
             * vor, nicht das Icon daneben.
             */
            const schwelle = (kind: string, texte: Element[]): number =>
                kind !== 'text' ? 3 : texte.length > 0 && texte.every(grosseSchrift) ? 3 : 4.5
            /**
             * Beschriftung eines Trägers OHNE eigenen Text. Vorher stand hier ein
             * LEERES Label (`textContent` eines Icon-Spans ist ''), und die
             * Fehlermeldung des Tests las sich als „(Icon) — verlangt 3:1": aus sechs
             * Grafik-Trägern im Repo wurde damit ein unauffindbarer. Also Tag +
             * Geometrie + Farbklasse, und dazu der Text der Zeile, in der er steckt —
             * das ist die Angabe, mit der man ihn im Markup wiederfindet.
             */
            const kurzname = (el: Element): string => {
                const cls = klassen(el).split(/\s+/).filter(Boolean)
                const marke = cls.find((c) => /^!?text-brand-/.test(c)) ?? ''
                const geo = cls.filter((c) => /^(size|h|w|inset)-/.test(c)).slice(0, 2).join(' ')
                let n: Element | null = el.parentElement
                let umfeld = ''
                while (n && !umfeld) {
                    umfeld = (n.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 20)
                    n = n.parentElement
                }
                return `(nur Grafik) <${el.tagName.toLowerCase()}${geo ? ' ' + geo : ''} ${marke}>${umfeld ? ` in „${umfeld}"` : ''}`
            }
            /**
             * Beschriftung eines TEXT-Trägers aus den Knoten, die seine Farbe wirklich
             * malt — nicht aus `el.textContent`. Der schleppt Zeilenumbrüche und
             * `sr-only`-Text mit: der aktive `nav-tab` las sich als „Chat\n \n , "
             * statt „Chat".
             */
            const beschriftung = (texte: Element[]): string =>
                texte
                    .map((n) =>
                        Array.from(n.childNodes)
                            .filter((k) => k.nodeType === 3)
                            .map((k) => k.textContent ?? '')
                            .join(''),
                    )
                    .join(' ')
                    .replace(/\s+/g, ' ')
                    .trim()
                    .slice(0, 24)
            const out: Measured[] = []
            /**
             * **Kein Tag-Whitelist mehr.** Hier stand `querySelectorAll('span, div, button')` —
             * eine aufgezählte Liste, die `flux:text` (rendert `<p>`), den aktiven
             * `nav-tab` (`<a>`) und jedes `flux:icon` (`<svg>`) nie besucht hat. Eine
             * LÄNGERE Liste wäre derselbe Fehler mit größerer Zahl; gefragt ist der
             * Träger der Farbklasse, nicht sein Tag. `[class*="text-brand-"]` filtert im
             * Selektor-Engine, gilt für HTML wie SVG und kann keinen Typ übersehen.
             */
            for (const el of Array.from(document.querySelectorAll('[class*="text-brand-"]'))) {
                const cls = klassen(el)
                if (!/text-brand-(700|800|900)/.test(cls)) continue
                if (!sichtbar(el)) continue
                const fg = getComputedStyle(el).color
                const bg = effectiveBg(el)
                const fgc = compose(fg, bg)
                const lf = lum(fgc)
                const lb = lum(bg)
                const ratio = (Math.max(lf, lb) + 0.05) / (Math.min(lf, lb) + 0.05)
                const texte = gemalteTexte(el)
                const kind = texte.length > 0 ? 'text' : 'icon'
                out.push({
                    label: texte.length > 0 ? beschriftung(texte) : kurzname(el),
                    kind,
                    fg: fgc,
                    bg,
                    ratio: Math.round(ratio * 100) / 100,
                    opacity: effectiveOpacity(el),
                    min: schwelle(kind, texte),
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
                    min: 3,
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
                    // Die ZIFFER ist Text (1.4.3). Die Schwelle trotzdem aus der
                    // Schrift ableiten statt sie auf 4,5 festzunageln: würde die Pille
                    // je auf große Schrift umgestellt, gälte 3:1 — und ein hart
                    // verdrahtetes 4,5 wäre dann ein Falsch-Positiv.
                    min: schwelle('text', gemalteTexte(el)),
                })
            }
            // Einzelstellen (siehe {@link Extra}) — bewusst über einen expliziten
            // Selektor statt über die Farbklasse: der Ungelesen-Divider im Raum wird
            // gerade WEGEN seiner Farbklasse geprüft, ein Fund über `text-brand-800`
            // fände ihn erst nach dem Fix und der Ausgangswert bliebe ungemessen.
            for (const spec of extras) {
                const el = document.querySelector(spec.selector) as HTMLElement | null
                if (!el || !sichtbar(el)) {
                    out.push({
                        label: `${spec.label} (NICHT GEFUNDEN)`,
                        kind: spec.kind,
                        fg: '-',
                        bg: '-',
                        ratio: 0,
                        opacity: 1,
                        min: spec.kind === 'text' ? 4.5 : 3,
                    })
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
                    // `kind` bleibt bei den Einzelstellen die ANSAGE des Aufrufers —
                    // sie existieren gerade, weil ihre Rolle nicht am Knoten ablesbar
                    // ist (Kante, Platzhalter, Fläche). Nur die Großschrift-Absenkung
                    // kommt aus dem Baum; bei `pseudo` ist `gemalteTexte` leer und es
                    // bleibt bei den strengen 4,5:1.
                    min: schwelle(spec.kind, spec.pseudo ? [] : gemalteTexte(el)),
                })
            }
            return out
        },
        [COLOR_SRC, JSON.stringify(extra)],
    ) as Promise<Measured[]>
