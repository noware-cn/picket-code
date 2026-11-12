# Picket WSL 的数据接管、与官方 Remote-WSL 的互斥，以及服务器版本策略 — 设计 v1

日期：2026-11-05
状态：待批准
相关：`docs/superpowers/specs/2026-11-04-picket-wsl-design.md`（WSL 支持的基线设计），
`docs/superpowers/plans/2026-11-04-picket-wsl.md`（已完成的 15 个 Task）

## 1. 意图与背景

rc.5 在 Windows 真机上的第一次运行暴露了一个设计缺口。日志（`%APPDATA%\Picket Code\logs\20261105T192455`）：

```
renderer.log:2   [AgentHost:remote] Initializing (remoteAuthority=wsl+ubuntu)
exthost.log      $doActivateExtension ms-vscode-remote.remote-wsl, activationEvent: 'onResolveRemoteAuthority:wsl'
renderer.log:5   [Extension Host] WSL extension is supported only in Microsoft versions of VS Code
renderer.log:11  returned an error {"code":"NoResolverFound","message":"No remote extension installed to resolve wsl."}
```

三件事同时成立：

1. 用户机器上装着官方 `ms-vscode-remote.remote-wsl-1.104.7`（用户扩展目录）。它在本产品里被激活后立刻抛错退出，于是 `wsl` 这个 authority 前缀**无人认领**。
2. 用户历史里的 `vscode-remote://wsl%2Bubuntu/...` 全部指向这个前缀（共享存储的最近列表里 4 条）。它们永远打不开，报错信息指不到我们。
3. 我们自己的数据面在 `~/.picket-code-server`，与官方在 `~/.vscode-server` 留下的扩展、设置、历史完全隔离。用户即使想切换过来，也要重装扩展、重配设置。

用户的决定（本设计的输入，不再讨论）：

- **官方扩展必须卸载**。只要它还在，我们的 WSL 功能**完全禁用**（不是提示、不是降级）。
- 卸载要**保留数据**，我们**完整兼容**官方留下的全部数据。
- 用户可以自行卸载，我们提供卸载指南；也可以由我们的命令一键卸载。
- `picket-code-server` 的版本号**独立演进**；`picket-code` 对服务器只要求**最低版本**，不再要求 tag 相等。

## 2. 目标 / 非目标 / 反目标

### 目标

- **G1 硬互斥**：官方扩展存在（无论启用、禁用、激活与否）时，resolver（`picket-wsl` 与 `wsl` 两个前缀都不注册）、树视图、一次性提示、12 条业务命令全部关闭；只保留"解除冲突"所需的入口。产品层面再撤掉官方扩展的 API proposal，让它连 `resolvers` 都拿不到。
- **G2 一键卸载且不删数据**：一条命令卸载官方扩展；代码里**没有任何**删除文件的路径；卸载后当前窗口内恢复 WSL 功能（必要时提示重新加载）。
- **G3 接管官方留下的数据**：共用 `~/.vscode-server` 的 `data/`、`extensions/`、`server-env-setup`；认领 `wsl+` authority（含 `wsl+default`、大小写不敏感、`getCanonicalURI` 归一）；兼容 `remote.WSL.*` 里我们真正实现的语义项；继续读 `.wslconfig` 的 `[wsl2]`。
- **G4 服务器版本独立**：catalog 组件携带 `version`（独立 semver）与 `commit`（兼容锚点）；客户端要求 `commit` 相等且 `version >= picketServerMinVersion`，在满足者中取最高版本。安装目录按版本并存。
- **G5 卸载指南**：`docs/uninstall-official-remote-wsl.md`，GUI / 命令行两条路径，明确列出"不会删什么"。

### 非目标

- WSL1、ARM64、Alpine、Windows Server。
- 嵌套 authority `wsl+<distro>@<hostAuthority>`（exec-server 形态）——v1 明确拒绝并给可读错误。
- 自动迁移旧的 `~/.picket-code-server/{data,extensions}`（rc.4/rc.5 试用者的实验数据）。保留原地，诊断里说明可删。
- 官方扩展的后台预下载、遥测、`wsl.usageTime.*` 那套 memento。
- 替官方扩展做"共存"（两套同时可用）。

