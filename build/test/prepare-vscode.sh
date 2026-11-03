#!/usr/bin/env bash
# Prepare the vscode/ tree for the CI test layers.
#
# This is the first half of build/build.sh — clone the pinned upstream tree, trim the
# built-in extensions, apply the Picket Code patches, `npm ci`, transpile `src` → `out` —
# and none of the second half: no `gulp vscode-<plat>-<arch>-min`, no packaging. That
# min build is 30+ minutes and the test layers never read its output (they run the
# compiled sources straight from `out/`).
#
# Usage: prepare-vscode.sh <vscode-tag> [--no-install] [--no-transpile] [--force]
#        prepare-vscode.sh <vscode-tag> --cache-key
#
#   <vscode-tag>      upstream tag to clone (1.143.1), never a branch
#   --no-install      clone + patch only (no npm ci)
#   --no-transpile    skip `npm run transpile-client`
#   --force           replace an existing vscode/ tree that this script did not create
#   --cache-key       print the actions/cache key for `vscode/node_modules` + `vscode/out`
#                     (requires a patched tree: the key embeds the patched lockfile hash)
#
# Every step is idempotent and marker-driven, so the same command works in every CI job:
# after `actions/cache` restores `node_modules` + `out`, the install and transpile steps
# see their markers and only re-validate.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILD_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ROOT_DIR="$(cd "$BUILD_DIR/.." && pwd)"
VSCODE_DIR="$ROOT_DIR/vscode"
PREPARE_MARKER="$VSCODE_DIR/.picket-prepare"
LOCK_MARKER="$VSCODE_DIR/node_modules/.picket-lock-hash"
TRANSPILE_MARKER="$VSCODE_DIR/out/.picket-transpile"

TAG=""
DO_INSTALL=1
DO_TRANSPILE=1
FORCE=0
PRINT_KEY=0

usage() {
  sed -n '2,25p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

for arg in "$@"; do
  case "$arg" in
    --no-install) DO_INSTALL=0 ;;
    --no-transpile) DO_TRANSPILE=0 ;;
    --force) FORCE=1 ;;
    --cache-key) PRINT_KEY=1 ;;
    -h|--help) usage; exit 0 ;;
    -*) echo "Unknown option: $arg" >&2; exit 2 ;;
    *)
      if [ -n "$TAG" ]; then
        echo "Unexpected argument: $arg (tag already set to $TAG)" >&2
        exit 2
      fi
      TAG="$arg"
      ;;
  esac
done

if [ -z "$TAG" ]; then
  echo "FATAL: the upstream VS Code tag is required (e.g. 1.143.1)" >&2
  usage >&2
  exit 2
fi

# Digest of everything on the Picket Code side that changes the patched tree. It feeds
# both the actions/cache key (via --cache-key) and the transpile marker.
patch_digest() {
  {
    find "$BUILD_DIR/patches" -maxdepth 1 -type f \
      \( -name '*.patch' -o -name '*.json' -o -name 'apply-list.txt' \) -print0 \
      | sort -z | xargs -0 cat
    cat "$BUILD_DIR/product.json"
    cat "$SCRIPT_DIR/prepare-vscode.sh"
  } | sha256sum | cut -c1-16
}

PATCH_DIGEST="$(patch_digest)"

cache_key() {
  if [ ! -f "$VSCODE_DIR/package-lock.json" ]; then
    echo "FATAL: $VSCODE_DIR/package-lock.json is missing; clone and patch the tree first" >&2
    exit 1
  fi
  local lock_digest
  lock_digest="$(sha256sum "$VSCODE_DIR/package-lock.json" | cut -c1-16)"
  echo "vscode-$TAG-$lock_digest-$PATCH_DIGEST"
}

if [ "$PRINT_KEY" = 1 ]; then
  cache_key
  exit 0
fi

command -v git >/dev/null || { echo "FATAL: git is required to clone the upstream tree" >&2; exit 1; }
command -v python3 >/dev/null || { echo "FATAL: python3 is required by build/apply-patches.sh" >&2; exit 1; }

