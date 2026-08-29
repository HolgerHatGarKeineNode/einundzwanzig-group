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

/**
 * Event-ids dieses Worker-Prozesses, in Publish-Reihenfolge — Artikel UND ihre
 * Sozialsignale (kind 7/1111/9735, seit P6).
 *
 * **Die Signale gehören hier hinein, nicht nur die Artikel.** Der worker-eigene zooid
 * überlebt den Lauf (RUNMARK-Wiederverwendung); eine Reaktion, die niemand abräumt,
 * zählt beim nächsten Lauf an einem Artikel mit, der zufällig dieselbe Adresse trägt —
 * und ein Zähler, der „3" statt „1" zeigt, sieht wie ein Fehler des Produkts aus.
 */
const published: { id: string; sec: string }[] = []

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
    published.push({ id: found.id, sec })

    return found.id
}

/**
 * Die NIP-01-Adresse eines Artikels — `30023:<pubkey>:<d>`.
 *
 * **Bewusst hier ausgeschrieben und nicht aus `js/articleMetrics.ts` importiert.** Der
 * Test soll die Form unabhängig behaupten; ein Import machte die Fixture zur Kopie der
 * geprüften Funktion, und ein Fehler in ihr wäre auf beiden Seiten derselbe.
 */
export function artikelAdresse(pubkeyHex: string, identifier: string): string {
    return `30023:${pubkeyHex}:${identifier}`
}

/**
 * Publiziert eine Reaktion (kind 7, NIP-25) auf einen Artikel — adressiert über `a`.
 *
 * `a` und nicht `e`: ein 30023 ist ersetzbar, und die Adresse überlebt jede
 * Überarbeitung. Beide Formen kommen im echten Bestand vor (deshalb fragt die Fläche
 * auch beide ab); hier steht die, auf die es ankommt.
 */
export function publishReaction(relayWs: string, sec: string, adresse: string, content = '+'): void {
    merkeId(nak(['event', '--auth', '--sec', sec, '-k', '7', '-t', `a=${adresse}`, '-c', content, relayWs]), sec, relayWs)
}

/**
 * Die Event-id aus `nak event`s Ausgabe ziehen und fürs Abräumen merken.
 *
 * `nak event` druckt das signierte Ereignis als JSON — anders als bei kind 30023 braucht
 * es hier keine Requery: die Id steht unveränderlich in der Ausgabe, und ein
 * nicht-ersetzbares Ereignis kann nicht in mehreren Fassungen vorliegen. Findet sich
 * keine Id, wird still nichts gemerkt: ein werfender Helfer überschriebe den Testbefund
 * mit einem Infrastrukturfehler.
 */
function merkeId(ausgabe: string, sec: string, relayWs: string): void {
    const id = idAusAusgabe(ausgabe)
    if (!id) {
        throw new Error(`nak hat kein Ereignis gedruckt — Ausgabe:\n${ausgabe.trim() || '(leer)'}`)
    }
    // **REQUERY, nicht der Rückgabewert — der Weg von `publishArticle` 60 Zeilen höher.**
    //
    // Der erste Entwurf prüfte nur, ob `nak event` ein parsebares Ereignis druckte, und
    // trug im Docblock „Fail-CLOSED" — eine Zusage ohne Deckung. **Gemessen:** `nak event`
    // druckt das signierte Ereignis auch bei ABLEHNUNG auf stdout, mit **Exit-Code 0**.
    // Mit einem Nicht-Mitglied signiert lehnte der zooid viermal ab
    // (`restricted: you are not a member of this relay`), und die Meldung „nicht
    // angenommen" erschien **null Mal**; der Test scheiterte erst später und aus dem
    // falschen Grund.
    //
    // Ob ein Ereignis wirklich auf dem Relay liegt, beantwortet nur der Relay selbst.
    const gefunden = nak(['req', '--auth', '--sec', sec, '-i', id, relayWs])
        .trim()
        .split('\n')
        .filter(Boolean)
        .some((zeile) => {
            try {
                return (JSON.parse(zeile) as { id?: string }).id === id
            } catch {
                return false
            }
        })
    if (!gefunden) {
        throw new Error(
            `Der Relay hat das Ereignis ${id.slice(0, 12)}… NICHT angenommen (Requery leer). ` +
                `nak meldet Ablehnungen nur auf stderr und beendet sich mit 0 — der Rückgabewert sagt darüber nichts.`,
        )
    }
    published.push({ id, sec })
}

