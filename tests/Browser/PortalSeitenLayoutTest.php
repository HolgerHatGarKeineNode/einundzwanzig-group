<?php

declare(strict_types=1);

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;

/**
 * The one VISIBLE-UI measurement of P4 (house rule 4): the meetups page at 390 × 844, with
 * real numbers, in a real browser — plus its console.
 *
 * Why a Pest browser test and not Playwright: the page is rendered SERVER-side from the
 * Portal, and the E2E stack is hermetic (no foreign origin may be reached). Here the Portal
 * is faked in the same process that serves the page, so the list is filled with known names
 * — and a measurement over an empty list would prove nothing about the overflow of a long
 * meetup name.
 */
it('measures the meetups page at 390x844 without horizontal overflow', function () {
    config(['group.portal_url' => 'https://portal.test']);
    Cache::flush();
    portalFakes([
        // One deliberately LONG name: the overflow question is only a question with one.
        'portal.test/api/mobile/meetups' => Http::response([
            [
                'id' => 90, 'name' => 'Einundzwanzig Nordburgenland und Umgebung — Donnerstagsrunde',
                'slug' => 'einundzwanzig-nordburgenland', 'city' => 'Nordburgenland', 'country' => 'AT',
                'latitude' => 47.84, 'longitude' => 16.6, 'logo' => null,
                'next_event_start' => '2026-09-18 14:00',
            ],
            [
                'id' => 309, 'name' => 'Bitcoin Meetup Jever', 'slug' => 'bitcoin-meetup-jever',
                'city' => 'Jever', 'country' => 'DE', 'latitude' => 53.5, 'longitude' => 7.9,
                'logo' => null, 'next_event_start' => null,
            ],
        ]),
    ]);

    // 390 × 844 exactly, and not `->on()->mobile()`: that preset is 375 × 667 (measured),
    // and 390 is the width this shell is measured at throughout the plan.
    $page = visit('/bereich/meetups')->withLocale('de-DE')->resize(390, 844);

    $page->assertSee('Einundzwanzig Nordburgenland und Umgebung')
        ->assertSee('Bitcoin Meetup Jever')
        // House rule 4b: the console of the page, not only its markup. A broken Alpine scope
        // in the sentinel island would be invisible to every server-side test.
        // `assertNoSmoke` = no JS errors AND an empty console. House rule 4b: the console of
        // the page, not only its markup — a broken Alpine scope in the sentinel island or in
        // the palette would be invisible to every server-side test (measured: this very case
        // caught four `… is not defined` from a stale bundle).
        ->assertNoSmoke();

    /** @var array<string, mixed> $mass */
    $mass = $page->script(<<<'JS'
        (() => {
            const root = document.documentElement
            const erste = document.querySelector('[data-portal-meetup]')
            const suche = document.querySelector('[data-portal-suche] input, input[data-portal-suche]')
            const box = erste?.getBoundingClientRect()
            return {
                viewport: [window.innerWidth, window.innerHeight],
                scrollWidth: root.scrollWidth,
                clientWidth: root.clientWidth,
                zeileBreite: box ? Math.round(box.width) : 0,
                zeileHoehe: box ? Math.round(box.height) : 0,
                zeilen: document.querySelectorAll('[data-portal-meetup]').length,
                sucheBreite: suche ? Math.round(suche.getBoundingClientRect().width) : 0,
            }
        })()
    JS);

    // The numbers, not an impression. 390 is the viewport of the phone this shell is built
    // for; `scrollWidth > clientWidth` is the one horizontal overflow that makes a page feel
    // broken, and it is the reason this case exists.
    expect($mass['viewport'][0])->toBe(390);
    expect($mass['scrollWidth'])->toBe($mass['clientWidth']);
    expect($mass['zeilen'])->toBe(2);
    // The row fits inside the viewport with the shell's padding on both sides …
    expect($mass['zeileBreite'])->toBeLessThanOrEqual(390);
    expect($mass['zeileBreite'])->toBeGreaterThan(300);
    // … and it is a touch target, not a line of text (44 px is the floor of this house).
    expect($mass['zeileHoehe'])->toBeGreaterThanOrEqual(44);
    expect($mass['sucheBreite'])->toBeGreaterThan(280);

    // Recorded for the report, so the numbers are in the artefact and not only in an
    // assertion that passed once.
    fwrite(STDERR, "\n390x844 Meetups: ".json_encode($mass)."\n");
});

