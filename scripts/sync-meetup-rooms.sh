#!/usr/bin/env bash
# Periodischer, idempotenter Abgleich: neu vereins-gegatete Meetups bekommen
# automatisch ihren privaten NIP-29-Raum auf dem Prod-zooid (group.einundzwanzig.space).
# Legt NUR fehlende Räume an — bestehende 39000 werden NIE erneut editiert (ein
# 9002-Edit ersetzt das komplette Kind-39000, unnötiges Re-Edit würde es clobbern).
#
# Läuft serverseitig (per Laravel-Schedule, siehe routes/console.php) — der
# Bot-Key verlässt den Server nie. Bei kaputter/unerreichbarer Gate-API wird
# NICHTS angelegt oder verändert; das Skript bricht mit exit!=0 ab, damit der
# Scheduler den Ausfall sichtbar macht.
#
# RELAY_MODE=zooid|buzz (Default zooid) schaltet zwischen den beiden Relay-Modellen:
#
#   zooid: h = "m"+sha256(id)[:12]; Bestand per `req -k 39000 -t t=meetup`; ein 9002
#          traegt alle Marker-Tags (t/i/meetup_slug/picture/private) ins 39000.
#   buzz:  h = uuid5(NOSTR_ROOM_NAMESPACE, "meetup:<id>") — Buzz erzwingt UUIDs.
#          KEINE Bestandsabfrage: Buzz antwortet auf ein doppeltes 9007 mit
#          "duplicate: channel already exists" (ON CONFLICT DO NOTHING in der DB),
#          Idempotenz kommt also aus dem Relay statt aus einer Skript-Heuristik.
#          Marker-Tags entfallen ersatzlos — Buzz erzeugt das 39000 selbst mit festem
#          Tag-Satz und belegt `t` mit dem channel_type. Die Meetup-Bindung steckt
#          stattdessen in der UUID, die Kategorie als Praefix im `about`.
#
# Nutzung:  scripts/sync-meetup-rooms.sh
# Env-Overrides: NAK, WS, ROOT, ENV_FILE, GATE_API, RELAY_MODE
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"
ENV_FILE="${ENV_FILE:-$ROOT/.env}"
WS="${WS:-wss://group.einundzwanzig.space}"
GATE_API="${GATE_API:-https://portal.einundzwanzig.space/api/verein/gated-meetups}"

# nak-Binary auflösen: expliziter Override > PATH > bekannte Fallback-Pfade.
NAK="${NAK:-}"
if [ -z "$NAK" ]; then
    NAK="$(command -v nak || true)"
fi
if [ -z "$NAK" ]; then
    for cand in "$HOME/go/bin/nak" "$HOME/bin/nak" "/usr/local/bin/nak"; do
        [ -x "$cand" ] && { NAK="$cand"; break; }
    done
fi
if [ -z "$NAK" ] || ! [ -x "$NAK" ]; then
    echo "FEHLER: nak-Binary nicht gefunden (NAK/PATH/\$HOME/go/bin/nak/\$HOME/bin/nak/usr-local-bin)." >&2
    exit 1
fi

[ -f "$ENV_FILE" ] || { echo "FEHLER: ENV_FILE nicht gefunden: $ENV_FILE" >&2; exit 1; }

BOT=$(grep '^NOSTR_BOT_NSEC=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"'"'"'')
GATE_TOKEN=$(grep '^VEREIN_GATE_TOKEN=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"'"'"'')
[ -z "$BOT" ] && { echo "FEHLER: NOSTR_BOT_NSEC leer/fehlt in $ENV_FILE" >&2; exit 1; }
[ -z "$GATE_TOKEN" ] && { echo "FEHLER: VEREIN_GATE_TOKEN leer/fehlt in $ENV_FILE" >&2; exit 1; }

RELAY_MODE="${RELAY_MODE:-zooid}"
case "$RELAY_MODE" in
    zooid|buzz) ;;
    *) echo "FEHLER: RELAY_MODE muss 'zooid' oder 'buzz' sein (ist: '$RELAY_MODE')." >&2; exit 1 ;;
