#!/usr/bin/env bash
# Bereitet den lokalen zooid-Relay (:3335) für die E2E-Tests vor: seedet ihn mit
# 8 Räumen (kind 9007 → 39000), Profilen, Directory-Rollen (NIP-86), Mitgliedschaften
# und Chat. Wird aus Playwrights `globalSetup` (nicht webServer!) aufgerufen und läuft
# SYNCHRON durch bis zur Verifikation — so starten die Tests garantiert erst, wenn der
# Seed komplett ist (kein Bind-vor-Seed-Race mehr). Der Relay wird DETACHED gestartet
# und lebt über den Testlauf hinaus weiter, damit der nächste Lauf ihn wiederverwenden
# kann (siehe Guard unten). Isoliert auf :3335 (eigenes data-test/config-test) — der
# Mitschau-zooid auf :3334 bleibt IMMER unberührt.
#
# Zwei Dauerprobleme, hier an der Wurzel gelöst:
#   1) Bind-vor-Seed-Race: früher galt der Relay als „bereit", sobald der Port band —
#      das Seeding (v.a. die Raum-Mitgliedschaften) lief aber noch. Jetzt verifiziert
#      das Skript am Ende und kehrt erst zurück, wenn das letzte Seed-Artefakt abrufbar
#      ist. globalSetup blockiert die Tests bis dahin.
#   2) DB-Bloat: bei reiner Wiederverwendung wuchs die SQLite über viele Läufe (die
#      Schreib-Testräume sammelten Events) → Relay wurde lahm/flaky. Jetzt setzt der
#      Guard den Relay frisch auf, sobald der edit-Raum den CAP überschreitet.
# Der Member-only-Relay (config/test.toml, wie Prod group.einundzwanzig.space) lässt den
# Test-User NUR zu, weil der Admin ihn unten per `allowpubkey` hinzufügt.
# Hinweis: kind-10009 (persönliche Raum-Folgeliste) lehnt zooid als Gruppenrelay ab —
# sie gehört auf die eigenen Relays des Users; die App führt sie clientseitig.
set -uo pipefail
export PATH="$PATH:/home/user/go/bin"

ZOOID_DIR=/home/user/Code/zooid
ADMIN=b2ee09a54bedf17ee1db562bdddd75c48661d981eb52c49dc206c55ba8439414   # zooid-Admin-SECRET (= Relay-Key, self = da99fbe3…)
USER=76d709385088b75017085270143c45290c0d54b6204e4f9f08dd65b84a180853   # Wegwerf-Test-User-SECRET (= NOSTR_TEST_NSEC)
SELF=da99fbe39247109327ac8504750d0227d50a8f84049ac8bd2f6c7ad0806ed76d   # Relay-self-Pubkey (Owner)
VIEWER=2dbaf5f4f86a1eed0948852ad48fa40aae2e48d5e347a77fac2ac936d6c94e7b # Pubkey des Test-Users (pub von USER)
DEV=0adf67475ccc5ca456fd3022e46f5d526eb0af6284bf85494c0dd7847f3e5033    # Entwickler-npub (npub1pt0kw36…) — zum lokalen Mitschauen; NUR local
R=ws://localhost:3335
HTTP=http://localhost:3335
PIDFILE=/tmp/e2e-zooid-3335.pid
# Aufbläh-Schwelle: so viele kind-9 im (sonst leeren) edit-Raum toleriert der Guard,
# bevor er den Relay frisch aufsetzt. Ein Testlauf schreibt ~10; darüber = Alt-Bloat.
CAP=40

# Läuft schon ein sauberer, geseedeter, nicht aufgeblähter zooid? → wiederverwenden.
seeded_and_clean() {
    timeout 5 curl -sf -H 'Accept: application/nostr+json' "$HTTP" >/dev/null 2>&1 || return 1
    # edit-Mitgliedschaft ist das LETZTE Seed-Artefakt → ihr Vorhandensein ⇒ Seed fertig.
    timeout 8 nak req -k 39002 -d edit --auth --sec "$USER" "$R" 2>/dev/null | grep -q '"kind":39002' || return 1
    local n
    n=$(timeout 8 nak req -k 9 -t h=edit --auth --sec "$USER" "$R" 2>/dev/null | grep -c '"kind":9')
    [ "${n:-999}" -le "$CAP" ]
}

cd "$ZOOID_DIR" || exit 1
[ -f bin/zooid ] || CGO_ENABLED=1 go build -o bin/zooid cmd/relay/main.go

if seeded_and_clean; then
    echo "zooid:3335 bereits sauber geseedet → Wiederverwendung (kein Reset)"
    exit 0
fi

# Aufsetzen: alten/aufgeblähten zooid NUR auf :3335 stoppen (Mitschau :3334 bleibt).
[ -f "$PIDFILE" ] && kill "$(cat "$PIDFILE")" 2>/dev/null
fuser -k 3335/tcp 2>/dev/null
sleep 0.5

