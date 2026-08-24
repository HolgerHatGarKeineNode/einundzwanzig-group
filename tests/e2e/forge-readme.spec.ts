import { test, expect, type Page } from './support/fixtures'
import { useZooid, ZOOID_WS } from './support/zooid'
import { loginNsec } from './support/login'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const NSEC = process.env.NOSTR_TEST_NSEC as string
const NAK = process.env.NAK ?? `${process.env.HOME}/go/bin/nak`

/**
 * DAS README DES CODE-BROWSERS (P6, Plan
 * `2026-08-23T1745-forge-mobil-desktop-amethyst.md`).
 *
 * Sechs Zusagen. Die erste ist die, um die es dem Auftraggeber ging:
 *
 *   1. **NICHTS lädt von selbst.** Ein NIP-34-Repository enthält keinen Code;
 *      um ein README zu zeigen, muss der ganze Baum herunter (der Relay kann
 *      kein `filter=blob:none`, am 2026-08-24 gemessen). Auf einem Telefon im
 *      Mobilfunknetz ist das Datenvolumen des Nutzers. Der Prüfstand zählt
 *      deshalb die Anfragen an `/git/` VOR dem Klick — es müssen null sein.
 *   2. **Die Ansage steht vorher da**, samt Größenordnung.
 *   3. **Der Download ist abbrechbar**, und der Abbruch führt zurück in den
 *      Ausgangszustand statt in einen Fehler.
 *   4. **Ein fremder Git-Host ist kein Fehler**, sondern ein Link.
 *   5. **Ohne abrufbare clone-URL** sagt die Fläche das, statt es zu versuchen.
 *   6. **Und das README wird wirklich gerendert** — echte Git-Unterhaltung,
 *      kein Attrappen-Text.
 *
 * ── Warum hier KEIN Git-Server läuft, und es trotzdem echt ist ──────────────
 *
 * Die Gegenstelle ist `git upload-pack --stateless-rpc` selbst, angebunden über
 * `page.route`: die Anfragen des Clients werden abgefangen und mit der Ausgabe
 * des echten git-Binaries beantwortet. Damit läuft das echte Smart-HTTP-
 * Protokoll — pkt-lines, Aushandlung, Packfile — ohne einen Serverprozess.
 *
 * Der Grund ist nicht Bequemlichkeit: der Workspace dieses Laufs ist der
 * worker-eigene **zooid**, und der ist kein Git-Server. Ein echter Endpunkt
 * gäbe es nur in der Produktion, und dort hängt jede Anfrage an einer
 * Bunker-Signatur mit **±60 s** Gültigkeit (`buzz-auth/src/nip98.rs:32`), die
 * Minuten braucht. Ein Tor, das daran hängt, misst die Uhr statt die Fläche.
 *
 * **Was dieser Prüfstand deshalb NICHT abdeckt** — und das gehört gesagt:
 * ob der echte Buzz-Endpunkt unsere NIP-98-Signatur akzeptiert. Das ist am
 * 2026-08-24 von Hand gemessen (echter Clone, HTTP 200, 8,3 MB) und steht in
 * `docs/plans/…/blobnone/BEFUND.md`.
 */

const REPO_D = 'e2e-readme'
const FREMD_D = 'e2e-readme-fremd'
const OHNE_D = 'e2e-readme-ohne-url'

/** Der Workspace dieses Laufs als http-Ursprung — die clone-URL MUSS darauf zeigen. */
const WORKSPACE_HTTP = ZOOID_WS.replace(/^ws/, 'http').replace(/\/+$/, '')

let arbeit = ''
let bare = ''
let owner = ''
let ids: string[] = []

/**
 * Die Ref-Ankündigung — EINMAL gebaut, dann wiederverwendet.
 *
 * Sie ist bei unveränderter Vorlage konstant; je Anfrage ein `git`-Prozess
 * dafür zu starten ist reine Last. Und die ist messbar: mit diesem Spec im
 * Volllauf kippten zweimal zeitkritische Nachbarspecs
 * (`spaces.spec.ts:501`, `a11y-contrast.spec.ts:642`) — beide seriell grün,
 * beide ohne diesen Spec grün (571/571). Der `upload-pack`-POST muss ein
 * echter Prozess bleiben, die Ankündigung nicht.
 */
