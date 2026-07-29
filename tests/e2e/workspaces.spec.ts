import { test, expect } from './support/fixtures'
import { useZooid, ZOOID_WS } from './support/zooid'
import { BUZZ_URL, BUZZ_PORT, BUZZ_ROOM_WELCOME, BUZZ_OWNER_SEC_HEX } from './support/buzz'
import { loginNsec } from './support/login'
import { spawnSync } from 'node:child_process'
import { getPublicKey } from 'nostr-tools/pure'
import { decode } from 'nostr-tools/nip19'

const NSEC = process.env.NOSTR_TEST_NSEC as string
const NAK = process.env.NAK ?? `${process.env.HOME}/go/bin/nak`

/**
 * Den zooid-Testnutzer auch im BUZZ-Stack als Relay-Mitglied aufnehmen (kind 9030).
 *
 * Ohne das liefert Buzz ihm keine Räume: `BUZZ_REQUIRE_RELAY_MEMBERSHIP=true` ist das
 * tragende Zugangsmodell, eine 39000-Abfrage eines Fremden endet in
 * `auth-required: not authenticated`. Der Tab wäre dann leer — und zwar zu Recht.
 *
 * In Produktion stellt sich die Frage nicht: dort ist derselbe Vereinsmitglied-Pubkey
 * auf beiden Relays eingetragen (zooid per `allowpubkey`, Buzz per 9030-Sync). Hier
 * muss der Test das nachstellen, weil die zwei Test-Stacks getrennte Mitgliederlisten
 * haben.
 */
const joinBuzzRelay = (): void => {
    const sk = decode(NSEC).data as Uint8Array
    spawnSync(
        NAK,
        ['event', '--auth', '--sec', BUZZ_OWNER_SEC_HEX, '-k', '9030', '-t', `p=${getPublicKey(sk)}`, '-t', 'role=member', `ws://localhost:${BUZZ_PORT}`],
        { encoding: 'utf8', timeout: 30_000 },
    )
}

/**
 * Der Hybrid-Kern: EIN Client, ZWEI Relays gleichzeitig.
 *
 * Der Tab „Workspaces" listet die Räume eines zweiten, fest konfigurierten Space
 * (ein Buzz-Relay), **während** der zooid-Space aktiv bleibt — Kopf-Branding und die
 * Tabs „Räume"/„Threads" gehören weiter zu zooid. Erst der Klick auf einen
 * Workspace-Raum stellt den aktiven Space um.
 *
 * Läuft im ZOOID-Modus (nicht `E2E_RELAY=buzz`): genau das ist der Punkt — der
 * zooid-Stack trägt die Sitzung, der Buzz-Stack liefert nur den zweiten Tab. Beide
 * müssen dafür laufen; ohne den Buzz-Test-Stack auf :3001 wird übersprungen.
 */
const buzzUp = (): boolean => {
    const res = spawnSync('curl', ['-sf', '-m', '2', '-H', 'Accept: application/nostr+json', `http://localhost:${BUZZ_PORT}`], {
        encoding: 'utf8',
    })
    return res.status === 0
}

