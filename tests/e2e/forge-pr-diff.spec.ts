import { test, expect, type Page } from './support/fixtures'
import { useZooid, ZOOID_PORT, ZOOID_WS } from './support/zooid'
import { loginNsec } from './support/login'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

// ─────────────────────────────────────────────────────────────────────────────
// P7b-N — **DIE ÜBERSETZUNGSSCHICHT: von zwei Commit-Ids zu echten Dateien.**
//
// Der erste Durchgang dieser Phase hat alles VOR dem Download belegt (welche
// Quelle, welche Ansage, welche Auskunft) und alles DANACH (`baueDiff`,
// `vergleicheZeilen` gegen git als Orakel). Ungedeckt blieb genau die Mitte:
// `holePrDateipaare` (Fetch samt Tiefen-Eskalation, `spitze-fehlt`) und
// `sammleUnterschiede` (rekursiver Baumvergleich, Typwechsel Tree↔Blob,
// Submodul-Übersprung, Umbenennung als Löschung+Neuanlage). **Der Erfolgspfad
// `lage === 'da'` wurde von keinem Test je erreicht** — und das ist die Schicht
// mit dem größten Fehlerrisiko: Rekursion, Pfad-Präfixe, Typübergänge.
//
// ── Warum hier trotzdem kein Git-Server läuft ────────────────────────────────
//
// Dieselbe Bauform wie in `forge-readme.spec.ts`, eine Phase zuvor im selben
// Subsystem: `page.route` fängt `/git/**` ab und beantwortet die Anfragen mit
// der Ausgabe des **echten** `git upload-pack --stateless-rpc` gegen ein
// selbst gebautes Bare-Repo. Damit läuft das echte Smart-HTTP-Protokoll —
// pkt-lines, Aushandlung, `deepen`, Packfile — ohne einen Serverprozess. Kein
// Mock: am anderen Ende steht git.
//
// Der Workspace dieses Laufs ist der worker-eigene zooid, und der ist kein
// Git-Server; ein echter Endpunkt gäbe es nur in der Produktion, und dort
// hängt jede Anfrage an einer Bunker-Signatur mit ±60 s Gültigkeit.
// ─────────────────────────────────────────────────────────────────────────────

const GIT_REPO_D = 'e2e-prdiff-git'
/** Der Workspace dieses Laufs als http-Ursprung — die clone-URL MUSS darauf zeigen. */
const WORKSPACE_HTTP = ZOOID_WS.replace(/^ws/, 'http').replace(/\/+$/, '')

const PR_VOLL = 'P7b-N voller Vergleich'
const PR_TIEF = 'P7b-N Vergleichspunkt tiefer'
const PR_SPITZE_WEG = 'P7b-N Spitze fehlt'

let arbeit = ''
let bare = ''
let gitNaddr = ''
let oidA = ''
let oidB = ''
let oidC = ''
const gitIds: string[] = []
const gitPrIds: Record<string, string> = {}

/**
 * Die Ref-Ankündigung — EINMAL gebaut, dann wiederverwendet.
 *
 * Sie ist bei unveränderter Vorlage konstant; je Anfrage einen `git`-Prozess
 * dafür zu starten ist reine Last, und die hat in diesem Repo schon einmal
 * zeitkritische Nachbarspecs gekippt (Herleitung in `forge-readme.spec.ts`).
 * Der `upload-pack`-POST muss ein echter Prozess bleiben, die Ankündigung nicht.
 */
let ankuendigungCache: Buffer | null = null
const ankuendigung = (): Buffer => {
    if (!ankuendigungCache) {
        const adv = execFileSync('git', ['upload-pack', '--stateless-rpc', '--advertise-refs', bare], {
            encoding: 'buffer',
            maxBuffer: 64 * 1024 * 1024,
        })
        ankuendigungCache = Buffer.concat([Buffer.from('001e# service=git-upload-pack\n0000', 'utf8'), adv])
    }

    return ankuendigungCache
}

