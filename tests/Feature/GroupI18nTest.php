<?php

declare(strict_types=1);
use Einundzwanzig\Group\Http\Middleware\SetLocale;

/**
 * i18n des geteilten group-Packages: die deutschen __()-Quell-Keys werden über
 * vom Package geshippte JSON-Translations (loadJsonTranslationsFrom) in die 7
 * von der Mobile-App unterstützten Nicht-de-Sprachen aufgelöst. de bleibt der
 * Key selbst (kein de.json). Web-Host läuft auf de → unverändert.
 */
$langDir = dirname(__DIR__, 2).'/packages/einundzwanzig-group/lang';

// Diese Tests schalten den Locale um; nach jedem zurück auf de, damit nichts
// in Folge-Tests leakt (Web-Host ist deutsch).
afterEach(fn () => app()->setLocale('de'));

test('alle 7 Sprachdateien existieren, sind valides JSON und substantiell gefüllt', function () use ($langDir) {
    foreach (['en', 'es', 'pt', 'nl', 'pl', 'hu', 'lv'] as $loc) {
        $path = $langDir.'/'.$loc.'.json';
        expect(file_exists($path))->toBeTrue("lang/{$loc}.json fehlt");
        $data = json_decode((string) file_get_contents($path), true);
        expect($data)->toBeArray()->and(count($data))->toBeGreaterThanOrEqual(250);
    }
});

test('__() löst deutsche Keys in Nicht-de-Locales auf; de bleibt der Quell-Key', function () {
    // de: kein de.json → Key = Ausgabe.
    app()->setLocale('de');
    expect(__('Beitreten'))->toBe('Beitreten');

    // Nicht-de: übersetzt (nicht mehr der deutsche Key).
    foreach (['en', 'es', 'pt', 'nl', 'pl', 'hu', 'lv'] as $loc) {
        app()->setLocale($loc);
        expect(__('Beitreten'))->not->toBe('Beitreten', "Beitreten nicht übersetzt in {$loc}");
        expect(__('Guthaben'))->not->toBe('Guthaben', "Guthaben nicht übersetzt in {$loc}");
    }
});

test('& -Keys sind entschärft (kein &amp;-Doppelescape) und lösen auf', function () use ($langDir) {
    // Der Blade-Key trägt echtes & (dekodiert); {{ }} escapt beim Rendern.
    app()->setLocale('es');
    expect(__('Konto & Identität'))->not->toBe('Konto & Identität')
        ->and(__('Konto & Identität'))->not->toContain('&amp;');

    foreach (['en', 'es', 'pt', 'nl', 'pl', 'hu', 'lv'] as $loc) {
        $data = json_decode((string) file_get_contents($langDir.'/'.$loc.'.json'), true);
        foreach ($data as $key => $value) {
            expect($key)->not->toContain('&amp;');
            expect($value)->not->toContain('&amp;');
        }
    }
});

// ── Ganze Sätze statt Fragmente ──────────────────────────────────────────────

/*
 * Vier Sätze des Vereins-Flows standen im Markup in Stücken, weil ein reaktives
 * `<span x-text>` mitten im Satz saß:
 *
 *     {{ __('Bitte noch') }} <span x-text="error.retryAfter"></span> {{ __('Sekunden warten.') }}
 *
 * Der Übersetzer bekam zwei Einträge und konnte weder die Wortstellung wählen
 * (Ungarisch stellt das Verb ans Ende) noch den Kasus (Lettisch, Polnisch) —
 * beides hängt an dem, was dazwischen steht, und das sah er nie.
 *
 * Die drei Fälle hier bewachen den Zustand danach, und zwar in der Reihenfolge,
 * in der er kaputtgehen kann: der Satz kommt zurück in Stücken (1), eine Sprache
 * bekommt den neuen Schlüssel nicht (2), oder sie bekommt ihn ohne Platzhalter
 * (3). Fall 3 ist der bösartigste: die Oberfläche zeigt dann einen vollständig
 * aussehenden Satz, in dem die Zahl einfach fehlt.
 */

/** Die vier Sätze und die Platzhalter, die jede Übersetzung tragen MUSS. */
$sentences = [
    'Bitte noch :seconds Sek. warten.' => [':seconds'],
    'Fassung :version, beschlossen am :date' => [':version', ':date'],
    ':used / :max Zeichen' => [':used', ':max'],
    'Das dauert :duration.' => [':duration'],
];

