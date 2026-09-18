import { test, expect, type Locator, type Page } from './support/fixtures'
import { execFileSync } from 'node:child_process'
import { useZooid, ZOOID_URL, ZOOID_WS } from './support/zooid'
import { loginNsec } from './support/login'
import { testKeys } from './support/keys'
import {
    admitReader,
    relayFollowList,
    releaseAdmittedReaders,
    secondsAgo,
    seedFollowList,
    seedRelayList,
    RELAY_OWNER_SEC,
    type WireFollowList,
    type WireReader,
} from './support/followWire'

/**
 * ── P6: what LANDS ON THE RELAY when somebody follows a whole selection ─────────────
 *
 * The companion of `follow.spec.ts` for the bulk path. The four P4 cases in
 * `directory.spec.ts` measure the SURFACE of this action — the frozen selection, the
 * preview figures, the chunk callout, the retry offer. Here the witness is `nak`: one
 * signed event for n people, the base underneath it, and — the case this plan exists for —
 * what happens when the contact list moves between the preview and the signature.
 *
 * `nak` prints the signed event and exits 0 even when the relay refuses it, so every
 * assertion below is a REQUERY of what the relay is holding afterwards.
 */

const NAK = process.env.NAK ?? `${process.env.HOME}/go/bin/nak`

/** Pubkeys that are nobody in this space — a base bigger than any selection. */
const BASE_A = 'a'.repeat(64)
const BASE_B = 'b'.repeat(64)
/** What another device writes into the contact list while the preview stands. */
const ELSEWHERE = 'e'.repeat(64)

const pubOf = (sec: string): string => execFileSync(NAK, ['key', 'public', sec]).toString().trim()

/** The relay's copy, as a sentence a failure message can carry. */
const wire = (list: WireFollowList | null): string =>
    list === null ? 'no kind 3 at all' : `id ${list.id.slice(0, 8)}, p tags ${JSON.stringify(list.p)}`

/** The same sentence into the run output, like the pixel measurements further down. */
const logWire = (label: string, list: WireFollowList | null): void => {
    // eslint-disable-next-line no-console
    console.log(`[follow-bulk] ${label}: ${wire(list)}`)
}

/** Open the directory as `reader` and wait until the member grid is there. */
async function openDirectory(page: Page, reader: WireReader): Promise<void> {
    await useZooid(page)
    await loginNsec(page, reader.nsec)
    await page.goto('/bereich/leute')
    await expect(page.locator('.list-stagger').getByText('Relay Admin')).toBeVisible({ timeout: 20_000 })
}

/**
 * Tick the rows of `targets`, with selection mode ALREADY on.
 *
 * Separate from {@link enterSelection} because a successful bulk write clears the selection
 * and leaves the mode ON — `[data-directory-select-toggle]` is the ENTRY button and is gone
 * while the mode runs, so calling `enterSelection` a second time waits 180 s for an element
 * that will never come back. Measured 2026-09-15; the failure reads like a hung page.
 */
async function tickRows(page: Page, targets: readonly string[]): Promise<void> {
    for (const pk of targets) {
        await page.locator(`[data-directory-row][data-pubkey="${pk}"] [data-directory-row-check]`).click()
    }
}

/** Turn on selection mode and tick the rows of `targets`. */
async function enterSelection(page: Page, targets: readonly string[]): Promise<void> {
    await page.locator('[data-directory-select-toggle]').click()
    await tickRows(page, targets)
}

/**
 * Press „Auswahl prüfen" and wait for the dialog.
 *
 * ONE step, unlike the helper in `directory.spec.ts`: every reader in this file declares a
 * NIP-65 write relay, so the arming pass on page load does read their contact list and
 * `listSeen` is already true. The two-step label („Kontaktliste laden" first) belongs to
 * the `confirmed-none` reader, who is deliberately not read on a page load.
 */
