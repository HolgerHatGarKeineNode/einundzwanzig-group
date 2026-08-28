/**
 * Lebenszyklus-Riegel (2026-08-27, `fix/teststack-lebenszyklus`) — Vorfall: 86
 * zooid-Prozesse (4,6 GB RSS, ältester 23 h), 100 buzz-test-Container, 20 Netze, 80
 * Volumes, 215 Marker in `/tmp`. Diese Datei prüft `teardown-stack.sh` und
 * `reap-stale-teststacks.sh` gegen ECHTE Artefakte (echter Prozess, echte
 * Docker-Ressourcen) — kein Mock, weil genau die reale Wirkung (kill, `docker rm`,
 * `docker volume rm`) der Punkt ist, der beim Vorfall gefehlt hat.
 *
 * Ausführen: `node --test --experimental-strip-types tests/e2e/support/teststackLifecycle.nodetest.ts`
 * (läuft auch über `npm run test:unit`, Glob `tests/**\/*.nodetest.ts`).
 *
 * Ports/Projektnamen liegen bewusst weit AUSSERHALB der echten Slot-Portreihen
 * (zooid 3335+n, buzz 3001+n mit `n` im einstelligen/niedrigen Bereich) — 399xx trifft
 * nie einen echten, gerade laufenden Worker-Slot.
 */
import { strict as assert } from 'node:assert'
import { after, test } from 'node:test'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { testServerEnv } from './serverEnv.ts'

const REPO = '/home/user/Code/einundzwanzig-group'
const ZOOID_REPO = '/home/user/Code/zooid'
const TEARDOWN = join(REPO, 'tests/e2e/support/teardown-stack.sh')
const REAP = join(REPO, 'tests/e2e/support/reap-stale-teststacks.sh')

/**
 * Überlagerung wie bei jedem anderen Kindprozess der Suite (siehe
 * `serverEnv.nodetest.ts`, „jede gefundene Kindprozess-Stelle zieht ihre ENV aus dem
 * Helfer"): auch wenn `reap-stale-teststacks.sh` selbst keine `NOSTR_*`-Variable
 * liest, neutralisiert das hier trotzdem jeden ambient in `process.env` stehenden
 * `NOSTR_*`-Wert, BEVOR er an ein Kindskript weitergereicht wird — dieselbe Hygiene,
 * kein Sonderfall. `slot: 0` ist neutral: dieser Reaper-Aufruf gehört zu keinem
 * bestimmten Playwright-Worker.
 */
const reapEnv = (extra: NodeJS.ProcessEnv): NodeJS.ProcessEnv => ({
    ...process.env,
    ...testServerEnv({ slot: 0 }),
    // Der Reaper darf in diesen Tests NUR den eigenen 399xx-Bereich sehen.
    //
    // Ohne diese Zeile globbt er systemweit über `/tmp/e2e-*`, und weil `.alive` nur den
    // START-Zeitpunkt trägt (kein Herzschlag, siehe Kopf von `reap-stale-teststacks.sh`),
    // gilt bei den `E2E_STACK_MAX_AGE_SEC`-Werten 1 und 5 unten JEDER gleichzeitig
    // laufende E2E-Lauf nach Sekunden als verwaist. Am 2026-08-28 real passiert: sechs
    // zooid-Instanzen eines parallelen Vollaufs mitten im Lauf eingerissen, sieben Tests
    // fielen kollateral mit "connection refused" auf allen Ports zugleich.
    //
    // Die Whitelist ist der Riegel dafür, nicht eine grössere Altersgrenze: die hier
    // gefahrenen Sekundenwerte SIND der Prüfgegenstand und dürfen nicht weicher werden.
    E2E_REAP_ONLY_PORTS: '39990-39999',
    ...extra,
})

function sh(cmd: string, args: string[], env: NodeJS.ProcessEnv = process.env) {
    return spawnSync(cmd, args, { encoding: 'utf8', env })
}

function processAlive(pid: number): boolean {
    try {
        process.kill(pid, 0)
        return true
    } catch {
        return false
    }
}

