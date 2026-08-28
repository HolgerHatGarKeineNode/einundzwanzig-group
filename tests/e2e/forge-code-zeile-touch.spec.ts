import { test, expect, type Page } from './support/fixtures'
import { useZooid, ZOOID_WS } from './support/zooid'
import { loginNsec } from './support/login'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * **`@media (pointer: coarse)` GERENDERT gemessen — nicht nur als Regel im
 * Stylesheet belegt.**
 *
 * `theme.css` trägt seit dem Layout-Umbau (`9fa0216`) die Zeile:
 *
 *     @media (pointer: coarse) {
 *         .forge-code-zeile > td { height: 2.75rem; }
 *     }
 *
 * — 44 px (Apples HIG) statt der 41 px auf der Maus. Bis hierher war das nur
 * eine Aussage über den GEBAUTEN CSS-Text (Positiv-/Negativkontrolle gegen
 * `public/build/assets/*.css`), keine über den tatsächlich gerenderten DOM.
 * Playwrights `hasTouch` ist eine CONTEXT-Option, in einem laufenden Test
 * nicht umschaltbar — deshalb zwei Contexts, nicht zwei Assertions an
 * derselben Seite.
 *
 * Dieselbe Git-Gegenstelle wie in `desktop-forge-code-chassis.spec.ts`: echtes
 * `git upload-pack --stateless-rpc`, kein Server-Prozess, kein Attrappen-Text.
 * Zwei Dateien reichen — anders als dort geht es hier nicht um den
 * Bildlauf-Überlauf, sondern um EINE Zeilenhöhe.
 */

const NSEC = process.env.NOSTR_TEST_NSEC as string
const NAK = process.env.NAK ?? `${process.env.HOME}/go/bin/nak`

/** Ein eigener `d`-Wert: kein anderer Spec und kein Seed benutzt ihn. */
const REPO_D = 'e2e-code-zeile-touch'

const WORKSPACE_HTTP = ZOOID_WS.replace(/^ws/, 'http').replace(/\/+$/, '')

let arbeit = ''
let bare = ''
let owner = ''
let ankuendigung: Buffer | null = null
const ids: string[] = []

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
                    body: ankuendigung as Buffer,
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

/** Anmelden, das Repository öffnen, klonen und den Baum abwarten. */
async function ladeBaum(page: Page): Promise<void> {
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
    await page
        .locator('[data-forge-repo]')
        .filter({ has: page.getByText(REPO_D, { exact: true }) })
        .first()
        .click()
    await expect(page.locator('[data-forge-code]')).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('[data-forge-code]')).not.toHaveAttribute('data-lage', 'pruefe', { timeout: 30_000 })
    await page.locator('[data-forge-code-start]').click()
    await expect(page.locator('[data-forge-code]')).toHaveAttribute('data-lage', 'da', { timeout: 60_000 })
    await expect(page.locator('[data-forge-baum]')).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('.forge-code-zeile').first()).toBeVisible({ timeout: 30_000 })
}

/** Höhe der ERSTEN Datei-/Verzeichniszeile, aus der lebenden `getBoundingClientRect()`. */
async function zeilenhoehe(page: Page): Promise<number> {
    return page.evaluate(() => {
        const zelle = document.querySelector('.forge-code-zeile > td')
        if (!zelle) {
            throw new Error('Keine `.forge-code-zeile > td` im DOM — die Sonde misst nichts.')
        }

        return zelle.getBoundingClientRect().height
    })
}

test.beforeAll(() => {
    expect(NSEC, 'NOSTR_TEST_NSEC ist nicht gesetzt').toBeTruthy()
    owner = nak(['key', 'public', NSEC]).trim().split('\n')[0]?.trim() ?? ''
    expect(owner).toHaveLength(64)

    arbeit = mkdtempSync(join(tmpdir(), 'e2e-code-zeile-touch-'))
    const quelle = join(arbeit, 'quelle')
    execFileSync('git', ['init', '-q', '-b', 'main', quelle])
    execFileSync('git', ['-C', quelle, 'config', 'user.email', 't@e.st'])
    execFileSync('git', ['-C', quelle, 'config', 'user.name', 'T'])
    writeFileSync(join(quelle, 'README.md'), '# Zeilenhoehe\n\nEin Absatz.\n')
    writeFileSync(join(quelle, 'datei.txt'), 'Zeile\n')
    execFileSync('git', ['-C', quelle, 'add', '-A'])
    execFileSync('git', ['-C', quelle, 'commit', '-qm', 'erste'])
    bare = join(arbeit, 'r.git')
    execFileSync('git', ['init', '-q', '--bare', '--initial-branch=main', bare])
    execFileSync('git', ['-C', quelle, 'push', '-q', bare, 'main'])

    const adv = execFileSync('git', ['upload-pack', '--stateless-rpc', '--advertise-refs', bare], {
        encoding: 'buffer',
        maxBuffer: 64 * 1024 * 1024,
    })
    ankuendigung = Buffer.concat([Buffer.from('001e# service=git-upload-pack\n0000', 'utf8'), adv])

    const aus = nak([
        'event', '--auth', '--sec', NSEC, '-k', '30617',
        '-t', `d=${REPO_D}`, '-t', `name=${REPO_D}`,
        '-t', 'description=E2E Zeilenhoehe unter pointer:coarse',
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

test.describe('Zeigegerät Maus (Standard-Kontext)', () => {
    test('die Codezeile misst NICHT 44 px — Grundlage für den Kontrast zu coarse', async ({ page }) => {
        test.setTimeout(60_000)
        await verdrahteGit(page)
        await ladeBaum(page)

        const hoehe = await zeilenhoehe(page)
        console.log(`[forge-code-zeile-touch] Maus-Kontext: ${hoehe}px`)
        // 41 px laut `theme.css`-Kommentar (10+20+10+1). Toleranz für Subpixel-
        // Rundung; die Zusage ist die ABGRENZUNG von 44, nicht der exakte Wert.
        expect(hoehe, `Zeile misst ${hoehe}px — 44px wäre der coarse-Wert, der hier NICHT gelten soll.`).toBeLessThan(43)
    })
})

test.describe('Zeigegerät Touch (eigener Context, hasTouch: true)', () => {
    // Datei-scoped `test.use` reicht nicht (gilt für ALLE Describes der Datei);
    // genau deshalb steht die Option HIER, im eigenen Describe — derselbe
    // Mechanismus wie in `emoji-composer-touch-guard.spec.ts`, hier bewusst
    // NUR auf die Hälfte der Datei angewandt, damit der Maus-Kontrast im
    // selben Lauf steht.
    test.use({ hasTouch: true })

    test('die Codezeile misst 44 px unter pointer:coarse — gerendert, nicht nur im Stylesheet', async ({ page }) => {
        test.setTimeout(60_000)
        // Vorbedingung: der Context sieht wirklich `pointer: coarse`, sonst
        // misst die Zusage gleich weiter unten nichts.
        expect(
            await page.evaluate(() => matchMedia('(pointer: coarse)').matches),
            'hasTouch hat (pointer: coarse) nicht gekippt — die Sonde wäre blind.',
        ).toBe(true)

        await verdrahteGit(page)
        await ladeBaum(page)

        const hoehe = await zeilenhoehe(page)
        console.log(`[forge-code-zeile-touch] Touch-Kontext (hasTouch): ${hoehe}px`)
        expect(hoehe, `Zeile misst ${hoehe}px, erwartet 44px (2.75rem, Apples HIG).`).toBeCloseTo(44, 0)
    })
})
