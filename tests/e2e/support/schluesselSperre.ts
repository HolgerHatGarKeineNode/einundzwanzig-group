/**
 * **Der Schlüssel, nicht nur die Adresse.**
 *
 * Alle bisherigen Riegel der Suite hängen am **Weg**: die Server-ENV zeigt auf einen
 * lokalen Relay, der Browser darf keine fremde Herkunft auflösen, der Wächter urteilt
 * über gesehene Sockets. Jeder davon ist umgehbar — durch eine Fläche, die ihre URL
 * woanders herholt, durch einen Prozess, den kein Flag erreicht, durch einen Spawn ohne
 * env-Option. Und alle drei sind in diesem Vorhaben mindestens einmal ausgefallen.
 *
 * Dieser Riegel hängt an etwas anderem: **an der Identität, mit der geschrieben wird.**
 * Ein Nostr-Ereignis, das mit einem Wegwerf-Schlüssel signiert ist, richtet auf dem
 * Produktions-Relay auch dann keinen Schaden an, wenn es ihn erreicht — der Relay verlangt
 * NIP-05-Verifikation und lehnt ab. Umgekehrt gilt: liegt in einer der Test-Identitäten
 * ein Schlüssel, der auf Produktion schreiben DARF, ist jede andere Absicherung nur noch
 * eine Frage der Zeit. Genau dieser Fall ist absehbar — im Plan steht er wörtlich: „Die
 * vierte Schicht fällt in dem Moment weg, in dem für einen P7-Test ein verifizierter
 * Schlüssel in die `.env` gelegt wird."
 *
 * **Jede Test-Identität wird geprüft, nicht nur die erste.** Bis 2026-09-03 prüfte
 * dieser Riegel ausschließlich `NOSTR_TEST_NSEC`. Mit `testKeys2()`/`NOSTR_TEST2_NSEC`
 * (`keys.ts`, P1) kam eine zweite hinzu — ein Produktionsschlüssel, der versehentlich
 * DIREKT in `NOSTR_TEST2_NSEC` landet, während `NOSTR_TEST_NSEC` ein harmloser
 * Wegwerf-Wert bleibt, wäre von der Ein-Variablen-Prüfung nie gesehen worden. Der Riegel
 * iteriert deshalb über {@link TEST_SCHLUESSEL_VARIABLEN}, nicht mehr über eine
 * einzelne Konstante — jede künftige Test-Identität gehört in diese Liste.
 *
 * Deshalb bricht dieser Riegel den Lauf **vor dem ersten Browser** ab (`global-setup.ts`),
 * unabhängig von jedem Netzpfad.
 *
 * ── Woher die Liste kommt, und warum sie nicht von Hand geführt wird ────────────────
 *
 * Ein produktionsfähiger Schlüssel ist auf dieser Maschine an genau einer Form erkennbar:
 * er steht als `*_NSEC` in der Umgebung und ist **nicht** der Testschlüssel. Der
 * einschlägige Fall ist `NOSTR_BOT_NSEC` — der Schlüssel, mit dem `bot:announce` in die
 * Produktions-Räume schreibt (`app/Console/Commands/BotAnnounce.php`). Die Liste wird
 * deshalb aus der Umgebung **gewonnen** und nicht aufgezählt: eine Handliste wäre
 * dieselbe ungeführte Liste, an der die ENV-Riegel in P0 und P5 gescheitert sind.
 *
 * {@link PRODUKTIONS_SCHREIBER} ergänzt das um Schlüssel, die auf diesem Rechner gar nicht
 * liegen. Die Liste ist heute **leer**, und das ist eine Aussage, keine Auslassung: im
 * Repo steht kein verifizierter Produktions-Pubkey, und einen zu erfinden wäre schlimmer
 * als keiner. Wer einen kennt, trägt ihn dort ein.
 *
 * ── Wie weit dieser Riegel trägt, und wo er aufhört ─────────────────────────────────
 *
 * Der Plan nannte ihn „der einzige, der auch dann noch trägt, wenn Prävention und Wächter
 * beide umgangen wurden". **Das ist zu weit gefasst, und die Grenze gehört hierher.** Er
 * hängt an der **Identität** des Schlüssels statt an einem Netzpfad — insofern stimmt es.
 * Aber seine **Vergleichsmenge** hängt weiter an der Umgebung:
 *
 *  · Ein Produktionsschlüssel, der **auch in dieser Umgebung** liegt (der dominante
 *    Unfall — jemand kopiert `NOSTR_BOT_NSEC` ins `NOSTR_TEST_NSEC`): **Abbruch**,
 *    gemessen, ebenso für eine erst künftig hinzukommende `*_NSEC`-Variable.
 *  · Ein anderswo gehaltener Produktionsschlüssel, den jemand ins `NOSTR_TEST_NSEC`
 *    einträgt: **läuft durch**, Sperrliste 0, kein Abbruch — es sei denn, sein Pubkey
 *    steht in {@link PRODUKTIONS_SCHREIBER}, und die ist leer.
 *
 * Beides ist gemessen, nicht hergeleitet. Die leere Liste zu füllen ist die einzige
 * Abhilfe für den zweiten Fall; sie mit einem geratenen Wert zu füllen, wäre keine.
 *
 * ── Umgang mit Schlüsselmaterial ────────────────────────────────────────────────────
 *
 * Kein Rückgabewert und keine Meldung dieses Moduls enthält je ein `nsec`. Gemeldet wird
 * der **Name der Variablen** und ein gekürzter Pubkey — ein Pubkey ist öffentlich, ein
 * nsec ist es nicht, und ein Secret, das durch ein Transkript läuft, gilt als
 * kompromittiert.
 */

