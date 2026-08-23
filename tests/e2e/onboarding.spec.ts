import { test, expect, type Page } from './support/fixtures'
import type { BrowserContext } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { generateSecretKey } from 'nostr-tools'
import { neventEncode, nsecEncode } from 'nostr-tools/nip19'
import { useZooid, ZOOID_WS } from './support/zooid'
import { loginNsec } from './support/login'
import { cleanupRooms, trackRoom } from './support/rooms'
import { publishVerified } from './support/publishVerified'

/**
 * Gast auf einem Raum-Link (P4, vorher P3.2/P3.3) — Playwright, weil hier echtes
 * Client-Verhalten geprüft wird (Signer-Zustand im localStorage über einen HARTEN
 * Reload, Login-Sheet in-place, `pendingReturn`, Alpine-Store). Das statische
 * Markup deckt `tests/Feature/EmptyStatesAndA11yTest.php` ab.
 *
 * ── Was P4 an dieser Stelle geändert hat ──────────────────────────────────────
 *
 * Bis P4 sah ein Gast hier „Du liest mit. Zum Mitschreiben anmelden." plus einen
 * feld-förmigen Gast-Composer über 18 Skeleton-Zeilen. Die Prämisse dieser Fläche
 * ist gemessen falsch: ein Gast liest NICHT mit. Ohne Signer gibt es kein
 * NIP-42-AUTH, ohne AUTH beantwortet der Relay JEDEN REQ mit
 * `CLOSED auth-required` — kein Event, kein EOSE (gemessen 2026-08-15 gegen die
 * lokale Instanz UND beide Prod-Relays; der AUTH-Riegel steht in zooid VOR der
 * `public_read`-Prüfung, ist also von der Konfiguration unabhängig. Rohausgabe und
 * Herleitung: `docs/plans/2026-08-11T1321-restposten-aus-ux-plan/p4-messung.md`).
 *
 * NICHT übernommen wird der Zusatz „…, `loading` löst sich für ihn nie auf": am
 * laufenden Client kippt `loading` nach ~3,5 s trotzdem auf `false` (eigene Sonde,
 * 2026-08-15, p4-messung.md Abschnitt 20). Für die Fläche hier ändert das nichts
 * — der Verlauf bleibt leer —, wohl aber für die Leerzustands-Karte; die hängt in
 * `tests/e2e/a11y-focus-order.spec.ts` und trägt den Fund.
 *
 * An ihrer Stelle steht `verein-gate` mit seinem GAST-Zweig: „Nur für Mitglieder /
 * Dieser Bereich ist Mitgliedern vorbehalten." plus „Anmelden" über `requireAuth`.
 * Bewusst NICHT „Du bist kein Mitglied": vom Gast wissen wir das nicht — er kann
 * Vereinsmitglied und nur nicht angemeldet sein.
 *
 * Die fünf Tests dieser Datei sind deshalb NICHT gelöscht, sondern auf die Aussage
 * umgeschrieben, die jetzt an ihrer Stelle gilt (1:1-Zuordnung):
 *
 *   alt „Einstiegszeile erscheint für Gäste, fehlt fürs Mitglied"
 *     → Gast sieht die Mitglieder-Aussage statt einer leeren Bühne mit Composer;
 *       das Mitglied sieht seinen Chat und KEIN Gate.
 *   alt „Schließen überlebt harten Reload — Kontrastprobe"
 *     → dieselbe BAUART auf die neue Fläche: der Zustand hängt am Client-Signer
 *       (localStorage), nicht an der Server-Session, überlebt einen harten Reload,
 *       und die Kontrastprobe (Signer zurück ⇒ Fläche weg) zeigt, dass er wirklich
 *       an diesem Schlüssel hängt. Der `e21:guest-hint`-Schlüssel selbst ist mit
 *       der Einstiegszeile entfallen.
 *   alt „Gast-Composer in Raum UND Thread, Klick öffnet Login-Sheet"
 *     → beide Landeplätze zeigen dieselbe Aussage, der Knopf öffnet dasselbe Sheet.
 *   alt „pendingReturn: Login aus dem Sheet führt zurück in denselben Raum"
 *     → unverändert in der Aussage, nur über den Gate-Knopf ausgelöst. Diese
 *       Zusage ist die einzige Eigenschaft der alten Fläche, die den Rückbau
 *       überlebt hat — deshalb hängt sie am `requireAuth`-Aufruf des Gates.
 *   alt „Beitreten-Karte für angemeldete Nicht-Mitglieder, nicht für Gäste"
 *     → unverändert; nur der Gast-Zweig heißt jetzt Gate statt Gast-Composer.
 *
 * WICHTIG: Beitreten-Karte und Composer hängen an `x-show` (bleiben im DOM, nur
 * `display` wechselt) ⇒ `toBeHidden()`. Die zurückgebauten Flächen sind dagegen
 * ganz WEG ⇒ `toHaveCount(0)`; und das Gate selbst hängt an `x-if`, ist für
 * Angemeldete also gar nicht erst im DOM ⇒ ebenfalls `toHaveCount(0)`.
 */

