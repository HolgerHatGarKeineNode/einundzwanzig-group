import { test, expect, type Locator, type Page } from './support/fixtures'
import {
    useBuzz,
    BUZZ_URL,
    BUZZ_PORT,
    BUZZ_USER_NSEC,
    BUZZ_OWNER_SEC_HEX,
    BUZZ_ROOM_FORUM,
    BUZZ_ROOM_GENERAL,
} from './support/buzz'
import { loginNsec } from './support/login'
import { spawnSync } from 'node:child_process'

/**
 * P3 — der **Forum-Modus** eines Buzz-Kanals, an der echten Fläche gegen einen
 * echten Buzz-Relay.
 *
 * ── Die gemessene Ereignisform (Teststack, 2026-08-17) ──────────────────────
 *
 *   Kanal   `39000` mit `["t","forum"]` (aus `9007` + `["channel_type","forum"]`)
 *   Thema   `45001`, Tags NUR `["h",<uuid>]` — **kein Titel-Tag**
 *   Antwort `45003` bzw. `9`, je `["h",…]` + `["e",<root>,"","reply"]`
 *
 * Der Seed legt genau das an (`buzz-testserver.sh`): ein Thema mit ZWEI
 * Antworten, eine je Form. Dass beide Formen zählen, ist keine Auslegung — Buzz
 * Desktop fragt seinen Thread mit `kinds:[9,45003]` ab.
 *
 * ── Was hier steht und was die Unit-Tests tragen ────────────────────────────
 * Titel/Vorschau/Zähler/Sortierung prüft `forumModels.test.ts`, die Nav-Regeln
 * `railForge.test.ts` — beide ohne Docker. Hier steht nur, was ohne echten
 * Roundtrip nicht prüfbar ist: dass der Kanaltyp aus dem 39000 des LEBENDEN
 * Relays die Fläche umschaltet, dass beide Antwortformen im Thread ankommen,
 * dass eine NEUE Antwort die Zeile ohne Reload nachzieht, und dass der Kanal in
 * der Rail genau einmal steht.
 *
 * ── Zwei Mechaniken wie in `buzz-rail-forge.spec.ts` ────────────────────────
 * 1. Der Dateiname MUSS `buzz-*` sein (`playwright.config.ts:57`), sonst
 *    überspringt der Buzz-Modus die Datei lautlos.
 * 2. Der Buzz-Modus fährt auf 1279 px — einen Pixel unter `xl`. Der Rail-Fall
 *    setzt seinen Viewport deshalb selbst.
 */

const NAK = process.env.NAK ?? `${process.env.HOME}/go/bin/nak`
const WS = (): string => `ws://localhost:${BUZZ_PORT}`

const TOPIC_TITLE = 'E2E-Forum-Thema: Wie kommt das Bier in die Flasche?'
const TOPIC_PREVIEW = 'Zweite Zeile des Themas — sie gehoert in die Vorschau, nicht in den Titel.'
const REPLY_45003 = 'E2E-Forum-Antwort: Mit Druck und Geduld.'
const REPLY_KIND9 = 'E2E-Forum-Chatantwort: und mit Kohlensaeure.'

const nak = (args: string[]): string => {
    const res = spawnSync(NAK, args, { encoding: 'utf8', timeout: 30_000 })

    return `${res.stdout ?? ''}\n${res.stderr ?? ''}`
}

const publish = (sec: string, args: string[]): string => nak(['event', '--auth', '--sec', sec, ...args, WS()])
const query = (args: string[]): string => nak(['req', '--auth', '--sec', BUZZ_USER_NSEC, ...args, WS()])

