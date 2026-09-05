import { test, expect, type Page } from './support/fixtures'
import { useZooid } from './support/zooid'
import { loginNsec } from './support/login'

/**
 * **The encrypted-messages row of the rail footer, measured at 375 px and 1280 px.**
 *
 * ── Why this file exists at all ─────────────────────────────────────────────────────
 *
 * „Sichtbare UI ist erst fertig, wenn sie gemessen wurde" — real numbers at two widths,
 * narrow and desktop, from a RUN. The row was first measured with a throwaway probe that
 * was deleted again, and the reviewer rejected exactly that: a measurement the next run
 * does not repeat is a comment, not a guard. `desktop-boot-geometrie.spec.ts` covers the
 * same footer, but it runs at `BREITE = 1440` and logs nothing; neither 375 nor 1280
 * appears anywhere in it.
 *
 * ── Why the file is NOT called `desktop-*` ──────────────────────────────────────────
 *
 * `playwright.config.ts` hands every `desktop-*.spec.ts` to the `desktop` project, which
 * pins 1440×900. A case that measured „1280" from inside that project would in fact be
 * measuring 1440 and would say so in its own log line. Under this name the file runs in
 * the `chromium` project, and both viewports are set explicitly below — the project
 * default (1279×720) is never what is measured here.
 *
 * It also needs no `E2E_RELAY` guard: in buzz mode `chromium` narrows to `BUZZ_SPECS`
 * (`/(?:^|\/)(?:buzz-.*|pin-room|relay-guard|relay-praevention)\.spec\.ts$/`), so this
 * file is excluded there by its name rather than by a `test.skip` nobody reads.
 *
 * ── What is asserted as a literal, and what only as a bound ─────────────────────────
 *
 * The box (`x`, `w`, `h`) and the 38 px rhythm between the footer rows are structurally
 * determined — rail track 20 rem, `border-e` 1 px, `px-3` on the block, `min-h-9` plus
 * `mt-0.5` per row — so they stand as literals.
 *
 * The ABSOLUTE `y` does not, and deliberately so: `.page-enter` translates the whole
 * island on load, and an absolute y read during that window carries its scatter. It is
 * logged, and bounded against the footer block it lives in, but not pinned. The same
 * reasoning that made `desktop-p5-navigation` measure against a neighbour instead of
 * against the document.
 */
const NSEC = process.env.NOSTR_TEST_NSEC as string

type Kasten = { x: number; y: number; w: number; h: number }

/** Everything both widths need, read in one pass off the rendered tree. */
async function messeFuss(page: Page): Promise<{
    docScrollWidth: number
    railKnoten: number
    railSichtbar: boolean
    zeilen: (Kasten & { anker: string; href: string; sichtbar: boolean })[]
    fussBlock: Kasten | null
    labelGekuerzt: boolean | null
}> {
    return page.evaluate(() => {
        const rund = (n: number): number => Math.round(n * 100) / 100
        const kasten = (el: Element | null): Kasten | null => {
            if (!el) {
                return null
            }
            const r = el.getBoundingClientRect()
            return { x: rund(r.x), y: rund(r.y), w: rund(r.width), h: rund(r.height) }
        }
        const rail = document.querySelector('[data-rail]')
        const label = document.querySelector<HTMLElement>('[data-rail-fuss="messages"] span')

        return {
            docScrollWidth: document.documentElement.scrollWidth,
            railKnoten: document.querySelectorAll('[data-rail]').length,
            railSichtbar: rail instanceof HTMLElement ? rail.checkVisibility() : false,
            zeilen: [...document.querySelectorAll<HTMLElement>('[data-rail-fuss]')].map((el) => ({
                anker: el.dataset.railFuss ?? '',
                href: (el.getAttribute('href') ?? '').replace(/^https?:\/\/[^/]+/, ''),
                sichtbar: el.checkVisibility(),
                ...(kasten(el) as Kasten),
            })),
            // The footer is the fourth direct child of `[data-rail]` — the invariant the
            // header of `desktop-rail.blade.php` states and `bloecke()` enforces.
            fussBlock: kasten(rail?.children.item(3) ?? null),
            // ── WHAT THIS PROBE CAN AND CANNOT DO ────────────────────────────────
            // It reports ELLIPSIS, and in the current markup that is nearly always
            // false: the `<span>` carries neither `truncate` nor `overflow-hidden`,
            // so it grows instead of clipping. Measured — a label stretched to 66
            // characters turned the case red through `the row box moved` (h 36 → 40,
            // the row wrapping to a second line), while `labelGekuerzt` stayed
            // `false`. So this probe is NOT the reason the label promise holds; the
            // box and alignment assertions are.
            //
            // It stays because it is the cheap latch for the OTHER direction: the
            // day someone adds `truncate` to this row — the reflex when a long
            // locale wraps — the label would silently shorten to „Verschlüss…" and
            // every geometry assertion would go green. That case is what it catches.
            labelGekuerzt: label ? label.scrollWidth > label.clientWidth + 1 : null,
        }
    })
}

