<?php

declare(strict_types=1);

/*
 * P2 — die Adressierbarkeit eines einzelnen Vorgangs auf `/forge/{naddr}`.
 *
 * Geprüft wird hier die MARKUP-Seite des Vertrags: die reine Adressform steht
 * in `js/forgeVorgang.test.ts` und läuft unter `node --test`. Was dort nicht
 * messbar ist, ist die Verdrahtung — ein Sprungziel ohne `tabindex` nimmt
 * keinen Fokus an, und ein `toggle()` ohne Art schreibt die Adresse nicht.
 * Beides bräche still: die Seite sähe unverändert aus, nur der geteilte Link
 * führte ins Leere.
 */

it('rendert für Issue und Pull Request je ein fokussierbares Sprungziel', function () {
    $html = $this->withSession(['nostr_pubkey' => str_repeat('a', 64)])
        ->get(route('group.forge.repo', ['naddr' => 'naddr1beispiel']))->assertOk()->getContent();

    // Genau zwei: Issue und Pull Request. Ein Patch (1617) trägt bewusst keine
    // Adresse — die Form kennt `?issue=` und `?pr=`, sonst nichts.
    expect(substr_count($html, 'data-forge-vorgang tabindex="-1"'))->toBe(2);
});

it('übergibt dem Umschalter die Art, sonst wandert die Adresse nicht mit', function () {
    $html = $this->withSession(['nostr_pubkey' => str_repeat('a', 64)])
        ->get(route('group.forge.repo', ['naddr' => 'naddr1beispiel']))->assertOk()->getContent();

    expect($html)->toContain("toggle(issue.id, 'issue')")
        ->toContain("toggle(pr.id, 'pr')");
});

it('rendert den Kopier-Knopf im Rumpf beider Vorgangsarten', function () {
    $html = $this->withSession(['nostr_pubkey' => str_repeat('a', 64)])
        ->get(route('group.forge.repo', ['naddr' => 'naddr1beispiel']))->assertOk()->getContent();

    /*
     * Das Suchmuster trägt sein `="` mit Absicht. Flux gibt ein boolesches
     * Attribut als `name="name"` aus — ein Muster ohne `="` fände jeden Knopf
     * ZWEIMAL (einmal im Namen, einmal im Wert) und die erwartete Zahl wäre
     * geraten statt gemessen. Genau darauf ist diese Sonde beim Bauen
     * hereingefallen.
     */
    expect(substr_count($html, 'data-forge-vorgang-copy="'))->toBe(2)
        ->and($html)->toContain("copyVorgang(issue.id, 'issue')")
        ->and($html)->toContain("copyVorgang(pr.id, 'pr')");
});

it('lässt den serverseitigen /spaces-Redirect unberührt', function () {
    /*
     * Der Weg bricht ohne Fehlermeldung: `readSpacesTab` verwirft, was nicht auf
     * seiner Whitelist steht, und `?tab=workspaces` fiele wortlos auf „Räume"
     * zurück. P2 fasst `/forge` nicht an — geprüft wird das hier trotzdem, weil
     * ein Bruch sonst erst einem Nutzer auffiele.
     */
    $this->withSession(['nostr_pubkey' => str_repeat('a', 64)])
        ->get('/spaces?tab=workspaces')
        ->assertRedirect(route('group.forge').'?tab=workspaces');

    // KONTROLLE: ohne den Parameter bleibt `/spaces` die Raumliste. Ohne sie
    // misst der Fall darüber nur, dass diese Route überhaupt umleitet.
    $this->withSession(['nostr_pubkey' => str_repeat('a', 64)])->get('/spaces')->assertOk();
});
