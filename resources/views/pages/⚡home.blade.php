<?php

use Livewire\Attributes\Layout;
use Livewire\Attributes\Title;
use Livewire\Component;

/** Landing (öffentlich) als Livewire-SFC. Login-Zustand lebt in der Alpine-Insel. */
new #[Layout('group::einundzwanzig')] #[Title('EINUNDZWANZIG')] class extends Component {}; ?>

<main class="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6 pt-safe pb-safe">
    <div x-data="nostrAuth" class="empty-state text-center">

        {{-- Signatur: der EINUNDZWANZIG-Logomark auf hellem Chip --}}
        <x-group::app-brand-mark class="mx-auto size-20" />

        {{-- Wortmarke: der Verein führt, monospace + Terminal-Caret --}}
        <div class="mt-6">
            <h1 class="text-3xl font-bold tracking-tight">EINUNDZWANZIG<span class="caret ml-0.5" aria-hidden="true"></span></h1>
            <div class="mt-1 font-mono text-xs tracking-wide text-muted">Die Bitcoin-Community auf Nostr</div>
        </div>

        {{-- Angemeldet → in den Space --}}
        <template x-if="pubkey">
            <div class="mt-8 space-y-2">
                <div class="truncate rounded-tile bg-zinc-100 p-2 font-mono text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400" x-text="npub"></div>
                <flux:button variant="primary" class="w-full" icon="arrow-right" :href="route('group.spaces')" wire:navigate>Zu deinem Space</flux:button>
                <div class="flex gap-2">
                    <flux:button variant="ghost" size="sm" class="flex-1" :href="route('group.settings')" wire:navigate>Einstellungen</flux:button>
                    <flux:button variant="ghost" size="sm" class="flex-1" x-on:click="doLogout()">Abmelden</flux:button>
                </div>
            </div>
        </template>

        {{-- Ausgeloggt → anmelden --}}
        <template x-if="!pubkey">
            <div class="mt-8">
                <flux:button variant="primary" class="w-full" icon="bolt" :href="route('group.nostr-login')" wire:navigate>Anmelden</flux:button>
                <div class="mt-3 font-mono text-[0.7rem] tracking-wider text-muted">NIP-07 · NIP-46 · nsec</div>
            </div>
        </template>

    </div>
</main>
