<?php

declare(strict_types=1);

use Einundzwanzig\Group\Portal\PortalCatalog;
use Einundzwanzig\Group\Portal\PortalEvent;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Livewire\Livewire;

/**
 * „Zusagen" for a Portal date (D12/D12a, P5) — the HALF of the rule the SERVER decides.
 *
 * ── Why the rule is split, and why this half is measured here ─────────────────────────
 *
 * Which ARM of an RSVP surface is rendered hangs on three fields of the Portal payload —
 * `nostr_address`, `attendees_public`, `rsvp_enabled` — and Blade decides it before a
 * browser runs. The other half („is the kind 31923 really on the relays, from a configured
 * author, neither cancelled nor over") can only be answered by the client and lives in
 * `js/rsvpRule.ts` with `node --test` cases of its own.
 *
 * The split has a reason that would be invisible without a test: the host's REST arm is a
 * Livewire component with server state and one Portal call per mount. Rendered „just in
 * case" behind an `x-show`, the Termine list would pay for sixty of them.
 *
 * The fixtures carry both cases from the start (`tests/Pest.php`): date 3854 with a
 * coordinate, date 2614 without one.
 */
/**
 * A FRESH catalog.
 *
 * The binding is `scopedIf`, and a catalog memoises the answers of its request (`status()`
 * is a statement about THIS request). Two measurements with different Portal responses in
 * one case therefore need two instances — otherwise the second one answers out of the
 * first one's memory and the case is green for the wrong reason.
 */
function frischerKatalog(): PortalCatalog
{
    app()->forgetScopedInstances();

    return app(PortalCatalog::class);
}

beforeEach(function (): void {
    config([
        'group.portal_url' => 'https://portal.test',
        // The web host binds no REST arm: an RSVP over REST would need a Portal session
        // this client does not have. Here the way INTO the Portal is what is offered.
        'group.portal_rsvp_view' => null,
    ]);
    Cache::flush();
    portalFakes();
});

test('a date WITH a coordinate gets the Nostr arm, one without it the way into the Portal', function () {
    $html = Livewire::withQueryParams(['ansicht' => 'termine'])->test('group::meetups')->html();

    // The Nostr arm hangs on the coordinate — it stands as a marker on the island so that a
    // test (and the E2E run) can tell which row answers which date.
    expect($html)->toContain('meetup-event-3854')
        ->and($html)->toContain('data-rsvp-ja')
        ->and($html)->toContain('data-rsvp-nein')
        // And the date WITHOUT a coordinate gets no second button but the way to where it
        // can be answered.
        ->and($html)->toContain('data-rsvp-nur-portal')
        ->and($html)->toContain('https://portal.test/at/meetup/einundzwanzig-nordburgenland');
});

test('the disclosure stands at the Nostr arm, with BOTH sentences it owes', function () {
    $html = Livewire::withQueryParams(['ansicht' => 'termine'])->test('group::meetups')->html();

    expect($html)->toContain('data-rsvp-hinweis')
        // What pressing the button does: a signed, public, permanent event on relays this
        // client does not own.
        ->and($html)->toContain('signiertes, öffentliches Ereignis')
        // … and what the counter is worth. Both sentences, not one: the number is a lower
        // bound on interest and no measure of attendance.
        ->and($html)->toContain('zählt Signaturen, nicht Personen')
        // The disclosure is a STEP: the same press carries the answer out once it is
        // acknowledged — nobody presses twice for one intent.
        ->and($html)->toContain('data-rsvp-hinweis-ok')
        ->and($html)->toContain('hinweisBestaetigen()');
});

test('rsvp_enabled=false leaves no RSVP surface at all — not even the Portal link', function () {
    // The Portal refuses BOTH paths there (`MeetupEventController::rsvp` → 422). A button
    // would be a promise this client cannot keep.
    portalFakes(['portal.test/api/meetup-events/*' => Http::response([[
        'id' => 3854, 'start' => '2026-09-21 16:00', 'location' => 'Landau', 'description' => null,
        'link' => null, 'attendees' => 0, 'might_attendees' => 0,
        'meetup.name' => 'Einundzwanzig Landau',
        'meetup.portalLink' => 'https://portal.test/de/meetup/einundzwanzig-landau',
        'meetup.country' => 'DE', 'meetup.city' => 'Landau', 'meetup.logo' => null,
        'meetup.rsvp_enabled' => false,
        'nostr_address' => '31923:'.str_repeat('d', 64).':meetup-event-3854',
    ]])]);

    $html = Livewire::withQueryParams(['ansicht' => 'termine'])->test('group::meetups')->html();

    expect($html)->not->toContain('data-rsvp-ja')
        ->and($html)->not->toContain('data-rsvp-nur-portal')
        ->and($html)->not->toContain('data-rsvp-termin');
});

test('attendees_public=false forbids the NOSTR answer and keeps the other way (D12a)', function () {
    /*
     * The Portal expresses „attendance hidden" by sending the counters as `null` — the date
     * payload has no field of its own for it (read 2026-09-18). The derivation happens ONCE,
     * at the mapping, so that the rule reads a flag instead of guessing one.
     *
     * D12a forbids the Nostr answer there, for a reason that holds for Nostr only: a kind
     * 31925 is public and permanent, and one query against the coordinate returns the
     * complete guest list.
     */
    portalFakes(['portal.test/api/meetup-events/*' => Http::response([[
        'id' => 3854, 'start' => '2026-09-21 16:00', 'location' => 'Landau', 'description' => null,
        'link' => null, 'attendees' => null, 'might_attendees' => null,
        'meetup.name' => 'Einundzwanzig Landau',
        'meetup.portalLink' => 'https://portal.test/de/meetup/einundzwanzig-landau',
        'meetup.country' => 'DE', 'meetup.city' => 'Landau', 'meetup.logo' => null,
        'meetup.rsvp_enabled' => true,
        'nostr_address' => '31923:'.str_repeat('d', 64).':meetup-event-3854',
    ]])]);

    $html = Livewire::withQueryParams(['ansicht' => 'termine'])->test('group::meetups')->html();

    expect($html)->not->toContain('data-rsvp-ja')
        ->and($html)->toContain('data-rsvp-nur-portal');
});