/** Die Fragmente von vorher — Leichen, sobald der Satz ganz ist. */
$fragments = ['Bitte noch', 'Sekunden warten.', 'Fassung', 'beschlossen am', 'Zeichen', 'Das dauert'];

test('die vier Sätze stehen als GANZER Satz im Katalog — die Fragmente nirgends mehr', function () use ($langDir, $sentences, $fragments) {
    foreach (['en', 'es', 'pt', 'nl', 'pl', 'hu', 'lv'] as $loc) {
        $data = json_decode((string) file_get_contents($langDir.'/'.$loc.'.json'), true);

        foreach (array_keys($sentences) as $key) {
            expect(array_key_exists($key, $data))->toBeTrue("„{$key}\" fehlt in {$loc}.json");
        }

        foreach ($fragments as $dead) {
            expect(array_key_exists($dead, $data))->toBeFalse("Fragment „{$dead}\" lebt noch in {$loc}.json");
        }
    }
});

test('jede Übersetzung der vier Sätze trägt ihre Platzhalter — ein verlorener frisst den Wert', function () use ($langDir, $sentences) {
    foreach (['en', 'es', 'pt', 'nl', 'pl', 'hu', 'lv'] as $loc) {
        $data = json_decode((string) file_get_contents($langDir.'/'.$loc.'.json'), true);

        foreach ($sentences as $key => $placeholders) {
            foreach ($placeholders as $placeholder) {
                // `?? ''` statt direktem Zugriff: fehlt der Schlüssel ganz, soll
                // dieser Fall SCHEITERN und nicht mit „Undefined array key"
                // abbrechen — ein Abbruch nennt den Ort, aber nicht die Aussage.
                expect(str_contains((string) ($data[$key] ?? ''), $placeholder))
                    ->toBeTrue("{$placeholder} fehlt in {$loc}.json bei „{$key}\"");
            }
        }
    }
});

test('alle 7 Kataloge tragen DIESELBE Schlüsselmenge — kein Schlüssel nur in sechs', function () use ($langDir) {
    /*
     * Der Zusatz zu den Fällen oben: die vier Sätze sind geprüft, aber ein
     * Schlüssel, der beim Umbau nur in sechs Dateien landet, fiele in der
     * siebten STILL auf Deutsch zurück — ununterscheidbar von einer bloß
     * fehlenden Übersetzung. Bei sieben Dateien ist das Augenmaß die
     * Fehlerquelle, nicht die Übersetzung.
     *
     * **Ausgenommen sind die Zählform-Sonderformen** (`…#few`, `…#zero`, `…#one`,
     * `…#many`). Sie sind per Konstruktion sprachgebunden: `en.json` hat kein
     * `#few`, weil Englisch die Kategorie `few` gar nicht kennt — ein Eintrag
     * dort wäre toter Text, den nie jemand liest und trotzdem jeder pflegt.
     * Das ist KEINE Lockerung: welche Sprache welche Sonderform tragen muss,
     * prüft der Fall „Sonderformen" unten namentlich und vollständig, also
     * strenger als ein Mengenvergleich es könnte.
     */
    $grundschluessel = function (string $loc) use ($langDir): array {
        $keys = array_keys((array) json_decode((string) file_get_contents($langDir.'/'.$loc.'.json'), true));
        $keys = array_values(array_filter($keys, fn (string $k) => ! str_contains($k, '#')));
        sort($keys);

        return $keys;
    };

    $reference = $grundschluessel('en');

    foreach (['es', 'pt', 'nl', 'pl', 'hu', 'lv'] as $loc) {
        $keys = $grundschluessel($loc);

        expect(array_diff($reference, $keys))->toBe([], "{$loc}.json fehlen Schlüssel aus en.json");
        expect(array_diff($keys, $reference))->toBe([], "{$loc}.json hat Schlüssel, die en.json nicht kennt");
    }
});

// ── Numerus ohne Numerus-Mechanik ────────────────────────────────────────────

/*
 * `t()` kennt nur `:name`-Ersetzung, keine Pluralregeln — und das bleibt so
 * (die Entscheidung samt Begründung steht in `js/vereinFlow.ts`, Abschnitt
 * „Numerus: die Entscheidung, nicht die Vertagung"). Der Preis dafür ist eine
 * Zusage an die Formulierung: **an keiner Stelle, an der eine freie Zahl steht,
 * darf ein Wort daneben stehen, dessen Form sich nach dieser Zahl richtet.**
 *
 * Diese Zusage kann nur der Katalog halten, und sie kann still brechen: eine
 * Übersetzung, die „st." wieder zu „stundām" ausschreibt, sieht in einem Diff
 * wie eine Verbesserung aus und ist für Zahlen auf 1 falsch. Deshalb steht sie
 * hier als Fall und nicht als Kommentar.
 */
