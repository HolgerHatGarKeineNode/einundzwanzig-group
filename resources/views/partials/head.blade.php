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
    <script>window.__nostrSpace = @js(config('group.space_url'));</script>
@endif

{{-- Plattform-Flag: auf dem Gerät gated die Insel client-seitig (kein NIP-98).
     Ein vorab gesetztes Flag gewinnt (E2E via addInitScript, wie __nostrRelays). --}}
<script>window.__nostrMobile = window.__nostrMobile ?? @js((bool) config('nativephp-internal.running'));</script>

@vite(['resources/css/app.css', 'resources/js/app.ts'])
@fluxAppearance
