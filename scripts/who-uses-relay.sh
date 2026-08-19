#!/usr/bin/env bash
#
# Beantwortet: WER fuehrt Relay X in seinem Profil (kind-10002-Relayliste)?
#
# Das ist die Gegenrichtung zu `find-dead-relay-sources.sh`: dort geht es von Personen
# zu ihren Relays, hier von einem Relay zu den Personen.
#
# Warum WRITE und READ getrennt gezaehlt werden: welshman ruft fuer jeden Socket, den
# es oeffnet, die NIP-11-Info per HTTPS ab. Sockets zu fremden Relays entstehen beim
# Outbox-Routing — und das nutzt ausschliesslich die WRITE-Relays eines Autors. Wer
# die Domain nur als "read" fuehrt, kann die Scanner-Meldung nicht ausloesen.
#
# Kein Schluessel noetig: kind 10002 und kind 0 sind oeffentliche, signierte Events.
#
# Aufruf:
#   scripts/who-uses-relay.sh wss://nostr.milou.lol
#   scripts/who-uses-relay.sh wss://nostr.milou.lol raum   # nur Treffer, die in einem
#                                                          # Raum aktiv sind (braucht nsec)
#
# Vollstaendigkeit: die Indexer-Relays kennen nicht jede Relayliste der Welt. Das
# Ergebnis ist eine belastbare Stichprobe, kein Zensus — die Trefferzahl ist eine
# Untergrenze, keine Gesamtzahl.
#
set -euo pipefail

