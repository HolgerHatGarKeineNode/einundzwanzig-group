/**
 * **Ein Überspringen aus UMGEBUNGSGRÜNDEN darf nicht als Erfolg durchgehen.**
 *
 * ── Der Befund, gegen den das gebaut ist (2026-08-29) ─────────────────────────────
 *
 * Neun E2E-Fälle sind mit KEINEM `test:e2e`-Aufruf erreichbar, und der Lauf endet
 * trotzdem mit **Exit 0**:
 *
 * - `workspaces.spec.ts` — acht Fälle hinter `test.skip(!buzzUp(), …)` im
 *   `describe`-Rumpf (Sammelzeit, noch vor jeder Fixture),
 * - `search-verlauf.spec.ts` — ein Fall in der Laufzeit-Form.
 *
 * Beide brauchen einen Buzz-Stack NEBEN dem zooid. Den startet kein Modus: `fixtures.ts`
 * fährt je Worker **entweder** zooid **oder** Buzz, nie beides — und genau diese Trennung
 * hat die Suite von 13–15 min auf 2 min gebracht. Im Buzz-Modus greift eine Zeile höher
 * ohnehin der `E2E_RELAY === 'buzz'`-Riegel.
 *
 * Ein Gate, das „E2E grün" prüft, kann das nicht bemerken. Gemessen: ohne Stack 8 skipped,
 * mit Stack 8 passed — beide Male Exit 0.
 *
 * ── Was dieser Helfer tut, und was ausdrücklich NICHT ────────────────────────────
 *
 * Er **behebt die Lücke nicht** — die neun Fälle laufen weiterhin nicht. Ein dritter Modus
 * (zooid + Buzz) wäre der Weg dahin, kostet aber je Worker einen zusätzlichen
 * Docker-Compose-Stack; das verlängert genau die Regelläufe, die kurz bleiben sollen.
 *
 * Er macht das Überspringen **abfragbar**: mit `E2E_STRICT_UMGEBUNG=1` wirft er, statt zu
 * überspringen. Ein Gate, das wissen will, ob die Suite gerade vollständig läuft, fährt
 * einen Lauf mit dieser Variable — im Regelbetrieb ändert sich nichts, weder am Verhalten
 * noch an der Laufzeit. Gemessen am 2026-08-29, derselbe Zustand, derselbe Zuschnitt:
 *
 *   ohne Schalter → **Exit 0**, „9 skipped, 6 passed"
 *   mit Schalter  → **Exit 1**, mit der Meldung, welche Umgebung fehlt
 *
 * **Der Schalter ist ein Diagnosewerkzeug, kein Lauf-Modus.** Bei einem `test.skip` im
 * `describe`-Rumpf fällt der Wurf in die SAMMELPHASE; Playwright bricht die Datei dann ab,
 * statt ihre Fälle einzeln zu melden. Für die Frage „läuft die Suite gerade vollständig?"
 * genügt das — für einen Regellauf ist es die falsche Betriebsart.
 *
 * Die zweite Hälfte der Zusage steht in `umgebungsSkips.nodetest.ts`: dort ist
 * inventarisiert, WELCHE Stellen so überspringen dürfen. Eine neue, undeklarierte macht
 * den Unit-Lauf rot — und der läuft in jedem Lauf, nicht nur wenn jemand daran denkt.
 */
export const STRICT_VARIABLE = 'E2E_STRICT_UMGEBUNG'

/**
 * `true`, wenn wegen fehlender Umgebung übersprungen werden soll — wirft im STRICT-Modus.
 *
 * Gedacht als Argument von `test.skip(…)`: `test.skip(umgebungFehlt(!buzzUp(), '…'), '…')`.
 * Ist die Bedingung falsch (Umgebung da), passiert nichts — auch nicht im STRICT-Modus.
 */
export function umgebungFehlt(bedingung: boolean, grund: string): boolean {
    if (!bedingung) {
        return false
    }

    if (process.env[STRICT_VARIABLE] === '1') {
        throw new Error(
            `[E2E-STRICT] Ein Fall wird aus Umgebungsgründen übersprungen, und ${STRICT_VARIABLE}=1 verbietet das: ` +
                `${grund}. Entweder die Umgebung bereitstellen oder diesen Lauf ohne ${STRICT_VARIABLE} fahren — ` +
                'ein stilles Überspringen soll nicht als grüner Lauf durchgehen.',
        )
    }

    return true
}
