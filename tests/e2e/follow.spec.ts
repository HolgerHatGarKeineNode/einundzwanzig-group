import { test, expect, type Page } from './support/fixtures'
import { execFileSync } from 'node:child_process'
import { useZooid, ZOOID_URL, ZOOID_WS } from './support/zooid'
import { loginNsec } from './support/login'
import {
    admitReader,
    relayFollowList,
    releaseAdmittedReaders,
    seedFollowList,
    seedRelayList,
    startSilentRelay,
    RELAY_OWNER_SEC,
    type WireFollowList,
    type WireReader,
} from './support/followWire'

/**
 * ── P6: what LANDS ON THE RELAY when somebody follows one person ────────────────────
 *
 * Everything the P4 cases in `directory.spec.ts` measure stops at the surface — the frozen
 * selection, the preview figures, the callout, the retry offer. This file measures the
 * other end of the same action: the kind 3 the relay is holding afterwards, read back with
 * `nak` and not through the client that wrote it.
 *
 * **Why that separation is the whole point.** The damage state this plan exists for —
 * 703 contacts replaced by a one-tag list — was GREEN on every surface the client renders:
 * `store.error` stayed `''`, the button flipped to „Entfolgen", nothing was logged. The
 * only place it was ever visible is the relay. Until this file no test in this repo had
 * looked there.
 *
 * `nak` prints the signed event and exits 0 even when the relay refuses it, so the publish
 * itself proves nothing; every assertion below is a REQUERY.
 *
 * Every reader here is a fresh keypair (`support/followWire.ts`), never `NOSTR_TEST_NSEC`:
 * a kind 3 is replaceable, and under the shared identity there is no second copy.
 */

const NAK = process.env.NAK ?? `${process.env.HOME}/go/bin/nak`

/** Two pubkeys that are nobody in this space — the base whose survival is the measurement. */
const BASE_A = 'a'.repeat(64)
const BASE_B = 'b'.repeat(64)

/** The relay owner is a member of this space, so the directory offers a card for them. */
const pubOf = (sec: string): string => execFileSync(NAK, ['key', 'public', sec]).toString().trim()

/** Open the directory as `reader` and wait until the member grid is there. */
async function openDirectory(page: Page, reader: WireReader): Promise<void> {
    await useZooid(page)
    await loginNsec(page, reader.nsec)
    await page.goto('/directory')
    await expect(page.locator('.list-stagger').getByText('Relay Admin')).toBeVisible({ timeout: 20_000 })
}

/** Open one member's profile card the way the surface does it — through their row. */
async function openProfileCard(page: Page, pubkey: string): Promise<void> {
    await page.locator(`[data-directory-row][data-pubkey="${pubkey}"] button[aria-label="Profil anzeigen"]`).click()
    await expect(page.locator('[data-person-follow]')).toBeVisible({ timeout: 20_000 })
}

/**
 * Press the follow button even while it announces itself as `aria-disabled`.
 *
 * Playwright's `click()` refuses an `aria-disabled` element and burns a 30 s timeout on it.
 * That is not a reason to reach past the surface: `aria-disabled` is an ANNOUNCEMENT here
 * and not a lock (`profile-card.blade.php` writes that out), the control keeps its place in
 * the tab order on purpose, and the press through the keyboard is exactly the interaction
 * the third button state was built for.
 */
async function pressFollow(page: Page): Promise<void> {
    const button = page.locator('[data-person-follow]')
    await button.focus()
    await page.keyboard.press('Enter')
}

/**
 * Wait for one of the button's four labels — and say what the STORE looked like if it never
 * came.
 *
 * A bare `toHaveText` timeout on this button reports „expected Folgen, received Lädt…",
 * which is the one thing a reader already knows. Every label here is a function of four
 * store fields, and the difference between „the arming read has not come back yet" and „it
 * came back without an answer" is the difference between a slow relay and a refusal that
 * this card — unlike the bulk bar since F3 — offers no way out of.
 */
async function expectFollowLabel(page: Page, label: string, timeout = 40_000): Promise<void> {
    try {
        await expect(page.locator('[data-person-follow]')).toHaveText(label, { timeout })
    } catch (cause) {
        const state = await page.evaluate(() => {
            const store = (window as unknown as {
                Alpine: { store(name: string): Record<string, unknown> }
            }).Alpine?.store('follows')

            return store === undefined
                ? { store: 'not wired' }
                : {
                    listSeen: store.listSeen,
                    listReadFailed: store.listReadFailed,
                    noRelayList: store.noRelayList,
                    canFollow: store.canFollow,
                    busy: store.busy,
                    error: store.error,
                    following: (store.following as string[]).length,
                }
        })

        throw new Error(
            `the follow button never showed „${label}" within ${timeout} ms — $store.follows was `
                + `${JSON.stringify(state)}`,
            { cause },
        )
    }
}

