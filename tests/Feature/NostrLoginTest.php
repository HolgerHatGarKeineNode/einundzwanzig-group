<?php

namespace Tests\Feature;

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
}
