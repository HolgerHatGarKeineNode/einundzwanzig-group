/**
 * **Die PRÄVENTION — was der Browser eines Testlaufs gar nicht erst erreichen kann.**
 *
 * Diese Datei ist das Gegenstück zu `relayGuard.ts` und bewusst genauso **rein**: keine
 * Imports, kein Playwright, kein Dateisystem. Hier steht nur die Entscheidung („welche
 * Herkunft darf eine Verbindung überhaupt versuchen"); die Verdrahtung an Chromium steht
 * in `playwright.config.ts` (Start-Argumente) und `fixtures.ts` (Wrapper je Kontext).
 *
 * ── Warum es beides gibt, Wächter UND Prävention ────────────────────────────────────
 *
 * Der Wächter aus `relayGuard.ts` urteilt im Fixture-ABBAU, also **nach** dem Test. Für
 * eine lesende Phase genügt das: man erfährt, dass die Messung nichts wert war. Für eine
 * SCHREIBENDE Phase genügt es nicht — ein signiertes Nostr-Ereignis ist zu diesem
 * Zeitpunkt bereits publiziert, und bei Nostr heißt publiziert unwiderruflich. Detektion
 * kann einen Fehler benennen; sie kann ihn nicht zurücknehmen.
 *
 * ── Zwei Schichten, mit ihrer je eigenen Reichweite ─────────────────────────────────
 *
 * 1. **`--host-resolver-rules`** ({@link hostResolverRegel}) am Chromium-Start. Wirkt für
 *    JEDEN Browser des Laufs — auch für die drei Specs, die ihr `test` aus
 *    `@playwright/test` statt aus `support/fixtures.ts` beziehen und deshalb weder
 *    Wächter noch Wrapper sehen (`blossom-content-hydration`, `blossom-media-guard`,
 *    `composer-attachment-preview`; siehe `specImporte.nodetest.ts`, das diese Liste
 *    festhält). Das ist ihr eigentlicher Wert: sie ist die einzige Schicht, die nicht an
 *    unserer Fixture-Verdrahtung hängt.
 * 2. **Ein `addInitScript`-Wrapper um `window.WebSocket`** ({@link wrapperQuelle},
 *    verdrahtet in `fixtures.ts`). Der Konstruktor **wirft** für eine fremde Herkunft —
 *    es entsteht gar kein Socket, nichts wird aufgebaut, nichts geschlossen.
 *
 * ── Warum NICHT `context.routeWebSocket` — teuer gelernt ────────────────────────────
 *
 * Der Plan nannte `routeWebSocket` als Möglichkeit, und gebaut war es zuerst damit: die
 * Sperre griff, die Sonde zählte 0, der Gegenbeweis war grün. **Der Buzz-Arm der Suite
 * wurde davon rot** (`buzz-room.spec.ts:491`, `pin-room.spec.ts:517`) — die Seite zeigte
 * eine gesendete Nachricht, der Relay hatte sie nie.
 *
 * Der Grund, gemessen am 2026-08-21 außerhalb dieses Projekts (`String(window.WebSocket)`
 * und `WebSocket.prototype.send` in einer geladenen Seite):
 *
 * | Aufbau                    | `window.WebSocket`                       | `send` nativ |
 * |---------------------------|------------------------------------------|--------------|
 * | ohne alles                | `function WebSocket() { [native code] }` | **ja**       |
 * | mit `routeWebSocket`      | `class WebSocket extends WebSocketMock`  | **nein**     |
 * | mit diesem Wrapper        | `function () { [native code] }`          | **ja**       |
 *
 * **Eine registrierte `routeWebSocket` ersetzt die WebSocket-Implementierung der ganzen
 * Seite durch eine Attrappe — auch für Herkünfte, die ihr Muster gar nicht trifft.** Sie
 * muss das, denn sie kann erst am Konstruktor entscheiden. Für den lokalen Buzz-Relay
 * bedeutete das: TCP stand, die App hielt den Socket für offen, und der Publish-Weg
 * (NIP-42-AUTH) kam nicht durch.
 *
 * Die erste Messung dieses Moduls hatte das nicht gesehen, weil sie nur ZÄHLTE, ob eine
 * Verbindung am Zielrechner ankommt — die Frage „verhalten sich die ERLAUBTEN Sockets
 * noch wie vorher" stand nicht darin. Deshalb steht sie jetzt als Zusicherung in
 * `relay-praevention.spec.ts`: der Wrapper muss die native Implementierung stehen lassen.
 *
 * Der Wrapper ist ein `Proxy` und keine handgeschriebene Funktion: er erbt Prototyp,
 * statische Konstanten und `instanceof` unverändert vom Original. Erlaubte Sockets laufen
 * damit durch `Reflect.construct` in die native Implementierung.
 *
 * ── Die zwei Schichten sind NICHT gleich robust: (1) sperrt, (2) meldet ──────────────
 *
 * Die Aufzählung oben trennt sie nach **Reichweite** (welche Specs sie erfassen). Ebenso
 * wichtig und weniger offensichtlich ist die **Robustheit**, gemessen am 2026-08-21 mit
 * echtem Chromium gegen einen Loopback-Server:
 *
 * | Weg im Browser                        | nur Wrapper | nur Resolver |
 * |---------------------------------------|-------------|--------------|
 * | `new WebSocket(url)` — der Produktivweg | gesperrt    | gesperrt     |
 * | `Reflect.construct`, fremdes newTarget  | gesperrt    | —            |
 * | aus einem iframe-Realm                  | gesperrt    | —            |
 * | `WebSocket.prototype.constructor`       | **kommt an**| gesperrt     |
 * | `globalThis.WebSocket` überschreiben    | **kommt an**| gesperrt     |
 * | aus einem `Worker`                      | **kommt an**| gesperrt     |
 *
 * **Der Wrapper ist die MELDENDE Schicht, die Resolver-Regel die SPERRENDE.** Der Wrapper
 * erzeugt den benannten Wurf, den der Wächter sieht und der einen Fehlschlag lesbar macht
 * — aber er ist innerhalb des Browsers umgehbar: er erbt den Prototyp (gewollt, damit
 * `instanceof` hält), und damit ist `Original.prototype.constructor` einen Property-Zugriff
 * entfernt; ein `Worker` hat ohnehin einen eigenen globalen Scope, in den `addInitScript`
 * nicht hineinreicht.
 *
 * Die Resolver-Regel fängt alle drei ab, weil sie im **Netzstapel** wirkt und nicht in der
 * Seite. **Sie ist deshalb kein Ballast neben dem Wrapper, sondern die einzige Schicht,
 * die auch dann noch trägt, wenn jemand an `window.WebSocket` vorbeigeht.** Wer sie später
 * für redundant hält, öffnet Worker und `prototype.constructor`.
 *
 * Kein Angriffspfad, sondern eine Grenze des Mechanismus: `new WebSocket(url)` ist der
 * Weg, den welshman und jeder Produktivpfad gehen, und der ist zu.
 *
 * ── Gemessen, nicht angenommen (2026-08-21, außerhalb dieses Projekts) ──────────────
 *
 * Ein Wegwerf-Skript gegen Playwright 1.59.1 + `/bin/chromium`, mit einem lokalen
 * TCP-Server als Sonde (zählt angenommene Verbindungen) und je einer Positivkontrolle:
 *
 * | Aufbau                                                  | Seite sieht        | Sonde |
 * |---------------------------------------------------------|--------------------|------:|
 * | ohne alles (Positivkontrolle)                             | error, close(1006) | **1** |
 * | nur Resolver-Regel, Host per `MAP` auf 127.0.0.1 gezeigt   | error, close(1006) | **1** |
 * | nur Resolver-Regel, Host NICHT gemappt                    | error, close(1006) | **0** |
 * | Wrapper, fremder Host (per `MAP` erreichbar)               | **Wurf**           | **0** |
 * | Wrapper, Ziel `127.0.0.1`                                  | error, close(1006) | **1** |
 *
 * Drei Dinge, die daraus folgen und die man sonst falsch annimmt:
 *
 * - **`MAP * ~NOTFOUND` trifft auch IP-Literale.** Ohne `EXCLUDE 127.0.0.1` stirbt jedes
 *   `page.goto('http://127.0.0.1:8137/')` an `ERR_NAME_NOT_RESOLVED` — also die gesamte
 *   Suite, deren `baseURL` genau diese Form hat. Angenehme Kehrseite: eine fremde
 *   Verbindung per roher IP (`wss://1.2.3.4/`) fällt damit ebenfalls unter die Regel.
 * - **Die Reihenfolge der Regeln entscheidet.** Eine spezifische `MAP` NACH `MAP *`
 *   verliert; `MAP *` gewinnt als erste Übereinstimmung. Deshalb steht {@link SONDE_HOST}
 *   in {@link hostResolverRegel} vorn — stünde er hinten, bliebe der Gegenbeweis in
 *   `relay-praevention.spec.ts` grün, weil ihn schon das DNS erschlägt, und würde über die
 *   Route gar nichts aussagen.
 * - **`EXCLUDE [::1]` wirkt NICHT, `EXCLUDE ::1` schon** (gemessen gegen einen auf `::1`
 *   lauschenden HTTP-Server: mit Klammern `ERR_NAME_NOT_RESOLVED`, ohne Klammern OK).
 *   In einer URL heißt derselbe Host `[::1]` — die beiden Schreibweisen sind deshalb
 *   NICHT austauschbar, und {@link alsResolverName} ist genau diese Übersetzung.
 *
 * ── Was diese Datei NICHT deckt — ausdrücklich ──────────────────────────────────────
 *
 * **Nur der Browser.** Zwei weitere Akteure öffnen im Lauf Verbindungen, und für beide
 * ist hier nichts gewonnen:
 *
 * - **Der PHP-Prozess.** `ProfileCache` und die Artikel-Flächen fragen server-seitig
 *   Relays; diese Sockets baut PHP auf, nicht Chromium. Kein Chromium-Flag und keine
 *   Playwright-Route erreicht sie. Dagegen hilft ausschließlich der ENV-Riegel
 *   (`testServerEnv`), und genau dort sind in P0 und P5 je ein Schlüssel durchgerutscht.
 * - **`nak`** (Go-Binary, `support/articles.ts` u. a.). Rechnet seine Ziel-URL aus dem
 *   eigenen Worker-Port; auch das ist eine SETZENDE Absicherung, keine prüfende.
 *
 * Wer diesen Absatz beim Lesen überspringt, hält die Suite für hermetisch. Sie ist es
 * zu genau einem Drittel.
 */

