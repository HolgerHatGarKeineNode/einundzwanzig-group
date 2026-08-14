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
 *     `{{-- … --}}`-Kommentare heraus, wie Blade sie auch zur Laufzeit fallen
 *     lässt.
 *   - Erfasst werden `__(…)` und `trans(…)`. `@lang`/`Lang::get` kommen im
 *     Bestand nicht vor (geprüft per grep über alle .php).
 *   - Nur literale erste Argumente zählen. Dynamische (`__($x)`) und
 *     verkettete (`__('In ') . $x`) Argumente werden getrennt gemeldet, nicht
 *     still verschluckt: die Verkettung ist die Fehlerklasse, die P3 des
 *     Restposten-Plans abgestellt hat.
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
     * @var list<string>
     */
    public const SCAN_ROOTS = [
        'packages/einundzwanzig-group/resources',
        'packages/einundzwanzig-group/src',
        'packages/einundzwanzig-group/config',
        'packages/einundzwanzig-group/routes',
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
     * Sammelt alle `.php`-Dateien der Scan-Wurzeln, relativ zur Repo-Wurzel.
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
                if ($file->isFile() && str_ends_with($file->getFilename(), '.php')) {
                    $files[] = str_replace($this->root.'/', '', $file->getPathname());
                }
            }
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
