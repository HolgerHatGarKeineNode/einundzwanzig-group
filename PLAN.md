# PLAN.md — Migration Flotilla → flotilla-einundzwanzig (Laravel + Livewire + Flux, SDK bleibt welshman)

> Zielgruppe: die nächste Claude-Instanz, die im Projekt `/home/user/Code/flotilla-einundzwanzig` startet und implementiert.

### Fortschritt (Stand 2026-07-07)

| Phase | Status | Ergebnis / nächster Schritt |
|---|---|---|
| **M0** — Setup (Vite + welshman-Insel + Shell) | ✅ **fertig** | `/nostr-smoke` zeigt 30 Live-`kind:1`-Notes; welshman bündelt via Vite; Design-System (Inconsolata) aus mobile-app übernommen. Commit `8fcae0f`. |
| **M0.5** — Mobile-WebView-Smoke | ✅ **fertig** | welshman-Insel + Relay-WebSockets laufen im nativen Android-WebView (Screenshot bestätigt). App-ID `space.einundzwanzig.group`. Commit `de6eacf`. |
| **M1** — Nostr-Login (NIP-07/46/nsec) | ✅ **fertig** | Client-Login (nsec/NIP-07/NIP-46 + welshman-Session + localStorage) **und** NIP-98-Handoff an die Laravel-Session (server-seitige Schnorr-Verifikation via `swentel/nostr-php`, Einmal-Nonce) + `nostr.auth`-Gate (`/spaces`) + beidseitiges Logout. 8 Feature-Tests grün. **NIP-55/Amber-Bridge → M8** (mobil). |
| **M1.5** — E2E-Login-Tests (Playwright) | ✅ **fertig** | NIP-07/nsec/NIP-46-Bunker-Login + Logout end-to-end im Host-Chromium gegen hermetischen In-Process-Relay; Wegwerf-nsec in `.env`. 4 E2E-Tests grün. Commit `63ef745`. |
| **M2** — Space/Room-Liste lesen | ✅ **fertig** | `groups.ts` portiert (Spaces aus kind 10009, Rooms aus 39000/9008, `deriveUserRooms`/`deriveOtherRooms`); NIP-42-AUTH-Policy automatisch; `/spaces`-Insel zeigt Spaces + beigetretene/andere Rooms live. E2E gegen lokalen **zooid** (auto-Start + Seed). Flux-`navlist`. |
| **M3** — Directory / Members (Fix A) | ✅ **fertig** | `repository.ts` (`deriveRelaySignedEvents`) + `members.ts` (13534/33534, HSL-Rollenfarben) portiert; `deriveSpaceDirectory` aggregiert Members+Rollen+Profile in EINEN Store, gated auf `relay.self` (NIP-11) → **kein Flackern** (Fix A ohne Map-Persistenz gelöst). `/directory` (Flux card-grid, Rollen-Badges, Client-Suche). App auf **fixierten Default-Space** umgestellt (§12, keine Auswahl-Pflicht). 3 E2E-Tests grün (Members+Rollen, Suche, Reload); Suite gesamt 9/9. |
| **M3.5** — Home/Landing + Navigation (Design) | ✅ **fertig** | Gestaltete Landing (`/`) im EINUNDZWANZIG-Design (Logomark auf hellem Chip, Inconsolata-Wortmarke + Terminal-Caret, Light+Dark), login-abhängige CTAs. Gemeinsamer `<x-app-header>` (Marke/Zurück/Aktionen) über Space/Directory/Einstellungen. `welcome.blade` entfernt. Marke IMMER **EINUNDZWANZIG**; „flotilla" komplett aus UI + Code-Kommentaren raus. Bonus: Mitglieder-Profile laden auch vom Space-Relay (Namen statt npubs). |
| **M4** — Chat lesen | ✅ **fertig** | `feeds.ts` (schlank statt `makeFeed`): Live-Sub (`limit:0`) + Cursor-Pagination (`until`) über `deriveEventsForUrl`; `deriveRoomChat` aggregiert Nachrichten + Profile + Datums-Divider + Autor-Gruppierung; Content via `@welshman/content` (`parse`/`renderAsHtml`, sicher). `/rooms/{h}` (`nostrRoomChat`): Verlauf lädt, „Ältere laden", Live-Nachrichten (verifiziert), „Neue"-Pill, Auto-Scroll. Rooms in `/spaces` verlinken hierher. 2 E2E-Tests (Rendering+Profile+Link, Live); Suite 11/11. |
| **M5** — Chat senden + Room join/leave | ⬜ offen | |
| **M6** — Politur | ⬜ offen | |
| **M7** — Realtime/Backend (optional) | ⬜ offen | |
| **M8** — NativePHP Mobile (Release) | ⬜ offen | Vorarbeit (Setup/Smoke) via M0.5 erledigt. |

> **Test-Grundsatz (gilt für jede M-Phase):** Jede Phase wird programmatisch getestet, bevor sie als ✅ gilt. **PHPUnit** für alles Server-seitige (Routen, Verifikation, Gate, Livewire). **Playwright-E2E** (Host-Chromium, hermetischer In-Process-Relay) für alles, was nur im Browser läuft (Signer/Login, welshman-Insel, Alpine-Bridges). Erledigte Phasen: M0 `NostrSmokeTest`, M1 `NostrLoginTest` (8), M1.5 baut die E2E-Suite auf; M0.5 ist naturgemäß manuell (nativer WebView, Screenshot-Nachweis).

### Referenz-Repos (nur lesen, **nicht ändern**)

| Repo | Rolle | Wofür nachschlagen |
|---|---|---|
| `/home/user/Code/flotilla` | **welshman-/Nostr-Referenz** (SvelteKit + `@welshman/*` v0.8.16) | Das Portier-Gut: `src/app/*.ts` (repository/groups/members/sync/policies/nip46/feeds/storage), welshman-API-Nutzung, NIP-29/42/86-Flows. **Bei jeder unklaren welshman-Signatur hier nachschauen statt raten.** Auch `node_modules/@welshman/*/dist` als API-Quelle. |
| `/home/user/Code/einundzwanzig-mobile-app` | **NativePHP-Mobile-Referenz** (Laravel + NativePHP Mobile v3) | Fertiges Mobile-Setup als Vorlage: `auth.json` (Marketplace-Credentials für Premium-Plugins), `composer.json` (Plugin-Set inkl. `nativephp/mobile-secure-storage`), `config/nativephp.php`, `.env` `NATIVEPHP_*`-Keys, `native:*`-Nutzung. Skill: `.claude/skills/nativephp-mobile`. |

---

## 1. Ziel & Kontext

Der Nostr-Client **Flotilla** (SvelteKit-SPA, Nostr-SDK `@welshman/*`) wird in ein bestehendes **Laravel / Livewire Starter Kit + Flux UI Pro**-Projekt migriert. **Das Nostr-SDK bleibt welshman** — es wird *nicht* gewechselt. Der Kern der Migration ist deshalb: **Flotillas bestehenden, framework-nahen `src/app/`-Layer nahezu 1:1 portieren** und nur die **SvelteKit-UI** durch **Livewire + Flux + Alpine** ersetzen. Migriert wird **nur der Verein-Kern**.

**Warum welshman bleibt** (statt das SDK zu wechseln): welshman bildet Flotillas exakten zooid-Stack bereits vollständig ab — `tracker` (Event→Relay-Herkunft), relay-signiertes Directory (13534/33534), NIP-29-Groups, NIP-86-Relay-Management (`manageRelay`), NIP-42 AUTH-Policies. Genau diese Punkte wären auf einem anderen SDK Eigenbau/Risiko. Der bestehende Code ist gegen diesen Relay getestet → **Wiederverwendung schlägt Neubau**.