/**
 * **Wait until the RELAY is holding a different kind 3 than `previousId`** — the barrier
 * for a write whose effect on the BUTTON is a coin flip.
 *
 * Measured on 2026-09-15, twice out of three repeat runs: after a follow and an unfollow
 * inside the SAME wall-clock second, the button stays on „Entfolgen" while the relay is
 * already holding the shortened list. The store is healthy while it does that —
 * `{"listSeen":true,"listReadFailed":false,"error":"","following":3}` — and the cause is
 * NIP-01, not a fault: `makeEvent` stamps SECONDS, so the two events tie, and
 * `followListWins` then keeps whichever id sorts lower. zooid resolves the same tie the
 * other way (`events.go:440`, `<=`, keeps the incoming event), so for roughly half of all
 * same-second pairs the client holds the older list and the relay the newer one.
 *
 * That is a product observation and it is reported as one; what it must not be is a coin
 * flip inside a test. So the second click of a pair is awaited at the WIRE, which is where
 * these cases make their statement anyway, and never at the label.
 */
async function waitForNewWireList(reader: WireReader, previousId: string): Promise<WireFollowList | null> {
    await expect
        .poll(() => relayFollowList(reader)?.id, {
            timeout: 30_000,
            message: `the relay is still holding ${previousId.slice(0, 8)} — the write never landed`,
        })
        .not.toBe(previousId)

    return relayFollowList(reader)
}

/** The relay's copy, as a sentence a failure message can carry. */
const wire = (list: WireFollowList | null): string =>
    list === null ? 'no kind 3 at all' : `id ${list.id.slice(0, 8)}, p tags ${JSON.stringify(list.p)}`

/**
 * The same sentence, into the run output — so a green run SHOWS what the relay held, the
 * way the layout cases in this suite print their pixels. An assertion that passes silently
 * leaves the reader of a report to take the number on trust.
 */
const logWire = (label: string, list: WireFollowList | null): void => {
    // eslint-disable-next-line no-console
    console.log(`[follow] ${label}: ${wire(list)}`)
}

/**
 * **THE CORE PROOF, and the one case that would have caught the original damage state.**
 *
 * The reader declares two write relays: the test relay, which holds their contact list of
 * A and B, and one that completes the WebSocket handshake and then says nothing at all.
 * The second one is the ordinary fault — a relay that is up, accepts the connection and
 * never closes the read.
 *
 * `followListAnswered` demands that EVERY target answered before a contact list may be
 * replaced. So the follow of C must refuse, say which relay stayed silent, and — the half
 * that only the relay can testify to — leave the stored list byte-identical: same event
 * id, A and B, no C.
 *
 * **With the positive control in the same case, and it is not decoration.** „Nothing was
 * written" is trivially true of a button that does nothing, a login that failed, or a
 * fixture that never reached the relay. So the second half takes the silent relay out of
 * the reader's declaration, reloads, and presses the SAME button on the SAME person: now
 * the write lands, and the base is still underneath it. The only difference between the
 * two halves is whether one declared relay answered.
 */
