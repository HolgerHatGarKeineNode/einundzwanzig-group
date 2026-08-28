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
                // Die `js/welshman*.ts`-Adapter des Pakets liegen bewusst MIT darin,
                // obwohl sie unser Code sind. Grund: sie werden per Konstruktion vom
                // Boot- UND vom Lazy-Graph geteilt (das ist ihr Zweck), und Rolldown
                // zieht so etwas sonst als eigenen Chunk heraus — gemessen 2026-08-28:
                // ohne diese Regel 6 statt 5 Boot-Chunks, also eine zusätzliche
                // Anfrage auf JEDER Seite, in beiden Hosts. Sie einzeln zuzuordnen
                // hilft nicht: nimmt man `welshmanKinds` heraus, rückt `welshmanApp`
                // als nächster Chunk nach. `experimentalMinChunkSize` ignoriert
                // Rolldown, und der Chunk-Name 'app' kollidiert mit dem Entry und
                // zerriss den Vendor-Chunk (517 kB + ein zweiter app-Chunk).
                //
                // Der Preis ist benannt, nicht verschwiegen: ein Adapter-Deploy
                // invalidiert damit den Vendor-Chunk. Das trifft P3 (die Adapter
                // werden dort umgebaut und größtenteils gelöscht) und endet mit ihm —
                // danach gehört diese Regel entfernt.
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
