<?php

declare(strict_types=1);

use Illuminate\Http\Response;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * **Die Einstiege, die es unterhalb `xl` vorher NICHT gab.**
 *
 * Fünf Sachen hingen im Chat-Client ausschließlich an der Desktop-Rail oder an der
 * Befehlspalette. Die Rail rendert der NativePHP-Host serverseitig nie
 * (`app-frame.blade.php`: `$rail && ! Chassis::istApp()`) und der Web-Client erst ab
 * `xl` (`<template x-if="$store.viewport?.desktop">`) — auf einem Telefon und in einem
 * schmalen Fenster war das also gar kein Weg. Die Befehlspalette war der andere, und sie
 * ist im Mobile-Host auf den Host-Screens sogar von der App-eigenen Suche überlagert
 * (`layouts/mobile.blade.php` fängt `open-command-palette` ab).
 *
 * Counted at the stock, not estimated: `route('group.bereich.leute')` and
 * `route('group.ich.einstellungen')` occurred at EXACTLY ONE place in the whole package
 * (`command-palette.blade.php`), `route('group.ich.lesezeichen')` at two (palette and rail
 * footer).
 *
 * ── Was diese Datei prüft und was NICHT ──────────────────────────────────────────
 *
 * Sie prüft die ANWESENHEIT und die ZUORDNUNG der Einstiege im ausgelieferten HTML —
 * also das, was ein Server-Test entscheiden kann. Die Geometrie (44-px-Ziele, kein
 * Überlauf bei 320 px, die Position des Abschnitts) ist am gerenderten Element gemessen
 * worden und gehört nicht hierher: eine CSS-Klassen-Assertion ist keine Messung.
 */
/**
 * @param  array<string, mixed>  $params
 * @return TestResponse<Response>
 */
function mitSitzung(TestCase $t, string $route, array $params = []): TestResponse
{
    return $t->withSession(['nostr_pubkey' => str_repeat('a', 64)])->get(route($route, $params));
}

/**
 * An address exactly as it REALLY stands inside the command palette's attribute list.
 *
 * The palette receives its commands through `@js()`. That is `json_encode` inside a
 * `JSON.parse('…')`, and the result is escaped several times over: `json_encode` turns a
 * slash into backslash-slash, and because the result is embedded once more as a JS string
 * literal inside an HTML attribute, THREE backslashes end up in front of every slash.
 * Measured at the rendered attribute (2026-09-18); the literal itself is built by
 * `str_replace` below rather than written out here, so that the count does not run through
 * yet another escaping layer in this comment.
 *
 * A test that looks for the raw URL NEVER finds it there — and would be permanently green
 * in the negative direction without measuring anything. That is exactly what the first
 * version of this case did, and it is the reason this function exists instead of a string
 * at the call site.
 */
function alsPaletteUrl(string $url): string
{
    return str_replace('/', '\\\\\\/', $url);
}

// ── Der Kernbeweis ──────────────────────────────────────────────────────────────────

