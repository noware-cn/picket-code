# Picket WSL：官方扩展互斥、数据接管与服务器最低版本 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Picket Code 在官方 Remote-WSL 扩展存在时硬禁用 WSL 功能、可一键卸载且不删数据，并接管官方留下的全部数据面；同时把 `picket-code-server` 的版本改成独立演进、客户端只要求最低版本。

**Architecture:** 扩展侧新增三个纯逻辑模块（`official.js` 闸门、`version.js` 版本选择、`product.js` 读取构建盖章），由一个 `activate()` 内的单点分支决定是否注册 resolver/树/业务命令；数据面从私有的 `~/.picket-code-server` 切到与官方共用的 `~/.vscode-server`；构建链把"客户端 tag == 服务器 tag"改成"组件带 commit + semver，客户端要求 commit 相等且版本不低于最低值"。

**Tech Stack:** Node 24（扩展运行在 Windows 侧扩展宿主）、`node --test`、CommonJS、`vscode` 扩展 API（`resolvers`、`contribViewsRemote` proposal）、bash + Node 的构建脚本、GitHub Actions。

**Spec:** `docs/superpowers/specs/2026-11-05-wsl-official-compat-design.md`

## Global Constraints

- 编译：`cd vscode && npm run transpile-client`。**禁止** `npm run build-fast`（硬读已删除的 `extensions/copilot/package.json`）、`npm run compile`（连带 `compile-copilot` 失败）、`tsc -p src/tsconfig.json`（OOM，机器 15.7 GB）。
- 扩展侧类型门禁：`bash build/wsl/gate.sh`（`checkJs` 走 `vscode/extensions/picket-remote-wsl/tsconfig.json`）。
- 扩展单测：`node --test "test/*.test.js"`（Node 26 不接受目录参数）；构建脚本单测：`node --test "test/*.test.mjs"`（在 `build/wsl/` 下）。
- `vscode/extensions/picket-remote-wsl/src/*.js` **不得** `require('vscode')`（`test/manifest.test.js:49-58` 强制）；一切 `vscode` 能力通过 `extension.js` 注入。
- 不新增运行时依赖（semver 比较自写）。
- 发行版内路径一律 POSIX；只有 `.wslconfig` 与卸载命令涉及 Windows 侧。
- 网络：`HTTPS_PROXY=http://127.0.0.1:7892 NODE_USE_ENV_PROXY=1`。
- 补丁：任何 `vscode/` 改动都要重新导出 `build/patches/67-picket-remote-wsl.patch`，基准是 `vscode/` 内的基线提交，导出前先看 `git status --short`。
- 每个 Task 结束：`bash build/wsl/gate.sh` 全绿 → 提交 → 导补丁 → `git apply -R --check` → 主仓提交。
- 命令文案：现有 15 条为 5 英 10 中，新增命令用中文标题并补英文 `description`。

## Review Focus

1. **官方扩展是内置扩展**（`extensionPath` 在 `<appRoot>/extensions/` 下）时，卸载命令抛"内置扩展不能卸载"——期望给出解释与"用我们的 WSL"指引，而不是崩溃或静默失败。
2. **`~/.vscode-server/bin/<40 位 hex>` 已存在**（官方装过同版本）——期望我们只写 `bin/picket-*`，不读、不复用、不删它。
3. **共用 `~/.vscode-server/extensions` 里存在与本构建 VS Code 版本不兼容的远程扩展**——期望连接照常建立，加载失败只出现在扩展宿主日志与诊断的 `Extensions` 段，不阻塞窗口。
4. **`wsl+` authority 的大小写变体**（`wsl+ubuntu` vs 发行版真名 `Ubuntu`）——期望 `getCanonicalURI` 归一后是同一个工作区身份，不产生两份 workspaceStorage。
5. **catalog 里最高版本低于 `minVersion`**（构建漏盖章）——期望连接前明确报错 `catalog offers X, requires >= Y`，不下载、不静默降级。

---

### Task 1: 数据根切到 `~/.vscode-server`

**Files:**
- Modify: `vscode/extensions/picket-remote-wsl/src/launch.js:29-45`（`serverPaths`）
- Modify: `vscode/extensions/picket-remote-wsl/src/components.js:33`（`payloadRoot`）
- Modify: `vscode/extensions/picket-remote-wsl/src/diagnose.js`（新增 `Legacy data` 段）
- Modify: `build/product.json:89-90`（`serverDataFolderName`）
- Test: `vscode/extensions/picket-remote-wsl/test/launch.test.js`、`test/components.test.js`、`test/diagnose.test.js`

**Interfaces:**
- Produces: `serverPaths(home: string, version: string) → { root, payloadDir, binary, node, remoteCli, cliLink, dataDir, extensionsDir, stateDir, runtimeDir, envSetupFile }`
  - `root = <home>/.vscode-server`，`payloadDir = <root>/bin/picket-<version>`，`dataDir = <root>/data`，`extensionsDir = <root>/extensions`，`envSetupFile = <root>/server-env-setup`，`stateDir = <home>/.picket-code-server`，`runtimeDir = <stateDir>/runtime`
- Consumes: 无

- [ ] **Step 1: 写失败测试**

在 `test/launch.test.js` 新增：

```js
test('server paths live under the shared .vscode-server root', () => {
	const paths = serverPaths('/home/u', '1.2.0');
	assert.equal(paths.root, '/home/u/.vscode-server');
	assert.equal(paths.payloadDir, '/home/u/.vscode-server/bin/picket-1.2.0');
	assert.equal(paths.binary, '/home/u/.vscode-server/bin/picket-1.2.0/bin/picket-code-server');
	assert.equal(paths.dataDir, '/home/u/.vscode-server/data');
	assert.equal(paths.extensionsDir, '/home/u/.vscode-server/extensions');
	assert.equal(paths.envSetupFile, '/home/u/.vscode-server/server-env-setup');
	assert.equal(paths.stateDir, '/home/u/.picket-code-server');
	assert.equal(paths.runtimeDir, '/home/u/.picket-code-server/runtime');
});
```

