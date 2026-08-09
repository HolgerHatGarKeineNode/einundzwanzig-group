import { test, expect, type Page } from './support/fixtures'
import type { BrowserContext } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { neventEncode } from 'nostr-tools/nip19'
import { useZooid, ZOOID_WS } from './support/zooid'
import { loginNsec } from './support/login'
import { cleanupRooms, trackRoom } from './support/rooms'

/**
 * P3.2/P3.3 (Einstieg für Gäste, gatender Composer, pendingReturn) — Playwright,
 * weil hier echtes Client-Verhalten geprüft wird (localStorage-Persistenz über
 * einen HARTEN Reload, Login-Sheet-Redirect, Alpine-Store-Zustand). Das statische
 * Markup deckt bereits `tests/Feature/EmptyStatesAndA11yTest.php` ab.
 *
 * WICHTIG: Beitreten-Karte, Gast-Composer und die Einstiegszeile hängen alle an
 * `x-show` (nicht `x-if`) — sie bleiben im DOM, nur `display` wechselt. Deshalb
 * überall `toBeHidden()`/`toBeVisible()`, NIE `toHaveCount(0)` — letzteres zählt
 * DOM-Präsenz und wäre für ein bloß verstecktes Element immer 1, egal was der
 * Store sagt (in einer ersten Fassung fielen genau daran mehrere Assertions).
 */

const NSEC = process.env.NOSTR_TEST_NSEC as string
const NAK = process.env.NAK ?? `${process.env.HOME}/go/bin/nak`
const ADMIN_HEX = 'b2ee09a54bedf17ee1db562bdddd75c48661d981eb52c49dc206c55ba8439414'

function createRoomNak(h: string, name: string): void {
    trackRoom(h)
    execFileSync(NAK, ['event', '--auth', '--sec', ADMIN_HEX, '-k', '9007', '-t', `h=${h}`, ZOOID_WS])
    execFileSync(NAK, ['event', '--auth', '--sec', ADMIN_HEX, '-k', '9002', '-t', `h=${h}`, '-t', `name=${name}`, ZOOID_WS])
}

/**
 * Simuliert den client-seitigen Gast-Zustand: eine ECHTE Server-Session (das Web-
 * Gate `nostr.auth` verlangt `nostr_pubkey` in der Session), aber KEIN welshman-
 * Signer im Browser. Genau das, was `$store.authGate.authed` prüft
 * (`isAuthed(localStorage.getItem('pubkey'))`) — auf dem Gerät (NativePHP, kein
 * Server-Gate) ist das der Normalfall für jeden, der noch keine Identität verbunden
 * hat; im Web-Test ist das Entfernen des Signers nach einem echten Login der
 * kürzeste Weg dorthin, ohne die Server-Middleware anzufassen (die für ALLE
 * anderen Specs im selben Worker gilt).
 *
 * Verifiziert am 2026-08-09 gegen einen frischen Wegwerf-Raum: das Relay lässt
 * einen signerlosen Client lesend zu (kein NIP-42-AUTH nötig für kind 9 in einem
 * nicht-privaten Raum), `loading` löst sich normal auf.
 */
async function visitRoomAsGuest(page: Page, h: string): Promise<void> {
    await useZooid(page)
    await loginNsec(page, NSEC)
    await page.goto(`/rooms/${h}`)
    await page.evaluate(() => localStorage.removeItem('pubkey'))
    await page.reload()
}

const guestAuthed = (page: Page) => page.evaluate(() => (window as any).Alpine?.store('authGate')?.authed)

/** Eigener Browser-Kontext (getrennte localStorage/Cookies) für einen ZWEITEN, unabhängigen Login. */
async function freshContext(ctx: BrowserContext): Promise<{ page: Page; close: () => Promise<void> }> {
    const c = await ctx.browser()!.newContext()
    const page = await c.newPage()
    return { page, close: () => c.close() }
}

