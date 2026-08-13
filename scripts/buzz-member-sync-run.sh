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
# DIE JOB-ZEILE DARF KEINE UMLEITUNG TRAGEN. Das Log gehoert diesem Skript.
#
# Warum das so ausdruecklich dasteht: Forge haengt an die Job-Zeile SEINE EIGENE
# Umleitung an, und eine Shell wertet Umleitungen von links nach rechts aus. Aus
#
#     run-buzz.sh > …/last-run-buzz.log 2>&1   >> …/.forge/scheduled-<id>.log 2>&1
#                   ^ oeffnet und truncated       ^ biegt fd 1 wieder weg
#
# folgt: die im Kommando genannte Datei wird angelegt, geleert und NIE beschrieben,
# waehrend die Ausgabe in Forges Log landet. Am 2026-08-10 hat genau diese Attrappe
# zwei Tage gekostet — der Job galt als tot, weil seine Logdatei 0 Byte hatte, und
# war die ganze Zeit gesund. Nachgestellt: `bash -c 'echo X > a 2>&1 >> b 2>&1'`
# laesst a leer und schreibt in b.
#
# Alle Pfade relativ zum Skript, damit nichts rechnergebunden fest verdrahtet ist.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
WEBCLIENT="$(cd "$HERE/../webclient" && pwd)"

cd "$HERE"

LOG="$HERE/last-run-buzz.log"
MAX_LOG_BYTES=1048576

# DAS PROTOKOLL DARF DAS ERGEBNIS NIE FAELSCHEN. Ist das Log nicht schreibbar,
# protokolliert der Lauf eben nur nach stdout (Forges Log) und laeuft normal
# weiter — ein voller Datentraeger oder ein falscher Eigentuemer ist kein Grund,
# einen erfolgreichen Sync als Fehlschlag zu melden. Genau das war der Fehler der
# ersten Fassung: ein scheiterndes `tee` brach unter `set -e` ab, bevor der echte
# Exit-Code weitergereicht wurde, und Forge sah eine 1, wo eine 0 stand.
if ! ( : >> "$LOG" ) 2>/dev/null; then
    echo "WARNUNG: $LOG ist nicht schreibbar — dieser Lauf protokolliert nur nach stdout." >&2
    LOG=/dev/null
fi

# Einmal wegdrehen statt logrotate — eine Datei mehr im Verzeichnis ist billiger
# als eine Konfiguration, die beim naechsten Serverumzug vergessen wird.
if [ "$LOG" != /dev/null ] && [ -f "$LOG" ] && [ "$(wc -c < "$LOG")" -gt "$MAX_LOG_BYTES" ]; then
    mv -f "$LOG" "$LOG.1" || true
fi

main() {
    # Muss hier stehen: die linke Seite einer Pipeline laeuft in einer Subshell,
    # und der Aufruf unten schaltet `-e` vorher ab, damit `PIPESTATUS` erreichbar
    # bleibt. Ohne dieses `set -e` liefe das Skript nach einem gescheiterten `cp`
    # einfach weiter — genau der Fehler, den Befund A beschreibt.
    set -e

    echo "=== START $(date -Iseconds)  APPLY=${APPLY:-0} ==="

    # Immer die zuletzt deployte Fassung verwenden — Quelle der Wahrheit ist das
    # Repo, nicht die Kopie hier. So zieht ein `deploy.sh` den Sync automatisch mit.
    cp -f "$WEBCLIENT/scripts/buzz-member-sync.mjs" ./buzz-member-sync.mjs

    # Schluessel NUR aus der .env lesen, nie als Argument (Argumente stehen in der
    # Prozessliste). Der zugehoerige Pubkey muss auf dem Buzz-Relay `owner` oder
    # `admin` sein — das Skript bricht sonst mit einer klaren Meldung ab, bevor es
    # irgendetwas sendet.
    if [ -z "${BUZZ_ADMIN_SECRET:-}" ]; then
        BUZZ_ADMIN_SECRET="$(grep -m1 -E '^NOSTR_BOT_NSEC=' "$WEBCLIENT/.env" | cut -d= -f2- | tr -d '"'"'"'')"
        export BUZZ_ADMIN_SECRET
    fi

    export BUZZ_RELAY="${BUZZ_RELAY:-wss://buzz.einundzwanzig.space}"

    /usr/bin/node buzz-member-sync.mjs "$@"
}

# `tee` statt `exec >`: Forges eigenes Log bleibt die zweite Kopie. Wer nur dort
# hinsieht, soll denselben Text finden — sonst tauschen wir eine leere Datei
# gegen eine andere.
set +e
{ main "$@"; } 2>&1 | tee -a "$LOG"
rc=${PIPESTATUS[0]}
set -e

# `|| true` ist hier Pflicht, nicht Nachlaessigkeit: diese Zeile laeuft wieder
# unter `set -e` samt `pipefail`. Ohne den Riegel wuerde ein scheiterndes `tee`
# das Skript hier abbrechen, `exit "$rc"` nie erreicht — und der Aufrufer bekaeme
# den Exit-Code des Protokollierens statt den des Laufs.
echo "=== ENDE  $(date -Iseconds)  exit=$rc ===" | tee -a "$LOG" || true
exit "$rc"
