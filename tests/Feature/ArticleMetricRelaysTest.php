<?php

declare(strict_types=1);
use Illuminate\Testing\TestResponse;
use Symfony\Component\HttpFoundation\Response;

/**
 * P6 — die serverseitige Weiche für die Relays der ARTIKEL-SOZIALSIGNALE.
 *
 * ── Warum das eine eigene, serverseitige Zusage ist ────────────────────────────────
 *
 * Die Zähler unter einem Artikel (Reaktionen, Zaps, Kommentare) liegen nicht auf dem
 * Vereins-Relay, sondern zum ganz überwiegenden Teil auf fremden: am 2026-08-21 über alle
 * 104 Artikel gemessen sieht der Board **14 %** der Reaktionen, **3 %** der Zaps und
 * **20 %** der Kommentare. Welche Fremdrelays gefragt werden, steht deshalb in der
 * Konfiguration (`NOSTR_ARTICLE_METRIC_RELAYS` → `group.article_relay_urls`) und wird über
 * `partials/head.blade.php` als `window.__nostrArticleRelays` in die Insel gereicht.
 *
 * **Und ein Code-Default wäre hier ein Fehler**, aus zwei Gründen, die beide bereits
 * einmal Geld gekostet haben:
 *
 *  1. Er machte aus einer fehlenden Konfiguration eine stille WebSocket-Verbindung ins
 *     öffentliche Internet — dieselbe Begründung steht seit P7 bei `board_relay_url`.
 *  2. Der Relay-Wächter der E2E-Suite ist **fail-closed** gegen eine Allowlist der
 *     eigenen Worker-Ports. Eine eingebaute Fremdadresse machte jeden Test rot, der eine
 *     Artikelfläche berührt — und zwar aus einem Grund, der wie ein Regress aussieht.
 *
 * Beide Zweige stehen unten exklusiv gegeneinander. Serverseitig entschieden, also die
 * billigere Schicht: kein Browser, kein Alpine, kein Relay (dasselbe Muster wie
 * `LongformReaderTest.php`).
 */

/** Beliebiger 64-hex-Pubkey für eine „angemeldete" Session (Server-Gate, kein Signer). */
function articleMetricsFakeSessionPubkey(): string
{
    return str_repeat('c', 64);
}

/**
 * @param  TestResponse<Response>  $res
 */
function articleMetricsHtml(TestResponse $res): string
{
    $content = $res->getContent();

    if ($content === false) {
        throw new RuntimeException('Response::getContent() lieferte false — die Antwort hat keinen Body.');
    }

    return $content;
}

test('Ohne konfigurierte Signal-Relays steht KEIN __nostrArticleRelays im Dokument', function () {
    config()->set('group.article_relay_urls', null);

    $res = $this->withSession(['nostr_pubkey' => articleMetricsFakeSessionPubkey()])
        ->get(route('group.articles'))
        ->assertOk();

    // Der Variablenname steht hier als LITERAL. Ein Vergleich gegen eine Konstante wäre
    // das Symbol gegen sich selbst: benennt jemand `window.__nostrArticleRelays` um,
    // ohne `js/longformFeed.ts` mitzuziehen, liest die Insel dauerhaft `undefined` und
    // fragt still nur noch den Board — sichtbar wären dann bloß kleinere Zahlen.
    expect(articleMetricsHtml($res))->not->toContain('__nostrArticleRelays');
});

test('Mit konfigurierten Signal-Relays reicht der Server sie WÖRTLICH in die Insel', function () {
    // Kommagetrennt, mit einem Leerzeichen — genau die Schreibweise, die ein Mensch in
    // eine `.env` tippt. Der Server reicht den Rohwert durch; das Zerlegen und
    // Normalisieren macht `leseRelayListe` in `js/articleMetrics.ts` (dort geprüft).
    config()->set('group.article_relay_urls', 'wss://nos.lol, wss://relay.damus.io');

    $res = $this->withSession(['nostr_pubkey' => articleMetricsFakeSessionPubkey()])
        ->get(route('group.articles'))
        ->assertOk();
    $html = articleMetricsHtml($res);

    expect($html)->toContain('__nostrArticleRelays');
    // `@js()` escaped die Schrägstriche (`wss:\/\/…`) — die Erwartung steht deshalb in
    // genau der Form, die im Dokument ankommt, nicht in der, die in der `.env` steht.
    expect($html)->toContain('wss:\/\/nos.lol, wss:\/\/relay.damus.io');
    // `??` und nicht `=`: ein per `addInitScript` vorbesetzter Wert muss gewinnen, sonst
    // könnte ein E2E-Lauf die Fremdadressen nicht mehr wegnehmen. Dieselbe Regel wie bei
    // `__nostrSpace`, `__nostrWorkspace` und `__nostrBoard` darüber.
    expect($html)->toContain('window.__nostrArticleRelays = window.__nostrArticleRelays ??');
});

