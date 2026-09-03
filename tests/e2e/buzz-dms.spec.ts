import { test, expect, type Page } from './support/fixtures'
import { useBuzz, BUZZ_PORT, BUZZ_USER_NSEC, BUZZ_OWNER_SEC_HEX } from './support/buzz'
import { loginNsec } from './support/login'
import { spawnSync } from 'node:child_process'
import { getPublicKey } from 'nostr-tools/pure'

/**
 * P7 — **Buzz-DM-Kanäle (41010/41011/41012)** an der echten Fläche, gegen einen echten
 * Buzz-Relay.
 *
 * ── DIESER SPEC IST NIE GELAUFEN. KALIBRIERE IHN BEIM ERSTEN LAUF. ─────────────
 *
 * Geschrieben am 2026-09-04 unter der ausdrücklichen Vorgabe, Playwright nicht zu
 * starten; die Läufe dieses Plans werden gesammelt und einmal am Ende gefahren. Alles
 * hier ist deshalb **eine ungeprüfte Behauptung** — jeder Selektor und jede Frist ist von
 * Nachbar-Specs abgelesen, nicht gemessen. Wer den Sammellauf fährt, tut zweierlei,
 * bevor er einem Grün glaubt:
 *
 *  1. **Absichtlich rot machen, am PRODUKT und nicht an einer Testzeile.** Drei Griffe,
 *     die je einen anderen Fall hier umwerfen müssen:
 *     · in `js/dmModels.ts` `planDmOpen` den `mayWriteKind`-Riegel entfernen → Fall 1
 *       bleibt grün (der Space IST Buzz), aber die Unit-Ebene wird rot; der richtige
 *       Griff für Fall 1 ist, in `planDmOpen` die `p`-Tags leer zu lassen;
 *     · in `js/rail.ts` `toRailDms` den `hidden`-Filter herausnehmen → Fall 2 wird rot;
 *     · in `js/dms.ts` `run()` `parseDmResponse(outcome.detail)` durch `null` ersetzen →
 *       Fall 1 wird rot, denn dann kennt der Client die `channel_id` nicht mehr.
 *  2. **Die Skip-Zahl lesen.** Meldet die Datei `skipped` statt `passed`, ist der
 *     Buzz-Zweig nicht gelaufen und hier wurde nichts gemessen.
 *
 * ── Zwei Mechaniken, die den Zuschnitt bestimmen ──────────────────────────────
 *
 * 1. **Der Dateiname.** `playwright.config.ts:66` filtert im Buzz-Modus auf
 *    `/(?:buzz-.*|pin-room|relay-guard|relay-praevention)\.spec\.ts$/` und überspringt
 *    alles andere LAUTLOS. 41010–41012 sind Buzz-Dialekt und `mayWriteKind` schließt die
 *    Fläche auf zooid — auf dem zooid-Zweig wären diese Fälle nicht rot, sondern sinnlos.
 *    Daher zusätzlich das `test.skip`.
 * 2. **Der Viewport.** Im Buzz-Modus fährt nur das Projekt `chromium`, gepinnt auf
 *    **1279 px** — einen Pixel unter dem `xl`-Breakpoint, ab dem die Rail überhaupt
 *    existiert (`<template x-if="$store.viewport?.desktop">`). Die DM-Gruppe lebt in der
 *    Rail, also setzt jeder Fall hier seinen Viewport selbst, vor dem ersten `goto` —
 *    dieselbe Ausnahme, die `buzz-rail-forge.spec.ts` schon nutzt.
 *
 * ══ Was hier steht und was die Unit-Ebene trägt ══════════════════════════════
 *
 * Die Regeln — Kommandokörper, Riegel, Antwort-Parser, Faltung der ausgeblendeten
 * Unterhaltungen, Titelbildung — prüft `js/dmModels.test.ts` ohne Docker (35 Fälle).
 * Hier steht nur, was ohne echten Roundtrip nicht prüfbar ist:
 *
 *  - dass der Relay auf ein 41010 mit `response:{"channel_id":…}` im **OK-Frame**
 *    antwortet und nicht mit einem Ereignis, und dass genau diese `channel_id` die Zeile
 *    in der Rail wird (Fall 1, am Draht mitgelesen);
 *  - dass ein 41012 die Zeile aus der Spalte nimmt, **ohne** die Unterhaltung zu löschen
 *    (Fall 2, mit `nak req` als unabhängigem Messgerät);
 *  - dass die neue Fläche bei 390 und 1440 px echte Maße hat (Fall 3).
 *
 * ── Was der Lauf hinterlässt ──────────────────────────────────────────────────
 *
 * Einen DM-Kanal je Lauf, dauerhaft. `open_dm` ist teilnehmerhash-idempotent: derselbe
 * Teilnehmersatz liefert beim zweiten Lauf denselben Kanal mit `created: false` statt
 * eines zweiten. Die Fälle hier benutzen **immer dieselben zwei Schlüssel** (Test-User
 * und Owner des Seeds) und legen deshalb über alle Läufe hinweg genau EINE Unterhaltung
 * an — im Gegensatz zu Räumen mit Zeitstempel im Namen, die sich ansammeln. Fall 2
 * blendet sie aus und Fall 1 öffnet sie wieder (`open_dm` räumt `hidden_at` des
 * Aufrufers), die Reihenfolge der Fälle innerhalb der Datei ist also nicht kritisch.
 */

