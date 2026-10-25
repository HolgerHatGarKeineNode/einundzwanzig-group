/**
 * The repair in `nak-resilient.sh`, run for real against a fake `nak`.
 *
 *   node --test --experimental-strip-types tests/e2e/support/nakResilient.nodetest.ts
 *
 * What it must do: ask a `req` again when it came back EMPTY without ever authenticating
 * (the NIP-42 round did not run — measured 2026-10-25, 2 of 120 calls under CPU load), and
 * NOTHING else. The negative cases are the point: an empty answer that DID authenticate is a
 * real answer, a `req` that stays empty is returned as empty after 3 tries and not turned into
 * an error, and every other subcommand is passed through once, untouched, exit code included.
 *
 * The fake `nak` counts its own calls in a file and answers from a script, so "asked again"
 * is a number and not an impression.
 */
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const WRAPPER = new URL('./nak-resilient.sh', import.meta.url).pathname

/**
 * A fake `nak`: call N (1-based) runs `antworten[N-1]` (the last one repeats), each a
 * `{ out, err, rc }`. Returns the wrapper's result and how often the fake was called.
 */
function lauf(args: string[], antworten: { out: string; err: string; rc?: number }[]) {
    const dir = mkdtempSync(join(tmpdir(), 'nak-fake-'))
    const zaehler = join(dir, 'calls')
    writeFileSync(zaehler, '0')
    writeFileSync(join(dir, 'antworten.json'), JSON.stringify(antworten))
    const fake = join(dir, 'nak')
    writeFileSync(
        fake,
        `#!/usr/bin/env bash
n=$(( $(cat "${zaehler}") + 1 )); echo $n > "${zaehler}"
echo "$@" > "${dir}/args-$n"
python3 - "$n" "${dir}/antworten.json" <<'PY'
import json, sys
n = int(sys.argv[1]); a = json.load(open(sys.argv[2])); r = a[min(n, len(a)) - 1]
sys.stdout.write(r["out"]); sys.stderr.write(r["err"]); sys.exit(r.get("rc", 0))
PY
`,
    )
    chmodSync(fake, 0o755)
    const res = spawnSync(WRAPPER, args, { encoding: 'utf8', env: { ...process.env, NAK_REAL: fake } })

    return { res, calls: Number(readFileSync(zaehler, 'utf8')), dir }
}

const EVENT = '{"kind":9,"id":"aa"}\n'

test('req: leer UND ohne Authentifizierung wird wiederholt, bis eine Antwort kommt', () => {
    const { res, calls } = lauf(['req', '-k', '9', 'ws://x'], [
        { out: '', err: 'connecting to x... ok.\n' },
        { out: '', err: 'connecting to x... ok.\n' },
        { out: EVENT, err: 'connecting to x... ok.\nauthenticating to ws://x as npub1…\n' },
    ])
    assert.equal(calls, 3)
    assert.equal(res.stdout, EVENT)
    assert.equal(res.status, 0)
})

test('req: eine leere Antwort, die authentifiziert hat, ist eine ANTWORT — kein zweiter Aufruf', () => {
    const { res, calls } = lauf(['req', '-k', '9', 'ws://x'], [
        { out: '', err: 'connecting to x... ok.\nauthenticating to ws://x as npub1…\n' },
    ])
    assert.equal(calls, 1)
    assert.equal(res.stdout, '')
})

test('req: bleibt es dreimal leer, kommt es leer zurück — nach genau drei Versuchen, ohne Fehler', () => {
    const { res, calls } = lauf(['req', 'ws://x'], [{ out: '', err: 'connecting to x... ok.\n' }])
    assert.equal(calls, 3)
    assert.equal(res.stdout, '')
    assert.equal(res.status, 0)
    assert.match(res.stderr, /connecting to x/)
})

test('req: Argumente und Exit-Code des letzten Versuchs kommen unverändert durch', () => {
    const { res, calls, dir } = lauf(['req', '-k', '9', '-t', 'h=welcome', 'ws://x'], [
        { out: '', err: '', rc: 1 },
        { out: EVENT, err: 'authenticating…\n', rc: 7 },
    ])
    assert.equal(calls, 2)
    assert.equal(res.status, 7)
    assert.equal(readFileSync(join(dir, 'args-2'), 'utf8').trim(), 'req -k 9 -t h=welcome ws://x')
})

test('event: wird NIE wiederholt — auch eine Ablehnung nicht, sie ist die Antwort', () => {
    const { res, calls, dir } = lauf(['event', '--auth', '-k', '9', 'ws://x'], [
        // Empty stdout and no authentication line: exactly what makes a `req` retry. For an
        // `event` it must not, or the mutation „retry every subcommand" would go unnoticed.
        { out: '', err: 'publishing to x... failed: msg: restricted: not a member\n', rc: 0 },
    ])
    assert.equal(calls, 1)
    assert.equal(res.stdout, '')
    assert.match(res.stderr, /restricted/)
    assert.equal(readFileSync(join(dir, 'args-1'), 'utf8').trim(), 'event --auth -k 9 ws://x')
})

test('andere Unterbefehle: ein Aufruf, Exit-Code durchgereicht', () => {
    const { res, calls } = lauf(['key', 'public', 'abc'], [{ out: 'deadbeef\n', err: '', rc: 3 }])
    assert.equal(calls, 1)
    assert.equal(res.status, 3)
    assert.equal(res.stdout, 'deadbeef\n')
})
