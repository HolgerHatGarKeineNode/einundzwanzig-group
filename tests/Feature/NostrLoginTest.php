<?php

use swentel\nostr\Event\Event;
use swentel\nostr\Key\Key;
use swentel\nostr\Sign\Sign;

/**
 * Signiert ein NIP-98-Auth-Event (kind 27235) wie der Client — nur zum
 * Testen der server-seitigen Verifikation.
 *
 * @return array{id: string, pubkey: string, created_at: int, kind: int, tags: array<int, array<int, string>>, content: string, sig: string}
 */
function signHttpAuth(string $url, string $method, string $challenge): array
{
    $key = (new Key)->generatePrivateKey();

    $event = new Event;
    $event->setKind(27235);
    $event->setContent('');
    $event->setTags([
        ['u', $url],
        ['method', $method],
        ['challenge', $challenge],
    ]);

    (new Sign)->signEvent($event, $key);

    return $event->toArray();
}

test('login page renders the nostr auth island', function () {
    $response = $this->get('/nostr-login');

    $response->assertOk();
    // Die client-seitige Login-Insel (Signer bleibt im Browser).
    $response->assertSee('x-data="nostrAuth"', false);
});

test('challenge returns a nonce and the login url', function () {
    $this->getJson('/nostr/challenge')
        ->assertOk()
        ->assertJsonStructure(['challenge', 'url'])
        ->assertJson(['url' => route('chat.nostr.login')]);
});

test('valid nip98 event authenticates the pubkey', function () {
    $challenge = 'challenge-'.str_repeat('a', 54);
    $event = signHttpAuth(route('chat.nostr.login'), 'POST', $challenge);

    $this->withSession([
        'nostr_challenge' => $challenge,
        'nostr_challenge_at' => now()->timestamp,
    ])->postJson(route('chat.nostr.login'), ['event' => $event])
        ->assertOk()
        ->assertJson(['ok' => true, 'pubkey' => $event['pubkey']]);

    expect(session('nostr_pubkey'))->toBe($event['pubkey']);
});

test('tampered signature is rejected', function () {
    $challenge = 'challenge-'.str_repeat('b', 54);
    $event = signHttpAuth(route('chat.nostr.login'), 'POST', $challenge);
    $event['sig'] = str_repeat('0', 128);

    $this->withSession([
        'nostr_challenge' => $challenge,
        'nostr_challenge_at' => now()->timestamp,
    ])->postJson(route('chat.nostr.login'), ['event' => $event])
        ->assertStatus(422);

    expect(session('nostr_pubkey'))->toBeNull();
});

test('wrong challenge is rejected', function () {
    $event = signHttpAuth(route('chat.nostr.login'), 'POST', 'signed-with-other');

    $this->withSession([
        'nostr_challenge' => 'server-expects-this',
        'nostr_challenge_at' => now()->timestamp,
    ])->postJson(route('chat.nostr.login'), ['event' => $event])
        ->assertStatus(422);

    expect(session('nostr_pubkey'))->toBeNull();
});

test('gate redirects guests to login', function () {
    $this->get('/spaces')->assertRedirect(route('chat.nostr-login'));
});

test('gate allows authenticated pubkey', function () {
    $this->withSession(['nostr_pubkey' => str_repeat('a', 64)])
        ->get('/spaces')
        ->assertOk();
});

test('mobile flag is false on the web', function () {
    $this->get('/nostr-login')
        ->assertOk()
        ->assertSee('window.__nostrMobile = false', false);
});

test('mobile flag is true and gate passes through when nativephp runs', function () {
    // Auf dem Gerät gibt es kein NIP-98-Server-Gate (§7): EnsureNostrAuth lässt
    // durch, die Insel gated client-seitig anhand von window.__nostrMobile.
    config()->set('nativephp-internal.running', true);

    $this->get('/spaces')
        ->assertOk()
        ->assertSee('window.__nostrMobile = true', false);
});

test('logout clears the session', function () {
    $this->withSession(['nostr_pubkey' => str_repeat('a', 64)])
        ->postJson(route('chat.nostr.logout'))
        ->assertOk();

    expect(session('nostr_pubkey'))->toBeNull();
});