const NAK = process.env.NAK ?? `${process.env.HOME}/go/bin/nak`
const WS = (): string => `ws://localhost:${BUZZ_PORT}`

const nak = (args: string[]): string => {
    const res = spawnSync(NAK, args, { encoding: 'utf8', timeout: 30_000 })

    return `${res.stdout ?? ''}\n${res.stderr ?? ''}`
}

/** Der zweite, wirklich andere Pubkey: der Owner des Seed-Stacks. */
const OWNER_PUB = getPublicKey(Uint8Array.from(Buffer.from(BUZZ_OWNER_SEC_HEX, 'hex')))

/** Ein UUID, wie ihn `Uuid::new_v4()` erzeugt — die Form der Kanal-Id. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Die `channel_id` aus einem `OK`-Frame des Relays, oder `''`. */
const channelIdFromOk = (payload: string): string => {
    try {
        const parsed = JSON.parse(payload) as unknown[]
        if (!Array.isArray(parsed) || parsed[0] !== 'OK' || parsed[2] !== true) {
            return ''
        }
        const message = String(parsed[3] ?? '')
        if (!message.startsWith('response:')) {
            return ''
        }
        const body = JSON.parse(message.slice('response:'.length)) as { channel_id?: unknown }

        return typeof body.channel_id === 'string' ? body.channel_id : ''
    } catch {
        return ''
    }
}

/**
 * Alle `channel_id`, die der Relay in einem `OK`-Frame genannt hat.
 *
 * **Am Draht mitgelesen und nicht im Code-Pfad.** Die Zusage dieser Phase ist, dass die
 * Kanal-Id aus dem OK-MESSAGE-FELD kommt — ein Wert, den die Insel selbst berichtet,
 * bewiese das nicht: er könnte ebenso gut aus einem nachgeladenen 39000 stammen.
 * `framereceived` sieht genau das Frame, um das es geht.
 */
const watchOkChannelIds = (page: Page): string[] => {
    const ids: string[] = []
    page.on('websocket', (ws) => {
        ws.on('framereceived', (frame: { payload: string | Buffer }) => {
            const id = channelIdFromOk(String(frame.payload))
            if (id) {
                ids.push(id)
            }
        })
    })

    return ids
}

