import { defineConfig } from '@playwright/test'
import { chromiumHermetikArgs } from './tests/e2e/support/hermetik'
import { readFileSync } from 'node:fs'
import { cpus } from 'node:os'

// Wegwerf-nsec (NOSTR_TEST_NSEC) + APP-Konfig aus der .env in process.env laden.
process.loadEnvFile('.env')

/**
 * Every spec reaches the relay through `nak`, and fifty of them carry their own `nak()` helper
 * around `process.env.NAK`. A `nak req` can come back empty with exit 0 when its NIP-42 round
 * never ran (measured 2026-10-25: 2 of 120 calls with a busy machine) — so the repair sits at
 * the binary: `NAK` points to a wrapper that re-asks exactly that case, `NAK_REAL` is the
 * binary underneath. See `support/nak-resilient.sh`. Workers inherit both from this process.
 */
if (!process.env.NAK?.endsWith('nak-resilient.sh')) {
    process.env.NAK_REAL = process.env.NAK ?? `${process.env.HOME}/go/bin/nak`
    process.env.NAK = new URL('./tests/e2e/support/nak-resilient.sh', import.meta.url).pathname
}

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
 * How many workers the machine can carry RIGHT NOW — derived from the CPU that is actually idle,
 * not from a number that was right on one machine on one day.
 *
 * Each worker is a Chromium, a `php artisan serve` with four PHP workers and a zooid; a full run
 * averaged ~8 busy cores for six workers (measured 2026-10-25: 3100 cpu-s in 390 s) and peaked far
 * above that. When another job holds half of the box the six workers starve each other and the
 * product's own bounds (welshman's 3 s load, the 6 s follow read) start to trip: reds that are
 * not in any test. Idle threads are sampled over one second before the run starts; ~2.5 idle
 * threads per worker, never fewer than 3 and never more than 6 (`E2E_WORKERS` overrides all of
 * this; CI keeps 4). On this 24-thread machine: idle ≥ 15 threads → 6 workers, 12 → 5, 9 → 4.
 * Anything that cannot read `/proc/stat` keeps 6.
 */
const workersFromIdleCpu = (): number => {
    try {
        const sample = (): { busy: number; total: number } => {
            const f = readFileSync('/proc/stat', 'utf8').split('\n')[0]!.trim().split(/\s+/).slice(1).map(Number)
            const idle = (f[3] ?? 0) + (f[4] ?? 0)
            const total = f.reduce((a, b) => a + b, 0)

            return { busy: total - idle, total }
        }
        const a = sample()
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1_000)
        const b = sample()
        const threads = cpus().length
        const idleThreads = (1 - (b.busy - a.busy) / Math.max(1, b.total - a.total)) * threads

        return Math.max(3, Math.min(6, Math.round(idleThreads / 2.5)))
    } catch {
        return 6
    }
}

/**
 * Decided ONCE, in the process that starts the run, and handed down through the environment:
 * the config file is evaluated again in every worker, and a worker that sampled the CPU for a
 * second of its own would both waste that second and could come to another number.
 */
const resolveWorkers = (): number => {
    if (process.env.E2E_WORKERS) {
        return Number(process.env.E2E_WORKERS)
    }
    const n = process.env.CI ? 4 : workersFromIdleCpu()
    process.env.E2E_WORKERS = String(n)

    return n
}

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
/*
 * `relay-guard.spec.ts` und `relay-praevention.spec.ts` stehen ebenfalls namentlich
 * daneben, aus dem umgekehrten Grund wie `pin-room`: sie prüfen nicht eine Fläche,
 * sondern die HERMETIK des Laufs selbst. Die ist im Buzz-Arm genauso scharf — der
 * Relay-Wächter urteilt dort über jeden Test —, ihre eigene Verdrahtungsprüfung lief
 * dort aber nicht mit. Ein Riegel, der nur in einem von zwei Armen nachgewiesen ist,
 * sagt über den anderen nichts.
 */
/*
 * `response-guard.spec.ts` stands here for exactly that sentence, since 2026-09-15. Its
 * absence never withheld the response guard's JUDGEMENT from the Buzz arm — the
 * `relayWaechter` fixture is `{ auto: true }` and every Buzz spec draws its `test` from
 * `support/fixtures` (counted by `support/specImporte.nodetest.ts`), so the guard has
 * judged every test there from its first run. What was missing was only its SELF-PROOF,
 * and its own header said the opposite until this line was added.
 */
const BUZZ_SPECS = /(?:^|\/)(?:buzz-.*|pin-room|relay-guard|relay-praevention|response-guard)\.spec\.ts$/

