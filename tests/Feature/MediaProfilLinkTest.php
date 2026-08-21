<?php

declare(strict_types=1);

use Illuminate\Testing\TestResponse;
use Symfony\Component\HttpFoundation\Response;

/**
 * Die Profil-Querverlinkung nach `media.einundzwanzig.space` — **was der Server
 * entscheidet.**
 *
 * Vier Dinge, keines davon braucht einen Browser:
 *
 *  1. **Der Default-Wert der neuen Konstante, als LITERAL — und zwar aus dem
 *     QUELLTEXT.** Ein Vergleich gegen `config('group.media_public_url')` wäre gleich
 *     zweimal falsch: das Symbol gegen sich selbst (in P4 lief genau diese Klasse bei
 *     1324/1324 grün durch — `NIP05_WURZEL = '_'` wurde zu `'root'`, kein Test sah es),
 *     UND an die `.env` des jeweiligen Rechners gekoppelt. Der zweite Fehler stand hier
 *     tatsächlich und wurde im Gate gefunden; die Begründung steht bei Abschnitt 1.
 *  2. **`.env.example` warnt vor dem unquotierten `#`.** Der Default ist der Klarpfad und
 *     braucht keine Anführungszeichen — der dort angebotene Rückweg auf die Hash-Route
 *     aber schon: phpdotenv schneidet ein unquotiertes `#` samt Rest ab, und weil media.
 *     beide Formen beantwortet, fiele der Rückfall niemandem auf.
 *  3. **BEIDE head-Partials tragen die Zeile.** Derselbe Fehler wie in P6, dort teuer
 *     bezahlt: stand die Zeile nur im Paket-Partial, tat das Feature im normalen
 *     Web-Betrieb still gar nichts.
 *  4. **Leer heißt kein Verweis** — und zwar server-seitig, nicht bloß per `x-show`.
 *
 * **Warum diese Datei im HOST liegt und nicht im Paket:** `packages/einundzwanzig-group`
 * bringt kein Test-Harness mit (kein `tests/`, kein eigenes phpunit.xml). Jeder
 * Pest-Feature-Test des Pakets steht deshalb hier — Präzedenzfälle aus derselben
 * Nachbarschaft: `tests/Feature/ArticleAuthorRouteTest.php`,
 * `tests/Feature/ArticleMetricRelaysTest.php`.
 *
 * Eigene `medienFakeSessionPubkey()` statt einer geteilten: Pest garantiert keine feste
 * Lade-/Namensraum-Reihenfolge zwischen Testdateien (gleiche Begründung wie dort).
 *
 * ── Mutationsproben (von Hand gefahren, 2026-08-21, jede per `sha256sum` zurückgebaut,
 *    `php artisan view:clear` nach jedem Blade-Rückbau) ─────────────────────────────
 *
 * | Mutation                                                              | gemessen         |
 * |------------------------------------------------------------------------|------------------|
 * | `config/group.php`: Default → `…/#` (Hash-Route)                        | **rot**, 1 Fall  |
 * | `config/group.php`: `env(k, default)` → `env(k) ?: default`             | **rot**, 1 Fall  |
 * | `.env.example`: Wert bekommt ein unquotiertes `#`                       | **rot**, 1 Fall  |
 * | `.env.example`: die quotierte Musterzeile der Warnung gestrichen        | **rot**, 1 Fall  |
 * | `.env.example`: Warnwort `ANFUEHRUNGSZEICHEN` ersetzt                   | **rot**, 1 Fall  |
 * | Host-`partials/head.blade.php`: die `__nostrMedia`-Zeile gestrichen     | **rot**, 2 Fälle |
 * | Paket-`partials/head.blade.php`: die `__nostrMedia`-Zeile gestrichen    | **rot**, 1 Fall  |
 * | `profile-card.blade.php`: `@if (config('group.media_public_url'))` weg  | **rot**, 1 Fall  |
 * | `⚡article-author.blade.php`: dasselbe `@if` weg                         | **rot**, 1 Fall  |
 * | `⚡article-author.blade.php`: Anker → `data-medien-profilx="autor"`      | **rot**, 1 Fall  |
 * | `⚡article-author.blade.php`: Anker → `data-medien-profil="karte"`       | **rot**, 1 Fall  |
 *
 * **Die vorletzte Probe war beim ersten Anlauf GRÜN** — der Anker hieß auf beiden Flächen
 * gleich, und die Autorenseite rendert über `app-frame` die Profilkarte mit. Der Test sah
 * also den fremden Anker und meldete „gefunden", während der eigene weg war. Seitdem trägt
 * er einen Wert je Fläche, und die letzte Probe hält genau das fest.
 *
 * ── Und drei Läufe, die KEINE Mutation sind ──────────────────────────────────────
 *
 * Der Blocker aus dem Gate war eine Kopplung an die `.env` des Rechners, also kein
 * Fehler, den eine Mutation im Quelltext findet. Der Nachweis der Korrektur ist deshalb
 * ein Lauf je Zustand, den diese Konfiguration ausdrücklich anbietet (2026-08-21,
 * je 8/8 grün): `MEDIA_PUBLIC_URL=` (Abschaltung) · `…/#` (der angebotene Rückweg) ·
 * `https://beispiel.test/x` (fremder Host).
 *
 * **Mit Positivkontrolle**, sonst wäre es keine Messung: dass die Shell-Variable
 * überhaupt bis in `config()` durchgreift, ist einzeln nachgesehen — alle vier Zustände
 * (drei gesetzte plus „gar nicht gesetzt" → Default) kamen unterscheidbar an. Ohne diese
 * Kontrolle hätten drei identische grüne Läufe genauso ausgesehen.
 */

