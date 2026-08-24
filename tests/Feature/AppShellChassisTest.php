<?php

declare(strict_types=1);

use Illuminate\Support\Facades\Blade;
use Illuminate\Testing\TestResponse;
use Symfony\Component\HttpFoundation\Response;

/**
 * P1 (App-Shell-Verschmelzung, plans/APP-SHELL-VERSCHMELZUNG.md): das additive
 * Nav-/Shell-Chassis im group-Package. Deckt ab: config-getriebene bottom-nav,
 * nav-tab-Gate, status-strip, app-shell-Chrome — und dass das ALTE Vollbild-
 * Layout (Default-Config) unverändert weiterläuft. Motion/Interaktion → E2E.
 */

/**
 * Grenzt NUR auf das `<nav>` der fixen Bottom-Bar ein — NICHT auf die Zeichenkette
 * `aria-label="Hauptnavigation"`: die trägt AUCH die Rail-Fußzeile
 * (`desktop-rail.blade.php` → `<x-group::bottom-nav orientation="rail" />`), nur mit
 * anderer Zeilenformatierung (`<nav\n    aria-label="Hauptnavigation"\n    @class(…`
 * dort vs. `<nav aria-label="Hauptnavigation" class="…` hier — deshalb griff ein
 * naiver `Str::between($html, '<nav aria-label="Hauptnavigation"', '</nav>')` nur auf
 * der Rail. Und `Str::between()` ist zusätzlich `beforeLast`, nicht die kleinste
 * Übereinstimmung: vom ERSTEN `aria-label`-Treffer (Rail, früh im Dokument) bis zum
 * LETZTEN `</nav>` im GANZEN Rest der Seite — gemessen 160.816 von 282.750 Zeichen,
 * 57 % der Antwort. Dass der ursprüngliche Test damit trotzdem eine Weile „funktionierte",
 * war Zufall der Seitenstruktur (die Palette mit ihrer eigenen „Mitglieder"-Überschrift
 * rendert NACH `{{ $slot }}`, also außerhalb der geernteten Spanne) — kein Beleg dafür,
 * dass er den Nav-Block maß.
 *
 * Der Marker hier (`fixed inset-x-0 bottom-0`) ist der unbedingte erste Eintrag im
 * `@class([...])`-Array von `bottom-nav.blade.php` — er steht NUR an der fixen Bar,
 * nie an der Rail-Fußzeile (die trägt `flex flex-col gap-0.5`). Danach reicht die
 * KLEINSTE Übereinstimmung (erstes `</nav>` nach dem Marker), weil zwischen diesem
 * Marker und dem eigenen `</nav>` kein zweites `<nav>` mehr öffnet.
 *
 * @param  TestResponse<Response>  $res
 */
function bottomNavHtml(TestResponse $res): string
{
    $content = $res->getContent();
    if ($content === false) {
        throw new RuntimeException('Response::getContent() lieferte false — die Antwort hat keinen Body.');
    }

    $start = strpos($content, 'fixed inset-x-0 bottom-0');
    if ($start === false) {
        throw new RuntimeException('Bottom-Nav-Marker "fixed inset-x-0 bottom-0" nicht gefunden — Klassenliste in bottom-nav.blade.php geändert?');
    }

    $end = strpos($content, '</nav>', $start);
    if ($end === false) {
        throw new RuntimeException('Kein schließendes </nav> nach dem Bottom-Nav-Marker gefunden.');
    }

    return substr($content, $start, $end - $start);
}