/** Die Variable, die den primären Wegwerf-Testschlüssel trägt. */
export const TEST_SCHLUESSEL_VARIABLE = 'NOSTR_TEST_NSEC'

/**
 * ALLE Variablen, die eine eigene Test-Identität tragen — jede von ihnen wird vom Riegel
 * geprüft, nicht nur {@link TEST_SCHLUESSEL_VARIABLE}. `NOSTR_TEST2_NSEC` ist die zweite
 * zooid-Identität aus P1 (`keys.ts` `testKeys2()`), gebraucht für Präsenz/DMs, wo eine
 * Messung zwei echte Pubkeys braucht statt zwei Tabs auf demselben Schlüssel. Eine
 * künftige dritte Identität gehört hier ergänzt, nicht daneben verdrahtet.
 */
export const TEST_SCHLUESSEL_VARIABLEN: readonly string[] = [TEST_SCHLUESSEL_VARIABLE, 'NOSTR_TEST2_NSEC']

/** Ein Schlüssel, der auf Produktion schreiben darf — mit der Herkunft dieser Aussage. */
export type Schreiber = { pk: string; quelle: string }

/**
 * Produktions-Schreiber, die NICHT als Umgebungsvariable auf dieser Maschine liegen.
 *
 * **Heute bewusst leer.** Im Repo ist kein verifizierter Produktions-Pubkey hinterlegt
 * (gemessen: alle `npub1…`-Vorkommen sind Test- und Dokumentationswerte), und ein
 * geratener Eintrag wäre ein Riegel, der nichts riegelt, aber Vertrauen erzeugt. Die
 * Mechanik ist trotzdem geprüft (`schluesselSperre.nodetest.ts` fährt sie mit einer
 * literalen Beispielliste), damit ein Eintrag hier sofort greift.
 *
 * Form: 64 Zeichen hex, kleingeschrieben — dasselbe Format, das `getPublicKey` liefert.
 */
export const PRODUKTIONS_SCHREIBER: readonly Schreiber[] = []

