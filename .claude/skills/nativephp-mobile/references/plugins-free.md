# NativePHP Mobile v3 — Free-Core-Plugins (MIT) — Browser, Camera, Device, Dialog, File, Microphone, Network, Share, System

> Quelle: Deep-Scan der offiziellen Doku (nativephp.com, Stand 2026-06-11). 9 Seiten.

---

## Browser (Core Plugins) — NativePHP Mobile v3

<https://nativephp.com/docs/mobile/3/plugins/core/browser>

Das Browser-Plugin (nativephp/mobile-browser, Core-Plugin von Bifrost Technology, Version 1.0.1, MIT-Lizenz) ermöglicht das Öffnen von URLs aus einer NativePHP-Mobile-App auf drei Arten: (1) inApp() öffnet URLs eingebettet in der App — auf Android via Custom Tabs, auf iOS via SFSafariViewController; empfohlen für Doku-/Hilfeseiten und verwandte externe Inhalte. (2) open() öffnet URLs im Standard-System-Browser des Geräts; empfohlen für komplexe Web-Apps oder Inhalte, die spezielle Browser-Features benötigen. (3) auth() öffnet Authentifizierungs-URLs (OAuth-Flows, z. B. mit WorkOS, Auth0, Google, Facebook) mit automatischem Redirect-Handling über das Custom-URL-Scheme nativephp:// (Beispiel-redirect_uri: nativephp://127.0.0.1/auth/callback). Installation per `composer require nativephp/mobile-browser`. PHP-Nutzung über die Facade Native\Mobile\Facades\Browser (Browser::inApp($url), Browser::open($url), Browser::auth($url)) — direkt aus Livewire/Blade nutzbar. JavaScript-Nutzung (für Vue/React/Inertia) über `import { Browser } from '#nativephp'` mit async-Methoden await Browser.inApp/open/auth. Die Seite dokumentiert keine Events/Callbacks, keine env-Variablen, keine config-Dateien und keine nativen Berechtigungseinträge (AndroidManifest/Info.plist). Anforderungen: NativePHP Mobile mindestens 3.0, iOS 18.2+, Android API 26+. Für eine Laravel+Livewire+Flux-App ist die PHP-Facade der direkte Integrationsweg; auth() ist der vorgesehene Mechanismus für externe OAuth-Logins (relevant z. B. für Lightning-Login-artige Redirect-Flows zurück in die App).

### Befehle

```bash
composer require nativephp/mobile-browser
```

### APIs

- PHP-Facade: Native\Mobile\Facades\Browser
- Browser::inApp(string $url) — öffnet URL eingebettet: Custom Tabs (Android) / SFSafariViewController (iOS); für Doku/Hilfeseiten/externe Inhalte
- Browser::open(string $url) — öffnet URL im Standard-System-Browser; für komplexe Web-Apps mit speziellen Browser-Features
- Browser::auth(string $url) — öffnet OAuth/Auth-URL mit automatischem nativephp://-Redirect-Handling (z. B. redirect_uri=nativephp://127.0.0.1/auth/callback); für OAuth mit WorkOS, Auth0, Google, Facebook
- JS-API: import { Browser } from '#nativephp' (Vue/React/Inertia)
- JS: await Browser.inApp(url) / await Browser.open(url) / await Browser.auth(url) — async, gleiche Semantik wie PHP-Facade
- Events/Callbacks: auf der Seite nicht dokumentiert (nur 'automatic nativephp:// redirect handling' bei auth())

### Konfiguration

- Keine env-Variablen auf der Seite dokumentiert
- Keine config-Datei-Keys dokumentiert
- Keine AndroidManifest.xml-/Info.plist-Einträge oder nativen Berechtigungen dokumentiert
- Implizit: Custom-URL-Scheme nativephp:// wird für auth()-Redirects verwendet (redirect_uri-Muster: nativephp://127.0.0.1/auth/callback)

### Stolperfallen

- Voraussetzung: NativePHP Mobile >= 3.0 (Min NativePHP Mobile 3.0)
- iOS-Mindestversion: 18.2+
- Android-Mindestversion: API 26+
- Lizenz: MIT; Autor: Bifrost Technology; Plugin-Version 1.0.1
- Plugin ist separates Composer-Paket, nicht im Kern enthalten — muss explizit installiert werden
- Plattformunterschied bei inApp(): Android nutzt Custom Tabs, iOS SFSafariViewController
- auth() erwartet, dass die redirect_uri auf das Scheme nativephp:// zeigt (z. B. nativephp://127.0.0.1/auth/callback) — externer OAuth-Provider muss dieses Redirect-URI erlauben
- Die Seite dokumentiert keine Events/Hooks zum Empfang des Auth-Callbacks und keine Konfiguration — Details dazu ggf. in anderen Doku-Sektionen (Deep Links) nachschlagen

---

## Camera Plugin for NativePHP Mobile (Core Plugins / Camera)

<https://nativephp.com/docs/mobile/3/plugins/core/camera>

Das Camera-Plugin für NativePHP Mobile v3 (Core-Plugin von Bifrost Technology, Version 1.0.3, MIT-Lizenz) bietet Zugriff auf die Gerätekamera für drei Funktionen: Fotoaufnahme, Videoaufzeichnung und Auswahl von Medien aus der Galerie (Gallery Picker).

INSTALLATION: Das Plugin wird als separates Composer-Paket installiert (`composer require nativephp/mobile-camera`) und muss anschließend explizit registriert werden (`php artisan native:plugin:register nativephp/mobile-camera`).

PHP-NUTZUNG (relevant für Livewire/Blade, also unseren Stack): Über die Facade `Native\Mobile\Facades\Camera` stehen bereit: `Camera::getPhoto()` (Foto aufnehmen), `Camera::recordVideo()` (Video aufnehmen, optional mit Array-Optionen wie `['maxDuration' => 30]`) und `Camera::pickImages($type, $multiple)` (Galerie-Auswahl: `pickImages('images', false)` = ein Bild, `pickImages('images', true)` = mehrere Bilder, `pickImages('all', true)` = beliebiger Medientyp). `recordVideo()` unterstützt zusätzlich eine Fluent-API (PendingVideoRecorder): `Camera::recordVideo()->maxDuration(60)->id('my-video-123')->start()`.

JS-NUTZUNG (Vue/React/Inertia, für uns nur Referenz): Import via `import { Camera, On, Off, Events } from '#nativephp'`; `await Camera.getPhoto().id('profile-pic')`, `await Camera.recordVideo().maxDuration(60)`, `await Camera.pickImages().images().multiple().maxItems(5)`. Event-Listener via `On(Events.Camera.PhotoTaken, handler)` / `Off(...)` (z. B. in Vue onMounted/onUnmounted).