const NSEC = process.env.NOSTR_TEST_NSEC as string
const NAK = process.env.NAK ?? `${process.env.HOME}/go/bin/nak`
const ADMIN_HEX = 'b2ee09a54bedf17ee1db562bdddd75c48661d981eb52c49dc206c55ba8439414'

function createRoomNak(h: string, name: string): void {
    trackRoom(h)
    execFileSync(NAK, ['event', '--auth', '--sec', ADMIN_HEX, '-k', '9007', '-t', `h=${h}`, ZOOID_WS])
    execFileSync(NAK, ['event', '--auth', '--sec', ADMIN_HEX, '-k', '9002', '-t', `h=${h}`, '-t', `name=${name}`, ZOOID_WS])
}

type RelayEvent = { id: string; pubkey: string; kind: number; content: string; tags: string[][]; created_at: number }

/**
 * Schreibt eine ECHTE Nachricht (kind 9) in den Raum und gibt ihre Id zurück — erst wenn
 * sie am Relay LIEGT (`publishVerified`).
 *
 * Ohne sie ist „Bühne leer" nicht von „Relay verweigert" zu unterscheiden: ein
 * frischer Raum ist für JEDEN leer. Erst die Positivkontrolle (Mitglied sieht die
 * Nachricht, Gast nicht) trägt die Aussage — und der Thread-Deep-Link braucht
 * ohnehin eine Wurzel.
 *
 * **Zweiter, unabhängiger Fund (2026-08-22):** die alte Fassung nahm ungefiltert
 * `[0].id` aus der Requery — bei einem wiederverwendeten Raum mit mehreren
 * kind-9-Zeilen war das die id IRGENDEINER Nachricht, nicht der gerade
 * geschriebenen. Kein Timing-Problem, eine falsche Antwort. Gefiltert wird jetzt
 * ausdrücklich auf `content === content`.
 */
function postRootMessage(h: string, content: string): string {
    const args = ['event', '--auth', '--sec', ADMIN_HEX, '-k', '9', '-t', `h=${h}`, '-c', content]
    const finde = (): RelayEvent | undefined =>
        execFileSync(NAK, ['req', '-k', '9', '-t', `h=${h}`, '--auth', '--sec', NSEC, ZOOID_WS])
            .toString()
            .trim()
            .split('\n')
            .filter(Boolean)
            .map((l) => JSON.parse(l) as RelayEvent)
            .find((e) => e.content === content)
    return publishVerified(NAK, args, ZOOID_WS, finde, `Wurzelnachricht in ${h}`).id
}

type SavedSigner = { pubkey: string | null; sessions: string | null }

/**
 * Entfernt den welshman-Signer aus dem localStorage und gibt ihn zum
 * Wiederherstellen zurück.
 *
 * `pubkey` UND `sessions`: der Store liest zwar nur `pubkey`
 * (`isAuthed(localStorage.getItem('pubkey'))`), aber ein Gast, der noch eine
 * Session im Speicher hat, ist kein ehrlicher Gast. Am Draht sind beide Varianten
 * identisch (fünfmal `auth-required`), im Speicher nicht.
 *
 * Die Rückgabe wird geprüft, nicht nur weitergereicht: wäre `pubkey` schon vor dem
 * Entfernen `null`, hätte der Login gar keinen Signer hinterlassen — der „Gast"
 * wäre dann ein Zufallsprodukt und jede folgende Assertion vakuös.
 */
