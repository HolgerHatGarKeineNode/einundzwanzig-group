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
 * ── Bestandswachstum: warum die Adresse je Lauf WECHSELT (P4) ───────────────
 * Bis P4 lag das Repo auf der FESTEN Adresse `30617:<owner>:e2e-schreibwerk`.
 * Das Repo selbst ist ersetzbar und wurde je Lauf überschrieben — die Issues
 * (kind 1621) darunter sind es **nicht**. Sie sammelten sich unter derselben
 * `a`-Koordinate an, und `events()` fragte ohne `-l`. Beim P8-Gate ist genau
 * das aufgeschlagen: nach vielen Läufen ohne Stack-Reset lieferte der Relay
 * sein Default-Fenster, das frisch angelegte Issue lag nicht darin, und
 * `toHaveLength(1)` wurde zu `0` — ein Rot-Befund ohne Fehler im Produkt.
 *
 * **Zwei Wege standen im Plan; gewählt ist der zweite.** Ein `-l`-Limit wäre
 * eine Zahl, die mit dem Bestand wieder eingeholt wird — sie verschiebt den
 * Tag, an dem derselbe falsche Rot-Befund wiederkommt, und hängt zusätzlich am
 * Default des Relays. Eine eigene `d`-Marke je Lauf macht die Frage gegenstands-
 * los: jede Abfrage sieht dann NUR die Ereignisse dieses Laufs, unabhängig
 * davon, wie oft der Stack schon benutzt wurde. Sie entzerrt zugleich die
 * Ersetzungs-Semantik — zwei gleichzeitige Läufe (zwei Worker, zwei Slots)
 * überschrieben sich vorher dasselbe 30617.
 *
 * Das `-l` steht trotzdem dabei, als Gürtel neben den Hosenträgern: es kostet
 * nichts und nimmt dem Default-Fenster des Relays jede Rolle.
 *
 * **Und aufgeräumt wird auch.** `afterAll` löscht das Repo per kind 5 auf seine
 * `a`-Koordinate — am Teststack gemessen wirkt das HART (das 30617 ist danach
 * aus jeder REQ-Antwort verschwunden). Ohne das Aufräumen wüchse die
 * Repo-Liste der Forge-Übersicht mit jedem Lauf um eine Zeile. Der
 * Bloat-Wächter in `buzz-testserver.sh` zählt kind-39000-Kanäle und kind-9 im
 * `welcome`-Kanal — Repos sieht er nicht.
 */

const NAK = process.env.NAK ?? `${process.env.HOME}/go/bin/nak`
const WS = (): string => `ws://localhost:${BUZZ_PORT}`

/**
 * Eigenes `d`-Tag, **ohne gemeinsames Präfix** mit den Repos der Lese-Spec
 * (`e2e-forge`, `e2e-leerrepo`): `filter({hasText})` matcht als
 * Teilzeichenkette, und zwei Läufe im selben Stack teilen sich den Bestand.
 *
 * Der Zufalls-Anhang ist der eigentliche P4-Fix (Begründung im Dateikopf): er
 * gibt jedem Lauf eine eigene `a`-Koordinate, damit keine Abfrage je den
 * Bestand eines früheren Laufs mitsieht.
 */
const REPO_D = `e2e-schreibwerk-${randomUUID().slice(0, 8)}`

/**
 * Deckel für jede `nak req`-Abfrage dieser Datei.
 *
 * **Ohne `-l` entscheidet der Relay**, wie viele Ereignisse er ausliefert — und
 * genau dieses unsichtbare Default-Fenster hat den falschen Rot-Befund beim
 * P8-Gate erzeugt. Die Zahl ist bewusst groß: sie soll nie greifen (eine
 * Lauf-Adresse trägt keine zehn Ereignisse), sondern nur den Default aus der
 * Gleichung nehmen.
 */
const QUERY_LIMIT = '500'

