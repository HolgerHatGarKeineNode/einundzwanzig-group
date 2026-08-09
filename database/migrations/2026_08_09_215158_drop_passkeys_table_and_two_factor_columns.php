<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Entfernt die letzten Schema-Reste der Passwort-/WebAuthn-Authentifizierung.
 *
 * Diese App kennt ausschliesslich Nostr-Logins; Laravel Fortify und die
 * Passkey-Unterstuetzung sind samt Routen, Actions, Views und Tests entfernt.
 * Uebrig blieben die `passkeys`-Tabelle und die drei `two_factor_*`-Spalten
 * auf `users` — beide ohne jeden Verbraucher im Code.
 *
 * WARUM EINE NEUE MIGRATION statt die alten Dateien zu loeschen: die alten
 * Migrationen sind auf Produktion bereits gelaufen. Wer sie loescht, laesst
 * Prod mit Tabelle und Spalten zurueck, waehrend eine frische Installation sie
 * nie anlegt — die beiden Staende laufen still auseinander. Diese Migration
 * fasst beides an genau einer Stelle an und laeuft auf beiden Staenden gleich.
 *
 * IDEMPOTENT: jede Aenderung ist per `Schema::hasTable()`/`Schema::hasColumn()`
 * abgesichert. Auf einer frischen Installation, auf der die alten Migrationen
 * unmittelbar davor gelaufen sind, ist alles vorhanden; auf einem Stand, auf
 * dem jemand die Reste schon von Hand entfernt hat, passiert schlicht nichts.
 *
 * SPALTEN EINZELN: die drei `two_factor_*`-Spalten werden in DREI getrennten
 * `Schema::table()`-Aufrufen gedroppt statt in einem `dropColumn([...])`.
 * Auf SQLite < 3.35 gibt es kein `ALTER TABLE ... DROP COLUMN`; Laravel faellt
 * dort auf einen Tabellen-Neuaufbau zurueck (SQLiteGrammar::compileDropColumn
 * gibt fuer aeltere Versionen `null` zurueck), und ein Mehrfach-Drop in einem
 * Aufruf war historisch genau dort fehleranfaellig. Einzelaufrufe erzeugen auf
 * jeder Engine (SQLite wie MySQL/MariaDB) je ein eigenstaendiges, per
 * `hasColumn()` gepruefte Statement — und sind zugleich pro Spalte idempotent.
 */
return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::dropIfExists('passkeys');

        foreach (['two_factor_confirmed_at', 'two_factor_recovery_codes', 'two_factor_secret'] as $column) {
            if (Schema::hasTable('users') && Schema::hasColumn('users', $column)) {
                Schema::table('users', function (Blueprint $table) use ($column) {
                    $table->dropColumn($column);
                });
            }
        }
    }

    /**
     * Reverse the migrations.
     *
     * Stellt den Stand von `2024_01_01_000000_create_passkeys_table` und
     * `2025_08_14_170933_add_two_factor_columns_to_users_table` wieder her.
     * `after()` wird von der SQLite-Grammatik ignoriert (kein `After`-Modifier)
     * und ist dort folgenlos; auf MySQL stellt es die urspruengliche
     * Spaltenreihenfolge wieder her.
     */
    public function down(): void
    {
        if (Schema::hasTable('users')) {
            if (! Schema::hasColumn('users', 'two_factor_secret')) {
                Schema::table('users', function (Blueprint $table) {
                    $table->text('two_factor_secret')->after('password')->nullable();
                });
            }

            if (! Schema::hasColumn('users', 'two_factor_recovery_codes')) {
                Schema::table('users', function (Blueprint $table) {
                    $table->text('two_factor_recovery_codes')->after('two_factor_secret')->nullable();
                });
            }

            if (! Schema::hasColumn('users', 'two_factor_confirmed_at')) {
                Schema::table('users', function (Blueprint $table) {
                    $table->timestamp('two_factor_confirmed_at')->after('two_factor_recovery_codes')->nullable();
                });
            }
        }

        if (! Schema::hasTable('passkeys')) {
            Schema::create('passkeys', function (Blueprint $table) {
                $table->id();
                $table->foreignId('user_id')->constrained()->cascadeOnDelete();
                $table->string('name');
                $table->string('credential_id')->unique();
                $table->json('credential');
                $table->timestamp('last_used_at')->nullable();
                $table->timestamps();

                $table->index('user_id');
            });
        }
    }
};
