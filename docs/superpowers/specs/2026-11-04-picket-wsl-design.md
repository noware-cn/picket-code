# Picket Code 的 WSL 支持 — 设计

状态：**已批准（v6）** — 2026-11-04

> v6 变更：扩展市场一节改按上游既有机制实现（详见 §4.8 与 §10 的 D-16）。放弃自造的 `<userDataDir>/product.overrides.json`，改为复用 `extensions.gallery.serviceUrl` 与 `extensions.gallery.authProvider` 两个应用级设置：后者新增枚举值 `none`，表示"这个市场不需要账号"，此时客户端用该 URL 本地构造 manifest、不走账号门禁；`serviceUrl = "none"` 表示彻底关闭。补丁 66 相应从"覆盖 product.json"缩为"一条免登录支路 + 一个关闭哨兵"。
> v5 变更：对照官方 Remote-WSL 1.104.7 的**行为面**逐项核对后补齐 6 处体验缺口（菜单与激活事件、登录 shell 环境、路径转换、默认发行版检测、`WSL Targets` 树视图与发行版管理、失败动作与一次性建议），并把 WSL 内 CLI shim 从非目标移入 v1。不复制其代码、文案与命令 id。
相关：`docs/wsl-icode.md`（方案比较与 9p 评估）、`noware-cn/picket-code-server`（server 产物）、`spikes/picket-remote-wsl/`（一次性参考实现）

## 1. 意图与 why

Windows 上的 Picket Code 打开 WSL 发行版里的文件夹时，工作区应当真正跑在 Linux 侧：文件系统、递归监视、搜索、语言服务、终端都在发行版里，Windows 只留 UI 与 RPC。这样 `docs/wsl-icode.md` §2.8 里那些 9p 问题（UNC 监视不投递、跨边界搜索慢、WSL git 执行器）整类消失，iCode 也在 WSL 原生运行。

官方那条路对我们不可用：微软的 `Remote-WSL` 扩展需要 vsda，且它只会拉微软签名的 server（我们的客户端签不出名，握手被 `Unauthorized client refused`）。所以我们必须自带 server 与 resolver——server 侧已完成并发布（`picket-code-server`，tag 与客户端严格一致），本设计只解决客户端侧。

部署面向内网与离线：不能假设 `download.noware.cn`、Open VSX 或任何公网端点可达。因此本设计的主线是 **provisioning**（包从哪来、怎么校验、怎么升级、扩展从哪来），resolver 本身反而是最小的一块。

## 2. 目标 / 非目标 / 反目标

### 目标

- Windows 10/11 + WSL2 上的 Picket Code，能用 `picket-wsl+<distro>` 打开 WSL 里的文件夹。
- **两种发布形态，一条代码路径**（构建参数 `PICKET_WSL_PAYLOAD`）：
  - `embedded`（内网正式版）：载荷随安装包，首次使用零交互；
  - `ondemand`（公开版）：安装包不带载荷，首次使用由用户选择来源安装。
- 载荷来源三条，优先级一致：显式路径/从文件安装 → 内嵌（仅 embedded 形态）→ 内网/公网 URL。
- 扩展市场三种模式：默认 Open VSX、内网自建 Open VSX、彻底离线。
- iCode 由用户在发行版内自备；扩展负责检测、注入路径、缺失时给可执行说明。
- `WSL Targets` 树视图列出发行版（含 WSL 版本、默认标记、连接状态），并支持连接、设为默认、删除、添加发行版。
- 启动 server 走发行版**登录 shell**，让 `nvm` / `pyenv` / `conda` 装的工具在远程扩展宿主里可见；另留 `server-env-setup` 注入钩子。
- Windows ↔ WSL 路径双向转换（`wslpath -u` / `-w`），`Open Folder in WSL…` 用系统文件夹对话框，`Reopen Folder in Windows` 反向可用。
- WSL 内 `picket-code .` 可用（CLI shim）。
- 连接方式三档 `auto | direct | stdio`：默认直连，检测到 `localhostForwarding=false` 或镜像网络模式时自动走 stdio 隧道。
- 任何失败都能被一句话解释清楚（列出尝试过的来源与原因）。

### 非目标（第一版不做，理由）

- WSL1：无 localhost 转发、语义差异大。检测到 WSL1 给出"请升级到 WSL2"。
- ARM64 / Alpine / Windows Server / 嵌套远程。
- WSL-on-Web / exec server 连接路径。
- iCode 载荷与版本钉死：iCode 由用户自备，扩展只做检测与注入，不负责安装。
- 常驻 helper 进程（daemon）：跨窗口复用用运行时文件（§4.4）；`localhostForwarding=false` 用 §4.6 的 per-window 隧道，不需要 daemon。
- `WSL Targets` 树里"该发行版最近打开的文件夹"：没有公开 API 能取最近工作区，官方走私有通道；v1 只列发行版。
- 遥测。

### 反目标（这样算失败，哪怕技术上跑通）

