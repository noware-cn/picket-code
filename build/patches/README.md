# build/patches — Copilot removal patch status

Status: 2026-10-27, pinned upstream tag `1.143.1` (commit e646868227c), full set re-verified
forward on a clean 1.143.1 tree.

## Files

| File | Kind | Status |
|---|---|---|
| `52-ext-copilot-remove-it.json` | JSON actions (physical removals) | **ENABLED** — 177/177 removal paths verified present on 1.143.1 and applied cleanly |
| `53-ext-copilot-remove-it.patch` | git apply (reference cleanup, 30 files) | **ENABLED (rebase v2)** — 28 modified + 2 deleted files; still applies cleanly on 1.143.1 |
| `54-picket-code-disable-node-compile-cache.patch` | git apply (build reproducibility) | **ENABLED** — `shouldGenerateNodeCompileCache` returns false (win32 EBUSY + nondeterministic cache output) |
| ~~`55-picket-unpack-native-and-agenthost.patch`~~ | git apply (ASAR unpack list) | **RETIRED** — file deleted; patch 56 fixed the writer race those 30 unpack entries existed to dodge, so upstream's list is enough again |
| `56-asar-serialize-inserts.patch` | git apply (ASAR writer fix) | **ENABLED** — serializes `Filesystem.insertFile`; `asar@3.2.0` records `this.offset` before awaiting the integrity hash, so concurrent inserts share an offset and ~20% of the archive reads back the wrong file |
| `58-agenthost-clean-product-config.patch` | git apply (accounts + chat + getting started + extensions + preferences, 13 files) | **ENABLED** — the workbench runs with a `product.json` that has no `defaultChatAgent`: `defaultAccount.ts` returns a neutral config, skips registering the default-account provider and releases the waiters that would block on it forever; the onboarding wizard stays closed instead of asserting; the chat welcome text, chat status dashboard, chat status bar entry and extension-management checks treat a missing chat agent as "no chat extension" instead of dereferencing `undefined`; the Getting Started Copilot step never renders; the terminal keeps the plain "install commands in PATH" entry instead of a `copilot` shim we do not ship; the settings page no longer recommends the chat extension |
| `57-agenthost-remove-copilot-deps.patch` | git apply (agent host DI seams, 7 files) | **ENABLED** — splits `copilotApiService.ts` into a Copilot-free `copilotApiTypes.ts` plus a dead `copilotApiServiceImpl.ts`, moves the local-model seam to `localModelSetupTypes.ts`, and registers the no-op `NoCopilotApiService` / `NoLocalModelSetupService`, so the agent host never loads `@vscode/copilot-api` or `@github/copilot-sdk` |
| `61-build-source-adaptations.patch` | git apply (build script adaptations) | **ENABLED** — replaces `patch-vscode.py` (6 anchors, see below) |
| `62-chat-default-agent-fallback.patch` | git apply (chat panel default agent) | **ENABLED** — with Copilot removed (52/53) no provider declares itself default, so the chat service fell back to nothing and the panel had no selectable agent; it now falls back to the silent default agent id when the whole provider list lacks an `isDefault` entry |
| `63-agenthost-icode-provider.patch` | git apply (iCode agent provider, 10 files) | **ENABLED** — adds the `icode` provider under `node/icode/`: an ACP v1 (NDJSON JSON-RPC) client reusing `JsonRpcProtocol`/`StreamSplitter`, launch-config resolution (`PICKET_ICODE_BIN`/`PATH`, `.cmd` shim escaping) with a graceful → SIGTERM → SIGKILL ladder, `session/update` → agent-signal mapping, and `IcodeAgent` (one turn per chat, approvals, cancel, exit recovery); both agent-host entry points register it when `icode` resolves to a file and `PICKET_ICODE_AGENT_ENABLED` is not false |
| `64-changeset-auto-diff-strategy.patch` | git apply (changeset diff strategy, 7 files) | **ENABLED** — per-turn and Session Changes computations now start from the exported `DEFAULT_CHANGESET_DIFF_STRATEGY` (`'auto'`) instead of a hardcoded `'fileEditTracker'`, so a turn's changeset is diffed from its Git checkpoint pair (`_computeTurnDiffsUsingGit`) and only falls back to the tracked edits when no pair resolves; `CheckpointAndChangesetContribution` now recomputes the changeset only after `captureTurnCheckpoint` settles (on success and on failure), because recomputing first raced the capture and found no pair; `FileEditTracker` is never constructed in this build, so every per-turn changeset used to resolve empty |

Source: https://github.com/VSCodium/vscodium/tree/master/patches (MIT). Picket Code applies
`build/product.json` (merge), then 52 via `build/apply-patches.sh` (JSON removals), then the
`git apply` list in the order pinned by `apply-list.txt`.

## 53 rebase v2 (2026-10-23)

Rebased against `microsoft/vscode@1.142.0` (commit d956e8a6) with patch 52 already applied.
Regenerated from the local rebase tree: `git diff HEAD` filtered to exclude the 177 paths
already removed by 52. Result: 28 modified + 2 deleted files (30 `diff --git` headers),
applies cleanly with `git apply --ignore-whitespace --check`.

