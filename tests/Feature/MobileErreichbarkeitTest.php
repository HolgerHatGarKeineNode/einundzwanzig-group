<?php

declare(strict_types=1);

use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * **Die Einstiege, die es unterhalb `xl` vorher NICHT gab.**
 *
 * Fünf Sachen hingen im Chat-Client ausschließlich an der Desktop-Rail oder an der
 * Befehlspalette. Die Rail rendert der NativePHP-Host serverseitig nie
 * (`app-frame.blade.php`: `$rail && ! Chassis::istApp()`) und der Web-Client erst ab
 * `xl` (`<template x-if="$store.viewport?.desktop">`) — auf einem Telefon und in einem
 * schmalen Fenster war das also gar kein Weg. Die Befehlspalette war der andere, und sie
 * ist im Mobile-Host auf den Host-Screens sogar von der App-eigenen Suche überlagert
 * (`layouts/mobile.blade.php` fängt `open-command-palette` ab).
 *
 * Gezählt wurde am Bestand, nicht geschätzt: `route('group.directory')` und
 * `route('group.settings')` kamen im ganzen Paket an GENAU EINER Stelle vor
 * (`command-palette.blade.php`), `route('group.bookmarks')` an zweien (Palette und
 * Rail-Fußzeile).
 *
 * ── Was diese Datei prüft und was NICHT ──────────────────────────────────────────
 *
 * Sie prüft die ANWESENHEIT und die ZUORDNUNG der Einstiege im ausgelieferten HTML —
 * also das, was ein Server-Test entscheiden kann. Die Geometrie (44-px-Ziele, kein
 * Überlauf bei 320 px, die Position des Abschnitts) ist am gerenderten Element gemessen
 * worden und gehört nicht hierher: eine CSS-Klassen-Assertion ist keine Messung.
 */
function mitSitzung(TestCase $t, string $route, array $params = []): TestResponse
{
    return $t->withSession(['nostr_pubkey' => str_repeat('a', 64)])->get(route($route, $params));
}

// ── Der Kernbeweis ──────────────────────────────────────────────────────────────────

test('KERNBEWEIS: /spaces trägt die drei Einstiege, die es unterhalb xl vorher nicht gab', function () {
    $html = (string) mitSitzung($this, 'group.spaces')->assertOk()->getContent();

    // 1. Das Mitgliederverzeichnis — am Space-Block, also bei der Frage „wer ist hier".
    expect($html)->toContain('data-space-mitglieder');
    expect($html)->toContain(route('group.directory'));

    // 2./3. Lesezeichen und Einstellungen — in der Identitäts-Schublade.
    expect($html)
        ->toContain('data-profil-ziel="group.bookmarks"')
        ->toContain('data-profil-ziel="'.config('group.settings_route').'"');

    // Und der Abschnitt für die Unterhaltungen, samt seinem Eröffnen-Knopf.
    expect($html)
        ->toContain('data-dm-panel')
        ->toContain('data-dm-neu');
});

test('der DM-Abschnitt hängt an der Breite UND am Tab — nicht nur an einem von beiden', function () {
    $html = (string) mitSitzung($this, 'group.spaces')->assertOk()->getContent();

    // Die Bedingung steht im `x-if` des Aufrufers. Alle drei Teile müssen darin
    // stehen, und zwar aus je eigenem Grund:
    //   `tab === 'rooms'` — Flux lässt das Panel eines NICHT gewählten Tabs im DOM,
    //   `!focusMode()`    — im Fokus-Modus zeigt die Karte genau eine Liste,
    //   `!desktop`        — ab xl trägt die Rail die Unterhaltungen.
    // Fehlte einer, meldete `armList()` eine Ableitung an, die niemand sieht: Alpine
    // initialisiert `x-data` auch in per CSS versteckten Elementen.
    expect($html)->toContain('tab === &#039;rooms&#039; &amp;&amp; !focusMode() &amp;&amp; !$store.viewport?.desktop');
});

// ── Der Dialog ist umgezogen, und zwar vollständig ──────────────────────────────────

