import { test, expect, type Page } from './support/fixtures'
import { useZooid, ZOOID_WS } from './support/zooid'
import { loginNsec } from './support/login'
import { execFileSync, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'

/**
 * P6 DES FORGE-PLANS (`2026-08-24T1810-forge-navigation-buzz-vorbild.md`) —
 * plus zwei Nachzüge, die aus P3 und P4 offen standen.
 *
 * ── Was hier steht, und was NICHT ────────────────────────────────────────────
 * Die reinen Regeln (Sortierung, Scope, Balkenrechnung) prüft `forgeFilter.test.ts`
 * ohne Browser und ohne Relay. Hier steht ausschliesslich, was ohne echte Fläche
 * nicht prüfbar ist:
 *
 *   1. **Der Kachelklick setzt den Fokus** — der Beleg für das VERHALTEN, den
 *      P3 offen liess. Er war live gesehen und nirgends festgehalten.
 *   2. **Die Dialogmechanik des Handlungsknopfes** (Fokusfalle, Escape,
 *      Fokusrückgabe) — in P4 ebenfalls nur live gemessen.
 *   3. **Reihenfolge und Ausschnitt greifen wirklich** auf die gerenderte Liste,
 *      nicht nur auf das Modell.
 *   4. **Der Balken und der Maintainer-Stapel stehen da**, samt der Zahl, die
 *      die Aussage trägt (WCAG 1.4.1).
 *   5. **Die Krümelspur steht mobil und schweigt am Desktop.**
 *
 * ── Warum `desktop-` und nicht `buzz-` ──────────────────────────────────────
 * Gemessen wird die FLÄCHE gegen den worker-eigenen zooid, nicht die
 * Reviewer-/Assignee-Semantik eines Buzz-Relays; im Buzz-Arm fährt das
 * Desktop-Projekt ohnehin nicht (`playwright.config.ts`). Das Präfix pinnt den
 * Viewport auf 1440 px — die Tests, die die schmale Form messen, setzen ihn
 * selbst um (`setViewportSize` sticht die Projekt-Vorgabe).
 *
 * ── Der Bestand ─────────────────────────────────────────────────────────────
 * Zwei Repositories, weil der Balken bei EINEM aktiven Repo bewusst ausbleibt —
 * mit nur einem wäre die Zusage „der Balken steht da" per Konstruktion rot, und
 * mit nur einem wäre die Zusage „er bleibt aus" trivial. Beide Fälle brauchen
 * beide Repos. Der `d`-Wert ist je Lauf frisch (`randomUUID`), damit kein
 * liegengebliebener Bestand eines früheren Laufs die Zählung verschiebt; alles
 * wird in `afterAll` per kind 5 wieder eingesammelt. Geschrieben wird
 * ausschliesslich auf den worker-eigenen zooid.
 */

const NSEC = process.env.NOSTR_TEST_NSEC as string
const NAK = process.env.NAK ?? `${process.env.HOME}/go/bin/nak`

const LAUF = randomUUID().slice(0, 8)
const REPO_VIEL = `e2e-p6-viel-${LAUF}`
const REPO_WENIG = `e2e-p6-wenig-${LAUF}`

function nak(args: string[]): string {
    let letzter: unknown = new Error('nak nicht aufgerufen')
    for (let i = 0; i < 3; i++) {
        const res = spawnSync(NAK, [...args], { encoding: 'utf8', timeout: 30_000 })
        if (res.error) {
            letzter = res.error
            execFileSync('sleep', ['1'])
            continue
        }

        return `${res.stdout ?? ''}\n${res.stderr ?? ''}`
    }
    throw letzter
}

/** Publiziert und gibt die Event-Id zurück — mit Quittungsprüfung. */
function publiziere(args: string[]): string {
    const aus = nak(['event', '--auth', '--sec', NSEC, ...args, ZOOID_WS])
    expect(aus, `Der Relay hat das Ereignis nicht angenommen: ${aus}`).toContain('success')
    const zeile = aus.split('\n').map((l) => l.trim()).find((l) => l.startsWith('{'))
    expect(zeile, `nak hat kein Ereignis ausgegeben: ${aus}`).toBeTruthy()
    const id = (JSON.parse(zeile as string) as { id: string }).id
    expect(id).toHaveLength(64)

    return id
}

let ids: string[] = []
let pubkey = ''

async function forge(page: Page, breite?: number): Promise<void> {
    await useZooid(page)
    await page.addInitScript((url) => {
        ;(window as unknown as { __nostrWorkspace: string }).__nostrWorkspace = url
    }, `${ZOOID_WS}/`)
    if (breite) {
        await page.setViewportSize({ width: breite, height: 1000 })
    }
    await loginNsec(page, NSEC)
    await page.goto('/forge')
    // Auf den ZUSTAND warten, nicht auf eine Wartezeit: solange `loading` steht,
    // sind die Regionen per `x-show` aus und jede Messung liefe gegen 0 — grün,
    // ohne irgendetwas geprüft zu haben.
    await page.waitForFunction(
        () => {
            const el = document.querySelector('[x-data^="nostrForge"]')
            const A = (window as unknown as { Alpine?: { $data(e: Element): { loading?: boolean } } }).Alpine

            return !!el && !!A && A.$data(el).loading === false
        },
        undefined,
        { timeout: 30_000 },
    )
    await expect(page.locator('[data-forge-repo]').first()).toBeVisible({ timeout: 30_000 })
}

test.describe('Forge-Feinschliff (P6)', () => {
    test.beforeAll(() => {
        expect(NSEC, 'NOSTR_TEST_NSEC ist nicht gesetzt').toBeTruthy()
        pubkey = nak(['key', 'public', NSEC]).trim().split('\n')[0].trim()
        expect(pubkey).toHaveLength(64)

        for (const dtag of [REPO_VIEL, REPO_WENIG]) {
            ids.push(publiziere([
                '-k', '30617',
                '-t', `d=${dtag}`,
                '-t', `name=${dtag}`,
                '-t', `description=Prüfstand P6 (${dtag}).`,
                '-t', `maintainers=${pubkey}`,
                '-t', `clone=https://example.invalid/git/${dtag}`,
            ]))
        }
        // Das eine Repo bekommt DREI Issues, das andere EINES — damit sind zwei
        // Repos aktiv (der Balken lohnt) und die Balken sind verschieden lang.
        for (let i = 0; i < 3; i++) {
            ids.push(publiziere([
                '-k', '1621',
                '-t', `a=30617:${pubkey}:${REPO_VIEL}`,
                '-t', `subject=P6 viel ${i} ${LAUF}`,
                '-c', `Rumpf ${i}`,
            ]))
        }
        ids.push(publiziere([
            '-k', '1621',
            '-t', `a=30617:${pubkey}:${REPO_WENIG}`,
            '-t', `subject=P6 wenig ${LAUF}`,
            '-c', 'Rumpf',
        ]))

        // **Annehmen und AUSLIEFERN sind zwei verschiedene Zusagen.** Ein
        // Gruppenrelay darf ein Ereignis speichern und trotzdem nicht auf eine
        // REQ antworten — ohne diese Rückfrage zeigte ein späterer Fehlschlag
        // auf die Fläche statt auf den Bestand. (Genau daran hing der erste
        // Lauf dieses Prüfstands: drei von vier Issues kamen nicht zurück.)
        const zurueck = nak(['req', '--auth', '--sec', NSEC, '-k', '1621', '-l', '200', ZOOID_WS])
        const jeRepo = new Map<string, number>()
        for (const zeile of zurueck.split('\n')) {
            const roh = zeile.trim()
            if (!roh.startsWith('{')) {
                continue
            }
            let ev: { tags?: string[][] }
            try {
                ev = JSON.parse(roh) as { tags?: string[][] }
            } catch {
                continue
            }
            const adresse = (ev.tags ?? []).find((t) => t[0] === 'a')?.[1] ?? ''
            const dtag = adresse.split(':').slice(2).join(':')
            if (dtag === REPO_VIEL || dtag === REPO_WENIG) {
                jeRepo.set(dtag, (jeRepo.get(dtag) ?? 0) + 1)
            }
        }
        console.log(`[P6] Am Relay wiedergefunden: ${REPO_VIEL}=${jeRepo.get(REPO_VIEL) ?? 0}, ${REPO_WENIG}=${jeRepo.get(REPO_WENIG) ?? 0}`)
        expect(jeRepo.get(REPO_VIEL) ?? 0, 'Der Relay gibt die Issues des aktiven Repos nicht wieder heraus').toBe(3)
        expect(jeRepo.get(REPO_WENIG) ?? 0, 'Der Relay gibt das Issue des ruhigen Repos nicht wieder heraus').toBe(1)
    })

    test.afterAll(() => {
        // Der worker-eigene zooid überlebt den Lauf (RUNMARK-Wiederverwendung),
        // also wird aufgeräumt.
        //
        // **Ein 30617 braucht `a` UND `k` — `-e <id>` allein richtet nichts aus.**
        // Am 2026-08-24 Schritt für Schritt gemessen:
        //   · `-e <id>`                    → `success`, Repo bleibt abrufbar
        //   · `-t a=30617:<pub>:<d>`       → `success`, Repo bleibt abrufbar
        //   · `-t a=…` PLUS `-t k=30617`   → `success`, Repo ist WEG
        // Nach zehn Läufen dieses Prüfstands standen zweiundzwanzig
        // Repositories in der Liste, obwohl jeder Lauf „aufgeräumt" hatte. Ein
        // 30617 ist ADRESSIERBAR; NIP-09 verlangt dafür das `a`-Tag, und dieser
        // Relay verlangt zusätzlich das `k`-Tag mit der Art. Dieselbe Klasse wie
        // „kind 5 löscht ein 45003 nicht, quittiert aber mit success" — eine
        // Quittung ist keine Wirkung.
        //
        // Der Prüfstand hängt nicht mehr davon ab (er filtert auf die Kennung
        // dieses Laufs), aber liegenbleibender Bestand ist trotzdem Müll: er
        // verlängert jede Repo-Liste und drückt gegen `FORGE_ROOT_LIMIT`.
        for (const id of ids) {
            nak(['event', '--sec', NSEC, '-k', '5', '-e', id, ZOOID_WS])
        }
        for (const dtag of [REPO_VIEL, REPO_WENIG]) {
            nak(['event', '--sec', NSEC, '-k', '5', '-t', `a=30617:${pubkey}:${dtag}`, '-t', 'k=30617', ZOOID_WS])
        }
    })

    /**
     * NACHZUG C — die offene E2E-Lücke aus P3.
     *
     * Der Klick auf eine Bestandskachel wechselt die Liste. Für die Maus war das
     * immer sichtbar; für die Tastatur und die Sprachausgabe passierte bis zur
     * P4-Nacharbeit gar nichts — der Fokus blieb auf der Kachel stehen, während
     * die Fläche daneben ihren Inhalt tauschte.
     *
     * Geprüft wird BEIDES: dass die Liste steht UND dass der Fokus in ihrer
     * Überschrift sitzt. Die zweite Hälfte ist die, die niemand sieht.
     */
    test('Kachelklick: die Liste steht — und der Fokus sitzt in ihrer Ueberschrift', async ({ page }) => {
        test.setTimeout(90_000)
        await forge(page)

        await page.locator('[data-forge-kachel="issues"]').click()

        await expect(page.locator('[data-forge-region="issues"]')).toBeVisible()
        await expect
            .poll(() =>
                page.evaluate(() => {
                    const aktiv = document.activeElement as HTMLElement | null

                    return {
                        istTitel: aktiv?.hasAttribute('data-forge-region-titel') ?? false,
                        region: aktiv?.closest('[data-forge-region]')?.getAttribute('data-forge-region') ?? '',
                    }
                }),
            )
            .toEqual({ istTitel: true, region: 'issues' })

        // Und dasselbe über den Segment-Umschalter — er teilt sich `zeigeListe()`
        // mit den Kacheln, und genau deshalb wird er hier mitgeprüft: ein Fix an
        // einer Stelle darf nicht die andere still verlieren.
        await page.locator('[data-forge-liste="repos"]').click()
        await expect
            .poll(() =>
                page.evaluate(
                    () =>
                        (document.activeElement as HTMLElement | null)
                            ?.closest('[data-forge-region]')
                            ?.getAttribute('data-forge-region') ?? '',
                ),
            )
            .toBe('repos')
    })

    /** Reihenfolge und Ausschnitt greifen auf die GERENDERTE Liste. */
    test('Reihenfolge und Ausschnitt wirken auf die Liste, und die Trefferzahl sagt es', async ({ page }) => {
        test.setTimeout(90_000)
        await forge(page)

        /**
         * Die Repo-Namen in der Reihenfolge, in der sie WIRKLICH stehen.
         *
         * Gelesen wird das `data-naddr`-tragende Element und darin der erste
         * `span` der Textzelle — das ist seit P6 der Name (die Zeile trägt
         * daneben den Aktivitätsbalken).
         *
         * **Gefiltert auf die Kennung DIESES Laufs, nicht auf das Präfix.** Der
         * worker-eigene zooid überlebt den Testlauf, und sein Bestand wächst:
         * das `afterAll` unten räumt die 30617 nachweislich NICHT weg (siehe
         * dort). Ein Präfix-Filter fand deshalb im zehnten Lauf zwanzig
         * Repositories statt zwei — und die Reihenfolge-Zusicherung hätte über
         * fremdem Bestand geurteilt.
         */
        const namen = (): Promise<string[]> =>
            page.evaluate((praefix) =>
                Array.from(document.querySelectorAll('[data-forge-repo]'))
                    .map((el) => (el.querySelector('.forge-text span')?.textContent ?? '').trim())
                    .filter((n) => n.endsWith(praefix)),
            LAUF)

        // KONTROLLE zuerst: findet die Sonde die beiden Zeilen überhaupt? Ohne
        // sie wäre jede Reihenfolge-Zusicherung über einer leeren Liste grün.
        const nachName = await page.evaluate(() => {
            const el = document.querySelector('[data-forge-sortierung]') as HTMLSelectElement
            el.value = 'name'
            el.dispatchEvent(new Event('input', { bubbles: true }))
            el.dispatchEvent(new Event('change', { bubbles: true }))

            return true
        })
        expect(nachName).toBe(true)
        await page.waitForTimeout(200)
        const alphabetisch = await namen()
        console.log('[P6] Reihenfolge „Nach Name":', JSON.stringify(alphabetisch))
        expect(alphabetisch.length, 'Die Sonde findet die Prüfstands-Repos nicht — sie misst nichts.').toBe(2)
        expect(alphabetisch[0]).toContain('viel')
        expect(alphabetisch[1]).toContain('wenig')

        // Der Ausschnitt: alle Prüfstands-Issues stammen vom Testnutzer, also
        // liefert „Von mir" sie alle und „Mir zugewiesen" keines. Beide
        // Richtungen, damit ein Filter, der gar nichts tut, auffällt.
        await page.locator('[data-forge-kachel="issues"]').click()
        const zaehleIssues = () =>
            page.evaluate(() =>
                Array.from(document.querySelectorAll('[data-forge-region="issues"] [data-forge-vorgang-link]')).length,
            )
        const alle = await zaehleIssues()
        expect(alle, 'Ohne Issues misst dieser Test nichts').toBeGreaterThan(0)

        const setzeScope = (wert: string) =>
            page.evaluate((w) => {
                const el = document.querySelector('[data-forge-scope]') as HTMLSelectElement
                el.value = w
                el.dispatchEvent(new Event('input', { bubbles: true }))
                el.dispatchEvent(new Event('change', { bubbles: true }))
            }, wert)

        await setzeScope('von-mir')
        await page.waitForTimeout(200)
        expect(await zaehleIssues(), '„Von mir" hat die eigenen Issues weggefiltert').toBe(alle)

        await setzeScope('zugewiesen')
        await page.waitForTimeout(200)
        expect(await zaehleIssues(), '„Mir zugewiesen" zeigt Vorgänge ohne Zuweisung').toBe(0)

        // Die Live-Region sagt, was der Filter getan hat. Ohne sie ist eine
        // gefilterte Liste von einem leeren Workspace nicht zu unterscheiden.
        const trefferzahl = page.locator('[data-forge-trefferzahl]')
        await expect(trefferzahl).toHaveAttribute('aria-live', 'polite')
        await expect(trefferzahl).not.toHaveText('')

        await setzeScope('alle')
        await page.waitForTimeout(200)
        await expect(trefferzahl, 'Ohne aktiven Filter ist „n von n" nur Lärm').toHaveText('')
    })

    /** Balken und Gesichter — samt der Zahl, die die Aussage trägt. */
    test('Aktivitaetsbalken und Maintainer-Stapel stehen da, mit Zahl und Namen', async ({ page }) => {
        test.setTimeout(90_000)
        await forge(page)

        // ── Auf den BESTAND warten, nicht auf einen Moment ──────────────────
        //
        // `loading === false` bedeutet „der erste Ladevorgang ist durch", nicht
        // „alle Ereignisse sind da": die Vorgänge treffen über ein laufendes Abo
        // nach, und der Balken wächst mit ihnen. Im Vollauf unter Parallellast
        // hat genau das zugeschlagen — gemessen wurde ein Zwischenstand, in dem
        // das ruhigere Repo (2 Ereignisse) schon vollständig war und das aktivere
        // (4) erst bei zweien stand. Der Balken war dann korrekt normalisiert,
        // nur eben auf einen halben Bestand: `viel` 50, `wenig` 100.
        //
        // Seriell war das nie zu sehen. Deshalb steht hier eine Bedingung und
        // keine Wartezeit — eine Wartezeit wäre geraten, dieser `poll` ist die
        // Zusage. Verglichen wird gegen die Zahlen, die der Relay in `beforeAll`
        // selbst zurückgegeben hat.
        await expect
            .poll(
                () =>
                    page.evaluate((tags) => {
                        const el = document.querySelector('[x-data^="nostrForge"]')!
                        const A = (
                            window as unknown as {
                                Alpine: {
                                    $data(e: Element): {
                                        overview: { repos: { dtag: string; issueCount: number }[] }
                                    }
                                }
                            }
                        ).Alpine
                        const repos = A.$data(el).overview.repos

                        return {
                            viel: repos.find((r) => r.dtag === tags[0])?.issueCount ?? -1,
                            wenig: repos.find((r) => r.dtag === tags[1])?.issueCount ?? -1,
                        }
                    }, [REPO_VIEL, REPO_WENIG]),
                { timeout: 30_000 },
            )
            .toEqual({ viel: 3, wenig: 1 })

        const zeile = page.locator('[data-forge-repo]').filter({ hasText: REPO_VIEL }).first()
        const balken = zeile.locator('[data-forge-balken]')
        await expect(balken, 'Bei zwei aktiven Repos muss der Balken stehen').toHaveCount(1)

        const stand = await page.evaluate((dtag) => {
            const row = Array.from(document.querySelectorAll('[data-forge-repo]')).find((el) =>
                (el.textContent ?? '').includes(dtag),
            ) as HTMLElement
            const b = row.querySelector('[data-forge-balken]') as HTMLElement
            const fuellung = b.firstElementChild as HTMLElement

            return {
                anteil: b.getAttribute('data-anteil'),
                fuellbreite: fuellung.getBoundingClientRect().width,
                schiene: b.getBoundingClientRect().width,
                balkenVersteckt: b.getAttribute('aria-hidden'),
                // Die Zahl daneben — sie ist der nicht-visuelle Träger (1.4.1).
                satz: (row.querySelector('.sr-only') as HTMLElement | null)?.textContent ?? '',
                // Der Stapel: echte Avatare, keine Ziffer.
                gesichter: row.querySelectorAll('.forge-stapel-platz').length,
                // **`.sr-only` UND `.forge-wort`.** Der Maintainer-Satz hängt seit
                // P6 an `forge-wort`: die Klasse ist in der gestapelten Form
                // SICHTBAR und erst in der Spaltenform auf 1 px geklemmt. Eine
                // Sonde, die nur `.sr-only` liest, findet ihn deshalb je nach
                // Containerbreite oder nicht — sie misst dann die Form, nicht die
                // Zusage. (Genau daran ist der erste Vollauf hier gescheitert.)
                stapelSatz: Array.from(row.querySelectorAll('.sr-only, .forge-wort'))
                    .map((e) => e.textContent ?? '')
                    .join(' | '),
            }
        }, REPO_VIEL)
        console.log('[P6] Repo-Zeile:', JSON.stringify(stand))
        console.log('[P6] Inselstand:', JSON.stringify(await page.evaluate((tags) => {
            const el = document.querySelector('[x-data^="nostrForge"]')!
            const A = (window as unknown as { Alpine: { $data(e: Element): { overview: { repos: { dtag: string; activityCount: number; activityShare: number; issueCount: number }[]; aktivitaetsbalken: boolean } } } }).Alpine
            const d = A.$data(el)

            return {
                balkenLohnt: d.overview.aktivitaetsbalken,
                meine: d.overview.repos
                    .filter((r) => tags.includes(r.dtag))
                    .map((r) => ({ d: r.dtag.slice(-14), issues: r.issueCount, ereignisse: r.activityCount, anteil: +r.activityShare.toFixed(2) })),
            }
        }, [REPO_VIEL, REPO_WENIG])))

        expect(stand.balkenVersteckt, 'Der Balken selbst gehört nicht in den Vorlesebaum').toBe('true')
        expect(stand.fuellbreite).toBeGreaterThan(0)
        expect(stand.fuellbreite).toBeLessThanOrEqual(stand.schiene + 0.5)
        expect(stand.stapelSatz, 'Der Satz zum Balken fehlt — dann trägt nur die Grafik').toMatch(
            /Ereignis(se)? in den letzten 30 Tagen/,
        )
        expect(stand.stapelSatz, 'Der Maintainer-Satz fehlt — der Stapel wäre dann namenlos').toMatch(/Maintainer/)
        expect(stand.gesichter, 'Der Stapel zeigt keine Gesichter').toBeGreaterThan(0)

        // Das ruhigere Repo hat einen KÜRZEREN Balken — sonst normalisiert
        // nichts, und der Balken wäre überall voll.
        const anteilWenig = await page.evaluate((dtag) => {
            const row = Array.from(document.querySelectorAll('[data-forge-repo]')).find((el) =>
                (el.textContent ?? '').includes(dtag),
            ) as HTMLElement

            return Number(row.querySelector('[data-forge-balken]')?.getAttribute('data-anteil') ?? '-1')
        }, REPO_WENIG)
        console.log('[P6] Anteil des ruhigeren Repos:', anteilWenig, '· des aktiveren:', stand.anteil)
        expect(anteilWenig).toBeGreaterThan(0)
        // **Verglichen wird zwischen den BEIDEN Prüfstands-Repos, nicht gegen 100.**
        // Der worker-eigene zooid trägt Bestand aus anderen Prüfständen; ob
        // ausgerechnet unser Repo das aktivste des Workspace ist, ist keine
        // Eigenschaft dieser Fläche. Die Zusage ist die NORMALISIERUNG: mehr
        // Ereignisse ⇒ längerer Balken. Wäre nichts normalisiert, wären beide
        // gleich lang — und genau das fängt dieser Vergleich.
        expect(
            Number(stand.anteil),
            'Beide Balken sind gleich lang — es wird nicht normalisiert',
        ).toBeGreaterThan(anteilWenig)
    })

    /** Krümelspur: mobil da, am Desktop still. */
    test('die Kruemelspur steht mobil und schweigt ab xl', async ({ page }) => {
        test.setTimeout(90_000)
        await forge(page)
        await page.locator('[data-forge-repo]').filter({ hasText: REPO_VIEL }).first().click()
        await page.waitForURL(/\/forge\/naddr1/, { timeout: 30_000 })
        const spur = page.locator('[data-forge-kruemel]')
        await expect(spur, 'Ab xl führt der Navigator — eine zweite Antwort wäre eine zu viel').toBeHidden()

        await page.setViewportSize({ width: 390, height: 844 })
        await expect(spur).toBeVisible()
        await expect(spur).toContainText('Forge')
        await expect(spur.locator('[aria-current="page"]')).toHaveText(REPO_VIEL)
        // Kein waagerechter Dokument-Überlauf durch die neue Zeile (WCAG 1.4.10).
        await page.setViewportSize({ width: 320, height: 844 })
        await page.waitForTimeout(200)
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320)
    })

    /**
     * NACHZUG B — die Dialogmechanik des Handlungsknopfes aus P4.
     *
     * Fokusfalle, Escape und Fokusrückgabe waren live gemessen und nirgends
     * festgehalten. Ausgelöst wird über die TASTATUR, nicht per `click()`: das
     * Haus hat inerte Knöpfe (`aria-disabled`), und `click()` läuft dort in
     * einen 30-s-Timeout — hier ist der Knopf zwar nicht inert, aber der Weg
     * bleibt derselbe, damit die Zusage auch dann trägt, wenn er es einmal wird.
     */
    test('Handlungsknopf: Fokusfalle, Escape und Rueckgabe des Fokus', async ({ page }) => {
        test.setTimeout(90_000)
        await forge(page)
        await page.locator('[data-forge-repo]').filter({ hasText: REPO_VIEL }).first().click()
        await page.waitForURL(/\/forge\/naddr1/, { timeout: 30_000 })
        await page.setViewportSize({ width: 390, height: 844 })

        const knopf = page.locator('[data-forge-fab]')
        await expect(knopf, 'Ohne Schreibrecht gibt es den Knopf nicht — dann misst dieser Test nichts').toHaveCount(1, {
            timeout: 30_000,
        })
        await expect(knopf).toHaveAttribute('aria-expanded', 'false')
        await expect(knopf).toHaveAttribute('aria-haspopup', 'dialog')

        await knopf.focus()
        await page.keyboard.press('Enter')

        const blatt = page.locator('[data-forge-issue-blatt]')
        await expect(blatt).toBeVisible()
        await expect(knopf).toHaveAttribute('aria-expanded', 'true')
        await expect(page.locator('[data-forge-issue-form]')).toHaveCount(1)

        // ── Erst warten, bis die Falle STEHT ────────────────────────────────
        //
        // Alpines Fokus-Plugin aktiviert `x-trap` über `setTimeout(…, 15)`, und
        // davor läuft noch der 300-ms-Übergang des Blattes. Wer sofort tabbt,
        // tabbt an einer Falle vorbei, die es noch nicht gibt — seriell in 1 von
        // 3 Läufen gemessen, im Vollauf unter Last häufiger.
        //
        // Der `poll` ist zugleich eine eigene Zusage: die Falle HOLT den Fokus
        // ins Blatt, sie hält ihn nicht nur fest. Ohne diesen Schritt bliebe er
        // auf dem Knopf, und die sechs Tabs liefen durch die Seite dahinter.
        await expect
            .poll(
                () =>
                    page.evaluate(
                        () => !!(document.activeElement as HTMLElement)?.closest('[data-forge-issue-blatt]'),
                    ),
                { timeout: 10_000 },
            )
            .toBe(true)

        // Die Falle: sechsmal Tab führt an jedem Ziel des Blattes vorbei und
        // muss trotzdem drinnen enden.
        for (let i = 0; i < 6; i++) {
            await page.keyboard.press('Tab')
        }
        expect(
            await page.evaluate(() => !!(document.activeElement as HTMLElement)?.closest('[data-forge-issue-blatt]')),
            'Der Fokus ist aus dem Blatt gefallen — die Falle greift nicht',
        ).toBe(true)

        await page.keyboard.press('Escape')
        await expect(blatt).toBeHidden()
        // Das Formular ist WEG, nicht nur versteckt — die Zusage aus P2/P4.
        await expect(page.locator('[data-forge-issue-form]')).toHaveCount(0)
        await expect(knopf).toHaveAttribute('aria-expanded', 'false')
        expect(
            await page.evaluate(() => (document.activeElement as HTMLElement)?.hasAttribute('data-forge-fab')),
            'Der Fokus ist nicht auf den Knopf zurückgekehrt',
        ).toBe(true)
    })
})
