# NativePHP Mobile v3 — Getting Started — Installation, Umgebung, Konfiguration, Befehle, Deployment

> Quelle: Deep-Scan der offiziellen Doku (nativephp.com, Stand 2026-06-11). 13 Seiten.

---

## NativePHP for Mobile v3 — Getting Started: Introduction

<https://nativephp.com/docs/mobile/3/getting-started/introduction>

Die Seite ist die Einführung in NativePHP for Mobile v3 und enthält ausschließlich konzeptionelle Inhalte (keine Befehle, kein Code, keine Konfiguration).

Kernaussage: "NativePHP for Mobile is the first library of its kind that lets you run full PHP applications natively on mobile devices — no web server required." Eine vorkompilierte PHP-Runtime wird zusammen mit Laravel direkt in die App eingebettet und an native APIs angebunden; damit lassen sich offline-fähige, echt native Mobile-Apps mit vertrauten PHP-Tools bauen.

Abschnitt "What makes NativePHP for Mobile special?" — fünf Vorteile: (1) Native performance: Apps laufen nativ über eine pro Plattform optimierte, eingebettete PHP-Runtime. (2) True native APIs: Zugriff auf Kamera, Biometrie, Push-Notifications u.v.m. sowie native UI-Komponenten über eine einzige kohärente Library. (3) Laravel powered: das gesamte Laravel-Ökosystem und vorhandene Skills sind nutzbar. (4) No web server required: "Your app runs entirely on-device and can operate completely offline-first." (5) Cross platform: eine Codebasis für iOS und Android.

Abschnitt "Old tools, new tricks": Kein Swift, Kotlin oder fremde Build-Tools nötig — "Just PHP." Von Code bis App-Store-Submission in Minuten.

Abschnitt "How does it work?" — fünf Schritte: (1) Vorkompiliertes PHP wird mit dem eigenen Code in eine Swift- (iOS) bzw. Kotlin- (Android) Shell-Applikation gebündelt. (2) Eigene Swift/Kotlin-Bridges verwalten die PHP-Umgebung und führen den PHP-Code direkt aus. (3) Eine eigene PHP-Extension (in PHP einkompiliert) stellt die Schnittstellen zu nativen Funktionen bereit. (4) Frontend frei wählbar: HTML, JavaScript, Tailwind, Blade, Livewire, React, Vue, Svelte. (5) Neu in v3: echte native UI-Komponenten über das EDGE-Komponentensystem (eigene Doku-Sektion mit Top Bar, Bottom Navigation, Side Navigation, Icons).

Abschnitt "Batteries included": Mehr als ein WebView-Wrapper — "Your application lives on device and is shipped with each installation." Die eigene PHP-Extension liefert die nativen API-Interaktionen; volle PHP/Laravel-Fähigkeiten ohne PWA-Sandboxing oder WASM-Komplexität.

Doku-Struktur (Sidebar, für weitere Recherche relevant): Getting Started (u.a. Changelog, Quick Start, Environment Setup, Configuration, Command Reference unter /docs/mobile/3/getting-started/commands, Deployment), The Basics (WebView, native Funktionen, Komponenten), EDGE Components, Concepts (Security, Authentication, Databases, Queues, Deep Links, Push Notifications), Plugins (~14 Sektionen, u.a. Biometrics, Camera, Geolocation). Navigationslinks der Seite: Next → Changelog (/docs/mobile/3/getting-started/changelog), Quick Start → "Let's go!" (/docs/mobile/3/getting-started/quick-start).

Für den Implementierungsplan (Laravel + Livewire + Flux UI): Livewire und Blade werden explizit als unterstützte Frontends genannt; alle konkreten Befehle, APIs und Konfigurationen stehen auf den Folgeseiten (Quick Start, Environment Setup, Configuration, Commands, Plugins).

### APIs

- EDGE-Komponentensystem (v3): natives UI aus PHP heraus — Komponenten laut Doku-Navigation: Top Bar, Bottom Navigation, Side Navigation, Icons (Details auf eigenen Doku-Seiten, nicht auf dieser Seite)
- Custom PHP-Extension: in die gebündelte PHP-Runtime einkompiliert, exponiert die Schnittstellen zu nativen Funktionen (Kamera, Biometrie, Push etc.) — konkrete Klassen/Facades werden auf dieser Seite nicht genannt
- Swift/Kotlin-Bridges: verwalten die eingebettete PHP-Umgebung in der nativen Shell-App (kein direkt nutzbares Entwickler-API auf dieser Seite dokumentiert)

### Stolperfallen

- Reine Einführungsseite: enthält KEINE CLI-Befehle, KEINE Code-Beispiele, KEINE env-Variablen/Berechtigungen — diese stehen auf den Folgeseiten (quick-start, environment-setup, configuration, commands, plugins)
- Lizenz-/Preishinweis auf der Seite: 'NativePHP Ultra — All NativePHP plugins, teams & priority support from $35/mo' (Plugins sind also teils kostenpflichtig lizenziert); zudem Masterclass mit 'Early Bird Pricing' beworben
- Architektur-Voraussetzung: App = native Swift/Kotlin-Shell mit eingebetteter, vorkompilierter PHP-Runtime; kein Webserver, Code wird mit jeder Installation auf dem Gerät ausgeliefert (offline-first) — relevant für Update-/Deployment-Strategie
- Native APIs laufen ausschließlich über die mitgelieferte PHP-Extension/Bridges — kein eigenes Swift/Kotlin nötig, aber Funktionsumfang ist auf die von NativePHP bereitgestellten Plugins begrenzt
- Systemvoraussetzungen (PHP-/Laravel-Version, Xcode, Android Studio) werden auf dieser Seite nicht genannt — siehe /docs/mobile/3/getting-started/environment-setup
- Livewire/Blade werden explizit unterstützt (ebenso React, Vue, Svelte, Tailwind) — passend zum geplanten Laravel+Livewire+Flux-Stack

---

## NativePHP Mobile v3 — Changelog (Getting Started)

<https://nativephp.com/docs/mobile/3/getting-started/changelog>

Die Seite dokumentiert die Versionshistorie von NativePHP Mobile v3. Die zwei Hauptreleases definieren die Architektur: v3.0 ("Plugin Architecture") machte das Framework Free & Open Source und stellte auf eine modulare Plugin-Architektur um — Core-APIs wie Kamera, Biometrie und Dialoge sind nun einzelne Plugins, Third-Party-Plugins werden über den NativeServiceProvider registriert, dazu kam eine Plugin-Management-CLI (Install/Register/Verwaltung). v3.1 ("Persistent Runtime & Performance") brachte die Persistent PHP Runtime (Laravel bootet einmal, Kernel wird über Requests wiederverwendet: ~5-30ms statt ~200-300ms Antwortzeit), ZTS-(thread-safe-)PHP für Background Queue Worker (Laravel-Jobs in dediziertem Background-Thread, konfigurierbar via QUEUE_CONNECTION=database), Binary-Caching unter nativephp/binaries, ein versions.json-Manifest für Binary-URLs, Senkung des Android-Minimums von API 33 (Android 13) auf API 26 (Android 8), PHP 8.3-8.5-Support mit automatischer Erkennung aus composer.json, volle ICU/Intl-Unterstützung auf iOS, konfigurierbare Android-SDK-Versionen (compile_sdk, min_sdk, target_sdk), Multi-Register für Plugins (native:plugin:register), Warnungen bei unregistrierten Plugins während native:run sowie ios/i- und android/a-Flags für native:jump; außerdem statisches Linking auf Android, Plugin-Kompilierung bei native:package-Builds, erhaltene URL-Codierung bei Android-Redirects und Entfernung der ungenutzten Abhängigkeiten react/http und react/socket. Patch-Releases: 3.1.1 (23.03.2026) fügte den Diagnosebefehl native:debug hinzu, extrahierte den Scheduler in die Plugin-Architektur, verschob PHP-Versions-/ICU-Tracking in die Konfiguration und validiert Android-Min-SDK gegen Floor- und Plugin-Anforderungen. 3.2.0 (01.04.2026) brachte Ephemeral PHP Runtime und Push-Notification-Support, verschob endroid/qr-code zu den Dev-Dependencies, stoppte APP_ENV-Überschreibung auf Android, optionale BasicAuthentication für Plugin-Maven-Repositories und zeigt im iOS-Auth-Dialog den App-Namen statt "NativePHP". 3.2.1-3.2.6 (April 2026) fixten Thread-Sicherheit für Background-Tasks, Android-POST-Body/$_POST-Probleme, axios-fehlt-Builds (Inertia-3-Kompatibilität), verschoben endroid/qr-code zu require und schlossen es aus App-Bundles aus, und behoben Cold-Launch-Races beim PHP-Runtime-Boot/Laravel-Extraktion. 3.3.0 (08.05.2026) führte "Jump" ein: Live-Dev-Preview über eine WebSocket-Bridge; dazu Fixes für iOS-URL-Prozentcodierung, str_getcsv-Deprecation auf PHP 8.4, Überschreiben von Plugin-Info.plist-Berechtigungsstrings durch iOS-Apps und leere $_POST bei iOS-Form-POSTs. 3.3.1/3.3.2 fixten Podfile-START/END-Marker-Korruption und stellten die PHPBridge.kt-API wieder her. 3.3.3 räumt veraltete HTTP_*-Header aus $_SERVER zwischen persistenten PHP-Dispatches und bezieht die Build-Nummer in die Laravel-Bundle-Aktualitätsprüfung ein. 3.3.4 (11.05.2026) stellte PHP-8.3-Support in composer.json wieder her und trackt die volle PHP-Version in nativephp.lock. 3.3.5 (19.05.2026) bricht native:run bei Mismatch von Host-PHP und nativephp.lock ab, unterstützt verschachtelte Metadaten in Android-Manifest-Komponenten, setzt App-Version standardmäßig auf DEBUG, fixt native:jump-Hänger unter Windows (verstärkte Port-Erkennung), Hot Reload/HMR für die persistente Runtime, ignoriert file-URLs im DeepLinkRouter, fixt iOS-Extraktion von Emoji-benannten Dateien (Livewire-4-⚡-Komponenten — direkt relevant für Livewire-Projekte!), Vite-Asset-Laden auf dem Android-Emulator mit Herd HTTPS, fügt Video/Audio-MIME-Typen zu Scheme-Handlern hinzu und ersetzt den PHP-Iterator durch rsync für iOS-App-Kopien. 3.3.6 (05.06.2026, aktuell) macht Android-Theme-Farben konfigurierbar, lokalisiert iOS-Berechtigungsstrings über InfoPlist.strings, fixt iOS httpBodyStream bei nil-httpBody, LaunchImage-Contents.json-Skalierung, Plugin-Verzeichnisstruktur-Inkonsistenz im PluginCreateCommand, wiederholte Query-Parameter in Android-WebView-Requests und einen BGTask-SIGSEGV durch Neustart von php_embed_init. Für den Implementierungsplan relevant: aktuelle Version 3.3.6, PHP 8.3-8.5, Android 8+ (API 26), persistente Runtime mit Queue-Worker, Plugin-System für native Features, Jump für Live-Dev, native:debug für Diagnose.

### Befehle

```bash
php artisan native:run
php artisan native:jump (Flags: ios/i, android/a; seit 3.1)
php artisan native:debug (seit 3.1.1, Mobile-Umgebungsdiagnose)
php artisan native:package (kompiliert seit 3.1 auch Plugins)
php artisan native:plugin:register (seit 3.1 Multi-Register mehrerer Plugins gleichzeitig)
Plugin-Management-CLI allgemein (v3.0): Install-, Register- und Verwaltungsbefehle, u. a. PluginCreateCommand (native:plugin:create, in 3.3.6 Verzeichnisstruktur-Fix)
```

### APIs

