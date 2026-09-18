<?php

declare(strict_types=1);

use Illuminate\Http\Response;
use Illuminate\Testing\TestResponse;
use Livewire\Livewire;
use Tests\TestCase;

/**
 * **P3 of the navigation revamp: „Angeheftet", the five-segment Postfach, and the wallet row.**
 *
 * Plan: `docs/plans/2026-09-17T1946-revamp-ein-eingang.md`, decisions D5, D7, D8.
 *
 * ── What a server test can and cannot decide here ───────────────────────────────────
 *
 * The pin set, the segment choice and the balance all live in the browser — kind 30078 is
 * decrypted with the user's signer, and no server ever sees it. What is decidable HERE is
 * the wiring: that the surfaces exist, that they read the ONE store instead of inventing a
 * second source, and — the load-bearing half of D5 — that the DM store is mounted nowhere
 * outside the „Direkt" segment and that no DM NUMBER is rendered anywhere.
 *
 * The behaviour of the pin model is measured without a browser
 * (`packages/einundzwanzig-group/js/pinSet.test.ts`, 33 cases), the write path by a source
 * census (`js/pinWriteGate.test.ts`), the signer cost against the real app instance
 * (`js/wrapSignerCost.test.ts`), and the round trip against a real relay
 * (`tests/e2e/angeheftet-postfach.spec.ts`).
 */

/**
 * @param  array<string, mixed>  $params
 * @return TestResponse<Response>
 */
function alsMitglied(TestCase $t, string $route, array $params = []): TestResponse
{
    return $t->withSession(['nostr_pubkey' => str_repeat('b', 64)])->get(route($route, $params));
}

// ── The Postfach: five segments, and no number about the encrypted ones ─────────────

test('the Postfach carries all five segments of D5', function () {
    $html = (string) alsMitglied($this, 'group.postfach')->assertOk()->getContent();

    expect($html)->toContain('data-postfach-segmente');
    // The tab NAMES are the contract with `js/updatesView.ts` (`UpdateFeed`) — a renamed tab
    // silently stops matching `feedFromSearch`, and the segment would never be selectable
    // from the address.
    foreach (['all', 'mentions', 'threads', 'direkt', 'erinnerungen'] as $name) {
        expect($html)->toContain('name="'.$name.'"');
    }
    // And the labels, so the case fails on a segment that exists in the markup but carries no
    // word (a tab with an empty label is invisible at 390 px).
    foreach ([__('Alle'), __('Erwähnungen'), __('Threads'), __('Direkt'), __('Erinnerungen')] as $label) {
        expect($html)->toContain($label);
    }
});

test('the „Direkt" tab carries NO count, the other three may (D5)', function () {
    $html = (string) alsMitglied($this, 'group.postfach')->assertOk()->getContent();

    // The counts come from ONE function in the island (`segmentCount`), which answers 0 for
    // `direkt` by construction. What is checked here is the MARKUP side of that promise: the
    // Direkt tab must not carry a count expression at all — otherwise a later edit only has
    // to change the function to bring a DM number back.
    expect($html)->toContain("segmentCount('mentions')");
    expect($html)->toContain("segmentCount('threads')");
    expect($html)->toContain("segmentCount('erinnerungen'");
    expect($html)->not->toContain("segmentCount('direkt')");

    // No surface anywhere may read the DM store's unread total — that is the number D5
    // forbids, and until P3 the bottom nav's dot read it.
    expect($html)->not->toContain('privateMessages?.unreadTotal');
});

test('the bottom nav dot no longer feeds on decrypted messages', function () {
    // Until P3 the dot read `$store.privateMessages?.unreadTotal` on EVERY page. With the
    // wrap store bound to the Direkt segment that term could only ever be true while the user
    // is already looking at the conversations — a signal about the screen he is on, paid for
    // with two `nip44.decrypt` per envelope. Checked at the source, because the expression is
    // built in PHP and the rendered attribute carries it escaped.
    $navTab = (string) file_get_contents(
        __DIR__.'/../../packages/einundzwanzig-group/resources/views/components/nav-tab.blade.php'
    );
    $ohneKommentare = (string) preg_replace('/\{\{--[\s\S]*?--\}\}/', '', $navTab);

    expect($ohneKommentare)->toContain("\$punkt = '\$store.unread?.any'");
    expect($ohneKommentare)->not->toContain('privateMessages');
    // CONTROL: the stripper strips — the name stands in this file's prose exactly once.
    expect($navTab)->toContain('privateMessages');
});

test('the Direkt segment lives on the Postfach and nowhere else', function () {
    // The partial carries the whole conversation surface; it must not be reachable from a
    // second place, or the wrap subscription would have a second bracket (which is how it had
    // one on every page until P3).
    $views = __DIR__.'/../../packages/einundzwanzig-group/resources/views/';
    $treffer = [];
    // Recursively, and NOT with `glob('**/*')`: PHP's glob has no globstar — `**` behaves like
    // a single `*`, so a pattern like that would have missed the page in the root of the tree
    // and reported a clean result. (It did, while this case was being written.)
    $baum = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($views, FilesystemIterator::SKIP_DOTS));
    foreach ($baum as $datei) {
        if (! str_ends_with((string) $datei, '.blade.php')) {
            continue;
        }
        if (str_contains((string) file_get_contents((string) $datei), 'partials.postfach.direkt')) {
            $treffer[] = basename((string) $datei);
        }
    }

    expect($treffer)->toBe(['⚡updates.blade.php']);
    // And the old routeless screen is gone rather than lying around as dead markup with a
    // second copy of the same surface.
    expect(file_exists($views.'⚡messages.blade.php'))->toBeFalse();
});

