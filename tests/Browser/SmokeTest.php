<?php

/**
 * Pest-v4-Browsertest (Proof) — läuft im Host-Chromium (kein Playwright-Download,
 * siehe ensureHostChromium() in tests/Pest.php). Rendert die Landing im echten
 * Browser und prüft die welshman/Alpine-Insel (Wortmarke + Login-CTA).
 */
it('rendert die Landing im Host-Chromium', function () {
    $page = visit('/');

    $page->assertSee('EINUNDZWANZIG')
        ->assertSee('Die Bitcoin-Community auf Nostr')
        ->assertSee('Anmelden')
        ->assertNoJavaScriptErrors();
});