/** Startet einen echten, harmlosen Hintergrundprozess und liefert seine PID. */
function spawnFakeZooid(): number {
    const res = spawnSync('bash', ['-c', 'setsid sleep 300 </dev/null >/dev/null 2>&1 & echo $!'], {
        encoding: 'utf8',
    })
    const pid = Number(res.stdout.trim())
    assert.ok(pid > 0, `konnte keinen Fake-Prozess starten: ${res.stderr}`)
    return pid
}

function writeZooidArtifacts(port: number, pid: number, opts: { aliveAgeSec?: number } = {}) {
    writeFileSync(`/tmp/e2e-zooid-${port}.pid`, String(pid))
    writeFileSync(`/tmp/e2e-zooid-${port}.run`, '')
    writeFileSync(`/tmp/e2e-zooid-${port}.alive`, '')
    writeFileSync(`/tmp/e2e-zooid-${port}.log`, 'fake log')
    if (opts.aliveAgeSec !== undefined) {
        const t = Date.now() / 1000 - opts.aliveAgeSec
        utimesSync(`/tmp/e2e-zooid-${port}.alive`, t, t)
    }
    mkdirSync(join(ZOOID_REPO, `data-test-${port}`), { recursive: true })
    writeFileSync(join(ZOOID_REPO, `data-test-${port}`, 'db'), 'fake-db')
    mkdirSync(join(ZOOID_REPO, `config-test-${port}`), { recursive: true })
    writeFileSync(join(ZOOID_REPO, `config-test-${port}`, 'test.toml'), 'fake-config')
}

function zooidArtifactsExist(port: number): boolean {
    return (
        existsSync(`/tmp/e2e-zooid-${port}.pid`) ||
        existsSync(`/tmp/e2e-zooid-${port}.run`) ||
        existsSync(`/tmp/e2e-zooid-${port}.alive`) ||
        existsSync(`/tmp/e2e-zooid-${port}.log`) ||
        existsSync(join(ZOOID_REPO, `data-test-${port}`)) ||
        existsSync(join(ZOOID_REPO, `config-test-${port}`))
    )
}

function cleanupZooidPort(port: number) {
    for (const f of ['pid', 'run', 'alive', 'log']) {
        rmSync(`/tmp/e2e-zooid-${port}.${f}`, { force: true })
    }
    rmSync(join(ZOOID_REPO, `data-test-${port}`), { recursive: true, force: true })
    rmSync(join(ZOOID_REPO, `config-test-${port}`), { recursive: true, force: true })
}

function dockerLabelIds(kind: 'ps -aq' | 'volume ls -q' | 'network ls -q', project: string): string[] {
    const args = kind.split(' ').concat(['--filter', `label=com.docker.compose.project=${project}`])
    const res = sh('docker', args)
    return res.stdout.split('\n').map((s) => s.trim()).filter(Boolean)
}

function buzzResourcesExist(project: string): boolean {
    return (
        dockerLabelIds('ps -aq', project).length > 0 ||
        dockerLabelIds('volume ls -q', project).length > 0 ||
        dockerLabelIds('network ls -q', project).length > 0
    )
}

function createFakeBuzzStack(port: number) {
    const project = `buzz-test-${port}`
    const net = `zz-lifecycle-net-${port}`
    const vol = `zz-lifecycle-vol-${port}`
    const container = `zz-lifecycle-c-${port}`
    let r = sh('docker', ['network', 'create', '--label', `com.docker.compose.project=${project}`, net])
    assert.equal(r.status, 0, `docker network create fehlgeschlagen: ${r.stderr}`)
    r = sh('docker', ['volume', 'create', '--label', `com.docker.compose.project=${project}`, vol])
    assert.equal(r.status, 0, `docker volume create fehlgeschlagen: ${r.stderr}`)
    r = sh('docker', [
        'run',
        '-d',
        '--label',
        `com.docker.compose.project=${project}`,
        '--network',
        net,
        '-v',
        `${vol}:/data`,
        '--name',
        container,
        'alpine:latest',
        'sleep',
        '300',
    ])
    assert.equal(r.status, 0, `docker run fehlgeschlagen: ${r.stderr}`)
}

