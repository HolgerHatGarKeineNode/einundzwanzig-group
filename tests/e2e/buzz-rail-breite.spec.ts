import { test, expect, type Page } from './support/fixtures'
import { useBuzz, BUZZ_URL, BUZZ_USER_NSEC } from './support/buzz'
import { loginNsec } from './support/login'

/**
 * P6 — **kürzt `nodeName()` die Zeilen der Workspace-Nav zu streng?**
 *
 * Der Design-Pass aus P1 hat den Verdacht als Vorschlag hinterlassen: `30 − 2·depth`
 * Zeichen ließen je Zeile 30–60 px ungenutzt. Ein Vorschlag ist keine Messung, und
 * eine neue Zahl zu raten wäre derselbe Fehler mit anderem Vorzeichen. Diese Datei
 * misst deshalb an der einzigen Stelle, die entscheidet — an der gerenderten
 * Beschriftung:
 *
 *   - `scrollWidth > clientWidth` ⇒ der Browser kürzt ein ZWEITES Mal (`truncate`),
 *     die Zahl ist zu groß. Zwei Kürzungen hintereinander ergeben „einund…zwan…" —
 *     das schlechteste aller Bilder.
 *   - `scrollWidth ≪ clientWidth` ⇒ `nodeName` hat schon gekürzt, obwohl die Spalte
 *     noch Platz hatte. Das ist der gemeldete Befund.
 *
 * Gemessen wird in **allen vier Nav-Zuständen** des Zielbilds (A: keine Repos ·
 * B: ein Repo als eine Zeile · C: Projekt mit Zwischenebene · D: Faltung ab fünf) —
 * denn die Kürzung hängt an `depth`, und die Zustände unterscheiden sich genau darin.
 *
 * ── Warum die Daten hier GESETZT und nicht geseedet werden ──────────────────
 * Die Zustände C und D bräuchten am Relay fünf Projekte und ein halbes Dutzend
 * Repos, die anschließend jede andere Buzz-Spec mitsähen. Der Prüfgegenstand ist
 * aber nicht der Netzweg (den prüft `buzz-rail-forge.spec.ts` am echten Relay),
 * sondern die GEOMETRIE der gerenderten Zeile. Also werden dieselben Felder
 * gesetzt, die das Forge-Abo sonst füllt (`forgeRepos`/`forgeProjects`/`workspace`),
 * und alles danach — Baumbildung, Kürzung, Markup, CSS — läuft echt.
 *
 * ── Der Dateiname ist Teil der Mechanik ─────────────────────────────────────
 * `playwright.config.ts` fährt im Buzz-Modus nur `buzz-*.spec.ts` und überspringt
 * alles andere LAUTLOS („Total: 0 tests", kein Fehler).
 */

const OWNER = 'a'.repeat(64)

/**
 * Ein Name in der Länge, die wirklich vorkommt — und aus den Zeichen, die
 * wirklich vorkommen.
 *
 * Ein Name aus lauter `W` wäre eine andere Frage („hält die Zahl auch im
 * theoretisch breitesten Fall?"), und die Antwort darauf ist bekannt und lautet
 * nein: eine Zeichenzahl kann für einen Proportionalsatz nie exakt sein. Wo sie
 * nicht reicht, greift die Ellipsis des Browsers — der eingebaute Rückfall.
 * Ausgerichtet wird deshalb an den Namen, die tatsächlich vergeben werden.
 */
const LANG = 'einundzwanzig-verein-webseite-relay-backend'

type Fixture = {
    repos: { address: string; name: string; naddr: string; channelId: string; issueCount: number; pullRequestCount: number }[]
    projects: { address: string; name: string; repoAddresses: string[] }[]
    rooms: { h: string; name: string }[]
}

const repo = (name: string, channelId = '', issueCount = 0, pullRequestCount = 0) => ({
    address: `30617:${OWNER}:${name}`,
    name,
    naddr: `naddr1${name}`,
    channelId,
    issueCount,
    pullRequestCount,
})

