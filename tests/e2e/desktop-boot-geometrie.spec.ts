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
 * | mit `workspace_url`, Space ungeladen | 60 | 36 | 494 | 302 |
 * | ohne `workspace_url`, Space ungeladen | 60 | 36 | 532 | **264** |
 * | mit `workspace_url`, Space MIT Beschreibung | **64** | 36 | **490** | 302 |
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
    karteW: number
    gekuerzt: boolean
    railKnoten: number
    skelettKnoten: number
}

/**
 * Der Zustand der Bühne, aus dem LEBENDEN DOM.
 *
 * **Fail-closed:** fehlt die Bühne oder die Ortskarten-Leiste, wirft die Sonde. Ein
 * Test, der „nicht gekürzt" meldet, weil er gar keine Beschriftung gefunden hat, prüft
 * die leere Menge — die Bauform, die in diesem Haus schon Beweise ausgehöhlt hat.
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
        const karte = document.querySelector('[data-ortskarte]') as HTMLElement | null
        if (!karte) {
            throw new Error('Keine Ortskarten-Leiste im DOM — die Sonde misst nichts.')
        }
        const name = karte.querySelector('[data-ortskarte-name]') as HTMLElement | null
        if (!name) {
            throw new Error('Ortskarte ohne [data-ortskarte-name] — Markup umgebaut?')
        }
        const sichtbar = (wahl: string): number =>
            [...document.querySelectorAll<HTMLElement>(wahl)].filter((el) => el.offsetParent !== null).length

        const r = main.getBoundingClientRect()

        return {
            mainX: Math.round(r.x * 100) / 100,
            mainW: Math.round(r.width * 100) / 100,
            karteW: Math.round(karte.getBoundingClientRect().width * 100) / 100,
            gekuerzt: name.scrollWidth > name.clientWidth,
            railKnoten: sichtbar('[data-rail]'),
            skelettKnoten: sichtbar('[data-rail-skelett]'),
        }
    })
}

type Kasten = { y: number; h: number; w: number }

/** Die vier Blöcke einer Spalte-1-Fläche (Kopf · Suchfeld · Liste · Fußzeile). */
async function bloecke(page: Page, wahl: string): Promise<Kasten[]> {
    return page.evaluate((w) => {
        const el = document.querySelector(w) as HTMLElement | null
        if (!el) {
            throw new Error(`${w} fehlt — die Sonde misst nichts.`)
        }
        const kinder = [...el.children]
        if (kinder.length !== 4) {
            throw new Error(`${w} hat ${kinder.length} Blöcke statt 4 — Aufbau geändert, der Vergleich wäre sinnlos.`)
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
    await page.goto('/articles', { waitUntil: 'commit' })
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
    // Die Beschriftung der Ortskarte passt — genau sie war im Screenshot „C…".
    expect(vorher.gekuerzt).toBe(false)

    // NACH dem Boot: die Rail ersetzt den Platzhalter, und NICHTS bewegt sich.
    await page.waitForSelector('[data-rail]')
    await page.waitForTimeout(2000)
    const nachher = await messen(page)

    expect(nachher.railKnoten).toBe(1)
    expect(nachher.skelettKnoten).toBe(0)
    // Zahlengleich, nicht „ungefähr". Ein halber Pixel Unterschied wäre ein Sprung.
    expect(nachher.mainX).toBe(vorher.mainX)
    expect(nachher.mainW).toBe(vorher.mainW)
    expect(nachher.karteW).toBe(vorher.karteW)
    expect(nachher.gekuerzt).toBe(false)
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
        const buehne = document.querySelector('#buehne')?.parentElement
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

    // Genau der gemeldete Zustand: Bühne in der Rail-Spur, Text gekürzt.
    expect(kaputt.mainX).toBe(0)
    expect(kaputt.mainW).toBe(320)
    expect(kaputt.gekuerzt).toBe(true)
    // ── Die Kartenbreite: 80 → 77,33 (P2, 2026-08-26) ────────────────────────
    // Diese Zahl beschreibt NICHT den Fehler, sondern eine FOLGE der Bühnen-
    // Polsterung, und die ist mit P2 stetig geworden: `xl:px-8` (feste 32 px) ist
    // `xl:px-[clamp(2rem,2.5vw,3rem)]` gewichen, weil die alte zweite Stufe
    // `2xl:px-12` den Inhaltsdeckel bei 1536 px um 31 px FALLEN liess.
    //
    // Nachgerechnet bei den 1440 px dieses Laufs: 2,5 vw sind 36 px je Seite, die
    // Bühne im kaputten Zustand ist 320 px breit → 320 − 72 = 248 px Inhalt,
    // geteilt auf drei Karten mit 8 px Rinne: (248 − 16) / 3 = 77,33.
    // Vorher mit 32 px Polster: (320 − 64 − 16) / 3 = 80.
    //
    // Die Zusage dieser Kontrolle ist unberührt — sie lautet „dieselbe Sonde sieht
    // den Fehler", und das tun die drei Assertions darüber unverändert. Die Zahl
    // wird trotzdem exakt festgehalten statt auf ein `< 100` aufgeweicht: eine
    // Schwelle hier verlöre die Fähigkeit, eine ZWEITE Layout-Änderung zu melden.
    expect(kaputt.karteW).toBe(77.33)
})

/**
 * Ein Lauf: Platzhalter messen, auf die Rail warten, Rail messen. Die Rail wird SOFORT
 * nach ihrem Erscheinen gemessen — der Austauschmoment ist der Prüfgegenstand, nicht der
 * Ruhezustand zehn Sekunden später.
 */
async function vergleich(page: Page): Promise<{ platzhalter: Kasten[]; rail: Kasten[] }> {
    await page.waitForSelector('[data-rail-skelett]')
    const platzhalter = await bloecke(page, '[data-rail-skelett]')
    await page.waitForSelector('[data-rail]')
    const rail = await bloecke(page, '[data-rail]')

    return { platzhalter, rail }
}

test('Platzhalter und echte Rail sind Block für Block dimensionsgleich — MIT Workspace', async ({ page }) => {
    // Die Bühne stünde auch dann richtig, wenn der Platzhalter innen ganz anders aussähe
    // — die Spur ist ja fest. Diese Zusage ist eine andere: beim Austausch soll sich auch
    // INNERHALB der Spalte nichts verschieben, sondern nur Balken zu Schrift werden.
    await page.setViewportSize({ width: BREITE, height: 900 })
    await vorDemBoot(page, { ohneSpaceMetadaten: true })
    const { platzhalter, rail } = await vergleich(page)

    expect(rail).toEqual(platzhalter)
    // Und die Zahlen selbst, damit ein gemeinsamer Umbau beider Seiten auffällt statt
    // stillschweigend „gleich" zu bleiben. Kopf 60 · Suchfeld 36 · Liste 494 · Fußzeile
    // 302 (drei Flächenzeilen, drei Nav-Zeilen, Profilzeile).
    expect(platzhalter.map((b) => b.h)).toEqual([60, 36, 494, 302])
})

testOhneWorkspace(
    'Platzhalter und echte Rail sind Block für Block dimensionsgleich — OHNE Workspace',
    async ({ page }) => {
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
        // 264 = 302 − 36 (`min-h-9`) − 2 (`mt-0.5`): genau die fehlende Forge-Zeile.
        // Die Liste bekommt die 38 px, weil sie die einzige Fläche mit `flex-1` ist.
        expect(platzhalter.map((b) => b.h)).toEqual([60, 36, 532, 264])
    },
)

for (const { hoehe, gibtDieListeAb } of [
    { hoehe: 900, gibtDieListeAb: 'alles' },
    { hoehe: 418, gibtDieListeAb: 'alles' },
    { hoehe: 417, gibtDieListeAb: 'teilweise' },
    { hoehe: 360, gibtDieListeAb: 'nichts' },
] as const) {
    test(`die Space-Beschreibung ist die eine Höhe, die der Server nicht kennt — 1440×${hoehe}`, async ({ page }) => {
        // `x-show="space?.description"` hängt an einem Relay-Datum. Kein
        // server-gerenderter Platzhalter kann das vorhersagen, und deshalb reserviert er
        // die sichere UNTERGRENZE statt zu raten. Was bleibt, ist eine Bewegung — und
        // die Richtung ist die Zusage: der Kopf darf wachsen, wenn die Beschreibung
        // eintrifft, aber nie schrumpfen.
        //
        // ── WOHIN die 4 px gehen, hängt an der Fensterhöhe ──────────────────────────
        // NACHGEZOGEN 2026-08-26 (P4, Typo-Leiter): der Betrag war **4,8 px** und ist
        // jetzt **4,0**. Die Beschreibungszeile der Rail trug `text-[0.7rem]`
        // (Zeilenbox 16,8 px) und trägt seit der Zusammenlegung auf vier Schriftstufen
        // `text-xs` (16 px). Dadurch verschwindet die Nachkommastelle aus ALLEN Zahlen
        // dieses Tests — und mit ihr der Grund, warum 1440×380 einmal der Teil-Fall war:
        // die Grenze lag bei 380,8 px und liegt jetzt bei glatt 380. Bei 380 federt die
        // Liste seither VOLLSTÄNDIG. Der Teil-Fall ist nicht verschwunden, er ist einen
        // Pixel gewandert; damit die Abdeckung nicht still verlorengeht, läuft er hier
        // als 1440×379 weiter (gemessen: 376 und tiefer = „nichts", 377–379 = Teil-Fall,
        // 380 und höher = „alles").
        //
        // MOVED AGAIN 2026-09-04, and this time not by a fraction: the boundary is at
        // **418 px**, because the footer grew by 38 px (the bookmarks row of P2, see the
        // head of this file). The 380 in the paragraph above is history — what carries
        // the number today is the formula and the measured series below. The four cases
        // moved with it: 418 is the boundary, 417 the partial case, 360 stays the deep
        // one. Nothing about the RULE changed, only the height at which it kicks in.
        //
        // Zwei Fassungen dieses Absatzes waren vorher falsch, und beide auf dieselbe
        // Weise: sie behaupteten mehr, als gemessen war.
        //
        // Zuerst stand hier „die Fußzeile hängt am unteren Rand einer `h-dvh`-Spalte,
        // ihre y-Position ist von der Kopfhöhe unabhängig" — unbedingt, und damit
        // falsch. Dann eine Grenze von `60 + 36 + 264 + 8 = 368 px`, GERECHNET statt
        // gemessen, und sie hält nicht: die Rechnung nimmt die Kopfhöhe VOR dem
        // Wachsen und vergisst das `mb-2` des Suchfelds.
        //
        // Was wirklich gilt: die Liste ist die einzige Fläche mit `flex-1`, sie federt,
        // SOLANGE sie Spiel hat, und ihr Boden ist das eigene `pb-2` (8 px). Der Platz,
        // den die Spalte im gewachsenen Zustand braucht, ist
        //
        //     64 (Kopf MIT Beschreibung) + 36 (Suchfeld) + 8 (mb-2) + 302 (Fußzeile)
        //   +  8 (pb-2 der Liste)                                         = **418 px**
        //
        // Ab da federt die Liste vollständig, darunter teilt sie sich die 4 px mit der
        // Fußzeile, und sobald mehr als 4 px fehlen, wandert die Fußzeile ganz.
        //
        // Am gerenderten Element gemessen (2026-09-04, Sonde über zwölf Höhen; die Reihe
        // vom 2026-08-21 stand bis dahin hier und lag um dieselben 38 px tiefer):
        //   1440×900  Kopf +4 · Liste −4 · Fußzeile-y ±0
        //   1440×424  Kopf +4 · Liste −4 · Fußzeile-y ±0
        //   1440×418  Kopf +4 · Liste −4 · Fußzeile-y ±0     ← genau die Grenze
        //   1440×417  Kopf +4 · Liste −3 · Fußzeile-y **+1**
        //   1440×416  Kopf +4 · Liste −2 · Fußzeile-y **+2**
        //   1440×415  Kopf +4 · Liste −1 · Fußzeile-y **+3**
        //   1440×414  Kopf +4 · Liste ±0 · Fußzeile-y **+4**
        //   1440×360  Kopf +4 · Liste ±0 · Fußzeile-y **+4**
        //
        // Der Rest bei 415–417 ist kein Rauschen, sondern genau der fehlende Betrag —
        // das ist die Probe auf die Formel. Alle drei Lagen laufen hier als eigener
        // Fall: eine Regel, die nur an einer Stelle geprüft ist, ist keine Regel,
        // sondern ein Messpunkt, und zwei Stellen haben den Teilbereich dazwischen
        // gerade übersehen.
        //
        // DIE ZUSAGE, die in ALLEN drei Lagen gilt und deshalb unten zuerst steht:
        // was der Kopf gewinnt, geben Liste und Fußzeile zusammen ab. Nichts leckt
        // woandershin, und keine Lage ist ein Sonderfall — nur die Aufteilung wandert.
        await page.setViewportSize({ width: BREITE, height: hoehe })
        await vorDemBoot(page)
        const { platzhalter, rail } = await vergleich(page)

        // Kopf: +4 px, in beiden Lagen. Der Wert steht als Literal da, damit stilles
        // Wachsen auffällt. `toBeCloseTo` bleibt, obwohl der Betrag seit P4 ganzzahlig
        // ist: die Toleranz von zwei Nachkommastellen ist eine Zehntel-Subpixel-Grenze
        // und kostet nichts — sie hat vorher 64,8 − 60 = 4,799999999999997 aufgefangen,
        // und der nächste Typo-Schritt kann die Nachkommastelle zurückbringen.
        expect(rail[0].h - platzhalter[0].h).toBeCloseTo(4, 2)
        expect(rail[0].h).toBe(64)
        // Das Suchfeld behält seine Höhe immer — es ist `shrink-0`.
        expect(rail[1].h).toBe(platzhalter[1].h)
        // Und die Fußzeile ebenfalls: sie wird verschoben, nie gestaucht.
        expect(rail[3].h).toBe(platzhalter[3].h)

        // ERHALTUNG, in allen drei Lagen dieselbe Zeile: was der Kopf gewinnt, geben
        // Liste und Fußzeile ZUSAMMEN ab. Vorher standen hier zwei Zweige mit je einer
        // eigenen Zusage — und genau zwischen ihnen lag der Teilbereich, den keiner
        // abdeckte. (Noch früher stand „kein Block wird kleiner"; auch das war falsch
        // und wurde von der eigenen Messung widerlegt: die Liste MUSS abgeben.)
        const gewinnt = rail[0].h - platzhalter[0].h
        const listeGibtAb = platzhalter[2].h - rail[2].h
        const fussWandert = rail[3].y - platzhalter[3].y
        expect(listeGibtAb + fussWandert).toBeCloseTo(gewinnt, 2)

        // Und die Aufteilung je Lage — das ist der Teil, der von der Fensterhöhe
        // abhängt. Jede Lage nennt ihre Erwartung als Literal, damit ein stilles
        // Verschieben zwischen den Lagen auffällt.
        if (gibtDieListeAb === 'alles') {
            expect(listeGibtAb).toBeCloseTo(4, 2)
            expect(fussWandert).toBe(0)
        } else if (gibtDieListeAb === 'teilweise') {
            // 418 − 417 = 1 px fehlt der Spalte, genau der wandert.
            expect(fussWandert).toBeCloseTo(418 - hoehe, 2)
            expect(listeGibtAb).toBeCloseTo(4 - (418 - hoehe), 2)
        } else {
            // Mehr als 4 px fehlen: die Liste steht auf ihrem Boden, die Fußzeile
            // nimmt alles.
            expect(rail[2].h).toBe(platzhalter[2].h)
            expect(fussWandert).toBeCloseTo(4, 2)
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
    // dieser Test gegen die Ortskarten-Leiste.
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
    await page.goto('/articles')
    await page.waitForSelector('[data-rail]')

    const lade = await page.evaluate(() => {
        const gitter = [...document.querySelectorAll<HTMLElement>('.grid')].find(
            (g) => g.querySelector('.skeleton') && g.offsetParent !== null,
        )
        if (!gitter) {
            throw new Error('Kein sichtbares Lade-Skelett — die Sonde misst nichts.')
        }
        const nav = document.querySelector('[data-ortskarte]')?.closest('nav') as HTMLElement | null
        if (!nav) {
            throw new Error('Kein Ortskarten-nav als Anker — die Sonde misst nichts.')
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
        const nav = document.querySelector('[data-ortskarte]')?.closest('nav') as HTMLElement | null
        if (!nav) {
            throw new Error('Kein Ortskarten-nav als Anker — die Sonde misst nichts.')
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
    // Gemessen wird der Abstand zur Ortskarten-Leiste, nicht `getBoundingClientRect().y`.
    // Der Grund ist `.page-enter` (`theme.css`): die ganze Insel — Überschrift,
    // Ortskarten, Liste — läuft beim Seitenaufbau durch
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
