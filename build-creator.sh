#!/bin/sh
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
RELAY_DIR="$ROOT/relay"
CREATOR_DIR="$ROOT/creator-app"

echo "=== Building relay binaries ==="
cd "$RELAY_DIR"

echo "macOS (universal)..."
GOOS=darwin GOARCH=amd64 go build -o relay-darwin-amd64 .
GOOS=darwin GOARCH=arm64 go build -o relay-darwin-arm64 .
lipo -create -output relay-darwin relay-darwin-amd64 relay-darwin-arm64
rm relay-darwin-amd64 relay-darwin-arm64

echo "Windows x64..."
GOOS=windows GOARCH=amd64 go build -o relay-windows-x64.exe .
echo "Windows x86..."
GOOS=windows GOARCH=386 go build -o relay-windows-ia32.exe .

echo "Linux x64..."
GOOS=linux GOARCH=amd64 go build -o relay-linux-x64 .
echo "Linux x86..."
GOOS=linux GOARCH=386 go build -o relay-linux-ia32 .

ls -lh relay-darwin relay-windows-*.exe relay-linux-*

echo ""
echo "=== Building Electron apps ==="
cd "$CREATOR_DIR"
npm install --quiet 2>&1

# macOS (universal binary already)
echo ""
echo "--- macOS ---"
npx electron-builder --mac

# Windows x64
echo ""
echo "--- Windows x64 ---"
cp "$RELAY_DIR/relay-windows-x64.exe" "$RELAY_DIR/relay-bundle.exe"
npx electron-builder --win --x64

# Windows x86
echo ""
echo "--- Windows x86 ---"
cp "$RELAY_DIR/relay-windows-ia32.exe" "$RELAY_DIR/relay-bundle.exe"
npx electron-builder --win --ia32

# Linux x64
echo ""
echo "--- Linux x64 ---"
cp "$RELAY_DIR/relay-linux-x64" "$RELAY_DIR/relay-bundle"
npx electron-builder --linux --x64

# Cleanup
rm -f "$RELAY_DIR/relay-bundle" "$RELAY_DIR/relay-bundle.exe"

echo ""
echo "=== Done ==="
ls -lh "$ROOT/prebuilts/"
