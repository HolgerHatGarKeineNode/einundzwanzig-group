<?php

declare(strict_types=1);

use App\Support\I18nScanner;

/**
 * Das Gate für „0 fehlende Übersetzungsschlüssel".
 *
 * WARUM ES DIESE DATEI GIBT: Die Zusage wurde zweimal per SKRIPTLAUF nachgewiesen
 * und verfiel danach still um 27 Schlüssel — niemand fuhr das Skript noch einmal,
 * und keine Suite wurde rot. Ein Nachweis, den nur ein Mensch erbringen kann, ist
 * kein Nachweis, sondern eine Gewohnheit. Ab hier fährt der Scanner in der Suite.
 *
 * KEINE FESTE SCHLÜSSELZAHL: Der Katalog wächst. Die Zusage lautet „0 fehlend",
 * nicht „570 Schlüssel" — eine festgeschriebene Zahl müsste bei jedem neuen Text
 * nachgezogen werden und wäre nach der dritten Nachziehung eine Formalie.
 *
 * DIE SCHRANKE IST DER ZWEITE HALBE TEST: Ein Scanner, der nichts mehr findet,
 * meldet ebenfalls „0 fehlend". Das ist derselbe Fehler eine Ebene höher, und
 * deshalb steht die Plausibilitätsschranke im Gate selbst — nicht nur daneben.
 */

/**
 * Fährt den Scanner einmal je Prozess. Der Baum ändert sich während eines Laufs
 * nicht; die Wiederverwendung spart pro Test einen kompletten Blade-Durchlauf.
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
function i18nScanResult(): array
{
    static $result = null;

    return $result ??= (new I18nScanner)->scan();
}

/**
 * UNTERGRENZEN, und warum genau diese Zahlen:
 *
 * Gemessen am 2026-08-15 (`php artisan i18n:scan`): 111 Dateien, 551 verschiedene
 * gerufene Schlüssel. Die Schranken liegen bei rund 72 % davon — weit genug unter
 * dem Ist-Stand, dass gewöhnliche Bewegung sie nie berührt (Views werden
 * zusammengelegt, tote Schlüssel fliegen raus: in P3 waren das 44 auf einen
 * Schlag), und weit genug über dem Bruchbild, dass jeder strukturelle Ausfall
 * darunter landet: fällt allein die größte Scan-Wurzel weg
 * (`packages/einundzwanzig-group/resources`, 49 der 111 Dateien), bleiben 62 —
 * unter 80. Fällt der Tokenizer oder der Blade-Durchlauf aus, ist die Fundmenge
 * nahe null.
 *
 * Sie sind Untergrenzen, keine Sollwerte: Wachstum bewegt sie nie. Nachgezogen
 * werden müssen sie erst, wenn das Repo dauerhaft um ein Drittel schrumpft — und
 * dann ist das Nachziehen eine bewusste Entscheidung und kein Wartungsrauschen.
 */
const I18N_MIN_FILES = 80;

const I18N_MIN_KEYS = 400;

test('der Scanner sieht das Repo — sonst ist sein „0 fehlend" wertlos', function () {
    $result = i18nScanResult();

    expect(count($result['files']))->toBeGreaterThanOrEqual(
        I18N_MIN_FILES,
        'Der i18n-Scanner hat nur '.count($result['files']).' Dateien gesehen (erwartet: mindestens '.I18N_MIN_FILES.
        '). Er misst nicht mehr, was er messen soll — jede seiner Aussagen über fehlende Schlüssel ist damit wertlos.'
    );

    expect(count($result['keys']))->toBeGreaterThanOrEqual(
        I18N_MIN_KEYS,
        'Der i18n-Scanner hat nur '.count($result['keys']).' gerufene __()-Schlüssel gefunden (erwartet: mindestens '.
        I18N_MIN_KEYS.'). Entweder ist der Tokenizer-Pfad kaputt oder die Blade-Kompilierung liefert nichts.'
    );

    // Alle sieben Kataloge müssen tatsächlich geladen sein — ein leeres
    // Katalog-Array würde jeden Schlüssel als fehlend melden, ein fehlendes
    // Locale dagegen gar nichts.
    expect(array_keys($result['catalogs']))->toBe(I18nScanner::LOCALES);
});

