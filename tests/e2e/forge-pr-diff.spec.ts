import { test, expect, type Page } from './support/fixtures'
import { useZooid, ZOOID_PORT, ZOOID_WS } from './support/zooid'
import { loginNsec } from './support/login'
import { execFileSync, spawnSync } from 'node:child_process'
import { nip19 } from 'nostr-tools'

const NSEC = process.env.NOSTR_TEST_NSEC as string
const NAK = process.env.NAK ?? `${process.env.HOME}/go/bin/nak`

/**
 * P7b — **DER PR-DIFF UND DIE DATENLÜCKEN DES STECKBRIEFS.**
 *
 * Vier Zusagen, und drei davon sind Auskünfte über etwas, das dieser Client
 * NICHT kann — genau die Sorte, die man am leichtesten als Fehlerbild baut:
 *
 *   1. **Die Kostenansage steht VOR dem Download.** Ein kind 1618 trägt seinen
 *      Diff nicht bei sich; ihn zu zeigen kostet einen zweiten Git-Download, und
 *      der ist teuer (gemessen: 1 Commit 1,1 MB, zehn Commits 13 MB — der
 *      Endpunkt kann kein `filter=blob:none`). Gemessen wird deshalb nicht die
 *      Anwesenheit eines Satzes, sondern der NETZVERKEHR: vor dem Klick null
 *      Anfragen an den Git-Endpunkt, nach dem Klick mindestens eine. Der zweite
 *      Teil ist die Positivkontrolle — ohne ihn wäre „0 Anfragen" auch dann
 *      grün, wenn der Mitschnitt gar nichts sieht.
 *   2. **Ein Tip auf fremdem Host ist eine ruhige Auskunft mit Link.** NIP-34
 *      lässt ausdrücklich zu, dass der vorgeschlagene Commit in einem Fork auf
 *      github.com liegt. Unser NIP-98-Token gilt dort nicht. Wer daraus ein
 *      Fehlerbild macht, erklärt eine erlaubte Bauform des Protokolls zum
 *      Defekt — geprüft wird deshalb ausdrücklich die ABWESENHEIT von
 *      Fehlermarkierung und Download-Knopf, plus die Anwesenheit des Links.
 *   3. **Ohne Commit und Vergleichspunkt gibt es nichts zu rechnen.** Am
 *      Buzz-Relay ist das der Normalfall bei von Hand gebauten Vorschlägen.
 *   4. **Tags, Themen und verwandte Repositories sind sichtbar** — alle drei
 *      lagen seit P7a am Modell und standen in keinem Bild.
 *
 * ── Warum dieser Test sein eigenes Repo sät ─────────────────────────────────
 *
 * Weil er einen Bestand braucht, den kein anderer Spec hinterlässt: drei Pull
 * Requests mit VERSCHIEDENEN clone-Angaben, ein 30618 mit einem Tag, und ein
 * zweites Repository mit demselben `euc`. Sich auf Reste anderer Läufe zu
 * verlassen, ist in diesem Plan schon einmal schiefgegangen — ein Test, der
 * stillschweigend fremde Issues benutzte, fiel auf drei frischen Slots.
 *
 * `d`-Tags: `e2e-prdiff` und `e2e-prdiff-kopie`. `grep -rn "e2e-prdiff"` trifft
 * nur diese Datei; es gibt also nichts zu überschreiben. Aufgeräumt wird per
 * NIP-09, und `--auth` ist dabei Pflicht (ohne quittiert zooid `auth-required`
 * und der Aufräumcode sieht aus, als hätte er gewirkt).
 */

const REPO_D = 'e2e-prdiff'
const REPO_NAME = 'e2e-prdiff'
const KOPIE_D = 'e2e-prdiff-kopie'
const KOPIE_NAME = 'e2e-prdiff-kopie'
const THEMA = 'zwergotter'
const TAG_NAME = 'v1.0.0-e2e'
const EUC = 'e'.repeat(40)
const BASIS = 'a'.repeat(40)
const SPITZE = 'b'.repeat(40)
const TAG_COMMIT = 'c'.repeat(40)
const HEAD_COMMIT = 'd'.repeat(40)

