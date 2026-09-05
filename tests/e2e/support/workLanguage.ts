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
 * problem; it is a missing measurement.
 *
 * ── EXACTLY what is measured, and what is not ──────────────────────────────────────
 *
 * **Measured:** comment lines and test names, in the lines this branch ADDED against
 * `master`, in BOTH repositories, across four file kinds:
 *
 * | kind | how comments are read | test names |
 * |---|---|---|
 * | `.ts` | TypeScript parser, leading AND trailing comment ranges | `test/it/describe(…)` via the AST |
 * | `.php` | line scanner: `//`, `#`, and C-style block comments; strings masked first | Pest `test/it/describe('…')` by pattern |
 * | `.blade.php` | the same scanner, plus `{{-- … --}}`; the PHP openers count ONLY inside `<?php`/`@php` regions | — |
 * | `.env*` | `#` to end of line | — |
 *
 * **NOT measured, and therefore not claimed anywhere in a failure message:**
 * identifiers, commit messages, branch names, PR text. All four are part of the same
 * doctrine; none of them is checked here. That is a deliberate cut for this round, not an
 * oversight — but a latch whose error text names things it never looked at reads as if it
 * had, and the next person trusts a green run further than it deserves.
 *
 * **Also not measured:** strings. German product text is DATA — `lang/*.json`, a quoted
 * string in a locator or an assertion, the `content` of a fixture event. P2 produced nine
 * such hits and every one was legitimate. A comment that QUOTES German has the quoted
 * span removed before the language question is asked ({@link stripQuotedSpans}).
 *
 * **The stock is out of reach by construction.** Only ADDED lines are read, so the seven
 * older German E2E specs and every older German comment are never in the input — they
 * quote literal measurements and translating them would destroy that evidence (doctrine,
 * 2026-08-29). This is not an exception list that could be forgotten.
 *
 * ── Where the non-TypeScript reader is imprecise, in its own words ──────────────────
 *
 * `.ts` goes through the real parser and is exact. `.php`/`.blade.php` go through a line
 * scanner, because dragging a PHP parser into a node unit test costs more than the
 * question is worth. It masks string literals before looking for a comment opener, and it
 * only accepts PHP comment syntax inside a PHP region of a Blade file — so a `//` in a
 * URL and a `#` in an `#[Attribute]` do not become comments. What it does NOT understand:
 * heredoc/nowdoc bodies, and `?>` inside a string in a Blade file. Both would end a PHP
 * region too early and lose comments after it — the failure direction is a MISS, never a
 * false alarm, which is the right way round for a scanner that must not cry wolf.
 *
 * ── Why the threshold is two markers and not one ────────────────────────────────────
 *
 * A one-marker rule is what made the coordinator's own hand-rolled scanner unusable: it
 * took `sucht`, `wie` and `der` as evidence, and words like `die` are ordinary English
 * (`the process would die`), ordinary code (`Rooms.die`) and ordinary German at the same
 * time. German prose practically cannot get through a whole line with fewer than two
 * function words. Both the false-positive rate and the sensitivity of that threshold are
 * MEASURED in the latch next door — neither is an estimate.
 *
 * ── Fail-closed ────────────────────────────────────────────────────────────────────
 *
 * Four ways to be silent, all of them closed: an unresolvable base commit throws, a `git`
 * that does not answer throws, a declared path that matches no tracked file throws, and a
 * file the parser rejects throws. On top of that the latch asserts an IMPLICATION rather
 * than a bare count — an area whose diff added lines must have had comment lines read in
 * it. A scanner that is silent when it cannot see is worse than no scanner, because its
 * green is indistinguishable from a clean tree.
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
 * One line of comment text, appended if the line already carried one.
 *
 * A collision is rare but real: the closing line of a block comment can carry a trailing
 * `//` after it. Overwriting would silently drop one of the two.
 */
const addLine = (lines: Map<number, string>, line: number, text: string): void => {
    const bare = text.trim()
    if (bare === '') {
        return
    }
    const existing = lines.get(line)
    lines.set(line, existing === undefined ? bare : `${existing} ${bare}`)
}

const stripCommentMarkup = (lineText: string): string =>
    lineText.replace(/^\s*(?:\/\*\*?|\*\/|\*|\/\/)\s?/, '').replace(/\*\/\s*$/, '').trim()

