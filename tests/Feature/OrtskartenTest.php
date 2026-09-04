<?php

declare(strict_types=1);

use Illuminate\Support\Facades\Blade;
use Illuminate\Testing\TestResponse;
use Symfony\Component\HttpFoundation\Response;
use Tests\TestCase;

/**
 * P5 des Artikel-Longform-Plans: die Ortskarten-Leiste, die Segmented-Bar und die
 * Bühnenbreite — alles, was der SERVER entscheidet.
 *
 * **Warum diese Datei im Host liegt und nicht im Package.** `packages/einundzwanzig-group`
 * hat kein `tests/`-Verzeichnis und keine `autoload-dev`; Pest findet dort nichts. Dieselbe
 * Begründung wie bei `LongformReaderTest.php` und `ArticleAuthorRouteTest.php` — die
 * geprüften Views liegen im Package, der Testläufer nicht.
 *
 * **Was hier NICHT geprüft wird:** die Live-Zeilen. Sie entstehen im Browser aus zwei
 * Relay-Abos; ein Server-Test sähe immer nur die statische Unterzeile. Ihre Regel steht
 * geprüft in `js/ortskarten.test.ts` (`zeigeLive`), ihr Verhalten in
 * `tests/e2e/desktop-p5-navigation.spec.ts`.
 */

/**
 * Der `<nav>`-Block der Ortskarten-Leiste, und NICHTS daneben.
 *
 * **Fail-closed:** findet die Sonde ihren Gegenstand nicht, wirft sie. Ein Test, der bei
 * fehlender Leiste „kein `role=tab` gefunden" meldet, prüft die leere Menge — genau die
 * Bauform, die in P4 einen Beweis ausgehöhlt hat.
 *
 * Der Anker ist `data-ortskarte="chat"` MIT Anführungszeichen: ein Präfix-Treffer
 * (`data-ortskarten…`) ist damit ausgeschlossen. Die Eingrenzung läuft vom `<nav` DAVOR
 * bis zum ersten `</nav>` danach — zwischen beiden öffnet kein zweites `<nav>`.
 *
 * @param  TestResponse<Response>  $res
 */
function ortskartenNav(TestResponse $res): string
{
    $html = $res->getContent();
    if ($html === false) {
        throw new RuntimeException('Response::getContent() lieferte false — die Antwort hat keinen Body.');
    }

    $anker = strpos($html, 'data-ortskarte="chat"');
    if ($anker === false) {
        throw new RuntimeException('Keine Ortskarten-Leiste in der Antwort (Anker data-ortskarte="chat" fehlt).');
    }

    $start = strrpos(substr($html, 0, $anker), '<nav');
    if ($start === false) {
        throw new RuntimeException('Zur Ortskarte gehört kein öffnendes <nav> — Markup umgebaut?');
    }

    $ende = strpos($html, '</nav>', $start);
    if ($ende === false) {
        throw new RuntimeException('Kein schließendes </nav> nach der Ortskarten-Leiste.');
    }

    return substr($html, $start, $ende - $start);
}

/**
 * Welche Karte trägt `aria-current="page"`? Liefert die Schlüssel, nicht nur die Zahl.
 *
 * @return list<string>
 */
function aktiveOrte(string $nav): array
{
    preg_match_all('/<a\b[^>]*>/', $nav, $m);
    $aktiv = [];
    foreach ($m[0] as $tag) {
        if (! str_contains($tag, 'aria-current="page"')) {
            continue;
        }
        preg_match('/data-ortskarte="([a-z]+)"/', $tag, $k);
        $aktiv[] = $k[1] ?? '?';
    }

    return $aktiv;
}

/**
 * Alle Ortsschlüssel in QUELLREIHENFOLGE — die Reihenfolge ist die Aussage.
 *
 * @return list<string>
 */
function ortsFolge(string $nav): array
{
    preg_match_all('/data-ortskarte="([a-z]+)"/', $nav, $m);

    return $m[1];
}

