/**
 * **The latch over the work language of NEW lines.**
 *
 * Run: node --test --experimental-strip-types tests/e2e/support/workLanguage.nodetest.ts
 * (runs inside `npm run test:unit`).
 *
 * Doctrine: "the work is English, the conversation with the user is German". Plan:
 * `docs/plans/2026-09-05T0125-community-features-herbst.md`, section "Sprach-Drift".
 *
 * ── Why a latch and not another sentence in the brief ───────────────────────────────
 *
 * The rule stood in bold in the brief of P1, P2 AND P3, and all three phases delivered
 * German comments anyway. Three rounds of correction for one rule, each of them a full
 * turn. That is the signature of a rule nobody measures — and the fix for it is not a
 * fourth reminder.
 *
 * ── The four questions this file answers, in this order ─────────────────────────────
 *
 *  1. **Can the detector see anything at all?** A fixed fixture with one German and one
 *     English line. If this goes red, nothing below means anything.
 *  2. **How often is it wrong on English?** Measured over the English files of this
 *     repository — 1386 comment lines on 2026-09-05, and not one of them carries even a
 *     SINGLE marker. A scanner with false positives is a scanner that gets switched off.
 *  3. **Does it see German at all?** Measured over the German stock — 1468 comment lines,
 *     768 flagged. Per LINE that is 52 %, and that is the honest number: a scanner asking
 *     a per-line question misses `* der Zeile stammt.` The unit that matters is the
 *     comment BLOCK, and a German block has no chance of staying under the threshold on
 *     every one of its lines.
 *  4. **Is the branch clean?** The actual verdict, over both repositories.
 *
 * ── What it may not do ─────────────────────────────────────────────────────────────
 *
 * Touch the stock. The seven older German E2E specs and every older German comment stay
 * as they are — they quote literal measurements, and a translation would destroy exactly
 * the evidence they carry. The scanner only ever sees lines this branch ADDED against
 * `master`, so the stock is out of its reach by construction, not by an exception list.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import {
    GERMAN_MARKERS,
    MIN_MARKERS,
    commentLines,
    commentsOf,
    germanMarkersIn,
    isGerman,
    scanArea,
    testNameLines,
    type Area,
    type Finding,
} from './workLanguage.ts'

const ROOT = join(import.meta.dirname, '..', '..', '..')
const PACKAGE = join(ROOT, 'packages', 'einundzwanzig-group')

/**
 * The cut-off. `master` and not a date: a branch is measured against what it branched
 * off, and `git merge-base` turns that into a commit even after `master` has moved on.
 */
const BASE = 'master'

/**
 * The two repositories, because the code lives in two.
 *
 * `packages/einundzwanzig-group` is its own git repo, hidden from the host by
 * `.gitignore:41` — a single `git diff` in the host sees literally none of it. That is
 * the same blindness that makes every `grep` from the repo root worthless for this
 * package, and it would have made this latch a decoration: the drift measured for P3 was
 * entirely inside `js/`.
 */
const AREAS: Area[] = [
    { root: ROOT, name: 'host', paths: ['tests/e2e'] },
    { root: PACKAGE, name: 'package', paths: ['js'] },
]

// ══ 1. Can the detector see anything at all? ═════════════════════════════════════

test('CALIBRATION: the detector separates a German line from an English one', () => {
    // Fixed input, no git, no tree: this case is green or red for one reason only.
    assert.equal(isGerman('Der Topf muss über beide Sichten entdoppelt werden, sonst fehlt eine Zeile.'), true)
    assert.equal(isGerman('The pot has to be deduplicated across both views, or a row goes missing.'), false)
    assert.ok(GERMAN_MARKERS.length > 40, 'the marker list has been gutted')
    assert.equal(MIN_MARKERS, 2)
})

test('CALIBRATION: the comment reader really reads comments — and only comments', () => {
    const source = [
        "const a = 'not a // comment'",           // 1
        '// eine Zeile, die nicht durchgeht',      // 2
        'const re = /\\/\\* nicht wirklich \\*\\//', // 3
        '/**',                                     // 4
        ' * Ein Blockkommentar über zwei Zeilen,', // 5
        ' * und die zweite zählt auch.',           // 6
        ' */',                                     // 7
        'export const b = 1',                      // 8
    ].join('\n')
    const lines = commentLines(source, 'fixture.ts')

    assert.deepEqual([...lines.keys()].sort((x, y) => x - y), [2, 5, 6])
    assert.equal(lines.get(1), undefined, 'a `//` inside a string literal is not a comment')
    assert.equal(lines.get(3), undefined, 'a `/*` inside a regex literal is not a comment')
    assert.equal(lines.get(2), 'eine Zeile, die nicht durchgeht')
    // …and all three German lines are recognised as such.
    for (const line of [2, 5, 6]) {
        assert.equal(isGerman(lines.get(line) as string), true, `line ${line} should read as German`)
    }
})

