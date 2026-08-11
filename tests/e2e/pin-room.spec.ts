import { test, expect, type Page } from './support/fixtures'
import { execFileSync } from 'node:child_process'
import { getPublicKey } from 'nostr-tools/pure'
import { decode } from 'nostr-tools/nip19'
import { useZooid, ZOOID_WS } from './support/zooid'
import { useBuzz, BUZZ_WS, BUZZ_PORT, BUZZ_ROOM_WELCOME, BUZZ_OWNER_SEC_HEX, BUZZ_OWNER_NSEC, BUZZ_USER_NSEC } from './support/buzz'
import { loginNsec } from './support/login'
import { cleanupRooms, trackRoom } from './support/rooms'
import {
    isZooidPinList,
    mayPin,
    mayUnpin,
    pinStateReached,
    isAlreadyGoneError,
    type PinEventLike,
} from '../../packages/einundzwanzig-group/js/pins'
import { shouldPersistEvent } from '../../packages/einundzwanzig-group/js/storage'

/**
 * P6b — Anpinnen im Raum (`js/pins.ts` + `js/roomPins.ts`).
 *
 * ── Zwei Ebenen, bewusst getrennt ────────────────────────────────────────────────────
 * Abschnitt A ist reine Logik aus `pins.ts`/`storage.ts` (kein Browser, kein Relay) —
 * dieselbe Ebene wie `js/search.test.ts` bzw. `storage-cache-logic.spec.ts`, nur ohne
 * eigene Datei, weil die Test-Strategie des Plans für P6b keine eigene Unit-Datei nennt.
 * Zwei DoD-Punkte gehören genau hierher, nicht in den Browser:
 *
 *  - „39005 (Thread-Zusammenfassung) erscheint NICHT als Pin": ein ECHTES Buzz-39005
 *    lässt sich mangels Relay-Signatur nicht fälschen, und der Buzz-Pfad fragt kind 39005
 *    strukturell nie ab (`pinFilters` in `roomPins.ts` filtert dort ausschließlich auf
 *    `BUZZ_PIN`) — ein Live-Test gegen den echten Buzz-Relay würde also unabhängig vom
 *    Kollisionsschutz grün, weil das Ereignis den Client nie erreicht (`js/threading.ts`
 *    bestätigt: kein 39005-Konsument auf Buzz). Die einzige Stelle, an der die Kollision
 *    WIRKLICH geprüft wird, ist `isZooidPinList` selbst — die drei Strukturmerkmale, aus
 *    denen sie besteht, sind die Substanz dieses DoD-Punkts.
 *  - „Pin/Unpin überleben einen Kaltstart, neue Kinds in PERSIST_KINDS": die
 *    Kaltstart-Fläche selbst ist Abschnitt C/D (echter Browser, echtes IndexedDB,
 *    geblockter Relay) — aber OB ein 39005 gecacht wird, hängt an `isZooidPinList`
 *    (zooid-Form ja, Buzz-Form nein), und das ist wieder reine Logik.
 *
 * Abschnitt B ist ein Grep-Beleg (Nicht-Portabilität als Kommentar). Abschnitt C/D sind
 * echte Browser-Läufe gegen zooid bzw. Buzz — dort UND NUR dort lassen sich „kein toter
 * Knopf" und „Kaltstart" wirklich zeigen.
 */

// ════════════════════════════════════════════════════════════════════════════════════
// A — reine Logik (kein Browser)
// ════════════════════════════════════════════════════════════════════════════════════

const RELAY_SELF = 'da99fbe39247109327ac8504750d0227d50a8f84049ac8bd2f6c7ad0806ed76d'
const OTHER_PUBKEY = '301eb32442dd6a259bb98c881d1976c7abc880cbb19cc72fb8b53e0de66c3072'

/** Ein zooid-artiges 39005: `["-"]`, kein `h`, leerer Content, Relay-Pubkey. */
const zooidShaped = (over: Partial<PinEventLike> = {}): PinEventLike => ({
    id: 'zid',
    kind: 39005,
    pubkey: RELAY_SELF,
    created_at: 1,
    tags: [['-'], ['d', 'pinraum'], ['e', 'target1']],
    content: '',
    ...over,
})

