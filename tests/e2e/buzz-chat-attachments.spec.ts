import { test, expect, type Page } from './support/fixtures'
import { spawnSync } from 'node:child_process'
import { loginNsec } from './support/login'
import { BUZZ_PORT, BUZZ_ROOM_GENERAL, BUZZ_URL, BUZZ_USER_NSEC, BUZZ_USER_PUB, useBuzz } from './support/buzz'

/**
 * **P5 — chat attachments beyond images, against a real Buzz relay.**
 *
 * Until this phase the composer's file field carried `accept="image/*"`; a PDF could not
 * even be picked. The transport underneath was never image-specific, so what this spec
 * has to hold is not "can it upload" but three things a unit test cannot answer:
 *
 *  1. Buzz ACCEPTS the two file kinds through the two branches of `PUT /upload` that are
 *     not the image branch — the generic file path and the video path.
 *  2. The published kind-9 carries an `imeta` Buzz did not reject: `url`, `m`, `x`,
 *     `size` are mandatory and `verify_imeta_blobs` compares MIME and size against the
 *     stored sidecar (`buzz/crates/buzz-relay/src/handlers/imeta.rs`). A wrong value here
 *     loses the MESSAGE, not the attachment.
 *  3. The history renders them as a file card and a player, and the blob behind both is
 *     auth-gated on Buzz — so the hydrator has to fill `href` and `src` from a signed
 *     fetch, which it could not do before this phase (its selector was `img[…]`).
 *
 * ── Why the MP4 is a base64 constant and not built by ffmpeg ───────────────────
 *
 * Because WHICH MP4 is the point. Buzz walks the box tree of every video and refuses any
 * `meta`, `ilst`, `uuid`, `©xyz`, `chap` … box — measured 2026-09-05: a straight
 * `ffmpeg -c:v libx264 -c:a aac` file came back **HTTP 422 `media contains metadata or a
 * non-canonical metadata channel`**, and only the same encode with `-map_metadata -1
 * -fflags +bitexact -flags:v +bitexact` was taken (HTTP 200). A spec that shells out to
 * ffmpeg would depend on the version and flags of whatever ffmpeg the machine has, and
 * the day one of them starts writing a `udta` again the failure would look like a
 * regression in this client.
 *
 * The constant below is exactly the accepted file, 1610 bytes, produced with:
 *   ffmpeg -f lavfi -i color=c=blue:s=16x16:d=0.2 -c:v libx264 -pix_fmt yuv420p -r 5 \
 *          -map_metadata -1 -fflags +bitexact -flags:v +bitexact -movflags +faststart out.mp4
 *
 * ── Room choice ───────────────────────────────────────────────────────────────
 *
 * Writes go to GENERAL, never to WELCOME: `buzz-testserver.sh` caps the welcome room at
 * ten messages and tears the whole stack down when it is exceeded.
 */

const NAK = process.env.NAK ?? `${process.env.HOME}/go/bin/nak`
const WS = (): string => `ws://localhost:${BUZZ_PORT}`

/** A minimal but structurally valid PDF — `%PDF-` is what Buzz's sniffer keys on. */
const PDF = Buffer.from(
    `%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n` +
        `2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n` +
        `3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n`,
    'utf8',
)