### 反目标

- 复用官方的 server 二进制。它不含我们的补丁（agent host 的 iCode provider、默认 agent 回退、扩展），复用等于功能缺失。
- 复制官方扩展的实现代码。兼容只依据公开契约与可观察行为（许可边界见 `docs/remote-wsl-extension-analysis.md` §九）。
- 为了"兼容"去删用户数据，或卸载时顺手清理 `~/.vscode-server`。

## 3. 约束

- 握手比较 `product.json.commit`；服务器必须由同一个 vscode tag 构建。所以"兼容性"由 commit 表达，版本号只表达新旧。
- 我们的扩展是 `extensionKind: ["ui"]`，只跑在 Windows 侧扩展宿主；`src/*.js` 不得 `require('vscode')`（`test/manifest.test.js:49-58` 强制），检测与卸载必须走注入。
- workbench 没有"按 id 禁用扩展"的命令，只有 `workbench.extensions.uninstallExtension`（`extensions.contribution.ts:539-572`，内置扩展拒绝卸载）。
- `build/product.json` 的 `extensionEnabledApiProposals` 是唯一能让官方扩展在非微软构建里工作的开关。
- `serverDataFolderName` 由客户端与服务端各自的 `product.json` 决定，二者同源于本仓库的 `build/product.json`。

## 4. 方案选择

每个选择都写了候选、取舍与结论。结论是我的判断；用户在评审时可以改，改动会重切计划。

### 4.1 数据根：共用 `~/.vscode-server`

| 候选 | 取舍 |
|---|---|
| **A. 共用 `~/.vscode-server`**（改 `serverDataFolderName` 与 `serverPaths`） | 真正的零迁移：用户的扩展、设置、历史、`server-env-setup` 原样可用。代价是 `bin/` 下会同时存在官方留下的 commit 目录（我们只读自己的 `bin/picket-<version>`，不删不覆盖）。 |
| B. 保持 `~/.picket-code-server`，首次使用拷贝官方 `data/`、`extensions/` | 隔离更干净，但"拷贝"会在用户再次安装官方扩展时分叉；拷贝几十万个文件也慢。 |
| C. 软链官方目录 | WSL + Windows 注释混用下 inode 语义脆弱；任一进程 `rm -rf` 都会毁掉另一方。 |

**结论：A。** "完整兼容官方扩展的全部数据"只有共用同一目录才成立。`serverPaths` 与 `build/product.json` 一起改，运行期用显式 `--user-data-dir` / `--extensions-dir`（`launch.js:67-68` 已经这么传），不依赖服务端的默认推导。

### 4.2 服务器版本：独立 semver + commit 锚点

| 候选 | 取舍 |
|---|---|
| **A. 组件带独立 semver（`1.<n>.<m>`）与 `commit`** | 服务器可以比客户端跑得快（同 commit 下连发多个版本），客户端只要求最低版本。需要在 `picket-code-server` 仓库改资产命名与 workflow 输入。 |
| B. `<vscodeVersion>-picket.<n>` 与客户端同族 | 不需要改资产命名，但"独立演进"退化成"跟着客户端版本走"，且无法表达"同 commit 下 n 增长"。 |
| C. 继续 tag 相等 | 就是现在的缺陷：客户端 tag 一升，服务器就必须同步发一版，否则钉旧版。 |

**结论：A。** 兼容性由 `commit` 表达（握手本来就比较它），`version` 只表达新旧与最低要求。

### 4.3 `wsl+` 接管

| 候选 | 取舍 |
|---|---|
| **A. 注册 `wsl` 前缀为别名**，`wsl+default` 归一默认发行版，大小写不敏感，实现 `getCanonicalURI` | 历史最近列表、`.code-workspace`、第三方文档里的 URI 直接可用。风险仅是"若官方扩展哪天能在本产品运行，两者抢同一前缀"——而 4.4 的产品级撤权让这不可能。 |
| B. 只做引导：检测到窗口是 `wsl+` 时提示改写 | 语义干净，但用户先看到一次原始报错；且历史条目不会自动修好。 |

**结论：A。** 嵌套形式 `@host` 不在范围内：解析到 `@` 就抛 `RemoteAuthorityResolverError(InvalidAuthority)`，消息里说明只支持 `wsl+<distro>`。