EVENTS (alle Ergebnisse kommen asynchron als native Events zurück, in Livewire via Attribut `#[OnNative(EventKlasse::class)]` aus `Native\Mobile\Attributes\OnNative`):
1. `Native\Mobile\Events\Camera\PhotoTaken` — nach Fotoaufnahme; Handler-Signatur `handlePhotoTaken(string $path)` (Pfad zur JPEG-Datei).
2. `Native\Mobile\Events\Camera\VideoRecorded` (Namespace analog Camera) — nach erfolgreicher Videoaufnahme; Payload: `string $path` (Dateipfad), `string $mimeType` (Default `'video/mp4'`), `?string $id` (optionaler Identifier, falls via `id()` gesetzt).
3. `VideoCancelled` — wenn der Nutzer die Videoaufnahme abbricht.
4. `Native\Mobile\Events\Gallery\MediaSelected` — nach Galerie-Auswahl; Handler-Signatur `handleMediaSelected($success, $files, $count)`, über `$files` wird iteriert.

PENDINGVIDEORECORDER-API (Fluent-Methoden auf `Camera::recordVideo()`): `maxDuration(int $seconds)` (maximale Aufnahmedauer in Sekunden), `id(string $id)` (eindeutiger Identifier zur Korrelation mit Events), `event(string $eventClass)` (eigene Event-Klasse, die bei Abschluss dispatched wird), `remember()` (speichert die Recorder-ID in der Session für späteren Abruf), `start()` (startet die Aufnahme explizit).

SPEICHERORTE: Fotos — Android: App-Cache-Verzeichnis `{cache}/captured.jpg`; iOS: `~/Library/Application Support/Photos/captured.jpg`. Videos — Android: `{cache}/video_{timestamp}.mp4`; iOS: `~/Library/Application Support/Videos/captured_video_{timestamp}.mp4`. Dateiformate: JPEG für Fotos, MP4 für Videos. Achtung für den Implementierungsplan: Auf Android landet alles im Cache und der Foto-Dateiname `captured.jpg` ist fix (wird also bei jeder Aufnahme überschrieben) — Dateien sollten nach dem Event sofort an einen dauerhaften Ort kopiert werden.

KONFIGURATION/BERECHTIGUNGEN: Die `camera`-Permission muss in `config/nativephp.php` aktiviert werden (keine direkten AndroidManifest-/Info.plist-Edits auf der Seite dokumentiert — NativePHP generiert die nativen Berechtigungen aus dieser Config). Wird die Berechtigung verweigert, schlagen Kamerafunktionen STILL fehl (kein Fehler/Exception). Die Camera-Permission wird für Fotos, Videos UND QR-/Barcode-Scanning benötigt.

PLUGIN-DETAILS: Author: Bifrost Technology; Version: 1.0.3; License: MIT; NativePHP Mobile: * (alle Versionen); iOS-Minimum: 18.2; Android-Minimum: API 26; Support: nativephp.com/support.

### Befehle

```bash
composer require nativephp/mobile-camera
php artisan native:plugin:register nativephp/mobile-camera
```

### APIs

- Native\Mobile\Facades\Camera — PHP-Facade des Plugins
- Camera::getPhoto() — Foto mit der Kamera aufnehmen (Ergebnis via PhotoTaken-Event)
- Camera::recordVideo() — Video aufnehmen; optional Options-Array z. B. ['maxDuration' => 30]; gibt PendingVideoRecorder für Fluent-API zurück
- Camera::recordVideo()->maxDuration(60)->id('my-video-123')->start() — Fluent-API-Beispiel
- Camera::pickImages('images', false) — ein einzelnes Bild aus der Galerie wählen
- Camera::pickImages('images', true) — mehrere Bilder aus der Galerie wählen
- Camera::pickImages('all', true) — beliebige Medientypen (mehrfach) aus der Galerie wählen
- PendingVideoRecorder::maxDuration(int $seconds) — maximale Aufnahmedauer in Sekunden
- PendingVideoRecorder::id(string $id) — eindeutiger Identifier zur Korrelation mit Events
- PendingVideoRecorder::event(string $eventClass) — eigene Event-Klasse für Aufnahme-Abschluss
- PendingVideoRecorder::remember() — Recorder-ID in der Session speichern
- PendingVideoRecorder::start() — Aufnahme explizit starten
- Native\Mobile\Attributes\OnNative — PHP-Attribut zum Registrieren von Event-Handlern in Livewire-Komponenten, z. B. #[OnNative(PhotoTaken::class)]
- Native\Mobile\Events\Camera\PhotoTaken — Event nach Fotoaufnahme; Handler: handlePhotoTaken(string $path)
- VideoRecorded (Events\Camera) — Event nach erfolgreicher Videoaufnahme; Payload: string $path, string $mimeType (Default 'video/mp4'), ?string $id
- VideoCancelled (Events\Camera) — Event, wenn der Nutzer die Videoaufnahme abbricht
- Native\Mobile\Events\Gallery\MediaSelected — Event nach Galerie-Auswahl; Handler: handleMediaSelected($success, $files, $count)
- JS: import { Camera, On, Off, Events } from '#nativephp'
- JS: await Camera.getPhoto().id('profile-pic') — Foto mit Tracking-Identifier
- JS: await Camera.recordVideo().maxDuration(60)
- JS: await Camera.pickImages().images().multiple().maxItems(5)
- JS: On(Events.Camera.PhotoTaken, handler) / Off(Events.Camera.PhotoTaken, handler) — Event-Listener registrieren/entfernen; Payload-Zugriff z. B. payload.path

### Konfiguration

- camera-Berechtigung muss in config/nativephp.php aktiviert werden (Pflicht für alle Kamerafunktionen)
- Keine manuellen AndroidManifest.xml-/Info.plist-Einträge auf der Seite dokumentiert — die native Berechtigung wird über config/nativephp.php gesteuert
- Foto-Speicherort Android: {cache}/captured.jpg (App-Cache-Verzeichnis)
- Foto-Speicherort iOS: ~/Library/Application Support/Photos/captured.jpg
- Video-Speicherort Android: {cache}/video_{timestamp}.mp4
- Video-Speicherort iOS: ~/Library/Application Support/Videos/captured_video_{timestamp}.mp4

### Stolperfallen

