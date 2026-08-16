<?php

use App\Http\Controllers\VereinAppProxyController;
use Illuminate\Support\Facades\Route;

/*
 * P8 — App-Proxy des Vereins-Beitritts, DIESE DATEI IST DIE WHITELIST.
 *
 * Drei Routen, jede bindet genau eine Methode an genau einen Pfad und mappt
 * auf genau ein Vereins-Ziel des App-Zweigs (`/api/v1/app/membership/...`).
 * Bauform und Begründung wie routes/verein.php — derselbe Schutz gegen
 * Pfad-Übernahme, ergänzt um den Unterschied, der den App-Zweig trägt:
 * KEINE Session, KEIN NIP-98 (siehe VereinAppProxyController).
 *
 * Registriert in bootstrap/app.php — unter `api/app/verein` (JSON-Fehler über
 * den shouldRenderJsonWhen-Hook), in der `api`-Gruppe (keine Session, kein
 * CSRF — der Aufrufer ist die native App, kein Browser unserer Instanz) und
 * NUR, wenn die App nicht im NativePHP-Lauf ist (der Mobile-Build trägt
 * weder Schlüssel noch Proxy).
 */
Route::middleware('throttle:verein-app-proxy')
    ->name('verein-app.')
    ->group(function (): void {
        Route::get('/config', [VereinAppProxyController::class, 'config'])->name('config');
        Route::post('/applications', [VereinAppProxyController::class, 'storeApplication'])->name('applications');
        Route::post('/payments/{year}/invoice', [VereinAppProxyController::class, 'invoice'])
            ->where('year', '[0-9]{4}')
            ->name('payments.invoice');
    });
