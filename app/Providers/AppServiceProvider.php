<?php

namespace App\Providers;

use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Date;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Vite;
use Illuminate\Support\ServiceProvider;
use Illuminate\Validation\Rules\Password;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        // Diese App kennt ausschliesslich Nostr-Logins (NIP-07/NIP-46/NIP-55/nsec);
        // der Schluessel bleibt im Browser. Laravel Fortify ist deshalb samt
        // Abhaengigkeit entfernt — hier stand zuvor `Fortify::ignoreRoutes()`, weil
        // `config/fortify.php` allein nicht genuegte: `login` (POST), `logout` (POST)
        // und `password.confirm` standen in Fortifys Routendatei AUSSERHALB jedes
        // `Features::enabled()`-Guards. Mit dem Paket faellt das ersatzlos weg.
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        $this->configureDefaults();

        // Test-Isolation: Der E2E-Server (eigener Port) zeigt per VITE_HOT_FILE auf
        // einen nicht existierenden Pfad → immer Build-Assets, unabhängig von der
        // globalen `public/hot`, die ein parallel laufendes `composer run dev`
        // schreibt. So können HMR-Dev (8000) und E2E (8137) gleichzeitig laufen.
        if ($hotFile = config('vite.hot_file')) {
            Vite::useHotFile($hotFile);
        }
    }

    /**
     * Configure default behaviors for production-ready applications.
     */
    protected function configureDefaults(): void
    {
        Date::use(CarbonImmutable::class);

        DB::prohibitDestructiveCommands(
            app()->isProduction(),
        );

        Password::defaults(fn (): ?Password => app()->isProduction()
            ? Password::min(12)
                ->mixedCase()
                ->letters()
                ->numbers()
                ->symbols()
                ->uncompromised()
            : null,
        );
    }
}
