import { test, expect } from './support/fixtures'
import { useBuzz, BUZZ_URL, BUZZ_PORT, BUZZ_USER_NSEC, BUZZ_USER_PUB, BUZZ_OWNER_NSEC, BUZZ_OWNER_SEC_HEX, BUZZ_ROOM_WELCOME } from './support/buzz'
import { npubEncode } from 'nostr-tools/nip19'
import { loginNsec } from './support/login'
import { spawnSync } from 'node:child_process'
import type { TrustedEvent } from '@welshman/util'
import { memoedToChatMessage, evictChatMsgCache, type ChatBuildCtx } from '../../packages/einundzwanzig-group/js/feeds'
import type { UserStatus } from '../../packages/einundzwanzig-group/js/userStatus'

/**
 * P2 des Buzz-Workspace-Plans — NIP-38-Status (kind 30315, `d=general`) lesen.
 *
 * Die Datei trägt den `buzz-`-Namen, weil die Regex in `playwright.config.ts:57`
 * (`/(?:buzz-.*|pin-room)\.spec\.ts$/`) im Buzz-Modus alles andere LAUTLOS überspringt
 * — „Total: 0 tests" ohne Fehlermeldung. Der Logik-Teil unten läuft trotzdem in BEIDEN
 * Modi (kein `skip`): er braucht keinen Relay, und der Cache-Schlüssel der Chat-Zeile
 * ist keine Buzz-Eigenheit.
 */

const NAK = process.env.NAK ?? `${process.env.HOME}/go/bin/nak`
const WS = () => `ws://localhost:${BUZZ_PORT}`

// ─────────────────────────────────────────────────────────────────────────────
// Teil 1 — der Cache-Schlüssel. Kein Browser, kein Relay, kein Modus-Gate.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **Der Fehler, den dieser Teil verhindert, ist stumm.**
 *
 * Die Chat-Zeile ist je `event.id` gemerkt (`feeds.ts memoedToChatMessage`). Der Status
 * des Autors trifft praktisch immer NACH der Nachricht ein (eigener REQ, eigene
 * Debounce-Stufe) — steht er nicht im Schlüssel, liefert der Cache für immer die
 * status-lose Fassung. Nichts wird rot, nichts wird geloggt, die Spalte bleibt einfach
 * leer. Derselbe Fehler hat hier schon einmal den ⚡-Chip gekostet
 * (`zap-tally-memo-logic.spec.ts`), nur mit dem Zapper statt dem Status.
 *
 * Der zweite Test ist die Gegenrichtung und mindestens so wichtig: ein Schlüssel, der
 * IMMER bustet, ist genauso kaputt — er macht die Memoisierung des ganzen Raums
 * wertlos, und zwar unsichtbar (nur langsamer). Genau das passierte bei einem
 * Referenzvergleich, weil `foldUserStatuses` die Tabelle bei jedem Emit neu baut.
 */
const AUTHOR = 'cc'.repeat(32)
const EVENT: TrustedEvent = { id: 'status-msg-1', kind: 9, pubkey: AUTHOR, created_at: 1000, content: '', sig: '', tags: [] } as TrustedEvent

const makeCtx = (statuses: Map<string, UserStatus>): ChatBuildCtx => ({
    me: null,
    $profiles: new Map(),
    $handles: new Map() as ChatBuildCtx['$handles'],
    $zappers: new Map(),
    $statuses: statuses,
    byId: new Map([[EVENT.id, EVENT]]),
    refEvents: new Map(),
    h: 'room',
    search: '',
    cards: false,
    commentsByRoot: new Map(),
    reactionsByTarget: new Map(),
    pollResponsesByTarget: new Map(),
    zapsByTarget: new Map(),
})

