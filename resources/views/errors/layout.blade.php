{{-- Marken-Fehlerseiten (D5): eigenständige, schlanke Hülle — nur Theme-CSS +
     Brand-Mark, KEINE welshman-Insel/Flux-Runtime (auf einer Fehlerseite unnötig).
     @fluxAppearance wendet das geteilte Theme flackerfrei an; app.css bringt die
     Tokens/Utilities. Rückweg immer zur Startseite. --}}
<!DOCTYPE html>
<html lang="de">
<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <title>@yield('code') · {{ config('app.name') }}</title>
    @vite('resources/css/app.css')
    @fluxAppearance
</head>
<body class="min-h-screen bg-zinc-50 text-zinc-900 antialiased dark:bg-zinc-950 dark:text-zinc-100">
    <main class="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-4 py-10 pt-safe text-center">
        <a href="{{ route('home') }}" aria-label="Startseite" class="pressable">
            <x-group::app-brand-mark class="size-16 shadow-pop" />
        </a>

        <p class="mt-6 font-mono text-6xl font-bold text-brand-500">@yield('code')</p>
        <h1 class="mt-2 text-xl font-semibold">@yield('title')</h1>
        <p class="mt-2 max-w-xs text-muted">@yield('message')</p>

        <a href="{{ route('home') }}"
           class="pressable mt-6 inline-flex items-center gap-2 rounded-tile bg-brand-500 px-4 py-2 font-medium text-white shadow-card">
            Zurück zur Startseite
        </a>
    </main>
</body>
</html>
