#!/usr/bin/env bash
# check-contract.sh — assert the facts that span several files and used to drift silently.
#
# The release contract is spread over four downloaders, the docs and product.json; a bump
# that touches only some of them shipped wrong artifacts (tag drift) or promised a layout
# the packaging script does not produce. This runs in the compile stage, so a mismatch
# fails the release before anything is published.
#
# Usage: check-contract.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
FAILED=0

fail() { echo "FAIL: $*" >&2; FAILED=1; }

# ---- 1. every downloader derives the artifact name from the tag ----
# Artifacts are versioned (`picket-code-<tag>-<os>-<arch>.<ext>`) and the tag is
# resolved from the latest release when it is not passed. A downloader that still
# builds an unversioned name would 404 on the mirror and on GitHub.
for pair in "download-verify.sh:picket-code-\$TAG-" \
            "download-verify.ps1:picket-code-\$Tag-" \
            "download-verify.bat:picket-code-%TAG%-"; do
  f="${pair%%:*}"
  pattern="${pair#*:}"
  grep -qF -- "${pattern//\\/}" "$SCRIPT_DIR/$f" \
    || fail "$f: archive name is not derived from the tag"
  grep -q 'releases/latest' "$SCRIPT_DIR/$f" \
    || fail "$f: does not resolve the latest release when no tag is given"
done
if grep -qE 'releases/download/v[0-9]+\.[0-9]+\.[0-9]+' "$ROOT_DIR/docs/ai-download-prompt.md" \
   || grep -qE 'releases/download/v[0-9]+\.[0-9]+\.[0-9]+' "$ROOT_DIR/docs/download-one-liner.md"; then
  fail "docs/ still pin a release tag; the downloaders resolve the latest release instead"
fi
echo "ok: downloaders derive versioned names and resolve the latest tag"

# ---- 2. archive layout promised by the docs matches the packaging scripts ----
layout_ok=1
grep -q 'picket-code-win32-x64\\Picket Code.exe' "$ROOT_DIR/docs/download-one-liner.md" || layout_ok=0
# The zip must contain `picket-code-win32-<arch>/` as its single top-level dir, i.e. the
# archive source argument is "$OUT_DIR" itself, not "$OUT_DIR"/*.
grep -q -- '-tzip "[^"]*" "\$OUT_DIR"' "$SCRIPT_DIR/win32/package.sh" || layout_ok=0
if [ "$layout_ok" -eq 1 ]; then
  echo "ok: win32 archive layout matches docs"
else
  fail "win32 zip layout and docs/download-one-liner.md disagree (top-level picket-code-win32-x64/ dir)"
fi

# ---- 3. built-in extensions stay in product.json and 61 keeps them servable ----
python3 - "$ROOT_DIR" <<'PYEOF' || FAILED=1
import json, sys
root = sys.argv[1]
with open(f'{root}/build/product.json', encoding='utf-8') as f:
    product = json.load(f)
names = {e['name'] for e in product.get('builtInExtensions', [])}
missing = {'ms-vscode.js-debug', 'ms-vscode.js-debug-companion'} - names
if missing:
    print('FAIL: build/product.json lost built-in extension(s): ' + ', '.join(sorted(missing)), file=sys.stderr)
    sys.exit(1)
if not product.get('extensionsGallery', {}).get('serviceUrl'):
    print('FAIL: build/product.json has no extensionsGallery.serviceUrl', file=sys.stderr)
    sys.exit(1)
PYEOF
grep -q "fromGithub" "$SCRIPT_DIR/patches/61-build-source-adaptations.patch" \
  || fail "61-build-source-adaptations.patch no longer forces built-in extensions onto GitHub"
echo "ok: built-in extensions (js-debug) kept and fetched from GitHub"

# ---- 4. artifacts come from the GitHub release and are verified against SHA256SUMS ----
for f in download-verify.sh download-verify.ps1 download-verify.bat; do
  grep -q 'SHA256SUMS' "$SCRIPT_DIR/$f" || fail "$f no longer verifies against the release SHA256SUMS"
done
# There is no source mirror any more: the repository and the releases live on GitHub,
# so a Gitee URL anywhere would be a dead link.
if grep -rqi --exclude=check-contract.sh 'gitee\.com' "$ROOT_DIR/build" "$ROOT_DIR/docs" "$ROOT_DIR/.github" "$ROOT_DIR/README.md" "$ROOT_DIR/website/docs" 2>/dev/null; then
  fail "a gitee.com URL is still referenced"
else
  echo "ok: artifacts fetched from GitHub Releases + verified against SHA256SUMS"
fi

# ---- 5. the WSL server component stays wired into the packaging pipeline ----
grep -q '"noware.picket-remote-wsl"' "$ROOT_DIR/build/product.json" \
  || fail "build/product.json lost the picket-remote-wsl API proposal"
# The official extension is what we replace, so it must not keep API rights in a
# build that cannot contain it: a proposal granted to an id nothing ships is a
# silent hole for anyone who installs that id later.
if grep -q '"ms-vscode-remote.remote-wsl"' "$ROOT_DIR/build/product.json"; then
  fail "build/product.json still grants API proposals to ms-vscode-remote.remote-wsl"
fi
for f in build.sh win32/package.sh linux/package.sh; do
  grep -q 'wsl/check.mjs' "$SCRIPT_DIR/$f" \
    || fail "$f no longer verifies the WSL component before packaging"
done
for f in wsl/assemble.mjs wsl/check.mjs wsl/offline-bundle.mjs wsl/fetch-payload.sh; do
  [ -f "$SCRIPT_DIR/$f" ] || fail "build/$f is missing"
done
if [ "$FAILED" -eq 0 ]; then
  echo "ok: picket-remote-wsl proposal enabled and WSL component packaging wired"
fi

if [ "$FAILED" -ne 0 ]; then
  echo "==> [picket-code] release contract check FAILED" >&2
  exit 1
fi
echo "==> [picket-code] release contract check passed"
