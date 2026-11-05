# Picket Code WSL Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a built-in `picket-remote-wsl` extension so Windows Picket Code can open folders inside a WSL2 distro, with the workspace running on a Picket Code server installed from a catalog-checked payload.

**Architecture:** A UI-kind built-in extension registers the `picket-wsl` remote authority resolver, contributes a `WSL 目标` tree view, and starts the server through the distro's login shell. It enumerates distros via an injectable `wsl.exe` runner, ensures a server payload exists inside the distro (`~/.picket-code-server/payloads/server-<tag>/`), spawns `picket-code-server`, parses its listening port, and answers the resolver with `{ host: '127.0.0.1', port, connectionToken }` — or with a stdio-tunnelled local port when WSL's localhost forwarding is off. Payloads come from an explicit path, an embedded copy (intranet flavor only), or an intranet/public URL, and are always SHA256-checked against `payloads/catalog.json`.

**Tech Stack:** Plain CommonJS JavaScript inside `vscode/extensions/picket-remote-wsl/` (no compile step), `node --test` for L1/L2, `vscode.proposed.resolvers` API, `wsl.exe`, Node `http`/`net`/`child_process`, and repo build scripts under `build/wsl/` (Node ESM) for packaging and contract checks.

**Spec:** `docs/superpowers/specs/2026-11-04-picket-wsl-design.md` (v5)

## Global Constraints

- Authority format is exactly `picket-wsl+<distro>`; `<distro>` empty means the default distro. Resolver registers prefix `picket-wsl`.
- Extension id is `noware.picket-remote-wsl`; `extensionKind: ["ui"]`; `enabledApiProposals: ["resolvers", "contribViewsRemote"]`; matching entry `"noware.picket-remote-wsl": ["resolvers", "contribViewsRemote"]` in `build/product.json` → `extensionEnabledApiProposals`. Activation events are `onStartupFinished` and `onResolveRemoteAuthority:picket-wsl` (core emits the second one per authority prefix, `extHostExtensionService.ts:849`).
- In-distro layout, all under the distro user's `$HOME`: `~/.picket-code-server/payloads/server-<tag>/`, `~/.picket-code-server/runtime/<distro>.json`, `~/.picket-code-server/data/`, `~/.picket-code-server/extensions/`, `~/.picket-code-server/logs/`.
- Server flags, verbatim: `--host=127.0.0.1 --port=0 --connection-token=<token> --use-host-proxy --without-browser-env-var --disable-websocket-compression --accept-server-license-terms --user-data-dir=<data> --extensions-dir=<ext> --log=trace`.
- Server start goes through the distro login shell: `wsl.exe -d <d> -e sh -lc '<constant script>' <binary> <setupFile> <icodeBin> <flags...>` where the script is `setup="$1"; icode="$2"; shift 2; [ -f "$setup" ] && . "$setup"; [ -n "$icode" ] && export PICKET_ICODE_BIN="$icode"; exec "$0" "$@"`. Values travel as argv, never inside the script text; `setupFile` is `<home>/.picket-code-server/server-env-setup` (may not exist), `icodeBin` is `""` when unset.
- Distro enumeration uses `wsl.exe --list --verbose` (UTF-16LE). The default distro is the row whose first column is `*`; the last column is the WSL major version. `-l -q` is not used: it carries neither. Rows matching `docker-desktop*` are hidden unless they are the default.
- WSL ↔ Windows path conversion is `wslpath -u` (Windows→Linux) and `wslpath -w` (Linux→Windows), executed inside the distro; failures surface `wslpath failed: <stderr>`.
- Port is read from server stdout with `Extension host agent listening on (\d+)`; connection token is 4 segments joined by `-`, each from `crypto.randomInt(0x100000000).toString(16).padStart(8, '0')`.
- Liveness probe: `GET http://<host>:<port>/vscode-remote-resource?tkn=<token>` — 400 = alive, 403 = token mismatch, anything else (refused/timeout) = dead. Timeout 2 s.
- Start watchdog: 90 s without any server output fails the start (`picket.wsl.startTimeoutSeconds`, default 90). Server exit code 99 = distro not supported.
- Payload file name is `picket-code-server-<picketTag>-linux-x64.tar.gz`; `picketTag` equals `product.json.picketTag`, stamped at build time from the release tag.
- Component catalog lives at `<extensionPath>/payloads/catalog.json`; payloads for the `embedded` flavor live at `<extensionPath>/payloads/`; `ondemand` flavor must contain no `*.tar.gz` there.
- Default settings: `picket.wsl.serverPayloadBaseUrl` = `https://download.noware.cn/wsl/`, `picket.wsl.startTimeoutSeconds` = 90, `picket.wsl.probeRetrySeconds` = 60, `picket.wsl.tunnelMode` = `auto`, all string paths default `""`.
- Never build a shell command string by concatenation; `wsl.exe` invocations take an argv array, and in-distro work is one of `wsl.exe -d <d> -e sh -c '<constant script with positional args>'`.
- Extension source is CommonJS; test files are `*.test.js` run by `node --test`.
- Do not run `npm run build-fast`, `npm run compile`, or a full-tree `tsc` in `vscode/` (removed copilot extension / OOM). Emit is `cd vscode && npm run transpile-client`.
- **Gate after every commit step:** `bash build/wsl/gate.sh`. It fails when a suite fails, when `tsc --checkJs` reports a cross-file signature error, when patch 67 no longer reverses, or when `vscode/` is dirty. The dirty check is meaningful right after a commit; mid-task dirt is expected, so run the gate at the end of a task, not after every edit. Two local type-check configs are git-excluded and never enter a patch: `vscode/extensions/picket-remote-wsl/tsconfig.json` (checkJs over the extension) and `vscode/src/tsconfig.entry.json`.

## Review Focus

1. **`wsl.exe --list --verbose` emits UTF-16LE, and it is the only form that carries the default marker and the WSL version.** A UTF-8-only decoder yields distro names with embedded NULs, so every distro lookup fails with a confusing "distro not found"; using `-l -q` instead loses the `*` column and the `VERSION` column, so "the default distro" silently becomes "the first row". Pinned by a test in Task 2 that feeds UTF-16LE and UTF-8 buffers to the decoder and asserts the `*`/version columns.
2. **Distro names with spaces, dots or non-ASCII** (`Ubuntu 22.04 LTS`, `Ubuntu-24.04`). They travel through an authority string, a URI, and `-d <name>`. Pinned in Task 2 (enumeration keeps trailing whitespace out, drops `\r`) and Task 6 (authority round-trips through `remoteUriFor`).
3. **Two windows opening the same distro at the same time.** Both see "installed" and both spawn a server, so two servers race for `data/`. Pinned by the first-start lock test in Task 5.
4. **Disk full or an interrupted `tar` stream** leaves a half-extracted `payloads/server-<tag>/` that later starts fail on with no explanation. Pinned by the atomic-install test in Task 3 (writes to `.tmp-<rand>` then renames; a failure leaves nothing behind).
5. **Noisy stdout from the distro**: a shell profile banner or `wsl.exe`'s own warnings before the listening line, or server output after it. Starting through a **login shell** makes banners more likely, not less. Pinned by the port-parser test in Task 5 (banner lines before and unrelated lines after are ignored) and the tunnel preamble test in Task 12.
6. **A login shell is not an interactive shell.** Many distros return early from `.bashrc` for non-interactive shells, so a `PATH` export that lives only there stays invisible to the server; conversely a `PATH` export in `.profile` is picked up. The `server-env-setup` hook is the documented escape hatch, and `Picket: 诊断 WSL 支持` prints whether `node` and `git` resolve — pinned by the `buildServerArgs` argv test in Task 5 plus a line of the diagnostics test in Task 9.

---

## File Structure

**Inside the generated `vscode/` tree (exported as a patch, committed inside that tree):**

- `vscode/extensions/picket-remote-wsl/package.json` — id, commands, settings, `enabledApiProposals`.
- `vscode/extensions/picket-remote-wsl/extension.js` — activate/deactivate, wiring only.
- `.../src/catalog.js` — load/validate `payloads/catalog.json`.
- `.../src/components.js` — component state machine, install orchestration, uninstall, old-version cleanup.
- `.../src/payload.js` — source selection, `SHA256SUMS` parsing, download with progress, atomic install into the distro.
- `.../src/distro.js` — `wsl.exe` runner, distro enumeration, `$HOME`, WSL1 detection, output decoding.
- `.../src/preflight.js` — `%USERPROFILE%\.wslconfig` parsing and tunnel-mode choice.
- `.../src/icode.js` — iCode detection and `PICKET_ICODE_BIN` injection value.
- `.../src/launch.js` — server argv, port parsing, watchdog, runtime file read/write, stop.
- `.../src/probe.js` — 400/403/dead probe.
- `.../src/tunnel.js` — stdio tunnel.
- `.../src/resolver.js` — authority resolution, reuse, restart, dispose.
- `.../src/remoteUri.js` — UNC ↔ remote URI conversion.
- `.../src/commands.js` — command registration and the first-use interception.
- `.../src/tree.js` — `WSL Targets` tree data (distro rows, badges, context values).
- `.../src/manage.js` — add / set-default / delete distro.
- `.../src/shim.js` — install and remove the in-distro `picket-code` CLI shim.
- `.../src/diagnose.js` — diagnostic report.
- `.../src/nudge.js` — one-time hint in `\\wsl.localhost` windows.
- `.../src/log.js` — OutputChannel + log file path.
- `.../test/*.test.js`, `.../test/fixtures/fake-wsl.js`.
- `vscode/src/bootstrap-meta.ts` + `vscode/src/vs/base/common/productOverrides.ts` + `vscode/src/vs/base/test/common/productOverrides.test.ts` — patch 66.

**In the main repo (`picket-code`):**

- `build/patches/66-gallery-no-account.patch`, `build/patches/67-picket-remote-wsl.patch` + `build/patches/apply-list.txt`.
- `build/product.json` — API proposal entry.
- `build/wsl/assemble.mjs` — stamp `picketTag`, build `catalog.json`, embed payload (both flavors).
- `build/wsl/check.mjs` — L4 assertions for one built app directory.
- `build/wsl/offline-bundle.mjs` — produce the offline component zip.
- `build/wsl/fetch-payload.sh` — download payload + `SHA256SUMS` for a tag.
- `build/wsl/test/*.test.mjs` — `node --test` for the three scripts above.
- `build/win32/package.sh`, `build/build.sh`, `build/check-contract.sh`, `.github/workflows/release.yml` — wiring.
- `docs/wsl.md` — user documentation; `docs/testing.md` — L3 manual checklist.

---

### Task 1: Extension skeleton, catalog contract, and patch baseline ✅

**Files:**
- Create: `vscode/extensions/picket-remote-wsl/package.json`
- Create: `vscode/extensions/picket-remote-wsl/extension.js`
- Create: `vscode/extensions/picket-remote-wsl/src/catalog.js`
- Create: `vscode/extensions/picket-remote-wsl/src/log.js`
- Create: `vscode/extensions/picket-remote-wsl/.vscodeignore`
- Test: `vscode/extensions/picket-remote-wsl/test/catalog.test.js`
- Modify: `build/product.json` (API proposal entry)
- Create: `build/patches/67-picket-remote-wsl.patch` (exported, not hand-written)

**Interfaces:**
- Produces: `loadCatalog(extensionPath: string): Promise<ICatalog>` where `ICatalog = { tag: string | null, flavor: 'embedded' | 'ondemand', components: ICatalogComponent[] }` and `ICatalogComponent = { id: string, kind: 'server' | 'extensions', version: string, file: string, size: number, sha256: string, embedded: boolean, embeddedPath?: string }`. Missing or malformed catalog resolves to `{ tag: null, flavor: 'ondemand', components: [] }` — never throws.
- Produces: `createLog(context: vscode.ExtensionContext): { info(msg: string): void, error(msg: string): void, show(): void, logFile: string }`.
- Produces: command ids `picket.wsl.openFolder`, `picket.wsl.reopenInWsl`, `picket.wsl.reopenInWindows`, `picket.wsl.stopServer`, `picket.wsl.components`, `picket.wsl.showLog`, `picket.wsl.diagnose`, `picket.wsl.addDistro`, `picket.wsl.setDefaultDistro`, `picket.wsl.deleteDistro`, `picket.wsl.selectGallery`, `picket.wsl.installVsix`, `picket.wsl.installCli`, `picket.wsl.removeCli`, `picket.wsl.refreshTargets`, and settings `picket.wsl.{defaultDistro,serverPayloadPath,serverPayloadBaseUrl,icodePath,startTimeoutSeconds,probeRetrySeconds,tunnelMode}`.

- [x] **Step 1: Write the failing test**

`test/catalog.test.js` — four cases: valid catalog parsed; `embedded: false` keeps `embeddedPath` undefined; invalid JSON yields the empty catalog; a component missing `sha256` is dropped while the rest survive.