function forceCleanupBuzzProject(project: string) {
    const ids = dockerLabelIds('ps -aq', project)
    if (ids.length) {
        sh('docker', ['rm', '-f', ...ids])
    }
    const vols = dockerLabelIds('volume ls -q', project)
    if (vols.length) {
        sh('docker', ['volume', 'rm', '-f', ...vols])
    }
    const nets = dockerLabelIds('network ls -q', project)
    if (nets.length) {
        sh('docker', ['network', 'rm', ...nets])
    }
}

// ── teardown-stack.sh: zooid ────────────────────────────────────────────────────────

test('teardown-stack.sh zooid: echter Prozess stirbt, Marker und Datenverzeichnisse verschwinden', () => {
    const port = 39999
    cleanupZooidPort(port)
    const pid = spawnFakeZooid()
    writeZooidArtifacts(port, pid)
    assert.ok(processAlive(pid), 'Fake-Prozess sollte vor dem Teardown leben')
    assert.ok(zooidArtifactsExist(port), 'Artefakte sollten vor dem Teardown existieren')

    const res = execFileSync('bash', [TEARDOWN, 'zooid', String(port)], { encoding: 'utf8' })
    void res

    assert.equal(processAlive(pid), false, 'der Fake-Prozess muss nach dem Teardown tot sein')
    assert.equal(zooidArtifactsExist(port), false, 'alle Marker/Datenverzeichnisse müssen weg sein')
})

test('teardown-stack.sh zooid: Aufruf gegen einen NICHT existierenden Slot ist ein No-Op (kein Wurf)', () => {
    const port = 39994
    cleanupZooidPort(port)
    assert.doesNotThrow(() => execFileSync('bash', [TEARDOWN, 'zooid', String(port)], { encoding: 'utf8' }))
})

// ── teardown-stack.sh: buzz ──────────────────────────────────────────────────────────

test('teardown-stack.sh buzz: Container, Netz UND Volume verschwinden (Label-Fallback ohne compose .env)', { timeout: 30_000 }, () => {
    const port = 39998
    const project = `buzz-test-${port}`
    forceCleanupBuzzProject(project)
    createFakeBuzzStack(port)
    assert.ok(buzzResourcesExist(project), 'Docker-Ressourcen sollten vor dem Teardown existieren')

    execFileSync('bash', [TEARDOWN, 'buzz', String(port)], { encoding: 'utf8' })

    assert.equal(buzzResourcesExist(project), false, 'Container/Netz/Volume müssen ALLE drei weg sein')
})

// ── reap-stale-teststacks.sh: altersbasiert, slot-unabhängig ───────────────────────

test('reap-stale-teststacks.sh: ein Stack ohne Herzschlag seit > Grenze wird abgeräumt', () => {
    const port = 39997
    cleanupZooidPort(port)
    const pid = spawnFakeZooid()
    // Herzschlag 1h alt, Grenze 5s → klar über der Grenze.
    writeZooidArtifacts(port, pid, { aliveAgeSec: 3600 })

    execFileSync('bash', [REAP], { encoding: 'utf8', env: reapEnv({ E2E_STACK_MAX_AGE_SEC: '5' }) })

    assert.equal(processAlive(pid), false, 'ein Stack ohne frischen Herzschlag muss abgeräumt werden')
    assert.equal(zooidArtifactsExist(port), false)
})

test('reap-stale-teststacks.sh: ein Stack mit FRISCHEM Herzschlag bleibt unangetastet (das ist die Zusage, die am leichtesten kaputtgeht)', () => {
    const port = 39996
    cleanupZooidPort(port)
    const pid = spawnFakeZooid()
    // Herzschlag GERADE EBEN berührt — auch mit einer winzigen Grenze (1s) darf ein
    // Lauf, der GERADE ERST gestartet ist, nicht als "verwaist" gelten. Grenze hier
    // bewusst groß gewählt (999999s), damit KEIN Timing-Fenster zwischen dem Touch
    // oben und dem Reap-Aufruf hier den Test flaky machen kann.
    writeZooidArtifacts(port, pid, { aliveAgeSec: 0 })

    try {
        execFileSync('bash', [REAP], { encoding: 'utf8', env: reapEnv({ E2E_STACK_MAX_AGE_SEC: '999999' }) })

        assert.ok(processAlive(pid), 'ein aktiv genutzter Stack (frischer Herzschlag) darf NICHT sterben')
        assert.ok(zooidArtifactsExist(port), 'seine Artefakte müssen unverändert bleiben')
    } finally {
        process.kill(pid, 'SIGKILL')
        cleanupZooidPort(port)
    }
})

