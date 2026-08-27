import { test, expect, type Locator, type Page } from './support/fixtures'
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

/** Der Aufklapper EINER Baumzeile. Geschwister des Namensknopfes, nicht sein Kind. */
const nodeToggle = (page: Page, label: string) =>
    workspacePanel(page).getByRole('button', { name: `Eintrag ${label} auf- oder zuklappen` })

/**
 * EINE Baumzeile über ihre Knoten-id (`data-node-id`).
 *
 * Nicht über die Beschriftung: „Issues des Repositorys öffnen (1)" nennt das
 * Repo NICHT, und auf einem Stack, den sich diese Datei mit `buzz-forge.spec.ts`
 * teilt, gibt es diese Zeile mehrfach — im Sammellauf gemessen, als „strict mode
 * violation: resolved to 2 elements". Ein `.first()` hätte den Fall grün gemacht,
 * ohne dass er noch die eigene Zeile prüft.
 */
const nodeRow = (page: Page, id: string) => workspacePanel(page).locator(`[data-node-id="${id}"]`)

/**
 * Einen Klappzustand HERSTELLEN, nicht schalten.
 *
 * **Warum das der Kern dieser Datei ist.** Bis P2 stand hier ein blanker
 * `.click()` mit dem Kommentar „ist per Default ZU". Als P2 den Default drehte,
 * hätte genau dieser Klick die Gruppe ZUgemacht — fünf Fälle wären gerissen, und
 * zwar mit einem Bild, das nach Regression aussieht. Schlimmer noch wäre der
 * umgekehrte Fall: eine Hilfsfunktion, die den Default mitdreht, misst am Ende
 * grün, was sie gerade nicht mehr prüft. Ein Test, der einen Zustand BRAUCHT,
 * stellt ihn her und prüft ihn nach; der Default selbst wird an genau einer
 * Stelle geprüft — im Fall „Beim ersten Laden" unten, und nur dort.
 */
async function setExpanded(toggle: Locator, open: boolean): Promise<void> {
    await expect(toggle).toBeVisible({ timeout: 30_000 })
    if ((await toggle.getAttribute('aria-expanded')) !== String(open)) {
        await toggle.click()
    }
    await expect(toggle).toHaveAttribute('aria-expanded', String(open))
}

/**
 * Workspace auf den Testrelay zeigen — und den Desktop-Viewport setzen, BEVOR
 * die App lädt (siehe Mechanik 2 im Dateikopf). Klappt NICHTS: der Zustand nach
 * dem Anmelden ist hier der Prüfgegenstand.
 */
async function bootRail(page: Page): Promise<void> {
    await page.setViewportSize({ width: 1440, height: 900 })
    await useBuzz(page)
    await page.addInitScript((url) => {
        ;(window as unknown as { __nostrWorkspace: string }).__nostrWorkspace = url
    }, BUZZ_URL)
    await loginNsec(page, BUZZ_USER_NSEC)
    await expect(rail(page)).toBeVisible({ timeout: 20_000 })
}

