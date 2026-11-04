# Picket Code 的 WSL 支持 — 设计

状态：待批准（v2，已并入 builder check 与四轮问答）
日期：2026-11-04
相关：`docs/wsl-icode.md`（方案比较与 9p 评估）、`noware-cn/picket-code-server`（server 产物）、`spikes/picket-remote-wsl/`（一次性参考实现）

## 1. 意图与 why

Windows 上的 Picket Code 打开 WSL 发行版里的文件夹时，工作区应当真正跑在 Linux 侧：文件系统、递归监视、搜索、语言服务、终端都在发行版里，Windows 只留 UI 与 RPC。这样 `docs/wsl-icode.md` §2.8 里那些 9p 问题（UNC 监视不投递、跨边界搜索慢、WSL git 执行器）整类消失，iCode 也在 WSL 原生运行。

官方那条路对我们不可用：微软的 `Remote-WSL` 扩展需要 vsda，且它只会拉微软签名的 server（我们的客户端签不出名，握手被 `Unauthorized client refused`）。所以我们必须自带 server 与 resolver——server 侧已完成并发布（`picket-code-server`，tag 与客户端严格一致），本设计只解决客户端侧。

部署面向内网与离线：不能假设 `download.noware.cn`、Open VSX 或任何公网端点可达。因此本设计的主线是 **provisioning**（包从哪来、怎么校验、怎么升级、扩展从哪来），resolver 本身反而是最小的一块。

## 2. 目标 / 非目标 / 反目标

### 目标

- Windows 10/11 + WSL2 上的 Picket Code，能用 `picket-wsl+<distro>` 打开 WSL 里的文件夹。
- **随包内嵌 server 载荷**：正式版与 RC 都内嵌，首次打开零网络。
- 载荷来源三条，优先级明确：显式路径 → 内嵌 → 内网地址（后两条用于替换与修复）。
- 扩展市场三种模式：默认 Open VSX、内网自建 Open VSX、彻底离线。
- iCode 由用户在发行版内自备；扩展负责检测、注入路径、缺失时给可执行说明。
- 任何失败都能被一句话解释清楚（列出尝试过的来源与原因）。

### 非目标（第一版不做，理由）

- WSL1：无 localhost 转发、语义差异大。检测到 WSL1 给出"请升级到 WSL2"。
- ARM64 / Alpine / Windows Server / 嵌套远程。
- WSL-on-Web / exec server 连接路径。
- iCode 载荷与版本钉死：iCode 由用户自备，扩展只做检测与注入，不负责安装。
- 跨窗口 helper 进程 + 端口代理：改为"运行时文件 + 探活复用"（§4.4），效果等价且更简单。
- WSL 内 CLI shim（`picket-code .`）：M4 可选，不进第一版验收。
- 遥测。

### 反目标（这样算失败，哪怕技术上跑通）

- 用户以为自己在 WSL 窗口里，其实是 `\\wsl.localhost` 的本地窗口。
- 静默降级到某个载荷来源，失败时看不出试过什么。
- 通过修改安装目录里的 `product.json` 实现内网切换（升级即丢）。
- 依赖公网可达才可用。
- 两个窗口争用同一份 `--user-data-dir` 导致 agent 历史/SQLite 损坏。

## 3. 约束

- **tag 强绑定**：`product.json.commit` 在握手时比对（`remoteExtensionHostAgentServer.ts:351-357`），载荷 tag 必须等于客户端 tag。运行时没有可推导的锚点（当前 `version` 是上游裸 `1.143.1`，发布 tag 是 `v1.143.1-picket.1-rc.4`），所以**构建时往 `product.json` 盖一个 `picketTag` 字段**，载荷命名、安装目录、诊断输出都读它。
- **server 无 vsda**：产物没有校验器，客户端也不签名；不引入任何签名环节。
- **离线内网的 PATH 不可信**：不依赖发行版 `.bashrc` 导出的 PATH，一律绝对路径 + 显式注入环境变量。
- **扩展市场**：`productService.extensionsGallery` 是唯一真实来源；设置项 `extensions.gallery.serviceUrl` 走账号服务（本构建已剥离所有认证 provider，配了会永久 `RequiresSignIn`），因此必须在 `productService` 层覆盖，并隐藏该设置项。

## 4. 方案

### 4.1 已讨论并选定的取舍

