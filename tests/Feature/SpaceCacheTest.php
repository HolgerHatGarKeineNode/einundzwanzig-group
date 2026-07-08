<?php

declare(strict_types=1);

use Einundzwanzig\Group\Nostr\SpaceCache;
use Illuminate\Support\Facades\Cache;

test('parseRooms extrahiert Name/Beschreibung/Bild/Zugriff je h, überspringt d-lose Events', function () {
    $events = [
        (object) ['tags' => [['d', 'welcome'], ['name', 'Willkommen'], ['about', 'Der Startraum'], ['picture', 'https://img/w.png']]],
        (object) ['tags' => [['d', 'vip'], ['name', 'VIP'], ['private']]],   // Presence-Tag → locked
        (object) ['tags' => [['d', 'general']]],            // ohne name/about → Fallback auf h
        (object) ['tags' => [['name', 'ohne d-Tag']]],       // kein d → übersprungen
    ];

    expect(SpaceCache::parseRooms($events))->toBe([
        'welcome' => ['name' => 'Willkommen', 'about' => 'Der Startraum', 'picture' => 'https://img/w.png', 'locked' => false],
        'vip' => ['name' => 'VIP', 'about' => '', 'picture' => '', 'locked' => true],
        'general' => ['name' => 'general', 'about' => '', 'picture' => '', 'locked' => false],
    ]);
});

test('Raum-Seite rendert gecachten Namen in Titel/Header und Beschreibung als OG', function () {
    Cache::put('nostr:rooms:'.SpaceCache::spaceUrl(), [
        'welcome' => ['name' => 'Willkommen', 'about' => 'Der Startraum', 'picture' => 'https://img/w.png', 'locked' => false],
    ]);

    $this->withSession(['nostr_pubkey' => str_repeat('a', 64)])
        ->get(route('group.room', ['h' => 'welcome']))
        ->assertOk()
        ->assertSee('# Willkommen')
        ->assertSee('Der Startraum')
        // IMG (PLAN4): Raum-Avatar im Header läuft über den Bild-Proxy.
        ->assertSee('/img/avatar?src='.rawurlencode('https://img/w.png'));
});

test('Raum-Seite fällt bei Cache-Miss auf die rohe Raum-ID zurück', function () {
    $this->withSession(['nostr_pubkey' => str_repeat('a', 64)])
        ->get(route('group.room', ['h' => 'nochnie']))
        ->assertOk()
        ->assertSee('# nochnie');
});
