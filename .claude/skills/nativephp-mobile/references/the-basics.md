# NativePHP Mobile v3 — The Basics — WebView, native Funktionen, Events, Vite, Hot Reload, Jump

> Quelle: Deep-Scan der offiziellen Doku (nativephp.com, Stand 2026-06-11). 9 Seiten.

---

## NativePHP for Mobile v3 — The Basics: Overview

<https://nativephp.com/docs/mobile/3/the-basics/overview>

Die Overview-Seite beschreibt die Architektur von NativePHP for Mobile (v3), die aus vier Teilen besteht: (1) Die eigene Laravel-Anwendung (PHP) — man baut sie weitgehend wie gewohnt und streut native Funktionalität über die eingebauten NativePHP-APIs ein. (2) Das Composer-Paket `nativephp/mobile` — ein weitgehend normales Composer-Paket, das den PHP-Code zur Anbindung an die NativePHP-Extension, die Tools zum Installieren/Ausführen der App sowie den kompletten Code der beiden nativen Apps (iOS und Android, geschrieben in Swift bzw. Kotlin) enthält. (3) Custom-PHP-Builds: Beim Ausführen des Artisan-Befehls `native:install` lädt das Paket passende, speziell für Mobile-Plattformen kompilierte PHP-Binaries herunter. Aktuell wird PHP 8.4 gebündelt; die eigene App muss damit kompatibel sein. Die Builds sind als einbettbare C-Bibliotheken kompiliert und werden in die native App eingebettet — PHP läuft NICHT als separater Prozess/Service unter einem Webserver, sondern die native App selbst wird um die Fähigkeit erweitert, PHP-Code auszuführen. Die Laravel-App wird direkt von der nativen App über die eingebettete PHP-Engine ausgeführt; das ist sehr schnell und effizient auf moderner Hardware. (4) Die nativen Apps: NativePHP liefert je eine Shell-App für iOS und Android. Mit `native:run` wird die Laravel-App paketiert und in eine dieser Shell-Apps kopiert; für beide Plattformen muss `native:run` zweimal (je Plattform) ausgeführt werden. Jede native App-Shell führt bei jedem Boot der App Vorbereitungsschritte aus: Prüfen, ob die gebündelte Laravel-App-Version neuer ist als die installierte; ggf. Installation der neueren Version; Ausführen von Migrationen; Leeren von Caches; Anlegen von Storage-Symlinks. Die Seitennavigation zeigt zudem den Umfang der Doku: Getting Started (Environment Setup, Installation, Configuration, Development, Deployment, Command Reference …), The Basics (Overview, Jump, Web View, Native Functions, Native Components, Events, App Icons, Splash Screens, Assets), EDGE Components (Top Bar, Bottom Navigation, Side Navigation, Icons), Concepts (Security, Authentication, Databases, Queues, Deep Links, Push Notifications), Plugins (Using/Creating Plugins, Bridge Functions, Events, Lifecycle Hooks, Permissions & Dependencies, Advanced Configuration, Validation & Testing, Best Practices) sowie Core-Plugins (Biometrics, Browser, Camera, Device, Dialog, File, Firebase Push Notifications, Geolocation, Microphone, Network, Scanner, SecureStorage, Share, System). Konkrete Code-Beispiele, env-Variablen oder Berechtigungen enthält diese Übersichtsseite nicht — sie verweist konzeptionell auf die Folgeseiten.

### Befehle

```bash
php artisan native:install
php artisan native:run
```

### APIs

- nativephp/mobile (Composer-Paket): enthält den PHP-Code zur Schnittstelle mit der NativePHP-Extension, Install-/Run-Tooling und den nativen App-Code (Swift für iOS, Kotlin für Android)
- NativePHP built-in APIs: native Funktionalität wird in der normalen Laravel-App über eingebaute NativePHP-APIs eingestreut (Details auf den Folgeseiten 'Native Functions', 'Native Components', 'Events')
- Custom NativePHP PHP-Extension: Teil des speziellen PHP-Builds, der als einbettbare C-Bibliothek in die native App eingebettet wird

### Stolperfallen

- NativePHP for Mobile bündelt aktuell PHP 8.4 — die eigene Laravel-App muss mit dieser PHP-Version kompatibel sein
- Die custom PHP-Builds sind ausschließlich für Mobile-Plattformen kompiliert und können in keinem anderen Kontext verwendet werden
- PHP läuft nicht als separater Prozess/Webserver: Die PHP-Engine ist als einbettbare C-Bibliothek direkt in die native App eingebettet, die den Laravel-Code selbst ausführt
- Für Builds beider Plattformen muss `native:run` zweimal ausgeführt werden — jeweils mit Ziel iOS bzw. Android
- Bei jedem App-Boot führt die native Shell automatisch aus: Versionsvergleich der gebündelten vs. installierten Laravel-App, ggf. Installation der neueren Version, Migrationen, Cache-Clearing, Anlegen von Storage-Symlinks — Implementierungsplan sollte Migrationen/Caches darauf auslegen
- `native:install` lädt die passenden vorgefertigten PHP-Binaries herunter (Netzwerkzugriff beim Setup nötig)
- Die Seite ist eine reine Architektur-Übersicht ohne env-Variablen, config-Keys oder native Berechtigungen; Details stehen in den Folgeseiten (Installation, Configuration, Command Reference, Concepts, Core Plugins)
- Kommerzielle Hinweise am Seitenrand: 'NativePHP Ultra' (alle NativePHP-Plugins, Teams & Priority Support ab $35/Monat) und 'Plugin Dev Kit' — kein expliziter Lizenztext im Seiteninhalt selbst

---

## NativePHP Mobile v3 — The Basics: Jump

<https://nativephp.com/docs/mobile/3/the-basics/jump>

