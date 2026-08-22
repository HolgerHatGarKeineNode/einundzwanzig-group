import { type Page } from '@playwright/test'

/**
 * P6 — Helfer für die Vereins-Onboarding-Specs (`verein-onboarding.spec.ts`).
 *
 * Alles hier stubbt AUSSCHLIESSLICH die sechs Proxy-Endpunkte unter `/api/verein/**`
 * (`page.route`, nie den echten Verein oder BTCPay) — Vorbild ist der gestubbte
 * Zahl-Endpunkt in `zapper-warm.spec.ts:67`. `packages/einundzwanzig-group/js/verein.ts`
 * und `vereinFlow.ts` bleiben unangetastet.
 */

// ── Dokument-Konfiguration (`window.__nostrVerein`) ──────────────────────────

export type VereinWindowConfig = {
    api?: string
    proxy?: string
    activationMinutes?: number
    publicUrl?: string
}

const DEFAULT_CONFIG: Required<VereinWindowConfig> = {
    // Nie erreicht: `api` fließt nur in den `u`-Tag des NIP-98-Ausweises ein
    // (`nip98AuthHeader`), gefetcht wird ausschließlich der (gleiche-Origin)
    // Proxy-Pfad `/api/verein/**`, den `routeVerein()` unten abfängt.
    api: 'https://verein.e2e-test.invalid',
    proxy: '',
    activationMinutes: 1440,
    publicUrl: 'https://verein.einundzwanzig.space/',
}

/**
 * Setzt `window.__nostrVerein` VOR jeder Navigation — derselbe Kniff wie
 * `useZooid()`s `__nostrRelays` (`support/zooid.ts:94`): `partials/head.blade.php`
 * schreibt `window.__nostrVerein = window.__nostrVerein ?? @js([...])`, ein per
 * `addInitScript` VORAB gesetzter Wert gewinnt also gegen die leere lokale `.env`
 * (`VEREIN_API_URL` ist dort leer, ohne diesen Stub zeigte die Insel `verein-kein-flow`).
 *
 * Fängt zugleich `window.open` ab: kein Test öffnet je einen echten Checkout-Tab
 * oder eine echte Navigation zu einer Fremd-URL — die geöffneten Ziele landen
 * einsehbar in `window.__openedUrls` (siehe `openedUrls()`).
 */
export async function stubVereinDocument(page: Page, overrides: VereinWindowConfig = {}): Promise<void> {
    const cfg = { ...DEFAULT_CONFIG, ...overrides }
    await page.addInitScript((c) => {
        ;(window as unknown as { __nostrVerein: unknown }).__nostrVerein = c
        ;(window as unknown as { __openedUrls: string[] }).__openedUrls = []
        /*
         * Der Stub gibt ein WAHRHEITSFÄHIGES Fenster-Attrappe zurück, kein `null`.
         *
         * Seit dem Sicherheits-Gate wertet `openCheckout()` den Rückgabewert von
         * `window.open` aus: `null` heisst dort „der Popup-Blocker hat zugeschlagen",
         * und dann wird der Wartezustand bewusst NICHT betreten (sonst wartet die
         * Fläche auf eine Zahlung, die nie begonnen hat — gemessener Befund F3).
         *
         * Ein `null` aus diesem Helfer hiesse also „jeder E2E-Lauf simuliert einen
         * blockierten Popup" — das ist nicht seine Absicht. Er soll nur verhindern,
         * dass ein echter Tab aufgeht. Die Attrappe trägt genau die Felder, die ein
         * Aufrufer plausibel anfasst; gelesen wird von den Specs weiterhin
         * ausschliesslich `__openedUrls`.
         */
        const capture = (url?: string | URL): Window | null => {
            ;(window as unknown as { __openedUrls: string[] }).__openedUrls.push(String(url ?? ''))
            return { closed: false, close: () => {}, focus: () => {} } as unknown as Window
        }
        window.open = capture as typeof window.open
    }, cfg)
}

/** Alle über `window.open` „geöffneten" Ziele seit `stubVereinDocument()`. */
export const openedUrls = (page: Page): Promise<string[]> =>
    page.evaluate(() => (window as unknown as { __openedUrls?: string[] }).__openedUrls ?? [])

