<?php

declare(strict_types=1);

namespace App\Support;

use FilesystemIterator;
use Illuminate\Support\Facades\Blade;
use JsonException;
use RecursiveDirectoryIterator;
use RecursiveIteratorIterator;
use RuntimeException;

/**
 * Vollständigkeits-Scanner für die Übersetzungskataloge: welche im Code
 * gerufenen `__()`/`trans()`-Schlüssel fehlen in den sieben Sprachdateien?
 *
 * HERKUNFT UND WARUM DIE KLASSE HIER LIEGT: Der Messkern stammt aus
 * `docs/plans/done/2026-08-09T1513-ux-und-nostr-standardfunktionen/p4-i18n-scan.php`
 * — einem Standalone-Skript im Artefaktordner seines Plans. Es zählte seine
 * Wurzel mit `dirname(__DIR__, 3)` hoch und brach, als der Plan nach `done/`
 * wanderte. Es brach LAUT; hätte es nur eine leere Fundliste geliefert, wäre
 * daraus ein „0 fehlende Schlüssel" geworden — also genau die Zusage, die es
 * bewachen soll. Ein Prüfskript, das seinen eigenen Ort mitzählt, ist ein Gate
 * mit Verfallsdatum. Deshalb zählt hier nichts mehr: die Wurzel kommt von
 * `base_path()`, die Klasse findet Laravel über den Namespace. Wer sie
 * verschiebt, ohne den Namespace anzupassen, bekommt einen „Class not found"
 * — laut, nicht leer. Das historische Skript bleibt als Beleg liegen, wo es ist.
 *
 * BAUWEISE (und warum nicht grep):
 *   - Gemessen wird über PHPs eigenen Tokenizer. Ein `__()` in einem
 *     PHP-Kommentar ist ein T_COMMENT/T_DOC_COMMENT-Token und taucht als
 *     Aufruf gar nicht erst auf.
 *   - Blade-Dateien werden mit `Blade::compileString()` IM SPEICHER kompiliert,
 *     nie aus `storage/framework/views/` gelesen. Damit fallen
 *     `{{-- … --}}`-Kommentare heraus, wie Blade sie zur Laufzeit fallen
 *     lässt.
 *   - Erfasst werden `__(…)` und `trans(…)`. `@lang`/`Lang::get` kommen im
 *     Bestand nicht vor (geprüft per grep über alle .php).
 *   - Nur literale erste Argumente zählen. Dynamische (`__($x)`) und
 *     verkettete (`__('In ') . $x`) Argumente werden getrennt gemeldet, nicht
 *     still verschluckt: die Verkettung ist die Fehlerklasse, die P3 des
 *     Restposten-Plans abgestellt hat.
 *   - Die TypeScript-Insel (`packages/einundzwanzig-group/js`) hat keinen
 *     PHP-Tokenizer. Dort hebt eine kleine Zustandsmaschine zuerst `//`- und
 *     Block-Kommentare heraus heraus (Strings bleiben stehen, Zeilennummern
 *     bleiben stimmen) und ein Parser liest danach nur `t(…)`-Aufrufe mit
 *     Wortanfang — `.split(`, `x.t(` oder `tPlural(` sind keine. Ausgeschlossen
 *     sind `*.test.ts` (sie rufen `t()` mit absichtlich fehlenden Schlüsseln
 *     und prüfen damit die RÜCKFALL-Mechanik — sie sind keine Aufrufstelle)
 *     und `*.d.ts` (Typdeklarationen ohne Laufzeitcode). Kein Filter auf den
 *     i18n-Import: im Bestand ruft kein `t(` außerhalb des Imports (gemessen);
 *     eine künftige fremde `t()` fiele als fehlender Schlüssel LAUT auf,
 *     nicht still.
 *
 * STILLE FEHLSCHLÄGE SIND HIER BLOCKER: fehlt eine Scan-Wurzel, das
 * Sprachverzeichnis oder eine einzelne Sprachdatei, wirft der Scanner mit
 * Klartext. Ein Scanner, der weniger sieht als er soll, meldet sonst ebenfalls
 * „0 fehlend" — dieselbe Falschmeldung, nur eine Ebene höher.
 */
