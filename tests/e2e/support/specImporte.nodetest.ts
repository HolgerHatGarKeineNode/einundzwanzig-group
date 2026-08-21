/**
 * **Wer bezieht sein `test` woher — und ist damit überhaupt bewacht?**
 *   node --test --experimental-strip-types tests/e2e/support/specImporte.nodetest.ts
 *
 * Der Relay-Wächter und die Prävention hängen beide an den Fixtures aus
 * `support/fixtures.ts`. Eine Spec, die ihr `test` direkt aus `@playwright/test` bezieht,
 * bekommt **keines von beidem**: kein `relayWaechter`-auto-Fixture, keine
 * WebSocket-Wrapper je Kontext. Sie fährt allein mit den Chromium-Start-Argumenten
 * (`--host-resolver-rules`), und das ist die schwächste der drei Schichten.
 *
 * Bis zum P7-Gate war die Zahl dieser Specs eine **Momentaufnahme aus einem Bericht**:
 * „drei von 68, gemappt am 2026-08-20". Nichts hielt sie fest. Eine vierte wäre still
 * dazugekommen — und jede Aussage über den Umfang des Wächters ab dem Tag unbelegt.
 * Genau dieselbe Bauform wie `BUZZ_SPECS` in `playwright.config.ts`, die aus genau
 * diesem Grund existiert.
 *
 * ── Die Ausnahmeliste ist eine Deklaration, keine Bequemlichkeit ────────────────────
 *
 * Jeder Eintrag steht mit Begründung da. Wer eine Spec hinzufügt, muss diese Datei
 * anfassen — und in dem Moment die Frage beantworten, die er sonst nie gestellt hätte:
 * *warum darf ausgerechnet diese Spec ohne Wächter fahren?*
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SPEC_ORDNER = fileURLToPath(new URL('../', import.meta.url))

/**
 * Die Specs, die ihr `test` NICHT aus `support/fixtures.ts` beziehen dürfen — namentlich,
 * mit Grund.
 *
 * Allen dreien ist dasselbe gemeinsam: sie bauen ihr Markup selbst und laden es als
 * statische Seite. Sie sprechen weder einen Relay noch den worker-eigenen `serve` an und
 * bräuchten dessen Aufbau nur, um ihn nicht zu benutzen.
 *
 * ZWEI davon rendern über `php artisan tinker` — und die sahen bis zum P7-Gate die rohe
 * `.env`; sie neutralisieren ihre Server-ENV jetzt über `testServerEnv`. Die dritte
 * (`blossom-content-hydration`) bündelt mit `rolldown` und fasst gar keine PHP-Config an.
 */
const OHNE_WAECHTER: readonly string[] = [
    // Rendert `group::components.nostr-avatar` + ein Banner-Fragment über tinker.
    'blossom-content-hydration.spec.ts',
    // Rendert dieselben Partials und prüft, dass auth-pflichtige Medien nie als <img>
    // erscheinen; spawnt tinker (ENV seit dem P7-Gate über `testServerEnv` neutralisiert).
    'blossom-media-guard.spec.ts',
    // Rendert `group::partials.chat-composer` über tinker, ebenso neutralisiert.
    'composer-attachment-preview.spec.ts',
]

/** Die Quellen, aus denen eine bewachte Spec ihr `test` beziehen darf. */
const BEWACHTE_QUELLEN: readonly string[] = ['./support/fixtures', './support/board-fixtures']

/**
 * Die Specs des Laufs — **flach gelesen, und das ist eine Bedingung, kein Zufall.**
 *
 * Playwrights `testDir` globt **rekursiv**; dieser Leser nicht. Heute ist beides
 * deckungsgleich, weil unter `tests/e2e/` kein Unterordner eine `.spec.ts` trägt (nur
 * `support/`, und dort liegen Helfer). Legt jemand `tests/e2e/foo/bar.spec.ts` an, führt
 * Playwright sie aus und dieser Scanner sähe sie nie — eine Spec ohne Wächter, die als
 * geprüft gilt. Der Test darunter hält genau diese Bedingung fest.
 */
const specDateien = (): string[] =>
    readdirSync(SPEC_ORDNER)
        .filter((name) => name.endsWith('.spec.ts'))
        .sort()

/**
 * Die Importquelle, aus der diese Datei ihr `test` bezieht — oder `null`, wenn sie keins
 * importiert.
 *
 * Das Muster verlangt `test` als eigenständigen Bezeichner in der geschweiften Liste;
 * `import { expect } from …` allein zählt nicht, und `testServerEnv` darf nicht als
 * `test` durchgehen (die Wortgrenzen sind der Grund für `\b` und die Zeichenklasse).
 */
const testQuelle = (inhalt: string): string | null => {
    for (const treffer of inhalt.matchAll(/^import \{([^}]*)\} from '([^']+)'/gm)) {
        const namen = (treffer[1] as string).split(',').map((n) => n.trim().split(/\s+as\s+/)[0])
        if (namen.includes('test')) {
            return treffer[2] as string
        }
    }

    return null
}

