import { test, expect, type Page } from './support/fixtures'
import { execFileSync } from 'node:child_process'
import { getPublicKey } from 'nostr-tools/pure'
import { decode } from 'nostr-tools/nip19'
import { useZooid, ZOOID_WS } from './support/zooid'
import { BUZZ_URL, BUZZ_PORT, BUZZ_ROOM_WELCOME, BUZZ_OWNER_SEC_HEX, BUZZ_USER_NSEC } from './support/buzz'
import { loginNsec } from './support/login'
import { cleanupRooms, trackRoom } from './support/rooms'

/**
 * P6a — Suche im geladenen Verlauf (`js/search.ts` + `js/roomSearch.ts`).
 *
 * Reine Logik (Faltung, UND-Suche, Segmente, Limit) deckt `js/search.test.ts` ab
 * (42 Fälle, `node --test`) — hier NUR, was einen echten Browser braucht: dass wirklich
 * KEIN Netzwerk-Frame rausgeht, dass ein Treffer wirklich zur Nachricht springt, dass
 * die Grenze wirklich im Ergebnisbereich steht und dass zwei Räume mit demselben `h` auf
 * zwei verschiedenen Relays wirklich getrennt bleiben — vier Aussagen, die eine reine
 * Funktionsprüfung nicht treffen kann.
 *
 * ── Determinismus ─────────────────────────────────────────────────────────────────
 * Jeder Test legt seinen EIGENEN Raum an (`trackRoom` + `cleanupRooms` in `afterAll`),
 * Nachrichten kommen über `nak` roh auf den Relay (exakte Kontrolle über Text/Zeit,
 * gleiche Begründung wie `quote-card.spec.ts`).
 */

const NSEC = process.env.NOSTR_TEST_NSEC as string
const NAK = process.env.NAK ?? `${process.env.HOME}/go/bin/nak`
const ADMIN = 'b2ee09a54bedf17ee1db562bdddd75c48661d981eb52c49dc206c55ba8439414'

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

/** Frischer Wegwerf-Raum (kind 9007 + 9002) auf zooid, abgeräumt am Dateiende. */
function createRoomNak(h: string, name: string): void {
    nak(['event', '--auth', '--sec', ADMIN, '-k', '9007', '-t', `h=${h}`, ZOOID_WS])
    nak(['event', '--auth', '--sec', ADMIN, '-k', '9002', '-t', `h=${h}`, '-t', `name=${name}`, ZOOID_WS])
}

function findEvent(h: string, kind: number, pred: (e: RelayEvent) => boolean): RelayEvent | undefined {
    return nak(['req', '-k', String(kind), '-t', `h=${h}`, '--auth', '--sec', ADMIN, ZOOID_WS])
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as RelayEvent)
        .find(pred)
}

/** Publiziert eine kind-9-Raumnachricht auf zooid und liefert ihre Event-id (per Requery). */
function publishRaw(h: string, sec: string, content: string): string {
    nak(['event', '--auth', '--sec', sec, '-k', '9', '-t', `h=${h}`, '-c', content, ZOOID_WS])
    return (findEvent(h, 9, (e) => e.content === content) as RelayEvent).id
}

async function openRoom(page: Page, h: string): Promise<void> {
    await useZooid(page)
    await loginNsec(page, NSEC)
    await page.goto(`/rooms/${h}`)
}

/** Sucheingabe, Grenzzeile, Trefferliste — die Locators, die jeder Test braucht. */
function searchLocators(page: Page) {
    return {
        openButton: page.getByRole('button', { name: 'Im Raum suchen' }),
        panel: page.locator('#room-search-panel'),
        input: page.getByPlaceholder('Nachricht finden…'),
        boundary: page.locator('#room-search-panel [role="status"]'),
        closeButton: page.getByRole('button', { name: 'Suche schließen' }),
    }
}

test.afterAll(() => cleanupRooms(ZOOID_WS, ADMIN))

// ── 1) Kein REQ über den gesamten Zyklus ────────────────────────────────────────────

