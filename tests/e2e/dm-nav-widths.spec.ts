import { test, expect, type Page } from './support/fixtures'
import { useZooid } from './support/zooid'
import { loginNsec } from './support/login'

/**
 * **The way into the encrypted conversations — measured at 390 px and 1280 px.**
 *
 * ── What this file measured until P3, and why the subject changed ────────────────────
 *
 * Until P3 the navigation SHOWED the conversations: a list in the room card on a phone, a
 * rail group on desktop, each with unread pills. D5 of the navigation revamp ends that —
 * NIP-17 wraps are decrypted only while the Postfach's „Direkt" segment is open, and a list
 * of conversations IS the decrypted state (titles come from the participants inside the
 * seal, the unread number from a watermark whose key is only known after decrypting).
 *
 * So what stands in the navigation now is ONE row that leads there, and this file measures
 * that row plus the two promises that come with it:
 *
 *  · the entry is reachable and hits the thumb target at a phone's width;
 *  · the navigation carries NO number about the conversations — at either width;
 *  · the render chain "store → unread pill" still works where it now lives: inside the
 *    Direkt segment.
 *
 * The file is rewritten and not deleted (D15): the surface still exists, its promise turned
 * around. „Sichtbare UI ist erst fertig, wenn sie gemessen wurde": real numbers at two
 * widths, from a run.
 *
 * ── Why the file is NOT called `desktop-*` and not `buzz-*` ─────────────────────────
 *
 * `playwright.config.ts` hands every `desktop-*.spec.ts` to the `desktop` project, which
 * pins 1440×900 — a case that measured „1280" from inside it would in fact measure 1440.
 * And in buzz mode `chromium` narrows to `BUZZ_SPECS`, so a `buzz-` prefix would run this
 * against a relay whose DM channels P8 removed. Under this name it runs in the `chromium`
 * project against zooid, and both viewports are set explicitly below.
 */
const NSEC = process.env.NOSTR_TEST_NSEC as string

type Kasten = { x: number; y: number; w: number; h: number }

/** Everything both widths need, read in one pass off the rendered tree. */
async function messeNav(page: Page): Promise<{
    docScrollWidth: number
    /** The rail entry — desktop only; `null` below `xl`, where the rail does not exist. */
    railEintrag: Kasten | null
    railEintragSichtbar: boolean
    railText: string
    /** The row in the room list — phone only; hidden from `xl` up by its caller's `x-if`. */
    handyPanel: Kasten | null
    handyZeile: Kasten | null
    handyZeileText: string
    /** Unread pills anywhere in the two surfaces. Since P3 this has to be 0 (D5). */
    pillen: number
    /** Any digit in the entry's text — a count would have to appear as one. */
    ziffern: string[]
    /** Is the wrap store mounted at all? Outside the Direkt segment it must not be. */
    storeGemountet: boolean
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
        const rail = document.querySelector<HTMLElement>('[data-rail-dm]')
        const panel = document.querySelector('[data-dm-panel]')
        const zeile = document.querySelector<HTMLElement>('[data-dm-oeffnen]')
        const texte = [rail?.textContent ?? '', zeile?.textContent ?? '']

        return {
            docScrollWidth: document.documentElement.scrollWidth,
            railEintrag: kasten(rail),
            railEintragSichtbar: rail ? rail.checkVisibility() : false,
            railText: (rail?.textContent ?? '').trim(),
            handyPanel: kasten(panel),
            handyZeile: kasten(zeile),
            handyZeileText: (zeile?.textContent ?? '').trim(),
            pillen: document.querySelectorAll('[data-rail-dm] .rounded-pill, [data-dm-panel] .rounded-pill').length,
            ziffern: texte.flatMap((text) => text.match(/\d+/g) ?? []),
            storeGemountet: Boolean(
                (window as unknown as { Alpine?: { store(n: string): unknown } }).Alpine?.store('privateMessages'),
            ),
            buzzDialoge: document.querySelectorAll('[data-modal="dm"]').length,
        }
    })
}