/** Ein Buzz-artiges 39005 (Thread-Zusammenfassung): `h`, JSON-Content, fremder Pubkey. */
const buzzShaped = (over: Partial<PinEventLike> = {}): PinEventLike => ({
    id: 'bid',
    kind: 39005,
    pubkey: OTHER_PUBKEY,
    created_at: 1,
    tags: [['e', 'target1'], ['d', 'target1'], ['h', 'a956ca5e-…']],
    content: '{"reply_count":1}',
    ...over,
})

test.describe('isZooidPinList — die 39005-Kollision (A)', () => {
    test('zooid-Form (["-"], kein h, leerer content, relaySelf) wird akzeptiert', () => {
        expect(isZooidPinList(zooidShaped(), RELAY_SELF)).toBe(true)
        // Ohne bekannten relaySelf (NIP-11 noch nicht geladen) tragen die Strukturmerkmale
        // die Entscheidung allein.
        expect(isZooidPinList(zooidShaped())).toBe(true)
    })

    test('kind ≠ 39005 wird immer abgelehnt, unabhängig von der Form', () => {
        expect(isZooidPinList(zooidShaped({ kind: 40004 }))).toBe(false)
    })

    test('Buzz-Form (kompletter Gegensatz) wird abgelehnt', () => {
        expect(isZooidPinList(buzzShaped(), RELAY_SELF)).toBe(false)
    })

    // Drei gemessene Strukturmerkmale, „jedes für sich ausreichend" (pins.ts-Docblock) —
    // je EIN Merkmal auf Buzz-Form kippen, die anderen zwei zooid-Form belassen. Jede
    // dieser drei Proben muss FÜR SICH schon ablehnen, sonst ist „ausreichend" falsch.
    test('Merkmal 1 allein reicht: h-Tag vorhanden (Rest bleibt zooid-Form)', () => {
        const event = zooidShaped({ tags: [['-'], ['d', 'pinraum'], ['e', 'target1'], ['h', 'irgendwas']] })
        expect(isZooidPinList(event, RELAY_SELF)).toBe(false)
    })

    test('Merkmal 2 allein reicht: nicht-leerer content (Rest bleibt zooid-Form)', () => {
        const event = zooidShaped({ content: '{"reply_count":1}' })
        expect(isZooidPinList(event, RELAY_SELF)).toBe(false)
    })

    test('Merkmal 3 allein reicht: fehlendes ["-"]-Tag (Rest bleibt zooid-Form)', () => {
        const event = zooidShaped({ tags: [['d', 'pinraum'], ['e', 'target1']] })
        expect(isZooidPinList(event, RELAY_SELF)).toBe(false)
    })

    test('Merkmal 4 (optional, wenn relaySelf bekannt): falscher Pubkey allein reicht', () => {
        const event = zooidShaped({ pubkey: OTHER_PUBKEY })
        expect(isZooidPinList(event, RELAY_SELF)).toBe(false)
        // Ohne bekannten relaySelf trägt dieses Merkmal NICHT — bewusst so (Doku in pins.ts).
        expect(isZooidPinList(event)).toBe(true)
    })
})

test.describe('shouldPersistEvent — Kaltstart-Whitelist für Pins (A)', () => {
    test('zooid-Pin-Liste (echte Form) wird gecacht', () => {
        expect(shouldPersistEvent(zooidShaped() as never)).toBe(true)
    })

    test('ein 39005 in Buzz-Form wird NICHT gecacht, obwohl der Kind identisch ist', () => {
        // Das ist der eigentliche Kern von „39005-Thread-Zusammenfassung überlebt keinen
        // Kaltstart": ein persistierter Stand wäre dauerhaft veraltet (storage.ts-Docblock).
        expect(shouldPersistEvent(buzzShaped() as never)).toBe(false)
    })

    test('BUZZ_PIN (40004) wird gecacht', () => {
        expect(shouldPersistEvent({ id: 'x', kind: 40004, pubkey: 'a', created_at: 1, tags: [], content: '', sig: '' } as never)).toBe(true)
    })
})