test('die Wartebremse nennt die Einheit abgekürzt — „1 Sekunden" ist erreichbar', function () use ($langDir) {
    /*
     * `RETRY_AFTER_MIN_SECONDS` ist 1. Deutsch (= der Schlüssel selbst),
     * Englisch, Spanisch, Portugiesisch und Niederländisch bilden für 1 eine
     * andere Form als für 42 — dort MUSS die Einheit abgekürzt oder weggelassen
     * sein. Ungarisch setzt nach einem Zahlwort ohnehin den Singular und darf
     * ausschreiben; Polnisch und Lettisch kürzen bereits.
     */
    $ausgeschrieben = [
        'en' => 'seconds',
        'es' => 'segundos',
        'pt' => 'segundos',
        'nl' => 'seconden',
    ];

    foreach ($ausgeschrieben as $loc => $wort) {
        $data = json_decode((string) file_get_contents($langDir.'/'.$loc.'.json'), true);
        $wert = (string) ($data['Bitte noch :seconds Sek. warten.'] ?? '');

        expect($wert)->not->toBe('', "Der Schlüssel fehlt in {$loc}.json");

        /*
         * Der PLATZHALTER fällt vorher raus. `:seconds` enthält die
         * Zeichenkette „seconds" — ohne diesen Schritt hätte der Fall die
         * englische Übersetzung angeschwärzt, obwohl dort nur der Platzhalter
         * steht, und der Befund wäre falsch gewesen.
         */
        $ohnePlatzhalter = str_replace(':seconds', '', $wert);

        expect(str_contains($ohnePlatzhalter, $wort))
            ->toBeFalse("{$loc}.json schreibt die Einheit aus („{$wort}\") — für :seconds = 1 falsch");
    }

    // Und der deutsche Quelltext, also der Schlüssel selbst, ebenso.
    app()->setLocale('de');
    expect(__('Bitte noch :seconds Sek. warten.'))->not->toContain('Sekunden');
});

test('die Wartezeit in lv steht ohne flektierte Einheit — „līdz 21 stundām" ist falsch', function () use ($langDir) {
    /*
     * Lettisch ist die einzige der acht Sprachen, die hier zuschlägt: „līdz"
     * regiert den Dativ, und der ist zahlabhängig — für alles auf 1 außer 11
     * steht der Singular („līdz 21 stundai"), sonst der Plural („līdz 24
     * stundām"). `formatWait` fängt allein die 1 selbst über einen eigenen
     * Schlüssel ab; 21, 31, 41 … bleiben.
     *
     * Die anderen sieben sind auf dieselbe Klasse geprüft und unauffällig:
     * de/en/es/pt bilden für jede Zahl ≠ 1 denselben Plural, nl setzt nach
     * Zahlen „uur", hu den Singular, pl steht hinter „do" im Genitiv Plural.
     */
    $data = json_decode((string) file_get_contents($langDir.'/lv.json'), true);

    foreach (['bis zu :count Stunden' => 'stundām', 'bis zu :count Minuten' => 'minūtēm'] as $key => $dativPlural) {
        $wert = (string) ($data[$key] ?? '');

        expect($wert)->not->toBe('', "„{$key}\" fehlt in lv.json");
        expect(str_contains($wert, $dativPlural))
            ->toBeFalse("lv.json trägt bei „{$key}\" den Dativ Plural „{$dativPlural}\" — für Zahlen auf 1 (außer 11) falsch");
    }
});

// ── Keine Leichen: was zusammengelegt oder entfernt wurde, ist überall weg ────

