import { test, expect, type Page } from './support/fixtures'
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { useZooid, ZOOID_PORT, ZOOID_WS } from './support/zooid'
import { loginNsec } from './support/login'
import { freshKeypair } from './support/keys'

/**
 * **P6 — hiding a person, and getting them back.** The plan-mandated E2E promises of the
 * phase (`docs/plans/2026-09-05T0125-community-features-herbst.md`, DoD lines P6 1, 2, 4).
 *
 * ── What is being proven, and where each half lives ─────────────────────────────
 *
 *  1. kind 10000 is **written** (checked at the relay with `nak`, not through the store)
 *     and **read at start** (a reload, which throws the whole island away, keeps the
 *     author hidden).
 *  2. A hidden author **disappears from the chat list** and **comes back** after being
 *     shown again — with a positive control next to it: a message by a DIFFERENT author
 *     in the same room must stay visible throughout. Without it, a broken chat list would
 *     pass this test.
 *  3. The management section in settings lists the person and is the way back — which is
 *     the only way back, since the profile card is reached through the chat row that is
 *     no longer there.
 *
 * The refusal on an unanswered read (DoD line P6 3) is **not** here on purpose: it is a
 * pure rule and lives in `packages/einundzwanzig-group/js/muteModels.test.ts`
 * (`DATA LOSS: without an answer from the relay there is NO event at all`), plus the
 * wiring latch in `muteWriteGate.test.ts`. Producing "the relay never sends EOSE" in a
 * browser needs a WebSocket proxy, and that proxy replaces `window.WebSocket` page-wide —
 * one prevention layer of `support/hermetik.ts` off, for a condition a `node --test` case
 * decides in a millisecond.
 *
 * ── zooid arm, and why that is enough ───────────────────────────────────────────
 *
 * The file is deliberately NOT named `buzz-…`, so `BUZZ_SPECS` in `playwright.config.ts`
 * leaves it out of the Buzz run and it fires only in the zooid arm. Kind 10000 is a
 * protocol-wide NIP-51 list with no relay dialect: Buzz names `KIND_MUTE_LIST` in its
 * ingest allowlist (`buzz-core/src/kind.rs:17` → `Scope::UsersWrite`), zooid has no kind
 * allowlist at all. Both store it; there is nothing relay-specific left to measure.
 *
 * ── Why a FRESH keypair, and never `NOSTR_TEST_NSEC` ────────────────────────────
 *
 * Kind 10000 is replaceable: one list per pubkey, every write replaces the whole thing.
 * Under the shared test identity a parallel spec would silently overwrite this one's list
 * — and, worse for this phase, the seeded messages of the `welcome` room are signed by
 * exactly that shared key. This test hides its author, so it must not BE its author.
 * `freshKeypair()` exists for this (`support/keys.ts`).
 *
 * The price is the admission dance: the test zooid is member-only
 * (`config-test-3555/test.toml`), so a brand-new pubkey can neither read the room nor
 * write its list until an admin lets it in per NIP-86 `allowpubkey` — same call the seed
 * script makes, same shape `bookmarks.spec.ts` and `directory.spec.ts` use.
 *
 * ── What it leaves behind ───────────────────────────────────────────────────────
 *
 * One kind-10000 event under a throwaway pubkey that is generated per run and never
 * reused, plus that pubkey on the relay's allow list. Both are replaceable/idempotent and
 * neither is a room, so the room-litter guard (`support/rooms.ts`) has nothing to collect.
 */

const NAK = process.env.NAK ?? `${process.env.HOME}/go/bin/nak`
/** Relay owner secret (pubkey = `relay.self`) — the zooid's only NIP-86 admin. */
const ADMIN_HEX = 'b2ee09a54bedf17ee1db562bdddd75c48661d981eb52c49dc206c55ba8439414'
const HTTP = `http://localhost:${ZOOID_PORT}/`

/**
 * The two seeded authors of the `welcome` room (`support/zooid-testserver.sh`), by the
 * message each of them wrote.
 *
 * `SEEDED_USER` is the throwaway test user, `SEEDED_ADMIN` the relay owner. Hiding the
 * first must leave the second standing — that is the positive control, and without it a
 * chat list that renders nothing at all would pass every assertion below.
 */
const MESSAGE_OF_HIDDEN = 'Willkommen im Space! 👋'
const MESSAGE_OF_OTHER = 'Schön, dass du da bist.'

/**
 * NIP-86 management call as ADMIN (NIP-98 HTTP auth), exactly as the seed script and
 * `bookmarks.spec.ts` do it. Copied rather than imported: the neighbours keep it private,
 * and a shared helper would be a fourth place that has to agree about the admin secret.
 */
