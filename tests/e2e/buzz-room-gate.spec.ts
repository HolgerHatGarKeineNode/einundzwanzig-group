import { test, expect, type Page } from './support/fixtures'
import { useBuzz, BUZZ_PORT, BUZZ_OWNER_SEC_HEX, BUZZ_ROOM_WELCOME } from './support/buzz'
import { loginNsec } from './support/login'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { nsecEncode } from 'nostr-tools/nip19'

/**
 * P6 — das **Gate** der Raumfläche an den beiden Lagen, die es unterscheiden muss.
 *
 * Der Dateiname ist Teil der Mechanik: `playwright.config.ts` fährt im
 * Buzz-Modus nur `buzz-*.spec.ts` (und `pin-room`) und überspringt alles andere
 * LAUTLOS („Total: 0 tests", kein Fehler).
 *
 * Beide Fälle hier sind mit `nak` allein nicht zu haben: geprüft wird nicht, was
 * der Relay sagt (das steht als reine Zuordnung in `roomGate.test.ts`), sondern
 * was die FLÄCHE daraus macht — ein Beitreten-Knopf, ein Gate, oder keines von
 * beidem.
 *
 * ── Fall 1: der Deckel darf legitime Wiederholung nicht treffen ──────────────
 * `_gateRelistens` deckelt, wie oft die Raum-Sub nach
 * `restricted: channel access revoked` neu aufgesetzt wird. Der Deckel ist gegen
 * eine Schleife gedacht (Relay schließt die frische Sub sofort wieder mit
 * demselben Grund). Jeder AUSTRITT erzeugt aber ebenfalls genau diesen Grund —
 * und genullt wurde der Zähler bis P6 nur beim Betreten eines ANDEREN Raums.
 * Wer denselben offenen Raum viermal verließ und wiederbetrat, ohne die Ansicht
 * zu wechseln, lief deshalb beim vierten Austritt ins Gate.
 *
 * ── Fall 2: die teure Richtung ──────────────────────────────────────────────
 * Nach einem Rauswurf aus einem PRIVATEN Raum darf **kein** Beitreten-Knopf
 * stehen: ein `join()` von dort führt nachweislich ins Leere (der Relay lehnt
 * den Lesezugriff bereits ab). Bis P6 war dieser Fall nur durch eine inzwischen
 * gelöschte Browser-Sonde belegt.
 */

const NAK = process.env.NAK ?? `${process.env.HOME}/go/bin/nak`
const WS = (): string => `ws://localhost:${BUZZ_PORT}`

const nak = (args: string[]): string => {
    const res = spawnSync(NAK, args, { encoding: 'utf8', timeout: 30_000 })

    return `${res.stdout ?? ''}\n${res.stderr ?? ''}`
}

/** Ereignis als Relay-Eigentümer schicken — der einzige Schlüssel mit Admin-Rechten. */
const asOwner = (args: string[]): string => nak(['event', '--auth', '--sec', BUZZ_OWNER_SEC_HEX, ...args, WS()])

/**
 * Ein frischer Wegwerf-Schlüssel MIT Relay-Mitgliedschaft.
 *
 * Ohne das 9030 darf der Schlüssel gar nichts — AUTH selbst wird dann mit
 * `restricted: not a relay member` abgelehnt, und die Fläche zeigte das
 * Relay-Gate aus einem ganz anderen Grund als dem, den dieser Test misst.
 */
const freshMember = (): { nsec: string; pub: string } => {
    const sk = generateSecretKey()
    const pub = getPublicKey(sk)
    expect(
        asOwner(['-k', '9030', '-t', `p=${pub}`, '-t', 'role=member']),
        'Relay-Mitgliedschaft für den Wegwerf-Schlüssel konnte nicht gesetzt werden',
    ).toContain('success')

    return { nsec: nsecEncode(sk), pub }
}

const gate = (page: Page) => page.getByTestId('room-gate-restricted')
const joinButton = (page: Page) => page.getByRole('button', { name: 'Beitreten' })
const composer = (page: Page) => page.getByPlaceholder('Nachricht schreiben…')

