import { test, expect, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { useZooid } from './support/zooid'

const NSEC = process.env.NOSTR_TEST_NSEC as string
const NAK = '/home/user/go/bin/nak'
const ADMIN = 'b2ee09a54bedf17ee1db562bdddd75c48661d981eb52c49dc206c55ba8439414'

/** Loggt via nsec ein und öffnet den Chat eines Raums (default „welcome"). */
async function openRoom(page: Page, h = 'welcome'): Promise<void> {
    await useZooid(page)
    await page.goto('/nostr-login')
    await page.getByPlaceholder(/nsec1/).fill(NSEC)
    await page.getByRole('button', { name: 'Anmelden' }).click()
    await page.waitForURL('**/spaces')
    await page.goto(`/rooms/${h}`)
}

/**
 * M4 (Chat lesen) — der Room-Verlauf lädt vom Space-Relay, Text wird gerendert
 * (Emoji + Link als Anchor), Absender-Profile sind aufgelöst (Namen statt npub),
 * und die Pagination-Aktion ist da.
 */
test('M4: Room-Verlauf lädt, Text + Profile gerendert', async ({ page }) => {
    await openRoom(page)

    // Nachrichtentext (inkl. Emoji)
    await expect(page.getByText('Willkommen im Space! 👋')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('Danke!', { exact: true })).toBeVisible()

    // Profile aufgelöst (kind-0-Namen, nicht npub)
    await expect(page.getByText('Alice Test').first()).toBeVisible()
    await expect(page.getByText('Relay Admin').first()).toBeVisible()

    // Link im Inhalt wird als Anchor gerendert (welshman/content)
    await expect(page.getByRole('link', { name: /einundzwanzig\.space/ })).toBeVisible()

    // Pagination-Affordanz
    await expect(page.getByRole('button', { name: /Ältere laden/ })).toBeVisible()
})

test('M4: neue Nachricht erscheint live', async ({ page }) => {
    await openRoom(page)
    await expect(page.getByText('Willkommen im Space! 👋')).toBeVisible({ timeout: 15_000 })

    // Eindeutige Nachricht direkt in den Relay publizieren (nicht über die App —
    // Senden ist M5) und die Live-Subscription der Insel prüfen.
    const marker = `Live-${Math.floor(Math.random() * 1e9)}`
    execFileSync(NAK, [
        'event', '--auth', '--sec', ADMIN, '-k', '9', '-t', 'h=welcome',
        '-c', `E2E ${marker}`, 'ws://localhost:3334',
    ])

    await expect(page.getByText(`E2E ${marker}`)).toBeVisible({ timeout: 15_000 })
})

/**
 * M5 (Senden) — der eingeloggte User ist Mitglied von „welcome", schreibt eine
 * Nachricht über den Composer; sie erscheint optimistisch im eigenen Verlauf,
 * der Composer wird geleert.
 */
test('M5: Nachricht senden', async ({ page }) => {
    await openRoom(page)
    await expect(page.getByText('Willkommen im Space! 👋')).toBeVisible({ timeout: 15_000 })

    const marker = `Send-${Math.floor(Math.random() * 1e9)}`
    const composer = page.getByPlaceholder('Nachricht schreiben…')
    await composer.fill(`Hallo ${marker}`)
    await page.getByRole('button', { name: 'Senden' }).click()

    await expect(page.getByText(`Hallo ${marker}`)).toBeVisible({ timeout: 15_000 })
    await expect(composer).toHaveValue('')
})

/** M5 (Löschen) — eine eigene Nachricht lässt sich löschen und verschwindet. */
test('M5: eigene Nachricht löschen', async ({ page }) => {
    await openRoom(page)
    await expect(page.getByText('Willkommen im Space! 👋')).toBeVisible({ timeout: 15_000 })

    const marker = `Del-${Math.floor(Math.random() * 1e9)}`
    await page.getByPlaceholder('Nachricht schreiben…').fill(marker)
    await page.getByRole('button', { name: 'Senden' }).click()

    const message = page.getByText(marker, { exact: true })
    await expect(message).toBeVisible({ timeout: 15_000 })

    // Löschen-Button der eigenen Nachricht (in derselben Zeile).
    await page.locator('div.group', { hasText: marker }).getByRole('button', { name: 'Nachricht löschen' }).click()
    await expect(page.getByText(marker, { exact: true })).toHaveCount(0, { timeout: 15_000 })
})

/**
 * M5 (Join/Leave) — echte, relay-seitige NIP-29-Mitgliedschaft (39002). „dev" ist
 * ein Raum, dem der User nicht beigetreten ist: Beitreten-Hinweis + kein Composer.
 * Nach Beitreten (kind 9021, auto-approve) erscheint der Composer, die Mitglied-
 * schaft **übersteht einen Reload** (der Kern des Bugs), Verlassen dreht es zurück.
 */
test('M5: Raum beitreten, persistiert über Reload, verlassen', async ({ page }) => {
    await openRoom(page, 'dev')

    const joinBtn = page.getByRole('button', { name: 'Beitreten' })
    const leaveBtn = page.getByRole('button', { name: 'Raum verlassen' })
    const composer = page.getByPlaceholder('Nachricht schreiben…')

    // Nicht Mitglied → Hinweis, kein Composer
    await expect(joinBtn).toBeVisible({ timeout: 15_000 })
    await expect(composer).toBeHidden()

    // Beitreten → relay-seitige Mitgliedschaft → Composer
    await joinBtn.click()
    await expect(composer).toBeVisible({ timeout: 15_000 })
    await expect(leaveBtn).toBeVisible()

    // Persistenz: nach hartem Reload weiterhin Mitglied (39002 liegt auf dem Relay)
    await page.reload()
    await expect(composer).toBeVisible({ timeout: 15_000 })
    await expect(joinBtn).toBeHidden()

    // Verlassen → zurück zum Hinweis (Zustand für Wiederholläufe zurücksetzen)
    await leaveBtn.click()
    await expect(joinBtn).toBeVisible({ timeout: 15_000 })
    await expect(composer).toBeHidden()
})

/**
 * M6 (Reply/Quote) — auf eine Nachricht antworten: der Reply-Kontext erscheint
 * über dem Composer; die gesendete Antwort trägt eine Zitat-Vorschau der
 * Ursprungsnachricht (q-Tag + `nostr:nevent`, im selben Raum aufgelöst).
 */
test('M6: auf eine Nachricht antworten (Zitat)', async ({ page }) => {
    await openRoom(page)
    await expect(page.getByText('Willkommen im Space! 👋')).toBeVisible({ timeout: 15_000 })

    const a = `Frage-${Math.floor(Math.random() * 1e9)}`
    const b = `Antwort-${Math.floor(Math.random() * 1e9)}`
    const composer = page.getByPlaceholder('Nachricht schreiben…')

    // Nachricht A senden
    await composer.fill(a)
    await page.getByRole('button', { name: 'Senden' }).click()
    await expect(page.getByText(a, { exact: true })).toBeVisible({ timeout: 15_000 })

    // Auf A antworten → Reply-Kontext erscheint
    await page.locator('div.group', { hasText: a }).getByRole('button', { name: 'Antworten' }).click()
    await expect(page.getByText('Antwort an')).toBeVisible()

    // Antwort B senden → B ist da UND zitiert A (Original + Zitat = 2× A)
    await composer.fill(b)
    await page.getByRole('button', { name: 'Senden' }).click()
    await expect(page.getByText(b, { exact: true })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(a, { exact: true })).toHaveCount(2)
})

/** Publiziert eine kind-9-Nachricht direkt in „scroll" (fremder Autor = ADMIN). */
function publishToScroll(content: string): void {
    execFileSync(NAK, [
        'event', '--auth', '--sec', ADMIN, '-k', '9', '-t', 'h=scroll',
        '-c', content, 'ws://localhost:3334',
    ])
}

/**
 * D1 (Auto-Load-Older) — „scroll" hat 60 Nachrichten, initial werden nur die
 * jüngsten 50 geladen (Zeile 11–60). Am oberen Rand lädt der Verlauf die ältere
 * Seite automatisch nach; „Zeile 1" erscheint, ohne den Button zu klicken.
 */
test('D1: Ältere laden automatisch beim Hochscrollen', async ({ page }) => {
    await openRoom(page, 'scroll')
    await expect(page.getByText('Zeile 60', { exact: true })).toBeVisible({ timeout: 15_000 })

    // Älteste Nachricht ist initial nicht geladen (jenseits des 50er-Limits).
    await expect(page.getByText('Zeile 1', { exact: true })).toHaveCount(0)

    // Wiederholt an den oberen Rand scrollen, bis die ältere Seite nachgeladen ist.
    // (toPass fängt den seltenen Fall ab, dass ein Live-Emit im 50-ms-Scroll-Debounce
    // kurz ans Ende zurückspringt.)
    const log = page.locator('[role=log]')
    await expect(async () => {
        await log.hover()
        await page.mouse.wheel(0, -6000)
        await expect(page.getByText('Zeile 1', { exact: true })).toBeVisible({ timeout: 1500 })
    }).toPass({ timeout: 25_000 })
})

/**
 * D1 (Unread-Zähler + Jump) — hochgescrollt erscheint der Zurück-ans-Ende-Button;
 * zwei live eintreffende Fremd-Nachrichten ergeben „2 neue" (der alte Zähler
 * addierte pro Emit statt echte Nachrichten). Der Klick springt ans Ende und
 * blendet Zähler + Button aus.
 */
test('D1: Unread-Zähler zählt Nachrichten, Jump springt ans Ende', async ({ page }) => {
    await openRoom(page, 'scroll')
    await expect(page.getByText('Zeile 60', { exact: true })).toBeVisible({ timeout: 15_000 })

    const jumpBtn = page.getByRole('button', { name: 'Zum Ende springen' })
    // Am Ende → kein Jump-Button.
    await expect(jumpBtn).toBeHidden()

    // Robust hochscrollen, bis der Jump-Button hält (siehe Auto-Load-Test). Löst
    // evtl. Auto-Load älterer Seiten aus — die dürfen den Unread-Zähler NICHT
    // hochtreiben.
    const log = page.locator('[role=log]')
    await expect(async () => {
        await log.hover()
        await page.mouse.wheel(0, -1200)
        await expect(jumpBtn).toBeVisible({ timeout: 1500 })
    }).toPass({ timeout: 15_000 })

    // Zwei Live-Nachrichten → Zähler = 2 (nicht am Ende → wird nicht mitgescrollt).
    const marker = `Zaehl-${Math.floor(Math.random() * 1e9)}`
    publishToScroll(`${marker}-a`)
    publishToScroll(`${marker}-b`)
    await expect(page.getByText('2 neue')).toBeVisible({ timeout: 15_000 })

    // Jump → ans Ende, Zähler + Button verschwinden.
    await jumpBtn.click()
    await expect(jumpBtn).toBeHidden()
})
