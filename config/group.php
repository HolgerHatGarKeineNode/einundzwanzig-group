<?php

return [
    /*
     * P2 (App-Shell-Verschmelzung §3.1/§8.2): der Web-Host ist ein eigenständiger
     * self-host Chat+Wallet-Client — 3 Tabs, KEIN Meetups/Mehr/Portal (Umfang-
     * Callout im Plan). Diese Config überschreibt nur `nav`; alle übrigen
     * group-Keys (space_url, head_partial, exit=null …) füllt der Package-Default
     * via mergeConfigFrom. `nav` ist ein String-Key → array_merge lässt den Host
     * gewinnen (keine Listen-Konkatenation), die 3 Web-Tabs ersetzen die 3
     * package-nativen Default-Tabs sauber.
     *
     * Einstellungen zeigt seit P5 den verschmolzenen Settings-Screen
     * (group.settings, §6): Konto/Identität · Space & Räume · Wallet · Darstellung ·
     * Abmelden. gate=nostr: der Tab liegt server-seitig hinter `nostr.auth`, der
     * Tap-Intercept öffnet später (P6) das Login-Sheet statt zu navigieren.
     */
    'nav' => [
        // `match` weggelassen: nav-tab fällt via `$match ?? $route` auf die Route
        // zurück, und alle drei Web-Tabs sind Ein-Routen-Tabs (Aktiv = exakte Route).
        ['key' => 'chat', 'route' => 'group.spaces', 'icon' => 'chat-bubble-left-right', 'label' => 'Chat', 'gate' => 'nostr'],
        ['key' => 'wallet', 'route' => 'group.wallet', 'icon' => 'bolt', 'label' => 'Wallet', 'gate' => 'nostr'],
        ['key' => 'settings', 'route' => 'group.settings', 'icon' => 'cog-6-tooth', 'label' => 'Einstellungen', 'gate' => 'nostr'],
    ],
];
