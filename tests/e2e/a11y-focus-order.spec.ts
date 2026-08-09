import { test, expect, type Page } from './support/fixtures'
import { execFileSync } from 'node:child_process'
import { useZooid, ZOOID_WS } from './support/zooid'
import { loginNsec } from './support/login'
import { cleanupRooms, trackRoom } from './support/rooms'

/**
 * P3.5 (Fokus-Reihenfolge) + P3.6 (ARIA-Live-Regression) — Playwright, weil
 * `document.activeElement` und tatsächlich gerenderte ARIA-Attribute nur im
 * echten DOM prüfbar sind. Statisches Markup deckt bereits
 * `tests/Feature/EmptyStatesAndA11yTest.php` ab.
 */

const NSEC = process.env.NOSTR_TEST_NSEC as string
const NAK = process.env.NAK ?? `${process.env.HOME}/go/bin/nak`
const ADMIN_HEX = 'b2ee09a54bedf17ee1db562bdddd75c48661d981eb52c49dc206c55ba8439414'

function createRoomNak(h: string, name: string): void {
    trackRoom(h)
    execFileSync(NAK, ['event', '--auth', '--sec', ADMIN_HEX, '-k', '9007', '-t', `h=${h}`, ZOOID_WS])
    execFileSync(NAK, ['event', '--auth', '--sec', ADMIN_HEX, '-k', '9002', '-t', `h=${h}`, '-t', `name=${name}`, ZOOID_WS])
}

/** Liest `document.activeElement`s x-ref-Namen (oder Tag+Text als Fallback). */
async function focusedRef(page: Page): Promise<string> {
    return page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null
        if (!el || el === document.body) {
            return 'BODY'
        }
        for (const [k, v] of Object.entries(el.dataset ?? {})) {
            void k
            void v
        }
        // Alpine speichert x-ref nicht als eigenes Attribut nach dem Parsen weg,
        // aber x-ref BLEIBT als literales Attribut im DOM stehen.
        return el.getAttribute('x-ref') ?? `${el.tagName}:${(el.textContent ?? '').trim().slice(0, 30)}`
    })
}

test.afterAll(() => cleanupRooms(ZOOID_WS, ADMIN_HEX))

test.describe('Leerer Raum: Fokus-Kaskade nach Zustand (P3.1/P3.5)', () => {
    test('Mitglied (beigetreten, 0 Nachrichten) → Fokus auf den Composer', async ({ page }) => {
        const h = `focus1${Date.now()}`
        createRoomNak(h, 'Focus1')
        // NSEC tritt selbst bei (9021) — Mitglied, aber leerer Verlauf.
        execFileSync(NAK, ['event', '--auth', '--sec', NSEC, '-k', '9021', '-t', `h=${h}`, ZOOID_WS])

        await useZooid(page)
        await loginNsec(page, NSEC)
        await page.goto(`/rooms/${h}`)

        const cta = page.getByRole('button', { name: 'Schreib die erste.' })
        await expect(cta).toBeVisible({ timeout: 15_000 })
        await cta.click()
        await expect(page.getByPlaceholder('Nachricht schreiben…')).toBeFocused({ timeout: 5_000 })
    })

    test('angemeldet, NICHT beigetreten → Fokus auf den Beitreten-Knopf', async ({ page }) => {
        const h = `focus2${Date.now()}`
        createRoomNak(h, 'Focus2')

        await useZooid(page)
        await loginNsec(page, NSEC)
        await page.goto(`/rooms/${h}`)

        const cta = page.getByRole('button', { name: 'Schreib die erste.' })
        await expect(cta).toBeVisible({ timeout: 15_000 })
        await cta.click()
        await expect(page.getByRole('button', { name: 'Beitreten' })).toBeFocused({ timeout: 5_000 })
    })

    test('Gast → Fokus auf den Gast-Composer', async ({ page }) => {
        const h = `focus3${Date.now()}`
        createRoomNak(h, 'Focus3')

        await useZooid(page)
        await loginNsec(page, NSEC)
        await page.goto(`/rooms/${h}`)
        await page.evaluate(() => localStorage.removeItem('pubkey'))
        await page.reload()
        expect(await page.evaluate(() => (window as any).Alpine?.store('authGate')?.authed)).toBe(false)

        const cta = page.getByRole('button', { name: 'Schreib die erste.' })
        await expect(cta).toBeVisible({ timeout: 15_000 })
        await cta.click()
        await expect(page.getByRole('button', { name: /Nachricht schreiben…\s*,\s*anmelden erforderlich/ })).toBeFocused({
            timeout: 5_000,
        })
    })
})