- 用户以为自己在 WSL 窗口里，其实是 `\\wsl.localhost` 的本地窗口。
- 静默降级到某个载荷来源，失败时看不出试过什么。
- 通过修改安装目录里的 `product.json` 实现内网切换（升级即丢）。
- 依赖公网可达才可用。
- 两个窗口争用同一份 `--user-data-dir` 导致 agent 历史/SQLite 损坏。
- 用"启动超时"掩盖一个本可一句话说清的配置问题（如 `localhostForwarding=false`）。
- `embedded` 形态还在弹"请下载组件"对话框，或 `ondemand` 形态悄悄夹带 83 MB。

## 3. 约束

- **tag 强绑定**：`product.json.commit` 在握手时比对（`remoteExtensionHostAgentServer.ts:351-357`），载荷 tag 必须等于客户端 tag。运行时没有可推导的锚点（`version` 是上游裸 `1.143.1`，发布 tag 是 `v1.143.1-picket.1-rc.4`），所以**构建时往 `product.json` 盖 `picketTag`**。
- **server 无 vsda**：产物没有校验器，客户端也不签名；不引入任何签名环节。
- **离线内网的 PATH 不可信**：不依赖发行版 `.bashrc` 导出的 PATH，一律绝对路径 + 显式注入环境变量。
- **扩展市场**：`productService.extensionsGallery` 是 `product.json` 里唯一的市场来源，构建期已内置 Open VSX；运行期换市场走上游自己的两个应用级设置 `extensions.gallery.serviceUrl` / `extensions.gallery.authProvider`。上游一旦看到配了 serviceUrl 就走账号门禁（本构建没有任何认证 provider，配了会永久 `RequiresSignIn`），所以补丁 66 只补一条支路：`authProvider = "none"` 时用该 URL 本地构造 manifest、不查账号；`serviceUrl = "none"` 表示关闭市场。
- **直连依赖 WSL 的 localhost 中继**：`[wsl2] localhostForwarding=false` 时 Windows 与 VM 的 `127.0.0.1` 是不同 socket，直连必然失败。

## 4. 方案

### 4.1 已讨论并选定的取舍

| 选择 | 备选 | 结论与理由 |
|---|---|---|
| 内置扩展（随客户端发布） | fork/重打包官方扩展；发 Open VSX | `resolvers` 是提议 API，只有白名单里的扩展能用；上市场等于给不可用的扩展。内置即零安装。 |
| 双发布形态（embedded / ondemand） | 一律内嵌 / 一律按需 | 内网要零交互，公开版要小安装包。同一条代码路径，只由构建参数与 catalog 标志决定 UX。 |
| 直连 `127.0.0.1:<port>` 为主 | 一律走 stdio 隧道 | 默认路径最省事、延迟最低；隧道作为 `auto` 兜底（§4.6）。 |
| 跨窗口复用用运行时文件 | 官方式 helper 进程 | 省 ~250 行；一个发行版始终一个 server，避免 data 目录争用。 |
| iCode 用户自备 | 我们打包 Linux 版 | Linux 形态不由我们控制；只检测 + 注入 + 报错。 |
| 市场换源复用上游两个设置（补丁 66，B） | 部署期改 product.json；自造 `product.overrides.json` | 上游设置名管理员已经熟悉，可被策略下发、可写进 `settings.json`，升级不丢；自造文件是第三种机制，要自带解析/校验/迁移。 |
| 离线再加"载荷预置 + VSIX 安装"（C） | 只靠 gallery | 彻底离线时 gallery 必然不可达。 |
| 内网档 = 自建 Open VSX | 仅文件共享 | 用户确认有自建 Open VSX，可浏览/搜索/安装。 |

### 4.2 架构

```
Picket Code (Windows)
├─ 内置扩展 picket-remote-wsl  ── registerRemoteAuthorityResolver('picket-wsl')
│   ├─ components.js   组件目录、状态、安装/更新/卸载、旧版本清理
│   ├─ payload.js      来源解析 → SHA256 校验 → 装进发行版
│   ├─ icode.js        检测 icode、注入 PICKET_ICODE_BIN
│   ├─ preflight.js    WSL 版本、.wslconfig、连接方式选择
│   ├─ resolver.js     authority → {host, port, token}，运行时文件复用
│   ├─ tunnel.js       stdio 隧道（auto 兜底）
│   ├─ tree.js         WSL Targets 树视图的数据源
│   ├─ manage.js       添加/设默认/删除发行版
│   ├─ shim.js         在发行版内安装/移除 CLI shim
│   └─ commands.js     15 条命令（§4.9）
├─ resources/payloads/catalog.json      组件目录（始终存在，几百字节）
├─ resources/wsl-payloads/             载荷（仅 embedded 形态）
└─ 核心补丁 66         gallery 免登录支路 + 关闭哨兵（复用 extensions.gallery.*）

WSL2 发行版
├─ ~/.picket-code-server/payloads/server-<tag>/   bin/picket-code-server, node
├─ ~/.picket-code-server/runtime/<distro>.json    {port, token, tag, pid, startedAt}
├─ ~/.picket-code-server/data/                    --user-data-dir
├─ ~/.picket-code-server/extensions/              --extensions-dir（可预置）
└─ ~/.picket-code-server/logs/
```

