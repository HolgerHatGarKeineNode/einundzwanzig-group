import { registerNostrComponents } from '@einundzwanzig/nostr-chat-island'

// Alpine bringt Livewire v4 mit. `alpine:init` feuert vor dem Start — hier
// registrieren wir die Nostr-Komponenten, sodass `x-data="…"` sie kennt.
document.addEventListener('alpine:init', () => {
    registerNostrComponents((window as unknown as { Alpine: Parameters<typeof registerNostrComponents>[0] }).Alpine)
})