function mgmt(body: string): void {
    const hash = createHash('sha256').update(body).digest('hex')
    const evt = execFileSync(NAK, [
        'event',
        '-k',
        '27235',
        '--sec',
        ADMIN_HEX,
        '-t',
        `u=${HTTP}`,
        '-t',
        'method=POST',
        '-t',
        `payload=${hash}`,
    ])
        .toString()
        .trim()
    const auth = Buffer.from(evt).toString('base64')
    execFileSync('curl', [
        '-s',
        '-X',
        'POST',
        HTTP,
        '-H',
        'Content-Type: application/nostr+json+rpc',
        '-H',
        `Authorization: Nostr ${auth}`,
        '-d',
        body,
    ])
}

const nak = (args: string[]): string => {
    const res = spawnSync(NAK, args, { encoding: 'utf8', timeout: 30_000 })

    return `${res.stdout ?? ''}\n${res.stderr ?? ''}`
}

/**
 * The `p` tags of this pubkey's kind-10000 AT THE RELAY — measured independently of the
 * client, not read out of the Alpine store.
 *
 * Necessary before the page is ever left: `page.reload()` tears down the WebSocket and
 * the in-memory repository. If the relay verdict has not come back by then, the fresh
 * page sees neither the cold-start cache nor the relay copy, and the test goes red for a
 * reason that has nothing to do with muting. Same lesson `bookmarks.spec.ts` records for
 * kind 10003.
 */
const mutedAtRelay = (pk: string, nsec: string): string[] => {
    const out = nak(['req', '--auth', '--sec', nsec, '-k', '10000', '-a', pk, '-l', '1', ZOOID_WS])
    for (const line of out.split('\n')) {
        if (!line.trim().startsWith('{') || !line.includes('"kind":10000')) {
            continue
        }
        const event = JSON.parse(line) as { tags?: string[][] }

        return (event.tags ?? []).filter((tag) => tag[0] === 'p' && tag[1]).map((tag) => tag[1] as string)
    }

    return []
}

/**
 * Open the profile card of the author of `message` and press the hide/show button.
 *
 * Inside one `toPass`, and the trigger is only clicked when the card is not already open
 * — same shape and same reason as `clickRowMenuItem` in `bookmarks.spec.ts`: a streamed
 * message or a late profile re-renders the row and takes the dialog with it.
 */
async function togglePersonFromRow(page: Page, message: string): Promise<void> {
    const button = page.locator('[data-person-mute]')
    await expect(async () => {
        if (!(await button.isVisible())) {
            const row = page.locator('div.chat-row', { hasText: message }).first()
            await row.getByRole('button', { name: 'Profil anzeigen' }).first().click()
        }
        await button.click({ timeout: 2_000 })
    }).toPass({ timeout: 20_000 })
}

/**
 * Wait until an element's height stops changing, then hand back control.
 *
 * "Two consecutive reads agree" and not "above a threshold": the Flux modal enters with a
 * scale transition, and a threshold is already satisfied part-way through it. Measured on
 * 2026-09-05: 30.95 px on the way to a settled 32.00 on a fine pointer, 42.05 on the way
 * to 44.00 on a coarse one. A geometry test that reads mid-animation records a number
 * nobody can reproduce — and, at 42 against a 44 rule, one that looks like a real defect.
 */
async function settleHeight(page: Page, selector: string): Promise<void> {
    let previous = -1
    await expect
        .poll(
            async () => {
                const height = Math.round(((await page.locator(selector).boundingBox())?.height ?? 0) * 100)
                const stable = height > 0 && height === previous
                previous = height

                return stable
            },
            { timeout: 15_000, intervals: [200], message: `${selector} never settled to a stable height` },
        )
        .toBe(true)
}

