<?php

use Einundzwanzig\Group\Http\Middleware\SetLocale;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
        then: function (): void {
            // Bild-Proxy ohne jede Middleware-Gruppe — siehe routes/img.php.
            Route::middleware([])->group(__DIR__.'/../routes/img.php');
        },
    )
    // Nostr-Gate (`nostr.auth`) + CSP kommen aus dem einundzwanzig/group-Package
    // (Route-Middleware bzw. Route-Gruppe); hier hängt nur, was JEDEN Web-Request
    // betrifft.
    ->withMiddleware(function (Middleware $middleware): void {
        // P2 — Sprache pro Request auflösen (Cookie → Session → Accept-Language → de).
        // In der `web`-Gruppe und ANGEHÄNGT, damit die Session bereits gestartet ist
        // (StartSession steht in derselben Gruppe weiter vorn). Die Package-Routen
        // ziehen `web` explizit mit, erben das also ebenso wie die Livewire-Update-
        // Route — ohne sie stünde jede Livewire-Neuberechnung wieder auf Deutsch.
        $middleware->web(append: [SetLocale::class]);

        // Das Sprach-Cookie bleibt im Klartext. Verschlüsselt hinge es am APP_KEY;
        // ein Key-Wechsel (neuer NativePHP-Build, neu aufgesetzter Server) setzte
        // die Sprachwahl aller Nutzer still zurück. Es trägt keine Geheimnisse, und
        // ein manipulierter Wert fällt in SetLocale durch die Whitelist.
        $middleware->encryptCookies(except: [SetLocale::COOKIE]);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->shouldRenderJsonWhen(
            fn (Request $request) => $request->is('api/*') || $request->expectsJson(),
        );
    })->create();