async function stripSigner(page: Page): Promise<SavedSigner> {
    const saved = await page.evaluate(() => ({
        pubkey: localStorage.getItem('pubkey'),
        sessions: localStorage.getItem('sessions'),
    }))
    expect(saved.pubkey, 'vor dem Entfernen MUSS ein Signer da sein — sonst prüft der Gast-Zustand nichts').not.toBeNull()

    await page.evaluate(() => {
        localStorage.removeItem('pubkey')
        localStorage.removeItem('sessions')
    })

    return saved
}

/** Gegenstück zu `stripSigner` — für die Kontrastprobe. */
async function restoreSigner(page: Page, saved: SavedSigner): Promise<void> {
    await page.evaluate((s) => {
        if (s.pubkey !== null) {
            localStorage.setItem('pubkey', s.pubkey)
        }
        if (s.sessions !== null) {
            localStorage.setItem('sessions', s.sessions)
        }
    }, saved)
}

/**
 * Simuliert den client-seitigen Gast-Zustand: eine ECHTE Server-Session (das Web-
 * Gate `nostr.auth` verlangt `nostr_pubkey` in der Session), aber KEIN welshman-
 * Signer im Browser. Genau das, was `$store.authGate.authed` prüft — auf dem Gerät
 * (NativePHP, kein Server-Gate) ist das der Normalfall für jeden, der noch keine
 * Identität verbunden hat; im Web-Test ist das Entfernen des Signers nach einem
 * echten Login der kürzeste Weg dorthin, ohne die Server-Middleware anzufassen
 * (die für ALLE anderen Specs im selben Worker gilt).
 *
 * KORREKTUR 2026-08-15 (P4): der Satz, der hier stand — „das Relay lässt einen
 * signerlosen Client lesend zu (kein NIP-42-AUTH nötig für kind 9 in einem
 * nicht-privaten Raum), `loading` löst sich normal auf" — ist **falsch** und war
 * die letzte Stelle im Repo, die die widerlegte Prämisse noch behauptete (siehe
 * Dateikopf). Der hier hergestellte Zustand ist trotzdem der richtige — er ist am
 * Draht nachweislich identisch mit einem echten Gast. Nur die Begründung war es nicht.
 */
async function visitRoomAsGuest(page: Page, h: string): Promise<SavedSigner> {
    await useZooid(page)
    await loginNsec(page, NSEC)
    await page.goto(`/rooms/${h}`)
    const saved = await stripSigner(page)
    await page.reload()

    return saved
}

const guestAuthed = (page: Page) => page.evaluate(() => (window as any).Alpine?.store('authGate')?.authed)

/** Eigener Browser-Kontext (getrennte localStorage/Cookies) für einen ZWEITEN, unabhängigen Login. */
async function freshContext(ctx: BrowserContext): Promise<{ page: Page; close: () => Promise<void> }> {
    const c = await ctx.browser()!.newContext()
    const page = await c.newPage()
    return { page, close: () => c.close() }
}

// Die drei Träger der Gast-Aussage (verein-gate, Zweig `x-show="isGuest"`).
const gateHeading = (page: Page) => page.getByText('Nur für Mitglieder')
const gateSatz = (page: Page) => page.getByText('Dieser Bereich ist Mitgliedern vorbehalten.')
const gateAnmelden = (page: Page) => page.getByTestId('verein-gate-anmelden')

// Was ein Gast NICHT mehr sehen darf. Der Gast-Composer war ein Knopf mit
// sr-only-Suffix („…, anmelden erforderlich"), die Einstiegszeile reiner Text.
// Bewusst über den TEXT statt über `getByRole('button', …)`: die Rollen-Engine
// überspringt versteckte Elemente, ein per `x-show` bloß verborgener Rest-Composer
// bliebe damit unbemerkt. `getByText` zählt jedes Vorkommen im DOM.
const alterGastComposer = (page: Page) => page.getByText('anmelden erforderlich')
const alteEinstiegszeile = (page: Page) => page.getByText('Du liest mit. Zum Mitschreiben anmelden.')

