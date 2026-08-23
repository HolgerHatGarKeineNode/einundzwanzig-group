/**
 * P4 — Befehlspalette (⌘K) und Kürzel-Register.
 *
 * Die Kernfrage des Umzugs: der `⌘K`-Listener saß bis P4 in `js/rail.ts`, an
 * einer Insel, die per `x-if="$store.viewport?.desktop"` nur ab `xl` überhaupt
 * existiert — unterhalb gab es die Taste gar nicht. `js/palette.ts` hängt statt-
 * dessen einmal im Layout (`einundzwanzig.blade.php`, neben `login-sheet`) und
 * lauscht global auf `window`. Ein Grep-Test allein bewiese nur Abwesenheit im
 * Quelltext — deshalb steht hier zusätzlich der Verhaltensbeleg, dass EIN `⌘K`
 * auch wirklich genau EINE Palette öffnet (siehe „Kollision" unten).
 */
import { readFileSync } from 'node:fs'
import { test, expect, type Page } from './support/fixtures'
import { useZooid } from './support/zooid'
import { loginNsec } from './support/login'

const NSEC = process.env.NOSTR_TEST_NSEC as string

const paletteDialog = (page: Page) => page.locator('dialog[data-modal="command-palette"]')
const shortcutsDialog = (page: Page) => page.locator('dialog[data-modal="shortcuts"]')
const paletteInput = (page: Page) => page.locator('[data-palette-input]')
const paletteChip = (page: Page) => page.locator('[data-palette-chip]')
const paletteEmpty = (page: Page) => page.locator('[data-palette-empty]')
const heading = (page: Page, key: string) => page.locator(`[data-palette-heading="${key}"]`)
const section = (page: Page, key: string) => page.locator(`[data-palette-section="${key}"]`)
// Kompakter Attribut-Selektor, wie `_syncHeadings()` selbst ihn liest — NICHT
// `section(...).locator(':not(...)')`: das durchsucht die NACHFAHREN jeder Zeile
// (Icons, Spans) statt die Zeile selbst und liefert dadurch falsch viele Treffer.
const visibleSection = (page: Page, key: string) => page.locator(`[data-palette-section="${key}"]:not([data-hidden])`)

async function openApp(page: Page): Promise<void> {
    await useZooid(page)
    await loginNsec(page, NSEC)
    // `.first()`: ab `xl` trägt sowohl die Rail-Fußzeile als auch die Bühne den
    // Space-Namen — beide „Zooid Test Space", ein striktes `getByText` wäre dort
    // mehrdeutig.
    await expect(page.getByText('Zooid Test Space').first()).toBeVisible({ timeout: 15_000 })
}

/**
 * Der native, IMMER aktuelle Offen-Zustand des `<dialog>` — über zwei `rAF` hinweg
 * gewartet. Anlass: unmittelbar nach einem synchronen Doppel-Toggle (auf→zu in
 * DERSELBEN Task, siehe Kollisions-Test) kann `toBeVisible()`/`getComputedStyle()`
 * für einen einzigen Poll noch die STALE Style-Berechnung von VOR dem zweiten
 * Toggle sehen (`display:block` trotz `open=false`, gemessen). Das `.open`-IDL-
 * Attribut selbst ist nie stale — nur der Abfragezeitpunkt kann es sein.
 */
const paletteIsOpen = (page: Page): Promise<boolean> =>
    page.evaluate(
        () =>
            new Promise<boolean>((resolve) => {
                requestAnimationFrame(() =>
                    requestAnimationFrame(() => {
                        const dialog = document.querySelector('dialog[data-modal="command-palette"]') as HTMLDialogElement | null
                        resolve(dialog?.open ?? false)
                    }),
                )
            }),
    )

/** ⌘K drücken und auf die geöffnete Palette warten — der zentrale Weg hinein. */
async function openPaletteViaKeyboard(page: Page): Promise<void> {
    await page.keyboard.press('Meta+K')
    await expect(paletteDialog(page)).toBeVisible({ timeout: 10_000 })
}

// ── Grep-Nachweis ────────────────────────────────────────────────────────────

