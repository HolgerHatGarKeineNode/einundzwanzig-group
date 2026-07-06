# NativePHP Mobile v3 — Premium-Plugins (Lizenz nötig) — Biometrics, Geolocation, Scanner, SecureStorage, Firebase Push

> Quelle: Deep-Scan der offiziellen Doku (nativephp.com, Stand 2026-06-11). 5 Seiten.

---

## NativePHP Mobile v3 — Core Plugins: Biometrics

<https://nativephp.com/docs/mobile/3/plugins/core/biometrics>

Die Seite dokumentiert das offizielle Biometrics-Plugin für NativePHP Mobile v3 (Core-Plugin von Bifrost Technology, Version 1.0.2, proprietäre Lizenz). Es ermöglicht biometrische Authentifizierung in NativePHP-Mobile-Apps: auf iOS Face ID und Touch ID, auf Android Fingerprint, Face Unlock und weitere biometrische Methoden; als Fallback dient die System-Authentifizierung des Geräts (PIN, Passwort, Muster).

Installation: Das Plugin wird über das private NativePHP-Plugin-Composer-Repository (https://plugins.nativephp.com) installiert. Dazu wird das Repository per `composer config` registriert, HTTP-Basic-Auth mit der Lizenz-E-Mail und dem Lizenzschlüssel hinterlegt (Zugangsdaten im NativePHP-Dashboard unter "Purchased Plugins") und anschließend `composer require nativephp/mobile-biometrics` ausgeführt.

PHP-API (relevant für Laravel/Livewire/Flux): Die Facade `Native\Mobile\Facades\Biometrics` mit `Biometrics::prompt()` öffnet den nativen Biometrie-Dialog. Das Ergebnis kommt asynchron als Event: `Native\Mobile\Events\Biometric\Completed` feuert bei Abschluss (Erfolg oder Fehlschlag) und liefert einen booleschen Parameter `$success`. In Livewire-Komponenten wird das Event mit dem Attribut `#[OnNative(Completed::class)]` (aus `Native\Mobile\Attributes\OnNative`) auf eine Handler-Methode `public function handle(bool $success)` gemappt; dort verzweigt man auf Erfolgs-/Fehlerlogik (z. B. Feature freischalten vs. Fehlermeldung anzeigen).

JavaScript-API (für Vue/React/Inertia, auf Livewire-Stack optional): Import via `import { Biometric, On, Off, Events } from '#nativephp'`. `await Biometric.prompt()` startet die Authentifizierung; optional `await Biometric.prompt().id('secure-action-auth')` zur Nachverfolgung mit einem Identifier. Event-Abonnement per `On(Events.Biometric.Completed, callback)` und Abmeldung per `Off(...)` (Vue: onMounted/onUnmounted; React: useEffect mit Cleanup-Return). Das Event-Payload-Objekt enthält `payload.success` (boolean).

Konfiguration: Die Seite dokumentiert KEINE env-Variablen, keine config-Datei-Einträge, keine Artisan-Befehle und keine nativen Berechtigungseinträge (kein Info.plist-/AndroidManifest-Hinweis wie NSFaceIDUsageDescription oder USE_BIOMETRIC) — einzige Konfiguration ist die Composer-Repo-/Auth-Einrichtung.

Anforderungen/Lizenz: iOS 18.2+, Android API 26+, NativePHP Mobile ^3.0. Preis 49 $ einmalig (standalone, im Starter-Kit-Bundle) oder im NativePHP-Ultra-Abo (ab 35 $/Monat) enthalten. Support per E-Mail (Adresse auf der Seite durch Cloudflare-E-Mail-Schutz maskiert).

Sicherheitshinweise: Biometrische Authentifizierung bietet laut Doku "convenience, not absolute security". Empfohlen werden Kombination mit weiteren Authentifizierungsfaktoren, Session-Timeouts und das Bewusstsein, dass kompromittierte Geräte die Biometrie umgehen können. Eine API zum Prüfen der Hardware-Verfügbarkeit (z. B. "ist Biometrie vorhanden?") wird auf dieser Seite nicht dokumentiert.

Implikation für den Implementierungsplan (Laravel + Livewire + Flux UI): Trigger-Button in Flux-UI ruft eine Livewire-Action auf, die `Biometrics::prompt()` ausführt; die Livewire-Komponente erhält das Ergebnis über `#[OnNative(Completed::class)]` mit `bool $success` und schaltet serverseitig den geschützten Zustand frei. Da das Plugin nur Convenience-Sicherheit bietet, sollte die eigentliche Autorisierung (Session/Token) serverseitig bleiben.

### Befehle

```bash
composer config repositories.nativephp-plugins composer https://plugins.nativephp.com
composer config http-basic.plugins.nativephp.com <lizenz-email> your-license-key
composer require nativephp/mobile-biometrics
```

### APIs

- Native\Mobile\Facades\Biometrics — PHP-Facade; Biometrics::prompt() öffnet den nativen Biometrie-Dialog (asynchron, Ergebnis via Event)
- Native\Mobile\Events\Biometric\Completed — Event, feuert bei Abschluss der Authentifizierung (Erfolg ODER Fehlschlag) mit bool $success
- Native\Mobile\Attributes\OnNative — PHP-Attribut für Livewire: #[OnNative(Completed::class)] public function handle(bool $success) { if ($success) { $this->unlockSecureFeature(); } else { $this->showErrorMessage(); } }
- JS: import { Biometric, On, Off, Events } from '#nativephp'
- JS: await Biometric.prompt() — startet biometrische Authentifizierung (awaitable; Rückgabewert nicht dokumentiert)
- JS: await Biometric.prompt().id('secure-action-auth') — optionaler Identifier zum Tracking des Auth-Vorgangs
- JS: On(Events.Biometric.Completed, callback) / Off(Events.Biometric.Completed, callback) — Event-Listener registrieren/entfernen; Callback erhält payload mit payload.success (boolean)
- Vue-Muster: On(...) in onMounted(), Off(...) in onUnmounted(); React-Muster: On(...) in useEffect() mit Off(...) im Cleanup-Return

### Konfiguration

- Keine env-Variablen und keine config-Datei-Einträge auf der Seite dokumentiert
- Keine nativen Berechtigungen dokumentiert (kein Info.plist-Eintrag wie NSFaceIDUsageDescription, kein AndroidManifest-Eintrag wie USE_BIOMETRIC)
- Einzige Einrichtung: privates Composer-Repository https://plugins.nativephp.com plus http-basic-Auth (Lizenz-E-Mail + Lizenzschlüssel); Zugangsdaten im NativePHP-Dashboard unter 'Purchased Plugins'

### Stolperfallen

- Kostenpflichtiges Plugin: 49 $ einmalig (standalone/Starter-Kit-Bundle) oder in NativePHP Ultra (ab 35 $/Monat) enthalten; Lizenz: Proprietary; Autor: Bifrost Technology; Version 1.0.2
- Mindestanforderungen: iOS 18.2, Android API-Level 26, NativePHP Mobile ^3.0
- Ergebnis kommt NICHT als Rückgabewert von Biometrics::prompt(), sondern asynchron über das Completed-Event — Livewire-Handler mit #[OnNative] erforderlich
- Completed-Event feuert sowohl bei Erfolg als auch bei Fehlschlag; immer beide Pfade über bool $success behandeln
- Fallback: Wenn Biometrie nicht verfügbar/fehlgeschlagen, greift die System-Authentifizierung des Geräts (PIN, Passwort, Muster)
- Sicherheitshinweis der Doku: Biometrie ist 'convenience, not absolute security' — mit zusätzlichen Auth-Faktoren kombinieren, Session-Timeouts implementieren, Bypass-Risiko auf kompromittierten Geräten einkalkulieren
- Keine API zum Prüfen der Hardware-Verfügbarkeit auf dieser Seite dokumentiert
- Keine Artisan-Befehle für dieses Plugin dokumentiert
- Im composer-config-Befehl ist die exakte E-Mail-Platzhalter-Schreibweise auf der Webseite durch Cloudflare-E-Mail-Schutz maskiert; einzusetzen ist die eigene Lizenz-E-Mail plus Lizenzschlüssel
- Support-Kontakt per E-Mail (Adresse auf der Seite ebenfalls maskiert; über NativePHP-Dashboard auffindbar)

---

## Firebase (Push Notifications) — NativePHP Mobile v3, Core Plugins

<https://nativephp.com/docs/mobile/3/plugins/core/firebase>

Das Premium-Plugin nativephp/mobile-firebase bringt Push-Notifications in NativePHP-Mobile-Apps: via Firebase Cloud Messaging (FCM) auf Android und Apple Push Notification service (APNs) auf iOS. Installation: Composer mit dem privaten NativePHP-Plugin-Repository (plugins.nativephp.com) und Lizenzschlüssel (http-basic-Credentials aus dem Dashboard, Sektion "Purchased Plugins") konfigurieren, dann `composer require nativephp/mobile-firebase`. Firebase-Setup: Projekt in der Firebase Console anlegen; für Android die App mit Package-Name registrieren und `google-services.json` ins Projekt-Root legen (der Plugin-Compiler kopiert sie automatisch in den Android-Build); für iOS die App im selben Firebase-Projekt anlegen, `GoogleService-Info.plist` ins Projekt-Root legen, Push-Notifications-Capability im Apple-Developer-Account aktivieren und den APNs-Key in der Firebase Console hochladen (Xcode-Konfiguration erfolgt automatisch). Serverseitig wird ein Service-Account-JSON (Firebase Console → Project Settings → Service Accounts → Generate new private key) über die env-Variable FIREBASE_CREDENTIALS referenziert. — PHP-API über die Facade Native\Mobile\Facades\PushNotifications: checkPermission() (liefert Status "granted"/"denied"/"not_determined"/"provisional"/"ephemeral" ohne Prompt; empfohlener Flow: bei "not_determined" erst UI-Erklärung zeigen, dann enroll()), enroll() (Permission anfragen + registrieren), getToken() (gecachten FCM/APNs-Token holen). JS-API via `import { PushNotifications, On, Off, Events } from '#nativephp'` mit denselben Methoden plus clearBadge(); Rückgaben sind Objekte ({status}, {token}). Event-Listener via On/Off mit Events.PushNotification.TokenGenerated bzw. PushNotificationReceived (Vue: onMounted/onUnmounted, React: useEffect-Beispiele dokumentiert). — Events in PHP: Native\Mobile\Events\PushNotification\TokenGenerated (Payload: token) wird nach Enrollment gefeuert und per Livewire-Attribut #[OnNative(TokenGenerated::class)] in gemounteten Komponenten verarbeitet (z. B. Token am User speichern); Native\Mobile\Events\PushNotification\PushNotificationReceived für Data-only-Messages — ein klassischer Event::listen()-Listener (z. B. im ServiceProvider) läuft in einer ephemeren PHP-Runtime sogar bei App im Hintergrund (background-safe), während #[OnNative] nur im Foreground bei gemounteter Komponente greift. — Verhalten: Reguläre Notifications (mit "notification"-Block im Payload) zeigt das OS selbst an, es wird KEIN PHP-Event ausgelöst; Data-only-Messages mit "event"-Key (FQCN einer Laravel-Event-Klasse) plus optionalem "payload" (JSON-String) starten die ephemere PHP-Runtime und dispatchen das Event; ohne "event"-Key kein PHP-Event. Deep Linking: "url"- oder "link"-Key im data-Payload navigiert die App beim Antippen zur URL, auch aus Cold Start. Badges: --badge=N beim Senden setzt den Zähler; PushNotifications.clearBadge() setzt auf iOS den Badge auf 0 und entfernt auf Android alle angezeigten Notifications. — Senden vom Laravel-Server: direkter HTTP-POST an die FCM-v1-API (https://fcm.googleapis.com/v1/projects/{projectId}/messages:send) mit Service-Account-Access-Token (Http::withToken), Payload message.token/notification{title,body}/data{url,...}. Zum Testen liefert das Plugin den Artisan-Befehl `fcm:send {token}` mit Flags --title, --body, --url, --data-only, --d key=value (mehrfach, auch event=FQCN und payload=JSON), --badge=N. — Permissions: iOS via UNUserNotificationCenter-Systemdialog (5 Status-Werte); Android zeigt den Systemdialog erst ab API 33 (POST_NOTIFICATIONS), darunter automatisch erteilt. Plattform-Minimum: iOS 18.2+, Android API 26+. Koexistenz mit nativephp/mobile-local-notifications ist gegeben (auf iOS verketten die Plugins ihre Delegates automatisch). Preis: 99 USD einmalig, in NativePHP Ultra (ab 35 USD/Monat) enthalten, im Starter-Kit-Bundle (199 USD, 33 % Ersparnis) gebündelt; proprietäre Lizenz. Nicht auf der Seite dokumentiert: Troubleshooting, Notification Channels, Sound/Vibration, iOS-Entitlement-Details, manuelle AndroidManifest-Änderungen, Rebuild-Schritte nach Installation (kein expliziter Hinweis auf native:install/native:run).

### Befehle

```bash
composer config repositories.nativephp-plugins composer https://plugins.nativephp.com
composer config http-basic.plugins.nativephp.com <deine-email> <dein-license-key>
composer require nativephp/mobile-firebase
php artisan fcm:send {token} --title="Hello" --body="World"
php artisan fcm:send {token} --title="New Order" --body="Order #123" --url="/orders/123"
php artisan fcm:send {token} --data-only --d event=App\\Events\\SyncNeeded --d payload='{"sync_id":42}'
php artisan fcm:send {token} --title="Messages" --body="3 unread" --badge=3
php artisan fcm:send {token} --title="Update" --d type=order --d order_id=55
```

### APIs

- PHP-Facade Native\Mobile\Facades\PushNotifications — zentrale API des Plugins
- PushNotifications::checkPermission(): string — Status ohne Prompt: "granted" | "denied" | "not_determined" | "provisional" | "ephemeral"
- PushNotifications::enroll(): void — fragt Permission an und registriert das Gerät bei FCM/APNs
- PushNotifications::getToken(): string — liefert den gecachten FCM/APNs-Device-Token
- Event Native\Mobile\Events\PushNotification\TokenGenerated — feuert, sobald nach Enrollment ein Token verfügbar ist; Payload: token (string)
- Event Native\Mobile\Events\PushNotification\PushNotificationReceived — wird bei Data-only-Messages mit "event"-Key dispatcht; Listener via Event::listen() laufen in ephemerer PHP-Runtime auch im Hintergrund (background-safe)
- Livewire-Attribut Native\Mobile\Attributes\OnNative — z. B. #[OnNative(TokenGenerated::class)] public function handleToken(string $token) — funktioniert nur im Foreground bei gemounteter Komponente
- Background-Listener-Muster (ServiceProvider): Event::listen(function (PushNotificationReceived $event) { ... })
- JS-Import: import { PushNotifications, On, Off, Events } from '#nativephp'
- JS: const { status } = await PushNotifications.checkPermission()
- JS: await PushNotifications.enroll()
- JS: const { token } = await PushNotifications.getToken()
- JS: await PushNotifications.clearBadge() — iOS: Badge auf 0; Android: entfernt alle angezeigten Notifications
- JS-Event-Konstanten: Events.PushNotification.TokenGenerated und Events.PushNotification.PushNotificationReceived; Listener via On(event, handler) / Off(event, handler) (Vue-onMounted/onUnmounted- und React-useEffect-Beispiele dokumentiert)
- Server-Versand: HTTP-POST an https://fcm.googleapis.com/v1/projects/{projectId}/messages:send via Illuminate\Support\Facades\Http::withToken($accessToken) — Payload: message.token, message.notification{title,body}, message.data{url|link, event, payload, ...}
- Data-only-Event-Payload: data.event = FQCN der Laravel-Event-Klasse, data.payload = JSON-String; ohne "event"-Key wird kein PHP-Event ausgelöst
- Deep Linking: "url"- oder "link"-Key im data-Payload navigiert beim Tap zur URL (auch aus Cold Start)

### Konfiguration

- FIREBASE_CREDENTIALS=/path/to/service-account.json (env; Service-Account-JSON aus Firebase Console → Project Settings → Service Accounts → "Generate new private key")
- google-services.json im Projekt-Root (Android; wird vom Plugin-Compiler automatisch in den Android-Build kopiert)
- GoogleService-Info.plist im Projekt-Root (iOS; Xcode-Konfiguration erfolgt automatisch)
- Composer: privates Repository plugins.nativephp.com + http-basic-Credentials (E-Mail + License-Key aus dem NativePHP-Dashboard, "Purchased Plugins")
- iOS: Push-Notifications-Capability im Apple-Developer-Account aktivieren und APNs-Key in der Firebase Console hochladen
- Android: Notification-Permission-Systemdialog erst ab API 33 (POST_NOTIFICATIONS); unter API 33 automatisch erteilt
- iOS: Permission-Dialog via UNUserNotificationCenter; Statuswerte granted/denied/not_determined/provisional/ephemeral

### Stolperfallen

- Premium-Plugin: 99 USD Einmalkauf (proprietäre Lizenz); in der NativePHP-Ultra-Subscription (ab 35 USD/Monat) enthalten, im Starter-Kit-Bundle (199 USD, 33 % Ersparnis) gebündelt — ohne Lizenz/Composer-Credentials keine Installation
- Plattform-Minimum: iOS 18.2+ und Android API 26+
- Reguläre Notifications (mit "notification"-Block) zeigt das OS selbst an — dabei wird KEIN PHP-Event ausgelöst; für serverseitige Verarbeitung Data-only-Messages mit "event"-Key (FQCN) verwenden
- #[OnNative]-Handler funktionieren nur im Foreground bei gemounteter Livewire-Komponente; für Hintergrund-Verarbeitung klassisches Event::listen() im ServiceProvider nutzen (läuft in ephemerer PHP-Runtime)
- Empfohlener Permission-Flow: erst checkPermission(); nur bei "not_determined" eine erklärende UI zeigen und dann enroll() aufrufen (bei "denied" bringt enroll() nichts)
- APNs (iOS-Push) erfordert praktisch ein physisches Gerät; Apple-Developer-Account mit Push-Capability und APNs-Key-Upload in Firebase nötig
- Android- und iOS-App müssen im SELBEN Firebase-Projekt registriert sein; google-services.json und GoogleService-Info.plist gehören ins Projekt-Root, der Rest passiert automatisch beim Build
- Koexistenz mit nativephp/mobile-local-notifications ist unterstützt — auf iOS verketten die Plugins ihre Notification-Delegates automatisch
- Nicht auf der Seite dokumentiert (für Implementierungsplan ggf. separat klären): Troubleshooting, Notification Channels, Sound/Vibration, iOS-Entitlement-Details, manuelle AndroidManifest-Änderungen, ob nach Plugin-Installation ein Rebuild (native:install/native:run) nötig ist
- clearBadge() verhält sich plattformspezifisch: iOS setzt nur den Badge-Zähler auf 0, Android entfernt alle angezeigten Notifications
- fcm:send ist ein Test-/Debug-Befehl; produktiver Versand erfolgt per HTTP gegen die FCM-v1-API mit Service-Account-Access-Token (FIREBASE_CREDENTIALS)

---

## NativePHP Mobile v3 — Core Plugins: Geolocation

<https://nativephp.com/docs/mobile/3/plugins/core/geolocation>

Das Geolocation-Plugin ist ein kostenpflichtiges First-Party-("Core"-)Plugin für NativePHP Mobile v3 (Autor: Bifrost Technology, Version 1.0.3, proprietäre Lizenz, 49 USD Einmalkauf; in der NativePHP-Ultra-Subscription ab 35 USD/Monat bzw. im Starter-Kit-Bundle für 199 USD enthalten). Installation per Composer aus dem privaten Plugin-Repository plugins.nativephp.com, das per `composer config repositories...` plus HTTP-Basic-Auth mit E-Mail und Lizenzschlüssel eingerichtet wird. Plattformanforderungen: NativePHP Mobile ^3.0, iOS 18.2+, Android API 26+.

PHP-Seite (Livewire/Blade): Facade `Native\Mobile\Facades\Geolocation` mit `getCurrentPosition()` (Netzwerk-Positionierung: schneller, ungenauer), `getCurrentPosition(true)` (GPS: langsamer, genauer), `checkPermissions()` und `requestPermissions()`. Alle Aufrufe sind asynchron/eventbasiert: Ergebnisse kommen als Native-Events zurück, die in Livewire-Komponenten per Attribut `#[OnNative(LocationReceived::class)]` (aus `Native\Mobile\Attributes\OnNative`) empfangen werden. Das Event `Native\Mobile\Events\Geolocation\LocationReceived` liefert: bool $success, float $latitude, float $longitude, float $accuracy (Meter), int $timestamp (Unix), string $provider (z. B. gps/network), string $error (Fehlermeldung bei Misserfolg). Weitere Events: `PermissionStatusReceived` (Statuswerte 'granted', 'denied', 'not_determined') und `PermissionRequestResult` (zusätzlich Sonderwert 'permanently_denied' — Nutzer muss dann in die System-Einstellungen).

JS-Seite (Vue/React/Inertia): Import `{ Geolocation, On, Off, Events } from '#nativephp'`; `await Geolocation.getCurrentPosition()` mit Fluent-Optionen `.fineAccuracy(true)` (GPS) und `.id('current-loc')` (Identifier zum Tracking mehrerer Requests); `Geolocation.checkPermissions()` / `requestPermissions()`. Event-Listener via `On(Events.Geolocation.LocationReceived, handler)` und `Off(...)` (z. B. in Vue onMounted/onUnmounted); Payload-Objekt mit success/latitude/longitude/accuracy/error.

Best-Practice-Hinweise der Seite: Berechtigung erst anfragen, wenn das Feature wirklich gebraucht wird, und dem Nutzer vorher den Grund erklären (Privacy); GPS verbraucht mehr Akku als Netzwerk-Ortung und funktioniert in Gebäuden schlecht — Positionen ggf. cachen. Für eine Livewire+Flux-App heißt das: Button → `Geolocation::getCurrentPosition(true)` → Komponentenmethode mit `#[OnNative(LocationReceived::class)]` verarbeitet das Ergebnis. NICHT auf der Seite dokumentiert: native Manifest-/Info.plist-Einträge (offenbar vom Plugin/Build übernommen), Artisan-Befehle, Rückgabetypen der Facade-Methoden, Hintergrund-Ortung oder kontinuierliches Tracking (watchPosition).

### Befehle

```bash
composer require nativephp/mobile-geolocation
composer config repositories.nativephp-plugins composer https://plugins.nativephp.com
composer config http-basic.plugins.nativephp.com <deine-email> <your-license-key>
```

### APIs

- Native\Mobile\Facades\Geolocation — PHP-Facade des Plugins
- Geolocation::getCurrentPosition() — einmalige Position via Netzwerk-Ortung (schneller, ungenauer)
- Geolocation::getCurrentPosition(true) — einmalige Position via GPS (langsamer, genauer, mehr Akku)
- Geolocation::checkPermissions() — aktuellen Berechtigungsstatus abfragen (Ergebnis als Event)
- Geolocation::requestPermissions() — Standort-Berechtigung anfordern (Ergebnis als Event)
- Native\Mobile\Attributes\OnNative — Attribut, um Native-Events in Livewire-Methoden zu empfangen: #[OnNative(LocationReceived::class)]
- Native\Mobile\Events\Geolocation\LocationReceived — Event mit Payload: bool $success, float $latitude, float $longitude, float $accuracy (Meter), int $timestamp (Unix), string $provider (gps/network/…), string $error
- Native\Mobile\Events\Geolocation\PermissionStatusReceived — Event nach checkPermissions(); Werte: 'granted' | 'denied' | 'not_determined'
- Native\Mobile\Events\Geolocation\PermissionRequestResult — Event nach requestPermissions(); Sonderwert: 'permanently_denied'
- JS: import { Geolocation, On, Off, Events } from '#nativephp'
- JS: await Geolocation.getCurrentPosition() — Netzwerk-Ortung
- JS: await Geolocation.getCurrentPosition().fineAccuracy(true) — GPS/hohe Genauigkeit (Fluent-API)
- JS: .id('current-loc') — Identifier zum Zuordnen/Tracken eines Requests
- JS: await Geolocation.checkPermissions() / await Geolocation.requestPermissions()
- JS: On(Events.Geolocation.LocationReceived, handler) / Off(Events.Geolocation.LocationReceived, handler) — Event-Listener registrieren/entfernen (z. B. Vue onMounted/onUnmounted); Handler-Payload: { success, latitude, longitude, accuracy, timestamp, provider, error }

### Konfiguration

- Composer-Repository: repositories.nativephp-plugins → https://plugins.nativephp.com (privates Plugin-Repo)
- Composer http-basic Auth für plugins.nativephp.com: E-Mail + Lizenzschlüssel (your-license-key)
- AndroidManifest.xml-Permissions (ACCESS_FINE_LOCATION/ACCESS_COARSE_LOCATION): auf der Seite NICHT dokumentiert — vermutlich automatisch durch das Plugin injiziert
- iOS Info.plist-Keys (z. B. NSLocationWhenInUseUsageDescription): auf der Seite NICHT dokumentiert
- Keine env-Variablen oder config/nativephp.php-Keys auf der Seite dokumentiert

### Stolperfallen

- Kostenpflichtiges Plugin: 49 USD Einmalkauf, proprietäre Lizenz; in NativePHP Ultra (ab 35 USD/Monat) enthalten, alternativ Starter-Kit-Bundle 199 USD (33 % Ersparnis); Lizenzschlüssel für Composer-Auth nötig
- Mindestanforderungen: NativePHP Mobile ^3.0, iOS 18.2+, Android API 26+
- API ist asynchron/eventbasiert: getCurrentPosition()/checkPermissions()/requestPermissions() liefern keine direkten Rückgabewerte in PHP — Ergebnisse kommen über Events (LocationReceived, PermissionStatusReceived, PermissionRequestResult), in Livewire via #[OnNative(...)] empfangen
- Alle Event-Parameter im PHP-Handler defensiv mit Default null deklarieren und zuerst $success prüfen; bei Fehler steht die Ursache in $error
- 'permanently_denied' (PermissionRequestResult): erneute Anfrage zwecklos — Nutzer muss die Berechtigung manuell in den System-Einstellungen aktivieren; UI-Fallback einplanen
- Privacy-Best-Practice: Berechtigung erst beim tatsächlichen Bedarf anfragen und den Grund vorher erklären (App-Store-Review-relevant)
- Performance: GPS (fineAccuracy/true) verbraucht deutlich mehr Akku als Netzwerk-Ortung und funktioniert in Innenräumen schlecht; Positionen cachen statt wiederholt abfragen
- Kein watchPosition / kontinuierliches Tracking / Hintergrund-Ortung auf der Seite dokumentiert — nur einmalige Positionsabfrage
- Native Berechtigungs-Deklarationen (Manifest/Info.plist) und zusätzliche Artisan-Setup-Befehle sind auf der Seite nicht dokumentiert; vor Implementierung im Plugin-README bzw. der allgemeinen NativePHP-Mobile-Doku verifizieren
- Rückgabetypen der Facade-Methoden sind in der Doku nicht spezifiziert

---

## NativePHP Mobile v3 – Core Plugins: Scanner (nativephp/mobile-scanner)

<https://nativephp.com/docs/mobile/3/plugins/core/scanner>

Das Plugin `nativephp/mobile-scanner` ist ein QR-Code-/Barcode-Scanner für NativePHP-Mobile-Apps (v3) mit Unterstützung mehrerer Barcode-Formate und kontinuierlichem Scannen. Es ist ein kostenpflichtiges Premium-Plugin ($49 einmalig, Version 1.0.2, Autor: Bifrost Technology, Lizenz: proprietary; enthalten im Starter Kit für $199 bzw. im Ultra-Abo ab $35/Monat). Installation: Zunächst das NativePHP-Plugin-Repository per `composer config repositories.nativephp-plugins composer https://plugins.nativephp.com` registrieren und mit `composer config http-basic.plugins.nativephp.com [email] your-license-key` authentifizieren (Zugangsdaten im NativePHP-Dashboard unter "Purchased Plugins"), dann `composer require nativephp/mobile-scanner`. PHP-Nutzung (Livewire): Facade `Native\Mobile\Facades\Scanner` mit `Scanner::scan()`; das Scan-Ergebnis kommt asynchron als Event `Native\Mobile\Events\Scanner\CodeScanned` und wird in Livewire-Komponenten per Attribut `#[OnNative(CodeScanned::class)]` in einer Handler-Methode `handleScan($data, $format, $id = null)` empfangen (Event-Payload: string $data = dekodierte Barcode-Daten, string $format = Barcode-Format, string|null $id = optionale Session-ID zur Unterscheidung mehrerer Scanner, z. B. `if ($id === 'product-scanner') { $this->addProduct($data); }`). Die `scan()`-Methode ist fluent/verkettbar mit Konfigurationsmethoden: `prompt(string)` (eigener Text auf dem Scanner-Bildschirm), `continuous(bool)` (Scanner bleibt für mehrere Scans offen, Default false), `formats(array)` (unterstützte Formate: 'qr', 'ean13', 'ean8', 'code128', 'code39', 'upca', 'upce', 'all'; Default ['qr']), `id(string)` (eindeutige Scan-Session-ID). Beispiel: `Scanner::scan()->prompt('Scan your ticket')->continuous(true)->formats(['qr','ean13'])->id('ticket-scanner');`. JavaScript/Vue/React-Nutzung: `import { Scanner, On, Off, Events } from '#nativephp';` dann `await Scanner.scan();` und Event-Listener via `On(Events.Scanner.CodeScanned, handleScan)` mit Payload-Objekt `{ data, format, id }` (Abmelden mit `Off`). Plattform-Implementierung: Android nutzt ML Kit Barcode Scanning (API 21+), iOS nutzt AVFoundation (iOS 13.0+); im Plugin-Details-Block werden zusätzlich "iOS 18.2, Android 26" als NativePHP-Mobile-Anforderung genannt (vermutlich Build-/SDK-Targets). Berechtigungen: Die `scanner`-Permission muss in `config/nativephp.php` aktiviert werden ("You must enable the `scanner` permission in `config/nativephp.php`"); die Kamera-Berechtigung (AndroidManifest/Info.plist) wird dann automatisch verwaltet, der Nutzer wird beim ersten Scan zur Freigabe aufgefordert. Eigene Artisan-Befehle oder env-Variablen definiert das Plugin laut Doku-Seite nicht. Support: support@bifrost.technology (E-Mail auf der Seite verschleiert).

### Befehle

```bash
composer config repositories.nativephp-plugins composer https://plugins.nativephp.com
composer config http-basic.plugins.nativephp.com [email] your-license-key
composer require nativephp/mobile-scanner
```

### APIs

- PHP-Facade: Native\Mobile\Facades\Scanner — Einstieg über Scanner::scan(), öffnet die native Scanner-UI
- Fluent-Konfiguration auf scan(): ->prompt(string $text) — eigener Hinweistext auf dem Scanner-Bildschirm (kein Default)
- Fluent-Konfiguration: ->continuous(bool) — Scanner bleibt für mehrere Scans offen; Default: false
- Fluent-Konfiguration: ->formats(array) — Barcode-Formate: 'qr', 'ean13', 'ean8', 'code128', 'code39', 'upca', 'upce', 'all'; Default: ['qr']
- Fluent-Konfiguration: ->id(string) — eindeutige Scan-Session-ID, um mehrere Scanner im Event-Handler zu unterscheiden
- Beispiel: Scanner::scan()->prompt('Scan your ticket')->continuous(true)->formats(['qr', 'ean13'])->id('ticket-scanner');
- Event-Klasse: Native\Mobile\Events\Scanner\CodeScanned — Payload: string $data (dekodierte Barcode-Daten), string $format (Barcode-Format), string|null $id (optionale Session-ID)
- Livewire-Empfang per Attribut: #[OnNative(CodeScanned::class)] public function handleScan($data, $format, $id = null) — Attribut-Namespace: Native\Mobile\Attributes\OnNative
- JavaScript-API: import { Scanner, On, Off, Events } from '#nativephp'; — await Scanner.scan(); startet den Scanner
- JavaScript-Event: On(Events.Scanner.CodeScanned, handler) — Handler erhält Payload-Objekt { data, format, id }; Abmelden via Off(...)

### Konfiguration

- config/nativephp.php: Die 'scanner'-Permission muss aktiviert werden ("You must enable the `scanner` permission in `config/nativephp.php`"); der exakte Array-Key wird auf der Seite nicht gezeigt
- Kamera-Berechtigungen (AndroidManifest.xml / Info.plist, z. B. NSCameraUsageDescription) werden vom Plugin automatisch verwaltet — keine manuellen Manifest-/Plist-Einträge dokumentiert; der Nutzer wird beim ersten Start/Scan um Erlaubnis gefragt
- Composer-Auth: http-basic.plugins.nativephp.com mit E-Mail + Lizenzschlüssel (zu finden im NativePHP-Dashboard unter 'Purchased Plugins')
- Keine env-Variablen (NATIVEPHP_*) für dieses Plugin dokumentiert

### Stolperfallen

- Premium-Plugin: kostenpflichtig — $49 Einmalzahlung; alternativ im Starter Kit ($199, 33% Rabatt) oder Ultra-Plan ($35+/Monat) enthalten; Lizenz: proprietary
- Installation erfordert Authentifizierung am privaten Composer-Repository https://plugins.nativephp.com (E-Mail + Lizenzschlüssel); ohne gültige Lizenz schlägt composer require fehl
- Die scanner-Permission MUSS in config/nativephp.php aktiviert sein, sonst funktioniert der Scanner nicht; die Doku zeigt den exakten Config-Key nicht — beim Implementieren in der lokalen config/nativephp.php nachschauen
- Plattform-Minimum laut Platform-Support: Android API 21+ (ML Kit Barcode Scanning), iOS 13.0+ (AVFoundation); der Plugin-Details-Block nennt zusätzlich 'iOS 18.2, Android 26' als NativePHP-Mobile-Anforderung (vermutlich SDK-/Build-Targets) — Diskrepanz bei der Planung beachten
- Scan-Ergebnis kommt asynchron als Event (CodeScanned), nicht als Rückgabewert von scan() — in Livewire zwingend #[OnNative(CodeScanned::class)]-Handler vorsehen
- Default scannt nur QR-Codes (formats Default ['qr']) — für EAN/Code128 etc. explizit formats([...]) oder ['all'] setzen
- Bei mehreren Scannern in der App die id()-Session-ID nutzen, um Events im Handler korrekt zuzuordnen
- continuous(true) hält den Scanner für mehrere Scans offen — UI-Flow (Schließen/Abbrechen) einplanen
- Plugin-Version 1.0.2, Autor Bifrost Technology, Support: support@bifrost.technology; keine eigenen Artisan-Befehle oder env-Variablen dokumentiert

---

## SecureStorage (NativePHP Mobile v3 – Core Plugins)

<https://nativephp.com/docs/mobile/3/plugins/core/secure-storage>

Das SecureStorage-Plugin (nativephp/mobile-secure-storage, Version 1.0.1) bietet verschlüsselten Speicher für sensible Daten wie Tokens, Credentials und User-Secrets. Es nutzt nativ die iOS Keychain Services bzw. Android EncryptedSharedPreferences. Installation erfolgt über das private NativePHP-Plugin-Composer-Repository (https://plugins.nativephp.com) mit http-basic-Authentifizierung (E-Mail + Lizenzschlüssel, erhältlich nach Login auf nativephp.com bzw. im "Purchased Plugins"-Dashboard), danach `composer require nativephp/mobile-secure-storage`. Die API ist bewusst minimal und besteht aus drei Methoden: set(string $key, ?string $value) speichert einen Wert (null als Wert löscht den Eintrag) und liefert { success: true }; get(string $key) liefert { value: string } (leerer String, wenn der Key nicht existiert); delete(string $key) löscht den Eintrag und liefert { success: true }. In PHP wird die Facade Native\Mobile\Facades\SecureStorage verwendet (z. B. SecureStorage::set('auth_token', '...'); $token = SecureStorage::get('auth_token'); SecureStorage::delete('auth_token');) — ideal für Livewire/Blade. Für JS-Frontends (Vue/React/Inertia) gibt es ein async JS-API via `import { SecureStorage } from '#nativephp'` mit await SecureStorage.set/get/delete; get liefert dort ein Objekt mit .value. Sicherheitsimplementierung: Android verwendet EncryptedSharedPreferences mit AES-256-GCM und Schlüsseln im Android Keystore (hardware-backed auf unterstützten Geräten); iOS verwendet Keychain Services mit Schutzklasse kSecAttrAccessibleWhenUnlockedThisDeviceOnly (device-only, hardware-backed auf Geräten mit Secure Enclave). Es sind keine zusätzlichen nativen Berechtigungen (AndroidManifest.xml/Info.plist) und keine config-/env-Einträge dokumentiert; ebenso keine Events. Mindestanforderungen: iOS 18.2+, Android API 26+. Lizenz: proprietär, 49 USD Einmalkauf, alternativ im Ultra-Abo (alle First-Party-Plugins, ab 35 USD/Monat) enthalten. Für die geplante Laravel-+-Livewire-+-Flux-App ist die PHP-Facade der relevante Weg, z. B. zum sicheren Ablegen von Sanctum-API-Tokens auf dem Gerät.

### Befehle

```bash
composer config repositories.nativephp-plugins composer https://plugins.nativephp.com
composer config http-basic.plugins.nativephp.com <deine-email> <your-license-key>
composer require nativephp/mobile-secure-storage
```

### APIs

- PHP-Facade: Native\Mobile\Facades\SecureStorage
- SecureStorage::set(string $key, ?string $value): array — speichert Wert; null als Wert löscht den Eintrag; Rückgabe { success: true }
- SecureStorage::get(string $key): array — liest Wert; Rückgabe { value: string }, leerer String wenn Key nicht vorhanden
- SecureStorage::delete(string $key): array — löscht Eintrag; Rückgabe { success: true }
- JS-API (Vue/React/Inertia): import { SecureStorage } from '#nativephp'
- JS: await SecureStorage.set('auth_token', '...') — async, Promise
- JS: const result = await SecureStorage.get('auth_token'); result.value enthält den Wert
- JS: await SecureStorage.delete('auth_token')
- Keine Events dokumentiert

### Konfiguration

- Composer-Repository: https://plugins.nativephp.com (privates Plugin-Repo, http-basic-Auth mit E-Mail + Lizenzschlüssel; Credentials nach Login auf nativephp.com bzw. im Purchased-Plugins-Dashboard)
- Keine env-Variablen oder config-Datei-Einträge dokumentiert
- Keine AndroidManifest.xml-Berechtigungen erforderlich/dokumentiert
- Keine Info.plist-Einträge erforderlich/dokumentiert

### Stolperfallen

- Kostenpflichtiges Plugin: 49 USD Einmalkauf ODER im Ultra-Abo enthalten (alle First-Party-Plugins, ab 35 USD/Monat); Lizenz proprietär
- Mindestversionen: iOS 18.2+, Android API 26+ (NativePHP Mobile v3)
- Installation erfordert gültige Lizenz-Credentials für das private Composer-Repo plugins.nativephp.com
- set() mit value = null löscht den Eintrag (implizites Delete)
- get() liefert bei fehlendem Key KEINEN Fehler, sondern einen leeren String — Existenzprüfung über Truthiness des Werts
- iOS: Schutzklasse kSecAttrAccessibleWhenUnlockedThisDeviceOnly — Werte sind device-only (kein iCloud-Keychain-Sync, kein Restore auf anderes Gerät) und nur bei entsperrtem Gerät zugreifbar
- Android: AES-256-GCM via EncryptedSharedPreferences + Android Keystore; hardware-backed nur auf unterstützten Geräten; iOS hardware-backed nur mit Secure Enclave
- Nur String-Werte (key/value); Arrays/Objekte müssten selbst serialisiert werden (z. B. JSON)
- Plugin-Version laut Doku: 1.0.1; keine Rebuild-/native:install-Schritte und keine Events auf der Seite dokumentiert