test.afterAll(() => cleanupRooms(ZOOID_WS, ADMIN_HEX))

test.describe('Gast auf einem Raum-Link (P4)', () => {
    test('sieht die Mitglieder-Aussage statt einer leeren Bühne mit Composer; das Mitglied sieht seinen Chat und kein Gate', async ({
        page,
        context,
    }) => {
        test.setTimeout(60_000)
        const h = `onboard1${Date.now()}`
        createRoomNak(h, 'Onboard1')
        const marker = `positivkontrolle-${h}`
        postRootMessage(h, marker)

        await visitRoomAsGuest(page, h)
        expect(await guestAuthed(page)).toBe(false)

        // 1) Die Aussage steht da — vollständig, nicht nur die Überschrift.
        await expect(gateHeading(page)).toBeVisible({ timeout: 15_000 })
        await expect(gateSatz(page)).toBeVisible()
        await expect(gateAnmelden(page)).toBeVisible()

        // 2) Und die zurückgebaute Fläche steht NICHT mehr da. Das ist die
        //    eigentliche DoD-Forderung dieser Phase: keine leere Bühne mit
        //    Composer, kein Versprechen, das der Relay nicht einlöst.
        await expect(alteEinstiegszeile(page)).toHaveCount(0)
        await expect(alterGastComposer(page)).toHaveCount(0)
        await expect(page.getByPlaceholder('Nachricht schreiben…')).toBeHidden()

        // 3) Keine SICHTBAREN Skeletons. `.count()` auf `.skeleton` misst hier
        //    nichts: die Zeilen sind server-gerendert und hängen an `x-show`,
        //    stehen also unabhängig vom Zustand im DOM (19 Stück). Gemessen wird
        //    Sichtbarkeit.
        //
        //    GRENZE dieser Assertion, gemessen statt behauptet: sie prüft den
        //    EINGESCHWUNGENEN Zustand. Der `authed`-Guard am Skeleton wirkt nur im
        //    Fenster bis ~3,5 s (dann kippt `loading` ohnehin auf `false`) — eine
        //    Mutationsprobe „Guard entfernt" lässt diesen Test darum grün
        //    (belegt, p4-messung.md Abschnitt 20). Dass der Guard im Markup steht,
        //    sichert `tests/Feature/EmptyStatesAndA11yTest.php` ab; dort beißt die
        //    Mutation.
        await expect(page.locator('.skeleton:visible')).toHaveCount(0)

        // 4) Der Gast sieht die vorhandene Nachricht NICHT — das ist der Grund
        //    für den ganzen Rückbau und nicht bloß ein Nebenbefund.
        await expect(page.getByText(marker)).toHaveCount(0)

        // 5) Und die Leerzustands-Karte behauptet ihm NICHTS über den Raum.
        //    Der Raum trägt nachweislich genau eine Nachricht (Punkt 4 prüft
        //    denselben Marker) — „Noch keine Nachrichten in diesem Raum." wäre für
        //    ihn dieselbe Unwahrheit wie das zurückgebaute „Du liest mit", nur
        //    andersherum: dort stand „du liest", hier stünde „es gibt nichts".
        //
        //    ERST auf den Wendepunkt warten, dann prüfen. Die Karte hängt an
        //    `!loading`, und `loading` kippt für den Gast nach ~3,4 s auf `false`
        //    (gemessen 3401 ms: welshmans `load()` läuft in seinen 3-Sekunden-
        //    Timeout und resolved LEER, weil das `CLOSED auth-required` vom
        //    Auth-Buffer verschluckt wurde — siehe p4-messung.md 20.1). Ohne
        //    dieses Warten wäre die Assertion grün, BEVOR der Fehler überhaupt
        //    entstehen kann, und damit wertlos.
        await page.waitForFunction(
            () => {
                const el = document.querySelector('[x-data^="nostrRoomChat"]') as any
                return el?._x_dataStack?.[0]?.loading === false
            },
            undefined,
            { timeout: 20_000 },
        )
        await expect(page.getByText('Noch keine Nachrichten in diesem Raum.')).toHaveCount(0)
        await expect(page.getByText('Schreib die erste.')).toHaveCount(0)

        // Getrennter Kontext (eigene localStorage!), echtes Login (Mitglied): der
        // Chat lädt, das Gate ist nicht einmal im DOM (`x-if="! authed"`).
        const { page: page2, close } = await freshContext(context)
        await useZooid(page2)
        await loginNsec(page2, NSEC)
        await page2.goto(`/rooms/${h}`)
        await expect(page2.getByText(marker)).toBeVisible({ timeout: 15_000 })
        await expect(gateHeading(page2)).toHaveCount(0)
        await expect(alteEinstiegszeile(page2)).toHaveCount(0)
        await close()
    })

    test('Der Gast-Zustand hängt am Client-Signer, NICHT an der Server-Session: überlebt einen harten Reload — Kontrastprobe: mit dem Signer verschwindet das Gate wieder', async ({
        page,
    }) => {
        test.setTimeout(60_000)
        const h = `onboard2${Date.now()}`
        createRoomNak(h, 'Onboard2')
        const marker = `kontrastprobe-${h}`
        postRootMessage(h, marker)

        const saved = await visitRoomAsGuest(page, h)
        await expect(gateHeading(page)).toBeVisible({ timeout: 15_000 })

        // Die Server-Session lebt weiter — sonst hätte die `nostr.auth`-Middleware
        // auf /nostr-login umgeleitet. Das Gate hängt also NICHT an ihr.
        expect(page.url()).toContain(`/rooms/${h}`)

        // Harter Reload — der Zustand ist kein Einmal-Effekt des Entfernens.
        await page.reload()
        await expect(gateHeading(page)).toBeVisible({ timeout: 15_000 })
        expect(await guestAuthed(page)).toBe(false)

        // Kontrastprobe: MIT dem Signer verschwindet das Gate und der Chat lädt.
        // Ohne sie bewiese der Test nur „hier steht ein Gate", nicht „es hängt an
        // genau diesem Zustand" — dieselbe Bauart wie die localStorage-Probe der
        // alten Einstiegszeile.
        await restoreSigner(page, saved)
        await page.reload()
        expect(await guestAuthed(page)).toBe(true)
        await expect(page.getByText(marker)).toBeVisible({ timeout: 15_000 })
        await expect(gateHeading(page)).toHaveCount(0)
    })
})