### 4.4 闸门强度

| 候选 | 取舍 |
|---|---|
| **A. 扩展存在即禁用（不看启用状态），并从 `build/product.json` 撤掉它的 4 个 proposal** | 符合"必须卸载"。撤权是第二道保险：即使有人从市场装回来，它也拿不到 `resolvers`，不可能半可用。 |
| B. 仅当官方扩展"启用且激活"时禁用 | 用户可能只禁用不卸载，就会出现两套代码都认为自己该管 `wsl` 的空档。 |

**结论：A。** 判据是 `vscode.extensions.getExtension('ms-vscode-remote.remote-wsl')` 是否返回对象（返回即"已安装"，与启用状态无关）。

### 4.5 `code` 命令名

| 候选 | 取舍 |
|---|---|
| **A. 额外提供 `~/.local/bin/code`，仅当该路径不存在时** | 官方卸载后肌肉记忆还在（`code .`）。已存在别人的 `code` 时按既有 foreign-link 规则绝不覆盖。 |
| B. 只提供 `picket-code` | 不会与系统里其它 `code` 冲突，但用户要改习惯。 |

**结论：A**（builder's call，可改）。安装器已经会检测外来链接并拒绝覆盖（`shim.js:68-73`），复用同一规则即可。

## 5. 设计

### 5.1 磁盘布局

| 路径（发行版内） | 用途 | 来源 |
|---|---|---|
| `~/.vscode-server/bin/picket-<version>/` | 我们的服务器二进制（`bin/picket-code-server`、`node`、`out/`、`bin/remote-cli/picket-code`） | 载荷，按版本并存 |
| `~/.vscode-server/data/` | `--user-data-dir`：`User/`、`Machine/`、`globalStorage/`、`History/`、`logs/` | **与官方共用** |
| `~/.vscode-server/extensions/` | `--extensions-dir`：用户扩展 | **与官方共用** |
| `~/.vscode-server/server-env-setup` | 用户写的环境钩子，启动时 `source` | **与官方共用** |
| `~/.picket-code-server/runtime/<distro>.json`、`.lock` | 启动记录与发行版锁 | 我们私有 |
| `~/.picket-code-server/payloads/` | 旧布局残留，只读不删 | 我们的历史数据 |
| `~/.local/bin/picket-code`、`~/.local/bin/code` | CLI shim（后者仅在不存在时安装） | 我们私有 |

`build/product.json` 的 `serverDataFolderName` 从 `.picket-code-server` 改为 `.vscode-server`：显式 flag 已经覆盖数据与扩展目录，但服务端自己也用这个字段推导 CLI 注入路径与默认目录，两边必须一致。

官方安装器的清理逻辑只删 `bin/` 下 40 位十六进制目录（`wslDownload.sh:89-91`），我们的 `bin/picket-*` 不会被它碰到；官方卸载后那个清理逻辑也不存在了。我们的 `cleanup()` 反过来只删 `bin/picket-*`，绝不扩到 `data/`、`extensions/`、`server-env-setup`。

### 5.2 catalog schema v2

```json
{
  "schema": 2,
  "flavor": "ondemand",
  "minVersion": "1.0.0",
  "components": [
    {
      "id": "wsl-server", "kind": "server",
      "version": "1.2.0",
      "commit": "e646868227c3e3a9e3f24277c8c7220be42c0be7",
      "file": "picket-code-server-1.2.0-linux-x64.tar.gz",
      "size": 87754427,
      "sha256": "…", "embedded": false
    }
  ]
}
```

`product.json` 新增 `picketServerMinVersion`（构建期从 `PICKET_SERVER_MIN_VERSION` 盖章）。`picketTag` 这个字段**删除**：它现在的唯一作用是把"客户端 tag"和"服务器 tag"绑成同一个字符串，正是缺陷来源。客户端身份用 `version` + `commit` 表达，诊断输出改成 `Server version` / `Server minimum`。

选择算法（`src/version.js`，纯函数，无依赖）：

1. 候选 = `kind === 'server' && commit === product.commit`。空 → 错误 `no server component for commit <commit>`。
2. 取候选里 `version` 最大的一个。
3. 若最大 `version < minVersion` → 错误 `catalog offers <max>, requires >= <min>`，**不下载也不降级**。
4. 否则选它。

