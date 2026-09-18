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

test('CORE PROOF: the bottom bar has EXACTLY three slots — Start, Search, Postfach', function () {
    $res = $this->withSession(['nostr_pubkey' => str_repeat('a', 64)])->get(route('group.bereich.chat'))->assertOk();

    // The page sits inside the app-shell (main outlet + nav), not in a bare <main>.
    $res->assertSee('data-tab-outlet', false);
    $res->assertSee('aria-label="Hauptnavigation"', false);

    $nav = bottomNavHtml($res);

    // ── Three slots, and the number is a LITERAL, not a count ─────────────────────
    // Until P2 the column class came from `count(config('group.nav'))`, and three hosts
    // published three different tab sets. Now it is markup: three slots are a property of
    // the design, not of a list.
    expect($nav)->toContain('grid-cols-3');
    expect($nav)->not->toContain('grid-cols-4');

    // Counted inside the NAV block and not across the page: "Start" also stands in the
    // brand-mark label, "Suche" in the command palette.
    expect(substr_count($nav, '>Start<'))->toBe(1);
    expect(substr_count($nav, '>Suche<'))->toBe(1);
    expect(substr_count($nav, '>Postfach<'))->toBe(1);

    // Three children in the grid, no more: two links plus the search button.
    expect(substr_count($nav, '<a'))->toBe(2);
    expect(substr_count($nav, '<button'))->toBe(1);

    // The destinations. Start and Postfach are links, Search is NOT one — it is not a
    // place, it dispatches `open-command-palette` (D6).
    expect($nav)->toContain('href="'.route('group.start').'"');
    expect($nav)->toContain('href="'.route('group.postfach').'"');
    expect($nav)->toContain('data-palette-open');
    expect($nav)->toContain('open-command-palette');

    // ── What the bar no longer carries ────────────────────────────────────────────
    // Chat, wallet and settings were the three web tabs until P2. They are areas now, resp.
    // live under „Ich" — as a tab they would be a second statement of place next to Start.
    foreach (['>Chat<', '>Wallet<', '>Einstellungen<', '>Mitglieder<'] as $altesLabel) {
        expect($nav)->not->toContain($altesLabel);
    }

    // No host exit any more and no bell: `group.exit` is gone, and the Postfach IS a slot.
    $res->assertDontSee('aria-label="Zurück zu', false);
    expect($nav)->not->toContain('icon.bell');

    // Active state: EXACTLY one row carries it, and it carries it as the TEXT colour
    // `brand-800` (6.15:1 on the nav ground zinc-50, computed with
    // `docs/plans/2026-08-11T1321-restposten-aus-ux-plan/p2-kontrast.mjs`). `brand-700`
    // would be 4.21:1 and misses the 4.5 — that is the regression this colour catches.
    //
    // On `/bereich/chat` NO slot is active: the chat surface is an area, not a nav
    // destination. The active state is therefore measured on `/start`.
    expect(substr_count($nav, 'aria-current="page"'))->toBe(0, 'an area must not colour a nav slot as active');

    $aufStart = bottomNavHtml($this->get(route('group.start'))->assertOk());
    expect(substr_count($aufStart, 'aria-current="page"'))->toBe(1, 'on /start the bar does not mark exactly one slot');
    expect(substr_count($aufStart, 'text-brand-800 dark:text-brand-400'))->toBe(1);
    expect($aufStart)->not->toContain('text-brand-700');
});

test('the avatar in the header is the one way to Ich — on every surface, and host-redirectable', function () {
    $session = ['nostr_pubkey' => str_repeat('a', 64)];

    // On EVERY surface with a header, not just on one: the avatar replaces the profile chip
    // that stood on the room list alone until P2 (and the rail footer, which never exists on
    // a phone).
    foreach (['group.start', 'group.bereich.chat', 'group.postfach', 'group.ich.lesezeichen'] as $route) {
        $html = (string) $this->withSession($session)->get(route($route))->assertOk()->getContent();

        expect(substr_count($html, 'data-app-header-avatar'))->toBe(1, $route);
        expect($html)->toContain('href="'.route('group.ich').'"');
        // Guest interception as on a nav tab: in the CAPTURE phase, because `wire:navigate`
        // commits the SPA navigation on `mousedown` already.
        expect($html)->toContain('$store.authGate.gateTap');
    }

    // And the HOST names the target. A deliberately WRONG target so the case is not
    // tautological — with the default it pointed at `/ich` anyway.
    config(['group.me_route' => 'group.ich.lesezeichen']);
    $html = (string) $this->withSession($session)->get(route('group.start'))->assertOk()->getContent();

    $anker = strpos($html, 'data-app-header-avatar');
    expect($anker)->toBeInt();
    // The `href` stands BEFORE the anchor inside the same tag — measured in the window in
    // front of it, so that no arbitrary bookmark link on the page carries the statement.
    expect(substr($html, max(0, (int) $anker - 200), 200))->toContain(route('group.ich.lesezeichen'));
});

/**
 * ── The counter-proof for the host exit (`config('group.exit')`) used to stand here ───
 *
 * The case set `group.exit` and demanded a visible „‹ Meetups" exit in the header. The key
 * is gone with P2, and with it its justification: the chat was a full-screen takeover NEXT
 * TO the app's own bar, and without an exit the user was stuck. Since Concept C there is one
 * shell in both hosts — there is no "back into the app" any more, because you never left it.
 *
 * What remains of the case is its NEGATIVE half, and that stands in the core proof above
 * (`assertDontSee('aria-label="Zurück zu')`): an exit pointing at the same frame would be a
 * claim about a border that does not exist.
 */