async function openBulkPreview(page: Page): Promise<Locator> {
    const submit = page.locator('[data-directory-bulk-submit]')
    await expect(submit).toHaveText('Auswahl prüfen', { timeout: 40_000 })
    await submit.click()
    const modal = page.locator('dialog[data-modal="follow-bulk-preview"]')
    await expect(modal).toBeVisible({ timeout: 15_000 })

    return modal
}

/**
 * The pubkeys of the selected rows, **in the order the member grid renders them**.
 *
 * `openBulkPreview` freezes `this.members.map(…).filter(isSelected)`, so the write goes out
 * in member-list order and not in the order the boxes were ticked — deliberately, so the
 * dialog can be read next to the list. Hard-coding that order into an expectation would
 * pin whatever the relay-signed 13534 happened to return on the day it was written; asking
 * the DOM pins the promise instead.
 */
const selectedRowOrder = (page: Page): Promise<string[]> =>
    page.evaluate(() =>
        [...document.querySelectorAll('[data-directory-row]')]
            .filter((row) => (row.querySelector('[data-directory-row-check]') as HTMLInputElement | null)?.checked)
            .map((row) => row.getAttribute('data-pubkey') ?? ''))

/**
 * **ONE event for n people, and the base comes through whole.**
 *
 * Two members are selected out of a contact list that already holds two strangers. What has
 * to be on the relay afterwards is a single kind 3 with four `p` tags: the two new people in
 * front, in member-list order, and the untouched base behind them — `withFollowedPubkeys`
 * puts additions in front rather than rebuilding the list, which is what makes the base a
 * SUFFIX of the result and shrinking structurally impossible.
 *
 * The count is the whole point of the bulk path: NIP-02 replaces the entire list on every
 * write, so n follows in n events would be n chances to lose the other n-1. What lands here
 * is one event — its id is one step away from the seeded one, and it carries everybody.
 */
test('CORE: one event for n targets, and the whole base is still under it', async ({ page }) => {
    test.setTimeout(180_000)
    const reader = admitReader()
    const admin = pubOf(RELAY_OWNER_SEC)
    const shared = testKeys().pk
    seedFollowList(reader, [BASE_A, BASE_B], { createdAt: secondsAgo(120) })
    seedRelayList(reader, [ZOOID_URL])

    const before = relayFollowList(reader)
    logWire('before the bulk follow', before)
    expect(before?.p, `the seed is not what the relay holds (${wire(before)})`).toEqual([BASE_A, BASE_B])

    await openDirectory(page, reader)
    await enterSelection(page, [admin, shared])
    const expectedOrder = await selectedRowOrder(page)
    expect(expectedOrder, 'the two ticked rows are not the two people this case selects').toHaveLength(2)
    const modal = await openBulkPreview(page)

    await expect(page.locator('[data-directory-bulk-growth]')).toHaveText('Deine Kontaktliste wächst von 2 auf 4.')
    await expect(page.locator('[data-directory-bulk-add]')).toHaveText('2')
    await page.locator('[data-directory-bulk-confirm]').click()
    await expect(modal).toBeHidden({ timeout: 40_000 })
    await expect(page.locator('[data-directory-bulk-error]')).toBeHidden()

    const after = relayFollowList(reader)
    logWire('after the bulk follow', after)
    expect([...expectedOrder].sort(), 'the selection is not the pair this case ticked')
        .toEqual([admin, shared].sort())
    expect(after?.p, `the bulk write is not what the relay holds (${wire(after)})`)
        .toEqual([...expectedOrder, BASE_A, BASE_B])
    expect(after?.id, 'the relay is still holding the seeded event').not.toBe(before?.id)
})