- NativeServiceProvider — Service Provider zur Registrierung von Third-Party-Plugins (v3.0)
- Plugin-Architektur — Core-APIs (Kamera, Biometrie, Dialog etc.) sind seit v3.0 einzelne Plugins
- Persistent PHP Runtime — Laravel-Kernel wird über Requests wiederverwendet, ~5-30ms Antwortzeit (v3.1)
- Ephemeral PHP Runtime — alternative Runtime, eingeführt mit Push-Notification-Support (v3.2.0)
- PHP Queue Worker — dedizierter Background-Thread führt Laravel-Jobs aus (v3.1, benötigt ZTS-PHP)
- Scheduler — seit 3.1.1 als Plugin extrahiert
- Jump — Live-Dev-Preview über WebSocket-Bridge (v3.3.0)
- DeepLinkRouter — ignoriert seit 3.3.5 file-URLs
- PHPBridge.kt — Android-Bridge-API (Kotlin), in 3.2.2/3.3.2 referenziert/wiederhergestellt
- php_embed_init — eingebettete PHP-Initialisierung (BGTask-SIGSEGV-Fix 3.3.6)
- Push Notifications — Support seit 3.2.0 inkl. Navigation per Notification-URL

### Konfiguration

- QUEUE_CONNECTION=database — aktiviert den Background-Queue-Worker (v3.1)
- APP_ENV — wird seit 3.2.0 auf Android nicht mehr überschrieben
- compile_sdk / min_sdk / target_sdk — konfigurierbare Android-SDK-Versionen (v3.1)
- PHP-Version & ICU-Tracking — seit 3.1.1 in der Konfiguration; PHP-Version wird automatisch aus composer.json erkannt, volle Version in nativephp.lock (3.3.4)
- versions.json — Manifest für PHP-Binary-Download-URLs (v3.1)
- nativephp/binaries — Cache-Verzeichnis für PHP-Binaries (v3.1)
- nativephp.lock — Lock-Datei; native:run bricht bei Host-PHP-Mismatch ab (3.3.5)
- Info.plist / InfoPlist.strings — iOS-Berechtigungsstrings: Apps können Plugin-Strings überschreiben (3.3.0), Lokalisierung via InfoPlist.strings (3.3.6)
- AndroidManifest — verschachtelte Metadaten in Komponenten unterstützt (3.3.5)
- Android-Theme-Farben — konfigurierbar seit 3.3.6
- Podfile — Pod-Injektion mit START/END-Markern (Fix 3.3.1); Plugin-Pod-Abhängigkeiten (Fix 3.1.1)
- BasicAuthentication für Plugin-Maven-Repositories — optional seit 3.2.0

### Stolperfallen

- NativePHP Mobile v3 ist Free & Open Source (Lizenzänderung mit v3.0 — vorher kommerziell lizenziert)
- PHP-Voraussetzung: 8.3-8.5; 8.3-Support wurde in 3.3.4 in composer.json wiederhergestellt
- Android-Minimum: API 26 / Android 8 (seit v3.1; vorher API 33 / Android 13); Min-SDK wird gegen Floor- und Plugin-Anforderungen validiert
- Queue-Worker benötigt ZTS-(thread-safe-)PHP-Binaries und QUEUE_CONNECTION=database
- native:run bricht ab, wenn Host-PHP-Version nicht zur nativephp.lock passt (seit 3.3.5) — lokale PHP-Version muss konsistent sein
- Livewire-4-relevant: Emoji-benannte Dateien (⚡-Komponenten) machten bis 3.3.5 Probleme bei der iOS-Extraktion — mindestens 3.3.5 verwenden
- Persistente Runtime hatte mehrere Folge-Bugs (stale HTTP_*-Header in $_SERVER, Hot-Reload/HMR, Cold-Launch-Races) — erst ab ~3.3.5 stabil; aktuelle Version 3.3.6 verwenden
- Android-POST-Handling ($_POST leer/Body verloren) war bis einschließlich 3.2.x fehleranfällig — relevant für Livewire-POST-Requests
- Inertia 3: Build schlug fehl, wenn axios fehlte (Fix 3.2.4)
- endroid/qr-code wird vom Framework benötigt (seit 3.2.3 in require), aber aus App-Bundles ausgeschlossen
- Unregistrierte Plugins erzeugen Warnungen bei native:run — Plugins müssen via native:plugin:register registriert werden
- native:jump konnte unter Windows hängen (Fix 3.3.5)
- Vite-Assets auf Android-Emulator mit Herd HTTPS funktionierten erst ab 3.3.5
- App-Version wird seit 3.3.5 standardmäßig auf DEBUG gesetzt
- Die Changelog-Seite dokumentiert nur v3.x; Detailtiefe pro Patch variiert (3.2.6 ohne dokumentierte Details)

---

## Quick Start (NativePHP Mobile v3, Sektion "Getting Started")

<https://nativephp.com/docs/mobile/3/getting-started/quick-start>

