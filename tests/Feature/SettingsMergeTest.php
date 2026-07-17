<?php

declare(strict_types=1);

/**
 * P5 (App-Shell-Verschmelzung §6): der verschmolzene Einstellungen-Screen
 * (group.settings) bündelt Konto/Identität · Space & Räume · Wallet · Darstellung ·
 * Abmelden an EINEM Ort. Web-Umfang: kein Portal-Konto/Meine-Inhalte/Sprache.
 */
function settings()
{
    return test()->withSession(['nostr_pubkey' => str_repeat('a', 64)])->get(route('group.settings'))->assertOk();
}

test('Web-Nav: der Einstellungen-Tab zeigt auf den verschmolzenen group.settings-Screen', function () {
    expect(collect(config('group.nav'))->firstWhere('key', 'settings')['route'])
        ->toBe('group.settings');
});

test('Konto & Identität: npub kopierbar + Signer-Typ + Neu verbinden', function () {
    $res = settings();

    $res->assertSee('Konto &amp; Identität', false);
    $res->assertSee('x-data="nostrAuth"', false);
    // npub-Chip kopiert in die Zwischenablage (kein Modal), Signer-Typ aus welshman.
    $res->assertSee('navigator.clipboard.writeText(npub)', false);
    $res->assertSee('x-text="signerLabel"', false);
    // „Neu verbinden" nutzt denselben Pfad wie der Perms-Reconnect-Nudge.
    $res->assertSee(route('group.nostr-login', ['reconnect' => 1]), false);
});

test('Space & Räume: der einzige Space-Wechsel-Ort (Single-Space) mit ready-Guard', function () {
    $res = settings();

    $res->assertSee('Space &amp; Räume', false);
    $res->assertSee('x-data="nostrSpaceSettings"', false);
    $res->assertSee('choose(s.url)', false);
    // ready-Guard verhindert Empty-Flash (Fix-A-Muster).
    $res->assertSee('x-if="!ready"', false);
});

test('Wallet: KEIN Hub-Eintrag auf Web (eigener Peer-Tab); Sektion nur wenn Registry sie listet', function () {
    // Sektions-spezifischer Marker (NICHT die Wallet-Route — die steht ohnehin im
    // Bottom-Nav-Peer-Tab; genau das ist der Punkt: doppelter Einstieg vermieden).
    // Web-Registry ohne 'wallet' → keine Wallet-Sektion im Hub.
    settings()->assertDontSee('id="settings-wallet"', false);

    // Ein Host, der 'wallet' listet (z.B. Package-Default ohne Wallet-Tab) → Sektion da.
    config(['group.settings' => ['account', 'wallet']]);
    settings()->assertSee('id="settings-wallet"', false);
});

test('Netzwerk & Relays: read-only, Sichtbarkeit über die Registry (nicht mehr show_relays)', function () {
    // Web-Registry ohne 'relays' → Sektion aus (Web-Umfang ohne Relay-Editor).
    settings()->assertDontSee('Netzwerk &amp; Relays', false);

    // Host listet 'relays' (Mobile) → read-only Relay-Insel erscheint.
    config(['group.settings' => ['account', 'relays']]);
    $res = settings();
    $res->assertSee('Netzwerk &amp; Relays', false);
    $res->assertSee('x-data="nostrRelays"', false);
});

test('Registry steuert Präsenz UND Reihenfolge der Sektionen', function () {
    // Umgedrehte Registry → Sektions-Markup erscheint in genau dieser Reihenfolge.
    config(['group.settings' => ['session', 'account']]);
    $h = settings()->getContent();

    expect(strpos($h, 'settings-logout'))->toBeLessThan(strpos($h, 'settings-account'));
    // Nicht gelistete Sektion (space) fehlt komplett.
    expect($h)->not->toContain('settings-space');
});

test('Darstellung: EIN Theme-Regler über $flux.appearance, kein hartes class="dark"', function () {
    $res = settings();

    $res->assertSee('x-model="$flux.appearance"', false);
    $res->assertSee('value="light"', false);
    $res->assertSee('value="dark"', false);
    // Kein hart gesetztes Dark — der Store steuert allein (§8.8-Regression). Auf den
    // ECHTEN Gefahrenfall prüfen (bares class="dark"); Tailwind-`dark:`-Varianten
    // tragen einen Doppelpunkt und matchen den Space-präfixierten String nicht.
    $res->assertDontSee(' class="dark"', false);
});

test('A11y: echte Heading-Hierarchie (h1-Titel + h2-Sektionen) und angesagter aktiver Space', function () {
    $res = settings();

    // app-header rendert den Titel als h1 (nicht als div), Sektionen als h2.
    $res->assertSee('<h1', false);
    $res->assertSee('<h2', false);
    // Aktiver Space wird angesagt (aria-current + sr-only), nicht nur farbig markiert.
    // Flux reicht ::aria-current als Alpine-Bind :aria-current durch.
    $res->assertSee(':aria-current="s.url === active', false);
    $res->assertSee('>aktiv<', false);
    // Theme-Gruppe trägt einen Gruppennamen für Screenreader.
    $res->assertSee('aria-label="Theme"', false);
});

test('Abmelden lebt an EINEM Ort ganz unten (nostrAuth-Teardown)', function () {
    $res = settings();

    $res->assertSee('doLogout()', false);
    $res->assertSee('Abmelden');
    // Keine zweite Logout-Doppelung im selben Screen (3× → 1×).
    expect(substr_count($res->getContent(), 'doLogout()'))->toBe(1);
});
