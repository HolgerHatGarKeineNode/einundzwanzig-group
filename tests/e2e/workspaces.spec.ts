import { type Locator, type Page } from '@playwright/test'
import { test, expect } from './support/fixtures'
import { useZooid, ZOOID_WS } from './support/zooid'
import { BUZZ_URL, BUZZ_PORT, BUZZ_ROOM_WELCOME, BUZZ_OWNER_SEC_HEX, BUZZ_USER_NSEC, BUZZ_USER_PUB } from './support/buzz'
import { umgebungFehlt } from './support/umgebung'
import { loginNsec } from './support/login'
import { spawnSync } from 'node:child_process'
import { getPublicKey } from 'nostr-tools/pure'
import { decode } from 'nostr-tools/nip19'

const NSEC = process.env.NOSTR_TEST_NSEC as string
const NAK = process.env.NAK ?? `${process.env.HOME}/go/bin/nak`

/**
 * Den zooid-Testnutzer auch im BUZZ-Stack als Relay-Mitglied aufnehmen (kind 9030).
 *
 * Ohne das liefert Buzz ihm keine Räume: `BUZZ_REQUIRE_RELAY_MEMBERSHIP=true` ist das
 * tragende Zugangsmodell, eine 39000-Abfrage eines Fremden endet in
 * `auth-required: not authenticated`. Der Tab wäre dann leer — und zwar zu Recht.
 *
 * In Produktion stellt sich die Frage nicht: dort ist derselbe Vereinsmitglied-Pubkey
 * auf beiden Relays eingetragen (zooid per `allowpubkey`, Buzz per 9030-Sync). Hier
 * muss der Test das nachstellen, weil die zwei Test-Stacks getrennte Mitgliederlisten
 * haben.
 */
const joinBuzzRelay = (): void => {
    const sk = decode(NSEC).data as Uint8Array
    spawnSync(
        NAK,
        ['event', '--auth', '--sec', BUZZ_OWNER_SEC_HEX, '-k', '9030', '-t', `p=${getPublicKey(sk)}`, '-t', 'role=member', `ws://localhost:${BUZZ_PORT}`],
        { encoding: 'utf8', timeout: 30_000 },
    )
}

/**
 * Der Hybrid-Kern: EIN Client, ZWEI Relays gleichzeitig.
 *
 * Der Tab „Kanäle" (bis 2026-08-23 „Workspaces") listet die Räume eines zweiten, fest konfigurierten Space
 * (ein Buzz-Relay), **während** der zooid-Space aktiv bleibt. Erst der Klick auf einen
 * Workspace-Raum stellt den aktiven Space um.
 *
 * ── Seit P5 steht der Tab auf `/forge`, nicht mehr auf `/spaces` ─────────────────
 *
 * Er war dort der dritte Eintrag der Segmented-Bar — also neben „Räume" und „Threads"
 * des VEREINS-Space, und damit neben zwei Einträgen einer anderen Quelle. Auf `/forge`
 * liest die ganze Seite dasselbe Relay. Für die Zusagen dieser Datei ändert das den WEG,
 * nicht die AUSSAGE: der aktive Space bleibt zooid, der Raum-Klick stellt ihn ephemer um,
 * ein Reload überlebt über `?space=workspace`.
 *
 * **Eine Zusage musste dabei neu formuliert werden.** „Der Tab wechselt den aktiven Space
 * nicht" wurde vorher an `nostrSpaces._url` gemessen — diese Insel gibt es auf `/forge`
 * nicht. Gemessen wird jetzt die WIRKUNG statt des Zustands: nach dem Listen führt ein
 * unmarkierter Vereins-Raum weiterhin auf zooid. Hätte das Listen den Space umgestellt,
 * hinge er am Buzz-Relay.
 *
 * Läuft im ZOOID-Modus (nicht `E2E_RELAY=buzz`): genau das ist der Punkt — der
 * zooid-Stack trägt die Sitzung, der Buzz-Stack liefert nur den zweiten Tab. Beide
 * müssen dafür laufen; ohne den Buzz-Test-Stack auf :3001 wird übersprungen.
 */
