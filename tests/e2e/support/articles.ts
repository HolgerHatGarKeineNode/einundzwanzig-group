/**
 * **Wegwerf-Artikel (kind 30023) über `nak` roh publizieren — das Gegenstück zu jedem
 * Artikel im Test.** Dasselbe Muster wie `support/rooms.ts` (`trackRoom`/`cleanupRooms`),
 * hier für addressierbare NIP-23-Events: kind 30023 wird über NIP-09 (kind 5, `e`-Tag auf
 * die Event-id) gelöscht — am worker-eigenen zooid empirisch bestätigt (2026-08-12:
 * publizieren, requeryen, per kind-5 löschen, requeryen — leer).
 *
 * Ohne dieses Abräumen bliebe jeder publizierte Test-Artikel auf dem worker-eigenen zooid
 * stehen (der Relay überlebt den Lauf, RUNMARK-Wiederverwendung wie bei den Räumen) — mit
 * `test.afterAll(() => cleanupArticles(...))` bleibt das Board-Relay über viele Läufe hinweg
 * leer bis auf das, was der GERADE laufende Test selbst braucht.
 */
import { execFileSync } from 'node:child_process'

const NAK = process.env.NAK ?? `${process.env.HOME}/go/bin/nak`

export type RelayArticle = {
    id: string
    pubkey: string
    kind: number
    content: string
    tags: string[][]
    created_at: number
}

/** Event-ids dieses Worker-Prozesses, in Publish-Reihenfolge. */
const published: string[] = []

/** `nak` mit Wiederholung — gegen Umgebungs-Transienz (Muster `quote-card.spec.ts`). */
function nak(args: readonly string[], attempts = 3): string {
    let last: unknown
    for (let i = 0; i < attempts; i++) {
        try {
            return execFileSync(NAK, [...args]).toString()
        } catch (error) {
            last = error
            execFileSync('sleep', ['1'])
        }
    }
    throw last
}

/**
 * Publiziert ein kind 0 (Profil) — genau so viel, wie die Autorenkarte der
 * Vollansicht anzeigt.
 *
 * Steht hier und nicht in `rooms.ts`, weil es ausschließlich die Artikelfläche braucht:
 * dort ist der Autor eine eigene Anzeigeeinheit (Name, NIP-05-Häkchen, Bio,
 * Lightning-Einstieg), während er im Chat nur eine Zeile ist.
 *
 * **`nip05` macht diesen Helfer nicht zum Verifizierer.** welshman holt dafür zusätzlich
 * die `.well-known/nostr.json` der Domain; das Häkchen entsteht erst bei bestätigtem
 * Match. Wer hier ein `nip05` setzt, hat damit noch kein Häkchen — er hat die Vorbedingung
 * gesetzt. Genau diese Trennung ist der Gegenstand des Reaktivitäts-Tests in
 * `longform-reader.spec.ts`.
 */
export function publishProfile(
    relayWs: string,
    sec: string,
    profil: { name?: string; nip05?: string; about?: string; lud16?: string; picture?: string },
    createdAt?: number,
): void {
    const args = ['event', '--auth', '--sec', sec, '-k', '0']
    if (createdAt !== undefined) {
        // **Der Zeitstempel ist hier kein Detail, sondern die halbe Miete.** kind 0 ist
        // ersetzbar: wer ein Testprofil setzt und danach den Ausgangszustand
        // zurückschreiben will, braucht dafür einen JÜNGEREN Stempel, sonst gewinnt
        // weiter das Testprofil. Dasselbe Muster wie in `room.spec.ts` (B4).
        args.push('--ts', String(createdAt))
    }
    args.push('-c', JSON.stringify(profil), relayWs)
    nak(args)
}

/**
 * Publiziert einen kind-30023-Artikel und gibt seine Event-id zurück (per Requery über
 * `#d`+Autor — derselbe „nak druckt zwar JSON beim Publish, aber requeryen ist der bewährte
 * Weg"-Grund wie in `quote-card.spec.ts`).
 */
export function publishArticle(
    relayWs: string,
    sec: string,
    pubkeyHex: string,
    opts: {
        identifier: string
        title?: string
        content?: string
        image?: string
        summary?: string
        publishedAt?: number
        topics?: string[]
        createdAt?: number
        /**
         * Felder eines `imeta`-Tags (NIP-92), je Eintrag `"<schlüssel> <wert>"` —
         * z. B. `['url https://…/folge.mp3', 'm audio/mpeg']`.
         *
         * `nak` trennt die Werte EINES Tags am Semikolon (`-t 'imeta=a;b'`, siehe
         * `nak event --help`), deshalb wird hier zusammengefügt statt mehrfach `-t`
         * übergeben — mehrere `-t imeta=…` ergäben mehrere Tags statt eines mit
         * mehreren Werten.
         */
        imeta?: string[]
    },
): string {
    const args = ['event', '--auth', '--sec', sec, '-k', '30023', '-d', opts.identifier]
    if (opts.title !== undefined) {
        args.push('-t', `title=${opts.title}`)
    }
    if (opts.image !== undefined) {
        args.push('-t', `image=${opts.image}`)
    }
    if (opts.summary !== undefined) {
        args.push('-t', `summary=${opts.summary}`)
    }
    if (opts.publishedAt !== undefined) {
        args.push('-t', `published_at=${opts.publishedAt}`)
    }
    for (const topic of opts.topics ?? []) {
        args.push('-t', `t=${topic}`)
    }
    if (opts.imeta !== undefined) {
        args.push('-t', `imeta=${opts.imeta.join(';')}`)
    }
    if (opts.createdAt !== undefined) {
        args.push('--ts', String(opts.createdAt))
    }
    args.push('-c', opts.content ?? '')
    args.push(relayWs)
    nak(args)

    const found = nak(['req', '-k', '30023', '--auth', '--sec', sec, '-a', pubkeyHex, '-t', `d=${opts.identifier}`, relayWs])
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as RelayArticle)
        // Requery kann bei Reuse mehrere Fassungen zeigen (ersetzbares Event) — die
        // jüngste ist die gerade publizierte.
        .sort((a, b) => b.created_at - a.created_at)[0]

    if (!found) {
        throw new Error(`Artikel "${opts.identifier}" wurde publiziert, aber die Requery fand ihn nicht: ${relayWs}`)
    }
    published.push(found.id)

    return found.id
}

/** Löscht alle registrierten Artikel dieses Worker-Prozesses (NIP-09, kind 5) und leert die Liste. */
export function cleanupArticles(relayWs: string, sec: string): void {
    for (const id of published.splice(0)) {
        try {
            execFileSync(NAK, ['event', '--auth', '--sec', sec, '-k', '5', '-t', `e=${id}`, relayWs], {
                encoding: 'utf8',
                timeout: 15_000,
            })
        } catch {
            // Still, wie `cleanupRooms`: ein werfender Aufräumer überschriebe den
            // Testbefund mit einem Infrastrukturfehler.
        }
    }
}
