import { test, expect, type Page } from './support/fixtures'
import { useZooid, ZOOID_WS } from './support/zooid'
import { loginNsec } from './support/login'
import { execFileSync, spawnSync } from 'node:child_process'

const NSEC = process.env.NOSTR_TEST_NSEC as string
const NAK = process.env.NAK ?? `${process.env.HOME}/go/bin/nak`

/**
 * DIE DESKTOP-BÜHNE DER FORGE (P4, Plan
 * `2026-08-23T1745-forge-mobil-desktop-amethyst.md`, Schritt 16–19).
 *
 * Drei Zusagen, alle drei vorher gemessen widerlegt gewesen:
 *
 *   1. **Genau EIN sichtbares `aria-current="page"`.** Gemessen am Stand vor P4
 *      trugen auf `/forge` @1920 ZWEI sichtbare Elemente dasselbe `href=/forge`:
 *      die Rail-Zeile (295 px) und die Ortskarte (496 px). Bei 1279 px war es
 *      eines. Zwei „du bist hier"-Markierungen auf dasselbe Ziel sind keine
 *      Redundanz, sondern eine Zweideutigkeit.
 *   2. **Die längste Textzeile der Bühne bleibt im Lesekanon 45–75 Zeichen.**
 *      Vorher: 203 Zeichen bei 1920 px, 208 bei 2560 px (eine
 *      Repo-Beschreibung über die volle Deckelbreite).
 *   3. **Kein waagerechter Dokument-Überlauf** auf beiden Breiten (WCAG 1.4.10) —
 *      dieselbe Zusage wie der 320-px-Wächter in `forge-ueberlauf.spec.ts`, hier
 *      am anderen Ende der Skala.
 *
 * ── Warum dieser Test ECHTE Daten sät ────────────────────────────────────────
 * Eine Zeilenlängen-Zusage über eine leere Fläche ist Dekoration: ohne Inhalt ist
 * die längste Zeile die Leermeldung („Sobald jemand ein Repository ankündigt…",
 * die ohnehin auf `max-w-sm` gedeckelt ist), und der Test wäre auch dann grün,
 * wenn der Deckel der Repo-Zeile ersatzlos entfiele.
 *
 * Deshalb legt er ein 30617 mit einer ABSICHTLICH überlangen Beschreibung an
 * (über 200 Zeichen). Erst damit misst er den Fall, gegen den er geschrieben ist.
 * Das ist zugleich die Nacharbeit an einem offenen Punkt aus dem Entwurf: die
 * Desktop-Geometrien waren am LEERZUSTAND gemessen, weil das Produktions-Relay
 * dem Wegwerf-Schlüssel die NIP-42-Auth verweigerte.
 *
 * ── Der Workspace ist hier der worker-eigene zooid ───────────────────────────
 * `serverEnv.ts:117` setzt `NOSTR_WORKSPACE_URL` im Normalmodus auf den
 * worker-eigenen Relay. Ein 30617 dorthin ist damit ein Repository DIESER Forge —
 * kein Buzz-Stack nötig, und der Lauf bleibt im `desktop`-Projekt, das im
 * Buzz-Modus ohnehin nicht fährt (`playwright.config.ts`).
 *
 * ── Warum die GETEILTE Test-Identität, obwohl 30617 adressierbar ist ────────
 * Der erste Entwurf nahm ein frisches Wegwerf-Keypair — die Hausregel für
 * schreibende Sonden auf ersetzbare Kinds (NIP-01: 30000er). Der worker-eigene
 * zooid hat es abgelehnt, und zwar mit Ansage:
 *
 *     `restricted: you are not a member of this relay`
 *
 * Er ist ein NIP-29-Gruppenrelay; schreiben darf nur, wen `zooid-testserver.sh`
 * per `allowpubkey` zugelassen hat. Ein frischer Schlüssel ist dort per
 * Konstruktion niemand.
 *
 * Der GRUND der Regel bleibt trotzdem gewahrt, und darauf kommt es an: sie
 * schützt davor, ein vorhandenes ersetzbares Event derselben Adresse zu
 * überschreiben, von dem es keine zweite Kopie gibt. Die Adresse hier ist
 * `30617:<testnutzer>:e2e-desktopbuehne` — ein `d`-Wert, den kein anderer Spec
 * und kein Seed dieses Repos benutzt (`grep -rn "e2e-desktopbuehne"` trifft nur
 * diese Datei). Es gibt also nichts zu überschreiben. Wer das `d` je ein zweites
 * Mal vergibt, hebt diese Begründung auf.
 *
 * Aufgeräumt wird per NIP-09 (kind 5 auf die Event-id), wie in `articles.ts`:
 * der worker-eigene zooid überlebt den Lauf.
 */