在 `test/components.test.js` 新增：

```js
test('payloads install into the shared bin directory', async () => {
	const manager = createComponentManager({ catalog, runner, distro: 'Ubuntu', home: '/home/u', env: {} });
	assert.equal(manager.payloadRoot, '/home/u/.vscode-server/bin');
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd vscode/extensions/picket-remote-wsl && node --test "test/launch.test.js" "test/components.test.js"`
Expected: FAIL，`serverPaths` 仍返回 `.picket-code-server` 路径，`manager.payloadRoot` 为 `undefined`。

- [ ] **Step 3: 实现**

`launch.js` 的 `serverPaths` 按 Interfaces 改写（保持返回对象的字段名不变，新增 `stateDir`）。`components.js` 把 `payloadRoot` 计算为 `` `${home}/.vscode-server/bin` ``，并把目录名从 `server-<version>` 改为 `picket-<version>`；`inspect`、`ensure`、`cleanup`、`list` 里所有拼目录的位置同步。`stopServer` 的 `pkill -f "--user-data-dir=<dataDir>"` 参数自然跟随。

`build/product.json` 的 `serverDataFolderName` 改为 `".vscode-server"`。

`diagnose.js` 在 `Components` 段之后新增一段：

```js
await section('Legacy data', async () => {
	const legacy = `${paths.stateDir}/payloads`;
	const listing = await runner.exec(['-d', distro, '-e', 'sh', '-c', 'du -sh "$1" 2>/dev/null || true', 'sh', legacy]);
	return String(listing.stdout).trim() || 'none';
});
```

- [ ] **Step 4: 跑测试**

Run: `cd vscode/extensions/picket-remote-wsl && node --test "test/*.test.js"` 与 `bash build/wsl/gate.sh`
Expected: 全绿（既有断言里所有 `server-<version>` 与 `.picket-code-server` 路径已同步改）。

- [ ] **Step 5: 提交**

```bash
cd vscode && git add -A extensions/picket-remote-wsl && git commit -m "feat(wsl): share the official server data root"
cd .. && git add build/product.json && git commit -m "feat(product): use .vscode-server as the server data folder"
```

---

### Task 2: catalog schema v2 与版本选择算法

**Files:**
- Create: `vscode/extensions/picket-remote-wsl/src/version.js`
- Create: `vscode/extensions/picket-remote-wsl/src/product.js`
- Modify: `vscode/extensions/picket-remote-wsl/src/catalog.js:15-72`
- Modify: `vscode/extensions/picket-remote-wsl/extension.js:20-21`（激活日志）
- Modify: `vscode/extensions/picket-remote-wsl/src/diagnose.js:53-58`
- Test: `vscode/extensions/picket-remote-wsl/test/version.test.js`（新建）、`test/catalog.test.js`、`test/diagnose.test.js`

**Interfaces:**
- Produces:
  - `parseVersion(text: string) → number[] | undefined`（接受 `1.2.3`，忽略 `-` 之后的预发布标签）
  - `compareVersions(a: string, b: string) → -1 | 0 | 1`（任一侧不可解析时抛 `TypeError`）
  - `selectComponent(catalog, { commit, minVersion }) → { component } | { error: 'no-commit' | 'below-min' | 'none', offered?: string }`
  - `readProduct(appRoot: string) → Promise<{ commit: string, version: string, picketServerMinVersion: string }>`
  - `ICatalogComponent` 增加 `commit: string`；`ICatalog` 的 `tag` 换成 `minVersion: string`，新增 `schema: 2`
  - `createComponentManager(...)` 的返回对象新增 `payloadRoot: string`（供测试与服务端断言共用）
- Consumes: Task 1 的 `serverPaths`

- [ ] **Step 1: 写失败测试**

`test/version.test.js`：

```js
test('compares semver numerically, not lexically', () => {
	assert.equal(compareVersions('1.10.0', '1.9.0'), 1);
	assert.equal(compareVersions('1.2.0', '1.2.0'), 0);
	assert.equal(compareVersions('1.2.0', '1.2.1'), -1);
});

test('picks the highest component for the same commit', () => {
	const result = selectComponent(catalogOf(['1.0.0', '1.4.0', '1.2.0']), { commit: 'abc', minVersion: '1.1.0' });
	assert.equal(result.component.version, '1.4.0');
});

test('refuses a catalog whose highest version is below the minimum', () => {
	const result = selectComponent(catalogOf(['1.0.0']), { commit: 'abc', minVersion: '1.1.0' });
	assert.deepEqual(result, { error: 'below-min', offered: '1.0.0' });
});

test('refuses when no component matches the client commit', () => {
	const result = selectComponent(catalogOf(['1.0.0'], 'other'), { commit: 'abc', minVersion: '1.0.0' });
	assert.deepEqual(result, { error: 'no-commit' });
});

test('an empty catalog is not an error the caller can paper over', () => {
	assert.deepEqual(selectComponent({ schema: 2, flavor: 'ondemand', minVersion: '1.0.0', components: [] },
		{ commit: 'abc', minVersion: '1.0.0' }), { error: 'none' });
});
```

`test/catalog.test.js` 增加：缺 `commit` 的组件被丢弃（沿用"不合格即丢弃"语义）。

- [ ] **Step 2: 运行确认失败**

Run: `cd vscode/extensions/picket-remote-wsl && node --test "test/version.test.js"`
Expected: FAIL，`Cannot find module '../src/version.js'`。

- [ ] **Step 3: 实现**

`src/version.js`：三段比较（`split('.')` 后逐位 `Number`，长度不等时补 0），`selectComponent` 按 Spec §5.2 的四步。`src/version.js` 不 require 任何东西。

`src/catalog.js`：`normalizeComponent` 增加 `commit` 必须匹配 `^[0-9a-f]{40}$`；`ICatalog` 用 `minVersion` 替换 `tag`，`schema` 必须等于 `2`，否则返回空 catalog（沿用降级语义）。

`src/product.js`：

