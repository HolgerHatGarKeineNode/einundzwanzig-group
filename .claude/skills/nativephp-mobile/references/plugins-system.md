# NativePHP Mobile v3 — Plugin-System — Nutzung, Registrierung & Entwicklung eigener Plugins

> Quelle: Deep-Scan der offiziellen Doku (nativephp.com, Stand 2026-06-11). 10 Seiten.

---

## NativePHP Mobile v3 — Plugins: Introduction

<https://nativephp.com/docs/mobile/3/plugins/introduction>

Die Seite ist die konzeptionelle Einführung in das Plugin-System von NativePHP for Mobile v3. Kernaussagen:

1) Was sind Plugins? Plugins erweitern NativePHP for Mobile um native Funktionalität (z. B. On-Device-ML, Bluetooth, eigene Hardware-Integrationen), ohne dass das Core-Paket geforkt werden muss. Ein Plugin ist ein Composer-Paket, das drei Dinge bündelt: (a) PHP-Code — Facades, Events und Service Provider für Laravel, (b) nativen Code — Swift für iOS und Kotlin für Android, (c) ein Manifest, das deklariert, was das Plugin bereitstellt und benötigt. Beim Build kompiliert NativePHP den nativen Code aller registrierten Plugins direkt in die App.

2) Warum Plugins? SÄMTLICHE native Funktionalität in NativePHP Mobile v3 läuft über Plugins — auch die offiziellen Features wie Kamera, Biometrie und Push-Benachrichtigungen. Offizielle Plugins liefern Kernfunktionalität und dienen als Referenzimplementierungen; Community-Plugins erweitern die Plattform; eigene Plugins können proprietäre SDKs oder Custom-Native-Code integrieren. Nach der Installation eines Plugins stehen dessen native Features dem PHP-Code über eine einfache Facade zur Verfügung.

3) Was Plugins können (vollständige Fähigkeitsliste): Bridge Functions (Swift/Kotlin aus PHP aufrufen, Ergebnisse zurückerhalten); Events (vom nativen Code an Livewire-Komponenten dispatchen); Permissions (erforderliche native Berechtigungen deklarieren); Dependencies (native Bibliotheken via Gradle, CocoaPods oder Swift Package Manager); Custom Repositories (private Maven-Repos für Enterprise-SDKs); Android Components (Activities, Services, Broadcast Receivers, Content Providers registrieren); Assets (ML-Modelle und Konfigurationsdateien bündeln); Lifecycle Hooks (Code zur Build-Zeit ausführen); Secrets (erforderliche Umgebungsvariablen inkl. Validierung deklarieren).

4) Plugin-Architektur: Plugins folgen denselben Mustern wie der NativePHP-Core. Nutzung im PHP/Livewire-Code: Facade-Aufruf `MyPlugin::doSomething();` für native Funktionen und das Attribut `#[OnNative(MyPlugin\Events\SomethingHappened::class)]` auf einer Livewire-Methode (z. B. `public function handleResult($data)`) zum Empfangen nativer Events. Der native Code läuft on-device, kommuniziert über die Bridge mit PHP und dispatcht Events zurück an Livewire-Komponenten.

5) Getting Started: verweist auf die Folgeseiten 'Creating Plugins' (./creating-plugins) und den NativePHP Plugin Marketplace (https://nativephp.com/plugins). Die Doku-Navigation listet außerdem 'Using Plugins' sowie die Core-Plugins: Biometrics, Browser, Camera, Device, Dialog, File, Firebase, Geolocation, Microphone, Network, Scanner, SecureStorage, Share, System.

Relevanz für den Implementierungsplan (Laravel + Livewire + Flux UI): Alle nativen Features der geplanten Android/iOS-App (Kamera/Scanner für z. B. Lightning-QR-Codes, Biometrie, SecureStorage für Tokens, Geolocation für Meetups, Share, Push via Firebase) werden in v3 als Plugins konsumiert; die Interaktion erfolgt durchgängig per Facade-Aufruf plus #[OnNative]-Event-Listener in Livewire-Komponenten — das passt nahtlos zur bestehenden Livewire-Architektur.

### APIs

- Plugin-Facade-Muster: use Vendor\MyPlugin\Facades\MyPlugin; MyPlugin::doSomething(); — native Funktionen (Swift/Kotlin) synchron aus PHP aufrufen, Ergebnisse kommen über die Bridge zurück
- #[OnNative(MyPlugin\Events\SomethingHappened::class)] — PHP-Attribut auf einer Livewire-Methode (z. B. public function handleResult($data)), um Events aus dem nativen Code zu empfangen
- Plugin-Events: native Code dispatcht Event-Klassen (z. B. MyPlugin\Events\SomethingHappened) zurück an Livewire-Komponenten
- Plugin-Struktur als Composer-Paket: PHP-Seite = Facades + Events + Laravel Service Provider; native Seite = Swift (iOS) + Kotlin (Android); plus Manifest (deklariert provides/requires)
- Core-Plugins (in der Doku-Navigation gelistet, je eigene Facade): Biometrics, Browser, Camera, Device, Dialog, File, Firebase, Geolocation, Microphone, Network, Scanner, SecureStorage, Share, System

### Konfiguration

- Permissions: Plugins deklarieren benötigte native Berechtigungen selbst in ihrem Manifest (keine manuellen AndroidManifest.xml-/Info.plist-Einträge auf dieser Seite dokumentiert)
- Secrets: Plugins können erforderliche Umgebungsvariablen (env) inkl. Validierung deklarieren — konkrete Variablennamen werden auf dieser Seite nicht genannt
- Plugin-Manifest: Bestandteil jedes Plugins; deklariert bereitgestellte Funktionen, benötigte Permissions, Dependencies (Gradle/CocoaPods/SPM), Custom Maven Repositories, Android-Komponenten (Activities/Services/Receivers/Content Providers), gebündelte Assets und Lifecycle Hooks

### Stolperfallen

- In NativePHP Mobile v3 läuft AUSNAHMSLOS alle native Funktionalität über Plugins — auch Kamera, Biometrie, Push usw. sind offizielle Plugins; ohne installierte/registrierte Plugins gibt es keine nativen Features
- Nativer Plugin-Code (Swift/Kotlin) wird zur Build-Zeit in die App kompiliert — Plugins müssen vor dem Build installiert/registriert sein; nachträgliches Laden zur Laufzeit ist nicht vorgesehen
- Event-Empfang ist auf Livewire ausgerichtet (#[OnNative] auf Livewire-Komponenten-Methoden) — passt zur Livewire/Flux-Architektur, setzt aber Livewire-Komponenten als Empfänger voraus
- Diese Einführungsseite enthält KEINE CLI-Befehle, keine konkreten config-Keys und keine Lizenzhinweise; Details stehen auf den Folgeseiten 'Creating Plugins' (./creating-plugins) und 'Using Plugins' sowie im Plugin Marketplace (https://nativephp.com/plugins)
- Enterprise-SDKs aus privaten Maven-Repositories werden unterstützt (Custom Repositories), erfordern aber entsprechende Deklaration im Plugin-Manifest
- Plugins können Build-Zeit-Code via Lifecycle Hooks ausführen — bei Fremd-Plugins als potenziellen Supply-Chain-Aspekt prüfen

---

## Using Plugins (NativePHP Mobile v3, Sektion: Plugins)

<https://nativephp.com/docs/mobile/3/plugins/using-plugins>

Die Seite beschreibt den kompletten Lebenszyklus von Plugins in NativePHP Mobile v3: Installation, Registrierung, Verifikation, Build, Nutzung, Events, Berechtigungen und Deinstallation.

1) Installation: Plugins werden ganz normal via Composer installiert (`composer require vendor/nativephp-plugin-name`). Der PHP-Service-Provider wird von Laravel automatisch erkannt (Package Discovery), ABER der native Code (Swift/Kotlin) wird erst in Builds eingebunden, nachdem das Plugin explizit registriert wurde.

2) Premium-Plugins: Erfordern drei Schritte — (a) das NativePHP-Plugin-Composer-Repository hinzufügen (`composer config repositories.nativephp-plugins composer https://plugins.nativephp.com`), (b) HTTP-Basic-Auth-Zugangsdaten hinterlegen (`composer config http-basic.plugins.nativephp.com <deine-email> <your-license-key>`; die Zugangsdaten findet man im "Purchased Plugins"-Dashboard), (c) dann normales `composer require`.

3) Registrierung: Zuerst den NativeServiceProvider publishen (`php artisan vendor:publish --tag=nativephp-plugins-provider`), dann das Plugin registrieren (`php artisan native:plugin:register vendor/nativephp-plugin-name`). Dadurch wird das Plugin in `app/Providers/NativeServiceProvider.php` eingetragen — erst dann wird der native Code beim Build kompiliert.

4) Verifikation: `php artisan native:plugin:list` zeigt Plugin-Name, Version und bereitgestellte Features (Bridge Functions, Events, Hooks) sowie die vom Plugin benötigten Berechtigungen.

5) Rebuild: Nach Registrierung muss die App neu gebaut werden mit `php artisan native:run` — dabei wird der native Swift- und Kotlin-Code des Plugins automatisch mitkompiliert.

6) Nutzung im PHP-Code: Plugins exponieren typischerweise eine Facade, z. B. `use Vendor\PluginName\Facades\PluginName;` und Aufrufe wie `$result = PluginName::doSomething(['option' => 'value']);`.

7) Events: Auf native Plugin-Events lauscht man (z. B. in Livewire-Komponenten) mit dem PHP-Attribut `#[OnNative(SomethingCompleted::class)]` aus `Native\Mobile\Attributes\OnNative` auf einer Handler-Methode wie `public function handleCompletion($result)`. Die Event-Klassen liegen im Plugin-Namespace (z. B. `Vendor\PluginName\Events\SomethingCompleted`). Für verfügbare Methoden, Events und nötige Berechtigungen ist immer die jeweilige Plugin-Dokumentation maßgeblich.

8) Permissions: Vom Plugin benötigte native Berechtigungen (AndroidManifest/Info.plist) werden im Plugin-Manifest deklariert und beim Build AUTOMATISCH in die App-Konfiguration gemerged — kein manuelles Editieren nötig; Anzeige via `native:plugin:list`.

9) Deinstallation: `php artisan native:plugin:uninstall vendor/nativephp-plugin-name` entfernt den Eintrag aus dem NativeServiceProvider, deinstalliert das Composer-Paket, entfernt ggf. das Path-Repository aus `composer.json` und löscht optional das Plugin-Quellverzeichnis. Flags: `--force` (Bestätigungen überspringen), `--keep-files` (Quellverzeichnis lokaler Plugins behalten).

10) Ökosystem: Fertige offizielle Plugins gibt es im "NativePHP Plugin Marketplace"; mit dem Plugin Dev Kit lassen sich eigene Plugins erstellen (eigene Doku-Sektion).

Relevanz für den Implementierungsplan (Laravel + Livewire + Flux UI): Plugin-Workflow ist immer Composer-Install -> Provider publishen -> `native:plugin:register` -> `native:run` (Rebuild zwingend, da nativer Code kompiliert wird). Livewire-Komponenten empfangen native Ergebnisse asynchron über `#[OnNative]`-Event-Handler, nicht über synchrone Rückgabewerte allein.

