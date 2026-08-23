import { test, expect, type Page } from './support/fixtures'
import { useBuzz, BUZZ_URL, BUZZ_PORT, BUZZ_USER_NSEC, BUZZ_USER_PUB, BUZZ_OWNER_SEC_HEX, BUZZ_ROOM_GENERAL } from './support/buzz'
import { loginNsec } from './support/login'
import { publishVerified } from './support/publishVerified'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'

/**
 * P9 — **die Erwähnung in der Forge und der Weckruf, der daraus folgt.**
 *
 * ── Der Befund, ohne den diese Fläche unsinnig wäre ──────────────────────────
 *
 * Ein Git-Ereignis weckt einen headless Agenten NIE. Der Relay führt NIP-34
 * community-global und ignoriert ein `h`-Tag ausdrücklich („git events use `a`
 * tags, not `h` tags", `buzz-relay/src/handlers/ingest.rs:425-437`); die
 * Subscription des Agenten ist aber strikt kanalgebunden
 * (`buzz-acp/src/relay.rs:880`). Im buzz-team am 2026-07-29 zweimal gemessen,
 * mit und ohne `h` am Issue: keine Reaktion. Deshalb geht neben dem Beitrag eine
 * **Kanalnachricht kind 9** raus — derselbe Weg, den `issues-to-channel.mjs`
 * serverseitig fährt.
 *
 * ── Was hier steht und was der Unit-Test trägt ───────────────────────────────
 *
 * Die REGELN (Eignung, Tag-Form, Verweis, „keine Meldung ist ein Ergebnis")
 * stehen in `forgeWakeModels.test.ts` und `forgeWriteModels.test.ts`, 51 Fälle
 * ohne Docker. Hier steht nur, was ohne echten Roundtrip nicht prüfbar ist:
 *
 *   1. Erscheint der Agent im Vorschlag der FORGE — und nur dort, wo er wirklich
 *      antworten kann?
 *   2. Kommt am Relay wirklich EINE kind-9 mit `h`, `p` und Verweis an?
 *   3. Bleibt der Beitrag gültig, wenn die Weckmeldung scheitert?
 *
 * ── Warum drei Wegwerf-Agenten und nicht einer ───────────────────────────────
 *
 * kind 10100 ist **ersetzbar und je Autor eindeutig**. Ein einziger Schlüssel
 * für drei Szenarien hieße, dass das dritte Profil das erste überschreibt —
 * unter `fullyParallel` sogar mitten im Lauf eines anderen Tests. Jeder Fall
 * bekommt deshalb seinen eigenen Schlüssel, und jeder wird per kind 9030 zum
 * Relay-Mitglied gemacht (ohne das nimmt der Relay sein 10100 nicht an:
 * `restricted_writes`).
 *
 * ── Der Dateiname ist Teil der Mechanik ──────────────────────────────────────
 *
 * `playwright.config.ts` filtert im Buzz-Modus auf `/(?:buzz-.*|…)\.spec\.ts$/`
 * und überspringt alles andere LAUTLOS („Total: 0 tests", kein Fehler).
 */

const NAK = process.env.NAK ?? `${process.env.HOME}/go/bin/nak`
const WS = (): string => `ws://localhost:${BUZZ_PORT}`
/** Deckel für jede Abfrage — nimmt dem Default-Fenster des Relays jede Rolle (P4-Lehre). */
const QUERY_LIMIT = '500'

const nak = (args: string[]): string => {
    const res = spawnSync(NAK, args, { encoding: 'utf8', timeout: 30_000 })

    return `${res.stdout ?? ''}\n${res.stderr ?? ''}`
}

const publish = (sec: string, args: string[]): string => nak(['event', '--auth', '--sec', sec, ...args, WS()])

type RelayEvent = { id: string; kind: number; pubkey: string; content: string; tags: string[][] }

