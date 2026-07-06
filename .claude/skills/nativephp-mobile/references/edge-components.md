# NativePHP Mobile v3 — EDGE-Komponenten — native UI aus Blade (Top Bar, Bottom Nav, Side Nav, Icons)

> Quelle: Deep-Scan der offiziellen Doku (nativephp.com, Stand 2026-06-11). 5 Seiten.

---

## EDGE Components – Introduction (NativePHP Mobile v3)

<https://nativephp.com/docs/mobile/3/edge-components/introduction>

EDGE (Element Definition and Generation Engine) ist das Komponentensystem von NativePHP for Mobile v3, das Blade-Template-Syntax in plattform-native UI-Elemente transformiert. EDGE-Komponenten rendern NICHT im WebView, sondern werden zur Laufzeit in echte native Elemente kompiliert, leben unabhängig vom WebView-Lebenszyklus (persistent) und bieten echte native Performance. Es gibt keine eigene Rendering-Engine und keinen komplexen Ahead-of-Time-Kompilierungsschritt – nur eine leichtgewichtige Transformation zur Laufzeit, komplett per PHP konfiguriert.

Funktionsweise: Komponenten werden in Blade definiert (z. B. <native:bottom-nav> mit <native:bottom-nav-item id="home" icon="home" label="Home" url="/home" />). EDGE verarbeitet sie bei JEDEM Request und kompiliert sie zu einer einfachen JSON-Konfiguration, die an die native Seite übergeben wird. Die generischen Komponenten sind bereits im nativen Code einkompiliert und werden anhand der JSON-Konfiguration gerendert. Das Konzept entspricht Server-Driven UI, aber ohne Netzwerk: Generierung und Rendering passieren on-device, PHP spricht direkt mit dem UI-State-Manager – unabhängig vom WebView. Dadurch kann die App aktuelle Plattform-Features nutzen (z. B. Liquid Glass auf iOS).

Verfügbare Komponenten (erste Generation, Fokus Navigation, plattformabhängiges Look-and-Feel): 1) Bottom Navigation (immer erreichbare untere Navigationsleiste, Doku-Seite "bottom-nav"), 2) Top Bar (Titelleiste mit Action-Buttons, Doku-Seite "top-bar"), 3) Side Navigation (ausklappbarer Navigations-Drawer, Doku-Seite "side-nav"). Zusätzlich gibt es in der Sektion eine eigene "Icons"-Seite.

Warum Blade: Vertraut für Laravel-Nutzer, zugänglich für HTML-Kenner; alle EDGE-Komponenten sind Blade-Komponenten und nutzen Blades erprobte Processing-Engine für die Just-in-Time-Transformation.

Platzierung: Komponenten können in jeder Blade-Datei definiert werden, müssen aber gerendert werden, um verarbeitet zu werden. Empfehlung: in einem Blade-Layout/Komponente platzieren, die bei jedem Request gerendert wird, z. B. layouts/app.blade.php oder dessen Kind-Views – für eine Livewire/Flux-App also ins Haupt-Layout.

Props-Validierung: EDGE erzwingt Pflicht-Props zur Renderzeit. Fehlende Props erzeugen eine klare Fehlermeldung, z. B.: "EDGE Component <native:bottom-nav-item> is missing required properties: 'label'. Add these attributes to your component: label=\"...\"". Welche Props pflicht/optional sind, steht auf der jeweiligen Komponenten-Doku-Seite.

Inertia-Hinweis: Jeder Link in einer EDGE-Komponente macht standardmäßig einen vollen Post-back zu PHP. Für Inertia-Apps kann man die Requests in Inertia-<Link>-Navigation umwandeln, indem man den Inertia-Router an window.router hängt (import { router } from '@inertiajs/vue3'; window.router = router; inkl. TypeScript-Global-Deklaration). Für eine reine Livewire-App ist das nicht nötig – dort ist der volle Request das normale Verhalten.

Die Seite enthält keine CLI-Befehle, keine env-/config-Einträge und keine nativen Berechtigungen – sie ist eine konzeptionelle Einführung; Details zu Props liefern die Folgeseiten Top Bar, Bottom Navigation, Side Navigation und Icons.

### APIs