/**
 * Host-Chromium, kein von Playwright heruntergeladenes Binary — gilt für JEDES Projekt.
 *
 * Die Start-Argumente kommen aus `support/hermetik.ts` und tragen seit dem P7-Gate die
 * **erste Präventionsschicht**: `--host-resolver-rules` lässt Chromium keinen fremden
 * Hostnamen mehr auflösen. Das ist die einzige Schicht, die auch für die drei Specs
 * greift, die ihr `test` nicht aus `support/fixtures.ts` beziehen (und deshalb weder
 * Wächter noch den WebSocket-Wrapper sehen) — siehe `support/specImporte.nodetest.ts`.
 *
 * Wer ein drittes Projekt anlegt: `...hostChromium` gehört zwingend hinein, sonst fährt
 * es ohne Prävention. `hermetik.nodetest.ts` zählt das nach.
 */
const hostChromium = {
    browserName: 'chromium' as const,
    launchOptions: {
        executablePath: '/bin/chromium',
        args: chromiumHermetikArgs(),
    },
}

export default defineConfig({
    testDir: './tests/e2e',
    fullyParallel: true,
    /**
     * The default 30 s is SHORTER than what the specs ask for inside a test: `oeffneForge()` alone
     * waits up to 30 s for the repo list, `toBeVisible({ timeout: 30_000 })` is on 328 lines, and a
     * test that opens a page, logs in and waits twice therefore hit "Test timeout of 30000ms
     * exceeded" while its own conditions were still within their budget (desktop-forge:528,
     * forge-readme:532, verein-onboarding:41, room.spec x6 — all red under load on 2026-10-25,
     * all green alone). A test-level bound smaller than the sum of its own waits is a defect, not
     * a guard. 90 s only moves the point where a genuine hang is reported; tests that need more
     * still set `test.setTimeout` themselves.
     */
    timeout: 90_000,
    /**
     * Playwright's default for an `expect` WITHOUT an explicit timeout is 5 s — a number for an
     * idle machine. The specs set an explicit window wherever they thought of one; the rest
     * (`toBeVisible()`, `toHaveText(…)`, `toHaveCount(0)` …) inherits this. It is only the upper
     * bound of a condition that is awaited anyway, so a passing assertion does not get slower;
     * assertions that expect something NOT to be there pass at once and do not use it.
     */
    expect: { timeout: 15_000 },
    // 1 serve + 1 Relay + 1 Chromium je Worker. Auf CI knapper halten.
    // Buzz zieht pro Worker einen eigenen Docker-Stack hoch (4 Container) — deshalb
    // dort weniger Worker als bei zooid, aber eben nicht mehr nur einer.
    // `E2E_BUZZ_WORKERS` überschreibt das, wenn die Maschine mehr oder weniger verträgt.
    workers: isBuzz
        ? Number(process.env.E2E_BUZZ_WORKERS ?? (process.env.CI ? '2' : '4'))
        : resolveWorkers(),
    reporter: [['list']],
    globalSetup: './tests/e2e/support/global-setup.ts',
    // Räumt am Laufende die EIGENEN Slots vollständig ab (Prozesse, Docker-Container/
    // -Netze/-Volumes, Marker) — läuft nachweislich auch nach einfachem Ctrl-C
    // (graceful SIGINT), siehe Kopfkommentar in global-teardown.ts. Gegen den Rest-Fall
    // (SIGKILL, Absturz) steht reap-stale-teststacks.sh, verdrahtet in global-setup.ts.
    globalTeardown: './tests/e2e/support/global-teardown.ts',
    use: {
        // baseURL setzt das workerBackend-Fixture pro Worker (worker-eigener serve-Port).
        trace: 'on-first-retry',
        /**
         * Der Test-Browser spricht Deutsch.
         *
         * Die `SetLocale`-Middleware verhandelt NICHT über `Accept-Language` —
         * die Verhandlung wurde mit `fc9c3ec` (Nutzerentscheid 2026-08-13)
         * entfernt. Auflösung heute: Cookie `locale` → Session → erster
         * Whitelist-Eintrag (`de`). Ein Browser mit `en-US` bekäme also auch
         * OHNE diesen Pin Deutsch — der Fallback ist das Haus.
         *
         * Der Pin bleibt trotzdem und ist jetzt eine Deklaration, kein Hebel:
         * Die Suite assertet deutschen Text („Anmelden", „Räume", …). `locale`
         * setzt `Accept-Language` UND `navigator.language` — sollte die
         * Verhandlung je zurückkehren, bleibt der Lauf deterministisch deutsch,
         * statt still umzufärben. Wer einen Render-Smoke baut: `Accept-Language`
         * ist seit `fc9c3ec` bewusst wirkungslos — drei Läufe mit `lang=de`
         * sind kein Befund (genau hierauf ist ein Prüfer mal hereingefallen).
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
