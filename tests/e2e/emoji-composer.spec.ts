/**
 * Composer-Emoji-Picker (C1, PLAN4) — der Knopf `<template x-if="$store.viewport.mouse">`
 * (chat-composer.blade.php) existiert auf einem Zeigegerät in BEIDEN Composern (Raum
 * UND Thread), und ein daraus eingefügtes Custom-Emoji landet als `["emoji", …]`-Tag
 * am gesendeten Event. Der Gegenbeweis (Touch → kein Knoten im DOM) steht separat in
 * `emoji-composer-touch-guard.spec.ts`.
 *
 * Läuft im Standardprojekt (kein Touch emuliert) — Chromium meldet `(hover: hover)`
 * und `(pointer: fine)` dort ohne jede Sonderkonfiguration.
 */
import { test, expect, type Page } from './support/fixtures'
import { execFileSync } from 'node:child_process'
import { useZooid, ZOOID_WS } from './support/zooid'
import { loginNsec } from './support/login'

const NSEC = process.env.NOSTR_TEST_NSEC as string
const NAK = process.env.NAK ?? `${process.env.HOME}/go/bin/nak`

type RelayEvent = { id: string; pubkey: string; kind: number; content: string; tags: string[][]; created_at: number }

/** Wie `room.spec.ts` — member-only zooid, AUTH'd Abfrage nach Kind + Raum. */
function queryRelayEvent(pred: (e: RelayEvent) => boolean, h = 'react', kind = 9): RelayEvent | undefined {
    const args = ['req', '-k', String(kind), '-t', `h=${h}`, '--auth', '--sec', NSEC, ZOOID_WS]
    return execFileSync(NAK, args)
        .toString()
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as RelayEvent)
        .find(pred)
}

async function openRoom(page: Page, h = 'react'): Promise<void> {
    await useZooid(page)
    await loginNsec(page, NSEC)
    await page.goto(`/rooms/${h}`)
}

/** Die `<div class="relative flex items-end gap-2">`-Box, die Textarea + Emoji-Knopf teilt. */
const composerBox = (page: Page, placeholder: string) =>
    page.locator('div.relative.flex.items-end.gap-2').filter({ has: page.getByPlaceholder(placeholder) })

test('C1: Emoji-Knopf existiert im Raum-Composer UND im Thread-Composer', async ({ page }) => {
    await openRoom(page, 'thread')
    const roomComposer = page.getByPlaceholder('Nachricht schreiben…')
    await expect(roomComposer).toBeVisible({ timeout: 15_000 })

    // Vorbedingung scharf: der Store muss ein Zeigegerät sehen, sonst prueft dieser Test nichts.
    expect(
        await page.evaluate(() => (window as unknown as { Alpine?: { store(n: string): { mouse?: boolean } } })
            .Alpine?.store('viewport')?.mouse),
        'der Viewport-Store muss ein Zeigegerät erkennen',
    ).toBe(true)

    await expect(composerBox(page, 'Nachricht schreiben…').getByRole('button', { name: 'Emoji einfügen' }))
        .toBeVisible({ timeout: 10_000 })

    // Thread öffnen (jede Nachricht ist thread-fähig) — der Thread-Composer bekommt
    // seinen EIGENEN Knopf (eigene `target`-Bindung, eigene Instanz von `reactionPopover()`).
    const marker = `EC-${Math.floor(Math.random() * 1e9)}`
    await roomComposer.fill(marker)
    await page.getByRole('button', { name: 'Senden' }).click()
    await expect(page.getByText(marker, { exact: true })).toBeVisible({ timeout: 15_000 })

    const row = page.locator('div.group', { hasText: marker })
    await row.hover()
    await row.getByRole('button', { name: 'Im Thread antworten' }).click()
    await expect(page.getByRole('dialog', { name: 'Thread' })).toBeVisible()
    await expect(page.getByPlaceholder('Im Thread antworten…')).toBeVisible({ timeout: 15_000 })

    await expect(composerBox(page, 'Im Thread antworten…').getByRole('button', { name: 'Emoji einfügen' }))
        .toBeVisible({ timeout: 10_000 })
})