final class I18nScanner
{
    /**
     * Verzeichnisse (relativ zur Repo-Wurzel), die nach Aufrufen durchsucht werden.
     * Jedes MUSS existieren — ein stillschweigend übersprungenes Verzeichnis
     * senkt die Fundmenge, ohne dass irgendetwas rot wird.
     *
     * Die letzte Wurzel ist die TypeScript-Insel (`t()` aus `js/i18n.ts`): dieselbe
     * Fehlerklasse wie `__()`, eine Sprachwelt weiter — ein `t('…')` ohne
     * Katalogeintrag fiele sonst STILL auf Deutsch zurück (P10, Punkt 1).
     *
     * @var list<string>
     */
    public const SCAN_ROOTS = [
        'packages/einundzwanzig-group/resources',
        'packages/einundzwanzig-group/src',
        'packages/einundzwanzig-group/config',
        'packages/einundzwanzig-group/routes',
        'packages/einundzwanzig-group/js',
        'app',
        'resources',
        'routes',
        'config',
        'database',
    ];

    /**
     * Die sieben ausgelieferten Sprachen. Deutsch hat bewusst keine Datei —
     * es ist die Quellsprache, der Schlüssel selbst ist der deutsche Text.
     *
     * @var list<string>
     */
    public const LOCALES = ['en', 'es', 'hu', 'lv', 'nl', 'pl', 'pt'];

    public const LANG_DIR = 'packages/einundzwanzig-group/lang';

    /** Tokens, die zwischen Funktionsnamen und Argument erlaubt sind. */
    private const SKIP_TOKENS = [T_WHITESPACE, T_COMMENT, T_DOC_COMMENT];

    private readonly string $root;

    public function __construct(?string $root = null)
    {
        $this->root = rtrim($root ?? base_path(), '/');
    }

    /**
     * Fährt die Messung einmal komplett.
     *
     * @return array{
     *     files: list<string>,
     *     keys: list<string>,
     *     calls: array<string, list<string>>,
     *     missing: array<string, list<string>>,
     *     dynamic: list<string>,
     *     chained: list<string>,
     *     catalogs: array<string, array<string, string>>
     * }
     */
    public function scan(): array
    {
        $files = $this->collectFiles();

        /** @var array<string, list<string>> $calls key => Fundstellen */
        $calls = [];
        /** @var list<string> $dynamic */
        $dynamic = [];
        /** @var list<string> $chained */
        $chained = [];

        foreach ($files as $rel) {
            $this->scanFile($rel, $calls, $dynamic, $chained);
        }

        $keys = array_keys($calls);
        sort($keys, SORT_STRING);

        $catalogs = $this->loadCatalogs();

        /** @var array<string, list<string>> $missing key => Sprachen, in denen er fehlt */
        $missing = [];
        foreach ($keys as $key) {
            $absent = [];
            foreach (self::LOCALES as $locale) {
                if (! array_key_exists($key, $catalogs[$locale])) {
                    $absent[] = $locale;
                }
            }
            if ($absent !== []) {
                $missing[$key] = $absent;
            }
        }

        return [
            'files' => $files,
            'keys' => $keys,
            'calls' => $calls,
            'missing' => $missing,
            'dynamic' => $dynamic,
            'chained' => $chained,
            'catalogs' => $catalogs,
        ];
    }