```js
const test = require('node:test');
const assert = require('node:assert');
const { loadCatalog } = require('../src/catalog.js');
const { mkdtempSync, mkdirSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

function extensionWith(catalog) {
	const dir = mkdtempSync(join(tmpdir(), 'picket-wsl-'));
	mkdirSync(join(dir, 'payloads'), { recursive: true });
	writeFileSync(join(dir, 'payloads', 'catalog.json'), catalog);
	return dir;
}

test('parses a valid catalog', async () => {
	const dir = extensionWith(JSON.stringify({ tag: 'v1.143.1-picket.1-rc.4', flavor: 'embedded', components: [{
		id: 'wsl-server', kind: 'server', version: 'v1.143.1-picket.1-rc.4',
		file: 'picket-code-server-v1.143.1-picket.1-rc.4-linux-x64.tar.gz',
		size: 87031808, sha256: 'a'.repeat(64), embedded: true,
		embeddedPath: 'picket-code-server-v1.143.1-picket.1-rc.4-linux-x64.tar.gz'
	}] }));
	const catalog = await loadCatalog(dir);
	assert.strictEqual(catalog.tag, 'v1.143.1-picket.1-rc.4');
	assert.strictEqual(catalog.components.length, 1);
	assert.strictEqual(catalog.components[0].embeddedPath, 'picket-code-server-v1.143.1-picket.1-rc.4-linux-x64.tar.gz');
});

test('missing catalog is an empty ondemand catalog', async () => {
	const catalog = await loadCatalog(extensionWith(''));  // no catalog.json written
	assert.deepStrictEqual(catalog, { tag: null, flavor: 'ondemand', components: [] });
});

test('malformed catalog is an empty ondemand catalog', async () => {
	const catalog = await loadCatalog(extensionWith('{ not json'));
	assert.deepStrictEqual(catalog, { tag: null, flavor: 'ondemand', components: [] });
});

test('drops components without a sha256', async () => {
	const dir = extensionWith(JSON.stringify({ tag: 't', flavor: 'ondemand', components: [
		{ id: 'a', kind: 'server', version: 't', file: 'a.tar.gz', size: 1, sha256: 'b'.repeat(64) },
		{ id: 'b', kind: 'server', version: 't', file: 'b.tar.gz', size: 1 }
	] }));
	const catalog = await loadCatalog(dir);
	assert.deepStrictEqual(catalog.components.map(c => c.id), ['a']);
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `cd vscode/extensions/picket-remote-wsl && node --test test/catalog.test.js`
Expected: FAIL — `Cannot find module '../src/catalog.js'`.

- [x] **Step 3: Create the extension manifest, `catalog.js`, `log.js`, `.vscodeignore`**

`package.json` fields to get right: `"name": "picket-remote-wsl"`, `"publisher": "noware"`, `"main": "./extension.js"`, `"extensionKind": ["ui"]`, `"enabledApiProposals": ["resolvers", "contribViewsRemote"]`, `"engines": { "vscode": "^1.143.0" }`, `"activationEvents": ["onStartupFinished", "onResolveRemoteAuthority:picket-wsl"]`, the fifteen command ids with `Picket:`-prefixed titles from spec §4.9, and the eight settings from Global Constraints.

Also in the manifest, because discovery is the difference between "works" and "findable": `contributes.menus.commandPalette` entries with `when: "isWindows && !isWeb"` (plus `remoteName`/`workspaceFolderCount` narrowing for the reopen commands), `contributes.menus["statusBar/remoteIndicator"]` entries for connect / connect-distro / connect-new-window / reopen-in-windows / show-log / diagnose in group `remote_10_picket-wsl_0_local` (and `_1_open` for the connected-window ones), `contributes.views.remote` with `picketWsl.targets` named `WSL 目标` and `when: "isWindows && !isWeb"` plus `view/title` entries for `picket.wsl.refreshTargets` and `picket.wsl.addDistro`, two `contributes.viewsWelcome` entries (WSL missing, no distros), and `contributes.resourceLabelFormatters` for scheme `vscode-remote` / authority `picket-wsl+*` with `label: "${path}"`, `separator: "/"`, `tildify: true`, `workspaceSuffix: "WSL"`. `.vscodeignore` excludes `test/**` and `**/*.map`.

`catalog.js` exports only `loadCatalog`. Validation rule: a component is kept only if `id`, `kind`, `version`, `file` are non-empty strings, `sha256` matches `/^[0-9a-f]{64}$/`, and `size` is a positive integer; when `embedded` is true, `embeddedPath` must be a relative path that does not contain `..`.

`log.js` writes to an `OutputChannel` named `Picket WSL` and to `<context.logUri>/picket-wsl.log` via `appendFile`, creating the directory first.

`extension.js` for now: `activate` builds the log, calls `loadCatalog`, logs `Picket WSL activated (tag=<tag|none>, components=<n>)`, and registers a placeholder `picket.wsl.showLog` command.

- [x] **Step 4: Run the test to verify it passes**

Run: `cd vscode/extensions/picket-remote-wsl && node --test test/catalog.test.js`
Expected: PASS, 4 tests.

- [x] **Step 4.5: Settle the container question from the official manifest, not from a GUI run**

The risk was that `viewsExtensionPoint.ts:537` forces `workspace: true` on views contributed to `remote`, hiding ours in an empty window. Settled statically: the official Remote-WSL manifest contributes exactly `{"views": {"remote": [{"id": "targetsWsl", ...}]}}`, and that view is the one users see in an empty local window — so the forcing does not gate on `workspaceFolderCount`. No GUI run is needed here; the runtime assertion (command count, `remoteName`, `getChildren` firing) moves to Task 8, where a real tree provider exists and the check costs nothing extra.

Do not add `remoteName` to our view: the official sets `"remoteName": "wsl"`, but the field is marked `TODO@roblou - delete after remote extensions are updated` and omitting it applies no filter at all.

- [x] **Step 5: Add the API proposal entry and export the patch**

Add to `build/product.json`, inside the existing `extensionEnabledApiProposals` object, alongside the `ms-vscode-remote.remote-wsl` entry: `"noware.picket-remote-wsl": ["resolvers", "contribViewsRemote"]`. Then in `vscode/`:

```bash
git rev-parse --verify wsl-baseline   # set during setup; marks the tree with patches 52-65 applied
git add extensions/picket-remote-wsl
git status --short                    # only extension files may be listed
git commit -m "feat(wsl): picket-remote-wsl skeleton with catalog contract"
git diff wsl-baseline -- extensions/picket-remote-wsl > ../build/patches/67-picket-remote-wsl.patch
cd .. && git apply -R --check build/patches/67-picket-remote-wsl.patch --directory=vscode
```

Expected: commit succeeds, the patch reverses cleanly (exit 0). Add `67-picket-remote-wsl.patch` to `build/patches/apply-list.txt` after `65-...`, and commit both in the main repo with `feat(wsl): add picket-remote-wsl skeleton (patch 67)`. Then run `bash build/wsl/gate.sh` and expect four PASS lines (the `node --test` line passes with 4 tests from this task).

---

### Task 2: `wsl.exe` runner, output decoding, distro discovery ✅

**Files:**
- Create: `vscode/extensions/picket-remote-wsl/src/distro.js`
- Test: `vscode/extensions/picket-remote-wsl/test/distro.test.js`
- Create: `vscode/extensions/picket-remote-wsl/test/fixtures/fake-wsl.js`

**Interfaces:**
- Produces: `decodeWslOutput(buffer: Buffer): string` — if the buffer contains a `0x00` byte, decode as `utf16le`, else `utf8`; strip `\uFEFF`, split on `/\r?\n/`, trim each line, drop empty lines, join with `\n`.
- Produces: `createWslRunner({ wslPath = 'wsl.exe', spawn = require('node:child_process').spawn, cwd, timeoutMs = 30000 }): IWslRunner` with `IWslRunner = { exec(args: string[], opts?: { input?: string | Buffer, timeoutMs?: number }): Promise<{ code: number, stdout: string, stderr: string }>, spawn(args: string[]): { child, stdout, stderr } }`. `exec` rejects only on spawn error (`ENOENT`) or timeout; non-zero exit codes resolve with `code`.
- Produces: `parseDistroTable(stdout: string): IDistro[]` where `IDistro = { name: string, isDefault: boolean, version: '1' | '2', state: string }`, parsed from `wsl.exe --list --verbose` (header row skipped; the `*` column carries the default; the last column is the WSL major version; `state` keeps whatever the column says).
- Produces: `listDistros(runner): Promise<IDistro[]>`, `defaultDistro(runner): Promise<string>` (first `isDefault`, else the first row), `visibleDistros(list): IDistro[]` (drops names matching `/^docker-desktop/i` unless `isDefault`), `distroHome(runner, distro)`, `isWsl1(runner, distro)`, `distroStatus(runner, distro): Promise<'missing' | 'ok'>`, and `wslStatus(runner): Promise<{ installed: boolean, kernelUpdateRequired: boolean }>` from `wsl.exe --status` (`installed` is false when the command fails with stderr matching `/not installed|not enabled/i`; `kernelUpdateRequired` when stderr matches `/kernel/i`).
- Consumes: nothing from earlier tasks.

- [x] **Step 1: Write the failing test**

`test/distro.test.js` — cases: a UTF-16LE verbose table decodes with the `*` marker and the version column; a UTF-8 buffer without NULs decodes; `visibleDistros` hides `docker-desktop` unless it is the default; a non-zero exit for an unknown distro makes `distroStatus` report `'missing'`; `wslStatus` reports `installed: false` for `WSL is not installed`; `distroHome` returns the single non-empty line of `-e printenv HOME`.

```js
const test = require('node:test');
const assert = require('node:assert');
const { decodeWslOutput, parseDistroTable, listDistros, visibleDistros, distroHome, distroStatus, wslStatus } = require('../src/distro.js');

function runner(responses) {
	return { exec: async (args) => {
		const key = args.join(' ');
		const hit = responses[key];
		if (!hit) { throw new Error(`unexpected wsl args: ${key}`); }
		return hit;
	}, spawn: () => { throw new Error('not used'); } };
}

const TABLE = [
	'  NAME            STATE           VERSION',
	'* Ubuntu-24.04    Running         2',
	'  Ubuntu 22.04 LTS Stopped        1',
	'  docker-desktop  Running         2',
	''
].join('\r\n');

test('decodes a UTF-16LE verbose table with marker and version', () => {
	const list = parseDistroTable(decodeWslOutput(Buffer.from(TABLE, 'utf16le')));
	assert.deepStrictEqual(list, [
		{ name: 'Ubuntu-24.04', isDefault: true, version: '2', state: 'Running' },
		{ name: 'Ubuntu 22.04 LTS', isDefault: false, version: '1', state: 'Stopped' },
		{ name: 'docker-desktop', isDefault: false, version: '2', state: 'Running' }
	]);
});

test('decodes UTF-8 output without NUL bytes', () => {
	assert.strictEqual(decodeWslOutput(Buffer.from('Ubuntu 22.04 LTS\r\n')), 'Ubuntu 22.04 LTS');
});

test('hides docker-managed distros unless they are the default', () => {
	const list = parseDistroTable(TABLE);
	assert.deepStrictEqual(visibleDistros(list).map(d => d.name), ['Ubuntu-24.04', 'Ubuntu 22.04 LTS']);
	const promoted = parseDistroTable(TABLE.replace('* Ubuntu-24.04', '  Ubuntu-24.04').replace('  docker-desktop', '* docker-desktop'));
	assert.ok(visibleDistros(promoted).some(d => d.name === 'docker-desktop'));
});

test('lists distros through the runner', async () => {
	const r = runner({ '--list --verbose': { code: 0, stdout: Buffer.from(TABLE, 'utf16le'), stderr: '' } });
	const list = await listDistros(r);
	assert.strictEqual(list[0].name, 'Ubuntu-24.04');
	assert.strictEqual(list[0].isDefault, true);
});

test('reports a missing distro from a non-zero exit', async () => {
	const r = runner({ '-d Nope -e true': { code: 1, stdout: '', stderr: '' } });
	assert.strictEqual(await distroStatus(r, 'Nope'), 'missing');
});

test('reports WSL as not installed from --status', async () => {
	const r = runner({ '--status': { code: 1, stdout: '', stderr: 'WSL is not installed. Run wsl --install.' } });
	assert.deepStrictEqual(await wslStatus(r), { installed: false, kernelUpdateRequired: false });
});

test('reads $HOME from the distro', async () => {
	const r = runner({ '-d Debian -e printenv HOME': { code: 0, stdout: '/home/ds\r\n', stderr: '' } });
	assert.strictEqual(await distroHome(r, 'Debian'), '/home/ds');
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `cd vscode/extensions/picket-remote-wsl && node --test test/distro.test.js`
Expected: FAIL — `Cannot find module '../src/distro.js'`.

- [x] **Step 3: Implement `distro.js`**

`exec` collects stdout/stderr as raw `Buffer`s (no `setEncoding`), resolves on `close` with the exit code, rejects on spawn `error` and on timeout (kill the child, reject with `Timed out after <ms> ms: wsl.exe <args>`). Args are always `['-d', distro, '-e', ...]` — no shell, no string building. `parseDistroTable` skips the header, then matches `/^(\*|\s)\s*(.+?)\s+(\w+)\s+(\d)\s*$/` per line and uses `\1 === '*'` for `isDefault`; a line that does not match is dropped and logged, never treated as a distro. `listDistros` calls `['--list', '--verbose']` and pipes the buffer through `decodeWslOutput`. `isWsl1` reads `version === '1'` from the same table. `distroStatus` maps `code === 0` to `'ok'`, anything else to `'missing'`.

`test/fixtures/fake-wsl.js`: a Node script invoked as `node fake-wsl.js <args...>` that prints the canned UTF-16LE verbose table for `--list --verbose`, the `--status` failure text, `printenv HOME`, and exits 1 for unknown distros. It exists so Task 4's L2 tests can exercise the real spawn path on Linux.

- [x] **Step 4: Run the test to verify it passes**

Run: `cd vscode/extensions/picket-remote-wsl && node --test test/distro.test.js`
Expected: PASS, 7 tests.

- [x] **Step 5: Commit, re-export the patch, run the gate**

```bash
cd vscode && git add extensions/picket-remote-wsl && git commit -m "feat(wsl): wsl.exe runner with UTF-16LE-safe decoding and distro discovery"
git diff wsl-baseline -- extensions/picket-remote-wsl > ../build/patches/67-picket-remote-wsl.patch
cd .. && git apply -R --check build/patches/67-picket-remote-wsl.patch --directory=vscode
git add build/patches/67-picket-remote-wsl.patch && git commit -m "chore(wsl): refresh patch 67"
```

---

### Task 3: Payload sources, checksums, atomic install into the distro ✅

**Files:**
- Create: `vscode/extensions/picket-remote-wsl/src/payload.js`
- Test: `vscode/extensions/picket-remote-wsl/test/payload.test.js`

**Interfaces:**
- Consumes: `ICatalogComponent` from Task 1; `IWslRunner` from Task 2.
- Produces: `parseSha256Sums(text: string): Map<string, string>` — `SHA256SUMS` lines are `<hex>  <name>` or `<hex> *<name>`; lines it cannot parse are skipped.
- Produces: `chooseSource(component, options: { explicitPath?: string, embeddedDir?: string, baseUrl?: string, exists(p: string): Promise<boolean> }): Promise<ISource>` where `ISource = { kind: 'file', path: string } | { kind: 'embedded', path: string } | { kind: 'url', url: string }`, throwing `Error('No source for <id>: explicit path missing, no embedded payload, and no base URL configured')` when none applies.
- Produces: `sha256OfFile(path): Promise<string>`.
- Produces: `installPayload({ runner, distro, component, source, payloadRoot, fetchImpl, onProgress }): Promise<{ payloadDir: string, source: ISource }>` — `payloadRoot` is the in-distro base (`<home>/.picket-code-server/payloads`); the result id is `payloadRoot + '/server-' + component.version`.
- Produces: `unpackOfflineBundle(zipPath, targetDir): Promise<string>` — extracts the single `.tar.gz` inside the offline bundle and returns its path.

- [x] **Step 1: Write the failing test**

`test/payload.test.js` — cases: `SHA256SUMS` parsing handles both `  ` and ` *` separators and skips junk; source precedence picks explicit over embedded over URL; all-missing throws the exact message; a SHA mismatch aborts and leaves no `server-<version>` directory; a successful install issues `mkdir -p` then `tar -xzf -` and no leftover `.tmp-*`.

```js
const test = require('node:test');
const assert = require('node:assert');
const { createHash } = require('node:crypto');
const { mkdtempSync, writeFileSync, readdirSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { parseSha256Sums, chooseSource, installPayload } = require('../src/payload.js');

const COMPONENT = { id: 'wsl-server', kind: 'server', version: 'v1.143.1-picket.1-rc.4',
	file: 'picket-code-server-v1.143.1-picket.1-rc.4-linux-x64.tar.gz', size: 3, sha256: '', embedded: false };

test('parses SHA256SUMS with both separators', () => {
	const sums = parseSha256Sums(`${'a'.repeat(64)}  a.tar.gz\n${'b'.repeat(64)} *b.tar.gz\nnot a line\n`);
	assert.strictEqual(sums.get('a.tar.gz'), 'a'.repeat(64));
	assert.strictEqual(sums.get('b.tar.gz'), 'b'.repeat(64));
	assert.strictEqual(sums.size, 2);
});

test('source precedence is explicit, embedded, url', async () => {
	const exists = async () => true;
	assert.deepStrictEqual(await chooseSource(COMPONENT, { explicitPath: 'C:\\p.tar.gz', embeddedDir: 'E', baseUrl: 'https://x/', exists }), { kind: 'file', path: 'C:\\p.tar.gz' });
	assert.deepStrictEqual(await chooseSource(COMPONENT, { embeddedDir: 'E', baseUrl: 'https://x/', exists }), { kind: 'embedded', path: join('E', COMPONENT.file) });
	assert.deepStrictEqual(await chooseSource(COMPONENT, { baseUrl: 'https://x/', exists }), { kind: 'url', url: `https://x/${COMPONENT.file}` });
});

