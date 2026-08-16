<?php

/**
 * Gate gegen den stillen Rückbau der Systemleisten-Abstände.
 *
 * ── Was dieses Gate NICHT leistet ─────────────────────────────────────────────────────
 * **Es bewacht die Regel, nicht die Wirkung.** Es sagt NICHTS darüber, ob der
 * Schließen-Knopf der Lightbox auf einem echten Telefon zu treffen ist — und genau das
 * war die Meldung des Nutzers (2026-08-16: „überdeckt sich mit der Akkuanzeige"). Wer
 * dieses Gate grün sieht, weiß nur, dass die CSS-Regel noch da steht; ob die Aussparung
 * am Ende richtig gerechnet wird, ob der Knopf groß genug ist und ob er im Querformat
 * noch sitzt, ist damit ungeprüft. Wer hier etwas ändert, prüft es am Gerät.
 *
 * ── Warum es trotzdem existiert ───────────────────────────────────────────────────────
 * `env(safe-area-inset-*)` ist im Desktop-Chromium 0, und `max(0, 1rem)` ergibt exakt
 * denselben Abstand wie ein blankes `top-4`. Ein E2E-Test könnte den Unterschied deshalb
 * gar nicht sehen: er bliebe auch dann grün, wenn jemand die Regel durch `top-4` ersetzt
 * (am 2026-08-16 als Grund gegen einen Browser-Test festgehalten). Playwright kann die
 * Aussparung nicht setzen — es gibt keine CDP-Fläche für `env()`-Werte. Bleibt die
 * Quelle als Prüfgegenstand: ein Rückbau fällt hier auf, eine falsche Wirkung nicht.
 *
 * Als Pest-Test und nicht als node-Test, weil `deploy.sh` nur `php artisan test` fährt —
 * so läuft das Gate vor jedem Deploy mit.
 *
 * ── Zuschnitt: alle vier Kanten, nicht nur die Lightbox ───────────────────────────────
 * Die Liste ist vollständig und klein (drei Stellen in zwei Dateien, per
 * `grep -rn safe-area-inset resources/views/` erhoben) — ein Gate über alle kostet nichts
 * mehr als eines über die zuletzt geänderte, und die anderen tragen dieselbe Regel bisher
 * ungeprüft. Kommt eine Kante dazu, gehört sie in diese Liste; die Zählung unten fällt
 * sonst auf.
 */
$views = dirname(__DIR__, 2).'/packages/einundzwanzig-group/resources/views';

/**
 * Je Eintrag: Datei, die erwartete Utility im Wortlaut und wofür sie steht.
 * Der Wortlaut IST die Prüfung — `top-4` statt `top-[max(env(…),1rem)]` lässt ihn
 * verschwinden, und genau das soll auffallen.
 */
$kanten = [
    ['components/app-shell.blade.php', 'pt-[max(env(safe-area-inset-top),1.5rem)]', 'Bühne: Inhalt startet unter der Statusleiste'],
    ['⚡room.blade.php', 'pt-[max(env(safe-area-inset-top),1rem)]', 'Raum-Container: Kopf unter der Statusleiste'],
    ['⚡room.blade.php', 'top-[max(env(safe-area-inset-top),1rem)]', 'Lightbox-✕: der einzige Ausgang, nicht unter der Uhr'],
    ['⚡room.blade.php', 'right-[max(env(safe-area-inset-right),1rem)]', 'Lightbox-✕: im Querformat liegt die Aussparung seitlich'],
];

test('jede Systemleisten-Kante rechnet die Aussparung ein', function () use ($views, $kanten) {
    foreach ($kanten as [$datei, $utility, $zweck]) {
        $pfad = $views.'/'.$datei;
        expect(file_exists($pfad))->toBeTrue("Datei fehlt: {$datei}");
        // `str_contains(…)` + `toBeTrue($meldung)` statt `toContain($utility, $meldung)`:
        // Pests `toContain` nimmt KEIN Message-Argument, es läse den zweiten Parameter als
        // weiteren Suchbegriff — die Meldung wäre dann selbst die fehlschlagende Prüfung.
        expect(str_contains((string) file_get_contents($pfad), $utility))
            ->toBeTrue("{$datei} — {$zweck}: `{$utility}` fehlt. Ein blankes `top-4`/`pt-6` sieht auf dem Desktop identisch aus und schiebt den Träger auf dem Telefon unter die Systemleiste.");
    }
});

/**
 * Die Gegenrichtung: das Gate oben findet einen Rückbau nur dort, wo es hinschaut. Diese
 * Zählung fällt auch dann auf, wenn jemand eine Kante ERGÄNZT (dann gehört sie in die
 * Liste) oder eine ganz andere still entfernt.
 */
test('die Liste der Systemleisten-Kanten ist vollständig', function () use ($views, $kanten) {
    $gefunden = [];
    $iter = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($views));
    foreach ($iter as $datei) {
        if (! $datei->isFile() || ! str_ends_with($datei->getFilename(), '.blade.php')) {
            continue;
        }
        $treffer = preg_match_all('/(?:p[tblr]|top|right|bottom|left)-\[max\(env\(safe-area-inset-[a-z]+\)[^\]]*\]/', (string) file_get_contents($datei->getPathname()));
        if ($treffer > 0) {
            $gefunden[] = $treffer;
        }
    }
    expect(array_sum($gefunden))
        ->toBe(count($kanten) + 1, 'Die Zahl der Systemleisten-Kanten hat sich geändert. Eine neue gehört in die Liste oben (mit Zweck), eine entfernte braucht eine Begründung. (+1: `⚡room.blade.php` trägt am selben Element zusätzlich `pb-[max(env(safe-area-inset-bottom),…)]` — die untere Kante des Raum-Containers, die keine eigene Zeile in der Liste hat.)');
});
