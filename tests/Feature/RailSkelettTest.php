<?php

declare(strict_types=1);

use Illuminate\Support\Facades\Blade;
use Illuminate\Testing\TestResponse;
use Symfony\Component\HttpFoundation\Response;
use Tests\TestCase;

/**
 * Der Platzhalter des Navigators (`rail-skelett.blade.php`) und die ausdrückliche
 * Grid-Platzierung der Bühne — alles, was der SERVER entscheidet.
 *
 * ── Was hier geprüft wird und was nicht ─────────────────────────────────────────────
 * Hier: dass der Platzhalter im AUSGELIEFERTEN HTML steht, genau einmal, vor der Rail,
 * ohne bedienbares Element, und dass die Bühne ihre Spur ausdrücklich nennt. Das ist die
 * Hälfte, die kein Browser braucht.
 *
 * Nicht hier: die Geometrie. Ob der Platzhalter die Spur wirklich füllt und ob die Bühne
 * vom ersten Paint an 1120 px breit ist, entscheidet das Layout-Engine —
 * `tests/e2e/desktop-boot-geometrie.spec.ts` misst es am lebenden Element. Ein
 * Server-Test, der `xl:col-start-2` im HTML findet, hat über die gerenderte Breite nichts
 * gesagt.
 *
 * ── Warum diese Datei im Host liegt ────────────────────────────────────────────────
 * `packages/einundzwanzig-group` hat kein `tests/`-Verzeichnis und keine `autoload-dev`;
 * Pest findet dort nichts. Dieselbe Begründung wie in `OrtskartenTest.php`.
 */

/**
 * Der `<div data-rail-skelett …>`-Block, und NICHTS daneben.
 *
 * **Fail-closed:** fehlt der Platzhalter, wirft die Sonde. Ein Test, der „kein `<button>`
 * gefunden" meldet, weil er gar nichts gefunden hat, prüft die leere Menge.
 *
 * Gemustert wird auf `data-rail-skelett` und die Eingrenzung läuft bis zum
 * abschließenden `</div>` des Blocks — gezählt über die Verschachtelungstiefe, nicht
 * über das erste `</div>`: der Platzhalter enthält gut 40 verschachtelte `<div>`.
 *
 * @param  TestResponse<Response>  $res
 */
function railSkelettHtml(TestResponse $res): string
{
    $html = $res->getContent();
    if ($html === false) {
        throw new RuntimeException('Response::getContent() lieferte false — die Antwort hat keinen Body.');
    }

    return railSkelettHtmlAus($html);
}

/**
 * Dasselbe aus einem rohen HTML-String — für `Blade::render`, das keine Response liefert.
 */
function railSkelettHtmlAus(string $html): string
{
    $anker = strpos($html, 'data-rail-skelett');
    if ($anker === false) {
        throw new RuntimeException('Kein Rail-Platzhalter in der Antwort (Anker data-rail-skelett fehlt).');
    }

    $start = strrpos(substr($html, 0, $anker), '<div');
    if ($start === false) {
        throw new RuntimeException('Zum Platzhalter gehört kein öffnendes <div> — Markup umgebaut?');
    }

    // Tiefenzählung über `<div`/`</div`. Der Platzhalter enthält kein anderes Element,
    // das `div` heißt, und keine Zeichenkette `<div` in einem Attributwert.
    $tiefe = 0;
    $pos = $start;
    $len = strlen($html);
    while ($pos < $len) {
        $auf = strpos($html, '<div', $pos);
        $zu = strpos($html, '</div>', $pos);
        if ($zu === false) {
            throw new RuntimeException('Der Platzhalter-Block wird nie geschlossen.');
        }
        if ($auf !== false && $auf < $zu) {
            $tiefe++;
            $pos = $auf + 4;

            continue;
        }
        $tiefe--;
        $pos = $zu + 6;
        if ($tiefe === 0) {
            return substr($html, $start, $pos - $start);
        }
    }

    throw new RuntimeException('Der Platzhalter-Block wird nie geschlossen.');
}

