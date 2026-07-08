<?php

declare(strict_types=1);

/**
 * D3 (Zustände & System-Konsistenz): jede Chat-Seite rendert ihre Lade-/Empty-/
 * Fehler-Zustände deklarativ im Blade (die Alpine-Zweige stehen alle im DOM).
 * Diese Tests prüfen, dass die `ready`-Guards + Skeleton/Empty/Error-Markup da
 * sind — nicht das JS-Verhalten (das deckt Playwright ab).
 */
test('Space-Seite: First-Paint-Skeleton statt nackter Fläche + echter Räume-Empty-State', function () {
    $res = $this->withSession(['nostr_pubkey' => str_repeat('a', 64)])->get(route('chat.spaces'))->assertOk();

    // Skeleton solange die Space-Meta fehlt (kein x-show="space" mehr am Wrapper).
    $res->assertSee('x-show="!space && loading"', false);
    // „keine Räume" ist ein Icon-Empty-State, keine graue Textzeile mehr.
    $res->assertSee('empty-state', false);
    $res->assertSee('Dieser Space hat noch keine Räume.');
});

test('Directory: list-stagger setzt --i pro Karte + Skeleton meldet aria-busy', function () {
    $res = $this->withSession(['nostr_pubkey' => str_repeat('a', 64)])->get(route('chat.directory'))->assertOk();

    $res->assertSee('list-stagger', false);
    $res->assertSee('--i:${idx}', false);
    $res->assertSee('aria-busy="true"', false);
    $res->assertSee('Mitglieder werden geladen…');
});

test('Raum: Inline-Fehler-Callout mit Retry + aria-busy am Verlauf', function () {
    $res = $this->withSession(['nostr_pubkey' => str_repeat('a', 64)])->get(route('chat.room', ['h' => 'welcome']))->assertOk();

    // Persistenter Callout statt flüchtigem Toast, mit Retry-Aktion.
    $res->assertSee('x-if="error"', false);
    $res->assertSee('retry()', false);
    $res->assertSee('Erneut laden');
    // Screenreader-Signal während des ersten Ladens.
    $res->assertSee('::aria-busy="loading && messages.length === 0"', false);
    $res->assertSee('Verlauf wird geladen…');
});

test('Space-Einstellungen: ready-Guard verhindert Empty-Flash', function () {
    $res = $this->withSession(['nostr_pubkey' => str_repeat('a', 64)])->get(route('chat.space.settings'))->assertOk();

    // Empty erst nach ready — Skeleton davor (Fix-A-Muster).
    $res->assertSee('x-if="!ready"', false);
    $res->assertSee('x-if="ready && spaces.length === 0"', false);
    $res->assertSee('Spaces werden geladen…');
});

test('Login: QR-Skeleton statt Plain-Text + Lade-Label an den Buttons', function () {
    $res = $this->get(route('chat.nostr-login'))->assertOk();

    $res->assertSee('skeleton size-56', false);
    $res->assertSee('Verbinde…');
});