Die Quick-Start-Seite ist bewusst kurz und zeigt zwei Einstiegswege in NativePHP Mobile v3. (1) "Jump in": Der schnellste Weg ohne lokale Xcode-/Android-Studio-Installation. Man installiert die Jump-App auf dem iOS-/Android-Gerät (https://bifrost.nativephp.com/jump). Für eine NEUE Laravel-App nutzt man das offizielle Starter-Kit via `laravel new my-app --using=nativephp/mobile-starter`, wechselt ins Verzeichnis und führt `php artisan native:jump` aus; für eine BESTEHENDE Laravel-App genügt `composer require nativephp/mobile` gefolgt von `php artisan native:jump`. Anschließend scannt man den von native:jump erzeugten QR-Code mit der Jump-App und die App startet auf dem Gerät. (2) "Install & run": Wer eine fertig eingerichtete Entwicklungsumgebung mit Xcode und/oder Android Studio hat (Details auf der separaten "Environment Setup"-Seite), installiert das Paket mit `composer require nativephp/mobile`, richtet das Projekt mit `php artisan native:install` ein und startet die App mit `php artisan native:run`. Nach native:install steht zusätzlich ein `native`-Script-Helper im Projekt bereit, sodass `php native run` bzw. `./native run` als Kurzform für `php artisan native:run` dient. (3) "Need help?": Verweis auf den Discord-Server der Community sowie auf die Kitchen-Sink-Demo-App als Beispielsammlung — Android im Play Store (https://play.google.com/store/apps/details?id=com.nativephp.kitchensinkapp) und iOS via TestFlight (https://testflight.apple.com/join/vm9Qtshy). Die Seite selbst enthält KEINE PHP-/JS-APIs, keine env-Variablen, keine config-Keys, keine nativen Berechtigungen und keine Lizenzhinweise — diese Themen sind in den verlinkten Folgeseiten dokumentiert (Environment Setup, Installation, Configuration, Development, Deployment sowie Plugin-Doku mit den Core-Plugins Biometrics, Browser, Camera, Device, Dialog, File, Firebase, Geolocation, Microphone, Network, Scanner, SecureStorage, Share, System). Für den Implementierungsplan (Laravel + Livewire + Flux UI) sind daher als nächste Pflichtlektüre die Seiten Environment Setup, Installation und Configuration sowie die jeweiligen Plugin-Seiten abzurufen.

### Befehle

```bash
laravel new my-app --using=nativephp/mobile-starter
cd my-app
php artisan native:jump
composer require nativephp/mobile
php artisan native:install
php artisan native:run
php native run
./native run
```

### APIs

- Keine PHP-Klassen, Facades, Methoden, Events oder JavaScript-APIs auf dieser Seite dokumentiert — nur Artisan-/Composer-Befehle. APIs sind in den Plugin-Seiten dokumentiert (Core-Plugins laut Navigation: Biometrics, Browser, Camera, Device, Dialog, File, Firebase, Geolocation, Microphone, Network, Scanner, SecureStorage, Share, System).

### Konfiguration

- Keine env-Variablen, config-Dateien oder nativen Berechtigungen (AndroidManifest/Info.plist) auf dieser Seite erwähnt — Konfiguration wird auf der separaten 'Configuration'-Doku-Seite behandelt.

### Stolperfallen

- Der 'Install & run'-Weg setzt eine eingerichtete Mobile-Build-Umgebung mit Xcode (iOS) und/oder Android Studio (Android) voraus; Details stehen auf der separaten 'Environment Setup'-Seite.
- Der 'Jump'-Weg umgeht die lokale Toolchain komplett: Jump-App auf dem Gerät installieren (https://bifrost.nativephp.com/jump), `php artisan native:jump` ausführen und den QR-Code scannen.
- Der `native`-Script-Helper (php native run / ./native run) existiert erst NACH Ausführung von `php artisan native:install`.
- Die Seite enthält keine Lizenzhinweise und keine Angaben zu Kosten der Jump-App; ebenso keine PHP-/Laravel-Versionsanforderungen — dafür müssen Environment Setup/Installation-Seiten konsultiert werden.
- Beispiel-/Referenz-App 'Kitchen Sink': Android https://play.google.com/store/apps/details?id=com.nativephp.kitchensinkapp, iOS TestFlight https://testflight.apple.com/join/vm9Qtshy; Community-Support via Discord.
- Für einen vollständigen Implementierungsplan reicht diese Seite nicht aus — APIs, Berechtigungen, env-Variablen und Deployment stehen auf den Folgeseiten (Installation, Configuration, Development, Deployment, Plugins).

---

## NativePHP Mobile v3 – Upgrade Guide (Getting Started)

<https://nativephp.com/docs/mobile/3/getting-started/upgrade-guide>

Die Seite beschreibt zwei Upgrade-Pfade: (1) Upgrade von 3.0 auf 3.1 und (2) Upgrade von 2.x auf 3.0.

UPGRADE 3.0 -> 3.1 (Drop-in-Upgrade ohne Breaking Changes): Composer-Constraint in composer.json auf "nativephp/mobile": "~3.1.0" anheben, dann `composer update` und `php artisan native:install --force` ausführen. Das --force-Flag ist wichtig: Es stellt sicher, dass native Projektdateien, PHP-Binaries und Konfiguration auf v3.1 aktualisiert werden. Neuerungen in 3.1: (a) Android-8+-Support (API 26): Dafür wird ein 'android'-Block in config/nativephp.php ergänzt mit compile_sdk (env NATIVEPHP_ANDROID_COMPILE_SDK, Default 36), min_sdk (env NATIVEPHP_ANDROID_MIN_SDK, Default 33) und target_sdk (env NATIVEPHP_ANDROID_TARGET_SDK, Default 36) – keine Codeänderungen nötig, wird komplett auf Build-Ebene gehandhabt. (b) ICU/Intl-Support auf iOS: iOS-Builds enthalten nun volle ICU-Unterstützung; die PHP-intl-Extension funktioniert damit auf beiden Plattformen (vorher nur Android). ICU bleibt optional über die Install-Flags --with-icu / --without-icu (Größenzuwachs ca. +30 MB Android, +100 MB iOS).

UPGRADE 2.x -> 3.0: (1) Privates Composer-Repository entfällt: v3 benötigt weder das private Repo noch Lizenz-Authentifizierung. Den repositories-Eintrag {"type":"composer","url":"https://nativephp.composer.sh"} aus composer.json löschen (gesamten repositories-Block oder nur den NativePHP-Eintrag) und gespeicherte Credentials für nativephp.composer.sh aus auth.json entfernen. Dann Constraint auf "~3.0.0" setzen, `composer update` und `php artisan native:install --force`. (2) Plugin-Architektur: v3 führt ein umfassendes Plugin-System ein. Sämtliche native Funktionalität – inkl. aller offiziellen Core-APIs (Camera, Biometrics, Dialog, Scanner, Geolocation usw.) – wird nun durch Plugins bereitgestellt; sie funktionieren wie zuvor, keine Aufruf-Änderungen nötig. Neu: Drittentwickler können Plugins erstellen; Plugins sind normale Composer-Pakete mit Swift- (iOS) und Kotlin- (Android) Code. (3) NativeServiceProvider: Per `php artisan vendor:publish --tag=nativephp-plugins-provider` wird app/Providers/NativeServiceProvider.php erzeugt. Drittanbieter-Plugins MÜSSEN dort registriert sein, bevor ihr nativer Code kompiliert wird (Sicherheitsmaßnahme); Registrierung via `php artisan native:plugin:register vendor/some-plugin`. Core-APIs aus nativephp/mobile sind automatisch enthalten und müssen nicht registriert werden. (4) Neue Plugin-Management-Artisan-Befehle: native:plugin:create (Plugin-Gerüst), native:plugin:register, native:plugin:list, native:plugin:uninstall, native:plugin:validate, native:plugin:make-hook (Lifecycle-Hook). (5) Bridge Functions: Plugins kommunizieren mit nativem Code über standardisierte Bridge Functions – Aufruf von Swift/Kotlin aus PHP via nativephp_call(); jedes Plugin deklariert seine Bridge Functions in einem nativephp.json-Manifest. Wer Core-APIs nur über Facades nutzt, ist nicht betroffen. (6) Plugin Marketplace: Fertige Plugins gibt es im NativePHP Plugin Marketplace.

REBUILD ERFORDERLICH: Nach jedem Upgrade muss die native App neu gebaut werden: `php artisan native:install --force` (erstellt das nativephp-Verzeichnis komplett neu mit v3-Dateien) und `php artisan native:run`.

Relevanz für den Implementierungsplan (Laravel + Livewire + Flux UI): Bei Neuinstallation direkt v3.1 verwenden (kein privates Repo/Lizenz-Setup für composer mehr nötig), SDK-Level über config/nativephp.php bzw. NATIVEPHP_ANDROID_*-Env-Variablen steuern, intl/ICU bei Bedarf via --with-icu einplanen (App-Größe beachten), native Zusatzfunktionen als Plugins denken und in NativeServiceProvider registrieren.

### Befehle

```bash
composer update
php artisan native:install --force
php artisan native:run
php artisan vendor:publish --tag=nativephp-plugins-provider
php artisan native:plugin:register vendor/some-plugin
php artisan native:plugin:create
php artisan native:plugin:register
php artisan native:plugin:list
php artisan native:plugin:uninstall
php artisan native:plugin:validate
php artisan native:plugin:make-hook
```

### APIs

- app/Providers/NativeServiceProvider.php — wird via vendor:publish --tag=nativephp-plugins-provider erzeugt; zentrale Registrierungsstelle für Drittanbieter-Plugins (Sicherheitsmaßnahme: nur registrierte Plugins werden nativ kompiliert)
- nativephp_call() — PHP-Funktion zum Aufruf nativer Swift-/Kotlin-Bridge-Functions aus Plugins
- Core-API-Facades (Camera, Biometrics, Dialog, Scanner, Geolocation usw.) — bleiben in v3 unverändert nutzbar, intern nun als Plugins implementiert; zugehörige Events bleiben gleich
- nativephp.json — Plugin-Manifest, in dem jedes Plugin seine Bridge Functions deklariert
- PHP intl-Extension — ab v3.1 dank ICU-Support auf iOS UND Android verfügbar
- Plugins — Standard-Composer-Pakete mit Swift- (iOS) und Kotlin- (Android) Code; Lifecycle-Hooks via native:plugin:make-hook

### Konfiguration

- composer.json require: "nativephp/mobile": "~3.1.0" (bzw. "~3.0.0" für v3.0)
- composer.json: repositories-Eintrag {"type":"composer","url":"https://nativephp.composer.sh"} entfernen (v3 braucht kein privates Repo mehr)
- auth.json: gespeicherte Credentials für nativephp.composer.sh entfernen
- config/nativephp.php — 'android' => ['compile_sdk' => env('NATIVEPHP_ANDROID_COMPILE_SDK', 36), 'min_sdk' => env('NATIVEPHP_ANDROID_MIN_SDK', 33), 'target_sdk' => env('NATIVEPHP_ANDROID_TARGET_SDK', 36)]
- Env-Variablen: NATIVEPHP_ANDROID_COMPILE_SDK (Default 36), NATIVEPHP_ANDROID_MIN_SDK (Default 33), NATIVEPHP_ANDROID_TARGET_SDK (Default 36)
- Install-Flags: --with-icu / --without-icu (ICU/intl-Unterstützung optional; ca. +30 MB Android, +100 MB iOS)

### Stolperfallen

- --force bei native:install ist Pflicht beim Upgrade: native Projektdateien, PHP-Binaries und Config werden sonst nicht aktualisiert; das nativephp-Verzeichnis wird komplett neu erstellt
- Nach jedem Upgrade muss die native App neu gebaut werden (native:install --force + native:run)
- v3.1 ist ein Drop-in-Upgrade ohne Breaking Changes gegenüber 3.0
- v3 benötigt KEIN privates Composer-Repository und KEINE Lizenz-Authentifizierung mehr (nativephp.composer.sh + auth.json-Credentials entfernen)
- Drittanbieter-Plugins müssen im NativeServiceProvider registriert werden, BEVOR ihr nativer Code kompiliert wird (Sicherheitsmaßnahme); Core-APIs aus nativephp/mobile sind automatisch enthalten und brauchen keine manuelle Registrierung
- Android-8+-Support (API 26) erfordert den 'android'-SDK-Block in config/nativephp.php; die Doku-Defaults sind allerdings min_sdk 33 / compile_sdk 36 / target_sdk 36 — für API 26 muss min_sdk via Env/Config entsprechend gesenkt werden; keine Codeänderungen, rein Build-Ebene
- ICU/intl auf iOS erst ab v3.1 (vorher nur Android); ICU optional und vergrößert die App deutlich (~30 MB Android, ~100 MB iOS)
- Core-APIs sind in v3 intern Plugins — Facades und Events bleiben identisch, kein Migrationsaufwand im PHP-Code
- Bridge Functions (nativephp_call, nativephp.json-Manifest) sind nur relevant, wenn man eigene Plugins baut; reine Facade-Nutzung bleibt unverändert
- Fertige Drittanbieter-Plugins sind über den NativePHP Plugin Marketplace verfügbar

---

## NativePHP Mobile v3 — Getting Started: Environment Setup

<https://nativephp.com/docs/mobile/3/getting-started/environment-setup>

Die Seite beschreibt die komplette Entwicklungsumgebung für NativePHP Mobile v3 (iOS + Android), bevor das Paket installiert wird.

ALLGEMEINE VORAUSSETZUNGEN: PHP 8.3+ und Laravel 11+. Als einfachster Weg, PHP auf Mac und Windows zu betreiben, wird Laravel Herd empfohlen.

iOS: iOS-Apps können AUSSCHLIESSLICH auf einem Mac kompiliert werden (Apple-Restriktion), benötigt wird ein Apple-Silicon-Mac (M1 oder neuer). Erforderlich: Xcode 16.0+ (aus dem Mac App Store), Xcode Command Line Tools (`xcode-select --install`, Verifizierung mit `xcode-select -p`), Homebrew (Install-Skript per curl) und CocoaPods (`brew install cocoapods`, Verifizierung `pod --version`). Ein iOS-Gerät ist optional. Ein Apple Developer Account ist NICHT nötig für Entwicklung/Tests im iOS-Simulator, aber ERFORDERLICH für Tests auf echten Geräten, App-Store-Distribution und Features wie Push Notifications (kostenpflichtiges Konto). Für Echtgerät-Tests: Developer Mode auf dem Gerät aktivieren und das Gerät im Apple Developer Account als registriertes Gerät hinzufügen.

ANDROID: Erforderlich sind Android Studio 2024.2.1+ und das Android SDK mit API-Level 29 oder höher (aktuell bis Android 16 / API 36); unter Windows zusätzlich 7zip. Das JDK muss ggf. separat installiert werden, da neuere Android-Studio-Versionen es nicht mehr automatisch mitliefern — die Beispiele verwenden JDK 17 (macOS: `/usr/libexec/java_home -v 17`; Windows: Microsoft JDK 17.0.8.7-hotspot). Die JDK/Gradle-Versionskompatibilität prüft man nach `php artisan native:install` im Ordner `nativephp/android/.gradle`. SDK-Installation über Android Studio: Tools → SDK Manager; im Tab "SDK Platforms" mindestens eine Plattform mit API 29+ installieren, im Tab "SDK Tools" sicherstellen, dass "Android SDK Build-Tools" und "Android SDK Platform-Tools" installiert sind. Vorbereitung/Verifikation im Terminal: `java -version` und `adb devices` müssen funktionieren; Umgebungsvariablen JAVA_HOME und ANDROID_HOME setzen und PATH erweitern (emulator, tools, tools/bin, platform-tools). Fehler "No AVDs found": In Android Studio unter Virtual Devices mindestens ein virtuelles Gerät anlegen.

TESTEN AUF ECHTEN GERÄTEN: Ein physisches Gerät ist zum Kompilieren/Testen nicht nötig, da iOS-Simulator und Android-Emulatoren unterstützt werden; vor Store-Submission wird das Testen auf echten Geräten aber empfohlen. Android-Echtgeräte: Developer Options und USB Debugging (ADB) aktivieren.

Weiterführende Doku-Seiten derselben Sektion: Installation (/docs/mobile/3/getting-started/installation), Configuration, Development, Deployment, Command Reference (/docs/mobile/3/getting-started/commands).

Für den geplanten Einsatz (Laravel 12 + Livewire + Flux UI App): Diese Seite enthält nur die Toolchain-Voraussetzungen; die eigentliche Paketinstallation (`php artisan native:install`) und Konfiguration folgen auf den Folgeseiten.

### Befehle

```bash
xcode-select --install
xcode-select -p
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
brew install cocoapods
pod --version
java -version
adb devices
php artisan native:install (erwähnt im Kontext: danach Gradle-Version in nativephp/android/.gradle prüfen)
export JAVA_HOME=$(/usr/libexec/java_home -v 17)  # macOS
export ANDROID_HOME=$HOME/Library/Android/sdk  # macOS
export PATH=$PATH:$JAVA_HOME/bin:$ANDROID_HOME/emulator:$ANDROID_HOME/tools:$ANDROID_HOME/tools/bin:$ANDROID_HOME/platform-tools  # macOS
set ANDROID_HOME=C:\Users\yourname\AppData\Local\Android\Sdk  # Windows
set JAVA_HOME=C:\Program Files\Microsoft\jdk-17.0.8.7-hotspot  # Windows
set PATH=%PATH%;%JAVA_HOME%\bin;%ANDROID_HOME%\platform-tools  # Windows
```

### APIs

- Keine PHP/JS-APIs, Klassen, Facades oder Events auf dieser Seite — sie behandelt ausschließlich die Toolchain-Einrichtung
- php artisan native:install — einziger erwähnter Artisan-Befehl (erzeugt u. a. nativephp/android/.gradle, dort Gradle/JDK-Kompatibilität prüfen)

### Konfiguration

- JAVA_HOME — Pfad zum JDK (Beispiele nutzen JDK 17; macOS: /usr/libexec/java_home -v 17, Windows: Microsoft jdk-17.0.8.7-hotspot)
- ANDROID_HOME — Pfad zum Android SDK (macOS: $HOME/Library/Android/sdk; Windows: C:\Users\<name>\AppData\Local\Android\Sdk)
- PATH — muss $JAVA_HOME/bin sowie $ANDROID_HOME/emulator, tools, tools/bin und platform-tools enthalten
- Android SDK Manager: SDK Platforms mit API 29+ (bis Android 16 / API 36), SDK Tools: 'Android SDK Build-Tools' und 'Android SDK Platform-Tools'
- Keine .env-Variablen, config-Dateien oder AndroidManifest/Info.plist-Berechtigungen auf dieser Seite (folgen auf der Configuration-Seite)

### Stolperfallen

- PHP 8.3+ und Laravel 11+ sind Mindestvoraussetzungen (Projekt erfüllt das mit PHP 8.5/Laravel 12)
- iOS-Apps lassen sich NUR auf einem Mac kompilieren (Apple-Restriktion); benötigt Apple Silicon (M1 oder neuer) — das Linux-Arbeitssystem des Users kann daher nur Android bauen
- Xcode mindestens Version 16.0; zusätzlich Command Line Tools, Homebrew und CocoaPods nötig
- Apple Developer Account nicht nötig für Simulator-Entwicklung, aber Pflicht für Echtgerät-Tests, App-Store-Distribution und Push Notifications (kostenpflichtig)
- iOS-Echtgerät: Developer Mode aktivieren und Gerät im Apple Developer Account registrieren
- Android Studio mindestens 2024.2.1; Android SDK API 29+ erforderlich
- Neuere Android-Studio-Versionen installieren das JDK nicht mehr automatisch — JDK (17 in den Beispielen) ggf. separat installieren; Gradle/JDK-Kompatibilität nach php artisan native:install in nativephp/android/.gradle prüfen
- Unter Windows wird zusätzlich 7zip benötigt
- java -version und adb devices müssen im Terminal funktionieren, sonst schlägt der Build fehl
- Fehler 'No AVDs found': in Android Studio unter Virtual Devices mindestens einen Emulator anlegen
- Kein physisches Gerät zum Entwickeln nötig (Simulator/Emulator werden unterstützt), aber Echtgerät-Test vor Store-Submission empfohlen; Android-Gerät braucht Developer Options + USB Debugging (ADB)
- Lizenzhinweise (NativePHP-Lizenzschlüssel) stehen nicht auf dieser Seite — vermutlich auf der Installation-Seite
- Folgeseiten der Sektion: installation, configuration, development, deployment, commands (Command Reference)

---

## NativePHP Mobile v3 — Getting Started: Installation

<https://nativephp.com/docs/mobile/3/getting-started/installation>

Die Seite beschreibt die Installation von NativePHP for Mobile v3 in einer Laravel-Anwendung in vier Schritten. (1) Composer-Paket installieren: Das Paket `nativephp/mobile` enthält alle Libraries, Klassen, Commands und Interfaces, die die App für die Arbeit mit iOS und Android benötigt; empfohlen wird eine frische Laravel-Anwendung als Basis. (2) Installer ausführen: Vor dem Ausführen von `php artisan native:install` muss in der `.env` zwingend `NATIVEPHP_APP_ID` (Reverse-Domain-Format, z. B. com.yourcompany.yourapp) gesetzt werden; optional kann `NATIVEPHP_DEVELOPMENT_TEAM` mit der Apple-Developer-Team-ID gesetzt werden. Der Installer fragt interaktiv, ob ICU-fähige PHP-Binaries installiert werden sollen — nötig, wenn die App die `intl`-Extension benötigt (Hinweis: Filament erfordert `intl`, also ICU-Binaries wählen). (3) Nach der Installation entsteht im Projekt-Root ein `nativephp`-Verzeichnis mit den nativen Projektdateien (Xcode/Android); es ist als ephemer zu betrachten und gehört in die `.gitignore` (Neuaufbau jederzeit via `php artisan native:install --force`). (4) App starten mit `php artisan native:run` (startet die App im Simulator/Emulator oder auf einem echten Gerät). Für echte Geräte gilt: iOS-Geräte müssen den Developer Mode aktiviert haben und im Apple-Developer-Account registriert sein; Android-Geräte benötigen aktivierte Entwickleroptionen und USB-Debugging (ADB). Windows-spezifische Hinweise: `C:\temp` und den Projektordner zu den Windows-Defender-Ausnahmen hinzufügen, um Composer-Installs beim Kompilieren zu beschleunigen; NativePHP funktioniert NICHT in WSL — auf Windows muss direkt nativ gearbeitet werden. Die Seite verlinkt auf die vorherige Doku-Seite "Environment Setup" (Voraussetzungen wie Xcode/Android Studio stehen dort, nicht hier) und auf die Folgeseite "Configuration". Lizenz-/Pricing-Angaben enthält diese Seite nicht (auf der Website werden nur kommerzielle Angebote wie "NativePHP Ultra", Masterclass, Plugin Dev Kit, Consulting erwähnt). Für den geplanten Einsatz mit Laravel + Livewire + Flux UI relevant: Standard-Laravel-App genügt als Basis; falls intl gebraucht wird (z. B. Number/Date-Formatting), bei der ICU-Frage des Installers ICU-Binaries wählen.

### Befehle

```bash
composer require nativephp/mobile
php artisan native:install
php artisan native:install --force
php artisan native:run
```

### APIs

- Keine PHP/JS-APIs (Klassen, Facades, Methoden, Events) auf dieser Seite dokumentiert — das Paket nativephp/mobile wird nur allgemein als Sammlung von 'libraries, classes, commands, and interfaces' beschrieben; konkrete APIs folgen auf späteren Doku-Seiten

### Konfiguration

- NATIVEPHP_APP_ID=com.yourcompany.yourapp — erforderlich, eindeutige App-ID im Reverse-Domain-Format; muss VOR php artisan native:install in der .env gesetzt sein
- NATIVEPHP_DEVELOPMENT_TEAM={your team ID} — optional, Apple-Developer-Team-ID für iOS-Builds/Signierung
- .gitignore: das generierte Verzeichnis nativephp/ (Projekt-Root) eintragen, da ephemer und jederzeit neu generierbar
- Windows Defender: C:\temp und den Projektordner als Ausnahmen hinzufügen (beschleunigt Composer-Installs bei der Kompilierung)
- Keine AndroidManifest-/Info.plist-Berechtigungen auf dieser Seite dokumentiert

### Stolperfallen

- WSL wird nicht unterstützt: NativePHP muss auf Windows direkt (nativ) installiert und ausgeführt werden
- NATIVEPHP_APP_ID muss zwingend vor dem ersten native:install gesetzt sein
- ICU-Prompt beim Installer: ICU-fähige PHP-Binaries wählen, wenn die App die intl-Extension benötigt — Filament setzt intl voraus
- Das generierte nativephp/-Verzeichnis ist ephemer: nicht committen, Änderungen darin gehen bei Neuaufbau (native:install --force) verloren
- Echte iOS-Geräte: Developer Mode aktivieren und Gerät im Apple-Developer-Account registrieren (Apple-Developer-Account nötig)
- Echte Android-Geräte: Entwickleroptionen und USB-Debugging (ADB) aktivieren
- Empfehlung: frische Laravel-App als Ausgangspunkt für das NativePHP-Projekt
- Systemvoraussetzungen (PHP-/Laravel-Version, Xcode, Android Studio, SDKs) stehen NICHT auf dieser Seite, sondern auf der vorgelagerten Seite 'Environment Setup' — für den Implementierungsplan zusätzlich abrufen
- Lizenz-/Pricing-Hinweise fehlen auf dieser Seite; ein Lizenzschlüssel wird im Installationsablauf v3 nicht erwähnt

---

## NativePHP Mobile v3 — Getting Started: Configuration

<https://nativephp.com/docs/mobile/3/getting-started/configuration>

Die Seite beschreibt die komplette Konfiguration von NativePHP Mobile v3. Grundprinzip: Fast alles wird in der Laravel-App konfiguriert (zentrale Datei: config/nativephp.php), sodass man Xcode-/Android-Studio-Dateien praktisch nie manuell anfassen muss.

Kernpunkte pro Abschnitt:

1) App-Identität: NATIVEPHP_APP_ID muss eindeutig sein (Reverse-DNS-Stil, z. B. com.yourcompany.yourapp); dient als Bundle Identifier für iOS UND Android. NATIVEPHP_APP_VERSION ist der öffentliche Versionsstring (App Stores/Geräteeinstellungen), Default in der Entwicklung ist "DEBUG"; Releases sollen über `php artisan native:release` geschnitten werden statt die .env manuell zu editieren. NATIVEPHP_APP_VERSION_CODE ist die interne Build-Nummer (für Nutzer nie sichtbar).

2) Persistent Runtime (ab v3.1): config-Sektion 'runtime' mit 'mode' (env NATIVEPHP_RUNTIME_MODE, Default 'persistent' = Laravel-Kernel wird wiederverwendet; Alternative 'classic' = Boot/Shutdown pro Request), 'reset_instances' (true: aufgelöste Facade-Instanzen zwischen Dispatches zurücksetzen) und 'gc_between_dispatches' (false; Garbage Collection zwischen Dispatches bei Speicherwachstum aktivieren).