it('measures the meetup detail at 390x844 — the widest content of the new pages', function () {
    // The detail page carries the one row type that overflows first: a LINK row with a full
    // URL in it. A list of names says little about that.
    config(['group.portal_url' => 'https://portal.test']);
    Cache::flush();
    // One deliberately LONG link, because that is the element that pushes a page sideways
    // first — a signal group invite is really this long in production.
    portalFakes(['portal.test/api/meetups*' => Http::response([[
        'id' => 90, 'has_room' => true, 'name' => 'Einundzwanzig Nordburgenland',
        'portalLink' => 'https://portal.test/at/meetup/einundzwanzig-nordburgenland',
        'url' => 'https://t.me/nordburgenland', 'country' => 'AT', 'city' => 'Nordburgenland',
        'twitter_username' => 'nbgl', 'website' => 'https://nordburgenland.test',
        'nostr' => 'npub1abc', 'simplex' => '',
        'signal' => 'https://signal.group/#CjQKIOx7ScvrJJkact-9Fs9qWKsSDVBr_Oltvutoi52gaWNwEhBzK1QuXa076qDj31V07nwo',
        'rsvp_enabled' => true, 'attendees_public' => true,
        'next_event' => ['id' => 2614, 'start' => '2026-09-18 14:00', 'attendees' => 3, 'might_attendees' => 1],
        'intro' => 'Wir treffen uns jeden Donnerstag.', 'logo' => null,
    ]])]);

    $page = visit('/bereich/meetups/einundzwanzig-nordburgenland')->withLocale('de-DE')->resize(390, 844);

    $page->assertSee('Einundzwanzig Nordburgenland')
        ->assertSee('Links')
        ->assertNoSmoke();

    /** @var array<string, mixed> $mass */
    $mass = $page->script(<<<'JS'
        (() => {
            const root = document.documentElement
            // The Signal row, i.e. the longest URL on this page — the first row would be the
            // short Telegram one and would say nothing about clipping.
            const link = document.querySelector('[data-portal-link="Signal"]')
            const kopf = document.querySelector('[data-portal-meetup-kopf]')
            const box = (el) => (el ? el.getBoundingClientRect() : null)
            const l = box(link)
            const k = box(kopf)
            // The one element that really can push a page sideways: the URL under a link label.
            const urlZeile = link?.querySelector('span.truncate')
            return {
                viewport: [window.innerWidth, window.innerHeight],
                scrollWidth: root.scrollWidth,
                clientWidth: root.clientWidth,
                kopfBreite: k ? Math.round(k.width) : 0,
                linkBreite: l ? Math.round(l.width) : 0,
                linkHoehe: l ? Math.round(l.height) : 0,
                urlUeberlauf: urlZeile ? urlZeile.scrollWidth > urlZeile.clientWidth : null,
                links: document.querySelectorAll('[data-portal-link]').length,
            }
        })()
    JS);

    expect($mass['viewport'])->toBe([390, 844]);
    expect($mass['scrollWidth'])->toBe($mass['clientWidth']);
    expect($mass['links'])->toBe(5);
    expect($mass['linkBreite'])->toBeLessThanOrEqual(390);
    expect($mass['linkHoehe'])->toBeGreaterThanOrEqual(44);
    // The long URL is CLIPPED inside its row (`truncate`) instead of widening the page —
    // that is the mechanism, and `scrollWidth === clientWidth` above is its consequence.
    // The long URL is CLIPPED inside its row (`truncate`) instead of widening the page —
    // that is the mechanism, and `scrollWidth === clientWidth` above is its consequence.
    expect($mass['urlUeberlauf'])->toBeTrue();

    fwrite(STDERR, "\n390x844 Meetup-Detail: ".json_encode($mass)."\n");
});
