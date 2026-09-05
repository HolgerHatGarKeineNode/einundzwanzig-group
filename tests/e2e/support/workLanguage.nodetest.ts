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
 *     repository — 1439 comment lines on 2026-09-05, and not one of them carries even a
 *     SINGLE marker. A scanner with false positives is a scanner that gets switched off.
 *  3. **Does it see German at all?** Measured over the German stock, and the denominator
 *     decides what the number means:
 *       · 53.8 % of ALL comment lines of those files — this one UNDERSTATES, because
 *         mixed-language files contribute English lines to the denominator;
 *       · 71.9 % of the lines that carry at least one marker;
 *       · **85.3 % of German comment BLOCKS**, and that is the unit that matters: an
 *         author is corrected once per block, and a docblock is caught the moment any
 *         one of its lines reaches two markers.
 *     The reviewer measured the same threshold against an independent, hand-built
 *     reference list of German lines and got **79.5 % of lines and 91.9 % of blocks** —
 *     higher than the figures here because that list contains only lines that really are
 *     German prose, while the corpus below divides through whole files.
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
    commentBlocksOf,
    commentLines,
    commentsOf,
    envCommentLines,
    germanMarkersIn,
    isGerman,
    parseDiff,
    phpCommentLines,
    phpTestNameLines,
    readerFor,
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
 * The two repositories and the paths the latch is responsible for.
 *
 * **Two repos**, because `packages/einundzwanzig-group` is its own git repo, hidden from
 * the host by `.gitignore:41` — a single `git diff` in the host sees literally none of
 * it. The P3 drift sat entirely inside `js/`.
 *
 * **These paths and not just the TypeScript**, because a first version stopped at `.ts`
 * and that was a fifth of the surface the rule broke on: of the ~233 German lines that
 * blocked P2, roughly 45 were inside that reach and ~188 outside it — including a whole
 * new German Pest file with four German case names, which was the blocker itself. A latch
 * that cannot see the place where the rule broke does not measure the rule, it soothes.
 *
 * Every path here must match tracked files; `addedLines` throws if one does not. The
 * package has no `app/` and no `tests/` — declaring them would be the same silent nothing.
 */