test('no source at all throws with every reason', async () => {
	await assert.rejects(() => chooseSource(COMPONENT, { exists: async () => false }),
		/explicit path missing, no embedded payload, and no base URL configured/);
});

test('a checksum mismatch aborts and leaves no payload directory', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'picket-payload-'));
	const file = join(dir, 'bad.tar.gz');
	writeFileSync(file, 'nope');
	const calls = [];
	const runner = { exec: async (args) => { calls.push(args.join(' ')); return { code: 0, stdout: '', stderr: '' }; } };
	await assert.rejects(() => installPayload({ runner, distro: 'D', component: { ...COMPONENT, sha256: 'c'.repeat(64) },
		source: { kind: 'file', path: file }, payloadRoot: '/home/u/.picket-code-server/payloads', onProgress: () => { } }), /checksum mismatch/i);
	assert.deepStrictEqual(calls, []);
});

test('a successful install extracts via stdin and leaves no temp directory', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'picket-payload-'));
	const file = join(dir, 'ok.tar.gz');
	writeFileSync(file, 'abc');
	const sha = createHash('sha256').update('abc').digest('hex');
	const calls = [];
	const runner = { exec: async (args, opts) => { calls.push({ args, hasInput: !!(opts && opts.input) }); return { code: 0, stdout: '', stderr: '' }; } };
	const result = await installPayload({ runner, distro: 'D', component: { ...COMPONENT, sha256: sha },
		source: { kind: 'file', path: file }, payloadRoot: '/home/u/.picket-code-server/payloads', onProgress: () => { } });
	assert.strictEqual(result.payloadDir, '/home/u/.picket-code-server/payloads/server-v1.143.1-picket.1-rc.4');
	assert.strictEqual(calls.length, 2);
	assert.match(calls[0].args.join(' '), /mkdir -p/);
	assert.ok(calls[1].hasInput, 'tar receives the archive on stdin');
	assert.deepStrictEqual(readdirSync(dir), ['ok.tar.gz']);
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `cd vscode/extensions/picket-remote-wsl && node --test test/payload.test.js`
Expected: FAIL — `Cannot find module '../src/payload.js'`.

- [x] **Step 3: Implement `payload.js`**

Verification happens on the Windows side before any in-distro command runs: hash the file (or the downloaded buffer) and compare case-insensitively to `component.sha256`; mismatch throws `Checksum mismatch for <file>: expected <a>, got <b>`. Installation is two `runner.exec` calls: `['-d', distro, '-e', 'sh', '-c', 'mkdir -p "$1" && rm -rf "$2"', 'sh', payloadRoot, tmpDir]` then `['-d', distro, '-e', 'sh', '-c', 'tar -xzf - -C "$1" && mv "$1" "$2"', 'sh', tmpDir, finalDir]` with `input` = the archive bytes. `tmpDir` is `<payloadRoot>/.tmp-<8 hex>`. The constant script text is fixed; every variable value arrives as a positional parameter. URL sources stream through `fetchImpl` (default `globalThis.fetch`) into memory when `size <= 32 MB`, otherwise to a temp file via `Readable.toWeb` piping, reporting `onProgress({ downloaded, total })` at most every 100 ms.

- [x] **Step 4: Run the test to verify it passes**

Run: `cd vscode/extensions/picket-remote-wsl && node --test test/payload.test.js`
Expected: PASS, 5 tests.

- [x] **Step 5: Commit and re-export the patch**

```bash
cd vscode && git add extensions/picket-remote-wsl && git commit -m "feat(wsl): checksum-verified atomic payload install into the distro"
git diff wsl-baseline -- extensions/picket-remote-wsl > ../build/patches/67-picket-remote-wsl.patch
cd .. && git apply -R --check build/patches/67-picket-remote-wsl.patch --directory=vscode
git add build/patches/67-picket-remote-wsl.patch && git commit -m "chore(wsl): refresh patch 67"
```

---

### Task 4: Component manager (state machine, uninstall, cleanup) ✅

**Files:**
- Create: `vscode/extensions/picket-remote-wsl/src/components.js`
- Test: `vscode/extensions/picket-remote-wsl/test/components.test.js`

**Interfaces:**
- Consumes: `loadCatalog` (Task 1), `IWslRunner` (Task 2), `chooseSource`/`installPayload` (Task 3).
- Produces: `createComponentManager({ catalog, runner, distro, home, statePath, env, fetchImpl, onProgress }): IComponentManager` — `catalog` is the value from `loadCatalog`, `statePath` is the Windows-side cache file:
  - `inspect(id): Promise<{ state: 'absent' | 'installed' | 'outdated' | 'broken', version?: string, payloadDir?: string, source?: ISource }>` — `installed` when `payloads/server-<version>/.picket-payload.json` exists and its `sha256` equals the catalog's; `outdated` when another `server-*` directory exists but not the catalog version; `broken` when the marker exists but its `sha256` differs; `absent` otherwise.
  - `ensure(id): Promise<{ payloadDir: string, source: ISource }>` — installs when not `installed`, reports progress through the `onProgress` passed at construction, resolves with the existing directory when already installed.
  - `uninstall(id): Promise<void>`, `cleanup(keep: number): Promise<string[]>`, `list(): Promise<Array<{ id: string, state: string, version?: string, payloadDir?: string }>>`.
- Produces: `markerPath(payloadDir: string): string` = `<payloadDir>/.picket-payload.json`, and its JSON shape `{ sha256: string, source: string, installedAt: string }`.

- [x] **Step 1: Write the failing test**

`test/components.test.js` — with a fake runner whose `exec` answers `cat`, `mkdir`, `rm -rf`, `ls`:

- no payload directory → `absent`
- marker with the catalog sha → `installed`
- marker with a different sha → `broken`
- only a different version present → `outdated`
- `ensure` on `installed` issues no `tar` command
- `cleanup(1)` keeps the catalog version and removes the rest
- a corrupt `components.json` cache never changes the verdict (the disk is the source of truth)

```js
const test = require('node:test');
const assert = require('node:assert');
const { createComponentManager } = require('../src/components.js');

const HOME = '/home/u';
const PAYLOADS = `${HOME}/.picket-code-server/payloads`;
const V = 'v1.143.1-picket.1-rc.4';

function managerWith(disk, opts = {}) {
	const calls = [];
	const runner = { exec: async (args) => {
		calls.push(args.join(' '));
		const script = args.slice(args.indexOf('-e') + 1).join(' ');
		return disk(script) || { code: 0, stdout: '', stderr: '' };
	}, spawn: () => { throw new Error('not used'); } };
	const catalog = { tag: V, flavor: 'ondemand', components: [{ id: 'wsl-server', kind: 'server', version: V,
		file: `picket-code-server-${V}-linux-x64.tar.gz`, size: 3, sha256: 'd'.repeat(64), embedded: false }] };
	return { manager: createComponentManager({ catalog, runner, distro: 'D', home: HOME, statePath: '/tmp/state.json', ...opts }), calls };
}

test('absent when nothing is installed', async () => {
	const { manager } = managerWith(() => ({ code: 0, stdout: '' }));
	assert.strictEqual((await manager.inspect('wsl-server')).state, 'absent');
});

test('installed when the marker matches the catalog', async () => {
	const { manager } = managerWith((s) => s.includes('cat')
		? { code: 0, stdout: JSON.stringify({ sha256: 'd'.repeat(64), source: 'file', installedAt: 'now' }) }
		: { code: 0, stdout: `${PAYLOADS}/server-${V}\n` });
	assert.strictEqual((await manager.inspect('wsl-server')).state, 'installed');
});

test('broken when the marker sha differs', async () => {
	const { manager } = managerWith((s) => s.includes('cat')
		? { code: 0, stdout: JSON.stringify({ sha256: 'e'.repeat(64), source: 'file', installedAt: 'now' }) }
		: { code: 0, stdout: `${PAYLOADS}/server-${V}\n` });
	assert.strictEqual((await manager.inspect('wsl-server')).state, 'broken');
});

test('outdated when only another version is present', async () => {
	const { manager } = managerWith((s) => s.includes('readlink') || s.includes('ls')
		? { code: 0, stdout: `${PAYLOADS}/server-v1.143.1-picket.1-rc.3\n` }
		: { code: 0, stdout: '' });
	assert.strictEqual((await manager.inspect('wsl-server')).state, 'outdated');
});

test('ensure on an installed component issues no tar', async () => {
	const { manager, calls } = managerWith((s) => s.includes('cat')
		? { code: 0, stdout: JSON.stringify({ sha256: 'd'.repeat(64), source: 'file', installedAt: 'now' }) }
		: { code: 0, stdout: `${PAYLOADS}/server-${V}\n` });
	await manager.ensure('wsl-server');
	assert.ok(!calls.some(c => c.includes('tar')), calls.join('\n'));
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `cd vscode/extensions/picket-remote-wsl && node --test test/components.test.js`
Expected: FAIL — `Cannot find module '../src/components.js'`.

- [x] **Step 3: Implement `components.js`**

`inspect` always lists `payloads/` in the distro first (`sh -c 'ls -1 "$1"'`), then reads the marker for the catalog version. The `statePath` cache is written after every mutation but read only to seed `version` display; a JSON error in it is swallowed. `ensure` runs `installPayload` and then writes the marker with a single `sh -c 'printf %s "$1" > "$2"'` call. `cleanup(keep)` removes `server-*` directories other than the catalog version, newest first, keeping `keep` newer ones.

- [x] **Step 4: Run the test to verify it passes**

Run: `cd vscode/extensions/picket-remote-wsl && node --test test/components.test.js`
Expected: PASS, 5 tests.

- [x] **Step 5: Commit and re-export the patch**

```bash
cd vscode && git add extensions/picket-remote-wsl && git commit -m "feat(wsl): component manager with disk-derived state and old-version cleanup"
git diff wsl-baseline -- extensions/picket-remote-wsl > ../build/patches/67-picket-remote-wsl.patch
cd .. && git apply -R --check build/patches/67-picket-remote-wsl.patch --directory=vscode
git add build/patches/67-picket-remote-wsl.patch && git commit -m "chore(wsl): refresh patch 67"
```

---

### Task 5: Launch, port parsing, watchdog, runtime file, stop ✅

**Files:**
- Create: `vscode/extensions/picket-remote-wsl/src/launch.js`
- Create: `vscode/extensions/picket-remote-wsl/src/probe.js`
- Test: `vscode/extensions/picket-remote-wsl/test/launch.test.js`
- Test: `vscode/extensions/picket-remote-wsl/test/probe.test.js`

**Interfaces:**
- Consumes: `IWslRunner` (Task 2).
- Produces: `serverPaths(home: string, tag: string)` → `{ payloadDir, binary, dataDir, extensionsDir, runtimeDir, logDir, envSetupFile }` (all POSIX strings; `binary` ends with `/bin/picket-code-server`; `runtimeDir` is `<home>/.picket-code-server/runtime` and `runtimeFileFor(home, distro)` is `<runtimeDir>/<distro>.json`, the spec §4.2 form — it survives two distros that mount the same home directory; `envSetupFile` is `<home>/.picket-code-server/server-env-setup`; `remoteCli` is `<payloadDir>/bin/remote-cli/picket-code`; `cliLink` is `<home>/.local/bin/picket-code`).
- Produces: `LAUNCH_SCRIPT = 'setup="$1"; icode="$2"; shift 2; [ -f "$setup" ] && . "$setup"; [ -n "$icode" ] && export PICKET_ICODE_BIN="$icode"; exec "$0" "$@"'` and `buildServerArgs({ paths, connectionToken, icodeBin, distro }): string[]` → `['-d', distro, '-e', 'sh', '-lc', LAUNCH_SCRIPT, paths.binary, paths.envSetupFile, icodeBin ?? '', ...flags]` with the flags from Global Constraints in that order. The script is a constant; every value is an argv entry, so paths and flags with spaces, quotes or non-ASCII never reach a shell parser.
- Produces: `createPortParser(): { feed(text: string): void, port: number | undefined }` — first match of `Extension host agent listening on (\d+)`.
- Produces: `newConnectionToken(): string`.
- Produces: `lockAndRead(runner, distro, runtimeFile): Promise<IRuntimeInfo | undefined>` and `writeRuntime(runner, runtimeFile, info: IRuntimeInfo)`, `clearRuntime(runner, runtimeFile)`, `IRuntimeInfo = { port: number, token: string, tag: string, pid: number, startedAt: string, tunnelMode?: string, icode?: string }`.
- Produces: `startServer({ runner, distro, args, runtimeFile, timeoutMs, extra, log }): Promise<IRuntimeInfo>` — `extra` is merged into the record written to disk, which is how Task 7 stores `tunnelMode` and the iCode source for diagnostics. and `stopServer({ runner, distro, runtimeFile, info, log }): Promise<void>`.
- Produces (probe.js): `probeServer({ host, port, token, timeoutMs = 2000, fetchImpl = globalThis.fetch }): Promise<'alive' | 'bad-token' | 'dead'>`.

- [x] **Step 1: Write the failing tests**

`test/launch.test.js` — cases: `serverPaths` composes the documented layout; `buildServerArgs` emits the exact flag list and puts `PICKET_ICODE_BIN` before the binary via `env`; the port parser ignores a banner line printed before the listening line and ignores output after it; a server that prints nothing fails with `Start timed out after 90 s` and includes the last output line; exit code 99 fails with a distro-incompatibility message; two concurrent `lockAndRead` callers on a distro whose lock exists give the second one `undefined` (no spawn).

```js
const test = require('node:test');
const assert = require('node:assert');
const { serverPaths, buildServerArgs, createPortParser, lockAndRead } = require('../src/launch.js');

