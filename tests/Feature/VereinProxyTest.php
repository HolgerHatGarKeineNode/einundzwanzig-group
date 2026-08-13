<?php

declare(strict_types=1);

use App\Http\Controllers\VereinProxyController;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Request as ClientRequest;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Route;
use swentel\nostr\Event\Event;
use swentel\nostr\Key\Key;
use swentel\nostr\Sign\Sign;

/*
|--------------------------------------------------------------------------
| P4 — Vereins-Proxy mit Aufrufer-Bindung
|--------------------------------------------------------------------------
|
| Geprüft wird, was der Proxy dem Verein gegenüber zusichert (Whitelist, rohe
| Bytes, kein Retry, kein geerbter Header) und was er dem Nutzer gegenüber
| zusichert (Bindung an den angemeldeten Pubkey, unverfälschte Fehler).
|
| Der Testschlüssel heißt absichtlich auffällig: `PROXY-TESTKEY-DO-NOT-LEAK`
| lässt sich über die gesamte Testausgabe und über storage/logs greppen — der
| Nachweis „erscheint in keiner Antwort und keinem Log" ist damit eine Suche
| nach einer Zeichenkette, nicht eine Beteuerung.
|
*/

const PROXY_BASE = 'https://verein.test';

const PROXY_KEY = 'PROXY-TESTKEY-DO-NOT-LEAK';

/** Basis-URL + Schlüssel setzen (ohne beides antwortet der Proxy 503). */
function proxyConfigured(): void
{
    config(['verein.base_url' => PROXY_BASE, 'verein.api_key' => PROXY_KEY]);
}

/**
 * Signiert ein NIP-98-Event (kind 27235) wie der Browser es täte — über die
 * ZIEL-URL beim Verein, nicht über die Proxy-Route.
 *
 * @param  string|null  $nsec  eigener Schlüssel; null = frisch erzeugter
 * @return array{id: string, pubkey: string, created_at: int, kind: int, tags: array<int, array<int, string>>, content: string, sig: string}
 */
function signProxyAuth(string $url, string $method, string $body = '', ?string $nsec = null, int $ageSeconds = 0): array
{
    $key = $nsec ?? (new Key)->generatePrivateKey();

    $tags = [['u', $url], ['method', $method]];

    if ($body !== '') {
        $tags[] = ['payload', hash('sha256', $body)];
    }

    $event = new Event;
    $event->setKind(27235);
    $event->setContent('');
    $event->setCreatedAt(now()->getTimestamp() - $ageSeconds);
    $event->setTags($tags);

    (new Sign)->signEvent($event, $key);

    return [
        'id' => $event->getId(),
        'pubkey' => $event->getPublicKey(),
        'created_at' => $event->getCreatedAt(),
        'kind' => $event->getKind(),
        'tags' => $tags,
        'content' => $event->getContent(),
        'sig' => $event->getSignature(),
    ];
}

/**
 * @param  array<string, mixed>  $event
 */
function proxyAuthHeader(array $event): string
{
    return 'Nostr '.base64_encode((string) json_encode($event, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));
}

/**
 * URIs aller registrierten Routen der aktuellen Anwendung.
 *
 * @return array<int, string>
 */
function registeredUris(): array
{
    return collect(Route::getRoutes()->getRoutes())->map(fn ($route) => $route->uri())->values()->all();
}

/**
 * Server-Variablen für `call()`.
 *
 * `call()` übernimmt die Default-Header der TestCase NICHT (das tun nur
 * `get()`/`post()`/`json()`), und Symfony stempelt in jeden so gebauten Request
 * `Accept-Language: en-us` — die geprüften Meldungen kämen dann aus
 * `packages/einundzwanzig-group/lang/en.json` statt aus den deutschen
 * Quell-Keys. Deshalb steht die Sprache hier explizit.
 *
 * @param  array<string, string>  $extra
 * @return array<string, string>
 */
function proxyServer(array $extra = []): array
{
    return array_merge([
        'HTTP_ACCEPT' => 'application/json',
        'HTTP_ACCEPT_LANGUAGE' => 'de-DE,de;q=0.9',
    ], $extra);
}