```js
async function readProduct(appRoot) {
	const raw = JSON.parse(await fs.readFile(join(appRoot, 'product.json'), 'utf8'));
	return { commit: String(raw.commit ?? ''), version: String(raw.version ?? ''), picketServerMinVersion: String(raw.picketServerMinVersion ?? '') };
}
```

`diagnose.js` 的 `Product tag` 段改为 `Server minimum`（读 `product.picketServerMinVersion`），`extension.js` 的激活日志改为 `catalog=schema-<n>, min=<minVersion>, components=<n>`。

`catalog.tag` 的每一个消费者都要跟着换到"选中组件的 version"（跑 `grep -rn "catalog\.tag\|catalog?.tag\|catalog?\.tag" vscode/extensions/picket-remote-wsl build/wsl` 逐个处理），已知有：`commands.js:372-403`（`installCli` 的 shim 路径）、`commands.js` 里传递 `catalog.tag` 的调用、`offline.js`（离线包版本比对）、`build/wsl/acceptance.sh:143-170`（staged catalog 与 authority）。选中逻辑统一走 `selectComponent(catalog, { commit: product.commit, minVersion: product.picketServerMinVersion })`，取不到就按错误分支给出可执行消息。

- [ ] **Step 4: 跑测试**

Run: `cd vscode/extensions/picket-remote-wsl && node --test "test/*.test.js"`
Expected: PASS（`version.test.js` 5 例 + 既有全部）。

- [ ] **Step 5: 提交**

```bash
cd vscode && git add -A extensions/picket-remote-wsl && git commit -m "feat(wsl): select the server component by commit and minimum version"
```

---

### Task 3: 组件状态机与 resolver 复用改用最低版本语义

**Files:**
- Modify: `vscode/extensions/picket-remote-wsl/src/components.js:76-196`
- Modify: `vscode/extensions/picket-remote-wsl/src/resolver.js:62-68,157-191,231-242`
- Modify: `vscode/extensions/picket-remote-wsl/src/payload.js:216`
- Modify: `vscode/extensions/picket-remote-wsl/extension.js:59-79`（把 `product` 注入 resolver 与 components）
- Test: `test/components.test.js`、`test/resolver.test.js`、`test/payload.test.js`

**Interfaces:**
- Consumes: `selectComponent`、`readProduct`（Task 2）
- Produces:
  - `inspect(component) → { state: 'installed'|'outdated'|'incompatible'|'broken'|'absent', version?: string, candidateVersion?: string }`
  - `createComponentManager({ catalog, runner, distro, home, env, download, product })`（新增 `product: { commit, picketServerMinVersion }`）
  - `createResolver({ runner, catalog, settings, log, warn, components, product })`
  - `IRuntimeInfo` 增加 `version: string`、`commit: string`（`tag` 字段删除）

- [ ] **Step 1: 写失败测试**

`test/components.test.js`：

```js
test('an older installed payload that still meets the minimum is reused', async () => {
	seedPayload(fs, { version: '1.1.0', commit: 'abc' });
	const manager = createComponentManager({ catalog: catalogOf(['1.4.0'], 'abc'), runner, distro: 'Ubuntu', home: '/home/u', env: {}, product: { commit: 'abc', picketServerMinVersion: '1.0.0' } });
	assert.equal(manager.inspect(catalog.components[0]).state, 'installed');
	assert.equal(manager.inspect(catalog.components[0]).version, '1.1.0');
});

test('a payload below the minimum is reported outdated with the newest candidate', async () => {
	seedPayload(fs, { version: '0.9.0', commit: 'abc' });
	/* … */
	assert.deepEqual(manager.inspect(component), { state: 'outdated', candidateVersion: '1.4.0' });
});

test('a payload for another commit is incompatible, never reused', async () => {
	seedPayload(fs, { version: '1.4.0', commit: 'other' });
	assert.equal(manager.inspect(component).state, 'incompatible');
});
```

`test/resolver.test.js`：

```js
test('reuses a running server above the minimum even when the catalog moved on', async () => {
	await writeRuntimeRecord({ version: '1.1.0', commit: 'abc', port: 1234, token: 't' });
	const result = await resolver.resolve('Ubuntu');
	assert.equal(result.port, 1234);
	assert.equal(startCalls.length, 0);
});

test('discards a running server whose version fell below the minimum', async () => {
	await writeRuntimeRecord({ version: '0.9.0', commit: 'abc', port: 1234, token: 't' });
	await resolver.resolve('Ubuntu');
	assert.equal(stopCalls.length, 1);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test "test/components.test.js" "test/resolver.test.js"`
Expected: FAIL，`installed` 仍是精确相等语义，复用判定仍比较 `tag`。

- [ ] **Step 3: 实现**

`inspect` 按 Spec §5.3 的表格实现：扫描 `payloadRoot/picket-*`，逐个读 `.picket-payload.json`；`usable = marker.commit === product.commit && compareVersions(marker.version, product.picketServerMinVersion) >= 0 && marker.sha256`。取最高 usable → `installed`；否则有同 commit 目录 → `outdated`（`candidateVersion` = 同 commit 里最高）；否则有目录 → `incompatible`；无目录 → `absent`；marker 存在但读不出来 → `broken`。

`ensure` 改为：`installed` 复用，其余走 `chooseSource` + `installPayload`（`payload.js:216` 的目录名改 `picket-<version>`，marker 写 `{version, commit, sha256}`）。

`resolver`：`serverVersion()` 改成 `selectComponent(catalog, { commit: product.commit, minVersion: product.picketServerMinVersion })`，`error` 分支各自抛可执行消息（`no-commit` 提示构建不匹配、`below-min` 带上 `offered` 与要求值）。复用判定：`stored.commit === product.commit && compareVersions(stored.version, product.picketServerMinVersion) >= 0`；`waitForServer` 同条件。

`extension.js` 在 `activate()` 里 `const product = await readProduct(vscode.env.appRoot)`，随 `createComponents` 与 `createResolver` 传下去。

- [ ] **Step 4: 跑测试**

Run: `node --test "test/*.test.js"` 与 `bash build/wsl/gate.sh`
Expected: 全绿。

