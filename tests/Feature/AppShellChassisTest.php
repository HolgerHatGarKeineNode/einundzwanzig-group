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
