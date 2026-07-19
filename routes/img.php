<?php

use App\Http\Controllers\ImageProxyController;
use Illuminate\Support\Facades\Route;

/**
 * PLAN4 IMG — Bild-Proxy, bewusst OHNE Middleware-Gruppe registriert.
 *
 * Der Endpunkt ist zustandslos (nur `preset` + `src`), braucht weder Session,
 * Cookie noch CSRF. In der `web`-Gruppe schrieb jeder Bild-Request eine
 * Session-Zeile — auf SQLite serialisiert das ALLE gleichzeitigen Requests
 * (ein Writer). Eine Chat-Seite fordert 20–40 Bilder auf einmal an; gemessen
 * stieg der letzte Cache-Hit dadurch von 0,4 s auf über 5 s TTFB.
 * Ohne Session laufen die Requests wieder echt parallel.
 *
 * `src` bleibt untrusted → SSRF-Schutz sitzt im Controller.
 */
Route::get('/img/{preset}', ImageProxyController::class)->name('img');
