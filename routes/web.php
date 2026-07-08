<?php

use Illuminate\Support\Facades\Route;

Route::livewire('/', 'pages::home')->name('home');

// M0 — welshman Smoke-Test (Debug). Nur lokal — nicht öffentlich/indexierbar (D5).
if (app()->environment('local')) {
    Route::livewire('/nostr-smoke', 'pages::nostr-smoke')->name('nostr-smoke');
}

// Group-Kern (Login, Spaces, Räume, Directory, Join, Space-Einstellungen) liefert
// das einundzwanzig/group-Package unter dem `group.`-Namen (routes/group.php).

Route::middleware(['auth', 'verified'])->group(function () {
    Route::view('dashboard', 'dashboard')->name('dashboard');
});

require __DIR__.'/settings.php';