- Blade-Komponente <native:bottom-nav> – Container für die native Bottom-Navigation-Leiste
- Blade-Komponente <native:bottom-nav-item id="..." icon="..." label="..." url="..." /> – einzelner Tab der Bottom Navigation; Props im Beispiel: id, icon, label, url; 'label' ist nachweislich ein Pflicht-Prop
- Blade-Komponente Top Bar (<native:top-bar>, Details auf eigener Doku-Seite 'top-bar') – Titelleiste mit Action-Buttons
- Blade-Komponente Side Navigation (<native:side-nav>, Details auf eigener Doku-Seite 'side-nav') – Slide-out-Navigations-Drawer
- JS/TS-API für Inertia: import { router } from '@inertiajs/vue3'; declare global { interface Window { router: typeof router; } } window.router = router; – wandelt EDGE-Link-Postbacks in Inertia-<Link>-Navigation um
- EDGE-Pipeline: Blade-Komponenten -> JSON-Konfiguration -> nativer UI-State-Manager rendert einkompilierte generische native Komponenten (kein WebView beteiligt)

### Stolperfallen

- EDGE-Komponenten werden nur verarbeitet, wenn die Blade-Datei tatsächlich gerendert wird – sie gehören daher in ein Layout, das bei JEDEM Request gerendert wird (z. B. layouts/app.blade.php oder Kind-Views); bei Livewire also ins App-Layout legen
- EDGE-Komponenten rendern außerhalb des WebView und sind persistent über den WebView-Lebenszyklus hinaus – Styling/Verhalten ist plattform-nativ, nicht per Tailwind/Flux beeinflussbar
- Pflicht-Props werden zur Renderzeit validiert; fehlende Props werfen einen Fehler wie: EDGE Component <native:bottom-nav-item> is missing required properties: 'label'. Add these attributes to your component: label="..."
- Welche Props pflicht vs. optional sind, steht jeweils auf der Komponenten-Doku-Seite (Top Bar, Bottom Navigation, Side Navigation, Icons) – diese Seiten für die Implementierung zusätzlich lesen
- Jeder Link in einer EDGE-Komponente führt einen vollen Post-back zu PHP aus; bei Inertia-Apps muss window.router gesetzt werden, um SPA-Navigation zu erhalten (für Livewire-Apps irrelevant, da Full-Request dort erwartet wird)
- Transformation passiert zur Laufzeit bei jedem Request (kein Build-Schritt); die nativen Komponenten selbst sind im nativen Binary vorkompiliert und werden nur per JSON konfiguriert – es lassen sich also keine beliebigen eigenen nativen UI-Elemente definieren, nur die 3 vorhandenen (Bottom Nav, Top Bar, Side Nav)
- Aktuell sind ausschließlich Navigations-Komponenten verfügbar; restliches UI läuft weiterhin im WebView (Livewire/Flux)
- Plattformspezifisches Rendering: iOS kann z. B. Liquid Glass nutzen; Aussehen unterscheidet sich je Plattform bewusst
- Die Seite selbst enthält keine CLI-Befehle, env-Variablen oder Berechtigungen; solche Details stehen in anderen Doku-Sektionen (Getting Started / Plugins)
- Tipp: Die Doku ist als reines Markdown unter der URL mit .md-Suffix abrufbar (https://nativephp.com/docs/mobile/3/edge-components/introduction.md)

---

## Top Bar — NativePHP Mobile v3, EDGE Components

<https://nativephp.com/docs/mobile/3/edge-components/top-bar>

Die Seite dokumentiert die EDGE-Komponente "Top Bar" von NativePHP Mobile v3: eine nativ gerenderte, anpassbare Kopfleiste am oberen Bildschirmrand der mobilen App, die einen Titel (optional mit Untertitel) und Aktions-Buttons anzeigt. Seitenstruktur: Overview, Props, Children (mit eigener Props-Tabelle für Actions).

Verwendung erfolgt deklarativ per Blade-Komponenten: `<native:top-bar>` als Container, darin bis zu 10 `<native:top-bar-action>`-Kinder, die an der hinteren Kante (trailing edge) der Leiste positioniert werden.

Basis-Beispiel (wörtlich aus der Doku):
```blade
<native:top-bar title="Dashboard" subtitle="Welcome back">
    <native:top-bar-action
        id="search"
        label="Search"
        icon="search"
        :url="route('search')"
    />
    <native:top-bar-action
        id="settings"
        icon="settings"
        label="Settings"
        url="https://yourapp.com/my-account"
    />
</native:top-bar>
```

Props von `<native:top-bar>`:
- `title` (string, erforderlich): Haupt-Überschrift.
- `show-navigation-icon` (boolean, Default `true`): zeigt Back-/Menü-Button an.
- `label` (string, optional): Text für Barrierefreiheit und für Overflow-Menüs, wenn Actions die Plattform-Limits überschreiten.
- `background-color` (Hex, optional): eigene Hintergrundfarbe.
- `text-color` (Hex, optional): eigene Textfarbe.
- `elevation` (0–24, optional, nur Android): Schattentiefe.
- `subtitle`: wird im Code-Beispiel verwendet ("Welcome back"), ist in der Props-Liste der Seite aber nicht offiziell dokumentiert.

Props von `<native:top-bar-action>`:
- `id` (string, erforderlich): eindeutiger Bezeichner.
- `icon` (string, erforderlich): benannte Icon-Referenz (siehe verlinkte Icons-Seite).
- `label` (string, optional, empfohlen): Accessibility-Text und Anzeige im Overflow-Menü.
- `url` (string, optional): Navigationsziel beim Tippen.

Plattformverhalten:
- Android: die ersten 3 Actions erscheinen als Icon-Buttons; weitere klappen in ein Overflow-Menü (⋮).
- iOS: bei mehr als 5 Actions klappen die überzähligen in ein Overflow-Menü.
- URL-Verhalten: externe URLs öffnen im Geräte-Browser; interne URLs navigieren innerhalb der WebView (für Laravel/Livewire-Routen also `:url="route('...')"` verwenden).

Auf der Seite NICHT enthalten: CLI-Befehle, PHP-Facades/Klassen/Methoden, JavaScript-APIs, Events/Click-Handling ohne `url`, env-/config-Einstellungen, native Berechtigungen, Lizenzhinweise. Verlinkte verwandte Seiten: Icons (/docs/mobile/3/edge-components/icons), Introduction (/docs/mobile/3/edge-components/introduction), Bottom Navigation (/docs/mobile/3/edge-components/bottom-nav). Doku-Versionen 1.x/2.x/3.x verfügbar; diese Seite betrifft v3.

### APIs

- Blade-Komponente <native:top-bar> — nativ gerenderte Kopfleiste; Props: title (required), subtitle (im Beispiel, nicht in Props-Liste dokumentiert), show-navigation-icon (bool, Default true), label, background-color (hex), text-color (hex), elevation (0-24, nur Android)
- Blade-Komponente <native:top-bar-action> — Aktions-Button in der Top Bar (max. 10 pro Top Bar); Props: id (required), icon (required, benannte Icon-Referenz), label (Accessibility/Overflow-Menü), url (Navigationsziel, z. B. :url="route('search')")
- Keine PHP-Facades/-Klassen, JS-APIs oder Events auf dieser Seite dokumentiert — Action-Handling läuft ausschließlich über das url-Prop (interne URL → WebView-Navigation, externe URL → Geräte-Browser)

### Stolperfallen

- Maximal 10 <native:top-bar-action>-Elemente pro Top Bar; Positionierung an der trailing edge
- Android: nur die ersten 3 Actions als Icon-Buttons sichtbar, Rest im Overflow-Menü (⋮); iOS: ab mehr als 5 Actions Overflow-Menü — label setzen, da es dort als Anzeigetext dient
- elevation (Schatten 0-24) wirkt nur auf Android
- subtitle wird im offiziellen Beispiel benutzt, fehlt aber in der dokumentierten Props-Liste — Verhalten ggf. ungeprüft/undokumentiert
- Externe URLs öffnen im System-Browser, interne URLs in der WebView — für Livewire-Seiten immer interne Routen (route()) verwenden
- Die Seite dokumentiert kein Event-/Callback-Handling für Actions ohne url; falls eine Action eine Livewire-Aktion statt Navigation auslösen soll, liefert diese Seite dafür keine API — andere Doku-Seiten (z. B. EDGE Introduction) prüfen
- Keine CLI-Befehle, env-/config-Keys, nativen Berechtigungen oder Lizenzhinweise auf dieser Seite; Voraussetzungen für EDGE Components stehen vermutlich in der Introduction-Seite (/docs/mobile/3/edge-components/introduction)
- Doku gilt für NativePHP Mobile Version 3.x (Versionen 1.x/2.x haben eigene Doku-Stände)

---

## Bottom Navigation — NativePHP Mobile v3, Sektion "EDGE Components"

<https://nativephp.com/docs/mobile/3/edge-components/bottom-nav>

Die Seite dokumentiert die EDGE-Komponente "Bottom Navigation" von NativePHP Mobile v3: eine native untere Navigationsleiste mit bis zu 5 Einträgen, gedacht als primäre App-Navigation (Screenshots für iOS und Android vorhanden: bottom-nav-ios.png, bottom-nav-android.png, bottom-nav-item-badge.png).

AUFBAU: Die Komponente wird als Blade-Tag `<native:bottom-nav>` deklariert und enthält als Kinder bis zu 5 `<native:bottom-nav-item>`-Elemente.

VOLLSTÄNDIGES CODE-BEISPIEL (einziges auf der Seite):
```blade
<native:bottom-nav label-visibility="labeled">
    <native:bottom-nav-item
        id="home"
        icon="home"
        label="Home"
        url="/home"
        :active="true"
    />
    <native:bottom-nav-item
        id="profile"
        icon="person"
        label="Profile"
        url="/profile"
        badge="3"
    />
</native:bottom-nav>
```

PROPS von `<native:bottom-nav>`:
- `label-visibility` — `labeled`, `selected` oder `unlabeled` (optional, Default: `labeled`)
- `dark` — erzwingt Dark-Mode-Styling (optional)

PROPS von `<native:bottom-nav-item>` (Children):
- `id` — eindeutiger Bezeichner (PFLICHT)
- `icon` — ein benanntes Icon (PFLICHT; verweist auf die eigene Doku-Seite "Icons" in derselben EDGE-Components-Sektion)
- `label` — Accessibility-Label (PFLICHT)
- `url` — URL, zu der in der WebView navigiert wird (PFLICHT)
- `active` — hebt das Item als aktiv hervor (optional, Default: `false`)
- `badge` — Badge-Text/-Nummer (optional)
- `news` — zeigt einen "neu"-Indikator-Punkt (optional, Default: `false`)

NAVIGATIONSVERHALTEN: Jede `url`, die NICHT zur Domain der WebView passt, wird im Standard-Browser des Nutzers geöffnet (nicht in der App).

ABSCHNITT "badge example": zeigt nur einen Screenshot (bottom-nav-item-badge.png) eines Items mit Badge, kein zusätzlicher Code.

KONTEXT/EINORDNUNG: Die Seite gehört zur Sektion "EDGE Components" (Introduction, Top Bar, Bottom Navigation, Side Navigation, Icons); Vorgängerseite: "Top Bar", Folgeseite: "Side Navigation". Die Seite enthält KEINE CLI-Befehle, KEINE env-Variablen/config-Keys, KEINE nativen Berechtigungen, KEINE Events/PHP-Facades und KEINE expliziten Lizenzhinweise — sie ist eine reine Blade-Komponenten-Referenz. Für einen Implementierungsplan mit Laravel + Livewire + Flux UI relevant: Die Bottom-Nav wird deklarativ im Blade-Markup definiert und nativ gerendert (nicht als HTML in der WebView); aktiver Zustand wird pro Seite über `:active` gesteuert, Navigation läuft über `url` innerhalb der WebView-Domain.

### APIs

- <native:bottom-nav> — Blade-Komponenten-Tag für die native untere Navigationsleiste; Props: label-visibility (labeled|selected|unlabeled, Default labeled), dark (erzwingt Dark Mode)
- <native:bottom-nav-item> — Kind-Element (max. 5 pro bottom-nav); Props: id (Pflicht, eindeutig), icon (Pflicht, benanntes Icon gem. Icons-Doku), label (Pflicht, Accessibility-Label), url (Pflicht, WebView-Navigationsziel), active (optional, Default false), badge (optional, Text/Nummer), news (optional, Default false, 'neu'-Punkt)

### Stolperfallen

- Maximal 5 <native:bottom-nav-item>-Elemente pro <native:bottom-nav>
- id, icon, label und url sind Pflicht-Props jedes Items
- URLs, die nicht zur Domain der WebView passen, öffnen sich im Standard-Browser des Geräts statt in der App
- icon erwartet ein 'benanntes Icon' — die gültigen Icon-Namen stehen auf der separaten Doku-Seite 'Icons' (EDGE Components) und müssen dort nachgeschlagen werden
- active ist ein statisches Prop (Default false) — der aktive Tab muss pro Seite/Route serverseitig gesetzt werden (z. B. :active="true" auf der jeweiligen Seite)
- label-visibility kennt nur die Werte labeled, selected, unlabeled
- Die Seite dokumentiert v3 (es existieren auch Versionen 1.x und 2.x mit ggf. abweichender API); keine CLI-Befehle, env-Variablen, nativen Berechtigungen oder Lizenzhinweise auf dieser Seite
- EDGE-Komponenten werden nativ gerendert (iOS und Android, Screenshots beider Plattformen vorhanden) — Styling per Flux UI/Tailwind greift hier nicht, nur die dokumentierten Props (dark, label-visibility)

---

## Side Navigation (EDGE Components) — NativePHP Mobile v3

<https://nativephp.com/docs/mobile/3/edge-components/side-nav>

Die Seite dokumentiert die EDGE-Komponente "Side Navigation" von NativePHP Mobile v3: eine native, ausklappbare Navigationsschublade (Drawer) mit Unterstützung für Header, Gruppen, Einzel-Items und Trennlinien. Die Side-Nav wird deklarativ in Blade über das `native:`-Namespace-Tag `<native:side-nav>` definiert und mit Kind-Komponenten befüllt.

Aufbau und Komponenten:
1) `<native:side-nav>` ist der Wurzel-Container. Props: `gestures-enabled` (Wischen zum Öffnen, Standard `false`, gilt nur für Android — auf iOS sind Gesten immer aktiviert) und optional `dark` (Dunkelmodus erzwingen).
2) `<native:side-nav-header>` rendert einen Kopfbereich der Schublade. Props: `title` (optional), `subtitle` (optional, z. B. E-Mail des Nutzers), `icon` (benanntes Icon, optional), `background-color` (Hex-Code, optional), `show-close-button` (optional, Standard `true`, nur Android), `pinned` (Header bleibt beim Scrollen sichtbar, optional, Standard `false`).
3) `<native:side-nav-item>` ist ein Navigationseintrag. Props: `id` (eindeutige Kennung, erforderlich), `label` (Anzeigetext, erforderlich), `icon` (benanntes Icon, erforderlich; Icon-Namen siehe separate Icons-Doku-Seite), `url` (Navigations-URL, erforderlich), `active` (als aktiv hervorheben, optional, Standard `false`), `badge` (Badge-Text, optional), `badge-color` (Hex-Code oder benannte Farbe, optional), zusätzlich `open-in-browser="true"` für externe Links (im Beispiel verwendet).
4) `<native:side-nav-group>` gruppiert Items unter einer aufklappbaren Überschrift. Props: `heading` (erforderlich), `expanded` (anfangs aufgeklappt, optional, Standard `false`), `icon` (Material Icon, optional).
5) `<native:horizontal-divider>` fügt eine visuelle Trennlinie ein, hat keine Props.