const REPO_D = 'e2e-desktopbuehne'
const REPO_NAME = 'e2e-desktopbuehne'

/**
 * Über 200 Zeichen, ohne überlanges Einzelwort — ein Wortungetüm bräche nicht
 * um und wäre ein anderer Fehler (Überlauf), nicht der hier gemeinte
 * (Zeilenlänge).
 */
const LANGE_BESCHREIBUNG =
    'Das Chat-, Artikel- und Forge-Paket des Vereins buendelt Livewire-Full-Page-SFCs, ' +
    'Alpine-Inseln auf welshman, NIP-29-Raeume, NIP-34-Repositories und ein Workspace-Relay ' +
    'hinter NIP-42 — ausgeliefert in acht Sprachen und in zwei voneinander unabhaengigen Hosts.'

/** Ab wie vielen Zeichen ein Element als „Fliesstext" gilt und mitgemessen wird. */
const FLIESSTEXT_AB = 40

/**
 * `nak` mit stdout UND stderr.
 *
 * Nur stdout zu lesen war der erste Fehlversuch dieses Tests: `nak event` druckt
 * das Ereignis auf stdout, OB ES ANGENOMMEN WURDE oder nicht — die Quittung des
 * Relays geht nach stderr. Der Test hielt eine Event-Id in der Hand, das Relay
 * hatte nichts gespeichert, und die Fehlermeldung zeigte auf die Bühne statt auf
 * den Publish. Dieselbe Vorsicht wie in `buzz-forge.spec.ts` (dort `.toContain('success')`).
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

let besitzerSec = ''
let besitzerPub = ''
let repoEventId = ''

/**
 * Die längste Fließtextzeile innerhalb der Bühne, in ZEICHEN.
 *
 * Zeichen und nicht Pixel, weil der Lesekanon in Zeichen spricht — und weil das
 * hier exakt geht: `--font-sans` ist Inconsolata, eine Zellenschrift. Die
 * Zellenbreite wird pro Element an einer Sonde IM SELBEN Element gemessen (nicht
 * geschätzt und nicht aus der Schriftgröße gerechnet), damit Schriftgröße,
 * `letter-spacing` und Vererbung mitgehen.
 *
 * Gemessen wird die BOX-Breite, nicht die Textbreite: eine umbrechende Zeile
 * füllt ihre Box, und genau die Box ist es, die der Deckel begrenzt.
 */
