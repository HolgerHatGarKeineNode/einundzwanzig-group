<?php

use Einundzwanzig\Group\Nostr\ProfileCache;
use Illuminate\Support\Facades\Cache;

function fakeProfileEvent(string $pubkey): object
{
    return (object) [
        'id' => str_repeat('a', 64),
        'pubkey' => $pubkey,
        'created_at' => 1_700_000_000,
        'kind' => 0,
        'tags' => [],
        'content' => '{"name":"Test"}',
        'sig' => str_repeat('b', 128),
    ];
}

it('returns cached profiles without fetching', function () {
    $pk = str_repeat('1', 64);
    Cache::put('nostr:profile:'.$pk, fakeProfileEvent($pk), 60);

    $events = (new ProfileCache)->get([$pk]);

    expect($events)->toHaveCount(1)
        ->and($events[0]->pubkey)->toBe($pk);
});

it('skips known-absent profiles (false sentinel) without refetching', function () {
    $pk = str_repeat('2', 64);
    Cache::put('nostr:profile:'.$pk, false, 60);

    expect((new ProfileCache)->get([$pk]))->toBe([]);
});

it('ignores malformed pubkeys (no fetch, no crash)', function () {
    expect((new ProfileCache)->get(['nothex', 'ABC', str_repeat('z', 64)]))->toBe([]);
});

it('endpoint returns cached events as json', function () {
    $pk = str_repeat('3', 64);
    Cache::put('nostr:profile:'.$pk, fakeProfileEvent($pk), 60);

    $this->getJson('/nostr/profiles?pubkeys='.$pk)
        ->assertOk()
        ->assertJsonPath('events.0.pubkey', $pk);
});

it('endpoint handles empty pubkeys', function () {
    $this->getJson('/nostr/profiles?pubkeys=')
        ->assertOk()
        ->assertExactJson(['events' => []]);
});
