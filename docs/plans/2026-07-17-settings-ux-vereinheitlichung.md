# Settings-UX-Vereinheitlichung (Web + Mobile)

- [ ] P1: Einstieg homogenisieren (Cog → group.settings)
- [ ] P2: Registry + 7 Section-Partials
- [ ] P3: Wallet-Unterseite :back zum Hub
- [ ] P4: Design-/A11y-Politur-Pass
- [ ] P5: Aufräumen (Redirect + show_relays entfernen)

- **Datum:** 2026-07-17
- **Status:** Entwurf
- **Slug:** settings-ux-vereinheitlichung

## Ziel

Die Einstellungen sind heute über zwei überlappende, auseinanderdriftende Screens
verteilt, und der Nav-Cog führt sogar auf den *alten* Screen. Ziel: EIN Settings-*Ziel*
(`group.settings`) mit EINER Informationsarchitektur, host-parametrisiert über Config
(analog zur bestehenden `nav`-Mechanik). Der **Zielscreen** ist auf Web UND Mobile
identisch strukturiert; der **Einstiegsweg** darf host-spezifisch bleiben (Web: Cog-Tab;
Mobile: „Mehr"-Tab, s. Mobile-Verbund) — entscheidend ist, dass beide auf
*denselben* `group.settings` führen. Für den Mitglieds-Nutzer: Wiedererkennbarkeit,
Vorhersagbarkeit (Back/Exit konsistent), null Drift zwischen den Hosts.

**Navigations-/Wege-Modell (entschieden 2026-07-17).** Konsistenz heißt hier
*„gleiche Rolle → gleiche Behandlung"* (Nielsen: Konsistenz & Standards), nicht
„gleiche Pixel unabhängig von der Rolle". Daraus folgt das Leitprinzip für host-aware
Divergenz:

- Der **Ziel-Screen `group.settings`** ist auf beiden Hosts byte-nah identisch: EIN
  `app-header`-Muster (Brand-Mark + config-getriebenes `exit`), EINE Registry-Reihenfolge,
  EIN `nostrAuth`-Scope. Das ist der Konsistenz-Anker — kein Host-Fork.
- Der **Einstiegs-*Weg*** ist pro Host verschieden, aber jeweils *konventionskonform*
  (Web: Cog in der 3er-Nav; Mobile: „Mehr"-Overflow-Tab — der plattformübliche Ort für
  Konfiguration, „Match System ↔ reale Welt").
- **`group.wallet` erscheint pro Host in genau EINER Rolle** und leitet daraus alles
  Weitere ab (Sichtbarkeit *und* Rücksprung, s. P3): auf Mobile als **Peer-Tab** in der
  Bottom-Nav (kein Zurück-Pfeil, kein Hub-Eintrag), auf Web als **Settings-Sektion** im
  Hub (Zurück → Hub). Beides ist *dieselbe* Regel, nur unterschiedlich instanziiert —
  keine Drift, sondern rollenkorrekte Ableitung aus der `nav`-Registry.

## Scope

- **In:** Konsolidierung `⚡settings` + `⚡space` → ein Hub; `config('group.settings')`-
  Registry (geordnete Section-Keys); 7 geteilte Section-Partials; Nav-Cog auf
  `group.settings`; Redirect für `group.space.settings`; Wallet-Unterseite mit
  `:back`; Design-/A11y-Politur; Host-Consumer-Configs (Web/Mobile) koordiniert.
  **Cross-Repo (explizit IN scope):** Änderungen in `twenty-one-companion` (Registry-Adoption,
  „Einstellungen"-Zeile in „Mehr", `match`/`show_relays`-Cleanup, Mobile-Tests)
  — siehe eigener Abschnitt „Cross-Repo-Arbeitspakete".
- **Out:** Neue Settings-*Features* (Relay-Editor, Space-Verlassen, Blossom-Wechsel
  bleiben read-only/ausgeblendet); Portal-Konto/Sprache (bewusst nicht im Umfang);
  Wallet-Innenleben (`<x-group::wallet/>` unverändert); Rename von Routen-Namen
  (Cross-Repo-Bruch → nur Redirect); neue npm/composer-Dependencies.

## Betroffene Bereiche

Alle Pfade unter `packages/einundzwanzig-group/`:

- `config/group.php:59` — `nav`-Registry; Settings-Tab (`:62`) `route`/`match` von
  `group.space.settings` → `group.settings`. **Neu:** `settings`-Registry (Default =
  voller 7er-Satz). `show_relays` (heute nur via `config('group.show_relays', false)`
  im Blade referenziert, nicht definiert) → durch Registry abgelöst.
- `routes/group.php:31-33` — `/settings` (`group.settings`), `/settings/space`
  (`group.space.settings` → **Redirect**), `/settings/wallet` (`group.wallet`).
- `resources/views/pages/⚡settings.blade.php` — **Fundament**, wird zum
  Registry-Iterator umgebaut (existiert, 8 Sektionen, wiederverwendet).
- `resources/views/settings/⚡space.blade.php` — **löschen** (Duplikat, alte IA).
- `resources/views/settings/⚡wallet.blade.php` — `app-header` bekommt `:back`.
- `resources/views/components/{app-header,bottom-nav,nav-tab,app-shell}.blade.php` —
  **unverändert wiederverwendet** (Exit/Brand-Mark/Config-Nav schon vorhanden).
- **Neu:** `resources/views/partials/settings/{account,space,wallet,relays,blossom,
  appearance,session}.blade.php` (Markup 1:1 aus `⚡settings` extrahiert).
- Consumer-Repos (koordiniert, eigene `config/group.php`): `einundzwanzig-app` (Web,
  ohne `relays`) und `twenty-one-companion` (Mobile, mit `relays`). **Verifizierte
  Mobile-Kopplung siehe eigener Abschnitt „Mobile-Verbund" unten.**

### Mobile-Verbund (`twenty-one-companion`) — VERIFIZIERT 2026-07-17

Package via Composer-Path-Symlink konsumiert (`einundzwanzig/group: dev-master` →
`../einundzwanzig-group/packages/einundzwanzig-group`). Reale Kopplung (nicht Annahme):

- **Kein Settings-Cog in der Mobile-Nav.** `config/group.php` überschreibt `nav` (nur wenn
  `unified_shell`, env `UNIFIED_SHELL`) mit **4 Tabs: Chat · Wallet · Meetups · Mehr**.
  Settings (`group.settings`) wird über **Mehr → Profil → „Nostr-Identität, Räume &
  Relays"-Karte** erreicht (`resources/views/pages/profile/⚡index.blade.php:203`,
  bewusst **kein** `wire:navigate` — `group.*` wechselt ins Vollbild-Chat-Layout).
  → Der Einstiegs-*Weg* ist auf Mobile anders; das *Ziel* `group.settings` ist geteilt.

  **Entschieden 2026-07-17 (Auffindbarkeit, ohne die 4-Tab-Struktur zu sprengen):** Der
  einzige Weg heute (Mehr → *Profil* → Karte „Nostr-Identität, Räume & Relays") verletzt
  „Erkennen statt Erinnern" gleich doppelt — Settings sind (a) hinter *Profil* verschachtelt
  (zwei Hops, man muss *raten*, dass Einstellungen im Profil wohnen) und (b) hinter einem
  Label versteckt, das das wiedererkennbare Wort „Einstellungen" nicht führt. Fix **innerhalb**
  der „Mehr"-Übersicht (kein 5. Tab, kein Cog — die 4-Tab-Struktur bleibt gesetzt): In „Mehr"
  eine **direkt und klar mit „Einstellungen" beschriftete Top-Level-Zeile** anbieten (Peer
  von „Profil", ein Tap ab „Mehr" → `group.settings`). Die Profil-Karte darf als sekundärer
  Kontext-Shortcut bleiben, ist aber nicht mehr der *einzige* Weg. „Mehr" ist der
  plattformkonventionelle Overflow-Ort für Konfiguration — damit ist der Weg per Konvention
  auffindbar, sobald das Ziel dort *als „Einstellungen" benannt* ist.
- **Wallet ist ein eigener Top-Level-Tab** (nicht Settings-Unterseite). **Entschieden
  2026-07-17:** Mobile lässt die `wallet`-Sektion im Settings-Hub via Registry **weg**
  (kein doppelter Einstieg). Begründung: Der Peer-Tab ist der prominentere, immer
  sichtbare Einstieg (persistente Bottom-Nav vs. in einer Sektionsliste vergrabener
  Eintrag) — „Erkennen statt Erinnern" favorisiert den Dauer-sichtbaren Tab. Eine
  zweite „Wallet"-Sektion, die auf dieselbe `group.wallet` zeigt, trägt keine neue
  Information (Refactoring-UI: jedes Element muss seine Existenz rechtfertigen) und
  erzeugt widersprüchliche Rücksprung-Erwartungen (aus einer Sektion erwartet man
  Rückkehr in den Hub, aus dem Tab bleibt man Peer). „Weniger, aber besser": eine Rolle,
  ein Ort.

  **Sektions-Sichtbarkeit je Host (Registry-`config('group.settings')`):**

  | Section-Key | Web | Mobile | Anmerkung |
  |-------------|-----|--------|-----------|
  | account     | ✅  | ✅     | Identität zuerst |
  | space       | ✅  | ✅     | |
  | wallet      | ❌  | ❌     | **Beide Hosts** Peer-Tab in der Bottom-Nav (Web: Chat·Wallet·Einstellungen; Mobile: Chat·Wallet·Meetups·Mehr) → kein Hub-Eintrag. Section nur im Package-**Default** (dessen Nav hat keinen Wallet-Tab). |
  | relays      | ❌  | ✅     | Web read-only-Debatte offen (s. u.) |
  | blossom     | ✅  | ✅     | |
  | appearance  | ✅  | ✅     | |
  | session     | ✅  | ✅     | Exit/Logout terminal am Ende |

  Die Registry ist eine *geordnete* Key-Liste; das Entfernen von `wallet` (bzw. `relays`)
  verschiebt die *relative* Reihenfolge der übrigen Sektionen nicht — die IA-Hierarchie
  bleibt auf beiden Hosts intakt (s. „Konsistenz-Check" unter P4).
- **Mobile ist teil-migriert:** Profil zeigt schon auf den verschmolzenen `group.settings`,
  nicht auf den alten Screen. `group.space.settings` steht nur noch defensiv im `nav`-`match`
  (Chat-Tab) und in `resources/views/layouts/mobile.blade.php:131`. Redirect trägt das.
- **`show_relays => true`** aktiv gesetzt in `config/group.php:49`. Ablösung durch die
  Registry = Änderung dort.
- **`@source`-Glob deckt neue Partials automatisch:** `resources/css/{app,group}.css`
  scannen `../../vendor/einundzwanzig/group/resources/views` als Verzeichnis → neue
  `partials/settings/*` sind ohne Zutun drin (solange der vendor-Symlink frisch ist).
- **Mobile-Testsuite prüft Settings/Wallet-Routing:** `MobileShellTest`
  (`url('/settings')===route('group.settings')`, Auth-Redirect auf `group.nostr-login`),
  `ProfilePageTest` (Profil verlinkt `group.settings`), `UnifiedShellTest`,
  `ReportFixesTest` (Wallet-Tab). Diese müssen bei Route-/Nav-Änderungen mitlaufen.
## Ansatz

**Gewählt:** `⚡settings` ist das Fundament, Mobile konvergiert darauf; `⚡space` wird
gelöscht (Route bleibt Redirect). Host-Divergenz wird eine `config('group.settings')`-
Registry aus **Section-Keys** (keine `__()`-Labels — Config lädt vor Locale-Middleware,
gleiche Falle wie `nav`). Der Hub wickelt EIN `x-data="nostrAuth"` und iteriert die
Registry mit `@includeIf('group::partials.settings.'.$section)` (fail-soft). Sektionen
mit eigenem Alpine-Scope (`space`/`relays`/`appearance`) shadowen korrekt als Kind-Scope.

**Verworfen:** (a) Zwei getrennte Web-/Mobile-Layouts — reproduziert exakt die
Drift, die wir beseitigen; „logisch aufgebaut" liefert die Registry als Datenzeile,
nicht als geforkter Code. (b) Planungs-/Content-Weiterreichung an einen zweiten
generischen Agenten — Standard bleibt an einer Stelle. (c) Route-Rename statt Redirect
— bräche Cross-Repo-Hardlinks (3 Repos).

## Schritte

1. **P1** `nav`-Cog auf `group.settings` umbiegen (`match` übergangsweise
   `group.settings,group.space.settings`); `/settings/space` → `Route::redirect`
   (Name behalten); `⚡space.blade.php` löschen; `view:clear`.
2. **P2** 7 Partials unter `partials/settings/` anlegen (A11y-beste Variante je
   Sektion); `settings`-Registry in `config/group.php` (Default 7er-Satz); `⚡settings`
   iteriert Registry; `show_relays`-Check aus Relays-Partial raus (Sichtbarkeit =
   Registry); Consumer-Configs (Web ohne / Mobile mit `relays`) setzen.
3. **P3** Wallet-Rücksprung **host-aware** machen, **config-getrieben aus einer einzigen
   Quelle der Wahrheit** (`nav`-Registry), ohne Blade-Sonderfall. **Ableitungsregel
   (entschieden 2026-07-17):** *Ist `group.wallet` als `nav`-Tab registriert → Peer-Tab
   → KEIN `:back`. Sonst → Sub-Screen des Hubs → `:back = route('group.settings')`.* Das
   ist deckungsgleich mit dem Sichtbarkeits-Entscheid (Decision 1): Wallet ist auf Mobile
   `nav`-Tab **und** aus der Settings-Registry entfernt; auf Web ist Wallet Settings-Sektion
   **und** kein `nav`-Tab. Beide Signale stammen aus *derselben* Registry → kein Widerspruch,
   kein `@mobile/@web`-Seam. Umsetzung: der `⚡wallet`-`app-header` liest `:back` aus einem
   Helper/Config-Wert, der `null` liefert, wenn `group.wallet` in `config('group.nav')`
   steht, sonst `route('group.settings')` (Escape-Hatch-Override-Key optional, Default =
   Ableitung). NICHT hart `:back="route('group.settings')"` im `⚡wallet`.
   Registry-Entscheid: `wallet`-Sektion auf Mobile **weggelassen** (s. Mobile-Verbund,
   Sichtbarkeitstabelle) — kein doppelter Einstieg.
4. **P4** Section-Header-Muster + Spacing (`space-y-8`/`mt-2`), `surface-card`/
   `pressable`-Konsistenz, Icon/Typo vereinheitlichen; `aria-current`/`aria-labelledby`/
   `aria-busy`+`aria-live` überall; Touch-Targets ≥44px; Fokus-Ring-Kontrast;
   Text-Kontraste messen; `prefers-reduced-motion`.
5. **P5** (nach Mobile-App-Update) Redirect-Route + `show_relays`-Fallback entfernen;
   `nav`-`match` auf nur `group.settings` reduzieren.

## Cross-Repo-Arbeitspakete (`twenty-one-companion`) — phasen-gemappt

Diese Änderungen liegen **nicht** im Package, sondern im Mobile-Host-Repo
`/home/user/Code/twenty-one-companion/`. Package ist per Composer-Path-Symlink
(`dev-master`) eingebunden → Package-Änderungen sind sofort sichtbar; Host-eigene
config/Views müssen aber im Mobile-Repo selbst geändert werden. (Nur Android/Web —
**kein iOS**, daher kein iOS-Snapshot zu pflegen.)

- **P2 — Registry adoptieren:** in `config/group.php` den neuen Key setzen:
  `'settings' => ['account','space','relays','blossom','appearance','session']`
  (Mobile-Satz: **ohne** `wallet` — eigener Peer-Tab; **mit** `relays`). Das ist die
  Umsetzung des Sichtbarkeits-Entscheids aus dem Mobile-Verbund.
- **P3 — Wallet-Rücksprung:** **keine** eigene Mobile-Änderung nötig. Die Ableitungsregel
  liest `config('group.nav')`; da `group.wallet` dort bereits Peer-Tab ist, liefert sie
  automatisch „kein Back". Nur: gegen die Mobile-`nav` + Mobile-Testsuite validieren.
- **P4 — „Einstellungen" auffindbar in „Mehr" (Design-Entscheid):** in
  `resources/views/pages/more/⚡index.blade.php` eine **Top-Level-Zeile**
  `<x-list-link-card href="{{ route('group.settings') }}">` „Einstellungen" (Peer von
  „Profil", Muster wie die bestehenden `x-list-link-card`-Einträge dort). Die bestehende
  Profil-Karte „Nostr-Identität, Räume & Relays" (`pages/profile/⚡index.blade.php:203`)
  bleibt als **sekundärer** Kontext-Shortcut. Kein 5. Tab, kein Cog.
- **P5 — Cleanup (nach Package-P5):** in `config/group.php` `show_relays => true`
  entfernen (Sichtbarkeit = Registry) **und** `group.space.settings` aus dem Chat-Tab-`match`
  streichen; in `resources/views/layouts/mobile.blade.php:131`
  `group.space.settings` aus dem `x-bottom-nav-item match=` streichen.
- **Alle Phasen — Mobile-Testsuite nachziehen:** `MobileShellTest`, `ProfilePageTest`,
  `UnifiedShellTest`, `ReportFixesTest` — Assertions an neue Registry/Route/„Mehr"-Zeile
  anpassen und im Mobile-Repo laufen lassen (nicht nur Package-Tests).
- **Koordination/Sequencing:** Package zuerst (Redirect + Registry-**Default** puffern die
  Übergangszeit → Mobile bricht nicht, falls Package vor Mobile-Config released wird). Danach
  im Mobile-Repo `composer update einundzwanzig/group` + `php artisan view:clear`
  (`package-cross-repo-kopplung`).

## Risiken & Edge-Cases

- **Mobile-WebView-Optik:** kein `backdrop-blur` (Scroll-Killer, schon in `bottom-nav`
  gelöst); Partials führen keine neuen fixen/blur-Flächen ein; `pb-safe`/Safe-Area
  kommt aus `app-shell`/`bottom-nav`, Partials setzen kein eigenes Bottom-Padding.
- **Kein Server-Gate auf Mobile:** `nostr.auth` schützt nur den Web-Request; im WebView
  ist der Store/`authGate` einziger Schutz. Server-state-frei bleiben — keine
  serverseitig gerenderten Kontodaten ins Markup ziehen.
- **Config vor Locale-Middleware:** Registry hält NUR Keys, Labels via `__()` in den
  Partials — sonst Default-Sprache eingefroren.
- **Stale compiled Views:** nach Löschen/Umbau `php artisan view:clear`; falls 500
  durch verwaiste Blade: `rm -rf storage/framework/views/{livewire,blaze}`.
- **Cross-Repo-Rendering:** Partials werden auch von `twenty-one-companion` gerendert
  (geteilte Blade-Quelle). CSS-`@source` ist dort ein **Verzeichnis-Glob** → neue
  `partials/settings/*` sind automatisch abgedeckt (kein Handlungsbedarf), SOLANGE der
  vendor-Symlink frisch ist. Bei „Utilities fehlen am Gerät" zuerst Symlink/`npm run
  build` im Mobile-Repo prüfen.
- **Mobile-Wallet-Modell:** Wallet ist auf Mobile ein eigener Tab, nicht Settings-Sub —
  Wallet-`:back` und die `wallet`-Sektion NICHT blind auf beiden Hosts gleich behandeln
  (s. P3 + Mobile-Verbund), sonst doppelter Einstieg / falscher Zurück-Pfeil.
- **Mobile-Tests:** `show_relays`/Route-Änderungen wirken auf die Mobile-Testsuite
  (`MobileShellTest`/`ProfilePageTest`/`UnifiedShellTest`/`ReportFixesTest`) — diese
  Tests im Mobile-Repo mitfahren, nicht nur die Package-Tests.
- **Aktiv-State am Redirect:** solange `space.settings` als Redirect lebt, `match`-Liste
  hält den Aktiv-State; nach P5 entfernen.

## Test-Strategie

- **Dev-Server:** `composer run dev` (Laravel + Queue) bzw. `npm run dev` (Vite);
  E2E-Isolation via `VITE_HOT_FILE` (dev+E2E parallel, siehe Repo-CLAUDE.md/Memory).
- **Feature-Tests (Pest):** `php artisan test --compact --filter=Settings` — rendert
  `group.settings` mit gestubbter `config('group.settings')`-Registry und prüft
  Sektions-Präsenz + Reihenfolge (Web-Satz ohne `relays`, Mobile-Satz mit); prüft
  Redirect `/settings/space` → 302 `/settings`; prüft `nav`-Cog-Ziel `group.settings`.
- **Browser-/A11y-Tests:** Pest v4 Browser (Host-Chromium) auf `group.settings` —
  Space-Wechsel, Theme-Toggle, Logout, Wallet-Back; axe/Lighthouse-A11y Light+Dark.
- **E2E (Playwright):** `npm run test:e2e` — Flow Cog → Hub → Wallet → Zurück landet
  auf `group.settings`; Regression, dass die alte `⚡space`-IA nicht mehr erscheint.

## Definition of Done (pro Phase) — PFLICHT

- **P1:** Cog öffnet auf beiden Hosts `group.settings`; `/settings/space` liefert 302
  → `/settings`; kein Screen zeigt mehr die alte IA (Titel „Space wählen" weg);
  bestehende Feature-/E2E-Tests grün (Assertions von „Space wählen" auf „Einstellungen"
  nachgezogen).
- **P2:** Gerenderte Ausgabe je Host byte-nah identisch zu vor P2 (Web 6 Sektionen
  ohne Relays, Mobile 7 mit Relays); Feature-Test rendert `group.settings` mit
  gestubbter Registry und prüft Sektions-Präsenz/-Reihenfolge grün; `view:clear`
  gelaufen; keine Duplikat-Blade mehr (`⚡space` weg, Markup nur in Partials).
- **P3:** Web/Package-Default: Hub → Wallet → Zurück landet auf `group.settings`;
  Mobile: Wallet-Tab zeigt **keinen** Zurück-Pfeil zum Hub (bleibt Peer-Tab); Deep-Link
  `group.wallet` direkt öffenbar; Mobile-Testsuite (`ReportFixesTest`/`MobileShellTest`)
  grün. `:back` wird **aus der `nav`-Registry abgeleitet** (`group.wallet` ∈ `nav` → kein
  Back), NICHT hart im `⚡wallet` verdrahtet und NICHT via `@mobile/@web`-Seam — Test:
  gestubbte `nav` mit/ohne `group.wallet` liefert `:back`=`null` bzw. `route('group.settings')`.
  `wallet`-Sektion auf Mobile via Registry entfernt (kein Hub-Eintrag, verifiziert im
  Sektions-Präsenz-Test aus P2 gegen den Mobile-Satz). Registry-Entscheid dokumentiert.
- **P4:** axe/Lighthouse-A11y ohne kritische Findings auf `group.settings` (Light+Dark);
  Kanon-Checkliste abgehakt (Textkontrast ≥4.5:1 / UI ≥3:1, Target ≥44px, Fokus
  sichtbar, Farbe nie alleiniger Träger, `prefers-reduced-motion` honoriert);
  Screenshot Web+Mobile im Report.
  **Konsistenz-Check (entschieden 2026-07-17) — bestätigt gültig:** Die Sektions-Reihenfolge
  **Konto → Space → Wallet → Netzwerk (relays/blossom) → Darstellung → Sitzung** bleibt auf
  beiden Hosts sinnvoll, auch wenn `wallet` (Mobile) bzw. `relays` (Web) entfällt: Sie
  kodiert eine echte Hierarchie (Identität → Kontext → Fähigkeit → Infrastruktur →
  Präferenz → terminale Sitzung/Exit am Ende), und die geordnete Key-Registry hält die
  *relative* Ordnung stabil, wenn ein Key fehlt — kein Reflow der Bedeutung. Header-Muster
  ist single-source (ein `app-header`, `exit` aus Config identisch pro Host). Die **einzige**
  host-Varianz — Back-Pfeil am Wallet-Screen (Web) vs. keiner (Mobile) — ist *keine* Drift,
  sondern rollenkorrekt (gleiche Rolle → gleiche Behandlung): Sub-Screen bekommt Back, Peer-Tab
  nicht. Assertion im Report: Header/Exit auf `group.settings` beider Hosts identisch gerendert.
- **P5:** Grep über `einundzwanzig-app` + `twenty-one-companion` ohne
  `space.settings`/`show_relays`-Treffer;
  Redirect-Route + Flag entfernt; `nav`-`match` = nur `group.settings` (auch in
  `layouts/mobile.blade.php`); Package- UND Mobile-Testsuite grün.

## Entschiedene Fragen (2026-07-17)

- **Mobile-Wallet — ENTSCHIEDEN: weglassen.** Die `wallet`-Sektion wird auf Mobile via
  Registry entfernt (Wallet = eigener Peer-Tab). Grund: kein doppelter Einstieg, der
  Dauer-sichtbare Tab schlägt die vergrabene Sektion („Erkennen statt Erinnern"), keine
  widersprüchliche Rücksprung-Erwartung, „weniger aber besser". (Details: Mobile-Verbund +
  P3.)
- **Mobile-Settings-Einstieg — ENTSCHIEDEN: Struktur bleibt, Auffindbarkeit schärfen.**
  Kein 5. Tab / kein Cog (4-Tab-Kanon gesetzt), aber in „Mehr" eine direkt mit
  „Einstellungen" beschriftete Top-Level-Zeile (ein Tap ab „Mehr" → `group.settings`);
  Profil-Karte bleibt sekundärer Shortcut. Grund: „Erkennen statt Erinnern" — Settings
  dürfen nicht hinter *Profil* verschachtelt und ohne das Wort „Einstellungen" versteckt
  sein. (Details: Mobile-Verbund.)
- **Navigations-/Wege-Modell — ENTSCHIEDEN:** Ziel-Screen host-identisch (Konsistenz-Anker),
  Einstiegsweg host-konventionskonform verschieden, `group.wallet`-Rolle (Peer-Tab vs.
  Sektion) + Rücksprung aus der `nav`-Registry abgeleitet. (Details: „Ziel" + P3 + P4.)

## Offene Fragen

- Bleibt „Netzwerk & Relays" wirklich Mobile-only, oder soll der Web-Client sie
  read-only ebenfalls zeigen? (Aktuell: Web aus.)
- Soll `docs/plans/` dieses Doc committet werden (Standard-Ort) oder lokal bleiben?
  (`/plans/` ist gitignored, `docs/` nicht.)
- P2 Consumer-Config-Rollout: zeitgleich mit dem Package-Release oder gestaffelt
  (Redirect + Registry-Default fangen die Übergangszeit ab)?
