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
        //
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
        if ($hotFile = env('VITE_HOT_FILE')) {
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
