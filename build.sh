#!/usr/bin/env bash
# Build PalaceV1 load tester: install deps and produce PalaceV1.app via electron-packager.
set -euo pipefail

cd "$(dirname "$0")"

echo "==> Installing dependencies"
npm install

echo "==> Packaging (electron-packager)"
npm run build

APP_PATH=$(find release-builds -maxdepth 2 -name "PalaceV1.app" -type d 2>/dev/null | head -1)
if [[ -z "${APP_PATH}" ]]; then
  echo "error: could not find PalaceV1.app under release-builds/" >&2
  exit 1
fi

echo "==> Clearing extended attributes on .app (quarantine / Gatekeeper flags)"
xattr -cr "${APP_PATH}"

echo ""
echo "Done. Open the app from:"
echo "  $(pwd)/${APP_PATH}"