test('zusammengelegte und entfernte Schlüssel leben in keinem der 7 Kataloge weiter', function () use ($langDir) {
    /*
     * Zwei Schlüssel sind gefallen, und beide würden als Leiche nichts kaputt
     * machen — genau deshalb bleiben sie sonst ewig stehen:
     *
     *  · „Die Vereins-Anbindung ist nicht konfiguriert." war die zweite von
     *    zwei deutschen Formulierungen für EINEN Zustand (Installation nicht
     *    eingerichtet). Im Deutschen war der Unterschied zu „… ist nicht
     *    eingerichtet." null; in es/pt/pl musste einer ERFUNDEN werden, damit
     *    nicht zwei Schlüssel denselben Wert tragen. Was bleibt, ist die
     *    Trennung, die trägt: dauerhaft („nicht eingerichtet") gegen
     *    vorübergehend („gerade nicht verfügbar").
     *  · „name@example.org" war ein Beispiel-Platzhalter, in allen sieben
     *    Katalogen bitgleich. Ein Schlüssel, der nichts übersetzt, aber jeden
     *    Übersetzer einlädt, die nach RFC 2606 reservierte Domain durch etwas
     *    Echtes zu ersetzen.
     *
     * Der alte Wartebremsen-Schlüssel steht mit in der Liste: er ist umbenannt
     * worden, und eine zurückgelassene Altfassung wäre der stillste aller
     * Fehler — der Katalog trüge beide, und welche gilt, entschiede der Code.
     */
    $tot = [
        'Die Vereins-Anbindung ist nicht konfiguriert.',
        'name@example.org',
        'Bitte noch :seconds Sekunden warten.',
    ];

    foreach (['en', 'es', 'pt', 'nl', 'pl', 'hu', 'lv'] as $loc) {
        $data = json_decode((string) file_get_contents($langDir.'/'.$loc.'.json'), true);

        foreach ($tot as $key) {
            expect(array_key_exists($key, $data))->toBeFalse("Leiche „{$key}\" lebt noch in {$loc}.json");
        }
    }
});

test('Bitcoin/Nostr-Jargon + Marke bleiben unübersetzt (Sats, npub, EINUNDZWANZIG)', function () use ($langDir) {
    $data = json_decode((string) file_get_contents($langDir.'/es.json'), true);
    // „Betrag (Sats)" behält die Einheit „Sats".
    expect($data['Betrag (Sats)'] ?? '')->toContain('Sats');
    // „npub kopieren" behält „npub".
    expect($data['npub kopieren'] ?? '')->toContain('npub');
});

// ── P3: kein Präfix-/Suffix-Fragment mehr, und die Host-Views sind erreichbar ─

/*
 * Bis P3 setzten 45 Stellen in 8 Blades ihre Beschriftungen aus Fragmenten
 * zusammen: `__('In ') . $label . __(' suchen')`. Für Deutsch las sich das
 * richtig; jede andere Sprache bekam ein Präfix ohne das, was danach kommt, und
 * konnte weder Stellung noch Kasus wählen. Der sichtbarste Schaden stand in
 * sechs von sieben Katalogen als `" suchen": ""` — ein LEERER Wert, weil es dort
 * schlicht kein zweites Fragment gibt.
 *
 * Die drei Fälle hier bewachen den Zustand danach in der Reihenfolge, in der er
 * zurückkommen kann: ein Fragment kehrt ins Markup zurück (1), ein Katalog
 * bekommt wieder einen leeren Wert (2), oder eine Host-View rutscht ganz aus der
 * Übersetzung heraus (3). Fall 3 ist der stillste: eine View ohne `__()` taucht
 * in KEINER Messung auf — auch nicht in der über fehlende Schlüssel.
 */

/** Alle Blades aus Host UND Paket, Blade-Kommentare entfernt (die sind kein Code). */
function bladeQuellen(): array
{
    $roots = [dirname(__DIR__, 2).'/resources/views', dirname(__DIR__, 2).'/packages/einundzwanzig-group/resources/views'];
    $out = [];
    foreach ($roots as $root) {
        $files = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS));
        foreach ($files as $file) {
            if (! str_ends_with((string) $file, '.blade.php')) {
                continue;
            }
            $out[(string) $file] = (string) preg_replace('/\{\{--.*?--\}\}/s', '', (string) file_get_contents((string) $file));
        }
    }

    return $out;
}

test('kein __()-Aufruf trägt ein führendes oder nachlaufendes Leerzeichen — das ist die Signatur eines Fragments', function () {
    $treffer = [];
    foreach (bladeQuellen() as $pfad => $quelle) {
        if (preg_match_all("/__\(\s*'( [^']*|[^']* )'\s*\)/", $quelle, $m)) {
            foreach ($m[1] as $key) {
                $treffer[] = basename($pfad).": __('{$key}')";
            }
        }
    }

    expect($treffer)->toBe([], 'Verkettetes Fragment zurück im Markup: '.implode(' · ', $treffer));
});