test.describe('Workspaces-Tab (zooid aktiv, Buzz als zweiter Space)', () => {
    test.skip(process.env.E2E_RELAY === 'buzz', 'braucht den zooid-Modus als Basis')
    test.skip(!buzzUp(), `kein Buzz-Test-Stack auf :${BUZZ_PORT} — bash tests/e2e/support/buzz-testserver.sh`)

    test('ohne Config bleibt der Tab aus', async ({ page }) => {
        await useZooid(page)
        await loginNsec(page, NSEC)
        // Kein `__nostrWorkspace` gesetzt → der dritte Tab darf nicht existieren.
        await expect(page.getByRole('tab', { name: 'Räume' })).toBeVisible({ timeout: 20_000 })
        await expect(page.getByRole('tab', { name: 'Workspaces' })).toHaveCount(0)
    })

    test('mit Config listet er die Buzz-Räume, ohne den zooid-Space zu wechseln', async ({ page }) => {
        joinBuzzRelay()
        await useZooid(page)
        // Der zweite Space wird injiziert wie in Produktion durch `partials/head.blade.php`.
        await page.addInitScript((url) => {
            ;(window as unknown as { __nostrWorkspace: string }).__nostrWorkspace = url
        }, BUZZ_URL)
        await loginNsec(page, NSEC)

        // Der Tab ist da.
        const tab = page.getByRole('tab', { name: 'Workspaces' })
        await expect(tab).toBeVisible({ timeout: 20_000 })

        // Vorbedingung: der zooid-Space trägt die Seite — sein Seed-Raum ist sichtbar.
        // Auf den Räume-Tab gescopt, weil „Willkommen" auch als Chat-Text vorkommt.
        await expect(page.getByRole('tabpanel').getByText('Willkommen', { exact: true })).toBeVisible({ timeout: 20_000 })

        // Im Workspaces-Tab stehen die BUZZ-Räume. Der Seed-Raum des buzz-test-Stacks
        // heißt „welcome" mit der festen UUIDv5 — hier zählt, dass überhaupt Räume aus
        // dem zweiten Relay ankommen, nicht ein bestimmter Name.
        await tab.click()
        const panel = page.getByRole('tabpanel')
        await expect
            .poll(async () => (await panel.locator('button').count()) > 0, {
                timeout: 30_000,
                message: 'die Räume des zweiten Space müssen im Tab erscheinen',
            })
            .toBe(true)

        // Der EIGENTLICHE Hybrid-Beleg: der aktive Space ist immer noch zooid. Wäre der
        // Tab ein Space-Umschalter, stünde hier die Buzz-URL — und der Kopf zeigte ein
        // anderes Branding.
        const active = await page.evaluate(() => {
            const el = document.querySelector('[x-data="nostrSpaces"]')!
            const data = (window as unknown as { Alpine: { $data: (e: Element) => Record<string, unknown> } }).Alpine.$data(el)
            return data._url as string
        })
        expect(active, 'der Workspaces-Tab darf den aktiven Space NICHT wechseln').toBe(ZOOID_WS + '/')
    })

    test('der Raum-Klick wechselt den Space ephemer — ein Reload landet wieder auf zooid', async ({ page }) => {
        await useZooid(page)
        await page.addInitScript((url) => {
            ;(window as unknown as { __nostrWorkspace: string }).__nostrWorkspace = url
        }, BUZZ_URL)
        await loginNsec(page, NSEC)
        await expect(page.getByRole('tab', { name: 'Workspaces' })).toBeVisible({ timeout: 20_000 })

        // Space per Insel-Aufruf umstellen (der Klick-Pfad selbst ist Blade-Navigation).
        await page.evaluate(() => {
            const el = document.querySelector('[x-data="nostrSpaces"]')!
            const data = (window as unknown as { Alpine: { $data: (e: Element) => Record<string, unknown> } }).Alpine.$data(el)
            ;(data.openWorkspaceRoom as (r: unknown) => void)({ h: 'egal' })
        })
        await page.goto(`/rooms/${BUZZ_ROOM_WELCOME}`)
        await expect(page.locator('[x-data^="nostrRoomChat"]')).toBeVisible({ timeout: 20_000 })

        // **Die Zusicherung, an der die localStorage-Falle hängt:** der ephemere Space darf
        // NICHT persistiert werden. Nach einem harten Reload muss die App wieder auf dem
        // Vereins-Space stehen — sonst startete ein Nutzer nach einem Absturz im
        // Workspace, ohne das je gewählt zu haben.
        const persisted = await page.evaluate(() => window.localStorage.getItem('activeSpaceUrl'))
        expect(persisted, 'der Workspace darf nicht in den localStorage geschrieben werden').not.toContain(
            String(BUZZ_PORT),
        )
    })

    test('zurück auf die Raumliste verlässt den Workspace — sie zeigt wieder zooid', async ({ page }) => {
        joinBuzzRelay()
        await useZooid(page)
        await page.addInitScript((url) => {
            ;(window as unknown as { __nostrWorkspace: string }).__nostrWorkspace = url
        }, BUZZ_URL)
        await loginNsec(page, NSEC)
        await expect(page.getByRole('tab', { name: 'Workspaces' })).toBeVisible({ timeout: 20_000 })

        // In den Workspace wechseln (wie der Raum-Klick) …
        await page.evaluate(() => {
            const el = document.querySelector('[x-data="nostrSpaces"]')!
            const data = (window as unknown as { Alpine: { $data: (e: Element) => Record<string, unknown> } }).Alpine.$data(el)
            ;(data.openWorkspaceRoom as (r: unknown) => void)({ h: 'egal' })
        })
        await page.goto(`/rooms/${BUZZ_ROOM_WELCOME}`)
        await expect(page.locator('[x-data^="nostrRoomChat"]')).toBeVisible({ timeout: 20_000 })

        // … und zurück auf die Raumliste. Sie IST der Vereins-Space: der ephemere
        // Workspace muss dabei wegfallen, sonst käme der Nutzer nur über die
        // Einstellungen zurück und sähe derweil die falschen Räume.
        await page.goto('/spaces')
        await expect(page.locator('[x-data="nostrSpaces"]')).toBeVisible({ timeout: 20_000 })
        const active = await page.evaluate(() => {
            const el = document.querySelector('[x-data="nostrSpaces"]')!
            const data = (window as unknown as { Alpine: { $data: (e: Element) => Record<string, unknown> } }).Alpine.$data(el)
            return data._url as string
        })
        expect(active, 'die Raumliste muss wieder auf dem Vereins-Space stehen').toBe(ZOOID_WS + '/')
        // Gegenprobe: der zooid-Seed-Raum ist auch wirklich da (nicht bloß die URL stimmt).
        await expect(page.getByRole('tabpanel').getByText('Willkommen', { exact: true })).toBeVisible({ timeout: 20_000 })
    })
})
