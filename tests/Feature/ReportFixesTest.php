<?php

declare(strict_types=1);

/**
 * Regressionen aus dem E2E-Emulator-Report (plans/REPORT.md). Deckt die
 * server-/Blade-testbaren Fixes ab; die reinen JS-/Insel-Fixes (authGate-Store
 * der Mobile-app.js, wallet profileReady, reaktiver Raum-Name) prüft Playwright.
 */

// Locale-umschaltende Tests danach zurücksetzen (Web-Host ist deutsch).
afterEach(fn () => app()->setLocale('de'));

/** Session eines eingeloggten Nostr-Nutzers (nostr.auth-Gate der Package-Routen). */
function authedSession(): array
{
    return ['nostr_pubkey' => str_repeat('a', 64)];
}

test('🔴 @js(__(Space)) leakt nicht mehr roh in die Alpine-Expression (/spaces)', function () {
    $html = $this->withSession(authedSession())->get(route('group.spaces'))->assertOk()->getContent();

    // Der Header-Titel bindet reaktiv den Space-Label mit lokalisiertem Fallback …
    expect($html)->toContain('space?.label');
    // … als VALIDE Alpine-Expression: json_encode → doppelt-gequotetes "Space"
    // (Blade escapt die Quotes zu &quot;), NICHT die rohe @js()-Directive, die
    // Alpine sonst als „Invalid or unexpected token" wirft.
    expect($html)->toContain('&quot;Space&quot;');
    expect($html)->not->toContain('@js(');
});

test('🟠 Raum-Header bindet den reaktiven Client-Namen statt nur des Slugs (/rooms/{h})', function () {
    $html = $this->withSession(authedSession())->get(route('group.room', ['h' => 'welcome']))->assertOk()->getContent();

    // Die Insel bekommt h UND den SSR-Namen als 2. Argument (Fallback vor Hydrate).
    expect($html)->toContain('nostrRoomChat(');
    // Der Titel bindet reaktiv `roomName` (Client-Meta 39000 überschreibt den Slug),
    // wieder ohne rohe @js()-Directive.
    expect($html)->toContain('+ roomName');
    expect($html)->not->toContain('@js(');
});

test('🟠 Nav-Tab-Label wird zur Render-Zeit lokalisiert (Bug „Mehr" statt „More")', function () {
    // Web-Host-Nav trägt u.a. „Einstellungen"; en.json des Packages übersetzt es.
    app()->setLocale('en');
    expect(__('Einstellungen'))->toBe('Settings'); // Vorbedingung: Key existiert

    $html = $this->withSession(authedSession())->get(route('group.spaces'))->assertOk()->getContent();

    // Der Tab zeigt die ÜBERSETZUNG (nav-tab rendert {{ __($label) }}) …
    expect($html)->toContain('Settings');
    // … nicht den deutschen Roh-Key.
    expect($html)->not->toContain('>Einstellungen<');
});

test('🔴 Profiles-Endpunkt liefert CORS-Header für den Native-WebView-Origin', function () {
    $this->get('/nostr/profiles?pubkeys=')
        ->assertOk()
        ->assertHeader('Access-Control-Allow-Origin', '*');
});

test('🟡 Wallet „Nicht gesetzt" ist hinter profileReady gegated (kein Lade-Flash)', function () {
    $html = $this->withSession(authedSession())->get(route('group.wallet'))->assertOk()->getContent();

    // Der „Nicht gesetzt"-Hinweis erscheint erst nach aufgelöstem Profil, nicht
    // während des async Nachladens (sonst blitzt er kurz auf).
    expect($html)->toContain('profileReady && !profileLud16');
});
