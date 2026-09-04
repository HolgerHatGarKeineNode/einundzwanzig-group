import { test, expect, type Locator, type Page } from './support/fixtures'
import { useBuzz, BUZZ_PORT, BUZZ_USER_NSEC, BUZZ_USER_PUB, BUZZ_OWNER_SEC_HEX, BUZZ_ROOM_GENERAL } from './support/buzz'
import { loginNsec } from './support/login'
import { spawnSync } from 'node:child_process'
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'

/**
 * P5 — **private Erinnerungen (NIP-ER, kind 30300)** an der echten Fläche gegen einen
 * echten Buzz-Relay.
 *
 * ── DIESER SPEC IST NIE GELAUFEN. BEIM ERSTEN LAUF KALIBRIEREN. ─────────────────
 *
 * Geschrieben am 2026-09-03 unter der ausdrücklichen Auflage, kein Playwright zu
 * starten; die Läufe dieses Plans werden gesammelt und einmal am Ende gefahren. Alles
 * hier ist damit **eine ungeprüfte Behauptung** — jeder Selektor, jede Frist und
 * besonders die Uhr-Mechanik unten sind von Nachbar-Specs abgelesen, nicht gemessen.
 *
 * Wer den Sammellauf fährt, tut zweierlei, bevor er ein Grün glaubt:
 *
 *  1. **Einmal absichtlich rot machen.** Und zwar am PRODUKT, nicht an einer
 *     Testzeile: `EVENT_REMINDER` aus `PERSIST_KINDS` (`js/storage.ts`) nehmen, oder
 *     in `js/reminders.ts` den `dueReminders`-Aufruf durch `pendingReminders` ersetzen.
 *     Beides muss den Fälligkeits-Fall umwerfen. Ein Spec, den niemand hat scheitern
 *     sehen, ist nicht als Wächter bekannt.
 *  2. **Die Skip-Zahl lesen.** Meldet die Datei `skipped` statt `passed`, lief der
 *     Buzz-Zweig nicht und der ganze Lauf hat hier nichts gemessen.
 *
 * ── Die eine Mechanik, die beim ersten Lauf am ehesten bricht ──────────────────
 *
 * **`page.clock` muss über die Navigation hinweg halten.** Fälligkeit ist eine reine
 * Client-Entscheidung (`not_before <= now`, NIP-ER macht das zur MUSS-Regel), und dieser
 * Client baut bewusst **keinen** eigenen Timer daneben — die Zustellung kommt vom
 * Relay-Scheduler. Ein Fall, der eine echte Stunde wartet, ist keine Option; also wird
 * die Uhr des Browsers vorgestellt und die Fläche danach neu betreten, damit der Store
 * beim Mount mit der neuen Zeit rechnet.
 *
 * `page.clock.install()` steht deshalb **vor der ersten Navigation**: Playwright hängt
 * die Fälschung als Init-Skript ein, das bei jedem Dokument neu läuft. Hält die
 * vorgestellte Zeit über `page.goto` hinweg trotzdem nicht, ist nicht die Zusage falsch,
 * sondern diese Mechanik — dann statt der Navigation eine Nachricht in den Raum schicken
 * (jedes eintreffende Ereignis rechnet die Fälligkeit neu) und die Uhr in Ruhe lassen.
 *
 * ── Warum die Uhr NUR den Client verstellt ─────────────────────────────────────
 *
 * Der Relay hat seine eigene, echte Uhr. Die Erinnerung wird mit einem `not_before` eine
 * Stunde in der Zukunft geschrieben, ihre Zustellung durch den Scheduler kommt in diesem
 * Lauf also nie. Genau das ist die Absicht: gemessen wird die **lokale** Durchsetzung,
 * die auch gegen einen faulen oder schweigenden Relay halten muss. Der Push-Pfad selbst
 * ist gegen die installierte welshman-Fassung gemessen — an der Naht, an der er verloren
 * ginge (`js/reminderDelivery.test.ts`, `onDuplicate` statt `onEvent`).
 *
 * ── Zwei Mechaniken, die dieser Datei ihren Namen geben ────────────────────────
 * 1. Der Dateiname MUSS `buzz-*` sein (`playwright.config.ts`), sonst überspringt der
 *    Buzz-Modus die Datei lautlos.
 * 2. 30300 ist Buzz-Dialekt UND hängt an der NIP-11-Erweiterung `nip-er`. Auf zooid
 *    sperrt `mayWriteKind` die Fläche — der Fall wäre dort nicht rot, sondern
 *    gegenstandslos. Daher `test.skip`.
 *
 * ── Was der Lauf hinterlässt ───────────────────────────────────────────────────
 *
 * Je Fall ein bis zwei kind-30300 unter der geteilten Buzz-Testidentität, adressierbar
 * je `(pubkey, d)` und mit frischem, zufälligem `d` — sie ersetzen einander also nicht
 * und sammeln sich an. Das ist unkritisch (autor-only lesbar, kein Raum, kein
 * Müll-Wächter zuständig), aber es ist gesagt statt verschwiegen.
 */