/**
 * **A contact list that moved between the preview and the signature is NOT written over.**
 *
 * This is the F1 damage state at the wire, and it is the reason the preview freezes an
 * event id rather than a count: the reader confirms figures taken against ONE list, and
 * whatever comes back from the relays a moment later may be another one. Measured on
 * `6565549` before the repair: the dialog said „703 → 706", the signed event carried 403
 * tags, and `store.error` stayed `''` — the surface reported success while 300 contacts
 * were gone.
 *
 * Here the list moves for the most ordinary reason there is: the same person follows
 * somebody on another device while this dialog stands. The write has to refuse, say so, and
 * leave the newer list exactly as the other device left it.
 *
 * **And then the advice in that refusal is followed, in the same case.** „prüfe die Auswahl
 * noch einmal" is only worth something if the second attempt goes through — and it doubles
 * as the positive control: „nothing was written" is trivially true of a dialog whose button
 * does nothing at all.
 */
test('CORE: a base that moved between preview and signature is not written over', async ({ page }) => {
    test.setTimeout(180_000)
    const reader = admitReader()
    const admin = pubOf(RELAY_OWNER_SEC)
    seedFollowList(reader, [BASE_A, BASE_B], { createdAt: secondsAgo(120) })
    seedRelayList(reader, [ZOOID_URL])

    await openDirectory(page, reader)
    await enterSelection(page, [admin])
    const modal = await openBulkPreview(page)
    await expect(page.locator('[data-directory-bulk-growth]')).toHaveText('Deine Kontaktliste wächst von 2 auf 3.')

    // ── The other device, while the dialog stands ──────────────────────────────────
    // Strictly between the seed and whatever the client signs next, and BOTH of those
    // bounds are load-bearing — `secondsAgo` in `support/followWire.ts` carries the two
    // failures (a tie is a coin flip between two different rules, a future stamp makes
    // zooid drop the client's write in silence).
    seedFollowList(reader, [ELSEWHERE, BASE_A, BASE_B], { createdAt: secondsAgo(60) })
    const moved = relayFollowList(reader)
    logWire('after the other device wrote', moved)
    expect(moved?.p, `the other device's write never reached the relay (${wire(moved)})`)
        .toEqual([ELSEWHERE, BASE_A, BASE_B])

    await page.locator('[data-directory-bulk-confirm]').click()
    // `soft`, for the same reason as the core case in `follow.spec.ts`: the message and the
    // relay fail independently, and the relay is the load-bearing half. A hard assertion
    // here stops the case at the silent error slot — measured under the mutation that
    // removes the F1 refusal, where the interesting half is „and then WHAT was written".
    await expect.soft(page.locator('[data-directory-bulk-error]')).toHaveText(
        'Deine Kontaktliste hat sich seit der Vorschau geändert. Es wurde nichts geschrieben — prüfe die Auswahl noch einmal.',
        { timeout: 40_000 },
    )
    // A refused write voids the plan, so the dialog closes and the numbers cannot be
    // signed a second time. Soft as well — this one closes on a successful write too, so
    // on its own it says nothing, and stopping here would again cost the wire half.
    await expect.soft(modal).toBeHidden()

    const afterRefusal = relayFollowList(reader)
    logWire('after the refused confirm', afterRefusal)
    expect(afterRefusal?.p, `the newer list was written over (${wire(afterRefusal)})`)
        .toEqual([ELSEWHERE, BASE_A, BASE_B])
    expect(afterRefusal?.id, 'a kind 3 was signed against a base the reader never saw').toBe(moved?.id)

    // ── The advice, followed — and the positive control of the refusal above ───────
    const again = await openBulkPreview(page)
    await expect(page.locator('[data-directory-bulk-growth]')).toHaveText('Deine Kontaktliste wächst von 3 auf 4.')
    await page.locator('[data-directory-bulk-confirm]').click()
    // The dialog closes on BOTH outcomes — a refusal voids the plan — so the closing says
    // nothing on its own and the silent error slot is the assertion that separates them.
    await expect(again).toBeHidden({ timeout: 40_000 })
    await expect(page.locator('[data-directory-bulk-error]')).toBeHidden()

    const written = relayFollowList(reader)
    logWire('after the second, re-checked attempt', written)
    expect(written?.p, `the second attempt did not land either (${wire(written)})`)
        .toEqual([admin, ELSEWHERE, BASE_A, BASE_B])
})

