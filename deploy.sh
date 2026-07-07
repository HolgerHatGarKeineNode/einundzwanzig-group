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
    --exclude='/database/*.sqlite' \
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

echo "▸ 3/3  Remote: Composer + Migrationen + Cache"
ssh "$REMOTE" "cd ${APP_DIR} && \
    composer install --no-dev --optimize-autoloader --no-interaction && \
    php artisan migrate --force && \
    php artisan optimize && \
    php artisan storage:link 2>/dev/null || true"
# ponytail: kein fpm-reload (Site-User hat kein sudo). Forge-Opcache revalidiert
# per Timestamp; falls stale, Deploy-Hook im Forge-Dashboard triggern.

echo "✓ Deploy fertig — https://group.einundzwanzig.space/"