/**
 * Ein angemeldeter Aufruf. Gleiche Bauform wie in `OrtskartenTest.php`; die Testinstanz
 * kommt als Argument, weil PHPStan auf Pests `test()`-Helfer kein `withSession()` kennt.
 *
 * @return TestResponse<Response>
 */
function alsMitgliedAufSeite(TestCase $t, string $route): TestResponse
{
    return $t->withSession(['nostr_pubkey' => str_repeat('a', 64)])->get(route($route));
}

// ── Der Kernbeweis ──────────────────────────────────────────────────────────────────

test('KERNBEWEIS: der Platzhalter steht genau einmal, VOR der Rail, und die Bühne nennt ihre Spur', function () {
    $res = alsMitgliedAufSeite($this, 'group.articles')->assertOk();
    $html = $res->getContent();

    // 1. Genau EINMAL. Zweimal wären zwei Grid-Items in derselben Zelle, und die
    //    Zusage „eine Spalte 1" wäre verletzt.
    expect(substr_count((string) $html, 'data-rail-skelett'))->toBe(1);

    // 2. VOR der Rail. Der Platzhalter füllt die Spur, solange die Rail nicht
    //    existiert — stünde er dahinter, wäre bis zum Boot die Bühne das erste Kind
    //    im Fluss, und genau das war der Fehler.
    $skelett = strpos((string) $html, 'data-rail-skelett');
    $rail = strpos((string) $html, 'x-if="$store.viewport?.desktop"');
    // Fail-closed und zugleich die Typverengung: fehlt einer der beiden Anker, hat der
    // Reihenfolge-Vergleich keinen Gegenstand und darf nicht still „kleiner" melden.
    if ($skelett === false || $rail === false) {
        throw new RuntimeException('Platzhalter- oder Rail-Anker fehlt — die Reihenfolge ist nicht prüfbar.');
    }
    expect($skelett)->toBeLessThan($rail);

    // 3. Die Bühne nennt ihre Spur AUSDRÜCKLICH. Literal, nicht über eine Konstante:
    //    ein Symbol gegen sich selbst geprüft hält keinen Wert fest.
    expect($html)->toContain('xl:col-start-2 xl:row-start-1 xl:flex xl:min-h-0 xl:flex-col');
    // Und die Rail sitzt in derselben Zelle wie der Platzhalter.
    expect(substr_count((string) $html, 'xl:col-start-1 xl:row-start-1'))->toBe(2);

    // 4. Die Spur ist 20 rem breit — der Wert, an dem die 320 px der E2E-Messung
    //    hängen. Steht er anders da, misst der E2E-Test gegen eine andere Zahl.
    expect($html)->toContain('xl:grid-cols-[20rem_minmax(0,1fr)]');
});

test('der Platzhalter trägt kein bedienbares Element und ist für Hilfstechnik unsichtbar', function () {
    $block = railSkelettHtml(alsMitgliedAufSeite($this, 'group.articles')->assertOk());

    // Für 250 ms zwanzig leere Tab-Stopps vor dem Inhalt wären schlimmer als der
    // Sprung, den der Platzhalter behebt (WCAG 2.4.3).
    foreach (['<a ', '<a>', '<button', '<input', '<select', '<textarea', 'tabindex'] as $verboten) {
        expect($block)->not->toContain($verboten);
    }

    // Er trägt keine Information — ein Screenreader liest ihn nicht.
    expect($block)->toContain('aria-hidden="true"');

    // Und er verschwindet an derselben Bedingung, an der die Rail entsteht.
    expect($block)->toContain('x-show="!$store.viewport?.desktop"');
});

test('der Platzhalter steht auf jeder Fläche mit Chassis — nicht nur auf /articles', function () {
    // Eine Zusage über EINEN Ort ist keine: das Chassis ist `app-frame`, und das
    // trägt jede Fläche hinter dem Gate.
    foreach (['group.articles', 'group.spaces', 'group.directory'] as $route) {
        $html = alsMitgliedAufSeite($this, $route)->assertOk()->getContent();
        expect(substr_count((string) $html, 'data-rail-skelett'))->toBe(1);
    }
});

