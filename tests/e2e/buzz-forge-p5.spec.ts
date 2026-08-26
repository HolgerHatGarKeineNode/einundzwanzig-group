import { test, expect, type Page } from './support/fixtures'
import { useBuzz, BUZZ_URL, BUZZ_PORT, BUZZ_USER_NSEC, BUZZ_USER_PUB, BUZZ_OWNER_SEC_HEX, BUZZ_ROOM_GENERAL } from './support/buzz'
import { loginNsec } from './support/login'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'

/**
 * P5 — **der zweistufige Kernbeweis der Schreibriegel**.
 *
 * ── Warum diese Phase einen eigenen Prüfstand braucht ───────────────────────
 *
 * Buzz' Relay prüft an einem `kind 1` **gar keine** Berechtigung und quittiert
 * jedes Ereignis mit `OK true`. Ein Knopf ohne Riegel ist deshalb kein Fehler
 * mit Meldung, sondern **stiller Leerlauf**: das Ereignis geht raus, der Relay
 * nimmt es, und kein Client zeigt es je an. Der Nutzer sieht Erfolg und hat
 * nichts erreicht.
 *
 * Genau deshalb reicht hier keine DOM-Behauptung. Ein inerter Knopf, dessen
 * Handler trotzdem feuert, sähe im DOM richtig aus — nur am Relay läge danach
 * ein Ereignis. Beide Richtungen enden deshalb mit einer **Requery am Relay**.
 *
 * ── Die Reihenfolge ist Absicht: Positivkontrolle ZUERST ────────────────────
 *
 * Ohne sie wüsste niemand, ob die Sonde „richtig verweigert" oder überhaupt
 * nichts messen kann. Ein Negativfall, der nur beweist, dass hier nie ein
 * Ereignis entsteht, ist wertlos.
 *
 * ── Zwei Fallen, beide belegt ───────────────────────────────────────────────
 *
 * 1. **`aria-disabled` + Playwright `click()` = 30-s-Timeout.** Playwright
 *    wertet den Knopf als „not enabled" und wartet, bis die Zeit abläuft.
 *    Ausgelöst wird deshalb über die Tastatur (`focus()` + `press('Enter')`) —
 *    dasselbe Muster wie an `⚡article.blade.php:119-126`. Das ist zugleich der
 *    schärfere Test: es umgeht die Playwright-Höflichkeit und trifft den
 *    Handler direkt.
 * 2. **Der Dateiname ist Mechanik.** `playwright.config.ts:57` filtert im
 *    Buzz-Modus auf `/(?:buzz-.*|pin-room)\.spec\.ts$/` und überspringt alles
 *    andere LAUTLOS („Total: 0 tests", kein Fehler).
 *
 * ── Was hier NICHT geprüft wird, und warum nicht ────────────────────────────
 *
 * Der Riegel vor dem ZUWEISEN hat in DIESEM Prüfstand keinen Negativfall:
 * angeboten wird die Selbstbedienung, und die darf laut `assignGate` jedes
 * angemeldete Mitglied (`builders.rs:1163-1167` — „a self-assignment whose sole
 * assignee is the signer"). Sein `not-actor`-Zweig greift erst, wenn die Fläche
 * eines Tages FREMDE zuweisen lässt.
 *
 * **Hier stand, der `anonymous`-Zweig sei unerreichbar, weil die Route hinter
 * `nostr.auth` liegt. Das war falsch** (2026-08-24): `EnsureNostrAuth` lässt den
 * Mobile-Pfad ungeprüft durch (`config('nativephp-internal.running')` →
 * `return $next()`), und `viewer` kommt ohnehin aus der INSEL, nicht aus der
 * Laravel-Sitzung. Auf dem App-Host und im Web in dem Fenster, bevor der Signer
 * aufgelöst ist, gilt `viewer === ''` — Knopf inert, Hinweis sichtbar. Der Fall
 * existiert also; er ist nur in diesem Prüfstand nicht herstellbar, weil
 * `useWorkspace` sich anmeldet, bevor die Fläche steht. Abgedeckt ist er in
 * `forgeWriteModels.test.ts` (beide Gates liefern `anonymous`) und in
 * `forge.test.ts` (beide Riegel liefern dafür einen nicht-leeren Satz, den die
 * Fläche zeigen kann).
 *
 * Geprüft wird hier deshalb die WIRKUNG des Zuweisens — sie ist die
 * Positivkontrolle für den Schreibpfad.
 */