test('P2 Web-Host-Config: group.spaces rendert die 3 Web-Tabs (Chat · Wallet · Einstellungen) via app-shell', function () {
    $res = $this->withSession(['nostr_pubkey' => str_repeat('a', 64)])->get(route('group.spaces'))->assertOk();

    // Seite liegt in der app-shell (main-Outlet + config-getriebene Nav), nicht mehr
    // im rohen <main> mit hardcoded bottom-nav.
    $res->assertSee('data-tab-outlet', false);
    $res->assertSee('aria-label="Hauptnavigation"', false);
    $res->assertSee('grid-cols-3', false);
    // Web = self-host Chat+Wallet-Client: Chat · Wallet · Einstellungen — KEIN
    // Meetups/Mehr/Portal, keine „Mitglieder" als Bottom-Tab mehr (→ §3.3).
    foreach (['Chat', 'Wallet', 'Einstellungen'] as $label) {
        $res->assertSee($label);
    }
    // Gemeint ist die BOTTOM-NAV, nicht die ganze Seite und nicht die Rail-Fußzeile
    // (die trägt dieselben Tabs ein zweites Mal, s. `bottomNavHtml()`): seit P4
    // (Befehlspalette) trägt die Palette eine Sektionsüberschrift „Mitglieder" — die
    // ist kein Bottom-Tab. Eine seitenweite Zeichenketten-Prüfung beantwortet die
    // Frage „ist Mitglieder ein Tab?" nicht mehr; geprüft wird deshalb NUR die
    // fixe Bottom-Bar.
    expect(bottomNavHtml($res))->not->toContain('>Mitglieder<');
    // Wallet-Tab ist per Nav erreichbar (verlinkt die Wallet-Route).
    $res->assertSee('href="'.route('group.wallet').'"', false);
    // Kein Takeover: ohne `group.exit` (eigenständiger Web-Client) gibt es keinen
    // Host-Rücksprung — und auch keinen Home-Link. Die Startseite braucht keinen
    // Link auf sich selbst; ihre Marke ist der Space-Block (Icon + NIP-11-Name),
    // seit dem Kopf-Redesign in `60a696e` (Space- und User-Identität getrennt).
    // Der Brand-Mark lebt weiter im `app-header` — geprüft im Test darunter.
    $res->assertDontSee('aria-label="Zurück zu', false);
    $res->assertDontSee('aria-label="Startseite"', false);
    // Aktiver Tab trägt `brand-800` — die Klasse am `<a>` färbt das LABEL mit, ist also
    // TEXT (WCAG 1.4.3, ≥ 4,5:1) und nicht Grafik. Auf dem Nav-Grund `bg-zinc-50/90`
    // über der zinc-50-Seite misst brand-800 **6,15:1** (gerechnet mit
    // `docs/plans/2026-08-11T1321-restposten-aus-ux-plan/p2-kontrast.mjs brand-800 zinc-50`,
    // gerendert bestätigt als `KONTRAST[light]`-Eintrag „Chat" im Anker
    // `tests/e2e/a11y-contrast.spec.ts`, ebenfalls 6,15).
    //
    // Hier stand bis 2026-08-15 `assertSee('text-brand-700 dark:text-brand-400')` mit dem
    // Kommentar „kontrastsicherer brand-700 (≥4.5:1)". Beides war falsch, und der Test
    // war TROTZDEM grün: `nav-tab.blade.php` trägt seit der Farbumstellung 0× die
    // Zeichenkette, aber `⚡spaces.blade.php` trägt sie an seinen Icon-Chips weiter 5× —
    // und `assertSee` prüft die GANZE Seite. Der Test band den aktiven Tab nicht mehr.
    // Die Zahl war ohnehin nie richtig: brand-700 liegt auf diesem Grund bei 4,21:1
    // (`p2-kontrast.mjs brand-700 zinc-50`), reißt die 4,5 also.
    //
    // Deshalb auf die Bottom-Bar geankert und ABGEZÄHLT statt „irgendwo": die Bar trägt
    // drei Tabs, und „in der Bar steht brand-800" beantwortet die Frage „trägt der
    // AKTIVE Tab die Farbe?" nicht — genau eine Zeile darf sie tragen.
    $nav = bottomNavHtml($res);
    expect(substr_count($nav, 'aria-current="page"'))->toBe(1, 'Bottom-Bar markiert nicht genau einen Tab als aktiv');
    expect(substr_count($nav, 'text-brand-800 dark:text-brand-400'))
        ->toBe(1, 'genau der aktive Tab trägt die Textfarbe brand-800 (6,15:1) — keiner oder mehrere ist beides falsch');
    // Der Rückfall auf brand-700 als TEXTfarbe ist der Regress, den diese Phase behoben
    // hat (4,21:1 < 4,5:1). `bg-brand-700` am Aktiv-Balken bleibt davon unberührt: er ist
    // ein Grafikobjekt (1.4.11, ≥ 3:1) und trägt dort mit denselben 4,21:1.
    expect($nav)->not->toContain('text-brand-700');
    $res->assertDontSee('nav-pill absolute inset-x-0 top-0 mx-auto h-1 w-8 rounded-full bg-accent', false);
});

