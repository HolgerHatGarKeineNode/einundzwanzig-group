<?php

declare(strict_types=1);
use Illuminate\Testing\TestResponse;
use Symfony\Component\HttpFoundation\Response;

/**
 * P3 (Leerzustände, Einstieg, Fokusführung) — Sicherheitsnetz für die
 * server-gerenderte Blade-Seite dieser Insel-Komponenten. Wie `ThemeAndA11yTest`:
 * reines "wird das richtige Markup ausgeliefert"-Prüfen über die kompilierte
 * Blade-Ausgabe, kein Alpine-Boot nötig (der Server rendert unabhängig vom
 * Relay-Zustand — `$h` geht nur als String durch, `SpaceCache` liefert bei
 * fehlendem Cache-Eintrag `null` zurück, kein Fehler).
 *
 * Interaktives Verhalten (Fokus nach Klick, localStorage-Persistenz,
 * Login-Sheet-Redirect) deckt Playwright ab (tests/e2e/onboarding.spec.ts,
 * tests/e2e/a11y-focus-order.spec.ts) — hier wird nur festgeschrieben, DASS das
 * richtige Markup mit den richtigen Bedingungen im HTML steht.
 *
 * Blade escaped `&&`/`<`/`>` NICHT innerhalb roher HTML-Attribute (nur `{{ }}`
 * wird escaped) — die Marker unten sind daher rohe `&&`, nicht `&amp;&amp;`.
 * `<flux:button>` kompiliert zu einem echten `<button ... data-flux-button>`,
 * nicht zu einem literalen `<flux:button`-Tag — Blöcke werden deshalb über
 * `data-flux-button=` gezählt, nicht über den Komponentennamen.
 */

/** Beliebiger 64-hex-Pubkey für eine "angemeldete" Session (Server-Gate, nicht Signer). */
function fakeSessionPubkey(): string
{
    return str_repeat('a', 64);
}

/**
 * `TestResponse::getContent()` delegiert (via `__call`) an Symfonys
 * `Response::getContent(): string|false` — `false`, wenn die Antwort nie einen
 * Body gesetzt bekam. Für eine normal ausgelieferte 200er-Seite kommt das in
 * der Praxis nicht vor, aber genau deshalb darf ein Test es nicht kommentarlos
 * annehmen: würde `false` ungeprüft weitergereicht, prüfte die nachgelagerte
 * Assertion `false` gegen einen erwarteten String-Ausschnitt — der Test schlüge
 * dann an einer zufälligen Stelle mit einer irreführenden Meldung fehl, statt
 * klar zu sagen, dass die Antwort gar keinen Body hatte. Ein nicht lesbares
 * Prüfstück ist ein Testfehler, keiner, den eine Assertion einfangen sollte.
 *
 * @param  TestResponse<Response>  $res
 */
function responseHtml(TestResponse $res): string
{
    $content = $res->getContent();

    if ($content === false) {
        throw new RuntimeException('Response::getContent() lieferte false — die Antwort hat keinen Body.');
    }

    return $content;
}

// ─── 1. Fünf Leerzustände: genau eine Handlung (oder bewusst keine) ──────────

test('Leerer Raum: genau EIN CTA, Fokus-Kaskade nach Zustand (Mitglied → Composer, angemeldet → Beitreten) — der dritte Zweig ist mit P4 entfallen, nicht gestrichen', function () {
    $res = $this->withSession(['nostr_pubkey' => fakeSessionPubkey()])
        ->get(route('group.room', ['h' => 'anyroom']))
        ->assertOk();
    $html = responseHtml($res);

    // Der Leerzustand selbst.
    expect($html)->toContain('Noch keine Nachrichten in diesem Raum.');

    // P11: `&& !gatedOut` kam dazu — wurde der Read vom Relay abgewiesen
    // (`CLOSED restricted:`), ist „Noch keine Nachrichten" die Quittung der
    // verweigerten Anfrage, keine Aussage über den Raum (p11-messung.md A3:
    // Messraum trug genau eine echte Nachricht, die Karte behauptete trotzdem
    // „Noch keine"). E2E-gedeckt in tests/e2e/onboarding.spec.ts (P11-Block).
    $block = extractBetween($html, '<template x-if="!loading && messages.length === 0 && $store.authGate?.authed && !gatedOut">', '</template>');
    expect($block)->not->toBeNull();

    // Genau EIN Bedienelement in diesem Leerzustand-Block.
    expect(substr_count($block, 'data-flux-button='))->toBe(1);
    expect($block)->toContain('(joined ? $refs.composer : $refs.joinButton)?.focus()');
    expect($block)->toContain('Schreib die erste.');

    // P4: die dritte Stufe (Gast → Gast-Composer) ist mit dem Gast-Composer
    // entfallen. Die Assertion steht auf der GANZEN Seite, nicht nur auf dem
    // Block: ein `$refs.guestComposer` irgendwo im Markup wäre nach dem Rückbau
    // ein Verweis ins Leere (`undefined?.focus()` — still, aber wirkungslos).
    expect($html)->not->toContain('$refs.guestComposer');

    // Warum an BEIDEN Karten ein `authed`-Term hängt, gemessen: die ursprüngliche
    // Annahme „ein Gast erreicht die Leerkarte gar nicht, weil `loading` für ihn nie
    // falsch wird" ist WIDERLEGT. `loading` kippt nach ~3,4 s auch für ihn — nicht
    // durch ein EOSE, sondern weil welshmans `load()` in seinen 3-s-Timeout läuft
    // und leer resolved (`@welshman/net/…/request.js:226`), während das
    // `CLOSED auth-required` den Aufrufer nie erreicht (`…/policy.js:62-67`).
    // Für einen Gast trägt `messages.length === 0` damit NULL Information: der Relay
    // hat jede Leseanfrage abgelehnt, nicht eine leere Antwort geliefert. Ohne den
    // Guard stand deshalb „Noch keine Nachrichten in diesem Raum. / Schreib die
    // erste." neben dem Mitglieder-Gate — in einem Raum MIT Nachricht. Dieselbe
    // Unwahrheit wie das entfernte „Du liest mit", nur andersherum.
    //
    // Der `authed`-Guard am Skeleton deckt das Fenster BIS zu diesem Kippen ab
    // (sonst stünde der Gast erst vor 18 Skeleton-Zeilen und dann vor einer leeren
    // Bühne). Das Verhalten hängt als Test in tests/e2e/a11y-focus-order.spec.ts und
    // tests/e2e/onboarding.spec.ts — beide warten auf den Wendepunkt, bevor sie
    // prüfen; hier steht nur das Markup.
    expect($html)->toContain('x-show="loading && messages.length === 0 && $store.authGate?.authed"');
});

test('Leere Mitgliederliste: Einladen-CTA existiert NUR unter isAdmin, sonst handlungslos', function () {
    $res = $this->withSession(['nostr_pubkey' => fakeSessionPubkey()])
        ->get(route('group.directory'))
        ->assertOk();
    $html = responseHtml($res);

    expect($html)->toContain('Noch keine Mitglieder in diesem Space.');
    $block = extractBetween($html, 'x-if="profilesReady && members.length === 0 && !gatedOut && $store.authGate?.authed"', '</template>');
    expect($block)->not->toBeNull();
    expect($block)->toContain('x-show="isAdmin"');
    expect($block)->toContain('Mitglied einladen');
    // Genau ein Trigger, kein zweiter Weg zur selben Sache.
    expect(substr_count($block, 'loadInvite()'))->toBe(1);
    expect(substr_count($block, 'data-flux-button='))->toBe(1);
});