async function laengsteZeile(page: Page): Promise<{ zeichen: number; text: string; klasse: string } | null> {
    return page.evaluate((ab) => {
        const buehne = document.querySelector('#buehne')
        if (!buehne) return null

        let bestes: { zeichen: number; text: string; klasse: string } | null = null
        for (const el of Array.from(buehne.querySelectorAll<HTMLElement>('*'))) {
            // Nur Elemente mit EIGENEM Text: sonst zählt jeder Container die Zeile
            // seiner Kinder ein zweites Mal, und der Messwert hinge an der
            // Verschachtelungstiefe statt an der Zeile.
            const eigen = Array.from(el.childNodes)
                .filter((n) => n.nodeType === Node.TEXT_NODE)
                .map((n) => n.textContent ?? '')
                .join('')
                .trim()
            if (eigen.length < ab) continue
            if (el.checkVisibility?.() === false) continue
            const breite = el.getBoundingClientRect().width
            if (breite <= 0) continue

            const cs = getComputedStyle(el)
            const probe = document.createElement('span')
            probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre'
            probe.style.font = cs.font
            probe.style.letterSpacing = cs.letterSpacing
            probe.textContent = '0'.repeat(100)
            el.appendChild(probe)
            const zelle = probe.getBoundingClientRect().width / 100
            probe.remove()
            if (!(zelle > 0)) continue

            const zeichen = Math.round(breite / zelle)
            if (!bestes || zeichen > bestes.zeichen) {
                bestes = { zeichen, text: eigen.slice(0, 60), klasse: (el.getAttribute('class') || '').slice(0, 60) }
            }
        }

        return bestes
    }, FLIESSTEXT_AB)
}

async function sichtbaresAriaCurrent(page: Page): Promise<{ href: string; inRail: boolean; text: string }[]> {
    return page.evaluate(() =>
        Array.from(document.querySelectorAll<HTMLElement>('[aria-current="page"]'))
            .filter((el) => el.checkVisibility?.() !== false && el.getBoundingClientRect().width > 0)
            .map((el) => ({
                href: (el.getAttribute('href') || '').replace(/^https?:\/\/[^/]+/, ''),
                inRail: !!el.closest('[data-rail]'),
                text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 30),
            })),
    )
}

/**
 * Den WORKSPACE der Insel auf den worker-eigenen zooid zeigen.
 *
 * `serverEnv.ts:117` setzt `NOSTR_WORKSPACE_URL` für den SERVER — davon hängt ab,
 * ob die Fläche überhaupt gerendert wird. Der CLIENT liest seinen Workspace aber
 * aus `window.__nostrWorkspace`, und `useZooid` setzt nur `__nostrSpace`.
 *
 * Gemessen, weil der erste Entwurf genau daran vorbeilief: das Repository lag auf
 * dem Relay (Publish `success`, Rückfrage lieferte `"kind":30617`), die Bühne
 * zeigte trotzdem `repos: 0` — die Insel fragte gar nicht, weil ihr Workspace der
 * leere String war. Der Test wäre ohne diesen Griff eine Messung an einer leeren
 * Fläche gewesen, und zwar eine grüne.
 *
 * Gleiche Bauform wie `useWorkspace()` in `buzz-forge.spec.ts`.
 */
async function zeigeWorkspaceAufZooid(page: Page): Promise<void> {
    await page.addInitScript((url) => {
        ;(window as unknown as { __nostrWorkspace: string }).__nostrWorkspace = url
    }, `${ZOOID_WS}/`)
}

async function oeffneForge(page: Page, breite: number): Promise<void> {
    await useZooid(page)
    await zeigeWorkspaceAufZooid(page)
    await page.setViewportSize({ width: breite, height: 1000 })
    await loginNsec(page, NSEC)
    await page.goto('/forge')
    // Auf den ZUSTAND warten, nicht auf eine Wartezeit: solange `loading` steht,
    // sind beide Regionen per `x-show` aus, und jede Messung liefe gegen 0 —
    // grün, ohne irgendetwas geprüft zu haben.
    await page.waitForFunction(
        () => {
            const el = document.querySelector('[x-data^="nostrForge"]')
            const daten = el && (window as unknown as { Alpine?: { $data(e: Element): { loading?: boolean } } }).Alpine
                ? (window as unknown as { Alpine: { $data(e: Element): { loading?: boolean } } }).Alpine.$data(el)
                : null

            return !!daten && daten.loading === false
        },
        undefined,
        { timeout: 30_000 },
    )
    const stand = await page.evaluate(() => {
        const el = document.querySelector('[x-data^="nostrForge"]')
        const d = el && (window as unknown as { Alpine?: { $data(e: Element): Record<string, unknown> } }).Alpine
            ? (window as unknown as { Alpine: { $data(e: Element): Record<string, unknown> } }).Alpine.$data(el)
            : null

        const w = window as unknown as Record<string, unknown>

        return {
            repos: (d?.overview as { repos?: unknown[] })?.repos?.length ?? -1,
            zweispaltig: d?.zweispaltig,
            fehler: d?.error,
            kind: d?.kind,
            workspace: w.__nostrWorkspace ?? '(nicht gesetzt)',
            space: w.__nostrSpace ?? '(nicht gesetzt)',
            kachel: document.querySelector('[data-forge-tile="repos"]')?.textContent,
        }
    })
    console.log(`[desktop-forge] Inselstand @${breite}px: ${JSON.stringify(stand)}`)
    await expect(page.locator('[data-forge-repo]').first()).toBeVisible({ timeout: 30_000 })
}

