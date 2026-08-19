<?php

use App\Http\Controllers\ImageProxyController;
use GuzzleHttp\Psr7\Request as PsrRequest;
use GuzzleHttp\Psr7\Response as PsrResponse;
use GuzzleHttp\Psr7\Uri;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;

/**
 * Der SERVERSEITIGE Medien-Riegel des Bild-Proxys.
 *
 * Die Client-Wache (`js/mediaGuard.ts`) ist woanders geprüft und schützt nur den
 * Client. Hier steht die tragende Hälfte: der Endpunkt `/img/{preset}?src=` läuft ohne
 * Session und ohne CSRF, jeder kann ihn von Hand aufrufen. Die Begründung, warum ein
 * Proxy, der relay-eigene Medien holen KÖNNTE, die mitgliedschaftsgebundene ACL des
 * Relays aufhebt, steht am Riegel selbst (`ImageProxyController::__invoke`).
 */
const WORKSPACE = 'wss://buzz.test/';

/** Ein URL, dessen Host geschützt ist — nur der Cache-Pfad soll variieren. */
function guardedSrc(string $path = '/media/a.jpg'): string
{
    return 'https://buzz.test'.$path;
}

beforeEach(function () {
    Storage::fake('local');
    config()->set('group.workspace_url', WORKSPACE);
});

it('rejects media of the workspace relay outright — no fetch, no redirect', function () {
    Http::fake();

    $this->get('/img/avatar?src='.urlencode(guardedSrc()))->assertStatus(403);

    // Ablehnung, kein Ladeversuch: der Server darf diese Bytes nie anfassen.
    Http::assertNothingSent();
});

it('protects the HOST, not a path pattern', function () {
    Http::fake();

    $this->get('/img/avatar?src='.urlencode(guardedSrc('/irgendwas.png')))->assertStatus(403);
    $this->get('/img/full?src='.urlencode(guardedSrc('/')))->assertStatus(403);

    Http::assertNothingSent();
});

/**
 * DER PUNKT, AN DEM DIE REIHENFOLGE HÄNGT.
 *
 * Der Cache-Lookup liegt aus gutem Grund VOR `isSafeUrl` (zwei synchrone
 * `dns_get_record` pro Bild-Request sind auf dem heißen Pfad nicht bezahlbar). Für den
 * Medien-Riegel ist dieselbe Reihenfolge falsch: ein Eintrag, der vor der Einführung
 * des Riegels auf Platte landete, würde sonst weiter ausgeliefert. Steht der Riegel
 * hinter dem Cache-Lookup, wird genau dieser Test rot — und nur dieser.
 */
it('rejects a workspace URL that is ALREADY in the cache (guard runs before the cache lookup)', function () {
    $src = guardedSrc('/media/vorher-gecacht.jpg');
    $path = 'img-cache/avatar/'.sha1($src).'.webp';
    Storage::disk('local')->put($path, 'RIFFgeheim');

    $response = $this->get('/img/avatar?src='.urlencode($src));

    $response->assertStatus(403);
    expect($response->getContent())->not->toContain('geheim');
    // Die Datei bleibt liegen (der Riegel räumt nicht auf) — ausgeliefert wird sie nicht.
    Storage::disk('local')->assertExists($path);
});

it('rejects before the ETag shortcut, too (304 would confirm a copy nobody may hold)', function () {
    $src = guardedSrc('/media/etag.jpg');

    $this->get('/img/avatar?src='.urlencode($src), ['If-None-Match' => '"'.sha1('avatar|'.$src).'"'])
        ->assertStatus(403);
});

/**
 * Verglichen wird der geparste HOST, nicht der rohe String. Die Fälle stammen aus der
 * Client-Wache (`profileMerge.test.ts`/`mediaGuard.test.ts`) und sind hier gegen
 * `GuzzleHttp\Psr7\Uri` neu formuliert — bewusst kein Nachbau der JS-Logik.
 */
it('normalises the host before comparing', function (string $src) {
    Http::fake();

    $this->get('/img/avatar?src='.urlencode($src))->assertStatus(403);

    Http::assertNothingSent();
})->with([
    'Grossschreibung' => 'https://BUZZ.Test/media/a.jpg',
    'Port' => 'https://buzz.test:8443/media/a.jpg',
    'abschliessender Punkt' => 'https://buzz.test./media/a.jpg',
    'Punkt UND Port' => 'https://buzz.test.:443/media/a.jpg',
    'userinfo' => 'https://user:pw@buzz.test/media/a.jpg',
    'Fremdhost als userinfo' => 'https://evil.tld@buzz.test/media/a.jpg',
    'protokollrelativ' => '//buzz.test/media/a.jpg',
    'Schema in Grossschreibung' => 'HTTPS://buzz.test/media/a.jpg',
    // Gemessen: `parse_url` findet hier GAR KEINEN Host, Guzzle findet `buzz.test` und
    // würde ihn kontaktieren. Deshalb parst der Riegel mit Guzzle, nicht mit parse_url.
    'fuehrender Leerraum' => ' https://buzz.test/media/a.jpg',
]);

