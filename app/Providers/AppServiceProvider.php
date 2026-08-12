<?php

namespace App\Providers;

use Carbon\CarbonImmutable;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Date;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Facades\Vite;
use Illuminate\Support\ServiceProvider;

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
        $this->configureVereinProxyRateLimit();

        // Test-Isolation: Der E2E-Server (eigener Port) zeigt per VITE_HOT_FILE auf
        // einen nicht existierenden Pfad → immer Build-Assets, unabhängig von der
        // globalen `public/hot`, die ein parallel laufendes `composer run dev`
        // schreibt. So können HMR-Dev (8000) und E2E (8137) gleichzeitig laufen.
        if ($hotFile = config('vite.hot_file')) {
            Vite::useHotFile($hotFile);
        }
    }

    /**
     * P4 — Kontingent des Vereins-Proxys (`throttle:verein-proxy`).
     *
     * Zwei Eimer, weil es zwei verschiedene knappe Güter gibt.
     *
     * (1) PRO SESSION-PUBKEY — 10/min. Damit ein einzelner Nutzer nicht das
     *     Kontingent aller anderen verbrennt. Der Wert liegt bewusst DEUTLICH
     *     unter dem Pubkey-Limit des Vereins (30/min, `api-v1`): wer hier
     *     durchfällt, hat noch keine Signatur verloren — ein 429 vom Verein
     *     dagegen verbrennt ein bereits erzeugtes NIP-98-Event, bei NIP-46
     *     inklusive Bunker-Roundtrip und Nutzerbestätigung. Bedarf eines
     *     Onboarding-Durchlaufs: drei Aufrufe in Folge (config, applications,
     *     invoice), danach Polling von höchstens zwei Aufrufen je Runde. 10/min
     *     trägt das mit Reserve; wer P5 baut, bemisst das Polling-Intervall
     *     ohnehin nach den Signaturkosten, nicht nach diesem Wert.
     *
     * (2) INSTANZWEIT — 30/min. Der eigentlich bindende Deckel steht nämlich
     *     nicht bei uns: beim Verein liegt `ThrottleRequests:api` mit
     *     `Limit::perMinute(60)->by($request->ip())` auf der GESAMTEN
     *     api-Gruppe (einundzwanzig-verein bootstrap/app.php:24-26). Alle
     *     Proxy-Aufrufe tragen dieselbe Quell-IP — 60/min gelten also für den
     *     ganzen Proxy, nicht pro Nutzer. Ein reines Pro-Pubkey-Limit schützt
     *     dieses geteilte Gut nicht: drei gleichzeitige Nutzer reichen aus, und
     *     der Verein antwortet dann allen mit 429, auch dem, der gerade zahlt.
     *
     *     Warum 30 und nicht 55: beide Seiten zählen in festen Fenstern, die
     *     nicht synchron laufen. Zwei aufeinanderfolgende volle Fenster von uns
     *     können in EIN Fenster des Vereins fallen — der schlimmste Fall sind
     *     also 2 × unser Wert. 30 ist damit der größte Wert, bei dem der Proxy
     *     den 60er-Deckel des Vereins auch bei ungünstigstem Versatz nicht
     *     reißen kann. Der Rest ist Reserve für alles andere, was künftig von
     *     dieser IP an die api-Gruppe des Vereins geht (z.B. ein Abgleich gegen
     *     `GET /api/members/{year}`) — er läge im selben Eimer.
     *
     * Nicht gedeckelt wird hier das Invoice-Kontingent (3/Tag pro Pubkey). Das
     * hält der Verein selbst, und sein 429 muss unverfälscht durchkommen: ein
     * zweiter Zähler auf demselben Ereignis erzeugt nur eine zweite Wahrheit,
     * die früher oder später von der ersten abweicht.
     */
    protected function configureVereinProxyRateLimit(): void
    {
        RateLimiter::for('verein-proxy', function (Request $request): array {
            $pubkey = $request->session()->get('nostr_pubkey');

            // Der Limiter läuft hinter EnsureNostrSessionPubkey, der Pubkey
            // steht also. Der IP-Rückfall ist nur der Sicherungsknoten für den
            // Fall, dass jemand die Middleware-Reihenfolge umstellt — ohne ihn
            // hätten alle Anonymen denselben leeren Schlüssel und damit einen
            // gemeinsamen Eimer, was wie ein funktionierendes Limit AUSSIEHT.
            $key = is_string($pubkey) && $pubkey !== '' ? $pubkey : (string) $request->ip();

            return [
                Limit::perMinute(10)->by('verein-proxy:pubkey:'.$key),
                Limit::perMinute(30)->by('verein-proxy:instance'),
            ];
        });
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

        // Hier stand `Password::defaults(...)`. Diese Vorgabe wirkt ausschliesslich
        // dort, wo eine Validierungsregel `Password::defaults()` AUFRUFT — mit dem
        // Wegfall von Fortify (Registrierung, Passwort-Reset, Profil-Update) gibt es
        // im ganzen Repo keinen solchen Aufruf mehr, und die App kennt nur noch
        // Nostr-Logins. Eine Vorgabe ohne Verbraucher ersatzlos entfernt.
    }
}
