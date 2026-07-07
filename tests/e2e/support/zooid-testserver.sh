#!/usr/bin/env bash
# Startet den lokalen zooid-Relay für die E2E-Tests und seedet ihn idempotent:
# 3 Rooms (kind 9007 → 39000) + eine kind-10009-Membership für den Wegwerf-User.
# Läuft im Vordergrund (Playwright-webServer); zooid stirbt mit diesem Prozess.
set -uo pipefail
export PATH="$PATH:/home/user/go/bin"

ZOOID_DIR=/home/user/Code/zooid
ADMIN=b2ee09a54bedf17ee1db562bdddd75c48661d981eb52c49dc206c55ba8439414   # zooid-Admin-SECRET (= Relay-Key, self = da99fbe3…)
USER=76d709385088b75017085270143c45290c0d54b6204e4f9f08dd65b84a180853   # Wegwerf-Test-User-SECRET (= NOSTR_TEST_NSEC)
SELF=da99fbe39247109327ac8504750d0227d50a8f84049ac8bd2f6c7ad0806ed76d   # Relay-self-Pubkey (Owner)
VIEWER=2dbaf5f4f86a1eed0948852ad48fa40aae2e48d5e347a77fac2ac936d6c94e7b # Pubkey des Test-Users (pub von USER)
R=ws://localhost:3334
HTTP=http://localhost:3334

cd "$ZOOID_DIR" || exit 1
[ -f bin/zooid ] || CGO_ENABLED=1 go build -o bin/zooid cmd/relay/main.go

PORT=3334 ./bin/zooid &
PID=$!
trap 'kill $PID 2>/dev/null' EXIT INT TERM

# Auf NIP-11 warten (Relay oben)
for _ in $(seq 1 40); do
    curl -sf -H 'Accept: application/nostr+json' http://localhost:3334 >/dev/null 2>&1 && break
    sleep 0.25
done

# Idempotent seeden — Rooms existieren evtl. schon (dann Fehler ignorieren),
# die 10009 ist replaceable und wird überschrieben.
nak event --auth --sec "$ADMIN" -k 9007 -t h=welcome -t name=Willkommen -t about=Startkanal "$R" >/dev/null 2>&1 || true
nak event --auth --sec "$ADMIN" -k 9007 -t h=general -t name=Allgemein -t about=Off-Topic "$R" >/dev/null 2>&1 || true
nak event --auth --sec "$ADMIN" -k 9007 -t h=dev -t name=Dev -t about=Entwicklung "$R" >/dev/null 2>&1 || true
nak event --auth --sec "$USER" -k 10009 -t r="$R" -t group="welcome;$R" -t group="general;$R" "$R" >/dev/null 2>&1 || true

# Profile (kind 0) für lesbare Namen im Directory (M3) — AUTH nötig zum Schreiben.
nak event --auth --sec "$ADMIN" -k 0 -c '{"name":"Relay Admin"}' "$R" >/dev/null 2>&1 || true
nak event --auth --sec "$USER"  -k 0 -c '{"name":"Alice Test"}'  "$R" >/dev/null 2>&1 || true

# Directory (M3): 2 Rollen (33534, HSL-Farbe) + Zuweisungen über NIP-86
# (HTTP + NIP-98). `assignrole` legt den Member automatisch in der 13534 an.
mgmt() {
    local body="$1" hash evt auth
    hash=$(printf '%s' "$body" | sha256sum | cut -d' ' -f1)
    evt=$(nak event -k 27235 --sec "$ADMIN" -t u="$HTTP" -t method=POST -t payload="$hash" 2>/dev/null)
    auth=$(printf '%s' "$evt" | base64 -w0)
    curl -s -X POST "$HTTP" -H 'Content-Type: application/nostr+json+rpc' \
        -H "Authorization: Nostr $auth" -d "$body" >/dev/null 2>&1 || true
}
mgmt '{"method":"createrole","params":["mod","Moderator","",["210","0.7","0.5"],"1"]}'
mgmt '{"method":"createrole","params":["member","Mitglied","",["150","0.6","0.45"],"2"]}'
mgmt "{\"method\":\"assignrole\",\"params\":[\"$SELF\",\"mod\"]}"
mgmt "{\"method\":\"assignrole\",\"params\":[\"$VIEWER\",\"member\"]}"

wait $PID