esac

# Der Namespace ist die gemeinsame Wahrheit von diesem Skript UND dem Vereins-Portal
# (einundzwanzig-verein, ProjectProposal::nostrGroupId). Weichen die beiden ab, zeigen
# Portal und Client auf verschiedene Raeume — und der Fehler ist still, weil beide
# Seiten fuer sich funktionieren. Deshalb hier hart abbrechen statt auf einen Default
# auszuweichen.
ROOM_NAMESPACE=""
if [ "$RELAY_MODE" = "buzz" ]; then
    ROOM_NAMESPACE=$(grep '^NOSTR_ROOM_NAMESPACE=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"'"'"'')
    if [ -z "$ROOM_NAMESPACE" ]; then
        echo "FEHLER: RELAY_MODE=buzz braucht NOSTR_ROOM_NAMESPACE in $ENV_FILE." >&2
        exit 1
    fi
fi

# 1) Gegateten Satz LIVE ziehen. --fail: HTTP-Fehler -> non-zero. Kaputte/keine
#    Antwort => sofort abbrechen, NICHTS anlegen/löschen.
GATE_JSON=$(curl -sS --fail --max-time 20 \
    -H "Authorization: Bearer $GATE_TOKEN" \
    -H "User-Agent: curl/8.5.0" \
    "$GATE_API") || { echo "FEHLER: Gate-API nicht erreichbar ($GATE_API)" >&2; exit 1; }

# Muss ein JSON-Array sein, sonst abbrechen statt zu raten.
if ! printf '%s' "$GATE_JSON" | python3 -c 'import json,sys; d=json.load(sys.stdin); sys.exit(0 if isinstance(d, list) else 1)' 2>/dev/null; then
    echo "FEHLER: Gate-API-Antwort ist kein gültiges JSON-Array" >&2
    exit 1
fi

# 2) Je Meetup eine TSV-Zeile: h \t id \t name \t slug \t logo   (h = "m"+sha256(id)[:12])
GATE_TMP=$(mktemp)
trap 'rm -f "$GATE_TMP"' EXIT
printf '%s' "$GATE_JSON" > "$GATE_TMP"
TSV=$(python3 - "$GATE_TMP" "$RELAY_MODE" "$ROOM_NAMESPACE" <<'PY'
import json, hashlib, sys, uuid

path, mode, namespace = sys.argv[1], sys.argv[2], sys.argv[3]
ns = uuid.UUID(namespace) if mode == "buzz" else None

for m in json.load(open(path)):
    mid = str(m["id"])
    if mode == "buzz":
        # Buzz erzwingt eine UUID als Gruppen-ID (ingest.rs: val.parse::<Uuid>()).
        # uuid5 haelt die Ableitung deterministisch — dieselbe Meetup-ID ergibt
        # immer denselben Raum, genau wie vorher sha256(id)[:12].
        h = str(uuid.uuid5(ns, f"meetup:{mid}"))
    else:
        h = "m" + hashlib.sha256(mid.encode()).hexdigest()[:12]
    print("\t".join([h, mid, m["name"], m["slug"], m.get("logo_url") or ""]))
PY
)
GATED=$(printf '%s\n' "$TSV" | grep -c . || true)

# 3) EINMAL bestehende Räume holen (t=meetup) -> Menge der bestehenden d-Tag-Werte (=h).
#    Exit-Code MUSS geprüft werden: ein fehlgeschlagener/getimeouteter Read liefert
#    leere Ausgabe -> ohne Guard hielte das Skript alle Räume für "fehlend" und würde
#    jeden gegateten Raum re-editieren (Churn + falsche created=-Zahl). Erfolgreicher
#    req mit 0 Treffern (echter Erstlauf) ist rc=0 und erlaubt -> sauber unterscheidbar.
EXISTING=""
if [ "$RELAY_MODE" = "buzz" ]; then
    # Bei Buzz gibt es diesen Schritt NICHT — und er waere auch nicht baubar:
    # `-t t=meetup` greift ins Leere, weil Buzz `t` mit dem channel_type belegt und
    # das 39000 ohnehin selbst erzeugt statt die 9002-Tags zu uebernehmen. Gebraucht
    # wird er auch nicht: ein zweites 9007 mit derselben UUID beantwortet Buzz mit
    # "duplicate: channel already exists". Damit faellt der gesamte Guard oben weg —
    # die Idempotenz liegt jetzt im Relay, nicht in dieser Heuristik.
    :
