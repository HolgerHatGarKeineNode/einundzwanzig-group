#!/usr/bin/env bash
# Bereitet den ISOLIERTEN Buzz-TEST-Stack (Docker-Compose-Projekt `buzz-test`, Relay auf
# :3001) für die E2E-Tests vor: eigener Postgres/Redis/MinIO, eigene Volumes, eigenes
# Netzwerk — alles per Compose-Projektname automatisch von `buzz-prod` (dem MITSCHAU-Stack
# auf :3000, /home/user/Code/buzz/deploy/compose) getrennt. Der Mitschau-Stack wird von
# diesem Skript NIE gestoppt/neu konfiguriert/geseedet — es referenziert dessen compose.yml
# nur LESEND (kein Edit im Buzz-Repo).
#
# Pendant zu zooid-testserver.sh — löst dieselben zwei Dauerprobleme:
#   1) Bind-vor-Seed-Race: das Skript verifiziert am Ende (Raum + Nachricht per
#      authentifiziertem REQ abrufbar) und kehrt erst DANN zurück.
#   2) Bloat: ein Cap auf die Nachrichten im „welcome"-Testraum; wird er überschritten,
#      reißt das Skript den Stack MIT Volumes ein (`down -v`, NUR Projekt buzz-test) und
#      baut ihn frisch auf.
#
# Aufgerufen aus global-setup.ts wenn E2E_RELAY=buzz (einmalig, nicht pro Worker — der
# Buzz-Stack ist ein geteilter Docker-Stack, kein per-Worker-Prozess wie zooid).
set -uo pipefail
export PATH="$PATH:/home/user/go/bin"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_BASE="$SCRIPT_DIR/buzz-compose"
BUZZ_REPO_COMPOSE=/home/user/Code/buzz/deploy/compose/compose.yml   # NUR gelesen, nie editiert.
# EIN Compose-Projekt JE PORT — so bekommt jeder Playwright-Worker seinen eigenen
# Stack (eigene Volumes, eigenes Netz) und die Suite laeuft parallel statt seriell.
# Nur der Relay veroeffentlicht einen Host-Port (compose.yml: BUZZ_HTTP_PORT), die
# uebrigen Container bleiben im Projekt-Netz — deshalb kollidiert nichts.
PROJECT="buzz-test-${BUZZ_TEST_PORT:-3001}"

# shellcheck disable=SC1091
source "$COMPOSE_BASE/test-keys.env"   # OWNER_SEC/OWNER_PUB/USER_SEC/USER_PUB (Wegwerf, s. dort)

BUZZ_PORT="${BUZZ_TEST_PORT:-3001}"
R="ws://localhost:$BUZZ_PORT"
# Der `php artisan serve` desselben Workers (fixtures.ts: 8137 + slot, buzz: 3001 + slot).
SERVE_PORT=$(( 8137 + BUZZ_PORT - 3001 ))

# EIGENE .env JE SLOT — nicht verhandelbar, und der Grund ist unsichtbar:
# `compose.yml` reicht die Relay-Konfiguration ueber `env_file: - .env` in den
# Container. Eine Shell-Variable erreicht davon NICHTS; sie wirkt nur auf die
# Interpolation im Compose-File selbst (deshalb stimmte der veroeffentlichte Port,
# waehrend `BUZZ_DOMAIN` weiter auf :3001 zeigte). Der Relay beantwortete dann NIP-11
# ueber HTTP und verweigerte den WebSocket-Upgrade mit 404 — Stack sieht gesund aus,
# liefert aber keine Raeume. Gemessen beim ersten Parallel-Versuch auf :3002.
#
# `env_file`-Pfade loest Compose gegen `--project-directory` auf ⇒ je Slot ein eigenes
# Verzeichnis mit eigener .env. Die Basis-.env bleibt unveraendert.
COMPOSE_DIR="$COMPOSE_BASE/slot-$BUZZ_PORT"
mkdir -p "$COMPOSE_DIR"
sed -E \
    -e "s#^BUZZ_HTTP_PORT=.*#BUZZ_HTTP_PORT=$BUZZ_PORT#" \
    -e "s#^BUZZ_DOMAIN=.*#BUZZ_DOMAIN=localhost:$BUZZ_PORT#" \
    -e "s#^RELAY_URL=.*#RELAY_URL=ws://localhost:$BUZZ_PORT#" \
    -e "s#^BUZZ_MEDIA_BASE_URL=.*#BUZZ_MEDIA_BASE_URL=http://localhost:$BUZZ_PORT/media#" \
    -e "s#^BUZZ_MEDIA_SERVER_DOMAIN=.*#BUZZ_MEDIA_SERVER_DOMAIN=localhost:$BUZZ_PORT#" \
    -e "s#^BUZZ_CORS_ORIGINS=.*#BUZZ_CORS_ORIGINS=http://127.0.0.1:$SERVE_PORT,http://localhost:$SERVE_PORT#" \
    "$COMPOSE_BASE/.env" > "$COMPOSE_DIR/.env"

