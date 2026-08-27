#!/usr/bin/env bash
# Sicherheitsnetz gegen unsterbliche Teststacks — Vorfall 2026-08-26: 86 zooid-Prozesse
# (4,6 GB RSS, ältester 23 h), 100 buzz-test-Container, 20 Netze, 80 Volumes, 215
# Marker-Dateien in /tmp. Ursache: `zooid-testserver.sh`/`buzz-testserver.sh` starten
# DETACHED und niemand räumt je ab — jeder Lauf mit neuem `E2E_SLOT_OFFSET` legt einen
# weiteren, für immer laufenden Stack an.
#
# `global-teardown.ts` (siehe dort) fängt den Normal- und den per-SIGINT-abgebrochenen
# Lauf bereits ab (gemessen: läuft bei einfachem Ctrl-C zuverlässig ~1,8 s nach dem
# Signal). Was KEIN Trap fängt, ist `kill -9` (ein hart gekillter Agent — genau das ist
# heute mehrfach passiert) oder ein Rechnerabsturz. Für DIESEN Fall ist dieses Skript da:
# altersbasiert, über ALLE Slots hinweg (nicht nur die eigenen — verwaiste Slots von
# LÄNGST beendeten, fremden Läufen sind hier explizit das Ziel), aber niemals gegen
# einen Slot, der gerade aktiv benutzt wird.
#
# "Aktiv benutzt" heißt: sein Herzschlag (`/tmp/e2e-{zooid,buzz}-<port>.alive`, von den
# Server-Skripten bei JEDEM Aufruf berührt) ist jünger als `E2E_STACK_MAX_AGE_SEC`
# (Default 3 h). Ein einzelner Testlauf dauert Minuten, keine Stunden — 3 h Toleranz
# ist damit kein Kompromiss zwischen "räumt zu früh" und "räumt zu spät", sondern ein
# Vielfaches der tatsächlichen Laufzeit, das trotzdem eine liegengelassene Nacht
# (23 h im Vorfall) sicher einsammelt.
#
# Aufgerufen aus global-setup.ts, VOR dem eigenen Worker-Setup — ein Lauf räumt beim
# Start auch fremden, verwaisten Müll ab, nicht nur seinen eigenen am Ende.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ZOOID_DIR=/home/user/Code/zooid
MAX_AGE="${E2E_STACK_MAX_AGE_SEC:-10800}" # 3h
NOW=$(date +%s)

age_of() { # $1 = Datei -> Alter in Sekunden auf stdout, rc=1 wenn nicht vorhanden
    local mtime
    mtime=$(stat -c %Y "$1" 2>/dev/null) || return 1
    echo $((NOW - mtime))
}

# Temp-Datei mit der mtime der ZULETZT geänderten Datei in $1, auf stdout — für Fälle
# ohne Marker, bei denen nur noch das Datenverzeichnis selbst Auskunft gibt, wann es
# zuletzt benutzt wurde (rc=1, wenn $1 fehlt oder leer ist).
newest_file_mtime_marker() {
    local dir="$1" newest tmp
    [ -d "$dir" ] || return 1
    newest=$(find "$dir" -type f -printf '%T@\n' 2>/dev/null | sort -n | tail -1)
    [ -n "$newest" ] || return 1
    tmp=$(mktemp)
    touch -d "@${newest%.*}" "$tmp" 2>/dev/null || {
        rm -f "$tmp"
        return 1
    }
    echo "$tmp"
}

# $1 = mode (zooid|buzz), $2 = port, $3 = Herzschlag-Datei, $4 = Fallback-Zeitdatei
reap_if_stale() {
    local mode="$1" port="$2" alive="$3" fallback="$4" age
    if age=$(age_of "$alive"); then
        :
    elif age=$(age_of "$fallback"); then
        :
    else
        return 0 # kein Zeitsignal -> nichts, worüber zu entscheiden wäre
    fi
    if [ "$age" -gt "$MAX_AGE" ]; then
        echo "reap: $mode:$port seit ${age}s ohne Herzschlag (Grenze ${MAX_AGE}s) -> Teardown"
        bash "$SCRIPT_DIR/teardown-stack.sh" "$mode" "$port"
    fi
}