const AREAS: Area[] = [
    { root: ROOT, name: 'host', paths: ['app', 'config', 'resources', 'tests', '.env.example'] },
    { root: PACKAGE, name: 'package', paths: ['js', 'config', 'resources', 'routes', 'src'] },
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

test('CALIBRATION: a TRAILING comment is read — the hole the reviewer measured', () => {
    // `getLeadingCommentRanges` never returns a comment that shares its line with code.
    // The first version of this latch used only that call, and its module header claimed
    // the opposite. Measured over eight real files: 139 of 5117 comment lines invisible,
    // 32 of them German. Worse, it compounded with the known one-marker blind spot — a
    // one-line German trailing comment was invisible twice over.
    const source = [
        "export const state = { flag: true } // dieser Kommentar steht hinter dem Code",  // 1
        'export const other = 1 /* und dieser Block auch, in derselben Zeile */',         // 2
    ].join('\n')
    const lines = commentLines(source, 'trailing.ts')

    assert.deepEqual([...lines.keys()].sort((x, y) => x - y), [1, 2], 'a trailing comment was not read')
    assert.equal(isGerman(lines.get(1) as string), true)
    assert.equal(isGerman(lines.get(2) as string), true)
})

test('CALIBRATION: PHP comments — three syntaxes, and no false openers', () => {
    const source = [
        '<?php',                                                       // 1
        "$url = 'https://example.test/pfad'; // dieser Kommentar ist deutsch und nicht englisch",  // 2
        '# und diese Zeile auch, mit Doppelkreuz',                     // 3
        '#[Layout("group::einundzwanzig")]',                           // 4
        '/* ein Blockkommentar,',                                      // 5
        '   der ueber zwei Zeilen laeuft */',                          // 6
        "$keep = 'nicht ein Kommentar, sondern eine Zeichenkette';",    // 7
    ].join('\n')
    const lines = phpCommentLines(source, 'fixture.php')

    assert.deepEqual([...lines.keys()].sort((x, y) => x - y), [2, 3, 5, 6])
    assert.equal(lines.get(4), undefined, 'a PHP 8 attribute is not a comment')
    assert.equal(lines.get(7), undefined, 'a string literal is not a comment')
    assert.equal(isGerman(lines.get(2) as string), true)
    assert.equal(isGerman(lines.get(3) as string), true)
    // The `//` inside the URL is masked away, so line 2 yields the comment and not the path.
    assert.ok(!(lines.get(2) as string).includes('example.test'))
})

test('CALIBRATION: Blade comments — `{{-- --}}`, and PHP syntax only inside a PHP region', () => {
    const source = [
        '{{-- ein Blade-Kommentar, der gelesen werden muss --}}',       // 1
        '<a href="https://example.test/x">link</a>',                    // 2
        '@php',                                                         // 3
        '// dieser Kommentar liegt in einer PHP-Region und zaehlt',      // 4
        '@endphp',                                                      // 5
        '<p>Text // das hier ist kein Kommentar, sondern Markup</p>',    // 6
        '{{-- ein Blade-Block,',                                        // 7
        '     der ueber zwei Zeilen geht --}}',                         // 8
    ].join('\n')
    const lines = phpCommentLines(source, 'fixture.blade.php')

    assert.deepEqual([...lines.keys()].sort((x, y) => x - y), [1, 4, 7, 8])
    assert.equal(lines.get(2), undefined, 'a URL in markup is not a comment')
    assert.equal(lines.get(6), undefined, 'a `//` outside a PHP region is not a comment')
    assert.equal(isGerman(lines.get(1) as string), true)
    assert.equal(isGerman(lines.get(4) as string), true)
})

test('CALIBRATION: Pest case names are read from PHP', () => {
    const source = [
        "test('eine deutsche Fallbeschreibung, die nicht durchgeht', function () {});",
        "it('reads an English name', function () {});",
        "$latest = $query->latest('created_at');",
    ].join('\n')
    const names = phpTestNameLines(source)

    assert.deepEqual([...names.keys()], [1, 2], '`latest(…)` must not read as `test(…)`')
    assert.equal(isGerman(names.get(1) as string), true)
    assert.equal(isGerman(names.get(2) as string), false)
})

test('CALIBRATION: env files carry `#` comments and nothing else', () => {
    const lines = envCommentLines('APP_ENV=local\n# dieser Hinweis ist deutsch und wird gelesen\nKEY=value\n')
    assert.deepEqual([...lines.keys()], [2])
    assert.equal(isGerman(lines.get(2) as string), true)
})

test('CALIBRATION: the diff parser survives a quoted, non-ASCII path', () => {
    // The second bug this latch had, and it was silent: git renders `⚡room.blade.php` as
    // a QUOTED, escaped path, which the first parser did not match — so from that file
    // onwards every hunk was credited to the PREVIOUS one. Measured: a 90-line partial
    // was reported as having added lines 330 to 543, and a German comment of the
    // untouched stock came out as a finding of this branch. `core.quotepath=false` and
    // this parser both have to fail before that can come back.
    const diff = [
        'diff --git a/js/palette.ts b/js/palette.ts',
        '--- a/js/palette.ts',
        '+++ b/js/palette.ts',
        '@@ -40,0 +41,3 @@',
        '+one',
        '+two',
        '+three',
        'diff --git "a/resources/views/\\342\\232\\241room.blade.php" "b/resources/views/\\342\\232\\241room.blade.php"',
        '--- "a/resources/views/\\342\\232\\241room.blade.php"',
        '+++ "b/resources/views/\\342\\232\\241room.blade.php"',
        '@@ -330,0 +331,2 @@',
        '+four',
        '+five',
    ].join('\n')
    const parsed = parseDiff(diff)

    assert.deepEqual([...(parsed.get('js/palette.ts') ?? [])], [41, 42, 43])
    const blade = [...parsed.keys()].find((key) => key.includes('room.blade.php'))
    assert.ok(blade, 'the quoted path was dropped — its hunks would land on the previous file')
    assert.deepEqual([...(parsed.get(blade as string) ?? [])], [331, 332])
    assert.equal(
        (parsed.get('js/palette.ts') as Set<number>).has(331),
        false,
        'hunks of the second file leaked into the first — exactly the measured bug',
    )
})

test('CALIBRATION: the reader dispatch covers exactly the four declared kinds', () => {
    assert.equal(readerFor('js/palette.ts'), 'ts')
    assert.equal(readerFor('app/Nostr/SpaceCache.php'), 'php')
    assert.equal(readerFor('resources/views/x.blade.php'), 'php')
    assert.equal(readerFor('.env.example'), 'env')
    assert.equal(readerFor('resources/css/app.css'), null)
    assert.equal(readerFor('lang/de.json'), null, 'product text is data and stays German')
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
 *
 * A Blade file is in the list on purpose: the reach grew to `.blade.php` in this round,
 * and a sensitivity number that only ever saw TypeScript would say nothing about the half
 * of the surface that was added.
 */
const GERMAN_CORPUS = [
    join(PACKAGE, 'js', 'rail.ts'),
    join(PACKAGE, 'js', 'groups.ts'),
    join(PACKAGE, 'js', 'railGroups.ts'),
    join(ROOT, 'tests', 'e2e', 'buzz-presence.spec.ts'),
    join(PACKAGE, 'resources', 'views', 'components', 'desktop-rail.blade.php'),
]

test('MEASURED: the detector catches German comment BLOCKS, which is the unit that matters', () => {
    let lines = 0
    let markerBearing = 0
    let flaggedLines = 0
    for (const file of GERMAN_CORPUS) {
        assert.ok(existsSync(file), `${file} is gone — pick another file of the stock`)
        for (const line of commentsOf(file)) {
            lines++
            const markers = germanMarkersIn(line).length
            if (markers >= 1) {
                markerBearing++
            }
            if (markers >= MIN_MARKERS) {
                flaggedLines++
            }
        }
    }

    let germanBlocks = 0
    let caughtBlocks = 0
    for (const file of GERMAN_CORPUS) {
        for (const block of commentBlocksOf(file)) {
            if (!block.some((line) => germanMarkersIn(line).length >= 1)) {
                continue
            }
            germanBlocks++
            if (block.some(isGerman)) {
                caughtBlocks++
            }
        }
    }

    assert.ok(lines > 1200, `only ${lines} German comment lines read — the numbers below are empty`)
    assert.ok(germanBlocks > 300, `only ${germanBlocks} German comment blocks found — same problem`)

    const perLine = flaggedLines / lines
    const perMarkerLine = flaggedLines / markerBearing
    const perBlock = caughtBlocks / germanBlocks
    console.log(`[work-language] German corpus: ${lines} lines (${markerBearing} carry a marker), `
        + `${flaggedLines} flagged = ${(perLine * 100).toFixed(1)} % of all / `
        + `${(perMarkerLine * 100).toFixed(1)} % of marker-bearing; `
        + `${caughtBlocks}/${germanBlocks} blocks = ${(perBlock * 100).toFixed(1)} %`)

    // The floors are regression guards on the marker list, not targets. The BLOCK rate is
    // the one that carries the promise: an author is corrected once per block, not once
    // per line, and a docblock is caught as soon as any single line of it reaches two
    // markers.
    assert.ok(perBlock > 0.75, `only ${(perBlock * 100).toFixed(1)} % of German blocks caught`)
    assert.ok(perLine > 0.35, `only ${(perLine * 100).toFixed(1)} % of German lines caught`)
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
    let addedLineTotal = 0
    const findings: Finding[] = []
    const empty: string[] = []

    for (const area of AREAS) {
        // Fail-closed: `scanArea` throws when git does not answer, when the base cannot be
        // resolved, and when a declared path matches no tracked file. Without those a
        // broken checkout would report "nothing found" and be indistinguishable from a
        // clean branch.
        const report = scanArea(area, BASE)
        examinedTotal += report.examined
        addedLineTotal += report.addedLineTotal
        findings.push(...report.findings)
        // **The floor, and the only form of it that is honest.** A bare `examined > N`
        // would be wrong on `master`, where an empty diff is the correct answer, and
        // `examined >= 0` — which stood here — is true for a count no matter what, so it
        // could never fall. What can be asserted in both worlds is the IMPLICATION: if the
        // diff added lines to files this scanner is responsible for, then it must have
        // read comment lines in them. That is exactly what breaks when the reader stops
        // matching the files the branch touched.
        if (report.addedLineTotal > 0 && report.examined === 0) {
            empty.push(
                `${area.name}: ${report.addedLineTotal} added lines across ${report.addedFiles} files, `
                    + 'but not one comment line or test name was read in them',
            )
        }
    }

    assert.deepEqual(
        empty,
        [],
        'The scanner looked at files and came back with nothing to read. That is a broken '
            + `reader or a wrong path list, not a clean branch:\n${empty.join('\n')}`,
    )

    assert.deepEqual(
        findings.map(describe),
        [],
        `German comment lines or test names among the lines added against \`${BASE}\`.\n`
            + 'New comments and test names are English; German stays in `lang/*.json` and in quoted '
            + 'product text (locators, assertions, fixture content).\n'
            + 'NOTE: identifiers, commit messages and branch names are part of the same rule but are '
            + 'NOT measured here — this list is about comment lines and test names only.\n'
            + `${examinedTotal} added comment lines / test names examined:\n${findings.map(describe).join('\n')}`,
    )

    console.log(`[work-language] ${examinedTotal} added comment lines / test names examined against ${BASE} `
        + `(out of ${addedLineTotal} added lines in files this scanner reads), ${findings.length} objected to`)
})