### Befehle

```bash
composer require vendor/nativephp-plugin-name
composer config repositories.nativephp-plugins composer https://plugins.nativephp.com
composer config http-basic.plugins.nativephp.com <email> your-license-key
composer require vendor/nativephp-premium-plugin
php artisan vendor:publish --tag=nativephp-plugins-provider
php artisan native:plugin:register vendor/nativephp-plugin-name
php artisan native:plugin:list
php artisan native:run
php artisan native:plugin:uninstall vendor/nativephp-plugin-name
php artisan native:plugin:uninstall vendor/nativephp-plugin-name --force
php artisan native:plugin:uninstall vendor/nativephp-plugin-name --keep-files
```

### APIs

- Vendor\PluginName\Facades\PluginName — Plugin-Facade; native Funktionen aufrufen, z. B. $result = PluginName::doSomething(['option' => 'value']);
- Native\Mobile\Attributes\OnNative — PHP-Attribut zum Lauschen auf native Plugin-Events: #[OnNative(SomethingCompleted::class)] auf einer Handler-Methode
- Vendor\PluginName\Events\SomethingCompleted — Beispiel einer Plugin-Event-Klasse, die an den #[OnNative]-Handler dispatcht wird (Handler-Signatur: public function handleCompletion($result))
- app/Providers/NativeServiceProvider.php — publizierter Provider, in dem registrierte Plugins eingetragen werden (via native:plugin:register)
- Plugin-Features laut native:plugin:list: Bridge Functions, Events, Hooks

### Konfiguration

- Composer-Repository für Premium-Plugins: repositories.nativephp-plugins -> https://plugins.nativephp.com (composer.json)
- HTTP-Basic-Auth für plugins.nativephp.com: E-Mail + License-Key (composer config http-basic.plugins.nativephp.com; Daten aus dem 'Purchased Plugins'-Dashboard)
- app/Providers/NativeServiceProvider.php — Registrierungsstelle für Plugins (wird via vendor:publish --tag=nativephp-plugins-provider erzeugt)
- Native Berechtigungen (AndroidManifest.xml / Info.plist): werden im Plugin-Manifest deklariert und beim Build automatisch in die App-Konfiguration gemerged — keine manuelle Pflege nötig
- composer.json: Path-Repositories lokaler Plugins werden bei native:plugin:uninstall automatisch entfernt

### Stolperfallen

