import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'

/**
 * **Das Frischesignal des Vite-Builds — eine Wahrheit für alle, die es brauchen.**
 *
 * Herausgezogen aus `global-setup.ts` (das es weiterhin benutzt), damit der
 * Bundle-Riegel (`bundleGrenze.nodetest.ts`) dieselbe Frage mit derselben Antwort
 * stellen kann. Zwei Kopien dieses `find`-Ausdrucks wären zwei Kriterien für „ist der
 * Build aktuell?", und das zweite driftet garantiert.
 *
 * ── Warum CONTENT und nicht mtime (P12, 2026-08-15) ──────────────────────────────
 *
 * `mutprobe restore` spielt eine mutierte Frontend-Quelle mit `cp -p` zurück —
 * byte-gleich, aber mit der ALTEN mtime. Ein mtime-Kriterium sah danach keinen
 * Buildbedarf, und der nächste Lauf maß weiter gegen das WÄHREND DER MUTATION gebaute
 * Bundle: git sauber, Hash gleich, jede äußere Verifikation grün. Ein Content-Hash kann
 * diese Falle nicht übersehen: anderer Inhalt ⇒ anderer Hash ⇒ Rebuild.
 */

/** Pfad des Stamps, den `global-setup.ts` nach jedem Build schreibt. */
export const SOURCES_STAMP = 'public/build/.sources-stamp'

/**
 * Hash über EXAKT die Roots, die das bisherige mtime-Kriterium beobachtete (nichts
 * dazugekommen, nichts weggelassen): Determinismus über `LC_ALL=C sort`, damit kein
 * Wechsel der Shell-Locale die Reihenfolge und damit den Hash kippt.
 */
export const SOURCES_HASH_CMD =
    `find resources packages/*/resources packages/*/js package.json vite.config.* -type f 2>/dev/null ` +
    `| LC_ALL=C sort | xargs -r sha256sum | sha256sum | cut -d' ' -f1`

export function sourcesHash(cwd?: string): string {
    return execFileSync('bash', ['-c', SOURCES_HASH_CMD], cwd ? { cwd } : {})
        .toString()
        .trim()
}

/**
 * Passt das gebaute Artefakt zum aktuellen Quellstand?
 *
 * `'kein-stamp'` heißt „unbekannt" und wird vom Aufrufer wie „veraltet" behandelt —
 * die einzige Richtung, die nicht stillschweigend gegen ein altes Bundle misst.
 */
export function buildIstAktuell(wurzel: string): { aktuell: boolean; grund: string } {
    const stampPfad = `${wurzel}/${SOURCES_STAMP}`
    if (!existsSync(stampPfad)) {
        return { aktuell: false, grund: 'kein-stamp' }
    }
    const gestempelt = readFileSync(stampPfad, 'utf8').trim()
    const jetzt = sourcesHash(wurzel)

    return gestempelt === jetzt
        ? { aktuell: true, grund: 'Quell-Hash == Stamp' }
        : { aktuell: false, grund: `Quell-Hash ${jetzt.slice(0, 12)}… ≠ Stamp ${gestempelt.slice(0, 12)}…` }
}
