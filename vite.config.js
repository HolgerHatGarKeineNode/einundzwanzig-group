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
                    // **`profileMerge.ts` back where it was before the directory island
                    // became lazy** (2026-09-15). It is import-free rule code that four
                    // graphs reach — the entry, the `publishResult` chunk, the lazy
                    // `readStateSync` chunk and now the lazy `directoryIsland` chunk. That
                    // fourth reacher changed its reachability set, and Rolldown answered by
                    // giving it a chunk of its own: a SEVENTH boot chunk, i.e. one more HTTP
                    // request on every page in both hosts, for 620 B gzip.
                    //
                    // Measured, `npm run build` each time:
                    //
                    //   Variant                             boot chunks   app chunk gzip
                    //   no rule, island still in bridge.ts  6             112 160
                    //   no rule, island lazy                7             108 484
                    //   this rule, island lazy              6             108 447
                    //
                    // In the first line `profileMerge` has no chunk of its own — it rides in
                    // one of the two shared app-code chunks. In the second it has one, and
                    // that chunk IS the seventh request. The third line buys that request
                    // back for 0.47 kB gzip in `nip98` (0.56 → 1.03), which is the same code
                    // in one file fewer, not new weight.
                    //
                    // The target is an existing boot chunk on purpose: a name of its own
                    // would be the seventh chunk again, whatever it is called. `nip98` and
                    // not `publishResult` for one reason only — Rolldown keeps the auto-name
                    // of the big chunk, so a group called `publishResult` produces TWO files
                    // named `publishResult-*.js` and nobody reading `public/build` can tell
                    // them apart. `js/nip98.ts` is the same kind of module (app code shared
                    // between the boot graph and the lazy graphs) and the same size class.
                    //
                    // If `js/nip98.ts` is ever renamed or dropped, this rule makes a chunk of
                    // its own again and the boot-chunk count in
                    // `tests/e2e/support/bundleGrenze.nodetest.ts` goes to 7 and red. That is
                    // the intended direction: it fails loudly, not silently.
                    if (/\/packages\/einundzwanzig-group\/js\/profileMerge\.ts$/.test(id)) {
                        return 'nip98';
                    }
                },
            },
        },
    },
});
