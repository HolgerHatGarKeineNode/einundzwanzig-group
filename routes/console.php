<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;
use Illuminate\Support\Facades\Storage;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

// Bild-Proxy-Cache komplett leeren (z.B. nach geänderten Encode-Parametern).
Artisan::command('img:clear-cache', function () {
    Storage::disk('local')->deleteDirectory('img-cache');
    $this->info('Bild-Proxy-Cache geleert.');
})->purpose('Leert den Bild-Proxy-Cache (storage/app/private/img-cache)');

// PLAN4 IMG — Bild-Cache beschneiden: Dateien > 30 Tage raus (bounded Disk).
Schedule::call(function () {
    $disk = Storage::disk('local');
    $cutoff = now()->subDays(30)->timestamp;
    foreach ($disk->allFiles('img-cache') as $file) {
        if ($disk->lastModified($file) < $cutoff) {
            $disk->delete($file);
        }
    }
})->weekly()->name('img-cache-prune');

// Der `nostr:warm-cache`-Schedule (§10/M7) wird vom einundzwanzig/group-Package registriert.

// Meetup-Raum-Sync: neu vereinsmitglied-gegatete Meetups bekommen automatisch
// ihren privaten NIP-29-Raum auf dem Prod-zooid (idempotent, legt nur Fehlendes an).
// Bricht bei kaputter Gate-API/fehlendem Setup mit exit!=0 ab — Scheduler-Log zeigt das.
Schedule::exec('bash '.base_path('scripts/sync-meetup-rooms.sh'))
    ->dailyAt('04:17')
    ->name('sync-meetup-rooms')
    ->withoutOverlapping()
    ->appendOutputTo(storage_path('logs/sync-meetup-rooms.log'));
