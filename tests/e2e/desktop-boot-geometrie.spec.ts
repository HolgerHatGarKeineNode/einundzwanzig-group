/**
 * **Die Bühne steht vom ERSTEN Paint an an ihrem Platz** — der Beweis am lebenden
 * Element, `/articles` bei 1440 px.
 *
 * ── Der Fehler, den diese Datei festnagelt ──────────────────────────────────────────
 *
 * Das Chassis (`app-frame.blade.php`) ist ab `xl` ein Grid mit
 * `grid-cols-[20rem_minmax(0,1fr)]`. Die Rail steht in einem
 * `<template x-if="$store.viewport?.desktop">` und existiert vor dem Alpine-Boot NICHT
 * als DOM-Knoten. Die Bühne war damit das erste Kind im Fluss und wurde per
 * Auto-Placement in Spur 1 gelegt — in die 20 rem des Navigators.
 *
 * ── Die Messreihe, und WOHER jede Zeile stammt ─────────────────────────────────────
 * Diese Datei ist die EINZIGE Stelle, an der die Reihe steht; `rail-skelett.blade.php`
 * und `app-frame.blade.php` verweisen hierher, statt sie zu wiederholen. Eine Zahl an
 * drei Orten ist an zweien falsch, sobald jemand einen korrigiert — genau das ist in
 * dieser Arbeit passiert.
 *
 * **Die Spalten „vorher/nachher" stammen aus einem datierten Lauf** (2026-08-21,
 * Playwright, eigenes Wegwerf-Instrument: rAF-Sampler + PerformanceObserver, JS-Antwort
 * um 600 ms verzögert, 1440×900, je fünf Läufe). Sie sind hier NICHT reproduzierbar —
 * kein Test misst Millisekunden. **Reproduzierbar sind die Geometriezeilen**: `#buehne`,
 * die Ortskarte und die Blockhöhen weiter unten stehen in den Tests dieser Datei als
 * Literal und werden bei jedem Lauf nachgeprüft.
 *
 * | | vorher | nachher |
 * |---|---|---|
 * | Frames mit falscher Bühnenbreite | 35–36 von ~176 | **0 von ~176** |
 * | Dauer des kaputten Fensters | **830–837 ms** | **0 ms** |
 * | dasselbe ungedrosselt | 310 ms (3–4 Frames) | 0 ms |
 * | `#buehne` (Test) | 320 px @ x=0 | 1120 px @ x=320 |
 * | Ortskarte / Beschriftung (Test) | 80 px / „C…" | volle Breite, ungekürzt |
 * | CLS | **0,3865** | **0,0124–0,0168** (10 Läufe) |
 * | 1279 px (unter `xl`, Kontrolle) | 0 Frames / CLS 0 | unverändert |
 *
 * Die CLS-Spanne deckt die VOLLE eigene Messreihe: zehn Läufe bei 1440 px (fünf mit
 * verzögertem JS, fünf ungedrosselt), Minimum 0,0124, Maximum 0,0168. Hier stand
 * zwischenzeitlich „0,0124–0,0161" — der letzte Wert der eigenen Reihe lag außerhalb,
 * und ein Lauf, der die Spanne reißt, wäre dann der nächsten Änderung angelastet worden
 * statt der Streuung.
 *
 * Der Rest-CLS von 0,016 liegt vollständig INNERHALB der Rail (ihre Raumliste trifft vom
 * Relay ein) — die Layout-Shift-Einträge benennen `DIV.min-h-0 flex-1 overflow-y-auto`,
 * `A.pressable mt-1 … min-h-9` und `SECTION.pt-2`. Die Bühne kommt darin nicht mehr vor.
 *
 * **Und was CLS hier NICHT sieht:** den Austausch selbst. Platzhalter und Rail sind
 * verschiedene Knoten — der eine verschwindet, der andere erscheint —, und die
 * Layout-Shift-API zählt nur Elemente, die zwischen zwei Frames UMZIEHEN. Ein
 * Größenunterschied zwischen beiden bliebe im CLS also unsichtbar und wäre trotzdem zu
 * sehen. Deshalb misst der Blockvergleich unten die Höhen direkt und verlässt sich für
 * diese Zusage nicht auf die Kennzahl.
 *
 * ── Die Blockhöhen der Rail sind KONFIGURATIONSABHÄNGIG ─────────────────────────────
 * Kopf · Suchfeld · Liste · Fußzeile bei 1440×900:
 *
 * | Lage | Kopf | Suchfeld | Liste | Fußzeile |
 * |---|---|---|---|---|
 * | mit `workspace_url`, Space ungeladen | 60 | 36 | 456 | 340 |
 * | ohne `workspace_url`, Space ungeladen | 60 | 36 | 494 | **302** |
 * | mit `workspace_url`, Space MIT Beschreibung | **64** | 36 | **452** | 340 |
 *
 * RE-MEASURED 2026-09-05: another 38 px moved from the list into the footer (302 → 340
 * with a workspace, 264 → 302 without). The cause is a FOURTH area row, „Verschlüsselt"
 * — the fixed place in the chrome for `/messages`, added next to „Lesezeichen" because
 * the screen had none and a user went looking for it in vain. Unlike the P2 case below,
 * `rail-skelett.blade.php` was changed in the SAME edit, so `rail).toEqual(platzhalter)`
 * never went red: only the four literals moved, and both sides were measured afresh.
 *
 * RE-MEASURED 2026-09-04: the footer grew by 38 px (264 → 302 with a workspace,
 * 226 → 264 without), the list gave the same 38 px back. The cause is a THIRD area
 * row in the rail footer — „Lesezeichen", added by P2 of this plan next to „Artikel"
 * and „Forge". `rail-skelett.blade.php` had kept reserving two, so the rail and its
 * placeholder disagreed by exactly one `min-h-9` row plus its `mt-0.5`: a 38 px jump
 * at boot, the very failure this whole file is written against. The placeholder now
 * renders three rows (two without a workspace) and the numbers above are the fresh
 * measurement of BOTH sides, not a correction of the expectation alone.
 *
 * Die dritte Zeile stand bis 2026-08-26 als `64,8 | 36 | 527,2` da. Die Nachkomma-
 * stelle kam aus der Beschreibungszeile in `text-[0.7rem]` (Zeilenbox 16,8 px); die
 * Typo-Leiter aus P4 hat sie auf `text-xs` (16 px) gelegt, und damit sind alle Höhen
 * dieser Fläche ganzzahlig.
 *
 * Alle drei werden hier gemessen. Die zweite Lage braucht einen EIGENEN `serve` ohne
 * `NOSTR_WORKSPACE_URL` (Fixture unten): ob die Forge-Zeile existiert, entscheidet der
 * Server beim Rendern, eine DOM-Simulation prüfte das nicht.
 *
 * ── Warum diese Datei `desktop-*` heißen MUSS ───────────────────────────────────────
 * Das Projekt `chromium` ist auf 1279 px gepinnt und ignoriert `desktop-*`; nur das
 * Projekt `desktop` fährt 1440×900. Unterhalb von `xl` gibt es weder Grid noch Rail —
 * ein Test darunter wäre grün und hätte nichts geprüft. Genau deshalb steht die
 * 1279-px-Kontrolle unten mit einem eigenen `setViewportSize`.
 *
 * ── Warum die Messung das JS DROSSELT und nicht die CPU ─────────────────────────────
 * CPU-Drosselung verlangsamt den ersten Paint UND den Boot. Bei ×4 lag die gemessene FCP
 * (1156 ms) NACH der Rail-Einfügung (1013 ms): der Browser hatte noch gar nicht gemalt,
 * als Alpine fertig war, und das Flackern verschwand im MESSGERÄT statt in der
 * Anwendung. Gedrosselt wird deshalb die Ursache — die Antwort des JS-Bündels. HTML und
 * CSS gehen mit voller Geschwindigkeit durch, der Browser malt sofort, das Modul kommt
 * später. Deterministisch und nah am realen Fehler (Download + Parse + Ausführung).
 *
 * ── Warum `board-fixtures` und nicht `fixtures` ─────────────────────────────────────
 * Vier der fünf Tests messen die SHELL und bräuchten keinen Artikel. Sie brauchen aber
 * den `serve` mit gesetzter `NOSTR_BOARD_URL`: ohne die rendert `/articles`
 * server-seitig seinen „keine Quelle"-Leerzustand, und das Lade-Skelett, gegen das hier
 * gemessen wird, entsteht gar nicht erst. Der fünfte Test (Lade-Skelett gegen fertige
 * Liste) sät zusätzlich sechs Artikel — ohne Bestand bliebe `isEmpty()` wahr, der
 * Filterkopf erschiene nie und der Vergleich hätte keinen zweiten Wert.
 */