test.describe('Suche-ohne-Treffer: Fokus zurück ins Suchfeld (P3.1/P3.5)', () => {
    /**
     * BEFUND vom 2026-08-09 war zur Hälfte richtig, vom `design-lead` korrigiert
     * (gemessen gegen die APP-EIGENE Alpine-Version 3.15.12 aus
     * `vendor/livewire/livewire/dist/livewire.js`, jsdom-Harnisch mit
     * Negativ-Kontrolle): `$nextTick(fn)` LÄUFT — `tickStack` ist bei Alpine
     * global, geht also nicht verloren. Was verlorengeht, ist die Auflösung der
     * Magics INNERHALB von `fn`: `$refs`/`$root` sind DOM-AUFSTIEGE ab dem
     * Handler-Element (`findClosest` bricht bei `!el.parentElement` ab). `x-if`
     * entfernt den Knopf SYNCHRON im Mikro-Task, `$nextTick` erst im Makro-Task
     * danach — der Aufstieg endet dann nach zwei Ebenen im Leeren. In
     * `⚡directory` blieb das still (`undefined?.focus()`), in `⚡spaces` WARF es
     * sogar (`$root` war `undefined`). Der Fix dreht die Reihenfolge um, statt zu
     * deferren: „erst fokussieren, dann leeren" — `x-on:click="$refs.search?.
     * focus(); query = ''"` bzw. `x-on:click="($root.querySelector(...) ??
     * $refs.roomList)?.focus(); roomQuery = ''"`. Synchron hängt der Knopf beim
     * Fokussieren noch im Baum, das Entfernen danach rührt den bereits
     * fokussierten Nachbarn nicht an.
     */
    test('Mitgliederverzeichnis', async ({ page }) => {
        await useZooid(page)
        await loginNsec(page, NSEC)
        await page.goto('/directory')

        const search = page.getByPlaceholder('Mitglied suchen…')
        await expect(search).toBeVisible({ timeout: 15_000 })
        await search.fill('kein-mensch-heisst-so-xyz123')
        await expect(page.getByRole('button', { name: 'Suche leeren' })).toBeVisible({ timeout: 10_000 })
        await page.getByRole('button', { name: 'Suche leeren' }).click()
        await expect(search).toBeFocused({ timeout: 5_000 })
        await expect(search).toHaveValue('')
    })

    test('Raumliste (mobil, xl:hidden)', async ({ page }) => {
        await useZooid(page)
        await loginNsec(page, NSEC)
        await page.goto('/spaces')

        const search = page.getByPlaceholder('Raum suchen…')
        await expect(search).toBeVisible({ timeout: 15_000 })
        await search.fill('kein-raum-heisst-so-xyz123')
        await expect(page.getByRole('button', { name: 'Suche leeren' })).toBeVisible({ timeout: 10_000 })
        await page.getByRole('button', { name: 'Suche leeren' }).click()
        await expect(search).toBeFocused({ timeout: 5_000 })
        await expect(search).toHaveValue('')
    })

    /**
     * DRITTER Fall, den der `??`-Auffang erst mitbringt: `roomQuery` kann aus
     * `?q=` an der URL stammen, während `showRoomSearch()` (≥10 Standard-Räume)
     * das Suchfeld selbst gar nicht rendert — dann hat `$root.querySelector(
     * '[data-room-search] input')` nichts zu finden, und OHNE den `??
     * $refs.roomList`-Auffang bliebe der Fokus auf `<body>`. Unser Seed hat immer
     * ≥10 Standardräume (`showRoomSearch()` ist nie false) — eine zweite,
     * raumarme Test-Instanz nur für diese eine Kante wäre unverhältnismäßig
     * teuer. Stattdessen wird das Suchfeld nach dem Laden gezielt aus dem DOM
     * entfernt: der Klick-Handler ruft dieselbe `$root.querySelector(...)` auf
     * die LIVE-DOM, unabhängig davon, ob `showRoomSearch()` sie nie gerendert
     * oder ob der Test sie entfernt hat — der Codepfad (Selector trifft nichts →
     * `??`-Auffang) ist identisch.
     */
    test('Suchfeld nicht gerendert (?q= ohne showRoomSearch()) → Fokus auf roomList-Auffang, nicht <body>', async ({ page }) => {
        await useZooid(page)
        await loginNsec(page, NSEC)
        await page.goto('/spaces?q=kein-raum-heisst-so-xyz123')

        const cta = page.getByRole('button', { name: 'Suche leeren' })
        await expect(cta).toBeVisible({ timeout: 15_000 })

        // Simuliert `showRoomSearch() === false`: das Suchfeld existiert nicht im
        // DOM, wenn der Knopf geklickt wird — derselbe Effekt, den eine raumarme
        // Instanz hätte, ohne eine zweite Relay-Instanz aufzusetzen.
        await page.evaluate(() => document.querySelector('[data-room-search]')?.remove())

        await cta.click()
        const active = await page.evaluate(() => {
            const el = document.activeElement as HTMLElement | null
            return el ? el.getAttribute('x-ref') ?? el.tagName : 'NONE'
        })
        expect(active).toBe('roomList')
        expect(active).not.toBe('BODY')
    })
})

