import { test, expect, type Page } from './support/fixtures'
import { execFileSync, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { useZooid, ZOOID_WS } from './support/zooid'
import { loginNsec } from './support/login'
import { publishVerified } from './support/publishVerified'

/**
 * ══ EIN ESCAPE TRÄGT GENAU EINE SCHICHT AB ══════════════════════════════════
 *
 * Der Chat-Composer schloss bei Escape seine Vorschlagsliste (`closeMentions()`)
 * und liess das Ereignis weiterlaufen. Darüber liegt ein Fenster-Horcher
 * (`⚡room.blade.php`: `x-on:keydown.escape.window="threadRootId && … &&
 * backFromThread()"`), und `closeThread()` setzt `threadDraft = ''` und verwirft
 * `threadAttachment`.
 *
 * **Der Schaden war gemessen, bevor eine Zeile geändert wurde** (Sonde vom
 * 2026-08-27 gegen den damaligen `master`, Raum `welcome`, beide Breiten gleich):
 *
 *     vorher   threadRootId=2835…, threadDraft="Mein langer Entwurf @ali"
 *     nachher  threadRootId=null,   threadDraft=""
 *
 * Ein Tastendruck, der eine Vorschlagsliste wegklicken sollte, löschte den
 * getippten Entwurf. Das ist Nielsen #3 (Nutzerkontrolle) mit Datenverlust, und
 * dieselbe Bauform wie der Forge-Fall, der am selben Tag gefixt wurde
 * (`js/forge.ts mentionKey`, dort ein Regress aus P4).
 *
 * ── Warum hier ZWEI Hälften geprüft werden ──────────────────────────────────
 * Ein `stopPropagation()` ist leicht zu weit gesetzt. Die erste Hälfte hält fest,
 * dass Escape die Liste schliesst und den Thread STEHEN lässt; die zweite, dass
 * ein Escape OHNE offene Liste den Thread weiterhin verlässt. Ohne die zweite
 * wäre ein Überfix — Escape tut im Thread gar nichts mehr — genauso grün.
 *
 * ── Und warum der Cropper mitgeprüft wird, obwohl er NICHT betroffen ist ────
 * Er ist der zweite Fenster-Horcher auf Escape (`⚡room.blade.php:1150`). Dass er
 * nicht betroffen ist, ist eine MESSUNG — und meine erste Erklärung dafür war
 * falsch. Ich hatte „die Zustände schliessen einander aus, das `aria-modal`-
 * Overlay zieht den Fokus auf `cropConfirm`" notiert; drei Wiederholungen haben
 * das widerlegt: das Overlay steht sichtbar, `activeElement` bleibt über vier
 * Sekunden das Textfeld, und ein Ereignis-Mitschnitt zeigt den Escape beim
 * Textfeld ankommen (`["textarea"]`, kein `window`).
 *
 * Der wahre Grund ist ein härterer: der Thread-Horcher trägt `!_cropSrc` in
 * seiner EIGENEN Bedingung, und der Cropper ruft `stopImmediatePropagation`.
 * Genau das prüft der letzte Fall unten — nicht den Fokus, sondern die Wirkung.
 *
 * ── Bestand ─────────────────────────────────────────────────────────────────
 * EINE eigene kind-9-Nachricht in `welcome` mit frischer Marke je Lauf, in
 * `afterAll` per kind 5 wieder eingesammelt. Der Raum ist `welcome`, weil der
 * Test-User dort im Seed schon Mitglied ist (`zooid-testserver.sh:288`) und
 * „Alice Test" als sein kind-0-Profil ein verlässlicher Treffer für `@ali` ist —
 * dieselbe Positivkontrolle wie in `agent-mentions.spec.ts`.
 */

const NSEC = process.env.NOSTR_TEST_NSEC as string
const NAK = process.env.NAK ?? `${process.env.HOME}/go/bin/nak`
const RAUM = 'welcome'
const MARKE = `Escape-Schichtung ${randomUUID().slice(0, 8)}`
const ENTWURF = 'Mein langer Entwurf @ali'

let seedId = ''

type RelayEvent = { id: string; content: string }

function nak(args: string[]): string {
    let letzter: unknown = new Error('nak nicht aufgerufen')
    for (let i = 0; i < 3; i++) {
        const r = spawnSync(NAK, args, { encoding: 'utf8', timeout: 30_000 })
        if (r.error) {
            letzter = r.error
            execFileSync('sleep', ['1'])
            continue
        }

        return `${r.stdout ?? ''}\n${r.stderr ?? ''}`
    }
    throw letzter
}

/** Erste kind-9-Nachricht im Raum mit genau diesem Inhalt — frische Abfrage je Aufruf. */
const findeNachricht = (inhalt: string): RelayEvent | undefined =>
    nak(['req', '-k', '9', '-t', `h=${RAUM}`, '--auth', '--sec', NSEC, '-l', '200', ZOOID_WS])
        .trim()
        .split('\n')
        .filter((l) => l.startsWith('{'))
        .map((l) => JSON.parse(l) as RelayEvent)
        .find((e) => e.content === inhalt)

/** Der Zustand der Chat-Insel — an der Insel gelesen, nicht aus der Fläche gefolgert. */
const inselstand = (page: Page) =>
    page.evaluate(() => {
        const A = (window as unknown as { Alpine: { $data(e: Element): Record<string, unknown> } }).Alpine
        for (const knoten of document.querySelectorAll('[x-data]')) {
            const daten = A.$data(knoten)
            if ('threadRootId' in daten) {
                return {
                    threadRootId: (daten.threadRootId as string | null) ?? null,
                    threadDraft: (daten.threadDraft as string) ?? '',
                    draft: (daten.draft as string) ?? '',
                    mentionOpen: !!daten.mentionOpen,
                }
            }
        }

        return null
    })

async function raum(page: Page, breite: number): Promise<void> {
    await useZooid(page)
    await page.setViewportSize({ width: breite, height: 900 })
    await loginNsec(page, NSEC)
    await page.goto(`/rooms/${RAUM}`)
    await expect(page.getByText(MARKE, { exact: true })).toBeVisible({ timeout: 30_000 })
}

/** Thread auf der eigenen Nachricht öffnen. */
async function oeffneThread(page: Page): Promise<void> {
    const zeile = page.locator('div.group', { hasText: MARKE }).first()
    await zeile.hover()
    await zeile.getByRole('button', { name: 'Im Thread antworten' }).click()
    await expect(page.getByPlaceholder('Im Thread antworten…')).toBeVisible({ timeout: 20_000 })
}

test.describe('Chat: Escape trägt genau eine Schicht ab', () => {
    test.beforeAll(() => {
        expect(NSEC, 'NOSTR_TEST_NSEC ist nicht gesetzt').toBeTruthy()
        seedId = publishVerified(
            NAK,
            ['event', '--auth', '--sec', NSEC, '-k', '9', '-t', `h=${RAUM}`, '-c', MARKE],
            ZOOID_WS,
            () => findeNachricht(MARKE),
            `Raumnachricht in ${RAUM}`,
        ).id
        expect(seedId).toHaveLength(64)
    })

    test.afterAll(() => {
        // `--auth` ist PFLICHT: ohne quittiert der Relay mit `auth-required`, `nak`
        // druckt trotzdem Exit 0 und volles JSON, und die Nachricht bliebe für den
        // nächsten Lauf liegen.
        if (seedId) {
            nak(['event', '--auth', '--sec', NSEC, '-k', '5', '-t', `e=${seedId}`, ZOOID_WS])
        }
        seedId = ''
    })

    // Beide Breiten, weil der Thread unterhalb xl den Raum ERSETZT und ab xl als
    // Seitenspur daneben steht. Das sind zwei verschiedene DOM-Lagen für denselben
    // Handler; eine davon zu messen sagt über die andere nichts.
    for (const breite of [1279, 1440]) {
        test(`Thread-Composer bei ${breite}px: Escape schliesst die Liste und lässt den Entwurf stehen`, async ({
            page,
        }) => {
            test.setTimeout(150_000)
            await raum(page, breite)
            await oeffneThread(page)

            const feld = page.getByPlaceholder('Im Thread antworten…')
            await feld.click()
            await feld.pressSequentially(ENTWURF, { delay: 30 })

            // ── Positivkontrolle: die Liste steht WIRKLICH offen ─────────────
            // Ohne sie wäre „Escape schliesst nur die Liste" auch dann wahr, wenn
            // gar keine Liste da war — und der Test bewiese nichts.
            const liste = page.locator('[data-mention-popover="thread"]')
            await expect(liste).toBeVisible({ timeout: 20_000 })
            await expect(liste.getByText('Alice Test', { exact: false })).toBeVisible({ timeout: 20_000 })

            const vorher = await inselstand(page)
            expect(vorher, 'Chat-Insel nicht gefunden — die Messung wäre leer').not.toBeNull()
            expect(vorher!.threadRootId, 'kein Thread offen — dieser Fall misst dann nichts').not.toBeNull()
            expect(vorher!.threadDraft, 'der Entwurf steht nicht im Zustand').toBe(ENTWURF)

            // ── ERSTE SCHICHT ────────────────────────────────────────────────
            await page.keyboard.press('Escape')
            await expect(liste).toHaveCount(0, { timeout: 10_000 })

            const nachher = await inselstand(page)
            expect(
                nachher!.threadRootId,
                'Der Thread ist mit zugegangen — ein Escape hat zwei Schichten abgetragen',
            ).toBe(vorher!.threadRootId)
            expect(
                nachher!.threadDraft,
                'Der Entwurf ist weg — `closeThread()` hat ihn geleert (Datenverlust)',
            ).toBe(ENTWURF)
            expect(nachher!.mentionOpen, 'die Vorschlagsliste ist noch offen').toBe(false)

            // Der Fokus bleibt IM Feld — sonst wäre der Entwurf zwar da, aber nur
            // noch mit der Maus erreichbar.
            expect(
                await page.evaluate(
                    () => (document.activeElement as HTMLElement)?.getAttribute('placeholder') ?? '',
                ),
                'Der Fokus hat das Antwortfeld verlassen',
            ).toBe('Im Thread antworten…')

            // ── ZWEITE SCHICHT: der Riegel gegen den Überfix ─────────────────
            // Ohne diese Hälfte wäre auch ein `stopPropagation()` ohne Bedingung
            // grün — und Escape täte im Thread nie wieder etwas.
            await page.keyboard.press('Escape')
            await expect
                .poll(async () => (await inselstand(page))!.threadRootId, { timeout: 10_000 })
                .toBeNull()
        })
    }

    /**
     * Ab xl bleibt der Raum-Composer neben der Thread-Spur bedienbar. Derselbe
     * `mentionOpen`-Zustand, ein anderer Composer — und der Fenster-Horcher hängt
     * am Thread, nicht am Composer. Diese Lage war in der Sonde eigens gemessen.
     */
    test('Raum-Composer neben offener Thread-Spur: Escape lässt den Thread stehen', async ({ page }) => {
        test.setTimeout(150_000)
        await raum(page, 1440)
        await oeffneThread(page)

        const raumFeld = page.getByPlaceholder('Nachricht schreiben…')
        await expect(
            raumFeld,
            'Ab xl muss der Raum-Composer neben dem Thread bedienbar bleiben — sonst misst dieser Fall nichts',
        ).toBeVisible({ timeout: 20_000 })
        await raumFeld.click()
        await raumFeld.pressSequentially('Raum-Entwurf @ali', { delay: 30 })

        const liste = page.locator('[data-mention-popover="room"]')
        await expect(liste).toBeVisible({ timeout: 20_000 })

        const vorher = await inselstand(page)
        expect(vorher!.threadRootId).not.toBeNull()

        await page.keyboard.press('Escape')
        await expect(liste).toHaveCount(0, { timeout: 10_000 })
        const nachher = await inselstand(page)
        expect(
            nachher!.threadRootId,
            'Der Thread ist zugegangen, obwohl die Liste am RAUM-Composer stand',
        ).toBe(vorher!.threadRootId)
        expect(nachher!.draft, 'Der Raum-Entwurf ist weg').toBe('Raum-Entwurf @ali')
    })

    /**
     * Die festgehaltene NICHT-Bedingung — geprüft an der WIRKUNG, nicht am Fokus.
     *
     * Bei offenem Zuschnitt darf Escape den Thread nicht verlassen. Das ist kein
     * Verdienst dieses Fixes: der Thread-Horcher trägt seit jeher `!_cropSrc`,
     * und der Cropper stoppt selbst. Der Fall steht hier, damit die Zusage nicht
     * verschwindet, wenn jemand einen der beiden Riegel für überflüssig hält —
     * und damit niemand den Composer „mitrepariert", wo nichts kaputt ist.
     *
     * KEINE Vorschlagsliste in diesem Fall: mit offener Liste stoppte der
     * Composer den Tastendruck schon, und dann prüfte dieser Fall den Fix
     * statt den Riegel, gegen den er gebaut ist.
     */
    test('Zuschnitt offen: Escape schliesst den Zuschnitt und lässt Thread und Entwurf stehen', async ({
        page,
    }) => {
        test.setTimeout(150_000)
        await raum(page, 1279)
        await oeffneThread(page)

        const feld = page.getByPlaceholder('Im Thread antworten…')
        await feld.click()
        await feld.pressSequentially('Entwurf ohne Liste', { delay: 20 })

        // `_cropSrc` direkt setzen: geprüft wird die Schichtung, nicht der Weg
        // durch die Dateiauswahl.
        const gesetzt = await page.evaluate(() => {
            const A = (window as unknown as { Alpine: { $data(e: Element): Record<string, unknown> } }).Alpine
            for (const knoten of document.querySelectorAll('[x-data]')) {
                const daten = A.$data(knoten)
                if ('_cropSrc' in daten) {
                    daten._cropSrc = 'data:image/png;base64,iVBORw0KGgo='

                    return true
                }
            }

            return false
        })
        expect(gesetzt, 'keine Insel mit `_cropSrc` gefunden — der Fall misst nichts').toBe(true)

        // Positivkontrolle: das Overlay steht wirklich. `checkVisibility()` statt
        // einer eigenen Ableitung aus `offsetParent`/`position` — das Haus hat
        // sich damit schon eine ausgeblendete Leiste als „gerendert" melden lassen.
        await expect
            .poll(
                () =>
                    page.evaluate(
                        () => !!document.querySelector('[aria-label="Bild zuschneiden"]')?.checkVisibility(),
                    ),
                { timeout: 10_000 },
            )
            .toBe(true)

        // Und die Vorschlagsliste ist AUS — sonst prüfte dieser Fall den Fix.
        expect((await inselstand(page))!.mentionOpen, 'die Vorschlagsliste steht offen').toBe(false)

        await page.keyboard.press('Escape')

        await expect
            .poll(
                () =>
                    page.evaluate(
                        () => !!document.querySelector('[aria-label="Bild zuschneiden"]')?.checkVisibility(),
                    ),
                { timeout: 10_000 },
            )
            .toBe(false)

        const nachher = await inselstand(page)
        expect(nachher!.threadRootId, 'Der Thread ist mit dem Zuschnitt zugegangen').not.toBeNull()
        expect(nachher!.threadDraft, 'Der Entwurf ist weg').toBe('Entwurf ohne Liste')
    })
})
