#!/usr/bin/env bash
# fetch-payload.sh — stage the WSL server payload of a picket-code-server release.
#
# Usage: fetch-payload.sh <server-tag> [--metadata-only]
#
# Lays down in build/wsl/download/:
#   picket-code-server-<tag>-linux-x64.tar.gz   the payload (skipped by --metadata-only)
#   SHA256SUMS                                  the release checksums (always)
#   payload-size.txt                            byte size of the payload (always)
#   catalog.json                                ondemand component catalog (always)
#
# The payload lives in its own repository (noware-cn/picket-code-server) with
# its own release tags, so the client build pins it through PICKET_SERVER_TAG
# and assemble.mjs stamps that tag into product.json (picketTag). Cross-repo
# reads need a PAT on that repository: PICKET_SERVER_TOKEN, falling back to
# GH_TOKEN.
set -euo pipefail

TAG="${1:?usage: fetch-payload.sh <server-tag> [--metadata-only]}"
MODE="${2:-}"

REPO="${PICKET_SERVER_REPO:-noware-cn/picket-code-server}"
NAME="picket-code-server-$TAG-linux-x64.tar.gz"
SUMS_NAME="picket-code-server-$TAG-SHA256SUMS"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOWNLOAD="$SCRIPT_DIR/download"
mkdir -p "$DOWNLOAD"

if [ -n "${PICKET_SERVER_TOKEN:-}" ]; then
  export GH_TOKEN="$PICKET_SERVER_TOKEN"
fi
command -v gh >/dev/null 2>&1 || { echo "gh CLI is required to read $REPO releases" >&2; exit 1; }

echo "==> [picket-code-wsl] fetching $NAME from $REPO@$TAG"
gh release download "$TAG" --repo "$REPO" --pattern "$SUMS_NAME" --dir "$DOWNLOAD" --clobber
mv "$DOWNLOAD/$SUMS_NAME" "$DOWNLOAD/SHA256SUMS"

SIZE="$(gh api "repos/$REPO/releases/tags/$TAG" --jq ".assets[] | select(.name == \"$NAME\") | .size")"
if [ -z "$SIZE" ]; then
  echo "release $TAG of $REPO has no asset named $NAME" >&2
  exit 1
fi
printf '%s\n' "$SIZE" > "$DOWNLOAD/payload-size.txt"

if [ "$MODE" != "--metadata-only" ]; then
  gh release download "$TAG" --repo "$REPO" --pattern "$NAME" --dir "$DOWNLOAD" --clobber
  EXPECTED="$(awk -v n="$NAME" '{ sub(/^\*/, "", $2) } $2 == n { print $1 }' "$DOWNLOAD/SHA256SUMS")"
  ACTUAL="$(sha256sum "$DOWNLOAD/$NAME" | awk '{ print $1 }')"
  if [ "$EXPECTED" != "$ACTUAL" ]; then
    echo "sha256 mismatch for $NAME: SHA256SUMS says $EXPECTED, downloaded file hashes to $ACTUAL" >&2
    exit 1
  fi
fi

# One writer for the component catalog: derived from the release metadata so
# the offline bundle cannot drift from what was actually downloaded.
TAG="$TAG" NAME="$NAME" SIZE="$SIZE" SUMS="$DOWNLOAD/SHA256SUMS" CATALOG="$DOWNLOAD/catalog.json" node -e '
const fs = require("fs");
let sha = null;
for (const line of fs.readFileSync(process.env.SUMS, "utf8").split("\n")) {
  const match = /^([0-9a-f]{64})[ \t]+\*?(.*)$/.exec(line.trim());
  if (match && match[2] === process.env.NAME) { sha = match[1]; break; }
}
if (!sha) { console.error("SHA256SUMS has no entry for " + process.env.NAME); process.exit(1); }
const catalog = {
  version: 1, tag: process.env.TAG, flavor: "ondemand",
  components: [{ id: "wsl-server", kind: "server", version: process.env.TAG,
    file: process.env.NAME, size: Number(process.env.SIZE), sha256: sha, embedded: false }]
};
fs.writeFileSync(process.env.CATALOG, JSON.stringify(catalog, null, "\t") + "\n");
'

echo "==> [picket-code-wsl] payload staged in $DOWNLOAD (size: $SIZE bytes)"
