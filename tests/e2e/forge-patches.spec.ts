import { test, expect, type Page } from './support/fixtures'
import { useZooid, ZOOID_WS } from './support/zooid'
import { loginNsec } from './support/login'
import { execFileSync, spawnSync } from 'node:child_process'
import { nip19 } from 'nostr-tools'
import { measure } from './support/contrast'

const NSEC = process.env.NOSTR_TEST_NSEC as string
const NAK = process.env.NAK ?? `${process.env.HOME}/go/bin/nak`

/**
 * PATCHES (kind 1617) UND DIE REPO-SUCHE — P5 des Plans
 * `2026-08-23T1745-forge-mobil-desktop-amethyst.md`.
 *
 * Vier Zusagen, und alle vier waren vor diesem Lauf unerfüllbar, weil die
 * Fläche kind 1617 überhaupt nicht kannte:
 *
 *   1. **Ein Patch erscheint.** Sein Diff steht IM Ereignis — kein Clone, keine
 *      Auth, kein CORS. Amethyst liest ihn, Buzz Desktop zählt ihn; wir waren
 *      der einzige der drei Clients, der ihn nicht zeigte.
 *   2. **Sein Titel kommt aus dem `Subject:`-Header, auch wenn der GEFALTET
 *      ist.** Das ist die Zusage, die man am leichtesten grün fälscht: ein kurz
 *      getippter Testbetreff faltet nie, und dann prüft der Test die Faltung
 *      nicht. Deshalb ist die Vorlage hier echte `git format-patch`-Ausgabe mit
 *      einem absichtlich überlangen Betreff.
 *   3. **Der Diff ist lesbar** — Zusatz- und Löschzeilen stehen mit ihrem
 *      Vorzeichen da, und die `--`-Signatur von `git format-patch` ist KEINE
 *      Löschzeile.
 *   4. **Die Suche findet ein Repo über den Maintainer als npub UND als Hex.**
 *      Im Ereignis steht Hex; ein Mensch fügt einen npub ein.
 *
 * ── Warum dieser Test sein eigenes 1617 sät ─────────────────────────────────
 *
 * Weil im Bestand des Produktions-Workspace **ungeprüft** ist, ob überhaupt
 * eines liegt. Der Versuch, das zu messen, ist am 2026-08-23 an der
 * NIP-42-Auth gescheitert: `nak req --auth` gegen
 * `wss://buzz.einundzwanzig.space` endete mit
 * `CLOSED: auth-required: not authenticated`, und die **Positivkontrolle
 * (kind 30617) scheiterte genauso**. Damit ist die Abwesenheit von 1617 dort
 * nicht gemessen, sondern unmessbar — eine `0` hätte nur bewiesen, dass der
 * Testschlüssel kein Relay-Mitglied ist. Der Schreibweg existiert
 * (`buzz-cli patches send`, `buzz-sdk::build_git_patch`), also wird gesät wie
 * in `desktop-forge.spec.ts` für 30617.
 *
 * ── Die Identität ist die GETEILTE, und das ist begründet ───────────────────
 *
 * Ein frisches Wegwerf-Keypair lehnt der worker-eigene zooid ab
 * (`restricted: you are not a member of this relay`) — er ist ein
 * NIP-29-Gruppenrelay. Die Hausregel für schreibende Sonden auf ERSETZBARE
 * Kinds bleibt trotzdem gewahrt: `30617:<testnutzer>:e2e-patchleser` ist ein
 * `d`, das kein anderer Spec und kein Seed dieses Repos benutzt
 * (`grep -rn "e2e-patchleser"` trifft nur diese Datei), es gibt also nichts zu
 * überschreiben. Das 1617 selbst ist gar nicht ersetzbar (kind < 10000).
 * Aufgeräumt wird per NIP-09.
 */

const REPO_D = 'e2e-patchleser'
const REPO_NAME = 'e2e-patchleser'

/**
 * Ein zweiter Maintainer, nur damit die Suche etwas zu finden hat, das NICHT
 * schon im Namen steht. Fester Hex-Wert statt eines erzeugten Schlüssels: der
 * Test vergleicht ihn mit seiner eigenen npub-Form, und beide müssen über
 * Läufe hinweg dieselben bleiben, damit ein Fehlschlag reproduzierbar ist.
 */
const MAINTAINER_HEX = '40b87b4cc62aeb820b10b4e652b26ba7e6793933736185ee2b821dafa2683b49'
const MAINTAINER_NPUB = nip19.npubEncode(MAINTAINER_HEX)

/**
 * Die Signatur, die `git format-patch` an jeden Patch hängt.
 *
 * Zusammengesetzt statt getippt: die erste Zeile endet auf `-- ` MIT
 * Leerzeichen (byte-geprüft mit `cat -A`), und jeder Formatierer, der
 * Zeilenenden putzt, entschärfte den Fall lautlos.
 */
const SIGNATUR = '--' + ' \n2.55.0\n'

/**
 * Wörtlich die Ausgabe von `git format-patch -1 --stdout` (git 2.55.0,
 * 2026-08-23) aus einem eigens dafür angelegten Repo. Der Betreff läuft
 * absichtlich über die Faltgrenze von ~78 Zeichen, damit die Faltung im Test
 * WIRKLICH eintritt.
 */
const PATCH_TEXT = `From 0f045fdca6168c4866121bb40cd27a8888c6ab9f Mon Sep 17 00:00:00 2001
From: Test <t@e.st>
Date: Sun, 23 Aug 2026 22:14:02 +0200
Subject: [PATCH] Ein absichtlich sehr langer Betreff der garantiert ueber die
 Faltgrenze von achtundsiebzig Zeichen hinauslaeuft

Diese Beschreibung steht zwischen Kopf und Diff.
---
 a.txt   | 2 +-
 neu.txt | 1 +
 weg.txt | 1 -
 3 files changed, 2 insertions(+), 2 deletions(-)

diff --git a/a.txt b/a.txt
index f00189a..8686969 100644
--- a/a.txt
+++ b/a.txt
@@ -1,3 +1,3 @@
 eins
-zwei
+ZWEI
 drei
diff --git a/neu.txt b/neu.txt
new file mode 100644
index 0000000..4879932
--- /dev/null
+++ b/neu.txt
@@ -0,0 +1 @@
+neu
diff --git a/weg.txt b/weg.txt
deleted file mode 100644
index f0d0f63..0000000
--- a/weg.txt
+++ /dev/null
@@ -1 +0,0 @@
-alt
` + SIGNATUR

/** Der vollständige Betreff — entfaltet und ohne `[PATCH]`. */
const VOLLER_BETREFF =
    'Ein absichtlich sehr langer Betreff der garantiert ueber die Faltgrenze von achtundsiebzig Zeichen hinauslaeuft'
/** Was ein Leser sähe, der nur die ERSTE Header-Zeile nimmt. */
const TORSO = 'Ein absichtlich sehr langer Betreff der garantiert ueber die'

/**
 * `nak` mit stdout UND stderr.
 *
 * `nak event` druckt das Ereignis auf stdout, OB ES ANGENOMMEN WURDE oder
 * nicht — die Quittung des Relays geht nach stderr. Gleiche Vorsicht wie in
 * `desktop-forge.spec.ts`.
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

let besitzerSec = ''
let besitzerPub = ''
let repoEventId = ''
let patchEventId = ''

/**
 * Ein Ereignis am Testrelay löschen (NIP-09).
 *
 * **`--auth` ist Pflicht, und sein Fehlen ist lautlos.** Der worker-eigene
 * zooid nimmt ein kind 5 OHNE NIP-42 nicht an — `nak` druckt trotzdem das
 * signierte Ereignis, und der Aufräumcode sieht aus, als hätte er gewirkt.
 * Gemessen am 2026-08-23: nach vier Läufen lagen **14 Patch-Ereignisse** auf dem
 * Relay und **null** kind 5. Mit `--auth` quittiert derselbe Relay `success`,
 * und das Ziel ist danach nicht mehr abfragbar.
 *
 * (Dieselbe Lücke stand bis 2026-08-25 auch in `desktop-forge.spec.ts` — dort
 * fiel sie lange nicht auf, weil ein 30617 ERSETZBAR ist und ein zweiter Lauf
 * denselben Platz überschreibt, statt einen zweiten Eintrag anzuhäufen; ein
 * 1617 ist es nicht und häuft sich. Behoben dort ebenfalls per `--auth`.)
 */
const loesche = (id: string): void => {
    if (!id || !besitzerSec) {
        return
    }
    nak(['event', '--auth', '--sec', besitzerSec, '-k', '5', '-e', id, ZOOID_WS])
}