# Ratenbegrenzer aus dem Messpfad nehmen — und zwar HIER, nicht in der Basis-.env:
# die ist per `.gitignore` (Regel `.env`) nicht versioniert, eine Aenderung dort waere
# auf dem naechsten Rechner weg. Genau so ging der erste Versuch schief: die Werte
# standen in der SLOT-.env, die dieses `sed` bei jedem Lauf neu erzeugt — sie erreichten
# den Container nie, der Test blieb rot, und die Hypothese galt kurz als widerlegt.
# `docker exec … env | grep RATE_LIMIT` war die Probe, die das aufdeckte.
#
# Warum ueberhaupt: Buzz deckelt WebSocket-Frames auf `human_ws_events_per_sec` x 5 s
# (Default 10 => 50 Frames je 5 s je Pubkey, `admission.rs:9,40`) und Events zusaetzlich
# auf `human_messages_per_min` (Default 60). Greift der Deckel, antwortet der Relay auf
# ein EVENT mit einer nackten NOTICE statt mit einem OK (`connection.rs:632-650`,
# `sub_id: None`) — der Client bekommt nie ein Verdikt. Genau das trug den
# `buzz-moderation:95`-Flake (vorher ~1 von 4 rot, mit diesen Werten 6 von 6 gruen).
#
# Das ist eine Testfixture-Entscheidung, KEIN Freibrief: dass unser Client beim
# Seitenaufbau Bursts ueber 50 Frames faehrt (eine REQ je Profil, Raum-Sub mehrfach neu
# aufgesetzt), bleibt ein offener Client-Befund. Er wird hier nur aus dem Messpfad
# genommen, nicht behoben — sonst maesse jede Buzz-Spec den Begrenzer statt ihres Themas.
cat >> "$COMPOSE_DIR/.env" <<'RATELIMITS'

BUZZ_RATE_LIMIT_HUMAN_WS_EVENTS_PER_SEC=500
BUZZ_RATE_LIMIT_HUMAN_MESSAGES_PER_MIN=6000
RATELIMITS

# Lauf-Marker wie bei zooid (dort `RUNMARK`): Startet Playwright einen Worker nach einem
# Test-Fehlschlag NEU, laeuft dieses Skript fuer denselben Slot ein zweites Mal. Ohne
# Schutz reisst es dabei den eigenen, noch laufenden Stack ab und baut ihn neu — und
# genau daran ist der erste Parallel-Versuch gescheitert: reihenweise
# `Bind for 0.0.0.0:3001 failed: port is already allocated`, 53 rote Tests, darunter
# reine Logik-Specs, die nie einen Relay anfassen (die Seite selbst kam nicht hoch).
# global-setup.ts loescht die Marker zu Lauf-Beginn.
RUNMARK="/tmp/e2e-buzz-$BUZZ_PORT.run"
# Herzschlag wie bei zooid (siehe dort) — bei JEDEM Aufruf berührt, unabhängig vom
# `flock` weiter unten (der serialisiert nur den AUFBAU mehrerer Worker, nicht den
# Herzschlag selbst).
ALIVE="/tmp/e2e-buzz-$BUZZ_PORT.alive"
touch "$ALIVE"