# ── zooid ────────────────────────────────────────────────────────────────────────────
# Alle bekannten Ports aus .pid/.run/.alive UND aus vorhandenen data-test-*-Verzeichnissen
# vereinigen. Der dritte Fall ist real gemessen (2026-08-27, VOR dieser Erweiterung):
# 119 verwaiste data-test-*/config-test-* Verzeichnisse (514 MB, ältestes ~11 Tage) OHNE
# jeden Marker — vermutlich von Hand geleerte /tmp-Marker, deren Datenverzeichnisse
# liegen blieben. Ein Marker allein (ohne Prozess mehr dahinter) ODER ein
# Datenverzeichnis allein (ohne Marker mehr) sind beide ein Fall für den Reaper.
zooid_marker_ports=$(
    {
        # shellcheck disable=SC2012
        ls /tmp/e2e-zooid-*.pid /tmp/e2e-zooid-*.run /tmp/e2e-zooid-*.alive 2>/dev/null || true
    } | sed -nE 's#.*/e2e-zooid-([0-9]+)\.(pid|run|alive)$#\1#p'
)
zooid_dir_ports=$(
    {
        # shellcheck disable=SC2012
        ls -d "$ZOOID_DIR"/data-test-*/ "$ZOOID_DIR"/config-test-*/ 2>/dev/null || true
    } | sed -nE 's#.*/(data|config)-test-([0-9]+)/?$#\2#p'
)
zooid_ports=$(printf '%s\n%s\n' "$zooid_marker_ports" "$zooid_dir_ports" | grep -E '^[0-9]+$' | sort -un)
for port in $zooid_ports; do
    alive="/tmp/e2e-zooid-$port.alive"
    fallback="/tmp/e2e-zooid-$port.pid"
    tmpf=""
    if [ ! -e "$alive" ] && [ ! -e "$fallback" ]; then
        # Nur-Datenverzeichnis-Fall: kein Marker mehr da (data-test hat Vorrang, es
        # existiert öfter als config-test — beide würden ohnehin dieselbe Portnummer
        # liefern, sofern beide da sind).
        tmpf=$(newest_file_mtime_marker "$ZOOID_DIR/data-test-$port") && fallback="$tmpf"
        if [ -z "$tmpf" ]; then
            tmpf=$(newest_file_mtime_marker "$ZOOID_DIR/config-test-$port") && fallback="$tmpf"
        fi
    fi
    reap_if_stale zooid "$port" "$alive" "$fallback"
    [ -n "$tmpf" ] && rm -f "$tmpf" 2>/dev/null
done

# ── buzz ─────────────────────────────────────────────────────────────────────────────
# Marker-Ports UND tatsächlich laufende Compose-Projekte vereinigen: ein Stack kann rein
# über Docker weiterleben, obwohl seine Marker-Dateien schon weg sind (z. B. nach einem
# vorherigen, abgebrochenen Reaper-Versuch).
buzz_marker_ports=$(
    {
        # shellcheck disable=SC2012
        ls /tmp/e2e-buzz-*.run /tmp/e2e-buzz-*.alive 2>/dev/null || true
    } | sed -nE 's#.*/e2e-buzz-([0-9]+)\.(run|alive)$#\1#p'
)
buzz_docker_ports=$(
    docker ps -a --format '{{.Label "com.docker.compose.project"}}' 2>/dev/null |
        sort -u | grep -E '^buzz-test-[0-9]+$' | sed -E 's/^buzz-test-//'
)
buzz_ports=$(printf '%s\n%s\n' "$buzz_marker_ports" "$buzz_docker_ports" | grep -E '^[0-9]+$' | sort -un)

# Fallback-Zeitsignal für einen rein-per-Docker existierenden Stack ohne Marker: das
# älteste seiner Container (docker inspect .Created), als temporäre Datei mit dieser
# mtime — age_of() liest ausschließlich Datei-mtimes, das hält die Funktion einheitlich.
docker_project_fallback_file() {
    local project="$1" oldest tmp
    # `docker inspect -f {{.Created}}` liefert RFC3339 und ist verlässlicher als das
    # menschenlesbare `docker ps --format {{.CreatedAt}}`.
    local ids
    ids=$(docker ps -aq --filter "label=com.docker.compose.project=$project" 2>/dev/null)
    [ -n "$ids" ] || return 1
    oldest=$(docker inspect -f '{{.Created}}' $ids 2>/dev/null | sort | head -1)
    [ -n "$oldest" ] || return 1
    tmp=$(mktemp)
    if date -d "$oldest" +%s >/dev/null 2>&1; then
        touch -d "@$(date -d "$oldest" +%s)" "$tmp" 2>/dev/null
    fi
    echo "$tmp"
}

for port in $buzz_ports; do
    alive="/tmp/e2e-buzz-$port.alive"
    fallback="/tmp/e2e-buzz-$port.run"
    if [ ! -e "$alive" ] && [ ! -e "$fallback" ]; then
        # Nur-Docker-Fall: kein Marker mehr da, Stack existiert aber noch.
        tmpf=$(docker_project_fallback_file "buzz-test-$port") && fallback="$tmpf"
    fi
    reap_if_stale buzz "$port" "$alive" "$fallback"
    [ -n "${tmpf:-}" ] && rm -f "$tmpf" 2>/dev/null
    tmpf=""
done