3) Deep Links: 'deeplink_scheme' (NATIVEPHP_DEEPLINK_SCHEME) für eigene URL-Schemes wie myapp://some/path und 'deeplink_host' (NATIVEPHP_DEEPLINK_HOST) für verifizierte HTTPS-Links/NFC-Tags.

4) Start URL: 'start_url' (NATIVEPHP_START_URL, Default '/') legt den initialen Pfad beim App-Start fest (z. B. /dashboard, /onboarding). Für die geplante Livewire/Flux-App relevant, um direkt auf eine bestimmte Route zu starten.

5) Cleanup: 'cleanup_env_keys' = Array von .env-Keys, die vor dem Bundling entfernt werden (sensible API-Keys/Secrets); 'cleanup_exclude_files' = Array von Dateien/Ordnern, die vor dem Bundling entfernt werden (Logs, temporäre Dateien).

6) Orientation: getrennte Blöcke für 'iphone' und 'android' mit jeweils portrait/upside_down/landscape_left/landscape_right (bool, Default nur portrait=true). Hinweis: iPad unterstützt IMMER alle Orientierungen, unabhängig von den iPhone-Einstellungen.

7) iPad-Support: 'ipad' => true. Warnung "Once iPad, Always iPad": Einmal mit iPad-Support veröffentlicht, lässt sich das nicht rückgängig machen; sonst neue NATIVEPHP_APP_ID + neues App-Store-Listing nötig.

8) Android SDK-Versionen: 'android.compile_sdk' (Default 36), 'android.min_sdk' (Default 33, absolutes Minimum 26 = Android 8), 'android.target_sdk' (Default 36). Pflicht-Relation: compile_sdk >= target_sdk >= min_sdk.

9) Android Build: 'android.build' mit minify_enabled (false), shrink_resources (false), obfuscate (false), debug_symbols ('FULL'), parallel_builds (true), incremental_builds (true). Für Play-Store-Submissions wird empfohlen, minify_enabled und shrink_resources zu aktivieren (kleinere APK).

10) Android Status Bar: 'android.status_bar_style' (NATIVEPHP_ANDROID_STATUS_BAR_STYLE), Werte: 'auto', 'light' (weiße Icons), 'dark' (dunkle Icons).

11) Development Server: 'server' mit http_port (3000), ws_port (8081), service_name ('NativePHP Server'), open_browser (true). Wird von den Befehlen `native:jump` und `native:watch` genutzt.

12) Hot Reload: 'hot_reload.watch_paths' = ['app','resources','routes','config','public'] und 'hot_reload.exclude_patterns' = ['\.git','storage','node_modules'].

13) Development Team (iOS): 'development_team' (NATIVEPHP_DEVELOPMENT_TEAM) = Apple Developer Team ID für Code Signing; zu finden im Apple-Developer-Account unter Membership.

14) iOS Permission Strings: 'permissions'-Array überschreibt die von Plugins deklarierten Info.plist-Usage-Descriptions (Beispiele: NSCameraUsageDescription, NSMicrophoneUsageDescription, NSPhotoLibraryUsageDescription). Wird NACH dem Merge aller Plugin-Manifeste angewendet. Nur iOS — Android behandelt Permission-Begründungen zur Laufzeit.

15) App Store Connect API: 'app_store_connect' mit api_key, api_key_id, api_issuer_id, app_name (env: APP_STORE_API_KEY, APP_STORE_API_KEY_ID, APP_STORE_API_ISSUER_ID, APP_STORE_APP_NAME). Wird von `native:package --upload-to-app-store` genutzt. Credentials in .env speichern (nie committen) und für Produktions-Builds in cleanup_env_keys eintragen.

Navigationskontext: Die Seite liegt in der Sektion "Getting Started" zwischen "Installation" (davor) und "Development" (danach). Die Seite definiert keine eigenen PHP-Laufzeit-APIs (Facades/Events), sondern ausschließlich Konfiguration; das Runtime-Verhalten (persistent vs. classic) ist aber für Livewire-Apps wichtig, da der Laravel-Kernel zwischen Requests wiederverwendet wird (Singleton-/State-Leaks beachten, reset_instances/gc als Stellschrauben).

### Befehle

```bash
php artisan native:release
php artisan native:jump
php artisan native:watch
php artisan native:package --upload-to-app-store
```

### APIs

- config/nativephp.php — zentrale Konfigurationsdatei; nahezu alle native Einstellungen werden hier (statt in Xcode/Android Studio) gepflegt
- runtime.mode = 'persistent' (Default, ab v3.1) — Laravel-Kernel wird zwischen Requests wiederverwendet; 'classic' = vollständiger Boot/Shutdown pro Request
- runtime.reset_instances (bool, true) — setzt aufgelöste Facade-Instanzen zwischen Dispatches zurück
- runtime.gc_between_dispatches (bool, false) — Garbage Collection zwischen Dispatches gegen Speicherwachstum
- Keine eigenen PHP-Klassen/Facades/Events auf dieser Seite — reine Konfigurationsreferenz

