/**
 * **Ein einziger Ort für die Server-ENV der Testläufe.**
 *
 * Jeder `php artisan serve` und jeder `php artisan tinker` eines E2E-Laufs erbt
 * `process.env` — und `playwright.config.ts` lädt vorher mit `process.loadEnvFile('.env')`
 * die lokale `.env` genau dorthin. Steht dort eine Produktions-Relay-Adresse (und `.env.example` führt jede
 * dieser Variablen, dieses Vorhaben ist der Anlass, sie zu setzen), dann spricht der
 * SERVER sie an: beim Rendern der Artikel-Einstiege, beim Profil-Abruf, bei der
 * Forge-Fläche. **Der Relay-Wächter sieht davon nichts** — er hört an
 * `page.on('websocket')` und damit ausschließlich am Browser. Für diese Klasse ist der
 * ENV-Riegel die einzige Verteidigung.
 *
 * ── Warum das ein Helfer ist und keine drei Kopien ──────────────────────────────────
 *
 * Weil die Kopien zweimal auseinandergelaufen sind, beide Male unbemerkt vom Test und
 * beide Male von einem Menschen beim Lesen gefunden: in P0 fehlte `NOSTR_BOARD_URL`, in
 * P5 `NOSTR_WORKSPACE_URL`. Die Liste ist inzwischen auf **sieben** Schlüssel gewachsen,
 * und in P6 kam mit `NOSTR_ARTICLE_METRIC_RELAYS` der dritte neue in drei Phasen dazu.
 *
 * Und die Zeilennummern, über die sie bis hierher von Hand geführt wurde, sind allein
 * zwischen P5 und P6 verrutscht: `NOSTR_PROFILE_INDEXER` stand im P5-Bericht auf
 * `config/group.php:117`, in P6 auf `:135` und liegt heute auf `:185` — in einer Datei,
 * die im **Paket** wohnt (`packages/einundzwanzig-group/config/group.php`) und die ein
 * `grep` vom Host-Wurzelverzeichnis wegen `.gitignore` gar nicht findet. Eine Handliste
 * kann das nicht einholen; `serverEnv.nodetest.ts` gewinnt sie deshalb aus `config/`.
 *
 * ── Was hier NICHT drinsteht ────────────────────────────────────────────────────────
 *
 * `NOSTR_TEST_NSEC`. Der Testschlüssel wird von den Tests gebraucht, nicht vom Server;
 * ihn hier zu neutralisieren nähme dem Login-Pfad seinen Gegenstand. Der Schlüssel hat
 * seinen eigenen Riegel (`schluesselSperre.ts`), und der prüft, WELCHER Schlüssel es ist.
 */
import { ZOOID_BASE_PORT } from './relayGuard.ts'

/** Wohin die Relay-Variablen eines Test-`serve` zeigen dürfen. */
export type ServerEnvOptionen = {
    /** `workerInfo.parallelIndex + E2E_SLOT_OFFSET` — bestimmt den worker-eigenen zooid. */
    slot: number
    /**
     * Ob die ARTIKEL-Quellen (`NOSTR_BOARD_URL`, `NOSTR_ARTICLE_METRIC_RELAYS`) auf den
     * worker-eigenen Relay zeigen statt leer zu bleiben.
     *
     * Default `false` — und das ist die wichtigere Hälfte: leer heißt hier NICHT
     * „Default", sondern die Fläche zeigt ihren ehrlichen „keine Quelle"-Zustand und
     * schickt keinen einzigen REQ. Genau diesen Zustand hat die Bestandssuite immer
     * gemessen; der Riegel hält ihn fest, statt ihn der `.env` des jeweiligen Rechners
     * zu überlassen. `board-fixtures.ts` setzt `true` und bekommt damit eine echte, aber
     * LOKALE Quelle.
     */
    mitBoard?: boolean
    /**
     * Ob `NOSTR_WORKSPACE_URL` LEER bleibt statt auf den worker-eigenen Relay zu zeigen.
     *
     * Default `false` — der Normalfall ist die gesetzte Adresse, Begründung unten an der
     * Variablen selbst. `true` braucht genau ein Test: `desktop-boot-geometrie.spec.ts`
     * misst die Rail-Fußzeile in der Lage OHNE Workspace, und ob die Forge-Zeile dort
     * existiert, entscheidet der Server beim Rendern.
     *
     * **Warum das eine Option des Helfers ist und keine Zeile im Spec.** Ein
     * handgeschriebenes `NOSTR_WORKSPACE_URL: ''` neben dem Spread wäre die vierte Kopie
     * der Liste, gegen die der Kopf dieser Datei geschrieben ist — und `serverEnv.nodetest.ts`
     * verbietet die Form ausdrücklich. Die Ausnahme gehört dorthin, wo die Regel steht.
     */
    ohneWorkspace?: boolean
}