# AUFBAU SERIALISIEREN. Vier Worker starten ihre Stacks gleichzeitig — das sind vier
# Postgres-Initialisierungen, vier MinIO-Buckets und vier Relay-Migrationen auf einmal.
# Beim ersten Parallel-Lauf scheiterten daran 13 von 18 roten Tests mit
# `Command failed: buzz-testserver.sh`; die Tests selbst waren nie das Problem, ihr
# Worker kam nur nicht hoch. Der Lock haelt nur den AUFBAU auseinander — laeuft ein
# Stack erst, arbeiten die Worker wieder voll parallel.
#
# `flock` ohne Zeitlimit ist hier richtig: Warten ist billig, ein halb aufgebauter
# Stack ist teuer. Der Aufbau eines Slots dauert gemessen ~30 s.
LOCK=/tmp/e2e-buzz-setup.lock
if [ -z "${BUZZ_SETUP_LOCKED:-}" ]; then
    export BUZZ_SETUP_LOCKED=1
    exec flock "$LOCK" "$0" "$@"
fi
HTTP="http://localhost:$BUZZ_PORT"

# Zwei feste Test-Räume (UUIDv5, Namespace + Ableitung wie Prod-Meetups: uuid5(NS,
# "meetup:<slug>") — auch für diese generischen E2E-Räume beibehalten, weil GENAU
# dieses Format am laufenden Relay gemessen wurde; ein freier uuid4 ist ungetestet).
NS=d3a2a246-e0b6-45be-a1c4-367c2bd857ad
WELCOME_H=$(python3 -c "import uuid,sys; print(uuid.uuid5(uuid.UUID('$NS'), 'meetup:e2e-welcome'))")
GENERAL_H=$(python3 -c "import uuid,sys; print(uuid.uuid5(uuid.UUID('$NS'), 'meetup:e2e-general'))")
# Dritter Testraum (P3): ein FORUM-Kanal. Er entsteht wie die anderen per 9007,
# nur mit `["channel_type","forum"]` — der Relay macht daraus ein 39000 mit
# `["t","forum"]` (`side_effects.rs:1096`, am Stack nachgemessen). Dieselbe
# UUIDv5-Ableitung wie oben, damit auch dieser Seed beim zweiten Lauf ein
# `duplicate: channel already exists` erzeugt statt eines zweiten Kanals.
FORUM_H=$(python3 -c "import uuid,sys; print(uuid.uuid5(uuid.UUID('$NS'), 'meetup:e2e-forum'))")
# Vierter Testraum (N1): ein PRIVATES Forum — die Lage des Nutzers.
#
# Sein echtes Forum ist bewusst privat (er laedt von Hand ein); P3 war nur an
# einem OFFENEN Forum belegt. Der Unterschied ist am Relay gemessen und liegt an
# genau EINEM Tag am 9007: `["visibility","private"]` (Default ist `open`,
# `ingest.rs:2596-2607` liest ihn schon vor der Speicherung, `side_effects.rs:1768`
# noch einmal). Der Relay macht daraus ein 39000 mit `["private"]` statt
# `["public"]` — gemessen am Stack :3005 am 2026-08-18:
#
#   offen:  [["d",…],["name","E2E-Forum"],…,["public"],["closed"],["t","forum"]]
#   privat: [["d",…],["name","E2E-Forum-Privat"],…,["private"],["closed"],["t","forum"]]
#
# `["closed"]` traegt JEDER Buzz-Kanal (`side_effects.rs:1974`, „Buzz channels
# always require explicit membership") — es ist deshalb KEIN Privatheits-Merkmal.
PRIV_FORUM_H=$(python3 -c "import uuid,sys; print(uuid.uuid5(uuid.UUID('$NS'), 'meetup:e2e-forum-privat'))")

