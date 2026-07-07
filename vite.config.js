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
                'resources/js/passkeys.js',
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
    build: {
        rollupOptions: {
            output: {
                // welshman + nostr-tools sind ~700 KB und ändern sich fast nie —
                // in einen eigenen, cache-stabilen Vendor-Chunk trennen, damit ein
                // App-Code-Deploy nicht das ganze SDK neu ausliefert (Cache-Hit).
                manualChunks(id) {
                    if (id.includes('/node_modules/@welshman/') || id.includes('/node_modules/nostr-tools/')) {
                        return 'welshman';
                    }
                },
            },
        },
    },
});
