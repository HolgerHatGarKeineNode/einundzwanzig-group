import { test, expect, type Page } from './support/fixtures'
import { useBuzz, BUZZ_PORT, BUZZ_USER_NSEC, BUZZ_USER_PUB, BUZZ_OWNER_SEC_HEX, BUZZ_ROOM_FORUM } from './support/buzz'
import { loginNsec } from './support/login'
import { spawnSync } from 'node:child_process'

/**
 * P3 — **Forum-Bewertungen (kind 45002)** an der echten Fläche gegen einen echten
 * Buzz-Relay.
 *
 * ── Was hier gemessen wird, und warum es nur hier messbar ist ────────────────
 *
 * Die Falt-Regel selbst steht unter `node --test` (`js/forumModels.test.ts`) und
 * braucht keinen Browser. Was ein Unit-Test NICHT zeigen kann, ist die eine
 * Eigenschaft, an der diese Phase hängt: **der Relay dedupliziert 45002 nicht.**
 * Zwei Klicks erzeugen dort zwei Zeilen, wenn der Client sie erzeugt — die Zusage
 * „ein zweiter Klick ändert den sichtbaren Zähler nicht" ist deshalb erst dann
 * belegt, wenn sie gegen einen Relay steht, der beide Ereignisse annähme.
 *
 * Dasselbe gilt für die **Rücknahme**: sie ist eine NIP-09-Löschung (kind 5) je eigener
 * Stimme, und ob sie wirkt, entscheidet nicht das `OK` des Relays, sondern die Requery.
 *
 * Der Fall misst deshalb BEIDE Seiten:
 *   · die Fläche (die Zahl bewegt sich nicht), und
 *   · den Draht (`nak req` zählt die 45002 dieses Autors auf dieses Ziel).
 * Nur zusammen trennen sie „der Client hat nichts geschrieben" von „der Client hat
 * geschrieben und die Anzeige hat es weggefaltet". Die erste ist die Zusage; die
 * zweite wäre eine dauerhaft wachsende Spur im Relay.
 *
 * ── Warum FRISCHE Themen und nicht die des Seeds ────────────────────────────
 *
 * Bewertungen sind append-only und überleben einen Testlauf. Auf einem warmen
 * Stack trüge das Seed-Thema die Stimmen aller früheren Läufe, und jede absolute
 * Zahl wäre eine Aussage über die Vorgeschichte des Rechners. Jeder Fall legt
 * seine Themen deshalb selbst an, mit einem einmaligen Marker im Titel.
 *
 * ── Zwei Mechaniken, die dieser Datei ihren Namen geben ─────────────────────
 * 1. Der Dateiname MUSS `buzz-*` sein (`playwright.config.ts:57`), sonst
 *    überspringt der Buzz-Modus die Datei lautlos.
 * 2. 45002 ist Buzz-Dialekt. Auf zooid wäre das Ereignis dauerhafter Müll (kein
 *    Kind-Allowlist), und der Riegel `mayWriteKind` sperrt die Fläche dort — der
 *    Fall wäre also nicht „rot", sondern gegenstandslos. Daher `test.skip`.
 *
 * **Stand: geschrieben, noch nie gelaufen.** Er gehört in den gesammelten
 * E2E-Schlusslauf des Plans und wird dort einmal kalibriert (absichtlich rot
 * machen, zurückbauen) — ein Spec, den niemand hat scheitern sehen, ist nicht als
 * Wächter bekannt.
 */

const NAK = process.env.NAK ?? `${process.env.HOME}/go/bin/nak`
const WS = (): string => `ws://localhost:${BUZZ_PORT}`

const nak = (args: string[]): string => {
    const res = spawnSync(NAK, args, { encoding: 'utf8', timeout: 30_000 })

    return `${res.stdout ?? ''}\n${res.stderr ?? ''}`
}

const query = (args: string[]): string => nak(['req', '--auth', '--sec', BUZZ_USER_NSEC, ...args, WS()])

/**
 * Ein frisches Thema im offenen Seed-Forum, angelegt vom Owner.
 *
 * Gibt die Ereignis-Id zurück — **aus der Relay-Antwort gelesen, nicht geraten.**
 * `nak` druckt auch bei einer ABLEHNUNG das signierte Ereignis und endet mit 0
 * (dokumentierte Falle dieses Repos), deshalb wird zusätzlich auf `success`
 * geprüft: ohne das hielte der Fall ein nie gespeichertes Thema für angelegt und
 * scheiterte später an einer leeren Liste, aus einem Grund, der mit seinem
 * Prüfgegenstand nichts zu tun hat.
 */
