<?php

declare(strict_types=1);

/**
 * D4 (A11y & Responsive): die Blade-tragenden Teile des Theme-Switch + der
 * Kontrast-/Responsive-Umstellung. Reines CSS-Verhalten (Focus-Ring, 44px-Ziele,
 * reduced-motion) deckt der CSS-Build ab; das Theme-Switch-Verhalten Playwright.
 */
test('Layout ist enthärtet: kein hartes class="dark" mehr → @fluxAppearance steuert das Theme', function () {
    $res = $this->withSession(['nostr_pubkey' => str_repeat('a', 64)])->get(route('group.spaces'))->assertOk();

    // Ohne hartes class="dark" lebt Light und der geteilte flux.appearance-Store greift.
    $res->assertSee('<html lang="de">', false);
    $res->assertDontSee('class="dark" data-theme="dark"', false);
});

test('Einstellungen-Tab: Theme-Switch bindet an den geteilten $flux.appearance-Store', function () {
    $res = $this->withSession(['nostr_pubkey' => str_repeat('a', 64)])->get(route('group.space.settings'))->assertOk();

    $res->assertSee('Darstellung');
    $res->assertSee('x-model="$flux.appearance"', false);
    // Hell · Auto · Dunkel als segmentierte Auswahl.
    $res->assertSee('value="light"', false);
    $res->assertSee('value="system"', false);
    $res->assertSee('value="dark"', false);
});

test('Sekundärtext läuft über text-muted (AA/AAA in beiden Themes) statt text-zinc-500', function () {
    $res = $this->withSession(['nostr_pubkey' => str_repeat('a', 64)])->get(route('group.directory'))->assertOk();

    $res->assertSee('text-muted', false);
});

test('Handy-Spalte verbreitert sich auf Desktop (Breakpoints statt fixer max-w-md)', function () {
    $res = $this->withSession(['nostr_pubkey' => str_repeat('a', 64)])->get(route('group.spaces'))->assertOk();

    $res->assertSee('md:max-w-lg lg:max-w-2xl', false);
});