启动链路：`spawn('wsl.exe', ['-d', distro, '-e', 'sh', '-lc', 'exec "$0" "$@"', '<server-bin>', ...flags])`（登录 shell，叠加 `PICKET_ICODE_BIN=<abs>` 与可选的 `server-env-setup`），从 stdout 解析 `Extension host agent listening on <port>`，按连接方式交还 `{host, port, connectionToken}`。

### 4.3 组件目录与发布形态

`resources/payloads/catalog.json`（随构建生成，**所有形态都有**）：

```json
{ "components": [ {
    "id": "wsl-server",
    "kind": "server",
    "version": "1.143.1-picket.1-rc.4",
    "file": "picket-code-server-<tag>-linux-x64.tar.gz",
    "size": 87031808,
    "sha256": "…",
    "embedded": true,
    "embeddedPath": "../../wsl-payloads/picket-code-server-<tag>-linux-x64.tar.gz"
} ] }
```

| 形态 | 构建参数 | 安装包内容 | 首次使用 |
|---|---|---|---|
| 内网正式版 | `PICKET_WSL_PAYLOAD=embedded` | catalog + 载荷 | **零交互**，直接从内嵌文件安装（仍校验 SHA256） |
| 公开版 | `PICKET_WSL_PAYLOAD=ondemand` | 仅 catalog | 弹"获取 WSL 支持组件"对话框（自动下载 / 从文件安装 / 取消） |

`embedded` 只影响 UX 与打包，**来源解析、校验、安装、状态机是同一份代码**。

组件状态：`absent / installing / installed(version) / outdated / broken`。状态文件 `<userDataDir>/components.json` 只作缓存，每次以磁盘实际目录为准做校正。

### 4.4 载荷安装

| 项 | 值 |
|---|---|
| 制品 | `picket-code-server-<picketTag>-linux-x64.tar.gz` + 同源 `SHA256SUMS` |
| 版本 | `catalog.version`（= `product.json.picketTag`，构建时盖章） |
| 校验 | SHA256 必须匹配 catalog，失败拒绝安装并清理临时文件 |
| 安装 | `payloads/server-<tag>/`，`--strip-components=1`，先解到 `.tmp-<rand>` 再原子改名 |
| 标记 | `.picket-payload.json`（sha256 / 来源 / 时间），启动只读标记 |

来源优先级（第一个可用者胜出）：

1. `picket.wsl.serverPayloadPath`，或用户在对话框里"从文件安装…"选择的 `tar.gz` / 离线组件包（zip）。
2. 内嵌载荷（仅 `embedded` 形态）。
3. `picket.wsl.serverPayloadBaseUrl`，默认公网镜像（`ondemand` 形态的主要路径）。

第 3 条的网络访问默认直连 + 严格 SSL。代理与私有 CA 已在 v1 实现（原计划记为「已知限制」，2026-11-04 追加）：`picket.wsl.useProxy`（默认 true）开启时读 VS Code 的 `http.proxy`（支持 `http://host:port`、`http://user:pass@host:port`、裸 `host:port`、`off`/`direct`/空，`https://` 代理明确报错）与 `http.proxyStrictSSL`；`picket.wsl.caFile` 指定 PEM 附加信任链。下载器是扩展自带的 HTTP 客户端（`src/download.js`：直连 / HTTP 代理绝对 URI / HTTPS 经 CONNECT 隧道后自行协商 TLS），因为 `fetch` 无法配代理与 CA。仍未支持：`no_proxy`/`NO_PROXY` 主机排除、PAC、`https://` 代理——这些场景走本地文件或离线组件包。下载**与本地来源一样**按随包 `catalog.json` 校验大小与 sha256，代理凭证只进 `Proxy-Authorization`，不进日志。见 `docs/wsl.md`。

**离线组件包**（管理员分发物）：一个 zip，内含 `*.tar.gz` + `SHA256SUMS` + `catalog.json`。用户在"从文件安装…"里选中它即可，零网络、零额外工具。

### 4.5 Resolver 语义

- authority：`picket-wsl+<distro>`，`<distro>` 为空时取默认发行版。
- 复用：启动前读发行版内 `runtime/<distro>.json`；`probe()` 通过且 tag 匹配 → 直接复用（跨窗口、跨重载），不新起进程。
- 探活：`GET http://127.0.0.1:<port>/vscode-remote-resource?tkn=<token>`，**400 = 端口通且 token 对**，403 = token 错，拒绝 = 已死。超时 2 s，重试窗口 `picket.wsl.probeRetrySeconds`（默认 60）。走隧道时探隧道端口。
- 启动方式：`wsl.exe -d <d> -e sh -lc 'exec "$0" "$@"' <payload>/bin/picket-code-server <args…>`。走登录 shell 是为了让发行版 profile 里的 `PATH`（`nvm` / `pyenv` / `conda`）与代理变量生效；二进制与参数一律以**位置参数**传递，不拼 shell 字符串。`<home>/.picket-code-server/server-env-setup` 若存在则先 `source`（与官方同名习惯），供内网注入 `LD_LIBRARY_PATH` / 私有 CA / 代理。
- 启动参数：`--host=127.0.0.1 --port=0 --connection-token=<t> --use-host-proxy --without-browser-env-var --disable-websocket-compression --accept-server-license-terms --user-data-dir=... --extensions-dir=... --log=trace`；token 由 4 段 `crypto.randomInt` 拼接。profile 可能往 stdout 打横幅：端口解析按行匹配，非匹配行只进日志。
- 看护：收到输出即重置计时；默认 90 s 无输出判失败（`picket.wsl.startTimeoutSeconds`）；`exit 99` → "发行版不兼容"。
- 落盘：成功后写 `runtime/<distro>.json`（含 pid），失败清理。
- 停止：`Picket: Stop WSL Server` → 按运行时文件杀进程树 → `wsl.exe -d <d> -e pkill -f 'picket-code-server.*<tag>'` → 删运行时文件。不做"退出即杀"。