### What the rebase changed vs the VSCodium original

- **Gulp**: dropped copilot tasks from `build/gulpfile.vscode.ts` (`prepareCopilotRipgrepShimTask`,
  `compileCopilotExtensionBuildTask`) and `build/gulpfile.reh.ts`; removed Copilot/Claude
  SDK deps from `build/npm/postinstall.ts` (`.claude/` symlink block) and `package.json`
  (scripts `compile-copilot` / `watch-copilot`, deps `@anthropic-ai/sdk`,
  `@github/copilot-sdk`, `@vscode/copilot-api`, devDeps `@anthropic-ai/claude-agent-sdk`,
  `@openai/codex`, meta `copilotRuntimeVersion`; codex / agent-host copilot-meta scripts).
- **Locks**: `package-lock.json` / `remote/package-lock.json` regenerated via
  `npm install --package-lock-only --ignore-scripts` after the dependency edits — 0 Copilot
  entries remaining.
- **agentHost core**: `agentHostMain.ts` provider registration block (CopilotAgent
  unconditional + Claude/Codex gated) removed; `agentHostServices.ts` OTel/Claude/Codex
  service registrations removed; `agentService.ts` OTel import/ctor param + session
  comparison metadata call removed; `agentHostTelemetryReporter.ts` OTel import/ctor
  param/`emitTurnTiming` block + codex account telemetry spread removed
  (`isOtelEnabled` fixed to `false`); `protocolServerHandler.ts` OTel imports;
  `agentHostAutomationCustomizations.ts` copilot plugin converter removed
  (`children: []`); `agentServiceTestUtils.ts` OTel/Copilot service removal;
  `agentHostTurnTelemetryContext.ts`, `agentHostBootstrap.ts`, `agentHostContributions.ts`
  reference cleanup.