/** See the module header: the exact bytes Buzz's video validator accepts. */
const MP4 = Buffer.from(
    'AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAM4bW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAAlgAAQAA' +
    'AQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
    'AAAAAgAAAod0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAAlgAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAA' +
    'AAAAAAABAAAAAAAAAAAAAAAAAABAAAAAABAAAAAQAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAAJYAAAQAAABAAAAAAH/' +
    'bWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAAAoAAAAGABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRl' +
    'b0hhbmRsZXIAAAABqm1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAA' +
    'AQAAAWpzdGJsAAAAvnN0c2QAAAAAAAAAAQAAAK5hdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAABAAEABIAAAASAAAAAAA' +
    'AAABDExhdmMgbGlieDI2NAAAAAAAAAAAAAAAAAAAAAAAAAAAGP//AAAANGF2Y0MBZAAK/+EAF2dkAAqs2V7ARAAAAwAEAAAD' +
    'ACg8SJZYAQAGaOvjyyLA/fj4AAAAABBwYXNwAAAAAQAAAAEAAAAUYnRydAAAAAAAACZwAAAAAAAAABhzdHRzAAAAAAAAAAEA' +
    'AAADAAAIAAAAABRzdHNzAAAAAAAAAAEAAAABAAAAKGN0dHMAAAAAAAAAAwAAAAEAABAAAAAAAQAAGAAAAAABAAAIAAAAABxz' +
    'dHNjAAAAAAAAAAEAAAABAAAAAwAAAAEAAAAgc3RzegAAAAAAAAAAAAAAAwAAAsoAAAAMAAAADAAAABRzdGNvAAAAAAAAAAEA' +
    'AANoAAAAPXVkdGEAAAA1bWV0YQAAAAAAAAAhaGRscgAAAAAAAAAAbWRpcmFwcGwAAAAAAAAAAAAAAAAIaWxzdAAAAAhmcmVl' +
    'AAAC6m1kYXQAAAKtBgX//6ncRem95tlIt5Ys2CDZI+7veDI2NCAtIGNvcmUgMTY1IHIzMjIyIGIzNTYwNWEgLSBILjI2NC9N' +
    'UEVHLTQgQVZDIGNvZGVjIC0gQ29weWxlZnQgMjAwMy0yMDI1IC0gaHR0cDovL3d3dy52aWRlb2xhbi5vcmcveDI2NC5odG1s' +
    'IC0gb3B0aW9uczogY2FiYWM9MSByZWY9MyBkZWJsb2NrPTE6MDowIGFuYWx5c2U9MHgzOjB4MTEzIG1lPWhleCBzdWJtZT03' +
    'IHBzeT0xIHBzeV9yZD0xLjAwOjAuMDAgbWl4ZWRfcmVmPTEgbWVfcmFuZ2U9MTYgY2hyb21hX21lPTEgdHJlbGxpcz0xIDh4' +
    'OGRjdD0xIGNxbT0wIGRlYWR6b25lPTIxLDExIGZhc3RfcHNraXA9MSBjaHJvbWFfcXBfb2Zmc2V0PS0yIHRocmVhZHM9MSBs' +
    'b29rYWhlYWRfdGhyZWFkcz0xIHNsaWNlZF90aHJlYWRzPTAgbnI9MCBkZWNpbWF0ZT0xIGludGVybGFjZWQ9MCBibHVyYXlf' +
    'Y29tcGF0PTAgY29uc3RyYWluZWRfaW50cmE9MCBiZnJhbWVzPTMgYl9weXJhbWlkPTIgYl9hZGFwdD0xIGJfYmlhcz0wIGRp' +
    'cmVjdD0xIHdlaWdodGI9MSBvcGVuX2dvcD0wIHdlaWdodHA9MiBrZXlpbnQ9MjUwIGtleWludF9taW49NSBzY2VuZWN1dD00' +
    'MCBpbnRyYV9yZWZyZXNoPTAgcmNfbG9va2FoZWFkPTQwIHJjPWNyZiBtYnRyZWU9MSBjcmY9MjMuMCBxY29tcD0wLjYwIHFw' +
    'bWluPTAgcXBtYXg9NjkgcXBzdGVwPTQgaXBfcmF0aW89MS40MCBhcT0xOjEuMDAAgAAAABVliIQAEf/+5+P8Cm18xHE6dhj6' +
    '9/EAAAAIQZoibEP//uAAAAAIAZ5BeQ//s4E=',
    'base64',
)

type RelayEvent = { id: string; pubkey: string; kind: number; content: string; tags: string[][]; created_at: number }

/** kind-9 of the test user in GENERAL, newest first. */
function messages(): RelayEvent[] {
    const res = spawnSync(
        NAK,
        ['req', '-k', '9', '-t', `h=${BUZZ_ROOM_GENERAL}`, '-a', BUZZ_USER_PUB, '--auth', '--sec', BUZZ_USER_NSEC, WS()],
        { encoding: 'utf8', timeout: 30_000 },
    )

    return (res.stdout ?? '')
        .trim()
        .split('\n')
        .filter(Boolean)
        .flatMap((line) => {
            try {
                return [JSON.parse(line) as RelayEvent]
            } catch {
                return []
            }
        })
        .sort((a, b) => b.created_at - a.created_at)
}

