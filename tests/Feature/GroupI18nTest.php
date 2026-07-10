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

test('Bitcoin/Nostr-Jargon + Marke bleiben unübersetzt (Sats, npub, EINUNDZWANZIG)', function () use ($langDir) {
    $data = json_decode((string) file_get_contents($langDir.'/es.json'), true);
    // „Betrag (Sats)" behält die Einheit „Sats".
    expect($data['Betrag (Sats)'] ?? '')->toContain('Sats');
    // „npub kopieren" behält „npub".
    expect($data['npub kopieren'] ?? '')->toContain('npub');
});
