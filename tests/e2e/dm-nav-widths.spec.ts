import { test, expect, type Page } from './support/fixtures'
import { useZooid } from './support/zooid'
import { loginNsec } from './support/login'

/**
 * **The conversations moved into the navigation — measured at 375 px and 1280 px.**
 *
 * ── What changed and why it needs a measurement ─────────────────────────────────────
 *
 * Until P7 the navigation showed the BUZZ DM channels: a channel with an `h` whose
 * messages lie in plaintext on the relay. P8 removed that transport and put the encrypted
 * NIP-17 conversations in its place — the rail group on desktop, the section of the room
 * list on a phone. „Sichtbare UI ist erst fertig, wenn sie gemessen wurde": real numbers
 * at two widths, narrow and desktop, from a RUN. A CSS-class assertion and a green
 * server-side test do not answer whether the section is on screen and whether it fits.
 *
 * ── Why the file is NOT called `desktop-*` and not `buzz-*` ─────────────────────────
 *
 * `playwright.config.ts` hands every `desktop-*.spec.ts` to the `desktop` project, which
 * pins 1440×900 — a case that measured „1280" from inside it would in fact measure 1440.
 * And in buzz mode `chromium` narrows to `BUZZ_SPECS`, so a `buzz-` prefix would run this
 * against a relay whose DM channels are exactly what P8 removed. Under this name it runs
 * in the `chromium` project against zooid, and both viewports are set explicitly below.
 *
 * ── What is asserted as a literal, and what only as a bound ─────────────────────────
 *
 * Widths and the absence of horizontal overflow are structural and stand as literals. The
 * absolute `y` of a row does not: `.page-enter` translates the whole island on load, and
 * an absolute y read during that window carries its scatter. It is logged and bounded
 * against its own container, never pinned.
 */
const NSEC = process.env.NOSTR_TEST_NSEC as string

type Kasten = { x: number; y: number; w: number; h: number }

/** Everything both widths need, read in one pass off the rendered tree. */
async function messeNav(page: Page): Promise<{
    docScrollWidth: number
    /** The rail group — desktop only; `null` below `xl`, where the rail does not exist. */
    railGruppe: Kasten | null
    railGruppeSichtbar: boolean
    railLabel: string
    /** The section of the room list — phone only; hidden from `xl` up by its own `x-if`. */
    handyPanel: Kasten | null
    handyKopf: Kasten | null
    handyKopfText: string
    handyNeu: Kasten | null
    handyNeuSichtbar: boolean
    /** How many unread pills the surface renders — `unread-badge` uses `x-if`. */
    pillen: number
    /** The Buzz DM dialog. It must not exist any more, at either width. */
    buzzDialoge: number
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
        // The group's section carries `id="rail-group-dms"` (`rail-group.blade.php`), and
        // its heading row is the previous sibling — the group has no `data-` anchor of its
        // own because it has no `headingHref`.
        const gruppe = document.querySelector('#rail-group-dms')?.closest('section') ?? null
        const panel = document.querySelector('[data-dm-panel]')
        const kopf = panel?.querySelector('.min-h-11') ?? null
        const neu = document.querySelector<HTMLElement>('[data-dm-neu]')

        return {
            docScrollWidth: document.documentElement.scrollWidth,
            railGruppe: kasten(gruppe),
            railGruppeSichtbar: gruppe instanceof HTMLElement ? gruppe.checkVisibility() : false,
            // The FIRST span with text, not simply the first span: the heading row opens
            // with an `aria-hidden` wrapper around the chevron, which has no text at all.
            // Reading `querySelector('span')` returned `''` in the first run — a probe
            // that measures the wrong node reports a product defect that is not there.
            railLabel: ([...(gruppe?.querySelectorAll('span') ?? [])]
                .map((el) => (el.textContent ?? '').trim())
                .find((text) => text !== '') ?? ''),
            handyPanel: kasten(panel),
            handyKopf: kasten(kopf),
            handyKopfText: (kopf?.querySelector('span')?.textContent ?? '').trim(),
            handyNeu: kasten(neu),
            handyNeuSichtbar: neu ? neu.checkVisibility() : false,
            buzzDialoge: document.querySelectorAll('[data-modal="dm"]').length,
            // `unread-badge` renders through `x-if`, so a zero count leaves NO node at
            // all — the pill is the `.bg-brand-500.rounded-pill` span it draws. On a fresh
            // relay with no conversation there is nothing unread, so the number belongs in
            // the log as the state of the run, not as an assertion.
            pillen: (gruppe ?? panel)?.querySelectorAll('.rounded-pill.bg-brand-500').length ?? 0,
        }
    })
}

