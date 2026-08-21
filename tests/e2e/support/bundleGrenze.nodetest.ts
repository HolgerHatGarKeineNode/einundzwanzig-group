/**
 * **Der Riegel gegen die teuerste stille Regression dieses Clients: markdown-it im
 * app-Chunk jeder Seite.**
 *
 * Ausführen (läuft in `npm run test:unit` mit):
 *   node --experimental-strip-types --test tests/e2e/support/bundleGrenze.nodetest.ts
 *
 * ── Was hier bewacht wird, und warum eine Zahl im Docblock nicht genügt ───────────
 *
 * `js/longform.ts` hängt an **markdown-it**. Alles, was diesen Renderer als WERT
 * importiert, zieht ihn in seinen Chunk — und wenn dieser Importeur im Boot-Pfad liegt,
 * in den `app`-Entry-Chunk, der auf **jeder** Seite geladen wird.
 *
 * Am 2026-08-21 ist genau das passiert: `js/articleMetrics.ts` holte die Konstante
 * `LONGFORM` aus `longform.ts` und liegt über `core.ts` (11 statische Importeure, kein
 * dynamischer) im Boot-Pfad. Gemessen, mit und ohne diese eine Kante:
 *
 * | app-Chunk | mit Kante | ohne |
 * |---|---|---|
 * | roh | 386 868 B | 270 598 B |
 * | gzip | 139 559 B | **90 069 B** |
 *
 * **Rund 48 kB gzip auf jeder Seite, gekauft für die Zahl 30023.** Behoben durch das
 * importfreie `js/longformKinds.ts`.
 *
 * Der Fehler ist **unsichtbar**: nichts wird rot, keine Zusage bricht, die Seiten werden
 * nur langsamer. Ein Wert im Kommentar hätte ihn nicht gehalten — in diesem Projekt ist
 * schon einmal ein „nagelt die Werte fest"-Test um 2,7 Punkte unterlaufen worden. Dieser
 * Test misst das **gebaute Artefakt**, nicht die Absicht.
 *
 * ── Warum er wirft, wenn kein Build vorliegt ─────────────────────────────────────
 *
 * Ein `skip` wäre fail-open und damit dasselbe Loch eine Ebene höher: der Riegel wäre
 * genau dann still, wenn niemand gebaut hat. Er verlangt deshalb einen Build und sagt,
 * wie man ihn bekommt (Hausregel: Sonden fail-closed). **`npm run build` gehört ohnehin
 * ins echte Repo-Root** — ein Spiegelpfad schreibt `../`-Keys ins Manifest und kippt die
 * halbe Pest-Suite.
 *
 * ── Und warum ein VORHANDENER Build noch nicht genügt ────────────────────────────
 *
 * Der erste Entwurf prüfte nur, ob ein Manifest existiert. Gemessen war er damit bei
 * einem **veralteten** Build still: Regression in der Quelle, Bündel von vorher,
 * **3/3 grün**. `npm run test:unit` baut nicht — das ist also genau die schnelle
 * Schleife, in der die Kante zurückgebaut und „grün" gesehen wird. Deshalb vergleicht er
 * zusätzlich einen **Content-Hash** des Quellstands gegen den Stamp, den `npm run build`
 * schreibt (`schreibeStamp.ts`). Content und nicht mtime: `cp -p` dreht mtimes zurück,
 * und daran ist in diesem Haus schon eine Mutationsmessung vorbeigelaufen.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { SOURCES_STAMP, buildIstAktuell } from './sourcesStamp.ts'

/** Repo-Wurzel, aus der Lage dieser Datei abgeleitet (`tests/e2e/support/` → drei hoch). */
const wurzel = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const buildDir = join(wurzel, 'public', 'build')
const manifestPfad = join(buildDir, 'manifest.json')

type ManifestEintrag = { file: string; isEntry?: boolean; imports?: string[] }

const manifest = (): Record<string, ManifestEintrag> => {
    assert.ok(
        existsSync(manifestPfad),
        `Kein Vite-Manifest unter ${manifestPfad}. Dieser Riegel misst das GEBAUTE Artefakt — bitte zuerst "npm run build" im echten Repo-Root ausführen.`,
    )
    // **Und das Artefakt muss zum QUELLSTAND passen.** Ohne diese Prüfung war der Riegel
    // bei einem ALTEN Build still: Regression in der Quelle, Bündel von vorgestern,
    // 3/3 grün — gemessen. `npm run test:unit` baut nicht, also ist das genau die
    // schnelle Schleife, in der jemand die Kante zurückbaut und „grün" sieht.
    //
    // Fehlende Frischeinformation zählt wie „veraltet": das ist die einzige Richtung,
    // die nicht stillschweigend gegen ein altes Bundle misst. Denselben Content-Hash
    // benutzt `global-setup.ts` für seine eigene Build-Entscheidung — eine Wahrheit,
    // in `sourcesStamp.ts`.
    const frische = buildIstAktuell(wurzel)
    assert.ok(
        frische.aktuell,
        frische.grund === 'kein-stamp'
            ? `Kein Quell-Stamp unter ${SOURCES_STAMP}. Dieser Riegel kann nicht beurteilen, ob das gemessene Bündel aktuell ist — bitte "npm run build" ausführen (das schreibt ihn).`
            : `Das gebaute Bündel ist NICHT der aktuelle Quellstand (${frische.grund}). Gegen ein altes Artefakt gemessen wäre jedes Ergebnis hier wertlos — bitte "npm run build" ausführen.`,
    )

    return JSON.parse(readFileSync(manifestPfad, 'utf8')) as Record<string, ManifestEintrag>
}

