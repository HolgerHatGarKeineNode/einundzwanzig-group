<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="csrf-token" content="{{ csrf_token() }}" />

@php
    $pageTitle = filled($title ?? null) ? $title.' – '.config('app.name') : config('app.name');
    $ogDescription = $ogDescription ?? 'Vereins-Chat auf Nostr.';
@endphp

<title>{{ $pageTitle }}</title>

{{-- OG/Twitter: marken-/routenweite Previews (per-Raum-Namen brauchen den
     Read-Cache §10/M7 — hier bewusst statisch statt server.js-Cheerio). --}}
<meta name="description" content="{{ $ogDescription }}" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="{{ config('app.name') }}" />
<meta property="og:title" content="{{ $pageTitle }}" />
<meta property="og:description" content="{{ $ogDescription }}" />
<meta property="og:image" content="{{ asset('apple-touch-icon.png') }}" />
<meta name="twitter:card" content="summary" />
<meta name="twitter:title" content="{{ $pageTitle }}" />
<meta name="twitter:description" content="{{ $ogDescription }}" />
<meta name="twitter:image" content="{{ asset('apple-touch-icon.png') }}" />

<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">

{{-- Prod-Default-Space: setzt die Vereins-Relay-URL VOR dem welshman-Boot.
     Muss VOR @vite stehen (das ES-Modul-Bundle liest window.__nostrSpace beim Init). --}}
@if (config('nostr.space_url'))
    <script>window.__nostrSpace = @js(config('nostr.space_url'));</script>
@endif

@vite(['resources/css/app.css', 'resources/js/app.ts'])
@fluxAppearance
