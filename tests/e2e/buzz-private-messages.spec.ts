import { test, expect, type Page } from './support/fixtures'
import { useBuzz, BUZZ_PORT, BUZZ_USER_NSEC, BUZZ_USER_PUB, BUZZ_OWNER_SEC_HEX } from './support/buzz'
import { loginNsec } from './support/login'
import { spawnSync } from 'node:child_process'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { nip44 } from 'nostr-tools'
import { WRAP, hash, prep } from '@welshman/util'
import { buildGiftWrap } from '../../packages/einundzwanzig-group/js/giftWrap.ts'

/**
 * A minimal NIP-01 signer for the two test keys.
 *
 * Hand-rolled rather than `Nip01Signer` from `@welshman/signer`, and the reason is
 * resolution and not taste: `@welshman/signer` lives in the PACKAGE's `node_modules`, so
 * a bare import from `tests/e2e/` does not resolve (the package's own modules do resolve
 * it — they are one directory further in). This is the same class over `nostr-tools`,
 * which the suite already depends on.
 */
const makeSigner = (secretHex: string) => {
    const secret = Uint8Array.from(Buffer.from(secretHex, 'hex'))
    const pubkey = getPublicKey(secret)
    const key = (theirs: string) => nip44.v2.utils.getConversationKey(secret, theirs)

    return {
        getPubkey: async () => pubkey,
        sign: async (event: Record<string, unknown>) =>
            finalizeEvent({ ...event, pubkey } as never, secret) as never,
        nip04: {
            encrypt: async (_p: string, m: string) => m,
            decrypt: async (_p: string, m: string) => m,
        },
        nip44: {
            encrypt: async (theirs: string, message: string) => nip44.v2.encrypt(message, key(theirs)),
            decrypt: async (theirs: string, message: string) => nip44.v2.decrypt(message, key(theirs)),
        },
    }
}

const randomSecretHex = (): string => Buffer.from(generateSecretKey()).toString('hex')

/**
 * P7 — **NIP-17 private messages** at the real surface, against a real Buzz relay.
 *
 * ══ Why this file has to exist next to the unit cases ═════════════════════════════
 *
 * The rules are decided without a browser (`privateMessageModels.test.ts`,
 * `giftWrap.test.ts`, `wrapOrigin.test.ts`, `wrapSignerCost.test.ts` — 82 cases). What
 * none of them can answer is whether a relay in production takes the envelope and hands
 * it back. Three things are only true if a real relay says so:
 *
 *  1. a wrap with `created_at: now()` is accepted AND findable again (Buzz refuses
 *     anything more than 900 s from its own clock, and welshman's own `getWrap` backdates
 *     by up to 1e5 s — that is the reason `js/giftWrap.ts` exists);
 *  2. a wrap the client did NOT ask for never reaches the signer, while one it did ask
 *     for is decrypted and rendered;
 *  3. the surface has real measurements at 375 px and 1280 px.
 *
 * ══ Two mechanics that decide the cut ════════════════════════════════════════════
 *
 * 1. **The file name.** `playwright.config.ts` filters the Buzz mode to
 *    `/(?:buzz-.*|pin-room|relay-guard|relay-praevention)\.spec\.ts$/` and skips
 *    everything else SILENTLY. The zooid arm collects every spec, so the `test.skip`
 *    below is what keeps these cases out of it — and it is not decoration: kind 10050 is
 *    accepted on zooid and refused on Buzz, so half the assertions here are about the
 *    Buzz answer specifically.
 * 2. **The viewport.** In Buzz mode only the `chromium` project runs, pinned to 1279 px.
 *    This surface has no rail dependency, so the cases set their own viewport where the
 *    measurement needs one.
 *
 * ══ What the run leaves behind ═══════════════════════════════════════════════════
 *
 * Gift wraps, permanently — one per seeded message and one per sent message. They are
 * kind 1059 with no `h` tag, so they do not touch the channel counters the stack guard
 * watches (`buzz-testserver.sh` counts kind 9 in `welcome` and kind 39000 overall).
 * They are unreadable to anybody but the two test keys.
 */