import { test as boardTest, expect, type Page } from './support/board-fixtures'
import { useZooid } from './support/zooid'
import { loginNsec } from './support/login'
import { cleanupArticles, publishArticle } from './support/articles'
import { testServerEnv } from './support/serverEnv'
import { spawn, type ChildProcess } from 'node:child_process'

/**
 * `E2E_SLOT_OFFSET` verschiebt alle Portbereiche eines Laufs, damit zwei Läufe auf
 * derselben Maschine einander nicht die Relays abräumen.
 *
 * **Diese Datei verengt die nutzbare Spanne** — und das steht hier, wo der Offset
 * gelesen wird, nicht nur in einem Bericht: die Bereiche liegen 100 auseinander
 * (serve 8137+, board 8437+, dieser 8537+). Ein Offset von **100 oder mehr** schiebt
 * `board 8437+slot` genau auf `8537+slot` dieses Serves. Vor diesem Serve war der
 * nächste belegte Bereich 300 entfernt; nutzbar ist jetzt **1…99**.
 */
const SLOT_OFFSET = Number(process.env.E2E_SLOT_OFFSET ?? '0')

/**
 * Ein ZWEITER `serve` — mit leerem `NOSTR_WORKSPACE_URL`.
 *
 * **Warum das eine eigene Serverinstanz braucht und keine Simulation.** Ob die
 * Forge-Zeile der Rail-Fußzeile existiert, entscheidet `@if (config('group.workspace_url'))`
 * SERVER-seitig, beim Rendern. `config/group.php` liest `env('NOSTR_WORKSPACE_URL')` ohne
 * Default — in einer Installation ohne Workspace fehlt die Zeile also, und die Fußzeile
 * ist 38 px kürzer. Ein `page.evaluate`, das die Zeile im laufenden DOM entfernt, misst
 * das nicht, sondern stellt es nach; der Prüfgegenstand ist gerade, dass BEIDE Dateien
 * dieselbe Bedingung tragen.
 *
 * Eigener Port-Bereich (8537+slot), kollidiert mit keinem bestehenden (serve 8137+,
 * board 8437+, zooid 3335+, buzz 3001+). Worker-scoped und LAZY: nur der eine Test, der
 * ihn anfordert, zahlt dafür.
 */