it('matches an IDN host in both spellings', function () {
    Http::fake();
    config()->set('group.workspace_url', 'wss://xn--bzz-hoa.example/');

    $this->get('/img/avatar?src='.urlencode('https://xn--bzz-hoa.example/media/a.jpg'))->assertStatus(403);
    $this->get('/img/avatar?src='.urlencode('https://büzz.example/media/a.jpg'))->assertStatus(403);
    $this->get('/img/avatar?src='.urlencode('https://bÜzz.example/media/a.jpg'))->assertStatus(403);

    // Und andersherum: steht die Unicode-Form in der Config, trifft auch Punycode.
    config()->set('group.workspace_url', 'wss://büzz.example/');
    $this->get('/img/avatar?src='.urlencode('https://xn--bzz-hoa.example/media/a.jpg'))->assertStatus(403);

    Http::assertNothingSent();
})->skip(! function_exists('idn_to_ascii'), 'ext-intl fehlt — der IDN-Zweig ist dann unentschieden, nicht falsch.');

/**
 * Die Gegenprobe: alles, was nur SO AUSSIEHT, muss unverändert durchgehen. Ein zu
 * strenger Vergleich wirft legitime Fremdbilder weg, und zwar lautlos.
 *
 * Geprüft über einen vorgelegten Cache-Eintrag statt über einen echten Fetch: der
 * Cache-Pfad liegt HINTER dem Riegel und VOR jedem DNS — hätte der Riegel gefeuert,
 * käme 403 statt 200, ganz ohne Netz im Testlauf.
 */
it('lets look-alike hosts through untouched', function (string $src) {
    Storage::disk('local')->put('img-cache/avatar/'.sha1($src).'.webp', 'RIFFdurchgelassen');

    $this->get('/img/avatar?src='.urlencode($src))
        ->assertOk()
        ->assertHeader('Content-Type', 'image/webp');
})->with([
    'Suffix-Angriff' => 'https://buzz.test.evil.tld/media/a.jpg',
    'Praefix-Angriff' => 'https://evilbuzz.test/media/a.jpg',
    'Host als Query-Parameter' => 'https://evil.tld/?x=https://buzz.test/media/a.jpg',
    // Der geschützte Name steht im userinfo, geholt wird evil.tld — der Riegel darf
    // hier NICHT feuern, sonst wäre der Vergleich am rohen String statt am Host.
    'geschuetzter Name als userinfo' => 'https://buzz.test@evil.tld/media/a.jpg',
    'aehnliche TLD' => 'https://buzz.testing/media/a.jpg',
    'Subdomain des geschuetzten Namens' => 'https://cdn.buzz.test/media/a.jpg',
]);

it('is inert when no workspace is configured', function () {
    config()->set('group.workspace_url', null);
    $src = guardedSrc();
    Storage::disk('local')->put('img-cache/avatar/'.sha1($src).'.webp', 'RIFFegal');

    $this->get('/img/avatar?src='.urlencode($src))->assertOk();
});

it('protects every configured workspace when the key holds a list (second tenant)', function () {
    Http::fake();
    config()->set('group.workspace_url', ['wss://buzz.test/', 'wss://zweiter.tenant.test/']);

    $this->get('/img/avatar?src='.urlencode('https://buzz.test/media/a.jpg'))->assertStatus(403);
    $this->get('/img/avatar?src='.urlencode('https://ZWEITER.Tenant.test:443/media/a.jpg'))->assertStatus(403);

    Http::assertNothingSent();
});

/**
 * Die zweite Hälfte des Riegels: ein ERLAUBTER Host, der auf den geschützten umleitet.
 * Der Controller holt selbst und folgt bis zu 3 Weiterleitungen — ohne diese Prüfung
 * ginge das Ziel an jeder Host-Prüfung in `__invoke` vorbei.
 *
 * `Http::fake()` folgt Weiterleitungen NICHT (der Stub-Handler liegt außerhalb von
 * Guzzles Redirect-Middleware). Deshalb wird hier exakt die Closure aufgerufen, die
 * Guzzle im Ernstfall aufruft — geholt aus den echten Optionen, nicht nachgebaut.
 */
