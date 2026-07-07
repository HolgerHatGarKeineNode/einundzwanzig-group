<!DOCTYPE html>
<html lang="de" class="dark" data-theme="dark">
<head>
    @include('partials.head')
</head>
<body class="min-h-screen bg-zinc-50 text-zinc-900 antialiased dark:bg-zinc-950 dark:text-zinc-100">
    {{-- ponytail: Platzhalter-Landing zum Durchklicken (M3.5 macht daraus das echte Design). --}}
    <main class="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-10 pt-safe">
        <div x-data="nostrAuth" class="page-enter surface-card p-6 text-center">
            <flux:icon.bolt variant="solid" class="mx-auto size-10 text-brand-500" />
            <flux:heading size="xl" class="mt-3">flotilla·einundzwanzig</flux:heading>
            <flux:text class="mt-1">Nostr-Client für den Verein-Kern.</flux:text>

            {{-- Angemeldet → direkt in den Space --}}
            <template x-if="pubkey">
                <div class="mt-6 space-y-2">
                    <div class="truncate rounded-tile bg-zinc-100 p-2 font-mono text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400" x-text="npub"></div>
                    <flux:button variant="primary" class="w-full" href="{{ route('spaces') }}">Zu meinem Space</flux:button>
                    <flux:button variant="ghost" size="sm" class="w-full" href="{{ route('space.settings') }}">Space wechseln</flux:button>
                    <flux:button variant="ghost" size="sm" class="w-full" x-on:click="doLogout()">Abmelden</flux:button>
                </div>
            </template>

            {{-- Ausgeloggt → zum Login --}}
            <template x-if="!pubkey">
                <flux:button variant="primary" class="mt-6 w-full" href="{{ route('nostr-login') }}">Anmelden</flux:button>
            </template>
        </div>
    </main>
    @fluxScripts
</body>
</html>
