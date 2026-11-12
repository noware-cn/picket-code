#!/usr/bin/env bash
# WSL acceptance driver (plan Task 14). The whole matrix runs through the
# stand-in wsl.exe (`vscode/test/wsl-harness/fake-wsl.mjs`), which executes the
# extension's distro-side scripts against a scratch HOME with the real server
# payload — the only thing faked is the wsl.exe boundary. Windows behaviour
# (real UTF-16 tables, real wslpath, real signal escalation) is covered by the
# manual checklist in docs/wsl-verification.md instead.
#
#   bash build/wsl/acceptance.sh --all
#   bash build/wsl/acceptance.sh --l2 --remote --tunnel --ui --lifecycle --icode
#   bash build/wsl/acceptance.sh --conflict --takeover --legacy-uri
#
# --conflict / --takeover / --legacy-uri cover the official-extension handover:
# the blocked window, the shared ~/.vscode-server taken over unchanged, and a
# workspace opened through the legacy `wsl+<distro>` authority.
#
# Everything except --l2 needs a desktop session (Electron) and the payload
# tarball plus catalog.json under build/wsl/download/ (see fetch-payload.sh).
# CI runs the whole matrix: the `wsl-acceptance` job of .github/workflows/tests-ui.yml
# runs `--all` under `xvfb-run` on ubuntu-latest.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRATCH="${PICKET_WSL_ACCEPT_HOME:-/tmp/picket-wsl-accept}"
DISTRO="${PICKET_WSL_DISTRO:-PicketAccept}"
FAKE_WSL="$ROOT/vscode/test/wsl-harness/fake-wsl.mjs"
HARNESS="$ROOT/vscode/test/wsl-harness/remote"
HARNESS_CONFLICT="$ROOT/vscode/test/wsl-harness/conflict"
DOWNLOAD="$ROOT/build/wsl/download"
STAGING="$SCRATCH/ext"
USER_DATA="$SCRATCH/user-data"
FOLDER="$SCRATCH/home/我的 项目"
RESULTS="$SCRATCH/home/.picket-code-server/harness-results.json"
CONFLICT_RESULTS="$SCRATCH/logs/conflict-results.json"
PAYLOAD_GLOB="$DOWNLOAD"/picket-code-server-*-linux-x64.tar.gz
CYCLES="${PICKET_WSL_LIFECYCLE_CYCLES:-20}"
REMOTE_DEADLINE=180

FAILED=0

ok() { echo "PASS $1"; }
ko() { FAILED=1; echo "FAIL $1: $2"; }

payload() {
	local tarball
	tarball=$(compgen -G "$PAYLOAD_GLOB" | head -1)
	if [ -z "$tarball" ] || [ ! -f "$DOWNLOAD/catalog.json" ]; then
		return 1
	fi
	echo "$tarball"
}

server_pids() {
	# bin/picket-code-server is a sh wrapper that runs node as a child, so the
	# server itself is the server-main.js process (matching both would double count).
	pgrep -f "out/server-main.js .*user-data-dir=$SCRATCH/home/.vscode-server/data" || true
}