/** A box in CSS pixels, rounded to two decimals — the same shape `dm-nav-widths` uses. */
type Box = { x: number; y: number; w: number; h: number }

type BarMetrics = {
    bar: Box | null
    cancel: Box | null
    submit: Box | null
    summary: Box | null
    navHeight: number
    docScrollWidth: number
    docScrollHeight: number
    scrollY: number
    viewportWidth: number
    viewportHeight: number
}

const measureBar = (page: Page): Promise<BarMetrics> =>
    page.evaluate(() => {
        const round2 = (n: number): number => Math.round(n * 100) / 100
        const box = (el: Element | null): Box | null => {
            if (!el) {
                return null
            }
            const r = el.getBoundingClientRect()

            return { x: round2(r.x), y: round2(r.y), w: round2(r.width), h: round2(r.height) }
        }
        const bar = document.querySelector('[data-directory-bulk-bar]')

        return {
            bar: box(bar),
            cancel: box(document.querySelector('[data-directory-bulk-cancel]')),
            submit: box(document.querySelector('[data-directory-bulk-submit]')),
            // The selection summary — one line above the buttons on a phone, beside them
            // from `sm` up. Which of the two it is, is the layout question of this bar.
            //
            // `:scope > div > p` and not `div > p`: the bar carries two more paragraphs as
            // DIRECT children (the hint and the error), both `x-show`n and therefore
            // `display:none` most of the time — and a hidden element measures as a box at
            // 0,0,0,0. The first version of this line measured one of those and read
            // „the summary sits 620 px above the buttons", which is a true statement about
            // an element that is not on screen at all.
            summary: box(bar?.querySelector(':scope > div > p') ?? null),
            navHeight: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--group-nav-h')) || 0,
            docScrollWidth: document.documentElement.scrollWidth,
            docScrollHeight: document.documentElement.scrollHeight,
            scrollY: Math.round(window.scrollY),
            viewportWidth: window.innerWidth,
            viewportHeight: window.innerHeight,
        }
    }) as Promise<BarMetrics>

/**
 * **The bulk bar and its preview, measured at two widths — in pixels, not in class names.**
 *
 * The bar is the only new sticky surface of this plan, it sits above a bottom bar whose
 * height it does not know at build time (`--group-nav-h`, published by `bottom-nav`), and
 * its own comment carries a measurement that is exactly the failure this case guards:
 * before the `flex-col sm:flex-row` split, `flex-1 basis-0` handed each of the two buttons
 * 448 px of an 896 px bar — the phone layout wearing a desktop's width.
 *
 * So both widths ask a different question of the same markup:
 *
 *  · **375 px** — stacked. The buttons share one row evenly, the summary sits ABOVE them,
 *    and the whole bar has to clear the bottom navigation rather than sit under it.
 *  · **1280 px** — one line. The buttons take their own content width (and nothing like
 *    half the bar), the summary is on the SAME row as them, and there is no bottom bar to
 *    clear (`--group-nav-h` reports 0 from `xl` up, which is why this needs no breakpoint).
 *
 * The preview dialog is measured at both widths too: it is `max-w-sm`, which is wider than
 * a 375 px viewport minus its margins if nothing holds it.
 */
