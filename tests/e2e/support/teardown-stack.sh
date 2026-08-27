#!/usr/bin/env bash
# Räumt EINEN Slot vollständig ab: Prozess/Container, Netz, Volumes, Marker.
#
# Nutzung: teardown-stack.sh zooid <port>
#          teardown-stack.sh buzz  <port>
#
# Zwei Aufrufer, ein Werkzeug:
#   1) global-teardown.ts — am Ende JEDES Playwright-Laufs (normal ODER per einfachem
#      SIGINT abgebrochen, siehe dessen Kopfkommentar für die Messung), NUR für die
#      eigenen Slots dieses Laufs.
#   2) reap-stale-teststacks.sh — Sicherheitsnetz für den Fall, dass globalTeardown NIE
#      lief (SIGKILL, Rechnerabsturz, `kill -9` eines Agenten), altersbasiert, über
#      ALLE Slots.
#
# Idempotent und defensiv: ein Aufruf gegen einen Slot, der gar nicht existiert (kein
# Prozess, kein Container, keine Marker), tut nichts und meldet keinen Fehler — beide
# Aufrufer rufen ihn auch für Slots auf, bei denen sie nicht wissen, ob dort überhaupt
# etwas läuft.
set -uo pipefail

MODE="${1:-}"
PORT="${2:-}"

if [ -z "$MODE" ] || [ -z "$PORT" ]; then
    echo "Nutzung: teardown-stack.sh <zooid|buzz> <port>" >&2
    exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

case "$MODE" in
zooid)
    PIDFILE="/tmp/e2e-zooid-$PORT.pid"
    if [ -f "$PIDFILE" ]; then
        PID=$(cat "$PIDFILE" 2>/dev/null || true)
        if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
            kill -TERM "$PID" 2>/dev/null || true
            for _ in $(seq 1 20); do
                kill -0 "$PID" 2>/dev/null || break
                sleep 0.2
            done
            # Immer noch da? Harter Schnitt — ein hängender zooid-Prozess ist genau
            # das, was heute 23 Stunden lief.
            kill -0 "$PID" 2>/dev/null && kill -KILL "$PID" 2>/dev/null
        fi
    fi
    # Fallback für den Fall, dass die Pidfile fehlt/veraltet ist, der Port aber
    # trotzdem noch belegt ist (z. B. Prozess ohne Pidfile-Schreibung gestartet).
    # NUR dieser eine Port — niemals ein Port außerhalb des übergebenen Slots.
    fuser -k "$PORT/tcp" 2>/dev/null || true

    rm -f "$PIDFILE" "/tmp/e2e-zooid-$PORT.run" "/tmp/e2e-zooid-$PORT.alive" "/tmp/e2e-zooid-$PORT.log"
    rm -rf "/home/user/Code/zooid/data-test-$PORT" "/home/user/Code/zooid/config-test-$PORT"
    ;;
buzz)
    PROJECT="buzz-test-$PORT"
    COMPOSE_DIR="$SCRIPT_DIR/buzz-compose/slot-$PORT"
    BUZZ_REPO_COMPOSE=/home/user/Code/buzz/deploy/compose/compose.yml

    if [ -f "$COMPOSE_DIR/.env" ] && [ -f "$BUZZ_REPO_COMPOSE" ]; then
        BUZZ_GIT_CONFORMANCE_PROBE=false \
            docker compose -p "$PROJECT" -f "$BUZZ_REPO_COMPOSE" \
                --project-directory "$COMPOSE_DIR" --env-file "$COMPOSE_DIR/.env" \
                down -v --remove-orphans >/dev/null 2>&1 || true
    fi
    # Fallback, unabhängig davon ob die .env noch existiert: alles, was Docker unter
    # DIESEM Projektnamen kennt (Container, Netz), plus dessen benannte Volumes — über
    # das Compose-Projekt-Label, nicht über die compose.yml. Deckt den Fall ab, dass
    # der COMPOSE_DIR schon weg ist, der Stack aber noch lebt (z. B. zweiter
    # Reaper-Lauf nach einem unvollständigen ersten Versuch).
    CONTAINERS=$(docker ps -aq --filter "label=com.docker.compose.project=$PROJECT" 2>/dev/null || true)
    if [ -n "$CONTAINERS" ]; then
        # shellcheck disable=SC2086
        docker rm -f $CONTAINERS >/dev/null 2>&1 || true
    fi
    VOLUMES=$(docker volume ls -q --filter "label=com.docker.compose.project=$PROJECT" 2>/dev/null || true)
    if [ -n "$VOLUMES" ]; then
        # shellcheck disable=SC2086
        docker volume rm -f $VOLUMES >/dev/null 2>&1 || true
    fi
    NETWORKS=$(docker network ls -q --filter "label=com.docker.compose.project=$PROJECT" 2>/dev/null || true)
    if [ -n "$NETWORKS" ]; then
        # shellcheck disable=SC2086
        docker network rm $NETWORKS >/dev/null 2>&1 || true
    fi

    rm -rf "$COMPOSE_DIR"
    rm -f "/tmp/e2e-buzz-$PORT.run" "/tmp/e2e-buzz-$PORT.alive"
    ;;
*)
    echo "teardown-stack.sh: unbekannter Modus '$MODE' (erwartet zooid|buzz)" >&2
    exit 1
    ;;
esac