test('CORE PROOF: every surface carries the avatar, and everything of one own hangs behind it in ONE place', function () {
    // ── What this case checked until P2 ───────────────────────────────────────────
    // Three ways in that existed below `xl` only through the command palette:
    // `/directory` at the space block, `/bookmarks` and `/settings` as rows in the room
    // list's profile popover. They were the answer to a navigation with no level above the
    // chat — every surface had to find itself a place on `/spaces`.
    //
    // Since Concept C that level exists: the AVATAR stands in every header and leads to
    // „Ich", and bookmarks, association, wallet and settings are rows there. The ways in are
    // therefore not gone, they are in one place — and that place is the same on EVERY
    // surface. That is what has to be shown here, and over several surfaces: a promise about
    // ONE place is none.
    foreach (['group.bereich.chat', 'group.bereich.leute', 'group.postfach', 'group.start'] as $route) {
        $html = (string) mitSitzung($this, $route)->assertOk()->getContent();

        expect(substr_count($html, 'data-app-header-avatar'))->toBe(1, $route);
        expect($html)->toContain('href="'.route('group.ich').'"');
    }

    // And „Ich" carries the destinations that used to live in the drawer — as rows with an
    // anchor of their own, so a test does not measure an arbitrary link on the page.
    $ich = (string) mitSitzung($this, 'group.ich')->assertOk()->getContent();

    expect($ich)
        ->toContain('href="'.route('group.ich.lesezeichen').'"')
        ->toContain('href="'.route('group.bereich.wallet').'"')
        ->toContain('href="'.route(config('group.settings_route')).'"');
    expect(substr_count($ich, 'data-ich-ziel="'))->toBeGreaterThanOrEqual(3);

    // The member directory stays at the space block — it answers "who is here", not "who am
    // I", and therefore belongs precisely NOT under „Ich".
    $chat = (string) mitSitzung($this, 'group.bereich.chat')->assertOk()->getContent();
    expect($chat)->toContain('data-space-mitglieder');
    expect($chat)->toContain(route('group.bereich.leute'));

    // And the section for the conversations, together with its open button.
    expect($chat)
        ->toContain('data-dm-panel')
        ->toContain('data-dm-neu');
});

test('der DM-Abschnitt hängt an der Breite UND am Tab — nicht nur an einem von beiden', function () {
    $html = (string) mitSitzung($this, 'group.bereich.chat')->assertOk()->getContent();

    // Die Bedingung steht im `x-if` des Aufrufers. Alle drei Teile müssen darin
    // stehen, und zwar aus je eigenem Grund:
    //   `tab === 'rooms'` — Flux lässt das Panel eines NICHT gewählten Tabs im DOM,
    //   `!focusMode()`    — im Fokus-Modus zeigt die Karte genau eine Liste,
    //   `!desktop`        — ab xl trägt die Rail die Unterhaltungen.
    // Fehlte einer, meldete `armList()` eine Ableitung an, die niemand sieht: Alpine
    // initialisiert `x-data` auch in per CSS versteckten Elementen.
    expect($html)->toContain('tab === &#039;rooms&#039; &amp;&amp; !focusMode() &amp;&amp; !$store.viewport?.desktop');
});

// ── The Buzz DM dialog is gone, and the NIP-17 store took its place ────────────────

test('the Buzz DM dialog is nowhere in the document any more', function () {
    $html = (string) mitSitzung($this, 'group.bereich.chat')->assertOk()->getContent();

    // `flux:modal name="dm"` renders `data-modal="dm"`. Until P7 it stood there exactly
    // once; now that the unencrypted conversations are gone it belongs nowhere — a new
    // conversation is created in the person picker on `/messages`.
    expect(substr_count($html, 'data-modal="dm"'))->toBe(0);

    // And the component itself is deleted — "not in the HTML" would also be green if it
    // were merely unreferenced and living on as dead code.
    $views = __DIR__.'/../../packages/einundzwanzig-group/resources/views/components/';
    expect(file_exists($views.'dm-modal.blade.php'))->toBeFalse();
});

test('the wrap store is mounted on EVERY page behind the gate — exactly once', function () {
    // This is the promise that justifies the location: `app-frame` is the root of exactly
    // those pages, and the wrap subscription is the one request whose answers cost the
    // signer. A second mount would be a second reason to keep it alive; none would leave
    // the rail and the overview with an empty list.
    foreach (['group.bereich.chat', 'group.bereich.leute', 'group.ich.lesezeichen', 'group.postfach', 'group.start', 'group.ich'] as $route) {
        $html = (string) mitSitzung($this, $route)->assertOk()->getContent();

        expect(substr_count($html, 'x-data="nostrPrivateMessages"'))->toBe(1, $route);
    }

    // CONTROL: the rail does NOT mount the store itself. "Exactly once" above would also
    // be green if the mount had moved from `app-frame` into the rail — and then it would
    // stand nowhere on a phone. Checked at the source with comments stripped, because
    // `desktop-rail.blade.php` EXPLAINS the location in prose.
    $views = __DIR__.'/../../packages/einundzwanzig-group/resources/views/components/';
    $ohneKommentare = fn (string $datei): string => (string) preg_replace(
        '/\{\{--[\s\S]*?--\}\}/', '', (string) file_get_contents($views.$datei)
    );

    expect($ohneKommentare('desktop-rail.blade.php'))->not->toContain('nostrPrivateMessages');
    expect($ohneKommentare('app-frame.blade.php'))->toContain('x-data="nostrPrivateMessages"');

    // CONTROL: the comment stripper really strips. Anchored on a string the rail carries
    // ONLY in prose — "wrap subscription" stands in the paragraph explaining why the mount
    // lives elsewhere. Without this control the assertion above would also be green if
    // `preg_replace` swallowed the whole file (`null` → `''` through the string cast), and
    // then the case would check nothing at all.
    $railRoh = (string) file_get_contents($views.'desktop-rail.blade.php');
    expect($railRoh)->toContain('wrap subscription');
    expect($ohneKommentare('desktop-rail.blade.php'))->not->toContain('wrap subscription');
});