const PR_EIGEN = 'P7b eigener Host'
const PR_FREMD = 'P7b fremder Host'
const PR_OHNE = 'P7b ohne Commits'
const PR_NUR_C = 'P7b nur Commit'

/** Der fremde Host — ausdrücklich einer, den dieser Testlauf NIE anfasst. */
const FREMD_CLONE = 'https://github.com/zwergotter/prdiff.git'

/**
 * Die clone-URL des EIGENEN Falls — **auf demselben Host wie der Workspace-Relay.**
 *
 * `istEigenerHost` vergleicht `URL.host`, und der trägt den PORT. Der erste
 * Entwurf setzte hier eine Loopback-Adresse mit Port 1 gegen einen Relay auf
 * Port 3355; beides ist dieselbe Maschine, und trotzdem fiel der Fall in den
 * Fremd-Zweig — zwei von fünf Zusagen rot, mit `data-quelle="fremd"` als Beleg.
 * Die Portreihe ist je Worker und je `E2E_SLOT_OFFSET` verschoben, die URL muss
 * also GERECHNET werden und darf kein Literal sein.
 *
 * Dass unter dieser Adresse ein Nostr-Relay und kein Git-Endpunkt hört, ist
 * gleichgültig: gemessen wird, DASS eine Anfrage hinausgeht, nicht was
 * zurückkommt.
 */
const EIGEN_CLONE = `http://localhost:${ZOOID_PORT}/git/e2e/prdiff`

/**
 * `nak` mit stdout UND stderr — `nak event` druckt das Ereignis auf stdout, OB
 * ES ANGENOMMEN WURDE ODER NICHT; die Quittung des Relays geht nach stderr.
 */
const nak = (args: readonly string[]): string => {
    let letzter: unknown
    for (let i = 0; i < 3; i++) {
        const res = spawnSync(NAK, [...args], { encoding: 'utf8', timeout: 30_000 })
        if (res.error) {
            letzter = res.error
            execFileSync('sleep', ['1'])
            continue
        }

        return `${res.stdout ?? ''}\n${res.stderr ?? ''}`
    }
    throw letzter
}

const eventIdAus = (ausgabe: string): string => {
    const zeile = ausgabe
        .split('\n')
        .map((l) => l.trim())
        .find((l) => l.startsWith('{'))
    expect(zeile, `nak hat kein Ereignis ausgegeben: ${ausgabe}`).toBeTruthy()

    return (JSON.parse(zeile as string) as { id: string }).id
}

let sec = ''
let pub = ''
let naddr = ''
const gesaet: string[] = []
const prIds: Record<string, string> = {}

/** Ein Ereignis am Testrelay löschen. **`--auth` ist Pflicht und sein Fehlen lautlos.** */
const loesche = (id: string): void => {
    if (id && sec) {
        nak(['event', '--auth', '--sec', sec, '-k', '5', '-e', id, ZOOID_WS])
    }
}

/** Alle Ereignisse eines Kinds an dieser Repo-Adresse — für die Bestandsreinigung. */
const idsVon = (kind: string, adresse: string): string[] =>
    nak(['req', '--auth', '--sec', sec, '-k', kind, '-t', `a=${adresse}`, ZOOID_WS])
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.startsWith('{'))
        .flatMap((l) => {
            try {
                const e = JSON.parse(l) as { id?: string }

                return e.id ? [e.id] : []
            } catch {
                return []
            }
        })

async function zeigeWorkspaceAufZooid(page: Page): Promise<void> {
    await page.addInitScript((url) => {
        ;(window as unknown as { __nostrWorkspace: string }).__nostrWorkspace = url
    }, `${ZOOID_WS}/`)
}

/**
 * Die Detailseite öffnen und auf den geladenen Zustand warten.
 *
 * Auf den ZUSTAND warten, nicht auf eine Wartezeit: solange `view` `null` ist,
 * existiert die ganze Fläche nicht (`<template x-if="view">`), und jede Messung
 * liefe gegen ein leeres Dokument — grün, ohne etwas geprüft zu haben.
 */
