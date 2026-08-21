import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import type { FullConfig } from '@playwright/test'
import { ownedRunMarkerPaths } from './runMarkers'
import { SOURCES_HASH_CMD, SOURCES_STAMP, sourcesHash } from './sourcesStamp'

/**
 * Läuft EINMAL vor allen Workern. Baut die geteilten Artefakte, die sonst mehrere
 * parallel startende Worker gleichzeitig (und damit rennend/korrupt) bauen würden:
 *   - das zooid-Binary (nur falls fehlend),
 *   - die Vite-Assets (die worker-eigenen `php artisan serve` nutzen sie alle).
 * Der zooid-SEED passiert dagegen pro Worker im workerBackend-Fixture (fixtures.ts),
 * weil jeder Worker seine eigene Relay-Instanz auf einem eigenen Port seedet.
 */

const MANIFEST = 'public/build/manifest.json'
// `SOURCES_STAMP`, `SOURCES_HASH_CMD` und `sourcesHash()` wohnen seit dem Bundle-Riegel
// in `./sourcesStamp` — dieselbe Frage („ist der Build aktuell?") darf nicht zwei
// Antworten haben. Die Begründung für Content statt mtime steht dort.


/**
 * Vite nur bauen, wenn nötig — INHALTSbasiert, nicht mtime-basiert. Bei unveränderten
 * Assets (häufiger Fall bei wiederholten Test-Läufen) spart das den ~mehrsekündigen
 * Rebuild. `E2E_SKIP_BUILD=1` erzwingt Skip.
 *
 * WARUM CONTENT STATT MTIME (P12, 2026-08-15): `mutprobe restore` spielt eine mutierte
 * Frontend-Quelle mit `cp -p` zurück — byte-gleich, aber mit der ALTEN mtime. Das alte
 * Kriterium („Quelle neuer als Manifest?") sah danach keinen Buildbedarf und der nächste
 * Lauf maß weiter gegen das WÄHREND DER MUTATION gebaute Bundle: git sauber, md5 gleich,
 * jede äußere Verifikation grün (gemessen: p12-03/p12-05 — Restore 21:57, Manifest 22:57,
 * Build geskippt, Test blieb rot wie unter der Mutation). Ein Content-Hash des
 * Quellstands im Vergleich zum Stamp des letzten Builds kann diese Falle nicht
 * übersehen: egal welche mtime die Quelle trägt, anderer Inhalt ⇒ anderer Hash ⇒ Rebuild.
 */
function needsBuild(): { build: boolean; reason: string } {
    if (process.env.E2E_SKIP_BUILD === '1') {
        return { build: false, reason: 'E2E_SKIP_BUILD=1' }
    }
    if (!existsSync(MANIFEST)) {
        return { build: true, reason: 'Manifest fehlt' }
    }
    if (!existsSync(SOURCES_STAMP)) {
        // Einmaliger Übergang nach Einführung des Stamps (oder frisch geleertes
        // public/build mit überlebendem Manifest-Neuaufbau): sicherheitshalber bauen.
        return { build: true, reason: 'Quell-Stamp fehlt (Content-Kriterium neu)' }
    }
    const stamped = readFileSync(SOURCES_STAMP, 'utf8').trim()
    if (stamped !== sourcesHash()) {
        return { build: true, reason: 'Quell-Hash ≠ Stamp (Inhalt geändert — mtime egal)' }
    }
    return { build: false, reason: 'Quell-Hash == Stamp' }
}

/** `E2E_RELAY=buzz|zooid` (Default zooid) — siehe playwright.config.ts + fixtures.ts. */
const relayMode = (): 'zooid' | 'buzz' => (process.env.E2E_RELAY === 'buzz' ? 'buzz' : 'zooid')

export default function globalSetup(config: FullConfig): void {
    // Lauf-Marker loeschen. Sie schuetzen INNERHALB eines Laufs davor, dass ein neu
    // gestarteter Worker den Relay neu aufsetzt und damit den gerade laufenden Test
    // mitreisst (Begruendung in zooid-testserver.sh/buzz-testserver.sh, RUNMARK).
    // Zu Lauf-Beginn muessen sie weg, sonst wuerde der Bloat-Guard nie wieder greifen
    // und die Raeume wuechsen ueber Laeufe hinweg unbegrenzt.
    //
    // NUR DIE EIGENE PORTREIHE (N9, 2026-08-18). Hier stand `rm -f /tmp/e2e-buzz-*.run`
    // — ein Glob ueber ALLE Slots. Laufen mehrere Suiten gleichzeitig auf verschiedenen
    // `E2E_SLOT_OFFSET` (der Normalfall, seit mehrere Agenten parallel arbeiten), nimmt
    // ein startender Lauf den anderen genau den Schutz weg, fuer den der Marker da ist.
    // Gemessen am 2026-08-18: das Glob traf mit den eigenen vier Markern zugleich die
    // beiden eines fremden, laufenden Stacks.
    //
    // Kein Shell-Glob mehr, sondern eine aufgezaehlte Liste aus `config.workers` +
    // `E2E_SLOT_OFFSET` (Herleitung und Test in `runMarkers.ts`): ein Glob kann sich
    // still wieder aufweiten, eine Liste nicht.
    const markers = ownedRunMarkerPaths({
        workers: config.workers,
        slotOffset: Number(process.env.E2E_SLOT_OFFSET ?? '0'),
    })
    for (const marker of markers) {
        rmSync(marker, { force: true })
    }
    console.log(`[global-setup] Lauf-Marker der eigenen Slots entfernt: ${markers.join(' ')}`)

    if (relayMode() === 'buzz') {
        // Nichts zu tun: der Buzz-Stack entsteht seit der Parallelisierung PRO WORKER
        // im `workerBackend`-Fixture (eigener Port, eigenes Compose-Projekt) — genau wie
        // zooid. Hier einen gemeinsamen Stack hochzuziehen war der Grund für `workers: 1`.
    } else {
        // IMMER bauen (nicht nur bei fehlendem Binary) — dieselbe Begründung wie in
        // zooid-testserver.sh: ein liegendes Binary verrät nichts über seinen Quellstand,
        // ein veralteter Guard bestätigt Events (`OK true`), ohne sie umzusetzen. Kosten
        // mit warmem Go-Build-Cache gemessen: ~170ms, vernachlässigbar hier (läuft einmal
        // vor allen Workern).
        execFileSync(
            'bash',
            ['-c', '(cd /home/user/Code/zooid && CGO_ENABLED=1 go build -o bin/zooid cmd/relay/main.go)'],
            { stdio: 'inherit' },
        )
    }
    const decision = needsBuild()
    if (decision.build) {
        console.log(`[global-setup] Vite-Build läuft (${decision.reason})`)
        // Hash VOR dem Build ziehen und erst NACH erfolgreichem Build als Stamp schreiben:
        // ändert sich eine Quelle während des Builds, passt der Stamp nicht mehr zum
        // gebauten Stand und der nächste Lauf baut erneut — falsch grün ist teurer als
        // ein doppelter Build. Schlägt der Build fehl, wirft execFileSync und es bleibt
        // kein trügerischer Stamp stehen.
        const preBuildHash = sourcesHash()
        execFileSync('npm', ['run', 'build'], { stdio: 'inherit' })
        writeFileSync(SOURCES_STAMP, `${preBuildHash}\n`)
    } else {
        console.log(`[global-setup] Vite-Assets aktuell → Build übersprungen (${decision.reason})`)
    }
}
