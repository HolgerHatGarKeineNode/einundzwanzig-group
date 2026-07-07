# EINUNDZWANZIG — Group

> 🚧 **Work in Progress** — kein stabiler Stand, keine Garantien.

Nostr-Community-Client für **EINUNDZWANZIG**: Spaces, Räume, Directory und Chat auf
Nostr (NIP-29), gebaut mit Laravel, Livewire und Flux UI. Das Nostr-SDK (welshman)
läuft client-seitig im Browser; Signing bleibt immer im Browser — der private Key
verlässt nie das Gerät.

## Stack

- Laravel 13 · Livewire 4 · Flux UI · Tailwind v4
- Nostr-SDK: welshman (`@welshman/*`), client-seitig
- Tests: Pest + Playwright

## Status

Web-Client-Kern funktionsfähig: Nostr-Login (NIP-07/46), Spaces & Räume, Directory
mit Rollen, Chat lesen/senden, Admin (NIP-86). Der Mobile-Port (Chat als Package in
die Portal-App) ist in Planung — siehe `PLAN2.md`; der Web-Kern-Verlauf steht in
`PLAN.md`.
