import { getPublicKey } from 'nostr-tools/pure'
import { decode, npubEncode } from 'nostr-tools/nip19'
import {
    PRODUKTIONS_SCHREIBER,
    TEST_SCHLUESSEL_VARIABLE,
    nsecVariablen,
    sperrMeldung,
    sperrTreffer,
    type Schreiber,
} from './schluesselSperre.ts'

/**
 * Der Wegwerf-Testschlüssel aus `.env` (`NOSTR_TEST_NSEC`). Kein realer Key —
 * dient nur den E2E-Login-Tests und ist bewusst wiederverwendbar fixiert.
 */
export function testKeys(): { sk: Uint8Array; pk: string; npub: string } {
    const nsec = process.env.NOSTR_TEST_NSEC
    if (!nsec) {
        throw new Error('NOSTR_TEST_NSEC fehlt in .env')
    }

    const decoded = decode(nsec)
    if (decoded.type !== 'nsec') {
        throw new Error('NOSTR_TEST_NSEC ist kein nsec.')
    }

    const sk = decoded.data
    const pk = getPublicKey(sk)

    return { sk, pk, npub: npubEncode(pk) }
}

/**
 * `nsec…` → Pubkey (hex), oder `null`, wenn der Wert kein lesbarer nsec ist.
 *
 * Wirft NICHT: hier werden fremde Umgebungswerte verarbeitet, und ein unlesbarer Wert in
 * `NOSTR_BOT_NSEC` darf den Riegel nicht daran hindern, die übrigen zu prüfen. Der
 * Rückgabewert enthält nie Schlüsselmaterial.
 */
const pubkeyAus = (nsec: string): string | null => {
    try {
        const decoded = decode(nsec)

        return decoded.type === 'nsec' ? getPublicKey(decoded.data) : null
    } catch {
        return null
    }
}

/**
 * Alle Schlüssel, die auf dieser Maschine auf Produktion schreiben dürfen — gewonnen aus
 * der Umgebung, nicht aufgezählt. Begründung: `support/schluesselSperre.ts`.
 */
export const gesperrteSchreiber = (env: Record<string, string | undefined> = process.env): Schreiber[] => [
    ...PRODUKTIONS_SCHREIBER,
    ...nsecVariablen(env).flatMap((name) => {
        const pk = pubkeyAus(env[name] as string)

        return pk === null ? [] : [{ pk, quelle: name }]
    }),
]

/**
 * **Der Riegel.** Bricht ab, wenn der Testschlüssel ein Produktions-Schreiber ist.
 *
 * Läuft in `global-setup.ts`, also **vor** dem ersten Browser und dem ersten Relay.
 *
 * Ausfallrichtung, Fall für Fall:
 * - Variable fehlt → kein Abbruch hier. `testKeys()` wirft dann mit der Meldung, die dem
 *   Leser tatsächlich hilft; zwei Abbrüche für dieselbe Ursache verwirren nur.
 * - Variable gesetzt, aber unlesbar → **Abbruch**. Mit einem kaputten Schlüssel kann zwar
 *   nichts signiert werden, aber der Riegel könnte dann auch nichts vergleichen, und ein
 *   Riegel, der stillschweigend nichts tut, ist der teuerste Zustand von allen.
 * - Übereinstimmung → **Abbruch** mit {@link sperrMeldung}.
 */
export function pruefeTestschluessel(env: Record<string, string | undefined> = process.env): void {
    const nsec = env[TEST_SCHLUESSEL_VARIABLE]
    if (nsec === undefined || nsec === '') {
        return
    }

    const testPk = pubkeyAus(nsec)
    if (testPk === null) {
        throw new Error(`${TEST_SCHLUESSEL_VARIABLE} ist kein lesbarer nsec — der Schlüssel-Riegel kann nicht prüfen.`)
    }

    const treffer = sperrTreffer(testPk, gesperrteSchreiber(env))
    if (treffer.length > 0) {
        throw new Error(sperrMeldung(treffer))
    }
}
