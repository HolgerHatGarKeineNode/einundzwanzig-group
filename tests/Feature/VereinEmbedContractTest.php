<?php

declare(strict_types=1);

use Illuminate\Support\Facades\Blade;

/**
 * The contract with the VEREIN repository (R5) — the four views it EMBEDS from this
 * package, rendered standalone.
 *
 * `einundzwanzig-verein` pulls `einundzwanzig/group` as `dev-master` through a path
 * repository (locally a symlink onto THIS working tree). It therefore resolves whatever is
 * checked out — a rebuild here hits it without a merge, without a release and without
 * warning. P2's rebuild touches the shell, and these four views live outside it; that is
 * exactly why it needs a latch saying they stay that way.
 *
 * **The four:**
 *   `group::partials.chat-row`       the message row
 *   `group::partials.chat-composer`  the input row
 *   `<x-group::nostr-avatar>`        the Alpine-bound avatar
 *   `<x-group::profile-card>`        the profile card (an overlay, once per page)
 *
 * **Why STANDALONE and not through a route.** The association renders them in its own
 * layout, without `app-shell`, without `app-frame`, without the `nostrSpaces` island. A
 * test that checks them along the way through `/bereich/chat` says nothing about this case:
 * everything they could possibly need stands there anyway. They are therefore rendered with
 * `Blade::render` and a MINIMAL context — exactly the one the association supplies.
 *
 * **What is NOT checked here.** Whether the Alpine islands run in the browser. That hangs
 * on `nostrRoomChat` resp. `nostrProfileCard`, which the association mounts itself; this is
 * about the SERVER side: does the view render without an exception, and are the hooks the
 * association hangs them on still there.
 */

/**
 * The context the association passes in. There is nothing more over there — and that is
 * precisely the promise: these views may not presuppose anything only this package's shell
 * provides.
 *
 * @return array<string, mixed>
 */
function vereinKontext(string $context = 'room'): array
{
    return ['context' => $context];
}

test('chat-row renders standalone — in both contexts', function (string $context) {
    $html = Blade::render(
        "@include('group::partials.chat-row')",
        vereinKontext($context),
    );

    expect($html)->not->toBe('');
    // The edge marker of the quote surfaces is the attribute the association (and this
    // package's own tests) address the row by — not the Tailwind class next to it.
    expect($html)->toContain('data-quote-rail');
    // And the row binds to `m`, the name in the surrounding `x-for` — the contract with the
    // caller. A rename here would be a silent total failure for the association.
    expect($html)->toContain('m.divider');
})->with(['room', 'thread']);

test('chat-composer renders standalone — in both contexts', function (string $context) {
    $html = Blade::render(
        "@include('group::partials.chat-composer')",
        vereinKontext($context),
    );

    expect($html)->not->toBe('');
    // The context selects the draft and the send action; both names are contract.
    $entwurf = $context === 'thread' ? 'threadDraft' : 'draft';
    expect($html)->toContain($entwurf);
    expect($html)->toContain($context === 'thread' ? 'sendComment()' : 'send()');
})->with(['room', 'thread']);

test('nostr-avatar renders standalone from pure Alpine expressions', function () {
    // This is how the association calls it: `picture`/`name` are expressions from ITS
    // scope, not values. The component must not try to evaluate them.
    $html = Blade::render('<x-group::nostr-avatar picture="m.picture" name="m.name" size="2rem" />');

    expect($html)->not->toBe('');
    expect($html)->toContain('m.picture');
    expect($html)->toContain('m.name');
    // The image proxy is the way out — without it the foreign image URL would sit directly
    // in the `<img src>` and every reader's browser would talk to the foreign host.
    expect($html)->toContain('$img(');
});

test('profile-card renders standalone and listens for its window event', function () {
    $html = Blade::render('<x-group::profile-card />');

    expect($html)->not->toBe('');
    // The island and the event the association opens it with. Both are contract: it mounts
    // `nostrProfileCard` itself and dispatches `open-profile`.
    expect($html)->toContain('x-data="nostrProfileCard"');
    expect($html)->toContain('open-profile.window');
});

test('none of the four views hangs on the shell — measured at the markup, not at intent', function () {
    // The actual latch of this rebuild. An `<x-group::app-shell>`, a `config('group.areas')`
    // or a `route('group.start')` inside one of these views would be a fatal in the
    // association — neither this package's shell nor its routes exist over there.
    //
    // Measured at the SOURCE and with comments stripped: some of the files EXPLAIN why they
    // do not do something, and a mention in prose would be no defect.
    $views = __DIR__.'/../../packages/einundzwanzig-group/resources/views/';
    $ohneKommentare = fn (string $datei): string => (string) preg_replace(
        '/\{\{--[\s\S]*?--\}\}/', '', (string) file_get_contents($views.$datei)
    );

    $dateien = [
        'partials/chat-row.blade.php',
        'partials/chat-composer.blade.php',
        'components/nostr-avatar.blade.php',
        'components/profile-card.blade.php',
    ];

    foreach ($dateien as $datei) {
        $quelle = $ohneKommentare($datei);

        foreach (['x-group::app-shell', 'x-group::app-frame', 'x-group::bottom-nav', 'x-group::me-avatar', "route('group."] as $verboten) {
            expect($quelle)->not->toContain($verboten, $datei.' hangs on the shell — inside the association embed that is a fatal');
        }
    }

    // CALIBRATION of the comment stripper: it has to really strip, otherwise the loop above
    // would also be green if `preg_replace` had swallowed the whole file (`null` → `''`
    // through the string cast). Anchored on a string `chat-row` carries ONLY in prose.
    expect((string) file_get_contents($views.'partials/chat-row.blade.php'))->toContain('Chat-Message-Row');
    expect($ohneKommentare('partials/chat-row.blade.php'))->not->toContain('Chat-Message-Row');
});
