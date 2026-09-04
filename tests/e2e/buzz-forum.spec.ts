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
import { measure } from './support/contrast'

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
    // ` öffnen` ist Pflicht im Muster seit P3 (buzz-kind-ernte): die neuen
    // Bewertungspfeile tragen ebenfalls `aria-label="Thema <title> befürworten/
    // ablehnen"`, ohne das Suffix träfe dieser Locator drei Knöpfe statt einem
    // (Strict-Mode-Verstoß, Fehler des Specs — die Fläche hat sich absichtlich
    // geändert, der Selektor zog nicht mit).
    page.getByRole('button', { name: new RegExp(`Thema ${forum.topicTitle.slice(0, 20)}.*öffnen`) })
const joinButton = (page: Page) => page.getByRole('button', { name: 'Beitreten' })
const composer = (page: Page) => page.getByPlaceholder('Nachricht schreiben…')

/**
 * Der Auslöser einer der beiden Themen-Bauformen.
 *
 * Über `data-`-Haken und nicht über die Beschriftung: die zwei Formen heißen
 * bewusst verschieden („Neues Thema" in der Leiste, „Neues Thema verfassen …" am
 * Listenkopf), und `getByRole({name})` matcht als TEILZEICHENKETTE — „Neues
 * Thema" träfe beide. Ein Fall, der die AUSSCHLIESSLICHKEIT der zwei Formen
 * misst, darf sich auf so etwas nicht stützen.
 */