test.describe('memoedToChatMessage — der NIP-38-Status bustet den Zeilen-Cache', () => {
    test('Status trifft NACH der Nachricht ein: die Zeile baut neu, statt den Treffer ohne Status zu liefern', () => {
        evictChatMsgCache([EVENT.id])

        // 1. Emit: Nachricht da, Status noch nicht geladen → null, wird gecacht.
        const before = memoedToChatMessage(EVENT, makeCtx(new Map()))
        expect(before.status).toBeNull()

        // 2. Emit: Status aufgelöst → MUSS neu bauen.
        const after = memoedToChatMessage(EVENT, makeCtx(new Map([[AUTHOR, { text: 'im Meeting', emoji: '🎧', updatedAt: 20 }]])))
        expect(after.status?.text).toBe('im Meeting')
        expect(after.status?.emoji).toBe('🎧')

        // 3. Emit: Status geändert, GLEICHE Sekunde (Buzz publiziert sekundengenau) →
        //    ein Schlüssel aus `updatedAt` allein bliebe hier stehen.
        const changed = memoedToChatMessage(EVENT, makeCtx(new Map([[AUTHOR, { text: 'Feierabend', emoji: '🎧', updatedAt: 20 }]])))
        expect(changed.status?.text).toBe('Feierabend')

        // 4. Emit: Status gelöscht (leeres 30315) → die Zeile verliert ihn wieder.
        const cleared = memoedToChatMessage(EVENT, makeCtx(new Map()))
        expect(cleared.status).toBeNull()
    })

    test('unveränderter Status trifft den Cache — sonst wäre die Memoisierung des Raums wertlos', () => {
        evictChatMsgCache([EVENT.id])

        // Zwei Emits mit GLEICHEM Inhalt, aber — wie in der Fläche — verschiedenen
        // Objekten: `foldUserStatuses` baut die Tabelle bei jedem Emit neu.
        const first = memoedToChatMessage(EVENT, makeCtx(new Map([[AUTHOR, { text: 'im Meeting', emoji: '', updatedAt: 20 }]])))
        const second = memoedToChatMessage(EVENT, makeCtx(new Map([[AUTHOR, { text: 'im Meeting', emoji: '', updatedAt: 20 }]])))

        expect(second).toBe(first) // dieselbe Instanz = Cache-Treffer, kein Neubau
    })
})

// ─────────────────────────────────────────────────────────────────────────────
// Teil 2 — die Fläche gegen den echten Relay, mit angehaltenem NIP-11.
// ─────────────────────────────────────────────────────────────────────────────

/** Wanduhr-Sekunde des letzten Publishs — siehe {@link publishStatus}. */
let lastPublishSecond = 0

/**
 * Ein 30315 (`d=general`) im Namen des Owners publizieren. Gibt die nak-Ausgabe zurück.
 *
 * ── Warum hier auf die nächste Sekunde gewartet wird ───────────────────────────
 *
 * Zwei ersetzbare Events mit **identischem `created_at`** entscheidet NIP-01 über die
 * kleinere `id` — also faktisch per Münzwurf. Am laufenden Testrelay nachgemessen
 * (2026-08-16): zwei 30315 in derselben Sekunde, beide mit `OK true` quittiert,
 * gespeichert wurde das mit der kleineren Id; das andere ist spurlos verschwunden.
 * `OK true` heißt bei einem ersetzbaren Event also **nicht** „ab jetzt gilt meins".
 *
 * Ohne diese Sperre war der Test genau in einem von vier Läufen rot — und zwar mit
 * einem Befund, der wie ein Produktfehler aussah („Status verschwindet nicht"),
 * während in Wahrheit der Relay den Löschbefehl nie behalten hat. Sekundengrenze
 * abwarten kostet je Publish ≤ 1 s und macht die Aussage eindeutig.
 */
function publishStatus(sec: string, content: string, emoji?: string): string {
    while (Math.floor(Date.now() / 1000) <= lastPublishSecond) {
        spawnSync('sleep', ['0.2'])
    }
    lastPublishSecond = Math.floor(Date.now() / 1000)
    const args = ['event', '--auth', '--sec', sec, '-k', '30315', '-t', 'd=general']
    if (emoji) {
        args.push('-t', `emoji=${emoji}`)
    }
    args.push('-c', content, WS())
    const res = spawnSync(NAK, args, { encoding: 'utf8', timeout: 30_000 })
    return `${res.stdout ?? ''}\n${res.stderr ?? ''}`
}

