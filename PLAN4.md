# PLAN4.md — Package-Öffnung (Composer/GitHub) & Branding/Metadaten aus Nostr

> Zielgruppe: die nächste Claude-Instanz, die (1) das Chat-Package `einundzwanzig/group` für externe Mitentwickler über Composer beziehbar macht und (2) das Branding/die Metadaten der App konsequent aus Nostr speist (Space-/Raum-Namen & -Bilder, Profile, NIP-05, Favicon/OG).
> **Vorgänger:** `PLAN.md` (M0–M7, Web-Kern) · `PLAN2.md` (M8/Mobile-Package) · `PLAN3.md` (D0–D5, Design/UX-AAA). Dieses Dokument ist die vierte Ausbaustufe.

### Rahmen (Auftraggeber, 2026-07-08)

- **Stufe 1 zuerst und blockierend:** Das Package `einundzwanzig/group` (heute `packages/einundzwanzig-group/`, nur lokal per `path`-Repo) wird über GitHub via Composer beziehbar, **damit andere Developer ab jetzt mitmachen können.** Für lokales Dev bleibt der Symlink-Weg erhalten — eine **Weiche** wählt automatisch: lokaler Ordner da → Symlink (schnelles Dev), Ordner fehlt → von GitHub.
- **Danach Branding/Metadaten aus Nostr.** Nostr bleibt Source of Truth: Space-/Raum-Namen & -Bilder, Autor-Profile (Name/Avatar/Meta), NIP-05-Verifizierung, dynamische Head-/OG-/Favicon-Daten.
- **Scope = nur Anzeige/Lesen.** Wie PLAN3 §Rahmen: **keine neuen publish-Kinds**, keine Zaps/Reactions/Media. Branding liest vorhandene Daten (kind 0, kind 39000, NIP-11-Relay-Info, NIP-05-Handles). NIP-05 ist **Lese-Verifizierung**, kein Schreiben.
- **Web UND Native-Mobile aus denselben Views** (PLAN3-Grundprinzip) bleibt bindend: eine Blade-Datei, Seam statt Fork.
- **Design-System gesetzt** (PLAN §12, `theme.css`): Farben/Fonts nicht neu erfinden, nur konsistent anwenden. Neue Badges (NIP-05-Häkchen, Raum-Zugriff) nutzen die Brand-Ramp.

### Fortschritt (Stand 2026-07-08)