test('Grep-Nachweis: js/rail.ts trägt keinen ⌘K-Zweig mehr, js/palette.ts übernimmt ihn', () => {
    const rail = readFileSync('packages/einundzwanzig-group/js/rail.ts', 'utf8')
    const palette = readFileSync('packages/einundzwanzig-group/js/palette.ts', 'utf8')

    // Muster des alten Handlers: (metaKey||ctrlKey) + key 'k'. Fehlt in rail.ts, UND
    // steht nachweislich in palette.ts — eine Kontrollgruppe, sonst bewiese ein
    // versehentlich GANZ gelöschter Handler (keine Palette, kein ⌘K nirgends)
    // dasselbe „rail.ts ist sauber", ohne dass ⌘K noch funktioniert.
    const cmdKPattern = /e\.key\.toLowerCase\(\)\s*===\s*'k'/
    expect(cmdKPattern.test(rail), 'rail.ts darf keinen ⌘K-Zweig mehr registrieren').toBe(false)
    expect(cmdKPattern.test(palette), 'Kontrollgruppe: der Handler muss irgendwo stehen').toBe(true)
})

// ── ⌘K auf jeder Viewport-Breite (DoD 1) ────────────────────────────────────

test.describe('⌘K öffnet auf jeder Viewport-Breite', () => {
    for (const [label, size] of Object.entries({
        mobil: { width: 390, height: 844 },
        // Default-Projektbreite (1279) — UNTERHALB xl (1280): genau der Fall, der vor
        // P4 gar kein ⌘K kannte, weil der Handler an der `x-if`-Rail hing.
        'unterhalb xl (Standardprojekt)': { width: 1279, height: 800 },
        'ab xl (Desktop-Rail vorhanden)': { width: 1440, height: 900 },
    })) {
        test(`${label} (${size.width}×${size.height})`, async ({ page }) => {
            await page.setViewportSize(size)
            await openApp(page)
            await openPaletteViaKeyboard(page)
            await expect(paletteInput(page)).toBeFocused()
        })
    }
})

// ── Die ⌘K-Kollision mit der Rail: EIN Tastendruck, EINE Palette (DoD 2) ────

test('⌘K löst genau EINE Öffnung aus, nicht zwei gegenläufige (Kollisions-Regression)', async ({ page }) => {
    // Wären zwei Handler registriert (Rail UND Palette, der Zustand vor dem Umzug),
    // riefe EIN Tastendruck `toggle()` effektiv zweimal auf — die Palette ginge
    // netto NICHT auf (offen→zu in derselben Runde). Genau das ist die beobachtbare
    // Signatur eines doppelten Handlers: bleibt sie nach einem einzelnen Druck zu,
    // steckt ein zweiter Handler dahinter.
    await page.setViewportSize({ width: 1440, height: 900 })
    await openApp(page)

    await page.keyboard.press('Meta+K')
    await expect.poll(() => paletteIsOpen(page), { timeout: 10_000 }).toBe(true)
    // Nur EIN Palette-Knoten existiert überhaupt — sie ist einmal im Layout montiert.
    await expect(paletteDialog(page)).toHaveCount(1)

    // Zweiter Druck schließt wieder (reines Toggle-Verhalten EINES Handlers).
    await page.keyboard.press('Meta+K')
    await expect.poll(() => paletteIsOpen(page), { timeout: 10_000 }).toBe(false)

    // Und ein dritter öffnet erneut — kein Handler „verbraucht", kein hängender Zustand.
    await page.keyboard.press('Meta+K')
    await expect.poll(() => paletteIsOpen(page), { timeout: 10_000 }).toBe(true)
})

// ── Öffnen/Schließen: Esc, Klick außerhalb ──────────────────────────────────

test('Esc schließt die Palette', async ({ page }) => {
    await openApp(page)
    await openPaletteViaKeyboard(page)

    await page.keyboard.press('Escape')
    await expect(paletteDialog(page)).toBeHidden({ timeout: 10_000 })
})

test('Klick außerhalb der Karte schließt die Palette', async ({ page }) => {
    // Ab `sm` (640px) ist die Karte ein zentrierter Block, kein Vollbild-Sheet —
    // erst dann existiert überhaupt ein „außerhalb". Default-Projektbreite reicht.
    await openApp(page)
    await openPaletteViaKeyboard(page)

    // Klick auf den nativen ::backdrop des <dialog> — Seitenkoordinaten, nicht
    // relativ zur Karte, sonst träfe der Klick die Karte selbst.
    await page.mouse.click(5, 5)
    await expect(paletteDialog(page)).toBeHidden({ timeout: 10_000 })
})

