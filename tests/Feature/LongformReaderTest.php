<?php

declare(strict_types=1);
use Illuminate\Testing\TestResponse;
use Symfony\Component\HttpFoundation\Response;

/**
 * P7 (Longform-Reader) — die EINE Aussage, die serverseitig entschieden wird und deshalb
 * NICHT in Playwright gehört (billigere Schicht, s. Auftrag): ob `/articles` seinen
 * Leerzustand oder die Alpine-Insel bekommt, hängt an `config('group.board_relay_url')`
 * (`⚡articles.blade.php`, `@if (! config('group.board_relay_url'))`) — auswertbar über
 * `config()->set()`, ohne Browser, ohne Relay.
 *
 * Der Rest von P7 (Listenrendering, naddr-Auflösung, Sanitizer, Einstiege in Rail/Palette)
 * braucht einen echten Relay + Alpine-Boot und steht in `tests/e2e/longform-reader.spec.ts`.
 *
 * Bewusst EIGENE `fakeSessionPubkey()` statt der aus `EmptyStatesAndA11yTest.php` — Pest
 * garantiert keine feste Lade-/Namensraum-Reihenfolge zwischen Testdateien, eine
 * Cross-Datei-Abhängigkeit auf eine dort deklarierte globale Funktion wäre brüchig.
 */

/** Beliebiger 64-hex-Pubkey für eine "angemeldete" Session (Server-Gate, nicht Signer). */
function longformFakeSessionPubkey(): string
{
    return str_repeat('b', 64);
}

/**
 * @param  TestResponse<Response>  $res
 */
function longformResponseHtml(TestResponse $res): string
{
    $content = $res->getContent();

    if ($content === false) {
        throw new RuntimeException('Response::getContent() lieferte false — die Antwort hat keinen Body.');
    }

    return $content;
}

// Die Alpine-Insel (`x-data="nostrArticles(…)"`) sitzt auf dem ÄUSSEREN `<div>` und
// mountet in BEIDEN Zweigen — sie schickt bei leerer `BOARD_URL` selbst keinen REQ
// (`_boot()`: `if (feed.BOARD_URL === '') { this.loading = false; return }`, geprüft in
// `js/bridge.ts`). Was die serverseitige Weiche entscheidet, ist NICHT ob die Insel
// mountet, sondern WELCHE innere Nachricht der Nutzer VOR dem ersten Alpine-Tick sieht —
// genau das prüfen die beiden Tests unten, exklusiv gegeneinander.

test('Ohne konfigurierte Artikel-Quelle: /articles zeigt den ehrlichen "keine Quelle"-Leerzustand, nicht den generischen "noch keine Artikel"-Zustand', function () {
    config()->set('group.board_relay_url', null);

    $res = $this->withSession(['nostr_pubkey' => longformFakeSessionPubkey()])
        ->get(route('group.articles'))
        ->assertOk();
    $html = longformResponseHtml($res);

    expect($html)->toContain('Keine Artikel-Quelle eingerichtet.');
    expect($html)->toContain('Dieser Client kennt kein Relay, auf dem Artikel liegen.');
    // Die generische Leerliste (die client-seitig nach dem Boot ohnehin nie erreicht wird,
    // s. o.) darf serverseitig gar nicht erst ausgeliefert werden — sonst zeigt ein
    // unkonfigurierter Host kurz die falsche, weniger hilfreiche Nachricht.
    expect($html)->not->toContain('Noch keine Artikel.');
});

test('Mit konfigurierter Artikel-Quelle: /articles rendert das Lade-Skeleton, NICHT den "keine Quelle"-Leerzustand', function () {
    config()->set('group.board_relay_url', 'wss://board.example.test/');

    $res = $this->withSession(['nostr_pubkey' => longformFakeSessionPubkey()])
        ->get(route('group.articles'))
        ->assertOk();
    $html = longformResponseHtml($res);

    expect($html)->not->toContain('Keine Artikel-Quelle eingerichtet.');
    // Server-gerendertes Skeleton (SIX Karten, @for) statt eines x-if-Templates — steht
    // laut Kommentar in ⚡articles.blade.php ab dem ERSTEN Paint im DOM.
    expect(substr_count($html, 'skeleton aspect-[16/9] w-full'))->toBe(6);
});

test('Leerer String gilt als NICHT konfiguriert — dieselbe Weiche wie null (env(...) liefert bei fehlender Variable "")', function () {
    config()->set('group.board_relay_url', '');

    $html = longformResponseHtml($this->withSession(['nostr_pubkey' => longformFakeSessionPubkey()])
        ->get(route('group.articles'))->assertOk());

    expect($html)->toContain('Keine Artikel-Quelle eingerichtet.');
    expect($html)->not->toContain('Noch keine Artikel.');
});