/**
 * Alle `*_NSEC`-Variablen der Umgebung außer der geprüften Test-Identität selbst —
 * sortiert, damit die Meldung reproduzierbar ist.
 *
 * Bewusst über das **Namensmuster** und nicht über eine Aufzählung: ein künftiger
 * `NOSTR_ANNOUNCE_NSEC` ist damit vom ersten Tag an erfasst. Leere Werte fallen raus —
 * eine gesetzte, aber leere Variable ist kein Schlüssel.
 *
 * `ausgenommen` ist standardmäßig {@link TEST_SCHLUESSEL_VARIABLE} — das erhält das
 * Verhalten für jeden bestehenden Aufrufer ohne zweites Argument. Wer eine ANDERE
 * Test-Identität prüft (z. B. `NOSTR_TEST2_NSEC`), gibt deren eigenen Variablennamen mit:
 * sie darf sich nicht selbst als Vergleichsgegner sehen, alle übrigen `*_NSEC`-Variablen
 * — inklusive der jeweils ANDEREN Test-Identität — bleiben Vergleichsgegner.
 */
export const nsecVariablen = (
    env: Record<string, string | undefined>,
    ausgenommen: string = TEST_SCHLUESSEL_VARIABLE,
): string[] =>
    Object.keys(env)
        .filter((name) => /_NSEC$/.test(name) && name !== ausgenommen && (env[name] ?? '') !== '')
        .sort()

/**
 * Steht dieser Pubkey auf der Sperrliste? Gibt die passenden Einträge zurück (mehrere
 * sind möglich: derselbe Schlüssel kann unter zwei Variablen liegen).
 *
 * Vergleich case-insensitiv über den Hex-String; `getPublicKey` liefert zwar
 * kleingeschrieben, aber ein von Hand eingetragener Wert in {@link PRODUKTIONS_SCHREIBER}
 * muss nicht dieser Konvention folgen, und ein Riegel, der an Groß-/Kleinschreibung
 * vorbeigreift, wäre still wirkungslos.
 */
export const sperrTreffer = (testPk: string, gesperrt: readonly Schreiber[]): Schreiber[] =>
    gesperrt.filter((eintrag) => eintrag.pk.toLowerCase() === testPk.toLowerCase())

/** Ein Pubkey, gekürzt für Meldungen. Öffentlich, aber niemand braucht 64 Zeichen. */
export const kurz = (pk: string): string => `${pk.slice(0, 12)}…`

/**
 * Die Abbruchmeldung. Sie muss zwei Dinge leisten: sagen, WAS zu tun ist, und keinen
 * Zweifel lassen, dass der Lauf nicht einfach „wiederholt" werden kann.
 *
 * `variable` ist die Test-Identität, DEREN Wert getroffen hat — Default
 * {@link TEST_SCHLUESSEL_VARIABLE} für bestehende Aufrufer. Seit der Riegel mehrere
 * Identitäten prüft, muss die Meldung die tatsächlich betroffene nennen: eine Meldung,
 * die immer `NOSTR_TEST_NSEC` sagt, wäre bei einem Treffer in `NOSTR_TEST2_NSEC` falsch.
 */
export const sperrMeldung = (treffer: readonly Schreiber[], variable: string = TEST_SCHLUESSEL_VARIABLE): string =>
    [
        `${variable} trägt einen Schlüssel, der auf PRODUKTION schreiben darf.`,
        ``,
        `  Übereinstimmung mit: ${treffer.map((t) => `${t.quelle} (${kurz(t.pk)})`).join(', ')}`,
        ``,
        `  Der Lauf ist abgebrochen, bevor ein Browser oder ein Relay gestartet wurde. Ein E2E-Lauf`,
        `  publiziert signierte Nostr-Ereignisse; mit diesem Schlüssel wären sie auf dem`,
        `  Produktions-Relay gültig — und dort ist „veröffentlicht" unwiderruflich.`,
        ``,
        `  Richtig ist ein WEGWERF-Schlüssel, der nirgends NIP-05-verifiziert ist.`,
        `  Begründung und Herkunft der Sperrliste: tests/e2e/support/schluesselSperre.ts`,
    ].join('\n')
