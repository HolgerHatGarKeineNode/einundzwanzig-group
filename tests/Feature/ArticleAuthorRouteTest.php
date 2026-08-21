<?php

declare(strict_types=1);

use Illuminate\Testing\TestResponse;
use Symfony\Component\HttpFoundation\Response;

/**
 * P4 (Autorenseite, `/articles/autor/{autor}`) — was der **Server** entscheidet.
 *
 * Genau drei Dinge, und keines davon braucht einen Browser:
 *
 *  1. **Die Route trägt den Parameter durch** — auch die NIP-05-Form mit `@`, die als
 *     einzige beim Routing verunglücken könnte.
 *  2. **Die Weiche `config('group.board_relay_url')`** — dieselbe wie auf `/articles`
 *     und `/articles/{naddr}`, hier ein drittes Mal.
 *  3. **Die vier Fehlzustände stehen als vier unterscheidbare Blöcke im ausgelieferten
 *     Markup** — inklusive vier verschiedener Überschriften. Ob der richtige davon
 *     erscheint, entscheidet die Insel und prüft `tests/e2e/article-author.spec.ts`;
 *     DASS es vier verschiedene gibt, ist eine Eigenschaft des Blades und gehört auf
 *     die billigere Schicht.
 *
 * **Warum diese Datei im HOST liegt und nicht im Paket:** `packages/einundzwanzig-group`
 * bringt kein Test-Harness mit (kein `tests/`, kein eigenes phpunit.xml). Jeder
 * Pest-Feature-Test des Pakets steht deshalb hier — Präzedenzfall aus derselben Fläche:
 * `tests/Feature/LongformReaderTest.php`.
 *
 * Eigene `fakeSessionPubkey()` statt einer geteilten: Pest garantiert keine feste
 * Lade-/Namensraum-Reihenfolge zwischen Testdateien (gleiche Begründung wie dort).
 */

/** Beliebiger 64-hex-Pubkey für eine „angemeldete" Session (Server-Gate, nicht Signer). */
function autorFakeSessionPubkey(): string
{
    return str_repeat('c', 64);
}

/**
 * @param  TestResponse<Response>  $res
 */
function autorResponseHtml(TestResponse $res): string
{
    $content = $res->getContent();

    if ($content === false) {
        throw new RuntimeException('Response::getContent() lieferte false — die Antwort hat keinen Body.');
    }

    return $content;
}

/**
 * Die URL der Autorenseite. **Nur die URL** — der Request bleibt bei `$this`.
 *
 * Ein Helfer, der selbst `test()->withSession(...)` aufruft, ist zwar zur Laufzeit
 * richtig, aber für PHPStan nicht typisierbar: `test()` ist dort
 * `TestCall|HigherOrderTapProxy`, und `withSession()` existiert auf beidem nicht
 * (`method.notFound`, im Gate gemessen). Der bewährte Weg im Haus ist `$this` IM
 * Testkörper — genau wie in `LongformReaderTest.php`.
 */
function autorUrl(string $autor): string
{
    return route('group.articles.author', ['autor' => $autor]);
}

// ── 1. Die Route ───────────────────────────────────────────────────────────────────

test('die Route existiert und liegt hinter dem Nostr-Gate', function () {
    // Ohne Session: derselbe Riegel wie bei jeder anderen Fläche unter `nostr.auth`.
    $this->get(route('group.articles.author', ['autor' => 'npub1abc']))
        ->assertRedirect(route('group.nostr-login'));
});

test('route() baut die npub-Form ohne Umkodierung', function () {
    expect(route('group.articles.author', ['autor' => 'npub1abc'], false))
        ->toBe('/articles/autor/npub1abc');
});

test('route() baut die NIP-05-Form MIT @ — nicht als %40', function () {
    // Das `@` ist das einzige Zeichen dieser Fläche, das ein Generator umkodieren könnte;
    // ein `%40` im Pfad wäre für den Nutzer eine andere, hässlichere Adresse und für den
    // Parameter derselbe Wert — die Zusage ist die LESBARE Adresse.
    expect(route('group.articles.author', ['autor' => 'alice@example.com'], false))
        ->toBe('/articles/autor/alice@example.com');
});