test('kein Katalog trägt einen leeren Wert — der leere String ist die Narbe der Fragment-Verkettung', function () use ($langDir) {
    foreach (['en', 'es', 'pt', 'nl', 'pl', 'hu', 'lv'] as $loc) {
        $data = json_decode((string) file_get_contents($langDir.'/'.$loc.'.json'), true);

        $leer = array_keys(array_filter($data, fn ($v) => trim((string) $v) === ''));

        expect($leer)->toBe([], "{$loc}.json trägt leere Werte: ".implode(', ', $leer));

        // Namentlich, weil genau dieser Schlüssel der Anlass der Phase war: er
        // darf nicht auf einen Wert gesetzt, sondern muss GELÖSCHT sein.
        expect(array_key_exists(' suchen', $data))->toBeFalse("„ suchen\" lebt noch in {$loc}.json");
    }
});

test('die Startseite und die drei Fehlerseiten rufen __() — sonst bleiben sie unter jeder Sprache deutsch', function () {
    $pflicht = [
        'pages/⚡home.blade.php',
        'errors/404.blade.php',
        'errors/500.blade.php',
        'errors/503.blade.php',
        'errors/layout.blade.php',
    ];

    foreach ($pflicht as $rel) {
        $quelle = (string) file_get_contents(dirname(__DIR__, 2).'/resources/views/'.$rel);
        // Kommentare NICHT entfernen wäre hier zu lasch: ein `__()` in einer
        // Erklärung würde den Fall grün färben, ohne dass die View übersetzt.
        $quelle = (string) preg_replace('/\{\{--.*?--\}\}/s', '', $quelle);

        expect(str_contains($quelle, '__('))->toBeTrue("{$rel} ruft kein __() — der Text steht hart im Markup");
    }
});

test('ein Umschalten auf Spanisch ändert die Startseite sichtbar', function () {
    /*
     * `window.__nostrI18n` liefert den GANZEN Katalog der aktiven Sprache in den
     * <head> (`js/i18n.ts`), und dessen SCHLÜSSEL sind der deutsche Quelltext.
     * Auf einer spanischen Seite steht der deutsche Satz deshalb garantiert im
     * HTML — als Schlüssel, nicht als Anzeige. Ein `assertDontSee` über die rohe
     * Antwort könnte hier also nie grün werden und würde die Aussage lautlos
     * verfehlen. Der Katalog fliegt vorher raus; geprüft wird das Markup.
     */
    $ohneKatalog = fn (string $html) => (string) preg_replace('/<script>window\.__nostrI18n = .*?<\/script>/s', '', $html);

    $deutsch = $ohneKatalog($this->get('/')->assertOk()->getContent());

    expect($deutsch)->toContain('Die Bitcoin-Community auf Nostr')
        ->and($deutsch)->toContain('Zu deinem Space');

    $spanisch = $ohneKatalog(
        $this->withUnencryptedCookie(SetLocale::COOKIE, 'es')
            ->get('/')->assertOk()->getContent()
    );

    expect($spanisch)->toContain('La comunidad Bitcoin en Nostr')
        ->and($spanisch)->toContain('A tu Space')
        // Und der deutsche Satz ist WEG — sonst hätte die Übersetzung nur danebengestanden.
        ->and($spanisch)->not->toContain('Die Bitcoin-Community auf Nostr');
});

test('die Fehlerseiten folgen der Sprache — Hülle und Inhalt gemeinsam', function () {
    app()->setLocale('de');
    expect(view('errors.404')->render())->toContain('Seite nicht gefunden')
        ->and(view('errors.404')->render())->toContain('Zurück zur Startseite');

    app()->setLocale('es');
    $es = view('errors.404')->render();

    expect($es)->toContain('Página no encontrada')
        ->and($es)->toContain('Volver a la página de inicio')
        ->and($es)->not->toContain('Seite nicht gefunden');

    // 500 und 503 tragen dieselbe Hülle, also genügt je ein eigener Satz.
    expect(view('errors.500')->render())->toContain('Algo ha salido mal');
    expect(view('errors.503')->render())->toContain('No disponible por un momento');
});

// ── P3 Schritt 3: die dritte Zählform ────────────────────────────────────────