### Konfiguration

- NATIVEPHP_APP_ID — eindeutige App-/Bundle-ID im Reverse-DNS-Stil (com.yourcompany.yourapp), gilt für iOS und Android
- NATIVEPHP_APP_VERSION — öffentlicher Versionsstring (Stores/Einstellungen), Default in Dev: DEBUG
- NATIVEPHP_APP_VERSION_CODE — interne Build-Nummer, nie für Nutzer sichtbar
- NATIVEPHP_RUNTIME_MODE — 'persistent' (Default) oder 'classic' (config: runtime.mode)
- NATIVEPHP_DEEPLINK_SCHEME — eigenes URL-Scheme, z. B. myapp:// (config: deeplink_scheme)
- NATIVEPHP_DEEPLINK_HOST — Host für verifizierte HTTPS-Links/NFC-Tags (config: deeplink_host)
- NATIVEPHP_START_URL — initialer Pfad beim App-Start, Default '/' (config: start_url)
- config cleanup_env_keys — Array von .env-Keys, die vor dem Bundling entfernt werden (Secrets)
- config cleanup_exclude_files — Array von Dateien/Ordnern, die vor dem Bundling entfernt werden (Logs, Temp)
- config orientation.iphone / orientation.android — portrait, upside_down, landscape_left, landscape_right (bool; Default nur portrait=true)
- config ipad => true — aktiviert iPad-Support
- NATIVEPHP_ANDROID_COMPILE_SDK — Default 36 (config: android.compile_sdk)
- NATIVEPHP_ANDROID_MIN_SDK — Default 33, Minimum 26 (config: android.min_sdk)
- NATIVEPHP_ANDROID_TARGET_SDK — Default 36 (config: android.target_sdk)
- NATIVEPHP_ANDROID_MINIFY_ENABLED — Default false (config: android.build.minify_enabled)
- NATIVEPHP_ANDROID_SHRINK_RESOURCES — Default false (config: android.build.shrink_resources)
- NATIVEPHP_ANDROID_OBFUSCATE — Default false (config: android.build.obfuscate)
- NATIVEPHP_ANDROID_DEBUG_SYMBOLS — Default 'FULL' (config: android.build.debug_symbols)
- NATIVEPHP_ANDROID_PARALLEL_BUILDS — Default true (config: android.build.parallel_builds)
- NATIVEPHP_ANDROID_INCREMENTAL_BUILDS — Default true (config: android.build.incremental_builds)
- NATIVEPHP_ANDROID_STATUS_BAR_STYLE — 'auto' (Default), 'light' (weiße Icons), 'dark' (dunkle Icons)
- NATIVEPHP_HTTP_PORT — Default 3000 (config: server.http_port)
- NATIVEPHP_WS_PORT — Default 8081 (config: server.ws_port)
- NATIVEPHP_SERVICE_NAME — Default 'NativePHP Server' (config: server.service_name)
- NATIVEPHP_OPEN_BROWSER — Default true (config: server.open_browser)
- config hot_reload.watch_paths — ['app','resources','routes','config','public']
- config hot_reload.exclude_patterns — ['\.git','storage','node_modules']
- NATIVEPHP_DEVELOPMENT_TEAM — Apple Developer Team ID für iOS Code Signing (config: development_team)
- config permissions — iOS Info.plist Usage-Descriptions überschreiben, z. B. NSCameraUsageDescription, NSMicrophoneUsageDescription, NSPhotoLibraryUsageDescription (wird nach dem Merge aller Plugin-Manifeste angewendet; nur iOS)
- APP_STORE_API_KEY / APP_STORE_API_KEY_ID / APP_STORE_API_ISSUER_ID / APP_STORE_APP_NAME — App Store Connect API für native:package --upload-to-app-store (config: app_store_connect.api_key/api_key_id/api_issuer_id/app_name)

### Stolperfallen

- 'Once iPad, Always iPad': Einmal mit iPad-Support veröffentlicht, kann das nicht rückgängig gemacht werden — Entfernen erfordert eine neue NATIVEPHP_APP_ID und ein neues App-Store-Listing
- iPad unterstützt immer ALLE Orientierungen, unabhängig von den iPhone-Orientation-Einstellungen
- Android min_sdk: niedrigster unterstützter Wert ist 26 (Android 8); niedrigere Werte werden nicht unterstützt
- SDK-Versions-Relation muss eingehalten werden: compile_sdk >= target_sdk >= min_sdk
- NATIVEPHP_APP_VERSION nicht manuell in .env für Releases editieren — stattdessen php artisan native:release verwenden
- App-Store-Connect-Credentials nur in .env speichern (niemals committen) und für Produktions-Builds zusätzlich in cleanup_env_keys aufnehmen, damit sie nicht ins App-Bundle gelangen
- cleanup_env_keys/cleanup_exclude_files nutzen, um Secrets, Logs und temporäre Dateien vor dem Bundling zu entfernen — die .env wird sonst mit ausgeliefert
- iOS-Permission-Strings (permissions-Array) gelten nur für iOS; Android regelt Permission-Begründungen zur Laufzeit
- Persistent Runtime (Default ab v3.1) hält den Laravel-Kernel zwischen Requests am Leben — bei State-/Memory-Problemen reset_instances bzw. gc_between_dispatches einsetzen oder auf 'classic' umstellen (relevant für Livewire-Apps mit Singletons/statischem State)
- Für Play-Store-Submissions minify_enabled und shrink_resources aktivieren, um die APK-Größe zu reduzieren
- Apple Developer Team ID (Voraussetzung für iOS-Signing) findet sich im Apple-Developer-Account unter Membership
- Seite ist Teil von 'Getting Started' (vorher: Installation, danach: Development); explizite Lizenzhinweise enthält die Seite nicht

---

## NativePHP Mobile v3 — Getting Started: Development

<https://nativephp.com/docs/mobile/3/getting-started/development>

Die Seite beschreibt den Entwicklungs-Workflow mit NativePHP Mobile v3 (Vorherige Seite: Configuration, nächste Seite: Deployment).

1) Frontend bauen: Wer Vite (o.ä.) nutzt, muss vor dem Kompilieren der App die Assets bauen. Dafür gibt es ein eigenes Vite-Plugin: In vite.config.js werden `nativephpMobile` und `nativephpHotFile` aus './vendor/nativephp/mobile/resources/js/vite-plugin.js' importiert; im laravel()-Plugin wird `hotFile: nativephpHotFile()` gesetzt und `nativephpMobile()` als zusätzliches Plugin registriert (neben tailwindcss()). Die Builds erfolgen pro Plattform getrennt: `npm run build -- --mode=ios` und `npm run build -- --mode=android`. Inertia-3-Hinweis: Frische Inertia-3-Projekte deklarieren axios nicht mehr als Dependency — der NativePHP-Build schlägt fehl, bis axios explizit installiert wird (`npm install axios`).

2) App kompilieren: `php artisan native:run` — ein einziger Befehl, der Kompilierung und Deployment übernimmt („takes care of everything"), ohne dass man native Editoren/Tools lernen muss. Während der Entwicklung soll `NATIVEPHP_APP_VERSION=DEBUG` gesetzt bleiben, damit die Laravel-App im nativen Container immer neu geladen/aktualisiert wird.

3) Arbeiten mit Xcode/Android Studio: `php artisan native:open` öffnet das native Projekt direkt in der jeweiligen IDE. Mit `--help` lassen sich Command-Optionen anzeigen und interaktive Prompts überspringen.

4) Plattform-Erkennung in PHP: Facade `Native\Mobile\Facades\System` mit `System::isIos()` und `System::isAndroid()`.

5) Hot Reloading: `php artisan native:watch` (oder alternativ `php artisan native:run --watch`). Zu überwachende Ordner werden in config/nativephp.php unter `hot_reload.watch_paths` konfiguriert (Default-Beispiel: app, routes, config, database, public). HMR: Vite-Hot-File wie oben konfigurieren; bei echten Geräten müssen Testgerät und Entwicklungsrechner im selben WLAN sein. Volles Hot Reloading funktioniert am besten auf Simulatoren. Auf macOS können beide Plattform-Watcher parallel laufen (`php artisan native:watch ios` und `php artisan native:watch android` in zwei Terminals). Die Hot-Files `public/ios-hot` und `public/android-hot` gehören in die .gitignore. Einschränkung: Volles Hot Reloading für Nicht-JavaScript-Änderungen auf physischen iOS-Geräten ist noch nicht verfügbar.

6) Laravel-Boost-Integration: `php artisan boost:install` ausführen und den Prompts folgen, um NativePHP mit Laravel Boost für KI-gestützte Entwicklung zu aktivieren.

Relevanz für eine Laravel + Livewire + Flux-UI-App: Der Workflow ist Frontend-unabhängig (Vite-Build mit --mode pro Plattform gilt auch für Livewire/Flux-Assets); Server-seitige Plattform-Weichen können über System::isIos()/isAndroid() in Blade/Livewire-Komponenten erfolgen; für schnelle Iteration native:watch + watch_paths (Livewire-Komponenten liegen unter app/ und resources/ — resources ist im Default-Beispiel der watch_paths nicht aufgeführt, ggf. ergänzen).

### Befehle

```bash
npm run build -- --mode=ios
npm run build -- --mode=android
npm install axios
php artisan native:run
php artisan native:run --watch
php artisan native:run --help
php artisan native:open
php artisan native:watch
php artisan native:watch ios
php artisan native:watch android
php artisan boost:install
```

### APIs

- Native\Mobile\Facades\System — Facade zur Plattform-Erkennung
- System::isIos() — gibt true auf iOS zurück
- System::isAndroid() — gibt true auf Android zurück
- JS/Vite: import { nativephpMobile, nativephpHotFile } from './vendor/nativephp/mobile/resources/js/vite-plugin.js'
- nativephpMobile() — Vite-Plugin, in plugins-Array von vite.config.js registrieren
- nativephpHotFile() — liefert den Hot-File-Pfad; im laravel()-Vite-Plugin als hotFile: nativephpHotFile() setzen (input: ['resources/css/app.css','resources/js/app.js'], refresh: true)

### Konfiguration

- NATIVEPHP_APP_VERSION=DEBUG — während der Entwicklung gesetzt lassen, damit die Laravel-App im nativen Container stets aktualisiert wird
- config/nativephp.php: 'hot_reload' => ['watch_paths' => ['app', 'routes', 'config', 'database', 'public']] — überwachte Ordner für native:watch
- vite.config.js: hotFile: nativephpHotFile() im laravel()-Plugin + nativephpMobile() als Plugin
- Hot-Files public/ios-hot und public/android-hot werden erzeugt — in .gitignore aufnehmen
- Keine AndroidManifest.xml-/Info.plist-Berechtigungen auf dieser Seite dokumentiert

### Stolperfallen

- Assets müssen vor dem Kompilieren pro Plattform separat gebaut werden (--mode=ios bzw. --mode=android)
- Inertia 3: axios ist keine Default-Dependency mehr — ohne explizites `npm install axios` schlägt der NativePHP-Build fehl (für Livewire-Projekte nicht relevant)
- NATIVEPHP_APP_VERSION=DEBUG in der Entwicklung beibehalten, sonst wird die Laravel-App im nativen Container nicht neu geladen
- HMR auf echten Geräten: Testgerät und Entwicklungsrechner müssen im selben WLAN sein
- Volles Hot Reloading funktioniert am besten auf Simulatoren; für Nicht-JS-Änderungen auf physischen iOS-Geräten noch nicht verfügbar
- Beide Plattform-Watcher parallel nur auf macOS sinnvoll (iOS-Builds erfordern macOS/Xcode)
- public/ios-hot und public/android-hot in .gitignore eintragen
- --help an die Commands hängen, um Optionen zu sehen und interaktive Prompts zu überspringen
- watch_paths-Default enthält kein resources/ — für Blade/Livewire-Views ggf. ergänzen (eigene Schlussfolgerung, nicht explizit auf der Seite)
- Keine Lizenzhinweise auf dieser Seite; keine Abschnitte zu Secure Storage/Debugging/Logs — Navigation: vorher 'Configuration', danach 'Deployment'

---

## NativePHP Mobile v3 — Getting Started: Deployment

