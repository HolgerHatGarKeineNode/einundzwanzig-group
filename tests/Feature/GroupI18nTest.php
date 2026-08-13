<?php

declare(strict_types=1);

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
     */
    $reference = array_keys((array) json_decode((string) file_get_contents($langDir.'/en.json'), true));
    sort($reference);

    foreach (['es', 'pt', 'nl', 'pl', 'hu', 'lv'] as $loc) {
        $keys = array_keys((array) json_decode((string) file_get_contents($langDir.'/'.$loc.'.json'), true));
        sort($keys);

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
