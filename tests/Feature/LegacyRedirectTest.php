<?php

declare(strict_types=1);
use Symfony\Component\Routing\Exception\RouteNotFoundException;

/**
 * The redirect map of the old hub paths (D3/R7) — every row, every query rule.
 *
 * **Why this is a test of its own and not a line in passing.** `Route::redirect()` would
 * have been enough for all of these rows if the query string did not matter. It does:
 * `?c=` carries the conversation that was clicked, `?rt=` the focus mode of the room list,
 * `?tab=` the forge's tab, `?q=` the search. All four sit in links that have long been
 * shared, and two of them have to be RENAMED on the way. Laravel's `RedirectController`
 * discards them without a word — exactly the failure R7 carries as "medium".
 *
 * And because the redirects get switched from 302 to 301 in P7, every row checks the
 * STATUS as well: a 301 is cached by the browser indefinitely, so a wrong row cannot be
 * taken back.
 *
 * ── What is NOT checked here ───────────────────────────────────────────────────────
 * Whether the TARGET answers. That stands in `HubRoutenTest`, with a guest and a member.
 * This file answers only "where does the old path point, and what does it take along".
 */

/**
 * Every row of the map from the plan.
 *
 * Format: [old path with query, expected target].
 *
 * @return iterable<string, array{0: string, 1: string}>
 */
dataset('weiterleitungen', [
    // ── The bare paths ────────────────────────────────────────────────────────────
    '/spaces' => ['/spaces', '/bereich/chat'],
    '/updates' => ['/updates', '/postfach'],
    '/messages' => ['/messages', '/postfach?ansicht=direkt'],
    '/bookmarks' => ['/bookmarks', '/ich/lesezeichen'],
    '/directory' => ['/directory', '/bereich/leute'],
    '/articles' => ['/articles', '/bereich/artikel'],
    '/forge' => ['/forge', '/bereich/forge'],
    '/settings' => ['/settings', '/ich/einstellungen'],
    '/settings/space' => ['/settings/space', '/ich/einstellungen'],
    '/settings/wallet' => ['/settings/wallet', '/bereich/wallet'],
    '/ (root)' => ['/', '/start'],

    // ── The query rules, row by row ───────────────────────────────────────────────
    // `/spaces` takes the search and the focus mode along. `rt` is the more expensive of
    // the two: the discovery rows are gone with P2, so `?rt=meetups` is now the WAY into
    // the meetup focus and no longer merely a bookmark on it.
    '/spaces?q= keeps the search' => ['/spaces?q=berlin', '/bereich/chat?q=berlin'],
    '/spaces?rt= keeps the focus mode' => ['/spaces?rt=meetups', '/bereich/chat?rt=meetups'],
    '/spaces?q=&rt= keeps both' => ['/spaces?q=berlin&rt=meetups', '/bereich/chat?q=berlin&rt=meetups'],

    // A switch, not a target: the room list's workspace tab moved to `/forge`, and the old
    // link has to land THERE — not on the chat list with a tab that no longer exists on it.
    '/spaces?tab=workspaces leads into the forge' => ['/spaces?tab=workspaces', '/bereich/forge?tab=workspaces'],
    // Any other `tab` value is neither a switch signal nor junk worth forwarding: the chat
    // list does not know `tab` any more.
    '/spaces?tab=anything stays on chat' => ['/spaces?tab=irgendwas', '/bereich/chat'],

    // `/messages?c=` → `/postfach?ansicht=direkt&an=` — the map's only RENAME. The target
    // brings its own `ansicht` and must not be overridden by a carried parameter.
    '/messages?c= becomes ?an=' => ['/messages?c=abc,def', '/postfach?ansicht=direkt&an=abc%2Cdef'],
    '/messages?ansicht= does NOT override the target' => ['/messages?ansicht=alles', '/postfach?ansicht=direkt'],

    // `/forge` keeps its tab.
    '/forge?tab= keeps the tab' => ['/forge?tab=issues', '/bereich/forge?tab=issues'],

    // What is NOT on the list does not travel. The parameter comes from the address bar, so
    // it is foreign input — a redirect that forwards everything is an open redirection point
    // into a target path.
    '/updates?foreign= is discarded' => ['/updates?fremd=1', '/postfach'],
    '/spaces?foreign= is discarded' => ['/spaces?fremd=1&q=x', '/bereich/chat?q=x'],
    // Empty and multi-valued forms do not count as a value: `?c=` is no conversation,
    // `?c[]=` is no identifier.
    '/messages?c= (empty) does not travel' => ['/messages?c=', '/postfach?ansicht=direkt'],
    '/messages?c[]= (array) does not travel' => ['/messages?c[]=abc', '/postfach?ansicht=direkt'],
]);

test('every row of the map forwards to its target — with 302, until P7 switches to 301', function (string $alt, string $ziel) {
    // WITHOUT a session: a redirect is not a surface. It stands outside `nostr.auth`, and
    // the TARGET decides about access — a login redirect in front of it would swallow
    // exactly the query this controller exists for.
    $res = $this->get($alt);

    $res->assertStatus(302);
    $res->assertRedirect($ziel);
})->with('weiterleitungen');

test('the route NAME space.settings stays — cross-repo hardlinks point at it', function () {
    // The ONE name that survives the rename (plan, routes section). A rename would be a
    // three-repo release for a string no human ever reads.
    expect(route('group.space.settings', [], false))->toBe('/settings/space');

    $this->get(route('group.space.settings'))->assertRedirect('/ich/einstellungen');
});

test('the old NAMES are gone — a forgotten reference throws instead of costing quietly', function () {
    // The counter-decision, and it is deliberate: had the redirects kept the old names,
    // `route('group.spaces')` would still resolve, every internal link would run through an
    // extra roundtrip, and a reference this rebuild overlooked would go unnoticed. This way
    // it throws in the suite.
    foreach ([
        'group.spaces', 'group.updates', 'group.bookmarks', 'group.directory',
        'group.articles', 'group.forge', 'group.settings', 'group.wallet', 'group.messages',
    ] as $alterName) {
        expect(fn () => route($alterName))->toThrow(RouteNotFoundException::class);
    }

    // POSITIVE CONTROL: `route()` does not throw as a matter of course — the new names
    // resolve. Without this half the case would also be green if no route were registered
    // at all.
    expect(route('group.bereich.chat', [], false))->toBe('/bereich/chat');
    expect(route('group.postfach', [], false))->toBe('/postfach');
});