// ── Whitelist: die sechs erlaubten Ziele ────────────────────────────────

test('alle sechs Routen reichen an genau ihr Vereins-Ziel weiter', function (string $method, string $proxyPath, string $targetPath, bool $withBody) {
    proxyConfigured();
    Http::fake(['*' => Http::response(['ok' => true], 200)]);

    $target = PROXY_BASE.$targetPath;
    $body = $withBody ? '{"statutes_version":"2026-01"}' : '';
    $event = signProxyAuth($target, $method, $body);

    $server = proxyServer(['HTTP_AUTHORIZATION' => proxyAuthHeader($event)]);

    if ($withBody) {
        $server['CONTENT_TYPE'] = 'application/json';
    }

    $this->withSession(['nostr_pubkey' => $event['pubkey']])
        ->call($method, $proxyPath, [], [], [], $server, $body === '' ? null : $body)
        ->assertOk()
        ->assertJson(['ok' => true]);

    Http::assertSent(fn (ClientRequest $request) => $request->url() === $target && $request->method() === $method);
    Http::assertSentCount(1);
})->with([
    ['GET', '/api/verein/config', '/api/v1/membership/config', false],
    ['POST', '/api/verein/applications', '/api/v1/membership/applications', true],
    ['GET', '/api/verein/me', '/api/v1/membership/me', false],
    ['GET', '/api/verein/payments', '/api/v1/membership/payments', false],
    ['POST', '/api/verein/payments/2026/invoice', '/api/v1/membership/payments/2026/invoice', true],
    ['POST', '/api/verein/payments/2026/refresh', '/api/v1/membership/payments/2026/refresh', true],
]);

test('DELETE /me und jeder Weg auf /export werden abgewiesen — und rufen den Verein nie', function (string $method, string $path, int $status) {
    proxyConfigured();
    Http::fake();

    $this->withSession(['nostr_pubkey' => str_repeat('a', 64)])
        ->call($method, $path, [], [], [], proxyServer())
        ->assertStatus($status);

    Http::assertNothingSent();
})->with([
    // 405: den Pfad kennt Laravel (GET /me existiert), die Methode nicht.
    ['DELETE', '/api/verein/me', 405],
    // 404: `export` steht in keiner Route — es gibt nichts zu verbieten.
    ['GET', '/api/verein/export', 404],
    ['POST', '/api/verein/export', 404],
    ['GET', '/api/verein/me/export', 404],
    // Der Catch-all, den es nicht gibt.
    ['GET', '/api/verein/../v1/membership/export', 404],
]);

test('{year} nimmt nur vier Ziffern', function () {
    proxyConfigured();
    Http::fake();

    $this->withSession(['nostr_pubkey' => str_repeat('a', 64)])
        ->call('POST', '/api/verein/payments/20x6/invoice', [], [], [], proxyServer())
        ->assertNotFound();

    Http::assertNothingSent();
});

test('ein Query-String des Aufrufers landet nicht in der Ziel-URL', function () {
    proxyConfigured();
    Http::fake(['*' => Http::response([], 200)]);

    $target = PROXY_BASE.'/api/v1/membership/payments';
    $event = signProxyAuth($target, 'GET');

    $this->withSession(['nostr_pubkey' => $event['pubkey']])
        ->call('GET', '/api/verein/payments?year=2026&debug=1', [], [], [], proxyServer([
            'HTTP_AUTHORIZATION' => proxyAuthHeader($event),
        ]))
        ->assertOk();

    Http::assertSent(fn (ClientRequest $request) => $request->url() === $target);
});

// ── Session-Gate ────────────────────────────────────────────────────────