/*
 * Bis hierher wählte jede Zählstelle mit `count === 1 ?` zwischen zwei Formen.
 * Für sechs der acht Sprachen stimmt das. Für `pl` (one/few/many/other) und `lv`
 * (zero/one/other) ist es falsch — und `pt` bildet zusätzlich die NULL als `one`
 * ab, verschluckt also mit einem ausgeschriebenen „1 sala" die Zahl.
 *
 * Die Mechanik dahinter (`pluralCategory` in `locale.ts`, `tPlural` in
 * `i18n.ts`) ist dort mit `node --test` gegen die echten CLDR-Regeln geprüft:
 * welche Zahl in welche Kategorie fällt, beantwortet `Intl.PluralRules` und
 * nicht diese Datei. Hier steht das Gegenstück, das PHP prüfen kann und das
 * still verfallen würde: **trägt der KATALOG die Formen, die die Mechanik sucht?**
 *
 * Ein fehlender Eintrag bricht nichts (der Rückfall liefert die Grundform, also
 * den Stand von vorher) — genau deshalb braucht er einen Test. Ein Mangel, der
 * sich als Normalzustand tarnt, wird sonst nie bemerkt.
 */

/**
 * Die Zählform-Paare, wie sie IM CODE stehen — aus `$plural(…)` in Blade und
 * `tPlural({ one: …, other: … })` in TypeScript. Bewusst erhoben statt
 * abgeschrieben: ein neu hinzugefügtes Paar soll diesen Test sofort in die
 * Pflicht nehmen, nicht erst, wenn jemand die Liste hier nachträgt.
 *
 * @return array<int, array{0: string, 1: string}>
 */
function pluralPaare(): array
{
    $wurzel = dirname(__DIR__, 2);
    $paare = [];

    foreach (['/resources/views', '/packages/einundzwanzig-group/resources/views'] as $rel) {
        $files = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($wurzel.$rel, FilesystemIterator::SKIP_DOTS));
        foreach ($files as $file) {
            if (! str_ends_with((string) $file, '.blade.php')) {
                continue;
            }
            preg_match_all("/\\\$plural\\(.*?'((?:[^'\\\\]|\\\\.)*)'\s*,\s*'((?:[^'\\\\]|\\\\.)*)'/", (string) file_get_contents((string) $file), $m, PREG_SET_ORDER);
            foreach ($m as $hit) {
                $paare[$hit[1].'|'.$hit[2]] = [$hit[1], $hit[2]];
            }
        }
    }

    foreach (glob($wurzel.'/packages/einundzwanzig-group/js/*.ts') ?: [] as $file) {
        preg_match_all("/tPlural\\(\\{ one: '((?:[^'\\\\]|\\\\.)*)', other: '((?:[^'\\\\]|\\\\.)*)' \\}/", (string) file_get_contents($file), $m, PREG_SET_ORDER);
        foreach ($m as $hit) {
            $paare[$hit[1].'|'.$hit[2]] = [$hit[1], $hit[2]];
        }
    }

    return array_values($paare);
}

test('die Zählform-Paare stehen im Code — und der Scanner sieht sie NICHT', function () {
    /*
     * Vorbedingung des ganzen Blocks, und zugleich der Grund für ihn: die
     * Grundformen sind seit dem Umbau keine `__()`-Aufrufe mehr, sondern rohe
     * Schlüssel, die `tPlural` im Browser-Katalog nachschlägt. Der
     * Vollständigkeits-Scanner misst `__()` — diese Schlüssel liegen also
     * außerhalb seiner Reichweite, und ohne die Fälle hier wären sie ungedeckt.
     */
    expect(count(pluralPaare()))->toBeGreaterThanOrEqual(15);
});

test('jede der 7 Sprachen trägt BEIDE Grundformen jedes Zählform-Paares', function () use ($langDir) {
    foreach (['en', 'es', 'pt', 'nl', 'pl', 'hu', 'lv'] as $loc) {
        $data = (array) json_decode((string) file_get_contents($langDir.'/'.$loc.'.json'), true);

        foreach (pluralPaare() as [$one, $other]) {
            expect(array_key_exists($one, $data))->toBeTrue("„{$one}\" fehlt in {$loc}.json");
            expect(array_key_exists($other, $data))->toBeTrue("„{$other}\" fehlt in {$loc}.json");
            // Die `other`-Form MUSS den Zähler tragen, sonst verschwindet die Zahl.
            expect(str_contains((string) $data[$other], ':count'))
                ->toBeTrue(":count fehlt in {$loc}.json bei „{$other}\"");
        }
    }
});