# Test-Config aus der lokalen test.toml ableiten, nur der Host wechselt auf :3335.
# zooid dispatcht per HTTP-Host (instancesByHost) → der Host MUSS zum Port passen.
mkdir -p config-test
sed 's/localhost:3334/localhost:3335/' config/test.toml > config-test/test.toml

# Frische SQLite je Aufsetzen im ISOLIERTEN data-test/ (nie das Mitschau-data/ von :3334).
rm -f data-test/db data-test/db-shm data-test/db-wal

# DETACHED starten (eigene Session, /dev/null-stdin) → überlebt das Skript-Ende, sodass
# der nächste Lauf ihn per Guard wiederverwenden kann. Kein `wait`, kein Trap.
setsid env PORT=3335 DATA=./data-test CONFIG=./config-test ./bin/zooid </dev/null >/tmp/e2e-zooid-3335.log 2>&1 &
echo "$!" > "$PIDFILE"

# Auf NIP-11 warten (Relay oben)
for _ in $(seq 1 40); do
    curl -sf -H 'Accept: application/nostr+json' "$HTTP" >/dev/null 2>&1 && break
    sleep 0.25
done

# Räume zuerst (kind 9007 → 39000) — der ADMIN (can_manage) darf immer schreiben.
nak event --auth --sec "$ADMIN" -k 9007 -t h=welcome -t name=Willkommen -t about=Startkanal "$R" >/dev/null 2>&1 || true
nak event --auth --sec "$ADMIN" -k 9007 -t h=general -t name=Allgemein -t about=Off-Topic "$R" >/dev/null 2>&1 || true
nak event --auth --sec "$ADMIN" -k 9007 -t h=dev -t name=Dev -t about=Entwicklung "$R" >/dev/null 2>&1 || true
nak event --auth --sec "$ADMIN" -k 9007 -t h=scroll -t name=Scroll -t about=Langer-Verlauf "$R" >/dev/null 2>&1 || true
# Raum mit Bild + Zugriffs-Flag (B2): `picture` → Avatar, `private` (Presence-Tag) → Schloss-Badge.
nak event --auth --sec "$ADMIN" -k 9007 -t h=vip -t name=VIP -t about=Privat -t picture=https://robohash.org/vip.png -t private "$R" >/dev/null 2>&1 || true
# Dedizierter Schreib-Raum für die C1-Reaktionstests: die schreiben (Nachricht +
# kind-7-Reactions) und dürfen daher NICHT „welcome" aufblähen (dessen Seed muss im
# 50er-Fenster bleiben, sonst reißt M4). Jeder C1-Test sendet seine eigene frische
# Nachricht und reagiert darauf — Bloat bleibt isoliert und stört nichts.
nak event --auth --sec "$ADMIN" -k 9007 -t h=react -t name=Reaktionen -t about=C1-Reaktionstests "$R" >/dev/null 2>&1 || true
# Dedizierter Schreib-Raum für die C2-Moderationstests (Löschen/Melden): schreiben
# eigene Nachrichten + Reports und dürfen daher „welcome" nicht aufblähen.
nak event --auth --sec "$ADMIN" -k 9007 -t h=mod -t name=Moderation -t about=C2-Moderationstests "$R" >/dev/null 2>&1 || true
# Dedizierter Schreib-Raum für die C3-Tests (Bearbeiten/Zitieren): schreiben eigene
# Nachrichten + Delete-Republish + Quote-Only und dürfen „welcome" nicht aufblähen.
nak event --auth --sec "$ADMIN" -k 9007 -t h=edit -t name=Bearbeiten -t about=C3-Edit-Zitat-Tests "$R" >/dev/null 2>&1 || true
# Dedizierter Schreib-Raum für die C4-Tests (Mentions/Copy/Info): schreiben eigene
# Nachrichten mit @-Mentions und dürfen „welcome" nicht aufblähen.
nak event --auth --sec "$ADMIN" -k 9007 -t h=mention -t name=Mentions -t about=C4-Mention-Tests "$R" >/dev/null 2>&1 || true

# NIP-86-Management (HTTP + NIP-98, als ADMIN). MUSS vor allen USER-Events laufen:
# Der Relay ist member-only (public_write=false, wie Prod), also darf der Test-User
# (VIEWER) erst publizieren, NACHDEM ein Admin ihn per `allowpubkey` zugelassen hat.
# Genau so läuft es auf group.einundzwanzig.space — Member fügen nur Admins hinzu.
mgmt() {
    local body="$1" hash evt auth
    hash=$(printf '%s' "$body" | sha256sum | cut -d' ' -f1)
    evt=$(nak event -k 27235 --sec "$ADMIN" -t u="$HTTP" -t method=POST -t payload="$hash" 2>/dev/null)
    auth=$(printf '%s' "$evt" | base64 -w0)
    curl -s -X POST "$HTTP" -H 'Content-Type: application/nostr+json+rpc' \
        -H "Authorization: Nostr $auth" -d "$body" >/dev/null 2>&1 || true
}
# Directory-Rollen (33534, HSL-Farbe).
mgmt '{"method":"createrole","params":["mod","Moderator","",["210","0.7","0.5"],"1"]}'
mgmt '{"method":"createrole","params":["member","Mitglied","",["150","0.6","0.45"],"2"]}'
mgmt "{\"method\":\"assignrole\",\"params\":[\"$SELF\",\"mod\"]}"
# Test-User als Relay-Member zulassen (`allowpubkey` → darf lesen/schreiben/joinen)
# UND ins Directory aufnehmen (`assignrole` → steht in der 13534 = Vereinsmitglied,
# das Gate greift für ihn NICHT). `allowpubkey` vor `assignrole`, sonst verwirft der
# frische Relay die Rolle.
mgmt "{\"method\":\"allowpubkey\",\"params\":[\"$VIEWER\"]}"
mgmt "{\"method\":\"assignrole\",\"params\":[\"$VIEWER\",\"member\"]}"
# Entwickler-npub zum lokalen Mitschauen ebenfalls als Member zulassen (NUR local).
mgmt "{\"method\":\"allowpubkey\",\"params\":[\"$DEV\"]}"
mgmt "{\"method\":\"assignrole\",\"params\":[\"$DEV\",\"member\"]}"

