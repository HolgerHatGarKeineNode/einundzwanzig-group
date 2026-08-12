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