Jump ist eine kostenlose Companion-App (iOS App Store + Google Play), mit der man NativePHP-Apps auf einem echten Gerät ausprobieren kann, OHNE Xcode oder Android Studio und ohne nativen Build. Der Workflow: `php artisan native:jump` startet auf dem Entwicklungsrechner drei Dienste — (1) einen PHP-Dev-Server (zeigt QR-Code, proxied HTTP-Requests; Port 3000), (2) optional die Laravel-App via `artisan serve` (Standard-Port 8000, abschaltbar mit --no-serve), (3) eine WebSocket-/TCP-Bridge, die native API-Aufrufe und Vite-HMR-Updates an das Gerät weiterleitet (Bridge-Port 3002, Vite-Proxy-Port 3003, WS-Port). Das Telefon verbindet sich über dasselbe WLAN, scannt den QR-Code in der Jump-App und rendert die Laravel/Livewire-App in Jumps WebView. Native API-Aufrufe aus PHP gehen synchron über eine TCP-Verbindung an den Bridge-Port, werden per WebSocket ans Gerät gesendet, und das Ergebnis kommt synchron zurück nach PHP — d.h. die große Mehrheit der nativen Funktionen (Sensoren, Dialoge, Kamera, Biometrie, File-Picker u.a.) funktioniert direkt in Jump. Hot Reload: Vites HMR wird automatisch über Port 3003 geproxied; einfach parallel `npm run dev` starten, keine Konfiguration nötig. Geräte-Discovery läuft via mDNS (abschaltbar mit --no-mdns, dann QR-Scan). Bei mehreren Netzwerk-Interfaces fragt der Befehl nach der IP oder man übergibt --ip=192.168.1.42. Eigener Server statt artisan serve: --no-serve --laravel-port=8000, dabei muss der eigene Serverprozess die Env-Variable JUMP_BRIDGE_PORT=3002 gesetzt haben. Alle Ports sind per Flags (--http-port, --ws-port, --bridge-port, --vite-proxy-port, --laravel-port) oder config/nativephp.php ('server'-Array mit env NATIVEPHP_HTTP_PORT/WS_PORT/SERVICE_NAME/OPEN_BROWSER) konfigurierbar; CLI-Flags überschreiben die Config. Bridge-Aktivität wird nach storage/logs/jump-bridge.log geloggt. Stoppen mit Ctrl+C (sauberer Shutdown). Abgrenzung: Jump = schnellste Iteration/Prototyping ohne Build-Infrastruktur; `native:run` = gepackte Builds, Release-Tests, Validierung von nativem Plugin-Code und Startverhalten. Einschränkungen: APIs mit langlebigem Geräte-State (z.B. Background-Tasks) verhalten sich nur im gepackten Build korrekt; öffentliche/Gast-WLANs mit Client-Isolation funktionieren nicht. Voraussetzung: Jump v2+ (für NativePHP Mobile v3.3+), beide Geräte im selben WLAN (oder Tethering), Firewall muss eingehende Verbindungen auf Ports 3000–3003 erlauben. Für den Implementierungsplan relevant: Jump ist das ideale Dev-Loop-Werkzeug für eine Livewire/Flux-UI-App — keine nativen Berechtigungen, kein Manifest-Eintrag und keine speziellen PHP-Klassen sind auf dieser Seite nötig; sie dokumentiert nur den Dev-Workflow, keine eigenen Facades/Events.

### Befehle

```bash
php artisan native:jump
php artisan native:jump --no-mdns
php artisan native:jump --ip=192.168.1.42
php artisan native:jump --no-serve --laravel-port=8000
php artisan native:jump --http-port=3000 --ws-port=3001 --bridge-port=3002 --vite-proxy-port=3003 --laravel-port=8000
npm run dev
JUMP_BRIDGE_PORT=3002 php artisan serve --port=8000
tail -f storage/logs/jump-bridge.log
php artisan native:run (Gegenstück für gepackte Builds; auf der Seite nur als Abgrenzung erwähnt)
```

### APIs

- Keine neuen PHP-Facades/Klassen/Events auf dieser Seite — die Seite beschreibt nur den Dev-Workflow; bestehende NativePHP-APIs (Sensoren, Dialoge, Kamera, Biometrie, File-Picker etc.) funktionieren transparent über die Jump-Bridge
- Bridge-Mechanik: native API-Aufrufe aus PHP gehen per TCP an den Bridge-Port, werden via WebSocket ans Gerät relayed, Ergebnis kehrt synchron nach PHP zurück (intern u.a. nativephp_call())
- Vite HMR wird automatisch über den Vite-Proxy-Port (3003) durchgereicht — kein JS-API-Code nötig

### Konfiguration

- config/nativephp.php → 'server' => ['http_port' => env('NATIVEPHP_HTTP_PORT', 3000), 'ws_port' => env('NATIVEPHP_WS_PORT', 8081), 'service_name' => env('NATIVEPHP_SERVICE_NAME', 'NativePHP Server'), 'open_browser' => env('NATIVEPHP_OPEN_BROWSER', true)]
- Env: NATIVEPHP_HTTP_PORT (Default 3000, PHP-Dev-Server/QR/HTTP-Proxy)
- Env: NATIVEPHP_WS_PORT (Default 8081, WebSocket-Bridge)
- Env: NATIVEPHP_SERVICE_NAME (mDNS-Servicename, Default 'NativePHP Server')
- Env: NATIVEPHP_OPEN_BROWSER (Default true)
- Env: JUMP_BRIDGE_PORT=3002 — Pflicht, wenn man mit --no-serve einen eigenen Laravel-Server betreibt
- Ports: 3000 HTTP/QR, 3001 (Firewall, ws), 3002 Bridge (TCP, native Calls), 3003 Vite-HMR-Proxy, 8000 Laravel-Server (optional)
- CLI-Flags überschreiben Config: --http-port, --ws-port, --bridge-port, --vite-proxy-port, --laravel-port, --ip, --no-mdns, --no-serve
- Keine AndroidManifest-/Info.plist-Berechtigungen auf dieser Seite erforderlich (Jump-App bringt alles mit)
- Log: storage/logs/jump-bridge.log (Bridge-Aktivität)

### Stolperfallen

- Jump v2 oder neuer erforderlich (passend zu NativePHP Mobile v3.3+); App kostenlos im App Store (iOS) und Google Play (Android)
- Beide Geräte müssen im selben WLAN sein (oder Tethering); öffentliche/Gast-Netzwerke mit Client-Isolation funktionieren NICHT
- Firewall muss eingehende Verbindungen auf Ports 3000, 3001, 3002, 3003 zulassen
- mDNS-Auto-Discovery kann in manchen Netzwerken blockiert sein → --no-mdns nutzen und QR-Code scannen
- APIs mit langlebigem Geräte-State (z.B. Background-Tasks) verhalten sich nur in einem gepackten Build (native:run / native:package) zuverlässig — Jump ist kein Ersatz für Release-Tests
- native:run weiterhin nötig für: gepackte Builds, Release-Tests, Validierung von nativem Plugin-Code, Prüfung des Startverhaltens
- Bei mehreren Netzwerk-Interfaces fragt der Befehl interaktiv nach der IP — in Skripten --ip=… setzen
- Eigener Server (--no-serve): ohne gesetztes JUMP_BRIDGE_PORT=3002 erreichen native Calls die Bridge nicht
- Keine explizite Lizenzpflicht für Jump auf der Seite dokumentiert; keine dedizierte Troubleshooting-Sektion vorhanden
- Stoppen mit Ctrl+C für sauberen Shutdown aller drei Dienste

