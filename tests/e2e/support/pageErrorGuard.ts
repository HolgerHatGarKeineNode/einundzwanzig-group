/**
 * **Der Laufzeit-Wächter — macht einen JS-Fehler im Browser zum Testfehler.**
 *
 * Diese Datei ist bewusst **rein** — genau wie `relayGuard.ts`, aus demselben Grund: die
 * Verdrahtung an Chromium (`page.on('pageerror'/'console')`, Kontexte, Fixture-Abbau)
 * steht in `fixtures.ts`; hier steht nur die Entscheidung, und die ist damit unter
 * `node --test` prüfbar statt nur im laufenden Playwright.
 *
 * ── Der Anlass ───────────────────────────────────────────────────────────────────────
 *
 * `⚡forge-repo.blade.php:1224` trug `x-text="'#' + pr.id.slice(0, 7)"` in einem
 * `x-for="patch in …"` — `pr` war nicht im Scope. Alpine fängt den Ausdrucksfehler ab
 * (`tryCatch` in `livewire.esm.js`), meldet ihn per `console.warn` UND wirft ihn in einem
 * `setTimeout(() => { throw error }, 0)` erneut — absichtlich außerhalb des eigenen
 * try/catch, damit der Fehler nicht spurlos verschwindet. Genau dieser zweite Wurf wird
 * für Chromium ein uncaught exception und damit ein `page.on('pageerror')`-Ereignis
 * (nachgelesen in `vendor/livewire/livewire/dist/livewire.esm.js:1772-1790`, Stand
 * 2026-08-28). Der Span rendert leer, die Seite läuft sichtbar weiter — nur der
 * `pageerror` verrät, dass etwas kaputt war. Weder Build noch `tsc` noch Pest noch die
 * E2E-Suite sahen das vorher; drei Messläufe, die zufällig das Register-Protokoll der
 * Zeile mitschrieben, haben ihn gefunden.
 *
 * **Daraus folgt die Bauform:** `pageerror` ist die primäre und für diesen Anlass
 * HINREICHENDE Quelle — Alpine wirft den gefangenen Fehler bewusst erneut, damit er nicht
 * verschluckt wird. `console.error` wird zusätzlich beobachtet (mehrere Stellen im
 * Livewire-Bundle loggen einen Fehler NUR per `console.error`, ohne erneut zu werfen —
 * z. B. `livewire.esm.js:11215`, `:12582`, `:13786`), aber unter einer engeren, in
 * `fixtures.ts` festgelegten Vorfilterung (siehe deren Kopfkommentar), weil `console.error`
 * in einer Alpine/Livewire-Seite auch für erwartete, nicht-fatale Zustände auftritt.
 *
 * ── Erlaubnisliste statt Blindheit ──────────────────────────────────────────────────
 *
 * Ein Test, der einen Fehlerpfad ABSICHTLICH provoziert (z. B. eine kaputte Signatur, ein
 * absichtlich falsches naddr), erzeugt einen echten `pageerror`, den der Wächter sonst zu
 * Recht meldet. Für genau diese Fälle gibt es die Erlaubnisliste — je Eintrag ZWEI
 * Muster (welcher TEST, welcher FEHLERTEXT) und eine Begründung. Ein Eintrag ohne
 * Text-Einschränkung wäre ein Freibrief für den ganzen Test und deckte auch einen
 * UNVERWANDTEN Fehler in derselben Zeile ab — deshalb sind beide Felder Pflicht.
 *
 * ── Fail-closed ──────────────────────────────────────────────────────────────────────
 *
 * Kein Treffer in der Erlaubnisliste ⇒ Verstoß. Eine leere Beobachtung (kein Fehler) ist
 * kein Verstoß — die meisten Tests werfen nichts.
 */

/** Woher der Wächter den Fehler gesehen hat. */
export type PageFehlerQuelle = 'pageerror' | 'console'

/** Ein beobachteter Laufzeitfehler des Browsers. */
export type PageFehler = {
    quelle: PageFehlerQuelle
    text: string
}

/**
 * Ein Erlaubnis-Eintrag — beide Muster müssen treffen, sonst gilt der Fehler als Verstoß.
 *
 * `titel` matcht gegen `testInfo.titlePath.join(' > ')` (Datei- und Test-Titel zusammen,
 * damit ein Muster nicht versehentlich gleichnamige Tests in anderen Dateien freigibt),
 * `text` gegen den rohen Fehlertext (`PageFehler.text`).
 */
