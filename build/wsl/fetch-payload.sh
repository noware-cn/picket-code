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
# The payload lives in its own repository (noware-cn/picket-code-server) with its
# own release tags, so the client build pins it through PICKET_SERVER_TAG and
# assemble.mjs stamps that tag into product.json (picketTag).
#
# That repository is public, so the release assets are read over plain HTTPS:
# no token, no gh CLI. Set PICKET_SERVER_TOKEN (or GH_TOKEN) only when
# PICKET_SERVER_REPO points at a private mirror; that path goes through gh.
set -euo pipefail

TAG="${1:?usage: fetch-payload.sh <server-tag> [--metadata-only]}"
MODE="${2:-}"

REPO="${PICKET_SERVER_REPO:-noware-cn/picket-code-server}"
NAME="picket-code-server-$TAG-linux-x64.tar.gz"
SUMS_NAME="picket-code-server-$TAG-SHA256SUMS"
BASE="https://github.com/$REPO/releases/download/$TAG"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOWNLOAD="$SCRIPT_DIR/download"
mkdir -p "$DOWNLOAD"

TOKEN="${PICKET_SERVER_TOKEN:-${GH_TOKEN:-}}"

# One downloader for both paths, so the public path cannot drift from the
# private one: same files, same destinations, same failure behaviour.
fetch_asset() {
	local name="$1" dest="$2"
	if [ -n "$TOKEN" ]; then
		gh release download "$TAG" --repo "$REPO" --pattern "$name" --dir "$DOWNLOAD" --clobber
		if [ -d "$DOWNLOAD/$name" ] || [ ! -f "$DOWNLOAD/$name" ]; then
			echo "gh did not produce $DOWNLOAD/$name" >&2
			return 1
		fi
		if [ "$DOWNLOAD/$name" != "$dest" ]; then
			mv "$DOWNLOAD/$name" "$dest"
		fi
	else
		# --retry-all-errors: a proxy or TLS blip is as transient as a 5xx, and the
		# default retry set skips SSL connect failures entirely.
		# --speed-limit/--speed-time abort a real stall without punishing a
		# slow-but-moving link (87 MB over a proxy can take half an hour).
		curl -sSfL --retry 3 --retry-delay 5 --connect-timeout 20 --retry-all-errors \
			--speed-limit 1000 --speed-time 60 "$BASE/$name" -o "$dest"
	fi
}

if [ -n "$TOKEN" ]; then
	command -v gh >/dev/null 2>&1 || { echo "PICKET_SERVER_TOKEN is set but gh CLI is missing" >&2; exit 1; }
fi
command -v curl >/dev/null 2>&1 || { echo "curl is required to read $BASE" >&2; exit 1; }

echo "==> [picket-code-wsl] fetching $NAME from $REPO@$TAG"
fetch_asset "$SUMS_NAME" "$DOWNLOAD/SHA256SUMS.tmp"
mv "$DOWNLOAD/SHA256SUMS.tmp" "$DOWNLOAD/SHA256SUMS"

# Size comes from the headers, not from the file: --metadata-only must know it
# without spending the download. GitHub redirects to the CDN that owns the asset,
# and only the last hop reports the real Content-Length (see asset-size.mjs).
HEADERS="$DOWNLOAD/.headers"
if [ -n "$TOKEN" ]; then
	SIZE="$(gh api "repos/$REPO/releases/tags/$TAG" --jq ".assets[] | select(.name == \"$NAME\") | .size")"
else
	curl -sSfL -D "$HEADERS" -o /dev/null --retry 3 --retry-delay 5 --connect-timeout 20 \
		--retry-all-errors "$BASE/$NAME"
	SIZE="$(node "$SCRIPT_DIR/lib/asset-size.mjs" "$HEADERS")"
fi
rm -f "$HEADERS"
if [ -z "$SIZE" ]; then
	echo "release $TAG of $REPO has no asset named $NAME" >&2
	exit 1
fi
printf '%s\n' "$SIZE" > "$DOWNLOAD/payload-size.txt"

if [ "$MODE" != "--metadata-only" ]; then
	fetch_asset "$NAME" "$DOWNLOAD/$NAME"
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