// ── Der eigene Präsenzpunkt ─────────────────────────────────────────────────────────

test('the own presence dot hangs on the avatar — with the same expression as in the rail', function () {
    $html = (string) mitSitzung($this, 'group.bereich.chat')->assertOk()->getContent();

    // Der Punkt ist EIN Attribut, und der Ausdruck ist der springende Punkt:
    // `$store.presence.mine` und nicht `byPubkey[<self>]` — der Relay fanoutet das
    // eigene 20001 nicht verlässlich an die eigene Verbindung zurück.
    expect(substr_count($html, 'presence="$store.presence?.mine"'))->toBeGreaterThanOrEqual(1);

    // Positive control for the attribution: the expression stands inside the avatar block,
    // not somewhere on the page. Measured by the distance to the anchor — only the
    // `nostr-avatar` markup lies in between. Since P2 the anchor is called
    // `data-app-header-avatar`; the profile chip the dot used to hang on went with the
    // popover.
    $anker = strpos($html, 'data-app-header-avatar');
    expect($anker)->toBeInt();
    $punkt = strpos($html, 'presence="$store.presence?.mine"', (int) $anker);
    expect($punkt)->toBeInt();
    expect($punkt - $anker)->toBeLessThan(2000);
});

// ── Die Einstellungen-Route kommt vom HOST ──────────────────────────────────────────

test('palette and Ich lead to the SAME settings route, and the host names it', function () {
    // A deliberately WRONG target so the case is not tautological: with the default both
    // readers pointed at `/ich/einstellungen` anyway, and the config line would stay
    // unproven.
    config(['group.settings_route' => 'group.ich.lesezeichen']);

    // Reader 1: the row on „Ich". Checked against the count and not against a bare URL —
    // `/ich/lesezeichen` stands on this page anyway, it has a row of its own for it.
    $ich = (string) mitSitzung($this, 'group.ich')->assertOk()->getContent();
    expect(substr_count($ich, 'href="'.route('group.ich.lesezeichen').'"'))->toBe(2);
    expect($ich)->not->toContain('href="'.route('group.ich.einstellungen').'"');

    // Reader 2: the command palette (it hangs in the layout, so it stands on every surface).
    $chat = (string) mitSitzung($this, 'group.bereich.chat')->assertOk()->getContent();
    expect($chat)->toContain(alsPaletteUrl(route('group.ich.lesezeichen')));
    expect($chat)->not->toContain(alsPaletteUrl(route('group.ich.einstellungen')));
});

test('CONTROL: with the default both point at the package route', function () {
    // The counter-proof for the case above — without it `settings_route` could simply be
    // ignored and `/ich/lesezeichen` rendered every time.
    expect(config('group.settings_route'))->toBe('group.ich.einstellungen');

    expect((string) mitSitzung($this, 'group.ich')->assertOk()->getContent())
        ->toContain('href="'.route('group.ich.einstellungen').'"');
    expect((string) mitSitzung($this, 'group.bereich.chat')->assertOk()->getContent())
        ->toContain(alsPaletteUrl(route('group.ich.einstellungen')));
});