`catalog.minVersion` 与 `product.picketServerMinVersion` 必须相等（构建期 `check.mjs` 断言）；运行期只用后者，前者仅供诊断对照。

### 5.3 组件状态机（最低版本语义）

`inspect(component)` 扫描 `~/.vscode-server/bin/picket-*`，读每个目录的 `.picket-payload.json`（`{version, commit, sha256}`）：

| 条件 | 状态 |
|---|---|
| 存在 `commit` 匹配 且 `version >= minVersion` 且 marker 完整 | `installed`（取最高版本） |
| 只有 `commit` 匹配但 `version < minVersion` | `outdated`，附 `candidateVersion`（最高者） |
| 目录存在但 `commit` 都不匹配 | `incompatible` |
| 无目录 | `absent` |
| marker 存在但 sha256 与目录内容对不上（安装中断） | `broken` |

`ensure()`：`installed` 直接复用；`outdated` / `incompatible` / `absent` / `broken` 走 `chooseSource` → `installPayload`（装到 `bin/picket-<version>`，临时目录 `.tmp-<rand>` 再原子改名）→ 写 marker。

`resolver` 的复用判定同步放宽：runtime 记录里带 `{version, commit}`，复用条件是 `commit` 相等 **且** `version >= minVersion`（不再是字符串相等）。`waitForServer` 同上。

### 5.4 互斥闸门

新模块 `src/official.js`，不 require `vscode`：

```js
const OFFICIAL_EXTENSION_ID = 'ms-vscode-remote.remote-wsl';
function createOfficialGate({ extensions }) // extensions = { get(id), onDidChange(cb) }
// → { evaluate(): { blocked, installed }, get blocked, onChange(cb), dispose() }
```

`extension.js` 在 `activate()` 的开头（读 catalog 之前）求值一次，并把 `extensions` 适配器注入。`blocked === true` 时：

| 能力 | 状态 |
|---|---|
| `registerRemoteAuthorityResolver('picket-wsl' / 'wsl')` | **不注册** |
| 树视图 `picketWsl.targets` | 保留视图，只放一个节点"已禁用：检测到官方 Remote-WSL 扩展" |
| `maybeNudge` | 不执行 |
| 业务命令（`openFolder`、`reopenInWsl`、`reopenInWindows`、`stopServer`、`components`、`selectGallery`、`installVsix`、`addDistro`、`setDefaultDistro`、`deleteDistro`、`installCli`、`removeCli`、`refreshTargets`） | 不注册 |
| `picket.wsl.uninstallOfficial`（新） | 注册 |
| `picket.wsl.uninstallGuide`（新） | 注册 |
| `picket.wsl.showLog` | 注册 |
| `picket.wsl.diagnose` | 注册（报告里新增 `Official extension` 段） |

实现方式：一整块"业务命令 + resolver + 树"的注册放进 `if (!gate.blocked)`，而不是给 14 条命令各加守卫——单点才可测。`package.json` 的命令面板 `when` 统一加 `!picketWsl.blocked`，context key 由扩展 `setContext` 维护；`extensions.onDidChange` 触发重估，值变化时刷新视图与通知。

启动通知只发一次（memento `picket.wsl.conflictNotified`），两个按钮："卸载官方 Remote-WSL（保留数据）"、"查看卸载指南"。已在远程窗口里（`wsl+` 打不开）时不弹通知，只写日志——那时用户看到的是 workbench 的报错，弹窗也拦不住。

### 5.5 卸载

`src/uninstall.js`：

```js
async function uninstallOfficialExtension({ extensions, executeCommand })
// → { status: 'uninstalled' | 'absent' | 'builtin' | 'failed', message: string }
```

- `builtin`：`getExtension` 返回的 `extensionPath` 在 `<appRoot>/extensions/` 下时直接判定，不去调命令（workbench 也会拒绝）。
- 正常路径：`executeCommand('workbench.extensions.uninstallExtension', OFFICIAL_EXTENSION_ID)`，**参数只有这一个 id**。这是测试要钉住的不变量：卸载动作不携带任何路径。
- 成功后 `gate.evaluate()`；若当前窗口没有远程或远程是 `wsl+`/`picket-wsl+`，提示"已卸载；重新打开 WSL 文件夹"，并给"重新加载窗口"按钮（resolver 是注册期一次性的事，本窗口内补注册对已失败的窗口无效）。
- 失败按错误信息分类给出下一步（权限、被策略锁定、市场连接）。

