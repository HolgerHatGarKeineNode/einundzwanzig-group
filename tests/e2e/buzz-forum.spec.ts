import { test, expect, type Locator, type Page } from './support/fixtures'
import {
    useBuzz,
    BUZZ_URL,
    BUZZ_PORT,
    BUZZ_USER_NSEC,
    BUZZ_OWNER_SEC_HEX,
    BUZZ_ROOM_FORUM,
    BUZZ_ROOM_FORUM_PRIVATE,
    BUZZ_ROOM_GENERAL,
} from './support/buzz'
import { loginNsec } from './support/login'
import { spawnSync } from 'node:child_process'
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { nsecEncode } from 'nostr-tools/nip19'

/**
 * P3/N1 — der **Forum-Modus** eines Buzz-Kanals, an der echten Fläche gegen einen
 * echten Buzz-Relay, in BEIDEN Sichtbarkeiten.
 *
 * ── Die gemessene Ereignisform (Teststack, 2026-08-17/18) ───────────────────
 *
 *   Kanal   `39000` mit `["t","forum"]` (aus `9007` + `["channel_type","forum"]`)
 *   Thema   `45001`, Tags NUR `["h",<uuid>]` — **kein Titel-Tag**
 *   Antwort `45003` bzw. `9`, je `["h",…]` + `["e",<root>,"","reply"]`
 *
 * Der Seed legt genau das an (`buzz-testserver.sh`): ein Thema mit ZWEI
 * Antworten, eine je Form. Dass beide Formen zählen, ist keine Auslegung — Buzz
 * Desktop fragt seinen Thread mit `kinds:[9,45003]` ab.
 *
 * ── Warum die Fälle über ZWEI Foren laufen (N1) ─────────────────────────────
 *
 * Das echte Forum des Nutzers ist **privat** — er lädt von Hand ein. P3 war nur
 * an einem OFFENEN Forum belegt, und das ist nicht dieselbe Lage: im privaten
 * Kanal entscheidet der Relay bei JEDEM Lesezugriff über die Kanalmitgliedschaft
 * neu. Am Relay gemessen (2026-08-18, Stack :3005) trennt genau ein Tag am 9007
 * die beiden Welten — `["visibility","private"]`, Default `open`:
 *
 *   offen:  39000 … ["public"],["closed"],["t","forum"]
 *   privat: 39000 … ["private"],["closed"],["t","forum"]
 *
 * `["closed"]` trägt bei Buzz JEDER Kanal und sagt über die Sichtbarkeit nichts.
 * Wer hineindarf, kommt per **kind 9000** (`h`+`p`+`role`) hinein — nicht per
 * 9030, das ist die Relay-Ebene, und nicht per 9021 (Selbstbeitritt), den der
 * Relay in einem privaten Kanal mit `channel is private` ablehnt.
 *
 * Die Fälle stehen deshalb in einer **Parametrisierung** und nicht in einem
 * zweiten Block: es sind wörtlich dieselben Zusagen, nur an einem anderen Kanal.
 * Zwei Blöcke wären zwei Kopien, die auseinanderlaufen — und die Hälfte, die
 * jemand vergisst, wäre garantiert die private (sie ist die seltenere Fixture,
 * nicht die seltenere Lage beim Nutzer).
 *
 * ── Zwei Mechaniken wie in `buzz-rail-forge.spec.ts` ────────────────────────
 * 1. Der Dateiname MUSS `buzz-*` sein (`playwright.config.ts:57`), sonst
 *    überspringt der Buzz-Modus die Datei lautlos.
 * 2. Der Buzz-Modus fährt auf 1279 px — einen Pixel unter `xl`. Die Rail-Fälle
 *    setzen ihren Viewport deshalb selbst.
 */

const NAK = process.env.NAK ?? `${process.env.HOME}/go/bin/nak`
const WS = (): string => `ws://localhost:${BUZZ_PORT}`

