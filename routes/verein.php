<?php

use App\Http\Controllers\VereinProxyController;
use App\Http\Middleware\EnsureNostrSessionPubkey;
use Illuminate\Support\Facades\Route;

/**
 * P4 — Vereins-Proxy. DIESE DATEI IST DIE WHITELIST.
 *
 * Sechs Routen, jede bindet genau eine Methode an genau einen Pfad und mappt auf
 * genau ein Vereins-Ziel. Kein Catch-all, keine Pfad-Übernahme aus dem Request.
 * Damit sind die beiden verbotenen Ziele nicht „gesperrt", sondern nicht
 * vorhanden:
 *
 *   DELETE /api/verein/me      → 405 (Laravel kennt den Pfad, nicht die Methode)
 *   GET    /api/verein/export  → 404 (den Pfad gibt es nicht)
 *
 * Das ist der Grund für die Bauform. `DELETE /me` ist beim Verein die
 * unwiderrufliche revDSG-Löschung, `GET /export` der vollständige
 * Personendatenexport; beide unterscheiden sich von einem ERLAUBTEN Ziel allein
 * durch die HTTP-Methode bzw. ein Pfadsegment. Eine Verbotsliste müsste diesen
 * Unterschied jedes Mal richtig treffen, eine Erlaubnisliste muss ihn nie
 * treffen.
 *
 * Registriert wird die Datei in bootstrap/app.php — unter `api/verein` (damit
 * `shouldRenderJsonWhen` greift), in der `web`-Gruppe (Session) und NUR, wenn
 * die App nicht im NativePHP-Lauf ist.
 *
 * CSRF: die Gruppe `web` bringt `ValidateCsrfToken` mit, und das bleibt so. Die
 * fünf NIP-98-Endpunkte trügen ihren eigenen Schutz (eine fremde Seite bekommt
 * keine gültige Signatur des Session-Pubkeys), `POST` ohne CSRF wäre für die
 * beiden Zustandsänderer trotzdem eine unnötig offene Flanke. Für P5 heißt das:
 * die `fetch()`-Aufrufe der Insel brauchen den `X-CSRF-TOKEN`-Header.
 */
Route::middleware([EnsureNostrSessionPubkey::class, 'throttle:verein-proxy'])
    ->name('verein.')
    ->group(function (): void {
        Route::get('/config', [VereinProxyController::class, 'config'])->name('config');
        Route::post('/applications', [VereinProxyController::class, 'storeApplication'])->name('applications');
        Route::get('/me', [VereinProxyController::class, 'me'])->name('me');
        Route::get('/payments', [VereinProxyController::class, 'payments'])->name('payments');

        // `{year}` ist der EINZIGE variable Anteil einer Ziel-URL im Proxy und
        // hier auf vier Ziffern beschränkt — Müll erreicht den Controller gar
        // nicht erst. Dieselbe Beschränkung steht dort noch einmal, siehe
        // VereinProxyController::paymentsPath().
        Route::post('/payments/{year}/invoice', [VereinProxyController::class, 'invoice'])
            ->where('year', '[0-9]{4}')
            ->name('payments.invoice');

        Route::post('/payments/{year}/refresh', [VereinProxyController::class, 'refresh'])
            ->where('year', '[0-9]{4}')
            ->name('payments.refresh');
    });
