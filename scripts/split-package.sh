#!/usr/bin/env bash
#
# split-package.sh — schneidet packages/einundzwanzig-group als eigenständige Historie
# heraus (git subtree split) und pusht sie force in ein schlankes, read-only
# Distributions-Repo. Nötig NUR, wenn ein Fremdhost das Package via Composer-VCS
# (statt lokalem Path-Repo) beziehen soll — Composer kann kein Repo-Unterverzeichnis
# requiren.
#
# Für die aktuelle lokale Integration (Portal via Composer path-repository auf den
# Nachbar-Ordner) wird dieses Script NICHT gebraucht.
#
# Regel (PLAN2.md Reibung 7): Der Split ist read-only. Chat-Code NIE im Ziel-Repo
# oder im Portal-vendor editieren — immer hier upstream, dann neu splitten.
#
# Nutzung:
#   scripts/split-package.sh <remote-git-url> [branch]
#   SPLIT_REMOTE=git@github.com:USER/REPO.git scripts/split-package.sh
#
set -euo pipefail

PREFIX="packages/einundzwanzig-group"
REMOTE="${1:-${SPLIT_REMOTE:-}}"
BRANCH="${2:-main}"
SPLIT_BRANCH="__nostr-chat-split"

if [[ -z "$REMOTE" ]]; then
    echo "Fehlt: Ziel-Remote. Aufruf: $0 <remote-git-url> [branch]" >&2
    echo "(Noch kein Distributions-Repo festgelegt — lokale Integration läuft über Path-Repo.)" >&2
    exit 1
fi

cd "$(git rev-parse --show-toplevel)"

echo "→ subtree split $PREFIX …"
git branch -D "$SPLIT_BRANCH" 2>/dev/null || true
git subtree split --prefix="$PREFIX" -b "$SPLIT_BRANCH"

echo "→ force-push nach $REMOTE ($BRANCH) …"
git push --force "$REMOTE" "$SPLIT_BRANCH:$BRANCH"

git branch -D "$SPLIT_BRANCH"
echo "✓ Split gepusht: $REMOTE ($BRANCH)"