**Harte Rahmenbedingungen (Auftraggeber, nicht verhandelbar):**
- **Nostr bleibt Source of Truth.** Kein DB-natives Umschreiben des Vereinszustands. Ein PHP/Laravel-Backend darf *optionale* Vorteile liefern (Read-Cache etc.), aber nie autoritativ werden.
- **SDK bleibt welshman** (`@welshman/app`, `-store`, `-net`, `-util`, `-lib`, `-signer`, `-router`, `-content`, `-feeds`, `-editor`; v0.8.16), client-seitig im Browser.
- **Scope = nur Verein-Kern:** Spaces/Relays, Rooms/Groups (NIP-29), Directory/Members, Text-Chat (lesen + senden), Membership/Roles, Nostr-Login (NIP-07/NIP-46).
- **Out of Scope:** Voice/LiveKit (`$lib/livekit` fällt weg), DMs (NIP-17), Blossom-Media, Threads, Reactions, Zaps, Push, Calendar/Classifieds/Polls/Goals/Library.
- **Auth = Nostr-Login** (npub/Signer). **Signing bleibt IMMER client-seitig** — der Private Key verlässt den Browser nie. Der Server sieht nur den (verifizierten) pubkey.
- **Kein persistenter Realtime-Server.** welshman hält Live-Subscriptions bereits im Browser; separates Realtime/Polling ist eigener, späterer Meilenstein.
- **Hybrid Web + Mobile aus EINER Codebasis.** Dasselbe Laravel-Projekt wird (a) als klassischer Web-Client gehostet **und** (b) via **NativePHP Mobile v3** zu einer iOS-/Android-App kompiliert. NativePHP bettet PHP+Laravel in eine WebView-Shell ein (kein Remote-Webserver, offline-first, nur SQLite/`database`-Queue, `.env` wird mitgeliefert). Die welshman-Nostr-Insel (JS + WebSockets) läuft im WebView unverändert weiter. Details, Konsequenzen und Mobile-Meilenstein: **§11**. App-ID `space.einundzwanzig.group` (fix, eigene ID neben dem Portal).
- **Eigenes Design — KEINE Flotilla-Optik.** Flotillas UI/Layout wird *nicht* übernommen. `flotilla-einundzwanzig` bekommt ein neues, eigenständiges AAA-Design aus der **einundzwanzig-Designfamilie**: das bereits ausgereifte Design-System aus `einundzwanzig-mobile-app` (Schrift **Inconsolata**, Bitcoin-Brand-Ramp, Token-/Motion-Skalen) wird als Grundlage übernommen — siehe **§12**. Das Komponenten-Mapping (§6) beschreibt nur **Funktion/Datenquelle**, nicht Aussehen.
- **Flux UI ist Pflicht für ALLE UI-Controls.** Jedes interaktive/darstellende Element nutzt die passende **Flux-Komponente** (`flux:button`, `flux:input`, `flux:tabs`, `flux:navlist`, `flux:card`, `flux:badge`, `flux:heading`/`flux:text`, `flux:callout` …) statt rohem HTML. Rohes `<button>`/`<input>`/`<select>` ist nicht zulässig, wo es eine Flux-Entsprechung gibt; rohe `<ul>/<li>/<div>` nur für reinen Content/Layout ohne Flux-Pendant. Flux-Props sind **compile-time** (server-seitig) — dynamische Zustände nicht per `::prop` an Flux binden, sondern die zustandsführende Flux-Komponente nutzen (z.B. `flux:tabs` statt Alpine-Toggle auf Buttons).
- **EIN fixierter Space, KEINE Space-Rail, KEINE Auswahl-Pflicht.** Die App zeigt immer nur **einen** aktiven Space (kein Discord-Multi-Space-Layout, keine dauerhafte Space-Navigation links/unten). Der Default ist eine **hardcodierte Space-URL** (`DEFAULT_SPACE_URL`, aktuell der lokale Test-Relay), die **sofort** geladen wird — **keine** „Space auswählen"-Abfrage im Default-Pfad. Gewechselt wird nur in den **Einstellungen**; Persistenz in localStorage (`activeSpaceUrl`, überschreibt den Default). Details: **§12**.
- **Ziel-Projekt existiert:** Laravel 13 / Livewire **v4** / Flux Pro v2.15 / Fortify + Passkeys / Laravel Boost / Tailwind v4 (via `@tailwindcss/vite`). *(Interop-Muster für Livewire **4** ggf. gegen die Doku verifizieren.)*

---

## 2. Ist-Architektur (Flotilla)

**Grundcharakter:** Reine Client-SPA (`+layout.ts`: `ssr = false`, `adapter-static`). Kein App-Backend; `server.js` (Hono) macht nur Static-Serving + OG-Meta-Injection. Alle Daten kommen client-seitig über Nostr-Subscriptions in einen In-Memory-`repository` (+ `tracker` für Event→Relay-Herkunft); **Svelte-Stores (`svelte/store`) leiten reaktiv daraus ab**. Persistenz in IndexedDB (Teil-Whitelist).

### SvelteKit-Routen (Verein-Kern)

| Route | Zweck | Geladene Nostr-Daten (client) |
|---|---|---|
| `/` | Redirect → `/home` bzw. erster Space | – |
| `/home` | Willkommen/Landing | – |
| `/spaces` | Space-Liste / Discovery | `loadUserGroupList()`, `pull({kinds:[ROOMS]})`, Relay-Suche (Fuse) |
| `/spaces/[relay]` (Layout) | Membership/Auth-Guard | `deriveRelayAuthError`, `relaysPendingTrust`, `loadUserGroupList([url])` → Join-Modal |
| `/spaces/[relay]` | Mobil-Menü / Desktop-Redirect | – |
| `/spaces/[relay]/about` | Space-Info | Relay-Profil (NIP-11) |
| `/spaces/[relay]/chat` | Space-weiter Chat (kind 9, kein `#h`) | `makeFeed({kinds:[MESSAGE,RELAY_ADD_MEMBER]})`, `publishThunk` |
| `/spaces/[relay]/[h]` | Einzelner Room/Group (NIP-29, `#h`) | `deriveRoom`, `makeFeed({#h:[h]})`, `joinRoom`/`leaveRoom`, `publishThunk` |
| `/spaces/[relay]/directory` | Mitglieder + Rollen | `load({kinds:[RELAY_MEMBERS,RELAY_ROLE]})`, `deriveSpaceMembers/Roles/MemberRoles`, `deriveUserIsSpaceAdmin` |
| `/join?<invite>` | Invite einlösen | `parseInviteLink` / `SpaceInviteAccept` |
| `/[bech32]` | Nostr-Entity-Resolver | `load(getIdFilters(...))` → redirect |

Auth-Gate global: `AppContainer.svelte` (`{#if $pubkey}` sonst `Landing`-Login-Dialog, NIP-07/46). `[relay]/+layout.svelte` = relay-spezifischer Membership/AUTH-Guard.

### welshman-Layer (Schlüsseldateien in `src/app/` — **das ist das Portier-Gut**)

Import-Verteilung über `src/app/*.ts`: `@welshman/util` (57×), `-lib` (32×), `-app` (29×), `-store` (14×), `-net` (11×), `-router` (6×), `-signer` (3×), `-editor` (1×). **26 dieser Dateien nutzen `svelte/store`.** SvelteKit-Kopplung ist minimal: nur `$app/stores` (5×), `$app/navigation` (2×), `$lib/livekit` (3× — out of scope), `$lib/util` (1×).

- `repository.ts` — Store-über-Repository-Layer. Kritisch: `deriveRelaySignedEvents(url, filters)` filtert Events auf `pubkey === relay.self` (nur relay-signierte Events; für RELAY_MEMBERS/RELAY_ROLE). `relay.self` kommt aus NIP-11 (HTTP-Fetch).
- `groups.ts` — NIP-29 Rooms + User-Space/Room-Liste (kind 10009). `readRoomMeta`, Delete-Anwendung, `addSpace/removeSpace/addRoom/removeRoom` via `publishThunk` (nip44-self-encrypted).
- `members.ts` — Membership + Roles. Reaktive Ableitungen. **Admin-Mutationen laufen über NIP-86 `manageRelay` (HTTP + NIP-98)**: create/assign/edit/delete Role, add/remove/ban Member, `deriveUserIsSpaceAdmin` (= SupportedMethods).
- `sync.ts` — Subscription-Engine (`pullAndListen`, AbortController-Teardown). Negentropy deaktiviert (Full-Request-Fallback).
- `policies.ts` / `relays.ts` — NIP-42 AUTH-Policy (`authPolicy`, `makeSocketPolicyAuth`) + expliziter Join-AUTH-Flow (`attemptRelayAccess`).
- `nip46.ts` — NIP-46 Bunker/nostrconnect Broker.
- `feeds.ts` — `makeFeed`: Chat-Feed mit Sliding-Window-Pagination (eigener writable-Store).
- `storage.ts` — IndexedDB-Persistenz (Whitelist).

### Nostr-Kinds-Tabelle (Verein-Kern)

