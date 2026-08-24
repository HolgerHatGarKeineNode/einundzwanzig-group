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

/**
 * Den Steckbrief aufziehen.
 *
 * Seit P4 (2026-08-24, Plan `2026-08-24T1810-forge-navigation-buzz-vorbild.md`)
 * ist der Repo-Kopf — Beschreibung, Clone-Befehl, Branches, Schutzregeln,
 * Maintainer, README — ein `<details>` und startet in der schmalen Form
 * **geschlossen**. Das ist die Absicht, nicht ein Versehen: der Kopf stand bis
 * dahin in voller Breite über der Reiterleiste, auf dem Telefon vier
 * Bildschirmhöhen vor dem ersten Issue.
 *
 * Die Zusagen darunter bleiben damit unverändert bestehen — sie prüfen weiterhin,
 * dass Branch-Zustand, Schutzregel, Maintainer und Clone-Zeile **da und sichtbar**
 * sind. Nur der Weg dorthin hat einen Schritt mehr, und der Schritt selbst wird
 * hier mitgeprüft: ohne ein `open` am `<details>` läuft jede folgende Zusicherung
 * in ihren Timeout, statt stillschweigend zu verschwinden.
 *
 * **Formbewusst, nicht breitenbewusst.** In der zweispaltigen Form (ab 65 rem
 * Container, `theme.css`) ist die Zusammenfassung `display: none` und der Rumpf
 * steht ohnehin offen; dann gibt es nichts zu klicken. Der Buzz-Arm misst bei
 * 1279 px, also immer in der schmalen Form — die Abfrage steht trotzdem hier,
 * damit derselbe Helfer im `desktop-`-Arm nicht in einen 30-s-Timeout läuft.
 */
