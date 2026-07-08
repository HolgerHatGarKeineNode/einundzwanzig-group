<?php

use Livewire\Attributes\Layout;
use Livewire\Attributes\Title;
use Livewire\Component;

/** M0 welshman-Smoke-Test (temporär, öffentlich) als Livewire-SFC. */
new #[Layout('group::einundzwanzig')] #[Title('welshman Smoke-Test')] class extends Component {}; ?>

<main class="mx-auto max-w-2xl px-4 py-10 pt-safe">
    <div class="page-enter">
        <flux:heading size="xl" class="flex items-center gap-2">
            <flux:icon.bolt variant="solid" class="size-6 text-brand-500" />
            M0 · welshman Smoke-Test
        </flux:heading>
        <flux:text class="mt-1 mb-6">
            Live kind:1-Notes aus dem welshman-<code>repository</code>, gerendert über die
            Store→Alpine-Bridge (<code>deriveEvents → subscribe → x-for</code>).
        </flux:text>
    </div>

    <div wire:ignore x-data="nostrSmoke">
        {{-- Ladezustand: Skeletons statt Spinner --}}
        <div x-show="loading" class="space-y-3">
            <div class="skeleton h-16"></div>
            <div class="skeleton h-16"></div>
            <div class="skeleton h-16"></div>
            <div class="skeleton h-16"></div>
        </div>

        {{-- Fehlerzustand --}}
        <template x-if="error">
            <flux:callout variant="danger" icon="exclamation-triangle" class="mb-4">
                <flux:callout.text x-text="error"></flux:callout.text>
            </flux:callout>
        </template>

        {{-- Feed --}}
        <ul x-show="!loading" class="list-stagger space-y-3">
            <template x-for="(e, idx) in events" :key="e.id">
                <li class="surface-card pressable p-4" :style="`--i:${idx}`">
                    <div class="mb-1 text-xs text-brand-600 dark:text-brand-400"
                         x-text="e.pubkey.slice(0, 16) + '…'"></div>
                    <div class="text-sm leading-snug text-zinc-700 dark:text-zinc-300"
                         x-text="e.content.slice(0, 180)"></div>
                </li>
            </template>
        </ul>

        <flux:text x-show="!loading" class="mt-4 text-xs text-zinc-500">
            <span x-text="events.length"></span> Events im repository
        </flux:text>
    </div>
</main>