// ── Pfeil + Enter wählt (DoD Test-Strategie) ────────────────────────────────

test('Pfeil runter + Enter öffnet die markierte Raumzeile und navigiert dorthin', async ({ page }) => {
    await openApp(page)
    await openPaletteViaKeyboard(page)

    /*
     * VORBEDINGUNG, kein Zeitpolster.
     *
     * Flux markiert beim Öffnen bereits die ERSTE Option (`data-active`) — `ArrowDown`
     * rückt also auf die ZWEITE. Die Überschrift „Räume" erscheint aber schon, sobald
     * EINE Raumzeile steht (`_syncHeadings` leitet sie aus Flux' `[data-hidden]` ab),
     * und die Raumliste kommt asynchron vom Relay. Steht in diesem Moment erst eine
     * einzige Raumzeile, ist die zweite Option die erste AKTION („Alle Räume &
     * Entdecken" → `/spaces`): die Palette schließt, ein Raum wird nie geöffnet, und
     * der Composer, auf den unten gewartet wird, kann gar nicht erscheinen.
     *
     * Genau daran fiel dieser Test unter Parallel-Last. Gemessen (12 Läufe, 6 Worker,
     * 2026-08-23): die Überschrift steht nach ~370–880 ms mit 1 bis 5 Zeilen, die volle
     * Liste erst 15–200 ms später — in 2 von 12 Fällen mit genau EINER Zeile zum
     * Zeitpunkt der Überschrift.
     *
     * `recentRooms()` kappt den Ruhezustand bei fünf und der Seed hat zehn beigetretene
     * Räume: fünf sichtbare Zeilen sind damit der VOLLE Endzustand, nicht eine
     * willkürliche Schwelle — mehr kann nicht nachkommen (in denselben 12 Läufen stand
     * die Liste 3 s später unverändert auf 5).
     *
     * ZWEITE HÄLFTE derselben Vorbedingung, und sie ist NICHT dieselbe Zahl: gewartet
     * wird auf fünf BEIGETRETENE Zeilen, nicht auf fünf Zeilen.
     *
     * `recentRooms()` stellt Beigetretene nach vorn und füllt danach mit ENTDECKBAREN
     * auf — eine halbleere Liste wäre schlechter als eine, die etwas anbietet. Solange
     * die Mitgliedschaften (39002) unterwegs sind, ist aber KEIN Raum als beigetreten
     * bekannt, und die Liste besteht dann rein aus der Aktivitätsreihenfolge aller
     * Räume. Der Seed hält fünf Räume, denen der Testnutzer NIE beitritt (`dev`, `vip`
     * und die drei Meetup-Räume, siehe `zooid-testserver.sh`: 9021 nur für die anderen
     * zehn). Landet einer davon auf Platz zwei, öffnet ↵ ihn korrekt — und dort steht
     * das Beitritts-Gate statt des Composers (`⚡room.blade.php`:
     * `x-show="membershipReady && joined && !isForum"`). Genau diese Signatur — Palette
     * zu, Navigation greift, Composer kommt nie — riss den Test nach dem ersten Fix
     * weiter.
     *
     * Gemessen in einem vollen Lauf mit 12 eingestreuten Proben (2026-08-23): in 9 von
     * 12 standen NICHT beigetretene Räume in den Top-5, darunter `dev` und drei
     * Meetup-Räume; zweimal auf Platz drei, also einen Platz neben der Markierung.
     *
     * Mit fünf beigetretenen Zeilen ist die Kappung erreicht und jede der fünf Zeilen
     * beigetreten — ↓ kann dann gar nicht mehr in einem Gate landen.
     */
    await expect(heading(page, 'rooms')).toBeVisible({ timeout: 10_000 })
    await expect(visibleSection(page, 'rooms')).toHaveCount(5, { timeout: 15_000 })
    await expect(
        page.locator('[data-palette-section="rooms"]:not([data-hidden])[data-palette-joined="true"]'),
        'die Ruheliste muss die BEIGETRETENEN Räume zeigen, nicht die Aktivitätsreihenfolge aller',
    ).toHaveCount(5, { timeout: 15_000 })

    await page.keyboard.press('ArrowDown')

    /*
     * Die Markierung steht nach ↓ auf einer RAUMZEILE — das ist der Zustand, den der
     * Test fangen soll, und er wird hier direkt geprüft statt erst 15 s später am
     * ausbleibenden Composer. Sprang die Markierung in die Aktionen-Sektion (der
     * Fehler oben), fällt es hier in gut einer Sekunde auf, mit dem richtigen Namen.
     *
     * Auf WELCHEM Raum sie steht, wird bewusst NICHT festgeschrieben: der Ruhezustand
     * ist nach jüngster Aktivität sortiert, und `lastMessageAt` trifft nach der
     * Raumliste ein — die Reihenfolge kann sich also noch einmal umsortieren, wobei
     * Flux' (positionsbasierte) Markierung auf die erste Option zurückfällt. Genau das
     * ist beim Bau dieses Fixes einmal in 12 Parallel-Läufen passiert (markiert war
     * `edit`, geöffnet wurde `general`). Sicher ist dabei nur, was der Vertrag auch
     * hergibt: mit fünf Raumzeilen an der Spitze führt jede Rückstellung wieder auf
     * eine Raumzeile, nie in die Aktionen. Ein Test auf den konkreten Raum wäre ein
     * Test auf die Sortier-Laufzeit, nicht auf die Tastaturauswahl.
     */
    const markiert = page.locator('[data-palette-section="rooms"][data-active]')
    await expect(markiert, 'nach ↓ muss die Markierung auf einer Raumzeile stehen').toHaveCount(1)
    // …und auf einer BEIGETRETENEN. Sonst führt ↵ in einen Raum, der statt des
    // Composers das Beitritts-Gate zeigt — das fiele sonst erst 15 s später auf,
    // und zwar mit einer Fehlermeldung („Composer nicht sichtbar"), die auf den
    // Composer zeigt statt auf die Mitgliedschaft.
    await expect(markiert, 'die markierte Raumzeile muss beigetreten sein').toHaveAttribute(
        'data-palette-joined',
        'true',
    )

    await page.keyboard.press('Enter')

    // Palette schließt sich, und die Navigation griff (ein Raum wurde geöffnet —
    // erkennbar am Chat-Composer, den es nur in einem Raum gibt).
    await expect(paletteDialog(page)).toBeHidden({ timeout: 10_000 })
    await expect(page.getByPlaceholder('Nachricht schreiben…')).toBeVisible({ timeout: 15_000 })
    // `^/rooms/.+` statt `/\/rooms\//`: der Pfad muss AUF einen Raum zeigen, nicht ihn
    // nur irgendwo enthalten — `/spaces` (das Ziel der ersten Aktion, in das dieser
    // Test fiel) hätte einen Teilstring-Test nie ausgelöst, eine künftige
    // Zwischenseite wie `/x?next=/rooms/y` aber sehr wohl.
    expect(new URL(page.url()).pathname).toMatch(/^\/rooms\/.+/)
})

