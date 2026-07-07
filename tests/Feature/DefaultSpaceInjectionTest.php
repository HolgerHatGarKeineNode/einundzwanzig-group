<?php

/**
 * Die Web-Client-Insel liest `window.__nostrSpace` VOR dem welshman-Boot. Prod
 * hängt davon ab — ohne die Injektion lädt die Live-Site keinen Space. Deshalb
 * ein Guard: ist die config gesetzt, muss das inline-Script im HTML stehen.
 */
test('setzt window.__nostrSpace, wenn NOSTR_SPACE_URL/config gesetzt ist', function () {
    config()->set('nostr.space_url', 'wss://group.einundzwanzig.space/');

    $this->get('/')
        ->assertOk()
        ->assertSee('window.__nostrSpace', false)
        ->assertSee('group.einundzwanzig.space', false);
});

test('injiziert nichts, wenn die Space-URL leer ist (Dev-Default)', function () {
    config()->set('nostr.space_url', null);

    $this->get('/')
        ->assertOk()
        ->assertDontSee('window.__nostrSpace', false);
});