test('der Scanner findet die Specs überhaupt — und erkennt eine Quelle', () => {
    const dateien = specDateien()
    // Fail-closed: eine leere Liste wäre ein grüner Test ohne Gegenstand.
    assert.ok(dateien.length >= 60, `nur ${dateien.length} Spec-Dateien gefunden`)
    const ohneQuelle = dateien.filter((datei) => testQuelle(readFileSync(join(SPEC_ORDNER, datei), 'utf8')) === null)
    assert.deepEqual(ohneQuelle, [], 'diese Specs importieren gar kein `test` — der Scanner versteht sie nicht')
})

test('jede Spec bezieht ihr `test` aus den Fixtures — außer den namentlich erklärten', () => {
    const abweichler: string[] = []
    for (const datei of specDateien()) {
        const quelle = testQuelle(readFileSync(join(SPEC_ORDNER, datei), 'utf8')) as string
        if (BEWACHTE_QUELLEN.includes(quelle)) {
            continue
        }
        abweichler.push(`${datei} (aus '${quelle}')`)
    }

    assert.deepEqual(
        abweichler.map((eintrag) => eintrag.split(' ')[0]),
        [...OHNE_WAECHTER],
        `Diese Specs fahren OHNE Relay-Wächter und ohne den WebSocket-Wrapper:\n  ${abweichler.join('\n  ')}\n` +
            `Entweder sie beziehen ihr \`test\` aus './support/fixtures', oder sie gehören mit Begründung ` +
            `in OHNE_WAECHTER (support/specImporte.nodetest.ts).`,
    )
})

test('die Ausnahmen existieren wirklich — eine tote Zeile deckt nichts mehr', () => {
    // Eine Ausnahmeliste, deren Einträge längst umbenannt sind, wächst still: der nächste
    // Abweichler fiele auf und würde einfach hinzugefügt, weil „die Liste ja gepflegt ist".
    const vorhanden = specDateien()
    for (const ausnahme of OHNE_WAECHTER) {
        assert.ok(vorhanden.includes(ausnahme), `${ausnahme} steht in OHNE_WAECHTER, existiert aber nicht mehr`)
    }
})

test('die Ausnahmen neutralisieren wenigstens ihre Server-ENV', () => {
    // Die Bedingung, unter der eine Ausnahme vertretbar ist — und sie hängt am
    // GEGENSTAND, nicht an der Aufrufform: gefährlich ist ein **PHP**-Prozess, denn nur
    // der liest die `.env` und baut daraus Relay-Verbindungen auf.
    // `blossom-content-hydration.spec.ts` ruft ebenfalls `execFileSync`, aber `rolldown`
    // zum Bündeln — ein Bundler kennt keine Relays. Eine Regel über „irgendein Spawn"
    // hätte hier eine Neutralisierung verlangt, die nichts neutralisiert, und wäre nach
    // dem zweiten Mal mit einem `// eslint-disable`-Reflex erledigt worden.
    for (const ausnahme of OHNE_WAECHTER) {
        const inhalt = readFileSync(join(SPEC_ORDNER, ausnahme), 'utf8')
        if (!/(?:execFileSync|spawn|spawnSync)\(\s*'php'/.test(inhalt)) {
            continue
        }
        assert.match(
            inhalt,
            /\.\.\.testServerEnv\(/,
            `${ausnahme} startet einen Prozess ohne neutralisierte Server-ENV — er sieht die rohe .env`,
        )
    }
})

test('keine Spec liegt in einem Unterordner — sonst ist dieser Scanner blind', () => {
    // `specDateien()` liest flach, Playwrights `testDir` globt rekursiv. Solange beides
    // dieselbe Menge liefert, ist der flache Leser richtig; ab der ersten Spec in einem
    // Unterordner ist er eine Sonde, die weniger sieht als ihre Beschriftung sagt.
    //
    // Fällt dieser Test, ist der Fix nicht seine Anpassung, sondern ein rekursiver
    // `specDateien()` — die Spec im Unterordner läuft nämlich wirklich.
    const unterordner = readdirSync(SPEC_ORDNER, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
    assert.ok(unterordner.length > 0, 'kein Unterordner unter tests/e2e — diese Sonde misst dann nichts')

    const versteckt: string[] = []
    const suche = (rel: string): void => {
        for (const e of readdirSync(join(SPEC_ORDNER, rel), { withFileTypes: true })) {
            if (e.isDirectory()) {
                suche(join(rel, e.name))
            } else if (e.name.endsWith('.spec.ts')) {
                versteckt.push(join(rel, e.name))
            }
        }
    }
    for (const ordner of unterordner) {
        suche(ordner)
    }

    assert.deepEqual(
        versteckt,
        [],
        'Spec(s) in einem Unterordner — Playwright fährt sie, dieser Scanner sieht sie nicht:\n  '
            + `${versteckt.join('\n  ')}\n  Fix: specDateien() rekursiv lesen.`,
    )
})