// ── Treffer über die Sektionen; nie leer (DoD 4) ────────────────────────────

test('Ohne Eingabe: Räume + Aktionen, nie leer — Mitglieder/Spaces erst mit Eingabe', async ({ page }) => {
    await openApp(page)
    await openPaletteViaKeyboard(page)

    await expect(heading(page, 'rooms')).toBeVisible({ timeout: 10_000 })
    await expect(heading(page, 'actions')).toBeVisible()
    await expect(heading(page, 'members')).toBeHidden()
    await expect(heading(page, 'spaces')).toBeHidden()

    // Der Ruhezustand zeigt die zuletzt benutzten Räume (nicht zwingend „welcome" —
    // der Testnutzer ist knapp einem Dutzend Räumen beigetreten, `recentRooms` kappt
    // auf 5 nach Aktivität; welcher das konkret ist, ist hier nicht die Frage).
    // Geprüft wird `roomItems.length` INDIREKT über eine sichtbare Zeile mit
    // Raum-Kennung — „nie leer" ist der Vertrag, nicht ein bestimmter Name.
    await expect(visibleSection(page, 'rooms').first()).toBeVisible({ timeout: 10_000 })
    expect(await visibleSection(page, 'rooms').count(), 'der Ruhezustand darf nicht leer sein').toBeGreaterThan(0)
    await expect(section(page, 'actions').getByText('Wallet', { exact: true })).toBeVisible()
    await expect(paletteEmpty(page)).toBeHidden()
})