/** Die Git-Gegenstelle. Gibt einen Zähler zurück — die Grundlage jeder Ansage-Zusage. */
async function verdrahteGit(page: Page): Promise<{ anfragen: number }> {
    const zaehler = { anfragen: 0 }
    await page.route('**/git/**', async (route) => {
        zaehler.anfragen += 1
        const url = route.request().url()
        try {
            if (url.includes('/info/refs')) {
                await route.fulfill({
                    status: 200,
                    headers: { 'content-type': 'application/x-git-upload-pack-advertisement' },
                    body: ankuendigung(),
                })

                return
            }
            const antwort = execFileSync('git', ['upload-pack', '--stateless-rpc', bare], {
                input: route.request().postDataBuffer() ?? Buffer.alloc(0),
                encoding: 'buffer',
                maxBuffer: 64 * 1024 * 1024,
            })
            await route.fulfill({
                status: 200,
                headers: { 'content-type': 'application/x-git-upload-pack-result' },
                body: antwort,
            })
        } catch (e) {
            await route.fulfill({ status: 500, body: String(e) })
        }
    })

    return zaehler
}

/** Die Detailseite des Git-Repos öffnen, mit verdrahteter Gegenstelle. */
async function oeffneGitRepo(page: Page, prId: string): Promise<{ anfragen: number }> {
    await useZooid(page)
    await zeigeWorkspaceAufZooid(page)
    const zaehler = await verdrahteGit(page)
    await loginNsec(page, NSEC)
    await page.goto(`/forge/${gitNaddr}?pr=${prId}`)
    await page.waitForFunction(
        () => {
            const el = document.querySelector('[x-data^="nostrForgeRepo"]')
            const A = (window as unknown as { Alpine?: { $data(e: Element): { view?: unknown } } }).Alpine

            return !!el && !!A && !!A.$data(el).view
        },
        undefined,
        { timeout: 30_000 },
    )

    return zaehler
}

/** Die gerenderte Dateiliste eines PR-Diffs als `[Pfad, Art, +, −]`. */
async function dateiliste(page: Page, betreff: string): Promise<[string, string, string, string][]> {
    const block = prBlock(page, betreff)

    return block.locator('[data-forge-diff-datei]').evaluateAll((knoten) =>
        knoten.map((k) => [
            k.querySelector('.forge-diff-pfad')?.textContent?.trim() ?? '',
            k.getAttribute('data-change') ?? '',
            k.querySelector('[data-forge-diff-plus]')?.textContent?.trim() ?? '',
            k.querySelector('[data-forge-diff-minus]')?.textContent?.trim() ?? '',
        ]) as [string, string, string, string][],
    )
}