const NAK = process.env.NAK ?? `${process.env.HOME}/go/bin/nak`
const WS = (): string => `ws://localhost:${BUZZ_PORT}`
const OWNER_PUB = getPublicKey(Uint8Array.from(Buffer.from(BUZZ_OWNER_SEC_HEX, 'hex')))
const now = (): number => Math.round(Date.now() / 1000)

const nak = (args: string[]): string => {
    const res = spawnSync(NAK, args, { encoding: 'utf8', timeout: 30_000 })

    return `${res.stdout ?? ''}\n${res.stderr ?? ''}`
}

/**
 * Publish a pre-signed event over a NIP-42 authenticated connection, then report the
 * `OK` frame verbatim.
 *
 * `nak event` cannot do this: a gift wrap is signed by a THROWAWAY key while the
 * connection has to be authenticated as a relay member, and `nak` signs both with the
 * same secret. Buzz explicitly waives the pubkey/auth match for kind 1059
 * (`ingest.rs:2023-2028`) — this helper is what exercises that waiver.
 *
 * The AUTH round runs to completion before anything else is sent. Without that the first
 * EVENT races the challenge and comes back `auth-required`, which looks exactly like a
 * policy rejection and is not one (measured while writing the P7 probes).
 */
const publishSigned = (event: unknown, memberSecretHex: string): Promise<[boolean, string]> =>
    new Promise((resolve, reject) => {
        const url = WS()
        const signer = makeSigner(memberSecretHex)
        const ws = new WebSocket(url)
        const id = (event as { id: string }).id
        const timer = setTimeout(() => {
            ws.close()
            reject(new Error('publishSigned: no OK within 20 s'))
        }, 20_000)
        ws.addEventListener('message', (frame) => {
            const message = JSON.parse(String((frame as MessageEvent).data)) as unknown[]
            if (message[0] === 'AUTH' && typeof message[1] === 'string') {
                void signer
                    .sign({
                        kind: 22242,
                        created_at: now(),
                        content: '',
                        tags: [
                            ['relay', url],
                            ['challenge', message[1]],
                        ],
                    })
                    .then((auth: unknown) => {
                        ws.send(JSON.stringify(['AUTH', auth]))
                        ws.send(JSON.stringify(['EVENT', event]))
                    })
            }
            if (message[0] === 'OK' && message[1] === id) {
                clearTimeout(timer)
                ws.close()
                resolve([message[2] === true, String(message[3] ?? '')])
            }
        })
        ws.addEventListener('error', () => {
            clearTimeout(timer)
            reject(new Error('publishSigned: socket error'))
        })
    })

/** A NIP-17 message from the seed owner to the test user, wrapped the way the client does. */
const seedMessage = async (text: string): Promise<{ id: string; ok: boolean; detail: string }> => {
    const sender = makeSigner(BUZZ_OWNER_SEC_HEX)
    const rumor = prep(
        { kind: 14, content: text, tags: [['p', BUZZ_USER_PUB]], created_at: now() } as never,
        OWNER_PUB,
    )
    const wrap = (await buildGiftWrap({
        sender,
        recipient: BUZZ_USER_PUB,
        template: rumor as never,
        now: now(),
    })) as { id: string }
    const [ok, detail] = await publishSigned(wrap, BUZZ_OWNER_SEC_HEX)

    return { id: wrap.id, ok, detail }
}

const openMessages = async (page: Page): Promise<void> => {
    await useBuzz(page)
    await loginNsec(page, BUZZ_USER_NSEC)
    await page.goto('/messages')
}

/**
 * Go to `/messages` again in a context that is ALREADY signed in.
 *
 * `loginNsec` starts at `/nostr-login`, and that route redirects a signed-in visitor to
 * `/spaces` — the login button it then waits for never appears. The layout case walks two
 * viewports in one context and hit exactly that on the first run of this file.
 */
const reopenMessages = async (page: Page): Promise<void> => {
    await page.goto('/messages')
}