---

## NativePHP Mobile v3 — The Basics: Web View

<https://nativephp.com/docs/mobile/3/the-basics/web-view>

Jede mit NativePHP gebaute Mobile-App dreht sich um eine einzige native Web View. Darin kann jede beliebige Web-Technologie für die UI genutzt werden — Livewire, Vue, React, Svelte, HTMX, sogar jQuery (für dieses Projekt also: Laravel + Livewire + Flux UI ohne Einschränkung). Die Web View füllt den gesamten Bildschirm und bleibt dauerhaft sichtbar, außer wenn eine andere Vollbild-Aktion läuft (z. B. Kamera oder In-App-Browser).

GLIEDERUNG UND INHALT:

1) The Viewport: Wie im normalen Browser wird der sichtbare Bereich über den viewport-Meta-Tag gesteuert: <meta name="viewport" content="width=device-width, initial-scale=1">.

2) Disable Zoom: Für ein nativeres App-Gefühl kann nutzergesteuerter Zoom deaktiviert werden mit user-scalable=no: <meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no">.

3) Edge-to-Edge: Die Web View belegt den GESAMTEN Bildschirm (volles Rendering per HTML/CSS/JS möglich). Aber nicht alle Display-Bereiche sind sichtbar/interaktiv (Kamera-Notches, abgerundete Ecken, gebogene Displays). Dafür muss viewport-fit=cover im viewport-Meta-Tag gesetzt und die Safe-Area-Insets genutzt werden.

4) Safe Areas: Bereiche des Displays, die weder durch physische Unterbrechungen (abgerundete Ecke, Kamera) noch durch persistente System-UI (Home Indicator/Notch) verdeckt sind. Sie werden vom Gerät zur Laufzeit berechnet und passen sich der Orientierung an. NativePHP injiziert vier CSS-Variablen in die Seiten: --inset-top, --inset-bottom, --inset-left, --inset-right. Zusätzlich gibt es die CSS-Hilfsklasse nativephp-safe-area, die auf die meisten Elemente angewendet werden kann, damit sie innerhalb der Safe Areas sitzen. Beispiel mit Tailwind für einen fixed Header: <body class="nativephp-safe-area"> und <div class="fixed top-0 left-0 w-full bg-red-500 pl-[var(--inset-left)] pr-[var(--inset-right)]">. Ohne viewport-fit=cover und Safe Areas ragt der Header in Notch-Bereiche (im Landscape noch schlimmer).

5) Status Bar Style: Auf Android ändern die Status-Bar-Icons ihre Farbe NICHT automatisch passend zur App-Hintergrundfarbe, sondern standardmäßig nur nach Light/Dark Mode des Geräts. Bei konsistenter Hintergrundfarbe in beiden Modi kann der Config-Key nativephp.status_bar_style gesetzt werden. Optionen: auto (Default, folgt dem Dark-Mode-Setting des Geräts), light (ideal bei dunklem App-Hintergrund), dark (besser bei hellem App-Hintergrund).

   Unterabschnitt "Missing Config Keys?": Fehlen neuere Keys in config/nativephp.php, können sie manuell ergänzt werden — Referenz ist die Default-Version in vendor/nativephp/mobile/config/nativephp.php. Alternativ Force-Publish via: php artisan vendor:publish --tag=nativephp-mobile-config --force — Achtung: Das überschreibt alle eigenen Änderungen an der Config-Datei.

6) Keyboard Visibility: Wenn die Bildschirmtastatur erscheint, kann sie Inputs/Buttons verdecken. NativePHP toggelt automatisch die Klasse keyboard-visible auf dem <body>-Element, wenn die Software-Tastatur öffnet/schließt — auf iOS UND Android. Damit lassen sich Elemente rein per CSS verstecken/verschieben/skalieren, z. B.: .bottom-nav { transition: transform 0.2s ease-out; } body.keyboard-visible .bottom-nav { transform: translateY(100%); }. Mit Tailwind v4 kann eine eigene Variante registriert werden: @import "tailwindcss"; @custom-variant keyboard-visible (&:where(body.keyboard-visible *)); — Nutzung dann wie eingebaute Varianten: <nav class="fixed bottom-0 left-0 w-full transition-transform keyboard-visible:translate-y-full">. Das kombiniert sich gut mit den Safe-Area-Insets: Layouts reagieren auf Gerätegeometrie und Tastaturzustand ganz ohne JavaScript.

7) WebView Compatibility: Auf Android wird die Web View vom System-WebView angetrieben, der je nach Gerät und OS-Version variiert. Ältere Android-Versionen liefern ältere WebView-Engines, die moderne CSS-Features evtl. nicht unterstützen. Konkret: Tailwind CSS v4 nutzt @theme und andere neue CSS-Features, die auf älteren WebViews NICHT laufen. Wer eine niedrige min_sdk anpeilt, sollte Tailwind CSS v3 oder ein anderes Framework mit kompatiblem Output erwägen. Die minimale SDK-Version wird in den Android-SDK-Versions-Einstellungen konfiguriert (verlinkte Configuration-Seite). Empfehlung: Immer auf Emulatoren mit der minimal unterstützten Android-Version testen; Emulatoren für ältere API-Level lassen sich im Virtual Device Manager von Android Studio anlegen.

Fazit der Seite: Mit wenigen kleinen Anpassungen entsteht ein Layout, das auf vielen Geräten funktioniert, ohne komplexe Berechnungen oder gerätespezifische CSS-Regeln.

