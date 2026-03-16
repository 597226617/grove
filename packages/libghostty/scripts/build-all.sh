#!/usr/bin/env bash
#
# Cross-compile libghostty-vt for all supported platforms.
#
# Prerequisites:
#   - Zig installed (zig build available)
#   - Network access to fetch ghostty source (first build only)
#
# Output:
#   platforms/darwin-arm64/libghostty-vt.dylib
#   platforms/darwin-x64/libghostty-vt.dylib
#   platforms/linux-arm64/libghostty-vt.so
#   platforms/linux-x64/libghostty-vt.so

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACKAGE_DIR="$(dirname "$SCRIPT_DIR")"
PLATFORMS_DIR="$PACKAGE_DIR/platforms"

build_target() {
  local zig_target="$1"
  local platform_dir="$2"
  local lib_ext="$3"

  echo "Building for $zig_target..."
  mkdir -p "$PLATFORMS_DIR/$platform_dir"

  cd "$PACKAGE_DIR"
  zig build lib-vt -Dtarget="$zig_target" -Doptimize=ReleaseFast

  # Copy the built library to the platforms directory
  local src="zig-out/lib/libghostty-vt.$lib_ext"
  if [ -f "$src" ]; then
    cp "$src" "$PLATFORMS_DIR/$platform_dir/"
    echo "  -> $PLATFORMS_DIR/$platform_dir/libghostty-vt.$lib_ext"
  else
    echo "  WARNING: $src not found"
  fi
}

echo "Building libghostty-vt for all platforms..."
echo ""

build_target "aarch64-macos"  "darwin-arm64" "dylib"
build_target "x86_64-macos"   "darwin-x64"   "dylib"
build_target "aarch64-linux"  "linux-arm64"  "so"
build_target "x86_64-linux"   "linux-x64"    "so"

echo ""
echo "Done! Platform binaries:"
find "$PLATFORMS_DIR" -type f -name "libghostty-vt.*" | sort
