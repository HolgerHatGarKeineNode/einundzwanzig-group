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
    Cache::put(ProfileCache::cacheKey($pk), fakeProfileEvent($pk), 60);

    $events = (new ProfileCache)->get([$pk]);

    expect($events)->toHaveCount(1)
        ->and($events[0]->pubkey)->toBe($pk);
});

it('skips known-absent profiles (false sentinel) without refetching', function () {
    $pk = str_repeat('2', 64);
    Cache::put(ProfileCache::cacheKey($pk), false, 60);

    expect((new ProfileCache)->get([$pk]))->toBe([]);
});

it('ignores malformed pubkeys (no fetch, no crash)', function () {
    expect((new ProfileCache)->get(['nothex', 'ABC', str_repeat('z', 64)]))->toBe([]);
});

it('rejects a non-canonical uppercase pubkey (NIP-01 requires lowercase hex)', function () {
    // Eigener Block statt Erweiterung der malformed-Liste oben: die Absicht ist eine
    // andere ("kanonische Kleinschreibung erzwungen" statt "Muell wird ignoriert") und
    // war bislang ungetestet — die vorhandenen Negativfaelle scheitern alle aus einem
    // ANDEREN Grund (zu kurz / kein Hex-Zeichen), keiner davon ist 64-stellig UND nur
    // groszgeschrieben. Ohne diese Bedingung im Regex entstuenden fuer denselben
    // Schluessel zwei Cache-Eintraege (Grosz-/Kleinschreibung) und Relay-Anfragen fuer
    // nicht-kanonische Keys.
    //
    // Ein Event unter dem GROSZGESCHRIEBENEN Schluessel vorzucachen ist Absicht, nicht
    // Zufall: nur so unterscheidet die Assertion "Filter laesst durch" von "Filter
    // blockiert" — ohne Vorbelegung waere das Ergebnis in BEIDEN Faellen [], weil der
    // Fetch-Pfad fuer einen unbekannten Pubkey ohnehin nichts liefert (kein Relay kennt
    // ihn) und die Assertion nie sensitiv fuer die Mutation waere.
    $upper = str_repeat('A', 64);
    Cache::put(ProfileCache::cacheKey($upper), fakeProfileEvent($upper), 60);

    expect((new ProfileCache)->get([$upper]))->toBe([]);
});

it('endpoint returns cached events as json', function () {
    $pk = str_repeat('3', 64);
    Cache::put(ProfileCache::cacheKey($pk), fakeProfileEvent($pk), 60);

    $this->getJson('/nostr/profiles?pubkeys='.$pk)
        ->assertOk()
        ->assertJsonPath('events.0.pubkey', $pk);
});

it('endpoint handles empty pubkeys', function () {
    $this->getJson('/nostr/profiles?pubkeys=')
        ->assertOk()
        ->assertExactJson(['events' => []]);
});

it('namespaces the cache per relay source set (absence is source-dependent)', function () {
    $pk = str_repeat('4', 64);

    // „Bei DIESEN Relays nicht gefunden" ist keine Aussage ueber eine andere
    // Relay-Menge. Der Store ist geteilt (E2E-Worker + Dev-App schreiben hinein),
    // deshalb muss die Quelle im Schluessel stehen.
    config()->set('group.profile_indexer', 'wss://indexer-a.test/');
    $keyA = ProfileCache::cacheKey($pk);

    config()->set('group.profile_indexer', 'wss://indexer-b.test/');
    $keyB = ProfileCache::cacheKey($pk);

    expect($keyA)->not->toBe($keyB)
        ->and($keyA)->toStartWith('nostr:profile:')
        ->and($keyA)->toEndWith(':'.$pk);
});

it('does not consult the public indexer when it is configured empty', function () {
    config()->set('group.profile_indexer', '');
    $pk = str_repeat('5', 64);

    // Abwesenheit unter dem LEEREN-Indexer-Schluessel vorbelegen: `get()` darf
    // damit auskommen und keinen Relay anfassen (waere sonst ein Netzzugriff im Test).
    Cache::put(ProfileCache::cacheKey($pk), false, 60);

    expect((new ProfileCache)->get([$pk]))->toBe([]);
});