test('the bulk bar and its preview, measured at 375 px and 1280 px', async ({ page }) => {
    test.setTimeout(180_000)
    const reader = admitReader()
    const admin = pubOf(RELAY_OWNER_SEC)
    seedFollowList(reader, [BASE_A, BASE_B])
    seedRelayList(reader, [ZOOID_URL])

    await page.setViewportSize({ width: 375, height: 800 })
    await openDirectory(page, reader)
    await enterSelection(page, [admin])

    await expect(page.locator('[data-directory-bulk-bar]')).toBeVisible({ timeout: 20_000 })
    const narrow = await measureBar(page)
    // eslint-disable-next-line no-console
    console.log(`[follow-bulk] bar @375x800: ${JSON.stringify(narrow)}`)

    expect(narrow.docScrollWidth, `375px: horizontal document overflow (${narrow.docScrollWidth}px)`)
        .toBeLessThanOrEqual(375)
    expect(narrow.bar?.x, '375px: the bar starts off-screen').toBeGreaterThanOrEqual(0)
    expect((narrow.bar as Box).x + (narrow.bar as Box).w, '375px: the bar is wider than the phone')
        .toBeLessThanOrEqual(375)
    // The sticky offset is `--group-nav-h` plus 0.75rem, and the bottom bar is really there
    // at this width — so this is the assertion that the bar clears it instead of hiding
    // behind it. One pixel of tolerance for sub-pixel rounding of the rem.
    expect(narrow.navHeight, '375px: the bottom navigation reports no height').toBeGreaterThan(0)
    const narrowBottom = (narrow.bar as Box).y + (narrow.bar as Box).h
    expect(narrowBottom, `375px: the bar (bottom ${narrowBottom}) reaches into the bottom navigation`)
        .toBeLessThanOrEqual(800 - narrow.navHeight - 11)
    // Stacked: the summary is its own line above the buttons, and the two buttons share
    // the row. „Evenly" is not „identical" — the primary carries a border the ghost does
    // not (measured 3.9 px apart on the profile card for the same construction).
    expect((narrow.summary as Box).y, '375px: the summary is not above the buttons')
        .toBeLessThan((narrow.submit as Box).y)
    expect(
        Math.abs((narrow.cancel as Box).w - (narrow.submit as Box).w),
        '375px: the two buttons do not share the row evenly',
    ).toBeLessThanOrEqual(4)
    expect((narrow.submit as Box).w, '375px: the buttons do not stretch to fill the bar')
        .toBeGreaterThan((narrow.bar as Box).w / 3)

    // ── The same phone, half as tall: now the page scrolls and the bar has to PIN ──
    // At 800 px this page is shorter than the window, so the bar sits where the flow puts
    // it and `sticky` has nothing to do — an assertion about the sticky offset would be
    // vacuous there. This is the state the offset was written for: content underneath,
    // a bottom navigation to clear, and the bar pinned above it.
    await page.setViewportSize({ width: 375, height: 400 })
    const pinned = await measureBar(page)
    // eslint-disable-next-line no-console
    console.log(`[follow-bulk] bar @375x400 (pinned): ${JSON.stringify(pinned)}`)
    expect(pinned.docScrollHeight, '375x400: the page does not scroll, so nothing is pinned')
        .toBeGreaterThan(400)
    const pinnedBottom = (pinned.bar as Box).y + (pinned.bar as Box).h
    // `bottom-[calc(var(--group-nav-h)+0.75rem)]` — 60 px of bottom bar plus 12 px, so the
    // bar's own bottom edge lands 72 px above the window's. One pixel for rounding.
    expect(pinnedBottom, `375x400: the pinned bar (bottom ${pinnedBottom}) is not at its sticky offset`)
        .toBeGreaterThanOrEqual(400 - pinned.navHeight - 13)
    expect(pinnedBottom, `375x400: the pinned bar (bottom ${pinnedBottom}) reaches into the bottom navigation`)
        .toBeLessThanOrEqual(400 - pinned.navHeight - 11)
    await page.setViewportSize({ width: 375, height: 800 })

    // ── The preview at the same width ──────────────────────────────────────────────
    const modal = await openBulkPreview(page)
    const dialogSchmal = await page.locator('dialog[data-modal="follow-bulk-preview"]').boundingBox()
    // eslint-disable-next-line no-console
    console.log(`[follow-bulk] dialog @375x800: ${JSON.stringify(dialogSchmal)}`)
    expect(dialogSchmal?.x, '375px: the dialog starts off-screen').toBeGreaterThanOrEqual(0)
    expect((dialogSchmal?.x ?? 0) + (dialogSchmal?.width ?? 0), '375px: the dialog is wider than the phone')
        .toBeLessThanOrEqual(375)
    await expect(page.locator('[data-directory-bulk-growth]')).toBeVisible()
    await modal.getByRole('button', { name: 'Abbrechen' }).click()
    await expect(modal).toBeHidden()

    // ══ 1280 px — one line, no bottom bar to clear ══════════════════════════════════
    await page.setViewportSize({ width: 1280, height: 800 })
    await expect(page.locator('[data-directory-bulk-bar]')).toBeVisible({ timeout: 20_000 })
    const wide = await measureBar(page)
    // eslint-disable-next-line no-console
    console.log(`[follow-bulk] bar @1280x800: ${JSON.stringify(wide)}`)

    expect(wide.docScrollWidth, `1280px: horizontal document overflow (${wide.docScrollWidth}px)`)
        .toBeLessThanOrEqual(1280)
    // THE failure the `flex-col sm:flex-row` split exists for: 448 px of an 896 px bar per
    // button. A quarter of the bar is far above any label these two carry and far below
    // the half that the stacked layout produces.
    expect((wide.submit as Box).w, '1280px: the primary button is stretched like on a phone')
        .toBeLessThan((wide.bar as Box).w / 4)
    expect((wide.cancel as Box).w, '1280px: the ghost button is stretched like on a phone')
        .toBeLessThan((wide.bar as Box).w / 4)
    // One line: the summary's vertical centre agrees with the buttons'.
    const summaryCentre = (wide.summary as Box).y + (wide.summary as Box).h / 2
    const submitCentre = (wide.submit as Box).y + (wide.submit as Box).h / 2
    expect(Math.abs(summaryCentre - submitCentre), '1280px: the summary is not on the row of the buttons')
        .toBeLessThanOrEqual(1)
    // From `xl` the web host renders no bottom bar at all, and `--group-nav-h` reports that
    // by itself — which is why the sticky offset needs neither a breakpoint nor a host
    // check. The bar is in flow here (this page is shorter than the window at 800 px), so
    // what is measured is that it stands fully inside the viewport, not where it is pinned.
    expect(wide.navHeight, '1280px: the bottom navigation still reports a height').toBe(0)
    const wideBottom = (wide.bar as Box).y + (wide.bar as Box).h
    expect((wide.bar as Box).y, '1280px: the bar starts above the top edge').toBeGreaterThanOrEqual(0)
    expect(wideBottom, `1280px: the bar (bottom ${wideBottom}) hangs out of the viewport`).toBeLessThanOrEqual(800)

    const wideModal = await openBulkPreview(page)
    const dialogBreit = await page.locator('dialog[data-modal="follow-bulk-preview"]').boundingBox()
    // eslint-disable-next-line no-console
    console.log(`[follow-bulk] dialog @1280x800: ${JSON.stringify(dialogBreit)}`)
    // `max-w-sm` is 24 rem = 384 px — the dialog does not grow with the window, and the
    // four figures stay in a column the eye can compare.
    expect(dialogBreit?.width, '1280px: the dialog ignored its `max-w-sm`').toBeLessThanOrEqual(384)
    await expect(page.locator('[data-directory-bulk-growth]')).toBeVisible()
    await wideModal.getByRole('button', { name: 'Abbrechen' }).click()
})

