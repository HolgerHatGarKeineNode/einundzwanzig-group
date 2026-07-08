<?php

namespace App\Console\Commands;

use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Process;

/**
 * Autobot: postet eine NIP-29-Raumnachricht (kind 9) auf einem member-only
 * Group-Relay. Signieren + AUTH (NIP-42) übernimmt `nak` — der Bot-nsec wird
 * NUR über die Child-Env `NOSTR_SECRET_KEY` gereicht (nie in argv, nie in `ps`).
 * Rein lokales Werkzeug (Key liegt in der gitignoreten .env, siehe NOSTR_BOT_NSEC).
 */
#[Signature('bot:announce {room : Raum-h-id (NIP-29), z.B. welcome} {message : Nachrichtentext} {--relay= : Ziel-Relay (Default NOSTR_BOT_RELAY)} {--dry : Nur zeigen, nicht senden}')]
#[Description('Postet eine Versions-/Update-News als Autobot in einen Raum (kind 9, NIP-42-AUTH via nak).')]
class BotAnnounce extends Command
{
    public function handle(): int
    {
        $nsec = (string) env('NOSTR_BOT_NSEC', '');
        if ($nsec === '') {
            $this->error('NOSTR_BOT_NSEC fehlt in der .env — der Bot hat keinen Schlüssel.');

            return self::FAILURE;
        }

        $relay = (string) ($this->option('relay') ?: env('NOSTR_BOT_RELAY', ''));
        if ($relay === '') {
            $this->error('Kein Relay: --relay setzen oder NOSTR_BOT_RELAY in der .env.');

            return self::FAILURE;
        }

        $room = (string) $this->argument('room');
        $message = (string) $this->argument('message');
        $nak = $this->resolveNak();

        $args = [$nak, 'event', '--auth', '-k', '9', '-t', "h={$room}", '-c', $message, $relay];

        $this->line("→ kind-9 an <fg=yellow>{$room}</> auf <fg=yellow>{$relay}</> (Bot signiert via nak --auth)");

        if ($this->option('dry')) {
            $this->comment('--dry: nichts gesendet.');

            return self::SUCCESS;
        }

        // Secret NUR über die Child-Env (nak liest $NOSTR_SECRET_KEY), nie über argv.
        $result = Process::env(['NOSTR_SECRET_KEY' => $nsec])->run($args);

        // nak: stdout = signiertes Event, stderr = Relay-Status. Der Verdikt darf
        // NUR stderr scannen — sonst triggert ein Wort wie „error"/„failed" im
        // News-Text (steht im stdout-content) einen falschen Fehlschlag.
        $status = trim($result->errorOutput());
        $event = trim($result->output());
        if ($status !== '') {
            $this->line($status);
        }

        $rejected = preg_match('/auth-required|restricted|blocked|rejected|invalid|refused|failed|error/i', $status) === 1;
        if (! $result->successful() || $rejected) {
            $this->error('Senden fehlgeschlagen (siehe Relay-Antwort oben).');

            return self::FAILURE;
        }

        if ($id = json_decode($event, true)['id'] ?? null) {
            $this->line("<fg=gray>Event-ID: {$id}</>");
        }

        $this->info('Gesendet. 🤖');

        return self::SUCCESS;
    }

    /** nak-Binary finden: NAK_BIN, dann PATH, dann ~/go/bin/nak. */
    private function resolveNak(): string
    {
        if ($bin = env('NAK_BIN')) {
            return (string) $bin;
        }
        $home = (string) (getenv('HOME') ?: '');
        if ($home !== '' && is_executable("{$home}/go/bin/nak")) {
            return "{$home}/go/bin/nak";
        }

        return 'nak';
    }
}
