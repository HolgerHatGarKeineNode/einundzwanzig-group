// Seit P9.2 über `board-fixtures` statt direkt über `fixtures`: das dortige
// worker-scoped `boardServer`-Fixture fährt einen ZWEITEN `php artisan serve`
// mit `NOSTR_BOARD_URL` auf demselben worker-eigenen zooid (P7-Muster). Nur so
// rendert der Server `@if ($hasBoard)` die Artikel-Zeile (`⚡spaces:706`) —
// einer der bis P9 ungerendert gebliebenen Grafik-Träger. Der Space-Relay ist
// derselbe wie vorher, Login/Ungelesen/Raumphasen laufen unverändert.
import { test, expect, type Page } from './support/board-fixtures'
import { execFileSync } from 'node:child_process'
import { useZooid, ZOOID_WS } from './support/zooid'
import { loginNsec } from './support/login'
import { measure, type Measured } from './support/contrast'

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
 *
 * **Klassifiziert wird seit P2/Restposten über den INHALT, nicht über die Klasse.**
 * Hier stand bis 2026-08-15 `/text-brand-700/.test(className) ? 'icon' : 'text'` — und
 * das war die teuerste Zeile dieses Ankers: jeder `text-brand-700`-Träger galt damit
 * als Icon und wurde gegen 3:1 gemessen. Die Kontextzeile des Login-Sheets stand mit
 * 4,40:1 als TEXT auf weißem Sheet und wäre hier grün durchgegangen; gefunden hat sie
 * eine Handmessung des `design-lead`, nicht dieser Test. Die naheliegende Reparatur —
 * die Bedingung umdrehen — wäre der Fehler mit umgekehrtem Vorzeichen gewesen: sechs
 * Träger im Repo sind echte Grafik (vier `size-10`-Icon-Spans in `⚡spaces`, der
 * Emoji-Knopf im Composer, das Häkchen der Länderauswahl) und tragen mit 4,40 gegen
 * ihre 3:1 zu Recht. Gefragt wird deshalb, was die Farbe MALT (siehe `gemalteTexte()`
 * in `support/contrast.ts`): eigener gemalter Textknoten → 1.4.3, nur Icon → 1.4.11.
 * Das ist theme-stabil wie die alte Klassenregel (der Inhalt wechselt mit dem Theme
 * nicht), nur eben richtig.
 *
 * Dazu die Großschrift-Ausnahme aus 1.4.3 (ab 18,66 px fett bzw. 24 px genügen 3:1) —
 * ohne sie färbte die schärfere Einstufung legitime Überschriften rot. Sie wird pro
 * gemaltem Textknoten ausgewertet: an einem GEMISCHTEN Träger wie `nav-tab` (eine
 * Klasse am `<a>` färbt Icon UND 11-px-Label) gibt der kleinste Text die Schwelle vor.
 * Die geforderte Schwelle steht als `min` an jeder Messung und wird mitgeloggt.
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

/**
 * P9.2 — Fixture-Erweiterung: die zwei Räume, die die bislang ungerenderten
 * Meetup- und Antrags-Träger auf den Bildschirm bringen. Bewusst aus der SPEC
 * gepublisht (nak, wie der Ungelesen-Marker oben) und nicht im geteilten
 * `zooid-testserver.sh`: sie sind Kontrast-Präparate, kein Seed, den andere
 * Specs als gegeben voraussetzen. Idempotent über Läufe hinweg — kind 9007 ist
 * über `h` replaceable (UpdateMetadata), ein wiederholter 9021-Join antwortet
 * „duplicate" und wird ignoriert (beides so im Seed-Skript belegt).
 *
 * - `h=meetxenon` (t=meetup, Slug `meetup-xenon-e2e`): kommt in KEINEM Portal-
 *   Join-Datensatz vor → ohne Flagge → die Kachel rendert die INITIALE
 *   (`meetup-tile:45`, brand-800). Der Name beginnt mit X, damit die Initiale
 *   als Beschriftung eindeutig greifbar ist (kein anderer Träger malt ein „X").
 * - `h=propsupport` (t=project-support) + Join des TEST-USERS: ein EIGENER
 *   Antragsraum reicht für `proposalCount() > 0` — die Entdecken-Zeile
 *   (`⚡spaces:759`) rendert auch ohne Admin, denn `_proposalPool()` nimmt
 *   `mine` immer auf; nur FREMDE Anträge brauchen isAdmin.
 */