/**
 * Ein adressierbares 30617 zusätzlich über die a/k-Form löschen (NIP-09).
 *
 * `loesche()` per `-e <id>` reicht am aktuellen zooid-Stand mit `--auth` bereits
 * aus (am 2026-08-25 direkt gemessen: Requery nach `-e`+`--auth` liefert 0 Treffer)
 * — diese Form ist redundante Absicherung nach demselben Muster wie in
 * `desktop-forge-feinschliff.spec.ts`, falls sich das Verhalten je ändert.
 */
const loescheRepo = (dtag: string): void => {
    if (!besitzerSec || !besitzerPub) {
        return
    }
    nak(['event', '--auth', '--sec', besitzerSec, '-k', '5', '-t', `a=30617:${besitzerPub}:${dtag}`, '-t', 'k=30617', ZOOID_WS])
}

/** Alle 1617 dieses Testrepos, die noch von früheren Läufen herumliegen. */
const alte1617 = (adresse: string): string[] => {
    const ausgabe = nak(['req', '--auth', '--sec', besitzerSec, '-k', '1617', '-t', `a=${adresse}`, ZOOID_WS])

    return ausgabe
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.startsWith('{'))
        .flatMap((l) => {
            try {
                const e = JSON.parse(l) as { id?: string; kind?: number }

                return e.kind === 1617 && e.id ? [e.id] : []
            } catch {
                return []
            }
        })
}

/** Den WORKSPACE der Insel auf den worker-eigenen zooid zeigen. */
async function zeigeWorkspaceAufZooid(page: Page): Promise<void> {
    await page.addInitScript((url) => {
        ;(window as unknown as { __nostrWorkspace: string }).__nostrWorkspace = url
    }, `${ZOOID_WS}/`)
}

/** Die Forge-Übersicht öffnen und auf den GELADENEN Zustand warten. */
async function oeffneForge(page: Page): Promise<void> {
    await useZooid(page)
    await zeigeWorkspaceAufZooid(page)
    await loginNsec(page, NSEC)
    // `?tab=repos` und nicht `/forge`: dieses Projekt fährt den MOBILEN
    // Viewport, dort ist die Bühne einspaltig und der Startwert des Tabs ist
    // „Aktivität". Die Werkbank stünde also per `x-show` aus, und jede Messung
    // liefe gegen eine unsichtbare Liste — der erste Lauf ist genau daran
    // gescheitert (11 × „resolved to <a data-forge-repo> … unexpected value
    // hidden"). Auf der zweispaltigen Bühne ab 56 rem ist der Parameter
    // wirkungslos; der Test läuft damit in beiden Formen.
    await page.goto('/forge?tab=repos')
    // Auf den ZUSTAND warten, nicht auf eine Wartezeit: solange `loading` steht,
    // ist die Werkbank per `x-show` aus, und jede Messung liefe gegen 0 — grün,
    // ohne irgendetwas geprüft zu haben.
    await page.waitForFunction(
        () => {
            const el = document.querySelector('[x-data^="nostrForge"]')
            const A = (window as unknown as { Alpine?: { $data(e: Element): { loading?: boolean } } }).Alpine

            return !!el && !!A && A.$data(el).loading === false
        },
        undefined,
        { timeout: 30_000 },
    )
    await expect(page.locator('[data-forge-repo]').first()).toBeVisible({ timeout: 30_000 })
}

/** Von der Übersicht in die Detailseite des Testrepos und auf den Patches-Tab. */
async function oeffnePatches(page: Page): Promise<void> {
    await oeffneForge(page)
    await page.locator('[data-forge-repo]').filter({ hasText: REPO_NAME }).first().click()
    // Der Patches-Tab wird GEKLICKT und nicht über `?tab=` angesteuert: so
    // prüft der Lauf nebenbei, dass es ihn wirklich gibt und dass er schaltet.
    //
    // `/^Patches/` statt `{ name: 'Patches', exact: true }`: der Reiter trägt seit
    // P1 (2026-08-26) einen Bestandszähler IM Accessible Name („Patches 3") —
    // Bestand ist keine Benachrichtigung, wer die Reiterreihe hört, will ihn
    // hören. Ein loses `'Patches'` wäre eine Teilzeichenkette und träfe auch eine
    // Zeile, die das Wort nur enthält (der Grund für das alte `exact`); der
    // ANKER am Zeilenanfang hält genau das fern und lässt nur die Zahl dahinter
    // zu. `getByRole('tab')` schränkt zusätzlich auf Reiter ein.
    await page.getByRole('tab', { name: /^Patches/ }).click()
    await expect(page.locator('[data-forge-patch]').first()).toBeVisible({ timeout: 30_000 })
}