Vollständiges Basis-Beispiel der Seite (Blade):
```blade
<native:side-nav gestures-enabled="true">
    <native:side-nav-header title="My App" subtitle="user@example.com" icon="person" />
    <native:side-nav-item id="home" label="Home" icon="home" url="/home" :active="true" />
    <native:side-nav-group heading="Account" :expanded="false">
        <native:side-nav-item id="profile" label="Profile" icon="person" url="/profile" />
        <native:side-nav-item id="settings" label="Settings" icon="settings" url="/settings" />
    </native:side-nav-group>
    <native:horizontal-divider />
    <native:side-nav-item id="help" label="Help" icon="help" url="https://help.example.com" open-in-browser="true" />
</native:side-nav>
```

Verhalten: URLs außerhalb der Web-View-Domain öffnen sich im Standard-Browser des Geräts (zusätzlich erzwingbar via `open-in-browser`). Boolesche Props können als Blade-Ausdruck gebunden werden (`:active="true"`, `:expanded="false"`).

Die Seite enthält KEINE CLI-Befehle, keine PHP-Facades/Event-Klassen, keine JS-API, keine env-Variablen/config-Keys und keine nativen Berechtigungen — sie ist eine reine deklarative Blade-Komponenten-Referenz. Doku-Navigation: vorherige Seite "Bottom Navigation" (/docs/mobile/3/edge-components/bottom-nav), nächste Seite "Icons" (/docs/mobile/3/edge-components/icons), wo die gültigen Icon-Namen für die `icon`-Props dokumentiert sind.