else
EXISTING_RAW=$(timeout 40 "$NAK" req -k 39000 -t t=meetup --auth --sec "$BOT" "$WS" 2>/dev/null)
REQ_RC=$?
if [ "$REQ_RC" -ne 0 ]; then
    echo "FEHLER: Bestandsabfrage der Räume fehlgeschlagen (rc=$REQ_RC) — Abbruch, um kein Massen-Re-Edit auszulösen." >&2
    exit 1
fi
EXISTING=$(printf '%s' "$EXISTING_RAW" | python3 -c '
import json, sys
for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    try:
        e = json.loads(line)
    except Exception:
        continue
    if e.get("kind") != 39000:
        continue
    for t in e.get("tags", []):
        if len(t) >= 2 and t[0] == "d":
            print(t[1])
')
fi

created=0
skipped=0
failed=0

while IFS=$'\t' read -r H ID NAME SLUG LOGO; do
    [ -z "$H" ] && continue

    if [ "$RELAY_MODE" = "buzz" ]; then
        # Ein einziges 9007 traegt bei Buzz schon alles: `name` ist Pflicht-Tag
        # (ingest.rs:2076-2097), visibility/channel_type werden dort mitgelesen.
        # Die Kategorie kommt als Praefix ins `about` — `t` ist bei Buzz mit dem
        # channel_type belegt, und eigene Marker-Tags landen ohnehin nicht im 39000.
        # visibility=open + BUZZ_REQUIRE_RELAY_MEMBERSHIP=true ergibt zusammen unser
        # Meetup-Modell: nur Vereinsmitglieder sehen den Raum, aber sie kommen ohne
        # Einladung hinein. Das Logo geht ersatzlos verloren (kein picture-Feld).
        CREATE_OUT=$(timeout 30 "$NAK" event --auth --sec "$BOT" -k 9007 \
            -t "h=$H" -t "name=$NAME" -t "visibility=open" -t "channel_type=stream" \
            -t "about=einundzwanzig:meetup:$ID — $NAME" "$WS" </dev/null 2>&1)

        if printf '%s' "$CREATE_OUT" | grep -qi 'duplicate'; then
            skipped=$((skipped + 1))
            printf '  skip %s (%s) — Raum existiert bereits\n' "$SLUG" "$H"
            continue
        fi
        if printf '%s' "$CREATE_OUT" | grep -qi success; then
            created=$((created + 1))
            printf '  ok   %s (%s) — Raum neu angelegt\n' "$SLUG" "$H"
        else
            failed=$((failed + 1))
            printf '  FEHL %s (%s) — 9007 abgelehnt: %s\n' "$SLUG" "$H" \
                "$(printf '%s' "$CREATE_OUT" | tail -1)" >&2
        fi
        continue
    fi

    if printf '%s\n' "$EXISTING" | grep -qxF "$H"; then
        skipped=$((skipped + 1))
        printf '  skip %s (%s) — Raum existiert bereits\n' "$SLUG" "$H"
        continue
    fi

    # 9007 create (idempotent)
    timeout 30 "$NAK" event --auth --sec "$BOT" -k 9007 -t "h=$H" "$WS" </dev/null >/dev/null 2>&1

    # 9002 metadata: ALLE Tags in EINEM Edit (zooid ersetzt das komplette 39000 pro 9002).
    ARGS=(-t "h=$H" -t "name=$NAME")
    [ -n "$LOGO" ] && ARGS+=(-t "picture=$LOGO")
    ARGS+=(-t "t=meetup" -t "i=meetup:$ID" -t "meetup_slug=$SLUG" -t "private")

    if timeout 30 "$NAK" event --auth --sec "$BOT" -k 9002 "${ARGS[@]}" "$WS" </dev/null 2>&1 | grep -qi success; then
        created=$((created + 1))
        printf '  ok   %s (%s) — Raum neu angelegt\n' "$SLUG" "$H"
    else
        failed=$((failed + 1))
        printf '  FAIL %s (%s) — Anlage fehlgeschlagen\n' "$SLUG" "$H"
    fi
done <<< "$TSV"

echo "created=$created skipped=$skipped failed=$failed gated=$GATED"

# ── Kategorie-Index (nur Buzz): kind 30078 ────────────────────────────────────
#
# Wozu: Der `about`-Praefix macht jeden Raum selbstbeschreibend, ist aber
# MEHRBUCHSTABIG und damit per Nostr-Filter nicht adressierbar — nur
# einbuchstabige Tags (`#d`, `#t`, `#p`, `#e`) sind filterbar. Bei Buzz sind die
# alle belegt: `d` = Channel-UUID, `t` = channel_type, `p` nur bei DMs.
#
# Dieses Index-Event schliesst die Luecke, OHNE Buzz zu aendern: `#d` wird von
# Buzz in SQL gepusht, sofern der Filter nur NIP-33-Kinds nennt
# (`crates/buzz-relay/src/handlers/req.rs:797-803`) — kind 30078 erfuellt das.
# Ein Dritt-Client holt damit alle Meetup-Raeume in EINEM serverseitig
# gefilterten Request:
#
#   nak req -k 30078 -d einundzwanzig:rooms:meetup <relay>
#
# Ein Fork mit eigenem `t`-Tag waere der naheliegende, aber schlechtere Weg:
# `#t` wird von Buzz NICHT in SQL gepusht (`req.rs:806-812`), liefe also im
# langsamen Pfad — bezahlt mit einer eigenen Build-Pipeline.
#
# 30078 ist parameterized replaceable: derselbe `d`-Wert ersetzt den alten Stand,
# der Index bleibt also von selbst aktuell und waechst nicht an.
if [ "$RELAY_MODE" = "buzz" ]; then
    INDEX_ARGS=(-t "d=einundzwanzig:rooms:meetup")
    INDEX_UUIDS=()
    while IFS=$'\t' read -r H _ID _NAME _SLUG _LOGO; do
        [ -z "$H" ] && continue
        INDEX_ARGS+=(-t "a=39000:$H")
        INDEX_UUIDS+=("$H")
    done <<< "$TSV"

    if [ "${#INDEX_UUIDS[@]}" -gt 0 ]; then
        # Die UUID-Liste zusaetzlich im content: `a`-Tags sind der Nostr-Weg, der
        # content spart einem Client das Tag-Parsen.
        INDEX_JSON=$(printf '%s\n' "${INDEX_UUIDS[@]}" | python3 -c "
import json, sys
print(json.dumps({'type': 'meetup', 'rooms': [l.strip() for l in sys.stdin if l.strip()]}))
")
        if timeout 30 "$NAK" event --auth --sec "$BOT" -k 30078 "${INDEX_ARGS[@]}" \
            -c "$INDEX_JSON" "$WS" </dev/null 2>&1 | grep -qi success; then
            echo "index=ok rooms=${#INDEX_UUIDS[@]} (kind 30078, d=einundzwanzig:rooms:meetup)"
        else
            # Fail-soft: Der Index ist eine Zusatzleistung fuer Dritt-Clients. Die
            # Raeume selbst stehen; ein fehlender Index macht sie nicht unbrauchbar,
            # nur schlechter auffindbar. Deshalb kein exit!=0.
            echo "index=FEHLGESCHLAGEN — Raeume stehen, nur der Kategorie-Index fehlt" >&2
        fi
    fi
fi

# Nur der Anlage-Loop ist fail-soft; ein Fehlschlag beim Anlegen macht den
# Gesamtlauf trotzdem sichtbar fehlgeschlagen (Scheduler-Log/Alert).
[ "$failed" -gt 0 ] && exit 1
exit 0