test('der DM-Dialog steht genau EINMAL im Dokument, und nicht mehr in der Rail', function () {
    $html = (string) mitSitzung($this, 'group.spaces')->assertOk()->getContent();

    // `flux:modal name="dm"` rendert `data-modal="dm"` — genau einer. Zwei wären zwei
    // `<dialog>` unter demselben Namen, und `dispatchModal(DM_MODAL)` träfe beide.
    expect(substr_count($html, 'data-modal="dm"'))->toBe(1);

    // Und die eigentliche Aussage: er hängt nicht mehr AN DER RAIL. „Einmal vorhanden"
    // wäre auch dann grün, wenn er dort geblieben wäre — die Rail steht auf dieser
    // Seite ja im DOM. Geprüft wird deshalb die Quelle, mit entfernten Kommentaren:
    // `desktop-rail.blade.php` ERKLÄRT den Umzug in Prosa, ein roher Textvergleich
    // fände also seine eigene Begründung.
    $views = __DIR__.'/../../packages/einundzwanzig-group/resources/views/components/';
    $ohneKommentare = fn (string $datei): string => (string) preg_replace(
        '/\{\{--[\s\S]*?--\}\}/', '', (string) file_get_contents($views.$datei)
    );

    expect($ohneKommentare('desktop-rail.blade.php'))->not->toContain('<x-group::dm-modal');
    expect($ohneKommentare('app-frame.blade.php'))->toContain('<x-group::dm-modal');

    // CONTROL: der Kommentar-Entferner entfernt wirklich — sonst prüfte der Fall Prosa.
    expect(file_get_contents($views.'desktop-rail.blade.php'))->toContain('dm-modal');
});

test('der Dialog steht auf JEDER Seite hinter dem Gate — dort, wo auch der Store angemeldet wird', function () {
    // Das ist die Zusage, die den Ort begründet: `app-frame` ist die Wurzel genau
    // dieser Seiten, und `$store.dms.mount()` läuft in derselben Datei. Ein Dialog auf
    // einer Seite ohne Store hätte `canDm === false` und eine leere Vorschlagsliste.
    foreach (['group.spaces', 'group.directory', 'group.bookmarks', 'group.updates'] as $route) {
        $html = (string) mitSitzung($this, $route)->assertOk()->getContent();

        expect(substr_count($html, 'data-modal="dm"'))->toBe(1, $route);
        expect($html)->toContain('$store.dms?.mount()');
    }
});

// ── Der eigene Präsenzpunkt ─────────────────────────────────────────────────────────

test('der eigene Präsenzpunkt hängt am Profil-Chip — mit demselben Ausdruck wie in der Rail', function () {
    $html = (string) mitSitzung($this, 'group.spaces')->assertOk()->getContent();

    // Der Punkt ist EIN Attribut, und der Ausdruck ist der springende Punkt:
    // `$store.presence.mine` und nicht `byPubkey[<self>]` — der Relay fanoutet das
    // eigene 20001 nicht verlässlich an die eigene Verbindung zurück.
    expect(substr_count($html, 'presence="$store.presence?.mine"'))->toBeGreaterThanOrEqual(1);

    // Positivkontrolle für die Zuordnung: der Ausdruck steht im Chip-Block, nicht
    // irgendwo auf der Seite. Gemessen am Abstand zum Chip-Anker — dazwischen liegt
    // nur der Avatar.
    $chip = strpos($html, 'data-profil-chip');
    $punkt = strpos($html, 'presence="$store.presence?.mine"', $chip === false ? 0 : $chip);
    expect($chip)->toBeInt();
    expect($punkt)->toBeInt();
    expect($punkt - $chip)->toBeLessThan(2000);
});

// ── Die Einstellungen-Route kommt vom HOST ──────────────────────────────────────────

test('Palette und Profil-Chip führen an DIESELBE Einstellungen-Route, und die nennt der Host', function () {
    config(['group.settings_route' => 'group.bookmarks']);

    $html = (string) mitSitzung($this, 'group.spaces')->assertOk()->getContent();

    // Ein absichtlich FALSCHES Ziel, damit der Fall nicht tautologisch ist: mit dem
    // Default zeigten beide ohnehin auf `/settings`, und die Config-Zeile bliebe
    // unbewiesen. Beide Leser müssen jetzt auf `/bookmarks` zeigen.
    // Der Chip trägt jetzt ZWEIMAL `group.bookmarks` (Lesezeichen + die umgeleiteten
    // Einstellungen) und KEIN `group.settings` mehr. Gegen den Anker geprüft und nicht
    // gegen die URL: `/settings` steht auf dieser Seite ohnehin — die Package-Default-Nav
    // führt einen Einstellungen-Tab, und der ist von dieser Config nicht betroffen.
    expect(substr_count($html, 'data-profil-ziel="group.bookmarks"'))->toBe(2);
    expect($html)->not->toContain('data-profil-ziel="group.settings"');
});

test('CONTROL: mit dem Default zeigen beide auf die package-eigene Route', function () {
    // Die Gegenprobe zum Fall darüber — ohne sie könnte `settings_route` auch schlicht
    // immer ignoriert und immer `/bookmarks` gerendert werden.
    expect(config('group.settings_route'))->toBe('group.settings');

    $html = (string) mitSitzung($this, 'group.spaces')->assertOk()->getContent();

    expect($html)
        ->toContain('data-profil-ziel="group.settings"')
        ->toContain(route('group.settings'));
});