const NAK = process.env.NAK_BIN ?? 'nak'
const WS = (): string => `ws://localhost:${BUZZ_PORT}`
const QUERY_LIMIT = '500'
const REPO_D = `e2e-p5-riegel-${randomUUID().slice(0, 8)}`

const nak = (args: string[]): string => {
    const res = spawnSync(NAK, args, { encoding: 'utf8', timeout: 30_000 })

    return `${res.stdout ?? ''}\n${res.stderr ?? ''}`
}
const publish = (sec: string, args: string[]): string => nak(['event', '--auth', '--sec', sec, ...args, WS()])
const query = (args: string[]): string =>
    nak(['req', '--auth', '--sec', BUZZ_USER_NSEC, '-l', QUERY_LIMIT, ...args, WS()])

const events = (args: string[]): { id: string; kind: number; pubkey: string; tags: string[][] }[] => {
    const out: { id: string; kind: number; pubkey: string; tags: string[][] }[] = []
    for (const line of query(args).split('\n')) {
        if (line.startsWith('{')) {
            try {
                out.push(JSON.parse(line))
            } catch {
                // Keine Ereigniszeile.
            }
        }
    }

    return out
}

const tagValue = (tags: string[][], name: string): string => tags.find((tag) => tag[0] === name)?.[1] ?? ''
const ownerPubkey = (): string => nak(['key', 'public', BUZZ_OWNER_SEC_HEX]).trim().split('\n')[0].trim()

/**
 * Die Vorgangsnotizen EINER Wurzel mit einem bestimmten `t`-Label.
 *
 * **`some()` und nicht `find()` über die `e`-Tags** — der Unterschied entscheidet
 * in einer Abwesenheitsmessung. Eine Notiz mit vorangestelltem fremdem `e`
 * (NIP-10 erlaubt mehrere) würde über das ERSTE Tag nicht gefunden, und dieser
 * Prüfstand läse das als „nichts am Relay". Dieselbe Klasse wie P1/F5, wo die
 * Aktivitätsleiste ebenfalls nur das erste auflösbare `e` nahm; dort war es ein
 * Anzeigefehler, hier wäre es ein falsches GRÜN.
 */
const notizen = (address: string, rootId: string, label: string): { pubkey: string; tags: string[][] }[] =>
    events(['-k', '1', '-t', `a=${address}`]).filter(
        (e) =>
            e.tags.some((t) => (t[0] === 'e' || t[0] === 'E') && t[1] === rootId) &&
            e.tags.some((t) => t[0] === 't' && t[1] === label),
    )

async function useWorkspace(page: Page): Promise<void> {
    await useBuzz(page)
    await page.addInitScript((url) => {
        ;(window as unknown as { __nostrWorkspace: string }).__nostrWorkspace = url
    }, BUZZ_URL)
    await loginNsec(page, BUZZ_USER_NSEC)
}

async function openRepo(page: Page): Promise<void> {
    await page.goto('/forge')
    await page.getByRole('tab', { name: 'Repositories' }).click()
    await page.locator('[data-forge-repo]').filter({ hasText: REPO_D }).first().click()
    await expect(page.getByRole('heading', { level: 1, name: REPO_D, exact: true })).toBeVisible({ timeout: 30_000 })
}

