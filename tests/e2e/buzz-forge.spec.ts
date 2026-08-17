import { test, expect, type Page } from './support/fixtures'
import { useBuzz, BUZZ_URL, BUZZ_PORT, BUZZ_USER_NSEC, BUZZ_OWNER_SEC_HEX, BUZZ_ROOM_GENERAL } from './support/buzz'
import { loginNsec } from './support/login'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'

/**
 * P6 des Buzz-Workspace-Plans — die Forge-Ansichten (NIP-34 + NIP-MP) gegen
 * einen echten Buzz-Relay.
 *
 * ── Der Dateiname ist Teil der Mechanik ──────────────────────────────────────
 * `playwright.config.ts:57` filtert im Buzz-Modus auf
 * `/(?:buzz-.*|pin-room)\.spec\.ts$/` und überspringt alles andere LAUTLOS
 * („Total: 0 tests", kein Fehler).
 *
 * ── Was hier steht, und warum es nicht der Unit-Test trägt ───────────────────
 * Die Faltung selbst (Status aus 1630–1633, PR aus 1618+1619, Projekt→Repo,
 * Grabsteine) prüft `forgeModels.test.ts` ohne Docker. Hier steht nur, was ohne
 * echten Roundtrip nicht prüfbar ist:
 *
 *   1. **Sieht ein normales Mitglied das Repo überhaupt?** Ein 30617 mit
 *      `buzz-channel`/`h` ist kanal-gescopet (`handlers/req.rs`,
 *      `apply_access_scope_to_query`). Ein Client, der nur mit Owner-Schlüssel
 *      getestet wurde, wäre für alle anderen leer — und niemand merkte es.
 *   2. **Ist der Branch-Zustand zu finden?** Das 30618 ist RELAY-signiert (am
 *      Testrelay nachgemessen: Autor == NIP-11-`self`, `p` == Ankündiger). Ohne
 *      `relaySelf` im Autorenfilter bliebe die Anzeige still leer.
 *   3. **Faltet die Fläche zwei Statuswechsel richtig?** 1630 und danach 1632
 *      am selben Issue — der neuere gewinnt, sichtbar in der Zeile.
 *   4. **Zieht ein Statuswechsel OHNE Reload nach?** Das prüft das
 *      `limit:0`-Abo (`watchForge`), nicht die Faltung.
 *   5. **Sehen die Leerzustände gut aus, wenn wirklich nichts da ist?** Dafür
 *      gibt es ein zweites, absichtlich leeres Repository.
 *
 * ── Bestandswachstum ────────────────────────────────────────────────────────
 * Alle festen Fixtures sind idempotent: 30617/30618 sind ersetzbar (gleiches
 * `d` überschreibt), Issues und Statuswechsel werden vorher gesucht und nur bei
 * Fehlen geschrieben. Der Live-Test legt bewusst je Lauf **ein** frisches Issue
 * plus **einen** Statuswechsel an — anders ist ein Nachziehen ohne Reload nicht
 * zu beweisen. Der Bloat-Wächter in `buzz-testserver.sh` zählt kind-39000-Kanäle
 * und kind-9 im `welcome`-Kanal; beides berührt diese Datei nicht.
 */

const NAK = process.env.NAK ?? `${process.env.HOME}/go/bin/nak`
const WS = (): string => `ws://localhost:${BUZZ_PORT}`

/** `d`-Tag des Repos mit Inhalt und des absichtlich leeren Gegenstücks. */
const REPO_D = 'e2e-forge'
/**
 * **Kein gemeinsames Präfix mit {@link REPO_D}** — und das ist kein Geschmack:
 * `getByRole(…, { name })` und `filter({ hasText })` matchen per Voreinstellung
 * als TEILZEICHENKETTE. Mit `e2e-forge-leer` öffnete `filter({hasText:'e2e-forge'})`
 * das leere Repo (es steht als jüngeres zuerst), und der Test schlug an einer
 * fehlenden Clone-URL fehl statt an der Sache. Ein eigener Name schließt die
 * Verwechslung aus, statt sie mit `exact: true` an jeder Fundstelle zu jagen.
 */
const EMPTY_REPO_D = 'e2e-leerrepo'

