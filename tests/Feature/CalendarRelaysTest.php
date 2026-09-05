<?php

declare(strict_types=1);

use Illuminate\Testing\TestResponse;
use Symfony\Component\HttpFoundation\Response;

/**
 * P2 — the server-side switch for the NIP-52 CALENDAR SOURCE.
 *
 * ── Why this is a server-side promise of its own ──────────────────────────────────
 *
 * A meetup's dates do not live on the space relay but on the PORTAL's public ones:
 * `einundzwanzig-portal` has signed and published its meetups (31924) and dates (31923)
 * itself since 2026-09-04, every five minutes, to the addresses from its own
 * `NOSTR_RELAYS`. Which ones those are for this client — and WHOSE dates count — is
 * therefore configuration (`NOSTR_CALENDAR_RELAYS`/`NOSTR_CALENDAR_AUTHORS` →
 * `group.calendar_*`) and is handed to the island through `partials/head.blade.php` as
 * `window.__nostrCalendarRelays`/`…Authors`.
 *
 * **A code default would be a defect here**, for the same two reasons as the article
 * signal relays (`ArticleMetricRelaysTest.php`): it would turn a missing configuration
 * into a silent WebSocket connection to the public internet, and the fail-closed relay
 * guard of the E2E suite would then turn every test that touches a meetup room red.
 *
 * **And the author filter is not a hardening, it is half the surface.** A kind 31923 is
 * a public kind on public relays, and the `a` tag that binds a date to a meetup calendar
 * is a CLAIM — anybody may publish an event carrying our coordinate. Measured 2026-09-05,
 * a bare `nak req -k 31923 -l 100 wss://nos.lol` returned 100 events from 16 authors.
 * Without `authors` the room header would show whatever a stranger points at it.
 *
 * Decided server-side, so the cheaper layer: no browser, no Alpine, no relay (the same
 * shape as `ArticleMetricRelaysTest.php`).
 */

/** Any 64-hex pubkey for a "logged in" session (server gate, no signer). */
function calendarFakeSessionPubkey(): string
{
    return str_repeat('d', 64);
}

/**
 * @param  TestResponse<Response>  $res
 */
function calendarHtml(TestResponse $res): string
{
    $content = $res->getContent();

    if ($content === false) {
        throw new RuntimeException('Response::getContent() returned false — the response has no body.');
    }

    return $content;
}

test('without a configured calendar source NEITHER variable is in the document', function () {
    config()->set('group.calendar_relay_urls', null);
    config()->set('group.calendar_authors', null);

    $res = $this->withSession(['nostr_pubkey' => calendarFakeSessionPubkey()])
        ->get(route('group.room', ['h' => 'anyroom']))
        ->assertOk();

    // The variable names stand here as LITERALS. Comparing against a constant would be
    // the symbol against itself: rename `window.__nostrCalendarRelays` without pulling
    // `js/calendar.ts` along and the island reads `undefined` forever — the date card
    // would fall back to HTTP silently, without anything looking broken.
    expect(calendarHtml($res))->not->toContain('__nostrCalendarRelays');
    expect(calendarHtml($res))->not->toContain('__nostrCalendarAuthors');
});

test('with a configured calendar source the server hands BOTH values through verbatim', function () {
    // Comma separated, with a space — exactly the way a human types it into a `.env`.
    // The server passes the raw value on; splitting, normalising and dropping non-hex is
    // `js/calendar.ts`'s job (and is tested there).
    config()->set('group.calendar_relay_urls', 'wss://nos.lol, wss://relay.damus.io');
    config()->set('group.calendar_authors', 'daf83d92768b5d0005373f83e30d4203c0b747c170449e02fea611a0da125ee6');

    $res = $this->withSession(['nostr_pubkey' => calendarFakeSessionPubkey()])
        ->get(route('group.room', ['h' => 'anyroom']))
        ->assertOk();
    $html = calendarHtml($res);

    // `@js()` escapes the slashes (`wss:\/\/…`), so the expectation is written in the
    // form that arrives in the document, not the one that goes into the `.env`.
    expect($html)->toContain('wss:\/\/nos.lol, wss:\/\/relay.damus.io');
    expect($html)->toContain('daf83d92768b5d0005373f83e30d4203c0b747c170449e02fea611a0da125ee6');
    // `??` and not `=`: a value pre-set by `addInitScript` has to win, or an E2E run
    // could not take the foreign addresses away again — which is exactly what
    // `tests/e2e/meetup-calendar.spec.ts` does when it pulls them onto the worker relay.
    expect($html)->toContain('window.__nostrCalendarRelays = window.__nostrCalendarRelays ??');
    expect($html)->toContain('window.__nostrCalendarAuthors = window.__nostrCalendarAuthors ??');
});