test.describe('Buzz-Workspace: das Raum-Gate (E2E, nur E2E_RELAY=buzz)', () => {
    test.skip(process.env.E2E_RELAY !== 'buzz', 'nur im Buzz-Modus (E2E_RELAY=buzz) relevant')

    /**
     * **Fall 1 — viermal verlassen und wiederbetreten, ohne die Ansicht zu wechseln.**
     *
     * Vier Runden, nicht drei: der Deckel steht bei drei Wiederaufsetzern, der
     * Fehler schlug also erst im vierten Austritt zu. Ein Test mit drei Runden
     * wäre auch ohne den Fix grün gewesen.
     *
     * Gemessen wird nach JEDER Runde, nicht nur am Ende — sonst stünde am Ende
     * nur „irgendwo dazwischen ist es gekippt", und die Runde, in der es kippt,
     * ist genau die Aussage.
     */
    test('derselbe offene Raum: viermal verlassen und wiederbetreten, ohne Gate', async ({ page }) => {
        const { nsec } = freshMember()

        await useBuzz(page)
        await loginNsec(page, nsec)
        await page.goto(`/rooms/${BUZZ_ROOM_WELCOME}`)

        // Vorbedingung: frischer Schlüssel, also noch kein Raum-Mitglied — und der
        // Raum ist offen, das Gate darf hier von Anfang an nicht stehen.
        await expect(joinButton(page), 'frischer Schlüssel muss erst beitreten müssen').toBeVisible({ timeout: 30_000 })
        await expect(gate(page)).toHaveCount(0)

        for (let runde = 1; runde <= 4; runde++) {
            await joinButton(page).click()
            await expect(composer(page), `Runde ${runde}: Composer nach dem Beitreten`).toBeVisible({ timeout: 30_000 })

            await page.getByRole('button', { name: 'Raum verlassen' }).click()
            await expect(composer(page), `Runde ${runde}: Composer nach dem Verlassen`).toBeHidden({ timeout: 30_000 })

            // DIE ZUSAGE: der Weg zurück steht noch offen. Ohne das Zurücksetzen des
            // Wiederaufsetz-Budgets steht hier ab der vierten Runde das Gate — für
            // einen Raum, der die ganze Zeit offen war.
            await expect(gate(page), `Runde ${runde}: kein Gate an einem offenen Raum`).toHaveCount(0)
            await expect(joinButton(page), `Runde ${runde}: der Beitreten-Knopf ist zurück`).toBeVisible({
                timeout: 30_000,
            })
        }
    })

    /**
     * **Fall 1b — der Vordergrund-Resync gibt das Budget ebenfalls frei.**
     *
     * `resync()` baut eine neue Sub-Generation auf (alter Controller abgebrochen,
     * frischer `listenRoom`). Das Wiederaufsetz-Budget gehört zu genau einer
     * solchen Generation, nicht zur Lebenszeit der Insel — sonst stünde ein Nutzer,
     * der die App tagelang offen hält, irgendwann mit aufgebrauchtem Budget da.
     *
     * **Warum dieser Test in den Zustand hineinschaut** statt an der Fläche zu
     * messen: an der Fläche wird der Unterschied erst sichtbar, wenn das Budget
     * ERSCHÖPFT ist — und dorthin kommt man ohne Nutzeraktion nur über
     * Fremd-Rauswürfe, deren Anzahl je Runde vom Relay abhängt (ob auch ein
     * Wieder-Hinzufügen die Subs abräumt, ist ungemessen). Ein Test, der drei
     * Rundenlängen raten muss, misst am Ende die Rateannahme. Der Zähler selbst ist
     * dagegen eindeutig: vor dem Resync steht er auf 1, danach auf 0.
     *
     * Der Vordergrund wird echt ausgelöst — über `visibilitychange` und die
     * 2-Sekunden-Schwelle, die die Insel selbst verlangt. Ein direkter Aufruf von
     * `resync()` ließe offen, ob der Weg dorthin überhaupt noch existiert.
     */
    test('ein Vordergrund-Resync gibt das Wiederaufsetz-Budget frei', async ({ page }) => {
        const { nsec } = freshMember()

        await useBuzz(page)
        await loginNsec(page, nsec)
        await page.goto(`/rooms/${BUZZ_ROOM_WELCOME}`)

        await expect(joinButton(page)).toBeVisible({ timeout: 30_000 })
        await joinButton(page).click()
        await expect(composer(page)).toBeVisible({ timeout: 30_000 })

        // Ein Austritt = genau ein `channel access revoked` = ein verbrauchter
        // Wiederaufsetzer.
        await page.getByRole('button', { name: 'Raum verlassen' }).click()
        await expect(composer(page)).toBeHidden({ timeout: 30_000 })

        const gelesen = () =>
            page.evaluate(() => {
                const el = document.querySelector('[x-data^="nostrRoomChat"]') as
                    (HTMLElement & { _x_dataStack?: { _gateRelistens?: number }[] }) | null

                return el?._x_dataStack?.[0]?._gateRelistens ?? -1
            })

        // Vorbedingung — ohne sie prüfte der Test hinterher eine Null, die nie
        // etwas anderes war.
        await expect.poll(gelesen, { timeout: 30_000 }).toBeGreaterThan(0)

        // App in den Hintergrund und zurück. Die Insel verlangt mehr als zwei
        // Sekunden Abwesenheit (ein kurzer Tab-Blick soll nichts auslösen).
        await page.evaluate(() => {
            Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
            document.dispatchEvent(new Event('visibilitychange'))
        })
        await page.waitForTimeout(2_500)
        await page.evaluate(() => {
            Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
            document.dispatchEvent(new Event('visibilitychange'))
        })

        await expect.poll(gelesen, { timeout: 30_000 }).toBe(0)
        // Und die Fläche steht unverändert da: der Resync ist kein Neuaufbau.
        await expect(gate(page)).toHaveCount(0)
        await expect(joinButton(page)).toBeVisible()
    })

    /**
     * **Fall 2 — Rauswurf aus einem PRIVATEN Raum: kein Beitreten-Knopf.**
     *
     * Der Ablauf ist der eines echten Rauswurfs, nicht der eines Austritts: der
     * Eigentümer entfernt den Nutzer per kind 9001. Der Relay räumt daraufhin die
     * Subs dieses Raums mit `restricted: channel access revoked` ab — dem Grund,
     * der KEIN Zugriffsurteil ist. Erst die Antwort auf die frisch aufgesetzte Sub
     * entscheidet, und bei einem privaten Raum ist das
     * `restricted: not a channel member` → Gate.
     *
     * Geprüft wird beides: dass das Gate steht UND dass kein Beitreten-Knopf
     * danebensteht. Die zweite Hälfte ist die teure — ein Knopf, dessen `join()`
     * am Relay scheitert, schickt den Nutzer in eine Sackgasse mit Fehlermeldung.
     */
    test('Rauswurf aus einem privaten Raum: Gate statt Beitreten-Knopf', async ({ page }) => {
        const { nsec, pub } = freshMember()
        const h = randomUUID()

        // Privater Raum des Eigentümers. `visibility=private` ist die Stellschraube:
        // ohne sie wäre der Raum nach dem Rauswurf weiter lesbar, und der Test
        // prüfte die andere Lage.
        expect(
            asOwner(['-k', '9007', '-t', `h=${h}`, '-t', 'name=E2E-Privatraum', '-t', 'visibility=private']),
            'privater Testraum konnte nicht angelegt werden',
        ).toContain('success')
        expect(
            asOwner(['-k', '9000', '-t', `h=${h}`, '-t', `p=${pub}`]),
            'Raum-Mitgliedschaft konnte nicht gesetzt werden',
        ).toContain('success')

        await useBuzz(page)
        await loginNsec(page, nsec)
        await page.goto(`/rooms/${h}`)

        // Vorbedingung, und sie ist die halbe Miete: der Nutzer ist DRIN. Ohne diese
        // Prüfung wäre der Test auch dann grün, wenn er nie Zugriff gehabt hätte.
        await expect(composer(page), 'Mitglied des privaten Raums muss schreiben können').toBeVisible({
            timeout: 30_000,
        })
        await expect(gate(page)).toHaveCount(0)

        // Der Rauswurf — von außen, durch den Eigentümer.
        expect(asOwner(['-k', '9001', '-t', `h=${h}`, '-t', `p=${pub}`]), 'Rauswurf abgelehnt').toContain('success')

        await expect(gate(page), 'nach dem Rauswurf gehört das Gate an die Fläche').toBeVisible({ timeout: 30_000 })
        // Die eigentliche Zusage dieses Tests.
        await expect(joinButton(page), 'ein Beitreten-Knopf führte von hier ins Leere').toHaveCount(0)

        // **P9 — hier stand bis zum 2026-08-17 eine BEOBACHTUNG, jetzt steht eine
        // Zusicherung.** Der Composer blieb nach einem Fremd-Rauswurf stehen: die
        // 39002 wurde nur nach dem EIGENEN Join/Leave nachgeladen, ein Rauswurf
        // durch einen Admin erreichte die Insel nie, und `joined` stand stale auf
        // `true`. Der Nutzer sah das Gate UND ein Eingabefeld, dessen Absenden am
        // Relay scheitert.
        //
        // Warum der Fall so teuer ist: Im PRIVATEN Raum gibt es nichts nachzuladen.
        // Gemessen am Teststack liefert das REQ `{kinds:[39002],"#d":[h]}` nach dem
        // Rauswurf `EOSE` und **0 Events** — es gibt keine „neue Liste ohne mich",
        // an der sich `joined` korrigieren ließe, nur Schweigen. Die alte Liste
        // liegt zudem in der IndexedDB. Deshalb ist der Entzug selbst die Nachricht
        // (`groups.ts revokeRoomMembership`), und die sichere Annahme bei
        // unbestätigter Mitgliedschaft ist „kein Mitglied".
        await expect(
            composer(page),
            'nach dem Rauswurf darf kein Eingabefeld stehen, dessen Absenden am Relay scheitert',
        ).toBeHidden({ timeout: 30_000 })

        // Aufräumen: sonst wächst der Kanalbestand je Lauf, und der Bloat-Wächter
        // in `buzz-testserver.sh` reißt irgendwann den ganzen Stack neu auf.
        asOwner(['-k', '9008', '-t', `h=${h}`])
    })

    /**
     * **Fall 3 — Fremd-Rauswurf aus einem OFFENEN Raum: Composer weg, Weg zurück da.**
     *
     * Die Gegenprobe zu Fall 2, und sie ist der eigentliche Riegel gegen eine
     * bequeme Fehllösung: Wer die Mitgliedschaft nach einem Entzug einfach dauerhaft
     * verwirft, bekommt Fall 2 grün — und sperrt dabei jeden aus, der legitim wieder
     * hineindarf. Hier ist der Raum offen, der Nutzer ist nach dem Rauswurf also
     * schlicht kein Raum-Mitglied mehr: kein Gate, kein Composer, aber der
     * Beitreten-Knopf. Und ein Klick darauf muss den Composer zurückbringen.
     *
     * Gemessen (2026-08-17, Buzz-Teststack): Der Relay schickt auch hier genau eine
     * Zeile von selbst — `CLOSED restricted: channel access revoked`, 11 ms nach dem
     * 9001. Über die laufende Sub `{kinds:[39002],limit:0}` kam in 10 s **nichts**;
     * ein aktives REQ lieferte dagegen +202 ms die neue Liste ohne den eigenen
     * Pubkey.
     */
    test('Rauswurf aus einem offenen Raum: kein Composer, aber der Weg zurück', async ({ page }) => {
        const { nsec, pub } = freshMember()
        const h = randomUUID()

        // Offener Raum (keine `visibility=private`): nach dem Rauswurf bleibt er
        // lesbar — genau der Unterschied zu Fall 2.
        expect(
            asOwner(['-k', '9007', '-t', `h=${h}`, '-t', 'name=E2E-Offenraum']),
            'offener Testraum konnte nicht angelegt werden',
        ).toContain('success')
        expect(
            asOwner(['-k', '9000', '-t', `h=${h}`, '-t', `p=${pub}`]),
            'Raum-Mitgliedschaft konnte nicht gesetzt werden',
        ).toContain('success')

        await useBuzz(page)
        await loginNsec(page, nsec)
        await page.goto(`/rooms/${h}`)

        await expect(composer(page), 'Mitglied des offenen Raums muss schreiben können').toBeVisible({
            timeout: 30_000,
        })

        expect(asOwner(['-k', '9001', '-t', `h=${h}`, '-t', `p=${pub}`]), 'Rauswurf abgelehnt').toContain('success')

        await expect(composer(page), 'nach dem Rauswurf ist der Nutzer kein Raum-Mitglied mehr').toBeHidden({
            timeout: 30_000,
        })
        await expect(gate(page), 'ein offener Raum bleibt lesbar — kein Gate').toHaveCount(0)

        // Die zweite Hälfte der Zusage: die Nachführung sperrt nicht dauerhaft aus.
        await expect(joinButton(page), 'der Weg zurück in einen offenen Raum').toBeVisible({ timeout: 30_000 })
        await joinButton(page).click()
        await expect(composer(page), 'nach dem Wiederbeitritt schreibt der Nutzer wieder').toBeVisible({
            timeout: 30_000,
        })

        asOwner(['-k', '9008', '-t', `h=${h}`])
    })

    /**
     * **Fall 4 (N8) — der Raum kippt offen→privat, das KANALMITGLIED behält alles.**
     *
     * Für ein Kanalmitglied ändert `open → private` nichts: es war drin, es bleibt
     * drin. Die Gefahr liegt allein bei uns — der Relay benutzt beim Umschalten
     * denselben Grund wie beim Fremd-Rauswurf (`restricted: channel access
     * revoked`), und P9 lässt jede `restricted:`-Ablehnung die eigene Mitgliedschaft
     * auf *unbestätigt* setzen. Träfe dieses Signal auch das Mitglied, verschwände
     * der Composer bei jemandem, der weiterhin schreiben darf — die teure
     * Fehlerrichtung, nur spiegelverkehrt zu N3.
     *
     * **Am laufenden Relay gemessen (2026-08-18, Wegwerf-Stack `buzz-test:3021`),
     * und die Messung ist der Grund, warum dieser Test so aussieht:** Buzz räumt
     * beim Umschalten NUR die Subs von Nicht-Mitgliedern ab
     * (`side_effects.rs::evict_non_member_channel_subscriptions`, aufgerufen aus
     * dem `visibility`-Arm von `handle_edit_metadata` genau bei `was_open && val ==
     * "private"`). Zwei Verbindungen auf demselben Kanal, dasselbe REQ:
     *
     * | Verbindung | nach dem 9002 | frisches REQ danach |
     * |---|---|---|
     * | Kanalmitglied  | **nichts** (Sub läuft weiter) | `EOSE` — weiter lesbar |
     * | Nichtmitglied  | `CLOSED restricted: channel access revoked` (+7 ms) | `CLOSED restricted: not a channel member` |
     *
     * Der Test hält also fest, dass wir aus einem Signal, das gar nicht kommt,
     * auch nichts ableiten — und dass die Fläche nicht auf anderem Weg (neue
     * 39002: der Relay stellt beim Umschalten eine mit gleichem Inhalt und neuem
     * `created_at` aus) den Composer verliert. Ohne den Sendeversuch am Ende wäre
     * das nur „sichtbar"; mit ihm ist es „benutzbar".
     */
    test('offen→privat: das Kanalmitglied behält Composer und Schreibrecht', async ({ page }) => {
        const { nsec, pub } = freshMember()
        const h = randomUUID()

        expect(
            asOwner(['-k', '9007', '-t', `h=${h}`, '-t', 'name=E2E-Kipp-Mitglied']),
            'offener Testraum konnte nicht angelegt werden',
        ).toContain('success')
        // KANAL-Mitgliedschaft (9000), nicht bloß Relay-Mitgliedschaft (9030) — nur
        // sie überlebt das Umschalten auf privat.
        expect(
            asOwner(['-k', '9000', '-t', `h=${h}`, '-t', `p=${pub}`, '-t', 'role=member']),
            'Raum-Mitgliedschaft konnte nicht gesetzt werden',
        ).toContain('success')

        await useBuzz(page)
        await loginNsec(page, nsec)
        await page.goto(`/rooms/${h}`)

        await expect(composer(page), 'Vorbedingung: das Mitglied schreibt im offenen Raum').toBeVisible({
            timeout: 30_000,
        })

        // Das Umschalten — von außen, durch den Eigentümer.
        expect(
            asOwner(['-k', '9002', '-t', `h=${h}`, '-t', 'visibility=private']),
            'Umschalten auf privat abgelehnt',
        ).toContain('success')

        // Fenster für das Signal, das nicht kommen darf: gemessen liegt das `CLOSED`
        // an die Nicht-Mitglieder 7 ms hinter dem `OK` des 9002. Drei Sekunden sind
        // dagegen großzügig, und ohne diese Wartezeit wäre der Test auch dann grün,
        // wenn die Fläche eine Sekunde später zusammenklappt.
        await page.waitForTimeout(3_000)

        await expect(gate(page), 'ein Kanalmitglied gehört nicht hinter das Gate').toHaveCount(0)
        await expect(composer(page), 'DIE ZUSAGE: der Composer bleibt beim Kanalmitglied').toBeVisible()

        // Und er ist nicht nur da, er trägt: der Relay nimmt die Nachricht an und
        // die eigene, weiterlaufende Sub spielt sie zurück.
        const text = `N8-KIPP-${Date.now()}`
        await composer(page).fill(text)
        await page.getByRole('button', { name: 'Senden' }).click()
        await expect(
            page.getByText(text, { exact: true }),
            'nach dem Umschalten muss das Mitglied weiter senden können',
        ).toBeVisible({ timeout: 30_000 })

        asOwner(['-k', '9008', '-t', `h=${h}`])
    })

    /**
     * **Fall 5 (N8) — derselbe Umschalter, aber aus der Sicht des NICHTMITGLIEDS.**
     *
     * Die Gegenrichtung, und ohne sie wäre Fall 4 mit einer Fläche zu erfüllen, die
     * auf gar nichts mehr reagiert: Wer den offenen Raum bisher nur LESEN durfte
     * (Relay-Mitglied per 9030, nie beigetreten), muss ihn **sofort** verlieren —
     * ohne Reload, denn genau dafür gibt es die Auswertung des `CLOSED`.
     *
     * Gemessen kommen dabei ZWEI Ablehnungen nacheinander, und beide werden
     * gebraucht: das `CLOSED restricted: channel access revoked` sagt nur „die
     * Mitgliedschaftslage hat sich geändert" (kein Zugriffsurteil, `roomGate.ts`),
     * woraufhin die Insel dieselbe Sub neu aufsetzt; erst deren Antwort
     * `CLOSED restricted: not a channel member` ist das Urteil und setzt das Gate.
     *
     * Der Beitreten-Knopf muss dabei verschwinden: ein 9021 in einen privaten Kanal
     * lehnt Buzz mit `restricted: channel is private` ab — der Knopf führte ins
     * Leere. Dieselbe Zusage wie in Fall 2, nur über einen anderen Weg erreicht.
     */
    test('offen→privat: das Nichtmitglied verliert den Raum sofort', async ({ page }) => {
        const { nsec } = freshMember()
        const h = randomUUID()

        expect(
            asOwner(['-k', '9007', '-t', `h=${h}`, '-t', 'name=E2E-Kipp-Fremd']),
            'offener Testraum konnte nicht angelegt werden',
        ).toContain('success')

        await useBuzz(page)
        await loginNsec(page, nsec)
        await page.goto(`/rooms/${h}`)

        // Vorbedingung: offener Raum, also lesbar und mit Weg hinein — und genau das
        // ist gleich weg. Ohne diese Prüfung wäre der Test auch dann grün, wenn der
        // Nutzer nie Zugriff gehabt hätte.
        await expect(joinButton(page), 'Vorbedingung: der offene Raum steht dem Nichtmitglied offen').toBeVisible({
            timeout: 30_000,
        })
        await expect(gate(page)).toHaveCount(0)

        expect(
            asOwner(['-k', '9002', '-t', `h=${h}`, '-t', 'visibility=private']),
            'Umschalten auf privat abgelehnt',
        ).toContain('success')

        // DIE ZUSAGE: ohne Reload, allein aus den beiden `CLOSED`-Zeilen.
        await expect(gate(page), 'nach dem Umschalten gehört das Gate an die Fläche').toBeVisible({ timeout: 30_000 })
        await expect(joinButton(page), 'ein Beitreten-Knopf führte hier ins Leere').toHaveCount(0)
        await expect(composer(page), 'und erst recht kein Eingabefeld').toBeHidden()

        asOwner(['-k', '9008', '-t', `h=${h}`])
    })
})
