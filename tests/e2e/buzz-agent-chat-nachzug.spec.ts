import { test, expect, type Page } from './support/fixtures'
import { useBuzz, BUZZ_PORT, BUZZ_OWNER_NSEC, BUZZ_OWNER_SEC_HEX, BUZZ_ROOM_GENERAL } from './support/buzz'
import { loginNsec } from './support/login'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'

/**
 * **Der Chat-Composer zieht nach, wenn ein Agentenprofil später eintrifft.**
 *
 * Dieselbe Lücke, die in der Forge-Fläche als E2E-Flake aufschlug: die
 * Vorschlagsliste wurde nur je Tastendruck berechnet und danach nie wieder
 * angefasst. Das Agentenverzeichnis (kind 10100) kommt aber asynchron — der REQ
 * geht erst raus, wenn die NIP-11-Runde die Relay-Art geklärt hat. Wer eine
 * Zehntelsekunde zu früh `@ceo` tippt, sah den Agenten deshalb NIE; es brauchte
 * einen weiteren Tastendruck.
 *
 * **Hergestellt statt abgewartet.** Das Profil entsteht erst, wenn der
 * Suchbegriff schon im Feld steht und das Popover mangels Treffer geschlossen
 * ist — der schlimmere der beiden Fälle: eine Bedingung auf „Popover offen"
 * ließe den Vorschlag nie wiederkommen.
 *
 * Der Dateiname beginnt mit `buzz-`, sonst überspringt `playwright.config.ts`
 * die Datei im Buzz-Modus LAUTLOS.
 */

const NAK = process.env.NAK ?? `${process.env.HOME}/go/bin/nak`
const WS = (): string => `ws://localhost:${BUZZ_PORT}`

const nak = (args: string[]): string => {
    const res = spawnSync(NAK, args, { encoding: 'utf8', timeout: 30_000 })

    return `${res.stdout ?? ''}\n${res.stderr ?? ''}`
}

const popover = (page: Page) => page.locator('[data-mention-popover="room"]')
const agentZeilen = (page: Page) => popover(page).locator('button[data-agent="true"]')

test.describe('Buzz-Chat: der @-Vorschlag zieht nach', () => {
    test.skip(process.env.E2E_RELAY !== 'buzz', 'nur im Buzz-Modus (E2E_RELAY=buzz) relevant')

    test('ein Agentenprofil, das mitten in der Suche eintrifft, erscheint noch', async ({ page }) => {
        const sec = nak(['key', 'generate']).trim().split('\n')[0].trim()
        const pub = nak(['key', 'public', sec]).trim().split('\n')[0].trim()
        expect(pub).toHaveLength(64)
        const name = `spaetotter-${randomUUID().slice(0, 8)}`
        // Nur die Relay-Mitgliedschaft vorab — ohne sie nimmt der Relay sein
        // 10100 gar nicht erst an (`restricted_writes`).
        expect(
            nak(['event', '--auth', '--sec', BUZZ_OWNER_SEC_HEX, '-k', '9030', '-t', `p=${pub}`, '-t', 'role=member', WS()]),
        ).toContain('success')

        await useBuzz(page)
        // **Als OWNER, und ueber `/spaces`.** Der Composer erscheint nur
        // Kanal-Mitgliedern (39002); der geseedete Nicht-Admin steht dort nicht
        // drin — am Teststack gemessen, `general` fuehrt nur den Owner — und saehe
        // statt des Eingabefelds den „Beitreten"-Knopf (`buzz-room.spec.ts:396`).
        // Ohne Eingabefeld gaebe es keinen Vorschlag zu pruefen.
        await loginNsec(page, BUZZ_OWNER_NSEC)
        await page.goto('/spaces')
        await page.goto(`/rooms/${BUZZ_ROOM_GENERAL}`)

        const composer = page.getByPlaceholder('Nachricht schreiben…')
        await expect(composer).toBeVisible({ timeout: 30_000 })

        // Positivkontrolle: das Popover geht auf dieser Seite überhaupt auf.
        await composer.click()
        await composer.pressSequentially('Hallo @', { delay: 30 })
        await expect(popover(page)).toBeVisible({ timeout: 30_000 })
        await expect(popover(page).locator('button')).not.toHaveCount(0)

        // Diesen Namen kennt der Relay noch nicht — nichts trifft, das Fenster geht zu.
        await composer.fill('')
        await composer.pressSequentially(`Hallo @${name}`, { delay: 20 })
        await expect(popover(page)).toHaveCount(0)

        // Und JETZT erst entsteht das Profil.
        expect(
            nak([
                'event',
                '--auth',
                '--sec',
                sec,
                '-k',
                '10100',
                '-c',
                JSON.stringify({
                    name,
                    display_name: name,
                    agent_type: 'agent',
                    channel_ids: [BUZZ_ROOM_GENERAL],
                    channels: [BUZZ_ROOM_GENERAL],
                    respond_to: 'anyone',
                    respond_to_allowlist: [],
                    status: 'online',
                }),
                WS(),
            ]),
        ).toContain('success')

        const zeile = agentZeilen(page).filter({ hasText: name })
        await expect(zeile).toHaveCount(1, { timeout: 30_000 })
        // Und der Schlüssel steht daneben: der Name allein ist keine Identität
        // (ein 10100 ist selbstsigniert).
        await expect(zeile).toContainText('npub1')
    })
})
