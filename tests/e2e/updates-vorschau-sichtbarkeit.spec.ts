import { test, expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as nip19 from 'nostr-tools/nip19'
import { previewBody } from '../../packages/einundzwanzig-group/js/previewText.ts'

/**
 * **Die Sichtbarkeits-Messung der Vorschauzeile, als eingecheckter Test.**
 *
 * Die Diagnose vom 2026-09-04 hing an einer Zahl: von 234 Zeichen einer
 * Benachrichtigungs-Zeile waren auf einem 390-px-Schirm **64 gerendert**, und die ersten
 * 33 davon waren rohes bech32 — der Satz, um den es ging, war abgeschnitten. Diese Zahl
 * stand im Bericht und sonst nirgends. Hier steht sie als Lauf.
 *
 * ── Warum die Zeichen einzeln gemessen werden und nicht die Höhe ────────────────────
 *
 * Der erste Anlauf suchte binär den längsten Präfix, dessen gerenderte HÖHE noch in die
 * geklemmte Box passt. Er meldete „185 von 234 sichtbar" — **falsch um mehr als das
 * Dreifache**. Eine 177-Zeichen-Kennung enthält kein Trennzeichen und `overflow-wrap`
 * steht auf `normal`: sie bricht nicht um, sie läuft waagerecht aus der Spalte und wird
 * von `overflow: hidden` abgeschnitten. Die Höhe bleibt dabei bei zwei Zeilen. Jede
 * höhenbasierte Messung meldet in genau diesem Fall „passt".
 *
 * Deshalb: pro Zeichen ein `Range`-Rechteck, geprüft gegen BEIDE Achsen der Elementbox —
 * `bottom` fängt die Klemmung, `right` den waagerechten Überlauf.
 *
 * ── Ohne Relay und ohne `serve` ─────────────────────────────────────────────────────
 *
 * Diese Spec bezieht ihr `test` bewusst aus `@playwright/test` und ist dafür in
 * `support/specImporte.nodetest.ts` namentlich eingetragen (wie die drei
 * Blossom-/Composer-Specs): gemessen wird die GEOMETRIE einer Zeile, nicht das Verhalten
 * der App. Gebraucht wird davon nur das echte Stylesheet — der Rest des Teststacks würde
 * nur aufgebaut, um ihn nicht zu benutzen.
 *
 * Das Stylesheet ist das GEBAUTE (`public/build`, von `global-setup` garantiert), nicht
 * ein nachgebautes: `line-clamp-2` ist eine Tailwind-Utility und steht in keiner
 * Quelldatei. Ein Nachbau der vier Deklarationen wäre eine Messung gegen meine eigene
 * Annahme.
 */

const WURZEL = join(fileURLToPath(new URL('.', import.meta.url)), '../..')

const ME = 'c'.repeat(63) + '3'
const ZITIERT = 'd'.repeat(63) + '4'
const EVENT_ID = 'e'.repeat(63) + '5'
const NPUB = nip19.npubEncode(ME)
const NEVENT = nip19.neventEncode({ id: EVENT_ID, relays: ['wss://relay.einundzwanzig.space/'], author: ZITIERT })

const SATZ = 'Ja, ist wirklich beeindruckend, was hier entsteht'
const BITTE = 'kannst du dir das mal ansehen?'

/**
 * Die zwei Breiten. 390 px ist das Telefon (TWENTY ONE Companion); 960 px ist die
 * Desktop-Bühne — `xl:max-w-[62rem]` aus `components/app-shell.blade.php`, nicht geraten.
 *
 * `satzVorherSichtbar` ist **die gemessene Aussage dieser Datei**, kein Schalter: auf dem
 * Telefon verdrängte die Kennung den Satz aus der Zeile, auf dem Desktop passte beides
 * nebeneinander. Genau deshalb ist der Fehler am Schreibtisch nie jemandem aufgefallen.
 */
const BREITEN = [
    { viewport: 390, container: 390, name: 'Telefon', satzVorherSichtbar: false },
    { viewport: 1280, container: 960, name: 'Desktop', satzVorherSichtbar: true },
] as const

/**
 * Trägt der GEMALTE Text eine ungekürzte Kennung?
 *
 * 15 Datenzeichen ist die Grenze, und sie ist gerechnet: `shortenEntity` schneidet bei 16
 * Zeichen INKLUSIVE des Präfixes, hinter `npub1` bleiben also höchstens 11;
 * `displayPubkey` lässt 3 stehen. Die Schwelle muss aber auch unter der KLEMMUNG greifen —
 * auf dem Telefon werden vom rohen Token nur ~27 Zeichen gemalt, der Rest läuft aus der
 * Spalte. Eine Schwelle von 30 (die Zahl aus den Unit-Tests, wo der ganze String vorliegt)
 * hätte hier nichts gefunden und die Kalibrierung still entwertet.
 */
const ROHE_KENNUNG = /(?:note|npub|nevent|nprofile|naddr)1[0-9a-z]{15,}/

/**
 * Vergleich ohne Leerraum.
 *
 * Ein Leerzeichen AM Zeilenumbruch hat die Breite 0 und wird von der Messung (die
 * `r.width > 0` verlangt) nicht mitgezählt — der gemalte Text trägt an der Umbruchstelle
 * also keines. Ein `toContain('kannst du dir das mal ansehen?')` schlüge daran fehl, ohne
 * dass ein einziges Zeichen fehlte.
 */
const ohneLeer = (text: string): string => text.replace(/\s+/g, '')

/** Die gebauten Stylesheets — über das Manifest, nie über einen gehashten Dateinamen. */
const stylesheets = (): string[] => {
    const manifest = JSON.parse(readFileSync(join(WURZEL, 'public/build/manifest.json'), 'utf8')) as Record<
        string,
        { file: string }
    >
    const eintrag = 'resources/css/app.css'
    const treffer = manifest[eintrag]
    expect(treffer, `${eintrag} steht nicht im Manifest — wurde public/build gebaut?`).toBeTruthy()
    return [`/build/${(treffer as { file: string }).file}`]
}

/**
 * Das Markup der Zeile, 1:1 aus `resources/views/⚡updates.blade.php` (Zeilen 295–345),
 * mit aufgelösten Alpine-Bindungen. Die Klassenliste des Ausschnitts ist der
 * Prüfgegenstand und wird deshalb wörtlich übernommen.
 */
const seite = (css: string[]): string =>
    `<!doctype html><html class="dark"><head><meta charset="utf-8">
${css.map((href) => `<link rel="stylesheet" href="${href}">`).join('\n')}
</head><body class="bg-zinc-900">
<div id="spalte" style="width:390px">
 <button class="flex w-full items-start gap-3 px-4 py-3 text-start">
  <span class="relative shrink-0"><span style="display:block;width:2.5rem;height:2.5rem;border-radius:9999px;background:#444"></span></span>
  <span class="min-w-0 flex-1">
   <span class="mb-1 flex items-center gap-1 text-[0.7rem] font-semibold uppercase tracking-wider text-muted"><span class="truncate">Bitcoin Meetup Berlin</span></span>
   <span class="block truncate text-sm font-bold text-zinc-900 dark:text-zinc-100">Alice · 1 neue Nachricht</span>
   <span id="snippet" class="mt-1 text-sm leading-normal text-muted line-clamp-2"></span>
   <span class="mt-2 block text-xs text-muted">vor 3 Min</span>
  </span>
  <span class="mt-1 size-4 shrink-0 text-muted">›</span>
 </button>
</div>
</body></html>`

/** Statische Seite + die gebauten Assets aus `public/` — kein `serve`, kein Netz. */
const aufbauen = async (page: Page): Promise<void> => {
    const css = stylesheets()
    await page.route('**/*', async (route) => {
        const pfad = new URL(route.request().url()).pathname
        if (pfad === '/' || pfad === '/messung') {
            return route.fulfill({ contentType: 'text/html; charset=utf-8', body: seite(css) })
        }
        try {
            return await route.fulfill({ body: readFileSync(join(WURZEL, 'public', pfad.replace(/^\//, ''))) })
        } catch {
            return route.fulfill({ status: 404, body: '' })
        }
    })
    await page.goto('http://vorschau.test.invalid/messung')
}

type Messung = { spalte: number; hoehe: number; imDom: number; gerendert: string }

/** Wie viele Zeichen dieses Textes werden in der geklemmten Box tatsächlich GEMALT? */
const messen = async (page: Page, text: string): Promise<Messung> =>
    page.evaluate((t) => {
        const el = document.getElementById('snippet') as HTMLElement
        el.textContent = t
        const box = el.getBoundingClientRect()
        const node = el.firstChild as Text
        let gerendert = ''
        for (let i = 0; i < t.length; i++) {
            const bereich = document.createRange()
            bereich.setStart(node, i)
            bereich.setEnd(node, i + 1)
            const r = bereich.getBoundingClientRect()
            const drin =
                r.width > 0 && r.right <= box.right + 0.5 && r.bottom <= box.bottom + 0.5 && r.left >= box.left - 0.5
            if (drin) {
                gerendert += t[i]
            }
        }
        return { spalte: Math.round(box.width), hoehe: Math.round(box.height), imDom: t.length, gerendert }
    }, text)

test.describe('Benachrichtigungs-Zeile: was von der Vorschau wirklich zu sehen ist', () => {
    test('KALIBRIERUNG: das gebaute Stylesheet trägt die Klemmung, und sie greift', async ({ page }) => {
        const css = stylesheets()
        for (const href of css) {
            const inhalt = readFileSync(join(WURZEL, 'public', href.replace(/^\//, '')), 'utf8')
            expect(inhalt, `${href} enthält keine .line-clamp-2-Regel — die Messung unten prüfte dann nichts`).toContain(
                '.line-clamp-2{',
            )
        }
        await page.setViewportSize({ width: 390, height: 800 })
        await aufbauen(page)
        // 600 Zeichen gewöhnlicher Text MIT Trennzeichen: bricht um, wird geklemmt.
        const kontrolle = await messen(page, 'wort '.repeat(120).trim())
        expect(kontrolle.hoehe, 'die Klemmung greift nicht — zwei Zeilen à 21px erwartet').toBe(42)
        expect(kontrolle.gerendert.length).toBeLessThan(200)
    })

    for (const { viewport, container, name, satzVorherSichtbar } of BREITEN) {
        test(`${name} (${viewport} px): der Satz steht in der Zeile, nicht die Kennung`, async ({ page }) => {
            await page.setViewportSize({ width: viewport, height: 900 })
            await aufbauen(page)
            await page.evaluate((w) => {
                ;(document.getElementById('spalte') as HTMLElement).style.width = `${w}px`
            }, container)

            /**
             * Die Erwähnung, wie unser eigener Verfasser sie schreibt
             * (`interactions.ts mentionInsert`). VORHER ist bewusst als Literal gebaut und
             * nicht über `bodyWithoutQuote` geholt: ohne `q`-Tag gab diese Funktion den
             * Inhalt unverändert zurück — das Literal IST ihr Ergebnis, und die Spec
             * schleppt dafür nicht den halben App-Boot mit.
             */
            const vorher = `nostr:${NPUB} ${BITTE}`
            const nachher = previewBody({ content: vorher, tags: [] } as never, () => '')

            const alt = await messen(page, vorher)
            const neu = await messen(page, nachher)
            console.log(
                `[Vorschau ${name}] Spalte ${alt.spalte}px, Höhe ${alt.hoehe}px\n` +
                    `  vorher : ${alt.imDom} im DOM, ${alt.gerendert.length} gerendert → ${JSON.stringify(alt.gerendert)}\n` +
                    `  nachher: ${neu.imDom} im DOM, ${neu.gerendert.length} gerendert → ${JSON.stringify(neu.gerendert)}`,
            )

            expect(ROHE_KENNUNG.test(alt.gerendert), 'KALIBRIERUNG: der alte Zustand muss die Kennung zeigen').toBe(true)
            expect(ROHE_KENNUNG.test(neu.gerendert), 'die bereinigte Zeile zeigt weiterhin eine rohe Kennung').toBe(false)
            expect(ohneLeer(neu.gerendert), 'die Bitte muss vollständig in der Zeile stehen').toContain(ohneLeer(BITTE))
            /**
             * **Die gemessene Aussage dieses Falls ist der ANTEIL, nicht die Vollständigkeit.**
             * Bei der Erwähnung passte die Bitte auf beiden Breiten noch in die Zeile — der
             * Schaden war, wie viel Platz daneben verbrannte. Gemessen: 39 von 69 gemalten
             * Zeichen auf dem Telefon (57 %), 69 von 100 auf dem Desktop (69 %). Ein
             * „vorher unvollständig" wäre hier schlicht falsch gewesen und ist beim ersten
             * Lauf zu Recht rot geworden.
             */
            const vorKennung = alt.gerendert.indexOf(BITTE.slice(0, 6))
            expect(vorKennung, 'KALIBRIERUNG: die Bitte muss im alten Zustand gefunden werden').toBeGreaterThan(0)
            expect(
                vorKennung / alt.gerendert.length,
                'die Kennung verbrauchte weniger als die halbe sichtbare Zeile — dann misst dieser Fall nichts',
            ).toBeGreaterThanOrEqual(0.5)
            expect(
                neu.gerendert.indexOf(BITTE.slice(0, 6)),
                'nach der Bereinigung darf vor der Bitte nur noch die Kurzform stehen',
            ).toBeLessThanOrEqual(20)
        })

        test(`${name} (${viewport} px): eine Zitat-Antwort ohne q-Tag zeigt den Satz`, async ({ page }) => {
            await page.setViewportSize({ width: viewport, height: 900 })
            await aufbauen(page)
            await page.evaluate((w) => {
                ;(document.getElementById('spalte') as HTMLElement).style.width = `${w}px`
            }, container)

            const vorher = `nostr:${NEVENT}\n\n${SATZ}`
            const nachher = previewBody(
                { content: vorher, tags: [['e', EVENT_ID, 'wss://relay.einundzwanzig.space/', 'reply']] } as never,
                () => '',
            )

            const alt = await messen(page, vorher)
            const neu = await messen(page, nachher)
            console.log(
                `[Zitat ${name}] Spalte ${alt.spalte}px\n` +
                    `  vorher : ${alt.imDom} im DOM, ${alt.gerendert.length} gerendert → ${JSON.stringify(alt.gerendert)}\n` +
                    `  nachher: ${neu.imDom} im DOM, ${neu.gerendert.length} gerendert → ${JSON.stringify(neu.gerendert)}`,
            )

            expect(ROHE_KENNUNG.test(alt.gerendert), 'KALIBRIERUNG: der alte Zustand muss die Kennung zeigen').toBe(true)
            expect(ROHE_KENNUNG.test(neu.gerendert)).toBe(false)
            expect(ohneLeer(neu.gerendert), 'der Satz muss vollständig sichtbar sein').toContain(ohneLeer(SATZ))
            expect(
                ohneLeer(alt.gerendert).includes(ohneLeer(SATZ)),
                `gemessene Aussage für ${name}: der Satz war vorher ${satzVorherSichtbar ? '' : 'NICHT '}vollständig sichtbar`,
            ).toBe(satzVorherSichtbar)
        })
    }
})