/**
 * Welche Sprache welche Sonderform braucht — gemessen, nicht geschätzt, mit
 *   node -e "for (const l of ['de','en','es','hu','lv','nl','pl','pt'])
 *            console.log(l, new Intl.PluralRules(l).resolvedOptions().pluralCategories)"
 * und den Zahlen 0…111 durchgespielt (die Fälle dazu stehen in `locale.test.ts`):
 *
 *  · pl  one=1 · few=2–4,22–24 · many=0,5–21,25… · other=Brüche
 *    → `#few` nötig; `many` deckt die Grundform `other` bereits ab (sie steht
 *      im Katalog als Genitiv Plural), `other` ist mit ganzen Zahlen unerreichbar.
 *  · lv  zero=0,11–19 · one=1,21,31,101 · other=Rest
 *    → `#zero` UND `#one` nötig — Letzteres, weil „1 telpa" sonst die 21 frisst.
 *  · pt  one=0,1 · other=Rest
 *    → `#one` nötig, damit die NULL ihre Ziffer behält.
 *  · de/en/es/nl/hu trennen genau bei 1 → keine Sonderform.
 */
$sonderformen = ['pl' => ['few'], 'lv' => ['zero', 'one'], 'pt' => ['one']];

test('pl, lv und pt tragen ihre Sonderformen für JEDES Paar — vollständig', function () use ($langDir, $sonderformen) {
    foreach ($sonderformen as $loc => $kategorien) {
        $data = (array) json_decode((string) file_get_contents($langDir.'/'.$loc.'.json'), true);

        foreach (pluralPaare() as [, $other]) {
            foreach ($kategorien as $kategorie) {
                $key = $other.'#'.$kategorie;

                expect(array_key_exists($key, $data))->toBeTrue("Sonderform „{$key}\" fehlt in {$loc}.json");
                expect(trim((string) $data[$key]))->not->toBe('', "Sonderform „{$key}\" ist leer in {$loc}.json");
                expect(str_contains((string) $data[$key], ':count'))
                    ->toBeTrue(":count fehlt in {$loc}.json bei der Sonderform „{$key}\"");
            }
        }
    }
});

test('keine Sprache trägt eine Sonderform, die ihre Zählregeln nie erzeugen', function () use ($langDir, $sonderformen) {
    /*
     * Die Gegenrichtung, und die stillere: ein `#few` in `en.json` würde nie
     * gelesen, aber jeder Übersetzer müsste es pflegen — und beim nächsten
     * Abgleich sähe es aus wie eine fehlende Übersetzung.
     */
    foreach (['en', 'es', 'nl', 'hu', 'pl', 'lv', 'pt'] as $loc) {
        $erlaubt = $sonderformen[$loc] ?? [];
        $data = (array) json_decode((string) file_get_contents($langDir.'/'.$loc.'.json'), true);

        foreach (array_keys($data) as $key) {
            if (! str_contains($key, '#')) {
                continue;
            }
            $kategorie = substr($key, (int) strrpos($key, '#') + 1);

            // `in_array` statt `toContain`: `toContain` ist variadisch, ein
            // zweites Argument wäre ein WEITERER erwarteter Wert und keine
            // Meldung — der Fall schlüge dann mit der eigenen Meldung als
            // vermisstem Element fehl und sagte nichts über die Ursache.
            expect(in_array($kategorie, $erlaubt, true))
                ->toBeTrue("{$loc}.json trägt „{$key}\" — diese Kategorie erzeugt {$loc} nie");
        }
    }
});

// ── Die Kopiermeldungen: getrennte Vollsätze statt Genus-Raten ───────────────

