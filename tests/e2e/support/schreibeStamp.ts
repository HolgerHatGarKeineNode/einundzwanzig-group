/**
 * Schreibt den Quell-Stamp neben das gebaute Bündel — **verkettet in `npm run build`**,
 * also nach jedem Build.
 *
 * **Nicht als `postbuild`-Hook**, und der Grund ist dieses Repo, nicht npm: `.npmrc` setzt
 * **`ignore-scripts=true`** — gesetzt am 2026-08-04 als Antwort auf den keyv/cacheable-Angriff,
 * zusammen mit `min-release-age=7`. `npm config get ignore-scripts` → `true`. Damit läuft
 * `npm run build` (ausdrücklich angefordert), die Hooks drumherum aber nicht. Der Hook lief
 * still nicht, der Stamp entstand nicht, und der Riegel hätte weiter gegen ein Artefakt ohne
 * Frischeinformation gemessen — genau das Loch, das er schließen soll.
 *
 * **Hier stand zuerst „npm 12.0.2 ruft pre/post-Hooks nicht mehr auf, und das ist gemessen".
 * Das war falsch** — in einem Wegwerf-Paket außerhalb dieses Repos nachgestellt, laufen
 * `prebuild`, `build` und `postbuild` unter derselben npm-Version alle drei. Die falsche
 * Begründung war dabei gefährlicher als keine: als npm-Regression gelesen, lädt sie den
 * nächsten Leser ein, das Problem durch **Entfernen der Sperre** zu „reparieren".
 *
 * Die explizite Verkettung bleibt trotzdem die richtige Form — in einem Repo mit
 * `ignore-scripts=true` ist sie die einzig tragfähige, und sie ist an einer Stelle lesbar.
 *
 * ── Warum das ein BUILD-Artefakt sein muss und keins des E2E-Setups ──────────────
 *
 * Bis hierher schrieb den Stamp ausschließlich `global-setup.ts`, also der
 * Playwright-Vorlauf. Für dessen eigene Frage („muss ich bauen?") reichte das. Der
 * Bundle-Riegel (`bundleGrenze.nodetest.ts`) stellt aber die umgekehrte Frage — „ist das
 * Artefakt, das ich gerade messe, überhaupt der aktuelle Quellstand?" — und die kann er
 * nach einem gewöhnlichen `npm run build` nicht beantworten, wenn der Stamp dabei gar
 * nicht entsteht: er läge dann veraltet vom letzten E2E-Lauf daneben oder fehlte ganz.
 *
 * Ein Riegel, der gegen ein altes Bundle misst und dabei schweigt, ist derselbe Fehler
 * wie ein `skip` statt eines Wurfs — nur eine Ebene weiter. Deshalb entsteht der Stamp
 * jetzt dort, wo das Artefakt entsteht.
 *
 * **Inhalt statt mtime**, aus dem Grund, der in `sourcesStamp.ts` steht: `cp -p` dreht
 * mtimes zurück, und genau daran ist in diesem Haus schon eine Mutationsmessung
 * vorbeigelaufen.
 *
 * ── Warum dieses Modul den Build SELBST startet ──────────────────────────────────
 *
 * Weil sonst der Abtastzeitpunkt falsch liegt. Vorher war `build` die Kette
 * `vite build && node … schreibeStamp.ts`; der Hash entstand also **nach** dem Build.
 * `global-setup.ts` macht es genau umgekehrt und begründet das ausdrücklich: ändert sich
 * eine Quelle WÄHREND des Builds, passt ein danach gezogener Stamp nicht mehr zum
 * gebauten Stand — er behauptete Frische, die das Artefakt nicht hat, und der nächste
 * Lauf überspränge den Rebuild. Ein doppelter Build ist billig, ein falsch grüner
 * Bundle-Riegel nicht.
 *
 * Zwei Abtastzeitpunkte für einen Stamp, der „eine Wahrheit für alle" zusagt, sind
 * ohnehin einer zu viel. Angeglichen wurde auf die **sichere** Richtung: erst hashen,
 * dann bauen, und nur bei erfolgreichem Build schreiben. Schlägt `vite build` fehl,
 * wirft `execFileSync` und es bleibt kein trügerischer Stamp stehen — dieselbe
 * Ausfallrichtung wie in `global-setup.ts`.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SOURCES_STAMP, sourcesHash } from './sourcesStamp.ts'

const wurzel = fileURLToPath(new URL('../../../', import.meta.url))

// ZUERST der Hash — vor dem Build, aus dem Grund im Modulkopf.
const vorBuild = sourcesHash()

// `node_modules/.bin/vite` direkt statt über npm: der Umweg über einen zweiten
// npm-Prozess bringt hier nichts und würde in einem Repo mit `ignore-scripts=true` nur
// die Frage aufwerfen, welche Hooks dabei laufen.
execFileSync(join(wurzel, 'node_modules/.bin/vite'), ['build'], { cwd: wurzel, stdio: 'inherit' })

const verzeichnis = dirname(SOURCES_STAMP)
if (!existsSync(verzeichnis)) {
    mkdirSync(verzeichnis, { recursive: true })
}
writeFileSync(SOURCES_STAMP, `${vorBuild}\n`)
