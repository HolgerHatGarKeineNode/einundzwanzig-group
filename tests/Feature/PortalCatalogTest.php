<?php

declare(strict_types=1);

use Einundzwanzig\Group\Portal\HttpPortalCatalog;
use Einundzwanzig\Group\Portal\PortalCatalog;
use Einundzwanzig\Group\Portal\PortalStatus;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;

/**
 * `PortalCatalog` — the seam between the read-only Portal pages (D9), the palette index
 * (D6) and the association portal.
 *
 * What is measured here, and why each of it:
 *
 *  1. **The mapping.** The Portal answers with dotted keys (`meetup.name`), a placeholder
 *     image for „no image" and a `next_event` nested one level deeper than the list's own
 *     date. Every one of those has already cost this code base a wrong surface somewhere,
 *     so the mapping is pinned field by field rather than „it returns objects".
 *  2. **How many requests one page costs (R9).** The Portal throttles at 60/min per IP and
 *     the group server is ONE IP for every visitor. The test counts requests.
 *  3. **The three statuses.** A read-only page over a foreign API has to distinguish
 *     „nothing found" from „nothing loaded"; `fresh`/`stale`/`offline` is that distinction,
 *     and a catalog that reports `fresh` while it served a week-old copy makes the banner a
 *     decoration.
 */
beforeEach(function (): void {
    config(['group.portal_url' => 'https://portal.test']);
    Cache::flush();
});

test('the web host resolves the package default catalog', function () {
    // The web client overrides NOTHING here — it IS the host the defaults were written
    // for. A missing default would have made the public `/suche/portal-index` answer with a
    // container error instead of an index.
    expect(app(PortalCatalog::class)::class)->toBe(HttpPortalCatalog::class);
});

test('meetups are mapped field by field and unmappable rows are dropped', function () {
    portalFakes();

    $meetups = app(PortalCatalog::class)->meetups();

    expect($meetups)->toHaveCount(2);
    expect($meetups[0]->slug)->toBe('einundzwanzig-nordburgenland');
    expect($meetups[0]->name)->toBe('Einundzwanzig Nordburgenland');
    expect($meetups[0]->country)->toBe('AT');
    expect($meetups[0]->countryCode())->toBe('at');
    expect($meetups[0]->nextEventStart?->format('Y-m-d H:i'))->toBe('2026-09-18 14:00');
    // The deep link is DERIVED (`…/<country>/meetup/<slug>`) — measured 100 % derivable
    // over all 304 meetups of 2026-07-19, so carrying the field would be a second truth.
    expect($meetups[0]->portalLink('https://portal.test'))->toBe('https://portal.test/at/meetup/einundzwanzig-nordburgenland');
    // Empty values arrive as null and not as '' — a '' logo would render a broken image.
    expect($meetups[1]->logo)->toBeNull();
    expect($meetups[1]->nextEventStart)->toBeNull();
});

test('a course without its own image has NO image — the Portal placeholder is a 404', function () {
    portalFakes();

    $kurse = collect(app(PortalCatalog::class)->courses())->keyBy('id');

    expect($kurse[44]->image)->toBe('https://portal.test/storage/2027/kurs.jpg');
    expect($kurse[44]->lecturerName)->toBe('Johannes');
    expect($kurse[44]->nextEvent?->format('Y-m-d H:i'))->toBe('2026-11-25 17:30');
    expect($kurse[45]->image)->toBeNull();
});

test('a date carries its meetup flat and the 31923 coordinate the Portal published', function () {
    portalFakes();

    $events = app(PortalCatalog::class)->events('2026-09-01', '2026-09-30');

    // Ascending by start — the Termine list groups by day and must not sort again.
    expect(array_map(fn ($e) => $e->start->format('Y-m-d H:i'), $events))
        ->toBe(['2026-09-18 14:00', '2026-09-21 16:00']);
    // The slug is read out of `meetup.portalLink` (the events endpoint carries no slug
    // field) — without it the row could not link to the meetup page.
    expect($events[0]->meetupSlug)->toBe('einundzwanzig-nordburgenland');
    expect($events[0]->meetupName)->toBe('Einundzwanzig Nordburgenland');
    expect($events[1]->nostrAddress)->toStartWith('31923:daf83d92');
    expect($events[0]->nostrAddress)->toBeNull();
});

test('a meetup detail carries intro, room and the social links with their labels', function () {
    portalFakes();

    $detail = app(PortalCatalog::class)->meetup('einundzwanzig-nordburgenland');

    expect($detail)->not->toBeNull();
    expect($detail->intro)->toContain('jeden');
    expect($detail->rsvpEnabled)->toBeTrue();
    expect($detail->attendeesPublic)->toBeTrue();
    // `h = "m" + sha256(id)[:12]` — identical to the production room creation and to the
    // companion's own derivation; rename-proof because it hangs on the id.
    expect($detail->roomH())->toBe('m'.substr(hash('sha256', '90'), 0, 12));
    // `url` is `telegram_link ?? webpage` in the map payload, so the LABEL depends on the
    // value; and `website` is de-duplicated against it.
    expect(array_keys($detail->links))->toBe([__('Telegram'), __('Website'), __('X (Twitter)'), __('Nostr')]);
    expect($detail->links[__('Nostr')])->toBe('https://njump.me/npub1abc');
    // An empty `simplex` ('' in the payload) is NOT a link.
    expect($detail->links)->not->toHaveKey(__('SimpleX'));
    // The next date comes from the SAME window the Termine list uses — one source for one
    // fact.
    expect($detail->nextEvent?->id)->toBe(2614);
});