/**
 * Die Gegenprobe zum „kein Rücksprung"-Satz oben: Der Ausgang ist keine Eigenschaft
 * der Seite, sondern der Host-Config. Ohne diesen Test wäre die Aussage rein negativ —
 * ein versehentlich entfernter exit-Zweig fiele niemandem auf, und der Nutzer säße im
 * Vollbild-Takeover fest (genau der Fall, für den `group.exit` existiert).
 */
test('P2 Host-Takeover: mit config(group.exit) trägt group.spaces den Rücksprung, statt eines Home-Links', function () {
    config(['group.exit' => ['route' => 'group.settings', 'label' => 'Meetups']]);

    $this->withSession(['nostr_pubkey' => str_repeat('a', 64)])
        ->get(route('group.spaces'))
        ->assertOk()
        ->assertSee('aria-label="'.__('Zurück zu :label', ['label' => 'Meetups']).'"', false)
        ->assertSee('href="'.route('group.settings').'"', false)
        ->assertDontSee('aria-label="Startseite"', false);
});

/**
 * Der Brand-Mark ist nicht verschwunden, er ist nur nicht mehr auf der Startseite: Der
 * `app-header` zeigt ihn als dritte Wahl — kein screen-interner Zurück-Pfeil, kein
 * Host-Ausgang, also die Marke mit Link nach Hause. `/settings` ist genau dieser Fall.
 */
test('app-header zeigt ohne back und ohne exit den Brand-Mark als Home-Link', function () {
    $this->withSession(['nostr_pubkey' => str_repeat('a', 64)])
        ->get(route('group.settings'))
        ->assertOk()
        ->assertSee('aria-label="Startseite"', false)
        ->assertSee('href="'.route('home').'"', false);
});

test('bottom-nav iteriert config(group.nav): eine Config-Zeile ergibt vier Tabs', function () {
    config(['group.nav' => [
        ['key' => 'chat', 'route' => 'group.spaces', 'icon' => 'chat-bubble-left-right', 'label' => 'Chat', 'gate' => 'nostr'],
        ['key' => 'wallet', 'route' => 'group.spaces', 'icon' => 'bolt', 'label' => 'Wallet', 'gate' => 'nostr'],
        ['key' => 'meetups', 'route' => 'group.spaces', 'icon' => 'calendar', 'label' => 'Meetups', 'gate' => 'guest'],
        ['key' => 'more', 'route' => 'group.spaces', 'icon' => 'squares-2x2', 'label' => 'Mehr', 'gate' => 'guest'],
    ]]);

    $html = Blade::render('<x-group::bottom-nav />');

    expect($html)
        ->toContain('grid-cols-4')
        ->toContain('Chat')->toContain('Wallet')->toContain('Meetups')->toContain('Mehr');
});

test('nav-tab gate=nostr fängt Tap ohne Session über den authGate-Store ab', function () {
    $html = Blade::render('<x-group::nav-tab route="group.spaces" icon="chat-bubble-left-right" label="Räume" gate="nostr" />');

    expect($html)
        // §4.2: der Tap läuft über den globalen authGate-Store (gateTap); der Store
        // öffnet das Login-Sheet bzw. springt mit ?return auf den Login-View.
        ->toContain('$store.authGate.gateTap')
        // Das Ziel für ?return kommt aus dem Anchor-Pfad (nach Login zurück auf die Tab-Route).
        ->toContain('$el.pathname')
        // In der Capture-Phase auf mousedown/keydown abfangen — click käme nach dem
        // wire:navigate-Commit zu spät.
        ->toContain('mousedown.capture')
        ->toContain('keydown.enter.capture')
        ->toContain('wire:navigate');
});