test('reap-stale-teststacks.sh: zooid-Datenverzeichnis OHNE jeden Marker wird über sein eigenes Alter erkannt (Fund 2026-08-27: 119 solcher Leichen, 514 MB, ältestes ~11 Tage)', () => {
    const port = 39993
    cleanupZooidPort(port)
    // Bewusst OHNE writeZooidArtifacts (das legt auch .pid/.run/.alive an) — nur die
    // Datenverzeichnisse, wie sie beim Fund vorlagen (Marker schon von Hand gelöscht,
    // Verzeichnisse blieben liegen). Kein laufender Prozess dahinter.
    mkdirSync(join(ZOOID_REPO, `data-test-${port}`), { recursive: true })
    writeFileSync(join(ZOOID_REPO, `data-test-${port}`, 'db'), 'fake-db')
    const alt = Date.now() / 1000 - 4 * 3600
    utimesSync(join(ZOOID_REPO, `data-test-${port}`, 'db'), alt, alt)
    assert.ok(zooidArtifactsExist(port))

    execFileSync('bash', [REAP], { encoding: 'utf8', env: reapEnv({ E2E_STACK_MAX_AGE_SEC: '5' }) })

    assert.equal(zooidArtifactsExist(port), false, 'ein markerloses, altes Datenverzeichnis muss trotzdem abgeräumt werden')
})

test('reap-stale-teststacks.sh: zooid-Datenverzeichnis OHNE Marker, aber FRISCH beschrieben, bleibt stehen', () => {
    const port = 39992
    cleanupZooidPort(port)
    mkdirSync(join(ZOOID_REPO, `data-test-${port}`), { recursive: true })
    writeFileSync(join(ZOOID_REPO, `data-test-${port}`, 'db'), 'fake-db') // mtime = jetzt

    try {
        execFileSync('bash', [REAP], { encoding: 'utf8', env: reapEnv({ E2E_STACK_MAX_AGE_SEC: '999999' }) })
        assert.ok(existsSync(join(ZOOID_REPO, `data-test-${port}`)), 'frisch beschriebene Daten dürfen nicht verschwinden')
    } finally {
        cleanupZooidPort(port)
    }
})

test(
    'reap-stale-teststacks.sh: buzz-Stack rein über Docker (keine Marker mehr) wird über das Container-Alter erkannt',
    { timeout: 30_000 },
    () => {
        const port = 39995
        const project = `buzz-test-${port}`
        forceCleanupBuzzProject(project)
        // Keine Marker-Dateien — nur Docker-Ressourcen, wie im Vorfall beschrieben
        // (Marker können früher verschwunden sein als der Stack selbst).
        createFakeBuzzStack(port)
        // Reale 2s warten, damit "seit Erstellung vergangene Zeit" > die 1s-Grenze
        // unten ist — ohne diese Wartezeit wäre der Test von der Docker-Erstellungs-
        // dauer abhängig (flaky). 2s ist klar über jeder gemessenen `docker run -d`-Zeit.
        execFileSync('sleep', ['2'])

        execFileSync('bash', [REAP], { encoding: 'utf8', env: reapEnv({ E2E_STACK_MAX_AGE_SEC: '1' }) })

        assert.equal(buzzResourcesExist(project), false, 'ein marker-loser, aber alter Docker-Stack muss trotzdem weg')
    },
)

after(() => {
    // Aufräumen falls ein Assert vorher fehlgeschlagen ist und Ressourcen liegen blieben.
    for (const port of [39999, 39998, 39997, 39996, 39995, 39994, 39993, 39992]) {
        cleanupZooidPort(port)
        forceCleanupBuzzProject(`buzz-test-${port}`)
    }
})
