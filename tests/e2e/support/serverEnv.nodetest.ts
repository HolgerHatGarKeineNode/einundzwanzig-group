/**
 * Der Riegel unter dem Riegel: **stimmt `testServerEnv` noch mit dem überein, was die
 * Anwendung tatsächlich aus der Umgebung liest?**
 *   node --test --experimental-strip-types tests/e2e/support/serverEnv.nodetest.ts
 *
 * ── Warum diese Datei die Liste GEWINNT und nicht aufzählt ──────────────────────────
 *
 * Eine Aufzählung wäre dieselbe ungeführte Liste in einer anderen Datei — und genau die
 * hat zweimal versagt: in P0 fehlte `NOSTR_BOARD_URL` in der Server-ENV, in P5
 * `NOSTR_WORKSPACE_URL`. Beide Male hat ein Mensch es beim Lesen gefunden, nie ein Test.
 * Hier wird deshalb `config/` (Host **und** Paket) nach `env('NOSTR_…')` durchsucht und
 * behauptet: **jeder** so gefundene Schlüssel steht im Helfer.
 *
 * Ein neuer Schlüssel in `config/group.php` macht diesen Test damit rot, bevor er
 * irgendwo eine Verbindung öffnen kann. Das ist die einzige Bauform, die mit einem
 * wachsenden Bestand mithält.
 *
 * ── Die Sonde ist fail-closed ───────────────────────────────────────────────────────
 *
 * Findet der Scanner nichts oder zu wenig, wirft er. Ein Scanner, der still 0 Schlüssel
 * meldet — etwa weil ein Verzeichnis umgezogen ist —, wäre ein grüner Test ohne
 * Gegenstand, und das ist schlimmer als kein Test: er behauptet Deckung.
 *
 * **Die Paket-Falle, warum hier `readdir` steht und kein `grep`:** `grep -r` vom
 * Host-Wurzelverzeichnis findet `packages/einundzwanzig-group` **nicht** — das
 * Verzeichnis steht in `.gitignore:35`, und `grep` respektiert das über die
 * Standardausschlüsse der Werkzeugkette. Genau dort liegen aber fünf der sieben
 * Schlüssel. Ein Scanner, der auf `grep` baut, meldete hier eine beruhigende Teilmenge.
 *
 * ── Die bekannte Lücke, benannt statt verschwiegen ──────────────────────────────────
 *
 * Der Scanner sieht nur PHP und nur `env(...)`. `NOSTR_ROOM_NAMESPACE` steht in der
 * `.env` und wird ausschließlich von `scripts/sync-meetup-rooms.sh` gelesen — von einem
 * Shell-Skript also, das kein Test startet. Deshalb steht es weder hier noch im Helfer.
 * **Das gilt, solange kein Test ein Shell-Skript spawnt** — und **genau diese Bedingung
 * hält jetzt ein Test** (`keine Spec spawnt etwas aus scripts/`, unten). Ein Kommentar
 * ohne Riegel wäre wörtlich die Bauform, gegen die Position 5 der Nacharbeiten gebaut
 * wurde: eine Bedingung, die niemand prüft. Spawnt je eine Spec ein Shell-Skript, wird
 * der Test rot und weist auf `SUCHORTE` als die Stelle, die dann zu erweitern ist.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { testServerEnv } from './serverEnv.ts'
import { ZOOID_BASE_PORT } from './relayGuard.ts'

const WURZEL = fileURLToPath(new URL('../../../', import.meta.url))

/**
 * Die Orte, an denen die Anwendung Umgebungsvariablen liest. `config/` ist der
 * kanonische Ort; `app/` steht daneben, weil ein direkter `env()`-Aufruf im Code
 * genauso wirkt und nicht durch die Config-Schicht geht.
 */
const SUCHORTE = ['config', 'app', 'packages/einundzwanzig-group/config', 'packages/einundzwanzig-group/src']