const testOhneWorkspace = boardTest.extend<object, { serverOhneWorkspace: string }>({
    serverOhneWorkspace: [
        async ({ workerBackend }, use, workerInfo) => {
            void workerBackend
            const slot = workerInfo.parallelIndex + SLOT_OFFSET
            const port = 8537 + slot
            const serve: ChildProcess = spawn('php', ['artisan', 'serve', '--port', String(port)], {
                // `mitBoard: true` wie in `board-fixtures.ts`, damit `/articles` eine
                // echte lokale Quelle sieht; `ohneWorkspace: true` leert den EINEN
                // Schlüssel, um den es hier geht. Beides als OPTION des Helfers und
                // nicht als Zeile daneben: eine handgeschriebene `NOSTR_…:`-Zuweisung
                // wäre die vierte Kopie der Liste, und `serverEnv.nodetest.ts` verbietet
                // die Form.
                env: { ...process.env, ...testServerEnv({ slot, mitBoard: true, ohneWorkspace: true }) },
                stdio: 'ignore',
            })
            const frist = Date.now() + 60_000
            for (;;) {
                try {
                    const res = await fetch(`http://127.0.0.1:${port}`)
                    if (res.status < 500) {
                        break
                    }
                } catch {
                    // Port bindet noch nicht.
                }
                if (Date.now() > frist) {
                    throw new Error(`serve ohne Workspace auf Port ${port} kam nicht hoch`)
                }
                await new Promise((r) => setTimeout(r, 250))
            }

            await use(`http://127.0.0.1:${port}`)
            serve.kill()
        },
        { scope: 'worker', timeout: 120_000 },
    ],
    baseURL: async ({ serverOhneWorkspace }, use) => {
        await use(serverOhneWorkspace)
    },
})

const test = boardTest

const NSEC = process.env.NOSTR_TEST_NSEC as string
const ADMIN = 'b2ee09a54bedf17ee1db562bdddd75c48661d981eb52c49dc206c55ba8439414'
const ADMIN_PUB = 'da99fbe39247109327ac8504750d0227d50a8f84049ac8bd2f6c7ad0806ed76d'

/** Siehe die ausführliche Herleitung in `longform-reader.spec.ts` (`boardWs`). */
function boardWs(baseURL: string): string {
    const port = Number(new URL(baseURL).port)

    return `ws://localhost:${3335 + (port - 8437)}`
}

test.afterAll(async ({ baseURL }) => {
    if (baseURL) {
        cleanupArticles(boardWs(baseURL as string), ADMIN)
    }
})

/** Die Spur des Navigators: `xl:grid-cols-[20rem_minmax(0,1fr)]`, 20 rem = 320 px. */
const RAIL_SPUR_PX = 320
/** Der Viewport des `desktop`-Projekts. Steht als Literal da, damit die Rechnung unten
 *  nachvollziehbar bleibt — der Test pinnt ihn zusätzlich selbst. */
const BREITE = 1440
/** Was die Bühne daneben übrig behält. */
const BUEHNE_PX = BREITE - RAIL_SPUR_PX

type Mass = {
    mainX: number
    mainW: number
    /** The content cap inside the stage (`xl:max-w-[62rem]`) — the second, derived width. */
    inhaltW: number
    railKnoten: number
    skelettKnoten: number
}

/**
 * Der Zustand der Bühne, aus dem LEBENDEN DOM.
 *
 * **Fail-closed:** without the stage or its content cap the probe throws. A test reporting
 * "nothing moved" because it found nothing at all measures the empty set — the shape that
 * has hollowed out proofs in this house before.
 *
 * ── What this probe measured until P2, and why that half is gone ────────────────────
 * The second size was the Ortskarten strip: its width and whether its label was clipped
 * ("C…" in the screenshot that started all this). **The Ortskarten were deleted with P2**
 * (D2) and `[data-ortskarte]` exists in no markup any more — so the probe would have thrown
 * unconditionally and this case would have been red on every run without saying anything
 * about the stage.
 *
 * Its place is taken by the stage's **content cap** (`xl:max-w-[62rem]` in
 * `app-shell.blade.php`): a server-rendered child of `#buehne` that stands on every surface
 * and whose width is DERIVED from the stage width. It does what the card did — it collapses
 * in the failure case — and it hangs on no relay data.
 *
 * `sichtbar()` statt bloßer Existenz: der Platzhalter bleibt nach dem Boot im DOM und
 * wird nur per `x-show` auf `display:none` gesetzt. Ein Zählen der KNOTEN meldete ihn
 * weiterhin und die Zusage „genau einer in Spur 1" wäre nie prüfbar.
 */
async function messen(page: Page): Promise<Mass> {
    return page.evaluate(() => {
        const main = document.querySelector('#buehne') as HTMLElement | null
        if (!main) {
            throw new Error('Keine Bühne (#buehne) im DOM — die Sonde misst nichts.')
        }
        const deckel = main.firstElementChild as HTMLElement | null
        if (!deckel) {
            throw new Error('Die Bühne hat keinen Inhaltsdeckel — die Sonde misst nichts.')
        }
        const sichtbar = (wahl: string): number =>
            [...document.querySelectorAll<HTMLElement>(wahl)].filter((el) => el.offsetParent !== null).length

        const r = main.getBoundingClientRect()

        return {
            mainX: Math.round(r.x * 100) / 100,
            mainW: Math.round(r.width * 100) / 100,
            inhaltW: Math.round(deckel.getBoundingClientRect().width * 100) / 100,
            railKnoten: sichtbar('[data-rail]'),
            skelettKnoten: sichtbar('[data-rail-skelett]'),
        }
    })
}

type Kasten = { y: number; h: number; w: number }

