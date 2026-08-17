import { test, expect, type Page } from './support/fixtures'
import { useBuzz, BUZZ_URL, BUZZ_PORT, BUZZ_USER_NSEC, BUZZ_USER_PUB, BUZZ_OWNER_SEC_HEX, BUZZ_ROOM_GENERAL } from './support/buzz'
import { loginNsec } from './support/login'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'

/**
 * P8 — die **Schreibrichtung** der Forge gegen einen echten Buzz-Relay.
 *
 * ── Der Dateiname ist Teil der Mechanik ──────────────────────────────────────
 * `playwright.config.ts:57` filtert im Buzz-Modus auf
 * `/(?:buzz-.*|pin-room)\.spec\.ts$/` und überspringt alles andere LAUTLOS
 * („Total: 0 tests", kein Fehler).
 *
 * ── Was hier steht, und warum es nicht der Unit-Test trägt ───────────────────
 * Tag-Bau, Berechtigungsregel, optimistischer Eintrag und sein Rückbau prüft
 * `forgeWriteModels.test.ts` ohne Docker. Hier steht nur, was ohne echten
 * Roundtrip nicht prüfbar ist:
 *
 *   1. **Darf ein normales Mitglied überhaupt?** Der Relay ist
 *      `restricted_writes: true` **und** `auth_required: true`. Vorher am
 *      Teststack gemessen (Protokoll im Kopf von `js/forgeWriteModels.ts`):
 *      1621, kind 1 und 1630–1633 gehen alle durch, 1111 nicht. Dieser Test
 *      hält das an der FLÄCHE fest — die Messung galt für `nak`, nicht für uns.
 *   2. **Kommt das Ereignis in der Form an, die ein zweiter Client liest?** Das
 *      Rücklesen per `nak` prüft Kind und Tags am Relay, nicht im Browser.
 *   3. **Zieht die Faltung beim Statuswechsel nach?** Der Relay nimmt ein
 *      Status-Ereignis von jedem an; sichtbar wird nur, was `foldStatus`
 *      durchlässt. Erst das Attribut `data-status` der Zeile beweist beides.
 *   4. **Korrigiert sich die Fläche sichtbar, wenn `OK true` nichts wert war?**
 *      Der Relay nimmt jeden Statuswechsel an; ob er GILT, entscheidet die
 *      Faltung. Ein fremder, neuerer Wechsel muss deshalb zu einer sichtbaren
 *      Fehlermeldung führen und nicht zu einer stillen Erfolgsmeldung.
 *   5. **Erzeugt ein Doppelklick zwei Issues?** Das prüft den Riegel, nicht die
 *      Sichtbarkeit — gezählt wird am Relay, nicht am Bildschirm.
 *
 * ── Bestandswachstum ────────────────────────────────────────────────────────
 * Das Repo (30617) ist ersetzbar und wird je Lauf überschrieben. Issues und
 * Kommentare legt dieser Lauf bewusst NEU an, je mit einer frischen Marke —
 * anders ist „ist gerade entstanden" nicht von „war schon da" zu unterscheiden.
 * Der Bloat-Wächter in `buzz-testserver.sh` zählt kind-39000-Kanäle und kind-9
 * im `welcome`-Kanal; beides berührt diese Datei nicht.
 */

const NAK = process.env.NAK ?? `${process.env.HOME}/go/bin/nak`
const WS = (): string => `ws://localhost:${BUZZ_PORT}`

/**
 * Eigenes `d`-Tag, **ohne gemeinsames Präfix** mit den Repos der Lese-Spec
 * (`e2e-forge`, `e2e-leerrepo`): `filter({hasText})` matcht als
 * Teilzeichenkette, und zwei Läufe im selben Stack teilen sich den Bestand.
 */
const REPO_D = 'e2e-schreibwerk'

const nak = (args: string[]): string => {
    const res = spawnSync(NAK, args, { encoding: 'utf8', timeout: 30_000 })

    return `${res.stdout ?? ''}\n${res.stderr ?? ''}`
}

const publish = (sec: string, args: string[]): string => nak(['event', '--auth', '--sec', sec, ...args, WS()])