test('ohne Chassis (rail=false) gibt es keinen Platzhalter — mit Positivkontrolle', function () {
    // ── Warum dieser Test die Komponente RENDERT statt eine Route zu holen ──────────
    //
    // Hier stand zuerst ein Aufruf von `group.nostr-login`. Diese Seite rendert gar kein
    // `app-frame` (`⚡nostr-login.blade.php`), und KEIN Konsument setzt heute
    // `chrome=false`. Der Test konnte deshalb aus seinem eigenen Grund nicht rot werden:
    // entfernt man `@if ($desktop)` aus `app-frame.blade.php` komplett, blieb er grün.
    // Ein Test mit einem Namen, den er nicht einlöst, ist schlechter als kein Test — der
    // nächste Leser hält die Fläche für gedeckt.
    //
    // Jetzt ist der Gegenstand die Komponente selbst, mit beiden Schaltstellungen im
    // selben Test. Die zweite Zeile ist die POSITIVKONTROLLE: findet das Messgerät den
    // Platzhalter nicht einmal dort, wo er hingehört, sagt die erste Zeile nichts.
    config(['nativephp-internal.running' => false]);

    $ohneRail = Blade::render('<x-group::app-frame :rail="false">Inhalt</x-group::app-frame>');
    $mitRail = Blade::render('<x-group::app-frame :rail="true">Inhalt</x-group::app-frame>');

    expect($mitRail)->toContain('data-rail-skelett');
    expect($ohneRail)->not->toContain('data-rail-skelett');
    // Und die Spur der Bühne fällt mit weg — sonst hinge im Onboarding eine
    // Grid-Platzierung ohne Grid.
    expect($mitRail)->toContain('xl:col-start-2');
    expect($ohneRail)->not->toContain('xl:col-start-2');
});

test('auf dem Gerät (NativePHP) gibt es keinen Platzhalter', function () {
    // Dieselbe Bedingung wie für die Rail selbst: der Host entscheidet, nicht die
    // Breite. Ein iPad quer misst 1366 px und bekäme sonst eine Desktop-Spur.
    config(['nativephp-internal.running' => true]);

    $html = alsMitgliedAufSeite($this, 'group.articles')->assertOk()->getContent();

    expect($html)->not->toContain('data-rail-skelett');
});

test('die Zeilen des Platzhalters folgen der KONFIGURATION, nicht einer Zahl', function () {
    // ── Warum drei Längen und nicht die heutige Drei ────────────────────────────────
    //
    // Die Nav-Zeilen kamen als feste 3 im Markup und hängen jetzt an
    // `config('group.nav')`. Eine Zusicherung `toBe(3)` wäre exakt so viel wert wie die
    // feste 3 selbst: sie stimmte heute und bliebe grün, wenn jemand die Kopplung
    // zurückdreht. Geprüft wird deshalb die KOPPLUNG — mehrere Längen, und je Länge
    // muss der Platzhalter genau so viele Zeilen tragen wie die echte Rail.
    //
    // `gap-2.5 rounded-tile px-2` ist der Fingerabdruck einer Nav-Zeile: die
    // Flächenzeilen darüber (Artikel/Forge) tragen `gap-2`, der Space-Kopf trägt zwar
    // `gap-2.5`, aber kein `rounded-tile`.
    $zeile = fn (string $html): int => substr_count($html, 'gap-2.5 rounded-tile px-2');

    foreach ([2, 3, 5] as $anzahl) {
        config(['group.nav' => array_fill(0, $anzahl, [
            'key' => 'chat', 'route' => 'group.spaces', 'match' => 'group.spaces',
            'icon' => 'chat-bubble-left-right', 'label' => 'Räume', 'gate' => 'nostr',
        ])]);
        config(['nativephp-internal.running' => false]);

        $ganz = Blade::render('<x-group::app-frame :rail="true">Inhalt</x-group::app-frame>');
        $platzhalter = railSkelettHtmlAus($ganz);
        $rail = str_replace($platzhalter, '', $ganz);

        // Beide Seiten lesen dieselbe Config — und zwar für JEDE geprüfte Länge.
        expect($zeile($platzhalter))->toBe($anzahl);
        expect($zeile($rail))->toBe($anzahl);
    }
});

