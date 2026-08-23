import { test, expect, type Page } from './support/fixtures'
import { useBuzz, BUZZ_URL, BUZZ_PORT, BUZZ_USER_NSEC, BUZZ_OWNER_SEC_HEX, BUZZ_ROOM_GENERAL } from './support/buzz'
import { loginNsec } from './support/login'
import { publishVerified } from './support/publishVerified'
import { measure } from './support/contrast'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'

/**
 * **Die FORM der Agenten-Erwähnung — vier Zahlen, die still zurückfallen können.**
 *
 * Der Design-Pass am 2026-08-23 fand an dieser Fläche vier Mängel, die alle
 * dieselbe Eigenschaft haben: sie brechen nichts, sie werfen nichts, und kein
 * bestehender Test sieht sie. Genau deshalb steht hier ein Anker.
 *
 * | Was              | vorher            | Regel / Ziel                       |
 * |------------------|-------------------|------------------------------------|
 * | Abzeichen „Agent"| 2,36:1 (hell)     | WCAG 1.4.3 → ≥ 4,5:1               |
 * | npub-Kurzform    | 10 px             | Haus-Typoskala → ≥ 12 px           |
 * | „Verwerfen"      | 54 × 16 px        | WCAG 2.5.8 → ≥ 24 × 24 px          |
 * | Auswahl beim ↓   | ab Index 4 außen  | sichtbar bleiben                   |
 *
 * ── Warum jede Messung hier eine Positivkontrolle davor hat ─────────────────
 *
 * „Der Kontrast reißt nicht" ist auch dann wahr, wenn das Abzeichen gar nicht
 * gerendert wurde — dann misst `measure()` nichts und ein Aufrufer, der die Zahl
 * der Einträge nicht prüft, liest die Stille als Erfolg. `measure()` selbst ist
 * fail-CLOSED (ein Selektor ohne Treffer kommt als eigener Eintrag mit
 * `ratio: 0` zurück), aber das nützt nur, wenn jemand hinschaut. Jeder Fall
 * unten prüft deshalb zuerst, dass die Agentenzeile da ist, und dann erst ihre
 * Zahlen.
 *
 * Der Dateiname beginnt mit `buzz-`, sonst überspringt `playwright.config.ts`
 * die Datei im Buzz-Modus LAUTLOS — und ein Agentenvorschlag entsteht nur dort
 * (auf zooid ist er per Riegel ausgeschlossen, siehe `agent-mentions.spec.ts`).
 */

const NAK = process.env.NAK ?? `${process.env.HOME}/go/bin/nak`
const WS = (): string => `ws://localhost:${BUZZ_PORT}`

const nak = (args: string[]): string => {
    const res = spawnSync(NAK, args, { encoding: 'utf8', timeout: 30_000 })

    return `${res.stdout ?? ''}\n${res.stderr ?? ''}`
}
const publish = (sec: string, args: string[]): string => nak(['event', '--auth', '--sec', sec, ...args, WS()])

type RelayEvent = { id: string; kind: number; pubkey: string; content: string; tags: string[][] }

const events = (args: string[]): RelayEvent[] => {
    const out: RelayEvent[] = []
    for (const line of nak(['req', '--auth', '--sec', BUZZ_USER_NSEC, '-l', '500', ...args, WS()]).split('\n')) {
        if (line.startsWith('{')) {
            try {
                out.push(JSON.parse(line) as RelayEvent)
            } catch {
                // Keine Ereigniszeile.
            }
        }
    }

    return out
}

type Agent = { sec: string; pub: string; name: string }

/**
 * Ein Wegwerf-Agent je Lauf. kind 10100 ist **ersetzbar und je Autor eindeutig** —
 * ein geteilter Schlüssel hieße, dass ein paralleler Lauf dieses Profil
 * überschreibt (dieselbe Begründung wie in `buzz-forge-mentions.spec.ts`).
 */