test.describe('Buzz-Workspace: NIP-38-Status (E2E, nur E2E_RELAY=buzz)', () => {
    test.skip(process.env.E2E_RELAY !== 'buzz', 'nur im Buzz-Modus (E2E_RELAY=buzz) relevant')

    test.afterAll(() => {
        // **Aufräumen heißt hier ERSETZEN, nicht löschen.** kind 30315 ist adressierbar
        // (ein Event je Autor und `d`); ein leerer `content` ohne `emoji` ist laut NIP-38
        // genau das Signal „Status gelöscht" und die einzige Form, die ein Client wieder
        // wegnehmen kann. Der Bloat-Guard in `buzz-testserver.sh` zählt nur kind-39000 und
        // sähe einen Rest hier nicht.
        publishStatus(BUZZ_OWNER_SEC_HEX, '')
        publishStatus(BUZZ_USER_NSEC, '')
    })

    test('Statusanzeige wartet auf NIP-11, entscheidet nichts — und zieht danach live nach', async ({ page }) => {
        // ── Der Workspace IST hier der Testrelay ────────────────────────────────
        // `useBuzz` schaltet den zweiten Space bewusst AUS (sonst spräche der Lauf das
        // Produktions-Buzz an). Der Status-Arm hängt aber genau an dieser Konfiguration
        // (`userStatus.ts isStatusRelay`), also wird sie hier — nach `useBuzz`, damit die
        // spätere Zuweisung gewinnt — auf denselben lokalen Relay gesetzt. Kein
        // Produktions-Relay im Spiel: derselbe `ws://localhost:<slot-port>`.
        await useBuzz(page)
        await page.addInitScript((url) => {
            ;(window as unknown as { __nostrWorkspace: string }).__nostrWorkspace = url
        }, BUZZ_URL)

        // ── Das NIP-11-Dokument anhalten ────────────────────────────────────────
        // Der Plan sagt „~2 s verzögern". Ein fester Timer macht daraus ein Rennen: ob
        // der Platzhalter noch steht, wenn die Prüfung greift, hängt an der Ladezeit des
        // Raums. Hier hält stattdessen ein Tor die Antwort, bis der Test sie freigibt —
        // die tatsächliche Verzögerung liegt in derselben Größenordnung, die AUSSAGE ist
        // aber deterministisch: „solange das Dokument fehlt, behauptet die Fläche nichts".
        // Nur HTTP: `page.route` fasst WebSockets nicht an, der Chat lädt normal weiter.
        let releaseInfoDoc = (): void => {}
        const infoDocHeld = new Promise<void>((resolve) => {
            releaseInfoDoc = resolve
        })
        await page.route(new RegExp(`^http://localhost:${BUZZ_PORT}/`), async (route) => {
            await infoDocHeld
            await route.continue()
        })

        // Bestand: ein Status des OWNERS (nicht des eingeloggten Nutzers) — er ist Autor
        // der zweiten Seed-Nachricht im Welcome-Raum.
        expect(publishStatus(BUZZ_OWNER_SEC_HEX, 'E2E-Status: im Meeting', '🎧')).toContain('success')

        await loginNsec(page, BUZZ_USER_NSEC)
        await page.goto(`/rooms/${BUZZ_ROOM_WELCOME}`)

        // Der Verlauf steht OHNE NIP-11 — sonst prüfte der Rest nur, ob die Seite lädt.
        const ownerRow = page.locator('.chat-row').filter({ hasText: 'Antwort vom Owner' })
        await expect(ownerRow).toBeVisible({ timeout: 30_000 })

        // Zustand 1: unbekannt. Platzhalter da, Status NICHT da. Genau diese Trennung ist
        // der Ertrag von P1 — ein zweiwertiges Gating zeigte hier „kein Status".
        await expect(ownerRow.locator('[data-status-skeleton]')).toBeVisible({ timeout: 10_000 })
        await expect(ownerRow.locator('[data-user-status]')).toHaveCount(0)

        // Zustand 2: NIP-11 da ⇒ Buzz ⇒ Status wird geladen und angezeigt.
        releaseInfoDoc()
        await expect(ownerRow.locator('[data-status-skeleton]')).toHaveCount(0, { timeout: 30_000 })
        await expect(ownerRow.locator('[data-user-status]')).toHaveText('E2E-Status: im Meeting', { timeout: 30_000 })
        // Das Emoji sitzt als Plakette am Avatar, nicht im Text (nostr-avatar.blade.php).
        await expect(ownerRow.locator('[data-status-emoji]')).toHaveText('🎧')

        // ── Der Nachweis für den Cache-Schlüssel an der echten Fläche ───────────
        // Ein Statuswechsel am Relay, ohne Reload: die Zeile ist zu diesem Zeitpunkt
        // längst gebaut und gemerkt. Ohne den Status im Fingerabdruck liefert der Cache
        // hier für immer den alten Text — stumm, ohne Fehler.
        expect(publishStatus(BUZZ_OWNER_SEC_HEX, 'E2E-Status: Feierabend', '🌙')).toContain('success')
        await expect(ownerRow.locator('[data-user-status]')).toHaveText('E2E-Status: Feierabend', { timeout: 30_000 })
        await expect(ownerRow.locator('[data-status-emoji]')).toHaveText('🌙')

        // ── Und die Gegenrichtung: leer heißt gelöscht (NIP-38), nicht unverändert ──
        expect(publishStatus(BUZZ_OWNER_SEC_HEX, '')).toContain('success')
        await expect(ownerRow.locator('[data-user-status]')).toHaveCount(0, { timeout: 30_000 })
    })

    test('Directory-Zeile und Profilkarte tragen denselben Status — vier Anzeigeorte, eine Quelle', async ({ page }) => {
        await useBuzz(page)
        await page.addInitScript((url) => {
            ;(window as unknown as { __nostrWorkspace: string }).__nostrWorkspace = url
        }, BUZZ_URL)

        // Der Status gehört dem geseedeten MITGLIED (es steht sicher in der
        // relay-signierten 13534); angesehen wird er als Owner — also ein fremder
        // Status, nicht der eigene.
        expect(publishStatus(BUZZ_USER_NSEC, 'E2E-Status: auf dem Berg', '⛰️')).toContain('success')

        await loginNsec(page, BUZZ_OWNER_NSEC)
        await page.goto('/directory')

        // Zeile über die npub-Kurzform finden — sie steht unabhängig vom Status in der
        // Zeile, taugt also als Anker, ohne die Frage vorwegzunehmen.
        const npubPrefix = npubEncode(BUZZ_USER_PUB).slice(0, 12)
        const memberRow = page.locator('[x-data="nostrDirectory"] .surface-card').filter({ hasText: npubPrefix })
        await expect(memberRow).toBeVisible({ timeout: 30_000 })

        // Anzeigeort 3: die Directory-Zeile (Text + Plakette am Avatar).
        await expect(memberRow.locator('[data-user-status]')).toContainText('E2E-Status: auf dem Berg', { timeout: 30_000 })
        await expect(memberRow.locator('[data-status-emoji]')).toHaveText('⛰️')

        // Anzeigeort 4: die Profilkarte — die einzige Fläche, die Emoji UND vollen Text
        // als lesbaren Text zeigt (Chat kürzt, Plakette ist `aria-hidden`).
        await memberRow.getByRole('button', { name: 'Profil anzeigen' }).click()
        const card = page.locator('[x-data="nostrProfileCard"]')
        await expect(card.locator('[data-user-status]')).toContainText('E2E-Status: auf dem Berg', { timeout: 30_000 })
        await expect(card.locator('[data-status-emoji]')).toHaveText('⛰️')
    })
})
