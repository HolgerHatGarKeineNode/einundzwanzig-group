<?php

declare(strict_types=1);

use Livewire\Livewire;

/**
 * „Ich › Verein" (`/ich/verein`, D11, P5) — everything the SERVER decides about it.
 *
 * ── What CANNOT be measured here, and where it is measured instead ────────────────────
 *
 * This page has no server state, and that is not a shortcut: every read of the membership
 * API carries a NIP-98 signature, and that signature is made in the browser with a key the
 * server never sees. Status, contribution year and receipts therefore come out of the
 * island (`js/mitgliedschaft.ts`) and its rules out of `js/mitgliedschaftModelle.ts` — the
 * four states, the ten-minute cache and the 401 way out, each with a `node --test` case.
 *
 * What the server decides is everything in this file: who gets to see the page at all,
 * what it says without a configured association, and that the surface the island is
 * supposed to drive really stands in the document.
 */
beforeEach(function (): void {
    config([
        'group.verein_api_url' => 'https://verein.test',
        'group.verein_public_url' => 'https://verein.test/beitritt',
    ]);
});

test('a guest is sent to the login', function () {
    // `nostr.auth` on the route: this page holds ONE person's membership, and a guest has
    // none. A case of its own rather than the second half of the next one: `withSession()`
    // applies to EVERY later request of the same test, so a guest after a member would still
    // be signed in and the latch would go green unmeasured.
    $this->get(route('group.ich.verein'))->assertRedirect(route('group.nostr-login'));
});

test('a member reaches the page', function () {
    // In the app the island decides on top of this (the login state lives in the browser
    // only, D4) — `data-verein-abgemeldet` in the case below is that second latch.
    $this->withSession(['nostr_pubkey' => str_repeat('a', 64)])
        ->get(route('group.ich.verein'))
        ->assertOk()
        ->assertSee('Deine Mitgliedschaft');
});

test('the page carries the island and its two honest states', function () {
    $html = (string) $this->withSession(['nostr_pubkey' => str_repeat('a', 64)])
        ->get(route('group.ich.verein'))->getContent();

    expect($html)->toContain('nostrVereinMitgliedschaft')
        // Signed out: in the app the login state is client-side, so the island answers and
        // not the server.
        ->and($html)->toContain('data-verein-abgemeldet')
        // And the state a surface tends to forget: the association was not reachable. Saying
        // „kein Antrag" there would be a statement about somebody's membership that nobody
        // measured.
        ->and($html)->toContain('data-verein-satz="unbekannt"')
        // Only the ASCII part of the sentence: the typographic quotes around „nein“ pass
        // through `htmlspecialchars` unchanged, while an ASCII quote would come out as
        // `&quot;` and the case would be red for the wrong reason.
        ->and($html)->toContain('dein Status ist damit nicht bekannt, nicht');
});

test('the four status sentences and the way into the join flow are all there', function () {
    $html = (string) $this->withSession(['nostr_pubkey' => str_repeat('a', 64)])
        ->get(route('group.ich.verein'))->getContent();

    foreach (['mitglied', 'zahlung-offen', 'kein-antrag', 'unbekannt'] as $zustand) {
        expect($html)->toContain('data-verein-satz="'.$zustand.'"');
    }

    // One way in, not two: the join flow decides its own step from `/me` and `/config`, and
    // a second entry point would be a second answer to „where do I stand?".
    expect($html)->toContain('data-verein-beitritt')
        ->and($html)->toContain(route('group.verein.join'));
});

test('the receipts are asked for, not loaded — a second signature is a second prompt', function () {
    $html = (string) $this->withSession(['nostr_pubkey' => str_repeat('a', 64)])
        ->get(route('group.ich.verein'))->getContent();

    expect($html)->toContain('data-verein-belege-laden')
        ->and($html)->toContain('holeBelege()')
        // The sentence that explains the button: NIP-98 signs ONE address and ONE method, so
        // `/me` and `/payments` cannot share a signature.
        ->and($html)->toContain('jeder Abruf kostet eine Signatur');
});

test('an error shows its way out, and an auth failure signs ANEW', function () {
    $html = (string) $this->withSession(['nostr_pubkey' => str_repeat('a', 64)])
        ->get(route('group.ich.verein'))->getContent();

    // The one promise of this path: no error state without a visible way out. And the way
    // out is PRESSED, never taken automatically — the association burns the event id of the
    // rejected attempt (replay lock), and a silent second attempt with a fresh event would be
    // a bunker prompt nobody asked for.
    expect($html)->toContain('data-verein-fehler')
        ->and($html)->toContain('data-verein-erneut')
        ->and($html)->toContain('erneut()');
});

test('the not-set-up card is on the page, and the island decides it', function () {
    // Without a base URL the `u` tag could not name the association and every signature
    // would be worthless — so the page says so instead of showing an empty frame. The ROW
    // under „Ich" disappears in that case (the case below), but a hardlink still reaches the
    // page.
    //
    // Decided in the ISLAND (`eingerichtet`), although the value comes from the same config
    // key: the page has no other server state, and one value read in two places is one place
    // too many. All this case says is that both halves stand in the document and hang on the
    // same condition.
    $html = (string) $this->withSession(['nostr_pubkey' => str_repeat('a', 64)])
        ->get(route('group.ich.verein'))->assertOk()->getContent();

    expect($html)->toContain('data-verein-nicht-eingerichtet')
        ->and($html)->toContain('x-show="!eingerichtet"')
        ->and($html)->toContain('x-show="eingerichtet"')
        ->and($html)->toContain('Die Vereins-Anbindung ist in dieser App gerade nicht eingerichtet.');
});

test('the „Ich" row disappears with the configuration, and points here with it', function () {
    $mit = (string) $this->withSession(['nostr_pubkey' => str_repeat('a', 64)])
        ->get(route('group.ich'))->assertOk()->getContent();
    expect($mit)->toContain(route('group.ich.verein'));

    config(['group.verein_api_url' => null]);
    $ohne = (string) $this->withSession(['nostr_pubkey' => str_repeat('a', 64)])
        ->get(route('group.ich'))->assertOk()->getContent();
    expect($ohne)->not->toContain(route('group.ich.verein'));
});

test('a Livewire roundtrip survives the page', function () {
    // After a deploy an open tab sends exactly this round trip; a 500 on it is a rejected
    // promise in the browser and invisible to every console measurement (house rule 4b).
    Livewire::test('group::ich-verein')->call('$refresh')->assertOk();
});

test('the join flow keeps its own address', function () {
    // Until P4 `/ich/verein` pointed at exactly this. The two are two questions — „where do
    // I stand?" and „how do I get in?" — and therefore two pages.
    $this->withSession(['nostr_pubkey' => str_repeat('a', 64)])
        ->get(route('group.verein.join'))
        ->assertOk()
        ->assertSee('verein-flow', false);
});