/** Commit, den der geseedete Branch-Zustand trägt (40 Hex, wie ein echter). */
const COMMIT = 'ca1c707b2d1f21849fca434d3683e238d1365e62'

const ISSUE_OPEN = 'E2E Zwergotter offen'
const ISSUE_CLOSED = 'E2E Zwergotter geschlossen'
const PR_SUBJECT = 'E2E Zwergotter Pull Request'

const nak = (args: string[]): string => {
    const res = spawnSync(NAK, args, { encoding: 'utf8', timeout: 30_000 })

    return `${res.stdout ?? ''}\n${res.stderr ?? ''}`
}

const publish = (sec: string, args: string[]): string => nak(['event', '--auth', '--sec', sec, ...args, WS()])

const query = (args: string[]): string => nak(['req', '--auth', '--sec', BUZZ_USER_NSEC, ...args, WS()])

/** Pubkey des Owner-Schlüssels — zugleich Eigentümer beider Test-Repos. */
const ownerPubkey = (): string => nak(['key', 'public', BUZZ_OWNER_SEC_HEX]).trim().split('\n')[0].trim()

const repoAddress = (owner: string, dtag: string): string => `30617:${owner}:${dtag}`

/**
 * Ein Ereignis nur anlegen, wenn sein Kennzeichen noch nicht am Relay steht.
 *
 * Ohne diese Bremse wächst der Bestand bei jedem Lauf, und der zweite Durchgang
 * scheitert an Playwrights Strict-Mode statt an der Sache — genau der Fehler,
 * der in `buzz-space-search.spec.ts` schon einmal als Testfehler gelesen wurde.
 */
const publishOnce = (sec: string, findArgs: string[], needle: string, publishArgs: string[]): void => {
    if (query(findArgs).includes(needle)) {
        return
    }
    expect(publish(sec, publishArgs)).toContain('success')
}

/** Die Id des Issues mit diesem `subject` — `''`, wenn es keins gibt. */
const issueIdBySubject = (address: string, subject: string): string => {
    const out = query(['-k', '1621', '-t', `a=${address}`])
    for (const line of out.split('\n')) {
        if (!line.startsWith('{')) {
            continue
        }
        try {
            const event = JSON.parse(line) as { id: string; tags: string[][] }
            if (event.tags.some((tag) => tag[0] === 'subject' && tag[1] === subject)) {
                return event.id
            }
        } catch {
            // Zeile war kein Ereignis (nak schreibt auch Fortschritt auf stdout).
        }
    }

    return ''
}

/**
 * Workspace auf den Testrelay zeigen.
 *
 * `useBuzz` schaltet ihn bewusst AUS (sonst spräche der Lauf das
 * **Produktions**-Buzz an, das in der lokalen `.env` steht). Hier IST der
 * Testrelay der Workspace — die spätere Zuweisung gewinnt.
 */
async function useWorkspace(page: Page): Promise<void> {
    await useBuzz(page)
    await page.addInitScript((url) => {
        ;(window as unknown as { __nostrWorkspace: string }).__nostrWorkspace = url
    }, BUZZ_URL)
    await loginNsec(page, BUZZ_USER_NSEC)
}