/**
 * Die DM-Sektion der Rail — über ihren Kopftext, wie `buzz-rail-forge` es tut.
 *
 * **Kleinschreibung, obwohl der Kopf GROSS aussieht.** `uppercase` ist eine CSS-Regel;
 * Playwright vergleicht gegen `textContent`, und dort steht der Blade-Wortlaut. Der
 * gleiche Stolperstein wie in `desktop-rail-groups.spec.ts`, das mit „Meetups" sucht.
 */
const dmSection = (page: Page) =>
    page.locator('[data-rail] section').filter({ hasText: 'Direktnachrichten' }).first()

/** Öffnet den Dialog und wählt den Owner als Gegenüber. */
const pickOwner = async (page: Page): Promise<void> => {
    await dmSection(page).getByRole('button', { name: 'Neue Unterhaltung' }).click()
    const feld = page.getByLabel('Person')
    await expect(feld).toBeVisible({ timeout: 15_000 })
    // Der öffentliche Schlüssel statt eines Namens: der Fall soll nicht daran hängen, ob
    // das Space-Verzeichnis (13534/33534) rechtzeitig geladen ist — das ist eine andere
    // Zusage und gehört nicht in diesen Fall.
    await feld.fill(OWNER_PUB)
    await feld.press('Enter')
}

