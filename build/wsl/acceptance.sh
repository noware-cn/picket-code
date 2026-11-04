#!/usr/bin/env bash
# WSL acceptance driver (plan Task 14). On Linux the whole matrix runs through
# the stand-in wsl.exe (`vscode/test/wsl-harness/fake-wsl.mjs`), which executes
# the extension's distro-side scripts against a scratch HOME with the real
# server payload — the only thing faked is the wsl.exe boundary. On Windows the
# same flags run against a real distro (set PICKET_WSL_DISTRO).
#
#   bash build/wsl/acceptance.sh --all
#   bash build/wsl/acceptance.sh --l2 --remote --ui --lifecycle --icode
#
# --remote/--ui/--lifecycle/--icode need a desktop session (Electron) and the
# payload trio under build/wsl/download/ (see fetch-payload.sh). CI runs only
# --l2.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRATCH="${PICKET_WSL_ACCEPT_HOME:-/tmp/picket-wsl-accept}"
DISTRO="${PICKET_WSL_DISTRO:-PicketAccept}"
FAKE_WSL="$ROOT/vscode/test/wsl-harness/fake-wsl.mjs"
HARNESS="$ROOT/vscode/test/wsl-harness/remote"
STAGING="$SCRATCH/ext"
USER_DATA="$SCRATCH/user-data"
FOLDER="$SCRATCH/home/我的 项目"
RESULTS="$SCRATCH/home/.picket-code-server/harness-results.json"
PAYLOAD_GLOB="$ROOT"/build/wsl/download/picket-code-server-*-linux-x64.tar.gz
CYCLES="${PICKET_WSL_LIFECYCLE_CYCLES:-20}"
REMOTE_DEADLINE=180

FAILED=0
declare -a NAMES=()

ok()   { NAMES+=("PASS $1"); echo "PASS $1"; }
ko()   { FAILED=1; NAMES+=("FAIL $1: $2"); echo "FAIL $1: $2"; }

payload() {
	local p; p=$(compgen -G "$PAYLOAD_GLOB" | head -1)
	[ -n "$p" ] && { echo "$p"; return 0; }
	return 1
}

server_pids() {
	# bin/picket-code-server is a sh wrapper that runs node as a child, so the
	# server itself is the server-main.js process (matching both would double count).
	pgrep -f "out/server-main.js .*user-data-dir=$SCRATCH/home/.picket-code-server/data" || true
}

launch_window() { # $1 = log file
	# Redirect the subshell itself (not just the inner command): a $(launch_window)
	# command substitution blocks until every process holding its stdout pipe
	# exits, so the subshell must not inherit it. exec+setsid makes the subshell
	# pid the session leader, so `kill -- -$pid` reaches the whole window.
	(
		cd "$ROOT/vscode"
		DISPLAY="${DISPLAY:-:0}" exec setsid bash scripts/code.sh \
			"--user-data-dir=$USER_DATA" "--folder-uri=$FOLDER_URI" \
			"--extensionDevelopmentPath=$STAGING"
	) >"$1" 2>&1 &
	echo $!
}

kill_window() {
	local pid="${1:-}"
	if [ -n "$pid" ]; then
		kill -TERM -- -"$pid" 2>/dev/null || true
		sleep 2
		kill -KILL -- -"$pid" 2>/dev/null || true
	fi
	pkill -KILL -f "user-data-dir=$USER_DATA" 2>/dev/null || true
	sleep 1
}

await_results() { # $1 = deadline seconds
	local waited=0
	while [ $waited -lt "$1" ]; do
		[ -f "$RESULTS" ] && return 0
		sleep 2
		waited=$((waited + 2))
	done
	return 1
}

print_results() { # prints PASS/FAIL per harness check; returns 1 on any fail
	node -e '
		const r = require(process.argv[1]);
		let bad = 0;
		for (const [name, check] of Object.entries(r)) {
			if (check.ok) { console.log("PASS " + name); }
			else { bad++; console.log("FAIL " + name + ": " + (check.detail || "")); }
		}
		process.exit(bad ? 1 : 0);
	' "$RESULTS"
}