# ---- 1. clone + trim + patch: the first half of build/build.sh -------------------------
prepare_tree() {
  if [ "$FORCE" != 1 ] && [ -f "$PREPARE_MARKER" ] && [ "$(cat "$PREPARE_MARKER")" = "$TAG" ]; then
    echo "==> [picket-code] vscode/ is already prepared for $TAG (marker: $PREPARE_MARKER)"
    return 0
  fi

  if [ -d "$VSCODE_DIR" ]; then
    if [ "$FORCE" != 1 ]; then
      echo "FATAL: $VSCODE_DIR already exists and was not prepared by this script." >&2
      echo "       Refusing to delete it: remove it yourself, or re-run with --force." >&2
      exit 1
    fi
    echo "==> [picket-code] rm -rf $VSCODE_DIR (--force)"
    rm -rf "$VSCODE_DIR"
  fi

  echo "==> [picket-code] git clone --depth 1 --branch $TAG https://github.com/microsoft/vscode.git $VSCODE_DIR"
  git clone --depth 1 --branch "$TAG" https://github.com/microsoft/vscode.git "$VSCODE_DIR"

  # Same list and loop as build/build.sh: the tree we test must be the tree we ship.
  echo "==> [picket-code] trim built-in extensions listed in build/extensions-remove.list"
  local removed=0 ext
  while IFS= read -r ext; do
    [ -z "$ext" ] && continue
    ext="${ext%$'\r'}"
    if [ -d "$VSCODE_DIR/extensions/$ext" ]; then
      rm -rf "$VSCODE_DIR/extensions/$ext"
      removed=$((removed + 1))
    else
      echo "WARN: extensions/$ext listed in build/extensions-remove.list but absent upstream" >&2
    fi
  done < "$BUILD_DIR/extensions-remove.list"
  echo "==> [picket-code] removed $removed built-in extension dirs"

  echo "==> [picket-code] bash build/apply-patches.sh $VSCODE_DIR"
  bash "$BUILD_DIR/apply-patches.sh" "$VSCODE_DIR"

  printf '%s\n' "$TAG" > "$PREPARE_MARKER"
}

# ---- 2. npm ci -------------------------------------------------------------------------
install_deps() {
  local want
  want="$(sha256sum "$VSCODE_DIR/package-lock.json" | cut -c1-16)"
  if [ -f "$LOCK_MARKER" ] && [ "$(cat "$LOCK_MARKER")" = "$want" ]; then
    echo "==> [picket-code] vscode/node_modules is current (lock $want); skipping npm ci"
    return 0
  fi

  echo "==> [picket-code] cd vscode && npm ci --no-audit --no-fund"
  local i
  for i in 1 2 3; do
    if ( cd "$VSCODE_DIR" && npm ci --no-audit --no-fund ); then
      printf '%s\n' "$want" > "$LOCK_MARKER"
      return 0
    fi
    if [ "$i" -eq 3 ]; then
      echo "FATAL: npm ci failed 3 times" >&2
      exit 1
    fi
    echo "npm ci failed $i/3, retrying..." >&2
    sleep $(( 15 * i ))
  done
}

# ---- 3. transpile src → out ------------------------------------------------------------
transpile() {
  local want="$TAG-$PATCH_DIGEST"
  if [ -f "$TRANSPILE_MARKER" ] && [ "$(cat "$TRANSPILE_MARKER")" = "$want" ]; then
    echo "==> [picket-code] vscode/out is current ($want); skipping transpile-client"
    return 0
  fi

  echo "==> [picket-code] cd vscode && npm run transpile-client"
  ( cd "$VSCODE_DIR" && npm run transpile-client )
  mkdir -p "$VSCODE_DIR/out"
  printf '%s\n' "$want" > "$TRANSPILE_MARKER"
}

prepare_tree
if [ "$DO_INSTALL" = 1 ]; then
  install_deps
fi
if [ "$DO_TRANSPILE" = 1 ]; then
  transpile
fi

echo "==> [picket-code] vscode/ ready for $TAG (patch digest $PATCH_DIGEST)"