test('ohne Session-Pubkey: 401, und der Verein wird nicht gerufen', function (string $method, string $path) {
    proxyConfigured();
    Http::fake();

    $this->call($method, $path, [], [], [], proxyServer())
        ->assertStatus(401)
        ->assertJsonPath('message', 'Nicht angemeldet.');

    Http::assertNothingSent();
})->with([
    ['GET', '/api/verein/config'],
    ['GET', '/api/verein/me'],
    ['GET', '/api/verein/payments'],
    ['POST', '/api/verein/applications'],
    ['POST', '/api/verein/payments/2026/invoice'],
    ['POST', '/api/verein/payments/2026/refresh'],
]);

test('das Gate winkt auch im NativePHP-Lauf nicht durch (anders als nostr.auth)', function () {
    proxyConfigured();
    config(['nativephp-internal.running' => true]);
    Http::fake();

    $this->getJson('/api/verein/me')->assertStatus(401);

    Http::assertNothingSent();
});

// ── Aufrufer-Bindung (kalibriert) ───────────────────────────────────────

test('ein NIP-98-Event eines FREMDEN Pubkeys wird mit 403 abgewiesen', function () {
    proxyConfigured();
    Http::fake();

    $target = PROXY_BASE.'/api/v1/membership/me';

    // Echt signiert — nur eben von jemand anderem als dem Angemeldeten.
    $fremd = signProxyAuth($target, 'GET');
    $angemeldet = signProxyAuth($target, 'GET');

    expect($fremd['pubkey'])->not->toBe($angemeldet['pubkey']);

    $this->withSession(['nostr_pubkey' => $angemeldet['pubkey']])
        ->call('GET', '/api/verein/me', [], [], [], proxyServer([
            'HTTP_AUTHORIZATION' => proxyAuthHeader($fremd),
        ]))
        ->assertStatus(403)
        ->assertJsonPath('message', 'Der Ausweis gehört zu einem anderen Konto.');

    // Entscheidend: der Schlüssel des Vereins wurde dafür nicht ausgegeben.
    Http::assertNothingSent();
});

test('derselbe Pubkey in Session und Event kommt durch — Gegenprobe zur Bindung', function () {
    proxyConfigured();
    Http::fake(['*' => Http::response(['ok' => true], 200)]);

    $target = PROXY_BASE.'/api/v1/membership/me';
    $event = signProxyAuth($target, 'GET');

    $this->withSession(['nostr_pubkey' => $event['pubkey']])
        ->call('GET', '/api/verein/me', [], [], [], proxyServer([
            'HTTP_AUTHORIZATION' => proxyAuthHeader($event),
        ]))
        ->assertOk();

    Http::assertSentCount(1);
});

// ── NIP-98-Prüfung im Proxy ─────────────────────────────────────────────

test('untaugliche Ausweise fallen mit 401 durch, bevor der Verein gerufen wird', function (string $fall, string $message) {
    proxyConfigured();
    Http::fake();

    $target = PROXY_BASE.'/api/v1/membership/me';

    $event = match ($fall) {
        'für POST signiert, als GET gesendet' => signProxyAuth($target, 'POST'),
        'für ein anderes Ziel signiert' => signProxyAuth(PROXY_BASE.'/api/v1/membership/payments/2026/invoice', 'GET'),
        'für die Proxy-Route statt für den Verein signiert' => signProxyAuth('http://localhost/api/verein/me', 'GET'),
        'älter als das 60-Sekunden-Fenster' => signProxyAuth($target, 'GET', '', null, 61),
        default => signProxyAuth($target, 'GET'),
    };

    // Die Session trägt immer den echten, klein geschriebenen Pubkey — geprüft
    // wird der AUSWEIS, nicht die Anmeldung.
    $sessionPubkey = $event['pubkey'];

    if ($fall === 'falsches Kind') {
        $event['kind'] = 1;
    }

    if ($fall === 'Signatur verfälscht') {
        $event['sig'] = str_repeat('0', 128);
    }

    if ($fall === 'Pubkey in Großbuchstaben') {
        $event['pubkey'] = strtoupper($event['pubkey']);
    }

    $server = proxyServer();

    $header = match ($fall) {
        'kein Header' => null,
        'kein base64' => 'Nostr {nicht-base64!}',
        default => proxyAuthHeader($event),
    };

    if ($header !== null) {
        $server['HTTP_AUTHORIZATION'] = $header;
    }

    $this->withSession(['nostr_pubkey' => $sessionPubkey])
        ->call('GET', '/api/verein/me', [], [], [], $server)
        ->assertStatus(401)
        ->assertJsonPath('message', $message);

    Http::assertNothingSent();
})->with([
    ['kein Header', 'Kein Nostr-Ausweis mitgeschickt.'],
    ['kein base64', 'Ausweis unlesbar.'],
    ['falsches Kind', 'Falscher Event-Typ.'],
    ['für POST signiert, als GET gesendet', 'Methode stimmt nicht.'],
    ['für ein anderes Ziel signiert', 'Die signierte Adresse passt nicht zum Ziel.'],
    ['für die Proxy-Route statt für den Verein signiert', 'Die signierte Adresse passt nicht zum Ziel.'],
    ['älter als das 60-Sekunden-Fenster', 'Ausweis abgelaufen.'],
    ['Signatur verfälscht', 'Ungültige Signatur.'],
    ['Pubkey in Großbuchstaben', 'Ausweis unvollständig.'],
]);