<https://nativephp.com/docs/mobile/3/getting-started/deployment>

Die Seite beschreibt den kompletten Deployment-Prozess einer NativePHP-Mobile-App (v3) in fünf Stufen: Releasing, Testing, Packaging, Store-Review-Einreichung und Publishing — wobei die Seite selbst nur Releasing, Packaging und Versionsverwaltung im Detail behandelt; für Store-Review/Publishing wird auf App Store Connect Help bzw. Play Console Help verwiesen.

RELEASING: Versionen folgen Semantic Versioning (z. B. 1.2.3) und werden über NATIVEPHP_APP_VERSION in der .env verwaltet; beide Stores verlangen pro Release eine hochgezählte Build-Nummer (NATIVEPHP_APP_VERSION_CODE). `php artisan native:release patch|minor|major` bumpt die Version in .env und inkrementiert die Build-Nummer automatisch. Release-Builds (optimiert, kleiner, schneller) erzeugt `php artisan native:run --build=release`.

PACKAGING: `php artisan native:package` erstellt signierte, produktionsreife Distributionen. Voraussetzungen: fertig entwickelte/getestete App auf beiden Plattformen, gültige Bundle-ID/App-ID in der config/nativephp.php, Android-Keystore mit Key-Alias, iOS-Zertifikate + Provisioning-Profile aus dem Apple Developer Program.

ANDROID: `php artisan native:credentials android` generiert einen JKS-Keystore, legt Signing-Keys an, schreibt Credentials in die .env und ergänzt .gitignore. Signier-Credentials wahlweise als CLI-Optionen (--keystore, --keystore-password, --key-alias, --key-password) oder Env-Variablen (ANDROID_KEYSTORE_FILE, ANDROID_KEYSTORE_PASSWORD, ANDROID_KEY_ALIAS, ANDROID_KEY_PASSWORD). `native:package android` erzeugt eine signierte app-release.apk; mit --build-type=bundle eine app-release.aab für den Play Store. Direkter Play-Store-Upload via --upload-to-play-store mit --play-store-track (internal/alpha/beta/production) und --google-service-key (Service-Account-JSON). --test-push=/pfad/app-release.aab testet den Upload ohne Rebuild; --skip-prepare überspringt die Build-Vorbereitung bei inkrementellen Builds ohne native Codeänderungen.

iOS: Credentials als Optionen oder Env-Variablen: App Store Connect API-Key (.p8: --api-key-path/APP_STORE_API_KEY_PATH, --api-key-id/APP_STORE_API_KEY_ID, --api-issuer-id/APP_STORE_API_ISSUER_ID), Distribution-Zertifikat (.p12/.cer: --certificate-path/IOS_DISTRIBUTION_CERTIFICATE_PATH, --certificate-password/IOS_DISTRIBUTION_CERTIFICATE_PASSWORD), Provisioning-Profil (.mobileprovision: --provisioning-profile-path/IOS_DISTRIBUTION_PROVISIONING_PROFILE_PATH), Team-ID (--team-id/IOS_TEAM_ID). API-Key-Setup: App Store Connect → Users & Access → Keys → neuen Key mit Developer-Zugriff anlegen, .p8 sofort herunterladen, Key-ID und Issuer-ID notieren. Export-Methoden (--export-method): app-store (Default), ad-hoc (registrierte Geräte), enterprise (Enterprise-Programm nötig), development. Upload zu App Store Connect via --upload-to-app-store. Weitere Flags: --validate-profile (zeigt Profilname, Entitlements, Push-Support, Associated Domains, APS-Environment), --test-upload (Upload einer bestehenden IPA testen ohne Rebuild), --clean-caches (Xcode-Caches leeren), --rebuild (sauberer Neuaufbau), --validate-only (nur validieren, kein Export).

VERSION MANAGEMENT: Beim AAB-Build mit Google-Service-Credentials fragt NativePHP automatisch die höchste Build-Nummer im Play Store ab und inkrementiert sie; --jump-by=10 addiert 10 auf den berechneten Version-Code.

TROUBLESHOOTING: Keystore-Fehler mit `keytool -list -v -keystore /pfad` prüfen (Datei, Passwörter, Alias); Build-Fehler → aktuelles Android SDK/Build-Tools und intaktes nativephp/android-Verzeichnis; Play-Upload-Fehler → Service-Account-Berechtigungen, gültige Key-Datei, übereinstimmende Bundle-ID. --output für eigenes Ausgabeverzeichnis, --no-tty für CI/non-interaktive Umgebungen. Artefakte: APK unter nativephp/android/app/build/outputs/apk/release/app-release.apk, AAB unter nativephp/android/app/build/outputs/bundle/release/app-release.aab, IPA im Xcode-Build-Output.

Die Seite bewirbt zudem den NativePHP-Dienst "Bifrost" ("There's an Easier Way"), der Zertifikate/Provisioning-Profile/Keystores abnimmt und Over-the-air-Updates bietet ("Deploy changes to users instantly without app store approval"). PHP/JS-APIs (Klassen/Facades/Events) kommen auf dieser Seite nicht vor — sie ist rein CLI-/Konfigurations-orientiert.

### Befehle

```bash
php artisan native:release patch
php artisan native:release minor
php artisan native:release major
php artisan native:run --build=release
php artisan native:credentials android
php artisan native:package android --keystore=/path/to/my-app.keystore --keystore-password=mykeystorepassword --key-alias=my-app-key --key-password=mykeypassword
php artisan native:package android --build-type=bundle --keystore=/path/to/my-app.keystore --keystore-password=mykeystorepassword --key-alias=my-app-key --key-password=mykeypassword
php artisan native:package android --build-type=bundle  (Credentials aus .env-Variablen)
php artisan native:package android --build-type=bundle --keystore=... --keystore-password=... --key-alias=... --key-password=... --upload-to-play-store --play-store-track=internal --google-service-key=/path/to/service-account-key.json
php artisan native:package android --test-push=/path/to/app-release.aab --upload-to-play-store --play-store-track=internal --google-service-key=/path/to/service-account-key.json
php artisan native:package android --build-type=bundle --keystore=... --keystore-password=... --key-alias=... --key-password=... --skip-prepare
php artisan native:package android --build-type=bundle --keystore=... --keystore-password=... --key-alias=... --key-password=... --google-service-key=/path/to/service-account-key.json  (Auto-Increment der Build-Nummer aus dem Play Store)
php artisan native:package android --build-type=bundle --keystore=... --keystore-password=... --key-alias=... --key-password=... --jump-by=10
php artisan native:package android --build-type=bundle --keystore=... --keystore-password=... --key-alias=... --key-password=... --output=/path/to/custom/directory
php artisan native:package android --build-type=bundle --keystore=... --keystore-password=... --key-alias=... --key-password=... --no-tty
php artisan native:package ios --export-method=app-store --api-key-path=/path/to/api-key.p8 --api-key-id=ABC123DEF --api-issuer-id=01234567-89ab-cdef-0123-456789abcdef --certificate-path=/path/to/distribution.p12 --certificate-password=certificatepassword --provisioning-profile-path=/path/to/profile.mobileprovision --team-id=ABC1234567
php artisan native:package ios --export-method=ad-hoc --certificate-path=/path/to/distribution.p12 --certificate-password=certificatepassword --provisioning-profile-path=/path/to/ad-hoc-profile.mobileprovision
php artisan native:package ios --export-method=development --certificate-path=/path/to/development.p12 --certificate-password=certificatepassword --provisioning-profile-path=/path/to/development-profile.mobileprovision
php artisan native:package ios --export-method=app-store  (Credentials aus .env-Variablen)
php artisan native:package ios --export-method=app-store --api-key-path=... --api-key-id=... --api-issuer-id=... --certificate-path=... --certificate-password=... --provisioning-profile-path=... --team-id=... --upload-to-app-store
php artisan native:package ios --validate-profile --provisioning-profile-path=/path/to/profile.mobileprovision
php artisan native:package ios --test-upload --api-key-path=/path/to/api-key.p8 --api-key-id=ABC123DEF --api-issuer-id=01234567-89ab-cdef-0123-456789abcdef
php artisan native:package ios --export-method=app-store --clean-caches
php artisan native:package ios --export-method=app-store --rebuild
php artisan native:package ios --validate-only
keytool -list -v -keystore /path/to/keystore  (Debug-Hilfe bei Keystore-Fehlern)
```

### APIs

- Keine PHP- oder JS-APIs (Klassen, Facades, Methoden, Events) auf dieser Seite — der gesamte Deployment-Workflow läuft über Artisan-CLI-Befehle (native:release, native:run, native:credentials, native:package)

### Konfiguration

- NATIVEPHP_APP_VERSION (.env) — App-Version nach Semantic Versioning (z. B. 1.2.3); wird von native:release aktualisiert
- NATIVEPHP_APP_VERSION_CODE (.env) — Build-Nummer/Version-Code; muss pro Store-Release inkrementiert werden; wird von native:release auto-inkrementiert
- config/nativephp.php — gültige Bundle-ID und App-ID müssen vor dem Packaging gesetzt sein
- ANDROID_KEYSTORE_FILE — Pfad zur .keystore-Datei (Alternative zu --keystore)
- ANDROID_KEYSTORE_PASSWORD — Keystore-Passwort (--keystore-password)
- ANDROID_KEY_ALIAS — Key-Alias im Keystore (--key-alias)
- ANDROID_KEY_PASSWORD — Key-spezifisches Passwort (--key-password)
- APP_STORE_API_KEY_PATH — Pfad zur .p8-API-Key-Datei aus App Store Connect (--api-key-path)
- APP_STORE_API_KEY_ID — Key-ID aus App Store Connect (--api-key-id)
- APP_STORE_API_ISSUER_ID — Issuer-ID aus App Store Connect (--api-issuer-id)
- IOS_DISTRIBUTION_CERTIFICATE_PATH — Distribution-Zertifikat .p12 oder .cer (--certificate-path)
- IOS_DISTRIBUTION_CERTIFICATE_PASSWORD — Zertifikats-Passwort (--certificate-password)
- IOS_DISTRIBUTION_PROVISIONING_PROFILE_PATH — .mobileprovision-Datei (--provisioning-profile-path)
- IOS_TEAM_ID — Apple Developer Team-ID (--team-id)
- Google Service Account Key (JSON-Datei) für Play-Store-Uploads via --google-service-key
- native:credentials android schreibt die ANDROID_*-Credentials automatisch in .env und ergänzt .gitignore
- Artefakt-Pfade: nativephp/android/app/build/outputs/apk/release/app-release.apk (APK), nativephp/android/app/build/outputs/bundle/release/app-release.aab (AAB), IPA im Xcode-Build-Output

### Stolperfallen

- Deployment umfasst 5 Stufen (Releasing, Testing, Packaging, Review-Einreichung, Publishing), aber die Seite behandelt nur Releasing/Packaging/Versionierung im Detail — für Store-Submission/Review/Publishing wird auf App Store Connect Help und Play Console Help verwiesen; TestFlight/interne Tests werden nicht behandelt
- Voraussetzungen vor dem Packaging: App auf beiden Plattformen fertig entwickelt und getestet; gültige Bundle-ID/App-ID in nativephp.php; Android-Keystore mit gültigem Key-Alias; iOS-Signing-Zertifikate und Provisioning-Profile aus dem (kostenpflichtigen) Apple Developer Program
- Beide Stores verlangen eine pro Release strikt inkrementierte Build-Nummer (NATIVEPHP_APP_VERSION_CODE) — sonst Ablehnung des Uploads
- Warnung der Doku: nicht hetzen — Compliance-Fehler bei der Einreichung führen zur Ablehnung im Store-Review
- .p8-API-Key aus App Store Connect kann nur einmal direkt nach Erstellung heruntergeladen werden — sofort sichern; Key-ID und Issuer-ID notieren
- Export-Methode 'enterprise' erfordert das Apple Enterprise Program; 'ad-hoc' funktioniert nur für registrierte Geräte; Default ist 'app-store'
- Play-Store-Track-Optionen: internal (schnellstes Review), alpha, beta, production
- Auto-Increment der Build-Nummer aus dem Play Store funktioniert nur bei AAB-Builds MIT --google-service-key; --jump-by=N addiert N auf den berechneten Version-Code
- --skip-prepare nur verwenden, wenn sich kein nativer Code geändert hat (inkrementelle Builds)
- Keystore-Fehler: Datei-Existenz, Passwörter und Key-Alias mit keytool prüfen; Build-Fehler: aktuelles Android SDK/Build-Tools und intaktes nativephp/android-Verzeichnis nötig; Play-Upload-Fehler: Service-Account-Berechtigungen und übereinstimmende Bundle-ID prüfen
- iOS-Packaging setzt implizit macOS mit Xcode voraus (IPA wird im Xcode-Build-Output erzeugt; Flags --clean-caches/--rebuild beziehen sich auf Xcode-Caches)
- Für CI/non-interaktive Umgebungen --no-tty verwenden; Credentials dann am besten über Env-Variablen statt CLI-Flags
- Upsell-Hinweis der Doku: NativePHPs Bifrost-Dienst übernimmt Zertifikats-/Keystore-/Provisioning-Komplexität und bietet OTA-Updates ('Deploy changes to users instantly without app store approval'); explizite Lizenzschlüssel-Hinweise enthält die Seite nicht

