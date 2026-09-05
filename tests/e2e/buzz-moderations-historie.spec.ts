import { test, expect, type Page } from './support/fixtures'
import { useBuzz, BUZZ_OWNER_NSEC, BUZZ_OWNER_SEC_HEX, BUZZ_USER_NSEC, BUZZ_PORT } from './support/buzz'
import { waitForAction } from './support/buzz-moderation'
import { loginNsec } from './support/login'
import { spawnSync } from 'node:child_process'
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'

const NAK = process.env.NAK ?? `${process.env.HOME}/go/bin/nak`
const WS = (): string => `ws://localhost:${BUZZ_PORT}`

const nak = (args: string[]): string => {
    const res = spawnSync(NAK, args, { encoding: 'utf8', timeout: 30_000 })

    return `${res.stdout ?? ''}\n${res.stderr ?? ''}`
}

/**
 * A throwaway key WITH relay membership (kind 9030) — same mechanism and same reason as in
 * `buzz-timeout.spec.ts`: this test SUSPENDS somebody, and a suspension on the shared test
 * user would stay in `community_bans` and take the write permission away from every spec
 * that runs afterwards.
 */
const freshRelayMember = (): string => {
    const pub = getPublicKey(generateSecretKey())
    expect(
        nak(['event', '--auth', '--sec', BUZZ_OWNER_SEC_HEX, '-k', '9030', '-t', `p=${pub}`, '-t', 'role=member', WS()]),
        'relay membership for the throwaway key could not be set',
    ).toContain('success')

    return pub
}

/**
 * P1 (community features autumn) — **the moderation history: `GET /moderation/audit`,
 * fetched by the client and grouped by day inside the dialog.**
 *
 * ── What is proven here, and with what ──────────────────────────────────────
 *
 * 1. The **client** calls the route — not just the probe. What is measured is the
 *    browser's own response (`page.on('response')`), not a DOM state that could just as
 *    well come out of a cache. Until this phase the only caller in the whole repository
 *    was `tests/e2e/support/buzz-moderation.ts`.
 * 2. A carried-out measure is **readable**: 9042/9043 are executed by the relay and
 *    neither stored nor fanned out (`nak req -k 9042` finds nothing by construction), so
 *    the audit row is the only record. Two commands → two rows under ONE day heading;
 *    that is the grouping, not merely its existence.
 * 3. **Without moderation rights: 403, and the surface stays empty** — no error state, no
 *    toast. The status code is measured along with it, because otherwise "nothing to see"
 *    would also be green when nothing was ever fetched.
 * 4. **Geometry at 375 px and 1280 px** — real numbers (width/height/position/overflow),
 *    not a class assertion.
 *
 * Runs ONLY with `E2E_RELAY=buzz` (isolated buzz-test stack); zooid does not have this
 * route, and the client does not ask for it there either (`spaceIsBuzzAsync` in front).
 *
 * The strings this spec looks for are the German interface of the product under test, not
 * prose of its own — they are quoted, not translated.
 */