# welcome-Seed-Baseline (wie zooid: WELCOME_SEED) — Bloat-Guard.
WELCOME_SEED_CAP=10
# Kanal-Baseline: der Seed legt GENAU 2 Kanaele an (welcome + general).
#
# **Der welcome-Guard darueber sieht Raeume nicht** — und genau daran ist der Stack ueber
# Wochen gewachsen. Am 2026-07-31 in der Postgres nachgezaehlt, nach Alter sortiert:
#
#   25 min alt →  4 Kanaele,  62 Events
#   25 min alt →  7 Kanaele,  92 Events
#    8 h  alt →  9 Kanaele, 135 Events
#    9 h  alt → 10 Kanaele, 215 Events
#
# Monoton steigend, ohne Obergrenze: jeder Test, der sich einen Raum anlegt und ihn nicht
# per 9008 abraeumt, bleibt liegen, solange `welcome` sauber ist.
#
# Die Toleranz ist bei Buzz KLEINER als bei zooid (4 statt 6), obwohl der Reset hier
# teurer ist (~40 s Docker-Neuaufbau gegen wenige Sekunden). Grund: Buzz deckelt Frames
# (50 je 5 s je Pubkey, siehe relayNotices.ts im Package) — ein aufgeblaehter Kanalbestand
# vergroessert die Raumliste, damit die `#h`-Filter und damit den Frame-Verbrauch. Hier
# kostet Muell nicht nur Platz, sondern Messgenauigkeit.
# Seit P3 sind es DREI: welcome + general + forum. Seit N1 VIER — das private
# Forum kommt dazu. Es zaehlt in dieser Messung mit, weil `stack_seeded_and_clean`
# mit USER_SEC liest und der USER dort Kanalmitglied ist; fuer einen
# Nicht-Kanalmitglied-Schluessel waeren es weiterhin drei (gemessen).
CHANNEL_SEED=4
CHANNEL_CAP=$((CHANNEL_SEED + 4))

compose() {
    # BUZZ_GIT_CONFORMANCE_PROBE=false gehoert hierher und nicht in die (gitignorierte)
    # .env: Die A3-Probe schlaegt auf einem frisch per `down -v` geleerten git-Volume
    # fehl und beendet den Relay mit Exit 0 — der Stack liesse sich danach nie wieder
    # aufsetzen, und der Grund stuende in einer Datei, die niemand sonst hat.
    # Git-Hosting wird in diesen Tests nicht benutzt.
    #
    # ALLE port-tragenden Werte muessen dem Slot folgen, nicht nur der veroeffentlichte
    # Port. `BUZZ_DOMAIN` ist der gefaehrlichste: passt er nicht zeichengenau, beantwortet
    # der Relay zwar NIP-11 ueber HTTP, verweigert aber den WebSocket-Upgrade mit 404 —
    # der Stack sieht dann gesund aus und liefert trotzdem keine Raeume. Genau daran ist
    # der erste Versuch mit Port 3002 gescheitert (Verifikation rot, Relay-Logs sauber).
    # Shell-Env schlaegt --env-file, die .env bleibt unveraendert.
    BUZZ_GIT_CONFORMANCE_PROBE=false \
        docker compose -p "$PROJECT" -f "$BUZZ_REPO_COMPOSE" --project-directory "$COMPOSE_DIR" --env-file "$COMPOSE_DIR/.env" "$@"
}

# Läuft schon ein sauberer, geseedeter, nicht aufgeblähter buzz-test-Stack? → wiederverwenden.
stack_seeded_and_clean() {
    timeout 5 curl -sf -H 'Accept: application/nostr+json' "$HTTP" >/dev/null 2>&1 || return 1
    # Letztes Seed-Artefakt: die general-Nachricht (als Relay-Member abrufbar).
    timeout 8 nak req -k 9 -t "h=$GENERAL_H" --auth --sec "$USER_SEC" "$R" 2>/dev/null | grep -q 'E2E-Buzz-general' || return 1
    # Forum-Seed (P3): ohne ihn ist der Stack aus einem AELTEREN Lauf und die
    # Forum-Spec liefe gegen einen Kanal, den es nicht gibt — ein Rot, dessen
    # Ursache im Stack liegt und nicht im Code. Deshalb hier und nicht nur unten.
    timeout 8 nak req -k 45001 -t "h=$FORUM_H" --auth --sec "$USER_SEC" "$R" 2>/dev/null | grep -q 'E2E-Forum-Thema' || return 1
    # Privates Forum (N1) — derselbe Grund wie eine Zeile darueber, plus einer:
    # ein Stack aus einem AELTEREN Lauf kennt den Kanal gar nicht, und die
    # Privat-Faelle liefen dann gegen ein Nichts. Geprueft wird das THEMA, nicht
    # der Kanal: nur das Thema beweist zugleich, dass der USER dort Kanalmitglied
    # ist (ohne 9000 antwortet der Relay mit `restricted: not a channel member`).
    timeout 8 nak req -k 45001 -t "h=$PRIV_FORUM_H" --auth --sec "$USER_SEC" "$R" 2>/dev/null | grep -q 'E2E-Privatforum-Thema' || return 1
    local n
    n=$(timeout 8 nak req -k 9 -t "h=$WELCOME_H" --auth --sec "$USER_SEC" "$R" 2>/dev/null | grep -c '"kind":9')
    [ "${n:-999}" -le "$WELCOME_SEED_CAP" ] || return 1
    # Zweiter Bloat-Waechter: die KANAL-Zahl. Siehe CHANNEL_CAP oben.
    local c
    c=$(timeout 8 nak req -k 39000 --auth --sec "$USER_SEC" "$R" 2>/dev/null | grep -c '"kind":39000')
    if [ "${c:-999}" -gt "$CHANNEL_CAP" ]; then
        echo "buzz-test:$BUZZ_PORT hat $c Kanaele (Seed=$CHANNEL_SEED, Grenze=$CHANNEL_CAP) → Reset"
        return 1
    fi
}