function seedKontrastTraeger(): void {
    execFileSync(
        NAK,
        ['event', '--auth', '--sec', ADMIN, '-k', '9007', '-t', 'h=propsupport', '-t', 'name=Antragsraum Probe', '-t', 'about=P9-Anker', '-t', 't=project-support', '-t', 'i=proposal:a11y-probe', ZOOID_WS],
        { stdio: 'ignore' },
    )
    execFileSync(NAK, ['event', '--auth', '--sec', NSEC, '-k', '9021', '-t', 'h=propsupport', ZOOID_WS], { stdio: 'ignore' })
    execFileSync(
        NAK,
        ['event', '--auth', '--sec', ADMIN, '-k', '9007', '-t', 'h=meetxenon', '-t', 'name=Xenon-Runde', '-t', 'about=P9-Anker', '-t', 't=meetup', '-t', 'i=meetup:e2e-xenon', '-t', 'meetup_slug=meetup-xenon-e2e', ZOOID_WS],
        { stdio: 'ignore' },
    )
}

/**
 * P9.2 — Meetup-Join STATT des Standard-Stubs aus `support/zooid.ts`: dieselben
 * drei Records, aber Berlin bekommt einen Termin in +3 Tagen. `isEventSoon`
 * (≤ 7 Tage) schaltet der Kachel den Datum-Wrapper (`meetup-tile:78`) auf
 * brand-800; +3 statt +1/+2 Tage hält Abstand zu „Heute"/„Morgen", deren Labels
 * (übersetzt) eine zweite Regex-Ebene kosten würden. Der Xenon-Slug fehlt
 * bewusst weiter hier — ohne Join-Datensatz bleibt die Initiale.
 *
 * Muss NACH `useZooid()` registriert werden: Playwright befragt Routes in
 * umgekehrter Registrierungsordnung, die spätere gewinnt (Muster wie der
 * `__nostrWorkspace`-Override in workspaces.spec.ts).
 */
const MEETUP_API = 'https://portal.einundzwanzig.space/api/mobile/meetups'

async function stubMeetupJoinMitTermin(page: Page): Promise<void> {
    const termin = new Date(Date.now() + 3 * 86400000).toISOString()
    const records = [
        { name: 'Meetup Berlin', slug: 'meetup-berlin-e2e', city: 'Berlin', country: 'DE', logo: null, next_event_start: termin },
        { name: 'Meetup Wien', slug: 'meetup-wien-e2e', city: 'Wien', country: 'AT', logo: null, next_event_start: null },
        { name: 'Meetup Hamburg', slug: 'meetup-hamburg-e2e', city: 'Hamburg', country: 'DE', logo: null, next_event_start: null },
    ]
    await page.route(MEETUP_API, (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(records) }),
    )
}

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
    // P9.2: Der eigene Antragsraum (seedKontrastTraeger) macht die Projektunterstützungs-
    // Zeile sichtbar — ihr Icon-Chip (⚡spaces:759) ist einer der bis P9 ungerenderten
    // Grafik-Träger. Gewartet wird auf die ZEILE, nicht auf den Chip: die Zeile ist der
    // Zustand, der Chip sein Symptom — und ein Join, der noch nicht durch ist, würde
    // hier laut rot statt unten mit einer Zahl, die nichts aussagt.
    await expect(page.getByText('Projektunterstützung entdecken')).toBeVisible({ timeout: 20_000 })
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

    // Zustand A — Popover offen, KEIN Land gewählt (bis P9 der EINZIGE gemessene
    // Zustand dieses Filters): „Alle Länder"-Zeile (brand-800) + Häkchen (brand-700).
    // Seit P9.2 rendert die Liste darunter zusätzlich die Kachel-Träger: die
    // Xenon-INITIALE (meetup-tile:45 — Raum ohne Join-Datensatz im Stub) und das
    // Berlin-DATUM (meetup-tile:78 — isEventSoon über den Stub-Termin). Beide
    // verschwinden, sobald ein Land gewählt ist (Räume ohne Land fallen aus dem
    // Filter) — deshalb werden sie genau HIER gemessen, nicht in Zustand B/C.
    const zustandA = await measure(page)

    // Zustand B — Land gewählt, über den echten Nutzerpfad (Zeile im Popover
    // antippen). Land-Knopf (⚡spaces:340) und Filter-Chip (:410) tragen brand-800
    // NUR mit gesetztem Filter. Markiert wie die Hover-Messung in Phase 1b, damit
    // die Guards unten je Zustand zählen können statt global „irgendwo".
    //
    // Auf das ENDE der chip-in-Transition warten (Opazität, Muster wie beim
    // Login-Sheet und im Umfrage-Dialog): der Chip blendet ein, und mitten darin
    // gemessen ist jedes Verhältnis erfunden — der Lauf 1 dieser Phase fing ihn
    // bei opacity 0.524 ein.
    const popover = page.locator('div.surface-card.absolute')
    await popover.getByRole('button', { name: /Deutschland/ }).click()
    await expect(page.getByRole('button', { name: 'Filter leeren' })).toBeVisible({ timeout: 10_000 })
    const chip = page.locator('button.chip-in')
    await expect
        .poll(
            () =>
                page.evaluate((sel) => {
                    let o = 1
                    let el = document.querySelector(sel) as HTMLElement | null
                    while (el) {
                        o *= Number(getComputedStyle(el).opacity)
                        el = el.parentElement
                    }
                    return Math.round(o * 1000) / 1000
                }, 'button.chip-in'),
            { timeout: 10_000 },
        )
        .toBe(1)
    expect(await chip.count(), 'mit gesetztem Land, ohne Suchtext muss GENAU der Land-Chip stehen').toBe(1)
    const zustandB = (await measure(page)).map((m) => ({ ...m, label: `${m.label} (Filter DE)` }))

    // Zustand C — Popover erneut öffnen, MIT gewähltem Land: die gewählte
    // Länderzeile (⚡spaces:375) trägt brand-800 nur in diesem Zustand (und die
    // „Alle Länder"-Zeile dafür nicht mehr — deshalb ist Zustand A vorher gemessen).
    // Auf DIESE Zeile warten, nicht auf den Knopf: erst ihr Sichtbarsein beweist,
    // dass das Popover offen ist — der Toggle hat hier zwei Handler (x-on:click
    // am Knopf, x-on:click.outside am Popover), und ein blindes 400-ms-Warten
    // hätte einen geschlossenen Zustand wie einen gemessenen aussehen lassen
    // (genau die Fehlerklasse, deretwegen dieser Anker existiert).
    const landKnopf = page.getByRole('button', { name: /Deutschland/ }).first()
    await landKnopf.click()
    await expect(
        popover.getByRole('button', { name: /Deutschland/ }),
        'Länder-Popover öffnet nicht — die gewählte Zeile (⚡spaces:375) wäre ungemessen',
    ).toBeVisible({ timeout: 10_000 })
    await page.waitForTimeout(300)
    const zustandC = (await measure(page)).map((m) => ({ ...m, label: `${m.label} (Popover DE)` }))
    await page.keyboard.press('Escape')

    return [...phase1, ...zustandA, ...zustandB, ...zustandC]
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