test.describe('Buzz: NIP-17 private messages (E2E, E2E_RELAY=buzz only)', () => {
    test.skip(process.env.E2E_RELAY !== 'buzz', 'only relevant in Buzz mode (E2E_RELAY=buzz)')

    test('a wrap with created_at: now() is accepted, and an out-of-window one is not', async () => {
        // The measurement `js/giftWrap.ts` was built against, repeated inside the suite so
        // it keeps being true. Both halves matter: without the rejected control the green
        // could simply mean the relay takes everything.
        const good = await seedMessage(`p7 accepted ${Date.now()}`)
        expect(good.ok, `the relay refused a current wrap: ${good.detail}`).toBe(true)

        const wrapper = makeSigner(randomSecretHex())
        const stale = (await wrapper.sign(
            hash({
                kind: WRAP,
                pubkey: await wrapper.getPubkey(),
                content: await wrapper.nip44.encrypt(BUZZ_USER_PUB, '{}'),
                // 3600 s back: outside the measured MAX_TIMESTAMP_DRIFT_SECS = 900, and
                // well INSIDE what welshman's own `getWrap` produces (up to 1e5 s).
                created_at: now() - 3600,
                tags: [['p', BUZZ_USER_PUB]],
            }),
        )) as { id: string }
        const [ok, detail] = await publishSigned(stale, BUZZ_OWNER_SEC_HEX)
        expect(ok, 'a wrap an hour in the past was accepted — the timestamp gate is gone').toBe(false)
        expect(detail).toContain('timestamp')

        // The only thing that tells acceptance from rejection: ask again — and ask as
        // the RECIPIENT. Buzz answers a kind-1059 request whose `#p` is not the
        // authenticated pubkey with `CLOSED: restricted: p-gated events require #p
        // matching your pubkey`; asking with the sender's key returned that instead of
        // the wrap on the first run of this file, and the empty answer looked exactly
        // like a rejected write.
        const back = nak(['req', '-k', '1059', '-t', `p=${BUZZ_USER_PUB}`, '--auth', '--sec', BUZZ_USER_NSEC, WS()])
        expect(back, 'the accepted wrap is not findable — the OK was a lie').toContain(good.id)
        expect(back, 'the rejected wrap IS findable — the reject was a lie').not.toContain(stale.id)
    })

    test('a seeded message is decrypted and shown, and its plaintext never went over the wire', async ({ page }) => {
        const secret = `p7-secret-${Date.now()}`
        const seeded = await seedMessage(secret)
        expect(seeded.ok, `seeding failed: ${seeded.detail}`).toBe(true)

        // Every frame the browser exchanged with the relay — the independent measuring
        // device for the claim "the relay never saw the text".
        const frames: string[] = []
        page.on('websocket', (ws) => {
            ws.on('framesent', (frame: { payload: string | Buffer }) => frames.push(String(frame.payload)))
            ws.on('framereceived', (frame: { payload: string | Buffer }) => frames.push(String(frame.payload)))
        })

        await openMessages(page)

        const row = page.locator('[data-pm-zeile]').filter({ hasText: secret })
        await expect(row, 'the seeded message never appeared — the wrap was not unwrapped').toBeVisible({
            timeout: 45_000,
        })

        // THE assurance of the phase, measured rather than asserted about the code: the
        // relay carried the ciphertext, never the words.
        const wire = frames.join('\n')
        expect(wire.length, 'no frames were captured — the check below would be vacuous').toBeGreaterThan(1000)
        expect(wire, 'the plaintext of a private message went over the wire').not.toContain(secret)
        expect(wire, 'no gift wrap was on the wire at all — this case measured nothing').toContain('1059')
    })

    test('sending writes a real 1059 that the recipient can requery', async ({ page }) => {
        const secret = `p7-sent-${Date.now()}`
        // Seed first so a conversation with the owner exists; opening one from the picker
        // depends on the space directory, which is a different promise.
        expect((await seedMessage(`p7 opener ${Date.now()}`)).ok).toBe(true)

        await openMessages(page)
        await page.locator('[data-pm-zeile]').first().click()
        const input = page.locator('[data-pm-eingabe] input, input[data-pm-eingabe]').first()
        await expect(input).toBeVisible({ timeout: 30_000 })
        await input.fill(secret)
        await page.locator('[data-pm-senden]').first().click()

        await expect(
            page.locator('[data-pm-nachricht]').filter({ hasText: secret }),
            'the sent message did not appear in its own conversation',
        ).toBeVisible({ timeout: 30_000 })

        // The independent device: the OWNER asks the relay for their own wraps. A message
        // that only shows locally has not been sent.
        await expect
            .poll(
                () =>
                    nak(['req', '-k', '1059', '-t', `p=${OWNER_PUB}`, '--auth', '--sec', BUZZ_OWNER_SEC_HEX, WS()])
                        .split('\n')
                        .filter((line) => line.includes('"kind":1059')).length,
                { message: 'the recipient has no wrap at all', timeout: 30_000 },
            )
            .toBeGreaterThan(0)

        // And the ciphertext really is ciphertext: the owner's own copy must not carry
        // the words. (Decrypting it here would need the owner's key inside the browser.)
        const ownerWraps = nak([
            'req',
            '-k',
            '1059',
            '-t',
            `p=${OWNER_PUB}`,
            '--auth',
            '--sec',
            BUZZ_OWNER_SEC_HEX,
            WS(),
        ])
        expect(ownerWraps, 'the message text is readable in the stored event').not.toContain(secret)
    })

    test('the surface is measured at 375 px and at 1280 px', async ({ page }) => {
        expect((await seedMessage(`p7 layout ${Date.now()}`)).ok).toBe(true)

        let first = true
        for (const width of [375, 1280]) {
            await page.setViewportSize({ width, height: 900 })
            if (first) {
                await openMessages(page)
                first = false
            } else {
                await reopenMessages(page)
            }
            await expect(page.locator('[data-pm-zeile]').first()).toBeVisible({ timeout: 45_000 })

            const measured = await page.evaluate(() => {
                const box = (selector: string) => {
                    const element = document.querySelector(selector)
                    if (!element) {
                        return null
                    }
                    const rect = element.getBoundingClientRect()

                    return {
                        w: Math.round(rect.width),
                        h: Math.round(rect.height),
                        left: Math.round(rect.left),
                        right: Math.round(rect.right),
                    }
                }

                return {
                    viewport: window.innerWidth,
                    docScrollWidth: document.documentElement.scrollWidth,
                    zusage: box('[data-pm-zusage]'),
                    relays: box('[data-pm-relays]'),
                    liste: box('[data-pm-liste]'),
                    zeile: box('[data-pm-zeile]'),
                }
            })

            // Logged by the RUN, not written into a comment: a number in a comment is a
            // claim about a past build, a number in the output is this build.
            console.log(`[p7-layout ${width}px] ${JSON.stringify(measured)}`)

            expect(measured.zusage, 'the privacy statement is missing at this width').not.toBeNull()
            expect(measured.relays, 'the delivery-address section is missing at this width').not.toBeNull()
            expect(measured.zeile, 'the conversation row is missing at this width').not.toBeNull()
            // No horizontal overflow: the row must not push the document wider than the
            // viewport. `<= viewport` and not `=== viewport` — a scrollbar-less viewport
            // reports exactly, one with a gutter reports less.
            expect(measured.docScrollWidth, 'the page scrolls sideways at this width').toBeLessThanOrEqual(
                measured.viewport,
            )
            expect(measured.zeile!.right, 'the conversation row runs past the right edge').toBeLessThanOrEqual(
                measured.viewport,
            )
            expect(measured.zeile!.h, 'the conversation row collapsed').toBeGreaterThanOrEqual(44)
        }
    })

    test('Buzz refuses kind 10050, and the surface says so instead of offering a dead button', async ({ page }) => {
        // Measured with kind 10000 as the positive control (`p7-messung-c-kind10050.txt`):
        // Buzz has no constant for 10050 and answers `restricted: unknown event kind`.
        // `mayWriteKind` therefore refuses it before signing, and the surface has to
        // explain that rather than showing a button that cannot work.
        await openMessages(page)

        await expect(page.locator('[data-pm-relay-refused]')).toBeVisible({ timeout: 45_000 })
        await expect(page.locator('[data-pm-relay-publish]')).toHaveCount(0)
    })
})