/** Die id des geseedeten Themas — aus dem Relay gelesen, nicht geraten. */
const seededRootId = (): string => {
    const line = query(['-k', '45001', '-t', `h=${BUZZ_ROOM_FORUM}`, '-l', '20'])
        .split('\n')
        .find((row) => row.includes('E2E-Forum-Thema'))
    expect(line, 'der Seed hat kein 45001 im Forum-Kanal hinterlassen').toBeTruthy()

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

const topicButton = (page: Page) => page.getByRole('button', { name: new RegExp(`Thema ${TOPIC_TITLE.slice(0, 20)}`) })
const joinButton = (page: Page) => page.getByRole('button', { name: 'Beitreten' })
const composer = (page: Page) => page.getByPlaceholder('Nachricht schreiben…')

/** Forum-Raum öffnen und auf die Themenliste warten. */
async function openForum(page: Page): Promise<void> {
    await useBuzz(page)
    await loginNsec(page, BUZZ_USER_NSEC)
    await page.goto(`/rooms/${BUZZ_ROOM_FORUM}`)
    await expect(topicButton(page), 'die Themenliste des Forums').toBeVisible({ timeout: 30_000 })
}

test.describe('Buzz-Workspace: der Forum-Modus (E2E, nur E2E_RELAY=buzz)', () => {
    test.skip(process.env.E2E_RELAY !== 'buzz', 'nur im Buzz-Modus (E2E_RELAY=buzz) relevant')

    test('ein Forum-Kanal zeigt die Themenliste statt des Chat-Verlaufs', async ({ page }) => {
        await openForum(page)

        // Titel ist die ERSTE Zeile, Vorschau der Rest — ein 45001 trägt keinen
        // Titel, die Trennung ist eine Anzeige-Entscheidung (`forumModels.ts`).
        await expect(page.getByText(TOPIC_TITLE, { exact: true })).toBeVisible()
        await expect(page.getByText(TOPIC_PREVIEW, { exact: true })).toBeVisible()

        // Der Zähler ist GERECHNET (der Relay liefert für Forum-Wurzeln kein 39005):
        // 45003 + kind 9 = zwei.
        await expect(topicButton(page)).toContainText('2 Antworten')

        // Der Verlauf ist weg — und zwar wirklich, nicht nur leer: der
        // Chat-Container trägt sein `aria-label`, auch wenn keine Nachricht drin
        // steht. Ein `toHaveCount(0)` auf die Zeilen wäre grün, bevor der Feed da ist.
        await expect(page.getByRole('log', { name: 'Chat-Verlauf' })).toBeHidden()
    })

    test('im Forum steht kein Themen-Composer, sondern der Satz, der gilt', async ({ page }) => {
        await openForum(page)

        // Beitreten, damit die Composer-Zone überhaupt ihren Mitglieder-Zustand
        // zeigt — ohne Mitgliedschaft stünde dort der Beitreten-Knopf und der Fall
        // prüfte den falschen Zweig.
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

    test('der Thread eines Themas trägt BEIDE Antwortformen — 45003 und kind 9', async ({ page }) => {
        await openForum(page)
        await topicButton(page).click()

        const thread = page.getByRole('dialog', { name: 'Thread' })
        await expect(thread).toBeVisible({ timeout: 30_000 })
        await expect(thread.getByText(REPLY_45003)).toBeVisible({ timeout: 30_000 })
        await expect(thread.getByText(REPLY_KIND9)).toBeVisible({ timeout: 30_000 })

        // Die Wurzel steht als Zitat-Anker über den Antworten — ein 45001 wird per
        // id aufgelöst, nicht über den Raumfilter (der kennt den Kind nicht).
        await expect(thread.getByText(TOPIC_TITLE, { exact: false })).toBeVisible()
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
     * **Aufräumen ist Pflicht, nicht Kür.** Ohne den 9005 am Ende trüge das Thema
     * beim nächsten Lauf drei Antworten und der erste Fall dieser Datei wäre rot —
     * genau der Fehler, den P4 für die Schreib-Spec dokumentiert hat. Der 9005
     * (NIP-29) ist dabei der WIRKSAME Weg: ein kind 5 auf dieselbe id wird vom
     * Relay mit `success` quittiert und lässt das 45003 stehen (gemessen).
     */
    test('eine neue Antwort zieht den Zähler nach — ohne Reload', async ({ page }) => {
        const rootId = seededRootId()
        const marke = `E2E-Forum-Live-${Date.now()}`
        let liveId = ''

        await openForum(page)
        await expect(topicButton(page)).toContainText('2 Antworten')

        const out = publish(BUZZ_OWNER_SEC_HEX, [
            '-k', '45003',
            '-t', `h=${BUZZ_ROOM_FORUM}`,
            '-t', `e=${rootId};;reply`,
            '-c', marke,
        ])
        expect(out, 'die Live-Antwort konnte nicht publiziert werden').toContain('success')
        liveId = (JSON.parse(out.split('\n').find((row) => row.startsWith('{')) as string) as { id: string }).id

        try {
            await expect(topicButton(page), 'der Zähler zieht ohne Reload nach').toContainText('3 Antworten', {
                timeout: 30_000,
            })
        } finally {
            expect(
                publish(BUZZ_OWNER_SEC_HEX, ['-k', '9005', '-t', `h=${BUZZ_ROOM_FORUM}`, '-t', `e=${liveId}`]),
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
    test('nach Hintergrund und Rückkehr zieht die Liste weiterhin live nach', async ({ page }) => {
        const rootId = seededRootId()
        await openForum(page)
        await expect(topicButton(page)).toContainText('2 Antworten')

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
        await expect(topicButton(page), 'die Liste steht nach dem Resync unverändert').toContainText('2 Antworten')

        const out = publish(BUZZ_OWNER_SEC_HEX, [
            '-k', '45003',
            '-t', `h=${BUZZ_ROOM_FORUM}`,
            '-t', `e=${rootId};;reply`,
            '-c', `E2E-Forum-Resync-${Date.now()}`,
        ])
        expect(out).toContain('success')
        const liveId = (JSON.parse(out.split('\n').find((row) => row.startsWith('{')) as string) as { id: string }).id

        try {
            await expect(topicButton(page), 'die Live-Sub überlebt den Resync').toContainText('3 Antworten', {
                timeout: 30_000,
            })
        } finally {
            expect(publish(BUZZ_OWNER_SEC_HEX, ['-k', '9005', '-t', `h=${BUZZ_ROOM_FORUM}`, '-t', `e=${liveId}`]))
                .toContain('success')
        }
    })

    test('der Forum-Kanal steht in der Rail GENAU EINMAL und ist anspringbar', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 })
        await useBuzz(page)
        await page.addInitScript((url) => {
            ;(window as unknown as { __nostrWorkspace: string }).__nostrWorkspace = url
        }, BUZZ_URL)
        await loginNsec(page, BUZZ_USER_NSEC)
        await expect(rail(page)).toBeVisible({ timeout: 20_000 })
        await setExpanded(groupToggle(page, 'workspace'), true)

        // Die Zeile trägt den Forum-Satz, nicht den blanken Namen: für die
        // Sprachausgabe ist „E2E-Forum" ein Name wie jeder andere.
        const forumRow = workspacePanel(page).getByRole('button', { name: 'Forum E2E-Forum öffnen' })
        await expect(forumRow).toBeVisible({ timeout: 30_000 })

        // POSITIVKONTROLLE zuerst: ohne sie wäre „steht genau einmal da" auch dann
        // grün, wenn die Raumliste noch gar nicht eingetroffen ist. `general` ist
        // an kein Repo gebunden und steht deshalb flach — er beweist, dass die
        // Gruppe überhaupt Bestand hat.
        await expect
            .poll(async () => (await railProbe(page)).flat.filter((h) => h === BUZZ_ROOM_GENERAL).length, {
                timeout: 30_000,
            })
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
})
