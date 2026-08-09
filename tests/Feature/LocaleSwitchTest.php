<?php

declare(strict_types=1);

/**
 * P2 — Mehrsprachigkeit (Strang A, Locale-Mechanik).
 *
 * Deckt genau die Punkte aus der Phasen-Anforderung ab:
 *  1. `SetLocale::resolve()` als Tabelle (acht Cookies, Müll, leer, fehlende
 *     Session, Accept-Language mit q-Werten/Regionen/`*`, Vorrang
 *     Cookie > Session > Header).
 *  2. `<html lang>` je Sprache (es, pl, plus pt-BR → pt).
 *  3. `POST /locale`: 302, Cookie-Attribute, Session, ungültiger Wert,
 *     guest-fähig.
 *  4. `SetLocale` liegt in der `web`-Gruppe HINTER `StartSession`.
 *  6. `partials/settings/language` liegt in BEIDEN Configs (Host + Package)
 *     direkt hinter `appearance`.
 *
 * Bewusst OHNE Assertion gegen konkret übersetzten Text — `lang/*.json` wird
 * von Strang B noch befüllt (siehe Task-Kontext). Geprüft wird ausschließlich
 * die Mechanik: welcher Locale-Code beim Rendern ankommt, nicht wie er
 * lautet.
 */

use Einundzwanzig\Group\Http\Middleware\SetLocale;
use Illuminate\Http\Request;
use Illuminate\Routing\Router;
use Illuminate\Session\ArraySessionHandler;
use Illuminate\Session\Middleware\StartSession;
use Illuminate\Session\Store;

/**
 * Baut eine startbare Session mit vorbelegten Werten, ohne HTTP-Roundtrip.
 *
 * @param  array<string, string>  $data  hier immer ein Session-Key auf einen Locale-Code
 */
function makeSessionWith(array $data): Store
{
    $session = new Store('test-session', new ArraySessionHandler(120));
    $session->start();
    foreach ($data as $key => $value) {
        $session->put($key, $value);
    }

    return $session;
}

// ── 1. SetLocale::resolve() — Tabelle ───────────────────────────────────────

test('ein gültiger Cookie-Wert gewinnt für jede der acht Sprachen', function (string $locale) {
    $request = Request::create('/');
    $request->cookies->set(SetLocale::COOKIE, $locale);

    expect(SetLocale::resolve($request))->toBe($locale);
})->with(['de', 'en', 'es', 'hu', 'lv', 'nl', 'pl', 'pt']);

test('ein Müll-Cookie fällt durch auf Accept-Language — nicht hart auf de', function () {
    $request = Request::create('/');
    $request->cookies->set(SetLocale::COOKIE, 'xx-nicht-in-der-whitelist');
    $request->headers->set('Accept-Language', 'es-ES,es;q=0.9');

    expect(SetLocale::resolve($request))->toBe('es');
});

test('ein leerer Cookie fällt durch auf Accept-Language', function () {
    $request = Request::create('/');
    $request->cookies->set(SetLocale::COOKIE, '');
    $request->headers->set('Accept-Language', 'pl-PL,pl;q=0.9');

    expect(SetLocale::resolve($request))->toBe('pl');
});

test('eine fehlende Session bricht die Auflösung nicht — der Header entscheidet', function () {
    $request = Request::create('/');
    $request->headers->set('Accept-Language', 'nl-NL,nl;q=0.9');

    expect($request->hasSession())->toBeFalse(); // Vorbedingung des Falls
    expect(SetLocale::resolve($request))->toBe('nl');
});

test('Accept-Language mit Regionscode wird auf den Basiscode reduziert (pt-BR → pt)', function () {
    $request = Request::create('/');
    $request->headers->set('Accept-Language', 'pt-BR,pt;q=0.9');

    expect(SetLocale::resolve($request))->toBe('pt');
});