### 4.6 连接方式（`picket.wsl.tunnelMode`）

| 值 | 行为 |
|---|---|
| `auto`（默认） | 读 `%USERPROFILE%\.wslconfig` 的 `[wsl2] localhostForwarding`；为 `false` 时走隧道。`networkingMode=mirrored` 时也走隧道，避免两套 localhost 语义混淆。 |
| `direct` | 强制直连（排障）。 |
| `stdio` | 强制隧道（排障或部署策略）。 |

隧道形态：Windows 侧 `net.createServer({ pauseOnConnect: true })` 监听 `127.0.0.1:0`；每条连接一个 `wsl.exe -d <distro> -e <payload>/node -e "<pipe 到 127.0.0.1:<serverPort>>"`，双向管道；VM 内仍绑 `127.0.0.1`。

| 项 | 量 | 说明 |
|---|---|---|
| 隧道主体 | ~100 行 | 监听 + 每连接子进程 + 背压 + 半关闭 |
| preamble 处理 | ~20 行 | `wsl.exe` 会在子进程输出前打印提示；脚本先输出一行魔数，Windows 侧丢弃至该行 |
| 诊断分层 | ~30 行 | 监听 / `wsl.exe` / VM 内 socket 三层分别记录 |
| 生命周期 | ~15 行 | 断开即杀子进程；`deactivate` 关闭监听并清理 |
| 测试（假 `wsl.exe` + 二进制管道） | ~60 行 | Linux 上无法真跑 `wsl.exe` |
| **合计** | **~250 行** | 80% 是边界处理 |

验收：隧道模式下能打开 `/home/<user>`、保存 ≥10 MB 文件、连续重连 20 次不漏 `wsl.exe` 进程。

### 4.7 iCode 检测（用户自备）

检测顺序：`picket.wsl.icodePath` → 发行版内 `command -v icode` → 无。

- 命中：启动 server 时注入 `PICKET_ICODE_BIN=<绝对路径>`。
- 未命中：不阻塞窗口，一次性提示"WSL 里未找到 iCode，AI 功能不可用"，附期望路径与设置项；诊断命令单独列出。

### 4.8 扩展市场三模式（B + C）

**上游机制（先看清它怎么做的）**

- 市场的唯一来源是构建期 `product.json` 的 `extensionsGallery`（`platform/product/common/product.ts:34-36` 从 `globalThis._VSCODE_PRODUCT_JSON` 取），本构建已内置 Open VSX，公开场景开箱可用。
- 换市场是上游已有的两个应用级设置：`extensions.gallery.serviceUrl` 与 `extensions.gallery.authProvider`（`extensions.contribution.ts:344-395`，`included: false`，可被策略 `ExtensionGalleryServiceUrl` 下发）。
- 但 `extensionGalleryManifestService.ts:127-150` 的逻辑是：**配了 serviceUrl 就走账号门禁** —— 拿不到账号 → `RequiresSignIn`；`Ineligible` → `AccessDenied`；只有 `Eligible` 才去拉 manifest，账号 provider 是 GitHub / Microsoft 两家（`extensionGalleryAccountService.ts:362-366`）。也就是说上游这条腿只服务"微软私有市场"，Open VSX 这类**不需要登录**的 gallery 用不了（本构建又没有账号 provider，会永久 `RequiresSignIn`）。

**B｜补丁 66：给上游机制补一条无账号支路**

- `authProvider` 枚举新增 `none`：配了 `serviceUrl` 且 `authProvider = "none"` 时，跳过账号门禁，直接用该 URL 在本地构造 manifest（`buildExtensionGalleryManifest`），状态 `Available`，不发任何请求（避免 `RequiresSignIn`，也避免向不可达域名探活）。
- `itemUrl` 由 `serviceUrl` 按 Open VSX 布局推导（`…/vscode/gallery` → `…/vscode/item`）；布局不符时不生成 item 资源，宁可不给链接也不给 404。
- `serviceUrl = "none"`：manifest 为 `null`、状态 `Unavailable`，不再发任何市场请求（离线部署不必等超时）。
- 显式配 `authProvider = github | microsoft` 时**完全走上游原路**（含登录门禁与 `AccessDenied` 语义），我们不改。
- 默认值仍是 `github`，因此**未配置市场时行为与上游逐字节一致**——这是选它而不是 `inspect()` 猜"是否显式设置"的原因：不依赖配置服务的实现细节，也不会让上游语义悄悄变化。