export type ErlaubnisEintrag = {
    titel: RegExp
    text: RegExp
    begruendung: string
}

/**
 * Ist dieser Fehler für DIESEN Test durch die Liste gedeckt?
 *
 * Beide Muster müssen auf denselben Eintrag treffen — ein `titel`-Treffer allein reicht
 * nicht, sonst gäbe ein Eintrag für „provoziert Fehler A" auch einen unverwandten
 * Fehler B im selben Test frei.
 */
export const istErlaubt = (fehler: PageFehler, titel: string, liste: readonly ErlaubnisEintrag[]): boolean =>
    liste.some((eintrag) => eintrag.titel.test(titel) && eintrag.text.test(fehler.text))

/**
 * Die Verstöße unter den gesehenen Fehlern — in Reihenfolge des Auftretens, keine
 * Deduplizierung (anders als beim Relay-Wächter: zwei IDENTISCHE Fehlermeldungen sind
 * hier meist zwei verschiedene betroffene Elemente, z. B. eine ganze `x-for`-Liste, und
 * genau diese Häufung ist Teil der Diagnose).
 */
export const verstoesse = (
    gesehen: readonly PageFehler[],
    titel: string,
    liste: readonly ErlaubnisEintrag[],
): PageFehler[] => gesehen.filter((fehler) => !istErlaubt(fehler, titel, liste))

/**
 * Die Meldung. Nennt Test, Quelle und Text jedes Verstoßes — ein Wächter, der nur
 * „failed" sagt, kostet eine Debug-Runde, und die ist teurer als er selbst.
 */
export const pageFehlerMeldung = (titel: string, treffer: readonly PageFehler[]): string =>
    [
        `Laufzeit-Wächter: dieser Test hat einen JavaScript-Fehler im Browser ausgelöst.`,
        `  Test:    ${titel}`,
        `  Fehler:`,
        ...treffer.map((f) => `    [${f.quelle}] ${f.text}`),
        ``,
        `  Ist der Fehler beabsichtigt (ein Test, der einen Fehlerpfad prüft), dann trage ihn`,
        `  in die ERLAUBNISLISTE in pageErrorGuard.ts ein — mit Test- UND Text-Muster, sonst`,
        `  deckt der Eintrag auch unverwandte Fehler ab.`,
        `  Ist er es nicht, ist das ein echter Produktfehler — siehe den Anlassfall im Kopf`,
        `  dieser Datei (⚡forge-repo.blade.php:1224, 935e9d3).`,
    ].join('\n')

/**
 * ── Netzwerk-/Werkzeug-Rauschen — gefiltert VOR der Aufzeichnung, nicht danach ───────
 *
 * Gemessen an der VOLLEN Suite (649 Tests, chromium+desktop, 2026-08-28, vor dem
 * Scharfschalten): 37 Tests lösten einen `console`/`pageerror`-Eintrag aus. 33 davon
 * waren KEIN Anwendungsfehler, sondern automatische Chromium- bzw. Boost-Meldungen, die
 * als Nebenwirkung ABSICHTLICH herbeigeführter Testszenarien entstehen (kaputte
 * Bild-Proxies, tote Relays, falsche Ports, verweigerte Zugriffe — je einzeln in den
 * betroffenen Specs assertiert). Eine Erlaubnisliste mit 33 Einzeleinträgen wäre keine
 * Kuratierung mehr, sondern ein zweites, unlesbares Testprotokoll. Gefiltert wird deshalb
 * NACH MUSTER, nicht nach Test — mit der Konsequenz, die jedes Muster unten benennt.
 *
 * **Nur `console`, nie `pageerror`:** ein fehlgeschlagener Ressourcen-Ladevorgang oder ein
 * geschlossener WebSocket ist niemals eine uncaught exception; `pageerror` bleibt davon
 * unberührt und ungefiltert.
 */
