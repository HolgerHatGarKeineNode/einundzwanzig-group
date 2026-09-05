import { test, expect, type Page } from './support/fixtures'
import { useBuzz, BUZZ_PORT, BUZZ_USER_NSEC, BUZZ_OWNER_SEC_HEX } from './support/buzz'
import { loginNsec } from './support/login'
import { spawnSync } from 'node:child_process'
import { getPublicKey } from 'nostr-tools/pure'

/**
 * P3 — **a conversation has a name**, at the chat header and in the command palette,
 * against a real Buzz relay.
 *
 * Plan: `docs/plans/2026-09-05T0125-community-features-herbst.md`, phase P3.
 *
 * ── What is measured here and nowhere else ──────────────────────────────────────────
 *
 * The rules and the wiring are unit-tested without Docker (`dmHeaderName.test.ts`,
 * `paletteDmRooms.test.ts`, 22 cases). Three things cannot be:
 *
 *  1. that the name the RELAY stores (`"DM"`, `buzz-db/src/dm.rs:157-162`) really is
 *     replaced on screen by the counterpart's profile name — the profile arrives over the
 *     wire, after the mount, from a second store;
 *  2. that the palette lists the conversation at all and finds it under that name — Flux
 *     filters over `textContent`, which no unit test sees;
 *  3. the geometry at 375 and 1280 px with a LONG name, which is the case that decides
 *     whether the header truncates or pushes the document into a horizontal scroll.
 *
 * ── Why this file gives the counterpart a long name ─────────────────────────────────
 *
 * Without a `kind 0` the title of a conversation is a shortened key (`b7c3d1e2…`, nine
 * characters) — a width at which nothing overflows and the measurement proves nothing.
 * The case therefore publishes a profile for the seed owner and requeries it, because
 * `nak` prints the signed event and exits 0 even when the relay rejects it.
 *
 * That profile does not outlive the run: `global-setup` brings up a FRESH `buzz-test`
 * stack per run and the teardown removes its volumes (measured 2026-09-05, run on slot
 * 3021: "buzz-test:3021 frisch aufgesetzt + geseedet"). And no other spec asserts the
 * owner's display name either (`grep` over `tests/e2e/buzz-*.spec.ts`), so the seed stays
 * readable for a hand-started stack too.
 *
 * **`name`, not only `display_name`** — welshman's `displayProfile` prefers `name`, and
 * a fixture that only sets `display_name` measures the wrong field. Found by running it:
 * the header read `# ostwestfalen` (the short `name`) while the case waited for the long
 * one.
 */

const NAK = process.env.NAK ?? `${process.env.HOME}/go/bin/nak`
const WS = (): string => `ws://localhost:${BUZZ_PORT}`

const nak = (args: string[]): string => {
    const res = spawnSync(NAK, args, { encoding: 'utf8', timeout: 30_000 })

    return `${res.stdout ?? ''}\n${res.stderr ?? ''}`
}

/** The second, really different pubkey: the owner of the seed stack. */
const OWNER_PUB = getPublicKey(Uint8Array.from(Buffer.from(BUZZ_OWNER_SEC_HEX, 'hex')))

/**
 * The display name the conversation is supposed to carry — 81 characters.
 *
 * Long on purpose and not absurd: it is the shape a real regional group would use, and
 * it is wider than the 375 px header, which is the whole point of the geometry case.
 */
const LONG_NAME = 'Einundzwanzig Regionalgruppe Ostwestfalen-Lippe · Öffentlichkeitsarbeit und Presse'

/** A substring nothing else on the page carries — the search term of the palette case. */
const NEEDLE = 'Ostwestfalen'

/** The DM section of the rail — by its heading text, as `buzz-rail-forge` does. */
const dmSection = (page: Page) =>
    page.locator('[data-rail] section').filter({ hasText: 'Direktnachrichten' }).first()

const paletteInput = (page: Page) => page.locator('[data-palette-input]')

/** The one heading of the chat header (`app-header.blade.php`, `flux:heading level=1`). */
const header = (page: Page) => page.getByRole('heading', { level: 1 }).first()

type Box = { x: number; y: number; width: number; height: number }

/**
 * Print one measurement, so the run itself carries the numbers.
 *
 * "Visible UI is only finished once it has been MEASURED" (user, 2026-09-03) — a green
 * assertion says a threshold held, not what the page actually looked like. The line below
 * is what goes into the artefact folder next to the assertions.
 */
const report = (label: string, values: Record<string, number | string>): void => {
    // eslint-disable-next-line no-console -- the measurement IS the output of this file
    console.log(`[P3-measurement] ${label}: ${JSON.stringify(values)}`)
}