- [ ] **Step 5: 提交**

```bash
cd vscode && git add -A extensions/picket-remote-wsl && git commit -m "feat(wsl): reuse any server payload that still meets the minimum version"
```

---

### Task 4: 构建与发行链改用最低版本

**Files:**
- Modify: `build/wsl/lib/common.mjs:13-15`（`payloadName(version)`）
- Modify: `build/wsl/assemble.mjs:19-90`
- Modify: `build/wsl/check.mjs:51-97`
- Modify: `build/wsl/offline-bundle.mjs:37-61`
- Modify: `build/wsl/fetch-payload.sh`（参数与 catalog 写入）
- Modify: `build/build.sh:97-121`
- Modify: `build/win32/package.sh:77-78`、`build/linux/package.sh:53-54`
- Modify: `.github/workflows/release.yml:21-33,206-216`
- Test: `build/wsl/test/assemble.test.mjs`、`check.test.mjs`、`offline-bundle.test.mjs`

**Interfaces:**
- Consumes: catalog schema v2（Task 2）
- Produces:
  - `assemble.mjs --app <dir> --min-version <semver> [--version <semver>] [--commit <40hex>] --flavor … [--payload …] [--sums …] [--size …]`
  - `check.mjs --app <dir> --flavor <flavor> [--max-embedded-mb 110]`
  - `fetch-payload.sh <server-version> [--metadata-only]`
  - `payloadName(version) → picket-code-server-<version>-linux-x64.tar.gz`

- [ ] **Step 1: 写失败测试**

`build/wsl/test/assemble.test.mjs`：

```js
test('stamps the minimum version and the commit, not a tag', async () => {
	await run(['--app', app, '--min-version', '1.0.0', '--version', '1.4.0', '--commit', 'a'.repeat(40), '--flavor', 'ondemand', '--sums', sums, '--size', '42']);
	const product = await readJson(join(app, 'product.json'));
	assert.equal(product.picketServerMinVersion, '1.0.0');
	assert.equal(product.picketTag, undefined);
	const catalog = await readJson(join(app, 'extensions/picket-remote-wsl/payloads/catalog.json'));
	assert.equal(catalog.schema, 2);
	assert.equal(catalog.components[0].version, '1.4.0');
	assert.equal(catalog.components[0].commit, 'a'.repeat(40));
});
```

`build/wsl/test/check.test.mjs`：

```js
test('a catalog whose highest version is below the minimum fails the build', async () => {
	await writeCatalog(app, { schema: 2, minVersion: '1.0.0', components: [component({ version: '0.9.0' })] });
	await assert.rejects(runCheck(app), /catalog offers 0\.9\.0, requires >= 1\.0\.0/);
});

test('a catalog for another commit fails the build', async () => {
	await writeCatalog(app, { schema: 2, minVersion: '1.0.0', components: [component({ commit: 'b'.repeat(40) })] });
	await assert.rejects(runCheck(app), /no server component for commit/);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd build/wsl && node --test "test/*.test.mjs"`
Expected: FAIL，`--min-version` 未知参数、`catalog.tag` 仍被断言。

- [ ] **Step 3: 实现**

按 Interfaces 改参数与盖章位置；`check.mjs` 把 `catalog.tag === product.picketTag` 换成 Spec §5.8 的五条断言（schema、semver、commit 匹配且 ≥ min、`catalog.minVersion === product.picketServerMinVersion`、flavor/embedded/ondemand 既有规则）。`fetch-payload.sh` 的资产名与 catalog 写入同步（`schema: 2`、`commit` 从第 4 个参数或 `PICKET_SERVER_COMMIT` 取）。`build.sh` 必填 `PICKET_SERVER_MIN_VERSION`，`PICKET_SERVER_VERSION` 缺省取它，`commit` 从 `APP_DIR/product.json` 读。

`release.yml`：workflow 级 env 换成 `PICKET_SERVER_MIN_VERSION: ${{ vars.PICKET_SERVER_MIN_VERSION }}` 与 `PICKET_SERVER_VERSION: ${{ vars.PICKET_SERVER_VERSION }}`；win32 的 `fetch-payload.sh`/`offline-bundle.mjs` 传 `$PICKET_SERVER_VERSION`；新增一步"两个变量都非空，否则 exit 1"。

- [ ] **Step 4: 跑测试**

Run: `cd build/wsl && node --test "test/*.test.mjs"` 与 `bash ../../build/wsl/gate.sh`（在仓库根：`bash build/wsl/gate.sh`）
Expected: 全绿。

- [ ] **Step 5: 提交**

```bash
git add build/wsl build/build.sh build/win32/package.sh build/linux/package.sh .github/workflows/release.yml
git commit -m "feat(build): pin the WSL server by minimum version and commit"
```

---

### Task 5: `picket-code-server` 仓库的版本独立发布

**Files:**
- Modify（另一仓库）: `noware-cn/picket-code-server:.github/workflows/release-server.yml`
- Create: `docs/wsl-server-releases.md`

**Interfaces:**
- Produces: 资产名 `picket-code-server-<version>-linux-x64.tar.gz`、`picket-code-server-<version>-SHA256SUMS`；release tag `server-v<version>`

- [ ] **Step 1: 写文档（测试即文档里的命令可执行）**

`docs/wsl-server-releases.md` 写清：`workflow_dispatch` 的 `tag`（决定源码，必须是 `dantesun/picket-code` 上存在的 tag）与 `version`（默认 `1.0.0`）两个输入；同一 `tag` 可以发多个 `version`；客户端通过 `PICKET_SERVER_MIN_VERSION` 挑最低要求。给出实跑命令：

```bash
gh workflow run release-server.yml -R noware-cn/picket-code-server \
  -f tag=v1.143.1-picket.1-rc.6 -f version=1.0.0
```

- [ ] **Step 2: 改 workflow 并验证脚本化部分**

