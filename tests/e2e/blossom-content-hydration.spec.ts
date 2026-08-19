import { test, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * **Die Zusage für Bilder, die NICHT in Blade stehen: aus einem auth-pflichtigen
 * Chat-Anhang, Emoji oder Artikelbild geht keine Anfrage raus — und er wird trotzdem
 * sichtbar, sobald der signierte Ladeweg die Bytes hat.**
 *
 * Warum hier und nicht unter `node --test`: die Zusage entsteht im **Markup** und in
 * der **DOM-Beobachtung**, nicht in einer Funktion, die man aufrufen kann. Genau diese
 * Schicht war der blinde Fleck der letzten Runde — die Loader-Zusage
 * (`js/blossomMedia.test.ts`) galt schon, und die Bilder blieben trotzdem leer, weil
 * niemand sie anmeldete. Deshalb läuft hier ein **echter** MutationObserver in einem
 * **echten** Browser über **echtes** Markup aus `js/blossomMarkup.ts`.
 *
 * **Gefaked ist genau eine Sache:** `load()` — der Blossom-Ladeweg selbst (Signatur,
 * Header, Cache, kein Wiederholen nach 401) steht in `js/blossomMedia.ts` und ist dort
 * ohne Browser geprüft. Hier zählt, was das Markup davor und danach tut. Der Fake hält
 * sich an den einen Vertrag, der dabei zählt: er lehnt ab, was NICHT vom Workspace
 * kommt — sonst wäre die Wache im Test weicher als im Betrieb.
 *
 * **Ohne App-Server und ohne Relay** (wie `blossom-media-guard.spec.ts`): gebraucht
 * werden nur die zwei abhängigkeitsfreien Module, gebündelt mit rolldown — dem
 * Bundler, der ohnehin unter Vite steckt. Keine neue Dependency.
 */

// ESM-Modul: kein `__dirname`. Playwright laedt die Spec als Modul.
const WURZEL = join(fileURLToPath(new URL('.', import.meta.url)), '../..')

/** Ein Bild auf dem Workspace-Relay (auth-pflichtig), eines von aussen, eines von woanders. */
const GESCHUETZT = 'https://buzz.test.invalid/media/anhang.jpg'
const GESCHUETZT_ABGELEHNT = 'https://buzz.test.invalid/media/verboten.jpg'
const GESCHUETZT_EMOJI = 'https://buzz.test.invalid/media/emoji.png'
const FREMD = 'https://image.nostr.build/frei.jpg'
const FREMD_MARKIERT = 'https://evil.test.invalid/untergeschoben.jpg'

/**
 * Die beiden echten Module fuer den Browser buendeln. Kein Nachbau, keine Kopie: was
 * hier laeuft, ist derselbe Quelltext, den `feeds.ts` und `bridge.ts` importieren.
 */
const buendeln = (): string => {
    const verzeichnis = mkdtempSync(join(tmpdir(), 'blossom-hydrate-'))
    const eintrag = join(verzeichnis, 'eintrag.ts')
    const ziel = join(verzeichnis, 'bundle.js')
    const js = join(WURZEL, 'packages/einundzwanzig-group/js')
    writeFileSync(
        eintrag,
        [
            `export { chatImageHtml, emojiImgHtml } from ${JSON.stringify(join(js, 'blossomMarkup.ts'))}`,
            `export { startBlossomHydration } from ${JSON.stringify(join(js, 'blossomHydrate.ts'))}`,
        ].join('\n'),
    )
    execFileSync(join(WURZEL, 'node_modules/.bin/rolldown'), [eintrag, '-o', ziel, '-f', 'esm', '-p', 'browser'], { cwd: WURZEL, timeout: 120_000 })

    return readFileSync(ziel, 'utf8')
}

const SEITE = `<!doctype html><html><head><meta charset="utf-8"></head><body>
<div id="verlauf"></div>
<script type="module">
  import { chatImageHtml, emojiImgHtml, startBlossomHydration } from '/bundle.js'

  // Stand-in fuer \`proxifyImage\` (core.ts) MIT der Wache (mediaGuard.ts): fuer ein
  // Medium des Workspace-Relays gibt sie '' zurueck — genau dieses '' ist das Signal,
  // an dem das Markup den Blossom-Weg anmeldet.
  const proxify = (url, preset) => url.startsWith('https://buzz.test.invalid/') ? '' : '/img/' + preset + '?src=' + encodeURIComponent(url)

  // Der Ladeweg. Gefaked, aber mit demselben Riegel wie der echte: was nicht vom
  // Workspace-Relay kommt, wird gar nicht erst geholt (\`isProtected\`).
  window.__geladen = []
  const load = async (url) => {
    window.__geladen.push(url)
    if (!url.startsWith('https://buzz.test.invalid/')) return ''
    if (url.includes('verboten')) return ''
    const blob = new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' })
    return URL.createObjectURL(blob)
  }

  const verlauf = document.getElementById('verlauf')
  const zeile = (fall, html) => '<div data-fall="' + fall + '">' + html + '</div>'

  // Das Markup entsteht wie im Betrieb: als HTML-STRING, der per innerHTML in die
  // Flaeche geht (im Betrieb: \`x-html\`).
  verlauf.innerHTML = [
    zeile('chat_geschuetzt', chatImageHtml(document, ${JSON.stringify(GESCHUETZT)}, proxify(${JSON.stringify(GESCHUETZT)}, 'msg'), proxify(${JSON.stringify(GESCHUETZT)}, 'full'))),
    zeile('chat_abgelehnt', chatImageHtml(document, ${JSON.stringify(GESCHUETZT_ABGELEHNT)}, proxify(${JSON.stringify(GESCHUETZT_ABGELEHNT)}, 'msg'), proxify(${JSON.stringify(GESCHUETZT_ABGELEHNT)}, 'full'))),
    zeile('chat_fremd', chatImageHtml(document, ${JSON.stringify(FREMD)}, proxify(${JSON.stringify(FREMD)}, 'msg'), proxify(${JSON.stringify(FREMD)}, 'full'))),
    zeile('emoji_geschuetzt', emojiImgHtml(document, ${JSON.stringify(GESCHUETZT_EMOJI)}, proxify(${JSON.stringify(GESCHUETZT_EMOJI)}, 'avatar'), 'winken')),
    // Untergeschoben: ein Marker auf einen FREMDEN Host. Nichts daran darf geladen werden.
    zeile('marker_fremd', '<img data-blossom-src="${FREMD_MARKIERT}">'),
  ].join('')

  // Erst NACH dem Einsetzen starten — im Betrieb ist es umgekehrt, beides muss gehen.
  window.__hydration = startBlossomHydration(document, load, (cb) => new MutationObserver(cb), document.body)

  // Eine spaet eingehende Nachricht: dafuer ist der Beobachter da.
  window.__spaeteZeile = () => {
    const div = document.createElement('div')
    div.dataset.fall = 'chat_spaet'
    div.innerHTML = chatImageHtml(document, ${JSON.stringify(GESCHUETZT)}, proxify(${JSON.stringify(GESCHUETZT)}, 'msg'), proxify(${JSON.stringify(GESCHUETZT)}, 'full'))
    verlauf.appendChild(div)
  }
</script>
</body></html>`

type Bild = { fall: string | undefined; src: string | null; full: string | null; zustand: string | null }

const lesen = () =>
    [...document.querySelectorAll('[data-fall]')].map((el) => {
        const img = el.querySelector('img')

        return {
            fall: (el as HTMLElement).dataset.fall,
            src: img?.getAttribute('src') ?? null,
            full: img?.getAttribute('data-full') ?? null,
            zustand: img?.getAttribute('data-blossom-state') ?? null,
        }
    })

test.describe('Auth-pflichtige Inhaltsbilder: kein src ohne Blob, kein Wiederholen, keine Anfrage', () => {
    test('Chat-Anhang, Emoji und ein untergeschobener Marker — im echten DOM', async ({ page }) => {
        const bundle = buendeln()
        const angefragt: string[] = []

        await page.route('**/*', async (route) => {
            const url = route.request().url()
            if (url === 'http://blossom-inhalt.test/') {
                return route.fulfill({ contentType: 'text/html', body: SEITE })
            }
            if (url.endsWith('/bundle.js')) {
                return route.fulfill({ contentType: 'text/javascript', body: bundle })
            }
            angefragt.push(url)

            // Beantworten statt abbrechen: ein Abbruch loeste `onerror`-Ketten aus und
            // machte die Positivkontrolle aus dem falschen Grund gruen.
            return route.fulfill({
                contentType: 'image/png',
                body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'),
            })
        })

        await page.goto('http://blossom-inhalt.test/')
        await page.waitForFunction(() => document.querySelectorAll('img[data-blossom-state]').length >= 4)
        await page.waitForTimeout(200)

        const bilder: Bild[] = await page.evaluate(lesen)
        const bild = (fall: string): Bild => bilder.find((b) => b.fall === fall) as Bild

        // ── Der Kern: das geschuetzte Bild wird SICHTBAR, ueber blob: ────────────────
        expect(bild('chat_geschuetzt').src, 'Chat-Anhang: blob:-URL statt gar nichts').toMatch(/^blob:/)
        // Die Lightbox zeigt dieselben Bytes — Blossom kennt keine Presets.
        expect(bild('chat_geschuetzt').full).toBe(bild('chat_geschuetzt').src)
        expect(bild('chat_geschuetzt').zustand).toBe('ready')

        expect(bild('emoji_geschuetzt').src, 'Custom-Emoji: derselbe Weg').toMatch(/^blob:/)
        // Ein Emoji hat keine Lightbox und bekommt deshalb auch kein data-full.
        expect(bild('emoji_geschuetzt').full).toBeNull()

        // ── Kein Zugriff bleibt still leer, ohne haengenden Ladezustand ──────────────
        expect(bild('chat_abgelehnt').src, 'abgelehnt: KEIN src — sonst eine Anfrage fuer nichts').toBeNull()
        expect(bild('chat_abgelehnt').zustand).toBe('none')

        // ── Ein Marker auf einen fremden Host fuehrt zu nichts ───────────────────────
        expect(bild('marker_fremd').src, 'untergeschobener Marker: nie ein src').toBeNull()
        expect(bild('marker_fremd').zustand).toBe('none')

        // ── Gegenprobe: ein fremdes Bild laeuft unveraendert ueber den Proxy ─────────
        expect(bild('chat_fremd').src).toContain('/img/msg?src=')
        expect(bild('chat_fremd').zustand, 'fremdes Bild wird gar nicht erst markiert').toBeNull()

        // ── Und der Draht: keine einzige Anfrage an den Relay oder an evil ───────────
        expect(angefragt.filter((u) => u.includes('buzz.test.invalid')), 'kein Abruf der geschuetzten URL').toEqual([])
        expect(angefragt.filter((u) => u.includes('evil.test.invalid'))).toEqual([])
        expect(angefragt.filter((u) => u.includes('/img/') && u.includes('buzz.test.invalid')), 'auch nicht ueber den Bild-Proxy').toEqual([])
    })

    test('eine spaet eingehende Nachricht wird vom Beobachter erfasst — und kein Bild zweimal geholt', async ({ page }) => {
        const bundle = buendeln()

        await page.route('**/*', async (route) => {
            const url = route.request().url()
            if (url === 'http://blossom-inhalt.test/') {
                return route.fulfill({ contentType: 'text/html', body: SEITE })
            }
            if (url.endsWith('/bundle.js')) {
                return route.fulfill({ contentType: 'text/javascript', body: bundle })
            }

            return route.fulfill({ status: 204, body: '' })
        })

        await page.goto('http://blossom-inhalt.test/')
        await page.waitForFunction(() => document.querySelectorAll('img[data-blossom-state]').length >= 4)

        const vorher = await page.evaluate(() => (window as unknown as { __geladen: string[] }).__geladen.length)

        // Genau der Fall, fuer den es den Beobachter gibt: das Markup wird eingesetzt,
        // ohne dass jemand den Hydrator aufruft.
        await page.evaluate(() => (window as unknown as { __spaeteZeile: () => void }).__spaeteZeile())
        await page.waitForFunction(() => document.querySelector('[data-fall="chat_spaet"] img')?.getAttribute('src')?.startsWith('blob:') === true)

        // Kein Wiederholen: die fuenf Bilder von vorhin werden NICHT erneut angefasst,
        // obwohl der Beobachter gerade ueber das ganze Dokument gelaufen ist.
        const nachher = await page.evaluate(() => (window as unknown as { __geladen: string[] }).__geladen)
        expect(nachher.length - vorher, 'genau EIN neuer Ladeversuch, nicht das ganze Dokument erneut').toBe(1)
    })
})