test.describe('Buzz: the name of a conversation (E2E, E2E_RELAY=buzz only)', () => {
    test.skip(process.env.E2E_RELAY !== 'buzz', 'buzz dialect (41010) — only relevant in buzz mode')

    test('header and palette name a conversation after its participants — measured at 1280 and 375', async ({
        page,
    }) => {
        // Opening a conversation is a wire roundtrip, the palette case is a second page
        // load, and two viewports come on top. The 30 s default would cut into the polls
        // rather than into the work.
        test.setTimeout(180_000)

        // ── The counterpart gets a name ─────────────────────────────────────────
        nak([
            'event', '--auth', '--sec', BUZZ_OWNER_SEC_HEX, '-k', '0',
            '-c', JSON.stringify({ name: LONG_NAME, display_name: LONG_NAME }),
            WS(),
        ])
        // Requery, because `nak` prints the signed event and exits 0 on a rejection too.
        // Without this the whole case could measure a profile the relay never took.
        const stored = nak(['req', '--auth', '--sec', BUZZ_OWNER_SEC_HEX, '-k', '0', '-a', OWNER_PUB, WS()])
        expect(stored, 'the relay did not store the profile — everything below would measure nothing').toContain(
            NEEDLE,
        )

        await page.setViewportSize({ width: 1280, height: 900 })
        await useBuzz(page)
        await loginNsec(page, BUZZ_USER_NSEC)
        await page.goto('/spaces')

        // ── The conversation (idempotent: `open_dm` hashes the participant set) ──
        const sektion = dmSection(page)
        await expect(sektion, 'the DM group is missing from the rail').toBeVisible({ timeout: 30_000 })
        await sektion.getByRole('button', { name: 'Neue Unterhaltung' }).click()
        const feld = page.getByLabel('Person')
        await expect(feld).toBeVisible({ timeout: 15_000 })
        await feld.fill(OWNER_PUB)
        await feld.press('Enter')
        await page.getByRole('button', { name: 'Unterhaltung eröffnen' }).click()

        const zeile = sektion.locator('[data-room-h]').first()
        await expect(zeile, 'no conversation reached the rail').toBeVisible({ timeout: 30_000 })
        const h = await zeile.getAttribute('data-room-h')
        expect(h, 'the rail row carries no channel id').toBeTruthy()

        // ══ 1280 px — the chat header ════════════════════════════════════════════
        await page.goto(`/rooms/${h}`)
        await expect(header(page), 'no room header at all').toBeVisible({ timeout: 30_000 })
        // The profile travels over the wire and lands in a second store, so this is a
        // poll and not a read: right after the mount the header legitimately still
        // carries the shortened key.
        await expect(header(page), 'the header never resolved the counterpart').toContainText(NEEDLE, {
            timeout: 45_000,
        })
        const titel1280 = (await header(page).textContent())?.trim() ?? ''
        expect(titel1280, `1280px: the header still reads the relay's own word: ${titel1280}`).not.toMatch(
            /^#\s*(?:DM|Group DM)/,
        )

        const kopf1280 = (await header(page).boundingBox()) as Box
        const zeile1280 = (await page.locator('header').first().boundingBox()) as Box
        expect(kopf1280, '1280px: no geometry on the header').toBeTruthy()
        expect(kopf1280.height, `1280px: the heading is too flat (${kopf1280.height}px)`).toBeGreaterThanOrEqual(20)
        expect(kopf1280.width, `1280px: the heading has no width (${kopf1280.width}px)`).toBeGreaterThan(0)
        expect(
            kopf1280.x + kopf1280.width,
            `1280px: the heading runs out of the header row (${kopf1280.x + kopf1280.width} > ${zeile1280.x + zeile1280.width})`,
        ).toBeLessThanOrEqual(zeile1280.x + zeile1280.width + 1)
        const overflow1280 = await page.evaluate(() => document.documentElement.scrollWidth)
        expect(overflow1280, `1280px: horizontal document overflow (${overflow1280}px)`).toBeLessThanOrEqual(1281)
        // One line, whatever the length: `truncate` sets `white-space: nowrap`. A wrapped
        // heading would show up as a doubled height, and it is the wrap — not the clip —
        // that would push the chat stage down.
        expect(
            kopf1280.height,
            `1280px: the heading grew to ${kopf1280.height}px — the long name wraps instead of staying on one line`,
        ).toBeLessThanOrEqual(48)
        // MEASURED, not asserted as a threshold: at 1280 px the 81-character name FITS
        // (scrollWidth 770 = clientWidth 770, run of 2026-09-05). That is why the clipping
        // assertion lives at 375 px below and not here — at this width there is nothing to
        // clip, and demanding it would be a test that fails on a correct page.
        const clip1280 = await header(page).evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }))
        expect(
            clip1280.scroll,
            `1280px: the heading text (${clip1280.scroll}px) exceeds its box (${clip1280.client}px) by more than the `
                + 'box itself — that is no longer a truncation but a layout that lost its width',
        ).toBeLessThanOrEqual(clip1280.client * 2)

        report('header @1280', {
            title: titel1280,
            x: kopf1280.x,
            y: kopf1280.y,
            width: kopf1280.width,
            height: kopf1280.height,
            textWidth: clip1280.scroll,
            headerRowRight: zeile1280.x + zeile1280.width,
            documentScrollWidth: overflow1280,
        })

        // ══ 375 px — the width at which the rail does not exist ═══════════════════
        await page.setViewportSize({ width: 375, height: 812 })
        await page.goto(`/rooms/${h}`)
        await expect(page.locator('[data-rail]'), '375px: the rail exists').toHaveCount(0)
        await expect(header(page), '375px: the header never resolved the counterpart').toContainText(NEEDLE, {
            timeout: 45_000,
        })

        const kopf375 = (await header(page).boundingBox()) as Box
        const zeile375 = (await page.locator('header').first().boundingBox()) as Box
        expect(kopf375.height, `375px: the heading is too flat (${kopf375.height}px)`).toBeGreaterThanOrEqual(20)
        expect(
            kopf375.height,
            `375px: the heading grew to ${kopf375.height}px — the long name wraps instead of truncating`,
        ).toBeLessThanOrEqual(48)
        expect(
            kopf375.x + kopf375.width,
            `375px: the heading runs out of the header row (${kopf375.x + kopf375.width} > ${zeile375.x + zeile375.width})`,
        ).toBeLessThanOrEqual(zeile375.x + zeile375.width + 1)
        const overflow375 = await page.evaluate(() => document.documentElement.scrollWidth)
        expect(overflow375, `375px: horizontal document overflow (${overflow375}px)`).toBeLessThanOrEqual(376)
        // HERE it has to clip: the same 770 px of text in a box a fraction of that width.
        // This is the assertion the whole long-name fixture exists for — without
        // `truncate` the heading would either wrap or push the document sideways, and the
        // two checks above would not tell those apart from a short name.
        const clip375 = await header(page).evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }))
        expect(
            clip375.scroll,
            `375px: the long name is not clipped (scrollWidth ${clip375.scroll} ≤ clientWidth ${clip375.client}) — `
                + 'either the fixture got shorter or the header stopped truncating',
        ).toBeGreaterThan(clip375.client)

        report('header @375', {
            title: (await header(page).textContent())?.trim() ?? '',
            x: kopf375.x,
            y: kopf375.y,
            width: kopf375.width,
            height: kopf375.height,
            textWidth: clip375.scroll,
            headerRowRight: zeile375.x + zeile375.width,
            documentScrollWidth: overflow375,
        })

        // ══ The palette — at 375 px, where there is no rail to fall back on ══════
        await page.keyboard.press('Meta+K')
        await expect(paletteInput(page), '375px: the palette did not open').toBeVisible({ timeout: 15_000 })
        // `d:` instead of the name: the resting state shows five rows, and which five is
        // a different promise. The scope is also the half of `roomGroupKey` that decides
        // whether a conversation counts as a conversation or as a workspace room.
        await paletteInput(page).fill('d:')
        const option = page.locator(`[data-palette-h="${h}"]`)
        await expect(option, 'the palette does not list the conversation under `d:`').toBeVisible({ timeout: 30_000 })
        await expect(option, 'the palette row still carries the relay word').toContainText(NEEDLE, { timeout: 30_000 })

        const zeilenBox = (await option.boundingBox()) as Box
        expect(zeilenBox.height, `375px: the palette row is too flat (${zeilenBox.height}px)`).toBeGreaterThanOrEqual(
            40,
        )
        expect(
            zeilenBox.x + zeilenBox.width,
            `375px: the palette row runs past the viewport (${zeilenBox.x + zeilenBox.width}px)`,
        ).toBeLessThanOrEqual(376)
        const paletteOverflow = await page.evaluate(() => document.documentElement.scrollWidth)
        expect(paletteOverflow, `375px: horizontal overflow with the palette open (${paletteOverflow}px)`)
            .toBeLessThanOrEqual(376)

        report('palette row @375', {
            text: (await option.textContent())?.trim().replace(/\s+/g, ' ') ?? '',
            x: zeilenBox.x,
            y: zeilenBox.y,
            width: zeilenBox.width,
            height: zeilenBox.height,
            documentScrollWidth: paletteOverflow,
        })

        // And the search itself: typing the participant name has to leave the row
        // standing. This is the promise of the phase — before it, the row read "DM" and
        // this term matched nothing.
        await paletteInput(page).fill(NEEDLE)
        await expect(option, 'searching for the participant name loses the conversation').toBeVisible({
            timeout: 15_000,
        })
        await expect(option, 'Flux filtered the row away').not.toHaveAttribute('data-hidden', /.*/)
    })
})