/**
 * Die EINE Ausnahme: der Historien-Nachschlag des Raum-Scrollers.
 *
 * ── Warum es sie gibt (gemessen 2026-08-16) ────────────────────────────────────────
 * Der Test setzte den Zähler zurück, sobald die erste Nachricht sichtbar ist. Der
 * Raum-Scroller (`js/scroll.ts`) schickt danach aber noch GENAU EINEN Frame nach: den
 * Nachschlag auf ältere Historie. In 12 von 12 Messläufen lag er 303–352 ms VOR dem
 * Reset — also knapp davor. Unter Last rutscht er darüber und wird dem Suchpanel
 * angelastet, obwohl die Suche ihn nicht ausgelöst hat. Gemeldet als roter Test am
 * 2026-08-16; die Positivkontrolle (Fenster künstlich früher geöffnet, sonst nichts
 * geändert) zeigt exakt diesen Frame im Fenster:
 *   ["REQ","REQ-…",{"kinds":[9,40002,1068,9041],"#h":["<raum>"],"limit":50,"until":…}]
 * Ausgeschlossen wurden dabei: Verbindungsabriss/Re-Subscribe (WS-Abbrüche und
 * wiederholte Subscription-IDs treten in JEDEM Lauf gleich oft auf, auch in grünen)
 * und eine echte Relay-Anfrage der Suche (nach dem Reset geht in grünen Läufen NULL
 * raus, und der Filter ist der Raum-Filter, kein Suchfilter).
 *
 * ── Warum sie die Zusage nicht aufweicht ───────────────────────────────────────────
 * Die Zusage lautet „die Suche stellt keine Relay-Anfrage", nicht „es geht kein Frame
 * raus". Die Ausnahme ist deshalb an drei Bedingungen gebunden, und alle drei stammen
 * aus der Messung, nicht aus Bequemlichkeit:
 *   1. FORM — exakt der Raum-Stream-Filter dieses `h`, mit `until` (Nachschlag) und
 *      `limit: 50`. Ein Suchfilter sähe anders aus und fiele durch.
 *   2. ANZAHL — höchstens EINER. Der Scroller sendet genau einen (12/12). Eine Suche,
 *      die versehentlich DENSELBEN Filter benutzte, käme als ZWEITER an und flöge auf;
 *      fünf Suchen erst recht. Das ist die Gegenprobe, die die Ausnahme eng hält — und
 *      sie ist als eigener Fall unten geprüft, nicht bloß behauptet.
 *   3. ALLES ANDERE zählt. Kein Zeitfenster wurde verkleinert, kein Zähler später
 *      zurückgesetzt, keine Toleranz auf eine Anzahl beliebiger Frames.
 */
const ROOM_STREAM_KINDS = [9, 40002, 1068, 9041]

export function suchFremdeReqs(frames: readonly string[], h: string): string[] {
    let nachschlagGesehen = false
    return frames.filter((frame) => {
        let filter: Record<string, unknown>
        try {
            filter = (JSON.parse(frame) as [string, string, Record<string, unknown>])[2] ?? {}
        } catch {
            return true // unlesbar ⇒ zählt, nie stillschweigend durchlassen
        }
        const kinds = Array.isArray(filter.kinds) ? [...(filter.kinds as number[])].sort((a, b) => a - b) : []
        const hs = Array.isArray(filter['#h']) ? (filter['#h'] as string[]) : []
        const istNachschlag =
            hs.length === 1 &&
            hs[0] === h &&
            typeof filter.until === 'number' &&
            filter.limit === 50 &&
            kinds.join(',') === [...ROOM_STREAM_KINDS].sort((a, b) => a - b).join(',')
        if (istNachschlag && !nachschlagGesehen) {
            nachschlagGesehen = true
            return false
        }
        return true
    })
}