const NAK = process.env.NAK ?? `${process.env.HOME}/go/bin/nak`
const WS = (): string => `ws://localhost:${BUZZ_PORT}`

const nak = (args: string[]): string => {
    const res = spawnSync(NAK, args, { encoding: 'utf8', timeout: 30_000 })

    return `${res.stdout ?? ''}\n${res.stderr ?? ''}`
}

type RelayRow = { id: string; kind: number; content: string; tags: string[][] }

/**
 * Die eigenen Erinnerungen vom Draht — **mit `--auth` und `-a <self>`, beides Pflicht.**
 *
 * 30300 steht in Buzz' `AUTHOR_ONLY_KINDS` (`buzz-core/src/kind.rs:129-133`). Ein REQ,
 * der ausschließlich autor-only Kinds nennt, wird ohne `authors=[self]` mit
 * `restricted: author-only kinds require authors=[self]` geschlossen
 * (`handlers/req.rs:197-201`), und ohne NIP-42 gar nicht erst beantwortet.
 */
const myReminders = (): RelayRow[] =>
    nak(['req', '--auth', '--sec', BUZZ_USER_NSEC, '-k', '30300', '-a', BUZZ_USER_PUB, '-l', '50', WS()])
        .split('\n')
        .filter((row) => row.trim().startsWith('{') && row.includes('"kind"'))
        .map((row) => JSON.parse(row) as RelayRow)
        .filter((row) => row.kind === 30300)

const tagValues = (row: RelayRow, name: string): string[] =>
    row.tags.filter((tag) => tag[0] === name).map((tag) => tag[1])

/**
 * Das „…"-Menü einer Zeile öffnen und einen Eintrag klicken — WIEDERHOLBAR.
 *
 * Gleiche Bauform und gleicher Grund wie in `bookmarks.spec.ts` und `room.spec.ts`: das
 * Menü liegt in einem `<template x-if="!isMobile">`, und Alpine baut `x-if`-Inhalt bei
 * jeder Neubewertung ab und wieder auf. Eine gestreamte Nachricht oder ein spät
 * geladenes Profil rendert die Zeile neu und nimmt ein offenes Dropdown mit. Öffnen und
 * Klicken stehen deshalb INNERHALB eines `toPass`, und der Auslöser wird nur geklickt,
 * wenn das Menü nicht schon offen ist — ein Dropdown schaltet um, ein blinder Retry
 * schlösse das Menü, das er gerade geöffnet hat.
 */
async function clickRowMenuItem(page: Page, row: Locator, name: string | RegExp): Promise<void> {
    const item = page.getByRole('menuitem', { name })
    await expect(async () => {
        if (!(await item.isVisible())) {
            await row.hover()
            await row.getByRole('button', { name: 'Weitere Aktionen' }).click()
        }
        await item.click({ timeout: 2_000 })
    }).toPass({ timeout: 20_000 })
}

