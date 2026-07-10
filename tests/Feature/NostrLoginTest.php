<?php

use Illuminate\Support\Facades\Cache;
use Livewire\Livewire;
use swentel\nostr\Event\Event;
use swentel\nostr\Key\Key;
use swentel\nostr\Sign\Sign;

/**
 * Signiert ein NIP-98-Auth-Event (kind 27235) wie der Client — nur zum
 * Testen der server-seitigen Verifikation. `$createdAtOffset` datiert das Event
 * zurück (Sekunden), um das EVENT_MAX_AGE-Fenster zu prüfen (langsames Amber).
 *
 * @return array{id: string, pubkey: string, created_at: int, kind: int, tags: array<int, array<int, string>>, content: string, sig: string}
 */
function signHttpAuth(string $url, string $method, string $challenge, int $createdAtOffset = 0): array
{
    $key = (new Key)->generatePrivateKey();

    $event = new Event;
    $event->setKind(27235);
    $event->setContent('');
    $event->setCreatedAt(now()->timestamp - $createdAtOffset);
    $event->setTags([
        ['u', $url],
        ['method', $method],
        ['challenge', $challenge],
    ]);

    (new Sign)->signEvent($event, $key);

    return $event->toArray();
}

/** Nonce so ablegen, wie es der challenge-Endpoint tut (Cache, gekeyt auf den Wert). */
function seedChallenge(string $challenge): void
{
    Cache::put('nostr:challenge:'.$challenge, true, 300);
}

test('login page renders the nostr auth island', function () {
    $response = $this->get('/nostr-login');

    $response->assertOk();
    // Die client-seitige Login-Insel (Signer bleibt im Browser).
    $response->assertSee('x-data="nostrAuth"', false);
});

test('P6: login-form zeigt genau einen Primär-CTA + Andere Optionen (Methoden-Prio §5.1)', function () {
    $html = $this->get('/nostr-login')->assertOk()->getContent();

    // Ein primärer Web-CTA (NIP-07) + die aufklappbare Sekundär-Sektion.
    expect($html)->toContain('Mit Browser-Erweiterung anmelden');
    expect($html)->toContain('Andere Optionen');
    // Der Signer-per-QR-Pfad (nostrconnect) ersetzt im Web die Amber-Marke.
    expect($html)->toContain('Signer per QR verbinden');
    // „Neu bei Nostr?"-Erklär-Panel (§5.1), kein Registrieren-Wizard.
    expect($html)->toContain('Neu bei Nostr?');
});

test('P6: nsec liegt hinter dem Checkbox-Gate (Härtung §5.1)', function () {
    $html = $this->get('/nostr-login')->assertOk()->getContent();

    // Consent-Checkbox schaltet den Button frei; ohne Zustimmung bleibt er disabled.
    expect($html)->toContain('Ich verstehe das Risiko');
    expect($html)->toContain('x-model="nsecOk"');
    expect($html)->toContain('!nsecOk || busy');
});

test('P6: kein Lightning-Login im Web-Client (§8.5)', function () {
    // Web = eigenständiger Chat+Wallet-Client ohne Portal → im Login kein
    // Lightning/LNURL-Zweig (Wallet-Lightning bleibt im Wallet-Tab unberührt).
    $this->get('/nostr-login')
        ->assertOk()
        ->assertDontSee('LNURL')
        ->assertDontSee('Lightning');
});

test('P6: das globale Login-Sheet ist gemountet und fängt open-login-sheet ab (§4.2)', function () {
    // Layout mountet <x-group::login-sheet> außerhalb des $slot → jede Seite kann
    // das authGate-Event abfangen (in-place statt Redirect). Insel deferred (x-if).
    $this->get('/nostr-login')
        ->assertOk()
        ->assertSee('open-login-sheet.window', false)
        ->assertSee('role="dialog"', false);
});

test('challenge returns a nonce and the login url', function () {
    $this->getJson('/nostr/challenge')
        ->assertOk()
        ->assertJsonStructure(['challenge', 'url'])
        ->assertJson(['url' => route('group.nostr.login')]);
});

test('challenge issues a nonce that authenticates end-to-end', function () {
    // Realer Flow: GET /nostr/challenge → signieren → POST /nostr/login. Die Nonce
    // lebt im (geteilten) Cache, nicht in einem Session-Slot.
    $challenge = $this->getJson('/nostr/challenge')->json('challenge');
    $event = signHttpAuth(route('group.nostr.login'), 'POST', $challenge);

    $this->postJson(route('group.nostr.login'), ['event' => $event])
        ->assertOk()
        ->assertJson(['ok' => true, 'pubkey' => $event['pubkey']]);

    expect(session('nostr_pubkey'))->toBe($event['pubkey']);
});

test('tampered signature is rejected', function () {
    $challenge = 'challenge-'.str_repeat('b', 54);
    seedChallenge($challenge);
    $event = signHttpAuth(route('group.nostr.login'), 'POST', $challenge);
    $event['sig'] = str_repeat('0', 128);

    $this->postJson(route('group.nostr.login'), ['event' => $event])
        ->assertStatus(422);

    expect(session('nostr_pubkey'))->toBeNull();
});

test('wrong challenge is rejected', function () {
    // Server gab eine Challenge aus; der Client signiert eine andere → kein Cache-Treffer.
    seedChallenge('server-expects-this');
    $event = signHttpAuth(route('group.nostr.login'), 'POST', 'signed-with-other');

    $this->postJson(route('group.nostr.login'), ['event' => $event])
        ->assertStatus(422);

    expect(session('nostr_pubkey'))->toBeNull();
});