/** Der `app`-Entry und alles, was er STATISCH mitzieht — transitiv. */
const bootChunks = (mf: Record<string, ManifestEintrag>): string[] => {
    const start = Object.entries(mf).find(([schluessel, e]) => e.isEntry && schluessel.endsWith('.ts'))
    assert.ok(start, 'Kein JS-Entry im Manifest gefunden — misst dieser Test das richtige Bündel?')
    const gesehen = new Set<string>()
    const offen = [start[0]]
    while (offen.length > 0) {
        const schluessel = offen.pop()!
        if (gesehen.has(schluessel)) {
            continue
        }
        gesehen.add(schluessel)
        // `imports` sind die STATISCHEN Kanten. `dynamicImports` steht bewusst NICHT hier:
        // ein Lazy-Chunk darf markdown-it enthalten — das ist ja der Sinn der Trennung.
        for (const kante of mf[schluessel]?.imports ?? []) {
            offen.push(kante)
        }
    }

    return [...gesehen].map((schluessel) => mf[schluessel]!.file)
}

describe('Bundle-Grenze: der Renderer bleibt aus dem Boot-Pfad', () => {
    test('KALIBRIERUNG: der Test sieht ein echtes Bündel', () => {
        const mf = manifest()
        const chunks = bootChunks(mf)

        assert.ok(chunks.length >= 2, `Nur ${chunks.length} Boot-Chunk(s) — das Manifest wirkt leer oder falsch.`)
        // Und die Gegenprobe zur Suche selbst: irgendwo IM BÜNDEL muss markdown-it liegen,
        // sonst prüft der Fall unten die leere Menge. (Es gehört in den Lazy-Chunk der
        // Artikelfläche — dass es dort ist, ist die halbe Zusage.)
        const alle = Object.values(mf)
            .map((e) => join(buildDir, e.file))
            .filter((pfad) => pfad.endsWith('.js') && existsSync(pfad))
        const mitRenderer = alle.filter((pfad) => readFileSync(pfad, 'utf8').includes('markdown-it'))

        assert.ok(mitRenderer.length > 0, 'markdown-it steckt in KEINEM Chunk — dann misst der Riegel unten nichts.')
    })

    test('KERNBEWEIS: markdown-it liegt in KEINEM Chunk des Boot-Pfads', () => {
        const mf = manifest()
        const treffer = bootChunks(mf)
            .filter((datei) => datei.endsWith('.js'))
            .filter((datei) => {
                const pfad = join(buildDir, datei)

                return existsSync(pfad) && readFileSync(pfad, 'utf8').includes('markdown-it')
            })

        assert.deepEqual(
            treffer,
            [],
            `markdown-it ist im Boot-Pfad gelandet (${treffer.join(', ')}). Das kostet rund 48 kB gzip auf JEDER Seite. ` +
                'Ursache ist fast immer ein WERT-Import aus `js/longform.ts` in einem Modul, das an `core.ts` oder ' +
                '`bridge.ts` hängt — Kind-Zahlen kommen aus dem importfreien `js/longformKinds.ts`, Typen nur als `import type`.',
        )
    })

    test('der app-Chunk bleibt unter der Marke, die vor der Regression galt', () => {
        // Eine OBERgrenze, kein Sollwert: sie bewegt sich bei normalem Wachstum nie und
        // schlägt an, wenn wieder eine große Bibliothek in den Boot-Pfad rutscht — auch
        // bei einer anderen als markdown-it, die der Fall darüber gar nicht kennt.
        // 90 069 B gzip gemessen (2026-08-21); die Marke liegt rund 22 % darüber.
        const mf = manifest()
        const entry = Object.entries(mf).find(([schluessel, e]) => e.isEntry && schluessel.endsWith('.ts'))![1]
        const gzip = gzipSync(readFileSync(join(buildDir, entry.file))).length

        assert.ok(
            gzip < 110_000,
            `Der app-Chunk ist auf ${gzip} B gzip gewachsen (Marke: 110 000). Vor der markdown-it-Regression waren es 90 069 B, mit ihr 139 559 B — sieh nach, was neu im Boot-Pfad hängt.`,
        )
    })
})
