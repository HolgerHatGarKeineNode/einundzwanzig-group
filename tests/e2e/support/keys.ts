import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { decode, npubEncode, nsecEncode } from 'nostr-tools/nip19'
import {
    PRODUKTIONS_SCHREIBER,
    TEST_SCHLUESSEL_VARIABLE,
    TEST_SCHLUESSEL_VARIABLEN,
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
 * A second, independent zooid test identity — same shape as {@link testKeys}, read from
 * `NOSTR_TEST2_NSEC` in `.env`.
 *
 * Needed wherever a test measures something ABOUT one pubkey FROM another — presence,
 * a DM between two people. Two browser tabs on {@link testKeys} would only ever observe
 * that one identity's relationship to itself, which is not a measurement of the surface
 * at all.
 *
 * Naming note: the variable name must END in `_NSEC` (not `_NSEC2`/`_NSEC_2`) — the
 * production-writer sweep in `gesperrteSchreiber()` matches on `/_NSEC$/`
 * (`schluesselSperre.ts`), so a suffixed name would silently fall outside that guard.
 * Verified below (`keys.nodetest.ts`), not assumed.
 */
export function testKeys2(): { sk: Uint8Array; pk: string; npub: string } {
    const nsec = process.env.NOSTR_TEST2_NSEC
    if (!nsec) {
        throw new Error('NOSTR_TEST2_NSEC is missing from .env')
    }

    const decoded = decode(nsec)
    if (decoded.type !== 'nsec') {
        throw new Error('NOSTR_TEST2_NSEC is not an nsec.')
    }

    const sk = decoded.data
    const pk = getPublicKey(sk)

    return { sk, pk, npub: npubEncode(pk) }
}

/**
 * A brand-new keypair on every call — never read from the environment, never reused.
 *
 * Precedent: `schluesselSperre.nodetest.ts`'s private `paar()` helper. This is the
 * reusable, exported form later phases need: P2 writes replaceable NIP-51 kinds
 * (10003/30003), and a test that writes those under the shared `NOSTR_TEST_NSEC` would
 * be overwritten by any parallel test — structurally the same incident as 2026-08-21,
 * where a replaceable kind 0 published under the shared identity took down 14 unrelated
 * tests. Nothing here touches `.env` or `PRODUKTIONS_SCHREIBER`: a freshly generated key
 * cannot coincide with a known production writer, so it needs no sweep and no guard.
 */
export function freshKeypair(): { sk: Uint8Array; pk: string; npub: string; nsec: string } {
    const sk = generateSecretKey()
    const pk = getPublicKey(sk)

    return { sk, pk, npub: npubEncode(pk), nsec: nsecEncode(sk) }
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
 *
 * `ausgenommen` ist standardmäßig {@link TEST_SCHLUESSEL_VARIABLE} (unverändertes
 * Verhalten für jeden bestehenden Aufrufer). {@link pruefeTestschluessel} ruft dies für
 * JEDE Test-Identität einzeln auf und nennt jeweils deren EIGENEN Variablennamen, damit
 * eine Identität sich nicht selbst als Vergleichsgegner listet, aber jede ANDERE
 * Test-Identität — genau wie ein echter `NOSTR_BOT_NSEC` — Vergleichsgegner bleibt.
 */
export const gesperrteSchreiber = (
    env: Record<string, string | undefined> = process.env,
    ausgenommen: string = TEST_SCHLUESSEL_VARIABLE,
): Schreiber[] => [
    ...PRODUKTIONS_SCHREIBER,
    ...nsecVariablen(env, ausgenommen).flatMap((name) => {
        const pk = pubkeyAus(env[name] as string)

        return pk === null ? [] : [{ pk, quelle: name }]
    }),
]

/**
 * **Der Riegel.** Bricht ab, wenn EINE der Test-Identitäten
 * ({@link TEST_SCHLUESSEL_VARIABLEN}) ein Produktions-Schreiber ist.
 *
 * Läuft in `global-setup.ts`, also **vor** dem ersten Browser und dem ersten Relay.
 *
 * Bis 2026-09-03 prüfte diese Funktion ausschließlich {@link TEST_SCHLUESSEL_VARIABLE}.
 * Mit `testKeys2()`/`NOSTR_TEST2_NSEC` kam eine zweite Test-Identität hinzu — ein
 * Produktionsschlüssel, der versehentlich DIREKT in `NOSTR_TEST2_NSEC` landet, während
 * `NOSTR_TEST_NSEC` ein harmloser Wegwerf-Wert bleibt, wäre von der alten
 * Ein-Variablen-Prüfung nie gesehen worden — gefunden und geschlossen im selben Zug wie
 * die zweite Identität selbst. Die Schleife prüft jede Variable einzeln und unabhängig;
 * eine künftige dritte Identität ist über {@link TEST_SCHLUESSEL_VARIABLEN} erfasst, ohne
 * dass diese Funktion angefasst werden muss.
 *
 * Ausfallrichtung, Fall für Fall — je Variable:
 * - Variable fehlt → kein Abbruch hier. `testKeys()`/`testKeys2()` werfen dann mit der
 *   Meldung, die dem Leser tatsächlich hilft; zwei Abbrüche für dieselbe Ursache
 *   verwirren nur.
 * - Variable gesetzt, aber unlesbar → **Abbruch**. Mit einem kaputten Schlüssel kann zwar
 *   nichts signiert werden, aber der Riegel könnte dann auch nichts vergleichen, und ein
 *   Riegel, der stillschweigend nichts tut, ist der teuerste Zustand von allen.
 * - Übereinstimmung → **Abbruch** mit {@link sperrMeldung}, die die betroffene Variable
 *   nennt.
 */
export function pruefeTestschluessel(env: Record<string, string | undefined> = process.env): void {
    for (const variable of TEST_SCHLUESSEL_VARIABLEN) {
        const nsec = env[variable]
        if (nsec === undefined || nsec === '') {
            continue
        }

        const testPk = pubkeyAus(nsec)
        if (testPk === null) {
            throw new Error(`${variable} ist kein lesbarer nsec — der Schlüssel-Riegel kann nicht prüfen.`)
        }

        const treffer = sperrTreffer(testPk, gesperrteSchreiber(env, variable))
        if (treffer.length > 0) {
            throw new Error(sperrMeldung(treffer, variable))
        }
    }
}