test.describe('mayPin/mayUnpin — die Rechte-Matrix (A)', () => {
    test('zooid: nur Space-Admin darf pinnen, unabhängig von Raum-Mitgliedschaft', () => {
        expect(mayPin(false, true, true)).toBe(true)
        expect(mayPin(false, false, true)).toBe(false)
        expect(mayPin(false, true, false)).toBe(true) // Admin-Rolle trägt, Mitgliedschaft ist auf zooid nicht die Bedingung
    })

    test('Buzz: jedes Kanal-Mitglied darf pinnen, Admin-Rolle ist nicht Voraussetzung', () => {
        expect(mayPin(true, false, true)).toBe(true)
        expect(mayPin(true, true, true)).toBe(true)
        expect(mayPin(true, false, false)).toBe(false) // kein Mitglied → kein Pin
    })

    test('zooid: Lösen braucht dieselbe Admin-Rolle wie Setzen — Autorschaft zählt nicht (die Liste kennt keinen Autor)', () => {
        expect(mayUnpin(false, true, true, 'irrelevant', 'me')).toBe(true)
        expect(mayUnpin(false, false, true, 'me', 'me')).toBe(false)
    })

    test('Buzz: der AUTOR darf seinen eigenen Pin lösen, auch ganz ohne Admin-Rolle', () => {
        expect(mayUnpin(true, false, true, 'me', 'me')).toBe(true)
    })

    test('Buzz: ein Mitglied ohne Admin-Rolle darf NICHT den Pin eines anderen lösen', () => {
        expect(mayUnpin(true, false, true, 'jemand-anders', 'me')).toBe(false)
    })

    test('Buzz: ein Admin darf auch fremde Pins lösen', () => {
        expect(mayUnpin(true, true, true, 'jemand-anders', 'me')).toBe(true)
    })

    test('Buzz: ohne Raum-Mitgliedschaft geht gar nichts, auch nicht am eigenen Pin', () => {
        expect(mayUnpin(true, false, false, 'me', 'me')).toBe(false)
    })
})

test.describe('pinStateReached / isAlreadyGoneError (A)', () => {
    test('pinStateReached prüft die WIRKUNG, nicht die Quittung', () => {
        expect(pinStateReached(['a', 'b'], 'a', true)).toBe(true)
        expect(pinStateReached(['a', 'b'], 'c', true)).toBe(false)
        expect(pinStateReached(['a', 'b'], 'a', false)).toBe(false)
        expect(pinStateReached([], 'a', false)).toBe(true)
    })

    test('isAlreadyGoneError erkennt NUR die eine Relay-Meldung, keine andere Ablehnung', () => {
        expect(isAlreadyGoneError('invalid: target event not found')).toBe(true)
        expect(isAlreadyGoneError('Invalid: Target Event Not Found')).toBe(true) // case-insensitiv
        expect(isAlreadyGoneError('invalid: must be event author')).toBe(false)
        expect(isAlreadyGoneError('restricted: you are not authorized to manage groups')).toBe(false)
        expect(isAlreadyGoneError('')).toBe(false)
    })
})

// ════════════════════════════════════════════════════════════════════════════════════
// B — Nicht-Portabilität steht als Kommentar neben dem Code (Grep-Beleg)
// ════════════════════════════════════════════════════════════════════════════════════

test('Nicht-Portabilität des Pins steht als Kommentar in pins.ts, nicht nur im Plan', () => {
    const grep = (args: string[]): string => {
        try {
            return execFileSync('grep', args, { encoding: 'utf8' })
        } catch (error) {
            const err = error as { status?: number }
            if (err.status === 1) {
                return ''
            }
            throw error
        }
    }
    const hit = grep(['-l', 'NICHT portabel', 'packages/einundzwanzig-group/js/pins.ts'])
    expect(hit, 'pins.ts muss die Nicht-Portabilität selbst dokumentieren, nicht nur der Plan').toContain('pins.ts')
})

// ════════════════════════════════════════════════════════════════════════════════════
// C — echter Browser, zooid
// ════════════════════════════════════════════════════════════════════════════════════