test('the conversations in the navigation: measured at 375 px and 1280 px', async ({ page }) => {
    // Two page loads plus a relay roundtrip for the space; the 30 s default would eat into
    // the waits rather than into the work.
    test.setTimeout(120_000)

    await useZooid(page)
    await loginNsec(page, NSEC)

    // ══ 1280 px — the first width at which the rail exists at all ════════════════════
    // `xl` is 1280, so this is the boundary case, not a comfortable desktop. If the group
    // breaks anywhere on desktop it breaks here.
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto('/spaces')
    await expect(page.locator('#rail-group-dms'), '1280px: the group never appeared').toBeAttached({
        timeout: 20_000,
    })

    const breit = await messeNav(page)
    // eslint-disable-next-line no-console
    console.log(`[dm-nav] @1280x800: ${JSON.stringify(breit)}`)

    expect(breit.railGruppeSichtbar, '1280px: the group exists but is not visible').toBe(true)
    expect(breit.railLabel, '1280px: the group is not the encrypted one').toBe('Verschlüsselt')
    expect(
        breit.docScrollWidth,
        `1280px: horizontal document overflow (${breit.docScrollWidth}px)`,
    ).toBeLessThanOrEqual(1280)

    // The rail track is 20 rem = 320 px, minus the 1 px `border-e` and the `px-3` of the
    // scroller: 320 − 1 − 24 = 295. A group wider than its column is the failure this
    // number catches, and it is structural rather than incidental.
    expect(breit.railGruppe?.w, '1280px: the group does not fit the rail track').toBeLessThanOrEqual(295)
    expect(breit.railGruppe?.x, '1280px: the group does not start inside the rail').toBeGreaterThanOrEqual(0)

    // The phone section must NOT boot here — it costs a wrap subscription, and the rail
    // already shows the same list. Its own `x-if` carries `!$store.viewport?.desktop`.
    expect(breit.handyPanel, '1280px: the phone section booted next to the rail').toBeNull()

    // The Buzz DM dialog is gone with its transport, at every width.
    expect(breit.buzzDialoge, '1280px: the removed Buzz DM dialog is still in the document').toBe(0)

    // ══ 375 px — a phone, where the rail does not exist ══════════════════════════════
    await page.setViewportSize({ width: 375, height: 800 })
    await page.goto('/spaces')
    await expect(page.locator('[data-dm-panel]'), '375px: the section never appeared').toBeAttached({
        timeout: 20_000,
    })
    await expect(page.locator('[data-dm-neu]'), '375px: the compose button never appeared').toBeVisible({
        timeout: 20_000,
    })

    const schmal = await messeNav(page)
    // eslint-disable-next-line no-console
    console.log(`[dm-nav] @375x800: ${JSON.stringify(schmal)}`)

    expect(
        schmal.docScrollWidth,
        `375px: horizontal document overflow (${schmal.docScrollWidth}px)`,
    ).toBeLessThanOrEqual(375)

    expect(schmal.handyKopfText, '375px: the section is not the encrypted one').toBe('Verschlüsselt')
    // `min-h-11` sits on the ROW so the heading keeps its height even when the button is
    // absent — 44 px, the thumb target of Apple's HIG and WCAG 2.5.5.
    expect(schmal.handyKopf?.h, '375px: the heading row fell below the 44 px thumb target').toBeGreaterThanOrEqual(44)
    expect(schmal.handyNeuSichtbar, '375px: the compose button is not visible').toBe(true)
    // The section lives inside the room card, which is `px-2` inside a `px-3` page: it must
    // stay inside the viewport with room to spare rather than merely not overflow.
    expect(schmal.handyPanel?.w, '375px: the section is wider than the phone').toBeLessThanOrEqual(375)
    expect(schmal.handyPanel?.x, '375px: the section starts off-screen').toBeGreaterThanOrEqual(0)

    // And the rail is genuinely absent here — otherwise „the phone shows the section"
    // would also be true on a page that shows both.
    expect(schmal.railGruppe, '375px: the rail group rendered on a phone').toBeNull()
    expect(schmal.buzzDialoge, '375px: the removed Buzz DM dialog is still in the document').toBe(0)
})

