<?php

use Illuminate\Foundation\Testing\RefreshDatabase;
use PHPUnit\Event\Facade;
use PHPUnit\Event\Test\Errored;
use PHPUnit\Event\Test\ErroredSubscriber;
use PHPUnit\Event\Test\Failed;
use PHPUnit\Event\Test\FailedSubscriber;
use PHPUnit\Event\TestRunner\Finished;
use PHPUnit\Event\TestRunner\FinishedSubscriber;
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
| das deshalb NICHT — der Ersatz dafür ist der eigenständige Fingerabdruck-
| Mechanismus im Block „TIA + Sub-Repo" direkt darunter: der erkennt Package-
| Änderungen unabhängig von TIAs Git-Diff und erzwingt bei Bedarf die volle
| Suite. (Eine frühere Fassung dieses Absatzes verlangte noch, Feature-Tests
| von Hand zu fahren oder `--no-tia` zu setzen — das übernimmt seither der
| Block unten automatisch; von Hand nachhelfen ist nicht mehr nötig.)
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
/*
|--------------------------------------------------------------------------
| TIA + Sub-Repo (packages/einundzwanzig-group) — der blinde Fleck
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
| Kein offizieller Erweiterungspunkt schließt das: `ChangedFiles` wird in
| `Tia.php` direkt per `new ChangedFiles($projectRoot)` gebaut, nicht über den
| Container — ein Rebind aus `tests/Pest.php` griffe nicht. Vendor patchen
| verwirft sich bei `composer update` und hat keinen Review-Pfad. Der Ersatz
| unten lebt komplett in Userland: ein inhaltsbasierter Fingerabdruck des Sub-
| Repos (HEAD-SHA + `git diff HEAD` + Inhalt untrackter Dateien — s. `tiaSub
| RepoFingerprint()`), verglichen mit dem zuletzt BEKANNTEN Fingerabdruck
| (Marker in `storage/framework/testing/`, dort bereits per `.gitignore`
| ausgenommen — `storage/framework/testing/.gitignore`). Weicht er ab (dirty
| ODER ein neuer Commit seit dem letzten Merken), bleibt TIA für GENAU DIESEN
| Lauf aus — die volle Suite läuft ungekürzt. Stimmt er überein, greift TIA wie
| gehabt (Block direkt darunter) — Änderungen NUR im äußeren Repo bleiben davon
| unberührt (siehe Gegenprobe im begleitenden Bericht).
|
| AUSFALLRICHTUNG bei kaputtem `.git`/fehlendem `git`: `tiaSubRepoFingerprint()`
| gibt `null` zurück, das zählt als „geändert" → TIA bleibt AUS, die volle
| Suite läuft. Die beiden Zustände sind NICHT symmetrisch: TIA aus kostet Zeit
| und verliert nichts, TIA an kann 0 Tests bei Exit 0 bedeuten. „Gar keine
| Tests" ist also ein Ergebnis von TIA AN, nie von TIA aus — im Zweifel lieber
| zu viel laufen lassen als zu wenig. (Korrektur 2. Fassung: die erste hatte
| das genau verkehrt herum — `null` → `false` → TIA lief an. Vom `reviewer`
| gefunden.) Ist `shell_exec` selbst deaktiviert (`disable_functions`), greift
| dieselbe Ausfallrichtung NUR, weil `tiaSubRepoFingerprint()` das explizit per
| `function_exists('shell_exec')` prüft und dann `null` liefert — OHNE diese
| Prüfung wäre der Aufruf ein `Error: Call to undefined function shell_exec()`
| (PHP entfernt die Funktion vollständig aus der Funktionstabelle, `@`
| unterdrückt das NICHT), also ein harter Absturz vor dem ersten Test statt
| „TIA aus, volle Suite" — laut/sichtbar statt still-grün, aber ein anderer
| Fall als die beiden obigen. Die Prüfung unten vereinheitlicht das bewusst.
|
| MARKER-QUITTIERUNG: der Fingerabdruck wird NICHT hier geschrieben, sondern
| erst wenn PHPUnits eigener TestRunner wirklich bis zum Ende durchgelaufen
| ist — UND der Lauf dabei GRÜN war. `PHPUnit\TextUI\TestRunner::run()` feuert
| `testRunnerFinished()` UNBEDINGT nach jedem `$suite->run()` OHNE durch-
| schlagende Exception (vendor/phpunit/phpunit/src/TextUI/TestRunner.php:64-67)
| — Testfehlschläge werfen dabei NICHT, sie werden nur gesammelt. „Bis zum
| Ende durchgelaufen" ist also NICHT „grün durchgelaufen": ein roter Lauf
| (Assertion-Fehlschlag oder Fehler in einem Test) hätte den Fingerabdruck
| genauso quittiert wie ein grüner — der nächste Lauf hätte die zwei
| Fehlschläge als „No affected tests found." mit Exit 0 kaschiert (vom
| `security-auditor` end-to-end reproduziert, B1). Deshalb zählen zwei weitere
| Subscriber (`Test\FailedSubscriber`/`Test\ErroredSubscriber`) jeden
| Fehlschlag/Fehler während des Laufs mit; die Quittierung im `Finished`-
| Handler unterbleibt, sobald einer aufgetreten ist — bei Ctrl-C, einem Fehler
| im Bootstrap, einem rausgeworfenen Worker ODER einem roten Testergebnis NIE.
| Genau der Haken, den Pest selbst für sein eigenes TIA-Graph-Schreiben nutzt
| (`BootSubscribers.php` registriert seine Subscriber über dieselbe
| `Event\Facade`). Der hier verwendete Fingerabdruck ist der zu LAUFBEGINN
| eingefrorene Wert (nicht neu berechnet beim Schreiben) — ändert sich das
| Sub-Repo WÄHREND des Laufs (Nachbar-Agent, paralleles Arbeiten), wird nicht
| fälschlich dessen NEUER, ungetesteter Stand quittiert.
|
| Einschränkung, ausdrücklich: „grün" heißt hier „keine `Test\Failed`/
| `Test\Errored`-Events" — das deckt den Exit-Code-Fall dieses Projekts (kein
| `failOnWarning`/`failOnRisky`/`stopOn*` in `phpunit.xml`, geprüft). Kämen
| solche Flags dazu, bräuchte dieser Block weitere Subscriber; sonst würde er
| wieder grün quittieren, was eigentlich nur „risky" war.
|
*/
/**
 * Inhalts-, nicht nur pfadbasiert — UND (B2, vom `security-auditor` gefunden) blind
 * gegenüber neuen untrackten VERZEICHNISSEN und gequoteten Pfaden, wenn man es falsch
 * baut. Zwei getrennte Lücken, die dieselbe Funktion treffen:
 *
 * 1) `git status --porcelain` allein listet nur, WELCHE Pfade dirty sind (Statuscode +
 *    Pfad) — ein zweiter Edit an einer bereits dirty Datei erzeugt exakt dieselbe Zeile
 *    wie der erste und wäre für den Fingerabdruck unsichtbar (selbst entdeckt beim
 *    Kalibrieren: zwei verschiedene Inhalte, identisches `git status`). Deshalb
 *    `git diff HEAD` (Inhalt aller getrackten Änderungen, staged wie unstaged) PLUS
 *    die gehashten Inhalte neuer/untracked Dateien (die `git diff` nicht zeigt).
 *
 * 2) `git status --porcelain` läuft im DEFAULT `-unormal`: ein KOMPLETT neues untracktes
 *    Verzeichnis kollabiert dort zu EINER Zeile `?? dir/`, nicht zu einer Zeile je Datei
 *    darin. `substr($line, 3)` lieferte `dir/`, `is_file()` verwarf das, keine Inhalte
 *    wurden gehasht — die Sequenz "Verzeichnis erscheint (wird erkannt, quittiert) →
 *    jede weitere Datei/Änderung DARIN unsichtbar" war am echten Sub-Repo reproduzierbar.
 *    `-uall` listet stattdessen jede untrackte Datei einzeln. Zusätzlich quotet `git
 *    status` Pfade mit Nicht-ASCII/Leerzeichen standardmäßig oktal (`"\342\232\241..."`)
 *    — im Sub-Repo real relevant, dort liegen acht `⚡…blade.php`-Views; `-z` liefert
 *    NUL-getrennte, UNGEQUOTETE Records. Parsing der `-z`-Records (inkl. des zweiten
 *    Records bei Rename/Copy) spiegelt Pests eigene `ChangedFiles::workingTreeChanges()`.
 *
 * `function_exists()`-Wächter wie bei Pests eigenen globalen Helfern (`Functions.php`,
 * z.B. `afterAll()`): geprüft, nicht nur angenommen — `Bootstrappers\BootFiles::load()`
 * liest `tests/Pest.php` per `include_once` (genau einmal je Prozess), Pest-Parallel
 * (ParaTest, hier ungenutzt: kein `--parallel` im Projekt) startet echte separate
 * Prozesse statt Threads, und `tiaSubRepo*` ist repoweit einmalig deklariert (per grep
 * verifiziert). Redeklaration ist damit ausgeschlossen — der Wächter kostet trotzdem
 * nichts und hält die gleiche Vorsicht wie der Rest von Pest.
 */
