<!DOCTYPE html>
<html lang="de" class="dark" data-theme="dark">
<head>
    @include('partials.head')
</head>
<body class="min-h-screen bg-zinc-50 text-zinc-900 antialiased dark:bg-zinc-950 dark:text-zinc-100">
    <main class="mx-auto max-w-md px-4 py-8 pt-safe">

        {{-- Kopf: Marke + wer bin ich + Aktionen --}}
        <x-app-header title="Space" x-data="nostrAuth">
            <x-slot:subtitle>
                <div class="truncate font-mono text-xs text-zinc-500" x-text="npub"></div>
            </x-slot:subtitle>
            <x-slot:actions>
                <flux:button variant="ghost" size="sm" icon="users" href="{{ route('directory') }}" aria-label="Mitglieder" />
                <flux:button variant="ghost" size="sm" icon="cog-6-tooth" href="{{ route('space.settings') }}" aria-label="Space wechseln" />
                <flux:button variant="ghost" size="sm" x-on:click="doLogout()">Abmelden</flux:button>
            </x-slot:actions>
        </x-app-header>

        {{-- Genau EIN fixierter Space + seine Rooms (kein Multi-Space-Layout, §12) --}}
        <div x-data="nostrSpaces" class="page-enter" x-show="space">
            <div class="surface-card p-4">
                <div class="flex items-center gap-2">
                    <flux:icon.server variant="solid" class="size-4 text-brand-500" />
                    <span class="truncate font-semibold" x-text="space?.label"></span>
                </div>

                {{-- Rooms laden noch --}}
                <template x-if="loading && space && space.userRooms.length === 0 && space.otherRooms.length === 0">
                    <div class="mt-3 space-y-2">
                        <div class="skeleton h-4 w-32"></div>
                        <div class="skeleton h-4 w-24"></div>
                    </div>
                </template>

                {{-- Geladen, aber der Space hat keine Rooms --}}
                <template x-if="!loading && space && space.userRooms.length === 0 && space.otherRooms.length === 0">
                    <flux:text class="mt-3 text-sm text-zinc-500">Dieser Space hat noch keine Rooms.</flux:text>
                </template>

                <flux:navlist class="mt-3">
                    <template x-for="room in space?.userRooms ?? []" :key="room.h">
                        <flux:navlist.item icon="hashtag"><span x-text="room.name"></span></flux:navlist.item>
                    </template>

                    <flux:navlist.group heading="Andere Rooms" x-show="(space?.otherRooms.length ?? 0) > 0">
                        <template x-for="room in space?.otherRooms ?? []" :key="room.h">
                            <flux:navlist.item icon="hashtag"><span x-text="room.name"></span></flux:navlist.item>
                        </template>
                    </flux:navlist.group>
                </flux:navlist>
            </div>
        </div>
    </main>
    @fluxScripts
</body>
</html>
