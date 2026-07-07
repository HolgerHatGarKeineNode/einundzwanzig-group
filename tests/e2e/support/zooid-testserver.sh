#!/usr/bin/env bash
# Startet den lokalen zooid-Relay für die E2E-Tests und seedet ihn idempotent:
# 3 Rooms (kind 9007 → 39000) + eine kind-10009-Membership für den Wegwerf-User.
# Läuft im Vordergrund (Playwright-webServer); zooid stirbt mit diesem Prozess.
set -uo pipefail
export PATH="$PATH:/home/user/go/bin"

ZOOID_DIR=/home/user/Code/zooid
ADMIN=b2ee09a54bedf17ee1db562bdddd75c48661d981eb52c49dc206c55ba8439414   # zooid-Admin (= Relay-Key)
USER=76d709385088b75017085270143c45290c0d54b6204e4f9f08dd65b84a180853   # Wegwerf-Test-User
R=ws://localhost:3334

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

wait $PID
