<?php

namespace Tests\Feature;

use swentel\nostr\Event\Event;
use swentel\nostr\Key\Key;
use swentel\nostr\Sign\Sign;
use Tests\TestCase;

class NostrLoginTest extends TestCase
{
    public function test_login_page_renders_the_nostr_auth_island(): void
    {
        $response = $this->get('/nostr-login');

        $response->assertOk();
        // Die client-seitige Login-Insel (Signer bleibt im Browser).
        $response->assertSee('x-data="nostrAuth"', false);
    }

    public function test_challenge_returns_a_nonce_and_the_login_url(): void
    {
        $this->getJson('/nostr/challenge')
            ->assertOk()
            ->assertJsonStructure(['challenge', 'url'])
            ->assertJson(['url' => route('nostr.login')]);
    }

    public function test_valid_nip98_event_authenticates_the_pubkey(): void
    {
        $challenge = 'challenge-'.str_repeat('a', 54);
        $event = $this->signHttpAuth(route('nostr.login'), 'POST', $challenge);

        $this->withSession([
            'nostr_challenge' => $challenge,
            'nostr_challenge_at' => now()->timestamp,
        ])->postJson(route('nostr.login'), ['event' => $event])
            ->assertOk()
            ->assertJson(['ok' => true, 'pubkey' => $event['pubkey']]);

        $this->assertSame($event['pubkey'], session('nostr_pubkey'));
    }

    public function test_tampered_signature_is_rejected(): void
    {
        $challenge = 'challenge-'.str_repeat('b', 54);
        $event = $this->signHttpAuth(route('nostr.login'), 'POST', $challenge);
        $event['sig'] = str_repeat('0', 128);

        $this->withSession([
            'nostr_challenge' => $challenge,
            'nostr_challenge_at' => now()->timestamp,
        ])->postJson(route('nostr.login'), ['event' => $event])
            ->assertStatus(422);

        $this->assertNull(session('nostr_pubkey'));
    }

    public function test_wrong_challenge_is_rejected(): void
    {
        $event = $this->signHttpAuth(route('nostr.login'), 'POST', 'signed-with-other');

        $this->withSession([
            'nostr_challenge' => 'server-expects-this',
            'nostr_challenge_at' => now()->timestamp,
        ])->postJson(route('nostr.login'), ['event' => $event])
            ->assertStatus(422);

        $this->assertNull(session('nostr_pubkey'));
    }

    public function test_gate_redirects_guests_to_login(): void
    {
        $this->get('/spaces')->assertRedirect(route('nostr-login'));
    }

    public function test_gate_allows_authenticated_pubkey(): void
    {
        $this->withSession(['nostr_pubkey' => str_repeat('a', 64)])
            ->get('/spaces')
            ->assertOk();
    }

    public function test_logout_clears_the_session(): void
    {
        $this->withSession(['nostr_pubkey' => str_repeat('a', 64)])
            ->postJson(route('nostr.logout'))
            ->assertOk();

        $this->assertNull(session('nostr_pubkey'));
    }

    /**
     * Signiert ein NIP-98-Auth-Event (kind 27235) wie der Client — nur zum
     * Testen der server-seitigen Verifikation.
     *
     * @return array{id: string, pubkey: string, created_at: int, kind: int, tags: array<int, array<int, string>>, content: string, sig: string}
     */
    private function signHttpAuth(string $url, string $method, string $challenge): array
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
}