test('Gegenprobe zur Ausnahme: der zweite Nachschlag-Frame und jeder Suchfilter fliegen auf', () => {
    const h = 'raum42'
    const nachschlag = `["REQ","REQ-1",{"kinds":[9,40002,1068,9041],"#h":["${h}"],"limit":50,"until":1786891408}]`

    // Der eine erwartete Frame des Scrollers — und NUR er — wird durchgelassen.
    expect(suchFremdeReqs([nachschlag], h)).toEqual([])
    // Ein ZWEITER derselben Form fliegt auf. Das ist der Fall „die Suche benutzt
    // versehentlich denselben Filter": sie käme immer NACH dem Frame des Scrollers.
    expect(suchFremdeReqs([nachschlag, nachschlag], h)).toEqual([nachschlag])
    // Ein anderer Raum ist nie der Nachschlag DIESES Raums.
    const fremderRaum = nachschlag.replace(h, 'anderer')
    expect(suchFremdeReqs([fremderRaum], h)).toEqual([fremderRaum])
    // Die Live-Subscription (ohne `until`) ist kein Nachschlag — sie darf im Fenster
    // nicht vorkommen und wird deshalb auch nicht entschuldigt.
    const live = `["REQ","REQ-2",{"kinds":[9,40002,1068,9041],"#h":["${h}"],"limit":50}]`
    expect(suchFremdeReqs([live], h)).toEqual([live])
    // Andere Kinds, andere Limits, Volltextsuche: alles zählt.
    const suchArtig = `["REQ","REQ-3",{"kinds":[9],"#h":["${h}"],"limit":50,"until":1786891408,"search":"bitcoin"}]`
    expect(suchFremdeReqs([suchArtig], h)).toEqual([suchArtig])
    // Unlesbares zählt, statt still durchzufallen.
    expect(suchFremdeReqs(['kein json'], h)).toEqual(['kein json'])
})

test('Suche: öffnen, fünf Suchen, Treffer-Klick, schließen — kein einziger REQ-Frame geht raus', async ({ page }) => {
    const h = trackRoom(`search1${rnd()}`)
    createRoomNak(h, 'Search1')

    const marker = `S1-${rnd()}`
    const targetId = publishRaw(h, ADMIN, `${marker} Bitcoin ist eine tolle Erfindung`)
    publishRaw(h, ADMIN, `${marker} noch eine Zeile ohne Bezug`)

    // Frames werden ab Verbindungsaufbau mitgeschnitten — die REQs des initialen
    // Raum-Ladens sind erwartet und werden NACH dem Laden verworfen (s.u.), damit nur
    // noch die Interaktionen mit der Suche gezählt werden.
    const reqFrames: string[] = []
    page.on('websocket', (ws) => {
        ws.on('framesent', (frame) => {
            const payload = typeof frame.payload === 'string' ? frame.payload : frame.payload.toString()
            if (payload.startsWith('["REQ"')) {
                reqFrames.push(payload)
            }
        })
    })

    await openRoom(page, h)
    await expect(page.getByText(marker, { exact: false }).first()).toBeVisible({ timeout: 15_000 })

    // Initiales Laden ist durch — ab hier zählt nur noch, was die Suche selbst tut.
    reqFrames.length = 0

    const { openButton, input, closeButton } = searchLocators(page)
    await openButton.click()
    await expect(input).toBeVisible()

    for (const q of ['bitcoin', 'Erfindung Bitcoin', marker, 'xyz-kein-treffer', '']) {
        await input.fill(q)
    }

    const row = page.locator('div.group', { hasText: marker }).first()
    await expect(row).toBeVisible()
    // GEZIELT auf "Bitcoin" statt auf `marker`: beide Zeilen tragen denselben Marker,
    // nur die erste enthält "Bitcoin" — sonst hätte `.first()` je nach Sortierung die
    // FALSCHE (zweite) Zeile getroffen, und die Ring-Assertion unten hätte niemals aus
    // dem richtigen Grund grün oder rot werden können.
    await input.fill('Bitcoin')
    const hit = page.locator('#room-search-panel li button', { hasText: 'Bitcoin' })
    await expect(hit).toHaveCount(1)
    await hit.click()
    await expect(page.locator(`#msg-${targetId}`)).toHaveClass(/ring-brand-500/, { timeout: 5_000 })

    // Klick schließt die Fläche NICHT selbst — erst der ✕-Knopf.
    await closeButton.click()

    // Gezählt wird, was die SUCHE zu verantworten hat — siehe `suchFremdeReqs` oben:
    // alles außer dem einen Historien-Nachschlag des Raum-Scrollers, der je nach
    // Maschinenlast diesseits oder jenseits der Fenstergrenze landet.
    const fremd = suchFremdeReqs(reqFrames, h)
    expect(fremd, `es dürfen während Öffnen/Suchen/Klick/Schließen KEINE REQ-Frames der SUCHE rausgehen, gesehen: ${JSON.stringify(fremd)} (alle: ${JSON.stringify(reqFrames)})`).toEqual([])
})

// ── 2) Grenze steht im Ergebnisbereich, auch bei null Treffern ─────────────────────