/** Fields of an `imeta` tag as a map — `key value` per entry (NIP-92). */
const imetaOf = (event: RelayEvent): Map<string, string> => {
    const tag = event.tags.find((t) => t[0] === 'imeta') ?? []
    const fields = new Map<string, string>()
    for (const entry of tag.slice(1)) {
        const at = entry.indexOf(' ')
        if (at > 0) {
            fields.set(entry.slice(0, at), entry.slice(at + 1))
        }
    }

    return fields
}

/**
 * Poll the relay for OUR message carrying `marker` in its body.
 *
 * A requery and not the `OK` of the publish: `nak` prints the signed event on a
 * rejection too and exits 0, and the browser's own toast would be just as unreliable a
 * witness. Only fetching the event back separates "sent" from "stored".
 */
async function awaitMessage(marker: string): Promise<RelayEvent> {
    const deadline = Date.now() + 30_000
    for (;;) {
        const hit = messages().find((event) => event.content.includes(marker))
        if (hit) {
            return hit
        }
        expect(Date.now(), `no kind-9 carrying "${marker}" arrived within 30 s`).toBeLessThan(deadline)
        await new Promise((resolve) => setTimeout(resolve, 500))
    }
}

/**
 * Workspace on the test relay, logged in, standing in the GENERAL room.
 *
 * **`__nostrWorkspace` is set to the Buzz relay on purpose**, overriding the `''` that
 * `useBuzz` writes. On a Buzz space the relay IS the workspace in production, and that is
 * what makes its `/media/` blobs auth-gated for `mediaGuard`. With an empty workspace the
 * guard would wave the raw url through, the card would get a plain `href` — and the two
 * hydration assertions below would be measuring a configuration nobody runs.
 *
 * **The join button is awaited with `waitFor`, not probed with `isVisible`.** Playwright
 * ignores the timeout on `isVisible()` and answers immediately (documented); on a freshly
 * built stack the 39002 read is not through at that instant, the probe says "no button",
 * the click never happens and the composer stays hidden. Measured here on 2026-09-05:
 * three tests red with a visible-but-hidden textarea, all three green with `waitFor`.
 * `buzz-room.spec.ts` carries the same note for the same reason.
 */
async function openRoom(page: Page): Promise<void> {
    await useBuzz(page)
    await page.addInitScript((url) => {
        ;(window as unknown as { __nostrWorkspace: string }).__nostrWorkspace = url
    }, BUZZ_URL)
    await loginNsec(page, BUZZ_USER_NSEC)
    await page.goto(`/rooms/${BUZZ_ROOM_GENERAL}`)
    const join = page.getByRole('button', { name: 'Beitreten' })
    const joined = await join
        .waitFor({ state: 'visible', timeout: 15_000 })
        .then(() => true)
        .catch(() => false)
    if (joined) {
        await join.click()
    }
    await expect(page.getByPlaceholder('Nachricht schreiben…')).toBeVisible({ timeout: 25_000 })
}

/** The composer's hidden file field — anchored on `x-ref`, it no longer carries `accept`. */
const fileField = (page: Page) => page.locator('input[type="file"][x-ref="imageInput"]').first()

/** Attach one file, wait for the upload to finish, then send it with `marker` as the text. */
async function attachAndSend(page: Page, file: { name: string; mimeType: string; buffer: Buffer }, marker: string): Promise<void> {
    await fileField(page).setInputFiles(file)
    // The preview row appears only after the upload returned a descriptor — it is fed
    // from `buildAttachment`, so its presence IS the proof the server took the bytes.
    await expect(page.locator('[data-composer="room"]')).toBeVisible({ timeout: 30_000 })
    await page.getByPlaceholder('Nachricht schreiben…').fill(marker)
    await page.getByRole('button', { name: 'Senden' }).click()
}