test.describe('Buzz-Workspace: die Schreibriegel aus P5 (E2E, nur E2E_RELAY=buzz)', () => {
    test.skip(process.env.E2E_RELAY !== 'buzz', 'nur im Buzz-Modus (E2E_RELAY=buzz) relevant')

    let owner = ''
    let address = ''
    let prMitReviewer = ''
    let prOhneReviewer = ''
    let issueId = ''
    const COMMIT = 'a'.repeat(40)

    test.beforeAll(() => {
        owner = ownerPubkey()
        expect(owner).toHaveLength(64)
        address = `30617:${owner}:${REPO_D}`

        expect(
            publish(BUZZ_OWNER_SEC_HEX, [
                '-k', '30617',
                '-t', `d=${REPO_D}`,
                '-t', `name=${REPO_D}`,
                '-t', `buzz-channel=${BUZZ_ROOM_GENERAL}`,
                '-t', `h=${BUZZ_ROOM_GENERAL}`,
            ]),
        ).toContain('success')

        // Ein Issue vom EIGENTÜMER: das angemeldete Mitglied ist damit weder
        // Autor noch Eigentümer — es darf sich trotzdem selbst zuweisen.
        expect(publish(BUZZ_OWNER_SEC_HEX, [
            '-k', '1621', '-t', `a=${address}`, '-t', 'subject=P5 Zuweisungsziel', '-c', 'Rumpf.',
        ])).toContain('success')
        issueId = events(['-k', '1621', '-t', `a=${address}`])[0]?.id ?? ''
        expect(issueId).toHaveLength(64)

        // Zwei Pull Requests, beide mit Commit (ohne ihn sperrt `approveGate`
        // mit einem EIGENEN Grund — das wäre der falsche Negativfall).
        for (const subject of ['P5 mit Reviewer', 'P5 ohne Reviewer']) {
            expect(publish(BUZZ_OWNER_SEC_HEX, [
                '-k', '1618', '-t', `a=${address}`, '-t', `p=${owner}`,
                '-t', `subject=${subject}`, '-t', 'branch-name=feat/p5',
                '-t', `c=${COMMIT}`, '-c', 'PR-Rumpf.',
            ])).toContain('success')
        }
        const prs = events(['-k', '1618', '-t', `a=${address}`])
        prMitReviewer = prs.find((e) => tagValue(e.tags, 'subject') === 'P5 mit Reviewer')?.id ?? ''
        prOhneReviewer = prs.find((e) => tagValue(e.tags, 'subject') === 'P5 ohne Reviewer')?.id ?? ''
        expect(prMitReviewer).toHaveLength(64)
        expect(prOhneReviewer).toHaveLength(64)

        // Und die Review-Anfrage — vom EIGENTÜMER, sonst zählt sie nicht
        // (`foldReviews`, Regel 1: nur vertraute Anfragen erweitern die Menge).
        expect(publish(BUZZ_OWNER_SEC_HEX, [
            '-k', '1', '-t', `e=${prMitReviewer};;root`, '-t', `a=${address}`,
            '-t', `p=${BUZZ_USER_PUB}`, '-t', 't=review-request', '-c', 'Requested a review',
        ])).toContain('success')
    })

    test.afterAll(() => {
        publish(BUZZ_OWNER_SEC_HEX, ['-k', '5', '-t', `a=${address}`])
    })

    /**
     * STUFE 1a — die Positivkontrolle des Schreibpfads: Selbstzuweisung.
     *
     * Sie steht vor allem anderen, weil sie beweist, dass diese Sonde überhaupt
     * etwas bewirken kann. Danach ist ein „kein Ereignis" im Negativfall eine
     * Aussage und kein Messfehler.
     */
    test('Positivkontrolle: „Mir zuweisen" wirkt — und kommt am Relay an', async ({ page }) => {
        await useWorkspace(page)
        await openRepo(page)
        await page.getByRole('tab', { name: 'Issues' }).click()
        const zeile = page.locator('[data-forge-issue]').filter({ hasText: 'P5 Zuweisungsziel' }).first()
        await zeile.getByRole('button').first().click()

        const knopf = page.locator('[data-forge-assign-self]').first()
        await expect(knopf).toBeVisible({ timeout: 15_000 })
        // Offen heisst: KEIN `aria-disabled` — die Selbstbedienung darf jedes Mitglied.
        await expect(knopf).not.toHaveAttribute('aria-disabled', 'true')
        await expect(page.locator('[data-forge-assign-hint]')).toHaveCount(0)
        await knopf.click()

        // Die Requery ist der Beweis, nicht das Band auf der Fläche: das Band
        // stünde auch da, wenn nur der optimistische Eintrag wirkte.
        await expect
            .poll(() => notizen(address, issueId, 'assignment').length, { timeout: 20_000 })
            .toBe(1)
        const [notiz] = notizen(address, issueId, 'assignment')
        expect(notiz.pubkey).toBe(BUZZ_USER_PUB)
        expect(tagValue(notiz.tags, 'p')).toBe(BUZZ_USER_PUB)

        // Und die Fläche zeigt es: das Zuweisungs-Band aus P1 trägt die Person.
        await expect(zeile.locator('[data-forge-assignee]')).toHaveCount(1, { timeout: 20_000 })
    })

    /**
     * STUFE 1b — die Positivkontrolle des RIEGELS: ein eingetragener Reviewer
     * hat kein `aria-disabled`, sein Auslösen wirkt, und die Requery bestätigt
     * den Eingang MIT dem Commit-Bezug.
     */
    test('Positivkontrolle: der angefragte Reviewer darf freigeben', async ({ page }) => {
        await useWorkspace(page)
        await openRepo(page)
        await page.getByRole('tab', { name: 'Pull Requests' }).click()
        const zeile = page.locator('[data-forge-pr]').filter({ hasText: 'P5 mit Reviewer' }).first()
        await zeile.getByRole('button').first().click()

        const knopf = zeile.locator('[data-forge-approve]').first()
        await expect(knopf).toBeVisible({ timeout: 15_000 })
        await expect(knopf).not.toHaveAttribute('aria-disabled', 'true')
        await expect(zeile.locator('[data-forge-review-hint]')).toHaveCount(0)
        await knopf.click()

        await expect
            .poll(() => notizen(address, prMitReviewer, 'approval').length, { timeout: 20_000 })
            .toBe(1)
        const [freigabe] = notizen(address, prMitReviewer, 'approval')
        expect(freigabe.pubkey).toBe(BUZZ_USER_PUB)
        // Der Commit-Bezug ist die halbe Aussage: ohne ihn verwürfe `foldReviews`
        // die Freigabe still, und die Fläche zeigte ein Häkchen für Code, den
        // niemand gesehen hat.
        expect(tagValue(freigabe.tags, 'c')).toBe(COMMIT)
    })

    /**
     * STUFE 2 — der Negativfall, mit derselben Requery.
     *
     * Ausgelöst wird über die TASTATUR: `click()` liefe auf einem
     * `aria-disabled`-Knopf 30 s in einen Timeout, und eine reine
     * DOM-Behauptung sähe einen inerten, aber technisch feuernden Handler nicht.
     */
    test('Negativfall: wer nicht Reviewer ist, sieht den Riegel VOR dem Klick — und löst nichts aus', async ({ page }) => {
        await useWorkspace(page)
        await openRepo(page)
        await page.getByRole('tab', { name: 'Pull Requests' }).click()
        const zeile = page.locator('[data-forge-pr]').filter({ hasText: 'P5 ohne Reviewer' }).first()
        await zeile.getByRole('button').first().click()

        const knopf = zeile.locator('[data-forge-approve]').first()
        await expect(knopf).toBeVisible({ timeout: 15_000 })
        await expect(knopf).toHaveAttribute('aria-disabled', 'true')

        // Die Begründung steht VOR dem Klick da — nicht als Toast danach.
        const hinweis = zeile.locator('[data-forge-review-hint]').first()
        await expect(hinweis).toBeVisible()
        await expect(hinweis).toContainText('Reviewer')

        // Der Knopf behält seinen Fokus (`aria-disabled`, nicht `disabled`) —
        // sonst käme eine Tastatur nie an die Begründung.
        await knopf.focus()
        await expect(knopf).toBeFocused()
        await knopf.press('Enter')
        await page.waitForTimeout(1_500)

        // Der eigentliche Beweis: am Relay liegt nichts.
        expect(notizen(address, prOhneReviewer, 'approval')).toHaveLength(0)
        expect(notizen(address, prOhneReviewer, 'changes-requested')).toHaveLength(0)
    })
})