| Phase | Fokus | Status | Kern-Inhalt |
|---|---|---|---|
| **P1** — Package-Öffnung: Composer/GitHub + Symlink-Weiche | **blockierend, zuerst** | ✅ **fertig** | Package in **eigenes Repo** `HolgerHatGarKeineNode/einundzwanzig-group-package` (Branch `master`, History via subtree split erhalten) ausgelagert. Root-`composer.json`: `path`-zuerst-`vcs`-danach, Require `einundzwanzig/group: dev-master`. Ordner `packages/einundzwanzig-group` gitignored, lokal als eigenständiger Clone (Symlink-Dev). Beide Weichenstellungen verifiziert (path=Symlink lokal, vcs=`dev-master` bei Fremd-Clone trotz `minimum-stability: stable`). `CONTRIBUTING.md` erklärt das Setup. 16 Package-Tests grün, `npm run build` grün. |
| **B1** — Space-Identität & -Branding | | ✅ **fertig** | Space-Name + Beschreibung aus **NIP-11**-Relay-Info (`name`/`description`) statt nackter URL — im Header (dynamischer Titel via `titleExpr`, Fallback „Space") und in der Space-Auswahl (Einstellungen). Doppelten Namen aus der Space-Karte entfernt (Identität lebt nur im Header). Pure `spaceBranding()`-Logik (welshman-frei) + `ensureRelayProfile()`-Helper (lädt NIP-11 lazy, cached). `SpaceView.icon` durchgereicht (Render später B5-OG). Tests: 2 Logik + 2 E2E grün. |
| **B2** — Raum-Metadaten vollständig (kind 39000) | | ✅ **fertig** | `picture` + `locked` (NIP-29 private/restricted/closed zu einem Flag) durchgereicht: Client (`RoomView`/`buildSpaceView`) **und** Server-Cache (`SpaceCache::parseRooms`, neuer `hasTag`-Helper). Raumliste (`room-tile`): natives `<img>` (flux:avatar verzweigt server-seitig auf `$src` → im Alpine-Fall ungeeignet), `onerror`→`#`-Chip; Schloss-Badge bei `locked`. Raum-Header: `roomPicture` aus Cache → `flux:avatar` (PHP-`src`); `app-header` bekam optionalen `leading`-Slot. `pictureMeta`/blurhash bewusst ausgelassen (Kür). Tests: Pest `parseRooms`+Render (picture/locked) grün, E2E `spaces` (Avatar-`src`+Schloss am geseedeten `vip`-Raum) + `room` grün. |
| **IMG** — Bilder-Proxy (WebP/Crop) | nach B2 | ✅ **fertig** | Öffentliche Route `GET /img/{preset}?src=` (Host, `ImageProxyController`): lädt remote Bild, `cover`-Zuschnitt + WebP q80 (Intervention **v4** — v3 nicht mehr aktuell, gleiche Fluent-API), Datei-Cache (`storage/app/private/img-cache`, ETag/`immutable`), wöchentlicher Prune >30 Tage. **SSRF-Schutz**: nur `https`, alle aufgelösten IPs müssen öffentlich sein (`FILTER_FLAG_NO_PRIV_RANGE\|NO_RES_RANGE`), Content-Type `image/*`, Größen-/Zeit-Limit, Redirect-Zielhost re-validiert; Rest-Risiko DNS-Rebinding dokumentiert. Client: `proxifyImage()` (`core.ts`, Web=relativ/Mobile=absolut `group.einundzwanzig.space`) als Alpine-Magic `$img`; Server-Pendant `Einundzwanzig\Group\ImageProxy::url()` fürs Raum-Header-Avatar. Alle Avatare (Directory/Raum-Nachrichten/Raum-Kachel/-Header) laufen darüber; `onerror` zweistufig (Proxy→Original→Chip). Presets: nur `avatar` (96², Retina). Tests: 9 Pest (SSRF-Ablehnung, WebP-Content-Type, Cache-Hit, ETag-304, URL-Builder) + `spaces`-E2E (proxifizierter `src`) grün. |
| **B3** — Autor-Profile: Lücken schließen | Kür | ✅ **fertig** | **Profil-Karte als Identitätskarte** (Flux-Modal `profile-card`): Banner-Header (`$img`-Proxy, Fallback Brand-Verlauf) + überlappender Ring-Avatar (Brand-Glow), `display_name`/`name`, kopierbarer npub-Mono-Chip, `about`, `website` (sanitized, eigene truncatende Zeile) und `lud16` als kopierbarer ⚡-Chip (reine Anzeige, KEINE Zaps). Eigene Alpine-Insel `nostrProfileCard` (lazy `deriveProfile`, `copy`→Toast), geöffnet per `open-profile`-Window-Event (`$dispatch(…, m.pubkey)`) aus Chat **und** Directory (Avatar+Name klickbar). Manueller Display-Join ersetzt: `feeds.ts` nutzt `displayProfileByPubkey` (welshman-Bordmittel) statt `displayProfile`+`shortNpub`. Tests: E2E `room` (Klick→Karte zeigt about/website/lud16) grün, ganze room+directory-Suite 14/14 grün. Nebenbei abgesichert: Vite `optimizeDeps.exclude` fürs Local-Dev-Package (HMR ohne Neustart) + zooid-Seed-Script setzt SQLite pro Lauf frisch (kein DB-Bloat → Tests 37s statt 3,4 min). NIP-05-Häkchen folgt in B4. |
| **B4** — NIP-05-Verifizierung | | ✅ **fertig** | `@welshman/app/handles` aktiviert: dünne Hülle `handles.ts` (`warmHandles` lazy/dedupliziert, `verifiedNip05` mit der Match-Regel). Häkchen (`x-group::nostr-nip05`, Brand-`check-badge`) nur bei **bestätigtem** Match (nostr.json ↔ pubkey) — an Autor-Kopf im Chat, Directory (mit Handle-Zeile) und Profil-Karte (`deriveHandleForPubkey`). `nip05` durchgereicht in `ChatMessage`/`MemberView` (welshman verifiziert privacy-schonend via dufflepud). Tests: 5 Logik (Match/Mismatch/kein-nip05/nicht-geladen/`_@domain`) + E2E `room` (gestubbter dufflepud → Häkchen in Karte) grün. |
| **B5** — Favicon / OG / Head dynamisch | | ⬜ offen | Titel pro Space/Directory dynamisch; per-Space/Raum-OG (Raum-`picture` bzw. generiert); Portal-Head-Partial optional um Favicons/OG ergänzen. |
| **B6** — Weitere Nostr-Metadaten (Backlog) | Kür/Ideen | ⬜ offen | Fundstücke aus welshman, die brachliegen (banner, website, lud16, livekit, pictureMeta/blurhash, NIP-11 banner). Bewusst optional. |

> **Test-Grundsatz (wie PLAN3):** Jede Phase wird programmatisch getestet, bevor sie ✅ gilt. UI-Rendering/Verhalten → **Playwright-E2E** (Host-Chromium, In-Process-zooid). Blade-/Route-/Parser-/Cache-Änderungen → **Pest**. Vor jedem Commit: `vendor/bin/pint --dirty` + `npm run build` + `code-simplifier`, dann sofort `git push`.

---

## P1 — Package-Öffnung: Composer/GitHub + Symlink-Weiche  *(zuerst, blockierend)* — ✅ umgesetzt

> **Ist-Umsetzung (Abweichung vom ursprünglichen Plan):** Der geplante „Package-Branch im selben Monorepo" ist mit Composer **nicht** möglich — ein `vcs`-Repo liefert genau **ein** Paket, benannt nach dem **Default-Branch**. Da dessen `master` die App (`laravel/livewire-starter-kit`) ist, wird ein Branch mit abweichendem Paketnamen still verworfen (verifiziert per `composer -vvv`: „Reading composer.json of laravel/livewire-starter-kit (master)"). Deshalb: **eigenes Repo** `HolgerHatGarKeineNode/einundzwanzig-group-package`, Default-Branch `master`, Composer-Require `dev-master`. Lokaler `packages/einundzwanzig-group`-Ordner = eigenständiger **Clone** (nicht Worktree). Alles andere (path-zuerst-vcs-Weiche, gitignore, Symlink-Dev) wie geplant. Paketname bleibt `einundzwanzig/group`; PHP-Namespace `Einundzwanzig\Group\` unverändert.

**Ausgangslage (verifiziert):**
- Package `einundzwanzig/group` (Namespace `Einundzwanzig\Group\`, Provider `Einundzwanzig\Group\GroupServiceProvider`) liegt in `packages/einundzwanzig-group/`, **committed im Monorepo**, eingebunden per `path`-Repo mit `symlink: true` (`composer.json:121-128`), Root-Require `einundzwanzig/group: *` (`composer.json:13`).
- **Kein** separates Package-Repo. `origin` des Haupt-Repos ist `git@github.com:HolgerHatGarKeineNode/einundzwanzig-group.git` — das ist die **ganze App** (`composer.json` name `laravel/livewire-starter-kit`, type `project`), **nicht** das Package.
- `.gitignore` ignoriert bisher nur `/vendor`.

**Entscheidung Auftraggeber:** Kein zweites Repo — das Package lebt in einem **eigenen Branch `package`** desselben GitHub-Repos. Composer liest die `composer.json` **pro Branch** aus dessen Wurzel; der `package`-Branch trägt das Package im Root (`name: einundzwanzig/group`) → Composer bietet es als Version `dev-package` an, der `master`-Branch (die App) wird dabei ignoriert. History via `git subtree split` erhalten.

> ⚠️ **ÜBERHOLT — der folgende Ursprungsplan (Package-Branch im selben Repo) wurde verworfen.** Maßgeblich ist die „Ist-Umsetzung" oben (eigenes Repo `…-package`, `dev-master`, Clone) und `CONTRIBUTING.md`. Der Block bleibt nur als Entscheidungs-Historie stehen.

### Zielbild der Weiche (historisch)

```
composer.json (master / App):
  "require": { "einundzwanzig/group": "dev-package" , ... }
  "repositories": [
    { "type": "path", "url": "packages/einundzwanzig-group",           // 1) gewinnt WENN Ordner existiert
      "options": { "symlink": true } },
    { "type": "vcs",  "url": "git@github.com:HolgerHatGarKeineNode/einundzwanzig-group.git" }, // 2) Fallback: Branch package → dev-package
    { "name": "flux", "type": "composer", "url": "https://composer.fluxui.dev" }
  ]