test('ein Ausweis, dessen payload-Tag nicht zu den Bytes passt, wird abgewiesen', function () {
    proxyConfigured();
    Http::fake();

    $target = PROXY_BASE.'/api/v1/membership/applications';
    $event = signProxyAuth($target, 'POST', '{"a":1}');

    // Signiert wurde über {"a":1}, gesendet wird etwas anderes.
    $this->withSession(['nostr_pubkey' => $event['pubkey']])
        ->call('POST', '/api/verein/applications', [], [], [], proxyServer([
            'HTTP_AUTHORIZATION' => proxyAuthHeader($event),
            'CONTENT_TYPE' => 'application/json',
        ]), '{"a":2}')
        ->assertStatus(401)
        ->assertJsonPath('message', 'Der Ausweis passt nicht zum Inhalt.');

    Http::assertNothingSent();
});

test('ein multipart-Body wird mit 415 abgewiesen, weil seine Bytes nicht prüfbar sind', function () {
    proxyConfigured();
    Http::fake();

    $target = PROXY_BASE.'/api/v1/membership/applications';
    $event = signProxyAuth($target, 'POST');

    $this->withSession(['nostr_pubkey' => $event['pubkey']])
        ->call('POST', '/api/verein/applications', ['statutes_version' => '2026-01'], [], [], proxyServer([
            'HTTP_AUTHORIZATION' => proxyAuthHeader($event),
            'CONTENT_TYPE' => 'multipart/form-data; boundary=x',
        ]))
        ->assertStatus(415);

    Http::assertNothingSent();
});

// ── Rohe Bytes ──────────────────────────────────────────────────────────

test('der Body geht Byte für Byte unverändert raus', function () {
    proxyConfigured();
    Http::fake(['*' => Http::response([], 201)]);

    // Absichtlich so formatiert, dass jede Re-Serialisierung ihn verändert:
    // doppelte Leerzeichen, Leerzeichen vor dem Doppelpunkt, ein escaptes
    // Unicode-Zeichen und ein Schrägstrich, den json_encode ohne
    // JSON_UNESCAPED_SLASHES zu \/ machen würde.
    $raw = '{"statutes_version" : "2026-01",  "note":"Grüße \/ ok",  "x":1.0}';

    $target = PROXY_BASE.'/api/v1/membership/applications';
    $event = signProxyAuth($target, 'POST', $raw);

    $this->withSession(['nostr_pubkey' => $event['pubkey']])
        ->call('POST', '/api/verein/applications', [], [], [], proxyServer([
            'HTTP_AUTHORIZATION' => proxyAuthHeader($event),
            'CONTENT_TYPE' => 'application/json',
        ]), $raw)
        ->assertStatus(201);

    Http::assertSent(function (ClientRequest $request) use ($raw) {
        expect($request->body())->toBe($raw)
            // Derselbe Hash, den der `payload`-Tag trägt: was signiert wurde, ist
            // Byte für Byte das, was beim Verein ankommt.
            ->and(hash('sha256', $request->body()))->toBe(hash('sha256', $raw))
            ->and($request->header('Content-Type'))->toBe(['application/json']);

        return true;
    });
});

