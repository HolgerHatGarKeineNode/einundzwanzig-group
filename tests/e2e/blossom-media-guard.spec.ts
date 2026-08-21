import { test, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { testServerEnv } from './support/serverEnv'

/**
 * **Die Zusage, die nur im Markup entsteht: für ein auth-pflichtiges Bild entsteht
 * KEIN `<img>` und geht KEINE Anfrage raus.**
 *
 * Warum das hier steht und nicht in `node --test`: die Regel lebt in Blade+Alpine
 * (`x-effect="$blossomBind($data, …)"`, `x-if="… (!needsAuth || authSrc)"`). Genau in
 * dieser ungetesteten Schicht saß der Fehler, den diese Datei jetzt abfängt: der
 * Banner der Profilkarte rannte mit einer privaten Workspace-URL in `$img(...)`, also
 * an den serverseitigen Bild-Proxy — den Weg, der ausdrücklich verworfen ist. Der
 * Avatar daneben war korrekt; eine Zusage, die pro Fläche neu eingehalten werden muss,
 * wird irgendwo nicht eingehalten.
 *
 * **Ohne App-Server und ohne Relay.** Die Spec zieht bewusst NICHT `./support/fixtures`
 * (das fährt `artisan serve` + Relay pro Worker hoch): gebraucht wird nur das gerenderte
 * Markup, Alpines eigene Kopie aus `vendor/livewire` und ein abgefangenes Netz. Das
 * Markup wird zur Laufzeit aus den ECHTEN Blade-Dateien gerendert — wer die Komponente
 * ändert, ändert die Vorlage dieses Tests mit.
 */

// ESM-Modul: kein `__dirname`. Playwright laedt die Spec als Modul.
const WURZEL = join(fileURLToPath(new URL('.', import.meta.url)), '../..')
const LIVEWIRE = join(WURZEL, 'vendor/livewire/livewire/dist/livewire.esm.js')

/** Ein Bild auf dem Workspace-Relay (auth-pflichtig) und eines von außerhalb. */
const GESCHUETZT = 'https://buzz.test.invalid/media/abc.jpg'
const FREMD = 'https://image.nostr.build/frei.jpg'

/**
 * Die beiden echten Flächen rendern: die Avatar-Komponente ganz, den Banner-Block der
 * Profilkarte als Fragment (die ganze Karte bräuchte ihre Alpine-Insel). Geschnitten
 * wird an den Kommentaren der Datei; findet der Schnitt nichts, schlägt der Test fehl,
 * statt still weniger zu prüfen.
 */
const rendereMarkup = (): string => {
    const karte = readFileSync(join(WURZEL, 'packages/einundzwanzig-group/resources/views/components/profile-card.blade.php'), 'utf8')
    const von = karte.indexOf('{{-- Banner-Header')
    const bis = karte.indexOf('{{-- Scrim Banner')
    expect(von, 'Banner-Block der Profilkarte nicht gefunden — Schnittmarke veraltet?').toBeGreaterThan(-1)
    expect(bis).toBeGreaterThan(von)
    const bannerBlock = karte.slice(von, bis) + '</div>'

    const verzeichnis = mkdtempSync(join(tmpdir(), 'blossom-markup-'))
    const ziel = join(verzeichnis, 'markup.html')
    // **Das Fragment geht über eine DATEI, nicht als Literal in den PHP-Aufruf.** In
    // einem doppelt gequoteten PHP-String interpoliert PHP `$img`, `$data` und
    // `$blossomBind` weg, bevor Blade sie sieht — gemessen: `x-effect="(, banner)"`.
    // Der Test hätte dann ein Markup geprüft, das es nirgends gibt.
    const fragmentDatei = join(verzeichnis, 'banner.blade.php')
    writeFileSync(fragmentDatei, bannerBlock)
    const php = `
        $teile = [];
        foreach ([['avatar_geschuetzt', 'a'], ['avatar_fremd', 'b']] as [$id, $var]) {
            $teile[] = '<div data-fall="'.$id.'">'
                .view('group::components.nostr-avatar', ['picture' => $var.'.picture', 'name' => $var.'.name'])->render()
                .'</div>';
        }
        $teile[] = '<div data-fall="banner_geschuetzt">'
            .Illuminate\\Support\\Facades\\Blade::render(file_get_contents(${JSON.stringify(fragmentDatei)}))
            .'</div>';
        file_put_contents(${JSON.stringify(ziel)}, implode("\\n", $teile));
    `
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
    return readFileSync(ziel, 'utf8')
}

const seite = (markup: string): string => `<!doctype html><html><head><meta charset="utf-8"></head><body>
<div x-data="{
  a: { picture: '${GESCHUETZT}', name: 'ceo' },
  b: { picture: '${FREMD}', name: 'Anna' },
  banner: '${GESCHUETZT}'
}">
${markup}
</div>
<script type="module">
  import { Alpine } from '/livewire.esm.js'
  window.Alpine = Alpine
  // Die drei Magics der App, auf ihren Vertrag verengt. \`$blossomBind\` spiegelt
  // \`bindAvatarState\` aus \`js/blossomMedia.ts\` (dort unter node geprüft): Zustand
  // zurücksetzen, needsAuth setzen, später authSrc/imgBroken nachziehen. Hier
  // beantwortet er JEDE geschützte URL mit "kein Zugriff" — der 401-Fall.
  Alpine.magic('img', () => (url, preset) => '/img/' + (preset || 'avatar') + '?src=' + encodeURIComponent(url || ''))
  Alpine.magic('imgFallback', () => () => true)
  Alpine.magic('blossomBind', () => (state, url) => {
    state.imgOrig = false; state.imgBroken = false; state.authSrc = ''
    state.needsAuth = typeof url === 'string' && url.startsWith('https://buzz.test.invalid/')
    if (state.needsAuth) setTimeout(() => { state.authSrc = ''; state.imgBroken = true }, 10)
  })
  Alpine.start()
</script>
</body></html>`

test.describe('Auth-pflichtige Medien erreichen weder Proxy noch rohes <img>', () => {
    test('kein <img> und keine Anfrage — für Avatar UND Banner', async ({ page }) => {
        const markup = rendereMarkup()
        const angefragt: string[] = []

        await page.route('**/*', async (route) => {
            const url = route.request().url()
            if (url === 'http://blossom.test/') {
                return route.fulfill({ contentType: 'text/html', body: seite(markup) })
            }
            if (url.endsWith('/livewire.esm.js')) {
                return route.fulfill({ path: LIVEWIRE, contentType: 'text/javascript' })
            }
            angefragt.push(url)
            // **Beantworten statt abbrechen.** Ein Abbruch loest `x-on:error` aus, die
            // Fallback-Kette laeuft durch und entfernt am Ende auch das FREMDE Bild —
            // die Positivkontrolle waere dann aus dem falschen Grund gruen (kein <img>
            // ueberall). Ein echtes 1x1-PNG haelt sie am Leben.
            return route.fulfill({
                contentType: 'image/png',
                body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'),
            })
        })

        await page.goto('http://blossom.test/')
        await page.waitForFunction(() => Boolean((window as unknown as { Alpine?: unknown }).Alpine))
        await page.waitForTimeout(200)

        const bilder = await page.evaluate(() =>
            [...document.querySelectorAll('[data-fall]')].map((el) => ({
                fall: (el as HTMLElement).dataset.fall,
                src: el.querySelector('img')?.getAttribute('src') ?? null,
            })),
        )
        const nach = (fall: string) => bilder.find((b) => b.fall === fall)?.src ?? null

        // Der Kern: für ein Bild des Workspace-Relays entsteht ÜBERHAUPT KEIN <img>.
        expect(nach('avatar_geschuetzt'), 'Avatar: kein <img> ohne blob:-URL').toBeNull()
        expect(nach('banner_geschuetzt'), 'Banner: derselbe Weg wie der Avatar — hier lag der Fehler').toBeNull()

        // Gegenprobe: ein fremdes Bild läuft weiter über den Proxy.
        expect(nach('avatar_fremd')).toContain('/img/avatar?src=')

        // Und nichts davon hat den Draht berührt: weder der Relay noch unser Bild-Proxy.
        expect(angefragt.filter((u) => u.includes('buzz.test.invalid'))).toEqual([])
        expect(angefragt.filter((u) => u.includes('/img/') && u.includes('buzz.test.invalid'))).toEqual([])
    })
})