- Plugin muss nach composer require explizit registriert werden: php artisan native:plugin:register nativephp/mobile-camera
- Wird die camera-Permission verweigert, schlagen Kamerafunktionen STILL fehl (silently) — kein Fehler, keine Exception; im Implementierungsplan Timeout-/Fallback-Handling einplanen
- Die camera-Permission wird auch für QR-/Barcode-Scanning benötigt, nicht nur für Fotos und Videos
- Alle Ergebnisse kommen asynchron als Events zurück (PhotoTaken, VideoRecorded, VideoCancelled, MediaSelected) — in Livewire via #[OnNative(...)]-Attribut behandeln
- Android-Foto-Dateiname ist fix ({cache}/captured.jpg) und liegt im Cache — Datei nach Empfang des Events sofort dauerhaft wegkopieren, sonst Überschreiben/Cache-Bereinigung möglich
- Dateiformate fest: JPEG für Fotos, MP4 für Videos (mimeType-Default 'video/mp4')
- Mindestversionen: iOS 18.2, Android API 26; gilt für NativePHP Mobile * (alle v3-Versionen)
- Lizenz MIT, Author Bifrost Technology, Plugin-Version 1.0.3; Support unter nativephp.com/support
- id() bei recordVideo()/getPhoto() dient der Korrelation von Aufruf und Event (?string $id im VideoRecorded-Payload) — nützlich, wenn mehrere Aufnahme-Flows in einer App existieren
- JS-API ('#nativephp'-Import) ist für Vue/React/Inertia gedacht — für unseren Livewire/Flux-Stack ist primär die PHP-Facade + OnNative relevant

---

## NativePHP Mobile v3 – Core Plugins: Device (nativephp/mobile-device)

<https://nativephp.com/docs/mobile/3/plugins/core/device>

Die Seite dokumentiert das Core-Plugin "Device" (Composer-Paket nativephp/mobile-device, Version 1.0.2, MIT-Lizenz, Autor: Bifrost Technology), das Zugriff auf Hardware-Funktionen des Mobilgeräts bietet: Vibration, Taschenlampen-Steuerung, eindeutige Geräte-ID, detaillierte Geräteinformationen und Batteriestatus. Installation per `composer require nativephp/mobile-device`. Die PHP-Nutzung erfolgt über die Facade `Native\Mobile\Facades\Device` (synchrone Aufrufe, relevant für Livewire/Blade – also das Setup dieses Projekts); parallel existiert eine JavaScript-API via `import { Device } from '#nativephp'` mit async/await-Promises (für Vue/React/Inertia). Fünf parameterlose Methoden: vibrate() -> {success: true}; toggleFlashlight() -> {success: bool, state: bool} (state = neuer An/Aus-Zustand); getId() -> {id: string} (eindeutige Geräte-ID); getInfo() -> {info: string} (JSON-String mit name, model, platform [ios/android], operatingSystem, osVersion, manufacturer, language [BCP-47-Tag], isVirtual, memUsed [Bytes], webViewVersion); getBatteryInfo() -> {info: string} (JSON-String mit batteryLevel [0.0–1.0] und isCharging [bool]). Die info-Felder sind JSON-Strings und müssen client-/serverseitig geparst werden (z. B. json_decode bzw. JSON.parse). Android benötigt die Berechtigungen android.permission.VIBRATE und android.permission.FLASHLIGHT; iOS benötigt keine speziellen Berechtigungen. Plattform-Anforderungen: iOS 18.2+, Android API 26+. Keine Events/Listener, keine .env-Variablen oder config-Dateien, keine artisan-Befehle, keine weiteren Callouts/Warnungen auf der Seite dokumentiert. Für eine Livewire/Flux-App ist die Device-Facade direkt in Livewire-Actions nutzbar (z. B. Device::vibrate() als haptisches Feedback, Device::getId() zur Geräteidentifikation, Batterie-/Geräteinfo für Diagnose-Screens).

### Befehle

```bash
composer require nativephp/mobile-device
```

### APIs

- PHP-Facade: Native\Mobile\Facades\Device (synchroner Aufruf in Livewire/Blade)
- Device::vibrate(): array — Gerät vibrieren lassen; Rückgabe ['success' => true]
- Device::toggleFlashlight(): array — Taschenlampe umschalten; Rückgabe ['success' => bool, 'state' => bool] (state = aktueller An/Aus-Zustand)
- Device::getId(): array — eindeutige Geräte-ID; Rückgabe ['id' => 'unique-device-id']
- Device::getInfo(): array — Geräteinfos als JSON-String; Rückgabe ['info' => '{"name":...,"model":...,"platform":"ios|android","operatingSystem":...,"osVersion":...,"manufacturer":...,"language":"BCP-47","isVirtual":...,"memUsed":Bytes,"webViewVersion":...}']
- Device::getBatteryInfo(): array — Batteriestatus als JSON-String; Rückgabe ['info' => '{"batteryLevel":0.0-1.0,"isCharging":bool}']
- JS-API: import { Device } from '#nativephp' — alle Methoden async/Promise-basiert: await Device.vibrate(), await Device.toggleFlashlight() (Ergebnis .state), await Device.getId() (.id), await Device.getInfo() (.info per JSON.parse parsen), await Device.getBatteryInfo() (.info per JSON.parse parsen)
- Keine Events, Listener oder Broadcasting-Mechanismen dokumentiert; alle Methoden parameterlos

### Konfiguration

- Android-Berechtigung: android.permission.VIBRATE
- Android-Berechtigung: android.permission.FLASHLIGHT
- iOS: keine speziellen Berechtigungen erforderlich (kein Info.plist-Eintrag dokumentiert)
- Keine .env-Variablen und keine config-Datei-Einträge dokumentiert

### Stolperfallen

- Plattform-Mindestversionen: iOS 18.2+ und Android API 26+ (Android 8.0)
- Lizenz: MIT; Plugin-Version 1.0.2; Autor: Bifrost Technology; Support über nativephp.com/support
- getInfo() und getBatteryInfo() liefern das Feld 'info' als JSON-STRING, nicht als Array/Objekt — muss mit json_decode() (PHP) bzw. JSON.parse() (JS) geparst werden
- batteryLevel ist ein Float 0.0–1.0 (für Prozentanzeige mit 100 multiplizieren)
- PHP-API ist synchron, JS-API ist asynchron (Promises/await) — bei Livewire die Facade direkt in Actions verwenden
- Die Seite dokumentiert keine Rebuild-/Install-Schritte (kein php artisan native:install/native:run erwähnt); ob die Android-Berechtigungen vom Plugin automatisch ins Manifest injiziert werden oder manuell einzutragen sind, geht aus der Seite nicht eindeutig hervor — beim Implementierungsplan das generierte AndroidManifest.xml prüfen
- Keine Events/Broadcasts: Ergebnisse kommen nur als direkte Rückgabewerte (anders als bei manchen anderen NativePHP-Plugins mit Event-Pattern)
- toggleFlashlight() schaltet nur um (Toggle); ein explizites An/Aus mit Zielzustand als Parameter ist nicht dokumentiert — Zustand über das zurückgegebene 'state'-Flag verfolgen