test('Mitgliedersuche ohne Treffer: "Suche leeren" führt den Fokus per x-ref zurück ins Suchfeld', function () {
    $res = $this->withSession(['nostr_pubkey' => fakeSessionPubkey()])
        ->get(route('group.directory'))
        ->assertOk();
    $html = responseHtml($res);

    // Das Suchfeld trägt den Ref, den der Leerzustand als Rücksprungziel nutzt.
    expect($html)->toContain('x-ref="search"');
    expect($html)->toContain('Suche leeren');
    expect($html)->toContain('$refs.search?.focus()');
});

test('Spaces :530 aufgeteilt: Suche-ohne-Treffer trägt "Suche leeren", der reine Bestandsfall bewusst KEINEN Button', function () {
    $res = $this->withSession(['nostr_pubkey' => fakeSessionPubkey()])
        ->get(route('group.spaces'))
        ->assertOk();
    $html = responseHtml($res);

    // Zwei GETRENNTE, sich gegenseitig ausschließende Bedingungen (die alte,
    // ungeteilte Formulierung darf nicht wieder auftauchen).
    expect($html)->toContain("filteredOther().length === 0 && roomQuery.trim() !== ''");
    expect($html)->toContain("filteredOther().length === 0 && roomQuery.trim() === ''");

    // Suche-Zweig: CTA vorhanden, Fokus geht auf das Suchfeld zurück.
    $searchBlock = extractBetween($html, "roomQuery.trim() !== ''\">", '</template>');
    expect($searchBlock)->not->toBeNull();
    expect($searchBlock)->toContain('Kein Raum passt zu deiner Suche.');
    expect($searchBlock)->toContain('Suche leeren');
    expect($searchBlock)->toContain('data-room-search] input');
    expect(substr_count($searchBlock, 'data-flux-button='))->toBe(1);

    // Bestands-Zweig: TEXT vorhanden, aber KEIN Button — bewusst handlungslos,
    // weil direkt darunter dieselben Wege (entdecken/anlegen) stehen.
    $bestandBlock = extractBetween($html, "roomQuery.trim() === ''\">", '</template>');
    expect($bestandBlock)->not->toBeNull();
    expect($bestandBlock)->toContain('Noch keine Standard-Räume in diesem Space.');
    expect($bestandBlock)->not->toContain('data-flux-button=');
    expect($bestandBlock)->not->toContain('Suche leeren');
});

test('Space ohne Räume: "Raum anlegen" nur unter isAdmin', function () {
    $res = $this->withSession(['nostr_pubkey' => fakeSessionPubkey()])
        ->get(route('group.spaces'))
        ->assertOk();
    $html = responseHtml($res);

    expect($html)->toContain('Dieser Space hat noch keine Räume.');
    $block = extractBetween(
        $html,
        'x-if="!loading && space && space.userRooms.length === 0 && space.otherRooms.length === 0 && !gatedOut"',
        '</template>'
    );
    expect($block)->not->toBeNull();
    expect($block)->toContain('x-show="isAdmin"');
    expect($block)->toContain('Raum anlegen');
    expect($block)->toContain('openRoomCreate()');
    expect(substr_count($block, 'data-flux-button='))->toBe(1);
});

// ─── 2. Regressionsanker: gatedOut (:412 alt) bleibt UNANGETASTET ────────────

test('REGRESSION: gatedOut-Zustand bleibt handlungslos — verein-gate trägt den Weg, kein neuer Button', function () {
    $res = $this->withSession(['nostr_pubkey' => fakeSessionPubkey()])
        ->get(route('group.spaces'))
        ->assertOk();
    $html = responseHtml($res);

    // Der Block, der ANSTATT der Raumliste erscheint, wenn gatedOut wahr ist.
    // Kein Button darin — Handlungslosigkeit ist hier eine Design-Entscheidung
    // (verein-gate trägt den Weg an anderer Stelle), kein vergessener CTA.
    $block = extractBetween(
        $html,
        'x-if="!loading && space && space.userRooms.length === 0 && space.otherRooms.length === 0 && gatedOut"',
        '</template>'
    );
    expect($block)->not->toBeNull();
    expect($block)->toContain('Räume sind nur für Vereinsmitglieder sichtbar.');
    expect($block)->not->toContain('data-flux-button=');
    expect($block)->not->toContain('<button');
});

// ─── 6. ARIA-Regressionsanker (kalibriert) ───────────────────────────────────

/**
 * Extrahiert alle role=/aria-*-Attribute (roh, inkl. x-bind:/:-Varianten) aus dem
 * QUELLTEXT einer Blade-Datei — mit vorher entfernten Blade-Kommentaren
 * ({{-- … --}}), damit ein role="dialog" in einem erklärenden Kommentar nicht als
 * echter Träger mitgezählt wird. `aria-label` bewusst ausgeschlossen: das sind
 * Dutzende ÜBERSETZTE (__()) Textlabel ohne strukturelle Live-Region-Bedeutung,
 * P2 (Sprachumschaltung) verändert ihren Wortlaut routinemäßig. Was hier gezählt
 * wird, sind die strukturellen ARIA-Träger: role, aria-live, aria-busy,
 * aria-relevant, aria-modal, aria-expanded, aria-haspopup, aria-checked,
 * aria-pressed, aria-hidden.
 *
 * @return list<string> die rohen Attribut-Strings, z.B. 'role="log"'
 */
function ariaCarriersFromSource(string $path): array
{
    $src = file_get_contents($path);
    if ($src === false) {
        throw new RuntimeException("kann $path nicht lesen");
    }
    $stripped = preg_replace('/\{\{--.*?--\}\}/s', '', $src);
    preg_match_all('/(?:x-bind:)?:?(role|aria-(?!label)[a-z]+)="[^"]*"/', $stripped, $m);

    return $m[0];
}

$ariaFiles = [
    'room' => __DIR__.'/../../packages/einundzwanzig-group/resources/views/⚡room.blade.php',
    'directory' => __DIR__.'/../../packages/einundzwanzig-group/resources/views/⚡directory.blade.php',
    'spaces' => __DIR__.'/../../packages/einundzwanzig-group/resources/views/⚡spaces.blade.php',
    // Schritt 5, Plan `2026-08-24T1810-forge-navigation-buzz-vorbild.md` (P1) — VOR jeder
    // Layout-Phase (Kachelraster, Segment-Umschalter, Steckbrief-Spur, FAB, Bottom-Sheet,
    // Sticky-Tabs) angelegt, damit diese Umbauten nicht ohne strukturellen a11y-Schutz
    // laufen. `⚡forge-repo.blade.php` steht unter dem Schlüssel `forge-repo`, nicht `repo`:
    // der Name spiegelt die Datei, nicht die Route (die heißt `group.forge.repo`).
    'forge' => __DIR__.'/../../packages/einundzwanzig-group/resources/views/⚡forge.blade.php',
    'forge-repo' => __DIR__.'/../../packages/einundzwanzig-group/resources/views/⚡forge-repo.blade.php',
    // GitHub-Parität P1 (2026-08-27): die Einzelansichten eines Vorgangs. Sie
    // tragen die Schreib-Flächen, die bis hierher in den Akkordeon-Rümpfen der
    // Repo-Seite standen — von Anfang an unter a11y-Schutz, nicht erst nach
    // dem ersten Fund.
    'forge-issue' => __DIR__.'/../../packages/einundzwanzig-group/resources/views/⚡forge-issue.blade.php',
    'forge-pull' => __DIR__.'/../../packages/einundzwanzig-group/resources/views/⚡forge-pull.blade.php',
];

test('REGRESSION: role="log" aria-live="polite" aria-relevant="additions" am Chat-Verlauf bleibt exakt erhalten', function () {
    $res = $this->withSession(['nostr_pubkey' => fakeSessionPubkey()])
        ->get(route('group.room', ['h' => 'anyroom']))
        ->assertOk();

    // Der explizit hervorgehobene Hauptanker — VOR dem eingefügten Nachrichten-
    // Inhalt gesetzt (nicht nachträglich per JS), das ist der Punkt (manche
    // Screenreader ignorieren nachträglich gesetzte Live-Attribute).
    $res->assertSee('role="log" aria-live="polite" aria-relevant="additions"', false);
});