test('Accept-Language: der höchste q-Wert gewinnt nur unter den TATSÄCHLICH unterstützten Sprachen', function () {
    // "fr" führt mit q=0.9, ist aber nicht in der Whitelist — "pt-BR" (q=0.8)
    // ist die einzige tatsächlich passende Übereinstimmung.
    $request = Request::create('/');
    $request->headers->set('Accept-Language', 'fr;q=0.9,pt-BR;q=0.8');

    expect(SetLocale::resolve($request))->toBe('pt');
});

test('Accept-Language "*" trifft nichts Konkretes und fällt auf den ersten Whitelist-Eintrag', function () {
    $request = Request::create('/');
    $request->headers->set('Accept-Language', '*');

    expect(SetLocale::resolve($request))->toBe(SetLocale::supported()[0])
        ->and(SetLocale::resolve($request))->toBe('de');
});

test('Accept-Language ohne jede Übereinstimmung fällt auf den ersten Whitelist-Eintrag', function () {
    $request = Request::create('/');
    $request->headers->set('Accept-Language', 'fr-FR,it;q=0.8');

    expect(SetLocale::resolve($request))->toBe('de');
});

test('Vorrang: Cookie schlägt Session UND Accept-Language', function () {
    $request = Request::create('/');
    $request->cookies->set(SetLocale::COOKIE, 'es');
    $request->setLaravelSession(makeSessionWith([SetLocale::SESSION_KEY => 'en']));
    $request->headers->set('Accept-Language', 'pt-PT,pt;q=0.9');

    expect(SetLocale::resolve($request))->toBe('es');
});

test('Vorrang: Session schlägt Accept-Language, wenn kein Cookie gesetzt ist', function () {
    $request = Request::create('/');
    $request->setLaravelSession(makeSessionWith([SetLocale::SESSION_KEY => 'hu']));
    $request->headers->set('Accept-Language', 'es-ES,es;q=0.9');

    expect(SetLocale::resolve($request))->toBe('hu');
});

// ── 2. <html lang> je Sprache ────────────────────────────────────────────

test('<html lang> folgt dem Cookie', function (string $locale) {
    $response = $this->withUnencryptedCookie(SetLocale::COOKIE, $locale)->get('/');

    $response->assertOk();
    expect($response->getContent())->toContain('<html lang="'.$locale.'">');
})->with(['es', 'pl']);

test('<html lang> folgt pt-BR über Accept-Language-Regionsverhandlung auf pt', function () {
    // setUp() setzt "de-DE,de;q=0.9" als Default-Header — hier bewusst überschrieben.
    $response = $this->withHeader('Accept-Language', 'pt-BR,pt;q=0.9')->get('/');

    $response->assertOk();
    expect($response->getContent())->toContain('<html lang="pt">');
});

// ── 3. POST /locale ──────────────────────────────────────────────────────

test('POST /locale liefert 302 und setzt ein Klartext-Cookie mit den erwarteten Attributen', function () {
    $response = $this->from('/settings')->post(route('group.locale'), ['locale' => 'es']);

    $response->assertRedirect('/settings');

    // `getName()` ist eine Methode, keine öffentliche Property — `firstWhere('name', …)`
    // griffe über `data_get()` ins Leere (die Property ist `private`) und lieferte
    // still `null`. Explizit über die Methode filtern.
    $cookie = collect($response->headers->getCookies())->first(fn ($c) => $c->getName() === SetLocale::COOKIE);

    expect($cookie)->not->toBeNull()
        // Klartext, nicht das serialisierte/verschlüsselte Format von EncryptCookies
        // (das wäre eine lange base64/JSON-Payload, nie exakt "es").
        ->and($cookie->getValue())->toBe('es')
        ->and($cookie->getPath())->toBe('/')
        ->and($cookie->isHttpOnly())->toBeFalse()
        ->and($cookie->getMaxAge())->toBeGreaterThan(31536000 - 5)
        ->and($cookie->getMaxAge())->toBeLessThan(31536000 + 5);
});