/**
 * Ein angemeldeter Aufruf.
 *
 * **Die Testinstanz kommt als ARGUMENT und nicht aus `test()`.** Der Helfer von Pest
 * liefert je nach Aufrufort `TestCall|HigherOrderTapProxy`, und auf beiden kennt PHPStan
 * kein `withSession()` — der Aufruf funktionierte zur Laufzeit und war statisch trotzdem
 * unbelegt. `$this` aus der Test-Closure ist die echte `Tests\TestCase`.
 *
 * @param  array<string, string>  $params
 * @return TestResponse<Response>
 */
function alsMitglied(TestCase $t, string $route, array $params = []): TestResponse
{
    return $t->withSession(['nostr_pubkey' => str_repeat('a', 64)])->get(route($route, $params));
}

// ── Der Kernbeweis der Phase ────────────────────────────────────────────────────────

test('KERNBEWEIS: die Ortskarten-Leiste trägt kein role="tab", und der aktive Ort trägt aria-current="page"', function () {
    config(['group.workspace_url' => 'wss://buzz.test/']);

    $nav = ortskartenNav(alsMitglied($this, 'group.spaces')->assertOk());

    // 1. Kein `role="tab"`. Die Leiste ist Navigation zwischen SEITEN; `role="tab"`
    //    verspricht ein Tabpanel im selben Dokument, das beim Aktivieren erscheint.
    //    Gescopet auf den `<nav>` — die Segmented-Bar weiter unten auf derselben Seite
    //    IST ein Tab-Widget und trägt die Rolle zu Recht.
    expect($nav)->not->toContain('role="tab"');
    expect($nav)->not->toContain('role=\'tab\'');
    // Und keine der anderen Widget-Rollen, die dieselbe Lüge in Grün wären.
    expect($nav)->not->toContain('role="tablist"');
    expect($nav)->not->toContain('role="tabpanel"');

    // 2. Es sind echte Links, keine Knöpfe.
    expect(substr_count($nav, '<a '))->toBe(3);
    expect($nav)->not->toContain('<button');

    // 3. GENAU EINE Karte ist aktiv — und es ist die richtige.
    expect(aktiveOrte($nav))->toBe(['chat']);
});

test('der aktive Ort wechselt mit der Route — beide Hälften, nicht nur die aktive', function () {
    config(['group.workspace_url' => 'wss://buzz.test/']);

    // Eine Zusage über EINEN Zustand ist keine: stünde die Leiste nur auf `/spaces`,
    // wäre `aria-current` eine Konstante und dieser Test tautologisch.
    expect(aktiveOrte(ortskartenNav(alsMitglied($this, 'group.spaces')->assertOk())))->toBe(['chat']);
    expect(aktiveOrte(ortskartenNav(alsMitglied($this, 'group.articles')->assertOk())))->toBe(['artikel']);
    expect(aktiveOrte(ortskartenNav(alsMitglied($this, 'group.forge')->assertOk())))->toBe(['forge']);
});

