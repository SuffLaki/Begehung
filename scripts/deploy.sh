#!/usr/bin/env bash
# Baut die App und veröffentlicht den Inhalt von dist/ im Branch gh-pages (GitHub Pages).
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="/c/Program Files/nodejs:$PATH"
REMOTE=$(git remote get-url origin)
npx tsc -b
npx vite build
touch dist/.nojekyll
TMP=$(mktemp -d)
cp -r dist/. "$TMP"
cd "$TMP"
git init -q -b gh-pages
git config user.name "$(git -C "$OLDPWD" config user.name)"
git config user.email "$(git -C "$OLDPWD" config user.email)"
git add -A
git commit -q -m "Veröffentlichung $(date '+%Y-%m-%d %H:%M')"
git push -f "$REMOTE" gh-pages
cd - >/dev/null
rm -rf "$TMP"
echo "Veröffentlicht."