---

## NativePHP Mobile v3 — Core Plugins: Dialog

<https://nativephp.com/docs/mobile/3/plugins/core/dialog>

Das Dialog-Plugin (Core Plugin von NativePHP Mobile v3) liefert native Alert-Dialoge und Toast-/Snackbar-Benachrichtigungen für iOS und Android. Installation per `composer require nativephp/mobile-dialog`.

PHP-Seite (relevant für Laravel + Livewire): Über die Facade `Native\Mobile\Facades\Dialog` werden Alerts mit `Dialog::alert($title, $message, $buttons = ['OK'])` erzeugt. Der Rückgabewert ist ein konfigurierbares Pending-Objekt mit Fluent-Methoden: `->id(string)` setzt eine eindeutige Alert-ID (zur Unterscheidung mehrerer Alerts im Event-Handler), `->event(EventClass::class)` lässt beim Buttondruck eine eigene Event-Klasse dispatchen, `->remember()` speichert die Alert-ID in der Session (späterer Abruf via `\Native\Mobile\PendingAlert::lastId()`), `->show()` zeigt den Alert explizit an — ohne Aufruf wird der Alert automatisch beim Destruct des Objekts angezeigt. Toasts: `Dialog::toast($message, $duration = 'long')` mit `'short'` (2 s) oder `'long'` (4 s, Standard).

Buttondruck-Handling in Livewire: Das Event `Native\Mobile\Events\Alert\ButtonPressed` (Properties: `int $index` 0-basiert, `string $label`, `string|null $id`) wird über das Attribut `#[OnNative(ButtonPressed::class)]` (aus `Native\Mobile\Attributes\OnNative`) auf einer Livewire-Methode empfangen, z. B. `public function handleButton($index, $label, $id = null)`; typisches Muster: per `$id`/`$label` prüfen, welcher Alert/Button gedrückt wurde (z. B. Delete-Bestätigung).

JS-Seite (Vue/React/Inertia, für dieses Projekt nur sekundär relevant): `import { Dialog, On, Off, Events } from '#nativephp'`; `await Dialog.alert(title, message, buttons[])` (mit `.id('...')` verkettbar), `Dialog.toast(message, duration)`; Event-Listener via `On(Events.Alert.ButtonPressed, callback)` und Abmeldung mit `Off(...)` (in Vue typisch in onMounted/onUnmounted); Payload enthält `{ index, label, id }`.

Plattformverhalten: Android nutzt nativen `AlertDialog` und Material-Design-`Snackbar` (erscheint über der Bottom Navigation); iOS nutzt nativen `UIAlertController` im `.alert`-Style und einen Custom `ToastManager`-Overlay für Toasts.

Plugin-Metadaten: Autor Bifrost Technology, Version 1.0.1, Lizenz MIT, Mindestversionen iOS 18.2 / Android API 26. Die Seite dokumentiert keine env-Variablen, config-Dateien oder nativen Berechtigungen (AndroidManifest/Info.plist) — das Plugin benötigt keine speziellen Permissions.

### Befehle

```bash
composer require nativephp/mobile-dialog
```

### APIs

- Facade Native\Mobile\Facades\Dialog — Einstiegspunkt für Alerts und Toasts (PHP)
- Dialog::alert(string $title, string $message, array $buttons = ['OK']) — erzeugt nativen Alert-Dialog; Rückgabe: Pending-Objekt mit Fluent-Konfiguration
- ->id(string $id) — eindeutige Alert-ID setzen, um im Event-Handler zu erkennen, welcher Alert den Buttondruck ausgelöst hat
- ->event(string $eventClass) — eigene Event-Klasse dispatchen, wenn ein Button gedrückt wird
- ->remember() — Alert-ID in der Session speichern; Abruf im Handler via \Native\Mobile\PendingAlert::lastId()
- ->show() — Alert explizit anzeigen; ohne Aufruf erscheint der Alert automatisch beim Destruct des Objekts
- Dialog::toast(string $message, string $duration = 'long') — Toast/Snackbar; 'short' = 2 s, 'long' = 4 s (Default)
- Event-Klasse Native\Mobile\Events\Alert\ButtonPressed — Properties: int $index (0-basiert), string $label, string|null $id
- Attribut Native\Mobile\Attributes\OnNative — #[OnNative(ButtonPressed::class)] auf Livewire-Methode, Signatur z. B. handleButton($index, $label, $id = null)
- \Native\Mobile\PendingAlert::lastId() — zuletzt gemerkte (remember) Alert-ID auslesen
- JS: import { Dialog, On, Off, Events } from '#nativephp'
- JS: await Dialog.alert(title, message, buttons[]) — verkettbar mit .id('...')
- JS: Dialog.toast(message, duration) — 'short' oder 'long'
- JS: On(Events.Alert.ButtonPressed, callback) / Off(Events.Alert.ButtonPressed, callback) — Listener registrieren/entfernen; Payload { index, label, id }

### Konfiguration

- Keine env-Variablen oder config-Keys dokumentiert
- Keine nativen Berechtigungen erforderlich (keine AndroidManifest- oder Info.plist-Einträge auf der Seite dokumentiert)

### Stolperfallen

- Plugin muss separat installiert werden: composer require nativephp/mobile-dialog (nicht im Core-Paket enthalten)
- Mindestversionen: iOS 18.2+, Android API 26+
- Lizenz MIT; Autor Bifrost Technology; Plugin-Version 1.0.1
- Alert wird ohne ->show() automatisch beim Objekt-Destruct angezeigt — explizites ->show() nur für sofortige Anzeige nötig
- Default-Buttons sind ['OK'], wenn kein Buttons-Array übergeben wird; eine maximale Buttonanzahl wird nicht dokumentiert
- Bei mehreren Alerts in einer Komponente ->id() setzen und im ButtonPressed-Handler per $id unterscheiden, sonst sind Buttondrücke nicht zuordenbar
- ButtonPressed-Index ist 0-basiert; Handler erhält ($index, $label, $id = null)
- ->remember() nutzt die Session zur ID-Ablage; Abruf erfolgt über PendingAlert::lastId() im Event-Handler
- Plattformunterschiede in der Darstellung: Android AlertDialog + Material Snackbar (über Bottom Navigation), iOS UIAlertController (.alert) + Custom ToastManager-Overlay
- Toast-Dauer nur zwei feste Stufen: 'short' (2 s) und 'long' (4 s, Default) — keine freie Millisekundenangabe
- Im JS-Pfad Listener mit Off() wieder abmelden (z. B. onUnmounted), um Memory-Leaks/Doppel-Handler zu vermeiden; für Livewire-Projekt ist der PHP-Pfad mit #[OnNative] der relevante Weg

