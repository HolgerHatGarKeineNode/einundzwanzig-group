<?php

declare(strict_types=1);

use Illuminate\Support\Facades\Blade;

/**
 * Every Blade view of the shared group package must compile in a host — the hosts run
 * `php artisan optimize` (view:cache) on deploy, and one failing view aborts the whole
 * release. Measured 2026-10-22 on einundzwanzig-verein: the deploy died on
 * "Unable to locate a class or view for component [flux::icon.pin]", and behind it the
 * command palette failed with "preg_match(): Compilation failed: regular expression is
 * too large" — ten `@js()` calls inside `<flux:command.item>` attributes.
 */
$viewsDir = dirname(__DIR__, 2).'/packages/einundzwanzig-group/resources/views';

/**
 * @return list<string>
 */
function groupPackageBladeFiles(string $dir): array
{
    $files = [];

    foreach (new RecursiveIteratorIterator(new RecursiveDirectoryIterator($dir, FilesystemIterator::SKIP_DOTS)) as $file) {
        if (str_ends_with((string) $file, '.blade.php')) {
            $files[] = (string) $file;
        }
    }

    sort($files);

    return $files;
}

test('every package view compiles', function () use ($viewsDir) {
    $failures = [];

    foreach (groupPackageBladeFiles($viewsDir) as $file) {
        try {
            Blade::compileString((string) file_get_contents($file));
        } catch (Throwable $e) {
            $failures[] = str_replace($viewsDir.'/', '', $file).': '.$e->getMessage();
        }
    }

    expect($failures)->toBe([]);
});

test('no @js() directive sits inside a flux component tag', function () use ($viewsDir) {
    // Component attribute values are strings to Blade, not template text: `@js(...)` there
    // is never compiled and reaches Alpine verbatim ("Invalid or unexpected token"). Use
    // `{{ Js::from(...) }}` instead. See partials/forge-detail-suche.blade.php.
    $offenders = [];

    foreach (groupPackageBladeFiles($viewsDir) as $file) {
        // Blank out Blade comments but keep their newlines, so reported line numbers hold.
        $source = preg_replace_callback(
            '/\{\{--.*?--\}\}/s',
            fn (array $comment): string => str_repeat("\n", substr_count($comment[0], "\n")),
            (string) file_get_contents($file),
        );

        preg_match_all('/<flux:[\w.-]+(?:[^>"]|"[^"]*")*>/', $source, $tags, PREG_OFFSET_CAPTURE);

        foreach ($tags[0] as [$tag, $offset]) {
            if (str_contains($tag, '@js(')) {
                $line = substr_count(substr($source, 0, $offset), "\n") + 1;
                $offenders[] = str_replace($viewsDir.'/', '', $file).':'.$line;
            }
        }
    }

    expect($offenders)->toBe([]);
});
