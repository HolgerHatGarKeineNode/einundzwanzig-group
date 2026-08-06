import { test, expect, type Page } from './support/fixtures'
import { execFileSync } from 'node:child_process'
import { useZooid, ZOOID_WS } from './support/zooid'
import { loginNsec } from './support/login'
import { measure, type Measured, type Extra } from './support/contrast'

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
 *
 * Seit dem Composer-Emoji-Knopf kommt das EMOJI-PANEL dazu (Phase 4). Es ist der
 * Beleg dafür, dass dieser Anker nur so weit trägt wie seine Oberflächenliste: im
 * Panel stand weißer Text auf weißer Karte (1:1), im dunklen Theme dazu ein
 * Platzhalter bei 1,74:1 — beides unbemerkt, weil ein erst auf Klick aufgebautes
 * Popover in keiner Phase vorkam. Der Platzhalter ist zugleich der Fall
 * „Utility greift nicht": die `text-muted`-Utility kompiliert ihre Dark-Hälfte hinter
 * einer Platzhalter-Variante zu `::placeholder:where(){…}` — ein leeres `:where()`,
 * das nie matcht.
 *
 * Der kaputte Klassenname steht hier bewusst NICHT ausgeschrieben. Tailwind v4 scannt
 * das Projekt automatisch, `tests/` eingeschlossen, und erzeugt Regeln aus jedem
 * Textfund — auch aus einem Kommentar. Nachgewiesen: nach dem Fix aller echten
 * Fundstellen blieb die tote Regel allein wegen der erklärenden Kommentare im
 * gebauten CSS stehen.
 *
 * Ebenfalls neu und für jede künftige Messung gültig: zu jedem Träger wird die
 * WIRKSAME DECKKRAFT mitgeführt und auf 1 geprüft. `opacity` steht nicht in `color`;
 * ein Träger unter `opacity-70` meldete bisher sein volles Verhältnis. Das ist kein
 * hypothetischer Fall — die Kategorie-Tabs des Panels laufen genau so.
 */
const NSEC = process.env.NOSTR_TEST_NSEC as string
const NAK = process.env.NAK ?? `${process.env.HOME}/go/bin/nak`
const ADMIN = 'b2ee09a54bedf17ee1db562bdddd75c48661d981eb52c49dc206c55ba8439414'

// Farb-Parser, `measure()` und die Typen `Measured`/`Extra` wurden am 2026-08-06
// nach `support/contrast.ts` verschoben (importiert oben), damit auch andere Specs
// Kontrast messen können. Herleitung des Parsers, Fail-closed-Verhalten von
// `measure()` und die Alpha-Komposition des Vordergrunds stehen dort im Kopf.

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

/**
 * Phase 0 — die KANTEN der Bedienelemente im Anmeldeformular (vor dem Login).
 *
 * Die Grenze eines Bedienelements fällt unter 1.4.11 (≥ 3:1) und ist ein eigener
 * Prüfgegenstand: sie kann reißen, während Beschriftung und Fläche desselben Feldes
 * sauber sind. Gemessen wird je SORTE eine Stelle, weil die Sorten verschiedene
 * DOM-Verträge haben — Feld und Auswahl tragen `data-flux-control`, das Ankreuzfeld
 * dagegen ein eigenes Element mit eigenem Indikator. Fällt der Override an einer
 * Sorte aus, sagt ausschließlich diese eine Zeile es; eine Sammelmessung („irgendeine
 * Kante war in Ordnung") wäre wertlos, das steht für die Zähler-Pillen weiter oben
 * schon so.
 *
 * `:not([disabled])` ist keine Bequemlichkeit: 1.4.11 nimmt INAKTIVE Bedienelemente
 * ausdrücklich aus, und Flux zeichnet sie bewusst schwächer. Das nsec-Feld dieser
 * Seite ist bis zum Häkchen gesperrt und läge dunkel bei 1,16:1 — normkonform, aber
 * es würde diese Messung ohne den Zusatz zufällig treffen und wäre dann ein
 * Falsch-Positiv, das man irgendwann wegklickt.
 */