/** Beliebiger 64-hex-Pubkey für eine „angemeldete" Session (Server-Gate, kein Signer). */
function medienFakeSessionPubkey(): string
{
    return str_repeat('c', 64);
}

/**
 * @param  TestResponse<Response>  $res
 */
function medienHtml(TestResponse $res): string
{
    $content = $res->getContent();

    if ($content === false) {
        throw new RuntimeException('Response::getContent() lieferte false — die Antwort hat keinen Body.');
    }

    return $content;
}

/** Quelltext einer Datei relativ zur Anwendungswurzel — **werfend**, wenn leer oder weg. */
function medienQuelle(string $relativ): string
{
    $pfad = base_path($relativ);

    if (! is_file($pfad)) {
        throw new RuntimeException("{$relativ} gibt es nicht mehr — die Sonde misst nichts mehr.");
    }

    $roh = (string) file_get_contents($pfad);

    if (trim($roh) === '') {
        throw new RuntimeException("{$relativ} ist leer — die Sonde misst nichts mehr.");
    }

    return $roh;
}

// ── 1. Der Default-Wert, ausgeschrieben ──────────────────────────────────────────

/*
 * **Hier stand ein `expect(config('group.media_public_url'))->toBe(…)`, und es war
 * falsch gebaut.** Es prüfte den EFFEKTIVEN Wert, also die `.env` des jeweiligen
 * Rechners — nicht den Default im Quelltext. Damit wurde jede der beiden Operationen
 * rot, die diese Konfiguration ausdrücklich anbietet: `MEDIA_PUBLIC_URL=` (Abschaltung)
 * und ein abweichendes Präfix. Die Zusage „eine `.env`-Zeile, kein Umbau" war dadurch
 * unwahr — es war eine `.env`-Zeile plus eine Test-Änderung.
 *
 * Die Literal-Zusicherung (Hausregel 1: nie das Symbol gegen sich selbst) trägt der
 * Quelltext-Test direkt darunter, und der ist env-unabhängig. Eine Mutationsprobe am
 * Default machte damals BEIDE Tests rot; der verbliebene allein hätte gereicht.
 */

test('Eine LEERE .env-Zeile schaltet den Verweis ab — der Default greift dann NICHT', function () {
    /*
     * Das ist der Unterschied zwischen `env($k, $default)` und `env($k) ?: $default`,
     * und er ist hier die ganze Zusage. Am 2026-08-21 gegen `vlucas/phpdotenv` gemessen:
     * eine leere Zeile liefert `''` (nicht `null`), Laravels Default greift also nur beim
     * FEHLENDEN Schlüssel. Mit `?:` — der Form, die `verein_public_url` zwei Zeilen höher
     * benutzt — wäre der Verweis nicht abschaltbar.
     *
     * Geprüft wird über `config()->set('')`, weil ein Test die `.env` nicht anfassen darf;
     * die Wirkung dieses Wertes IST die Zusage. Dass eine leere Zeile ihn erzeugt, hält
     * der Test über den Quelltext darunter fest.
     */
    config()->set('group.media_public_url', '');

    $res = $this->withSession(['nostr_pubkey' => medienFakeSessionPubkey()])
        ->get(route('group.articles'))
        ->assertOk();

    expect(medienHtml($res))->not->toContain('__nostrMedia');
});