RELEVANZ FÜR DIESES PROJEKT (Laravel 12 + Livewire 4 + Flux UI + Tailwind v4): Livewire/Flux sind voll kompatibel mit der Web View. Kritischster Punkt ist die Tailwind-v4-Einschränkung auf älteren Android-WebViews — min_sdk-Entscheidung beeinflusst, ob Tailwind v4 (Projektstandard) nutzbar bleibt. Safe-Area-Klassen/Variablen und die keyboard-visible-Variante sollten ins App-Layout (Body-Klasse, fixe Navigationselemente) eingeplant werden.

### Befehle

```bash
php artisan vendor:publish --tag=nativephp-mobile-config --force
```

### APIs

- CSS-Variablen (von NativePHP zur Laufzeit injiziert): --inset-top, --inset-bottom, --inset-left, --inset-right — Safe-Area-Insets, orientierungsabhängig vom Gerät berechnet
- CSS-Klasse nativephp-safe-area — auf Elemente (z. B. <body>) anwenden, damit Inhalte innerhalb der Safe Areas liegen
- CSS-Klasse keyboard-visible — wird von NativePHP automatisch auf <body> getoggelt, wenn die Software-Tastatur öffnet/schließt (iOS und Android); reine CSS-Reaktion ohne JavaScript möglich
- Tailwind-v4-Custom-Variant: @custom-variant keyboard-visible (&:where(body.keyboard-visible *)); — danach nutzbar als z. B. keyboard-visible:translate-y-full
- Viewport-Meta-Tags: <meta name="viewport" content="width=device-width, initial-scale=1">; Zoom deaktivieren mit user-scalable=no; Edge-to-Edge mit viewport-fit=cover

### Konfiguration

- Config-Key nativephp.status_bar_style in config/nativephp.php — Werte: auto (Default, folgt Dark-Mode des Geräts), light (bei dunklem App-Hintergrund), dark (bei hellem App-Hintergrund); betrifft Android-Status-Bar-Icons
- Default-Config-Referenz: vendor/nativephp/mobile/config/nativephp.php (fehlende Keys von dort manuell in config/nativephp.php übernehmen)
- min_sdk (Android SDK Versions, Configuration-Seite) — minimale Android-SDK-Version; bestimmt, welche WebView-/CSS-Features vorausgesetzt werden können
- Keine AndroidManifest-/Info.plist-Berechtigungen auf dieser Seite dokumentiert

### Stolperfallen

- Android-WebView-Kompatibilität: Tailwind CSS v4 (@theme u. a. moderne CSS-Features) wird auf älteren System-WebViews NICHT unterstützt — bei niedriger min_sdk Tailwind v3 oder anderes CSS-Framework mit kompatiblem Output verwenden; dieses Projekt nutzt Tailwind v4, also min_sdk bewusst wählen
- Auf Emulatoren mit der minimal unterstützten Android-Version testen (ältere API-Level via Android Studio Virtual Device Manager anlegen)
- Web View ist Edge-to-Edge: ohne viewport-fit=cover + Safe-Area-Insets ragt UI in Notch/abgerundete Ecken/Home-Indicator (im Landscape verstärkt)
- Android-Status-Bar-Icons passen sich NICHT automatisch der App-Hintergrundfarbe an, nur dem Light/Dark-Mode — ggf. status_bar_style setzen
- php artisan vendor:publish --tag=nativephp-mobile-config --force überschreibt eigene Änderungen an config/nativephp.php
- Web View bleibt immer sichtbar, außer bei Vollbild-Aktionen (Kamera, In-App-Browser)
- Framework-frei: Livewire, Vue, React, Svelte, HTMX, jQuery — alles nutzbar; Livewire + Flux UI also ohne Einschränkung möglich
- Lizenz-/Werbe-Hinweise am Seitenrand (kein Doku-Inhalt): NativePHP Ultra (alle Plugins, Teams, Priority Support ab $35/mo), Plugin Dev Kit, Masterclass — der eigentliche Web-View-Inhalt setzt keine Lizenz voraus

---

## Native Functions — NativePHP Mobile v3 (The Basics)

<https://nativephp.com/docs/mobile/3/the-basics/native-functions>

Die Seite erklärt das Grundkonzept der nativen Funktionsaufrufe in NativePHP Mobile v3. Kernaussage: Eine eigene (custom) PHP-Extension von NativePHP ermöglicht eine enge Integration mit iOS und Android und bietet eine konsistente, performante Abstraktion — native Gerätefunktionen werden direkt aus PHP-Code aufgerufen. Die nativen APIs werden über eine wachsende Sammlung von Plugins bereitgestellt, die als Laravel-Facades exponiert sind, z. B. Native\Mobile\Facades\Biometrics, Native\Mobile\Facades\Browser und Native\Mobile\Facades\Camera. Abschnitt 'Run from anywhere': Alle nativen APIs laufen über PHP und sind NICHT vom WebView abhängig — sie können von überall in der App aufgerufen werden (also auch aus Jobs, Controllern, Livewire-Actions etc.). Wer dennoch einen WebView mit JS-Frameworks (Vue, React) nutzt, kann dieselben Funktionen über die mitgelieferte JavaScript-'Native'-Library aufrufen. Abschnitt 'Install the Node plugin': Die JS-Library wird nicht über npm installiert, sondern per 'imports'-Eintrag in package.json eingebunden ("#nativephp" zeigt auf ./vendor/nativephp/mobile/resources/dist/native.js). Ein Vue-Beispiel zeigt das Muster: import { On, Off, Microphone, Events } from '#nativephp'; Aufruf nativer Funktionen wie Microphone.record(); Event-Registrierung mit On(Events.Microphone.MicrophoneRecorded, handler) in onMounted und Deregistrierung mit Off(...) in onUnmounted. Die JS-APIs sind vollständig typisiert (IDE-Autocomplete) und spiegeln die PHP-APIs 1:1 — keine Abweichungen zwischen den Implementierungen. Für unser Laravel+Livewire+Flux-Setup relevant: Die PHP-Facade-Variante ist der primäre Weg (Livewire-Actions rufen Facades direkt auf); die JS-Bridge ist optional für Frontend-getriebene Aufrufe. Details zu einzelnen Plugins (Methoden, Events, Berechtigungen) stehen auf den verlinkten Plugin-Unterseiten der Doku, nicht auf dieser Seite. Support läuft über Discord und GitHub Issues.

### APIs