test('Suche: die Grenze des geladenen Verlaufs steht im Ergebnisbereich — auch ohne Eingabe und bei null Treffern', async ({ page }) => {
    const h = trackRoom(`search2${rnd()}`)
    createRoomNak(h, 'Search2')

    const marker = `S2-${rnd()}`
    publishRaw(h, ADMIN, `${marker} eins`)
    publishRaw(h, ADMIN, `${marker} zwei`)

    await openRoom(page, h)
    await expect(page.getByText(`${marker} eins`, { exact: false })).toBeVisible({ timeout: 15_000 })

    const { openButton, input, boundary } = searchLocators(page)
    await openButton.click()

    // Ohne Eingabe: die Zahl der durchsuchten Nachrichten steht da — nicht in den
    // Einstellungen, nicht in einer Fußnote.
    await expect(boundary).toContainText('geladene Verlauf')
    await expect(boundary).toContainText(/\d+ Nachrichten/)

    // Null Treffer heißt NICHT „gibt es nicht" — der Zusatzsatz erklärt die Grenze.
    await input.fill(`${marker}-garantiert-kein-treffer-${rnd()}`)
    await expect(page.locator('#room-search-panel')).toContainText('0 Treffer')
    await expect(
        page.getByText('Ältere Nachrichten sind erst durchsuchbar, wenn sie geladen sind'),
    ).toBeVisible()
})

// ── 3) Treffer-Klick springt zur Nachricht — kein toter Knopf, Mehrwortsuche findet ─

test('Suche: ein Mehrwort-Treffer (Reihenfolge vertauscht) springt beim Klick zur Nachricht', async ({ page }) => {
    const h = trackRoom(`search3${rnd()}`)
    createRoomNak(h, 'Search3')

    const marker = `S3-${rnd()}`
    // welshmans matchFilter kehrt bei Mehrwortsuche in der ERSTEN Runde zurück (nur das
    // erste Wort entscheidet) — eine Suche in VERTAUSCHTER Reihenfolge fände mit diesem
    // Mechanismus nicht zuverlässig. searchMessages soll trotzdem treffen (UND, ohne
    // Reihenfolge).
    const targetId = publishRaw(h, ADMIN, `${marker} Bitcoin ist eine tolle Erfindung`)

    await openRoom(page, h)
    await expect(page.getByText(marker, { exact: false })).toBeVisible({ timeout: 15_000 })

    const { openButton, input } = searchLocators(page)
    await openButton.click()
    await input.fill('Erfindung Bitcoin') // vertauschte Reihenfolge ggü. der Nachricht

    const hit = page.locator('#room-search-panel li button', { hasText: marker }).first()
    await expect(hit).toBeVisible({ timeout: 5_000 })
    await hit.click()

    await expect(page.locator(`#msg-${targetId}`)).toHaveClass(/ring-brand-500/, { timeout: 5_000 })
})

// ── 4) Cross-Space-Isolation: dasselbe `h` in zwei Spaces bleibt getrennt ───────────

/** Testnutzer als Buzz-Relay-Mitglied aufnehmen (Muster workspaces.spec.ts). */
function joinBuzzRelay(): void {
    const sk = decode(NSEC).data as Uint8Array
    execFileSync(
        NAK,
        ['event', '--auth', '--sec', BUZZ_OWNER_SEC_HEX, '-k', '9030', '-t', `p=${getPublicKey(sk)}`, '-t', 'role=member', `ws://localhost:${BUZZ_PORT}`],
        { encoding: 'utf8', timeout: 30_000 },
    )
}

const buzzUp = (): boolean => {
    try {
        execFileSync('curl', ['-sf', '-m', '2', '-H', 'Accept: application/nostr+json', `http://localhost:${BUZZ_PORT}`])
        return true
    } catch {
        return false
    }
}