test('REGRESSION: alle strukturellen ARIA-Träger aus room/directory/spaces bleiben zahlenmäßig erhalten', function () use ($ariaFiles) {
    // Kalibrierte Zahlen (Stand 2026-08-11, festgenagelt als LITERAL, NICHT aus
    // der Quelle neu berechnet). Ein früherer Entwurf hatte hier
    // `count(ariaCarriersFromSource(...))` auf BEIDEN Seiten — das ist vakuös:
    // löscht jemand ein `aria-live`, sinken erwartete UND tatsächliche Zahl
    // gemeinsam, der Test bleibt grün (belegt vom `reviewer` 2026-08-09:
    // `aria-live="polite"` aus `⚡spaces.blade.php:230` entfernt →
    // `php artisan test tests/Feature/EmptyStatesAndA11yTest.php` blieb 10/10
    // grün). Deshalb hier hart codiert.
    //
    // 'room' 27 → 35 (Stand 2026-08-11, P6a/P6b: Commits `d636c8a` Suche und
    // `b8b53de` Anpinnen im Package-Repo). Nachvollzogen per Multiset-Diff der
    // sortierten Träger-Liste vor/nach P6 (`git show d636c8a^:…⚡room.blade.php`
    // gegen den aktuellen Stand) — der Diff enthielt AUSSCHLIESSLICH Additions
    // (`>`), keine einzige Deletion (`<`): kein einziger der 27 vorbestehenden
    // Träger ist verschwunden, es kamen exakt 8 neu dazu:
    //   +2 aria-controls="room-pin-list" / "room-search-panel"
    //   +2 aria-expanded="false" / "true"                  (Suchpanel-Toggle)
    //   +1 role="search"                                   (Such-Container)
    //   +1 role="status"                                   (Such-Status, zweiter
    //                                                        role="status" kam
    //                                                        schon vor P6 vor)
    //   +2 x-bind:aria-expanded="…roomPins.collapsed…" / "…expanded…"
    //                                                       (Pin-Leiste + Overflow)
    // 27 + 8 = 35. 'directory' und 'spaces' unverändert (P6 hat diese Dateien
    // nicht angefasst — `git log d636c8a^..HEAD -- ⚡directory.blade.php
    // ⚡spaces.blade.php` im Package-Repo ist leer).
    //
    // NEU ERMITTELN bei einer LEGITIMEN Änderung (neues role=/aria-*-Attribut
    // bewusst hinzugefügt/entfernt) — dieses Kommando aus dem Repo-Root:
    //
    //   php -r '
    //   function ariaCarriersFromSource(string $path): array {
    //       $src = file_get_contents($path);
    //       $stripped = preg_replace("/\{\{--.*?--\}\}/s", "", $src);
    //       preg_match_all("/(?:x-bind:)?:?(role|aria-(?!label)[a-z]+)=\"[^\"]*\"/", $stripped, $m);
    //       return $m[0];
    //   }
    //   foreach ([
    //       "room" => "packages/einundzwanzig-group/resources/views/⚡room.blade.php",
    //       "directory" => "packages/einundzwanzig-group/resources/views/⚡directory.blade.php",
    //       "spaces" => "packages/einundzwanzig-group/resources/views/⚡spaces.blade.php",
    //   ] as $k => $f) { echo "$k: " . count(ariaCarriersFromSource($f)) . "\n"; }
    //   '
    //
    // (identische Extraktionslogik wie `ariaCarriersFromSource()` oben — bewusst
    // dupliziert statt importiert, damit dieser Block ohne Pest-Bootstrap läuft).
    // Die neuen Zahlen hier eintragen UND im selben Commit begründen, WELCHES
    // Attribut dazukam/wegfiel — sonst ist „38 → 41" so wenig nachrechenbar wie
    // die dynamische Fassung, die das hier ersetzt.
    //
    // P4 (2026-08-15, Rückbau der Gast-Fläche): NACHGEMESSEN, Ergebnis 'room'
    // 35 → 35, also unverändert. Das ist kein Übersehen, sondern ein Ergebnis:
    // per Multiset-Diff der sortierten Träger-Listen (`git show
    // HEAD:…⚡room.blade.php` gegen den Arbeitsbaum, beide Richtungen leer) ist
    // KEIN Träger weggefallen und keiner dazugekommen. Entfernt wurden aus dieser
    // Datei nur ein `aria-label="Hinweis schließen"` (aria-label ist hier
    // ausdrücklich AUSGESCHLOSSEN, s. Doc-Block oben) und — in der gelöschten
    // Komponente `guest-composer.blade.php` — ein `<span class="sr-only">`; eine
    // sr-only-Klasse ist kein ARIA-Attribut. Die neue Fläche (`verein-gate`)
    // bringt ihre eigenen Träger (2× `aria-hidden="true"`) mit, steht aber in
    // einer Datei, die diese Liste bewusst nicht enthält.
    // P7 (2026-08-17, NIP-38-Status im Verzeichnis): NACHGEMESSEN, Ergebnis
    // 'directory' 2 → 3. Multiset-Diff (`git show 0b0f94a^:…⚡directory.blade.php`
    // gegen den Arbeitsbaum) ist einseitig: GENAU EIN `aria-hidden="true"` kam
    // dazu, keiner fiel weg. Träger ist das Status-Skelett
    // (`data-status-skeleton aria-hidden="true"`, ⚡directory.blade.php), das
    // während `statusPending` an der Stelle des NIP-38-Status steht — ein
    // Platzhalter ohne Vorlesbares, korrekt vor Screenreadern versteckt (dasselbe
    // Muster wie der aktive Balken in `rail-room-row.blade.php`). Das ist eine
    // echte, bewusste Landmarke, keine Regression — die Zahl steigt entsprechend.
    // 'room' unverändert. 'spaces' 9 → 11: derselbe Commit (0b0f94a) fügte der
    // mobilen Workspace-Raumliste zwei Statuszeilen hinzu (Nadel-/Glocke-Icon je
    // angehefteter/stummgeschalteter Zeile, `⚡spaces.blade.php` ~Z. 1053/1058),
    // beide `aria-hidden="true"` — korrekt versteckt, weil ihr Inhalt seit der
    // I18n-Korrektur (2026-08-17) im `aria-label` der Zeile steht statt in einem
    // sr-only-Geschwistertext. Multiset-Diff (`array_count_values`, pre-P7 gegen
    // HEAD) bestätigt: exakt +2 `aria-hidden="true"`, sonst keine Abweichung.
    // P3 des Restposten-Plans (2026-08-17, Forum-Modus): NACHGEMESSEN, Ergebnis
    // 'room' 35 → 40. Multiset-Diff (`array_count_values`, `git show
    // HEAD:…⚡room.blade.php` gegen den Arbeitsbaum) ist EINSEITIG — es fiel kein
    // Träger weg, es kamen genau fünf dazu, alle in der neuen Themenliste:
    //   +1 `aria-live="polite"`  — die sr-only-Ladeansage des Themen-Skeletts
    //                             („Themen werden geladen…"), dasselbe Muster wie
    //                             die Ansage über dem Verlaufs-Skelett darüber.
    //   +1 `role="list"`         — die Themenliste IST eine Liste, kein `log`:
    //                             es kommt nichts unten an, es wird gesprungen.
    //   +3 `aria-hidden="true"`  — zwei Mittelpunkte als Interpunktion zwischen
    //                             Autor · Antwortzahl · Zeit (der ganze Satz steht
    //                             im `aria-label` des Knopfes) und das Info-Icon
    //                             des Hinweises, der im Forum an der Stelle des
    //                             Composers steht.
    // Alle fünf sind bewusste Landmarken, keine Regression — die Zahl steigt
    // entsprechend. 'directory' und 'spaces' unverändert.
    // P3 des Longform-Plans (2026-08-21, Artikel-Vollansicht): NACHGEMESSEN, Ergebnis
    // 'room' 40 → 38. Es ist KEIN Träger verschwunden, sondern zwei sind UMGEZOGEN: die
    // Lightbox ist aus `⚡room.blade.php` in `components/lightbox-overlay.blade.php`
    // gewandert, weil die Artikel-Vollansicht dieselbe Fläche braucht (eine zweite Kopie
    // wäre die Art Duplikat, die genau einmal repariert wird). Multiset-Diff der
    // sortierten Träger-Listen vor/nach dem Verschieben ist EINSEITIG: es fielen genau
    // `role="dialog"` und `aria-modal="true"` weg, und genau diese beiden stehen jetzt in
    // der neuen Datei (dort nachgezählt: 2). Der Rumpf ist zeichengleich verschoben, nur
    // um eine Ebene ausgerückt.
    //
    // **Die neue Datei steht bewusst NICHT in dieser Liste.** Sie hat keine eigene Route
    // und wird von zwei Views eingebunden; ihre Träger wären in beiden Zeilen doppelt zu
    // führen. Der Riegel für sie liegt stattdessen bei ihren Zusagen selbst
    // (`packages/einundzwanzig-group/js/articleReaderMarkup.test.ts` prüft, dass beide
    // Aufrufer sie einbinden und keiner mehr eine eigene Kopie trägt) — und
    // `tests/Feature/SafeAreaGateTest.php` zeigt seit demselben Tag auf sie.
    // P5 des Longform-Plans (2026-08-21, Navigation): NACHGEMESSEN, Ergebnis
    // 'spaces' 11 → 9. Wieder KEIN verschwundener Träger, sondern zwei UMGEZOGENE: der
    // Tab „Workspaces" ist aus `⚡spaces.blade.php` nach `⚡forge.blade.php` gewandert
    // (vierter Tab), und mit ihm die beiden `aria-hidden="true"` an den Zeilen-Icons der
    // Workspace-Raumliste (Nadel für „angeheftet", durchgestrichene Glocke für „stumm").
    //
    // Multiset-Diff der sortierten Träger-Listen vor/nach dem Verschieben ist EINSEITIG:
    // es fielen genau zweimal `aria-hidden="true"` weg, NICHTS kam hinzu. Gegenprobe an
    // der Zieldatei: `grep -c 'aria-hidden="true"' ⚡forge.blade.php` liefert 6 gegen
    // vorher 4 — dieselben zwei, eine Datei weiter.
    //
    // **Die neue Ortskarten-Leiste steht bewusst NICHT in dieser Zahl.** Sie ist eine
    // Komponente (`components/ortskarten.blade.php`) und wird von drei Views eingebunden;
    // ihre Träger wären in drei Zeilen dreifach zu führen — dieselbe Begründung wie beim
    // Lightbox-Overlay aus P3. Der Riegel für sie liegt bei ihren eigenen Zusagen
    // (`tests/Feature/OrtskartenTest.php`: kein `role="tab"`, genau eine Karte mit
    // `aria-current="page"`).
    //
    // **`forge` und `forge-repo` — ERSTKALIBRIERUNG (2026-08-24, Schritt 5 des Plans
    // `2026-08-24T1810-forge-navigation-buzz-vorbild.md`, P1).** Kein Diff gegen einen
    // Vorzustand — dieser Riegel existierte für diese beiden Dateien bisher gar nicht.
    // Beide Zahlen mit demselben `php -r`-Einzeiler wie oben ermittelt (Pfade angepasst)
    // und gegen `$countInRendered` unten verifiziert (siehe die Gegenprobe-Schleife
    // direkt darunter). 'forge': 18 Träger — 15× `aria-hidden="true"` (Interpunktion in
    // der Aktivitätszeile plus dekorative Icons), 1× `:aria-busy="loading"` (Zustandszeile
    // während des Ladens), 1× `aria-live="polite"` (sr-only-Ladeansage), 1×
    // `role="status"`. 'forge-repo': 31 Träger — 9× `aria-hidden="true"`, 7× `role="alert"`
    // (Fehler-Callouts je Bereich: README, Code, Issues, Patches, PRs, Klon-Fortschritt,
    // Kommentarformular), 5× `role="status"`, 1× `aria-live="polite"`, 1×
    // `role="progressbar"` mit `aria-valuemin="0"`/`aria-valuemax="100"`/
    // `:aria-valuenow="…"` (Klon-Fortschritt), 5× `:aria-expanded="…"` (Issue-Formular,
    // Issue-/Patch-/PR-Akkordeons, Speicherauskunft-Aufklapper).
    //
    // **Diese Zahl ist zum Schreiben dieses Kommentars ausdrücklich VOR jeder
    // Layout-Phase des Plans festgehalten** (P3–P6: Kachelraster, Segment-Umschalter,
    // Steckbrief-Spur, FAB, Bottom-Sheet, Sticky-Tabs). Sie hält fest, was HEUTE da ist —
    // nicht, was der Umbau daraus machen soll. Steigt oder sinkt sie in einer späteren
    // Phase, ist das an dieser Stelle zu NACHMESSEN und zu BEGRÜNDEN (Multiset-Diff,
    // wie oben bei 'room'/'spaces' vorgemacht), nicht stillschweigend anzupassen.
    //
    // **P4 desselben Plans (2026-08-24, Steckbrief-Spur, Sticky-Reiter, Handlungsknopf):
    // NACHGEMESSEN, Ergebnis 'forge-repo' 31 → 34.** Multiset-Diff
    // (`array_count_values`, `git show HEAD:…⚡forge-repo.blade.php` gegen den
    // Arbeitsbaum) ist EINSEITIG: es fiel KEIN Träger weg — nicht einer der 31 —, es
    // kamen genau drei dazu, alle am neuen Blatt für „Neues Issue":
    //   +1 `role="dialog"`        — das Blatt IST ein Dialog; bis P4 war das
    //                               Issue-Formular ein Aufklapper in der Liste und
    //                               brauchte keine Dialogrolle.
    //   +1 `aria-modal="true"`    — es fängt den Fokus (`x-trap.noscroll`), also muss
    //                               der Rest der Seite für die Sprachausgabe
    //                               verschwinden. Ohne dieses Paar wäre die Falle für
    //                               die Tastatur da und für den Screenreader nicht.
    //   +1 `aria-haspopup="dialog"` — am Handlungsknopf, der es öffnet.
    // `:aria-expanded="…"` bleibt bei 5: der Handlungsknopf hat den Träger vom alten
    // „Neues Issue"-Knopf übernommen, es ist derselbe Zustand an einem anderen Ort.
    // Der Steckbrief-Aufklapper trägt KEIN eigenes `aria-expanded` — er ist ein echtes
    // `<details>` und bekommt es vom Browser; genau deshalb ist er eines.
    //
    // **P6 desselben Plans (2026-08-24, Aktivitätsbalken und Maintainer-Stapel):
    // NACHGEMESSEN, Ergebnis 'forge' 18 → 20.** Der Multiset-Diff (`array_count_values`,
    // `git show HEAD:…⚡forge.blade.php` gegen den Arbeitsbaum) zeigt genau EINE
    // veränderte Zeichenkette: `aria-hidden="true"` von 15 auf 17.
    //
    // **Er ist NICHT einseitig, und das gehört gesagt:** dahinter stehen drei
    // Additions und eine Deletion, die sich auf derselben Zeichenkette
    // gegenseitig verrechnen —
    //   +1 an der Balken-Schiene (Schritt 25): ein Grafikobjekt, dessen Aussage
    //      als Satz daneben steht (`sr-only`, „:count Ereignisse in den letzten
    //      30 Tagen"). Ohne `aria-hidden` läse die Sprachausgabe zweimal.
    //   +1 an der Balken-ZAHL: dieselbe Begründung — sie ist die sichtbare
    //      Fassung desselben Satzes.
    //   +1 am Maintainer-Stapel (Schritt 24): drei Avatare plus „+9" sind für
    //      die Sprachausgabe eine einzige Auskunft („3 Maintainer"), nicht vier
    //      Elemente.
    //   −1 an der alten Maintainer-ZIFFER, die der Stapel ersetzt hat.
    //
    // **Die Live-Region der neuen Ansichts-Steuerung („12 von 47",
    // `role="status" aria-live="polite"`) steht bewusst NICHT in dieser Zahl.**
    // Sie liegt in `partials/forge-ansicht.blade.php`, und Partials führt diese
    // Liste grundsätzlich nicht (dieselbe Regel wie beim Lightbox-Overlay und
    // den Ortskarten oben). Ihr Riegel ist eine Verhaltenszusage im E2E-Arm, nicht
    // diese Zählung — wer sie hier sucht, sucht am falschen Ort.
    $expected = [
        // **Themen anlegen (2026-08-27): 38 → 37.** Multiset-Diff
        // (`array_count_values`, `git show HEAD:…⚡room.blade.php` gegen den
        // Arbeitsbaum) ist EINSEITIG: eine einzige veränderte Zeichenkette,
        // `aria-hidden="true"` von 4 auf 3, **keine Addition**.
        //
        // Der eine ist das `flux:icon.information-circle` der Hinweiszeile
        // „Neue Themen werden hier noch nicht verfasst — Antworten in einem
        // Thema schon.". Die Zeile ist ersatzlos gefallen, weil ihre Aussage
        // nicht mehr gilt: Themen (kind 45001) lassen sich seit diesem Commit
        // anlegen. Ein Hinweis, der das Gegenteil des Gebauten behauptet, ist
        // schlimmer als keiner.
        //
        // **Die neue Fläche bringt sehr wohl Träger mit — sie stehen nur nicht
        // in dieser Datei**, und das ist Absicht, nicht ein Versteck:
        //   `components/forum-topic-blatt.blade.php`   role="dialog",
        //                                             aria-modal="true",
        //                                             aria-haspopup="dialog",
        //                                             ::aria-expanded
        //   `components/forum-topic-inline.blade.php`  aria-haspopup="false",
        //                                             x-bind:aria-expanded
        //   `partials/forum-topic-felder.blade.php`    role="alert",
        //                                             role="status",
        //                                             aria-live="polite"
        // Komponenten und Partials führt diese Liste grundsätzlich nicht —
        // dieselbe Regel und derselbe Grund wie beim Lightbox-Overlay, den
        // Ortskarten, der Ansichts-Steuerung und dem Status-Badge weiter unten:
        // eine Datei, die von mehreren Stellen eingebunden wird, wäre hier
        // mehrfach zu führen.
        //
        // **Der Riegel für die neue Fläche ist deshalb eine Verhaltenszusage,
        // keine Zählung** (`tests/e2e/buzz-forum.spec.ts`: ein Thema anlegen und
        // in der Liste wiederfinden, in offenem UND privatem Forum, plus die
        // Ausschließlichkeit der zwei Bauformen). Wer die Träger hier sucht,
        // sucht am falschen Ort.
        //
        // **P2 des Community-Plans (2026-09-05): 37 → 42.** Multiset-Diff
        // (`array_count_values`, `git show HEAD:…⚡room.blade.php` gegen den
        // Arbeitsbaum) ist EINSEITIG — nur Additionen, keine einzige Deletion:
        //
        //     aria-hidden="true"                        3 → 4
        //     aria-pressed="false"                      0 → 2
        //     x-bind:aria-pressed="myStatus === 'accepted' …"  0 → 1
        //     x-bind:aria-pressed="myStatus === 'declined' …"  0 → 1
        //
        // Alle fünf sitzen in der neuen NIP-52-Terminkarte. Die zwei
        // `aria-pressed`-PAARE sind der Kern: Zusagen und Absagen sind EIN
        // Umschalter mit zwei Zuständen, und ein Screenreader soll den aktuellen
        // hören und nicht nur die Hervorhebung sehen. Statisch `false` im Markup
        // plus die Bindung daneben — dieselbe Regel wie am Suchknopf im Kopf: der
        // statische Wert muss VOR dem Alpine-Boot stimmen, sonst meldet die
        // Sprachausgabe im ersten Moment einen Knopf ohne Zustand.
        //
        // Das vierte `aria-hidden` liegt auf dem „·"-Trenner zwischen Datum und
        // Ort. Dekorativ, kein Text — dieselbe Bauform wie in der Meetup-Kachel.
        //
        // **Die Terminkarte hat keine eigene Komponentendatei**, sie steht
        // vollständig in dieser View. Sie ist damit der seltene Fall, in dem
        // diese Zählung die neue Fläche wirklich VOLLSTÄNDIG erfasst — bei den
        // Themen darüber tat sie es ausdrücklich nicht.
        'room' => 42,
        'directory' => 3,
        'spaces' => 9,
        // **P1 des Gitea-Sprache-Plans (2026-08-26): 20 → 16.** Multiset-Diff
        // (`array_count_values`, `git show HEAD:…⚡forge.blade.php` gegen den
        // Arbeitsbaum) ist EINSEITIG — eine einzige veränderte Zeichenkette,
        // `aria-hidden="true"` von 17 auf 13, keine Addition.
        //
        // **P5 desselben Plans (2026-08-26): 16 → 15.** Wieder einseitig,
        // `aria-hidden="true"` von 13 auf 12, wieder keine Addition. Der eine
        // ist die handgezogene Zeitleisten-Linie
        // (`<span aria-hidden="true" class="absolute start-[0.875rem] …">`),
        // die `flux:timeline` ersetzt hat.
        //
        // **Am gerenderten Baum ist nichts verloren gegangen, und das ist
        // gemessen statt gefolgert** (`p5-aria-zeitleiste.log`, Sonde über
        // `/forge?tab=activity`): `flux:timeline.item` zeichnet Leit- und
        // Folgelinie als eigene `<div>` — 12 Stück über 6 Zeilen, davon **0 mit
        // Text und 0 mit `role`/`aria-label`**. Sie stehen also ohnehin nicht im
        // Barrierebaum; das alte `aria-hidden` versteckte etwas, das nichts zu
        // sagen hatte. Gleichzeitig bringt `flux:timeline.indicator` ein
        // EIGENES `aria-hidden="true"` mit (die Grundlinien-Attrappe,
        // `flux-pro/…/timeline/indicator.blade.php`) — gemessen **2 Träger je
        // Zeile** im gerenderten Baum.
        //
        // Damit ist es derselbe blinde Fleck wie bei `forge-status-badge` und
        // `flux:progress`: der Quelltext-Scanner sieht in keine Komponente
        // hinein. Die Zahl fällt, die Sache nicht. Der Riegel dafür ist die
        // DOM-Zusage in `forge-patches.spec.ts` („die Zeitleiste ist ein
        // Bauteil"), nicht diese Zählung.
        //
        // Die vier sind die Glyphen der Zustands-Pille in der Aktivitätsspur
        // (`exclamation-circle` / `check-circle` / `x-circle` / `pencil-square`).
        // Sie sind nicht gefallen, sondern UMGEZOGEN: dieselbe Pille steht seit
        // P1 auch in der Issue-, PR-, Patch- und Vorgangslistenzeile, und vier
        // Kopien desselben Zwanzigzeilers wären genau die Duplikat-Bauform, die
        // dieses Repo sonst einsammelt. Sie liegt jetzt in
        // `components/forge-status-badge.blade.php` — und Komponenten führt
        // diese Liste grundsätzlich nicht (dieselbe Regel wie beim
        // Lightbox-Overlay, den Ortskarten und der Ansichts-Steuerung oben).
        //
        // **Das ist ein echter Verlust an Prüfbarkeit an dieser Stelle, und er
        // steht hier statt weggerechnet zu werden** — wie beim `flux:progress`
        // weiter unten. Im GERENDERTEN Baum sind die vier `aria-hidden="true"`
        // unverändert da: `flux:icon` schreibt das Attribut selbst in jedes
        // `<svg>` (`flux/icon/*.blade.php`, jeder Variantenzweig). Deshalb steht
        // es in der Komponente auch nicht noch einmal ausgeschrieben — das ergäbe
        // dasselbe Attribut zweimal am selben Tag. Diese Zählung liest die
        // BLADE-QUELLE; was ein Vendor-Stub zur Laufzeit setzt, sieht sie per
        // Konstruktion nicht.
        'forge' => 15,
        // **34 → 39 mit P5 (2026-08-24).** Nachgerechnet, nicht nachgezogen: die
        // Schreibriegel vor Zuweisen und Freigeben bringen genau fünf Träger mit —
        // drei `::aria-disabled` (Zuweisung, Freigabe, Änderungswunsch; drei
        // verschiedene Ausdrücke, also drei verschiedene Treffer) und zwei
        // `role="status"` für die beiden „Wird gesendet …"-Anzeigen. Die zählen
        // doppelt, weil der Extraktor Vorkommen sammelt und nicht Werte.
        // `aria-disabled` statt `disabled` ist dabei die Zusage selbst: der Knopf
        // behält seinen Fokus, sonst käme eine Tastatur nie an die Begründung.
        //
        // **P6, Schritt 27 (Krümelspur): 39 → 41.** Multiset-Diff EINSEITIG —
        // keine Deletion, zwei Additions, beide in der neuen `nav` im Kopf:
        //   +1 `aria-current="page"` am letzten Krümel (dem Ort, an dem man
        //      steht — er ist bewusst kein Link).
        //   +1 `aria-hidden="true"` am Schrägstrich dazwischen: er ist
        //      Interpunktion, kein Wort, und die Sprachausgabe soll ihn nicht
        //      als „Schrägstrich" zwischen die Krümel lesen.
        //
        // **Flux-Angleich (2026-08-25): 41 → 37.** Der Nutzer hat entschieden, dass
        // dort, wo eine Flux-Komponente existiert, sie auch benutzt wird. Der
        // handgebaute Fortschrittsbalken des Klon-Downloads ist dabei
        // `flux:progress` gewichen.
        //
        // Multiset-Diff (`array_count_values`, Arbeitsbaum gegen die Fassung vor dem
        // Angleich) ist EINSEITIG — vier Deletions, KEINE Addition:
        //   −1 `role="progressbar"`
        //   −1 `aria-valuemin="0"`
        //   −1 `aria-valuemax="100"`
        //   −1 `:aria-valuenow="Math.round(klon.fortschritt.anteil * 100)"`
        //
        // **Die vier sind nicht weg, sie sind nur nicht mehr HIER zählbar.**
        // `ui-progress` setzt alle vier selbst und hält `aria-valuenow` bei jedem
        // Wert nach — nachgelesen an der Quelle, nicht angenommen:
        // `vendor/livewire/flux-pro/dist/flux.js:10623` (`role`, `aria-valuemin`)
        // und `:10639` (`aria-valuenow`, `aria-valuemax` in `updateVisual()`).
        // Diese Zählung liest die BLADE-QUELLE; was ein Vendor-Stub zur Laufzeit
        // setzt, sieht sie per Konstruktion nicht.
        //
        // **Das ist ein echter Verlust an Prüfbarkeit an dieser Stelle, und er ist
        // hier notiert statt weggerechnet.** Wer den Balken künftig anfasst, hat
        // diesen Riegel nicht mehr — die Zusage hängt ab jetzt an Flux. `aria-label`
        // stand nie in dieser Zahl (der Extraktor schließt es aus) und steht
        // unverändert an der Komponente.
        //
        // 'forge' bleibt bei 20: der Angleich hat dort drei Hauspillen auf
        // `flux:badge` gehoben und eine Metazeile von `<p>` auf `<div>` gestellt —
        // beides ohne ARIA-Träger. Multiset-Diff dieser Datei: leer in beide
        // Richtungen.
        //
        // **P1 des Gitea-Sprache-Plans (2026-08-26): 37 → 34.** Multiset-Diff
        // EINSEITIG — eine veränderte Zeichenkette, `aria-hidden="true"` von 10
        // auf 7, keine Addition.
        //
        // Die drei sind die Hüllen der grauen Statuspunkte an der Issue-, Patch-
        // und PR-Zeile (`<span aria-hidden="true" class="mt-1 flex size-4 …">`).
        // Sie sind ERSATZLOS gefallen und nicht umgezogen: der Punkt sagte
        // dasselbe wie das Zustandswort in derselben Zeile, und zwei Träger für
        // eine Aussage sind einer zu viel. Was ihn ersetzt — die Zustands-Pille —
        // ist für die Sprachausgabe NICHT versteckt; sie trägt das Wort, im
        // schmalen Bild als `sr-only`. Hier verschwindet also kein Inhalt hinter
        // einem `aria-hidden`, es verschwindet ein Duplikat.
        //
        // **P5 desselben Plans (2026-08-26): 34 → 33.** Derselbe Vorgang wie bei
        // 'forge' oben und aus derselben Ursache — Multiset-Diff EINSEITIG,
        // `aria-hidden="true"` von 7 auf 6, keine Addition. Der eine ist die
        // handgezogene Zeitleisten-Linie der Repo-Aktivität
        // (`<span aria-hidden="true" class="absolute start-[0.875rem] …">`), die
        // `flux:timeline` ersetzt hat.
        //
        // Die Begründung steht ausgeschrieben bei 'forge' und gilt hier
        // unverändert: am gerenderten Baum ist nichts verloren gegangen (die
        // Linien tragen weder Text noch `role`/`aria-label`, sie standen nie im
        // Barrierebaum), und `flux:timeline.indicator` bringt einen EIGENEN
        // Träger mit, den dieser Quelltext-Scanner nicht sehen kann. Gemessen,
        // nicht gefolgert — `p5-aria-zeitleiste.log`; der Riegel dafür ist die
        // DOM-Zusage in `forge-patches.spec.ts`.
        //
        // **Diese Zeilen stehen hier, weil eine gesenkte Erwartungszahl ohne
        // Begründung daneben nicht mehr unterscheidbar ist von einer stillen
        // Abschwächung.** Die Zahl bei 'forge' hatte den Block, diese nicht —
        // im Gate aufgefallen und nachgezogen.
        // **Anlege-Knopf in zwei Bauformen (2026-08-27): 33 → 35.** Diesmal eine
        // ADDITION, und der Multiset-Diff ist ebenfalls einseitig — nichts ist
        // weggefallen. Gemessen mit demselben Verfahren wie oben (`git show
        // HEAD:…⚡forge-repo.blade.php` gegen den Arbeitsstand,
        // `array_count_values`):
        //
        //     + x-bind:aria-disabled="canWrite() ? null : 'true'"                   0 → 1
        //     + x-bind:aria-describedby="canWrite() ? null : 'forge-schreibhinweis'" 0 → 1
        //
        // Beide sitzen am FAB. Er verschwand bis dahin ohne Schreibrecht ganz;
        // jetzt bleibt er stehen, trägt `aria-disabled` und zeigt per
        // `aria-describedby` auf den Satz, der den Grund nennt (`id=
        // "forge-schreibhinweis"` in der Issue-Liste). Das ist genau die Art
        // Träger, für die dieser Test gebaut ist — hier wächst der Barrierebaum,
        // er schrumpft nicht.
        //
        // **Die zweite Bauform steht NICHT in dieser Zahl.** Der beschriftete
        // Desktop-Knopf lebt in `partials/forge-detail-suche.blade.php`, und der
        // Scanner sieht Partials nicht — dieselbe Messlücke, die dort seit P7b
        // ausgeschrieben steht. Wer die Kalibrierung das nächste Mal anfasst,
        // zieht das Partial mit hinein; dann steigt die Zahl noch einmal.
        //
        // **35 → 38 mit P10 (2026-08-27), Fremdzuweisung.** Drei neue Träger, alle
        // in der Personenauswahl unter „Personen zuweisen":
        //
        //     + :aria-disabled="canAssignPicked(issue) ? null : 'true'"   0 → 2
        //     + aria-hidden="true"                                       6 → 7
        //
        // Die zwei `aria-disabled` sitzen an „Zuweisen" und „Zuweisung entfernen"
        // — dasselbe Haus-Muster wie am Selbstzuweisungs-Knopf darüber: inert
        // statt `disabled`, damit der Knopf den Fokus behält und eine Tastatur
        // überhaupt an die Begründung daneben kommt. Das siebte `aria-hidden`
        // liegt auf der Agenten-Marke im gewählten Chip; sie wiederholt sichtbar,
        // was der zugängliche Name des Chips ohnehin trägt.
        //
        // Auch hier wächst der Baum, er schrumpft nicht.
        //
        // **P1 des GitHub-Paritäts-Plans (2026-08-27): 38 → 21.** Multiset-Diff
        // einseitig in eine Richtung, die zum ersten Mal DELETIONEN zählt — und
        // trotzdem kein Verlust: die Akkordeon-Rümpfe der Issue- und PR-Zeilen
        // sind nach `/forge/{naddr}/issues|pulls/{id}` UMGEZOGEN (Einzelansichten
        // statt Aufklapp-Zustand). Sie nehmen ihre Träger mit — drei
        // `::aria-disabled` (Zuweisung an mich, Freigeben, Änderungen erbitten),
        // fünf `role="status"` („Wird gesendet …"), zwei `role="alert"`
        // (Schreib-Fehler, Kommentar-Fehler) und weitere — und stehen dort unter
        // den EIGENEN Schlüsseln 'forge-issue' (12) und 'forge-pull' (10).
        // Wer die Differenz nachrechnet, findet sie 1:1 in denen wieder;
        // geblieben sind die Träger der Liste (Zeilen sind Links — kein
        // `aria-expanded` je Issue/PR-Zeile mehr, nur die drei der Patches).
        //
        // **Layout-Umbau (`9fa0216`/`120634f`, 2026-08-28): 21 → 24.** Multiset-Diff
        // einseitig, wieder nur ADDITIONEN — gemessen per `ariaCarriersFromSource()`
        // direkt gegen den Arbeitsstand (`array_count_values`):
        //
        //     aria-hidden="true"   6 → 8   (+2: der „·"-Trenner im verschweißten
        //                                    Commit-Kopf UND der Skeleton-Platzhalter
        //                                    beim Laden — beide dekorativ, kein Text)
        //     role="list"          0 → 1   (+1: die Themen-Pillen der Über-Karte)
        //
        // 21 + 2 + 1 = 24, exakt der neue Gesamtwert.
        'forge-repo' => 24,
        // **Neu mit P1 (2026-08-27), von Anfang an kalibriert.** Die
        // Einzelansichten tragen: je 1 `aria-current` (Breadcrumb), je 3–4
        // `role="alert"`/`role="status"`, die `::aria-disabled` der Riegel
        // (Issue: Zuweisung/Status; PR: Review) und `aria-hidden` an
        // Interpunktion. Die Zahl ist aus der Quelle extrahiert (dasselbe
        // Verfahren wie oben), nicht geschätzt.
        'forge-issue' => 12,
        'forge-pull' => 10,
    ];

    // Gegenprobe: die LIVE-Extraktion (für den countInRendered()-Abgleich unten)
    // muss dieselben Zahlen liefern wie die harten Werte oben — weicht sie ab,
    // ist ENTWEDER die Quelle seit der letzten Kalibrierung gewachsen/geschrumpft
    // (dann diesen Test failen lassen, s.u.) ODER die Extraktion selbst kaputt.
    foreach ($expected as $key => $n) {
        expect($n)->toBeGreaterThan(0, "Kalibrierte Zahl für $key ist 0 — Tippfehler beim Eintragen?");
    }

    $room = responseHtml($this->withSession(['nostr_pubkey' => fakeSessionPubkey()])
        ->get(route('group.room', ['h' => 'anyroom']))->assertOk());
    $directory = responseHtml($this->withSession(['nostr_pubkey' => fakeSessionPubkey()])
        ->get(route('group.directory'))->assertOk());
    $spaces = responseHtml($this->withSession(['nostr_pubkey' => fakeSessionPubkey()])
        ->get(route('group.spaces'))->assertOk());

    // `forge`/`forge-repo` rendern ihre Werkbank nur MIT konfiguriertem Workspace (sonst
    // der Leerzustand aus `OrtskartenTest.php`, ohne die gezählten Träger) — Config nach
    // den drei Aufrufen oben gesetzt, damit 'room'/'directory'/'spaces' unverändert gegen
    // die Umgebung laufen, gegen die sie kalibriert wurden.
    config(['group.workspace_url' => 'wss://buzz.test/']);
    $forge = responseHtml($this->withSession(['nostr_pubkey' => fakeSessionPubkey()])
        ->get(route('group.forge'))->assertOk());
    $forgeRepo = responseHtml($this->withSession(['nostr_pubkey' => fakeSessionPubkey()])
        ->get(route('group.forge.repo', ['naddr' => 'naddr1beispiel']))->assertOk());
    $hexId = str_repeat('a', 64);
    $forgeIssue = responseHtml($this->withSession(['nostr_pubkey' => fakeSessionPubkey()])
        ->get(route('group.forge.issue', ['naddr' => 'naddr1beispiel', 'id' => $hexId]))->assertOk());
    $forgePull = responseHtml($this->withSession(['nostr_pubkey' => fakeSessionPubkey()])
        ->get(route('group.forge.pull', ['naddr' => 'naddr1beispiel', 'id' => $hexId]))->assertOk());

    $countInRendered = function (string $html, array $carriers): int {
        $n = 0;
        foreach ($carriers as $c) {
            if (str_contains($html, $c)) {
                $n++;
            }
        }

        return $n;
    };

    expect($countInRendered($room, ariaCarriersFromSource($ariaFiles['room'])))->toBe($expected['room']);
    expect($countInRendered($directory, ariaCarriersFromSource($ariaFiles['directory'])))->toBe($expected['directory']);
    expect($countInRendered($spaces, ariaCarriersFromSource($ariaFiles['spaces'])))->toBe($expected['spaces']);
    expect($countInRendered($forge, ariaCarriersFromSource($ariaFiles['forge'])))->toBe($expected['forge']);
    expect($countInRendered($forgeRepo, ariaCarriersFromSource($ariaFiles['forge-repo'])))->toBe($expected['forge-repo']);
    expect($countInRendered($forgeIssue, ariaCarriersFromSource($ariaFiles['forge-issue'])))->toBe($expected['forge-issue']);
    expect($countInRendered($forgePull, ariaCarriersFromSource($ariaFiles['forge-pull'])))->toBe($expected['forge-pull']);
});

