/**
 * **Is the work language English in the lines this branch ADDED?**
 *
 * Runs as a unit latch (`workLanguage.nodetest.ts`, part of `npm run test:unit`):
 *   node --test --experimental-strip-types tests/e2e/support/workLanguage.nodetest.ts
 *
 * ── Why this exists as a measurement and not as a sentence in a brief ───────────────
 *
 * The rule ("the work is English, the conversation with the user is German") stood in
 * bold in the brief of P1, P2 and P3 of `2026-09-05T0125-community-features-herbst`, and
 * all three phases delivered German comments anyway — three corrective rounds for one
 * rule. An instruction that does not hold three times running is not an instruction
 * problem; it is a missing measurement. The builder of P1 proposed this latch, it was
 * deferred, and the deferral cost a round per phase.
 *
 * ── What it looks at, and what it deliberately does not ─────────────────────────────
 *
 * **Only ADDED lines**, against a cut-off commit (`master`). The existing stock is
 * explicitly protected: the seven older German E2E specs and every older German comment
 * stay as they are — they quote literal measurements, and translating them would destroy
 * the evidence they carry (doctrine, 2026-08-29). This scanner never sees them, because
 * a line that is not in the diff is not in its input.
 *
 * **Comment lines and test names**, not strings. German product text is DATA:
 *   · `lang/*.json` in full — that is user-facing text and stays German,
 *   · a quoted product string inside an assertion or a locator
 *     (`getByRole('button', { name: 'Neue Unterhaltung' })`),
 *   · the literal `content` of a fixture event.
 * P2 produced nine such hits and every one of them was legitimate. Strings are therefore
 * out of scope entirely; a comment that QUOTES one has its quoted spans removed before
 * the language question is asked (see {@link stripQuotedSpans}).
 *
 * ── Why the threshold is two markers and not one ────────────────────────────────────
 *
 * A one-marker rule is what made the coordinator's own hand-rolled scanner unusable: it
 * took `sucht`, `wie` and `der` as evidence, and words like `die` are ordinary English
 * (`the process would die`), ordinary code (`Rooms.die`) and ordinary German at the same
 * time. German prose, on the other hand, practically cannot get through a whole line with
 * fewer than two function words. The false-positive rate of this threshold is MEASURED
 * against the English files of this repository in the latch next door — it is not an
 * estimate, and it is what keeps this scanner from becoming the thing everybody disables.
 *
 * ── Fail-closed ────────────────────────────────────────────────────────────────────
 *
 * Every step throws instead of reporting "nothing found": an unresolvable base commit, a
 * `git` that does not answer, a file the parser rejects. A scanner that is silent when it
 * cannot see is worse than no scanner, because its green is indistinguishable from a
 * clean tree — the same failure class as a `test.skip()` that nobody counts.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'

/**
 * Words that are German and are neither English words nor plausible identifiers.
 *
 * Chosen against three collision classes, not by intuition:
 *  1. **English homographs** — `die`, `also`, `hat`, `war`, `bin`, `an`, `in`, `so`, `um`
 *     are German AND English (or English-ish) and are therefore NOT on this list, however
 *     German they feel.
 *  2. **Identifiers** — every entry is matched with word boundaries and only after code
 *     spans have been removed, so `identifier`, `renderer` or `dmRoomName` cannot
 *     contribute a hit.
 *  3. **Abbreviations in English prose** — `z. B.`, `bzw.` and friends are deliberately
 *     absent: they appear in the older German stock, which this scanner never reads.
 */
export const GERMAN_MARKERS: readonly string[] = [
    'aber', 'auch', 'beim', 'bereits', 'bleibt', 'dann', 'damit', 'dass', 'deshalb',
    'diese', 'dieselbe', 'dieser', 'dieses', 'durch', 'eigene', 'eigenen', 'eine',
    'einem', 'einen', 'einer', 'eines', 'genau', 'gibt', 'hier', 'ihre', 'immer',
    'jede', 'jeder', 'jedes', 'kein', 'keine', 'keinen', 'liegt', 'liest', 'muss',
    'nicht', 'noch', 'nur', 'oder', 'ohne', 'schon', 'seine', 'sich', 'sind', 'sondern',
    'sonst', 'statt', 'steht', 'stehen', 'stellt', 'trotzdem', 'und', 'vom', 'weil',
    'wenn', 'werden', 'wieder', 'wird', 'wurde', 'zeigt', 'zum', 'zur', 'zwei',
]

/** How many distinct markers a line needs before it counts as German. */
export const MIN_MARKERS = 2

/** One line the scanner objects to. */
export type Finding = {
    /** Repo-relative path, prefixed with the area name. */
    file: string
    /** 1-based line number in the CURRENT file. */
    line: number
    kind: 'comment' | 'test-name'
    text: string
    /** The markers that decided it — so a false positive is arguable, not opaque. */
    markers: string[]
}