/** Die Event-Id aus `nak event`s Ausgabe ziehen; `''`, wenn keine dasteht. */
function idAusAusgabe(ausgabe: string): string {
    for (const zeile of ausgabe.trim().split('\n')) {
        try {
            const event = JSON.parse(zeile) as { id?: string }
            if (typeof event.id === 'string' && event.id.length === 64) {
                return event.id
            }
        } catch {
            // keine JSON-Zeile — nak druckt auch Statuszeilen
        }
    }

    return ''
}

/**
 * Publiziert einen NIP-22-Kommentar (kind 1111), der den Artikel **nur im grossen `A`**
 * nennt.
 *
 * **Das ist der Fall, der einen `#a`-only-Filter auffliegen lässt** und deshalb der
 * Grund, warum dieser Helfer so und nicht anders baut: eine Antwort auf einen Kommentar
 * trägt im kleinen `a` den ELTERNKOMMENTAR und nur im `A` den Artikel. Am 2026-08-21
 * über drei Relays gemessen sind 7 der 64 Artikel-Kommentare ausschliesslich über `#A`
 * zu finden.
 */
export function publishCommentRootOnly(relayWs: string, sec: string, adresse: string, content = 'Ein Kommentar.'): void {
    merkeId(nak([
        'event',
        '--auth',
        '--sec',
        sec,
        '-k',
        '1111',
        '-t',
        `A=${adresse}`,
        '-t',
        // Der Elternteil ist ein anderer Kommentar, nicht der Artikel.
        'a=30023:0000000000000000000000000000000000000000000000000000000000000000:ein-anderer-kommentar',
        '-c',
        content,
        relayWs,
    ]), sec, relayWs)
}

/**
 * Publiziert eine Zap-Quittung (kind 9735), die welshmans `zapFromEvent` **akzeptiert**.
 *
 * ── Warum das nicht trivial ist ────────────────────────────────────────────────────
 *
 * Eine kind 9735 behauptet eine Zahlung, sie beweist sie nicht — und welshman prüft
 * entsprechend streng (`bolt11` gegen das `amount`-Tag des Requests, `lnurl` gegen den
 * aufgelösten Zapper, Signer gegen dessen `nostrPubkey`). Ein naiv zusammengebautes
 * Ereignis zählt deshalb **null**, und der Test wäre aus dem falschen Grund rot.
 *
 * **Hier stand bis zum 2026-08-29: „Genutzt wird der Zweig `p` === Signer der Quittung
 * (`Zaps.js`): welshman hält ihn ohne aufgelösten Zapper für legitim. Damit braucht der
 * Test keinen LNURL-Server." Das war ein Weg an einem SICHERHEITSRIEGEL vorbei, kein
 * Kunstgriff.** 0.8.16 übersprang die Signaturprüfung, sobald `p === Signierer` —
 * `zapFromEvent` gab dann ohne jeden Vergleich gegen `zapper.nostrPubkey` ein gültiges
 * Zap zurück. Die Fixture nutzte genau diesen Kurzschluss: sie signierte mit dem
 * EMPFÄNGER und legte dem Autor gar keinen Zapper an. Der Test war grün, weil er den
 * Anti-Spoof-Riegel umging.
 *
 * **0.9.5 hat den Kurzschluss geschlossen** (`domain/src/other/Zapper.js:47`, unbedingtes
 * `receipt.event.pubkey !== this.nostrPubkey`), und die Fixture fiel durch — richtig so.
 * Wer eine ZÄHLENDE Quittung braucht, baut sie jetzt so, wie ein echter Zap aussieht:
 * ein kind 0 mit `lud16` am Autor, eine lnurl-pay-Antwort mit `allowsNostr` und
 * `nostrPubkey` (im Test per `page.route` gestellt), und eine Quittung, die von **genau
 * diesem `nostrPubkey`** signiert ist. `sec` ist damit der Schlüssel des LNURL-Servers,
 * nicht der des Empfängers. Der Docblock in `js/longformFeed.ts:358` sagte das die ganze
 * Zeit: „Ohne ihn zählt `summiereZaps` null … das ist der Anti-Spoof-Riegel und keine
 * Hürde, die man umgeht."
 *
 * Eine Quittung, die von einem ANDEREN Schlüssel signiert ist, zählt nicht — und genau
 * das ist seit dem 2026-08-29 ein eigener Negativfall in `article-metrics.spec.ts`.
 *
 * **`empfaengerPub` ist zugleich der Riegel und die Falle.** Seit dem Sicherheitsbefund
 * verwirft `summiereZaps` jede Quittung, deren `p`-Tag nicht der Artikel-AUTOR ist —
 * derselbe Kurzschluss macht sonst die Sat-Summe eines fremden Artikels für jeden Dritten
 * frei setzbar. Wer hier einen anderen Pubkey als den Autor übergibt, baut deshalb den
 * ANGRIFFSFALL, nicht den Normalfall; beide werden in `article-metrics.spec.ts` gebraucht
 * und stehen dort ausdrücklich benannt.
 *
 * `msats` wird als Piko-BTC in den bolt11-HRP geschrieben (`p` = 0,1 msat, am
 * installierten welshman nachgemessen: `lnbc2100000p` → 210 000 msats). Die Rechnung ist
 * kein gültiges Lightning-Objekt — `getInvoiceAmount` liest ausschliesslich den
 * Betragsteil.
 */
