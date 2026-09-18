import { test, expect, type Locator, type Page } from './support/fixtures'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { useZooid, ZOOID_PORT, ZOOID_WS } from './support/zooid'
import { loginNsec } from './support/login'
import { testKeys } from './support/keys'
import { cleanupRooms, trackRoom } from './support/rooms'
// The wire fixtures of the follow tests — shared with `follow.spec.ts` and
// `follow-bulk.spec.ts` since P6, so that the throwaway readers, the seeded contact lists
// and the silent relay have ONE definition rather than three that can drift apart.
import {
    admitReader,
    releaseAdmittedReaders,
    seedFollowList,
    seedRelayList,
    startSilentRelay,
} from './support/followWire'

const NSEC = process.env.NOSTR_TEST_NSEC as string
// Relay-Owner-Secret (Pubkey = relay.self) — der einzige NIP-86-Admin des zooid.
const ADMIN_HEX = 'b2ee09a54bedf17ee1db562bdddd75c48661d981eb52c49dc206c55ba8439414'
const NAK = process.env.NAK ?? `${process.env.HOME}/go/bin/nak`
const HTTP = `http://localhost:${ZOOID_PORT}/`

/** NIP-86-Management-Call als ADMIN (NIP-98 HTTP-Auth), wie das Seed-Skript. */
function mgmt(body: string): void {
    const hash = createHash('sha256').update(body).digest('hex')
    const evt = execFileSync(NAK, ['event', '-k', '27235', '--sec', ADMIN_HEX, '-t', `u=${HTTP}`, '-t', 'method=POST', '-t', `payload=${hash}`])
        .toString()
        .trim()
    const auth = Buffer.from(evt).toString('base64')
    execFileSync('curl', ['-s', '-X', 'POST', HTTP, '-H', 'Content-Type: application/nostr+json+rpc', '-H', `Authorization: Nostr ${auth}`, '-d', body])
}

/** Der aktuelle NIP-11-`name` des Test-Relays (frischer HTTP-GET, kein Cache). */
function relayName(): string {
    const info = execFileSync('curl', ['-s', '-H', 'Accept: application/nostr+json', HTTP]).toString()
    return (JSON.parse(info).name as string) ?? ''
}

/** Loggt mit einem Secret ein und öffnet das Directory des fixierten Space. */
async function openDirectoryAs(page: Page, secret: string): Promise<void> {
    await useZooid(page)
    await loginNsec(page, secret)
    await page.goto('/bereich/leute')
}

/** Standard: als Wegwerf-Test-User (kein Admin). */
const openDirectory = (page: Page): Promise<void> => openDirectoryAs(page, NSEC)

/**
 * M3 (Directory, Fix A) — Mitglieder + Rollen des fixierten Space erscheinen
 * OHNE „keine Mitglieder"-Flackern: der relay-signierte Filter wartet auf
 * `relay.self` (NIP-11), bis dahin Skeleton. Rollen-Badges tragen die
 * HSL-Farbe aus 33534; die Client-Suche filtert über Name + npub.
 */
test('M3: Directory zeigt Members + Rollen, ohne Flackern', async ({ page }) => {
    await openDirectory(page)

    // Beide geseedeten Mitglieder (mit kind-0-Namen) — auf das Member-Grid gescopt:
    // „Alice Test" kann auch in der Beitritts-Queue (P4b) auftauchen (offene 9021 für
    // einen closed-Raum), dann wäre ein seitenweites getByText mehrdeutig.
    await expect(page.locator('.list-stagger').getByText('Relay Admin')).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('.list-stagger').getByText('Alice Test')).toBeVisible()

    // Rollen-Badges aus 33534 (exakt — „Mitglied" ≠ Überschrift „Mitglieder").
    // Auf das sichtbare Member-Grid begrenzt: dieselben Labels stehen auch in den
    // (versteckten) Admin-Modals. `.first()`, weil mehrere Mitglieder dasselbe
    // Badge tragen können (Test-User + Entwickler-npub sind beide „Mitglied").
    const grid = page.locator('.list-stagger')
    await expect(grid.getByText('Moderator', { exact: true }).first()).toBeVisible()
    await expect(grid.getByText('Mitglied', { exact: true }).first()).toBeVisible()

    // Fix A: der „leere" Zustand darf nie erscheinen (self war vor dem Filter da)
    await expect(page.getByText('Noch keine Mitglieder')).toBeHidden()
})