`release-server.yml` 的 `inputs` 增加 `version`（`required: true`, 默认 `1.0.0`）；`env.TAG` 保留为源码 tag，新增 `env.VERSION: ${{ inputs.version || '1.0.0' }}`；产物重命名与 release 上传改用 `VERSION`；release tag 改成 `server-v$VERSION`。仓库内的步骤在本地用 `act` 跑不动，验证方式是 `gh workflow view` 与一次真实 dispatch（用户授权后执行）。

- [ ] **Step 3: 交叉验证**

在 `picket-code` 侧 `build/wsl/fetch-payload.sh 1.0.0` 能从 `server-v1.0.0` 取到三件资产（`payload`、`SHA256SUMS`、`size`）。

Run: `HTTPS_PROXY=http://127.0.0.1:7892 NODE_USE_ENV_PROXY=1 bash build/wsl/fetch-payload.sh 1.0.0 --metadata-only`
Expected: `payload staged in build/wsl/download`。

- [ ] **Step 4: 提交**

```bash
git add docs/wsl-server-releases.md
git commit -m "docs(wsl): document independent server versioning and how to cut a payload"
```

---

### Task 6: `remote.WSL.*` 设置兼容层

**Files:**
- Create: `vscode/extensions/picket-remote-wsl/src/settings.js`
- Modify: `vscode/extensions/picket-remote-wsl/package.json`（`contributes.configuration` 新增 `picket.wsl.shell`：enum `login|none`，默认 `login`）
- Modify: `vscode/extensions/picket-remote-wsl/extension.js:30-39`（settings 组装：`shell` 与 `resolveSettings` 的读取器）
- Modify: `vscode/extensions/picket-remote-wsl/src/launch.js:61-71`（`loginShell`）
- Modify: `vscode/extensions/picket-remote-wsl/src/resolver.js:222-242`（探活总超时）
- Test: `test/settings.test.js`（新建）、`test/launch.test.js`、`test/resolver.test.js`

**Interfaces:**
- Produces:
  - `resolveSettings({ readPicket, readOfficial }) → { loginShell: boolean, probeTimeoutMs: number }`
    - `loginShell`：`readOfficial('remote.WSL.useShellEnvironment') !== false`
    - `probeTimeoutMs`：`readOfficial('remote.WSL.serverProbeRetryTimeout')`（秒）× 1000，缺省 `60000`，钳到 `[0, 300000]`
  - `buildServerArgs({ …, loginShell })` 用 `sh -lc` 或 `sh -c`
- Consumes: 无

- [ ] **Step 1: 写失败测试**

```js
test('an explicit Picket setting wins over the official one', () => {
	const s = resolveSettings({ readPicket: (k) => ({ shell: 'none' })[k], readOfficial: () => true });
	assert.equal(s.loginShell, false);
});

test('the official useShellEnvironment=false is honoured', () => {
	assert.equal(resolveSettings({ readPicket: () => undefined, readOfficial: (k) => ({ 'remote.WSL.useShellEnvironment': false })[k] }).loginShell, false);
});

test('the official probe timeout is read in seconds and clamped', () => {
	assert.equal(resolveSettings({ readPicket: () => undefined, readOfficial: (k) => ({ 'remote.WSL.serverProbeRetryTimeout': 30 })[k] }).probeTimeoutMs, 30000);
	assert.equal(resolveSettings({ readPicket: () => undefined, readOfficial: () => 0 }).probeTimeoutMs, 0);
	assert.equal(resolveSettings({ readPicket: () => undefined, readOfficial: () => 9e9 }).probeTimeoutMs, 300000);
});
```

`test/launch.test.js`：`buildServerArgs({ ..., loginShell: false })` 的第 4 个参数是 `-c`，为 `true` 时是 `-lc`。

- [ ] **Step 2: 运行确认失败**

Run: `node --test "test/settings.test.js"`
Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现**

按 Interfaces 实现 `src/settings.js`（纯函数，参数注入读取器）。`extension.js` 的 `settings` 增加 `shell`（读 `picket.wsl.shell`，取值 `login|none`，缺省 `login`）与既有 `probeRetrySeconds`；`resolver` 用 `resolveSettings` 的结果替换硬编码的 `3000` 探活总时长；`launch.js` 的 `buildServerArgs` 接收 `loginShell`。

- [ ] **Step 4: 跑测试**

Run: `node --test "test/*.test.js"` 与 `bash build/wsl/gate.sh`
Expected: 全绿。

- [ ] **Step 5: 提交**

```bash
cd vscode && git add -A extensions/picket-remote-wsl && git commit -m "feat(wsl): honour the official remote.WSL settings we implement"
```

---

### Task 7: 认领 `wsl+` authority

**Files:**
- Modify: `vscode/extensions/picket-remote-wsl/src/remoteUri.js:5-26`
- Modify: `vscode/extensions/picket-remote-wsl/extension.js:81-87`（注册两个前缀 + `getCanonicalURI`）
- Modify: `vscode/extensions/picket-remote-wsl/package.json:243-254`（formatters）
- Modify: `vscode/extensions/picket-remote-wsl/src/resolver.js:283-294`（嵌套拒绝、发行版归一）
- Test: `test/remoteUri.test.js`、`test/resolver.test.js`

**Interfaces:**
- Produces:
  - `LEGACY_AUTHORITY_PREFIX = 'wsl'`
  - `parseAuthority(authority) → { prefix, distro } | undefined`；`distro === ''` 表示默认发行版（`default` 与空前缀都归一为 `''`）
  - `canonicalAuthority(prefix, distro) → string`
  - `resolver.resolveDistro(authority) → Promise<string>`（大小写不敏感匹配到 `wsl --list` 的规范名）
- Consumes: Task 1 的 `serverPaths`

- [ ] **Step 1: 写失败测试**