test.describe('Forge: Patches lesen und Repos durchsuchen', () => {
    test.beforeAll(() => {
        besitzerSec = NSEC
        expect(besitzerSec, 'NOSTR_TEST_NSEC ist nicht gesetzt').toBeTruthy()

        const repo = nak([
            'event', '--auth', '--sec', besitzerSec,
            '-k', '30617',
            '-t', `d=${REPO_D}`,
            '-t', `name=${REPO_NAME}`,
            '-t', 'description=E2E Repo fuer den Patchleser',
            '-t', 'clone=https://example.invalid/git/e2e-patchleser',
            '-t', `maintainers=${MAINTAINER_HEX}`,
            ZOOID_WS,
        ])
        expect(repo, `Der Relay hat das Test-Repository nicht angenommen: ${repo}`).toContain('success')
        repoEventId = eventIdAus(repo)
        expect(repoEventId).toHaveLength(64)

        besitzerPub = nak(['key', 'public', besitzerSec]).trim().split('\n')[0]?.trim() ?? ''
        expect(besitzerPub).toHaveLength(64)

        // ── Den Bestand reinigen, BEVOR gesät wird ─────────────────────────
        // Der worker-eigene zooid überlebt den Lauf (RUNMARK-Wiederverwendung),
        // und ein 1617 ist NICHT ersetzbar: ohne diese Reinigung liegt nach dem
        // n-ten Lauf der n-te Patch da, und jede Zählzusage misst etwas anderes
        // als sie behauptet.
        const adresse = `30617:${besitzerPub}:${REPO_D}`
        for (const alt of alte1617(adresse)) {
            loesche(alt)
        }

        const patch = nak([
            'event', '--auth', '--sec', besitzerSec,
            '-k', '1617',
            '-t', `a=30617:${besitzerPub}:${REPO_D}`,
            '-t', 'commit=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
            '-t', 't=root',
            '-c', PATCH_TEXT,
            ZOOID_WS,
        ])
        // **Der Relay muss BESTÄTIGEN.** Ohne diese Zeile hielte der Test eine
        // Event-Id in der Hand, während nichts gespeichert wurde — und die
        // Fehlermeldung zeigte später auf die Fläche statt auf den Publish.
        // Sie ist hier zugleich der Nachweis, dass zooid kind 1617 überhaupt
        // annimmt; ein Gruppenrelay darf eine Kind-Liste führen.
        expect(patch, `Der Relay hat das Test-Patch nicht angenommen: ${patch}`).toContain('success')
        patchEventId = eventIdAus(patch)

        // Annehmen und AUSLIEFERN sind zwei verschiedene Zusagen.
        const zurueck = nak(['req', '--auth', '--sec', besitzerSec, '-k', '1617', '-i', patchEventId, ZOOID_WS])
        expect(zurueck, `Der Relay gibt das Test-Patch nicht wieder heraus: ${zurueck}`).toContain('"kind":1617')

        // **Die Vorbedingung der Zählzusage.** Genau EINS, nicht „mindestens
        // eins": die Kachel-Prüfung unten wäre sonst am durchlaufenden
        // Zwischenwert grün, ohne je den Endstand zu sehen.
        expect(alte1617(adresse), 'Auf dem Relay liegt mehr als ein Test-Patch.').toHaveLength(1)
    })

    test.afterAll(() => {
        // Der worker-eigene zooid überlebt den Lauf (RUNMARK-Wiederverwendung) —
        // ohne dies stünde bei jedem weiteren Lauf ein zweiter Patch in der Liste.
        for (const id of [patchEventId, repoEventId]) {
            loesche(id)
        }
        loescheRepo(REPO_D)
    })

    // ── Vorbedingung ────────────────────────────────────────────────────────

    test('VORBEDINGUNG: die Vorlage faltet ihren Betreff wirklich', () => {
        // Ohne sie liefe die Faltungszusage darunter ins Leere: ein kurzer
        // Betreff faltet nie, und der Test wäre grün, ohne den Fall zu berühren.
        expect(PATCH_TEXT).toContain('\n Faltgrenze von')
        expect(PATCH_TEXT).toMatch(/\n-- \n2\.55\.0/)
        expect(VOLLER_BETREFF.startsWith(TORSO)).toBe(true)
        expect(VOLLER_BETREFF).not.toBe(TORSO)
    })

    // ── Die Zusagen zum Patch ───────────────────────────────────────────────

    test('ein 1617 erscheint überhaupt — mit Zähler in der Zustandszeile', async ({ page }) => {
        await oeffneForge(page)
        // Die Kachel steht NUR da, wenn es Patches gibt (bewusst anders als
        // Repos/Issues/PRs, wo eine `0` eine Aussage ist).
        // Genau `1`, und das trägt nur wegen der Bestandsreinigung im
        // `beforeAll`: `toHaveText` POLLT, und die Zahl wächst beim Laden von 0
        // hoch. Lägen mehrere Patches auf dem Relay, erwischte die Zusage den
        // durchlaufenden Zwischenwert `1` und wäre grün, obwohl am Ende 16
        // dastünden — genau so ist sie beim ersten Bauen grün gewesen (gemessen:
        // Kachel „16", Zusage „1", trotzdem bestanden).
        await expect(page.locator('[data-forge-tile="patches"]')).toHaveText('1')
    })

    test('DoD: der Titel ist der ENTFALTETE Subject-Header, nicht sein Torso', async ({ page }) => {
        await oeffnePatches(page)
        const titel = page.locator('[data-forge-patch-titel]').first()
        await expect(titel).toHaveText(VOLLER_BETREFF)

        // Und der Gegenbeweis: der Torso allein wäre falsch, und der
        // Git-Header („From <sha> Mon Sep 17…") erst recht.
        const text = (await titel.textContent()) ?? ''
        expect(text).not.toBe(TORSO)
        expect(text.startsWith('From ')).toBe(false)
        expect(text).not.toContain('[PATCH')
    })

    test('DoD: der Diff ist lesbar — Dateien, Vorzeichen, Zeilen', async ({ page }) => {
        await oeffnePatches(page)
        await page.locator('[data-forge-patch]').first().locator('button').first().click()

        const diff = page.locator('[data-forge-diff]').first()
        await expect(diff).toBeVisible()
        // Drei Dateien, in der Reihenfolge des Patches.
        await expect(page.locator('[data-forge-diff-datei]')).toHaveCount(3)
        await expect(page.locator('[data-forge-diff-datei]').nth(0)).toContainText('a.txt')
        await expect(page.locator('[data-forge-diff-datei]').nth(1)).toContainText('neu.txt')
        await expect(page.locator('[data-forge-diff-datei]').nth(2)).toContainText('weg.txt')

        // Die geänderte Zeile steht mit BEIDEN Fassungen da.
        await expect(diff.locator('[data-kind="del"]').filter({ hasText: 'zwei' }).first()).toBeVisible()
        await expect(diff.locator('[data-kind="add"]').filter({ hasText: 'ZWEI' }).first()).toBeVisible()

        // Genau zwei Zusätze und zwei Löschungen — nicht drei.
        await expect(diff.locator('[data-kind="add"]')).toHaveCount(2)
        await expect(diff.locator('[data-kind="del"]')).toHaveCount(2)
    })

    test('SIGNATUR-WÄCHTER: `--`/`2.55.0` steht in keiner Diff-Zeile', async ({ page }) => {
        // Der Fehler, den ein naiver Leser macht: den Hunk „bis zum nächsten
        // `diff --git`" konsumieren. Dann wird die Git-Signatur zur dritten
        // Löschung, und der Leser sieht eine Änderung, die im Patch nicht steht.
        await oeffnePatches(page)
        await page.locator('[data-forge-patch]').first().locator('button').first().click()
        await expect(page.locator('[data-forge-diff]').first()).toBeVisible()

        const zeilen = await page.locator('[data-forge-diff] .forge-diff-zeile').allTextContents()
        expect(zeilen.length).toBeGreaterThan(0)
        expect(zeilen.some((z) => z.includes('2.55.0'))).toBe(false)
    })

    test('die Commit-Beschreibung steht als KLARTEXT da, nicht als HTML', async ({ page }) => {
        await oeffnePatches(page)
        await page.locator('[data-forge-patch]').first().locator('button').first().click()
        const body = page.locator('[data-forge-patch-body]').first()
        await expect(body).toHaveText('Diese Beschreibung steht zwischen Kopf und Diff.')
        // Nichts aus dem Diff darf hier hereinragen.
        await expect(body).not.toContainText('diff --git')
        await expect(body).not.toContainText('@@')
    })

    test('KEIN waagerechter Dokument-Überlauf, obwohl der Diff scrollt (WCAG 1.4.10)', async ({ page }) => {
        // Der Diff-Körper hat einen EIGENEN Scroll-Kontext. Ohne ihn schöbe
        // eine lange Codezeile das ganze Dokument nach rechts — genau der
        // Defekt, den der 320-px-Wächter aus P3 bewacht.
        await page.setViewportSize({ width: 320, height: 800 })
        await oeffnePatches(page)
        await page.locator('[data-forge-patch]').first().locator('button').first().click()
        await expect(page.locator('[data-forge-diff]').first()).toBeVisible()

        const mass = await page.evaluate(() => ({
            scroll: document.documentElement.scrollWidth,
            client: document.documentElement.clientWidth,
        }))
        expect(mass.scroll, `Dokument läuft über: ${mass.scroll}/${mass.client}`).toBeLessThanOrEqual(mass.client)
    })

    // ── Die Zusagen zur Suche ───────────────────────────────────────────────

    test('DoD: die Suche findet das Repo über den Maintainer-NPUB', async ({ page }) => {
        await oeffneForge(page)
        await page.locator('[data-forge-suche-feld]').fill(MAINTAINER_NPUB)
        await expect(page.locator('[data-forge-repo]').filter({ hasText: REPO_NAME })).toHaveCount(1)
    })

    test('DoD: die Suche findet das Repo über den Maintainer-HEX', async ({ page }) => {
        await oeffneForge(page)
        await page.locator('[data-forge-suche-feld]').fill(MAINTAINER_HEX)
        await expect(page.locator('[data-forge-repo]').filter({ hasText: REPO_NAME })).toHaveCount(1)
    })

    test('KONTROLLE: ein FREMDER npub findet es nicht — sonst filterte die Suche gar nicht', async ({ page }) => {
        // Ohne diese Gegenprobe wären die beiden Zusagen darüber auch dann
        // grün, wenn das Feld überhaupt nichts täte.
        await oeffneForge(page)
        await page.locator('[data-forge-suche-feld]').fill(nip19.npubEncode('f'.repeat(64)))
        await expect(page.locator('[data-forge-repo]').filter({ hasText: REPO_NAME })).toHaveCount(0)
        await expect(page.locator('[data-forge-empty="suche"]')).toBeVisible()
    })

    test('die Suche nennt ihre Grenze und lässt sich zurücksetzen', async ({ page }) => {
        await oeffneForge(page)
        const vorher = await page.locator('[data-forge-repo]').count()
        expect(vorher).toBeGreaterThan(0)

        await page.locator('[data-forge-suche-feld]').fill(REPO_NAME)
        // Die Gesamtzahl bleibt im Bild — sonst hielte jemand die gefilterte
        // Liste für den Bestand des Workspace.
        await expect(page.locator('[data-forge-suche-zahl]')).toBeVisible()
        await expect(page.locator('[data-forge-suche-zahl]')).toContainText(String(vorher))

        await page.locator('[data-forge-suche-leeren]').click()
        await expect(page.locator('[data-forge-repo]')).toHaveCount(vorher)
        await expect(page.locator('[data-forge-suche-zahl]')).toBeHidden()
    })

    test('K4: Suchfeld und Leeren-Knopf sind grosse genug (WCAG 2.5.8)', async ({ page }) => {
        // Diese Messung gehört eigentlich in K1–K4 der App — dort ist sie aber
        // unmöglich: jener Prüfstand bringt kein Relay mit, `overview.repos` ist
        // leer, und das Suchfeld steht per `x-show` unsichtbar im Dokument
        // (gemessen: `{imDom:true, sichtbar:false, repos:0}`). Hier liegen echte
        // Daten, also wird hier gemessen.
        await oeffneForge(page)
        await page.locator('[data-forge-suche-feld]').fill('x')
        for (const wahl of ['[data-forge-suche-feld]', '[data-forge-suche-leeren]']) {
            // Auf die BEDINGUNG warten, nicht auf eine Wartezeit. `boundingBox()`
            // ist eine Einzelmessung ohne Auto-Wait, und der Leeren-Knopf hängt an
            // `x-show="suche !== ''"` — also an einer Alpine-Reaktion auf das
            // `input`-Ereignis von `fill()`. Wer sofort misst, misst manchmal den
            // Zustand DAVOR: `null` statt eines Kastens. Isoliert 3/3 grün, im
            // vollen Dateilauf auf frischem Slot einmal rot
            // (`p5n2-dateilauf-frischer-slot41.log`) — das Bild einer Wettlaufs,
            // nicht eines fehlenden Bestands.
            await expect(
                page.locator(wahl).first(),
                `${wahl} ist nach der Eingabe nicht sichtbar geworden`,
            ).toBeVisible({ timeout: 10_000 })
            const kasten = await page.locator(wahl).first().boundingBox()
            expect(kasten, `${wahl} hat keinen Kasten`).not.toBeNull()
            expect(Math.round(kasten?.width ?? 0), `${wahl} zu schmal`).toBeGreaterThanOrEqual(24)
            expect(Math.round(kasten?.height ?? 0), `${wahl} zu niedrig`).toBeGreaterThanOrEqual(24)
        }
    })

    test('K2: das Suchfeld bekommt bei Tastaturfokus einen SICHTBAREN Ring', async ({ page }) => {
        // Ein Fokus, den man nicht sieht, ist keiner (WCAG 2.4.7). Gemessen wird
        // die tatsächlich gerechnete Darstellung, nicht die Klassenliste — ein
        // `ring-*` ist ein `box-shadow` und kann von einem späteren `shadow-*`
        // am selben Element lautlos überschrieben werden (die Herleitung steht
        // in `CLAUDE.md` der App: „A ring is a box-shadow — prefer outline").
        await oeffneForge(page)
        const feld = page.locator('[data-forge-suche-feld]').first()
        const ohne = await feld.evaluate((el) => {
            const cs = getComputedStyle(el)

            return `${cs.outlineStyle}|${cs.outlineWidth}|${cs.boxShadow}`
        })
        await feld.focus()
        const mit = await feld.evaluate((el) => {
            const cs = getComputedStyle(el)

            return `${cs.outlineStyle}|${cs.outlineWidth}|${cs.boxShadow}`
        })
        expect(mit, `Fokus ändert die Darstellung nicht: ${ohne}`).not.toBe(ohne)
    })

    test('K3: das Suchfeld hat einen zugänglichen Namen', async ({ page }) => {
        // Ein Suchfeld, dessen Name nur im `placeholder` steht, verliert ihn
        // beim Tippen. Genau dieser Defekt ist in diesem Projekt schon dreimal
        // behoben worden — hier wird er nicht zum vierten Mal eingebaut.
        await oeffneForge(page)
        const name = await page.locator('[data-forge-suche-feld]').evaluate((el) => {
            const e = el as HTMLElement

            return (
                e.getAttribute('aria-label') ||
                (e.getAttribute('aria-labelledby')
                    ? document.getElementById(e.getAttribute('aria-labelledby') as string)?.textContent
                    : '') ||
                ''
            ).trim()
        })
        expect(name.length, 'Das Suchfeld hat keinen zugänglichen Namen.').toBeGreaterThan(0)
    })

    /**
     * DIE DIFF-ZAHLEN HALTEN IHREN KONTRAST — der Riegel, der P1 im Gate gefehlt hat.
     *
     * ── Warum es ihn braucht, und warum genau hier ────────────────────────────
     * P1 (2026-08-26) hat die vier Diff-Zahlen von getöntem Text auf
     * `flux:badge color="green|red"` gehoben und dafür Zahlen protokolliert. Eine
     * davon war FALSCH: das Messskript bildete Flux' Klassenwahl von Hand nach und
     * nahm für Rot die 800er-Stufe, obwohl der Stub `text-red-700` rendert
     * (Tailwinds Palette ist zwischen den Farbtönen nicht einheitlich). Der wahre
     * Wert lag gut einen Punkt tiefer — über der Schwelle, aber eben nicht dort,
     * wo es im Protokoll stand.
     *
     * **Der eigentliche Mangel war nicht die Zahl, sondern dass nichts sie hielt.**
     * Eine protokollierte Zahl altert still, und der nächste Leser glaubt ihr, WEIL
     * sie protokolliert ist. Gemessen wird deshalb ab hier am gerenderten Baum, in
     * beiden Themes, mit dem Haus-Helfer (`support/contrast.ts`) — der kennt die
     * `oklab`-Serialisierung von Tailwind v4 und komponiert Alpha über den echten
     * Untergrund, statt einen Zahlen-Regex darauf loszulassen.
     *
     * Dieser Spec ist der Ort, weil er als einziger einen ECHTEN Patch mit ECHTEM
     * Diff sät: die Patch-Zeile trägt `+n`/`−n` auf `surface-card`, der aufgeklappte
     * Diff-Kopf dieselben Zahlen auf `zinc-50` — zwei verschiedene Untergründe,
     * beide gefordert.
     *
     * Schwelle: die Zahlen sind TEXT (1.4.3, 4,5:1), nicht Grafik. Der Helfer leitet
     * sie aus der gerenderten Schrift ab statt sie festzunageln; hier wird zusätzlich
     * geprüft, dass er wirklich 4,5 verlangt — käme er auf 3, wäre die Zusage
     * heimlich abgeschwächt.
     */
    const DIFF_ZAHL_TRAEGER = [
        { selector: '[data-forge-stat-plus]', label: 'Diff-Zahl + (Patch-Zeile)', kind: 'text' as const },
        { selector: '[data-forge-stat-minus]', label: 'Diff-Zahl − (Patch-Zeile)', kind: 'text' as const },
        { selector: '[data-forge-diff-plus]', label: 'Diff-Zahl + (Diff-Kopf)', kind: 'text' as const },
        { selector: '[data-forge-diff-minus]', label: 'Diff-Zahl − (Diff-Kopf)', kind: 'text' as const },
    ]

    /** Patches öffnen UND den ersten aufklappen, damit auch der Diff-Kopf steht. */
    async function oeffnePatchMitDiff(page: Page): Promise<void> {
        await oeffnePatches(page)
        await page.locator('[data-forge-patch]').first().locator('button').first().click()
        await expect(page.locator('[data-forge-diff]').first()).toBeVisible()
    }

    for (const theme of ['light', 'dark'] as const) {
        test(`DoD P1: die vier Diff-Zahlen halten 4,5:1 auf ihrem echten Untergrund (${theme})`, async ({ page }) => {
            await page.addInitScript((t) => {
                try {
                    localStorage.setItem('flux.appearance', t as string)
                } catch {
                    /* kein localStorage → der Lauf misst dann das Default-Theme */
                }
            }, theme)
            await oeffnePatchMitDiff(page)
            if (theme === 'dark') {
                await expect(page.locator('html')).toHaveClass(/dark/, { timeout: 15_000 })
            } else {
                await expect(page.locator('html')).not.toHaveClass(/dark/, { timeout: 15_000 })
            }

            const gemessen = (await measure(page, DIFF_ZAHL_TRAEGER)).filter((m) => m.label.startsWith('Diff-Zahl'))
            for (const m of gemessen) {
                console.log(`[diff-kontrast] ${theme}: ${m.label} — ${m.fg} auf ${m.bg} = ${m.ratio}:1 (verlangt ${m.min}, Deckkraft ${m.opacity})`)
            }

            // Fail-CLOSED: der Helfer meldet einen nicht getroffenen Selektor als
            // eigenen Eintrag mit `ratio: 0` und „(NICHT GEFUNDEN)" im Label. Ohne
            // diese beiden Zeilen wäre ein weggewanderter Anker eine stille Lücke.
            expect(gemessen, 'nicht alle vier Diff-Zahlen wurden gemessen').toHaveLength(4)
            expect(
                gemessen.filter((m) => m.label.includes('NICHT GEFUNDEN')).map((m) => m.label),
                'ein Anker der Diff-Zahlen wurde nicht gefunden — der Riegel misst dann nichts',
            ).toEqual([])

            for (const m of gemessen) {
                expect(m.min, `${m.label}: die Schwelle ist auf ${m.min} gerutscht — die Zahlen sind TEXT und schulden 4,5`).toBe(4.5)
                expect(m.opacity, `${m.label}: Deckkraft ${m.opacity} — ein Elternteil dimmt die Zahl, das Verhältnis waere zu gut`).toBe(1)
                expect(m.ratio, `${m.label}: ${m.ratio}:1 auf ${m.bg} — WCAG 1.4.3 verlangt ${m.min}:1`).toBeGreaterThanOrEqual(m.min)
            }
        })
    }

    /**
     * KONTROLLE zum Riegel darüber: eine verschlechterte Farbe MUSS er sehen.
     *
     * Ohne sie wüsste niemand, ob der grüne Lauf „der Kontrast stimmt" bedeutet oder
     * „die Messung greift gar nicht" — der Fehler, an dem dieses Repo schon zweimal
     * eine Zusage verloren hat. Injiziert wird kein Fantasiewert, sondern genau die
     * Verschlechterung, die ein Mensch versehentlich baut: die Zahl bekommt die
     * FLÄCHENFARBE ihres eigenen Badges als Textfarbe (`green-400`/`red-400`) — das
     * ist der klassische „ich nehme denselben Ton"-Griff und liegt sicher unter 4,5.
     */
    test('KONTROLLE: der Kontrast-Wächter der Diff-Zahlen erkennt eine verschlechterte Farbe', async ({ page }) => {
        await oeffnePatchMitDiff(page)

        const vorher = (await measure(page, DIFF_ZAHL_TRAEGER)).filter((m) => m.label.startsWith('Diff-Zahl'))
        expect(vorher, 'Ausgangsmessung unvollstaendig').toHaveLength(4)
        for (const m of vorher) {
            expect(m.ratio, `Ausgangszustand ${m.label} ist schon rot — die Kontrolle kann so nichts zeigen`).toBeGreaterThanOrEqual(m.min)
        }

        await page.evaluate(() => {
            for (const sel of ['[data-forge-stat-plus]', '[data-forge-diff-plus]']) {
                const el = document.querySelector(sel) as HTMLElement | null
                if (el) el.style.color = 'var(--color-green-400)'
            }
            for (const sel of ['[data-forge-stat-minus]', '[data-forge-diff-minus]']) {
                const el = document.querySelector(sel) as HTMLElement | null
                if (el) el.style.color = 'var(--color-red-400)'
            }
        })

        const nachher = (await measure(page, DIFF_ZAHL_TRAEGER)).filter((m) => m.label.startsWith('Diff-Zahl'))
        expect(nachher).toHaveLength(4)
        for (const m of nachher) {
            console.log(`[diff-kontrast] KONTROLLE: ${m.label} — ${m.fg} auf ${m.bg} = ${m.ratio}:1 (verlangt ${m.min})`)
            expect(
                m.ratio,
                `${m.label}: die verschlechterte Farbe misst ${m.ratio}:1 und bleibt damit ueber ${m.min} — der Waechter kann eine Regression nicht sehen`,
            ).toBeLessThan(m.min)
        }
    })


    /**
     * DIE ZWEI FASSUNGEN DER VORGANGSZEILE — über ALLE Vorgangsarten (P3-Nachbesserung).
     *
     * ── Warum es diesen Riegel gibt ───────────────────────────────────────────
     * P3 hat die Zeile auf zwei Ränge gebracht und dafür zwei ausdrücklich
     * gesetzte Rasterfassungen gebaut. Meine erste Sonde dazu war schwach: sie
     * mass NUR die Patch-Zeile, und zwei ihrer drei Proben waren **nicht
     * diskriminierend** — die x-Position der Vorzeichenspalte ist per Grid immer
     * gleich, und ein Drei-Zeichen-Vergleich traf Zeilen mit gleichem Anfang.
     * Beide melden in JEDEM Zustand dasselbe. Ein Riegel, der nicht unterscheiden
     * kann, ist Dekoration.
     *
     * ── Was hier die Fassungen UNTERSCHEIDET ──────────────────────────────────
     * Genau ein struktureller Unterschied, und er ist der Prüfgegenstand:
     *
     *   schmal  `leute` (Gesichter + Kommentarzahl) steht auf der METAZEILE
     *   breit   `leute` steht auf der TITELZEILE, links neben dem Zustand
     *
     * Auf einem Telefon darf die erste Zeile nur den Titel tragen; auf einer
     * breiten Zeile beantwortet sie „was und wer". Gemessen wird also
     * `leute.y > titel.y` gegen `leute.y === titel.y` — eine Aussage, die in
     * genau einer der beiden Fassungen wahr ist.
     *
     * ── Und die Rangzahl ──────────────────────────────────────────────────────
     * Zusätzlich wird gezählt, wie viele BÄNDER die Zeile hat: die y-Positionen
     * aller belegten Rasterfelder, entdoppelt. Mehr als zwei heisst dritter Rang
     * — genau der Fund, an dem die erste Fassung gescheitert ist (die Labels
     * hatten ein eigenes Feld).
     */
    const FELDER = [
        ['glyphe', '.forge-vz-glyphe'],
        ['titel', '.forge-vz-titel'],
        ['meta', '.forge-vz-meta'],
        ['leute', '.forge-vz-leute'],
        ['zustand', '.forge-vz-zustand'],
    ] as const

    type Matrix = Record<string, { x: number; y: number; w: number } | null>

    async function feldmatrix(page: Page, wurzel: string): Promise<Matrix> {
        return page.evaluate(
            ([w, felder]) => {
                const zeile = document.querySelector(`${w} .forge-vorgangszeile`) as HTMLElement | null
                if (!zeile) return {} as Matrix
                const basis = zeile.getBoundingClientRect()
                const out: Matrix = {}
                for (const [name, sel] of felder as [string, string][]) {
                    const el = zeile.querySelector(sel) as HTMLElement | null
                    if (!el || !el.getClientRects().length) {
                        out[name] = null
                        continue
                    }
                    const r = el.getBoundingClientRect()
                    out[name] = { x: Math.round(r.x - basis.x), y: Math.round(r.y - basis.y), w: Math.round(r.width) }
                }
                return out
            },
            [wurzel, FELDER.map((f) => [f[0], f[1]])] as const,
        )
    }

    /**
     * Zwei verschiedene Fragen, die beide „Rang" heissen — und nur eine davon
     * ist eine ZUSAGE.
     *
     * 1. **STRUKTUR** (Zusage): wie viele BÄNDER legt das Raster an? Das sind die
     *    Rasterfelder, geclustert zu Streifen. Genau zwei: Titelzeile und
     *    Metazeile. Ein drittes Feld wäre der Fehler, den die Abnahme meint.
     * 2. **UMBRUCH** (Beobachtung): wie viele Zeilen sieht der Leser am Ende? Das
     *    hängt an der Titellänge. Ein langer Titel füllt seine letzte Zeile, die
     *    Labels fliessen dann auf die nächste — auf 390 px gemessen sind das drei
     *    sichtbare Streifen. Das ist normaler Textfluss, kein dritter Rang, und
     *    es wird PROTOKOLLIERT statt behauptet.
     *
     * ── Wie ich das gelernt habe ──────────────────────────────────────────────
     * Drei Entwürfe dieses Zählers, alle durch die Mutationsprobe gefallen:
     *   · nackte y-Werte → die Typ-Glyphe (1,6 px optischer Versatz) wurde ein
     *     drittes Band, bei einem Layout, das stimmt;
     *   · Rasterfelder → konnte die Mutation „Labels bekommen ihr Feld zurück"
     *     nicht sehen, weil die Labels seither IM Titelfeld liegen; die Mutation
     *     traf gar nicht, und der Riegel meldete Deckung, die es nicht gab;
     *   · Blatt-Kästen → sieht den Umbruch und wirft ihn mit dem Rang zusammen.
     *
     * Die tragende Zusage ist deshalb STRUKTURELL und wird mit einer zweiten,
     * unabhängigen Assertion gehalten: die Labels müssen IM Titelfeld liegen.
     * Diese ist mutationsgeprüft, indem sie im Markup herausgezogen wurden.
     */
    const streifen = (ys: number[]): number => {
        let n = 0
        let letzter = Number.NEGATIVE_INFINITY
        for (const y of [...ys].sort((a, b) => a - b)) {
            if (y - letzter >= 8) n++
            letzter = y
        }
        return n
    }

    /** Sichtbare Blatt-Kästen — nur fürs Protokoll, nicht als Zusage. */
    const sichtbareStreifen = async (page: Page, wurzel: string): Promise<number> =>
        page.evaluate((w) => {
            const zeile = document.querySelector(`${w} .forge-vorgangszeile`) as HTMLElement | null
            if (!zeile) return 0
            const ys: number[] = []
            for (const el of Array.from(zeile.querySelectorAll('*')) as HTMLElement[]) {
                if (!el.getClientRects().length) continue
                if ((el.getAttribute('class') ?? '').split(/\s+/).includes('sr-only')) continue
                const text = Array.from(el.childNodes).some((k) => k.nodeType === 3 && (k.textContent ?? '').trim())
                if (!text && !el.hasAttribute('data-flux-badge')) continue
                ys.push(Math.round(el.getBoundingClientRect().y))
            }
            let n = 0
            let letzter = Number.NEGATIVE_INFINITY
            for (const y of ys.sort((a, b) => a - b)) {
                if (y - letzter >= 8) n++
                letzter = y
            }
            return n
        }, wurzel)

    /**
     * Wie breit ist der CONTAINER der Zeile? Die Fassung hängt an ihm, nicht am
     * Fenster: `@container vorgang (min-width: 30rem)`. Auf `/forge` liegt
     * dieselbe Zeile in einer schmalen Spur und steht deshalb bei 1280 px Fenster
     * in der SCHMALEN Fassung — gemessen, nicht vermutet. Ein Riegel, der die
     * Fassung aus der Fensterbreite ableitet, prüft die falsche Grösse.
     */
    const containerBreite = async (page: Page, wurzel: string): Promise<number> =>
        page.evaluate((w) => {
            const zeile = document.querySelector(`${w} .forge-vorgangszeile`) as HTMLElement | null
            const box = zeile?.closest('.forge-vorgangskopf') as HTMLElement | null
            return box ? Math.round(box.getBoundingClientRect().width) : 0
        }, wurzel)

    /**
     * Trägt die Leute-Kiste etwas SICHTBARES? Die Breite taugt dafür nicht: in der
     * schmalen Fassung teilt sich `leute` die Rasterspalte mit der Zustandspille
     * und misst deren 30 px, auch wenn nichts darin steht.
     */
    const leuteGefuellt = async (page: Page, wurzel: string): Promise<boolean> =>
        page.evaluate((w) => {
            const zeile = document.querySelector(`${w} .forge-vorgangszeile`)
            const l = zeile?.querySelector('.forge-vz-leute')
            if (!l) return false
            return Array.from(l.querySelectorAll('*')).some((k) => (k as HTMLElement).getClientRects().length > 0)
        }, wurzel)

    /** Liegen die Labels IM Titelfeld? Das ist die eigentliche Rang-Zusage. */
    const labelsImTitel = async (page: Page, wurzel: string): Promise<boolean | null> =>
        page.evaluate((w) => {
            const zeile = document.querySelector(`${w} .forge-vorgangszeile`)
            const labels = zeile?.querySelector('[data-forge-labels]')
            if (!labels) return null
            return !!labels.closest('.forge-vz-titel')
        }, wurzel)


    for (const [fassung, breite] of [
        ['schmal', 390],
        ['breit', 1280],
    ] as const) {
        test(`DoD P3: die ${fassung}e Fassung ist gesetzt — über alle Vorgangsarten`, async ({ page }) => {
            await page.setViewportSize({ width: breite, height: 1100 })
            await oeffneForge(page)

            // ── Eine Zeile MIT LABELS ist Pflicht, nicht Beiwerk ──────────────
            // Die Patch-Zeile trägt keine Labels. Ein Riegel, der nur sie misst,
            // kann den dritten Rang nicht sehen: das Labelfeld ist dann leer und
            // trägt kein Band. Die Mutationsprobe hat genau das gezeigt — mit
            // wiederhergestelltem Labelband blieb der Riegel GRÜN. Deshalb sät
            // dieser Test sich ein Issue mit drei Labels und räumt es wieder weg.
            const issueId = eventIdAus(
                nak([
                    'event', '--auth', '--sec', besitzerSec, '-k', '1621',
                    '-t', `a=30617:${besitzerPub}:${REPO_D}`,
                    '-t', 'subject=Der Klon bricht ab, wenn der Relay mitten im Pack schliesst',
                    '-t', 't=bug', '-t', 't=git-daemon', '-t', 't=needs-repro',
                    '-c', 'Reproduzierbar mit einem 14-MB-Repo.', ZOOID_WS,
                ]),
            )

            // ── Und eine GEFÜLLTE Leute-Kiste ────────────────────────────────
            // Ohne sie steht die Fassungs-Zusage über einer LEEREN Kiste. Gemessen:
            // in der schmalen Fassung teilt sich `leute` die Spalte mit der
            // Zustandspille und erbt deren 30 px Breite, in der breiten hat es eine
            // eigene Spalte und misst 0 — beides ohne ein einziges Gesicht darin.
            // Die Lage stimmte trotzdem (die Mutationsprobe färbte rot), aber die
            // Abnahme spricht von den GESICHTERN, nicht von einem Platzhalter.
            // Zuweisungen kommen aus 1630–1633, nicht aus einem `p` am Issue; ein
            // Kommentar ist der billigere Weg zum selben Beleg.
            const kommentarId = eventIdAus(
                nak([
                    'event', '--auth', '--sec', besitzerSec, '-k', '1',
                    '-t', `a=30617:${besitzerPub}:${REPO_D}`, '-t', `e=${issueId};;root`,
                    '-c', 'Ich sehe dasselbe auf 2.44.', ZOOID_WS,
                ]),
            )

            // ── Die dritte Vorgangsart: ein Pull Request ─────────────────────
            const prId = eventIdAus(
                nak([
                    'event', '--auth', '--sec', besitzerSec, '-k', '1618',
                    '-t', `a=30617:${besitzerPub}:${REPO_D}`, '-t', `p=${besitzerPub}`,
                    '-t', 'subject=Pack-Abbruch sauber melden statt still abzubrechen',
                    '-t', 'branch-name=fix/pack-abbruch', '-t', 'target-branch=master',
                    '-t', `c=${'a'.repeat(40)}`, '-c', 'PR-Rumpf.', ZOOID_WS,
                ]),
            )
            const prKommentarId = eventIdAus(
                nak([
                    'event', '--auth', '--sec', besitzerSec, '-k', '1',
                    '-t', `a=30617:${besitzerPub}:${REPO_D}`, '-t', `e=${prId};;root`,
                    '-c', 'Bitte noch den Testfall.', ZOOID_WS,
                ]),
            )

            try {
                await page.goto('/forge?tab=repos')
                await page.locator('[data-forge-repo]').filter({ hasText: REPO_NAME }).first().click()
                await page.getByRole('tab', { name: /^Issues/ }).click()
                await expect(page.locator('[data-forge-issue]').first()).toBeVisible({ timeout: 30_000 })
                // Vorbedingung: die gemessene Zeile trägt WIRKLICH Labels — sonst
                // prüft die Rangzahl unten wieder nichts.
                await expect(
                    page.locator('[data-forge-issue]').first().locator('[data-forge-labels] [data-flux-badge]'),
                    'die Beleg-Zeile trägt keine Label-Pillen — die Rangzahl wäre blind',
                ).toHaveCount(3, { timeout: 20_000 })

                /**
                 * ALLE VIER Vorgangsarten. Es gibt genau vier Stellen mit
                 * `.forge-vorgangszeile`: Issue, Pull Request und Patch auf der
                 * Repo-Seite, dazu die workspace-weite Liste auf `/forge`
                 * (`partials/forge-vorgangsliste.blade.php`, für Issues und PRs
                 * derselbe Bauplan). Ein Riegel über zwei davon hätte die anderen
                 * zwei frei laufen lassen — sie tragen dieselben Feldklassen und
                 * würden bei einem Rasterbruch genauso kippen.
                 */
                const arten: { name: string; wurzel: string; labels: boolean; hin: () => Promise<void> }[] = [
                    {
                        name: 'Issue mit Labels', wurzel: '[data-forge-issue]', labels: true,
                        hin: async () => { await page.getByRole('tab', { name: /^Issues/ }).click() },
                    },
                    {
                        name: 'Pull Request', wurzel: '[data-forge-pr]', labels: false,
                        hin: async () => { await page.getByRole('tab', { name: /^Pull Requests/ }).click() },
                    },
                    {
                        name: 'Patch', wurzel: '[data-forge-patch]', labels: false,
                        hin: async () => { await page.getByRole('tab', { name: /^Patches/ }).click() },
                    },
                    {
                        name: 'Workspace-Liste', wurzel: '[data-forge-vorgang-link]', labels: false,
                        hin: async () => {
                            await page.goto('/forge?tab=issues')
                            await expect(page.locator('[data-forge-region="issues"]')).toBeVisible({ timeout: 30_000 })
                        },
                    },
                ]

                let leuteBelegt = 0

                for (const { name, wurzel, labels } of arten) {
                    await arten.find((x) => x.name === name)!.hin()
                    await expect(page.locator(wurzel).first(), `${name}: keine Zeile sichtbar`).toBeVisible({ timeout: 30_000 })

                    const m = await feldmatrix(page, wurzel)
                    console.log(`[p3-matrix] ${fassung} ${name}: ${JSON.stringify(m)}`)

                    expect(m.titel, `${name}: kein Titelfeld gefunden — die Matrix wäre leer`).toBeTruthy()
                    expect(m.zustand, `${name}: kein Zustandsfeld gefunden`).toBeTruthy()

                    // ── Zusage 1: das RASTER legt genau zwei Bänder an ────────
                    const felderStreifen = streifen(Object.values(m).filter(Boolean).map((f) => f!.y))
                    const sichtbar = await sichtbareStreifen(page, wurzel)
                    console.log(`[p3-raenge] ${fassung} ${name}: Raster ${felderStreifen} · sichtbar ${sichtbar}`)
                    expect(
                        felderStreifen,
                        `${name}: das Raster legt ${felderStreifen} Bänder an statt zwei. Matrix: ${JSON.stringify(m)}`,
                    ).toBeLessThanOrEqual(2)

                    // ── Zusage 2: die Labels liegen IM Titelfeld ──────────────
                    // Ohne sie wäre Zusage 1 blind: ein Labelband, das als eigenes
                    // Rasterfeld zurückkehrt, hat diese Zeile schon einmal auf drei
                    // Ränge gebracht — und die reine Feldzählung sah es nicht, weil
                    // die Mutation im Markup sitzt, nicht im Raster.
                    if (labels) {
                        const drin = await labelsImTitel(page, wurzel)
                        expect(drin, `${name}: kein [data-forge-labels] gefunden — die Rang-Zusage wäre ungeprüft`).not.toBeNull()
                        expect(
                            drin,
                            `${name}: die Labels liegen NICHT im Titelfeld — sie bilden wieder einen eigenen Rang`,
                        ).toBe(true)
                    }

                    // ── Der Unterschied der Fassungen ─────────────────────────
                    // Nur an einer Kiste MIT Inhalt: eine leere sitzt zwar auch im
                    // richtigen Rasterfeld, aber der Leser sieht davon nichts.
                    const cb = await containerBreite(page, wurzel)
                    const erwartet = cb >= 480 ? 'breit' : 'schmal'
                    console.log(`[p3-fassung] ${fassung} ${name}: Container ${cb} px → ${erwartet}`)
                    if (m.leute && (await leuteGefuellt(page, wurzel))) {
                        leuteBelegt++
                        if (erwartet === 'schmal') {
                            expect(
                                m.leute.y,
                                `${name}: Container ${cb} px (schmale Fassung) — die Gesichter müssen UNTER dem Titel stehen (leute.y ${m.leute.y} vs titel.y ${m.titel!.y})`,
                            ).toBeGreaterThan(m.titel!.y)
                        } else {
                            expect(
                                m.leute.y,
                                `${name}: Container ${cb} px (breite Fassung) — die Gesichter stehen auf der Titelzeile (leute.y ${m.leute.y} vs titel.y ${m.titel!.y})`,
                            ).toBe(m.titel!.y)
                        }
                    }

                    // Der Zustand hängt in BEIDEN Fassungen rechts an der Titelzeile.
                    expect(m.zustand!.y, `${name}: die Zustandspille sitzt nicht auf der Titelzeile`).toBe(m.titel!.y)
                    expect(m.zustand!.x, `${name}: die Zustandspille steht nicht rechts vom Titel`).toBeGreaterThan(m.titel!.x)
                }

                // Fail-closed: hätte KEINE Zeile eine gefüllte Leute-Kiste, wäre die
                // Fassungs-Zusage oben nie ausgeführt worden — grün ohne Deckung.
                expect(
                    leuteBelegt,
                    'keine einzige Zeile trug sichtbare Gesichter oder Zahlen — die Fassungs-Zusage lief leer',
                ).toBeGreaterThan(0)
            } finally {
                loesche(prKommentarId)
                loesche(kommentarId)
                loesche(prId)
                loesche(issueId)
            }
        })
    }


    /**
     * P5 — DIE ZEITLEISTE IST EIN BAUTEIL, und drei Dinge daran können still brechen.
     *
     * 1. **Fremde Kinder.** `flux:timeline.item` platziert JEDES vorgesehene Teil per
     *    `grid-area` (Indikator 3/1, Inhalt 2/3/5, Linien, Lücken). Ein Kind, das
     *    keines davon ist, wird AUTOMATISCH platziert. Vor dem Umbau gemessen
     *    (`p5-subgrid-messung.log`): dieselbe Zeile einmal mit drei bedingten Kindern
     *    direkt im Item und einmal ohne — die Zeitangabe wanderte um 48 px, ohne dass
     *    irgendetwas rot wurde. Deshalb ist die Zusage STRUKTURELL: im Item stehen nur
     *    Flux-Teile.
     * 2. **Die Leitlinie der ersten Zeile.** Flux blendet sie über
     *    `:not(:first-child)` aus. Unter Alpine bleibt das `<template>` als erstes
     *    Kind stehen, die erste echte Zeile ist damit `:nth-child(2)` und zöge eine
     *    Linie nach oben ins Leere. Eine ungeschichtete Regel in `theme.css` fängt das.
     * 3. **Die Bindung selbst.** `flux:timeline*` ist das einzige Flux-Bauteil, das
     *    NICHT gefaltet wird — und nur der Faltungs-Pfad wandelt `::attr` in `:attr`.
     *    Ein `::data-type` bliebe wörtlich im HTML stehen: totes Attribut, Anker weg.
     *    Der Test prüft deshalb den WERT, nicht nur das Attribut.
     */
    test('DoD P5: die Zeitleiste ist ein Bauteil und traegt ihre Anker', async ({ page }) => {
        await oeffneForge(page)
        await page.goto('/forge?tab=activity')
        await expect(page.locator('[data-forge-activity]').first()).toBeVisible({ timeout: 30_000 })

        const m = await page.evaluate(() => {
            const items = Array.from(document.querySelectorAll('[data-flux-timeline-item]')) as HTMLElement[]
            const fremde: string[] = []
            for (const it of items) {
                for (const k of Array.from(it.children)) {
                    const flux = Array.from(k.attributes).some((a) => a.name.startsWith('data-flux-timeline'))
                    if (!flux) fremde.push(`${k.tagName}.${(k.getAttribute('class') ?? '').slice(0, 24)}`)
                }
            }
            const erste = items[0]
            const leit = erste?.querySelector('[data-flux-timeline-line-leading]') as HTMLElement | null
            const ol = erste?.closest('[data-flux-timeline]') as HTMLElement | null
            const linien = items.flatMap((i) =>
                Array.from(i.querySelectorAll('[data-flux-timeline-line-leading],[data-flux-timeline-line-trailing]')),
            )
            return {
                zeilen: items.length,
                fremde,
                linien: linien.length,
                linienMitText: linien.filter((l) => (l.textContent ?? '').trim() !== '').length,
                linienMitRolle: linien.filter((l) => l.hasAttribute('role') || l.hasAttribute('aria-label')).length,
                ariaHiddenJeZeile: items.map((i) => i.querySelectorAll('[aria-hidden="true"]').length),
                // GETRENNT vom Gesamtzähler: nur der Träger, den FLUX mitbringt.
                // Der Gesamtzähler wäre hier fail-open — unsere eigene `·`-Trennung
                // trägt ebenfalls eines und hielte die Zusage grün, während Flux'
                // Träger längst weg wäre (gemessen, `p5-mutation5-aria-traeger.log`).
                ariaHiddenAusFlux: items.map(
                    (i) => i.querySelectorAll('[data-flux-timeline-indicator] [aria-hidden="true"]').length,
                ),
                erstesKindDesOl: ol?.firstElementChild?.tagName ?? null,
                leitlinieDerErsten: leit ? getComputedStyle(leit).display : null,
                typen: items.map((i) => i.getAttribute('data-type')),
                anker: items.filter((i) => i.hasAttribute('data-forge-activity')).length,
                totesAttribut: items.filter((i) => i.hasAttribute('::data-type')).length,
            }
        })
        console.log(`[p5-zeitleiste] ${JSON.stringify(m)}`)

        expect(m.zeilen, 'keine Zeitleistenzeile sichtbar — der Riegel misst nichts').toBeGreaterThan(0)
        expect(m.fremde, `fremde Kinder im timeline.item: ${m.fremde.join(', ')} — sie werden automatisch platziert`).toEqual([])
        // Vorbedingung für 2.: die Alpine-Falle muss überhaupt vorliegen. Läge das
        // `<template>` nicht als erstes Kind, prüfte die Zeile darunter nichts.
        expect(m.erstesKindDesOl, 'das <template> ist nicht mehr das erste Kind — die Zusage unten liefe leer').toBe('TEMPLATE')
        expect(m.leitlinieDerErsten, 'die erste Zeile zieht eine Leitlinie nach oben ins Leere').toBe('none')
        expect(m.anker, 'die Zeilen tragen den Anker data-forge-activity nicht mehr').toBe(m.zeilen)
        expect(m.totesAttribut, 'es steht ein wörtliches `::data-type` im HTML — `::` ist auf flux:timeline tot').toBe(0)
        expect(
            m.typen.filter((t) => t && t.length > 0).length,
            `data-type ist leer — die Bindung ist tot. Werte: ${JSON.stringify(m.typen)}`,
        ).toBe(m.zeilen)

        // ── 4. Der ARIA-Träger, der beim Umbau aus dem QUELLTEXT verschwand ──────
        // `EmptyStatesAndA11yTest` zählt `aria-hidden="true"` im Blade-Quelltext und
        // sieht in keine Komponente hinein. Die handgezogene Linie trug dort eines,
        // `flux:timeline` zieht seine Linien selbst — die Zahl fiel 16 → 15 / 34 → 33.
        // Eine Zahl NACHZUZIEHEN ist billig; die Frage ist, ob am gerenderten Baum
        // etwas verloren ging. Genau das steht hier, damit die Kalibrierung dort
        // nicht als blosse Behauptung dasteht.
        expect(m.linien, 'die Zeitleiste zieht gar keine Linien mehr — dann misst der Rest nichts').toBe(m.zeilen * 2)
        expect(m.linienMitText, 'eine Leitlinie trägt Text — dann war das alte `aria-hidden` nicht folgenlos').toBe(0)
        expect(m.linienMitRolle, 'eine Leitlinie trägt `role`/`aria-label` — sie stünde im Barrierebaum').toBe(0)
        // Und die Gegenrichtung: die Komponente bringt einen EIGENEN Träger mit (die
        // Grundlinien-Attrappe im Indikator). Fällt der bei einem Flux-Update weg,
        // ist die Kalibrierung drüben ein echter Verlust — und dieser Riegel rot.
        expect(
            Math.min(...m.ariaHiddenAusFlux),
            `der Indikator einer Zeile bringt kein eigenes aria-hidden mehr mit: ${JSON.stringify(m.ariaHiddenAusFlux)}`,
        ).toBeGreaterThanOrEqual(1)
    })

    /**
     * P5 — KOPF UND LISTE IN EINEM RAHMEN.
     *
     * In P4 wurde an dieser Fläche nachgemessen, was der getrennte Kopf kostet: er sass
     * auf den Rändern der Region (x = 0 … 456), die Zeileninhalte im Kasten
     * (x = 13 … 443). Zwei Fluchtlinien für ein Ding.
     *
     * Die Zusage ist deshalb zweiteilig und beide Teile sind nötig: der Kopf liegt IM
     * Rahmen der Karte, UND seine Textkante trifft die der Zeilen.
     */
    test('DoD P5: der Gruppenkopf liegt im Rahmen und fluchtet mit den Zeilen', async ({ page }) => {
        // ── Dieser Test sät sein eigenes Issue, und das ist der Kern ────────────
        // Vorher tat er es nicht: er nahm die ERSTE `[data-forge-gruppe]`, die auf
        // der Fläche stand — und die stand dort nur, weil ein FREMDER Spec auf
        // demselben zooid-Slot ein 1621 hinterlassen hatte (mehrere seeden, keiner
        // räumt auf). Auf drei frischen Slots lief er in einen 30-s-Timeout. Der
        // Mechanismus war in Ordnung, die Zusage trug sich nur selbst nicht.
        //
        // Gewählt wurde SÄEN statt einer blossen Vorbedingung, obwohl beides den
        // stillen Fall beendet hätte: eine Vorbedingung, die überspringt, wäre
        // fail-open (grün ohne Messung) — genau die Bauform, die in dieser Datei
        // schon zweimal aufgeräumt wurde. Eine, die hart fällt, wäre ehrlich, liesse
        // die DoD-Zeile auf einem frischen Slot aber UNBEWEISBAR. Nur Säen macht die
        // Aussage vom Laufzustand unabhängig. Die explizite `karteGefunden`-Prüfung
        // unten BLEIBT trotzdem — sie fängt den toten Selektor, nicht die leere Fläche.
        //
        // Und gemessen wird gezielt die EIGENE Gruppe (`[data-address$=":<repo>"]`),
        // nicht die erste beste: sonst hinge das Ergebnis weiter an fremdem Müll,
        // nur diesmal unbemerkt in der anderen Richtung.
        const gruppenIssueId = eventIdAus(
            nak([
                'event', '--auth', '--sec', besitzerSec, '-k', '1621',
                '-t', `a=30617:${besitzerPub}:${REPO_D}`,
                '-t', 'subject=Der Kopfstreifen und seine Liste gehoeren in EINEN Rahmen',
                '-c', 'Gesät von der P5-Lageprüfung; sie räumt es im finally wieder weg.',
                ZOOID_WS,
            ]),
        )

        try {
            await oeffneForge(page)
            await page.goto('/forge?tab=issues')
            // Die Gruppe DIESES Repos, nicht die erste auf der Fläche.
            const meine = `[data-forge-gruppe][data-address$=":${REPO_D}"]`
            await expect(
                page.locator(meine).first(),
                'die selbst gesäte Repo-Gruppe erscheint nicht — dann misst die Lageprüfung fremden Laufzustand oder nichts',
            ).toBeVisible({ timeout: 30_000 })

            const m = await page.evaluate((sel) => {
                const gruppe = document.querySelector(sel) as HTMLElement
                const kopf = gruppe.querySelector('[data-forge-gruppe-link]')?.parentElement as HTMLElement
                const zeile = gruppe.querySelector('.forge-vorgangszeile') as HTMLElement
                const titel = zeile.querySelector('.forge-vz-titel') as HTMLElement
                const r = (e: HTMLElement) => e.getBoundingClientRect()
                // Die KARTE suchen, nicht die Sektion: nach der Mutationsprobe stand fest,
                // dass ein Kopf ausserhalb der Karte, aber innerhalb der Sektion die
                // Lageprüfung passiert — die Sektion umfasst dann beides. Gefragt ist,
                // ob der Kopf im RAHMEN liegt, und den zieht `surface-card`.
                const karte = (gruppe.classList.contains('surface-card') ? gruppe : gruppe.querySelector('.surface-card')) as HTMLElement | null
                const g = karte ? r(karte) : r(gruppe)
                return {
                    karteGefunden: !!karte,
                    kopfImRahmen: !!karte && r(kopf).left >= g.left && r(kopf).right <= g.right && r(kopf).top >= g.top,
                    kopfFlaeche: getComputedStyle(kopf).backgroundColor,
                    kopfUnterkante: getComputedStyle(kopf).borderBottomWidth,
                    kopfTextX: Math.round(r(gruppe.querySelector('[data-forge-gruppe-link]') as HTMLElement).x - g.x),
                    glypheX: Math.round(r(zeile.querySelector('.forge-vz-glyphe') as HTMLElement).x - g.x),
                    titelX: Math.round(r(titel).x - g.x),
                    // Geschachtelte Karten: die Gruppe SELBST ist die Karte, in ihr darf
                    // keine zweite stecken.
                    karten: gruppe.querySelectorAll('.surface-card').length,
                }
            }, meine)
            console.log(`[p5-kartenkopf] ${JSON.stringify(m)}`)

            expect(m.karteGefunden, 'keine surface-card in der Gruppe gefunden — die Lageprüfung liefe leer').toBe(true)
            expect(m.kopfImRahmen, 'der Gruppenkopf liegt nicht im Rahmen der Karte').toBe(true)
            expect(parseFloat(m.kopfUnterkante), 'der Kopfstreifen hat keine Unterkante — dann ist er kein Streifen').toBeGreaterThan(0)
            // EINE Karte, nicht zwei geschachtelte: zwei Kanten übereinander waren der
            // Zustand, gegen den `.forge-diff-datei` schon einmal aufgeräumt wurde.
            expect(m.karten, 'in der Gruppe steckt eine zweite surface-card — zwei Kanten auf derselben Stelle').toBe(0)
            // Die Fluchtlinie: Kopftext und Zeilenglyphe stehen auf derselben Kante.
            expect(
                Math.abs(m.kopfTextX - m.glypheX),
                `Kopftext (x=${m.kopfTextX}) und Zeileninhalt (x=${m.glypheX}) stehen nicht auf einer Fluchtlinie`,
            ).toBeLessThanOrEqual(1)
        } finally {
            loesche(gruppenIssueId)
        }
    })

})