- Native\Mobile\Facades\Biometrics — Laravel-Facade für biometrische Authentifizierung (Beispiel für ein natives Plugin)
- Native\Mobile\Facades\Browser — Laravel-Facade zum Öffnen von Browser/Web-Inhalten
- Native\Mobile\Facades\Camera — Laravel-Facade für Kamerazugriff
- JS-Library '#nativephp' (./vendor/nativephp/mobile/resources/dist/native.js) — JavaScript-Spiegel der PHP-APIs, vollständig typisiert
- JS: On(event, handler) — nativen Event-Listener registrieren
- JS: Off(event, handler) — Event-Listener entfernen
- JS: Microphone.record() — Beispiel eines nativen Funktionsaufrufs aus JS
- JS: Events.Microphone.MicrophoneRecorded — Beispiel einer Event-Konstante im Events-Objekt

### Konfiguration

- package.json: "imports": { "#nativephp": "./vendor/nativephp/mobile/resources/dist/native.js" } — bindet die JS-Native-Library ein (kein npm-Paket)

### Stolperfallen

- Voraussetzung: Die nativen Aufrufe basieren auf einer eigenen (custom) PHP-Extension von NativePHP — Standard-PHP reicht nicht.
- Native APIs sind WebView-unabhängig: Aufrufe funktionieren von überall im PHP-Code (ideal für Livewire-Actions ohne JS-Bridge).
- Die JS-Library wird über den package.json-'imports'-Mechanismus aus dem vendor-Verzeichnis geladen — Composer-Install von nativephp/mobile muss also vor dem JS-Build vorhanden sein.
- JS-APIs spiegeln die PHP-APIs exakt (gleiche Methoden/Events); native Events in JS müssen manuell mit On()/Off() registriert/deregistriert werden (z. B. in Vue onMounted/onUnmounted), sonst Memory-Leaks/Doppel-Handler.
- Diese Seite enthält KEINE CLI-Befehle, keine Berechtigungs-Konfiguration (AndroidManifest.xml/Info.plist) und keine Lizenzhinweise — diese Details stehen in den jeweiligen Plugin-Unterseiten der Doku und müssen dort separat erfasst werden.
- Die Facade-Liste auf der Seite ist nur exemplarisch ('growing collection of plugins') — vollständige Plugin-/API-Liste auf den Plugin-Dokuseiten nachschlagen.
- Support: Discord und GitHub Issues.

---

## Native Components — NativePHP for Mobile v3 (The Basics)

<https://nativephp.com/docs/mobile/3/the-basics/native-components>

Die Seite ist eine kurze, rein konzeptionelle Einführungsseite (verifiziert per Roh-HTML — sie enthält nur eine Sektion "Living on the EDGE" und ein einziges Code-Beispiel). Kernaussagen: NativePHP for Mobile kann zusätzlich zum WebView echte native UI-Komponenten rendern. Seit v2 gibt es dafür Navigationskomponenten, um Apps ein nativeres Gefühl zu geben. Das System heißt EDGE — "Element Definition and Generation Engine". Eigenschaften von EDGE: (1) Die Komponenten sind "truly native elements", die den Design-Guidelines der jeweiligen Plattform (iOS/Android) entsprechen; (2) EDGE ist auf Laravels Blade aufgebaut — man definiert native UI deklarativ mit Blade-Komponenten-Syntax im Namespace "native:" (Beispiel: <native:bottom-nav> mit <native:bottom-nav-item id="home" icon="home" label="Home" url="/home" />); (3) Aus einer einzigen Definition wird vollständig native UI generiert, die auf allen unterstützten mobilen OS-Versionen funktioniert, in Light- und Dark-Mode; (4) EDGE-Komponenten sind voll kompatibel mit Hot Reloading — sie können zur Laufzeit ein- und ausgetauscht werden, ohne die App neu zu kompilieren. Für Details verweist die Seite auf die separate Doku-Sektion "EDGE Components" mit den Unterseiten: Introduction, Top Bar, Bottom Navigation, Side Navigation, Icons. Navigationskontext: vorherige Seite "Native Functions", nächste Seite "Events". Relevanz für den Implementierungsplan (Laravel + Livewire + Flux UI): Die App-UI bleibt Blade/Livewire/Flux im WebView; native Navigations-Chrome-Elemente (Bottom-Nav, Top-Bar, Side-Nav) können zusätzlich über die native:*-Blade-Komponenten deklariert werden und navigieren per url-Attribut auf Laravel-Routen. Die konkreten Attribut-/Komponenten-APIs (z. B. Icon-Namen, Events bei Tab-Wechsel) stehen auf den EDGE-Components-Unterseiten (https://nativephp.com/docs/mobile/3/edge-components/...), nicht auf dieser Seite.

### APIs

- EDGE (Element Definition and Generation Engine) — NativePHPs System zum Rendern nativer UI-Komponenten aus Blade-Definitionen
- Blade-Komponenten-Namespace native:* — deklarative Definition nativer UI in Blade-Templates
- <native:bottom-nav> — Container-Komponente für eine native Bottom-Navigation
- <native:bottom-nav-item id="home" icon="home" label="Home" url="/home" /> — Navigationseintrag mit Attributen id, icon, label, url (url zeigt auf eine App-/Laravel-Route)
- Weitere EDGE-Komponenten laut Verweis (Details in eigener Doku-Sektion 'EDGE Components'): Top Bar, Bottom Navigation, Side Navigation, Icons

### Stolperfallen

- Die Seite ist rein konzeptionell und sehr kurz — alle konkreten APIs, Attribute und Beispiele stehen in der separaten Doku-Sektion 'EDGE Components' (Introduction, Top Bar, Bottom Navigation, Side Navigation, Icons); diese Seiten müssen für den Implementierungsplan zusätzlich erfasst werden
- EDGE-Navigationskomponenten existieren erst seit NativePHP Mobile v2 (in v1 nicht verfügbar)
- EDGE-Komponenten rendern als echte native Elemente gemäß den Design-Guidelines der jeweiligen Plattform — das Aussehen kann daher von der Tailwind/Flux-UI im WebView abweichen und ist plattformabhängig (iOS vs. Android)
- Light-/Dark-Mode wird automatisch von den nativen Komponenten unterstützt — Dark-Mode-Verhalten der Flux-UI im WebView sollte daran angeglichen werden
- Hot Reloading wird voll unterstützt: EDGE-Komponenten lassen sich zur Laufzeit austauschen, ohne die App neu zu kompilieren
- Keine CLI-Befehle, env-Variablen, config-Keys oder nativen Berechtigungen (AndroidManifest/Info.plist) auf dieser Seite dokumentiert
- Kein expliziter Lizenzhinweis auf der Seite; Seitenleisten-Werbung erwähnt lediglich 'NativePHP Ultra' (alle Plugins, Teams & Priority-Support ab $35/mo) und ein 'Plugin Dev Kit'
- Inhalt wurde zusätzlich per Roh-HTML verifiziert: Die Seite enthält tatsächlich nur die Sektion 'Living on the EDGE' und das eine bottom-nav-Code-Beispiel

---

## NativePHP Mobile v3 — The Basics: Events

<https://nativephp.com/docs/mobile/3/the-basics/events>

Die Seite erklärt das Event-System von NativePHP for Mobile, mit dem asynchrone native Operationen in Laravel-Apps gehandhabt werden. Kernidee: PHP ist nicht für asynchrones Verhalten ausgelegt; viele native Mobile-Operationen (Kamera, Biometrie, Push-Enrollment) dauern an und erfordern Nutzerinteraktion. NativePHP glättet diese Paradigmen-Differenz über ein einfaches Event-System im Webhook-/Websocket-Stil, das die Laravel-App über den Abschluss asynchroner Methoden benachrichtigt.

1) Sync vs. Async: Synchrone APIs laufen sofort (Haptics::vibrate(), System::flashlight(), Dialog::toast('Hello!')). Asynchrone Aktionen kehren sofort zurück und feuern später ein Event: Camera::getPhoto() → PhotoTaken-Event, Biometrics::prompt() → Completed-Event, PushNotifications::enroll() → TokenGenerated-Event.