test('serverPaths composes the documented layout', () => {
	const p = serverPaths('/home/u', 'v1.143.1-picket.1-rc.4');
	assert.strictEqual(p.binary, '/home/u/.picket-code-server/payloads/server-v1.143.1-picket.1-rc.4/bin/picket-code-server');
	assert.strictEqual(p.dataDir, '/home/u/.picket-code-server/data');
	assert.strictEqual(p.extensionsDir, '/home/u/.picket-code-server/extensions');
	assert.strictEqual(p.runtimeDir, '/home/u/.picket-code-server/runtime');
	assert.strictEqual(runtimeFileFor('/home/u', 'Ubuntu 22.04 LTS'), '/home/u/.picket-code-server/runtime/Ubuntu 22.04 LTS.json');
});

test('buildServerArgs launches through a login shell with argv-passed values', () => {
	const p = serverPaths('/home/u', 'T');
	const args = buildServerArgs({ paths: p, connectionToken: 'a-b-c-d', icodeBin: '/usr/local/bin/icode', distro: 'Ubuntu' });
	assert.deepStrictEqual(args.slice(0, 9), ['-d', 'Ubuntu', '-e', 'sh', '-lc', LAUNCH_SCRIPT, p.binary, p.envSetupFile, '/usr/local/bin/icode']);
	assert.ok(!args.includes('env'));   // PICKET_ICODE_BIN travels inside the launch script, not a second binary
	assert.ok(args.includes('--without-browser-env-var'));
	assert.ok(args.includes('--port=0'));
	assert.ok(args.includes(`--user-data-dir=${p.dataDir}`));
	assert.ok(args.includes('--connection-token=a-b-c-d'));
});

test('a space and a quote inside the icode path stay one argv entry', () => {
	const p = serverPaths('/home/u', 'T');
	const args = buildServerArgs({ paths: p, connectionToken: 'x', icodeBin: "/home/u/my tools/it's icode", distro: 'Ubuntu 22.04 LTS' });
	assert.strictEqual(args[1], 'Ubuntu 22.04 LTS');
	assert.strictEqual(args[8], "/home/u/my tools/it's icode");
});

test('the port parser ignores banners and trailing noise', () => {
	const parser = createPortParser();
	parser.feed('Your Windows build is out of date.\n');
	parser.feed('Extension host agent listening on 41234\n');
	parser.feed('another line\n');
	assert.strictEqual(parser.port, 41234);
});

test('a lock that already exists keeps the second caller from spawning', async () => {
	const calls = [];
	const runner = { exec: async (args) => { calls.push(args.join(' ')); return { code: 0, stdout: '1', stderr: '' }; }, spawn: () => { throw new Error('not used'); } };
	assert.strictEqual(await lockAndRead(runner, 'Ubuntu', '/home/u/.picket-code-server/runtime/Ubuntu.json'), undefined);
	assert.ok(!calls.some(c => c.includes('cat')));
});
```

`test/probe.test.js` — cases: HTTP 400 → `'alive'`; 403 → `'bad-token'`; `ECONNREFUSED` → `'dead'`; a fetch that never settles within 2 s → `'dead'`.

- [x] **Step 2: Run the tests to verify they fail**

Run: `cd vscode/extensions/picket-remote-wsl && node --test test/launch.test.js test/probe.test.js`
Expected: FAIL — modules not found.

- [x] **Step 3: Implement `launch.js` and `probe.js`**

`startServer` spawns through `runner.spawn(args)`, wires `stdout`/`stderr` text through `createPortParser` plus a rolling 40-line buffer, resets the watchdog on every chunk, and resolves on the first parsed port with a new `IRuntimeInfo`. Because the launch goes through a login shell, profile banners are expected: any line that is not the listening line is logged, never parsed. If `paths.envSetupFile` exists it was already sourced by the launch script, so nothing here re-reads it. Failure paths: timeout (`Start timed out after <ms> ms`, appending the last 40 lines), exit 99 (message mentions WSL1/unsupported distro), any other non-zero exit. `lockAndRead` asks the lock first and reads the runtime file only when the lock is absent — two round trips, because a single script would have to read a record that a first window is about to replace. `writeRuntime` writes to `<runtimeFile>.tmp` then `mv`s; `clearRuntime` removes the lock and the runtime file. `stopServer` runs `runner.exec(['-d', distro, '-e', 'kill', '-TERM', String(info.pid)])`, waits 5 s, probes once (`probeServer`), then `runner.exec(['-d', distro, '-e', 'sh', '-c', 'kill -9 "$1"', 'sh', String(info.pid)])`, then `sh -c 'pkill -f "picket-code-server.*--user-data-dir=$1"'` for stragglers (the distro name never appears in the process command line, so keying on it sweeps nothing), then clears the runtime file — each step logged, and a failure in one step does not abort the next.

- [x] **Step 4: Run the tests to verify they pass**

Run: `cd vscode/extensions/picket-remote-wsl && node --test test/launch.test.js test/probe.test.js`
Expected: PASS — every case in `launch.test.js` and `probe.test.js`.

- [x] **Step 5: Commit and re-export the patch**

```bash
cd vscode && git add extensions/picket-remote-wsl && git commit -m "feat(wsl): server launch through the distro login shell, port parsing, watchdog, runtime file and stop"
git diff wsl-baseline -- extensions/picket-remote-wsl > ../build/patches/67-picket-remote-wsl.patch
cd .. && git apply -R --check build/patches/67-picket-remote-wsl.patch --directory=vscode
git add build/patches/67-picket-remote-wsl.patch && git commit -m "chore(wsl): refresh patch 67"
```

---

### Task 6: Resolver, remote URIs, activation ✅

**Files:**
- Create: `vscode/extensions/picket-remote-wsl/src/resolver.js`
- Create: `vscode/extensions/picket-remote-wsl/src/remoteUri.js`
- Modify: `vscode/extensions/picket-remote-wsl/extension.js`
- Test: `vscode/extensions/picket-remote-wsl/test/resolver.test.js`
- Test: `vscode/extensions/picket-remote-wsl/test/remoteUri.test.js`

**Interfaces:**
- Consumes: `createComponentManager` (Task 4), `startServer`/`stopServer`/`lockAndRead`/`writeRuntime`/`probeServer` (Task 5), `listDistros`/`defaultDistro`/`distroHome`/`distroStatus` (Task 2).
- Produces: `createResolver({ runner, components, settings, log, tunnelFactory }): IResolver` with `resolve(remoteAuthority: string): Promise<ResolverResultLike>` where `ResolverResultLike = { host: string, port: number, connectionToken: string }`, plus `stop(distro): Promise<void>` and `dispose(): void`.
- Produces: `parseAuthority(authority: string): string` — strips the leading `picket-wsl+` and returns the distro, or `''`.
- Produces (remoteUri.js): `remoteUriFor(distro: string, posixPath: string): { scheme: 'vscode-remote', authority: string, path: string }`, `parseUncPath(path: string): { distro: string, posixPath: string } | undefined` for `\\wsl.localhost\<distro>\<posix>` and `\\wsl$\<distro>\<posix>`, plus `toPosixPath(runner, distro, windowsPath): Promise<string>` (`wslpath -u`) and `toWindowsPath(runner, distro, posixPath): Promise<string>` (`wslpath -w`). Both trim the output, reject with `wslpath failed: <stderr>` on a non-zero exit, and are the only place a Windows path is turned into a Linux one.

- [x] **Step 1: Write the failing tests**

`test/resolver.test.js` — cases: an empty distro resolves to the default one; a live runtime file whose `tag` matches the catalog is reused without spawning; a runtime file for a different tag triggers a new start; a dead probe (refused) triggers a restart and clears the stale runtime file; a missing distro rejects with `Distro "X" not found`; a payload that is absent and unreachable rejects with a message containing `No source for wsl-server`.

`test/remoteUri.test.js` — cases: `remoteUriFor('Ubuntu-24.04', '/home/u/proj')` → authority `picket-wsl+Ubuntu-24.04`, path `/home/u/proj`; `parseAuthority('picket-wsl+Ubuntu 22.04 LTS')` → `'Ubuntu 22.04 LTS'`; UNC paths in both `wsl.localhost` and `wsl$` forms parse; a Windows path returns undefined; `toPosixPath` turns `C:\\Users\\u\\我的 项目` into `/mnt/c/Users/u/我的 项目` and `toWindowsPath` reverses it; a `wslpath` non-zero exit rejects with the stderr text.

```js
test('an empty distro resolves to the default distro', async () => {
	assert.strictEqual(parseAuthority('picket-wsl+'), '');
	assert.strictEqual(parseAuthority('picket-wsl+Ubuntu'), 'Ubuntu');
});

test('UNC paths parse for both prefixes', () => {
	assert.deepStrictEqual(parseUncPath('\\\\wsl.localhost\\Ubuntu\\home\\u'), { distro: 'Ubuntu', posixPath: '/home/u' });
	assert.deepStrictEqual(parseUncPath('\\\\wsl$\\Debian\\srv\\app'), { distro: 'Debian', posixPath: '/srv/app' });
	assert.strictEqual(parseUncPath('C:\\Users\\u'), undefined);
});

test('wslpath converts in both directions', async () => {
	const r = { exec: async (args) => ({ code: 0, stdout: args[3] === '-u' ? '/mnt/c/Users/u/我的 项目\r\n' : 'C:\\Users\\u\\我的 项目\r\n', stderr: '' }) };
	assert.strictEqual(await toPosixPath(r, 'Ubuntu', 'C:\\Users\\u\\我的 项目'), '/mnt/c/Users/u/我的 项目');
	assert.strictEqual(await toWindowsPath(r, 'Ubuntu', '/mnt/c/Users/u/我的 项目'), 'C:\\Users\\u\\我的 项目');
});
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `cd vscode/extensions/picket-remote-wsl && node --test test/resolver.test.js test/remoteUri.test.js`
Expected: FAIL — modules not found.

- [x] **Step 3: Implement `resolver.js`, `remoteUri.js`, and wire `extension.js`**

`resolve` order: parse authority → `listDistros` (reject `Distro "<x>" not found` listing `visibleDistros(list).map(d => d.name)`) → `distroHome` → `lockAndRead` → if a runtime exists and `probeServer` is `'alive'` and `tag` matches, return `{ host: '127.0.0.1', port, connectionToken: token }` → otherwise `components.ensure('wsl-server')`, `startServer`, `writeRuntime`, and return the fresh coordinates. Concurrent resolves for the same distro share one in-flight promise. `extension.js` registers `vscode.workspace.registerRemoteAuthorityResolver('picket-wsl', { resolve: (authority) => resolver.resolve(authority).then(result => new (require('vscode').ResolvedAuthority)(result.host, result.port, result.connectionToken)) })` and disposes it on deactivate together with `resolver.dispose()`.

- [x] **Step 4: Run the tests to verify they pass**

Run: `cd vscode/extensions/picket-remote-wsl && node --test test/resolver.test.js test/remoteUri.test.js`
Expected: PASS, 8 tests. Then `cd vscode && npm run transpile-client` still succeeds.

- [x] **Step 5: Manual smoke on Windows, then commit and re-export**

On a Windows machine with the dev build: `Picket: Open Folder in WSL…` is not wired yet, so verify instead that `Developer: Reload Window` shows `Picket WSL activated (tag=…)` in the output channel and that no activation error appears. Commit:

```bash
cd vscode && git add extensions/picket-remote-wsl && git commit -m "feat(wsl): picket-wsl authority resolver with runtime-file reuse"
git diff wsl-baseline -- extensions/picket-remote-wsl > ../build/patches/67-picket-remote-wsl.patch
cd .. && git apply -R --check build/patches/67-picket-remote-wsl.patch --directory=vscode
git add build/patches/67-picket-remote-wsl.patch && git commit -m "chore(wsl): refresh patch 67"
```