const nak = (args: string[]): string => {
    const res = spawnSync(NAK, args, { encoding: 'utf8', timeout: 30_000 })

    return `${res.stdout ?? ''}\n${res.stderr ?? ''}`
}

const publish = (sec: string, args: string[]): string => nak(['event', '--auth', '--sec', sec, ...args, WS()])
const query = (args: string[]): string => nak(['req', '--auth', '--sec', BUZZ_USER_NSEC, ...args, WS()])

/**
 * Ein frischer Wegwerf-Schlüssel MIT Relay-Mitgliedschaft, aber ohne jede
 * KANAL-Mitgliedschaft — die Gegenprobe zum privaten Forum.
 *
 * Das 9030 ist Pflicht und keine Bequemlichkeit: ohne es scheitert schon das
 * AUTH mit `restricted: not a relay member`, jede Sub endet mit
 * `auth-required: not authenticated`, und die Fläche zeigte ihr Gate aus einem
 * ganz anderen Grund als dem, den diese Probe misst. Erst MIT Relay-Zugang ist
 * „sieht das private Forum nicht" eine Aussage über den Kanal.
 *
 * Dieselbe Mechanik wie `freshMember()` in `buzz-room-gate.spec.ts`.
 */
const freshRelayMember = (): { nsec: string; pub: string } => {
    const sk = generateSecretKey()
    const pub = getPublicKey(sk)
    expect(
        publish(BUZZ_OWNER_SEC_HEX, ['-k', '9030', '-t', `p=${pub}`, '-t', 'role=member']),
        'Relay-Mitgliedschaft für den Wegwerf-Schlüssel konnte nicht gesetzt werden',
    ).toContain('success')

    return { nsec: nsecEncode(sk), pub }
}

/** Eine Forum-Fixture des Seeds: Kanal plus die Texte, die dort liegen. */
type ForumFixture = {
    /** Name im Testtitel — „offen" bzw. „privat". */
    readonly lage: string
    readonly h: string
    /** Der Kanalname im 39000 (Rail-Zeile, Kopfzeile). */
    readonly name: string
    readonly topicTitle: string
    readonly topicPreview: string
    readonly reply45003: string
    readonly replyKind9: string
}

const FORUMS: readonly ForumFixture[] = [
    {
        lage: 'offen',
        h: BUZZ_ROOM_FORUM,
        name: 'E2E-Forum',
        topicTitle: 'E2E-Forum-Thema: Wie kommt das Bier in die Flasche?',
        topicPreview: 'Zweite Zeile des Themas — sie gehoert in die Vorschau, nicht in den Titel.',
        reply45003: 'E2E-Forum-Antwort: Mit Druck und Geduld.',
        replyKind9: 'E2E-Forum-Chatantwort: und mit Kohlensaeure.',
    },
    {
        lage: 'privat',
        h: BUZZ_ROOM_FORUM_PRIVATE,
        name: 'E2E-Forum-Privat',
        topicTitle: 'E2E-Privatforum-Thema: Wer darf hier eigentlich mitlesen?',
        topicPreview: 'Zweite Zeile des Privatthemas — Vorschau, nicht Titel.',
        reply45003: 'E2E-Privatforum-Antwort: Nur wer eingeladen wurde.',
        replyKind9: 'E2E-Privatforum-Chatantwort: und der Owner.',
    },
]

/** Die id des geseedeten Themas — aus dem Relay gelesen, nicht geraten. */
const seededRootId = (forum: ForumFixture): string => {
    const marker = forum.topicTitle.split(':')[0]
    const line = query(['-k', '45001', '-t', `h=${forum.h}`, '-l', '20'])
        .split('\n')
        .find((row) => row.includes(marker))
    expect(line, `der Seed hat kein 45001 im ${forum.lage}en Forum-Kanal hinterlassen`).toBeTruthy()

    return JSON.parse(line as string).id as string
}

