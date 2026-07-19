<?php

return [

    /*
    |--------------------------------------------------------------------------
    | X-Accel-Redirect-Prefix
    |--------------------------------------------------------------------------
    |
    | Ist dieser Wert gesetzt, liefert der Bild-Proxy Cache-Hits nicht mehr selbst
    | aus, sondern gibt nginx per `X-Accel-Redirect` nur den Pfad — nginx schickt
    | die Bytes per sendfile und der PHP-FPM-Worker ist sofort wieder frei. Das
    | zahlt sich aus, weil eine Chat-Seite 20–40 Bilder gleichzeitig anfordert.
    |
    | Voraussetzung ist eine passende `internal;`-Location in der nginx-Config,
    | die auf das Cache-Verzeichnis zeigt (Disk `local` = storage/app/private):
    |
    |     location /img-cache-internal/ {
    |         internal;
    |         alias /home/forge/webclient/storage/app/private/;
    |     }
    |
    | Fehlt die Location, antwortet nginx mit 404 — darum ist das Feature opt-in
    | per env und lokal/in Tests standardmäßig aus (PHP liefert dann den Body).
    |
    */

    'x_accel_prefix' => env('IMG_PROXY_X_ACCEL_PREFIX', ''),

];
