<?php

use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/*
|--------------------------------------------------------------------------
| Test Case
|--------------------------------------------------------------------------
|
| The closure you provide to your test functions is always bound to a specific PHPUnit test
| case class. By default, that class is "PHPUnit\Framework\TestCase". Of course, you may
| need to change it using the "pest()" function to bind different classes or traits.
|
*/

pest()->extend(TestCase::class)
 // ->use(RefreshDatabase::class)
    ->in('Feature');

/*
|--------------------------------------------------------------------------
| Browser-Tests (Pest v4) — Host-Chromium statt Download
|--------------------------------------------------------------------------
|
| Pest-Browsertests laufen auf Playwright. Statt per `npx playwright install`
| ~150 MB Chromium herunterzuladen, nutzen wir das Host-Chromium (/bin/chromium)
| — wie die bestehende Playwright-E2E-Config. Da das Plugin keinen executablePath-
| Hook bietet, zeigen wir Playwrights projekt-lokale Browser-Registry per Symlink
| auf das Host-Binary. `ensureHostChromium()` ist idempotent und läuft vor jedem
| Browser-Test; die Server-Subprozesse erben `PLAYWRIGHT_BROWSERS_PATH` via env.
|
*/
pest()->extend(TestCase::class)
    ->beforeEach(fn () => ensureHostChromium())
    ->in('Browser');

/*
|--------------------------------------------------------------------------
| Expectations
|--------------------------------------------------------------------------
|
| When you're writing tests, you often need to check that values meet certain conditions. The
| "expect()" function gives you access to a set of "expectations" methods that you can use
| to assert different things. Of course, you may extend the Expectation API at any time.
|
*/

expect()->extend('toBeOne', function () {
    return $this->toBe(1);
});

/*
|--------------------------------------------------------------------------
| Functions
|--------------------------------------------------------------------------
|
| While Pest is very powerful out-of-the-box, you may have some testing code specific to your
| project that you don't want to repeat in every file. Here you can also expose helpers as
| global functions to help you to reduce the number of lines of code in your test files.
|
*/

function something()
{
    // ..
}

/**
 * Verweist Playwrights Browser-Registry auf das Host-Chromium (kein Download).
 *
 * Legt einen projekt-lokalen `PLAYWRIGHT_BROWSERS_PATH` an und symlinkt die von
 * Playwright erwarteten Executable-Pfade (Revision aus `playwright-core/browsers.json`)
 * auf `/bin/chromium`. Idempotent: existiert der Symlink bereits, passiert nichts.
 * Setzt die env-Var in den PHP-Prozess, damit der `playwright run-server`-
 * Subprozess (Symfony Process erbt env) dieselbe Registry nutzt.
 */
function ensureHostChromium(): void
{
    $hostChromium = '/bin/chromium';
    if (! is_executable($hostChromium)) {
        throw new RuntimeException("Host-Chromium nicht gefunden unter {$hostChromium}. Pfad in tests/Pest.php anpassen.");
    }

    $browsersPath = __DIR__.'/Browser/browsers';

    // env für diesen Prozess UND geerbte Subprozesse (Playwright-Server) setzen.
    putenv("PLAYWRIGHT_BROWSERS_PATH={$browsersPath}");
    $_ENV['PLAYWRIGHT_BROWSERS_PATH'] = $browsersPath;
    $_SERVER['PLAYWRIGHT_BROWSERS_PATH'] = $browsersPath;

    // Chromium-Revisionen aus dem installierten playwright-core lesen (versionsfest).
    $manifest = json_decode((string) file_get_contents(__DIR__.'/../node_modules/playwright-core/browsers.json'), true);
    $revision = static fn (string $name): string => (string) collect($manifest['browsers'])
        ->firstWhere('name', $name)['revision'];

    // Von Playwright erwartete Browser (Linux-x64-Layout): Verzeichnis je Revision
    // plus relativer Executable-Pfad, der auf das Host-Binary zeigt.
    $browsers = [
        [
            'dir' => "chromium-{$revision('chromium')}",
            'executable' => 'chrome-linux64/chrome',
        ],
        [
            'dir' => "chromium_headless_shell-{$revision('chromium-headless-shell')}",
            'executable' => 'chrome-headless-shell-linux64/chrome-headless-shell',
        ],
    ];

    foreach ($browsers as $browser) {
        $dir = "{$browsersPath}/{$browser['dir']}";

        // Executable-Pfad → Host-Binary symlinken.
        $executable = "{$dir}/{$browser['executable']}";
        if (! is_link($executable) && ! is_file($executable)) {
            if (! is_dir(dirname($executable))) {
                mkdir(dirname($executable), 0755, true);
            }
            symlink($hostChromium, $executable);
        }

        // Playwright akzeptiert das Browser-Verzeichnis nur mit Installations-Marker.
        $marker = "{$dir}/INSTALLATION_COMPLETE";
        if (is_dir($dir) && ! is_file($marker)) {
            touch($marker);
        }
    }
}
