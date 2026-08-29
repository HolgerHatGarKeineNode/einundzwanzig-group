import type { Page } from '@playwright/test'

/**
 * Wartet, bis die Wanduhr eine ganze Sekunde weitergerückt ist.
 *
 * **KEIN „warte mal kurz".** Alles am Lesestand rechnet in Unix-SEKUNDEN: das
 * Wasserzeichen (`readState.ts` — beim Boot `nowSec()`, beim Quittieren `setRead`) und das
 * `created_at` der Nachricht. Die Ungelesen-Regel ist bewusst `created_at > watermark` und
 * nicht `>=` — NIP-01-`since` ist inklusiv, sonst wäre das gerade Quittierte sofort wieder
 * ungelesen (`unread.ts`, Regel 3). **Publizieren in DERSELBEN Sekunde ergibt also völlig
 * korrekt „gelesen"** — kein Fehler des Produkts, sondern ein Test, der zu früh sendet.
 *
 * ── Zwei Auslöser, dieselbe Mechanik ──────────────────────────────────────────────
 *
 * 1. **Quittieren:** `setRead` schreibt das Wasserzeichen; die nächste Nachricht muss
 *    danach liegen. Daran ist die Gegenprobe unter voller Parallellast einmal gescheitert
 *    (gemessen: `createdAt=1784800753` gegen `watermark=1784800752` — eine Sekunde
 *    Abstand, und in einem Lauf eben null).
 * 2. **Boot:** ein frischer Account bekommt `all = nowSec()` (`readState.ts:852`,
 *    „ab jetzt zählen"). Wer direkt nach dem Login publiziert, trifft dieselbe Sekunde.
 *    **Gemessen am 2026-08-29** an `a11y-contrast.spec.ts`, beide Themes in EINEM Lauf:
 *
 *    | Theme | `created_at` | `all` | Delta | Punkt |
 *    |---|---|---|---|---|
 *    | light | 1787997217 | 1787997217 | 0 | **fehlt** |
 *    | dark | 1787997243 | 1787997242 | 1 | steht |
 *
 *    Dieselbe Codezeile, ein Lauf, zwei Ergebnisse — der Kipppunkt ist das Delta. Das war
 *    der „Ungelesen-Punkt-Flake" (3 von 5 Läufen) und er hat ausserdem die Kalibrierung
 *    eines fremden Prüfstands in derselben Datei blockiert.
 *
 * ── Warum diese Form und nicht `--ts` in der Zukunft ─────────────────────────────
 *
 * Gewartet wird auf eine **nachprüfbare Bedingung** (die Sekunde ist umgesprungen), nicht
 * auf eine geratene Dauer — und das `created_at` bleibt echt. Ein vorausdatiertes Event
 * müsste sich auf die Zukunftstoleranz des Relays verlassen und stünde in jeder
 * Sortierung falsch. Die App bleibt unangetastet. Kosten: höchstens eine Sekunde.
 *
 * Lag hier bis zum 2026-08-29 lokal in `unread-dot.spec.ts` und war dort nur gegen
 * Auslöser 1 angewandt; er gehört beiden Dateien, also hierher.
 */
export async function awaitNextSecond(page: Page): Promise<void> {
    const start = Math.floor(Date.now() / 1000)
    while (Math.floor(Date.now() / 1000) <= start) {
        await page.waitForTimeout(100)
    }
}
