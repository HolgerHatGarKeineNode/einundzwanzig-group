import { test, expect, type Page } from './support/fixtures'
import { useBuzz, BUZZ_URL, BUZZ_PORT, BUZZ_USER_NSEC, BUZZ_OWNER_SEC_HEX, BUZZ_ROOM_WELCOME } from './support/buzz'
import { loginNsec } from './support/login'
import { spawnSync } from 'node:child_process'

/**
 * P1 des Restposten-Plans — die Forge IN der Workspace-Navigation, am echten
 * Markup gegen einen echten Buzz-Relay.
 *
 * ── Zwei Mechaniken, die den Zuschnitt dieser Datei bestimmen ────────────────
 *
 * 1. **Der Dateiname.** `playwright.config.ts:57` filtert im Buzz-Modus auf
 *    `/(?:buzz-.*|pin-room)\.spec\.ts$/` und überspringt alles andere LAUTLOS
 *    („Total: 0 tests", kein Fehler).
 * 2. **Der Viewport.** Im Buzz-Modus fährt nur das Projekt `chromium`, und das
 *    ist auf **1279 px** gepinnt — einen Pixel unter dem `xl`-Breakpoint, ab dem
 *    die Rail überhaupt existiert (`<template x-if="$store.viewport?.desktop">`).
 *    Das `desktop`-Projekt läuft im Buzz-Modus leer (`testMatch: /$^/`). Jeder
 *    Test hier setzt seinen Viewport deshalb selbst, vor dem ersten `goto` —
 *    dieselbe Ausnahme, die `updates.spec.ts` und `room.spec.ts` schon nutzen.
 *
 * ── Was hier steht, und was der Unit-Test trägt ─────────────────────────────
 * Die Baumbildung selbst — vier Zustände, Doppelbeanspruchung, Faltung,
 * Sprungliste — prüft `railForge.test.ts` ohne Docker (31 Fälle). Hier steht
 * nur, was ohne echten Roundtrip nicht prüfbar ist: dass das `buzz-channel` des
 * 30617 am LEBENDEN Relay auf denselben Kanal zeigt, den die Raumliste liefert,
 * und dass das gerenderte Markup die Zustände B und B′ trägt.
 *
 * ── Warum `welcome` und nicht `general` ─────────────────────────────────────
 * `buzz-forge.spec.ts` bindet seine beiden Repos an `general`. Läuft es im
 * selben Worker gegen denselben Stack, gäbe es dort drei Anspruchsteller auf
 * einen Kanal — die Regel „ein Kanal gehört genau einem Repo" entschiede dann
 * über die Koordinate, und dieser Test hinge an einer Sortierung, die er gar
 * nicht meint. Ein eigener Kanal macht die Aussage unabhängig vom Nachbarn.
 */

const NAK = process.env.NAK ?? `${process.env.HOME}/go/bin/nak`
const WS = (): string => `ws://localhost:${BUZZ_PORT}`

/** `d`-Tag des Repos dieser Datei — eigener Name, kein Präfix eines anderen. */
const REPO_D = 'e2e-railwerk'
const ISSUE_SUBJECT = 'E2E Railwerk Issue'
const PR_SUBJECT = 'E2E Railwerk Pull Request'

const nak = (args: string[]): string => {
    const res = spawnSync(NAK, args, { encoding: 'utf8', timeout: 30_000 })

    return `${res.stdout ?? ''}\n${res.stderr ?? ''}`
}

const publish = (sec: string, args: string[]): string => nak(['event', '--auth', '--sec', sec, ...args, WS()])

const query = (args: string[]): string => nak(['req', '--auth', '--sec', BUZZ_USER_NSEC, ...args, WS()])

const ownerPubkey = (): string => nak(['key', 'public', BUZZ_OWNER_SEC_HEX]).trim().split('\n')[0].trim()

/** Nur anlegen, wenn das Kennzeichen noch nicht am Relay steht (Bestandswachstum). */
const publishOnce = (sec: string, findArgs: string[], needle: string, publishArgs: string[]): void => {
    if (query(findArgs).includes(needle)) {
        return
    }
    expect(publish(sec, publishArgs)).toContain('success')
}