async function measureLoginControls(page: Page): Promise<Measured[]> {
    await page.goto('/nostr-login')
    await page.getByRole('button', { name: 'Andere Optionen' }).click()
    await expect(page.getByLabel('Ich verstehe das Risiko')).toBeVisible({ timeout: 15_000 })
    return (
        await measure(page, [
            {
                selector: 'input[data-flux-control]:not([disabled])',
                label: 'Kante Textfeld (Anmeldung)',
                kind: 'graphic',
                prop: 'borderTopColor',
            },
            {
                selector: 'ui-checkbox [data-flux-checkbox-indicator]',
                label: 'Kante Ankreuzfeld (Anmeldung)',
                kind: 'graphic',
                prop: 'borderTopColor',
            },
        ])
    ).filter((m) => m.label.startsWith('Kante '))
}

async function measureRoomDivider(page: Page): Promise<Measured[]> {
    await page.goto('/rooms/punkt')
    await expect(page.getByText('Neue Nachrichten', { exact: true })).toBeVisible({ timeout: 30_000 })
    return measure(page, [{ selector: DIVIDER_SELECTOR, label: 'Ungelesen-Divider (Raum)', kind: 'text' }])
}

/**
 * Phase 4 — das Emoji-Panel (Composer-Picker).
 *
 * **Warum es hier fehlte und das teuer war:** in diesem Panel stand weißer Text auf
 * weißer Karte — gemessen 1:1 — und ist durch ein QS-Gate spaziert, weil der Anker
 * ihn nicht ansah. Ein Panel, das sich erst auf Klick aufbaut, wird von keiner der
 * Phasen oben erfasst; ungemessen sieht aus wie grün.
 *
 * Zwei Unterphasen, weil sich die Zustände ausschließen: die Kategorie-Tabs sind bei
 * AKTIVER Suche ausgeblendet (`x-show="ready && !search.trim()"`), der Leerzustand
 * entsteht nur MIT einer Suche ohne Treffer. In einem Durchgang wäre immer eines der
 * beiden ungemessen.
 *
 * Der Emoji-Knopf im Composer existiert nur auf einem Zeigegerät (`$store.viewport.mouse`
 * gatet das `<template x-if>`); Chromium meldet im Standardprojekt `(hover: hover)` und
 * `(pointer: fine)` ohne Sonderkonfiguration — dieselbe Vorbedingung wie in
 * `emoji-composer.spec.ts`.
 *
 * Was NICHT als Verhältnis gemessen wird und warum: die Kategorie-Beschriftungen sind
 * FARB-EMOJI. `color` malt an ihnen nichts, ein Kontrastwert daraus wäre eine erfundene
 * Zahl — genau das, wogegen der Parser oben absichtlich wirft. Ihre Lesbarkeit hängt
 * allein an der Deckkraft, und die wird als eigener Wert geprüft (`tabDeckkraft`).
 * Der Aktiv-ZUSTAND dagegen hat einen echten Farbträger, den Unterstrich; er läuft über
 * dieselbe `bg-brand-700`-Klassenregel wie Ungelesen-Punkt und Nav-Indikator.
 */
const PICKER = 'body > div.fixed.z-50'
const SEARCH = `${PICKER} input[type=search]`

