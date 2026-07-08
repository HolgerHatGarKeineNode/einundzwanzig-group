<?php

declare(strict_types=1);

use Einundzwanzig\Group\Nostr\SpaceCache;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;

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

test('refreshRelayInfo liest NIP-11 name/description/icon und cached sie (B5)', function () {
    Http::fake(['*' => Http::response(['name' => 'Verein', 'description' => 'Bitcoin', 'icon' => 'https://r/i.png'])]);

    $info = app(SpaceCache::class)->refreshRelayInfo(SpaceCache::spaceUrl());

    expect($info)->toBe(['name' => 'Verein', 'description' => 'Bitcoin', 'icon' => 'https://r/i.png'])
        ->and(Cache::get('nostr:relay-info:'.SpaceCache::spaceUrl()))->toBe($info);
});

test('Space-Seite rendert NIP-11-Namen als Titel und Space-icon als OG-Bild (B5)', function () {
    Cache::put('nostr:relay-info:'.SpaceCache::spaceUrl(), [
        'name' => 'Verein', 'description' => 'Bitcoin', 'icon' => 'https://r/i.png',
    ]);

    $this->withSession(['nostr_pubkey' => str_repeat('a', 64)])
        ->get(route('group.spaces'))
        ->assertOk()
        ->assertSee('<title>Verein', false)
        ->assertSee('/img/og?src='.rawurlencode('https://r/i.png'));
});

test('Space-Seite fällt ohne Relay-Info auf „Space" + Marken-OG zurück (B5)', function () {
    $this->withSession(['nostr_pubkey' => str_repeat('a', 64)])
        ->get(route('group.spaces'))
        ->assertOk()
        ->assertSee('<title>Space', false)
        ->assertSee('og.png');
});

test('Raum-Seite setzt per-Raum-OG-Bild aus dem Raum-picture (B5)', function () {
    Cache::put('nostr:rooms:'.SpaceCache::spaceUrl(), [
        'welcome' => ['name' => 'Willkommen', 'about' => 'Der Startraum', 'picture' => 'https://img/w.png', 'locked' => false],
    ]);

    $this->withSession(['nostr_pubkey' => str_repeat('a', 64)])
        ->get(route('group.room', ['h' => 'welcome']))
        ->assertOk()
        ->assertSee('property="og:image" content="'.url('/img/og?src='.rawurlencode('https://img/w.png')), false);
});