/**
 * Every comment LINE of a TypeScript file, keyed by 1-based line number.
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
 * planted at line 65 went through unseen.
 *
 * **LEADING and TRAILING, and that second half was the next hole.** The first fix read
 * only `getLeadingCommentRanges`, which by construction never returns a comment that
 * sits on the same line as code. The module header claimed "every comment is leading
 * trivia of some token" — it is not: a trailing `//` after a statement is trivia of the
 * NEXT token only if a newline follows before any code, and `getLeadingCommentRanges`
 * skips it either way. Measured over eight real files: 139 of 5117 comment lines
 * invisible, 32 of them German by this scanner's own detector. `_dmNames: {}, // dieser
 * Kommentar ist deutsch` came through green while the same sentence on its own line went
 * red.
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
            addLine(lines, firstLine + offset + 1, stripCommentMarkup(lineText))
        })
    }

    const walk = (node: ts.Node): void => {
        for (const range of ts.getLeadingCommentRanges(source, node.pos) ?? []) {
            take(range)
        }
        // The other half. `node.end` is where the token ends; whatever comment follows it
        // on the same line is trailing trivia and is invisible to the call above.
        for (const range of ts.getTrailingCommentRanges(source, node.end) ?? []) {
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
 * String literals of a PHP line, blanked out but the same length.
 *
 * Length-preserving so the index of a comment opener found afterwards still points at the
 * right place in the ORIGINAL line. Single and double quotes only; heredoc bodies are the
 * documented gap.
 */
export const maskPhpStrings = (lineText: string): string => {
    const out = lineText.split('')
    let quote: string | null = null
    for (let i = 0; i < out.length; i++) {
        const character = out[i]
        if (quote === null) {
            if (character === '"' || character === "'") {
                quote = character
            }
            continue
        }
        if (character === '\\') {
            out[i] = ' '
            if (i + 1 < out.length) {
                out[i + 1] = ' '
                i++
            }
            continue
        }
        if (character === quote) {
            quote = null
            continue
        }
        out[i] = ' '
    }

    return out.join('')
}

/**
 * Every comment LINE of a PHP or Blade file.
 *
 * A line scanner, deliberately — see the module header for what that buys and what it
 * costs. Three states, and the third one is what keeps Blade honest:
 *
 *  · inside `{{-- … --}}` — a Blade comment, valid anywhere in the file;
 *  · inside a C-style block comment;
 *  · **inside a PHP region or not.** A plain `.php` file is PHP from the start. A
 *    `.blade.php` file is markup until `<?php` or `@php`, and `//` `#` `/*` are read as
 *    comment openers ONLY there. Without that distinction a bare `https://…` in the
 *    markup would become a comment, and an `#[Layout(…)]` attribute would become one too.
 */