const rail = (page: Page) => page.locator('[data-rail]')

/**
 * Der `nostrRail`-Zustand, zwei Felder davon.
 *
 * Zwei Aussagen dieser Datei stehen nicht im Markup und sind trotzdem der Kern:
 * die Sprungliste von Alt+↑/↓ und der Gruppenbestand als POSITIVKONTROLLE. Ohne
 * letztere wäre „der Kanal steht nicht flach da" grün, bevor die Raumliste
 * überhaupt eingetroffen ist — grün aus dem falschen Grund, und zwar genau in
 * dem Fenster, in dem die Aussage nicht prüfbar ist.
 */
const railTargetIds = (page: Page): Promise<string[]> =>
    page.evaluate(() => {
        const el = document.querySelector('[data-rail]') as
            (HTMLElement & { _x_dataStack?: { targets: { id: string }[] }[] }) | null

        return (el?._x_dataStack?.[0]?.targets ?? []).map((target) => target.id)
    })

const workspaceTotal = (page: Page): Promise<number> =>
    page.evaluate(() => {
        const el = document.querySelector('[data-rail]') as
            (HTMLElement & { _x_dataStack?: { groupFor: (key: string) => { total: number } }[] }) | null

        return el?._x_dataStack?.[0]?.groupFor('workspace').total ?? 0
    })

/** Der Aufklapper einer Gruppe — über `aria-controls`, nicht über den Text. */
const groupToggle = (page: Page, key: string) => rail(page).locator(`[aria-controls="rail-group-${key}"]`)

/** Das Panel der Workspace-Gruppe: alles, was zwischen Kopf und nächster Gruppe steht. */
const workspacePanel = (page: Page) => rail(page).locator('#rail-group-workspace')

/**
 * Workspace auf den Testrelay zeigen — und den Desktop-Viewport setzen, BEVOR
 * die App lädt (siehe Mechanik 2 im Dateikopf).
 */
async function openRail(page: Page): Promise<void> {
    await page.setViewportSize({ width: 1440, height: 900 })
    await useBuzz(page)
    await page.addInitScript((url) => {
        ;(window as unknown as { __nostrWorkspace: string }).__nostrWorkspace = url
    }, BUZZ_URL)
    await loginNsec(page, BUZZ_USER_NSEC)
    await expect(rail(page)).toBeVisible({ timeout: 20_000 })

    // Die Workspace-Gruppe ist per Default ZU (`DEFAULT_OPEN` in `rail.ts`).
    // Geklickt wird das Chevron, nicht der Name: der führt seit P1 auf `/forge`.
    await groupToggle(page, 'workspace').click()
    await expect(workspacePanel(page)).toBeVisible()
}

