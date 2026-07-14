import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'

/**
 * Läuft EINMAL vor allen Workern. Baut die geteilten Artefakte, die sonst mehrere
 * parallel startende Worker gleichzeitig (und damit rennend/korrupt) bauen würden:
 *   - das zooid-Binary (nur falls fehlend),
 *   - die Vite-Assets (die worker-eigenen `php artisan serve` nutzen sie alle).
 * Der zooid-SEED passiert dagegen pro Worker im workerBackend-Fixture (fixtures.ts),
 * weil jeder Worker seine eigene Relay-Instanz auf einem eigenen Port seedet.
 */

const MANIFEST = 'public/build/manifest.json'

/**
 * Vite nur bauen, wenn nötig: fehlt das Manifest ODER ist irgendeine Frontend-Quelle
 * neuer als das Manifest. Bei unveränderten Assets (häufiger Fall bei wiederholten
 * Test-Läufen) spart das den ~mehrsekündigen Rebuild. `E2E_SKIP_BUILD=1` erzwingt Skip.
 */
function needsBuild(): boolean {
    if (process.env.E2E_SKIP_BUILD === '1') {
        return false
    }
    if (!existsSync(MANIFEST)) {
        return true
    }
    // Frontend-Quellen (Haupt + Package) + Build-Konfig gegen die Manifest-mtime prüfen.
    const changed = execFileSync('bash', [
        '-c',
        `find resources packages/*/resources packages/*/js package.json vite.config.* -type f -newer ${MANIFEST} 2>/dev/null | head -1`,
    ])
        .toString()
        .trim()
    return changed.length > 0
}

export default function globalSetup(): void {
    execFileSync(
        'bash',
        ['-c', '[ -f /home/user/Code/zooid/bin/zooid ] || (cd /home/user/Code/zooid && CGO_ENABLED=1 go build -o bin/zooid cmd/relay/main.go)'],
        { stdio: 'inherit' },
    )
    if (needsBuild()) {
        execFileSync('npm', ['run', 'build'], { stdio: 'inherit' })
    } else {
        console.log('[global-setup] Vite-Assets aktuell → Build übersprungen (E2E_SKIP_BUILD/Manifest neuer als Quellen)')
    }
}