---

## NativePHP Mobile v3 — Command Reference (Getting Started)

<https://nativephp.com/docs/mobile/3/getting-started/commands>

Die Seite ist eine vollständige Referenz aller `native:*`-Artisan-Befehle von NativePHP Mobile v3, gegliedert in drei Gruppen:

1) Development Commands:
- `native:install {platform?}` installiert NativePHP in die Laravel-App. Plattform: `android`, `ios` oder `both`. Optionen: `--force` (bestehende Dateien überschreiben), `--fresh` (Alias für --force), `--with-icu` (ICU-Support für Android, +~30 MB), `--without-icu`, `--skip-php` (keine PHP-Binaries herunterladen).
- `native:run {os?} {udid?}` baut und startet die App auf Gerät/Simulator. os: `ios`/`i` oder `android`/`a`; udid wählt ein konkretes Gerät. Optionen: `--build=debug` (debug|release|bundle), `--watch` (Hot Reloading), `--start-url=` (initiale URL/Pfad, z. B. /dashboard), `--no-tty`. Vor dem Build prüft native:run auf unregistrierte Plugins und warnt; Registrierung via `native:plugin:register`.
- `native:watch {platform?} {target?}` überwacht Dateiänderungen und synct sie in eine laufende App (platform: ios/i|android/a, target: UDID).
- `native:jump` startet den NativePHP-Dev-Server zum Testen ohne Build (QR-Code-Workflow). Optionen: `--host=0.0.0.0`, `--ip=` (v3.3+, IP im QR-Code, überschreibt Auto-Detection), `--http-port=` (Default aus config `nativephp.server.http_port`, typ. 3000), `--ws-port=` (v3.3+, WebSocket-Bridge, Default 3001), `--bridge-port=` (v3.3+, interne TCP-Bridge, Default 3002), `--vite-proxy-port=` (v3.3+, Proxy für Vite HMR aufs Telefon, Default 3003), `--no-serve` (v3.3+, kein automatisches artisan serve), `--laravel-port=` (Default 8000, auto-detektiert wenn artisan serve verwaltet wird), `--no-mdns` (mDNS-Advertisement aus).
- `native:open {os?}` öffnet das native Projekt in Xcode bzw. Android Studio.
- `native:tail` tailt Laravel-Logs einer laufenden Android-App (nur Android).
- `native:version` zeigt die installierte NativePHP-Mobile-Version.

2) Building & Release Commands:
- `native:package {platform}` paketiert und signiert die App für die Distribution (platform: android/a|ios/i). Allgemeine Optionen: `--build-type=release` (release|bundle), `--output=` (Zielordner für signierte Artefakte), `--jump-by=` (Versionsnummer überspringen), `--no-tty`. Android-Optionen: `--keystore=`, `--keystore-password=`, `--key-alias=`, `--key-password=`, `--fcm-key=` (FCM Server Key für Push), `--google-service-key=` (Google Service Account Key-Datei), `--upload-to-play-store`, `--play-store-track=internal` (internal|alpha|beta|production), `--test-push=` (Upload-Test mit bestehender AAB, Build überspringen), `--skip-prepare` (prepareAndroidBuild() überspringen, Projektdateien erhalten). iOS-Optionen: `--export-method=app-store` (app-store|ad-hoc|enterprise|development), `--upload-to-app-store`, `--test-upload` (bestehende IPA testen), `--validate-only`, `--validate-profile` (Provisioning-Profile-Entitlements prüfen), `--rebuild` (Archiv löschen und neu bauen), `--clean-caches` (Xcode-/SPM-Caches leeren), `--api-key=` (.p8 App Store Connect API Key), `--api-key-id=`, `--api-issuer-id=`, `--certificate-path=` (.p12/.cer), `--certificate-password=`, `--provisioning-profile-path=` (.mobileprovision), `--team-id=` (Apple Developer Team ID).
- `native:release {type}` erhöht die Versionsnummer in der `.env`-Datei (type: patch|minor|major).
- `native:credentials {platform?}` generiert Signatur-Credentials für iOS/Android (android/a|ios/i|both); `--reset` erzeugt neuen Keystore und neues PEM-Zertifikat.
- `native:check-build-number` validiert Build-Nummern und schlägt welche vor.
Hinweis-Box "Skip the Complexity": Zertifikate, Provisioning Profiles und Keystores lokal zu verwalten sei mühsam/fehleranfällig; der kommerzielle Dienst "Bifrost" übernimmt das (Credentials einmal setzen, Deploy mit einem Befehl, Team-Kollaboration).

3) Plugin Commands:
- `native:plugin:create` scaffoldet interaktiv ein neues Plugin.
- `native:plugin:list` listet installierte Plugins (`--json`, `--all` inkl. unregistrierter).
- `native:plugin:register {plugin?}` registriert ein Plugin im NativeServiceProvider; ohne Argument werden unregistrierte Plugins discovered und zur Auswahl angeboten (plugin = Paketname z. B. vendor/plugin-name; `--remove` entfernt statt hinzuzufügen, `--force` ignoriert Konfliktwarnungen).
- `native:plugin:uninstall {plugin}` deinstalliert ein Plugin komplett (`--force` ohne Rückfragen, `--keep-files` behält das Quellverzeichnis).
- `native:plugin:validate {path?}` validiert Plugin-Struktur und Manifest.
- `native:plugin:make-hook` erzeugt Lifecycle-Hook-Befehle für ein Plugin.
- `native:plugin:boost {plugin?}` erstellt Boost-AI-Guidelines für ein Plugin (`--force` überschreibt bestehende).
- `native:plugin:install-agent` installiert AI-Agenten für die Plugin-Entwicklung (`--force`, `--all` ohne Nachfragen).

Die Seite enthält KEINE PHP/JS-Klassen, Facades oder Events — das steht in anderen Doku-Sektionen ("Native Functions", "Events", Core Plugins: Biometrics, Browser, Camera, Device, Dialog, File, Firebase/Push, Geolocation, Microphone, Network, Scanner, SecureStorage, Share, System). Vorherige Seite: Deployment; nächste: Roadmap.

### Befehle

```bash
php artisan native:install {platform?}  # platform: android|ios|both; --force, --fresh, --with-icu, --without-icu, --skip-php
php artisan native:run {os?} {udid?}  # os: ios/i|android/a; --build=debug (debug|release|bundle), --watch, --start-url=, --no-tty
php artisan native:watch {platform?} {target?}  # platform: ios/i|android/a; target: Device/Simulator-UDID
php artisan native:jump  # --host=0.0.0.0, --ip= (v3.3+), --http-port= (Default 3000), --ws-port= (v3.3+, Default 3001), --bridge-port= (v3.3+, Default 3002), --vite-proxy-port= (v3.3+, Default 3003), --no-serve (v3.3+), --laravel-port= (Default 8000), --no-mdns
php artisan native:open {os?}  # os: ios/i|android/a — öffnet Xcode/Android Studio
php artisan native:tail  # Laravel-Logs laufender Android-App (nur Android)
php artisan native:version
php artisan native:package {platform}  # android/a|ios/i; --build-type=release (release|bundle), --output=, --jump-by=, --no-tty
php artisan native:package android  # Android-Optionen: --keystore=, --keystore-password=, --key-alias=, --key-password=, --fcm-key=, --google-service-key=, --upload-to-play-store, --play-store-track=internal (internal|alpha|beta|production), --test-push=, --skip-prepare
php artisan native:package ios  # iOS-Optionen: --export-method=app-store (app-store|ad-hoc|enterprise|development), --upload-to-app-store, --test-upload, --validate-only, --validate-profile, --rebuild, --clean-caches, --api-key= (.p8), --api-key-id=, --api-issuer-id=, --certificate-path= (.p12/.cer), --certificate-password=, --provisioning-profile-path= (.mobileprovision), --team-id=
php artisan native:release {type}  # type: patch|minor|major — bumpt Version in .env
php artisan native:credentials {platform?}  # android/a|ios/i|both; --reset
php artisan native:check-build-number
php artisan native:plugin:create
php artisan native:plugin:list  # --json, --all
php artisan native:plugin:register {plugin?}  # plugin: vendor/plugin-name, optional (Discovery); --remove, --force
php artisan native:plugin:uninstall {plugin}  # --force, --keep-files
php artisan native:plugin:validate {path?}
php artisan native:plugin:make-hook
php artisan native:plugin:boost {plugin?}  # --force
php artisan native:plugin:install-agent  # --force, --all
```

### APIs

- Keine PHP/JS-Klassen, Facades, Methoden oder Events auf dieser Seite — sie ist eine reine Artisan-CLI-Referenz
- NativeServiceProvider — erwähnt als Ort, an dem native:plugin:register Plugins einträgt
- prepareAndroidBuild() — interner Build-Schritt von native:package, der mit --skip-prepare übersprungen werden kann (erhält bestehende Projektdateien)
- Native APIs (Facades/Events) sind laut Seitennavigation in separaten Doku-Sektionen dokumentiert: 'Native Functions', 'Native Components', 'Events' sowie Core Plugins (Biometrics, Browser, Camera, Device, Dialog, File, Firebase Push Notifications, Geolocation, Microphone, Network, Scanner, SecureStorage, Share, System)

### Konfiguration

- App-Versionsnummer liegt in der .env-Datei und wird durch php artisan native:release (patch|minor|major) erhöht; native:check-build-number validiert Build-Nummern
- config-Key nativephp.server.http_port — Default für --http-port von native:jump (typischerweise 3000)
- native:jump Standardports: HTTP 3000, WebSocket-Bridge 3001, interne TCP-Bridge 3002, Vite-HMR-Proxy 3003, Laravel-Dev-Server 8000
- Android-Signierung: Keystore-Datei + Keystore-Passwort + Key-Alias + Key-Passwort (per native:credentials generierbar, --reset für neuen Keystore/PEM)
- Android Push: FCM Server Key (--fcm-key=) und Google Service Account Key-Datei (--google-service-key=) für Play-Store-Upload
- iOS-Signierung: App Store Connect API Key (.p8) + Key-ID + Issuer-ID, Distribution-Zertifikat (.p12/.cer) + Passwort, Provisioning Profile (.mobileprovision), Apple Developer Team ID
- ICU-Support für Android optional bei native:install (--with-icu / --without-icu), vergrößert die App um ~30 MB
- Keine AndroidManifest-/Info.plist-Berechtigungen auf dieser Seite dokumentiert (stehen bei den jeweiligen Plugins unter 'Permissions & Dependencies')

### Stolperfallen