- Composer-Install allein reicht NICHT: Der native Swift/Kotlin-Code wird erst in Builds eingebunden, nachdem das Plugin explizit mit native:plugin:register registriert wurde
- Vor der ersten Plugin-Registrierung muss der NativeServiceProvider publiziert werden (vendor:publish --tag=nativephp-plugins-provider)
- Nach Registrierung/Deinstallation eines Plugins ist ein Rebuild der App zwingend (php artisan native:run), da nativer Code kompiliert wird
- Premium-Plugins erfordern einen Lizenz-Key als HTTP-Basic-Passwort gegen plugins.nativephp.com; Zugangsdaten stehen im 'Purchased Plugins'-Dashboard
- Verfügbare Methoden, Events und erforderliche Berechtigungen sind pluginspezifisch — immer die Doku des jeweiligen Plugins konsultieren
- Berechtigungen werden automatisch aus dem Plugin-Manifest in die App-Konfiguration übernommen; sichtbar via native:plugin:list (wichtig für Store-Review/Privacy-Angaben)
- native:plugin:uninstall löscht optional auch das Quellverzeichnis lokaler Plugins — mit --keep-files verhindern; --force überspringt Bestätigungen
- Native Ergebnisse kommen asynchron als Events zurück (#[OnNative]) — Livewire-Handler entsprechend asynchron designen
- Offizielle/fertige Plugins über den NativePHP Plugin Marketplace; eigene Plugins via Plugin Dev Kit (separate Doku-Sektion)

---

## NativePHP Mobile v3 — Plugins: Creating Plugins

<https://nativephp.com/docs/mobile/3/plugins/creating-plugins>

Die Seite beschreibt, wie man eigene Plugins für NativePHP Mobile v3 erstellt, strukturiert, lokal entwickelt, validiert und registriert.

SCAFFOLDING: `php artisan native:plugin:create` startet einen interaktiven Wizard (Name, Namespace, Feature-Optionen) und erzeugt das Standard-Layout: composer.json (Package-Metadaten), nativephp.json (Plugin-Manifest), src/ mit MyPluginServiceProvider.php, MyPlugin.php (Hauptklasse), Facades/MyPlugin.php, Events/SomethingHappened.php und Commands/, sowie resources/ mit android/src/ (Kotlin-Bridge-Funktionen), ios/Sources/ (Swift-Bridge-Funktionen) und js/ (JavaScript-Library-Stubs).

NATIVE BRIDGE (Android/Kotlin): Bridge-Funktionen sind Klassen, die `com.nativephp.mobile.bridge.BridgeFunction` implementieren mit `override fun execute(parameters: Map<String, Any>): Map<String, Any>` und z.B. `BridgeResponse.success(mapOf("status" to "done"))` zurückgeben. Jede Kotlin-Datei MUSS eine package-Deklaration haben; der Compiler platziert die Datei anhand des Packages (z.B. `package com.myvendor.plugins.myplugin` → `app/src/main/java/com/myvendor/plugins/myplugin/MyPluginFunctions.kt`). Swift-Beispiele zeigt die Seite nicht (nur Ablageort resources/ios/Sources/).

COMPOSER.JSON: Muss `"type": "nativephp-plugin"` haben; unter `extra.laravel.providers` wird der ServiceProvider eingetragen, unter `extra.nativephp.manifest` der Pfad zum Manifest ("nativephp.json").

MANIFEST (nativephp.json): Pflichtfeld `namespace` (für Code-Generierung). Optional: `bridge_functions` (Array von Mappings mit "name" z.B. "MyPlugin.DoSomething", "ios" z.B. "MyPluginFunctions.DoSomething", "android" voll qualifiziert z.B. "com.nativephp.plugins.myplugin.MyPluginFunctions.DoSomething"), `events` (PHP-Event-Klassen, FQCN), `android.permissions` (z.B. android.permission.CAMERA), `android.features`, `android.dependencies` (Gradle, z.B. implementation: ["com.google.mlkit:barcode-scanning:17.2.0"]), `android.repositories` (Maven), `android.activities` / `android.services` / `android.receivers` / `android.providers` / `android.meta_data`, `android.min_version`, `android.init_function` (native Funktion beim App-Start), `ios.info_plist` (z.B. NSCameraUsageDescription), `ios.dependencies` (Swift Packages / CocoaPods, z.B. pods: [{"name": "GoogleMLKit/BarcodeScanning", "version": "~> 4.0"}]), `ios.background_modes` (UIBackgroundModes), `ios.entitlements`, `ios.capabilities`, `ios.min_version`, `ios.init_function`, sowie `assets` (deklaratives Asset-Kopieren), `hooks` (Lifecycle-Hook-Commands) und `secrets` (erforderliche env-Variablen) — für die letzten drei gibt die Seite keine JSON-Beispiele.

LOKALE ENTWICKLUNG: Path-Repository in der App-composer.json ({"type": "path", "url": "../packages/my-plugin"}), dann `composer require vendor/my-plugin`. PHP-Änderungen wirken sofort; bei signifikanten Native-Code-Änderungen ist `php artisan native:install --force` (Rebuild) nötig. Manifest früh und oft mit `php artisan native:plugin:validate` prüfen.

REGISTRIERUNG: Plugins müssen explizit registriert werden (Sicherheitsmaßnahme gegen unkontrollierte transitive Dependencies). Erstmalig `php artisan vendor:publish --tag=nativephp-plugins-provider` → erzeugt app/Providers/NativeServiceProvider.php mit Methode `public function plugins(): array` (gibt Array der Plugin-ServiceProvider-Klassen zurück). `php artisan native:plugin:register vendor/plugin-name` trägt den Provider ein, `--remove` entfernt ihn; `php artisan native:plugin:list` (mit `--all` für alle installierten) listet Plugins.

JAVASCRIPT-LIBRARY: Plugins liefern JS-Stubs (resources/js/myPlugin.js), die Bridge-Funktionen via POST auf `/_native/api/call` aufrufen: fetch mit JSON-Body `{ method: "MyPlugin.DoSomething", params }`, Header Content-Type: application/json; exportierte async-Funktionen wie `doSomething(options)`. Ein direkter PHP→Bridge-Aufruf wird auf dieser Seite nicht gezeigt; PHP-Klassen (Facade/Hauptklasse) werden nur in der Struktur genannt, ohne Code. Event-Broadcasting vom Native-Code wird auf eine separate Events-Seite (/docs/mobile/3/plugins/events) verlinkt.

AI-TOOLING: `php artisan native:plugin:install-agent` installiert Entwicklungs-Agenten (kotlin-android-expert, swift-ios-expert, js-bridge-expert, plugin-writer, plugin-docs-writer; Optionen --all, --force). `php artisan native:plugin:boost` generiert Laravel-Boost-Guidelines unter resources/boost/guidelines/core.blade.php.

Relevanz für die geplante Laravel+Livewire+Flux-App: Eigene native Funktionen (Kamera, Scanner etc.) werden als Plugin mit Kotlin/Swift-Bridge-Funktionen + nativephp.json-Manifest gekapselt; Permissions/Info.plist-Einträge/Gradle- und Pod-Dependencies deklariert man im Manifest, nicht manuell in AndroidManifest/Xcode.

### Befehle

```bash
php artisan native:plugin:create
composer require vendor/my-plugin
php artisan native:install --force
php artisan native:plugin:validate
php artisan vendor:publish --tag=nativephp-plugins-provider
php artisan native:plugin:register vendor/plugin-name
php artisan native:plugin:register vendor/plugin-name --remove
php artisan native:plugin:list
php artisan native:plugin:list --all
php artisan native:plugin:install-agent
php artisan native:plugin:install-agent --all
php artisan native:plugin:install-agent --force
php artisan native:plugin:boost
```

### APIs

- Kotlin: com.nativephp.mobile.bridge.BridgeFunction — Interface für Bridge-Funktionen; implementiert `override fun execute(parameters: Map<String, Any>): Map<String, Any>`
- Kotlin: com.nativephp.mobile.bridge.BridgeResponse — Antwort-Helfer, z.B. `BridgeResponse.success(mapOf("status" to "done"))`
- PHP: app/Providers/NativeServiceProvider — Methode `public function plugins(): array` gibt die registrierten Plugin-ServiceProvider-Klassen zurück (z.B. \Vendor\PluginName\PluginNameServiceProvider::class)
- PHP (Plugin-Struktur, nur Skeleton ohne Code auf der Seite): src/MyPluginServiceProvider.php, src/MyPlugin.php (Hauptklasse), src/Facades/MyPlugin.php (Facade), src/Events/SomethingHappened.php (Event), src/Commands/
- PHP-Events: im Manifest unter "events" als FQCN deklariert (z.B. "Vendor\\MyPlugin\\Events\\SomethingHappened"); Broadcasting-Details auf separater Seite /docs/mobile/3/plugins/events
- JS: HTTP-Bridge-Endpoint POST /_native/api/call mit JSON-Body { method: "MyPlugin.DoSomething", params } (Content-Type: application/json)
- JS: Plugin-Stub-Pattern in resources/js/myPlugin.js — `async function bridgeCall(method, params = {})` via fetch; `export async function doSomething(options = {})` ruft bridgeCall('MyPlugin.DoSomething', options)
- Manifest bridge_functions-Mapping: { "name": "MyPlugin.DoSomething", "ios": "MyPluginFunctions.DoSomething", "android": "com.nativephp.plugins.myplugin.MyPluginFunctions.DoSomething" }

### Konfiguration

- composer.json (Plugin): "type": "nativephp-plugin" ist PFLICHT; extra.laravel.providers = ["Vendor\\MyPlugin\\MyPluginServiceProvider"]; extra.nativephp.manifest = "nativephp.json"
- composer.json (App, lokale Entwicklung): repositories: [{ "type": "path", "url": "../packages/my-plugin" }]
- nativephp.json: namespace (Pflicht, für Code-Generierung)
- nativephp.json: bridge_functions[] — Name→iOS-/Android-Klassen-Mapping
- nativephp.json: events[] — PHP-Event-Klassen (FQCN)
- nativephp.json android.*: permissions (z.B. "android.permission.CAMERA"), features (uses-feature), dependencies (Gradle, z.B. implementation: ["com.google.mlkit:barcode-scanning:17.2.0"]), repositories (Maven), activities, services, receivers (Broadcast Receiver), providers (Content Provider), meta_data, min_version (Min-SDK), init_function (native Funktion beim App-Start)
- nativephp.json ios.*: info_plist (z.B. NSCameraUsageDescription: "Camera is used for scanning"), dependencies (Swift Packages + pods, z.B. {"name": "GoogleMLKit/BarcodeScanning", "version": "~> 4.0"}), background_modes (UIBackgroundModes), entitlements, capabilities, min_version, init_function
- nativephp.json: assets (deklaratives Asset-Kopieren), hooks (Lifecycle-Hook-Commands), secrets (erforderliche env-Variablen) — auf der Seite ohne JSON-Beispiel
- Generierte Datei: app/Providers/NativeServiceProvider.php (via vendor:publish --tag=nativephp-plugins-provider)
- Generierte Boost-Guidelines: resources/boost/guidelines/core.blade.php (via native:plugin:boost)

### Stolperfallen

- Plugins werden NICHT automatisch aktiviert: explizite Registrierung im NativeServiceProvider::plugins() ist eine bewusste Sicherheitsmaßnahme gegen unkontrollierte transitive Dependencies — ohne native:plugin:register läuft kein nativer Plugin-Code
- composer.json des Plugins muss zwingend "type": "nativephp-plugin" haben, sonst wird es nicht als Plugin erkannt
- Jede Kotlin-Datei braucht eine package-Deklaration; sie bestimmt den Ablageort im Android-Projekt (package com.myvendor.plugins.myplugin → app/src/main/java/com/myvendor/plugins/myplugin/...)
- PHP-Code-Änderungen wirken sofort, aber Native-Code-Änderungen (Kotlin/Swift, Manifest-Permissions, Dependencies) erfordern Rebuild via `php artisan native:install --force`
- Manifest früh und oft mit `php artisan native:plugin:validate` prüfen, um Fehler vor dem Build zu finden
- Native Berechtigungen/Dependencies werden deklarativ im nativephp.json gepflegt (AndroidManifest-Permissions, Info.plist-Keys, Gradle/CocoaPods) — nicht manuell in den nativen Projekten
- Die Seite zeigt KEINE Swift-Code-Beispiele, KEINE vollständigen PHP-Klassen (Facade/ServiceProvider-Implementierung), KEINEN PHP→Bridge-Aufruf und KEINE Beispiele für assets/hooks/secrets/init_function — Details zu Events stehen auf der separaten Seite /docs/mobile/3/plugins/events
- Lizenzhinweise (NativePHP-Mobile-Lizenz) und Tool-Voraussetzungen (Xcode/Android Studio-Versionen) werden auf dieser Seite nicht genannt — vermutlich in der allgemeinen Installations-Doku
- Der JS-Bridge-Aufruf läuft über einen lokalen HTTP-Endpoint POST /_native/api/call — relevant für Livewire-Integration (z.B. Aufruf aus Alpine/JS und Rückgabe als JSON)

---

## Bridge Functions (NativePHP Mobile v3, Sektion "Plugins")

<https://nativephp.com/docs/mobile/3/plugins/bridge-functions>

Die Seite erklärt, wie Bridge Functions in NativePHP-Mobile-Plugins PHP-Code mit nativem Plattformcode (Swift/Kotlin) verbinden.

FUNKTIONSWEISE ("How Bridge Functions Work"): PHP ruft die globale Funktion nativephp_call('MyPlugin.DoSomething', $params) auf -> die native Bridge sucht die unter diesem Namen registrierte Funktion -> der native Code wird ausgeführt und antwortet -> PHP erhält das Ergebnis (JSON).

DEKLARATION ("Declaring Bridge Functions"): Jede Bridge Function wird in der Plugin-Manifestdatei nativephp.json unter dem Key "bridge_functions" deklariert, mit Plattform-Mappings:
{
  "bridge_functions": [
    {
      "name": "MyPlugin.DoSomething",
      "ios": "MyPluginFunctions.DoSomething",
      "android": "com.myvendor.plugins.myplugin.MyPluginFunctions.DoSomething",
      "description": "Does something useful"
    }
  ]
}

NAMENSKONVENTION: "name" = eindeutige ID im Format Plugin.Funktion (wird von PHP verwendet); "ios" = Swift im Format EnumName.ClassName; "android" = vollqualifizierter Kotlin-Klassenpfad inkl. Vendor-Package.

SWIFT-IMPLEMENTIERUNG (iOS): Dateien liegen in resources/ios/Sources/. Muster: ein enum (z. B. MyPluginFunctions) mit innerer Klasse, die das Protokoll BridgeFunction implementiert: func execute(parameters: [String: Any]) throws -> [String: Any]; Parameter kommen als Dictionary; Antwort via BridgeResponse.success(data: [...]) bzw. BridgeResponse.error(message: ...).

KOTLIN-IMPLEMENTIERUNG (Android): Dateien liegen in resources/android/src/. Muster: package com.myvendor.plugins.myplugin; Imports com.nativephp.mobile.bridge.BridgeFunction und com.nativephp.mobile.bridge.BridgeResponse; object MyPluginFunctions { class DoSomething : BridgeFunction { override fun execute(parameters: Map<String, Any>): Map<String, Any> { ... return BridgeResponse.success(mapOf("result" to "completed", ...)) } } }. Das package-Statement bestimmt die Dateiplatzierung im generierten Projekt.

PHP-AUFRUF ("Calling from PHP"): Im Plugin eine Facade-/Service-Methode bauen, die defensiv prüft, ob die native Laufzeit vorhanden ist:
public function doSomething(array $options = []): mixed {
  if (function_exists('nativephp_call')) {
    $result = nativephp_call('MyPlugin.DoSomething', json_encode($options));
    return json_decode($result)?->data;
  }
  return null;
}
Parameter werden als JSON-String übergeben, die Antwort als JSON dekodiert; Nutzdaten liegen unter ->data.

FEHLERBEHANDLUNG: Nativ via BridgeResponse.error(message: "Something went wrong") (Swift) bzw. BridgeResponse.error("Something went wrong") (Kotlin); die Fehlermeldung ist in PHP über die Response verfügbar.

ABSCHLUSS ("Official Plugins & Dev Kit"): Verweise auf den Plugin Marketplace (fertige Plugins ohne eigene Kotlin/Swift-Entwicklung), das Plugin Dev Kit (native Plugin-Entwicklung mit Claude-Code-Unterstützung) und NativePHP Ultra (alle Plugins, Teams & Priority Support ab 35 USD/Monat). Navigationskontext: vorherige Seite "Creating Plugins", nächste Seite "Events" (/docs/mobile/3/plugins/events); native Berechtigungen werden separat unter /docs/mobile/3/plugins/permissions-dependencies behandelt. Die Seite enthält keine CLI-Befehle, keine env-Variablen und keine Hinweis-/Warnboxen.

### APIs

- nativephp_call(string $name, string $jsonParams): string — globale PHP-Funktion (nur in der nativen Laufzeit definiert), ruft eine registrierte Bridge Function auf; Parameter als JSON-String (json_encode), Rückgabe JSON-String mit Nutzdaten unter ->data (json_decode($result)?->data)
- function_exists('nativephp_call') — empfohlener Guard im PHP-Plugin-Code, um außerhalb der nativen App (z. B. Web/Tests) sauber zu degradieren (return null)
- BridgeFunction (Swift-Protokoll) — func execute(parameters: [String: Any]) throws -> [String: Any]; Implementierung als Klasse innerhalb eines Enums (EnumName.ClassName) in resources/ios/Sources/
- BridgeResponse.success(data:) / BridgeResponse.error(message:) (Swift) — Standard-Antwortformat der iOS-Bridge
- com.nativephp.mobile.bridge.BridgeFunction (Kotlin-Interface) — override fun execute(parameters: Map<String, Any>): Map<String, Any>; Implementierung als Klasse in einem object innerhalb des Vendor-Packages in resources/android/src/
- com.nativephp.mobile.bridge.BridgeResponse — BridgeResponse.success(mapOf(...)) / BridgeResponse.error("...") (Kotlin)
- Plugin-Facade-Muster (PHP) — eigene Klasse (z. B. MyPlugin::doSomething(array $options = []): mixed) kapselt den nativephp_call-Aufruf

### Konfiguration

- nativephp.json (Plugin-Manifest) — Key "bridge_functions": Array von Objekten mit "name" (eindeutige ID, Format Plugin.Funktion, von PHP verwendet), "ios" (Swift EnumName.ClassName), "android" (vollqualifizierter Kotlin-Klassenpfad inkl. Vendor-Package), "description"
- Dateiablage iOS: resources/ios/Sources/ (Swift-Quellen des Plugins)
- Dateiablage Android: resources/android/src/ (Kotlin-Quellen; das package-Statement bestimmt die Platzierung im generierten Projekt)
- Keine env-Variablen, keine config/*.php-Keys und keine AndroidManifest-/Info.plist-Berechtigungen auf dieser Seite — Berechtigungen/Abhängigkeiten werden separat unter /docs/mobile/3/plugins/permissions-dependencies dokumentiert

### Stolperfallen

- nativephp_call() existiert nur in der nativen Mobile-Laufzeit — PHP-Code muss mit function_exists('nativephp_call') absichern, sonst Fatal Error im Web-/Test-Kontext
- Parameter werden als JSON-String übergeben (json_encode) und die Antwort muss mit json_decode geparst werden; Nutzdaten liegen im Feld ->data der Response
- Strikte Namenskonvention: "ios" muss exakt EnumName.ClassName des Swift-Codes entsprechen, "android" der vollqualifizierte Kotlin-Klassenpfad mit Vendor-Package — Abweichungen führen dazu, dass die Bridge die Funktion nicht findet
- Swift: BridgeFunction-Protokoll implementieren und immer mit BridgeResponse.success()/.error() antworten; Kotlin: Interface aus com.nativephp.mobile.bridge implementieren
- Kotlin: das package-Statement bestimmt, wohin die Datei im generierten Android-Projekt kopiert wird
- Fehler aus nativem Code (BridgeResponse.error) kommen als Fehlermeldung in der Response bei PHP an — eigene Fehlerauswertung im PHP-Wrapper nötig
- Asynchrone Bridge Functions, Event-Broadcasting (nativ -> PHP/JS) und native Berechtigungen werden auf dieser Seite NICHT behandelt (siehe Folgeseiten "Events" und "Permissions & Dependencies")
- Lizenz-/Kostenhinweis: Plugin Marketplace bietet fertige Plugins; NativePHP Ultra (alle Plugins, Teams, Priority Support) kostet ab 35 USD/Monat — eigene Bridge Functions erfordern dagegen Swift- und Kotlin-Kenntnisse
- Die Seite enthält keine CLI-Befehle (kein php artisan ...) — Plugin-Scaffolding wird auf der vorherigen Seite "Creating Plugins" beschrieben

---

## NativePHP Mobile v3 — Plugins: Events

<https://nativephp.com/docs/mobile/3/plugins/events>

Die Seite beschreibt, wie Plugin-Events aus nativem Code (Swift/Kotlin) an PHP/Livewire gesendet werden. Motivation: Viele native Operationen sind asynchron (ML-Inferenz, Sensor-Messungen, Hintergrund-Tasks); Events sind der Rückkanal, über den nativer Code Ergebnisse an PHP liefert — sie werden vom nativen Code dispatcht und von Livewire-Komponenten empfangen.

1) Declaring Events: Event-Klassen müssen im Plugin-Manifest (JSON) unter dem Key "events" als vollqualifizierte Klassennamen deklariert werden, z. B. ["Vendor\\MyPlugin\\Events\\ProcessingComplete", "Vendor\\MyPlugin\\Events\\ProcessingError"].

2) Creating Event Classes: Events sind einfache PHP-Klassen mit den Traits Dispatchable und SerializesModels; Payload-Felder werden als Public-Promoted-Constructor-Properties definiert (z. B. public string $result, public ?string $id = null). Wichtig: Events benötigen KEIN ShouldBroadcast und keine Channel-Konfiguration — NativePHP übernimmt den Dispatch direkt (kein Echo/Pusher/Reverb nötig).

3) Swift Event Dispatching: Payload als [String: Any]-Dictionary bauen und über LaravelBridge.shared.send?("Vendor\\MyPlugin\\Events\\ProcessingComplete", payload) an PHP senden. Läuft synchron auf dem Main Thread; bei Bedarf in DispatchQueue.main.async wrappen.

4) Kotlin Event Dispatching: Payload als org.json.JSONObject bauen und via Handler(Looper.getMainLooper()).post { NativeActionCoordinator.dispatchEvent(activity, "Vendor\\MyPlugin\\Events\\ProcessingComplete", payload.toString()) } dispatchen — zwingend auf dem Main Thread.

5) Kritische Warnung "Always Use the Main Thread": Der Event-Dispatch erfolgt per JavaScript-Injection in die WebView; geschieht das nicht auf dem Main/UI-Thread, schlägt es STILL fehl (kein Fehler, Event kommt nie an).

6) Abschluss-Hinweis "Official Plugins & Dev Kit": Verweis auf fertige Plugins bzw. den Dev Kit zum Bau eigener Plugins im NativePHP Plugin Marketplace (https://nativephp.com/plugins).

Nicht auf dieser Seite behandelt (steht auf Nachbarseiten): das Empfangen der Events in Livewire-Komponenten/JavaScript, CLI-Befehle, env-/config-Einstellungen, native Berechtigungen. Navigation: vorherige Seite "Bridge Functions" (/docs/mobile/3/plugins/bridge-functions), nächste Seite "Lifecycle Hooks" (/docs/mobile/3/plugins/lifecycle-hooks).

### APIs

- PHP: Event-Klassen in Vendor\MyPlugin\Events\* — einfache Klassen mit Traits Illuminate\Foundation\Events\Dispatchable und Illuminate\Queue\SerializesModels; Payload über public Constructor-Promotion (z. B. public string $result, public ?string $id = null)
- PHP: KEIN ShouldBroadcast-Interface und keine Channel-Konfiguration nötig — NativePHP dispatcht direkt
- Swift: LaravelBridge.shared.send?("Vendor\\MyPlugin\\Events\\ProcessingComplete", payload) — payload als [String: Any]; läuft synchron auf dem Main Thread, ggf. in DispatchQueue.main.async wrappen
- Kotlin: NativeActionCoordinator.dispatchEvent(activity, "Vendor\\MyPlugin\\Events\\ProcessingComplete", payload.toString()) — payload als org.json.JSONObject; Dispatch über Handler(Looper.getMainLooper()).post { ... }
- Empfänger: Events werden von Livewire-Komponenten empfangen (Empfangs-Syntax ist nicht auf dieser Seite dokumentiert)

### Konfiguration

- Plugin-Manifest (JSON): Key "events" mit Array vollqualifizierter PHP-Event-Klassennamen, z. B. {"events": ["Vendor\\MyPlugin\\Events\\ProcessingComplete", "Vendor\\MyPlugin\\Events\\ProcessingError"]} — Deklaration ist Pflicht, damit Events vom nativen Code dispatcht werden können

### Stolperfallen

- KRITISCH: Event-Dispatch erfolgt per JavaScript-Injection in die WebView und MUSS auf dem Main/UI-Thread passieren — sonst schlägt er STILL fehl (kein Fehler, Event geht verloren). Kotlin: Handler(Looper.getMainLooper()).post; Swift: ggf. DispatchQueue.main.async
- Event-Klassen müssen im Plugin-Manifest unter "events" deklariert sein (vollqualifizierte Klassennamen mit doppelten Backslashes im JSON)
- Kein Broadcasting-Stack nötig: ShouldBroadcast, Channels, Echo/Pusher/Reverb entfallen — NativePHP übernimmt den Dispatch direkt; vorhandene Broadcasting-Konzepte nicht auf diese Events übertragen
- Events sind das Mittel für asynchrone native Operationen (ML-Inferenz, Sensoren, Background-Tasks) — der Rückkanal nativ → PHP/Livewire; synchrone Rückgaben laufen dagegen über Bridge Functions (vorherige Doku-Seite)
- Die Seite dokumentiert NUR die Dispatch-Seite (nativ → PHP); wie Livewire/JS die Events konsumiert, CLI-Befehle, env-Variablen und native Berechtigungen stehen auf anderen Seiten (Bridge Functions davor, Lifecycle Hooks danach)
- Hinweis der Doku: Statt Eigenbau können fertige Plugins bzw. der (kommerzielle) Dev Kit aus dem NativePHP Plugin Marketplace (https://nativephp.com/plugins) genutzt werden

---

## Lifecycle Hooks (NativePHP Mobile v3, Sektion: Plugins)

<https://nativephp.com/docs/mobile/3/plugins/lifecycle-hooks>

Die Seite beschreibt Lifecycle Hooks fuer NativePHP-Mobile-Plugins: Hooks lassen ein Plugin zu bestimmten Zeitpunkten des Build-Prozesses Code ausfuehren, z. B. zum Herunterladen von ML-Modellen, Kopieren von Assets oder fuer Validierungen. Es gibt vier Hooks: `pre_compile` (vor der Kompilierung des nativen Codes), `post_compile` (nach der Kompilierung, vor dem Build), `copy_assets` (beim Kopieren der Assets in die nativen Projekte; laeuft NACH dem deklarativen Asset-Kopieren) und `post_build` (nach einem erfolgreichen Build).

Hook-Commands werden mit dem interaktiven Scaffolding-Befehl `php artisan native:plugin:make-hook` erzeugt; der Befehl fuehrt durch die Auswahl des Plugins und der zu erstellenden Hooks, generiert die Command-Klasse, aktualisiert das Manifest (`nativephp.json`) und registriert den Command im Service Provider des Plugins.

Ein Hook-Command ist ein Artisan-Command, der `Native\Mobile\Plugins\Commands\NativePluginHookCommand` erweitert, eine `$signature` im Schema `nativephp:<plugin>:<hook-name>` traegt und in `handle(): int` am Ende `self::SUCCESS` zurueckgibt. Beispiel aus der Doku (CopyAssetsCommand): bei Android `$this->copyToAndroidAssets('models/model.tflite', 'models/model.tflite')`, bei iOS `$this->copyToIosBundle('models/model.mlmodel', 'models/model.mlmodel')`.

Verfuegbare Helper der Basisklasse: Plattformerkennung `$this->platform()` (liefert 'ios' oder 'android'), `$this->isIos()`, `$this->isAndroid()`; Pfade `$this->buildPath()` (Pfad zum nativen Projekt), `$this->pluginPath()` (Pfad zum Plugin-Paket), `$this->appId()` (Bundle-ID der App); Dateioperationen `copyToAndroidAssets($src, $dest)`, `copyToIosBundle($src, $dest)`, `downloadIfMissing($url, $dest)`, `unzip($zipPath, $extractTo)`. Zusaetzlich stehen alle Laravel-Console-Helper zur Verfuegung (`$this->info()`, `$this->warn()`, Progress Bars).

Hooks werden im Plugin-Manifest `nativephp.json` unter dem Key "hooks" deklariert, indem Hook-Name auf die Command-Signatur gemappt wird, z. B. {"hooks": {"copy_assets": "nativephp:my-plugin:copy-assets", "pre_compile": "nativephp:my-plugin:pre-compile"}}.

Wichtige Leitlinie: Fuer einfaches Datei-Kopieren soll das deklarative `assets`-Feld im Manifest genutzt werden; der `copy_assets`-Hook ist nur fuer dynamisches Verhalten gedacht (Downloads, Entpacken von Archiven, bedingtes Kopieren).

Komplettes Beispiel der Seite ("Downloading an ML Model"): in `handle()` wird `$modelPath = $this->pluginPath() . '/resources/models/model.tflite'` gebildet, per `downloadIfMissing('https://example.com/models/v2/model.tflite', $modelPath)` nur bei fehlendem lokalen Cache heruntergeladen und dann plattformabhaengig via `copyToAndroidAssets(...)` bzw. `copyToIosBundle(...)` ins jeweilige Zielprojekt kopiert (mit `$this->info(...)`-Ausgaben).

Seitennavigation: vorherige Seite "Events", naechste Seite "Permissions & Dependencies". Die Seite verweist ausserdem auf Plugin Marketplace und Plugin Dev Kit. Keine env-Variablen, nativen Berechtigungen oder Lizenzhinweise auf dieser Seite.

### Befehle

```bash
php artisan native:plugin:make-hook
```

### APIs

- Native\Mobile\Plugins\Commands\NativePluginHookCommand — Basisklasse fuer Plugin-Hook-Commands; eigene Klasse erweitert sie, definiert $signature (Schema 'nativephp:<plugin>:<hook>') und handle(): int mit Rueckgabe self::SUCCESS
- $this->platform() — liefert 'ios' oder 'android'
- $this->isIos() / $this->isAndroid() — Boolean-Plattform-Checks
- $this->buildPath() — Pfad zum generierten nativen Projekt
- $this->pluginPath() — Pfad zum Plugin-Paket
- $this->appId() — Bundle-ID der App
- $this->copyToAndroidAssets($src, $dest) — kopiert Datei in die Android-Assets
- $this->copyToIosBundle($src, $dest) — kopiert Datei ins iOS-Bundle
- $this->downloadIfMissing($url, $dest) — laedt Datei nur herunter, wenn lokal nicht vorhanden (Caching)
- $this->unzip($zipPath, $extractTo) — entpackt ein Archiv
- Laravel-Console-Helper voll verfuegbar: $this->info(), $this->warn(), Progress Bars
- Hook-Typen: pre_compile (vor nativer Kompilierung), post_compile (nach Kompilierung, vor Build), copy_assets (beim Asset-Kopieren, nach deklarativem Kopieren), post_build (nach erfolgreichem Build)

### Konfiguration

- nativephp.json (Plugin-Manifest) — Key "hooks": Mapping Hook-Name -> Command-Signatur, z. B. {"hooks": {"copy_assets": "nativephp:my-plugin:copy-assets", "pre_compile": "nativephp:my-plugin:pre-compile"}}
- nativephp.json — deklaratives "assets"-Feld fuer einfaches Datei-Kopieren (bevorzugt gegenueber copy_assets-Hook)
- Keine env-Variablen und keine nativen Berechtigungen (AndroidManifest/Info.plist) auf dieser Seite dokumentiert

### Stolperfallen

- Fuer einfaches Datei-Kopieren das deklarative assets-Feld im Manifest verwenden; copy_assets-Hook nur bei dynamischem Verhalten (Downloads, Unzip, bedingtes Kopieren)
- copy_assets laeuft NACH dem deklarativen Asset-Kopieren — deklarative Assets werden zuerst verarbeitet
- Hooks muessen im Manifest nativephp.json deklariert sein, sonst werden sie nicht ausgefuehrt; native:plugin:make-hook erledigt Manifest-Update und Service-Provider-Registrierung automatisch
- native:plugin:make-hook ist interaktiv (Auswahl von Plugin und Hooks per Prompt); keine dokumentierten Argumente/Optionen
- handle() muss self::SUCCESS (int) zurueckgeben
- Diese Doku-Seite richtet sich an Plugin-Entwickler (Plugin Dev Kit), nicht an reine App-Entwickler; Kontext: Events (vorher) und Permissions & Dependencies (nachher)
- Keine expliziten Versions-, Lizenz- oder Voraussetzungshinweise auf dieser Seite

---

## Permissions & Dependencies (NativePHP Mobile v3, Sektion: Plugins)

<https://nativephp.com/docs/mobile/3/plugins/permissions-dependencies>

Die Seite beschreibt, wie ein NativePHP-Mobile-v3-Plugin in seinem Plugin-Manifest (JSON; der konkrete Dateiname wird auf der Seite nicht genannt) plattformspezifische Berechtigungen, native Abhängigkeiten und Repositories deklariert. Seitenstruktur: Platform Configuration → Permissions (Android Permissions, iOS Info.plist Entries) → Dependencies (Android, iOS) → Custom Repositories → Full Example → Official Plugins & Dev Kit.

PLATTFORM-KONFIGURATION: Das Manifest hat zwei Top-Level-Blöcke. "android" mit den Keys "permissions" (Array), "dependencies" (Objekt), "repositories" (Array), "activities" (Array), "services" (Array — activities/services werden in der Struktur gezeigt, aber auf dieser Seite nicht weiter erklärt); "ios" mit "info_plist" (Objekt) und "dependencies" (Objekt).

ANDROID PERMISSIONS: String-Array vollqualifizierter Berechtigungen, z. B. ["android.permission.CAMERA", "android.permission.RECORD_AUDIO", "android.permission.ACCESS_FINE_LOCATION"]. Diese werden zur Build-Zeit automatisch in die AndroidManifest.xml der App gemerged.

iOS INFO.PLIST: Key-Value-Paare unter ios.info_plist, z. B. {"NSCameraUsageDescription": "This app uses the camera for scanning", "NSMicrophoneUsageDescription": "This app records audio for transcription", "NSLocationWhenInUseUsageDescription": "This app needs your location", "MBXAccessToken": "${MAPBOX_ACCESS_TOKEN}"} — also sowohl Usage-Descriptions als auch beliebige Plist-Werte wie API-Tokens. Callout: Usage-Descriptions müssen klar und spezifisch sein; generische Texte wie "This app needs camera access" können zur App-Store-Ablehnung führen — erklären, WARUM die Berechtigung gebraucht wird.

ANDROID DEPENDENCIES: Gradle-Koordinaten ("group:artifact:version") unter android.dependencies, gruppiert nach vier Dependency-Typen: implementation (Standard), api (für Consumer sichtbar), compileOnly (nur Compile-Zeit), runtimeOnly (nur Laufzeit). Beispiel: {"implementation": ["com.google.mlkit:face-detection:16.1.5", "org.tensorflow:tensorflow-lite:2.13.0"]}.

iOS DEPENDENCIES: Zwei Varianten. (a) CocoaPods unter ios.dependencies.pods als Array von {"name": "GoogleMLKit/FaceDetection", "version": "~> 4.0"}-Objekten; (b) Swift Packages unter ios.dependencies.swift_packages als Array von {"url": "https://github.com/example/SomePackage", "version": "1.0.0"}-Objekten. Callout: Wenn eine Bibliothek beides unterstützt, Swift Packages gegenüber CocoaPods bevorzugen — sauberere Integration, schnellere Builds.

CUSTOM REPOSITORIES (Android): Private/zusätzliche Maven-Repos unter android.repositories als Array von Objekten mit "url" und optionalen "credentials" ({"username": ..., "password": ...}), z. B. das Mapbox-Maven-Repo https://api.mapbox.com/downloads/v2/releases/maven mit username "mapbox" und password "${MAPBOX_DOWNLOADS_TOKEN}".

ENV-PLATZHALTER & SECRETS: Für sensible Werte die ${ENV_VAR}-Syntax verwenden; Platzhalter werden zur Build-Zeit durch den Wert der Umgebungsvariablen ersetzt (funktioniert in info_plist-Werten und repository-credentials). Ein optionaler Top-Level-Block "secrets" deklariert benötigte Variablen mit "description" und "required": true und validiert sie VOR dem Build.

FULL EXAMPLE: Vollständiges Manifest eines Plugins "vendor/ml-maps-plugin" mit "namespace": "MLMaps", das alle Konzepte kombiniert: Android-Permissions (CAMERA, ACCESS_FINE_LOCATION), implementation-Dependencies (com.google.mlkit:object-detection:17.0.0, com.mapbox.maps:android:11.0.0), Mapbox-Maven-Repo mit Credentials, iOS info_plist (NSCameraUsageDescription, NSLocationWhenInUseUsageDescription, MBXAccessToken=${MAPBOX_PUBLIC_TOKEN}), Pod MapboxMaps ~> 11.0 sowie secrets-Block für MAPBOX_DOWNLOADS_TOKEN und MAPBOX_PUBLIC_TOKEN (beide required, mit Beschreibungen).

OFFICIAL PLUGINS & DEV KIT: Werbe-Hinweis (zweimal auf der Seite): "Skip the configuration complexity — browse ready-made plugins or get the Dev Kit to build your own." mit Link zum NativePHP Plugin Marketplace (https://nativephp.com/plugins); zusätzlich Verweise auf Ultra-Subscription und Masterclass. Navigation: vorherige Seite "Lifecycle Hooks", nächste Seite "Advanced Configuration".

Die Seite enthält keine CLI-Befehle, keine PHP/JS-APIs (Facades/Events) und keine expliziten Lizenz-/Versionsvoraussetzungen — sie ist rein deklarative Manifest-Konfiguration für Plugin-Autoren.

### APIs

- Plugin-Manifest (JSON): Top-Level-Struktur {"android": {"permissions": [...], "dependencies": {...}, "repositories": [...], "activities": [...], "services": [...]}, "ios": {"info_plist": {...}, "dependencies": {...}}} — deklarative Konfiguration, keine PHP/JS-API auf dieser Seite
- android.permissions: String-Array vollqualifizierter Android-Berechtigungen, wird zur Build-Zeit in AndroidManifest.xml gemerged
- android.dependencies: Gradle-Dependencies gruppiert nach Typ — implementation (Standard), api (für Consumer sichtbar), compileOnly, runtimeOnly; Format "group:artifact:version"
- android.repositories: Array aus {"url": ..., "credentials": {"username": ..., "password": ...}} für private Maven-Repos (Credentials optional, ${ENV_VAR} unterstützt)
- android.activities / android.services: in der Struktur vorhanden, auf dieser Seite nicht erklärt (vermutlich in 'Advanced Configuration')
- ios.info_plist: Key-Value-Map, die in die Info.plist geschrieben wird (Usage-Descriptions und beliebige Werte wie API-Tokens)
- ios.dependencies.pods: Array aus {"name": "PodName", "version": "~> X.Y"} (CocoaPods)
- ios.dependencies.swift_packages: Array aus {"url": "https://github.com/...", "version": "1.0.0"} (Swift Package Manager)
- secrets (Top-Level): Map aus VAR_NAME → {"description": ..., "required": true} — validiert Umgebungsvariablen vor dem Build
- Manifest-Metadaten im Full Example: "name": "vendor/ml-maps-plugin", "namespace": "MLMaps"

### Konfiguration

- Android-Berechtigungen (Beispiele): android.permission.CAMERA, android.permission.RECORD_AUDIO, android.permission.ACCESS_FINE_LOCATION — landen automatisch in AndroidManifest.xml
- iOS Info.plist-Keys (Beispiele): NSCameraUsageDescription, NSMicrophoneUsageDescription, NSLocationWhenInUseUsageDescription sowie beliebige Custom-Keys wie MBXAccessToken
- ${ENV_VAR}-Platzhalter-Syntax für sensible Werte in info_plist-Werten und repository-credentials; Ersetzung durch Umgebungsvariablen zur Build-Zeit
- secrets-Block deklariert benötigte Env-Variablen (description + required) und validiert sie vor dem Build; Beispiele: MAPBOX_DOWNLOADS_TOKEN, MAPBOX_PUBLIC_TOKEN, MAPBOX_ACCESS_TOKEN
- Custom-Maven-Repository-Beispiel: url https://api.mapbox.com/downloads/v2/releases/maven, credentials.username "mapbox", credentials.password "${MAPBOX_DOWNLOADS_TOKEN}"
- Android-Dependency-Beispiele: com.google.mlkit:face-detection:16.1.5, org.tensorflow:tensorflow-lite:2.13.0, com.google.mlkit:object-detection:17.0.0, com.mapbox.maps:android:11.0.0
- iOS-Pod-Beispiele: GoogleMLKit/FaceDetection ~> 4.0, TensorFlowLiteSwift ~> 2.13, MapboxMaps ~> 11.0

### Stolperfallen

- Dieses Manifest gilt für PLUGIN-Autoren (Plugin-System von NativePHP Mobile v3), nicht für die normale App-Konfiguration; der konkrete Dateiname des Manifests wird auf der Seite nicht genannt
- App-Store-Falle: Generische iOS-Usage-Descriptions wie "This app needs camera access" können zur Ablehnung im App Store führen — immer konkret erklären, WARUM die Berechtigung benötigt wird
- Bei iOS Swift Packages gegenüber CocoaPods bevorzugen, wenn die Bibliothek beides anbietet (sauberere Integration, schnellere Builds)
- Sensible Werte (Tokens, Repo-Passwörter) nie hart codieren, sondern via ${ENV_VAR} einbinden; Ersetzung erfolgt zur Build-Zeit
- Der secrets-Block validiert required-Variablen vor dem Build — fehlende Variablen brechen den Build früh ab; Beschreibungen helfen Nutzern, die Tokens zu beschaffen
- android.activities und android.services tauchen in der Struktur auf, werden hier aber nicht dokumentiert (Folgeseite "Advanced Configuration")
- Die Seite enthält keine CLI-Befehle, keine PHP/JS-Laufzeit-APIs und keine expliziten Lizenzhinweise; verwiesen wird auf Plugin Marketplace (https://nativephp.com/plugins), Dev Kit, Ultra-Subscription und Masterclass
- Navigationskontext: vorherige Doku-Seite "Lifecycle Hooks", nächste "Advanced Configuration"

---

## Advanced Configuration (NativePHP Mobile v3, Sektion: Plugins)

<https://nativephp.com/docs/mobile/3/plugins/advanced-configuration>

Die Seite beschreibt fortgeschrittene Konfigurationsmöglichkeiten im Plugin-Manifest (JSON) eines NativePHP-Mobile-v3-Plugins. Der Dateiname des Manifests wird auf dieser Seite nicht explizit genannt (Plugin-Manifest-JSON, vgl. vorherige Plugin-Doku-Seiten).

1) Secrets & Environment Variables: Plugins deklarieren benötigte API-Keys/Tokens in einem "secrets"-Objekt; je Secret mit "description" und "required" (bool). Beispiel: MAPBOX_DOWNLOADS_TOKEN (required: true, "Mapbox SDK download token from mapbox.com/account/access-tokens"), FIREBASE_API_KEY (required: false). Referenziert werden Secrets überall im Manifest per Platzhalter-Syntax ${ENV_VAR}, z. B. als Maven-Repository-Credential: android.repositories[].url = "https://api.mapbox.com/downloads/v2/releases/maven" mit credentials.password = "${MAPBOX_DOWNLOADS_TOKEN}". Die Platzhalter werden zur Build-Zeit substituiert; fehlt ein required-Secret, schlägt der Build mit einer hilfreichen Meldung fehl, die exakt nennt, welche Variablen der Nutzer in seiner .env setzen muss.

2) Android Manifest Components: Unter "android" lassen sich Activities, Services, Receivers und Providers deklarieren, die in die AndroidManifest.xml gemerged werden. Activities: name (z. B. ".MyPluginActivity"), theme ("@style/Theme.AppCompat.Light.NoActionBar"), exported (bool), configChanges ("orientation|screenSize"). Services: name (".BackgroundSyncService"), exported, foregroundServiceType ("dataSync"). Receivers: name (".BootReceiver"), exported: true, "intent-filters" mit action ("android.intent.action.BOOT_COMPLETED") und category ("android.intent.category.DEFAULT"). Providers: name (".MyContentProvider"), authorities ("${applicationId}.myplugin.provider" — applicationId-Platzhalter wird ersetzt), exported, grantUriPermissions.

3) Android Features: "features"-Array mit Hardware-/Software-Anforderungen, je Eintrag name + required (bool), z. B. android.hardware.camera (true), android.hardware.camera.autofocus (false), android.hardware.bluetooth_le (true) — entspricht <uses-feature>.

4) Android Meta-Data: "meta_data"-Array mit name/value-Einträgen auf Application-Ebene; value unterstützt Platzhalter, z. B. com.google.android.geo.API_KEY = "${GOOGLE_MAPS_API_KEY}" oder com.google.firebase.messaging.default_notification_icon = "@drawable/ic_notification".

5) Declarative Assets: "assets"-Objekt mit plattformspezifischen "source": "destination"-Mappings; source ist relativ zum resources/-Verzeichnis des Plugins, destination relativ zum nativen Projekt. Beispiele Android: "models/detector.tflite" -> "assets/ml/detector.tflite", "config/settings.xml" -> "res/raw/plugin_settings.xml"; iOS: "models/detector.mlmodel" -> "Resources/ml/detector.mlmodel", "config/settings.plist" -> "Resources/plugin_settings.plist". Textbasierte Assets unterstützen Platzhalter-Substitution.

6) iOS Background Modes: "ios"."background_modes"-Array (z. B. ["audio", "fetch", "processing", "location"]) wird als UIBackgroundModes in die Info.plist geschrieben. Warnung: Background Modes erfordern entsprechende Entitlements und App-Store-Review — nur anfordern, was das Plugin wirklich braucht.

7) iOS Entitlements: "ios"."entitlements"-Objekt mit bool-, Array- oder String-Werten, z. B. "com.apple.developer.maps": true, "com.apple.security.application-groups": ["group.com.example.shared"], "com.apple.developer.associated-domains": ["applinks:example.com"], "com.apple.developer.healthkit": true. Hinweis: Viele Entitlements erfordern in Apple-Developer-Account und Xcode-Projekteinstellungen aktivierte Capabilities.

8) iOS Capabilities: "ios"."capabilities"-Array deklariert benötigte Capabilities, z. B. ["push-notifications", "background-modes", "healthkit"].

9) Minimum Platform Versions: "android"."min_version" als Integer-SDK-Level (Minimum 29) und "ios"."min_version" als String (Minimum "18.0"). Zielt die App des Nutzers auf eine niedrigere Version als das Plugin verlangt, erhält er bei der Plugin-Validierung eine Warnung.

10) Initialization Functions: "init_function" je Plattform definiert eine native Funktion, die beim App-Start aufgerufen wird — für frühe SDK-Initialisierung, BEVOR Bridge-Functions verfügbar sind. Android: voll qualifiziert "com.myvendor.plugins.myplugin.MyPluginInit.initialize"; iOS: "MyPluginInit.initialize". Kotlin/Swift-Signatur-Beispiele liefert die Seite nicht.

11) Komplettbeispiel Firebase ML Kit: Ein vollständiges Manifest kombiniert namespace ("FirebaseML"), bridge_functions (name "FirebaseML.Analyze" mit android-Klasse "com.nativephp.plugins.firebaseml.AnalyzeFunctions.Analyze" und ios "FirebaseMLFunctions.Analyze"), events (PHP-Event-Klasse "Vendor\\FirebaseML\\Events\\AnalysisComplete"), Android-permissions (CAMERA, INTERNET), features (camera required), dependencies.implementation (Gradle: com.google.firebase:firebase-ml-vision:24.1.0, firebase-core:21.1.1), activities (.CameraPreviewActivity), meta_data (com.google.firebase.ml.vision.DEPENDENCIES = "ocr"), iOS info_plist (NSCameraUsageDescription), CocoaPods-dependencies (Firebase/MLVision ~> 10.0, Firebase/Core ~> 10.0), background_modes (["processing"]), entitlements (associated-domains), assets (google-services.json bzw. Resources/GoogleService-Info.plist), secrets (FIREBASE_API_KEY required) sowie hooks.pre_compile ("nativephp:firebase-ml:setup" — ein Artisan-Command-Name als Pre-Compile-Hook; Details zur Hook-Funktionsweise erläutert die Seite nicht).

CLI-Befehle nennt die Seite keine. Navigation: vorherige Seite "Permissions & Dependencies" (/docs/mobile/3/plugins/permissions-dependencies), nächste Seite "Validation & Testing" (/docs/mobile/3/plugins/validation-testing).

### Befehle

```bash
(keine CLI-Befehle auf dieser Seite dokumentiert)
nativephp:firebase-ml:setup — als hooks.pre_compile im Firebase-Beispiel referenzierter Artisan-Command-Name (kein direkt auszuführender Doku-Befehl)
```

### APIs

- Plugin-Manifest-Keys: secrets.<NAME>.description / secrets.<NAME>.required (bool) — Deklaration benötigter API-Keys/Tokens
- Platzhalter-Syntax ${ENV_VAR} — wird zur Build-Zeit überall im Manifest substituiert (z. B. credentials.password, meta_data.value)
- Platzhalter ${applicationId} — wird in Android-Werten (z. B. provider.authorities) durch die App-ID ersetzt
- android.activities[] — name, theme, exported, configChanges
- android.services[] — name, exported, foregroundServiceType (z. B. dataSync)
- android.receivers[] — name, exported, intent-filters[{action, category}]
- android.providers[] — name, authorities, exported, grantUriPermissions
- android.features[] — {name, required} (uses-feature)
- android.meta_data[] — {name, value} mit Platzhalter-Support
- android.repositories[] — {url, credentials:{password}} für private Maven-Repos
- android.dependencies.implementation[] — Gradle-Abhängigkeiten (Beispiel Firebase ML)
- ios.dependencies.pods[] — {name, version} CocoaPods (Beispiel Firebase ML)
- ios.info_plist — Key/Value-Einträge für Info.plist (z. B. NSCameraUsageDescription)
- ios.background_modes[] — UIBackgroundModes (audio, fetch, processing, location)
- ios.entitlements — bool/Array/String-Werte (maps, application-groups, associated-domains, healthkit)
- ios.capabilities[] — push-notifications, background-modes, healthkit, ...
- assets.android / assets.ios — "source": "destination"-Mappings, source relativ zu resources/ des Plugins; Text-Assets mit Platzhalter-Substitution
- android.min_version (int, min 29) / ios.min_version (string, min "18.0")
- android.init_function / ios.init_function — native Funktion beim App-Start, vor Verfügbarkeit der Bridge-Functions (Android: "com.myvendor.plugins.myplugin.MyPluginInit.initialize", iOS: "MyPluginInit.initialize")
- bridge_functions[] — {name, android: FQCN.Methode, ios: Klasse.Methode} (Beispiel: FirebaseML.Analyze)
- events[] — PHP-Event-Klassen, z. B. Vendor\\FirebaseML\\Events\\AnalysisComplete
- hooks.pre_compile — Artisan-Command, der vor dem Kompilieren läuft (z. B. nativephp:firebase-ml:setup)
- namespace — Plugin-Namespace (z. B. "FirebaseML")

### Konfiguration

- Secrets als Env-Variablen in der .env der konsumierenden App, z. B. MAPBOX_DOWNLOADS_TOKEN, FIREBASE_API_KEY, GOOGLE_MAPS_API_KEY — per ${ENV_VAR} im Manifest referenziert, Substitution zur Build-Zeit
- AndroidManifest.xml-Merging: activities, services (foregroundServiceType), receivers (intent-filters wie BOOT_COMPLETED), providers (authorities mit ${applicationId}), uses-feature (features[]), application-level meta-data
- Android-Berechtigungen im Beispiel: android.permission.CAMERA, android.permission.INTERNET
- Info.plist: UIBackgroundModes (audio/fetch/processing/location), Usage-Strings wie NSCameraUsageDescription
- iOS-Entitlements: com.apple.developer.maps, com.apple.security.application-groups, com.apple.developer.associated-domains, com.apple.developer.healthkit
- iOS-Capabilities: push-notifications, background-modes, healthkit
- Mindestversionen: android.min_version >= 29 (SDK-Level, int), ios.min_version >= "18.0" (string)
- Assets: Quellpfade relativ zu resources/ des Plugins; Ziele z. B. assets/, res/raw/ (Android) bzw. Resources/ (iOS); Sonderfälle google-services.json und GoogleService-Info.plist

### Stolperfallen

- Fehlt ein required-Secret zur Build-Zeit, schlägt der Build fehl — mit Hinweis, welche Variablen in der .env zu setzen sind
- iOS Background Modes erfordern korrespondierende Entitlements und App-Store-Review; nur Modes anfordern, die das Plugin wirklich braucht
- Viele iOS-Entitlements erfordern im Apple-Developer-Account und in den Xcode-Projekteinstellungen aktivierte Capabilities
- Minimum-Versionen: Android SDK-Level mindestens 29, iOS mindestens "18.0"; zielt die App auf eine niedrigere Version als das Plugin, gibt es eine Warnung bei der Plugin-Validierung
- Initialization Functions laufen beim App-Start, bevor Bridge-Functions verfügbar sind — geeignet für frühe SDK-Initialisierung; die Seite liefert keine Kotlin/Swift-Signaturbeispiele
- Die Seite nennt den Dateinamen des Plugin-Manifests nicht explizit und enthält keine php artisan-Befehle; Details zur Hook-Mechanik (pre_compile) werden nicht erläutert
- Kontext-Seiten: vorher /docs/mobile/3/plugins/permissions-dependencies, danach /docs/mobile/3/plugins/validation-testing
- Lizenzhinweise enthält die Seite keine

---

## Validation & Testing (NativePHP Mobile v3, Sektion: Plugins)

<https://nativephp.com/docs/mobile/3/plugins/validation-testing>

Die Seite beschreibt, wie man NativePHP-Mobile-Plugins validiert, testet und debuggt.

1) Plugin-Validierung: Mit `php artisan native:plugin:validate` wird das Plugin geprüft. Geprüft werden: (a) Manifest-Syntax (nativephp.json) und Pflichtfelder, (b) ob deklarierte Bridge-Funktionen mit dem nativen Code (Swift/Kotlin) übereinstimmen, (c) ob Hook-Commands registriert sind und existieren, (d) ob deklarierte Assets vorhanden sind.

2) Häufige Validierungsfehler: "Bridge function not found in native code" — das Manifest deklariert eine Funktion, aber die Swift-/Kotlin-Implementierung fehlt oder ist anders benannt; Klassen- und Funktionsnamen müssen exakt übereinstimmen. "Invalid manifest JSON" — Syntaxfehler in nativephp.json (trailing commas, fehlende Anführungszeichen, nicht geschlossene Klammern). "Hook command not registered" — das Manifest referenziert einen Artisan-Command, der nicht im Service Provider registriert ist; prüfen, ob `native:plugin:make-hook` den Service Provider aktualisiert hat, sonst manuell registrieren.

3) Testen während der Entwicklung: PHP-Code wird mit Standard-PHPUnit-Tests für Facades und Event-Handling getestet (Beispiel: `$this->assertInstanceOf(MyPlugin::class, app(MyPlugin::class));` in `test_plugin_facade_is_accessible()`). Nativer Code kann nur durch Ausführen der App getestet werden: Plugin lokal per Composer-Path-Repository installieren, `php artisan native:run` ausführen, die Plugin-Funktionalität in der App auslösen und die Konsolenausgabe auf Fehler prüfen. Logging nutzen: `$this->info()` oder `Log::debug()` in nativem Kontext; Geräte-Logs mit `php artisan native:tail` einsehen.

4) Debugging-Tipps: Plugin wird nicht erkannt? — composer.json muss `"type": "nativephp-plugin"` enthalten, `composer dump-autoload` ausführen, Erkennung mit `php artisan native:plugin:list` prüfen. Native Funktion zur Laufzeit nicht gefunden? — App nach Änderungen am nativen Code neu bauen, Funktionsnamen im Manifest exakt abgleichen, korrekten Kotlin-Package-Namen prüfen. Events feuern nicht? — Dispatch muss auf dem Main Thread erfolgen, Event-Klassenname muss zum Manifest passen, das `#[OnNative]`-Attribut muss die korrekte Klasse referenzieren.

5) Offizielle Plugins & Dev Kit: Fertige Plugins und das Dev Kit gibt es im NativePHP Plugin Marketplace (https://nativephp.com/plugins).

Relevanz für den App-Implementierungsplan: Diese Seite betrifft primär die Entwicklung eigener NativePHP-Plugins (nicht den normalen App-Code). Wichtig für uns sind die generischen Befehle `native:run` (App starten) und `native:tail` (Geräte-Logs) sowie das Wissen, dass nativer Code nur im laufenden App-Kontext testbar ist und nach Änderungen ein Rebuild nötig ist.

### Befehle

```bash
php artisan native:plugin:validate
php artisan native:run
php artisan native:tail
php artisan native:plugin:list
php artisan native:plugin:make-hook
composer dump-autoload
```

### APIs

- MyPlugin (Beispiel-Plugin-Facade-Klasse) — Test via app(MyPlugin::class), z. B. $this->assertInstanceOf(MyPlugin::class, app(MyPlugin::class))
- $this->info() — Logging innerhalb nativer Hook-/Command-Klassen
- Log::debug() — Laravel-Log-Facade zum Debuggen von nativem/Plugin-Code (Ausgabe via native:tail)
- #[OnNative] — PHP-Attribut zur Bindung von Event-Handlern an native Events; muss die korrekte Event-Klasse referenzieren
- Bridge-Funktionen — im Plugin-Manifest deklarierte Funktionen, die exakt benannte Swift-/Kotlin-Implementierungen benötigen
- Hook-Commands — Artisan-Commands, die im Plugin-Service-Provider registriert sein müssen (Generierung per native:plugin:make-hook)

### Konfiguration

- nativephp.json — Plugin-Manifest: deklariert Bridge-Funktionen, Hook-Commands, Assets; Syntax und Pflichtfelder werden von native:plugin:validate geprüft
- composer.json: "type": "nativephp-plugin" — zwingend nötig, damit das Plugin discovered wird
- Composer-Path-Repository — empfohlener Weg, ein Plugin während der Entwicklung lokal zu installieren

### Stolperfallen

- Nativer Code (Swift/Kotlin) lässt sich nicht per Unit-Test prüfen — nur durch Ausführen der App (native:run) und Beobachten der Konsole/Logs
- Nach jeder Änderung am nativen Code muss die App neu gebaut werden, sonst 'native function not found at runtime'
- Klassen- und Funktionsnamen in Manifest und Swift-/Kotlin-Code müssen exakt übereinstimmen (case-sensitiv); bei Kotlin zusätzlich der Package-Name
- nativephp.json ist strikt: trailing commas, fehlende Quotes oder unguschlossene Klammern führen zu 'Invalid manifest JSON'
- Hook-Commands müssen im Plugin-Service-Provider registriert sein; native:plugin:make-hook erledigt das normalerweise, ggf. manuell nachtragen
- Native Events müssen auf dem Main Thread dispatcht werden, sonst feuern sie nicht; Event-Klassenname muss zum Manifest und zum #[OnNative]-Attribut passen
- Wird ein Plugin nicht erkannt: composer.json-Type prüfen, composer dump-autoload ausführen, mit native:plugin:list verifizieren
- PHP-Seite des Plugins (Facades, Event-Handling) mit normalen PHPUnit/Pest-Tests abdecken — das ist der einzige automatisierbare Testpfad
- Fertige offizielle Plugins und das Dev Kit gibt es im NativePHP Plugin Marketplace (nativephp.com/plugins) — vor Eigenentwicklung dort prüfen
- Die Seite enthält keine env-Variablen und keine AndroidManifest-/Info.plist-Berechtigungen — sie betrifft nur Plugin-Validierung/-Testing

---

## NativePHP Mobile v3 – Plugins: Best Practices

<https://nativephp.com/docs/mobile/3/plugins/best-practices>

Die Seite definiert die Qualitäts-, Dokumentations-, Test- und Genehmigungsstandards für Plugins im NativePHP Plugin Marketplace (Mobile v3). Gliederung: Overview, Documentation (Required README Sections, Keep Documentation Current), JavaScript Implementations (npm Package), Testing on Real Devices (Requirements, Provide a Test App), Frontend Stack Compatibility (Test With, Beispiele für Livewire- und Vue/Inertia-Komponenten), Boost Guidelines, Validation, Automated Review Checks (Required for Approval, Additional Checks), Checklist, Official Plugins & Dev Kit.

DOKUMENTATION: Das README jedes Plugins muss enthalten: (1) Installation mit `composer require vendor/my-plugin` und `php artisan native:plugin:register vendor/my-plugin`; (2) vollständige PHP-Nutzungsbeispiele (Facade-Aufrufe wie `MyPlugin::doSomething(['option' => 'value'])` und Event-Listening in Livewire via `#[OnNative(SomethingCompleted::class)]`-Attribut); (3) JavaScript-Nutzung für SPA-Frameworks; (4) alle verfügbaren Methoden, Events und benötigten nativen Berechtigungen; (5) Environment-Variablen und Secrets (bei API-Keys/Tokens exakt dokumentieren, wo man sie bekommt und wie man sie konfiguriert). Leitsatz: "Don't make developers read your source code to figure out what your plugin does." README bei jeder API-Änderung aktualisieren – veraltete Doku ist schlimmer als keine.

JAVASCRIPT-IMPLEMENTIERUNG: Jedes Plugin MUSS neben der PHP-Facade eine JavaScript-Library in `resources/js/` (z. B. `resources/js/index.js`) bereitstellen, die für jede Bridge-Methode eine exportierte Funktion anbietet, damit Inertia+Vue/React-Apps die nativen Funktionen ohne Livewire-Umweg direkt aufrufen können. Muster: ein `bridgeCall(method, params)`-Helper, der per `fetch` einen POST mit JSON-Body `{ method, params }` an `/_native/api/call` schickt (Methodenname im Format `MyPlugin.DoSomething`); darauf aufbauend exportierte Funktionen wie `export async function DoSomething(options = {})`. Empfehlung (optional): die JS-Library zusätzlich als npm-Paket veröffentlichen, damit Entwickler sie per `npm install` beziehen und TypeScript-Definitionen, Autocompletion und Tree-Shaking erhalten (konkrete package.json-/Publishing-Details nennt die Seite nicht).

TESTING AUF ECHTEN GERÄTEN: Simulatoren/Emulatoren reichen nicht ("they don't catch everything"). Pflicht: Test auf physischem Android-Gerät (nicht nur Emulator) und auf physischem iPhone/iPad – der iOS-Simulator unterstützt keine Kamera, Biometrie und viele andere Hardware-Features. Nach Möglichkeit auf aktueller UND vorheriger Major-OS-Version testen. Idealerweise Test-Build-Link bereitstellen: iOS via TestFlight, Android via Google-Play-Testing-Track (internal, closed oder open testing).

FRONTEND-STACK-KOMPATIBILITÄT: Mit allen vier Stacks testen: Livewire v3 (`#[OnNative]`-Event-Listener, Facade-Aufrufe, Loading-States), Livewire v4 (Forward-Kompatibilität), Inertia+Vue und Inertia+React (Imports, Bridge-Calls, Event-Handling). Beispiel-Livewire-Komponente: `use Native\Mobile\Attributes\OnNative;` plus Plugin-Facade und Event-Klasse; Aktion ruft `MyPlugin::startScan()` auf, Ergebnis kommt asynchron über `#[OnNative(ScanComplete::class)] public function handleScan($data)` und wird z. B. via `$data['value']` gelesen. Vue/Inertia-Beispiel: `import { StartScan, OnScanComplete } from 'vendor-my-plugin';`, Event-Callback via `OnScanComplete((data) => ...)`, Aufruf via `await StartScan()`.

BOOST GUIDELINES: Mit `php artisan native:plugin:boost` werden KI-Guidelines generiert – erzeugt `resources/boost/guidelines/core.blade.php` im Plugin. Diese Datei soll enthalten: alle Facade-Methoden mit Beschreibung und Parametertypen, alle dispatchten Events mit Payload-Shapes, JavaScript-Nutzungsbeispiele, Common Patterns/Gotchas sowie benötigte Berechtigungen und Konfiguration. Wenn Nutzer das Plugin installieren und `php artisan boost:install` ausführen, werden diese Guidelines automatisch geladen (Laravel-Boost-Integration).

VALIDATION: Vor JEDEM Release `php artisan native:plugin:validate` ausführen. Der Befehl findet: Manifest-Syntaxfehler und fehlende Pflichtfelder, Bridge-Function-Deklarationen, die nicht zum nativen Code passen, nicht registrierte Hook-Commands, fehlende deklarierte Assets. Das Plugin muss die Validierung mit null Fehlern bestehen.

MARKETPLACE-GENEHMIGUNG: Pflichtbedingungen (Required for Approval): LICENSE-/LICENSE.md-/LICENSE.txt-Datei im Repo-Root (keine bestimmte Lizenz vorgeschrieben); mindestens ein GitHub-Release oder -Tag; konfigurierter GitHub-Webhook (damit Plugin-Daten bei Pushes/Releases automatisch synchronisiert werden); Support-Kanal (E-Mail oder URL) bei der Einreichung. Automatisierte Checks: nativer Swift-Code in `resources/ios/Sources/`; nativer Kotlin-Code in `resources/android/src/`; JavaScript-Library in `resources/js/` mit Exports; `nativephp/mobile` als Dependency in composer.json (z. B. `"nativephp/mobile": "^3.0"`); iOS-`min_version` in nativephp.json gesetzt (Beispiel `{"ios": {"min_version": "18.0"}}`); Android-`min_version` in nativephp.json gesetzt (Beispiel `{"android": {"min_version": 29}}`).

ABSCHLUSS-CHECKLISTE (Doku & Qualität): README dokumentiert Installation, PHP- und JS-Nutzung sowie alle öffentlichen Methoden, Events und Berechtigungen; `native:plugin:validate` läuft fehlerfrei; auf physischem Android- und iOS-Gerät getestet; mit Livewire v3 und v4 sowie Inertia+Vue und Inertia+React getestet; Boost-Guidelines enthalten; TestFlight-/Google-Play-Testing-Link vorhanden; alle Secrets/Env-Variablen dokumentiert; Changelog wird gepflegt.

OFFICIAL PLUGINS & DEV KIT: Die offiziellen NativePHP-Plugins folgen all diesen Best Practices und dienen als Referenz (Plugin Marketplace: nativephp.com/plugins); für produktionsreife Plugins wird das Plugin Dev Kit (/products/plugin-dev-kit) empfohlen. Weiterführende Doku-Links: Bridge Functions (/docs/mobile/3/plugins/bridge-functions), Advanced Configuration (/docs/mobile/3/plugins/advanced-configuration), Permissions & Dependencies (/docs/mobile/3/plugins/permissions-dependencies); vorherige Seite: Validation & Testing, nächste Seite: Core-Plugin Biometrics.

RELEVANZ FÜR DEN APP-PLAN (Laravel + Livewire + Flux UI): Die Seite ist primär für Plugin-AUTOREN, liefert aber für App-Entwickler wichtige Muster: native Funktionen werden in Livewire über Plugin-Facades aufgerufen und Ergebnisse asynchron über `#[OnNative(EventKlasse::class)]`-Listener (aus `Native\Mobile\Attributes\OnNative`) empfangen; der JS-Bridge-Endpoint ist `/_native/api/call`; Plugins werden mit composer require + `native:plugin:register` installiert; Plattform-Mindestversionen (iOS 18.0 / Android API 29 in den Beispielen) und benötigte Berechtigungen stehen in nativephp.json bzw. der Plugin-Doku.

### Befehle

```bash
composer require vendor/my-plugin
php artisan native:plugin:register vendor/my-plugin
php artisan native:plugin:validate
php artisan native:plugin:boost
php artisan boost:install
npm install (empfohlen, falls Plugin-JS-Library als npm-Paket veröffentlicht wird)
```

### APIs

- Plugin-Facade-Muster: use Vendor\MyPlugin\Facades\MyPlugin; — $result = MyPlugin::doSomething(['option' => 'value']);
- Native\Mobile\Attributes\OnNative — PHP-Attribut für Livewire-Event-Listener auf native Events: #[OnNative(SomethingCompleted::class)] public function handleResult($data) { $this->result = $data['result']; }
- Plugin-Event-Klassen (Beispiel): Vendor\MyPlugin\Events\ScanComplete — wird vom nativen Code dispatcht, Payload als Array ($data['value'])
- Livewire-Beispielkomponente Scanner: public ?string $result; scan(): void ruft MyPlugin::startScan(); #[OnNative(ScanComplete::class)] handleScan($data): void setzt $this->result = $data['value']
- JS-Bridge-Endpoint: POST /_native/api/call mit JSON-Body { method, params }; Methodenname im Format 'MyPlugin.DoSomething'
- JS-Library-Muster (resources/js/index.js): async function bridgeCall(method, params = {}) via fetch; export async function DoSomething(options = {}) { return bridgeCall('MyPlugin.DoSomething', options); }; export async function DoSomethingElse(id, options = {}) { return bridgeCall('MyPlugin.DoSomethingElse', { id, ...options }); }
- Vue/Inertia-Muster: import { StartScan, OnScanComplete } from 'vendor-my-plugin'; OnScanComplete((data) => { ... }); await StartScan();
- Boost-Guidelines-Datei: resources/boost/guidelines/core.blade.php (generiert von native:plugin:boost; soll Facade-Methoden, Events mit Payload-Shapes, JS-Beispiele, Gotchas, Berechtigungen dokumentieren)

### Konfiguration

- composer.json des Plugins: "require": { "nativephp/mobile": "^3.0" } (Pflicht)
- nativephp.json: { "ios": { "min_version": "18.0" } } — iOS-Mindestversion (Pflichtfeld für Marketplace)
- nativephp.json: { "android": { "min_version": 29 } } — Android-Mindest-API-Level (Pflichtfeld für Marketplace)
- Verzeichnisstruktur (automatisierte Checks): resources/ios/Sources/ (Swift), resources/android/src/ (Kotlin), resources/js/ (JS-Library mit Exports)
- Env-Variablen/Secrets: Plugins, die API-Keys/Tokens benötigen, müssen im README exakt dokumentieren, wo man sie bekommt und wie sie konfiguriert werden (keine konkreten Variablennamen auf der Seite)
- Native Berechtigungen: jede vom Plugin benötigte Berechtigung muss im README dokumentiert sein; Details zu AndroidManifest.xml/Info.plist auf der separaten Seite /docs/mobile/3/plugins/permissions-dependencies
- LICENSE, LICENSE.md oder LICENSE.txt im Repository-Root (Pflicht für Marketplace-Approval)
- GitHub-Webhook für das Plugin-Repo (Pflicht; synchronisiert Plugin-Daten bei Push/Release automatisch)

### Stolperfallen

- Seite richtet sich an Plugin-AUTOREN (Marketplace-Standards), nicht direkt an App-Entwickler — für die App-Implementierung sind v. a. die Nutzungsmuster (Facade + #[OnNative] + JS-Bridge) relevant
- Native Ergebnisse kommen ASYNCHRON als Events zurück — in Livewire zwingend #[OnNative(Event::class)]-Listener verwenden, nicht auf synchrone Rückgabewerte bauen
- iOS-Simulator unterstützt keine Kamera, Biometrie und viele Hardware-Features — Tests von Hardware-Features nur auf physischem iPhone/iPad aussagekräftig; auch Android nicht nur im Emulator testen
- Auf aktueller UND vorheriger Major-OS-Version testen, wo möglich
- Plattform-Mindestversionen beachten: Beispiele zeigen iOS min_version 18.0 und Android min_version 29 (API-Level) — Plugins können also ältere Geräte ausschließen
- Plugins müssen mit Livewire v3 UND v4 sowie Inertia+Vue und Inertia+React kompatibel sein — bei Plugin-Auswahl für die eigene Livewire-App prüfen, ob die Livewire-v4-Kompatibilität gegeben ist (Projekt nutzt Livewire v4)
- Lizenz: Marketplace verlangt eine LICENSE-Datei im Root, schreibt aber keine konkrete Lizenz vor — Lizenz fremder Plugins vor Einsatz prüfen; Plugin Dev Kit ist ein separates Produkt (Kauf-/Lizenzdetails auf der Seite nicht spezifiziert)
- php artisan native:plugin:validate muss mit null Fehlern bestehen und vor jedem Release laufen (prüft Manifest, Bridge-Deklarationen vs. nativem Code, Hook-Registrierungen, deklarierte Assets)
- Marketplace-Approval erfordert: LICENSE-Datei, mindestens ein GitHub-Release/Tag, konfigurierten GitHub-Webhook, Support-Kanal (E-Mail/URL)
- Boost-Guidelines des Plugins werden bei php artisan boost:install automatisch geladen — nützlich für KI-gestützte Entwicklung mit Laravel Boost
- Veraltete README-Doku gilt als schlimmer als keine — bei Plugin-API-Änderungen immer aktualisieren; Changelog ist zu pflegen
- Die Seite nennt KEINE Details zu Error Handling, Performance, Security, Naming-Konventionen, semantischer Versionierung oder npm-Publishing-Workflow (package.json/exports) — npm-Veröffentlichung der JS-Library ist nur eine Empfehlung für TypeScript-Defs/Autocompletion/Tree-Shaking
- Weiterführende Seiten für den Implementierungsplan: /docs/mobile/3/plugins/bridge-functions, /docs/mobile/3/plugins/advanced-configuration, /docs/mobile/3/plugins/permissions-dependencies, /docs/mobile/3/plugins/validation-testing, /docs/mobile/3/plugins/core/biometrics
