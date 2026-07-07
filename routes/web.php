<?php

use Illuminate\Support\Facades\Route;

Route::livewire('/', 'pages::home')->name('home');

// M0 — welshman Smoke-Test (temporär, ohne Auth). Web-only, bleibt hier.
Route::livewire('/nostr-smoke', 'pages::nostr-smoke')->name('nostr-smoke');

// Chat-Kern (Login, Spaces, Räume, Directory, Join, Space-Einstellungen) liefert
// das einundzwanzig/nostr-chat-Package unter dem `chat.`-Namen (routes/chat.php).

Route::middleware(['auth', 'verified'])->group(function () {
    Route::view('dashboard', 'dashboard')->name('dashboard');
});

require __DIR__.'/settings.php';