test('nav-tab gate=guest ist ein reiner wire:navigate-Link ohne Login-Intercept', function () {
    $html = Blade::render('<x-group::nav-tab route="group.spaces" icon="calendar" label="Meetups" gate="guest" />');

    expect($html)
        ->toContain('wire:navigate')
        ->not->toContain('authGate');
});

test('status-strip trägt beide Signer-Banner in einem Strip', function () {
    $html = Blade::render('<x-group::status-strip />');

    expect($html)
        ->toContain('nostrSignerBanner')
        ->toContain('nostrReconnectBanner')
        ->toContain('Neu verbinden');
});

test('app-shell rendert Chrome (status-strip + main-Outlet + nav); chrome=false nur den Outlet', function () {
    $withChrome = Blade::render('<x-group::app-shell><p>inhalt</p></x-group::app-shell>');
    expect($withChrome)
        ->toContain('nostrSignerBanner')
        ->toContain('data-tab-outlet')
        ->toContain('aria-label="Hauptnavigation"')
        ->toContain('inhalt');

    $bare = Blade::render('<x-group::app-shell :chrome="false"><p>inhalt</p></x-group::app-shell>');
    expect($bare)
        ->toContain('data-tab-outlet')
        ->toContain('inhalt')
        ->not->toContain('aria-label="Hauptnavigation"');
});

/**
 * `pb-28` hält den Platz für die fixe Bottom-Bar frei — und ab `xl` fiel er weg,
 * OBWOHL die Bar im App-Host dort stehen bleibt.
 *
 * Die Web-Shell hat ab `xl` keine Bottom-Bar mehr (`bottom-nav.blade.php:52`
 * schaltet sie mit `xl:hidden` weg, aber nur hinter `! $native`) — dort wäre der
 * Abstand toter Boden, und `xl:pb-8` ist richtig. Im App-Host bleibt sie auf JEDER
 * Breite; dort fiel der Abstand ab 1280 px von 112 px auf 32 px und die Bar
 * überlappte den Inhalt. Gemessen am 2026-08-23 bei `NATIVEPHP_RUNNING=true`,
 * 1366 × 1024 (Tablet quer).
 *
 * **Der Host ist die richtige Frage, nicht die Breite.** Dieselbe Unterscheidung
 * wie in `app-frame.blade.php:44` und `bottom-nav.blade.php:41`.
 *
 * Geprüft wird die Klassenliste und nicht die gerenderte Höhe: Letzteres bräuchte
 * einen Browser mit gebautem CSS und einen App-Host-Server. Der Zusammenhang
 * „`xl:pb-8` vorhanden → Abstand fällt ab xl weg" ist CSS-Semantik; dieser Test
 * hält fest, dass die Klasse im App-Host NICHT gesetzt wird.
 *
 * Die zweite Hälfte ist die Gegenkontrolle: ohne sie wäre der Test auch grün,
 * wenn `xl:pb-8` NIRGENDS mehr stünde — dann hätte die Web-Shell dauerhaft
 * 112 px toten Boden, und niemand merkte es.
 */
test('pb-28 bleibt im App-Host auf jeder Breite — in der Web-Shell fällt es ab xl', function () {
    config(['nativephp-internal.running' => true]);
    $app = Blade::render('<x-group::app-shell><p>inhalt</p></x-group::app-shell>');

    expect($app)->toContain('pb-28')
        ->and($app)->not->toContain('xl:pb-8');

    // GEGENKONTROLLE: in der Web-Shell muss es weiterhin da sein.
    config(['nativephp-internal.running' => false]);
    $web = Blade::render('<x-group::app-shell><p>inhalt</p></x-group::app-shell>');

    expect($web)->toContain('pb-28')
        ->and($web)->toContain('xl:pb-8');
});