const trigger = (page: Page, form: 'kopf' | 'leiste') => page.locator(`[data-forum-topic-trigger="${form}"]`)
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

            /**
             * **Der Weg zum neuen Thema steht — in GENAU EINER Bauform.**
             *
             * Hier stand bis zum 2026-08-27 die Zusage „es gibt keinen Themen-Composer,
             * sondern den Satz, der gilt" (`Neue Themen werden hier noch nicht verfasst
             * — Antworten in einem Thema schon.`). Der Satz ist ersatzlos gefallen, weil
             * seine Aussage nicht mehr stimmt.
             *
             * Was an seine Stelle tritt, ist keine Umformulierung, sondern eine härtere
             * Zusage: es gibt ZWEI Bauformen (Knopf am Listenkopf am Desktop, Knopf in
             * der unteren Leiste auf dem Telefon), und es steht immer nur EINE davon.
             * Die Ausschließlichkeit ist das eigentliche Produktversprechen — zwei
             * sichtbare Auslöser für dieselbe Handlung wären schlimmer als ein schlecht
             * platzierter. Sie ist in `js/forumWriteModels.ts` als EINE Funktion mit
             * EINEM Rückgabewert gebaut (`topicComposerZiel`) und hier am DOM gemessen.
             *
             * **Der Buzz-Arm fährt auf 1279 px** — einen Pixel unter `xl`, also im
             * Mobil-Chassis. Die Desktop-Hälfte setzt ihren Viewport deshalb selbst,
             * wie die Rail-Fälle weiter unten.
             */
            test(`im Forum (${forum.lage}) steht GENAU EINE Bauform für ein neues Thema`, async ({ page }) => {
                await openForum(page, forum)

                // Beitreten, damit die Composer-Zone überhaupt ihren Mitglieder-Zustand
                // zeigt — ohne Mitgliedschaft stünde dort der Beitreten-Knopf und der Fall
                // prüfte den falschen Zweig. Im PRIVATEN Forum steht der Knopf nie: der
                // Testnutzer ist dort per 9000 schon Kanalmitglied, und ein Selbstbeitritt
                // wäre dort ohnehin nicht möglich (`channel is private`).
                if (await joinButton(page).isVisible()) {
                    await joinButton(page).click()
                }

                // Mobil-Chassis (Projektvorgabe 1279 px): die untere Leiste, sonst nichts.
                await expect(trigger(page, 'leiste'), 'der Auslöser der unteren Leiste')
                    .toBeVisible({ timeout: 30_000 })
                await expect(trigger(page, 'kopf'), 'der Listenkopf-Auslöser gehört NICHT ins Mobil-Chassis')
                    .toHaveCount(0)

                // Desktop-Chassis: genau umgekehrt. `setViewportSize` sticht die
                // Projektvorgabe; `topicComposerZiel` liest die Breite reaktiv aus dem
                // `$store.viewport`, der an derselben Media-Query hängt wie die Rail.
                await page.setViewportSize({ width: 1440, height: 900 })
                await expect(trigger(page, 'kopf'), 'der Listenkopf-Auslöser am Desktop')
                    .toBeVisible({ timeout: 30_000 })
                await expect(trigger(page, 'leiste'), 'die untere Leiste gehört NICHT ins Desktop-Chassis')
                    .toHaveCount(0)

                // Und der Chat-Composer bleibt in BEIDEN Chassis weg: er schriebe eine
                // kind-9-Wurzel, und die listet weder unsere Fläche noch Buzz Desktop
                // je als Thema (beide listen 45001).
                await expect(composer(page)).toBeHidden()
            })

            /**
             * ══ DIE ZUSAGE DES AUFTRAGS ═══════════════════════════════════════════
             * Ein Thema anlegen, es in der Liste wiederfinden — und danach BELEGEN,
             * dass am Relay wirklich ein `45001` mit `["h",<uuid>]` und **keinem
             * Titel-Tag** liegt.
             *
             * Der Fall ist bewusst dreistufig, weil jede Stufe etwas anderes misst:
             *
             *   1. **Sofort sichtbar.** `publishThunk` legt das Ereignis synchron in
             *      den `repository` — die Zeile steht, bevor der Relay geantwortet hat.
             *      Das allein beweist NICHTS über den Relay; es beweist nur, dass der
             *      optimistische Weg funktioniert.
             *   2. **Nach dem Neuladen noch da.** Erst hier ist bewiesen, dass das
             *      Ereignis den Relay erreicht hat und aus ihm zurückkommt. Ohne diese
             *      Stufe wäre der Fall auch dann grün, wenn `publish` still scheitert.
             *   3. **Die richtige FORM.** `nak` liest das Ereignis zurück und der Fall
             *      vergleicht die Tags gegen `build_forum_post`
             *      (`crates/buzz-sdk/src/builders.rs:284`): genau ein `h`, sonst nichts.
             *      Ein Thema mit einem erfundenen `subject`-Tag käme durch Stufe 1 und
             *      2 und wäre in Buzz Desktop trotzdem titellos.
             *
             * **Der Fall sät selbst und räumt selbst auf.** Er hängt an keiner Fixture
             * des Seeds: der Marker trägt `Date.now()`, ist also je Lauf eindeutig, und
             * am Ende räumt ein `kind 9005` (NIP-29, Owner-Schlüssel) ihn wieder ab —
             * derselbe Weg, den die Live-Fälle darunter schon benutzen. Ohne das
             * Aufräumen wüchse die Themenliste mit jedem Lauf, und der Zähler-Fall
             * dieser Datei misst dann gegen einen Zustand, den niemand hergestellt hat.
             *
             * `nak` läuft überall mit `--auth`: ohne AUTH quittiert der Relay ein
             * Lösch-Event mit `auth-required` statt `success` und räumt nichts ab.
             */
            test(`ein Thema anlegen (${forum.lage}) — es steht in der Liste und trägt am Relay die Buzz-Form`, async ({ page }) => {
                const marke = `E2E-Neues-Thema-${Date.now()}`
                const rumpf = `${marke}\nZweite Zeile — sie gehoert in die Vorschau, nicht in den Titel.`
                let neueId = ''

                await openForum(page, forum)
                if (await joinButton(page).isVisible()) {
                    await joinButton(page).click()
                }

                try {
                    await trigger(page, 'leiste').click()

                    // Das Blatt ist ein echter Dialog — `role`/`aria-modal` stehen im
                    // Markup, nicht erst nach dem Öffnen per JS.
                    const blatt = page.getByRole('dialog', { name: 'Neues Thema' })
                    await expect(blatt).toBeVisible({ timeout: 15_000 })

                    // EIN Feld. Kein Titelfeld — es gibt kein Titel-Tag, und ein Feld,
                    // dessen Inhalt in Buzz Desktop niemand sieht, wäre gelogen.
                    await expect(blatt.getByLabel('Thema')).toBeVisible()
                    await expect(blatt.getByLabel('Titel'), 'ein 45001 trägt keinen Titel — also gibt es kein Titelfeld')
                        .toHaveCount(0)

                    await blatt.getByLabel('Thema').fill(rumpf)

                    // Die Fläche sagt dem Verfasser, was aus der ersten Zeile wird —
                    // gerechnet mit DERSELBEN Funktion, aus der die Liste ihren Titel
                    // baut (`forumTopicTitle`). Das ist die ehrliche Abbildung dessen,
                    // was das Ereignis wirklich trägt.
                    await expect(page.locator('[data-forum-topic-titelvorschau]')).toContainText(marke)

                    await blatt.getByRole('button', { name: 'Thema anlegen' }).click()

                    // Stufe 1 — optimistisch. Das Blatt schließt, die Zeile steht.
                    await expect(blatt).toBeHidden({ timeout: 30_000 })
                    const zeile = page.getByRole('button', { name: new RegExp(`Thema ${marke}.*öffnen`) })
                    await expect(zeile, 'die neue Zeile steht sofort (optimistisch)').toBeVisible({ timeout: 30_000 })

                    // Kein Fehlerkasten: der Ausgang ist sichtbar und er ist Erfolg.
                    // (Der andere sichtbare Ausgang — Ablehnung oder ausbleibendes `OK`
                    // beim Ratenbegrenzer — steht in `[data-forum-topic-error]`.)
                    await expect(page.locator('[data-forum-topic-error]')).toHaveCount(0)

                    // Stufe 2 — nach dem Neuladen. Jetzt kommt die Zeile aus dem RELAY.
                    await page.reload()
                    await expect(zeile, 'nach dem Neuladen kommt das Thema aus dem Relay').toBeVisible({ timeout: 30_000 })
                    // Titel = erste Zeile, Vorschau = Rest. Dieselbe Anzeige-Regel wie
                    // beim geseedeten Thema, jetzt an einem selbst verfassten belegt.
                    await expect(
                        page.getByText('Zweite Zeile — sie gehoert in die Vorschau, nicht in den Titel.', { exact: true }),
                    ).toBeVisible()

                    // Stufe 3 — die FORM am Relay, gegen Buzz' eigenen Builder.
                    const roh = query(['-k', '45001', '-t', `h=${forum.h}`, '-l', '30'])
                        .split('\n')
                        .find((row) => row.includes(marke))
                    expect(roh, 'das Thema liegt nicht am Relay').toBeTruthy()
                    const ereignis = JSON.parse(roh as string) as {
                        id: string
                        kind: number
                        content: string
                        tags: string[][]
                    }
                    neueId = ereignis.id

                    expect(ereignis.kind, 'ein Thema ist ein 45001 (KIND_FORUM_POST, buzz-core/src/kind.rs:550)').toBe(45001)
                    // `build_forum_post` baut `["h", uuid]` und danach NUR `p` (Erwähnungen)
                    // und `imeta` (Anhänge). Dieser Entwurf hat weder das eine noch das
                    // andere — es darf also genau ein Tag dastehen.
                    expect(ereignis.tags, 'Tags eines 45001 ohne Erwähnung/Anhang: nur `h`').toEqual([['h', forum.h]])
                    // Und der Inhalt ist der GETRIMMTE Rumpf, wie in Buzz Desktop
                    // (`commands/messages.rs:515`, `content.trim()`).
                    expect(ereignis.content).toBe(rumpf)
                } finally {
                    if (neueId) {
                        expect(
                            publish(BUZZ_OWNER_SEC_HEX, ['-k', '9005', '-t', `h=${forum.h}`, '-t', `e=${neueId}`]),
                            'das selbst angelegte Thema konnte nicht abgeräumt werden — die Liste wüchse mit jedem Lauf',
                        ).toContain('success')
                        // Und nachsehen, dass es wirklich weg ist: ein `OK true` ist bei
                        // Buzz kein Wirkungsnachweis (auf dem `a`-Weg quittiert der Relay
                        // sogar Löschungen nie existierender Ziele mit `success`).
                        expect(
                            query(['-k', '45001', '-t', `h=${forum.h}`, '-l', '30']).includes(marke),
                            'das Thema steht nach dem Aufräumen noch am Relay',
                        ).toBe(false)
                    }
                }
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
             * **Der Riegel, den der RELAY nicht stellt.**
             *
             * `crates/buzz-relay/src/handlers/ingest.rs` kennt für ein 45001 **kein**
             * `content.is_empty()`-Gate — ein Thema ohne jeden Text nähme der Relay an,
             * und es stünde danach als titellose Zeile in jeder Forum-Liste, unserer
             * wie der von Buzz Desktop. Der Riegel muss im Client stehen, und bei Buzz
             * steht er ebenfalls dort (`ForumComposer.tsx:221`, `contentRef.current.trim()`).
             *
             * Gemessen wird `disabled`, nicht ein Klick: `flux:button` rendert ein
             * echtes `disabled`-Attribut (kein `aria-disabled`), ein `click()` liefe
             * sonst in einen 30-s-Timeout und der Fall stünde als „flaky" da.
             */
            test(`ein Thema ohne Text laesst sich nicht abschicken (${forum.lage})`, async ({ page }) => {
                await openForum(page, forum)
                if (await joinButton(page).isVisible()) {
                    await joinButton(page).click()
                }
                await trigger(page, 'leiste').click()

                const blatt = page.getByRole('dialog', { name: 'Neues Thema' })
                await expect(blatt).toBeVisible({ timeout: 15_000 })
                const knopf = blatt.getByRole('button', { name: 'Thema anlegen' })
                await expect(knopf, 'ein leerer Entwurf ist kein Thema').toBeDisabled()

                // Auch NUR Weißraum ist kein Thema — der Inhalt geht getrimmt auf den
                // Draht (`normalizeTopicContent`, wie Buzz' `content.trim()`), es bliebe
                // also wörtlich nichts übrig.
                await blatt.getByLabel('Thema').fill('   \n\t  ')
                await expect(knopf, 'nur Weißraum bleibt getrimmt nichts').toBeDisabled()

                // Und mit Text ist er bedienbar — ohne diese Gegenprobe wäre der Fall
                // auch dann grün, wenn der Knopf immer inert wäre.
                await blatt.getByLabel('Thema').fill('Ein Satz reicht.')
                await expect(knopf).toBeEnabled()
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

    /**
     * ══ KONTRAST DER NEUEN FLÄCHE — gemessen, nicht gerechnet ═══════════════════
     *
     * **Warum dieser Fall hier steht und nicht in `a11y-contrast.spec.ts`:** die
     * Kontrast-Suite fährt gegen **zooid** (`useZooid`), und auf zooid gibt es
     * keine Foren. Die neue Fläche ist dort per Konstruktion unerreichbar; ohne
     * diesen Fall wäre sie von der Kontrastmessung des Hauses schlicht nicht
     * gedeckt, ohne dass irgendwo etwas rot würde.
     *
     * **Und das ist keine theoretische Lücke.** Beim Bau stand an der
     * „Wird gesendet …"-Marke zuerst `text-brand-600`: #e87706 auf der weissen
     * `surface-card` hält **2,97:1**, WCAG 1.4.3 verlangt 4,5:1. Aufgefallen ist
     * es beim Nachrechnen von Hand, nicht durch einen Test — genau der Zustand,
     * den dieser Fall beendet. Ebenso die gestrichelte Kante des Desktop-Knopfes:
     * `border-zinc-300` hielt gegen `bg-zinc-50` **1,42:1** gegen die 3:1 aus
     * 1.4.11.
     *
     * Gemessen wird am GERENDERTEN Baum über `support/contrast.ts` — ein
     * `getComputedStyle` liefert in diesem Stylesheet `oklab(...)`, und ein
     * Zahlen-Regex darauf erfände Farben. Der Helfer ist fail-closed: ein
     * Selektor ohne Treffer erscheint als eigener Eintrag mit `ratio: 0`.
     */
    for (const theme of ['light', 'dark'] as const) {
        test(`die Fläche fürs neue Thema hält WCAG-Kontrast (${theme})`, async ({ page }) => {
            // Ein Test JE Theme und nicht eine Schleife in einem: `addInitScript`
            // greift nur auf der nächsten Navigation, und ein zweiter Login in
            // derselben Seite läuft in eine bereits angemeldete Sitzung. Zwei
            // Tests bekommen zwei frische Kontexte — das ist hier die billigere
            // Wahrheit.
            await page.addInitScript((t) => {
                try {
                    localStorage.setItem('flux.appearance', t as string)
                } catch {
                    /* kein localStorage → gemessen wird dann das Default-Theme */
                }
            }, theme)

            // Desktop-Chassis: nur dort steht der gestrichelte Streifen.
            await page.setViewportSize({ width: 1440, height: 900 })
            await useBuzz(page)
            await loginNsec(page, BUZZ_USER_NSEC)
            await page.goto(`/rooms/${BUZZ_ROOM_FORUM}`)
            await expect(page.locator('html')).toHaveClass(theme === 'dark' ? /dark/ : /^(?!.*\bdark\b).*$/, {
                timeout: 15_000,
            })
            await expect(topicButton(page, FORUMS[0])).toBeVisible({ timeout: 30_000 })
            if (await joinButton(page).isVisible()) {
                await joinButton(page).click()
            }
            await expect(trigger(page, 'kopf')).toBeVisible({ timeout: 30_000 })

            const messungen = await measure(page, [
                { selector: '[data-forum-topic-trigger="kopf"]', label: 'Neues Thema (Beschriftung)', kind: 'text' },
                {
                    selector: '[data-forum-topic-trigger="kopf"]',
                    label: 'Neues Thema (gestrichelte Kante)',
                    kind: 'graphic',
                    prop: 'borderTopColor',
                },
            ])
            const eigene = messungen.filter((m) => m.label.startsWith('Neues Thema'))

            // POSITIVKONTROLLE: ohne sie wäre „alle über der Schwelle" auch wahr,
            // wenn gar nichts gemessen wurde. `measure` meldet einen verfehlten
            // Selektor mit `ratio: 0` — beides ist damit abgedeckt.
            expect(eigene, `[${theme}] beide Stellen gemessen`).toHaveLength(2)
            for (const m of eigene) {
                expect(m.ratio, `[${theme}] ${m.label}: ${m.fg} auf ${m.bg}`).toBeGreaterThanOrEqual(m.min)
            }
            // eslint-disable-next-line no-console
            console.log(`KONTRAST-FORUM[${theme}] ` + JSON.stringify(eigene))

            // Und die „Wird gesendet …"-Marke. Sie steht nur, solange ein Thema
            // fliegt — für eine Messung ist dieser Moment zu kurz und zu wackelig.
            // Also wird der Zustand HERGESTELLT: `topicSending` bekommt die id des
            // geseedeten Themas, und die Marke rendert danach an ihrem echten Ort,
            // in ihrem echten Stil, auf ihrem echten Untergrund. Das ist kein
            // Nachbau — es ist derselbe Zweig, den ein echter Flug auslöst.
            await page.evaluate(() => {
                const el = document.querySelector('[x-data^="nostrRoomChat"]') as
                    (HTMLElement & { _x_dataStack?: { topics: { id: string }[]; topicSending: string[] }[] }) | null
                const state = el?._x_dataStack?.[0]
                if (state && state.topics.length > 0) {
                    state.topicSending = [state.topics[0].id]
                }
            })
            const markeSichtbar = page.locator('[data-forum-topic-pending]').first()
            await expect(markeSichtbar, 'der hergestellte Zustand rendert die Marke').toBeVisible({ timeout: 10_000 })

            const markeMessung = await measure(page, [
                { selector: '[data-forum-topic-pending]', label: 'Wird gesendet (Marke)', kind: 'text' },
            ])
            const marke = markeMessung.filter((m) => m.label === 'Wird gesendet (Marke)')
            expect(marke, `[${theme}] die Marke wurde gemessen`).toHaveLength(1)
            expect(marke[0].ratio, `[${theme}] ${marke[0].fg} auf ${marke[0].bg}`).toBeGreaterThanOrEqual(marke[0].min)
            // eslint-disable-next-line no-console
            console.log(`KONTRAST-FORUM-MARKE[${theme}] ` + JSON.stringify(marke))
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
        // Und KEIN Weg, ein Thema anzulegen — in keiner der beiden Bauformen. Der
        // Relay verlangt für ein 45001 `Scope::MessagesWrite` am Kanal
        // (`crates/buzz-relay/src/handlers/ingest.rs:390-392`), also
        // Kanalmitgliedschaft. Ein Auslöser hier führte garantiert in eine
        // Ablehnung; `topicComposerZiel(…, joined=false)` liefert deshalb `'keins'`.
        await expect(trigger(page, 'leiste'), 'ohne Mitgliedschaft gibt es keinen Weg zum Thema').toHaveCount(0)
        await expect(trigger(page, 'kopf'), 'auch nicht am Listenkopf').toHaveCount(0)
        // Ein Beitreten-Knopf führte hier ins Leere: der Relay lehnt den
        // Selbstbeitritt (9021) in einen privaten Kanal mit `channel is private` ab.
        await expect(joinButton(page), 'ein Beitreten-Knopf führte von hier ins Leere').toHaveCount(0)
    })
})