test('P6: a hidden author disappears from the chat list and comes back', async ({ page }) => {
    test.setTimeout(180_000)
    const user = freshKeypair()

    // Admission first: without it the fresh pubkey cannot even READ the room
    // (`public_read = false`), and the test would fail on an empty history.
    mgmt(`{"method":"allowpubkey","params":["${user.pk}"]}`)

    await useZooid(page)
    await loginNsec(page, user.nsec)

    await page.goto('/rooms/welcome')
    const hidden = page.getByText(MESSAGE_OF_HIDDEN)
    const other = page.getByText(MESSAGE_OF_OTHER)
    await expect(hidden.first()).toBeVisible({ timeout: 20_000 })
    // The positive control, taken BEFORE anything is hidden: both authors are on screen.
    await expect(other.first()).toBeVisible({ timeout: 20_000 })

    // ── Ausblenden ──────────────────────────────────────────────────────────
    await togglePersonFromRow(page, MESSAGE_OF_HIDDEN)

    // The row goes first — this is the whole promise of the phase.
    await expect.poll(() => hidden.count(), { timeout: 20_000 }).toBe(0)
    // …and the OTHER author is still there. Without this line an empty chat list would
    // satisfy the assertion above.
    await expect(other.first()).toBeVisible()

    // Written, and written where a foreign client can read it.
    await expect
        .poll(() => mutedAtRelay(user.pk, user.nsec), {
            timeout: 20_000,
            message: 'kind 10000 has not reached the relay — a reload now would prove nothing',
        })
        .toContain('2dbaf5f4f86a1eed0948852ad48fa40aae2e48d5e347a77fac2ac936d6c94e7b')

    // ── Read at start ───────────────────────────────────────────────────────
    //
    // A full reload throws away every bit of in-memory state — repository, Alpine store,
    // the whole island. What comes back has to come from the cold-start cache
    // (`PERSIST_KINDS`, which already carried MUTES) or from the relay.
    await page.reload()
    await expect(other.first()).toBeVisible({ timeout: 20_000 })
    await expect(hidden).toHaveCount(0)

    // ── The way back, through settings ──────────────────────────────────────
    //
    // Deliberately not through the chat row: that row is gone, which is exactly why the
    // management section exists.
    await page.goto('/settings')
    const section = page.locator('[data-settings-section="mutes"]')
    await expect(section).toBeVisible({ timeout: 20_000 })
    await expect(section.locator('[data-mute-remove]')).toHaveCount(1, { timeout: 20_000 })
    await section.locator('[data-mute-remove]').first().click()
    await expect
        .poll(() => mutedAtRelay(user.pk, user.nsec).length, { timeout: 20_000 })
        .toBe(0)

    await page.goto('/rooms/welcome')
    await expect(hidden.first()).toBeVisible({ timeout: 20_000 })
    await expect(other.first()).toBeVisible()
})

/**
 * The touch half of the layout measurement, in its own context because a pointer cannot
 * be switched on a live page.
 *
 * `hasTouch: true` is what makes Chromium answer `(pointer: coarse)`, and that is the
 * media query the house's `text-btn-touch` utility hangs on (`theme.css`: 44 px on a
 * coarse pointer, compact on a mouse — WCAG 2.5.5 / Apple HIG, against WCAG 2.5.8's
 * weaker 24 px). The test asserts the media state it depends on before it measures, so a
 * Playwright change that stops emulating the pointer makes this case fail loudly instead
 * of measuring the mouse geometry and calling it a touch target.
 */
test('P6 LAYOUT (touch): the hide action reaches 44 px on a coarse pointer at 375 px', async ({ browser, baseURL }) => {
    test.setTimeout(180_000)
    const user = freshKeypair()
    mgmt(`{"method":"allowpubkey","params":["${user.pk}"]}`)

    const context = await browser.newContext({ baseURL, viewport: { width: 375, height: 900 }, hasTouch: true })
    try {
        const page = await context.newPage()
        await useZooid(page)
        await loginNsec(page, user.nsec)
        await page.goto('/rooms/welcome')
        await expect(page.getByText(MESSAGE_OF_HIDDEN).first()).toBeVisible({ timeout: 20_000 })

        const coarse = await page.evaluate(() => window.matchMedia('(pointer: coarse)').matches)
        expect(coarse, 'the context does not report a coarse pointer — the rule under test never applies here').toBe(true)

        const row = page.locator('div.chat-row', { hasText: MESSAGE_OF_HIDDEN }).first()
        await expect(async () => {
            if (!(await page.locator('[data-person-mute]').isVisible())) {
                await row.getByRole('button', { name: 'Profil anzeigen' }).first().click()
            }
            await expect(page.locator('[data-person-mute]')).toBeVisible({ timeout: 2_000 })
        }).toPass({ timeout: 20_000 })

        // Settled, not read once: the Flux modal enters with a scale transition, and a
        // single read lands mid-animation. Measured on 2026-09-05 during the enter:
        // 42.05 px, i.e. 0.956 × the settled 44.00 — close enough to 44 to look like a
        // real miss and to produce an hour of hunting for a CSS cause that is not there.
        await settleHeight(page, '[data-person-mute]')
        const box = await page.locator('[data-person-mute]').boundingBox()
        expect(box, 'the hide action has no geometry').not.toBeNull()
        const b = box as { x: number; y: number; width: number; height: number }
        // Logged, not only asserted: a run has to CARRY its numbers. A measurement that
        // lives in a comment is a claim about a past run, and the next reader has to
        // patch the spec to see what it already reads. Same shape as
        // `buzz-mobile-erreichbarkeit-breite.spec.ts`.
        console.log(
            `[person-mute] hide action, coarse pointer, 375px: `
                + `x=${b.x.toFixed(1)} y=${b.y.toFixed(1)} ${b.width.toFixed(1)}×${b.height.toFixed(2)}px`,
        )
        expect(
            b.height,
            `the hide action is only ${Math.round(b.height)}px high on a coarse pointer`,
        ).toBeGreaterThanOrEqual(44)
    } finally {
        await context.close()
    }
})