test('Die Konfigurationszeile benutzt env(k, default) und NICHT `?:`', function () {
    $config = medienQuelle('packages/einundzwanzig-group/config/group.php');

    // Auf den AUFRUF gemustert, nicht auf den Namen: `'media_public_url'` allein stünde
    // auch dann noch da, wenn die Zeile auf `?:` umgestellt wird.
    // Die ganze Zeichenkette als Literal, nicht ihre Bausteine — und ohne `#`: der
    // Klarpfad ist der Default (Entscheidung vom 2026-08-21, Begründung im Docblock der
    // Konfigurationszeile). Käme ein `#` zurück, verlören geteilte Links ihre Vorschau,
    // und weil media. BEIDE Formen mit 200 beantwortet, wäre daran nichts zu sehen.
    expect($config)->toMatch("/'media_public_url' => env\('MEDIA_PUBLIC_URL', 'https:\/\/media\.einundzwanzig\.space'\)/");
    expect($config)->not->toMatch("/'media_public_url' => env\('MEDIA_PUBLIC_URL'\)\s*\?:/");
});

// ── 2. Die Hash-Warnung in .env.example ──────────────────────────────────────────

test('.env.example warnt vor dem unquotierten # — sonst kippt der Rückweg lautlos', function () {
    /*
     * **Der Default braucht keine Anführungszeichen — diese Warnung trotzdem.**
     *
     * `.env.example` bietet ausdrücklich einen Handgriff an: ein `#` anhängen, dann
     * entsteht die reine SPA-Route statt des Klarpfads. Genau dieser Handgriff geht
     * still schief. Gemessen, nicht vermutet (2026-08-21, `vlucas/phpdotenv` in einem
     * Wegwerf-Verzeichnis außerhalb dieses Projekts):
     *
     *   A=https://media.einundzwanzig.space/#    →  'https://media.einundzwanzig.space/'
     *   B="https://media.einundzwanzig.space/#"  →  'https://media.einundzwanzig.space/#'
     *
     * Ohne Anführungszeichen verschwindet der Hash. Auffallen würde es niemandem, weil
     * media. beide Formen mit 200 beantwortet — wer umstellt, hielte die Umstellung für
     * vollzogen. Deshalb hält dieser Test nicht einen Wert fest, sondern die WARNUNG:
     * sie ist die einzige Stelle, an der der Handgriff seine Bedingung nennt.
     */
    $beispiel = medienQuelle('.env.example');

    // Der heutige Wert: Klarpfad, unquotiert, kein `#`.
    expect($beispiel)->toContain('MEDIA_PUBLIC_URL=https://media.einundzwanzig.space'.PHP_EOL);

    // Und die Warnung, die den angebotenen Rückweg begehbar macht — samt der quotierten
    // Fassung zum Abschreiben. Auf beides gemustert: ein Kommentar, der `#` nur erwähnt,
    // ohne die Form zu zeigen, hilft niemandem.
    expect($beispiel)->toContain('ANFUEHRUNGSZEICHEN');
    expect($beispiel)->toContain('MEDIA_PUBLIC_URL="https://media.einundzwanzig.space/#"');

    // Positivkontrolle für die Sonde selbst: fände sie den Schlüssel gar nicht, wären
    // die Zeilen darüber trivial erfüllbar, sobald jemand `not->toContain` daraus macht.
    expect(preg_match('/^MEDIA_PUBLIC_URL=/m', $beispiel))->toBe(1);
});

// ── 3. Beide head-Partials ───────────────────────────────────────────────────────