    /**
     * Sammelt alle `.php`-Dateien der Scan-Wurzeln sowie die `.ts`-Dateien der
     * TypeScript-Insel, relativ zur Repo-Wurzel.
     *
     * `.test.ts` und `.d.ts` sind ausgenommen (Begründung im Klassen-Docblock):
     * Test-Dateien prüfen die Rückfall-Mechanik mit absichtlich fehlenden
     * Schlüsseln, `.d.ts` tragen keine Laufzeitaufrufe. Eine Wurzel, die
     * NUR ausgeschlossene Dateien enthält, ist kein Fehler — `src`/`config`
     * der Insel liegen ohnehin in eigenen Wurzeln.
     *
     * @return list<string>
     */
    public function collectFiles(): array
    {
        /** @var list<string> $files */
        $files = [];

        foreach (self::SCAN_ROOTS as $relRoot) {
            $dir = $this->root.'/'.$relRoot;
            if (! is_dir($dir)) {
                throw new RuntimeException(
                    "i18n-Scan: Scan-Wurzel '{$relRoot}' fehlt unter {$this->root}. ".
                    'Ohne sie misst der Scan zu wenig und meldet trotzdem „0 fehlend" — Abbruch statt stiller Null.'
                );
            }

            $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($dir, FilesystemIterator::SKIP_DOTS));
            foreach ($it as $file) {
                if (! $file->isFile()) {
                    continue;
                }
                $name = $file->getFilename();
                $rel = str_replace($this->root.'/', '', $file->getPathname());

                if (str_ends_with($name, '.php')) {
                    $files[] = $rel;

                    continue;
                }

                if (str_ends_with($name, '.ts') && ! str_ends_with($name, '.test.ts') && ! str_ends_with($name, '.d.ts')) {
                    $files[] = $rel;
                }
            }
        }

        $dupes = array_diff_key($files, array_unique($files));
        if ($dupes !== []) {
            // Kann nur passieren, wenn SCAN_ROOTS sich überlappen — die Fund-
            // stellen würden doppelt zählen und die Dateizahl LÜGEN.
            throw new RuntimeException('i18n-Scan: SCAN_ROOTS überlappen, doppelt gesammelt: '.reset($dupes));
        }

        sort($files);