const phpDateien = (verzeichnis: string): string[] => {
    let treffer: string[] = []
    for (const eintrag of readdirSync(verzeichnis)) {
        const pfad = join(verzeichnis, eintrag)
        if (statSync(pfad).isDirectory()) {
            treffer = treffer.concat(phpDateien(pfad))
        } else if (pfad.endsWith('.php')) {
            treffer.push(pfad)
        }
    }

    return treffer
}

/**
 * Alle `NOSTR_*`-Schlüssel, die irgendwo per `env(...)` gelesen werden.
 *
 * Das Muster verlangt `env(` unmittelbar vor dem Anführungszeichen — ein `NOSTR_…` in
 * einem Kommentar oder in einer Fehlermeldung zählt also nicht. Beide Anführungsarten,
 * weil PHP beide erlaubt.
 */
const gelesenSchluessel = (): string[] => {
    const muster = /env\(\s*['"](NOSTR_[A-Z0-9_]+)['"]/g
    const gefunden = new Set<string>()
    for (const ort of SUCHORTE) {
        for (const datei of phpDateien(join(WURZEL, ort))) {
            const inhalt = readFileSync(datei, 'utf8')
            for (const treffer of inhalt.matchAll(muster)) {
                gefunden.add(treffer[1] as string)
            }
        }
    }

    return [...gefunden].sort()
}

test('der Scanner findet überhaupt etwas — und zwar in BEIDEN Bäumen', () => {
    const schluessel = gelesenSchluessel()
    // Fail-closed: eine leere oder geschrumpfte Ausbeute ist ein Befund über den
    // Scanner, nicht eine Entwarnung über die Anwendung.
    assert.ok(schluessel.length >= 7, `nur ${schluessel.length} Schlüssel gefunden: ${schluessel.join(', ')}`)
    // Zwei Kalibrierpunkte, ausgeschrieben: einer aus dem HOST-Baum
    // (`config/services.php`), einer aus dem PAKET (`packages/…/config/group.php`).
    // Fällt einer der beiden Bäume aus dem Suchpfad, sagt es dieser Fall.
    assert.ok(schluessel.includes('NOSTR_BOT_NSEC'), `Host-Baum nicht gelesen: ${schluessel.join(', ')}`)
    assert.ok(
        schluessel.includes('NOSTR_ARTICLE_METRIC_RELAYS'),
        `Paket-Baum nicht gelesen: ${schluessel.join(', ')}`,
    )
})

test('JEDER gelesene NOSTR_*-Schlüssel wird von testServerEnv neutralisiert', () => {
    const gesetzt = Object.keys(testServerEnv({ slot: 0 }))
    for (const schluessel of gelesenSchluessel()) {
        assert.ok(
            gesetzt.includes(schluessel),
            `${schluessel} wird von der Anwendung gelesen, aber von testServerEnv nicht gesetzt — ` +
                `der Testlauf erbt dafür den Wert der lokalen .env. Genau so sind NOSTR_BOARD_URL (P0) ` +
                `und NOSTR_WORKSPACE_URL (P5) durchgerutscht.`,
        )
    }
})

test('beide Varianten setzen jeden Schlüssel — auch die, die leer bleiben', () => {
    // `mitBoard` darf keinen Schlüssel WEGLASSEN, nur seinen Wert ändern: ein fehlender
    // Schlüssel fiele auf die `.env` zurück, ein leerer nicht.
    assert.deepEqual(Object.keys(testServerEnv({ slot: 0 })).sort(), Object.keys(testServerEnv({ slot: 0, mitBoard: true })).sort())
})

// ── Die WERTE, ausgeschrieben ────────────────────────────────────────────────────────
//
// Ohne diese Fälle prüfte alles oben nur, DASS ein Schlüssel gesetzt wird — ein
// `NOSTR_BOARD_URL: 'wss://nostr.einundzwanzig.space'` bestünde jede Zusicherung bisher.
test('die neutralen Werte stehen als Literal — nicht gegen sich selbst geprüft', () => {
    const worker = testServerEnv({ slot: 2 })
    assert.equal(worker.NOSTR_SPACE_URL, 'ws://localhost:3337')
    assert.equal(worker.NOSTR_WORKSPACE_URL, 'ws://localhost:3337')
    assert.equal(worker.NOSTR_BOARD_URL, '')
    assert.equal(worker.NOSTR_ARTICLE_METRIC_RELAYS, '')
    assert.equal(worker.NOSTR_PROFILE_INDEXER, '')
    assert.equal(worker.NOSTR_BOT_NSEC, '')
    assert.equal(worker.NOSTR_BOT_RELAY, '')
    // Der Slot geht wirklich in den Port ein (3335 + 2) — sonst redete jeder Worker mit
    // dem Relay von Slot 0 und mäße dessen Zustand mit.
    assert.equal(ZOOID_BASE_PORT + 2, 3337)
})

test('die Board-Variante zeigt auf den WORKER-Relay, nicht nach draußen', () => {
    const board = testServerEnv({ slot: 1, mitBoard: true })
    assert.equal(board.NOSTR_BOARD_URL, 'ws://localhost:3336')
    assert.equal(board.NOSTR_ARTICLE_METRIC_RELAYS, 'ws://localhost:3336')
})

test('kein Wert zeigt je auf eine nicht-lokale Adresse', () => {
    // Die Ausfallrichtung der ganzen Datei in einem Satz. Wer hier eine Adresse einträgt,
    // die nicht auf localhost zeigt, hat die Suite gegen Produktion gedreht.
    for (const variante of [testServerEnv({ slot: 0 }), testServerEnv({ slot: 0, mitBoard: true })]) {
        for (const [name, wert] of Object.entries(variante)) {
            if (!name.startsWith('NOSTR_') || wert === '') {
                continue
            }
            assert.match(wert, /^ws:\/\/localhost:\d+$/, `${name} zeigt auf „${wert}"`)
        }
    }
})

// ── Und die VERDRAHTUNG ──────────────────────────────────────────────────────────────
//
// Auf den AUFRUF gemustert, nicht auf den Namen: eine stehen gebliebene Importzeile
// erfüllt ein Muster auf den blossen Bezeichner auch dann noch, wenn `env:` längst
// wieder ein Literal ist (in genau diese Falle ist die Mutationsprobe am 2026-08-21
// einmal gelaufen).
const lies = (pfad: string): string => {
    const inhalt = readFileSync(join(WURZEL, pfad), 'utf8')
    assert.ok(inhalt.length > 0, `${pfad} ist leer — diese Sonde misst dann nichts`)

    return inhalt
}

test('die Annahme, auf der dieser ganze Riegel steht, gilt noch', () => {
    // Der Grund für `testServerEnv` ist EINE Zeile in der Playwright-Config: sie lädt die
    // lokale `.env` in `process.env`, und jeder gespawnte Prozess erbt sie von dort.
    // Fällt diese Zeile weg, ist die Begründung dieser Datei hinfällig — und niemand
    // merkte es, weil dann einfach alles weiter grün liefe.
    //
    // Auf das SYMBOL geankert, nicht auf eine Zeilennummer: der bisherige Verweis stand
    // auf `playwright.config.ts:3`, richtig war `:4`, und durch einen einzigen neuen
    // Import ist daraus inzwischen `:5` geworden. Genau diese Sorte Beleg verrottet.
    assert.match(lies('playwright.config.ts'), /process\.loadEnvFile\('\.env'\)/)
})

test('der E2E-Einstieg räumt die gebackene Config weg', () => {
    // `composer test` räumt auf, der E2E-Pfad tat es nicht. Mit einer vorhandenen
    // `bootstrap/cache/config.php` wird `env('NOSTR_BOARD_URL')` **nie ausgewertet** —
    // der gebackene Wert gewinnt, und die gesamte Neutralisierung dieser Datei ist
    // wirkungslos. Ohne einen Wächter im Browser, der die Server-Hälfte auffinge.
    //
    // Ausdrücklich verkettet und nicht als `pretest:e2e`: `.npmrc` setzt in diesem Repo
    // `ignore-scripts=true` (nach dem keyv-Angriff vom 2026-08-04), npm ruft `pre*`-Hooks
    // hier also nicht auf. Ein Hook wäre ein Riegel, der nie zuschlägt.
    const skripte = JSON.parse(lies('package.json')).scripts as Record<string, string>
    for (const name of ['test:e2e', 'test:e2e:buzz', 'test:e2e:headed', 'test:e2e:buzz:headed']) {
        assert.match(skripte[name] as string, /^php artisan config:clear && /, `${name} räumt nicht auf`)
    }
})

test('alle vier Prozess-Spawns ziehen ihre ENV aus dem Helfer', () => {
    for (const [pfad, muster] of [
        ['tests/e2e/support/fixtures.ts', /env: \{ \.\.\.process\.env, \.\.\.testServerEnv\(\{ slot \}\) \}/],
        ['tests/e2e/support/board-fixtures.ts', /env: \{ \.\.\.process\.env, \.\.\.testServerEnv\(\{ slot, mitBoard: true \}\) \}/],
        ['tests/e2e/blossom-media-guard.spec.ts', /env: \{ \.\.\.process\.env, \.\.\.testServerEnv\(\{ slot: 0 \}\) \}/],
        ['tests/e2e/composer-attachment-preview.spec.ts', /env: \{ \.\.\.process\.env, \.\.\.testServerEnv\(\{ slot: 0 \}\) \}/],
    ] as const) {
        assert.match(lies(pfad), muster, `${pfad} setzt seine Server-ENV nicht über testServerEnv`)
    }
})

test('kein Spawn setzt NOSTR_-Variablen an testServerEnv vorbei', () => {
    // Der Rückweg: eine handgeschriebene `NOSTR_…:`-Zeile in einer dieser Dateien wäre
    // die vierte Kopie und damit der Anfang derselben Geschichte von vorn.
    for (const pfad of [
        'tests/e2e/support/fixtures.ts',
        'tests/e2e/support/board-fixtures.ts',
        'tests/e2e/blossom-media-guard.spec.ts',
        'tests/e2e/composer-attachment-preview.spec.ts',
    ]) {
        const eigenmaechtig = lies(pfad).match(/^\s+NOSTR_[A-Z0-9_]+:/gm)
        assert.equal(eigenmaechtig, null, `${pfad} setzt NOSTR_-Variablen selbst: ${eigenmaechtig?.join(', ')}`)
    }
})

test('keine Spec spawnt etwas aus scripts/ — die Bedingung der benannten Lücke', () => {
    // `NOSTR_ROOM_NAMESPACE` steht bewusst nicht im Helfer, weil sie nur
    // `scripts/sync-meetup-rooms.sh` liest und kein Test dieses Skript startet. Das ist
    // eine BEDINGUNG, keine Eigenschaft — und eine Bedingung ohne Riegel ist genau die
    // Bauform, gegen die Position 5 der Nacharbeiten gebaut wurde.
    //
    // Fällt dieser Test, ist nicht er das Problem: dann spawnt eine Spec ein Skript, das
    // Server-ENV liest, und `SUCHORTE` (oben) muss `scripts/` mit aufnehmen — sonst hat
    // der Scanner eine Variable, die er strukturell nie sieht.
    const specs = readdirSync(join(WURZEL, 'tests/e2e')).filter((n) => n.endsWith('.spec.ts'))
    assert.ok(specs.length > 0, 'keine Spec gefunden — diese Sonde misst dann nichts')

    const treffer: string[] = []
    for (const name of specs) {
        const inhalt = readFileSync(join(WURZEL, 'tests/e2e', name), 'utf8')
        // Auf den PFAD gemustert, nicht auf ein Wort: `scripts` kommt in Prosa vor,
        // `scripts/…` mit Schrägstrich ist ein Aufruf.
        for (const m of inhalt.matchAll(/(?:^|[^\w/])scripts\/[\w.-]+/g)) {
            treffer.push(`${name}: ${m[0].trim()}`)
        }
    }

    assert.deepEqual(
        treffer,
        [],
        'Eine Spec greift auf scripts/ zu — dann gilt die Annahme hinter der '
            + `NOSTR_ROOM_NAMESPACE-Lücke nicht mehr, und SUCHORTE braucht 'scripts':\n  ${treffer.join('\n  ')}`,
    )
})