test('Mit Eingabe: alle vier Sektionen, feste Reihenfolge Räume · Mitglieder · Spaces · Aktionen', async ({ page }) => {
    await openApp(page)
    await openPaletteViaKeyboard(page)

    // Ein Buchstabe, der in Treffern jeder Sektion vorkommt: "e" steckt in
    // "Willkommen" (Raum), "Relay Admin" (Mitglied), "localhost" (Space-Hint) und
    // "Einstellungen" (Aktion).
    await paletteInput(page).fill('e')

    await expect(heading(page, 'rooms')).toBeVisible({ timeout: 10_000 })
    await expect(heading(page, 'members')).toBeVisible()
    await expect(heading(page, 'spaces')).toBeVisible()
    await expect(heading(page, 'actions')).toBeVisible()

    // Reihenfolge im DOM (nicht nur Sichtbarkeit): Räume vor Mitgliedern vor
    // Spaces vor Aktionen.
    const order = await page
        .locator('[data-palette-heading]')
        .evaluateAll((els) => els.map((el) => el.getAttribute('data-palette-heading')))
    expect(order).toEqual(['rooms', 'members', 'spaces', 'actions'])
})

test('Treffer: Räume, Mitglieder und Aktionen liefern konkrete, benannte Zeilen', async ({ page }) => {
    await openApp(page)
    await openPaletteViaKeyboard(page)

    // Räume — über den Scope „r:" eingegrenzt.
    await paletteInput(page).fill('r:willkommen')
    await expect(section(page, 'rooms').getByText('Willkommen', { exact: true })).toBeVisible({ timeout: 10_000 })

    // Den Scope über den Chip lösen (der einzige Weg, den ein leeres Feld ALLEIN
    // nicht schafft — Leeren des Texts nimmt den Scope bewusst nicht mit,
    // `onEscape()`/der Chip-Klick sind die vorgesehenen Wege).
    await paletteChip(page).click()
    await expect(paletteChip(page)).toBeHidden()

    // Mitglieder — geseedet ist „Alice Test".
    await paletteInput(page).fill('@alice')
    await expect(section(page, 'members').getByText('Alice Test', { exact: true })).toBeVisible({ timeout: 10_000 })

    await paletteChip(page).click()
    await expect(paletteChip(page)).toBeHidden()

    // Aktionen.
    await paletteInput(page).fill('>wallet')
    await expect(section(page, 'actions').getByText('Wallet', { exact: true })).toBeVisible({ timeout: 10_000 })
})

// ── parseScope-Präfixe grenzen ein UND werden aus dem Feld gehoben (DoD 5) ──

test('Scope-Präfixe r: m: p: w: @ > heben in den Chip — Flux filtert sonst wörtlich auf den Präfix', async ({ page }) => {
    await openApp(page)
    await openPaletteViaKeyboard(page)

    // "r:" — Räume.
    await paletteInput(page).fill('r:')
    await expect(paletteChip(page)).toBeVisible({ timeout: 10_000 })
    await expect(paletteChip(page)).toContainText('Räume')
    expect(await paletteInput(page).inputValue(), 'der Präfix darf NICHT im Feld stehen bleiben').toBe('')
    await expect(heading(page, 'rooms')).toBeVisible()

    // "m:" — Meetups (eigene Rail-Gruppe, als Chip „Meetups").
    await paletteInput(page).fill('m:')
    await expect(paletteChip(page)).toContainText('Meetups')
    expect(await paletteInput(page).inputValue()).toBe('')
    await expect(section(page, 'rooms').getByText('Meetup Berlin', { exact: true })).toBeVisible({ timeout: 10_000 })

    // "p:" — Projektunterstützung. Der Seed trägt KEINEN solchen Raum — echter
    // Leerzustand, siehe eigener Test unten.
    await paletteInput(page).fill('p:')
    await expect(paletteChip(page)).toContainText('Projektunterstützung')
    expect(await paletteInput(page).inputValue()).toBe('')

    // "w:" — Workspace (im Test deaktiviert, siehe useZooid) — Chip greift trotzdem,
    // auch ohne dass eine Zeile erscheint.
    await paletteInput(page).fill('w:')
    await expect(paletteChip(page)).toContainText('Workspace')
    expect(await paletteInput(page).inputValue()).toBe('')

    // "@" — Mitglieder.
    await paletteInput(page).fill('@')
    await expect(paletteChip(page)).toContainText('Mitglieder')
    expect(await paletteInput(page).inputValue()).toBe('')
    await expect(section(page, 'members').getByText('Alice Test', { exact: true })).toBeVisible({ timeout: 10_000 })

    // ">" — Aktionen.
    await paletteInput(page).fill('>')
    await expect(paletteChip(page)).toContainText('Aktionen')
    expect(await paletteInput(page).inputValue()).toBe('')
    await expect(section(page, 'actions').getByText('Wallet', { exact: true })).toBeVisible({ timeout: 10_000 })
})

