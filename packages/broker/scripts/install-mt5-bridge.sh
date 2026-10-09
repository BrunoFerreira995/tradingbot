#!/usr/bin/env bash
# Compiles AurumBridge.mq5 with the MetaEditor bundled in the MetaTrader 5 macOS
# app, then deploys it into the terminal's MQL5/Services folder.
#
# Wine mangles arguments containing spaces, so the source is staged into
# drive_c/ under a space-free name before MetaEditor is invoked, and the
# resulting .ex5 is moved back afterwards.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE="$ROOT/src/mt5/AurumBridge.mq5"
BUILD="$ROOT/scripts/build-mq5.sh"

MT5_APP="${MT5_APP:-/Applications/MetaTrader 5.app}"
WINEPREFIX="${WINEPREFIX:-$HOME/Library/Application Support/net.metaquotes.wine.metatrader5}"
INSTALL="$WINEPREFIX/drive_c/Program Files/MetaTrader 5"
BRIDGE_DIR="$WINEPREFIX/drive_c/users/user/AppData/Roaming/MetaQuotes/Terminal/Common/Files"

[ -d "$INSTALL/MQL5" ] || {
  echo "MetaTrader 5 MQL5 folder not found at $INSTALL/MQL5" >&2
  echo "Override WINEPREFIX or MT5_APP if the terminal lives elsewhere." >&2
  exit 1
}

"$BUILD"

STAGE="$WINEPREFIX/drive_c"
mkdir -p "$INSTALL/MQL5/Services" "$BRIDGE_DIR"
cp "$STAGE/AurumBridge.mq5" "$INSTALL/MQL5/Services/AurumBridge.mq5"
cp "$STAGE/AurumBridge.ex5" "$INSTALL/MQL5/Services/AurumBridge.ex5"

echo "deployed  -> $INSTALL/MQL5/Services/AurumBridge.ex5"
echo "bridge    -> $BRIDGE_DIR"
echo
echo "Next steps, in the terminal:"
echo "  1. Log in to the broker account"
echo "  2. Navigator (Ctrl+N) -> Expert Advisors -> Services -> Add AurumBridge"
echo "  3. Tools -> Options -> Expert Advisors -> Allow automated trading"
echo
echo "The service only publishes snapshots once it is started; the API waits"
echo "for aurum-heartbeat.json before it will accept signals."