/**
 * The THREE blocks of a column-1 surface (head · search field · list).
 *
 * **Until P6 there were four** — the fourth was the footer, which went with the command bar
 * (the reasoning stands where it stood, in `desktop-rail.blade.php`). The number stays EXACT
 * and does not become an upper bound: a column with a fourth block is a different column,
 * and the placeholder would have to bring it along — otherwise the difference is a jump at
 * boot.
 */
async function bloecke(page: Page, wahl: string): Promise<Kasten[]> {
    return page.evaluate((w) => {
        const el = document.querySelector(w) as HTMLElement | null
        if (!el) {
            throw new Error(`${w} fehlt — die Sonde misst nichts.`)
        }
        const kinder = [...el.children]
        if (kinder.length !== 3) {
            throw new Error(`${w} hat ${kinder.length} Blöcke statt 3 — Aufbau geändert, der Vergleich wäre sinnlos.`)
        }

        return kinder.map((k) => {
            const b = k.getBoundingClientRect()

            return { y: Math.round(b.y * 10) / 10, h: Math.round(b.height * 10) / 10, w: Math.round(b.width * 10) / 10 }
        })
    }, wahl)
}

/**
 * Anmelden und `/articles` mit verzögertem JS-Bündel öffnen.
 *
 * `ohneSpaceMetadaten` legt den Space-Relay auf einen Port, auf dem nichts lauscht. Das
 * ist keine Willkür, sondern der Zustand, um den es hier geht: solange die Metadaten
 * nicht da sind, ist `space?.description` falsy und die zweite Kopfzeile der Rail
 * existiert nicht. Genau dieser Zustand gilt im Austauschmoment auf jedem kalten Cache —
 * und er ist die einzige Höhe, die der Server vorhersagen kann.
 */
async function vorDemBoot(page: Page, { verzugMs = 2500, ohneSpaceMetadaten = false } = {}): Promise<void> {
    await useZooid(page)
    if (ohneSpaceMetadaten) {
        // NACH `useZooid`, damit diese Zuweisung gewinnt.
        await page.addInitScript(() => {
            ;(window as unknown as { __nostrSpace: string }).__nostrSpace = 'ws://localhost:39999'
        })
    }
    await loginNsec(page, NSEC)
    await page.route('**/*.js', async (route) => {
        await new Promise((r) => setTimeout(r, verzugMs))
        await route.continue()
    })
    await page.goto('/bereich/artikel', { waitUntil: 'commit' })
}

// ── Der Kernbeweis ──────────────────────────────────────────────────────────────────

test('KERNBEWEIS: die Bühne hat vor dem Alpine-Boot dieselbe Geometrie wie danach', async ({ page }) => {
    await page.setViewportSize({ width: BREITE, height: 900 })
    await vorDemBoot(page)

    // VOR dem Boot: der Platzhalter hält die Spur, die Rail gibt es noch nicht.
    await page.waitForSelector('[data-rail-skelett]')
    await expect(page.locator('[data-rail]')).toHaveCount(0)
    const vorher = await messen(page)

    expect(vorher.skelettKnoten).toBe(1)
    expect(vorher.railKnoten).toBe(0)
    // Die Literale, nicht die Symbole: 1440 − 320 = 1120, und der Ursprung liegt auf 320.
    expect(vorher.mainX).toBe(320)
    expect(vorher.mainW).toBe(1120)
    expect(vorher.mainX).toBe(RAIL_SPUR_PX)
    expect(vorher.mainW).toBe(BUEHNE_PX)
    // And the derived size: the stage's content cap stands on its own width, not on that of a
    // 320 px track. The value is held against the state AFTER the boot below and against the
    // failure case in the negative control — the number itself stands there.
    expect(vorher.inhaltW).toBeGreaterThan(900)

    // NACH dem Boot: die Rail ersetzt den Platzhalter, und NICHTS bewegt sich.
    await page.waitForSelector('[data-rail]')
    await page.waitForTimeout(2000)
    const nachher = await messen(page)

    expect(nachher.railKnoten).toBe(1)
    expect(nachher.skelettKnoten).toBe(0)
    // Zahlengleich, nicht „ungefähr". Ein halber Pixel Unterschied wäre ein Sprung.
    expect(nachher.mainX).toBe(vorher.mainX)
    expect(nachher.mainW).toBe(vorher.mainW)
    expect(nachher.inhaltW).toBe(vorher.inhaltW)
})