**命令 `Picket: 选择扩展市场来源`**

三选一，写的就是上面两个设置（用户/`settings.json` 级，等同管理员手写）：

| 模式 | 写入 | 说明 |
|---|---|---|
| Open VSX（默认） | 删除两个键 | 回到构建内置地址，将来换默认值也能跟上，而不是把地址抄进设置 |
| 内网/自建 gallery… | `serviceUrl = <URL>`、`authProvider = "none"` | 地址必须 `http(s)://`，末尾 `/` 去掉；Open VSX 兼容即可（浏览/搜索/安装/详情） |
| 关闭（离线） | `serviceUrl = "none"`、删除 `authProvider` | 扩展只能走"从 VSIX 安装" |

写完提示重载（manifest 在窗口启动时解析一次，上游自己的实现也是弹重启），并提供"重新加载"按钮。诊断命令的 `Gallery:` 行区分 `default (…)` / `custom (…)` / `none (disabled by extension setting)`。

**C｜彻底离线**

- 组件可携带扩展包（`kind: "extensions"`），安装时投放到 `--extensions-dir`，绝不覆盖用户已装扩展（第一版留空）。
- 命令 `Picket: 从 VSIX 安装扩展…`：文件选择器 → `workbench.extensions.installExtension`（远端窗口自动装到远端）。

### 4.9 UX

命令（全部 `Picket:` 前缀）：

1. `Picket: Open Folder in WSL…` — 选发行版（记住默认）+ 路径（默认 `$HOME`）；组件缺失时先走 §4.10。
2. `Picket: Reopen Folder in WSL` — 从本地窗口重开（含 `\\wsl.localhost` 路径）。
3. `Picket: Reopen Folder in Windows`。
4. `Picket: Show WSL Log`。
5. `Picket: Stop WSL Server`。
6. `Picket: 组件…` — 列出组件、状态、版本、占用空间；安装 / 更新 / 卸载 / 从文件安装 / 更换来源 / 清理旧版本（保留当前 + 上一个）。
7. `Picket: 诊断 WSL 支持` — WSL 版本、发行版、`.wslconfig` 关键项、连接方式、组件来源命中、iCode 位置、市场模式、运行时文件状态；可复制。
8. `Picket: 选择扩展市场来源`。
9. `Picket: 从 VSIX 安装扩展…`。
10. `Picket: 添加发行版…` — `wsl --list --online` → 选择 → 在终端里执行 `wsl --install -d <name>`（需要提权时提示用户手动执行）。
11. `Picket: 设为默认发行版` — `wsl --set-default <name>`。
12. `Picket: 删除发行版…` — 模态确认"将永久删除该发行版及其全部数据" → `wsl --unregister <name>`。
13. `Picket: 在 WSL 中安装命令行…` — 写入 shim 与 `~/.local/bin` 符号链接（§4.15）。
14. `Picket: 从 WSL 中移除命令行`。
15. `Picket: 刷新 WSL 目标` — 树视图标题栏按钮；重新枚举发行版。

常驻：命令面板里的命令用 `when` 限定在 Windows 且非 Web（`isWindows && !isWeb`），`Reopen Folder in WSL/Windows` 再按 `remoteName` 与 `workspaceFolderCount` 收窄；同时把"连接 / 连接指定发行版 / 在新窗口连接 / Reopen in Windows / 查看日志 / 诊断"挂进核心的**远程指示器**（`statusBar/remoteIndicator`），并用 `resourceLabelFormatters` 让远端路径显示 `WSL` 后缀——官方把入口放在这里，用户不经过命令面板也能发现。`\\wsl.localhost` 本地窗口里一次性提示"重开可获得原生性能"。

### 4.10 首次使用拦截（仅 `ondemand`）

`Open Folder in WSL…` → 组件 `absent` → 对话框：

> 需要 **WSL 支持组件**（87 MB）。从哪里获取？
> `自动下载`　`从文件安装…`　`取消`

末行提示："离线环境请用『从文件安装…』，选择管理员提供的离线组件包或 `.tar.gz`。" `embedded` 形态跳过此对话框，直接安装内嵌载荷（通知里显示一行进度）。

### 4.11 失败模式与文案原则

| 症状 | 原因 | 提示要点 |
|---|---|---|
| 命令不可用 | 非 Windows / 无 `wsl.exe` | 明确"仅 Windows + WSL2" |
| 发行版列表为空 | 未安装发行版 | 一句话安装指引 |
| 发行版名不存在 | 拼写/别名 | 列出可用发行版 |
| 组件缺失且三条来源都不可用 | 离线且无共享盘 | 列出三条出处 + 离线组件包说明 |
| 下载中断/超时 | 网络 | 显示已下载字节、可重试、可改用"从文件安装" |
| SHA256 不匹配 | 包被截断/换版 | 拒绝安装，指出来源与期望值 |
| 解包失败 / 磁盘满 | 空间或权限 | 指出目标路径与所需空间 |
| `Client refused: version mismatch` | 载荷 tag ≠ `picketTag` | 给出两者当前值，提示更新组件 |
| 启动 90 s 无输出 | 发行版不兼容/缺依赖 | 指向服务端日志，附最后 40 行输出 |
| `localhostForwarding=false` | 直连不可达 | 提示已自动切隧道；隧道不可用则给改法与 `wsl --shutdown` |
| 隧道建立失败 | 三层之一 | 指明哪一层（监听 / `wsl.exe` / VM 内 socket） |
| iCode 未找到 | 用户未装 | 期望路径 + 设置项 + 一次性提示 |
| 无法浏览扩展 | 市场关闭或内网不可达 | 引导"选择扩展市场来源" |
| 同发行版第二个窗口 | 复用运行时文件 | 无提示，日志记 `reused` |