prepare() {
	pkill -KILL -f "user-data-dir=$SCRATCH/home/.picket-code-server/data" 2>/dev/null || true
	pkill -KILL -f "user-data-dir=$USER_DATA" 2>/dev/null || true
	rm -rf "$SCRATCH/home" "$SCRATCH/user-data" "$SCRATCH/ext"
	mkdir -p "$SCRATCH/home/.picket-code-server" "$SCRATCH/user-data/User" "$SCRATCH/logs"
	mkdir -p "$FOLDER"
	echo '# acceptance profile marker (proves the server runs under the login shell)' > "$SCRATCH/home/.profile"
	echo 'export PICKET_ACCEPT_PROFILE_MARKER=from-login-shell' >> "$SCRATCH/home/.profile"
	cp -r "$ROOT/vscode/extensions/picket-remote-wsl" "$STAGING"
	cp "$ROOT/build/wsl/download/catalog.json" "$STAGING/payloads/catalog.json"
	# The 目标 view is declared `when: isWindows`; the Linux acceptance window
	# drives the stand-in wsl.exe, so drop the gate on the staged copy only
	# (otherwise the Remote Explorer container stays empty and hides itself).
	node -e '
		const fs = require("fs");
		const file = process.argv[1];
		const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
		delete manifest.contributes.views.remote[0].when;
		fs.writeFileSync(file, JSON.stringify(manifest, null, "\t") + "\n");
	' "$STAGING/package.json"
	# The harness asserts from inside the remote extension host, so it has to be
	# installed into the distro-side extensions dir the server scans.
	mkdir -p "$SCRATCH/home/.picket-code-server/extensions"
	cp -r "$HARNESS" "$SCRATCH/home/.picket-code-server/extensions/picket.picket-wsl-harness-0.0.0"
	cat > "$USER_DATA/User/settings.json" <<SETTINGS
{
	"picket.wsl.serverPayloadPath": "$1",
	"picket.wsl.icodePath": "${2:-}"
}
SETTINGS
	export PICKET_WSL_RUNNER="$FAKE_WSL"
	export PICKET_WSL_FAKE_HOME="$SCRATCH/home"
	export PICKET_WSL_DISTRO="$DISTRO"
	export PICKET_WSL_ACCEPT_HOME="$SCRATCH"
	# fake-wsl mimics wsl.exe: the distro side only sees the vars listed here.
	export WSLENV="${WSLENV:+$WSLENV:}WSL_HARNESS_FOLDER:WSL_HARNESS_EXPECT_ICODE_MISSING"
	export WSL_HARNESS_FOLDER="$FOLDER"
	local encoded; encoded=$(node -e 'process.stdout.write(encodeURIComponent(process.argv[1]).replace(/%2F/gi, "/"))' "$FOLDER")
	FOLDER_URI="vscode-remote://picket-wsl+${DISTRO}${encoded}"
}

run_l2() {
	echo "--- L2 extension unit tests"
	if ( cd "$ROOT/vscode/extensions/picket-remote-wsl" && node --test "test/*.test.js" >/dev/null 2>&1 ); then
		ok l2
	else
		ko l2 "extension unit tests failed (run node --test \"test/*.test.js\" in vscode/extensions/picket-remote-wsl)"
	fi
}

run_remote() {
	echo "--- remote: resolver connects a real window to the fake distro"
	local payload; payload=$(payload) || { ko remote "payload trio missing under build/wsl/download (run fetch-payload.sh)"; return; }
	prepare "$payload"
	local log="$SCRATCH/logs/remote.log"
	local pid; pid=$(launch_window "$log")
	if ! await_results "$REMOTE_DEADLINE"; then
		kill_window "$pid"
		ko remote "harness results did not appear within ${REMOTE_DEADLINE}s (log: $log)"
		return
	fi
	kill_window "$pid"
	if print_results; then ok remote; else ko remote "harness checks failed (log: $log)"; fi
}

run_ui() {
	echo "--- ui: Playwright smoke area (WSL remote window)"
	mkdir -p "$SCRATCH/logs"
	# The automation compile step carries a pre-existing playwright type drift
	# on this tree (upstream pins two playwright-core versions; their type
	# literals clash). tsc still emits, so its exit code is not gated here —
	# the smoke step below is, and it compiles ./src only.
	( cd "$ROOT/vscode/test/automation" && node ../../node_modules/typescript/bin/tsc6 >/dev/null 2>&1 ) \
		|| echo "[acceptance] automation compile reported pre-existing type drift; using its emitted output"
	if ! ( cd "$ROOT/vscode/test/smoke" && node ../../node_modules/typescript/bin/tsc6 ); then
		ko ui "test/smoke compile failed"; return
	fi
	if ( cd "$ROOT/vscode/test/smoke" && node test/index.js -f wsl >"$SCRATCH/logs/ui.log" 2>&1 ); then
		ok ui
	else
		ko ui "smoke area failed (log: $SCRATCH/logs/ui.log)"
	fi
}

