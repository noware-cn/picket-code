#!/usr/bin/env bash
# Gate for the picket-remote-wsl work. Run before every task commit and at
# each milestone (M1-M4).
#
#   1. every node:test suite in the extension passes
#   2. cross-file signatures still line up (tsc --checkJs, no emit)
#   3. the patches exported by this work still apply in reverse onto the vscode/ tree
#   4. the vscode/ tree is clean, so the next `git diff wsl-baseline` cannot
#      silently carry someone else's edits
#
# Usage: bash build/wsl/gate.sh [--skip-patch]
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
EXT_DIR="$ROOT_DIR/vscode/extensions/picket-remote-wsl"

pass=0
fail=0
skip=0

report() { # report <ok|fail|skip> <name> <detail>
	case "$1" in
		ok) printf '  \033[32mPASS\033[0m %s%s\n' "$2" "${3:+ — $3}"; pass=$((pass + 1)) ;;
		fail) printf '  \033[31mFAIL\033[0m %s%s\n' "$2" "${3:+ — $3}"; fail=$((fail + 1)) ;;
		skip) printf '  \033[33mSKIP\033[0m %s%s\n' "$2" "${3:+ — $3}"; skip=$((skip + 1)) ;;
	esac
}

echo "==> picket-remote-wsl gate"

# 1. L1/L2 suites
if [ -d "$EXT_DIR/test" ]; then
	out=$(cd "$EXT_DIR" && node --test "test/*.test.js" 2>&1)
	rc=$?
	tail_of_log=$(printf '%s\n' "$out" | grep -E '^# (pass|fail)' | tr '\n' ' ')
	if [ $rc -eq 0 ]; then
		report ok "node --test" "${tail_of_log:-all suites passed}"
	else
		report fail "node --test" "${tail_of_log:-see output above}"
		printf '%s\n' "$out" | tail -40
	fi
else
	report skip "node --test" "no test/ directory yet"
fi

# 2. Interface drift
if [ -f "$EXT_DIR/tsconfig.json" ]; then
	out=$(cd "$ROOT_DIR/vscode" && ./node_modules/.bin/tsc -p extensions/picket-remote-wsl/tsconfig.json 2>&1)
	rc=$?
	if [ $rc -eq 0 ]; then
		report ok "tsc --checkJs" "no signature errors"
	else
		count=$(printf '%s\n' "$out" | grep -c 'error TS' || true)
		report fail "tsc --checkJs" "$count error(s)"
		printf '%s\n' "$out" | head -30
	fi
else
	report skip "tsc --checkJs" "no tsconfig.json yet"
fi

# 3. Patches exported by this work apply in reverse onto the vscode/ tree.
# Only the patches this project produces: earlier ones delete or overlap files that
# later patches build on, so reversing them individually is not a meaningful check.
PATCH_FILES="66-gallery-no-account.patch 67-picket-remote-wsl.patch"
if [ "${1:-}" = "--skip-patch" ]; then
	report skip "patch reverse-check" "--skip-patch"
elif [ ! -d "$ROOT_DIR/vscode" ]; then
	report fail "patch reverse-check" "vscode/ tree missing"
else
	for name in $PATCH_FILES; do
		file="$ROOT_DIR/build/patches/$name"
		if [ ! -f "$file" ]; then
			report skip "patch reverse-check" "$name not created yet"
		elif (cd "$ROOT_DIR" && git apply -R --check "$file" --directory=vscode >/dev/null 2>&1); then
			report ok "patch reverse-check" "$name"
		else
			report fail "patch reverse-check" "$name does not reverse — re-export it"
		fi
	done
fi

# 4. vscode/ tree clean
dirty=$(git -C "$ROOT_DIR/vscode" status --short 2>/dev/null | grep -v -E '^\?\? (extensions/picket-remote-wsl/tsconfig\.json)$' || true)
if [ -z "$dirty" ]; then
	report ok "vscode/ tree clean"
else
	report fail "vscode/ tree clean" "$(printf '%s\n' "$dirty" | wc -l | tr -d ' ') path(s) modified"
	printf '%s\n' "$dirty" | head -10
fi

echo "==> $pass passed, $fail failed, $skip skipped"
[ $fail -eq 0 ]