/**
 * Der Rahmen ab `xl` ist EINZEILIG — und das ist keine Kosmetik, sondern die
 * Bedingung dafür, dass Rail und Bühne bis zum unteren Fensterrand reichen.
 *
 * Im Fluss des Grids stehen DREI Kinder: Rail, Bühne und die `profile-card`
 * (ein Overlay mit geschlossenem `<dialog>`, 0 px hoch — aber eben ein Grid-Item).
 * Ohne feste Zeilenachse legt Auto-Placement die Karte in eine zweite, implizite
 * Zeile; beide Zeilen sind dann `auto`, und `align-content: stretch` verteilt den
 * freien Platz GLEICHMÄSSIG auf beide. Gemessen im isolierten Repro: Rail 672 px
 * statt 1291 px bei 1291 px Viewport — die Spalte endet mitten im Fenster, darunter
 * steht der nackte Seitengrund. Genau der Defekt aus dem Ticket vom 2026-08-16.
 *
 * Geprüft wird die Klasse und NICHT die gerenderte Höhe: Letzteres bräuchte einen
 * Browser mit gebautem CSS. Der Zusammenhang „Klasse fehlt → Spalte zu kurz" ist
 * im Repro belegt; dieser Test hält fest, dass die Klasse dort steht.
 */
test('app-frame: das Desktop-Grid hat genau EINE Zeile, sonst teilt die Profilkarte die Höhe', function () {
    $html = Blade::render('<x-group::app-frame><div id="sonde">x</div></x-group::app-frame>');

    expect($html)
        ->toContain('xl:grid-rows-1')
        // Die Zeilenachse ist nur zusammen mit `h-dvh` sinnvoll — fiele die Höhe weg,
        // gäbe es keinen freien Platz zu verteilen und der Test schützte nichts mehr.
        ->toContain('xl:h-dvh');

    // Gegenprobe zur Ursache: die Profilkarte steht wirklich IM Grid (drittes Kind).
    // Wandert sie eines Tages hinaus, darf dieser Test seine Begründung verlieren —
    // aber dann soll er auffallen, statt still weiter das Falsche zu behaupten.
    expect($html)->toContain('nostrProfileCard');

    // Und `rail=false` bleibt zeichengleich zu vorher: kein Chassis, keine Zeilenachse.
    $bare = Blade::render('<x-group::app-frame :rail="false"><div>x</div></x-group::app-frame>');
    expect($bare)->not->toContain('xl:grid-rows-1');
});

test('app-frame rendert GENAU EIN Wurzelelement (Livewire-Vertrag)', function () {
    // Livewire erlaubt pro Full-Page-Komponente genau eine Wurzel und prüft das mit
    // `DOMDocument` (SupportMultipleRootElementDetection). Ein einziges überzähliges
    // `</div>` irgendwo IM Navigator schließt den Rahmen zu früh, der Seiteninhalt
    // rutscht daneben — und jede Seite antwortet mit 500.
    //
    // Der Defekt ist stumm: Blade rendert klaglos, kein Linter schlägt an, und die
    // Fehlermeldung nennt die Livewire-Komponente, nicht die Blade-Datei mit dem
    // Tippfehler. Genau deshalb dieser Wächter — er misst dieselbe Frage mit
    // demselben Parser wie Livewire, aber am kleinsten Baustein.
    $html = Blade::render('<x-group::app-frame><div id="sonde">x</div></x-group::app-frame>');

    $dom = new DOMDocument;
    $dom->loadHTML($html, LIBXML_NOERROR);
    $body = $dom->getElementsByTagName('body')->item(0);

    $roots = 0;
    foreach ($body->childNodes as $child) {
        if ($child->nodeType === XML_ELEMENT_NODE) {
            $roots++;
        }
    }

    expect($roots)->toBe(1, 'unbalanciertes Markup in app-frame oder desktop-rail');
    // Und die Sonde muss DRIN liegen, nicht daneben — sonst wäre „1 Wurzel" auch
    // dann erfüllt, wenn der Inhalt ganz verloren ginge.
    expect($dom->getElementById('sonde'))->not->toBeNull();
});

