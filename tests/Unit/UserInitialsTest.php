<?php

declare(strict_types=1);

use App\Models\User;

/**
 * `User::initials()` ist reine String-Logik auf `$this->name` (kein DB-Zugriff,
 * kein HTTP, kein Container) — heute durch keinen Feature-Test abgedeckt (kein
 * Blade/Livewire-Verbraucher rendert sie aktuell, siehe grep im Repo). Deckt den
 * Fall „ein Wort" (nur ein Initial) UND „mehrere Wörter" (erstes + letztes
 * Initial) ab — genau die Verzweigung, die die Methode trifft.
 */
test('initials() liefert den ersten und letzten Buchstaben bei mehrteiligem Namen', function () {
    $user = new User(['name' => 'Satoshi Nakamoto']);

    expect($user->initials())->toBe('SN');
});

test('initials() liefert nur einen Buchstaben bei einem einzelnen Namen', function () {
    $user = new User(['name' => 'Satoshi']);

    expect($user->initials())->toBe('S');
});