test('der Parameter kommt UNVERAENDERT in der Insel an — npub und NIP-05', function () {
    config()->set('group.board_relay_url', 'wss://board.example.test/');

    $html = autorResponseHtml($this->withSession(['nostr_pubkey' => autorFakeSessionPubkey()])->get(autorUrl('npub1abcdef'))->assertOk());
    expect($html)->toContain("nostrArticleAuthor('npub1abcdef'");

    // Die NIP-05-Form ist der Fall, der beim Routing verunglücken könnte. `@js()` escaped
    // sie für JavaScript; der Punkt bleibt ein Punkt, das @ ein @.
    $html = autorResponseHtml($this->withSession(['nostr_pubkey' => autorFakeSessionPubkey()])->get(autorUrl('alice@example.com'))->assertOk());
    expect($html)->toContain("nostrArticleAuthor('alice@example.com'");
});

test('/articles/autor OHNE Kennung ist die Vollansicht, nicht die Autorenseite', function () {
    // Zwei Segmente treffen `/articles/{naddr}`. Das ist gewollt und harmlos: der `naddr`
    // „autor" ist unlesbar, und die Vollansicht sagt genau das. Ein eigener Leerzustand
    // dafür wäre eine Seite für einen Tippfehler.
    config()->set('group.board_relay_url', 'wss://board.example.test/');

    $html = autorResponseHtml($this->withSession(['nostr_pubkey' => autorFakeSessionPubkey()])
        ->get('/articles/autor')->assertOk());

    expect($html)->toContain('nostrArticle(');
    expect($html)->not->toContain('nostrArticleAuthor(');
});

// ── 2. Die Weiche auf die Artikel-Quelle ───────────────────────────────────────────

test('ohne konfigurierte Artikel-Quelle: der ehrliche „keine Quelle"-Leerzustand, kein Fehlzustand', function () {
    config()->set('group.board_relay_url', null);

    $html = autorResponseHtml($this->withSession(['nostr_pubkey' => autorFakeSessionPubkey()])->get(autorUrl('npub1abc'))->assertOk());

    expect($html)->toContain('Keine Artikel-Quelle eingerichtet.');
    // Kein Wort über den Autor: ohne Relay wurde nie jemand gefragt.
    expect($html)->not->toContain('Von diesem Autor liegt hier noch kein Artikel.');
    expect($html)->not->toContain('data-autor-fehler');
});

test('leerer String gilt als NICHT konfiguriert — dieselbe Weiche wie null', function () {
    config()->set('group.board_relay_url', '');

    expect(autorResponseHtml($this->withSession(['nostr_pubkey' => autorFakeSessionPubkey()])->get(autorUrl('npub1abc'))->assertOk()))
        ->toContain('Keine Artikel-Quelle eingerichtet.');
});

test('mit konfigurierter Artikel-Quelle: Skeleton statt „keine Quelle"', function () {
    config()->set('group.board_relay_url', 'wss://board.example.test/');

    $html = autorResponseHtml($this->withSession(['nostr_pubkey' => autorFakeSessionPubkey()])->get(autorUrl('npub1abc'))->assertOk());

    expect($html)->not->toContain('Keine Artikel-Quelle eingerichtet.');
    // Server-gerendertes Skeleton (VIER Karten, @for) — es steht ab dem ersten Paint im
    // DOM, anders als der Inhalt eines `<template x-if>`.
    expect(substr_count($html, 'skeleton aspect-[16/9] w-full'))->toBe(4);
});

// ── 3. Vier Fehlzustände, vier Sätze ───────────────────────────────────────────────

test('alle VIER Fehlzustaende stehen als eigene Bloecke im Markup', function () {
    config()->set('group.board_relay_url', 'wss://board.example.test/');

    $html = autorResponseHtml($this->withSession(['nostr_pubkey' => autorFakeSessionPubkey()])->get(autorUrl('npub1abc'))->assertOk());

    foreach (['format', 'npub', 'nip05-unbekannt', 'nip05-fehlgeschlagen'] as $art) {
        expect($html)->toContain('data-autor-fehler="'.$art.'"');
    }
});

