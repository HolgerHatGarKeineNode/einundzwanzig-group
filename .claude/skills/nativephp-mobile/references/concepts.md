# NativePHP Mobile v3 — Konzepte — Security, Auth, SQLite, Queues, Deep Links, Versionierung

> Quelle: Deep-Scan der offiziellen Doku (nativephp.com, Stand 2026-06-11). 6 Seiten.

---

## NativePHP Mobile v3 — Concepts: Security

<https://nativephp.com/docs/mobile/3/concepts/security>

Die Seite behandelt Sicherheitskonzepte für NativePHP-Mobile-Apps (Android/iOS) und besteht aus drei Abschnitten: "Secrets and .env", "Secure Storage" und "When to use the Laravel Crypt facade".

Grundsatz: NativePHP erleichtert Sicherheit, aber der Schutz der Nutzer liegt in der Verantwortung des Entwicklers ("Although NativePHP tries to make it as easy as possible to make your application secure, it is your responsibility to protect your users.").

1) Secrets and .env: Geräte außerhalb der eigenen Organisationskontrolle sind als potenziell feindselig zu betrachten — alle in der App ausgelieferten Secrets/Passwörter/Schlüssel können kompromittiert werden. Best Practice: pro Installation eindeutige Schlüssel generieren (beim ersten oder bei jedem Start) statt identische Schlüssel an alle Nutzer auszuliefern. Für APIs: robuste Auth-Protokolle (OAuth2 empfohlen), eindeutige, ablaufende Tokens (Empfehlung: Ablauf unter 48 Stunden), hohe Token-Entropie. Immer HTTPS verwenden. Vom Nutzer eingegebene API-Keys mit großer Sorgfalt behandeln: wenn in Datei oder DB gespeichert, dann verschlüsselt; nur bei Bedarf entschlüsseln.

2) Secure Storage: Die SecureStorage-Facade bietet Zugriff auf den nativen, verschlüsselten Gerätespeicher — Keystore unter Android, Keychain unter iOS. Daten sind nur für die eigene App zugänglich und persistieren über den App-Lebenszyklus hinaus. Einschränkung: nur für kleine Textmengen gedacht (üblicherweise wenige KB); für größere Daten/Dateien Datenbank oder Dateisystem (ggf. verschlüsselt) verwenden. Details zur API stehen auf der separaten Seite /docs/apis/secure-storage.

3) Laravel Crypt facade: NativePHP generiert beim ersten App-Start einen einzigartigen APP_KEY pro Gerät, legt ihn im sicheren Gerätespeicher (Secure Storage) ab und gibt Laravel sicheren Zugriff darauf. Damit kann die Standard-Laravel-Verschlüsselung (Crypt::encryptString / Crypt::decryptString, kombiniert mit Storage::put / Storage::get) für größere Datenmengen genutzt werden, z.B. zum verschlüsselten Ablegen von Dateien. Warnungen: APP_KEY nicht über Error-Tracking/Debug-Logging leaken; mit Crypt verschlüsselte Daten sollten das Gerät nicht verlassen, da der Schlüssel gerätespezifisch ist — geht das Gerät verloren, ist der Schlüssel weg und die Daten bleiben dauerhaft unentschlüsselbar. Für Datenaustausch mit anderen Systemen: lokal entschlüsseln, über HTTPS übertragen und auf der Gegenseite mit einem extern verwalteten Schlüssel neu verschlüsseln.

Relevanz für den Implementierungsplan (Laravel + Livewire + Flux UI App): Sanctum-/API-Tokens und sensible Kleinst-Daten gehören in SecureStorage (Keychain/Keystore), nicht in die ausgelieferte .env; größere sensible Daten lokal via Crypt + Storage verschlüsseln; sämtliche Server-Kommunikation über HTTPS; Auth-Tokens kurzlebig (<48h) und pro Gerät eindeutig gestalten.

### APIs

- SecureStorage (Facade) — Zugriff auf nativen verschlüsselten Speicher: Android Keystore / iOS Keychain; nur für kleine Textmengen (wenige KB); Daten app-exklusiv und persistent über den App-Lebenszyklus hinaus; API-Details unter /docs/apis/secure-storage
- Illuminate\Support\Facades\Crypt — Crypt::encryptString($request->file('super_private_file')) zum Verschlüsseln größerer Daten mit dem gerätespezifischen APP_KEY
- Crypt::decryptString(Storage::get('my_secure_file')) — Entschlüsseln zuvor lokal verschlüsselter Daten
- Storage::put('my_secure_file', $encryptedContents) / Storage::get('my_secure_file') — Ablage/Abruf verschlüsselter Inhalte im Dateisystem

### Konfiguration

