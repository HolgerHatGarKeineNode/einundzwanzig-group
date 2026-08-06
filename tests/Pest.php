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
| `.gitignore` ausgeschlossen (`/packages/einundzwanzig-group`, s. dort).
| TIAs EIGENE Änderungserkennung läuft komplett über `git status`/`git diff`
| des äußeren Repos — eine geänderte Datei dort taucht dort NIE auf
| (verifiziert via `git check-ignore`), und würde daher JEDES `watch()`-Muster
| dafür wirkungslos machen, unabhängig vom Glob. Ein eigenes `watch()` löst
| das deshalb NICHT. Der Umgang damit steht im Block direkt darunter — kurz:
| TIA läuft nur noch auf ausdrückliche Anforderung, dann kann es den blinden
| Fleck auch nicht mehr unbemerkt ausnutzen.
|
| WAS `always()->locally()` GETAN HÄTTE, und warum es weg ist: die beiden
| greifen bei JEDEM lokalen Pest-Aufruf, nicht nur bei explizitem `--tia` —
| auch ein nackter `php artisan test` oder `vendor/bin/pest` ohne jedes Flag
| lief damit im TIA-Modus (verifiziert: `php artisan test --compact` meldete
| auf einem zum Graph passenden Baum „No affected tests found." statt die
| Suite zu fahren — 0 Tests, exit 0, sieht wie ein bestandener Lauf aus). Der
| einzige Ausweg daraus war ein explizites `--ci` (Umgebung wird dann
| `Environment::CI`, s. `Plugins/Tia.php::handleArguments()` — dort der
| `$alwaysEnabled`-Ausdruck mit `Environment::name() === Environment::LOCAL`;
| das gleichnamig aussehende `isEnabledForRun()` bedient die Coverage-
| Restarter und ist NICHT die Stelle für diesen Split) oder `--no-tia`.
| `composer test` trägt sein `--ci` deshalb weiterhin — schadet nicht und
| bleibt richtig, falls jemand `always()` je wieder einschaltet.
|
| Ohne die beiden ist TIA jetzt nur noch über ein ausdrückliches `--tia` an;
| `filtered()` und `watch()` schalten es NICHT ein (`Plugins/Tia/
| Configuration.php`: nur `always()` und `locally()` rufen `markEnabled()`).
| Wer absichtlich nur die betroffenen Tests will, nutzt `composer test:tia`;
| jeder andere Lauf fährt die volle Suite — 143 Tests in rund fünf Sekunden.
|
| `composer ci:check` gab es einmal (delegierte an `test`), wurde aber von
| nichts aufgerufen — kein `.github/workflows/`, keine andere Stelle im Repo;
| ausschließlich lokale Läufe. Entfernt, kein CI-Ersatz nötig.
|
*/
/*
|--------------------------------------------------------------------------
| TIA + Sub-Repo (packages/einundzwanzig-group) — warum TIA nicht mehr
| implizit läuft
|--------------------------------------------------------------------------
|
| TIAs Änderungserkennung läuft ausschließlich über `git status`/`git diff`
| des ÄUSSEREN Repos (`ChangedFiles::workingTreeChanges()`, vendor/pestphp/
| pest/src/Plugins/Tia/ChangedFiles.php). Das Sub-Repo ist per `.gitignore`
| (`/packages/einundzwanzig-group`) ein ausgeschlossener Pfad — eine Änderung
| dort taucht in `git status` des äußeren Repos NIE auf, egal ob uncommitted
| oder frisch committed. Ergebnis (live gemessen): `php artisan test --compact`
| meldete „INFO No affected tests found." — 0 Tests, Exit 0, sieht wie ein
| bestandener Lauf aus, obwohl keine einzige Assertion lief.
|
| HIER STAND EIN MECHANISMUS, DER DAS ABDICHTEN SOLLTE. Er ist entfernt, und
| die Begründung gehört an genau diese Stelle, damit ihn niemand gutgemeint
| wieder baut.
|
| Der Ersatz war ein Fingerabdruck des Sub-Repos (HEAD-SHA + Diff + Hashes
| untrackter Dateien) gegen einen Marker, plus drei PHPUnit-Event-Subscriber,
| die den Marker nur nach einem grünen Lauf schreiben sollten. Über vier
| Runden fanden sich SIEBEN Wege, auf denen er einen ungeprüften Stand als
| „geprüft" beglaubigte — jeder still, jeder mit Exit 0. Die letzten vier fand
| ein Security-Audit: ein einzelnes Ctrl-C (PHPUnit feuert `TestRunner\
| Finished` beim ERSTEN SIGINT ganz normal weiter, Exit 0 bei 23 von 143
| Tests) · jeder umfangsbeschränkte Lauf (`--filter`, `--group`, ein
| Pfad-Argument — zwei bestandene Tests beglaubigten den ganzen Stand) · ein
| Filter ohne Treffer (null Tests, Exit 1, quittiert trotzdem) · ein Fehler in
| `afterAll()` (Exit 2, quittiert trotzdem).
|
| Die zwei Hälften des Problems sind ungleich: der AUSGANG eines Laufs wäre
| exakt bestimmbar (`TestResult\Facade::result()->wasSuccessful()` statt einer
| Aufzählung von Event-Typen — die deckte 2 von 7 Quellen ab). Der UMFANG
| dagegen hat kein Signal: `TestSuite\Filtered` feuert nicht bei einem
| Pfad-Argument und nicht bei `--testsuite`. Fail-closed ginge nur über eine
| Whitelist auf `argv` — und dann schriebe nur noch der eine kanonische
| Volllauf den Marker.
|
| Dagegen steht die gemessene Ersparnis: die volle Suite sind 143 Tests in
| RUND FÜNF SEKUNDEN, der TIA-Leerlauf kostet knapp eine. Der ganze Apparat
| kaufte also ~4 Sekunden — für sieben stille Falsch-Negative und einen
| Docblock, der an dieser Stelle in drei von vier Fassungen etwas Falsches
| zusicherte.
|
| Deshalb jetzt der einfache Weg: `always()` und `locally()` sind die einzigen
| Methoden, die TIA implizit einschalten (`Plugins/Tia/Configuration.php`);
| `filtered()` und `watch()` tun es nicht. Ohne sie läuft TIA nur noch bei
| explizitem `--tia` — `composer test:tia` funktioniert unverändert, jeder
| andere Lauf fährt die volle Suite. Der blinde Fleck verschwindet nicht,
| weil er abgedichtet wurde, sondern weil das implizite TIA weg ist, das ihn
| erst gefährlich machte.
|
| Wer den Mechanismus wieder bauen will, braucht vorher eine Antwort auf die
| Frage, an der er gescheitert ist: woran erkennt ein Marker, dass der Lauf,
| der ihn schreibt, den Stand VOLLSTÄNDIG geprüft hat? Solange PHPUnit dafür
| kein Signal liefert, ist jede Antwort eine Schätzung — und eine Schätzung,
| die zu großzügig ausfällt, sieht aus wie eine bestandene Suite.
|
*/
pest()->tia()
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