- **Deleted**: `src/vs/platform/agentHost/node/claude/claudeTerminalOutput.ts` and its test
  (Claude-only terminal renderer; not covered by 52's path list).
- **Skipped (intentionally)**: `agentHostSessionTitleController.ts` — 1.142.0 already uses
  `IAgentHostUtilityModelService` for title generation; the VSCodium 53 hunk (Copilot
  utility-chat + GitHub context) targets an older implementation and is not applicable.
  Non-blocking for compile; leftover Copilot import stays until the P2/G3 byte-cleanup pass.

### Verification

- `git apply -R --check` against the rebase tree: clean.
- Clean-tree forward test: fresh `1.142.0` worktree + 52 (177 removals) + 53 → apply OK,
  no rejects; esbuild error list from CI run #15 (24 dangling imports) fully resolved:
  `copilotAgent`/`claudeAgent`/`codex*`/`agentHostOTelService`/`codexAccountTelemetry`/
  `codexSavedChatReader`/`agentHostCommitOperationProvider`/`claudeReplayMapper`/
  `claudeSubagentRegistry`/`claudeToolDisplay`/`copilotSessionLauncher`/
  `copilotPluginConverters` → 0 hits in `src/vs/platform/agentHost/node`.
- Remaining non-blocking references (identical on rebase tree and clean test tree):
  `agentHostServerMain.ts` argv parsing (`--codex-sdk-root`), `nodeAgentHostStarter.ts`
  config reads, `copilotBuiltinAgents.ts` (copilot dir, test-only import), comment in
  `agentSdkDownloader.ts`. All outside the esbuild bundle graph.

## 55 — RETIRED (2026-10-28)

The 30 unpack entries were a workaround for the ASAR writer race that patch 56 fixes.
With the race gone the archive reads back correctly, so the list is back to upstream's
11 entries and `.asar.unpacked` shrinks accordingly. The file is deleted; do not re-add
entries here — if a package genuinely needs a real path, add a targeted entry with a
comment explaining the non-corruption reason.

## 55 (historical) — one ASAR unpack list instead of six patches (2026-10-27)

The former `55-picket-unpack-policy-watcher` … `60-picket-unpack-cjs-interop-chain` series
all appended entries to the same array in `build/gulpfile.vscode.ts` (`createAsar(...)`), so
every patch depended on the context left by the previous one: reordering a single entry broke
all later patches. They are now one hunk with the entries grouped by reason (policy-watcher,
Node 24 loader chain, official native modules, AgentHost dynamic imports, CJS interop chain).
Regenerated against `1.143.1 + 52 + 53 + 54`; the resulting `gulpfile.vscode.ts` is byte-identical
to applying 55–60 in sequence (verified by blob comparison). Adding a module is now a one-line
edit to a single patch.

## 57 — the agent host boots without the Copilot packages (2026-10-28)

52 removes `@vscode/copilot-api` and `@github/copilot-sdk` from `package.json`, but the agent host still
value-imported both at module-load time, so the process died with `MODULE_NOT_FOUND` before it served anything.
Two chains mattered: `agentHostServices.ts` → `shared/copilotApiService.ts` → `@vscode/copilot-api`, and
`agentHostServices.ts` → `copilot/localModelBridge/localModelSetupService.ts` → `shim/shimLocalModelProvider.ts`
→ `shim/copilotRequestHandler.ts` → `@github/copilot-sdk`. The service decorators live inside those tainted
modules, so every file injecting them re-triggered the chain — removing the registrations alone would not have
been enough.

The fix keeps the DI seams and drops only the transports:

- `shared/copilotApiService.ts` is now a barrel over the new `shared/copilotApiTypes.ts`, which holds the
  `ICopilotApiService` decorator, its interface, the request/telemetry types, `CopilotApiError`,
  `COPILOT_API_ERROR_STATUS_STREAMING` and the `UTILITY_DEFAULT_*` constants. It imports nothing from the
  Copilot packages, so every existing importer (utility model service, branch-name generator, proxy error
  mapping, telemetry) keeps working unchanged. `CCAModel` is declared locally — a type-only import of the
  package would not survive into the runtime graph, but keeping the file free of the package entirely is the
  invariant this patch guarantees.
- `shared/copilotApiServiceImpl.ts` receives the `CopilotApiService` class and keeps its
  `@vscode/copilot-api` import. Nothing imports it in this build, so it is dead code that still type-checks;
  it is the place to restore the backend if the packages ever return.
- `copilot/localModelBridge/localModelSetupTypes.ts` holds the `ILocalModelSetupService` decorator, interface
  and `NullLocalModelSetupService`; `localModelSetupService.ts` re-exports it for the existing test, and the
  concrete `LocalModelSetupService` stays where it is.
- `shared/noCopilotServices.ts` provides `NoCopilotApiService` (every method rejects with
  `"[agentHost] <method> is unavailable: this build ships without the Copilot API."`) and
  `NoLocalModelSetupService`. `agentHostServices.ts` registers those two instead of the Copilot-backed pair;
  `IAgentHostHostServiceInputs.localModel` is left in place so callers did not have to change.

Verification: patch applies cleanly to `1.143.1 + 52..56 + 61`; `tsc -p src/tsconfig.json` produces the exact
same 591 pre-existing errors (missing `electron` typings and the removed Copilot/Claude/Codex sources) before
and after the patch, and none in the touched files.

## 61 — build script adaptations, replacing patch-vscode.py (2026-10-27)

`build/patch-vscode.py` did seven anchor replacements with a `str.replace()`; six of them are
code edits and are now `61-build-source-adaptations.patch` (the seventh, the `product.json`
merge, moved into `apply-patches.sh` as a JSON merge, which cannot be expressed as a stable
text patch because upstream rewrites that file every release). Contents:

- `build/npm/dirs.ts` — filter out extension directories removed by 52 before `npm ci`.
- `build/gulpfile.extensions.ts` / `build/lib/extensions.ts` — compile/media only for
  tsconfigs and scripts that still exist after 52.
- `build/lib/copilot.ts` — missing Copilot SDK directory is a warning, not a throw.
- `build/gulpfile.vscode.ts` — skip AppX packaging when `win32ContextMenu` is absent; treat a
  missing `signtool.exe` as "unsigned" instead of rejecting.
- `build/lib/builtInExtensions.ts` — always fetch built-in extensions from their GitHub
  releases. The gallery in `product.json` is Open VSX, which does not host the
  `ms-vscode.js-debug*` packages; without this branch the build fails or silently ships no
  debugger.

Every replacement stays anchor-asserted: `apply-patches.sh` runs each listed patch through
`git apply --check` first, so an upstream drift fails the build instead of silently producing
a half-patched tree.

## Build order reminder

52 alone removes the providers' sources, so a full compile FAILS until 53 (reference
cleanup) is applied too, and the agent host only starts once 57 replaces the Copilot-backed
services. All six entries are in `apply-list.txt` and run in CI order
`product.json merge → 52 → 53 → 54 → 55 → 56 → 57 → 61`.

## Why Picket Code disables the node compile cache (54)

Upstream `vscode-<plat>-<arch>-min` ends with the `-min-ci` task, whose win32
`generateNodeCompileCacheTask` launches node to pre-warm `node-compile-cache` inside
`user-data`. On Windows runners this repeatedly failed with `EBUSY: resource busy or
locked, unlink .../user-data/...` (runner AV / handle timing), e.g. run #16
`vscode-cache-SKmlQf/user-data/Network/Cookies`, `vscode-cache-GedyPu/user-data/Shared
Dictionary/db-journal`. VSCodium does NOT patch `shouldGenerateNodeCompileCache`
(checked its master patches, 2026-10-23); it keeps the upstream logic and its own
runner does not trip the same lock. Picket Code opts out deliberately: the caches are
nondeterministic build output, contradicting the reproducibility goal in
`docs/design.md` (byte-level-approximate rebuilds), and Picket Code ships no quality
channel that would consume them.
