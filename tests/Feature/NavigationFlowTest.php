<?php

declare(strict_types=1);

/**
 * D5 (Navigation, Landing & globale Flows): die Blade-tragenden Teile des
 * Logout-Flows, der Bottom-Nav-Konsistenz (Brand-Header statt Zurück-Pfeil),
 * der Marken-Fehlerseiten und des OG-Share-Bilds. Verhalten deckt Playwright ab.
 */
test('Einstellungen-Tab: Abmelden ist erreichbar (Flow Settings→Logout bricht nicht)', function () {
    $res = $this->withSession(['nostr_pubkey' => str_repeat('a', 64)])->get(route('group.ich.einstellungen'))->assertOk();

    $res->assertSee('x-data="nostrAuth"', false);
    $res->assertSee('doLogout()', false);
    $res->assertSee('Abmelden');
});

test('hub surfaces carry the brand-mark header, no back arrow', function () {
    // Start, Postfach and Ich are the level BELOW the address bar — between them there is no
    // "back", there is "somewhere else". The brand mark links to Start; a back arrow would
    // claim a hierarchy that does not exist between them.
    //
    // `/bereich/*` is deliberately NOT in this list: an area sits below Start and does have
    // an UP target (see `WalletBackTest`).
    foreach (['group.start', 'group.postfach', 'group.ich'] as $name) {
        $res = $this->withSession(['nostr_pubkey' => str_repeat('a', 64)])->get(route($name))->assertOk();

        $res->assertSee('aria-label="Startseite"', false);
        $res->assertDontSee('aria-label="Zurück"', false);
    }
});

test('the avatar is the way to Ich — and a guest is not turned away there', function () {
    // Until P2 the counter-proof for the host exit (`config('group.exit')`) stood here: the
    // app ran the chat as a full-screen takeover next to its own bar, and without a visible
    // exit the user was stuck. The key is gone with Concept C — one shell in both hosts, so
    // no border to jump back across.
    //
    // What takes its place is the avatar: a corner of the frame, not a fourth nav slot. Both
    // things a server can decide are checked — that it is there, and that „Ich" answers
    // WITHOUT a session too (D4). A guest whom the avatar sends into a login redirect never
    // learned what an account gives him.
    $res = $this->withSession(['nostr_pubkey' => str_repeat('a', 64)])->get(route('group.start'))->assertOk();

    $res->assertSee('data-app-header-avatar', false);
    $res->assertSee('href="'.route('group.ich').'"', false);

    $alsGast = $this->get(route('group.ich'))->assertOk();
    $alsGast->assertSee('Noch nicht angemeldet');
    // And signing in runs through the store, not through a server redirect — otherwise the
    // app would lose its state (its login lives only in `localStorage`).
    $alsGast->assertSee('$store.authGate.requireAuth', false);
});

test('Empty-Space-Liste ist keine Sackgasse: CTA zur Startseite', function () {
    $res = $this->withSession(['nostr_pubkey' => str_repeat('a', 64)])->get(route('group.ich.einstellungen'))->assertOk();

    $res->assertSee('x-if="ready && spaces.length === 0"', false);
    $res->assertSee('Zur Startseite');
});

test('settings: a host may inject sections of its own into THIS hub', function () {
    // The line that abolishes the second settings place. The companion had its app sections
    // (region, push, portal connection, about) on a screen of its own and `settings_route`
    // pointed there — two versions of the same sections, depending on which way you took.
    // Since P2 a host hangs them into the registry with a `view:` prefix.
    //
    // Measured with a view that exists in the host (`errors.layout` renders a frame and needs
    // no variables): the case proves the MECHANISM, not the companion's sections — those live
    // in its own repository.
    config(['group.settings' => ['account', 'view:errors.layout']]);

    $res = $this->withSession(['nostr_pubkey' => str_repeat('a', 64)])->get(route('group.ich.einstellungen'))->assertOk();

    // The host view is rendered …
    $res->assertSee('id="settings-account"', false);
    // … and is NOT looked up as a package partial (`group::partials.settings.view:…` does
    // not exist; `@includeIf` would then have stayed silently empty).
    expect((string) $res->getContent())->toContain('<html');
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
    // Measured on `/start` and no longer on `/`: since P2 the root is a 302 to Start, and
    // Start is the surface that gets shared.
    $res = $this->get(route('group.start'))->assertOk();

    $res->assertSee('summary_large_image', false);
    $res->assertSee('og.png', false);
    expect(file_exists(public_path('og.png')))->toBeTrue();
});
