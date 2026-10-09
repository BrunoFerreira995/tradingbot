#!/usr/bin/env bash
# Compiles packages/broker/src/mt5/AurumBridge.mq5 with the MetaEditor that
# ships inside the MetaTrader 5 macOS app (a bundled Wine prefix).
#
# Wine mangles arguments that contain spaces, so the source is staged into
# drive_c/ under a space-free name before MetaEditor is invoked.
set -euo pipefail

MT5_APP="${MT5_APP:-/Applications/MetaTrader 5.app}"
WINEPREFIX="${WINEPREFIX:-$HOME/Library/Application Support/net.metaquotes.wine.metatrader5}"
WINE="$MT5_APP/Contents/SharedSupport/wine/bin/wine64"
SOURCE="$(cd "$(dirname "$0")/.." && pwd)/src/mt5/AurumBridge.mq5"

[ -x "$WINE" ] || { echo "wine64 not found: $WINE" >&2; exit 1; }
[ -f "$SOURCE" ] || { echo "source not found: $SOURCE" >&2; exit 1; }

STAGE="$WINEPREFIX/drive_c"
cp "$SOURCE" "$STAGE/AurumBridge.mq5"
rm -f "$STAGE/AurumBridge.log" "$STAGE/AurumBridge.ex5"

export WINEPREFIX WINEDEBUG=-all
(cd "$STAGE" && "$WINE" 'C:\Program Files\MetaTrader 5\MetaEditor64.exe' \
  /portable /compile:C:\\AurumBridge.mq5 /log >/dev/null 2>&1) || true

LOG="$STAGE/AurumBridge.log"
if [ ! -f "$LOG" ]; then echo "MetaEditor produced no compile log" >&2; exit 1; fi

SUMMARY="$(iconv -f UTF-16LE -t UTF-8 "$LOG" 2>/dev/null | tail -n 1)"
echo "$SUMMARY"

if [ -f "$STAGE/AurumBridge.ex5" ]; then
  echo "compiled -> $STAGE/AurumBridge.ex5"
  exit 0
fi

echo "--- diagnostics ---" >&2
iconv -f UTF-16LE -t UTF-8 "$LOG" 2>/dev/null | sed -n '2,200p' >&2
exit 1