test.describe('Beide Landeplätze (P4: Raum-Fuß und Thread)', () => {
    test('Raum UND Thread-Deep-Link tragen dieselbe Aussage; der Knopf öffnet das Login-Sheet mit Kontextzeile', async ({
        page,
    }) => {
        test.setTimeout(60_000)
        const h = `onboard3${Date.now()}`
        createRoomNak(h, 'Onboard3')
        const rootId = postRootMessage(h, 'Wurzel')

        await visitRoomAsGuest(page, h)

        await expect(gateAnmelden(page)).toBeVisible({ timeout: 15_000 })
        await gateAnmelden(page).click()

        // `requireAuth` dispatcht `open-login-sheet` — das Sheet montiert die
        // Login-Insel IN-PLACE, die URL bleibt stehen (Grundlage für pendingReturn).
        const sheet = page.getByRole('dialog', { name: 'Anmelden' })
        await expect(sheet).toBeVisible({ timeout: 10_000 })
        await expect(sheet.getByText('Melde dich an, um fortzufahren.')).toBeVisible()
        expect(page.url()).toContain(`/rooms/${h}`)
        await sheet.getByRole('button', { name: 'Schließen' }).click()
        await expect(sheet).toBeHidden()

        // Thread-Deep-Link (`/rooms/{h}/thread/{nevent}`) — eigener teilbarer
        // Landeplatz, derselbe Fuß. Auf DIESER Seite stehen ZWEI Gate-Instanzen im
        // DOM (Thread-Panel + Raum-Fuß, letzterer unter `xl` in einem
        // `display:none`-Vorfahren). Ein ungescoptes `getByText(...)` verstößt
        // hier gegen den Strict Mode; deshalb auf das Thread-Panel scopen
        // (`role="dialog"`, `aria-label="Thread"` unter dem xl-Breakpoint) …
        const nevent = neventEncode({ id: rootId, relays: [], kind: 9 })
        await page.goto(`/rooms/${h}/thread/${nevent}`)
        const threadPanel = page.getByRole('dialog', { name: 'Thread' })
        await expect(threadPanel.getByText('Nur für Mitglieder')).toBeVisible({ timeout: 15_000 })
        await expect(threadPanel.getByText('Dieser Bereich ist Mitgliedern vorbehalten.')).toBeVisible()

        // … und die zweite Instanz bleibt unsichtbar: genau EIN sichtbares Gate,
        // nicht zwei Karten übereinander.
        await expect(page.locator('[data-testid="verein-gate-anmelden"]:visible')).toHaveCount(1)
        await expect(alterGastComposer(page)).toHaveCount(0)
        await expect(page.locator('.skeleton:visible')).toHaveCount(0)
    })

    test('pendingReturn: Login aus dem Gate-Sheet führt zurück in denselben Raum', async ({ page }) => {
        test.setTimeout(60_000)
        const h = `onboard4${Date.now()}`
        createRoomNak(h, 'Onboard4')

        await visitRoomAsGuest(page, h)

        // Der Knopf ruft `$store.authGate.requireAuth({label})` — derselbe Weg, den
        // der zurückgebaute Gast-Composer benutzte. `requireAuth` merkt den Rückweg
        // vor (`pendingReturn` → `postLoginRedirect`); ein handgeschriebener
        // `open-login-sheet`-Dispatch verlöre das still. Genau das prüft dieser Test.
        await expect(gateAnmelden(page)).toBeVisible({ timeout: 15_000 })
        await gateAnmelden(page).click()
        const sheet = page.getByRole('dialog', { name: 'Anmelden' })
        await expect(sheet).toBeVisible({ timeout: 10_000 })

        // Login INNERHALB des Sheets (nicht über /nostr-login navigieren — das Sheet
        // mountet dieselbe login-form-Insel in-place).
        await sheet.getByRole('button', { name: 'Andere Optionen' }).click()
        await sheet.getByLabel('Ich verstehe das Risiko').check()
        await sheet.getByPlaceholder(/nsec1/).fill(NSEC)
        await sheet.getByRole('button', { name: /Trotzdem anmelden/ }).click()

        // Der Server-Handoff (NIP-98) navigiert hart — landet wieder auf DEMSELBEN
        // Raum, nicht auf /spaces (das Default-Ziel für "kein gemerktes Ziel").
        // Der Account ist frisch angemeldet, aber diesem Wegwerf-Raum noch NICHT
        // beigetreten — die Beitreten-Karte (statt des Gates) ist der Beleg, dass
        // `authGate.authed` jetzt true ist UND wir im richtigen Raum gelandet sind
        // (nicht z.B. auf /spaces).
        await page.waitForURL(`**/rooms/${h}`, { timeout: 15_000 })
        await expect(page.getByRole('button', { name: 'Beitreten' })).toBeVisible({ timeout: 15_000 })
        await expect(gateHeading(page)).toHaveCount(0)
    })
})

