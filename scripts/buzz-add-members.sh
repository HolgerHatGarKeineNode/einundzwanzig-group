#!/usr/bin/env bash
# Traegt eine Pubkey-Liste per kind 9030 als Relay-Mitglieder in einen Buzz-Relay ein (P6).
#
# Buzz kennt NIP-86 nicht (kein `allowpubkey` ueber HTTP) — Mitglieder werden ueber ein
# signiertes Nostr-Event angelegt: kind 9030 mit `["p",<hex>]` und `["role","member"]`,
# gesendet von einem Pubkey mit Relay-Admin-Rechten.
#
# ZWEI EIGENSCHAFTEN, DIE NICHT VERHANDELBAR SIND:
#
#   1. `created_at` muss innerhalb ±120 s der Relay-Zeit liegen. Events lassen sich also
#      NICHT vorbauen und spaeter abschicken — jedes wird im Moment des Sendens frisch
#      signiert. `nak` signiert mit `now()` und kennt kein `--ts` hier, also automatisch
#      erfuellt; wer das Skript umbaut, darf diese Eigenschaft nicht verlieren.
#   2. `nak event` kennt kein eigenes Zeitlimit und blockiert unbegrenzt, wenn der Relay
#      gerade nicht am WebSocket haengt (gemessen 2026-07-28: ~9 min Haenger direkt nach
#      einem Container-Neustart). Deshalb `timeout` + Wiederholung, und wiederholt wird
#      NUR ein Zeitlimit-Treffer (Exit 124) — ein fachlicher Fehlschlag ist eine Aussage
#      und gehoert in den Bericht, nicht in fuenf Runden.
#
# Idempotent: ein erneutes 9030 fuer ein bestehendes Mitglied ist laut Handler ein stiller
# No-op. Das Skript darf also gefahrlos wiederholt werden.
#
# Aufruf:
#   scripts/buzz-add-members.sh --relay ws://localhost:3000 --file <pubkeys.txt> [--dry-run]
#   scripts/buzz-add-members.sh --relay ws://localhost:3000 --file <liste> --role admin
#
# Der Signierschluessel kommt aus der Umgebung (NIE als Argument — Argumente landen in der
# Prozessliste und in der Shell-History):
#   BUZZ_ADMIN_NSEC=nsec1… scripts/buzz-add-members.sh …
# Fehlt sie, faellt das Skript auf NOSTR_BOT_NSEC aus der .env des Projekts zurueck.
set -uo pipefail

RELAY=""
FILE=""
ROLE="member"
DRY=0

while [ $# -gt 0 ]; do
    case "$1" in
        --relay) RELAY="${2:-}"; shift 2 ;;
        --file)  FILE="${2:-}";  shift 2 ;;
        --role)  ROLE="${2:-}";  shift 2 ;;
        --dry-run) DRY=1; shift ;;
        -h|--help) sed -n '2,30p' "$0"; exit 0 ;;
        *) echo "Unbekanntes Argument: $1" >&2; exit 2 ;;
    esac
done

[ -n "$RELAY" ] || { echo "--relay fehlt (z. B. ws://localhost:3000)" >&2; exit 2; }
[ -n "$FILE" ]  || { echo "--file fehlt (eine Pubkey je Zeile, hex)" >&2; exit 2; }
[ -f "$FILE" ]  || { echo "Datei nicht gefunden: $FILE" >&2; exit 2; }
command -v nak >/dev/null 2>&1 || { echo "nak nicht gefunden — https://github.com/fiatjaf/nak" >&2; exit 2; }

# Schluessel aus der Umgebung, sonst aus der Projekt-.env. Wird nie ausgegeben.
SEC="${BUZZ_ADMIN_NSEC:-}"
if [ -z "$SEC" ]; then
    ENV_FILE="$(dirname "$0")/../.env"
    [ -f "$ENV_FILE" ] && SEC="$(grep -m1 '^NOSTR_BOT_NSEC=' "$ENV_FILE" | cut -d= -f2- | tr -d '"'"'"'')"
fi
[ -n "$SEC" ] || { echo "Kein Signierschluessel: BUZZ_ADMIN_NSEC setzen oder NOSTR_BOT_NSEC in .env hinterlegen." >&2; exit 2; }

SIGNER_PUB="$(nak key public "$SEC" 2>/dev/null)"
[ -n "$SIGNER_PUB" ] || { echo "Signierschluessel unlesbar (nsec/hex erwartet)." >&2; exit 2; }

# Nur wohlgeformte 64-stellige Hex-Pubkeys, Kommentare und Leerzeilen raus, Duplikate weg.
mapfile -t PUBKEYS < <(grep -oE '^[0-9a-f]{64}' "$FILE" | sort -u)
TOTAL=${#PUBKEYS[@]}
RAW=$(grep -cve '^\s*$' -e '^\s*#' "$FILE" || true)

echo "Relay:      $RELAY"
echo "Absender:   $SIGNER_PUB (Rolle der Eintraege: $ROLE)"
echo "Liste:      $FILE — $TOTAL gueltige Pubkeys von $RAW nicht-leeren Zeilen"
[ "$TOTAL" -gt 0 ] || { echo "Nichts zu tun." >&2; exit 1; }
if [ "$TOTAL" -ne "$RAW" ]; then
    echo "HINWEIS: $((RAW - TOTAL)) Zeile(n) uebersprungen (kein 64-stelliges Hex oder Dublette)."
fi

if [ "$DRY" -eq 1 ]; then
    echo
    echo "TROCKENLAUF — es wird nichts gesendet. Beispiel des ersten Events:"
    echo "  nak event --auth --sec <verborgen> -k 9030 -t p=${PUBKEYS[0]} -t role=$ROLE $RELAY"
    exit 0
fi

OK=0; FAIL=0; TIMEOUT=0
FAILED_LIST=""
i=0
for pk in "${PUBKEYS[@]}"; do
    i=$((i + 1))
    printf '\r[%d/%d] %s' "$i" "$TOTAL" "${pk:0:16}…"
    attempt=0
    while :; do
        attempt=$((attempt + 1))
        OUT="$(timeout 15 nak event --auth --sec "$SEC" -k 9030 -t "p=$pk" -t "role=$ROLE" "$RELAY" 2>&1)"
        rc=$?
        if [ $rc -eq 124 ] && [ $attempt -lt 3 ]; then
            sleep 2
            continue
        fi
        break
    done
    if [ $rc -eq 124 ]; then
        TIMEOUT=$((TIMEOUT + 1)); FAILED_LIST="$FAILED_LIST$pk (Zeitlimit)\n"
    elif [ $rc -ne 0 ]; then
        FAIL=$((FAIL + 1)); FAILED_LIST="$FAILED_LIST$pk ($(echo "$OUT" | tail -1 | cut -c1-90))\n"
    else
        OK=$((OK + 1))
    fi
done
printf '\r%*s\r' 40 ''

echo "Fertig: $OK erfolgreich, $FAIL abgelehnt, $TIMEOUT Zeitlimit (von $TOTAL)."
if [ -n "$FAILED_LIST" ]; then
    echo
    echo "Nicht eingetragen:"
    printf "%b" "$FAILED_LIST"
    exit 1
fi