test('NEGATIVKONTROLLE: dieselbe Sonde sieht den Fehler, wenn man das alte Markup wiederherstellt', async ({
    page,
}) => {
    // Ohne diese Kontrolle ist der Test oben eine ABWESENHEITS-Messung: „kein Sprung"
    // ist auch das Ergebnis einer Sonde, die nichts misst. Hier wird der Vorzustand im
    // laufenden DOM nachgebaut — Platzhalter weg, ausdrückliche Spur weg — und dieselbe
    // Sonde MUSS die 320 px wieder melden.
    await page.setViewportSize({ width: BREITE, height: 900 })
    await vorDemBoot(page)
    await page.waitForSelector('[data-rail-skelett]')

    const wirkung = await page.evaluate(() => {
        const skelett = document.querySelector('[data-rail-skelett]')
        // The TRACK-bearing wrapper, addressed by its class and not by `parentElement`: since
        // P6 there is one wrapper more between `#buehne` and the grid item (it gives the
        // remaining height to the pages, see `app-frame.blade.php`), and a hop count would
        // silently grab the wrong node — the mutation would then miss and this control would
        // report a hole that is not there.
        const buehne = document.querySelector('#buehne')?.closest('[class*="xl:col-start-2"]')
        if (!skelett || !buehne) {
            throw new Error('Vorzustand nicht herstellbar — Platzhalter oder Bühnen-Hülle fehlt.')
        }
        // Wirkungskontrolle: die Ersetzung MUSS treffen. Eine Mutation, die danebengeht,
        // meldete gleich darauf ein Loch, das es nicht gibt.
        const hatteSpur = buehne.classList.contains('xl:col-start-2')
        skelett.remove()
        buehne.classList.remove('xl:col-start-2', 'xl:row-start-1')

        return { hatteSpur, hatSpurNoch: buehne.classList.contains('xl:col-start-2') }
    })
    expect(wirkung.hatteSpur).toBe(true)
    expect(wirkung.hatSpurNoch).toBe(false)

    const kaputt = await messen(page)

    // Exactly the reported state: the stage sits in the rail's track.
    expect(kaputt.mainX).toBe(0)
    expect(kaputt.mainW).toBe(320)
    // ── And the derived size falls with it ───────────────────────────────────
    // Until P2 that was the Ortskarten width (80 → 77.33 px, derivation in this
    // file's history); the cards are deleted, what is measured now is the stage's
    // content cap.
    //
    // Recomputed at this run's 1440 px: the stage padding is
    // `clamp(2rem, 2.5vw, 3rem)` = 36 px per side, the stage in the broken state is
    // 320 px wide → 320 − 72 = **248 px** of content. In the correct state the cap
    // binds somewhere at or below 1048 px (1120 − 72), which is what the core proof
    // above asserts as `> 900`.
    //
    // The number is pinned exactly rather than softened to a `< 300`: a threshold
    // here would lose the ability to report a SECOND layout change.
    expect(kaputt.inhaltW).toBe(248)
})

/**
 * Ein Lauf: Platzhalter messen, auf die Rail warten, Rail messen. Die Rail wird SOFORT
 * nach ihrem Erscheinen gemessen — der Austauschmoment ist der Prüfgegenstand, nicht der
 * Ruhezustand zehn Sekunden später.
 *
 * **Die eine Ausnahme, und warum sie keine ist: `wartetAufBeschreibung`.** Die drei
 * Aufrufer dieser Funktion messen VERSCHIEDENE Kopfhöhen, weil sie verschiedene
 * Voraussetzungen mitbringen — `ohneSpaceMetadaten: true` (zwei Aufrufer) sorgt dafür,
 * dass die Beschreibung NIE eintrifft, der dritte lässt sie über den echten Relay
 * eintreffen und erwartet Kopf 64. Ohne diese Option wird GENAU DIESER dritte Fall
 * intermittent rot: `[data-rail]` erscheint, sobald Alpine die Vorlage auswertet — das
 * ist synchron mit dem Boot. `space.description` kommt dagegen über eine WebSocket-
 * Antwort des Relays, ein Ereignis, das den Boot-Task immer erst NACH diesem Frame
 * erreicht. Ob es rechtzeitig vor der Messung ankommt, ist reine Zufallssache aus
 * Systemlast und Event-Loop-Reihenfolge.
 *
 * **Reproduziert, deterministisch genug für eine Mutationsprobe:** `verzugMs` unter den
 * Produktions-Default (2500) senken verkürzt das Zeitfenster zwischen Boot und Messung
 * und drückt den Ausgang der Relay-Antwort dichter an die Messung heran — bei `verzugMs:
 * 0`/`50` bricht das allerdings eine ANDERE Voraussetzung von `vergleich()` (der
 * Platzhalter selbst wird dann manchmal schon VOR der ersten `bloecke()`-Messung
 * ausgeblendet, alle vier Blöcke lesen `0`). `verzugMs: 300` bleibt unterhalb dieser
 * zweiten Schwelle und trifft nur die hier gesuchte Lücke: ohne `wartetAufBeschreibung`
 * fielen bei `verzugMs: 300` **6 von 40 Läufen** exakt mit `rail[0].h === platzhalter[0].h
 * === 60` (die Beschreibung kam zu spät); mit der Wartebedingung waren es **0 von 40**
 * unter identischen Bedingungen.
 *
 * Das ist KEINE Lockerung des Grundsatzes „sofort nach dem Erscheinen": es wartet nicht
 * auf einen Ruhezustand, sondern auf das eine noch fehlende Datum, dessen Ankunft die
 * Zusage dieses Falls überhaupt erst bewertbar macht. Ein Aufrufer, der die Beschreibung
 * NICHT erwartet, darf auf sie auch nicht warten — sie kommt dort nie, ein pauschales
 * Warten liefe für die beiden `ohneSpaceMetadaten`-Fälle in den Timeout.
 */
async function vergleich(
    page: Page,
    { wartetAufBeschreibung = false } = {},
): Promise<{ platzhalter: Kasten[]; rail: Kasten[] }> {
    await page.waitForSelector('[data-rail-skelett]')
    const platzhalter = await bloecke(page, '[data-rail-skelett]')
    await page.waitForSelector('[data-rail]')
    if (wartetAufBeschreibung) {
        await page.waitForSelector('[data-rail-space-beschreibung]', { state: 'visible' })
    }
    const rail = await bloecke(page, '[data-rail]')

    return { platzhalter, rail }
}