test.describe('Forge: der PR-Diff gegen ein ECHTES Repository (P7b-N)', () => {
    test.beforeAll(() => {
        expect(NSEC, 'NOSTR_TEST_NSEC ist nicht gesetzt').toBeTruthy()
        // `sec` und `pub` HIER noch einmal setzen und nicht aus dem ersten
        // `describe` erben: mit `-g` läuft dieser Block allein, und `loesche()`
        // ohne Schlüssel räumt lautlos nichts auf — dieselbe Falle wie ein
        // fehlendes `--auth`.
        sec = NSEC
        pub = nak(['key', 'public', NSEC]).trim().split('\n')[0]?.trim() ?? ''
        expect(pub).toHaveLength(64)
        gitNaddr = nip19.naddrEncode({ identifier: GIT_REPO_D, pubkey: pub, kind: 30617, relays: [] })

        // ── Drei Commits, und jeder trägt einen der riskanten Fälle ─────────
        arbeit = mkdtempSync(join(tmpdir(), 'e2e-prdiff-git-'))
        const quelle = join(arbeit, 'quelle')
        const g = (...args: string[]): string =>
            execFileSync('git', ['-C', quelle, ...args], { encoding: 'utf8' })

        execFileSync('git', ['init', '-q', '-b', 'main', quelle])
        g('config', 'user.email', 't@e.st')
        g('config', 'user.name', 'T')

        // A — der Vergleichspunkt.
        writeFileSync(join(quelle, 'a.txt'), 'eins\nzwei\ndrei\n')
        writeFileSync(join(quelle, 'weg.txt'), 'alt\n')
        // Ein BLOB, der in C zu einem BAUM wird — der Typwechsel.
        writeFileSync(join(quelle, 'wandel'), 'ich war eine Datei\n')
        mkdirSync(join(quelle, 'src'))
        // Bleibt unverändert, liegt aber in einem VERÄNDERTEN Unterbaum: er darf
        // in der Liste NICHT auftauchen, sonst zeigt der Vergleich Dateien an,
        // die sich nicht unterscheiden.
        writeFileSync(join(quelle, 'src', 'tief.txt'), 'unveraendert\n')
        writeFileSync(join(quelle, 'src', 'aendert.txt'), 'vorher\n')
        g('add', '-A')
        // Ein Submodul-Zeiger (gitlink). Sein Inhalt liegt per Konstruktion NICHT
        // in diesem Repository — ein Client, der ihn zu lesen versuchte, bekäme
        // einen Fehler statt eines Diffs.
        g('update-index', '--add', '--cacheinfo', `160000,${'1'.repeat(40)},modul`)
        g('commit', '-qm', 'A')
        oidA = g('rev-parse', 'HEAD').trim()

        // B — eine Zwischenstufe. Sie ist KEIN Ref-Tip und damit der Grund,
        // warum die Tiefen-Eskalation überhaupt laufen muss.
        writeFileSync(join(quelle, 'zwischen.txt'), 'zwischenstand\n')
        g('add', '-A')
        g('commit', '-qm', 'B')
        oidB = g('rev-parse', 'HEAD').trim()

        // C — der vorgeschlagene Stand.
        writeFileSync(join(quelle, 'a.txt'), 'eins\nZWEI\ndrei\n')
        writeFileSync(join(quelle, 'neu.txt'), 'neu\n')
        writeFileSync(join(quelle, 'src', 'aendert.txt'), 'nachher\n')
        rmSync(join(quelle, 'weg.txt'))
        rmSync(join(quelle, 'wandel'))
        mkdirSync(join(quelle, 'wandel'))
        writeFileSync(join(quelle, 'wandel', 'drin.txt'), 'jetzt bin ich ein Baum\n')
        g('add', '-A')
        // Der Submodul-Zeiger bewegt sich — sonst liefe er in den „gleiche
        // Oid"-Zweig und der Übersprung wäre nie geprüft.
        g('update-index', '--add', '--cacheinfo', `160000,${'2'.repeat(40)},modul`)
        g('commit', '-qm', 'C')
        oidC = g('rev-parse', 'HEAD').trim()

        // ── Das nackte Repository: ZWEI Refs ────────────────────────────────
        // `base` zeigt auf A, `main` auf C. Ein Tiefe-1-Fetch über alle Refs
        // liefert damit A und C — und **nicht** B. Genau das trennt die beiden
        // Erfolgsfälle unten: der eine kommt ohne Eskalation aus, der andere
        // nicht.
        bare = join(arbeit, 'r.git')
        execFileSync('git', ['init', '-q', '--bare', '--initial-branch=main', bare])
        g('push', '-q', bare, 'main')
        g('push', '-q', bare, `${oidA}:refs/heads/base`)
        // Vorbedingung: ohne auflösbares HEAD bricht der Client mit
        // `Could not find HEAD` ab — genau daran ist der README-Prüfstand
        // einmal gescheitert.
        expect(
            execFileSync('git', ['-C', bare, 'symbolic-ref', 'HEAD'], { encoding: 'utf8' }).trim(),
        ).toBe('refs/heads/main')

        // ── Das 30617 und drei Vorschläge ───────────────────────────────────
        const adresse = `30617:${pub}:${GIT_REPO_D}`
        for (const id of idsVon('1618', adresse)) {
            loesche(id)
        }
        const cloneUrl = `${WORKSPACE_HTTP}/git/${pub}/${GIT_REPO_D}`
        const repo = nak([
            'event', '--auth', '--sec', NSEC, '-k', '30617',
            '-t', `d=${GIT_REPO_D}`, '-t', `name=${GIT_REPO_D}`,
            '-t', 'description=E2E Repo mit echter Git-Gegenstelle',
            '-t', `clone=${cloneUrl}`,
            ZOOID_WS,
        ])
        expect(repo, `Der Relay hat ${GIT_REPO_D} nicht angenommen: ${repo}`).toContain('success')
        gitIds.push(eventIdAus(repo))

        const prs: [string, string, string][] = [
            [PR_VOLL, oidA, oidC],
            [PR_TIEF, oidB, oidC],
            // Eine Spitze, die es in diesem Repository nicht gibt — der Fall
            // „der Tip liegt in einem Fork".
            [PR_SPITZE_WEG, oidA, 'f'.repeat(40)],
        ]
        for (const [betreff, basis, spitze] of prs) {
            const out = nak([
                'event', '--auth', '--sec', NSEC, '-k', '1618',
                '-t', `a=${adresse}`, '-t', `p=${pub}`,
                '-t', `subject=${betreff}`,
                '-t', `clone=${cloneUrl}`,
                '-t', `merge-base=${basis}`, '-t', `c=${spitze}`,
                '-c', `Rumpf: ${betreff}`,
                ZOOID_WS,
            ])
            expect(out, `Der Relay hat „${betreff}" nicht angenommen: ${out}`).toContain('success')
            gitPrIds[betreff] = eventIdAus(out)
            gitIds.push(gitPrIds[betreff] as string)
        }
        expect(idsVon('1618', adresse), 'Der Relay gibt nicht genau drei Vorschläge heraus.').toHaveLength(3)
    })

    test.afterAll(() => {
        for (const id of gitIds) {
            loesche(id)
        }
        nak(['event', '--auth', '--sec', NSEC, '-k', '5', '-t', `a=30617:${pub}:${GIT_REPO_D}`, '-t', 'k=30617', ZOOID_WS])
        if (arbeit) {
            rmSync(arbeit, { recursive: true, force: true })
        }
    })

    test('VORBEDINGUNG: die Vorlage enthält wirklich alle riskanten Fälle', () => {
        // Ohne sie liefen die Zusagen unten ins Leere: ein Bare-Repo, in dem der
        // Typwechsel oder der Submodul-Zeiger fehlt, macht sie vakuum-grün.
        const zeige = (oid: string, pfad = ''): string =>
            execFileSync('git', ['-C', bare, 'ls-tree', pfad ? `${oid}:${pfad}` : oid], { encoding: 'utf8' })
        expect(oidA).toHaveLength(40)
        expect(oidB).toHaveLength(40)
        expect(oidC).toHaveLength(40)
        expect(oidA).not.toBe(oidB)
        expect(oidB).not.toBe(oidC)
        // Typwechsel: `wandel` ist in A ein Blob und in C ein Baum.
        expect(zeige(oidA)).toMatch(/blob \w+\twandel$/m)
        expect(zeige(oidC)).toMatch(/tree \w+\twandel$/m)
        // Submodul-Zeiger, und er BEWEGT sich — sonst prüft der Übersprung nichts.
        expect(zeige(oidA)).toContain(`160000 commit ${'1'.repeat(40)}\tmodul`)
        expect(zeige(oidC)).toContain(`160000 commit ${'2'.repeat(40)}\tmodul`)
        // Unveränderte Datei in einem VERÄNDERTEN Unterbaum.
        expect(zeige(oidA, 'src')).toContain('tief.txt')
        expect(zeige(oidC, 'src')).toContain('tief.txt')
        expect(zeige(oidA, 'src')).not.toBe(zeige(oidC, 'src'))
    })

    test('DoD: der geladene PR-Diff rendert eine Dateiliste mit +/− Zahlen', async ({ page }) => {
        const zaehler = await oeffneGitRepo(page, gitPrIds[PR_VOLL] as string)
        const block = prBlock(page, PR_VOLL)

        // Vor dem Klick: die Ansage, und KEINE Anfrage.
        await expect(block.locator('[data-forge-pr-diff-ansage]')).toBeVisible({ timeout: 30_000 })
        expect(zaehler.anfragen, 'Vor dem Klick ging eine Git-Anfrage hinaus').toBe(0)

        await block.locator('[data-forge-pr-diff-start]').click()
        // **`lage === 'da'` — der Erfolgspfad, den bis hierher kein Test erreicht hat.**
        await expect(block.locator('[data-forge-pr-diff]')).toHaveAttribute('data-lage', 'da', {
            timeout: 60_000,
        })
        expect(zaehler.anfragen, 'Nach dem Klick ging keine Git-Anfrage hinaus').toBeGreaterThan(0)

        // ── Die gerenderte Dateiliste, Zeile für Zeile ──────────────────────
        // Als Ganzes verglichen und nicht Stück für Stück: eine zusätzliche
        // Zeile (etwa `src/tief.txt`, das sich gar nicht unterscheidet) fiele
        // bei Einzelabfragen nicht auf.
        expect(await dateiliste(page, PR_VOLL)).toEqual([
            ['a.txt', 'mod', '+1', '−1'],
            ['neu.txt', 'add', '+1', '−0'],
            ['src/aendert.txt', 'mod', '+1', '−1'],
            // Der Typwechsel: der BLOB ist fort …
            ['wandel', 'del', '+0', '−1'],
            // … und der gleichnamige Baum bringt seinen Inhalt als Neuanlage mit.
            ['wandel/drin.txt', 'add', '+1', '−0'],
            ['weg.txt', 'del', '+0', '−1'],
            ['zwischen.txt', 'add', '+1', '−0'],
        ])

        // Die Kopfzeile zählt dasselbe.
        await expect(block.locator('[data-forge-pr-diff-stat]')).toContainText('7')
        // 1 (a.txt) + 1 (src/aendert.txt) + 1 (wandel, der geloeschte Blob)
        // + 1 (weg.txt) = 4. Die Kopfzahl wird gegen die SUMME der Zeilen oben
        // gehalten, nicht gegen eine getippte Erwartung — mein erster Wert (3)
        // hatte den geloeschten Blob des Typwechsels unterschlagen.
        await expect(block.locator('[data-forge-pr-diff-plus]')).toHaveText('+5')
        await expect(block.locator('[data-forge-pr-diff-minus]')).toHaveText('−4')

        // Und der Diff-KÖRPER trägt echten Inhalt aus dem Repository, nicht nur
        // Zahlen: ohne diese Zeile wäre eine leere Zeilenliste grün.
        await expect(block.locator('[data-forge-diff-datei]').first()).toContainText('ZWEI')
    })

    test('der Submodul-Zeiger und die unveränderte Datei im geänderten Unterbaum fehlen — mit Absicht', async ({ page }) => {
        await oeffneGitRepo(page, gitPrIds[PR_VOLL] as string)
        const block = prBlock(page, PR_VOLL)
        await block.locator('[data-forge-pr-diff-start]').click()
        await expect(block.locator('[data-forge-pr-diff]')).toHaveAttribute('data-lage', 'da', { timeout: 60_000 })

        const pfade = (await dateiliste(page, PR_VOLL)).map(([pfad]) => pfad)
        // `modul` bewegt sich zwischen A und C, ist aber ein gitlink: sein Inhalt
        // liegt nicht in diesem Repository. Ihn als „geändert" zu zeigen hiesse,
        // einen Diff zu behaupten, den niemand lesen kann.
        expect(pfade, 'Der Submodul-Zeiger steht in der Liste').not.toContain('modul')
        // Der Unterbaum `src` hat sich geändert, `src/tief.txt` darin nicht.
        expect(pfade, 'Eine unveränderte Datei steht in der Liste').not.toContain('src/tief.txt')
        expect(pfade, 'Der geänderte Nachbar im selben Unterbaum fehlt').toContain('src/aendert.txt')
    })

    test('liegt der Vergleichspunkt tiefer als ein Ref-Tip, wird EINMAL nachvertieft', async ({ page }) => {
        // `merge-base` ist hier Commit B — kein Ref-Tip. Ein Tiefe-1-Fetch
        // liefert nur A und C; ohne die Eskalation auf `PR_DIFF_TIEFE` endete
        // dieser Fall in `basis-fehlt`.
        const zaehler = await oeffneGitRepo(page, gitPrIds[PR_TIEF] as string)
        const block = prBlock(page, PR_TIEF)
        await block.locator('[data-forge-pr-diff-start]').click()
        await expect(block.locator('[data-forge-pr-diff]')).toHaveAttribute('data-lage', 'da', { timeout: 60_000 })

        // Gegen B fehlt `zwischen.txt` — es steckt bereits IN B. Das ist der
        // sichtbare Beleg, dass wirklich gegen den tieferen Punkt gerechnet
        // wurde und nicht gegen A.
        expect(await dateiliste(page, PR_TIEF)).toEqual([
            ['a.txt', 'mod', '+1', '−1'],
            ['neu.txt', 'add', '+1', '−0'],
            ['src/aendert.txt', 'mod', '+1', '−1'],
            ['wandel', 'del', '+0', '−1'],
            ['wandel/drin.txt', 'add', '+1', '−0'],
            ['weg.txt', 'del', '+0', '−1'],
        ])
        // Mehr als eine Runde: Ankündigung, Tiefe 1, Ankündigung, Tiefe 50.
        expect(zaehler.anfragen, 'Es lief nur eine einzige Anfrage — dann gab es keine Eskalation').toBeGreaterThan(2)
    })

    test('eine Spitze, die der Endpunkt nicht kennt, ist eine AUSKUNFT — kein Fehlerbild', async ({ page }) => {
        await oeffneGitRepo(page, gitPrIds[PR_SPITZE_WEG] as string)
        const block = prBlock(page, PR_SPITZE_WEG)
        await block.locator('[data-forge-pr-diff-start]').click()
        await expect(block.locator('[data-forge-pr-diff]')).toHaveAttribute('data-lage', 'fehler', {
            timeout: 60_000,
        })
        const kasten = block.locator('[data-forge-pr-diff-fehler]')
        // Der Satz sagt, WAS ist — er behauptet nicht, etwas sei kaputt.
        await expect(kasten).toContainText('Kopie des Repositories')
        await expect(kasten).toContainText('nicht abrufbar')
        // `variant="secondary"`, nicht `danger`: ein Vorschlag aus einem Fork ist
        // eine erlaubte Bauform von NIP-34, kein Defekt dieses Clients.
        //
        // Gemessen wird die FARBE, nicht ein Attributwert: `data-flux-callout`
        // ist bei jeder Variante leer, ein `not.toHaveAttribute(…, 'danger')`
        // waere also vakuum-gruen. Die Variante steckt in den
        // `--callout-*`-Klassen — `secondary` zieht `--color-zinc-*`, `danger`
        // `--color-red-*`.
        const klassen = (await kasten.getAttribute('class')) ?? ''
        expect(klassen, 'Der Kasten traegt die Gefahren-Farbe').not.toContain('color-red')
        expect(klassen, 'Der Kasten traegt gar keine Callout-Farbe — misst die Sonde noch?').toContain('--callout-border')
        await expect(block.locator('[data-forge-diff-datei]')).toHaveCount(0)
    })
})