test('Ländercode grenzt zusätzlich zur Gruppe ein: de: zeigt Berlin/Hamburg, nicht Wien', async ({ page }) => {
    await openApp(page)
    await openPaletteViaKeyboard(page)

    await paletteInput(page).fill('de:')
    await expect(paletteChip(page)).toContainText('Deutschland')
    expect(await paletteInput(page).inputValue()).toBe('')

    await expect(section(page, 'rooms').getByText('Meetup Berlin', { exact: true })).toBeVisible({ timeout: 10_000 })
    await expect(section(page, 'rooms').getByText('Meetup Hamburg', { exact: true })).toBeVisible()
    await expect(section(page, 'rooms').getByText('Meetup Wien', { exact: true })).toHaveCount(0)
})

// ── Der Leerzustand ist echt (DoD 8, Regression des Flux-Fehlers) ──────────

test('"Nichts gefunden." erscheint NUR, wenn wirklich keine Zeile sichtbar ist — nicht bei gleichbleibendem Text', async ({ page }) => {
    await openApp(page)
    await openPaletteViaKeyboard(page)

    // Startzustand: leer/leer, Leerzustand ist verdeckt, Räume+Aktionen stehen.
    await expect(paletteEmpty(page)).toBeHidden()

    // Der historische Fehler: Flux' eigener Leerzustand hängt an einer ÄNDERUNG des
    // SUCHTEXTS (`filterable.onChange`). Unsere Zeilen entstehen aber aus Alpine bei
    // GLEICHEM Text — hier: das Feld ist vor UND nach dem Tippen von "@" wieder leer
    // (lift() räumt den Sigel sofort weg), während die Sektion von „Räume+Aktionen"
    // auf „Mitglieder" wechselt. Vor dem Fix stand „Nichts gefunden." über den echten
    // Mitglieder-Zeilen.
    await paletteInput(page).pressSequentially('@')
    await expect(paletteChip(page)).toContainText('Mitglieder', { timeout: 10_000 })
    expect(await paletteInput(page).inputValue()).toBe('')
    await expect(section(page, 'members').getByText('Alice Test', { exact: true })).toBeVisible({ timeout: 10_000 })
    await expect(paletteEmpty(page)).toBeHidden()

    // Die Gegenprobe: ein WIRKLICH leeres Ergebnis (kein Mitglied "zzzznonexistent")
    // muss den Leerzustand zeigen und KEINE Zeile.
    await paletteInput(page).fill('zzzznonexistentxx')
    await expect(paletteEmpty(page)).toBeVisible({ timeout: 10_000 })
    await expect(visibleSection(page, 'members')).toHaveCount(0)

    // Und die zweite echte Leere: "p:" (Projektunterstützung) — der Seed trägt
    // keinen solchen Raum, dieselbe Grammatik-Stelle wie oben (Text nach dem Lift
    // wieder leer), diesmal aber mit tatsächlich null Treffern.
    await paletteInput(page).fill('')
    await paletteInput(page).pressSequentially('p:')
    await expect(paletteChip(page)).toContainText('Projektunterstützung', { timeout: 10_000 })
    await expect(paletteEmpty(page)).toBeVisible({ timeout: 10_000 })
    await expect(visibleSection(page, 'rooms')).toHaveCount(0)
})

// ── `?` öffnet die Hilfe nur ohne Textfokus (DoD 6) ─────────────────────────