RELAY_URL="${1:-}"
ROOM_H="${2:-}"
SPACE_RELAY="${SPACE_RELAY:-wss://group.einundzwanzig.space}"
INDEXERS=(wss://purplepag.es wss://relay.damus.io wss://nos.lol wss://relay.primal.net wss://nostr.wine)
LIMIT="${LIMIT:-500}"

if [[ -z "$RELAY_URL" ]]; then
    echo "Aufruf: $0 <relay-url> [raum-h]" >&2
    echo "  z.B.: $0 wss://nostr.milou.lol" >&2
    exit 2
fi
command -v nak >/dev/null || { echo "nak nicht gefunden" >&2; exit 127; }
command -v jq  >/dev/null || { echo "jq nicht gefunden" >&2; exit 127; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# Relay-URLs stehen in Listen mal mit, mal ohne Schraegstrich am Ende. Beide Formen
# abfragen, sonst fehlt die Haelfte der Treffer.
BASE="${RELAY_URL%/}"
echo "── 1/3 Relaylisten suchen, die $BASE fuehren"
for variant in "$BASE" "$BASE/"; do
    for relay in "${INDEXERS[@]}"; do
        timeout 40 nak req -k 10002 --tag "r=$variant" -l "$LIMIT" "$relay" 2>/dev/null || true
    done
done > "$WORK/raw.jsonl"

# Je Pubkey nur die JUENGSTE Liste: eine alte Fassung kann das Relay noch fuehren,
# waehrend es der Betreffende laengst entfernt hat.
jq -sc 'map(select(.kind == 10002)) | group_by(.pubkey) | map(max_by(.created_at)) | .[]' \
    < "$WORK/raw.jsonl" > "$WORK/newest.jsonl" 2>/dev/null || : > "$WORK/newest.jsonl"

if [[ ! -s "$WORK/newest.jsonl" ]]; then
    echo "Niemand gefunden, der $BASE fuehrt (in der Reichweite dieser Indexer)." >&2
    exit 0
fi
echo "   $(wc -l < "$WORK/newest.jsonl") Profile mit Eintrag (juengste Fassung je Pubkey)."

echo "── 2/3 write / read trennen"
# NIP-65: ein r-Tag OHNE Marker gilt fuer beide Richtungen, ist also auch write.
jq -r --arg u "$BASE" '
    .pubkey as $pk
    | .tags[]
    | select(.[0] == "r")
    | select((.[1] | sub("/+$"; "")) == $u)
    | "\($pk)\t\(if (length > 2 and .[2] == "read") then "read" else "write" end)"
' < "$WORK/newest.jsonl" > "$WORK/roles.tsv"

# Wer die Domain sowohl als read wie als write fuehrt, zaehlt als write.
awk -F'\t' '$2 == "write" { w[$1] = 1 } $2 == "read" { r[$1] = 1 }
     END { for (p in w) print p; }' "$WORK/roles.tsv" | sort -u > "$WORK/write.txt"
awk -F'\t' '$2 == "write" { w[$1] = 1 } $2 == "read" { r[$1] = 1 }
     END { for (p in r) if (!(p in w)) print p; }' "$WORK/roles.tsv" | sort -u > "$WORK/readonly.txt"
echo "   write: $(wc -l < "$WORK/write.txt")   nur read: $(wc -l < "$WORK/readonly.txt")"

# Optionaler Schnitt gegen einen Raum: beantwortet "wer davon begegnet mir hier?"
if [[ -n "$ROOM_H" ]]; then
    echo "── Schnitt mit Raum $ROOM_H (nak fragt gleich nach nsec/bunker)"
    nak req --auth --prompt-sec -k 9 -k 1068 -k 9041 --tag "h=$ROOM_H" -l 1000 "$SPACE_RELAY" \
        2>/dev/null | jq -r '.pubkey' | sort -u > "$WORK/room.txt" || : > "$WORK/room.txt"
    if [[ -s "$WORK/room.txt" ]]; then
        comm -12 "$WORK/write.txt" "$WORK/room.txt" > "$WORK/write.cut" && mv "$WORK/write.cut" "$WORK/write.txt"
        comm -12 "$WORK/readonly.txt" "$WORK/room.txt" > "$WORK/ro.cut" && mv "$WORK/ro.cut" "$WORK/readonly.txt"
        echo "   nach Schnitt — write: $(wc -l < "$WORK/write.txt")   nur read: $(wc -l < "$WORK/readonly.txt")"
    else
        echo "   Raum nicht lesbar — zeige ungeschnittenes Ergebnis." >&2
    fi
fi

echo "── 3/3 Namen aufloesen (im Block, nicht einzeln)"
# Einzelabfragen waeren hier untauglich: bei ~700 Treffern je ~2 s sind das 20 Minuten.
# Ausserdem liest `nak` von stdin und verschlingt dabei die Eingabe einer umgebenden
# `while read`-Schleife — in der ersten Fassung kam deshalb genau EIN Name heraus.
# Beides loest die Blockabfrage.
cat "$WORK/write.txt" "$WORK/readonly.txt" 2>/dev/null | sort -u > "$WORK/all.txt"
: > "$WORK/profiles.jsonl"
mapfile -t ALLPK < "$WORK/all.txt"
for ((i = 0; i < ${#ALLPK[@]}; i += 50)); do
    args=()
    for pk in "${ALLPK[@]:i:50}"; do args+=(-a "$pk"); done
    timeout 45 nak req -k 0 "${args[@]}" "${INDEXERS[@]}" </dev/null 2>/dev/null >> "$WORK/profiles.jsonl" || true
done
jq -sr 'map(select(.kind == 0)) | group_by(.pubkey) | map(max_by(.created_at))
        | map([.pubkey, ((.content | fromjson? | (.name // .display_name // "")) // "")] | @tsv) | .[]' \
    < "$WORK/profiles.jsonl" > "$WORK/names.tsv" 2>/dev/null || : > "$WORK/names.tsv"

emit() {
    local file="$1" limit="$2" total shown=0
    total=$(wc -l < "$file")
    while read -r pk <&3; do
        if [[ "$limit" -gt 0 && "$shown" -ge "$limit" ]]; then
            printf '  … und %s weitere (vollstaendig: %s)\n' "$((total - shown))" "$OUT_FULL"
            break
        fi
        name="$(awk -F'\t' -v p="$pk" '$1 == p { print $2; exit }' "$WORK/names.tsv")"
        printf '  %-64s %s\n' "$(nak encode npub "$pk" 2>/dev/null || echo "$pk")" "${name:-(kein Profil)}"
        shown=$((shown + 1))
    done 3< "$file"
}

OUT_FULL="${OUT_DIR:-.}/who-uses-${BASE//[^a-zA-Z0-9]/-}.txt"
{
    echo "# Alle Treffer fuer $BASE"
    echo "# write = kann die Scanner-Meldung ausloesen; read = nicht"
    while read -r pk <&3; do
        printf 'write\t%s\t%s\n' "$(nak encode npub "$pk" 2>/dev/null || echo "$pk")" \
            "$(awk -F'\t' -v p="$pk" '$1 == p { print $2; exit }' "$WORK/names.tsv")"
    done 3< "$WORK/write.txt"
    while read -r pk <&3; do
        printf 'read\t%s\t%s\n' "$(nak encode npub "$pk" 2>/dev/null || echo "$pk")" \
            "$(awk -F'\t' -v p="$pk" '$1 == p { print $2; exit }' "$WORK/names.tsv")"
    done 3< "$WORK/readonly.txt"
} > "$OUT_FULL"

printf '\n════ %s ════\n' "$BASE"
printf '\nA) Fuehren es als WRITE — nur diese koennen die Scanner-Meldung ausloesen (%s):\n\n' "$(wc -l < "$WORK/write.txt")"
if [[ -s "$WORK/write.txt" ]]; then emit "$WORK/write.txt" 40; else echo "  niemand."; fi

printf '\nB) Fuehren es nur als READ — koennen es NICHT ausloesen (%s):\n\n' "$(wc -l < "$WORK/readonly.txt")"
if [[ -s "$WORK/readonly.txt" ]]; then emit "$WORK/readonly.txt" 10; else echo "  niemand."; fi

printf '\nVollstaendige Liste: %s\n' "$OUT_FULL"

printf '\nHinweis: Ein Eintrag ist kein Fehlverhalten — die Domain ist dem Betreffenden\n'
printf 'unter der Liste weggelaufen. Ein Hinweis an ihn behebt es fuer alle.\n'
printf 'Die Indexer kennen nicht jede Liste: die Zahlen sind eine Untergrenze.\n'