test('BEIDE head-Partials tragen __nostrMedia — sonst tut der Verweis auf einem Weg nichts', function () {
    /*
     * `resources/views/partials/head.blade.php` ist der normale Web-Head, das
     * gleichnamige im Paket der Minimal-Head für den Portal-/Fremdhost-Betrieb (aktiv
     * über `config('group.head_partial')`). **In P6 stand die Zeile zuerst nur im
     * Paket-Partial** — im Web tat das Feature still gar nichts.
     *
     * Der Variablenname steht als LITERAL: `js/bridge.ts` liest
     * `globalThis.__nostrMedia`, und ein Tippfehler auf einer der beiden Seiten ergibt
     * dauerhaft `undefined` statt eines Fehlers — also dauerhaft keinen Verweis.
     */
    foreach ([
        'resources/views/partials/head.blade.php',
        'packages/einundzwanzig-group/resources/views/partials/head.blade.php',
    ] as $partial) {
        $src = medienQuelle($partial);

        expect($src)->toContain("window.__nostrMedia = window.__nostrMedia ?? @js(config('group.media_public_url'))");
        // `@if` davor: ohne Konfiguration entsteht die Zeile gar nicht erst.
        expect($src)->toContain("@if (config('group.media_public_url'))");
    }
});

test('Mit konfigurierter Basis reicht der Server sie WÖRTLICH in die Insel', function () {
    config()->set('group.media_public_url', 'https://media.example.test/#');

    $res = $this->withSession(['nostr_pubkey' => medienFakeSessionPubkey()])
        ->get(route('group.articles'))
        ->assertOk();
    $html = medienHtml($res);

    // `@js()` escaped die Schrägstriche — die Erwartung steht in der Form, die im
    // Dokument ankommt, nicht in der, die in der `.env` steht.
    expect($html)->toContain('window.__nostrMedia = window.__nostrMedia ??');
    expect($html)->toContain('https:\/\/media.example.test\/#');
});

// ── 4. Die zwei Flächen ──────────────────────────────────────────────────────────

test('Die Autorenseite trägt die Verweis-Zeile — mit dem Host aus der KONFIGURATION', function () {
    config()->set('group.board_relay_url', 'wss://relay.example.test');
    config()->set('group.media_public_url', 'https://media.example.test/#');

    $res = $this->withSession(['nostr_pubkey' => medienFakeSessionPubkey()])
        ->get('/articles/autor/'.str_repeat('a', 63).'b')
        ->assertOk();
    $html = medienHtml($res);

    /*
     * **Der Anker trägt einen WERT je Fläche, und das ist der ganze Punkt hier.**
     * Die Autorenseite rendert über `app-frame` auch die Profilkarte mit — ein
     * wertloses `data-medien-profil` stand damit ZWEIMAL im Dokument, und dieser Test
     * konnte die eigene Zeile nicht von der fremden unterscheiden. In der
     * Mutationsprobe vom 2026-08-21 (`data-medien-profil` → `data-medien-profilx` im
     * Autoren-Blade) blieb er deshalb GRÜN, obwohl der Gegenstand weg war. Gefunden hat
     * es die Probe, nicht das Lesen.
     */
    expect($html)->toContain('data-medien-profil="autor"');
    expect($html)->toContain('data-medien-profil="karte"');
    // Der Host kommt aus der Konfiguration, steht also NICHT als Literal im Blade.
    expect($html)->toContain('media.example.test');
    expect($html)->not->toContain('media.einundzwanzig.space');
    // Der Verweis ist ein echter Anker nach außen, kein `wire:navigate`.
    expect($html)->toContain('rel="noopener noreferrer"');
});

test('Die Profilkarte trägt sie ebenfalls — sie ist die Fläche, die BISHER keinen Ausgang hatte', function () {
    config()->set('group.media_public_url', 'https://media.example.test/#');

    // Die Karte hängt in `app-frame` und steht damit auf jeder Fläche der Shell.
    $res = $this->withSession(['nostr_pubkey' => medienFakeSessionPubkey()])
        ->get(route('group.articles'))
        ->assertOk();
    $html = medienHtml($res);

    expect($html)->toContain('data-medien-profil="karte"');
    expect($html)->toContain('media.example.test');
});

test('OHNE Konfiguration steht auf beiden Flächen KEINE Verweis-Zeile', function () {
    config()->set('group.board_relay_url', 'wss://relay.example.test');
    config()->set('group.media_public_url', '');

    foreach ([route('group.articles'), '/articles/autor/'.str_repeat('a', 63).'b'] as $url) {
        $html = medienHtml(
            $this->withSession(['nostr_pubkey' => medienFakeSessionPubkey()])->get($url)->assertOk()
        );

        expect($html)->not->toContain('data-medien-profil');
        expect($html)->not->toContain('__nostrMedia');
    }
});