- APP_KEY — wird von NativePHP beim ersten App-Start einzigartig PRO GERÄT generiert, im sicheren Gerätespeicher (Secure Storage) abgelegt und Laravel sicher bereitgestellt; nicht der in der ausgelieferten .env enthaltene Schlüssel

### Stolperfallen

- Eigenverantwortung: NativePHP vereinfacht Sicherheit nur — der Schutz der Nutzer liegt beim Entwickler
- Endgeräte außerhalb der Organisationskontrolle als potenziell feindselig behandeln: alle mit der App ausgelieferten Secrets (.env, Passwörter, Keys) können kompromittiert werden
- Keine identischen Schlüssel für alle Installationen ausliefern — pro Installation eindeutige Schlüssel beim ersten (oder jedem) Start generieren
- API-Auth: robuste Protokolle (OAuth2 empfohlen), eindeutige ablaufende Tokens mit Ablaufzeit unter 48 Stunden und hoher Entropie
- Immer HTTPS verwenden (explizite Vorgabe der Doku)
- Vom Nutzer verwaltete API-Keys nur verschlüsselt speichern (Datei/DB) und nur bei Bedarf entschlüsseln
- Secure Storage ist nur für kleine Textmengen gedacht (üblicherweise wenige KB) — größere Daten in Datenbank oder Dateisystem ablegen
- APP_KEY darf nicht über Error-Tracking oder Debug-Logging leaken
- Mit Crypt verschlüsselte Daten sollten auf dem Gerät bleiben: der APP_KEY ist gerätespezifisch — bei Geräteverlust sind die Daten permanent unentschlüsselbar
- Datenaustausch mit anderen Systemen: lokal entschlüsseln, über HTTPS übertragen, extern mit anderem (extern verwaltetem) Schlüssel neu verschlüsseln
- Keine CLI-Befehle und keine nativen Manifest-/Info.plist-Berechtigungen auf dieser Seite dokumentiert
- Weiterführende Seiten: /docs/apis/secure-storage (SecureStorage-API), ../the-basics/system#encryption-decryption (Encryption/Decryption), /docs/mobile/3/concepts/authentication (nächste Seite), /docs/mobile/3/edge-components/icons (vorherige Seite)

---

## Authentication — NativePHP Mobile v3 (Concepts)

<https://nativephp.com/docs/mobile/3/concepts/authentication>

Die Seite behandelt Authentifizierung in NativePHP-Mobile-Apps (v3) konzeptionell. Kernaussage: Eine mobile App braucht einen externen Auth-Service — entweder selbst betrieben (z. B. die eigene Laravel-API) oder ein Drittanbieter wie WorkOS, Auth0 oder Amazon Cognito. Authentifizierung erfüllt zwei Zwecke: (1) Identitätsnachweis beim Zugriff auf APIs, (2) Feature-Gating je nach Auth-Status in der App. Wichtigstes Prinzip: 'the data is outside of your control' — Daten auf dem Gerät (lokale DB, Storage) dürfen NIE alleinige Grundlage der Authentifizierung sein; die Berechtigung des Nutzers muss regelmäßig serverseitig geprüft werden.

Abschnitt 'Tokens FTW!': Empfohlener Ansatz sind Auth-Tokens (JWT oder ablaufende API-Keys), die sicher auf dem Gerät gespeichert werden. Empfehlung: kurzlebige Auth-Tokens (maximal wenige Tage) plus Single-Use-Refresh-Tokens (typisch ~30 Tage). Wichtig: Die bloße Existenz eines Tokens auf dem Gerät beweist nicht, dass der Nutzer noch authentifiziert ist — abgelaufene/widerrufene Tokens bemerkt man erst beim tatsächlichen API-Aufruf, dann muss eine Re-Authentifizierung erfolgen. Pro-Tipp: Vor API-Aufrufen mit Native\Mobile\Facades\Network::status() die Internetverbindung prüfen.

Abschnitt 'Laravel Sanctum': Sanctum ist ein bequemer Mechanismus zur Token-Erzeugung — Login-Formular in der App sendet Benutzername/Passwort per API-Call an den Auth-Service, bei Erfolg kommt ein Token zurück. Achtung: Sanctum-Tokens verfallen standardmäßig NICHT; Token-Expiration sollte explizit aktiviert werden (Verweis auf Laravel-Doku 'Sanctum Token Expiration').