run_lifecycle() {
	echo "--- lifecycle: $CYCLES window cycles reuse exactly one server process"
	local payload; payload=$(payload) || { ko lifecycle "payload trio missing under build/wsl/download (run fetch-payload.sh)"; return; }
	prepare "$payload"
	local log="$SCRATCH/logs/lifecycle-first.log"
	local pid; pid=$(launch_window "$log")
	if ! await_results "$REMOTE_DEADLINE"; then
		kill_window "$pid"
		ko lifecycle "first window never connected (log: $log)"; return
	fi
	kill_window "$pid"
	local first_pid; first_pid=$(server_pids | head -1)
	if [ -z "$first_pid" ]; then
		ko lifecycle "no server process survived the first window"; return
	fi
	local i bad=""
	for ((i = 2; i <= CYCLES; i++)); do
		rm -f "$RESULTS"
		log="$SCRATCH/logs/lifecycle-$i.log"
		pid=$(launch_window "$log")
		if ! await_results "$REMOTE_DEADLINE"; then
			kill_window "$pid"
			ko lifecycle "window $i never connected (log: $log)"; return
		fi
		kill_window "$pid"
		local now; now=$(server_pids | head -1)
		if [ "$now" != "$first_pid" ]; then bad="server pid changed $first_pid -> $now at window $i"; break; fi
	done
	if [ -n "$bad" ]; then ko lifecycle "$bad"; return; fi
	local count; count=$(server_pids | wc -l)
	if [ "$count" -eq 1 ]; then ok lifecycle; else ko lifecycle "expected 1 server process at the end, found $count: $(server_pids | while read -r p; do ps -o pid=,args= -p "$p" | cut -c1-140; done | tr '\n' '|')"; fi
}

run_icode() {
	echo "--- icode: a bogus configured path must not be exported into the server"
	local payload; payload=$(payload) || { ko icode "payload trio missing under build/wsl/download (run fetch-payload.sh)"; return; }
	prepare "$payload" "/nonexistent/icode"
	export WSL_HARNESS_EXPECT_ICODE_MISSING=1
	local log="$SCRATCH/logs/icode.log"
	local pid; pid=$(launch_window "$log")
	if ! await_results "$REMOTE_DEADLINE"; then
		kill_window "$pid"
		ko icode "window never connected (log: $log)"; return
	fi
	kill_window "$pid"
	local icode_check; icode_check=$(node -e 'const r=require(process.argv[1]); process.stdout.write(r.icode ? (r.icode.ok ? "ok" : "fail: "+r.icode.detail) : "absent")' "$RESULTS")
	if [ "$icode_check" = "ok" ]; then ok icode; else ko icode "$icode_check"; fi
}

usage() {
	echo "usage: bash build/wsl/acceptance.sh [--l2] [--remote] [--ui] [--lifecycle] [--icode] [--all]"
}

main() {
	[ $# -eq 0 ] && { usage; exit 2; }
	local l2=0 remote=0 ui=0 lifecycle=0 icode=0
	while [ $# -gt 0 ]; do
		case "$1" in
			--l2) l2=1 ;;
			--remote) remote=1 ;;
			--ui) ui=1 ;;
			--lifecycle) lifecycle=1 ;;
			--icode) icode=1 ;;
			--all) l2=1 remote=1 ui=1 lifecycle=1 icode=1 ;;
			*) usage; exit 2 ;;
		esac
		shift
	done

	trap 'pkill -KILL -f "user-data-dir=$SCRATCH/home/.picket-code-server/data" 2>/dev/null || true' EXIT

	[ $l2 -eq 1 ] && run_l2
	[ $remote -eq 1 ] && run_remote
	[ $ui -eq 1 ] && run_ui
	[ $lifecycle -eq 1 ] && run_lifecycle
	[ $icode -eq 1 ] && run_icode

	if [ "$FAILED" -eq 0 ]; then
		echo "==> WSL acceptance: all selected checks passed"
		rm -rf "$SCRATCH"
	else
		echo "==> WSL acceptance: failures above (scratch kept at $SCRATCH)"
	fi
	exit "$FAILED"
}

main "$@"