const events = (args: string[]): RelayEvent[] => {
    const out: RelayEvent[] = []
    for (const line of nak(['req', '--auth', '--sec', BUZZ_USER_NSEC, '-l', QUERY_LIMIT, ...args, WS()]).split('\n')) {
        if (!line.startsWith('{')) {
            continue
        }
        try {
            out.push(JSON.parse(line) as RelayEvent)
        } catch {
            // Keine Ereigniszeile.
        }
    }

    return out
}

const tagValues = (tags: string[][], name: string): string[] =>
    tags.filter((tag) => tag[0] === name).map((tag) => tag[1])

const ownerPubkey = (): string => nak(['key', 'public', BUZZ_OWNER_SEC_HEX]).trim().split('\n')[0].trim()

/** Ein Wegwerf-Schlüssel samt seiner drei Schreibweisen. */
type Agent = { sec: string; pub: string; npub: string; name: string }

const neuerAgent = (rolle: string): Agent => {
    const sec = nak(['key', 'generate']).trim().split('\n')[0].trim()
    const pub = nak(['key', 'public', sec]).trim().split('\n')[0].trim()
    const npub = nak(['encode', 'npub', pub]).trim().split('\n')[0].trim()
    expect(pub, `Wegwerf-Schlüssel für ${rolle} nicht erzeugt`).toHaveLength(64)

    return { sec, pub, npub, name: `zwergotter-${rolle}-${randomUUID().slice(0, 8)}` }
}

/**
 * Ein Agentenprofil an den Relay — als Relay-Mitglied, sonst lehnt er es ab.
 *
 * `channel_add_policy` fehlt bewusst: der Nebeneffekt des Relays
 * (`side_effects.rs handle_agent_profile`) scheitert dann, das EREIGNIS wird
 * trotzdem gespeichert und ausgeliefert (`ingest.rs:2978-2990` loggt nur). Am
 * Teststack nachgemessen — und wichtig, weil dieses Feld sonst die Kanal-Politik
 * eines echten Schlüssels umstellte.
 */
function seedAgent(agent: Agent, kanaele: string[], respondTo: string, allowlist: string[]): void {
    expect(publish(BUZZ_OWNER_SEC_HEX, ['-k', '9030', '-t', `p=${agent.pub}`, '-t', 'role=member'])).toContain('success')
    const content = JSON.stringify({
        name: agent.name,
        display_name: agent.name,
        agent_type: 'agent',
        channel_ids: kanaele,
        channels: kanaele,
        respond_to: respondTo,
        respond_to_allowlist: allowlist,
        status: 'online',
    })
    const finde = (): RelayEvent | undefined =>
        events(['-k', '10100', '-a', agent.pub]).find((e) => e.content.includes(agent.name))
    publishVerified(NAK, ['event', '--auth', '--sec', agent.sec, '-k', '10100', '-c', content], WS(), finde, `Agentenprofil ${agent.name}`)
}

/** Ein Repo dieses Laufs — eigene Adresse, damit keine Abfrage je einen Altbestand sieht. */
function seedRepo(dtag: string, kanal: string): void {
    const args = ['-k', '30617', '-t', `d=${dtag}`, '-t', `name=${dtag}`, '-t', 'description=P9 Erwaehnungsziel']
    if (kanal) {
        args.push('-t', `buzz-channel=${kanal}`)
    }
    expect(publish(BUZZ_OWNER_SEC_HEX, args)).toContain('success')
}

async function useWorkspace(page: Page): Promise<void> {
    await useBuzz(page)
    await page.addInitScript((url) => {
        ;(window as unknown as { __nostrWorkspace: string }).__nostrWorkspace = url
    }, BUZZ_URL)
    await loginNsec(page, BUZZ_USER_NSEC)
}

async function openRepo(page: Page, dtag: string): Promise<void> {
    await page.goto('/forge')
    await page.getByRole('tab', { name: 'Repositories' }).click()
    await page.locator('[data-forge-repo]').filter({ hasText: dtag }).first().click()
    await expect(page.getByRole('heading', { level: 1, name: dtag, exact: true })).toBeVisible({ timeout: 30_000 })
}

