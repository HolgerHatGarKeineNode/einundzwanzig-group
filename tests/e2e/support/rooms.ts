/**
 * **Wegwerf-Räume abräumen — das Gegenstück zu jedem `9007` im Test.**
 *
 * Der zooid der Suite überlebt den Lauf (RUNMARK-Wiederverwendung), und der Bloat-Guard
 * setzte bis 2026-07-31 nur dann zurück, wenn `welcome` wuchs. Räume sah er nicht. Am
 * laufenden System nachgezählt: **15 Räume nach frischem Seed, gefunden 16–25 je Instanz**,
 * und ein einzelner Vollauf hinterließ **5–10** neue.
 *
 * Das kostet nicht nur Platz. Jeder Raum vergrößert die Raumliste und damit die `#h`-Filter
 * der Live-Subscriptions — auf einem Relay, das Frames deckelt (Buzz: 50 je 5 s je Pubkey),
 * verschiebt Müll damit die Messung selbst.
 *
 * Die Buzz-Specs machen es seit jeher richtig und sind der Beleg, dass es trägt: nach einem
 * vollen Buzz-Lauf stehen wieder **genau 2** Kanäle. Dieses Modul bringt dieselbe Zusage zu
 * den zooid-Specs, ohne dass jede Datei ihre eigene Buchhaltung erfindet.
 *
 * Verwendung:
 *
 * ```ts
 * const room = trackRoom(makeRoom().h)      // beim Anlegen registrieren
 * test.afterAll(() => cleanupRooms(ZOOID_WS, ADMIN))
 * ```
 *
 * **Fehler beim Abräumen sind still.** Ein Aufräumer, der wirft, überschreibt den Befund
 * des Tests mit einem Infrastruktur-Fehler — und genau das ist der Grund, warum in diesem
 * Repo schon einmal ein grüner Test als rot gemeldet wurde. Was hier scheitert, fängt beim
 * nächsten Lauf der Bloat-Guard ab; er ist die zweite Verteidigungslinie und bleibt es.
 */
import { execFileSync } from 'node:child_process'

const NAK = process.env.NAK ?? `${process.env.HOME}/go/bin/nak`

/** Angelegte Räume dieses Worker-Prozesses, in Anlege-Reihenfolge. */
const angelegt: string[] = []

/**
 * Registriert ein `h` zum späteren Abräumen und gibt es unverändert zurück — so lässt sich
 * der Aufruf direkt um ein vorhandenes `makeRoom()` legen, ohne eine Zeile umzubauen.
 */
export const trackRoom = (h: string): string => {
    angelegt.push(h)
    return h
}

/**
 * Löscht alle registrierten Räume (kind 9008) und leert die Liste.
 *
 * `sec` muss der Relay-Admin sein — nur er darf 9008. Gehört in ein `test.afterAll`:
 * einmal je Datei und Worker, nicht nach jedem Test (ein `afterEach` löschte Räume, die
 * ein noch laufender Nachbartest im selben Worker gerade liest).
 */
export const cleanupRooms = (relayWs: string, sec: string): void => {
    for (const h of angelegt.splice(0)) {
        try {
            execFileSync(NAK, ['event', '--auth', '--sec', sec, '-k', '9008', '-t', `h=${h}`, relayWs], {
                encoding: 'utf8',
                timeout: 15_000,
            })
        } catch {
            // Still: siehe Modulkopf. Der Bloat-Guard ist die zweite Verteidigungslinie.
        }
    }
}

/** Nur für Tests dieses Moduls: wie viele Räume warten aufs Abräumen? */
export const trackedRoomCount = (): number => angelegt.length