# Ab hier darf der Test-User publizieren (er ist zugelassenes Relay-Mitglied).
# Profile (kind 0) für lesbare Namen im Directory (M3).
nak event --auth --sec "$ADMIN" -k 0 -c '{"name":"Relay Admin"}' "$R" >/dev/null 2>&1 || true
nak event --auth --sec "$USER"  -k 0 -c '{"name":"Alice Test"}'  "$R" >/dev/null 2>&1 || true

# Raum-Mitgliedschaft (NIP-29, M5): Test-User tritt welcome + general + scroll bei
# (kind 9021). Als zugelassenes Relay-Mitglied wird sein JoinRequest akzeptiert —
# ein Fremder ohne `allowpubkey` käme hier NICHT durch (public_join=false). „dev"
# bleibt für den Join/Leave-E2E-Test ausgespart. Idempotent: schon Mitglied →
# „duplicate" (ignoriert). Der edit-Join steht ZULETZT — er ist das Verifikations-Artefakt.
nak event --auth --sec "$USER" -k 9021 -t h=welcome "$R" >/dev/null 2>&1 || true
nak event --auth --sec "$USER" -k 9021 -t h=general "$R" >/dev/null 2>&1 || true
nak event --auth --sec "$USER" -k 9021 -t h=scroll "$R" >/dev/null 2>&1 || true
nak event --auth --sec "$USER" -k 9021 -t h=react "$R" >/dev/null 2>&1 || true
nak event --auth --sec "$USER" -k 9021 -t h=mod "$R" >/dev/null 2>&1 || true
nak event --auth --sec "$USER" -k 9021 -t h=mention "$R" >/dev/null 2>&1 || true
nak event --auth --sec "$USER" -k 9021 -t h=edit "$R" >/dev/null 2>&1 || true

# Room-Chat (M4): kind-9-Nachrichten in „welcome" — nur wenn noch keine da sind
# (nak-Events sind nicht replaceable → Duplikate vermeiden).
if [ "$(nak req -k 9 -t h=welcome --auth --sec "$ADMIN" "$R" 2>/dev/null | grep -c '"kind":9')" -eq 0 ]; then
    nak event --auth --sec "$USER"  -k 9 -t h=welcome -c 'Willkommen im Space! 👋' "$R" >/dev/null 2>&1 || true
    nak event --auth --sec "$ADMIN" -k 9 -t h=welcome -c 'Schön, dass du da bist. Infos: https://einundzwanzig.space' "$R" >/dev/null 2>&1 || true
    nak event --auth --sec "$USER"  -k 9 -t h=welcome -c 'Danke!' "$R" >/dev/null 2>&1 || true
fi

# „scroll": 60 Fremd-Nachrichten (vom ADMIN, gestaffelte created_at) für die D1-
# Scroll-Tests — genug für Overflow (Jump/Unread) und >limit (50 → Auto-Load-Older).
# Gestaffelte Zeitstempel, damit die `until`-Pagination echte ältere Seiten liefert.
if [ "$(nak req -k 9 -t h=scroll --auth --sec "$ADMIN" "$R" 2>/dev/null | grep -c '"kind":9')" -eq 0 ]; then
    NOW=$(date +%s)
    for i in $(seq 1 60); do
        nak event --auth --sec "$ADMIN" -k 9 -t h=scroll --ts $((NOW - 60 + i)) -c "Zeile $i" "$R" >/dev/null 2>&1 || true
    done
fi

# Verifikation: erst zurückkehren, wenn das letzte Seed-Artefakt (edit-Mitgliedschaft)
# wirklich abrufbar ist — DAS beseitigt den Bind-vor-Seed-Race. globalSetup blockiert
# die Tests, bis dieses Skript hier durch ist.
for _ in $(seq 1 40); do
    timeout 5 nak req -k 39002 -d edit --auth --sec "$USER" "$R" 2>/dev/null | grep -q '"kind":39002' && break
    sleep 0.25
done
echo "zooid:3335 frisch aufgesetzt + geseedet + verifiziert"
