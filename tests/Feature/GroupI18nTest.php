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
    'Bitte noch :seconds Sekunden warten.' => [':seconds'],
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

test('Bitcoin/Nostr-Jargon + Marke bleiben unübersetzt (Sats, npub, EINUNDZWANZIG)', function () use ($langDir) {
    $data = json_decode((string) file_get_contents($langDir.'/es.json'), true);
    // „Betrag (Sats)" behält die Einheit „Sats".
    expect($data['Betrag (Sats)'] ?? '')->toContain('Sats');
    // „npub kopieren" behält „npub".
    expect($data['npub kopieren'] ?? '')->toContain('npub');
});
