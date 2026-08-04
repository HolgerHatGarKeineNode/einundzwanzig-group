<?php

return [

    /*
     * Test-Isolation: Der E2E-Server (eigener Port) zeigt per VITE_HOT_FILE auf
     * einen nicht existierenden Pfad → immer Build-Assets, unabhängig von der
     * globalen `public/hot`, die ein parallel laufendes `composer run dev`
     * schreibt. So können HMR-Dev (8000) und E2E (8137) gleichzeitig laufen.
     * Siehe App\Providers\AppServiceProvider::boot().
     *
     * `env()` kann für Literale wie "true"/"false"/"null" einen bool/null statt
     * eines Strings liefern — is_string() erzwingt hier absichtlich ?string,
     * damit ein versehentliches `VITE_HOT_FILE=true` in der .env still zu
     * "nicht gesetzt" wird statt einen falschen Pfad an Vite zu reichen.
     */
    'hot_file' => is_string($hotFile = env('VITE_HOT_FILE')) && $hotFile !== '' ? $hotFile : null,

];