async function oeffneSteckbrief(page: Page): Promise<void> {
    const steckbrief = page.locator('[data-forge-steckbrief]')
    const schalter = page.locator('[data-forge-steckbrief-schalter]')
    await expect(steckbrief).toHaveCount(1, { timeout: 30_000 })
    if (!(await schalter.isVisible())) {
        return
    }
    if ((await steckbrief.getAttribute('open')) === null) {
        await schalter.click()
    }
    await expect(steckbrief).toHaveAttribute('open', /.*/)
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

        // Der Branch-Zustand. Der Relay schreibt beim Ankündigen SELBST ein
        // 30618 — als Seiteneffekt, NOCH VOR dem `OK` auf das 30617 (belegt:
        // `handle_side_effects(...).await` läuft in `ingest_event_inner` vor
        // dem Rückgabewert, `buzz/crates/buzz-relay/src/handlers/ingest.rs:2977`)
        // — aber nur `HEAD` und keinen Ref (am Testrelay nachgesehen), auf einen
        // ANDEREN Autor (den Relay-`self`, nicht den Eigentümer). Zwei
        // verschiedene Pubkeys sind zwei verschiedene 30618-Koordinaten, also
        // KEIN Überschreiben — beide liegen gleichzeitig vor, und
        // `foldRepoState` (forgeModels.ts:357) wählt den mit dem höheren
        // `created_at`.
        //
        // **Das ist das Rennen hinter P11 (`buzz-forge.spec.ts:332` reliably rot
        // auf frisch aufgesetztem Stack).** `created_at` ist sekundengranular
        // (NIP-01). Landet unser eigener Publish in DERSELBEN Sekunde wie der
        // automatische, entscheidet `foldRepoState`s Tiebreak (`a.id.localeCompare`,
        // faktisch eine Münze über den Event-Hash) — auf einem frisch reservierten
        // Repo-Namen tritt der Seiteneffekt IMMER auf und die Sekunden fallen bei
        // lokaler Latenz meistens zusammen. Auf wiederverwendetem Stack fehlt das
        // Rennen: der Seiteneffekt feuert NUR bei der frischen Namensreservierung
        // (`side_effects.rs`, `if reserved_by_this_attempt`), ein Re-Announce löst
        // ihn nicht erneut aus — deshalb dort zuverlässig grün.
        //
        // Der Fix ist derselbe wie beim Status-Wettlauf neun Zeilen weiter unten:
        // ein FESTER, garantiert späterer Zeitstempel statt eines Rennens, das man
        // nur länger laufen lässt. Der Relay-Seiteneffekt ist per obigem Beleg
        // spätestens dann abgeschlossen, wenn `publish()` für das 30617 hier
        // zurückkehrt — `now` danach gemessen ist also nie früher als der
        // automatische Zeitstempel, `now + 1` ist immer strikt später.
        const afterAnnounce = Math.floor(Date.now() / 1000) + 1
        expect(
            publish(BUZZ_OWNER_SEC_HEX, [
                '-k', '30618',
                '-t', `d=${REPO_D}`,
                '--tag', `refs/heads/master=${COMMIT}`,
                '--tag', 'HEAD=ref: refs/heads/master',
                '-t', `p=${owner}`,
                '--created-at', String(afterAnnounce),
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
        // **Fester Abstand statt realer Zeit.** `foldRepoState`/`issueStatusFrom`
        // (forgeModels.ts:168-169) entscheiden bei GLEICHEM `created_at` über die
        // kleinere Id — deterministisch, aber die Id ist ein Hash und damit pro Lauf
        // effektiv zufällig. Ohne festen Abstand hängt „1632 schlägt 1630" an der
        // WIRKLICHEN Zeit zwischen den beiden `nak`-Aufrufen (Signieren + Relay-
        // Roundtrip): isoliert ~1s (gemessen), unter Last (parallele Docker-Stacks)
        // reicht das nicht immer — landen beide in derselben Sekunde, entscheidet ein
        // Münzwurf statt der Fixture, welcher Status gewinnt. Per Parallellauf
        // reproduziert: 4 von 5 Läufen zeigten „open" statt „closed"
        // (`buzz-forge.spec.ts:313`), bevor dieser feste Abstand kam.
        // `--created-at` macht die Reihenfolge unabhängig von der Ausführungsgeschwindigkeit.
        const now = Math.floor(Date.now() / 1000)
        publishOnce(
            BUZZ_OWNER_SEC_HEX,
            ['-k', '1630', '-t', `a=${address}`],
            closedId,
            ['-k', '1630', '--tag', `e=${closedId};;root`, '-t', `a=${address}`, '--created-at', String(now)],
        )
        publishOnce(
            BUZZ_OWNER_SEC_HEX,
            ['-k', '1632', '-t', `a=${address}`],
            closedId,
            ['-k', '1632', '--tag', `e=${closedId};;root`, '-t', `a=${address}`, '--created-at', String(now + 5)],
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

        // P5: die Zeilen stehen unter einem Tages-Trenner, und der spricht die
        // Sprache von `/updates` (die Zuordnung selbst prüft `forgeTimeline.test.ts`
        // — hier geht es nur darum, DASS die Gruppe im echten Browser rendert).
        const trenner = page.locator('section:has([data-forge-activity]) > h2')
        await expect(trenner.first()).toBeVisible()
        await expect(trenner.first()).toHaveText(/^(Heute|Gestern|Diese Woche|Älter)$/)

        // Und die Zeile selbst trägt die kurze Angabe; die Uhrzeit steht im Tooltip.
        const zeit = page.locator('[data-forge-activity]').first().locator('span[title]').first()
        await expect(zeit).toHaveAttribute('title', /\d{2}:\d{2}/)
        await expect(zeit).not.toHaveText(/\d{2}:\d{2}/)

        await page.getByRole('tab', { name: 'Repositories' }).click()
        await expect(page.locator('[data-forge-repo]').filter({ hasText: REPO_D }).first()).toBeVisible()
    })

    /**
     * Punkt 5, seit dem 2026-08-23 in umgekehrter Richtung: der Projekte-Tab ist
     * GESTRICHEN, und das muss messbar sein statt bloss behauptet.
     *
     * Vorher stand hier die Zusage „ohne Projekte steht eine Leermeldung" — geprüft am
     * Tab „Projekte", weil bewusst kein einziges kind 30621 am Relay liegt. Die Fläche
     * gibt es nicht mehr; die Projekte leben ab `xl` in der Rail weiter. Was bleibt, ist
     * die Frage, ob der Wegfall VOLLSTÄNDIG ist: ein zurückgebliebener Tab ohne Panel
     * oder eine Kachel ohne Ziel wäre schlimmer als der alte Zustand.
     *
     * Die gerettete Auskunft (Repositories eines Projekts, die nicht auf dem Relay
     * liegen) steht jetzt im Repositories-Tab und erscheint hier korrekt NICHT — ohne
     * 30621 gibt es keine fehlenden Projekt-Repos. Auch das wird geprüft, sonst wäre die
     * Zeile eine, die immer steht.
     */
    test('der Projekte-Tab ist vollständig fort — Tab, Kachel und Panel', async ({ page }) => {
        await useWorkspace(page)
        await page.goto('/forge')
        await expect(page.locator('[data-forge-tile="repos"]')).toBeVisible({ timeout: 30_000 })

        // Drei Tabs, und keiner davon heisst „Projekte".
        await expect(page.getByRole('tab')).toHaveCount(3)
        await expect(page.getByRole('tab', { name: 'Projekte', exact: true })).toHaveCount(0)

        // Kachel und Panel ebenso — eine Kachel ohne Ziel wäre eine Zahl ins Leere.
        await expect(page.locator('[data-forge-tile="projects"]')).toHaveCount(0)
        await expect(page.locator('[data-forge-empty="projects"]')).toHaveCount(0)
        await expect(page.locator('[data-forge-project]')).toHaveCount(0)

        // Der Repositories-Tab trägt die gerettete Auskunft — hier ohne 30621 also nicht.
        await page.getByRole('tab', { name: 'Repositories' }).click()
        await expect(page.locator('[data-forge-repo]').first()).toBeVisible()
        await expect(page.locator('[data-forge-fehlende-projekt-repos]')).toHaveCount(0)
    })

    /**
     * Punkte 2 und 3 an einem Bildschirm: Clone-URL, Branch samt Commit aus dem
     * 30618, der Branch-Schutz aus `buzz-protect` — und die Statusfaltung, bei
     * der 1632 das ältere 1630 schlägt.
     */
    test('das Repo-Detail zeigt Branch-Zustand, Schutz und die gefalteten Status', async ({ page }) => {
        // Mehrere `{ timeout: 30_000 }`-Wartepunkte HINTEREINANDER (Überschrift, Branch,
        // Person, PR-Tab) passen unter Last nicht mehr in Playwrights Test-Default von
        // 30s — der ÄUSSERE Test-Timeout schlägt dann zu, bevor der INNERE je ausgeschöpft
        // wird ("Test timeout of 30000ms exceeded" statt der eigentlichen Assertion).
        // Gemessen unter vierfacher Parallellast (vier gleichzeitige Docker-Stacks).
        test.setTimeout(90_000)
        await useWorkspace(page)
        await page.goto('/forge')
        await page.getByRole('tab', { name: 'Repositories' }).click()
        await page.locator('[data-forge-repo]').filter({ hasText: REPO_D }).first().click()

        await expect(page.getByRole('heading', { level: 1, name: REPO_D, exact: true })).toBeVisible({ timeout: 30_000 })
        await oeffneSteckbrief(page)
        await expect(page.locator('[data-forge-clone]')).toContainText('example.invalid')

        // Punkt 2 — der Branch-Zustand steht mit Kurzhash da.
        //
        // `{ timeout: 30_000 }` wie bei der Überschrift oben, nicht das Default-5s-
        // Fenster: Branch/Person/PR kommen über eigene REQs NACH dem Routenwechsel an,
        // nicht mit der Überschrift zusammen. Unter Parallellast (mehrere Docker-Stacks
        // gleichzeitig) gemessen: 3 von 5 Läufen scheiterten genau hier, weil 5s dafür
        // nicht reichten — isoliert reicht es fast immer, was die Lücke unsichtbar
        // machte.
        const branch = page.locator('[data-forge-branch][data-branch="master"]')
        await expect(branch).toBeVisible({ timeout: 30_000 })
        await expect(branch).toContainText(COMMIT.slice(0, 7))
        await expect(branch).toContainText('HEAD')

        await expect(page.locator('[data-forge-protection]').first()).toContainText('no-force-push')
        await expect(page.locator('[data-forge-person]').first()).toBeVisible({ timeout: 30_000 })

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
        await expect(pr).toBeVisible({ timeout: 30_000 })
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
     * P6 — **die Clone-URL per Klick kopieren, mit ihrem Fehlerfall.**
     *
     * Bis P6 markierte ein Klick die Zeile nur (`select-all`); kopieren musste man
     * von Hand. Der Knopf ist der Nachzug — und er hat eine Bedingung, die man
     * NICHT sieht, wenn man ihn nur einmal ausprobiert: `navigator.clipboard` gibt
     * es ausschließlich in sicheren Kontexten. Über eine nackte HTTP-Adresse im LAN
     * ist die Eigenschaft schlicht `undefined`, und ein Knopf, der dort nichts tut,
     * wäre schlechter als kein Knopf.
     *
     * Deshalb prüft dieser Test alle DREI Lagen an derselben Fläche:
     *   1. Kopieren geht → der Text liegt in der Ablage, die Fläche sagt es.
     *   2. Kopieren wird abgelehnt (kein Fokus, keine Berechtigung) → die Fläche
     *      sagt AUCH das, statt Erfolg zu behaupten.
     *   3. Es gibt gar keine Zwischenablage → kein Knopf, aber die Zeile steht
     *      weiter als `select-all` da. Der Rückweg bleibt, die tote Schaltfläche
     *      entsteht nicht.
     */
    test('Clone-URL: Kopieren, Fehlerfall und der Browser ohne Zwischenablage', async ({ page, context }) => {
        // Zwei vollständige Anmeldungen in einem Test (die zweite Seite braucht
        // einen eigenen Kontext ohne Zwischenablage) — das passt nicht in
        // Playwrights 30-s-Default, und der äußere Timeout schlägt dann zu, bevor
        // die eigentliche Zusicherung je drankommt. Dieselbe Begründung wie beim
        // Repo-Detail-Fall oben.
        test.setTimeout(120_000)
        await context.grantPermissions(['clipboard-read', 'clipboard-write'])
        await useWorkspace(page)
        await page.goto('/forge')
        await page.getByRole('tab', { name: 'Repositories' }).click()
        await page.locator('[data-forge-repo]').filter({ hasText: REPO_D }).first().click()
        await expect(page.getByRole('heading', { level: 1, name: REPO_D, exact: true })).toBeVisible({ timeout: 30_000 })

        await oeffneSteckbrief(page)
        const zeile = page.locator('[data-forge-clone]')
        const knopf = page.locator('[data-forge-clone-copy]')
        await expect(zeile).toContainText('example.invalid')
        const url = (await zeile.textContent())?.trim() ?? ''
        expect(url).not.toBe('')

        // ── 1. Der gute Fall ────────────────────────────────────────────────
        await expect(knopf).toBeVisible()
        await knopf.click()
        expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(url)
        await expect(page.getByText('Clone-URL kopiert.')).toBeVisible({ timeout: 10_000 })

        // ── 2. Die Ablehnung ────────────────────────────────────────────────
        // `writeText` lehnt auch in einem sicheren Kontext ab — ohne Fokus im
        // Dokument, bei verweigerter Berechtigung. Hier wird genau das nachgestellt,
        // weil es sonst nicht herstellbar ist: der Browser im Test HAT Fokus.
        await page.evaluate(() => {
            navigator.clipboard.writeText = () => Promise.reject(new Error('verweigert'))
        })
        await knopf.click()
        await expect(page.getByText('Die Clone-URL ließ sich nicht kopieren.', { exact: false })).toBeVisible({
            timeout: 10_000,
        })
        // Und der Rückweg steht: die Zeile ist weiterhin mit einem Klick markierbar.
        await expect(zeile).toHaveClass(/select-all/)

        // ── 3. Der Browser ohne Zwischenablage ──────────────────────────────
        // Eigene Seite: die Eigenschaft muss VOR dem Rendern weg sein, sonst
        // entscheidet die Fläche gegen einen Zustand, den es nicht mehr gibt.
        // Kein zweiter Login: Sitzung und Signer liegen im Kontext, den sich beide
        // Seiten teilen. Ein erneutes `/nostr-login` leitet einen Angemeldeten
        // ohnehin weiter — der Helfer wartete dort auf einen Knopf, den es auf der
        // Zielseite nicht gibt, und lief in den Timeout (hier passiert).
        const ohne = await context.newPage()
        await useBuzz(ohne)
        await ohne.addInitScript((relay) => {
            ;(window as unknown as { __nostrWorkspace: string }).__nostrWorkspace = relay
            Object.defineProperty(navigator, 'clipboard', { configurable: true, get: () => undefined })
        }, BUZZ_URL)
        await ohne.goto('/forge')
        await ohne.getByRole('tab', { name: 'Repositories' }).click()
        await ohne.locator('[data-forge-repo]').filter({ hasText: REPO_D }).first().click()
        await expect(ohne.getByRole('heading', { level: 1, name: REPO_D, exact: true })).toBeVisible({ timeout: 30_000 })

        await oeffneSteckbrief(ohne)
        await expect(ohne.locator('[data-forge-clone]')).toContainText('example.invalid')
        await expect(ohne.locator('[data-forge-clone]')).toHaveClass(/select-all/)
        await expect(ohne.locator('[data-forge-clone-copy]')).toHaveCount(0)
        await ohne.close()
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

    /**
     * N6 — **ein gelöschtes Issue verschwindet OHNE Reload.**
     *
     * Bis N6 trug `contentFilters` kein `kind 5`, das Live-Abo also auch nicht:
     * Wer eine Forge-Fläche offen ließ, sah ein am Relay längst gelöschtes Issue
     * beliebig lange weiter. Der Kaltstart war gedeckt
     * (`tombstoneFiltersForCached`) — genau deshalb fiel es nicht auf, denn ein
     * Reload räumte auf. Dieser Test macht den Reload unmöglich.
     *
     * Der Grabstein trägt **nur** `["e", <id>]` und kein `a`: Buzz verlangt beim
     * Ingest genau EIN Ziel (`handlers/ingest.rs`, „deletion events must
     * reference exactly one target via e or a tag"). Ein `#a`-gescopetes Abo
     * könnte ihn deshalb prinzipiell nicht sehen — das ist die Begründung für den
     * unscoped `{kinds:[5],limit:0}`-Filter in `liveTombstoneFilter`.
     *
     * Eigenes Issue je Lauf, aus demselben Grund wie oben: an einem
     * wiederverwendeten wäre „ist weg" nicht von „war nie da" zu unterscheiden.
     */
    test('ein gelöschtes Issue verschwindet ohne Reload', async ({ page }) => {
        const marke = `E2E Grab ${randomUUID().slice(0, 8)}`

        await useWorkspace(page)
        await page.goto('/forge')
        await page.getByRole('tab', { name: 'Repositories' }).click()
        await page.locator('[data-forge-repo]').filter({ hasText: REPO_D }).first().click()
        await expect(page.getByRole('heading', { level: 1, name: REPO_D, exact: true })).toBeVisible({ timeout: 30_000 })
        await expect(page.locator('[data-forge-issue]').first()).toBeVisible()

        expect(
            publish(BUZZ_OWNER_SEC_HEX, [
                '-k', '1621', '-t', `a=${address}`, '-t', `p=${owner}`, '-t', `subject=${marke}`,
                '-c', 'Wird gleich gelöscht.',
            ]),
        ).toContain('success')

        const zeile = page.locator('[data-forge-issue]').filter({ hasText: marke }).first()
        await expect(zeile).toBeVisible({ timeout: 30_000 })
        const liveId = (await zeile.getAttribute('data-id')) ?? ''
        expect(liveId).toHaveLength(64)

        // **Der Grabstein braucht einen STRIKT späteren Zeitstempel.** welshmans
        // `repository` zählt eine Löschung nur bei `created_at > ziel.created_at`
        // (`net/…/repository.js:_isDeleted`) — ein Grabstein aus DERSELBEN Sekunde
        // ist lokal wirkungslos, obwohl Buzz das Ziel längst hart gelöscht hat.
        // Am 2026-08-18 direkt gegen `Repository.get()` gemessen: gleiche Sekunde
        // → `query` findet das Issue weiter (1), eine Sekunde später → 0. Ohne
        // `--created-at` fiel dieser Test genau darauf herein. Dieselbe Lehre wie
        // beim Branch-Zustand oben: fester Zeitstempel statt eines Rennens.
        //
        // Kein `page.reload()` zwischen hier und der Zusicherung — das ist die
        // ganze Aussage des Tests.
        const grabstein = Math.floor(Date.now() / 1000) + 1
        expect(
            publish(BUZZ_OWNER_SEC_HEX, [
                '-k', '5', '-t', `e=${liveId}`, '-t', 'k=1621', '--created-at', String(grabstein),
            ]),
        ).toContain('success')

        await expect(page.locator('[data-forge-issue]').filter({ hasText: marke })).toHaveCount(0, {
            timeout: 30_000,
        })
    })

    /**
     * N6 — **wie viele Filter passen in eine REQ-Nachricht? Genau einer.**
     *
     * Bis N6 stand in `forge.ts` die Rechnung „7 Filter, Grenze `max_filters:10`,
     * drei Filter Luft" — sie hätte jeden weiteren Filter zu einer Budgetfrage
     * gemacht. Die Prämisse war falsch: welshmans `requestOne` schickt je Filter
     * eine EIGENE REQ mit eigener sub_id, auch aus `load` heraus. `max_filters`
     * kann von diesem Client also gar nicht erreicht werden; die reale Grenze ist
     * `max_subscriptions: 1024`.
     *
     * Das steht hier als Test und nicht nur als Kommentar, weil genau diese
     * Prämisse einmal aus dem Lesen des Quellcodes abgeleitet wurde und falsch
     * war. Ein Kommentar altert still; dieser Test wird rot, wenn welshman
     * anfängt zu bündeln — und DANN ist die Budgetrechnung fällig.
     */
    test('welshman legt nie mehr als einen Filter in eine REQ-Nachricht', async ({ page }) => {
        await useWorkspace(page)
        await page.addInitScript(() => {
            const w = window as unknown as { __reqFilterCounts: number[] }
            w.__reqFilterCounts = []
            const send = WebSocket.prototype.send
            WebSocket.prototype.send = function (data: string | ArrayBufferLike | Blob | ArrayBufferView) {
                if (typeof data === 'string' && data.startsWith('["REQ"')) {
                    try {
                        w.__reqFilterCounts.push((JSON.parse(data) as unknown[]).length - 2)
                    } catch {
                        // Keine gültige REQ-Nachricht — dann zählt sie auch nicht.
                    }
                }

                return send.call(this, data)
            }
        })
        await page.goto('/forge')
        await page.getByRole('tab', { name: 'Repositories' }).click()
        await page.locator('[data-forge-repo]').filter({ hasText: REPO_D }).first().click()
        await expect(page.getByRole('heading', { level: 1, name: REPO_D, exact: true })).toBeVisible({ timeout: 30_000 })
        await expect(page.locator('[data-forge-issue]').first()).toBeVisible()

        const counts = await page.evaluate(() => (window as unknown as { __reqFilterCounts: number[] }).__reqFilterCounts)
        expect(counts.length).toBeGreaterThan(0)
        expect(Math.max(...counts)).toBe(1)
    })
})