test('P6 LAYOUT: the hide action and the management list at 375 px and 1280 px — real numbers', async ({ page }) => {
    // „Sichtbare UI ist erst fertig, wenn sie GEMESSEN wurde" (Nutzeransage 2026-09-03):
    // real geometry at two widths, not a CSS-class assertion and a glanced-at screenshot.
    test.setTimeout(180_000)
    const user = freshKeypair()
    mgmt(`{"method":"allowpubkey","params":["${user.pk}"]}`)

    await useZooid(page)
    await loginNsec(page, user.nsec)

    for (const width of [375, 1280]) {
        await page.setViewportSize({ width, height: 900 })
        await page.goto('/rooms/welcome')
        await expect(page.getByText(MESSAGE_OF_HIDDEN).first()).toBeVisible({ timeout: 20_000 })

        // ── The action on the profile card ──────────────────────────────────
        const row = page.locator('div.chat-row', { hasText: MESSAGE_OF_HIDDEN }).first()
        await expect(async () => {
            if (!(await page.locator('[data-person-mute]').isVisible())) {
                await row.getByRole('button', { name: 'Profil anzeigen' }).first().click()
            }
            await expect(page.locator('[data-person-mute]')).toBeVisible({ timeout: 2_000 })
        }).toPass({ timeout: 20_000 })

        // Settled first — the modal enters with a scale transition, so a single read
        // measures a shrunken control. "Two consecutive reads agree" rather than a
        // threshold: a threshold is satisfied MID-animation (measured: 30.95 px on the way
        // to 32.00), which is how a geometry test records a number nobody can reproduce.
        await settleHeight(page, '[data-person-mute]')
        const box = await page.locator('[data-person-mute]').boundingBox()
        expect(box, `${width}px: the hide action has no geometry`).not.toBeNull()
        const b = box as { x: number; y: number; width: number; height: number }
        expect(b.x, `${width}px: the action starts off-screen to the left (${Math.round(b.x)}px)`).toBeGreaterThanOrEqual(0)
        expect(
            b.x + b.width,
            `${width}px: the action ends at ${Math.round(b.x + b.width)}px, outside the ${width}px viewport`,
        ).toBeLessThanOrEqual(width + 1)
        // The MOUSE geometry, and the number is deliberately not 44: `text-btn-touch`
        // lifts the height only on a coarse pointer, so demanding 44 here would demand
        // the opposite of the house rule. The coarse case is the test above.
        // Measured 2026-09-05, settled: 336.0 × 32.00 px at both widths.
        expect(b.height, `${width}px: the action is only ${Math.round(b.height)}px high`).toBeGreaterThanOrEqual(24)

        const docWidth = await page.evaluate(() => document.documentElement.scrollWidth)
        console.log(
            `[person-mute] hide action, mouse, ${width}px: `
                + `x=${b.x.toFixed(1)} y=${b.y.toFixed(1)} ${b.width.toFixed(1)}×${b.height.toFixed(2)}px `
                + `documentScrollWidth=${docWidth}`,
        )
        expect(docWidth, `${width}px: horizontal document overflow (${docWidth}px)`).toBeLessThanOrEqual(width + 1)

        await page.keyboard.press('Escape')

        // ── The management section ──────────────────────────────────────────
        await page.goto('/settings')
        const section = page.locator('[data-settings-section="mutes"]')
        await expect(section).toBeVisible({ timeout: 20_000 })
        const sbox = await section.boundingBox()
        expect(sbox, `${width}px: the mutes section has no geometry`).not.toBeNull()
        const s = sbox as { x: number; width: number }
        expect(s.x, `${width}px: the section starts off-screen to the left`).toBeGreaterThanOrEqual(0)
        expect(
            s.x + s.width,
            `${width}px: the section ends at ${Math.round(s.x + s.width)}px, outside the ${width}px viewport`,
        ).toBeLessThanOrEqual(width + 1)

        const settingsWidth = await page.evaluate(() => document.documentElement.scrollWidth)
        console.log(
            `[person-mute] mutes settings section, ${width}px: `
                + `x=${s.x.toFixed(1)} ${s.width.toFixed(1)}px wide, documentScrollWidth=${settingsWidth}`,
        )
        expect(settingsWidth, `${width}px: horizontal overflow on /settings (${settingsWidth}px)`).toBeLessThanOrEqual(width + 1)
    }
})
