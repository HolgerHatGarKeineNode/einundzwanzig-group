<?php

declare(strict_types=1);

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

// ─── 1. Fünf Leerzustände: genau eine Handlung (oder bewusst keine) ──────────

test('Leerer Raum: genau EIN CTA, Fokus-Kaskade nach Zustand (Mitglied → Composer, angemeldet → Beitreten, Gast → Gast-Composer)', function () {
    $res = $this->withSession(['nostr_pubkey' => fakeSessionPubkey()])
        ->get(route('group.room', ['h' => 'anyroom']))
        ->assertOk();
    $html = $res->getContent();

    // Der Leerzustand selbst.
    expect($html)->toContain('Noch keine Nachrichten in diesem Raum.');

    $block = extractBetween($html, '<template x-if="!loading && messages.length === 0">', '</template>');
    expect($block)->not->toBeNull();

    // Genau EIN Bedienelement in diesem Leerzustand-Block.
    expect(substr_count($block, 'data-flux-button='))->toBe(1);
    expect($block)->toContain('(joined ? $refs.composer : ($store.authGate?.authed ? $refs.joinButton : $refs.guestComposer))?.focus()');
    expect($block)->toContain('Schreib die erste.');
});

test('Leere Mitgliederliste: Einladen-CTA existiert NUR unter isAdmin, sonst handlungslos', function () {
    $res = $this->withSession(['nostr_pubkey' => fakeSessionPubkey()])
        ->get(route('group.directory'))
        ->assertOk();
    $html = $res->getContent();

    expect($html)->toContain('Noch keine Mitglieder in diesem Space.');
    $block = extractBetween($html, 'x-if="profilesReady && members.length === 0 && !gatedOut"', '</template>');
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
    $html = $res->getContent();

    // Das Suchfeld trägt den Ref, den der Leerzustand als Rücksprungziel nutzt.
    expect($html)->toContain('x-ref="search"');
    expect($html)->toContain('Suche leeren');
    expect($html)->toContain('$refs.search?.focus()');
});

test('Spaces :530 aufgeteilt: Suche-ohne-Treffer trägt "Suche leeren", der reine Bestandsfall bewusst KEINEN Button', function () {
    $res = $this->withSession(['nostr_pubkey' => fakeSessionPubkey()])
        ->get(route('group.spaces'))
        ->assertOk();
    $html = $res->getContent();

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
    $html = $res->getContent();

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
    $html = $res->getContent();

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
    // Kalibrierte Zahlen (Stand 2026-08-09, festgenagelt als LITERAL, NICHT aus
    // der Quelle neu berechnet). Ein früherer Entwurf hatte hier
    // `count(ariaCarriersFromSource(...))` auf BEIDEN Seiten — das ist vakuös:
    // löscht jemand ein `aria-live`, sinken erwartete UND tatsächliche Zahl
    // gemeinsam, der Test bleibt grün (belegt vom `reviewer` 2026-08-09:
    // `aria-live="polite"` aus `⚡spaces.blade.php:230` entfernt →
    // `php artisan test tests/Feature/EmptyStatesAndA11yTest.php` blieb 10/10
    // grün). Deshalb hier hart codiert.
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
    $expected = [
        'room' => 27,
        'directory' => 2,
        'spaces' => 9,
    ];

    // Gegenprobe: die LIVE-Extraktion (für den countInRendered()-Abgleich unten)
    // muss dieselben Zahlen liefern wie die harten Werte oben — weicht sie ab,
    // ist ENTWEDER die Quelle seit der letzten Kalibrierung gewachsen/geschrumpft
    // (dann diesen Test failen lassen, s.u.) ODER die Extraktion selbst kaputt.
    foreach ($expected as $key => $n) {
        expect($n)->toBeGreaterThan(0, "Kalibrierte Zahl für $key ist 0 — Tippfehler beim Eintragen?");
    }

    $room = $this->withSession(['nostr_pubkey' => fakeSessionPubkey()])
        ->get(route('group.room', ['h' => 'anyroom']))->assertOk()->getContent();
    $directory = $this->withSession(['nostr_pubkey' => fakeSessionPubkey()])
        ->get(route('group.directory'))->assertOk()->getContent();
    $spaces = $this->withSession(['nostr_pubkey' => fakeSessionPubkey()])
        ->get(route('group.spaces'))->assertOk()->getContent();

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
});

// ─── Gast-Markup (P3.2/P3.3): mobile Bypass, kein Server-Login ───────────────

test('Gast (Mobile-Bypass, keine Session): Gast-Composer im Raum, Einstiegszeile, konditionale Beitreten-Karte', function () {
    config()->set('nativephp-internal.running', true);

    $html = $this->get(route('group.room', ['h' => 'anyroom']))->assertOk()->getContent();

    // Gast-Composer statt echtem Composer.
    expect($html)->toContain('anmelden erforderlich');
    expect($html)->toContain('$store.authGate.requireAuth(');

    // Einstiegszeile: liest NICHT aus membershipReady, Zustand in localStorage.
    expect($html)->toContain("localStorage.getItem('e21:guest-hint')");
    expect($html)->toContain("localStorage.setItem('e21:guest-hint', 'closed')");
    expect($html)->toContain('Du liest mit. Zum Mitschreiben anmelden.');

    // Beitreten-Karte ist an $store.authGate?.authed gekoppelt (kein Signer-loser
    // join()-Versuch möglich) — beide Zweige (angemeldet/Gast) müssen im Markup stehen.
    expect($html)->toContain('membershipReady && !joined && $store.authGate?.authed');
    expect($html)->toContain('membershipReady && !joined && ! $store.authGate?.authed');
});

test('Gast im Thread: derselbe Gast-Composer wie im Raum (Thread ist ein eigener, teilbarer Landeplatz)', function () {
    config()->set('nativephp-internal.running', true);

    $html = $this->get(route('group.room.thread', ['h' => 'anyroom', 'nevent' => 'nevent1qqs0dummy']))
        ->assertOk()->getContent();

    expect($html)->toContain('Im Thread antworten…');
    expect($html)->toContain('!joined && ! $store.authGate?.authed');
    // Beitreten-Hinweis im Thread nur für ANGEMELDETE Nicht-Mitglieder, nicht für Gäste.
    expect($html)->toContain('!joined && $store.authGate?.authed');
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
