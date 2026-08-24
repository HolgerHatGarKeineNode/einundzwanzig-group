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
    $expected = [
        'room' => 38,
        'directory' => 3,
        'spaces' => 9,
        'forge' => 18,
        'forge-repo' => 34,
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