test('the catalog derives attendeesPublic from the one signal the payload has', function () {
    $termine = frischerKatalog()->events('2026-09-18', '2026-10-31');
    $mitAdresse = collect($termine)->firstWhere(fn (PortalEvent $event): bool => $event->id === 3854);

    expect($mitAdresse?->attendeesPublic)->toBeTrue();

    portalFakes(['portal.test/api/meetup-events/*' => Http::response([[
        'id' => 3854, 'start' => '2026-09-21 16:00', 'attendees' => null, 'might_attendees' => null,
        'meetup.name' => 'X', 'meetup.portalLink' => 'https://portal.test/de/meetup/x',
        'meetup.country' => 'DE', 'meetup.city' => 'X',
    ]])]);
    Cache::flush();

    $verborgen = frischerKatalog()->events('2026-09-18', '2026-10-31');

    expect($verborgen[0]->attendeesPublic)->toBeFalse();
});

test('the meetup detail carries the arm under its next date and under the further ones', function () {
    $html = Livewire::test('group::meetup', ['slug' => 'einundzwanzig-nordburgenland'])->html();

    // The next date of this meetup is 2614 — no coordinate, so the way into the Portal.
    // That is exactly the case D12 keeps the REST path for.
    expect($html)->toContain('data-rsvp-nur-portal')
        ->and($html)->toContain('Im Portal zusagen');
});

test('a Livewire roundtrip survives the pages the RSVP arm sits on', function () {
    // After a deploy an open tab sends exactly this round trip, and a 500 on it is a
    // rejected promise in the browser — not a console error, so no console measurement sees
    // it (house rule 4b).
    Livewire::withQueryParams(['ansicht' => 'termine'])->test('group::meetups')->call('$refresh')->assertOk();
    Livewire::test('group::meetup', ['slug' => 'einundzwanzig-nordburgenland'])->call('$refresh')->assertOk();
});

test('the palette index carries the coordinate ONLY where an answer is allowed', function () {
    $rows = collect(frischerKatalog()->search('', ['event']));

    $mitAdresse = $rows->first(fn ($hit): bool => $hit->address !== '');
    expect($mitAdresse)->not->toBeNull('no date carries a coordinate — then the lines below measure nothing');
    expect($mitAdresse->address)->toStartWith('31923:');

    // And the other direction: with RSVP switched off NO row carries a coordinate, although
    // the Portal delivers one. That is the server half of the rule which keeps the palette
    // from offering an action it then refuses on Enter.
    portalFakes(['portal.test/api/meetup-events/*' => Http::response([[
        'id' => 3854, 'start' => '2026-09-21 16:00', 'attendees' => 0, 'might_attendees' => 0,
        'meetup.name' => 'X', 'meetup.portalLink' => 'https://portal.test/de/meetup/x',
        'meetup.country' => 'DE', 'meetup.city' => 'X', 'meetup.rsvp_enabled' => false,
        'nostr_address' => '31923:'.str_repeat('d', 64).':meetup-event-3854',
    ]])]);
    Cache::flush();

    $ohne = collect(frischerKatalog()->search('', ['event']));
    expect($ohne)->not->toBeEmpty()
        ->and($ohne->every(fn ($hit): bool => $hit->address === ''))->toBeTrue();
});

test('the index endpoint omits the coordinate key instead of sending it empty', function () {
    // Read with `foreach` rather than through a collection: `->json()` is untyped, and
    // `collect()` on it cannot resolve its template types (larastan `argument.templateType`).
    $rows = (array) $this->get(route('group.suche.portal-index'))->assertOk()->json('rows');

    $terminMitAdresse = false;
    $fremderSchluessel = false;
    foreach ($rows as $row) {
        if (! is_array($row)) {
            continue;
        }
        if (($row['t'] ?? '') === 'event' && ($row['a'] ?? '') !== '') {
            $terminMitAdresse = true;
        }
        if (($row['t'] ?? '') !== 'event' && array_key_exists('a', $row)) {
            $fremderSchluessel = true;
        }
    }

    expect($terminMitAdresse)->toBeTrue('no date carries a coordinate — the second check measures nothing');
    // Three quarters of the rows have no coordinate; an empty key on every one of them
    // would be payload for nothing.
    expect($fremderSchluessel)->toBeFalse('a row that can never be answered carries the key anyway');
});

test('the palette offers „Zusagen" as an action that asks instead of navigating', function () {
    $html = $this->get(route('group.start'))->assertOk()->getContent();

    // An action WITHOUT an `href`: it raises the `z:` chip and leaves the palette open.
    // There is no page for it and there should not be — the list lives in the palette.
    expect($html)->toContain('data-palette-section="zusagen"')
        ->and($html)->toContain('zusagen(row)')
        // The action itself: `scope` instead of `href`. The value sits `@js`-encoded in the
        // island argument, hence the unicode-escape form — that is how it really stands in
        // the document, and a test expecting another spelling would be green because it
        // finds nothing at all.
        ->and($html)->toContain('zusagen\u0022}');
});
