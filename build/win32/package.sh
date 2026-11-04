#!/usr/bin/env bash
# Windows package stage (aligned with the VSCodium pipeline).
#
# Usage: package.sh <win32> [x64|arm64]
#
# Expects vscode.tar.gz (produced by the compile job) under the repo root.
# Extracts it, renames the prebuilt VSCode-win32-<arch> folder to
# picket-code-win32-<arch> and creates a zip. No compilation happens in this job,
# so a packaging failure never re-runs the ~4 min compile.
#
# Windows rename is hardened: kill processes locking the tree, clear
# read-only attributes, retry the move, robocopy /MOVE fallback. The zip is
# created with 7z when available, else the Windows bsdtar (tar.exe), else
# PowerShell Compress-Archive (slow path).
set -euo pipefail

PLATFORM="${1:-win32}"
ARCH="${2:-x64}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

case "$PLATFORM" in
  win32) ;;
  *) echo "Unknown platform: $PLATFORM (expected win32)" >&2; exit 1 ;;
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

SRC_DIR="$ROOT_DIR/VSCode-win32-$ARCH"
if [ ! -d "$SRC_DIR" ]; then
  echo "Missing build output: $SRC_DIR" >&2
  exit 1
fi

echo "==> [picket-code] Renaming VSCode-win32-$ARCH -> picket-code-win32-$ARCH"
cd "$ROOT_DIR"
OUT_DIR="picket-code-win32-$ARCH"
rm -rf "$OUT_DIR"

# Windows 下 mv 报 Permission denied 的常见根因：文件被残留进程占用、
# 只读属性、或 Defender 实时扫描的瞬时文件锁。先处理前两类，再带重试
# 移动，最后用 robocopy /MOVE 兜底。
powershell -NoProfile -Command \
  "Get-Process | Where-Object { \$_.Path -like '*VSCode-win32-$ARCH*' } | Stop-Process -Force -ErrorAction SilentlyContinue" || true
powershell -NoProfile -Command "attrib -R 'VSCode-win32-$ARCH\*.*' /S /D" || true
MOVED=0
for i in 1 2 3 4 5; do
  if mv "VSCode-win32-$ARCH" "$OUT_DIR" 2>/dev/null; then
    MOVED=1
    break
  fi
  echo "move retry $i/5 (Windows rename failure is usually transient)..." >&2
  sleep 3
done
if [ "$MOVED" -ne 1 ]; then
  echo "mv retries exhausted; trying robocopy /MOVE fallback..." >&2
  robocopy "VSCode-win32-$ARCH" "$OUT_DIR" /E /MOVE /R:3 /W:2 >/dev/null || true
  [ -d "$OUT_DIR" ] && MOVED=1
fi
if [ "$MOVED" -ne 1 ]; then
  echo "failed to move VSCode-win32-$ARCH to $OUT_DIR" >&2
  exit 1
fi

echo "==> [picket-code] Verifying the packaged WSL component (flavor: ${PICKET_WSL_PAYLOAD:-ondemand})"
node "$SCRIPT_DIR/../wsl/check.mjs" --app "$ROOT_DIR/$OUT_DIR/resources/app" --flavor "${PICKET_WSL_PAYLOAD:-ondemand}"

echo "==> [picket-code] Creating picket-code-win32-$ARCH.zip"
if command -v 7z >/dev/null 2>&1; then
  7z a -r -tzip "$ROOT_DIR/picket-code-win32-$ARCH.zip" "$OUT_DIR"
elif [ -x /c/Windows/System32/tar.exe ]; then
  /c/Windows/System32/tar.exe -a -c -f "$ROOT_DIR/picket-code-win32-$ARCH.zip" "$OUT_DIR"
else
  powershell -NoProfile -Command "Compress-Archive -Force -Path './$OUT_DIR' -DestinationPath '$ROOT_DIR/picket-code-win32-$ARCH.zip'"
fi

echo "==> [picket-code] Windows package done"
ls -lh "$ROOT_DIR/picket-code-win32-$ARCH.zip"
