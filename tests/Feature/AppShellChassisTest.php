<?php

declare(strict_types=1);

use Illuminate\Support\Facades\Blade;

/**
 * P1 (App-Shell-Verschmelzung, plans/APP-SHELL-VERSCHMELZUNG.md): das additive
 * Nav-/Shell-Chassis im group-Package. Deckt ab: config-getriebene bottom-nav,
 * nav-tab-Gate, status-strip, app-shell-Chrome — und dass das ALTE Vollbild-
 * Layout (Default-Config) unverändert weiterläuft. Motion/Interaktion → E2E.
 */
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
    $res->assertDontSee('>Mitglieder<', false);
    // Wallet-Tab ist per Nav erreichbar (verlinkt die Wallet-Route).
    $res->assertSee('href="'.route('group.wallet').'"', false);
    // Kein Takeover: exit=null (eigenständiger Web-Client) → Brand-Mark, kein
    // Host-Rücksprung.
    $res->assertSee('aria-label="Startseite"', false);
    $res->assertDontSee('aria-label="Zurück zu', false);
    // Aktiver Tab trägt den kontrastsicheren brand-700 (≥4.5:1 auf hellem Nav-Grund),
    // nicht das AA-verletzende brand-500/text-accent (§7.6).
    $res->assertSee('text-brand-700 dark:text-brand-400', false);
    $res->assertDontSee('nav-pill absolute inset-x-0 top-0 mx-auto h-1 w-8 rounded-full bg-accent', false);
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

test('nav-tab gate=nostr fängt Tap ohne Session ab und dispatcht open-login-sheet', function () {
    $html = Blade::render('<x-group::nav-tab route="group.spaces" icon="chat-bubble-left-right" label="Räume" gate="nostr" />');

    expect($html)
        ->toContain('open-login-sheet')
        // Session korrekt aus dem JSON-serialisierten welshman-Store lesen (nicht der
        // Rohwert — "undefined"/"null" wären truthy und der Gate immer offen).
        ->toContain('JSON.parse')
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
        ->not->toContain('open-login-sheet');
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
