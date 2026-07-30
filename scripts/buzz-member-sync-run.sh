#!/usr/bin/env bash
#
# Wrapper fuer den periodischen Buzz-Mitglieder-Sync auf dem Prod-Server.
#
# Gehoert NEBEN das bestehende `run.sh` (zooid) in dasselbe Verzeichnis — dort liegt
# das einzige `node_modules` mit `nostr-tools`, und Node loest Abhaengigkeiten vom
# ORT DES SKRIPTS aus auf, nicht vom Arbeitsverzeichnis. Deshalb wird die frisch
# deployte Fassung des Syncs hierher kopiert statt aus `webclient/` heraus gestartet.
#
# Einrichtung (einmalig, siehe Kopf von buzz-member-sync.mjs):
#   cp <repo>/scripts/buzz-member-sync-run.sh ~/member-sync/run-buzz.sh
#   chmod +x ~/member-sync/run-buzz.sh
#
# Aufruf:
#   ~/member-sync/run-buzz.sh            # Trockenlauf — sendet nichts
#   APPLY=1 ~/member-sync/run-buzz.sh    # schreibt (9030/9031)
#
# Alle Pfade relativ zum Skript, damit nichts rechnergebunden fest verdrahtet ist.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
WEBCLIENT="$(cd "$HERE/../webclient" && pwd)"

cd "$HERE"

# Immer die zuletzt deployte Fassung verwenden — Quelle der Wahrheit ist das Repo,
# nicht die Kopie hier. So zieht ein `deploy.sh` den Sync automatisch mit.
cp -f "$WEBCLIENT/scripts/buzz-member-sync.mjs" ./buzz-member-sync.mjs

# Schluessel NUR aus der .env lesen, nie als Argument (Argumente stehen in der
# Prozessliste). Der zugehoerige Pubkey muss auf dem Buzz-Relay `owner` oder `admin`
# sein — das Skript bricht sonst mit einer klaren Meldung ab, bevor es irgendetwas
# sendet.
if [ -z "${BUZZ_ADMIN_SECRET:-}" ]; then
    BUZZ_ADMIN_SECRET="$(grep -m1 -E '^NOSTR_BOT_NSEC=' "$WEBCLIENT/.env" | cut -d= -f2- | tr -d '"'"'"'')"
    export BUZZ_ADMIN_SECRET
fi

export BUZZ_RELAY="${BUZZ_RELAY:-wss://buzz.einundzwanzig.space}"

exec /usr/bin/node buzz-member-sync.mjs "$@"
