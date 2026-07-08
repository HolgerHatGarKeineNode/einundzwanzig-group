<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;
use Illuminate\Support\Facades\Storage;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

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
