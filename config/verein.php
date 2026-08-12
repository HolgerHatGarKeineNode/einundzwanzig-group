<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Basis-URL der Vereins-API
    |--------------------------------------------------------------------------
    |
    | Origin der Vereins-Instanz OHNE Pfad und OHNE Schrägstrich am Ende, z.B.
    | `https://verein.einundzwanzig.space`. Der Proxy hängt daran ausschließlich
    | fest verdrahtete Pfade (`/api/v1/membership/...`), nie etwas aus dem
    | eingehenden Request.
    |
    | ZEICHENGENAU: Der Verein prüft den `u`-Tag des NIP-98-Events per
    | hash_equals gegen `origin(config('app.url'))` SEINER Instanz plus
    | `getRequestUri()` (einundzwanzig-verein, app/Support/Nip98.php:209-249).
    | Dieser Wert muss also byteweise dem `APP_URL`-Origin des Vereins
    | entsprechen — anderes Schema, ein zusätzlicher Port, ein `www.` davor oder
    | ein Schrägstrich am Ende ergeben eine andere Zeichenkette, und dann
    | scheitert JEDER der fünf NIP-98-pflichtigen Aufrufe mit 401, obwohl Key
    | und Signatur stimmen. Der Proxy prüft den `u`-Tag vorab gegen exakt die
    | URL, die er gleich aufruft — ein Fehler hier fällt deshalb schon hier auf
    | und nicht erst beim Verein.
    |
    | Leer = fail closed: der Proxy antwortet 503 und ruft nichts auf.
    |
    */

    'base_url' => env('VEREIN_API_URL', ''),

    /*
    |--------------------------------------------------------------------------
    | Client-Schlüssel der Vereins-API (X-Api-Key)
    |--------------------------------------------------------------------------
    |
    | Das Geheimnis, das den Proxy überhaupt erst nötig macht: der Browser darf
    | ihn nie sehen. Er wird ausschließlich serverseitig gesetzt (siehe
    | VereinProxyController::forward()); ein vom Aufrufer mitgeschickter
    | `X-Api-Key`-Header wird verworfen, nicht durchgereicht.
    |
    | NICHT `VEREIN_GATE_TOKEN` — das ist der Bearer-Token einer ANDEREN API
    | (portal.einundzwanzig.space, gelesen von scripts/sync-meetup-rooms.sh).
    |
    | Leer = fail closed (503). Bewusst kein Default und kein Wert in
    | `.env.example`: ein Proxy, der ohne Konfiguration „irgendwie" läuft, ist
    | genau der Zustand, in dem niemand merkt, dass der Schlüssel fehlt.
    |
    */

    'api_key' => env('VEREIN_API_KEY', ''),

];
