<?php

declare(strict_types=1);

use Einundzwanzig\Group\Portal\HttpPortalCatalog;
use Einundzwanzig\Group\Portal\PortalAffordances;
use Einundzwanzig\Group\Portal\PortalStatus;
use Einundzwanzig\Group\Portal\WebPortalAffordances;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Livewire\Livewire;

/**
 * The read-only Portal pages (D9) and the palette index route (D6) — everything the SERVER
 * decides about them.
 *
 * Three promises are measured here, and each one has a way of failing silently:
 *
 *  1. **A GUEST sees these pages.** They are what somebody follows from a shared link
 *     („come to our meetup"), so a `nostr.auth` on them would be the opposite of the
 *     surface's purpose (D4). A redirect to the login instead of a 200 is invisible in a
 *     test that only asserts „no 500".
 *  2. **A Livewire roundtrip survives.** After a deploy an open tab sends exactly that
 *     roundtrip, and a 500 on it is a rejected promise in the browser — not a console
 *     error, so no console guard would ever see it (house rule 4b, R12).
 *  3. **The index leaves nothing per visitor.** No session, a working ETag, and the typed
 *     query never reaching the server.
 */
beforeEach(function (): void {
    config(['group.portal_url' => 'https://portal.test']);
    Cache::flush();
    portalFakes();
});

dataset('portal routes', [
    'meetups list' => ['group.bereich.meetups', []],
    'meetups Termine' => ['group.bereich.meetups', ['ansicht' => 'termine']],
    'meetups map view' => ['group.bereich.meetups', ['ansicht' => 'karte']],
    'meetup detail' => ['group.bereich.meetups.show', ['slug' => 'einundzwanzig-nordburgenland']],
    'courses' => ['group.bereich.kurse', []],
    'lecturers view' => ['group.bereich.kurse', ['ansicht' => 'referenten']],
    'course detail' => ['group.bereich.kurse.show', ['id' => 44]],
    'lecturer detail' => ['group.bereich.referenten.show', ['id' => 144]],
]);

test('every new Portal route answers 200 for a GUEST', function (string $name, array $params) {
    // The guest FIRST and in this order: `withSession()` sticks for the rest of the case, so
    // the reverse order would silently measure a member twice.
    $this->get(route($name, $params))->assertOk();
    $this->withSession(['nostr_pubkey' => str_repeat('c', 64)])->get(route($name, $params))->assertOk();
})->with('portal routes');

test('a Livewire roundtrip survives every new page', function () {
    foreach ([
        ['group::meetups', []],
        ['group::meetup', ['slug' => 'einundzwanzig-nordburgenland']],
        ['group::kurse', []],
        ['group::kurs', ['id' => 44]],
        ['group::referent', ['id' => 144]],
    ] as [$komponente, $params]) {
        Livewire::test($komponente, $params)->call('$refresh')->assertOk();
    }
});

test('the meetups list searches, filters by country and windows the rows', function () {
    Livewire::test('group::meetups')
        ->assertSee('Einundzwanzig Nordburgenland')
        ->assertSee('Bitcoin Meetup Jever')
        // The search runs over name AND city — the city is why somebody types „Jever".
        ->set('suche', 'jever')
        ->assertSee('Bitcoin Meetup Jever')
        ->assertDontSee('Einundzwanzig Nordburgenland')
        ->set('suche', '')
        ->set('land', 'at')
        ->assertSee('Einundzwanzig Nordburgenland')
        ->assertDontSee('Bitcoin Meetup Jever')
        // Out of an empty filter with one tap — the offer of the empty state.
        ->call('filterLeeren')
        ->assertSet('land', '')
        ->assertSee('Bitcoin Meetup Jever');
});

test('an unknown ?ansicht= falls back to the list instead of rendering nothing', function () {
    // A link from an app build (`?ansicht=karte`) opened on the web must not end in a blank
    // surface — the token set is a HOST decision (`meetup_views`), and on the web it has no
    // `karte` at all.
    config(['group.meetup_views' => ['liste', 'termine', 'karte']]);
    Livewire::test('group::meetups', ['ansicht' => 'karte'])->assertSet('ansicht', 'karte');

    config(['group.meetup_views' => ['liste', 'termine']]);
    // The web host does not offer the map: an app link lands on the list rather than nowhere.
    Livewire::test('group::meetups', ['ansicht' => 'karte'])->assertSet('ansicht', 'liste');
    Livewire::test('group::meetups', ['ansicht' => 'quatsch'])->assertSet('ansicht', 'liste');
});