/**
 * Zwingt den aktiven Space auf eine TOT-URL (Verbindung wird nie beantwortet) —
 * für den Lesefehler-Zweig des Wartezustands. `DEFAULT_SPACE_URL`
 * (Symbol in `packages/einundzwanzig-group/js/groups.ts` — auf den Namen geankert,
 * nicht auf eine Zeile: der frühere Verweis auf Zeile 405 war schon vor dem
 * 2026-08-22 falsch, ohne dass ein Test rot wurde) liest `window.__nostrSpace`
 * EINMALIG beim Modul-Load; ein `page.goto()` (volle Navigation, kein
 * `wire:navigate`) wertet die addInitScripts danach neu aus. Muss NACH
 * `useZooid()` registriert werden (addInitScripts laufen in Reihenfolge, wer
 * zuletzt schreibt, gewinnt) — Login selbst braucht die Relay-Verbindung nicht
 * (NIP-98-HTTP-Handoff, kein WS), das ist am lebenden System geprüft.
 */
export async function stubDeadSpace(page: Page, wsUrl = 'ws://127.0.0.1:1/'): Promise<void> {
    await page.addInitScript((url) => {
        ;(window as unknown as { __nostrSpace: string }).__nostrSpace = url
    }, wsUrl)
}

// ── Antwort-Hüllen (wie der P4-Proxy sie unverfälscht durchreicht) ───────────

type JsonBody = Record<string, unknown>
const wrap = (data: JsonBody): { data: JsonBody } => ({ data })

export const vereinConfigBody = (overrides: JsonBody = {}): unknown =>
    wrap({
        fee: 21,
        currency: 'EUR',
        year: 2026,
        statutes: { url: 'https://verein.e2e-test.invalid/statuten.pdf', version: '3', adopted_at: '2025-01-01' },
        application: { application_text_max_length: 500, optional_fields: ['email', 'nip05_handle'] },
        ...overrides,
    })

export const vereinMeBody = (overrides: JsonBody = {}): unknown =>
    wrap({
        statutes_accepted_at: null,
        association_status: 'DEFAULT',
        current_year: { year: 2026, paid: false, fee: 21, currency: 'EUR', receipt_url: null },
        ...overrides,
    })

export const vereinInvoiceBody = (overrides: JsonBody = {}): unknown =>
    wrap({ bolt11: null, checkout_url: null, invoice_id: 'inv-e2e', ...overrides })

// ── Proxy-Stub ────────────────────────────────────────────────────────────────

type StubResponse = { status: number; body?: unknown }
/** Darf async sein (z. B. eine künstliche Verzögerung vor der Antwort testen). */
type Responder = (callIndex: number) => StubResponse | Promise<StubResponse>
type Handlers = { config?: Responder; me?: Responder; applications?: Responder; invoice?: Responder; refresh?: Responder }
type Calls = { config: number; me: number; applications: number; invoice: number; refresh: number }

/**
 * Fängt `/api/verein/**` vollständig ab — nichts davon erreicht je den echten
 * Client-Proxy (P4) oder den Verein. Ein Endpunkt ohne Handler antwortet 404
 * (laut, statt gegen die echte API zu laufen, die es hier nicht gibt).
 *
 * `calls` ist ein lebendes Zähler-Objekt (per Referenz), damit ein Test nach
 * einer Aktion prüfen kann, WIE OFT ein Endpunkt getroffen wurde — etwa das
 * exakte `refresh`-Aufkommen im Nachfass-Plan.
 */