Abschnitt 'OAuth': OAuth ist die robuste, kampferprobte Lösung; empfohlen bei Laravel Passport oder OAuth-kompatiblen Diensten, idealerweise mit einer OAuth-Client-Bibliothek. Für den Auth-Flow stellt NativePHP die API Native\Mobile\Facades\Browser::auth() bereit, die speziell für die sichere Übergabe des Authorization Codes zurück an die App gedacht ist. Voraussetzung: In .env ein eindeutiges Deep-Link-Schema setzen (NATIVEPHP_DEEPLINK_SCHEME=myapp) und die Redirect-URL des OAuth-Dienstes darauf zeigen lassen, z. B. Browser::auth('https://workos.com/my-company/auth?redirect=myapp://auth/handle'). OAuth-Dienste verlangen typischerweise vordefinierte Redirect-URLs (Sicherheitsfeature) — diese vorab beim Dienst registrieren.

Sicherheitsabschnitt für eigene Auth-Endpoints: Rate Limiting unbedingt einrichten; ggf. einen mit der App ausgelieferten Authentication Key nur für den Auth-Endpoint nutzen, um Missbrauch durch unauthentifizierte Geräte-Requests zu erschweren; klassische Browser-Schutzmechanismen wie CSRF-Protection stehen im API-Kontext nicht zur Verfügung.

