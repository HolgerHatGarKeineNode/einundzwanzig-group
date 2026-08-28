import { test, expect, type Page } from './support/fixtures'
import { useZooid, ZOOID_WS } from './support/zooid'
import { loginNsec } from './support/login'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * **DAS CHASSIS HÄLT AUCH UNTER DEM CODE-REITER** — ab `xl` scrollt die Bühne,
 * NICHT das Dokument.
 *
 * ── Der Fehler, den diese Datei festnagelt (gemeldet 2026-08-28) ────────────────
 *
 * Im Code-Reiter eines Repositories erschien nach dem Laden von Klon und
 * Dateibaum ein ZWEITER Bildlauf am Dokument. Wer ihn benutzte, schob das ganze
 * `xl:h-dvh`-Chassis nach oben aus dem Bild: unter der Rail-Unterkante lagen
 * ~850 px nackter Seitengrund, die Rail sah aus, als „breche sie auf".
 *
 * ── Die Ursache, gemessen ──────────────────────────────────────────────────────
 *
 * `main#buehne` ist ab `xl` der Scrollport (`xl:overflow-y-auto`), war aber kein
 * ENTHALTENDER BLOCK: `position: static`. Ein `position: absolute` darin sucht
 * seinen Bezug beim nächsten positionierten Vorfahren — den gab es nicht, also
 * war es der initiale enthaltende Block. Ein solcher Kasten wird vom `overflow`
 * der Bühne **nicht** geklippt und zählt zum Scroll-Überlauf des DOKUMENTS.
 *
 * Der Auslöser ist harmlos und steht überall im Haus: jede Zeile des Dateibaums
 * trägt ein `<span class="sr-only">` mit der Art (Verzeichnis/Datei, WCAG 1.4.1),
 * und Tailwinds `sr-only` ist `position: absolute`
 * (`.sr-only{…;position:absolute;overflow:hidden}` im gebauten Stylesheet).
 *
 * Messlauf 1440×900, Repository mit 42 Einträgen im Wurzelverzeichnis:
 *
 * | Zustand | `document.scrollingElement.scrollHeight` |
 * |---|---|
 * | Repo offen, nicht geklont | 900 |
 * | **Code-Reiter, Baum sichtbar** | **2041** |
 * | Datei offen (Baum weg) | 900 |
 * | Issues / Pull Requests / Aktivität / Patches | 900 |
 *
 * 2041 war exakt die Unterkante der untersten `sr-only`-Spanne; alle 42 meldeten
 * `offsetParent === BODY`. `#buehne` selbst maß `scrollHeight` 2139 bei
 * `clientHeight` 900 — der Bühnen-Bildlauf war die ganze Zeit da und richtig.
 *
 * ── Die Reparatur ──────────────────────────────────────────────────────────────
 * `xl:relative` an `main#buehne` (`components/app-shell.blade.php`). Begründung,
 * Blast-Radius und der Vorher/Nachher-Vergleich der Geometrie aller sichtbaren
 * absolut positionierten Elemente stehen dort im Blade-Kommentar.
 *
 * ── Warum die Zusagen unten so geschnitten sind ────────────────────────────────
 * Eine Prüfung „`scrollHeight <= innerHeight`" ist auf einer kurzen Fläche
 * trivial grün. Jede Messung hier fordert deshalb ZUERST den Fall ein, der sie
 * überhaupt aussagekräftig macht: die Bühne muss wirklich scrollen UND mindestens
 * eine `sr-only`-Spanne muss unter der Falzkante liegen. Fehlt beides, wirft die
 * Sonde, statt grün zu melden.
 *
 * ── Die Gegenstelle ist echtes Git, kein Attrappen-Text ────────────────────────
 * Dieselbe Bauform wie in `forge-readme.spec.ts`: `page.route` beantwortet die
 * `/git/`-Anfragen mit der Ausgabe des echten `git upload-pack --stateless-rpc`.
 * Der Workspace dieses Laufs ist der worker-eigene zooid, und der ist kein
 * Git-Server.
 */

const NSEC = process.env.NOSTR_TEST_NSEC as string
const NAK = process.env.NAK ?? `${process.env.HOME}/go/bin/nak`