/**
 * **The dead port has to be declared, and this is why.**
 *
 * `ohneSpaceMetadaten: true` puts the space relay on `ws://localhost:39999` — a port nothing
 * listens on, which is exactly the state these two cases need: while the metadata are
 * missing, `space?.description` is falsy and the rail's head has the height the server can
 * predict. The relay guard sees that socket and counts it as a connection outside the
 * worker's own ports, which is its job: a run against a foreign relay proves nothing.
 *
 * Measured on this branch and NOT caused by P6: with the old, unmodified spec the same
 * violation appears (`Verstöße: ws://localhost:39999/`), next to the block-count failure that
 * IS P6's. The guard's own message names the remedy — declare the socket in the test.
 */
const erlaubeToterPort = (waechter: { erlaube: (...urls: string[]) => void }): void => {
    waechter.erlaube('ws://localhost:39999/')
}

test('Platzhalter und echte Rail sind Block für Block dimensionsgleich — MIT Workspace', async ({ page, relayWaechter }) => {
    erlaubeToterPort(relayWaechter)
    // Die Bühne stünde auch dann richtig, wenn der Platzhalter innen ganz anders aussähe
    // — die Spur ist ja fest. Diese Zusage ist eine andere: beim Austausch soll sich auch
    // INNERHALB der Spalte nichts verschieben, sondern nur Balken zu Schrift werden.
    await page.setViewportSize({ width: BREITE, height: 900 })
    await vorDemBoot(page, { ohneSpaceMetadaten: true })
    const { platzhalter, rail } = await vergleich(page)

    expect(rail).toEqual(platzhalter)
    // Und die Zahlen selbst, damit ein gemeinsamer Umbau beider Seiten auffällt statt
    // stillschweigend „gleich" zu bleiben. Head 60 · search field 36 · list the rest.
    // **Since P6 there are three blocks** (the footer carried 340 px until then, see the head
    // of this file): the list is the only surface with `flex-1`, so it takes everything the
    // footer gave up — 900 − 60 − 36 − 8 (`mb-2`) = 796.
    expect(platzhalter.map((b) => b.h)).toEqual([60, 36, 796])
})

testOhneWorkspace(
    'Platzhalter und echte Rail sind Block für Block dimensionsgleich — OHNE Workspace',
    async ({ page, relayWaechter }) => {
        erlaubeToterPort(relayWaechter)
        // Der Mangel, den diese Zusage festnagelt: der Platzhalter schrieb die
        // Forge-Zeile der Fußzeile unbedingt hin, `desktop-rail.blade.php` gated sie mit
        // `@if (config('group.workspace_url'))`. In einer Installation ohne Workspace war
        // die Fußzeile real 226 statt 264 — **38 px Sprung beim Boot**, also derselbe
        // Fehler wie auf der Bühne, nur eine Ebene tiefer.
        //
        // Eine Zusage, die nur in EINER Konfiguration gemessen ist, gilt auch nur dort.
        // Und sie hat sich bewährt: 2026-09-04 hat genau dieser Fall denselben Fehler ein
        // zweites Mal gemeldet, diesmal in der anderen Richtung — die Lesezeichen-Zeile
        // aus P2 stand in der Rail und nicht im Platzhalter (Kopf dieser Datei).
        await page.setViewportSize({ width: BREITE, height: 900 })
        await vorDemBoot(page, { ohneSpaceMetadaten: true })
        const { platzhalter, rail } = await vergleich(page)

        expect(rail).toEqual(platzhalter)
        // **Since P6 this configuration is numerically identical to the one above**, and that
        // is no loss of statement: the configuration dependency sat in the FOOTER (its forge
        // row hung on `workspace_url`), and the footer is gone. What is still measured here is
        // exactly that — the column has the same block structure WITHOUT a workspace, a
        // promise a configuration can only move again once somebody introduces a conditional
        // block. Then this case goes red and the one above does not.
        expect(platzhalter.map((b) => b.h)).toEqual([60, 36, 796])
    },
)

/**
 * Die Fensterhöhe, ab der die Liste die 4 px des gewachsenen Kopfes VOLLSTÄNDIG federt.
 *
 * **P6 pulled it from 456 px down to 116 px, and the reason is the deleted footer.** The
 * boundary is the space the column needs at least once the head has grown:
 *
 *     64 (head WITH description) + 36 (search field) + 8 (`mb-2`) + 8 (the list's `pb-2`)
 *   = **116 px**
 *
 * That sum used to carry the footer's 340 px as well. The RULE is unchanged — the list is the
 * only surface with `flex-1`, it springs as long as it has play — and that it survived two
 * rebuilds untouched is the reason it is written as a formula rather than as a table of
 * heights.
 *
 * The value is not claimed from this constant: the two cases straddling it
 * (`FEDER_GRENZE_PX` = everything, `FEDER_GRENZE_PX - 1` = partly) only both pass at the TRUE
 * boundary, so every run re-measures it.
 *
 * ── What went with the footer, in terms of what can be observed ─────────────────────
 * The third configuration ("nothing": more than 4 px are missing, the list stands on its
 * floor) hung on a movable block BELOW the list. Without a footer there is nothing below the
 * list that could travel — what is left is the list itself, which stops shrinking, and an
 * overflow the column clips. That configuration therefore stands below as a case of its own,
 * with the promise that holds today: the list stays on its floor and the column overflows
 * instead of squeezing.
 */
const FEDER_GRENZE_PX = 116

