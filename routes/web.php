<?php

use Illuminate\Support\Facades\Route;

Route::livewire('/', 'pages::home')->name('home');

// M0 — welshman Smoke-Test (Debug). Nur lokal — nicht öffentlich/indexierbar (D5).
if (app()->environment('local')) {
    Route::livewire('/nostr-smoke', 'pages::nostr-smoke')->name('nostr-smoke');
}

// Chat-Kern (Login, Spaces, Räume, Directory, Join, Space-Einstellungen) liefert
// das einundzwanzig/nostr-chat-Package unter dem `chat.`-Namen (routes/group.php).

Route::middleware(['auth', 'verified'])->group(function () {
    Route::view('dashboard', 'dashboard')->name('dashboard');
});

require __DIR__.'/settings.php';
