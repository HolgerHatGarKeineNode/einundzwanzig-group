# PLAN2.md — M8: Chat-Feature als Package in die Portal-App (`einundzwanzig-mobile-app`)

> Zielgruppe: die nächste Claude-Instanz, die den mobilen Chat-Port umsetzt.
> **Vorgänger:** `PLAN.md` (M0–M7, Web-Client fertig). Dieses Dokument ersetzt/überschreibt
> die M8- und §11-Annahmen aus PLAN.md, wo unten explizit vermerkt.
>
> **Begriffe (fix):**
> - **Web-Client** = dieses Repo `/home/user/Code/flotilla-einundzwanzig/` (der EINUNDZWANZIG-Nostr-Client, Web-only). Bleibt **Source of Truth** des Chat-Codes.
> - **Portal-App** = `/home/user/Code/einundzwanzig-mobile-app/` (bestehende Laravel/NativePHP-Mobile-App, App-ID `space.einundzwanzig.mobile`). Host für den Chat.
> - **Chat-Feature** = der Nostr-Community-Kern (Spaces/Rooms/Directory/Chat/Login), der portiert wird.
> - **welshman-Insel** = die client-seitige JS/WebSocket-Schicht (`resources/js/nostr/*`), plattformblind.

---

## 1. Entscheidungen (2026-07-07, Auftraggeber)

| Thema | Entscheidung |
|---|---|
| **App-Strategie** | **Nur Chat-in-Portal.** Der Chat wird ausschließlich als Tab in die bestehende Portal-App integriert. Die in PLAN.md geplante eigenständige Group-App (`space.einundzwanzig.group`) **entfällt**. |
| **Chat-UX im Portal** | **Vollbild-Takeover.** Öffnet man den „Chat"-Tab, übernimmt der Chat den Screen mit **eigenem Layout + eigener Bottom-Nav** (Räume/Mitglieder/Einstellungen) + einem **„Zurück zum Portal"-Pfad**. Der Portal-Tab ist nur der Einstieg. |
| **Identität / Signer** | **Getrennter Nostr-Login.** Der Nostr-Signer ist unabhängig von der Portal-Identität (Portal-Auth bleibt unberührt). = der echte, noch **ungebaute** M8-Kern. |
| **Verteilung** | **Composer-/npm-Package + Subtree-Split.** Der Chat-Code lebt in `flotilla-einundzwanzig/packages/nostr-chat`; ein Split-Script pusht ihn read-only nach `einundzwanzig/nostr-chat`; die Portal-App zieht ihn via Composer-VCS (+ git-npm-Dep für die Insel). „Immer wieder einpflegen" = Split-Script + `composer/yarn update`. |

---

## 2. Pivot gegenüber PLAN.md — was gilt weiter, was ist überholt

**Überholt (durch die Entscheidungen oben ersetzt):**
- ❌ PLAN.md §11 „**nicht zwei Projekte**, ein Projekt entlang Shell/Guard-Naht getrennt" — hinfällig. Es *gibt* zwei getrennte Projekte (Web-Client + Portal), die ein **Package** teilen. Die Naht liegt an der Package-Grenze, nicht an einem Plattform-Flag im selben Repo.
- ❌ PLAN.md §11 „`layouts/web.blade.php` vs. `layouts/mobile.blade.php` im selben Repo, Wahl per Flag" — der Web-Client hat nur sein Web-Layout; die Portal-App bringt ihr eigenes Shell mit. Das Package liefert das **Chat-Vollbild-Layout** (`layouts::einundzwanzig`), das in beiden Hosts identisch ist.
- ❌ PLAN.md M8 App-ID `space.einundzwanzig.group`, `NATIVEPHP_START_URL=/nostr-smoke` — der Web-Client wird **nicht** mehr zu einer App kompiliert. Seine `config/nativephp.php` + `NATIVEPHP_*`-Env werden **vestigial** (höchstens Dev-Smoke). Ziel-App-ID ist die des Portals: `space.einundzwanzig.mobile`.