const seedTopic = (title: string): string => {
    const out = nak([
        'event',
        '--auth',
        '--sec',
        BUZZ_OWNER_SEC_HEX,
        '-k',
        '45001',
        '-t',
        `h=${BUZZ_ROOM_FORUM}`,
        '-c',
        title,
        WS(),
    ])
    expect(out, `das Thema „${title}" wurde vom Relay nicht angenommen`).toContain('success')
    const line = out.split('\n').find((row) => row.trim().startsWith('{') && row.includes('"id"'))
    expect(line, 'nak hat kein Ereignis-JSON gedruckt').toBeTruthy()

    return JSON.parse(line as string).id as string
}

/** Wie viele 45002 dieses Autors auf dieses Ziel liegen beim Relay wirklich? */
const voteEventsOnWire = (targetId: string): number =>
    query(['-k', '45002', '-t', `h=${BUZZ_ROOM_FORUM}`, '-a', BUZZ_USER_PUB, '-l', '50'])
        .split('\n')
        .filter((row) => row.trim().startsWith('{'))
        .map((row) => JSON.parse(row) as { tags: string[][] })
        .filter((event) => event.tags.some((tag) => tag[0] === 'e' && tag[1] === targetId)).length

/** Die Listenzeile eines Themas — Bewertungsspalte und Karte liegen darin nebeneinander. */
const row = (page: Page, title: string) =>
    page
        .locator('ul[role="list"] > li')
        .filter({ has: page.getByRole('button', { name: new RegExp(`Thema ${title}`) }) })

const score = (page: Page, title: string) => row(page, title).locator('[data-forum-score]')
const upvote = (page: Page, title: string) => row(page, title).locator('[data-forum-vote="up"]')
const downvote = (page: Page, title: string) => row(page, title).locator('[data-forum-vote="down"]')

/** Die Titel der Zeilen in Markup-Reihenfolge — für die Sortierzusage. */
const listOrder = (page: Page): Promise<string[]> =>
    page
        .locator('ul[role="list"] > li button[type="button"]')
        .evaluateAll((els) => els.map((el) => el.getAttribute('aria-label') ?? ''))

async function openForum(page: Page): Promise<void> {
    await useBuzz(page)
    await loginNsec(page, BUZZ_USER_NSEC)
    await page.goto(`/rooms/${BUZZ_ROOM_FORUM}`)
    await expect(page.locator('ul[role="list"] > li').first(), 'die Themenliste des Forums').toBeVisible({
        timeout: 30_000,
    })

    // Beitreten, falls noch nicht Mitglied — ohne das rendert die Bewertungsspalte gar
    // nicht (`x-if="canVote && joined"`, `forum-vote.blade.php`), egal wie lang gewartet
    // wird. Gleiches Muster wie in `buzz-forum.spec.ts` (`joinButton`); der Kanal ist
    // öffentlich lesbar, aber Stimmen sind eine Mitglieds-Handlung.
    const beitreten = page.getByRole('button', { name: 'Beitreten' })
    if (await beitreten.isVisible()) {
        await beitreten.click()
        await expect(beitreten).toBeHidden({ timeout: 15_000 })
    }
}