// ─── Gast-Markup (P4, vorher P3.2/P3.3): mobile Bypass, kein Server-Login ────

/**
 * Die Aussage dieses Tests ist dieselbe geblieben — „ein Gast bekommt am Raum-Fuß
 * SEINE eigene Fläche, und die Beitreten-Karte gehört ihm nicht" —, nur die Fläche
 * ist eine andere. Bis P4 waren das Gast-Composer plus Einstiegszeile („Du liest
 * mit."); beide behaupteten ein Mitlesen, das es nicht gibt: ohne Signer kein
 * NIP-42-AUTH, ohne AUTH kein Read, der Relay schließt jeden REQ mit
 * `auth-required` (gemessen 2026-08-15 lokal UND auf beiden Prod-Relays,
 * `docs/plans/2026-08-11T1321-restposten-aus-ux-plan/p4-messung.md`).
 *
 * An ihrer Stelle steht der GAST-Zweig des verein-gate. Er sagt bewusst NICHT „du
 * bist kein Mitglied" — vom Gast wissen wir das nicht, er kann Vereinsmitglied und
 * nur nicht angemeldet sein. Das ist der Unterschied zum angemeldeten
 * Nicht-Mitglied, von dem wir es belegt wissen (13534), und deshalb prüft dieser
 * Test BEIDE Zweige: dass es zwei sind, ist die Aussage.
 */