/** A repository this scanner walks: its git root and the paths it is responsible for. */
export type Area = {
    /** Absolute path of the git working tree. */
    root: string
    /** Label for messages (`host`, `package`). */
    name: string
    /** Path prefixes, relative to `root`. */
    paths: string[]
}

/**
 * Remove everything that is DATA rather than prose: code spans and quoted strings.
 *
 * An English comment is allowed to quote a German product string — that is the ordinary
 * way to explain why a locator reads the way it does — and it is allowed to name German
 * identifiers in backticks. Neither says anything about the language the comment is
 * written in, so neither may contribute a marker.
 *
 * The German quotation marks are in the list because this repository uses them; the
 * straight and typographic English pairs are there because a quoted product string is
 * just as often written with those.
 */
export const stripQuotedSpans = (text: string): string =>
    text
        .replace(/`[^`]*`/g, ' ')
        .replace(/„[^""]*["""]/g, ' ')
        .replace(/»[^«]*«/g, ' ')
        .replace(/"[^"]*"/g, ' ')
        .replace(/'[^']*'/g, ' ')
        .replace(/"[^"]*"/g, ' ')

/** The distinct German markers of a line, after the data has been taken out. */
export const germanMarkersIn = (text: string): string[] => {
    const prose = stripQuotedSpans(text).toLocaleLowerCase()
    const hits = new Set<string>()
    for (const word of GERMAN_MARKERS) {
        if (new RegExp(`(?<![\\p{L}\\p{N}_])${word}(?![\\p{L}\\p{N}_])`, 'u').test(prose)) {
            hits.add(word)
        }
    }
    // ä/ö/ü/ß count as ONE marker, never as a verdict on their own: a single umlaut may
    // well sit in a German name that an English sentence mentions, and that is not a
    // German sentence.
    if (/[äöüÄÖÜß]/.test(stripQuotedSpans(text))) {
        hits.add('umlaut')
    }

    return [...hits].sort()
}

export const isGerman = (text: string): boolean => germanMarkersIn(text).length >= MIN_MARKERS

/**
 * Every comment LINE of a source file, keyed by 1-based line number.
 *
 * Via the PARSED tree and not a regex over the text: `//` inside a string literal and
 * `/*` inside a regex literal are exactly the two gaps that were measured in
 * `importEndungenGate.ts` in this repository.
 *
 * **And not via a bare `ts.createScanner` loop either — that was this function's own
 * first version, and the falsification probe of 2026-09-05 caught it.** A raw `scan()`
 * loop has no template-literal state: after the first `` `…${…}…` `` it mis-reads the
 * closing brace, treats the following backtick as the START of a new template and
 * swallows everything up to the next one — comments included. Measured on
 * `buzz-dm-names.spec.ts`: 28 comment lines found instead of 66, and a German line
 * planted at line 65 went through unseen. `getLeadingCommentRanges` over the real tree
 * has no such state to get wrong, because the parser has already done the tokenising.
 *
 * Every comment is leading trivia of some token, and the tree contains every token
 * (`getChildren()`, unlike `forEachChild`, descends into them) — including
 * `EndOfFileToken`, which carries a comment that closes the file.
 *
 * **Fail-closed:** a non-empty file the parser rejects throws instead of reporting "no
 * comments".
 */
export const commentLines = (source: string, file: string): Map<number, string> => {
    const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
    if (source.trim() !== '' && tree.statements.length === 0) {
        throw new Error(`${file}: not a single statement parsed — the scanner measures nothing here.`)
    }

    const lines = new Map<number, string>()
    const seen = new Set<number>()
    const take = (range: ts.CommentRange): void => {
        if (seen.has(range.pos)) {
            return
        }
        seen.add(range.pos)
        const firstLine = tree.getLineAndCharacterOfPosition(range.pos).line
        source.slice(range.pos, range.end).split('\n').forEach((lineText, offset) => {
            const bare = lineText.replace(/^\s*(?:\/\*\*?|\*\/|\*|\/\/)\s?/, '').replace(/\*\/\s*$/, '').trim()
            if (bare !== '') {
                lines.set(firstLine + offset + 1, bare)
            }
        })
    }

    const walk = (node: ts.Node): void => {
        for (const range of ts.getLeadingCommentRanges(source, node.pos) ?? []) {
            take(range)
        }
        for (const child of node.getChildren(tree)) {
            walk(child)
        }
    }
    walk(tree)

    return lines
}

/**
 * The name of every `test(…)` / `it(…)` / `describe(…)` in a file, keyed by the line the
 * name literal sits on.
 *
 * Test names are the second half of the drift: P1 shipped a spec whose comments were
 * German and whose case titles were too, and the titles are what a reader of a failing
 * run sees first.
 */