// ── Weiterleitungsverbot für Header ─────────────────────────────────────

test('ein vom Aufrufer gesetzter X-Api-Key erreicht den Verein nicht', function () {
    proxyConfigured();
    Http::fake(['*' => Http::response([], 200)]);

    $target = PROXY_BASE.'/api/v1/membership/me';
    $event = signProxyAuth($target, 'GET');

    $this->withSession(['nostr_pubkey' => $event['pubkey']])
        ->call('GET', '/api/verein/me', [], [], [], proxyServer([
            'HTTP_AUTHORIZATION' => proxyAuthHeader($event),
            'HTTP_X_API_KEY' => 'GEFAELSCHTER-KEY',
            'HTTP_X_FORWARDED_FOR' => '10.0.0.1',
            'HTTP_X_FORWARDED_HOST' => 'evil.example',
            'HTTP_COOKIE' => 'laravel_session=abc',
        ]))
        ->assertOk();

    Http::assertSent(function (ClientRequest $request) {
        expect($request->header('X-Api-Key'))->toBe([PROXY_KEY])
            ->and($request->hasHeader('X-Forwarded-For'))->toBeFalse()
            ->and($request->hasHeader('X-Forwarded-Host'))->toBeFalse()
            ->and($request->hasHeader('Cookie'))->toBeFalse()
            ->and($request->header('Accept'))->toBe(['application/json']);

        return true;
    });
});

test('/config bekommt keinen Authorization-Header — auch wenn der Aufrufer einen mitschickt', function () {
    proxyConfigured();
    Http::fake(['*' => Http::response([], 200)]);

    $event = signProxyAuth(PROXY_BASE.'/api/v1/membership/config', 'GET');

    $this->withSession(['nostr_pubkey' => $event['pubkey']])
        ->call('GET', '/api/verein/config', [], [], [], proxyServer([
            'HTTP_AUTHORIZATION' => proxyAuthHeader($event),
        ]))
        ->assertOk();

    Http::assertSent(function (ClientRequest $request) {
        expect($request->hasHeader('Authorization'))->toBeFalse()
            ->and($request->header('X-Api-Key'))->toBe([PROXY_KEY]);

        return true;
    });
});

test('ein Set-Cookie des Vereins wird nicht an den Browser durchgereicht', function () {
    proxyConfigured();
    Http::fake(['*' => Http::response('{}', 200, [
        'Content-Type' => 'application/json',
        'Set-Cookie' => 'fremde_session=1',
        'X-RateLimit-Remaining' => '17',
    ])]);

    $event = signProxyAuth(PROXY_BASE.'/api/v1/membership/config', 'GET');

    $response = $this->withSession(['nostr_pubkey' => $event['pubkey']])
        ->call('GET', '/api/verein/config', [], [], [], proxyServer())
        ->assertOk();

    // Die eigene Session setzt selbstverstaendlich Cookies — geprueft wird, dass
    // KEIN Cookie des Vereins dabei ist.
    $setCookies = implode(' ', $response->headers->all('set-cookie'));

    expect($setCookies)->not->toContain('fremde_session')
        // Der Zähler des Vereins (17) kommt nicht durch. Was hier steht, ist der
        // Zähler UNSERES Limiters: 10 pro Minute, nach diesem einen Aufruf 9.
        ->and($response->headers->get('X-RateLimit-Remaining'))->toBe('9')
        ->and($response->headers->get('Content-Type'))->toBe('application/json');
});

// ── Fehler unverfälscht ─────────────────────────────────────────────────

