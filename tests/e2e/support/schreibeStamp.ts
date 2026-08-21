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
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { SOURCES_STAMP, sourcesHash } from './sourcesStamp.ts'

const verzeichnis = dirname(SOURCES_STAMP)
if (!existsSync(verzeichnis)) {
    mkdirSync(verzeichnis, { recursive: true })
}
writeFileSync(SOURCES_STAMP, `${sourcesHash()}\n`)
