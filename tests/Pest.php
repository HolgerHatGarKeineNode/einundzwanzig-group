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
| Test Impact Analysis (TIA) — nur betroffene Tests wirklich ausführen
|--------------------------------------------------------------------------
|
| TIA zeichnet coverage-basiert auf, welche Datei welchen Test berührt, und
| spielt bei unveränderten Abhängigkeiten das zwischengespeicherte Ergebnis
| zurück statt den Test erneut laufen zu lassen. `always()` schaltet TIA
| grundsätzlich zu; `locally()` erzwingt zusätzlich, dass reine `--ci`-Läufe
| TIA ignorieren (kein Baseline-Sharing nötig). `baselined()` bleibt bewusst
| weg — es gibt keine CI-Baseline (`.github/workflows/` existiert nicht),
| das ist offene Frage einer späteren Phase. `filtered()` ist HIER unbedingt
| gesetzt (nicht nur bei `--filtered` auf der CLI) — jeder TIA-Lauf sammelt
| dadurch von vornherein nur die betroffenen Testdateien ein, statt alle zu
| sammeln und den Rest laufen zu lassen, aber übersprungen zu melden. Ohne
| jede Änderung heißt das: „INFO No affected tests found." und 0 Tests laufen
| (verifiziert, exit 0 — kein Fehlerfall).
|
| Zusätzliche `watch()`-Muster nur für das, was `useDefaults()` NICHT bereits
| abdeckt (siehe vendor/pestphp/pest/src/Plugins/Tia/WatchDefaults/{Php,
| Laravel,Livewire}.php): `config/**` ist dort nur für Symfony-Apps hinterlegt
| und schließt dort ohnehin `*.php` aus — unsere `config/group.php` fällt
| komplett durch (verifiziert: eine echte Änderung an `config/group.php`
| markiert genau die 25 Tests unter `tests/Feature` als betroffen, die beim
| Aufzeichnen der Baseline liefen). `resources/views/**` ist dagegen bereits
| durch die Laravel-Defaults auf das gesamte `tests`-Verzeichnis gemappt
| (breiter als `tests/Browser` allein) — ein eigenes `watch()` dafür wäre
| wirkungslose Doppelung und bleibt deshalb weg.
|
| ABSICHTLICH NICHT gewatcht: `packages/einundzwanzig-group/src` (rekursiv,
| alle `*.php`-Dateien darin). Das Package ist eigenes Git-Repo und in
| `.gitignore` ausgeschlossen
| (`/packages/einundzwanzig-group`, s. dort). TIAs Änderungserkennung läuft
| komplett über `git status`/`git diff` des äußeren Repos — eine geänderte
| Datei dort taucht in `git status --porcelain` nie auf (verifiziert via
| `git check-ignore`), und würde daher JEDES `watch()`-Muster dafür wirkungslos
| machen, unabhängig vom Glob. Änderungen am Package-Code bleiben TIA also
| unsichtbar; wer dort etwas ändert, muss die betroffenen Feature-Tests von
| Hand laufen lassen oder TIA für den Lauf mit `--no-tia` umgehen.
|
| FALLE — `always()->locally()` greift bei JEDEM lokalen Pest-Aufruf, nicht
| nur bei explizitem `--tia`: auch ein nackter `php artisan test` oder
| `vendor/bin/pest` ohne jedes Flag läuft lokal automatisch im TIA-Modus
| (verifiziert: `php artisan test --compact` meldete auf einem zum Graph
| passenden Baum „No affected tests found." statt die Suite zu fahren — 0
| Tests, exit 0, sieht wie ein bestandener Lauf aus). Der einzige Ausweg aus
| `locally()` ist ein explizites `--ci` auf der Kommandozeile (Umgebung wird
| dann `Environment::CI`, s. `Plugins/Tia.php::handleArguments()` — dort der
| `$alwaysEnabled`-Ausdruck mit `Environment::name() === Environment::LOCAL`;
| das gleichnamig aussehende `isEnabledForRun()` bedient die Coverage-
| Restarter und ist NICHT die Stelle für diesen Split); `--no-tia`
| schaltet TIA unabhängig davon komplett ab. Deshalb trägt `composer test`
| das `--ci`-Flag explizit an `php artisan test` — die volle Suite soll
| laufen, kein TIA. `composer ci:check` gab es einmal (delegierte an `test`),
| wurde aber von nichts aufgerufen — kein `.github/workflows/`, keine andere
| Stelle im Repo; ausschließlich lokale Läufe. Entfernt, kein CI-Ersatz nötig.
| Wer absichtlich nur die betroffenen Tests will, nutzt `composer test:tia`.
|
*/
pest()->tia()
    ->always()
    ->locally()
    ->filtered()
    ->watch([
        'config/group.php' => 'tests/Feature',
    ]);

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

/**
 * Liest die von playwright-core mitgelieferte Browser-Registry typisiert ein.
 * `json_decode(..., true)` ist generisch `mixed` getypt — `collect()` kann daraus
 * keine Template-Typen auflösen. Die Shape spiegelt nur die Felder, die
 * `ensureHostChromium()` tatsächlich braucht (name, revision); die Datei trägt
 * daneben noch installByDefault/browserVersion/title, die hier ungenutzt bleiben.
 *
 * @return list<array{name: string, revision: string}>
 */
function playwrightManifestBrowsers(): array
{
    $manifest = json_decode((string) file_get_contents(__DIR__.'/../node_modules/playwright-core/browsers.json'), true);

    return $manifest['browsers'];
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
    $manifestBrowsers = playwrightManifestBrowsers();
    $revision = static fn (string $name): string => (string) collect($manifestBrowsers)
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