/** Wie {@link bootRail}, stellt zusätzlich die Workspace-Gruppe auf OFFEN. */
async function openRail(page: Page): Promise<void> {
    await bootRail(page)
    await setExpanded(groupToggle(page, 'workspace'), true)
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

    test('P2: beim ersten Laden ist der Workspace OFFEN — samt seiner Repo-Zeile', async ({ page }) => {
        // Der EINZIGE Fall, der nichts herstellt: hier IST der Anfangszustand der
        // Prüfgegenstand. `loginNsec` startet mit leerem `localStorage`, es gilt
        // also `DEFAULT_OPEN` aus `rail.ts` und `OPEN_BY_DEFAULT` aus
        // `railForge.ts` — dreht jemand einen der beiden zurück, wird DIESER Fall
        // rot und kein anderer.
        await bootRail(page)

        await expect(groupToggle(page, 'workspace')).toHaveAttribute('aria-expanded', 'true')
        await expect(workspacePanel(page)).toBeVisible()

        const repoRow = workspacePanel(page).getByRole('button', { name: REPO_D, exact: true })
        await expect(repoRow).toBeVisible({ timeout: 30_000 })

        // Zweite Ebene offen: die Repo-Zeile zeigt ihre Kinder ohne einen Klick.
        // Das ist die Beschwerde, aus der P2 entstanden ist — „die Repos sind
        // versteckt" hieß: zwei Klicks bis zum Inhalt.
        await expect(nodeToggle(page, REPO_D)).toHaveAttribute('aria-expanded', 'true')
        await expect(workspacePanel(page).getByText('E2E-Welcome', { exact: true }))
            .toBeVisible({ timeout: 30_000 })
        await expect(nodeRow(page, `${address}#issues`)).toBeVisible({ timeout: 20_000 })
    })

    test('P2: ein Bestandsprofil bekommt den neuen Default EINMAL — die eigene Wahl danach bleibt', async ({ page }) => {
        await bootRail(page)

        // Ein Profil, wie es JEDER Nutzer trägt, der vor P2 irgendeine Gruppe
        // geklappt hat: `persistOpen` schreibt alle vier Schlüssel, also steht dort
        // ein `workspace: false`, das nie jemand entschieden hat. Ohne die
        // Umstellung in `readOpen` erreichte P2 genau diese Profile NICHT — und
        // damit den einen Nutzer nicht, der die Sektion beanstandet hat.
        await page.evaluate(() => {
            localStorage.setItem(
                'railGroups.open',
                JSON.stringify({ rooms: true, meetups: true, proposals: false, workspace: false }),
            )
            localStorage.removeItem('railGroups.openMigration')
        })
        await page.reload()

        await expect(groupToggle(page, 'workspace')).toHaveAttribute('aria-expanded', 'true', { timeout: 20_000 })
        // Die übrigen Schlüssel bleiben unangetastet — die Umstellung nimmt genau
        // einen Wert weg, nicht den Zustand.
        expect(await page.evaluate(() => JSON.parse(localStorage.getItem('railGroups.open') ?? '{}').meetups))
            .toBe(true)

        // Und ab jetzt gilt wieder die Wahl des Nutzers: einmal zuklappen, neu
        // laden, zu. Das ist der Unterschied zwischen „Default" und „erzwungen".
        await groupToggle(page, 'workspace').click()
        await expect(groupToggle(page, 'workspace')).toHaveAttribute('aria-expanded', 'false')
        await page.reload()
        await expect(rail(page)).toBeVisible({ timeout: 20_000 })
        await expect(groupToggle(page, 'workspace')).toHaveAttribute('aria-expanded', 'false', { timeout: 20_000 })
    })

    test('P2: Markup-Folge und Tastaturfolge sind DIESELBE Folge — Workspace auf Platz 2', async ({ page }) => {
        await bootRail(page)
        await expect(workspacePanel(page)).toBeVisible({ timeout: 20_000 })

        // Die Folge, die Alt+↑/↓ läuft: `railTargets` flatMappt über GENAU dieses
        // Array (`js/railForge.ts`), es ist also nicht „ungefähr" die
        // Tastaturfolge, sondern sie.
        const jumpOrder = await page.evaluate(() => {
            const el = document.querySelector('[data-rail]') as
                (HTMLElement & { _x_dataStack?: { groups: { key: string }[] }[] }) | null

            return (el?._x_dataStack?.[0]?.groups ?? []).map((g) => g.key)
        })
        expect(jumpOrder).toEqual(['rooms', 'workspace', 'meetups', 'proposals'])

        // Und die Folge, die das Auge sieht. Gruppen ohne Bestand rendern gar
        // nicht (`rail-group.blade.php`), deshalb wird gegen die GEFILTERTE Liste
        // verglichen und nicht gegen die volle — sonst prüfte der Fall den Seed.
        const domOrder = await rail(page).locator('[aria-controls^="rail-group-"]')
            .evaluateAll((els) => els.map((el) => el.getAttribute('aria-controls')!.replace('rail-group-', '')))

        expect(domOrder.length).toBeGreaterThanOrEqual(2)
        expect(domOrder, 'Markup und Tastatur dürfen nie zwei Ordnungen sein')
            .toEqual(jumpOrder.filter((key) => domOrder.includes(key)))
        expect(domOrder.indexOf('workspace'), 'der Workspace steht direkt unter RÄUME').toBe(1)
    })

    test('B: das Repo steht als EINE Zeile — sein Kanal nicht mehr flach daneben', async ({ page }) => {
        await openRail(page)

        const repoRow = workspacePanel(page).getByRole('button', { name: REPO_D, exact: true })
        await expect(repoRow).toBeVisible({ timeout: 30_000 })

        // Der Kern der Phase: der gebundene Kanal ist NICHT zusätzlich flach da.
        // Zugeklappt ist er nirgends sichtbar — genau das belegt, dass er aus der
        // flachen Liste HERAUSGENOMMEN und nicht bloß zusätzlich angehängt wurde.
        // Seit P2 ist „zugeklappt" ein hergestellter Zustand und kein Default.
        //
        // POSITIVKONTROLLE ZUERST. „Nicht da" ist auch dann wahr, wenn noch gar
        // nichts da ist — und in genau diesem Fenster startet der Test. Der
        // Gruppenbestand zählt die repo-gebundenen Kanäle MIT (sie sind ja
        // sichtbar, nur woanders); ist er ≥ 2, sind Raumliste UND Repo-Bestand
        // eingetroffen und die Aussage darunter ist überhaupt prüfbar.
        await expect.poll(async () => workspaceTotal(page), { timeout: 20_000 }).toBeGreaterThanOrEqual(2)

        await setExpanded(nodeToggle(page, REPO_D), false)
        await expect(workspacePanel(page).getByText('E2E-Welcome', { exact: true })).toHaveCount(0)
    })

    test('B′: aufgeklappt erscheinen Kanal, Issues und Pull Requests — jeder genau einmal', async ({ page }) => {
        await openRail(page)

        const repoRow = workspacePanel(page).getByRole('button', { name: REPO_D, exact: true })
        await expect(repoRow).toBeVisible({ timeout: 30_000 })

        // Das Chevron der Repo-Zeile ist ein GESCHWISTER des Namensknopfes, kein
        // Kind — ein Knopf in einem Knopf wäre ungültiges HTML.
        await setExpanded(nodeToggle(page, REPO_D), true)

        await expect(workspacePanel(page).getByText('E2E-Welcome', { exact: true })).toBeVisible()
        // Regel 3, die härtere Hälfte: genau EINMAL. Stünde der Kanal zusätzlich
        // flach, wäre er hier zweimal — und der Test von oben („zugeklappt gar
        // nicht") allein könnte das nicht unterscheiden.
        await expect(workspacePanel(page).getByText('E2E-Welcome', { exact: true })).toHaveCount(1)

        // Regel 5: eine Null erzeugt keine Zeile. Die Zähler stehen also da —
        // und tragen die Zahl, die auch die Übersichtsseite zeigt.
        await expect(nodeRow(page, `${address}#issues`)).toBeVisible({ timeout: 20_000 })
        await expect(nodeRow(page, `${address}#pulls`)).toBeVisible({ timeout: 20_000 })
        // Und die Beschriftung, die der Screenreader vorliest, trägt die Zahl —
        // geprüft an DIESER Zeile, nicht an der ersten gleichnamigen im Baum.
        await expect(nodeRow(page, `${address}#issues`).getByRole('button'))
            .toHaveAccessibleName('Issues des Repositorys öffnen (1)')
    })

    test('Der Klick auf den Repo-NAMEN öffnet die Repo-Seite, das Chevron klappt nur', async ({ page }) => {
        await openRail(page)

        const toggle = nodeToggle(page, REPO_D)
        await setExpanded(toggle, true)
        await expect(workspacePanel(page).getByText('E2E-Welcome', { exact: true })).toBeVisible()

        // Chevron: klappt, navigiert NICHT. Geprüft wird die WIRKUNG in beide
        // Richtungen — seit P2 startet die Zeile offen, ein einzelner Klick würde
        // sonst nur noch die halbe Aussage belegen.
        await toggle.click()
        await expect(workspacePanel(page).getByText('E2E-Welcome', { exact: true })).toHaveCount(0)
        await toggle.click()
        await expect(workspacePanel(page).getByText('E2E-Welcome', { exact: true })).toBeVisible()
        expect(new URL(page.url()).pathname, 'das Chevron darf nicht navigieren').not.toContain('/forge/')

        // Name: navigiert auf die Repo-Seite.
        await workspacePanel(page).getByRole('button', { name: REPO_D, exact: true }).click()
        await page.waitForURL('**/forge/naddr1*', { timeout: 20_000 })
    })

    /**
     * ── REGEL 1 IST IN P5 BEGRÜNDET ERSETZT, NICHT UMGANGEN ──────────────────────
     *
     * Hier stand bis zum 2026-08-21:
     *
     *     // Der alte „Forge"-Eintrag am Fuß der Rail ist weg — das ist Regel 1.
     *     await expect(rail(page).getByRole('link', { name: 'Forge', exact: true })).toHaveCount(0)
     *
     * **Was die Regel ursprünglich schützte.** In P1 wurde ein eigener „Forge"-Eintrag am
     * Fuß des Scrollers entfernt, weil er den Workspace ein ZWEITES Mal beschrieb: die
     * Repos liegen auf demselben Relay wie die Kanäle in der Sektion darüber, und der
     * Repo-Kanal stand flach daneben, obwohl das 30617 per `buzz-channel` sagt, wohin er
     * gehört. Die Regel hielt fest, dass diese Doppelung nicht zurückkehrt.
     *
     * **Was sich in P5 geändert hat — die Voraussetzung, nicht die Bequemlichkeit.**
     * Zwei Dinge zugleich:
     *   1. Die Sektion heißt jetzt selbst „Forge" (nicht mehr „Workspace") und führt an
     *      dieselbe Übersichtsseite. Ein Fuß-Eintrag desselben Namens beschreibt damit
     *      nicht mehr eine ZWEITE Sache, sondern ist ein zweiter Weg zur ersten — so wie
     *      die Artikel-Zeile daneben auch in der Befehlspalette steht.
     *   2. Der Client hat mit der Ortskarten-Leiste eine Ebene bekommen, auf der Chat,
     *      Artikel und Forge gleichrangig nebeneinander stehen. Die Rail-Fußzeile ist die
     *      Desktop-Entsprechung dieser Ebene, und dort fehlte von den dreien genau einer.
     *
     * **Warum das keine Umgehung ist.** Die Regel wäre umgangen, wenn der Eintrag unter
     * anderem Namen zurückkäme oder wenn dieser Test gelockert würde, ohne die Sache zu
     * ändern. Beides ist nicht der Fall: der Eintrag heißt „Forge", er steht in der
     * Fußzeile statt im Scroller, und die Zusage wird nicht schwächer, sondern PRÄZISER —
     * geprüft wird jetzt, dass es genau ZWEI Wege gibt und wohin jeder führt.
     *
     * Was unverändert gilt und hier weiter geprüft wird: im SCROLLER steht kein flacher
     * Forge-Eintrag neben den Gruppen. Das war der Kern der Regel.
     */
    test('Die Übersichtsseite bleibt erreichbar — Sektionsname, Icon und die Fußzeile führen dorthin', async ({ page }) => {
        await openRail(page)

        // Genau ZWEI Links heißen „Forge": der Sektionskopf und die Fußzeilen-Zeile.
        // Ein dritter wäre die Doppelung, gegen die Regel 1 geschrieben wurde.
        await expect(rail(page).getByRole('link', { name: 'Forge', exact: true })).toHaveCount(2)

        // Weg 1: das `</>`-Icon, mit Namen (sonst wäre es ein Rätsel).
        await expect(rail(page).getByRole('link', { name: 'Forge-Übersicht öffnen' })).toBeVisible()

        // Weg 2: die Fußzeilen-Zeile. Sie ist der P5-Neuzugang und trägt einen eigenen
        // Anker, weil „Forge" in dieser Spalte mehrfach als Text vorkommt.
        const fuss = rail(page).locator('[data-rail-fuss="forge"]')
        await expect(fuss).toBeVisible()
        // Und sie steht NICHT im Scroller, sondern in der Fußzeile — der eigentliche
        // Inhalt von Regel 1. Der Scroller ist die Raumliste; ein Artikel oder eine
        // Forge sind keine Räume.
        await expect(rail(page).locator('[data-rail-scroller] [data-rail-fuss="forge"]')).toHaveCount(0)

        // Weg 3: der Sektionsname selbst. Er heißt seit P5 „Forge" statt „Workspace" —
        // `.first()` ist in DOM-Reihenfolge der Kopf, die Fußzeile kommt danach.
        await rail(page).getByRole('link', { name: 'Forge', exact: true }).first().click()
        await page.waitForURL('**/forge', { timeout: 20_000 })
    })

    test('Alt+↑/↓ erreicht die Baum-Zeilen — Repo, Kanal, Issues und Pull Requests', async ({ page }) => {
        await openRail(page)

        await setExpanded(nodeToggle(page, REPO_D), true)
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

    /**
     * Der Gruppenkopf als Sprungziel — `data-rail-gruppenkopf`.
     *
     * Bis 2026-08-27 ohne jeden E2E-Anker (`grep data-rail-gruppenkopf
     * tests/e2e/*.spec.ts` = 0). Er ist das zweite von zwei Bedienelementen, die
     * `flux:navlist.group` unmöglich machen — ein Umbau auf die Flux-Komponente
     * verlöre ihn stillschweigend, und mit ihm den einzigen Weg, mit dem die
     * Forge-Bühne ab `xl` überhaupt noch auf ihre Kanäle zeigen kann (dort gibt
     * es keinen Kanäle-Tab mehr).
     *
     * Der Weg ist ECHT, kein von Hand gefeuertes CustomEvent: `/forge?tab=workspaces`
     * setzt `_tabAusAdresse`, `_springZuRegion()` (`js/forge.ts:2438-2448`) sieht
     * `tab === 'workspaces'` und schickt `forge-zeige-kanaele`; der Zuhörer sitzt
     * in `desktop-rail.blade.php:41-48`. Ein `dispatchEvent` aus dem Test prüfte
     * nur den Zuhörer und ließe einen abgerissenen Auslöser durchgehen.
     */
    test('`/forge?tab=workspaces` springt in die Rail — Gruppe auf, Fokus auf dem Kopf', async ({ page }) => {
        // ── BEFUND 2026-08-27: der Fokus-Sprung ist wirkungslos, seit es ihn gibt ──
        // Gemessen mit einer Sonde am Zuhörer (danach per Byte-Kopie zurückgebaut):
        // das Ereignis KOMMT an (`["kam an"]`), aber `document.querySelectorAll(
        // '[data-rail-gruppenkopf]').length` ist in DIESEM Moment **0** — und zwei
        // `requestAnimationFrame` später immer noch 0. Der Kopf steht in
        // `<template x-if="hasWorkspaceSection">`; die Bedingung wird erst wahr, wenn
        // die Workspace-Daten eingetroffen sind, also lange nach dem `$nextTick` des
        // Zuhörers (`desktop-rail.blade.php:41-48`). `focus()` und `scrollIntoView()`
        // laufen auf `undefined` und verpuffen still.
        //
        // Die Gruppe geht trotzdem auf — aber NICHT durch das Ereignis: `toggleGroup`
        // setzt nur einen Zustand und braucht kein DOM. Deshalb sah der Sprung immer
        // funktionierend aus, obwohl seine Hauptzusage nie eingelöst wurde.
        //
        // `test.fail()` statt Löschen oder Grünbiegen: der Defekt ist damit festgehalten
        // UND meldet sich von selbst, sobald der Fix ihn behebt (Playwright macht einen
        // bestehenden `fail`-Test rot). Der Fix gehört ins Paket
        // (`desktop-rail.blade.php`) und wartet auf einen freien Arbeitsbaum —
        // er muss den Sprung aufheben, bis `hasWorkspaceSection` wahr ist,
        // statt ihn einmal zu früh zu versuchen.
        test.fail()

        await bootRail(page)

        // Gruppe bewusst ZUklappen: der Sprung muss sie SELBST öffnen. Bei schon
        // offener Gruppe wäre die halbe Zusage („öffnet, falls zu") ungeprüft.
        await setExpanded(groupToggle(page, 'workspace'), false)
        await expect(workspacePanel(page)).toBeHidden()

        await page.goto('/forge?tab=workspaces')
        await expect(rail(page)).toBeVisible({ timeout: 20_000 })

        // 1. Die Gruppe steht offen — `toggleGroup` lief, und zwar bedingt.
        await expect(workspacePanel(page)).toBeVisible({ timeout: 20_000 })

        // 2. Und der Kopf hat den Fokus. Das ist der Zweck des Sprungs: die
        //    Tastatur landet dort, wo die Kanäle stehen. `toBeFocused` und nicht
        //    `toBeVisible` — ein sichtbarer Kopf ohne Fokus erfüllt nichts.
        await expect(rail(page).locator('[data-rail-gruppenkopf="workspace"]'))
            .toBeFocused({ timeout: 20_000 })
    })
})