test.describe('Buzz-Forum: Bewertungen (E2E, nur E2E_RELAY=buzz)', () => {
    test.skip(process.env.E2E_RELAY !== 'buzz', 'nur im Buzz-Modus (E2E_RELAY=buzz) relevant')

    test('ein Upvote hebt den Punktstand um eins und markiert den Pfeil', async ({ page }) => {
        const title = `E2E-Vote-Thema-${Date.now()}`
        const id = seedTopic(title)
        await openForum(page)

        // Ein frisches Thema hat null Punkte — kein Relay liefert diese Zahl, sie ist
        // aus den (noch nicht vorhandenen) Ereignissen gerechnet.
        await expect(score(page, title)).toHaveText('0')
        await expect(upvote(page, title)).toHaveAttribute('aria-pressed', 'false')

        await upvote(page, title).click()

        await expect(score(page, title)).toHaveText('1')
        await expect(upvote(page, title)).toHaveAttribute('aria-pressed', 'true')
        await expect
            .poll(() => voteEventsOnWire(id), { message: 'genau ein 45002 auf dem Draht', timeout: 10_000 })
            .toBe(1)
    })

    test('ein zweiter Upvote erzeugt kein zweites 45002 — er nimmt zurück statt zu verdoppeln', async ({ page }) => {
        // Die Zusage des Plans lautet „der sichtbare Zähler steigt nicht". Sie gilt, und
        // zwar schärfer als gefordert: der Klick schreibt keine zweite Stimme, er löscht
        // die erste. Beide Hälften stehen hier, weil nur zusammen sie „der Client hat
        // nichts Doppeltes geschrieben" von „die Anzeige faltet es weg" trennen — der
        // Relay hat für 45002 keine Dedup und hätte eine zweite Zeile behalten.
        const title = `E2E-Vote-Doppelt-${Date.now()}`
        const id = seedTopic(title)
        await openForum(page)

        await upvote(page, title).click()
        await expect(score(page, title)).toHaveText('1')
        await expect.poll(() => voteEventsOnWire(id), { timeout: 10_000 }).toBe(1)

        await upvote(page, title).click()

        // Nicht 2 — der Zähler steigt unter keinen Umständen.
        await expect(score(page, title)).not.toHaveText('2')
        await expect(score(page, title)).toHaveText('0')
        await expect
            .poll(() => voteEventsOnWire(id), {
                message: 'der zweite Klick darf kein zweites 45002 erzeugt haben',
                timeout: 10_000,
            })
            .toBe(0)
    })

    test('der Wechsel von Zustimmung auf Ablehnung bewegt den Punktstand um ZWEI', async ({ page }) => {
        const title = `E2E-Vote-Wechsel-${Date.now()}`
        const id = seedTopic(title)
        await openForum(page)

        await upvote(page, title).click()
        await expect(score(page, title)).toHaveText('1')
        // Auf die Draht-Bestätigung der ERSTEN Stimme warten, bevor die zweite kommt —
        // ohne das feuerte der Wechsel manchmal auf einen Ausgangszustand, dessen
        // `myVoteIds` der Relay noch nicht bestätigt hatte, und der Wechsel blieb aus
        // (Score klebte bei „1"). Gleiches Muster wie im bereits grünen
        // Rücknahme-Fall unten, der genau deshalb wartet.
        await expect.poll(() => voteEventsOnWire(id), { timeout: 10_000 }).toBe(1)

        // PRODUKTBEFUND, hier umschifft und im Bericht gemeldet (nicht behoben — außerhalb
        // des Mandats): `isLaterVote` (`forumModels.ts:142-143`) bricht Gleichstand bei
        // gleichem `created_at` über den EVENT-ID-Vergleich (`a.id < b.id`), einer
        // Grösse ohne Bezug zur tatsächlichen Reihenfolge. Landen Up- und Downvote in
        // DERSELBEN Unix-Sekunde, gewinnt zufällig (~50 %) die ÄLTERE Stimme, und der
        // Wechsel bleibt sichtbar aus — gemessen: 2 von 4 Läufen genau so. Dieselbe
        // Sekundengrenze umschifft bereits der Sortier-Fall unten in dieser Datei.
        await new Promise((resolve) => setTimeout(resolve, 1_100))

        await downvote(page, title).click()

        // 1 → −1. Naives Summieren ergäbe hier 0: die ältere Zustimmung wird nicht
        // gegengerechnet, sondern VERWORFEN (die jüngste Stimme je Pubkey gewinnt).
        await expect(score(page, title)).toHaveText('-1')
        await expect(upvote(page, title)).toHaveAttribute('aria-pressed', 'false')
        await expect(downvote(page, title)).toHaveAttribute('aria-pressed', 'true')

        // Und auf dem Draht liegen jetzt ZWEI Ereignisse — der Beleg dafür, dass die
        // Faltung eine Client-Leistung ist und keine Relay-Eigenschaft.
        await expect
            .poll(() => voteEventsOnWire(id), { timeout: 10_000 })
            .toBe(2)
    })

    test('ein Klick auf den gedrückten Pfeil NIMMT die Stimme zurück — Fläche und Draht', async ({ page }) => {
        const title = `E2E-Vote-Ruecknahme-${Date.now()}`
        const id = seedTopic(title)
        await openForum(page)

        await upvote(page, title).click()
        await expect(score(page, title)).toHaveText('1')
        await expect(upvote(page, title)).toHaveAttribute('aria-pressed', 'true')
        await expect.poll(() => voteEventsOnWire(id), { timeout: 10_000 }).toBe(1)

        // Derselbe Pfeil noch einmal: das ist die Rücknahme, nicht ein zweiter Upvote.
        await upvote(page, title).click()

        await expect(score(page, title)).toHaveText('0')
        await expect(upvote(page, title)).toHaveAttribute('aria-pressed', 'false')
        await expect(downvote(page, title)).toHaveAttribute('aria-pressed', 'false')

        // Und der Draht: die Requery findet die Stimme nicht mehr. Sie ist der einzige
        // Beleg, der zählt — `nak` druckt auch bei einer Ablehnung das signierte
        // Ereignis und endet mit 0, ein „success" allein sagt über die Wirkung nichts.
        await expect
            .poll(() => voteEventsOnWire(id), {
                message: 'nach der Rücknahme darf die Requery die Stimme nicht mehr liefern',
                timeout: 10_000,
            })
            .toBe(0)
    })

    test('nach Wechsel UND Rücknahme lebt die erste Stimme nicht wieder auf', async ({ page }) => {
        // Der Fall, für den die Rücknahme mehrere Grabsteine schreibt (einer je eigener
        // Stimme, weil Buzz genau ein Ziel je kind 5 nimmt). Würde nur die jüngste
        // gelöscht, gewänne die `+` von vorher — aus „zurückgenommen" würde „Meinung
        // geändert", und zwar auf einen Wert, den der Nutzer vor zwei Klicks verlassen hat.
        const title = `E2E-Vote-Wechsel-Ruecknahme-${Date.now()}`
        const id = seedTopic(title)
        await openForum(page)

        await upvote(page, title).click()
        await expect(score(page, title)).toHaveText('1')
        // Dieselbe Draht-Wartezeit wie im Wechsel-Fall oben, aus demselben Grund:
        // sonst feuert der Wechsel gegen `myVoteIds`, die der Relay noch nicht bestätigt
        // hatte, und die Anzeige klebt bei „1".
        await expect.poll(() => voteEventsOnWire(id), { timeout: 10_000 }).toBe(1)
        // Und dieselbe Sekundengrenze wie im Wechsel-Fall oben (Produktbefund zu
        // `isLaterVote`, dort ausführlich begründet).
        await new Promise((resolve) => setTimeout(resolve, 1_100))
        await downvote(page, title).click()
        await expect(score(page, title)).toHaveText('-1')
        await expect
            .poll(() => voteEventsOnWire(id), { message: 'zwei Stimmen liegen auf dem Draht', timeout: 10_000 })
            .toBe(2)

        await downvote(page, title).click()

        await expect(score(page, title)).toHaveText('0')
        await expect(upvote(page, title)).toHaveAttribute('aria-pressed', 'false')
        await expect(downvote(page, title)).toHaveAttribute('aria-pressed', 'false')
        await expect
            .poll(() => voteEventsOnWire(id), {
                message: 'BEIDE Stimmen müssen zurückgenommen sein, nicht nur die jüngste',
                timeout: 10_000,
            })
            .toBe(0)
    })

    test('die Ordnung ist umschaltbar: nach Punkten steht das bewertete Thema vor dem jüngeren', async ({ page }) => {
        const marke = Date.now()
        const alt = `E2E-Sortier-Alt-${marke}`
        const neu = `E2E-Sortier-Neu-${marke}`
        seedTopic(alt)
        // Zwei Themen in derselben Sekunde wären ein Gleichstand, den die id
        // entscheidet — hier soll die AKTIVITÄT entscheiden, also eine Sekunde Abstand.
        await new Promise((resolve) => setTimeout(resolve, 1_100))
        seedTopic(neu)
        await openForum(page)

        const stelle = async (titel: string): Promise<number> =>
            (await listOrder(page)).findIndex((label) => label.includes(titel))

        // Default: letzte Aktivität. Das jüngere Thema steht vor dem älteren.
        expect(await stelle(neu)).toBeLessThan(await stelle(alt))

        await upvote(page, alt).click()
        await expect(score(page, alt)).toHaveText('1')

        await page.locator('[data-forum-sortierung-wert="score"]').click()

        // Nach Punkten kehrt sich genau dieses Paar um. Relativ und nicht absolut
        // geprüft: im Forum liegen die Themen früherer Läufe, und eine Aussage über
        // Platz 1 wäre eine Aussage über deren Bewertungen.
        await expect
            .poll(async () => (await stelle(alt)) < (await stelle(neu)), {
                message: 'nach Punkten muss das bewertete Thema vor dem unbewerteten stehen',
                timeout: 10_000,
            })
            .toBe(true)

        // Zurück auf Aktivität — der Umschalter ist ein Umschalter, keine Einbahn.
        await page.locator('[data-forum-sortierung-wert="activity"]').click()
        await expect
            .poll(async () => (await stelle(neu)) < (await stelle(alt)), { timeout: 10_000 })
            .toBe(true)
    })

    test('LAYOUT: Bewertungsspalte und Sortier-Umschalter bei schmal (390) und Desktop (1440) — echte Zahlen', async ({
        page,
    }) => {
        // „Sichtbare UI ist erst fertig, wenn sie GEMESSEN wurde" (Nutzeransage
        // 2026-09-03). Echte Zahlen an zwei Breiten: Breite der Bewertungsspalte
        // (`w-11` = 2,75 rem = 44 px, `forum-vote.blade.php`), Lage des Umschalters
        // und waagerechter Überlauf des Dokuments — nicht nur, dass eine CSS-Klasse steht.
        const marke = Date.now()
        const alt = `E2E-Layout-Alt-${marke}`
        const neu = `E2E-Layout-Neu-${marke}`
        seedTopic(alt)
        await new Promise((resolve) => setTimeout(resolve, 1_100))
        seedTopic(neu)

        await useBuzz(page)
        await loginNsec(page, BUZZ_USER_NSEC)

        for (const width of [390, 1440]) {
            await page.setViewportSize({ width, height: 900 })
            await page.goto(`/rooms/${BUZZ_ROOM_FORUM}`)
            await expect(page.locator('ul[role="list"] > li').first(), 'die Themenliste des Forums').toBeVisible({
                timeout: 30_000,
            })

            // Kein waagerechter Bildlauf des Dokuments.
            const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth)
            expect(
                scrollWidth,
                `${width}px: waagerechter Überlauf des Dokuments (${scrollWidth}px)`,
            ).toBeLessThanOrEqual(width + 1)

            // Die Bewertungsspalte der neueren Zeile: 44 px, wie im Kopfkommentar der
            // Komponente gerechnet — nicht geschätzt, mit Toleranz für Sub-Pixel-Rundung.
            const spalte = row(page, neu).locator('[data-forum-vote-spalte]')
            const spalteBox = await spalte.boundingBox()
            expect(spalteBox, `${width}px: die Bewertungsspalte hat keine Geometrie`).not.toBeNull()
            const s = spalteBox as { x: number; width: number }
            expect(s.width, `${width}px: Bewertungsspalte ${Math.round(s.width)}px breit, erwartet ~44px`).toBeGreaterThanOrEqual(
                40,
            )
            expect(s.width, `${width}px: Bewertungsspalte ${Math.round(s.width)}px breit, erwartet ~44px`).toBeLessThanOrEqual(
                48,
            )
            expect(s.x, `${width}px: die Bewertungsspalte beginnt links ausserhalb`).toBeGreaterThanOrEqual(0)
            expect(s.x + s.width, `${width}px: die Bewertungsspalte ragt rechts heraus`).toBeLessThanOrEqual(width + 1)

            // Der Punktstand liegt INNERHALB der Spalte.
            const score = spalte.locator('[data-forum-score]')
            const scoreBox = await score.boundingBox()
            expect(scoreBox, `${width}px: der Punktstand hat keine Geometrie`).not.toBeNull()
            const sc = scoreBox as { x: number; width: number }
            expect(
                sc.x,
                `${width}px: der Punktstand steht links der Spalte`,
            ).toBeGreaterThanOrEqual(s.x - 1)
            expect(
                sc.x + sc.width,
                `${width}px: der Punktstand ragt rechts aus der Spalte`,
            ).toBeLessThanOrEqual(s.x + s.width + 1)

            // Der Sortier-Umschalter: sichtbar (zwei Themen liegen vor), rechts ausgerichtet
            // innerhalb des Viewports. `[data-forum-sortierung]` sitzt auf dem WRAPPER
            // (`class="flex justify-end pb-2"`), nicht auf `flux:radio.group` selbst — die
            // gemessene Höhe ist also 3,25 rem (52 px, `h-13!`) PLUS die 0,5 rem (8 px)
            // `pb-2` des Wrappers = 60 px. Gemessen, nicht die ursprünglich angenommenen
            // 52 px ohne Polster (Fehler des Specs — ein Wrapper-Attribut wurde für das
            // Kind-Element gehalten).
            const umschalter = page.locator('[data-forum-sortierung]')
            await expect(umschalter, `${width}px: der Sortier-Umschalter fehlt`).toBeVisible({ timeout: 10_000 })
            const uBox = await umschalter.boundingBox()
            expect(uBox, `${width}px: der Sortier-Umschalter hat keine Geometrie`).not.toBeNull()
            const u = uBox as { x: number; y: number; width: number; height: number }
            expect(u.height, `${width}px: Umschalter ${Math.round(u.height)}px hoch, erwartet ~60px`).toBeGreaterThanOrEqual(
                56,
            )
            expect(u.height, `${width}px: Umschalter ${Math.round(u.height)}px hoch, erwartet ~60px`).toBeLessThanOrEqual(
                64,
            )
            expect(u.x + u.width, `${width}px: der Umschalter ragt rechts heraus`).toBeLessThanOrEqual(width + 1)
        }
    })
})