| Kind | Konstante | Bedeutung |
|---|---|---|
| 9 | MESSAGE | NIP-29 Room-/Space-Chat-Nachricht |
| 5 | DELETE | Nachricht löschen (NIP-09) |
| 10009 | ROOMS | User-Liste Spaces (`r`) + Rooms (`group`) |
| 39000 | ROOM_META | Room-Metadaten (`d`=h) |
| 39001 | ROOM_ADMINS | Room-Admins (`d`=h) |
| 39002 | ROOM_MEMBERS | Room-Mitglieder (`d`=h) |
| 9008 | ROOM_DELETE | Room-Löschung (`h`) |
| 9000 / 9001 | ROOM_ADD/REMOVE_MEMBER | Room-Member-Mutation |
| 9021 / 9022 | ROOM_JOIN / ROOM_LEAVE | Room Join/Leave |
| 19004 | ROOM_CREATE_PERMISSION | Recht Räume anzulegen |
| 13534 | RELAY_MEMBERS | Space-Mitgliederliste (**relay-signiert**) |
| 8000 / 8001 | RELAY_ADD/REMOVE_MEMBER | Space-Member-Mutation |
| 28934 / 28936 | RELAY_JOIN / RELAY_LEAVE | Space Join/Leave |
| 28935 | RELAY_INVITE | Space-Invite/Claim |
| **33534** | **RELAY_ROLE** *(app-lokal!)* | Space-Rollendefinition (`d`=id, label/color/order) |
| 22242 | CLIENT_AUTH | NIP-42 AUTH-Event |
| 27235 | HTTP_AUTH | NIP-98 (für NIP-86 Relay-Management) |

> `RELAY_ROLE = 33534` ist app-lokal in `members.ts` definiert (kein welshman-Kanon). Beim Portieren als Konstante mitnehmen.

### Bekannte Instabilitäten (beim Portieren **beheben**, nicht mitschleppen)

Diese sind **App-Bugs von Flotilla**, keine welshman-Limits — beim Portieren fixbar:
- **A. `relay.self` NIP-11 Race (Kernproblem):** `deriveSpaceMembers/Roles` filtern auf `relay.self`; solange NIP-11 nicht geladen ist, ist `relay.self === undefined` → Liste leer → „No members found", flackert dann rein. `relaysByUrl`/NIP-11 wird **nicht** persistiert; `RELAY_ROLE` (33534) fehlt in der IndexedDB-Whitelist. **Fix:** NIP-11/`relaysByUrl` persistieren **und** `relay.self` vor dem Rendern sicherstellen (ggf. server-seitig einmal auflösen, §10) + 33534 in die Storage-Whitelist.
- **B. Subscription-/Load-Timing:** Redundante `load()`-Calls pro Page zusätzlich zum globalen Sync (Doppelladung); nicht-deterministische Sub-Teardowns bei Page-Wechsel; harte `AbortSignal.timeout(3000)` gegen AUTH-Handshake. **Fix:** ein Subscription-Owner pro Space-Insel, sauberer Teardown, AUTH-toleranter Timeout.
- **C. Nicht-invalidierende imperative Caches:** `memoize`/`simpleCache` auf `deriveUserIsSpaceAdmin`/`SupportedMethods` → nach Rollenänderung stale. **Fix:** Cache-Invalidierung an Rollen-Events koppeln.

---

## 3. Ziel-Architektur (Client/Server-Grenze)

**Die eine Regel:** Alles, was **signiert wird, aus einem Relay kommt oder ein welshman-Store ist**, gehört in die **client-seitige Nostr-Insel** (Vite-gebündeltes TS + welshman + Alpine, im Browser). Alles, was nur **Shell / Routing / Gate / öffentliches Read-Modell** ist, gehört **Livewire** (Server). Der Server ist nie im Signaturpfad und kennt nur den (verifizierten) pubkey.

### Was Livewire (Server) rendert
- App-Shell: Layout, Space-Kopf (aktiver Space) + Room-Liste (SecondaryNav), Header, Modals-Gerüst, Buttons, Formular-Chrome — alles mit Flux-Komponenten. **Keine Space-Rail** (§12).
- Routing + Auth-Gate: welche Route/welcher Space sichtbar ist (pubkey aus verifizierter Session, §7).
- Leere **Mount-Points** (`<div wire:ignore x-data=...>`), in die die Nostr-Insel client-seitig rendert.
- *Optional* (später, §10): öffentliche Read-Caches (Space-Metadaten, Member-Listen, NIP-11 `self`, OG/SEO) — nie autoritativ.

### Was die Nostr-Insel (Client: welshman + Alpine) macht
- **Alle Nostr-Event-Listen** (Chat-Feed, Members, Roles, Rooms): aus welshman-**Svelte-Stores** (`deriveEvents`, `deriveSpaceMembers`, `makeFeed`, …), portiert aus `src/app/`.
- **Relay-Subscriptions + NIP-42 AUTH** (`@welshman/net` Socket-Policies; WebSockets im Browser; Server hat keinen Signer).
- **Signing** (Login, kind 22242 AUTH, alle publizierten Events) via `@welshman/signer` (NIP-07/NIP-46).
- Client-lokale View-States: Suchfilter, Scroll/„New Messages", Compose/Reply/Edit, Menü-Toggles.

### Reaktivitäts-Bridge welshman-Store → Alpine (der zentrale Kniff)
welshman-Stores erfüllen den **Svelte-Store-Contract**: `store.subscribe(cb) → () => void` (unsubscribe). Das läuft **ohne** Svelte-Compiler und ohne `.svelte`-Dateien — man installiert `svelte` nur als npm-Paket und importiert ausschließlich aus `svelte/store`. Ein dünner Adapter koppelt jeden Store an Alpine:

```ts
// resources/js/nostr/bridge.ts
import type { Readable } from 'svelte/store'
export function alpineFromStore<T>(store: Readable<T>) {
  return () => {
    const data = { value: undefined as T, _unsub: null as null | (() => void) }
    return {
      ...data,
      init() { this._unsub = store.subscribe(v => { this.value = v }) },
      destroy() { this._unsub?.() },
    }
  }
}
// Nutzung im Blade: <div wire:ignore x-data="spaceMembers(url)">…</div>
```