test.describe('Buzz: Direktnachrichten (E2E, nur E2E_RELAY=buzz)', () => {
    test.skip(process.env.E2E_RELAY !== 'buzz', 'nur im Buzz-Modus (E2E_RELAY=buzz) relevant')

    test('41010 eröffnet eine Unterhaltung, die channel_id kommt aus dem OK-Frame, und die Zeile steht in der Rail', async ({
        page,
    }) => {
        const okIds = watchOkChannelIds(page)
        await page.setViewportSize({ width: 1440, height: 900 })
        await useBuzz(page)
        await loginNsec(page, BUZZ_USER_NSEC)
        await page.goto('/')

        const sektion = dmSection(page)
        await expect(sektion, 'die DM-Gruppe fehlt in der Rail').toBeVisible({ timeout: 30_000 })

        // Gegenprobe VOR der Handlung: der Relay darf die Zeile nicht schon geliefert
        // haben, sonst bewiese das Grün danach nichts über das Kommando.
        const zeilenVorher = await sektion.getByRole('button').count()

        await pickOwner(page)
        await page.getByRole('button', { name: 'Unterhaltung eröffnen' }).click()

        // 1. Der Relay hat im OK-Frame eine Kanal-Id genannt.
        await expect
            .poll(() => okIds.length, {
                message: 'kein OK-Frame mit `response:{"channel_id":…}` — das Kommando wurde nicht ausgeführt',
                timeout: 30_000,
            })
            .toBeGreaterThan(0)
        const channelId = okIds[okIds.length - 1]
        expect(channelId, `die genannte Kanal-Id ist keine UUID: ${channelId}`).toMatch(UUID)

        // 2. GENAU DIESE Id ist die Zeile in der Rail. Der Wert kommt aus dem Frame, nicht
        //    aus der Insel — deshalb ist das eine Zusage über den OK-Weg und nicht nur
        //    über „irgendeine Unterhaltung erschien".
        await expect
            .poll(() => sektion.getByRole('button').count(), {
                message: 'die Rail hat keine zusätzliche Zeile bekommen',
                timeout: 30_000,
            })
            .toBeGreaterThan(zeilenVorher)
        // `data-room-h` ist der einzige Ort, an dem die UUID im Markup steht: der
        // sichtbare Name einer Unterhaltung ist der des Gegenübers, und ein `href` hat die
        // Zeile nicht. Ohne diesen Anker hieße die Zusage nur „irgendeine Zeile kam dazu".
        await expect(
            sektion.locator(`[data-room-h="${channelId}"]`),
            'die vom Relay im OK-Frame genannte Kanal-Id steht in keiner Rail-Zeile',
        ).toBeVisible({ timeout: 30_000 })

        // 3. Der Relay hat den Kanal als DM angelegt — unabhängig gemessen, mit `nak` und
        //    nicht über den Client. `nak` druckt auch bei Ablehnung und endet mit 0; hier
        //    zählt allein der INHALT der Antwort.
        const meta = nak([
            'req', '--auth', '--sec', BUZZ_OWNER_SEC_HEX, '-k', '39000', '-d', channelId, WS(),
        ])
        expect(meta, 'das 39000 des neuen Kanals trägt keinen `["t","dm"]`').toContain('"dm"')
        expect(meta, 'das 39000 des neuen Kanals nennt den Owner nicht als Teilnehmer').toContain(OWNER_PUB)
    })

    test('41012 nimmt die Unterhaltung aus der Spalte — gelöscht wird sie NICHT', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 })
        await useBuzz(page)
        await loginNsec(page, BUZZ_USER_NSEC)
        await page.goto('/')

        const sektion = dmSection(page)
        await expect(sektion).toBeVisible({ timeout: 30_000 })

        // Sicherstellen, dass es überhaupt eine gibt (der Fall darf nicht von der
        // Reihenfolge der Dateien abhängen): eröffnen ist idempotent.
        await pickOwner(page)
        await page.getByRole('button', { name: 'Unterhaltung eröffnen' }).click()
        await expect
            .poll(() => sektion.getByRole('button').count(), { timeout: 30_000 })
            .toBeGreaterThan(1)

        const vorher = await sektion.getByRole('button').count()

        // Ausblenden über den Dialog — dort sitzen die zwei Handlungen je Unterhaltung.
        await sektion.getByRole('button', { name: 'Neue Unterhaltung' }).click()
        const ausblenden = page.getByRole('button', { name: /ausblenden$/ }).first()
        await expect(ausblenden, 'im Dialog steht keine Unterhaltung zum Ausblenden').toBeVisible({ timeout: 15_000 })
        await ausblenden.click()

        await expect
            .poll(() => sektion.getByRole('button').count(), {
                message: 'die ausgeblendete Unterhaltung steht weiter in der Rail — der 30622-Filter greift nicht',
                timeout: 30_000,
            })
            .toBeLessThan(vorher)

        // Und die Gegenprobe, die den Unterschied zwischen „ausgeblendet" und „gelöscht"
        // macht: der Kanal existiert weiter. Gemessen mit einem UNABHÄNGIGEN Messgerät
        // (dem Owner-Schlüssel), nicht über den Client, der ihn gerade versteckt.
        const kanaele = nak(['req', '--auth', '--sec', BUZZ_OWNER_SEC_HEX, '-k', '39000', WS()])
        expect(kanaele, 'der DM-Kanal ist beim Ausblenden verschwunden — Ausblenden darf nichts löschen').toContain(
            '"dm"',
        )
    })

    test('LAYOUT: die DM-Fläche bei schmal (390) und Desktop (1440) — echte Zahlen', async ({ page }) => {
        // „Sichtbare UI ist erst fertig, wenn sie GEMESSEN wurde" (Nutzeransage
        // 2026-09-03). Gemessen werden echte Zahlen an zwei Breiten.
        await useBuzz(page)
        await loginNsec(page, BUZZ_USER_NSEC)

        // ── 390: die Rail existiert dort NICHT, und das ist die Messung ──────────
        // Ein `x-if` auf `$store.viewport?.desktop` entscheidet über die EXISTENZ des
        // Knotens. Stünde die DM-Gruppe schmal doch im Baum, liefe auf jedem Telefon eine
        // Relay-Subscription für eine Spalte, die dort niemand sieht.
        await page.setViewportSize({ width: 390, height: 844 })
        await page.goto('/')
        await expect(page.locator('[data-rail]'), 'die Rail existiert bei 390 px').toHaveCount(0)
        const schmalOverflow = await page.evaluate(() => document.documentElement.scrollWidth)
        expect(schmalOverflow, `390px: waagerechter Überlauf des Dokuments (${schmalOverflow}px)`).toBeLessThanOrEqual(
            391,
        )

        // ── 1440: Gruppenkopf, Aktionsknopf und Dialog ──────────────────────────
        await page.setViewportSize({ width: 1440, height: 900 })
        await page.goto('/')

        const sektion = dmSection(page)
        await expect(sektion).toBeVisible({ timeout: 30_000 })
        const kopf = sektion.locator('div').first()
        const kopfBox = await kopf.boundingBox()
        expect(kopfBox, '1440px: keine Geometrie am Gruppenkopf').toBeTruthy()
        const k = kopfBox as { x: number; y: number; width: number; height: number }

        // Der Kopf trägt dieselbe Zielgröße wie die drei Nachbarn (WCAG 2.2 SC 2.5.8 gilt
        // für die Knöpfe darin, gemessen in `buzz-rail-forge`); hier zählt, dass er in der
        // Spalte steht und sie nicht sprengt.
        const railBox = await page.locator('[data-rail]').boundingBox()
        const r = railBox as { x: number; width: number }
        expect(k.x, '1440px: der Gruppenkopf steht links der Rail').toBeGreaterThanOrEqual(r.x)
        expect(k.x + k.width, '1440px: der Gruppenkopf ragt aus der Rail').toBeLessThanOrEqual(r.x + r.width + 1)
        expect(k.height, `1440px: der Gruppenkopf ist zu flach (${k.height}px)`).toBeGreaterThanOrEqual(24)

        const knopf = sektion.getByRole('button', { name: 'Neue Unterhaltung' })
        await expect(knopf, '1440px: der Aktionsknopf der DM-Gruppe fehlt').toBeVisible()
        const knopfBox = (await knopf.boundingBox()) as { x: number; width: number; height: number }
        expect(knopfBox.width, `1440px: der Aktionsknopf ist zu klein (${knopfBox.width}px)`).toBeGreaterThanOrEqual(24)
        expect(knopfBox.height, `1440px: der Aktionsknopf ist zu flach (${knopfBox.height}px)`).toBeGreaterThanOrEqual(
            24,
        )
        expect(knopfBox.x + knopfBox.width, '1440px: der Aktionsknopf ragt aus der Rail').toBeLessThanOrEqual(
            r.x + r.width + 1,
        )

        // Der Dialog: Breite, x-Versatz, und dass er das Dokument nicht in den
        // waagerechten Bildlauf schiebt.
        await knopf.click()
        const feld = page.getByLabel('Person')
        await expect(feld).toBeVisible({ timeout: 15_000 })
        const dialog = page.locator('dialog[data-modal="dm"]')
        const dialogBox = (await dialog.boundingBox()) as { x: number; width: number; height: number }
        expect(dialogBox.width, `1440px: der Dialog ist zu schmal (${dialogBox.width}px)`).toBeGreaterThanOrEqual(280)
        expect(dialogBox.width, `1440px: der Dialog ist zu breit (${dialogBox.width}px)`).toBeLessThanOrEqual(560)
        expect(dialogBox.x, '1440px: der Dialog steht links außerhalb').toBeGreaterThanOrEqual(0)
        expect(dialogBox.x + dialogBox.width, '1440px: der Dialog ragt rechts heraus').toBeLessThanOrEqual(1441)

        const overflow = await page.evaluate(() => document.documentElement.scrollWidth)
        expect(overflow, `1440px: waagerechter Überlauf des Dokuments (${overflow}px)`).toBeLessThanOrEqual(1441)

        // Die Privatheits-Zusage steht im Dialog und nicht in einer Fußnote — sie ist der
        // Satz, der einen Nutzer davor bewahrt, „DM" für Ende-zu-Ende zu halten.
        await expect(
            page.getByText('Nachrichten liegen unverschlüsselt auf diesem Relay', { exact: false }),
            '1440px: die Privatheits-Zusage fehlt im Dialog',
        ).toBeVisible()
    })
})
