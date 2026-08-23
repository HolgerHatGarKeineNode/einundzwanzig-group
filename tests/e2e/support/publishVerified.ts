/**
 * **Ein Publish gilt erst als angekommen, wenn der Relay es zurückliefert — nie schon,
 * weil `nak event` sich mit Exit 0 beendet hat.**
 *
 * Fünfmal fast wortgleich in fünf Dateien kopiert (`quote-card.spec.ts`,
 * `chat-markup.spec.ts`, `search-verlauf.spec.ts`, `onboarding.spec.ts`,
 * `pin-room.spec.ts`) und dabei genau die Absicherung verloren, die das Original in
 * `updates.spec.ts:118` noch hatte (`event?.id ?? out.trim()`). Dieses Modul bündelt sie
 * an einem Ort — die Referenz ist `room.spec.ts`s `seedMessage`.
 *
 * ── Zwei Werkzeuge lügen, unabhängig voneinander ────────────────────────────────────
 *
 * 1. **`nak event` beweist nichts über die Annahme.** Es endet mit **Exit 0** und druckt
 *    das signierte Event-JSON auch bei ABLEHNUNG; die Quittung steht nur im Klartext auf
 *    **stderr** (`… success.` gegen `… failed: msg: <grund>`). `execFileSync` liefert
 *    zudem nur stdout — die Quittung käme dort nie an, deshalb `spawnSync` mit
 *    `encoding: 'utf8'` und beide Ströme zusammengefasst.
 * 2. **Eine einzelne Relay-Abfrage kann leer antworten, obwohl die Daten liegen.**
 *    Gemessen am Test-zooid (2026-08-23, Docblock von `queryRelayEvent` in
 *    `room.spec.ts`): dieselbe Abfrage lieferte in einer Schleife zwölfmal hintereinander
 *    NULL Zeilen, während unmittelbar davor und danach dieselben drei Events kamen — die
 *    AUTH-Runde wiederholter Verbindungen kommt unter Last nicht immer zum Abschluss.
 *    Eine einzelne leere Antwort ist deshalb kein Befund; hier wird auf Sichtbarkeit
 *    GEPOLLT statt einmal gefragt.
 *
 * Beide Stufen ineinander: die Ablehnung wird bis zu dreimal wiederholt (Mitgliedschaft
 * entsteht relay-seitig erst NACH dem Speichern des vorausgehenden 9021, ein sofort
 * folgendes Publish kann in „restricted: you are not a member" laufen), jede
 * angenommene Runde bekommt bis zu ~3 s, um sichtbar zu werden. Musste tatsächlich
 * nachgefasst werden, meldet eine Zeile das — sonst bliebe unsichtbar, wie oft der Relay
 * unter Last nachhinkt, und genau das ist das Problem, gegen das die Wiederholung
 * eingebaut ist.
 *
 * @param nak         Pfad zum `nak`-Binary.
 * @param eventArgs   vollständige Argumente für `nak event …`, OHNE die Relay-URL (die
 *                     hängt dieser Helfer selbst an).
 * @param relayWs     Ziel-Relay (ws://…).
 * @param finde       fragt den Relay erneut ab und liefert das gesuchte Event — oder
 *                     `undefined`. Wird bei jedem Sichtbarkeits-Versuch neu aufgerufen,
 *                     MUSS also selbst eine frische Abfrage auslösen (kein Memoisieren).
 * @param beschreibung Text für Log-/Fehlermeldungen (z. B. „Raumnachricht in welcome").
 */
import { spawnSync } from 'node:child_process'

/**
 * Synchrones Warten ohne externen Prozess (`Atomics.wait` blockiert den aufrufenden
 * Thread) — Muster aus `room.spec.ts`s `sleepSync`, hier unabhängig kopiert, damit dieses
 * Modul ohne Import aus einer Spec-Datei auskommt.
 */
function sleepSync(ms: number): void {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

export function publishVerified<T>(
    nak: string,
    eventArgs: readonly string[],
    relayWs: string,
    finde: () => T | undefined,
    beschreibung: string,
): T {
    let letzteQuittung = ''
    for (let versuch = 1; versuch <= 3; versuch++) {
        // `spawnSync`, nicht `execFileSync`: die Quittung steht auf STDERR, `execFileSync`
        // gibt nur stdout zurück.
        const lauf = spawnSync(nak, [...eventArgs, relayWs], { encoding: 'utf8' })
        letzteQuittung = `${lauf.stdout ?? ''}${lauf.stderr ?? ''}`

        if (letzteQuittung.includes('success')) {
            // Sichtbarkeit: bis zu ~3 s, in kurzen Schritten. Der Normalfall trifft beim
            // ersten Versuch — die Schleife kostet dann nichts.
            for (let sicht = 1; sicht <= 15; sicht++) {
                const treffer = finde()
                if (treffer !== undefined) {
                    // Nur wenn tatsächlich nachgefasst werden musste — sonst schweigt der
                    // Helfer (siehe Docblock oben).
                    if (versuch > 1 || sicht > 1) {
                        console.log(
                            `[publishVerified] ${beschreibung}: erst nach ${versuch} Publish- und ${sicht} Abfrage-Versuchen angekommen`,
                        )
                    }
                    return treffer
                }
                sleepSync(200)
            }
        } else {
            console.log(`[publishVerified] ${beschreibung} Versuch ${versuch} abgelehnt: ${letzteQuittung.trim().split('\n').pop() ?? ''}`)
        }
        sleepSync(300 * versuch)
    }
    throw new Error(`${beschreibung} kam nicht am Relay an — letzte Quittung: ${letzteQuittung.trim().split('\n').pop()}`)
}