test('CORE: a declared relay that never answers stops the write — the relay keeps A and B', async ({ page, relayWaechter }) => {
    test.setTimeout(180_000)
    const silent = await startSilentRelay()
    // A local server this test started itself — the one thing a guard allowance may cover.
    relayWaechter.erlaube(silent.url)
    try {
        const reader = admitReader()
        const person = pubOf(RELAY_OWNER_SEC)
        seedFollowList(reader, [BASE_A, BASE_B])
        seedRelayList(reader, [ZOOID_URL, silent.url])

        const before = relayFollowList(reader)
        logWire('before the refused follow', before)
        expect(before, 'the seeded contact list never reached the relay').not.toBeNull()
        expect(before?.p, `the seed is not what the relay holds (${wire(before)})`).toEqual([BASE_A, BASE_B])

        await openDirectory(page, reader)
        await openProfileCard(page, person)

        // „Lädt…" is the honest label for a `listed` reader whose arming read is still out;
        // it stays there because this reader's second relay never answers.
        await expectFollowLabel(page, 'Lädt…', 30_000)
        await pressFollow(page)

        // `soft`, and for one reason: the two halves of this case fail INDEPENDENTLY, and
        // the wire half is the load-bearing one. A hard assertion here would stop the case
        // at the message and never ask the relay — measured under the mutation that turns
        // `followListAnswered` into a `some`: the surface simply says nothing, and the
        // interesting half („then what is on the relay?") would have gone unreported.
        await expect.soft(page.locator('[data-person-follow-fehler]')).toHaveText(
            `Diese Relais haben die Kontaktliste nicht ausgeliefert: ${silent.label}. Es wurde nichts geändert.`,
            { timeout: 40_000 },
        )

        // ── The half that no surface can testify to ─────────────────────────────────
        const after = relayFollowList(reader)
        logWire('after the refused follow', after)
        expect(after?.p, `the stored contact list changed (${wire(after)})`).toEqual([BASE_A, BASE_B])
        expect(after?.p, 'the followed person landed on the relay after a refused read').not.toContain(person)
        expect(after?.id, 'a new kind 3 was signed although the read was refused').toBe(before?.id)

        // ── The positive control: the same button, the same person, one relay less ──
        // A `listed` verdict is cached for the session (`listedRelayCache`), so the new
        // declaration is picked up by the reload and not before.
        seedRelayList(reader, [ZOOID_URL])
        await page.reload()
        await expect(page.locator('.list-stagger').getByText('Relay Admin')).toBeVisible({ timeout: 20_000 })
        await openProfileCard(page, person)
        await expectFollowLabel(page, 'Folgen')
        await page.locator('[data-person-follow]').click()
        await expectFollowLabel(page, 'Entfolgen')
        await expect(page.locator('[data-person-follow-fehler]')).toBeHidden()

        const written = relayFollowList(reader)
        logWire('after the same click with the silent relay gone', written)
        expect(written?.p, `the write did not land (${wire(written)})`).toEqual([person, BASE_A, BASE_B])
        expect(written?.id, 'the relay is still holding the old event').not.toBe(before?.id)
    } finally {
        await silent.close()
    }
})

/**
 * **The write lands, in both directions, and the base comes through it whole.**
 *
 * The base carries what a real contact list carries and a synthetic one does not: a
 * petname column on one entry, and a legacy relay map in `content` (some clients still keep
 * theirs there). `planFollowWrite` copies `content` over unchanged and `withFollowedPubkeys`
 * puts new people IN FRONT of the base rather than rebuilding it — so the base is a SUFFIX
 * of the result, column for column. That is what makes shrinking structurally impossible
 * instead of merely tested, and it is invisible in any assertion that only counts tags.
 *
 * The unfollow is in the same case on purpose: it is the one direction that REMOVES
 * something, and „does it remove exactly one entry" is a question about the other two.
 */
test('the follow and the unfollow land on the relay, and the base keeps its columns', async ({ page }) => {
    test.setTimeout(180_000)
    const reader = admitReader()
    const person = pubOf(RELAY_OWNER_SEC)
    const LEGACY_CONTENT = '{"wss://legacy.example/":{"read":true,"write":true}}'
    execFileSync(NAK, [
        'event', '--auth', '--sec', reader.hex, '-k', '3',
        '-c', LEGACY_CONTENT,
        '-t', `p=${BASE_A};;Alice`,
        '-t', `p=${BASE_B}`,
        ZOOID_WS,
    ])
    seedRelayList(reader, [ZOOID_URL])

    const before = relayFollowList(reader)
    expect(before?.tags, `the seeded columns never reached the relay (${wire(before)})`)
        .toEqual([['p', BASE_A, '', 'Alice'], ['p', BASE_B]])

    await openDirectory(page, reader)
    await openProfileCard(page, person)
    await expectFollowLabel(page, 'Folgen')

    await page.locator('[data-person-follow]').click()
    await expectFollowLabel(page, 'Entfolgen')

    const followed = relayFollowList(reader)
    logWire('after the follow', followed)
    expect(followed?.tags, `the base did not survive the follow (${wire(followed)})`)
        .toEqual([['p', person], ['p', BASE_A, '', 'Alice'], ['p', BASE_B]])
    expect(followed?.content, 'the legacy relay map in `content` was dropped by the write').toBe(LEGACY_CONTENT)

    // The label is NOT the barrier here — see {@link waitForNewWireList}. This unfollow
    // lands in the same second as the follow above, and the button then shows the state of
    // whichever event won the NIP-01 tie in the CLIENT, which is not the one the relay kept.
    await page.locator('[data-person-follow]').click()
    const unfollowed = await waitForNewWireList(reader, followed?.id ?? '')
    logWire('after the unfollow', unfollowed)
    expect(unfollowed?.tags, `the unfollow took more than the one entry (${wire(unfollowed)})`)
        .toEqual([['p', BASE_A, '', 'Alice'], ['p', BASE_B]])
    expect(unfollowed?.content, 'the legacy relay map in `content` was dropped by the unfollow').toBe(LEGACY_CONTENT)
    expect(unfollowed?.id, 'the unfollow signed nothing new').not.toBe(followed?.id)
})