test.describe('Forge: die Desktop-Bühne', () => {
    test.beforeAll(() => {
        besitzerSec = NSEC
        expect(besitzerSec, 'NOSTR_TEST_NSEC ist nicht gesetzt').toBeTruthy()

        const ausgabe = nak([
            'event',
            '--auth',
            '--sec', besitzerSec,
            '-k', '30617',
            '-t', `d=${REPO_D}`,
            '-t', `name=${REPO_NAME}`,
            '-t', `description=${LANGE_BESCHREIBUNG}`,
            '-t', 'clone=https://example.invalid/git/e2e-desktopbuehne',
            ZOOID_WS,
        ])
        console.log(`[desktop-forge] Publish-Quittung: ${ausgabe.trim().split('\n').slice(-3).join(' | ')}`)
        // Der Relay muss BESTÄTIGEN. Ohne diese Zeile hielte der Test eine
        // Event-Id in der Hand, während nichts gespeichert wurde — und die
        // Fehlermeldung zeigte später auf die Bühne statt auf den Publish.
        expect(ausgabe, `Der Relay hat das Test-Repository nicht angenommen: ${ausgabe}`).toContain('success')
        const zeile = ausgabe
            .split('\n')
            .map((l) => l.trim())
            .find((l) => l.startsWith('{'))
        expect(zeile, `nak hat kein Ereignis ausgegeben: ${ausgabe}`).toBeTruthy()
        repoEventId = (JSON.parse(zeile as string) as { id: string }).id
        expect(repoEventId).toHaveLength(64)

        besitzerPub = nak(['key', 'public', besitzerSec]).trim().split('\n')[0]?.trim() ?? ''
        expect(besitzerPub).toHaveLength(64)

        // Und der Relay muss es auch WIEDER HERAUSGEBEN. Annehmen und ausliefern
        // sind zwei verschiedene Zusagen — ein Gruppenrelay darf ein Ereignis
        // speichern und trotzdem nicht auf eine REQ antworten.
        const zurueck = nak(['req', '--auth', '--sec', besitzerSec, '-k', '30617', '-t', `d=${REPO_D}`, ZOOID_WS])
        console.log(`[desktop-forge] Rueckfrage: ${zurueck.trim().split('\n').slice(-2).join(' | ').slice(0, 200)}`)
        expect(zurueck, `Der Relay gibt das Test-Repository nicht wieder heraus: ${zurueck}`).toContain('"kind":30617')
    })

    test.afterAll(() => {
        // Der worker-eigene zooid überlebt den Lauf (RUNMARK-Wiederverwendung) —
        // ohne dies stünde bei jedem weiteren Lauf ein zweites Repo in der Liste.
        //
        // **`--auth` ist Pflicht, und sein Fehlen ist LAUTLOS.** Der worker-eigene
        // zooid nimmt ein kind 5 OHNE NIP-42 nicht an: `nak` druckt trotzdem das
        // signierte Löschereignis, aber der Relay antwortet mit
        // `auth-required: authentication is required for access` statt `success` —
        // die alte Fassung dieser Zeile prüfte das nie. Am 2026-08-25 direkt am
        // laufenden Testrelay gemessen (Requery, nicht die `nak`-Ausgabe): OHNE
        // `--auth` blieb ein frisches 30617 nach `kind 5 -e <id>` unverändert
        // abrufbar; MIT `--auth` war es weg — zweimal reproduziert. Backlog zum
        // Messzeitpunkt: 84 liegengebliebene Test-Repositories über 18
        // Worker-Instanzen, ausschließlich aus dieser Lücke und der
        // strukturgleichen in `desktop-forge-feinschliff.spec.ts`.
        //
        // **`-t a=… -t k=30617` zusätzlich zu `-e`**, weil ein 30617 ADRESSIERBAR
        // ist (NIP-09) — mit `--auth` ist die `-e`-Form allein am aktuellen
        // zooid-Stand bereits ausreichend (ebenfalls gemessen), die a/k-Form ist
        // hier redundante Absicherung nach demselben Muster wie in
        // `desktop-forge-feinschliff.spec.ts`.
        if (repoEventId && besitzerSec) {
            nak(['event', '--auth', '--sec', besitzerSec, '-k', '5', '-e', repoEventId, ZOOID_WS])
            if (besitzerPub) {
                nak(['event', '--auth', '--sec', besitzerSec, '-k', '5', '-t', `a=30617:${besitzerPub}:${REPO_D}`, '-t', 'k=30617', ZOOID_WS])
            }
        }
    })

    /**
     * NEGATIVKONTROLLE zur Zeilen-Sonde.
     *
     * Ohne sie wüsste niemand, ob ein grüner Lauf „die Zeilen sind kurz genug"
     * bedeutet oder „die Sonde findet gar keine Zeile". Eingehängt wird ein
     * Absatz über die volle Bühnenbreite OHNE Deckel — genau die Form, die vor
     * P4 die echte Repo-Beschreibung hatte. Die Sonde MUSS ihn finden und über
     * 75 Zeichen melden.
     */
    test('KONTROLLE: die Zeilen-Sonde erkennt eine ungedeckelte Zeile', async ({ page }) => {
        await oeffneForge(page, 1920)

        const vorher = await laengsteZeile(page)
        expect(vorher, 'Die Sonde findet auf der gefüllten Bühne gar keine Fließtextzeile — sie misst nichts.').not.toBeNull()

        await page.evaluate((text) => {
            const p = document.createElement('p')
            p.setAttribute('data-kontrolle-zeile', '')
            p.style.cssText = 'display:block;width:100%;font-size:14px'
            p.textContent = text
            document.querySelector('#buehne')?.appendChild(p)
        }, LANGE_BESCHREIBUNG)

        const nachher = await laengsteZeile(page)
        expect(
            nachher?.zeichen,
            `Eine ungedeckelte Zeile über die volle Bühnenbreite wurde von der Sonde nicht als zu lang erkannt (vorher ${vorher?.zeichen}, nachher ${nachher?.zeichen}) — der Wächter ist blind.`,
        ).toBeGreaterThan(75)
    })

    /**
     * NEGATIVKONTROLLE zur `aria-current`-Sonde: ein zweites, künstlich
     * eingehängtes `aria-current="page"` MUSS mitgezählt werden. Sonst bewiese
     * eine gemeldete `1` nur, dass die Sonde nichts findet.
     */
    test('KONTROLLE: die aria-current-Sonde zaehlt ein zweites Vorkommen mit', async ({ page }) => {
        await oeffneForge(page, 1920)
        expect(await sichtbaresAriaCurrent(page)).toHaveLength(1)

        await page.evaluate(() => {
            const a = document.createElement('a')
            a.setAttribute('aria-current', 'page')
            a.setAttribute('href', '/forge')
            a.textContent = 'Kontrolle'
            a.style.cssText = 'display:block;width:120px;height:20px'
            document.querySelector('#buehne')?.appendChild(a)
        })

        expect(
            await sichtbaresAriaCurrent(page),
            'Ein zweites sichtbares aria-current wurde nicht gezählt — die Sonde misst nichts.',
        ).toHaveLength(2)
    })

    for (const breite of [1920, 2560]) {
        test(`bei ${breite} px traegt genau EIN sichtbares Element aria-current="page"`, async ({ page }) => {
            await oeffneForge(page, breite)

            const treffer = await sichtbaresAriaCurrent(page)
            console.log(`[desktop-forge] aria-current @${breite}px: ${JSON.stringify(treffer)}`)
            expect(
                treffer,
                `Auf /forge @${breite}px tragen ${treffer.length} sichtbare Elemente aria-current="page": ${JSON.stringify(treffer)}`,
            ).toHaveLength(1)
            // Und zwar die Rail-Zeile — nicht die Ortskarte: ab `xl` beantwortet
            // der Navigator „wo bin ich", die Ortsleiste ist dort ausgeblendet.
            expect(treffer[0].inRail, 'Das eine aria-current steht nicht im Navigator').toBe(true)
        })

        test(`bei ${breite} px bleibt die laengste Zeile im Lesekanon 45-75 Zeichen`, async ({ page }) => {
            await oeffneForge(page, breite)

            // Vorbedingung: das geseedete Repo mit der überlangen Beschreibung ist
            // wirklich da. Ohne sie misst der Test eine Fläche ohne langen Text und
            // wäre auch dann grün, wenn jeder Deckel entfiele.
            await expect(
                page.locator('[data-forge-repo]').filter({ hasText: REPO_NAME }).first(),
                'Das geseedete Repository steht nicht in der Werkbank — der Test hätte keinen langen Text zu messen.',
            ).toBeVisible({ timeout: 30_000 })

            const laengste = await laengsteZeile(page)
            console.log(`[desktop-forge] laengste Zeile @${breite}px: ${JSON.stringify(laengste)}`)
            expect(laengste, 'Keine Fließtextzeile gefunden').not.toBeNull()
            expect(
                laengste!.zeichen,
                `Die längste Zeile misst ${laengste!.zeichen} Zeichen (Kanon 45–75): „${laengste!.text}…" auf .${laengste!.klasse}`,
            ).toBeLessThanOrEqual(75)
            expect(
                laengste!.zeichen,
                `Die längste Zeile misst nur ${laengste!.zeichen} Zeichen — unter dem Lesekanon von 45.`,
            ).toBeGreaterThanOrEqual(45)
        })

        test(`bei ${breite} px laeuft das Dokument nicht waagerecht ueber`, async ({ page }) => {
            await oeffneForge(page, breite)

            const dok = await page.evaluate(() => ({
                scrollWidth: document.documentElement.scrollWidth,
                clientWidth: document.documentElement.clientWidth,
            }))
            expect(
                dok.scrollWidth,
                `/forge läuft bei ${breite} px quer über — scrollWidth=${dok.scrollWidth} clientWidth=${dok.clientWidth}`,
            ).toBeLessThanOrEqual(dok.clientWidth)
        })
    }

    /**
     * Die Bühne steht wirklich ZWEISPALTIG — Werkbank und Spur gleichzeitig, ohne
     * Tab-Leiste. Ohne diese Zusage wären die drei Messungen oben auch dann grün,
     * wenn der ganze Umbau ausbliebe und nur die Ortsleiste verschwände.
     */
    test('Werkbank und Spur stehen gleichzeitig, die Tab-Leiste ist fort', async ({ page }) => {
        await oeffneForge(page, 1920)

        await expect(page.locator('#forge-werkbank')).toBeVisible()
        await expect(page.locator('#forge-spur')).toBeVisible()
        await expect(page.locator('[data-forge-tabs]')).toBeHidden()
        await expect(page.getByRole('tab')).toHaveCount(0)
        // Die Kanäle führt ab `xl` der Navigator; der Bühnen-Panel entfällt.
        await expect(page.locator('[data-forge-workspaces]')).toBeHidden()

        const spalten = await page.locator('.forge-raster').evaluate((el) => getComputedStyle(el).gridTemplateColumns)
        console.log(`[desktop-forge] Rasterspalten @1920px: ${spalten}`)
        expect(
            spalten.split(/\s+/).filter(Boolean),
            `Das Raster hat keine zwei Spuren: ${spalten}`,
        ).toHaveLength(2)
    })

    /**
     * DIE FLUCHTLINIE — jeder Spaltenkopf steht über seiner eigenen Zelle.
     *
     * Das ist die Zusage der ganzen Signatur: die Spalten sind in `ch` deklariert
     * und fluchten deshalb ohne `<table>` und ohne `subgrid`. Sie bricht STILL,
     * und sie ist genau einmal gebrochen: die Kopfzeile trug `text-[0.7rem]` auf
     * demselben Element, das die `ch`-Spuren definiert. `ch` löst gegen die
     * EIGENE Schriftgröße auf — die Kopfspalten rechneten gegen 11,2 px statt
     * gegen 14 px und standen 56 px neben ihren Zellen. Kein Test wurde rot, die
     * Seite sah nur falsch aus.
     *
     * Negativkontrolle: dieselbe Sonde bekommt die Kopfzeile künstlich verkleinert
     * und MUSS den Versatz dann melden.
     */
    test('die Spaltenkoepfe fluchten mit ihren Zellen', async ({ page }) => {
        await oeffneForge(page, 1920)

        const kanten = () =>
            page.evaluate(() => {
                const links = (wurzel: Element | null) =>
                    wurzel
                        ? Array.from(wurzel.children).map((el) => Math.round(el.getBoundingClientRect().left))
                        : []

                return {
                    kopf: links(document.querySelector('.forge-kopfzeile > .forge-daten')),
                    zeile: links(document.querySelector('.forge-zeile > .forge-daten')),
                }
            })

        const vorher = await kanten()
        console.log(`[desktop-forge] Spaltenkanten: ${JSON.stringify(vorher)}`)
        // Vorbedingung: beide Raster haben überhaupt Spuren, und gleich viele.
        expect(vorher.kopf.length, 'Die Kopfzeile hat keine Spalten — die Sonde misst nichts.').toBe(4)
        expect(vorher.zeile.length, 'Die Datenzeile hat keine Spalten — die Sonde misst nichts.').toBe(4)
        expect(
            vorher.zeile,
            `Spaltenköpfe und Zellen fluchten nicht: Kopf ${JSON.stringify(vorher.kopf)}, Zeile ${JSON.stringify(vorher.zeile)}`,
        ).toEqual(vorher.kopf)

        // ── KONTROLLE ────────────────────────────────────────────────────────
        // Die Schriftgröße des KOPF-Rasters künstlich senken — genau der Fehler,
        // der einmal drin war. Die Sonde muss ihn sehen.
        await page.evaluate(() => {
            const kopf = document.querySelector<HTMLElement>('.forge-kopfzeile > .forge-daten')
            if (kopf) kopf.style.fontSize = '0.7rem'
        })
        const nachher = await kanten()
        expect(
            nachher.zeile,
            'Mit künstlich verkleinerter Kopfzeile fluchten die Spalten immer noch — die Sonde misst nicht die Spurbreiten.',
        ).not.toEqual(nachher.kopf)
    })

    /**
     * Die DETAILSEITE spricht dieselbe Sprache.
     *
     * `/forge/{naddr}` läuft ebenfalls mit `width="wide"` (96 rem) und hatte
     * damit dasselbe Problem: eine Beschreibung über die volle Deckelbreite.
     * Ohne diesen Fall wäre der Umbau auf halbem Weg stehengeblieben —
     * Übersicht im Lesemaß, Detail nicht.
     */
    test('die Repo-Detailseite haelt bei 1920 px dasselbe Textmass', async ({ page }) => {
        await oeffneForge(page, 1920)
        await page.locator('[data-forge-repo]').filter({ hasText: REPO_NAME }).first().click()

        // Vorbedingung 1: wir sind WIRKLICH auf der Detailseite. Ohne diese Zeile
        // maß der erste Lauf die Übersicht weiter — die gemeldete Klasse war die
        // der Listenzeile (`line-clamp-2 text-muted`), nicht die der
        // Repo-Beschreibung. Ein grüner Test über die falsche Seite.
        await page.waitForURL(/\/forge\/naddr1/, { timeout: 30_000 })
        await expect(page.locator('[data-forge-repo]')).toHaveCount(0)

        // Vorbedingung 2: die überlange Beschreibung steht wirklich auf DIESER Seite.
        //
        // **Nicht mehr ein bloßes `p.forge-mass`.** Seit der GitHub-Parität trägt
        // die Repo-Detailseite eine ZWEITE Fläche mit derselben Klasse: die
        // Aktivitätszeile eines Patches (`x-text="row.body"`,
        // `⚡forge-repo.blade.php`) zeigt hier zufällig denselben Text — dieses
        // Fixture-Repository hat eine Commit-Beschreibung, die mit der
        // Repo-Beschreibung übereinstimmt. `.first()` traf dort die
        // `x-show`-verborgene Zeile statt die „Über"-Spur (Locator löste zwar
        // auf, `toBeVisible()` schlug fehl). Auf `[data-forge-spur="ueber"]`
        // verankert — genau der Abschnitt, der die Beschreibung TRÄGT
        // (`aside.forge-repo-spur`, Abschnitt „1. Über").
        await expect(
            page.locator('[data-forge-spur="ueber"] p').filter({ hasText: /Das Chat-, Artikel- und Forge-Paket/ }).first(),
        ).toBeVisible({ timeout: 30_000 })

        const laengste = await laengsteZeile(page)
        console.log(`[desktop-forge] laengste Zeile auf der Detailseite @1920px: ${JSON.stringify(laengste)}`)
        expect(laengste, 'Keine Fließtextzeile auf der Detailseite gefunden').not.toBeNull()
        expect(
            laengste!.zeichen,
            `Die längste Zeile der Detailseite misst ${laengste!.zeichen} Zeichen (Kanon 45–75): „${laengste!.text}…" auf .${laengste!.klasse}`,
        ).toBeLessThanOrEqual(75)
    })

    /**
     * `?tab=` ohne Tabs. Ein geteilter Link auf `?tab=repos` darf ab `xl` nicht
     * ins Leere zeigen — er wird zum Sprung: die Region kommt in den Blick, und
     * der Fokus landet auf ihrer Überschrift (damit auch ein Screenreader-Leser
     * dort ankommt und nicht nur die Bildlaufleiste).
     */
    test('?tab=repos springt ab xl zur Werkbank und setzt den Fokus auf ihre Ueberschrift', async ({ page }) => {
        await useZooid(page)
        await zeigeWorkspaceAufZooid(page)
        await page.setViewportSize({ width: 1920, height: 700 })
        await loginNsec(page, NSEC)
        await page.goto('/forge?tab=repos')

        await expect
            .poll(
                () =>
                    page.evaluate(() => {
                        const aktiv = document.activeElement as HTMLElement | null

                        return {
                            titel: aktiv?.getAttribute('data-forge-region-titel') !== null,
                            region: aktiv?.closest('[data-forge-region]')?.getAttribute('data-forge-region') ?? '',
                        }
                    }),
                { timeout: 30_000, message: 'Der Fokus ist nicht auf der Werkbank-Überschrift gelandet' },
            )
            .toEqual({ titel: true, region: 'repos' })

        // Und die Adresse behauptet weiter, was sie gezeigt hat.
        expect(new URL(page.url()).searchParams.get('tab')).toBe('repos')
    })
})