| 选择 | 备选 | 结论与理由 |
|---|---|---|
| 内置扩展（随客户端发布） | fork/重打包官方扩展；发 Open VSX | `resolvers` 是提议 API，只有白名单里的扩展能用；上市场等于给不可用的扩展。内置即零安装。 |
| 直连 `127.0.0.1:<port>` + 运行时文件复用 | 官方式 helper 进程 + 每连接 `wsl.exe` 端口代理 | 省 ~250 行；跨窗口共享改用运行时文件（§4.4）达成，比官方更省内存。仍未覆盖 `localhostForwarding=false`，记录在案。 |
| 载荷一律内嵌 | 只做下载器 / 只做随包 | 内网/离线是主场景；"装完即用、首次零网络"是产品承诺，不是部署清单。 |
| iCode 用户自备 | 我们打包 Linux 版 | iCode 的 Linux 形态不由我们控制；我们只检测 + 注入 + 报错，避免背上运行时打包。 |
| 市场覆盖用核心补丁（B） | 部署期改 product.json | 升级会覆盖，用户不能自助。 |
| 离线再加"载荷预置 + VSIX 安装"（C） | 只靠 gallery | 彻底离线时 gallery 必然不可达，扩展供给必须有第二条腿。 |
| 内网档 = 自建 Open VSX | 仅文件共享 | 用户确认有自建 Open VSX，可浏览/搜索/安装。 |

### 4.2 架构

```
Picket Code (Windows)
├─ 内置扩展 picket-remote-wsl  ── registerRemoteAuthorityResolver('picket-wsl')
│   ├─ payload.js      来源解析 → SHA256 校验 → 装进发行版
│   ├─ icode.js        检测 icode、注入 PICKET_ICODE_BIN
│   ├─ resolver.js     authority → {host:127.0.0.1, port, token}，运行时文件复用
│   └─ commands.js     打开/重开/停止/日志/诊断/市场来源/VSIX 安装
├─ resources/wsl-payloads/     内嵌载荷（tar.gz + SHA256SUMS）
└─ 核心补丁 66         gallery 覆盖（product.overrides.json）

WSL2 发行版
├─ ~/.picket-code-server/payloads/server-<tag>/   bin/picket-code-server
├─ ~/.picket-code-server/runtime/<distro>.json    {port, token, tag, pid, startedAt}
├─ ~/.picket-code-server/data/                    --user-data-dir
├─ ~/.picket-code-server/extensions/              --extensions-dir（可预置）
└─ ~/.picket-code-server/logs/
```

启动链路：`spawn('wsl.exe', ['-d', distro, '-e', 'env', 'PICKET_ICODE_BIN=<abs>', '<server-bin>', ...flags])`，从 stdout 解析 `Extension host agent listening on <port>`，把 `{host, port, connectionToken}` 交还给 `vscode-remote`。

### 4.3 载荷（单制品）

| 项 | 值 |
|---|---|
| 制品 | `picket-code-server-<picketTag>-linux-x64.tar.gz` |
| 版本 | `product.json.picketTag`（构建时盖章） |
| 校验 | 同源 `SHA256SUMS`（GNU 格式），校验失败拒绝安装并清理 |
| 安装 | `payloads/server-<picketTag>/`，`--strip-components=1`，先解到 `.tmp-<rand>` 再原子改名 |
| 标记 | `.picket-payload.json`（sha256 / 来源 / 时间），启动只读标记 |

来源优先级（第一个可用者胜出）：

1. `picket.wsl.serverPayloadPath` — 文件或 UNC 共享（运维热修、替换坏包）。
2. 内嵌 `resources/wsl-payloads/` — **始终存在**，出厂默认路径。
3. `picket.wsl.serverPayloadBaseUrl` — 内网地址，用于内嵌包损坏或版本回退时的兜底。

网络访问（仅第 3 条会用到）遵守 `http.proxy`、`http.proxyStrictSSL`、`picket.wsl.caFile`；默认直连 + 严格 SSL。三者都不可用时，错误里逐条列出尝试与原因。

### 4.4 Resolver 语义

- authority：`picket-wsl+<distro>`，`<distro>` 为空时取默认发行版。
- 复用：启动前读发行版内 `runtime/<distro>.json`；`probe()` 通过且 tag 匹配 → 直接复用（跨窗口、跨重载都成立），不新起进程。
- 探活：`GET http://127.0.0.1:<port>/vscode-remote-resource?tkn=<token>`，**400 = 端口通且 token 对**，403 = token 错，拒绝 = 已死。超时 2 s，重试窗口由 `picket.wsl.probeRetrySeconds`（默认 60）控制。
- 启动参数：`--host=127.0.0.1 --port=0 --connection-token=<t> --use-host-proxy --without-browser-env-var --disable-websocket-compression --accept-server-license-terms --user-data-dir=... --extensions-dir=... --log=trace`；token 由 4 段 `crypto.randomInt` 拼接。
- 看护：每收到 stdout/stderr 数据重置计时；默认 90 s 无输出判失败（`picket.wsl.startTimeoutSeconds`）；`exit 99` → "发行版不兼容（缺 libstdc++ 等）"。
- 落盘：启动成功后写 `runtime/<distro>.json`（含 pid），失败时清理。
- 停止：`Picket: Stop WSL Server` → 按运行时文件杀进程树 → `wsl.exe -d <d> -e pkill -f 'picket-code-server.*<tag>'` → 删除运行时文件。不做"退出即杀"。