// ── „Angeheftet" (D7/D8) ────────────────────────────────────────────────────────────

test('Start carries the pins section, fed by the ONE selector', function () {
    $html = (string) alsMitglied($this, 'group.start')->assertOk()->getContent();

    expect($html)->toContain('data-start-angeheftet');
    // The chips read `$store.pinSet.rows` — the union of the reader's own kind 30078 and
    // Buzz' `channel-stars` (`js/pinSetSync.ts pinnedKeys`). A second source here would be a
    // second answer to "is this pinned", which is exactly what D7 forbids.
    expect($html)->toContain('$store.pinSet?.rows');
    // The unconfirmed-write hint: said once, on this surface, rather than at every button.
    expect($html)->toContain('data-angeheftet-unbestaetigt');
    // A guest sees the section too — his set lives in localStorage and is unioned into the
    // account set on login (D7). So it must NOT sit inside the member-only branch.
    $gast = (string) $this->get(route('group.start'))->assertOk()->getContent();
    expect($gast)->toContain('data-start-angeheftet');
});

test('every pinnable object type has an affordance on its own surface', function () {
    // D7 lists six key namespaces. Five of them have a surface in this client today; the sixth
    // (`meetup:`) gets one in P4 (D9) — the package has no meetup page before that, and an
    // affordance without a surface is not something a test can demand.
    // The key EXPRESSION per surface, escaped exactly as Blade writes it into the attribute
    // (`{{ }}` turns `'` into `&#039;`) — asserting the raw form would be permanently green in
    // the negative direction, which is the trap `alsPaletteUrl` documents next door.
    $flaechen = [
        'group.bereich.chat' => 'roomKey(room.h)',                 // the mobile room list — `room-tile`
        'group.bereich.artikel' => e("'article:30023:' + card.pubkey"),
        'group.bereich.forge' => e("'repo:' + repo.address"),
    ];

    foreach ($flaechen as $route => $ausdruck) {
        $html = (string) alsMitglied($this, $route)->assertOk()->getContent();
        // `assertStringContainsString` and NOT `expect()->toContain($needle, $route)`: Pest's
        // `toContain` is VARIADIC in the needles — a second argument is another thing that has
        // to be in the string, not a failure message. Measured while writing this case: the
        // route name became a needle and the case failed with „contains group.bereich.chat".
        $this->assertStringContainsString('data-pin-toggle', $html, $route.': no pin affordance');
        $this->assertStringContainsString($ausdruck, $html, $route.': the pin key expression is not the documented one');
    }

    // The person lives on the profile card, which stands on every page behind the gate.
    $chat = (string) alsMitglied($this, 'group.bereich.chat')->assertOk()->getContent();
    expect($chat)->toContain('data-person-pin');
    // RAW here and escaped above, and the difference is the mechanism, not a mistake: the
    // component passes its key through `{{ $schluessel }}`, which escapes, while the profile
    // card writes the expression straight into the attribute. A test that assumed one form for
    // both would be permanently green in the negative direction for the other.
    expect($chat)->toContain("'person:' + pubkey");

    // The area chips of Start are pinnable through their keys; the default seed is `area:wallet`
    // (D8) and lives in the island, not in the markup — asserted in `js/pinSet.test.ts`.
});

test('a pin affordance never sits inside the link it belongs to', function () {
    // Nested interactive content is invalid markup AND the click would navigate instead of
    // pinning. Measured structurally: in the rendered HTML no `data-pin-toggle` may stand
    // between an `<a` and its `</a>`.
    foreach (['group.bereich.chat', 'group.bereich.artikel', 'group.bereich.forge'] as $route) {
        $html = (string) alsMitglied($this, $route)->assertOk()->getContent();
        $offen = 0;
        foreach (preg_split('/(?=<a[\s>])|(?<=<\/a>)/', $html) ?: [] as $stueck) {
            if (str_starts_with($stueck, '<a') && ! str_contains($stueck, '</a>')) {
                $offen++;
            }
            if (str_contains($stueck, 'data-pin-toggle')) {
                expect($offen)->toBe(0, $route.': a pin button stands inside an open anchor');
            }

            if (str_contains($stueck, '</a>')) {
                $offen = max(0, $offen - 1);
            }
        }
    }
});

// ── „Ich": the wallet balance (D8) ──────────────────────────────────────────────────

test('Ich shows the wallet row with its balance and the way into the wallet', function () {
    $html = (string) alsMitglied($this, 'group.ich')->assertOk()->getContent();

    expect($html)
        ->toContain('nostrWalletGuthaben')
        ->toContain('data-wallet-guthaben')
        ->toContain('data-wallet-betrag')
        ->toContain('href="'.route('group.bereich.wallet').'"');
    // Three states, and the middle one is why this is not a one-liner: an amount, „verbunden"
    // without one (WebLN has no balance command), and „nicht verbunden".
    expect($html)->toContain(__('nicht verbunden'));
});

// ── The roundtrip (house rule 4b: a 500 on an XHR is no console error) ──────────────

test('Livewire roundtrip: the three P3 surfaces survive a $refresh', function () {
    $this->withSession(['nostr_pubkey' => str_repeat('b', 64)]);

    foreach (['group::start', 'group::updates', 'group::ich'] as $komponente) {
        Livewire::test($komponente)->call('$refresh')->assertOk();
    }
});
