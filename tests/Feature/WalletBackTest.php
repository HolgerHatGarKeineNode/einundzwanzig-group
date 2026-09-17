<?php

declare(strict_types=1);

use Illuminate\Testing\TestResponse;
use Symfony\Component\HttpFoundation\Response;
use Tests\TestCase;

/**
 * The wallet's way back is host-aware and derived from ONE source — since P2 the `areas`
 * registry (until then: `nav`, which is gone with Concept C).
 *
 * Wallet as an AREA → the arrow leads to Start, where its tile stands. Wallet NOT among the
 * areas → a sub-screen of the settings hub → the arrow leads there. No @mobile/@web seam.
 *
 * The arrow therefore stands in BOTH cases; what differs is its TARGET. That is the change
 * against the earlier phase: back then the wallet was a bottom-nav tab, and a back arrow
 * inside a tab would have been wrong. An area is not a tab — you come from Start and go back
 * there.
 */

/**
 * Nimmt `$this` explizit entgegen statt über `test()` zu gehen: `test()` liefert
 * ohne Argument `HigherOrderTapProxy|TestCall` zurück — beide kennen `withSession()`
 * nur dynamisch (per `__call`), PHPStan kann das nicht auflösen. `$this` ist
 * innerhalb der Test-Closures dank Pests `TestClosureThisTypeExtension` sauber als
 * `TestCase` getypt.
 *
 * @return TestResponse<Response>
 */
function walletPage(TestCase $test): TestResponse
{
    return $test->withSession(['nostr_pubkey' => str_repeat('a', 64)])->get(route('group.bereich.wallet'))->assertOk();
}

/**
 * The target of the back arrow, read out of the markup.
 *
 * NOT through `assertSee(route(…))`: the address of Start stands on every page a second time
 * (the brand mark in the header links it), and the settings hub's address stands in the
 * command palette. A page-wide string comparison therefore does not answer the question
 * "where does the ARROW lead?" — it was green in the first version of this test while
 * measuring the wrong element.
 *
 * Fail-closed: if the probe finds no arrow it throws. A measuring device that reports "passed"
 * on missing input eventually measures nothing and does not say so.
 */
function walletBackHref(string $html): string
{
    preg_match_all('/<a\b[^>]*>/i', $html, $treffer);

    $pfeile = array_values(array_filter(
        $treffer[0],
        static fn (string $tag): bool => str_contains($tag, 'aria-label="Zurück"'),
    ));

    expect($pfeile)->toHaveCount(1, 'the back arrow is not (or more than once) in the markup');

    // A `throw` and not an expectation: the expectation would read as a passed assertion
    // while PHPStan still has to assume the group is absent — and a probe that returns
    // `null` here would be measured against a route name later and always differ, which
    // reads like a product defect instead of a broken probe.
    if (preg_match('/href="([^"]*)"/', $pfeile[0], $href) !== 1) {
        throw new RuntimeException('The back arrow carries no href — the target is not measurable.');
    }

    return $href[1];
}

test('the wallet is an AREA, so the arrow leads to Start', function () {
    // Since P2 the source is the `areas` registry and no longer `nav`: the bottom bar has
    // three fixed slots, the wallet is none of them but an area with a tile on Start. The way
    // back leads where that tile stands.
    expect(walletBackHref((string) walletPage($this)->getContent()))->toBe(route('group.start'));
});

test('the wallet NOT among the areas, so the back arrow leads to the settings hub', function () {
    // The counter-proof, and it is the reason the target is derived rather than written out:
    // a foreign host that does not list the wallet as an area has it as a sub-page of the
    // settings — and then the hub is the right UP target. Without this case the line above
    // would also be green with a hard-coded `route('group.start')`, and the registry coupling
    // would be unproven.
    config(['group.areas' => [
        ['key' => 'chat', 'route' => 'group.bereich.chat', 'icon' => 'chat-bubble-left-right', 'gate' => 'nostr'],
    ]]);

    expect(walletBackHref((string) walletPage($this)->getContent()))->toBe(route('group.ich.einstellungen'));
});
