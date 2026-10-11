#!/usr/bin/env bash
# Lokale Vorschau für Harry: ohne Offline-Zwischenspeicher, mit Hinweis „noch nicht veröffentlicht“.
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="/c/Program Files/nodejs:$PATH"
VITE_PREVIEW_BANNER=1 npx vite build --outDir dist-preview
cp scripts/kill-sw.js dist-preview/sw.js   # entfernt alte Service Worker aus früheren Vorschauen
echo "Vorschau gebaut: npx vite preview --outDir dist-preview --port 4174"