/** Das Issue-Formular öffnen und den Titel setzen. */
async function issueFormular(page: Page, titel: string) {
    await page.getByRole('button', { name: 'Neues Issue' }).click()
    const formular = page.locator('[data-forge-issue-form]')
    await formular.getByLabel('Titel').fill(titel)

    return formular
}

const popover = (page: Page) => page.locator('[data-forge-mention-popover="issue"]')
const agentZeilen = (page: Page) => popover(page).locator('button[data-agent="true"]')

/**
 * In den Rumpf tippen — `pressSequentially`, damit jede Taste ein `input`-Ereignis
 * auslöst (`fill()` löst genau eines aus und der Composer sähe den Zwischenstand
 * nie, an dem `@wort` entsteht).
 */
async function tippe(rumpf: ReturnType<Page['locator']>, text: string): Promise<void> {
    await rumpf.fill('')
    await rumpf.click()
    await rumpf.pressSequentially(text, { delay: 20 })
}

/**
 * **Die Positivkontrolle jeder Abwesenheitsmessung hier**: das Popover geht auf
 * DIESER Seite überhaupt auf und ist gefüllt. „Kein Agent" ist sonst nicht von
 * „kein Popover" zu unterscheiden.
 */
async function vorschlagGehtAuf(page: Page, rumpf: ReturnType<Page['locator']>): Promise<void> {
    await tippe(rumpf, 'Bitte schau drauf, @')
    await expect(popover(page)).toBeVisible({ timeout: 30_000 })
    await expect(popover(page).locator('button')).not.toHaveCount(0)
}

/**
 * Nach EINEM Agenten suchen — mit seinem vollen, laufeigenen Namen.
 *
 * **Der volle Name ist keine Bequemlichkeit, sondern die Bedingung dafür, dass
 * die Messung überhaupt etwas heißt.** Die Vorschlagsliste ist auf acht Einträge
 * gedeckelt und alphabetisch sortiert (`parseAgentProfiles`); in einem Teststack,
 * der über mehrere Läufe Agentenprofile ansammelt, fällt ein bestimmter Agent
 * dann aus dem Fenster — genau so gemessen (13 taugliche Agenten, 8 Plätze, der
 * gesuchte nicht dabei). Ein `@` allein prüft damit die Deckelung mit, nicht die
 * Eignung.
 */
async function sucheAgent(page: Page, rumpf: ReturnType<Page['locator']>, name: string): Promise<void> {
    await tippe(rumpf, `Bitte schau drauf, @${name}`)
}

