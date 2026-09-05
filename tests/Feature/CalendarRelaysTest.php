<?php

declare(strict_types=1);

use Illuminate\Testing\TestResponse;
use Symfony\Component\HttpFoundation\Response;

/**
 * P2 — die serverseitige Weiche für die NIP-52-KALENDERQUELLE.
 *
 * ── Warum das eine eigene, serverseitige Zusage ist ────────────────────────────────
 *
 * Die Termine eines Meetups liegen nicht auf dem Space-Relay, sondern auf den
 * öffentlichen Relays des PORTALS: `einundzwanzig-portal` signiert und publiziert seine
 * Meetups (31924) und Termine (31923) seit dem 2026-09-04 selbst, alle fünf Minuten, auf
 * die Adressen aus seinem eigenen `NOSTR_RELAYS`. Welche das für diesen Client sind — und
 * WESSEN Termine gelten — steht deshalb in der Konfiguration
 * (`NOSTR_CALENDAR_RELAYS`/`NOSTR_CALENDAR_AUTHORS` → `group.calendar_*`) und wird über
 * `partials/head.blade.php` als `window.__nostrCalendarRelays`/`…Authors` in die Insel
 * gereicht.
 *
 * **Ein Code-Default wäre hier ein Fehler**, aus denselben zwei Gründen wie bei den
 * Artikel-Signal-Relais (`ArticleMetricRelaysTest.php`): er machte aus einer fehlenden
 * Konfiguration eine stille WebSocket-Verbindung ins öffentliche Internet, und der
 * fail-closed Relay-Wächter der E2E-Suite machte damit jeden Test rot, der einen
 * Meetup-Raum berührt.
 *
 * **Und der Autorenfilter ist keine Härtung, sondern die halbe Fläche.** kind 31923 ist
 * ein öffentliches Kind auf öffentlichen Relays, und das `a`-Tag, das einen Termin an
 * einen Meetup-Kalender bindet, ist eine BEHAUPTUNG — jeder darf ein Event mit unserer
 * Koordinate publizieren. Gemessen 2026-09-05 lieferte ein blanker
 * `nak req -k 31923 -l 100 wss://nos.lol` 100 Events von 16 Autoren. Ohne `authors`
 * stünde im Raumkopf, was ein Fremder dorthin zeigt.
 *
 * Serverseitig entschieden, also die billigere Schicht: kein Browser, kein Alpine, kein
 * Relay (dasselbe Muster wie `ArticleMetricRelaysTest.php`).
 */

/** Beliebiger 64-hex-Pubkey für eine „angemeldete" Session (Server-Gate, kein Signer). */
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
        throw new RuntimeException('Response::getContent() lieferte false — die Antwort hat keinen Body.');
    }

    return $content;
}

test('Ohne konfigurierte Kalenderquelle steht KEINE der beiden Variablen im Dokument', function () {
    config()->set('group.calendar_relay_urls', null);
    config()->set('group.calendar_authors', null);

    $res = $this->withSession(['nostr_pubkey' => calendarFakeSessionPubkey()])
        ->get(route('group.room', ['h' => 'anyroom']))
        ->assertOk();

    // Die Variablennamen stehen als LITERAL. Ein Vergleich gegen eine Konstante wäre das
    // Symbol gegen sich selbst: benennt jemand `window.__nostrCalendarRelays` um, ohne
    // `js/calendar.ts` mitzuziehen, liest die Insel dauerhaft `undefined` — und die
    // Terminkarte fiele still auf den HTTP-Rückfallweg zurück, ohne dass irgendetwas
    // kaputt aussähe.
    expect(calendarHtml($res))->not->toContain('__nostrCalendarRelays');
    expect(calendarHtml($res))->not->toContain('__nostrCalendarAuthors');
});