原则：一条消息说清"发生了什么 + 期望是什么 + 下一步做什么"；内部术语（payload、resolver、tunnel）只出现在日志里。

### 4.12 与现有补丁体系的关系

| 编号 | 内容 | 状态 |
|---|---|---|
| 62 | 无默认 agent 时回退 `agentIdSilent` | 已有 |
| 63 | iCode 适配器 | 已有 |
| 64 | changeset 策略 | 已有 |
| 65 | UI 冒烟用例 | 已有 |
| **66** | gallery 免登录支路（`authProvider: none`）+ 关闭哨兵（`serviceUrl: none`） | 新增 |
| 配置 | `product.json` 增加 `picketTag`、`noware.picket-remote-wsl: ["resolvers"]`、内置扩展条目 | 新增 |

### 4.13 `WSL Targets` 树视图与发行版管理

视图 id `picketWsl.targets`，挂在核心的 `remote` 视图容器（proposal `contribViewsRemote`），名称 `WSL 目标`，`when: isWindows && !isWeb`。

- 一级节点 = 发行版：名称 + `（WSL 1）`/`（WSL 2）` 后缀，`default distro` 追加描述，`isDefault` 排首位；`active`（当前窗口 authority 指向它）用图标与 tooltip 区分 `Connected` / `Not Connected`；`docker-desktop*` 过滤掉（除非它是默认发行版）。
- 二级节点**不做**（§2 非目标）。
- 行内与右键：连接当前窗口 / 连接新窗口（`vscode.openFolder` 带 `remoteAuthority`，分别 `forceReuseWindow` / `forceNewWindow`）、设为默认发行版、删除发行版、刷新。
- 标题栏：添加发行版、刷新。
- 空状态（`viewsWelcome`）：未安装 WSL → 安装指引；已装 WSL 但无发行版 → "添加发行版"按钮。
- 发行版名与状态一律来自 `wsl --list --verbose`（§4.4），不读注册表。

### 4.14 登录 shell 与 server 环境

- `sh -lc` 启动（§4.5）让 profile 生效，达到与官方"读 `env --null` 注入 `extensionHostEnv`"同样的效果，且没有 shim 依赖。
- `<home>/.picket-code-server/server-env-setup`（可选，用户可写）在启动前被 source；文档说明它是内网注入代理 / CA / `LD_LIBRARY_PATH` 的唯一入口。
- `PICKET_ICODE_BIN` 仍显式注入，覆盖 profile 里的值；iCode 检测顺序：设置项 → 登录 shell 里的 `command -v icode`。
- 已知限制：只写在 `.bashrc` 且对非交互 shell 提前 return 的 PATH 拿不到——用 `server-env-setup` 兜底，诊断命令会显示 `node` / `git` 是否在 `PATH` 里。

### 4.15 WSL 内 CLI shim（`picket-code .`）

- 载荷已自带 `bin/remote-cli/picket-code`：上游 `server.cli.ts` 在 `VSCODE_CLIENT_COMMAND` 存在时把命令转发给桌面 CLI，并用 `VSCODE_CLI_AUTHORITY` 把文件/文件夹参数映射成远端 URI。我们只需设置这两个变量。
- `Picket: 在 WSL 中安装命令行…` 写入 `<home>/.picket-code-server/bin/<tag>/bin/picket-code`（设 `VSCODE_CLIENT_COMMAND=<Windows 可执行文件，经 wslpath -u 转换>`、`VSCODE_CLI_AUTHORITY=picket-wsl+${WSL_DISTRO_NAME:-}`，再 `exec` 载荷的 remote-cli，参数原样透传），并在 `<home>/.local/bin/picket-code` 建符号链接（已存在且不属于我们则跳过并提示）。
- `picket-code -` 的 stdin 重定向与 `--file` / `--folder-uri` 等参数由上游 CLI 处理，shim 不解释参数。
- `[interop] enabled=false` 时 shim 无法调起 Windows 可执行文件：错误信息点名这一行。
- 组件卸载或 `Picket: 从 WSL 中移除命令行` 时删除符号链接与脚本。

## 5. 组件清单

### 扩展 `extensions/picket-remote-wsl/`（内置）