# Zweiter Aufruf INNERHALB desselben Laufs → nur pruefen, ob der Stack noch da ist.
if [ -f "$RUNMARK" ] && timeout 5 curl -sf -H 'Accept: application/nostr+json' "$HTTP" >/dev/null 2>&1; then
    echo "buzz-test:$BUZZ_PORT laeuft bereits in diesem Lauf → unangetastet (Kaskaden-Schutz)"
    exit 0
fi

if stack_seeded_and_clean; then
    touch "$RUNMARK"
    echo "buzz-test:$BUZZ_PORT bereits sauber geseedet → Wiederverwendung (kein Reset)"
    exit 0
fi

# Aufsetzen: NUR das buzz-test-Projekt anfassen (down -v killt NUR dessen Container +
# NUR dessen `buzz-test_*`-Volumes — buzz-prod bleibt unberührt, siehe Volumen-Verifikation
# unten). Erst nötig, wenn ein vorheriger Lauf da war UND aufgebläht/kaputt ist.
compose down -v >/dev/null 2>&1 || true

compose up -d --wait
UP_RC=$?
if [ "$UP_RC" -ne 0 ]; then
    echo "buzz-test: compose up --wait fehlgeschlagen (rc=$UP_RC) — Logs:" >&2
    compose logs --tail=60 relay >&2
    exit 1
fi

# Volumen-Isolation ausdrücklich verifizieren (nicht nur behaupten): buzz-test-Volumes
# müssen existieren UND dürfen mit KEINEM buzz-prod-Volume-Namen kollidieren.
TEST_VOLS=$(docker volume ls --format '{{.Name}}' | grep "^${PROJECT}_" | sort)
PROD_VOLS=$(docker volume ls --format '{{.Name}}' | grep '^buzz-prod_' | sort)
if [ -z "$TEST_VOLS" ]; then
    echo "buzz-test: KEINE eigenen Volumes gefunden — Isolation nicht gegeben, Abbruch." >&2
    exit 1
fi
echo "buzz-test-Volumes: $(echo "$TEST_VOLS" | tr '\n' ' ')"
echo "buzz-prod-Volumes (Mitschau, unberührt): $(echo "$PROD_VOLS" | tr '\n' ' ')"
# Namen tragen selbst immer den Projekt-Präfix (buzz-test_ vs buzz-prod_) und können
# sich daher nie als FULL NAME überschneiden — die eigentliche Probe ist, ob die
# Postgres-Datenverzeichnisse (Mountpoints) physisch verschieden sind. Gleicher
# Mountpoint würde bedeuten: derselbe Datenbestand trotz getrennter Compose-Projekte.
TEST_MOUNT=$(docker volume inspect "${PROJECT}_buzz-postgres-data" --format '{{.Mountpoint}}' 2>/dev/null)
PROD_MOUNT=$(docker volume inspect buzz-prod_buzz-postgres-data --format '{{.Mountpoint}}' 2>/dev/null)
if [ -z "$TEST_MOUNT" ] || [ "$TEST_MOUNT" = "$PROD_MOUNT" ]; then
    echo "buzz-test: Postgres-Mountpoint identisch mit/fehlt gegenüber buzz-prod ($TEST_MOUNT vs $PROD_MOUNT) — Isolation verletzt, Abbruch." >&2
    exit 1
