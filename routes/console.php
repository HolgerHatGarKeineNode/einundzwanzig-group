<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

// Der `nostr:warm-cache`-Schedule (§10/M7) wird vom einundzwanzig/group-Package registriert.