export async function routeVerein(page: Page, handlers: Handlers): Promise<{ calls: Calls }> {
    const calls: Calls = { config: 0, me: 0, applications: 0, invoice: 0, refresh: 0 }

    await page.route('**/api/verein/**', async (route) => {
        const req = route.request()
        const { pathname } = new URL(req.url())
        const method = req.method()

        const dispatch = async (key: keyof Calls, responder?: Responder): Promise<StubResponse | null> => {
            if (!responder) {
                return null
            }
            const idx = calls[key]
            calls[key] += 1
            return responder(idx)
        }

        let hit: StubResponse | null = null

        if (method === 'GET' && pathname.endsWith('/config')) {
            hit = await dispatch('config', handlers.config)
        } else if (method === 'GET' && pathname.endsWith('/me')) {
            hit = await dispatch('me', handlers.me)
        } else if (method === 'POST' && pathname.endsWith('/applications')) {
            hit = await dispatch('applications', handlers.applications)
        } else if (method === 'POST' && /\/payments\/\d+\/invoice$/.test(pathname)) {
            hit = await dispatch('invoice', handlers.invoice)
        } else if (method === 'POST' && /\/payments\/\d+\/refresh$/.test(pathname)) {
            hit = await dispatch('refresh', handlers.refresh)
        }

        if (!hit) {
            await route.fulfill({
                status: 404,
                contentType: 'application/json',
                body: JSON.stringify({ message: `E2E-Stub: kein Handler für ${method} ${pathname}` }),
            })
            return
        }

        await route.fulfill({ status: hit.status, contentType: 'application/json', body: JSON.stringify(hit.body ?? {}) })
    })

    return { calls }
}

// ── Wallet seeden (secure-storage.ts nachgebildet) ────────────────────────────

/**
 * Legt ein NWC-Wallet direkt in der IndexedDB ab, in exakt dem Format, das
 * `js/secure-storage.ts` (`webSet`) selbst erzeugt (gleiche `DB_NAME`/`STORE`/
 * `KEY_ID`, gleiches AES-GCM-Schema) — kein Mock von `loadWallet()`, sondern
 * echte Seed-Daten an der Stelle, die die App selbst liest. `js/wallet.ts`
 * `loadWallet()` liest den Schlüssel `einundzwanzig:wallet:${pubkey}`.
 *
 * Der Payload selbst zeigt auf einen NICHT existenten Relay/Wallet — er wird nur
 * gebraucht, damit `hasWallet()` wahr wird (die Weiche „mit Wallet" prüft NUR
 * Vorhandensein, siehe `canPayInApp`); ein echter Zahlversuch (`payInvoice`)
 * wird in keinem Test ausgelöst.
 */
export async function seedWallet(page: Page, pubkeyHex: string): Promise<void> {
    await page.evaluate(async (pk) => {
        const enc = new TextEncoder()
        const DB_NAME = 'einundzwanzig-secure'
        const STORE = 'kv'
        const KEY_ID = '__aeskey__'

        const openDb = (): Promise<IDBDatabase> =>
            new Promise((resolve, reject) => {
                const req = indexedDB.open(DB_NAME, 1)
                req.onupgradeneeded = () => req.result.createObjectStore(STORE)
                req.onsuccess = () => resolve(req.result)
                req.onerror = () => reject(req.error)
            })
        const idbGet = (key: string): Promise<unknown> =>
            openDb().then(
                (db) =>
                    new Promise((resolve, reject) => {
                        const r = db.transaction(STORE, 'readonly').objectStore(STORE).get(key)
                        r.onsuccess = () => resolve(r.result)
                        r.onerror = () => reject(r.error)
                    }),
            )
        const idbPut = (key: string, value: unknown): Promise<void> =>
            openDb().then(
                (db) =>
                    new Promise((resolve, reject) => {
                        const tx = db.transaction(STORE, 'readwrite')
                        tx.objectStore(STORE).put(value, key)
                        tx.oncomplete = () => resolve()
                        tx.onerror = () => reject(tx.error)
                    }),
            )
        const getCryptoKey = async (): Promise<CryptoKey> => {
            const existing = (await idbGet(KEY_ID)) as CryptoKey | undefined
            if (existing) {
                return existing
            }
            const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
            await idbPut(KEY_ID, key)
            return key
        }

        const wallet = JSON.stringify({
            type: 'nwc',
            info: {
                relayUrl: 'wss://relay.e2e-test.invalid/',
                walletPubkey: 'a'.repeat(64),
                secret: 'b'.repeat(64),
                lud16: 'e2e@example.test',
                nostrWalletConnectUrl: '',
            },
        })
        const iv = crypto.getRandomValues(new Uint8Array(12))
        const key = await getCryptoKey()
        const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, enc.encode(wallet))
        await idbPut('data:einundzwanzig:wallet:' + pk, { iv, ct })
    }, pubkeyHex)
}