### 4.5 iCode 检测（用户自备）

检测顺序：`picket.wsl.icodePath` 设置 → 发行版内 `command -v icode`（`wsl.exe -d <d> -e sh -lc 'command -v icode'`）→ 无。

- 命中：启动 server 时注入 `PICKET_ICODE_BIN=<绝对路径>`（不依赖发行版 PATH）。
- 未命中：不阻塞 WSL 窗口（编辑器/终端/搜索照常工作），一次性提示"WSL 里未找到 iCode，AI 功能不可用"，附上期望路径与设置项；诊断命令里单独列出这一项。

### 4.6 扩展市场三模式（B + C）

**B｜核心补丁 66**

- 启动时若存在 `<userDataDir>/product.overrides.json`，其 `extensionsGallery` 覆盖 `product.json`；`null` 表示关闭市场。文件缺失/损坏时回退，仅记日志。
- 隐藏设置项 `extensions.gallery.serviceUrl`（以及 `extensions.gallery.authProvider`），避免用户掉进永久 `RequiresSignIn`。
- 命令 `Picket: 选择扩展市场来源`：默认 Open VSX / 内网 Open VSX（填 URL）/ 关闭 → 写文件 → 提示重载窗口。客户端生效即可；服务端不需要该补丁（`serverServices` 把 manifest 委托给客户端）。
- 补丁编号顺延（当前最后一个为 65，本补丁为 66）。

**C｜彻底离线**

- server 载荷可选携带 `extensions/`；首次安装时若 `--extensions-dir` 为空则复制进去，绝不覆盖用户已装扩展（M3 决定清单，第一版留空）。
- 命令 `Picket: 从 VSIX 安装扩展…`：文件选择器 → `workbench.extensions.installExtension`（远端窗口时自动装到远端）。

### 4.7 UX

命令（全部 `Picket:` 前缀，避免与官方 `WSL:` 混淆）：

1. `Picket: Open Folder in WSL…` — 选发行版（记住默认）+ 路径（默认 `$HOME`）。
2. `Picket: Reopen Folder in WSL` — 从本地窗口重开（含 `\\wsl.localhost` 路径）。
3. `Picket: Reopen Folder in Windows`。
4. `Picket: Show WSL Log`。
5. `Picket: Stop WSL Server`。
6. `Picket: 诊断 WSL 支持` — 输出 WSL 版本、发行版、载荷来源命中情况、iCode 位置、市场模式、运行时文件状态；可复制。
7. `Picket: 选择扩展市场来源`。
8. `Picket: 从 VSIX 安装扩展…`。

常驻：沿用远程指示器；在 `\\wsl.localhost` 本地窗口里一次性提示"重开可获得原生性能"（`globalState` 记一次）。

### 4.8 失败模式与文案原则

| 症状 | 原因 | 提示要点 |
|---|---|---|
| 命令不可用 | 非 Windows / 无 `wsl.exe` | 明确"仅 Windows + WSL2" |
| 发行版列表为空 | 未安装发行版 | 一句话安装指引 |
| 发行版名不存在 | 拼写/别名 | 列出可用发行版 |
| `Client refused: version mismatch` | 载荷 tag ≠ 客户端 `picketTag` | 给出两者当前值，提示替换载荷 |
| SHA256 不匹配 | 包被截断/换版 | 拒绝安装并指出来源 |
| 解包失败 / 磁盘满 | 空间或权限 | 指出目标路径与所需空间 |
| 启动 90 s 无输出 | 发行版不兼容/缺依赖 | 指向服务端日志 |
| iCode 未找到 | 用户未装 | 期望路径 + 设置项 + 一次性提示 |
| 无法浏览扩展 | 市场模式为关闭或内网不可达 | 引导执行"选择扩展市场来源" |
| 同时打开两个窗口 | 复用运行时文件 | 无提示（正常），日志记录"reused" |

原则：一条消息说清"发生了什么 + 期望是什么 + 下一步做什么"；内部术语（payload、resolver）只出现在日志里。

### 4.9 与现有补丁体系的关系