test('nonce is single-use — replay is rejected', function () {
    $challenge = $this->getJson('/nostr/challenge')->json('challenge');
    $event = signHttpAuth(route('group.nostr.login'), 'POST', $challenge);

    $this->postJson(route('group.nostr.login'), ['event' => $event])->assertOk();
    // Zweiter POST mit derselben (bereits verbrauchten) Challenge → abgelehnt.
    $this->postJson(route('group.nostr.login'), ['event' => $event])
        ->assertStatus(422);
});

test('overlapping challenges stay independently valid', function () {
    // Regression „Challenge ungültig": zwei überlappende Handoffs holen je eine Nonce
    // auf DERSELBEN Session. Früher überschrieb die zweite die erste (ein Session-Slot)
    // → der langsame erste POST fiel durch. Mit Cache-Nonce pro Challenge-Wert bleiben
    // beide gültig; der erste POST authentifiziert trotz zweiter, neuerer Challenge.
    $first = $this->getJson('/nostr/challenge')->json('challenge');
    $second = $this->getJson('/nostr/challenge')->json('challenge');
    expect($first)->not->toBe($second);

    $event = signHttpAuth(route('group.nostr.login'), 'POST', $first);
    $this->postJson(route('group.nostr.login'), ['event' => $event])
        ->assertOk()
        ->assertJson(['ok' => true]);
});

test('unknown or expired challenge is rejected', function () {
    $event = signHttpAuth(route('group.nostr.login'), 'POST', 'never-issued-'.str_repeat('c', 40));

    $this->postJson(route('group.nostr.login'), ['event' => $event])
        ->assertStatus(422);
});

test('event within the widened age window is accepted (langsames Amber)', function () {
    // EVENT_MAX_AGE=300: created_at wird beim Template-Bau gestempelt, VOR dem u.U.
    // langsamen Amber-Roundtrip. Ein 200s altes Event darf nicht als „abgelaufen"
    // durchfallen, solange die Challenge (TTL 300) noch gültig ist.
    $challenge = $this->getJson('/nostr/challenge')->json('challenge');
    $event = signHttpAuth(route('group.nostr.login'), 'POST', $challenge, createdAtOffset: 200);

    $this->postJson(route('group.nostr.login'), ['event' => $event])
        ->assertOk()
        ->assertJson(['ok' => true]);
});

test('event older than the age window is rejected', function () {
    $challenge = $this->getJson('/nostr/challenge')->json('challenge');
    $event = signHttpAuth(route('group.nostr.login'), 'POST', $challenge, createdAtOffset: 400);

    $this->postJson(route('group.nostr.login'), ['event' => $event])
        ->assertStatus(422);
});

test('gate redirects guests to login', function () {
    $this->get('/spaces')->assertRedirect(route('group.nostr-login'));
});

test('gate allows authenticated pubkey', function () {
    $this->withSession(['nostr_pubkey' => str_repeat('a', 64)])
        ->get('/spaces')
        ->assertOk();
});

test('gate remembers the deep-linked url so login can resume there', function () {
    // §4.2 „Deep-Link-Refresh → Login mit korrektem return": ein direkter Hit auf
    // eine gegatete Route (Refresh/geteilter Link) merkt sich die Zielroute in
    // url.intended — der Login springt danach exakt dorthin zurück, nicht aufs Default.
    $this->get('/settings/wallet')
        ->assertRedirect(route('group.nostr-login'));

    expect(session('url.intended'))->toBe(url('/settings/wallet'));
});

test('login returns the intended url as redirect target', function () {
    // Der ganze resume-Bogen: gegateter Deep-Link → Login-Handoff → der Server
    // gibt die gemerkte Ziel-URL als `redirect` zurück (der Client assign()t sie).
    $this->get('/settings/wallet')->assertRedirect(route('group.nostr-login'));

    $challenge = $this->getJson('/nostr/challenge')->json('challenge');
    $event = signHttpAuth(route('group.nostr.login'), 'POST', $challenge);

    $this->postJson(route('group.nostr.login'), ['event' => $event])
        ->assertOk()
        ->assertJson(['redirect' => url('/settings/wallet')]);
});

test('mobile flag is false on the web', function () {
    $this->get('/nostr-login')
        ->assertOk()
        ->assertSee('window.__nostrMobile = window.__nostrMobile ?? false', false);
});

test('mobile flag is true and gate passes through when nativephp runs', function () {
    // Auf dem Gerät gibt es kein NIP-98-Server-Gate (§7): EnsureNostrAuth lässt
    // durch, die Insel gated client-seitig anhand von window.__nostrMobile.
    config()->set('nativephp-internal.running', true);

    $this->get('/spaces')
        ->assertOk()
        ->assertSee('window.__nostrMobile = window.__nostrMobile ?? true', false);
});

test('nostr-login renders the client-side Amber flow (no server round-trip)', function () {
    // Amber wird auf dem Gerät direkt aus der Insel über die NativePHP-Bridge
    // (Browser.Open) geöffnet — kein Livewire-Roundtrip, der den ersten Tap
    // schluckte. Die SFC hat dafür bewusst KEINE Server-Methode mehr; die Seite
    // rendert die Amber-Option client-seitig.
    Livewire::test('group::nostr-login')
        ->assertOk()
        ->assertSee('Amber');
});

test('logout clears the session', function () {
    $this->withSession(['nostr_pubkey' => str_repeat('a', 64)])
        ->postJson(route('group.nostr.logout'))
        ->assertOk();

    expect(session('nostr_pubkey'))->toBeNull();
});