const query = (args: string[]): string => nak(['req', '--auth', '--sec', BUZZ_USER_NSEC, ...args, WS()])

/** Alle Ereignisse einer Anfrage als geparste Objekte (nak schreibt auch Fortschritt). */
const events = (args: string[]): { id: string; kind: number; pubkey: string; content: string; tags: string[][] }[] => {
    const out: { id: string; kind: number; pubkey: string; content: string; tags: string[][] }[] = []
    for (const line of query(args).split('\n')) {
        if (!line.startsWith('{')) {
            continue
        }
        try {
            out.push(JSON.parse(line))
        } catch {
            // Keine Ereigniszeile.
        }
    }

    return out
}

const tagValue = (tags: string[][], name: string): string =>
    tags.find((tag) => tag[0] === name)?.[1] ?? ''

const ownerPubkey = (): string => nak(['key', 'public', BUZZ_OWNER_SEC_HEX]).trim().split('\n')[0].trim()

/** Workspace auf den Testrelay zeigen (siehe `buzz-forge.spec.ts`). */
async function useWorkspace(page: Page, login = true): Promise<void> {
    await useBuzz(page)
    await page.addInitScript((url) => {
        ;(window as unknown as { __nostrWorkspace: string }).__nostrWorkspace = url
    }, BUZZ_URL)
    if (login) {
        await loginNsec(page, BUZZ_USER_NSEC)
    }
}

/** Zum Repo-Detail navigieren und warten, bis der Kopf steht. */
async function openRepo(page: Page): Promise<void> {
    await page.goto('/forge')
    await page.getByRole('tab', { name: 'Repositories' }).click()
    await page.locator('[data-forge-repo]').filter({ hasText: REPO_D }).first().click()
    await expect(page.getByRole('heading', { level: 1, name: REPO_D, exact: true })).toBeVisible({ timeout: 30_000 })
}