| 编号 | 内容 | 状态 |
|---|---|---|
| 62 | 无默认 agent 时回退 `agentIdSilent` | 已有 |
| 63 | iCode 适配器 | 已有 |
| 64 | changeset 策略 | 已有 |
| 65 | UI 冒烟用例 | 已有 |
| **66** | gallery 覆盖 + 隐藏设置项 | 新增 |
| 配置 | `product.json` 增加 `picketTag`、`noware.picket-remote-wsl: ["resolvers"]`、内置扩展条目 | 新增 |

## 5. 组件清单

### 扩展 `extensions/picket-remote-wsl/`（内置）

```
package.json        8 条命令、设置项、enabledApiProposals:["resolvers"]、extensionKind:["ui"]
extension.js        activate/deactivate、日志、注册
src/distro.js       发行版枚举、默认发行版、$HOME、WSL1 检测
src/payload.js      三来源解析、SHA256 校验、原子安装、标记文件、代理/CA 支持
src/icode.js        检测与注入
src/launch.js       参数构造、端口解析、看护、运行时文件读写、停止
src/probe.js        400/403/拒绝 三态
src/resolver.js     运行时文件复用、探活、重启、dispose
src/remoteUri.js    UNC ↔ 远程 URI
src/commands.js     8 条命令
src/diagnose.js     诊断报告
src/nudge.js        一次性 UNC 提示
src/log.js          OutputChannel + 文件
```

### 客户端构建（`build/`）

- 构建时往 `product.json` 盖章 `picketTag`（取自发布 tag）。
- 发布流水线拉取同 tag 的 `picket-code-server-<tag>-linux-x64.tar.gz` 与 `SHA256SUMS`，写入 `resources/wsl-payloads/`。
- `check-contract.sh` 新增断言：载荷与 `SHA256SUMS` 存在、`picketTag` 与文件名一致、`product.json` 白名单含 `noware.picket-remote-wsl`、安装包体积在阈值内（记录基线，防意外翻倍）。

### `picket-code-server` 仓库

- 载荷命名与 `SHA256SUMS` 已具备。
- 新增（M3，可留空）：把选定内置扩展打进 `extensions/`。

## 6. 测试策略

| 层 | 内容 | 在哪里跑 |
|---|---|---|
| L1 纯逻辑 | 发行版输出解析、端口解析、`SHA256SUMS` 解析、来源优先级、参数构造、运行时文件读写、UNC↔URI、探活三态、代理选项构造 | `node --test`，Linux CI |
| L2 伪 `wsl.exe` | 脚本模拟 `-l -q` / `-e test` / `-e env` / `-e sh -lc 'command -v icode'` / 启动与日志输出；验证解析、看护超时、exit 99、复用、停止兜底 | Linux CI |
| L3 真机 | Windows + WSL2 清单：零网络首次打开、连续两次打开同发行版（复用）、UNC 与远程两种比较、停止后重开、VSIX 离线安装、内网 Open VSX 切换、诊断输出 | 发布前人工 |
| L4 构建 | 载荷内嵌、`picketTag` 一致、白名单、体积阈值 | CI |

真机清单并入 `docs/testing.md` 的六层矩阵。

## 7. 里程碑

- **M1 载荷与 resolver**：`payload.js` + `launch.js` + `resolver.js`（含运行时文件复用）+ L1/L2 测试；Windows 上手动打开 `/home/<user>`。
- **M2 UX 与 iCode**：8 条命令、诊断、UNC 提示、iCode 检测与注入、错误文案逐条落地。
- **M3 市场三模式**：补丁 66 + 选择来源命令 + VSIX 安装 + 载荷可选预置扩展。
- **M4 打包与验收**：`picketTag` 盖章、载荷内嵌进安装包与 `check-contract`、真机清单、文档增补（`docs/wsl-icode.md` 加"A′ 落地版"）。

## 8. 留给实现者的决定

- 设置项键名与默认值（`picket.wsl.*` 之下）。
- 标记文件与运行时文件的字段、日志文件位置与轮转。
- 诊断报告的具体格式。
- 状态栏是否自建条目（当前判断：不需要）。
- `runtime/<distro>.json` 的并发写入策略（建议：写临时文件后 rename）。

## 9. 合规与来源

实现依据仅限：我们自己的 server 契约（`serverEnvironmentService.ts`、`--help`）、VS Code 开源侧契约（`vscode.proposed.resolvers.d.ts`、`extHostExtensionService.ts`）、公开文档、以及对官方扩展**可观察行为**的认知。不复制其代码、文案、图标、命令 id；不记录或使用 vsda 相关的逆向细节。`spikes/picket-remote-wsl/` 为一次性参考实现，逐块复核后才可提升，不做整体搬移。