2) Event-Struktur: Alle Events sind normale Laravel-Event-Klassen mit public Properties, die die Daten aus der nativen App enthalten.

3) Custom Events: Eigene Event-Klasse definieren, die von einer NativePHP-Event-Klasse erbt (z. B. class MyButtonPressedEvent extends Native\Mobile\Events\Alert\ButtonPressed {}), diese Klasse per ->event(MyButtonPressedEvent::class) an die asynchrone Funktion übergeben (Beispiel: Dialog::alert('Warning!', '...', ['Cancel', 'Do it!'])->event(MyButtonPressedEvent::class)) und anschließend mit dem Attribut #[OnNative(MyButtonPressed::class)] auf einer public Methode behandeln.

4) Event-Handling-Muster (3 Schritte): Methode aufrufen, um die Operation auszulösen; auf passende Events lauschen, um Ergebnisse zu verarbeiten; UI anhand des Ergebnisses aktualisieren. Wichtig: Events werden SOWOHL an JavaScript in der WebView ALS AUCH an PHP über eine spezielle (nicht näher dokumentierte) Route gesendet.

5) Frontend-Handling:
   a) Native.on()-Helper im Blade/JS: @use(Native\Mobile\Events\Alert\ButtonPressed) und dann Native.on(@js(ButtonPressed::class), (index, label) => { alert(`You pressed button ${index}: ${label}`) }) — der ButtonPressed-Callback erhält index und label des gedrückten Buttons.
   b) On/Off-Import aus '#nativephp' (für Inertia/Vue/React): import { On, Events } from '#nativephp'; in onMounted: On(Events.Alert.ButtonPressed, handler); für Custom-Event-Klassen den voll qualifizierten Klassennamen als String mit doppelten Backslashes: On('App\\Events\\MyButtonPressedEvent', handler). De-Registrierung mit Off(Events.Alert.ButtonPressed, handler) z. B. in onUnmounted. Es existiert ein Events-Objekt mit den eingebauten Event-Namen (z. B. Events.Alert.ButtonPressed).
   c) #[OnNative()]-Attribut für Livewire-Komponentenmethoden: #[OnNative(PhotoTaken::class)] public function handlePhoto(string $path) — die Event-Properties werden als Methodenparameter übergeben (hier der Pfad des aufgenommenen Fotos). Livewire vereinfacht damit das Lauschen auf diese Events erheblich.

6) Backend-Handling: Listener werden als ganz normale Laravel-Event-Listener registriert, z. B. class UpdateAvatar mit Constructor-Injection (private APIService $api) und handle(PhotoTaken $event): void, in dem $event->path ausgelesen wird (base64_encode(file_get_contents($event->path)) → API-Upload).

Für die geplante Laravel/Livewire/Flux-App ist der wichtigste Mechanismus das #[OnNative(EventKlasse::class)]-Attribut auf Livewire-Methoden — damit lassen sich Kamera-, Biometrie- und Push-Ergebnisse direkt in Livewire-Komponenten verarbeiten; serverseitige Verarbeitung läuft über klassische Laravel-Listener. Verlinkte weiterführende Doku-Seiten: Native Functions, App Icons, Native Components.

### APIs

- Native\Mobile\Facades/APIs synchron: Haptics::vibrate() — Vibration sofort
- System::flashlight() — Taschenlampe sofort umschalten
- Dialog::toast('Hello!') — Toast sofort anzeigen
- Camera::getPhoto() — asynchron, feuert PhotoTaken-Event
- Biometrics::prompt() — asynchron, feuert Completed-Event
- PushNotifications::enroll() — asynchron, feuert TokenGenerated-Event
- Dialog::alert($title, $message, array $buttons) — asynchroner Dialog; ->event(CustomEvent::class) zum Überschreiben der Event-Klasse
- Event-Klassen: Native\Mobile\Events\Alert\ButtonPressed (Payload: index, label)
- Event-Klassen: Native\Mobile\Events\Camera\PhotoTaken (Payload: string $path)
- Event-Klassen: Native\Mobile\Events\Biometrics\Completed
- Event-Klassen: Native\Mobile\Events\PushNotifications\TokenGenerated
- Custom Events: eigene Klasse erbt von NativePHP-Event, z. B. class MyButtonPressedEvent extends ButtonPressed {} (Namespace App\Events)
- PHP-Attribut: Native\Mobile\Attributes\OnNative — #[OnNative(PhotoTaken::class)] auf public Methode einer Livewire-Komponente; Event-Properties werden als Methodenparameter injiziert
- JS-Helper: Native.on(@js(ButtonPressed::class), (index, label) => {...}) in Kombination mit Blade @use(Native\Mobile\Events\Alert\ButtonPressed)
- JS-Import: import { On, Off, Events } from '#nativephp' — On(Events.Alert.ButtonPressed, handler) registriert, Off(...) deregistriert (z. B. in onMounted/onUnmounted bei Vue)
- JS Custom-Events: On('App\\Events\\MyButtonPressedEvent', handler) — FQCN als String mit doppelten Backslashes
- Backend: normale Laravel-Event-Listener, z. B. class UpdateAvatar { public function handle(PhotoTaken $event): void { ... $event->path ... } } mit Constructor-Property-Promotion-DI