test.describe('Moderation history (E2E, E2E_RELAY=buzz only)', () => {
    test.skip(process.env.E2E_RELAY !== 'buzz', 'only relevant in buzz mode (E2E_RELAY=buzz)')

    test.beforeEach(async ({ page }) => {
        await useBuzz(page)
    })

    /** The status codes the browser was answered with on `/moderation/audit`. */
    const auditStatuses = (page: Page): number[] => {
        const seen: number[] = []
        page.on('response', (res) => {
            if (res.url().includes('/moderation/audit')) {
                seen.push(res.status())
            }
        })

        return seen
    }

    test('moderator: two measures under one day heading — measured at 375 and 1280 px', async ({ page }) => {
        test.setTimeout(180_000)

        const victim = freshRelayMember()
        const reason = `E2E-Historie-${Math.floor(Math.random() * 1e9)}`
        const statuses = auditStatuses(page)

        // ── Produce two audit rows: suspend (9042) and lift it again (9043). Through
        // `nak` and not through the interface — the subject under test is the READING.
        // Buzz accepts moderation commands only within ±120 s, so the `expiration` is
        // computed here and not earlier.
        const expiration = Math.floor(Date.now() / 1000) + 3600
        nak([
            'event', '--auth', '--sec', BUZZ_OWNER_SEC_HEX, '-k', '9042',
            '-t', `p=${victim}`, '-t', `expiration=${expiration}`, '-t', `reason=${reason}`, WS(),
        ])
        // A requery instead of trusting the `nak` output: it prints the signed event on a
        // rejection too, and exits 0.
        await waitForAction('timeout', victim)
        nak(['event', '--auth', '--sec', BUZZ_OWNER_SEC_HEX, '-k', '9043', '-t', `p=${victim}`, WS()])
        await waitForAction('untimeout', victim)

        await loginNsec(page, BUZZ_OWNER_NSEC)
        await page.goto('/directory')
        await expect(page.locator('[x-data="nostrDirectory"]')).toBeVisible({ timeout: 20_000 })

        await page.getByRole('button', { name: /Meldungen/ }).click()
        const modal = page.locator('dialog[data-modal="action-items"]')
        await expect(modal).toBeVisible({ timeout: 10_000 })

        const history = modal.locator('[x-data="nostrModerationAudit"]')
        await expect(history.getByText('Moderations-Verlauf')).toBeVisible({ timeout: 20_000 })

        // ── 1. The client really did ask the route, and it answered.
        expect(statuses, 'the client did not fetch `/moderation/audit`').toContain(200)

        // ── 2. Two measures, ONE day heading.
        await expect(history.getByText('Heute', { exact: true })).toHaveCount(1)
        const suspended = history.locator('.surface-card', { hasText: reason })
        await expect(suspended).toHaveCount(1, { timeout: 20_000 })
        await expect(suspended.getByText('Befristet gesperrt')).toBeVisible()
        await expect(history.getByText('Sperre aufgehoben')).toBeVisible()

        // ── 3. Geometry, at both widths.
        const report: string[] = []
        for (const width of [375, 1280]) {
            await page.setViewportSize({ width, height: 800 })
            // Wait one frame, otherwise the layout is measured BEFORE the reflow.
            await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))))

            const doc = await page.evaluate(() => ({
                scrollWidth: document.documentElement.scrollWidth,
                clientWidth: document.documentElement.clientWidth,
            }))
            const dialog = await modal.evaluate((el) => ({
                scrollWidth: el.scrollWidth,
                clientWidth: el.clientWidth,
                right: el.getBoundingClientRect().right,
            }))
            const box = (await history.boundingBox()) as { x: number; y: number; width: number; height: number }
            const rowBox = (await suspended.boundingBox()) as { x: number; y: number; width: number; height: number }

            report.push(
                `${width}px | document scrollWidth=${doc.scrollWidth} clientWidth=${doc.clientWidth}`
                    + ` | dialog scrollWidth=${dialog.scrollWidth} clientWidth=${dialog.clientWidth} right=${Math.round(dialog.right)}`
                    + ` | history x=${Math.round(box.x)} y=${Math.round(box.y)} ${Math.round(box.width)}×${Math.round(box.height)}`
                    + ` | row x=${Math.round(rowBox.x)} ${Math.round(rowBox.width)}×${Math.round(rowBox.height)}`,
            )

            expect(doc.scrollWidth, `${width}px: the document overflows horizontally`).toBeLessThanOrEqual(doc.clientWidth)
            expect(dialog.scrollWidth, `${width}px: the dialog overflows horizontally`).toBeLessThanOrEqual(dialog.clientWidth)
            expect(box.width, `${width}px: the history has no width`).toBeGreaterThan(0)
            expect(box.height, `${width}px: the history has no height`).toBeGreaterThan(0)
            expect(
                Math.round(rowBox.x + rowBox.width),
                `${width}px: a history row sticks out of the dialog on the right`,
            ).toBeLessThanOrEqual(Math.round(dialog.right) + 1)
        }
        console.log(`\n[moderation-history] geometry\n${report.join('\n')}`)
    })

    test('without moderation rights: 403, no history, no error state', async ({ page }) => {
        test.setTimeout(120_000)

        const statuses = auditStatuses(page)

        await loginNsec(page, BUZZ_USER_NSEC)
        await page.goto('/directory')
        await expect(page.locator('[x-data="nostrDirectory"]')).toBeVisible({ timeout: 20_000 })

        // The trigger sits behind `x-show="isAdmin"` — a non-moderator cannot reach the
        // dialog at all. The island is mounted regardless (the dialog is in the DOM), so
        // its load path is driven directly: what is to be measured is what the client
        // DOES with a 403, not whether it sees the button.
        const outcome = await page.evaluate(async () => {
            const el = document.querySelector('[x-data="nostrModerationAudit"]')
            if (!el) {
                return { mounted: false, days: -1, toasts: -1, text: '' }
            }
            let toasts = 0
            const count = (): void => {
                toasts += 1
            }
            document.addEventListener('toast-show', count)
            const alpine = (window as unknown as { Alpine: { $data: (e: Element) => Record<string, unknown> } }).Alpine
            const data = alpine.$data(el) as { days: unknown[]; load: () => Promise<void> }
            await data.load()
            document.removeEventListener('toast-show', count)

            return { mounted: true, days: data.days.length, toasts, text: (el as HTMLElement).innerText.trim() }
        })

        expect(outcome.mounted, 'the history island is not mounted at all').toBe(true)
        expect(statuses, 'the client did not fetch `/moderation/audit`').toContain(403)
        expect(statuses, 'a 403 must not trigger a retry storm').toHaveLength(1)
        expect(outcome.days, 'no history may come into existence without moderation rights').toBe(0)
        expect(outcome.toasts, 'a 403 is an answer — it must not raise an error toast').toBe(0)
        expect(outcome.text, 'the surface shows text although there is nothing to show').toBe('')
        console.log(`\n[moderation-history] 403: status=${statuses.join(',')} days=${outcome.days} toasts=${outcome.toasts}`)
    })
})
