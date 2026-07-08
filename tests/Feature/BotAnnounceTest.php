<?php

declare(strict_types=1);

/**
 * Autobot-Command (bot:announce): postet kind-9 in einen Raum via nak. Der echte
 * Publish-Pfad (NIP-42-AUTH gegen einen member-only zooid) ist manuell/E2E belegt;
 * hier prüfen wir die Verdrahtung ohne Netzwerk: --dry baut den Aufruf, sendet
 * nichts; ohne Schlüssel bricht die Command sauber ab.
 */
test('bot:announce --dry baut den Aufruf, sendet aber nichts', function () {
    putenv('NOSTR_BOT_NSEC=nsec1dummykeyfortestonly');
    $_ENV['NOSTR_BOT_NSEC'] = 'nsec1dummykeyfortestonly';

    $this->artisan('bot:announce', [
        'room' => 'welcome',
        'message' => 'Testnachricht',
        '--relay' => 'ws://localhost:3334/',
        '--dry' => true,
    ])
        ->expectsOutputToContain('kind-9 an welcome')
        ->assertExitCode(0);
});

test('bot:announce ohne NOSTR_BOT_NSEC schlägt sauber fehl', function () {
    putenv('NOSTR_BOT_NSEC');
    unset($_ENV['NOSTR_BOT_NSEC'], $_SERVER['NOSTR_BOT_NSEC']);

    $this->artisan('bot:announce', [
        'room' => 'welcome',
        'message' => 'x',
        '--relay' => 'ws://localhost:3334/',
    ])->assertExitCode(1);
});