/**
 * Width, height and right edge of an element at 1280 px and at 375 px — real numbers,
 * not a class assertion.
 *
 * The house rule behind it: visible UI is not finished until it has been measured at a
 * narrow and a wide viewport. Both cases below therefore end here, and the assertion is
 * the one that actually hurts — the element must stay inside the viewport. A chat row is
 * inside a scroller, so an over-wide attachment does not visibly burst the page; it
 * quietly turns the whole conversation into a horizontally scrolling one.
 */
async function measureAtBothWidths(page: Page, locator: ReturnType<Page['locator']>, label: string): Promise<void> {
    for (const width of [1280, 375]) {
        await page.setViewportSize({ width, height: 900 })
        await expect(locator).toBeVisible()
        const box = await locator.boundingBox()
        expect(box, `${label} has a box at ${width} px`).not.toBeNull()
        const { x, y, width: w, height: h } = box as { x: number; y: number; width: number; height: number }
        console.log(`[p5] ${label} @${width}: x=${x} y=${y} w=${w} h=${h} right=${x + w}`)
        expect(x, `${label} starts inside the viewport at ${width} px`).toBeGreaterThanOrEqual(0)
        expect(x + w, `${label} ends inside the viewport at ${width} px`).toBeLessThanOrEqual(width)
        expect(h, `${label} is not collapsed at ${width} px`).toBeGreaterThan(0)
    }
}

/*
 * **Every case below opens with the Buzz-mode guard, and the file name is not enough.**
 * `BUZZ_SPECS` in `playwright.config.ts` is applied as `testMatch` only when
 * `E2E_RELAY=buzz`; the zooid arm collects EVERY spec, this one included. Measured on
 * 2026-09-05: without the guard all four cases ran against zooid in `npm run test:e2e`
 * and failed there — a red that says nothing about this feature. The runtime `test.skip`
 * is the same switch the other twenty Buzz cases use.
 */
