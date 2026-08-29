import {
    defineConfig
} from 'vite';
import laravel from 'laravel-vite-plugin';
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
    plugins: [
        laravel({
            input: [
                'resources/css/app.css',
                'resources/js/app.ts',
            ],
            refresh: true,
        }),
        tailwindcss(),
    ],
    server: {
        cors: true,
        watch: {
            ignored: ['**/storage/framework/views/**'],
        },
    },
    // Local-Dev-Package NICHT pre-bundeln: sonst landet `@einundzwanzig/group`
    // (Roh-TS via file:-Symlink) im optimizeDeps-Cache und liegt außerhalb des
    // HMR-/Watch-Graphs → Package-JS-Änderungen erschienen erst nach Vite-Neustart.
    // Ausgeschlossen folgt Vite dem Symlink und lädt die TS live (HMR).
    optimizeDeps: {
        exclude: ['@einundzwanzig/group'],
    },
    build: {
        rollupOptions: {
            output: {
                // welshman + nostr-tools sind ~700 KB und ändern sich fast nie —
                // in einen eigenen, cache-stabilen Vendor-Chunk trennen, damit ein
                // App-Code-Deploy nicht das ganze SDK neu ausliefert (Cache-Hit).
                //
                // **Die Adapter liegen im SELBEN Chunk wie das SDK** — das sagen die
                // zwei `return 'welshman'` unten, und seit dem 2026-08-29 sagt es auch
                // dieser Kommentar. Bis dahin stand hier, sie lägen „seit dem
                // 0.9.5-Sprung in einem EIGENEN Chunk"; das beschrieb eine Variante, die
                // gemessen und VERWORFEN wurde. Ein Kommentar, der eine verworfene
                // Variante als geltend ausgibt, ist schlimmer als keiner: er lädt dazu
                // ein, die Regel darunter für einen Fehler zu halten und zu „reparieren".
                //
                // Die Messung, drei Varianten, Boot-Chunks je Seite:
                //
                //   Regel wie unten (Adapter im Vendor-Chunk)  → 6, Vendor-Chunk intakt
                //   Adapter in eigenen Chunk                   → 7, Vendor 991 → 107 kB
                //   Regel ganz entfernt                        → 8
                //
                // Die mittlere Variante kostet also nicht nur eine Anfrage mehr, sondern
                // zersägt den cache-stabilen Vendor-Chunk, dessentwegen die Regel
                // überhaupt existiert: 884 kB SDK wandern in Chunks, die bei jedem
                // App-Deploy neu ausgeliefert werden. Genau das, was hier verhindert
                // werden soll — der Einwand gegen die aktuelle Form (ein Adapter-Deploy
                // invalidiert das SDK) trifft die Alternative also härter als sie selbst.
                //
                // Ohne jede Regel schneidet Rolldown die Adapter in DREI Boot-Chunks
                // (`welshmanApp`, `nip98`, `publishResult`). Die Ursache ist strukturell
                // und bleibt: die Adapter werden vom Boot- UND vom Lazy-Graph geteilt,
                // das ist ihr Zweck; nimmt man einen einzeln heraus, rückt der nächste
                // nach.
                //
                // Ein Nebeneffekt der geltenden Form, den der Riegel in
                // `tests/e2e/support/bundleGrenze.nodetest.ts` braucht: er zählt über
                // `/welshman-[^/]*\.js$/` genau EINEN Vendor-Chunk im Boot-Pfad. Weil
                // beide Regeln unten denselben Namen zurückgeben, gibt es genau einen
                // Treffer. Ein zweiter Chunk mit `welshman`-Präfix würde diese
                // Gegenprobe still entwerten.
                manualChunks(id) {
                    if (id.includes('/node_modules/@welshman/') || id.includes('/node_modules/nostr-tools/')) {
                        return 'welshman';
                    }
                    if (/\/packages\/einundzwanzig-group\/js\/welshman[A-Z]\w*\.ts$/.test(id)) {
                        return 'welshman';
                    }
                },
            },
        },
    },
});