/**
 * **The browser console over the whole bulk flow — with the proof that it was listening.**
 *
 * Same construction and same reason as the case in `follow.spec.ts`: a server-side test
 * never sees the browser that runs the markup, and this surface is 301 lines of Blade plus
 * ~190 lines of island methods that no browser-side error channel had ever watched. The
 * walk goes through selection mode, the bar, the preview, a REAL write and an INERT press,
 * because a handler that only ever runs on the happy path is half measured.
 *
 * **Both halves are load-bearing wording, and this sentence has been wrong twice.** It first
 * promised an inert branch the walk never took; the repair made the branch real and left the
 * sentence promising a write the walk no longer did. The walk now does both, and the
 * assertions below say which is which — a docblock nobody can fail is how this file lost the
 * claim twice.
 */
test('the bulk flow makes no console noise, and the channel that says so is live', async ({ page, pageErrorWaechter }) => {
    test.setTimeout(180_000)
    const reader = admitReader()
    const admin = pubOf(RELAY_OWNER_SEC)
    const shared = testKeys().pk
    // `admin` is seeded into the base ON PURPOSE: it is what makes the FIRST preview add
    // exactly one person, and the second one inert. A gate found an earlier shape of this
    // case describing an inert branch it never reached — `admin` was not followed, the
    // button was not disabled, and the click performed a real bulk write.
    seedFollowList(reader, [BASE_A, BASE_B, admin])
    seedRelayList(reader, [ZOOID_URL])

    await openDirectory(page, reader)

    // ── First half: a real write, signed and confirmed at the relay ───────────────────
    //
    // `admin` is already in the base, `shared` is not, so this preview adds exactly one and
    // the confirm button is live. The wire check is what makes „a write" a measurement:
    // without it the press is green whether or not anything was ever signed.
    const before = relayFollowList(reader)
    await enterSelection(page, [admin, shared])
    const modal = await openBulkPreview(page)
    await expect(page.locator('[data-directory-bulk-confirm]')).not.toHaveAttribute('aria-disabled', 'true')
    await page.locator('[data-directory-bulk-confirm]').click()
    await expect(modal).toBeHidden({ timeout: 40_000 })
    await expect
        .poll(() => relayFollowList(reader)?.p.includes(shared) ?? false, { timeout: 30_000 })
        .toBe(true)
    const after = relayFollowList(reader)
    expect(after?.id, 'the bulk write produced no new event at the relay').not.toBe(before?.id)

    // ── Second half: the inert press ──────────────────────────────────────────────────
    //
    // Everybody selected is now already followed, so the confirm button announces itself as
    // disabled and the press has to do nothing — through the KEYBOARD, because Playwright's
    // `click()` refuses an `aria-disabled` control with a 30 s timeout and the house pattern
    // for inert buttons is reachable no other way.
    await tickRows(page, [admin, shared])
    await openBulkPreview(page)
    const confirm = page.locator('[data-directory-bulk-confirm]')
    // These two assertions are the case, not scenery: without them the keypress below is
    // green whatever the button does, which is exactly how the earlier shape passed while
    // measuring the opposite branch.
    await expect(confirm).toHaveAttribute('aria-disabled', 'true')
    await expect(page.locator('[data-directory-bulk-growth]'))
        .toHaveText(/ändert sich nicht/)
    await confirm.focus()
    await page.keyboard.press('Enter')
    await expect(modal).toBeVisible()
    await modal.getByRole('button', { name: 'Abbrechen' }).click()
    await expect(modal).toBeHidden({ timeout: 40_000 })

    // …and back out of selection mode, which removes the bar and moves the focus.
    await page.locator('[data-directory-bulk-cancel]').click()
    await expect(page.locator('[data-directory-bulk-bar]')).toHaveCount(0)

    expect(
        pageErrorWaechter.gesehen().map((f) => `${f.quelle}: ${f.text}`),
        'the bulk flow put something on the browser console',
    ).toEqual([])

    // ── The positive control, in the same run and on the same page ─────────────────
    await page.evaluate(() => {
        setTimeout(() => {
            throw new Error('MASSEN-FOLGEN-KONSOLE-POSITIVKONTROLLE')
        }, 0)
    })
    await expect
        .poll(
            () => pageErrorWaechter.gesehen().some((f) => f.quelle === 'pageerror' && f.text.includes('MASSEN-FOLGEN-KONSOLE-POSITIVKONTROLLE')),
            { timeout: 5_000, message: 'the console channel did not record a deliberately thrown error — it was not listening' },
        )
        .toBe(true)
})

/** Every throwaway reader this file let onto the relay is taken back out again. */
test.afterAll(() => releaseAdmittedReaders())