/**
 * Die Herkünfte, die eine Verbindung überhaupt versuchen dürfen — in der Schreibweise,
 * die `new URL(...).hostname` liefert.
 *
 * **Warum genau diese drei und nicht „alles im 127er-Netz":** Die Liste wird an ZWEI
 * Stellen ausgewertet, und die zweite (Chromiums `EXCLUDE`) kennt keine Netzmasken. Eine
 * Definition, die hier weiter wäre als dort, ergäbe eine Herkunft, die die Route durchlässt
 * und das DNS erschlägt — ein Widerspruch, den niemand debuggen will. `127.0.0.2` ist im
 * ganzen Repo nirgends in Gebrauch (gemessen: 0 Treffer), der Verzicht kostet also nichts.
 *
 * **`0.0.0.0` steht bewusst NICHT hier**, obwohl eine Verbindung dorthin auf Linux lokal
 * landet: der Relay-Wächter führt sie in seinen 31 geprüften Schreibweisen ausdrücklich als
 * Fremde, und die Prävention darf nicht laxer sein als die Detektion.
 */
export const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]'] as const

/** Darf diese Herkunft eine Verbindung versuchen? Alles Unbekannte: nein (fail-closed). */
export const istLoopbackHost = (hostname: string): boolean =>
    (LOOPBACK_HOSTS as readonly string[]).includes(hostname.toLowerCase())