/** Die vier Zustände des abgenommenen Zielbilds, alle mit demselben Namen. */
const zustaende = (name: string): { id: string; titel: string; fixture: Fixture }[] => [
    {
        id: 'A',
        titel: 'A: keine Repos — kein Baum',
        fixture: { repos: [], projects: [], rooms: [{ h: 'kanal-a', name }] },
    },
    {
        id: 'B',
        titel: 'B: ein Repo als EINE Zeile, mit Kanal, Issues und Pull Requests',
        fixture: {
            repos: [repo(name, 'kanal-b', 12, 3)],
            projects: [],
            rooms: [{ h: 'kanal-b', name: `0V_${name}` }],
        },
    },
    {
        id: 'C',
        titel: 'C: ein Projekt mit drei Repos — die Zwischenebene steht',
        fixture: {
            repos: [repo(`${name}-1`, 'kanal-c', 12, 3), repo(`${name}-2`), repo(`${name}-3`)],
            projects: [{
                address: `30621:${OWNER}:p`,
                name,
                repoAddresses: [`30617:${OWNER}:${name}-1`, `30617:${OWNER}:${name}-2`, `30617:${OWNER}:${name}-3`],
            }],
            rooms: [{ h: 'kanal-c', name: `0V_${name}` }],
        },
    },
    {
        id: 'D',
        titel: 'D: fünf Projekte — die Liste faltet zusammen',
        fixture: {
            repos: [1, 2, 3, 4, 5].map((n) => repo(`${name}-${n}`)),
            projects: [1, 2, 3, 4, 5].map((n) => ({
                address: `30621:${OWNER}:p${n}`,
                name: `${name}-${n}`,
                repoAddresses: [`30617:${OWNER}:${name}-${n}`],
            })),
            // Ein ungebundener Kanal MUSS dabei sein: ohne einen einzigen Raum
            // rendert die Workspace-Sektion gar nicht erst, und die Messung wäre
            // leer — grün, weil sie nichts gefunden hat. (Genau so ist der erste
            // Entwurf dieses Zustands durchgelaufen.)
            rooms: [{ h: 'kanal-d', name: `0V_${name}` }],
        },
    },
]

type Messung = { id: string; label: string; scroll: number; client: number; frei: number }

/**
 * Fixture in die Rail setzen, alles aufklappen, jede Beschriftung vermessen.
 *
 * `_x_dataStack[0]` ist derselbe Zugriff, den `buzz-rail-forge.spec.ts` für die
 * Sprungliste benutzt — Alpine legt den Komponentenzustand dort ab.
 */
const messen = (page: Page, fixture: Fixture): Promise<Messung[]> =>
    page.evaluate((data) => {
        const el = document.querySelector('[data-rail]') as (HTMLElement & { _x_dataStack?: Record<string, unknown>[] }) | null
        const state = el?._x_dataStack?.[0] as (Record<string, unknown> & { open: Record<string, boolean> }) | undefined
        if (!state) {
            return []
        }
        state.forgeRepos = data.repos
        state.forgeProjects = data.projects
        state.workspace = { userRooms: data.rooms.map((r) => ({ ...r, joined: true })), otherRooms: [] }
        // JEDEN Knoten aufklappen: nur so stehen die tiefen Ebenen (und damit die
        // stärkste Kürzung) überhaupt im DOM. `open` ist derselbe Merker, den die
        // Klick-Wege schreiben.
        const offen: Record<string, boolean> = { ...(state.open ?? {}), workspace: true }
        for (const r of data.repos) {
            offen[r.address] = true
        }
        for (const p of data.projects) {
            offen[p.address] = true
        }
        state.open = offen

        return new Promise<Messung[]>((resolve) => {
            // Zwei Frames: einer für Alpines Re-Render, einer für das Layout.
            requestAnimationFrame(() => requestAnimationFrame(() => {
                const out: Messung[] = []
                for (const row of document.querySelectorAll('[data-node-id]')) {
                    const span = row.querySelector('span.truncate') as HTMLElement | null
                    if (!span || span.textContent === '') {
                        continue
                    }
                    // **`clientWidth` der Beschriftung ist NICHT der Platz, den sie
                    // hätte.** Der Span ist ein schrumpfendes Flex-Kind: passt der
                    // Text, ist `clientWidth === scrollWidth`, und „frei" wäre
                    // immer 0 — eine Zahl, die nie etwas sagt. Der Platz steckt im
                    // Elternteil, abzüglich dessen anderer Kinder (die Bestandszahl
                    // „· 3") und der Lücken (`gap-1` = 4 px).
                    const eltern = span.parentElement as HTMLElement
                    const geschwister = [...eltern.children]
                        .filter((kind) => kind !== span)
                        .reduce((summe, kind) => summe + kind.getBoundingClientRect().width + 4, 0)
                    const verfuegbar = Math.round(eltern.clientWidth - geschwister)
                    out.push({
                        id: row.getAttribute('data-node-id') ?? '',
                        label: span.textContent ?? '',
                        scroll: span.scrollWidth,
                        client: span.clientWidth,
                        frei: verfuegbar - span.scrollWidth,
                    })
                }
                resolve(out)
            }))
        })
    }, fixture) as Promise<Messung[]>