export const phpCommentLines = (source: string, file: string): Map<number, string> => {
    const lines = new Map<number, string>()
    const isBlade = file.endsWith('.blade.php')
    let inBlade = false
    let inBlock = false
    let inPhp = !isBlade

    source.split('\n').forEach((raw, index) => {
        const number = index + 1
        let rest = raw
        let consumed = 0

        while (rest !== '') {
            if (inBlade) {
                const end = rest.indexOf('--}}')
                if (end === -1) {
                    addLine(lines, number, rest)

                    return
                }
                addLine(lines, number, rest.slice(0, end))
                consumed += end + 4
                rest = rest.slice(end + 4)
                inBlade = false
                continue
            }
            if (inBlock) {
                const end = rest.indexOf('*/')
                if (end === -1) {
                    addLine(lines, number, stripCommentMarkup(rest))

                    return
                }
                addLine(lines, number, stripCommentMarkup(rest.slice(0, end)))
                consumed += end + 2
                rest = rest.slice(end + 2)
                inBlock = false
                continue
            }

            const masked = maskPhpStrings(rest)
            const candidates: [number, 'blade' | 'block' | 'line' | 'php-open' | 'php-close'][] = []
            const push = (at: number, kind: 'blade' | 'block' | 'line' | 'php-open' | 'php-close'): void => {
                if (at !== -1) {
                    candidates.push([at, kind])
                }
            }
            push(masked.indexOf('{{--'), 'blade')
            if (isBlade) {
                const open = Math.min(
                    ...[masked.indexOf('<?php'), masked.indexOf('@php')].filter((at) => at !== -1),
                    Number.MAX_SAFE_INTEGER,
                )
                const close = Math.min(
                    ...[masked.indexOf('?>'), masked.indexOf('@endphp')].filter((at) => at !== -1),
                    Number.MAX_SAFE_INTEGER,
                )
                if (!inPhp && open !== Number.MAX_SAFE_INTEGER) {
                    push(open, 'php-open')
                }
                if (inPhp && close !== Number.MAX_SAFE_INTEGER) {
                    push(close, 'php-close')
                }
            }
            if (inPhp) {
                push(masked.indexOf('/*'), 'block')
                push(masked.indexOf('//'), 'line')
                const hash = /(?<!\$)#(?!\[)/.exec(masked)
                push(hash === null ? -1 : hash.index, 'line')
            }
            if (candidates.length === 0) {
                return
            }
            candidates.sort((a, b) => a[0] - b[0])
            const [at, kind] = candidates[0]
            if (kind === 'line') {
                addLine(lines, number, stripCommentMarkup(rest.slice(at).replace(/^#\s?/, '')))

                return
            }
            if (kind === 'php-open') {
                inPhp = true
                const skip = at + (masked.startsWith('@php', at) ? 4 : 5)
                consumed += skip
                rest = rest.slice(skip)
                continue
            }
            if (kind === 'php-close') {
                inPhp = false
                const skip = at + (masked.startsWith('@endphp', at) ? 7 : 2)
                consumed += skip
                rest = rest.slice(skip)
                continue
            }
            const opener = kind === 'blade' ? 4 : 2
            if (kind === 'blade') {
                inBlade = true
            } else {
                inBlock = true
            }
            consumed += at + opener
            rest = rest.slice(at + opener)
        }
        void consumed
    })

    return lines
}

/** Every `#` comment of an env file — the only comment syntax it has. */
export const envCommentLines = (source: string): Map<number, string> => {
    const lines = new Map<number, string>()
    source.split('\n').forEach((raw, index) => {
        const at = raw.indexOf('#')
        if (at !== -1) {
            addLine(lines, index + 1, raw.slice(at + 1))
        }
    })

    return lines
}

/** Which reader a path belongs to; `null` means the scanner is not responsible for it. */
export const readerFor = (file: string): 'ts' | 'php' | 'env' | null => {
    if (/\.(?:ts|tsx|mts|cts)$/.test(file)) {
        return 'ts'
    }
    if (/\.php$/.test(file)) {
        return 'php'
    }
    if (/(?:^|\/)\.env(?:\.[^/]+)?$/.test(file)) {
        return 'env'
    }

    return null
}

/** The comment lines of any file the scanner is responsible for. */
export const commentLinesOf = (source: string, file: string): Map<number, string> => {
    switch (readerFor(file)) {
        case 'ts':
            return commentLines(source, file)
        case 'php':
            return phpCommentLines(source, file)
        case 'env':
            return envCommentLines(source)
        default:
            return new Map()
    }
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

/**
 * Pest case names of a PHP file: `test('…')`, `it('…')`, `describe('…')`.
 *
 * By pattern and not by parser, for the reason in the module header. The pattern is
 * anchored on a word boundary and on the opening parenthesis, so `latest(…)` and
 * `$this->it(…)` do not match; a name split across lines does not match either, and that
 * is a MISS rather than a false alarm.
 */
export const phpTestNameLines = (source: string): Map<number, string> => {
    const names = new Map<number, string>()
    source.split('\n').forEach((raw, index) => {
        const match = /(?:^|[^\w$>-])(?:test|it|describe)\s*\(\s*(['"])((?:[^'"\\]|\\.)*)\1/.exec(raw)
        if (match) {
            names.set(index + 1, match[2])
        }
    })

    return names
}

/** The test names of any file the scanner is responsible for. */
export const testNamesOf = (source: string, file: string): Map<number, string> => {
    switch (readerFor(file)) {
        case 'ts':
            return testNameLines(source, file)
        case 'php':
            return phpTestNameLines(source)
        default:
            return new Map()
    }
}

/**
 * `git`, with path quoting OFF.
 *
 * `-c core.quotepath=false` is not cosmetic here, it is the second bug this file had.
 * By default git renders a non-ASCII path as `"b/resources/views/\\342\\232\\241room.blade.php"`
 * — quoted, escaped, and NOT matching a `^\\+\\+\\+ b/(.+)$` pattern. This repository names
 * its Livewire pages `⚡room.blade.php`, so from the first such file onwards every hunk
 * was attributed to the PREVIOUS file: measured on `head.blade.php`, a 90-line partial
 * was credited with added lines 330 to 543, and a German comment of the untouched stock
 * was reported as new. {@link parseDiff} handles the quoted form as well, so the flag and
 * the parser both have to fail before that can come back.
 */
const git = (root: string, args: string[]): string => {
    try {
        return execFileSync('git', ['-c', 'core.quotepath=false', '-C', root, ...args], {
            encoding: 'utf8',
            maxBuffer: 64 * 1024 * 1024,
        })
    } catch (error) {
        throw new Error(`git ${args.join(' ')} in ${root} failed: ${String(error)}`)
    }
}

/**
 * The added line numbers per file of a `git diff --unified=0` text.
 *
 * Pure, so the parsing can be calibrated against a fixture instead of against whatever
 * the working tree happens to contain — which is how the quoted-path bug above stayed
 * invisible: the numbers looked plausible and the file names were simply wrong.
 */
export const parseDiff = (diff: string): Map<string, Set<number>> => {
    const perFile = new Map<string, Set<number>>()
    let file = ''
    for (const line of diff.split('\n')) {
        // Both spellings: plain, and the quoted/escaped one git falls back to.
        const target = /^\+\+\+ (?:"b\/(.+)"|b\/(.+))$/.exec(line)
        if (target) {
            file = target[1] ?? target[2] ?? ''
            continue
        }
        if (/^--- /.test(line) || /^diff --git /.test(line)) {
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

    return perFile
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
    // A declared path that matches no tracked file is a scanner looking at nothing, and
    // `git diff -- <path>` answers that with silence rather than an error. A renamed
    // directory would otherwise turn this latch green without anybody noticing.
    for (const path of area.paths) {
        if (git(area.root, ['ls-files', '--', path]).trim() === '') {
            throw new Error(
                `${area.name}: the declared path \`${path}\` matches no tracked file — `
                    + 'the scanner is pointed at nothing.',
            )
        }
    }

    const perFile = parseDiff(git(area.root, ['diff', '--unified=0', '--no-color', mergeBase, '--', ...area.paths]))

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
    /**
     * How many lines the diff added in this area IN TOTAL, comments or not.
     *
     * The denominator of the only floor that can honestly be asserted. A bare
     * `examined > 0` is wrong on `master`, where an empty diff is the correct answer; the
     * implication "this area added lines, therefore comment lines were read in it" is
     * right in both worlds — and it is what falls when the reader stops matching the
     * files the branch actually touched.
     */
    addedLineTotal: number
    /** Files of a kind this scanner is responsible for that the diff touched. */
    addedFiles: number
}

/** Walk one area and report every added German comment line and test name. */
export const scanArea = (area: Area, base: string): Report => {
    const perFile = addedLines(area, base)
    const findings: Finding[] = []
    let examined = 0
    let files = 0
    let addedLineTotal = 0
    let addedFiles = 0

    for (const [file, lines] of perFile) {
        if (readerFor(file) === null) {
            continue
        }
        const absolute = join(area.root, file)
        if (!existsSync(absolute)) {
            continue // deleted on this branch — nothing of it is on screen any more
        }
        addedFiles++
        addedLineTotal += lines.size
        const source = readFileSync(absolute, 'utf8')
        const candidates: [number, string, Finding['kind']][] = [
            ...[...commentLinesOf(source, file)].map(
                ([line, text]) => [line, text, 'comment'] as [number, string, Finding['kind']],
            ),
            ...[...testNamesOf(source, file)].map(
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

    return { findings, examined, files, addedLineTotal, addedFiles }
}

/** All comment lines of a file on disk — the corpus of the calibration cases. */
export const commentsOf = (absolutePath: string): string[] =>
    [...commentLinesOf(readFileSync(absolutePath, 'utf8'), absolutePath).values()]

/**
 * The comment lines of a file grouped into BLOCKS — a run of consecutive comment lines.
 *
 * The unit that matters for the sensitivity question. A per-line rate understates what
 * the latch does, because a docblock is caught as soon as ONE of its lines carries two
 * markers, and it is caught for the author at the moment they read the failure.
 */
export const commentBlocksOf = (absolutePath: string): string[][] => {
    const source = readFileSync(absolutePath, 'utf8')
    const lines = [...commentLinesOf(source, absolutePath)].sort((a, b) => a[0] - b[0])
    const blocks: string[][] = []
    let previous = -10
    for (const [line, text] of lines) {
        if (line !== previous + 1) {
            blocks.push([])
        }
        blocks[blocks.length - 1].push(text)
        previous = line
    }

    return blocks
}