/**
 * Dieselbe Frage für eine fertige Herkunft (`host:port`, wie sie `relayGuard.herkunft()`
 * liefert): `localhost:3335` → ja, `nostr.einundzwanzig.space:443` → nein.
 *
 * Gebraucht von `relayWaechter.erlaube()`: eine Freigabe darf nie weiter reichen als die
 * Prävention, sonst gäbe es eine Herkunft, die der Wächter durchwinkt und die Route
 * trotzdem sperrt — ein Test, der grün behauptet, was gar nicht stattgefunden hat.
 *
 * `lastIndexOf(':')` und nicht `split(':')`: bei `[::1]:3335` wären das fünf Teile.
 */
export const istLoopbackHerkunft = (herkunft: string): boolean => {
    const trenner = herkunft.lastIndexOf(':')

    return trenner > 0 && istLoopbackHost(herkunft.slice(0, trenner))
}

/**
 * `[::1]` (URL-Schreibweise) → `::1` (Resolver-Schreibweise).
 *
 * Gemessen, nicht geraten — siehe Modulkopf. Ein `EXCLUDE [::1]` parst durch und tut
 * nichts; der Fehler wäre also still.
 */
export const alsResolverName = (host: string): string => (host === '[::1]' ? '::1' : host)

/**
 * Die Marke, an der ein gesperrter Verbindungsversuch erkennbar ist — im Wurf der Seite
 * wie im Vermerk des Wächters.
 *
 * Eigener Wortlaut und nicht etwa ein Netzwerkfehler: `ERR_NAME_NOT_RESOLVED` oder ein
 * `close(1006)` bekommt man auch von einem toten Port, und der Gegenbeweis in
 * `relay-praevention.spec.ts` könnte dann nicht unterscheiden, ob die Prävention gegriffen
 * hat oder ob nur zufällig niemand lauschte.
 */
