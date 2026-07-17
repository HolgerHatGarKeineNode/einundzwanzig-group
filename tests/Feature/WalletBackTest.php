<?php

declare(strict_types=1);

/**
 * P3: Der Wallet-Rücksprung ist host-aware und wird aus EINER Quelle abgeleitet —
 * der nav-Registry. Wallet als Bottom-Nav-Peer-Tab (Web + Mobile) → kein Zurück-
 * Pfeil (man bleibt im Tab). Wallet NICHT in der Nav (Package-Default) → Sub-Screen
 * des Hubs → Zurück zum verschmolzenen Settings-Hub. Kein @mobile/@web-Seam.
 */
function walletPage()
{
    return test()->withSession(['nostr_pubkey' => str_repeat('a', 64)])->get(route('group.wallet'))->assertOk();
}

test('Wallet ist nav-Peer-Tab → KEIN Zurück-Pfeil zum Hub', function () {
    config(['group.nav' => [
        ['key' => 'wallet', 'route' => 'group.wallet', 'icon' => 'bolt', 'label' => 'Wallet', 'gate' => 'nostr'],
    ]]);

    $res = walletPage();
    // app-header rendert den Zurück-Pfeil nur bei gesetztem :back (aria-label "Zurück").
    $res->assertDontSee('aria-label="Zurück"', false);
});

test('Wallet NICHT in der Nav (Package-Default) → Zurück-Pfeil zum Settings-Hub', function () {
    config(['group.nav' => [
        ['key' => 'settings', 'route' => 'group.settings', 'icon' => 'cog-6-tooth', 'label' => 'Einstellungen', 'gate' => 'nostr'],
    ]]);

    $res = walletPage();
    $res->assertSee('aria-label="Zurück"', false);
    $res->assertSee('href="'.route('group.settings').'"', false);
});