if (! function_exists('tiaSubRepoFingerprint')) {
    function tiaSubRepoFingerprint(string $path): ?string
    {
        // disable_functions o.ä.: shell_exec existiert dann gar nicht mehr (PHP entfernt
        // sie aus der Funktionstabelle) — ein Aufruf wäre ein Error, kein `@`-unterdrück-
        // bares Warning. Explizit prüfen statt abstürzen, s. Docblock oben.
        if (! function_exists('shell_exec')) {
            return null;
        }

        if (! is_dir($path.'/.git') && ! is_file($path.'/.git')) {
            return null;
        }

        $sha = @shell_exec('git -C '.escapeshellarg($path).' rev-parse HEAD 2>/dev/null');
        if (! is_string($sha) || trim($sha) === '') {
            return null;
        }

        // -uall: neue Verzeichnisse Datei für Datei, nicht zu "?? dir/" kollabiert.
        // -z: NUL-getrennte, ungequotete Records (Nicht-ASCII/Leerzeichen-Pfade bleiben
        // lesbar) — Parsing wie ChangedFiles::workingTreeChanges() (R/C-Records haben
        // einen zweiten Record mit dem alten Pfad direkt danach).
        $statusRaw = (string) (@shell_exec('git -C '.escapeshellarg($path).' status --porcelain -uall -z 2>/dev/null') ?? '');
        $diff = (string) (@shell_exec('git -C '.escapeshellarg($path).' diff HEAD -- . 2>/dev/null') ?? '');

        $records = $statusRaw === '' ? [] : explode("\0", rtrim($statusRaw, "\0"));
        $statusLines = [];
        $untrackedPaths = [];
        $count = count($records);
        for ($i = 0; $i < $count; $i++) {
            $record = $records[$i];
            if (strlen($record) < 4) {
                continue;
            }
            $code = substr($record, 0, 2);
            $filePath = substr($record, 3);
            $statusLines[] = $code.' '.$filePath;

            if (($code[0] === 'R' || $code[0] === 'C') && isset($records[$i + 1]) && $records[$i + 1] !== '') {
                $statusLines[] = 'FROM '.$records[$i + 1];
                $i++;

                continue;
            }

            if ($code === '??') {
                $untrackedPaths[] = $filePath;
            }
        }

        $untrackedContents = '';
        foreach ($untrackedPaths as $relative) {
            $absolute = rtrim($path, '/').'/'.$relative;
            if (is_file($absolute)) {
                $untrackedContents .= $relative.':'.(hash_file('sha256', $absolute) ?: '').';';
            }
        }

        return hash('sha256', trim($sha).'|'.implode("\n", $statusLines).'|'.$diff.'|'.$untrackedContents);
    }
}