function seedAgent(): Agent {
    const sec = nak(['key', 'generate']).trim().split('\n')[0].trim()
    const pub = nak(['key', 'public', sec]).trim().split('\n')[0].trim()
    expect(pub, 'Wegwerf-Schlüssel nicht erzeugt').toHaveLength(64)
    const agent: Agent = { sec, pub, name: `formotter-${randomUUID().slice(0, 8)}` }

    expect(publish(BUZZ_OWNER_SEC_HEX, ['-k', '9030', '-t', `p=${pub}`, '-t', 'role=member'])).toContain('success')
    const content = JSON.stringify({
        name: agent.name,
        display_name: agent.name,
        agent_type: 'agent',
        channel_ids: [BUZZ_ROOM_GENERAL],
        channels: [BUZZ_ROOM_GENERAL],
        respond_to: 'anyone',
        respond_to_allowlist: [],
        status: 'online',
    })
    publishVerified(
        NAK,
        ['event', '--auth', '--sec', sec, '-k', '10100', '-c', content],
        WS(),
        () => events(['-k', '10100', '-a', pub]).find((e) => e.content.includes(agent.name)),
        `Agentenprofil ${agent.name}`,
    )

    return agent
}

function seedRepo(dtag: string): void {
    expect(
        publish(BUZZ_OWNER_SEC_HEX, [
            '-k',
            '30617',
            '-t',
            `d=${dtag}`,
            '-t',
            `name=${dtag}`,
            '-t',
            `buzz-channel=${BUZZ_ROOM_GENERAL}`,
        ]),
    ).toContain('success')
}

async function anmelden(page: Page): Promise<void> {
    await useBuzz(page)
    await page.addInitScript((url) => {
        ;(window as unknown as { __nostrWorkspace: string }).__nostrWorkspace = url
    }, BUZZ_URL)
    await loginNsec(page, BUZZ_USER_NSEC)
}

/** Kasten und Typo eines Knotens. */
const geo = (page: Page, selector: string) =>
    page.evaluate((sel) => {
        const el = document.querySelector(sel)
        if (!el) {
            return null
        }
        const r = el.getBoundingClientRect()

        return { w: r.width, h: r.height, fontSize: parseFloat(getComputedStyle(el).fontSize) }
    }, selector)

const POPOVER = '[data-forge-mention-popover="issue"]'
const AGENTZEILE = `${POPOVER} button[data-agent="true"]`
const ABZEICHEN = `${AGENTZEILE} > span:last-child`
const HINWEIS = `${AGENTZEILE} > span.flex-1 > span.font-mono`