test('jede Ortskarte zeigt auf die Route, die sie meint — auf allen drei Flächen', function () {
    config(['group.workspace_url' => 'wss://buzz.test/']);

    /*
     * ── Warum dieser Fall eigens dasteht ──────────────────────────────────────────
     *
     * Die Komponente hat GENAU EINEN `route()`-Aufruf, und sein Argument ist eine
     * Variable (`route($ort['route'])`). Eine Editor-Diagnose meldete dafür „Route
     * [route] not found" — sie kann den Wert nicht auflösen und nimmt den Literaltext.
     * Nachgemessen: alle sieben Routennamen, die die Komponente nennt, existieren
     * (`php artisan route:list`), die sechs übrigen stehen ausschließlich in
     * `routeIs()`-Listen und würden nie werfen. Die Meldung ist also Rauschen.
     *
     * Ein echter Tippfehler an dieser Stelle wäre aber ein 500er ZUR LAUFZEIT, und
     * zwar nur auf der Fläche, auf der die betroffene Karte gerendert wird — auf einer
     * einzelnen Fläche gemessen bliebe er unsichtbar. Deshalb geht dieser Fall über
     * alle drei und vergleicht die ZIELE, nicht bloß den Statuscode: ein falscher,
     * aber existierender Name käme sonst grün durch.
     */
    $erwartet = [
        'chat' => route('group.spaces'),
        'artikel' => route('group.articles'),
        'forge' => route('group.forge'),
    ];

    foreach (['group.spaces', 'group.articles', 'group.forge'] as $flaeche) {
        $nav = ortskartenNav(alsMitglied($this, $flaeche)->assertOk());
        preg_match_all('/<a\b[^>]*data-ortskarte="([a-z]+)"[^>]*>/', $nav, $m, PREG_SET_ORDER);
        // Reihenfolge der Attribute ist nicht garantiert — das `href` steht vor dem
        // `data-ortskarte`. Deshalb je Treffer den ganzen Tag noch einmal absuchen.
        $gefunden = [];
        foreach ($m as $treffer) {
            preg_match('/href="([^"]+)"/', $treffer[0], $h);
            $gefunden[$treffer[1]] = $h[1] ?? '';
        }

        expect($gefunden)->toBe($erwartet, "Ziele der Ortskarten auf „$flaeche\"");
    }
});

test('Chat ist auf BEIDEN Ebenen der erste Eintrag', function () {
    config(['group.workspace_url' => 'wss://buzz.test/']);

    $res = alsMitglied($this, 'group.spaces')->assertOk();
    $html = (string) $res->getContent();

    // Ebene 1: die Ortskarten, in Quellreihenfolge.
    expect(ortsFolge(ortskartenNav($res)))->toBe(['chat', 'artikel', 'forge']);

    // Ebene 2: die Segmented-Bar darunter. „Räume" IST der Chat — und steht vor „Threads".
    // `if`-Riegel statt `expect(...)->not->toBeFalse()`: der Vergleich darunter braucht
    // ECHTE Zahlen. `strpos` liefert `int|false`, und `false < 5` wäre in PHP wahr — ein
    // fehlender Tab käme so als „steht ganz vorn" durch.
    $raeume = strpos($html, 'name="rooms"');
    $threads = strpos($html, 'name="threads"');
    $chat = strpos($html, 'data-ortskarte="chat"');
    if ($raeume === false || $threads === false || $chat === false) {
        throw new RuntimeException('Segmented-Bar oder Ortskarte fehlen in der Antwort — der Test misst nichts.');
    }

    expect($raeume)->toBeLessThan($threads);

    // Und die Leiste steht ÜBER der Bar, nicht darunter.
    expect($chat)->toBeLessThan($raeume);
});

// ── Die Segmented-Bar ───────────────────────────────────────────────────────────────

test('die Segmented-Bar hat in BEIDEN Config-Fällen genau zwei Einträge', function (?string $workspace) {
    config(['group.workspace_url' => $workspace]);

    $html = (string) alsMitglied($this, 'group.spaces')->assertOk()->getContent();

    // Gezählt wird `data-flux-tab="data-flux-tab"` und NICHT `role="tab"`: Flux setzt die
    // Rolle erst im Browser (`initializeTab`), serverseitig steht sie nirgends. Wer hier
    // `role="tab"` zählte, bekäme in jeder Konfiguration 0 und hielte das für einen Beweis.
    // Der volle Attributwert schließt zugleich den Container `data-flux-tabs` aus — ein
    // Teilstring-Treffer auf `data-flux-tab` fände ihn mit.
    //
    // Vor P5 waren es mit gesetzter Config drei Tabs — der dritte hing an einem
    // `<template x-if>` und existierte damit nur in EINER der beiden Konfigurationen.
    expect(substr_count($html, 'data-flux-tab="data-flux-tab"'))->toBe(2);

    // Und der abgewanderte Tab steht nirgends mehr im Markup dieser Seite.
    expect($html)->not->toContain('name="workspaces"');
})->with([
    'mit Workspace' => 'wss://buzz.test/',
    'ohne Workspace' => null,
]);