test('? öffnet das Kürzel-Register NICHT während ein Textfeld fokussiert ist, sonst schon', async ({ page }) => {
    await openApp(page)

    // Fokus im Palette-Suchfeld: "?" muss dort tippbar bleiben.
    await openPaletteViaKeyboard(page)
    await expect(paletteInput(page)).toBeFocused()
    await page.keyboard.press('?')
    await expect(shortcutsDialog(page)).toBeHidden()
    expect(await paletteInput(page).inputValue()).toBe('?')

    await page.keyboard.press('Escape') // Text leeren
    await page.keyboard.press('Escape') // Palette schließen
    await expect(paletteDialog(page)).toBeHidden({ timeout: 10_000 })

    // Kein Textfeld fokussiert: "?" öffnet jetzt die Übersicht.
    await page.locator('body').click({ position: { x: 5, y: 5 } })
    await page.keyboard.press('?')
    await expect(shortcutsDialog(page)).toBeVisible({ timeout: 10_000 })
})

// ── Alt+↑/↓ bleibt unverändert (DoD 3, Regressionsgefahr des Umzugs) ────────

test('Alt+↑/↓ wechselt weiterhin den Raum über die Rail (unverändert von P4)', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await openApp(page)
    await expect(page.locator('[data-rail]')).toBeVisible({ timeout: 20_000 })

    await page.goto('/rooms/welcome')
    await expect(page.getByRole('heading', { name: /Willkommen/ })).toBeVisible({ timeout: 15_000 })

    // **Behälter statt Inhalt — dieselbe Falle wie oben (Zeile 150 ff.).** `[data-rail]`
    // ist sofort da; die Raumliste, aus der `railTargets` das Sprungziel von Alt+↓
    // berechnet, kommt asynchron vom Relay nach. Drückt der Test in dieses Fenster,
    // ist „welcome" der einzige bekannte Raum und Alt+↓ hat kein zweites Ziel. Gewartet
    // wird deshalb auf eine ZWEITE, tatsächlich gerenderte Raumzeile (der Seed hat
    // „Allgemein" fest unter den zehn beigetretenen Räumen, siehe zooid-testserver.sh).
    await expect(page.getByRole('button', { name: 'Allgemein' })).toBeVisible({ timeout: 15_000 })

    await page.keyboard.press('Alt+ArrowDown')
    await expect(page).toHaveURL(/\/rooms\/(?!welcome$)/, { timeout: 10_000 })
})

// ── Mobil: Lupe öffnet das Sheet, Kürzel-Zeile aus, kein ⌘K-Versprechen (DoD 7) ─

test.describe('Mobil', () => {
    test.use({ viewport: { width: 390, height: 844 } })

    test('Die Lupe in der Bottom-Nav öffnet das Vollbild-Sheet', async ({ page }) => {
        await openApp(page)

        await expect(page.locator('[data-rail]')).toHaveCount(0)
        await page.locator('[data-palette-open]').click()
        await expect(paletteDialog(page)).toBeVisible({ timeout: 10_000 })
        await expect(paletteInput(page)).toBeFocused()
    })

    test('Kein ⌘K-Versprechen: kein Rail-Kürzel, keine Kürzel-Zeile in der Palette', async ({ page }) => {
        await openApp(page)

        await expect(page.locator('[aria-keyshortcuts="Meta+K Control+K"]')).toHaveCount(0)

        await page.locator('[data-palette-open]').click()
        await expect(paletteDialog(page)).toBeVisible({ timeout: 10_000 })
        // Die Kürzel-Zeile (↑↓ · ↵ · Esc · ?) ist ab `xl` sichtbar — unterhalb aus.
        // Über den Begleittext statt das Symbol: „↑" matcht sonst mehrdeutig, und ohne
        // `exact` träfe es zusätzlich „In der Palette navigieren" im (geschlossenen)
        // Register-Modal.
        await expect(page.getByText('Navigieren', { exact: true })).toBeHidden()
    })
})

// ── Register ohne Duplikate (DoD 9) ─────────────────────────────────────────

test('Kürzel-Register: keine Tastenkombination steht zweimal mit unterschiedlicher Bedeutung', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await openApp(page)

    await page.locator('body').click({ position: { x: 5, y: 5 } })
    await page.keyboard.press('?')
    await expect(shortcutsDialog(page)).toBeVisible({ timeout: 10_000 })

    const rows = shortcutsDialog(page).locator('dl > div')
    const rowCount = await rows.count()
    expect(rowCount, 'das Register darf nicht leer sein').toBeGreaterThan(0)

    const combos = await rows.evaluateAll((els) =>
        els.map((el) => Array.from(el.querySelectorAll('dd kbd')).map((k) => k.textContent?.trim()).join('+')),
    )
    expect(combos.every((c) => c.length > 0), 'jede Zeile muss mindestens eine Taste tragen').toBe(true)
    expect(new Set(combos).size, `Duplikate in: ${JSON.stringify(combos)}`).toBe(combos.length)
})