Verlinkte weiterführende Doku-Seiten: /docs/mobile/3/concepts/security, /docs/mobile/3/concepts/databases, Laravel Sanctum (laravel.com/docs/12.x/sanctum, inkl. #token-expiration) und Laravel Passport (laravel.com/docs/12.x/passport).

Relevanz für den Implementierungsplan (Laravel + Livewire + Flux UI): Da das Einundzwanzig-Portal bereits Sanctum nutzt, ist der Sanctum-Token-Flow (Login-Form in der App -> API-Call -> Token sicher speichern -> Token-Expiration serverseitig aktivieren -> Re-Auth bei 401) der naheliegende Weg; alternativ OAuth via Browser::auth() mit Deep-Link-Schema.

### APIs

- Native\Mobile\Facades\Browser::auth(string $url) — öffnet den System-Browser für den OAuth-Flow und ist speziell dafür gebaut, den Authorization Code sicher per Deep Link an die App zurückzugeben; Beispiel: Browser::auth('https://workos.com/my-company/auth?redirect=myapp://auth/handle')
- Native\Mobile\Facades\Network::status() — prüft die Internetverbindung des Geräts; empfohlen vor jedem API-Aufruf (Pro-Tipp der Seite)
- Laravel Sanctum (laravel/sanctum) — empfohlener Mechanismus zur Token-Erzeugung über Login-Credentials (extern verlinkt, kein NativePHP-eigener Code)
- Laravel Passport — erwähnt als OAuth-Server-Option; Empfehlung, zusätzlich eine OAuth-Client-Bibliothek zu verwenden

### Konfiguration

- NATIVEPHP_DEEPLINK_SCHEME=myapp — env-Variable; eindeutiges Deep-Link-/URL-Schema der App, Pflicht für den Browser::auth()-OAuth-Redirect (myapp://auth/handle)
- Sanctum-Token-Expiration — standardmäßig deaktiviert (Tokens verfallen nie); muss explizit in der Sanctum-Konfiguration aktiviert werden (verlinkt: laravel.com/docs/12.x/sanctum#token-expiration)
- Redirect-URL beim OAuth-Provider — muss beim Dienst (WorkOS/Auth0/Cognito etc.) vorab als erlaubte Redirect-URL registriert werden

### Stolperfallen

- Eine Mobile-App braauch zwingend einen externen Auth-Service (eigene Laravel-API oder Drittanbieter wie WorkOS, Auth0, Amazon Cognito) — rein lokale Authentifizierung ist nicht vertrauenswürdig ('the data is outside of your control'); Berechtigungen regelmäßig serverseitig prüfen
- Token-Existenz auf dem Gerät != authentifiziert: abgelaufene oder widerrufene Tokens fallen erst beim tatsächlichen API-Aufruf auf — App muss 401-Fälle abfangen und Re-Authentifizierung anstoßen
- Empfohlene Token-Strategie: kurzlebige Auth-Tokens (max. wenige Tage) + Single-Use-Refresh-Tokens (~30 Tage)
- Sanctum-Tokens laufen per Default NIE ab — Token-Expiration unbedingt aktivieren
- Vor API-Calls Konnektivität mit Network::status() prüfen (mobile Geräte sind oft offline)
- Eigene Auth-Endpoints: Rate Limiting ist Pflicht; CSRF-Schutz steht im API-Kontext nicht zur Verfügung; optional einen mit der App ausgelieferten Authentication Key nur für den Auth-Endpoint einsetzen, um Missbrauch durch unauthentifizierte Geräte zu erschweren
- OAuth: Redirect-URLs müssen beim Provider vordefiniert sein; NATIVEPHP_DEEPLINK_SCHEME muss pro App eindeutig gewählt werden
- Die Seite enthält keine CLI-Befehle und keine nativen Manifest-/Info.plist-Berechtigungen; Deep-Link-Registrierung läuft über die env-Variable
- Keine expliziten Lizenzhinweise auf dieser Seite (NativePHP Mobile ist generell ein kommerzielles/lizenzpflichtiges Produkt — auf dieser Seite aber nicht thematisiert)
- Weiterführend verlinkt: Concepts/Security und Concepts/Databases (sichere Token-Speicherung dort behandelt)

---

## Databases — NativePHP Mobile v3 (Concepts)

<https://nativephp.com/docs/mobile/3/concepts/databases>

Die Seite beschreibt die Datenbank-Unterstützung in NativePHP Mobile v3: Es wird ausschließlich SQLite für strukturierte, lokale Datenpersistenz auf iOS und Android unterstützt. Es ist KEINE manuelle Konfiguration nötig — NativePHP übernimmt automatisch: (1) Umschalten der Laravel-Datenbankverbindung auf SQLite beim App-Build, (2) Anlegen der SQLite-Datenbank im App-Container auf dem Gerät, (3) Ausführen der Migrationen bei jedem App-Start ("as needed", d. h. nur ausstehende Migrationen). Migrationen sind damit der zentrale Mechanismus für Schema-Änderungen UND für das Seeding: Die Doku empfiehlt "Seed-Migrationen" (z. B. via `php artisan make:migration seed_app_settings`), weil Migrationen genau einmal pro Installation laufen, von Laravel getrackt werden, versionierbar mit App-Releases sind und reversibel sein können. Beispielcode zeigt eine anonyme Migration-Klasse, die mit `DB::table('categories')->insert([...])` Initialdaten einfügt. Wichtige Hinweise: SQLite-Foreign-Keys waren vor Laravel 11 standardmäßig deaktiviert; Migrationen unbedingt auf Produktions-Builds testen, bevor Updates veröffentlicht werden, da fehlerhafte Migrationen beim App-Update Nutzerdaten löschen können; bei Deinstallation der App werden alle lokalen Datenbanken gelöscht; ein Remote-Datenbankzugriff ist nicht möglich, da die App auf dem Endgerät läuft. MySQL/PostgreSQL werden bewusst NICHT unterstützt (Sicherheitsentscheidung: verhindert, dass Produktions-DB-Credentials in die Mobile-App eingebettet werden). Für zentrale Daten/Synchronisation empfiehlt die Doku einen API-First-Ansatz: ein API-Backend (OAuth 2.0, Laravel Passport oder Sanctum) mit Token-Auth; Vorteile sind serverseitig verbleibende Credentials, AuthZ/AuthN, Rate Limiting, Request-Validierung, Audit-Logs, sofortiger Zugriffsentzug, bessere Fehlerbehandlung/Offline-Support, Skalierbarkeit, API-Versionierung und mobile-gerechte Daten-Transformation. Best Practices Mobile-Seite: keine API-Keys im Code; API-Tokens nach User-Login ausgeben und mit der SecureStorage-API speichern; Tokens mit hoher Entropie und kurzer Lebensdauer; ausschließlich HTTPS; lokale SQLite-Daten als Offline-Cache nutzen; Konnektivität vor API-Calls prüfen. Server-Seite: Token-basierte Auth, Rate Limiting, Input-Validierung/Sanitisierung, korrekte SSL-Zertifikate, Logging aller Auth-/API-Zugriffe. Für das Einundzwanzig-Projekt (Laravel + Livewire + Flux) heißt das: Die App nutzt on-device SQLite als lokalen Cache/Offline-Store, alle zentralen Daten laufen über die bestehende Sanctum-API; Seed-/Schema-Migrationen werden mit dem App-Release ausgeliefert und laufen automatisch beim Start. Speicherorte der SQLite-Datei, env-Variablen (z. B. DB_CONNECTION) oder native Berechtigungen werden auf dieser Seite nicht genannt. Verwandte Seiten: Authentication (vorher), Queues (nachher).

### Befehle

```bash
php artisan make:migration seed_app_settings
```

### APIs

- SecureStorage API — empfohlene NativePHP-API zum sicheren Speichern von API-Tokens auf dem Gerät (Namespace auf dieser Seite nicht angegeben)
- Illuminate\Support\Facades\DB — DB::table('categories')->insert([...]) in Seed-Migrationen
- Illuminate\Database\Migrations\Migration — anonyme Migration-Klasse (return new class extends Migration { public function up() { ... } };) als Seed-Migration
- Laravel Sanctum / Laravel Passport / OAuth 2.0 — empfohlene serverseitige Token-Auth für den API-First-Ansatz

### Konfiguration

- Keine manuelle Konfiguration erforderlich: NativePHP schaltet die DB-Verbindung beim App-Build automatisch auf SQLite um, legt die Datenbank im App-Container an und führt Migrationen bei jedem App-Start (nur ausstehende) automatisch aus
- Env-Variablen/config-Keys (z. B. DB_CONNECTION): auf dieser Seite nicht erwähnt
- Native Berechtigungen (AndroidManifest/Info.plist): auf dieser Seite nicht erwähnt
- SQLite-Dateipfad/Speicherort auf dem Gerät: auf dieser Seite nicht erwähnt (nur 'im App-Container')

### Stolperfallen

- Nur SQLite wird unterstützt; MySQL/PostgreSQL bewusst nicht (Sicherheitsentscheidung, um Produktions-DB-Credentials nicht in die Mobile-App einzubetten)
- Kein Remote-Datenbankzugriff möglich — die App läuft auf dem Endgerät; für zentrale Daten ist ein API-Backend (API-First) der empfohlene Weg
- Migrationen laufen automatisch bei jedem App-Start; fehlerhafte Migrationen in einem App-Update können Nutzerdaten zerstören — Warnung: Migrationen unbedingt auf Prod-Builds vor Release testen
- SQLite-Foreign-Key-Constraints waren vor Laravel 11 standardmäßig deaktiviert — ggf. explizit aktivieren (Projekt nutzt Laravel 12, daher unkritisch)
- Bei Deinstallation der App werden alle lokalen SQLite-Datenbanken gelöscht — keine persistente Speicherung über Reinstall hinweg
- Seeding über Seed-Migrationen statt Seeder: laufen genau einmal pro Installation, werden getrackt, sind mit App-Versionen versionierbar und reversibel
- Keine API-Keys/Credentials in den App-Code einbetten; Tokens nur nach User-Auth ausgeben, via SecureStorage speichern, hohe Entropie + kurze Lebensdauer, nur HTTPS
- Mobile-Empfehlung: lokale SQLite-Daten als Offline-Cache nutzen und Konnektivität vor API-Aufrufen prüfen; serverseitig Rate Limiting, Input-Validierung und Auth-Logging

---

## Queues – NativePHP Mobile v3 (Concepts)

<https://nativephp.com/docs/mobile/3/concepts/queues>

Die Seite beschreibt das Queue-System von NativePHP Mobile v3: NativePHP betreibt einen Hintergrund-Queue-Worker neben dem Haupt-Thread der App, der Jobs verarbeitet, ohne die UI zu blockieren. iOS und Android werden beide unterstützt.

Setup: In der .env wird QUEUE_CONNECTION=database gesetzt; die Initialisierung des Workers erfolgt automatisch beim App-Start, es ist kein manueller Start nötig.

Nutzung: Jobs werden ganz normal nach Laravel-Standard dispatcht – entweder per SyncData::dispatch($payload) oder per dispatch(new App\Jobs\ProcessUpload($file)). Das dokumentierte Beispiel ist eine Klasse App\Jobs\SyncData implements ShouldQueue mit den Traits Dispatchable, InteractsWithQueue, Queueable, SerializesModels; im handle() wird per Http::post('https://api.example.com/sync', $this->payload) ein Sync ausgeführt und anschließend per Dialog::toast('Sync complete!') (NativePHP\Plugins\Dialog\Dialog) eine native Toast-Meldung gezeigt – Jobs können also native NativePHP-Plugin-APIs nutzen.

Funktionsweise: NativePHP startet automatisch eine dedizierte PHP-Runtime auf einem separaten Thread, die in einer Schleife `queue:work --once` ausführt und damit vom Haupt-Request-Zyklus isoliert ist.

Voraussetzungen/Einschränkungen: Der Queue-Worker erfordert ZTS (Thread-Safe) PHP, das ab NativePHP Mobile v3.1+ standardmäßig enthalten ist. Es wird ausschließlich die database-Queue-Connection unterstützt (Backend: SQLite). Jobs sind persistent und überleben App-Neustarts. Für fehlgeschlagene Jobs gelten die Standard-Retry-/Failure-Mechanismen von Laravel.

Für den Implementierungsplan (Laravel + Livewire + Flux UI): Es sind keine zusätzlichen nativen Berechtigungen (AndroidManifest/Info.plist), keine config/queue.php-Sonderkonfiguration, keine Worker-Anzahl-Einstellungen, keine Lifecycle-/Suspend-Hinweise und keine Plattformunterschiede dokumentiert – die Seite ist bewusst minimal. Verwandte Doku-Seiten sind Databases (/docs/mobile/3/concepts/databases) und Deep Links (/docs/mobile/3/concepts/deep-links).

### Befehle

```bash
queue:work --once  (wird intern von NativePHP in einer Schleife auf einem separaten Thread ausgeführt – kein manueller Aufruf nötig)
```

### APIs

- SyncData::dispatch($payload) – Standard-Laravel-Dispatch eines Jobs (use App\Jobs\SyncData)
- dispatch(new App\Jobs\ProcessUpload($file)) – globaler dispatch()-Helper
- Illuminate\Contracts\Queue\ShouldQueue – Interface für queuebare Jobs
- Traits im Beispieljob: Illuminate\Foundation\Bus\Dispatchable, Illuminate\Queue\InteractsWithQueue, Illuminate\Bus\Queueable, Illuminate\Queue\SerializesModels
- Illuminate\Support\Facades\Http – Http::post('https://api.example.com/sync', $this->payload) im Job-handle()
- NativePHP\Plugins\Dialog\Dialog – Dialog::toast('Sync complete!'): native Plugin-APIs sind aus Queue-Jobs heraus nutzbar
- Konstruktor mit Property Promotion: public function __construct(public array $payload) {}

### Konfiguration

- QUEUE_CONNECTION=database (.env) – einzige unterstützte Queue-Connection, Backend ist SQLite
- Keine weiteren config/queue.php-Keys, env-Variablen oder native Berechtigungen (AndroidManifest/Info.plist) auf der Seite dokumentiert
- Worker-Initialisierung erfolgt automatisch beim App-Start – keine Konfiguration der Worker-Anzahl möglich/dokumentiert

### Stolperfallen

- ZTS (Thread-Safe) PHP ist erforderlich; ab NativePHP Mobile v3.1+ standardmäßig enthalten – bei älteren 3.x-Versionen ggf. nicht gegeben
- Nur die database-Queue-Connection (SQLite) wird unterstützt – redis, sync, sqs etc. funktionieren nicht
- Jobs sind persistent und überleben App-Neustarts (database-Backend)
- Fehlgeschlagene Jobs: Standard-Laravel-Retry-/Failure-Mechanismen gelten; die Seite dokumentiert keine Besonderheiten zu failed_jobs-Migrationen
- Der Worker läuft als dedizierte PHP-Runtime auf separatem Thread, der `queue:work --once` in Schleife ausführt – isoliert vom Haupt-Request-Zyklus; lang laufende Daemon-Worker-Optionen gibt es nicht
- Keine Doku zu App-Lifecycle (Hintergrund/Suspend): Verhalten des Workers bei suspendierter App ist auf der Seite nicht spezifiziert – im Implementierungsplan einplanen, dass Jobs primär bei aktiver App laufen
- Keine Lizenzhinweise auf dieser Seite (NativePHP Mobile ist generell lizenzpflichtig, hier aber nicht erwähnt)
- iOS und Android werden beide unterstützt; keine dokumentierten Plattformunterschiede
- Verwandte Seiten: /docs/mobile/3/concepts/databases und /docs/mobile/3/concepts/deep-links

---

## Deep Links (NativePHP Mobile v3 — Concepts)

<https://nativephp.com/docs/mobile/3/concepts/deep-links>

Die Seite beschreibt die zwei Deep-Linking-Ansätze von NativePHP Mobile v3, die beide gleichzeitig nutzbar sind: (1) Custom URL Schemes und (2) Associated Domains (Universal Links auf iOS, App Links auf Android). Beide sorgen dafür, dass die App direkt an der passenden Route geöffnet wird.

1) Custom URL Scheme: URLs der Form `myapp://some/path`. Aktivierung allein über die env-Variable `NATIVEPHP_DEEPLINK_SCHEME=myapp` in der `.env` — keine weitere manuelle Manifest-/Plist-Konfiguration auf der Seite dokumentiert. Funktioniert nur, wenn die App installiert ist; hilft nicht bei App-Discovery (kein Browser-Fallback). Das Scheme muss eindeutig gewählt werden, um Konflikte mit anderen Apps zu vermeiden; einige System-Schemes (z. B. `https`) sind reserviert und nicht verfügbar. Laut Doku besonders geeignet, um Daten zwischen Apps auszutauschen.

2) Associated Domains: Echte HTTPS-URLs der Form `https://example.net/some/path` öffnen die App statt des Browsers, falls installiert; andernfalls lädt die URL ganz normal im Browser (Fallback). Aktivierung über `NATIVEPHP_DEEPLINK_HOST=example.net` in der `.env`. Zusätzlich müssen auf dem eigenen Server Verifikationsdateien gehostet werden: `.well-known/apple-app-site-association` (iOS) und `.well-known/assetlinks.json` (Android). Das mobile OS liest diese Dateien und verifiziert damit die Domain-App-Zuordnung.

Testing/Troubleshooting: Associated Domains funktionieren typischerweise NICHT in Simulatoren — auf echten Geräten mit öffentlich erreichbarem Server testen. Bei Problemen: App komplett löschen und neu installieren (das OS cached das Verifikationsergebnis) und Format/Inhalt der Verifikationsdateien validieren. Custom URL Schemes haben diese Simulator-Einschränkung nicht.

Use Cases: Deep Linking eignet sich, um Nutzer aus anderem Kontext direkt an eine Schlüsselstelle der App zu bringen — ideal für NFC-Tags, QR-Codes sowie E-Mail-/SMS-Marketing.

Wichtig für den Implementierungsplan: Die Seite enthält KEINE PHP/JS-API (keine Klassen, Facades, Events wie z. B. ein DeepLinkReceived-Event, keine Livewire-Listener) und KEINE CLI-Befehle — wie eingehende Deep-Link-URLs in Laravel/Livewire-Routen behandelt werden, ist hier nicht dokumentiert und müsste anderen Doku-Seiten entnommen werden. Auch Lizenzhinweise (Pro/Paid) stehen nicht auf dieser Seite. Verlinkte Nachbarseiten: Queues (vorher) und Push Notifications (nachher).

### Konfiguration

- NATIVEPHP_DEEPLINK_SCHEME=myapp — .env-Variable; aktiviert ein Custom URL Scheme (myapp://some/path)
- NATIVEPHP_DEEPLINK_HOST=example.net — .env-Variable; aktiviert Associated Domains (Universal Links/App Links) für https://example.net/some/path
- .well-known/apple-app-site-association — Verifikationsdatei, die auf dem eigenen HTTPS-Server gehostet werden muss (iOS Universal Links)
- .well-known/assetlinks.json — Verifikationsdatei, die auf dem eigenen HTTPS-Server gehostet werden muss (Android App Links)

### Stolperfallen

- Beide Ansätze (Custom Scheme + Associated Domains) können gleichzeitig verwendet werden
- Custom URL Schemes funktionieren nur bei installierter App und bieten keinen Browser-Fallback — ungeeignet für App-Discovery
- Scheme eindeutig wählen (Kollisionsgefahr mit anderen Apps); System-Schemes wie `https` sind reserviert und nicht nutzbar
- Associated Domains erfordern öffentlich per HTTPS erreichbare Verifikationsdateien auf dem eigenen Server; das OS verifiziert die Zuordnung durch Lesen dieser Dateien
- Associated Domains funktionieren typischerweise nicht im Simulator — Tests nur auf echten Geräten mit öffentlich erreichbarem Server
- Verifikationsergebnis wird vom OS gecacht: Bei Problemen App vollständig löschen und neu installieren sowie Format/Inhalt von apple-app-site-association bzw. assetlinks.json prüfen
- Die Seite dokumentiert NICHT, wie eingehende Deep Links serverseitig (Routen/Events/Livewire) verarbeitet werden — keine PHP/JS-API, keine Events, keine CLI-Befehle auf dieser Seite; für den Implementierungsplan müssen weitere Doku-Seiten herangezogen werden
- Keine expliziten Lizenzhinweise (Pro/Paid-Feature) auf dieser Seite
- Typische Einsatzszenarien laut Doku: NFC-Tags, QR-Codes, E-Mail-/SMS-Marketing

---

## NativePHP Mobile v3 – Concepts: Push Notifications

<https://nativephp.com/docs/mobile/3/concepts/push-notifications>

Die Seite beschreibt das Push-Notification-Konzept von NativePHP Mobile v3. Abschnitte in Reihenfolge: Overview, Firebase, Service account, Getting push tokens, Sending push notifications.

Overview: Push Notifications laufen auf iOS UND Android einheitlich über Firebase Cloud Messaging (FCM). Der Nutzer muss der Notification-Berechtigung zustimmen; danach erhält das Gerät ein Token, über das gezielt Nachrichten gesendet werden können. Für iOS ist KEINE separate APNs-Konfiguration nötig – FCM routet Nachrichten automatisch über Apple Push Notification Service (APNS).

Firebase-Setup: Ein Firebase-Projekt anlegen, dann zwei Plattform-Konfigurationsdateien herunterladen und ins App-/Projekt-Root legen: google-services.json (Android) und GoogleService-Info.plist (iOS). NativePHP übernimmt die plattformspezifische Einbindung dieser Dateien automatisch.

Service account (serverseitiges Senden): In der Firebase Console unter Project Settings → Service Accounts → "Generate New Private Key" einen Schlüssel erzeugen und als fcm-service-account.json speichern. Diese Datei dient der Server-Anwendung zum Versand via FCM.

Getting push tokens: Beim App-Start (Bootup) per Facade `Native\Mobile\Facades\PushNotifications::getToken()` ein Token anfordern. Wichtig: Tokens können sich ändern (App-Restore auf neuem Gerät, App-Update, FCM-interne Vorgänge) – daher immer per Event-Listener auf neue Tokens reagieren. Dazu in einer Livewire-Komponente das Attribut `#[OnNative(TokenGenerated::class)]` auf eine Methode setzen (Event `Native\Mobile\Events\PushNotification\TokenGenerated`), die das übergebene `string $token` z. B. über einen eigenen API-Service an das Backend sendet und dort dem Nutzer/Gerät zuordnet.

Sending push notifications: Mit den gespeicherten Tokens versendet die Server-Anwendung Nachrichten über FCM. Die serverseitige Implementierung ist laut Doku explizit "out of scope" – es gibt keine Beispiele mit kreait/laravel-firebase o. ä.

Kritische Einschränkung: Push Notifications funktionieren NICHT im iOS-Simulator (Apple-Limitation) – Tests erfordern ein physisches iOS-Gerät.

Für den Implementierungsplan (Laravel + Livewire + Flux UI) bedeutet das: (1) Firebase-Projekt + beide Config-Dateien ins App-Root, (2) Livewire-Komponente mit getToken()-Aufruf beim Mount/Bootup und #[OnNative(TokenGenerated::class)]-Handler, (3) Backend-Endpoint zum Speichern/Aktualisieren der Tokens pro Nutzer/Gerät, (4) Versand serverseitig via FCM HTTP v1 mit fcm-service-account.json (eigene Implementierung, z. B. kreait/laravel-firebase – nicht Teil der Doku). Verwandte Doku-Seiten: /docs/mobile/3/concepts/deep-links, /docs/mobile/3/plugins/core/firebase, /docs/mobile/3/plugins/introduction.

### APIs

- Native\Mobile\Facades\PushNotifications (Facade) – zentrale Push-API
- PushNotifications::getToken() – fordert beim App-Bootup das FCM-Device-Token an (löst Permission-Prompt aus, falls noch nicht erteilt)
- Native\Mobile\Events\PushNotification\TokenGenerated (Event) – wird gefeuert, wenn ein (neues) Token generiert wurde; Payload: string $token
- Native\Mobile\Attributes\OnNative (PHP-Attribut) – z. B. #[OnNative(TokenGenerated::class)] auf einer Livewire-Komponenten-Methode, um native Events zu empfangen; Methode erhält $token und kann DI-Services nutzen (Beispiel: public function storePushToken(APIService $api, string $token))

### Konfiguration

- google-services.json – Firebase-Konfigurationsdatei für Android, ins Projekt-/App-Root legen (NativePHP bindet sie automatisch plattformspezifisch ein)
- GoogleService-Info.plist – Firebase-Konfigurationsdatei für iOS, ebenfalls ins Projekt-/App-Root legen
- fcm-service-account.json – Service-Account-Private-Key für serverseitigen FCM-Versand; Erzeugung: Firebase Console → Project Settings → Service Accounts → Generate New Private Key
- Notification-Berechtigung: Nutzer muss Push-Permission auf dem Gerät zustimmen, bevor Tokens ausgestellt werden (Prompt wird durch getToken() ausgelöst; keine manuellen AndroidManifest-/Info.plist-Einträge auf der Seite dokumentiert)
- Keine env-Variablen oder config/nativephp.php-Keys auf dieser Seite dokumentiert

### Stolperfallen

- Push Notifications funktionieren NICHT im iOS-Simulator (Apple-Limitation) – Tests nur auf physischem iOS-Gerät möglich
- Voraussetzung: Firebase-Projekt; gesamter Push-Stack (iOS und Android) läuft über FCM
- Keine separate APNs-Konfiguration nötig – FCM routet iOS-Nachrichten automatisch über APNS (APNs-Keys/Provisioning werden auf der Seite nicht behandelt)
- Push-Tokens sind NICHT stabil: Sie können sich bei App-Restore, App-Update oder FCM-internen Vorgängen ändern – Token-Speicherung muss über den TokenGenerated-Event-Listener laufen und Tokens serverseitig aktualisieren
- Serverseitiger Versand (FCM HTTP v1 mit fcm-service-account.json) ist explizit 'out of scope' der Doku – muss selbst implementiert werden (z. B. kreait/laravel-firebase)
- Keine CLI-Befehle auf dieser Seite; Setup besteht nur aus Dateiplatzierung und PHP-Code
- Weiterführende Doku: Deep Links (/docs/mobile/3/concepts/deep-links) und Firebase-Plugin (/docs/mobile/3/plugins/core/firebase) – Letzteres ggf. für zusätzliche Details zum Firebase-Setup heranziehen