**Gilt weiter (bindende Anforderungen, aus PLAN.md extrahiert):**
- ✅ **Signing zu 100% client-seitig im WebView** (§7/§11). Die (lokale) Laravel-Instanz sieht **nie** den Key. Server nie im Signaturpfad.
- ✅ **Signer-Pfade nach Plattform** (§7) — siehe §5 unten. Das ist Workstream B.
- ✅ **Plattform-Flag = `config('nativephp-internal.running')`** (via `NATIVEPHP_RUNNING`), **NICHT** `function_exists('nativephp_call')` (existiert auch im Web). Die zwei Weichen in `EnsureNostrAuth` + `ContentSecurityPolicy` nutzen das bereits korrekt.
- ✅ **Mobile-Auth = lokales Präsenz-Gate**, kein NIP-98-Server-Handshake (§7): lokale single-user-Instanz, Handshake wäre Zeremonie. `EnsureNostrAuth` lässt Mobile durch.
- ✅ **NativePHP-Constraints** (§11): WebView statt Webserver, **`yarn build` Pflicht vor jedem Kompilieren**, nur SQLite/`database`-Queue, `.env` wird mitgeliefert (keine Secrets; Key nur in SecureStorage), native Ergebnisse kommen als **Events** (`#[OnNative]`), nicht als Rückgabewert.
- ✅ **PHP-Read-Caches (§10/M7) sind auf Mobile AUS** — der Client zieht direkt von Relays. `SpaceCache`/`nostr:warm-cache` sind Web-only-Beschleuniger.
- ✅ **welshman-Insel ist plattformblind** — läuft im WebView unverändert (per M0.5-Screenshot bewiesen). `window.__nostrSpace`-Override identisch Web/Mobile.
- ✅ **Design-System** (§12): Inconsolata als `--font-sans`, Bitcoin-Brand-Ramp (`#f7931a`), Token/Utilities (`rounded-tile`, `surface-card`, `pt-safe`/`pb-safe`, Motion-Lib). **Aber:** im Portal koexistiert es mit dessen eigenem Theme → muss gescopet werden (§4, Reibungspunkt 1).
- ✅ **SecureStorage-Plugin** (`nativephp/mobile-secure-storage`, Premium; Credentials aus `einundzwanzig-mobile-app/auth.json`) für den nsec-Fallback. Portal hat das Plugin bereits installiert.
- ✅ **EIN aktiver Space, keine Space-Rail** (§12) — bleibt. Default-Space via `window.__nostrSpace` aus `config('nostr.space_url')`.

---

## 3. Zielarchitektur

```
flotilla-einundzwanzig/                 ← Web-Client, Source of Truth, Konsument (Dogfooding)
├── packages/nostr-chat/                ← NEU: Laravel-Package (Composer path-repo)
│   ├── composer.json                   (einundzwanzig/nostr-chat, ServiceProvider, flux-pro-Repo!)
│   ├── src/                            App\Chat\… — SpaceCache, WarmNostrCache, EnsureNostrAuth,
│   │                                   NostrAuthController, ContentSecurityPolicy, ServiceProvider
│   ├── routes/chat.php                 chat.*-Routen (loadRoutesFrom im Provider)
│   ├── config/chat.php                 (mergeConfigFrom)
│   ├── resources/views/                chat::-Namespace — pages, Vollbild-Layout, Komponenten
│   └── resources/js/  ────────────────▶ eigenes npm-Package @einundzwanzig/nostr-chat-island
│                                        (bridge/core/session/groups/members/feeds/…)
├── scripts/split-package.sh            git subtree split → read-only Repo einundzwanzig/nostr-chat
└── (Rest: Web-Client requiret packages/nostr-chat via path-repo)

einundzwanzig-mobile-app/               ← Portal-App, Host
├── composer.json      + require einundzwanzig/nostr-chat  (VCS → github einundzwanzig/nostr-chat)
├── package.json       + @einundzwanzig/nostr-chat-island (git-Dep) + @welshman/* + svelte + qrcode
├── vite.config.js     + Island-Entry + manualChunks(welshman)
├── resources/css/app.css   + @import chat-Theme (gescopet)
├── routes/web.php     + require chat-Routen ODER Provider erledigt es
└── resources/views/layouts/mobile.blade.php  + 1 Zeile:
        <x-bottom-nav-item route="chat.spaces" icon="chat-bubble-left-right" :label="__('Chat')"/>
```