```
package.json        15 条命令、菜单/视图/资源标签贡献、enabledApiProposals、extensionKind:["ui"]
extension.js        activate/deactivate、日志、注册
src/catalog.js      读 catalog、校验与 product.json 一致性、embedded 判定
src/components.js   状态机（absent/installing/installed/outdated/broken）、安装/更新/卸载/清理
src/distro.js       发行版枚举、默认发行版、$HOME、WSL1 检测
src/preflight.js    WSL 版本、.wslconfig 解析、连接方式选择
src/payload.js      三来源解析、SHA256 校验、下载进度、原子安装、离线 zip 解包、代理/CA
src/icode.js        检测与注入
src/launch.js       参数构造、端口解析、看护、运行时文件读写、停止
src/tunnel.js       stdio 隧道
src/probe.js        400/403/拒绝 三态
src/resolver.js     复用、连接方式选择、探活、重启、dispose
src/remoteUri.js    UNC ↔ 远程 URI
src/commands.js     15 条命令与首次拦截
src/diagnose.js     诊断报告
src/nudge.js        一次性建议（UNC / WSL1 / /mnt/）
src/tree.js         WSL Targets 树视图
src/manage.js       添加/设默认/删除发行版
src/shim.js         安装/移除 CLI shim
src/log.js          OutputChannel + 文件
```

### 客户端构建（`build/`）

- 构建时往 `product.json` 盖章 `picketTag`（取自发布 tag），生成 `resources/payloads/catalog.json`。
- `PICKET_WSL_PAYLOAD=embedded`：拉取同 tag 的 `tar.gz` + `SHA256SUMS` 写入 `resources/wsl-payloads/`，catalog 标 `embedded: true`。
- `PICKET_WSL_PAYLOAD=ondemand`：不写载荷，catalog 标 `embedded: false`。
- `check-contract.sh` 断言：
  1. `catalog.version` == `product.json.picketTag`；
  2. `embedded` 形态：载荷存在且 SHA256 与 catalog 一致；`ondemand` 形态：安装包里**不含** `wsl-payloads/`（防夹带）；
  3. `extensionEnabledApiProposals` 含 `noware.picket-remote-wsl`；
  4. `embedded` 形态安装包体积 ≤ 阈值（+110 MB）。
- 另出"离线组件包"（zip：tar.gz + SHA256SUMS + catalog.json）作为 Release 附件，供无共享盘的现场使用。

### `picket-code-server` 仓库

- 载荷命名与 `SHA256SUMS` 已具备。
- 新增（M3，可留空）：把选定内置扩展打进 `extensions/`。

## 6. 测试策略

| 层 | 内容 | 在哪里跑 |
|---|---|---|
| L1 纯逻辑 | 目录解析与一致性、来源优先级、SHA256SUMS 解析、组件状态机、发行版输出解析、端口解析、参数构造、运行时文件读写、`.wslconfig` 解析、连接方式选择、UNC↔URI、探活三态、代理选项 | `node --test`，Linux CI |
| L2 伪 `wsl.exe` | `--list --verbose`（UTF-16LE + `*` 标记 + version 列）/ `--status` / `-e printenv HOME` / 登录 shell 启动的 argv 形态 / `-e sh -lc 'command -v icode'` / 启动与日志输出 / `wslpath -u` 与 `-w` / 树视图数据（三元组、`docker-desktop` 过滤、active/default 标记）/ 删除与设默认的 argv / shim 的参数映射（假 remote-cli）/ 隧道 preamble；验证解析、看护超时、exit 99、复用、停止兜底、隧道二进制管道、离线 zip 安装 | Linux CI |
| L3 真机 | Windows + WSL2：① 零网络首次打开（embedded）② ondemand 三条来源各一次 ③ 连续两次打开同发行版（复用）④ UNC vs 远程比较 ⑤ 停止后重开 ⑥ VSIX 离线安装 ⑦ 内网 Open VSX 切换 ⑧ `localhostForwarding=false` 隧道 + 大文件 + 20 次重连 ⑨ 端口转发：WSL 里起 3000 端口服务，direct 与 stdio 两模式各访问一次 ⑩ `nvm` 装的 node 在远程任务里可见 ⑪ `picket-code .` 打开当前目录 ⑫ 树视图连接/设默认/删除/添加 ⑬ `docker-desktop` 不在列表 ⑭ `wslpath` 双向（中文与含空格路径） | 发布前人工（RC 亦需全过） |
| L4 构建 | 两种形态的 catalog 一致性、防夹带、白名单、体积阈值、离线组件包自洽 | CI |

真机清单并入 `docs/testing.md` 的六层矩阵。

## 7. 里程碑

- **M1 组件与 resolver**：`catalog.js` + `components.js` + `payload.js` + `launch.js` + `resolver.js`（含运行时文件复用）+ L1/L2 测试；Windows 上手动打开 `/home/<user>`。
- **M2 UX 与 iCode**：15 条命令、`WSL Targets` 树视图与发行版管理、诊断、一次性建议（UNC / WSL1 / `/mnt/`）、iCode 检测与注入、`preflight.js`（`.wslconfig` 检测）、首次拦截对话框、失败通知的动作按钮、错误文案逐条落地。
- **M3 市场三模式与 CLI shim**：补丁 66（`authProvider: none` 免登录支路 + `serviceUrl: none` 关闭哨兵）+ 选择来源命令 + VSIX 安装 + 组件携带扩展包的通道 + `shim.js`（安装/移除 `picket-code .`）。
- **M4 打包、隧道与验收**：`picketTag` 盖章、catalog 生成、两形态打包与 `check-contract` 断言、离线组件包、`tunnel.js`、8 项真机清单、文档增补（`docs/wsl-icode.md` 加"A′ 落地版"）。

