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
                // **Die Adapter liegen seit dem 0.9.5-Sprung in einem EIGENEN Chunk,
                // nicht mehr im Vendor-Chunk.** Bis dahin lagen sie mit darin, und das
                // lief seinem Zweck zuwider: ein Adapter-Deploy invalidierte das ganze
                // SDK. Vertretbar war es nur, solange die Adapter reine Umbau-Hüllen für
                // den anstehenden Sprung waren — inzwischen tragen sie eigene Logik
                // (App-Instanz und Identitätswechsel, Netz-Kontext, Relay-Auswahl,
                // Zap-API, Listen/Räume) und ändern sich mit dem App-Code.
                //
                // **Warum ein eigener Chunk und nicht gar keine Regel:** gemessen. Ohne
                // jede Regel schneidet Rolldown sie in DREI Boot-Chunks
                // (`welshmanApp`, `nip98`, `publishResult`) — 8 statt 5 Anfragen auf
                // jeder Seite, in beiden Hosts. Ein gemeinsamer Chunk macht daraus eine.
                // Die Ursache ist strukturell und bleibt: die Adapter werden vom Boot-
                // UND vom Lazy-Graph geteilt, das ist ihr Zweck; nimmt man einen einzeln
                // heraus, rückt der nächste nach.
                //
                // Der Name trägt bewusst KEIN `welshman-`-Präfix: der Riegel in
                // `tests/e2e/support/bundleGrenze.nodetest.ts` zählt über
                // `/welshman-[^/]*\.js$/` genau EINEN Vendor-Chunk im Boot-Pfad, und ein
                // zweiter Treffer würde diese Gegenprobe still entwerten.
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
