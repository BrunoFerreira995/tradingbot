#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

version="$(bun -p "require('./src-tauri/tauri.conf.json').version")"
arch="$(uname -m)"
if [[ "$arch" == "arm64" ]]; then
  target_arch="aarch64"
else
  target_arch="x86_64"
fi

bunx tauri build --bundles app --no-sign

bundle="src-tauri/target/release/bundle"
app="$bundle/macos/TradingBot.app"
out="$bundle/dmg/TradingBot_${version}_${target_arch}.dmg"

find "$bundle/macos" -maxdepth 1 -name 'rw.*' -delete

staging="$(mktemp -d /tmp/tradingbot-dmg.XXXXXX)"
trap 'rm -rf "$staging"' EXIT
ditto "$app" "$staging/TradingBot.app"
ln -s /Applications "$staging/Applications"

hdiutil create \
  -volname "TradingBot" \
  -srcfolder "$staging" \
  -ov \
  -format UDZO \
  "$out"
hdiutil verify "$out"

mkdir -p releases
cp "$out" "releases/"

ls -lh "$app" "$out" "releases/$(basename "$out")"