---

## File Plugin for NativePHP Mobile (Core Plugins > File)

<https://nativephp.com/docs/mobile/3/plugins/core/file>

Das File-Plugin (Paket: nativephp/mobile-file) ist ein Core-Plugin für NativePHP Mobile v3, das plattformübergreifende Dateioperationen (Verschieben und Kopieren von Dateien) für Android und iOS bereitstellt. Installation per `composer require nativephp/mobile-file`. Die API besteht aus genau zwei Methoden: `move(string $from, string $to): array` und `copy(string $from, string $to): array`. Beide geben ein Array mit `success` (bool) und optional `error` (string, Fehlermeldung bei Fehlschlag) zurück. Nutzung in PHP (Livewire/Blade) über die Facade `Native\Mobile\Facades\File` (z. B. `File::move('/path/to/source.txt', '/path/to/destination.txt')`, `File::copy(...)`); in JavaScript (Vue/React/Inertia) über `import { File } from '#nativephp'` mit `await File.move(from, to)` bzw. `await File.copy(from, to)`. Verhalten: Übergeordnete Verzeichnisse werden automatisch angelegt, falls sie nicht existieren; existierende Zieldateien werden überschrieben; nach Kopiervorgängen wird die Dateiintegrität verifiziert; auf Android fällt move bei fehlgeschlagenem Rename (Cross-Filesystem) auf Kopieren + Löschen zurück. Die Doku enthält zwei Beispiele: (1) "Move File to Permanent Storage" – Verschieben einer temporären Aufnahme (z. B. '/var/mobile/Containers/Data/tmp/recording.m4a') nach storage_path('recordings/recording.m4a') mit Erfolgsprüfung über $result['success']; (2) "Backup File Before Edit" – vor dem Bearbeiten einer Datei per File::copy ein Backup mit Suffix '_backup' anlegen. Plugin-Details: Autor Bifrost Technology, Version 1.0.1, Lizenz MIT, Mindestanforderungen iOS 18.2+ und Android API 26+, Support unter nativephp.com/support. Die Seite definiert keine Events, keine env-Variablen, keine config-Dateien und keine nativen Berechtigungen (AndroidManifest.xml/Info.plist) – das Plugin arbeitet im App-Sandbox-Dateisystem. Für eine Laravel-+-Livewire-+-Flux-UI-App ist der PHP-Facade-Weg der relevante Integrationspfad.

### Befehle

```bash
composer require nativephp/mobile-file
```

### APIs

- PHP-Facade: Native\Mobile\Facades\File — Einstiegspunkt für Dateioperationen in Livewire/Blade
- File::move(string $from, string $to): array — verschiebt eine Datei; Rückgabe: ['success' => bool, 'error' => ?string]
- File::copy(string $from, string $to): array — kopiert eine Datei; Rückgabe: ['success' => bool, 'error' => ?string]
- JavaScript (Vue/React/Inertia): import { File } from '#nativephp'
- JS: await File.move('/path/to/source.txt', '/path/to/destination.txt') — async, Promise-basiert
- JS: await File.copy('/path/to/source.txt', '/path/to/copy.txt') — async, Promise-basiert
- Keine Events/Event-Klassen oder Listener auf dieser Seite dokumentiert

### Konfiguration

- Keine env-Variablen dokumentiert
- Keine config-Datei-Einträge dokumentiert
- Keine nativen Berechtigungen erforderlich (keine Einträge für AndroidManifest.xml oder Info.plist)

### Stolperfallen

- Mindestanforderungen: iOS 18.2+ und Android API-Level 26+
- Existierende Zieldateien werden ohne Nachfrage überschrieben — bei Bedarf vorher selbst prüfen/backuppen
- Übergeordnete Verzeichnisse werden automatisch erstellt, falls nicht vorhanden
- Dateiintegrität wird nach Copy-Operationen automatisch verifiziert
- Android: Schlägt das Umbenennen bei move fehl (Cross-Filesystem), erfolgt automatischer Fallback auf Kopieren + Löschen
- Rückgabe ist ein Array mit 'success' (bool) und optionalem 'error' (string) — Erfolg immer über $result['success'] prüfen, es wird keine Exception geworfen
- Separates Composer-Paket (nativephp/mobile-file), nicht im Basis-Paket enthalten — muss explizit installiert werden
- Plugin von Drittautor Bifrost Technology (Version 1.0.1), Lizenz MIT; Support über nativephp.com/support
- Nur move und copy — kein delete, read, write, exists o. ä. in diesem Plugin; dafür reguläre Laravel-/PHP-Dateifunktionen im App-Sandbox-Pfad nutzen
- Beispielpfade zeigen Nutzung mit storage_path() für persistente Ablage; temporäre iOS-Pfade liegen z. B. unter /var/mobile/Containers/Data/tmp/

---

## Microphone — NativePHP Mobile v3 Core Plugin

<https://nativephp.com/docs/mobile/3/plugins/core/microphone>

Das Microphone-Plugin (Core Plugin, Autor: Bifrost Technology, v1.0.1, MIT-Lizenz) bietet Audio-Aufnahme über das Gerätemikrofon mit Pause/Resume-Unterstützung, optionaler Hintergrundaufnahme und nativer Berechtigungsverwaltung. Installation via `composer require nativephp/mobile-microphone`. Die PHP-Seite nutzt die Facade `Native\Mobile\Facades\Microphone` mit einer Fluent-API: `Microphone::record()` liefert ein `PendingMicrophone`-Objekt, das per `->id(string $id)` (eindeutige Recorder-Kennung), `->event(string $eventClass)` (eigene Event-Klasse bei Abschluss), `->remember()` (Recorder-ID in der Session speichern) konfiguriert und mit `->start()` gestartet wird (Rückgabe `true` bei Erfolg, `false` wenn bereits eine Aufnahme läuft). Weitere statische Methoden: `Microphone::stop()`, `Microphone::pause()`, `Microphone::resume()`, `Microphone::getStatus()` (liefert "idle", "recording" oder "paused") und `Microphone::getRecording()` (Pfad der letzten Aufnahme). Wird `start()` nicht explizit aufgerufen, startet die Aufnahme automatisch beim Destruktor des PendingMicrophone-Objekts (Auto-Start-Verhalten). Bei Abschluss einer Aufnahme wird das Event `Native\Mobile\Events\Microphone\MicrophoneRecorded` ausgelöst mit Payload: `string $path` (Dateipfad), `string $mimeType` (Standard 'audio/m4a'), `?string $id` (Recorder-ID, falls gesetzt). In Livewire-Komponenten wird es per Attribut `#[OnNative(MicrophoneRecorded::class)]` (aus `Native\Mobile\Attributes\OnNative`) auf einer Handler-Methode wie `handleAudioRecorded(string $path, string $mimeType, ?string $id)` empfangen — genau das Muster, das für die geplante Laravel+Livewire+Flux-App relevant ist. Für JS-Frontends (Vue/React/Inertia) existiert eine äquivalente API via `import { Microphone, On, Off, Events } from '#nativephp'`: `await Microphone.record()` (optional `.id('voice-memo')`), `await Microphone.stop()/pause()/resume()`, `await Microphone.getStatus()` (Ergebnisobjekt mit `result.status`), `await Microphone.getRecording()` (Ergebnisobjekt mit `result.path`); Event-Abo über `On(Events.Microphone.MicrophoneRecorded, handler)` und Abmeldung über `Off(...)` (in Vue via onMounted/onUnmounted, in React via useEffect-Cleanup). Aufnahmen werden als M4A/AAC-Dateien (.m4a) gespeichert, optimiert auf kleine Dateigröße. Es kann nur eine aktive Aufnahme gleichzeitig geben. Die Mikrofon-Berechtigung wird beim ersten Zugriff nativ vom System erfragt; bei Verweigerung schlagen Aufnahmefunktionen still (ohne Fehler) fehl. Für Aufnahmen bei gesperrtem Gerät/im Hintergrund muss der Konfigurationsschlüssel `microphone_background` auf true gesetzt werden. Plattformanforderungen: iOS 18.2+ und Android API 26+.