export function publishZapReceipt(
    relayWs: string,
    sec: string,
    empfaenger: string | string[],
    adresse: string,
    msats: number,
    /**
     * Pubkey des ZAHLENDEN im eingebetteten 9734. Ohne Angabe der letzte `p`-Wert —
     * die historische Form, die die Angriffsfälle unverändert lässt.
     *
     * **Wozu er gebraucht wird:** `Zapper.validate` verwirft einen Selbst-Zap
     * (`request.pubkey === zapper.pubkey`). Eine lnurl-pay-Antwort trägt zwar kein
     * `pubkey`, sodass der Zweig heute nicht greift — aber eine Fixture, die den
     * Empfänger als Zahlenden ausgibt, ist schlicht kein Bild eines echten Zaps, und
     * genau daran ist die vorige gescheitert.
     */
    absender?: string,
): void {
    // **`empfaenger` darf eine LISTE sein**, und das ist kein Komfort: Nostr verbietet
    // doppelte Tags nicht, Relays deduplizieren sie nicht, und genau daran ist der erste
    // Riegel dieser Phase gescheitert. Ein Fixture, das nur einen `p`-Tag bauen kann,
    // kann die Umgehung `[["p",AUTOR],["p",ANGREIFER]]` nicht darstellen.
    const pListe = Array.isArray(empfaenger) ? empfaenger : [empfaenger]
    const request = JSON.stringify({
        kind: 9734,
        pubkey: absender ?? pListe[pListe.length - 1],
        tags: [...pListe.map((wert) => ['p', wert]), ['amount', String(msats)], ['a', adresse]],
        content: '',
    })
    merkeId(nak([
        'event',
        '--auth',
        '--sec',
        sec,
        '-k',
        '9735',
        '-t',
        `a=${adresse}`,
        ...pListe.flatMap((wert) => ['-t', `p=${wert}`]),
        '-t',
        `bolt11=lnbc${msats * 10}p1p0000000`,
        '-t',
        `description=${request}`,
        '-c',
        '',
        relayWs,
    ]), sec, relayWs)
}

/**
 * Löscht alle registrierten Ereignisse dieses Worker-Prozesses (NIP-09, kind 5) und
 * leert die Liste — Artikel und, seit P6, ihre Sozialsignale.
 *
 * **Jedes Ereignis wird mit dem Schlüssel gelöscht, der es signiert hat.** Vorher lief
 * das pauschal über einen mitgegebenen Schlüssel, und der Relay lehnte jede fremde
 * Löschung ab: `blocked: you are not the author of this event` — gemessen **zweimal je
 * Lauf** von `article-metrics.spec.ts`, für die beiden Angriffsquittungen, die
 * absichtlich mit einem ANDEREN Schlüssel signiert werden als der Artikel.
 *
 * Folgenlos war das nur, solange der Aufräumer schwieg. Da die Publish-Helfer seit
 * diesem Auftrag **werfen**, wäre daraus ohne diesen Umbau sofort ein roter Lauf
 * geworden — und zwar einer, bei dem unklar bliebe, ob der Riegel oder die Ursache
 * schuld ist.
 *
 * `_sec` bleibt als Parameter erhalten, damit kein Aufrufer angefasst werden muss; er
 * wird nicht mehr gelesen.
 */
export function cleanupArticles(relayWs: string, _sec?: string): void {
    for (const { id, sec } of published.splice(0)) {
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