test('Gast (Mobile-Bypass, keine Session): verein-gate mit der Mitglieder-Aussage statt Gast-Composer und Einstiegszeile', function () {
    config()->set('nativephp-internal.running', true);

    $html = responseHtml($this->get(route('group.room', ['h' => 'anyroom']))->assertOk());

    // 1) Die Einhängung am Raum-Fuß ist GAST-EXKLUSIV und `x-if` (nicht `x-show`):
    //    die Gate-Insel startet beim Mount einen eigenen Directory-Sub, der sonst
    //    bei JEDEM Raumbesuch mitliefe — auch für Mitglieder, die die Fläche nie sehen.
    expect($html)->toContain('<template x-if="! $store.authGate?.authed">');
    expect($html)->toContain('x-data="nostrVereinGate"');

    // 2) Der Gast-Zweig trägt genau das, was ohne Pubkey feststeht, und der Knopf
    //    geht über `requireAuth` — nicht über einen handgeschriebenen
    //    `open-login-sheet`-Dispatch. Daran hängt der `pendingReturn`-Rückweg
    //    (Verhalten: tests/e2e/onboarding.spec.ts).
    expect($html)->toContain('x-show="isGuest"');
    expect($html)->toContain('Anmeldung nötig');
    expect($html)->toContain('Nur für Mitglieder');
    expect($html)->toContain('Dieser Bereich ist Mitgliedern vorbehalten.');
    expect($html)->toContain('data-testid="verein-gate-anmelden"');
    expect($html)->toContain('$store.authGate.requireAuth(');

    // 3) Das angemeldete Nicht-Mitglied bekommt einen ANDEREN Satz — die belegte
    //    Aussage plus den Weg zum Vereinsbeitritt. Zwei Zweige, nicht einer.
    expect($html)->toContain('x-show="!isGuest"');
    expect($html)->toContain('Noch kein Vereinsmitglied');

    // 4) Was der Rückbau entfernt hat, ist wirklich weg — inklusive des
    //    localStorage-Schlüssels der Einstiegszeile (DoD: `e21:guest-hint` kommt
    //    im Code nicht mehr vor).
    expect($html)->not->toContain('Du liest mit. Zum Mitschreiben anmelden.');
    expect($html)->not->toContain('anmelden erforderlich');
    expect($html)->not->toContain('e21:guest-hint');

    // 5) Die Beitreten-Karte bleibt an `$store.authGate?.authed` gekoppelt (ein
    //    signerloser `join()` würde ein kind 9021 signieren wollen und im Nichts
    //    enden). Ihr Gast-Gegenstück ist jetzt das Gate — also darf der frühere
    //    zweite `x-show`-Zweig an derselben Bedingung NICHT mehr dastehen.
    expect($html)->toContain('membershipReady && !joined && $store.authGate?.authed');
    expect($html)->not->toContain('membershipReady && !joined && ! $store.authGate?.authed');

    // 6) Und kein Ladeversprechen für den Gast: der Skeleton-Block hängt seit P4
    //    zusätzlich an `authed`. (Er deckt das Fenster ab, bis `loading` kippt —
    //    gemessen ~3,5 s, s. Kaskaden-Test oben; ohne den Guard stünde der Gast
    //    solange vor 18 Skeleton-Zeilen.)
    expect($html)->toContain('x-show="loading && messages.length === 0 && $store.authGate?.authed"');
});