test('without a bound map view the map tab links into the Portal instead of showing a blank tab', function () {
    config(['group.meetup_views' => ['liste', 'termine', 'karte'], 'group.meetup_map_view' => null]);

    $html = (string) $this->get(route('group.bereich.meetups', ['ansicht' => 'karte']))->assertOk()->getContent();

    expect($html)->toContain('data-meetups-karte-extern');
    expect($html)->toContain('https://portal.test/de/map');
    expect($html)->toContain('rel="external noopener"');
});

test('a host that BINDS a map view gets it rendered with the meetups in scope', function () {
    // The app binds it (Leaflet + device location). The package must not ship that view —
    // it would land in the association embed as well, which needs four chat views and no map.
    config([
        'group.meetup_views' => ['liste', 'termine', 'karte'],
        'group.meetup_map_view' => 'testing.portal-karte',
    ]);

    $html = (string) $this->get(route('group.bereich.meetups', ['ansicht' => 'karte']))->assertOk()->getContent();

    expect($html)->toContain('data-test-karte="2"');
    expect($html)->not->toContain('data-meetups-karte-extern');
});

test('a meetup detail shows its room button ONLY when the Portal says the room exists', function () {
    $mitRaum = (string) $this->get(route('group.bereich.meetups.show', 'einundzwanzig-nordburgenland'))->assertOk()->getContent();
    expect($mitRaum)->toContain('data-portal-raum="m'.substr(hash('sha256', '90'), 0, 12).'"');
    // The gate, not a bare link: a guest gets the login sheet, and in the app the room needs
    // a full document load for the welshman island to boot.
    expect($mitRaum)->toContain('authGate?.gateTap');

    // POSITIVE CONTROL for the absence: `has_room=false` removes the button. Without this
    // half the case would also pass if the button were never rendered at all.
    portalFakes(['portal.test/api/meetups*' => Http::response([[
        'id' => 90, 'has_room' => false, 'name' => 'Einundzwanzig Nordburgenland',
        'portalLink' => 'https://portal.test/at/meetup/einundzwanzig-nordburgenland',
        'country' => 'AT', 'city' => 'Nordburgenland', 'url' => null, 'website' => null,
        'next_event' => null, 'intro' => null, 'logo' => null,
    ]])]);
    Cache::flush();
    app()->forgetScopedInstances();

    $ohneRaum = (string) $this->get(route('group.bereich.meetups.show', 'einundzwanzig-nordburgenland'))->assertOk()->getContent();
    expect($ohneRaum)->not->toContain('data-portal-raum');
});

test('a detail page renders the host slot and nothing when no host binds it', function () {
    expect((string) $this->get(route('group.bereich.meetups.show', 'einundzwanzig-nordburgenland'))->getContent())
        ->not->toContain('data-test-detail-aktionen');

    // The web host's own block is a LINK out („Im Portal bearbeiten", D9); the app binds its
    // editor sheets here. One slot, because it is one question.
    config(['group.portal_detail_actions' => 'testing.portal-detail-aktionen']);

    $html = (string) $this->get(route('group.bereich.meetups.show', 'einundzwanzig-nordburgenland'))->assertOk()->getContent();
    expect($html)->toContain('data-test-detail-aktionen');
    expect($html)->toContain('https://portal.test/at/meetup/einundzwanzig-nordburgenland');
});

test('an offline Portal shows the retry state and NOT an empty result', function () {
    portalFakesZuruecksetzen();
    Http::fake(['portal.test/*' => Http::response('', 503)]);

    $html = (string) $this->get(route('group.bereich.meetups'))->assertOk()->getContent();

    // „Nothing found" and „nothing loaded" are different sentences — the first would send the
    // reader off changing a filter that was never the reason.
    expect($html)->toContain('data-portal-leer="fehler"');
    expect($html)->toContain('data-portal-retry');
    expect($html)->not->toContain('data-portal-leer="leer"');
});

test('a stale list is shown WITH its banner', function () {
    // Load once, then let the Portal die and time pass: the data stays, the sentence appears.
    $this->get(route('group.bereich.meetups'))->assertOk();
    portalFakesZuruecksetzen();
    Http::fake(['portal.test/*' => Http::response('', 500)]);
    $this->travel(HttpPortalCatalog::TTL_STATIC + 60)->seconds();
    app()->forgetScopedInstances();

    $html = (string) $this->get(route('group.bereich.meetups'))->assertOk()->getContent();

    expect($html)->toContain('data-portal-status="stale"');
    expect($html)->toContain('Einundzwanzig Nordburgenland');
});

// ── The palette index (D6) ──────────────────────────────────────────────────────