test('/spaces?tab=workspaces führt die alte Adresse weiter, statt sie zu verschlucken', function () {
    config(['group.workspace_url' => 'wss://buzz.test/']);

    // Ohne diese Weiterleitung landete jeder Bookmark WORTLOS auf „Räume": die Adresse
    // behauptet das eine, der Bildschirm zeigt das andere. Genau der Fehler, gegen den
    // die Whitelist in `js/spacesTab.ts` überhaupt geschrieben wurde.
    $this->withSession(['nostr_pubkey' => str_repeat('a', 64)])
        ->get('/spaces?tab=workspaces')
        ->assertRedirect(route('group.forge').'?tab=workspaces');
});

test('die Weiterleitung greift NUR für workspaces — jede andere Adresse rendert normal', function () {
    config(['group.workspace_url' => 'wss://buzz.test/']);

    foreach (['', '?tab=threads', '?tab=rooms', '?tab=quatsch'] as $query) {
        $this->withSession(['nostr_pubkey' => str_repeat('a', 64)])
            ->get('/spaces'.$query)
            ->assertOk();
    }
});

// ── Die Forge-Karte und die Config ──────────────────────────────────────────────────

test('ohne Workspace-Config entfällt die Forge-Karte, und die Leiste hat zwei Spalten', function () {
    config(['group.workspace_url' => null]);

    $nav = ortskartenNav(alsMitglied($this, 'group.spaces')->assertOk());

    expect(ortsFolge($nav))->toBe(['chat', 'artikel']);
    expect($nav)->toContain('grid-cols-2');
    expect($nav)->not->toContain('grid-cols-3');
    // Die Zusage bleibt auch hier ganz: genau eine Karte ist aktiv.
    expect(aktiveOrte($nav))->toBe(['chat']);
});

test('auf einer Forge-Route steht die Karte auch OHNE Config — sonst wäre keine Karte aktiv', function () {
    config(['group.workspace_url' => null]);

    $nav = ortskartenNav(alsMitglied($this, 'group.forge')->assertOk());

    expect(ortsFolge($nav))->toBe(['chat', 'artikel', 'forge']);
    expect(aktiveOrte($nav))->toBe(['forge']);
});

// ── Die Bühnenbreite ────────────────────────────────────────────────────────────────

test('BEIDE Breiten-Literale stehen im Quelltext der app-shell — sonst scannt Tailwind sie nie', function () {
    $quelle = (string) file_get_contents(
        __DIR__.'/../../packages/einundzwanzig-group/resources/views/components/app-shell.blade.php'
    );

    // WÖRTLICH, und beide: ein zusammengesetzter Klassenname (`xl:max-w-[{{ $x }}]`)
    // entstünde erst zur Laufzeit. Tailwind scannt den QUELLTEXT — die Klasse existierte
    // im gebauten Stylesheet nie, und die Fläche fiele stumm auf volle Breite zurück.
    expect($quelle)->toContain('xl:max-w-[62rem]');
    expect($quelle)->toContain('xl:max-w-[96rem]');
});

