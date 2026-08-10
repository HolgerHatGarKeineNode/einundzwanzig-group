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
# Alle Pfade relativ zum Skript, damit nichts rechnergebunden fest verdrahtet ist.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
WEBCLIENT="$(cd "$HERE/../webclient" && pwd)"

cd "$HERE"

# Immer die zuletzt deployte Fassung verwenden — Quelle der Wahrheit ist das Repo,
# nicht die Kopie hier. So zieht ein `deploy.sh` den Sync automatisch mit, und die
# statische Vorstands-Liste im Skript bleibt die aus dem Repo (siehe dort).
cp -f "$WEBCLIENT/scripts/zooid-member-sync.mjs" ./zooid-member-sync.mjs

# Schluessel NUR aus der Umgebung/Datei lesen, nie als Argument — Argumente stehen
# in der Prozessliste und damit fuer jeden `ps` sichtbar. `RELAY_SECRET` ist der
# Schluessel, mit dem der Relay selbst signiert; er liegt in der zooid-Config
# (`secret = "…"` in ~/group.einundzwanzig.space/config/*.toml). Wird er hier nicht
# gesetzt, bricht das Skript mit klarer Meldung ab, bevor es irgendetwas tut.
#
# BEWUSST NICHT automatisch aus der TOML gegrept: dieser Wrapper laeuft neben einem
# Relay-Verzeichnis, das wir laut Deploy-Doktrin NIE anfassen. Wer den Schluessel
# setzt, tut es einmal in der Crontab-Umgebung oder in einer `~/member-sync/.env`,
# die nur root/deploy lesen kann.
if [ -z "${RELAY_SECRET:-}" ] && [ -f "$HERE/.env" ]; then
    # shellcheck disable=SC1091
    set -a && . "$HERE/.env" && set +a
fi

if [ -z "${RELAY_SECRET:-}" ]; then
    echo "RELAY_SECRET fehlt — in ~/member-sync/.env oder in der Cron-Umgebung setzen." >&2
    exit 1
fi

export ZOOID_RELAY="${ZOOID_RELAY:-wss://group.einundzwanzig.space}"

exec /usr/bin/node zooid-member-sync.mjs "$@"
