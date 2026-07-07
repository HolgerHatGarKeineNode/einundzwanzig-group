<?php

use App\Http\Controllers\NostrAuthController;
use Illuminate\Support\Facades\Route;

Route::view('/', 'welcome')->name('home');

// M0 — welshman Smoke-Test (temporär, ohne Auth)
Route::view('/nostr-smoke', 'nostr-smoke')->name('nostr-smoke');

// M1 — Nostr-Login (Client-Signer) + NIP-98-Handoff an die Laravel-Session
Route::view('/nostr-login', 'nostr-login')->name('nostr-login');
Route::get('/nostr/challenge', [NostrAuthController::class, 'challenge'])->name('nostr.challenge');
Route::post('/nostr/login', [NostrAuthController::class, 'login'])->name('nostr.login');
Route::post('/nostr/logout', [NostrAuthController::class, 'logout'])->name('nostr.logout');

// Geschützt durch das Nostr-Gate (Platzhalter für die Space-Liste, M2)
Route::view('/spaces', 'spaces')->middleware('nostr.auth')->name('spaces');

Route::middleware(['auth', 'verified'])->group(function () {
    Route::view('dashboard', 'dashboard')->name('dashboard');
});

require __DIR__.'/settings.php';
