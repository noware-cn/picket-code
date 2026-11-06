# 在 WSL 中使用（旧方法，已不再需要）

::: tip 本发行版已内置 WSL 支持
从 v1.143.1 起，Picket Code 自带 WSL 支持（内置扩展 + 自有服务器载荷），**不需要**
侧载微软 Remote-WSL、也不需要手工预置 VS Code Server。用法见
[`docs/wsl.md`](https://github.com/dantesun/picket-code/blob/main/docs/wsl.md)。

下面这份文档保留作为历史方案与合规分析的对照：它是内置方案出现之前，"个人自用、
自备微软组件"的走法，以及为什么当时只能这么做（Remote Development 许可的限制）。
:::

用 Picket Code 打开 WSL 发行版里的工程，靠的是**微软的 Remote-WSL 扩展 + 微软的 VS Code Server**。这两样都不随本发行版分发，需要自己在机器上补。它在本发行版上能跑通，前提是三个条件同时成立，缺一个就会卡在扩展激活、会话创建或握手校验上。

::: warning 适用范围
仅在**个人自用**、自备微软组件的前提下可行。发行版不内置、不镜像、不提供一键安装器——把这两样东西打进去或对外提供都违反微软的 Remote Development 许可。判断依据与条款原文见仓库文档 [手工安装 Remote-WSL 与 VS Code Server](https://github.com/dantesun/picket-code/blob/main/docs/manual-remote-wsl.md) 第九节。
:::

## 三个前提

| 前提 | 为什么 |
|---|---|
| Picket Code **v1.143.1 及以后** | `product.json` 需含 `extensionEnabledApiProposals`，为 `ms-vscode-remote.remote-wsl` 放行 `resolvers`、`contribRemoteHelp`、`contribViewsRemote`、`telemetry`。缺了它扩展激活即报 `CANNOT use API proposal: resolvers` |
| 手工侧载 Remote-WSL（当前 `1.104.7`） | 扩展不在市场里对你的发行版可见；侧载时**不能改** `package.json` 的 `engines.vscode` |
| 手工预置服务端载荷 | 发行版的 `commit` 与微软 CDN 上的 `stable` 不同，扩展的自动下载按 `product.json` 的 `quality` 拼 URL，取不到对应版本 |

版本号必须是裸的 `X.Y.Z`：

```bash
"<Picket Code>/bin/picket-code" --version     # 期望 1.143.1
```

带 `+p` 或一段 commit 的旧构建装不了任何扩展，先换包。

## 步骤

### 1. 装扩展

```powershell
& "<Picket Code>\Picket Code.exe" --install-extension .\ms-vscode-remote.remote-wsl-1.104.7.vsix
& "<Picket Code>\Picket Code.exe" --list-extensions      # 确认已列出
```

GUI 等价操作：扩展面板 → `···` → 从 VSIX 安装。

### 2. 补客户端 `vsda` 桩

扩展激活时会用 `vsda` 做一次"是否微软正版"的技术判定。在应用目录放一个同名空实现即可让探测通过——它**改动的是应用目录，换包即失效**，不会跟着发行版走：

```powershell
$vsda = "<Picket Code>\resources\app\node_modules\vsda"
New-Item -ItemType Directory -Force $vsda | Out-Null
'{ "name": "vsda", "version": "0.0.0", "main": "index.js" }' | Set-Content "$vsda\package.json"
'module.exports = { signer: 1, validator: 1 };'        | Set-Content "$vsda\index.js"
```

导出值故意不是构造函数，核心的 `sign()` / `validate()` 会落进既有的 `try{…}catch{}`，退化为"不签名"——与当前缺少 `vsda` 时的行为一致。

`VSCODE_DEV=1` 这条路在压缩构建上**走不通**：NLS 消息表不再装载，启动即抛 `!!! NLS MISSING`。

### 3. 预置服务端载荷

在**目标发行版内部**执行（写的是 `$HOME`，多发行版各跑一遍）：

```bash
# 在线：从 Windows 安装里读 commit / quality
bash build/manual-wsl-server.sh \
  --product-json /mnt/d/Downloads/picket-code-win32-x64/resources/app/product.json

# 离线：两段归档已在本地
bash build/manual-wsl-server.sh --commit <40 位 sha> \
  --cli-tar /mnt/d/vscode_cli_linux_x64_cli.tar.gz \
  --server-tar /mnt/d/vscode-server-linux-x64.tar.gz
```

脚本做四件事：`code` 改名为 `code-cli`、server 用 `--strip-components 1` 解开、补 `bin/picket-code-server` 入口、把载荷 `product.json` 改成本项目的值。**最后一步不能省**——数据目录由 server 自己的 `product.json`（`serverDataFolderName`）决定，`wslServer.sh` 的第 4 个参数只用于定位 `bin/`，从不传给 server；不改就会写进 `~/.vscode-server`，与已装的 VS Code 共用 logs、globalStorage 和扩展。

## 验证

打开 WSL 窗口后看 `Remote-WSL: Show Log`，按顺序出现即可：

```
authorityHierarchy: wsl+ubuntu
WSL extension activating for a local WSL instance
… Probing if server is already installed … install-found x86_64
```

在 WSL 里独立交叉验证：

```bash
pgrep -af "out/server-main.js"        # 应有 --port=… --connection-token=…
ls ~/.picket-code-server/data/logs    # 时间戳目录应在这里，而不是 ~/.vscode-server
```

## 常见卡点

| 现象 | 原因 |
|---|---|
| `CANNOT use API proposal: resolvers` | `product.json` 缺提案白名单（v1.143.1 之前） |
| `command 'remote-wsl.openFolder' not found` | 扩展激活失败，往上翻第一条 `ERR` |
| `Wsl/Service/E_UNEXPECTED` | WSL 会话层故障，与扩展无关：`wsl --shutdown` 后重试 |
| 日志里出现 `Downloading VS Code Server` | 服务端载荷没被认出，检查 `bin/<commit>` 与 `bin-cli/<commit>` 是否都在 |
| WebSocket 建连成功、`5/6` 后 `Unauthorized client refused` | 服务端载荷里的 `vsda` 没移开——客户端是桩、签不出真签名，只有服务端没有校验器时才放行（脚本已自动重命名为 `vsda.disabled`） |

## 不想装扩展的话

目的只是"在 Windows 上编辑 WSL 里的工程"时，可以直接打开 `\\wsl.localhost\Ubuntu\home\<user>\...`，或在 WSL 内启动 `picket-code .` 走 WSLg 显示。代价是文件监听与端口转发要自己处理。