const nak = (args: string[]): string => {
    const res = spawnSync(NAK, args, { encoding: 'utf8', timeout: 30_000 })

    return `${res.stdout ?? ''}\n${res.stderr ?? ''}`
}

const publish = (sec: string, args: string[]): string => nak(['event', '--auth', '--sec', sec, ...args, WS()])

const query = (args: string[]): string =>
    nak(['req', '--auth', '--sec', BUZZ_USER_NSEC, '-l', QUERY_LIMIT, ...args, WS()])

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
    // Seit der GitHub-Parität startet die Repo-Seite auf CODE — die Schreib-
    // tests leben von der Issue-Liste (und ihr zustand-Ausschnitt).
    await page.getByRole('tab', { name: /^Issues/ }).click()
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
                '-c', 'Ziel fuer den PR-Kommentar.',
            ]),
        ).toContain('success')
    })

    /**
     * Das Repo dieses Laufs wieder abräumen.
     *
     * kind 5 auf die `a`-Koordinate wirkt bei Buzz HART — das 30617 ist danach
     * aus jeder REQ-Antwort verschwunden (am Teststack gemessen). Die Issues und
     * Kommentare darunter bleiben liegen; sie sind über die Lauf-eigene Adresse
     * aber für keinen späteren Lauf mehr sichtbar und stören deshalb nichts. Was
     * ein Nutzer SIEHT — die Repo-Liste der Forge-Übersicht — bleibt so kurz wie
     * vor dem Lauf.
     *
     * Ohne `expect`: ein fehlgeschlagenes Aufräumen darf einen grünen Lauf nicht
     * nachträglich rot machen. Es ist Hygiene, keine Zusicherung.
     */
    test.afterAll(() => {
        publish(BUZZ_OWNER_SEC_HEX, ['-k', '5', '-t', `a=${address}`])
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

        // ── Kommentieren — seit P1 auf der EIGENEN Seite des Issues ────────
        // (GitHub-Parität: die Zeile ist ein LINK, kein Akkordeon; Kommentar,
        // Status und Zuweisung wohnen auf `/forge/{naddr}/issues/{id}`.)
        await zeile.locator('a[data-forge-vorgang-link]').click()
        const blatt = page.locator('[data-forge-einzel-blatt]')
        await expect(blatt).toBeVisible({ timeout: 30_000 })
        await expect(blatt.locator('h1')).toContainText(marke)

        const form = page.locator('[data-forge-comment-form]')
        await expect(form).toBeVisible()
        await form.getByLabel('Kommentar').fill(kommentar)
        await form.getByRole('button', { name: 'Kommentieren' }).click()

        // Erst optimistisch — der Kommentar steht, bevor der Relay geantwortet hat.
        await expect(page.locator('[data-forge-einzel-kommentare]')).toContainText(kommentar, { timeout: 30_000 })
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
        // GitHub-Form: EIN Hauptwort am Zustand („Issue schließen"), nicht drei
        // Optionen — der Ankündigung halber trägt der Knopf `data-forge-status-ziel`.
        const statusleiste = page.locator('[data-forge-status-actions]')
        await expect(statusleiste).toBeVisible()
        await statusleiste.locator('[data-forge-status-ziel="closed"]').click()

        const pille = blatt.locator('[data-forge-status]')
        await expect(pille).toHaveAttribute('data-status', 'closed', { timeout: 30_000 })
        await expect(blatt).toContainText('Geschlossen')

        // **Gepollt, und das ist beim Zehnfach-Lauf gemessen worden (P4).**
        // `data-status` kippt OPTIMISTISCH — die Zeile steht auf „Geschlossen",
        // während das 1632 noch fliegt. Ein einmaliges `nak req` direkt danach traf
        // in 2 von 10 aufeinanderfolgenden Läufen genau dieses Fenster und las null
        // Ereignisse; der Fehlschlag sah aus wie ein kaputter Statuswechsel und war
        // eine zu früh gestellte Frage.
        //
        // Die beiden Schritte davor haben je ein Signal, das ERST NACH dem `OK`
        // kommt (das Formular schließt sich, das Kommentarfeld leert sich) — der
        // Statuswechsel hat keines: er ändert nur ein Attribut, und das tut er
        // sofort. Also wird der Relay gefragt, bis er antwortet.
        await expect
            .poll(
                () =>
                    events(['-k', '1632', '-t', `a=${address}`]).filter((event) =>
                        event.tags.some((tag) => tag[0] === 'e' && tag[1] === issueId),
                    ).length,
                { timeout: 30_000, message: 'das 1632 ist nie am Relay angekommen' },
            )
            .toBe(1)

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
        // Seit P1 (GitHub-Parität): die Zeile linkt auf die EIGENE Seite des
        // Vorschlags — kein Akkordeon mehr.
        await zeile.locator('a[data-forge-vorgang-link]').click()
        const blatt = page.locator('[data-forge-einzel-blatt]')
        await expect(blatt).toBeVisible({ timeout: 30_000 })

        const form = page.locator('[data-forge-comment-form]')
        await expect(form).toBeVisible()
        await form.getByLabel('Kommentar').fill(kommentar)
        await form.getByRole('button', { name: 'Kommentieren' }).click()

        await expect(page.locator('[data-forge-einzel-kommentare]')).toContainText(kommentar, { timeout: 30_000 })
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

        // Das Issue ist „Erledigt" — im Offen-Ausschnitt der Liste (GH-Form)
        // steht es nicht; erst der Umschalter holt es hervor.
        await page.locator('[data-forge-zustand="geschlossen"]').click()
        const zeile = page.locator('[data-forge-issue]').filter({ hasText: marke }).first()
        await expect(zeile).toBeVisible({ timeout: 30_000 })
        await expect(zeile).toHaveAttribute('data-status', 'resolved')

        // Seit P1 (GitHub-Parität) auf der eigenen Seite. Der Knopf bietet bei
        // „Erledigt" das Wiederöffnen an (GitHub-Form: EIN Verb je Zustand) —
        // dieselbe Faltungs-Falle: unser 1630 verliert gegen den future-stempel-
        // ten 1631 des Eigentümers.
        await zeile.locator('a[data-forge-vorgang-link]').click()
        const blatt = page.locator('[data-forge-einzel-blatt]')
        await expect(blatt).toBeVisible({ timeout: 30_000 })
        await expect(blatt.locator('[data-forge-status]')).toHaveAttribute('data-status', 'resolved')

        await page.locator('[data-forge-status-ziel="open"]').click()

        // Die Fläche sagt, dass es nicht gewirkt hat — und lässt den echten
        // Zustand stehen, statt den gewünschten vorzugaukeln.
        const fehler = page.locator('[data-forge-write-failed="root"]')
        await expect(fehler).toBeVisible({ timeout: 30_000 })
        await expect(fehler).toContainText('durchgesetzt')
        await expect(blatt.locator('[data-forge-status]')).toHaveAttribute('data-status', 'resolved')

        // Und das eigene Ereignis liegt trotzdem am Relay — `OK true` war
        // wahr, es war nur nicht das, was der Nutzer wollte. (1630 = wieder
        // offen, seit diesem Umbau das angebotene Verb am erledigten Issue.)
        const eigene = events(['-k', '1630', '-t', `a=${address}`]).filter(
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
     * P6 — **die Tastatur-Auslösung, erste Hälfte des Belegs.**
     *
     * Beim P8-Gate blieb offen, ob der Riegel auch für die Tastatur gilt: getestet
     * war nur die Maus. Der Bericht sagte „der Riegel sitzt am gemeinsamen Pfad,
     * nicht am Knopf" — plausibel, aber nicht gemessen. Dieser Test misst die eine
     * Hälfte davon: **die Tastatur erreicht denselben Pfad.** Kein Klick, keine
     * Maus, nur Fokus und Eingabetaste — und das Issue entsteht.
     *
     * Das ist keine Selbstverständlichkeit, die man sich sparen könnte: Wäre der
     * Absender ein `div` mit `x-on:click` (im Haus mehrfach vorhanden), täte die
     * Eingabetaste hier gar nichts, und die Fläche wäre ohne Maus unbedienbar. Der
     * Test hält also zwei Dinge zugleich fest — die Bedienbarkeit und die
     * Vorbedingung für die zweite Hälfte weiter unten.
     */
    test('die Tastatur löst denselben Weg aus wie der Klick', async ({ page }) => {
        const marke = `P6 Tastatur ${randomUUID().slice(0, 8)}`

        await useWorkspace(page)
        await openRepo(page)

        await page.getByRole('button', { name: 'Neues Issue' }).click()
        await page.locator('[data-forge-issue-form]').getByLabel('Titel').fill(marke)

        // Fokus auf den Absender, dann Eingabetaste — der Weg eines Menschen ohne
        // Maus. `press` statt `click`: ein `click()` ginge auch auf einem Element,
        // das per Tastatur gar nicht erreichbar wäre.
        await page.locator('[data-forge-issue-submit]').focus()
        await expect(page.locator('[data-forge-issue-submit]')).toBeFocused()
        await page.keyboard.press('Enter')

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
     * P6 — **zweite Hälfte: der Riegel sitzt am PFAD, nicht am Knopf.**
     *
     * Hier wird der Knopf gar nicht erst angefasst. Aufgerufen wird `submitIssue()`
     * direkt an der Alpine-Komponente, zweimal in DERSELBEN Mikrotask. Damit ist
     * jede Sperre, die am DOM hängt, aus der Messung genommen: das `::disabled`
     * kann nicht greifen, weil kein Ereignis über einen Knopf läuft, und Alpines
     * Reaktivität kommt zwischen den beiden Aufrufen ohnehin nicht zum Zug.
     *
     * Die Uhr wird zwischen den Aufrufen vorgestellt — sonst wären beide Ereignisse
     * byte-identisch, hätten dieselbe Id, und „nur eines am Relay" wäre die Aussage
     * des Protokolls statt die des Riegels. Diese Falle hat den Klick-Test dieser
     * Datei zweimal grün gemacht, ohne dass er etwas geprüft hätte.
     *
     * **Zusammen mit dem Test darüber ist das der Beleg**, um den das Gate gebeten
     * hat: die Tastatur erreicht den Pfad (oben), und im Pfad liegt der Riegel
     * (hier). Keiner der beiden Tests sagt das allein.
     */
    test('der Doppelklick-Riegel sitzt im Pfad — ein Knopf ist dafür nicht nötig', async ({ page }) => {
        const marke = `P6 Pfadriegel ${randomUUID().slice(0, 8)}`

        await useWorkspace(page)
        await openRepo(page)

        await page.getByRole('button', { name: 'Neues Issue' }).click()
        await page.locator('[data-forge-issue-form]').getByLabel('Titel').fill(marke)

        const aufrufe = await page.evaluate(() => {
            const form = document.querySelector('[data-forge-issue-form]')
            const alpine = (window as unknown as { Alpine?: { $data: (el: Element) => Record<string, unknown> } }).Alpine
            if (!form || !alpine) {
                return 0
            }
            const state = alpine.$data(form) as { submitIssue?: () => Promise<void> }
            if (typeof state.submitIssue !== 'function') {
                return 0
            }
            const echt = Date.now
            void state.submitIssue()
            // Fünf Sekunden weiter: sonst trüge das zweite Ereignis denselben
            // Zeitstempel und damit dieselbe Id.
            Date.now = () => echt() + 5_000
            try {
                void state.submitIssue()
            } finally {
                Date.now = echt
            }

            return 2
        })
        // Die Vorbedingung selbst prüfen — ohne sie wäre der Test grün, ohne je
        // aufgerufen zu haben.
        expect(aufrufe, 'die Insel war über Alpine nicht erreichbar').toBe(2)

        await expect(page.locator('[data-forge-issue]').filter({ hasText: marke }).first()).toBeVisible({
            timeout: 30_000,
        })
        // Erst wenn das Formular zu ist, ist der Flug beendet — vorher stünde die
        // Zeile bloß optimistisch da, und der `nak req` unten läse ein Fenster, in
        // dem der Relay noch nichts hat.
        await expect(page.locator('[data-forge-issue-form]')).toHaveCount(0)

        const amRelay = events(['-k', '1621', '-t', `a=${address}`]).filter(
            (event) => tagValue(event.tags, 'subject') === marke,
        )
        expect(amRelay).toHaveLength(1)
    })

    /**
     * P4 (GitHub-Parität): der Zustands-Umschalter der Liste — „N offen /
     * M geschlossen". Der Relay liefert beides, die Liste zeigt seit P4 nur
     * den gewählten Ausschnitt. Ohne diesen Test wäre der Umschalter eine
     * Zierde, die auch nichts tut.
     */
    test('der Zustands-Umschalter der Issue-Liste zeigt offen und geschlossen getrennt', async ({ page }) => {
        const offen = `P4 Offen ${randomUUID().slice(0, 8)}`
        const zu = `P4 Zu ${randomUUID().slice(0, 8)}`
        expect(
            publish(BUZZ_USER_NSEC, ['-k', '1621', '-t', `a=${address}`, '-t', `p=${owner}`, '-t', `subject=${offen}`, '-c', 'Offen.']),
        ).toContain('success')
        expect(
            publish(BUZZ_USER_NSEC, ['-k', '1621', '-t', `a=${address}`, '-t', `p=${owner}`, '-t', `subject=${zu}`, '-c', 'Wird zu.']),
        ).toContain('success')
        const frischZu = events(['-k', '1621', '-t', `a=${address}`]).find((e) => tagValue(e.tags, 'subject') === zu)?.id
        expect(frischZu).toHaveLength(64)
        expect(
            publish(BUZZ_USER_NSEC, ['-k', '1632', '--tag', `e=${frischZu};;root`, '-t', `a=${address}`]),
        ).toContain('success')

        await useWorkspace(page)
        await openRepo(page)

        // Offen (Startwert): das offene Issue steht, das geschlossene nicht.
        await expect(page.locator('[data-forge-issue]').filter({ hasText: offen })).toBeVisible({ timeout: 30_000 })
        await expect(page.locator('[data-forge-issue]').filter({ hasText: zu })).toHaveCount(0)

        // Der Umschalter benennt BEIDE Zahlen — ungesucht, wie bei GitHub.
        await expect(page.locator('[data-forge-zustand-wahl]')).toContainText('1')

        await page.locator('[data-forge-zustand="geschlossen"]').click()
        await expect(page.locator('[data-forge-issue]').filter({ hasText: zu })).toBeVisible({ timeout: 30_000 })
        await expect(page.locator('[data-forge-issue]').filter({ hasText: offen })).toHaveCount(0)

        await page.locator('[data-forge-zustand="offen"]').click()
        await expect(page.locator('[data-forge-issue]').filter({ hasText: offen })).toBeVisible({ timeout: 30_000 })
        await expect(page.locator('[data-forge-issue]').filter({ hasText: zu })).toHaveCount(0)
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
        await zeile.locator('a[data-forge-vorgang-link]').click()
        const blatt = page.locator('[data-forge-einzel-blatt]')
        await expect(blatt).toBeVisible({ timeout: 30_000 })

        // Kein Statusknopf — stattdessen der Grund.
        await expect(page.locator('[data-forge-status-actions]')).toHaveCount(0)
        const hinweis = page.locator('[data-forge-status-hint]')
        await expect(hinweis).toBeVisible()
        await expect(hinweis).toContainText('Repository')

        // Kommentieren darf man trotzdem — die beiden Rechte sind nicht dasselbe.
        await expect(page.locator('[data-forge-comment-form]')).toBeVisible()
    })
})