/**
 * Phase 0b — die KONTEXTZEILE des Login-Sheets (§4.2, `intent.label`).
 *
 * **Warum sie hier fehlte und das teuer war:** sie ist der Auslöser dieser ganzen
 * Phase — orange Kleinschrift auf weißem Sheet, gemessen 4,40:1 gegen die 4,5:1 aus
 * 1.4.3. Dieser Anker hätte sie aus DREI unabhängigen Gründen nie gefangen, jeder für
 * sich hinreichend: (1) `flux:text` rendert ein `<p>`, und die Kehrschleife besuchte
 * nur `span, div, button`; (2) die Einstufung hing am Klassennamen, `text-brand-700`
 * galt als Icon und wurde gegen 3:1 geprüft — 4,40 wäre auch nach Fix (1) grün
 * gewesen; (3) keine Phase öffnet das Sheet, und die Zeile existiert nur mit
 * gesetztem Label (`x-show="label"`). (1) und (2) sind in `support/contrast.ts`
 * behoben, (3) ist diese Phase.
 *
 * **Warum als Gast auf `/nostr-login` und nicht mit einem Tab-Tap:** das Sheet ist
 * EINMAL im Layout gemountet (`einundzwanzig.blade.php`, außerhalb des `$slot`), liegt
 * also auf jeder Seite — auch auf dem Login-View. Die einzige Vorbedingung ist ein
 * GAST, und den gibt es in diesem Test nur vor `loginNsec()`. Ein gegateter Tab-Tap
 * bräuchte `/spaces`, und dorthin lässt der Server-Gate (`EnsureNostrAuth`) keinen
 * Gast — er würde auf genau diese Seite zurückwerfen.
 *
 * Aufgerufen wird `requireAuth()`, nicht ein handgeschriebenes `open-login-sheet`:
 * das ist der Weg, den JEDER gegatete Tap dieser App nimmt (`nav-tab` → `gateTap` →
 * `requireAuth`, Befehlspalette, Raum-Beitritt, Gast-Composer). Ein selbst
 * gebasteltes Event hätte den Vertrag nachgebaut statt ihn zu prüfen. Bleibt das
 * Sheet aus, navigiert `requireAuth` hart auf den Login-View — dann läuft die
 * Erwartung unten in ihren Timeout, und zwar mit der richtigen Aussage.
 *
 * Der Selektor greift die Klassen OHNE die Farbe (wie beim Ungelesen-Divider): die
 * Farbe ist der Prüfgegenstand. Auf `text-brand-800` zu ankern hieße, dass die
 * Gegenprobe (zurück auf `brand-700`) mit „NICHT GEFUNDEN" fiele statt mit der Zahl,
 * um die es geht.
 */