test('a re-introduced config(group.exit) no longer changes the header', function () {
    // The same latch as for `group.nav` below: the key is gone, but a host can set it. It
    // then has to do nothing.
    config(['group.exit' => ['route' => 'group.ich.einstellungen', 'label' => 'Meetups']]);

    $res = $this->withSession(['nostr_pubkey' => str_repeat('a', 64)])
        ->get(route('group.bereich.chat'))
        ->assertOk();

    $res->assertDontSee('aria-label="Zurück zu Meetups"', false);
    // POSITIVE CONTROL: the page was rendered at all.
    $res->assertSee('data-tab-outlet', false);
});

/**
 * Der Brand-Mark ist nicht verschwunden, er ist nur nicht mehr auf der Startseite: Der
 * `app-header` zeigt ihn als dritte Wahl — kein screen-interner Zurück-Pfeil, kein
 * Host-Ausgang, also die Marke mit Link nach Hause. `/settings` ist genau dieser Fall.
 */
test('app-header zeigt ohne back und ohne exit den Brand-Mark als Home-Link', function () {
    $this->withSession(['nostr_pubkey' => str_repeat('a', 64)])
        ->get(route('group.ich.einstellungen'))
        ->assertOk()
        ->assertSee('aria-label="Startseite"', false)
        ->assertSee('href="'.route('home').'"', false);
});

test('the bar is NO LONGER config-driven — three slots, whatever a host sets', function () {
    // The latch against going back. `config('group.nav')` is gone from all three hosts with
    // P2; a host that sets the key again tomorrow must not be able to change the bar —
    // exactly that drift was the reason for the hard cut.
    config(['group.nav' => [
        ['key' => 'chat', 'route' => 'group.bereich.chat', 'icon' => 'chat-bubble-left-right', 'label' => 'Chat', 'gate' => 'nostr'],
        ['key' => 'wallet', 'route' => 'group.bereich.wallet', 'icon' => 'bolt', 'label' => 'Wallet', 'gate' => 'nostr'],
        ['key' => 'meetups', 'route' => 'group.start', 'icon' => 'calendar', 'label' => 'Meetups', 'gate' => 'guest'],
        ['key' => 'more', 'route' => 'group.start', 'icon' => 'squares-2x2', 'label' => 'Mehr', 'gate' => 'guest'],
    ]]);

    $html = Blade::render('<x-group::bottom-nav />');

    expect($html)
        ->toContain('grid-cols-3')
        ->not->toContain('grid-cols-4')
        ->and($html)->not->toContain('>Meetups<')
        ->and($html)->not->toContain('>Mehr<');

    // POSITIVE CONTROL: the bar renders something at all, so the promises above are not
    // measuring an empty string.
    expect($html)->toContain('>Start<')->toContain('>Postfach<');
});

test('the host redirects the Start slot through `start_route` — Postfach and Search not', function () {
    // Start is the only slot with a config line: a foreign host may have a start surface of
    // its own. The Postfach is a surface OF THE PACKAGE (its island hangs on welshman), and
    // Search is not a place at all.
    config(['group.start_route' => 'group.ich']);

    $html = Blade::render('<x-group::bottom-nav />');

    expect($html)->toContain('href="'.route('group.ich').'"');
    expect($html)->toContain('href="'.route('group.postfach').'"');
});

test('nav-tab gate=nostr fängt Tap ohne Session über den authGate-Store ab', function () {
    $html = Blade::render('<x-group::nav-tab route="group.bereich.chat" icon="chat-bubble-left-right" label="Räume" gate="nostr" />');

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
    $html = Blade::render('<x-group::nav-tab route="group.bereich.chat" icon="calendar" label="Meetups" gate="guest" />');

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
    $res = $this->withSession(['nostr_pubkey' => str_repeat('a', 64)])->get(route('group.bereich.chat'))->assertOk();

    // `@js()` escapt die Anführungszeichen als `\u0022` — geprüft wird also die
    // Zeichenkette, die WIRKLICH im Attribut steht, nicht die, die man erwartet.
    $res->assertSee('\u0022id\u0022:\u0022forge\u0022', false);
    $res->assertSee('\u0022label\u0022:\u0022Forge\u0022', false);

    config(['group.workspace_url' => null]);
    $ohne = $this->withSession(['nostr_pubkey' => str_repeat('a', 64)])->get(route('group.bereich.chat'))->assertOk();

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
        ->get(route('group.bereich.chat'))
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
 * ── Two cases about the articles row of the rail FOOTER used to stand here ────────────
 *
 * They checked that the row marks itself as the current place on `/articles` and in the
 * full article view, and does not on the room list. The footer's four area rows
 * (Artikel · Forge · Lesezeichen · Verschlüsselt) are gone with P2 — D2, a hard cut: Start
 * carries "Alle Bereiche" and the command palette finds every place.
 *
 * That they ARE gone is pinned by `RailSkelettTest` ("the removed footer blocks stand on
 * NEITHER of the two sides any more"), with a positive control. The question "does the
 * surface mark the current place?" is answered for the bar by the core proof at the top;
 * for the area tiles it is answered by P6, when the rail becomes "Deine Leiste".
 */
