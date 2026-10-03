#!/usr/bin/env bash
# Install STI-testing-chat from a local macOS .dmg produced by `npm run build:installer`.
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This script is for macOS. On Windows run: powershell -File scripts/install-windows.ps1" >&2
  echo "A Linux .deb or AppImage will not install on this machine via this script." >&2
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUNDLE_DIR="$ROOT/src-tauri/target/release/bundle/dmg"

pick_dmg() {
  if [[ -n "${1:-}" ]]; then
    echo "$1"
    return
  fi
  local found
  found="$(ls -t "$BUNDLE_DIR"/*.dmg 2>/dev/null | head -n 1 || true)"
  echo "$found"
}

DMG="$(pick_dmg "${1:-}")"

if [[ -z "$DMG" || ! -f "$DMG" ]]; then
  echo "No macOS installer (.dmg) found." >&2
  echo "Build on macOS first (needs Node.js, Rust/cargo, and Tauri prerequisites):" >&2
  echo "  cd \"$ROOT\"" >&2
  echo "  npm install" >&2
  echo "  npm run build:installer" >&2
  echo "Then re-run: scripts/install-macos.sh" >&2
  echo "Or pass a .dmg path: scripts/install-macos.sh /path/to/STI-testing-chat.dmg" >&2
  exit 1
fi

echo "Opening STI-testing-chat installer: $DMG"
open "$DMG"
echo "Drag STI-testing-chat into Applications if the disk image window asks you to."
