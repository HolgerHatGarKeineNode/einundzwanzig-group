<?php

use App\Http\Controllers\NostrAuthController;
use Illuminate\Support\Facades\Route;

Route::view('/', 'home')->name('home');

// M0 — welshman Smoke-Test (temporär, ohne Auth)
Route::view('/nostr-smoke', 'nostr-smoke')->name('nostr-smoke');

// M1 — Nostr-Login (Client-Signer) + NIP-98-Handoff an die Laravel-Session
Route::view('/nostr-login', 'nostr-login')->name('nostr-login');
Route::get('/nostr/challenge', [NostrAuthController::class, 'challenge'])->name('nostr.challenge');
Route::post('/nostr/login', [NostrAuthController::class, 'login'])->name('nostr.login');
Route::post('/nostr/logout', [NostrAuthController::class, 'logout'])->name('nostr.logout');

// Geschützt durch das Nostr-Gate: aktiver Space + Room-Liste (Single-Space, §12)
Route::view('/spaces', 'spaces')->middleware('nostr.auth')->name('spaces');

// M3 — Directory: Mitglieder + Rollen des aktiven Space
Route::view('/directory', 'directory')->middleware('nostr.auth')->name('directory');

// Space-Wechsel — versteckt in den Einstellungen (§12)
Route::view('/settings/space', 'settings.space')->middleware('nostr.auth')->name('space.settings');

Route::middleware(['auth', 'verified'])->group(function () {
    Route::view('dashboard', 'dashboard')->name('dashboard');
});

require __DIR__.'/settings.php';