const guestComposer = (page: Page, name: RegExp) => page.getByRole('button', { name })
const ROOM_COMPOSER_NAME = /Nachricht schreiben…\s*,\s*anmelden erforderlich/
const THREAD_COMPOSER_NAME = /Im Thread antworten…\s*,\s*anmelden erforderlich/

test.afterAll(() => cleanupRooms(ZOOID_WS, ADMIN_HEX))

test.describe('Einstiegszeile für Gäste (P3.2)', () => {
    test('erscheint beim ersten Gast-Besuch, fehlt für ein angemeldetes Mitglied', async ({ page, context }) => {
        const h = `onboard1${Date.now()}`
        createRoomNak(h, 'Onboard1')

        await visitRoomAsGuest(page, h)
        expect(await guestAuthed(page)).toBe(false)
        await expect(page.getByText('Du liest mit. Zum Mitschreiben anmelden.')).toBeVisible({ timeout: 15_000 })

        // Getrennter Kontext (eigene localStorage!), echtes Login (Mitglied) — die
        // Zeile darf nicht erscheinen.
        const { page: page2, close } = await freshContext(context)
        await useZooid(page2)
        await loginNsec(page2, NSEC)
        await page2.goto(`/rooms/${h}`)
        await expect(page2.getByText('Du liest mit. Zum Mitschreiben anmelden.')).toBeHidden({ timeout: 10_000 })
        await close()
    })

    test('Schließen überlebt einen harten Reload (localStorage, NICHT Session) — Kontrastprobe: Löschen von localStorage lässt sie zurückkommen', async ({
        page,
    }) => {
        const h = `onboard2${Date.now()}`
        createRoomNak(h, 'Onboard2')

        await visitRoomAsGuest(page, h)
        const hint = page.getByText('Du liest mit. Zum Mitschreiben anmelden.')
        await expect(hint).toBeVisible({ timeout: 15_000 })

        await page.getByRole('button', { name: 'Hinweis schließen' }).click()
        await expect(hint).toBeHidden()
        expect(await page.evaluate(() => localStorage.getItem('e21:guest-hint'))).toBe('closed')
        expect(await page.evaluate(() => sessionStorage.getItem('e21:guest-hint'))).toBeNull()

        // Harter Reload — bleibt geschlossen (localStorage überlebt).
        await page.reload()
        await expect(hint).toBeHidden({ timeout: 10_000 })

        // Kontrastprobe: OHNE den localStorage-Eintrag kommt die Zeile zurück — das
        // beweist, dass ihr Verschwinden tatsächlich AN diesem Schlüssel hängt und
        // nicht zufällig (z.B. an einem Session-Cookie, das der Reload sowieso behält).
        await page.evaluate(() => localStorage.removeItem('e21:guest-hint'))
        await page.reload()
        await expect(hint).toBeVisible({ timeout: 10_000 })
    })
})

