#!/usr/bin/env bash
# fetch-payload.sh — stage the WSL server payload of a picket-code-server release.
#
# Usage: fetch-payload.sh <server-version> [--metadata-only]
#
# Lays down in build/wsl/download/:
#   picket-code-server-<version>-linux-x64.tar.gz   the payload (skipped by --metadata-only)
#   SHA256SUMS                                      the release checksums (always)
#   payload-size.txt                                byte size of the payload (always)
#   catalog.json                                    ondemand component catalog (always)
#
# The payload lives in its own repository (noware-cn/picket-code-server) and is
# versioned independently of the client: <server-version> is a bare semver such
# as 1.4.0 and the release tag is server-v<server-version>. The client only
# requires `commit` equality plus `version >= PICKET_SERVER_MIN_VERSION`, so one
# client tag can be served by any payload cut from the same commit.
#
# Environment:
#   PICKET_SERVER_MIN_VERSION  stamped into catalog.minVersion (default: <server-version>)
#   PICKET_SERVER_COMMIT       the vscode commit the payload was built from (required)
#
# That repository is public, so the release assets are read over plain HTTPS:
# no token, no gh CLI. Set PICKET_SERVER_TOKEN (or GH_TOKEN) only when
# PICKET_SERVER_REPO points at a private mirror; that path goes through gh.
set -euo pipefail

VERSION="${1:?usage: fetch-payload.sh <server-version> [--metadata-only]}"
MODE="${2:-}"
MIN_VERSION="${PICKET_SERVER_MIN_VERSION:-$VERSION}"
COMMIT="${PICKET_SERVER_COMMIT:-}"

REPO="${PICKET_SERVER_REPO:-noware-cn/picket-code-server}"
NAME="picket-code-server-$VERSION-linux-x64.tar.gz"
SUMS_NAME="picket-code-server-$VERSION-SHA256SUMS"
RELEASE_TAG="server-v$VERSION"
BASE="https://github.com/$REPO/releases/download/$RELEASE_TAG"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOWNLOAD="$SCRIPT_DIR/download"
mkdir -p "$DOWNLOAD"

TOKEN="${PICKET_SERVER_TOKEN:-${GH_TOKEN:-}}"

# One downloader for both paths, so the public path cannot drift from the
# private one: same files, same destinations, same failure behaviour.
fetch_asset() {
	local name="$1" dest="$2"
	if [ -n "$TOKEN" ]; then
		gh release download "$RELEASE_TAG" --repo "$REPO" --pattern "$name" --dir "$DOWNLOAD" --clobber
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

echo "==> [picket-code-wsl] fetching $NAME from $REPO@$RELEASE_TAG"
fetch_asset "$SUMS_NAME" "$DOWNLOAD/SHA256SUMS.tmp"
mv "$DOWNLOAD/SHA256SUMS.tmp" "$DOWNLOAD/SHA256SUMS"

# Size comes from the headers, not from the file: --metadata-only must know it
# without spending the download. GitHub redirects to the CDN that owns the asset,
# and only the last hop reports the real Content-Length (see asset-size.mjs).
HEADERS="$DOWNLOAD/.headers"
if [ -n "$TOKEN" ]; then
	SIZE="$(gh api "repos/$REPO/releases/tags/$RELEASE_TAG" --jq ".assets[] | select(.name == \"$NAME\") | .size")"
else
	# -I: headers only. Without it curl downloads the whole 87 MB body to /dev/null,
	# which is the download this branch exists to avoid.
	curl -sSfLI -D "$HEADERS" -o /dev/null --retry 3 --retry-delay 5 --connect-timeout 20 \
		--retry-all-errors "$BASE/$NAME"
	SIZE="$(node "$SCRIPT_DIR/lib/asset-size.mjs" "$HEADERS")"
fi
rm -f "$HEADERS"
if [ -z "$SIZE" ]; then
	echo "release $RELEASE_TAG of $REPO has no asset named $NAME" >&2
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

# The commit is the payload's identity: a client only adopts a component built
# from its own commit. Ask the payload itself when the caller did not say, so a
# hand-run fetch cannot pair a payload with the wrong commit.
if [ -z "$COMMIT" ] && [ -f "$DOWNLOAD/$NAME" ]; then
	MEMBER="$(tar -tzf "$DOWNLOAD/$NAME" | awk -F/ '/product\.json$/ && NF <= 2 { print NF" "$0 }' | sort -n | head -1 | cut -d' ' -f2-)"
	if [ -n "$MEMBER" ]; then
		COMMIT="$(tar -xzOf "$DOWNLOAD/$NAME" "$MEMBER" | node -e '
let text = "";
process.stdin.on("data", chunk => text += chunk).on("end", () => {
  try { process.stdout.write(JSON.parse(text).commit ?? ""); } catch { }
});
')"
	fi
fi
if ! printf '%s' "$COMMIT" | grep -Eqx '[0-9a-f]{40}'; then
	echo "no commit for $NAME: pass PICKET_SERVER_COMMIT (it must be the commit the payload was built from)" >&2
	exit 1
fi

# One writer for the component catalog: derived from the release metadata so
# the offline bundle cannot drift from what was actually downloaded.
VERSION="$VERSION" MIN_VERSION="$MIN_VERSION" COMMIT="$COMMIT" NAME="$NAME" SIZE="$SIZE" SUMS="$DOWNLOAD/SHA256SUMS" CATALOG="$DOWNLOAD/catalog.json" node -e '
const fs = require("fs");
let sha = null;
for (const line of fs.readFileSync(process.env.SUMS, "utf8").split("\n")) {
  const match = /^([0-9a-f]{64})[ \t]+\*?(.*)$/.exec(line.trim());
  if (match && match[2] === process.env.NAME) { sha = match[1]; break; }
}
if (!sha) { console.error("SHA256SUMS has no entry for " + process.env.NAME); process.exit(1); }
const catalog = {
  schema: 2, minVersion: process.env.MIN_VERSION, flavor: "ondemand",
  components: [{ id: "wsl-server", kind: "server", version: process.env.VERSION,
    commit: process.env.COMMIT, file: process.env.NAME,
    size: Number(process.env.SIZE), sha256: sha, embedded: false }]
};
fs.writeFileSync(process.env.CATALOG, JSON.stringify(catalog, null, "\t") + "\n");
'

echo "==> [picket-code-wsl] payload staged in $DOWNLOAD (server $VERSION, minimum $MIN_VERSION, commit $COMMIT, size: $SIZE bytes)"