Milestone M1 gate: opening `picket-wsl+<distro>` by hand (`Ctrl+Shift+P` → `Remote Authority` is not available; use Task 7's command once it exists) is deferred to Task 7. Record in the ledger that M1 ends here with L1/L2 green.

---

### Task 7: iCode detection and tunnel-mode preflight ✅

**Files:**
- Create: `vscode/extensions/picket-remote-wsl/src/icode.js`
- Create: `vscode/extensions/picket-remote-wsl/src/preflight.js`
- Modify: `vscode/extensions/picket-remote-wsl/src/resolver.js` (pass `icodeBin` into `startServer`)
- Test: `vscode/extensions/picket-remote-wsl/test/icode.test.js`
- Test: `vscode/extensions/picket-remote-wsl/test/preflight.test.js`

**Interfaces:**
- Consumes: `IWslRunner` (Task 2).
- Produces: `detectIcode({ runner, distro, configuredPath }): Promise<{ path: string | null, source: 'setting' | 'path' | 'missing' }>` — a configured path wins when `test -x` succeeds; otherwise `sh -lc 'command -v icode'` is used — the same login shell the server starts in, because only that shell proves `~/.local/bin` is on the `PATH` the server will see; empty stdout means `missing`.
- Produces: `parseWslConfig(text: string): { localhostForwarding?: boolean, networkingMode?: string }` — reads only `[wsl2]`; keys are case-insensitive; `localhostForwarding=false` is boolean false; unknown sections ignored.
- Produces: `chooseTunnelMode({ configured, wslConfig, platform }): 'direct' | 'stdio'` — `configured !== 'auto'` wins; non-win32 is `'direct'`; `localhostForwarding === false` or `networkingMode === 'mirrored'` is `'stdio'`; otherwise `'direct'`.

- [x] **Step 1: Write the failing tests**

`test/icode.test.js` — cases: configured path that passes `test -x` wins with source `'setting'`; configured path that fails falls through to `command -v`, which returns `/home/u/.local/bin/icode` with source `'path'`; both empty gives `{ path: null, source: 'missing' }`; a distro whose `command -v` exits 1 also gives `'missing'`.

`test/preflight.test.js` — cases: `[wsl2]\nlocalhostForwarding=false\n` → `{ localhostForwarding: false }`; `networkingMode=mirrored` under `[wsl2]` → `'stdio'`; a `[experimental]` section's keys are ignored; `auto` on non-Windows → `'direct'`; explicit `'direct'` beats a mirrored config.

```js
test('a disabled localhost forwarding selects the tunnel', () => {
	assert.strictEqual(chooseTunnelMode({ configured: 'auto', wslConfig: parseWslConfig('[wsl2]\nlocalhostForwarding=false\n'), platform: 'win32' }), 'stdio');
});

test('a mirrored network selects the tunnel', () => {
	assert.strictEqual(chooseTunnelMode({ configured: 'auto', wslConfig: parseWslConfig('[wsl2]\nnetworkingMode=mirrored\n'), platform: 'win32' }), 'stdio');
});

test('an explicit mode wins over the config', () => {
	assert.strictEqual(chooseTunnelMode({ configured: 'direct', wslConfig: parseWslConfig('[wsl2]\nlocalhostForwarding=false\n'), platform: 'win32' }), 'direct');
});
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `cd vscode/extensions/picket-remote-wsl && node --test test/icode.test.js test/preflight.test.js`
Expected: FAIL — modules not found.

- [x] **Step 3: Implement both modules and thread `icodeBin` through the resolver**

The resolver computes `icode = await detectIcode(...)` before `startServer` and passes `icode.path` as `icodeBin`; a `missing` result updates a `vscode.window` message shown once per session (`WSL 里未找到 iCode：AI 功能不可用。设置 Picket: WSL › ICode Path 可指定路径。`). The resolver also stores `chooseTunnelMode(...)` output in the runtime file for diagnostics; Task 11 consumes it.

- [x] **Step 4: Run the tests to verify they pass**

Run: `cd vscode/extensions/picket-remote-wsl && node --test "test/*.test.js"`
Expected: PASS — every suite under `test/` green.

- [x] **Step 5: Commit and re-export the patch**

```bash
cd vscode && git add extensions/picket-remote-wsl && git commit -m "feat(wsl): iCode detection and tunnel-mode preflight"
git diff wsl-baseline -- extensions/picket-remote-wsl > ../build/patches/67-picket-remote-wsl.patch
cd .. && git apply -R --check build/patches/67-picket-remote-wsl.patch --directory=vscode
git add build/patches/67-picket-remote-wsl.patch && git commit -m "chore(wsl): refresh patch 67"
```

---

### Task 8: Commands, `WSL Targets` view, distro management, first-use interception, diagnostics, nudge ✅

**Files:**
- Create: `vscode/extensions/picket-remote-wsl/src/commands.js`
- Create: `vscode/extensions/picket-remote-wsl/src/tree.js`
- Create: `vscode/extensions/picket-remote-wsl/src/manage.js`
- Create: `vscode/extensions/picket-remote-wsl/src/diagnose.js`
- Create: `vscode/extensions/picket-remote-wsl/src/nudge.js`
- Modify: `vscode/extensions/picket-remote-wsl/extension.js`
- Modify: `vscode/extensions/picket-remote-wsl/package.json` (views, viewsWelcome, view/item/context menus, the three distro commands)
- Test: `vscode/extensions/picket-remote-wsl/test/commands.test.js`
- Test: `vscode/extensions/picket-remote-wsl/test/tree.test.js`
- Test: `vscode/extensions/picket-remote-wsl/test/manage.test.js`
- Test: `vscode/extensions/picket-remote-wsl/test/diagnose.test.js`

**Interfaces:**
- Consumes: everything from Tasks 2–7, plus `vscode.window`/`vscode.commands` passed in as a `host` object so tests need no VS Code runtime: `host = { showQuickPick(items, options), showOpenDialog(options), showInformationMessage(msg, ...actions), showWarningMessage(msg, ...actions), showErrorMessage(msg, ...actions), withProgress({ title }, task), openFolder(uri, options), runInTerminal(command), refreshTargets(), showDocument(text), uriFor(parts) }`. `extension.js` supplies this object; nothing under `src/` requires `vscode`.
- Produces: `registerCommands({ host, runner, settings, catalog, createComponents, resolver, memento, log, appRoot, currentFolders, currentAuthority, register }): Disposable[]` registering the ten commands of this milestone from a module-level `COMMANDS` table (the two CLI-shim commands, Task 13, and the two gallery commands, Task 10, stay stubs in `extension.js`). `register` is `vscode.commands.registerCommand`.
- Produces (tree.js): `buildDistroNodes(list: IDistro[], ctx: { activeDistro?: string }): IDistroNode[]` where `IDistroNode = { id, distro, label, description, contextValue: 'activeDistro' | 'inactiveDistro', tooltip }` — `label` is `<name>（WSL 1|2）`, `description` carries `default distro` and `Connected`/`Not Connected`, the default distro sorts first.
- Produces (manage.js): `manageDistro({ host, runner, action, distro }): Promise<void>` for `action: 'add' | 'setDefault' | 'delete'`; `add` parses `wsl.exe --list --online` and hands the chosen name to a terminal command, `setDefault` runs `-e`-free `['--set-default', distro]`, `delete` requires a modal confirmation and then runs `['--unregister', distro]`. `parseOnlineTable(stdout)` is exported for the parser test.
- Produces: `ensureComponentInteractive({ distro, home }): Promise<boolean>` — the first-use interception; returns `false` when the user cancels. It reaches the component manager through `createComponents({ distro, home, explicitPath? })`: the third field is how a file the user picked reaches the installer **without** writing `picket.wsl.serverPayloadPath`, so the resolver's factory signature gains the same optional field.
- Produces: `buildDiagnostics({ runner, components, settings, catalog, appRoot, gallery?, readWslConfig? }): Promise<string>` — a copyable multi-line report; `components` is the same factory the resolver uses, called with the primary distro.
- Produces (nudge.js): `maybeNudge({ host, memento, folders, openFolderInWsl? }): Promise<boolean>` — one warning per install, keyed by `picket.wsl.nudgedUncFolder` in global state.

- [x] **Step 1: Write the failing tests**

`test/commands.test.js` — cases:
- `openFolder` with an `embedded` catalog and an absent component installs without showing any picker (assert the host received no `showInformationMessage` with `从哪里获取`).
- `openFolder` with an `ondemand` catalog and an absent component shows the three actions and, on `从文件安装…`, calls `showOpenDialog` and installs from the chosen file.
- `openFolder` on `取消` resolves without opening a folder.
- `openFolder` on an installed component goes straight to `host.openFolder` with `{ forceNewWindow: true, remoteAuthority: 'picket-wsl+Ubuntu' }`.
- `diagnose` output contains lines for WSL version, distro list, tunnel mode, component state, iCode path, gallery mode, `node`/`git` presence, and a `picketTag` read from a fixture `product.json`.

`test/tree.test.js` — cases: two distros, one default, produce two nodes with the default first; a WSL1 distro's label carries `（WSL 1）`; the node whose name equals `activeDistro` gets `contextValue: 'activeDistro'` and a `Connected` tooltip; a `docker-desktop` row from Task 2's `visibleDistros` never reaches the tree.

`test/manage.test.js` — cases: `setDefault` sends exactly `['--set-default', 'Debian']`; `delete` without confirmation runs nothing; `delete` after an affirmative confirmation sends `['--unregister', 'Debian']`; `add` parses a `--list --online` table into a pick list and then issues the install command through the host's terminal hook.

`test/diagnose.test.js` — asserts the report's section headers, and that a failing runner call becomes `unavailable: <reason>` instead of rejecting.

```js
test('the tree puts the default distro first and marks the active one', () => {
	const nodes = buildDistroNodes([
		{ name: 'Debian', isDefault: false, version: '2', state: 'Stopped' },
		{ name: 'Ubuntu-24.04', isDefault: true, version: '2', state: 'Running' },
		{ name: 'Old', isDefault: false, version: '1', state: 'Stopped' }
	], { activeDistro: 'Debian' });
	assert.deepStrictEqual(nodes.map(n => n.label), ['Ubuntu-24.04（WSL 2）', 'Debian（WSL 2）', 'Old（WSL 1）']);
	assert.strictEqual(nodes[1].contextValue, 'activeDistro');
	assert.match(nodes[1].tooltip, /Connected/);
});

test('deleting a distro asks before unregistering', async () => {
	const host = createFakeHost({ confirm: false });
	const calls = [];
	const runner = { exec: async (a) => { calls.push(a); return { code: 0, stdout: '', stderr: '' }; } };
	await manageDistro({ host, runner, action: 'delete', distro: 'Debian' });
	assert.deepStrictEqual(calls, []);
});

// `harness({ flavor, state })` in test/commands.test.js wires the fake host, a
// fake component factory and a fake runner into `createCommands`; `openFolder`
// takes an optional distro, which is how a tree row skips the first picker.
test('the embedded flavor never shows the install picker', async () => {
	const ctx = harness({ flavor: 'embedded', state: 'absent' });
	await ctx.commands.openFolder();
	assert.ok(!ctx.host.messages.some(m => m.includes('从哪里获取')));
	assert.strictEqual(ctx.ensured.length, 1);
});

test('the ondemand flavor offers three actions', async () => {
	const ctx = harness({ flavor: 'ondemand', state: 'absent' });
	await ctx.commands.openFolder();
	assert.deepStrictEqual(ctx.host.lastActions, ['自动下载', '从文件安装…', '取消']);
});
```

`test/nudge.test.js` and `test/manifest.test.js` are added beyond the list above: the
first covers the one-time UNC nudge, the second asserts that `package.json` and the
registered command table agree in both directions (a contributed command nobody
registers is a dead menu entry) and that no module under `src/` imports `vscode`.

- [x] **Step 2: Run the tests to verify they fail**

Run: `cd vscode/extensions/picket-remote-wsl && node --test test/commands.test.js test/tree.test.js test/manage.test.js test/diagnose.test.js`
Expected: FAIL — modules not found.

- [x] **Step 3: Implement the three modules and register them in `extension.js`**

`extension.js` creates the view once (`vscode.window.createTreeView('picketWsl.targets', { treeDataProvider })`), refreshes it on activation and after every manage action, and registers `picket.wsl.refreshTargets` as the view's refresh button. `openFolder` flow: quick-pick distro (`settings.defaultDistro` first, remembered after use; rows come from `visibleDistros(await listDistros(runner))`) → `host.showOpenDialog({ canSelectFolders: true, defaultUri: Uri.parse('vscode-remote://picket-wsl+<distro>/home/<user>') })`, whose picked path goes through `toPosixPath` when it is a Windows path (a `\\wsl.localhost\` pick is already posix via `parseUncPath`) → `ensureComponentInteractive` → `host.openFolder(uri, { forceNewWindow: true, remoteAuthority: 'picket-wsl+' + distro })`. `ensureComponentInteractive` in the `embedded` flavor calls `components.ensure` inside `withProgress` with no dialog; in `ondemand` it shows the three actions and routes to `payload.chooseSource` with `{ explicitPath: settings.serverPayloadPath }`, the file picker path, or the base URL. `reopenInWsl` accepts the current window's `vscode.env.remoteAuthority` or a UNC path from `remoteUri.parseUncPath`; `reopenInWindows` reopens the same folder with an empty remote authority. `nudge.js` shows a one-time warning when `remoteUri.parseUncPath(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath)` succeeds and a global-state flag is unset. `diagnose.js` runs each probe in `try/catch` and prints `unavailable: <message>` on failure.

- [x] **Step 4: Run the tests to verify they pass**

Run: `cd vscode/extensions/picket-remote-wsl && node --test "test/*.test.js"`
Expected: PASS — every suite under `test/` green.

- [x] **Step 5: Manual smoke on Windows, then commit and re-export**

`cd vscode && npm run transpile-client`, launch the dev workbench, then: (a) open the WSL view and confirm the distro rows show WSL version, default, and connection state; (b) run `Picket: Open Folder in WSL…`, pick a distro, pick a folder through the dialog, confirm the window reopens as `picket-wsl+<distro>` with native Linux files; (c) `Picket: 设为默认发行版` on a second distro and confirm the tree reorders. Then commit as in Task 7 with message `feat(wsl): commands, WSL targets view, distro management, diagnostics and nudge`. Also record that the returned-vs-fresh `quick pick` path was exercised, since that is where `distroStatus` caching bugs show up.

---

### Task 9: A gallery that needs no account, and a disabled gallery (patch 66) ✅

**Files:**
- Modify: `vscode/src/vs/platform/extensionManagement/common/extensionGalleryManifest.ts`
- Modify: `vscode/src/vs/platform/extensionManagement/common/extensionGalleryManifestService.ts`
- Modify: `vscode/src/vs/workbench/contrib/extensions/browser/extensions.contribution.ts`
- Modify: `vscode/src/vs/workbench/services/extensionManagement/electron-browser/extensionGalleryManifestService.ts`
- Modify: `vscode/src/vs/workbench/services/extensionManagement/test/electron-browser/extensionGalleryManifestService.test.ts`
- Create: `build/patches/66-gallery-no-account.patch` (exported)

**Interfaces:**
- Produces (platform): `ExtensionGalleryDisabledServiceUrl = 'none'`, `ExtensionGalleryNoAuthProvider = 'none'`; `ExtensionGalleryConfig` is exported and its optional fields (`itemUrl`, `publisherUrl`, `resourceUrlTemplate`, `extensionUrlTemplate`, `controlUrl`, `nlsBaseUrl`) become optional, matching what `product.json` actually carries.
- Produces (platform service): `getExtensionGalleryManifest()` keeps its signature and delegates to the new `protected buildExtensionGalleryManifest(config: ExtensionGalleryConfig | undefined): IExtensionGalleryManifest | null`, so a subclass can build a manifest for a gallery the product did not ship.
- Produces (workbench service): `doGetExtensionGalleryManifest()` order — `serviceUrl === 'none'` → manifest `null`, status `Unavailable`; else `serviceUrl && authProvider === 'none'` → local manifest with `itemUrl` derived by `galleryItemUrl(serviceUrl)`; else `serviceUrl` → upstream account path; else → `super`.
- Produces (schema): `extensions.gallery.authProvider` gains the enum value `none` ("the marketplace needs no account"), default stays `github` — an unconfigured build behaves exactly like upstream.

- [x] **Step 1: Write the failing test**

Append a section to `src/vs/workbench/services/extensionManagement/test/electron-browser/extensionGalleryManifestService.test.ts`: `authProvider none` + a configured URL yields `Available` with the expected resource ids and **no** HTTP request (`requestHandler` throws if called); a non-Open-VSX-shaped URL yields no `itemName` resources; `serviceUrl 'none'` yields `null` + `Unavailable` with no request; `authProvider none` without a configured URL falls back to the build gallery.

```ts
test('authProvider none — the configured gallery is used without an account or a request', async () => {
	configurationService.setUserConfiguration(ExtensionGalleryServiceUrlConfigKey, 'https://openvsx.corp.local/vscode/gallery');
	configurationService.setUserConfiguration(ExtensionGalleryAuthProviderConfigKey, 'none');
	requestHandler = () => { throw new Error('a gallery that needs no account must not be probed'); };

	const service = createService();
	const manifest = await service.getExtensionGalleryManifest();

	assert.strictEqual(service.extensionGalleryManifestStatus, ExtensionGalleryManifestStatus.Available);
	assert.deepStrictEqual(resourceIds(manifest), [ /* extensionquery, latest, stats, item, review-details */ ]);
});
```

- [x] **Step 2: Run the test to verify it fails**

`cd vscode && npm run transpile-client && ./node_modules/.bin/mocha out/vs/workbench/services/extensionManagement/test/electron-browser/extensionGalleryManifestService.test.js --ui tdd`
Expected: the four new cases fail (`requiresSignIn`/`Available` mismatches, missing item resources). `./scripts/test.sh` is **not** used here: it wants the Electron build, while `transpile-client` output runs the suite directly under mocha in under a second.

- [x] **Step 3: Implement**

1. `extensionGalleryManifest.ts`: the two constants, with the reason each exists.
2. `common/extensionGalleryManifestService.ts`: lift the body of `getExtensionGalleryManifest()` into `protected buildExtensionGalleryManifest(gallery)`; export the config type and make its optional fields optional.
3. `extensions.contribution.ts`: `enum: ['github', 'microsoft', 'none']` plus the matching `enumDescriptions` entry and the policy `enumDescriptions` entry.
4. `workbench/.../extensionGalleryManifestService.ts`: the four-way branch above and `galleryItemUrl()` (`/^(.*)\/vscode\/gallery\/?$/` → `${1}/vscode/item`, otherwise `undefined`, so no 404 links).

- [x] **Step 4: Run the test to verify it passes**

`cd vscode && npm run transpile-client && ./node_modules/.bin/mocha out/vs/workbench/services/extensionManagement/test/electron-browser/*.test.js out/vs/platform/extensionManagement/test/common/*.test.js --ui tdd`
Expected: `50 passing` for the manifest suite (46 before + 4 new) and `173 passing` across the neighbouring extension-management suites (no regression).

Type gate: local config `vscode/src/tsconfig.gallery.json` (git-excluded, `files`-narrowing the four touched files + the test) — `cd vscode && ./node_modules/.bin/tsc -p src/tsconfig.gallery.json`. Expected: 0 errors in the touched files; the only output is 6 pre-existing `Timeout`/`TimeoutHandle` mismatches in `base/parts/ipc` and `platform/progress`, the same class of noise `src/tsconfig.icode.json` reports. Runs in 0.65 s / 325 MB, so it does not hit the OOM that the full tree does.

- [x] **Step 5: Export patch 66, register it, and commit**

```bash
cd vscode && git add src/vs/platform/extensionManagement/common/extensionGalleryManifest.ts \
  src/vs/platform/extensionManagement/common/extensionGalleryManifestService.ts \
  src/vs/workbench/contrib/extensions/browser/extensions.contribution.ts \
  src/vs/workbench/services/extensionManagement/electron-browser/extensionGalleryManifestService.ts \
  src/vs/workbench/services/extensionManagement/test/electron-browser/extensionGalleryManifestService.test.ts
git status --short                     # only those five files
git commit -m "feat(gallery): a marketplace that needs no account, and one that is off"
git diff wsl-baseline -- src/vs/platform/extensionManagement src/vs/workbench/contrib/extensions/browser/extensions.contribution.ts src/vs/workbench/services/extensionManagement > ../build/patches/66-gallery-no-account.patch
cd .. && git apply -R --check build/patches/66-gallery-no-account.patch --directory=vscode
```

Insert `66-gallery-no-account.patch` into `build/patches/apply-list.txt` **before** `67-picket-remote-wsl.patch`, and commit both in the main repo.

---

### Task 10: Gallery-source and VSIX commands ✅

**Files:**
- Create: `vscode/extensions/picket-remote-wsl/src/marketplace.js`
- Modify: `vscode/extensions/picket-remote-wsl/src/commands.js`
- Modify: `vscode/extensions/picket-remote-wsl/src/diagnose.js` (the `Gallery:` line reads a settings snapshot instead of an override file)
- Modify: `vscode/extensions/picket-remote-wsl/extension.js` (the `gallery` settings bridge, `host.executeCommand`; the two commands leave the stub list)
- Modify: `vscode/extensions/picket-remote-wsl/test/fixtures/fake-host.js` (`showInputBox`, `executeCommand`, `createFakeGalleryConfig`)
- Test: `vscode/extensions/picket-remote-wsl/test/marketplace.test.js`, `test/diagnose.test.js`, `test/manifest.test.js`

**Interfaces:**
- Produces: `describeGallery({ serviceUrl }): { mode: 'default' } | { mode: 'none' } | { mode: 'custom', serviceUrl }`.
- Produces: `applyGalleryMode({ mode, url, configuration }): Promise<string>` — throws on a non-`http(s)` URL **before** writing anything; `custom` writes `serviceUrl` (trailing slashes stripped) then `authProvider = 'none'`; `none` writes `serviceUrl = 'none'` and deletes `authProvider`; `default` deletes both (so a later build's default can take effect).
- Produces: `selectGallery({ host, configuration }): Promise<boolean>` and `installVsix({ host }): Promise<boolean>`.
- Consumes: `configuration` is a two-method bridge — `get(key)` and `update(key, value)` — implemented in `extension.js` over `vscode.workspace.getConfiguration('extensions.gallery')` with `ConfigurationTarget.Global` (the settings are `scope: APPLICATION`).
- `buildDiagnostics` takes `gallery?: { serviceUrl?: string }` and prints `default (…)` / `custom (…)` / `none (disabled by extension setting)`.

- [x] **Step 1: Write the failing test**

`test/marketplace.test.js`: mode detection for the three values; `custom` writes both keys with the trailing slash stripped; a non-`http` URL is refused with nothing written; `none` writes the sentinel and clears the provider; `default` clears both keys; the picker → input box → "重新加载" path calls `workbench.action.reloadWindow`; a rejected URL surfaces the reason; cancelling the picker writes nothing; a VSIX pick hands the file to `workbench.extensions.installExtension`; a failed install is reported.

```js
test('a custom gallery is written with the no-account provider', async () => {
	const configuration = createFakeGalleryConfig();
	await applyGalleryMode({ mode: 'custom', url: 'https://openvsx.corp.local/vscode/gallery/', configuration });
	assert.deepStrictEqual(configuration.writes, [
		['serviceUrl', 'https://openvsx.corp.local/vscode/gallery'],
		['authProvider', 'none']
	]);
});
```

- [x] **Step 2: Run the test to verify it fails**

`cd vscode/extensions/picket-remote-wsl && node --test "test/*.test.js"`
Expected: FAIL — `Cannot find module …/marketplace.js`, plus the two rewritten `Gallery:` cases of `diagnose.test.js` (which still print the bare URL).

- [x] **Step 3: Implement**

`marketplace.js` holds the three modes as data plus the two workflows; `commands.js` gains `selectGallery`/`installVsix` (both in the `COMMANDS` table, so the manifest test keeps the two sides honest) and passes `gallery: { serviceUrl: options.gallery.get('serviceUrl') }` into `buildDiagnostics`; `extension.js` supplies `gallery` and `host.executeCommand` and drops the two ids from the stub loop.

- [x] **Step 4: Run the test to verify it passes**

`cd vscode/extensions/picket-remote-wsl && node --test "test/*.test.js"` → `131 passing`. Then `cd vscode && ./node_modules/.bin/tsc -p extensions/picket-remote-wsl/tsconfig.json` (rc=0), `npm run transpile-client`, and `bash build/wsl/gate.sh` → 4/4.

- [x] **Step 5: Commit and re-export**

Commit as in Task 7 with message `feat(wsl): extension gallery source and offline VSIX install commands`, then re-export patch 67 and re-run the gate. The Windows smoke (three modes + reload + VSIX install through the real UI) moves to Task 14/L3: this host has no `wsl.exe`, and the setting writes are pure `settings.json` edits that the unit tests already pin.

Milestone M3 gate: record the three modes, the reload prompt and the VSIX install in the ledger with the observed UI or, where the host cannot show it, the named owner in Task 14.

---
### Task 11: stdio tunnel and `auto` wiring ✅

**Files:**
- Create: `vscode/extensions/picket-remote-wsl/src/tunnel.js`
- Modify: `vscode/extensions/picket-remote-wsl/src/resolver.js`, `src/launch.js` (`serverPaths().node`)
- Test: `vscode/extensions/picket-remote-wsl/test/tunnel.test.js` (6), `test/resolver.test.js` (+3)

**Interfaces:**
- Consumes: `IWslRunner.spawn` (Task 2), `chooseTunnelMode` (Task 7), `serverPaths` (Task 5).
- Produces: `PIPE_SCRIPT: string` — read `process.argv[1]` as the port, connect to `127.0.0.1:<port>`, print `PICKET-TUNNEL-READY\n`, pipe stdin↔socket, exit when either side ends.
- Produces: `createStdioTunnel({ runner, distro, serverPort, nodePath, log, preambleTimeoutMs = 15000 }): Promise<{ localPort, dispose(): Promise<void> }>` — listens on `127.0.0.1:0` with `pauseOnConnect: true`, spawns `['-d', distro, '-e', nodePath, '-e', PIPE_SCRIPT, String(serverPort)]` per connection, discards child output until the preamble, then pipes both ways with backpressure honoured; resolves only after a **bootstrap** connection has proven the whole path; `dispose` closes the listener, destroys the sockets and kills every child.

- [x] **Step 1: Write the failing test**

Cases in `test/tunnel.test.js`: `PIPE_SCRIPT` relays bytes both ways against a local echo server; the listener relays a connection to that echo server through the child (asserting the full argv); `dispose()` closes the listener (`ECONNREFUSED` afterwards) and leaves no child alive; a silent child fails the bootstrap with `tunnel preamble timeout`; a child that exits first reports `exited with code 3: node: not found`; a payload containing `0x00`/`0xff` survives the round trip.

- [x] **Step 2: Run the test to verify it fails** — `node --test test/tunnel.test.js` → module not found.

- [x] **Step 3: Implement `tunnel.js` and wire it into the resolver**

The resolver gains `endpointFor()`: a `direct` record yields the VM port, a `stdio` record yields the tunnel's local port (one tunnel per `distro:port`, cached for the window). `coordinates()` returns that endpoint plus the recorded token, so `resolve()` answers with an address this window can actually dial. `probeRecorded()` runs the liveness probe **through** the same endpoint — with localhost forwarding off, probing the VM port from the host would report a live server dead and start a second one. A tunnel that cannot bootstrap counts as `'dead'`, never as an error. `dispose()` closes every tunnel.

- [x] **Step 4: Run the test to verify it passes** — 140 pass across 20 suites; checkJs clean.

- [x] **Step 5: Manual smoke on Windows** — moved to Task 14/L3: it needs a Windows host, `[wsl2]\nlocalhostForwarding=false`, `wsl --shutdown`, and 20 reopen cycles counted against `Get-Process wsl`.

**Findings while implementing:**
1. `IWslRunner.spawn` promises `stdout` and `stderr`, not `stdin`; the tunnel takes the writable end from `child.stdin` and rejects a child without stdio pipes instead of silently relaying nothing — which is exactly the bug the first run hid (the bootstrap proved the child *starts*, not that bytes flow).
2. The bootstrap is a real self-connection: it proves `wsl.exe` spawned, an in-VM node ran and the server's listener answered, and it fails the whole tunnel before a window is opened rather than after.
3. Killing a child leaves `exitCode === null` and `signalCode === 'SIGTERM'`; the "no child alive" assertion has to accept either.

---

### Task 12: Packaging — two flavors, catalog, offline bundle, contract checks ✅

**Status:** implemented. Extension side (install-from-file zip branch + `src/offline.js`) landed in vscode `b2473741`; packaging side in the main repo Task 12 commit. Extension suites 144 passing, `build/wsl` suites 15 passing, gate 6/6.

**Files:**
- Create: `build/wsl/lib/common.mjs` (shared `payloadName` / `parseSha256Sums` / `componentFor` / `sha256File` / `parseArgs` / `runCli`), `build/wsl/assemble.mjs`, `build/wsl/check.mjs`, `build/wsl/offline-bundle.mjs`, `build/wsl/fetch-payload.sh`
- Create: `build/wsl/test/assemble.test.mjs` (5), `build/wsl/test/check.test.mjs` (7), `build/wsl/test/offline-bundle.test.mjs` (3)
- Create: `vscode/extensions/picket-remote-wsl/src/offline.js` + `test/offline.test.js` — `unpackOfflineBundle` (Task 3 leftover, landed here): expands the bundle zip (unzip / PowerShell `Expand-Archive` via env-passed paths), verifies the payload against the bundle's own SHA256SUMS and catalog, returns `{dir, payloadPath, payloadSha256, payloadSize, catalog, sums}`; `commands.js` "从文件安装…" accepts `*.zip` and routes through it, temp dir always removed
- Modify: `build/build.sh`, `build/win32/package.sh`, `build/linux/package.sh`, `build/check-contract.sh`, `build/wsl/gate.sh` (item 6), `.github/workflows/release.yml`, `.gitignore` (`build/wsl/download/`)

**Implemented CLIs** (plan's object-returning shapes became plain CLIs — packaging has no caller that needs a library):
- `assemble.mjs --app <resources/app> --tag <server-tag> --flavor embedded|ondemand [--payload f] [--sums f] [--size n]` — writes `<app>/extensions/picket-remote-wsl/payloads/catalog.json`, stamps `product.json.picketTag`, copies the payload to `resources/wsl-payloads/` for embedded (the directory `extension.js` actually reads — the plan's `payloads/` was wrong), refuses payload names without the tag, cross-checks `--sums` when given, asserts no `*.tar.gz` leaks into ondemand apps.
- `check.mjs --app <resources/app> --flavor f [--max-embedded-mb 110]` — exit 1 + stderr message on: missing proposal key, catalog.tag ≠ picketTag, catalog.flavor ≠ `--flavor`, no component for the payload name, embedded payload missing / sha / size mismatch, extension tree over budget (`embedded payload exceeds N MB`), ondemand app containing a payload.
- `offline-bundle.mjs --dir <download> --tag <tag> --out <zip>` — validates the staged trio (payload present, SHA256SUMS has the entry, digest matches, catalog.tag matches, catalog has the component), then zips the three files flat (`zip -j -X`, or `Compress-Archive` on win32 runners).
- `fetch-payload.sh <server-tag> [--metadata-only]` — `gh release download` from `noware-cn/picket-code-server` (`PICKET_SERVER_REPO` overridable, `PICKET_SERVER_TOKEN`→`GH_TOKEN`); the sums asset is named `picket-code-server-<tag>-SHA256SUMS` and is renamed to `SHA256SUMS` locally; always writes `payload-size.txt` (via the releases API) and derives `catalog.json` (single writer); full mode also downloads the payload and verifies its digest before staging.

**Wiring (deviations from the original step text):**
- `--tag` is the **server** tag from `PICKET_SERVER_TAG` (the payload repo versions independently), not the client `$2`; `picketTag` therefore identifies the shipped server payload, which is what resolver/components/diagnose key on.
- assemble runs for **both** platforms in `build.sh` (linux gets `--flavor ondemand` too), with `--app` pointing at `VSCode-$PLATFORM-$ARCH/resources/app` — product.json and extensions/ live under `resources/app`, not the product root.
- Flavor comes from workflow-level env `PICKET_WSL_PAYLOAD` (public releases: `ondemand`; the internal distribution overrides to `embedded`); `PICKET_SERVER_TAG` from repo variables, `PICKET_SERVER_TOKEN` from secrets.
- The offline bundle is built **once, in the win32 package job** (platform-independent content; duplicate artifact names would collide), uploaded as `picket-code-<ref>-offline-wsl.zip`; the release job's `picket-code-*` glob publishes it.
- `check-contract.sh` §5: proposal key present in `build/product.json` + the four `build/wsl` tools exist + all three package paths call `check.mjs`.
- `docs/testing.md` was left alone (it is the iCode ACP matrix); the WSL verification story lands in `docs/wsl-verification.md` in Task 14.

**Verified end to end against the real release** `v1.143.1-picket.1-rc.4`: metadata-only fetch (size 87754427 from the API, catalog derived from sums), full fetch with digest verification (87754427 bytes), embedded assemble into a fixture app → `check.mjs` pass → offline bundle → `unzip -l` shows exactly the payload + SHA256SUMS + catalog.json → the extension's `unpackOfflineBundle` round-trips the real bundle (digest match, temp dir removed).

---

### Task 13: In-distro CLI shim (`picket-code .`) ✅

Implemented in vscode-subtree commit `581ff108`; patch 67 re-exported (6257 lines) and reverse-check OK. `test/shim.test.js` 8 cases + 2 command-level cases; extension total **155 pass / 0 fail**, gate 6/6.

**Files (actual):**
- Create: `vscode/extensions/picket-remote-wsl/src/shim.js` (106 lines)
- Modify: `src/commands.js` (`installCli` / `removeCli` wiring), `extension.js` (stub loop removed — `registerCommands` now registers all 14 commands), `test/manifest.test.js` (14-command list), `test/commands.test.js` (+2 cases, harness `readlink -f` branch)
- Test: `vscode/extensions/picket-remote-wsl/test/shim.test.js`

**Interfaces (as implemented):**
- Consumes: `IWslRunner` (Task 2), `serverPaths` (Task 5), `toPosixPath` (Task 6), `AUTHORITY_PREFIX` (remoteUri.js).
- `shQuote(value)` — POSIX single-quoting, `'` → `'\''`.
- `shimScript({ clientPath, authority, remoteCliPath })` — `#!/bin/sh`, a generated-by comment, `export VSCODE_CLIENT_COMMAND=…`, `export VSCODE_CLI_AUTHORITY=…`, then `exec '<remoteCli>' "$@"`; all three values through `shQuote`. No trailing newline (the test's non-multiline `$` anchors at end of input).
- `installShim({ runner, distro, home, tag, clientPath }) → { status: 'installed' | 'foreign-link' | 'failed', scriptPath, linkPath, message? }`. Paths from `serverPaths(home, tag)`: script at `${root}/bin/<tag>/bin/picket-code`, link at `cliLink` (`~/.local/bin/picket-code`), authority `${AUTHORITY_PREFIX}+<distro>`.
- `removeShim({ runner, distro, home })` — **no `tag` parameter (deviation)**: one `rm -rf` removes `${root}/bin` (every tag we ever wrote) plus the link; old-tag scripts would otherwise linger, and the shim root is ours alone (payloads, runtime and data are sibling directories).
- One constant `sh -c` script per step, values as positional arguments; the script body itself travels on stdin. Steps: INSPECT (one round trip — `mkdir -p` the bin **directory** and `~/.local/bin`, then classify the link: `readlink -f` if symlink, `file` if it exists, `none` otherwise), WRITE (`cat > "$1" && chmod 755 "$1"` with `{ input: script }`), LINK (`ln -sfn "$2" "$1"`), PROBE (`'<clientPath>' --version >/dev/null 2>&1`).
- Upgrade policy: a link resolving inside `${root}/bin/` is ours → rewrite + relink in place; `file` or a foreign target → `foreign-link`, nothing overwritten. Probe exit 126/127 → `failed` with the `/etc/wsl.conf` `[interop] enabled=false` message (no amount of reinstalling fixes that).
- `commands.js`: `targetDistro(title)` = current window's distro (from `currentAuthority`) else `pickDistro`; `installCli` = `distroHomeOf` → `ensureComponentInteractive` → tag from `catalog` (missing → error "这个构建没有 WSL 服务器组件，无法安装命令行。") → `toPosixPath(options.clientPath ?? process.execPath)` → `installShim` → one of three status messages; `removeCli` = distro → `removeShim` → info. `COMMANDS` gains `picket.wsl.installCli` / `picket.wsl.removeCli`; `options.clientPath` is the seam the tests use instead of `process.execPath`.

- [x] **Step 1–4: RED → implement → GREEN** — `node --test "test/*.test.js"`: 155 pass / 0 fail.

- [x] **Step 5: commit and re-export** — vscode `581ff108`; patch 67 re-exported from `wsl-baseline`, `git apply -R --check` OK; main-repo commit `feat(wsl): Task 13 — in-distro picket-code CLI shim`. The Windows manual smoke (`picket-code .` opens a `picket-wsl+<distro>` window, `--version` prints the payload CLI version, uninstall removes the link) moved to the L3 checklist in `docs/wsl-verification.md` (Task 14) — it needs a real Windows machine, like the rest of L3.

Deviations (ledger R-13): `removeShim` has no tag; the upgrade check is a `startsWith` on the shim root; `shimScript` ends without a newline; INSPECT mkdirs the bin directory (not the script path) in the same round trip as the link classification; manual smoke deferred to Task 14's L3 checklist.

---

### Task 14: Automated acceptance — remote-window UI, in-process behaviour, scripts ✅

Implemented in vscode commits `55e358a2` (three product defects this task found) and `f8ebff08` (seam, harness, smoke); main-repo commit `801ca4f`. Patch 67 re-exported at **53 files / 6881 lines**: the acceptance tree under `vscode/test/` belongs to the feature and ships in the same patch, so a clean 1.143.1 tree reproduces the green run. Reverse-check OK, `bash build/wsl/gate.sh` **6/6 PASS**.

**Files (actual):**
- Create: `vscode/test/wsl-harness/fake-wsl.mjs` (99 lines) — the stand-in `wsl.exe`
- Create: `vscode/test/wsl-harness/remote/{package.json,extension.js}` (152 lines) — assertions that only the remote extension host can make
- Create: `vscode/test/smoke/src/areas/wsl/remote.test.ts` (165 lines) — A5/A6
- Modify: `vscode/test/smoke/src/main.ts` (register the area), `vscode/test/automation/src/code.ts` (`getElements`), `vscode/test/automation/src/electron.ts` (`remoteAuthority`)
- Modify: `vscode/extensions/picket-remote-wsl/extension.js` — the `PICKET_WSL_RUNNER` seam
- Create: `build/wsl/acceptance.sh` (264 lines), `build/wsl/test/fake-wsl-env.test.mjs`
- Create: `docs/wsl-verification.md` — the four human checks

**Interfaces (as implemented):**
- `bash build/wsl/acceptance.sh [--l2|--remote|--ui|--lifecycle|--icode|--all]`; every check prints `PASS <name>` / `FAIL <name>: <detail>` and a failing run exits non-zero. `--all` runs l2 → remote → ui → icode → lifecycle and is the one command CI and the release checklist call.
- **The seam.** The extension spawns `process.env.PICKET_WSL_RUNNER` instead of `wsl.exe` when it is set. Only the `wsl.exe` boundary is faked: the payload tarball, its bundled node, every `sh` script, the login-shell launch, the probe and the kill ladder are the real ones. `fake-wsl.mjs` executes distro-side invocations as plain local commands against `PICKET_WSL_FAKE_HOME`, and spawns them **detached** — on Windows the server outlives the relay and the window, and `--lifecycle` depends on that same shape here.
- **Results channel (deviation from the plan's "parse stdout").** The remote harness prints `WSL-ASSERT ok|fail <name>` into the server console *and* writes a JSON summary to `<home>/.picket-code-server/harness-results.json`; `acceptance.sh` polls the file. A file survives the window dying and needs no log plumbing, which is what made the stage flake-free.
- Checks: b2 opened folder equals `/home/<user>/我的 项目` (space and CJK in one name); b3 `uname -a` contains `Linux` and `PICKET_ACCEPT_PROFILE_MARKER === 'from-login-shell'` exported by `~/.profile`; b4 a `workspace.fs` write raises a watcher event within 2 s; b5 10 MB round trip with equal sha256; b6 only when `WSL_HARNESS_EXPECT_ICODE_MISSING=1`, `PICKET_ICODE_BIN !== '/nonexistent/icode'`. Fixtures reach the distro through `WSLENV`.
- A5 clicks the activity-bar `Remote Explorer` item and asserts the `WSL 目标` view lists the distro from the real `--list --verbose` parse; A6 asserts the window title ends with `WSL`, not the raw authority. Both skip when `PICKET_WSL_DISTRO` is unset, so the shared CI matrix is unaffected.

- [x] **Step 1–2: RED** — `bash build/wsl/acceptance.sh --all` fails on every stage before any plumbing exists (`FAIL remote`, `FAIL ui`, `FAIL lifecycle`). The first wired run then failed for six honest reasons, each fixed with the failing stage as the test (see R-14.1–R-14.6).

- [x] **Step 3–4: GREEN (Linux stand-in, 2026-11-04)**

| Stage | Result |
| --- | --- |
| `--l2` | 16/16 `build/wsl/test` cases pass (incl. the fake's env contract) |
| `--remote` | PASS b2, b3, b4, b5, remote |
| `--ui` | PASS A5, A6 — smoke runner log shows `renders the WSL targets view with the distro from a real listing (A5, B1)` 759 ms and `brands the window title as WSL, not the raw authority (A6)` |
| `--lifecycle` | PASS 2 rounds, then PASS 20 rounds (default): one server pid throughout, exactly one at the end |
| `--icode` | PASS — bogus `picket.wsl.icodePath` never exported |
| `--all` | PASS everything, exit 0 |

- [x] **Step 5: the four-item checklist, commit and gate** — `docs/wsl-verification.md` holds exactly the four checks the plan listed (native folder dialog, a real `picket-code .`, one look at the layout, a 15-minute pass at M4), each with the command that sets the scene so the person only looks. Committed as `test(wsl): automated acceptance harness for the WSL remote window` (vscode) + `test(wsl): one-command acceptance run for the WSL remote window` (main repo); gate 6/6.

**Deviations and defects found (ledger R-14):**
1. **Restricted mode silently drops the harness** (the root cause of a three-hour hunt). `getExtensionUntrustedWorkspaceSupportType` (`extensionManifestPropertiesService.ts:196-229`) returns `false` for any extension that has a `main` and does not declare `capabilities.untrustedWorkspaces`; the enablement filter then removes it (`abstractExtensionService.ts:533` → `filterEnabledExtensions`, which logs only when `isCI`). A freshly opened folder is restricted, so the harness never activated and every assertion hung. Fix: declare `"capabilities": { "untrustedWorkspaces": { "supported": true } }`. The remote scanner had listed it all along.
2. `workbench.view.remote` is `VIEWLET_ID` (`remoteExplorer.ts:42`), not a command — `quickaccess.runCommand` on it can only say "No matching commands". A5 clicks `.activitybar .action-label[aria-label^="Remote Explorer"]`.
3. The view is contributed with `when: isWindows && !isWeb`, so on the Linux stand-in the container is empty and `hideIfEmpty` hides it. Acceptance **stages a copy** of the extension with that clause removed — in `acceptance.sh prepare` and again in `remote.test.ts`'s `stageExtensionWithRealCatalog()`. A5 therefore proves "given a listing, the view renders", not the Windows-only gating.
4. `server_pids` matches `out/server-main.js … --user-data-dir=<scratch>`: `bin/picket-code-server` is an sh wrapper that *runs* node (no `exec`), so a wrapper-shaped pattern counts two processes for one server.
5. pgrep patterns must not start with `-` (pgrep reads it as its own option and prints usage) and must not contain the script's own command-line text, or the script kills itself.
6. `prepare` deletes only what it owns (`home`, `user-data`, `ext`, `logs`), so `--all` stages can run back to back without erasing each other's logs.
7. `watcher.onCreate` is not API — `onDidCreate`.
8. `--ui` needs `mkdir -p "$SCRATCH/logs"` before the smoke run, and `code.ts` needed a `getElements(selector, true)` accessor to read element attributes.
9. The harness must be **installed** into the scratch `--extensions-dir` (`<home>/.picket-code-server/extensions/picket.picket-wsl-harness-0.0.0`), because the server scans that directory; `--extensionDevelopmentPath` only reaches the local window.
10. `build/wsl/test/fake-wsl-env.test.mjs` pins the fake's environment contract (`PICKET_WSL_FAKE_HOME`, `PICKET_WSL_DISTRO`, `WSLENV`); its first URL resolved one directory too shallow.
11. Three product fixes fell out of the green run: the distro probe swallowed EPIPE on a child that exits immediately; the start lock created its parent directory first; the payload installer extracts into a sibling temp directory and strips one wrapping top-level directory.

---

### Task 15: User documentation and release notes ✅

Committed as `docs(wsl): user guide, manual checklist and release matrix entry` (main repo `324b3c6`).

**Files (actual):**
- Create: `docs/wsl.md` (136 lines)
- Create: `docs/wsl-verification.md` (Task 14)
- Modify: `docs/roadmap.md` (two places: the feature list and the "already shipped" section)
- Modify: `docs/release-checklist.md` (platform matrix row)
- Modify: `website/docs/guide/wsl.md` (marked as the old method)

- [x] **Step 1: `docs/wsl.md`** — 前提; 快速上手; 组件三大来源（`serverPayloadPath` / 内置载荷 / `serverPayloadBaseUrl`）与 SHA256 失败; 发行版管理; 登录 shell 与 `server-env-setup`; iCode 检测与 `PICKET_ICODE_BIN`; WSL 里的 `picket-code` 命令; 扩展市场三种模式; 排障（`startTimeoutSeconds`、退出码 99、`tunnelMode`、CA）; 磁盘布局; 停止与清理; 已知限制; 相关文档。Every command, setting and default in it was read out of `extensions/picket-remote-wsl/package.json`, not from memory.

- [x] **Step 2: the three existing docs** — `docs/roadmap.md`: the WSL bullet now says the capability is built in (own `picket-code-server` payload + `noware.picket-remote-wsl`) and links `docs/wsl.md`; the "not done" list keeps SSH and says WSL is done. `website/docs/guide/wsl.md`: title became `在 WSL 中使用（旧方法，已不再需要）` with a `::: tip` pointing at the new page; the body is kept because users on older releases still need it — and the VitePress sidebar already linked `/guide/wsl`, so no nav change was needed. `docs/release-checklist.md`: `Windows x64 + WSL2（远程窗口）` added to the platform matrix, automation = `build/wsl/acceptance.sh --all` + A5/A6, manual = the four items in `docs/wsl-verification.md`.

- [x] **Step 3: links verified** — every relative link in `docs/wsl.md` and the replaced bullets resolves (`docs/testing.md`, `docs/release-checklist.md`, `docs/branching.md`, `docs/wsl-verification.md`).

**Deviation from the plan's wording (R-15.1):** the plan asked the release checklist to name "L3 WSL 清单五项（端口转发、登录 shell 环境、`picket-code .`、树视图与 `wslpath`）". The landed checklist points at `docs/wsl-verification.md`'s four items plus `acceptance.sh --all` instead: port forwarding, login-shell env, tree view and `wslpath` are now automated (b3, A5, fake-wsl paths), and duplicating them as manual steps would invite a ticked box that never ran.

**Known UX blemish documented, not patched (R-15.2):** `selectGallery` can show two restart prompts in a row, because upstream raises its own modal per changed setting (M3 note 10). `docs/wsl.md` tells the user to accept the first one.

---

## Self-Review

**Spec coverage:** §4.2 architecture → File Structure + Tasks 1–11; §4.3 catalog/flavors → Tasks 1, 12; §4.4 payload install → Task 3; §4.5 resolver semantics → Task 6; §4.6 tunnel → Task 11; §4.7 iCode → Task 7; §4.8 gallery → Tasks 9, 10; §4.9 UX commands → Task 8; §4.10 first-use interception → Task 8; §4.11 failure copy → Task 8 (diagnose + messages); §4.12 patch numbering → Tasks 1, 9; §4.13 tree view and distro management → Task 8; §4.14 login shell and `server-env-setup` → Tasks 5, 7; §4.15 CLI shim → Task 13; §6 acceptance automation → Task 14; §5 components → File Structure; §6 test layers → Tasks 2–13 and `docs/testing.md`; §7 milestones → M1 ends after Task 7, M2 after Task 8, M3 after Task 13, M4 after Tasks 11–12, 14, 15. Gaps found and closed while writing: `unpackOfflineBundle` was in the spec's offline bundle but had no owner (added to Task 3); the first-start lock had no owner (Task 5); `picketTag` stamping needed a concrete place, now `build/wsl/assemble.mjs` rather than a core patch.

**Type consistency:** `ICatalogComponent` (Task 1) is consumed unchanged in Tasks 3, 4, 12. `IWslRunner` (Task 2) is the only process boundary in Tasks 3–8 and 11–13. `IDistro` (Task 2) is the single shape consumed by `visibleDistros`, `buildDistroNodes` and `defaultDistro`; `toPosixPath`/`toWindowsPath` (Task 6) are the only path translators, used by Task 8's folder dialog and Task 13's `clientPath`. `serverPaths`/`buildServerArgs` (Task 5) are the only places that compose in-distro paths. `probeServer` returns the three-value union used verbatim by Task 6. `chooseTunnelMode` (Task 7) is consumed only by Task 11.

**Known deviations from the spec text:** (0) the tree view lists distros only — no public API exposes recent workspaces per remote, and it is now listed in spec §2 non-goals. (1) the spec puts the catalog at `resources/payloads/catalog.json`; this plan puts it at `<extensionPath>/payloads/catalog.json` because build-time assembly can write into the packaged extension directory without patching gulpfile packaging and `context.extensionPath` is the one path an extension can trust. (2) the runtime record follows the spec (`runtime/<distro>.json`) rather than a single `runtime.json`: a distro normally has its own `$HOME`, but two distros that mount the same home directory would otherwise overwrite each other's port and token, and the distro name costs nothing. The filename keeps the distro spelling verbatim (spaces included) and is always passed as a quoted argv entry.

---

## Milestone log

One entry per milestone, committed with the code so a reviewer can see what was decided while building, not only what was planned.

### M1 — payload install, resolver, iCode detection (Tasks 1–7): complete

**State:** `node --test "test/*.test.js"` → 79 pass (catalog 4, distro 9, payload 5, components 7, launch 13, probe 5, remoteUri 7, resolver 15, icode 5, preflight 9); `tsc -p extensions/picket-remote-wsl/tsconfig.json` (checkJs) clean; `npm run transpile-client` rc=0; `bash build/wsl/gate.sh` 4/4 PASS; patch 67 = 26 files, reverse-applies.

**Decisions taken during M1 (each also in the SDD ledger):**
1. `runtime/<distro>.json`, not one `runtime.json` — two distros that mount the same home must not overwrite each other's port and token. Data and extensions directories stay shared, as the spec says.
2. `lockAndRead` costs two round trips (lock, then read) rather than one script; a single script cannot both answer "is a start in progress" and leave the record unread when it is.
3. A runtime record whose `tag` differs is restarted **without** probing: the recorded port may belong to another server by then, and its answer would describe a stranger.
4. A payload directory whose marker is missing or unparseable is `broken`, never `installed` — an interrupted install must not look usable.
5. The payload tarball is flat at its root; Task 12's contract check must assert it, because the installer renames the extraction root to `server-<version>`.
6. iCode detection runs in `sh -lc`, the same login shell the server starts in; a bare `sh -c` would report `missing` on machines where the server would have found `~/.local/bin/icode`.
7. `serverPaths`/`runtimeFileFor` and `buildServerArgs` remain the only composers of in-distro paths and argv; every value reaching a shell is an argv entry.
8. `startServer` takes `extra` and merges it into the runtime record, so Task 7 can store `tunnelMode` and the iCode source without a second write.
9. The extension's settings are getters over `workspace.getConfiguration`; `embeddedDir` is offered only when `catalog.flavor === 'embedded'`.
10. The first-start lock is created for real (`mkdir <runtimeFile>.lock`), held across install-and-start, released in `finally`, and the runtime record is re-written before the release so a waiting window can read it. A lock older than one start window is taken over, because a crash would otherwise wedge that distro for the rest of the session.

**Not verified in M1, deferred with owners:** the end-to-end `picket-wsl+<distro>` open (needs Task 8's command; no Windows host in the build environment), the real `wsl.exe` UTF-16 table and `wslpath` (Task 14/L3 on a Windows runner), and the embedded payload's presence in a real build (Task 12).

### M2 — commands, targets view, diagnostics (Task 8): complete

**State:** `node --test "test/*.test.js"` → 117 pass (M1's 79 plus tree 5, manage 6, nudge 4, diagnose 5, commands 13, manifest 5); `tsc -p extensions/picket-remote-wsl/tsconfig.json` (checkJs) clean; `npm run transpile-client` rc=0; `bash build/wsl/gate.sh` 4/4 PASS; patch 67 = 38 files / 4701 lines, reverse-applies.

**Decisions taken during M2 (each also in the SDD ledger):**
1. `host` is a narrow, hand-written binding of the `vscode` surface (`showQuickPick`, `showOpenDialog`, `show*Message`, `withProgress`, `openFolder`, `runInTerminal`, `refreshTargets`, `showDocument`, `uriFor`). Nothing under `src/` requires `vscode`, and a test asserts it, so the whole command layer runs under `node --test`.
2. Commands take an **optional preselected distro**. This is what makes one handler serve the palette (prompt), a tree row click (open that distro), and a context-menu click (`node.distro`). `distroOf(node)` normalises both.
3. `createCommands` owns the workflows and `registerCommands` is a thin table (`COMMANDS`) over `vscode.commands.registerCommand`. The table is exported so `test/manifest.test.js` can prove both directions: every contributed command is registered, and every registered id is contributed.
4. `createComponents({ distro, home, explicitPath? })` — the third field is how "install from the file I just picked" reaches the installer. Without it the only path would be writing `picket.wsl.serverPayloadPath`, which would silently outlive that one install.
5. `ensureComponentInteractive` returns `false` on cancel and `openFolder` then does nothing: a half-opened window with no server is worse than no window.
6. A failing install is caught and shown as `安装 WSL 服务器组件失败：<reason>`, never thrown into the command dispatcher.
7. `parseOnlineTable` splits on two or more spaces (single-spaced hint paragraphs stay out), drops the `NAME` header and `docker-desktop*` rows. Distro names are then re-validated against `/^[A-Za-z0-9._-]+$/` at the point they would reach a shell, because the table itself is untrusted input.
8. `delete` asks with `{ modal: true }` and only accepts the exact '删除' action; anything else is a cancel.
9. Diagnostics fence every probe: a failure becomes `Distros: unavailable: <reason>` on that line instead of truncating the report. The product tag comes from `<appRoot>/product.json`, because the manifest's `version` is a bare `1.143.1` with no picket anchor.
10. `distros` are read once and the **primary** distro (setting, then `defaultDistro()`) drives the component/iCode/node/git sections; an empty list degrades those four to `unavailable: no WSL distro installed`.
11. `maybeNudge` fires at most once per install (`picket.wsl.nudgedUncFolder` in global state) and only in a local window; its action re-enters `picket.wsl.reopenInWsl`, so the nudge shares the tested path instead of a second copy.
12. The tree view is `picketWsl.targets` in the `remote` container, no `remoteName` filter (the official extension sets `"wsl"` but that field is marked for deletion upstream); rows carry `contextValue` `activeDistro`/`inactiveDistro` and a click opens that distro's folder picker.
13. Test files beyond the plan's test list: `test/nudge.test.js` (4) and `test/manifest.test.js` (5).

**Not verified in M2, deferred with owners:** the Windows smoke of this task (tree rows, folder dialog, reorder after `设为默认发行版`) needs a Windows host and moves to Task 14/L3; the `Gallery` line of the diagnostics prints the build's own gallery only; Task 10 replaces that with the settings snapshot (`default` / `custom` / `none`).

### M3 — gallery source, no-account marketplace, offline VSIX (Tasks 9–10): complete

**State:** `node --test "test/*.test.js"` → 131 pass (M2's 117 plus marketplace 11, diagnose's 2 replaced by 3 gallery-mode cases); `tsc -p extensions/picket-remote-wsl/tsconfig.json` (checkJs) clean; `npm run transpile-client` rc=0; core `extensionGalleryManifestService.test.js` 50 passing (was 46) and the extension-management suites 173 passing; core type gate `tsc -p src/tsconfig.gallery.json` clean for the four touched files (6 pre-existing `Timeout` complaints in `ipc.net.ts`/`ipc.ts`/`progress.ts` untouched); `bash build/wsl/gate.sh` 5/5 PASS; patches 66 = 232 lines and 67 = 39 files / 5041 lines, both reverse-apply.

**Decisions taken during M3 (each also in the SDD ledger):**
1. The marketplace override reuses the two settings upstream already ships (`extensions.gallery.serviceUrl`, `extensions.gallery.authProvider`) instead of inventing a `product.overrides.json`. A user-level product file would be a third mechanism pointing against upstream's grain, and `product.ts` reads `product.json` once at startup with no override layer to hook.
2. "Needs no account" is expressed as a new enum value `authProvider: 'none'`, not as "serviceUrl set but authProvider absent". `TestConfigurationService.inspect()` reports `userValue: value` and so cannot distinguish "not set" from "set to the default"; an explicit enum is also validated by the settings registry, and the default stays `github`, so existing behaviour is unchanged.
3. A gallery that is switched off is `serviceUrl: 'none'`, not an empty string — `''` is the upstream default meaning "use the product's gallery", and an empty-looking value is exactly the kind of thing a later edit silently drops.
4. `itemUrl` is derived from `serviceUrl` by the `/vscode/gallery` suffix rule, and left undefined otherwise. Open VSX and every mirror built from it match; a hand-rolled gallery gets no item link, which is better than pointing "view details" at the wrong host.
5. `ExtensionGalleryConfig` became exported with optional fields and `buildExtensionGalleryManifest()` became protected, so the no-account branch composes the manifest through the same code the product path uses. The alternative — a second composer — would drift the moment upstream adds a resource.
6. The three modes write different key sets on purpose: `custom` writes both keys, `none` writes the sentinel and **deletes** `authProvider`, `default` deletes both. A mode switch must not leave the previous mode's opinion behind.
7. `selectGallery` reloads through `workbench.action.reloadWindow` only after the user accepts the confirmation, because both settings are `scope: APPLICATION` and upstream already raises its own "restart" dialog.
8. Diagnostics reads the gallery from the extension's settings, not from the build's `product.json`: after Task 10 the two disagree exactly when the user changed the source, and the user's answer is the one worth printing.
9. `installVsix` hands the picked file to upstream's `workbench.extensions.installExtension` and reports the failure; it does not stage the VSIX into `--extensions-dir` (that is the offline bundle's job, Task 12).
10. `gate.sh` reverse-checks only patches 66 and 67, the two this branch authors. Patches 53 and 58 cannot be reversed on their own (one deletes, one overlaps), so listing `apply-list.txt` wholesale would produce false failures.

**Known UX blemish, not patched:** upstream's `onDidChangeConfiguration` handler raises its own modal restart prompt per key, so one `selectGallery` run can show two dialogs in a row. Suppressing it would mean patching behaviour unrelated to this feature; it goes in Task 15's notes instead.

### M4 — stdio tunnel, packaging, CLI shim, acceptance, docs (Tasks 11–15): complete

**State (2026-11-04, final run of this branch):** `node --test "test/*.test.js"` in `extensions/picket-remote-wsl` → **159 pass / 0 fail** (15 suites); `node --test "build/wsl/test/*.test.mjs"` → **16 pass / 0 fail**; `tsc -p extensions/picket-remote-wsl/tsconfig.json` (checkJs, no emit) clean; `npm run transpile-client` rc=0; `bash build/check-contract.sh` → all ok; `bash build/wsl/acceptance.sh --all` → PASS l2 / remote (b2–b6) / ui (A5, A6) / lifecycle (20) / icode, exit 0; `bash build/wsl/gate.sh` → **6 passed, 0 failed**. Patch 66 = 232 lines, patch 67 = 53 files / 6881 lines, both reverse-apply onto `vscode/` at `wsl-baseline`.

**Commits:** vscode `8156133f` (tunnel) → `b2473741` (packaging) → `581ff108` (shim) → `55e358a2` (fixes found by acceptance) → `f8ebff08` (acceptance harness); main repo `66f0899` → `9b372f5` → `a880571` → `801ca4f` → `324b3c6`.

**Decisions taken during M4 (each also in the SDD ledger):**
1. The tunnel preamble is a magic line plus a windowed length-prefixed frame, not HTTP CONNECT: the relay is our own `wsl.exe` child, so a handshake we control is cheaper to test with a fake than a protocol upgrade.
2. `tunnelMode: auto` reads `%USERPROFILE%\.wslconfig` and only falls back to `stdio` when the file says `localhostForwarding=false` or `networkingMode=mirrored`; reading the file beats probing ports, and a wrong probe looks exactly like a slow server.
3. The offline bundle is the same tarball the embedded flavor carries, plus `SHA256SUMS` and `catalog.json` — one artifact to test, three ways to deliver it.
4. The CLI shim writes a script under `~/.picket-code-server/bin/<tag>/` and a link in `~/.local/bin`, so an upgrade rewrites a file we own and never touches a foreign link (R-13).
5. Acceptance drives the **real** dev workbench for A5/A6 and the real server for b2–b6; only `wsl.exe` is faked. Anything asserted with a mock would have missed every one of R-14.1–R-14.6.
6. The four human checks are the ones with no observable API (native dialog, real Windows client, visual layout, a human end-to-end pass). Everything else that used to be on that list is now a stage in `acceptance.sh`.

**Not verified on this machine, deferred with owners:** the Windows-side manual pass (`docs/wsl-verification.md`, all four items), a real `wsl.exe` UTF-16 table and `wslpath`, real Windows `SIGTERM`→`SIGKILL` on a distro-side server, the embedded-payload and offline-bundle shapes in a signed build (asserted structurally by `build/check-contract.sh` and Task 12's packaging tests), and the Windows runner path in CI (only `--l2` runs on the current runners).
