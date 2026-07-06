<?php

use Illuminate\Support\Facades\Route;

Route::view('/', 'welcome')->name('home');

// M0 — welshman Smoke-Test (temporär, ohne Auth)
Route::view('/nostr-smoke', 'nostr-smoke')->name('nostr-smoke');

Route::middleware(['auth', 'verified'])->group(function () {
    Route::view('dashboard', 'dashboard')->name('dashboard');
});

require __DIR__.'/settings.php';