test('the two halves are switched INDEPENDENTLY — one alone is not enough for the island', function () {
    // The client requires both (`calendarConfigured()` in `js/calendar.ts`). They still
    // sit in TWO `@if`, so that a half configuration is visible at the document instead
    // of disguising itself as "nothing configured": whoever sets the relays and forgets
    // the authors finds one name in the HTML and not the other.
    config()->set('group.calendar_relay_urls', 'wss://nos.lol');
    config()->set('group.calendar_authors', null);

    $html = calendarHtml(
        $this->withSession(['nostr_pubkey' => calendarFakeSessionPubkey()])
            ->get(route('group.room', ['h' => 'anyroom']))
            ->assertOk()
    );

    expect($html)->toContain('__nostrCalendarRelays');
    expect($html)->not->toContain('__nostrCalendarAuthors');
});

test('BOTH head partials carry the lines — otherwise P2 silently does nothing on one of the two paths', function () {
    /*
     * **The tree has two head partials, and both are rendered in production:**
     * `resources/views/partials/head.blade.php` is the normal web head, the one with the
     * same name inside the package is the minimal head for portal/foreign-host operation
     * (switched on by `config('group.head_partial')`).
     *
     * **Exactly the mistake this test stands against happened while building this phase**
     * — the same one that already cost P6 of the article surface: the two lines were in
     * the package partial only. No suite caught it. The E2E spec was GREEN throughout,
     * because it sets the variables itself per `addInitScript` and never asks the head at
     * all. It surfaced from a measurement against a running server: `curl … | grep
     * __nostrCalendar` returned nothing while `config('group.calendar_relay_urls')` had
     * the value.
     *
     * What is checked is the VARIABLE NAME as a literal, not a symbol: `js/calendar.ts`
     * reads `globalThis.__nostrCalendarRelays`, and a typo on either side yields a
     * permanent `undefined` rather than an error.
     */
    $paths = [
        base_path('resources/views/partials/head.blade.php'),
        base_path('packages/einundzwanzig-group/resources/views/partials/head.blade.php'),
    ];

    foreach ($paths as $path) {
        expect(file_exists($path))->toBeTrue("head partial not found: {$path}");
        $source = (string) file_get_contents($path);

        // `str_contains` + `toBeTrue` instead of `toContain($needle, $message)`: Pest's
        // `toContain` takes further needles VARIADICALLY, not a message argument — a
        // second parameter would be checked as an additional searched string and the
        // promise would be worthless.
        expect(str_contains($source, 'window.__nostrCalendarRelays = window.__nostrCalendarRelays ??'))->toBeTrue(
            "The P2 relay line is missing in {$path} — on this rendering path the island never gets the calendar relays."
        );
        expect(str_contains($source, 'window.__nostrCalendarAuthors = window.__nostrCalendarAuthors ??'))->toBeTrue(
            "The P2 author line is missing in {$path} — without it the date card asks for nothing there."
        );
        expect(str_contains($source, "config('group.calendar_relay_urls')"))->toBeTrue(
            "In {$path} the relay line is there but reads a different configuration key."
        );
        expect(str_contains($source, "config('group.calendar_authors')"))->toBeTrue(
            "In {$path} the author line is there but reads a different configuration key."
        );
    }
});