.gitignore:  /packages/einundzwanzig-group

Lokal (Maintainer):  git worktree add packages/einundzwanzig-group package   → Symlink-Dev, Commits direkt auf package-Branch
Fremd-Dev / CI:      composer install  (kein Ordner)                → Package kommt als dev-package von GitHub
```

**Warum das ohne Tag-Zwang trägt:** Ist `packages/einundzwanzig-group` ein **git-Checkout des `package`-Branches** (Worktree/Clone), leitet Composer aus dem `path`-Repo automatisch die Version `dev-package` ab — dieselbe, die der `vcs`-Fallback liefert. Damit matcht das Require `dev-package` in **beiden** Weichenstellungen, ohne dass beim Package-Entwickeln getaggt oder ein `version`-Feld gepflegt werden muss. Änderungen sind lokal per Symlink sofort live; `git push origin package` macht sie auch für Fremd-Clones sichtbar.

### Schritte

| # | Schritt | Befehl / Datei | Notiz |
|---|---|---|---|
| 1 | `package`-Branch mit History erzeugen | `git subtree split --prefix=packages/einundzwanzig-group -b package` | Package-Dateien landen im **Root** des Branches, nur Commits, die `packages/einundzwanzig-group` betreffen. |
| 2 | `version`-Feld aus Package entfernen | `packages/einundzwanzig-group/composer.json:5` (`"version": "0.1.0"` löschen) | Sonst überschreibt es die aus dem Branch abgeleitete `dev-package`-Version und bricht die Weiche. Muss **auf dem `package`-Branch** passieren. |
| 3 | Branch pushen | `git push origin package` | Ab jetzt ist `dev-package` über Composer beziehbar. |
| 4 | Root-Require umstellen | `composer.json:13` → `"einundzwanzig/group": "dev-package"` | Root darf dev-Versionen direkt requiren (trotz `minimum-stability: stable`). **Verifizieren** (siehe Risiken). |
| 5 | `vcs`-Repo ergänzen | `composer.json:121-128` (nach `path`, vor/neben `flux`) | URL = `git@github.com:HolgerHatGarKeineNode/einundzwanzig-group.git`. `path` MUSS zuerst stehen (Repository-Priorität = Reihenfolge). |
| 6 | Package aus master-Tree lösen | `git rm -r --cached packages/einundzwanzig-group` + `.gitignore` → `/packages/einundzwanzig-group` | Dateien bleiben lokal (nur untracked); master trägt das Package nicht mehr. |
| 7 | Lokalen Symlink-Checkout einrichten | Ordner leeren, dann `git worktree add packages/einundzwanzig-group package` | Worktree auf `package`-Branch; gitignored im master, aber eigenes HEAD. Alternative: `git clone --single-branch -b package <url> packages/einundzwanzig-group`. |
| 8 | Auflösen & prüfen | `composer update einundzwanzig/group -W` | Erwartung: Symlink in `vendor/einundzwanzig/group` → `packages/einundzwanzig-group`. Danach in `/tmp` gegenprobieren: frischer Clone **ohne** Ordner zieht `dev-package` von GitHub. |
| 9 | Kurzanleitung | `CONTRIBUTING.md` (Root, neu — nur hier explizit erlaubt) | „Package lokal entwickeln" (Worktree-Setup) vs. „nur App bauen" (nichts tun, Composer zieht GitHub). |

### Tests / Verifikation
- **Pest:** `einundzwanzig/group`-Provider lädt (`GroupServiceProvider`), Chat-Routen/Views auflösbar — beweist, dass das Package nach der Umstellung (egal ob Symlink oder vendor) korrekt registriert ist.
- **Manuell (dokumentieren, nicht als Test committen):** frischer `git clone` des Haupt-Repos in `/tmp` **ohne** `package`-Worktree → `composer install` → App bootet mit Package aus `vendor/` (dev-package). Das ist der eigentliche Weichen-Beweis.

### Risiken / zu verifizieren
- **`dev-package` + `prefer-stable`:** Root-Require mit expliziter dev-Constraint ist erlaubt; falls Composer dennoch meckert, Inline-Alias `"dev-package as 0.1.x-dev"` verwenden. **Vor Schritt 4 testen.**
- **Composer-VCS-Cache:** dasselbe Repo als App **und** als Package-Quelle — Composer scannt alle Branches. Bei „package not found" `composer clear-cache` und `composer.lock` neu auflösen.
- **Worktree im gitignorten Pfad:** funktioniert (eigenes HEAD), ist aber ungewohnt — in `CONTRIBUTING.md` erklären, dass Package-Git-Ops in `packages/einundzwanzig-group` laufen, App-Ops im Root.
- **`native:*`-Builds:** NativePHP bündelt `vendor/` — nach Umstellung einen `yarn build --mode=android` + `native:run`-Rauchtest, dass das Package im Bundle landet (Symlink vs. echter Ordner).

---

## B1 — Space-Identität & -Branding — ✅ umgesetzt

> **Ist-Umsetzung:** Space-`name`/`description` aus NIP-11 (`ensureRelayProfile` lädt lazy via welshman `loadRelay`, cached). Anzeige NUR im Header (`app-header` bekam optionalen `titleExpr`-Prop → `x-text` auf der Überschrift; Fallback „Space" vor Hydrate) — der zunächst doppelte Name in der Space-Karte wurde auf Wunsch entfernt (Single-Space-Fokus: eine Identität pro Ansicht). Beschreibung als Header-Untertitel über der npub-Zeile. Space-Auswahl (`nostrSpaceSettings`) zeigt denselben NIP-11-Namen. Reine `spaceBranding()`-Logik in `relayCaps.ts` (testbar). `SpaceView.icon` wird geparst/durchgereicht, aber noch nicht gerendert (Ziel: B5-OG-Fallback).

Heute hat ein Space **keinen echten Namen**: angezeigt wird die nackte Relay-URL, der Seiten-Header ist hart „Space".

| Gap | Ist-Zustand | Fix | Sev | Aufw |
|---|---|---|---|---|
| **Space-Name = Relay-URL** | `groups.ts:203` `displayRelayUrl(url)` (URL ohne `wss://`), gerendert `⚡spaces.blade.php:50`. Kein Space-Metadaten-Event (es gibt **kein** kind-39001; nur `ROOM_META 39000`/`ROOM_MEMBERS 39002`). | **NIP-11** Relay-Information nutzen: `name` als Space-Name, `icon` als Space-Avatar, `description` als Untertitel. Fallback `displayRelayUrl`. welshman lädt NIP-11 bereits für `supported_nips` (`groups.ts:307-314` `relaysByUrl`) → nur `name`/`icon`/`description` mitnehmen. | mittel | M |
| **Header hart „Space"** | `⚡spaces.blade.php:13` `#[Title('Space')]`, `:18` `title="Space"`. | Titel/Header dynamisch aus B1-Space-Name (Fallback „Space"). | niedrig | S |