for (const { hoehe, gibtDieListeAb } of [
    { hoehe: 900, gibtDieListeAb: 'alles' },
    { hoehe: FEDER_GRENZE_PX, gibtDieListeAb: 'alles' },
    { hoehe: FEDER_GRENZE_PX - 1, gibtDieListeAb: 'teilweise' },
] as const) {
    test(`die Space-Beschreibung ist die eine Höhe, die der Server nicht kennt — 1440×${hoehe}`, async ({ page }) => {
        // `x-show="space?.description"` hangs on relay data. No server-rendered placeholder
        // can predict that, which is why it reserves the safe LOWER BOUND instead of guessing.
        // What is left is a movement — and its direction is the promise: the head may grow
        // when the description arrives, never shrink.
        //
        // ── WHERE the 4 px go depends on the window height ─────────────────────────
        // The amount was 4.8 px once (the description line in `text-[0.7rem]`) and has been a
        // flat 4.0 since P4's type scale. The BOUNDARY, by contrast, has moved three times,
        // every time with the footer: 380 → 418 (the bookmarks row, P2 of this plan) → 456
        // (the "Verschlüsselt" row) → **116** (P6: the footer is gone altogether). The rule
        // survived all three moves untouched, which is why it stands as a formula at
        // `FEDER_GRENZE_PX` and not as a table.
        //
        // The measured series of 2026-09-04 (twelve heights around the 418 boundary of the
        // day) stood here and lost its subject with P6: every height in it now lies far above
        // the boundary and springs fully. It is deliberately NOT rebased — a shifted table
        // would claim a measurement nobody ran. What pins the boundary today are the two
        // cases straddling it in this very loop.
        //
        // THE PROMISE that holds in both configurations, which is why it comes first below:
        // what the head gains, the list gives up. Nothing leaks anywhere else.
        await page.setViewportSize({ width: BREITE, height: hoehe })
        await vorDemBoot(page)
        const { platzhalter, rail } = await vergleich(page, { wartetAufBeschreibung: true })

        // Head: +4 px, in both configurations. The value stands as a literal so that silent
        // growth shows up. `toBeCloseTo` stays although the amount has been integral since P4:
        // a tolerance of two decimals is a tenth-of-a-subpixel bound and costs nothing — it
        // used to catch 64.8 − 60 = 4.799999999999997, and the next step of the type scale can
        // bring the decimal back.
        expect(rail[0].h - platzhalter[0].h).toBeCloseTo(4, 2)
        expect(rail[0].h).toBe(64)
        // The search field always keeps its height — it is `shrink-0`.
        expect(rail[1].h).toBe(platzhalter[1].h)

        const gewinnt = rail[0].h - platzhalter[0].h
        const listeGibtAb = platzhalter[2].h - rail[2].h

        if (gibtDieListeAb === 'alles') {
            // CONSERVATION: the head gains exactly what the list gives up. Since P6 that is a
            // SINGLE equation — before it the list and the footer shared the amount, and the
            // range in between was the case two versions of this test had missed.
            expect(listeGibtAb).toBeCloseTo(gewinnt, 2)
            expect(listeGibtAb).toBeCloseTo(4, 2)
        } else {
            // One pixel below the boundary: the list stands on its floor (`pb-2`) and can only
            // give up 3 px. The fourth is missing from the column — it overflows, and the
            // chassis clips that overflow (`xl:overflow-hidden` on the grid). That is the right
            // failure direction: clipped at the bottom, not squeezed in the middle.
            expect(listeGibtAb).toBeCloseTo(4 - (FEDER_GRENZE_PX - hoehe), 2)
            expect(listeGibtAb).toBeLessThan(gewinnt)
        }
    })
}

