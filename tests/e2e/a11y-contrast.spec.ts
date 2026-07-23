import { test, expect, type Page } from './support/fixtures'
import { execFileSync } from 'node:child_process'
import { useZooid, ZOOID_WS } from './support/zooid'
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
 * Historie zu den Tab-Zählern: sie trugen `text-brand-900 dark:text-brand-300` auf
 * `bg-brand-500/10` und lagen dark bei 3,68:1 (vor dem P3-Fix auf brand-300), weil
 * sie NICHT auf zinc-950 sitzen, sondern auf dem aktiven Segment von `flux:tabs`
 * (weiß@10 % + weiß@20 % über zinc-950 = `rgb(78,78,78)`, mit Tint `rgb(95,85,73)`).
 * Seit P6 ist der Fall dort verschwunden: das Tab-Badge zeigt Ungelesenes als
 * DECKENDE Pille (`bg-brand-500` + `text-zinc-950`) — eine deckende Fläche kann den
 * Untergrund nicht mehr sehen, der Segment-Zustand fällt als Variable weg. Der
 * getönte Fall lebt weiter im Avatar-Fallback (`nostr-avatar`) und wird hier
 * weiterhin gemessen.
 *
 * Zwei Schwellen, weil WCAG zwei Kriterien kennt — die Farbwahl folgt genau dem:
 *   Text   → 1.4.3,  4,5:1 → brand-800, auf grauem Grund brand-900 (dark: brand-400)
 *   Icons  → 1.4.11, 3:1   → brand-700                            (dark: brand-400)
 * Klassifiziert wird über die KLASSE, nicht über die gerenderte Farbe: im Dark-Mode
 * tragen Text und Icon dieselbe Farbe (brand-400), die Absicht steht aber weiter im
 * Klassennamen.
 *
 * Seit P3 kommt eine dritte Sorte dazu: FLÄCHEN, die selbst Information tragen
 * (`kind: 'graphic'`) — der Ungelesen-Punkt und der Aktiv-Indikator der Nav. Bei
 * ihnen ist die Farbe der VORDERGRUND (`background-color` des Elements), gemessen
 * gegen den Untergrund des ELTERN-Elements; sie fallen unter 1.4.11 (≥ 3:1), weil
 * sie kein Text sind. Der Autor des Punktes hat für seine Werte ausdrücklich
 * „gerechnet, nicht gemessen" notiert — hier stehen die gemessenen.
 *
 * Seit P6 messen wir zusätzlich die ZÄHLER-PILLEN (`unread-badge`): Ziffer
 * `text-zinc-950` auf deckendem `bg-brand-500`. Sie sind TEXT (1.4.3, 4,5:1) — die
 * Pillenfläche selbst liegt gegen Weiß bei ~2,3:1 und wäre als Grafikobjekt
 * unzulässig; deshalb trägt die Ziffer die Bedeutung und nicht die Form. Gemessen
 * werden alle drei Auftritte getrennt (Zeile · Tab · Glocke), damit ein Ausbleiben
 * an EINEM Ort nicht als „geprüft" durchgeht — an genau dieser Stelle scheitert der
 * naive Anker: er misst, was gerendert ist, und ungerendert sieht aus wie grün.
 */
const NSEC = process.env.NOSTR_TEST_NSEC as string
const NAK = '/home/user/go/bin/nak'
const ADMIN = 'b2ee09a54bedf17ee1db562bdddd75c48661d981eb52c49dc206c55ba8439414'

/**
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
 * dasselbe Symptom. Der Fehler ist NICHT neu: er steckt seit `0a07ac6` in diesem
 * Anker (`git show HEAD:tests/e2e/a11y-contrast.spec.ts`).
 *
 * Unbekannte Formate (lab, hwb, …) werfen ABSICHTLICH: eine lautlos falsche Zahl ist
 * schlimmer als ein roter Test.
 */