test('the index answers JSON with the four row types and WITHOUT a session', function () {
    $response = $this->get('/suche/portal-index')->assertOk();

    expect($response->headers->get('content-type'))->toContain('application/json');
    // No session means no `Set-Cookie` for a session: the endpoint sits outside the `web`
    // group on purpose (a session row per palette open serialises against every other
    // request on SQLite — measured on the image proxy: TTFB 0.4 s → 5 s).
    foreach ($response->headers->getCookies() as $cookie) {
        expect($cookie->getName())->not->toBe(config('session.cookie'));
    }

    expect($response->json('v'))->toBe(1);
    expect($response->json('status'))->toBe(PortalStatus::Fresh->value);
    /** @var list<array{t: string}> $rows */
    $rows = (array) $response->json('rows');
    expect(array_values(array_unique(array_map(static fn (array $row): string => $row['t'], $rows))))
        ->toBe(['meetup', 'event', 'course', 'lecturer']);
    // Short keys — the browser loads this once per palette session and names them once.
    expect(array_keys($rows[0]))->toBe(['t', 'r', 'n', 's', 'd']);
});

test('the index ignores a ?q= — the typed query never leaves the device', function () {
    // That is the whole promise of D6. A `q` read here would turn a private palette into a
    // query log, in this server AND one hop further in the Portal's logs.
    $ohne = $this->get('/suche/portal-index')->assertOk()->json('rows');
    $mit = $this->get('/suche/portal-index?q=jever')->assertOk()->json('rows');

    expect($mit)->toBe($ohne);
});

test('the second load is a 304 — including a weak validator and a list of them', function () {
    $etag = $this->get('/suche/portal-index')->assertOk()->headers->get('etag');
    expect($etag)->not->toBeNull();

    $this->withHeaders(['If-None-Match' => $etag])->get('/suche/portal-index')
        ->assertStatus(304)
        ->assertHeader('etag', $etag);

    // A proxy may weaken the validator or send several — a bare `===` against the header
    // would answer 200 to both, and an ETag that never validates costs its whole purpose.
    $this->withHeaders(['If-None-Match' => 'W/'.$etag])->get('/suche/portal-index')->assertStatus(304);
    $this->withHeaders(['If-None-Match' => '"fremd", '.$etag])->get('/suche/portal-index')->assertStatus(304);
    $this->withHeaders(['If-None-Match' => '"fremd"'])->get('/suche/portal-index')->assertOk();
});

test('the index carries its own throttle', function () {
    // Its own bucket and not the host's global one: the endpoint is answered from a cache and
    // loaded once per palette session, so a tight per-IP limit is right — and it must not be
    // the bucket that also carries the chat.
    $response = $this->get('/suche/portal-index')->assertOk();

    expect($response->headers->get('x-ratelimit-limit'))->toBe('60');
});

test('the index reports the catalog status so the palette can say it is old', function () {
    portalFakesZuruecksetzen();
    Http::fake(['portal.test/*' => Http::response('', 500)]);

    expect($this->get('/suche/portal-index')->assertOk()->json('status'))->toBe(PortalStatus::Offline->value);
});

// ── The affordances (D9) ────────────────────────────────────────────────────────

test('the web affordances ask the BROWSER and refuse a non-http scheme', function () {
    expect(app(PortalAffordances::class)::class)->toBe(WebPortalAffordances::class);
    expect(app(PortalAffordances::class)->canShareNatively())->toBeFalse();

    // A Portal link is foreign input — any meetup leader may edit it. `javascript:` in a
    // `window.open()` runs in THIS origin, and `intent:`/`nostrsigner:` would hand a foreign
    // app a payload from a web page. Fail CLOSED.
    Livewire::test('group::meetup', ['slug' => 'einundzwanzig-nordburgenland'])
        ->call('openLink', 'https://nordburgenland.test')
        ->assertDispatched('group-open-link', url: 'https://nordburgenland.test')
        ->call('openLink', 'javascript:alert(1)')
        ->assertNotDispatched('group-open-link');
});

test('„Zum Kalender" opens the PORTAL feed for this meetup', function () {
    // The Portal owns the dates, so it owns their `.ics` (`/stream-calendar?meetup=<id>`,
    // measured: 200 `text/calendar`). The app replaces this with its native editor.
    Livewire::test('group::meetup', ['slug' => 'einundzwanzig-nordburgenland'])
        ->call('kalender')
        ->assertDispatched('group-open-link', url: 'https://portal.test/stream-calendar?meetup=90');
});

test('sharing hands over the next date, not the bare page', function () {
    Livewire::test('group::meetup', ['slug' => 'einundzwanzig-nordburgenland'])
        ->call('teilen')
        ->assertDispatched('group-share');
});