test.describe('Suche: kein Treffer aus einem fremden Space', () => {
    test.skip(process.env.E2E_RELAY === 'buzz', 'braucht den zooid-Modus als Basis (Hybrid, wie workspaces.spec.ts)')

    /**
     * `#h` ist je Relay vergeben, nicht global eindeutig. Ein `repository.query`-basierter
     * Ansatz (der ursprüngliche Plan-Vorschlag) filtert NICHT nach Relay-Herkunft und
     * fiele hier in denselben Topf — `deriveRoomMessages` (über `deriveEventsForUrl`)
     * muss es. Erzwungen wird die Kollision, indem ein zooid-Raum GENAU dieselbe `h`-UUID
     * trägt wie der bereits laufende Buzz-Seed-Raum `welcome` — beide landen im selben,
     * globalen welshman-`repository`, sobald der Client beide Spaces in DERSELBEN
     * Sitzung besucht (kein Reload dazwischen).
     */
    test('Zooid-Raum und Buzz-Raum mit identischer h-UUID zeigen nur ihre eigenen Treffer', async ({ page }) => {
        test.setTimeout(90_000)
        if (!buzzUp()) {
            test.skip(true, `kein Buzz-Test-Stack auf :${BUZZ_PORT} — bash tests/e2e/support/buzz-testserver.sh`)
        }
        joinBuzzRelay()

        // Buzz' Seed-Channel `welcome` (feste UUIDv5, siehe support/buzz.ts) — ihre h wird
        // 1:1 als h eines FRISCHEN zooid-Raums wiederverwendet. zooid akzeptiert jeden
        // String als h (kein UUID-Zwang wie bei Buzz), also kann derselbe Wert dort einen
        // eigenen, unabhängigen Raum tragen — die Kollision ist beabsichtigt.
        const h = trackRoom(BUZZ_ROOM_WELCOME)
        createRoomNak(h, 'ZooidTwin')

        const zMarker = `ZOnly-${rnd()}`
        publishRaw(h, ADMIN, zMarker)

        const bMarker = `BOnly-${rnd()}`
        execFileSync(NAK, ['event', '--auth', '--sec', BUZZ_USER_NSEC, '-k', '9', '-t', `h=${h}`, '-c', bMarker, `ws://localhost:${BUZZ_PORT}`], {
            encoding: 'utf8',
            timeout: 20_000,
        })

        // 1) zooid-Raum besuchen — der zooid-Marker landet im Repository, an die
        // zooid-URL getrackt.
        await useZooid(page)
        await page.addInitScript((url) => {
            ;(window as unknown as { __nostrWorkspace: string }).__nostrWorkspace = url
        }, BUZZ_URL)
        await loginNsec(page, NSEC)
        await page.goto(`/rooms/${h}`)
        await expect(page.getByText(zMarker, { exact: false })).toBeVisible({ timeout: 20_000 })

        // 2) OHNE Reload in denselben Raum-Pfad, aber als WORKSPACE (Buzz) — derselbe
        // String-`h`, ein ANDERES Relay. `page.goto()` wäre hier FALSCH: es ist eine
        // echte Browser-Navigation (CDP `Page.navigate`) und reißt den kompletten JS-
        // Zustand samt welshman-`repository` neu auf — der zooid-Marker wäre dann NIE
        // wirklich noch resident gewesen, und der Test hätte nur bewiesen, dass ein
        // Reload hilft, nicht dass die URL-Bindung greift (genau die Falle, vor der die
        // Mutationsprobe warnt). `Livewire.navigate` ist die ECHTE In-App-Navigation
        // (dieselbe, die ein Klick auf die Workspace-Kachel auslöst) und lässt den JS-
        // Kontext unangetastet.
        await page.evaluate((url) => {
            ;(window as unknown as { Livewire: { navigate: (u: string) => void } }).Livewire.navigate(url)
        }, `/rooms/${h}?space=workspace`)
        await page.waitForURL(/space=workspace/)
        await expect(page.getByText(bMarker, { exact: false })).toBeVisible({ timeout: 20_000 })

        const { openButton, input } = searchLocators(page)
        await openButton.click()

        // Suche nach dem BUZZ-Marker im jetzt aktiven Buzz-Raum: ein Treffer.
        await input.fill(bMarker)
        await expect(page.locator('#room-search-panel li button', { hasText: bMarker })).toHaveCount(1)

        // Suche nach dem ZOOID-Marker, WÄHREND der Buzz-Raum aktiv ist: das Event liegt
        // nachweislich im (globalen) Repository — aber KEIN Treffer, weil
        // deriveRoomMessages an die Buzz-URL gebunden ist.
        await input.fill(zMarker)
        await expect(page.locator('#room-search-panel')).toContainText('0 Treffer')
        await expect(page.locator('#room-search-panel li button', { hasText: zMarker })).toHaveCount(0)
    })
})