```js
test('parses the legacy prefix and the default alias', () => {
	assert.deepEqual(parseAuthority('wsl+Ubuntu'), { prefix: 'wsl', distro: 'Ubuntu' });
	assert.deepEqual(parseAuthority('wsl+default'), { prefix: 'wsl', distro: '' });
	assert.deepEqual(parseAuthority('wsl'), { prefix: 'wsl', distro: '' });
	assert.equal(parseAuthority('ssh-remote+host'), undefined);
});

test('a nested exec-server authority is rejected with a readable error', async () => {
	await assert.rejects(resolver.resolveDistro('Ubuntu@7b22686f73744e616d65223a2278227d'), /nested authorities are not supported/);
});

test('an unknown distro lists what is available', async () => {
	await assert.rejects(resolver.resolveDistro('Debian'), /Ubuntu/);
});

test('the canonical URI normalises the distro case', () => {
	assert.equal(canonicalAuthority('wsl', 'Ubuntu'), 'wsl+Ubuntu');
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test "test/remoteUri.test.js" "test/resolver.test.js"`
Expected: FAIL，`parseAuthority` 只认 `picket-wsl`。

- [ ] **Step 3: 实现**

`remoteUri.js` 按 Interfaces 实现（`default`/空串 → `''`；含 `@` 时返回 `distro` 原文，由 resolver 拒绝）。`extension.js` 对 `[AUTHORITY_PREFIX, LEGACY_AUTHORITY_PREFIX]` 各注册一次 resolver，两个都带 `getCanonicalURI`：

```js
getCanonicalURI: (authority) => canonicalAuthority(prefix, parseAuthority(authority)?.distro ?? '')
```

`resolver` 新增 `resolveDistro`：`listDistros` 后 `toLowerCase()` 匹配；空 distro 取 `settings.defaultDistro || 默认发行版`；找不到时错误里列出可见发行版。`package.json` 的 `resourceLabelFormatters` 增加 `authority: "wsl+*"` 一条。

- [ ] **Step 4: 跑测试**

Run: `node --test "test/*.test.js"` 与 `bash build/wsl/gate.sh`
Expected: 全绿。

- [ ] **Step 5: 提交**

```bash
cd vscode && git add -A extensions/picket-remote-wsl && git commit -m "feat(wsl): resolve wsl+ authorities left behind by the official extension"
```

---

### Task 8: 互斥闸门与产品级撤权

**Files:**
- Create: `vscode/extensions/picket-remote-wsl/src/official.js`
- Modify: `vscode/extensions/picket-remote-wsl/extension.js:16-182`（单点分支）
- Modify: `vscode/extensions/picket-remote-wsl/package.json:105-166`（`when: !picketWsl.blocked`）
- Modify: `vscode/extensions/picket-remote-wsl/src/tree.js`（blocked 节点）
- Modify: `build/product.json:24-35`（删除官方扩展 proposal）
- Modify: `build/check-contract.sh:81-93`
- Test: `test/official.test.js`（新建）、`test/manifest.test.js`、`test/tree.test.js`

**Interfaces:**
- Produces:
  - `OFFICIAL_EXTENSION_ID = 'ms-vscode-remote.remote-wsl'`
  - `createOfficialGate({ extensions }) → { evaluate(), get blocked(), onChange(cb), dispose() }`，`extensions` 形如 `vscode.extensions`（只用到 `get(id)` 与 `onDidChange(cb)`）
  - `buildBlockedNode() → 单个树节点 { label: '已禁用：检测到官方 Remote-WSL 扩展', command: 'picket.wsl.uninstallOfficial' }`
- Consumes: 无

- [ ] **Step 1: 写失败测试**

```js
test('an installed official extension blocks everything, enabled or not', () => {
	const gate = createOfficialGate({ extensions: { get: (id) => id === OFFICIAL_EXTENSION_ID ? { id, isActive: false } : undefined, onDidChange: () => ({ dispose() { } }) } });
	assert.deepEqual(gate.evaluate(), { blocked: true, installed: true });
});

test('nothing installed means nothing blocked', () => {
	const gate = createOfficialGate({ extensions: { get: () => undefined, onDidChange: () => ({ dispose() { } }) } });
	assert.equal(gate.evaluate().blocked, false);
});

test('installing it while the window is open flips the gate', async () => {
	const listeners = [];
	let installed = false;
	const gate = createOfficialGate({ extensions: { get: () => (installed ? { id: OFFICIAL_EXTENSION_ID } : undefined), onDidChange: (cb) => { listeners.push(cb); return { dispose() { } }; } } });
	const seen = [];
	gate.onChange((state) => seen.push(state.blocked));
	installed = true;
	listeners.forEach((cb) => cb());
	assert.deepEqual(seen, [true]);
});
```

`test/manifest.test.js`：断言 `extension.js` 里业务命令注册位于 `if (!gate.blocked)` 之内（用既有的正则扫描方式，新增一条对 `gate.blocked` 出现的断言）；`build/check-contract.sh` 增加："`build/product.json` 的 `extensionEnabledApiProposals` 不得含 `ms-vscode-remote.remote-wsl`"。

- [ ] **Step 2: 运行确认失败**

Run: `node --test "test/official.test.js"`
Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现**

`official.js` 按 Interfaces 实现（不 require `vscode`）。`extension.js` 在 `activate()` 开头求值闸门，`context.subscriptions.push(gate)`；`await vscode.commands.executeCommand('setContext', 'picketWsl.blocked', gate.blocked)`；`gate.onChange` 时重设 context、刷新树、必要时重新注册 resolver（用 `vscode.workspace.registerRemoteAuthorityResolver` 返回的 disposable 管理）。

把「注册两个 resolver + 树 provider + `registerCommands` + `maybeNudge`」放进 `if (!gate.blocked)`；`picket.wsl.showLog` 与 `picket.wsl.diagnose` 留在分支外（诊断是排障入口，报告里新增 `Official extension` 段：`installed` / `blocked`）。

同一处给诊断报告加 `Extensions` 段（设计 §5.10 风险表承诺的"接管老数据后远程扩展可能与 `product.version` 引擎不匹配"）：用既有 `runner` 读 `~/.vscode-server/extensions/extensions.json`（结构 `{ extensions: [{ identifier: { id }, version, location: { path }, metadata }] }`），对每个条目读 `<path>/package.json` 的 `engines.vscode`，逐条打印 `id@version  engines=<range>  compatible=<yes|no>`；`no` 的条目在汇总行给一句"这些远程扩展来自官方 server，可能需要重装"。读不到 `extensions.json`（不存在或 JSON 坏）时打一行 `(none)`，不抛错。`productsVersion` 取自 `vscode.env.vscodeVersion`（`extension.js` 注入，`src/*.js` 仍不得 require `vscode`）。