test.describe('Buzz-Workspace: Erwähnung in der Forge weckt über den Projektkanal', () => {
    test.skip(process.env.E2E_RELAY !== 'buzz', 'nur im Buzz-Modus (E2E_RELAY=buzz) relevant')

    let owner = ''
    /** Weckbar: bedient den General-Kanal und antwortet jedem. */
    let frei: Agent
    /** Bedient einen anderen Kanal und antwortet nur dem Owner — nie weckbar für uns. */
    let fremd: Agent
    /** Weckbar nach Client-Regeln, aber sein Kanal existiert am Relay nicht. */
    let phantom: Agent
    /** Sein Profil entsteht ERST, während der Vorschlag schon offen ist. */
    let spaet: Agent

    const REPO_KANAL = `e2e-p9-kanal-${randomUUID().slice(0, 8)}`
    const REPO_OHNE = `e2e-p9-ohnekanal-${randomUUID().slice(0, 8)}`
    const REPO_FREMD = `e2e-p9-fremd-${randomUUID().slice(0, 8)}`
    const REPO_PHANTOM = `e2e-p9-phantom-${randomUUID().slice(0, 8)}`
    /** Existiert am Relay NICHT — genau das ist der Fall, den Test 4 braucht. */
    const KANAL_PHANTOM = randomUUID()
    const KANAL_FREMD = randomUUID()

    test.beforeAll(() => {
        owner = ownerPubkey()
        expect(owner).toHaveLength(64)

        frei = neuerAgent('frei')
        fremd = neuerAgent('fremd')
        phantom = neuerAgent('phantom')
        spaet = neuerAgent('spaet')
        // Nur die Mitgliedschaft — sein 10100 kommt mitten im Test.
        expect(publish(BUZZ_OWNER_SEC_HEX, ['-k', '9030', '-t', `p=${spaet.pub}`, '-t', 'role=member'])).toContain('success')

        seedAgent(frei, [BUZZ_ROOM_GENERAL], 'anyone', [])
        // Beide Hälften der Eignung fallen: falscher Kanal UND Allowlist ohne uns.
        seedAgent(fremd, [KANAL_FREMD], 'allowlist', [owner])
        seedAgent(phantom, [KANAL_PHANTOM], 'anyone', [])

        seedRepo(REPO_KANAL, BUZZ_ROOM_GENERAL)
        seedRepo(REPO_OHNE, '')
        seedRepo(REPO_FREMD, KANAL_FREMD)
        seedRepo(REPO_PHANTOM, KANAL_PHANTOM)
    })

    /**
     * Aufräumen: die vier Repos dieses Laufs per kind 5 auf ihre `a`-Koordinate.
     * Ohne `expect` — ein misslungenes Aufräumen darf einen grünen Lauf nicht
     * nachträglich rot machen.
     */
    test.afterAll(() => {
        for (const d of [REPO_KANAL, REPO_OHNE, REPO_FREMD, REPO_PHANTOM]) {
            publish(BUZZ_OWNER_SEC_HEX, ['-k', '5', '-t', `a=30617:${owner}:${d}`])
        }
    })

    /**
     * Der Hauptweg, in einem Stück: vorschlagen → einfügen → absenden → wecken.
     *
     * Geprüft wird an BEIDEN Enden — was die Fläche zeigt und was am Relay liegt.
     * Der Vorschlag allein bewiese nichts über den `p`-Tag, und der `p`-Tag nichts
     * über den Kanal, in dem der Agent wirklich zuhört.
     */
    test('ein erwähnter Agent bekommt seinen p-Tag und EINE Weckmeldung im Projektkanal', async ({ page }) => {
        const marke = `P9 Otter ${randomUUID().slice(0, 8)}`

        await useWorkspace(page)
        await openRepo(page, REPO_KANAL)
        const formular = await issueFormular(page, marke)
        const rumpf = formular.getByLabel('Beschreibung')

        // ── Vorschlag: Menschen UND Agenten, Agenten gekennzeichnet ─────────
        await vorschlagGehtAuf(page, rumpf)
        await sucheAgent(page, rumpf, frei.name)
        const zeile = agentZeilen(page).filter({ hasText: frei.name })
        await expect(zeile).toHaveCount(1, { timeout: 30_000 })
        await zeile.click()

        // Der Entwurf trägt jetzt die NIP-27-Form — kein hex, kein nacktes npub.
        await expect(rumpf).toHaveValue(new RegExp(`nostr:${frei.npub}`))

        await page.getByRole('button', { name: 'Issue anlegen' }).click()

        // ── Die Fläche: Beitrag steht, Weckruf gemeldet ─────────────────────
        const issueZeile = page.locator('[data-forge-issue]').filter({ hasText: marke }).first()
        await expect(issueZeile).toBeVisible({ timeout: 30_000 })
        const hinweis = page.locator('[data-forge-wake-notice="issue"]')
        await expect(hinweis).toBeVisible({ timeout: 30_000 })
        await expect(hinweis).toHaveAttribute('data-tone', 'ok')
        await expect(hinweis).toContainText(frei.name)

        // ── Der Relay: das Issue trägt den p-Tag des Agenten ────────────────
        const adresse = `30617:${owner}:${REPO_KANAL}`
        const issues = events(['-k', '1621', '-t', `a=${adresse}`]).filter(
            (e) => tagValues(e.tags, 'subject')[0] === marke,
        )
        expect(issues).toHaveLength(1)
        expect(issues[0].pubkey).toBe(BUZZ_USER_PUB)
        // Eigentümer UND der erwähnte Agent — genau in dieser Reihenfolge.
        expect(tagValues(issues[0].tags, 'p')).toEqual([owner, frei.pub])

        // ── Der Relay: GENAU EINE Weckmeldung, im richtigen Kanal ───────────
        const weck = events(['-k', '9', '-t', `h=${BUZZ_ROOM_GENERAL}`, '-p', frei.pub])
        expect(weck).toHaveLength(1)
        expect(weck[0].pubkey).toBe(BUZZ_USER_PUB)
        expect(tagValues(weck[0].tags, 'h')).toEqual([BUZZ_ROOM_GENERAL])
        expect(tagValues(weck[0].tags, 'p')).toEqual([frei.pub])
        // Der Verweis: Titel, Repo und der kanonische Deep-Link auf das ISSUE.
        expect(weck[0].content).toContain(marke)
        expect(weck[0].content).toContain(REPO_KANAL)
        expect(weck[0].content).toContain(`buzz://issue?id=${issues[0].id}&owner=${owner}&d=${REPO_KANAL}`)
    })

    /**
     * **Die Liste zieht nach — auch wenn der Vorschlag gerade LEER ist.**
     *
     * Beide Quellen tröpfeln asynchron herein (das Verzeichnis wartet auf die
     * NIP-11-Runde, der Kanal kommt mit dem Repo). Berechnet wird die
     * Vorschlagsliste aber je Tastendruck — wer eine Zehntelsekunde zu früh tippt,
     * sähe ohne Nachziehen dauerhaft eine Liste ohne Agenten.
     *
     * Hergestellt statt abgewartet: das 10100 entsteht ERST, wenn der Suchbegriff
     * schon im Feld steht und das Popover mangels Treffer **geschlossen** ist.
     * Genau dieser Fall ist der schlimmere — eine Bedingung auf „Popover offen"
     * ließe den Vorschlag nie wiederkommen.
     */
    test('ein Agentenprofil, das mitten in der Suche eintrifft, erscheint noch', async ({ page }) => {
        await useWorkspace(page)
        await openRepo(page, REPO_KANAL)
        const formular = await issueFormular(page, `P9 Spaet ${randomUUID().slice(0, 8)}`)
        const rumpf = formular.getByLabel('Beschreibung')

        await vorschlagGehtAuf(page, rumpf)
        // Diesen Namen kennt der Relay noch nicht — nichts trifft, das Fenster geht zu.
        await sucheAgent(page, rumpf, spaet.name)
        await expect(popover(page)).toHaveCount(0)

        // Und JETZT erst entsteht sein Profil.
        seedAgent(spaet, [BUZZ_ROOM_GENERAL], 'anyone', [])

        await expect(agentZeilen(page).filter({ hasText: spaet.name })).toHaveCount(1, { timeout: 30_000 })
    })

    /**
     * NEGATIVBEWEIS (a) — **ohne `buzz-channel` entsteht keine kind-9.**
     *
     * Das ist bei uns der Regelfall, nicht die Ausnahme: alle Produktivagenten
     * führen genau einen Kanal, und ein Repo, dessen `buzz-channel` woanders
     * hinzeigt (oder fehlt), hat keinen einzigen weckbaren Agenten.
     *
     * Erwähnt wird hier von HAND (die eingefügte `nostr:npub…`-Form), denn
     * vorgeschlagen wird bewusst niemand — und genau das ist die erste Hälfte
     * der Zusage.
     */
    test('ohne buzz-channel: kein Agentenvorschlag, keine Weckmeldung, aber ein sichtbarer Grund', async ({ page }) => {
        const marke = `P9 Ohne ${randomUUID().slice(0, 8)}`

        await useWorkspace(page)
        await openRepo(page, REPO_OHNE)
        const formular = await issueFormular(page, marke)
        const rumpf = formular.getByLabel('Beschreibung')

        await vorschlagGehtAuf(page, rumpf)
        await expect(agentZeilen(page)).toHaveCount(0)
        // Und derselbe Agent, der in REPO_KANAL mit genau dieser Suche erscheint,
        // erscheint hier nicht — die Suche ist eindeutig, die Deckelung auf acht
        // Vorschläge kann daran keinen Anteil haben.
        await sucheAgent(page, rumpf, frei.name)
        await expect(agentZeilen(page)).toHaveCount(0)

        // Von Hand erwähnen: den Weg über den Vorschlag gibt es hier ja gerade nicht.
        await rumpf.fill(`Bitte schau drauf, nostr:${frei.npub} `)
        await page.getByRole('button', { name: 'Issue anlegen' }).click()

        await expect(page.locator('[data-forge-issue]').filter({ hasText: marke }).first()).toBeVisible({ timeout: 30_000 })
        const hinweis = page.locator('[data-forge-wake-notice="issue"]')
        await expect(hinweis).toBeVisible({ timeout: 30_000 })
        await expect(hinweis).toHaveAttribute('data-tone', 'warn')
        await expect(hinweis).toContainText('keinem Kanal')

        // Am Relay: das Issue liegt da, samt p-Tag — aber KEINE Weckmeldung.
        const adresse = `30617:${owner}:${REPO_OHNE}`
        const issues = events(['-k', '1621', '-t', `a=${adresse}`]).filter(
            (e) => tagValues(e.tags, 'subject')[0] === marke,
        )
        expect(issues).toHaveLength(1)
        expect(tagValues(issues[0].tags, 'p')).toContain(frei.pub)
        // Über den Kanal gesucht, nicht über den Agenten: eine Meldung könnte ja
        // auch im falschen Kanal gelandet sein.
        expect(events(['-k', '9', '-p', frei.pub]).filter((e) => e.content.includes(marke))).toHaveLength(0)
    })

    /**
     * NEGATIVBEWEIS (b) — **nur nicht weckbare Agenten erwähnt ⇒ keine Meldung.**
     *
     * Beide Hälften der Eignung fallen hier: der Agent bedient den Kanal des
     * Repos zwar (`KANAL_FREMD`), antwortet aber nur dem Owner
     * (`buzz-acp/src/lib.rs:249-257`). Ein `p`-Tag an ihn wäre ein Weckruf, auf
     * den per Konstruktion nie eine Antwort kommt — und niemand könnte das von
     * „Agent gerade beschäftigt" unterscheiden.
     */
    test('nur ein nicht weckbarer Agent erwähnt: keine Meldung, und die Fläche sagt es', async ({ page }) => {
        const marke = `P9 Fremd ${randomUUID().slice(0, 8)}`

        await useWorkspace(page)
        await openRepo(page, REPO_FREMD)
        const formular = await issueFormular(page, marke)
        const rumpf = formular.getByLabel('Beschreibung')

        await vorschlagGehtAuf(page, rumpf)
        // Weder der Agent dieses Kanals (Allowlist ohne uns) noch der aus dem
        // General-Kanal (falsches Repo) darf hier stehen.
        await expect(agentZeilen(page)).toHaveCount(0)
        await sucheAgent(page, rumpf, fremd.name)
        await expect(agentZeilen(page)).toHaveCount(0)

        await rumpf.fill(`Bitte schau drauf, nostr:${fremd.npub} `)
        await page.getByRole('button', { name: 'Issue anlegen' }).click()

        await expect(page.locator('[data-forge-issue]').filter({ hasText: marke }).first()).toBeVisible({ timeout: 30_000 })
        const hinweis = page.locator('[data-forge-wake-notice="issue"]')
        await expect(hinweis).toBeVisible({ timeout: 30_000 })
        await expect(hinweis).toHaveAttribute('data-tone', 'warn')
        await expect(hinweis).toContainText(fremd.name)
        // **Der Wortlaut zählt hier.** „warn" plus Name stünde auch dann da, wenn
        // die Meldung LOSGEFLOGEN und vom Relay abgelehnt worden wäre — und die
        // Zeile darunter bliebe grün, weil ein abgelehntes Ereignis ebenfalls
        // nirgends liegt. Genau so gemessen (Mutation „planWake meldet immer
        // ready"): ohne diese Zeile war der Fall grün.
        await expect(hinweis).toContainText('Hier reagiert niemand auf dich')

        expect(events(['-k', '9', '-p', fremd.pub])).toHaveLength(0)
    })

    /**
     * NEGATIVBEWEIS (c) — **die Weckmeldung scheitert, der Beitrag bleibt gültig.**
     *
     * Hergestellt an einem Kanal, den der Relay nicht kennt: er antwortet auf die
     * kind-9 mit `restricted: not a channel member` (am Teststack gemessen),
     * während das 1621 durchgeht. Zwei Vorgänge, zwei Ergebnisse — der Beitrag
     * steht in der Liste, das Formular ist zu, und es steht KEINE
     * Fehlschlag-Zeile am Issue.
     */
    test('scheitert die Weckmeldung, bleibt das Issue gültig und als gelungen dargestellt', async ({ page }) => {
        const marke = `P9 Phantom ${randomUUID().slice(0, 8)}`

        await useWorkspace(page)
        await openRepo(page, REPO_PHANTOM)
        const formular = await issueFormular(page, marke)
        const rumpf = formular.getByLabel('Beschreibung')

        // Nach den Client-Regeln ist dieser Agent weckbar — der Vorschlag steht.
        await vorschlagGehtAuf(page, rumpf)
        await sucheAgent(page, rumpf, phantom.name)
        const zeile = agentZeilen(page).filter({ hasText: phantom.name })
        await expect(zeile).toHaveCount(1, { timeout: 30_000 })
        await zeile.click()

        await page.getByRole('button', { name: 'Issue anlegen' }).click()

        const issueZeile = page.locator('[data-forge-issue]').filter({ hasText: marke }).first()
        await expect(issueZeile).toBeVisible({ timeout: 30_000 })

        // ── ZUERST auf den Ausgang des Weckrufs warten ──────────────────────
        //
        // **Die Reihenfolge ist die halbe Zusage.** Der Beitrag steht optimistisch
        // schon da, während die Weckmeldung noch fliegt; wer hier zuerst „Formular
        // zu, keine Fehlschlag-Zeile" prüft, misst einen Zustand VOR dem
        // Fehlschlag und ist grün, egal was danach passiert. Genau so gemessen:
        // eine Mutation, die den gescheiterten Weckruf das Issue-Formular wieder
        // aufreißen lässt, war in dieser Reihenfolge **4/4 grün**.
        const hinweis = page.locator('[data-forge-wake-notice="issue"]')
        await expect(hinweis).toBeVisible({ timeout: 30_000 })
        await expect(hinweis).toHaveAttribute('data-tone', 'warn')
        await expect(hinweis).toContainText(phantom.name)
        // Und die Begründung ist die des RELAYS, nicht unsere Vermutung — nur so
        // ist dieser Fall von „war gar nicht weckbar" zu unterscheiden.
        await expect(hinweis).toContainText('ging nicht raus')
        await expect(hinweis).toContainText('not a channel member')

        // ── Und JETZT: der Beitrag ist immer noch gelungen ──────────────────
        await expect(issueZeile).toHaveAttribute('data-status', 'open')
        await expect(page.locator('[data-forge-issue-form]')).toHaveCount(0)
        await expect(page.locator('[data-forge-write-failed="issue"]')).toHaveCount(0)
        await expect(page.locator('[data-forge-issue-error]')).toHaveCount(0)

        // Am Relay: das Issue liegt da, die Weckmeldung nicht.
        const adresse = `30617:${owner}:${REPO_PHANTOM}`
        expect(
            events(['-k', '1621', '-t', `a=${adresse}`]).filter((e) => tagValues(e.tags, 'subject')[0] === marke),
        ).toHaveLength(1)
        expect(events(['-k', '9', '-p', phantom.pub])).toHaveLength(0)
    })
})