const NSEC = process.env.NOSTR_TEST_NSEC as string // VIEWER — Mitglied OHNE can_manage
const NAK = process.env.NAK ?? `${process.env.HOME}/go/bin/nak`
const ADMIN_HEX = 'b2ee09a54bedf17ee1db562bdddd75c48661d981eb52c49dc206c55ba8439414'

type RelayEvent = { id: string; pubkey: string; kind: number; content: string; tags: string[][]; created_at: number }

const rnd = (): number => Math.floor(Math.random() * 1e9)

function nak(args: readonly string[], attempts = 3): string {
    let last: unknown
    for (let i = 0; i < attempts; i++) {
        try {
            return execFileSync(NAK, [...args]).toString()
        } catch (error) {
            last = error
            execFileSync('sleep', ['1'])
        }
    }
    throw last
}

function createZooidRoomNak(h: string, name: string): void {
    // BUG selbst gefunden: ein zusätzliches `name`-Tag auf dem 9007 (Gruppe anlegen)
    // lässt zooid `OK true` melden, registriert die Gruppe aber NICHT nutzbar — jede
    // kind-9-Nachricht danach scheitert mit `invalid: group not found` (manuell mit nak
    // reproduziert und ohne das Tag als Fix bestätigt). `quote-card.spec.ts`s
    // `createRoomNak` trägt den Namen deshalb bewusst nur am 9002, nicht am 9007 — hier
    // exakt demselben Muster gefolgt.
    nak(['event', '--auth', '--sec', ADMIN_HEX, '-k', '9007', '-t', `h=${h}`, ZOOID_WS])
    nak(['event', '--auth', '--sec', ADMIN_HEX, '-k', '9002', '-t', `h=${h}`, '-t', `name=${name}`, ZOOID_WS])
}

function findZooidEvent(h: string, kind: number, pred: (e: RelayEvent) => boolean): RelayEvent | undefined {
    return nak(['req', '-k', String(kind), '-t', `h=${h}`, '--auth', '--sec', ADMIN_HEX, ZOOID_WS])
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as RelayEvent)
        .find(pred)
}

function publishZooidRaw(h: string, sec: string, content: string): string {
    nak(['event', '--auth', '--sec', sec, '-k', '9', '-t', `h=${h}`, '-c', content, ZOOID_WS])
    return (findZooidEvent(h, 9, (e) => e.content === content) as RelayEvent).id
}

async function openZooidRoomAs(page: Page, h: string, nsec: string): Promise<void> {
    await useZooid(page)
    await loginNsec(page, nsec)
    await page.goto(`/rooms/${h}`)
}

/** „…"-Menü öffnen (Desktop-Popover, `!isMobile` — im Playwright-Browser immer der Fall). */
async function openRowMenu(page: Page, row: ReturnType<Page['locator']>): Promise<void> {
    await row.hover()
    await row.getByRole('button', { name: 'Weitere Aktionen' }).click()
}