test.describe('Buzz-Workspace: Forge lesen (E2E, nur E2E_RELAY=buzz)', () => {
    test.skip(process.env.E2E_RELAY !== 'buzz', 'nur im Buzz-Modus (E2E_RELAY=buzz) relevant')

    let owner = ''
    let address = ''

    test.beforeAll(() => {
        owner = ownerPubkey()
        expect(owner).toHaveLength(64)
        address = repoAddress(owner, REPO_D)

        // ── Das Repo mit Inhalt ────────────────────────────────────────────
        // `buzz-channel`/`h` binden es an den `general`-Kanal: damit ist es
        // KANAL-GESCOPET und nur für dessen Mitglieder sichtbar. Genau die
        // Form, die auch am Produktions-Relay liegt — und die Vorbedingung von
        // Punkt 1 im Dateikopf.
        expect(
            publish(BUZZ_OWNER_SEC_HEX, [
                '-k', '30617',
                '-t', `d=${REPO_D}`,
                '-t', `name=${REPO_D}`,
                '-t', 'description=E2E Forge Testrepo',
                '-t', 'clone=https://example.invalid/git/e2e-forge',
                '-t', `buzz-channel=${BUZZ_ROOM_GENERAL}`,
                '-t', `h=${BUZZ_ROOM_GENERAL}`,
                '-t', `maintainers=${owner}`,
                '--tag', 'buzz-protect=refs/heads/master;no-force-push',
            ]),
        ).toContain('success')

        // Der Branch-Zustand. Der Relay schreibt beim Ankündigen selbst ein
        // 30618, das aber nur `HEAD` und keinen Ref trägt (am Testrelay
        // nachgesehen) — für eine sichtbare Branch-Zeile braucht es einen mit
        // Commit. Signiert vom EIGENTÜMER; `foldRepoState` lässt Eigentümer und
        // Relay-`self` zu, wie es auch Buzz Desktop tut.
        expect(
            publish(BUZZ_OWNER_SEC_HEX, [
                '-k', '30618',
                '-t', `d=${REPO_D}`,
                '--tag', `refs/heads/master=${COMMIT}`,
                '--tag', 'HEAD=ref: refs/heads/master',
                '-t', `p=${owner}`,
            ]),
        ).toContain('success')

        // ── Das absichtlich LEERE Repo — Grundlage der Leerzustände ────────
        expect(
            publish(BUZZ_OWNER_SEC_HEX, [
                '-k', '30617',
                '-t', `d=${EMPTY_REPO_D}`,
                '-t', `name=${EMPTY_REPO_D}`,
                '-t', 'description=Ohne Issues und ohne Pull Requests',
                '-t', `buzz-channel=${BUZZ_ROOM_GENERAL}`,
                '-t', `h=${BUZZ_ROOM_GENERAL}`,
            ]),
        ).toContain('success')

        // ── Ein offenes Issue (kein Status-Ereignis) ───────────────────────
        publishOnce(
            BUZZ_OWNER_SEC_HEX,
            ['-k', '1621', '-t', `a=${address}`],
            ISSUE_OPEN,
            ['-k', '1621', '-t', `a=${address}`, '-t', `p=${owner}`, '-t', `subject=${ISSUE_OPEN}`,
             '-c', 'Ein **Testissue** für P6.'],
        )

        // ── Ein Issue mit ZWEI Statuswechseln: 1630, danach 1632 ───────────
        publishOnce(
            BUZZ_OWNER_SEC_HEX,
            ['-k', '1621', '-t', `a=${address}`],
            ISSUE_CLOSED,
            ['-k', '1621', '-t', `a=${address}`, '-t', `p=${owner}`, '-t', `subject=${ISSUE_CLOSED}`,
             '-c', 'Wird gleich geschlossen.'],
        )
        const closedId = issueIdBySubject(address, ISSUE_CLOSED)
        expect(closedId).toHaveLength(64)
        publishOnce(
            BUZZ_OWNER_SEC_HEX,
            ['-k', '1630', '-t', `a=${address}`],
            closedId,
            ['-k', '1630', '--tag', `e=${closedId};;root`, '-t', `a=${address}`],
        )
        publishOnce(
            BUZZ_OWNER_SEC_HEX,
            ['-k', '1632', '-t', `a=${address}`],
            closedId,
            ['-k', '1632', '--tag', `e=${closedId};;root`, '-t', `a=${address}`],
        )

        // ── Ein Pull Request mit einem Update (1619 referenziert über `E`) ──
        publishOnce(
            BUZZ_OWNER_SEC_HEX,
            ['-k', '1618', '-t', `a=${address}`],
            PR_SUBJECT,
            ['-k', '1618', '-t', `a=${address}`, '-t', `p=${owner}`, '-t', `subject=${PR_SUBJECT}`,
             '-t', 'branch-name=feat/zwergotter', '-t', 'target-branch=master',
             '-t', `c=${COMMIT}`, '-c', 'Ein Testvorschlag.'],
        )
    })

    /**
     * Punkt 1 als Relay-Messung, OHNE Browser: sieht ein normales Mitglied das
     * kanal-gescopete Announcement? Eine Fläche, die für den Owner funktioniert
     * und für alle anderen leer bleibt, wäre die teuerste Art, das zu übersehen.
     */
    test('ein normales Mitglied sieht das kanal-gescopete Repo am Relay', () => {
        const out = query(['-k', '30617', '-t', `d=${REPO_D}`])
        expect(out).toContain(REPO_D)
        expect(out).toContain('30617')
    })

    test('die Übersicht zeigt Kacheln, das Repo und eine Aktivitätszeile', async ({ page }) => {
        await useWorkspace(page)
        await page.goto('/forge')

        // Die Kacheln erscheinen erst, wenn der Relay geantwortet hat — vorher
        // wäre eine `0` eine Falschaussage.
        const repoTile = page.locator('[data-forge-tile="repos"]')
        await expect(repoTile).toBeVisible({ timeout: 30_000 })
        expect(Number(await repoTile.innerText())).toBeGreaterThanOrEqual(2)
        expect(Number(await page.locator('[data-forge-tile="issues"]').innerText())).toBeGreaterThanOrEqual(2)
        expect(Number(await page.locator('[data-forge-tile="pullRequests"]').innerText())).toBeGreaterThanOrEqual(1)

        // Die Zeitleiste steht auf dem ersten Tab und trägt Sätze, keine Kinds.
        await expect(page.locator('[data-forge-activity][data-type="repo-created"]').first()).toBeVisible()

        await page.getByRole('tab', { name: 'Repositories' }).click()
        await expect(page.locator('[data-forge-repo]').filter({ hasText: REPO_D }).first()).toBeVisible()
    })

    /**
     * Punkt 5: der Leerzustand ist eine AUSSAGE, keine leere Fläche. Geprüft am
     * Tab „Projekte" — es liegt bewusst kein einziges kind 30621 am Relay, so
     * wie am Produktions-Relay auch.
     */
    test('ohne Projekte steht eine Leermeldung, keine leere Fläche', async ({ page }) => {
        await useWorkspace(page)
        await page.goto('/forge')
        await expect(page.locator('[data-forge-tile="projects"]')).toBeVisible({ timeout: 30_000 })

        await page.getByRole('tab', { name: 'Projekte' }).click()
        const empty = page.locator('[data-forge-empty="projects"]')
        await expect(empty).toBeVisible()
        await expect(empty).toContainText('Noch keine Projekte')
        // Und der Ausweg daneben ist echt: er schaltet auf die Repo-Liste.
        await page.getByRole('button', { name: 'Zu den Repositories' }).click()
        await expect(page.locator('[data-forge-repo]').first()).toBeVisible()
    })

    /**
     * Punkte 2 und 3 an einem Bildschirm: Clone-URL, Branch samt Commit aus dem
     * 30618, der Branch-Schutz aus `buzz-protect` — und die Statusfaltung, bei
     * der 1632 das ältere 1630 schlägt.
     */
    test('das Repo-Detail zeigt Branch-Zustand, Schutz und die gefalteten Status', async ({ page }) => {
        await useWorkspace(page)
        await page.goto('/forge')
        await page.getByRole('tab', { name: 'Repositories' }).click()
        await page.locator('[data-forge-repo]').filter({ hasText: REPO_D }).first().click()

        await expect(page.getByRole('heading', { level: 1, name: REPO_D, exact: true })).toBeVisible({ timeout: 30_000 })
        await expect(page.locator('[data-forge-clone]')).toContainText('example.invalid')

        // Punkt 2 — der Branch-Zustand steht mit Kurzhash da.
        const branch = page.locator('[data-forge-branch][data-branch="master"]')
        await expect(branch).toBeVisible()
        await expect(branch).toContainText(COMMIT.slice(0, 7))
        await expect(branch).toContainText('HEAD')

        await expect(page.locator('[data-forge-protection]').first()).toContainText('no-force-push')
        await expect(page.locator('[data-forge-person]').first()).toBeVisible()

        // Punkt 3 — zwei Statusereignisse auf dasselbe Issue, der neuere gewinnt.
        const offen = page.locator('[data-forge-issue]').filter({ hasText: ISSUE_OPEN }).first()
        const zu = page.locator('[data-forge-issue]').filter({ hasText: ISSUE_CLOSED }).first()
        await expect(offen).toHaveAttribute('data-status', 'open')
        await expect(zu).toHaveAttribute('data-status', 'closed')
        await expect(zu).toContainText('Geschlossen')

        // Der Rumpf öffnet sich und ist gerendertes Markdown, kein Rohtext.
        await offen.getByRole('button').click()
        await expect(offen.locator('.article-content strong')).toHaveText('Testissue')

        // Der PR-Tab trägt den Vorschlag samt Kurzhash und Quell-Branch.
        await page.getByRole('tab', { name: 'Pull Requests' }).click()
        const pr = page.locator('[data-forge-pr]').filter({ hasText: PR_SUBJECT }).first()
        await expect(pr).toBeVisible()
        await expect(pr).toHaveAttribute('data-status', 'open')
        await expect(pr).toContainText('feat/zwergotter')
        await expect(pr).toContainText(COMMIT.slice(0, 7))
    })

    test('ein Repository ohne Inhalt zeigt für Issues UND Pull Requests eine Leermeldung', async ({ page }) => {
        await useWorkspace(page)
        await page.goto('/forge')
        await page.getByRole('tab', { name: 'Repositories' }).click()
        await page.locator('[data-forge-repo]').filter({ hasText: EMPTY_REPO_D }).first().click()

        await expect(page.getByRole('heading', { level: 1, name: EMPTY_REPO_D, exact: true })).toBeVisible({ timeout: 30_000 })

        const issues = page.locator('[data-forge-empty="issues"]')
        await expect(issues).toBeVisible()
        await expect(issues).toContainText('Noch keine Issues')

        await page.getByRole('tab', { name: 'Pull Requests' }).click()
        const pulls = page.locator('[data-forge-empty="pulls"]')
        await expect(pulls).toBeVisible()
        await expect(pulls).toContainText('Noch keine Pull Requests')
    })

    /**
     * Punkt 4 — und der einzige Test, der bewusst Bestand anlegt: ein frisches
     * Issue erscheint OHNE Reload, und ein danach gesetztes 1632 dreht seine
     * Zeile auf „geschlossen". Das prüft das `limit:0`-Abo aus `watchForge`,
     * nicht die Faltung; mit einem wiederverwendeten Issue wäre der Unterschied
     * zwischen „war schon so" und „hat nachgezogen" nicht zu zeigen.
     */
    test('ein neues Issue und sein Statuswechsel ziehen ohne Reload nach', async ({ page }) => {
        const marke = `E2E Live ${randomUUID().slice(0, 8)}`

        await useWorkspace(page)
        await page.goto('/forge')
        await page.getByRole('tab', { name: 'Repositories' }).click()
        await page.locator('[data-forge-repo]').filter({ hasText: REPO_D }).first().click()
        await expect(page.getByRole('heading', { level: 1, name: REPO_D, exact: true })).toBeVisible({ timeout: 30_000 })
        // Erst wenn die Liste steht, ist das Abo aufgezogen — vorher gemessen
        // hieße „noch nicht da" auch bei einem funktionierenden Abo.
        await expect(page.locator('[data-forge-issue]').first()).toBeVisible()

        expect(
            publish(BUZZ_OWNER_SEC_HEX, [
                '-k', '1621', '-t', `a=${address}`, '-t', `p=${owner}`, '-t', `subject=${marke}`,
                '-c', 'Live geseedet.',
            ]),
        ).toContain('success')

        const zeile = page.locator('[data-forge-issue]').filter({ hasText: marke }).first()
        await expect(zeile).toBeVisible({ timeout: 30_000 })
        await expect(zeile).toHaveAttribute('data-status', 'open')

        const liveId = (await zeile.getAttribute('data-id')) ?? ''
        expect(liveId).toHaveLength(64)
        expect(
            publish(BUZZ_OWNER_SEC_HEX, ['-k', '1632', '--tag', `e=${liveId};;root`, '-t', `a=${address}`]),
        ).toContain('success')

        await expect(zeile).toHaveAttribute('data-status', 'closed', { timeout: 30_000 })
    })
})