let ankuendigungCache: Buffer | null = null
const ankuendigung = (): Buffer => {
    if (!ankuendigungCache) {
        const adv = execFileSync('git', ['upload-pack', '--stateless-rpc', '--advertise-refs', bare], {
            encoding: 'buffer',
            maxBuffer: 64 * 1024 * 1024,
        })
        // pkt-line-Dienstkopf, den ein Smart-HTTP-Server voranstellt.
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

/** Ein 30617 säen und die Event-Id fürs Aufräumen merken. */
const saeeRepo = (dtag: string, cloneUrl: string, web = ''): void => {
    const args = [
        'event', '--auth', '--sec', NSEC, '-k', '30617',
        '-t', `d=${dtag}`, '-t', `name=${dtag}`,
        '-t', `description=E2E README ${dtag}`,
    ]
    if (cloneUrl) {
        args.push('-t', `clone=${cloneUrl}`)
    }
    if (web) {
        args.push('-t', `web=${web}`)
    }
    const aus = nak([...args, ZOOID_WS])
    expect(aus, `Der Relay hat ${dtag} nicht angenommen: ${aus}`).toContain('success')
    ids.push(eventId(aus))
}

/**
 * Die Git-Gegenstelle: `page.route` fängt beide Anfragen ab und beantwortet sie
 * mit der Ausgabe des echten `git upload-pack`.
 *
 * Gibt einen Zähler zurück — die Grundlage der Zusage „nichts lädt von selbst".
 */
async function verdrahteGit(page: Page, opts: { verzoegerung?: number; status?: number } = {}) {
    const zaehler = { anfragen: 0 }
    await page.route('**/git/**', async (route) => {
        zaehler.anfragen += 1
        if (opts.status && opts.status !== 200) {
            await route.fulfill({ status: opts.status, body: 'NIP-98 auth failed' })

            return
        }
        if (opts.verzoegerung) {
            await new Promise((f) => setTimeout(f, opts.verzoegerung))
        }
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

    return zaehler
}

async function oeffneRepo(page: Page, dtag: string): Promise<void> {
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
    // EXAKT, nicht `hasText`: das ist eine Teilzeichenkette, und die Fixtures
    // dieses Laufs teilen sich das Präfix `e2e-readme` — `e2e-readme-fremd`
    // und `e2e-readme-ohne-url` enthalten es beide. Der erste Wurf hat damit
    // beim zweiten Besuch die FALSCHE Zeile geöffnet und `keine-url` gemessen,
    // wo `da` stehen sollte.
    await page
        .locator('[data-forge-repo]')
        .filter({ has: page.getByText(dtag, { exact: true }) })
        .first()
        .click()
    // Auf eine ENTSCHIEDENE Lage warten: `pruefe` ist der Anfangszustand, und
    // eine Messung dagegen liefe gegen ein Skelett.
    await expect(page.locator('[data-forge-readme]')).not.toHaveAttribute('data-lage', 'pruefe', { timeout: 30_000 })
}

/*
 * Die Einrichtung steht auf DATEIEBENE, nicht im ersten `describe`.
 *
 * Playwright bindet `beforeAll` an seinen Block: lag sie im ersten, liefe der
 * zweite `describe` (der Code-Browser) ohne Fixture — kein geseetes 30617, kein
 * `bare` für die Gegenstelle. Genau so ist der erste Lauf gescheitert, und zwar
 * mit einer Meldung, die auf die Fläche zeigte statt auf die fehlende Vorlage.
 */
test.beforeAll(() => {
    expect(NSEC, 'NOSTR_TEST_NSEC ist nicht gesetzt').toBeTruthy()
    owner = nak(['key', 'public', NSEC]).trim().split('\n')[0]?.trim() ?? ''
    expect(owner).toHaveLength(64)

    // Ein echtes Repository mit README — die Vorlage der Gegenstelle.
    arbeit = mkdtempSync(join(tmpdir(), 'e2e-readme-'))
    const quelle = join(arbeit, 'quelle')
    execFileSync('git', ['init', '-q', '-b', 'main', quelle])
    execFileSync('git', ['-C', quelle, 'config', 'user.email', 't@e.st'])
    execFileSync('git', ['-C', quelle, 'config', 'user.name', 'T'])
    writeFileSync(join(quelle, 'README.md'), '# Willkommen\n\nEin **fetter** Absatz aus dem echten Repository.\n')
    writeFileSync(join(quelle, 'index.js'), 'export const x = 1\n')
    // Ein Unterverzeichnis — sonst prüft die Krümelspur nichts.
    mkdirSync(join(quelle, 'src'))
    writeFileSync(join(quelle, 'src', 'app.ts'), 'const gruss = "hallo aus dem Unterverzeichnis"\nexport default gruss\n')
    // Ein echtes 1×1-PNG: es ENTHÄLT NUL-Bytes und wäre bei falscher
    // Prüfreihenfolge „binär". Genau dagegen ist der Wächter geschrieben.
    writeFileSync(
        join(quelle, 'bild.png'),
        Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
            'base64',
        ),
    )
    // Über TEXT_GRENZE (512 000) — der Fall `vendor.js.map`.
    writeFileSync(join(quelle, 'gross.txt'), 'x'.repeat(600_000))
    // Mit NUL, ohne Bild-Endung: der Binärfall.
    writeFileSync(join(quelle, 'daten.bin'), Buffer.from([1, 2, 0, 3, 4, 0, 5]))
    execFileSync('git', ['-C', quelle, 'add', '-A'])
    execFileSync('git', ['-C', quelle, 'commit', '-qm', 'erste'])
    bare = join(arbeit, 'r.git')
    // `--initial-branch=main` ist NICHT Kosmetik: ohne ihn zeigt HEAD des
    // nackten Repos auf `refs/heads/master`, der Push legt aber `main` an —
    // HEAD hängt dann ins Leere, die Ankündigung enthält kein HEAD, und der
    // Client bricht mit `NotFoundError: Could not find HEAD` ab. Genau so
    // ist der erste Lauf gescheitert. Buzz legt seine Repos ebenso an
    // (`api/git/transport.rs:2191`).
    execFileSync('git', ['init', '-q', '--bare', '--initial-branch=main', bare])
    execFileSync('git', ['-C', quelle, 'push', '-q', bare, 'main'])
    // Und die Gegenprobe zur Vorbedingung: HEAD muss auflösbar sein, sonst
    // prüfen die Zusagen unten etwas anderes als sie behaupten.
    expect(
        execFileSync('git', ['-C', bare, 'symbolic-ref', 'HEAD'], { encoding: 'utf8' }).trim(),
    ).toBe('refs/heads/main')

    // Alte Fassungen aufräumen ist hier NICHT nötig: ein 30617 ist
    // ersetzbar, ein zweiter Lauf überschreibt dieselbe Adresse.
    saeeRepo(REPO_D, `${WORKSPACE_HTTP}/git/${owner}/${REPO_D}`)
    saeeRepo(FREMD_D, 'https://github.com/beispiel/fremd', 'https://github.com/beispiel/fremd')
    saeeRepo(OHNE_D, 'ssh://git@example.invalid/nur-ssh.git')
})

test.afterAll(() => {
    for (const id of ids) {
        nak(['event', '--auth', '--sec', NSEC, '-k', '5', '-e', id, ZOOID_WS])
    }
    if (arbeit) {
        rmSync(arbeit, { recursive: true, force: true })
    }
})

test.describe('Forge: das README des Code-Browsers', () => {

    // ── Die Zusage, um die es geht ──────────────────────────────────────────

    test('NICHTS lädt von selbst — null Anfragen an /git/ vor dem Klick', async ({ page }) => {
        const zaehler = await verdrahteGit(page)
        await oeffneRepo(page, REPO_D)

        await expect(page.locator('[data-forge-readme]')).toHaveAttribute('data-lage', 'bereit')
        await expect(page.locator('[data-forge-readme-ansage]')).toBeVisible()
        // Der eigentliche Beweis. Eine Sekunde Ruhe, dann zählen.
        await page.waitForTimeout(1000)
        expect(zaehler.anfragen, 'Die Fläche hat ungefragt geladen.').toBe(0)
    })

    test('KONTROLLE: nach dem Klick zählt derselbe Zähler sehr wohl', async ({ page }) => {
        // Ohne diese Gegenprobe wäre die Zusage darüber auch dann grün, wenn
        // der Zähler gar nicht verdrahtet ist.
        const zaehler = await verdrahteGit(page)
        await oeffneRepo(page, REPO_D)
        await page.locator('[data-forge-readme-start]').click()
        await expect(page.locator('[data-forge-readme]')).toHaveAttribute('data-lage', 'da', { timeout: 60_000 })
        expect(zaehler.anfragen).toBeGreaterThan(0)
    })

    test('die Ansage nennt die Größenordnung, bevor irgendetwas läuft', async ({ page }) => {
        await verdrahteGit(page)
        await oeffneRepo(page, REPO_D)
        const ansage = page.locator('[data-forge-readme-ansage]')
        await expect(ansage).toBeVisible()
        // Die Zahl steht als BELEG da, ausdrücklich als Beispiel — für DIESES
        // Repository kennt sie vorher niemand, und eine erfundene wäre schlimmer.
        await expect(ansage).toContainText('8,3 MB')
        await expect(page.locator('[data-forge-readme-start]')).toBeVisible()
    })

    // ── Der volle Weg ───────────────────────────────────────────────────────

    test('das README wird wirklich geladen und gerendert', async ({ page }) => {
        await verdrahteGit(page)
        await oeffneRepo(page, REPO_D)
        await page.locator('[data-forge-readme-start]').click()

        await expect(page.locator('[data-forge-readme]')).toHaveAttribute('data-lage', 'da', { timeout: 60_000 })
        await expect(page.locator('[data-forge-readme-name]')).toHaveText('README.md')
        const inhalt = page.locator('[data-forge-readme-inhalt]')
        await expect(inhalt).toContainText('Willkommen')
        await expect(inhalt).toContainText('fetter')
        // GERENDERT, nicht roh: die Markdown-Zeichen dürfen nicht im Text stehen.
        await expect(inhalt).not.toContainText('# Willkommen')
        await expect(inhalt.locator('strong')).toHaveText('fetter')
        // Der Stand wird benannt — ein Klon ist eine Momentaufnahme, kein Live-Blick.
        await expect(page.locator('[data-forge-readme-commit]')).toBeVisible()
    })

    test('ein zweiter Besuch lädt NICHT erneut — der Klon liegt lokal', async ({ page }) => {
        const zaehler = await verdrahteGit(page)
        await oeffneRepo(page, REPO_D)
        await page.locator('[data-forge-readme-start]').click()
        await expect(page.locator('[data-forge-readme]')).toHaveAttribute('data-lage', 'da', { timeout: 60_000 })
        const nachErstem = zaehler.anfragen
        expect(nachErstem).toBeGreaterThan(0)


        // Dieselbe Sitzung, dieselbe IndexedDB: neu laden und erneut öffnen.
        await page.goto('/forge?tab=repos')
        await page
            .locator('[data-forge-repo]')
            .filter({ has: page.getByText(REPO_D, { exact: true }) })
            .first()
            .click()
        await expect(page.locator('[data-forge-readme]')).toHaveAttribute('data-lage', 'da', { timeout: 60_000 })
        expect(zaehler.anfragen, 'Der zweite Besuch hat erneut geladen.').toBe(nachErstem)
    })

    // ── Abbruch ─────────────────────────────────────────────────────────────

    test('der Download ist abbrechbar — und der Abbruch ist kein Fehler', async ({ page }) => {
        // Verzögerung, damit `laedt` überhaupt sichtbar wird: ohne sie ist der
        // Vorgang vorbei, bevor der Test hinsieht — und die Zusage wäre grün,
        // ohne den Zustand je berührt zu haben.
        await verdrahteGit(page, { verzoegerung: 4000 })
        await oeffneRepo(page, REPO_D)
        await page.locator('[data-forge-readme-start]').click()

        await expect(page.locator('[data-forge-readme]')).toHaveAttribute('data-lage', 'laedt')
        await expect(page.locator('[data-forge-readme-abbruch]')).toBeVisible()
        await page.locator('[data-forge-readme-abbruch]').click()

        // ZURÜCK in den Ausgangszustand, nicht in einen Fehler: ein zweiter
        // Versuch soll einen Klick entfernt sein.
        await expect(page.locator('[data-forge-readme]')).toHaveAttribute('data-lage', 'bereit')
        await expect(page.locator('[data-forge-readme-fehler]')).toHaveCount(0)
        await expect(page.locator('[data-forge-readme-start]')).toBeVisible()
    })

    // ── Die Lagen ohne Netz ─────────────────────────────────────────────────

    test('ein fremder Git-Host ist kein Fehler, sondern ein Link', async ({ page }) => {
        const zaehler = await verdrahteGit(page)
        await oeffneRepo(page, FREMD_D)
        await expect(page.locator('[data-forge-readme]')).toHaveAttribute('data-lage', 'fremd')
        await expect(page.locator('[data-forge-readme-hinweis]')).toBeVisible()
        await expect(page.locator('[data-forge-readme-start]')).toHaveCount(0)
        // Und es wird gar nicht erst versucht.
        expect(zaehler.anfragen).toBe(0)
    })

    test('ohne abrufbare clone-URL sagt die Fläche das, statt es zu versuchen', async ({ page }) => {
        const zaehler = await verdrahteGit(page)
        await oeffneRepo(page, OHNE_D)
        await expect(page.locator('[data-forge-readme]')).toHaveAttribute('data-lage', 'keine-url')
        await expect(page.locator('[data-forge-readme-hinweis]')).toBeVisible()
        expect(zaehler.anfragen).toBe(0)
    })

    test('ein abgelehnter Zugriff nennt den GRUND, nicht „Fehler beim Laden"', async ({ page }) => {
        await verdrahteGit(page, { status: 401 })
        await oeffneRepo(page, REPO_D)
        await page.locator('[data-forge-readme-start]').click()
        await expect(page.locator('[data-forge-readme]')).toHaveAttribute('data-lage', 'fehler', { timeout: 60_000 })
        const fehler = page.locator('[data-forge-readme-fehler]')
        await expect(fehler).toBeVisible()
        await expect(fehler).toContainText('Mitglied')
    })

    // ── Barrierefreiheit der neuen Bedienelemente ───────────────────────────

    test('K3/K4: Start- und Abbruch-Knopf haben Namen und Größe', async ({ page }) => {
        // Diese Messung gehört eigentlich in K1–K4 der App — dort ist sie
        // unmöglich: jener Prüfstand bringt kein Relay mit, `overview.repos`
        // bleibt leer, und die Repo-Detailseite ist gar nicht erreichbar.
        await verdrahteGit(page, { verzoegerung: 4000 })
        await oeffneRepo(page, REPO_D)

        for (const wahl of ['[data-forge-readme-start]']) {
            const el = page.locator(wahl).first()
            await expect(el).toBeVisible()
            expect((await el.innerText()).trim().length, `${wahl} ohne Namen`).toBeGreaterThan(0)
            const kasten = await el.boundingBox()
            expect(Math.round(kasten?.height ?? 0)).toBeGreaterThanOrEqual(24)
            expect(Math.round(kasten?.width ?? 0)).toBeGreaterThanOrEqual(24)
        }

        await page.locator('[data-forge-readme-start]').click()
        const abbruch = page.locator('[data-forge-readme-abbruch]').first()
        await expect(abbruch).toBeVisible()
        expect((await abbruch.innerText()).trim().length).toBeGreaterThan(0)
        // Der Fortschritt meldet sich der assistiven Technik.
        await expect(page.locator('[data-forge-readme-phase]')).toHaveAttribute('aria-live', 'polite')
    })
})

/**
 * DER CODE-BROWSER (P6): Baum, Dateianzeige, Speicherauskunft.
 *
 * Alles hier liest aus DEMSELBEN Klon wie das README — das ist die Auflage, und
 * der Prüfstand hält sie fest: nach dem einen Download darf keine weitere
 * Anfrage an `/git/` gehen, egal wie tief jemand blättert.
 *
 * Die drei Dateien mit Sonderbehandlung sind echt und liegen im Fixture:
 * ein 1×1-PNG (enthält NUL — wäre bei falscher Prüfreihenfolge „binär"),
 * eine 600-kB-Textdatei (über `TEXT_GRENZE`) und eine NUL-haltige `.bin`.
 */
test.describe('Forge: der Code-Browser', () => {
    /** Repository laden und den Code-Reiter öffnen. */
    async function oeffneCode(page: Page): Promise<void> {
        await oeffneRepo(page, REPO_D)
        if ((await page.locator('[data-forge-readme]').getAttribute('data-lage')) === 'bereit') {
            await page.locator('[data-forge-readme-start]').click()
        }
        await expect(page.locator('[data-forge-readme]')).toHaveAttribute('data-lage', 'da', { timeout: 60_000 })
        await page.getByRole('tab', { name: 'Code', exact: true }).click()
        await expect(page.locator('[data-forge-baum]')).toBeVisible({ timeout: 30_000 })
    }

    test('der Wurzelbaum steht da — Verzeichnisse zuerst', async ({ page }) => {
        await verdrahteGit(page)
        await oeffneCode(page)
        const namen = await page.locator('[data-forge-baum-eintrag]').evaluateAll((els) =>
            els.map((e) => `${e.getAttribute('data-art')}:${e.getAttribute('data-name')}`),
        )
        expect(namen[0]).toBe('tree:src')
        expect(namen).toContain('blob:README.md')
        expect(namen).toContain('blob:index.js')
        expect(namen).toContain('blob:bild.png')
    })

    test('AUFLAGE: Blättern kostet KEIN Byte Netz — ein Datenpfad, nicht zwei', async ({ page }) => {
        const zaehler = await verdrahteGit(page)
        await oeffneCode(page)
        const nachKlon = zaehler.anfragen
        expect(nachKlon).toBeGreaterThan(0)

        // In ein Verzeichnis, wieder heraus, eine Datei öffnen, ein Bild öffnen.
        await page.locator('[data-forge-baum-eintrag][data-name="src"]').click()
        await expect(page.locator('[data-forge-baum-eintrag][data-name="app.ts"]')).toBeVisible()
        await page.locator('[data-forge-baum-hoch]').click()
        await expect(page.locator('[data-forge-baum-eintrag][data-name="index.js"]')).toBeVisible()
        await page.locator('[data-forge-baum-eintrag][data-name="index.js"]').click()
        await expect(page.locator('[data-forge-datei]')).toBeVisible()

        expect(zaehler.anfragen, 'Das Blättern hat nachgeladen.').toBe(nachKlon)
    })

    test('die Krümelspur führt hinein und wieder heraus', async ({ page }) => {
        await verdrahteGit(page)
        await oeffneCode(page)
        await page.locator('[data-forge-baum-eintrag][data-name="src"]').click()
        await expect(page.locator('[data-forge-krumel]')).toContainText('src')
        await page.locator('[data-forge-krumel-wurzel]').click()
        await expect(page.locator('[data-forge-baum-eintrag][data-name="src"]')).toBeVisible()
    })

    test('eine Textdatei wird gezeigt', async ({ page }) => {
        await verdrahteGit(page)
        await oeffneCode(page)
        await page.locator('[data-forge-baum-eintrag][data-name="src"]').click()
        await page.locator('[data-forge-baum-eintrag][data-name="app.ts"]').click()
        const datei = page.locator('[data-forge-datei]')
        await expect(datei).toHaveAttribute('data-art', 'text')
        await expect(page.locator('[data-forge-datei-text]')).toContainText('hallo aus dem Unterverzeichnis')
        await expect(page.locator('[data-forge-datei-name]')).toHaveText('src/app.ts')
    })

    test('WÄCHTER: eine zu grosse Datei wird NICHT gerendert — und sagt warum', async ({ page }) => {
        // Der Fall `vendor.js.map`: 6 MB in den DOM zu schieben und dort zu
        // scheitern wäre keine Entscheidung, sondern ihr Fehlen.
        await verdrahteGit(page)
        await oeffneCode(page)
        await page.locator('[data-forge-baum-eintrag][data-name="gross.txt"]').click()
        const datei = page.locator('[data-forge-datei]')
        await expect(datei).toHaveAttribute('data-art', 'zu-gross')
        await expect(page.locator('[data-forge-datei-hinweis]')).toContainText('600')
        // `toBeHidden`, NICHT `toHaveCount(0)`: `x-show` blendet aus, es
        // entfernt nicht. Die falsche Frage hätte hier einen Defekt gemeldet,
        // wo keiner ist — und die richtige Frage ist ohnehin die des Nutzers.
        await expect(page.locator('[data-forge-datei-text]')).toBeHidden()
    })

    test('KONTROLLE: eine normale Textdatei WIRD gerendert', async ({ page }) => {
        // Ohne diese Gegenprobe wäre die Zusage darüber auch dann grün, wenn
        // die Anzeige gar nichts mehr zeigt.
        await verdrahteGit(page)
        await oeffneCode(page)
        await page.locator('[data-forge-baum-eintrag][data-name="index.js"]').click()
        await expect(page.locator('[data-forge-datei]')).toHaveAttribute('data-art', 'text')
        await expect(page.locator('[data-forge-datei-text]')).toContainText('export const x = 1')
    })

    test('eine Binärdatei wird als solche benannt, nicht als Zeichensalat gezeigt', async ({ page }) => {
        await verdrahteGit(page)
        await oeffneCode(page)
        await page.locator('[data-forge-baum-eintrag][data-name="daten.bin"]').click()
        await expect(page.locator('[data-forge-datei]')).toHaveAttribute('data-art', 'binaer')
        await expect(page.locator('[data-forge-datei-hinweis]')).toBeVisible()
        await expect(page.locator('[data-forge-datei-text]')).toBeHidden()
    })

    test('WÄCHTER: ein PNG ist ein BILD, obwohl es NUL-Bytes enthält', async ({ page }) => {
        // Prüfte die Fläche den Inhalt vor der Endung, landete jedes Bild bei
        // „binär" und würde nie angezeigt.
        await verdrahteGit(page)
        await oeffneCode(page)
        await page.locator('[data-forge-baum-eintrag][data-name="bild.png"]').click()
        await expect(page.locator('[data-forge-datei]')).toHaveAttribute('data-art', 'bild')
        const bild = page.locator('[data-forge-datei-bild]')
        await expect(bild).toBeVisible()
        // `alt` ist der DATEINAME — ein erfundener Bildinhalt wäre eine
        // Behauptung über etwas, das wir nicht kennen.
        await expect(bild).toHaveAttribute('alt', 'bild.png')
        expect(await bild.getAttribute('src')).toMatch(/^blob:/)
    })

    // ── Speicher ────────────────────────────────────────────────────────────

    test('die Speicherauskunft nennt den Klon mit GEMESSENER Grösse', async ({ page }) => {
        await verdrahteGit(page)
        await oeffneCode(page)
        await page.locator('[data-forge-speicher-schalter]').click()
        const zeile = page.locator('[data-forge-speicher-klon]').filter({ hasText: REPO_D })
        await expect(zeile).toHaveCount(1)
        // Eine Zahl, keine Schätzung: die Summe der Dateigrössen im Klon.
        await expect(zeile).toContainText(/\d/)
    })

    test('ein entfernter Klon ist wirklich weg — und die Fläche geht zurück auf Anfang', async ({ page }) => {
        await verdrahteGit(page)
        await oeffneCode(page)
        await page.locator('[data-forge-speicher-schalter]').click()
        await page
            .locator('[data-forge-speicher-klon]')
            .filter({ hasText: REPO_D })
            .locator('[data-forge-speicher-entfernen]')
            .click()

        // Zurück auf Anfang: der Download wird wieder angeboten, statt einen
        // Baum zu zeigen, den es nicht mehr gibt.
        await expect(page.locator('[data-forge-readme]')).toHaveAttribute('data-lage', 'bereit', { timeout: 30_000 })
        await expect(page.locator('[data-forge-code-ansage]')).toBeVisible()
    })
})