test('Die Artikel-QUELLE bleibt davon unberührt — die Kuratierungsregel gilt weiter', function () {
    // Die Zusage, die durch diese Phase am ehesten stillschweigend fallen könnte: kind
    // 30023 kommt AUSSCHLIESSLICH vom Board-Relay. Die Signal-Relays sind eine zweite,
    // eng begrenzte Variable und dürfen die erste nicht ersetzen.
    config()->set('group.board_relay_url', null);
    config()->set('group.article_relay_urls', 'wss://nos.lol');

    $res = $this->withSession(['nostr_pubkey' => articleMetricsFakeSessionPubkey()])
        ->get(route('group.articles'))
        ->assertOk();
    $html = articleMetricsHtml($res);

    // Ohne Board bleibt es beim ehrlichen „keine Quelle"-Leerzustand — Signal-Relays
    // machen daraus keine Artikelliste.
    expect($html)->toContain('Keine Artikel-Quelle eingerichtet.');
    expect($html)->not->toContain('__nostrBoard');
});

test('BEIDE head-Partials tragen die Zeile — sonst tut P6 auf einem der zwei Wege still nichts', function () {
    /*
     * **Der Baum hat zwei head-Partials, und beide werden produktiv gerendert:**
     * `resources/views/partials/head.blade.php` ist der normale Web-Head, das
     * gleichnamige im Paket der Minimal-Head für den Portal-/Fremdhost-Betrieb (aktiv
     * über `config('group.head_partial')`).
     *
     * **Beim Bau dieser Phase ist genau der Fehler passiert**, gegen den dieser Test
     * steht: die Zeile stand zuerst NUR im Paket-Partial. Der Test darüber wurde rot und
     * hat es gefunden — ohne ihn wäre P6 im normalen Web-Betrieb wirkungslos geblieben,
     * und sichtbar wäre davon nichts gewesen außer kleineren Zahlen unter den Artikeln.
     *
     * Geprüft wird der VARIABLENNAME als Literal, nicht ein Symbol: `js/longformFeed.ts`
     * liest `globalThis.__nostrArticleRelays`, und ein Tippfehler auf einer der beiden
     * Seiten ergibt dauerhaft `undefined` statt eines Fehlers.
     */
    $pfade = [
        base_path('resources/views/partials/head.blade.php'),
        base_path('packages/einundzwanzig-group/resources/views/partials/head.blade.php'),
    ];

    foreach ($pfade as $pfad) {
        expect(file_exists($pfad))->toBeTrue("Head-Partial nicht gefunden: {$pfad}");
        $quelle = (string) file_get_contents($pfad);

        // `str_contains` + `toBeTrue` statt `toContain($needle, $message)`: Pests
        // `toContain` nimmt VARIADISCH weitere Needles, kein Message-Argument — ein
        // zweiter Parameter würde als zusätzliche gesuchte Zeichenkette geprüft. Genau
        // das ist hier beim Bauen passiert und sah wie ein echter Befund aus.
        expect(str_contains($quelle, 'window.__nostrArticleRelays = window.__nostrArticleRelays ??'))->toBeTrue(
            "Die P6-Zeile fehlt in {$pfad} — auf diesem Rendering-Weg bekommt die Insel die Signal-Relays nie."
        );
        expect(str_contains($quelle, "config('group.article_relay_urls')"))->toBeTrue(
            "In {$pfad} steht die Zeile, liest aber einen anderen Konfigurationsschlüssel."
        );
    }
});
