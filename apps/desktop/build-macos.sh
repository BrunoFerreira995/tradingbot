#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"
root="$(cd ../.. && pwd)"
embed="$PWD/embed"

version="$(bun -p "require('./src-tauri/tauri.conf.json').version")"
arch="$(uname -m)"
if [[ "$arch" == "arm64" ]]; then
  target_arch="aarch64"
else
  target_arch="x86_64"
fi

rm -rf "$embed"
mkdir -p "$embed/web" "$embed/migrations" "$embed/packages"

pg_prefix="${PG_PREFIX:-$(brew --prefix postgresql@16 2>/dev/null || true)}"
if [[ -z "$pg_prefix" || ! -x "$pg_prefix/bin/initdb" ]]; then
  echo "PostgreSQL 16 not found. Install it with: brew install postgresql@16" >&2
  echo "Or set PG_PREFIX to a PostgreSQL 16 prefix." >&2
  exit 1
fi

bun --filter '@trade/web' build
cp -R "$root/apps/web/.next/standalone/." "$embed/web/"
mkdir -p "$embed/web/apps/web/.next"
cp -R "$root/apps/web/.next/static" "$embed/web/apps/web/.next/static"
if [[ -d "$root/apps/web/public" ]]; then
  cp -R "$root/apps/web/public" "$embed/web/apps/web/public"
fi

NODE_ENV=production bun build "$root/apps/api/src/index.ts" \
  --target=bun \
  --outfile "$embed/api.js"

cp "$(command -v bun)" "$embed/bun"
chmod +x "$embed/bun"
cp -R "$root/packages/broker" "$embed/packages/broker"
cp -R "$root/packages/database/drizzle/." "$embed/migrations/"
python3 "$PWD/bundle-postgres.py" "$pg_prefix" "$embed/postgres"
chmod -R u+w "$embed"

rm -rf src-tauri/target/release/embed src-tauri/target/debug/embed
rm -rf src-tauri/target/release/bundle/macos/TradingBot.app
bunx tauri build --bundles app --no-sign

bundle="src-tauri/target/release/bundle"
app="$bundle/macos/TradingBot.app"
out="$bundle/dmg/TradingBot_${version}_${target_arch}.dmg"

find "$bundle/macos" -maxdepth 1 -name 'rw.*' -delete

staging="$(mktemp -d /tmp/tradingbot-dmg.XXXXXX)"
trap 'rm -rf "$staging" "$embed"' EXIT
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