`build/product.json` 删除 `ms-vscode-remote.remote-wsl` 的整个 entry。`build/check-contract.sh` 增加反查断言（防止有人"顺手恢复"）。

- [ ] **Step 4: 跑测试**

Run: `node --test "test/*.test.js"`、`bash build/check-contract.sh`、`bash build/wsl/gate.sh`
Expected: 全绿。

- [ ] **Step 5: 提交**

```bash
cd vscode && git add -A extensions/picket-remote-wsl && git commit -m "feat(wsl): block every WSL feature while the official extension is installed"
cd .. && git add build/product.json build/check-contract.sh && git commit -m "feat(product): revoke the official Remote-WSL API proposals"
```

---

### Task 9: 一键卸载（保留数据）与卸载指南

**Files:**
- Create: `vscode/extensions/picket-remote-wsl/src/uninstall.js`
- Modify: `vscode/extensions/picket-remote-wsl/src/commands.js:454-469`（`COMMANDS` 表）
- Modify: `vscode/extensions/picket-remote-wsl/package.json:27-103`（两条新命令）
- Modify: `vscode/extensions/picket-remote-wsl/extension.js`（注入 `executeCommand`、`env.appRoot`）
- Create: `docs/uninstall-official-remote-wsl.md`
- Test: `test/uninstall.test.js`（新建）、`test/manifest.test.js`

**Interfaces:**
- Produces:
  - `uninstallOfficialExtension({ extensions, executeCommand, appRoot }) → Promise<{ status: 'uninstalled'|'absent'|'builtin'|'failed', message: string }>`
  - 命令 `picket.wsl.uninstallOfficial`、`picket.wsl.uninstallGuide`
- Consumes: `OFFICIAL_EXTENSION_ID`（Task 8）

- [ ] **Step 1: 写失败测试**

```js
test('uninstalling passes nothing but the extension id to the workbench', async () => {
	const calls = [];
	const result = await uninstallOfficialExtension({
		extensions: { get: () => ({ id: OFFICIAL_EXTENSION_ID, extensionPath: 'C:/Users/u/.picket-code/extensions/ms-vscode-remote.remote-wsl-1.104.7' }) },
		executeCommand: async (...args) => { calls.push(args); },
		appRoot: 'C:/Program Files/Picket Code/resources/app'
	});
	assert.deepEqual(calls, [['workbench.extensions.uninstallExtension', OFFICIAL_EXTENSION_ID]]);
	assert.equal(result.status, 'uninstalled');
});

test('a built-in copy is refused without calling the workbench', async () => {
	const calls = [];
	const result = await uninstallOfficialExtension({
		extensions: { get: () => ({ id: OFFICIAL_EXTENSION_ID, extensionPath: 'C:/Program Files/Picket Code/resources/app/extensions/ms-vscode-remote.remote-wsl' }) },
		executeCommand: async (...args) => { calls.push(args); },
		appRoot: 'C:/Program Files/Picket Code/resources/app'
	});
	assert.equal(result.status, 'builtin');
	assert.equal(calls.length, 0);
});

test('already gone is reported as absent, not as an error', async () => {
	assert.equal((await uninstallOfficialExtension({ extensions: { get: () => undefined }, executeCommand: async () => { }, appRoot: '/app' })).status, 'absent');
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test "test/uninstall.test.js"`
Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现**

`uninstall.js` 按 Interfaces 实现（路径判断用 `path.relative(appRoot + '/extensions', extensionPath)` 不以 `..` 开头即视为内置）。`COMMANDS` 增加两条：`uninstallOfficial`（调用后按 status 给提示；`uninstalled` 时提供"重新加载窗口"按钮 `workbench.action.reloadWindow`）、`uninstallGuide`（`vscode.env.openExternal` 打开文档 URL 或用 `showInformationMessage` 展示绝对路径）。

`docs/uninstall-official-remote-wsl.md` 必须写清：GUI 路径（扩展视图搜索 `Remote - WSL` → 卸载）、命令行路径（`picket-code --uninstall-extension ms-vscode-remote.remote-wsl`）、**不会删除**的东西（`~/.vscode-server/{data,extensions,server-env-setup}`、`%APPDATA%\Picket Code\User`、`%USERPROFILE%\vscode-remote-wsl` 下载缓存）、如何确认已卸载、不卸载时会发生什么（功能全禁用）。

- [ ] **Step 4: 跑测试**

Run: `node --test "test/*.test.js"` 与 `bash build/wsl/gate.sh`
Expected: 全绿（`manifest.test.js` 里钉死的业务命令数从 14 改到 16）。

- [ ] **Step 5: 提交**

```bash
cd vscode && git add -A extensions/picket-remote-wsl && git commit -m "feat(wsl): uninstall the official extension in one command, keeping all data"
cd .. && git add docs/uninstall-official-remote-wsl.md && git commit -m "docs(wsl): how to remove the official extension without losing data"
```

---

### Task 10: 验收自动化（冲突、接管、旧 URI）

**Files:**
- Modify: `build/wsl/acceptance.sh:121-170`（stage 与 authority）、新增 `--conflict`、`--takeover`、`--legacy-uri` 阶段
- Modify: `test/wsl-harness/`（冲突注入扩展、预置 `~/.vscode-server` 的 fixture）
- Modify: `.github/workflows/tests-ui.yml:24-36,380-404`（路径过滤与阶段参数）
- Modify: `docs/testing.md:17,101`

**Interfaces:**
- Consumes: 全部前置 Task
- Produces: `acceptance.sh --conflict|--takeover|--legacy-uri`；环境变量 `PICKET_WSL_CONFLICT_ID`（默认 `ms-vscode-remote.remote-wsl`）