const SHEET_INTENT = 'Kontextzeilen-Probe'
const SHEET_ZEILE = '[role="dialog"] [data-flux-text][x-text="label"]'

async function measureLoginSheet(page: Page): Promise<Measured[]> {
    await page.evaluate((label) => {
        const alpine = (window as unknown as { Alpine?: { store: (n: string) => unknown } }).Alpine
        const store = alpine?.store('authGate') as { requireAuth?: (i: { label: string }) => boolean } | undefined
        if (!store?.requireAuth) {
            throw new Error('$store.authGate.requireAuth fehlt — bridge.ts nicht geladen? Das Gate ist ungeprüft.')
        }
        store.requireAuth({ label })
    }, SHEET_INTENT)
    // Auf den TEXT warten, nicht nur auf Sichtbarkeit: `x-show="label"` und `x-text`
    // sind zwei Schritte, und ein leeres `<p>` misst einen Kontrast gegen nichts.
    await expect(page.locator(SHEET_ZEILE)).toHaveText(SHEET_INTENT, { timeout: 15_000 })
    // Auf das ENDE der Einblendung warten (Opazitäts-Transition des Sheets), nicht auf
    // eine Wartezahl — mitten in der Transition gemessen ist jedes Verhältnis erfunden.
    // Denselben Guard hat der Umfrage-Dialog weiter unten, und dort hat er real
    // zugeschlagen (gemessene 0,113).
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
                }, SHEET_ZEILE),
            { timeout: 10_000 },
        )
        .toBe(1)
    return (
        await measure(page, [{ selector: SHEET_ZEILE, label: 'Login-Sheet Kontextzeile', kind: 'text' }])
    ).filter((m) => m.label.startsWith('Login-Sheet '))
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
    )
        // `|| kind === 'icon'`: der Emoji-KNOPF im Composer trägt sein `!text-brand-700`
        // nur, solange das Panel offen ist (`::class="open ? …"`) — er existiert also
        // genau in diesem Zustand und in keinem anderen. Der alte Filter warf ihn weg,
        // und damit war einer der sechs legitimen Grafik-Träger des Repos nirgends
        // gemessen. Er heißt nicht „Emoji-…", weil sein Label aus dem Markup kommt.
        .filter((m) => m.label.startsWith('Emoji-') || m.kind === 'icon')

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

/**
 * Phase 6 — der Mitgliederfilter im Verzeichnis (`/directory`).
 *
 * Anlass (Teambesprechung 2026-08-06): bei der systemweiten Feldkante nannte der
 * `design-lead` genau dieses Feld als DEUTLICHSTES Beispiel — es stand vorher OHNE
 * jede Grenze über der Mitgliederliste. Die Kante ist seither systemweit über
 * `--color-control-edge` gezogen (siehe `theme.css`), aber `/directory` stand in
 * keiner Phase dieses Ankers. Ungemessen sieht aus wie grün, obwohl gerade dieses
 * Feld der Ausgangsbefund war.
 *
 * Derselbe Selektor-Vertrag wie „Kante Textfeld (Anmeldung)": ein `flux:input`
 * rendert `<input data-flux-control>`, die System-Regel greift also unverändert.
 * Auf den PLATZHALTER geankert (nicht auf Reihenfolge/Rolle) — dasselbe Argument wie
 * beim Composer-Feld: ein Selektor, der nur „irgendein Textfeld" trifft, könnte ein
 * anderes, verstecktes Feld derselben Sorte fangen.
 */
