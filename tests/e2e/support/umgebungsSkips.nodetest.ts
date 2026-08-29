/**
 * **Das Inventar der umgebungsbedingten Überspringungen — und der Riegel dagegen, dass
 * eine neue lautlos dazukommt.**
 *
 * Ausführen (läuft in `npm run test:unit` mit):
 *   node --experimental-strip-types --test tests/e2e/support/umgebungsSkips.nodetest.ts
 *
 * ── Warum ein UNIT-Gate für ein E2E-Problem ──────────────────────────────────────
 *
 * Neun E2E-Fälle sind mit keinem `test:e2e`-Aufruf erreichbar (Herleitung und Zahlen in
 * `support/umgebung.ts`), und der Lauf endet mit Exit 0. Ein Gate, das nur „E2E grün"
 * prüft, sieht das nie. Ein Wächter INNERHALB der E2E-Suite hülfe auch nicht: er liefe
 * nur, wenn die Suite läuft, und wäre in genau dem Lauf still, in dem der Stack fehlt.
 *
 * Deshalb hier, im Unit-Lauf: er läuft **in jedem Lauf**, kostet Millisekunden und braucht
 * keinen Stack. Das ist die Antwort auf „ein Gate soll es sehen, nicht nur ein Mensch, der
 * die Zeile liest".
 *
 * ── Was der Riegel zusichert, und was NICHT ─────────────────────────────────────
 *
 * Er behebt die Lücke nicht — er macht sie **deklarationspflichtig**. Jede Stelle, die
 * wegen fehlender Umgebung überspringt, muss über {@link umgebungFehlt} laufen und unten
 * im Inventar stehen. Eine neue, undeklarierte macht diesen Test rot; wer sie einträgt,
 * trifft eine bewusste Entscheidung, statt eine Zeile zu schreiben, die niemand wiedersieht.
 *
 * **Ausdrücklich NICHT Gegenstand** (geprüft und abgegrenzt, damit der Riegel nicht das
 * Falsche einsammelt):
 * - die ~20 `E2E_RELAY`-Weichen — beide Arme werden von je einem Lauf-Modus gefahren, sie
 *   decken sich gegenseitig ab;
 * - die zwei dauerhaft abgeschalteten `banpubkey`-Fälle (`directory.spec.ts`,
 *   `room.spec.ts`, aus `fbaf033`/`663bb59`) — die sind älter als dieser Plan und hängen
 *   an einer Produktentscheidung, nicht an einer Umgebung.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { STRICT_VARIABLE, umgebungFehlt } from './umgebung.ts'

const e2eDir = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Fail-closed: findet der Scanner weniger Specs, misst er nicht mehr, was er soll. */
const MIN_SPECS = 80

/**
 * **Das Inventar.** Je Eintrag: Datei, Zahl der betroffenen Fälle, und woran sie hängen.
 * Die Zahlen sind gemessen (2026-08-29, `--list` gegen beide Lauf-Modi), nicht gezählt aus
 * dem Quelltext — ein `describe`-weiter Skip trifft mehr Fälle, als an seiner Zeile steht.
 */
const INVENTAR: { datei: string; faelle: number; grund: string }[] = [
    {
        datei: 'workspaces.spec.ts',
        faelle: 8,
        grund: 'Buzz-Stack NEBEN dem zooid; `test.skip` im describe-Rumpf (Sammelzeit)',
    },
    {
        datei: 'search-verlauf.spec.ts',
        faelle: 1,
        grund: 'Buzz-Stack NEBEN dem zooid; Laufzeit-Form, meldet sich je Fall',
    },
]

const specDateien = (): string[] => {
    const dateien = readdirSync(e2eDir).filter((n) => n.endsWith('.spec.ts'))
    assert.ok(
        dateien.length >= MIN_SPECS,
        `Nur ${dateien.length} Spec-Dateien unter ${e2eDir} gefunden (erwartet: mindestens ${MIN_SPECS}). ` +
            'Der Scanner misst nicht mehr, was er messen soll — fail-closed statt „nichts gefunden, also alles gut".',
    )

    return dateien
}

describe('Umgebungsbedingte Überspringungen sind deklariert', () => {
    test('KALIBRIERUNG: der Scanner sieht die Suite', () => {
        assert.ok(specDateien().length >= MIN_SPECS)
    })

    test('KERNBEWEIS: jede `buzzUp()`-Weiche läuft über `umgebungFehlt` und steht im Inventar', () => {
        // `buzzUp()` ist die einzige Stack-VERFÜGBARKEITS-Prüfung der Suite (paketweit
        // gesucht). Eine Weiche daran, die NICHT über `umgebungFehlt` läuft, überspringt
        // still und ist mit `E2E_STRICT_UMGEBUNG=1` nicht abfragbar.
        const roh: string[] = []
        const deklariert = new Set(INVENTAR.map((e) => e.datei))
        const gefunden = new Set<string>()

        for (const datei of specDateien()) {
            const text = readFileSync(join(e2eDir, datei), 'utf8')
            for (const zeile of text.split('\n')) {
                if (!zeile.includes('buzzUp()')) {
                    continue
                }
                gefunden.add(datei)
                if (!zeile.includes('umgebungFehlt(')) {
                    roh.push(`${datei}: ${zeile.trim().slice(0, 90)}`)
                }
            }
        }

        assert.deepEqual(
            roh,
            [],
            'Diese Stellen überspringen aus Umgebungsgründen, ohne über `umgebungFehlt` zu laufen — ' +
                `sie sind damit mit ${STRICT_VARIABLE}=1 nicht abfragbar und gehen als grüner Lauf durch:\n` +
                roh.join('\n'),
        )
        assert.deepEqual(
            [...gefunden].sort(),
            [...deklariert].sort(),
            'Das Inventar unten und die Fundstellen im Quelltext gehen auseinander. Eine neue Datei mit ' +
                'Stack-Abhängigkeit gehört eingetragen (mit gemessener Fallzahl), eine entfallene ausgetragen.',
        )
    })

    test('das Inventar nennt neun Fälle — die Zahl, die ein Vollauf still überspringt', () => {
        // Eine Summe und nicht nur eine Liste: wächst die Lücke, ist das eine Entscheidung
        // und keine Zeile. Steht sie eines Tages auf 0, ist der dritte Lauf-Modus gebaut.
        assert.equal(INVENTAR.reduce((n, e) => n + e.faelle, 0), 9)
    })

    test('KALIBRIERUNG: `umgebungFehlt` überspringt normal und WIRFT im STRICT-Modus', () => {
        // Ohne diesen Fall wäre der Riegel oben eine Formalie: er verlangt einen Aufruf,
        // dessen Wirkung nirgends gemessen ist.
        const vorher = process.env[STRICT_VARIABLE]
        try {
            delete process.env[STRICT_VARIABLE]
            assert.equal(umgebungFehlt(true, 'probe'), true, 'ohne STRICT wird übersprungen')
            assert.equal(umgebungFehlt(false, 'probe'), false, 'erfüllte Umgebung überspringt nie')

            process.env[STRICT_VARIABLE] = '1'
            assert.throws(() => umgebungFehlt(true, 'probe'), /E2E-STRICT/)
            // Und die Gegenprobe: STRICT darf einen INTAKTEN Lauf nicht rot machen.
            assert.equal(umgebungFehlt(false, 'probe'), false)
        } finally {
            if (vorher === undefined) {
                delete process.env[STRICT_VARIABLE]
            } else {
                process.env[STRICT_VARIABLE] = vorher
            }
        }
    })
})
