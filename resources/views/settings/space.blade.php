<!DOCTYPE html>
<html lang="de" class="dark" data-theme="dark">
<head>
    @include('partials.head')
</head>
<body class="min-h-screen bg-zinc-50 text-zinc-900 antialiased dark:bg-zinc-950 dark:text-zinc-100">
    <main class="mx-auto max-w-md px-4 py-8 pt-safe">

        <x-app-header title="Space wählen" :back="route('spaces')">
            <x-slot:subtitle>
                <flux:text class="text-sm">Die App zeigt immer genau diesen Space.</flux:text>
            </x-slot:subtitle>
        </x-app-header>

        {{-- Auswahl des aktiven Space (der einzige Ort zum Wechseln, §12) --}}
        <div x-data="nostrSpaceSettings" class="page-enter">

            <template x-if="spaces.length === 0">
                <div class="surface-card empty-state p-6 text-center">
                    <flux:icon.inbox class="mx-auto size-8 text-zinc-400" />
                    <flux:text class="mt-2">Du bist noch keinem Space beigetreten.</flux:text>
                </div>
            </template>

            <flux:navlist x-show="spaces.length > 0">
                <template x-for="s in spaces" :key="s.url">
                    <flux:navlist.item icon="server" x-on:click="choose(s.url)">
                        <span x-text="s.label"></span>
                        <flux:icon.check x-show="s.url === active" class="ml-auto size-4 text-brand-500" />
                    </flux:navlist.item>
                </template>
            </flux:navlist>
        </div>
    </main>
    @fluxScripts
</body>
</html>