test('Vereins-Fehler kommen mit Status und Body unverfälscht an', function (int $status, string $body, array $headers) {
    proxyConfigured();
    Http::fake(['*' => Http::response($body, $status, $headers + ['Content-Type' => 'application/json'])]);

    $event = signProxyAuth(PROXY_BASE.'/api/v1/membership/config', 'GET');

    $response = $this->withSession(['nostr_pubkey' => $event['pubkey']])
        ->call('GET', '/api/verein/config', [], [], [], proxyServer())
        ->assertStatus($status);

    expect($response->getContent())->toBe($body);

    foreach ($headers as $name => $value) {
        expect($response->headers->get($name))->toBe($value);
    }
})->with([
    '401' => [401, '{"message":"Unauthorized."}', []],
    '415' => [415, '{"message":"Unsupported Media Type."}', []],
    '422' => [422, '{"message":"Die Angaben sind ungültig.","errors":{"statutes_version":["Pflicht."]}}', []],
    '429' => [429, '{"message":"Too Many Requests"}', ['Retry-After' => '37']],
    '503' => [503, '{"message":"Service Unavailable"}', []],
]);

test('bei 503 vom Verein geht genau EIN Request raus — kein Retry', function () {
    proxyConfigured();
    Http::fake(['*' => Http::response('{"message":"Service Unavailable"}', 503)]);

    $target = PROXY_BASE.'/api/v1/membership/payments/2026/invoice';
    $raw = '{"jahr":2026}';
    $event = signProxyAuth($target, 'POST', $raw);

    $this->withSession(['nostr_pubkey' => $event['pubkey']])
        ->call('POST', '/api/verein/payments/2026/invoice', [], [], [], proxyServer([
            'HTTP_AUTHORIZATION' => proxyAuthHeader($event),
            'CONTENT_TYPE' => 'application/json',
        ]), $raw)
        ->assertStatus(503);

    // Ein NIP-98-Event ist nach dem ersten Versuch verbraucht (Replay-Sperre
    // beim Verein) — ein zweiter Versuch ergäbe ein falsches „nicht autorisiert".
    Http::assertSentCount(1);
});

test('ein nicht erreichbarer Verein ergibt 504 und genau einen Versuch', function () {
    proxyConfigured();

    // Eigener Zaehler statt Http::assertSentCount(): ein im Stub geworfener
    // Verbindungsfehler wird nicht als gesendeter Request aufgezeichnet — die
    // Assertion saehe also auch dann 0, wenn der Proxy zehnmal wiederholte.
    $versuche = 0;
    Http::fake(function () use (&$versuche) {
        $versuche++;

        throw new ConnectionException('cURL error 28: timeout');
    });

    $event = signProxyAuth(PROXY_BASE.'/api/v1/membership/config', 'GET');

    $this->withSession(['nostr_pubkey' => $event['pubkey']])
        ->call('GET', '/api/verein/config', [], [], [], proxyServer())
        ->assertStatus(504)
        ->assertJsonPath('message', 'Der Verein ist derzeit nicht erreichbar.');

    expect($versuche)->toBe(1);
});

// ── Fail closed ─────────────────────────────────────────────────────────

test('ohne API-Key antwortet der Proxy 503 und ruft nichts auf', function (?string $baseUrl, ?string $apiKey) {
    config(['verein.base_url' => $baseUrl, 'verein.api_key' => $apiKey]);
    Http::fake();

    $this->withSession(['nostr_pubkey' => str_repeat('a', 64)])
        ->call('GET', '/api/verein/config', [], [], [], proxyServer())
        ->assertStatus(503)
        // Derselbe Satz, den der Client bei fehlender Basis-URL selbst setzt
        // (`js/verein.ts`). Für den Nutzer ist beides EIN Zustand — die
        // Installation ist nicht eingerichtet, dauerhaft. Vorher standen dafür
        // zwei deutsche Formulierungen, deren Unterschied in es/pt/pl erfunden
        // werden musste.
        ->assertJsonPath('message', 'Die Vereins-Anbindung ist nicht eingerichtet.');

    Http::assertNothingSent();
})->with([
    'nichts konfiguriert' => [null, null],
    'nur URL' => [PROXY_BASE, ''],
    'nur Key' => ['', PROXY_KEY],
]);

