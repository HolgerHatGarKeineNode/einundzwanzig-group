<?php

namespace Database\Seeders;

use Illuminate\Database\Console\Seeds\WithoutModelEvents;
use Illuminate\Database\Seeder;

class DatabaseSeeder extends Seeder
{
    use WithoutModelEvents;

    /**
     * Seed the application's database.
     *
     * Bewusst leer: Diese App kennt ausschliesslich Nostr-Logins — es gibt keinen
     * Passwort-Login und keine Registrierung mehr (Fortify ist entfernt). Der
     * frueher hier angelegte `test@example.com`-Nutzer samt Passwort konnte sich
     * nirgends anmelden; er war nur noch irrefuehrend. Die `users`-Tabelle bleibt
     * (Session-Guard/`config/auth.php`), wird von der Anwendung aber nicht befuellt.
     */
    public function run(): void
    {
        //
    }
}