test('a meetup that is not in the list is null and not an exception', function () {
    portalFakes();

    expect(app(PortalCatalog::class)->meetup('gibt-es-nicht'))->toBeNull();
    // …and the status stays fresh: „not found" is an ANSWER, not a failure.
    expect(app(PortalCatalog::class)->status())->toBe(PortalStatus::Fresh);
});

test('an unreachable Portal is offline — never an exception into a page', function () {
    // Every caller of this contract is a page that has to render something. A 500 from the
    // Portal must therefore become a STATUS, and the list must be empty rather than absent.
    portalFakesZuruecksetzen();
    Http::fake(['portal.test/*' => Http::response('', 500)]);

    $catalog = app(PortalCatalog::class);

    expect($catalog->meetups())->toBe([]);
    expect($catalog->courses())->toBe([]);
    expect($catalog->status())->toBe(PortalStatus::Offline);
});

test('a copy older than its TTL is served and reported as stale', function () {
    portalFakes();
    $catalog = app(PortalCatalog::class);
    expect($catalog->meetups())->toHaveCount(2);
    expect($catalog->status())->toBe(PortalStatus::Fresh);

    // Now the Portal is gone, and the entry is older than its TTL but inside the stale
    // window. A stale list plus a banner beats an error screen (D9) — and the status has to
    // SAY so, otherwise the banner never appears.
    portalFakesZuruecksetzen();
    Http::fake(['portal.test/*' => fn () => throw new RuntimeException('down')]);
    $this->travel(HttpPortalCatalog::TTL_STATIC + 60)->seconds();

    // A NEW request, and that is not cosmetic: the binding is `scoped`, so without this the
    // same catalog instance would answer out of its per-request memo and never look at the
    // cache again — the test would be green while measuring nothing.
    app()->forgetScopedInstances();
    $stale = app(PortalCatalog::class);
    expect($stale->meetups())->toHaveCount(2);
    expect($stale->status())->toBe(PortalStatus::Stale);
});

test('one page costs at most ONE request per list, and the cache carries the next visitor', function () {
    // R9: 60 requests/min per IP at the Portal, and this server is one IP for all of its
    // visitors. So the second reader of the same minute must cost nothing.
    portalFakes();

    $ersteSicht = app(PortalCatalog::class);
    $ersteSicht->meetups();
    $ersteSicht->meetups();
    $ersteSicht->courses();
    $ersteSicht->lecturers();

    expect(Http::recorded()->count())->toBe(3);

    // A second request of the same instance (fresh container, fresh catalog) — the cache
    // answers, the Portal does not see it at all.
    app()->forgetScopedInstances();
    app(PortalCatalog::class)->meetups();

    expect(Http::recorded()->count())->toBe(3);
});

test('the palette index projects all four lists into compact rows', function () {
    portalFakes();

    $rows = app(PortalCatalog::class)->search();
    $byType = collect($rows)->groupBy('type');

    expect($byType->keys()->all())->toBe(['meetup', 'event', 'course', 'lecturer']);
    // A meetup row: slug as the reference, „city · country" as the subtitle, the next date.
    $meetup = $byType['meetup']->firstWhere('ref', 'einundzwanzig-nordburgenland');
    expect($meetup->title)->toBe('Einundzwanzig Nordburgenland');
    expect($meetup->subtitle)->toBe('Nordburgenland · AT');
    expect($meetup->date)->toBe('2026-09-18 14:00');
    // An EVENT row points at its meetup: the read-only surfaces have no page per date, so
    // the date's id would be a key without a door.
    expect($byType['event']->first()->ref)->toBe('einundzwanzig-nordburgenland');
    // The JSON row is short-keyed — over the production lists the long keys were a fifth of
    // the payload, and the browser loads this once per palette session.
    expect(array_keys($meetup->toIndexRow()))->toBe(['t', 'r', 'n', 's', 'd']);
});

test('the index can be narrowed by type and filtered server-side', function () {
    portalFakes();
    $catalog = app(PortalCatalog::class);

    expect(collect($catalog->search('', ['course']))->pluck('type')->unique()->all())->toBe(['course']);

    // The non-empty query arm: it filters title AND subtitle. It is NEVER wired to a
    // keystroke — `/suche/portal-index` calls `search('')` and the browser filters, which
    // is the whole point of D6.
    $treffer = $catalog->search('neumarkt');
    expect(collect($treffer)->pluck('title')->all())->toContain('Johannes');
    expect(collect($treffer)->pluck('title')->all())->not->toContain('Alex Buck');
});