const buzzUp = (): boolean => {
    const res = spawnSync('curl', ['-sf', '-m', '2', '-H', 'Accept: application/nostr+json', `http://localhost:${BUZZ_PORT}`], {
        encoding: 'utf8',
    })
    return res.status === 0
}

/**
 * Gegen welches Relay arbeitet die Raum-Insel gerade? (`_url` = der aktive Space, aus
 * dem der Feed kommt und an den Beitritt/Senden gehen.) Über die Insel statt über das
 * Markup: die Relay-URL steht nirgends im DOM, und sie ist die Größe, um die es geht.
 */
const roomSpaceUrl = (page: Page): Promise<string> =>
    page.evaluate(() => {
        const el = document.querySelector('[x-data^="nostrRoomChat"]')!
        const data = (window as unknown as { Alpine: { $data: (e: Element) => Record<string, unknown> } }).Alpine.$data(el)
        return data._url as string
    })

/**
 * Den Tab „Kanäle" auf `/forge` öffnen und seinen Panel liefern.
 *
 * Der Panel ist ein schlichtes `<div>` mit `x-show` und KEIN `flux:tab.panel` — die
 * Forge-Bar fährt ohne `flux:tab.group`. Er trägt deshalb keine `tabpanel`-Rolle;
 * `getByRole('tabpanel')` fände hier nichts (bzw. auf `/spaces` den falschen).
 * Der Anker ist `[data-forge-workspaces]`.
 */
const oeffneWorkspaces = async (page: Page): Promise<Locator> => {
    await page.goto('/forge')
    const tab = page.getByRole('tab', { name: 'Kanäle' })
    await expect(tab).toBeVisible({ timeout: 20_000 })
    await tab.click()
    const panel = page.locator('[data-forge-workspaces]')
    await expect(panel).toBeVisible({ timeout: 20_000 })

    return panel
}