### Stolperfallen

- PHP ist nicht für asynchrones Verhalten ausgelegt; NativePHP löst das per Event-System im Webhook-/Websocket-Stil — asynchrone native Aufrufe kehren sofort zurück, Ergebnisse kommen NUR über Events
- Nicht alle Aktionen sind asynchron: Haptics::vibrate(), System::flashlight(), Dialog::toast() laufen synchron und feuern keine Events
- Events werden doppelt zugestellt: an JavaScript in der WebView UND an die PHP-App über eine spezielle Route (Routen-Details werden auf der Seite nicht offengelegt) — Handler-Logik nicht versehentlich doppelt ausführen
- Alle Events sind normale Laravel-Event-Klassen mit public Properties; Custom Events müssen von der jeweiligen NativePHP-Event-Klasse erben und werden per ->event(...) an die async Methode übergeben
- Bei On() mit Custom-Event-Klassen im JS muss der voll qualifizierte Klassenname mit doppelten Backslashes als String angegeben werden ('App\\Events\\MyButtonPressedEvent')
- JS-Handler sollten mit Off() wieder deregistriert werden (z. B. onUnmounted), um Mehrfach-Registrierungen zu vermeiden
- Im Doku-Beispiel inkonsistente Benennung: Klasse heißt MyButtonPressedEvent, im #[OnNative]-Beispiel wird MyButtonPressed importiert — beim Implementieren auf konsistente Klassennamen achten
- Für Livewire (relevant für dieses Projekt): #[OnNative(EventKlasse::class)] aus Native\Mobile\Attributes auf public Komponenten-Methoden verwenden; Event-Daten kommen als Methodenparameter (z. B. string $path bei PhotoTaken)
- Die Seite dokumentiert keine CLI-Befehle, env-Variablen, config-Keys oder nativen Berechtigungen (AndroidManifest/Info.plist) — diese stehen auf anderen Doku-Seiten (verlinkt: Native Functions, App Icons, Native Components)

---

## App Icons — NativePHP Mobile v3, Sektion "The Basics"

<https://nativephp.com/docs/mobile/3/the-basics/app-icon>

NativePHP Mobile v3 generiert die App-Icons für iOS und Android automatisch aus EINER einzigen Quelldatei. Vorgehen: eine hochauflösende Icon-Datei unter `public/icon.png` im Laravel-Projekt ablegen. Anforderungen an die Datei: Format PNG, exakt 1024 × 1024 Pixel, keinerlei Transparenzen (vollflächiger Hintergrund). Beim Build-Prozess skaliert NativePHP das Bild automatisch auf alle Android-Dichtevarianten (densities/mipmap-Varianten) und verwendet es als Basis-App-Icon für iOS. Voraussetzung dafür ist die aktivierte GD-PHP-Extension auf der Entwicklungsmaschine mit ausreichend Speicher (ca. 2 GB memory_limit werden empfohlen). Wird keine eigene Datei bereitgestellt, verwendet NativePHP automatisch ein Standard-Icon. Die Seite enthält keine eigenen CLI-Befehle, keine PHP/JS-APIs, keine config-/env-Einträge und keine nativen Berechtigungen; das Icon wird rein konventionsbasiert über den Dateipfad erkannt und im regulären Build-Vorgang verarbeitet. In der Doku-Navigation liegt die Seite in "The Basics" zwischen "Events" und "Splash Screens". Für den Implementierungsplan der Einundzwanzig-App genügt es also, ein 1024×1024-PNG ohne Alpha-Transparenz nach public/icon.png zu legen und GD mit hohem memory_limit in der lokalen PHP-Umgebung sicherzustellen.

### Konfiguration

- Dateikonvention: public/icon.png (einzige Quelldatei für iOS- und Android-Icons; keine config-Datei, keine env-Variable nötig)
- PHP-Umgebung: GD-Extension muss aktiviert sein; memory_limit ausreichend hoch setzen (~2 GB empfohlen)

### Stolperfallen

- Icon muss exakt 1024 × 1024 Pixel groß sein und im PNG-Format vorliegen
- Das PNG darf KEINE Transparenzen enthalten (vollflächiger, deckender Hintergrund erforderlich)
- GD-PHP-Extension muss auf der Entwicklungsmaschine installiert/aktiviert sein, sonst schlägt die automatische Icon-Generierung fehl; ca. 2 GB Speicher (memory_limit) einplanen
- Wird kein eigenes Icon bereitgestellt, nutzt NativePHP automatisch ein Default-Icon
- Die Seite dokumentiert keine separaten CLI-Befehle — das Icon wird im normalen Build-/Run-Workflow verarbeitet; ebenso keine Android-Adaptive-Icon-Optionen oder iOS-Dark/Tinted-Varianten (nur eine Quelldatei für beide Plattformen)

---

## Splash Screens — NativePHP Mobile v3 (The Basics)

<https://nativephp.com/docs/mobile/3/the-basics/splash-screens>

Sehr kurze Doku-Seite: NativePHP Mobile v3 macht es einfach, eigene Splash Screens für iOS- und Android-Apps hinzuzufügen. Der gesamte Mechanismus ist konventionsbasiert (Dateiablage), es gibt keine CLI-Befehle, keine PHP/JS-APIs und keine config-/env-Einstellungen auf dieser Seite.

Sektion "Supply your Splash Screens": Die Dateien werden an festen Pfaden im Laravel-Projekt abgelegt:
- `public/splash.png` — Splash Screen für den Light Mode
- `public/splash-dark.png` — Splash Screen für den Dark Mode

Sektion "Requirements":
- Format: PNG
- Mindestgröße/Seitenverhältnis: 1080 × 1920 Pixel
- Die GD-PHP-Extension muss aktiviert sein und genügend Speicher haben (~2 GB sollten ausreichen) — NativePHP generiert daraus offenbar zur Build-Zeit die plattformspezifischen Splash-Assets für iOS und Android.

