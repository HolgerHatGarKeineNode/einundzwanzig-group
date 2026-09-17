<?php

return [
    /*
     * ── Since P2 the web host overrides NO nav any more ───────────────────────────
     *
     * `nav` with three tabs (Chat · Wallet · Einstellungen) stood here. The registry is
     * gone from every host with Concept C: the bottom bar has three FIXED slots
     * (Start · Search · Postfach) as markup inside the package, and what a host may still
     * redirect are the flat keys `start_route`, `me_route`, `settings_route`, `areas`. The
     * web client takes the package default for all of them: it IS the host those defaults
     * were written for.
     *
     * `areas` stays untouched as well — the "Meetups" and "Kurse" tiles therefore point at
     * `portal_url` and leave the client. On web that is exactly what is wanted (D9: P4
     * builds the readable Portal pages; management stays in the Portal for good).
     */

    /*
     * Settings-Registry des Web-Hosts (§4.1): geordnete Section-Keys, die der
     * verschmolzene Settings-Hub (`group.ich.einstellungen`) iteriert. Bewusst OHNE `wallet`
     * (the wallet is an AREA of its own with its own tile on Start, not a hub entry → no
     * duplicate way in) and WITHOUT `relays` (the read-only NIP-65 list is jargon and rarely
     * gebraucht → nur auf dem Mobile-Host für Power-User). Reihenfolge = Nutzer-
     * Mentalmodell: Identität → Space → Medien → Darstellung → Sprache → Sitzung.
     *
     * `language` steht direkt UNTER `appearance`: beide beantworten „wie sieht und
     * klingt die Oberfläche aus" — im Gegensatz zu `account`/`session`, die dem
     * Konto gehören.
     *
     * `mutes` (P6, NIP-51 kind 10000) sits between `blossom` and `appearance`: it
     * belongs to the SPACE block (what do I see of this space), not to the presentation
     * block (how does it look). It is also the only way back — a hidden person is gone
     * from the chat list, so their profile card cannot be reached from there any more.
     *
     * @var list<string>
     */
    'settings' => ['account', 'space', 'blossom', 'mutes', 'appearance', 'language', 'session'],
];