test.describe('Gast-Composer (P3.3)', () => {
    test('sichtbar in Raum UND Thread, Klick öffnet das Login-Sheet mit Kontextzeile', async ({ page }) => {
        const h = `onboard3${Date.now()}`
        createRoomNak(h, 'Onboard3')
        // Eine echte Wurzel-Nachricht, damit der Thread-Deep-Link existiert.
        execFileSync(NAK, ['event', '--auth', '--sec', ADMIN_HEX, '-k', '9', '-t', `h=${h}`, '-c', 'Wurzel', ZOOID_WS])
        const rootId = execFileSync(NAK, ['req', '-k', '9', '-t', `h=${h}`, '--auth', '--sec', NSEC, ZOOID_WS])
            .toString()
            .trim()
            .split('\n')
            .map((l) => JSON.parse(l))[0].id as string

        await visitRoomAsGuest(page, h)

        const roomComposer = guestComposer(page, ROOM_COMPOSER_NAME)
        await expect(roomComposer).toBeVisible({ timeout: 15_000 })
        await roomComposer.click()

        const sheet = page.getByRole('dialog', { name: 'Anmelden' })
        await expect(sheet).toBeVisible({ timeout: 10_000 })
        await expect(sheet.getByText('Melde dich an, um in diesem Raum zu schreiben.')).toBeVisible()
        await sheet.getByRole('button', { name: 'Schließen' }).click()
        await expect(sheet).toBeHidden()

        // Thread-Deep-Link (`/rooms/{h}/thread/{nevent}`) — derselbe gatende Fuß.
        const nevent = neventEncode({ id: rootId, relays: [], kind: 9 })
        await page.goto(`/rooms/${h}/thread/${nevent}`)
        const threadComposer = guestComposer(page, THREAD_COMPOSER_NAME)
        await expect(threadComposer).toBeVisible({ timeout: 15_000 })
    })

    test('pendingReturn: Login aus dem Gast-Composer-Sheet führt zurück in denselben Raum', async ({ page }) => {
        const h = `onboard4${Date.now()}`
        createRoomNak(h, 'Onboard4')

        await visitRoomAsGuest(page, h)

        const roomComposer = guestComposer(page, ROOM_COMPOSER_NAME)
        await expect(roomComposer).toBeVisible({ timeout: 15_000 })
        await roomComposer.click()
        const sheet = page.getByRole('dialog', { name: 'Anmelden' })
        await expect(sheet).toBeVisible({ timeout: 10_000 })

        // Login INNERHALB des Sheets (nicht über /nostr-login navigieren — das Sheet
        // mountet dieselbe login-form-Insel in-place).
        await sheet.getByRole('button', { name: 'Andere Optionen' }).click()
        await sheet.getByLabel('Ich verstehe das Risiko').check()
        await sheet.getByPlaceholder(/nsec1/).fill(NSEC)
        await sheet.getByRole('button', { name: /Trotzdem anmelden/ }).click()

        // Der Server-Handoff (NIP-98) navigiert hart — landet wieder auf DEMSELBEN
        // Raum, nicht auf /spaces (das Default-Ziel für "kein gemerktes Ziel").
        // Der Account ist frisch angemeldet, aber diesem Wegwerf-Raum noch NICHT
        // beigetreten — die Beitreten-Karte (statt des Gast-Composers) ist der
        // Beleg, dass `authGate.authed` jetzt true ist UND wir im richtigen Raum
        // gelandet sind (nicht z.B. auf /spaces).
        await page.waitForURL(`**/rooms/${h}`, { timeout: 15_000 })
        await expect(page.getByRole('button', { name: 'Beitreten' })).toBeVisible({ timeout: 15_000 })
        await expect(guestComposer(page, ROOM_COMPOSER_NAME)).toBeHidden()
    })
})

test.describe('Beitreten-Karte (P3.1, Raum-Fuß)', () => {
    test('sichtbar für angemeldete Nicht-Mitglieder, NICHT für Gäste (Gast-Composer stattdessen)', async ({ page }) => {
        const h = `onboard5${Date.now()}`
        createRoomNak(h, 'Onboard5')

        // Angemeldet, nicht beigetreten.
        await useZooid(page)
        await loginNsec(page, NSEC)
        await page.goto(`/rooms/${h}`)
        await expect(page.getByRole('button', { name: 'Beitreten' })).toBeVisible({ timeout: 15_000 })
        await expect(guestComposer(page, ROOM_COMPOSER_NAME)).toBeHidden()

        // Gast: KEINE Beitreten-Karte, Gast-Composer stattdessen.
        await page.evaluate(() => localStorage.removeItem('pubkey'))
        await page.reload()
        expect(await guestAuthed(page)).toBe(false)
        await expect(page.getByRole('button', { name: 'Beitreten' })).toBeHidden({ timeout: 10_000 })
        await expect(guestComposer(page, ROOM_COMPOSER_NAME)).toBeVisible()
    })
})
