<?php

use Livewire\Livewire;

/**
 * ZAPS.md Z0 — die Wallet-Seite ist eine Gruppen-Page hinter `nostr.auth`
 * (nostr-account-gebunden), NICHT in den Laravel-`['auth','verified']`-Account-
 * Settings. Zugang verlangt einen NIP-98-beglaubigten pubkey in der Session.
 */
test('wallet page renders the client-side wallet island', function () {
    Livewire::test('group::settings.wallet')
        ->assertOk()
        ->assertSeeHtml('x-data="nostrWallet"')
        ->assertSee('Wallet verbinden');
});

test('wallet route requires a nostr session (guest redirected to nostr-login)', function () {
    $this->get(route('group.wallet'))->assertRedirect(route('group.nostr-login'));
});

test('wallet route is reachable with a nostr session', function () {
    $this->withSession(['nostr_pubkey' => str_repeat('a', 64)])
        ->get(route('group.wallet'))
        ->assertOk();
});

test('wallet page renders the Z4 receiving-address card', function () {
    Livewire::test('group::settings.wallet')
        ->assertOk()
        ->assertSee('Empfangsadresse')
        ->assertSee('Nicht gesetzt')
        // „übernehmen"-Button + Save hängen an der Insel-Logik (addressMismatch/saveReceivingAddress).
        ->assertSeeHtml('addressMismatch()')
        ->assertSeeHtml('saveReceivingAddress()');
});