test('the way into the conversations: measured at 390 px and 1280 px, and without a number', async ({ page }) => {
    // Two page loads plus a relay round trip for the space; the 30 s default would eat into
    // the waits rather than into the work.
    test.setTimeout(120_000)

    await useZooid(page)
    await loginNsec(page, NSEC)

    // ══ 1280 px — the first width at which the rail exists at all ════════════════════
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto('/bereich/chat')
    await expect(page.locator('[data-rail-dm]'), '1280px: the rail entry never appeared').toBeAttached({
        timeout: 20_000,
    })

    const breit = await messeNav(page)
    // eslint-disable-next-line no-console
    console.log(`[dm-nav] @1280x800: ${JSON.stringify(breit)}`)

    expect(breit.railEintragSichtbar, '1280px: the entry exists but is not visible').toBe(true)
    expect(breit.railText, '1280px: the entry is not the encrypted one').toBe('Verschlüsselt')
    expect(
        breit.docScrollWidth,
        `1280px: horizontal document overflow (${breit.docScrollWidth}px)`,
    ).toBeLessThanOrEqual(1280)
    // The rail track is 20 rem = 320 px, minus the 1 px `border-e` and the `px-3` of the
    // scroller: 320 − 1 − 24 = 295. An entry wider than its column is the failure this
    // number catches.
    expect(breit.railEintrag?.w, '1280px: the entry does not fit the rail track').toBeLessThanOrEqual(295)
    expect(breit.railEintrag?.x, '1280px: the entry does not start inside the rail').toBeGreaterThanOrEqual(0)

    // The phone row must NOT boot here — the rail already carries the entry. Its `x-if`
    // carries `!$store.viewport?.desktop`.
    expect(breit.handyPanel, '1280px: the phone row booted next to the rail').toBeNull()
    // D5, at this width: no pill, no digit, and the wrap store not mounted at all.
    expect(breit.pillen, '1280px: the navigation draws an unread pill for the conversations').toBe(0)
    expect(breit.ziffern, '1280px: the entry carries a number').toEqual([])
    expect(breit.storeGemountet, '1280px: the wrap store is mounted outside the Direkt segment').toBe(false)
    // The Buzz DM dialog is gone with its transport, at every width.
    expect(breit.buzzDialoge, '1280px: the removed Buzz DM dialog is still in the document').toBe(0)

    // ══ 390 px — a phone, where the rail does not exist ══════════════════════════════
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/bereich/chat')
    await expect(page.locator('[data-dm-panel]'), '390px: the section never appeared').toBeAttached({
        timeout: 20_000,
    })
    await expect(page.locator('[data-dm-oeffnen]'), '390px: the row never appeared').toBeVisible({ timeout: 20_000 })

    const schmal = await messeNav(page)
    // eslint-disable-next-line no-console
    console.log(`[dm-nav] @390x844: ${JSON.stringify(schmal)}`)

    expect(
        schmal.docScrollWidth,
        `390px: horizontal document overflow (${schmal.docScrollWidth}px)`,
    ).toBeLessThanOrEqual(390)
    expect(schmal.handyZeileText, '390px: the row is not the one that leads to the conversations')
        .toBe('Verschlüsselte Nachrichten öffnen')
    // `min-h-11` = 44 px, the thumb target of Apple's HIG and WCAG 2.5.5. The row is the
    // only way into the conversations on a phone, so it is the one control that has to hit it.
    expect(schmal.handyZeile?.h, '390px: the row fell below the 44 px thumb target').toBeGreaterThanOrEqual(44)
    expect(schmal.handyZeile?.w, '390px: the row is wider than the phone').toBeLessThanOrEqual(390)
    expect(schmal.handyZeile?.x, '390px: the row starts off-screen').toBeGreaterThanOrEqual(0)
    expect(schmal.pillen, '390px: the navigation draws an unread pill for the conversations').toBe(0)
    expect(schmal.ziffern, '390px: the row carries a number').toEqual([])
    expect(schmal.storeGemountet, '390px: the wrap store is mounted outside the Direkt segment').toBe(false)

    // And the rail is genuinely absent here — otherwise „the phone shows the row" would also
    // be true on a page that shows both.
    expect(schmal.railEintrag, '390px: the rail entry rendered on a phone').toBeNull()
    expect(schmal.buzzDialoge, '390px: the removed Buzz DM dialog is still in the document').toBe(0)
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
        await page.goto('/bereich/chat')
        await expect(page.locator('[data-modal="profile-card"]'), `${breite}px: the card is not in the document`)
            .toBeAttached({ timeout: 20_000 })

        await page.evaluate((pk) => {
            window.dispatchEvent(new CustomEvent('open-profile', { detail: pk }))
        }, FREMD)
        // ── Since P3 this button no longer waits for a relay answer ───────────────────
        // Until P3 it hung on `$store.privateMessages?.canSend`, i.e. on a store that is
        // not mounted outside the Direkt segment any more — the condition would be
        // permanently `undefined` and the only way into a conversation from a profile would
        // have disappeared with the mount. It is a navigation now, so it is there as soon as
        // the card knows whose card it is.
        await expect(page.locator('[data-person-dm]'), `${breite}px: the write button never appeared`)
            .toBeVisible({ timeout: 20_000 })
        // ── Wait for the follow button to SETTLE, and expect the third state ───────────
        // This case measured „Folgen" and got „Lädt…" from the day P1 landed. Both were
        // right at the moment they were taken: the label is a function of the arming pass,
        // and the arming pass had not come back yet. What the reader of this suite is
        // (`NOSTR_TEST_NSEC`, no kind 10002 anywhere on the test relay) resolves to
        // `OutboxKnowledge = 'confirmed-none'`, and for that reader P2/D8 deliberately does
        // NOT read the contact list on a page load — asking four public relays on every
        // view is a presence signal for nothing. So the settled label is the one that
        // invites the read, and it never becomes „Folgen" without a click.
        await expect(page.locator('[data-person-follow]'), `${breite}px: the follow button never settled`)
            .toHaveText('Kontaktliste laden', { timeout: 30_000 })

        const karte = await messeKarte()
        // eslint-disable-next-line no-console
        console.log(`[dm-nav] profile card @${breite}x${hoehe}: ${JSON.stringify(karte)}`)

        // Both actions are there, side by side, and each takes half the row.
        expect(karte.dm?.h, `${breite}px: the write button has no height`).toBeGreaterThan(0)
        expect(karte.folgen?.h, `${breite}px: the follow button has no height`).toBeGreaterThan(0)
        expect(karte.folgenText, `${breite}px: the follow button carries the wrong label`).toBe('Kontaktliste laden')
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

test('NO surface draws a number about a conversation — with a positive control for the pill itself', async ({ page }) => {
    test.setTimeout(120_000)

    // ── What this case measured until P3, and what it measures now ──────────────────
    // It used to measure the RENDER CHAIN "store value → unread pill on screen" in the
    // navigation, by placing rows into `$store.privateMessages.conversations` directly. That
    // chain is GONE on purpose: D5 forbids a number about the conversations anywhere, and the
    // two surfaces that drew one (the room-list section and the rail group) are one neutral
    // row each now. The conversation list inside the Direkt segment never drew one either —
    // checked at the source before this case was rewritten.
    //
    // So the promise turned into an ABSENCE, and an absence needs a positive control, or it
    // is green for a broken selector just as happily as for a clean surface. The control is
    // the SAME component with the same class, fed by the ROOM watermark: `unread-badge`
    // renders `$store.unread.rooms[h]` in the very same list. If that pill appears and the
    // conversation pill does not, the zero is a statement about the DM surface.
    await useZooid(page)
    await loginNsec(page, NSEC)

    const zeilen = [
        { key: 'aaaa,bbbb', participants: ['aaaa', 'bbbb'], others: ['bbbb'], lastAt: 1, preview: 'x', count: 3, unread: 3, title: 'Alice' },
        { key: 'aaaa,cccc', participants: ['aaaa', 'cccc'], others: ['cccc'], lastAt: 1, preview: 'y', count: 1, unread: 0, title: 'Bob' },
    ]

    for (const [breite, hoehe] of [[1280, 800], [390, 844]] as const) {
        await page.setViewportSize({ width: breite, height: hoehe })

        // ══ The conversations: rows yes, number no ═══════════════════════════════════
        await page.goto('/postfach?ansicht=direkt')
        await expect(page.locator('[data-pm-liste]'), `${breite}px: the Direkt surface never appeared`)
            .toBeVisible({ timeout: 20_000 })

        await page.evaluate((rows) => {
            const store = (window as unknown as { Alpine: { store(n: string): Record<string, unknown> } })
                .Alpine.store('privateMessages')
            store.conversations = rows
            store.unreadTotal = rows.reduce((sum, row) => sum + row.unread, 0)
        }, zeilen)

        const dm = await page.evaluate(async () => {
            const pillen = [...document.querySelectorAll<HTMLElement>('.rounded-pill.bg-brand-500')]
            await Promise.all(pillen.flatMap((el) => el.getAnimations().map((a) => a.finished.catch(() => {}))))

            return {
                pillenImDokument: pillen.length,
                zeilen: document.querySelectorAll('[data-pm-zeile]').length,
                docScrollWidth: document.documentElement.scrollWidth,
            }
        })
        // eslint-disable-next-line no-console
        console.log(`[dm-nav] direkt @${breite}x${hoehe}: ${JSON.stringify(dm)}`)

        // The injection DID reach the markup — without this the zero below would also be the
        // score of a store nobody reads.
        expect(dm.zeilen, `${breite}px: the injected conversations did not render at all`).toBe(2)
        expect(dm.pillenImDokument, `${breite}px: a number about a conversation is on screen`).toBe(0)
        expect(dm.docScrollWidth, `${breite}px: horizontal overflow on the Direkt segment`).toBeLessThanOrEqual(breite)

        // ══ POSITIVE CONTROL: the selector really is the pill this house draws ══════════
        // Without it the zero above is also the score of a typo in the class name. The control
        // is STRUCTURAL and not a live injection, and that is a measured decision: the unread
        // store is fed by a live subscription (`deriveUnread`), which overwrites an injected
        // `store.rooms` on its next emit — tried first, and it produced a 0 that said nothing
        // about the surface.
        //
        // What is checked instead: the markup that WOULD draw a pill stands on the page, with
        // exactly the class this case searches for. `unread-badge` renders through
        // `<template x-if>`, and a `<template>`'s content is a separate fragment —
        // `querySelector` never reaches into it, which is why the live count above is 0 and
        // this check is not a contradiction but its control.
        const kontrolle = await page.evaluate(() => {
            const vorlagen = [...document.querySelectorAll('template')]

            return {
                vorlagen: vorlagen.length,
                mitPille: vorlagen.filter((t) => t.innerHTML.includes('rounded-pill') && t.innerHTML.includes('bg-brand-500')).length,
            }
        })
        // eslint-disable-next-line no-console
        console.log(`[dm-nav] control @${breite}x${hoehe}: ${JSON.stringify(kontrolle)}`)

        expect(kontrolle.vorlagen, `${breite}px: no templates on the page at all — the control measures nothing`)
            .toBeGreaterThan(0)
        expect(
            kontrolle.mitPille,
            `${breite}px: the class this case searches for does not appear in any pill template — the zero above proves nothing`,
        ).toBeGreaterThanOrEqual(1)
    }
})