/**
 * Die Rail-Sprungliste (Alt+↑/↓) aus dem Alpine-Zustand.
 *
 * Sie steht nicht im Markup und ist trotzdem die Zusage „jede sichtbare Zeile
 * ist anspringbar" — dieselbe Auskunft, die `buzz-rail-forge.spec.ts` liest.
 */
type RailRoomish = { h: string }
type RailProbe = {
    /** Sprungziele der WORKSPACE-Gruppe, in Markup-Reihenfolge (`groupTargets`). */
    tree: string[]
    /** `h` der Kanäle, die in dieser Gruppe FLACH stehen (Pin, Sektion, beigetreten, entdeckbar). */
    flat: string[]
    /** `h` der Kanäle, die der Baum beansprucht und die deshalb aus der flachen Liste fallen. */
    claimed: string[]
}

/**
 * Der Zustand der Workspace-Gruppe, drei Auskünfte auf einmal.
 *
 * **Warum nicht `targets` der ganzen Rail:** In dieser Testumgebung IST der
 * Workspace derselbe Relay wie der Space (`useBuzz` + `__nostrWorkspace`), jeder
 * Kanal steht also zwangsläufig zweimal in der Rail — einmal unter RÄUME, einmal
 * unter WORKSPACE. Ein „genau einmal" über die ganze Spalte misst diese
 * Harness-Eigenheit und nicht die Regel. Die Regel gilt INNERHALB der
 * Workspace-Gruppe: Baum ODER flach, nie beides.
 */
const railProbe = (page: Page): Promise<RailProbe> =>
    page.evaluate(() => {
        type Group = {
            pinned: RailRoomish[]
            joined: RailRoomish[]
            others: RailRoomish[]
            claimed: RailRoomish[]
            sections: { rooms: RailRoomish[] }[]
        }
        type State = {
            groupFor: (key: string) => Group
            forgeRows: { id: string; room: { h: string } | null }[]
            targets: { id: string }[]
        }
        const el = document.querySelector('[data-rail]') as (HTMLElement & { _x_dataStack?: State[] }) | null
        const state = el?._x_dataStack?.[0]
        if (!state) {
            return { tree: [], flat: [], claimed: [] }
        }
        const group = state.groupFor('workspace')

        return {
            tree: state.forgeRows.map((node) => (node.room ? `room:${node.room.h}` : node.id)),
            flat: [
                ...group.pinned,
                ...group.sections.flatMap((section) => section.rooms),
                ...group.joined,
                ...group.others,
            ].map((room) => room.h),
            claimed: group.claimed.map((room) => room.h),
        }
    })

const rail = (page: Page) => page.locator('[data-rail]')
const workspacePanel = (page: Page) => rail(page).locator('#rail-group-workspace')
const groupToggle = (page: Page, key: string) => rail(page).locator(`[aria-controls="rail-group-${key}"]`)

/** Einen Klappzustand HERSTELLEN, nicht schalten (Begründung in `buzz-rail-forge.spec.ts`). */
async function setExpanded(toggle: Locator, open: boolean): Promise<void> {
    await expect(toggle).toBeVisible({ timeout: 30_000 })
    if ((await toggle.getAttribute('aria-expanded')) !== String(open)) {
        await toggle.click()
    }
    await expect(toggle).toHaveAttribute('aria-expanded', String(open))
}

const topicButton = (page: Page, forum: ForumFixture) =>
    page.getByRole('button', { name: new RegExp(`Thema ${forum.topicTitle.slice(0, 20)}`) })
const joinButton = (page: Page) => page.getByRole('button', { name: 'Beitreten' })
const composer = (page: Page) => page.getByPlaceholder('Nachricht schreiben…')
const gate = (page: Page) => page.getByTestId('room-gate-restricted')