### Befehle

```bash
composer require nativephp/mobile-microphone
```

### APIs

- PHP-Facade: Native\Mobile\Facades\Microphone — Einstiegspunkt für alle Aufnahme-Operationen
- Microphone::record(): PendingMicrophone — startet Fluent-Kette für eine neue Aufnahme
- PendingMicrophone::id(string $id) — eindeutige Recorder-Kennung setzen (z. B. 'voice-note-123')
- PendingMicrophone::event(string $eventClass) — eigene Event-Klasse, die bei Abschluss statt/zusätzlich gefeuert wird (z. B. App\Events\VoiceMessageRecorded::class)
- PendingMicrophone::remember() — speichert die Recorder-ID in der Session
- PendingMicrophone::start(): bool — Aufnahme explizit starten; true bei Erfolg, false wenn bereits eine Aufnahme läuft; ohne expliziten Aufruf Auto-Start beim Zerstören des PendingMicrophone-Objekts
- Microphone::stop() — Aufnahme beenden
- Microphone::pause() — Aufnahme pausieren
- Microphone::resume() — Aufnahme fortsetzen
- Microphone::getStatus(): string — liefert 'idle' | 'recording' | 'paused'
- Microphone::getRecording(): string — Pfad der letzten Aufnahme
- Event: Native\Mobile\Events\Microphone\MicrophoneRecorded — Payload: string $path (Dateipfad), string $mimeType (Standard 'audio/m4a'), ?string $id (Recorder-ID falls gesetzt)
- Livewire-Attribut: Native\Mobile\Attributes\OnNative — #[OnNative(MicrophoneRecorded::class)] auf Komponentenmethode, Signatur z. B. handleAudioRecorded(string $path, string $mimeType, ?string $id)
- JS-API: import { Microphone, On, Off, Events } from '#nativephp'
- JS: await Microphone.record() bzw. await Microphone.record().id('voice-memo')
- JS: await Microphone.stop() / Microphone.pause() / Microphone.resume()
- JS: await Microphone.getStatus() — Ergebnisobjekt mit result.status ('recording' etc.)
- JS: await Microphone.getRecording() — Ergebnisobjekt mit result.path
- JS-Events: On(Events.Microphone.MicrophoneRecorded, handler) zum Abonnieren, Off(Events.Microphone.MicrophoneRecorded, handler) zum Abmelden (Vue: onMounted/onUnmounted, React: useEffect mit Cleanup)

### Konfiguration

- microphone_background = true — Konfigurationsschlüssel, um Aufnahmen bei gesperrtem Gerät/im Hintergrund zu erlauben
- Mikrofon-Berechtigung: nativer System-Permission-Prompt beim ersten Zugriff (Plugin verwaltet die Berechtigungsanfrage selbst; keine expliziten AndroidManifest-/Info.plist-Einträge auf der Seite dokumentiert)

### Stolperfallen

- Plattform-Mindestversionen: iOS 18.2+ und Android API 26+ (Android 8.0)
- Bei verweigerter Mikrofon-Berechtigung schlagen Aufnahmefunktionen STILL fehl — kein Fehler/keine Exception; eigene UX-Behandlung nötig
- Nur EINE aktive Aufnahme gleichzeitig: start() gibt false zurück, wenn bereits aufgenommen wird
- Auto-Start-Falle: Ohne expliziten start()-Aufruf startet die Aufnahme automatisch, sobald das PendingMicrophone-Objekt zerstört wird
- Aufnahmeformat fest M4A/AAC (.m4a), Standard-MIME-Type 'audio/m4a' — kein anderes Format dokumentiert
- Hintergrundaufnahme funktioniert nur, wenn microphone_background in der Konfiguration aktiviert ist
- Separates Composer-Paket (Core Plugin), nicht im Basis-Paket enthalten: composer require nativephp/mobile-microphone
- getStatus() liefert nur drei Zustände: idle, recording, paused
- Lizenz: MIT; Autor: Bifrost Technology; Plugin-Version 1.0.1; Support über nativephp.com/support, Quellcode auf GitHub/Packagist

---

## Network (Core Plugins) — NativePHP Mobile v3

<https://nativephp.com/docs/mobile/3/plugins/core/network>

Das Core-Plugin "nativephp/mobile-network" (Autor: Bifrost Technology, Version 1.0.1, MIT-Lizenz) liefert plattformübergreifendes Monitoring des Netzwerk-Konnektivitätsstatus für NativePHP-Mobile-Apps: Erkennung, ob das Gerät verbunden ist, welcher Verbindungstyp vorliegt und ob die Verbindung getaktet/metered ist. Seitenstruktur: Overview, Installation, Usage, Response Object, Examples, Platform Behavior.

Installation erfolgt per `composer require nativephp/mobile-network`; weitere CLI-Befehle (php artisan o.ä.) werden nicht dokumentiert.