async function bootRail(page: Page): Promise<void> {
    await page.setViewportSize({ width: 1440, height: 900 })
    await useBuzz(page)
    await page.addInitScript((url) => {
        ;(window as unknown as { __nostrWorkspace: string }).__nostrWorkspace = url
    }, BUZZ_URL)
    await loginNsec(page, BUZZ_USER_NSEC)
    await expect(page.locator('[data-rail]')).toBeVisible({ timeout: 20_000 })
}

test.describe('Buzz-Workspace: die Breite der Nav-Zeilen (E2E, nur E2E_RELAY=buzz)', () => {
    test.skip(process.env.E2E_RELAY !== 'buzz', 'nur im Buzz-Modus (E2E_RELAY=buzz) relevant')

    test('in allen vier Nav-Zuständen kürzt CSS kein zweites Mal', async ({ page }) => {
        await bootRail(page)

        const bericht: string[] = []
        let gekuerzt = 0
        for (const zustand of zustaende(LANG)) {
            const messungen = await messen(page, zustand.fixture)
            gekuerzt += messungen.filter((m) => m.label.includes('…')).length
            const ueberlauf = messungen.filter((m) => m.scroll > m.client)
            const engste = messungen.reduce<Messung | null>((a, b) => (a === null || b.frei < a.frei ? b : a), null)
            bericht.push(
                `${zustand.titel}: ${messungen.length} Beschriftungen, ` +
                `${ueberlauf.length} mit Überlauf, engste Zeile ${engste ? `${engste.frei} px frei (${engste.label})` : '—'}`,
            )

            // DIE ZUSICHERUNG: keine Beschriftung läuft über. Täte sie es, kürzte
            // erst `nodeName` und danach das CSS — zwei Ellipsen in einer Zeile.
            expect(
                ueberlauf.map((m) => `${m.id}: ${m.scroll} > ${m.client} (${m.label})`),
                `${zustand.titel} — CSS kürzt ein zweites Mal`,
            ).toEqual([])
        }

        // Zustand A hat definitionsgemäß keine Baumzeile; die übrigen drei müssen
        // welche haben, sonst misst dieser Test nichts und wäre grün aus dem
        // falschen Grund.
        expect(bericht).toHaveLength(4)
        expect(bericht[1], 'Zustand B muss Zeilen tragen').not.toContain('0 Beschriftungen')
        expect(bericht[2], 'Zustand C muss Zeilen tragen').not.toContain('0 Beschriftungen')
        expect(bericht[3], 'Zustand D muss Zeilen tragen').not.toContain('0 Beschriftungen')

        // **Positivkontrolle.** „Nichts läuft über" wäre auch dann wahr, wenn
        // `nodeName` gar nicht mehr kürzte und ausschließlich das CSS die Zeile
        // beschnitte — dann stünde überall eine Ellipsis am ENDE statt in der
        // Mitte, und dieser Test bliebe grün. Also muss die Kürzung sichtbar
        // stattgefunden haben: mindestens eine Beschriftung trägt das
        // Auslassungszeichen aus `middleTruncate`.
        expect(gekuerzt, 'keine einzige Zeile wurde von nodeName gekürzt').toBeGreaterThan(0)

        // Die Zahlen gehören in den Lauf, nicht nur in einen Bericht: wer diese
        // Datei das nächste Mal anfasst, sieht sie ohne eigene Messung.
        for (const zeile of bericht) {
            test.info().annotations.push({ type: 'breite', description: zeile })
        }
        console.log(`\n[Breitenmessung ${LANG.length} Zeichen]\n${bericht.join('\n')}`)
    })

})
