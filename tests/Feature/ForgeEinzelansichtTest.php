<?php

/**
 * Die Einzelrouten eines Vorgangs (GitHub-Parität P1, Plan
 * `2026-08-27T1950-forge-github-paritaet`): jede Issue und jeder Pull Request
 * ist eine eigene Seite — und die Alt-Links der Query-Ära (`?issue=`/`?pr=`)
 * bleiben Türen über einen serverseitigen Redirect.
 *
 * Der Server kennt dafür alles Nötige (naddr im Pfad, Id im Query); ein
 * Relay-Zugang ist NICHT erforderlich — „Existenz prüfen" ist eine andere
 * Frage als „URL umbiegen".
 *
 * Eigene `fakeSessionPubkey()` statt einer geteilten: Pest garantiert keine
 * feste Lade-/Namensraum-Reihenfolge zwischen Testdateien (Begründung und
 * Präzedenz: `tests/Feature/ArticleAuthorRouteTest.php`).
 */

/** Beliebiger 64-hex-Pubkey für eine "angemeldete" Session (Server-Gate, nicht Signer). */
function fakeSessionPubkey(): string
{
    return str_repeat('a', 64);
}

const NADDR = 'naddr1qvzqqqr4xgypqy2z6m4qc9tchk6qjlpxkm6m3v0ukv2rn8wfn8rsz3qhc4sdxl4c';

test('Die Einzelroute einer Issue rendert die Einzelansicht', function () {
    config(['group.workspace_url' => 'wss://buzz.test/']);
    $id = str_repeat('a', 64);

    $antwort = $this->withSession(['nostr_pubkey' => fakeSessionPubkey()])
        ->get("/forge/".NADDR."/issues/{$id}");

    $antwort->assertOk();
    expect($antwort->content())->toContain('nostrForgeVorgang');
});

test('Die Einzelroute eines Pull Requests rendert die Einzelansicht', function () {
    config(['group.workspace_url' => 'wss://buzz.test/']);
    $id = str_repeat('b', 64);

    $antwort = $this->withSession(['nostr_pubkey' => fakeSessionPubkey()])
        ->get("/forge/".NADDR."/pulls/{$id}");

    $antwort->assertOk();
    expect($antwort->content())->toContain('nostrForgeVorgang');
});

test('Alt-Link einer Issue leitet serverseitig auf die Route (302)', function () {
    $id = str_repeat('c', 64);

    $this->withSession(['nostr_pubkey' => fakeSessionPubkey()])
        ->get("/forge/".NADDR."?issue={$id}")
        ->assertRedirect("/forge/".NADDR."/issues/{$id}");
});

test('Alt-Link eines Pull Requests leitet serverseitig auf die Route (302)', function () {
    $id = str_repeat('d', 64);

    $this->withSession(['nostr_pubkey' => fakeSessionPubkey()])
        ->get("/forge/".NADDR."?pr={$id}")
        ->assertRedirect("/forge/".NADDR."/pulls/{$id}");
});

test('Großbuchstaben in der Alt-Id werden kleingeschrieben weitergeleitet', function () {
    $id = strtoupper(str_repeat('e', 64));

    $this->withSession(['nostr_pubkey' => fakeSessionPubkey()])
        ->get("/forge/".NADDR."?issue={$id}")
        ->assertRedirect("/forge/".NADDR."/issues/".strtolower($id));
});

test('ZWEI Ziele sind kein Ziel: ?issue= UND ?pr= leiten NICHT weiter', function () {
    // Regel 2 aus P2, am Server genauso wie damals am Client: eine Auswahl
    // zwischen beiden wäre geraten — die Adresse behauptete danach etwas
    // anderes als der Bildschirm zeigt.
    $this->withSession(['nostr_pubkey' => fakeSessionPubkey()])
        ->get('/forge/'.NADDR.'?issue='.str_repeat('a', 64).'&pr='.str_repeat('b', 64))
        ->assertOk();
});

test('Müll in der Alt-Id leitet NICHT weiter — die Repo-Seite bleibt sich selbst', function () {
    $this->withSession(['nostr_pubkey' => fakeSessionPubkey()])
        ->get('/forge/'.NADDR.'?issue=master')
        ->assertOk();
});