test.describe('Buzz-Forge: die Form des Agentenvorschlags und der Weckmeldung', () => {
    test.skip(process.env.E2E_RELAY !== 'buzz', 'nur im Buzz-Modus (E2E_RELAY=buzz) relevant')

    const REPO = `e2e-form-${randomUUID().slice(0, 8)}`
    let agent: Agent

    test.beforeAll(() => {
        agent = seedAgent()
        seedRepo(REPO)
    })

    test.afterAll(() => {
        const owner = nak(['key', 'public', BUZZ_OWNER_SEC_HEX]).trim().split('\n')[0].trim()
        publish(BUZZ_OWNER_SEC_HEX, ['-k', '5', '-t', `a=30617:${owner}:${REPO}`])
    })

    /**
     * Repo öffnen, Issue-Formular auf, `@…` tippen — der Vorschlag steht.
     *
     * `suche` ist der Teil hinter dem `@`. Der volle Agentenname engt die Liste
     * auf GENAU EINEN Eintrag ein — richtig für die Kontrastmessung (dann ist
     * sicher, dass der gemessene Chip der des Agenten ist), falsch für den
     * Tastaturlauf, wo der Umlauf über mehrere Einträge geprüft wird.
     *
     * **Die Positivkontrolle hängt deshalb an `suche` und nicht an einer festen
     * Zahl.** Der Teststack sammelt Agentenprofile über Läufe hinweg an (kind
     * 10100 wird nie aufgeräumt); bei leerer Suche standen im Vollauf fünf
     * Agentenzeilen da statt einer — der Deckel von `mergeMentionItems`. Eine
     * feste `toHaveCount(1)` misst dann die Nachbarschaft, nicht diese Fläche.
     */
    async function vorschlagOeffnen(page: Page, suche = agent.name) {
        await anmelden(page)
        await page.goto('/forge')
        await page.getByRole('tab', { name: 'Repositories' }).click()
        await page.locator('[data-forge-repo]').filter({ hasText: REPO }).first().click()
        await expect(page.getByRole('heading', { level: 1, name: REPO, exact: true })).toBeVisible({ timeout: 30_000 })
        await page.getByRole('button', { name: 'Neues Issue' }).click()
        const rumpf = page.locator('[data-forge-issue-form]').getByLabel('Beschreibung')
        await rumpf.click()
        await rumpf.pressSequentially(`Hallo @${suche}`, { delay: 20 })
        // Positivkontrolle: OHNE diese Zeile misst alles Folgende ein leeres DOM.
        if (suche) {
            await expect(page.locator(AGENTZEILE)).toHaveCount(1, { timeout: 30_000 })
            await expect(page.locator(AGENTZEILE)).toContainText(suche)
        } else {
            await expect(page.locator(`${POPOVER} button`).first()).toBeVisible({ timeout: 30_000 })
            expect(await page.locator(AGENTZEILE).count(), 'kein einziger Agentenvorschlag').toBeGreaterThan(0)
        }

        return rumpf
    }

    test('das Abzeichen und die npub-Kurzform tragen in beiden Themes', async ({ page }) => {
        await vorschlagOeffnen(page)

        // Zuerst die Form: 10 px stand auf keiner Stufe der Haus-Typoskala, und
        // die Kurzform ist das EINZIGE Merkmal, an dem zwei gleichnamige
        // Agentenprofile auseinandergehen (kind 10100 ist selbstsigniert).
        const hinweis = await geo(page, HINWEIS)
        expect(hinweis, 'npub-Kurzform nicht gerendert — die Messung darunter wäre leer').not.toBeNull()
        expect(hinweis!.fontSize, 'npub-Kurzform unter der Haus-Typoskala').toBeGreaterThanOrEqual(12)
        const abzeichen = await geo(page, ABZEICHEN)
        expect(abzeichen, 'Agenten-Abzeichen nicht gerendert').not.toBeNull()
        expect(abzeichen!.fontSize).toBeGreaterThanOrEqual(12)

        for (const theme of ['hell', 'dunkel'] as const) {
            await page.evaluate((t) => document.documentElement.classList.toggle('dark', t === 'dunkel'), theme)
            const werte = (
                await measure(page, [
                    { selector: ABZEICHEN, label: 'ABZEICHEN', kind: 'text' },
                    { selector: HINWEIS, label: 'HINWEIS', kind: 'text' },
                ])
            ).filter((m) => m.label === 'ABZEICHEN' || m.label === 'HINWEIS')

            // Fail-closed-Kontrolle: `measure()` liefert bei einem Selektor ohne
            // Treffer einen Eintrag mit `ratio: 0`. Wer das nicht prüft, liest
            // „nichts gemessen" als „bestanden".
            expect(werte, `${theme}: beide Träger müssen gemessen worden sein`).toHaveLength(2)
            for (const m of werte) {
                expect(m.ratio, `${theme}: ${m.label} gar nicht gemessen`).toBeGreaterThan(0)
                expect(m.opacity, `${theme}: ${m.label} steht unter fremder Deckkraft`).toBe(1)
                expect(m.ratio, `${theme}: ${m.label} reißt WCAG 1.4.3 (${m.fg} auf ${m.bg})`).toBeGreaterThanOrEqual(
                    m.min,
                )
            }
        }
    })

    test('die Auswahl bleibt beim Blättern im Fenster', async ({ page }) => {
        await vorschlagOeffnen(page)

        // Dreizehn Einträge sind der volle Deckel (5 Agenten + 8 Menschen,
        // getrennt). Sie werden hier GESETZT und nicht geseedet: geprüft wird
        // Geometrie, nicht Datenherkunft — und vor jedem Schritt neu, weil
        // `_recomputeAgentItems()` gedrosselt über die echte Liste läuft und
        // `mention.items` sonst mitten in der Messung ersetzt.
        const setzen = (index: number) =>
            page.evaluate((idx) => {
                const w = window as unknown as { Alpine: { $data: (el: Element) => Record<string, unknown> } }
                const el = document.querySelector('[x-data*="nostrForge"]') ?? document.querySelector('[x-data]')
                const daten = w.Alpine.$data(el as Element)
                const items = Array.from({ length: 13 }, (_, i) => ({
                    pubkey: String(i).padStart(64, '0'),
                    npub: `npub1test${i}`,
                    name: i < 5 ? `agent-nummer-${i}` : `mensch-nummer-${i}`,
                    picture: '',
                    search: `x${i}`,
                    isAgent: i < 5,
                    hint: i < 5 ? `npub1abcde…wx${i}z` : undefined,
                }))
                daten.mention = { ...(daten.mention as object), items, index: idx, open: true }
            }, index)

        await setzen(0)
        await expect(page.locator(`${POPOVER} button`)).toHaveCount(13)
        // Positivkontrolle für DIESEN Fall: die Liste muss überhaupt überlaufen,
        // sonst wäre „immer sichtbar" trivial wahr.
        const ueberlauf = await page.evaluate((sel) => {
            const el = document.querySelector(sel) as HTMLElement

            return { scrollH: el.scrollHeight, clientH: el.clientHeight }
        }, POPOVER)
        expect(ueberlauf.scrollH, 'die Liste läuft gar nicht über — der Fall misst nichts').toBeGreaterThan(
            ueberlauf.clientH,
        )

        for (let i = 0; i < 13; i++) {
            await setzen(i)
            const lage = await page.evaluate((sel) => {
                const pop = document.querySelector(sel) as HTMLElement
                const aktiv = pop.querySelector('[aria-selected="true"]') as HTMLElement | null
                if (!aktiv) {
                    return null
                }
                const pr = pop.getBoundingClientRect()
                const ar = aktiv.getBoundingClientRect()

                return { oben: ar.top - pr.top, unten: pr.bottom - ar.bottom }
            }, POPOVER)
            expect(lage, `Schritt ${i}: keine markierte Zeile gefunden`).not.toBeNull()
            expect(lage!.oben, `Schritt ${i}: Auswahl über dem Fenster`).toBeGreaterThanOrEqual(-0.5)
            expect(lage!.unten, `Schritt ${i}: Auswahl unter dem Fenster`).toBeGreaterThanOrEqual(-0.5)
        }
    })

    test('die Weckmeldung: zwei Symbole, ein Verwerfen-Ziel von 24 px', async ({ page }) => {
        await anmelden(page)
        await page.goto('/forge')
        await page.getByRole('tab', { name: 'Repositories' }).click()
        await page.locator('[data-forge-repo]').filter({ hasText: REPO }).first().click()
        await expect(page.getByRole('heading', { level: 1, name: REPO, exact: true })).toBeVisible({ timeout: 30_000 })

        const setzeTon = (tone: 'ok' | 'warn') =>
            page.evaluate((t) => {
                const w = window as unknown as { Alpine: { $data: (el: Element) => Record<string, unknown> } }
                const el = document.querySelector('[x-data*="nostrForge"]') ?? document.querySelector('[x-data]')
                const daten = w.Alpine.$data(el as Element)
                daten.wakeNotice = { issue: { tone: t, text: `Formprobe ${t}` } }
            }, tone)
        const kasten = '[data-forge-wake-notice="issue"]'
        const symbolpfad = () =>
            page.evaluate((sel) => document.querySelector(`${sel} svg path`)?.getAttribute('d') ?? '', kasten)

        await setzeTon('ok')
        await expect(page.locator(kasten)).toBeVisible({ timeout: 10_000 })
        const pfadOk = await symbolpfad()
        const zielOk = await geo(page, `${kasten} button`)

        await setzeTon('warn')
        await expect(page.locator(kasten)).toHaveAttribute('data-tone', 'warn')
        const pfadWarn = await symbolpfad()

        // **Der Kern:** „jemand geweckt" und „niemand geweckt" dürfen sich nicht
        // allein im Farbton unterscheiden. Bis 2026-08-23 stand in beiden Fällen
        // dasselbe `information-circle` — gleiche Höhe, gleiche Schrift, gleicher
        // Pfad; wer die Farbe nicht unterscheidet, musste den 12-px-Satz lesen.
        expect(pfadOk, 'ok-Symbol nicht gerendert').not.toBe('')
        expect(pfadWarn, 'warn-Symbol nicht gerendert').not.toBe('')
        expect(pfadWarn, 'beide Tonlagen tragen dasselbe Symbol — der Ton ist wieder nur Farbe').not.toBe(pfadOk)

        // WCAG 2.5.8: 24 × 24 CSS-px. Als nacktes `underline`-Wort maß der Knopf
        // 54 × 16.
        for (const [ton, ziel] of [
            ['ok', zielOk],
            ['warn', await geo(page, `${kasten} button`)],
        ] as const) {
            expect(ziel, `${ton}: Verwerfen-Knopf nicht gerendert`).not.toBeNull()
            expect(ziel!.h, `${ton}: Verwerfen-Ziel unter 24 px hoch`).toBeGreaterThanOrEqual(24)
            expect(ziel!.w, `${ton}: Verwerfen-Ziel unter 24 px breit`).toBeGreaterThanOrEqual(24)
        }

        // Die Live-Region muss VOR ihrem Inhalt dastehen — eine, die gemeinsam
        // mit dem Text in den Baum kommt, wird von mehreren Screenreadern nicht
        // vorgelesen. Also: Wrapper da, auch wenn gar keine Meldung offen ist.
        await page.evaluate(() => {
            const w = window as unknown as { Alpine: { $data: (el: Element) => Record<string, unknown> } }
            const el = document.querySelector('[x-data*="nostrForge"]') ?? document.querySelector('[x-data]')
            w.Alpine.$data(el as Element).wakeNotice = {}
        })
        await expect(page.locator(kasten)).toHaveCount(0)
        await expect(page.locator('[data-forge-wake-status="issue"]')).toHaveCount(1)
    })

    test('grobes Zeigegerät: das Verwerfen-Ziel wächst auf 44 px', async ({ browser }) => {
        const ctx = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } })
        const page = await ctx.newPage()
        try {
            await anmelden(page)
            await page.goto('/forge')
            await page.getByRole('tab', { name: 'Repositories' }).click()
            await page.locator('[data-forge-repo]').filter({ hasText: REPO }).first().click()
            await expect(page.getByRole('heading', { level: 1, name: REPO, exact: true })).toBeVisible({
                timeout: 30_000,
            })
            // Positivkontrolle: `icon-btn-touch` hängt an `pointer: coarse`. Ohne
            // diese Zeile prüfte der Fall auf einem feinen Zeiger und wäre eine
            // Aussage über etwas, das gar nicht greift.
            expect(
                await page.evaluate(() => matchMedia('(pointer: coarse)').matches),
                'der Kontext meldet keinen groben Zeiger — die Regel greift hier gar nicht',
            ).toBe(true)

            await page.evaluate(() => {
                const w = window as unknown as { Alpine: { $data: (el: Element) => Record<string, unknown> } }
                const el = document.querySelector('[x-data*="nostrForge"]') ?? document.querySelector('[x-data]')
                w.Alpine.$data(el as Element).wakeNotice = { issue: { tone: 'warn', text: 'Formprobe Touch' } }
            })
            const knopf = '[data-forge-wake-notice="issue"] button'
            await expect(page.locator(knopf)).toBeVisible({ timeout: 10_000 })
            const ziel = await geo(page, knopf)
            expect(ziel!.h, 'Touch-Ziel unter 44 px').toBeGreaterThanOrEqual(44)
            expect(ziel!.w, 'Touch-Ziel unter 44 px').toBeGreaterThanOrEqual(44)
        } finally {
            await ctx.close()
        }
    })

    test('Tastatur allein: Pfeile, Enter, Escape — und die Ansage dazu', async ({ page }) => {
        // Leere Suche: die volle Liste, damit der Umlauf etwas zu umlaufen hat.
        const rumpf = await vorschlagOeffnen(page, '')
        const ansage = page.locator('[data-forge-mention-ansage="issue"]')

        // Die Liste ist offen und die Ansage nennt den ersten Eintrag. WELCHER
        // das ist, steht hier bewusst nicht: bei leerer Suche füllt der Deckel
        // von `mergeMentionItems` die ersten fünf Plätze mit Agenten aus allen
        // Läufen dieses Stacks, alphabetisch. Geprüft wird die Ansage, nicht die
        // Nachbarschaft.
        await expect(ansage).toContainText('1 von')
        await expect(ansage).not.toHaveText('')

        // Abwärts, dann zweimal aufwärts: der Umlauf führt auf den LETZTEN.
        const anzahl = await page.locator(`${POPOVER} button`).count()
        // Positivkontrolle: mit einem einzigen Eintrag prüfte der Umlauf nichts.
        expect(anzahl, 'zu wenige Vorschläge, der Umlauf wäre trivial').toBeGreaterThan(1)
        await page.keyboard.press('ArrowDown')
        await expect(ansage).toContainText(`2 von ${anzahl}`)
        await page.keyboard.press('ArrowUp')
        await page.keyboard.press('ArrowUp')
        await expect(ansage).toContainText(`${anzahl} von ${anzahl}`)

        // Escape schließt und lässt den Fokus IM Feld — sonst landete er am
        // Seitenanfang und der Entwurf wäre nur über die Maus wieder erreichbar.
        await page.keyboard.press('Escape')
        await expect(page.locator(POPOVER)).toHaveCount(0)
        await expect(ansage).toHaveText('')
        expect(await page.evaluate(() => document.activeElement?.getAttribute('data-forge-composer'))).toBe('issue')

        // Und der übliche Weg: wieder auf, Enter übernimmt in NIP-27-Form.
        await rumpf.pressSequentially('a', { delay: 20 })
        await expect(page.locator(POPOVER)).toHaveCount(1, { timeout: 10_000 })
        await page.keyboard.press('Enter')
        await expect(rumpf).toHaveValue(/nostr:npub1/)
        await expect(page.locator(POPOVER)).toHaveCount(0)
        expect(await page.evaluate(() => document.activeElement?.getAttribute('data-forge-composer'))).toBe('issue')

        // Eine Option ist kein eigener Tabstopp — die Bedienung läuft über das
        // Feld. Rückwärts (Shift+Tab) landete man sonst mitten in der Liste, wo
        // die Pfeiltasten nichts mehr tun.
        await rumpf.pressSequentially(' @', { delay: 20 })
        await expect(page.locator(POPOVER)).toHaveCount(1, { timeout: 10_000 })
        expect(
            await page.evaluate(
                (sel) => [...document.querySelectorAll(`${sel} button`)].filter((b) => (b as HTMLElement).tabIndex >= 0).length,
                POPOVER,
            ),
            'eine Option steht wieder in der Tab-Reihenfolge',
        ).toBe(0)
    })
})