test('genau drei Views fahren die breite Bühne — die übrigen bleiben auf dem Lesedeckel', function () {
    config(['group.workspace_url' => 'wss://buzz.test/']);

    $breit = [
        'group.articles' => [],
        'group.forge' => [],
        'group.forge.repo' => ['naddr' => 'naddr1beispiel'],
    ];
    // `str_contains(...)` statt `expect($html)->toContain(...)`: Pests `toContain` ist
    // VARIADISCH — ein zweites Argument ist ein weiterer Suchbegriff, keine Meldung. Wer
    // dort eine Begründung hineinschreibt, sucht sie im HTML mit. Die Meldung gehört
    // deshalb an `toBeTrue()`/`toBeFalse()`, und die suchen nichts.
    foreach ($breit as $route => $params) {
        $html = (string) alsMitglied($this, $route, $params)->assertOk()->getContent();
        expect(str_contains($html, 'xl:max-w-[96rem]'))->toBeTrue("„$route\" sollte die breite Bühne fahren.");
        expect(str_contains($html, 'xl:max-w-[62rem]'))->toBeFalse("„$route\" trägt zusätzlich den Lesedeckel.");
    }

    // Die Gegenprobe, und die zählt genauso: die Shell-Nutzer, die NICHT umgestellt
    // wurden, dürfen sich um kein Zeichen geändert haben.
    $schmal = ['group.spaces', 'group.updates', 'group.directory'];
    foreach ($schmal as $route) {
        $html = (string) alsMitglied($this, $route)->assertOk()->getContent();
        expect(str_contains($html, 'xl:max-w-[62rem]'))->toBeTrue("„$route\" sollte auf dem Lesedeckel bleiben.");
        expect(str_contains($html, 'xl:max-w-[96rem]'))->toBeFalse("„$route\" ist versehentlich auf die breite Bühne gerutscht.");
    }
});

test('genau fünf Views übergeben eine width-Prop — belegt am Quelltext, nicht an der Antwort', function () {
    $wurzel = __DIR__.'/../../packages/einundzwanzig-group/resources/views';
    $treffer = [];
    foreach (glob($wurzel.'/*.blade.php') ?: [] as $datei) {
        if (str_contains((string) file_get_contents($datei), 'app-shell width=')) {
            $treffer[] = basename($datei);
        }
    }
    sort($treffer);

    // Die prüfbare Zusage: genau FÜNF Dateien reichen eine `width` durch —
    // seit der GitHub-Parität (2026-08-27) kommen die beiden EINZELANSICHTEN
    // eines Vorgangs hinzu (`⚡forge-issue`, `⚡forge-pull`): dieselbe dichte
    // Fläche wie die Repo-Seite, deshalb deren breite Bühne.
    expect($treffer)->toBe([
        '⚡articles.blade.php',
        '⚡forge-issue.blade.php',
        '⚡forge-pull.blade.php',
        '⚡forge-repo.blade.php',
        '⚡forge.blade.php',
    ]);
    // Stand 2026-09-03: 16 Views im Verzeichnis (15 + `⚡bookmarks`, P2). Die
    // Lesezeichen-Fläche reicht ABSICHTLICH keine `width` durch — sie ist eine
    // Liste wie `/updates`, keine dichte Fläche wie die Forge; sie steht deshalb
    // in der Zählung, aber nicht in der Aufzählung darüber.
    expect(count(glob($wurzel.'/*.blade.php') ?: []))->toBe(16);
});

// ── Der Einstieg in die Autorenseite (Schritt 25a) ──────────────────────────────────

test('die Artikel-Vollansicht trägt einen Link auf die Autorenseite', function () {
    $html = (string) alsMitglied($this, 'group.article', ['naddr' => 'naddr1beispiel'])->assertOk()->getContent();

    // Der Server rendert die Hülle; das Ziel rechnet die Insel aus dem Pubkey des
    // geladenen Artikels (`autorHref()`). Geprüft wird hier, dass der Anker überhaupt
    // im ausgelieferten Markup steht — dass er zur Autorenseite FÜHRT, prüft der
    // Durchklick-Test in `tests/e2e/desktop-p5-navigation.spec.ts`.
    expect($html)->toContain('data-autor-link');
    expect($html)->toContain('autorHref()');
});

// ── Der Desktop-Navigator (Schritte 22 und 23) ──────────────────────────────────────