### APIs

- <native:side-nav> — Blade-Wurzelkomponente der Navigationsschublade; Props: gestures-enabled (bool, Standard false, nur Android), dark (optional, Dunkelmodus erzwingen)
- <native:side-nav-header> — Kopfbereich der Schublade; Props: title (optional), subtitle (optional), icon (optional, benanntes Icon), background-color (Hex, optional), show-close-button (optional, Standard true, nur Android), pinned (optional, Standard false, Header beim Scrollen fixieren)
- <native:side-nav-item> — Navigationseintrag; Props: id (erforderlich, eindeutig), label (erforderlich), icon (erforderlich, benanntes Icon), url (erforderlich), active (optional, Standard false), badge (optional, Text), badge-color (optional, Hex oder benannte Farbe), open-in-browser (öffnet URL im System-Browser, im Beispiel verwendet)
- <native:side-nav-group> — aufklappbare Gruppe von Items; Props: heading (erforderlich), expanded (optional, Standard false), icon (optional, Material Icon)
- <native:horizontal-divider> — visuelle Trennlinie zwischen Elementen, keine Props

### Stolperfallen

- gestures-enabled (Swipe zum Öffnen) wirkt nur auf Android und ist dort standardmäßig false; auf iOS ist die Gestenunterstützung für die Side-Nav immer aktiviert und nicht abschaltbar
- show-close-button im Header gilt nur für Android (Standard true)
- URLs außerhalb der Web-View-Domain werden automatisch im Standard-Browser des Nutzers geöffnet; mit open-in-browser="true" lässt sich das explizit erzwingen (z. B. für Hilfe-/externe Links)
- icon ist bei side-nav-item Pflicht; gültige Icon-Namen stehen auf der separaten Icons-Doku-Seite (/docs/mobile/3/edge-components/icons); Gruppen-Icons sind Material Icons
- Keine programmatische Open/Close-API, keine Events und keine Livewire-Integration auf dieser Seite dokumentiert — die Side-Nav ist rein deklarativ über Blade definiert
- id jedes side-nav-item muss eindeutig sein; active muss selbst gesetzt werden (Standard false), es gibt keine automatische Route-Erkennung laut dieser Seite
- Seite ist Teil der EDGE-Components-Sektion von NativePHP Mobile v3 (kommerzielles Produkt, Lizenz erforderlich für Mobile generell); auf dieser Seite selbst stehen keine expliziten Lizenz- oder Installationshinweise
- Kontext der Doku-Reihenfolge: vorher Bottom Navigation, danach Icons

