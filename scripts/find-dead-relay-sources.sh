#!/usr/bin/env bash
#
# Findet heraus, WESSEN Relay-Liste den Client auf eine tote/geparkte Domain schickt.
#
# Hintergrund: welshman ruft fuer JEDEN Socket, den es oeffnet, die NIP-11-Info per
# HTTPS ab (`Pool.get().subscribe(socket => loadRelay(socket.url))`). Beim Outbox-
# Routing oeffnet es Sockets zu den WRITE-Relays der Autoren, deren Events angezeigt
# werden. Ist so eine Domain abgelaufen und von einem Domain-Parker uebernommen,
# liefert sie statt JSON eine HTML-Seite mit Redirect-Script — und Virenscanner wie
# ESET blocken das als `JS/Redirector`.
#
# Das Skript liest die Autoren eines Raums, holt deren kind-10002-Listen und prueft
# jedes WRITE-Relay darauf, ob es noch ein Relay ist. Nur WRITE zaehlt: read-markierte
# Relays werden vom Outbox-Routing nie kontaktiert und koennen die Meldung nicht
# ausloesen.
#
# ── Umgang mit dem Schluessel ────────────────────────────────────────────────────
# Der Raum-Relay verlangt NIP-42-AUTH, das Skript braucht also einen Member-Key.
# Er wird von `nak --prompt-sec` abgefragt — nicht von diesem Skript. Damit steht er
# NICHT in der Shell-History, NICHT in der Prozessliste (`ps` zeigt Argumente) und
# NICHT in einer Datei. Er wird bei jedem Relay-Aufruf neu erfragt; das ist der Preis
# dafuer, ihn nirgends zwischenzuspeichern.
#
# BESSER als der nackte nsec: `--prompt-sec` akzeptiert auch eine **bunker://**-URL
# (NIP-46) oder einen **ncryptsec** (passwortverschluesselt). Dann verlaesst der private
# Schluessel deinen Signer nie und hier liegt nur eine Referenz darauf. Wenn du einen
# Bunker hast, nimm ihn — der nsec im Klartext ist die schlechteste der drei Formen.
#
# Wer gar nicht tippen mag, kann NOSTR_SECRET_KEY vorher selbst setzen (nak liest es) —
# dann steht der Wert allerdings in der Umgebung des Prozesses. Dieses Skript setzt die
# Variable nie selbst und gibt sie nie aus.
#
# Aufruf:
#   scripts/find-dead-relay-sources.sh <raum-h|npub> [space-relay]
#   scripts/find-dead-relay-sources.sh m7902699be42c      # Raum (braucht nsec/bunker)
#   scripts/find-dead-relay-sources.sh npub1dein...     # eigene Kontaktliste (OHNE Schluessel)
#
set -euo pipefail