### Grenzregel im DOM (`wire:ignore`)
- Der **gesamte** client-gerenderte Nostr-Teilbaum steht in **`wire:ignore`**. Livewire fasst ihn nach dem ersten Render nie wieder an.
- **Livewire → Insel** (Space/Room-/Filterwechsel): per Livewire-/Browser-Event dispatchen; Alpine hört `@event.window` und baut die welshman-Subscription neu auf. **Nie** über Property-Re-Render im `wire:ignore`-Block.
- **Insel → Livewire** nur für schmale Signale (z.B. „User hat gepostet → Read-Cache invalidieren"): `$wire.method(...)`. **Kein `@entangle`** für Nostr-Event-Arrays.
- welshman-**Singletons** (`repository`, `tracker`, `pool`, aktiver `signer`, Sessions) **einmal** app-weit initialisieren (`resources/js/nostr/core.ts`) — genau wie Flotillas globaler App-Init, nicht pro Komponente.

### Datenfluss (einseitig, sauber)
`@welshman/net` Subscription → `repository` (+ `tracker`) → welshman-Store (`deriveEvents`/`makeFeed`) → `alpineFromStore` → Alpine-`x-for` render. Publish: `makeEvent → signer.sign → publishThunk(pool, url)` → landet über `repository` selbst wieder im Store/Feed.

---

## 4. Portierungs-Landkarte: Flotillas `src/app/` → `resources/js/nostr/`

Kein SDK-Mapping nötig — welshman bleibt. Es geht um **Datei-Portierung** + Ersatz der wenigen SvelteKit-Glue-Stellen.

| Flotilla-Quelle | Portieren nach | Anpassung |
|---|---|---|
| `src/app/repository.ts` (`deriveRelaySignedEvents`, `tracker`) | `nostr/repository.ts` | **direkt.** Optional: `relay.self` vor Filter absichern (Fix A). |
| `src/app/groups.ts` (NIP-29 Rooms, kind 10009) | `nostr/groups.ts` | **direkt.** |
| `src/app/members.ts` (Membership, Roles, `manageRelay` NIP-86, 33534) | `nostr/members.ts` | **direkt.** `RELAY_ROLE=33534`-Konstante mitnehmen. |
| `src/app/sync.ts` (`pullAndListen`, Teardown) | `nostr/sync.ts` | **leicht anpassen:** Owner = Alpine-Insel statt Svelte-Page (Fix B). |
| `src/app/policies.ts` / `relays.ts` (NIP-42 `authPolicy`) | `nostr/policies.ts` | **direkt** — AUTH-Policy funktioniert unverändert (zooid `public_read=false`). |
| `src/app/nip46.ts` (Bunker-Broker) | `nostr/nip46.ts` | **direkt.** |
| `src/app/feeds.ts` (`makeFeed`, Pagination) | `nostr/feeds.ts` | **direkt.** |
| `src/app/storage.ts` (IndexedDB-Whitelist) | `nostr/storage.ts` | **anpassen:** `33534` + `relaysByUrl`/NIP-11 in die Whitelist (Fix A/C). |
| **`$app/stores` (`page`)** (5×) | — | **ersetzen:** aktueller Space/Room kommt aus Livewire-Route → per Browser-Event/`x-data`-Prop in die Insel, eigener kleiner `page`-Store. |
| **`$app/navigation` (`goto`)** (2×) | — | **ersetzen:** Navigation über Livewire (`wire:navigate`) / `window.location`. |
| `$lib/livekit` (3×) | — | **entfällt** (out of scope). |
| `$lib/util` (1×) | `nostr/util.ts` | Mini-Helper mitnehmen. |
| Globaler App-Init (welshman Singletons, Sessions, Storage-Sync) | `nostr/core.ts` | **direkt**, einmalig vor `Livewire.start()`. |

**Prinzip:** Wo eine welshman-Signatur unklar ist → **im Quellcode nachschlagen**: `/home/user/Code/flotilla/node_modules/@welshman/*/dist` und die konkrete Nutzung in `/home/user/Code/flotilla/src/app/`. Nichts erfinden — der funktionierende Code existiert bereits.

---

## 5. NIP-29 / AUTH / NIP-86 — mit welshman bereits gelöst

Keine Machbarkeitsfrage mehr (das ist Flotillas produktiver Stack). Nur bestätigen + portieren:

- **NIP-29 Groups:** Rooms-Metadaten/Members/Admins (39000–39002), Join/Leave (9021/9022), Member-Mutation (9000/9001), Chat (kind 9) — alles in `groups.ts`/`members.ts`/`feeds.ts` vorhanden.
- **NIP-42 AUTH:** `policies.ts` (`authPolicy`/`makeSocketPolicyAuth`) triggert AUTH automatisch über `@welshman/net`-Socket-Policies. Läuft gegen `public_read=false` (zooid). **Kein Glue-Eigenbau** — im Gegensatz zu Alternativ-SDKs. AUTH-WebSocket lebt zwingend im Browser (Server hat keinen Signer).
- **NIP-86 Relay-Management** (Admin-Rollen/Members/Bans): `manageRelay` (HTTP + NIP-98) inkl. `deriveUserIsSpaceAdmin`/`SupportedMethods` in `members.ts` vorhanden. **Signatur erfordert den Client-Signer → bleibt client-seitig** (Server könnte höchstens ein bereits signiertes Event relayen, §10).
- **Relay-signiertes Space-Directory** (13534 + app-lokal 33534): `deriveRelaySignedEvents` (`pubkey===relay.self`) + `tracker` — welshman-eigen, vorhanden. Nur Instabilität A beim Portieren beheben.

**Verbleibende Nicht-SDK-Risiken:** (1) `svelte/store`→Alpine-Bridge in Livewire **4** praktisch verifizieren; (2) SvelteKit-Glue-Ersatz (`$app/stores`, `$app/navigation`); (3) welshman v0.8.16 als reines Vite-Bundle (kein SvelteKit-Buildkontext) — Tree-Shaking/ESM prüfen.

---

## 6. Komponenten-/Routen-Mapping

> **Achtung — dies ist ein Funktions-/Datenmapping, KEIN Design.** Die Tabelle sagt nur, *welche Livewire-Komponente welche welshman-Daten mountet* — nicht, wie es aussieht. Layout, Optik, Dichte und Navigation kommen aus **§12** (mobile-first **Single-Space-Paradigma**, KEINE Discord-Space-Rail, im einundzwanzig-Design-System). Flotillas Aussehen wird **nicht** nachgebaut.

| Flotilla-Route / -Komponente | Livewire-Komponente | Flux-Bausteine | Client-Insel (welshman) |
|---|---|---|---|
| `AppContainer` (Auth-Gate) | `AppShell` + `auth`-Gate | `flux:sidebar`, `flux:main` | `$pubkey`-Store, Login-Modal |
| `Landing` / LogIn.svelte | `LogInModal` | `flux:modal` + `flux:button`-Stack | `Nip07Signer`/`Nip46Signer` |
| `/` , `/home` | Route-Redirect + `Home` (statisch) | `flux:heading`/`flux:text` | – |
| `/spaces` (Discovery) | `SpaceIndex` | Liste + `flux:input` (Suche) | `pull({kinds:[ROOMS]})`, Fuse client |
| `[relay]/+layout` (Guard) | `SpaceLayout` + `EnsureMemberOfSpace` | Layout-Grid | AUTH-Flow (`authPolicy`) + Membership |
| `SpaceMenu` (SecondaryNav) | `SpaceMenu` | `flux:navlist` + `.group`, `flux:dropdown`, `flux:avatar`, `flux:badge` | `deriveOtherRooms`/`deriveUserRooms` |
| `/spaces/[relay]/about` | `SpaceAbout` | `flux:card`, `flux:badge` | NIP-11 + Space-Metadaten |
| `/spaces/[relay]/directory` + `SpaceMember` | `MemberDirectory` | `flux:input`, `flux:card`-Grid, `flux:avatar`, `flux:badge` (HSL inline-style), `flux:dropdown` | `deriveSpaceMembers/Roles/MemberRoles` |
| `/spaces/[relay]/chat` + `/[h]` + `RoomItem` | `RoomChat` | `flux:header`, `flux:separator`, `flux:avatar`, `flux:callout` (Join-Banner) | `makeFeed({kinds:[9],"#h":[h]})`, `@welshman/content` |
| `RoomCompose` (Composer) | `RoomCompose` (Blade-Insel) | `flux:input.group`, `flux:button` (Send) | `@welshman/editor` (TipTap) o. `flux:textarea`; `publishThunk` |
| Room join/leave | Action in `RoomChat` | `flux:button` | `joinRoom`/`leaveRoom` (9021/9022) |
| `SpaceRoles`/`RoleForm`/`RoleBadge` | `SpaceRoles` | `flux:modal`, `flux:input`, `flux:textarea`, native `range` (HSL), `flux:badge` | 33534 + `manageRelay` (NIP-86) |
| `SpaceMemberRoles` (Zuweisung) | `MemberRoles` | `flux:modal`, `flux:checkbox.group` | `manageRelay` assign/unassign |
| `SpaceMembersBanned` | `BannedMembers` | `flux:modal`, `flux:card`-Liste | `manageRelay` ListBanned/Ban |
| `RoomMembers`/`RoomMembersAdd` | `RoomMembers` | `flux:modal`, `flux:select multiple` | 39002 + 9000 |
| `/join` | `InviteAccept` | `flux:modal`/`flux:card` | `parseInviteLink` + RELAY_JOIN |
| ~~PrimaryNav / Space-Rail~~ → **Space-Auswahl in Einstellungen** | `SpaceSettings` (eigene Route `/settings/space`, `nostr.auth`) | `flux:radio.group`/`flux:navlist` der beigetretenen Spaces | `userSpaceUrls` + `activeSpaceUrl` (localStorage) |

**Stolpersteine:** (1) imperatives `pushModal` → deklarative `flux:modal` + `wire:model`/`$flux.modal()`. (2) TipTap-Composer (`@welshman/editor`) bleibt Client-JS; `flux:textarea` als Minimal-Fallback. (3) HSL-Rollenfarben als `flux:badge` mit inline-style. (4) Login-Signer = Alpine/JS-Bridge, nie server-seitig. (5) Svelte-Komponenten-Reaktivität (`$store`, `{#each}`) → `alpineFromStore` + `x-for`.

---

## 7. Nostr-Login (Ablauf)

**Prinzip:** Signing zu 100% im Browser (`@welshman/signer` + Flotillas `nip46.ts`/Session-Handling). Server bekommt nur den pubkey — *beweisbar*, nicht behauptet.

### Client-Ablauf
1. **NIP-07:** `Nip07Signer` (Button nur wenn `window.nostr` vorhanden) → `getPubkey()`.
2. **NIP-46:** `Nip46Signer` via Flotillas `nip46.ts`-Broker — Bunker-URI einfügen oder `nostrconnect://`-URL/QR; Session-Persistenz übernehmen.
3. Aktive Session/Signer als welshman-App-Singleton (`@welshman/app` Sessions) halten und über `storage.ts` persistieren. **nsec-Login depriorisieren** — NIP-07/46 als Primärpfade.

### Signer-Pfade nach Plattform

| Pfad | Web | Mobile (NativePHP) |
|---|---|---|
| **NIP-07** (`window.nostr`, Extension) | Primär | **entfällt** (keine Browser-Extension im WebView) |
| **NIP-46** (Bunker / `nostrconnect://`) | Primär | **Primär** — `nip46.ts` unverändert; `nostrconnect`-Callback via NativePHP **Deep-Link** (`NATIVEPHP_DEEPLINK_*`) zurück in die App statt Browser-Redirect. |
| **NIP-55** (Android External Signer, z.B. Amber) | – | **Mobile-nativer Pfad** (Android): Signatur-Request per Intent an den installierten Signer, Antwort via Deep-Link/Event. Neu zu bauen (nicht in Flotilla); über ein NativePHP-Bridge/Intent. iOS hat kein NIP-55 → dort NIP-46. |
| **nsec** (lokaler Key) | depriorisiert | Fallback — Key **nur** verschlüsselt im **SecureStorage-Plugin** (`nativephp/mobile-secure-storage`, Premium; Credentials aus `einundzwanzig-mobile-app/auth.json`), optional per **Biometrics** entsperrt. Nie in IndexedDB/`.env`. |

Der Signer bleibt in **allen** Fällen client-seitig im WebView — auch auf Mobile sieht die (lokale) Laravel-Instanz nie den Key.

### pubkey-Handoff an Laravel (nur pubkey, verifiziert)
1. Livewire/Controller gibt eine zufällige `challenge` (Nonce) aus.
2. Client signiert ein **NIP-98**-Auth-Event (kind 27235) über `{url, method, challenge}` mit demselben Signer.
3. Client `POST /nostr/login` mit `{ pubkey, event }` (+ CSRF).
4. Laravel **verifiziert die Signatur server-seitig** (z.B. `swentel/nostr-php`), prüft Nonce + Zeitfenster, setzt `session(['nostr_pubkey' => $pubkey])`.
5. Erst danach gilt das Livewire-Auth-Gate als beglaubigt (Fortify-Session als Träger; Passkeys optional/orthogonal).

### Zwei getrennte Session-Begriffe
- **Laravel-Session (Cookie):** „welcher pubkey ist angemeldet" — für Server-Rendering/Gate. Verifiziert via NIP-98.
- **Nostr-Session (Browser):** welshman-Session + Signer — Source of Truth fürs Signieren + **NIP-42 Relay-AUTH** (komplett im Browser, getrennt von Laravel-Auth).

### Handoff nach Plattform
- **Web:** vollständiger NIP-98-Handshake (oben) — der Server ist remote, das Gate muss den pubkey *beweisbar* kennen.
- **Mobile:** **kein Server-Handshake.** Die Laravel-Instanz läuft lokal auf dem Gerät (single-user); der NIP-98-Handoff wäre Zeremonie ohne Sicherheitsgewinn. Gate = Präsenz von pubkey/Signer in der Nostr-Insel (WebView), lokal geprüft. Der Auth-Guard verzweigt per Plattform-Flag (`function_exists('nativephp_call')`, §11).

---

## 8. Migrations-Meilensteine

### M0 — Setup: Vite + welshman-Insel + Shell
- **Ziel:** Build-Pipeline + welshman-Singletons + leere Flux-Shell.
- **Schritte:** `npm i @welshman/app @welshman/store @welshman/net @welshman/util @welshman/lib @welshman/signer @welshman/router @welshman/content @welshman/feeds @welshman/editor svelte nostr-tools` (+ `@tiptap/core @tiptap/pm` falls Editor; Versionen aus Flotilla: welshman `^0.8.16`, svelte `^5`). **Nur `svelte/store` importieren — kein `@sveltejs/vite-plugin-svelte`, keine `.svelte`-Dateien.** `resources/js/app.js → app.ts`; Vite-Input auf `.ts`; `tsconfig.json`. **Alpine NICHT separat installieren** (Livewire v4 bringt es mit). `resources/js/nostr/core.ts` (repository, tracker, pool, storage-init) + `bridge.ts` (`alpineFromStore`). `Alpine.data(...)` **vor** `Livewire.start()` registrieren. `.env`-Defaults (Space-/Indexer-/Signer-Relays) aus Flotilla übernehmen. **Design-System aus `einundzwanzig-mobile-app` übernehmen, NICHT aus Flotilla** (§12): `resources/css/app.css` (Inconsolata via `@fontsource/inconsolata`, brand/zinc-Ramp, Radius/Shadow/Motion-Tokens, `surface-card`/`pressable`/safe-area-Utilities, Motion-Bibliothek) als Basis kopieren. Flux `@fluxAppearance`/`@fluxScripts` im Layout; keine Root-Var-Overrides, die mit Flux `--color/--radius/--shadow` kollidieren.
- **DoD:** Leere Livewire-Seite mit Flux-Layout lädt; `repository`/`pool` im Browser initialisiert; ein Test-`load/pull` gegen einen offenen Relay füllt das `repository` (Konsole); `alpineFromStore` rendert eine Test-Liste.

### M0.5 — Mobile-WebView-Smoke-Test (Machbarkeits-Gate, früh)
- **Ziel:** **Bevor** Nostr-Feature-Arbeit auf Mobile geplant wird, das *eine* riskante Unbekannte beweisen: läuft die welshman-Insel im nativen WebView **und gehen WebSockets zu Relays raus**? Das entscheidet, ob der Mobile-Pfad (§11/M8) überhaupt trägt — deshalb hier statt erst in M8.
- **Schritte:** NativePHP Mobile v3 minimal nach Vorlage `einundzwanzig-mobile-app` aufsetzen (`native:install android`, App-ID `space.einundzwanzig.group`, `NATIVEPHP_*`-Basis-Keys). `yarn build --mode=android` (Pflicht) → `native:run android`. Die **M0-Testseite** (dieselbe: `pull` gegen offenen Relay + `alpineFromStore`-Liste) im Emulator laden. `native:tail` + WebView-Konsole beobachten: initialisiert `pool`, öffnet der Socket, kommen Events an? Zusätzlich **einen AUTH-Relay** (`public_read=false`) gegentesten — NIP-42-Handshake im WebView ist der eigentliche Zweifelsfall.
- **DoD:** Emulator zeigt die Live-Liste aus echten Relay-Events; WebSocket-Verbindung (inkl. NIP-42-AUTH) steht im WebView nachweislich. **Bei Scheitern:** Mobile-Strategie neu bewerten (Ursache dokumentieren) *bevor* M1–M7 gebaut werden — nicht erst bei M8.
- **Hinweis:** rein infrastrukturell, **kein** Nostr-Feature. Läuft parallel zu M1 und blockiert es nicht; blockiert nur die Mobile-Zusage.

### M1 — Nostr-Login (NIP-07/NIP-46)
- **Ziel:** Einloggen, pubkey verifiziert in Laravel-Session.
- **Schritte:** `LogInModal` (Flux) + Alpine-Signer-Bridge; `nip46.ts` + welshman-Session portieren (§7). NIP-98-Challenge-Endpoint + PHP-Verify (`swentel/nostr-php`). `EnsureNostrAuth`-Gate. Logout (Laravel-Session + welshman-Session clearen). Session-Persistenz via `storage.ts`.
- **DoD:** NIP-07- und NIP-46-Login funktionieren; verifizierter pubkey steht in Session; geschützte Route ohne Login → Gate; Reload hält beide Sessions.

### M1.5 — E2E-Login-Tests (Playwright, Host-Chromium)
- **Ziel:** Die Client-Login-Pfade (die PHPUnit nicht erreicht, weil der Signer im Browser sitzt) end-to-end absichern — inkl. NIP-98-Handoff + Gate-Redirect.
- **Setup:** `@playwright/test` (kein Browser-Download — Host-Chromium via `executablePath: /bin/chromium`), `webServer` = Vite-Build + `php artisan serve`. **Hermetisch:** ein In-Process-`ws`-Relay als Transport (kein öffentliches Relay → deterministisch/CI-tauglich). Wegwerf-`nsec` fix in `.env` (`NOSTR_TEST_NSEC`, nur Tests) für Re-use.
- **Testfälle:**
  - **NIP-07:** injiziertes `window.nostr` (Mock via `addInitScript`, Wegwerf-Key) → „Mit Erweiterung" → Handoff → `/spaces`.
  - **nsec:** Key-Eingabe → Anmelden → Handoff → `/spaces`.
  - **NIP-46 (Bunker):** Fake-Bunker in Node (nostr-tools, nip44, kind 24133) über den lokalen Relay; `bunker://`-URI ins Feld → Verbinden → Handoff → `/spaces`. **Deckt zugleich Amber-als-Nostr-Connect ab.**
  - **Logout:** `/spaces` → Abmelden → beide Sessions leer → `/nostr-login`.
- **DoD:** Alle drei Login-Pfade + Logout laufen im echten Browser grün gegen den hermetischen Relay; kein Netzabhängiger Flake.
- **Hinweis:** NIP-55/Amber-**Intent** (Android-nativ, kein Relay) ist hier **nicht** testbar → echter Intent-Roundtrip erst in **M8** auf dem Emulator.

### M2 — Space/Room-Liste lesen
- **Ziel:** Beigetretene Spaces + Rooms anzeigen (read-only).
- **Schritte:** `groups.ts` portieren; kind 10009 laden → Spaces/Rooms; `deriveUserRooms`/`deriveOtherRooms`. `SpaceIndex` + `SpaceMenu` (Flux navlist) als Mount-Points; `alpineFromStore`-Bridge. `policies.ts` (**NIP-42 AUTH**) portieren — zooid verlangt AUTH.
- **DoD:** Nach Login erscheinen Spaces + Room-Liste live; AUTH gegen `public_read=false`-Relay klappt; Space-Wechsel (Livewire-Event → Alpine) baut Subscriptions korrekt neu auf.

### M3 — Directory / Members
- **Ziel:** Mitglieder + Rollen eines Space anzeigen — **ohne Flackern (Fix A)**.
- **Schritte:** `members.ts` + `repository.ts` portieren. `relay.self` (NIP-11) **vor** dem Filter sicherstellen: `relaysByUrl` persistieren (`storage.ts`-Whitelist erweitern) und/oder server-seitig einmal auflösen (§10). `33534` in Whitelist. `MemberDirectory` (Flux card-grid, RoleBadge HSL) + Client-Suche.
- **DoD:** Directory zeigt Members + Rollen **ohne** Race/Flackern (self-pubkey vor Filter da; überlebt Reload); Rollenfarben korrekt; Suche filtert.

### M3.5 — Home/Landing + Navigation (Design) ✅
- **Ziel:** Eine echte, markenkonforme **Startseite** statt der Laravel-Default-`welcome` — plus durchgängige Verlinkung, damit die App **ohne URL-Tippen** vollständig durchklickbar ist (Home → Nostr-Login → aktiver Space → Space-Einstellungen → Abmelden).
- **Umsetzung:** `home.blade.php` als Hero im EINUNDZWANZIG-Design (§12): Logomark (`<x-app-brand-mark>`, offizielles SVG auf hellem Chip → lesbar in Light **und** Dark, kein Clipping), Inconsolata-Wortmarke **EINUNDZWANZIG** + Terminal-Caret, `empty-state`-Stagger, login-abhängige CTAs (Anmelden ↔ „Zu deinem Space"). Gemeinsamer **`<x-app-header>`** (Brand-Mark→Home / Zurück, Titel, `subtitle`/`actions`-Slots) über `/spaces`, `/directory`, `/settings/space`. `welcome.blade.php` entfernt.
- **Marken-/Design-Regeln (dauerhaft, Auftraggeber):** Markenname IMMER **EINUNDZWANZIG** (komplett groß); das Wort „flotilla" **nie** in UI/Design — auch aus Code-Kommentaren raus (→ „Referenz-Client"). Client heißt EINUNDZWANZIG.
- **DoD erfüllt:** `/` zeigt die gestaltete Landing in Light+Dark; jeder Kern-Screen per Klick erreichbar; CTAs login-abhängig; Header konsistent; E2E 9/9 grün. Zusatz: Mitglieder-Profile laden auch vom Space-Relay (Namen statt npubs).

### M4 — Chat lesen ✅
- **Ziel:** Room-Chat-Verlauf anzeigen (read-only; Senden = M5).
- **Umsetzung:** `resources/js/nostr/feeds.ts` — **bewusst schlanker** als `makeFeed` des Referenz-Clients (kein bidirektionaler DOM-Scroller): Live-Subscription via `request({filters:[{kinds:[9],'#h':[h],limit:0}], signal})` + Cursor-Pagination via `load({until})`, beides über die reaktive `deriveEventsForUrl`-Ableitung. `deriveRoomChat(url,h)` aggregiert Nachrichten + Profile (`profilesByPubkey`) + Datums-Divider + Autor-Gruppierung in EINEN Store; Content über `@welshman/content` (`parse` + `renderAsHtml` → sichere HTML, Text escaped, URLs sanitized, je Event gecacht). `/rooms/{h}` (`room.blade.php`, `nostrRoomChat`): Skeleton→Verlauf, „Ältere laden", Live-Zustellung, „Neue"-Pill + Auto-Scroll bei `atBottom`. Rooms in `/spaces` verlinken auf den Chat. Profile laden auch vom Space-Relay (Namen statt npubs).
- **DoD erfüllt:** Verlauf lädt + paginiert; neue Nachrichten live (E2E-verifiziert via nak-Publish); Text/Emoji/Links korrekt gerendert; Profile aufgelöst. 2 E2E-Tests grün, Suite 11/11.
- **Nicht in M4:** Space-weiter Chat (kind 9 ohne `#h`) ausgelassen — Rooms sind der Kern; bei Bedarf später als eigener „Room" nachrüstbar.

### M5 — Chat senden + Room join/leave
- **Ziel:** Schreiben.
- **Schritte:** Composer (`@welshman/editor`/TipTap oder `flux:textarea`). Senden: `makeEvent(9,…)` → `signer.sign` → `publishThunk(pool, url)`; optimistic + `send_delay` kommen aus welshman-Thunk. Fehler via `waitForThunkError`. Reply/Delete (kind 5). Room join/leave: `joinRoom`/`leaveRoom` (9021/9022). Space-Join (RELAY_JOIN 28934 + claim, AUTH-Flow aus `relays.ts`).
- **DoD:** Nachricht senden erscheint im eigenen Feed + auf zweitem Client; Reply/Delete funktionieren; Room join/leave ändert Membership + Sichtbarkeit.

### M6 — Politur
- **Ziel:** Produktionsreife des Kerns.
- **Schritte:** Fehler-/Leerzustände (Empty-States, AUTH-Fehler-Callouts), Signer-Health-UX (NIP-46 „Signer antwortet nicht"), Modals vollständig (Invite, Roles/`manageRelay`, Banned). Responsive (Mobile Bottom-Nav via `flux:navbar`). Cache-Invalidierung für `deriveUserIsSpaceAdmin` (Fix C). CSP-Middleware. OG-Meta für Space/Invite-Links (Blade statt `server.js`-Cheerio).
- **DoD:** Verein-Kern voll bedienbar auf Desktop + Mobile; Admin-Aktionen (Roles/Ban) funktionieren; keine Race/Flacker-Zustände.

### M7 — Optional: Realtime/Polling + PHP-Backend-Vorteile
- **Ziel:** Optionale Server-Beschleunigung + Notifications (nicht jetzt).
- **Schritte:** welshman-Live-Subscriptions reichen bereits fürs Realtime. Optional Laravel Read-Cache (§10) für First-Paint/SEO; member-sync-Job; Notifications-Persistenz via periodisches Server-Polling. **Kein persistenter WS-Server.**
- **DoD:** Optionaler Nutzen messbar (z.B. schnellerer First-Paint der Member-Liste), ohne dass der Server autoritativ wird.

### M8 — NativePHP Mobile (iOS/Android aus derselben Codebasis)
- **Ziel:** Der Verein-Kern läuft als kompilierte App; Web-Hosting bleibt unberührt (§11).
- **Voraussetzung:** **M0.5 bestanden** (WebView-Machbarkeit bewiesen) + M1–M5 (Login, Lesen, Senden) laufen im Web.
- **Schritte:** NativePHP Mobile v3 nach Vorlage `einundzwanzig-mobile-app` aufsetzen (`native:install android`, `auth.json` für SecureStorage-Plugin, `config/nativephp.php`, `NATIVEPHP_*`-Keys, Deep-Link-Scheme für NIP-46/`nostrconnect`-Callback). Plattform-getrennte **Shell-Layouts** (§11) + `platform`-Flag. Mobile-Signer-Pfade (§7): NIP-46 primär, NIP-55/Amber (Android), nsec→SecureStorage+Biometrics-Fallback. `storage.ts`-Persistenz auf Mobile klären (IndexedDB im WebView vs. SecureStorage für Sensibles). `yarn build --mode=android` → `native:run android`.
- **DoD:** App startet im Emulator/Gerät, Login (NIP-46/NIP-55/nsec) funktioniert, Spaces/Chat lesen + senden gegen echten Relay; signiertes AAB (`native:package android --build-type=bundle`) baut. iOS via `native:jump` auf Echtgerät (Build nur auf macOS).

---

## 9. Offene Fragen / zu verifizieren

- **`svelte/store` → Alpine-Bridge in Livewire 4:** `alpineFromStore` + `wire:ignore`-Interop praktisch verifizieren (Lifecycle `init`/`destroy`, kein Doppel-Alpine).
- **welshman v0.8.16 als reines Vite-Bundle:** ohne SvelteKit-Buildkontext bündeln (ESM/Tree-Shaking, evtl. `optimizeDeps`/`ssr.noExternal`-Analoga). Ein früher Smoke-Test in M0.
- **SvelteKit-Glue-Ersatz:** `$app/stores` (`page` → aktueller Space/Room aus Livewire-Route) und `$app/navigation` (`goto` → `wire:navigate`) sauber ersetzen; welche `src/app`-Dateien betroffen sind vor M2 auflisten.
- **`relay.self`/NIP-11-Persistenz (Fix A):** client-seitig persistieren **oder** server-seitig einmal auflösen (§10) — entscheiden.
- **NIP-86 `manageRelay` server-seitig?** Realistisch bleibt Signieren client-seitig (Signer nötig); Server könnte nur relayen. Abwägen (§10).
- **Livewire-Version:** Ziel ist Livewire **4** — `wire:ignore`/`$wire`/Event-Dispatch-Details gegen die Doku verifizieren.
- **TipTap-Composer:** `@welshman/editor` übernehmen (Client-JS) oder `flux:textarea`-Minimal? Entscheiden.
- **PHP-Nostr-Client** (`swentel/nostr-php`): NIP-98-Verify + optionale kurzlebige Read-Queries — Reife/Eignung prüfen.
- **[Mobile] welshman-Insel im WebView:** Bundelt Vite die welshman-Insel so, dass sie im Android-/iOS-WebView lädt und **WebSockets zu Relays** (inkl. NIP-42-AUTH) rausgehen? → **M0.5** beweist das früh (Machbarkeits-Gate). WebView-Alter/`min_sdk 33`.
- **[Mobile] NIP-55 (Amber) Bridge:** Intent-Roundtrip Android External Signer ↔ WebView — über NativePHP-Plugin/Deep-Link. Neu zu bauen, iOS-Äquivalent fehlt.
- **[Mobile] Persistenz-Split:** welshman-Session/Whitelist in IndexedDB (WebView) vs. sensibler nsec in SecureStorage — Grenze festlegen.
- **[Mobile] NIP-46-Callback via Deep-Link:** `nostrconnect://`/Bunker-Rückkanal über `NATIVEPHP_DEEPLINK_*` statt Browser-Redirect verdrahten.

---

## 10. PHP-Backend — Ideen (offen, alle optional, nie autoritativ)

> Grundregel: PHP darf **nie** signieren, nie Keys sehen, nie autoritativ für User-State werden. Bei Konflikt gewinnt immer das client-seitige welshman-`repository`. Kein persistenter WS-Server.

- **[Option] Read-only Relay-Query + Cache:** Laravel öffnet kurzlebig (Request/Queue-Job) eine WS-Verbindung, zieht öffentliche Events (Space-Metadaten, Member-Listen, **NIP-11 `self`-pubkey**) → Redis/DB als Read-Modell. Vorteil: schneller First-Paint, **entschärft Instabilität A** (self-pubkey server-seitig einmal auflösen).
- **[Option] Member-Sync als Scheduled Job:** füllt das Read-Modell fürs Auth-Gate („ist pubkey Mitglied dieses Space?"). (Ein `member-sync.mjs` existiert bereits auf dem zooid-Server — als Vorlage.)
- **[Option] NIP-86-Management server-seitig:** Roles/Members/Bans (HTTP+NIP-98) — **aber** die NIP-98-Signatur braucht den User-Signer → Client signiert, Server relayed. Abwägen.
- **[Option] OG/SEO/Prerender:** Server-seitige OG-Tags + statische HTML-Fassung aus dem Read-Cache für Crawler/Share-Previews (klarer PHP-Vorteil, ersetzt Flotillas `server.js`-Cheerio-Injection durch Blade).
- **[Option] Notifications-Persistenz:** periodisches Server-Polling der Relays, Diff gegen letzten Stand pro pubkey, server-gerendert ausliefern.
- **[Option] Rate-Limiting / Missbrauchsschutz:** Login-Handshake + Cache-Warming-Endpoints über Laravel-Middleware/Throttle.

---

## 11. Hybrid Web + Mobile (NativePHP Mobile v3)

**Ziel:** Dasselbe Projekt hosten (Web) **und** zu iOS/Android kompilieren (NativePHP). Referenz-Setup: `/home/user/Code/einundzwanzig-mobile-app` (§Referenz-Repos). Skill: `.claude/skills/nativephp-mobile`.

### Modularität — kein zweites Projekt, geteilter Kern + getrennte Shell

> Auf die Rückfrage „Projekt modular aufsetzen, einmal Web, einmal Mobile?": **Nicht zwei Projekte.** Der teure, komplexe Teil (welshman-Nostr-Insel + Livewire-Komponenten-Logik) ist plattformunabhängig und **identisch** — den zu duplizieren wäre Wartungshölle und widerspräche NativePHPs „eine Codebasis"-Prinzip. Was sich real unterscheidet, ist fast nur die **Shell** (Navigation/Layout) und der **Auth-Guard**. Also: EIN Projekt, entlang dieser Naht getrennt.

**Geteilt (write once):**
- `resources/js/nostr/*` — die komplette welshman-Insel (§3/§4). Läuft im Browser **und** im WebView unverändert.
- Livewire-**Komponenten-Klassen** (Logik, Guards, Dispatch) und die **Content-Views** (Chat/Directory/Members/Rooms) — das sind nur `wire:ignore`-Mount-Points für die Insel, also plattformneutral.
- Flux-Bausteine innerhalb der Content-Views.

**Getrennt (pro Plattform):**
- **Shell-/Layout-Blades:** `layouts/web.blade.php` (Flux-Layout, Room-Liste — **keine Space-Rail**, §12) vs. `layouts/mobile.blade.php` (native EDGE `<native:bottom-nav>`/`<native:top-bar>`). Auswahl über **ein Plattform-Flag**.
- **Auth-Guard:** Web = NIP-98-Handoff an Server-Session; Mobile = lokale pubkey/Signer-Präsenz (§7).
- **Signer-Verfügbarkeit:** NIP-07 nur Web; NIP-55/SecureStorage nur Mobile (§7).

**Das Plattform-Flag:** `config('nativephp-internal.running')` (via `NATIVEPHP_RUNNING`) unterscheidet echte WebView-Runtime von Web. **NICHT** `function_exists('nativephp_call')` — die Funktion existiert auch im Web (PHP-Fallback des Pakets), siehe `EnsureNostrAuth`. Einmal als `config('app.is_mobile')`/Blade-Helper kapseln; Layout-Wahl + Guard-Verzweigung hängen daran.

```
             ┌─ layouts/web.blade.php    (Flux-Layout, keine Space-Rail, NIP-98-Gate)
Shell ───────┤                                    ↑ config('nativephp-internal.running')
             └─ layouts/mobile.blade.php (native EDGE nav, lokales Gate, SecureStorage)
                        │
   ┌────────────────────┴─────────────────────┐   ← ab hier 100% geteilt
   Livewire-Komponenten (Logik) + Content-Views (wire:ignore-Mounts)
                        │
             resources/js/nostr/* (welshman-Insel, WebSockets, Signing)
```

### NativePHP-Constraints, die den Nostr-Kern berühren
- **WebView statt Webserver:** Blade/Livewire lokal, PHP-Runtime eingebettet, **offline-first**. `yarn build --mode=android` ist **Pflicht vor jedem Kompilieren** (sonst alte Assets im Bundle). welshman-JS + Relay-WebSockets laufen im WebView (früher Smoke-Test, §M8/§9).
- **Nur SQLite + `database`-Queue**, keine Remote-DB. Für den Nostr-Kern irrelevant (Source of Truth bleibt Nostr/`repository`); die optionalen PHP-Read-Caches aus §10 sind auf Mobile schlicht **aus** — der Client zieht direkt von Relays.
- **`.env` wird mitgeliefert:** keine Server-Secrets ins Mobile-Bundle; Sensibles über `cleanup_env_keys`. Der Nostr-Key ist ohnehin nie in `.env`, sondern nur im **SecureStorage** (§7).
- **App-ID `space.einundzwanzig.group`** fix (eigene Bundle-ID, getrennt vom Portal `space.einundzwanzig.mobile`). `nativephp/` ist ephemer — nie committen.
- **Native Ergebnisse kommen als Events** (`#[OnNative(...)]`), nicht als Rückgabewert — relevant für SecureStorage/Biometrics/NIP-55-Bridge.

### Was Mobile NICHT ändert
Die client/server-Grenze aus §3 bleibt: Signing zu 100% im WebView-JS, Server (auch der lokale) nie im Signaturpfad. Mobile fügt nur **Shell + Signer-Transport + Persistenz-Ziel** hinzu — die welshman-Insel selbst ist plattformblind.

---

## 12. Design & UI-System (AAA, einundzwanzig-Familie)

**Leitsatz:** Kein Flotilla-Look. `flotilla-einundzwanzig` erbt die **einundzwanzig-Designsprache** aus `einundzwanzig-mobile-app` — dasselbe Design-System, damit Web-Client und kompilierte App zur selben Marke gehören. Das System ist **schon gebaut und ausgereift**; wir **übernehmen es**, nicht neu erfinden. Source of Truth: `/home/user/Code/einundzwanzig-mobile-app/resources/css/app.css`.

### Layout-Paradigma: EIN aktiver Space, mobile-first (KEINE Discord-Space-Rail)
**Harte Design-Entscheidung des Auftraggebers:** Die App fokussiert sich immer auf **genau einen aktiven Space**. Es gibt **keine** Discord-artige Space-Rail/Space-Navigation (weder links auf Desktop noch als dauerhafte Leiste auf Mobile). Die Liste aller beigetretenen Spaces ist **in den Einstellungen versteckt**; dort — und nur dort — wechselt der User den aktiven Space.

- **Fixierter Default-Space (hardcodiert, NICHT „erster beigetretener"):** Der Default ist eine **hardcodierte Space-URL** (`DEFAULT_SPACE_URL` in `resources/js/nostr/groups.ts`, überschreibbar via `window.__nostrSpace`; aktuell der lokale Test-Relay `ws://localhost:3334/`). Diese wird **sofort** geladen — **keine** „Space auswählen"-Abfrage/Empty-State im Default-Pfad. `activeSpace = activeSpaceUrl ?? DEFAULT_SPACE_URL` (immer non-null); `activeSpaceView` baut die Sicht für **jede** URL, auch wenn der User dem Space (noch) nicht laut kind 10009 beigetreten ist (Rooms/Members streamen direkt vom Space-Relay ein). Prod-Upgrade: echte Vereins-Relay-URL aus Server-Config injizieren statt hardcoden.
- **Aktiver Space:** eine persistente Präferenz in **localStorage** (`activeSpaceUrl`), die den Default überschreibt; `spaceChoices` (fixer Default + beigetretene Spaces) speist die Settings-Auswahl. (Multi-Device-Sync via Nostr-App-Data-Event kind 30078 ist ein späteres Refinement.) Alle Ansichten (Rooms, Directory, Chat) beziehen sich auf diesen einen Space.
- **Space-Wechsel:** ausschließlich auf einer **eigenen Nostr-Einstellungsseite** (hinter dem `nostr.auth`-Gate; die Fortify-Settings sind Laravel-User-basiert und hier nicht passend). Erreichbar über ein dezentes Zahnrad/Einstellungs-Icon, nicht über die Haupt-Navigation.
- **Anatomie:** Ohne Space-Rail bleibt pro Screen: Space-Kopf (Name/Icon des aktiven Space) → **Room-Liste** → **Chat-Bühne** (+ optional Member-Panel auf Desktop). Mobile: *ein* Screen zur Zeit, Stack-Navigation, Bottom-Sheets (`--radius-sheet`), FAB (`fab-enter`) für Compose, Safe-Area (`pt-safe`/`pb-safe`), kompakte Dichte. Desktop/Web: ab `md`/`lg` Room-Liste + Chat nebeneinander, dichter/ruhiger als Flotilla.
- **Ein responsives Blade**, das von Mobile (ein Screen) zu Desktop (Spalten) skaliert. Deckt sich mit den plattform-getrennten Shell-Layouts aus §11 — aber **keine** Rail-Variante mehr im `web.blade`.

### Übernommene Design-Tokens (aus `app.css`)
- **Schrift:** `Inconsolata` als `--font-sans` (Monospace-Charakter, technisch/Bitcoin), via `@fontsource/inconsolata` (400/500/600/700). **Das ist die prägende Design-Entscheidung** — die ganze UI ist monospaced.
- **Farbe:** Bitcoin-Brand-Ramp (`--color-brand-50…950`, brand-500 = `#f7931a`) + `zinc`-Neutrals; `--color-accent = brand`. Light **und** Dark (`.dark`-Variant, Flux `@fluxAppearance`).
- **Radius:** `--radius-tile` (Kacheln/Badges) < `--radius-card` (Cards) < `--radius-sheet` (Sheets).
- **Elevation:** `--shadow-card` / `-pressed` / `-pop` / `-glow` (Brand-Glow). Im Dark trägt der Border die Abgrenzung.
- **Motion:** `--ease-spring` / `--ease-emphasized` / `--duration-tap`.
- **Utilities:** `surface-card`, `.pressable` (Tap-Haptik), `pt-safe/pb-safe/px-safe`.
- **Motion-Bibliothek:** `list-stagger`, `page-enter`, `nav-pill`, `fab-enter`, `step-enter`, `.skeleton`-Shimmer, `.empty-state`-Stagger, `slide-down`.

### AAA-Qualitäts-Floor (nicht verhandelbar, aus dem System gelebt)
- **Motion mit Bedeutung:** Page-Enter bei `wire:navigate`, gestaffelte Listen (`list-stagger`), Press-Feedback (`.pressable`) — aber sparsam, nie Deko-Overkill.
- **Zustände sind Design:** echte Empty-States (`.empty-state`, mit Handlungsaufforderung), Skeletons statt Spinner beim Laden, AUTH-/Fehler-Callouts mit Klartext (was ist los, was tun) — deckt Flotillas Race-/„No members"-Flackern (Fix A) sauber ab.
- **`prefers-reduced-motion`** respektiert (im System bereits verdrahtet); sichtbarer Keyboard-Focus (`ring-accent`); Tap-Flächen groß genug trotz kompakter Dichte.
- **Chat-Details:** Rollen-Badges mit HSL-Inline-Farbe (aus 33534), Autor-Gruppierung + Datum-Divider, „New Messages"-Pill, Mono-Zeilen bleiben lesbar (Zeilenhöhe/Truncation bewusst).

### Vorgehen (frontend-design-Skill)
Beim tatsächlichen Bauen (M2+) das `frontend-design`-Skill aktivieren. Kein Design von Null: die Token/Utilities aus `app.css` sind gesetzt — die Arbeit ist, die **Chat-spezifischen** Screens (Space-Rail, Room-Liste, Chat-Feed, Directory, Compose) in dieser Sprache **kompakt und mobile-first** zu komponieren, nicht Farben/Fonts neu zu würfeln.
