<?php

declare(strict_types=1);

use Illuminate\Testing\PendingCommand;

/**
 * Autobot-Command (bot:announce): postet kind-9 in einen Raum via nak. Der echte
 * Publish-Pfad (NIP-42-AUTH gegen einen member-only zooid) ist manuell/E2E belegt;
 * hier prüfen wir die Verdrahtung ohne Netzwerk: --dry baut den Aufruf, sendet
 * nichts; ohne Schlüssel bricht die Command sauber ab.
 */

/**
 * `$this->artisan()` gibt laut Signatur `PendingCommand|int` zurück — int nur,
 * wenn `mockConsoleOutput` deaktiviert wurde (hier nicht der Fall). Die Prüfung
 * macht das für PHPStan explizit, statt den Fall stillschweigend anzunehmen.
 */
function assertedPendingCommand(mixed $command): PendingCommand
{
    if (! $command instanceof PendingCommand) {
        throw new RuntimeException('Erwartet PendingCommand — mockConsoleOutput scheint deaktiviert.');
    }

    return $command;
}

test('bot:announce --dry baut den Aufruf, sendet aber nichts', function () {
    config(['services.nostr_bot.nsec' => 'nsec1dummykeyfortestonly']);

    assertedPendingCommand($this->artisan('bot:announce', [
        'room' => 'welcome',
        'message' => 'Testnachricht',
        '--relay' => 'ws://localhost:3334/',
        '--dry' => true,
    ]))
        ->expectsOutputToContain('kind-9 an welcome')
        ->assertExitCode(0);
});

test('bot:announce ohne NOSTR_BOT_NSEC schlägt sauber fehl', function () {
    // Explizit leer setzen statt nur "nicht setzen": die lokale .env trägt
    // i.d.R. einen echten NOSTR_BOT_NSEC — ohne diese Zeile würde der Test
    // den Fehlerpfad gar nicht treffen und nur zufällig grün sein.
    config(['services.nostr_bot.nsec' => '']);

    // Konkrete Fehlermeldung mitprüfen, nicht nur den Exit-Code: der nachgelagerte
    // `nak`-Aufruf würde bei einem unerreichbaren Relay ebenfalls mit 1 abbrechen —
    // ohne die Meldung wäre der Guard selbst gar nicht verifiziert (Mutationsprobe
    // 2026-08-05 belegt das: Guard deaktiviert, Test blieb trotzdem grün).
    assertedPendingCommand($this->artisan('bot:announce', [
        'room' => 'welcome',
        'message' => 'x',
        '--relay' => 'ws://localhost:3334/',
    ]))
        ->expectsOutputToContain('NOSTR_BOT_NSEC fehlt in der .env — der Bot hat keinen Schlüssel.')
        ->assertExitCode(1);
});
