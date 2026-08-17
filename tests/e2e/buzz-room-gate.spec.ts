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

        // **Was hier NICHT geprüft wird, und warum es trotzdem hier steht.**
        // Der Composer bleibt nach einem FREMD-Rauswurf stehen — am Teststack
        // gemessen (2026-08-17), reproduzierbar. Das ist die sichtbare Seite eines
        // bereits offenen Befundes: `joined` wird nur nach dem EIGENEN Join/Leave
        // nachgeladen, ein Rauswurf durch einen Admin erreicht die Insel nie. Der
        // Nutzer sieht also das Gate UND ein Eingabefeld, dessen Absenden am Relay
        // scheitern wird.
        //
        // Bewusst keine Zusicherung daraus gemacht: ein `expect(...).toBeHidden()`
        // wäre heute rot und beschriebe eine Absicht, die niemand gebaut hat —
        // dieser Test würde damit von seiner eigenen Aussage ablenken. Der Befund
        // gehört an die Stelle, an der die Mitgliedschaft nachgeführt wird, nicht
        // an die Sichtbarkeitsregel des Composers.

        // Aufräumen: sonst wächst der Kanalbestand je Lauf, und der Bloat-Wächter
        // in `buzz-testserver.sh` reißt irgendwann den ganzen Stack neu auf.
        asOwner(['-k', '9008', '-t', `h=${h}`])
    })
})