/** Ein eigener `d`-Wert: kein anderer Spec und kein Seed benutzt ihn. */
const REPO_D = 'e2e-code-chassis'

/** So viele Dateien, dass der Baum sicher über die Falzkante reicht (900 px hoch). */
const DATEIEN = 40

/** Der Workspace dieses Laufs als http-Ursprung — die clone-URL MUSS darauf zeigen. */
const WORKSPACE_HTTP = ZOOID_WS.replace(/^ws/, 'http').replace(/\/+$/, '')

let arbeit = ''
let bare = ''
let owner = ''
const ids: string[] = []

/**
 * Die Ref-Ankündigung ist bei unveränderter Vorlage konstant — einmal bauen.
 *
 * **Der Cache wird in `beforeAll` ausdrücklich verworfen, und das ist keine
 * Vorsichtsmaßnahme.** Playwright fährt `beforeAll` einmal je Worker-PROZESS und
 * Datei — ein Worker, der zwischendurch eine andere Datei bedient und danach
 * wieder eine Zusage von hier bekommt, durchläuft `afterAll` + `beforeAll` ein
 * zweites Mal. Dann steht ein NEUES nacktes Repository mit einem neuen Commit da,
 * während dieser Cache noch die Ankündigung des ersten hielte. Der Client fordert
 * daraufhin einen Commit an, den die Gegenstelle nicht kennt, und `upload-pack`
 * antwortet `fatal: not our ref …` — die Fläche landet auf `data-lage="fehler"`.
 * Gemessen am 2026-08-28: im Volllauf des `desktop`-Projekts reproduzierbar, im
 * Einzellauf dieser Datei nie.
 */
let ankuendigungCache: Buffer | null = null
const ankuendigung = (): Buffer => {
    if (!ankuendigungCache) {
        const adv = execFileSync('git', ['upload-pack', '--stateless-rpc', '--advertise-refs', bare], {
            encoding: 'buffer',
            maxBuffer: 64 * 1024 * 1024,
        })
        ankuendigungCache = Buffer.concat([Buffer.from('001e# service=git-upload-pack\n0000', 'utf8'), adv])
    }

    return ankuendigungCache
}

const nak = (args: readonly string[]): string => {
    const res = spawnSync(NAK, [...args], { encoding: 'utf8', timeout: 30_000 })

    return `${res.stdout ?? ''}\n${res.stderr ?? ''}`
}

const eventId = (ausgabe: string): string => {
    const zeile = ausgabe.split('\n').map((l) => l.trim()).find((l) => l.startsWith('{'))
    expect(zeile, `nak hat kein Ereignis ausgegeben: ${ausgabe}`).toBeTruthy()

    return (JSON.parse(zeile as string) as { id: string }).id
}

/** Die Git-Gegenstelle: echtes `upload-pack`, ohne Serverprozess. */
async function verdrahteGit(page: Page): Promise<void> {
    await page.route('**/git/**', async (route) => {
        const url = route.request().url()
        try {
            if (url.includes('/info/refs')) {
                await route.fulfill({
                    status: 200,
                    headers: { 'content-type': 'application/x-git-upload-pack-advertisement' },
                    body: ankuendigung(),
                })

                return
            }
            const eingabe = route.request().postDataBuffer() ?? Buffer.alloc(0)
            const antwort = execFileSync('git', ['upload-pack', '--stateless-rpc', bare], {
                input: eingabe,
                encoding: 'buffer',
                maxBuffer: 64 * 1024 * 1024,
            })
            await route.fulfill({
                status: 200,
                headers: { 'content-type': 'application/x-git-upload-pack-result' },
                body: antwort,
            })
        } catch (e) {
            await route.fulfill({ status: 500, body: String(e) })
        }
    })
}

