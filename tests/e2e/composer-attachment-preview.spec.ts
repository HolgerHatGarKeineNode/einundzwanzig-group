import { test, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { testServerEnv } from './support/serverEnv'

/**
 * **Der Nutzer sieht sein eigenes, gerade hochgeladenes Bild.**
 *
 * Auf einem Buzz-Space landet der Anhang im Medien-Speicher des Relays und ist damit
 * auth-pflichtig; `$img()` gibt fuer eine solche URL bewusst `''` zurueck (die Wache in
 * `js/mediaGuard.ts`, ausdrueckliche Entscheidung — kein Server-Proxy fuer private
 * Relay-Medien). Die 56x56-Kachel im Composer blieb dadurch leer: der Nutzer schnitt
 * ein Bild zu, lud es hoch, und sah nichts.
 *
 * Die Antwort ist NICHT, es signiert zurueckzuholen — die Bytes liegen im Browser
 * bereits vor. `confirmCrop` legt sie als kleine `data:`-URL in `attachment.previewUrl`
 * (`js/uploads.ts`, {@link thumbDataUrl}), und die Vorschau bevorzugt sie.
 *
 * Warum als Browser-Test: die Zusage entsteht in EINEM Alpine-Ausdruck im Blade
 * (`:src="…?.previewUrl || $img(…)"`). Kein Loader-Test der Welt deckt das ab; genau
 * diese Schicht war der blinde Fleck der letzten Runde. Das Markup wird zur Laufzeit
 * aus der ECHTEN Blade-Datei gerendert — wer sie aendert, aendert die Vorlage dieses
 * Tests mit. Ohne App-Server und ohne Relay (wie `blossom-media-guard.spec.ts`).
 */

// ESM-Modul: kein `__dirname`. Playwright laedt die Spec als Modul.
const WURZEL = join(fileURLToPath(new URL('.', import.meta.url)), '../..')
const LIVEWIRE = join(WURZEL, 'vendor/livewire/livewire/dist/livewire.esm.js')

/** Der Upload auf einem Buzz-Space: auth-pflichtig, fuer `$img()` unerreichbar. */
const WORKSPACE_UPLOAD = 'https://buzz.test.invalid/media/frisch.webp'
/** Der Upload auf dem Vereins-Blossom (zooid-Spaces): ganz normal proxifizierbar. */
const BLOSSOM_UPLOAD = 'https://blossom.test.invalid/abc.webp'
/** Was `thumbDataUrl` liefert — hier ein winziges echtes PNG. */
const VORSCHAU = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

/** Den echten Composer rendern (Kontext `room`) und die Vorschau-Kachel herausschneiden. */
const rendereVorschau = (): string => {
    const verzeichnis = mkdtempSync(join(tmpdir(), 'composer-preview-'))
    const ziel = join(verzeichnis, 'markup.html')
    const php = `file_put_contents(${JSON.stringify(ziel)}, view('group::partials.chat-composer', ['context' => 'room'])->render());`
    execFileSync('php', ['artisan', 'tinker', '--execute', php], {
        cwd: WURZEL,
        timeout: 120_000,
        // Die Server-ENV ausdrücklich neutralisieren (`support/serverEnv.ts`).
        // **Dieser Prozess sah bis zum P7-Gate die rohe `.env`** — er ist einer von
        // zwei `tinker`-Spawns ohne env-Option und zugleich eine der drei Specs
        // außerhalb des Relay-Wächters: zwei Blindstellen, die einander decken.
        // Heute rendert er nur Partials und fasst die Relay-Config nicht an; das ist
        // eine Momentaufnahme, keine Eigenschaft. `slot: 0`, weil dieser Spec kein
        // Worker-Backend hat — die Werte zeigen damit auf lokale Ports, nicht ins Netz.
        env: { ...process.env, ...testServerEnv({ slot: 0 }) },
    })
    const markup = readFileSync(ziel, 'utf8')

    // Nur der Vorschau-Block: der Rest des Composers braucht die ganze Alpine-Insel
    // (Drafts, Mentions, Emoji-Panel). Findet der Schnitt nichts, schlaegt der Test
    // fehl, statt still weniger zu pruefen.
    const von = markup.indexOf('<div x-show="attachment"')
    expect(von, 'Vorschau-Block nicht gefunden — Schnittmarke veraltet?').toBeGreaterThan(-1)
    const bis = markup.indexOf('<div class="min-w-0 flex-1', von)
    expect(bis).toBeGreaterThan(von)

    return markup.slice(von, bis) + '</div>'
}

const seite = (block: string): string => `<!doctype html><html><head><meta charset="utf-8"></head><body>
<div data-fall="mit_vorschau" x-data="{ attachment: { url: '${WORKSPACE_UPLOAD}', previewUrl: '${VORSCHAU}' } }">${block}</div>
<div data-fall="ohne_vorschau_workspace" x-data="{ attachment: { url: '${WORKSPACE_UPLOAD}' } }">${block}</div>
<div data-fall="ohne_vorschau_blossom" x-data="{ attachment: { url: '${BLOSSOM_UPLOAD}' } }">${block}</div>
<script type="module">
  import { Alpine } from '/livewire.esm.js'
  window.Alpine = Alpine
  // \`$img\` auf seinen Vertrag verengt, INKLUSIVE der Wache: ein Medium des
  // Workspace-Relays bekommt '' (js/core.ts + js/mediaGuard.ts).
  Alpine.magic('img', () => (url, preset) => {
    if (!url) return ''
    if (url.startsWith('https://buzz.test.invalid/')) return ''
    return '/img/' + (preset || 'avatar') + '?src=' + encodeURIComponent(url)
  })
  Alpine.start()
</script>
</body></html>`

test.describe('Anhang-Vorschau im Composer', () => {
    test('zeigt die eigenen Bytes — auch wenn der Upload auth-pflichtig ist', async ({ page }) => {
        const block = rendereVorschau()
        const angefragt: string[] = []

        await page.route('**/*', async (route) => {
            const url = route.request().url()
            if (url === 'http://composer.test/') {
                return route.fulfill({ contentType: 'text/html', body: seite(block) })
            }
            if (url.endsWith('/livewire.esm.js')) {
                return route.fulfill({ path: LIVEWIRE, contentType: 'text/javascript' })
            }
            angefragt.push(url)

            return route.fulfill({
                contentType: 'image/png',
                body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'),
            })
        })

        await page.goto('http://composer.test/')
        await page.waitForFunction(() => Boolean((window as unknown as { Alpine?: unknown }).Alpine))
        await page.waitForTimeout(200)

        const bilder = await page.evaluate(() =>
            [...document.querySelectorAll('[data-fall]')].map((el) => ({
                fall: (el as HTMLElement).dataset.fall,
                src: el.querySelector('img')?.getAttribute('src') ?? null,
            })),
        )
        const nach = (fall: string) => bilder.find((b) => b.fall === fall)?.src ?? null

        // Der Kern: die Kachel zeigt die eigenen Bytes, nicht die unerreichbare URL.
        expect(nach('mit_vorschau'), 'auth-pflichtiger Upload: eigene data:-Bytes').toBe(VORSCHAU)

        // Der Rueckfall bleibt: ohne Vorschau-Bytes entscheidet weiterhin `$img()` —
        // fuer den Vereins-Blossom der Proxy, fuer das Workspace-Relay nichts.
        expect(nach('ohne_vorschau_blossom')).toContain('/img/msg?src=')
        expect(nach('ohne_vorschau_workspace'), 'ohne Vorschau bleibt es leer — aber es geht nichts raus').toBe('')

        // Und nichts davon hat den Relay beruehrt, weder roh noch ueber den Proxy.
        expect(angefragt.filter((u) => u.includes('buzz.test.invalid'))).toEqual([])
    })
})