test('CALIBRATION: a template literal does not blind the comment reader', () => {
    // The regression guard for this file's own first bug. `commentLines` used to drive a
    // bare `ts.createScanner` loop, which has no template-literal state: after the first
    // `${…}` it mis-read the closing brace, took the next backtick for the start of a new
    // template and swallowed everything up to the one after it. Measured on
    // `buzz-dm-names.spec.ts`: 28 comment lines instead of 66, and a German line planted
    // at line 65 walked straight through the latch.
    const source = [
        'const a = `head ${x} tail`',              // 1
        '// eine Zeile, die nach dem Template noch gesehen werden muss', // 2
        'const b = `second ${y} template`',        // 3
        '/** und ein Blockkommentar, der nicht verschwinden darf */',    // 4
        'export const c = 1',                      // 5
    ].join('\n')
    const lines = commentLines(source, 'template.ts')

    assert.deepEqual([...lines.keys()].sort((x, y) => x - y), [2, 4], 'a comment after a template literal was lost')
    assert.equal(isGerman(lines.get(2) as string), true)
    assert.equal(isGerman(lines.get(4) as string), true)
})

test('CALIBRATION: test names are read, and only from test calls', () => {
    const source = [
        "test('eine deutsche Fallbeschreibung, die nicht durchgeht', () => {})",
        "describe('an English suite', () => {})",
        "notATest('eine deutsche Zeichenkette, die keine Fallbeschreibung ist', 1)",
    ].join('\n')
    const names = testNameLines(source, 'fixture.test.ts')

    assert.deepEqual([...names.keys()], [1, 2])
    assert.equal(isGerman(names.get(1) as string), true)
    assert.equal(isGerman(names.get(2) as string), false)
})

test('CALIBRATION: quoted product text and code spans do not make a line German', () => {
    // This is the exception the brief names: German UI text is DATA. A comment that
    // explains a locator has to be able to quote it.
    assert.equal(
        isGerman("the locator reads `getByRole('button', { name: 'Neue Unterhaltung' })` for a reason"),
        false,
    )
    assert.equal(isGerman('the rail section is found through its heading „Direktnachrichten"'), false)
    assert.equal(isGerman('the fixture content is "eine Nachricht, die nicht gelesen wurde"'), false)
    // And the control: with the quotes removed the very same words DO decide.
    assert.equal(isGerman('eine Nachricht, die nicht gelesen wurde'), true)
})

test('CALIBRATION: English words that look German are not evidence', () => {
    // The failure mode of the coordinator's own hand-rolled scanner, which took `sucht`,
    // `wie` and `der` as markers.
    for (const line of [
        'the identifier of the renderer is not a German word',
        'a process that would die here leaves the lock behind',
        'also note that the order is part of the contract',
        'the war story is in the commit message',
        'so far so good, and the bin is empty',
    ]) {
        assert.equal(isGerman(line), false, `false positive on: ${line}`)
        assert.ok(germanMarkersIn(line).length < MIN_MARKERS)
    }
})

// ══ 2. The false-positive rate, measured against the English stock ═══════════════

/**
 * Files written in English end to end. If the scanner objects to one of THESE, it is the
 * scanner that is wrong — and it would be switched off within a week.
 *
 * **How the list was arrived at, because "files the scanner is quiet on" would be
 * circular.** Every candidate was scanned at a threshold of ONE marker and the hits were
 * read. Two candidates dropped out and neither was a scanner error: `dms.ts` carries a
 * German passage quoted from `groups.ts` inside an English docblock, and
 * `dmRoomNames.test.ts` has five German comment lines of its own from P7b. Both are
 * protected stock and stay as they are — they simply cannot serve as an English yardstick.
 * `workLanguage.ts` is out for a third reason: it spells out `ä/ö/ü/ß` in prose, which is
 * a true umlaut hit about umlauts.
 */
const ENGLISH_CORPUS = [
    join(PACKAGE, 'js', 'dmModels.ts'),
    join(PACKAGE, 'js', 'calendarWiring.test.ts'),
    join(PACKAGE, 'js', 'calendar.ts'),
    join(PACKAGE, 'js', 'calendarModels.ts'),
    join(PACKAGE, 'js', 'moderationAudit.ts'),
    join(PACKAGE, 'js', 'dmHeaderName.test.ts'),
    join(PACKAGE, 'js', 'paletteDmRooms.test.ts'),
    join(PACKAGE, 'js', 'bookmarks.ts'),
    join(PACKAGE, 'js', 'reminders.ts'),
    join(ROOT, 'tests', 'e2e', 'buzz-dm-names.spec.ts'),
    join(ROOT, 'tests', 'e2e', 'support', 'workLanguage.nodetest.ts'),
]

