<?php

use App\Http\Controllers\ProfileController;
use Illuminate\Support\Facades\Route;

Route::livewire('/', 'pages::home')->name('home');

// PLAN4 IMG — Bild-Proxy liegt bewusst session-frei in routes/img.php
// (in bootstrap/app.php ohne Middleware-Gruppe registriert).

// PLAN4 — geteilter Profil-Cache (kind 0) für flicker-armen First-Paint der Insel.
// Öffentlich (kind 0 ist public); Mobile ruft den gehosteten Endpunkt (Hybrid).
Route::get('/nostr/profiles', ProfileController::class)->name('profiles');

// M0 — welshman Smoke-Test (Debug). Nur lokal — nicht öffentlich/indexierbar (D5).
if (app()->environment('local')) {
    Route::livewire('/nostr-smoke', 'pages::nostr-smoke')->name('nostr-smoke');
}

// Group-Kern (Login, Spaces, Räume, Directory, Join, Space-Einstellungen) liefert
// das einundzwanzig/group-Package unter dem `group.`-Namen (routes/group.php).