export const testNameLines = (source: string, file: string): Map<number, string> => {
    const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
    const names = new Map<number, string>()
    const isTestCall = (expression: ts.Expression): boolean =>
        /^(?:test|it|describe|suite)(?:\.(?:describe|skip|only|fixme|serial|parallel))*$/
            .test(expression.getText(tree))
    const walk = (node: ts.Node): void => {
        if (
            ts.isCallExpression(node)
            && isTestCall(node.expression)
            && node.arguments.length > 0
            && ts.isStringLiteralLike(node.arguments[0])
        ) {
            const literal = node.arguments[0]
            names.set(tree.getLineAndCharacterOfPosition(literal.getStart(tree)).line + 1, literal.text)
        }
        ts.forEachChild(node, walk)
    }
    walk(tree)

    return names
}

const git = (root: string, args: string[]): string => {
    try {
        return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    } catch (error) {
        throw new Error(`git ${args.join(' ')} in ${root} failed: ${String(error)}`)
    }
}

/**
 * The line numbers this working tree ADDED per file, against `base`.
 *
 * Two sources, because one of them alone would have a hole where the risk is highest:
 *  · `git diff <mergeBase>` — committed AND uncommitted changes, so the latch answers
 *    before the commit and not only after it;
 *  · untracked files, counted as added in full. A brand-new spec is exactly the case the
 *    language drift produced, and `git diff` does not show it.
 */
export const addedLines = (area: Area, base: string): Map<string, Set<number>> => {
    const mergeBase = git(area.root, ['merge-base', base, 'HEAD']).trim()
    if (!/^[0-9a-f]{7,40}$/.test(mergeBase)) {
        throw new Error(`${area.name}: no merge base against \`${base}\` — the scanner has no cut-off.`)
    }

    const perFile = new Map<string, Set<number>>()
    const diff = git(area.root, ['diff', '--unified=0', '--no-color', mergeBase, '--', ...area.paths])
    let file = ''
    for (const line of diff.split('\n')) {
        const target = /^\+\+\+ b\/(.+)$/.exec(line)
        if (target) {
            file = target[1]
            continue
        }
        const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line)
        if (hunk && file !== '' && file !== 'dev/null') {
            const start = Number(hunk[1])
            const count = hunk[2] === undefined ? 1 : Number(hunk[2])
            const set = perFile.get(file) ?? new Set<number>()
            for (let i = 0; i < count; i++) {
                set.add(start + i)
            }
            perFile.set(file, set)
        }
    }

    const untracked = git(area.root, ['ls-files', '--others', '--exclude-standard', '--', ...area.paths])
    for (const path of untracked.split('\n').filter((entry) => entry.trim() !== '')) {
        const absolute = join(area.root, path)
        if (!existsSync(absolute)) {
            continue
        }
        const count = readFileSync(absolute, 'utf8').split('\n').length
        perFile.set(path, new Set(Array.from({ length: count }, (_, i) => i + 1)))
    }

    return perFile
}

/** Everything the scanner examined — the number belongs in the report, not just the verdict. */
export type Report = {
    findings: Finding[]
    /** How many added comment lines and test names were actually read. */
    examined: number
    /** How many files contributed to that. */
    files: number
}

/** Walk one area and report every added German comment line and test name. */
export const scanArea = (area: Area, base: string): Report => {
    const perFile = addedLines(area, base)
    const findings: Finding[] = []
    let examined = 0
    let files = 0

    for (const [file, lines] of perFile) {
        if (!file.endsWith('.ts')) {
            continue
        }
        const absolute = join(area.root, file)
        if (!existsSync(absolute)) {
            continue // deleted on this branch — nothing of it is on screen any more
        }
        const source = readFileSync(absolute, 'utf8')
        const candidates: [number, string, Finding['kind']][] = [
            ...[...commentLines(source, file)].map(
                ([line, text]) => [line, text, 'comment'] as [number, string, Finding['kind']],
            ),
            ...[...testNameLines(source, file)].map(
                ([line, text]) => [line, text, 'test-name'] as [number, string, Finding['kind']],
            ),
        ]
        let touched = false
        for (const [line, text, kind] of candidates) {
            if (!lines.has(line)) {
                continue
            }
            touched = true
            examined++
            const markers = germanMarkersIn(text)
            if (markers.length >= MIN_MARKERS) {
                findings.push({ file: `${area.name}:${file}`, line, kind, text, markers })
            }
        }
        if (touched) {
            files++
        }
    }

    return { findings, examined, files }
}

/** All comment lines of a file on disk — the corpus of the calibration cases. */
export const commentsOf = (absolutePath: string): string[] =>
    [...commentLines(readFileSync(absolutePath, 'utf8'), absolutePath).values()]