API: Es gibt genau EINE dokumentierte Methode — `Network::status()`. In PHP (relevant für Laravel/Livewire/Flux-UI-Apps) über die Facade `Native\Mobile\Facades\Network`: `$status = Network::status();` liefert ein Status-Objekt mit den Properties `connected` (bool), `type` (string: wifi|cellular|ethernet|unknown), `isExpensive` (bool, metered, z.B. Mobilfunkdaten) und `isConstrained` (bool, iOS Low Data Mode; auf Android immer false). In JavaScript (Vue/React/Inertia): `import { Network } from '#nativephp';` und `const status = await Network.status();` (async, Promise) mit denselben Feldern. Events/Listener für Netzwerkänderungen, Polling-APIs oder weitere Methoden sind NICHT dokumentiert — Status muss bei Bedarf aktiv abgefragt werden.

Beispiele der Doku: (1) "Conditional Data Sync" (PHP): vor einem Sync `Network::status()` prüfen — bei `!connected` früh abbrechen, bei `isExpensive` (Cellular) nur essentielle Daten synchronisieren, sonst Voll-Sync. (2) "JavaScript Connection Check": vor Downloads prüfen — false bei getrennt oder teurer Cellular-Verbindung, sonst true.

Plattformverhalten: Android nutzt intern ConnectivityManager und NetworkCapabilities; die Berechtigung `ACCESS_NETWORK_STATE` wird benötigt und automatisch ins AndroidManifest eingetragen; `isConstrained` ist auf Android immer false. iOS nutzt NWPathMonitor aus dem Network-Framework; `isConstrained` spiegelt den Low-Data-Mode wider; keine speziellen Berechtigungen/Info.plist-Einträge nötig.

Voraussetzungen: iOS 18.2+, Android API 26+. Env-Variablen oder config-Dateien-Keys werden nicht dokumentiert. Für einen Implementierungsplan (Livewire/Flux): PHP-Facade serverseitig in Livewire-Actions nutzbar, z.B. um Sync-/Upload-Verhalten an Verbindungstyp anzupassen; für reaktive UI ohne Events muss man den Status selbst (z.B. per wire:poll oder JS-Abfrage) aktualisieren.

### Befehle

```bash
composer require nativephp/mobile-network
```

### APIs

- PHP-Facade: Native\Mobile\Facades\Network — einzige Methode: Network::status(), gibt Status-Objekt zurück
- Status-Objekt (PHP): $status->connected (bool), $status->type (string: 'wifi'|'cellular'|'ethernet'|'unknown'), $status->isExpensive (bool, metered z.B. Mobilfunk), $status->isConstrained (bool, iOS Low Data Mode, Android immer false)
- JS-API: import { Network } from '#nativephp'; const status = await Network.status(); — async/Promise, gleiche Felder (status.connected, status.type, status.isExpensive, status.isConstrained)
- Keine Events/Listener für Netzwerkänderungen dokumentiert; keine weiteren Methoden außer status()
- Native Implementierung Android: ConnectivityManager + NetworkCapabilities; iOS: NWPathMonitor (Network-Framework)

### Konfiguration

- AndroidManifest: Berechtigung ACCESS_NETWORK_STATE erforderlich — wird vom Plugin automatisch hinzugefügt
- iOS/Info.plist: keine speziellen Berechtigungen erforderlich
- Keine env-Variablen oder config-Datei-Keys dokumentiert

### Stolperfallen

- Mindestversionen: iOS 18.2+, Android API-Level 26+
- Lizenz: MIT; Plugin-Autor: Bifrost Technology; Plugin-Version: 1.0.1
- isConstrained ist iOS-only (Low Data Mode); auf Android liefert es immer false
- Nur Pull-API: Es gibt keine Netzwerkänderungs-Events — Statusänderungen müssen aktiv per status() abgefragt werden (für reaktive Livewire-UI z.B. wire:poll oder JS-seitige Abfrage nötig)
- JS-Aufruf ist asynchron (await Network.status()); PHP-Aufruf synchron über die Facade
- Empfohlenes Muster aus der Doku: vor Daten-Sync/Downloads connected prüfen und bei isExpensive (Cellular/metered) nur reduzierte Datenmengen übertragen
- Keine CLI-Befehle außer composer require; keine php artisan-Kommandos für dieses Plugin dokumentiert

---

## Share (Core Plugins) — NativePHP Mobile v3

<https://nativephp.com/docs/mobile/3/plugins/core/share>

Das Share-Plugin ist ein Core-Plugin von NativePHP Mobile v3 und stellt das native Share-Sheet des Betriebssystems bereit, um URLs, Texte und Dateien aus der App heraus zu teilen. Installation erfolgt als separates Composer-Paket (`nativephp/mobile-share`). Die API ist bewusst minimal und besteht aus genau zwei Methoden, die sowohl als PHP-Facade (`Native\Mobile\Facades\Share`) für Livewire/Blade als auch als JavaScript-Modul (`import { Share } from '#nativephp'`, Methoden dort awaitable/Promise-basiert) für Vue/React/Inertia verfügbar sind: `Share::url(string $title, string $text, string $url)` öffnet das Share-Sheet mit einer URL; `Share::file(string $title, string $text, string $filePath)` öffnet es mit einer Datei — wird ein leerer Dateipfad übergeben (bzw. der Parameter in JS weggelassen), wird nur der Text geteilt. Der MIME-/Dateityp wird automatisch anhand der Dateiendung erkannt; unterstützt werden Audio (m4a, aac, mp3, wav, ogg, flac), Video (mp4, m4v, mov, avi, mkv, webm), Bilder (jpg, jpeg, png, gif, webp) und Dokumente (pdf, txt). Plattformverhalten: Android nutzt intern `Intent.ACTION_SEND` mit einem `FileProvider` (für sicheren Dateizugriff anderer Apps), iOS nutzt `UIActivityViewController` inkl. iPad-Popover-Support. Es sind keine zusätzlichen Berechtigungen (AndroidManifest.xml/Info.plist), keine env-Variablen und keine config-Einträge dokumentiert; ebenso gibt es keine Events oder Callbacks (Fire-and-forget — kein dokumentiertes Ergebnis, ob/wohin der Nutzer geteilt hat). Plugin-Metadaten: Autor Bifrost Technology, Version 1.0.1, Lizenz MIT, Mindestanforderungen iOS 18.2 und Android API 26. Für die geplante Laravel-+-Livewire-+-Flux-App ist der PHP-Facade-Weg der natürliche Pfad: Share-Aufrufe direkt in Livewire-Actions (z. B. Meetup-Link oder Event-Details teilen), ohne weitere Setup-Schritte über `composer require` hinaus.

### Befehle

```bash
composer require nativephp/mobile-share
```

### APIs

