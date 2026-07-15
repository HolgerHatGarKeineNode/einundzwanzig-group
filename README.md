# EINUNDZWANZIG — Group

> 🚧 **Work in progress** — not a stable state, no guarantees.

Nostr community client for **EINUNDZWANZIG**: spaces, rooms, directory and chat on
Nostr (NIP-29), built with Laravel, Livewire and Flux UI. The Nostr SDK (welshman) runs
client-side in the browser; signing always stays in the browser — the private key never
leaves the device.

## Stack

- Laravel 13 · Livewire 4 · Flux UI · Tailwind v4
- Nostr SDK: welshman (`@welshman/*`), client-side
- Tests: Pest + Playwright

## Status

The web client core works: Nostr login (NIP-07/46), spaces & rooms, directory with roles,
reading and sending chat, admin (NIP-86). The history of the web core is in `PLAN.md`.

**The mobile port has shipped** (which makes `PLAN2.md` history): the chat runs as the
`einundzwanzig/group` package inside the
[TWENTY ONE Companion](https://github.com/HolgerHatGarKeineNode/twenty-one-companion) app
for Android — with zaps, wallet and an on-device cache. Since app v1.7.0 it also has
**chat notifications without Goolag**: a native background worker asks the relay itself —
no Play Services, no second app, no push server in between. Login and room membership are
known only to the client, so this package supplies the state for it (`pushSyncState`, see
the package README).

## Chat package & contributing

The chat core (spaces/rooms/directory/login) is its own Composer package
`einundzwanzig/group`, living in a separate repo:
[einundzwanzig-group-package](https://github.com/HolgerHatGarKeineNode/einundzwanzig-group-package)
(branch `master`).

The `packages/einundzwanzig-group/` directory is **gitignored**; Composer picks the source
automatically:

| Situation | Source |
|---|---|
| `packages/einundzwanzig-group/` cloned locally | **symlink** to the local directory (dev) |
| directory missing (fresh clone / CI) | package as `dev-master` from GitHub |

**Working on the app only:** `composer install` is enough — the package comes from GitHub.
**Contributing to the package:** clone the repo into `packages/einundzwanzig-group/`, then
the symlink kicks in. Full guide: **[`CONTRIBUTING.md`](CONTRIBUTING.md)**.
