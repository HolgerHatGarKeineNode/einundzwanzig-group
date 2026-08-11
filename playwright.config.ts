import { defineConfig } from '@playwright/test'

// Wegwerf-nsec (NOSTR_TEST_NSEC) + APP-Konfig aus der .env in process.env laden.
process.loadEnvFile('.env')

/**
 * E2E-Suite mit ECHTER Parallelität. Host-Chromium (kein Playwright-Browser-Download).
 * Jeder Worker fährt SEINE eigene `php artisan serve`- + zooid-Instanz auf worker-
 * spezifischen Ports hoch (serve = 8137+slot, zooid = 3335+slot) — siehe
 * tests/e2e/support/fixtures.ts, das auch baseURL pro Worker setzt. Das Vite-Bundle +
 * das zooid-Binary werden EINMAL in global-setup gebaut; der Relay-Seed passiert pro
 * Worker im Fixture. So teilen sich Worker weder Relay-Räume noch Session/Cache.
 *
 * Deshalb KEIN globaler `webServer` mehr: die Server-Lebenszyklen managt das Fixture.
 *
 * `E2E_RELAY=buzz|zooid` (Default zooid, siehe support/global-setup.ts + support/
 * fixtures.ts): schaltet die Suite wahlweise gegen den lokalen Buzz-TEST-Stack
 * (Docker-Compose-Projekt `buzz-test-<port>`) statt zooid. Buzz bekommt einen eigenen
 * Docker-Stack je Worker (Port 3001+slot, eigenes Compose-Projekt, eigene Volumes) —
 * genau wie zooid. Vorher war es EIN geteilter Stack und der Modus auf workers:1
 * festgenagelt; dieselbe Arbeit brauchte damit 13–15 min statt gut 2 (gemessen:
 * 753 s Testzeit Buzz gegen 633 s zooid).
 */
const isBuzz = process.env.E2E_RELAY === 'buzz'

/**
 * **Der Buzz-Modus fährt NUR die Buzz-Specs.**
 *
 * Vorher fuhr er die ganze Suite — und die zooid-Specs liefen dort gegen einen Relay,
 * den dieser Modus **nie aufsetzt**: `fixtures.ts workerBackend` startet bei
 * `E2E_RELAY=buzz` ausschließlich den Docker-Stack, `zooid-testserver.sh` läuft nicht.
 * Dass sie trotzdem meist grün waren, lag an Übriggebliebenem: die zooid-Instanzen des
 * letzten Normal-Laufs bleiben absichtlich stehen (RUNMARK-Wiederverwendung) und werden
 * im Buzz-Modus weder geseedet noch geprüft. Am 2026-07-31 nachgesehen: sechs `bin/zooid`
 * lauschten auf 3335–3340, eine davon aus einem deutlich älteren Lauf.
 *
 * Das erklärt das Muster, das mehrere Abnahmen gekostet hat: **jedes Mal 2–3 rot, jedes
 * Mal andere** (`room.spec:341`, `:1221`, `updates:1077`, `spaces:200`), isoliert immer
 * grün. Das war kein Flake im Produkt, sondern eine Messung gegen einen Zustand, den
 * niemand hergestellt hat.
 *
 * `workspaces.spec.ts` bleibt AUSSEN VOR, obwohl es Buzz berührt: es fährt im
 * zooid-Modus und braucht beide Stacks gleichzeitig — genau das ist seine Aussage.
 */
/*
 * `pin-room.spec.ts` steht namentlich daneben, obwohl es nicht mit `buzz-` beginnt.
 * Umbenennen wäre falsch: die Datei ist zu zwei Dritteln reine Logik und zooid-E2E,
 * die im Normalmodus laufen MÜSSEN — ein `buzz-`-Name schlösse sie dort aus.
 * Anpinnen ist die erste Fläche, die auf beiden Relays verschiedene Kinds schickt
 * (zooid 9010→39005, Buzz 40004), also die erste, die BEIDE Arme braucht.
 *
 * Die Lücke war teuer: `E2E_RELAY=buzz npx playwright test tests/e2e/pin-room.spec.ts
 * --list` meldete "Total: 0 tests in 0 files", obwohl die Datei 27 Tests trägt — kein
 * Fehler, kein Hinweis, nur Stille. Der Buzz-Pin war dabei komplett kaputt und wäre
 * unentdeckt geblieben. Wer hier eine Spec ergänzt, ergänzt sie in DIESER Liste.
 */
const BUZZ_SPECS = /(?:buzz-.*|pin-room)\.spec\.ts$/