- PHP-Facade: Native\Mobile\Facades\Share — Zugriff auf das native Share-Sheet aus Livewire/Blade
- Share::url(string $title, string $text, string $url) — öffnet das native Share-Sheet mit einer URL (Beispiel: Share::url('Check this out!', 'Found this great article', 'https://example.com');)
- Share::file(string $title, string $text, string $filePath) — öffnet das native Share-Sheet mit einer Datei; leerer $filePath ('') teilt nur Text (Beispiele: Share::file('My Recording', 'Listen to this!', '/path/to/audio.m4a'); Share::file('Hello', 'This is my message', '');)
- JS-API: import { Share } from '#nativephp' — gleiche Methoden, Promise-basiert: await Share.url('Check this out!', 'Found this great article', 'https://example.com'); und await Share.file('My Recording', 'Listen to this!', '/path/to/audio.m4a'); bzw. await Share.file('Hello', 'This is my message'); (filePath in JS optional)
- Keine Events/Callbacks dokumentiert (kein Erfolgs-/Abbruch-Feedback)
- Native Implementierung: Android Intent.ACTION_SEND + FileProvider; iOS UIActivityViewController mit iPad-Popover-Support

### Konfiguration

- Keine env-Variablen dokumentiert
- Keine config-Datei-Einträge dokumentiert
- Keine zusätzlichen Berechtigungen in AndroidManifest.xml oder Info.plist erforderlich/dokumentiert (Android nutzt intern FileProvider)

### Stolperfallen

- Separates Composer-Paket: trotz Einordnung unter 'Core Plugins' muss nativephp/mobile-share explizit installiert werden
- Mindestanforderungen: iOS 18.2 und Android 26 (API-Level) — Plugin-Version 1.0.1, Lizenz MIT, Autor Bifrost Technology
- Share::file mit leerem Dateipfad ('') teilt nur Text — in JS kann der filePath-Parameter ganz weggelassen werden
- Dateityp-Erkennung erfolgt automatisch über die Endung; dokumentiert unterstützte Typen: m4a, aac, mp3, wav, ogg, flac, mp4, m4v, mov, avi, mkv, webm, jpg, jpeg, png, gif, webp, pdf, txt — andere Endungen sind nicht dokumentiert
- Kein Rückgabewert/Event dokumentiert: die App erfährt nicht, ob der Nutzer das Share-Sheet abgebrochen oder eine Ziel-App gewählt hat
- Geteilte Dateien müssen unter einem lokalen Pfad auf dem Gerät liegen (z. B. /path/to/audio.m4a) — Remote-URLs gehören in Share::url, nicht Share::file
- Hinweis zur Quelle: Die Seite wurde via WebFetch (Markdown-Extraktion durch ein kleines Modell) erfasst; zwei unabhängige Abfragen lieferten identische Inhalte. Im Schwesterprojekt einundzwanzig-mobile-app ist NativePHP Mobile aktuell noch nicht installiert, daher keine Gegenprüfung am Vendor-Code möglich

---

## NativePHP Mobile v3 – Core Plugins: System (nativephp/mobile-system)

<https://nativephp.com/docs/mobile/3/plugins/core/system>

Das System-Plugin (Paket: nativephp/mobile-system) gehört zu den Core Plugins von NativePHP Mobile v3 und stellt System-Level-Operationen für mobile Apps bereit: Plattformerkennung (iOS/Android/Mobile), Öffnen des App-Einstellungsbildschirms des Geräts und Umschalten der Geräte-Taschenlampe (Flashlight). Installation erfolgt per Composer (composer require nativephp/mobile-system). Die PHP-Seite (relevant für Laravel + Livewire + Flux UI) läuft über die Facade Native\Mobile\Facades\System mit fünf Methoden: isIos(): bool, isAndroid(): bool, isMobile(): bool (true auf iOS ODER Android), appSettings(): void (öffnet den Einstellungsbildschirm der App im OS) und flashlight(): void (toggelt die Taschenlampe). Für JS-Frontends (Vue/React/Inertia) existiert ein importierbares System-Objekt aus '#nativephp' mit der async-Methode System.openAppSettings(). Typische Anwendungsfälle laut Doku: plattformbedingte UI-Darstellung (z. B. unterschiedliche Komponenten für iOS vs. Android), Nutzer zu den Berechtigungs-/Benachrichtigungseinstellungen leiten (etwa wenn Push-Permissions verweigert wurden). Plattformanforderungen: iOS >= 18.2, Android API-Level >= 26. Plugin-Metadaten: Autor Bifrost Technology, Version 1.0.2, Lizenz MIT, Support über nativephp.com/support. Die Seite dokumentiert KEINE Events, keine env-Variablen, keine config-Datei-Einträge und keine nativen Berechtigungen (AndroidManifest.xml/Info.plist) – das Plugin kommt ohne deklarierte Permissions aus. Für die Einundzwanzig-App (Livewire, kein Inertia) ist primär die PHP-Facade relevant; die JS-API ist optional für Inertia/SPA-Setups.

### Befehle

```bash
composer require nativephp/mobile-system
```

### APIs

- PHP-Facade: Native\Mobile\Facades\System (use Native\Mobile\Facades\System;)
- System::isIos(): bool — true, wenn die App auf iOS läuft
- System::isAndroid(): bool — true, wenn die App auf Android läuft
- System::isMobile(): bool — true, wenn die App auf iOS oder Android läuft
- System::appSettings(): void — öffnet den App-Einstellungsbildschirm des Geräts (z. B. für Berechtigungen/Benachrichtigungen)
- System::flashlight(): void — schaltet die Geräte-Taschenlampe um (Toggle)
- JavaScript (Vue/React/Inertia): import { System } from '#nativephp';
- JS: await System.openAppSettings() — async, öffnet die App-Einstellungen (einzige dokumentierte JS-Methode)
- Events: keine auf der Seite dokumentiert

### Konfiguration

- Keine env-Variablen dokumentiert
- Keine config-Datei-Einträge dokumentiert
- Keine nativen Berechtigungen erforderlich/dokumentiert (weder AndroidManifest.xml noch Info.plist)

### Stolperfallen

- Plattformanforderung: iOS 18.2 oder höher
- Plattformanforderung: Android API 26 oder höher
- Separates Composer-Paket — muss zusätzlich zu nativephp/mobile installiert werden (composer require nativephp/mobile-system)
- Lizenz: MIT; Autor: Bifrost Technology; Plugin-Version: 1.0.2; Support via nativephp.com/support
- JS-API ist deutlich schmaler als PHP-API: nur openAppSettings() dokumentiert; Plattformerkennung und Flashlight nur über die PHP-Facade
- flashlight() und appSettings() geben void zurück — kein Rückgabewert/Status, keine Events zum Erfolg
- Keine Troubleshooting-, Warn- oder Permissions-Abschnitte auf der Seite; das Plugin benötigt laut Doku keine Manifest-/Plist-Einträge