fi
echo "buzz-test: Volumen-Isolation verifiziert — eigener Mountpoint ($TEST_MOUNT, buzz-prod: $PROD_MOUNT)."

# Auf NIP-11 warten (Relay oben, healthcheck von --wait bereits abgedeckt, hier zusätzlich
# auf den öffentlichen Port pollen für den Fall einer Healthcheck/Netzwerk-Diskrepanz).
for _ in $(seq 1 60); do
    curl -sf -H 'Accept: application/nostr+json' "$HTTP" >/dev/null 2>&1 && break
    sleep 0.5
done

# Publiziert ein Seed-Event mit Zeitlimit UND Wiederholung.
#
# Warum beides: `nak event` kennt kein eigenes Zeitlimit und blockiert unbegrenzt, wenn es
# direkt nach `docker compose down -v` in das WebSocket-Bind-Fenster des Relays läuft
# (gemessen 2026-07-28: ein Lauf hing ~9 min; derselbe Publish danach <1 s). Der NIP-11-Poll
# oben deckt das nicht ab — er spricht HTTP, der Seed spricht WebSocket, und die beiden
# binden nicht zwingend gleichzeitig.
#
# Ein blosses `timeout` wäre die schlechtere Hälfte des Fixes: der Publish fiele still aus
# (`|| true`), der Seed bliebe leer und die Specs schlügen mit einem irreführenden
# „Raum nicht sichtbar" fehl. Deshalb wird NUR ein Zeitlimit-Treffer (Exit 124) wiederholt —
# ein fachlicher Fehlschlag wie "duplicate: channel already exists" ist beim zweiten Lauf
# der Normalfall und darf nicht in fünf Wiederholungen laufen.
seed_event() {
    for _ in $(seq 1 5); do
        timeout 10 nak event "$@" >/dev/null 2>&1
        [ $? -ne 124 ] && return 0
        sleep 1
    done
    echo "buzz-test: Seed-Event nach 5 Zeitlimit-Treffern aufgegeben — Relay bindet nicht." >&2
    return 0
}

# Räume (kind 9007). h = UUIDv5, name Pflicht-Tag. Owner = RELAY_OWNER_PUBKEY (bootstrap_owner
# hebt ihn beim Boot automatisch in relay_members, kein Extra-Event nötig). Zweiter Lauf mit
# derselben UUID → "duplicate: channel already exists" (Idempotenz gratis, wie bei zooid 9007).
seed_event --auth --sec "$OWNER_SEC" -k 9007 -t "h=$WELCOME_H" -t name=E2E-Welcome -t about=E2E-Startkanal "$R"
seed_event --auth --sec "$OWNER_SEC" -k 9007 -t "h=$GENERAL_H" -t name=E2E-General -t about=E2E-Zweitraum "$R"
seed_event --auth --sec "$OWNER_SEC" -k 9007 -t "h=$FORUM_H" -t name=E2E-Forum -t about=E2E-Forumkanal -t channel_type=forum "$R"
# N1: dasselbe noch einmal, nur PRIVAT. Ein einziger Tag trennt die beiden Lagen.
seed_event --auth --sec "$OWNER_SEC" -k 9007 -t "h=$PRIV_FORUM_H" -t name=E2E-Forum-Privat -t about=E2E-Privatforum -t channel_type=forum -t visibility=private "$R"

# Mitglied (Ersatz für NIP-86 allowpubkey, das es bei Buzz nicht gibt): kind 9030,
# ["p",<hex>] + ["role","member"], vom Owner gesendet. created_at muss frisch sein
# (±120s) — nak signiert mit `now()`, kein --ts, also automatisch erfüllt. Idempotent:
# existiert der Member schon, ist es laut Handler ein stiller No-op.
seed_event --auth --sec "$OWNER_SEC" -k 9030 -t "p=$USER_PUB" -t role=member "$R"

