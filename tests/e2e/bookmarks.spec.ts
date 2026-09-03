import { test, expect, type Locator, type Page } from './support/fixtures'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { useZooid, ZOOID_PORT } from './support/zooid'
import { loginNsec } from './support/login'
import { freshKeypair } from './support/keys'

/**
 * **P2 — a bookmark survives a reload.** The one plan-mandated E2E promise of the phase
 * (`docs/plans/2026-09-03T1915-buzz-kind-ernte.md`, DoD line P2).
 *
 * ── THIS SPEC HAS NEVER RUN. CALIBRATE IT ON ITS FIRST RUN. ─────────────────────────
 *
 * Written on 2026-09-03 under an explicit instruction not to execute Playwright; the
 * runs of this plan are collected and driven once at the end over all phases. So this
 * file is, right now, **an unverified claim** — every selector, every timeout and the
 * whole admission sequence below are read off neighbouring specs, not measured.
 *
 * Whoever fires the collective run does two things before believing a green result:
 *
 *  1. **Make it red on purpose, once.** Removing `data-bookmark-remove="entry"` from
 *     `⚡bookmarks.blade.php` is not enough — that is a unit-level guard. Mutate the
 *     *product*: drop `BOOKMARKS` from `PERSIST_KINDS` (`js/storage.ts`) and the reload
 *     assertion must fall; or comment out the `publishOptimistic` call in
 *     `js/bookmarks.ts` and the first assertion must fall. A spec nobody has seen fail
 *     is not known to be a guard.
 *  2. **Read the skip count.** If this file reports `skipped` rather than `passed`, the
 *     admission below did not take and the whole thing measured nothing.
 *
 * ── Why a FRESH keypair, and never `NOSTR_TEST_NSEC` ────────────────────────────────
 *
 * Kind 10003 is replaceable: one list per pubkey, every write replaces the whole thing.
 * Under the shared test identity any parallel spec that also wrote a bookmark would
 * silently overwrite this one's list, and the failure would land on whichever test lost
 * the race. That is structurally the incident of 2026-08-21, where a replaceable kind 0
 * published under the shared identity took down 14 unrelated tests. `freshKeypair()`
 * exists for exactly this (`support/keys.ts`, added in P1).
 *
 * The price is the admission dance: the test zooid is member-only
 * (`config-test-3555/test.toml`: `public_read = false`, `public_write = false`,
 * `public_join = false`), so a brand-new pubkey can neither read the room nor write its
 * list until an admin lets it in per NIP-86 `allowpubkey`. Same call the seed script
 * makes, same shape `directory.spec.ts` uses at runtime.
 *
 * ── What it leaves behind ───────────────────────────────────────────────────────────
 *
 * One kind-10003 event under a throwaway pubkey that is generated per run and never
 * reused, plus that pubkey on the relay's allow list. Both are replaceable/idempotent
 * and neither is a room, so the room-litter guard (`support/rooms.ts`) has nothing to
 * collect here.
 */

const NAK = process.env.NAK ?? `${process.env.HOME}/go/bin/nak`
/** Relay owner secret (pubkey = `relay.self`) — the zooid's only NIP-86 admin. */
const ADMIN_HEX = 'b2ee09a54bedf17ee1db562bdddd75c48661d981eb52c49dc206c55ba8439414'
const HTTP = `http://localhost:${ZOOID_PORT}/`

/** A seeded message of the `welcome` room — the thing that gets bookmarked. */
const MESSAGE = 'Willkommen im Space! 👋'

/**
 * NIP-86 management call as ADMIN (NIP-98 HTTP auth), exactly as the seed script and
 * `directory.spec.ts` do it. Copied rather than imported: `directory.spec.ts` keeps it
 * private, and a shared helper would be a fourth place that has to agree about the
 * admin secret.
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

/**
 * Open the `…` menu of a row and click one entry — REPEATABLE.
 *
 * Same shape and same reason as `clickRowMenuItem` in `room.spec.ts`, where it is
 * private: the menu lives inside `<template x-if="!isMobile">`, and Alpine destroys and
 * rebuilds `x-if` content on every re-evaluation. A streamed message or a late profile
 * re-renders the row and takes an already-open dropdown with it. Opening and clicking
 * therefore sit INSIDE one `toPass`, and the trigger is only clicked when the menu is
 * not already open — a dropdown toggles, so a retry that clicks blindly closes the menu
 * it just opened.
 */
async function clickRowMenuItem(page: Page, row: Locator, name: string | RegExp): Promise<void> {
    const item = page.getByRole('menuitem', { name })
    await expect(async () => {
        if (!(await item.isVisible())) {
            await row.hover()
            await row.getByRole('button', { name: 'Weitere Aktionen' }).click()
        }
        await item.click({ timeout: 2_000 })
    }).toPass({ timeout: 20_000 })
}

test('P2: ein Lesezeichen überlebt einen Reload (frisches Keypair)', async ({ page }) => {
    const user = freshKeypair()

    // Admission first: without it the fresh pubkey cannot even READ the room
    // (`public_read = false`), and the test would fail on an empty history for a reason
    // that has nothing to do with bookmarks.
    mgmt(`{"method":"allowpubkey","params":["${user.pk}"]}`)

    await useZooid(page)
    await loginNsec(page, user.nsec)

    // ── Merken ──────────────────────────────────────────────────────────────────────
    await page.goto('/rooms/welcome')
    const row = page.locator('div.group', { hasText: MESSAGE })
    await expect(row.first()).toBeVisible({ timeout: 15_000 })
    await clickRowMenuItem(page, row.first(), 'Merken')

    // ── Auf der Fläche sichtbar ─────────────────────────────────────────────────────
    //
    // `expect.poll` and never `waitForTimeout` (house rule, pattern from
    // `read-state-sync.spec.ts:303-311`): the write goes out optimistically, the relay
    // verdict follows, and the confirmation re-read follows that. A fixed sleep would
    // either be a flake or an unnecessarily slow test.
    await page.goto('/bookmarks')
    const entry = page.getByText(MESSAGE)
    await expect
        .poll(() => entry.count(), { timeout: 20_000 })
        .toBeGreaterThan(0)

    // ── Der eigentliche Beweis: der Reload ──────────────────────────────────────────
    //
    // A full reload throws away every bit of in-memory state — the welshman repository,
    // the Alpine store, the whole island. What comes back has to come from the cold
    // start cache (`PERSIST_KINDS`, which is why 10003 is in it) or from the relay. If
    // the write never left the browser, this is where it shows.
    await page.reload()
    await expect
        .poll(() => entry.count(), { timeout: 20_000 })
        .toBeGreaterThan(0)

    // Und die Gegenprobe zur Zusage selbst: der Leerzustand darf NICHT dastehen. Ohne
    // sie wäre der Test auch auf einer Fläche grün, die den Text irgendwo sonst rendert.
    await expect(page.getByText('Noch nichts gemerkt.')).toHaveCount(0)
})
