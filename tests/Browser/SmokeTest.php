<?php

/**
 * Pest-v4-Browsertest (Proof) — läuft im Host-Chromium (kein Playwright-Download,
 * siehe ensureHostChromium() in tests/Pest.php). Rendert die Landing im echten
 * Browser und prüft die welshman/Alpine-Insel (Wortmarke + Login-CTA).
 */
it('rendert die Landing im Host-Chromium', function () {
    // `withLocale('de-DE')`: das Browser-Plugin erzwingt sonst `locale => 'en-US'`
    // (PendingAwaitablePage.php:176, kein Host-Chromium-Default). Seit P2 verhandelt
    // `SetLocale` daran die Sprache — die Landing käme auf Englisch („Sign in") und
    // `assertSee('Anmelden')` ginge rot, ohne dass am Produkt etwas kaputt ist.
    $page = visit('/')->withLocale('de-DE');

    $page->assertSee('EINUNDZWANZIG')
        ->assertSee('Die Bitcoin-Community auf Nostr')
        ->assertSee('Anmelden')
        ->assertNoJavaScriptErrors();
});