/**
 * Die vollständige ENV-Überlagerung für einen Test-`serve`.
 *
 * Aufruf: `env: { ...process.env, ...testServerEnv({ slot }) }`. Die Reihenfolge ist
 * tragend — die Überlagerung muss NACH `...process.env` stehen, sonst gewinnt die `.env`
 * des Rechners.
 */
export const testServerEnv = ({ slot, mitBoard = false, ohneWorkspace = false }: ServerEnvOptionen): Record<string, string> => {
    const workerRelay = `ws://localhost:${ZOOID_BASE_PORT + slot}`
    const artikelQuelle = mitBoard ? workerRelay : ''

    return {
        // ── Nicht-Relay-Einstellungen des Test-`serve` ──────────────────────────────
        //
        // Kein Vite-Dev-Server im Testlauf: das gebaute Bundle ist der Prüfgegenstand.
        VITE_HOT_FILE: '/tmp/e2e-vite-never-hot',
        // Die sechs parallelen `serve` teilen sich eine SQLite (der NIP-98-Login-Handoff
        // legt den k1-Challenge im DB-Cache ab und liest ihn beim POST wieder). WAL lässt
        // Leser den Schreiber nicht blockieren, `busy_timeout` wartet kurz auf das
        // Schreib-Lock statt sofort „database is locked" zu melden. Rein additiv über
        // env — prod bleibt bei null (`config/database.php`).
        DB_JOURNAL_MODE: 'WAL',
        DB_BUSY_TIMEOUT: '5000',
        // Der PHP-Built-in-Server serialisiert sonst schon HTML- + Asset-Chunk-Requests
        // EINES Seitenaufbaus.
        PHP_CLI_SERVER_WORKERS: '4',

        // ── Die Relay-Variablen ────────────────────────────────────────────────────
        //
        // Leer: `ProfileCache` (GET /nostr/profiles) fragt sonst `wss://purplepag.es/` —
        // eine echte WebSocket-Verbindung ins öffentliche Internet, aus jedem Testlauf.
        NOSTR_PROFILE_INDEXER: '',
        // Der „eigene Space" ist im Test der WORKER-Relay, nicht der Mitschau-zooid aus
        // der lokalen `.env`: sonst fragte der Server :3334 nach Profilen, die nur auf
        // :3335+ liegen, und schriebe „abwesend" (24 h) in den geteilten Cache-Store.
        NOSTR_SPACE_URL: workerRelay,
        // Die Artikel-Quelle. Begründung für den Default `''` an {@link ServerEnvOptionen}.
        NOSTR_BOARD_URL: artikelQuelle,
        // Die Relays der SOZIALSIGNALE (P6). `js/longformFeed.ts` (`SEKUNDAER_RELAYS`)
        // fragt die Zähler kind 7/9735/1111 auf FREMDEN Relays ab; stünden die Adressen
        // als Literal im Code, öffnete jeder Lauf eine Verbindung nach `wss://nos.lol`.
        // Jeder Test, der eine Artikelfläche berührt, wäre dann rot — aus einem Grund,
        // der wie ein Regress aussieht.
        NOSTR_ARTICLE_METRIC_RELAYS: artikelQuelle,
        // Der WORKSPACE zeigt auf den worker-eigenen zooid und ist NICHT leer: leer
        // schaltete die Forge-Fläche in jedem Lauf ab, und die Specs, die sie brauchen
        // (`workspaces.spec.ts`), hätten keinen Gegenstand mehr. Seit P5 entscheidet
        // dieser Wert über MARKUP — Ortskarte „Forge", Forge-Zeile der Rail-Fußzeile,
        // vierter Tab auf `/forge`. Ohne ihn rendert dieselbe Spec auf einem Rechner mit
        // `.env`-Eintrag anders als auf einem ohne, und kein Test sagt einem das.
        NOSTR_WORKSPACE_URL: ohneWorkspace ? '' : workerRelay,
        // ── Und die beiden, die heute noch folgenlos sind ───────────────────────────
        //
        // `NOSTR_BOT_NSEC`/`NOSTR_BOT_RELAY` liest bisher nur
        // `app/Console/Commands/BotAnnounce.php` — keine Route, kein `Artisan::call` im
        // HTTP-Pfad, kein Scheduler-Eintrag. Sie stehen trotzdem hier: die Aussage
        // „console-only" kippt bei der ERSTEN Route, die den Command aufruft, und dann
        // trüge ein Testlauf den Produktions-Bot-Schlüssel im Server-Prozess. Ein Riegel,
        // der erst nach dem Schaden ergänzt wird, ist keiner.
        //
        // Der leere `NOSTR_BOT_NSEC` ist zusätzlich die zweite Hälfte des
        // Schlüssel-Riegels: was der Server nicht sieht, kann er nicht signieren.
        NOSTR_BOT_NSEC: '',
        NOSTR_BOT_RELAY: '',
    }
}
