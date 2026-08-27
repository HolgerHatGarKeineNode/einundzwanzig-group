import { execFileSync } from 'node:child_process'
import type { FullConfig } from '@playwright/test'
import { ownedTeardownTargets } from './runMarkers'

/**
 * Räumt am Ende JEDES Playwright-Laufs die EIGENEN Slots vollständig ab: zooid-Prozess
 * + Datenverzeichnisse, buzz-Docker-Stack (Container + Netz + Volumes) + Compose-
 * Verzeichnis, plus alle Marker-Dateien — für beide Relay-Arme, siehe
 * {@link ownedTeardownTargets}.
 *
 * **Warum das trägt (gemessen, nicht angenommen):** Playwright ruft `globalTeardown`
 * sowohl nach normalem Ende als auch nach einem GRACEFUL Abbruch auf — ein einzelnes
 * SIGINT (Ctrl-C) lässt den laufenden Test aufräumen und `globalTeardown` läuft danach
 * zuverlässig durch (gemessen 2026-08-26: `teardown` im Log ~1,8 s nach dem Signal, in
 * drei von drei Versuchen). Was NICHT abgedeckt ist: `kill -9` (SIGKILL) oder ein
 * Rechnerabsturz — dort läuft KEIN JS-Code mehr, kein Hook kann das fangen. Für genau
 * diesen Rest-Fall existiert `reap-stale-teststacks.sh` (altersbasiert, in
 * `global-setup.ts` verdrahtet) als zweite Schicht.
 *
 * **Warum „eigene Slots" und nicht „alle verwaisten"**: das ist die Aufgabe des
 * Reapers (arbeitet über ALLE Slots, aber nur altersbasiert — ein fremder, gerade
 * laufender Slot hat einen frischen Herzschlag und bleibt unangetastet). Ein Teardown
 * am Ende DIESES Laufs kennt dagegen nur die eigene Slot-Reihe — er dürfte NIE einen
 * fremden, parallel laufenden Slot anfassen, egal wie alt dessen letzter Herzschlag
 * gerade aussieht (ein anderer Lauf könnte mitten in einem langen Test stecken, dessen
 * `workerBackend`-Fixture den Herzschlag nur beim STARTEN berührt, nicht laufend).
 *
 * **Was das ändert:** vorher lief der zooid-/buzz-Stack nach Laufende bewusst WEITER
 * (Kommentar in `zooid-testserver.sh`: „damit der nächste Lauf ihn wiederverwenden
 * kann") — genau das führte zu unsterblichen Stacks über unabhängige Läufe hinweg.
 * Die Wiederverwendung INNERHALB eines Laufs (ein von Playwright nach einem Timeout neu
 * gestarteter Worker, `RUNMARK`-Kaskadenschutz) bleibt unverändert: dieser Teardown
 * läuft erst, wenn der gesamte Lauf (alle Worker) fertig ist.
 */
export default function globalTeardown(config: FullConfig): void {
    const targets = ownedTeardownTargets({
        workers: config.workers,
        slotOffset: Number(process.env.E2E_SLOT_OFFSET ?? '0'),
    })

    for (const { mode, port } of targets) {
        try {
            execFileSync('bash', ['tests/e2e/support/teardown-stack.sh', mode, String(port)], {
                stdio: 'inherit',
            })
        } catch (err) {
            // Ein Teardown, der wirft, darf den ANDEREN Zielen nicht die Chance nehmen —
            // sonst hinterließe ein einziger fehlgeschlagener Docker-Aufruf den Rest der
            // eigenen Slots als genau den Müll, den dieser Hook beseitigen soll.
            console.error(`[global-teardown] ${mode}:${port} fehlgeschlagen: ${(err as Error).message}`)
        }
    }
    console.log(`[global-teardown] eigene Slots abgeräumt: ${targets.map((t) => `${t.mode}:${t.port}`).join(', ')}`)
}