**Verteil-Mechanik (Subtree-Split):** Composer kann kein Repo-Unterverzeichnis requiren. Deshalb:
1. `packages/nostr-chat` lebt im Web-Client-Repo (dort editiert, dort getestet).
2. Der Web-Client requiret es lokal via **Composer path-repository** (Dogfooding → jede Änderung sofort im Web verifiziert).
3. `./scripts/split-package.sh` = `git subtree split --prefix=packages/nostr-chat` → force-push in ein schlankes read-only Repo `einundzwanzig/nostr-chat`.
4. Portal requiret via **Composer VCS** (`"repositories": [{"type":"vcs","url":"…/einundzwanzig/nostr-chat"}]`) + versionstag/branch.
5. JS-Insel analog: eigenes `package.json` im Split, Portal zieht als git-npm-Dep (oder GitHub Packages).
6. Upgrade-Zyklus: im Web-Client entwickeln → `split-package.sh` → im Portal `composer update einundzwanzig/nostr-chat && yarn up @einundzwanzig/nostr-chat-island && yarn build`.

---

## 4. Reibungspunkte / zu lösende Schwierigkeiten

1. **Zwei Design-Systeme in einer App.** Portal: „Instrument Sans" + eigenes Theme. Chat: Inconsolata + Brand-Ramp + eigene Utilities. Tailwind v4 ist global → Chat-`--font-sans`/Utilities dürfen das Portal nicht überschreiben. **Lösung:** Chat-CSS als eigener `@layer`/gescopeter `@import`, wirksam nur im Chat-Teilbaum (geht dank Vollbild-Takeover). CSS ist der eine Teil, den ein Package **nicht** voll kapseln kann — Host muss `@import` setzen. Tailwind-**Content-Globs** des Portals müssen die Chat-Views/-Package-Pfade einschließen, sonst purged Tailwind die Chat-Klassen.
2. **`partials/head.blade.php`-Kollision.** Der Web-Client injiziert `window.__nostrSpace` **vor** `@vite` in *seine* head-Partial; das Portal hat eine eigene. Das Package darf sie nicht überschreiben. **Lösung:** Der Vollbild-Chat bringt sein eigenes `<head>` über sein eigenes Layout mit (Island-`@vite` + `__nostrSpace`-Injektion aus `config('chat.space_url')`), statt in die Portal-head zu patchen.
3. **welshman-Lifecycle beim Tab-Wechsel.** Portal navigiert per `wire:navigate`. Vollbild-Takeover mit *eigenem* Layout = harte Grenze → welshman re-initialisiert je Chat-Öffnen (WebSocket-Reconnect, NIP-42-AUTH-Neu-Handshake). „Warm bleiben" widerspräche dem eigenen Layout. **Für Mobile akzeptabel** (man ist entweder im Chat oder nicht) — dokumentieren, ggf. später optimieren.
4. **`/`-Route & `nostr-smoke` gehören NICHT ins Package.** Web-only. Package shippt nur den Chat-Kern: `spaces`/`directory`/`room`/`join`/`settings.space` + `nostr-login` (+ die 3 `/nostr/*`-Handoff-Routen, auf Mobile faktisch tot → per Config abschaltbar).
5. **Flux-Pro-Repo im Package.** `einundzwanzig/nostr-chat/composer.json` muss das `composer.fluxui.dev`-Repository deklarieren, sonst installiert es standalone nicht (auch wenn das Portal Flux schon hat).
6. **Deep-Link-Scheme teilen.** Portal nutzt Scheme `einundzwanzig` / Host `portal.einundzwanzig.space` für Portal-Auth-Callbacks. NIP-46/`nostrconnect`- **und** NIP-55/Amber-Rückkanal wollen auch Deep-Links → über getrennte `deeplink_path_prefixes` koexistieren, sonst landet ein Signer-Callback im Portal-Auth-Handler.
7. **Sync-Richtung/Drift.** Nur eine Richtung (Web-Client → Portal). Der Split ist read-only; Edits im Portal-`vendor` werden beim nächsten `composer update` überschrieben. Regel: **Chat-Code niemals im Portal editieren, immer upstream im Web-Client.**
8. **Tests reisen nicht mit.** Die E2E booten einen hermetischen In-Process-zooid via `window.__nostrRelays`; Pest-Browser nutzt Host-Chromium. → Chat **upstream** testen, ins Portal nur das gebaute Artefakt shippen.
9. **CSP-Middleware ist generisch benannt.** `App\Http\Middleware\ContentSecurityPolicy` → im Package auf `App\Chat\Http\Middleware\…` umbenennen und **nur auf Chat-Routen** anwenden (nicht global an die Portal-web-Group appenden).

