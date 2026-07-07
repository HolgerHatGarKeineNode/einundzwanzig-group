<!DOCTYPE html>
<html lang="de" class="dark" data-theme="dark">
<head>
    @include('partials.head')
</head>
<body class="bg-zinc-50 text-zinc-900 antialiased dark:bg-zinc-950 dark:text-zinc-100">
    <div class="mx-auto flex h-screen w-full max-w-md flex-col px-4 pt-safe pb-safe">

        <x-app-header :title="'# '.$h" :back="route('spaces')" class="shrink-0" />

        {{-- Chat-Bühne: Verlauf scrollt, Live-Nachrichten fließen ein (M4). --}}
        <div x-data="nostrRoomChat(@js($h))" class="relative flex min-h-0 flex-1 flex-col">

            <div x-ref="scroll" x-on:scroll.debounce.50ms="onScroll()"
                 class="min-h-0 flex-1 space-y-0.5 overflow-y-auto pb-4">

                {{-- Ältere laden (Cursor-Pagination) --}}
                <div class="py-2 text-center" x-show="hasMore && messages.length > 0" x-cloak>
                    <flux:button size="xs" variant="ghost" x-on:click="loadOlder()" ::disabled="loadingMore">
                        <span x-text="loadingMore ? 'Lädt…' : 'Ältere laden'"></span>
                    </flux:button>
                </div>

                {{-- Erstes Laden --}}
                <template x-if="loading && messages.length === 0">
                    <div class="space-y-3 pt-4">
                        <template x-for="i in 6" :key="i">
                            <div class="flex gap-2">
                                <div class="skeleton size-8 shrink-0 rounded-full"></div>
                                <div class="flex-1 space-y-1.5 py-1">
                                    <div class="skeleton h-3 w-24"></div>
                                    <div class="skeleton h-3 w-2/3"></div>
                                </div>
                            </div>
                        </template>
                    </div>
                </template>

                {{-- Leerer Room --}}
                <template x-if="!loading && messages.length === 0">
                    <div class="surface-card empty-state mt-8 p-6 text-center">
                        <flux:icon.chat-bubble-left-right class="mx-auto size-8 text-zinc-400" />
                        <flux:text class="mt-2">Noch keine Nachrichten in diesem Room.</flux:text>
                    </div>
                </template>

                {{-- Verlauf --}}
                <template x-for="m in messages" :key="m.id">
                    <div>
                        <template x-if="m.divider">
                            <div class="my-3 flex items-center gap-3">
                                <flux:separator class="flex-1" />
                                <span class="font-mono text-[0.7rem] tracking-wide text-zinc-500" x-text="m.divider"></span>
                                <flux:separator class="flex-1" />
                            </div>
                        </template>

                        <div class="flex gap-2 px-1" :class="m.showAuthor ? 'mt-2.5' : ''">
                            <div class="w-8 shrink-0">
                                <template x-if="m.showAuthor">
                                    <flux:avatar circle size="xs" ::src="m.picture || null" ::name="m.name" />
                                </template>
                            </div>
                            <div class="min-w-0 flex-1">
                                <template x-if="m.showAuthor">
                                    <div class="flex items-baseline gap-2">
                                        <span class="truncate text-sm font-semibold" x-text="m.name"></span>
                                        <span class="shrink-0 font-mono text-[0.7rem] text-zinc-500" x-text="m.time"></span>
                                    </div>
                                </template>
                                <div class="chat-content text-sm break-words whitespace-pre-wrap" x-html="m.html"></div>
                            </div>
                        </div>
                    </div>
                </template>
            </div>

            {{-- „Neue Nachrichten"-Pill, wenn nicht am unteren Rand --}}
            <div class="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center" x-show="unread > 0" x-cloak
                 x-transition.opacity>
                <flux:button size="xs" variant="primary" class="pointer-events-auto" icon="arrow-down" x-on:click="scrollToBottom()">
                    <span x-text="unread"></span> neue
                </flux:button>
            </div>
        </div>
    </div>
    @fluxScripts
</body>
</html>