export const RAUSCH_MUSTER: { muster: RegExp; begruendung: string; blind_fuer: string }[] = [
    {
        muster: /^Failed to load resource:/,
        begruendung:
            'Chromiums automatische Meldung für JEDEN gescheiterten Ressourcen-Request (Bild, Fetch, …) — ' +
            '30 von 37 Treffern der Messung, ausnahmslos aus Specs, die eine kaputte Bildquelle, einen toten ' +
            'Relay-HTTP-Endpunkt oder eine abgelehnte Anfrage absichtlich herstellen und selbst assertieren.',
        blind_fuer:
            'ein Request an eine falsche URL durch einen echten Bug in der App — dafür bräuchte es eine eigene ' +
            'Netzwerk-Assertion (page.route/page.on("response")), keinen Konsolen-Wächter.',
    },
    {
        muster: /^WebSocket connection to .* failed:/,
        begruendung:
            'Chromiums automatische Meldung für einen gescheiterten WebSocket-Handshake — ausschließlich aus ' +
            'den Selbsttests des Relay-Wächters/der Prävention (relay-guard, relay-praevention) sowie Specs, ' +
            'die einen absichtlich toten Socket verwenden (stubDeadSpace, SILENT_BOARD_PORT); der Relay-Wächter ' +
            '(relayGuard.ts) urteilt über GENAU diese Verbindungen bereits eigenständig.',
        blind_fuer:
            'ein WebSocket, der an eine falsche Herkunft geht, OHNE dass der Relay-Wächter es sieht — dieser Fall ' +
            'ist der Zuständigkeitsbereich von relayGuard.ts, nicht dieser Datei.',
    },
    {
        muster: /^Failed to send logs:/,
        begruendung:
            "Laravel Boosts `BrowserLogger` (vendor/laravel/boost) spiegelt Konsolen-Aktivität an einen " +
            'MCP-Endpunkt und meldet per `console.error`, wenn dieser Endpunkt in der E2E-Umgebung nicht ' +
            'erreichbar ist (`TypeError: Failed to fetch`) — ein Dev-Werkzeug-Artefakt ohne Bezug zur App.',
        blind_fuer:
            'einen ECHTEN Fehler, den Boosts eigener Logger-Wrapper selbst auslöst — theoretisch möglich, in der ' +
            'Messung kein einziges Mal beobachtet (Boost meldet fremde Fehler, produziert sie nicht selbst).',
    },
]

/** Ist dieser Konsolen-Text reines Netzwerk-/Werkzeug-Rauschen? Siehe {@link RAUSCH_MUSTER}. */
export const istRauschen = (text: string): boolean => RAUSCH_MUSTER.some(({ muster }) => muster.test(text))

/**
 * ── Die Erlaubnisliste — ABSICHTLICH provozierte Fehler, je mit Begründung ──────────
 *
 * Aus derselben Messung: genau EIN Test provoziert einen `pageerror` als eigene, benannte
 * Positivkontrolle. Die drei ÜBRIGEN echten `pageerror`-Treffer der Messung
 * (`forge-ueberlauf.spec.ts`, „Cannot read properties of null (reading 'showPanel')") sind
 * KEIN Eintrag hier — sie sind ein gemeldeter Produktfehler (siehe Bericht) und bleiben
 * nach dem Scharfschalten bewusst rot.
 */
export const ERLAUBNISLISTE: ErlaubnisEintrag[] = [
    {
        titel: /forge-zeitleiste-knoten\.spec\.ts.*KONTROLLE: der Sammler sieht einen echten Alpine-Fehler/,
        text: /gibtEsNichtUndWirftDeshalb is not defined/,
        begruendung:
            'Positivkontrolle des lokalen Fehler-Sammlers in forge-zeitleiste-knoten.spec.ts: ohne einen ' +
            'tatsächlich ankommenden Fehler wären die vier Zusagen darüber vakuum-grün (siehe Kommentar dort).',
    },
    {
        titel: /page-error-guard\.spec\.ts.*Standard-Seite: ein absichtlich ausgelöster Fehler wird beobachtet/,
        text: /SELBSTTEST-page-error-guard/,
        begruendung: 'Selbstnachweis dieses Wächters (page-error-guard.spec.ts): Wiring über `page`.',
    },
    {
        titel: /page-error-guard\.spec\.ts.*Selbst angelegter Kontext \(browser\.newContext\)/,
        text: /SELBSTTEST-page-error-guard/,
        begruendung:
            'Selbstnachweis dieses Wächters (page-error-guard.spec.ts): Wiring über einen von `browser.newContext()` ' +
            'selbst geöffneten Kontext — die Lücke, an der eine naive `page`-only-Fassung blind wäre.',
    },
]