// ── Eigenes Kontingent ──────────────────────────────────────────────────

test('das eigene Kontingent greift bei 10 Aufrufen pro Minute und Pubkey', function () {
    proxyConfigured();
    Http::fake(['*' => Http::response([], 200)]);

    $pubkey = str_repeat('b', 64);

    for ($i = 0; $i < 10; $i++) {
        $this->withSession(['nostr_pubkey' => $pubkey])
            ->call('GET', '/api/verein/config', [], [], [], proxyServer())
            ->assertOk();
    }

    $blocked = $this->withSession(['nostr_pubkey' => $pubkey])
        ->call('GET', '/api/verein/config', [], [], [], proxyServer())
        ->assertStatus(429);

    // Der Client soll wissen, wann er es wieder versuchen darf — ohne diese
    // Angabe kostet jedes Raten eine neue Signatur.
    expect($blocked->headers->has('Retry-After'))->toBeTrue();

    // Der elfte Aufruf hat den Verein nicht mehr erreicht.
    Http::assertSentCount(10);
});

// ── NativePHP: die Routen existieren dort gar nicht ─────────────────────

test('im NativePHP-Lauf sind die Proxy-Routen nicht registriert', function () {
    // Positivkontrolle zuerst: in dieser Umgebung SIND sie da. Ohne sie wäre
    // das `not->toContain` unten auch dann grün, wenn die Routendatei nie
    // geladen würde.
    expect(registeredUris())->toContain('api/verein/me', 'api/verein/config');

    $original = getenv('NATIVEPHP_RUNNING');
    putenv('NATIVEPHP_RUNNING=true');
    $_ENV['NATIVEPHP_RUNNING'] = $_SERVER['NATIVEPHP_RUNNING'] = 'true';

    try {
        $this->refreshApplication();

        expect(config('nativephp-internal.running'))->toBeTrue();

        $uris = registeredUris();

        expect($uris)
            ->not->toContain('api/verein/config')
            ->not->toContain('api/verein/me')
            ->not->toContain('api/verein/applications')
            ->not->toContain('api/verein/payments')
            ->not->toContain('api/verein/payments/{year}/invoice')
            ->not->toContain('api/verein/payments/{year}/refresh')
            // Die App steht ansonsten vollständig — es fehlen genau diese Routen.
            ->toContain('nostr-login');
    } finally {
        unset($_ENV['NATIVEPHP_RUNNING'], $_SERVER['NATIVEPHP_RUNNING']);
        putenv($original === false ? 'NATIVEPHP_RUNNING' : 'NATIVEPHP_RUNNING='.$original);
        $this->refreshApplication();
    }
});

// ── Kein Leck in Antwort und Log ────────────────────────────────────────

test('weder Schlüssel noch Ausweis erscheinen in einer Antwort oder im Log', function () {
    proxyConfigured();

    $logFile = storage_path('logs/laravel.log');
    $before = is_file($logFile) ? (int) filesize($logFile) : 0;

    $target = PROXY_BASE.'/api/v1/membership/applications';
    $raw = '{"statutes_version":"2026-01"}';
    $event = signProxyAuth($target, 'POST', $raw);
    $header = proxyAuthHeader($event);

    $bodies = [];

    // Erfolg, Vereins-Fehler und Netzwerkausfall — jeder Zweig, der eine
    // Antwort erzeugt oder etwas zu loggen hätte.
    $cases = [
        fn () => Http::fake(['*' => Http::response(['ok' => true], 201)]),
        fn () => Http::fake(['*' => Http::response('{"message":"Unauthorized."}', 401)]),
        fn () => Http::fake(fn () => throw new ConnectionException('cURL error 7')),
    ];

    foreach ($cases as $fake) {
        $fake();

        $bodies[] = (string) $this->withSession(['nostr_pubkey' => $event['pubkey']])
            ->call('POST', '/api/verein/applications', [], [], [], proxyServer([
                'HTTP_AUTHORIZATION' => $header,
                'CONTENT_TYPE' => 'application/json',
            ]), $raw)
            ->getContent();
    }

    foreach ($bodies as $body) {
        expect($body)->not->toContain(PROXY_KEY)
            ->and($body)->not->toContain($header)
            ->and($body)->not->toContain($event['sig']);
    }

    $written = is_file($logFile) ? (string) file_get_contents($logFile, false, null, $before) : '';

    expect($written)->not->toContain(PROXY_KEY)
        ->and($written)->not->toContain($header)
        ->and($written)->not->toContain('Nostr ');
});

