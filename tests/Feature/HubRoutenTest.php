<?php

declare(strict_types=1);

use Einundzwanzig\Group\Shell\AreaRegistry;
use Livewire\Livewire;

/**
 * The hub routes of Concept C (D3) — everything the SERVER decides about them.
 *
 * Three questions, and none of them needs a browser:
 *
 *  1. **Does the route answer, and for WHOM?** Start, Ich, the settings hub and the
 *     articles area are open (D4); chat, people, forge, wallet, Postfach, bookmarks and
 *     the association sit behind `nostr.auth`. A guest gets no 404 there, he gets the
 *     login with his target remembered.
 *  2. **Does a Livewire roundtrip survive the page?** A full-page SFC that answers 200 on
 *     the first render and throws a 500 on `$refresh` is the failure R12 names: an open
 *     tab sends exactly that roundtrip.
 *  3. **Where do the tiles of the areas that do not exist yet in P2 point?**
 *     `meetups`/`kurse` have no route — they leave the client. Which way they take is the
 *     HOST's decision (web: the Portal, app: its own pages), and that is the only place
 *     where the registry differs per host.
 *
 * **Why this file lives in the HOST and not in the package:** `packages/einundzwanzig-group`
 * ships no test harness (no `tests/`, no phpunit.xml of its own). Every Pest feature test
 * of the package therefore stands here — precedent from the same surface:
 * `tests/Feature/LongformReaderTest.php`.
 */

/**
 * Any 64-hex pubkey for a "signed in" session (the server gate, not a signer).
 *
 * @return array{nostr_pubkey: string}
 */
function hubSession(): array
{
    return ['nostr_pubkey' => str_repeat('b', 64)];
}

/**
 * The open hub routes (D4). A guest MUST see them — he is supposed to learn what an
 * account gives him instead of running into a login redirect he never asked for.
 */
dataset('open hub routes', [
    'Start' => ['group.start'],
    'Ich' => ['group.ich'],
    'settings hub' => ['group.ich.einstellungen'],
    'articles area' => ['group.bereich.artikel'],
    // P4 (D9): the Portal pages are readable without a key — they are what somebody follows
    // from a shared link.
    'meetups area' => ['group.bereich.meetups'],
    'Kurse area' => ['group.bereich.kurse'],
]);

/**
 * The gated hub routes. Every one of them is a surface that can show nothing without a
 * key: rooms need a membership, the Postfach and the bookmarks belong to a pubkey, the
 * wallet and the association all the more so.
 */
dataset('gated hub routes', [
    'area chat' => ['group.bereich.chat'],
    'area people' => ['group.bereich.leute'],
    'area forge' => ['group.bereich.forge'],
    'area wallet' => ['group.bereich.wallet'],
    'Postfach' => ['group.postfach'],
    'Ich > bookmarks' => ['group.ich.lesezeichen'],
    'Ich > association' => ['group.ich.verein'],
]);

test('an open hub route answers 200 for a guest AND for a member', function (string $name) {
    // The GUEST first: `withSession()` sets the session on the TestCase and keeps it for
    // every further request of the same case. In the other order the "guest" would be
    // signed in, and half the promise would be lost silently — that is exactly how the
    // first version of this case was green where it had to be red.
    $this->get(route($name))->assertOk();
    $this->withSession(hubSession())->get(route($name))->assertOk();
})->with('open hub routes');

test('a gated hub route sends a guest to the login with the target remembered, a member gets 200', function (string $name) {
    $this->get(route($name))->assertRedirect(route('group.nostr-login'));
    // The remembered target is the point: without it the user lands on Start after the
    // login instead of where he wanted to go (§4.2).
    expect(session('url.intended'))->toBe(route($name));

    $this->withSession(hubSession())->get(route($name))->assertOk();
})->with('gated hub routes');

test('Livewire roundtrip: every new page survives a $refresh', function () {
    // R12: after a deploy an open tab sends a roundtrip to the component it rendered. A
    // page that answers 200 on the FIRST render and throws on the roundtrip shows up in
    // none of the cases above — and not in the browser console either, because a 500 on an
    // XHR is a rejected promise and not a JS error (house rule 4b).
    $this->withSession(hubSession());

    foreach ([
        'group::start',
        'group::ich',
        'group::pages.settings',
        'group::updates',
        'group::spaces',
        'group::directory',
        'group::bookmarks',
        'group::settings.wallet',
    ] as $komponente) {
        Livewire::test($komponente)->call('$refresh')->assertOk();
    }
});

