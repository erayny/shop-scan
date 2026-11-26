#!/usr/bin/env bash
# Builds Liftside Bridge for Windows (32- and 64-bit) with the web app embedded.
# Output: dist-bridge/liftside-bridge-32.exe, dist-bridge/liftside-bridge-64.exe
set -euo pipefail
cd "$(dirname "$0")/.."
npm run build
find bridge/web -mindepth 1 ! -name .gitkeep -exec rm -rf {} +
cp -r dist/. bridge/web/
mkdir -p dist-bridge
(cd bridge && go test ./...)
(cd bridge && GOOS=windows GOARCH=386   CGO_ENABLED=0 go build -trimpath -ldflags "-s -w" -o ../dist-bridge/liftside-bridge-32.exe .)
(cd bridge && GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags "-s -w" -o ../dist-bridge/liftside-bridge-64.exe .)
(cd bridge && CGO_ENABLED=0 go build -trimpath -o ../dist-bridge/liftside-bridge-linux .)   # for the e2e test only
ls -la dist-bridge