test('kein gerufener __()-Schlüssel fehlt in einem der sieben Kataloge', function () {
    $result = i18nScanResult();

    // Die Schranke steht hier ein zweites Mal: dieser Test wird oft einzeln
    // gefiltert gefahren, und allein wäre er auf einem blinden Scanner grün.
    expect(count($result['files']))->toBeGreaterThanOrEqual(I18N_MIN_FILES, 'Scanner blind — siehe Schranken-Test.');
    expect(count($result['keys']))->toBeGreaterThanOrEqual(I18N_MIN_KEYS, 'Scanner blind — siehe Schranken-Test.');

    $report = [];
    foreach ($result['missing'] as $key => $locales) {
        $sites = array_unique($result['calls'][$key]);
        $report[] = '  '.json_encode($key, JSON_UNESCAPED_UNICODE).' fehlt in: '.implode(',', $locales).
            "\n      gerufen in: ".implode(', ', array_slice($sites, 0, 5)).
            (count($sites) > 5 ? ' (+'.(count($sites) - 5).' weitere)' : '');
    }

    expect($result['missing'])->toBe(
        [],
        count($result['missing']).' gerufene Schlüssel fehlen in mindestens einer Sprache:'."\n".implode("\n", $report)
    );
});

test('alle sieben Kataloge tragen dieselbe Schlüsselmenge — keiner darf einen Schlüssel allein haben', function () {
    $catalogs = i18nScanResult()['catalogs'];

    /*
     * Die Zählform-Sonderformen (`…#few`, `…#zero`, `…#one`, `…#many`) sind von
     * dieser Symmetrie AUSGENOMMEN, und zwar per Konstruktion: sie existieren nur
     * in der Sprache, deren CLDR-Regeln die Kategorie überhaupt erzeugen.
     * `en.json` kennt kein `few`, `pl.json` kein `zero` — ein Eintrag dort wäre
     * toter Text, den nie jemand liest und trotzdem jeder Übersetzer pflegt.
     *
     * Das nimmt der Suite nichts weg: `GroupI18nTest` prüft die Sonderformen
     * NAMENTLICH (welche Sprache welche Kategorie tragen MUSS, und dass keine
     * eine trägt, die sie nie erzeugt) — also strenger, als ein Mengenvergleich
     * es könnte. Mechanik und gemessene Kategorien stehen in
     * `js/locale.test.ts`; die Konvention selbst in `lang/README.md`.
     */
    $istGrundschluessel = fn (string $key): bool => ! str_contains($key, '#');

    $union = [];
    foreach ($catalogs as $entries) {
        $union += array_filter($entries, $istGrundschluessel, ARRAY_FILTER_USE_KEY);
    }
    $unionKeys = array_keys($union);
    sort($unionKeys, SORT_STRING);

    expect(count($unionKeys))->toBeGreaterThanOrEqual(
        I18N_MIN_KEYS,
        'Die Kataloge tragen zusammen nur '.count($unionKeys).' Schlüssel — sie sind nicht geladen, nicht symmetrisch geprüft.'
    );

    $asymmetric = [];
    foreach ($catalogs as $locale => $entries) {
        $absent = array_values(array_diff($unionKeys, array_keys($entries)));
        if ($absent !== []) {
            $asymmetric[] = '  lang/'.$locale.'.json fehlen '.count($absent).': '.
                implode(', ', array_map(fn (string $k): string => json_encode($k, JSON_UNESCAPED_UNICODE), array_slice($absent, 0, 5))).
                (count($absent) > 5 ? ' (+'.(count($absent) - 5).' weitere)' : '');
        }
    }

    expect($asymmetric)->toBe([], "Die Kataloge sind auseinandergelaufen:\n".implode("\n", $asymmetric));
});

test('kein Katalogwert ist leer — der leere String ist die Narbe der Fragment-Verkettung', function () {
    $catalogs = i18nScanResult()['catalogs'];

    $empty = [];
    foreach ($catalogs as $locale => $entries) {
        foreach ($entries as $key => $value) {
            if (trim((string) $value) === '') {
                $empty[] = '  lang/'.$locale.'.json: '.json_encode($key, JSON_UNESCAPED_UNICODE).' → ""';
            }
        }
    }

    expect($empty)->toBe(
        [],
        "Leere Übersetzungswerte gefunden — ein leerer Wert ist keine Übersetzung, sondern ein verschwundener Satzteil:\n".
        implode("\n", $empty)
    );
});

test('kein __()-Aufruf steht als verkettetes Fragment im Code', function () {
    $chained = i18nScanResult()['chained'];

    // Verkettung (`__('In ') . $label . __(' suchen')`) ist nicht übersetzbar:
    // sie zwingt jede Sprache in die deutsche Wortstellung und erzeugt genau die
    // leeren Werte, die der Test darüber verbietet. Platzhalter statt Verkettung.
    // Null ist hier kein Messwert, sondern die Aussage selbst — die Zahl wächst
    // also nie mit dem Katalog. Die vier DYNAMISCHEN Aufrufe (`__($label)`) sind
    // davon unberührt und bleiben zulässig; sie stehen im Scanner-Bericht.
    expect($chained)->toBe([], "Verkettete __()-Fragmente gefunden:\n  ".implode("\n  ", array_unique($chained)));
});