test('the meetups and Kurse tiles lead INTO the client since P4', function () {
    // Until P3 these two tiles left the client (the package had no such page, D9 was P4's
    // work): on the web to the Portal, in the companion to its own copy. P4 built them, so
    // the tiles now point at package routes — and the outward link has to be GONE, otherwise
    // half the users keep leaving for a page that exists here.
    config(['group.portal_url' => 'https://portal.test']);

    $html = (string) $this->get(route('group.start'))->assertOk()->getContent();

    expect($html)->toContain('data-start-bereich="meetups"');
    expect($html)->toContain('href="'.route('group.bereich.meetups').'"');
    expect($html)->toContain('data-start-bereich="kurse"');
    expect($html)->toContain('href="'.route('group.bereich.kurse').'"');
    // No Portal link-out on either tile any more …
    expect($html)->not->toContain('https://portal.test/meetups');
    expect($html)->not->toContain('https://portal.test/courses');

    // … and both are SPA targets. Measured on the anchor itself and not by counting
    // `rel="external noopener"` in the page: that string also stands in the pin chips'
    // never-taken outward branch (server-rendered inside an `x-if`), so a page-wide
    // assertion would be green or red for the wrong reason.
    foreach (['meetups', 'kurse'] as $bereich) {
        $treffer = [];
        expect(preg_match('/<a[^>]*data-start-bereich="'.$bereich.'"[^>]*>/', $html, $treffer))->toBe(1);
        $anker = (string) ($treffer[0] ?? '');
        expect($anker)->toContain('wire:navigate');
        expect($anker)->not->toContain('external');
    }

    // The pinned MEETUP chip follows the same decision (it is built from the area's target,
    // D7/D8): since P4 it stays inside the client instead of opening the Portal.
    expect($html)->toContain("row.prefix === 'meetup' && false");
});

test('both new tiles still need a configured Portal', function () {
    // A tile into a page that can only render an empty list is worse than no tile — the same
    // rule the forge row follows with `workspace_url`.
    config(['group.portal_url' => null]);

    $ohne = (string) $this->get(route('group.start'))->assertOk()->getContent();
    expect($ohne)->not->toContain('data-start-bereich="meetups"');
    expect($ohne)->not->toContain('data-start-bereich="kurse"');

    // POSITIVE CONTROL: with the address both stand there again.
    config(['group.portal_url' => 'https://portal.test']);
    $mit = (string) $this->get(route('group.start'))->assertOk()->getContent();
    expect($mit)->toContain('data-start-bereich="meetups"');
    expect($mit)->toContain('data-start-bereich="kurse"');
});

test('a host redirects ONE tile to its OWN route without copying the list', function () {
    // That is exactly what `twenty-one-companion` does for `meetups`/`kurse`: it already
    // has the pages, the package only gets them in P4. The mechanism is
    // `AreaRegistry::defaults([...])` — the list stays in ONE place and the host names only
    // its deviation. A copied list drifts; that is the whole reason for the class.
    config(['group.areas' => AreaRegistry::defaults([
        'meetups' => 'group.bereich.chat',
    ])]);

    $html = (string) $this->get(route('group.start'))->assertOk()->getContent();

    expect($html)->toContain('data-start-bereich="meetups"');
    expect($html)->toContain('href="'.route('group.bereich.chat').'"');
    // The redirected entry no longer points at the package's own meetups route …
    expect($html)->not->toContain('href="'.route('group.bereich.meetups').'"');
    // … and every other entry is still there (the list was not replaced).
    expect($html)->toContain('data-start-bereich="kurse"');
    expect($html)->toContain('data-start-bereich="artikel"');
});

test('a tile without a configured source does NOT appear at all', function () {
    // An area without a source would be a place without content — the same rule that hangs
    // the rail's forge row on `workspace_url`.
    config(['group.workspace_url' => null, 'group.board_relay_url' => null]);

    $html = (string) $this->get(route('group.start'))->assertOk()->getContent();

    expect($html)->not->toContain('data-start-bereich="forge"');
    expect($html)->not->toContain('data-start-bereich="artikel"');

    // POSITIVE CONTROL: with a source both stand there. Without this half the case would
    // also be green if the tiles were no longer rendered AT ALL.
    config(['group.workspace_url' => 'wss://buzz.test/', 'group.board_relay_url' => 'wss://board.test/']);

    $mit = (string) $this->get(route('group.start'))->assertOk()->getContent();
    expect($mit)->toContain('data-start-bereich="forge"');
    expect($mit)->toContain('data-start-bereich="artikel"');
});

test('guest mode on Start is decided CLIENT-side — the server does not guess', function () {
    // D4/R8: the app knows its login only from `localStorage`. A server-rendered "welcome
    // back" would be the wrong half on every cold start, visible as a flash. The server
    // therefore delivers BOTH branches plus a placeholder, and the island decides.
    //
    // Measured with and without a session: the DELIVERED bytes are identical in this
    // respect — that is the promise, not merely "there is an x-if somewhere".
    $gast = (string) $this->get(route('group.start'))->assertOk()->getContent();
    $mitglied = (string) $this->withSession(hubSession())->get(route('group.start'))->assertOk()->getContent();

    foreach ([$gast, $mitglied] as $html) {
        // The placeholder stands there WITHOUT `x-cloak` — it has to be there from the
        // first paint.
        expect($html)->toContain('x-show="!bereit"');
        // And both branches hang on the store, not on the session.
        expect($html)->toContain('bereit && !$store.authGate?.authed');
        expect($html)->toContain('bereit && $store.authGate?.authed');
    }
});