test('M3: Client-Suche filtert die Mitglieder', async ({ page }) => {
    await openDirectory(page)
    await expect(page.locator('.list-stagger').getByText('Relay Admin')).toBeVisible({ timeout: 15_000 })

    const search = page.getByPlaceholder('Mitglied suchen…')
    const grid = page.locator('.list-stagger')

    // Treffer eingrenzen (auf das Member-Grid gescopt, s.o.)
    await search.fill('alice')
    await expect(grid.getByText('Alice Test')).toBeVisible()
    await expect(grid.getByText('Relay Admin')).toBeHidden()

    // Kein Treffer
    await search.fill('zzzzzz')
    await expect(page.getByText(/Kein Mitglied passt/)).toBeVisible()

    // Zurücksetzen zeigt wieder alle
    await search.fill('')
    await expect(grid.getByText('Relay Admin')).toBeVisible()
    await expect(grid.getByText('Alice Test')).toBeVisible()
})

test('M3: Directory überlebt Reload ohne Flackern', async ({ page }) => {
    await openDirectory(page)
    await expect(page.locator('.list-stagger').getByText('Relay Admin')).toBeVisible({ timeout: 15_000 })

    await page.reload()

    await expect(page.locator('.list-stagger').getByText('Relay Admin')).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('.list-stagger').getByText('Moderator', { exact: true })).toBeVisible()
    await expect(page.getByText('Noch keine Mitglieder')).toBeHidden()
})

/**
 * M6 (Admin, NIP-86) — der Relay-Owner (self) wird über `supportedmethods`
 * (HTTP + NIP-98, im Browser signiert) als Admin erkannt und sieht die
 * Verwaltungstools; die Rollen-Liste zeigt die geseedeten Rollen.
 */