test('Mit konfigurierter Kalenderquelle reicht der Server BEIDE Werte wörtlich in die Insel', function () {
    // Kommagetrennt, mit einem Leerzeichen — genau die Schreibweise, die ein Mensch in
    // eine `.env` tippt. Der Server reicht den Rohwert durch; das Zerlegen, Normalisieren
    // und das Verwerfen von Nicht-Hex macht `js/calendar.ts` (dort geprüft).
    config()->set('group.calendar_relay_urls', 'wss://nos.lol, wss://relay.damus.io');
    config()->set('group.calendar_authors', 'daf83d92768b5d0005373f83e30d4203c0b747c170449e02fea611a0da125ee6');

    $res = $this->withSession(['nostr_pubkey' => calendarFakeSessionPubkey()])
        ->get(route('group.room', ['h' => 'anyroom']))
        ->assertOk();
    $html = calendarHtml($res);

    // `@js()` escaped die Schrägstriche (`wss:\/\/…`) — die Erwartung steht deshalb in
    // genau der Form, die im Dokument ankommt, nicht in der, die in der `.env` steht.
    expect($html)->toContain('wss:\/\/nos.lol, wss:\/\/relay.damus.io');
    expect($html)->toContain('daf83d92768b5d0005373f83e30d4203c0b747c170449e02fea611a0da125ee6');
    // `??` und nicht `=`: ein per `addInitScript` vorbesetzter Wert muss gewinnen, sonst
    // könnte ein E2E-Lauf die Fremdadressen nicht mehr wegnehmen — und genau das tut
    // `tests/e2e/meetup-calendar.spec.ts`, das sie auf den worker-eigenen Relay zieht.
    expect($html)->toContain('window.__nostrCalendarRelays = window.__nostrCalendarRelays ??');
    expect($html)->toContain('window.__nostrCalendarAuthors = window.__nostrCalendarAuthors ??');
});

test('Die zwei Hälften sind UNABHÄNGIG geschaltet — eine allein reicht der Insel nicht', function () {
    // Der Client verlangt beide (`calendarConfigured()` in `js/calendar.ts`). Sie stehen
    // trotzdem in ZWEI `@if`, damit eine halbe Konfiguration am Dokument sichtbar ist
    // statt sich als „gar nichts konfiguriert" zu tarnen: wer die Relays setzt und die
    // Autoren vergisst, findet den einen Namen im HTML und den anderen nicht.
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

test('BEIDE head-Partials tragen die Zeilen — sonst tut P2 auf einem der zwei Wege still nichts', function () {
    /*
     * **Der Baum hat zwei head-Partials, und beide werden produktiv gerendert:**
     * `resources/views/partials/head.blade.php` ist der normale Web-Head, das
     * gleichnamige im Paket der Minimal-Head für den Portal-/Fremdhost-Betrieb (aktiv
     * über `config('group.head_partial')`).
     *
     * **Beim Bau dieser Phase ist genau der Fehler passiert**, gegen den dieser Test
     * steht — derselbe, der schon P6 der Artikelfläche gekostet hat: die zwei Zeilen
     * standen zuerst NUR im Paket-Partial. Gefunden hat es keine Suite, sondern eine
     * Messung am laufenden Server (`curl … | grep __nostrCalendar` lieferte nichts,
     * während `config('group.calendar_relay_urls')` den Wert hatte). Die E2E-Spec war
     * dabei GRÜN, weil sie die Variablen per `addInitScript` selbst setzt und den Head
     * damit gar nicht befragt.
     *
     * Geprüft wird der VARIABLENNAME als Literal, nicht ein Symbol: `js/calendar.ts`
     * liest `globalThis.__nostrCalendarRelays`, und ein Tippfehler auf einer der beiden
     * Seiten ergibt dauerhaft `undefined` statt eines Fehlers.
     */
    $pfade = [
        base_path('resources/views/partials/head.blade.php'),
        base_path('packages/einundzwanzig-group/resources/views/partials/head.blade.php'),
    ];

    foreach ($pfade as $pfad) {
        expect(file_exists($pfad))->toBeTrue("Head-Partial nicht gefunden: {$pfad}");
        $quelle = (string) file_get_contents($pfad);

        // `str_contains` + `toBeTrue` statt `toContain($needle, $meldung)`: Pests
        // `toContain` nimmt VARIADISCH weitere Needles, kein Message-Argument — ein
        // zweiter Parameter würde als zusätzliche gesuchte Zeichenkette geprüft und die
        // Zusage wäre wertlos.
        expect(str_contains($quelle, 'window.__nostrCalendarRelays = window.__nostrCalendarRelays ??'))->toBeTrue(
            "Die P2-Relay-Zeile fehlt in {$pfad} — auf diesem Rendering-Weg bekommt die Insel die Kalender-Relays nie."
        );
        expect(str_contains($quelle, 'window.__nostrCalendarAuthors = window.__nostrCalendarAuthors ??'))->toBeTrue(
            "Die P2-Autoren-Zeile fehlt in {$pfad} — ohne sie fragt die Terminkarte dort gar nichts ab."
        );
        expect(str_contains($quelle, "config('group.calendar_relay_urls')"))->toBeTrue(
            "In {$pfad} steht die Relay-Zeile, liest aber einen anderen Konfigurationsschlüssel."
        );
        expect(str_contains($quelle, "config('group.calendar_authors')"))->toBeTrue(
            "In {$pfad} steht die Autoren-Zeile, liest aber einen anderen Konfigurationsschlüssel."
        );
    }
});