test('MEASURED: not one English comment line carries even a SINGLE marker', () => {
    // Deliberately stricter than the verdict uses. At the threshold of two, a corpus
    // could look clean while the markers fire on English all the time and merely fail to
    // co-occur. Asserting ZERO at a threshold of one says the list itself does not hit
    // English — which is the property that decides whether anyone keeps this latch on.
    let examined = 0
    const flagged: string[] = []
    for (const file of ENGLISH_CORPUS) {
        assert.ok(existsSync(file), `${file} is gone — the corpus has to be corrected, not the threshold`)
        for (const line of commentsOf(file)) {
            examined++
            const markers = germanMarkersIn(line)
            if (markers.length > 0) {
                flagged.push(`${file.split('/').pop()}: {${markers.join(',')}} ${line}`)
            }
        }
    }
    // Fail-closed floor: "0 flagged" is also true for a corpus that was never read.
    assert.ok(examined > 1200, `only ${examined} English comment lines read — the corpus shrank, the number is empty`)
    assert.deepEqual(flagged, [], `false positives (${examined} lines examined):\n${flagged.join('\n')}`)
    console.log(`[work-language] false-positive corpus: ${examined} English comment lines, ${flagged.length} flagged`)
})

// ══ 3. The sensitivity, measured against the German stock ════════════════════════

/**
 * Files of the protected German stock. They are read HERE and nowhere else — this case
 * measures the detector against them, it does not judge them.
 */
const GERMAN_CORPUS = [
    join(PACKAGE, 'js', 'rail.ts'),
    join(PACKAGE, 'js', 'groups.ts'),
    join(PACKAGE, 'js', 'railGroups.ts'),
    join(ROOT, 'tests', 'e2e', 'buzz-presence.spec.ts'),
]

test('MEASURED: the detector flags about half of every German comment LINE', () => {
    let examined = 0
    let flagged = 0
    for (const file of GERMAN_CORPUS) {
        assert.ok(existsSync(file), `${file} is gone — pick another file of the stock`)
        for (const line of commentsOf(file)) {
            examined++
            if (isGerman(line)) {
                flagged++
            }
        }
    }
    assert.ok(examined > 800, `only ${examined} German comment lines read — the number below is empty`)
    const rate = flagged / examined
    // 52.3 % on 2026-09-05 (1468 lines, 768 flagged). The floor is deliberately far below
    // that: this is a regression guard on the marker list, not a target. What makes the
    // latch work is not the per-line rate but that a German comment BLOCK cannot keep
    // every one of its lines under two markers.
    assert.ok(
        rate > 0.35,
        `only ${(rate * 100).toFixed(1)} % of ${examined} German lines flagged — the marker list lost its grip`,
    )
})

// ══ 4. The verdict ═══════════════════════════════════════════════════════════════

test('FAIL-CLOSED: an unresolvable cut-off throws instead of reporting a clean tree', () => {
    // The most expensive way for a latch to fail is to be silent. A wrong base, a git that
    // does not answer, a checkout without `master` — each of those would otherwise produce
    // "0 findings", which is indistinguishable from a clean branch in a green run.
    assert.throws(
        () => scanArea({ root: ROOT, name: 'host', paths: ['tests/e2e'] }, 'no-such-ref-exists-here'),
        /failed|no merge base/,
    )
    assert.throws(
        () => scanArea({ root: join(ROOT, 'does', 'not', 'exist'), name: 'nowhere', paths: ['.'] }, BASE),
        /failed/,
    )
})

const describe = (finding: Finding): string =>
    `  ${finding.file}:${finding.line} [${finding.kind}] {${finding.markers.join(', ')}}\n      ${finding.text}`

test('the lines this branch ADDED are English — comments and test names', () => {
    let examinedTotal = 0
    const findings: Finding[] = []

    for (const area of AREAS) {
        // Fail-closed: `scanArea` throws when git does not answer or the base cannot be
        // resolved. Without that a broken checkout would report "nothing found" and be
        // indistinguishable from a clean branch.
        const report = scanArea(area, BASE)
        examinedTotal += report.examined
        findings.push(...report.findings)
    }

    assert.deepEqual(
        findings.map(describe),
        [],
        `German comment lines or test names among the lines added against \`${BASE}\`.\n`
            + 'The work language is English (comments, identifiers, test names, commit messages); '
            + 'German stays in `lang/*.json` and in quoted product text.\n'
            + `${examinedTotal} added comment lines / test names examined:\n${findings.map(describe).join('\n')}`,
    )

    // An empty diff is a legitimate state (on `master` there is nothing to add), but it
    // must not pass SILENTLY: a zero here and a zero from a scanner that read nothing look
    // the same in a green run. The number goes into the report either way, and the four
    // calibration cases above run regardless of what the tree looks like — they are what
    // keeps this case from being green for the wrong reason.
    assert.ok(
        examinedTotal >= 0,
        `examined ${examinedTotal} added comment lines / test names against ${BASE}`,
    )
    console.log(`[work-language] ${examinedTotal} added comment lines / test names examined against ${BASE}, `
        + `${findings.length} objected to`)
})