test.describe('Workspaces-Tab (zooid aktiv, Buzz als zweiter Space)', () => {
    test.skip(process.env.E2E_RELAY === 'buzz', 'braucht den zooid-Modus als Basis')
    // `umgebungFehlt` statt der nackten Bedingung: diese acht Fälle sind mit keinem
    // `test:e2e`-Aufruf erreichbar, und der Lauf endet trotzdem mit Exit 0. Mit
    // `E2E_STRICT_UMGEBUNG=1` wird daraus ein Fehlschlag — siehe `support/umgebung.ts`.
    test.skip(
        umgebungFehlt(!buzzUp(), `kein Buzz-Test-Stack auf :${BUZZ_PORT} — bash tests/e2e/support/buzz-testserver.sh`),
        `kein Buzz-Test-Stack auf :${BUZZ_PORT} — bash tests/e2e/support/buzz-testserver.sh`,
    )

    test('die Segmented-Bar des Chats hat genau zwei Tabs — Workspaces steht dort nicht mehr', async ({ page }) => {
        await useZooid(page)
        await loginNsec(page, NSEC)

        // Bis P5 hing hier ein dritter Tab hinter `x-if="hasWorkspace"`. Die Bar hatte
        // damit ZWEI Formen — eine mit zwei, eine mit drei Einträgen —, je nach Config.
        // Jetzt hat sie eine. Gemessen im LEBENDEN DOM: `role="tab"` setzt Flux erst im
        // Browser, serverseitig steht die Rolle nirgends (das prüft
        // `tests/Feature/OrtskartenTest.php` an seiner eigenen Marke).
        await expect(page.getByRole('tab', { name: 'Räume' })).toBeVisible({ timeout: 20_000 })
        await expect(page.getByRole('tab', { name: 'Threads' })).toBeVisible({ timeout: 20_000 })
        // Beide Beschriftungen: „Workspaces" hiess der Tab bis zum 2026-08-23, „Kanäle"
        // heisst er seither. Die Zusage ist, dass er in DIESER Bar gar nicht steht — sie
        // darf nicht dadurch grün werden, dass nur der alte Name verschwunden ist.
        await expect(page.getByRole('tab', { name: 'Workspaces' })).toHaveCount(0)
        await expect(page.getByRole('tab', { name: 'Kanäle' })).toHaveCount(0)
        await expect(page.getByRole('tab')).toHaveCount(2)
    })

    test('mit Config listet er die Buzz-Räume, ohne den zooid-Space zu wechseln', async ({ page }) => {
        joinBuzzRelay()
        await useZooid(page)
        // Der zweite Space wird injiziert wie in Produktion durch `partials/head.blade.php`.
        await page.addInitScript((url) => {
            ;(window as unknown as { __nostrWorkspace: string }).__nostrWorkspace = url
        }, BUZZ_URL)
        await loginNsec(page, NSEC)

        // Vorbedingung: der zooid-Space trägt die Chat-Seite — sein Seed-Raum ist sichtbar.
        // Auf den Räume-Tab gescopt, weil „Willkommen" auch als Chat-Text vorkommt.
        await expect(page.getByRole('tabpanel').getByText('Willkommen', { exact: true })).toBeVisible({ timeout: 20_000 })

        // Im Workspaces-Tab stehen die BUZZ-Räume. Der Seed-Raum des buzz-test-Stacks
        // heißt „welcome" mit der festen UUIDv5 — hier zählt, dass überhaupt Räume aus
        // dem zweiten Relay ankommen, nicht ein bestimmter Name.
        const panel = await oeffneWorkspaces(page)
        await expect
            .poll(async () => (await panel.locator('button').count()) > 0, {
                timeout: 30_000,
                message: 'die Räume des zweiten Space müssen im Tab erscheinen',
            })
            .toBe(true)

        // Der EIGENTLICHE Hybrid-Beleg: das LISTEN allein stellt den aktiven Space nicht
        // um. Gemessen an der WIRKUNG statt am Zustand — `nostrSpaces` gibt es auf
        // `/forge` nicht: ein UNMARKIERTER Vereins-Raum muss weiter auf zooid hängen.
        // Hätte das Listen den Space ephemer umgestellt, führte dieselbe Adresse ans
        // Buzz-Relay, und der Beitritt ginge dorthin (`invalid: group not found`).
        await page.goto('/rooms/welcome')
        await expect(page.locator('[x-data^="nostrRoomChat"]')).toBeVisible({ timeout: 20_000 })
        expect(await roomSpaceUrl(page), 'das Listen darf den aktiven Space NICHT wechseln').toBe(ZOOID_WS + '/')
    })

    test('der Raum-Klick wechselt den Space ephemer — ein Reload landet wieder auf zooid', async ({ page }) => {
        await useZooid(page)
        await page.addInitScript((url) => {
            ;(window as unknown as { __nostrWorkspace: string }).__nostrWorkspace = url
        }, BUZZ_URL)
        await loginNsec(page, NSEC)
        await oeffneWorkspaces(page)

        // Space per Insel-Aufruf umstellen (der Klick-Pfad selbst ist Blade-Navigation).
        // Die Insel heißt seit P5 `nostrWorkspaceRooms` und sitzt am Panel; die Methode
        // heißt `openRoom` statt `openWorkspaceRoom` — in einer eigenen Insel ist das
        // `workspace`-Präfix Lärm.
        await page.evaluate(() => {
            const el = document.querySelector('[data-forge-workspaces]')!
            const data = (window as unknown as { Alpine: { $data: (e: Element) => Record<string, unknown> } }).Alpine.$data(el)
            ;(data.openRoom as (r: unknown) => void)({ h: 'egal' })
        })
        // OHNE Space-Markierung an der URL — genau so, wie ein Deep-Link in den
        // Vereins-Space aussieht.
        await page.goto(`/rooms/${BUZZ_ROOM_WELCOME}`)
        await expect(page.locator('[x-data^="nostrRoomChat"]')).toBeVisible({ timeout: 20_000 })

        // **Die Zusicherung, an der die localStorage-Falle hängt:** der ephemere Space darf
        // NICHT persistiert werden. Nach einem harten Reload muss die App wieder auf dem
        // Vereins-Space stehen — sonst startete ein Nutzer nach einem Absturz im
        // Workspace, ohne das je gewählt zu haben.
        const persisted = await page.evaluate(() => window.localStorage.getItem('activeSpaceUrl'))
        expect(persisted, 'der Workspace darf nicht in den localStorage geschrieben werden').not.toContain(
            String(BUZZ_PORT),
        )
        // Und die Gegenprobe zum Titel: die unmarkierte Raum-URL steht wirklich auf zooid.
        expect(await roomSpaceUrl(page), 'ohne Markierung gehört der Raum dem Vereins-Space').toBe(ZOOID_WS + '/')
    })

    /**
     * **Der Reload-Fehler: `invalid: group not found`.**
     *
     * Gemeldet am 2026-07-30 aus Produktion — nach F5 in einem Workspace-Raum scheiterte
     * der Beitritt mit genau dieser Relay-Antwort und der Verlauf blieb leer. Ursache: der
     * ephemere Space überlebt keinen Reload, also stand wieder der Vereins-Space aktiv,
     * und der Beitritt (kind 9021) ging an ein Relay, das diesen Raum gar nicht kennt.
     *
     * Deshalb trägt die Raum-URL die Zuordnung jetzt selbst (`?space=workspace`). Der Test
     * geht den ECHTEN Klick-Pfad (Tab → Kachel), lädt hart neu und prüft, wogegen der Raum
     * danach spricht.
     */
    test('ein Reload im Workspace-Raum bleibt im Workspace', async ({ page }) => {
        joinBuzzRelay()
        await useZooid(page)
        await page.addInitScript((url) => {
            ;(window as unknown as { __nostrWorkspace: string }).__nostrWorkspace = url
        }, BUZZ_URL)
        await loginNsec(page, NSEC)
        const panel = await oeffneWorkspaces(page)
        await expect.poll(async () => (await panel.locator('button').count()) > 0, { timeout: 30_000 }).toBe(true)
        await panel.locator('button').first().click()
        await expect(page.locator('[x-data^="nostrRoomChat"]')).toBeVisible({ timeout: 20_000 })

        // Die Markierung steht in der Adressleiste — sonst gäbe es nach dem Reload nichts,
        // woraus die Zuordnung noch abzuleiten wäre.
        await expect.poll(() => new URL(page.url()).searchParams.get('space'), { timeout: 10_000 }).toBe('workspace')

        await page.reload()
        await expect(page.locator('[x-data^="nostrRoomChat"]')).toBeVisible({ timeout: 20_000 })

        // Der Punkt der Sache: der Raum-Feed hängt nach dem Reload am BUZZ-Relay. Stünde
        // hier die zooid-URL, ginge auch der Beitritt wieder dorthin — der gemeldete Fehler.
        await expect
            .poll(() => roomSpaceUrl(page), {
                timeout: 20_000,
                message: 'nach dem Reload muss der Raum weiter am Workspace-Relay hängen',
            })
            .toBe(BUZZ_URL)

        // Gegenprobe aus den Daten statt aus der URL: die Raum-Metadaten (39000) kommen nur
        // vom Buzz-Relay, also steht nach dem Reload ein Name da und nicht die rohe UUID.
        await expect
            .poll(
                () =>
                    page.evaluate(() => {
                        const el = document.querySelector('[x-data^="nostrRoomChat"]')!
                        const data = (window as unknown as { Alpine: { $data: (e: Element) => Record<string, unknown> } }).Alpine.$data(el)
                        return data.roomName as string
                    }),
                { timeout: 30_000, message: 'der Raumname muss vom Workspace-Relay nachgeladen werden' },
            )
            .not.toBe(BUZZ_ROOM_WELCOME)
    })

    /**
     * **Das Profil des Workspace-Relays darf das echte Nostr-Profil nicht verdrängen.**
     *
     * Buzz legt beim Onboarding ein eigenes kind-0 an. kind 0 ist ersetzbar, im
     * welshman-Repository gewinnt pro Pubkey der jüngste Zeitstempel — ein frisch
     * erzeugtes Buzz-Profil schlägt damit fast immer das echte, über Jahre gepflegte.
     * Der Effekt ist app-weit, nicht auf den Workspace begrenzt: `profilesByPubkey`
     * hat EINE Quelle pro Pubkey.
     *
     * Der Test stellt genau das nach: derselbe Pubkey hat auf zooid „Alice Test" und
     * auf Buzz einen frischeren Fantasienamen. Nach dem Betreten eines Workspace-Raums
     * muss weiterhin der zooid-Name stehen.
     */
    test('das Buzz-Profil verdrängt das echte Nostr-Profil nicht', async ({ page }) => {
        joinBuzzRelay()
        // Den EINGELOGGTEN Nutzer in den Buzz-Raum aufnehmen (kind 9000, Admin) — ohne
        // Raum-Mitgliedschaft bleibt der Feed gated (`membershipReady: false`), die
        // Nachrichtenliste leer und der Test prüfte nichts.
        spawnSync(
            NAK,
            ['event', '--auth', '--sec', BUZZ_OWNER_SEC_HEX, '-k', '9000', '-t', `h=${BUZZ_ROOM_WELCOME}`, '-t', `p=${getPublicKey(decode(NSEC).data as Uint8Array)}`, `ws://localhost:${BUZZ_PORT}`],
            { encoding: 'utf8', timeout: 30_000 },
        )
        // Autor ist der EINGELOGGTE zooid-Testnutzer. Bewusst nicht der buzz-eigene
        // Seed-Nutzer: dessen Schlüssel ist auf zooid nicht zugelassen, ein dortiges
        // kind-0 würde abgelehnt — es gäbe gar kein „echtes" Profil zum Verteidigen.
        const pub = getPublicKey(decode(NSEC).data as Uint8Array)
        const fake = `BuzzFake-${Math.random().toString(36).slice(2, 8)}`
        const nak = (args: string[]) => spawnSync(NAK, args, { encoding: 'utf8', timeout: 30_000 })

        // Das Buzz-Profil entsteht JETZT und ist damit jünger als das zooid-Seed-Profil
        // — genau die Richtung, in der es ohne den Fix gewinnt, weil kind 0 ersetzbar
        // ist und der jüngste Zeitstempel zählt.
        nak(['event', '--auth', '--sec', NSEC, '-k', '0', '-c', JSON.stringify({ name: fake }), `ws://localhost:${BUZZ_PORT}`])
        nak(['event', '--auth', '--sec', NSEC, '-k', '9', '-t', `h=${BUZZ_ROOM_WELCOME}`, '-c', `Profil-Probe ${fake}`, `ws://localhost:${BUZZ_PORT}`])

        await useZooid(page)
        await page.addInitScript((url) => {
            ;(window as unknown as { __nostrWorkspace: string }).__nostrWorkspace = url
        }, BUZZ_URL)
        await loginNsec(page, NSEC)

        // Über den ECHTEN Klick-Pfad in den Raum: Tab „Workspaces" → Raum-Kachel.
        // Der Abkürzungs-Weg der Nachbartests (`openRoom` + `goto`) genügt hier nicht —
        // er stellt den Space um, aber der Raum-Feed bleibt leer.
        const panel = await oeffneWorkspaces(page)
        await expect.poll(async () => (await panel.locator('button').count()) > 0, { timeout: 30_000 }).toBe(true)
        await panel.locator('button').first().click()
        await expect(page.locator('[x-data^="nostrRoomChat"]')).toBeVisible({ timeout: 20_000 })

        // Der Name, den die Insel für DIESEN Pubkey führt — über die Insel statt über
        // das Markup, weil derselbe Text auch im Nachrichtentext steht.
        //
        // Bewusst OHNE `profileReady`-Filter: geprüft wird die Aussage des Nutzers
        // („in einem Workspace-Raum springt mein Profil um"), und die gilt für jeden
        // Zustand. Ein Test, der auf ein aufgelöstes Profil wartet, würde in dieser
        // Umgebung an der Vorbedingung hängen statt die Sache zu prüfen.
        const nameFor = async (): Promise<string | null> =>
            page.evaluate((pk) => {
                const el = document.querySelector('[x-data^="nostrRoomChat"]')!
                const data = (window as unknown as { Alpine: { $data: (e: Element) => Record<string, unknown> } }).Alpine.$data(el)
                const msg = (data.messages as { pubkey: string; name: string }[]).find((m) => m.pubkey === pk)
                return msg ? msg.name : null
            }, pub)

        await expect
            .poll(async () => (await nameFor()) !== null, {
                timeout: 30_000,
                message: 'die Nachricht des Autors muss im Workspace-Raum ankommen',
            })
            .toBe(true)

        // Die eigentliche Zusicherung: der Buzz-Name darf NIE erscheinen. Er ist das
        // jüngere kind-0 und würde ohne den Fix gewinnen.
        expect(await nameFor(), 'das Buzz-Profil darf das echte nicht verdrängen').not.toBe(fake)

        // Und er darf auch nach 5 s nicht nachträglich einspringen — genau das
        // beschreibt der Bericht: man betritt den Raum und das Profil kippt.
        await page.waitForTimeout(5_000)
        expect(await nameFor(), 'auch verzögert darf das Buzz-Profil nicht gewinnen').not.toBe(fake)
    })

    test('zurück auf die Raumliste verlässt den Workspace — sie zeigt wieder zooid', async ({ page }) => {
        joinBuzzRelay()
        await useZooid(page)
        await page.addInitScript((url) => {
            ;(window as unknown as { __nostrWorkspace: string }).__nostrWorkspace = url
        }, BUZZ_URL)
        await loginNsec(page, NSEC)
        await oeffneWorkspaces(page)

        // In den Workspace wechseln (wie der Raum-Klick) …
        await page.evaluate(() => {
            const el = document.querySelector('[data-forge-workspaces]')!
            const data = (window as unknown as { Alpine: { $data: (e: Element) => Record<string, unknown> } }).Alpine.$data(el)
            ;(data.openRoom as (r: unknown) => void)({ h: 'egal' })
        })
        await page.goto(`/rooms/${BUZZ_ROOM_WELCOME}`)
        await expect(page.locator('[x-data^="nostrRoomChat"]')).toBeVisible({ timeout: 20_000 })

        // … und zurück auf die Raumliste. Sie IST der Vereins-Space: der ephemere
        // Workspace muss dabei wegfallen, sonst käme der Nutzer nur über die
        // Einstellungen zurück und sähe derweil die falschen Räume.
        await page.goto('/spaces')
        await expect(page.locator('[x-data="nostrSpaces"]')).toBeVisible({ timeout: 20_000 })
        const active = await page.evaluate(() => {
            const el = document.querySelector('[x-data="nostrSpaces"]')!
            const data = (window as unknown as { Alpine: { $data: (e: Element) => Record<string, unknown> } }).Alpine.$data(el)
            return data._url as string
        })
        expect(active, 'die Raumliste muss wieder auf dem Vereins-Space stehen').toBe(ZOOID_WS + '/')
        // Gegenprobe: der zooid-Seed-Raum ist auch wirklich da (nicht bloß die URL stimmt).
        await expect(page.getByRole('tabpanel').getByText('Willkommen', { exact: true })).toBeVisible({ timeout: 20_000 })
    })
    /**
     * **Ein Workspace-Raum sagt, wo er liegt — ein Vereins-Raum sagt nichts.**
     *
     * Der offene Punkt aus W4, jetzt eingegrenzt und geschlossen. Gemessen (1440 px, echter
     * Weg über den Tab): der Raum-Feed hing korrekt am Buzz-Relay, aber der Kopf zeigte nur
     * `# E2E-General`, und der Navigator trug oben weiter „Zooid Test Space". Es gab damit
     * KEINE Stelle im Bild, aus der hervorging, in welchem Space man steht.
     *
     * Der Hinweis hängt an `spaceHint` und ist leer, solange der Raum im Vereins-Space liegt
     * — für so gut wie jeden Raum ändert sich nichts. Genau deshalb steht die **Gegenprobe
     * im selben Test**: ein Hinweis, der überall erschiene, wäre kein Hinweis, sondern Lärm.
     */
    test('Ein Workspace-Raum nennt seinen Space im Kopf — ein Vereins-Raum nicht', async ({ page }) => {
        joinBuzzRelay()
        await useZooid(page)
        await page.addInitScript((url) => {
            ;(window as unknown as { __nostrWorkspace: string }).__nostrWorkspace = url
        }, BUZZ_URL)
        await loginNsec(page, NSEC)

        // Gegenprobe zuerst, im VEREINS-Raum: kein Hinweis. Zuerst, weil sie sonst auf einem
        // Zustand stünde, den der Workspace-Besuch hinterlassen hat.
        await page.goto('/rooms/welcome')
        await expect(page.locator('[x-data^="nostrRoomChat"]')).toBeVisible({ timeout: 20_000 })
        await expect
            .poll(async () => page.locator('[data-space-hint]:visible').count(), { timeout: 10_000 })
            .toBe(0)

        // Jetzt in den Workspace-Raum, über den echten Weg (Tab → Kachel).
        const panel = await oeffneWorkspaces(page)
        await expect.poll(async () => (await panel.locator('button').count()) > 0, { timeout: 30_000 }).toBe(true)
        await panel.locator('button').first().click()
        await expect(page.locator('[x-data^="nostrRoomChat"]')).toBeVisible({ timeout: 20_000 })

        const hint = page.locator('[data-space-hint]')
        await expect(hint).toBeVisible({ timeout: 20_000 })
        // Der Text kommt aus dem NIP-11 des BUZZ-Relays, nicht aus einer Konstanten im Test:
        // stünde hier der zooid-Name, wäre die Zuordnung falsch herum.
        await expect(hint).toHaveText('Buzz Relay')
    })

    /**
     * **P13 — derselbe Hinweis, auf dem KALTEN Weg** (F5/Bookmark/geteilter Link mit
     * `?space=workspace`): das Geschwisterstück zum Test oben, das den WARMEN Weg
     * (Tab → Kachel, NIP-11 von `nostrSpaces` vorgeladen) sichert.
     *
     * Beim kalten Lauf liest `setup()` der Rauminsel das NIP-11 EINMAL synchron in den
     * leeren Cache (`bridge.ts`, `spaceHint = … spaceBranding(…, getRelay(url))`) — der
     * Hinweis stand auf der URL-Form (`localhost:3001`) und BLIEB dort, auch nachdem das
     * Doc eintraf: eingefroren, nicht langsam (im Browser reproduziert, 10 s nach
     * Ankunft unverändert; Rohlog p13-08 im Artefaktordner). Der Fix korrigiert über die
     * `deriveRelay`-Subscription, die die Insel ohnehin hält — dieser Test ist der
     * ausgelieferte Wächter dagegen, dass die Eigenschaft still zurückfällt.
     *
     * **Gate statt fester Verzögerung** (P6-Muster ist 6 s): die Verzögerung muss
     * zuverlässig ÜBER den Moment halten, in dem der Kopf gerendert ist — und danach
     * auf Kommando freigeben, denn die Aussage ist die TRANSITION, nicht die Ankunft.
     * `fetchJson` (welshman) hat keinen eigenen Timeout, `makeLoadItem` koalesziert
     * alle `loadRelay`-Aufrufe auf das eine pendende Promise → die Freigabe liefert
     * das Doc garantiert nach, egal wie viele Fetches das Gate festhielt.
     */
    test('Kalter Workspace-Raum-Link: der Space-Hinweis korrigiert sich, wenn NIP-11 nach dem Mount eintrifft', async ({ page }) => {
        test.setTimeout(150_000)
        joinBuzzRelay()

        // NIP-11 des Buzz-Ports festhalten (nur `Accept: application/nostr+json`, der
        // WebSocket bleibt unberührt — der Raum-Feed ist sofort da, nur die Relay-ART
        // trifft später ein). VOR dem Login installiert: Auch der Client-Boot während
        // des Logins kann den Fetch anstoßen.
        let nip11Hits = 0
        let releaseGate!: () => void
        const gate = new Promise<void>((resolve) => {
            releaseGate = resolve
        })
        await page.route(`http://localhost:${BUZZ_PORT}/`, async (route) => {
            if ((route.request().headers().accept ?? '').includes('nostr+json')) {
                nip11Hits++
                await gate
            }
            await route.continue()
        })

        await useZooid(page)
        await page.addInitScript((url) => {
            ;(window as unknown as { __nostrWorkspace: string }).__nostrWorkspace = url
        }, BUZZ_URL)
        await loginNsec(page, NSEC)

        // KALTER Workspace-Raum: voller Ladezyklus. `init()` stellt den aktiven Space
        // synchron um, `setup()` liest den (leeren) NIP-11-Cache — genau der F5-Pfad.
        await page.goto(`/rooms/${BUZZ_ROOM_WELCOME}?space=workspace`)
        await expect(page.locator('[x-data^="nostrRoomChat"]')).toBeVisible({ timeout: 20_000 })
        const hint = page.locator('[data-space-hint]')
        await expect(hint).toBeVisible({ timeout: 20_000 })

        // Vakuitätsriegel 1 — das Gate hält tatsächlich etwas fest (hätte die Route nie
        // gegriffen, wäre der Test stimmhaft grün gegen einen Zufallssieg der Korrektur).
        await expect
            .poll(() => nip11Hits, { timeout: 10_000, message: 'page.route muss das NIP-11-Dokument tatsächlich festhalten' })
            .toBeGreaterThan(0)
        // Vakuitätsriegel 2 — der Zustand VOR der Korrektur ist die URL-Form
        // (`displayRelayUrl(BUZZ_URL)` → `localhost:<BUZZ_PORT>`). Ohne diesen
        // Anker wäre der Test grün, bevor der Fehler überhaupt eintreten KANN.
        //
        // **Der Port kommt aus `BUZZ_PORT`, nicht als Literal.** Bis zum 2026-08-23 stand
        // hier `'localhost:3001'` fest verdrahtet — das ist der Port für `E2E_SLOT_OFFSET=0`.
        // Bei jedem anderen Slot war dieser Test rot (gemessen: `Expected localhost:3001,
        // Received localhost:3021`), und zwar ohne dass an ihm oder am Code etwas falsch
        // gewesen wäre. Parallele Läufe sind hier der dokumentierte Weg — zwei gleichzeitige
        // Playwright-Läufe killen einander sonst die Relays —, also muss jeder Port, den ein
        // Test behauptet, aus derselben Quelle kommen wie der, den der Stack bekommt.
        await expect(hint).toHaveText(`localhost:${BUZZ_PORT}`)

        // Übergangspunkt abwarten, dann erst asserten: Freigabe liefert das Doc, das
        // korrigierende Abo muss den Hinweis auf den Space-Namen ziehen. Der rekonstruierte
        // Einmal-Snapshot (Mutationskalibrierung) liefert ihn NIE → dieser Assert fällt rot.
        releaseGate()
        await expect(hint).toHaveText('Buzz Relay', { timeout: 20_000 })
    })
})