test('das Lade-Skelett der Artikelliste steht dort, wo die fertige Liste steht', async ({ page, baseURL }) => {
    // Der zweite Sprung dieser Fläche, gemessen vor dem Fix: beim Eintreffen der Daten
    // erschien der Filterkopf und schob die Liste um **104,0 px** nach unten — und das
    // Raster wechselte von zwei auf drei Spuren (Karte 522 px → 344 px).
    //
    // Die Zahl stand hier zuerst als 103,6 px, aus zwei viewport-relativen y-Werten
    // (166,4 → 270). Die waren in verschiedenen Phasen von `.page-enter` abgelesen und
    // trugen deren Streuung mit; transformfrei nachgemessen sind es 104,0 px — exakt
    // `40 + 8 + 44 + 12` aus der Skala, ohne Nachkommastelle. Die 0,4 px waren
    // Animationsrauschen. Die y-Werte selbst stehen deshalb nicht mehr da: absolute
    // Höhen sind auf dieser Fläche keine belastbare Größe, und genau deshalb misst
    // this test measures against an anchor INSIDE the same transformed subtree — the
    // Ortskarten strip until P2, the page header since they were deleted.
    //
    // Dieser Test braucht als einziger echte Artikel: ohne Bestand bleibt `isEmpty()`
    // wahr, der Filterkopf erscheint nie und der Vergleich hätte keinen zweiten Wert.
    test.setTimeout(120_000)
    const ws = boardWs(baseURL as string)
    for (let i = 0; i < 6; i++) {
        publishArticle(ws, ADMIN, ADMIN_PUB, {
            identifier: `geometrie-${i}-${Math.floor(Math.random() * 1e9)}`,
            title: `Geometrie-Sonde ${i} mit einem realistisch langen Titel`,
            summary: 'Eine Kurzfassung, die über zwei Zeilen läuft und damit realistisch ist.',
            content: 'Rumpf '.repeat(80),
        })
    }

    await page.setViewportSize({ width: BREITE, height: 900 })
    await useZooid(page)
    await loginNsec(page, NSEC)
    await page.goto('/bereich/artikel')
    await page.waitForSelector('[data-rail]')

    const lade = await page.evaluate(() => {
        const gitter = [...document.querySelectorAll<HTMLElement>('.grid')].find(
            (g) => g.querySelector('.skeleton') && g.offsetParent !== null,
        )
        if (!gitter) {
            throw new Error('Kein sichtbares Lade-Skelett — die Sonde misst nichts.')
        }
        // The page header of this surface — inside the SAME `.page-enter` subtree as the
        // list, which is the whole point of the anchor (see the reasoning at the bottom of
        // this case). Until P2 the anchor was the Ortskarten nav; those are deleted (D2), so
        // the probe would have thrown unconditionally and this case would have been red
        // without saying anything about the list.
        const nav = document.querySelector('#buehne header') as HTMLElement | null
        if (!nav) {
            throw new Error('Kein Seitenkopf als Anker — die Sonde misst nichts.')
        }

        return {
            spalten: getComputedStyle(gitter).gridTemplateColumns,
            versatz: Math.round((gitter.getBoundingClientRect().y - nav.getBoundingClientRect().y) * 100) / 100,
        }
    })

    await page.waitForSelector('[data-artikel-raster] article', { timeout: 30_000 })
    await page.waitForTimeout(1000)
    const fertig = await page.evaluate(() => {
        const liste = document.querySelector('[data-artikel-raster]') as HTMLElement | null
        if (!liste || liste.offsetParent === null) {
            throw new Error('Kein sichtbares Artikelraster — die Sonde misst nichts.')
        }
        // The page header of this surface — inside the SAME `.page-enter` subtree as the
        // list, which is the whole point of the anchor (see the reasoning at the bottom of
        // this case). Until P2 the anchor was the Ortskarten nav; those are deleted (D2), so
        // the probe would have thrown unconditionally and this case would have been red
        // without saying anything about the list.
        const nav = document.querySelector('#buehne header') as HTMLElement | null
        if (!nav) {
            throw new Error('Kein Seitenkopf als Anker — die Sonde misst nichts.')
        }

        return {
            spalten: getComputedStyle(liste).gridTemplateColumns,
            versatz: Math.round((liste.getBoundingClientRect().y - nav.getBoundingClientRect().y) * 100) / 100,
        }
    })

    // Drei Spuren, beide Male — als aufgelöste Pixelwerte, nicht als Klassenname.
    expect(lade.spalten.split(' ')).toHaveLength(3)
    expect(fertig.spalten).toBe(lade.spalten)

    // ── Warum hier ein ANKER-VERSATZ steht und keine Viewport-Höhe ──────────────────
    //
    // What is measured is the distance to the page header, not `getBoundingClientRect().y`.
    // The reason is `.page-enter` (`theme.css`): the whole island — header, filter head,
    // list — runs on page load through
    // `@keyframes page-in { from { transform: translateY(8px) } }` über 0,3 s. Eine
    // Viewport-Höhe misst also mit, WO in dieser Animation der Messpunkt gerade liegt,
    // und beide Messungen liegen zwangsläufig an verschiedenen Stellen: die erste kurz
    // nach dem Boot, die zweite nach dem Eintreffen der Daten.
    //
    // Eigene Messreihe, 12 Läufe hintereinander in einer Sitzung (1440×900, Sonde am
    // 2026-08-21, dieselbe Abfolge wie dieser Test):
    //   Viewport-Höhe: 0,53 · 0,25 · 0,73 · 0,53 · 0,98 · 1,28 · 0,98 · 0,53 · 0,98 ·
    //                  0,37 · 0,37 · 0,37  → Maximum 1,28 px
    //   Anker-Versatz: 0 · 0 · 0 · 0 · 0 · 0 · 0 · 0 · 0 · 0 · 0 · 0  → Maximum 0,00 px
    // Unter Last hat ein Prüfer auf der Viewport-Höhe bis 2,8 px gesehen; die alte
    // 1-px-Grenze lag also UNTER der eigenen Unruhe und machte die Fläche zum
    // Zufallsgenerator (isoliert 5 von 6 rot).
    //
    // Der Anker liegt IM selben transformierten Teilbaum wie die Liste — die Transform
    // kürzt sich heraus, und was übrig bleibt, ist genau die Größe, die dieser Zweig
    // reserviert: der Platz des Filterkopfs. Deshalb steht die Toleranz jetzt bei
    // 0,05 px (Rundungsrauschen) statt bei einer runden Zahl nach Gefühl. Sie ist enger
    // als vorher UND belastbar, weil sie eine andere Größe misst.
    expect(Math.abs(fertig.versatz - lade.versatz)).toBeLessThanOrEqual(0.05)
})

test('unter xl gibt es weder Platzhalter noch Spur — die Ursache ist an das Grid gebunden', async ({ page }) => {
    // Die Gegenprobe zur Fläche: bei 1279 px ist `app-frame` `display:contents`, es gibt
    // kein Grid, keine Rail und deshalb auch nichts zu halten. Ein Platzhalter, der hier
    // sichtbar würde, wäre eine 320-px-Fläche auf jedem Telefon.
    await page.setViewportSize({ width: 1279, height: 900 })
    await vorDemBoot(page)
    await page.waitForSelector('#buehne')

    const mass = await messen(page)
    expect(mass.skelettKnoten).toBe(0)
    expect(mass.railKnoten).toBe(0)
    // `lg:max-w-2xl` = 42 rem = 672 px, mittig. Vor UND nach dem Boot derselbe Wert.
    expect(mass.mainW).toBe(672)

    await page.waitForFunction(() => Boolean((window as unknown as { Alpine?: unknown }).Alpine))
    await page.waitForTimeout(1500)
    const nachher = await messen(page)
    expect(nachher.mainW).toBe(672)
    expect(nachher.skelettKnoten).toBe(0)
})
