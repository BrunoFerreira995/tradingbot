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
entitlements="$PWD/entitlements.plist"

# Prefer an explicit identity; otherwise auto-detect a Developer ID Application
# certificate. Without one, fall back to ad-hoc signing (Gatekeeper flags it).
sign_identity="${MACOS_SIGN_IDENTITY:-}"
if [[ -z "$sign_identity" ]]; then
  sign_identity="$(security find-identity -v -p codesigning 2>/dev/null \
    | sed -n 's/.*"\(Developer ID Application[^"]*\)".*/\1/p' | head -1)"
fi

# Notarization credentials: either a stored notarytool profile or Apple ID trio.
notary_args=()
if [[ -n "${MACOS_NOTARY_PROFILE:-}" ]]; then
  notary_args=(--keychain-profile "$MACOS_NOTARY_PROFILE")
elif [[ -n "${APPLE_ID:-}" && -n "${APPLE_TEAM_ID:-}" && -n "${APPLE_APP_PASSWORD:-}" ]]; then
  notary_args=(--apple-id "$APPLE_ID" --team-id "$APPLE_TEAM_ID" --password "$APPLE_APP_PASSWORD")
fi

notarize() {
  local target="$1"
  [[ ${#notary_args[@]} -gt 0 ]] || return 0
  echo "Notarizing $(basename "$target") (this can take a few minutes)..."
  xcrun notarytool submit "$target" "${notary_args[@]}" --wait
  xcrun stapler staple "$target"
  xcrun stapler validate "$target"
}

if [[ -n "$sign_identity" ]]; then
  echo "Signing with: $sign_identity"
  # tauri build --no-sign does not sign the bundled runtime binaries, so sign
  # every Mach-O under Resources before sealing the app bundle itself.
  while IFS= read -r -d '' bin; do
    codesign --force --options runtime --timestamp \
      --entitlements "$entitlements" --sign "$sign_identity" "$bin"
  done < <(find "$app/Contents/Resources/embed" -type f -print0 \
    | while IFS= read -r -d '' f; do
        file "$f" | grep -q 'Mach-O' && printf '%s\0' "$f"
      done)
  codesign --force --deep --options runtime --timestamp \
    --entitlements "$entitlements" --sign "$sign_identity" "$app"
  codesign --verify --deep --strict --verbose=2 "$app"

  if [[ ${#notary_args[@]} -eq 0 ]]; then
    echo "WARNING: no notarization credentials; set MACOS_NOTARY_PROFILE or APPLE_ID/APPLE_TEAM_ID/APPLE_APP_PASSWORD." >&2
  else
    tmp_zip="$(mktemp -d /tmp/tradingbot-notary.XXXXXX)/TradingBot.zip"
    ditto -c -k --keepParent "$app" "$tmp_zip"
    notarize "$tmp_zip"
    rm -rf "$(dirname "$tmp_zip")"
  fi
else
  echo "WARNING: no Developer ID Application identity found; falling back to ad-hoc signing (Gatekeeper will flag the app)." >&2
  codesign --force --deep --sign - "$app"
  codesign --verify --deep --strict "$app"
fi

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
notarize "$out"

mkdir -p releases
cp "$out" "releases/"

ls -lh "$app" "$out" "releases/$(basename "$out")"
