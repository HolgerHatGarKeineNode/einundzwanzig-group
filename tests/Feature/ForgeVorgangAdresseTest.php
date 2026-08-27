<?php

declare(strict_types=1);

/*
 * Die Adressierbarkeit eines einzelnen Vorgangs — seit P1 (GitHub-Parität,
 * 2026-08-27) über EIGENE ROUTEN statt Query+Akkordeon.
 *
 * Geprüft wird hier die MARKUP-Seite des Vertrags: die reine Adressform steht
 * in `js/forgeVorgang.test.ts` (`vorgangPath`) und läuft unter `node --test`.
 * Die Route selbst (Rendern, Alt-Link-Redirects, Guard-Rails) steht in
 * `ForgeEinzelansichtTest.php`. Was hier bleibt, ist die VERDRAHTUNG der
 * Listen: jede Zeile muss die Route ihrer Art tragen — ein Link ohne die
 * richtige Art führe still auf die falsche Seite.
 */

it('verlinkt Issue- und Pull-Request-Zeilen auf ihre EINZELROUTEN — Patches nicht', function () {
    $html = $this->withSession(['nostr_pubkey' => str_repeat('a', 64)])
        ->get(route('group.forge.repo', ['naddr' => 'naddr1beispiel']))->assertOk()->getContent();

    expect($html)->toContain("vorgangHrefFuer(issue, 'issue')")
        ->and($html)->toContain("vorgangHrefFuer(pr, 'pr')")
        ->and($html)->toContain('data-forge-vorgang-link')
        // Die Patch-Zeile bleibt das einzige Akkordeon (keine Adresse, kein
        // Schreibweg): sie trägt bewusst KEINEN Zeilen-Link.
        ->and(substr_count($html, 'data-forge-vorgang-link'))->toBe(2);
});

it('trägt den Kopier-Knopf auf beiden EINZELANSICHTEN — argumentlos, die Insel kennt ihre Id', function () {
    $hex = str_repeat('a', 64);

    foreach (['issues' => 'group.forge.issue', 'pulls' => 'group.forge.pull'] as $segment => $route) {
        $html = $this->withSession(['nostr_pubkey' => str_repeat('a', 64)])
            ->get(route($route, ['naddr' => 'naddr1beispiel', 'id' => $hex]))->assertOk()->getContent();

        expect($html)->toContain('data-forge-vorgang-copy')
            ->and($html)->toContain('x-on:click="copyVorgang()"');
    }
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