async function measureEmojiPicker(page: Page): Promise<{ measured: Measured[]; tabDeckkraft: number }> {
    const composer = page
        .locator('div.relative.flex.items-end.gap-2')
        .filter({ has: page.getByPlaceholder('Nachricht schreiben…') })
    await composer.getByRole('button', { name: 'Emoji einfügen' }).click()
    await expect(page.locator(PICKER)).toBeVisible({ timeout: 15_000 })
    // Die Tabs erscheinen erst, wenn emojibase geladen ist. Ohne dieses Warten misst
    // die Phase den Ladezustand: kein Unterstrich, kein Tab — und meldet „nicht
    // gefunden" für etwas, das nur noch nicht da ist.
    await expect(page.getByRole('tab').first()).toBeVisible({ timeout: 20_000 })
    // Fokus aus dem Suchfeld nehmen: das Panel fokussiert es beim Öffnen selbst, und
    // `focus:border-brand-500` überschriebe die zu prüfende Kantenfarbe. Gemessen wird
    // der Zustand, in dem das Feld die meiste Zeit steht.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())

    // Unterphase A — Ruhezustand: Eingabefarbe, Platzhalter, Kante, Aktiv-Unterstrich.
    const offen = (
        await measure(page, [
            { selector: SEARCH, label: 'Emoji-Suchfeld (Eingabe)', kind: 'text' },
            { selector: SEARCH, label: 'Emoji-Suchfeld (Platzhalter)', kind: 'text', pseudo: '::placeholder' },
            // Die Kante trägt die Erkennbarkeit des Feldes (1.4.11, ≥ 3:1). Sie wird im
            // RUHEZUSTAND gemessen: `focus:border-brand-500` würde sonst die geprüfte
            // Farbe überschreiben, und der Autofokus des Panels legt den Fokus genau
            // dorthin. Deshalb steht vor dieser Messung ein `blur()`.
            { selector: SEARCH, label: 'Emoji-Suchfeld (Kante)', kind: 'graphic', prop: 'borderTopColor' },
        ])
    ).filter((m) => m.label.startsWith('Emoji-'))

    // Wirksame Deckkraft eines INAKTIVEN Tabs. `0`, wenn keiner gefunden wird — der
    // Guard im Test schlägt dann an, statt dass eine fehlende Messung durchgeht.
    const tabDeckkraft = await page.evaluate((sel) => {
        const tabs = Array.from(document.querySelectorAll(`${sel} [role=tab]`)) as HTMLElement[]
        const inaktiv = tabs.find((t) => t.getAttribute('aria-selected') !== 'true')
        if (!inaktiv) {
            return 0
        }
        let o = 1
        let node: HTMLElement | null = inaktiv
        while (node) {
            o *= Number(getComputedStyle(node).opacity)
            node = node.parentElement
        }
        return Math.round(o * 100) / 100
    }, PICKER)

    // Unterphase B — Leerzustand. Der Suchbegriff darf keine Treffer haben; die Tabs
    // verschwinden dabei, deshalb erst jetzt.
    await page.locator(SEARCH).fill('zzzznixdadraussen')
    const leerText = page.locator(`${PICKER} p`)
    await expect(leerText).toBeVisible({ timeout: 10_000 })
    const leer = (
        await measure(page, [{ selector: `${PICKER} p`, label: 'Emoji-Leerzustand', kind: 'text' }])
    ).filter((m) => m.label.startsWith('Emoji-Leerzustand'))

    return { measured: [...offen, ...leer], tabDeckkraft }
}

/**
 * Phase 5 — die restlichen beiden Sorten im Raum: mehrzeiliges Feld und Auswahlfeld.
 *
 * Das mehrzeilige Feld ist der Composer, es steht ohnehin auf der Seite. Das
 * Auswahlfeld gibt es in dieser App NUR in Dialogen (Umfrage anlegen, Melden) —
 * ohne diesen Klickweg bliebe die Sorte ungemessen, und ungemessen sieht aus wie
 * grün. Der Weg über das „+"-Menü ist derselbe, den ein Nutzer geht.
 */
