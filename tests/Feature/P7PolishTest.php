<?php

declare(strict_types=1);

use Tests\TestCase;

/**
 * P7 (UX-Politur/AAA): die Blade-tragenden Marker der vier DoD-Kriterien —
 * Reduced-Motion, keine Layout-Shifts (Skeleton deckt ChatStatesTest), Tap ≥44px,
 * Kontrast. Reines Motion-/Contrast-Verhalten (CSS) deckt der Build; hier wird
 * geprüft, dass die Guards/Utilities im gerenderten Markup ankommen.
 *
 * Nimmt `$this` explizit entgegen statt über `test()` zu gehen: `test()` liefert
 * ohne Argument `HigherOrderTapProxy|TestCall` zurück — beide kennen `withSession()`
 * nur dynamisch (per `__call`), PHPStan kann das nicht auflösen. `$this` ist
 * innerhalb der Test-Closures dank Pests `TestClosureThisTypeExtension` sauber als
 * `TestCase` getypt.
 */
function authed(TestCase $test): TestCase
{
    return $test->withSession(['nostr_pubkey' => str_repeat('a', 64)]);
}

test('Login-Sheet: Slide/Scale sind reduced-motion-gegated (Fade bleibt)', function () {
    // Global im Layout gemountet → auf jeder Chrome-Seite im DOM.
    $res = authed($this)->get(route('group.bereich.chat'))->assertOk();

    // Tailwind v4 schreibt das Wichtig-Zeichen HINTER die Utility (`translate-y-0!`),
    // v3 davor (`!translate-y-0`). Das Markup ist am 2026-08-19 umgestellt worden
    // (Paket-Commit `71f1d30`, 14 Stellen), dieser Test nicht — er hat seitdem auf eine
    // Schreibweise gewartet, die es nirgends mehr gibt, und lief als „bekannt rot" mit.
    $res->assertSee('motion-reduce:translate-y-0!', false);
    $res->assertSee('motion-reduce:scale-100!', false);

    // Und der Rückweg ist zu: die v3-Form ist in v4 keine Klasse mehr, sondern ein
    // Attributwert ohne Wirkung. Ein Rückfall bliebe im Browser stumm — die Animation
    // liefe dann trotz `prefers-reduced-motion: reduce` weiter, und kein CSS-Fehler
    // würde darauf zeigen.
    $res->assertDontSee('motion-reduce:!translate-y-0', false);
    $res->assertDontSee('motion-reduce:!scale-100', false);
});

test('Raum: Poll-Balken-Breite ist reduced-motion-gegated (Zwilling zu :235)', function () {
    $res = authed($this)->get(route('group.room', ['h' => 'welcome']))->assertOk();

    $res->assertSee('transition-[width] duration-300 motion-reduce:transition-none', false);
});

test('Chat-Composer: Emoji-Knopf trägt die v4-Wichtig-Form (Zwilling zu :24)', function () {
    // a11y-contrast.spec.ts:611 hat gegen die v3-Form (`!text-brand-700`) geprüft und
    // ist deshalb rot geworden — das Markup steht seit dem Paket-Commit `71f1d30`
    // (2026-08-19) auf v4 (`text-brand-700!`). Derselbe Rückfall wie P7PolishTest:24,
    // hier auf der niedrigsten Ebene abgesichert, die ihn fängt (Pest statt E2E).
    $res = authed($this)->get(route('group.room', ['h' => 'welcome']))->assertOk();

    $res->assertSee('text-brand-700! dark:text-brand-400!', false);
    $res->assertDontSee('!text-brand-700 dark:!text-brand-400', false);
});

test('Wallet-Hero: Count-Up + grüner Farb-Flash bei Zuwachs', function () {
    $res = authed($this)->get(route('group.bereich.wallet'))->assertOk();

    // $watch statt x-effect (keine Selbst-Retrigger-Schleife) + rAF-Tween-Signatur.
    $res->assertSee("\$watch('balanceSats'", false);
    $res->assertSee("flash ? 'text-green-500 dark:text-green-400'", false);
    // prefers-reduced-motion → sofort setzen.
    $res->assertSee("matchMedia('(prefers-reduced-motion: reduce)')", false);
});

test('Kontrast: Reconnect-Banner trägt dunklen Text auf Orange (kein Weiß-auf-Orange)', function () {
    $res = authed($this)->get(route('group.bereich.chat'))->assertOk();

    $res->assertSee('text-brand-950', false);
    $res->assertSee('bg-brand-950 px-2 py-0.5 font-semibold text-brand-50', false);
});

test('Kontrast: Login-Hinweise laufen über text-muted statt text-zinc-500', function () {
    $res = $this->get(route('group.nostr-login'))->assertOk();

    $res->assertSee('text-xs text-muted', false);
    $res->assertDontSee('text-xs text-zinc-500', false);
});

test('contrast: the meta lines of Start run through text-muted', function () {
    // Until P2 this case measured the landing page under `/`. That is gone with Concept C —
    // `/` forwards to Start, and Start IS the surface a guest sees first. The statement stays
    // the same: secondary text runs through `text-muted` (the token the contrast measurement
    // knows) and not through a hard-coded `text-zinc-500`.
    // Measured inside the PAGE BODY and not across the whole document: since the desktop
    // shell the profile card hangs in `app-frame` as an overlay — that is, on EVERY page —
    // and carries a pre-existing `text-zinc-500` there. A document-wide `assertDontSee` would
    // therefore not be strict but simply unsatisfiable, and the case would lose its statement
    // about the surface it is meant to check.
    $html = (string) $this->get(route('group.start'))->assertOk()->getContent();

    $buehne = mb_strstr($html, 'data-tab-outlet');
    expect($buehne)->not->toBeFalse('marker data-tab-outlet missing — the narrowing would have no subject');
    $buehne = mb_strstr((string) $buehne, '</main>', true);
    expect($buehne)->not->toBeFalse('no closing </main> — the narrowing would have no subject');

    expect((string) $buehne)->toContain('text-muted');

    // What is looked for is the BARE utility, not every occurrence of the string: Flux
    // declares its default as `[:where(&)]:text-zinc-500` — a rule with specificity 0 that
    // exists precisely to be overridden by `text-muted`. Counting it would make the case
    // unsatisfiable, and an unsatisfiable case eventually gets deleted instead of read.
    preg_match_all('/(?<!\]:)text-zinc-500/', (string) $buehne, $hart);
    expect($hart[0])->toBeEmpty('secondary text on Start runs hard through text-zinc-500 instead of text-muted');

    // POSITIVE CONTROL for the probe: it DOES find the Flux default form — so it is spelled
    // correctly and does not report an empty set because it is grasping at nothing.
    expect((string) $buehne)->toContain(']:text-zinc-500');
});

test('Tap-Targets: primäre Buttons (Wallet/Directory/Chat-Composer) tragen icon-btn-touch', function () {
    authed($this)->get(route('group.bereich.wallet'))->assertOk()->assertSee('icon-btn-touch', false);
    authed($this)->get(route('group.bereich.leute'))->assertOk()->assertSee('icon-btn-touch', false);
    // Chat-Kernpfad: Senden/Anhängen/Beitreten (Review-Fund plan/medium).
    authed($this)->get(route('group.room', ['h' => 'welcome']))->assertOk()->assertSee('icon-btn-touch', false);
});
