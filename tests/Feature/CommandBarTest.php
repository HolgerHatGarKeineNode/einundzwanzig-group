<?php

declare(strict_types=1);

use Illuminate\Support\Facades\Blade;

/**
 * The desktop command bar (`command-bar.blade.php`, P6/D10) — the half the SERVER decides.
 *
 * Here: that the bar is in the delivered HTML exactly once, under exactly the conditions
 * that must hold (web host, chassis on), that it carries the three affordances D10 names,
 * and that the avatar exists exactly once per width — the header instance steps aside from
 * `xl` up, the bar's takes over.
 *
 * NOT here: geometry, and whether the badge counts the right thing. The first is measured at
 * the living element (`tests/e2e/desktop-command-bar.spec.ts`, 1440 × 900), the second
 * without a browser (`js/updatesView.test.ts`, `countAddressedUpdates`). A server test that
 * finds `xl:flex` in the HTML has said nothing about a rendered height.
 *
 * This file lives in the host for the same reason as `RailSkelettTest`: the package has no
 * `tests/` directory and no `autoload-dev`, so Pest finds nothing there.
 */
$rahmen = fn (): string => Blade::render('<x-group::app-frame :rail="true">Inhalt</x-group::app-frame>');

test('the bar stands exactly once in the web host, with all three affordances', function () use ($rahmen) {
    config(['nativephp-internal.running' => false]);

    $html = $rahmen();

    // On the opening tag and not on the bare word: `data-command-bar-search` and its two
    // siblings contain the same string, so a plain `substr_count` would count four.
    expect(substr_count($html, '<div data-command-bar'))->toBe(1);

    // The three things D10 asks for, each by its own anchor rather than by a label: the
    // labels are translated and the anchors are what two E2E suites address.
    expect($html)->toContain('data-command-bar-search')
        ->toContain('data-command-bar-postfach')
        ->toContain('data-command-bar-avatar');

    // The search slot opens the EXISTING palette and does not carry a field of its own — a
    // second input for the same query is the drift this bar exists to avoid.
    expect($html)->toContain("\$dispatch('open-command-palette')");
    expect($html)->not->toContain('data-command-bar-search" type="search"');

    // The inbox leads to the Postfach and its badge reads the count that ADDRESSES the
    // reader, never `updates` (which includes room traffic) and never anything about
    // conversations.
    expect($html)->toContain(route('group.postfach'))
        ->toContain('$store.unread?.postfach')
        ->not->toContain('$store.privateMessages');
});

test('in the app there is no bar, with a positive control on the same render', function () use ($rahmen) {
    // The app carries all three affordances in its own bottom bar, on every width — a ⌘K
    // field on a device without a ⌘ key would be the second vocabulary Concept C removed.
    config(['nativephp-internal.running' => true]);
    $app = $rahmen();

    config(['nativephp-internal.running' => false]);
    $web = $rahmen();

    expect($app)->not->toContain('data-command-bar');
    // POSITIVE CONTROL: the same search does find the bar in the web host, so the line above
    // is about the host and not about a misspelled anchor.
    expect($web)->toContain('data-command-bar');
});

test('without the chassis (rail=false) there is no bar either', function () {
    // Chrome-less surfaces (onboarding, full-screen views) render no left bar, so a bar above
    // the stage would be the only piece of desktop shell on a page that deliberately has
    // none. One rule, one place — the same condition that gates the rail.
    config(['nativephp-internal.running' => false]);

    $mitRail = Blade::render('<x-group::app-frame :rail="true">Inhalt</x-group::app-frame>');
    $ohneRail = Blade::render('<x-group::app-frame :rail="false">Inhalt</x-group::app-frame>');

    expect($mitRail)->toContain('data-command-bar');
    expect($ohneRail)->not->toContain('data-command-bar');
});