test('Gast im Thread: dasselbe verein-gate wie im Raum — mit threadRootId in der Bedingung', function () {
    config()->set('nativephp-internal.running', true);

    $html = responseHtml($this->get(route('group.room.thread', ['h' => 'anyroom', 'nevent' => 'nevent1qqs0dummy']))
        ->assertOk());

    // Der Thread ist ein eigener, teilbarer Landeplatz (`/rooms/{h}/thread/{nevent}`)
    // und bekommt denselben Gast-Fuß — sonst bliebe genau dort wieder eine wortlose
    // leere Fläche.
    //
    // `threadRootId` MIT in der Bedingung: das Thread-Panel hängt an einem `x-show`,
    // die Gate-Insel startet aber beim Mount einen eigenen Directory-Sub. Ohne den
    // Zusatz stünde auf JEDER Raumseite eines Gastes eine zweite, unsichtbare
    // Gate-Karte samt zweitem Sub. (Wie viele Inseln zur LAUFZEIT entstehen, misst
    // tests/e2e/onboarding.spec.ts; hier steht die Bedingung selbst.)
    expect($html)->toContain('<template x-if="threadRootId && !joined && ! $store.authGate?.authed">');

    // Genau zwei Einhängungen im Markup: Raum-Fuß und Thread-Fuß, keine dritte.
    expect(substr_count($html, 'x-data="nostrVereinGate"'))->toBe(2);

    // Beitreten-Hinweis im Thread nur für ANGEMELDETE Nicht-Mitglieder, nicht für
    // Gäste — und seit P11 nicht für Relay-Nicht-Mitglieder: deren `join()` scheitert
    // nachweislich (`restricted:`), der Knopf würde garantiert ins Leere zeigen.
    expect($html)->toContain('x-if="!joined && $store.authGate?.authed && !gatedOut"');

    // P11: das Relay-Gate hängt an derselben Stelle wie das Gast-Gate — der Thread
    // ist ein eigener teilbarer Landeplatz, auch er braucht die Aussage für den,
    // dessen Read der Relay abwies. Genau zwei Einhängungen (Raum-Fuß + Thread-Fuß).
    expect(substr_count($html, 'data-testid="room-gate-restricted"'))->toBe(2);

    // Der Thread-Composer selbst bleibt Mitgliedern vorbehalten — er ist nicht das,
    // was der Gast hier sieht.
    expect($html)->toContain('Im Thread antworten…');
    expect($html)->not->toContain('anmelden erforderlich');
});

/**
 * Sucht die erste Fundstelle von `$needle` und gibt den Text bis zum ERSTEN
 * `$end` danach zurück — für "diesen einen Block, nicht die ganze Seite"-Assertions.
 * `null`, wenn `$needle` nicht vorkommt (statt eine irreführende leere Range).
 */
function extractBetween(string $haystack, string $needle, string $end): ?string
{
    $start = strpos($haystack, $needle);
    if ($start === false) {
        return null;
    }
    $stop = strpos($haystack, $end, $start);
    if ($stop === false) {
        return null;
    }

    return substr($haystack, $start, $stop - $start);
}