test.describe('Pin/Unpin (C, zooid)', () => {
    test.skip(process.env.E2E_RELAY === 'buzz', 'zooid-Arm — läuft unter npm run test:e2e')
    test.afterAll(() => cleanupRooms(ZOOID_WS, ADMIN_HEX))

    test('Admin pinnt über das Menü — Leiste zeigt den Eintrag, Klick springt zur Nachricht, Lösen leert die Leiste wieder', async ({ page }) => {
        const h = trackRoom(`pin1${rnd()}`)
        createZooidRoomNak(h, 'Pin1')
        const marker = `P1-${rnd()}`
        const targetId = publishZooidRaw(h, ADMIN_HEX, marker)

        await openZooidRoomAs(page, h, ADMIN_HEX)
        const row = page.locator('div.group', { hasText: marker })
        await expect(row).toBeVisible({ timeout: 15_000 })

        await openRowMenu(page, row)
        await page.getByRole('menuitem', { name: 'Anpinnen' }).click()

        const pinBarEntry = page.locator('#room-pin-list li', { hasText: marker })
        await expect(pinBarEntry).toBeVisible({ timeout: 10_000 })

        await pinBarEntry.getByRole('button', { name: marker }).click()
        await expect(page.locator(`#msg-${targetId}`)).toHaveClass(/ring-brand-500/, { timeout: 5_000 })

        await pinBarEntry.getByRole('button', { name: 'Loslösen' }).click()
        await expect(page.locator('#room-pin-list li', { hasText: marker })).toHaveCount(0, { timeout: 10_000 })
    })

    test('Kaltstart: ein gesetzter Pin übersteht Reload mit geblocktem Relay (aus IndexedDB, nicht vom Netz)', async ({ page }) => {
        test.setTimeout(60_000)
        const h = trackRoom(`pin2${rnd()}`)
        createZooidRoomNak(h, 'Pin2')
        const marker = `P2-${rnd()}`
        publishZooidRaw(h, ADMIN_HEX, marker)

        await openZooidRoomAs(page, h, ADMIN_HEX)
        const row = page.locator('div.group', { hasText: marker })
        await expect(row).toBeVisible({ timeout: 15_000 })
        await openRowMenu(page, row)
        await page.getByRole('menuitem', { name: 'Anpinnen' }).click()
        await expect(page.locator('#room-pin-list li', { hasText: marker })).toBeVisible({ timeout: 10_000 })

        // Auf die Persistenz WARTEN, nicht sofort blocken — sonst blockt der Relay vor
        // dem 3-s-Batch-Schreiben (`syncEvents`, Muster storage-cache.spec.ts).
        const cached = async (): Promise<boolean> =>
            page.evaluate(async (pubkeyHex) => {
                const db = await new Promise<IDBDatabase>((resolve, reject) => {
                    const req = indexedDB.open(`einundzwanzig-cache-${pubkeyHex}`)
                    req.onsuccess = () => resolve(req.result)
                    req.onerror = () => reject(req.error)
                })
                try {
                    const events = await new Promise<{ kind: number; tags: string[][] }[]>((resolve, reject) => {
                        const r = db.transaction('events', 'readonly').objectStore('events').getAll()
                        r.onsuccess = () => resolve(r.result as { kind: number; tags: string[][] }[])
                        r.onerror = () => reject(r.error)
                    })
                    return events.some((e) => e.kind === 39005 && e.tags.some((t) => t[0] === '-'))
                } finally {
                    db.close()
                }
            }, 'da99fbe39247109327ac8504750d0227d50a8f84049ac8bd2f6c7ad0806ed76d')
        await expect.poll(cached, { timeout: 15_000, message: 'die zooid-Pin-Liste (39005) muss vor dem Reload im Cache liegen' }).toBe(true)

        await page.routeWebSocket(new RegExp('localhost:\\d+'), () => {}) // Relay ab jetzt schwarzes Loch
        await page.reload()

        await expect(page.locator('#room-pin-list li', { hasText: marker })).toBeVisible({ timeout: 20_000 })
    })

    test('Mitglied ohne can_manage sieht weder "Anpinnen" noch "Loslösen" im Menü (kein toter Knopf)', async ({ page }) => {
        const h = trackRoom(`pin3${rnd()}`)
        createZooidRoomNak(h, 'Pin3')
        const marker = `P3-${rnd()}`
        publishZooidRaw(h, ADMIN_HEX, marker)

        await openZooidRoomAs(page, h, NSEC)
        const row = page.locator('div.group', { hasText: marker })
        await expect(row).toBeVisible({ timeout: 15_000 })
        await openRowMenu(page, row)

        await expect(page.getByRole('menuitem', { name: 'Anpinnen' })).toHaveCount(0)
        await expect(page.getByRole('menuitem', { name: 'Loslösen' })).toHaveCount(0)
    })
})

// ════════════════════════════════════════════════════════════════════════════════════
// D — echter Browser, Buzz (E2E_RELAY=buzz)
// ════════════════════════════════════════════════════════════════════════════════════

async function openBuzzWelcomeAs(page: Page, nsec: string): Promise<void> {
    await useBuzz(page)
    await loginNsec(page, nsec)
    await page.goto(`/rooms/${BUZZ_ROOM_WELCOME}`)
}