// ── Theme-Parität: Palette trägt in jedem Modus denselben Grund wie die Karte ──
//
// Anlass (Bauauftrag Schritt 9): die Flux-Stubs verdrahten `flux:command.items`/
// `command.input` fest auf `bg-white dark:bg-zinc-700` — heller als der App-Grund
// `dark:bg-zinc-900`. Der Patch zieht beide per `class` auf die Karten-Werte.
// Ein reiner Blick aufs Markup beweist nicht, was der BROWSER daraus berechnet
// (Spezifität, `!`-Utilities, Stub-Reihenfolge) — deshalb hier `getComputedStyle`.

/** Card/Items/Input-Hintergrund als vom Browser BERECHNETE Werte (rgb(...)). */
async function paletteBackgroundColors(page: Page): Promise<{ card: string; items: string; input: string }> {
    return page.evaluate(() => {
        const bg = (sel: string): string => {
            const el = document.querySelector(sel)
            return el ? getComputedStyle(el).backgroundColor : ''
        }

        return {
            card: bg('[data-palette-card]'),
            items: bg('[data-palette-items]'),
            input: bg('[data-palette-input]'),
        }
    })
}

/** Theme über die Einstellungen setzen (wie `theme.spec.ts`), dann zur Palette. */
async function setThemeAndOpenPalette(page: Page, radioLabel: 'Hell' | 'Dunkel' | 'Automatisch'): Promise<void> {
    await page.goto('/settings/space')
    await expect(page.getByRole('heading', { name: 'Darstellung' })).toBeVisible({ timeout: 15_000 })
    await page.locator(`ui-radio[aria-label="${radioLabel}"]`).click()

    // Persistiert über `flux.appearance` (localStorage) + flackerfreies Head-Skript
    // (`@fluxAppearance`) — ein voller Seitenwechsel reicht, kein Reload nötig.
    await page.goto('/spaces')
    await expect(page.getByText('Zooid Test Space').first()).toBeVisible({ timeout: 15_000 })
    await openPaletteViaKeyboard(page)
}

test.describe('Theme-Parität: getComputedStyle, nicht Augenschein', () => {
    test('Hell', async ({ page }) => {
        await openApp(page)
        await setThemeAndOpenPalette(page, 'Hell')
        await expect(page.locator('html')).not.toHaveClass(/dark/)

        const { card, items, input } = await paletteBackgroundColors(page)
        expect(items, `items ${items} ≠ card ${card}`).toBe(card)
        expect(input, `input ${input} ≠ card ${card}`).toBe(card)
    })

    test('Dunkel', async ({ page }) => {
        await openApp(page)
        await setThemeAndOpenPalette(page, 'Dunkel')
        await expect(page.locator('html')).toHaveClass(/dark/)

        const { card, items, input } = await paletteBackgroundColors(page)
        expect(items, `items ${items} ≠ card ${card}`).toBe(card)
        expect(input, `input ${input} ≠ card ${card}`).toBe(card)
    })

    test('Automatisch, OS auf Dunkel', async ({ page }) => {
        // VOR dem ersten Laden setzen: das flackerfreie Head-Skript liest
        // `prefers-color-scheme` beim ersten Paint.
        await page.emulateMedia({ colorScheme: 'dark' })
        await openApp(page)
        await setThemeAndOpenPalette(page, 'Automatisch')
        // Vorbedingung scharf halten: der Fall testet nur dann „System = dunkel",
        // wenn `.dark` hier auch wirklich aus dem OS-Signal kam, nicht zufällig aus
        // einem stehengebliebenen `flux.appearance=dark` von einem Vorlauf.
        await expect(page.locator('html'), 'OS-Emulation muss als .dark ankommen').toHaveClass(/dark/)

        const { card, items, input } = await paletteBackgroundColors(page)
        expect(items, `items ${items} ≠ card ${card}`).toBe(card)
        expect(input, `input ${input} ≠ card ${card}`).toBe(card)
    })
})
