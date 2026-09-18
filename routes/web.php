<?php

use App\Http\Controllers\ProfileController;
use Einundzwanzig\Group\Http\Controllers\LegacyRedirect;
use Illuminate\Support\Facades\Route;

/*
 * Die Wurzel führt auf Start (Konzept C, P2).
 *
 * Hier stand die Landing-Seite (`pages::home`) — Logomark, Wortmarke und je ein Knopf
 * für angemeldet/abgemeldet. Start beantwortet beides besser und für beide Zustände in
 * derselben Fläche: ein Gast sieht dort die Einladung UND die öffentlichen Bereiche,
 * ein Mitglied sein Postfach. Eine Zwischenseite, deren einziger Inhalt ein Knopf
 * „weiter" ist, ist ein Klick ohne Auskunft.
 *
 * Der Route-NAME bleibt `home`: er steht in den Fehlerseiten (`errors.404` …) und in
 * geteilten Links. `LegacyRedirect` statt `Route::redirect()`, damit ALLE
 * Weiterleitungen dieses Umbaus über einen Weg laufen — den, der in P7 auf 301 gestellt
 * wird. Der Query-String wird hier bewusst NICHT mitgenommen: die Wurzel trägt keinen
 * Parameter, den Start läse, und der Controller kopiert nur, was eine Zeile ausdrücklich
 * nennt (`behalte`/`umbenenne`). Ein Controller statt einer Closure, weil der
 * Mobile-Build seine Routen cacht.
 *
 * Seit dem Sweep in P7: 301 (vorher 302).
 */
Route::get('/', LegacyRedirect::class)
    ->defaults('ziel', '/start')
    ->name('home');

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
