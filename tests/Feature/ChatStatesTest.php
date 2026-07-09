<?php

declare(strict_types=1);

/**
 * D3 (Zustände & System-Konsistenz): jede Chat-Seite rendert ihre Lade-/Empty-/
 * Fehler-Zustände deklarativ im Blade (die Alpine-Zweige stehen alle im DOM).
 * Diese Tests prüfen, dass die `ready`-Guards + Skeleton/Empty/Error-Markup da
 * sind — nicht das JS-Verhalten (das deckt Playwright ab).
 */
test('Space-Seite: First-Paint-Skeleton statt nackter Fläche + echter Räume-Empty-State', function () {
    $res = $this->withSession(['nostr_pubkey' => str_repeat('a', 64)])->get(route('group.spaces'))->assertOk();

    // Skeleton solange die Space-Meta fehlt (kein x-show="space" mehr am Wrapper).
    $res->assertSee('x-show="!space && loading"', false);
    // „keine Räume" ist ein Icon-Empty-State, keine graue Textzeile mehr.
    $res->assertSee('empty-state', false);
    $res->assertSee('Dieser Space hat noch keine Räume.');
});

test('Directory: list-stagger setzt --i pro Karte + Skeleton meldet aria-busy', function () {
    $res = $this->withSession(['nostr_pubkey' => str_repeat('a', 64)])->get(route('group.directory'))->assertOk();

    $res->assertSee('list-stagger', false);
    $res->assertSee('--i:${idx}', false);
    $res->assertSee('aria-busy="true"', false);
    $res->assertSee('Mitglieder werden geladen…');
});

test('Raum: Inline-Fehler-Callout mit Retry + aria-busy am Verlauf', function () {
    $res = $this->withSession(['nostr_pubkey' => str_repeat('a', 64)])->get(route('group.room', ['h' => 'welcome']))->assertOk();

    // Persistenter Callout statt flüchtigem Toast, mit Retry-Aktion.
    $res->assertSee('x-if="error"', false);
    $res->assertSee('retry()', false);
    $res->assertSee('Erneut laden');
    // Screenreader-Signal während des ersten Ladens.
    $res->assertSee('::aria-busy="loading && messages.length === 0"', false);
    $res->assertSee('Verlauf wird geladen…');
});

test('Raum-Menü (C2): Löschen nur bei eigener, Fork off! nur bei fremder Nachricht — Web + native', function () {
    $res = $this->withSession(['nostr_pubkey' => str_repeat('a', 64)])->get(route('group.room', ['h' => 'welcome']))->assertOk();

    // Web-Popover (flux:dropdown): Löschen hinter m.mine, Fork off! hinter !m.mine.
    $res->assertSee('x-if="m.mine"', false);
    $res->assertSee('askDelete(m)', false);
    $res->assertSee('x-if="!m.mine"', false);
    $res->assertSee('askReport(m)', false);

    // Native Modal (Seam auf isMobile): dieselben Guards über menuFor.
    $res->assertSee('x-show="menuFor?.mine"', false);
    $res->assertSee('x-show="!menuFor?.mine"', false);

    // Fork-off!-Modal: Grund-Auswahl (NIP-56) + Bestätigen (Flux rendert das Modal als
    // data-modal="report-message", vgl. E2E-Selektor).
    $res->assertSee('data-modal="report-message"', false);
    $res->assertSee('x-model="reportReason"', false);
    $res->assertSee('Beleidigung');
    $res->assertSee('confirmReport()', false);
});

test('Raum-Menü (C3): Bearbeiten hinter canEdit, Zitieren immer, Compose-Kontext editing/sharing — Web + native', function () {
    $res = $this->withSession(['nostr_pubkey' => str_repeat('a', 64)])->get(route('group.room', ['h' => 'welcome']))->assertOk();

    // Web-Popover: Zitieren immer, Bearbeiten nur bei canEdit(m) (eigen & ≤5 min).
    $res->assertSee('share(m)', false);
    $res->assertSee('x-if="canEdit(m)"', false);
    $res->assertSee('startEdit(m)', false);

    // Native Modal (Seam auf isMobile): dieselben Aktionen über menuFor.
    $res->assertSee('share(menuFor)', false);
    $res->assertSee('menuFor && canEdit(menuFor)', false);
    $res->assertSee('startEdit(menuFor)', false);

    // Compose-Kontext trägt Bearbeiten (editingId) und Zitieren (sharing) und cancelEdit.
    $res->assertSee("editingId ? 'Nachricht bearbeiten'", false);
    $res->assertSee("sharing ? 'Zitieren'", false);
    $res->assertSee('cancelEdit()', false);
    // Senden bleibt bei leerem Composer aktiv, solange sharing (Quote-Only).
    $res->assertSee('draft.trim().length === 0 && !sharing', false);
});

test('Raum-Menü (C4): Mention-Popover + Kopier-/Info-Einträge + Info-Modal — Web + native', function () {
    $res = $this->withSession(['nostr_pubkey' => str_repeat('a', 64)])->get(route('group.room', ['h' => 'welcome']))->assertOk();

    // @-Mention-Autocomplete: Popover hinter mentionOpen, Auswahl ruft pickMention.
    $res->assertSee('x-if="mentionOpen"', false);
    $res->assertSee('pickMention(item)', false);
    $res->assertSee('onComposerInput($event.target)', false);

    // Web-Popover: Kopier-/Info-Einträge (nur lesen).
    $res->assertSee('copyNevent(m)', false);
    $res->assertSee('copyNpub(m)', false);
    $res->assertSee('copyJson(m)', false);
    $res->assertSee('openInfo(m)', false);

    // Native Modal (Seam auf isMobile): dieselben Aktionen über menuFor.
    $res->assertSee('copyNevent(menuFor)', false);
    $res->assertSee('openInfo(menuFor)', false);

    // Info-Modal (Flux rendert data-modal="message-info") mit Roh-Event + Relays.
    $res->assertSee('data-modal="message-info"', false);
    $res->assertSee('x-text="infoFor.nevent"', false);
    $res->assertSee('x-text="infoFor.json"', false);
    $res->assertSee('infoFor.seenOn.length', false);
});

test('Space-Einstellungen: ready-Guard verhindert Empty-Flash', function () {
    $res = $this->withSession(['nostr_pubkey' => str_repeat('a', 64)])->get(route('group.space.settings'))->assertOk();

    // Empty erst nach ready — Skeleton davor (Fix-A-Muster).
    $res->assertSee('x-if="!ready"', false);
    $res->assertSee('x-if="ready && spaces.length === 0"', false);
    $res->assertSee('Spaces werden geladen…');
});

test('Login: QR-Skeleton statt Plain-Text + Lade-Label an den Buttons', function () {
    $res = $this->get(route('group.nostr-login'))->assertOk();

    $res->assertSee('skeleton size-56', false);
    $res->assertSee('Verbinde…');
});