test.describe('room-form-Modal: Fokus nach Schließen NIE auf <body> (P3.5, spaces:530)', () => {
    test('normaler Fall: nativer Dialog-Fokus kehrt zum Auslöser zurück', async ({ page }) => {
        await useZooid(page)
        await loginNsec(page, ADMIN_HEX)
        await page.goto('/spaces')

        const trigger = page.getByRole('button', { name: 'Neuen Raum anlegen', exact: true })
        await expect(trigger).toBeVisible({ timeout: 15_000 })
        await trigger.click()
        const modal = page.locator('dialog[data-modal="room-form"]')
        await expect(modal).toBeVisible({ timeout: 10_000 })
        await page.keyboard.press('Escape')
        await expect(modal).toBeHidden({ timeout: 5_000 })
        expect(await focusedRef(page)).not.toBe('BODY')
    })

    test('Auslöser beim Schließen bereits aus dem DOM entfernt (reaktiver Re-Render) → Fallback auf roomList statt <body>', async ({
        page,
    }) => {
        // Reproduziert exakt das Szenario aus dem Kommentar am `room-form`-Modal:
        // der Leerzustand "Dieser Space hat noch keine Räume." öffnet denselben
        // Dialog, und sein Knopf verschwindet, sobald sich der Raumbestand ändert
        // (x-if kippt). Statt eine komplett raumlose Testinstanz aufzusetzen
        // (eigener Relay-Stack, hohe Kosten für diese eine Kante), wird der
        // reale Effekt "Auslöser weg, während der Dialog offen ist" hier direkt
        // simuliert: derselbe Dialog, derselbe x-on:close-Handler, der einzige
        // Unterschied ist WORÜBER der Auslöser verschwindet.
        await useZooid(page)
        await loginNsec(page, ADMIN_HEX)
        await page.goto('/spaces')

        const trigger = page.getByRole('button', { name: 'Neuen Raum anlegen', exact: true })
        await expect(trigger).toBeVisible({ timeout: 15_000 })
        await trigger.click()
        const modal = page.locator('dialog[data-modal="room-form"]')
        await expect(modal).toBeVisible({ timeout: 10_000 })

        await trigger.evaluate((el) => el.remove())
        await page.keyboard.press('Escape')
        await expect(modal).toBeHidden({ timeout: 5_000 })

        // Der native Fokus-Rückgabe-Mechanismus des <dialog> findet sein Ziel
        // nicht mehr → OHNE den Fallback bliebe der Fokus auf <body>.
        expect(await focusedRef(page)).toBe('roomList')
    })
})

test.describe('ARIA-Live-Region (P3.6): live im DOM, nicht nur im Quelltext', () => {
    test('Chat-Verlauf trägt role="log" aria-live="polite" aria-relevant="additions" VOR dem ersten Render', async ({ page }) => {
        const h = `aria1${Date.now()}`
        createRoomNak(h, 'Aria1')

        await useZooid(page)
        await loginNsec(page, NSEC)
        await page.goto(`/rooms/${h}`)

        const log = page.getByRole('log', { name: 'Chat-Verlauf' })
        await expect(log).toBeVisible({ timeout: 15_000 })
        await expect(log).toHaveAttribute('aria-live', 'polite')
        await expect(log).toHaveAttribute('aria-relevant', 'additions')
    })
})