/**
 * **The browser console over the whole follow flow — with the proof that it was listening.**
 *
 * A server-side test sees the rendered markup, never the browser that runs it: a torn
 * Alpine scope, a throw inside an `x-on:` handler, a rejected dynamic import — none of it
 * makes a Pest test red. The channel that does see it here is `page.on('pageerror')` plus
 * the filtered `console` listener wired in `support/fixtures.ts`.
 *
 * **`storage/logs/browser.log` is not that channel — but not for the reason this phase was
 * briefed with.** „Boost's `BrowserLogger` fails in E2E" is measurably false on this
 * machine: the positive control below reaches it. Measured 2026-09-15 over a full run —
 * the log took exactly the lines that were provoked on purpose:
 *
 *     [2026-09-15 06:41:25] local.ERROR: Uncaught Error: MASSEN-FOLGEN-KONSOLE-POSITIVKONTROLLE
 *     [2026-09-15 06:41:31] local.ERROR: Uncaught Error: FOLGEN-KONSOLE-POSITIVKONTROLLE
 *     [2026-09-15 06:42:42] local.ERROR: Uncaught Error: SELBSTTEST-page-error-guard
 *
 * …and not one `Failed to send logs:` in the whole run. What disqualifies the file is
 * something else: it is ONE append-only sink for every worker and every run (91.9 MB,
 * 326 890 lines on this machine), with no test attribution in a line — so it can say „the
 * run was quiet", never „THIS case was". For that, only the per-test listener works.
 *
 * The guard already fails every test in this suite on an unexpected page error, so „no
 * errors" is worth exactly as much as the proof that the listener was live in THIS run —
 * which is the second half below. Without it, a channel that had silently stopped
 * recording would look identical to a clean surface.
 */
test('the follow flow makes no console noise, and the channel that says so is live', async ({ page, pageErrorWaechter }) => {
    test.setTimeout(180_000)
    const reader = admitReader()
    const person = pubOf(RELAY_OWNER_SEC)
    seedFollowList(reader, [BASE_A, BASE_B])
    seedRelayList(reader, [ZOOID_URL])

    await openDirectory(page, reader)
    await openProfileCard(page, person)
    await expectFollowLabel(page, 'Folgen')
    await page.locator('[data-person-follow]').click()
    await expectFollowLabel(page, 'Entfolgen')
    // The other direction of the same handler, because one that only ever runs one way is
    // half measured. Awaited at the wire and not at the label, for the reason
    // {@link waitForNewWireList} carries.
    const afterFollow = relayFollowList(reader)
    await page.locator('[data-person-follow]').click()
    await waitForNewWireList(reader, afterFollow?.id ?? '')

    expect(
        pageErrorWaechter.gesehen().map((f) => `${f.quelle}: ${f.text}`),
        'the follow flow put something on the browser console',
    ).toEqual([])

    // ── The positive control, in the same run and on the same page ─────────────────
    // A `throw` inside a `setTimeout` is the mechanism Alpine itself uses to surface an
    // expression error (`normalErrorHandler` re-throws out of band), so this is the exact
    // path a broken `x-on:click` on the button above would take.
    await page.evaluate(() => {
        setTimeout(() => {
            throw new Error('FOLGEN-KONSOLE-POSITIVKONTROLLE')
        }, 0)
    })
    await expect
        .poll(
            () => pageErrorWaechter.gesehen().some((f) => f.quelle === 'pageerror' && f.text.includes('FOLGEN-KONSOLE-POSITIVKONTROLLE')),
            { timeout: 5_000, message: 'the console channel did not record a deliberately thrown error — it was not listening' },
        )
        .toBe(true)
})

/** Every throwaway reader this file let onto the relay is taken back out again. */
test.afterAll(() => releaseAdmittedReaders())