$tiaSubRepoPath = __DIR__.'/../packages/einundzwanzig-group';
$tiaSubRepoMarkerPath = __DIR__.'/../storage/framework/testing/tia-subrepo.json';

$tiaSubRepoCurrentFingerprint = tiaSubRepoFingerprint($tiaSubRepoPath);
$tiaSubRepoKnownFingerprint = is_file($tiaSubRepoMarkerPath)
    ? trim((string) (@file_get_contents($tiaSubRepoMarkerPath) ?: ''))
    : null;

// null (unlesbare Quelle) zählt als geändert — Ausfallrichtung s.o.
$tiaSubRepoChanged = $tiaSubRepoCurrentFingerprint === null
    || $tiaSubRepoCurrentFingerprint !== $tiaSubRepoKnownFingerprint;

if (! $tiaSubRepoChanged) {
    pest()->tia()
        ->always()
        ->locally()
        ->filtered()
        ->watch([
            'config/group.php' => 'tests/Feature',
        ]);
}

// Quittiert den zu Laufbeginn eingefrorenen Fingerabdruck — aber erst, wenn PHPUnits
// TestRunner wirklich fertig ist UND der Lauf dabei grün war (s.o., B1). Ein simpler
// Zähler-Container, von drei Subscribern geteilt (PHP-Objekte per Referenz) —
// `Test\FailedSubscriber`/`Test\ErroredSubscriber` markieren jeden Fehlschlag/Fehler
// SOFORT beim Auftreten, der `Finished`-Handler prüft ihn erst ganz am Ende.
// `$tiaSubRepoCurrentFingerprint === null` bleibt außen vor: eine unlesbare Quelle
// hinterlässt keinen Fake-Marker, der einen späteren Lauf fälschlich beruhigen würde —
// sie bleibt beim nächsten Mal wieder „geändert".
if ($tiaSubRepoCurrentFingerprint !== null) {
    $tiaSubRepoRunTracker = new class
    {
        public bool $hadFailure = false;
    };

    Facade::instance()->registerSubscriber(
        new class($tiaSubRepoRunTracker) implements FailedSubscriber
        {
            public function __construct(private object $tracker) {}

            public function notify(Failed $event): void
            {
                $this->tracker->hadFailure = true;
            }
        },
    );
    Facade::instance()->registerSubscriber(
        new class($tiaSubRepoRunTracker) implements ErroredSubscriber
        {
            public function __construct(private object $tracker) {}

            public function notify(Errored $event): void
            {
                $this->tracker->hadFailure = true;
            }
        },
    );
    Facade::instance()->registerSubscriber(
        new class($tiaSubRepoMarkerPath, $tiaSubRepoCurrentFingerprint, $tiaSubRepoRunTracker) implements FinishedSubscriber
        {
            public function __construct(private string $markerPath, private string $fingerprint, private object $tracker) {}

            public function notify(Finished $event): void
            {
                if ($this->tracker->hadFailure) {
                    return; // roter Lauf — nicht quittieren (B1).
                }

                $dir = dirname($this->markerPath);
                if (! is_dir($dir)) {
                    @mkdir($dir, recursive: true);
                }
                @file_put_contents($this->markerPath, $this->fingerprint);
            }
        },
    );
}

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
