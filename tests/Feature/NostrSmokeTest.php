<?php

test('smoke page renders the nostr island mount point', function () {
    $response = $this->get('/nostr-smoke');

    $response->assertOk();
    // Der wire:ignore-Mount-Point, in den die welshman-Insel rendert.
    $response->assertSee('x-data="nostrSmoke"', false);
});