async function measureDirectoryFilter(page: Page): Promise<Measured[]> {
    await page.goto('/directory')
    // Warten bis das Member-Grid tatsächlich steht (Fix A, siehe directory.spec.ts) —
    // sonst existiert die Seite zwar, aber der Filter stünde über einem Skeleton statt
    // über der Liste, die er auch am Bildschirm einrahmt.
    await expect(page.locator('.list-stagger').getByText('Relay Admin')).toBeVisible({ timeout: 15_000 })
    return (
        await measure(page, [
            {
                selector: 'input[data-flux-control][placeholder="Mitglied suchen…"]:not([disabled])',
                label: 'Kante Mitgliederfilter (Verzeichnis)',
                kind: 'graphic',
                prop: 'borderTopColor',
            },
        ])
    ).filter((m) => m.label.startsWith('Kante '))
}

for (const theme of ['light', 'dark'] as const) {
    test(`A11y: gerenderter Kontrast der Brand-Farben erfüllt WCAG (${theme})`, async ({ page }) => {
        await useZooid(page)
        // P9.2 — die beiden Präzisionsräume (Antragsraum + Join, Meetup ohne Join)
        // und der Meetup-Stub mit Termin. Muss vor der ersten Navigation passieren:
        // der Join wird beim Space-Mount geladen, die Route vor dem Fetch registriert.
        seedKontrastTraeger()
        await stubMeetupJoinMitTermin(page)
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
        // Phase 0b, ebenfalls VOR dem Login: das Sheet öffnet nur für Gäste. NACH
        // `measureLoginControls`, weil das geöffnete Sheet eine ZWEITE `login-form`
        // ins Dokument hängt — deren Felder träfen die Kanten-Selektoren dort zuerst.
        const loginSheet = await measureLoginSheet(page)
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
        const formulare = [
            ...anmeldung,
            ...loginSheet,
            ...(await measureRoomFormControls(page)),
            ...(await measureDirectoryFilter(page)),
        ]
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
        // Die Kontextzeile des Login-Sheets: EINZELN verlangt, und zwar mit ihrer
        // Schwelle. Ohne die zweite Zeile wäre der Fall wieder das, was er vorher war —
        // eine Stelle, die gegen 3:1 durchgewunken wird: 4,40 hätte beide Vorgänger
        // dieses Ankers passiert.
        const kontextzeile = measured.find((m) => m.label === 'Login-Sheet Kontextzeile')
        expect(
            kontextzeile,
            'Login-Sheet Kontextzeile nicht gemessen — Sheet nicht aufgegangen, kein Label gesetzt, oder der Selektor greift nicht mehr',
        ).toBeDefined()
        expect(
            kontextzeile?.min,
            'Login-Sheet Kontextzeile wird nicht als TEXT geprüft — genau diese Fehleinstufung war der blinde Fleck (4,40:1 galt als Icon-Wert)',
        ).toBe(4.5)
        // Die GRAFIK-Seite derselben Regel, einzeln verlangt. `text-brand-700` ist im
        // Repo an sechs Stellen legitim — sie fallen unter 1.4.11 (≥ 3:1) und tragen
        // dort mit 3,82–4,40. Die schärfere Einstufung (Inhalt statt Klassenname) darf
        // sie NICHT nach „Text" ziehen; täte sie es, wären sie mit 4,05 rot, und der
        // billige Ausweg wäre, die Farbe zu ändern. Geankert auf die KLASSEN-Signatur,
        // nicht auf den Zeilentext: die Klasse ist der Vertrag, der Text ist Seed-Daten.
        //
        // Seit P9.2 sind ALLE sechs gerendert. Die bis dahin ungerenderten drei:
        // `⚡spaces:759` (Antragsräume) — der eigene Antragsraum aus seedKontrastTraeger
        // genügt, denn _proposalPool() nimmt `mine` ohne Admin auf; `:706` (Artikel-
        // Zeile) — serverseitig `@if ($hasBoard)`, hergestellt über den board-serve
        // aus support/board-fixtures.ts; `:784` (Raum anlegen, isAdmin) — eigener
        // Test unten, der Login als zooid-Admin. Die Zeilen-UMFELDE sind hier je
        // EINZELN verlangt, weil die Klassen-Signatur aller vier Chips identisch ist:
        // eine Sammelabfrage über die Signatur allein prüfte nur „mindestens einer
        // von vieren" — und genau der ungemessene wäre erfahrungsgemäß der rote.
        for (const [signatur, wo] of [
            ['<span size-10 text-brand-700>', '⚡spaces — Icon-Chip der Einstiegszeilen'],
            ['<svg size-4 text-brand-700>', '⚡spaces — Häkchen der Länder-Auswahl'],
            ['text-brand-700!>', 'chat-composer — Emoji-Knopf (nur bei offenem Panel)'],
        ] as const) {
            expect(
                measured.some((m) => m.kind === 'icon' && m.label.includes(signatur)),
                `Grafik-Träger ${wo} (${signatur}) nicht als Grafik gemessen — er rendert nicht, oder er ist in die TEXT-Einstufung gerutscht und wird jetzt gegen 4,5:1 statt 3:1 geprüft`,
            ).toBe(true)
        }
        for (const umfeld of ['Projektunterstütz', 'Artikel lesen']) {
            expect(
                measured.some((m) => m.kind === 'icon' && m.label.includes(umfeld)),
                `Grafik-Träger „${umfeld}…" nicht gemessen — der Raum/die Config fehlt (seedKontrastTraeger? board-serve?), oder der Chip rendert nicht`,
            ).toBe(true)
        }
        // P9.2 — die bislang ungerendert gebliebenen TEXT-Träger, je Zustand einzeln
        // gezählt statt „irgendwo": Knopf und Chip heißen beide „🇩🇪 Deutschland",
        // die Popover-Zeile ebenso — unterscheidbar sind sie nur über den Zustand,
        // in dem gemessen wurde (Marker siehe measureAllSurfaces, Muster Phase 1b).
        const filterDe = measured.filter((m) => m.kind === 'text' && m.label.includes('Deutschland') && m.label.includes('(Filter DE)'))
        expect(
            filterDe.length,
            'Land-Knopf (⚡spaces:340) und Filter-Chip (:410) müssen mit gesetztem Land gemessen sein — 2 Einträge erwartet',
        ).toBeGreaterThanOrEqual(2)
        const popoverDe = measured.filter((m) => m.kind === 'text' && m.label.includes('Deutschland') && m.label.includes('(Popover DE)'))
        expect(
            popoverDe.length,
            'Land-Knopf + Chip + GEWÄHLTE Länderzeile (⚡spaces:375) müssen im offenen Popover gemessen sein — 3 Einträge erwartet',
        ).toBeGreaterThanOrEqual(3)
        // Die beiden Meetup-Kachel-Träger — der Zustand A ist der gemeinsame Nenner:
        // die Xenon-INITIALE verschwindet bei gesetztem Landfilter (der Raum hat kein
        // Land), das Berlin-DATUM bliebe sichtbar — gemeint ist, dass A beide
        // garantiert hält (siehe measureAllSurfaces, Zustand A). Die Regex akzeptiert
        // beide realen Formate von `fmtEventDate` („Di, 4. Feb" und „Mo., 17. Aug."),
        // NICHT „Heute"/„Morgen" — der Stub-Termin liegt bewusst jenseits beider.
        expect(
            measured.some((m) => m.kind === 'text' && m.label === 'X'),
            'Meetup-Initiale (meetup-tile:45) nicht gemessen — der Raum ohne Join-Datensatz fehlt, oder der Stub liefert doch eine Flagge für ihn',
        ).toBe(true)
        expect(
            measured.some((m) => m.kind === 'text' && /^(Mo|Di|Mi|Do|Fr|Sa|So)[a-z]*\.?, \d{1,2}\. [A-ZÄÖÜ][a-zäöü]{2,3}\.?/.test(m.label)),
            'Meetup-Datum (meetup-tile:78) nicht gemessen — der Stub-Termin fehlt, oder isEventSoon hat den brand-800-Zweig nicht geschaltet',
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
            'Kante Mitgliederfilter (Verzeichnis)',
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

        // Die Schwelle kommt aus der MESSUNG (`min`), nicht mehr aus `kind === 'text'`:
        // sie kennt die Großschrift-Ausnahme aus 1.4.3, die der Test hier nie sehen
        // konnte. `kind` steht trotzdem in der Meldung — bei einem Fehlschlag ist die
        // erste Frage, ob der Träger richtig eingestuft wurde.
        for (const m of measured) {
            expect(
                m.ratio,
                `[${theme}] ${m.label} (${m.kind}) — ${m.fg} auf ${m.bg}, verlangt ${m.min}:1`,
            ).toBeGreaterThanOrEqual(m.min)
        }
    })
}

/**
 * P9.2 — der letzte ungerenderte Grafik-Träger: „Neuen Raum anlegen"
 * (`⚡spaces:784`), gegated hinter `isAdmin`. Der Haupttest loggt den Wegwerf-
 * User, und `_proposalPool()`-/Entdecken-Zeilen dieses Users brauchen kein
 * Admin — aber DIESE Zeile genau das. `isAdmin` ist am zooid die NIP-86-
 * `supportedmethods`-Probe des EINGELOGGTEN Keys (members.ts), also führt kein
 * Seed an ihr vorbei: nur der Login als zooid-Admin (ADMIN-Konstante oben,
 * identisch mit dem Seed-Skript) schaltet sie frei. Eigener Test statt
 * zweitem Login im Haupttest: ein Re-Login mitten im Lauf veränderte den
 * Raumzustand unter den laufenden Phasen — die Admin-Fläche ist eine eigene
 * Messung mit eigenem Guard, nicht ein Anhängsel.
 */
for (const theme of ['light', 'dark'] as const) {
    test(`A11y: Admin-gate Zeilen erfüllen WCAG (${theme})`, async ({ page }) => {
        await useZooid(page)
        await page.addInitScript((t) => {
            try {
                localStorage.setItem('flux.appearance', t as string)
            } catch {
                /* kein localStorage → Test misst dann das Default-Theme */
            }
        }, theme)
        await loginNsec(page, ADMIN)
        // Die Zeile selbst ist der Beleg, dass der NIP-86-Roundtrip durch ist —
        // `isAdmin` läuft asynchron nach dem Login an; ohne dieses Warten wäre ein
        // Rennen von einem Markup-Defekt nicht unterscheidbar (dasselbe Argument
        // wie beim Punktprobe-Warten im Haupttest).
        await expect(page.getByRole('button', { name: 'Neuen Raum anlegen' })).toBeVisible({ timeout: 20_000 })
        // Auf das ENDE der Eingangs-Animationen warten (kleinste wirksame Deckkraft
        // aller bg-brand-700-Flächen === 1): der Nav-Indikator blendet nach dem
        // Login ein, und Lauf 2 fing ihn bei 0.999 — der Opazitäts-Guard unten
        // meldet so einen Zustand zu Recht, aber er würde einen Übergang bemängeln,
        // nicht einen Zustand. Kein sleep: das Pollen auf den ENDE-Zustand ist
        // deterministisch, eine feste Wartezeit wäre es nicht.
        await expect
            .poll(
                () =>
                    page.evaluate(() => {
                        const spans = Array.from(document.querySelectorAll('span.bg-brand-700')) as HTMLElement[]
                        if (spans.length === 0) {
                            return 1
                        }
                        return Math.min(
                            ...spans.map((el) => {
                                let o = 1
                                let node: HTMLElement | null = el
                                while (node) {
                                    o *= Number(getComputedStyle(node).opacity)
                                    node = node.parentElement
                                }
                                return Math.round(o * 1000) / 1000
                            }),
                        )
                    }),
                { timeout: 10_000 },
            )
            .toBe(1)
        const measured = await measure(page)
        console.log(`KONTRAST[${theme}:admin] ` + JSON.stringify(measured, null, 1))
        expect(
            measured.some((m) => m.kind === 'icon' && m.label.includes('Neuen Raum anlegen')),
            'Admin-Chip (⚡spaces:784) nicht als Grafik gemessen — die Zeile rendert nicht, oder der Chip ist in die TEXT-Einstufung gerutscht',
        ).toBe(true)
        for (const m of measured) {
            expect(m.opacity, `[${theme}:admin] ${m.label || '(Icon)'} unter opacity ${m.opacity} — Verhältnis ${m.ratio}:1 wäre erfunden`).toBe(1)
            expect(m.ratio, `[${theme}:admin] ${m.label} (${m.kind}) — ${m.fg} auf ${m.bg}, verlangt ${m.min}:1`).toBeGreaterThanOrEqual(m.min)
        }
    })
}

/**
 * P9.2 — Aufräumen: die beiden Präzisionsräume wieder ENTFERNEN, sobald diese Datei
 * auf dem Worker fertig ist. kind 9008 ist der NIP-29-Raum-Tombstone (welshman
 * `ROOM_DELETE`); zooid löscht dabei die 39000 (`GroupStore.DeleteGroup`), am Live-
 * Relay verifiziert (anlegen → 1 Treffer, 9008 → 0).
 *
 * Warum Pflicht und nicht Kür: die Räume bleiben sonst über die Datei hinaus auf dem
 * worker-eigenen zooid liegen und brechen die PRÄMISSE anderer Specs — die Vollsuite
 * hat das real gezeigt: `command-palette.spec.ts:313` erwartet für `p:` den LEER-
 * zustand mit der ausdrücklichen Begründung „der Seed trägt keinen solchen Raum",
 * und genau dieser Antragsraum machte die Zeile sichtbar. Nach jedem Worker-Lauf
 * dieser Datei ist der Zustand damit wieder der des Seeds. Ein Absturz MITTLERIN
 * kann Räume hinterlassen (wie jede Wegwerf-Raum-Spec auch) — dann räumt der
 * Room-Cap-Guard des Seed-Skripts beim nächsten Lauf.
 */
test.afterAll(() => {
    for (const h of ['propsupport', 'meetxenon']) {
        try {
            execFileSync(NAK, ['event', '--auth', '--sec', ADMIN, '-k', '9008', '-t', `h=${h}`, ZOOID_WS], { stdio: 'ignore' })
        } catch {
            /* Raum existiert auf diesem Worker nicht (kein Theme-Test gelaufen) — doppeltes Aufräumen ist harmlos. */
        }
    }
})

/**
 * P6 — Regression: `measure()`s `prop: 'backgroundColor'` muss eine FLÄCHE gegen
 * ihren ELTERN-Untergrund messen, nicht gegen sich selbst (Fund `design-lead`,
 * bestätigt `reviewer`, Plan `mitglieds-onboarding.md` P5-Nachtrag). Vor der
 * Reparatur brach `effectiveBg(el)` bei einer DECKENDEN Fläche sofort am
 * Element selbst ab (`a === 1`) und lieferte dessen eigene Füllung als
 * „Untergrund" — `fg === bg`, lautlos exakt 1,00:1, unabhängig von der wahren
 * Fläche dahinter.
 *
 * Prüfgegenstand: die deckende Karte des Vereins-Statuten-Schritts
 * (`surface-card`) gegen die Seite dahinter — gemessen (empirisch, nicht
 * gerechnet) `rgb(255,255,255)` auf `rgb(250,250,250)` hell und
 * `rgb(23,23,23)` auf `rgb(10,10,10)` dunkel: zwei unterschiedliche, aber
 * beide DECKENDE Farben. Keine Geschmacksfrage — eine Karte, die sich farblich
 * nicht vom Rand abhöbe, wäre keine Karte, und genau das prüft `bg !== fg`.
 *
 * Kalibriert: die Zeile, die `bg` bei `prop === 'backgroundColor'` vom
 * ELTERN-Element statt vom Element selbst holt, entfernt (`effectiveBg(el)`
 * statt `effectiveBg(el.parentElement)`) → GENAU diese beiden Assertions
 * fallen (`bg` wird zu `fg` identisch, `ratio` wird exakt `1`); alle anderen
 * Tests dieser Datei bleiben unberührt, weil kein anderer Aufrufer
 * `prop: 'backgroundColor'` verwendet.
 */
test('Kontrast-Helfer: `backgroundColor`-Flächen werden gegen den Eltern-Untergrund gemessen, nicht gegen sich selbst', async ({ page }) => {
    await page.addInitScript(() => {
        ;(window as unknown as { __nostrVerein: unknown }).__nostrVerein = {
            api: 'https://verein.e2e-test.invalid',
            proxy: '',
            activationMinutes: 1440,
            publicUrl: 'https://verein.einundzwanzig.space/',
        }
    })
    await useZooid(page)
    await loginNsec(page, NSEC)

    await page.route('**/api/verein/**', (route) => {
        const url = new URL(route.request().url())
        if (url.pathname.endsWith('/config')) {
            return route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    data: {
                        fee: 21,
                        currency: 'EUR',
                        year: 2026,
                        statutes: { url: 'https://verein.e2e-test.invalid/statuten.pdf', version: '3', adopted_at: '2025-01-01' },
                        application: { application_text_max_length: 500, optional_fields: [] },
                    },
                }),
            })
        }
        if (url.pathname.endsWith('/me')) {
            return route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ data: { statutes_accepted_at: null, current_year: { year: 2026, paid: false } } }),
            })
        }
        return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' })
    })

    await page.goto('/verein/beitritt')
    await expect(page.getByTestId('verein-statuten')).toBeVisible({ timeout: 15_000 })

    const [card] = await measure(page, [
        { selector: '[data-testid="verein-statuten"]', label: 'Statuten-Karte (Fläche)', kind: 'graphic', prop: 'backgroundColor' },
    ])

    expect(card.label).toBe('Statuten-Karte (Fläche)')
    expect(card.bg, `bg (${card.bg}) ist die Karte selbst — effectiveBg misst wieder am Element statt am Elternteil`).not.toBe(card.fg)
    expect(card.ratio, 'ratio exakt 1 heisst: Selbstbezug, keine echte Flächenmessung').not.toBe(1)
})
