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
 * Gemessen am 2026-08-21 (Playwright, JS-Antwort um 600 ms verzögert, 1440×900):
 *
 * | | vorher | nachher |
 * |---|---|---|
 * | Frames mit falscher Bühnenbreite | 35–36 von ~176 | **0 von ~176** |
 * | Dauer des kaputten Fensters | **830–837 ms** | **0 ms** |
 * | dasselbe ungedrosselt | 310 ms (3–4 Frames) | 0 ms |
 * | `#buehne` | 320 px @ x=0 | 1120 px @ x=320 |
 * | Ortskarte / Beschriftung | 80 px / „C…" | 346,7 px / voll |
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
 * | mit `workspace_url`, Space ungeladen | 60 | 36 | 532 | 264 |
 * | ohne `workspace_url`, Space ungeladen | 60 | 36 | 570 | **226** |
 * | mit `workspace_url`, Space MIT Beschreibung | **64,8** | 36 | 527,2 | 264 |
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
                // echte lokale Quelle sieht — und danach der EINE Schlüssel, um den es
                // geht, ausdrücklich geleert.
                env: { ...process.env, ...testServerEnv({ slot, mitBoard: true }), NOSTR_WORKSPACE_URL: '' },
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

    // Genau der gemeldete Zustand: Bühne in der Rail-Spur, Ortskarte 80 px, Text gekürzt.
    expect(kaputt.mainX).toBe(0)
    expect(kaputt.mainW).toBe(320)
    expect(kaputt.karteW).toBe(80)
    expect(kaputt.gekuerzt).toBe(true)
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
    // stillschweigend „gleich" zu bleiben. Kopf 60 · Suchfeld 36 · Liste 532 · Fußzeile
    // 264 (zwei Flächenzeilen, drei Nav-Zeilen, Profilzeile).
    expect(platzhalter.map((b) => b.h)).toEqual([60, 36, 532, 264])
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
        await page.setViewportSize({ width: BREITE, height: 900 })
        await vorDemBoot(page, { ohneSpaceMetadaten: true })
        const { platzhalter, rail } = await vergleich(page)

        expect(rail).toEqual(platzhalter)
        // 226 = 264 − 36 (`min-h-9`) − 2 (`mt-0.5`): genau die fehlende Forge-Zeile.
        // Die Liste bekommt die 38 px, weil sie die einzige Fläche mit `flex-1` ist.
        expect(platzhalter.map((b) => b.h)).toEqual([60, 36, 570, 226])
    },
)

test('die Space-Beschreibung ist die eine Höhe, die der Server nicht kennt — der Kopf wächst, die Liste federt', async ({
    page,
}) => {
    // `x-show="space?.description"` hängt an einem Relay-Datum. Kein server-gerenderter
    // Platzhalter kann das vorhersagen, und deshalb reserviert er die sichere
    // UNTERGRENZE statt zu raten. Was bleibt, ist eine Bewegung — und die Richtung ist
    // die Zusage: der Kopf darf wachsen, wenn die Beschreibung eintrifft, aber nie
    // schrumpfen. Ein Schrumpfen zöge den Inhalt darunter nach oben.
    await page.setViewportSize({ width: BREITE, height: 900 })
    await vorDemBoot(page)
    const { platzhalter, rail } = await vergleich(page)

    // Kopf: +4,8 px. Der Wert steht als Literal da, damit stilles Wachsen auffällt.
    // `toBeCloseTo`, weil 64,8 − 60 in IEEE-754 als 4,799999999999997 herauskommt —
    // zwei Nachkommastellen sind hier eine Zehntel-Subpixel-Grenze, keine Aufweichung.
    expect(rail[0].h - platzhalter[0].h).toBeCloseTo(4.8, 2)
    expect(rail[0].h).toBe(64.8)
    // Die Bewegung bleibt IM Kopf und in der Liste, die sie schluckt. Suchfeld und
    // Fußzeile stehen still — die Fußzeile hängt am unteren Rand einer `h-dvh`-Spalte,
    // ihre y-Position ist von der Kopfhöhe unabhängig.
    expect(rail[1].h).toBe(platzhalter[1].h)
    expect(rail[3].h).toBe(platzhalter[3].h)
    expect(rail[3].y).toBe(platzhalter[3].y)
    // ERHALTUNG: was der Kopf gewinnt, gibt die Liste ab — und nichts leckt woandershin.
    // (Hier stand zuerst „kein Block wird kleiner". Das war falsch und wurde von der
    // Messung widerlegt: die Liste MUSS abgeben, sie ist die einzige Fläche mit
    // `flex-1`. Eine Zusage, die weiter reicht als die Sache, ist keine.)
    expect(platzhalter[2].h - rail[2].h).toBeCloseTo(rail[0].h - platzhalter[0].h, 2)
    // Die drei starren Blöcke behalten ihre Höhe — nur die Liste federt.
    for (const i of [0, 1, 3]) {
        expect(rail[i].h).toBeGreaterThanOrEqual(platzhalter[i].h - 0.05)
    }
})

test('das Lade-Skelett der Artikelliste steht dort, wo die fertige Liste steht', async ({ page, baseURL }) => {
    // Der zweite Sprung dieser Fläche, gemessen vor dem Fix: beim Eintreffen der Daten
    // erschien der Filterkopf und schob die Liste von y = 166,4 auf y = 270 — 103,6 px
    // — und das Raster wechselte von zwei auf drei Spuren (Karte 522 px → 344 px).
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

        return {
            spalten: getComputedStyle(gitter).gridTemplateColumns,
            y: Math.round(gitter.getBoundingClientRect().y * 10) / 10,
        }
    })

    await page.waitForSelector('[data-artikel-raster] article', { timeout: 30_000 })
    await page.waitForTimeout(1000)
    const fertig = await page.evaluate(() => {
        const liste = document.querySelector('[data-artikel-raster]') as HTMLElement | null
        if (!liste || liste.offsetParent === null) {
            throw new Error('Kein sichtbares Artikelraster — die Sonde misst nichts.')
        }

        return {
            spalten: getComputedStyle(liste).gridTemplateColumns,
            y: Math.round(liste.getBoundingClientRect().y * 10) / 10,
        }
    })

    // Drei Spuren, beide Male — als aufgelöste Pixelwerte, nicht als Klassenname.
    expect(lade.spalten.split(' ')).toHaveLength(3)
    expect(fertig.spalten).toBe(lade.spalten)
    // Und die Liste beginnt an derselben Höhe, auf die der Filterkopf-Platz gerechnet
    // ist. Ein Pixel Toleranz für die Rundung des Rasters, mehr nicht.
    expect(Math.abs(fertig.y - lade.y)).toBeLessThanOrEqual(1)
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