test('die vier Fehlzustaende tragen VIER VERSCHIEDENE Ueberschriften — nicht viermal denselben Satz', function () {
    config()->set('group.board_relay_url', 'wss://board.example.test/');

    $html = autorResponseHtml($this->withSession(['nostr_pubkey' => autorFakeSessionPubkey()])->get(autorUrl('npub1abc'))->assertOk());

    // Literale, keine Symbole: die Zusage der DoD ist der TEXT, den ein Mensch liest.
    $saetze = [
        'Das ist keine Autoren-Adresse.',
        'Diese npub lässt sich nicht lesen.',
        'Diese Domain kennt den Namen nicht.',
        'Diese Domain hat nicht geantwortet.',
    ];

    expect(count(array_unique($saetze)))->toBe(4, 'Die vier Sätze müssen verschieden sein, sonst prüft dieser Test nichts.');

    foreach ($saetze as $satz) {
        expect($html)->toContain($satz);
    }
});

test('NUR der wiederholbare Fehlzustand bietet einen zweiten Versuch an', function () {
    config()->set('group.board_relay_url', 'wss://board.example.test/');

    $html = autorResponseHtml($this->withSession(['nostr_pubkey' => autorFakeSessionPubkey()])->get(autorUrl('npub1abc'))->assertOk());

    // Der Block, der „Erneut versuchen" trägt, ist genau der mit `nip05-fehlgeschlagen`.
    // Gemessen wird der Abstand im Markup: der Knopf steht INNERHALB dieses Blocks und
    // vor dem Ende der `<template>`. Ein Schnitt am Blockanfang genügt dafür.
    $ab = strpos($html, 'data-autor-fehler="nip05-fehlgeschlagen"');
    expect($ab)->not->toBeFalse('Der wiederholbare Fehlzustand fehlt im Markup — dieser Test misst dann nichts.');

    $block = substr($html, (int) $ab, (int) strpos($html, '</template>', (int) $ab) - (int) $ab);
    expect($block)->toContain('Erneut versuchen');

    // Und die anderen drei bieten ihn NICHT an: eine Domain, die den Namen nicht kennt,
    // kennt ihn beim zehnten Versuch auch nicht.
    foreach (['format', 'npub', 'nip05-unbekannt'] as $art) {
        $von = (int) strpos($html, 'data-autor-fehler="'.$art.'"');
        $bis = (int) strpos($html, '</template>', $von);
        expect(substr($html, $von, $bis - $von))->not->toContain('Erneut versuchen');
    }
});

test('der ROHE Routen-Parameter wird nirgends als Text gebunden — nur die geprueffte Domain', function () {
    config()->set('group.board_relay_url', 'wss://board.example.test/');

    $html = autorResponseHtml($this->withSession(['nostr_pubkey' => autorFakeSessionPubkey()])->get(autorUrl('npub1abc'))->assertOk());

    // In eine URL wird auch mal ein `nsec` getippt. Die Fläche zeigt deshalb aus der
    // Eingabe ausschließlich die DOMAIN (gegen ein enges Muster geprüft, `articleAuthor.ts`)
    // und nie den Parameter selbst. Strukturell geprüft statt an einem Beispiel: es gibt
    // keine Bindung, die `_param` in den Text schriebe.
    expect($html)->not->toContain('x-text="_param');
    expect($html)->not->toContain('x-html="_param');
    // Die Domain-Bindung dagegen MUSS es geben, sonst nennt Fehlzustand 3 und 4 kein Ziel.
    expect(substr_count($html, 'join(fehlerDomain)'))->toBe(2);
});

// ── Die Ueberschriften-Ebene ───────────────────────────────────────────────────────

test('die Monatsmarke ist ein h2 und die Kartentitel sind h3 — die Gliederung ist echt', function () {
    config()->set('group.board_relay_url', 'wss://board.example.test/');

    $html = autorResponseHtml($this->withSession(['nostr_pubkey' => autorFakeSessionPubkey()])->get(autorUrl('npub1abc'))->assertOk());

    // Die `h1` trägt `app-header` (der Autorenname). Eine Monatsmarke, die als `<div>`
    // gestylt wäre, behauptete eine Gliederung, die für eine Sprachausgabe nicht
    // existiert; Kartentitel als `h2` sprängen die Ebene der Marke.
    expect($html)->toContain('data-monatsmarke');
    expect(substr_count($html, '<h2 class="mb-3 flex items-center gap-3">'))->toBe(1);
    // Zwei `<h3>` je Karte, exklusiv: mit Titelbild im Textblock, ohne im Deckel.
    expect(substr_count($html, '<h3'))->toBe(2);
});