## 8. 留给实现者的决定

- 设置项键名与默认值（`picket.wsl.*` 之下）。
- 组件状态文件、标记文件、运行时文件的字段；日志位置与轮转。
- 隧道 preamble 魔数格式与超时；隧道监听端口分配。
- 下载的分块大小与进度节流（建议 ≥100 ms 一次 UI 更新）。
- 诊断报告的具体格式。
- 状态栏是否自建条目（当前判断：不需要）。
- `runtime/<distro>.json` 的并发写入策略（临时文件 + rename，配合 `O_EXCL` 首启锁）。

## 9. 合规与来源

实现依据仅限：我们自己的 server 契约（`serverEnvironmentService.ts`、`--help`）、VS Code 开源侧契约（`vscode.proposed.resolvers.d.ts`、`extHostExtensionService.ts`）、公开文档、以及对官方扩展**可观察行为**的认知。不复制其代码、文案、图标、命令 id；不记录或使用 vsda 相关的逆向细节。`spikes/picket-remote-wsl/` 为一次性参考实现，逐块复核后才可提升。

## 10. 决策记录（背景与代价）

| 决策 | 背景 | 代价 / 边界 |
|---|---|---|
| 双发布形态 | 内网要零交互，公开版要小安装包 | 打包与 CI 多一条形态断言；运行时代码不分叉 |
| 组件模型 + 离线组件包 | 按需安装遇到完全离线会装不上 | 首次使用多一步交互；管理员需分发离线包 |
| 盖 `picketTag` | 握手比 commit，载荷名用发布 tag，运行时无锚点 | 构建多一步；换来出厂前可比对 |
| 运行时文件复用 | 每次 resolve 都起 server，多窗口共享 data 目录有争用风险 | 需处理同 tag 判等与首启锁 |
| 90 s 无输出看护 | 只有"起来但不打日志"需要看护；固定总超时误杀冷启动 | 超时消息需附最后 40 行输出 |
| 不做退出即杀 | 重载/重启不掉历史 | 需显式停止命令与 pid 清理 |
| iCode 缺失不阻塞 | 编辑器/终端/搜索仍可用 | 靠一次性提示与诊断兜住 |
| stdio 隧道作为 auto 兜底 | 直连依赖 localhost 中继 | ~250 行，80% 是流边界与进程生命周期 |
| v1 做 `WSL Targets` 树视图与管理 | 官方的主入口就是这棵树；只有命令面板会明显损害发现性 | +~250 行、多一个 proposal（`contribViewsRemote`）；树里不做"最近文件夹" |
| 登录 shell 启动 server | 官方靠 CLI shim 读 `env --null` 才有完整 PATH；`sh -lc` 达到同样效果且无 shim 依赖 | profile 横幅进日志；只写在 `.bashrc` 的 PATH 仍可能缺失，用 `server-env-setup` 兜底 |
| CLI shim 进 v1 | walkthrough 最后一步就是 `code .`；上游 `server.cli.ts` 已实现转发 | 需要 interop；符号链接进 `~/.local/bin` 需告知用户 |
| `--list --verbose` 而非 `-l -q` | 只有 verbose 输出带默认发行版标记与 WSL 版本列 | 解析 UTF-16LE 与列对齐；`docker-desktop*` 需过滤 |
| 失败通知带动作按钮（重试/关闭窗口/查看日志） | 一次启动失败就重启整个窗口，代价太高 | 文案与状态机略复杂 |
| 端口转发不额外实现 | workbench 的转发请求走已有 agent 连接，server 在 VM 内建连 | 必须在 L3 两模式下各验一次 |
| 市场换源复用上游 `extensions.gallery.*`（D-16） | 自造 `product.overrides.json` 覆盖 `product.json`，并隐藏两个设置 | 上游设置名可被策略下发、可写 `settings.json`、升级不丢；`included: false` 本来就藏在设置编辑器之外，没有"用户误入"问题。代价是补丁 66 动了 core 的 manifest 服务一处分支，需用例守住"默认配置下与上游一致" |
| 免登录用新增枚举 `authProvider: none`，而不是"没配就是免登录" | 用 `configurationService.inspect()` 判断 authProvider 是否被显式设置 | `inspect()` 的语义依赖实现细节（测试替身无法如实表达），且会让上游默认语义悄悄变化；显式枚举可被 registry 校验、自解释，默认仍是 `github` → 零行为变更 |
| 关闭市场用 `serviceUrl: "none"` 哨兵 | 空字符串（上游视为"未配置"）；指向不可达地址 | 空值有既有含义，不能复用；哨兵是一个明确状态，诊断能说清，离线时不发请求也不等超时 |
