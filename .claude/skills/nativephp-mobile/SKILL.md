---
name: nativephp-mobile
description: "Use this skill whenever working with NativePHP Mobile v3 in this app: native:* artisan commands, builds/runs (Emulator, Jump, Hot Reload), native APIs (Camera, Biometrics, Scanner, SecureStorage, Push, Dialog, Share, …), EDGE components (<native:*>), config/nativephp.php, .env NATIVEPHP_* keys, plugins (install/register/develop), SQLite/Queues/Deep Links on device, and Play-Store/App-Store releases. Built from a deep scan of all 58 official v3 docs pages (2026-06-11)."
---

# NativePHP Mobile v3

NativePHP Mobile bettet eine vorkompilierte PHP-Runtime samt Laravel direkt in eine native
Swift-/Kotlin-Shell ein — kein Webserver, offline-first, eine Codebasis für iOS + Android.
Native Features laufen über Plugins (Composer-Pakete) und werden per Facade aufgerufen;
Ergebnisse kommen **asynchron als Events** zurück.

## Projektfakten (dieses Repo)

- App-ID: `space.einundzwanzig.mobile` — **niemals ändern** (Bundle-ID beider Stores).
- Core ist frei (v3.0+); License Key (siehe Memory `nativephp-zugangsdaten`) nur für Premium-Plugins; Marketplace-Repo + Credentials sind in `composer.json`/`auth.json` konfiguriert.
- `JAVA_HOME=~/.local/share/JetBrains/Toolbox/apps/android-studio/jbr`, `ANDROID_HOME=~/Android/Sdk`, AVD: `Pixel_10_Pro_XL`.
- iOS-Builds nur auf macOS; unter Linux Android bauen und iOS via Jump auf dem iPhone testen.
- Kompletter Ausführungs-/Release-Plan: `docs/nativephp-ausfuehrungsplan.md`.

## Befehls-Schnellreferenz

```bash
yarn build --mode=android                  # PFLICHT vor jedem Kompilieren (sonst alte Assets im Bundle)
php artisan native:run android             # bauen + im Emulator/Gerät starten (--watch = Hot Reload)
php artisan native:jump                    # Live-Preview auf Echtgerät via QR (auch iPhone von Linux!)
php artisan native:tail                    # Laravel-Logs der laufenden App
php artisan native:debug                   # Umgebungs-Diagnose
php artisan native:install android         # Neuinstallation der nativen Ressourcen (--force nach Minor-Updates)
php artisan native:plugin:register <pkg>   # Plugin nach composer require registrieren, dann Rebuild
php artisan native:release patch|minor|major   # Version + Build-Nummer bumpen (nie manuell editieren)
php artisan native:package android --build-type=bundle   # signiertes AAB für den Play Store
```

## Kritische Regeln

1. `nativephp/` ist **ephemer** (selbst-gitignored) — nie committen, nie manuell editieren.
2. Native Aufrufe (`Camera::getPhoto()`, `Biometrics::prompt()`, …) liefern **keine Rückgabewerte** — immer `#[OnNative(EventKlasse::class)]`-Handler in Livewire-Komponenten verwenden.
3. Die `.env` wird **mit ausgeliefert** — Secrets in `cleanup_env_keys` (config/nativephp.php) eintragen.
4. Nur SQLite, keine Remote-DB, nur `database`-Queue — Architektur strikt API-First gegen das Portal (`einundzwanzig-app`). Migrationen laufen **bei jedem App-Start**.
5. Tailwind v4 (Flux UI Pro) braucht moderne WebViews → `min_sdk` 33 nicht senken.
6. Plugins: `composer require` allein reicht nicht — registrieren + Rebuild, sonst fehlt der native Code.
7. In Tests/Web-Kontext native Aufrufe mit `function_exists('nativephp_call')` guarden oder Facades mocken.
8. `NATIVEPHP_APP_VERSION=DEBUG` in Dev belassen (App-Bundle wird bei jedem Start neu geladen).

## Referenzen (bei Bedarf lesen)

| Datei | Inhalt |
|---|---|
| `references/getting-started.md` | Installation, Environment-Setup (Android/iOS), Konfiguration (alle config-Keys + env), komplette Befehlsreferenz, Deployment/Store-Releases, Changelog |
| `references/the-basics.md` | WebView-Verhalten, native Funktionen aufrufen, Event-System (`#[OnNative]`, JS-Bridge `#nativephp`), Vite-Plugin, Hot Reload, Jump |
| `references/edge-components.md` | Native UI aus Blade: `<native:top-bar>`, `<native:bottom-nav>`, `<native:side-nav>`, Icon-Mapping (SF Symbols/Material) + Limits |
| `references/concepts.md` | Security/Secrets, Authentication (Token-Flows), SQLite-Datenbank, Queues/Jobs, Deep Links, Versionierung |
| `references/plugins-free.md` | Browser, Camera, Device, Dialog, File, Microphone, Network, Share, System — APIs, Events, Berechtigungen |
| `references/plugins-premium.md` | Biometrics, Geolocation, Scanner, SecureStorage, Firebase Push — APIs, Events, Setup |
| `references/plugins-system.md` | Plugins nutzen/registrieren, eigene Plugins entwickeln (Bridge Functions, Lifecycle, Permissions, Testing) |
| `docs/nativephp-ausfuehrungsplan.md` | Destillierter Schritt-für-Schritt-Plan inkl. Release-Checkliste und Vollständigkeits-Review |