/**
 * C1 (Custom-Emoji-Insert, NIP-30) — der Kern-Vertrag: ein aus dem Composer-Picker
 * eingefügtes Custom-Emoji landet im gesendeten Event als `["emoji", code, url]`.
 *
 * Flake-Risiko (vom Autor benannt): der Custom-Emoji-Schnappschuss (`knownCustomEmojis`)
 * wird asynchron vorgewärmt — ein Sendeversuch VOR dem Laden träfe einen leeren
 * Schnappschuss. Der deterministische Wartepunkt ist NICHT ein Timeout, sondern das
 * Erscheinen des Emoji-Buttons im „Deine Emojis"-Tab selbst: der wird erst gerendert,
 * NACHDEM `loadUserCustomEmojis` aufgelöst hat (derselbe Promise, den `knownCustomEmojis`
 * synchron liest) — sein Erscheinen IST der Beweis, dass der Schnappschuss warm ist.
 */
test('C1: eingefügtes Custom-Emoji trägt sein emoji-Tag am gesendeten Event', async ({ page }) => {
    // Eigene User-Emoji-Liste (kind 10030) vor dem Öffnen seeden (wie room.spec.ts:C1).
    const code = `insert${Math.floor(Math.random() * 1e9)}`
    const url = `https://robohash.org/${code}.png`
    execFileSync(NAK, [
        'event', '--auth', '--sec', NSEC, '-k', '10030',
        '-t', `emoji=${code};${url}`, '-c', '', ZOOID_WS,
    ])

    await openRoom(page, 'react')
    const composer = page.getByPlaceholder('Nachricht schreiben…')
    await expect(composer).toBeVisible({ timeout: 15_000 })

    // Eindeutiger Text-Anker VOR dem Emoji — die Nachricht selbst wird das Suchkriterium
    // am Relay (nicht `tags[0]`: die Tag-Position ist kein Vertrag, siehe emojiTags.ts).
    const marker = `EI-${Math.floor(Math.random() * 1e9)}`
    await composer.fill(`${marker} `)

    await composerBox(page, 'Nachricht schreiben…').getByRole('button', { name: 'Emoji einfügen' }).click()
    const tab = page.getByRole('tab', { name: 'Deine Emojis' })
    await expect(tab).toBeVisible({ timeout: 15_000 })
    await tab.click()

    // Deterministischer Wartepunkt (siehe Docblock) — KEIN waitForTimeout.
    const customBtn = page.getByRole('button', { name: `Einfügen: :${code}:` })
    await expect(customBtn).toBeVisible({ timeout: 15_000 })
    await customBtn.click()

    // Eingefügt in den Entwurf: Text + `:code:` zusammen.
    await expect(composer).toHaveValue(`${marker} :${code}:`)

    await page.getByRole('button', { name: 'Senden' }).click()
    // Custom-Emoji rendert als Inline-`<img>` (siehe room.spec.ts B6), NICHT als Text —
    // der Marker allein ist der sichtbare Text-Anker, das Emoji-Bild der zweite Beleg.
    await expect(page.getByText(marker, { exact: false })).toBeVisible({ timeout: 15_000 })
    const emojiImg = page.locator(`img.chat-emoji[alt=":${code}:"]`)
    await expect(emojiImg).toBeVisible({ timeout: 15_000 })

    let sent: RelayEvent | undefined
    await expect
        .poll(() => (sent = queryRelayEvent((e) => e.content === `${marker} :${code}:`, 'react')) !== undefined, {
            timeout: 15_000,
        })
        .toBe(true)

    // Tag per .find (nicht tags[0] — andere Tags wie `h` können davor stehen).
    const emojiTag = (sent as RelayEvent).tags.find((t) => t[0] === 'emoji')
    expect(emojiTag).toEqual(['emoji', code, url])
})