// ── Umleitungen (N1) ────────────────────────────────────────────────────

test('einer Umleitung folgt der Proxy nicht — der Schlüssel bleibt beim konfigurierten Origin', function () {
    proxyConfigured();

    // Erst eine 302 auf einen fremden Origin, dann eine harmlose 200. Ohne
    // `allow_redirects => false` folgt Guzzle der ersten Antwort und schickt den
    // zweiten Aufruf samt `X-Api-Key` nach fremder.example: die Middleware
    // entfernt beim Origin-Wechsel nur `Authorization` und `Cookie`
    // (RedirectMiddleware.php:219-222), `X-Api-Key` steht dort nicht.
    Http::fakeSequence()
        ->push('', 302, ['Location' => 'https://fremder.example/geklaut'])
        ->push('{"ok":true}', 200);

    $event = signProxyAuth(PROXY_BASE.'/api/v1/membership/config', 'GET');

    $response = $this->withSession(['nostr_pubkey' => $event['pubkey']])
        ->call('GET', '/api/verein/config', [], [], [], proxyServer())
        ->assertStatus(302);

    // Die eigentliche Aussage: kein einziger Aufruf an einen fremden Host.
    Http::assertSentCount(1);
    Http::assertNotSent(fn (ClientRequest $request) => str_contains($request->url(), 'fremder.example'));

    // Der Status kommt unverfälscht durch (Vorgabe 9), das Umleitungsziel nicht:
    // sonst wäre der Proxy die Weiterleitungsstelle an ein fremdes Ziel.
    expect($response->headers->has('Location'))->toBeFalse();
});

// ── Anker der Eingabeprüfungen (N2) ─────────────────────────────────────

test('der zweite {year}-Riegel hält auch ohne die Routen-Regex', function () {
    $controller = new VereinProxyController;
    $paymentsPath = new ReflectionMethod($controller, 'paymentsPath');

    // Positivkontrolle: der Riegel lässt ein echtes Jahr durch.
    expect($paymentsPath->invoke($controller, '2026'))->toBe('/api/v1/membership/payments/2026');

    // PCRE lässt `$` auch VOR einem abschließenden \n matchen. Mit `$` wäre
    // "2026\n" hier durchgekommen — und ein Zeilenumbruch stünde in einer URL.
    foreach (["2026\n", "2026\n2027", ' 2026', '20261', 'abcd', ''] as $muell) {
        $status = null;

        try {
            $paymentsPath->invoke($controller, $muell);
        } catch (HttpResponseException $e) {
            $status = $e->getResponse()->getStatusCode();
        }

        expect($status)->toBe(404, 'durchgelassen: '.json_encode($muell));
    }
});

test('ein Pubkey mit angehängtem Zeilenumbruch gilt nicht als hex(64)', function () {
    proxyConfigured();
    Http::fake();

    $target = PROXY_BASE.'/api/v1/membership/me';
    $event = signProxyAuth($target, 'GET');
    $sessionPubkey = $event['pubkey'];
    $event['pubkey'] = $event['pubkey']."\n";

    $this->withSession(['nostr_pubkey' => $sessionPubkey])
        ->call('GET', '/api/verein/me', [], [], [], proxyServer([
            'HTTP_AUTHORIZATION' => proxyAuthHeader($event),
        ]))
        ->assertStatus(401)
        ->assertJsonPath('message', 'Ausweis unvollständig.');

    Http::assertNothingSent();
});