/**
 * P1 (Restposten-Plan, „Forge in die Workspace-Nav einweben") — der Zugang zur
 * Forge-Übersicht.
 *
 * **Warum dieser Test entsteht, obwohl die Palette schon vor P1 einen
 * Forge-Befehl trug:** Mit P1 ist der eigene „Forge"-Eintrag am Fuß der Rail
 * ENTFALLEN — der Workspace ist jetzt die Forge, und die Übersicht hängt am
 * Sektionskopf. Damit ist die Befehlspalette vom Zweitweg zum tragenden Weg
 * geworden: fiele ihr Eintrag irgendwann still weg, wäre `/forge` nur noch über
 * die Adresszeile erreichbar, und kein Test würde rot. Der Eintrag ist bewusst
 * an einen konfigurierten Workspace gebunden — ein Befehl, der in einen
 * Leerzustand führt, wäre schlechter als keiner.
 */
test('P1 Forge: die Befehlspalette führt zur Übersicht — mit Workspace, und nur dann', function () {
    config(['group.workspace_url' => 'wss://buzz.test/']);
    $res = $this->withSession(['nostr_pubkey' => str_repeat('a', 64)])->get(route('group.spaces'))->assertOk();

    // `@js()` escapt die Anführungszeichen als `\u0022` — geprüft wird also die
    // Zeichenkette, die WIRKLICH im Attribut steht, nicht die, die man erwartet.
    $res->assertSee('\u0022id\u0022:\u0022forge\u0022', false);
    $res->assertSee('\u0022label\u0022:\u0022Forge\u0022', false);

    config(['group.workspace_url' => null]);
    $ohne = $this->withSession(['nostr_pubkey' => str_repeat('a', 64)])->get(route('group.spaces'))->assertOk();

    $ohne->assertDontSee('\u0022id\u0022:\u0022forge\u0022', false);
});

/**
 * P2 (Restposten-Plan, „Redesign des Workspace-Sektionskopfs") — die Reihenfolge
 * der vier Rail-Sektionen.
 *
 * **Warum das ein Test ist und keine Konvention.** Die Folge existiert an ZWEI
 * Orten: als Blockfolge in `desktop-rail.blade.php` (was das Auge sieht) und als
 * `RAIL_GROUP_ORDER` in `js/railGroups.ts` (was Alt+↑/↓ läuft). Stimmen sie
 * nicht überein, entsteht die zweite, konkurrierende Ordnung, vor der der Plan
 * warnt — und zwar lautlos: beide Seiten funktionieren für sich. Dieser Test
 * hält die Markup-Seite fest, `railGroups.test.ts` die Konstante, und
 * `buzz-rail-forge.spec.ts` hält am lebenden Bild beide gegeneinander.
 *
 * Geprüft wird die `id` des Panels und nicht die Beschriftung: die ist übersetzt
 * und wechselt mit der Sprache, die `id` ist der Vertrag zwischen Kopf und Panel.
 */
test('P2 Rail: der Workspace steht an zweiter Stelle, direkt unter den Räumen', function () {
    config(['group.workspace_url' => 'wss://buzz.test/']);

    $html = $this->withSession(['nostr_pubkey' => str_repeat('a', 64)])
        ->get(route('group.spaces'))
        ->assertOk()
        ->getContent();

    if ($html === false) {
        throw new RuntimeException('Response::getContent() lieferte false — die Antwort hat keinen Body.');
    }

    $positions = [];
    foreach (['rooms', 'workspace', 'meetups', 'proposals'] as $key) {
        $at = mb_strpos($html, 'id="rail-group-'.$key.'"');
        expect($at)->not->toBeFalse("die Rail-Sektion {$key} fehlt im Markup");
        $positions[$key] = $at;
    }

    asort($positions);

    expect(array_keys($positions))->toBe(
        ['rooms', 'workspace', 'meetups', 'proposals'],
        'die Blockfolge muss RAIL_GROUP_ORDER entsprechen (js/railGroups.ts)',
    );
});

