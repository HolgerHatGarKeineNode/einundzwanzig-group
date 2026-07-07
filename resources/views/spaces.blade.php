<!DOCTYPE html>
<html lang="de" class="dark" data-theme="dark">
<head>
    @include('partials.head')
</head>
<body class="min-h-screen bg-zinc-50 text-zinc-900 antialiased dark:bg-zinc-950 dark:text-zinc-100">
    <main class="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-10 pt-safe">
        <div x-data="nostrAuth" class="surface-card page-enter p-6 text-center">
            <flux:icon.check-badge variant="solid" class="mx-auto size-10 text-brand-500" />
            <flux:heading size="lg" class="mt-3">Angemeldet</flux:heading>
            <flux:text class="mt-1">Server-Session beglaubigt (NIP-98).</flux:text>

            {{-- Vom Server verifizierter pubkey (Beweis, dass das Gate steht) --}}
            <div class="mt-4 rounded-tile bg-zinc-100 p-2 font-mono text-xs break-all text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                {{ session('nostr_pubkey') }}
            </div>

            <flux:button variant="ghost" class="mt-4" x-on:click="doLogout()">Abmelden</flux:button>
        </div>
    </main>
    @fluxScripts
</body>
</html>