---

## 5. Zwei Workstreams (unabhängig)

### Workstream A — Package-Extraktion & Verteilung (Portier-Mechanik)
Verpackt die **fertige** Web-Client-UI. Liefert einen im Emulator startenden Chat-Tab, sobald ein Signer-Pfad existiert. Rein mechanisch/architektonisch, keine neue Nostr-Logik.

### Workstream B — Mobile-Signer (der harte, ungebaute Teil)
Unabhängig vom Package. Ohne mind. einen funktionierenden Pfad ist der Chat auf dem Gerät nicht nutzbar. Reihenfolge nach Risiko (PLAN.md §7):
1. **NIP-46** (Bunker / `nostrconnect://`) — funktioniert im WebView; `nip46.ts`/`session.ts` sind schon da. Nur der `nostrconnect`-Callback braucht statt Browser-Redirect den **NativePHP-Deep-Link** zurück in die App. **Kleinste Unbekannte → zuerst.**
2. **NIP-55 (Amber, Android)** — Signatur-Request per Intent an den installierten Signer, Antwort via Deep-Link/Event. **Neu zu bauen** (nicht in Flotilla), via NativePHP-Bridge/Intent. iOS hat kein NIP-55 → dort NIP-46.
3. **nsec-Fallback** — Key **nur** verschlüsselt im SecureStorage-Plugin, optional per Biometrics entsperrt. Nie in IndexedDB/`.env`.

---

## 6. Fahrplan (grob)

| Phase | Inhalt | Workstream | Aufwand |
|---|---|---|---|
| **P0** | Package-Skelett + `App\Chat\`-Namespace-Umzug + `chat::`-Views im Web-Client; ServiceProvider (Routen/Views/Config/Alias/Schedule/Assets); Web-Client dogfoodet via path-repo; **Suite grün halten**. | A | ~1 Tag |
| **P1** | `split-package.sh` (subtree split → `einundzwanzig/nostr-chat`); Portal requiret Package; Chat-Tab (1 Nav-Zeile) + Vollbild-Layout + „Zurück"-Pfad; Build im Emulator. | A | ~1 Tag |
| **P2** | CSS/Theme-Scoping (Reibung 1), `__nostrSpace`/Head-Integration (Reibung 2), welshman-Lifecycle im WebView verifizieren (Reibung 3), Tailwind-Content-Globs. | A | ~1 Tag |
| **P3** | **Mobile-Signer**: NIP-46 (+ Deep-Link-Callback) → Amber/NIP-55 → nsec/SecureStorage+Biometrics. Deep-Link-Prefixes (Reibung 6). | B | mehrere Tage, größte Unbekannte |
| **P4** | Release: `NATIVEPHP_*`-Env-Abgleich, signiertes AAB (`native:package android --build-type=bundle`), Store-Vorbereitung. | A | ~1 Tag |

**Empfohlener Start:** P0 (Package-Extraktion), sobald dieses Dokument steht.

---

## 7. Offene Fragen / vor dem Bauen zu klären

- **Prod-Space-URL:** `DEFAULT_SPACE_URL`/`config('nostr.space_url')` ist aktuell `ws://localhost:3334/`. Für den mobilen Chat muss die echte Vereins-Relay-URL (`wss://group.einundzwanzig.space/`?) gesetzt und ins Portal-`.env`/NativePHP-Bundle übernommen werden.
- **npm-Insel-Distribution:** git-Dep vs. GitHub Packages vs. npm-Publish — beim ersten Portal-Pull entscheiden (git-Dep = am wenigsten Setup).
- **Versionierung:** Package-Tags (semver) vs. Branch-Tracking beim Portal-`require`. Empfehlung: Branch (`main`) beim Split für schnelle Iteration, Tags erst ab Store-Release.
- **iOS:** Amber (NIP-55) ist Android-only. iOS-Signer = NIP-46. iOS-Build nur auf macOS (`native:jump` aufs Gerät). Ist iOS überhaupt Zielplattform, oder Android-first?
- **welshman-`svelte`-Peer im Portal:** Portal hat noch kein `svelte`. Sicherstellen, dass nur `svelte/store` gebündelt wird (kein Compiler), wie im Web-Client.