# KANAL-Mitgliedschaft im privaten Forum (N1) — kind 9000, NICHT 9030.
#
# Die beiden Kinds sind zwei verschiedene Ebenen und nicht austauschbar: 9030
# macht relay-weit ein Mitglied (das reicht fuer JEDEN offenen Kanal), 9000 macht
# ein Mitglied EINES Kanals. Ein privater Kanal ist genau der Fall, in dem der
# Unterschied sichtbar wird — ohne das 9000 beantwortet der Relay dem USER jedes
# `#h`-REQ auf diesen Kanal mit `CLOSED restricted: not a channel member` und
# laesst sein 39000 lautlos aus der Kanalliste fallen (beides gemessen).
#
# Absender ist der OWNER: er ist Ersteller und damit Kanal-Eigentuemer, und bei
# `visibility=private` verlangt `validate_admin_event` (9000-Arm,
# `side_effects.rs:364-367`) vom Absender eine bestehende Mitgliedschaft.
# Idempotent — ein zweites 9000 auf dieselbe Rolle ist ein No-op (`add_member`).
seed_event --auth --sec "$OWNER_SEC" -k 9000 -t "h=$PRIV_FORUM_H" -t "p=$USER_PUB" -t role=member "$R"

# Chat (kind 9) — content-guarded wie bei zooid (nak-Events sind nicht replaceable).
if ! timeout 8 nak req -k 9 -t "h=$WELCOME_H" --auth --sec "$USER_SEC" "$R" 2>/dev/null | grep -q 'E2E-Buzz-welcome'; then
    seed_event --auth --sec "$USER_SEC"  -k 9 -t "h=$WELCOME_H" -c 'E2E-Buzz-welcome: Hallo aus dem Testraum! 👋' "$R"
    seed_event --auth --sec "$OWNER_SEC" -k 9 -t "h=$WELCOME_H" -c 'E2E-Buzz-welcome: Antwort vom Owner' "$R"
fi
if ! timeout 8 nak req -k 9 -t "h=$GENERAL_H" --auth --sec "$USER_SEC" "$R" 2>/dev/null | grep -q 'E2E-Buzz-general'; then
    seed_event --auth --sec "$USER_SEC" -k 9 -t "h=$GENERAL_H" -c 'E2E-Buzz-general: Zweiter Raum' "$R"
fi

# Forum-Inhalt (P3): EIN Thema (45001) mit ZWEI Antworten — eine als 45003, eine
# als kind 9. Beide Formen sind am Relay gemessen und beide zaehlen bei Buzz als
# Forum-Antwort (`get_forum_thread` fragt `kinds:[9,45003]`); waere nur eine davon
# geseedet, ginge die haeufigere Form ungeprueft durch.
#
# Idempotenz wie beim Chat ueber den INHALT (nak-Events sind nicht replaceable) —
# und der Guard umschliesst BEIDE Schritte, weil die Antworten die id des Themas
# brauchen: ohne die Klammer legte jeder Lauf ein zweites Thema an, und der Stack
# waechst genau so, wie es P4 fuer die Schreib-Spec dokumentiert hat.
#
# Seit N1 wird derselbe Inhalt in ZWEI Kanaele geseedet (offen + privat), deshalb
# steht er in einer Funktion statt zweimal untereinander: eine zweite Kopie waere
# beim naechsten Formwechsel genau die Haelfte, die jemand vergisst. Die Marker
# unterscheiden sich je Kanal ("E2E-Forum-*" vs. "E2E-Privatforum-*") — gleiche
# Marker haetten den Inhalts-Guard des einen Kanals durch den anderen erfuellt.
#
# $1 Kanal-h · $2 Themenmarker · $3 Themen-Inhalt · $4 45003-Antwort · $5 kind-9-Antwort
seed_forum_topic() {
    local h="$1" marker="$2" body="$3" reply_a="$4" reply_b="$5" root
    if timeout 8 nak req -k 45001 -t "h=$h" --auth --sec "$USER_SEC" "$R" 2>/dev/null | grep -q "$marker"; then
        return 0
    fi
    seed_event --auth --sec "$USER_SEC" -k 45001 -t "h=$h" -c "$body" "$R"
    # Die Wurzel-id zurueckholen (`nak event` gibt sie nur auf stdout aus, das
    # seed_event verwirft — hier ist die Abfrage die verlaesslichere Quelle: sie
    # beweist zugleich, dass das Thema wirklich gespeichert wurde).
    root=$(timeout 8 nak req -k 45001 -t "h=$h" -l 5 --auth --sec "$USER_SEC" "$R" 2>/dev/null \
        | grep "$marker" | head -1 | python3 -c 'import json,sys; line=sys.stdin.readline(); print(json.loads(line)["id"] if line.strip() else "")')
    if [ -z "$root" ]; then
        echo "buzz-test: Forum-Thema ($marker) nach dem Seed nicht abrufbar — Forum-Spec wird rot." >&2
        return 0
    fi
    seed_event --auth --sec "$OWNER_SEC" -k 45003 -t "h=$h" -t "e=$root;;reply" -c "$reply_a" "$R"
    seed_event --auth --sec "$USER_SEC" -k 9 -t "h=$h" -t "e=$root;;reply" -c "$reply_b" "$R"
}