- native:run prüft vor dem Build auf unregistrierte Plugins und warnt — Registrierung mit php artisan native:plugin:register nötig
- native:tail funktioniert nur für Android-Apps
- --no-tty ist für nicht-interaktive Umgebungen (CI) bei native:run und native:package erforderlich
- Mehrere native:jump-Optionen (--ip, --ws-port, --bridge-port, --vite-proxy-port, --no-serve) existieren erst ab Version v3.3+
- --with-icu vergrößert die Android-App um ca. 30 MB — nur aktivieren, wenn ICU (z. B. für Intl/Locale-Funktionen) gebraucht wird
- native:install --skip-php lädt keine PHP-Binaries herunter; --force/--fresh überschreibt bestehende Dateien
- Lokale Verwaltung von Zertifikaten/Provisioning-Profiles/Keystores wird als mühsam und fehleranfällig beschrieben; der kommerzielle NativePHP-Dienst 'Bifrost' wird als Alternative beworben (Credentials einmal setzen, Single-Command-Deploy, Team-Kollaboration)
- Kommerzieller Kontext auf der Seite: 'NativePHP Ultra' (alle Plugins, Teams, Priority Support ab $35/Monat) — relevant für Lizenz-/Kostenplanung der Core Plugins
- Play-Store-Upload direkt aus native:package möglich (--upload-to-play-store, Tracks internal|alpha|beta|production); App-Store-Upload via --upload-to-app-store mit App Store Connect API Key
- Die Seite enthält keine Code-APIs, Events oder Berechtigungen — für den Implementierungsplan müssen zusätzlich die Sektionen 'Native Functions', 'Events', 'Configuration', 'Deployment' und die Core-Plugin-Seiten abgerufen werden
- Voraussetzungen für native:open/native:run: Xcode (iOS) bzw. Android Studio (Android) müssen lokal installiert sein (implizit)

---

## Roadmap (NativePHP Mobile v3, Getting Started)

<https://nativephp.com/docs/mobile/3/getting-started/roadmap>

Die Roadmap-Seite von NativePHP Mobile v3 beschreibt den aktuellen Stand und die nächsten Entwicklungsschwerpunkte. Status quo: NativePHP for Mobile ist stabil ("stable") und bereits in Produktions-Apps im Einsatz, die in den App Stores (iOS/Android) veröffentlicht wurden. Geplante Schwerpunkte: (1) Background Tasks — Fähigkeit, Code im Hintergrund auszuführen, auch wenn die App nicht im Vordergrund ist; gedacht für Daten-Synchronisierung, Upload-Verarbeitung und Push-Notification-Handling. (2) Native UI durch EDGE (Element Definition and Generation Engine) — Erweiterung der EDGE-Fähigkeiten, sodass mehr echt native UI-Komponenten direkt aus PHP-Code definiert werden können, z. B. Navigation Bars, Tab Bars und weitere plattformspezifische native Elemente, die sich auf jeder Plattform nativ anfühlen. (3) Performance — Verbesserungen bei Startzeit, Speichernutzung und allgemeiner Responsivität der Apps. Abschnitt "Something missing?": Über das Plugin-System von NativePHP kann die Community Schnittstellen zu beliebiger nativer Funktionalität bauen; fehlende Features kann man selbst als Plugin implementieren oder ein vorhandenes Plugin nutzen. Die Doku-Seite bietet Versions-Tabs (1.x, 2.x, 3.x) sowie Verweise auf Command Reference, Versioning Policy, Support Policy, Community-Support (Discord, GitHub) und das NativePHP-Ultra-Abonnement (ca. 35 USD/Monat). Die Seite enthält KEINE CLI-Befehle, keine PHP/JS-APIs und keine Konfigurationsdetails — sie ist rein strategisch/informativ. Relevanz für den Implementierungsplan (Laravel + Livewire + Flux UI): Hintergrund-Ausführung (Background Tasks) ist in v3 noch NICHT verfügbar, sondern nur angekündigt — darauf darf der Plan aktuell nicht bauen; native UI-Elemente wie Tab-/Navigation-Bars via EDGE sind erst in Erweiterung begriffen; für fehlende native Features ist das Plugin-System der vorgesehene Weg.

### APIs

- EDGE (Element Definition and Generation Engine) — Engine zur Definition nativer UI-Komponenten (Navigation Bars, Tab Bars u. a.) aus PHP-Code; auf dieser Seite nur als Roadmap-Punkt erwähnt, keine API-Details
- Plugin-System — Erweiterungsmechanismus, mit dem die Community Interfaces zu beliebiger nativer Funktionalität bauen kann; keine API-Details auf dieser Seite

### Stolperfallen

- Reine Roadmap-/Übersichtsseite: enthält keinerlei CLI-Befehle, Code-APIs, env-Variablen, config-Dateien oder native Berechtigungen
- Background Tasks (Code-Ausführung im Hintergrund, z. B. für Sync, Uploads, Push-Handling) sind in v3 NUR ANGEKÜNDIGT ('We will be adding') — ein Implementierungsplan darf aktuell keine Hintergrundausführung voraussetzen
- Erweiterte native UI via EDGE (mehr native Komponenten wie Navigation Bars, Tab Bars) ist ebenfalls zukünftig geplant, nicht vollständiger Ist-Stand
- Performance-Verbesserungen (Startzeit, Speicherverbrauch, Responsivität) sind angekündigt — heutige Werte ggf. einplanen/testen
- NativePHP for Mobile v3 ist laut Seite stabil und bereits in produktiven App-Store-Apps im Einsatz (Produktionsreife gegeben)
- Fehlende native Funktionalität soll über das Plugin-System abgedeckt werden (selbst bauen oder Community-Plugin nutzen)
- Lizenz-/Kostenhinweis am Seitenrand: NativePHP-Ultra-Abonnement für ca. 35 USD/Monat wird beworben; Details zu Versioning Policy und Support Policy stehen auf separaten Doku-Seiten
- Doku existiert in Versions-Tabs 1.x/2.x/3.x — für den Plan konsequent die 3.x-Doku verwenden

---

## Versioning Policy (NativePHP Mobile v3, Sektion "Getting Started")

<https://nativephp.com/docs/mobile/3/getting-started/versioning>

Die Seite beschreibt die Versionierungs-Policy des Pakets nativephp/mobile nach Semantic Versioning und unterscheidet drei Release-Typen. (1) Patch-Releases: enthalten keine Breaking Changes und ändern ausschließlich Laravel-/PHP-Code (typisch Bugfixes und Dependency-Updates ohne Auswirkung auf nativen Code). Sie sind voll kompatibel mit bereits gebauten nativen Apps, können sicher per `composer update` eingespielt werden und erfordern KEINEN kompletten Rebuild (kein `native:install --force`) — dadurch sind App-Updates ohne erneute App-Store-Submission möglich. (2) Minor-Releases: können native Code-Änderungen enthalten (neue native APIs, Kotlin-/Swift-Updates, plattformspezifische Features, Änderungen an nativen Dependencies), bleiben aber gemäß SemVer ohne Breaking Changes. Sie erfordern einen kompletten Rebuild mit `php artisan native:install --force` und eine App-Store-Submission zur Verteilung; das Team kündigt sie vorab an und liefert Migration Guides. (3) Major-Releases: sind Breaking Changes vorbehalten und folgen üblicherweise auf eine Deprecation-Periode, damit genug Zeit für Codeanpassungen bleibt. Als Composer-Version-Constraint wird der Tilde-Range-Operator mit vollständiger minimaler Patch-Version empfohlen (Beispiel in composer.json: "nativephp/mobile": "~2.0.0") — so kommen Patch-Updates automatisch, Minor-Releases bleiben unter Kontrolle. Für die EIGENE App-Versionierung besteht keine Pflicht zu SemVer: beliebige Schemata (Codenames, datumsbasiert etc.) sind möglich; App-Versionen sind allerdings üblicherweise öffentlich sichtbar (Store-Listings, Geräteeinstellungen). Erklärtes Ziel: den Update-Aufwand minimal halten und Kompatibilität sichern; zu jedem Release werden Update-Anweisungen veröffentlicht. Relevanz für den Implementierungsplan: Composer-Constraint mit Tilde-Operator pinnen; nach jedem Minor-Update von nativephp/mobile fest einplanen, dass `php artisan native:install --force` (kompletter Rebuild) plus erneute Einreichung bei Google Play/App Store nötig ist, während Patch-Updates rein serverseitig/per composer einspielbar sind.

### Befehle

```bash
composer update
php artisan native:install --force
```

### Konfiguration

- composer.json require-Constraint (empfohlen): "nativephp/mobile": "~2.0.0" (Tilde-Range-Operator mit vollständiger minimaler Patch-Version)

### Stolperfallen

- Minor-Releases können nativen Code (Kotlin/Swift, native Dependencies) ändern und erfordern zwingend einen kompletten Rebuild via `php artisan native:install --force` sowie eine erneute App-Store-Submission zur Verteilung
- Patch-Releases ändern nur Laravel/PHP-Code: sicher per `composer update`, kein Rebuild und keine Store-Submission nötig — dies im Update-/Release-Prozess der App unterscheiden
- Major-Releases sind Breaking Changes vorbehalten und folgen üblicherweise einer Deprecation-Periode; Migration Guides und Vorankündigungen werden für Minor-/Major-Änderungen bereitgestellt
- Empfohlener Composer-Constraint ist der Tilde-Operator (~x.y.z), damit Patch-Updates automatisch kommen, Minor-Updates (mit Rebuild-Pflicht) aber bewusst eingespielt werden; Hinweis: das Doku-Beispiel zeigt noch "~2.0.0", obwohl die Doku zu v3 gehört — fürs Projekt entsprechend ~3.x.y verwenden
- Eigene App-Versionierung ist frei wählbar (kein SemVer-Zwang), aber öffentlich sichtbar in Store-Listings und Geräteeinstellungen
- Die Seite enthält keine PHP/JS-APIs, env-Variablen oder native Berechtigungen — sie ist eine reine Policy-Seite; zu jedem Release werden separate Update-Anweisungen veröffentlicht, die beim Upgrade konsultiert werden sollten

---

## Support Policy (NativePHP Mobile v3, Getting Started)

<https://nativephp.com/docs/mobile/3/getting-started/support-policy>

Die Seite beschreibt die Versions-Support-Politik von NativePHP for Mobile (v3). Kernaussage: NativePHP for Mobile ist noch ein junges Produkt mit kleinem Team und begrenzten Ressourcen; daher gilt eine pragmatische Support-Strategie. Offizielle Position (wörtlich): "We aim (but do not guarantee) to support all the current and upcoming major, currently vendor-supported versions" — d. h. es werden die aktuellen und kommenden Major-Versionen von iOS und Android unterstützt, die noch vom Hersteller (Apple/Google) gepflegt werden. Konkret bedeutet das mit Stand September 2025: iOS 18+ und Android 13+. Es wird ausdrücklich NICHT garantiert, dass jedes Feature auf allen unterstützten OS-Versionen funktioniert. Auf älteren bzw. nicht mehr vendor-supporteten Versionen kann NativePHP teilweise laufen, erhält dort aber keinen offiziellen Standard-Support. Für Organisationen, die explizite Rückwärtskompatibilität mit älteren/nicht unterstützten Versionen benötigen, verweist die Seite auf das NativePHP-Partner-Programm, über das maßgeschneiderte Supportvereinbarungen möglich sind. Die Seite enthält keinerlei CLI-Befehle, Code-APIs oder Konfigurationsangaben; sie ist eine reine Policy-Seite und verlinkt im Umfeld auf verwandte Doku (u. a. Versioning Policy, Overview). Für den Implementierungsplan der Einundzwanzig-App relevant: Mindest-Targets iOS 18 und Android 13 einplanen; Feature-Verfügbarkeit pro OS-Version einzeln prüfen, da nicht garantiert.

### Stolperfallen

- Support ist nur ein Ziel, keine Garantie: "We aim (but do not guarantee) to support all the current and upcoming major, currently vendor-supported versions"
- Unterstützte Plattformversionen (Stand September 2025): iOS 18+ und Android 13+ — als minSdk/Deployment-Target für die App einplanen
- Nicht jedes NativePHP-Feature funktioniert garantiert auf jeder unterstützten OS-Version — Feature-Verfügbarkeit einzeln prüfen
- Ältere/nicht mehr vendor-supportete OS-Versionen: NativePHP kann dort teilweise funktionieren, erhält aber keinen offiziellen Support
- Für explizite Rückwärtskompatibilität mit Legacy-Versionen wird auf das NativePHP-Partner-Programm (individuelle Supportvereinbarungen) verwiesen
- NativePHP for Mobile ist ein junges Produkt mit kleinem Team — Support-Umfang ist bewusst auf aktuelle Major-Releases begrenzt
- Die Seite enthält keine CLI-Befehle, APIs oder Konfiguration — reine Policy-Information; technische Details stehen auf anderen Doku-Seiten (z. B. Versioning Policy, Overview)
