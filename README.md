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

## Chat-Package & Mitentwickeln

Der Chat-Kern (Spaces/Räume/Directory/Login) ist ein eigenes Composer-Package
`einundzwanzig/group`, das in einem separaten Repo lebt:
[einundzwanzig-group-package](https://github.com/HolgerHatGarKeineNode/einundzwanzig-group-package)
(Branch `master`).

Der Ordner `packages/nostr-chat/` ist **gitignored**; Composer wählt die Quelle per Weiche:

| Situation | Quelle |
|---|---|
| `packages/nostr-chat/` als Clone vorhanden | **Symlink** auf den lokalen Ordner (Dev) |
| Ordner fehlt (frischer Clone / CI) | Package als `dev-master` von GitHub |

**Nur an der App arbeiten:** `composer install` genügt — das Package kommt von GitHub.
**Am Package mitentwickeln:** Repo nach `packages/nostr-chat/` klonen, dann greift der
Symlink. Vollständige Anleitung: **[`CONTRIBUTING.md`](CONTRIBUTING.md)**.