test('POST /locale setzt die Session', function () {
    $this->post(route('group.locale'), ['locale' => 'hu']);

    expect(session(SetLocale::SESSION_KEY))->toBe('hu');
});

test('ein ungültiger Wert wird abgewiesen — die Session bleibt unverändert', function () {
    session([SetLocale::SESSION_KEY => 'en']);

    $this->from('/settings')
        ->post(route('group.locale'), ['locale' => 'xx-nicht-existent'])
        ->assertRedirect('/settings')
        ->assertSessionHasErrors('locale');

    expect(session(SetLocale::SESSION_KEY))->toBe('en');
});

test('POST /locale ist guest-fähig — kein nostr_pubkey nötig', function () {
    // Keine Session-Vorbedingung außer der von Laravel selbst gestellten:
    // ein 302 (statt 401/403/Redirect auf den Login-View) belegt, dass die
    // Route außerhalb von nostr.auth liegt.
    $response = $this->post(route('group.locale'), ['locale' => 'en']);

    $response->assertStatus(302);
    expect($response->headers->get('Location'))->not->toContain('nostr-login');
});

// ── 4. Middleware-Reihenfolge ────────────────────────────────────────────

test('SetLocale steht in der web-Gruppe HINTER StartSession', function () {
    $group = app(Router::class)->getMiddlewareGroups()['web'];

    // `array_search()` liefert `int|string|false` — ein `false` hier ungeprüft in einen
    // Zahlenvergleich zu geben, ließe PHP es in eine Zahl zwingen (`false == 0`) statt
    // den eigentlich fehlenden Eintrag zu melden. Deshalb hart und lesbar scheitern,
    // WENN eine der beiden Middlewares gar nicht in der Gruppe steht — das ist ein
    // Setup-Fehler des Tests, keiner, den die eigentliche Assertion einfangen soll.
    $sessionIndex = array_search(StartSession::class, $group, true);
    if ($sessionIndex === false) {
        throw new RuntimeException('StartSession fehlt in der web-Gruppe.');
    }

    $localeIndex = array_search(SetLocale::class, $group, true);
    if ($localeIndex === false) {
        throw new RuntimeException('SetLocale fehlt in der web-Gruppe.');
    }

    expect($localeIndex)->toBeGreaterThan($sessionIndex);
});

// ── 6. Settings-Registry: language direkt hinter appearance ─────────────

test('language steht in BEIDEN Configs (Host und Package) direkt hinter appearance', function () {
    $host = require base_path('config/group.php');
    $package = require base_path('packages/einundzwanzig-group/config/group.php');

    foreach (['Host' => $host, 'Package' => $package] as $label => $config) {
        $settings = $config['settings'];

        // Dieselbe Begründung wie beim Middleware-Test oben: `array_search()` liefert
        // `int|string|false`, und ein fehlender Eintrag ist hier ein Setup-Fehler
        // (falsch geschriebener Config-Key), keiner, den die Positions-Assertion
        // unten sinnvoll einfangen könnte — deshalb eigene, benannte Meldung.
        // `is_int()` statt `=== false`: `$settings` kommt aus einem `require`, dessen
        // Shape PHPStan nicht kennt — der Guard muss deshalb BEIDES ausschließen, das
        // (hier unmögliche, aber generisch erlaubte) String-Ergebnis UND `false`, nicht
        // nur Letzteres. Für eine echte Liste ist "kein int" gleichbedeutend mit
        // "nicht gefunden", also keine Verengung, die etwas verschweigt.
        $appearanceIndex = array_search('appearance', $settings, true);
        if (! is_int($appearanceIndex)) {
            throw new RuntimeException("{$label}: 'appearance' fehlt in settings.");
        }

        $languageIndex = array_search('language', $settings, true);
        if (! is_int($languageIndex)) {
            throw new RuntimeException("{$label}: 'language' fehlt in settings.");
        }

        expect($languageIndex)->toBe($appearanceIndex + 1, "{$label}: 'language' steht nicht direkt hinter 'appearance'");
    }
});