---

## 8. Portier-Inventar (Stand 2026-07-07)

Was ins Package `packages/nostr-chat` wandert bzw. im Portal integriert wird. `App\Chat\`-Namespace + `chat::`-View-Namespace + `chat/`-JS-Verzeichnis eliminieren die meisten Kollisionen.

### (a) Reine Feature-Dateien → ins Package (1:1, nur Namespace anpassen)
- **JS-Insel:** `resources/js/nostr/{app.ts,core.ts,bridge.ts,session.ts,groups.ts,members.ts,feeds.ts,repository.ts,signer-health.ts,toast.ts,qrcode.d.ts}` → npm-Package. `bridge.ts` (1023 Z.) registriert 8 Alpine-Komponenten (`nostrSpaces`, `nostrDirectory`, `nostrRoomChat`, `nostrSpaceSettings`, `nostrInvite`, `nostrAuth`, `nostrSignerBanner`, `nostrSmoke`).
- **PHP:** `app/Nostr/SpaceCache.php`, `app/Console/Commands/WarmNostrCache.php`, `app/Http/Middleware/EnsureNostrAuth.php`, `app/Http/Controllers/NostrAuthController.php` (NIP-98), `app/Http/Middleware/ContentSecurityPolicy.php` (⚠ umbenennen + route-scopen).
- **Views:** `pages/⚡{spaces,directory,room,join,nostr-login}.blade.php`, `pages/settings/⚡space.blade.php`, `layouts/einundzwanzig.blade.php`, `components/{app-brand-mark,app-header,bottom-nav}.blade.php` (⚠ `app-header`/`bottom-nav` in `chat::`/`x-chat.*` umbenennen — Kollisionsrisiko mit Portal-Komponenten).
- **Config:** `config/nostr.php` → `config/chat.php`.
- **Asset:** `public/img/einundzwanzig-square.svg` (von `app-brand-mark` referenziert).
- **NICHT ins Package:** `pages/⚡home.blade.php` (Web-Landing), `pages/⚡nostr-smoke.blade.php` (M0-Smoke) — bleiben Web-Client-only.

### (b) Merge/Integration im Portal (ServiceProvider erledigt das meiste)
- `composer.json`: `require einundzwanzig/nostr-chat` (bringt `swentel/nostr-php` als Package-Dep mit).
- `package.json`: `@einundzwanzig/nostr-chat-island` + `@welshman/{app,content,feeds,lib,net,router,signer,store,util}@^0.8.16` + `svelte@^5` + `qrcode` + `@fontsource/inconsolata`. (`nostr-tools` ist im Portal schon — Version gegen welshman prüfen.)
- `vite.config.js`: Island-Entry in `input[]` + `manualChunks`-Block (welshman/nostr-tools → cache-stabiler ~700-KB-Chunk).
- `resources/css/app.css`: `@import` des Chat-Themes (gescopet, Reibung 1).
- `resources/views/layouts/mobile.blade.php`: **1 Zeile** `<x-bottom-nav-item route="chat.spaces" …>`.
- `routes/web.php` / ServiceProvider: Chat-Routen laden. Tailwind-Content-Globs um Package-Views erweitern.

### (c) Config / Env im Portal
- `config/chat.php` (published) + `NOSTR_SPACE_URL`/`chat.space_url` = Prod-Relay.
- `NATIVEPHP_*`: bereits im Portal vorhanden — Werte abgleichen, nichts doppelt anlegen. Deep-Link-Prefixes für Signer-Callback ergänzen (Reibung 6).
- Die zwei `nativephp-internal.running`-Weichen (`EnsureNostrAuth`, CSP) sind im Portal **sofort wirksam** — nur korrekt übernehmen.
