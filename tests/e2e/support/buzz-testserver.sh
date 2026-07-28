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
COMPOSE_DIR="$SCRIPT_DIR/buzz-compose"
BUZZ_REPO_COMPOSE=/home/user/Code/buzz/deploy/compose/compose.yml   # NUR gelesen, nie editiert.
PROJECT=buzz-test

# shellcheck disable=SC1091
source "$COMPOSE_DIR/test-keys.env"   # OWNER_SEC/OWNER_PUB/USER_SEC/USER_PUB (Wegwerf, s. dort)

BUZZ_PORT="${BUZZ_TEST_PORT:-3001}"
R="ws://localhost:$BUZZ_PORT"
HTTP="http://localhost:$BUZZ_PORT"

# Zwei feste Test-Räume (UUIDv5, Namespace + Ableitung wie Prod-Meetups: uuid5(NS,
# "meetup:<slug>") — auch für diese generischen E2E-Räume beibehalten, weil GENAU
# dieses Format am laufenden Relay gemessen wurde; ein freier uuid4 ist ungetestet).
NS=d3a2a246-e0b6-45be-a1c4-367c2bd857ad
WELCOME_H=$(python3 -c "import uuid,sys; print(uuid.uuid5(uuid.UUID('$NS'), 'meetup:e2e-welcome'))")
GENERAL_H=$(python3 -c "import uuid,sys; print(uuid.uuid5(uuid.UUID('$NS'), 'meetup:e2e-general'))")

# welcome-Seed-Baseline (wie zooid: WELCOME_SEED) — Bloat-Guard.
WELCOME_SEED_CAP=10

compose() {
    # BUZZ_GIT_CONFORMANCE_PROBE=false gehoert hierher und nicht in die (gitignorierte)
    # .env: Die A3-Probe schlaegt auf einem frisch per `down -v` geleerten git-Volume
    # fehl und beendet den Relay mit Exit 0 — der Stack liesse sich danach nie wieder
    # aufsetzen, und der Grund stuende in einer Datei, die niemand sonst hat.
    # Git-Hosting wird in diesen Tests nicht benutzt.
    BUZZ_GIT_CONFORMANCE_PROBE=false \
        docker compose -p "$PROJECT" -f "$BUZZ_REPO_COMPOSE" --project-directory "$COMPOSE_DIR" --env-file "$COMPOSE_DIR/.env" "$@"
}

# Läuft schon ein sauberer, geseedeter, nicht aufgeblähter buzz-test-Stack? → wiederverwenden.
stack_seeded_and_clean() {
    timeout 5 curl -sf -H 'Accept: application/nostr+json' "$HTTP" >/dev/null 2>&1 || return 1
    # Letztes Seed-Artefakt: die general-Nachricht (als Relay-Member abrufbar).
    timeout 8 nak req -k 9 -t "h=$GENERAL_H" --auth --sec "$USER_SEC" "$R" 2>/dev/null | grep -q 'E2E-Buzz-general' || return 1
    local n
    n=$(timeout 8 nak req -k 9 -t "h=$WELCOME_H" --auth --sec "$USER_SEC" "$R" 2>/dev/null | grep -c '"kind":9')
    [ "${n:-999}" -le "$WELCOME_SEED_CAP" ]
}

if stack_seeded_and_clean; then
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
TEST_VOLS=$(docker volume ls --format '{{.Name}}' | grep '^buzz-test_' | sort)
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
TEST_MOUNT=$(docker volume inspect buzz-test_buzz-postgres-data --format '{{.Mountpoint}}' 2>/dev/null)
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

# Räume (kind 9007). h = UUIDv5, name Pflicht-Tag. Owner = RELAY_OWNER_PUBKEY (bootstrap_owner
# hebt ihn beim Boot automatisch in relay_members, kein Extra-Event nötig). Zweiter Lauf mit
# derselben UUID → "duplicate: channel already exists" (Idempotenz gratis, wie bei zooid 9007).
nak event --auth --sec "$OWNER_SEC" -k 9007 -t "h=$WELCOME_H" -t name=E2E-Welcome -t about=E2E-Startkanal "$R" >/dev/null 2>&1 || true
nak event --auth --sec "$OWNER_SEC" -k 9007 -t "h=$GENERAL_H" -t name=E2E-General -t about=E2E-Zweitraum "$R" >/dev/null 2>&1 || true

# Mitglied (Ersatz für NIP-86 allowpubkey, das es bei Buzz nicht gibt): kind 9030,
# ["p",<hex>] + ["role","member"], vom Owner gesendet. created_at muss frisch sein
# (±120s) — nak signiert mit `now()`, kein --ts, also automatisch erfüllt. Idempotent:
# existiert der Member schon, ist es laut Handler ein stiller No-op.
nak event --auth --sec "$OWNER_SEC" -k 9030 -t "p=$USER_PUB" -t role=member "$R" >/dev/null 2>&1 || true

# Chat (kind 9) — content-guarded wie bei zooid (nak-Events sind nicht replaceable).
if ! nak req -k 9 -t "h=$WELCOME_H" --auth --sec "$USER_SEC" "$R" 2>/dev/null | grep -q 'E2E-Buzz-welcome'; then
    nak event --auth --sec "$USER_SEC"  -k 9 -t "h=$WELCOME_H" -c 'E2E-Buzz-welcome: Hallo aus dem Testraum! 👋' "$R" >/dev/null 2>&1 || true
    nak event --auth --sec "$OWNER_SEC" -k 9 -t "h=$WELCOME_H" -c 'E2E-Buzz-welcome: Antwort vom Owner' "$R" >/dev/null 2>&1 || true
fi
if ! nak req -k 9 -t "h=$GENERAL_H" --auth --sec "$USER_SEC" "$R" 2>/dev/null | grep -q 'E2E-Buzz-general'; then
    nak event --auth --sec "$USER_SEC" -k 9 -t "h=$GENERAL_H" -c 'E2E-Buzz-general: Zweiter Raum' "$R" >/dev/null 2>&1 || true
fi

# Verifikation: erst zurückkehren, wenn Raum + Mitgliedschaft + Nachricht wirklich als
# Relay-Member abrufbar sind — DAS beseitigt den Bind-vor-Seed-Race, wie bei zooid.
OK=0
for _ in $(seq 1 40); do
    if timeout 5 nak req -k 39000 -d "$WELCOME_H" --auth --sec "$USER_SEC" "$R" 2>/dev/null | grep -q 'E2E-Welcome' \
        && timeout 5 nak req -k 9 -t "h=$GENERAL_H" --auth --sec "$USER_SEC" "$R" 2>/dev/null | grep -q 'E2E-Buzz-general'; then
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

echo "buzz-test:$BUZZ_PORT frisch aufgesetzt + geseedet + verifiziert (welcome=$WELCOME_H, general=$GENERAL_H)"