---

## B2 — Raum-Metadaten vollständig (kind 39000) — ✅ umgesetzt

> **Ist-Umsetzung:** `picture` + Zugriffs-Flag `locked` (NIP-29 `private`/`restricted`/`closed` zu **einem** Flag zusammengefasst; `hidden` betrifft Listung, `livekit` schon gefiltert) durchgereicht — Client (`RoomView` erweitert, `buildSpaceView.toView` befüllt aus dem `Room`-Objekt) **und** Server-Cache (`SpaceCache::parseRooms` + neuer `hasTag`-Presence-Helper). Raumliste (`room-tile`): natives `<img>` mit `onerror`→`#`-Chip statt `flux:avatar` (das verzweigt **server-seitig** auf `$src`, taugt für reines Alpine-Bind nicht); Schloss-Badge bei `locked`. Raum-Header: `roomPicture` aus dem Read-Cache → `flux:avatar` (echtes PHP-`src`), `app-header` bekam optionalen `leading`-Slot. `pictureMeta`/blurhash bewusst ausgelassen (Kür).

`readMeta` liefert bereits mehr, als gelesen wird: **`picture`, `pictureMeta`, `isClosed/isHidden/isPrivate/isRestricted`** aus `RoomMeta` bleiben ungenutzt — Client **und** Server-Cache lesen nur `name`+`about`.

