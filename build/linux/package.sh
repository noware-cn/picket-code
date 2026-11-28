#!/usr/bin/env bash
# Linux package stage (aligned with the VSCodium pipeline).
#
# Usage: package.sh <linux> [x64|arm64]
#
# Expects vscode.tar.gz (produced by the compile job) under the repo root.
# Extracts it, renames the prebuilt VSCode-linux-<arch> folder to
# picket-code-linux-<arch> and creates a tar.gz archive. No compilation happens
# in this job, so a packaging failure never re-runs the ~4 min compile.
#
# Note: the modern upstream gulpfile already produced the complete product
# folder in the compile job (`vscode-linux-<arch>-min`), so this stage only
# renames and archives; the old VSCodium `-min-packing` gulp step does not
# exist on current tags.
set -euo pipefail

PLATFORM="${1:-linux}"
ARCH="${2:-x64}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

case "$PLATFORM" in
  linux) ;;
  *) echo "Unknown platform: $PLATFORM (expected linux)" >&2; exit 1 ;;
esac

case "$ARCH" in
  x64|arm64) ;;
  *) echo "Unknown arch: $ARCH (expected x64|arm64)" >&2; exit 1 ;;
esac

echo "==> [picket-code] Locating compile artifact"
TARBALL="$(find "$ROOT_DIR" -maxdepth 2 -name 'vscode.tar.gz' | head -1)"
if [ -z "$TARBALL" ]; then
  echo "vscode.tar.gz not found" >&2
  exit 1
fi
tar -xzf "$TARBALL" -C "$ROOT_DIR"

SRC_DIR="$ROOT_DIR/VSCode-linux-$ARCH"
if [ ! -d "$SRC_DIR" ]; then
  echo "Missing build output: $SRC_DIR" >&2
  exit 1
fi

echo "==> [picket-code] Renaming VSCode-linux-$ARCH -> picket-code-linux-$ARCH"
cd "$ROOT_DIR"
OUT_DIR="picket-code-linux-$ARCH"
rm -rf "$OUT_DIR"
mv "$SRC_DIR" "$OUT_DIR"

echo "==> [picket-code] Verifying the packaged WSL component (flavor: ${PICKET_WSL_PAYLOAD:-ondemand})"
node "$SCRIPT_DIR/../wsl/check.mjs" --app "$ROOT_DIR/$OUT_DIR/resources/app" --flavor "${PICKET_WSL_PAYLOAD:-ondemand}"

echo "==> [picket-code] Archiving"
tar czf "$ROOT_DIR/picket-code-linux-$ARCH.tar.gz" "$OUT_DIR"

echo "==> [picket-code] Linux package done"
ls -lh "$ROOT_DIR/picket-code-linux-$ARCH.tar.gz"