/** Anmelden, das Repository öffnen — der Code-Reiter ist seit der GH-Parität der erste. */
async function oeffneRepo(page: Page): Promise<void> {
    await useZooid(page)
    await page.addInitScript((url) => {
        ;(window as unknown as { __nostrWorkspace: string }).__nostrWorkspace = url
    }, `${ZOOID_WS}/`)
    await loginNsec(page, NSEC)
    await page.goto('/forge?tab=repos')
    await page.waitForFunction(
        () => {
            const el = document.querySelector('[x-data^="nostrForge"]')
            const A = (window as unknown as { Alpine?: { $data(e: Element): { loading?: boolean } } }).Alpine

            return !!el && !!A && A.$data(el).loading === false
        },
        undefined,
        { timeout: 30_000 },
    )
    // EXAKT, nicht `hasText`: eine Teilzeichenkette träfe auch ein Nachbar-Fixture.
    await page
        .locator('[data-forge-repo]')
        .filter({ has: page.getByText(REPO_D, { exact: true }) })
        .first()
        .click()
    // Auf eine ENTSCHIEDENE Lage warten: `pruefe` ist der Anfangszustand.
    await expect(page.locator('[data-forge-code]')).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('[data-forge-code]')).not.toHaveAttribute('data-lage', 'pruefe', { timeout: 30_000 })
}

/** Klonen und warten, bis der Dateibaum steht. */
async function ladeBaum(page: Page): Promise<void> {
    await page.locator('[data-forge-code-start]').click()
    await expect(page.locator('[data-forge-code]')).toHaveAttribute('data-lage', 'da', { timeout: 60_000 })
    await expect(page.locator('[data-forge-baum]')).toBeVisible({ timeout: 30_000 })
    // Der Baum wächst zeilenweise: erst wenn alle Einträge stehen, ist die Höhe
    // die, gegen die gemessen werden soll.
    await expect(page.locator('[data-forge-baum-eintrag]')).toHaveCount(DATEIEN + 1, { timeout: 30_000 })
}

type Mass = {
    dokumentScrollH: number
    dokumentClientH: number
    fensterH: number
    scrollY: number
    buehneScrollH: number
    buehneClientH: number
    railUnten: number
    tiefsteSrOnly: number
    ausreisser: string[]
}

/**
 * Der Zustand des Chassis, aus dem LEBENDEN DOM — fail-closed.
 *
 * Fehlt Bühne, Rail oder Baum, wirft die Sonde. Ein Test, der „kein
 * Dokument-Bildlauf" meldet, weil er die Fläche gar nicht gefunden hat, prüft die
 * leere Menge.
 *
 * `ausreisser` ist die Diagnose zur Ursache, nicht die Zusage: absolut
 * positionierte Nachfahren der Bühne, deren Bezug NICHT die Bühne ist. Sie stehen
 * in der Fehlermeldung, damit der nächste Leser die Ursache sieht statt nur die
 * Zahl. Unsichtbare Kästen bleiben draussen — `offsetParent` ist bei
 * `display:none` ebenfalls `null` und meldete sonst jede geschlossene Klappe.
 */
async function messen(page: Page): Promise<Mass> {
    return page.evaluate(() => {
        const buehne = document.querySelector('#buehne') as HTMLElement | null
        if (!buehne) {
            throw new Error('Keine Bühne (#buehne) im DOM — die Sonde misst nichts.')
        }
        const rail = document.querySelector('[data-rail]') as HTMLElement | null
        if (!rail) {
            throw new Error('Keine Rail ([data-rail]) im DOM — die Sonde misst nichts.')
        }
        const baum = document.querySelector('[data-forge-baum]') as HTMLElement | null
        if (!baum) {
            throw new Error('Kein Dateibaum ([data-forge-baum]) im DOM — die Sonde misst nichts.')
        }

        const srOnly = [...baum.querySelectorAll<HTMLElement>('.sr-only')]
        if (srOnly.length === 0) {
            throw new Error('Keine .sr-only-Spanne im Baum — der Auslöser des Fehlers fehlt, die Messung wäre blind.')
        }

        const ausreisser: string[] = []
        for (const el of buehne.querySelectorAll<HTMLElement>('*')) {
            if (getComputedStyle(el).position !== 'absolute') {
                continue
            }
            if (!el.checkVisibility()) {
                continue
            }
            if (el.offsetParent === document.body || el.offsetParent === null) {
                ausreisser.push(`${el.tagName.toLowerCase()}.${(el.getAttribute('class') ?? '').slice(0, 40)}`)
            }
        }

        return {
            dokumentScrollH: document.scrollingElement?.scrollHeight ?? -1,
            dokumentClientH: document.scrollingElement?.clientHeight ?? -1,
            fensterH: window.innerHeight,
            scrollY: Math.round(window.scrollY),
            buehneScrollH: buehne.scrollHeight,
            buehneClientH: buehne.clientHeight,
            railUnten: Math.round(rail.getBoundingClientRect().bottom),
            tiefsteSrOnly: Math.round(Math.max(...srOnly.map((s) => s.getBoundingClientRect().bottom))),
            ausreisser: ausreisser.slice(0, 5),
        }
    })
}

