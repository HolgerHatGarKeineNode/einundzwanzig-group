<?php

use Illuminate\Support\Facades\Route;

Route::view('/', 'welcome')->name('home');

// M0 — welshman Smoke-Test (temporär, ohne Auth)
Route::view('/nostr-smoke', 'nostr-smoke')->name('nostr-smoke');

// M1 — Nostr-Login (Client-Signer, temporär)
Route::view('/nostr-login', 'nostr-login')->name('nostr-login');

Route::middleware(['auth', 'verified'])->group(function () {
    Route::view('dashboard', 'dashboard')->name('dashboard');
});

require __DIR__.'/settings.php';
