<?php

use Livewire\Attributes\Layout;
use Livewire\Attributes\Title;
use Livewire\Component;

/** Directory (Mitglieder + Rollen des aktiven Space) als Livewire-SFC. */
new #[Layout('layouts::einundzwanzig')] #[Title('Mitglieder')] class extends Component {}; ?>

<main class="mx-auto max-w-md px-4 py-8 pt-safe">

    {{-- Kopf: zurück zum Space + Titel --}}
    <x-app-header title="Mitglieder" :back="route('spaces')" />

    {{-- Directory des AKTIVEN Space (§12). Gated auf relay.self (Fix A). --}}
    <div x-data="nostrDirectory" class="page-enter space-y-4">

        {{-- Suche --}}
        <flux:input x-model="query" icon="magnifying-glass" placeholder="Mitglied suchen…" clearable />

        {{-- Ladezustand (relay.self / NIP-11 noch nicht da) — Skeleton statt „leer" --}}
        <template x-if="!ready">
            <div class="space-y-2">
                <template x-for="i in 4" :key="i">
                    <div class="surface-card flex items-center gap-3 p-3">
                        <div class="skeleton size-9 rounded-full"></div>
                        <div class="flex-1 space-y-1.5">
                            <div class="skeleton h-3.5 w-32"></div>
                            <div class="skeleton h-2.5 w-20"></div>
                        </div>
                    </div>
                </template>
            </div>
        </template>

        {{-- Geladen, aber keine Mitglieder --}}
        <template x-if="ready && members.length === 0">
            <div class="surface-card empty-state p-6 text-center">
                <flux:icon.users class="mx-auto size-8 text-zinc-400" />
                <flux:text class="mt-2">Noch keine Mitglieder in diesem Space.</flux:text>
            </div>
        </template>

        {{-- Mitglieder-Grid --}}
        <template x-if="ready && members.length > 0">
            <div class="list-stagger space-y-2">
                <template x-for="m in filtered()" :key="m.pubkey">
                    <div class="surface-card pressable flex items-center gap-3 p-3">
                        <flux:avatar circle size="sm" ::src="m.picture || null" ::name="m.name" />
                        <div class="min-w-0 flex-1">
                            <div class="truncate font-semibold" x-text="m.name"></div>
                            <div class="truncate font-mono text-xs text-zinc-500" x-text="m.short"></div>
                            <div class="mt-1 flex flex-wrap gap-1" x-show="m.roles.length > 0">
                                <template x-for="role in m.roles" :key="role.id">
                                    <flux:badge size="sm" ::style="`color:${role.color};background-color:${role.soft}`">
                                        <span x-text="role.label"></span>
                                    </flux:badge>
                                </template>
                            </div>
                        </div>
                    </div>
                </template>

                {{-- Suche ohne Treffer --}}
                <template x-if="filtered().length === 0">
                    <div class="surface-card p-4 text-center text-sm text-zinc-500">
                        Kein Mitglied passt zu „<span x-text="query"></span>".
                    </div>
                </template>
            </div>
        </template>

    </div>
</main>