test.describe('Buzz-Workspace: Forge schreiben (E2E, nur E2E_RELAY=buzz)', () => {
    test.skip(process.env.E2E_RELAY !== 'buzz', 'nur im Buzz-Modus (E2E_RELAY=buzz) relevant')

    let owner = ''
    let address = ''

    test.beforeAll(() => {
        owner = ownerPubkey()
        expect(owner).toHaveLength(64)
        address = `30617:${owner}:${REPO_D}`

        // Ein eigenes Repo, kanal-gescopet wie am Produktions-Relay. Der
        // EIGENTÜMER ist der Owner-Schlüssel, geschrieben wird gleich mit dem
        // normalen Mitglied — genau die Kombination, die zählt: ein Client, der
        // nur mit Owner-Schlüssel getestet wurde, wäre für alle anderen tot.
        expect(
            publish(BUZZ_OWNER_SEC_HEX, [
                '-k', '30617',
                '-t', `d=${REPO_D}`,
                '-t', `name=${REPO_D}`,
                '-t', 'description=Schreibziel fuer P8',
                '-t', `buzz-channel=${BUZZ_ROOM_GENERAL}`,
                '-t', `h=${BUZZ_ROOM_GENERAL}`,
                '-t', `maintainers=${owner}`,
            ]),
        ).toContain('success')

        // Ein Pull Request vom Eigentümer — Kommentieren ist die einzige
        // Schreibrichtung, die ein Browser-Client an einem PR haben kann (ein
        // PR setzt einen gepushten Branch voraus).
        expect(
            publish(BUZZ_OWNER_SEC_HEX, [
                '-k', '1618',
                '-t', `a=${address}`,
                '-t', `p=${owner}`,
                '-t', 'subject=P8 Zwergotter PR',
                '-t', 'branch-name=feat/p8',
                '-t', 'target-branch=master',
                '-c', 'Ziel fuer den PR-Kommentar.',
            ]),
        ).toContain('success')
    })

    /**
     * Punkt 4 — die Zusage „wer nicht darf, sieht das VOR dem Absenden", an dem
     * Fall, der WIRKLICH vorkommt.
     *
     * **Der ganz anonyme Fall ist auf dieser Fläche unerreichbar**, und zwar
     * doppelt: `/forge` liegt hinter `nostr.auth` (`routes/group.php:31`) und
     * leitet einen Gast auf die Anmeldung um — und selbst mit gültiger
     * Laravel-Sitzung, aber ohne Signer im Browser, käme kein einziges Repo
     * herein, weil der Relay `auth_required: true` ist. Wer die Forge gefüllt
     * sieht, ist also immer angemeldet. Der `anonymous`-Zweig des Riegels bleibt
     * als Rückfall bestehen (die Sitzung kann zwischen Rendern und Klick
     * ablaufen) und ist im Unit-Test abgedeckt; hier wäre er nicht
     * herstellbar, sondern nur nachgestellt.
     *
     * Der Fall, der zählt, ist ohnehin der andere: den Status eines FREMDEN
     * Issues darf man nicht setzen — und der Relay sagt dazu nichts. Er steht
     * weiter unten als eigener Test.
     */

    /**
     * Punkte 1–3 an einem Bildschirm, in der Reihenfolge, in der ein Mensch
     * arbeitet: Issue anlegen → kommentieren → Status setzen. Nach jedem Schritt
     * wird BEIDES geprüft — was die Fläche zeigt und was am Relay liegt.
     */
    test('ein Mitglied legt ein Issue an, kommentiert es und schließt es', async ({ page }) => {
        const marke = `P8 Otter ${randomUUID().slice(0, 8)}`
        const kommentar = `Antwort ${randomUUID().slice(0, 8)}`

        await useWorkspace(page)
        await openRepo(page)

        // ── Issue anlegen ───────────────────────────────────────────────────
        await page.getByRole('button', { name: 'Neues Issue' }).click()
        await page.locator('[data-forge-issue-form]').getByLabel('Titel').fill(marke)
        await page.locator('[data-forge-issue-form]').getByLabel('Beschreibung').fill('Ein **fetter** Rumpf.')
        await page.getByRole('button', { name: 'Issue anlegen' }).click()

        // Die Zeile steht — optimistisch, also lange bevor der Relay geantwortet
        // haben muss.
        const zeile = page.locator('[data-forge-issue]').filter({ hasText: marke }).first()
        await expect(zeile).toBeVisible({ timeout: 30_000 })
        await expect(zeile).toHaveAttribute('data-status', 'open')
        // Das Formular ist zu und leer: der Erfolg ist an der Fläche ablesbar.
        await expect(page.locator('[data-forge-issue-form]')).toHaveCount(0)

        // ── Punkt 2: dieselbe Sache am Relay, in der Form eines NIP-34-Issues ─
        const amRelay = events(['-k', '1621', '-t', `a=${address}`]).filter(
            (event) => tagValue(event.tags, 'subject') === marke,
        )
        expect(amRelay).toHaveLength(1)
        expect(amRelay[0].pubkey).toBe(BUZZ_USER_PUB)
        expect(tagValue(amRelay[0].tags, 'a')).toBe(address)
        // Der Eigentümer des Repos steht im `p` — so findet ihn Buzz Desktop.
        expect(tagValue(amRelay[0].tags, 'p')).toBe(owner)
        expect(amRelay[0].content).toContain('**fetter**')

        const issueId = amRelay[0].id

        // ── Kommentieren ────────────────────────────────────────────────────
        await zeile.getByRole('button').first().click()
        const form = zeile.locator('[data-forge-comment-form]')
        await expect(form).toBeVisible()
        await form.getByLabel('Kommentar').fill(kommentar)
        await form.getByRole('button', { name: 'Kommentieren' }).click()

        // Erst optimistisch — die Zeile steht, bevor der Relay geantwortet hat.
        await expect(zeile).toContainText(kommentar, { timeout: 30_000 })
        // …und DANN das Ende des Fluges abwarten, bevor am Relay nachgesehen
        // wird. Ohne diesen Schritt misst der `nak req` das offene Zeitfenster
        // zwischen optimistischer Anzeige und `OK` — und liest null Ereignisse,
        // obwohl nichts kaputt ist. Genau das ist beim ersten Lauf passiert.
        await expect(form.getByLabel('Kommentar')).toHaveValue('', { timeout: 30_000 })

        const kommentare = events(['-k', '1', '-t', `a=${address}`]).filter(
            (event) => event.content === kommentar,
        )
        expect(kommentare).toHaveLength(1)
        // kind 1, nicht 1111 — NIP-22 ist am Relay nicht registriert.
        expect(kommentare[0].kind).toBe(1)
        expect(kommentare[0].tags.some((tag) => tag[0] === 'e' && tag[1] === issueId && tag[3] === 'root')).toBe(true)

        // ── Punkt 3: Status setzen, und die Faltung zieht nach ───────────────
        const statusleiste = zeile.locator('[data-forge-status-actions]')
        await expect(statusleiste).toBeVisible()
        await statusleiste.locator('[data-forge-status-option="closed"]').click()

        await expect(zeile).toHaveAttribute('data-status', 'closed', { timeout: 30_000 })
        await expect(zeile).toContainText('Geschlossen')

        const status = events(['-k', '1632', '-t', `a=${address}`]).filter((event) =>
            event.tags.some((tag) => tag[0] === 'e' && tag[1] === issueId),
        )
        expect(status).toHaveLength(1)
        expect(status[0].pubkey).toBe(BUZZ_USER_PUB)

        // Und die Fläche hat KEINEN Fehler stehen gelassen: die Nachprüfung
        // („hat sich der Wechsel durchgesetzt?") ist positiv ausgegangen.
        await expect(page.locator('[data-forge-write-failed]')).toHaveCount(0)
    })

    /**
     * Ein Kommentar am **Pull Request** — derselbe Pfad, andere Wurzel. Er hat
     * einen eigenen Test, weil PR-Zeilen aus 1618 + 1619 gefaltet werden und
     * ihre Kommentarliste dadurch an einer anderen Stelle entsteht als die des
     * Issues; ein gemeinsamer Test verstünde einen Bruch dort als Issue-Fehler.
     */
    test('ein Mitglied kommentiert einen Pull Request', async ({ page }) => {
        const kommentar = `PR-Antwort ${randomUUID().slice(0, 8)}`

        await useWorkspace(page)
        await openRepo(page)
        await page.getByRole('tab', { name: 'Pull Requests' }).click()

        const zeile = page.locator('[data-forge-pr]').filter({ hasText: 'P8 Zwergotter PR' }).first()
        await expect(zeile).toBeVisible({ timeout: 30_000 })
        await zeile.getByRole('button').first().click()

        const form = zeile.locator('[data-forge-comment-form]')
        await expect(form).toBeVisible()
        await form.getByLabel('Kommentar').fill(kommentar)
        await form.getByRole('button', { name: 'Kommentieren' }).click()

        await expect(zeile).toContainText(kommentar, { timeout: 30_000 })
        await expect(form.getByLabel('Kommentar')).toHaveValue('', { timeout: 30_000 })

        const kommentare = events(['-k', '1', '-t', `a=${address}`]).filter(
            (event) => event.content === kommentar,
        )
        expect(kommentare).toHaveLength(1)
        expect(kommentare[0].pubkey).toBe(BUZZ_USER_PUB)
    })

    /**
     * Punkt 4 — **`OK true` ist keine Zusage, dass es WIRKT.**
     *
     * Aufbau: das Issue gehört dem Mitglied (es darf also setzen), aber der
     * Eigentümer hat vorher einen Wechsel auf „Erledigt" mit einem Zeitstempel
     * **zehn Minuten in der Zukunft** hinterlegt. Zehn Minuten und nicht eine
     * Stunde, und das ist gemessen: der Relay nimmt `created_at` nur etwa
     * ±900 s um seine eigene Uhr an — `+3600` wird mit `invalid: event
     * timestamp too far from server time` abgelehnt. Der erste Anlauf dieses
     * Tests scheiterte genau daran und hat damit ganz nebenbei belegt, dass der
     * Hebel „Stempel in die Zukunft" auf eine Viertelstunde begrenzt ist.
     *
     * Unser Wechsel auf „Geschlossen" kommt mit `OK true` durch und verliert
     * die Faltung trotzdem, weil `nextCreatedAt` einen so weiten Sprung bewusst
     * NICHT mitmacht (Deckel: 60 s).
     *
     * Was hier geprüft wird, ist deshalb nicht der Relay, sondern die
     * Ehrlichkeit der Fläche: sie meldet den Fehlschlag, statt Erfolg zu
     * behaupten und den alten Zustand stehen zu lassen.
     */
    test('ein Statuswechsel, der sich nicht durchsetzt, wird als Fehler gemeldet', async ({ page }) => {
        const marke = `P8 Ueberholt ${randomUUID().slice(0, 8)}`

        // Das Issue gehört dem MITGLIED — sonst fehlte ihm schon das Recht, und
        // der Test prüfte den falschen Riegel.
        expect(
            publish(BUZZ_USER_NSEC, [
                '-k', '1621',
                '-t', `a=${address}`,
                '-t', `p=${owner}`,
                '-t', `subject=${marke}`,
                '-c', 'Wird gleich ueberholt.',
            ]),
        ).toContain('success')

        const issueId = events(['-k', '1621', '-t', `a=${address}`]).find(
            (event) => tagValue(event.tags, 'subject') === marke,
        )?.id
        expect(issueId).toHaveLength(64)

        // Der Eigentümer setzt „Erledigt" — mit Datum zehn Minuten voraus.
        const zukunft = Math.floor(Date.now() / 1000) + 600
        expect(
            publish(BUZZ_OWNER_SEC_HEX, [
                '-k', '1631',
                '--ts', String(zukunft),
                '--tag', `e=${issueId};;root`,
                '-t', `a=${address}`,
            ]),
        ).toContain('success')

        await useWorkspace(page)
        await openRepo(page)

        const zeile = page.locator('[data-forge-issue]').filter({ hasText: marke }).first()
        await expect(zeile).toBeVisible({ timeout: 30_000 })
        await expect(zeile).toHaveAttribute('data-status', 'resolved')
        await zeile.getByRole('button').first().click()

        await zeile.locator('[data-forge-status-option="closed"]').click()

        // Die Fläche sagt, dass es nicht gewirkt hat — und lässt den echten
        // Zustand stehen, statt den gewünschten vorzugaukeln.
        const fehler = zeile.locator('[data-forge-write-failed="root"]')
        await expect(fehler).toBeVisible({ timeout: 30_000 })
        await expect(fehler).toContainText('durchgesetzt')
        await expect(zeile).toHaveAttribute('data-status', 'resolved')

        // Und das eigene Ereignis liegt trotzdem am Relay — `OK true` war
        // wahr, es war nur nicht das, was der Nutzer wollte.
        const eigene = events(['-k', '1632', '-t', `a=${address}`]).filter(
            (event) => event.pubkey === BUZZ_USER_PUB && event.tags.some((tag) => tag[0] === 'e' && tag[1] === issueId),
        )
        expect(eigene).toHaveLength(1)

        // Der Hinweis lässt sich wegnehmen, ohne die Seite zu verlassen.
        await fehler.getByRole('button', { name: 'Verwerfen' }).click()
        await expect(fehler).toHaveCount(0)
    })

    /**
     * Punkt 5 — der Riegel gegen den Doppelklick.
     *
     * **Zwei naive Klicks beweisen hier NICHTS**, und das ist gemessen, nicht
     * vermutet — der Test wurde zweimal umgebaut, weil er zweimal aus dem
     * falschen Grund grün war:
     *
     *   1. Mit zwei `locator.click()` blieb er grün, obwohl alle drei Sperren
     *      entfernt waren. Playwright wartet zwischen den Klicks einen Tick, in
     *      dem Alpine das `disabled` längst gesetzt hat — der zweite Klick
     *      erreichte den Handler gar nicht.
     *   2. Mit zwei `.click()` in DERSELBEN Mikrotask blieb er ebenfalls grün,
     *      auch ohne jede Sperre. Grund: `makeEvent` stempelt `created_at` auf
     *      die laufende Sekunde, beide Ereignisse sind damit **byte-identisch**
     *      und haben dieselbe Id — der zweite Versuch ist protokollseitig ein
     *      No-op. Der Riegel war nicht der Grund für das Ergebnis.
     *
     * Also überschreitet der zweite Klick eine Sekundengrenze: `Date.now` wird
     * zwischen den beiden Klicks um fünf Sekunden vorgestellt (und sofort wieder
     * zurück). Damit hätte das zweite Ereignis eine andere Id — genau der Fall
     * eines Menschen, der zweimal kurz hintereinander klickt, ohne dass beide
     * Klicks in dieselbe Sekunde fallen. Gezählt wird am RELAY: zwei Zeilen
     * wären auch dann eine, wenn der Client dedupliziert; zwei Ereignisse wären
     * zwei Issues für jeden anderen Client.
     */
    test('ein Doppelklick legt das Issue nur EINMAL an', async ({ page }) => {
        const marke = `P8 Doppelklick ${randomUUID().slice(0, 8)}`

        await useWorkspace(page)
        await openRepo(page)

        await page.getByRole('button', { name: 'Neues Issue' }).click()
        await page.locator('[data-forge-issue-form]').getByLabel('Titel').fill(marke)

        const geklickt = await page.evaluate(() => {
            const knopf = document.querySelector<HTMLButtonElement>('[data-forge-issue-submit]')
            if (!knopf) {
                return 0
            }
            const echt = Date.now
            knopf.click()
            // Fünf Sekunden weiter — sonst trügen beide Ereignisse denselben
            // Zeitstempel, dieselbe Id, und der Test wäre unabhängig von jedem
            // Riegel grün.
            Date.now = () => echt() + 5_000
            try {
                knopf.click()
            } finally {
                Date.now = echt
            }

            return 2
        })
        // Die Vorbedingung selbst prüfen: hätte der Knopf gefehlt, wäre der
        // Test grün geworden, ohne je zu klicken.
        expect(geklickt).toBe(2)

        await expect(page.locator('[data-forge-issue]').filter({ hasText: marke }).first()).toBeVisible({
            timeout: 30_000,
        })
        await expect(page.locator('[data-forge-issue-form]')).toHaveCount(0)

        const amRelay = events(['-k', '1621', '-t', `a=${address}`]).filter(
            (event) => tagValue(event.tags, 'subject') === marke,
        )
        expect(amRelay).toHaveLength(1)
    })

    /**
     * Der zweite Riegel, und der wichtigere: den Status eines FREMDEN Issues
     * darf man nicht setzen. Er ist deshalb wichtiger, weil der Relay hier
     * **gar nichts** prüft — am Teststack gemessen quittiert er ein 1632 eines
     * Unbeteiligten mit `success`. Ein Knopf für alle wäre also kein Fehler mit
     * Fehlermeldung, sondern ein stiller Leerlauf: geschrieben, angenommen, nie
     * angezeigt.
     */
    test('den Status eines fremden Issues kann man nicht setzen — mit Begründung', async ({ page }) => {
        const fremd = `P8 Fremd ${randomUUID().slice(0, 8)}`
        expect(
            publish(BUZZ_OWNER_SEC_HEX, [
                '-k', '1621',
                '-t', `a=${address}`,
                '-t', `p=${owner}`,
                '-t', `subject=${fremd}`,
                '-c', 'Vom Eigentuemer eroeffnet.',
            ]),
        ).toContain('success')

        await useWorkspace(page)
        await openRepo(page)

        const zeile = page.locator('[data-forge-issue]').filter({ hasText: fremd }).first()
        await expect(zeile).toBeVisible({ timeout: 30_000 })
        await zeile.getByRole('button').first().click()

        // Kein Statusknopf — stattdessen der Grund.
        await expect(zeile.locator('[data-forge-status-actions]')).toHaveCount(0)
        const hinweis = zeile.locator('[data-forge-status-hint]')
        await expect(hinweis).toBeVisible()
        await expect(hinweis).toContainText('Repository')

        // Kommentieren darf man trotzdem — die beiden Rechte sind nicht dasselbe.
        await expect(zeile.locator('[data-forge-comment-form]')).toBeVisible()
    })
})
