/**
 * Welche Lauf-Marker gehören DIESEM Lauf? (N9)
 *
 * Die Lauf-Marker `/tmp/e2e-{buzz,zooid}-<port>.run` sind der Schutz davor, dass ein
 * nach einem Fehlschlag NEU gestarteter Worker seinen eigenen, noch laufenden Stack
 * abreißt (`buzz-testserver.sh:83-90`, `zooid-testserver.sh:50`). `global-setup.ts`
 * muss sie zu Lauf-Beginn löschen, sonst greift der Bloat-Guard nie wieder.
 *
 * **Bis 2026-08-18 löschte es `/tmp/e2e-buzz-*.run` — also die Marker ALLER Slots.**
 * Auf einer Maschine, auf der mehrere Läufe gleichzeitig auf verschiedenen
 * `E2E_SLOT_OFFSET` arbeiten, nimmt ein startender Lauf damit den anderen genau den
 * Schutz weg, für den der Marker existiert. Der Schaden ist nicht der Löschvorgang
 * selbst, sondern das, was der fremde Worker beim nächsten Neustart tut: er fällt auf
 * `stack_seeded_and_clean` zurück, und wenn dessen Bloat-Grenzen zu dem Zeitpunkt
 * gerissen sind, reißt er seinen eigenen, mitten im Lauf benutzten Stack ein
 * (`down -v` + ~40 s Neuaufbau, serialisiert hinter `flock /tmp/e2e-buzz-setup.lock`).
 *
 * Diese Datei ist bewusst **rein** (keine Imports, kein Dateisystem-Zugriff), damit die
 * Zuordnung „Lauf → Marker-Pfade" unter `node --test` prüfbar ist statt nur im
 * laufenden Playwright.
 */

/** Basisport des Buzz-Test-Relays (`buzz-testserver.sh:28`, `support/buzz.ts:19`). */
export const BUZZ_BASE_PORT = 3001
/** Basisport der zooid-Testinstanz (`support/zooid.ts:17`). */
export const ZOOID_BASE_PORT = 3335

export type RunMarkerScope = {
    /** `config.workers` des laufenden Playwright-Laufs (Anzahl paralleler Worker). */
    workers: number
    /** `E2E_SLOT_OFFSET` — verschiebt die gesamte Portreihe des Laufs. */
    slotOffset: number
    /** Verzeichnis der Marker. Default `/tmp` — Parameter nur für den Test. */
    dir?: string
}

/**
 * Die Slot-Nummern, die dieser Lauf belegt.
 *
 * Playwright vergibt `TEST_PARALLEL_INDEX` je Worker aus `[0, workers)` und behält den
 * Index beim Neustart eines Workers bei — die Reihe ist damit vollständig und stabil
 * (`fixtures.ts:56` bildet sie auf die Ports ab). `BUZZ_TEST_PORT` aus der Umgebung
 * spielt hier bewusst KEINE Rolle: `fixtures.ts:72` setzt die Variable für jeden Worker
 * selbst aus dem Slot, ein von außen gesetzter Wert erreicht das Serverskript nie.
 */
export function ownedSlots({ workers, slotOffset }: RunMarkerScope): number[] {
    const n = Math.max(1, Math.floor(workers))
    const off = Math.max(0, Math.floor(slotOffset))
    return Array.from({ length: n }, (_, i) => off + i)
}

/**
 * Alle Marker-Pfade, die dieser Lauf abräumen darf — beide Relay-Arme.
 *
 * Beide, obwohl ein Lauf immer nur einen Arm fährt: derselbe Slot kann aus einem
 * früheren Lauf im anderen Modus einen Marker tragen, und der gehört ebenfalls diesem
 * Slot. Was NICHT dazugehört, ist jeder Port außerhalb der eigenen Reihe.
 */
export function ownedRunMarkerPaths(scope: RunMarkerScope): string[] {
    const dir = scope.dir ?? '/tmp'
    return ownedSlots(scope).flatMap((slot) => [
        `${dir}/e2e-buzz-${BUZZ_BASE_PORT + slot}.run`,
        `${dir}/e2e-zooid-${ZOOID_BASE_PORT + slot}.run`,
    ])
}

/** Gehört dieser Marker-Pfad dem Lauf? Die Umkehrung von {@link ownedRunMarkerPaths}. */
export function ownsRunMarker(scope: RunMarkerScope, path: string): boolean {
    return ownedRunMarkerPaths(scope).includes(path)
}

/** Ein Teardown-Ziel: ein Relay-Arm auf einem konkreten Port. */
export type TeardownTarget = { mode: 'zooid' | 'buzz'; port: number }

/**
 * Alle Stacks, die DIESER Lauf am Ende abräumen darf — dieselbe Slot-Menge wie
 * {@link ownedRunMarkerPaths}, nur als (Modus, Port)-Paare statt Dateipfade, für
 * `global-teardown.ts` (das `teardown-stack.sh` je Ziel aufruft statt nur Marker zu
 * löschen). Beide Arme je Slot, aus demselben Grund wie dort: ein Slot kann aus einem
 * früheren Lauf im jeweils ANDEREN Modus noch Reste tragen.
 */
export function ownedTeardownTargets(scope: RunMarkerScope): TeardownTarget[] {
    return ownedSlots(scope).flatMap((slot) => [
        { mode: 'buzz' as const, port: BUZZ_BASE_PORT + slot },
        { mode: 'zooid' as const, port: ZOOID_BASE_PORT + slot },
    ])
}
