<!DOCTYPE html>
<html lang="de" class="dark" data-theme="dark">
<head>
    @include('partials.head')
</head>
<body class="min-h-screen bg-zinc-50 text-zinc-900 antialiased dark:bg-zinc-950 dark:text-zinc-100">
    <main class="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-10 pt-safe">
        <div x-data="nostrAuth" class="page-enter">

            {{-- Eingeloggt --}}
            <template x-if="pubkey">
                <div class="surface-card empty-state p-6 text-center">
                    <flux:icon.check-badge variant="solid" class="mx-auto size-10 text-brand-500" />
                    <flux:heading size="lg" class="mt-3">Angemeldet</flux:heading>
                    <div class="mt-2 rounded-tile bg-zinc-100 p-2 font-mono text-xs break-all text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400" x-text="npub"></div>
                    <flux:button variant="ghost" class="mt-4" x-on:click="doLogout()">Abmelden</flux:button>
                </div>
            </template>

            {{-- Ausgeloggt: Login-Optionen --}}
            <template x-if="!pubkey">
                <div class="surface-card p-6">
                    <flux:heading size="xl" class="flex items-center gap-2">
                        <flux:icon.bolt variant="solid" class="size-6 text-brand-500" />
                        Anmelden
                    </flux:heading>
                    <flux:text class="mt-1 mb-5">Mit deinem Nostr-Schlüssel. Der private Key verlässt den Browser nie.</flux:text>

                    {{-- NIP-07 (nur wenn Extension vorhanden) --}}
                    <flux:button x-show="hasExtension" variant="primary" class="w-full" x-on:click="loginExtension()" ::disabled="busy">
                        Mit Browser-Erweiterung (NIP-07)
                    </flux:button>

                    {{-- Methoden-Umschalter --}}
                    <div class="mt-4 flex gap-2 text-sm">
                        <button type="button"
                                class="pressable rounded-tile px-3 py-1"
                                ::class="method==='nsec' ? 'bg-brand-500 text-zinc-950' : 'bg-zinc-200 dark:bg-zinc-800'"
                                x-on:click="method='nsec'; error=''">Schlüssel</button>
                        <button type="button"
                                class="pressable rounded-tile px-3 py-1"
                                ::class="method==='bunker' ? 'bg-brand-500 text-zinc-950' : 'bg-zinc-200 dark:bg-zinc-800'"
                                x-on:click="method='bunker'; error=''">Bunker (NIP-46)</button>
                    </div>

                    {{-- nsec / hex --}}
                    <div x-show="method==='nsec'" class="mt-3 space-y-2">
                        <flux:input type="password" x-model="keyInput" placeholder="nsec1… oder 64-stelliger hex-Key" x-on:keydown.enter="loginNsec()" />
                        <flux:button variant="primary" class="w-full" x-on:click="loginNsec()" ::disabled="busy">Anmelden</flux:button>
                    </div>

                    {{-- Bunker --}}
                    <div x-show="method==='bunker'" class="mt-3 space-y-2">
                        <flux:input x-model="bunkerInput" placeholder="bunker://…" x-on:keydown.enter="loginBunker()" />
                        <flux:button variant="primary" class="w-full" x-on:click="loginBunker()" ::disabled="busy">Verbinden</flux:button>
                    </div>

                    <template x-if="error">
                        <flux:callout variant="danger" icon="exclamation-triangle" class="mt-4">
                            <flux:callout.text x-text="error"></flux:callout.text>
                        </flux:callout>
                    </template>
                </div>
            </template>

        </div>
    </main>
    @fluxScripts
</body>
</html>