test('M6: Relay-Owner sieht die NIP-86-Verwaltungstools', async ({ page }) => {
    await openDirectoryAs(page, ADMIN_HEX)
    await expect(page.locator('.list-stagger').getByText('Relay Admin')).toBeVisible({ timeout: 15_000 })

    await expect(page.getByRole('button', { name: 'Rollen verwalten' })).toBeVisible({ timeout: 15_000 })
    // P4 (buzz-kind-ernte): der Bann-Reiter heisst seit der Timeout-Nacharbeit „Gesperrt" —
    // die Liste dahinter zeigt seither Timeouts statt Banns (⚡directory.blade.php:75/338).
    await expect(page.getByRole('button', { name: 'Gesperrt' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Einladen' })).toBeVisible()

    // Rollen-Liste öffnet und zeigt die geseedeten 33534-Rollen
    await page.getByRole('button', { name: 'Rollen verwalten' }).click()
    await expect(page.getByRole('dialog').getByText('Moderator', { exact: true }).first()).toBeVisible()
})

/** M6 — ein normaler User sieht KEINE Verwaltungstools (Gating). */
test('M6: normaler User sieht keine Verwaltungstools', async ({ page }) => {
    await openDirectory(page)
    await expect(page.locator('.list-stagger').getByText('Relay Admin')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('button', { name: 'Rollen verwalten' })).toBeHidden()
})

/**
 * P2 (Space-Metadaten, NIP-86 changerelay*) — der Admin sieht den „Space"-Editor
 * in der Verwaltungsleiste, das Namensfeld ist aus dem NIP-11 vorbelegt.
 */
test('P2: Admin sieht den Space-Editor mit vorbelegtem Namen', async ({ page }) => {
    await openDirectoryAs(page, ADMIN_HEX)
    await expect(page.locator('.list-stagger').getByText('Relay Admin')).toBeVisible({ timeout: 15_000 })

    await page.getByRole('button', { name: 'Space', exact: true }).click()
    const modal = page.locator('dialog[data-modal="space-edit"]')
    await expect(modal.getByText('Space bearbeiten')).toBeVisible()
    // Vorbelegt aus dem NIP-11-Info-Doc (name="Zooid Test Space").
    await expect(modal.getByPlaceholder('Space-Name')).toHaveValue('Zooid Test Space')
})

/** P2 — ein normaler User sieht den Space-Editor NICHT (Gating). */
test('P2: normaler User sieht keinen Space-Editor', async ({ page }) => {
    await openDirectory(page)
    await expect(page.locator('.list-stagger').getByText('Relay Admin')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('button', { name: 'Space', exact: true })).toBeHidden()
})

/**
 * P2 — der Admin ändert den Space-Namen; setRelayName (changerelayname) schreibt
 * ihn relay-seitig (NIP-11). Round-Trip mit finally-Restore, weil spaces.spec den
 * Original-Namen „Zooid Test Space" asserted (geteilte Worker-zooid-Instanz).
 */
test('P2: Admin ändert den Space-Namen (changerelayname)', async ({ page }) => {
    const ORIG = 'Zooid Test Space'
    const marker = `Space-${Math.floor(Math.random() * 1e9)}`
    try {
        await openDirectoryAs(page, ADMIN_HEX)
        await expect(page.locator('.list-stagger').getByText('Relay Admin')).toBeVisible({ timeout: 15_000 })

        await page.getByRole('button', { name: 'Space', exact: true }).click()
        const modal = page.locator('dialog[data-modal="space-edit"]')
        const nameInput = modal.getByPlaceholder('Space-Name')
        await expect(nameInput).toHaveValue(ORIG)
        await nameInput.fill(marker)
        await modal.getByRole('button', { name: 'Speichern' }).click()

        // Relay-NIP-11 trägt den neuen Namen (zooid SetName), Modal schließt.
        await expect.poll(() => relayName(), { timeout: 15_000 }).toBe(marker)
        await expect(modal).toBeHidden()
    } finally {
        // Immer zurücksetzen — auch bei Fehler (spaces.spec erwartet den Originalnamen).
        mgmt(`{"method":"changerelayname","params":[${JSON.stringify(ORIG)}]}`)
    }
})

/**
 * P2 (Regression, ultracode-Finding) — Öffnen + direkt Speichern OHNE Eingabe darf
 * die Relay-Metadaten NICHT anfassen: saveSpace vergleicht gegen den Prefill-Snapshot
 * (_spaceInitial), also wird ein unverändertes (oder aus noch nicht geladenem Profil
 * leeres) Feld nie gesendet → kein Whitespace-No-op, kein Namens-Wipe.
 */
test('P2: No-op-Save lässt den Space-Namen unverändert', async ({ page }) => {
    const ORIG = 'Zooid Test Space'
    try {
        await openDirectoryAs(page, ADMIN_HEX)
        await expect(page.locator('.list-stagger').getByText('Relay Admin')).toBeVisible({ timeout: 15_000 })

        await page.getByRole('button', { name: 'Space', exact: true }).click()
        const modal = page.locator('dialog[data-modal="space-edit"]')
        await expect(modal.getByPlaceholder('Space-Name')).toHaveValue(ORIG)
        await modal.getByRole('button', { name: 'Speichern' }).click()
        await expect(modal).toBeHidden()

        // Kurz warten, dann prüfen: der Name ist unangetastet (kein stray changerelayname).
        await page.waitForTimeout(1000)
        expect(relayName()).toBe(ORIG)
    } finally {
        mgmt(`{"method":"changerelayname","params":[${JSON.stringify(ORIG)}]}`)
    }
})

// ── P3: Melde-Queue (NIP-56 kind 1984) ──────────────────────────────────────
const DUMMY_EVENT_ID = 'a'.repeat(64)
// Wegwerf-„gemeldete Autoren" — foreign zu allen echten Mitgliedern. Der Ban-Test
// bannt seinen eigenen (REPORT_BAN_TARGET), damit kein echtes Mitglied getroffen wird.
const REPORT_TARGET = '3333333333333333333333333333333333333333333333333333333333333333'
const REPORT_BAN_TARGET = '4444444444444444444444444444444444444444444444444444444444444444'

/** Pubkey (hex) eines Secrets via nak. */
function pubOf(sec: string): string {
    return execFileSync(NAK, ['key', 'public', sec]).toString().trim()
}

/** Seedet eine „Fork off!"-Meldung (kind 1984): ["e",id,reason]+["p",autor], content=Freitext. */
function seedReport(reporterSec: string, reportedPubkey: string, reportedId: string, reason: string, content: string): void {
    execFileSync(NAK, [
        'event', '--auth', '--sec', reporterSec, '-k', '1984',
        '-t', `e=${reportedId};${reason}`, '-t', `p=${reportedPubkey}`, '-c', content, ZOOID_WS,
    ])
}

test('P3: Admin sieht die Melde-Queue mit der Meldung', async ({ page }) => {
    const marker = `Report-${Math.floor(Math.random() * 1e9)}`
    seedReport(ADMIN_HEX, pubOf(REPORT_TARGET), DUMMY_EVENT_ID, 'spam', marker)

    await openDirectoryAs(page, ADMIN_HEX)
    await expect(page.locator('.list-stagger').getByText('Relay Admin')).toBeVisible({ timeout: 15_000 })

    await page.getByRole('button', { name: /Meldungen/ }).click()
    const modal = page.locator('dialog[data-modal="action-items"]')
    // Freitext + Grund-Label der Meldung sichtbar — auf die Marker-Zeile gescopt
    // (parallele Tests seeden mehrere Reports, „Spam" ist nicht eindeutig).
    const row = modal.locator('.surface-card', { hasText: marker })
    await expect(row).toBeVisible({ timeout: 15_000 })
    await expect(row.getByText('Spam', { exact: true })).toBeVisible()
})

test('P3: normaler User sieht keine Melde-Queue', async ({ page }) => {
    seedReport(ADMIN_HEX, pubOf(REPORT_TARGET), DUMMY_EVENT_ID, 'spam', `NoAdmin-${Math.floor(Math.random() * 1e9)}`)
    await openDirectory(page)
    await expect(page.locator('.list-stagger').getByText('Relay Admin')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('button', { name: /Meldungen/ })).toBeHidden()
})

test('P3: Admin verwirft eine Meldung (banevent Report)', async ({ page }) => {
    const marker = `Dismiss-${Math.floor(Math.random() * 1e9)}`
    seedReport(ADMIN_HEX, pubOf(REPORT_TARGET), DUMMY_EVENT_ID, 'other', marker)

    await openDirectoryAs(page, ADMIN_HEX)
    await expect(page.locator('.list-stagger').getByText('Relay Admin')).toBeVisible({ timeout: 15_000 })

    await page.getByRole('button', { name: /Meldungen/ }).click()
    const modal = page.locator('dialog[data-modal="action-items"]')
    const row = modal.locator('.surface-card', { hasText: marker })
    await expect(row).toBeVisible({ timeout: 15_000 })
    await row.getByRole('button', { name: 'Verwerfen' }).click()

    // Meldung verschwindet aus der Queue (optimistisch removeEvent nach banevent).
    await expect(modal.getByText(marker)).toHaveCount(0, { timeout: 15_000 })
})

// „Autor bannen" (banpubkey) ist vorerst NICHT im UI angeboten (bewusst deaktiviert,
// auch in der Melde-Queue). Test bleibt erhalten, aber geskippt — beim Reaktivieren
// des banReportedUser-Buttons (⚡directory) wieder einschalten.
test.skip('P3: Admin bannt den gemeldeten Autor (banpubkey)', async ({ page }) => {
    const marker = `BanRep-${Math.floor(Math.random() * 1e9)}`
    seedReport(ADMIN_HEX, pubOf(REPORT_BAN_TARGET), DUMMY_EVENT_ID, 'spam', marker)

    await openDirectoryAs(page, ADMIN_HEX)
    await expect(page.locator('.list-stagger').getByText('Relay Admin')).toBeVisible({ timeout: 15_000 })

    await page.getByRole('button', { name: /Meldungen/ }).click()
    const modal = page.locator('dialog[data-modal="action-items"]')
    const row = modal.locator('.surface-card', { hasText: marker })
    await expect(row).toBeVisible({ timeout: 15_000 })
    await row.getByRole('button', { name: 'Autor bannen' }).click()

    await expect(modal.getByText(marker)).toHaveCount(0, { timeout: 15_000 })
})

/**
 * P3 (Regression, ultracode-Finding HIGH) — ein Report mit KAPUTTEM p-Tag (kein
 * 64-hex) darf die ganze Melde-Queue nicht lahmlegen (npubEncode würde sonst im
 * derived-map werfen). Die Ableitung validiert den Pubkey → ungültige Meldung wird
 * als „unbekannt" gezeigt, gültige Meldungen bleiben sichtbar.
 */
test('P3: kaputter Report-Pubkey legt die Queue nicht lahm', async ({ page }) => {
    const good = `Good-${Math.floor(Math.random() * 1e9)}`
    seedReport(ADMIN_HEX, 'not-a-valid-hex-pubkey', DUMMY_EVENT_ID, 'spam', `Bad-${Math.floor(Math.random() * 1e9)}`)
    seedReport(ADMIN_HEX, pubOf(REPORT_TARGET), DUMMY_EVENT_ID, 'other', good)

    await openDirectoryAs(page, ADMIN_HEX)
    await expect(page.locator('.list-stagger').getByText('Relay Admin')).toBeVisible({ timeout: 15_000 })

    await page.getByRole('button', { name: /Meldungen/ }).click()
    const modal = page.locator('dialog[data-modal="action-items"]')
    // Trotz der kaputten Meldung rendert die Queue die gültige.
    await expect(modal.getByText(good)).toBeVisible({ timeout: 15_000 })
})

// ── P4b: Beitritts-Queue (offene 9021 für closed-Räume) ─────────────────────
const JOIN_APPLICANT = '6666666666666666666666666666666666666666666666666666666666666666'
const REJECT_APPLICANT = '7777777777777777777777777777777777777777777777777777777777777777'

/** Legt einen closed-Raum via nak an (kind 9007 + 9002 mit closed-Flag). */
function seedClosedRoom(h: string, name: string): void {
    trackRoom(h)
    execFileSync(NAK, ['event', '--auth', '--sec', ADMIN_HEX, '-k', '9007', '-t', `h=${h}`, ZOOID_WS])
    execFileSync(NAK, ['event', '--auth', '--sec', ADMIN_HEX, '-k', '9002', '-t', `h=${h}`, '-t', `name=${name}`, '-t', 'closed', ZOOID_WS])
}

/** Ein Wegwerf-Bewerber (erst als Space-Member zugelassen) sendet einen Join (9021). */
function seedJoinRequest(sec: string, h: string): void {
    const pub = execFileSync(NAK, ['key', 'public', sec]).toString().trim()
    mgmt(`{"method":"allowpubkey","params":["${pub}"]}`)
    execFileSync(NAK, ['event', '--auth', '--sec', sec, '-k', '9021', '-t', `h=${h}`, ZOOID_WS])
}

test('P4b: Admin nimmt eine Beitritts-Anfrage an (closed-Raum)', async ({ page }) => {
    const h = `join${Math.floor(Math.random() * 1e9)}`
    const name = `JoinRoom-${Math.floor(Math.random() * 1e9)}`
    seedClosedRoom(h, name)
    seedJoinRequest(JOIN_APPLICANT, h)

    await openDirectoryAs(page, ADMIN_HEX)
    await expect(page.locator('.list-stagger').getByText('Relay Admin')).toBeVisible({ timeout: 15_000 })

    await page.getByRole('button', { name: /Meldungen/ }).click()
    const modal = page.locator('dialog[data-modal="action-items"]')
    const row = modal.locator('.surface-card', { hasText: name })
    await expect(row).toBeVisible({ timeout: 15_000 })
    await row.getByRole('button', { name: 'Annehmen' }).click()

    // Nach Annahme (kind 9000 → 39002) fällt die Anfrage aus der Queue.
    await expect(modal.getByText(name)).toHaveCount(0, { timeout: 15_000 })
})

test('P4b: Admin lehnt eine Beitritts-Anfrage ab (banevent)', async ({ page }) => {
    const h = `rej${Math.floor(Math.random() * 1e9)}`
    const name = `RejRoom-${Math.floor(Math.random() * 1e9)}`
    seedClosedRoom(h, name)
    seedJoinRequest(REJECT_APPLICANT, h)

    await openDirectoryAs(page, ADMIN_HEX)
    await expect(page.locator('.list-stagger').getByText('Relay Admin')).toBeVisible({ timeout: 15_000 })

    await page.getByRole('button', { name: /Meldungen/ }).click()
    const modal = page.locator('dialog[data-modal="action-items"]')
    const row = modal.locator('.surface-card', { hasText: name })
    await expect(row).toBeVisible({ timeout: 15_000 })
    await row.getByRole('button', { name: 'Ablehnen' }).click()

    await expect(modal.getByText(name)).toHaveCount(0, { timeout: 15_000 })
})

// ── P4: bulk follow over the member list ────────────────────────────────────
//
// The two promises the plan calls non-negotiable are POINT 4 (the preview counts out of
// the authoritative list) and POINT 5 (the selection is frozen when the preview opens).
// Both hold in `js/directoryIsland.ts` today and neither had a carrier: over the whole
// branch not one `.spec.ts` was touched. If the dialog ever stopped freezing, `listSeen`
// would be true, `followMany` would write without complaint, and the reader would sign
// against numbers that moved under them — with nothing in this repository going red.
//
// **Every reader below is a FRESH keypair, never `NOSTR_TEST_NSEC`.** A kind 3 is
// replaceable: written under the shared identity there is no second copy, so a parallel
// spec reading it would be reading whatever this file wrote last. The relay is
// member-only (`public_write=false`, like production), so a fresh key needs `allowpubkey`
// before it may read the directory or publish at all — and that call also puts it into
// the relay-signed 13534, measured: the member grid went from 3 rows to 4 the moment one
// was admitted. `unallowpubkey` in the `afterAll` below takes them back out.
//
// `admitReader`, the two seeds and the silent relay live in `support/followWire.ts` since
// P6, where `follow.spec.ts` and `follow-bulk.spec.ts` use the same ones. They were
// moved out of this file; the reasoning above is theirs and is repeated in that module's
// header. `admitReader`, `seedRelayList` and the silent relay are byte-identical (checked
// programmatically); `seedFollowList` gained an `options` parameter, so with no options
// the call is the same and the word „unchanged" — which stood here — is not.

/**
 * Two pubkeys that are nobody in this space. They exist so the seeded contact list has a
 * known size that is bigger than the selection — „grows from 3 to 4" is a sentence the
 * reader can check, „grows from 1 to 2" would be true of an unread base as well.
 */
const FOLLOW_FILLER = ['c'.repeat(64), 'd'.repeat(64)]

/** The shell around the lazily imported island (`nostrDirectoryShell`, `js/bridge.ts`). */
const shellState = (page: Page): Promise<{ hydrated: boolean; failed: boolean }> =>
    page.evaluate(() => {
        const alpine = (window as unknown as {
            Alpine: { $data(el: Element): { hydrated: boolean; failed: boolean } }
        }).Alpine
        const shell = alpine.$data(document.querySelector('[x-data="nostrDirectoryShell"]') as Element)

        return { hydrated: shell.hydrated, failed: shell.failed }
    })

/** Turn on selection mode and tick the rows of `targets`. */
async function enterSelection(page: Page, targets: readonly string[]): Promise<void> {
    await page.locator('[data-directory-select-toggle]').click()
    for (const pk of targets) {
        await page.locator(`[data-directory-row][data-pubkey="${pk}"] [data-directory-row-check]`).click()
    }
}

/**
 * The one button of the bar carries two steps for a reader whose `OutboxKnowledge` is
 * `confirmed-none`: the first click READS the contact list (`armFollowRead`, writes
 * nothing), the second opens the preview. The label is what says which one is due.
 */
async function openBulkPreview(page: Page): Promise<Locator> {
    const submit = page.locator('[data-directory-bulk-submit]')
    await expect(submit).toHaveText('Kontaktliste laden', { timeout: 30_000 })
    await submit.click()
    await expect(submit).toHaveText('Auswahl prüfen', { timeout: 30_000 })
    await submit.click()
    const modal = page.locator('dialog[data-modal="follow-bulk-preview"]')
    await expect(modal).toBeVisible({ timeout: 15_000 })

    return modal
}

/**
 * P4, point 5 — **the write set is frozen when the preview opens.**
 *
 * Both sources under the dialog are live: the member list is a running subscription on
 * the relay-signed 13534 (`js/members.ts`), and the reader's own contact list can come
 * back at any moment. This case empties both WHILE the dialog stands and holds the four
 * figures to what the reader was shown.
 */
test('P4: the preview keeps its figures when both live sources empty underneath it', async ({ page }) => {
    const reader = admitReader()
    const admin = pubOf(ADMIN_HEX)
    seedFollowList(reader, [admin, ...FOLLOW_FILLER])

    await useZooid(page)
    await loginNsec(page, reader.nsec)
    await page.goto('/bereich/leute')
    await expect(page.locator('.list-stagger').getByText('Relay Admin')).toBeVisible({ timeout: 20_000 })

    await enterSelection(page, [admin, testKeys().pk])
    await openBulkPreview(page)

    const growth = page.locator('[data-directory-bulk-growth]')
    const selected = page.locator('[data-directory-bulk-preview] dd').first()
    await expect(growth).toHaveText('Deine Kontaktliste wächst von 3 auf 4.')
    await expect(selected).toHaveText('2')
    await expect(page.locator('[data-directory-bulk-add]')).toHaveText('1')
    await expect(page.locator('[data-directory-bulk-already]')).toHaveText('1')

    // The relay drops every member and the contact list comes back empty — the two moves
    // that separate „what was shown" from „what would be written".
    await page.evaluate(() => {
        const alpine = (window as unknown as {
            Alpine: {
                store(name: string): { following: string[] }
                $data(el: Element): { members: unknown[] }
            }
        }).Alpine
        alpine.$data(document.querySelector('[x-data="nostrDirectory"]') as Element).members = []
        alpine.store('follows').following = []
    })

    // The positive control of the step above: without it „nothing moved" would be just as
    // true of an `evaluate` that reached nothing at all.
    await expect(page.locator('[data-directory-row]')).toHaveCount(0, { timeout: 10_000 })
    expect(await page.evaluate(() => (window as unknown as {
        Alpine: { store(name: string): { following: string[] } }
    }).Alpine.store('follows').following.length)).toBe(0)

    // …and the dialog still says what the reader confirmed.
    await expect(growth).toHaveText('Deine Kontaktliste wächst von 3 auf 4.')
    await expect(selected).toHaveText('2')
    await expect(page.locator('[data-directory-bulk-add]')).toHaveText('1')
    await expect(page.locator('[data-directory-bulk-already]')).toHaveText('1')
})

/**
 * P4, point 4 — **the figures come out of the list the relays answered with.**
 *
 * The seeded base is three contacts, one of them a member of this space. Selecting that
 * member plus one the reader does not follow yet has exactly one answer: 2 selected,
 * 1 added, 1 already there, 3 → 4. Every one of those numbers is wrong for an unread
 * base, which is the whole reason the step exists.
 *
 * The second half is the `add === 0` branch: a selection of people the reader already
 * follows changes nothing, says so in words, and the confirm button is inert.
 */
test('P4: the preview counts n of m out of the list the relays answered with', async ({ page }) => {
    const reader = admitReader()
    const admin = pubOf(ADMIN_HEX)
    const shared = testKeys().pk
    seedFollowList(reader, [admin, ...FOLLOW_FILLER])

    await useZooid(page)
    await loginNsec(page, reader.nsec)
    await page.goto('/bereich/leute')
    await expect(page.locator('.list-stagger').getByText('Relay Admin')).toBeVisible({ timeout: 20_000 })

    await enterSelection(page, [admin, shared])
    const modal = await openBulkPreview(page)

    await expect(page.locator('[data-directory-bulk-growth]')).toHaveText('Deine Kontaktliste wächst von 3 auf 4.')
    await expect(page.locator('[data-directory-bulk-preview] dd').first()).toHaveText('2')
    await expect(page.locator('[data-directory-bulk-add]')).toHaveText('1')
    await expect(page.locator('[data-directory-bulk-already]')).toHaveText('1')
    await expect(page.locator('[data-directory-bulk-confirm]')).not.toHaveAttribute('aria-disabled', 'true')

    // Now the branch where the plan adds nobody.
    await modal.getByRole('button', { name: 'Abbrechen' }).click()
    await expect(modal).toBeHidden()
    await page.locator(`[data-directory-row][data-pubkey="${shared}"] [data-directory-row-check]`).click()
    await page.locator('[data-directory-bulk-submit]').click()
    await expect(modal).toBeVisible({ timeout: 15_000 })

    await expect(page.locator('[data-directory-bulk-growth]'))
        .toHaveText('Deine Kontaktliste ändert sich nicht — du folgst allen Ausgewählten schon.')
    await expect(page.locator('[data-directory-bulk-add]')).toHaveText('0')
    await expect(page.locator('[data-directory-bulk-already]')).toHaveText('1')
    const confirm = page.locator('[data-directory-bulk-confirm]')
    await expect(confirm).toHaveAttribute('aria-disabled', 'true')

    // `aria-disabled` is an announcement and not a lock — the button stays reachable from
    // the keyboard on purpose (`js/forge.ts` writes that out for the same construction).
    // The lock is in `confirmBulkFollow`, so the press has to be the thing that is
    // measured: a write would refuse the no-op, put a refusal into the bar and close this
    // dialog. It stands, and it still says the same thing.
    await confirm.focus()
    await page.keyboard.press('Enter')
    await expect(modal).toBeVisible()
    await expect(page.locator('[data-directory-bulk-growth]'))
        .toHaveText('Deine Kontaktliste ändert sich nicht — du folgst allen Ausgewählten schon.')
})

/**
 * **The island arrives by `import()` since `6565549`, and a dynamic import that rejects
 * says nothing in this house.** No console line, no page error — the chunk is simply
 * never there. What has to stand in its place is a rendered callout, and nothing else:
 * a half-built directory beside an error would be worse than either.
 */
test('P4: a directory chunk that never arrives leaves a callout and no half-built surface', async ({ page }) => {
    await useZooid(page)
    await page.route('**/assets/directoryIsland-*.js', (route) => route.abort('failed'))
    await loginNsec(page, NSEC)
    await page.goto('/bereich/leute')

    const callout = page.locator('[data-directory-chunk-error]')
    await expect(callout).toBeVisible({ timeout: 20_000 })
    await expect(callout).toContainText('Die Mitgliederliste ist gerade nicht erreichbar.')
    // The way out is a reload and not a second `import()`: a specifier whose fetch failed
    // stays failed in this document's module map.
    await expect(callout.getByRole('button', { name: 'Seite neu laden' })).toBeVisible()

    expect(await shellState(page)).toEqual({ hydrated: false, failed: true })
    await expect(page.locator('[x-data="nostrDirectory"]')).toHaveCount(0)
    await expect(page.locator('[data-directory-row]')).toHaveCount(0)
    // Not the skeleton either: the wait is over, and a wait that outlives its own answer
    // is the state this callout exists to end.
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0)
})

/**
 * **F3 — a reader whose own relay never closes the read gets the step offered again.**
 *
 * This reader is `listed`: they declare a NIP-65 write relay, so the arming pass on page
 * load does ask it. It completes the handshake and then says nothing, so the read ends
 * after `READ_TIMEOUT_MS` with `answered: false` — and until F3 the bar said „Lädt…" for
 * the rest of the session: no relay name, no error, no retry, while the strict verdict
 * behind the refusal is justified with „the refusal is visible and names the relay".
 *
 * Label and inertness were never measured in a browser, so both are here: the step is
 * offered, it is pressable, and the press produces the refusal that names the relay.
 */
test('P4: a silent own relay offers the load step again and names the relay that stayed silent', async ({ page, relayWaechter }) => {
    test.setTimeout(90_000)
    const silent = await startSilentRelay()
    // A local server this test started itself — the one thing a guard allowance may cover.
    relayWaechter.erlaube(silent.url)
    try {
        const reader = admitReader()
        seedRelayList(reader, [silent.url])

        await useZooid(page)
        await loginNsec(page, reader.nsec)
        await page.goto('/bereich/leute')
        await expect(page.locator('.list-stagger').getByText('Relay Admin')).toBeVisible({ timeout: 20_000 })

        await enterSelection(page, [])
        const submit = page.locator('[data-directory-bulk-submit]')
        // „Lädt…" is the honest label while the arming read is in flight; it stops being
        // honest the moment that read comes back without an answer.
        await expect(submit).toHaveText('Kontaktliste laden', { timeout: 40_000 })
        await expect(submit).not.toHaveAttribute('aria-disabled', 'true')
        await expect(page.locator('[data-directory-bulk-bar] p').first())
            .toHaveText('Kontaktliste laden — danach kannst du folgen')

        await submit.click()
        await expect(page.locator('[data-directory-bulk-error]')).toHaveText(
            `Diese Relais haben die Kontaktliste nicht ausgeliefert: ${silent.label}. Es wurde nichts geändert.`,
            { timeout: 40_000 },
        )
        // Still offered afterwards: a refusal that takes the retry away with it would be
        // the same dead end in a different sentence.
        await expect(submit).toHaveText('Kontaktliste laden')
    } finally {
        await silent.close()
    }
})

/**
 * Every throwaway reader this file let onto the relay is taken back out again.
 *
 * `allowpubkey` does not only unlock writing, it puts the key into the relay-signed 13534
 * — measured on 2026-09-15: the member grid went from 3 rows to 4 the moment a fresh
 * reader was admitted. The zooid instance deliberately survives the run (RUNMARK reuse)
 * and its bloat guard counts rooms, not members, so without this hook every run would
 * leave three more members standing on it, forever.
 *
 * Silent on failure, for the reason the room cleanup below carries.
 */
test.afterAll(() => releaseAdmittedReaders())

/**
 * Jeder hier angelegte Wegwerf-Raum wird wieder gelöscht (kind 9008).
 *
 * Der zooid der Suite überlebt den Lauf; ohne dieses `afterAll` blieb je Lauf eine
 * Handvoll Räume liegen (gemessen 2026-07-31: 5–10 pro Vollauf, 16–25 statt 15 Räume je
 * Instanz). Fehler beim Abräumen sind still — ein Aufräumer, der wirft, überschriebe den
 * Befund des Tests mit einem Infrastruktur-Fehler.
 */
test.afterAll(() => cleanupRooms(ZOOID_WS, ADMIN_HEX))
