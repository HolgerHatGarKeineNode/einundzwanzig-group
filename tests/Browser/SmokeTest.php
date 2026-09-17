<?php

/**
 * Pest v4 browser test (proof) — runs in the host Chromium (no Playwright download, see
 * `ensureHostChromium()` in `tests/Pest.php`). Renders Start in a real browser and checks
 * the welshman/Alpine island.
 *
 * **Until P2 this case measured the landing page under `/`.** That is gone with Concept C:
 * `/` forwards to Start, and Start is the one surface a guest and a member see alike. What
 * the case proves has stayed the same — that the island boots in a real browser and throws
 * nothing while doing so.
 */
it('renders Start in the host Chromium', function () {
    // `withLocale('de-DE')`: otherwise the browser plugin forces `locale => 'en-US'`
    // (`PendingAwaitablePage.php:176`, no host-Chromium default). Since P2 `SetLocale`
    // negotiates the language from it — the page would come up in English and the assertions
    // below would go red without anything being broken in the product.
    $page = visit('/start')->withLocale('de-DE');

    $page->assertSee('Start')
        // The guest state: it is decided CLIENT-side (D4), so it only appears after the
        // Alpine boot. That it appears at all is the evidence that the boot ran through — a
        // server-rendered sentence would not prove that.
        ->assertSee('Willkommen bei EINUNDZWANZIG')
        ->assertSee('Alle Bereiche')
        ->assertNoJavaScriptErrors();
});