test('the avatar stands twice in the markup and once per width', function () {
    // Both instances are server-rendered, so the DOM holds two. What may not happen is that
    // both SHOW: the header one steps aside from `xl` up, which is exactly where the bar
    // appears. The rendered proof of "one per width" is in the E2E spec; here it is the
    // coupling of the two class conditions.
    config(['nativephp-internal.running' => false]);

    $html = Blade::render('<x-group::app-frame :rail="true"><x-group::app-header title="Test" /></x-group::app-frame>');

    expect(substr_count($html, 'data-app-header-avatar'))->toBe(1);
    expect(substr_count($html, 'data-command-bar-avatar'))->toBe(1);

    // The header instance carries `xl:hidden`, the bar's does not. Read out of the `class`
    // attribute that FOLLOWS each anchor and not out of a fixed window of characters: the
    // class string is long, a window is a guess, and a guess that is too short reads „no
    // `xl:hidden`" for a class that has it (measured — that is how this case first failed).
    $klasse = function (string $anker) use ($html): string {
        $ab = (int) strpos($html, $anker);
        // Fail-closed, and not only for the type checker: an anchor without a class attribute
        // after it would let this case read „no `xl:hidden`" off the empty string.
        if (preg_match('/class="([^"]*)"/', substr($html, $ab), $treffer) !== 1) {
            throw new RuntimeException("Kein class-Attribut hinter {$anker} — die Sonde misst nichts.");
        }

        return $treffer[1];
    };
    expect($klasse('data-app-header-avatar'))->toContain('xl:hidden');
    expect($klasse('data-command-bar-avatar'))->not->toContain('xl:hidden');
});

test('in the app the header avatar keeps its place at every width', function () {
    // A tablet in landscape is above `xl` and has no command bar: hiding the header avatar
    // there would simply delete the way to „Ich". The host is the question, not the width.
    config(['nativephp-internal.running' => true]);

    $html = Blade::render('<x-group::app-frame :rail="true"><x-group::app-header title="Test" /></x-group::app-frame>');

    expect(substr_count($html, 'data-app-header-avatar'))->toBe(1);
    $ab = (int) strpos($html, 'data-app-header-avatar');
    if (preg_match('/class="([^"]*)"/', substr($html, $ab), $treffer) !== 1) {
        throw new RuntimeException('Kein class-Attribut hinter data-app-header-avatar — die Sonde misst nichts.');
    }
    expect($treffer[1])->not->toContain('xl:hidden');
});

test('the left bar carries Start and the pins above the room groups', function () use ($rahmen) {
    // D10's order, and it is an order: Start (the one surface that renders for everyone),
    // then what the reader pinned himself, then the space's groups.
    config(['nativephp-internal.running' => false]);
    config(['group.workspace_url' => 'wss://buzz.test/']);

    $html = $rahmen();

    expect($html)->toContain('data-rail-start')->toContain('data-rail-pins');

    $start = (int) strpos($html, 'data-rail-start');
    $pins = (int) strpos($html, 'data-rail-pins');
    // With the real quote: the jump listener at the top of the rail carries the same anchor
    // as an ESCAPED attribute value (`&quot;`) inside its handler string, and that occurrence
    // stands before the scroller — measured, and it is what made this assertion fail first.
    $gruppen = (int) strpos($html, 'data-rail-gruppenkopf="');
    expect($start)->toBeLessThan($pins);
    expect($pins)->toBeLessThan($gruppen);

    // Both new blocks sit INSIDE the scroller and not next to it: the three direct children
    // of `[data-rail]` are the measured column (`RailSkelettTest`, and block for block in
    // `desktop-boot-geometrie.spec.ts`).
    $scroller = (int) strpos($html, 'data-rail-scroller');
    expect($scroller)->toBeLessThan($start);
});

test('the pin list is ONE component, and the chips step aside where the bar carries them', function () {
    // The target table (which path a `room:`/`article:`/`repo:`/`meetup:`/`area:` key leads
    // to) is the one thing the two surfaces must not answer differently — so they are one
    // component with two presentations. If this ever becomes two blocks again, a host that
    // redirects one area gets two different targets for one pin.
    config(['nativephp-internal.running' => false]);

    $quelle = (string) file_get_contents(
        dirname(__DIR__, 2).'/packages/einundzwanzig-group/resources/views/⚡start.blade.php'
    );

    expect($quelle)->toContain('<x-group::pin-list variant="chips"');
    // The chips give way to the left bar from `xl` up — in the web host only (the app has no
    // left bar at any width).
    expect($quelle)->toContain('xl:hidden');

    $chips = Blade::render('<x-group::pin-list variant="chips" />');
    $leiste = Blade::render('<x-group::pin-list variant="bar" />');

    // Same source, same selector, two anchors: both exist in one document at 1440 px, and one
    // anchor for both would make every locator ambiguous.
    expect($chips)->toContain('data-start-angeheftet')->toContain('$store.pinSet?.rows');
    expect($leiste)->toContain('data-rail-pins')->toContain('$store.pinSet?.rows');
    expect($chips)->not->toContain('data-rail-pins');
    expect($leiste)->not->toContain('data-start-angeheftet');
});
