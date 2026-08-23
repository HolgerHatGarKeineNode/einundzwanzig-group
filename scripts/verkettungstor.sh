#!/usr/bin/env bash
#
# VERKETTUNGS-TOR (P3, Plan `2026-08-23T1745-forge-mobil-desktop-amethyst.md`, Schritt 15).
#
# Kettet die drei Prüfebenen der Forge über alle drei beteiligten Repos und bricht beim
# ERSTEN Rot ab (set -e, kein Weiterlaufen der nächsten Ebene):
#
#   1. Paket-Unit   — js/*.test.ts des Pakets `einundzwanzig-group` (Node-Testrunner,
#                      keine Browser, keine Relays: reine Logik — Faltung, Reader, Gates).
#   2. App-A11y     — K1–K4 der Barrierefreiheits-Messreihe gegen `/forge` u. a.
#                      (`twenty-one-companion`, echter Chromium, Host-Symlink-Wiring).
#   3. Web-E2E      — die Playwright-Suite dieses Repos (echter Chromium, worker-eigene
#                      zooid- + `php artisan serve`-Instanzen, Standard-Modus).
#
# Absichtlich in dieser Reihenfolge — billig vor teuer: ein Fehler in der reinen
# Paket-Logik bricht in Sekunden ab, statt erst nach zwei vollen Browser-Suiten
# sichtbar zu werden.
#
# ── Warum es dieses Skript noch nicht gab ────────────────────────────────────────────
# Keins der drei Repos hat CI. `deploy.sh` dieses Repos fährt vor jedem Deploy nur
# `php artisan test` (Schritt 1/5 dort) — weder `npm run test:unit` (Paket-Unit) noch
# die Playwright-Suite (Web-E2E) laufen in irgendeinem Tor, und `/forge` kam bis P3 in
# KEINEM der drei Repos in einem automatisierten Lauf vor.
#
# ── Nutzung ───────────────────────────────────────────────────────────────────────────
#   scripts/verkettungstor.sh
#   APP_REPO=/anderer/pfad scripts/verkettungstor.sh    (App-Repo woanders ausgecheckt)
#   E2E_RELAY=buzz scripts/verkettungstor.sh             (Web-E2E im Buzz-Modus)
#
# Läuft NICHT automatisch aus `deploy.sh` mit — das Verdrahten in den Deploy-Pfad ist
# eine eigene, hier bewusst NICHT getroffene Entscheidung (siehe Abgabebericht P3).
set -euo pipefail

HIER="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$HIER"

# Der App-Repo-Fuß liegt NICHT unter diesem Checkout. Default: Geschwister-Verzeichnis
# desselben Nutzer-Workspace (…/Code/twenty-one-companion neben …/Code/einundzwanzig-
# group) — so ist auf diesem Rechner heute ausgecheckt. Wer anders ausgecheckt hat,
# überschreibt per APP_REPO=.
APP_REPO="${APP_REPO:-$(cd "$HIER/.." && pwd)/twenty-one-companion}"

if [ ! -d "$APP_REPO" ]; then
    echo "✗ App-Repo (twenty-one-companion) nicht gefunden unter: $APP_REPO" >&2
    echo "  APP_REPO=/pfad/zu/twenty-one-companion scripts/verkettungstor.sh" >&2
    exit 1
fi

echo "▸ 1/3  Paket-Unit (packages/*/js/**/*.test.ts)"
node --test --experimental-strip-types "packages/*/js/**/*.test.ts"
echo "  ✓ Paket-Unit grün"
echo

echo "▸ 2/3  App-A11y (K1–K4 gegen /forge u. a. — $APP_REPO)"
(cd "$APP_REPO" && bash scripts/run-browser.sh --group=a11y)
echo "  ✓ App-A11y grün"
echo

echo "▸ 3/3  Web-E2E (Playwright, dieses Repo)"
npm run test:e2e
echo "  ✓ Web-E2E grün"
echo

echo "✓ Verkettungs-Tor: alle drei Ebenen bestanden."