test('the profile card offers writing and following — measured at 375 px and 1280 px', async ({ page }) => {
    test.setTimeout(120_000)

    await useZooid(page)
    await loginNsec(page, NSEC)

    const messeKarte = async (): Promise<{ dm: Kasten | null; folgen: Kasten | null; folgenText: string }> =>
        page.evaluate(() => {
            const rund = (n: number): number => Math.round(n * 100) / 100
            const kasten = (el: Element | null): Kasten | null => {
                if (!el) {
                    return null
                }
                const r = el.getBoundingClientRect()

                return { x: rund(r.x), y: rund(r.y), w: rund(r.width), h: rund(r.height) }
            }
            const folgen = document.querySelector<HTMLElement>('[data-person-follow]')

            return {
                dm: kasten(document.querySelector('[data-person-dm]')),
                folgen: kasten(folgen),
                folgenText: (folgen?.textContent ?? '').trim(),
            }
        })

    // A pubkey that is not ours: both buttons hide on your own card, by design.
    const FREMD = 'd'.repeat(64)

    for (const [breite, hoehe] of [[1280, 800], [375, 800]] as const) {
        await page.setViewportSize({ width: breite, height: hoehe })
        await page.goto('/spaces')
        await expect(page.locator('[data-modal="profile-card"]'), `${breite}px: the card is not in the document`)
            .toBeAttached({ timeout: 20_000 })

        await page.evaluate((pk) => {
            window.dispatchEvent(new CustomEvent('open-profile', { detail: pk }))
        }, FREMD)
        await expect(page.locator('[data-person-dm]'), `${breite}px: the write button never appeared`)
            .toBeVisible({ timeout: 20_000 })

        const karte = await messeKarte()
        // eslint-disable-next-line no-console
        console.log(`[dm-nav] profile card @${breite}x${hoehe}: ${JSON.stringify(karte)}`)

        // Both actions are there, side by side, and each takes half the row.
        expect(karte.dm?.h, `${breite}px: the write button has no height`).toBeGreaterThan(0)
        expect(karte.folgen?.h, `${breite}px: the follow button has no height`).toBeGreaterThan(0)
        expect(karte.folgenText, `${breite}px: the follow button carries the wrong label`).toBe('Folgen')
        // Same row: their vertical centres agree within a pixel.
        const mitteDm = (karte.dm as Kasten).y + (karte.dm as Kasten).h / 2
        const mitteFolgen = (karte.folgen as Kasten).y + (karte.folgen as Kasten).h / 2
        expect(Math.abs(mitteDm - mitteFolgen), `${breite}px: the two buttons are not on one row`).toBeLessThanOrEqual(1)
        // ── Neither button crowds the other out ─────────────────────────────────
        // Both carry `flex-1 basis-0`, so the row splits evenly — but „evenly" is not
        // „identical". Measured at 1280 px: 154.85 px and 156.75 px, a difference of
        // 1.9 px that comes from the primary button's own `border` and its `ps-2 pe-3`
        // against the other's `ps-3 pe-3`. The bound is 4 px, wide enough for that and far
        // too narrow for the failure it is here to catch: before the label was shortened,
        // „Nachricht schreiben" took its `whitespace-nowrap` minimum of 170.05 px and left
        // the follow button 141.55 — a difference of 28.5.
        expect(
            Math.abs((karte.dm as Kasten).w - (karte.folgen as Kasten).w),
            `${breite}px: the two buttons do not share the row evenly`,
        ).toBeLessThanOrEqual(4)

        await page.keyboard.press('Escape')
    }
})

