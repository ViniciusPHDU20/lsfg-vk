#!/bin/bash
# ================================================================
#  SOBERANO LSFG MANAGER - LAUNCHER HYPRLAND / WAYLAND
# ================================================================

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN="$DIR/bin/soberano-lsfg-manager"

if [ ! -f "$BIN" ]; then
    BIN="/usr/local/bin/soberano-lsfg-manager"
fi

# Flags essenciais para compatibilidade WebKitGTK / Hyprland
export GDK_BACKEND=x11
export WEBKIT_DISABLE_COMPOSITING_MODE=1
export WEBKIT_USE_SINGLE_WEB_PROCESS=1

exec "$BIN" "$@"
