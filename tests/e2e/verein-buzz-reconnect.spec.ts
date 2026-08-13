import { test, expect } from './support/fixtures'
import { useZooid } from './support/zooid'
import { loginNsec } from './support/login'
import { generateSecretKey } from 'nostr-tools/pure'
import { nsecEncode } from 'nostr-tools/nip19'
import { routeVerein, stubDeadSpace, stubVereinDocument, vereinConfigBody, vereinMeBody } from './support/verein'
import { startFakeBuzzRelay } from './support/buzz-relay'

/**
 * P5 Punkt 1 — `RECONNECT_MIN_GAP_MS` (`js/verein.ts`, `_reconnectDirectory`) galt
 * laut Autor als ungetestet, weil eine Messung einen Buzz-Relay in der E2E-Fläche
 * bräuchte. Das stimmt für den ECHTEN Buzz-Stack (Rust-Prozess, NIP-42-AUTH,
 * Moderation) — für die Deckelung selbst genügt ein Relay, das sich nur als Buzz
 * AUSGIBT (`support/buzz-relay.ts`: NIP-11 `software: block/buzz`, sonst leer).
 *
 * Beobachtet wird die REALE Wirkung (`Pool.remove()` + Neuaufbau des Sockets) über
 * die WebSocket-Verbindungen zum Fake-Relay selbst — server-seitig gezählt, nicht
 * über eine aus `verein.ts` herausgelöste Kopie der Zeitrechnung. Das deckt die
 * eigentliche Regressionsgefahr ab: dass jemand `Pool.get().remove(url)` streicht
 * oder die Sperre falsch herum vergleicht. Die reine Millisekunden-Arithmetik hat
 * daneben ihre eigene, aktive Kalibrierung: `reconnectGap.test.ts`.
 *
 * `_reconnectDirectory()` wird direkt über Alpines `$data`-Introspektion
 * aufgerufen (gleiche Technik wie `room.spec.ts`s `_hiddenAt`-Manipulation) — das
 * erspart den kompletten Nachfass-Plan samt Fake-Clock-Choreografie und macht den
 * Test auf die eine Zusicherung scharf, um die es geht: die Mindestpause.
 *
 * ── Der Bug, an dem dieser Test zuerst hing (behoben, hier als Gedächtnis) ────
 * Beim Bau war der Test sofort ROT — nicht an der Mindestpause, sondern schon beim
 * ERSTEN Abriss: `_reconnectDirectory()` warf `TypeError: f is not a function`,
 * bevor die Sperre überhaupt zum Zug kam.
 *
 * Ursache lag NICHT hier, sondern in `packages/einundzwanzig-group/js/authHold.ts`:
 * `socketPolicyAuthHold` gab `s.on(SocketEvent.Sending, cb)` als Abmelder zurück.
 * `Socket extends EventEmitter`, und `EventEmitter.prototype.on` liefert `this` zum
 * Verketten — welshman rief also beim Aufräumen (`socket.js:114`
 * `unsubscribers.forEach(call)`, `call = f => f()`) das Socket-OBJEKT als Funktion
 * auf. `core.ts` hängt die Policy an welshmans geteiltes `defaultSocketPolicies`,
 * es traf damit JEDE Socket, nicht nur Buzz und nicht erst beim zweiten Abriss.
 * Weil der Wurf VOR `this._data.delete(url)` in `Pool.remove()` liegt, blieb der
 * tote Socket zusätzlich in der Registry stehen.
 *
 * Behoben durch welshmans eigenen `on()`-Helfer aus `@welshman/lib` (`() =>
 * target.off(...)`) — dieselbe Konstruktion, die `socketPolicyPing` und
 * `socketPolicyAuthBuffer` in `policy.js` benutzen. Der Vertrag hat seither eine
 * eigene, aktive Kalibrierung an der echten welshman-Socket:
 * `packages/einundzwanzig-group/js/authHold.test.ts`. Dieser E2E-Test ist der
 * Beleg, dass der Reconnect als Ganzes wieder trägt.
 */
test(
    'Buzz-Reconnect: RECONNECT_MIN_GAP_MS deckelt Socket-Abrisse, hebt sie nach Ablauf aber wieder auf',
    async ({ page }) => {
        const nsec = nsecEncode(generateSecretKey())
        const relay = await startFakeBuzzRelay()

        try {
            await stubVereinDocument(page)
            await useZooid(page)
            // NACH useZooid registriert (Reihenfolge zählt, siehe `stubDeadSpace`):
            // der aktive Space zeigt auf UNSER Fake-Buzz-Relay statt auf den echten
            // lokalen zooid — derselbe Kniff wie im Lesefehler-Test, nur mit einem
            // Relay, das tatsächlich antwortet statt tot zu sein.
            await stubDeadSpace(page, relay.url)
            await loginNsec(page, nsec)

            await routeVerein(page, {
                config: () => ({ status: 200, body: vereinConfigBody() }),
                me: () => ({ status: 200, body: vereinMeBody() }),
            })

            await page.goto('/verein/beitritt')
            await expect(page.getByTestId('verein-flow')).toBeVisible({ timeout: 15_000 })

            // Die Insel abonniert `_watchDirectory` beim Mount — Baseline erst NACH
            // dem Laden nehmen, damit spätere Zählungen relativ dazu stimmen, egal
            // wie viele Verbindungen der Seitenaufbau selbst schon geöffnet hat.
            await expect.poll(() => relay.connectionCount(), { timeout: 15_000 }).toBeGreaterThanOrEqual(1)
            const baseline = relay.connectionCount()

            const reconnect = () =>
                page.evaluate(async () => {
                    const el = document.querySelector('[data-testid="verein-flow"]') as Element
                    const d = (
                        window as unknown as {
                            Alpine: { $data: (e: Element) => { _reconnectDirectory: () => Promise<void> } }
                        }
                    ).Alpine.$data(el)
                    await d._reconnectDirectory()
                })

            const rewindLastReconnect = (ms: number) =>
                page.evaluate((delta) => {
                    const el = document.querySelector('[data-testid="verein-flow"]') as Element
                    const d = (window as unknown as { Alpine: { $data: (e: Element) => { _lastReconnectAt: number } } }).Alpine.$data(el)
                    d._lastReconnectAt = Date.now() - delta
                }, ms)

            // Erster Abriss: `_lastReconnectAt` steht noch auf 0 (nie zuvor
            // abgerissen) → die Sperre greift nicht, ein neuer Socket entsteht.
            await reconnect()
            await expect.poll(() => relay.connectionCount(), { timeout: 5_000 }).toBe(baseline + 1)

            // Zweiter Abriss, SOFORT danach: innerhalb der 60s-Sperre → KEIN neuer
            // Socket. Eine kurze reale Karenz statt eines Timeouts von Null, damit
            // ein fälschlich sofort feuernder zweiter Abriss auch wirklich Zeit hätte.
            await reconnect()
            await page.waitForTimeout(300)
            expect(relay.connectionCount(), 'die Mindestpause hat den zweiten Abriss verhindert').toBe(baseline + 1)

            // `_lastReconnectAt` künstlich 61 s zurückdrehen (derselbe Kniff wie
            // `room.spec.ts`s `_hiddenAt`-Manipulation) — simuliert den Ablauf der
            // Sperre, ohne 61 echte Sekunden zu warten.
            await rewindLastReconnect(61_000)
            await reconnect()
            await expect.poll(() => relay.connectionCount(), { timeout: 5_000 }).toBe(baseline + 2)
        } finally {
            await relay.close()
        }
    },
)