test('die Rail-Sektion heißt „Forge", der Gruppenschlüssel bleibt „workspace"', function () {
    config(['group.workspace_url' => 'wss://buzz.test/']);

    $html = (string) alsMitglied($this, 'group.spaces')->assertOk()->getContent();

    // Die BESCHRIFTUNG ist neu — sichtbar am Sektionskopf und im Auf-/Zuklapp-Label.
    expect($html)->toContain('Bereich Forge auf- oder zuklappen');
    expect($html)->not->toContain('Bereich Workspace auf- oder zuklappen');

    // Der SCHLÜSSEL ist unverändert: er steht in `RAIL_GROUP_ORDER`, in `railTargets`
    // (Alt+↑/↓) und in gespeicherten Faltungszuständen — ihn mitzuziehen wäre eine
    // Datenmigration für einen Anzeigenamen. Sichtbar wird er als Kennung des
    // aufklappbaren Bereichs (`rail-group-<key>`, `rail-group.blade.php`).
    expect($html)->toContain('id="rail-group-workspace"');
    expect($html)->not->toContain('id="rail-group-forge"');
});

test('der Tastatur-Hilfetext der Rail nennt f: und nicht mehr w:', function () {
    config(['group.workspace_url' => 'wss://buzz.test/']);

    $html = (string) alsMitglied($this, 'group.spaces')->assertOk()->getContent();

    // WÖRTLICH: `f:` ist auch das Kürzel, das die Lupe ins Feld schreibt
    // (`scopeToken`, geprüft in `js/railGroups.test.ts`). Ein Hilfetext, der ein anderes
    // Kürzel verspricht als die Oberfläche schreibt, sind zwei Wahrheiten über dieselbe
    // Taste. `w:` funktioniert weiter — es steht hier nur nicht mehr, weil ein Hilfetext
    // EINEN Weg nennt.
    expect($html)->toContain('m: p: r: f: grenzen ein');
    expect($html)->not->toContain('m: p: r: w: grenzen ein');
});

test('die Rail-Fußzeile trägt Artikel UND Forge — in dieser Reihenfolge', function () {
    config(['group.workspace_url' => 'wss://buzz.test/']);

    $html = (string) alsMitglied($this, 'group.spaces')->assertOk()->getContent();

    // Über `data-rail-fuss` und nicht über den Text: „Artikel" und „Forge" stehen auf
    // derselben Seite noch in der Ortskarten-Leiste und am Sektionskopf des Scrollers.
    // Ein Text-Anker maß dort irgendeine der drei Stellen — gemessen am 2026-08-21, als
    // `Forge</span>` bei Zeichen 37.818 (Ortskarte) statt in der Fußzeile traf.
    $artikel = strpos($html, 'data-rail-fuss="artikel"');
    $forge = strpos($html, 'data-rail-fuss="forge"');
    if ($artikel === false || $forge === false) {
        throw new RuntimeException('Artikel- oder Forge-Zeile fehlt in der Rail-Fußzeile — der Test misst nichts.');
    }

    expect($artikel)->toBeLessThan($forge);
});

test('ohne Workspace-Config bleibt die Forge-Zeile der Fußzeile aus', function () {
    config(['group.workspace_url' => null]);

    $html = (string) alsMitglied($this, 'group.spaces')->assertOk()->getContent();

    expect($html)->toContain('data-rail-fuss="artikel"');
    expect($html)->not->toContain('data-rail-fuss="forge"');
});

// ── 33ab: ein Glyph, zwei Bedeutungen ───────────────────────────────────────────────

/**
 * Die `d`-Werte aller `<path>` eines SVG — das, was ein Nutzer als FORM sieht.
 *
 * Verglichen wird die Geometrie und nicht der Icon-Name, weil der Name im gerenderten
 * HTML gar nicht mehr vorkommt: Flux inlint das SVG. Ein Test auf `icon="…"` prüfte die
 * Blade-Quelle, nicht die Seite.
 *
 * Fail-closed: kein `<path>` gefunden heißt, die Sonde hat ihren Gegenstand verloren.
 *
 * @return list<string>
 */
