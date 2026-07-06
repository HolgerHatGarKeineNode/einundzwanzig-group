<?php

namespace Tests\Feature;

use Tests\TestCase;

class NostrSmokeTest extends TestCase
{
    public function test_smoke_page_renders_the_nostr_island_mount_point(): void
    {
        $response = $this->get('/nostr-smoke');

        $response->assertOk();
        // Der wire:ignore-Mount-Point, in den die welshman-Insel rendert.
        $response->assertSee('x-data="nostrSmoke"', false);
    }
}