Navigationskontext: Die Seite liegt in der Sektion "The Basics" zwischen "App Icons" (vorherige Seite) und "Assets" (nächste Seite). Für den Implementierungsplan der Einundzwanzig-App bedeutet das: Lediglich zwei PNGs (hell/dunkel, mind. 1080×1920, Hochformat 9:16) in `public/` ablegen und sicherstellen, dass die Build-Umgebung GD mit ausreichend memory_limit hat; die eigentliche Einbettung in die nativen Projekte erfolgt automatisch durch den NativePHP-Build (vgl. Seiten "Development"/"Command Reference", z. B. `php artisan native:run`).

### Konfiguration

- public/splash.png — Datei-Konvention: Light-Mode-Splash-Screen
- public/splash-dark.png — Datei-Konvention: Dark-Mode-Splash-Screen

### Stolperfallen

- Format muss PNG sein
- Mindestgröße/Seitenverhältnis: 1080 × 1920 Pixel (Hochformat)
- GD-PHP-Extension muss aktiviert sein
- GD braucht ausreichend Speicher — ca. 2 GB (memory_limit der Build-Umgebung entsprechend setzen)
- Dark Mode wird nur unterstützt, wenn zusätzlich splash-dark.png bereitgestellt wird
- Seite enthält keine CLI-Befehle, APIs oder config-Keys — die Verarbeitung der Splash-PNGs geschieht implizit im NativePHP-Build-Prozess (siehe separate Seiten Development/Command Reference)

---

## Assets (NativePHP Mobile v3, Sektion "The Basics")

<https://nativephp.com/docs/mobile/3/the-basics/assets>

Die Seite "Assets" der NativePHP-Mobile-Doku (v3) behandelt drei Themen: (1) Kompilieren von CSS/JavaScript: Wer React, Vue oder andere JS-Bibliotheken bzw. Tailwind CSS nutzt (also Build-Tooling wie Vite benötigt), muss den Frontend-Build VOR dem Kompilieren der nativen App ausführen — z. B. immer `npm run build` vor `php artisan native:run`, damit die neuesten Styles und das aktuelle JavaScript in den App-Build gelangen. (2) Sonstige Dateien ("Other files"): NativePHP bündelt ALLE Dateien aus dem Root der Laravel-Anwendung in die App; beliebige Dateien können also dort abgelegt werden, wo es am sinnvollsten ist. Zugriff auf solche Dateien muss über relative Pfade vom App-Root erfolgen; dafür sollen Laravels Path-Helper (base_path() etc.) verwendet werden. Wichtig: Der Helper `storage_path()` zeigt auf einen Ort AUSSERHALB des Laravel-Anwendungs-Roots (persistenter Gerätespeicher). (3) Public files: Empfängt die App Dateien vom Nutzer (von der App generiert oder z. B. aus der Fotogalerie importiert) und sollen diese im Web View angezeigt/abgespielt werden, müssen sie im `public`-Verzeichnis liegen. Damit sie App-Updates überleben, werden sie tatsächlich außerhalb von `public` in einem persistenten Speicherort abgelegt, der nach `public/storage` gesymlinkt wird. Zugriff erfolgt über die Filesystem-Disk `mobile_public`: `Storage::disk('mobile_public')->url('user_content.jpg')`. Pro-Tipp: `FILESYSTEM_DISK=mobile_public` in der `.env` setzen (beim Bauen der App), damit man die Disk auf Mobile nicht überall explizit angeben muss. Relevanz für unser Laravel+Livewire+Flux-Projekt: Vite-Build (`yarn run build`/`npm run build`) muss zwingend Teil der Mobile-Build-Pipeline vor `native:run` sein; nutzergenerierte Uploads (z. B. Bilder) gehören auf die `mobile_public`-Disk, damit sie Updates überstehen und per URL im Web View renderbar sind.

### Befehle

```bash
npm run build (Frontend-Build, muss vor dem nativen Kompilieren laufen)
php artisan native:run (kompiliert/startet die native App; immer NACH dem Frontend-Build ausführen)
```

### APIs

- Storage::disk('mobile_public')->url('user_content.jpg') — Illuminate Storage-Facade mit der NativePHP-Disk 'mobile_public' für persistente, im Web View anzeigbare Nutzerdateien (gesymlinkt nach public/storage)
- Laravel Path-Helper (z. B. base_path()) — für Zugriff auf beliebige mitgebündelte Dateien via relative Pfade vom App-Root
- storage_path() — zeigt auf Mobile auf einen Ort AUSSERHALB des Laravel-App-Roots (persistenter Speicher)

### Konfiguration

- FILESYSTEM_DISK=mobile_public in .env beim App-Build setzen (Pro-Tipp), damit die Default-Disk auf Mobile nicht explizit gewechselt werden muss
- Filesystem-Disk 'mobile_public': persistenter Speicherort außerhalb von public/, automatisch gesymlinkt auf public/storage

### Stolperfallen

- Build-Reihenfolge zwingend: Frontend-Build (Vite/npm, z. B. npm run build) MUSS vor php artisan native:run laufen, sonst fehlen aktuelle CSS/JS-Assets im nativen App-Bundle
- NativePHP bündelt alle Dateien aus dem Laravel-Root in die App — beliebige Zusatzdateien sind möglich, aber nur über relative Pfade vom App-Root (Laravel Path-Helper) erreichbar
- storage_path() verhält sich auf Mobile anders als gewohnt: zeigt außerhalb des Laravel-Roots — nicht für gebündelte Dateien verwenden
- Nutzergenerierte/importierte Dateien sind nur im Web View darstellbar, wenn sie unter public/ erreichbar sind; für Persistenz über App-Updates hinweg liegen sie real außerhalb von public/ und sind via Symlink public/storage + Disk 'mobile_public' erreichbar — normale Speicherung direkt in public/ würde bei App-Updates verloren gehen
- Keine Lizenzhinweise oder nativen Berechtigungen (AndroidManifest/Info.plist) auf dieser Seite; Werbe-Hinweise am Rand (NativePHP Ultra ab $35/Monat für alle Plugins/Teams/Priority-Support) betreffen nicht das Assets-Thema selbst