launch_window() { # $1 = log file
	# Redirect the subshell itself (not just the inner command): a $(launch_window)
	# command substitution blocks until every process holding its stdout pipe
	# exits, so the subshell must not inherit it. exec+setsid makes the subshell
	# pid the session leader, so `kill -- -$pid` reaches the whole window.
	(
		cd "$ROOT/vscode"
		# --extensions-dir: without it the window scans the developer's product
		# extension folder (~/.picket-code/extensions), not $USER_DATA, so anything
		# staged there — the stand-in official extension, the conflict probe — would
		# silently not exist. It also keeps a developer's own extensions out.
		DISPLAY="${DISPLAY:-:0}" exec setsid bash scripts/code.sh \
			"--user-data-dir=$USER_DATA" "--extensions-dir=$USER_DATA/extensions" \
			"--folder-uri=$FOLDER_URI" \
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

await_file() { # $1 = path, $2 = deadline seconds
	local waited=0
	while [ $waited -lt "$2" ]; do
		[ -f "$1" ] && return 0
		sleep 2
		waited=$((waited + 2))
	done
	return 1
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

print_results() { # $@ = names to require; defaults to b2..b5. 1 on any fail or gap
	local names=("$@")
	if [ ${#names[@]} -eq 0 ]; then names=(b2 b3 b4 b5); fi
	node -e '
		const r = require(process.argv[1]);
		const required = process.argv.slice(2);
		let bad = 0;
		for (const [name, check] of Object.entries(r)) {
			if (check.ok) { console.log("PASS " + name); }
			else { bad++; console.log("FAIL " + name + ": " + (check.detail || "")); }
		}
		for (const name of required) {
			if (!(name in r)) { bad++; console.log("FAIL " + name + ": absent from the harness results"); }
		}
		process.exit(bad ? 1 : 0);
	' "$RESULTS" "${names[@]}"
}

snapshot_results() { # $1 = stage. logs/ survives stage_window (which wipes home/), so a
	# per-stage copy is the only way CI can still show stage N's assertions after stage
	# N+1 has overwritten them.
	if [ -f "$RESULTS" ]; then
		cp "$RESULTS" "$SCRATCH/logs/$1-results.json" 2>/dev/null || true
	fi
}

export_accept_env() {
	export PICKET_WSL_RUNNER="$FAKE_WSL"
	export PICKET_WSL_FAKE_HOME="$SCRATCH/home"
	export PICKET_WSL_DISTRO="$DISTRO"
	export PICKET_WSL_ACCEPT_HOME="$SCRATCH"
	# Per-stage expectations are opt-in: a stage that exported one would otherwise
	# leak it into every later stage, which then fails an assertion it never set up
	# (a stage without a preseeded server-env-setup fails the takeover hook).
	unset WSL_HARNESS_EXPECT_ICODE_MISSING WSL_HARNESS_EXPECT_HOOK WSL_HARNESS_EXPECT_LEGACY
	# fake-wsl mimics wsl.exe: the distro side only sees the vars listed here.
	export WSLENV="WSL_HARNESS_FOLDER:WSL_HARNESS_EXPECT_ICODE_MISSING:WSL_HARNESS_EXPECT_HOOK:WSL_HARNESS_EXPECT_LEGACY"
	export WSL_HARNESS_FOLDER="$FOLDER"
	FOLDER_URI=$(folder_uri_for picket-wsl)
}

folder_uri_for() { # $1 = authority prefix (picket-wsl or the legacy wsl)
	local encoded
	encoded=$(node -e 'process.stdout.write(encodeURIComponent(process.argv[1]).replace(/%2F/gi, "/"))' "$FOLDER")
	echo "vscode-remote://$1+${DISTRO}${encoded}"
}

stage_window() { # $1 payload path, $2 configured icodePath, $3 tunnelMode
	local payload="$1" icode="${2:-}" tunnel="${3:-auto}"
	pkill -KILL -f "user-data-dir=$SCRATCH/home/.vscode-server/data" 2>/dev/null || true
	pkill -KILL -f "user-data-dir=$USER_DATA" 2>/dev/null || true
	rm -rf "$SCRATCH/home" "$SCRATCH/user-data" "$SCRATCH/ext"
	mkdir -p "$SCRATCH/home/.picket-code-server" "$SCRATCH/home/.vscode-server" "$SCRATCH/user-data/User" "$SCRATCH/user-data/extensions" "$SCRATCH/logs" "$FOLDER" "$STAGING"
	echo '# acceptance profile marker (proves the server runs under the login shell)' > "$SCRATCH/home/.profile"
	echo 'export PICKET_ACCEPT_PROFILE_MARKER=from-login-shell' >> "$SCRATCH/home/.profile"
	if ! cp -r "$ROOT/vscode/extensions/picket-remote-wsl/." "$STAGING"; then
		ko stage "could not stage the extension into $STAGING"
		return 1
	fi
	if ! cp "$DOWNLOAD/catalog.json" "$STAGING/payloads/catalog.json"; then
		ko stage "catalog.json missing under build/wsl/download (run build/wsl/fetch-payload.sh)"
		return 1
	fi
	# The 目标 view is declared `when: isWindows`; the Linux acceptance window
	# drives the stand-in wsl.exe, so drop the gate on the staged copy only
	# (otherwise the Remote Explorer container stays empty and hides itself).
	node -e '
		const fs = require("fs");
		const file = process.argv[1];
		const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
		delete manifest.contributes.views.remote[0].when;
		fs.writeFileSync(file, JSON.stringify(manifest, null, "\t") + "\n");
	' "$STAGING/package.json" || { ko stage "could not rewrite the staged manifest"; return 1; }
	# The harness asserts from inside the remote extension host, so it has to be
	# installed into the distro-side extensions dir the server scans.
	mkdir -p "$SCRATCH/home/.vscode-server/extensions"
	if ! cp -r "$HARNESS" "$SCRATCH/home/.vscode-server/extensions/picket.picket-wsl-harness-0.0.0"; then
		ko stage "could not install the harness extension"
		return 1
	fi
	if ! node -e '
		const fs = require("fs");
		const [file, payload, icode, tunnel] = process.argv.slice(1);
		fs.writeFileSync(file, JSON.stringify({
			"picket.wsl.serverPayloadPath": payload,
			"picket.wsl.icodePath": icode,
			"picket.wsl.tunnelMode": tunnel
		}, null, "\t") + "\n");
	' "$USER_DATA/User/settings.json" "$payload" "$icode" "$tunnel"; then
		ko stage "could not write the window settings"
		return 1
	fi
	export_accept_env
}

run_l2() {
	local log="$SCRATCH/logs/l2.log"
	mkdir -p "$SCRATCH/logs"
	echo "--- L2 extension unit tests"
	if ( cd "$ROOT/vscode/extensions/picket-remote-wsl" && node --test "test/*.test.js" >"$log" 2>&1 ); then
		ok l2
	else
		ko l2 "extension unit tests failed (log: $log)"
		# Without this the CI log says only "failed"; the name of the flaky case is
		# exactly what a reader of a red run needs.
		grep -E "^✖|^ℹ (tests|pass|fail)" "$log" | head -8
	fi
}

run_remote() {
	echo "--- remote: resolver connects a real window to the fake distro"
	local payload
	payload=$(payload) || { ko remote "payload tarball or catalog.json missing under build/wsl/download (run build/wsl/fetch-payload.sh)"; return; }
	stage_window "$payload" || return
	local log="$SCRATCH/logs/remote.log"
	local pid
	pid=$(launch_window "$log")
	if ! await_results "$REMOTE_DEADLINE"; then
		kill_window "$pid"
		ko remote "harness results did not appear within ${REMOTE_DEADLINE}s (log: $log)"
		return
	fi
	snapshot_results remote
	kill_window "$pid"
	if print_results; then ok remote; else ko remote "harness checks failed (log: $log)"; fi
}

run_tunnel() {
	echo "--- tunnel: the stdio relay carries a real window (tunnelMode = stdio)"
	local payload
	payload=$(payload) || { ko tunnel "payload tarball or catalog.json missing under build/wsl/download (run build/wsl/fetch-payload.sh)"; return; }
	stage_window "$payload" "" stdio || return
	local log="$SCRATCH/logs/tunnel.log"
	local pid
	pid=$(launch_window "$log")
	if ! await_results "$REMOTE_DEADLINE"; then
		kill_window "$pid"
		ko tunnel "harness results did not appear within ${REMOTE_DEADLINE}s over the tunnel (log: $log)"
		return
	fi
	snapshot_results tunnel
	kill_window "$pid"
	if print_results; then ok tunnel; else ko tunnel "harness checks failed over the stdio tunnel (log: $log)"; fi
}

run_ui() {
	echo "--- ui: Playwright smoke area (WSL remote window)"
	local payload
	payload=$(payload) || { ko ui "payload tarball or catalog.json missing under build/wsl/download (run build/wsl/fetch-payload.sh)"; return; }
	mkdir -p "$SCRATCH/logs" "$SCRATCH/home" "$SCRATCH/user-data/User" "$SCRATCH/ext"
	export_accept_env
	# The automation compile step carries a pre-existing playwright type drift
	# on this tree (upstream pins two playwright-core versions; their type
	# literals clash). tsc still emits, so its exit code is not gated here —
	# the smoke step below is, and it compiles ./src only.
	( cd "$ROOT/vscode/test/automation" && node ../../node_modules/typescript/bin/tsc6 >/dev/null 2>&1 ) \
		|| echo "[acceptance] automation compile reported pre-existing type drift; using its emitted output"
	if ! ( cd "$ROOT/vscode/test/smoke" && node ../../node_modules/typescript/bin/tsc6 ); then
		ko ui "test/smoke compile failed"; return
	fi
	# --fail-zero: a suite that skips (e.g. because a fixture is missing) must not
	# read as a pass.
	if ( cd "$ROOT/vscode/test/smoke" && node test/index.js -f wsl --fail-zero >"$SCRATCH/logs/ui.log" 2>&1 ); then
		ok ui
	else
		ko ui "smoke area failed (log: $SCRATCH/logs/ui.log)"
	fi
}

run_lifecycle() {
	echo "--- lifecycle: $CYCLES window cycles reuse exactly one server process"
	local payload
	payload=$(payload) || { ko lifecycle "payload tarball or catalog.json missing under build/wsl/download (run build/wsl/fetch-payload.sh)"; return; }
	stage_window "$payload" || return
	local log="$SCRATCH/logs/lifecycle-first.log"
	local pid
	pid=$(launch_window "$log")
	if ! await_results "$REMOTE_DEADLINE"; then
		kill_window "$pid"
		ko lifecycle "first window never connected (log: $log)"; return
	fi
	snapshot_results lifecycle
	kill_window "$pid"
	local first_pid
	first_pid=$(server_pids | head -1)
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
		local now
		now=$(server_pids | head -1)
		if [ "$now" != "$first_pid" ]; then bad="server pid changed $first_pid -> $now at window $i"; break; fi
	done
	if [ -n "$bad" ]; then ko lifecycle "$bad"; return; fi
	local count
	count=$(server_pids | wc -l)
	if [ "$count" -eq 1 ]; then
		ok lifecycle
	else
		ko lifecycle "expected 1 server process at the end, found $count: $(server_pids | while read -r p; do ps -o pid=,args= -p "$p" | cut -c1-140; done | tr '\n' '|')"
	fi
}

run_icode() {
	echo "--- icode: a bogus configured path must not be exported into the server"
	local payload
	payload=$(payload) || { ko icode "payload tarball or catalog.json missing under build/wsl/download (run build/wsl/fetch-payload.sh)"; return; }
	stage_window "$payload" "/nonexistent/icode" || return
	export WSL_HARNESS_EXPECT_ICODE_MISSING=1
	local log="$SCRATCH/logs/icode.log"
	local pid
	pid=$(launch_window "$log")
	if ! await_results "$REMOTE_DEADLINE"; then
		kill_window "$pid"
		ko icode "window never connected (log: $log)"
		return
	fi
	snapshot_results icode
	kill_window "$pid"
	local icode_check
	icode_check=$(node -e 'const r=require(process.argv[1]); process.stdout.write(r.icode ? (r.icode.ok ? "ok" : "fail: "+r.icode.detail) : "absent")' "$RESULTS")
	if [ "$icode_check" = "ok" ]; then ok icode; else ko icode "$icode_check"; fi
}

run_conflict() {
	echo "--- conflict: the official extension is installed, so nothing may be mounted"
	local payload
	payload=$(payload) || { ko conflict "payload tarball or catalog.json missing under build/wsl/download (run build/wsl/fetch-payload.sh)"; return; }
	stage_window "$payload" || return

	# The stand-in official extension: the gate reads the id and nothing else, so
	# nothing about enablement, activation or the manifest has to be faked here.
	local conflict_id="${PICKET_WSL_CONFLICT_ID:-ms-vscode-remote.remote-wsl}"
	local fake="$USER_DATA/extensions/${conflict_id}-1.999.0"
	mkdir -p "$fake"
	if ! node -e '
		const fs = require("fs");
		const [dir, id] = process.argv.slice(1);
		const at = id.indexOf(".");
		if (at < 1) { throw new Error("PICKET_WSL_CONFLICT_ID must look like publisher.name"); }
		fs.writeFileSync(dir + "/package.json", JSON.stringify({
			name: id.slice(at + 1), publisher: id.slice(0, at), version: "1.999.0",
			displayName: "Official Remote-WSL stand-in",
			description: "Stands in for ms-vscode-remote.remote-wsl so the gate can be asserted without the real extension.",
			engines: { vscode: "^1.143.0" }, categories: ["Other"],
			main: "./extension.js", private: true,
			// The real extension declares this, and it decides where the extension
			// runs: without it the stand-in is workspace-kind and never reaches the
			// local extension host, where the gate looks for it.
			extensionKind: ["ui"],
			activationEvents: ["onStartupFinished"],
			capabilities: { virtualWorkspaces: true, untrustedWorkspaces: { supported: true } }
		}, null, "\t") + "\n");
		fs.writeFileSync(dir + "/extension.js", "exports.activate = () => { };\n");
	' "$fake" "$conflict_id"; then
		ko conflict "could not write the stand-in official extension"; return
	fi
	if ! cp -r "$HARNESS_CONFLICT" "$USER_DATA/extensions/picket.picket-wsl-conflict-harness-0.0.0"; then
		ko conflict "could not install the conflict probe"; return
	fi

	rm -f "$CONFLICT_RESULTS"
	export PICKET_WSL_CONFLICT_RESULTS="$CONFLICT_RESULTS"
	local log="$SCRATCH/logs/conflict.log" pid
	pid=$(launch_window "$log")
	if ! await_file "$CONFLICT_RESULTS" 150; then
		kill_window "$pid"
		ko conflict "the conflict probe never reported (log: $log)"; return
	fi
	kill_window "$pid"

	local verdict
	verdict=$(node -e '
		const r = require(process.argv[1]);
		process.stdout.write(r.failures.length === 0 ? "ok" : "fail: " + r.failures.join("; "));
	' "$CONFLICT_RESULTS")
	if [ "$verdict" != ok ]; then ko conflict "$verdict"; return; fi
	# A mounted surface would have started a server; a closed one cannot.
	if [ -n "$(server_pids | head -1)" ]; then
		ko conflict "a server process was started while the gate was closed"; return
	fi
	if ! grep -rqs "WSL features are disabled" "$USER_DATA/logs"; then
		ko conflict "the extension log does not say why the surface is off"; return
	fi
	ok conflict
}

run_takeover() {
	echo "--- takeover: the official server's ~/.vscode-server survives intact"
	local payload
	payload=$(payload) || { ko takeover "payload tarball or catalog.json missing under build/wsl/download (run build/wsl/fetch-payload.sh)"; return; }
	stage_window "$payload" || return

	local root="$SCRATCH/home/.vscode-server"
	mkdir -p "$root/data/User" "$root/extensions"
	printf '{\n\t"editor.fontSize": 15\n}\n' > "$root/data/User/settings.json"
	printf 'export PICKET_OFFICIAL_HOOK=kept\n' > "$root/server-env-setup"
	if ! node -e '
		const fs = require("fs");
		const [root] = process.argv.slice(1);
		const dir = root + "/extensions/carried-1.0.0";
		fs.mkdirSync(dir, { recursive: true });
		fs.writeFileSync(dir + "/package.json", JSON.stringify({
			name: "carried", publisher: "legacy", version: "1.0.0",
			engines: { vscode: "^1.60.0" }, main: "./extension.js", private: true
		}, null, "\t") + "\n");
		fs.writeFileSync(dir + "/extension.js", "exports.activate = () => { };\n");
		// The cache is authoritative: a folder the server does not find listed here
		// is not scanned, and the harness (installed by the driver) would never run.
		const harness = "picket.picket-wsl-harness-0.0.0";
		fs.writeFileSync(root + "/extensions/extensions.json", JSON.stringify([{
			identifier: { id: "legacy.carried" }, version: "1.0.0",
			location: { $mid: 1, path: dir, scheme: "file" },
			relativeLocation: "carried-1.0.0"
		}, {
			identifier: { id: "picket.picket-wsl-harness" }, version: "0.0.0",
			location: { $mid: 1, path: root + "/extensions/" + harness, scheme: "file" },
			relativeLocation: harness
		}], null, "\t") + "\n");
	' "$root"; then
		ko takeover "could not preseed the shared server tree"; return
	fi
	local hook_before settings_before
	hook_before=$(sha256sum "$root/server-env-setup" | cut -d" " -f1)
	settings_before=$(sha256sum "$root/data/User/settings.json" | cut -d" " -f1)

	# The hook is the proof that takeover reads the old tree instead of replacing
	# it: it is sourced by the launch and must reach the remote extension host.
	export WSL_HARNESS_EXPECT_HOOK=1
	local log="$SCRATCH/logs/takeover.log" pid
	pid=$(launch_window "$log")
	if ! await_results "$REMOTE_DEADLINE"; then
		kill_window "$pid"
		ko takeover "window never connected (log: $log)"; return
	fi
	snapshot_results takeover
	kill_window "$pid"

	if [ "$(sha256sum "$root/server-env-setup" | cut -d" " -f1)" != "$hook_before" ]; then
		ko takeover "server-env-setup was rewritten"; return
	fi
	if [ "$(sha256sum "$root/data/User/settings.json" | cut -d" " -f1)" != "$settings_before" ]; then
		ko takeover "the server's user settings were rewritten"; return
	fi
	local carried
	carried=$(node -e '
		const fs = require("fs");
		const raw = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
		const list = Array.isArray(raw) ? raw : (raw.extensions || []);
		const hit = list.find(e => (e.identifier && e.identifier.id) === "legacy.carried");
		process.stdout.write(hit ? "ok" : "fail: legacy.carried disappeared from extensions.json");
	' "$root/extensions/extensions.json" 2>&1)
	[ "$carried" = ok ] || { ko takeover "$carried"; return; }
	local stray
	stray=$(find "$root/bin" -maxdepth 1 -mindepth 1 -printf '%f\n' 2>/dev/null | grep -vE '^picket-' || true)
	if [ -n "$stray" ]; then
		ko takeover "unexpected entries under ~/.vscode-server/bin: $stray"; return
	fi
	if print_results b2 b3 b4 b5 hook; then ok takeover; else ko takeover "harness checks failed (log: $log)"; fi
}

run_legacy_uri() {
	echo "--- legacy-uri: a workspace saved as wsl+<distro> still opens"
	local payload
	payload=$(payload) || { ko legacy-uri "payload tarball or catalog.json missing under build/wsl/download (run build/wsl/fetch-payload.sh)"; return; }
	stage_window "$payload" || return
	# The address the official extension left in history and in saved workspaces.
	FOLDER_URI=$(folder_uri_for wsl)
	export WSL_HARNESS_EXPECT_LEGACY=1
	local log="$SCRATCH/logs/legacy-uri.log" pid
	pid=$(launch_window "$log")
	if ! await_results "$REMOTE_DEADLINE"; then
		kill_window "$pid"
		ko legacy-uri "window never connected (log: $log)"; return
	fi
	snapshot_results legacy-uri
	kill_window "$pid"
	if print_results b2 b3 b4 b5 legacy; then ok legacy-uri; else ko legacy-uri "harness checks failed (log: $log)"; fi
}

usage() {
	echo "usage: bash build/wsl/acceptance.sh [--l2] [--remote] [--tunnel] [--ui] [--lifecycle] [--icode] [--conflict] [--takeover] [--legacy-uri] [--all]"
}

main() {
	[ $# -eq 0 ] && { usage; exit 2; }
	local l2=0 remote=0 tunnel=0 ui=0 lifecycle=0 icode=0 conflict=0 takeover=0 legacy=0
	while [ $# -gt 0 ]; do
		case "$1" in
			--l2) l2=1 ;;
			--remote) remote=1 ;;
			--tunnel) tunnel=1 ;;
			--ui) ui=1 ;;
			--lifecycle) lifecycle=1 ;;
			--icode) icode=1 ;;
			--conflict) conflict=1 ;;
			--takeover) takeover=1 ;;
			--legacy-uri) legacy=1 ;;
			--all) l2=1 remote=1 tunnel=1 ui=1 lifecycle=1 icode=1 conflict=1 takeover=1 legacy=1 ;;
			*) usage; exit 2 ;;
		esac
		shift
	done

	# A window left behind by an interrupt would hold the display and the
	# scratch directory the next stage wipes.
	trap 'pkill -KILL -f "user-data-dir=$USER_DATA" 2>/dev/null; pkill -KILL -f "out/server-main.js .*user-data-dir=$SCRATCH/home/.vscode-server/data" 2>/dev/null; true' EXIT

	[ $l2 -eq 1 ] && run_l2
	[ $remote -eq 1 ] && run_remote
	[ $tunnel -eq 1 ] && run_tunnel
	[ $ui -eq 1 ] && run_ui
	[ $lifecycle -eq 1 ] && run_lifecycle
	[ $icode -eq 1 ] && run_icode
	[ $conflict -eq 1 ] && run_conflict
	[ $takeover -eq 1 ] && run_takeover
	[ $legacy -eq 1 ] && run_legacy_uri

	if [ "$FAILED" -eq 0 ]; then
		echo "==> WSL acceptance: all selected checks passed"
		rm -rf "$SCRATCH"
	else
		echo "==> WSL acceptance: failures above (scratch kept at $SCRATCH)"
	fi
	exit "$FAILED"
}

main "$@"
