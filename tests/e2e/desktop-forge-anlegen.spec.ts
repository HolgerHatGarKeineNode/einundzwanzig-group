import { test, expect, type Page } from './support/fixtures'
import { useZooid, ZOOID_WS } from './support/zooid'
import { loginNsec } from './support/login'
import { execFileSync, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'

/**
 * ══ DER ANLEGE-KNOPF IN ZWEI BAUFORMEN — UND DER RIEGEL DAGEGEN, DASS ES ZWEI
 *    ZUGLEICH WERDEN (2026-08-27) ═════════════════════════════════════════════
 *
 * Der Befund kam von der Live-Seite: „wie legt man hier ein Issue an?" — der
 * einzige Weg war das runde Plus unten rechts (`.forge-fab`). Das ist die
 * MOBILE Bauform; am Desktop liegt sie unterhalb der Zeile, in der jemand eine
 * Liste liest, und über einer Bottom-Nav, die es ab `xl` gar nicht mehr gibt.
 *
 * Seither gibt es zwei Formen — beschrifteter Knopf in der Filterleiste am
 * Desktop, FAB im Mobil-Chassis — und die tragende Zusage ist nicht, dass es
 * sie gibt, sondern dass es **immer genau eine** ist. Zwei Knöpfe für dieselbe
 * Handlung auf einem Bildschirm wären schlimmer als der Zustand davor.
 *
 * ── Was hier steht, und was NICHT ───────────────────────────────────────────
 * Die REGEL selbst (Chassis × Reiter × Ladezustand → Form) prüft
 * `js/forgeAnlegen.test.ts` ohne Browser und ohne Relay, inklusive der
 * Vollständigkeits-Kontrolle über alle 20 Kombinationen. Hier steht nur, was
 * ohne echte Fläche nicht prüfbar ist:
 *
 *   1. **Genau EIN Träger `[data-forge-anlegen]`** über den Chassis-Wechsel
 *      hinweg — und zwar am selben Dokument, per `setViewportSize`, ohne
 *      Neuladen. Das ist zugleich der Beleg, dass die Bindung an
 *      `$store.viewport.desktop` reaktiv ist: eine Lesung, die Alpine nicht
 *      verfolgt, bliebe beim Startwert stehen und die Fläche zeigte auf 390 px
 *      weiter den Kopfknopf.
 *   2. **Am Desktop steht er im Blickfeld**, beschriftet, ohne Scrollen.
 *   3. **Auch über einem LEEREN Repository** — genau die Lage, in der „Neues
 *      Issue" am meisten zählt und in der der Kopfstreifen der Liste, in dem
 *      der Knopf naheliegenderweise gestanden hätte, gar nicht existiert.
 *   4. **Der Schreibpfad hängt am neuen Knopf**: Blatt auf, `aria-expanded`,
 *      Escape, Fokusrückgabe.
 *
 * ── Warum `desktop-` und warum die Suite davon nichts merkt ─────────────────
 * Das Präfix pinnt den Viewport auf 1440 px (`playwright.config.ts`); die
 * Bestandssuite läuft im Projekt `chromium` auf **1279** px, also unter der
 * Chassis-Schwelle. Die sechs Bestandsfälle, die den Knopf über
 * `getByRole('button', { name: 'Neues Issue' })` ansprechen
 * (`buzz-forge-write` ×4, `buzz-forge-mentions`, `buzz-agent-mention-form`),
 * finden dort weiterhin den FAB — der zugängliche NAME ist in beiden Formen
 * wörtlich derselbe. Angefasst wurde keiner von ihnen.
 *
 * ── Der Bestand ─────────────────────────────────────────────────────────────
 * ZWEI Repositories: eines mit Issues (dort steht die Filterleiste ohnehin) und
 * ein LEERES (dort trägt sie nur noch den Knopf). Beide `d`-Werte sind je Lauf
 * frisch (`randomUUID`) und werden in `afterAll` per kind 5 eingesammelt — ein
 * Test, der sich seinen Bestand nicht selbst sät, ist eine Wette auf die
 * Laufreihenfolge und wird von fremdem Liegengebliebenem grün.
 */

const NSEC = process.env.NOSTR_TEST_NSEC as string
const NAK = process.env.NAK ?? `${process.env.HOME}/go/bin/nak`

const LAUF = randomUUID().slice(0, 8)
const REPO_VOLL = `e2e-anlegen-voll-${LAUF}`
const REPO_LEER = `e2e-anlegen-leer-${LAUF}`

/** Die Chassis-Schwelle, wörtlich aus `js/viewport.ts` (`DESKTOP_QUERY`). */
const XL = 1280

function nak(args: string[]): string {
    let letzter: unknown = new Error('nak nicht aufgerufen')
    for (let i = 0; i < 3; i++) {
        const res = spawnSync(NAK, [...args], { encoding: 'utf8', timeout: 30_000 })
        if (res.error) {
            letzter = res.error
            execFileSync('sleep', ['1'])
            continue
        }

        return `${res.stdout ?? ''}\n${res.stderr ?? ''}`
    }
    throw letzter
}

/** Publiziert und gibt die Event-Id zurück — mit Quittungsprüfung. */
function publiziere(args: string[]): string {
    const aus = nak(['event', '--auth', '--sec', NSEC, ...args, ZOOID_WS])
    expect(aus, `Der Relay hat das Ereignis nicht angenommen: ${aus}`).toContain('success')
    const zeile = aus.split('\n').map((l) => l.trim()).find((l) => l.startsWith('{'))
    expect(zeile, `nak hat kein Ereignis ausgegeben: ${aus}`).toBeTruthy()
    const id = (JSON.parse(zeile as string) as { id: string }).id
    expect(id).toHaveLength(64)

    return id
}

let ids: string[] = []
let pubkey = ''

/** Öffnet ein Repository und wartet auf den GELADENEN Zustand, nicht auf eine Zeit. */
async function repo(page: Page, dtag: string): Promise<void> {
    await useZooid(page)
    await page.addInitScript((url) => {
        ;(window as unknown as { __nostrWorkspace: string }).__nostrWorkspace = url
    }, `${ZOOID_WS}/`)
    await loginNsec(page, NSEC)
    await page.goto('/forge')
    await page.locator('[data-forge-repo]').filter({ hasText: dtag }).first().click()
    await page.waitForURL(/\/forge\/naddr1/, { timeout: 30_000 })
    await expect(page.getByRole('heading', { level: 1, name: dtag, exact: true })).toBeVisible({
        timeout: 30_000,
    })
    // Auf den ZUSTAND warten: solange `view` leer ist, meldet `anlegeForm`
    // absichtlich `keins`, und jede Zählung liefe gegen 0 — grün, ohne etwas
    // geprüft zu haben.
    await page.waitForFunction(
        () => {
            const el = document.querySelector('[x-data^="nostrForge"]')
            const A = (window as unknown as { Alpine?: { $data(e: Element): { view?: unknown } } }).Alpine

            return !!el && !!A && !!A.$data(el).view
        },
        undefined,
        { timeout: 30_000 },
    )
    // Seit der GitHub-Parität (2026-08-27) ist `code` der STARTWERT der Route
    // (`forge.ts: tabFromLocation()`), nicht mehr `issues`. Der Anlege-Knopf
    // und die Filterleiste, in der er steht (`partials/forge-detail-suche.blade.php`),
    // blenden sich aber nur auf `issues`/`pulls`/`patches` ein — auf `code`
    // und `activity` bleiben sie unsichtbar. Dieser Helfer landet für ALLE
    // Tests der Datei auf der Issue-Liste, deshalb hier und nicht in jedem
    // einzelnen Test.
    // KEIN `exact: true`: der Reiter trägt bei nichtleerem Bestand einen
    // `flux:badge`-Zähler im eigenen Text („Issues 1") — derselbe Grund, aus
    // dem der Haus-Klick auf „Pull Requests" weiter unten ohne `exact` steht.
    await page.getByRole('tab', { name: 'Issues' }).click()
    await expect(page.locator('[data-forge-issue], [data-forge-empty="issues"]').first()).toBeVisible({
        timeout: 30_000,
    })
}

/**
 * Die SICHTBAREN Anlege-Knöpfe. `checkVisibility()` und nicht `offsetParent`
 * oder eine eigene Ableitung aus `position` — das Haus hat sich daran schon
 * einmal eine ausgeblendete fixe Leiste als „gerendert" melden lassen.
 */
async function knoepfe(page: Page): Promise<{ gesamt: number; sichtbar: string[] }> {
    return page.evaluate(() => {
        const alle = [...document.querySelectorAll('[data-forge-anlegen]')]

        return {
            gesamt: alle.length,
            sichtbar: alle
                .filter((el) => (el as HTMLElement).checkVisibility())
                .map((el) => (el.hasAttribute('data-forge-anlegen-kopf') ? 'kopf' : 'fab')),
        }
    })
}

test.describe('Forge: der Anlege-Knopf steht in zwei Bauformen', () => {
    test.beforeAll(() => {
        expect(NSEC, 'NOSTR_TEST_NSEC ist nicht gesetzt').toBeTruthy()
        pubkey = nak(['key', 'public', NSEC]).trim().split('\n')[0].trim()
        expect(pubkey).toHaveLength(64)

        for (const dtag of [REPO_VOLL, REPO_LEER]) {
            ids.push(publiziere([
                '-k', '30617',
                '-t', `d=${dtag}`,
                '-t', `name=${dtag}`,
                '-t', `description=Prüfstand Anlege-Knopf (${dtag}).`,
                '-t', `maintainers=${pubkey}`,
                '-t', `clone=https://example.invalid/git/${dtag}`,
            ]))
        }
        // NUR das eine Repo bekommt Issues. Das leere ist kein Beifang: der
        // Kopfstreifen der Liste existiert dort nicht, und ein Knopf, der nur
        // an ihm hinge, fehlte genau dann, wenn er gebraucht wird.
        for (let i = 0; i < 2; i++) {
            ids.push(publiziere([
                '-k', '1621',
                '-t', `a=30617:${pubkey}:${REPO_VOLL}`,
                '-t', `subject=Anlegen ${i} ${LAUF}`,
                '-c', `Rumpf ${i}`,
            ]))
        }

        // Annehmen und AUSLIEFERN sind zwei Zusagen. Ohne diese Rückfrage zeigte
        // ein späterer Fehlschlag auf die Fläche statt auf den Bestand.
        const zurueck = nak(['req', '--auth', '--sec', NSEC, '-k', '1621', '-l', '200', ZOOID_WS])
        let gefunden = 0
        for (const zeile of zurueck.split('\n')) {
            const roh = zeile.trim()
            if (!roh.startsWith('{')) {
                continue
            }
            let ev: { tags?: string[][] }
            try {
                ev = JSON.parse(roh) as { tags?: string[][] }
            } catch {
                continue
            }
            const adresse = (ev.tags ?? []).find((t) => t[0] === 'a')?.[1] ?? ''
            if (adresse.split(':').slice(2).join(':') === REPO_VOLL) {
                gefunden += 1
            }
        }
        console.log(`[anlegen] Am Relay wiedergefunden: ${REPO_VOLL}=${gefunden} Issues`)
        expect(gefunden, 'Der Relay gibt die geseeten Issues nicht wieder heraus').toBe(2)
    })

    test.afterAll(() => {
        // `--auth` ist PFLICHT: ohne quittiert der Relay mit `auth-required`,
        // `nak` druckt trotzdem Exit 0 und volles JSON, und der Bestand bliebe
        // für den nächsten Lauf liegen.
        for (const id of ids) {
            nak(['event', '--auth', '--sec', NSEC, '-k', '5', '-t', `e=${id}`, ZOOID_WS])
        }
        ids = []
    })

    /**
     * DER RIEGEL. Fünf Breiten am SELBEN Dokument, ohne Neuladen.
     *
     * 1279/1280 stehen bewusst nebeneinander: das ist die Chassis-Schwelle
     * (`DESKTOP_QUERY = (min-width: 80rem)`), und ein Grenzfall, der nur auf
     * einer Seite gemessen wird, wandert bei der nächsten Wertänderung
     * unbemerkt mit.
     */
    test('genau EIN Anlege-Knopf — auf jeder Breite, ohne Neuladen', async ({ page }) => {
        test.setTimeout(120_000)
        await repo(page, REPO_VOLL)

        const erwartet: [number, 'kopf' | 'fab'][] = [
            [390, 'fab'],
            [768, 'fab'],
            [XL - 1, 'fab'],
            [XL, 'kopf'],
            [1440, 'kopf'],
        ]

        for (const [breite, form] of erwartet) {
            await page.setViewportSize({ width: breite, height: 900 })
            // Auf die BEDINGUNG warten, nicht auf eine Wartezeit: der
            // `matchMedia`-Wechsel, Alpines Effekt und der `x-if`-Aufbau liegen
            // hintereinander. Eine feste Pause wäre geraten.
            await expect
                .poll(async () => (await knoepfe(page)).sichtbar.join(','), { timeout: 10_000 })
                .toBe(form)

            const stand = await knoepfe(page)
            // Die schärfere der beiden Zahlen: auch im DOM darf es keinen
            // zweiten Träger geben. `getByRole('button', { name: 'Neues
            // Issue' })` der sechs Bestandsfälle zählt nämlich das DOM und
            // nicht die Sichtbarkeit — ein `x-show`-verstecktes Duplikat wäre
            // dort ein Strict-Mode-Treffer auf zwei Elemente.
            expect(
                stand.gesamt,
                `Bei ${breite} px stehen ${stand.gesamt} Anlege-Knöpfe im DOM (sichtbar: ${stand.sichtbar.join(', ') || '—'})`,
            ).toBe(1)
        }

        // Und zurück: der Wechsel ist in BEIDE Richtungen reaktiv. Ohne diesen
        // Rückweg bliebe unbemerkt, dass die Fläche nur beim Verbreitern folgt.
        await page.setViewportSize({ width: 390, height: 900 })
        await expect.poll(async () => (await knoepfe(page)).sichtbar.join(','), { timeout: 10_000 }).toBe('fab')
    })

    /**
     * Am Desktop steht der Knopf da, wo gelesen wird — und er sagt, was er tut.
     * Das ist der eigentliche Befund: das runde Plus trug sein Wort nur im
     * `aria-label`.
     */
    test('am Desktop ist der Knopf beschriftet und ohne Scrollen im Bild', async ({ page }) => {
        test.setTimeout(120_000)
        await repo(page, REPO_VOLL)

        const knopf = page.locator('[data-forge-anlegen-kopf]')
        await expect(knopf).toBeVisible({ timeout: 10_000 })
        // BESCHRIFTET, nicht nur benannt: das Wort steht im Text des Knopfes.
        await expect(knopf).toHaveText('Neues Issue')
        // Und der zugängliche Name ist wörtlich der alte geblieben.
        await expect(page.getByRole('button', { name: 'Neues Issue' })).toHaveCount(1)

        // Ohne Scrollen: das Dokument steht am Anfang UND der Knopf liegt
        // vollständig im Fenster. Beides zusammen — ein Element kann im Bild
        // liegen, weil bereits jemand gerollt hat.
        const lage = await knopf.evaluate((el) => {
            const r = el.getBoundingClientRect()
            const buehne = document.querySelector('#buehne')

            return {
                top: r.top,
                unten: r.bottom,
                hoehe: window.innerHeight,
                dokRoll: document.scrollingElement?.scrollTop ?? 0,
                buehnenRoll: buehne?.scrollTop ?? 0,
            }
        })
        console.log(`[anlegen] Kopfknopf bei 1440px: top=${Math.round(lage.top)} bottom=${Math.round(lage.unten)} viewport=${lage.hoehe}`)
        expect(lage.dokRoll, 'Das Dokument ist gerollt — die Messung wäre keine Aussage über „ohne Scrollen"').toBe(0)
        expect(lage.buehnenRoll, 'Die Bühne ist gerollt (ab xl ist SIE die scrollende Fläche)').toBe(0)
        expect(lage.top).toBeGreaterThan(0)
        expect(lage.unten, 'Der Knopf liegt unterhalb des Fensterrands').toBeLessThan(lage.hoehe)

        // Und er steht ÜBER der Liste, nicht darunter — die Fluchtlinie, in der
        // gelesen wird. Gemessen gegen den Kopfstreifen der Issue-Liste.
        const listenKopf = page.locator('[data-forge-issue]').first()
        const yListe = (await listenKopf.boundingBox())?.y ?? 0
        expect(lage.top, 'Der Knopf steht unterhalb der ersten Issue-Zeile').toBeLessThan(yListe)
    })

    /** Der FAB ist am Desktop WEG — nicht nur unsichtbar, sondern nicht da. */
    test('am Desktop gibt es den FAB nicht mehr', async ({ page }) => {
        test.setTimeout(120_000)
        await repo(page, REPO_VOLL)
        await expect(page.locator('[data-forge-fab]')).toHaveCount(0, { timeout: 10_000 })

        await page.setViewportSize({ width: 390, height: 844 })
        await expect(page.locator('[data-forge-fab]')).toHaveCount(1, { timeout: 10_000 })
        await expect(page.locator('[data-forge-anlegen-kopf]')).toHaveCount(0)
    })

    /**
     * Das leere Repository. Hier gäbe es keinen Kopfstreifen, an den man den
     * Knopf hätte hängen können — und hier zählt er am meisten.
     */
    test('über einem leeren Repository steht der Knopf trotzdem', async ({ page }) => {
        test.setTimeout(120_000)
        await repo(page, REPO_LEER)

        await expect(page.locator('[data-forge-empty="issues"]')).toBeVisible({ timeout: 30_000 })
        const knopf = page.locator('[data-forge-anlegen-kopf]')
        await expect(knopf).toBeVisible()
        await expect(knopf).toHaveText('Neues Issue')
        // Das Suchfeld ist AUS (es gibt nichts zu durchsuchen), die Leiste steht
        // trotzdem. Ohne diese Zusage wäre die Leiste nur zufällig da.
        await expect(page.locator('[data-forge-detail-suche-feld]')).toBeHidden()
        // Und der Knopf steht über der Leermeldung, nicht daneben oder darunter.
        const yKnopf = (await knopf.boundingBox())?.y ?? 0
        const yLeer = (await page.locator('[data-forge-empty="issues"]').boundingBox())?.y ?? 0
        expect(yKnopf).toBeLessThan(yLeer)
    })

    /**
     * Der Schreibpfad, ausgelöst über die TASTATUR — `click()` läuft im Haus auf
     * `aria-disabled` in einen 30-s-Timeout, und dieser Knopf KANN inert werden
     * (ohne Schreibrecht). Der Weg bleibt deshalb derselbe wie beim FAB-Fall in
     * `desktop-forge-feinschliff.spec.ts`.
     */
    test('der neue Knopf öffnet dasselbe Blatt und gibt den Fokus zurück', async ({ page }) => {
        test.setTimeout(120_000)
        await repo(page, REPO_VOLL)

        const knopf = page.locator('[data-forge-anlegen-kopf]')
        await expect(knopf).toBeVisible({ timeout: 10_000 })
        await expect(knopf).toHaveAttribute('aria-expanded', 'false')
        await expect(knopf).toHaveAttribute('aria-haspopup', 'dialog')

        await knopf.focus()
        await page.keyboard.press('Enter')

        const blatt = page.locator('[data-forge-issue-blatt]')
        await expect(blatt).toBeVisible()
        await expect(knopf).toHaveAttribute('aria-expanded', 'true')
        await expect(page.locator('[data-forge-issue-form]')).toHaveCount(1)

        await page.keyboard.press('Escape')
        await expect(blatt).toBeHidden()
        await expect(page.locator('[data-forge-issue-form]')).toHaveCount(0)
        await expect(knopf).toHaveAttribute('aria-expanded', 'false')
        expect(
            await page.evaluate(
                () => (document.activeElement as HTMLElement)?.hasAttribute('data-forge-anlegen-kopf'),
            ),
            'Der Fokus ist nicht auf den Knopf zurückgekehrt',
        ).toBe(true)
    })

    /**
     * Auf den anderen Reitern trägt der Desktop KEINEN Anlege-Knopf — „Neues
     * Issue" über einer Patch-Liste wäre eine Beschriftung, die nicht zu ihrer
     * Umgebung passt. Wichtig ist die Richtung der Zusage: höchstens einer, nie
     * zwei.
     */
    test('auf anderen Reitern steht am Desktop keiner — und nie zwei', async ({ page }) => {
        test.setTimeout(120_000)
        await repo(page, REPO_VOLL)
        await expect(page.locator('[data-forge-anlegen-kopf]')).toBeVisible({ timeout: 10_000 })

        await page.getByRole('tab', { name: 'Pull Requests' }).click()
        await expect.poll(async () => (await knoepfe(page)).gesamt, { timeout: 10_000 }).toBe(0)

        // Im Mobil-Chassis dagegen bleibt der FAB auf demselben Reiter stehen —
        // er ist dort der einzige Weg und schaltet beim Öffnen selbst um.
        await page.setViewportSize({ width: 390, height: 844 })
        await expect.poll(async () => (await knoepfe(page)).sichtbar.join(','), { timeout: 10_000 }).toBe('fab')
    })
})