// ── 5) "Volltextsuche" kommt in der RAUM-LOKALEN Suche nirgends vor ─────────────────

test('"Volltextsuche" kommt in UI, Code und Commits von P6a nicht vor (per Grep belegt)', () => {
    // Prozess-cwd beim Testlauf ist die Host-Wurzel (`npm run test:e2e` läuft von dort;
    // Beleg: `command-palette.spec.ts` liest `packages/einundzwanzig-group/js/rail.ts`
    // mit demselben relativen Pfad).
    const PKG = 'packages/einundzwanzig-group'

    const grepQuiet = (args: string[]): string => {
        try {
            return execFileSync('grep', args, { encoding: 'utf8' })
        } catch (error) {
            const err = error as { status?: number }
            if (err.status === 1) {
                return '' // grep: kein Treffer — das IST das erwartete Ergebnis
            }
            throw error
        }
    }

    // P6a (diese Datei) prüft die RAUM-LOKALE Suche (js/search.ts, js/roomSearch.ts,
    // #room-search-panel in ⚡room.blade.php) — für SIE bleibt "Volltextsuche" verboten,
    // weil sie genau das nicht ist (p1-suche.md: nur `LIKE`-Teilstring über bereits
    // geladenes `repository`, kein Tokenizing, kein Relay-Request).
    //
    // Ausgenommen sind drei Dateien der SPÄTEREN, eigenständigen und vom `reviewer`
    // abgenommenen Workspace-Suche (Commit 0b0f94a, "P5 — relay-seitige Volltextsuche
    // über den Workspace (NIP-50)"): dort IST es eine echte relay-seitige Suche, auf
    // Buzz beschränkt und in `space-search-results.blade.php:48` korrekt als das
    // benannt, was sie NICHT kann ("Dieser Workspace beantwortet keine Volltextsuche"
    // für Nicht-Buzz-Spaces) — exakt die Empfehlung aus `p1-suche.md`: "Wird eine
    // serverseitige Suche gewollt, muss der Plan sie auf Buzz-Räume beschränken … und
    // die Semantik als das benennen, was sie ist." Eine vierte Datei, die das Wort neu
    // einführt, bleibt weiterhin rot.
    const uiAndCodeHits = grepQuiet([
        '-rniI',
        '--exclude=space-search-results.blade.php',
        '--exclude=spaceSearch.ts',
        '--exclude=paletteItems.ts',
        'Volltextsuche',
        `${PKG}/resources/`,
        `${PKG}/js/`,
    ])
    expect(uiAndCodeHits, `„Volltextsuche" darf außerhalb der Workspace-NIP-50-Suche nicht vorkommen, gefunden:\n${uiAndCodeHits}`).toBe('')

    const commitHits = execFileSync('git', ['log', '--oneline', '-i', '--grep=Volltextsuche'], { encoding: 'utf8', cwd: PKG }).trim()
    expect(commitHits, `„Volltextsuche" darf in keiner Commit-Nachricht des Package vorkommen, gefunden:\n${commitHits}`).toBe('')
})

// ── 6) aria-expanded spiegelt den Zustand — auch nach Escape und ✕ ──────────────────

test('Suche: aria-expanded am Kopf-Knopf folgt dem echten Zustand, auch nach Escape und ✕', async ({ page }) => {
    const h = trackRoom(`search6${rnd()}`)
    createRoomNak(h, 'Search6')
    const marker = `S6-${rnd()}`
    publishRaw(h, ADMIN, `${marker} Zeile`)

    await openRoom(page, h)
    await expect(page.getByText(marker, { exact: false })).toBeVisible({ timeout: 15_000 })

    const { openButton, input, closeButton } = searchLocators(page)
    await expect(openButton).toHaveAttribute('aria-expanded', 'false')

    await openButton.click()
    await expect(openButton).toHaveAttribute('aria-expanded', 'true')
    await expect(input).toBeFocused()

    // Escape schließt — der Listener sitzt auf der Fläche selbst, der Fokus liegt im
    // fokussierten Input, das Ereignis bubbelt hoch.
    await page.keyboard.press('Escape')
    await expect(openButton).toHaveAttribute('aria-expanded', 'false')

    await openButton.click()
    await expect(openButton).toHaveAttribute('aria-expanded', 'true')

    await closeButton.click()
    await expect(openButton).toHaveAttribute('aria-expanded', 'false')
})
