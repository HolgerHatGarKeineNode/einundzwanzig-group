<!DOCTYPE html>
<html lang="de" class="dark" data-theme="dark">
<head>
    @include('partials.head')
</head>
<body class="min-h-screen bg-zinc-50 text-zinc-900 antialiased dark:bg-zinc-950 dark:text-zinc-100">
    <main class="mx-auto max-w-md px-4 py-8 pt-safe">

        {{-- Kopf: wer bin ich + Abmelden (Signer bleibt im Browser) --}}
        <div x-data="nostrAuth" class="mb-6 flex items-center justify-between gap-3">
            <div class="min-w-0">
                <flux:heading size="xl">Spaces</flux:heading>
                <div class="truncate font-mono text-xs text-zinc-500" x-text="npub"></div>
            </div>
            <flux:button variant="ghost" size="sm" x-on:click="doLogout()">Abmelden</flux:button>
        </div>

        {{-- Space/Room-Navigation (client-seitig aus welshman) --}}
        <div x-data="nostrSpaces" class="page-enter space-y-4">

            <template x-if="loading">
                <div class="surface-card space-y-2 p-4">
                    <div class="skeleton h-4 w-32"></div>
                    <div class="skeleton h-3 w-24"></div>
                </div>
            </template>

            <template x-if="!loading && spaces.length === 0">
                <div class="surface-card empty-state p-6 text-center">
                    <flux:icon.inbox class="mx-auto size-8 text-zinc-400" />
                    <flux:text class="mt-2">Du bist noch keinem Space beigetreten.</flux:text>
                </div>
            </template>

            <template x-for="space in spaces" :key="space.url">
                <div class="surface-card p-4">
                    <div class="flex items-center gap-2">
                        <flux:icon.server variant="solid" class="size-4 text-brand-500" />
                        <span class="truncate font-semibold" x-text="space.label"></span>
                    </div>

                    <flux:navlist class="mt-3">
                        {{-- Beigetretene Rooms --}}
                        <template x-for="room in space.userRooms" :key="room.h">
                            <flux:navlist.item icon="hashtag"><span x-text="room.name"></span></flux:navlist.item>
                        </template>

                        {{-- Entdeckbare Rooms --}}
                        <flux:navlist.group heading="Andere Rooms" x-show="space.otherRooms.length > 0">
                            <template x-for="room in space.otherRooms" :key="room.h">
                                <flux:navlist.item icon="hashtag"><span x-text="room.name"></span></flux:navlist.item>
                            </template>
                        </flux:navlist.group>
                    </flux:navlist>
                </div>
            </template>

        </div>
    </main>
    @fluxScripts
</body>
</html>