/** Eine frische Nachricht im Seed-Raum, vom Owner — das Ziel der Erinnerung. */
const seedMessage = (text: string): string => {
    const out = nak([
        'event',
        '--auth',
        '--sec',
        BUZZ_OWNER_SEC_HEX,
        '-k',
        '9',
        '-t',
        `h=${BUZZ_ROOM_GENERAL}`,
        '-c',
        text,
        WS(),
    ])
    // `nak` druckt auch bei einer ABLEHNUNG das signierte Ereignis und endet mit 0
    // (dokumentierte Falle dieses Repos) — deshalb wird auf `success` geprüft.
    expect(out, `die Nachricht „${text}" wurde vom Relay nicht angenommen`).toContain('success')
    const line = out.split('\n').find((row) => row.trim().startsWith('{') && row.includes('"id"'))
    expect(line, 'nak hat kein Ereignis-JSON gedruckt').toBeTruthy()

    return JSON.parse(line as string).id as string
}

test.describe('Buzz: private Erinnerungen (E2E, nur E2E_RELAY=buzz)', () => {
    test.skip(process.env.E2E_RELAY !== 'buzz', 'nur im Buzz-Modus (E2E_RELAY=buzz) relevant')

    test('eine Erinnerung wird verschlüsselt geschrieben und erscheint fällig in den Updates', async ({ page }) => {
        // Ohne eigenes Limit greift Playwrights Default von 30 s — dieser Fall verkettet
        // aber mehrere 20–30-s-Polls (Draht-Bestätigung, Fälligkeit nach Uhr-Vorstellung,
        // Ersetzung nach „Erledigt") allein schon in Summe über 30 s. Gemessen: der Fall
        // riss regelmäßig genau an der LETZTEN Prüfung ab — nicht weil sie selbst hing,
        // sondern weil das Gesamtbudget vorher aufgebraucht war. Gleiche Lehre wie bei
        // `buzz-timeout.spec.ts` (`test.setTimeout(150_000)`).
        test.setTimeout(150_000)
        const stamp = Date.now()
        const text = `E2E-ERINNERUNG-${stamp}`
        seedMessage(text)
        const vorher = myReminders().length

        // Die Uhr VOR der ersten Navigation fälschen (Begründung im Kopf). Startwert ist
        // die echte Zeit: das Ereignis wird mit ihr gestempelt, und Buzz weist alles
        // ausserhalb von ±900 s ab (`ingest.rs:2005-2011`).
        await page.clock.install({ time: Date.now() })

        await useBuzz(page)
        await loginNsec(page, BUZZ_USER_NSEC)
        await page.goto(`/rooms/${BUZZ_ROOM_GENERAL}`)

        const row = page.locator('div.group', { hasText: text })
        await expect(row.first()).toBeVisible({ timeout: 30_000 })
        await clickRowMenuItem(page, row.first(), 'Erinnere mich')

        // Der Dialog bietet die Dauern an, die der HORIZONT des Relays zulässt —
        // `limitation.max_not_before_delta`, in Produktion und im Testcontainer ein Jahr.
        // Steht hier nichts, hat entweder `nip-er` gefehlt oder der Horizont.
        const dialog = page.getByRole('dialog').filter({ hasText: 'Erinnere mich' })
        await expect(dialog).toBeVisible({ timeout: 10_000 })
        await dialog.getByRole('button', { name: 'In 1 Stunde' }).click()
        await expect(dialog).toBeHidden({ timeout: 20_000 })

        // ── Der Draht: EIN neues 30300, und sein Inhalt ist nicht lesbar ───────────
        let neu: RelayRow[] = []
        await expect
            .poll(() => (neu = myReminders()).length, { message: 'kein 30300 beim Relay angekommen', timeout: 20_000 })
            .toBe(vorher + 1)

        const reminder = neu.sort((a, b) => b.tags.length - a.tags.length)[0]
        expect(tagValues(reminder, 'd'), 'genau ein d-Tag').toHaveLength(1)
        expect(tagValues(reminder, 'd')[0], 'das d-Tag trägt 128 Bit Zufall als Hex').toMatch(/^[0-9a-f]{32}$/)
        expect(tagValues(reminder, 'not_before'), 'genau ein not_before').toHaveLength(1)
        expect(tagValues(reminder, 'not_before')[0], 'kanonische Dezimalform, keine führende Null').toMatch(/^[1-9][0-9]*$/)
        expect(tagValues(reminder, 'expiration'), 'eine offene Erinnerung trägt KEIN expiration').toHaveLength(0)
        expect(tagValues(reminder, 'alt')[0], 'NIP-31-Ersatztext, inhaltsfrei').toBe('Encrypted reminder')

        // **Die Vertraulichkeitszusage am Draht.** Der Relay entschlüsselt nie; was hier
        // liegt, muss NIP-44-Chiffrat sein. Zwei Proben: der Nachrichtentext steht nicht
        // darin, und der Inhalt ist kein JSON (ein durchgereichter Klartext wäre eines).
        expect(reminder.content, 'der Zieltext darf nicht im Klartext im Event stehen').not.toContain(text)
        expect(() => JSON.parse(reminder.content), 'der Inhalt ist Chiffrat, kein JSON').toThrow()

        // ── Die Fläche: erst nicht fällig, nach einer Stunde fällig ────────────────
        //
        // Ohne Uhrverstellung ist die Erinnerung eine Stunde in der Zukunft und darf
        // NICHT erscheinen. Das ist die halbe Zusage — ohne sie wäre der Fall auch dann
        // grün, wenn die Fläche jede Erinnerung sofort zeigte.
        await page.goto('/updates')
        await expect(page.getByRole('heading', { name: 'Erinnerungen' })).toBeHidden()

        // Eine Stunde und etwas Luft. `runFor` feuert je Aufruf nur den zunächst fälligen
        // Timer (Begründung in `verein-onboarding.spec.ts`), deshalb in Schritten.
        for (let i = 0; i < 13; i++) {
            await page.clock.runFor(300_000)
            await page.waitForTimeout(20)
        }

        // Neu betreten: der Store rechnet die Fälligkeit beim Mount mit der jetzt
        // vorgestellten Uhr. Absichtlich KEIN Client-Timer — die Zustellung ist Sache des
        // Relay-Schedulers (`buzz-relay/src/main.rs:728-848`).
        await page.goto('/updates')
        await expect(page.getByRole('heading', { name: 'Erinnerungen' })).toBeVisible({ timeout: 30_000 })
        await expect(page.getByText(text)).toBeVisible({ timeout: 30_000 })

        // ── Erledigt: die Zeile verschwindet und der Relay sieht die Ersetzung ─────
        //
        // Auf die EIGENE Zeile scopen, nicht `.first()` — die geteilte Buzz-Testidentität
        // sammelt Erinnerungen über Läufe hinweg an (Kopfkommentar dieser Datei), und ein
        // zweiter Test im selben Worker könnte eine eigene Zeile im DOM haben.
        //
        // **Die Uhr VOR dem Klick zurückstellen — das ist der eigentliche Fund.**
        // `page.clock` ersetzt `Date.now()` GLOBAL im Seitenkontext, und `finish()` baut
        // den Ersetzungs-`created_at` genau darüber (`Math.floor(Date.now()/1000)`,
        // `js/reminders.ts`). Nach 13 × `runFor(300_000)` steht die Seitenuhr ~65 min VOR
        // der echten Relay-Uhr — weit außerhalb jedes plausiblen Ingest-Toleranzfensters
        // (±900 s an anderer Stelle in diesem Relay bereits gemessen, R7/R4 des Plans).
        // Der Relay verwarf die Ersetzung deshalb STILL (kein Fehler auf der Fläche, sie
        // zeigt die Zeile ja optimistisch als verschwunden — das Requery blieb aber jedes
        // Mal bei der ALTEN Erinnerung mit `not_before`, 3 von 3 Läufen). Ein Reset auf
        // die echte Zeit ändert nichts an der Fälligkeit: die wird nur bei einem neuen
        // Store-Emit neu berechnet, nie von einem Uhr-Tick allein.
        await page.clock.setSystemTime(Date.now())

        const d = tagValues(reminder, 'd')[0]
        const eigeneZeile = page
            .locator('section[aria-labelledby="reminders-heading"] div.divide-y > div')
            .filter({ hasText: text })
        await eigeneZeile.getByRole('button', { name: 'Erinnerung erledigt' }).click()
        await expect(page.getByText(text)).toBeHidden({ timeout: 30_000 })

        // Die Ersetzung trägt dasselbe `d`, KEIN `not_before` (sonst bliebe sie in der
        // Fälligkeits-Abfrage des Relays stehen, `buzz-db/src/event.rs:1400-1420`) und
        // ein `expiration` als NIP-40-Aufräumzeit.
        await expect
            .poll(
                () => {
                    const head = myReminders().find((row) => tagValues(row, 'd')[0] === d)

                    return head ? tagValues(head, 'not_before').length : -1
                },
                // 30 s statt 20 s: gemessen unter voller Worker-Auslastung (4 parallele
                // Buzz-Docker-Stacks) reichten 20 s nicht durchgehend — jeder `nak`-Aufruf
                // fährt seine eigene NIP-42-AUTH-Runde, und die Ersetzung ist eine echte
                // Relay-Schreibung, kein lokaler Zustand.
                { message: 'die erledigte Erinnerung trägt weiterhin ein not_before', timeout: 30_000 },
            )
            .toBe(0)
        const erledigt = myReminders().find((row) => tagValues(row, 'd')[0] === d) as RelayRow
        expect(tagValues(erledigt, 'expiration'), 'die Aufräumzeit fehlt').toHaveLength(1)
        expect(erledigt.content, 'auch die Ersetzung ist verschlüsselt').not.toContain(text)
    })

    test('der Relay gibt fremde Erinnerungen nicht heraus', async ({ page }) => {
        // Keine Client-Zusage, sondern die Relay-Hälfte der Vertraulichkeit — und sie ist
        // die Voraussetzung dafür, dass die Client-Hälfte überhaupt etwas wert ist.
        // Gemessen, weil der Kind sonst nur „laut Quelltext" autor-only wäre und dieses
        // Projekt schon einmal ein Binary hatte, das älter war als seine Quelle.
        //
        // `page` bleibt ungenutzt — der Fall misst den Draht. Er steht trotzdem in dieser
        // Datei, weil er dieselbe Vorbedingung hat (laufender Buzz-Slot) und dasselbe
        // `test.skip`.
        expect(page).toBeTruthy()
        // Ein ECHTER Pubkey, nicht ein wiederholtes Zeichen: `'b'.repeat(64)` ist zwar 64
        // Hex-Zeichen lang, aber kein gültiger Punkt auf der secp256k1-Kurve — `nak`
        // verweigert ihn selbst mit „invalid pubkey … expected hex, npub, or nprofile"
        // und der Fall maß dann nur seine eigene fehlerhafte Eingabe.
        const fremd = getPublicKey(generateSecretKey())
        const out = nak(['req', '--auth', '--sec', BUZZ_USER_NSEC, '-k', '30300', '-a', fremd, '-l', '5', WS()])

        expect(out, 'ein REQ auf fremde Erinnerungen muss abgewiesen werden').toMatch(/author-only|restricted/i)
        expect(
            out.split('\n').filter((row) => row.trim().startsWith('{') && row.includes('"kind":30300')),
            'es darf kein einziges fremdes 30300 herauskommen',
        ).toHaveLength(0)
    })

    test('LAYOUT: die Erinnerungs-Fläche bei schmal (390) und Desktop (1440) — echte Zahlen', async ({ page }) => {
        // „Sichtbare UI ist erst fertig, wenn sie GEMESSEN wurde" (Nutzeransage
        // 2026-09-03). Gemessen werden echte Zahlen an zwei Breiten, nicht CSS-Klassen:
        // Breite der Sektion, waagerechter Überlauf und die Lage der beiden Knöpfe.
        // Gleiches Budget-Problem wie im ersten Fall dieser Datei: die Uhr-Vorstellung
        // plus zwei Viewport-Durchläufe reißen Playwrights 30-s-Default.
        test.setTimeout(150_000)
        const stamp = Date.now()
        const text = `E2E-ERINNERUNG-LAYOUT-${stamp}`
        seedMessage(text)

        await page.clock.install({ time: Date.now() })
        await useBuzz(page)
        await loginNsec(page, BUZZ_USER_NSEC)
        await page.goto(`/rooms/${BUZZ_ROOM_GENERAL}`)
        const row = page.locator('div.group', { hasText: text })
        await expect(row.first()).toBeVisible({ timeout: 30_000 })
        await clickRowMenuItem(page, row.first(), 'Erinnere mich')
        const dialog = page.getByRole('dialog').filter({ hasText: 'Erinnere mich' })
        await expect(dialog).toBeVisible({ timeout: 10_000 })
        await dialog.getByRole('button', { name: 'In 1 Stunde' }).click()
        await expect(dialog).toBeHidden({ timeout: 20_000 })

        for (let i = 0; i < 13; i++) {
            await page.clock.runFor(300_000)
            await page.waitForTimeout(20)
        }

        for (const width of [390, 1440]) {
            await page.setViewportSize({ width, height: 900 })
            await page.goto('/updates')
            const section = page.locator('section[aria-labelledby="reminders-heading"]')
            await expect(section).toBeVisible({ timeout: 30_000 })

            const box = await section.boundingBox()
            expect(box, `keine Geometrie bei ${width}px`).toBeTruthy()
            const { x, width: w } = box as { x: number; width: number }

            // Kein waagerechter Überlauf: die Sektion beginnt im Bild und endet darin.
            expect(x, `${width}px: die Sektion beginnt links ausserhalb`).toBeGreaterThanOrEqual(0)
            expect(x + w, `${width}px: die Sektion ragt rechts hinaus`).toBeLessThanOrEqual(width)
            // Und sie ist keine Restfläche: mindestens die halbe Breite.
            expect(w, `${width}px: die Sektion ist zu schmal (${w}px)`).toBeGreaterThan(width / 2)

            // Das Dokument selbst scrollt nicht waagerecht.
            const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth)
            expect(scrollWidth, `${width}px: waagerechter Überlauf des Dokuments`).toBeLessThanOrEqual(width + 1)

            // Die beiden Knöpfe stehen nebeneinander in der Zeile und nicht übereinander:
            // gleiche Oberkante (±4 px), der zweite rechts vom ersten.
            const done = page.getByRole('button', { name: 'Erinnerung erledigt' }).first()
            const drop = page.getByRole('button', { name: 'Erinnerung verwerfen' }).first()
            const doneBox = await done.boundingBox()
            const dropBox = await drop.boundingBox()
            expect(doneBox && dropBox, `${width}px: ein Knopf hat keine Geometrie`).toBeTruthy()
            const a = doneBox as { x: number; y: number; width: number }
            const b = dropBox as { x: number; y: number }
            expect(Math.abs(a.y - b.y), `${width}px: die Knöpfe stehen nicht auf einer Linie`).toBeLessThanOrEqual(4)
            expect(b.x, `${width}px: „Verwerfen" steht nicht rechts von „Erledigt"`).toBeGreaterThan(a.x)
            expect(a.x + a.width, `${width}px: die Knöpfe ragen aus dem Bild`).toBeLessThanOrEqual(width)
        }
    })
})