/**
 * Der Aktiv-Zustand der Artikel-Zeile in der Rail-Fußzeile.
 *
 * **Warum das serverseitig prüfbar ist und nicht in Playwright gehört.** Der Zustand
 * kommt aus `request()->routeIs()` (`desktop-rail.blade.php`) und steht damit schon im
 * ausgelieferten HTML. Der `xl`-Viewport entscheidet nur darüber, ob Alpine das
 * `<template x-if="$store.viewport?.desktop">` INSTANZIIERT — nicht darüber, was Blade
 * hineinrendert. Die billigere Schicht trägt die Aussage also vollständig; dass die
 * Zeile im Browser auch sichtbar ist, hält `longform-reader.spec.ts` fest.
 *
 * **Warum die Zeile isoliert wird.** `/articles` ist auf derselben Seite mehrfach
 * verlinkt (Befehlspalette, Einstiegszeile im Entdecken-Block). Ein `str_contains`
 * auf das ganze Dokument würde also irgendeinen dieser Links messen — oder gar keinen,
 * und trotzdem grün werden. Der Anker ist deshalb die Kombination aus Ziel und der
 * Zeilen-Geometrie `min-h-9`, die nur die Rail-Zeile trägt.
 */
function railArtikelAnker(string $html): string
{
    preg_match_all('/<a\b[^>]*>/i', $html, $treffer);

    $zeilen = array_values(array_filter(
        $treffer[0],
        static fn (string $tag): bool => str_contains($tag, '/articles"') && str_contains($tag, 'min-h-9'),
    ));

    // Fail-closed: findet der Anker die Zeile nicht, ist das „kann ich nicht messen"
    // und nicht „bestanden". Ein Prüfwerkzeug, das bei fehlender Eingabe grün meldet,
    // misst irgendwann nichts mehr und sagt es nicht.
    expect($zeilen)->toHaveCount(1, 'die Rail-Fußzeilen-Zeile zu /articles ist nicht (oder mehrfach) im Markup — der Test misst sonst den falschen Link');

    return $zeilen[0];
}

test('Rail-Fußzeile: die Artikel-Zeile markiert sich nur auf den Artikel-Routen als aktueller Ort', function () {
    $session = ['nostr_pubkey' => str_repeat('a', 64)];

    $aufArtikeln = railArtikelAnker((string) $this->withSession($session)
        ->get(route('group.articles'))->assertOk()->getContent());

    // Programmatisch UND sichtbar: Farbe allein darf den Zustand nicht tragen
    // (WCAG 1.4.1), `aria-current` allein wäre für sehende Nutzer unsichtbar.
    expect($aufArtikeln)->toContain('aria-current="page"');
    expect($aufArtikeln)->toContain('font-semibold');
    expect($aufArtikeln)->not->toContain('text-muted');

    // Gegenprobe auf der Startseite: dieselbe Zeile, dieselbe Rail, anderer Ort.
    // Ohne diese Hälfte bliebe der Test grün, wenn `aria-current` unbedingt stünde.
    $aufSpaces = railArtikelAnker((string) $this->withSession($session)
        ->get(route('group.spaces'))->assertOk()->getContent());

    expect($aufSpaces)->not->toContain('aria-current');
    expect($aufSpaces)->toContain('text-muted');
    expect($aufSpaces)->not->toContain('font-semibold');
});

test('Rail-Fußzeile: auch die Artikel-Vollansicht zählt als "hier" — ein gelesener Artikel liegt unter Artikel', function () {
    // `naddr` muss nicht auflösbar sein: die Route rendert die Shell in jedem Fall,
    // und geprüft wird die Rail, nicht der Artikel. Genau darum steht diese Aussage
    // hier und nicht im Reader-Test.
    $anker = railArtikelAnker((string) $this->withSession(['nostr_pubkey' => str_repeat('a', 64)])
        ->get(route('group.article', ['naddr' => 'naddr1beispiel']))->assertOk()->getContent());

    expect($anker)->toContain('aria-current="page"');
});