### 5.6 设置兼容层

官方扩展的 9 个键里，只有两个在我们的实现里有真实语义（其余是它的内部实现细节）：

| 官方键 | 我们的行为 |
|---|---|
| `remote.WSL.useShellEnvironment`（默认 `true`） | `true` 用登录 shell `sh -lc`（现在固定如此）；`false` 改用 `sh -c`，不再 source 用户 profile。 |
| `remote.WSL.serverProbeRetryTimeout`（秒，默认 60） | 探活总超时（我们现在是固定 2 秒间隔 + 启动超时）。 |

优先级：`picket.wsl.*` 显式设置 > `remote.WSL.*` > 我们的默认值。其余官方键在诊断报告的 `Official settings` 段列出"已忽略"，让用户知道它们不会生效（例如 `remote.WSL.fileWatcher.polling`：我们的服务器用原生 watcher，没有轮询实现）。

### 5.7 authority 兼容

`src/remoteUri.js`：

```js
const AUTHORITY_PREFIX = 'picket-wsl';
const LEGACY_AUTHORITY_PREFIX = 'wsl';
function parseAuthority(authority) // → { prefix, distro } | undefined；distro 空或 'default' → ''
function canonicalAuthority(prefix, distro) // → `${prefix}+${distro}`
```

- 两个前缀都注册 resolver。
- 发行版匹配大小写不敏感，命中后用 `wsl --list --verbose` 里的规范名；找不到 → `RemoteAuthorityResolverError(InvalidAuthority)`，消息列出可用发行版。
- 实现 `getCanonicalURI(remoteAuthority)`：`wsl+ubuntu` → `wsl+Ubuntu`。工作台用它给工作区定型（日志里 `Cannot get canonical URI ...` 就是这条路），不实现的话大小写变体会生成两个工作区身份。
- `resourceLabelFormatters` 增加 `authority: "wsl+*"`，与 `picket-wsl+*` 同样显示 `WSL` 后缀。
- 我们**生成**的新 URI 仍用 `picket-wsl+`（不主动写官方前缀），但读取侧完全接受 `wsl+`。

### 5.8 构建与发行

| 位置 | 改动 |
|---|---|
| `build/product.json` | `serverDataFolderName: ".vscode-server"`；删除 `ms-vscode-remote.remote-wsl` 的 proposal 块（保留 `noware.picket-remote-wsl`） |
| `build/build.sh` | 必填 `PICKET_SERVER_MIN_VERSION`；可选 `PICKET_SERVER_VERSION`（默认等于最低版本）；`commit` 从 `APP_DIR/product.json` 读 |
| `build/wsl/fetch-payload.sh` | 参数从 `<tag>` 改为 `<version>`；资产名 `picket-code-server-<version>-linux-x64.tar.gz`；catalog 写 `schema: 2` + `commit` |
| `build/wsl/assemble.mjs` | `--min-version`、`--version`、`--commit`；盖章 `picketServerMinVersion`；不再写 `picketTag` |
| `build/wsl/check.mjs` | 断言：schema 2、semver 合法、存在 `commit` 匹配且 `version >= minVersion` 的组件、`catalog.minVersion === product.picketServerMinVersion`、flavor 一致、embedded 预算、ondemand 无载荷 |
| `build/wsl/offline-bundle.mjs` | `--version` + `--min-version`，三件一致性校验同 `check` |
| `.github/workflows/release.yml` | vars 换成 `PICKET_SERVER_MIN_VERSION` / `PICKET_SERVER_VERSION`；win32 的离线包步骤按 version 取名；空值即红 |
| `build/check-contract.sh` | 新增断言：`ms-vscode-remote.remote-wsl` **不得**出现在 `extensionEnabledApiProposals`（防回归） |
| `picket-code-server` 仓库 | `release-server.yml` 增加 `version` 输入（默认 `1.0.0`），tag 用 `server-v<version>`，资产按 version 命名；同一 client tag 可发多个 server 版本 |