---

## NativePHP Mobile v3 — EDGE Components: Icons

<https://nativephp.com/docs/mobile/3/edge-components/icons>

Die Seite beschreibt das intelligente Icon-Mapping-System der NativePHP-EDGE-Komponenten (z. B. <native:bottom-nav-item>). Icon-Namen werden automatisch in plattformspezifische Implementierungen übersetzt: auf iOS werden SF Symbols gerendert, auf Android Material Icons. Die Auflösung erfolgt vierstufig: (1) Direkte Plattform-Icons — iOS-Namen mit Punkten (z. B. 'car.side.fill'), Android mit Material-Icon-Ligaturnamen mit Unterstrichen (z. B. 'shopping_cart', 'qr_code_2', 'flashlight_on', 'space_dashboard'); (2) Manuelles Mapping — explizite Zuordnungen für gängige Namen (z. B. 'home' → iOS 'house.fill' / Android 'home', 'settings' → 'gearshape.fill' / 'settings', 'check' → 'checkmark.circle.fill', 'cart' → 'shopping_cart'); (3) Smart Fallback — automatische Konvertierung nicht gemappter Namen in Plattform-Äquivalente; (4) Default Fallback — ein Kreis-Icon, falls nichts passt. Android unterstützt die gesamte Material-Icons-Bibliothek direkt.