test.beforeAll(() => {
    // Jede Vorlage bekommt ihre eigene Ankündigung (Begründung oben am Cache).
    ankuendigungCache = null
    expect(NSEC, 'NOSTR_TEST_NSEC ist nicht gesetzt').toBeTruthy()
    owner = nak(['key', 'public', NSEC]).trim().split('\n')[0]?.trim() ?? ''
    expect(owner).toHaveLength(64)

    arbeit = mkdtempSync(join(tmpdir(), 'e2e-code-chassis-'))
    const quelle = join(arbeit, 'quelle')
    execFileSync('git', ['init', '-q', '-b', 'main', quelle])
    execFileSync('git', ['-C', quelle, 'config', 'user.email', 't@e.st'])
    execFileSync('git', ['-C', quelle, 'config', 'user.name', 'T'])
    writeFileSync(join(quelle, 'README.md'), '# Chassis\n\nEin Absatz.\n')
    // Der lange Baum IST der Prüfstand: erst unter der Falzkante zeigt sich der
    // Fehler. Bei 45 px Zeilenhöhe reichen 40 Dateien weit über 900 px.
    for (let i = 0; i < DATEIEN; i++) {
        writeFileSync(join(quelle, `datei-${String(i).padStart(2, '0')}.txt`), `Zeile ${i}\n`)
    }
    execFileSync('git', ['-C', quelle, 'add', '-A'])
    execFileSync('git', ['-C', quelle, 'commit', '-qm', 'erste'])
    bare = join(arbeit, 'r.git')
    // `--initial-branch=main`: ohne ihn zeigt HEAD ins Leere und der Client bricht
    // mit `Could not find HEAD` ab (Herleitung in forge-readme.spec.ts).
    execFileSync('git', ['init', '-q', '--bare', '--initial-branch=main', bare])
    execFileSync('git', ['-C', quelle, 'push', '-q', bare, 'main'])
    expect(
        execFileSync('git', ['-C', bare, 'symbolic-ref', 'HEAD'], { encoding: 'utf8' }).trim(),
    ).toBe('refs/heads/main')

    const aus = nak([
        'event', '--auth', '--sec', NSEC, '-k', '30617',
        '-t', `d=${REPO_D}`, '-t', `name=${REPO_D}`,
        '-t', 'description=E2E Chassis unter dem Code-Reiter',
        '-t', `clone=${WORKSPACE_HTTP}/git/${owner}/${REPO_D}`,
        ZOOID_WS,
    ])
    expect(aus, `Der Relay hat ${REPO_D} nicht angenommen: ${aus}`).toContain('success')
    ids.push(eventId(aus))
})

test.afterAll(() => {
    for (const id of ids) {
        nak(['event', '--auth', '--sec', NSEC, '-k', '5', '-e', id, ZOOID_WS])
    }
    if (arbeit) {
        rmSync(arbeit, { recursive: true, force: true })
    }
})

