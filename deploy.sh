#!/usr/bin/env bash
#
# Deploy des Web-Clients auf den Forge-Server (Site group.einundzwanzig.space).
# Kein Git-Deploy: lokal bauen, per rsync hochladen, remote Composer + Migrationen.
# zooid (Go-Relay) läuft auf DEMSELBEN Host im Ordner ~/group.einundzwanzig.space —
# wir deployen daneben nach ~/webclient und fassen zooid NIE an.
#
# Voraussetzung (einmalig, siehe README-Abschnitt / Erst-Setup):
#   - SSH-Alias `21-dedicated-prod-web-zooid` erreichbar
#   - ~/webclient/.env existiert (APP_KEY gesetzt, SQLite migriert)
#
# Nutzung:  ./deploy.sh
set -euo pipefail

REMOTE="21-dedicated-prod-web-zooid"
APP_DIR="webclient"

echo "▸ 1/3  Production-Build (lokal)"
npm run build

# Assets vorkomprimieren: die hash-benannten Bundles sind unveränderlich, also
# einmal maximal komprimieren — nginx serviert die .gz mit `gzip_static on` ohne
# Request-CPU (statt dynamisch pro Request). Startup-Hebel auf langsamem Netz.
# .gz ist der AKTIVE Pfad (gzip_static ist im nginx-Core-Build vorhanden). .br
# wird zusätzlich erzeugt, falls/sobald das ngx_brotli-Modul installiert ist
# (`brotli_static on` → welshman ~302KB gz → ~230KB br). rsync -az nimmt beide mit.
GZ_ASSETS=$(find public/build/assets -type f \( -name '*.js' -o -name '*.css' \))
echo "  · gzip-Precompression der Build-Assets (-9)"
for f in $GZ_ASSETS; do gzip -9 -k -f "$f"; done
if command -v brotli >/dev/null 2>&1; then
    echo "  · Brotli-Precompression der Build-Assets (q11, für brotli_static)"
    for f in $GZ_ASSETS; do brotli -q 11 -k -f "$f"; done
fi

echo "▸ 2/3  rsync → ${REMOTE}:~/${APP_DIR}"
# --delete räumt entfernte Dateien auf; excluded Pfade (.env, DB, Logs) bleiben
# am Ziel erhalten (kein --delete-excluded). vendor/ baut Composer auf dem Server.
rsync -az --delete \
    --exclude='.git/' \
    --exclude='node_modules/' \
    --exclude='vendor/' \
    --exclude='/nativephp/' \
    --exclude='/native/' \
    --exclude='/test-results/' \
    --exclude='/playwright-report/' \
    --exclude='.env' \
    --exclude='.env.*' \
    --exclude='/database/*.sqlite*' \
    --exclude='/storage/logs/*' \
    --exclude='/storage/framework/cache/data/*' \
    --exclude='/storage/framework/sessions/*' \
    --exclude='/storage/framework/views/*' \
    --exclude='/public/hot' \
    --exclude='/public/build/.vite/' \
    --exclude='/tests/' \
    --exclude='/deploy.sh' \
    --exclude='.claude/' \
    ./ "${REMOTE}:${APP_DIR}/"

echo "▸ 3/4  Remote: Composer + Migrationen + Cache"
ssh "$REMOTE" "cd ${APP_DIR} && \
    composer install --no-dev --optimize-autoloader --no-interaction && \
    php artisan migrate --force && \
    php artisan optimize && \
    php artisan storage:link 2>/dev/null || true"

echo "▸ 4/4  FPM-Opcache leeren (Forge-API php-reload)"
# Prod-FPM läuft mit opcache.validate_timestamps=0 → neue Blades/Klassen greifen
# NICHT ohne Reload. Der Site-User hat kein sudo; Forge reloadet FPM als root.
# (Graceful — betrifft nur PHP-Pools, nicht den zooid-Go-Prozess.)
FORGE_ORG=prime-software; FORGE_SERVER=1147867; PHP_VERSION=php84
tok=$(python3 -c "import json;print(json.load(open('$HOME/.laravel-forge/config.json'))['token'])" 2>/dev/null || echo "")
if [ -n "$tok" ]; then
    curl -s -X POST "https://forge.laravel.com/api/orgs/${FORGE_ORG}/servers/${FORGE_SERVER}/services/php/actions" \
        -H "Authorization: Bearer $tok" -H "Accept: application/json" -H "Content-Type: application/json" \
        -d "{\"action\":\"reload\",\"version\":\"${PHP_VERSION}\"}" \
        -o /dev/null -w "  php-reload → HTTP %{http_code}\n"
else
    echo "  ⚠ Kein Forge-Token gefunden — FPM manuell reloaden, sonst bleiben alte Texte/Klassen im Opcache."
fi

echo "✓ Deploy fertig — https://group.einundzwanzig.space/"
