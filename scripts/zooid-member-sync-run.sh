#!/usr/bin/env bash
#
# Wrapper fuer den naechtlichen zooid-Rollen-Sync auf dem Prod-Server.
#
# Ersetzt den Aufruf des alten `~/member-sync/member-sync.mjs` (psql-basiert, seit
# dem SQLite-Cutover am 2026-07-19 wirkungslos). Aufbau bewusst identisch zum
# Buzz-Wrapper `buzz-member-sync-run.sh` daneben — beide loesen dasselbe Problem:
#
#   1. **Node findet seine Abhaengigkeiten ueber den ORT DES SKRIPTS**, nicht ueber
#      das Arbeitsverzeichnis. `nostr-tools` liegt genau einmal auf dem Server, im
#      `node_modules` von `~/member-sync`. Deshalb wird die frisch deployte Fassung
#      dorthin KOPIERT und von dort gestartet, statt sie aus `~/webclient` heraus
#      aufzurufen — dort faende `import 'nostr-tools/pure'` nichts.
#   2. **Cron hat kein PATH.** Ein blosses `node` in einer Crontab-Zeile scheitert
#      still; deshalb der absolute Interpreter unten.
#
# Einrichtung (einmalig):
#   cp <repo>/scripts/zooid-member-sync-run.sh ~/member-sync/run-zooid.sh
#   chmod +x ~/member-sync/run-zooid.sh
#
# Aufruf:
#   ~/member-sync/run-zooid.sh            # Trockenlauf — schreibt nichts
#   APPLY=1 ~/member-sync/run-zooid.sh    # schreibt (NIP-86)
#
# DIE JOB-ZEILE DARF KEINE UMLEITUNG TRAGEN. Das Log gehoert diesem Skript.
# Begruendung ausfuehrlich im Buzz-Wrapper nebenan: Forge haengt seine eigene
# Umleitung an, und die zweite gewinnt — die im Kommando genannte Datei wird
# geleert und nie beschrieben.
#
# Alle Pfade relativ zum Skript, damit nichts rechnergebunden fest verdrahtet ist.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
WEBCLIENT="$(cd "$HERE/../webclient" && pwd)"

cd "$HERE"

LOG="$HERE/last-run-zooid.log"
MAX_LOG_BYTES=1048576

# Das Protokoll darf das Ergebnis nie faelschen — Begruendung ausfuehrlich im
# Buzz-Wrapper nebenan. Nicht schreibbares Log heisst: nur stdout, Lauf normal.
if ! ( : >> "$LOG" ) 2>/dev/null; then
    echo "WARNUNG: $LOG ist nicht schreibbar — dieser Lauf protokolliert nur nach stdout." >&2
    LOG=/dev/null
fi

if [ "$LOG" != /dev/null ] && [ -f "$LOG" ] && [ "$(wc -c < "$LOG")" -gt "$MAX_LOG_BYTES" ]; then
    mv -f "$LOG" "$LOG.1" || true
fi

main() {
    # Siehe Buzz-Wrapper: die linke Seite einer Pipeline ist eine Subshell, und der
    # Aufruf unten schaltet `-e` ab, um `PIPESTATUS` zu erreichen. Ohne dieses
    # `set -e` liefe der Lauf nach einem gescheiterten `cp` weiter.
    set -e

    echo "=== START $(date -Iseconds)  APPLY=${APPLY:-0} ==="

    # Immer die zuletzt deployte Fassung verwenden — Quelle der Wahrheit ist das
    # Repo, nicht die Kopie hier. So zieht ein `deploy.sh` den Sync automatisch mit,
    # und die statische Vorstands-Liste im Skript bleibt die aus dem Repo.
    cp -f "$WEBCLIENT/scripts/zooid-member-sync.mjs" ./zooid-member-sync.mjs

    # Schluessel NUR aus der Umgebung/Datei lesen, nie als Argument — Argumente
    # stehen in der Prozessliste und damit fuer jeden `ps` sichtbar. `RELAY_SECRET`
    # ist der Schluessel, mit dem der Relay selbst signiert; er liegt in der
    # zooid-Config (`secret = "…"` in ~/group.einundzwanzig.space/config/*.toml).
    #
    # BEWUSST NICHT automatisch aus der TOML gegrept: dieser Wrapper laeuft neben
    # einem Relay-Verzeichnis, das wir laut Deploy-Doktrin NIE anfassen. Wer den
    # Schluessel setzt, tut es einmal in der Crontab-Umgebung oder in einer
    # `~/member-sync/.env`, die nur root/deploy lesen kann.
    if [ -z "${RELAY_SECRET:-}" ] && [ -f "$HERE/.env" ]; then
        # shellcheck disable=SC1091
        set -a && . "$HERE/.env" && set +a
    fi

    if [ -z "${RELAY_SECRET:-}" ]; then
        echo "RELAY_SECRET fehlt — in ~/member-sync/.env oder in der Cron-Umgebung setzen." >&2
        return 1
    fi

    export ZOOID_RELAY="${ZOOID_RELAY:-wss://group.einundzwanzig.space}"

    /usr/bin/node zooid-member-sync.mjs "$@"
}

set +e
{ main "$@"; } 2>&1 | tee -a "$LOG"
rc=${PIPESTATUS[0]}
set -e

# `|| true` ist Pflicht: diese Zeile laeuft wieder unter `set -e` samt `pipefail`,
# und ein scheiterndes `tee` wuerde sonst den echten Exit-Code verschlucken.
echo "=== ENDE  $(date -Iseconds)  exit=$rc ===" | tee -a "$LOG" || true
exit "$rc"
