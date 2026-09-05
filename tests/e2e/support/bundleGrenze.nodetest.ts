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

/** Every built JS chunk whose text contains `needle` — the calibration for the searches below. */
const chunksContaining = (mf: Record<string, ManifestEintrag>, needle: string): string[] =>
    Object.values(mf)
        .map((eintrag) => eintrag.file)
        .filter((datei) => datei.endsWith('.js') && existsSync(join(buildDir, datei)))
        .filter((datei) => readFileSync(join(buildDir, datei), 'utf8').includes(needle))

/** The same search, narrowed to the chunks the boot path pulls in STATICALLY. */
const bootChunksContaining = (mf: Record<string, ManifestEintrag>, needle: string): string[] => {
    const boot = new Set(bootChunks(mf))

    return chunksContaining(mf, needle).filter((datei) => boot.has(datei))
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

    /**
     * **Die Zahl der Boot-Chunks ist eine Zusage, keine Beobachtung.**
     *
     * Jeder Chunk im Boot-Pfad ist eine eigene HTTP-Anfrage auf **jeder** Seite, in
     * beiden Hosts (Web-Portal und WebView der Companion-App). P1 des welshman-Sprungs
     * hat sie von 6 auf 5 gebracht, indem die Adapter `js/welshman*.ts` per
     * `manualChunks`-Regel (`vite.config.js`, Host-Repo) in den Vendor-Chunk gelegt
     * wurden — sie werden vom Boot- UND vom Lazy-Graph geteilt und bilden sonst einen
     * eigenen sechsten Chunk.
     *
     * **Warum eine EXAKTE Zahl und nicht „möglichst wenige":** eine Obergrenze („höchstens
     * 5") liesse den Rückfall auf 6 rot werden, aber nicht auffallen, wenn Rolldown die
     * Aufteilung ganz anders schneidet und dabei zufällig unter der Marke bleibt. Die
     * Zahl ist das Ergebnis einer bewussten Entscheidung; wer sie ändert, soll sie
     * ändern müssen. Ohne diese Zusage fällt der P1-Gewinn beim nächsten
     * Rolldown-Update lautlos zurück — es wird nichts rot, die Seiten laden nur eine
     * Anfrage mehr.
     *
     * **Mit dem welshman-0.9.5-Sprung ist sie von 5 auf 6 gegangen** — gemessen, und die
     * Zahl steht hier, weil die Entscheidung dahinter nicht selbstverständlich ist.
     *
     * Der Plan sah vor, die `manualChunks`-Regel für `js/welshman*.ts` bei dieser
     * Gelegenheit zu ENTFERNEN, mit der Erwartung „dann 6". Die Prämisse dafür war, dass
     * die Adapter beim Sprung „größtenteils gelöscht" werden. **Das ist nicht
     * eingetreten:** sie sind von 5 auf 9 Dateien gewachsen und tragen jetzt eigene Logik
     * (App-Instanz und Identitätswechsel, Netz-Kontext, Relay-Auswahl, Zap-API,
     * Listen/Räume). Drei Varianten gegen das gebaute Artefakt gemessen:
     *
     * | Variante | Boot-Chunks | Vendor-Chunk gzip |
     * |---|---|---|
     * | Regel behalten (Adapter im Vendor-Chunk) | **6** | 349,11 kB, ganz |
     * | Adapter in einen EIGENEN Chunk | 7 | 36,48 kB — zerrissen |
     * | Regel entfernt | 8 | 345,12 kB |
     *
     * Ohne Regel schneidet Rolldown die Adapter in drei Boot-Chunks (`welshmanApp`,
     * `nip98`, `publishResult`); ein eigener Chunk für sie zieht das halbe SDK mit hinaus
     * und entwertet den Vendor-Chunk. **Die Regel bleibt deshalb.** Ihr Preis ist
     * unverändert benannt: ein Adapter-Deploy invalidiert den Vendor-Chunk. Er ist jetzt
     * der kleinere — die Adapter ändern sich nach dem Sprung selten, drei zusätzliche
     * Anfragen fallen auf JEDER Seite in BEIDEN Hosts an.
     *
     * Die 6. Anfrage ist der Sprung selbst: `publishResult` und `nip98` hängen beide
     * direkt am Entry, wo vorher einer von beiden im App-Chunk aufging.
     *
     * Der Riegel ist fail-closed: `manifest()` wirft ohne Build und ohne frischen Stamp.
     */
    test('BOOT-CHUNKS: es bleiben genau 6', () => {
        const BOOT_CHUNKS = 6
        const mf = manifest()
        const chunks = bootChunks(mf)

        assert.equal(
            chunks.length,
            BOOT_CHUNKS,
            `Der Boot-Pfad besteht aus ${chunks.length} Chunks statt ${BOOT_CHUNKS} (${chunks.join(', ')}). ` +
                'Jeder davon ist eine HTTP-Anfrage auf jeder Seite in beiden Hosts. Mehr geworden? Sieh in ' +
                '`vite.config.js` nach der `manualChunks`-Regel — sie legt `node_modules/@welshman/**`, ' +
                '`node_modules/nostr-tools/**` und `js/welshman*.ts` in EINEN Vendor-Chunk. Weniger geworden? ' +
                'Dann prüfe, ob dabei etwas in den app-Chunk gerutscht ist, das dort nicht hingehört.',
        )

        // Und die Gegenprobe zur Zahl: sie soll nicht durch eine ganz andere Aufteilung
        // zufällig erreicht werden. Der Vendor-Chunk ist der Zweck der Regel, also muss
        // er im Boot-Pfad liegen — genau einmal.
        //
        // Das Muster verlangt den Bindestrich direkt hinter `welshman`: so heisst NUR der
        // Vendor-Chunk. Ohne ihn zählte ein herausgefallener Adapter (`welshmanKinds-…js`,
        // genau der sechste Chunk aus der Kalibrierung) mit und die Gegenprobe bliebe grün.
        const vendor = chunks.filter((datei) => /welshman-[^/]*\.js$/.test(datei))
        assert.equal(vendor.length, 1, `Erwartet genau EINEN welshman-Vendor-Chunk im Boot-Pfad, gefunden: ${vendor.join(', ') || 'keinen'}`)
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

    /**
     * **The second heavy library that must not ride along on every page: the QR renderer.**
     *
     * Measured 2026-09-04 by source-map attribution against the built `app` chunk: `qrcode`
     * accounted for 22 182 B raw in it — on EVERY page, for four surfaces a minority of
     * sessions ever opens (wallet receive sheet, the two zap QR fallbacks, desktop NIP-46
     * login). Moving it behind `import()` in `bridge.ts` (`qrDataUrl`) took the `app` chunk
     * from 112 635 to 103 520 B gzip, i.e. **9 115 B gzip off every page**, with the boot
     * chunk count unchanged at 6.
     *
     * **Why a case of its own and not one more needle in the one above.** The two come back
     * by different routes and need different advice: markdown-it returns through a VALUE
     * import out of `longform.ts` in some module far away, the QR renderer returns the moment
     * someone turns `qrDataUrl` back into a top-level `import QRCode from 'qrcode'` — a
     * one-line change that reads like a cleanup and is invisible in review.
     *
     * **The needle is a string literal of the library, not its package name.** Its browser
     * entry is bundled as `browser-*.js` and the built chunk contains the word `qrcode`
     * nowhere at all — a grep for the package name would be green by construction, which is
     * fail-open and exactly the hole this file exists to avoid. `Invalid QR Code version` is
     * thrown by `qrcode/lib/core/version.js` and survives minification; the calibration below
     * fails the case if it ever stops appearing anywhere in the bundle.
     */
    test('KERNBEWEIS: auch der QR-Renderer liegt in KEINEM Chunk des Boot-Pfads', () => {
        const mf = manifest()
        const needle = 'Invalid QR Code version'
        // Calibration in the same case, not in a neighbouring one: without the needle
        // somewhere in the bundle the search below inspects the empty set and is green for
        // the wrong reason.
        assert.ok(
            chunksContaining(mf, needle).length > 0,
            `Der Suchtext "${needle}" steckt in KEINEM Chunk — dann misst dieser Fall nichts. Entweder ist qrcode ganz aus dem Bündel verschwunden (dann gehört dieser Riegel weg), oder die Bibliothek hat ihren Fehlertext geändert (dann gehört der Suchtext nachgezogen).`,
        )

        assert.deepEqual(
            bootChunksContaining(mf, needle),
            [],
            `qrcode ist im Boot-Pfad gelandet (${bootChunksContaining(mf, needle).join(', ')}). Das kostet rund 9 kB gzip auf JEDER Seite. ` +
                'Ursache ist fast immer ein Toplevel-`import QRCode from \'qrcode\'`; der Renderer gehört hinter das `import()` in `qrDataUrl` (`js/bridge.ts`).',
        )
    })

    /**
     * **The mark: an UPPER bound, not a target.**
     *
     * It fires when a large library slides back into the boot path — including one other
     * than markdown-it, which the case above does not know at all. 90 069 B gzip measured
     * (2026-08-21); the first mark sat at 110 000, roughly 22 % above it.
     *
     * ── MOVED ONCE, on 2026-09-05, and here is why ──────────────────────────────────
     *
     * Until then the mark was 110 000 and had never been touched. The sentence that stood
     * here — *"it never moves under normal growth"* — was **falsified** that day: P6 of the
     * plan `2026-09-05T0125-community-features-herbst` (hiding a person, NIP-51 kind
     * 10000) broke it with about 1 kB of OWN code and no new library at all. Three builds,
     * measured rather than estimated:
     *
     * | state | app chunk gzip |
     * |---|---|
     * | HEAD before P6 (`3ff09d0` / package `e240271`) | **109 542** — 458 B of headroom |
     * | P6 as the chat filter only, without the Alpine store | 109 791 |
     * | P6 whole | **110 592** — 592 B above the old mark |
     *
     * **What was tried and rejected:** taking the Alpine store (801 of those 1 050 B) out
     * of the boot path behind an `import()`, the way `js/longformFeed.ts` does it. Rejected
     * because `$store.mutes` would then not exist at the first render — the profile card
     * sits on EVERY page — and because a dynamic import fails silently in this house
     * (`js/core.ts` writes out exactly that difference). A protective surface that is
     * sometimes absent and says nothing is worse than 800 B.
     *
     * **Why the rest is indivisible:** filter, store and models hang on the boot path
     * because the chat list needs them for the FIRST paint. It is not an import that can be
     * deferred, it is the surface itself.
     *
     * **The new mark is 112 000**, leaving ~1.4 kB of headroom. It still catches exactly
     * what the latch was built for: markdown-it (139 559) and the QR renderer (+9 115) are
     * both far above it.
     *
     * **The decision belongs to the client, not to the builder.** P6's builder left the
     * number alone and reported the breach; raising it is an explicit instruction of
     * 2026-09-05. Raising it quietly would be the point at which a size promise stops
     * carrying — it is built to hurt at the first push.
     *
     * **And the sentence without which the next raise becomes a habit: if the mark falls a
     * SECOND time under normal growth, the problem is not the number, it is the boot
     * path.** Then it does not get added to, it gets split.
     */
    test('der app-Chunk bleibt unter der Marke, die vor der Regression galt', () => {
        const MARKE = 112_000
        const mf = manifest()
        const entry = Object.entries(mf).find(([schluessel, e]) => e.isEntry && schluessel.endsWith('.ts'))![1]
        const gzip = gzipSync(readFileSync(join(buildDir, entry.file))).length

        assert.ok(
            gzip < MARKE,
            `Der app-Chunk ist auf ${gzip} B gzip gewachsen (Marke: ${MARKE}). Vor der markdown-it-Regression waren es 90 069 B, mit ihr 139 559 B — sieh nach, was neu im Boot-Pfad hängt. Die Marke wurde am 2026-09-05 EINMAL von 110 000 auf ${MARKE} gehoben (Begründung im Docblock); ein zweiter Fall unter normalem Wachstum ist eine Aussage über den Boot-Pfad, nicht über die Zahl.`,
        )
    })
})

/**
 * Die Zusage des Stamps — **eine** Wahrheit für alle, und mit dem sicheren
 * Abtastzeitpunkt.
 *
 * `global-setup.ts` zieht den Quell-Hash bewusst VOR dem Build und schreibt ihn erst
 * danach, mit der ausdrücklichen Begründung: ändert sich eine Quelle während des Builds,
 * passt ein danach gezogener Stamp nicht mehr zum gebauten Stand — er behauptete Frische,
 * die das Artefakt nicht hat. `schreibeStamp.ts` machte es bis zum P7-Gate umgekehrt, in
 * derselben Sekunde, in der sein Modulkopf „eine Wahrheit für alle" zusagte.
 *
 * Dieser Fall hält die Reihenfolge fest. Ohne ihn wäre der Rückfall in die unsichere
 * Richtung eine stille Zeilenvertauschung, die kein Test bemerkt — genau die Klasse
 * Fehler, die dieser Plan dreimal aufgeschrieben hat.
 */
describe('Der Quell-Stamp: erst hashen, dann bauen', () => {
    const quelle = (): string => {
        const inhalt = readFileSync(join(wurzel, 'tests/e2e/support/schreibeStamp.ts'), 'utf8')
        assert.ok(inhalt.length > 0, 'schreibeStamp.ts ist leer — diese Sonde misst dann nichts')

        return inhalt
    }

    test('der Hash entsteht VOR dem Build-Aufruf', () => {
        const inhalt = quelle()
        const gehasht = inhalt.indexOf('sourcesHash()')
        const gebaut = inhalt.indexOf("['build']")
        const geschrieben = inhalt.indexOf('writeFileSync(SOURCES_STAMP')
        assert.ok(gehasht > -1 && gebaut > -1 && geschrieben > -1, 'Schnittmarken veraltet — dieser Fall misst nichts mehr')
        assert.ok(gehasht < gebaut, 'der Quell-Hash wird NACH dem Build gezogen — falsch grün ist teurer als ein doppelter Build')
        assert.ok(gebaut < geschrieben, 'der Stamp wird geschrieben, bevor der Build durch ist')
    })

    test('und `npm run build` geht wirklich über dieses Modul', () => {
        const skripte = JSON.parse(readFileSync(join(wurzel, 'package.json'), 'utf8')).scripts as Record<string, string>
        assert.match(skripte.build as string, /schreibeStamp\.ts/)
        // Auf den AUFRUF gemustert: stünde `vite build &&` weiterhin davor, liefe der
        // Build zweimal und der Hash wieder zur falschen Zeit.
        assert.ok(!(skripte.build as string).includes('vite build'), `build ruft vite weiterhin selbst: ${skripte.build}`)
    })
})
