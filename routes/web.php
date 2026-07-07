<?php

use App\Http\Controllers\NostrAuthController;
use Illuminate\Support\Facades\Route;

Route::livewire('/', 'pages::home')->name('home');

// M0 — welshman Smoke-Test (temporär, ohne Auth)
Route::livewire('/nostr-smoke', 'pages::nostr-smoke')->name('nostr-smoke');

// M1 — Nostr-Login (Client-Signer) + NIP-98-Handoff an die Laravel-Session
Route::livewire('/nostr-login', 'pages::nostr-login')->name('nostr-login');
Route::get('/nostr/challenge', [NostrAuthController::class, 'challenge'])->name('nostr.challenge');
Route::post('/nostr/login', [NostrAuthController::class, 'login'])->name('nostr.login');
Route::post('/nostr/logout', [NostrAuthController::class, 'logout'])->name('nostr.logout');

// Geschützt durch das Nostr-Gate: aktiver Space + Raum-Liste (Single-Space, §12)
Route::livewire('/spaces', 'pages::spaces')->middleware('nostr.auth')->name('spaces');

// M3 — Directory: Mitglieder + Rollen des aktiven Space
Route::livewire('/directory', 'pages::directory')->middleware('nostr.auth')->name('directory');

// M4/M5 — Raum-Chat (lesen + senden): Verlauf eines Raums im aktiven Space
Route::livewire('/rooms/{h}', 'pages::room')->middleware('nostr.auth')->name('room');

// Space-Wechsel — versteckt in den Einstellungen (§12)
Route::livewire('/settings/space', 'pages::settings.space')->middleware('nostr.auth')->name('space.settings');

Route::middleware(['auth', 'verified'])->group(function () {
    Route::view('dashboard', 'dashboard')->name('dashboard');
});

require __DIR__.'/settings.php';