test.describe('Buzz-Workspace: die Forge in der Rail (E2E, nur E2E_RELAY=buzz)', () => {
    test.skip(process.env.E2E_RELAY !== 'buzz', 'nur im Buzz-Modus (E2E_RELAY=buzz) relevant')

    let owner = ''
    let address = ''

    test.beforeAll(() => {
        owner = ownerPubkey()
        expect(owner).toHaveLength(64)
        address = `30617:${owner}:${REPO_D}`

        // Das Repo, gebunden an den `welcome`-Kanal. `buzz-channel` ist die
        // Aussage, um die es in dieser Phase geht; `h` macht das Announcement
        // kanal-gescopet und damit für Kanalmitglieder überhaupt sichtbar.
        expect(
            publish(BUZZ_OWNER_SEC_HEX, [
                '-k', '30617',
                '-t', `d=${REPO_D}`,
                '-t', `name=${REPO_D}`,
                '-t', 'description=E2E Repo fuer die Rail-Navigation',
                '-t', 'clone=https://example.invalid/git/e2e-railwerk',
                '-t', `buzz-channel=${BUZZ_ROOM_WELCOME}`,
                '-t', `h=${BUZZ_ROOM_WELCOME}`,
                '-t', `maintainers=${owner}`,
            ]),
        ).toContain('success')

        publishOnce(
            BUZZ_OWNER_SEC_HEX,
            ['-k', '1621', '-t', `a=${address}`],
            ISSUE_SUBJECT,
            ['-k', '1621', '-t', `a=${address}`, '-t', `p=${owner}`, '-t', `subject=${ISSUE_SUBJECT}`,
             '-c', 'Ein Issue, damit die Zeile „Issues" entsteht.'],
        )

        publishOnce(
            BUZZ_OWNER_SEC_HEX,
            ['-k', '1618', '-t', `a=${address}`],
            PR_SUBJECT,
            ['-k', '1618', '-t', `a=${address}`, '-t', `p=${owner}`, '-t', `subject=${PR_SUBJECT}`,
             '-t', 'branch-name=feature/rail', '-c', 'Ein PR, damit die Zeile „Pull Requests" entsteht.'],
        )
    })

    test('B: das Repo steht als EINE Zeile — sein Kanal nicht mehr flach daneben', async ({ page }) => {
        await openRail(page)

        const repoRow = workspacePanel(page).getByRole('button', { name: REPO_D, exact: true })
        await expect(repoRow).toBeVisible({ timeout: 30_000 })

        // Der Kern der Phase: der gebundene Kanal ist NICHT zusätzlich flach da.
        // Zugeklappt ist er nirgends sichtbar — genau das belegt, dass er aus der
        // flachen Liste HERAUSGENOMMEN und nicht bloß zusätzlich angehängt wurde.
        //
        // POSITIVKONTROLLE ZUERST. „Nicht da" ist auch dann wahr, wenn noch gar
        // nichts da ist — und in genau diesem Fenster startet der Test. Der
        // Gruppenbestand zählt die repo-gebundenen Kanäle MIT (sie sind ja
        // sichtbar, nur woanders); ist er ≥ 2, sind Raumliste UND Repo-Bestand
        // eingetroffen und die Aussage darunter ist überhaupt prüfbar.
        await expect.poll(async () => workspaceTotal(page), { timeout: 20_000 }).toBeGreaterThanOrEqual(2)

        await expect(workspacePanel(page).getByText('E2E-Welcome', { exact: true })).toHaveCount(0)
    })

    test('B′: aufgeklappt erscheinen Kanal, Issues und Pull Requests — jeder genau einmal', async ({ page }) => {
        await openRail(page)

        const repoRow = workspacePanel(page).getByRole('button', { name: REPO_D, exact: true })
        await expect(repoRow).toBeVisible({ timeout: 30_000 })

        // Das Chevron der Repo-Zeile ist ein GESCHWISTER des Namensknopfes, kein
        // Kind — ein Knopf in einem Knopf wäre ungültiges HTML.
        await workspacePanel(page)
            .getByRole('button', { name: `Eintrag ${REPO_D} auf- oder zuklappen` })
            .click()

        await expect(workspacePanel(page).getByText('E2E-Welcome', { exact: true })).toBeVisible()
        // Regel 3, die härtere Hälfte: genau EINMAL. Stünde der Kanal zusätzlich
        // flach, wäre er hier zweimal — und der Test von oben („zugeklappt gar
        // nicht") allein könnte das nicht unterscheiden.
        await expect(workspacePanel(page).getByText('E2E-Welcome', { exact: true })).toHaveCount(1)

        // Regel 5: eine Null erzeugt keine Zeile. Die Zähler stehen also da —
        // und tragen die Zahl, die auch die Übersichtsseite zeigt.
        await expect(
            workspacePanel(page).getByRole('button', { name: 'Issues des Repositorys öffnen (1)' }),
        ).toBeVisible({ timeout: 20_000 })
        await expect(
            workspacePanel(page).getByRole('button', { name: 'Pull Requests des Repositorys öffnen (1)' }),
        ).toBeVisible({ timeout: 20_000 })
    })

    test('Der Klick auf den Repo-NAMEN öffnet die Repo-Seite, das Chevron klappt nur', async ({ page }) => {
        await openRail(page)

        const toggle = workspacePanel(page).getByRole('button', { name: `Eintrag ${REPO_D} auf- oder zuklappen` })
        await expect(toggle).toBeVisible({ timeout: 30_000 })

        // Chevron: klappt, navigiert NICHT.
        await toggle.click()
        await expect(workspacePanel(page).getByText('E2E-Welcome', { exact: true })).toBeVisible()
        expect(new URL(page.url()).pathname, 'das Chevron darf nicht navigieren').not.toContain('/forge/')

        // Name: navigiert auf die Repo-Seite.
        await workspacePanel(page).getByRole('button', { name: REPO_D, exact: true }).click()
        await page.waitForURL('**/forge/naddr1*', { timeout: 20_000 })
    })

    test('Die Übersichtsseite bleibt erreichbar — Sektionsname und Icon führen dorthin', async ({ page }) => {
        await openRail(page)

        // Der alte „Forge"-Eintrag am Fuß der Rail ist weg — das ist Regel 1.
        await expect(rail(page).getByRole('link', { name: 'Forge', exact: true })).toHaveCount(0)

        // Weg 1: das `</>`-Icon, mit Namen (sonst wäre es ein Rätsel).
        await expect(rail(page).getByRole('link', { name: 'Forge-Übersicht öffnen' })).toBeVisible()

        // Weg 2: der Sektionsname selbst.
        await rail(page).getByRole('link', { name: /WORKSPACE/i }).first().click()
        await page.waitForURL('**/forge', { timeout: 20_000 })
    })

    test('Alt+↑/↓ erreicht die Baum-Zeilen — Repo, Kanal, Issues und Pull Requests', async ({ page }) => {
        await openRail(page)

        const toggle = workspacePanel(page).getByRole('button', { name: `Eintrag ${REPO_D} auf- oder zuklappen` })
        await expect(toggle).toBeVisible({ timeout: 30_000 })
        await toggle.click()
        await expect(workspacePanel(page).getByText('E2E-Welcome', { exact: true })).toBeVisible()

        // Erste Hälfte: STEHEN die vier Zeilen in der Sprungliste? Das ist die
        // Menge, die Alt+↑/↓ durchläuft — sie kommt aus derselben Funktion, die
        // auch das Markup rendert (`railTargets`, `railForge.ts`). Die
        // REIHENFOLGE prüft `railForge.test.ts` deterministisch; hier geht es
        // darum, dass am lebenden Relay keine Zeile fehlt.
        //
        // `expect.poll`, weil Issues und PRs aus der ZWEITEN Laderunde kommen
        // (`#a`-gescopet auf die Repos der ersten) und deshalb später eintreffen
        // als der Kanal.
        await expect
            .poll(async () => railTargetIds(page), { timeout: 20_000 })
            .toEqual(expect.arrayContaining([
                `30617:${owner}:${REPO_D}`,
                `room:${BUZZ_ROOM_WELCOME}`,
                `30617:${owner}:${REPO_D}#issues`,
                `30617:${owner}:${REPO_D}#pulls`,
            ]))

        // Zweite Hälfte, und die zählt: ein echter Tastendruck. Von der Repo-SEITE
        // aus ist das aktive Ziel die Repo-Zeile (eindeutig über ihre Koordinate),
        // und Alt+↓ muss auf deren erstes Kind springen — den gebundenen Kanal.
        // Vor P1 lief diese Taste ausschließlich über Räume; eine Baum-Zeile war
        // für sie unerreichbar.
        await workspacePanel(page).getByRole('button', { name: REPO_D, exact: true }).click()
        await page.waitForURL('**/forge/naddr1*', { timeout: 20_000 })
        await expect(rail(page)).toBeVisible({ timeout: 20_000 })
        await expect(workspacePanel(page).getByText('E2E-Welcome', { exact: true })).toBeVisible({ timeout: 20_000 })

        await page.keyboard.press('Alt+ArrowDown')
        await page.waitForURL(`**/rooms/${BUZZ_ROOM_WELCOME}*`, { timeout: 20_000 })
    })
})