test('jede Kopiermeldung ist ein eigener Vollsatz — der Sammelschlüssel ist weg', function () use ($langDir) {
    /*
     * `':label kopiert.'` setzte ein Substantiv in einen Satz ein. Deutsch trägt
     * das („kopiert" richtet sich nach nichts), sieben Sprachen nicht: Spanisch
     * schreibt „Factura copiada", aber „npub copiado". Mit einem Schlüssel muss
     * der Übersetzer eine Form raten und liegt an der Hälfte der Stellen daneben.
     */
    $saetze = ['npub kopiert.', 'Lightning-Adresse kopiert.', 'Rechnung kopiert.', 'Event-Link kopiert.', 'JSON kopiert.'];

    foreach (['en', 'es', 'pt', 'nl', 'pl', 'hu', 'lv'] as $loc) {
        $data = (array) json_decode((string) file_get_contents($langDir.'/'.$loc.'.json'), true);

        expect(array_key_exists(':label kopiert.', $data))->toBeFalse("Sammelschlüssel lebt noch in {$loc}.json");

        foreach ($saetze as $satz) {
            expect(array_key_exists($satz, $data))->toBeTrue("„{$satz}\" fehlt in {$loc}.json");
        }
    }

    // Und die Probe aufs Exempel: Spanisch MUSS hier zwei verschiedene Formen
    // tragen, sonst hätte der Umbau nichts gebracht.
    $es = (array) json_decode((string) file_get_contents($langDir.'/es.json'), true);
    expect($es['Rechnung kopiert.'])->toContain('copiada')
        ->and($es['npub kopiert.'])->toContain('copiado');
});

test('keine Ersetzungskette füllt einen Platzhalter, der Präfix eines anderen ist', function () {
    /*
     * Die Falle, die Laravels `makeReplacements` mit „längster Schlüssel zuerst"
     * umgeht und `fill()` in `js/i18n.ts` genauso — in einer Blade-Kette
     * `.replace(':count', …).replace(':countries', …)` gibt es diesen Schutz
     * NICHT: das erste `replace` trifft `:countries` mitten im Wort und macht
     * daraus „1ries". Genau so ist es beim Meetup-Zähler einmal passiert.
     */
    /*
     * Gesucht wird je ATTRIBUTWERT, nicht je Zeile: die Ketten sind mehrzeilig
     * (`⚡spaces` füllt `:groups` und `:countries` über drei Zeilen). Eine
     * zeilenweise Prüfung übersieht genau die Bauform, die dieses Repo benutzt —
     * mit einer solchen Fassung ist der Fall hier zuerst durchgerutscht.
     */
    /*
     * P10, Punkt 4 — beide Quote-Ebenen, nicht nur eine: Bis hierher las der
     * Fall nur doppelte Attribut-Quotes MIT einfachen JS-Quotes. Eine Kette in
     * einem einfach-gequoteten Attribut trägt aber ZWINGEND doppelte JS-Quotes
     * (sonst endete das Attribut am ersten `'` des Ausdrucks) — für sie war der
     * Fall doppelt blind. Gelesen werden jetzt beide Ebenen. Im Bestand gibt es
     * keine einfach-gequoteten Attribute mit Kette (gemessen am 2026-08-15:
     * 26 doppelte Attributstellen mit 34 Platzhalternamen, 0 einfache).
     *
     * Die EINE nicht erreichte Stelle ist `components/emoji-picker.blade.php`:
     * Dort baut PHP den Ausdruck zusammen (`$pickTemplate` per `str_replace`
     * aus `__('Einfügen: :emoji')`), die Kette steht nicht im Attributwert des
     * Blade-Quelltexts. Konstruktiv kollisionsfrei: der Ausdruck trägt GENAU
     * EINEN Platzhalter (`:emoji`), und eine Kollision braucht zwei Namen, von
     * denen einer Präfix des anderen ist. Wer dort je einen zweiten Platzhalter
     * ergänzt, muss diese Ausnahme mit neu prüfen.
     */
    $treffer = [];
    foreach (bladeQuellen() as $pfad => $quelle) {
        // Attributwerte BEIDER Quote-Arten; die Quotes selbst werden abgezogen,
        // damit die Ketten-Suche nicht am Rand des Werts klebt.
        preg_match_all('/=("[^"]*"|\'[^\']*\')/', $quelle, $attribute);

        foreach ($attribute[1] as $rohwert) {
            $ausdruck = substr($rohwert, 1, -1);
            // JS-String-Quotes ebenfalls beider Arten (siehe Kommentar oben).
            preg_match_all("/\.(?:replace|split)\(['\"](:[a-zA-Z]+)['\"]/", $ausdruck, $m);
            $namen = array_unique($m[1]);

            foreach ($namen as $a) {
                foreach ($namen as $b) {
                    if ($a !== $b && str_starts_with($b, $a)) {
                        $treffer[] = basename($pfad)." — {$a} ist Präfix von {$b}";
                    }
                }
            }
        }
    }

    expect(array_values(array_unique($treffer)))->toBe([], 'Platzhalter-Kollision: '.implode(' · ', $treffer));
});
