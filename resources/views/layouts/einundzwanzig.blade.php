{{--
    Gemeinsames Layout der EINUNDZWANZIG-Seiten (Livewire-Full-Page-SFCs).
    Die welshman-Insel wird EINMAL im <head> geladen (@vite in partials/head) und
    überlebt so `wire:navigate` (Body-Swap, Head bleibt) → das welshman-Repository,
    offene Subscriptions und optimistischer State bleiben zwischen Seiten warm.
    Die Seiten liefern nur ihren Rumpf (Alpine-Inseln via x-data); Hülle + Scripts
    liegen hier. Dark-Only wie bisher.
--}}
<!DOCTYPE html>
<html lang="de" class="dark" data-theme="dark">
<head>
    @include('partials.head')
</head>
<body class="min-h-screen bg-zinc-50 text-zinc-900 antialiased dark:bg-zinc-950 dark:text-zinc-100">
    {{ $slot }}
    @fluxScripts
</body>
</html>
