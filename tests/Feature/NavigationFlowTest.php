<?php

declare(strict_types=1);

/**
 * D5 (Navigation, Landing & globale Flows): die Blade-tragenden Teile des
 * Logout-Flows, der Bottom-Nav-Konsistenz (Brand-Header statt Zurück-Pfeil),
 * der Marken-Fehlerseiten und des OG-Share-Bilds. Verhalten deckt Playwright ab.
 */
test('Einstellungen-Tab: Abmelden ist erreichbar (Flow Settings→Logout bricht nicht)', function () {
    $res = $this->withSession(['nostr_pubkey' => str_repeat('a', 64)])->get(route('group.space.settings'))->assertOk();

    $res->assertSee('x-data="nostrAuth"', false);
    $res->assertSee('doLogout()', false);
    $res->assertSee('Abmelden');
});

test('Bottom-Nav-Tabs tragen den Brand-Mark-Header, keinen Zurück-Pfeil', function () {
    foreach (['group.directory', 'group.space.settings'] as $name) {
        $res = $this->withSession(['nostr_pubkey' => str_repeat('a', 64)])->get(route($name))->assertOk();

        // Brand-Mark verlinkt zur Startseite …
        $res->assertSee('aria-label="Startseite"', false);
        // … statt eines Zurück-Pfeils zwischen gleichrangigen Tabs.
        $res->assertDontSee('aria-label="Zurück"', false);
    }
});

test('Native-Host (config group.exit): Vollbild-Chat zeigt sichtbaren Rücksprung statt Brand-Mark', function () {
    // Host (z.B. Mobile-App) reicht eine Rücksprung-Route + Label — der Chat ist
    // ein Vollbild-Takeover, ohne Ausgang säße der Nutzer fest. 'home' als
    // Test-Ziel (im Web-Repo existent; die Mobile-App setzt 'meetups').
    config(['group.exit' => ['route' => 'home', 'label' => 'Meetups']]);

    $res = $this->withSession(['nostr_pubkey' => str_repeat('a', 64)])->get(route('group.spaces'))->assertOk();

    // Sichtbarer „‹ Meetups"-Ausgang, der DIREKT zur Host-Route springt …
    $res->assertSee('Meetups');
    $res->assertSee('aria-label="Zurück zu Meetups"', false);
    $res->assertSee('href="'.route('home').'"', false);
    // … statt des (für einen App-Tab sinnlosen) Brand-Marks.
    $res->assertDontSee('aria-label="Startseite"', false);
});

test('Empty-Space-Liste ist keine Sackgasse: CTA zur Startseite', function () {
    $res = $this->withSession(['nostr_pubkey' => str_repeat('a', 64)])->get(route('group.space.settings'))->assertOk();

    $res->assertSee('x-if="ready && spaces.length === 0"', false);
    $res->assertSee('Zur Startseite');
});

test('Marken-Fehlerseiten rendern im Dark-tauglichen Layout mit Rückweg', function () {
    // 404 kommt über eine unbekannte Route (rendert die errors.404-View).
    $this->get('/gibt-es-nicht-'.uniqid())
        ->assertNotFound()
        ->assertSee('Seite nicht gefunden')
        ->assertSee('Zurück zur Startseite');

    // 500/503 direkt gerendert (kein einfacher Auslöser im Test).
    expect(view('errors.500')->render())->toContain('Etwas ist schiefgelaufen');
    expect(view('errors.503')->render())->toContain('Kurz nicht erreichbar');

    // Alle Fehlerseiten tragen den Brand-Mark + Startseiten-Rückweg.
    expect(view('errors.404')->render())
        ->toContain('aria-label="Startseite"')
        ->toContain(route('home'));
});

test('OG-Share-Bild: große Preview-Karte statt Mini-Icon', function () {
    $res = $this->get(route('home'))->assertOk();

    $res->assertSee('summary_large_image', false);
    $res->assertSee('og.png', false);
    expect(file_exists(public_path('og.png')))->toBeTrue();
});