test.describe('Beitreten-Karte (P3.1, Raum-Fuß)', () => {
    /**
     * Unverändert in der Aussage: die Karte gehört ANGEMELDETEN Nicht-Mitgliedern
     * des Raums, ein Gast bekommt sie nie (sein `join()` würde ein kind 9021
     * signieren wollen und im Nichts enden). Nur sein Gegenstück heißt jetzt Gate
     * statt Gast-Composer.
     *
     * Nicht Gegenstand dieses Tests, aber hier notiert, damit niemand ihn dafür
     * hält: für ein angemeldetes Nicht-Mitglied des RELAYS (nicht in der 13534)
     * ist derselbe Knopf funktionslos — `join()` endet in
     * `restricted: you are not a member of this relay`. Vorbestehend, vom Rückbau
     * weder verursacht noch verschlimmert (die Gate-Einhängung ist gast-exklusiv),
     * als eigener Posten offen: p4-messung.md, Abschnitt 13.
     */
    test('sichtbar für angemeldete Nicht-Mitglieder, NICHT für Gäste (Vereins-Gate stattdessen)', async ({ page }) => {
        const h = `onboard5${Date.now()}`
        createRoomNak(h, 'Onboard5')

        // Angemeldet, nicht beigetreten.
        await useZooid(page)
        await loginNsec(page, NSEC)
        await page.goto(`/rooms/${h}`)
        await expect(page.getByRole('button', { name: 'Beitreten' })).toBeVisible({ timeout: 15_000 })
        await expect(gateHeading(page)).toHaveCount(0)
        await expect(alterGastComposer(page)).toHaveCount(0)

        // Gast: KEINE Beitreten-Karte (`x-show` ⇒ bleibt im DOM, nur verborgen),
        // stattdessen die Mitglieder-Aussage.
        await stripSigner(page)
        await page.reload()
        expect(await guestAuthed(page)).toBe(false)
        await expect(page.getByRole('button', { name: 'Beitreten' })).toBeHidden({ timeout: 10_000 })
        await expect(gateHeading(page)).toBeVisible()
        await expect(gateAnmelden(page)).toBeVisible()
    })
})