async function measureRoomFormControls(page: Page): Promise<Measured[]> {
    // Das Emoji-Panel aus der vorigen Phase schließen, sonst fängt es den Klick ab.
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
    // Auf den PLATZHALTER ankern, nicht auf die DOM-Reihenfolge: der Thread-Composer
    // rendert aus demselben Partial und steht seit dem Panel-Umbau VOR dem
    // Raum-Composer. `textarea[data-flux-control]` allein träfe also den versteckten
    // Thread-Composer, und die Messung meldete „nicht gefunden" für ein Feld, das
    // sichtbar auf dem Schirm steht. Eine Reihenfolge ist kein Vertrag, ein
    // Platzhalter schon.
    const textarea = (
        await measure(page, [
            {
                selector: 'textarea[data-flux-control][placeholder="Nachricht schreiben…"]:not([disabled])',
                label: 'Kante Mehrzeiliges Feld (Composer)',
                kind: 'graphic',
                prop: 'borderTopColor',
            },
        ])
    ).filter((m) => m.label.startsWith('Kante '))

    await page.getByRole('button', { name: 'Anhängen' }).click()
    await page.getByRole('menuitem', { name: 'Umfrage' }).click()
    // Auf das Auswahlfeld DIESES Dialogs ankern (`x-model` bleibt im DOM stehen):
    // `select[data-flux-control]` allein trifft zwei Knoten, weil der Melde-Dialog
    // sein eigenes — unsichtbares — Auswahlfeld im DOM hält. `measure()` nimmt den
    // ERSTEN Treffer, und das wäre der unsichtbare gewesen: die Messung hätte
    // „nicht gefunden" gemeldet, obwohl das geprüfte Feld tadellos dasteht.
    const POLL_SELECT = 'select[x-model="pollTypeSel"]:not([disabled])'
    await expect(page.locator(POLL_SELECT)).toBeVisible({ timeout: 15_000 })
    // Auf das ENDE der Einblendung warten, nicht auf eine Wartezahl: der Dialog fährt
    // mit einer Opazitäts-Transition auf, und mitten darin gemessen ist jedes
    // Verhältnis erfunden. Der Deckkraft-Guard weiter unten hat genau das gefangen
    // (gemessene 0,113) — hier steht die Bedingung, die er verlangt.
    await expect
        .poll(
            () =>
                page.evaluate((s) => {
                    let el = document.querySelector(s) as HTMLElement | null
                    let o = 1
                    while (el) {
                        o *= Number(getComputedStyle(el).opacity)
                        el = el.parentElement
                    }
                    return Math.round(o * 1000) / 1000
                }, POLL_SELECT),
            { timeout: 10_000 },
        )
        .toBe(1)
    const select = (
        await measure(page, [
            { selector: POLL_SELECT, label: 'Kante Auswahlfeld (Umfrage)', kind: 'graphic', prop: 'borderTopColor' },
        ])
    ).filter((m) => m.label.startsWith('Kante '))

    return [...textarea, ...select]
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
        // Phase 0 VOR dem Login: das Anmeldeformular ist die einzige Oberfläche mit
        // einem Ankreuzfeld, und nach dem Login ist sie nicht mehr erreichbar.
        const anmeldung = await measureLoginControls(page)
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
        // echter Seitenwechsel und käme nicht ohne Reload zur Raumliste zurück. Das
        // Emoji-Panel hängt am Composer und wird deshalb im selben Raum aufgeklappt.
        const spacesUndRaum = [...(await measureAllSurfaces(page)), ...(await measureRoomDivider(page))]
        const picker = await measureEmojiPicker(page)
        const formulare = [...anmeldung, ...(await measureRoomFormControls(page))]
        const measured = [...spacesUndRaum, ...picker.measured, ...formulare]
        console.log(`KONTRAST[${theme}] ` + JSON.stringify(measured, null, 1))
        console.log(`DECKKRAFT[${theme}] inaktiver Emoji-Kategorie-Tab: ${picker.tabDeckkraft}`)

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
        // Emoji-Panel: jede Stelle EINZELN verlangen, aus demselben Grund wie bei den
        // Zähler-Pillen. Der 1:1-Fehler dieses Panels lebte in genau einer davon.
        for (const stelle of [
            'Emoji-Suchfeld (Eingabe)',
            'Emoji-Suchfeld (Platzhalter)',
            'Emoji-Suchfeld (Kante)',
            'Emoji-Kategorie aktiv (Unterstrich)',
            'Emoji-Leerzustand',
        ]) {
            // Zwei Ursachen, beide gleich rot — die Meldung nennt sie, weil sie in der
            // Kalibrierung nachweislich verwechselbar waren: (1) das Panel rendert
            // nicht (kein Zeigegerät, emojibase nicht geladen, Selektor veraltet),
            // (2) der Farbträger ist aus der Klassen-Regel gefallen. Fall 2 ist beim
            // Aufklapp-Unterstrich real passiert: zurück auf `bg-brand-500` gedreht,
            // findet ihn die `bg-brand-700`-Regel nicht mehr — und genau dieser Zustand
            // ist der, der mit 2,21:1 unter der Schwelle lag.
            expect(
                measured.some((m) => m.label === stelle),
                `${stelle} nicht gemessen — entweder rendert das Emoji-Panel nicht (Zeigegerät? emojibase geladen?) oder der Träger trägt die erwartete Farbklasse nicht mehr`,
            ).toBe(true)
        }
        // Je SORTE eine Kante. Vier Einträge, weil vier verschiedene DOM-Verträge
        // dahinterstehen: Feld, Auswahl und mehrzeiliges Feld hängen an
        // `data-flux-control`, das Ankreuzfeld an seinem eigenen Indikator. Fällt der
        // Override an genau einer Sorte aus, sagt es nur diese eine Zeile.
        for (const sorte of [
            'Kante Textfeld (Anmeldung)',
            'Kante Ankreuzfeld (Anmeldung)',
            'Kante Mehrzeiliges Feld (Composer)',
            'Kante Auswahlfeld (Umfrage)',
        ]) {
            expect(
                measured.some((m) => m.label === sorte),
                `${sorte} nicht gemessen — das Bedienelement rendert nicht, oder sein Selektor trifft einen anderen (versteckten) Knoten derselben Sorte`,
            ).toBe(true)
        }

        // Deckkraft der inaktiven Kategorie-Tabs. KEIN Kontrastwert, sondern der Wert
        // selbst: die Beschriftung ist ein Farb-Emoji, an dem `color` nichts malt (siehe
        // measureEmojiPicker). Untergrenze 0.7 — darunter liegt das Band, in dem
        // Material 3 DEAKTIVIERTE Elemente zeichnet (0.38), und ein bedienbarer Tab darf
        // nicht aussehen wie ein gesperrter. `0` heißt: kein inaktiver Tab gefunden.
        expect(
            picker.tabDeckkraft,
            `[${theme}] inaktiver Emoji-Kategorie-Tab bei Deckkraft ${picker.tabDeckkraft} — unter 0.7 liest er sich als deaktiviert`,
        ).toBeGreaterThanOrEqual(0.7)

        // Kein gemessener Farbträger darf unter einer gebrochenen Deckkraft liegen:
        // `opacity` steht nicht in `color`, das Verhältnis oben wäre dann zu gut
        // gerechnet. Lieber rot mit Hinweis als eine stille Schönfärbung.
        for (const m of measured) {
            expect(
                m.opacity,
                `[${theme}] ${m.label || '(Icon)'} liegt unter opacity ${m.opacity} — das gemessene Verhältnis ${m.ratio}:1 wäre erfunden`,
            ).toBe(1)
        }

        for (const m of measured) {
            const min = m.kind === 'text' ? 4.5 : 3
            expect(
                m.ratio,
                `[${theme}] ${m.label || '(Icon)'} — ${m.fg} auf ${m.bg}, verlangt ${min}:1`,
            ).toBeGreaterThanOrEqual(min)
        }
    })
}
