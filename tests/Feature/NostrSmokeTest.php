<?php

test('smoke page is gated to local and not publicly routable', function () {
    // D5: Debug-Screen nur unter app()->environment('local') registriert. Im
    // Test-Env (nicht local) existiert die Route nicht → nicht öffentlich/indexierbar.
    expect(app()->environment('local'))->toBeFalse();

    $this->get('/nostr-smoke')->assertNotFound();
});
