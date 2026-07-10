<?php

declare(strict_types=1);

/**
 * P7 (UX-Politur/AAA): die Blade-tragenden Marker der vier DoD-Kriterien —
 * Reduced-Motion, keine Layout-Shifts (Skeleton deckt ChatStatesTest), Tap ≥44px,
 * Kontrast. Reines Motion-/Contrast-Verhalten (CSS) deckt der Build; hier wird
 * geprüft, dass die Guards/Utilities im gerenderten Markup ankommen.
 */
function authed()
{
    return test()->withSession(['nostr_pubkey' => str_repeat('a', 64)]);
}

test('Login-Sheet: Slide/Scale sind reduced-motion-gegated (Fade bleibt)', function () {
    // Global im Layout gemountet → auf jeder Chrome-Seite im DOM.
    $res = authed()->get(route('group.spaces'))->assertOk();

    $res->assertSee('motion-reduce:!translate-y-0', false);
    $res->assertSee('motion-reduce:!scale-100', false);
});

test('Raum: Poll-Balken-Breite ist reduced-motion-gegated (Zwilling zu :235)', function () {
    $res = authed()->get(route('group.room', ['h' => 'welcome']))->assertOk();

    $res->assertSee('transition-[width] duration-300 motion-reduce:transition-none', false);
});

test('Wallet-Hero: Count-Up + grüner Farb-Flash bei Zuwachs', function () {
    $res = authed()->get(route('group.wallet'))->assertOk();

    // $watch statt x-effect (keine Selbst-Retrigger-Schleife) + rAF-Tween-Signatur.
    $res->assertSee("\$watch('balanceSats'", false);
    $res->assertSee("flash ? 'text-green-500 dark:text-green-400'", false);
    // prefers-reduced-motion → sofort setzen.
    $res->assertSee("matchMedia('(prefers-reduced-motion: reduce)')", false);
});

test('Kontrast: Reconnect-Banner trägt dunklen Text auf Orange (kein Weiß-auf-Orange)', function () {
    $res = authed()->get(route('group.spaces'))->assertOk();

    $res->assertSee('text-brand-950', false);
    $res->assertSee('bg-brand-950 px-2 py-0.5 font-semibold text-brand-50', false);
});

test('Kontrast: Login-Hinweise laufen über text-muted statt text-zinc-500', function () {
    $res = $this->get(route('group.nostr-login'))->assertOk();

    $res->assertSee('text-xs text-muted', false);
    $res->assertDontSee('text-xs text-zinc-500', false);
});

test('Kontrast: Landing-Meta über text-muted', function () {
    $res = $this->get(route('home'))->assertOk();

    $res->assertSee('tracking-wide text-muted', false);
    $res->assertDontSee('tracking-wider text-zinc-500', false);
});

test('Tap-Targets: primäre Buttons (Wallet/Directory/Chat-Composer) tragen icon-btn-touch', function () {
    authed()->get(route('group.wallet'))->assertOk()->assertSee('icon-btn-touch', false);
    authed()->get(route('group.directory'))->assertOk()->assertSee('icon-btn-touch', false);
    // Chat-Kernpfad: Senden/Anhängen/Beitreten (Review-Fund plan/medium).
    authed()->get(route('group.room', ['h' => 'welcome']))->assertOk()->assertSee('icon-btn-touch', false);
});