const COLOR_SRC = `(() => {
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

type Measured = { label: string; kind: 'text' | 'icon' | 'graphic'; fg: string; bg: string; ratio: number }

/**
 * Zusätzlich zu messende Einzelstellen: Farbträger, die sich NICHT über eine
 * Brand-Klasse finden lassen (weil ihre Klasse gerade der Befund ist) oder die auf
 * einer anderen Route leben. `selector` muss genau ein sichtbares Element treffen —
 * trifft er keines, meldet die Messung das als eigenen Eintrag mit `ratio: 0`, statt
 * still nichts zurückzugeben. Ungemessen sähe sonst aus wie grün.
 */
type Extra = { selector: string; label: string; kind: 'text' | 'icon' | 'graphic' }

/** Misst alle sichtbaren Brand-Farbträger im aktuellen Theme. */
const measure = (page: Page, extra: Extra[] = []): Promise<Measured[]> =>
    page.evaluate(
        ([colorSrc, extraJson]) => {
            const extras = JSON.parse(extraJson as string) as {
                selector: string
                label: string
                kind: 'text' | 'icon' | 'graphic'
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
                const lf = lum(fg)
                const lb = lum(bg)
                const ratio = (Math.max(lf, lb) + 0.05) / (Math.min(lf, lb) + 0.05)
                out.push({
                    // Beschriftung aus der Rolle, nicht aus Text (beide sind aria-hidden):
                    // `size-2 rounded-full` ist der Ungelesen-Punkt, `nav-pill` der Indikator.
                    label: /(^|\s)size-2(\s|$)/.test(el.className) ? 'Ungelesen-Punkt' : 'Nav-Indikator',
                    kind: 'graphic',
                    fg,
                    bg,
                    ratio: Math.round(ratio * 100) / 100,
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
                const lf = lum(fg)
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
                    fg,
                    bg,
                    ratio: Math.round(ratio * 100) / 100,
                })
            }
            // Einzelstellen (siehe {@link Extra}) — bewusst über einen expliziten
            // Selektor statt über die Farbklasse: der Ungelesen-Divider im Raum wird
            // gerade WEGEN seiner Farbklasse geprüft, ein Fund über `text-brand-800`
            // fände ihn erst nach dem Fix und der Ausgangswert bliebe ungemessen.
            for (const spec of extras) {
                const el = document.querySelector(spec.selector) as HTMLElement | null
                if (!el || !el.offsetParent) {
                    out.push({ label: `${spec.label} (NICHT GEFUNDEN)`, kind: spec.kind, fg: '-', bg: '-', ratio: 0 })
                    continue
                }
                const fg = getComputedStyle(el).color
                const bg = effectiveBg(el)
                const lf = lum(fg)
                const lb = lum(bg)
                const ratio = (Math.max(lf, lb) + 0.05) / (Math.min(lf, lb) + 0.05)
                out.push({ label: spec.label, kind: spec.kind, fg, bg, ratio: Math.round(ratio * 100) / 100 })
            }
            return out
        },
        [COLOR_SRC, JSON.stringify(extra)],
    ) as Promise<Measured[]>

/**
 * Bringt die Seite in den Zustand, in dem alle Brand-Farbträger gerendert sind.
 *
 * Zwei Phasen, weil sich die Oberflächen gegenseitig ausschließen: die Standard-
 * Raumliste und der Meetup-Fokus sind nie gleichzeitig sichtbar. Was nicht gerendert
 * ist, wird nicht gemessen — und ungemessen heißt hier ungeprüft, nicht in Ordnung.
 */
async function measureAllSurfaces(page: Page): Promise<Measured[]> {
    // Phase 1 — Standardansicht. Ohne geladene Raumliste ist das Tab-Badge
    // (standardCount() > 0) nicht da, und die Messung ginge am Ursprungsbefund vorbei.
    await expect(page.getByText('Willkommen', { exact: true }).first()).toBeVisible({ timeout: 15_000 })
    // npub-Chip und Signer-Badge leben im Profil-Popover.
    const profile = page.locator('button[aria-haspopup="true"]').first()
    await profile.click()
    await page.waitForTimeout(400)
    const phase1 = await measure(page)
    await page.keyboard.press('Escape')

    // Phase 1b — dieselbe Raum-Zeile MIT Hover. Die Kachel wechselt auf
    // `hover:bg-zinc-100`/`dark:hover:bg-zinc-800`. Für die deckende Zähler-Pille
    // (seit P6, vorher stand hier der Punkt) darf das rechnerisch nichts ändern —
    // gemessen wird es trotzdem: „die Fläche ist deckend" ist eine Behauptung über
    // gerendertes CSS, und genau solche Behauptungen sind hier schon dreimal zu
    // optimistisch gewesen. Ungemessen hieße ungeprüft.
    const tile = page.getByRole('button', { name: /Punktprobe/ })
    if (await tile.isVisible().catch(() => false)) {
        await tile.hover()
        await page.waitForTimeout(300)
        phase1.push(
            ...(await measure(page))
                .filter((m) => m.kind === 'graphic' || m.label.startsWith('Zähler-Pille'))
                .map((m) => ({ ...m, label: `${m.label} (hover)` })),
        )
    }

    // Phase 2 — Meetup-Fokus + Land-Popover. Das check-Icon der Länder-Auswahl
    // (text-brand-700) existiert NUR im geöffneten Popover; ohne diese Phase bliebe
    // die Icon-Schwelle an genau einer der beiden Icon-Stellen ungeprüft.
    const discover = page.getByRole('button', { name: /Meetup-Räume entdecken/ })
    if (!(await discover.isVisible().catch(() => false))) {
        return phase1
    }
    await discover.click()
    const country = page.getByRole('button', { name: 'Land' })
    if (!(await country.isVisible().catch(() => false))) {
        return phase1
    }
    await country.click()
    await page.waitForTimeout(400)
    return [...phase1, ...(await measure(page))]
}

/**
 * Phase 3 — der Ungelesen-Divider IM RAUM (§4.1 Nr. 7 / §4.5).
 *
 * Er lebt nicht auf `/spaces`, also misst ihn keine der beiden Phasen oben. Genau
 * deshalb ist er in diesem Projekt jahrelang ungeprüft geblieben, obwohl er dieselbe
 * 1.4.3-Schwelle trägt wie jeder andere Text.
 *
 * **Warum er sich hier zuverlässig herstellen lässt** (und deshalb ein Anker sein darf
 * statt eines Tickets): der Test publiziert für den Ungelesen-Marker ohnehin schon eine
 * Fremd-Nachricht nach `all = jetzt`. Genau die erzeugt im Raum die Grenze. Die drei
 * Bedingungen aus `feeds.ts` sind damit erfüllt: `lastRead > 0` (Wasserzeichen aus dem
 * Login), `created_at > lastRead` (nach dem Login publiziert), `idx > 0` (der Seed-Raum
 * „Punktprobe" trägt 60 ältere Nachrichten — ohne sie wäre der ganze Verlauf ungelesen
 * und die Linie hätte nichts zu trennen). `_lastRead` ist ein SNAPSHOT beim Öffnen
 * (`bridge.ts`), das Quittieren am Boden löscht die Linie also nicht unter der Messung
 * weg.
 *
 * Der Selektor greift die Klassen ohne die Farbe: die Farbe ist der Prüfgegenstand.
 * `font-semibold` trennt ihn vom Tages-Divider derselben Zeile (`text-muted`).
 */
const DIVIDER_SELECTOR = 'span.font-mono.font-semibold.tracking-wide'

async function measureRoomDivider(page: Page): Promise<Measured[]> {
    await page.goto('/rooms/punkt')
    await expect(page.getByText('Neue Nachrichten', { exact: true })).toBeVisible({ timeout: 30_000 })
    return measure(page, [{ selector: DIVIDER_SELECTOR, label: 'Ungelesen-Divider (Raum)', kind: 'text' }])
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
        // Ungelesen-Zustand herstellen, sonst gibt es keinen Punkt zu messen. Die
        // Nachricht MUSS nach dem Login kommen: `initReadState()` setzt für einen
        // frischen Account `all = jetzt`, alles Ältere gilt als gelesen. Erst auf die
        // geladene Raumliste warten — sie ist der Beleg, dass der Lesestand-Boot durch
        // ist. Wird direkt nach `waitForURL` publiziert, trifft `created_at` dieselbe
        // Sekunde wie `all`, und `created_at > watermark` ist knapp falsch: der Punkt
        // bliebe aus, ohne dass irgendetwas kaputt wäre.
        await expect(page.getByRole('button', { name: /Punktprobe/ })).toBeVisible({ timeout: 20_000 })
        execFileSync(NAK, ['event', '--auth', '--sec', ADMIN, '-k', '9', '-t', 'h=punkt', '-c', `A11y-${Date.now()}`, ZOOID_WS])
        await expect(page.locator('span.size-2.rounded-full').first()).toBeVisible({ timeout: 20_000 })
        // Zweiter, EIGENER Beleg: seit P6 trägt die Raum-Zeile eine Zähler-Pille statt
        // des Punktes. Der Punkt oben lebt nur noch in der Bottom-Nav — er würde also
        // auch dann erscheinen, wenn die Pille gar nicht rendert (falscher Store-Name,
        // Zahl bleibt 0). Ohne diese Zeile schlüge das erst unten in den Guards zu, und
        // zwar ohne Wartezeit: ein Rennen sähe aus wie ein Markup-Fehler.
        await expect(page.locator('span.bg-brand-500.text-zinc-950').first()).toBeVisible({ timeout: 20_000 })

        // Reihenfolge: erst alles auf `/spaces`, dann der Raum — der Raumbesuch ist ein
        // echter Seitenwechsel und käme nicht ohne Reload zur Raumliste zurück.
        const measured = [...(await measureAllSurfaces(page)), ...(await measureRoomDivider(page))]
        console.log(`KONTRAST[${theme}] ` + JSON.stringify(measured, null, 1))

        // Gegenprobe gegen einen leeren Lauf: misst der Test überhaupt etwas — und
        // zwar ALLE drei Sorten? Ohne diese Zeilen bestünde der Test auch dann, wenn
        // eine Oberfläche gar nicht mehr rendert und schlicht nichts gemessen wird.
        expect(measured.length, 'keine Brand-Farbträger gefunden — Messung wertlos').toBeGreaterThan(0)
        expect(measured.some((m) => m.kind === 'text'), 'kein Text-Träger gemessen').toBe(true)
        expect(measured.some((m) => m.kind === 'icon'), 'kein Icon-Träger gemessen — Icon-Schwelle ungeprüft').toBe(true)
        expect(
            measured.some((m) => m.kind === 'graphic' && m.label === 'Ungelesen-Punkt'),
            'kein Ungelesen-Punkt gemessen — die 1.4.11-Schwelle des Punktes ist ungeprüft',
        ).toBe(true)
        // P6: jede der drei Zähler-Pillen EINZELN verlangen. Eine Sammelabfrage
        // („irgendeine Pille gemessen") wäre wertlos — die drei Auftritte stehen an
        // drei verschiedenen Untergründen (Kachel · Segmented-Control · Kopfzeile),
        // und genau der ungemessene ist erfahrungsgemäß der rote.
        for (const role of ['Zähler-Pille Zeile', 'Zähler-Pille Tab', 'Zähler-Pille Glocke']) {
            expect(
                measured.some((m) => m.label === role),
                `${role} nicht gemessen — diese Pille ist ungeprüft (rendert sie überhaupt?)`,
            ).toBe(true)
        }
        expect(
            measured.some((m) => m.label === 'Ungelesen-Divider (Raum)'),
            'Ungelesen-Divider nicht gemessen — der Selektor greift nicht mehr oder die Grenze entstand nicht',
        ).toBe(true)

        for (const m of measured) {
            const min = m.kind === 'text' ? 4.5 : 3
            expect(
                m.ratio,
                `[${theme}] ${m.label || '(Icon)'} — ${m.fg} auf ${m.bg}, verlangt ${min}:1`,
            ).toBeGreaterThanOrEqual(min)
        }
    })
}