seed_forum_topic "$FORUM_H" 'E2E-Forum-Thema' \
    'E2E-Forum-Thema: Wie kommt das Bier in die Flasche?
Zweite Zeile des Themas — sie gehoert in die Vorschau, nicht in den Titel.' \
    'E2E-Forum-Antwort: Mit Druck und Geduld.' \
    'E2E-Forum-Chatantwort: und mit Kohlensaeure.'

# N1: derselbe Aufbau im PRIVATEN Forum. Dass der USER hier ueberhaupt schreiben
# und lesen darf, haengt allein am 9000 weiter oben.
seed_forum_topic "$PRIV_FORUM_H" 'E2E-Privatforum-Thema' \
    'E2E-Privatforum-Thema: Wer darf hier eigentlich mitlesen?
Zweite Zeile des Privatthemas — Vorschau, nicht Titel.' \
    'E2E-Privatforum-Antwort: Nur wer eingeladen wurde.' \
    'E2E-Privatforum-Chatantwort: und der Owner.'

# Verifikation: erst zurückkehren, wenn Raum + Mitgliedschaft + Nachricht wirklich als
# Relay-Member abrufbar sind — DAS beseitigt den Bind-vor-Seed-Race, wie bei zooid.
OK=0
for _ in $(seq 1 40); do
    if timeout 5 nak req -k 39000 -d "$WELCOME_H" --auth --sec "$USER_SEC" "$R" 2>/dev/null | grep -q 'E2E-Welcome' \
        && timeout 5 nak req -k 9 -t "h=$GENERAL_H" --auth --sec "$USER_SEC" "$R" 2>/dev/null | grep -q 'E2E-Buzz-general' \
        && timeout 5 nak req -k 39000 -d "$FORUM_H" --auth --sec "$USER_SEC" "$R" 2>/dev/null | grep -q '"forum"' \
        && timeout 5 nak req -k 45003 -t "h=$FORUM_H" --auth --sec "$USER_SEC" "$R" 2>/dev/null | grep -q 'E2E-Forum-Antwort' \
        && timeout 5 nak req -k 39000 -d "$PRIV_FORUM_H" --auth --sec "$USER_SEC" "$R" 2>/dev/null | grep -q '"private"' \
        && timeout 5 nak req -k 45003 -t "h=$PRIV_FORUM_H" --auth --sec "$USER_SEC" "$R" 2>/dev/null | grep -q 'E2E-Privatforum-Antwort'; then
        OK=1
        break
    fi
    sleep 0.25
done
if [ "$OK" -ne 1 ]; then
    echo "buzz-test: Verifikation fehlgeschlagen (Raum/Mitgliedschaft/Nachricht nicht abrufbar) — Logs:" >&2
    compose logs --tail=80 relay >&2
    exit 1
fi

touch "$RUNMARK"
echo "buzz-test:$BUZZ_PORT frisch aufgesetzt + geseedet + verifiziert (welcome=$WELCOME_H, general=$GENERAL_H, forum=$FORUM_H, forum-privat=$PRIV_FORUM_H)"