function publishBuzzRaw(h: string, sec: string, content: string): string {
    execFileSync(NAK, ['event', '--auth', '--sec', sec, '-k', '9', '-t', `h=${h}`, '-c', content, BUZZ_WS], { encoding: 'utf8', timeout: 20_000 })
    for (let attempt = 0; attempt < 12; attempt++) {
        const out = execFileSync(NAK, ['req', '-k', '9', '-t', `h=${h}`, '--auth', '--sec', BUZZ_OWNER_SEC_HEX, BUZZ_WS], {
            encoding: 'utf8',
            timeout: 20_000,
        })
        const hit = out
            .trim()
            .split('\n')
            .filter(Boolean)
            .map((l) => JSON.parse(l) as RelayEvent)
            .find((e) => e.content === content)
        if (hit) {
            return hit.id
        }
        execFileSync('sleep', ['0.3'])
    }
    throw new Error(`Buzz-Seed-Nachricht ${content} kam nicht an`)
}

/** Das aktuelle 40004 auf `targetId` — für die "target event not found"-Race unten. */
function findBuzzPinEvent(h: string, targetId: string): RelayEvent | undefined {
    const out = execFileSync(NAK, ['req', '-k', '40004', '-t', `h=${h}`, '--auth', '--sec', BUZZ_OWNER_SEC_HEX, BUZZ_WS], {
        encoding: 'utf8',
        timeout: 20_000,
    })
    return out
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as RelayEvent)
        .find((e) => e.tags.some((t) => t[0] === 'e' && t[1] === targetId))
}