| Gap | Ist-Zustand | Fix | Sev | Aufw |
|---|---|---|---|---|
| **Raum-`picture` ignoriert** | Client `groups.ts:127` `readRoomMeta` liefert `picture`, verworfen. Server `SpaceCache::parseRooms:70-76` liest nur `name`/`about`. | `picture` durchreichen: Client (`groups.ts`/`feeds.ts`) + Server (`SpaceCache::parseRooms`, `SpaceCache::rooms`). Raum-Avatar im Header (`⚡room.blade.php:44`) und in der Raumliste (`⚡spaces.blade.php`). `<flux:avatar>` mit `picture`-Fallback auf Initialen (wie Autor-Avatare). | mittel | M |
| **Kein Zugriffs-Hinweis** | `isClosed/isPrivate/isRestricted` nie ausgewertet. | Kleine Brand-Badges an Räumen (🔒 privat / eingeschränkt). Rein deklarativ. | niedrig | S |
| **`pictureMeta` (blurhash)** | vorhanden, ungenutzt. | Optionaler Ladeplatzhalter — **Kür**, nur wenn billig. | niedrig | S |

---

## IMG — Bilder-Proxy (WebP/Crop)  *(nach B2)* — ✅ umgesetzt

> **Ist-Umsetzung:** Öffentliche Host-Route `GET /img/{preset}?src=` (`ImageProxyController`, invokable). Named Presets im Pfad (nur `avatar` = 96² `cover`, Retina — begrenzt die Cache-Kardinalität; neues Preset = eine Zeile). Fetch via `Http`-Facade (fake-bar in Tests); **SSRF**: `https`-only, alle via `dns_get_record` aufgelösten IPs müssen öffentlich sein, Content-Type `image/*`, `MAX_BYTES`/Timeout, Redirects nur `https` mit re-validiertem Zielhost. Encode: Intervention **v4** (`ImageManager`+`Gd\Driver`→`cover()`→`WebpEncoder(80)`). Datei-Cache `storage/app/private/img-cache/{preset}/{sha1(src)}.webp`, `Cache-Control: immutable` + ETag/304; wöchentlicher Prune >30 Tage (`routes/console.php`). Client `proxifyImage()` in `core.ts` (Web relativ, Mobile absolut) als Alpine-Magic `$img`; PHP-Pendant `ImageProxy::url()` (mobile-aware via `nativephp-internal.running`) fürs server-gerenderte Header-Avatar. `onerror` an der Raum-Kachel zweistufig (Proxy→Original→#-Chip); Flux-Avatare fallen bei Proxy-Fehler auf Initialen. **Bewusst weggelassen** (YAGNI): LRU/Max-Größe-Eviction (mtime-Prune reicht für Single-Space); IP-Pinning gegen DNS-Rebinding (Rest-Risiko im Code kommentiert); zusätzliche Presets (kommen mit B5-OG/`banner`).

> **Nachtrag — Inline-Bilder im Chat + Lightbox (2026-07-08):** welshman/content parst Bild-URLs als `Link` und rendert sie per Default als **Text-Anker** (`renderLink` → `<a>`) — Bilder wurden also nicht als Bild gezeigt. Fix: `renderLink`-Override in `feeds.ts` (`renderMessageLink`) — URL mit Bild-Extension (`jpe?g|png|gif|webp`) → `<img class="chat-image">` über den Proxy (Preset **`msg`** = `scaleDown` 600², `data-full` = **`full`** 1600²), alles andere bleibt ein `sanitizeUrl`-Anker (Escaping via `document.createElement`). Klick auf ein Inline-Bild (delegiert, da `x-html`-Inhalt) öffnet eine **Lightbox** (`lightboxSrc` im `nostrRoomChat`-State; Overlay in `⚡room.blade.php`, Klick/Esc schließt, `onerror`→Original). Zwei neue `scale`-Presets im Controller (`cover` vs. `scale`-Modus). `.chat-image`-Styles in `theme.css` (max 20rem, `cursor: zoom-in`). Tests: Pest `msg`/`full`→WebP + E2E `room` (Inline-`img` über `/img/msg`, Klick→Lightbox `/img/full`, Esc schließt) grün.
>
> **Proxy-ready Backlog** (nutzen denselben Proxy, sobald ihr Render-Surface existiert — heute bewusst nicht gebaut): NIP-11-Space-`icon` (→ B5-OG/Favicon), Profil-`banner`/`picture`-Detail (→ B3-Profil-Karte), Custom-Emoji NIP-30 als Inline-`<img>` statt Shortcode (→ B6). Jeweils `proxifyImage()`/`$img` bzw. neues Preset.
>
> **GIF-Ausnahme (2026-07-08):** GD/WebP würde ein animiertes GIF auf den ersten Frame plätten. Darum: Nach Magic-Byte `GIF8` **bleibt das Bild GIF** (Animation erhalten), Content-Type `image/gif`, Cache-Extension `.gif` (beide Varianten werden beim Cache-Hit geprüft). Optimierung via **`gifsicle -O3 --lossy=80 --resize-fit {preset}`** (bester Trade-off aus der Praxis; skaliert nur herunter). `gifsicle` fehlt/scheitert → Original animiert **durchreichen** (nie schlechter). `php artisan img:clear-cache` leert den kompletten Proxy-Cache (nach geänderten Encode-Parametern). **Prod-Gotchas (verifiziert 2026-07-08):** (a) FPM setzt `env[PATH]` nicht (Forge kommentiert es aus) → `ExecutableFinder` findet gifsicle nicht; darum **absolute Pfade** (`/usr/bin/gifsicle`) zuerst. (b) `optimizeGif` fängt jetzt **jede** Exception (proc_open/Timeout) → Passthrough statt 502. (c) **User-Agent** nötig: manche Hosts (Wikimedia) 403en generische Agents wie „GuzzleHttp/7" → `Mozilla/5.0 (compatible; EinundzwanzigImgProxy/1.0; +URL)`. Live-Beleg: Wikimedia-GIF 308 KB → 182 KB, `image/gif`/`GIF89a` (animiert). **Native-Mobile:** rein Hybrid — die App ruft den gehosteten Proxy; **keine** GIF-/Bild-Kompression im NativePHP-Bundle (kein GD/Imagick/gifsicle on-device nötig), `proxifyImage()`/`ImageProxy::url()` bauen nur die absolute Web-Host-URL, Offline → Original. **Prod:** `gifsicle` muss auf dem Forge-Web-Host installiert sein (`apt-get install gifsicle`) — sonst greift der Passthrough.

**Warum nach B2:** Erst mit B2 werden Raum-`picture`-URLs real gerendert (Autor-Avatare gibt es schon, NIP-11-Icon aus B1 kommt in B5). Dann lohnt der Proxy — ein Durchleit-Dienst, der jedes externe Nostr-Bild **serverseitig zuschneidet + als WebP komprimiert + cached**, statt megabyteschwere Originale in Avatar-Größe zu laden. Ziel: Performance (Listen mit vielen Avataren, Raum-/Space-Bilder).

**Entscheidungen (Auftraggeber, 2026-07-08):**
- **Hybrid Web/Mobile:** Der Proxy läuft als Laravel-Route auf dem **Web-Host** (`group.einundzwanzig.space`). Die **NativePHP-Mobile-App** ruft **denselben gehosteten** Endpunkt (kein On-Device-WebP-Encoding, kein Cache im knappen App-Speicher, echter Boost auch mobil). **Offline/Fehler → Fallback auf die Original-URL** (WebView lädt direkt). Begründung: On-Device-Encoding kostet CPU/Akku ohne echten Gewinn; der gehostete Cache bedient alle Clients.
- **Intervention Image v3 + eigene Route** (nicht Glide): volle Hoheit über SSRF-Schutz, Cache-Keys und Eviction. GD-Treiber (Imagick im PHP-Runtime nicht vorausgesetzt — **vor Bau prüfen**, welche Extensions Web-Host bzw. NativePHP-Runtime bündeln; da der Proxy nur web-seitig rechnet, zählt der Web-Host).
- **Scope: alle remote Nostr-Bilder** — Autor-Avatare (kind-0 `picture`), Raum-`picture` (B2), NIP-11-Space-`icon` (B1/B5), später `banner` (B3/B6).

**Bausteine:**
| Teil | Inhalt |
|---|---|
| **Route** | z.B. `GET /img?src=<url>&w=&h=&fit=cover&q=` → Intervention lädt `src`, cropt/resized, encodet WebP, streamt mit `Cache-Control`/`ETag`. Antwort aus Datei-Cache, wenn vorhanden. |
| **SSRF-Schutz** (Pflicht — `src` ist untrusted) | Nur `https`; DNS auf **öffentliche** IPs auflösen (private/loopback/link-local block); Content-Type `image/*`; Max-Bytes + Fetch-Timeout; erlaubte Zielmaße whitelisten (feste `w/h/fit`-Presets statt beliebiger Werte → begrenzt Cache-Kardinalität). Rate-Limit. **Kein** Client-HMAC als „Secret" (JS-Bundle ist öffentlich) — Verteidigung ist die Validierung. |
| **Cache** | `storage/app/img-cache`, Key = Hash(`src`,Preset). Eviction: TTL + Max-Größe (LRU), per Scheduled Command. |
| **Client-Helper** | `proxifyImage(url, preset)` in der Insel (`core.ts`/`bridge.ts`): baut die Proxy-URL gegen den **festen Web-Host** (Web = relativ, Mobile = absolute `group.einundzwanzig.space`). Alle `::src` (Avatare, Raum-`picture`, Space-`icon`) laufen darüber; `onerror` → Original-URL (Offline-Fallback). |

**Tests:** Route/SSRF-Validierung/Cache-Key/Eviction → **Pest** (u.a. private-IP-`src` wird abgelehnt, WebP-Content-Type, Cache-Hit zweiter Request). Rendering/`onerror`-Fallback → **E2E**.

**Offen bis Umsetzung:** feste Preset-Liste (welche `w/h/fit`); GD-Verfügbarkeit auf dem Forge-Web-Host bestätigen; Cache-Budget/TTL.

---

## PC — Geteilter Profil-Cache (kind 0) gegen Namens-/Avatar-Flackern — ✅ umgesetzt

> **Problem (2026-07-08):** Autor-Namen/Avatare flackerten, weil welshman sie bei jedem Seitenaufruf neu von Relays auflöst (keine Client-Persistenz). **Entscheidung Auftraggeber:** Laravel-**Backend**-Cache statt Client-IndexedDB — weil er (a) über ALLE Nutzer/Geräte **geteilt** ist (kein Cold-Start pro Browser), (b) **Web + Mobile** identisch bedient (Mobile ruft den gehosteten Endpunkt, Hybrid wie der Bild-Proxy), (c) die bestehende Infra nutzt (`SpaceCache`/`swentel/nostr-php` holen schon Events per WS). Client-IndexedDB später nur, falls Offline/Repeat-Speed nötig (YAGNI).
>
> **Ist-Umsetzung:** `Einundzwanzig\Group\Nostr\ProfileCache::get(pubkeys)` — kind-0 je pubkey aus Laravel-Cache (`false` = bekannt-abwesend, weil Laravel `null` nicht von „nicht gecacht" trennt; TTL 1 Tag); Misses via kurzlebiger WS von **purplepag.es + Space-Relay** (neuestes je pubkey). Host-Route `GET /nostr/profiles?pubkeys=…` (öffentlich, kein AUTH, cap 100). Client `profiles.ts::warmProfiles()` — Endpoint holen, jedes Event `verifyEvent`-**prüfen** (Trust-Boundary: Relay-Daten untrusted), `verifiedSymbol` setzen, `repository.load()` → welshman leitet `profilesByPubkey` ab → `deriveRoomChat` zeigt Namen/Bilder sofort. **welshman bleibt Live-Truth** und überschreibt. Verdrahtet in `feeds.ts` (Autoren der geladenen Nachrichten, dedupliziert via `seeded`-Set, fire-and-forget). Fällt bei Endpoint-/Relay-Ausfall lautlos auf die welshman-Live-Auflösung zurück. Tests: 5 Pest (Cache-Hit/Abwesenheit/Validierung/Endpoint) + realer WS-Fetch (fiatjaf-kind-0) verifiziert. **Offen/Kür:** Directory-Members analog seeden; echte SSR-`@js()`-Injection im `mount()` für Zero-First-Paint (heute: schneller geteilter Seed, nicht literal-zero).

## B3 — Autor-Profile: Lücken schließen  *(Kür)* — ✅ umgesetzt

> **Ist-Umsetzung:** Profil-Karte als **Identitätskarte** (Flux-Modal, eigene Alpine-Insel `nostrProfileCard`), aus Chat **und** Directory per `open-profile`-Window-Event (`$dispatch(…, m.pubkey)`) geöffnet — Avatar **und** Name sind klickbar. Zeigt Banner (`$img`-Proxy, Fallback Brand-Verlauf), Ring-Avatar (Brand-Glow), `display_name`/`name`, kopierbaren npub-Chip, `about`, sanitizte `website` (eigene truncatende Zeile → kein Overflow) und `lud16` als kopierbaren ⚡-Chip (reine Anzeige, **keine** Zaps). Profil lädt lazy via `deriveProfile` (welshman-Outbox), Felder füllen reaktiv nach; `copy()` → Toast. Der manuelle Display-Join in `feeds.ts` ist auf `displayProfileByPubkey` umgestellt (weniger Eigenlogik). Der zweite Gap (`deriveProfileDisplay`) ist damit erledigt. `banner`/`website`/`lud16` aus dem B6-Backlog gleich mitgenommen.

Name+Avatar sind schon sauber über welshman verdrahtet (`feeds.ts:113-160`, `members.ts:162-170`, `loadMemberProfiles` `members.ts:369`, dedupliziert). Offen ist die **Tiefe**.

| Gap | Ist-Zustand | Fix | Sev | Aufw |
|---|---|---|---|---|
| **Kein Profil-Detail** | `Profile.about/website/banner/display_name/lud16` nie angezeigt. | Klick auf Avatar/Name → Profil-Karte (Flux-Popover/Modal): `display_name`, `about`, `website`, NIP-05 (B4), optional `banner`. Daten via `getProfile(pubkey)`/`deriveProfile`. | niedrig | M |
| **Manueller Display-Join** | `feeds.ts:117` baut Name selbst via `displayProfile(...)`. | Wo passend `deriveProfileDisplay(pubkey)`/`displayProfileByPubkey` nutzen (welshman-Bordmittel) — weniger Eigenlogik. | niedrig | S |

---

## B4 — NIP-05-Verifizierung — ✅ umgesetzt

> **Ist-Umsetzung:** Dünne Hülle `js/handles.ts` um welshmans `handles`-Layer — `warmHandles(pubkeys)` (lazy/fire-and-forget/dedupliziert wie `warmProfiles`) stößt `loadHandleForPubkey` an; `verifiedNip05(pubkey, profiles, handles)` kapselt die **sicherheitskritische Match-Regel** (Profil-`nip05` muss existieren UND der nostr.json-Handle auf genau diese pubkey zeigen — sonst ''). `nip05` durchgereicht in `ChatMessage` (`feeds.ts`, `handlesByNip05` in den `derived`-Deps) und `MemberView` (`members.ts`, gethrottlet wie Profile). Anzeige: neues Blade-Component `nostr-nip05` (Brand-`check-badge`, optionales `:label` für den Handle-Text) an Autor-Kopf (Chat), Directory (Handle ersetzt npub-Zeile) und Profil-Karte. Karte nutzt `deriveHandleForPubkey` direkt (Einzel-Profil, reaktiver Per-Pubkey-Store, sauberes `_unsubHandle`). welshman löst NIP-05 privacy-schonend über **dufflepud** auf (kein direkter `.well-known`-Abruf im Browser) — der E2E-Test stubbt entsprechend `/handle/info`. Häkchen erscheint **nur** bei bestätigtem Match, nie fälschlich „verifiziert".

**Fehlte komplett** — obwohl welshman die volle Infrastruktur ungenutzt mitbrachte: `@welshman/app/handles` (`deriveHandleForPubkey`, `loadHandleForPubkey`, `displayNip05`, `queryProfile`, `handlesByNip05`). Das `Profile.nip05`-Feld wird im Client nie gelesen.

| Gap | Ist-Zustand | Fix | Sev | Aufw |
|---|---|---|---|---|
| **Keine NIP-05-Anzeige/-Prüfung** | Kein `nip05`-Read, keine Verifizierung. | `deriveHandleForPubkey(pubkey)` → **verifizierten** Handle (Match nostr.json ↔ pubkey). Badge/Häkchen + `displayNip05(handle)` neben Autor-Name (Chat `⚡room.blade.php`), Directory (`⚡directory.blade.php:72`) und Profil-Karte (B3). Häkchen **nur** bei bestätigtem Match; unbestätigt → kein Badge (nie fälschlich „verifiziert"). | mittel | M |

**Kante:** Verifizierung ist Netz-I/O (nostr.json-Fetch) — asynchron/lazy laden, Ergebnis cachen (welshman `handlesByNip05` erledigt das), Badge erst bei Erfolg einblenden. Kein Blockieren des Nachrichten-Renderings.

---

## B5 — Favicon / OG / Head dynamisch

Web-Host-Head ist reich (`resources/views/partials/head.blade.php`: Favicons `/favicon.{ico,svg}`, `apple-touch-icon.png`, statisches `og.png`; Titel **pro Raum** dynamisch, `ogDescription` pro Raum via `View::share`). Der **Chat-Package-Head** (Fremdhost/Portal, `packages/einundzwanzig-group/resources/views/partials/head.blade.php`) hat **keine** Favicons/OG (bewusst: „Host regelt selbst").

| Gap | Ist-Zustand | Fix | Sev | Aufw |
|---|---|---|---|---|
| **Space/Directory-Titel statisch** | `⚡spaces.blade.php`/`⚡directory.blade.php` fest betitelt. | Titel aus B1-Space-Name (Fallback bisherig). | niedrig | S |
| **OG-Bild statisch** | `og:image = asset('og.png')` für alle Seiten (`head.blade.php:…`). | Per-Raum: `RoomMeta.picture` (B2) als `og:image`, sonst Space-`icon` (B1), sonst `og.png`. Dynamisch generiertes OG (Space-Icon + Raum-Name) = **Kür/L, später**. | niedrig | M–L |
| **Favicon = App-fix** | statische Projekt-Favicons. | Bleiben Default. Space-`icon` (NIP-11) als Favicon **nur** erwägen, wenn Single-Space-Fokus das rechtfertigt — sonst YAGNI. | niedrig | S |

> **Portal-Head (anderes Repo):** Falls das Portal Favicons/OG erwartet, ist das dort zu lösen (Kommentar im Package-Head). Hier nicht erzwingen.

---

## B6 — Weitere Nostr-Metadaten (Backlog / bewusst optional)

Fundstücke aus welshman, die heute brachliegen. **Nicht** pauschal bauen — nur ziehen, wenn ein konkreter UX-Gewinn und billig:

- `Profile.banner` → Kopfbild der Profil-Karte (B3).
- `Profile.website` → Link in Profil-Karte (B3).
- `Profile.lud16/lud06/lnurl` (Lightning) → höchstens ⚡-Badge; **Zaps bleiben ausgeschlossen** (PLAN §1).
- `RoomMeta.livekit` → Voice/Video-Raum-Indikator — **out of scope**, nur vermerkt.
- `RoomMeta.pictureMeta` (blurhash) → Ladeplatzhalter (B2, Kür).
- NIP-11 `banner`/`limitation` → Space-Kopfbild bzw. Hinweise (B1-Erweiterung).
- **Custom-Emoji (NIP-30)** → welshman rendert `:shortcode:` heute als Text (`renderEmoji`→`addText`). Optional: `emoji`-Tag-URL als kleines Inline-`<img>` über den Bild-Proxy. Nur wenn im Vereins-Chat real genutzt.

---

## Reihenfolge & Abhängigkeiten

1. **P1 zuerst** (blockierend) — schafft die Grundlage fürs Mitmachen; danach entsteht Branding-Code direkt auf dem `package`-Branch (Symlink-Dev).
2. **B1 ✅ → B2 ✅ → IMG ✅** (Bilder-Proxy) → **B3 ✅** (Profil-Karte, Kür) → **B4** (NIP-05, mittel, eigenständig) → **B5** (Head/OG, hängt an B1/B2) → **B6** (Kür/Backlog).
3. Branding-Änderungen liegen fast alle im Package (`packages/einundzwanzig-group/js/*`, `resources/views/*`, `src/Nostr/SpaceCache.php`) → nach P1 alle auf `package`-Branch, `git push origin package` nach jedem Commit (Memory: Push-nach-jedem-Commit).

## Offene Fragen an den Auftraggeber
- **P1 Schritt 4/Risiko:** Falls `dev-package` mit `prefer-stable` zickt — Inline-Alias `dev-package as 0.1.x-dev` ok, oder lieber doch Tag-basiert (`^0.1`, dann Tag-Pflege bei jedem Release)?
- **B5 OG:** Reicht „Raum-`picture` als OG-Bild", oder ist ein generiertes Marken-OG (Space-Icon + Raum-Name) gewünscht (mehr Aufwand)?
- **B1 Favicon:** Space-`icon` als Favicon setzen (bei Single-Space-Fokus sinnvoll) oder App-Favicon fix lassen?