it('refuses a redirect that lands on the workspace relay', function () {
    $options = (function (): array {
        $method = new ReflectionMethod(ImageProxyController::class, 'fetchOptions');

        return $method->invoke(new ImageProxyController);
    })();

    $onRedirect = $options['allow_redirects']['on_redirect'];
    expect($onRedirect)->toBeCallable();

    $request = new PsrRequest('GET', 'https://1.1.1.1/a.png');
    $response = new PsrResponse(302);

    // Öffentlicher Fremdhost (IP → kein DNS im Testlauf): darf weiter.
    $onRedirect($request, $response, new Uri('https://1.0.0.1/a.png'));

    // Ziel ist der geschützte Relay: Abbruch, der Fetch endet als 502.
    expect(fn () => $onRedirect($request, $response, new Uri('https://buzz.test/media/a.jpg')))
        ->toThrow(RuntimeException::class, 'relay-hosted media redirect target');

    // Und die Normalisierung gilt auch hier.
    expect(fn () => $onRedirect($request, $response, new Uri('https://BUZZ.Test.:443/media/a.jpg')))
        ->toThrow(RuntimeException::class, 'relay-hosted media redirect target');
});

/*
 * ── Audit 2026-08-19: die zwei Befunde, die den Riegel still hätten aussetzen können ──
 */

it('blocks a percent-encoded host — Uri keeps the escapes, curl resolves them (F2)', function (string $src) {
    Http::fake();

    // Ohne `rawurldecode` in `hostOf` verglich der Riegel `%62uzz.test` und ließ passieren,
    // während curl `buzz.test` kontaktiert hätte. Gestoppt wurde das bisher NUR von
    // `isSafeHost` (PHPs Resolver dekodiert nicht, findet also nichts) — ein Nachbar, der
    // für SSRF gebaut ist und dessen Platz im Ablauf ausdrücklich verschiebbar ist.
    $this->get('/img/avatar?src='.urlencode($src))->assertForbidden();

    Http::assertNothingSent();
})->with([
    'erstes Zeichen kodiert' => 'https://%62uzz.test/media/a.jpg',
    'Punkte kodiert' => 'https://buzz%2Etest/media/a.jpg',
    'gemischt und gross geschrieben' => 'https://%42UZZ.Test/media/a.jpg',
]);

it('still lets an ordinary percent-encoded foreign host through', function () {
    // Gegenkontrolle: die Dekodierung macht die Wache strenger, nicht blind.
    // Kein `Http::fake()` — der Riegel darf hier gerade NICHT greifen, der Request
    // scheitert danach an `isSafeUrl` (kein auflösbarer Host im Testlauf).
    $this->get('/img/avatar?src='.urlencode('https://%65xample.com/a.jpg'))
        ->assertStatus(400);
});

it('logs a warning when a configured entry yields no host — silent inertia is the bug (F1)', function (string $eintrag) {
    Http::fake();
    config()->set('group.workspace_url', $eintrag);

    // `Log::listen` statt eines Facade-Spys: gemessen wird die ECHTE Log-Pipeline mit
    // ihrer echten Nachricht, nicht ein Mock-Aufruf — und es bleibt statisch prüfbar
    // (`shouldHaveReceived` existiert auf der Facade nicht, phpstan meldet es zu Recht).
    $gemeldet = [];
    Log::listen(function ($eintrag) use (&$gemeldet) {
        $gemeldet[] = [$eintrag->level, $eintrag->message];
    });

    // Der Client normalisiert grosszuegiger (welshman setzt `wss://` selbst davor) und
    // laeuft mit so einer Konfiguration vollstaendig korrekt weiter. Genau deshalb muss
    // die serverseitige Haelfte laut werden, statt als „nichts zu schuetzen" durchzufallen.
    $this->get('/img/avatar?src='.urlencode('https://buzz.test/media/a.jpg'));

    $warnungen = array_filter(
        $gemeldet,
        fn (array $z) => $z[0] === 'warning' && str_contains($z[1], 'group.workspace_url'),
    );

    expect($warnungen)->toHaveCount(1, 'ein nicht ableitbarer Eintrag muss laut werden, nicht still durchfallen');
})->with([
    'ohne Schema' => 'buzz.test',
    'ohne Schema, mit Schraegstrich' => 'buzz.test/',
    'Anfuehrungszeichen mitkopiert' => '"wss://buzz.test"',
]);

it('stays silent for a legitimately absent workspace — not configured is not misconfigured', function (mixed $eintrag) {
    config()->set('group.workspace_url', $eintrag);

    $gemeldet = [];
    Log::listen(function ($eintrag) use (&$gemeldet) {
        $gemeldet[] = [$eintrag->level, $eintrag->message];
    });

    $this->get('/img/avatar?src='.urlencode('https://buzz.test/media/a.jpg'));

    $warnungen = array_filter(
        $gemeldet,
        fn (array $z) => $z[0] === 'warning' && str_contains($z[1], 'group.workspace_url'),
    );

    expect($warnungen)->toBe([], 'nicht konfiguriert ist kein Fehler — hier darf nichts gemeldet werden');
})->with([
    'null' => null,
    'leer' => '',
    'nur Leerzeichen' => '   ',
    'leere Liste' => [[]],
]);
