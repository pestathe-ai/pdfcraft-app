#!/usr/bin/env bash
# Scarica PDFCraft alla versione indicata in UPSTREAM_REF, lo compila come sito
# statico e lo copia dentro l'app Android (android/app/src/main/assets/www).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REF="$(tr -d '[:space:]' < "$ROOT/UPSTREAM_REF")"
SRC="$ROOT/upstream"
DEST="$ROOT/android/app/src/main/assets/www"

rm -rf "$SRC"
mkdir -p "$SRC"
cd "$SRC"
git init -q
git remote add origin https://github.com/PDFCraftTool/pdfcraft
git -c protocol.version=2 fetch -q --depth 1 origin "$REF"
git checkout -q FETCH_HEAD
echo "PDFCraft $(git rev-parse --short HEAD)"

# Modifiche per il telefono (interfaccia "app", Converti, ODT, editor a schermo intero...)
for p in "$ROOT"/patches/*.patch; do
  [ -e "$p" ] || continue
  echo "Applico $(basename "$p")"
  git apply --whitespace=nowarn "$p"
done

# DOCKER_BUILD=true: niente copie decompresse di LibreOffice (+250 MB) e niente file
# spezzati in pezzi; l'app decomprime al volo i .gz.
export DOCKER_BUILD=true
export DISABLE_UPDATE_CHECK=true
export NEXT_PUBLIC_APP_MODE=android
export NEXT_TELEMETRY_DISABLED=1
export NODE_OPTIONS="--max-old-space-size=6144"
export APP_VERSION="android-$(git rev-parse --short HEAD)"

npm ci --no-audit --no-fund
npm run build

rm -rf "$DEST"
mkdir -p "$DEST"
cp -a out/. "$DEST/"
# Ogni lingua occupa ~60 MB di pagine: teniamo solo italiano e inglese.
for loc in ar cs de es fr he hi id ja ko pl pt ro vi zh zh-TW; do rm -rf "$DEST/$loc"; done
# Le mappe dei sorgenti servono solo a chi sviluppa: le togliamo per alleggerire l'APK.
find "$DEST" -name '*.map' -delete

test -f "$DEST/index.html"
test -f "$DEST/it/index.html"
echo "Sito copiato: $(du -sh "$DEST" | cut -f1), $(find "$DEST" -type f | wc -l) file"