test.describe('Angemeldetes Relay-Nicht-Mitglied auf einem Raum-Link (P11)', () => {
    /**
     * Die dritte Zielgruppe nach P4: angemeldet, gültiger Signer, KEIN Mitglied
     * des Relays. Für sie nimmt der Relay das AUTH an und weist danach JEDE
     * Lese-Anfrage mit `CLOSED restricted: you are not a member of this relay`
     * ab (gemessen, p11-messung.md A1/A3 — `restricted:` erreicht den Aufrufer
     * MIT Grund, anders als `auth-required:`, das der Auth-Buffer verschluckt).
     *
     * Bis P11 zeigte die Fläche zwei Unwahrheiten: die Leerzustands-Karte
     * („Noch keine Nachrichten in diesem Raum.") über einer Bühne, deren einzige
     * echte Nachricht der Relay nie herausgab, und einen „Beitreten"-Knopf, dessen
     * `join()` nachweislich mit `restricted:` scheitert (p4-raw-join-nichtmitglied.log).
     *
     * An ihrer Stelle: das room-gate („Nur für Mitglieder" / „Dieser Bereich ist
     * Mitgliedern vorbehalten.") — bewusst dieselbe Sprache wie der Gast-Zweig
     * des verein-gate, denn aus `restricted:` folgt nur Relay-Mitgliedschaft,
     * nicht Vereinsmitgliedschaft: keine Aussage über die Person.
     */
    test('sieht das Relay-Gate statt Leerkarte und Beitreten — eingeschwungen, nicht vor dem Kippen', async ({ page }) => {
        test.setTimeout(60_000)
        const h = `onboard6${Date.now()}`
        createRoomNak(h, 'Onboard6')
        const marker = `p11-positivkontrolle-${h}`
        postRootMessage(h, marker)

        // Frischer Wegwerf-Signer — KEIN Mitglied dieses Relays (nicht NSEC!).
        await useZooid(page)
        await loginNsec(page, nsecEncode(generateSecretKey()))
        await page.goto(`/rooms/${h}`)

        // ERST auf den Wendepunkt warten: `gatedOut` wird durch das restricted-
        // CLOSED der Live-Sub gesetzt (~0,5 s nach Betreten, p11-05) und `loading`
        // kippt mit demselben CLOSE — beides Zustände, die vorher UNREICHBAR waren.
        // Ohne dieses Warten wäre jede Negativ-Assertion grün, BEVOR die Leerkarte
        // und der Knopf überhaupt entstehen könnten (P4-Vakuitätsfalle).
        await page.waitForFunction(
            () => {
                const el = document.querySelector('[x-data^="nostrRoomChat"]') as any
                const d = el?._x_dataStack?.[0]
                return d?.gatedOut === true && d?.loading === false
            },
            undefined,
            { timeout: 20_000 },
        )

        // 1) Die Ersatzfläche steht da — sichtbar, nicht nur im DOM.
        await expect(page.getByTestId('room-gate-restricted')).toBeVisible()
        await expect(page.getByText('Nur für Mitglieder')).toBeVisible()
        await expect(page.getByText('Dieser Bereich ist Mitgliedern vorbehalten.')).toBeVisible()

        // 2) Die Leerzustands-Karte ist GAR NICHT im DOM (`x-if` + `!gatedOut`):
        //    der Raum trägt genau eine echte Nachricht (Punkt 4), „Noch keine
        //    Nachrichten" wäre die Quittung der verweigerten Anfrage, keine
        //    Aussage über den Raum.
        await expect(page.getByText('Noch keine Nachrichten in diesem Raum.')).toHaveCount(0)
        await expect(page.getByText('Schreib die erste.')).toHaveCount(0)

        // 3) Kein „Beitreten", das garantiert scheitert. Raum-Fuß-Karte hängt an
        //    `x-show` (⇒ `toBeHidden`), Thread-Karte an `x-if` (⇒ nicht im DOM).
        await expect(page.getByText('Tritt dem Raum bei, um mitzuschreiben.')).toBeHidden()
        await expect(page.getByText('Tritt dem Raum bei, um zu antworten.')).toHaveCount(0)

        // 4) Positivkontrolle der Negation: die echte Nachricht ist NICHT da —
        //    ohne sie wäre „Bühne leer" nicht von „Relay verweigert" zu trennen.
        await expect(page.getByText(marker)).toHaveCount(0)

        // 5) Das verein-gate des Gastes ist nicht im Spiel (`authed` ⇒ `x-if`
        //    nie erfüllt) — der restricted-Fall hat SEINE eigene Fläche. Über die
        //    INSEL geprüft, nicht über den Text: „Nur für Mitglieder" steht auch
        //    auf dem room-gate oben (bewusst dieselbe Sprache).
        await expect(page.locator('[x-data="nostrVereinGate"]')).toHaveCount(0)
    })

    /**
     * Gegenprobe aus der DoD: ein Guard, der eine der anderen Gruppen mitnimmt,
     * tauscht einen Fehler gegen einen anderen. Mitglied (NSEC) im WIRKLICH
     * leeren Raum: die Leerkarte MUSS bleiben — sie ist dort eine wahre Aussage
     * (EOSE des Relays, kein restricted). Und der Beitreten-Knopf bleibt für
     * Angemeldete MIT Relay-Mitgliedschaft ohne Raum-Mitgliedschaft sichtbar
     * (sein Join geht durch — festgehalten auch im P3.1-Test oben).
     */
    test('Gegenprobe: MITGLIED im wirklich leeren Raum sieht die Leerkarte und den Beitreten-Knopf', async ({ page }) => {
        test.setTimeout(60_000)
        const h = `onboard7${Date.now()}`
        createRoomNak(h, 'Onboard7') // KEINE Nachricht — wirklich leer

        await useZooid(page)
        await loginNsec(page, NSEC)
        await page.goto(`/rooms/${h}`)

        // Wendepunkt: Ladevorgang abgeschlossen (EOSE), Nachrichten 0, kein Gate.
        await page.waitForFunction(
            () => {
                const el = document.querySelector('[x-data^="nostrRoomChat"]') as any
                const d = el?._x_dataStack?.[0]
                return d?.loading === false && d?.gatedOut === false
            },
            undefined,
            { timeout: 20_000 },
        )

        await expect(page.getByText('Noch keine Nachrichten in diesem Raum.')).toBeVisible()
        await expect(page.getByRole('button', { name: 'Schreib die erste.' })).toBeVisible()
        await expect(page.getByTestId('room-gate-restricted')).toHaveCount(0)
        // Relay-Mitglied ohne Raum-Mitgliedschaft: der Knopf, dessen Join durchgeht.
        await expect(page.getByText('Tritt dem Raum bei, um mitzuschreiben.')).toBeVisible()
    })
})