版本门禁的落点：`check.mjs` 在 `build.sh` 与 `package.sh` 两处都跑（已如此），所以"最低版本没被满足"在打包前就红，而不是用户装完才发现。

### 5.9 测试

| 层 | 内容 |
|---|---|
| L1（`node --test`） | 版本比较与选择算法（4 条错误分支）；`inspect` 五态；`serverPaths` 新布局；settings 映射优先级；authority 解析（`wsl+`、`wsl+default`、大小写、未知发行版、嵌套拒绝）；闸门状态机（注入假 `extensions`）；卸载命令的参数不变量 |
| L2（伪 `wsl.exe`） | 启动 argv 里 `--user-data-dir=~/.vscode-server/data`、`--extensions-dir=~/.vscode-server/extensions`；`server-env-setup` 路径；复用判定用 `version >= min` 而非相等 |
| L3（真机，`build/wsl/acceptance.sh`） | 新阶段 `--conflict`：伪造冲突扩展 → 断言 resolver 未注册、业务命令不在、两个"解除"命令在；新阶段 `--takeover`：预置 `~/.vscode-server/{data,extensions}` 后连接，断言数据被复用且未新建 `~/.vscode-server/data` 副本；`--legacy-uri`：用 `wsl+<distro>` 直接打开 |
| L4（构建断言） | catalog 选择、min 版本不满足即失败、proposal 已撤、ondemand 不夹带载荷 |
| 人工（`docs/wsl-verification.md`） | 真 Windows：卸载官方扩展（保留数据）→ 用 `wsl+` 旧链接直接打开 → 原扩展与原设置都在；未卸载时功能全禁用 |

### 5.10 风险与回滚

| 风险 | 处置 |
|---|---|
| 共用 `extensions/` 后，用户装了对 1.144 编译的扩展，我们的 1.143.1 服务器加载失败 | 扩展宿主报错不影响连接；诊断新增 `Extensions` 段列出加载失败项。文档写明"远程扩展需与本构建的 VS Code 版本兼容"。 |
| 用户绕过闸门（禁用我们的扩展、启用官方的） | 官方扩展拿不到 `resolvers` proposal，不可能工作；两套 server 会共用数据目录但只会有我们的在跑。文档写明这是不支持的状态。 |
| `~/.vscode-server/bin/<commit>` 已存在（官方装过同版本） | 我们只写 `bin/picket-*`，不读、不复用、不删官方的目录。 |
| 构建期漏配 min 版本 | `check.mjs` 双处执行，打包前即失败。 |
| 回滚 | 全部是补丁可逆的改动；`serverDataFolderName` 改回 `.picket-code-server` 即回到隔离布局，旧数据仍在 `~/.picket-code-server`。 |

## 6. 决策记录（2026-11-05 已批准）

1. **数据根**：**A 共用 `~/.vscode-server`**（`serverDataFolderName` 改为 `.vscode-server`）。
2. **版本方案**：**A 独立 semver `1.<n>.<m>` + `commit` 锚点**，客户端只要求 `commit` 相等且 `version >= minVersion`。
3. **`wsl+` 接管**：**A 注册别名**（`wsl` + `picket-wsl`，含 `wsl+default`、`getCanonicalURI` 归一）；嵌套 `wsl+<distro>@<hostAuthority>` 按 v1 不支持处理。
4. **`code` 命令名**：**A 双命令**——`~/.local/bin/picket-code` 总是装，`~/.local/bin/code` 仅在不存在时创建（外来链接拒绝覆盖）。

批准同时确认：原生 inline 执行、逐 Task 提交并跑门禁、全部完成后派独立子代理整支复核；T5（`picket-code-server` 仓库改动）待另行授权。

## 7. 交给实现者的自由

- 文案与提示措辞（中英混排现状保持：命令标题 5 英 10 中，新增命令用中文并补英文说明）。
- 树节点布局与 welcome 视图排版。
- semver 比较的实现（自写约 20 行，不新增依赖）。
- 日志分级与 `diagnose` 各段的具体字段顺序（保持现有"冻结式逐项"结构即可）。
