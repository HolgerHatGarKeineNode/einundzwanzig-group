<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="csrf-token" content="{{ csrf_token() }}" />

@php
    $pageTitle = filled($title ?? null) ? $title.' – '.config('app.name') : config('app.name');
    $ogDescription ??= 'Die Bitcoin-Community auf Nostr.';
    // B5: per-Raum/-Space OG-Bild (Raum-picture bzw. Space-icon, proxifiziert)
    // wird von den SFCs via View::share('ogImage') gesetzt; Fallback = Marken-OG.
    $ogImageUrl = filled($ogImage ?? null) ? $ogImage : asset('og.png');
@endphp

<title>{{ $pageTitle }}</title>

{{-- OG/Twitter: marken-/routenweite Previews (per-Raum-Namen brauchen den
     Read-Cache §10/M7 — hier bewusst statisch statt server.js-Cheerio). --}}
<meta name="description" content="{{ $ogDescription }}" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="{{ config('app.name') }}" />
<meta property="og:title" content="{{ $pageTitle }}" />
<meta property="og:description" content="{{ $ogDescription }}" />
<meta property="og:image" content="{{ $ogImageUrl }}" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="{{ $pageTitle }}" />
<meta name="twitter:description" content="{{ $ogDescription }}" />
<meta name="twitter:image" content="{{ $ogImageUrl }}" />

<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">

{{-- Prod-Default-Space: setzt die Vereins-Relay-URL VOR dem welshman-Boot.
     Muss VOR @vite stehen (das ES-Modul-Bundle liest window.__nostrSpace beim Init). --}}
@if (config('group.space_url'))
    {{-- `??`, nicht `=`: ein vorab gesetzter Wert GEWINNT — genau wie beim
         __nostrMobile-Flag darunter. Die E2E-Suite setzt den Space per
         addInitScript, also bevor diese Zeile läuft; eine harte Zuweisung
         überschrieb ihn und schickte die Tests gegen den Relay aus der `.env`.
         Solange NOSTR_SPACE_URL leer war, fiel das nicht auf. --}}
    <script>window.__nostrSpace = window.__nostrSpace ?? @js(config('group.space_url'));</script>
@endif

{{-- Zweiter, fester Space für den Tab „Workspaces" (leer = Tab bleibt aus). Gleiche
     `??`-Regel wie oben, damit die E2E-Suite ihn per addInitScript setzen kann. --}}
@if (config('group.workspace_url'))
    <script>window.__nostrWorkspace = window.__nostrWorkspace ?? @js(config('group.workspace_url'));</script>
@endif

{{-- Quelle der Longform-Artikel (P7). Leer = der Artikel-Screen zeigt seinen
     Leerzustand und fragt keinen Relay. Gleiche `??`-Regel wie oben: ein per
     addInitScript vorbesetzter Wert gewinnt gegen die Konfiguration. --}}
@if (config('group.board_relay_url'))
    <script>window.__nostrBoard = window.__nostrBoard ?? @js(config('group.board_relay_url'));</script>
@endif

{{-- Plattform-Flag: auf dem Gerät gated die Insel client-seitig (kein NIP-98).
     Ein vorab gesetztes Flag gewinnt (E2E via addInitScript, wie __nostrRelays). --}}
<script>window.__nostrMobile = window.__nostrMobile ?? @js((bool) config('nativephp-internal.running'));</script>

{{-- P5 (Onboarding): Vereins-Basis-URL, Proxy-Origin, Wartezeit und die
     öffentliche Ausweichadresse. Die Basis-URL ist KEIN Geheimnis (der
     `X-Api-Key` bleibt im Proxy), muss aber in den Browser: der `u`-Tag des
     NIP-98-Ausweises zielt auf den VEREIN, nicht auf unsere Proxy-Route.
     Leeres `api` = der Flow existiert nicht, das Gate verlinkt nach außen.
     Gleiche `??`-Regel wie oben (E2E setzt den Block per addInitScript). --}}
<script>window.__nostrVerein = window.__nostrVerein ?? @js([
    'api' => (string) config('group.verein_api_url'),
    'proxy' => (string) config('group.verein_proxy_base'),
    'activationMinutes' => (int) config('group.verein_activation_minutes'),
    'publicUrl' => (string) config('group.verein_public_url'),
]);</script>

{{-- P2: Übersetzungskatalog der aktiven Sprache für die Insel (`js/i18n.ts`).
     Muss VOR @vite stehen — siehe Begründung im Partial. --}}
@include('group::partials.i18n')

@vite(['resources/css/app.css', 'resources/js/app.ts'])
@fluxAppearance