export const SPERR_MARKE = 'HERMETIK-SPERRE'

/** Der Name der Meldefunktion, die der Wrapper in der Seite vorfindet. */
export const MELDE_BINDUNG = '__hermetikSperreGemeldet'

/**
 * Der Wrapper, wie er per `addInitScript` in JEDE Seite geht — als Quelltext, weil
 * Playwright die Funktion serialisiert und sie deshalb nichts aus diesem Modul schließen
 * kann.
 *
 * Zwei Dinge in dieser Reihenfolge, und die Reihenfolge ist Absicht:
 * 1. **Melden** (best effort, siehe unten),
 * 2. **Werfen** — verlässlich und synchron.
 *
 * **Die Meldung ist ausdrücklich best effort.** Sie geht über eine Playwright-Bindung
 * und damit über einen asynchronen Kanal; der Wurf dagegen passiert sofort. Die Sperre
 * hängt also nie an der Meldung. Andersherum wäre es ein Fehler: ein Riegel, dessen
 * Wirkung von einer Zustellung abhängt, hat eine Bedingung mehr, als er braucht.
 */
export const wrapperQuelle = ({ erlaubteHosts, marke, bindung }: { erlaubteHosts: readonly string[]; marke: string; bindung: string }): string => `
    (() => {
        const erlaubt = ${JSON.stringify(erlaubteHosts)}
        const Original = window.WebSocket
        // Proxy statt handgeschriebener Funktion: Prototyp, statische Konstanten
        // (CONNECTING/OPEN/…) und \`instanceof\` bleiben unverändert die des Originals,
        // und ein ERLAUBTER Socket landet über \`Reflect.construct\` in der NATIVEN
        // Implementierung. Genau daran ist die Variante mit \`routeWebSocket\` gescheitert:
        // sie ersetzte die Implementierung für jeden Socket der Seite durch eine Attrappe.
        window.WebSocket = new Proxy(Original, {
            construct(ziel, argumente) {
                let host = ''
                try {
                    host = new URL(String(argumente[0]), location.href).hostname.toLowerCase()
                } catch {
                    host = ''
                }
                if (!erlaubt.includes(host)) {
                    const url = String(argumente[0])
                    try {
                        window[${JSON.stringify(bindung)}]?.(url)
                    } catch {
                        // Die Meldung ist Beiwerk; die Sperre darf nicht an ihr hängen.
                    }
                    throw new Error(${JSON.stringify(marke)} + ': ' + url)
                }

                return Reflect.construct(ziel, argumente)
            },
        })
    })()
`