function svgPfade(string $svg): array
{
    preg_match_all('/ d="([^"]+)"/', $svg, $treffer);
    if ($treffer[1] === []) {
        throw new RuntimeException('Kein <path d="…"> im SVG — diese Sonde misst nichts.');
    }

    return $treffer[1];
}

/** Das erste `<svg>` NACH einem Anker. Wirft, wenn der Anker oder das SVG fehlt. */
function svgNach(string $html, string $anker): string
{
    $von = strpos($html, $anker);
    if ($von === false) {
        throw new RuntimeException("Anker '{$anker}' nicht gefunden — der Test misst nichts.");
    }
    $auf = strpos($html, '<svg', $von);
    $zu = $auf === false ? false : strpos($html, '</svg>', $auf);
    if ($auf === false || $zu === false) {
        throw new RuntimeException("Kein SVG hinter '{$anker}'.");
    }

    return substr($html, $auf, $zu - $auf + 6);
}

/**
 * **Der Threads-Tab und die Chat-Ortskarte tragen nicht mehr dasselbe Zeichen.**
 *
 * Bis zum P7-Gate war beides `chat-bubble-left-right` — zwei verschiedene Ziele, ein
 * Symbol, zwanzig Pixel auseinander (Nielsen #4, Konsistenz und Standards).
 *
 * **Warum der Vergleich gegen GERENDERTE Referenzen läuft und nicht Karte gegen Tab:**
 * die beiden stehen in verschiedenen Größen im Markup (Ortskarte `viewBox 0 0 24 24`,
 * Tab `viewBox 0 0 20 20`). Heroicons zeichnet für jede Größe eigene Pfade — ein direkter
 * Vergleich der beiden Stellen wäre also auch dann grün geblieben, wenn BEIDE weiterhin
 * die Sprechblase zeigten. Genau diese Sorte tautologisch grüner Test ist der Grund,
 * warum es diesen Fall überhaupt gibt.
 */
test('Threads-Tab und Chat-Ortskarte zeigen verschiedene Zeichen', function () {
    config(['group.workspace_url' => 'wss://buzz.test/']);
    $html = (string) alsMitglied($this, 'group.spaces')->assertOk()->getContent();

    $tab = svgPfade(svgNach($html, 'data-flux-tab="data-flux-tab" name="threads"'));
    $karte = svgPfade(svgNach($html, 'data-ortskarte="chat"'));

    // 1. Der Tab zeigt WIRKLICH den Antwort-Pfeil — die Positivkontrolle. Ohne sie
    //    bestünde der Fall auch mit einem Icon, das gar nicht rendert.
    expect($tab)->toBe(svgPfade(Blade::render('<flux:icon.arrow-turn-down-right variant="mini" />')));

    // 2. Und NICHT die Sprechblase, in genau der Größe, in der er sie zeigen würde.
    expect($tab)->not->toBe(svgPfade(Blade::render('<flux:icon.chat-bubble-left-right variant="mini" />')));

    // 3. Die Ortskarte behält ihr Bubble-Zeichen: das ist die andere Hälfte der Aussage.
    //    Getauscht wurde EIN Glyph, nicht die Ikonografie der Seite.
    //    `variant="solid"`, weil die Karte genau die gefüllte Fassung rendert (viewBox 24,
    //    `fill="currentColor"`) — mit der Outline-Fassung verglichen wäre der Fall aus dem
    //    falschen Grund rot, und ein „Variante angepasst"-Reflex hätte ihn entschärft.
    expect($karte)->toBe(svgPfade(Blade::render('<flux:icon.chat-bubble-left-right variant="solid" />')));
});