test('the unread pill: rendered from the store, measured at 375 px and 1280 px', async ({ page }) => {
    test.setTimeout(120_000)

    // ── What this case measures, and what it deliberately does not ──────────────────
    // It measures the RENDER CHAIN: store value → pill on screen, at both widths. The
    // rows are placed into `$store.privateMessages.conversations` directly instead of
    // being earned through a second signer and a real gift wrap.
    //
    // That is a conscious cut, and the reason it is honest here: the run above showed
    // `pillen: 0` at both widths — a fresh relay has nothing unread, so an assertion on
    // the pill would have been an absence measurement without a positive control, green
    // for a surface that can never draw one. The COUNTING is proven where it lives
    // (`privateMessageModels.test.ts`, six cases incl. calibration); what no unit test
    // can answer is whether the number reaches the markup at all — and that is this case.
    await useZooid(page)
    await loginNsec(page, NSEC)

    const zeilen = [
        { key: 'aaaa,bbbb', participants: ['aaaa', 'bbbb'], others: ['bbbb'], lastAt: 1, preview: 'x', count: 3, unread: 3, title: 'Alice' },
        { key: 'aaaa,cccc', participants: ['aaaa', 'cccc'], others: ['cccc'], lastAt: 1, preview: 'y', count: 1, unread: 0, title: 'Bob' },
    ]

    for (const [breite, hoehe, anker] of [[1280, 800, '#rail-group-dms'], [375, 800, '[data-dm-panel]']] as const) {
        await page.setViewportSize({ width: breite, height: hoehe })
        await page.goto('/spaces')
        await expect(page.locator(anker), `${breite}px: the surface never appeared`).toBeAttached({ timeout: 20_000 })

        await page.evaluate((rows) => {
            const store = (window as unknown as { Alpine: { store(n: string): Record<string, unknown> } })
                .Alpine.store('privateMessages')
            store.conversations = rows
            store.unreadTotal = rows.reduce((sum, row) => sum + row.unread, 0)
        }, zeilen)

        const gemessen = await page.evaluate(async (sel) => {
            const rund = (n: number): number => Math.round(n * 100) / 100
            const wurzel = document.querySelector(sel)
            const pillen = [...(wurzel?.querySelectorAll<HTMLElement>('.rounded-pill.bg-brand-500') ?? [])]
            // ── Wait the `chip-in` animation out before measuring ────────────────────
            // It scales from 0.8, so a box read while it runs is 20 % too small — the
            // first run measured 12.80 px for a 16 px pill, which is exactly 16 × 0.8.
            // `unread-badge.blade.php` states the same trap in its own header, for its own
            // font measurement. `finished` rejects on a cancelled animation, hence catch.
            await Promise.all(pillen.flatMap((el) => el.getAnimations().map((a) => a.finished.catch(() => {}))))

            return {
                anzahl: pillen.length,
                texte: pillen.map((el) => (el.textContent ?? '').trim()),
                kaesten: pillen.map((el) => {
                    const r = el.getBoundingClientRect()

                    return { x: rund(r.x), w: rund(r.width), h: rund(r.height) }
                }),
                docScrollWidth: document.documentElement.scrollWidth,
            }
        }, breite === 1280 ? '#rail-group-dms' : '[data-dm-panel]')
        // eslint-disable-next-line no-console
        console.log(`[dm-nav] pills @${breite}x${hoehe}: ${JSON.stringify(gemessen)}`)

        // ── The two surfaces carry a DIFFERENT number of pills, and both are right ──
        // The phone section shows two levels, exactly like the neighbouring room
        // sections: the heading carries the SUM (`unreadTotal`, 16 px — a marker next to
        // the label) and the row carries its own (20 px — a free-standing pill at the end
        // of a row, house rule §9). The rail shows one: its group heading only carries a
        // summary while the group is CLOSED, and it is open here.
        //
        // What both must show is the same thing, and it is what this case is for: the
        // second conversation has `unread: 0` and draws NO pill. Three pills on the phone
        // would mean `unread-badge`'s `x-if` stopped holding; zero anywhere would mean the
        // number never left the store.
        const erwartet = breite === 1280 ? 1 : 2
        expect(gemessen.anzahl, `${breite}px: expected exactly ${erwartet} unread pill(s)`).toBe(erwartet)
        expect(gemessen.texte, `${breite}px: a pill shows the wrong number`).toEqual(Array(erwartet).fill('3'))
        // 16 px marker, 20 px free-standing pill — measured rather than assumed, because
        // the size is a prop and a wrong one would look almost right.
        expect(gemessen.kaesten.map((k) => k.h), `${breite}px: a pill has the wrong height`)
            .toEqual(breite === 1280 ? [16] : [16, 20])
        expect(
            gemessen.docScrollWidth,
            `${breite}px: the pill pushed the document into horizontal overflow`,
        ).toBeLessThanOrEqual(breite)
    }
})