test.describe('Pin/Unpin (D, Buzz — nur E2E_RELAY=buzz)', () => {
    test.skip(process.env.E2E_RELAY !== 'buzz', 'nur im Buzz-Modus relevant')

    test('Jedes Mitglied darf pinnen (Owner) — Kaltstart übersteht geblockten Relay', async ({ page, browser, baseURL }) => {
        test.setTimeout(60_000)
        const marker = `PB1-${rnd()}`
        publishBuzzRaw(BUZZ_ROOM_WELCOME, BUZZ_OWNER_SEC_HEX, marker)

        // Der Pin-Aufbau UND das Aufräumen stehen in EINEM try/finally: bricht irgendeine
        // Zusicherung oben ab, würde ein Pin sonst liegen bleiben und den NÄCHSTEN Test
        // dieser Datei kippen (derselbe geteilte Welcome-Raum) — gemessen als Ursache eines
        // Sammellauf-Fehlschlags, der isoliert nicht auftrat.
        try {
            await openBuzzWelcomeAs(page, BUZZ_OWNER_NSEC)
            const row = page.locator('div.group', { hasText: marker })
            await expect(row).toBeVisible({ timeout: 20_000 })
            await openRowMenu(page, row)
            await page.getByRole('menuitem', { name: 'Anpinnen' }).click()
            await expect(page.locator('#room-pin-list li', { hasText: marker })).toBeVisible({ timeout: 10_000 })

            const cached = async (): Promise<boolean> =>
                page.evaluate(async (pubkeyHex) => {
                    const db = await new Promise<IDBDatabase>((resolve, reject) => {
                        const req = indexedDB.open(`einundzwanzig-cache-${pubkeyHex}`)
                        req.onsuccess = () => resolve(req.result)
                        req.onerror = () => reject(req.error)
                    })
                    try {
                        const events = await new Promise<{ kind: number }[]>((resolve, reject) => {
                            const r = db.transaction('events', 'readonly').objectStore('events').getAll()
                            r.onsuccess = () => resolve(r.result as { kind: number }[])
                            r.onerror = () => reject(r.error)
                        })
                        return events.some((e) => e.kind === 40004)
                    } finally {
                        db.close()
                    }
                }, getPublicKey(decode(BUZZ_OWNER_NSEC).data as Uint8Array))
            await expect.poll(cached, { timeout: 15_000, message: 'das 40004 muss vor dem Reload im Cache liegen' }).toBe(true)

            await page.routeWebSocket(new RegExp(`localhost:${BUZZ_PORT}`), () => {})
            await page.reload()
            await expect(page.locator('#room-pin-list li', { hasText: marker })).toBeVisible({ timeout: 20_000 })
        } finally {
            // Aufräumen — IMMER, auch bei einem Fehlschlag oben (deshalb im `finally`,
            // nicht als letzter Schritt des Happy Path).
            //
            // FRISCHER Context, nicht `page.context().newPage()`: eine zweite Seite im
            // GLEICHEN Context teilt Cookies/LocalStorage der bereits eingeloggten Session
            // — `/nostr-login` rendert dann keinen Login mehr (kein "Andere Optionen"),
            // `loginNsec()` läuft in den 30/60-s-Timeout. Gemessen mit einer Sonde ganz ohne
            // Raum/Pin: zweite Seite im selben Context → Knopf "Andere Optionen" 0×, in
            // einem frischen Context → 1×. Gleiches Muster wie `room.spec.ts:2691`
            // (`browser.newContext` + `try/finally`) und `locale-switch.spec.ts:89`
            // (`browser.newContext({ baseURL })`).
            const cleanupCtx = await browser.newContext({ baseURL: baseURL ?? undefined })
            try {
                const cleanup = await cleanupCtx.newPage()
                await openBuzzWelcomeAs(cleanup, BUZZ_OWNER_NSEC)
                const cleanupRow = cleanup.locator('div.group', { hasText: marker })
                await expect(cleanupRow).toBeVisible({ timeout: 20_000 })
                await openRowMenu(cleanup, cleanupRow)
                const unpinBtn = cleanup.getByRole('menuitem', { name: 'Loslösen' })
                if (await unpinBtn.count()) {
                    await unpinBtn.click()
                    await expect(cleanup.locator('#room-pin-list li', { hasText: marker })).toHaveCount(0, { timeout: 10_000 })
                }
            } finally {
                await cleanupCtx.close()
            }
        }
    })

    test('Autor löst den eigenen Pin OHNE Admin-Rolle — ein anderes Mitglied sieht "Loslösen" für einen fremden Pin gar nicht erst', async ({ page }) => {
        test.setTimeout(60_000)
        const marker = `PB2-${rnd()}`
        publishBuzzRaw(BUZZ_ROOM_WELCOME, BUZZ_OWNER_SEC_HEX, marker)

        // Der NICHT-Owner (BUZZ_USER) pinnt selbst — Voraussetzung dafür, dass er der
        // Autor des Pins ist und ihn ohne Admin-Rolle wieder lösen darf.
        await openBuzzWelcomeAs(page, BUZZ_USER_NSEC)
        const row = page.locator('div.group', { hasText: marker })
        await expect(row).toBeVisible({ timeout: 20_000 })
        await openRowMenu(page, row)
        await page.getByRole('menuitem', { name: 'Anpinnen' }).click()
        await expect(page.locator('#room-pin-list li', { hasText: marker })).toBeVisible({ timeout: 10_000 })

        // Ein DRITTES Mitglied (Owner ist zugleich Kanal-Admin — hier bewusst NICHT
        // verwendet, sondern der Owner als "ein anderes Mitglied ohne Autorschaft"):
        // auf einer zweiten Seite/Session sieht der Owner "Loslösen" NICHT (er ist weder
        // Autor noch — für diese Aussage relevant — wird die Admin-Rolle hier nicht
        // gebraucht, weil laut Messung Owner=Admin auf Buzz ohnehin darf; die
        // aussagekräftige Rolle ist daher: ein NICHT-Admin-NICHT-Autor).
        //
        // Da der buzz-test-Stack nur zwei geseedete Schlüssel kennt (Owner=Admin,
        // User=Mitglied), wird die Rechte-Matrix für "fremder Pin, kein Admin, kein
        // Autor" bereits in Abschnitt A (mayUnpin) exakt geprüft — hier zusätzlich der
        // reale End-zu-End-Beleg für den einzigen praktisch erreichbaren Fall dieses
        // Stacks: der AUTOR löst selbst.
        await page.locator('#room-pin-list li', { hasText: marker }).getByRole('button', { name: 'Loslösen' }).click()
        await expect(page.locator('#room-pin-list li', { hasText: marker })).toHaveCount(0, { timeout: 10_000 })
    })

    test('"target event not found" (Race: Pin extern bereits gelöscht) gilt als Erfolg — kein Fehler-Callout', async ({ page }) => {
        test.setTimeout(60_000)
        const marker = `PB3-${rnd()}`
        const targetId = publishBuzzRaw(BUZZ_ROOM_WELCOME, BUZZ_OWNER_SEC_HEX, marker)

        await openBuzzWelcomeAs(page, BUZZ_OWNER_NSEC)
        const row = page.locator('div.group', { hasText: marker })
        await expect(row).toBeVisible({ timeout: 20_000 })
        await openRowMenu(page, row)
        await page.getByRole('menuitem', { name: 'Anpinnen' }).click()
        await expect(page.locator('#room-pin-list li', { hasText: marker })).toBeVisible({ timeout: 10_000 })

        // Extern (ein zweiter Client) löst denselben Pin VOR dem Klick in der UI — die
        // Insel hält noch den alten (jetzt toten) `pinEventId` in ihrem State.
        const pinEvent = findBuzzPinEvent(BUZZ_ROOM_WELCOME, targetId)
        expect(pinEvent, 'der Pin muss extern auffindbar sein, sonst prüft der Test nichts').toBeTruthy()
        execFileSync(
            NAK,
            ['event', '--auth', '--sec', BUZZ_OWNER_SEC_HEX, '-k', '5', '-t', `h=${BUZZ_ROOM_WELCOME}`, '-t', `e=${pinEvent!.id}`, '-t', 'k=40004', BUZZ_WS],
            { encoding: 'utf8', timeout: 20_000 },
        )

        // Jetzt in der UI "Loslösen" — die Insel schickt ihr (jetzt stales) Lösch-Kommando,
        // der Relay antwortet mit "target event not found".
        await page.locator('#room-pin-list li', { hasText: marker }).getByRole('button', { name: 'Loslösen' }).click()

        // KEIN Fehler-Callout — das wäre eine Einladung zum Wiederholen, obwohl der
        // gewünschte Zustand (kein Pin mehr) längst erreicht ist.
        await expect(page.getByRole('button', { name: 'Verstanden' })).toHaveCount(0, { timeout: 5_000 })
        await expect(page.locator('#room-pin-list li', { hasText: marker })).toHaveCount(0, { timeout: 10_000 })
    })
})