Verwendung: Das icon-Attribut der EDGE-Komponente (Beispiel: <native:bottom-nav-item id="home" icon="home" label="Home" url="/home" />). Für plattformspezifische Icons kann zur Laufzeit per Blade unterschieden werden: icon="{{ \Native\Mobile\Facades\System::isIos() ? 'flashlight.on.fill' : 'flashlight_on' }}".

Die Seite enthält eine vollständige Referenz der manuell gemappten Cross-Platform-Aliasnamen, gruppiert nach Kategorien: Navigation (dashboard, home, menu, settings, account/profile/user, person, people/connections/contacts, group/groups), Business & Commerce (orders/receipt, cart/shopping, shop/store, products/inventory), Charts & Daten (chart/barchart, analytics, summary/report/assessment), Zeit (clock/schedule/time, calendar, history), Aktionen (add/plus, edit, delete, save, search, filter, refresh, share, download, upload), Kommunikation (notifications, message, email/mail, chat, phone), Navigationspfeile (back, forward, up, down), Status (check/done, close, warning, error, info), Authentifizierung (login, logout/exit, lock, unlock), Inhalte (favorite/heart, star, bookmark, image/photo, image-plus, video, folder, folder-lock, file/description, book-open, newspaper/news/article), Geräte & Hardware (camera, qr/qrcode/qr-code, device-phone-mobile/smartphone, vibrate, bell, finger-print/fingerprint, light-bulb/lightbulb/flashlight, map/location, globe-alt/globe/web, bolt/flash), Audio & Lautstärke (speaker/speaker-wave, volume-up, volume-down, volume-mute/mute, volume-off, music/audio/music-note, microphone/mic), Sonstiges (help, about/information-circle, more, list, visibility, visibility_off).