/** Forum-Raum öffnen und auf die Themenliste warten. */
async function openForum(page: Page, forum: ForumFixture): Promise<void> {
    await useBuzz(page)
    await loginNsec(page, BUZZ_USER_NSEC)
    await page.goto(`/rooms/${forum.h}`)
    await expect(topicButton(page, forum), 'die Themenliste des Forums').toBeVisible({ timeout: 30_000 })
}

/** Rail auf Desktop-Breite, Workspace offen — für die beiden Rail-Fälle. */
async function openRail(page: Page, nsec: string): Promise<void> {
    await page.setViewportSize({ width: 1440, height: 900 })
    await useBuzz(page)
    await page.addInitScript((url) => {
        ;(window as unknown as { __nostrWorkspace: string }).__nostrWorkspace = url
    }, BUZZ_URL)
    await loginNsec(page, nsec)
    await expect(rail(page)).toBeVisible({ timeout: 20_000 })
    await setExpanded(groupToggle(page, 'workspace'), true)
}

test.describe('Buzz-Workspace: der Forum-Modus (E2E, nur E2E_RELAY=buzz)', () => {
    test.skip(process.env.E2E_RELAY !== 'buzz', 'nur im Buzz-Modus (E2E_RELAY=buzz) relevant')

    for (const forum of FORUMS) {
        test.describe(`Forum ${forum.lage}`, () => {
            test(`ein Forum-Kanal (${forum.lage}) zeigt die Themenliste statt des Chat-Verlaufs`, async ({ page }) => {
                await openForum(page, forum)

                // Titel ist die ERSTE Zeile, Vorschau der Rest — ein 45001 trägt keinen
                // Titel, die Trennung ist eine Anzeige-Entscheidung (`forumModels.ts`).
                await expect(page.getByText(forum.topicTitle, { exact: true })).toBeVisible()
                await expect(page.getByText(forum.topicPreview, { exact: true })).toBeVisible()

                // Der Zähler ist GERECHNET (der Relay liefert für Forum-Wurzeln kein 39005):
                // 45003 + kind 9 = zwei.
                await expect(topicButton(page, forum)).toContainText('2 Antworten')

                // Der Verlauf ist weg — und zwar wirklich, nicht nur leer: der
                // Chat-Container trägt sein `aria-label`, auch wenn keine Nachricht drin
                // steht. Ein `toHaveCount(0)` auf die Zeilen wäre grün, bevor der Feed da ist.
                await expect(page.getByRole('log', { name: 'Chat-Verlauf' })).toBeHidden()
            })

            test(`im Forum (${forum.lage}) steht kein Themen-Composer, sondern der Satz, der gilt`, async ({ page }) => {
                await openForum(page, forum)

                // Beitreten, damit die Composer-Zone überhaupt ihren Mitglieder-Zustand
                // zeigt — ohne Mitgliedschaft stünde dort der Beitreten-Knopf und der Fall
                // prüfte den falschen Zweig. Im PRIVATEN Forum steht der Knopf nie: der
                // Testnutzer ist dort per 9000 schon Kanalmitglied, und ein Selbstbeitritt
                // wäre dort ohnehin nicht möglich (`channel is private`).
                if (await joinButton(page).isVisible()) {
                    await joinButton(page).click()
                }
                await expect(
                    page.getByText('Neue Themen werden hier noch nicht verfasst — Antworten in einem Thema schon.'),
                ).toBeVisible({ timeout: 30_000 })

                // Ein kind-9-Composer im Forum schriebe eine Wurzel, die weder wir noch
                // Buzz Desktop je auflisten (beide listen 45001) — er darf nicht da sein.
                await expect(composer(page)).toBeHidden()
            })

            test(`der Thread eines Themas (${forum.lage}) trägt BEIDE Antwortformen — 45003 und kind 9`, async ({ page }) => {
                await openForum(page, forum)
                await topicButton(page, forum).click()

                const thread = page.getByRole('dialog', { name: 'Thread' })
                await expect(thread).toBeVisible({ timeout: 30_000 })
                await expect(thread.getByText(forum.reply45003)).toBeVisible({ timeout: 30_000 })
                await expect(thread.getByText(forum.replyKind9)).toBeVisible({ timeout: 30_000 })

                // Die Wurzel steht als Zitat-Anker über den Antworten — ein 45001 wird per
                // id aufgelöst, nicht über den Raumfilter (der kennt den Kind nicht).
                await expect(thread.getByText(forum.topicTitle, { exact: false })).toBeVisible()
            })

            /**
             * **Die Live-Zusage — und zugleich die Messung des bekannten Risses.**
             *
             * `deriveRoomChat`/`deriveThread` rechnen bei Ereignissen, die außerhalb ihres
             * Filters nachgeladen werden, NICHT neu (Projektgedächtnis:
             * `derive-feed-recompute-luecke`). Die Themenliste hängt deshalb an EINEM
             * Filter, der Wurzeln UND Antworten trägt. Dieser Fall ist der Beweis: eine
             * Antwort, die nach dem Rendern eintrifft, muss den Zähler bewegen, ohne dass
             * jemand neu lädt.
             *
             * **Im privaten Forum ist das der teuerste Fall der Datei.** In P9 wurde
             * gemessen, dass in einem privaten Raum aktives NACHLADEN nach einem
             * Mitgliedschaftswechsel nichts liefert. Hier wechselt nichts, aber der
             * Unterschied wäre unsichtbar, wenn die Liste stumm leer bliebe — dieser Fall
             * verlangt vom privaten Kanal dieselbe Live-Bewegung wie vom offenen.
             *
             * **Aufräumen ist Pflicht, nicht Kür.** Ohne den 9005 am Ende trüge das Thema
             * beim nächsten Lauf drei Antworten und der erste Fall dieser Datei wäre rot —
             * genau der Fehler, den P4 für die Schreib-Spec dokumentiert hat. Der 9005
             * (NIP-29) ist dabei der WIRKSAME Weg: ein kind 5 auf dieselbe id wird vom
             * Relay mit `success` quittiert und lässt das 45003 stehen (gemessen).
             */
            test(`eine neue Antwort (${forum.lage}) zieht den Zähler nach — ohne Reload`, async ({ page }) => {
                const rootId = seededRootId(forum)
                const marke = `E2E-Forum-Live-${Date.now()}`
                let liveId = ''

                await openForum(page, forum)
                await expect(topicButton(page, forum)).toContainText('2 Antworten')

                const out = publish(BUZZ_OWNER_SEC_HEX, [
                    '-k', '45003',
                    '-t', `h=${forum.h}`,
                    '-t', `e=${rootId};;reply`,
                    '-c', marke,
                ])
                expect(out, 'die Live-Antwort konnte nicht publiziert werden').toContain('success')
                liveId = (JSON.parse(out.split('\n').find((row) => row.startsWith('{')) as string) as { id: string }).id

                try {
                    await expect(topicButton(page, forum), 'der Zähler zieht ohne Reload nach').toContainText(
                        '3 Antworten',
                        { timeout: 30_000 },
                    )
                } finally {
                    expect(
                        publish(BUZZ_OWNER_SEC_HEX, ['-k', '9005', '-t', `h=${forum.h}`, '-t', `e=${liveId}`]),
                        'die Live-Antwort konnte nicht abgeräumt werden — der nächste Lauf misst sonst 3 statt 2',
                    ).toContain('success')
                }
            })

            /**
             * **Nach dem Hintergrund-Gang lebt die Live-Sub weiter.**
             *
             * Der Vordergrund-Resync bricht den Controller der Insel ab und baut alle
             * Live-Subs neu auf. Die des Forums hängt an genau diesem Controller — fehlt
             * sie in `resync()`, fröre die Themenliste nach dem ersten Hintergrund-Gang
             * auf ihrem Stand ein, ohne dass etwas nach Fehler aussähe (welshman sendet ein
             * REQ nach einem Abriss nicht von selbst neu).
             *
             * **Warum die Antwort NACH dem Vordergrund kommt:** der Resync lädt den Bestand
             * ohnehin einmal nach. Käme sie vorher, wäre der Fall auch ohne die Live-Sub
             * grün — er misst dann den Nachlade-Weg statt des Abos.
             */
            test(`nach Hintergrund und Rückkehr (${forum.lage}) zieht die Liste weiterhin live nach`, async ({ page }) => {
                const rootId = seededRootId(forum)
                await openForum(page, forum)
                await expect(topicButton(page, forum)).toContainText('2 Antworten')

                await page.evaluate(() => {
                    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
                    document.dispatchEvent(new Event('visibilitychange'))
                })
                await page.waitForTimeout(2_500)
                await page.evaluate(() => {
                    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
                    document.dispatchEvent(new Event('visibilitychange'))
                })
                // Der Resync muss durch sein, bevor die Antwort kommt — sonst fängt sein
                // Nachladen sie ein und der Fall misst den falschen Weg.
                await page.waitForTimeout(2_000)
                await expect(topicButton(page, forum), 'die Liste steht nach dem Resync unverändert').toContainText(
                    '2 Antworten',
                )

                const out = publish(BUZZ_OWNER_SEC_HEX, [
                    '-k', '45003',
                    '-t', `h=${forum.h}`,
                    '-t', `e=${rootId};;reply`,
                    '-c', `E2E-Forum-Resync-${Date.now()}`,
                ])
                expect(out).toContain('success')
                const liveId = (JSON.parse(out.split('\n').find((row) => row.startsWith('{')) as string) as { id: string }).id

                try {
                    await expect(topicButton(page, forum), 'die Live-Sub überlebt den Resync').toContainText(
                        '3 Antworten',
                        { timeout: 30_000 },
                    )
                } finally {
                    expect(publish(BUZZ_OWNER_SEC_HEX, ['-k', '9005', '-t', `h=${forum.h}`, '-t', `e=${liveId}`]))
                        .toContain('success')
                }
            })
        })
    }

    test('der Forum-Kanal steht in der Rail GENAU EINMAL und ist anspringbar', async ({ page }) => {
        await openRail(page, BUZZ_USER_NSEC)

        // Die Zeile trägt den Forum-Satz, nicht den blanken Namen: für die
        // Sprachausgabe ist „E2E-Forum" ein Name wie jeder andere.
        const forumRow = workspacePanel(page).getByRole('button', { name: 'Forum E2E-Forum öffnen' })
        await expect(forumRow).toBeVisible({ timeout: 30_000 })

        // POSITIVKONTROLLE zuerst: ohne sie wäre „steht genau einmal da" auch dann
        // grün, wenn die Raumliste noch gar nicht eingetroffen ist.
        //
        // **Gezählt wird über BEIDE Lagen** — flach UND vom Baum beansprucht. Hier
        // stand bis N7 nur `flat`, mit der Begründung, `general` sei an kein Repo
        // gebunden. Das gilt isoliert und ist im SAMMELLAUF falsch: `buzz-forge`
        // legt zwei 30617 mit `buzz-channel=<general>` an (`:153`/`:207`), damit
        // beansprucht ihn der Baum und er fällt aus der flachen Liste. Der Fall war
        // isoliert grün und im Sammellauf rot — eine Kopplung über den geteilten
        // Seed, kein Produktbefund.
        //
        // **Die Summe ist trotzdem eine echte Zusage**, weil `flat` und `claimed`
        // einander per Konstruktion ausschließen (`railGroups.ts`, `const claimed` /
        // `afterClaimed` in `buildGroups` — nimmt die beanspruchten Kanäle aus der
        // flachen Liste). Sie ist
        //   0 → die Raumliste ist noch nicht da (genau der Fall, den die Kontrolle
        //       abfangen soll — die Zusagen darunter wären dann vakuum-grün),
        //   2 → die Einmaligkeits-Regel ist gebrochen (ein Kanal steht im Baum UND
        //       flach),
        //   1 → in beiden Lagen, und nur dann.
        // Ein Kanal, den kein Repo beansprucht, wäre der einfachere Weg gewesen —
        // im Sammellauf gibt es keinen: `general` gehört `e2e-forge`, `welcome`
        // gehört `e2e-railwerk`, und beide Foren beansprucht die Forum-Gruppe.
        await expect
            .poll(
                async () => {
                    const rail = await railProbe(page)

                    return rail.flat.filter((h) => h === BUZZ_ROOM_GENERAL).length
                        + rail.claimed.filter((h) => h === BUZZ_ROOM_GENERAL).length
                },
                { timeout: 30_000 },
            )
            .toBe(1)

        const probe = await railProbe(page)
        expect(probe.tree.filter((id) => id === `room:${BUZZ_ROOM_FORUM}`), 'Forum genau einmal im Baum')
            .toHaveLength(1)
        // Die Einmaligkeits-Regel: was im Baum steht, steht NICHT zusätzlich flach.
        expect(probe.flat, 'der Forum-Kanal darf nicht zusätzlich flach stehen').not.toContain(BUZZ_ROOM_FORUM)
        expect(probe.claimed, 'der Baum beansprucht den Kanal').toContain(BUZZ_ROOM_FORUM)

        // Und die Zeile trägt eine Knoten-id — die flache Liste rendert ohne.
        await expect(workspacePanel(page).locator(`[data-node-id="room:${BUZZ_ROOM_FORUM}"]`)).toHaveCount(1)
    })

    /**
     * **Dasselbe für das PRIVATE Forum — mit einer eigenen Positivkontrolle.**
     *
     * Der Fall darüber zählt `general` über beide Lagen (flach + beansprucht); das
     * ist seit N7 von den Forge-Fixtures unabhängig, war es aber nicht immer. Ein
     * zweiter Fall mit derselben Kontrolle brächte trotzdem nichts Zusätzliches.
     *
     * Hier ist die Kontrolle deshalb **selbsttragend**: die `toHaveLength(1)`-Zusage
     * auf den Baum ist von 0 nicht erfüllbar, sie schließt den „noch nichts da"-Fall
     * also selbst aus. Erst danach ist „steht nicht zusätzlich flach" eine Aussage.
     * Kein Repo bindet ein Forum per `buzz-channel`, die Kontrolle ist damit von
     * den Forge-Fixtures unabhängig.
     */
    test('das PRIVATE Forum steht dem Mitglied in der Rail — genau einmal', async ({ page }) => {
        await openRail(page, BUZZ_USER_NSEC)

        const forumRow = workspacePanel(page).getByRole('button', { name: 'Forum E2E-Forum-Privat öffnen' })
        await expect(forumRow).toBeVisible({ timeout: 30_000 })

        await expect
            .poll(async () => (await railProbe(page)).tree.filter((id) => id === `room:${BUZZ_ROOM_FORUM_PRIVATE}`).length, {
                timeout: 30_000,
            })
            .toBe(1)

        const probe = await railProbe(page)
        expect(probe.flat, 'das private Forum darf nicht zusätzlich flach stehen')
            .not.toContain(BUZZ_ROOM_FORUM_PRIVATE)
        expect(probe.claimed, 'der Baum beansprucht auch den privaten Kanal').toContain(BUZZ_ROOM_FORUM_PRIVATE)
        await expect(workspacePanel(page).locator(`[data-node-id="room:${BUZZ_ROOM_FORUM_PRIVATE}"]`)).toHaveCount(1)

        // Und beide Foren stehen nebeneinander — ab dem zweiten Forum fasst
        // `railForge.ts` sie in eine Gruppe. Der offene darf dabei nicht verloren
        // gehen (sonst wäre der Fall darüber grün und dieser hier zugleich, und
        // trotzdem sähe der Nutzer nur eines von beiden).
        expect(probe.tree.filter((id) => id === `room:${BUZZ_ROOM_FORUM}`), 'auch das offene Forum steht noch im Baum')
            .toHaveLength(1)
    })

    /**
     * **Die andere Richtung: ein Nichtmitglied sieht das private Forum NICHT.**
     *
     * Der Schlüssel ist Relay-Mitglied — er darf sich anmelden, er sieht die Rail,
     * er sieht die offenen Kanäle. Er ist nur kein KANAL-Mitglied des privaten
     * Forums. Genau diese Trennung ist die Zusage; ein Schlüssel ohne
     * Relay-Zugang würde an einer ganz anderen Hürde scheitern und nichts über den
     * Kanal beweisen.
     *
     * Am Relay gemessen (2026-08-18): die 39000-Liste dieses Schlüssels enthält
     * **drei** Kanäle (welcome, general, offenes Forum) — das private fehlt
     * lautlos, ohne CLOSED. Ein `#h`-REQ auf den privaten Kanal endet dagegen mit
     * `CLOSED restricted: not a channel member`.
     *
     * **Die Positivkontrolle ist hier das halbe Ergebnis:** „das private Forum ist
     * nicht in der Rail" ist auch dann wahr, wenn die Rail noch leer ist. Deshalb
     * muss das OFFENE Forum zuerst dastehen.
     */
    test('ein Nichtmitglied sieht das private Forum weder in der Rail noch über die direkte URL', async ({ page }) => {
        const { nsec } = freshRelayMember()
        await openRail(page, nsec)

        // Positivkontrolle: der offene Forum-Kanal IST für diesen Schlüssel da.
        // Erst damit ist die Abwesenheit des privaten eine Aussage.
        await expect(
            workspacePanel(page).getByRole('button', { name: 'Forum E2E-Forum öffnen' }),
            'ohne den offenen Kanal misst die Probe nur eine leere Rail',
        ).toBeVisible({ timeout: 30_000 })

        await expect(
            workspacePanel(page).getByRole('button', { name: 'Forum E2E-Forum-Privat öffnen' }),
            'das private Forum gehört nicht in die Rail eines Nichtmitglieds',
        ).toHaveCount(0)
        const probe = await railProbe(page)
        expect(probe.tree, 'auch nicht im Baum').not.toContain(`room:${BUZZ_ROOM_FORUM_PRIVATE}`)
        expect(probe.flat, 'auch nicht flach').not.toContain(BUZZ_ROOM_FORUM_PRIVATE)

        // Und der direkte Weg, an der Rail vorbei.
        await page.goto(`/rooms/${BUZZ_ROOM_FORUM_PRIVATE}`)
        await expect(gate(page), 'die direkte URL gehört hinter das Gate').toBeVisible({ timeout: 30_000 })

        // Die eigentliche Zusage: kein Inhalt. Weder Thema noch Antwort, weder als
        // Themenliste noch als Chat-Zeile — und kein Eingabefeld, dessen Absenden
        // am Relay scheitern würde.
        const privat = FORUMS[1]
        await expect(page.getByText(privat.topicTitle, { exact: false })).toHaveCount(0)
        await expect(page.getByText(privat.reply45003, { exact: false })).toHaveCount(0)
        await expect(page.getByText(privat.replyKind9, { exact: false })).toHaveCount(0)
        await expect(composer(page)).toBeHidden()
        // Ein Beitreten-Knopf führte hier ins Leere: der Relay lehnt den
        // Selbstbeitritt (9021) in einen privaten Kanal mit `channel is private` ab.
        await expect(joinButton(page), 'ein Beitreten-Knopf führte von hier ins Leere').toHaveCount(0)
    })
})