test('P5/1: a PDF goes into the room and is rendered as a file card', async ({ page }) => {
    test.skip(process.env.E2E_RELAY !== 'buzz', 'only in Buzz mode (E2E_RELAY=buzz)')
    await openRoom(page)
    const marker = `p5-pdf-${Date.now()}`
    await attachAndSend(page, { name: 'Vereinsprotokoll.pdf', mimeType: 'application/pdf', buffer: PDF }, marker)

    // 1. The relay stored it, and the imeta says what Buzz's file path answered.
    const event = await awaitMessage(marker)
    const imeta = imetaOf(event)
    expect(imeta.get('m'), 'imeta m of a PDF').toBe('application/pdf')
    expect(imeta.get('filename'), 'the original file name travels in the imeta').toBe('Vereinsprotokoll.pdf')
    expect(imeta.get('url') ?? '', 'Buzz only accepts a local /media/ url').toContain(`localhost:${BUZZ_PORT}/media/`)
    expect(Number(imeta.get('size'))).toBe(PDF.length)

    // 2. The history shows a file card with that name — not a 100-character url.
    const card = page.locator('.chat-file', { hasText: 'Vereinsprotokoll.pdf' }).first()
    await expect(card).toBeVisible({ timeout: 25_000 })
    await expect(card.locator('.chat-file-meta')).toHaveText(/PDF/)

    // 3. The blob is auth-gated on Buzz, so the card starts WITHOUT an address and the
    //    hydrator fills it from a signed fetch. Both halves are asserted: the marker
    //    attribute proves the guard refused the raw url, the final `href` proves the
    //    hydrator now reaches an `<a>` at all (its selector was `img[…]` before P5).
    await expect(card).toHaveAttribute('data-blossom-src', /\/media\//)
    await expect(card).toHaveAttribute('data-blossom-state', 'ready', { timeout: 25_000 })
    await expect(card).toHaveAttribute('href', /^blob:/)

    // 4. And it fits — measured, at both widths.
    await measureAtBothWidths(page, card, 'file card')
})

test('P5/2: an MP4 goes into the room and is rendered as a player', async ({ page }) => {
    test.skip(process.env.E2E_RELAY !== 'buzz', 'only in Buzz mode (E2E_RELAY=buzz)')
    await openRoom(page)
    const marker = `p5-mp4-${Date.now()}`
    await attachAndSend(page, { name: 'clip.mp4', mimeType: 'video/mp4', buffer: MP4 }, marker)

    const event = await awaitMessage(marker)
    const imeta = imetaOf(event)
    expect(imeta.get('m'), 'imeta m of the video').toBe('video/mp4')
    // `dim` comes from Buzz's video pipeline, not from the browser — its presence is the
    // proof the bytes went down the VIDEO branch and not the generic file branch.
    expect(imeta.get('dim'), 'Buzz reports the frame size of a video it accepted').toBe('16x16')

    const video = page.locator('video.chat-video').first()
    await expect(video).toBeVisible({ timeout: 25_000 })
    await expect(video).toHaveAttribute('data-blossom-state', 'ready', { timeout: 25_000 })
    await expect(video).toHaveAttribute('src', /^blob:/)

    await measureAtBothWidths(page, video, 'video')
})

test('P5/3: the composer states what this relay accepts, and it fits at 375 px and 1280 px', async ({ page }) => {
    test.skip(process.env.E2E_RELAY !== 'buzz', 'only in Buzz mode (E2E_RELAY=buzz)')
    await openRoom(page)
    await page.setViewportSize({ width: 375, height: 800 })
    const note = page.locator('[data-attachment-note="room"]')
    await expect(note).toBeVisible({ timeout: 25_000 })
    // The BUZZ sentence, not the Blossom one — the room lives on the Buzz relay, so the
    // next upload goes there. Getting the other sentence here would mean the surface
    // describes a server it will not talk to.
    await expect(note).toHaveText(/MP4/)
    await expect(note).toHaveText(/Audio/)

    const box = async () => {
        const el = await note.boundingBox()
        expect(el, 'the note has a box').not.toBeNull()

        return el as { x: number; y: number; width: number; height: number }
    }

    const schmal = await box()
    const composer = await page.getByPlaceholder('Nachricht schreiben…').boundingBox()
    expect(composer, 'the composer has a box').not.toBeNull()
    // Real numbers, not a class assertion: the note must sit inside the viewport and
    // above the input, and it must not push the input off the screen.
    expect(schmal.x).toBeGreaterThanOrEqual(0)
    expect(schmal.x + schmal.width).toBeLessThanOrEqual(375)
    expect(schmal.y + schmal.height).toBeLessThanOrEqual((composer as { y: number }).y + 1)
    // eslint-disable-next-line no-console
    console.log(`[p5] note @375: x=${schmal.x} w=${schmal.width} h=${schmal.height} bottom=${schmal.y + schmal.height}`)

    await page.setViewportSize({ width: 1280, height: 900 })
    await expect(note).toBeVisible()
    const breit = await box()
    expect(breit.x).toBeGreaterThanOrEqual(0)
    expect(breit.x + breit.width).toBeLessThanOrEqual(1280)
    expect(breit.height).toBeGreaterThan(0)
    console.log(`[p5] note @1280: x=${breit.x} w=${breit.width} h=${breit.height}`)
})

test('P5/4: an audio file is refused before the upload, in words', async ({ page }) => {
    test.skip(process.env.E2E_RELAY !== 'buzz', 'only in Buzz mode (E2E_RELAY=buzz)')
    await openRoom(page)

    // Buzz refuses `audio/*` unconditionally — measured HTTP 415
    // `{"error":"disallowed content type: audio/mpeg"}`, and the refusal is compiled in
    // (`buzz-media/src/validation.rs:200-206`), not configuration. The pre-check turns
    // that status code into a sentence BEFORE any bytes leave the browser, so the file
    // content here is irrelevant: what is under test is the MIME the picker reports.
    await fileField(page).setInputFiles({ name: 'sprachnachricht.mp3', mimeType: 'audio/mpeg', buffer: Buffer.from('not really audio', 'utf8') })

    await expect(page.getByText('Dieser Relay nimmt keine Audiodateien an — auch keine Sprachnachrichten.')).toBeVisible({
        timeout: 20_000,
    })
    // And nothing is waiting to be sent: a refusal that still left an attachment behind
    // would put the user one Enter away from a message pointing at a blob that is not there.
    await expect(page.locator('[data-composer="room"]')).toBeHidden()
})