Best Practices: Icons konsistent in der gesamten App verwenden; bei automatisch konvertierten Icons auf beiden Plattformen (iOS und Android) testen. Icon-Suche: Android-Material-Icons über Google Fonts Icons (exakte Ligaturnamen mit Unterstrichen); iOS-SF-Symbols über die Community-Figma-Datei oder die SF-Symbols-macOS-App. Die Seite enthält keine CLI-Befehle, keine env-Variablen/Config-Keys und keine nativen Berechtigungen.

### APIs

- \Native\Mobile\Facades\System::isIos() — Facade-Methode zur Laufzeit-Plattformerkennung, z. B. um in Blade plattformspezifische Icon-Namen zu wählen
- <native:bottom-nav-item id="..." icon="..." label="..." url="..." /> — EDGE-Blade-Komponente; das icon-Attribut nutzt das beschriebene Icon-Mapping-System
- Icon-Resolution-Strategie (4 Stufen): 1) direkte Plattform-Icons (iOS SF-Symbol-Namen mit Punkten wie 'car.side.fill', Android Material-Ligaturnamen mit Unterstrichen wie 'qr_code_2'), 2) manuelles Mapping (Aliase wie home, settings, cart), 3) Smart Fallback (Auto-Konvertierung), 4) Default Fallback (Kreis-Icon)

### Stolperfallen

- Icons sind plattformspezifisch gerendert: iOS = SF Symbols, Android = Material Icons — gleiche Alias-Namen ergeben unterschiedliche Glyphen
- Direkte Plattform-Icon-Namen sind nicht portabel: iOS-Namen enthalten Punkte ('flashlight.on.fill'), Android-Namen Unterstriche ('flashlight_on'); für Cross-Platform entweder gemappte Aliase nutzen oder per System::isIos() unterscheiden
- Android unterstützt die komplette Material-Icons-Bibliothek direkt (Ligaturnamen), iOS nur SF-Symbol-Namen
- Unbekannte/nicht auflösbare Icon-Namen fallen auf ein generisches Kreis-Icon zurück — Tippfehler erzeugen keinen Fehler, sondern ein falsches Icon
- Automatisch konvertierte (Smart-Fallback-)Icons sollten auf beiden Plattformen getestet werden, da das Ergebnis abweichen kann
- Icon-Recherche: Android über Google Fonts Icons (exakte Ligaturnamen mit Unterstrichen), iOS über SF-Symbols-macOS-App oder Community-Figma-Datei
- Die Seite dokumentiert keine CLI-Befehle, env-Variablen, Config-Dateien oder nativen Berechtigungen und enthält keine expliziten Lizenzhinweise; EDGE-Komponenten gehören zur NativePHP-Mobile-Doku v3 (Mobile erfordert generell eine NativePHP-Mobile-Lizenz — auf dieser Seite selbst nicht erwähnt)