async function oeffneRepo(page: Page, query = ''): Promise<void> {
    await useZooid(page)
    await zeigeWorkspaceAufZooid(page)
    await loginNsec(page, NSEC)
    await page.goto(`/forge/${naddr}${query}`)
    await page.waitForFunction(
        () => {
            const el = document.querySelector('[x-data^="nostrForgeRepo"]')
            const A = (window as unknown as { Alpine?: { $data(e: Element): { view?: unknown } } }).Alpine

            return !!el && !!A && !!A.$data(el).view
        },
        undefined,
        { timeout: 30_000 },
    )
}

/** Den Steckbrief aufklappen — mobil steht er hinter einem `<details>`. */
async function oeffneSteckbrief(page: Page): Promise<void> {
    await page.evaluate(() => {
        document.querySelector<HTMLDetailsElement>('[data-forge-steckbrief]')?.setAttribute('open', '')
    })
}

/** Die aufgeklappte PR-Zeile zu einem Betreff. */
const prBlock = (page: Page, betreff: string) =>
    page.locator('[data-forge-pr]').filter({ hasText: betreff }).first()

test.describe('Forge: der PR-Diff und die Datenlücken des Steckbriefs (P7b)', () => {
    test.beforeAll(() => {
        sec = NSEC
        expect(sec, 'NOSTR_TEST_NSEC ist nicht gesetzt').toBeTruthy()
        pub = nak(['key', 'public', sec]).trim().split('\n')[0]?.trim() ?? ''
        expect(pub).toHaveLength(64)

        const adresse = `30617:${pub}:${REPO_D}`
        naddr = nip19.naddrEncode({ identifier: REPO_D, pubkey: pub, kind: 30617, relays: [] })

        // ── Reinigen, BEVOR gesät wird ──────────────────────────────────────
        // Der worker-eigene zooid überlebt den Lauf. Ein 1618 ist NICHT
        // ersetzbar: ohne diese Reinigung liegt nach dem n-ten Lauf der n-te
        // Vorschlag da, und `filter({hasText})` träfe mehrere Zeilen.
        for (const id of idsVon('1618', adresse)) {
            loesche(id)
        }

        // Das Repository — mit Themen (`t`) und `euc`, beides bis P7b unsichtbar.
        const repo = nak([
            'event', '--auth', '--sec', sec,
            '-k', '30617',
            '-t', `d=${REPO_D}`,
            '-t', `name=${REPO_NAME}`,
            '-t', 'description=E2E Repo fuer den PR-Diff',
            '-t', `clone=${EIGEN_CLONE}`,
            '-t', `t=${THEMA}`,
            '-t', 't=nostr',
            '--tag', `r=${EUC};euc`,
            ZOOID_WS,
        ])
        expect(repo, `Der Relay hat das Test-Repository nicht angenommen: ${repo}`).toContain('success')
        gesaet.push(eventIdAus(repo))

        // Ein ZWEITES Repository mit demselben `euc` — die „gleiche Historie".
        const kopie = nak([
            'event', '--auth', '--sec', sec,
            '-k', '30617',
            '-t', `d=${KOPIE_D}`,
            '-t', `name=${KOPIE_NAME}`,
            '--tag', `r=${EUC};euc`,
            ZOOID_WS,
        ])
        expect(kopie, `Der Relay hat die Repo-Kopie nicht angenommen: ${kopie}`).toContain('success')
        gesaet.push(eventIdAus(kopie))

        // Der Ref-Zustand: ein Branch UND ein Tag. `refs/tags/*` steht als
        // TAG-NAME da, nicht als Wert — die NIP-34-Eigenheit, an der die
        // Tag-Liste hängt.
        const zustand = nak([
            'event', '--auth', '--sec', sec,
            '-k', '30618',
            '-t', `d=${REPO_D}`,
            '-t', `refs/heads/master=${HEAD_COMMIT}`,
            '-t', `refs/tags/${TAG_NAME}=${TAG_COMMIT}`,
            '-t', 'HEAD=ref: refs/heads/master',
            ZOOID_WS,
        ])
        expect(zustand, `Der Relay hat den Ref-Zustand nicht angenommen: ${zustand}`).toContain('success')
        gesaet.push(eventIdAus(zustand))

        // ── Drei Vorschläge, drei Quellenlagen ──────────────────────────────
        // Die clone-URL des EIGENEN Falls zeigt auf denselben Host UND Port wie
        // der Workspace-Relay — siehe die Herleitung an `EIGEN_CLONE`.
        const prs: [string, string[]][] = [
            [PR_EIGEN, [
                '-t', `clone=${EIGEN_CLONE}`,
                '-t', `c=${SPITZE}`, '-t', `merge-base=${BASIS}`,
            ]],
            [PR_FREMD, [
                '-t', `clone=${FREMD_CLONE}`,
                '-t', `c=${SPITZE}`, '-t', `merge-base=${BASIS}`,
            ]],
            [PR_OHNE, [
                '-t', `clone=${EIGEN_CLONE}`,
            ]],
            // Nur der Commit, KEIN Vergleichspunkt — die zweite der drei
            // Lücken. Ohne diesen Fall prüfte der Test unten nur eine von
            // dreien und die Zusage „drei verschiedene Sätze" wäre unbelegt.
            [PR_NUR_C, [
                '-t', `clone=${EIGEN_CLONE}`,
                '-t', `c=${SPITZE}`,
            ]],
        ]
        for (const [betreff, extra] of prs) {
            const out = nak([
                'event', '--auth', '--sec', sec,
                '-k', '1618',
                '-t', `a=${adresse}`,
                '-t', `p=${pub}`,
                '-t', `subject=${betreff}`,
                '-t', 'branch-name=feat/prdiff',
                ...extra,
                '-c', `Rumpf: ${betreff}`,
                ZOOID_WS,
            ])
            expect(out, `Der Relay hat „${betreff}" nicht angenommen: ${out}`).toContain('success')
            prIds[betreff] = eventIdAus(out)
            gesaet.push(prIds[betreff] as string)
        }

        // Annehmen und AUSLIEFERN sind zwei verschiedene Zusagen.
        expect(idsVon('1618', adresse), 'Der Relay gibt nicht genau vier Vorschläge heraus.').toHaveLength(4)
    })

    test.afterAll(() => {
        for (const id of gesaet) {
            loesche(id)
        }
        for (const d of [REPO_D, KOPIE_D]) {
            nak(['event', '--auth', '--sec', sec, '-k', '5', '-t', `a=30617:${pub}:${d}`, '-t', 'k=30617', ZOOID_WS])
        }
    })

    // ── 1. Die Kostenansage ─────────────────────────────────────────────────

    test('DoD: die Kostenansage steht VOR dem Download — am Netzverkehr gemessen', async ({ page }) => {
        const gitAnfragen: string[] = []
        await useZooid(page)
        await zeigeWorkspaceAufZooid(page)
        await loginNsec(page, NSEC)
        // Der Mitschnitt hängt VOR dem ersten `goto`: eine Anfrage, die vor dem
        // Zuhören losgeht, wäre genau die, die dieser Test nicht sehen darf.
        page.on('request', (req) => {
            if (req.url().includes('/git/')) {
                gitAnfragen.push(req.url())
            }
        })
        await page.goto(`/forge/${naddr}?pr=${prIds[PR_EIGEN]}`)
        await page.waitForFunction(
            () => {
                const el = document.querySelector('[x-data^="nostrForgeRepo"]')
                const A = (window as unknown as { Alpine?: { $data(e: Element): { view?: unknown } } }).Alpine

                return !!el && !!A && !!A.$data(el).view
            },
            undefined,
            { timeout: 30_000 },
        )

        const block = prBlock(page, PR_EIGEN)
        const ansage = block.locator('[data-forge-pr-diff-ansage]')
        await expect(ansage).toBeVisible({ timeout: 30_000 })
        // Die Zahl steht IM Text und ist als Messung gekennzeichnet — eine
        // Ansage ohne Größenordnung ist keine.
        await expect(ansage).toContainText('1,1 MB')
        await expect(ansage).toContainText('13 MB')

        // **Der Kernbeweis.** Bis hierher hat die Fläche gerendert, den Reiter
        // geöffnet und die Zeile aufgeklappt — und KEIN Byte am Git-Endpunkt
        // geholt.
        expect(gitAnfragen, `Vor dem Klick gingen Git-Anfragen hinaus: ${gitAnfragen.join(', ')}`).toHaveLength(0)

        // ── POSITIVKONTROLLE ────────────────────────────────────────────────
        // Ohne sie wäre die Zusage darüber auch dann grün, wenn der Mitschnitt
        // grundsätzlich nichts sähe. Der Download scheitert (Port 1 hört nicht)
        // — das ist gleichgültig: gemessen wird, dass er ÜBERHAUPT losgeht,
        // und zwar erst jetzt.
        await block.locator('[data-forge-pr-diff-start]').click()
        await expect
            .poll(() => gitAnfragen.length, { timeout: 30_000, message: 'Nach dem Klick ging keine Git-Anfrage hinaus' })
            .toBeGreaterThan(0)
    })

    // ── 2. Der Fremdhost ────────────────────────────────────────────────────

    test('DoD: ein Tip auf fremdem Host ist eine ruhige Auskunft MIT LINK, kein Fehlerbild', async ({ page }) => {
        await oeffneRepo(page, `?pr=${prIds[PR_FREMD]}`)
        const block = prBlock(page, PR_FREMD)
        const abschnitt = block.locator('[data-forge-pr-diff]')
        await expect(abschnitt).toHaveAttribute('data-quelle', 'fremd', { timeout: 30_000 })

        const hinweis = block.locator('[data-forge-pr-diff-fremd]')
        await expect(hinweis).toBeVisible()
        // Der Host wird BENANNT — „liegt woanders" ohne Ort wäre eine Sackgasse.
        await expect(hinweis).toContainText('github.com')

        const link = block.locator('[data-forge-pr-diff-fremd-link]')
        await expect(link).toBeVisible()
        // Ohne `.git` — das ist die Browser-Adresse desselben Repositories.
        await expect(link).toHaveAttribute('href', 'https://github.com/zwergotter/prdiff')
        await expect(link).toHaveAttribute('target', '_blank')

        // ── Und was NICHT da sein darf ──────────────────────────────────────
        // Der Unterschied zwischen Auskunft und Fehlerbild ist genau das hier.
        await expect(block.locator('[data-forge-pr-diff-fehler]')).toHaveCount(0)
        await expect(abschnitt.locator('[role="alert"]')).toHaveCount(0)
        await expect(abschnitt.locator('[data-flux-callout]')).toHaveCount(0)
        // Kein Knopf, der nichts bewirken kann.
        await expect(block.locator('[data-forge-pr-diff-start]')).toHaveCount(0)
    })

    test('die Lücken werden EINZELN benannt — nicht mit einem gemeinsamen Satz', async ({ page }) => {
        await oeffneRepo(page, `?pr=${prIds[PR_OHNE]}`)

        const beide = prBlock(page, PR_OHNE)
        await expect(beide.locator('[data-forge-pr-diff]')).toHaveAttribute('data-quelle', 'unvollstaendig', {
            timeout: 30_000,
        })
        const satzBeide = (await beide.locator('[data-forge-pr-diff-hinweis]').innerText()).trim()
        // Kein Knopf, der nichts bewirken kann.
        await expect(beide.locator('[data-forge-pr-diff-start]')).toHaveCount(0)

        // Der Vorschlag MIT Commit und ohne Vergleichspunkt steht auf derselben
        // Seite — beide Sätze lassen sich also im selben Lauf gegeneinander
        // halten, ohne zweimal zu laden.
        const nurC = prBlock(page, PR_NUR_C)
        await nurC.getByRole('button').first().click()
        const satzNurC = (await nurC.locator('[data-forge-pr-diff-hinweis]').innerText()).trim()

        // **Das ist die Zusage.** Ein gemeinsamer Satz für zwei verschiedene
        // Lücken wäre die Sorte Begründung, nach der man erst recht fragt.
        expect(satzBeide).not.toBe(satzNurC)
        expect(satzNurC).toContain('merge-base')
        expect(satzBeide).not.toContain('merge-base')
    })

    // ── 3. Die Anzeigelücken aus P7a ────────────────────────────────────────

    test('DoD: Tag-Liste, Themen und verwandte Repositories stehen im Steckbrief', async ({ page }) => {
        await oeffneRepo(page)
        await oeffneSteckbrief(page)

        // Tags: der `refs/tags/*`-Eintrag des 30618, samt Kurzhash.
        const tag = page.locator('[data-forge-tag]').first()
        await expect(tag).toBeVisible({ timeout: 30_000 })
        await expect(tag).toHaveAttribute('data-tag', TAG_NAME)
        await expect(tag).toContainText(TAG_COMMIT.slice(0, 7))
        // Und die drei Leer-Auskünfte stehen NICHT daneben — es gibt ja einen Tag.
        await expect(page.locator('[data-forge-tags-leer]')).toHaveCount(0)
        await expect(page.locator('[data-forge-tags-kein-zustand]')).toHaveCount(0)
        await expect(page.locator('[data-forge-tags-mehrdeutig]')).toHaveCount(0)

        // Themen: die `t`-Tags des 30617.
        await expect(page.locator('[data-forge-thema]').filter({ hasText: THEMA })).toHaveCount(1)

        // Verwandtschaft: dasselbe `euc`, KEINE Richtung.
        const verwandt = page.locator('[data-forge-verwandt]').first()
        await expect(verwandt).toBeVisible()
        await expect(verwandt).toContainText(KOPIE_NAME)
        // Zwei Ebenen hoch: die `<ul>` liegt im `<dd>`, die Beschriftung steht im
        // `<dt>` DANEBEN — ein `xpath=..` allein träfe nur das `<dd>` und die
        // Zusage darunter liefe ins Leere.
        const region = page.locator('[data-forge-verwandte]').locator('xpath=../..')
        // **Die Beschriftung ist die Zusage.** Der `euc` ist eine Äquivalenz ohne
        // Richtung; „Fork von X" behauptete etwas, das im Protokoll nicht steht.
        // Deshalb wird hier ausdrücklich auf die ABWESENHEIT des Wortes geprüft.
        await expect(region).toContainText('Historie')
        expect((await region.innerText()).toLowerCase()).not.toContain('fork')
    })

    // ── 4. Die Vorgangssuche der Detailseite ────────────────────────────────

    test('die Detailseite hat ein Suchfeld, und es filtert die Vorgangsliste', async ({ page }) => {
        await oeffneRepo(page, '?tab=pulls')
        const feld = page.locator('[data-forge-detail-suche-feld]')
        await expect(feld).toBeVisible({ timeout: 30_000 })
        // Der zugängliche Name folgt dem Reiter — ein Feld, das
        // „Issues durchsuchen" heißt und PRs filtert, wäre derselbe Fehler in Grün.
        await expect(feld).toHaveAttribute('aria-label', 'Pull Requests durchsuchen')

        await expect(page.locator('[data-forge-pr]')).toHaveCount(4)
        await feld.fill('fremder')
        await expect(page.locator('[data-forge-pr]')).toHaveCount(1)
        await expect(page.locator('[data-forge-detail-suche-zahl]')).toContainText('1')

        // KONTROLLE: ein Begriff, den keiner trägt, lässt nichts übrig — und sagt
        // es als eigene Aussage statt als generischen Leerzustand.
        await feld.fill('zzzznichtsdrin')
        await expect(page.locator('[data-forge-pr]')).toHaveCount(0)
        await expect(page.locator('[data-forge-detail-suche-leer]')).toBeVisible()
    })
})
