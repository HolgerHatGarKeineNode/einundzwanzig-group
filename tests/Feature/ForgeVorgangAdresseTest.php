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

/*
 * ── P3: die workspace-weiten Listen und der klickbare Bestand ───────────────
 */

it('rendert die drei Bestandskacheln als Links — und die Patch-Zelle bewusst nicht', function () {
    $html = $this->withSession(['nostr_pubkey' => str_repeat('a', 64)])
        ->get(route('group.forge'))->assertOk()->getContent();

    foreach (['repos', 'issues', 'pulls'] as $ziel) {
        expect($html)->toContain('data-forge-kachel="'.$ziel.'"');
    }
    expect(substr_count($html, 'data-forge-kachel="'))->toBe(3);

    /*
     * Die Patch-Zelle ist KEIN Link: es gibt keine workspace-weite Patch-Liste.
     * Eine Kachel, die aussieht wie ihre Nachbarn und beim Antippen nichts tut,
     * wäre schlimmer als eine, die erkennbar nur zählt. Das Raster trägt damit
     * drei Zellen (alle Links) oder vier (drei Links, eine Zahl).
     */
    expect($html)->toContain('data-forge-tile="patches"');
});

it('baut den Listen-Umschalter als Button-Gruppe, nicht als Tablist', function () {
    $html = $this->withSession(['nostr_pubkey' => str_repeat('a', 64)])
        ->get(route('group.forge'))->assertOk()->getContent();

    /*
     * `desktop-forge.spec.ts:397-411` hält `getByRole('tab')).toHaveCount(0)` auf
     * Desktop als stehende Zusage fest. Ein `role="tablist"` kehrte sie still um
     * und verlangte zusätzlich Pfeiltasten-Navigation. Der Umschalter filtert
     * eine Liste, er wechselt keine Fläche — die Aktivitätsspur bleibt stehen.
     */
    expect($html)->toContain('data-forge-listen-umschalter')
        ->and($html)->not->toContain('role="tablist"')
        ->and($html)->not->toContain('role="tab"');
});

it('führt die drei Listen der linken Spur als eigene Regionen', function () {
    $html = $this->withSession(['nostr_pubkey' => str_repeat('a', 64)])
        ->get(route('group.forge'))->assertOk()->getContent();

    // Die Region-Marken sind zugleich die Sprungziele von `_springZuRegion`:
    // der Selektor dort baut sich aus dem Tab-Wert.
    foreach (['repos', 'issues', 'pulls', 'activity'] as $region) {
        expect($html)->toContain('data-forge-region="'.$region.'"');
    }
});

it('lässt die mobile Tab-Reihe bei DREI Reitern', function () {
    $html = $this->withSession(['nostr_pubkey' => str_repeat('a', 64)])
        ->get(route('group.forge'))->assertOk()->getContent();

    /*
     * `issues`/`pulls` sind seit P3 gültige `?tab=`-Werte, aber KEINE Reiter.
     * Die Reihe ist unterhalb `xl` der einzige Zugang zu den Kanälen, und
     * `forge-tab-adresse.spec.ts` hält `toHaveCount(3)` fest. Der Weg in die
     * neuen Listen führt über die Kacheln und den Umschalter.
     */
    /*
     * Gezählt wird `data-flux-tab` — das Attribut, das Flux an den GERENDERTEN
     * Knopf schreibt. Hier stand zuerst `substr_count($html, '<flux:tab ')`, und
     * das war vakuum-grün: eine Blade-Komponente steht nach dem Kompilieren nie
     * im HTML, die Zusicherung wäre auch bei zehn Reitern erfüllt gewesen.
     * Beim Schreiben gemessen, nicht angenommen.
     */
    expect(substr_count($html, 'data-flux-tab="data-flux-tab"'))->toBe(3);
    expect(substr_count($html, 'data-forge-tabs'))->toBe(1);
    foreach (['name="activity"', 'name="repos"', 'name="workspaces"'] as $reiter) {
        expect($html)->toContain($reiter);
    }
    // KONTROLLE: die neuen Listen sind KEINE Reiter.
    expect($html)->not->toContain('name="issues" wire:key')
        ->and($html)->not->toContain('name="pulls" wire:key');
});