- [ ] **Step 1: 写 harness 与断言（先失败）**

`--conflict`：往 `--extensions-dir` 里装一个 id 被 `PICKET_WSL_CONFLICT_ID` 覆盖的假扩展，启动窗口后断言：

```bash
assert_log_contains "picket-wsl" "blocked: official extension installed"
assert_no_log_contains "registerRemoteAuthorityResolver"
assert_window_command_absent "picket.wsl.openFolder"
assert_window_command_present "picket.wsl.uninstallOfficial"
```

`--takeover`：预置 `$HOME/.vscode-server/{data,extensions/extensions.json,server-env-setup}`，连接后断言三件仍在、未被覆盖（比对 mtime 与内容哈希），且 `$HOME/.vscode-server/bin/` 下新增的是 `picket-*` 而不是 40 位 hex。

`--legacy-uri`：用 `vscode-remote://wsl%2B<distro><path>` 打开，断言连上且 `remoteName === 'wsl'`。

- [ ] **Step 2: 运行确认失败**

Run: `bash build/wsl/acceptance.sh --conflict`
Expected: FAIL，未知阶段。

- [ ] **Step 3: 实现**

`acceptance.sh` 增加三个阶段分支与两个断言辅助函数；`tests-ui.yml` 的 `wsl-acceptance` 步骤参数改成 `--all` 加上新阶段，路径过滤补 `docs/uninstall-official-remote-wsl.md` 与 `docs/wsl-server-releases.md`。

- [ ] **Step 4: 跑验收**

Run: `bash build/wsl/acceptance.sh --all`
Expected: 所有阶段 PASS（Linux 桌面 + Xvfb，约 15–20 分钟）。

- [ ] **Step 5: 提交**

```bash
git add build/wsl test/wsl-harness .github/workflows/tests-ui.yml docs/testing.md
git commit -m "test(wsl): cover the conflict gate, the data takeover and legacy wsl+ URIs"
```

---

### Task 11: 文档同步

**Files:**
- Modify: `docs/wsl.md:3-5,19-53,80-93,118-133,142-151,158`
- Modify: `docs/wsl-verification.md`（新增互斥与接管的人工项）
- Modify: `docs/release-checklist.md:21-31,58`
- Modify: `docs/testing.md:17,101,115-121`

**Interfaces:**
- Consumes: 全部前置 Task 的行为

- [ ] **Step 1: 改写 `docs/wsl.md`**

把"不需要官方扩展"改成"与官方扩展互斥，装了必须卸载"，新增三节：与官方扩展的关系（含一键卸载与指南链接）、数据位置（`~/.vscode-server` 共用表）、版本策略（最低版本 + 独立演进，链接 `docs/wsl-server-releases.md`）。

- [ ] **Step 2: 补人工验收项**

`docs/wsl-verification.md` 新增 §5：未卸载官方扩展时功能全禁用（命令面板里搜不到 `Picket: Open Folder in WSL…`）、§6：卸载后旧 `wsl+` 链接直接打开且原有远程扩展与设置仍在。

- [ ] **Step 3: 更新发布清单与测试矩阵**

`docs/release-checklist.md` 把 `PICKET_SERVER_TAG` 的说明换成两个变量（`PICKET_SERVER_MIN_VERSION` 必填、`PICKET_SERVER_VERSION` 打包用）与"服务器可独立发版"的说明；`docs/testing.md` 的 L4+ 行补三个阶段。

- [ ] **Step 4: 校验链接与命令可执行**

Run: `grep -n "PICKET_SERVER_TAG" docs/ build/ .github/ -r` → 只允许出现在 `docs/wsl-server-releases.md` 的历史说明里
Expected: 无其他命中。

- [ ] **Step 5: 提交**

```bash
git add docs && git commit -m "docs(wsl): document the official-extension exclusivity, data takeover and server versioning"
```

---

### Task 12: 集成收尾（补丁重导与门禁）

**Files:**
- Modify: `build/patches/67-picket-remote-wsl.patch`（重新导出）
- Modify: `build/patches/apply-list.txt`（如文件数变化）
- Modify: `build/wsl/gate.sh`（新增对 `official.js`/`version.js`/`uninstall.js` 的覆盖检查，如需要）

- [ ] **Step 1: 全量单测**

Run: `cd vscode/extensions/picket-remote-wsl && node --test "test/*.test.js"`、`cd build/wsl && node --test "test/*.test.mjs"`、`bash build/wsl/gate.sh`、`bash build/check-contract.sh`
Expected: 全绿。

- [ ] **Step 2: 重导补丁**

```bash
cd vscode && git status --short          # 必须干净
git diff wsl-baseline -- extensions/picket-remote-wsl > ../build/patches/67-picket-remote-wsl.patch
cd .. && git apply -R --check build/patches/67-picket-remote-wsl.patch && echo "reverse-check ok"
```

- [ ] **Step 3: 纯净上游验证**

在 `vscode` 上游 tag 的干净 worktree 上跑 `bash build/apply-patches.sh "$PWD"`，确认 52–67 全链应用成功。

- [ ] **Step 4: 全量验收**

Run: `bash build/wsl/acceptance.sh --all`
Expected: 所有阶段 PASS。

- [ ] **Step 5: 提交**

```bash
git add build/patches/67-picket-remote-wsl.patch build/patches/apply-list.txt
git commit -m "build(wsl): re-export patch 67 for the official-extension compat work"
```

---

## 执行说明

- 任务顺序有依赖：T1 → T2 → T3 →（T4 可与 T3 并行但需 T2 的 schema）→ T6/T7 → T8 → T9 → T10 → T11 → T12。T5 依赖外部仓库，可在 T4 之后任意时刻做。
- 每个 Task 的 Step 5 之后跑 `bash build/wsl/gate.sh` 作为该 Task 的退出条件，红色不进入下一个 Task。
- 已知需要人工的验收项：真 Windows 上的卸载流程与"原有远程扩展/设置仍在"（`docs/wsl-verification.md` §5–§6），Linux 上无法替代。