/**
 * Der Hostname des Gegenbeweises (`relay-praevention.spec.ts`).
 *
 * `.invalid` ist per RFC 2606 reserviert und kann nie ein echter Rechner sein — die
 * Sonde zeigt per `MAP` auf `127.0.0.1` und ist damit ein **fremder Name auf einem
 * lokalen Server**. Genau das braucht der Gegenbeweis: eine Herkunft, die die Prävention
 * für fremd hält und die trotzdem erreichbar WÄRE. Ohne diese Konstruktion prüfte der
 * Gegenbeweis nur, dass ein nicht auflösender Name nicht auflöst.
 */
export const SONDE_HOST = 'relay-sonde.invalid'

/**
 * Der **beschattete** Zwilling der Sonde — der Hostname, an dem die Sperre selbst
 * messbar wird.
 *
 * Seine `MAP` steht in {@link hostResolverRegel} bewusst **hinter** `MAP * ~NOTFOUND`
 * und ist damit wirkungslos: die Sperre gewinnt als erste Übereinstimmung. Genau das ist
 * der Zweck.
 *
 * **Warum es ihn braucht — ein Fehlgriff, den erst die Mutationsprobe zeigte:** der
 * Gegenbeweis prüfte zuerst mit einem schlicht nicht gemappten `.invalid`-Namen, ob die
 * Resolver-Sperre greift. Der Fall blieb grün, als die Sperre versuchsweise entzahnt
 * wurde (`MAP * ~NOTFOUND` → `MAP nirgendwo.invalid ~NOTFOUND`, gemessen 2026-08-21) —
 * denn ein `.invalid`-Name löst per RFC 2606 auch ohne jede Regel nirgendwohin auf. Der
 * Test hatte also nur bewiesen, dass Unauflösbares unauflösbar ist. Mit dem beschatteten
 * Zwilling ist der Unterschied echt: fällt die Sperre weg, wird seine `MAP` wirksam, der
 * Name zeigt auf `127.0.0.1`, und die Sonde des Gegenbeweises zählt eine Verbindung.
 *
 * Die Sperre auszuhebeln taugt er nicht: fiele sie weg, zeigte er auf Loopback.
 */
export const SCHATTEN_SONDE_HOST = 'relay-sonde-beschattet.invalid'

/**
 * Die Regel für `--host-resolver-rules`.
 *
 * Reihenfolge ist Semantik (siehe Modulkopf): die spezifische `MAP` der Sonde zuerst,
 * dann die Sperre für alles Übrige, dann die Ausnahmen fürs Loopback.
 */
export const hostResolverRegel = (): string =>
    [
        `MAP ${SONDE_HOST} 127.0.0.1`,
        'MAP * ~NOTFOUND',
        ...LOOPBACK_HOSTS.map((h) => `EXCLUDE ${alsResolverName(h)}`),
        // Wirkungslos, solange die Sperre darüber steht — und deshalb der einzige Weg,
        // ihre Wirkung zu MESSEN. Begründung an {@link SCHATTEN_SONDE_HOST}.
        `MAP ${SCHATTEN_SONDE_HOST} 127.0.0.1`,
    ].join(', ')

/**
 * Die Start-Argumente für jedes Chromium dieses Laufs.
 *
 * Steht hier und nicht als Literal in `playwright.config.ts`, damit der Nodetest die
 * REGEL prüfen kann statt eine Kopie davon.
 */
export const chromiumHermetikArgs = (): string[] => ['--no-sandbox', `--host-resolver-rules=${hostResolverRegel()}`]

/**
 * Die Meldung, die im Wächter-Bericht landet, wenn eine Verbindung gesperrt wurde.
 *
 * **Warum die Prävention überhaupt melden muss:** ein verhinderter Socket entsteht nie
 * und erzeugt deshalb **kein** `page.on('websocket')`-Ereignis (für die zuerst gebaute
 * `routeWebSocket`-Variante am 2026-08-21 nachgemessen: `page.on` sah `[]`; für einen
 * Konstruktor, der wirft, gilt es erst recht). Ohne eigene Meldung hätte die Prävention
 * den Wächter also blind gemacht: die Verbindung wäre verhindert UND unsichtbar, der Test
 * bliebe grün, und niemand erführe, dass eine Fläche gerade nach draußen greift.
 * Verhindern ohne Melden ist die halbe Arbeit.
 */
export const sperrVermerk = (url: string): string => `${url} [${SPERR_MARKE}: von der Prävention verhindert]`