        return $files;
    }

    /**
     * Liest die sieben Kataloge. Jede Datei MUSS existieren und valides
     * JSON-Objekt sein — sonst Abbruch mit Klartext.
     *
     * @return array<string, array<string, string>>
     */
    public function loadCatalogs(): array
    {
        $langDir = $this->root.'/'.self::LANG_DIR;
        if (! is_dir($langDir)) {
            throw new RuntimeException("i18n-Scan: Sprachverzeichnis {$langDir} fehlt.");
        }

        $catalogs = [];
        foreach (self::LOCALES as $locale) {
            $path = $langDir.'/'.$locale.'.json';
            if (! is_file($path)) {
                throw new RuntimeException("i18n-Scan: Sprachdatei {$path} fehlt.");
            }

            try {
                $data = json_decode((string) file_get_contents($path), true, 512, JSON_THROW_ON_ERROR);
            } catch (JsonException $e) {
                throw new RuntimeException("i18n-Scan: {$path} ist kein gültiges JSON: {$e->getMessage()}", previous: $e);
            }

            if (! is_array($data)) {
                throw new RuntimeException("i18n-Scan: {$path} enthält kein JSON-Objekt.");
            }

            /** @var array<string, string> $data */
            $catalogs[$locale] = $data;
        }

        return $catalogs;
    }

    /**
     * @param  array<string, list<string>>  $calls
     * @param  list<string>  $dynamic
     * @param  list<string>  $chained
     */
    private function scanFile(string $rel, array &$calls, array &$dynamic, array &$chained): void
    {
        $path = $this->root.'/'.$rel;
        $src = (string) file_get_contents($path);

        if (str_ends_with($path, '.ts')) {
            $this->scanTsFile($rel, $src, $calls, $dynamic, $chained);

            return;
        }

        $isBlade = str_ends_with($path, '.blade.php');
        $code = $isBlade ? Blade::compileString($src) : $src;
        // Blades kompilierte Zeilennummern decken sich NICHT mit denen der Quelle
        // (der Compiler zieht Direktiven zusammen). Für die Fundstelle wird die
        // Zeile deshalb im QUELLTEXT gesucht — die Datei bleibt in jedem Fall richtig.
        $srcLines = $isBlade ? explode("\n", $src) : null;

        $tokens = @token_get_all($code);
        $n = count($tokens);

        for ($i = 0; $i < $n; $i++) {
            $token = $tokens[$i];
            if (! is_array($token)) {
                continue;
            }

            if ($token[0] !== T_STRING || ! in_array($token[1], ['__', 'trans'], true)) {
                continue;
            }

            // Kein Methodenaufruf ->__() und keine Deklaration `function __(`.
            $before = $i - 1;
            while ($before >= 0 && is_array($tokens[$before]) && in_array($tokens[$before][0], self::SKIP_TOKENS, true)) {
                $before--;
            }
            if ($before >= 0 && is_array($tokens[$before]) && in_array($tokens[$before][0], [T_OBJECT_OPERATOR, T_DOUBLE_COLON, T_FUNCTION, T_NEW], true)) {
                continue;
            }

            $j = $i + 1;
            while ($j < $n && is_array($tokens[$j]) && in_array($tokens[$j][0], self::SKIP_TOKENS, true)) {
                $j++;
            }
            if ($j >= $n || $tokens[$j] !== '(') {
                continue;
            }
            $j++;
            while ($j < $n && is_array($tokens[$j]) && in_array($tokens[$j][0], self::SKIP_TOKENS, true)) {
                $j++;
            }
            if ($j >= $n) {
                continue;
            }

            $line = $token[2];

            if (is_array($tokens[$j]) && $tokens[$j][0] === T_CONSTANT_ENCAPSED_STRING) {
                // Folgetoken muss ',' oder ')' sein — sonst ist es Verkettung o. Ä.
                // Laravel bekommt dann genau dieses Literal NICHT als Key.
                $after = $j + 1;
                while ($after < $n && is_array($tokens[$after]) && in_array($tokens[$after][0], self::SKIP_TOKENS, true)) {
                    $after++;
                }

                if ($after < $n && ($tokens[$after] === ',' || $tokens[$after] === ')')) {
                    $key = $this->decodeLiteral($tokens[$j][1]);
                    $calls[$key][] = $rel.':'.$this->sourceLine($srcLines, $tokens[$j][1], $line);
                } else {
                    $chained[] = $rel.':'.$this->sourceLine($srcLines, $tokens[$j][1], $line).'  (verkettet) '.$tokens[$j][1];
                }

                continue;
            }

            $fragment = is_array($tokens[$j]) ? $tokens[$j][1] : (string) $tokens[$j];
            $dynamic[] = $rel.':'.$this->sourceLine($srcLines, '__('.$fragment, $line).'  (dynamisch) '.trim($fragment);
        }
    }

    /**
     * Liest die `t(…)`-Aufrufe einer Datei der TypeScript-Insel.
     *
     * Drei Klassen, exakt wie auf der PHP-Seite:
     *   - literales erstes Argument, gefolgt von `,` oder `)` → Schlüssel.
     *     (`t('…', { … })` — Ersetzungen sind zulässig und brauchen kein
     *     eigenes Klassenzeichen: der Schlüssel bleibt der deutsche Satz.)
     *   - literales Argument mit Folgetoken `+`/`.`/… → verkettet.
     *   - nicht-literales Argument (Variable, Template, Aufruf) → dynamisch.
     *
     * Dazu die Fragment-Signatur der PHP-Seite, hier über den Schlüssel selbst
     * erkennbar: ein `t('Ungelesen. ')` mit Rand-Leerzeichen ist der rechte
     * Teil einer Konkatenation, die außerhalb des Aufrufs steht — der Scanner
     * kann die Verkettung nicht sehen, die Signatur genügt als Beweis. Solche
     * Schlüssel laufen wie PHP-Verkettungen in `$chained`, nicht in `$calls`.
     *
     * @param  array<string, list<string>>  $calls
     * @param  list<string>  $dynamic
     * @param  list<string>  $chained
     */
    private function scanTsFile(string $rel, string $src, array &$calls, array &$dynamic, array &$chained): void
    {
        $code = $this->stripTsComments($src);

        // Wortanfang vor `t(`: `.split(`, `->t(`-artige Methoden (`x.t(`) und
        // `tPlural(` sind keine i18n-Aufrufe. `$` deckt TS-Bezeichner ab.
        if (! preg_match_all('/(?<![.\w$])t\(/', $code, $hits, PREG_OFFSET_CAPTURE)) {
            return;
        }

        foreach ($hits[0] as [, $offset]) {
            $line = substr_count(substr($code, 0, $offset), "\n") + 1;

            $pos = $offset + 2;
            $pos += strspn($code, " \t\r\n", $pos);

            $quote = ($code[$pos] ?? '');

            if (($quote === "'" || $quote === '"')
                && preg_match('/\G'.preg_quote($quote, '/').'((?:[^\\\\'.preg_quote($quote, '/').']|\\\\.)*)'.preg_quote($quote, '/').'/', $code, $m, 0, $pos) === 1) {
                $after = $pos + strlen($m[0]);
                $after += strspn($code, " \t\r\n", $after);
                $next = $code[$after] ?? '';

                if ($next === ',' || $next === ')') {
                    $key = $this->decodeLiteral($m[0]);
                    if ($key !== trim($key)) {
                        $chained[] = $rel.':'.$line.'  (Fragment-Signatur) '.$m[0];
                    } else {
                        $calls[$key][] = $rel.':'.$line;
                    }
                } else {
                    $chained[] = $rel.':'.$line.'  (verkettet) '.$m[0];
                }

                continue;
            }

            $fragment = trim((string) preg_replace('/\s+/s', ' ', substr($code, $pos, 24)));
            $dynamic[] = $rel.':'.$line.'  (dynamisch) '.$fragment;
        }
    }

    /**
     * Ersetzt `//`-Zeilen- und Block-Kommentare durch Leerzeichen — gleiche
     * Länge, Zeilenumbrüche bleiben stehen, damit die Offset-basierten
     * Zeilennummern stimmen bleiben. Strings ('", `) mitsamt Escape-Sequenzen
     * bleiben unangetastet; was in Anführungszeichen steht, ist kein Kommentar.
     *
     * Restrisiko dokumentiert statt behoben: Regex-Literale mit `//`-Inhalt
     * würden als Kommentarbeginn fehlgedeutet. Im Bestand gibt es keine
     * (gemessen); der Zahlabgleich gegen die erwartete Fundmenge ginge bei
     * einem solchen Fehlgriff nach unten — laut, nicht still.
     */
    private function stripTsComments(string $src): string
    {
        $len = strlen($src);
        $out = $src;
        $state = 'code';
        $stringQuote = '';

        for ($i = 0; $i < $len; $i++) {
            $char = $src[$i];
            $next = $i + 1 < $len ? $src[$i + 1] : '';

            if ($state === 'code') {
                if ($char === "'" || $char === '"' || $char === '`') {
                    $state = 'string';
                    $stringQuote = $char;
                } elseif ($char === '/' && $next === '/') {
                    $state = 'line';
                    $out[$i] = ' ';
                } elseif ($char === '/' && $next === '*') {
                    $state = 'block';
                    $out[$i] = ' ';
                }

                continue;
            }

            if ($state === 'string') {
                if ($char === '\\') {
                    $i++; // Escape — das nächste Zeichen gehört zum String, egal was es ist.
                } elseif ($char === $stringQuote) {
                    $state = 'code';
                }

                continue;
            }

            // line / block: Kommentar-Inhalt weg, Umbrüche (line) und das
            // schließende `*` + `/` (block) beenden den Zustand.
            $out[$i] = $char === "\n" ? "\n" : ' ';
            if ($state === 'line' && $char === "\n") {
                $state = 'code';
            } elseif ($state === 'block' && $char === '*' && $next === '/') {
                $out[$i + 1] = ' ';
                $i++;
                $state = 'code';
            }
        }

        return $out;
    }

    /**
     * Sucht die Zeile im Blade-QUELLTEXT; für reines PHP bleibt die
     * Tokenizer-Zeile stehen.
     *
     * @param  list<string>|null  $srcLines
     */
    private function sourceLine(?array $srcLines, string $needle, int $fallback): int
    {
        if ($srcLines === null) {
            return $fallback;
        }

        foreach ($srcLines as $index => $text) {
            if (str_contains($text, $needle)) {
                return $index + 1;
            }
        }

        return $fallback;
    }

    private function decodeLiteral(string $literal): string
    {
        $quote = $literal[0];
        $body = substr($literal, 1, -1);

        if ($quote === "'") {
            return str_replace(['\\\\', "\\'"], ['\\', "'"], $body);
        }

        return stripcslashes($body);
    }
}