test.describe('Forge: das Chassis unter dem Code-Reiter', () => {
    test('der Dateibaum scrollt die BÜHNE, nicht das Dokument', async ({ page }) => {
        test.setTimeout(120_000)
        await verdrahteGit(page)
        await oeffneRepo(page)
        await ladeBaum(page)

        const m = await messen(page)

        // ── Erst die Vorbedingungen, sonst misst die Zusage nichts ──────────────
        expect(
            m.buehneScrollH,
            `Die Bühne scrollt gar nicht (${m.buehneScrollH} ≤ ${m.buehneClientH}) — dieser Baum ist zu kurz für die Messung.`,
        ).toBeGreaterThan(m.buehneClientH + 100)
        expect(
            m.tiefsteSrOnly,
            `Die unterste sr-only-Spanne steht bei ${m.tiefsteSrOnly}, also ÜBER der Falzkante (${m.fensterH}) — genau der Auslöser fehlt, die Messung wäre blind.`,
        ).toBeGreaterThan(m.fensterH)

        // ── Die Zusage ─────────────────────────────────────────────────────────
        expect(
            m.dokumentScrollH,
            `Das Dokument scrollt (${m.dokumentScrollH} > ${m.fensterH}). Absolut positionierte Nachfahren der Bühne mit fremdem Bezug: ${m.ausreisser.join(', ') || '(keine gefunden)'}`,
        ).toBeLessThanOrEqual(m.fensterH + 1)
    })

    test('die Rail steht am Viewport-Boden — auch wer zu scrollen versucht, schiebt sie nicht weg', async ({ page }) => {
        test.setTimeout(120_000)
        await verdrahteGit(page)
        await oeffneRepo(page)
        await ladeBaum(page)

        const vorher = await messen(page)
        expect(vorher.railUnten, 'Die Rail endet schon vor dem Scrollen über dem Viewport-Boden.').toBe(vorher.fensterH)

        // Der gemeldete Handgriff: am Dokument scrollen. Gibt es dort nichts zu
        // scrollen, bleibt alles stehen — genau das ist die Zusage.
        await page.evaluate(() => window.scrollTo(0, 10_000))
        await page.waitForTimeout(300)
        const nachher = await messen(page)

        expect(nachher.scrollY, 'Das Dokument hat sich verschoben — es gibt einen zweiten Bildlauf.').toBe(0)
        expect(
            nachher.railUnten,
            `Die Rail-Unterkante ist auf ${nachher.railUnten} gewandert (Viewport ${nachher.fensterH}).`,
        ).toBe(nachher.fensterH)
    })

    test('NACHBARN: die vier anderen Reiter bleiben ohne Dokument-Bildlauf', async ({ page }) => {
        test.setTimeout(120_000)
        await verdrahteGit(page)
        await oeffneRepo(page)
        await ladeBaum(page)

        for (const reiter of ['Issues', 'Pull Requests', 'Aktivität', 'Patches']) {
            await page.getByRole('tab', { name: reiter, exact: true }).click()
            await page.waitForTimeout(300)
            const mass = await page.evaluate(() => ({
                doc: document.scrollingElement?.scrollHeight ?? -1,
                fenster: window.innerHeight,
            }))
            expect(mass.doc, `Reiter „${reiter}" scrollt das Dokument.`).toBeLessThanOrEqual(mass.fenster + 1)
        }
    })

    test('KONTROLLE unterhalb xl: dort scrollt das Dokument weiterhin — und soll es', async ({ page }) => {
        test.setTimeout(120_000)
        // Ohne diese Gegenprobe wäre die Zusage oben auch dann grün, wenn irgendwo
        // ein `overflow: hidden` den Bildlauf ÜBERALL abgewürgt hätte.
        await verdrahteGit(page)
        await oeffneRepo(page)
        await ladeBaum(page)

        await page.setViewportSize({ width: 390, height: 844 })
        await page.waitForTimeout(400)
        await expect(page.locator('[data-forge-baum]')).toBeVisible()

        const mass = await page.evaluate(() => {
            const buehne = document.querySelector('#buehne') as HTMLElement | null

            return {
                doc: document.scrollingElement?.scrollHeight ?? -1,
                fenster: window.innerHeight,
                buehneOverflow: buehne ? getComputedStyle(buehne).overflowY : '(keine Bühne)',
            }
        })
        expect(mass.buehneOverflow, 'Unterhalb xl darf die Bühne kein eigener Scrollport sein.').toBe('visible')
        expect(mass.doc, 'Unterhalb xl muss das Dokument scrollen — der Baum ist länger als der Schirm.').toBeGreaterThan(mass.fenster)
    })
})