/** Host-Chromium, kein von Playwright heruntergeladenes Binary — gilt für JEDES Projekt. */
const hostChromium = {
    browserName: 'chromium' as const,
    launchOptions: {
        executablePath: '/bin/chromium',
        args: ['--no-sandbox'],
    },
}

export default defineConfig({
    testDir: './tests/e2e',
    fullyParallel: true,
    // 1 serve + 1 Relay + 1 Chromium je Worker. Auf CI knapper halten.
    // Buzz zieht pro Worker einen eigenen Docker-Stack hoch (4 Container) — deshalb
    // dort weniger Worker als bei zooid, aber eben nicht mehr nur einer.
    // `E2E_BUZZ_WORKERS` überschreibt das, wenn die Maschine mehr oder weniger verträgt.
    workers: isBuzz
        ? Number(process.env.E2E_BUZZ_WORKERS ?? (process.env.CI ? '2' : '4'))
        : process.env.CI
          ? 4
          : 6,
    reporter: [['list']],
    globalSetup: './tests/e2e/support/global-setup.ts',
    use: {
        // baseURL setzt das workerBackend-Fixture pro Worker (worker-eigener serve-Port).
        trace: 'on-first-retry',
        /**
         * Der Test-Browser spricht Deutsch.
         *
         * Seit P2 verhandelt die `SetLocale`-Middleware die Oberflächensprache über
         * `Accept-Language`, solange kein Sprach-Cookie gesetzt ist. Host-Chromium
         * sendet ab Werk `en-US,en` — ohne diesen Pin renderte die gesamte Suite auf
         * Englisch und jede Assertion auf deutschen Text („Anmelden", „Räume", …)
         * ginge rot, obwohl am Produkt nichts kaputt ist.
         *
         * `locale` setzt beides: den `Accept-Language`-Header (das ist der Hebel für
         * die Middleware) UND `navigator.language`.
         *
         * Eine Spec, die den Sprachwechsel SELBST prüft, setzt ihren eigenen Context
         * (`test.use({ locale: 'es-ES' })`) oder ein `locale`-Cookie — beides sticht
         * diesen Default.
         */
        locale: 'de-DE',
    },
    projects: [
        /**
         * Bestandssuite — GEPINNT auf 1279 px Breite.
         *
         * Playwrights Default ist 1280×720 und damit exakt der `xl:`-Breakpoint der
         * kommenden Desktop-Ansicht (zweispaltig, linke Rail statt Bottom-Nav). Ohne
         * diesen Pin kippte die gesamte Bestandssuite mit dem ersten Desktop-Commit
         * ungewollt in den Desktop-Modus und misst dann NICHT mehr, was sie heute misst
         * — ohne dass ein einziger Test rot wird, was das Schlimmste daran ist.
         *
         * 1279 (nicht 1024): zwischen `lg` (1024) und `xl` (1280) ändert sich am
         * heutigen Markup nichts, 1279 rendert also zeichengleich zu 1280/heute, liegt
         * aber unter dem neuen Breakpoint. Der Pin ist damit im Ist-Zustand ein No-op
         * und im Soll-Zustand die Grenze. Kein Test der Suite darf sich durch ihn ändern.
         *
         * Die drei Tests mit eigenem `setViewportSize` (updates.spec.ts:844/:1393,
         * room.spec.ts:2396 und der Layout-Wächter unten) überschreiben ihn bewusst
         * pro Test — `setViewportSize` sticht die Projekt-Vorgabe, das bleibt so.
         */
        {
            name: 'chromium',
            // Desktop-Specs gehören ins `desktop`-Projekt, nicht zusätzlich hierher:
            // sonst liefe eine `desktop-*.spec.ts` auch bei 1279 px, also genau unter
            // dem Breakpoint, den sie prüfen soll. Heute ein No-op (keine solche Datei).
            testIgnore: /desktop-.*\.spec\.ts$/,
            ...(isBuzz ? { testMatch: BUZZ_SPECS } : {}),
            use: {
                ...hostChromium,
                viewport: { width: 1279, height: 720 },
            },
        },
        /**
         * Desktop-Ansicht (≥1280 px, `xl:`) — fährt AUSSCHLIESSLICH `desktop-*.spec.ts`.
         * Solche Dateien gibt es noch nicht; das Projekt läuft deshalb vorerst leer
         * durch. Das ist beabsichtigt: der Platz steht, bevor der Umbau beginnt.
         */
        {
            name: 'desktop',
            // Im Buzz-Modus hat das Desktop-Projekt nichts zu tun: es fährt zooid-Specs.
            testMatch: isBuzz ? /$^/ : /desktop-.*\.spec\.ts$/,
            use: {
                ...hostChromium,
                viewport: { width: 1440, height: 900 },
            },
        },
    ],
})