test('the encrypted row: measured at 375 px and 1280 px', async ({ page }) => {
    // Two page loads plus a relay roundtrip for the space; the 30 s default would eat
    // into the waits rather than into the work.
    test.setTimeout(120_000)

    await useZooid(page)
    await loginNsec(page, NSEC)

    // ══ 1280 px — the first width at which the rail exists at all ════════════════════
    // `xl` is 1280, so this is the boundary case, not a comfortable desktop. If the row
    // breaks anywhere on desktop it breaks here.
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto('/spaces')
    await expect(page.locator('[data-rail-fuss="messages"]'), '1280px: the row never appeared').toBeVisible({
        timeout: 20_000,
    })

    const breit = await messeFuss(page)
    // eslint-disable-next-line no-console
    console.log(`[rail-footer] @1280x800: ${JSON.stringify(breit)}`)

    expect(breit.railKnoten, '1280px: the rail is not there exactly once').toBe(1)
    expect(breit.railSichtbar, '1280px: the rail exists but is not visible').toBe(true)
    expect(
        breit.docScrollWidth,
        `1280px: horizontal document overflow (${breit.docScrollWidth}px)`,
    ).toBeLessThanOrEqual(1280)

    // The four footer rows, in order and each on its own destination.
    expect(breit.zeilen.map((z) => z.anker)).toEqual(['artikel', 'forge', 'lesezeichen', 'messages'])
    expect(breit.zeilen.map((z) => z.href)).toEqual(['/articles', '/forge', '/bookmarks', '/messages'])

    const zeile = (anker: string) => breit.zeilen.find((z) => z.anker === anker) as (typeof breit.zeilen)[number]
    const messages = zeile('messages')

    // The box itself. Rail track 320 px minus the 1 px `border-e` = 319 content, minus
    // `px-3` on both sides = 295; `min-h-9` = 36.
    expect(messages.sichtbar, '1280px: the row is in the tree but not visible').toBe(true)
    expect({ x: messages.x, w: messages.w, h: messages.h }, '1280px: the row box moved').toEqual({
        x: 12,
        w: 295,
        h: 36,
    })

    // ── Alignment, which no amount of green box assertions above would catch ─────────
    // Four rows can each satisfy their own box and still not line up. Measured against
    // each other, not against a literal: same left edge, same width, same height.
    expect(
        breit.zeilen.map((z) => ({ x: z.x, w: z.w, h: z.h })),
        `1280px: the four footer rows do not line up: ${JSON.stringify(breit.zeilen)}`,
    ).toEqual(Array(4).fill({ x: 12, w: 295, h: 36 }));

    // The rhythm: `min-h-9` (36) + `mt-0.5` (2). Relative, because absolute y carries
    // the `.page-enter` transform.
    [
        ['forge', 'artikel'],
        ['lesezeichen', 'forge'],
        ['messages', 'lesezeichen'],
    ].forEach(([unten, oben]) => {
        expect(zeile(unten).y - zeile(oben).y, `1280px: ${oben} → ${unten} is not one 38 px step`).toBe(38)
    })

    // No ellipsis on the label — see the probe's own note for what that does and does
    // not prove. Only the German string is measured here, the longest of the seven.
    expect(breit.labelGekuerzt, '1280px: the label „Verschlüsselt" is being clipped').toBe(false)

    // The row sits inside the footer block, and the block inside the viewport. This is
    // the assertion the 38 px growth of the footer would break if the list ever stopped
    // giving the space back.
    const fuss = breit.fussBlock as Kasten
    expect(fuss.h, '1280px: the footer block height moved').toBe(340)

    // ── The block's VERTICAL seat, which every relative promise above survives ───────
    // Everything so far is measured inside the footer or against a neighbour, so a
    // footer shoved past the bottom edge would pass all of it — and `fuss.h === 340`
    // with it. Measured, the block ends at exactly 800: the column is `h-dvh`, the list
    // is the only `flex-1` surface and it has already given back all it can. There is
    // NO slack here, which is precisely why it needs an assertion rather than trust.
    expect(
        fuss.y + fuss.h,
        `1280px: the footer block ends at ${fuss.y + fuss.h}px, below the 800px viewport`,
    ).toBeLessThanOrEqual(800)
    expect(messages.y, '1280px: the row starts above its own footer block').toBeGreaterThanOrEqual(fuss.y)
    expect(messages.y + messages.h, '1280px: the row runs out of the footer block').toBeLessThanOrEqual(
        fuss.y + fuss.h,
    )
    expect(messages.x + messages.w, '1280px: the row runs out of the rail track').toBeLessThanOrEqual(fuss.x + fuss.w)

    // ══ 375 px — the width at which the rail does not exist ══════════════════════════
    // Not „is hidden": `desktop-rail.blade.php` wraps the whole rail in
    // `<template x-if="$store.viewport?.desktop">`, so below `xl` there is no node. The
    // promise of this half is therefore that the new row costs a phone NOTHING — no
    // element, no target, and above all no horizontal scroll.
    await page.setViewportSize({ width: 375, height: 800 })
    await page.goto('/spaces')
    await expect(page.locator('[data-rail-skelett]'), '375px: the page never rendered').toHaveCount(1, {
        timeout: 20_000,
    })
    // Give Alpine the same settle window the 1280 case got before reading geometry —
    // measuring mid-boot reads a tree that is still being swapped.
    await expect(page.locator('[data-rail]'), '375px: the rail exists below xl').toHaveCount(0, { timeout: 20_000 })

    const schmal = await messeFuss(page)
    // eslint-disable-next-line no-console
    console.log(`[rail-footer] @375x800: ${JSON.stringify(schmal)}`)

    expect(schmal.railKnoten, '375px: the rail is in the DOM below xl').toBe(0)
    expect(schmal.zeilen, '375px: a footer row is in the DOM below xl').toEqual([])
    expect(schmal.fussBlock, '375px: there is a footer block without a rail').toBeNull()
    expect(
        schmal.docScrollWidth,
        `375px: horizontal document overflow (${schmal.docScrollWidth}px)`,
    ).toBeLessThanOrEqual(375)
})