ROOM_H="${1:-}"
SPACE_RELAY="${2:-wss://group.einundzwanzig.space}"
INDEXERS=(wss://purplepag.es wss://relay.damus.io wss://nos.lol)
AUTHOR_LIMIT="${AUTHOR_LIMIT:-500}"

if [[ -z "$ROOM_H" ]]; then
    echo "Aufruf: $0 <raum-h|npub> [space-relay]" >&2
    echo "  <raum-h> = Teil hinter /rooms/ in der URL (braucht nsec/bunker fuer AUTH)." >&2
    echo "  <npub>   = Kontaktliste dieses Profils pruefen — ohne Schluessel." >&2
    exit 2
fi
command -v nak >/dev/null || { echo "nak nicht gefunden (https://github.com/fiatjaf/nak)" >&2; exit 127; }
command -v jq  >/dev/null || { echo "jq nicht gefunden" >&2; exit 127; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# nak schreibt in Fehlerfaellen Zeilen auf stdout, die kein JSON sind (gemessen:
# "Invalid numeric literal" mitten im Lauf). jq bricht daran ab und reisst per set -e
# das Skript um. Deshalb geht jede Relay-Ausgabe zuerst durch diesen Filter.
only_json() { grep '^[[:space:]]*{' || true; }

if [[ "$ROOM_H" == npub1* ]]; then
    # ── Kontaktlisten-Modus. Braucht KEINEN Schluessel: kind 3 ist oeffentlich, und
    # der Client kontaktiert die Write-Relays jedes Profils, das er anzeigt — die
    # eigene Follow-Liste ist damit die groesste Quelle solcher Verbindungen.
    # `nak decode npub1…` gibt den Hex-Key PLAIN aus, nicht als JSON — ein jq darauf
    # scheitert mit "Invalid numeric literal" (gemessen 2026-08-19).
    OWNER_HEX="$(nak decode "$ROOM_H" 2>/dev/null | tr -d '[:space:]')"
    [[ "$OWNER_HEX" =~ ^[0-9a-f]{64}$ ]] || { echo "npub nicht lesbar: $ROOM_H" >&2; exit 2; }
    echo "── 1/4 Kontaktliste von $ROOM_H lesen (kein nsec noetig)"
    for relay in "${INDEXERS[@]}"; do
        timeout 45 nak req -k 3 -a "$OWNER_HEX" -l 1 "$relay" 2>/dev/null
    done | only_json | jq -sc 'map(select(.kind == 3)) | max_by(.created_at) // empty' > "$WORK/follows.json"
    [[ -s "$WORK/follows.json" ]] || { echo "Keine Kontaktliste (kind 3) gefunden." >&2; exit 1; }
    jq -r '.tags[] | select(.[0] == "p") | .[1]' < "$WORK/follows.json" | sort -u > "$WORK/authors.txt"
else
    echo "── 1/4 Autoren im Raum $ROOM_H lesen ($SPACE_RELAY)"
    echo "   nak fragt gleich nach deinem nsec — er geht direkt an nak, nicht durch dieses Skript."
    # kind 9 = NIP-29-Chat, 1068 = Poll, 9041 = Zap Goal — dieselben Kinds wie im Raumverlauf.
    nak req --auth --prompt-sec -k 9 -k 1068 -k 9041 --tag "h=$ROOM_H" -l "$AUTHOR_LIMIT" \
        "$SPACE_RELAY" > "$WORK/room.jsonl" 2>"$WORK/room.err" || {
            echo "FEHLER: Raum nicht lesbar." >&2
            sed -n '1,5p' "$WORK/room.err" >&2
            exit 1
        }
    only_json < "$WORK/room.jsonl" | jq -r '.pubkey' | sort -u > "$WORK/authors.txt"
fi

AUTHOR_COUNT=$(wc -l < "$WORK/authors.txt")
if [[ "$AUTHOR_COUNT" -eq 0 ]]; then
    echo "Keine Autoren/Kontakte gefunden — falsche ID, oder du bist kein Mitglied." >&2
    exit 1
fi
echo "   $AUTHOR_COUNT Pubkeys."

echo "── 2/4 kind-10002-Relaylisten dieser Autoren holen"
: > "$WORK/lists.jsonl"
mapfile -t AUTHORS < "$WORK/authors.txt"
# In Bloecken, damit ein Filter nicht ueberlang wird.
for ((i = 0; i < ${#AUTHORS[@]}; i += 50)); do
    args=()
    for pk in "${AUTHORS[@]:i:50}"; do args+=(-a "$pk"); done
    for relay in "${INDEXERS[@]}"; do
        timeout 45 nak req -k 10002 "${args[@]}" "$relay" 2>/dev/null >> "$WORK/lists.jsonl" || true
    done
done
# Je Pubkey nur die juengste Liste behalten.
only_json < "$WORK/lists.jsonl" \
    | jq -sc 'map(select(.kind == 10002)) | group_by(.pubkey) | map(max_by(.created_at)) | .[]' > "$WORK/newest.jsonl"
echo "   $(wc -l < "$WORK/newest.jsonl") Listen (von $AUTHOR_COUNT Autoren)."

echo "── 3/4 WRITE-Relays einsammeln (read-markierte zaehlen nicht)"
# Ein r-Tag ohne Marker gilt fuer BEIDE Richtungen (NIP-65), ist also auch write.
jq -r '.pubkey as $pk | .tags[] | select(.[0] == "r") | select((length < 3) or (.[2] != "read")) | "\($pk)\t\(.[1])"' \
    < "$WORK/newest.jsonl" \
    | awk -F'\t' '{
        # In echten Daten gesehen: ein Client hat ~250 Relays mit %0D (CR) in EINEN
        # r-Tag geklebt. Ungetrennt pruefen wir davon nur die erste Domain und
        # uebersehen den Rest — ein Treffer koennte genau dort stecken.
        n = split($2, parts, /%0[DdAa]|\r|\n/)
        for (i = 1; i <= n; i++) { if (parts[i] != "") print $1 "\t" parts[i] }
      }' | sed -E 's#/+$##' | sort -u > "$WORK/write.tsv"
cut -f2 "$WORK/write.tsv" | sort -u > "$WORK/urls.txt"
echo "   $(wc -l < "$WORK/urls.txt") verschiedene WRITE-Relays."

URL_COUNT=$(wc -l < "$WORK/urls.txt")
echo "── 4/4 $URL_COUNT Domains pruefen: antwortet sie noch als Relay? (parallel, dauert etwas)"

# Ein lebendes Relay antwortet auf `Accept: application/nostr+json` mit einem
# JSON-Objekt. Alles andere ist verdaechtig; HTML mit Verkaufs-/Parking-Merkmalen ist
# genau der Fall, der Virenscanner ausloest.
check_one() {
    local url="$1" host body code tmp verdict ns
    host="${url#wss://}"; host="${host#ws://}"; host="${host%%/*}"
    [[ -z "$host" ]] && return 0
    tmp="$(mktemp)"
    code="$(curl -s -m 8 -o "$tmp" -w '%{http_code}' -H 'Accept: application/nostr+json' "https://$host" 2>/dev/null || echo 000)"
    # Unter der 12-fachen Parallelitaet laufen einzelne Abrufe in den Timeout, obwohl
    # der Host erreichbar ist (gemessen an nostr.einundzwanzig.space: im Lauf 000, im
    # Einzelabruf 200). Ein stiller Fehlschlag koennte einen ECHTEN Parking-Treffer
    # verstecken — deshalb genau ein zweiter, geduldigerer Versuch.
    if [[ "${code: -3}" == 000 ]]; then
        sleep 1
        code="$(curl -s -m 20 -o "$tmp" -w '%{http_code}' -H 'Accept: application/nostr+json' "https://$host" 2>/dev/null || echo 000)"
    fi
    body="$(cat "$tmp" 2>/dev/null || true)"; rm -f "$tmp"
    # Bei mehreren Verbindungsversuchen haengt curl die Codes aneinander ("000000") —
    # nur der letzte zaehlt.
    code="${code: -3}"

    # Lebendes Relay → JSON. Fertig, kein Befund.
    if printf '%s' "$body" | jq -e 'type == "object"' >/dev/null 2>&1; then
        return 0
    fi

    # Ein Virenscanner kann nur anschlagen, wenn eine Seite tatsaechlich AUSGELIEFERT
    # wird. Ein 4xx/5xx ist eine Fehlerseite, ein 000 gar keine Antwort — beides ist
    # harmlos. Diese Unterscheidung fehlte in der ersten Fassung und hat zehn Leute
    # faelschlich als Verursacher ausgewiesen (gemessen 2026-08-19: 406/402/404/502/
    # 503/403/302 plus drei voellig normale Websites, null Parking-Seiten).
    if [[ "$code" == 000 ]]; then
        printf '%s\t%s\t%s\n' "$url" "$host" "C|per HTTPS nicht erreichbar (kann trotzdem als Relay laufen)"
        return 0
    fi
    if [[ "$code" != 2* ]]; then
        printf '%s\t%s\t%s\n' "$url" "$host" "C|HTTP $code — Fehlerseite, kein Scanner-Ausloeser"
        return 0
    fi

    # Ab hier: 200 mit Nicht-JSON. Nur jetzt lohnt die Frage nach Parking.
    ns="$(dig +short NS "${host#*.}" 2>/dev/null | tr '\n' ' ')"
    if printf '%s' "$body" | grep -qiE 'this domain|domain.*(for sale|is parked|parking)|buy this domain|abovedomains|sedoparking|bodis\.com|dan\.com|afternic' \
       || printf '%s' "$ns" | grep -qiE 'abovedomains|sedoparking|bodis|parkingcrew|dan\.com'; then
        verdict="A|GEPARKT / zum Verkauf — DAS loest die Scanner-Meldung aus"
    else
        verdict="B|normale Webseite unter dieser Adresse (kein Relay, aber auch kein Parking)"
    fi
    printf '%s\t%s\t%s\n' "$url" "$host" "$verdict"
}
export -f check_one

xargs -a "$WORK/urls.txt" -P 12 -I{} bash -c 'check_one "$@"' _ {} \
    > "$WORK/dead.tsv" 2>/dev/null || true
sort -u -o "$WORK/dead.tsv" "$WORK/dead.tsv"

# Nur eine Domain, die tatsaechlich HTML ausliefert, kann einen Virenscanner ausloesen.
# Eine tote Domain (DNS weg, Verbindung verweigert) liefert gar nichts und ist harmlos —
# sie steht in fast jeder alten Relay-Liste und wuerde den Befund sonst zudecken. In der
# Messung an echten Daten: 42 von 58 alten Relays tot, aber nur eine Handvoll geparkt.
# Nur Gruppe A nennt Namen. Wer unter B oder C landet, hat lediglich eine veraltete
# URL in seiner Liste — daraus einen "Verursacher" zu machen waere eine falsche
# Beschuldigung, und genau das ist in der ersten Fassung passiert.
report_group() {
    local key="$1" heading="$2" show_authors="$3" count
    count=$(awk -F'\t' -v k="$key" 'index($3, k "|") == 1' "$WORK/dead.tsv" | wc -l)
    [[ "$count" -eq 0 ]] && return 0
    printf '\n%s (%s)\n' "$heading" "$count"
    awk -F'\t' -v k="$key" 'index($3, k "|") == 1 { sub(/^[ABC]\|/, "", $3); print $1 "\t" $2 "\t" $3 }' \
        "$WORK/dead.tsv" | while IFS=$'\t' read -r url host verdict; do
        printf '  %-40s %s\n' "$host" "$verdict"
        [[ "$show_authors" != "yes" ]] && continue
        awk -F'\t' -v u="$url" '$2 == u { print $1 }' "$WORK/write.tsv" | sort -u | while read -r pk; do
            name="$(timeout 20 nak req -k 0 -a "$pk" -l 1 "${INDEXERS[@]}" 2>/dev/null \
                    | jq -r '.content' | jq -r '.name // .display_name // ""' 2>/dev/null | head -1)"
            printf '      <- %s  %s\n' "$(nak encode npub "$pk" 2>/dev/null || echo "$pk")" "${name:-(kein Profil)}"
        done
    done
}

echo ""
echo "════ BEFUND ════"
report_group A 'A) GEPARKT — das sind die Ausloeser der Scanner-Meldung:' yes
report_group B 'B) Normale Webseite statt Relay — veraltete URL, KEIN Scanner-Ausloeser:' no
report_group C 'C) Nicht erreichbar oder Fehlerseite — harmlos, nur zur Kenntnis:' no

if ! awk -F'\t' 'index($3, "A|") == 1' "$WORK/dead.tsv" | grep -q .; then
    echo ""
    echo "  ⇒ KEIN Ausloeser in diesem Raum. Die Scanner-Meldung kommt woanders her."
    echo "     Naechster Schritt: ein anderer Raum — oder die eigene Kontaktliste, denn"
    echo "     der Client kontaktiert auch die Write-Relays aller Profile, die er anzeigt."
fi
echo ""
echo "Zur Einordnung: B und C sind KEINE Verdaechtigen. Ein Scanner schlaegt nur an, wenn"
echo "eine Seite mit Redirect-Script wirklich ausgeliefert wird — eine Fehlerseite, eine"
echo "unerreichbare Domain und eine normale Webseite tun das nicht. Nur A nennt deshalb"
echo "Namen, und auch dort gilt: die Domain ist dem Autor unter der Liste weggelaufen,"
echo "das ist kein Fehlverhalten."