test('der Platzhalter bleibt unter einem Kilobyte auf der Leitung', function () {
    // Der Preis, den JEDES Telefon zahlt: unterhalb `xl` ist der Platzhalter `hidden`
    // (kein Layout, kein Paint, keine Insel), im DOM steht er trotzdem. Der Docblock
    // von `rail-skelett.blade.php` nennt dafür eine Zahl — und eine Zahl ohne Riegel
    // wandert. Hier stand sie zuerst aus einem Wegwerf-Skript, das niemand wieder
    // ausführen kann.
    //
    // Eine SCHRANKE und keine exakte Byte-Zahl: der genaue Wert bewegt sich mit jeder
    // Klassenänderung, die Aussage „das ist billig" nicht. Die Größenordnung am
    // 2026-08-21: gut 12 kB roh, nach gzip unter 600 Byte — die Schranke lässt knapp
    // das Doppelte zu und schlägt an, bevor jemand die Liste auf dreißig Zeilen
    // aufbläst.
    //
    // Bewusst als Größenordnung und nicht auf das Byte genau: hier stand „13.076 Bytes
    // roh", und die Zahl war schon eine Runde später falsch (12.639), ohne dass sich an
    // der Aussage etwas geändert hätte. Was den Wert festhält, ist die Schranke
    // darunter, nicht der Kommentar.
    $mit = (string) alsMitgliedAufSeite($this, 'group.articles')->assertOk()->getContent();
    $ohne = str_replace(railSkelettHtmlAus($mit), '', $mit);

    $aufDerLeitung = strlen((string) gzencode($mit, 6)) - strlen((string) gzencode($ohne, 6));
    expect($aufDerLeitung)->toBeLessThan(1024);
    // Und die Gegenrichtung: fände die Sonde den Block nicht, wäre die Differenz 0 und
    // die Schranke trivial erfüllt.
    expect($aufDerLeitung)->toBeGreaterThan(0);
});

test('das Lade-Skelett der Artikelliste trägt die Spaltenzahl der fertigen Liste', function () {
    $html = (string) alsMitgliedAufSeite($this, 'group.articles')->assertOk()->getContent();

    // Die Klassenliste steht ZWEIMAL in der Antwort: einmal am Lade-Skelett, einmal
    // am fertigen Raster. Genau das ist die Zusage — wechselte eines die Spurenzahl
    // und das andere nicht, sprängen beim Eintreffen der Daten alle Karten (gemessen:
    // Kartenbreite 522 px → 344 px bei 1440 px). Der Literal steht hier ausgeschrieben
    // und nicht als Variable gegen sich selbst.
    expect(substr_count($html, 'grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4'))->toBe(2);
    // Und das fertige Raster ist wirklich das zweite Vorkommen, nicht ein drittes
    // Skelett: es trägt seinen eigenen Anker.
    expect($html)->toContain('data-artikel-raster');

    // Und der Platz des Filterkopfs ist reserviert, solange geladen wird: 40 + 8 + 44
    // plus `mb-3` = **104 px**. Ohne die Reservierung rutschte die Liste beim Eintreffen
    // der Daten um genau diese 104,0 px nach unten — transformfrei gemessen, 1440 px,
    // 2026-08-21, VOR der Reparatur. (Hier stand zuerst 103,6; das war eine
    // viewport-relative Messung mitten in der `page-enter`-Animation, die 0,4 px waren
    // deren Rauschen.) Dass es heute nicht mehr passiert, hält
    // `tests/e2e/desktop-boot-geometrie.spec.ts` fest; dieser Test hier prüft nur, dass
    // die Reservierung im ausgelieferten HTML überhaupt steht.
    expect($html)->toContain('<div x-show="loading" aria-hidden="true" class="mb-3 space-y-2">');
});
