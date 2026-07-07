<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

// Read-Cache warmhalten (§10/M7): Raum-Metadaten für First-Paint + OG.
Schedule::command('nostr:warm-cache')->everyFiveMinutes()->withoutOverlapping();