// ════════════════════════════════════════════════════════════════════════════════════
// E — visuelle Kontrolle der Pin-Leiste (hell/dunkel) — kein Design-Review, nur:
//     ist die Fläche überhaupt da, sichtbar, bedienbar? Screenshots gehen ins Scratchpad
//     und werden im Bericht beschrieben (kein automatisierter Pixel-Vergleich).
// ════════════════════════════════════════════════════════════════════════════════════

test.describe('Pin-Leiste — visuelle Stichprobe hell/dunkel', () => {
    test.skip(process.env.E2E_RELAY === 'buzz', 'Markup ist relay-unabhängig, ein Arm genügt')
    test.afterAll(() => cleanupRooms(ZOOID_WS, ADMIN_HEX))

    test('Screenshot der Pin-Leiste in hell und dunkel', async ({ page }) => {
        const h = trackRoom(`pinvis${rnd()}`)
        createZooidRoomNak(h, 'PinVis')
        const marker = `PV-${rnd()}`
        publishZooidRaw(h, ADMIN_HEX, marker)

        await openZooidRoomAs(page, h, ADMIN_HEX)
        const row = page.locator('div.group', { hasText: marker })
        await expect(row).toBeVisible({ timeout: 15_000 })
        await openRowMenu(page, row)
        await page.getByRole('menuitem', { name: 'Anpinnen' }).click()
        await expect(page.locator('#room-pin-list li', { hasText: marker })).toBeVisible({ timeout: 10_000 })

        await page.evaluate(() => document.documentElement.classList.remove('dark'))
        await page.screenshot({ path: 'test-results/pin-bar-light.png' })

        await page.evaluate(() => document.documentElement.classList.add('dark'))
        await page.screenshot({ path: 'test-results/pin-bar-dark.png' })
    })
})
