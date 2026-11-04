# 在 WSL 中使用 Picket Code

本发行版**内置** WSL 支持（扩展 `noware.picket-remote-wsl`），不需要微软
Remote-WSL 扩展，也不需要手工预置服务端。前提只有一个：目标发行版能用
`wsl.exe -d <发行版> -e sh -lc ...` 跑命令。

不支持的场景：WSL1、ARM64 发行版、Alpine（musl）、Windows Server、在远程窗口里
再开远程窗口、浏览器版窗口。判断依据见本文件末的「已知限制」。

## 快速上手

1. Windows 上启动 Picket Code。
2. 命令面板执行 `Picket: Open Folder in WSL…`，选发行版 → 选文件夹。
3. 首次打开会取服务器载荷（见下节「组件来源」），装好后窗口连上去，左下角远程
   指示器显示 `WSL`。

已有本地窗口想换到 WSL：`Reopen Folder in WSL`。反向：`Reopen Folder in Windows`。

## 组件来源

窗口要连的服务器是 `picket-code-server-<tag>-linux-x64.tar.gz`（约 84 MB）。三来源，
优先级从高到低：

| 来源 | 设置 | 说明 |
|---|---|---|
| 本地文件 | `picket.wsl.serverPayloadPath` | 指向 tar.gz 或离线组件包解开后的 tar.gz；优先级最高，适合内网/无外网 |
| 随包内嵌 | — | 正式内网版（`PICKET_WSL_PAYLOAD=embedded`）内置载荷，首次零交互 |
| 下载 | `picket.wsl.serverPayloadBaseUrl` | 默认公网镜像；需要同目录下有 `catalog.json` 与 `SHA256SUMS` |

公开版是**按需下载**（`ondemand`）：首次打开 WSL 文件夹会提示「自动下载 / 从文件
安装 / 取消」。SHA256 校验不通过一律拒绝安装——不要绕过它。

内网 HTTPS 自签证书：`picket.wsl.caFile` 指向 PEM 文件。

`Picket: 组件…` 可以查看当前装了哪些版本、换来源、清理旧版本。

## 发行版管理

`WSL 目标` 视图（活动栏 `Remote Explorer` 容器内）列出所有可见发行版，掉 docker
自带的两个（`docker-desktop`、`docker-desktop-data`）。

- `Picket: 添加发行版…` / `设为默认发行版` / `删除发行版…` —— 调 `wsl.exe` 的
  安装/设置/卸载（也可以用 `wsl --install` 之类的原生命令，两边等价）。
- `picket.wsl.defaultDistro`：命令与文件夹对话框默认用哪个发行版；留空用 WSL
  自己的默认值。
- `Picket: 刷新 WSL 目标`：`wsl --list --verbose` 的输出缓存到视图里，发行版装/删
  之后点一下即可。

## 窗口里的终端与 iCode

服务器用**登录 shell**（`sh -lc`）启动，所以发行版里 `~/.profile`、`~/.bashrc`
导出的环境变量对窗口内所有进程可见。

如果你在发行版里装了 iCode，扩展会执行 `command -v icode` 并把它以
`PICKET_ICODE_BIN` 注入服务器，iCode 的 agent 就能被窗口内的 agent host 找到。
装在不常见的位置时用 `picket.wsl.icodePath` 指定绝对路径；指错了不会阻塞窗口，只是
这一项不生效（`Picket: 诊断 WSL 支持` 会显示实际结果）。

需要额外的初始化钩子：在发行版里建 `~/.picket-code-server/server-env-setup`（普通
shell 脚本），服务器启动前会被 source。

## 命令行

`Picket: 在 WSL 中安装命令行…` 在发行版里放一个 `picket-code` shim（`~/bin`，并把
它加进 `PATH`）。之后在发行版终端里：

```bash
cd ~/projects/foo
picket-code .          # 在 Windows 侧打开一个指向该目录的窗口
picket-code            # 打开该发行版的 home
```

卸载：`Picket: 从 WSL 中移除命令行`。

## 扩展市场

本构建没有微软账号服务，`marketplace.visualstudio.com` 走不通（它要求登录）。所以
市场来源默认是 **Open VSX**，可在命令面板用 `Picket: 选择扩展市场来源` 切换：
Open VSX / 自定义地址 / 关闭。

内网没有市场时用 `Picket: 从 VSIX 安装扩展…`，或把扩展目录投放到启动参数
`--extensions-dir` 指向的位置。WSL 窗口里的扩展要装在**发行版侧**：切换窗口后
从「扩展」视图安装即可，装的是 WSL 那一侧。

## 排障

- `Picket: 显示 WSL 日志`：本扩展的输出（`wsl.exe` 调用、载荷安装、服务器启动行）。
- `Picket: 诊断 WSL 支持`：逐项检查 `wsl.exe` 是否可用、发行版列表、载荷版本、
  运行时文件与端口、连接方式、iCode 检测结果。
- 连不上时先看运行时的磁盘状态（见下节）：`runtime/<发行版>.json` 里记着
  `port`、`pid`、`tag`、`tunnelMode`。文件在但端口不通 = 服务器被杀或崩了。
- 启动超时：`picket.wsl.startTimeoutSeconds`（默认 90 秒无输出判死）。
- 退出码 99 表示发行版与客户端 OS 不兼容（WSL 自己的约定），不是我们的 bug。
- 连接方式：`picket.wsl.tunnelMode = auto`（默认）读 `%USERPROFILE%\.wslconfig`：
  `localhostForwarding=false` 或 `networkingMode=mirrored` 时自动走 stdio 隧道；
  也可以手动钉死 `direct` / `stdio`。

## 磁盘布局

全在发行版里，不写 Windows 侧：

```
~/.picket-code-server/
├── payloads/server-<tag>/       服务器载荷（解包后，含 node 与 out/）
├── runtime/<发行版>.json        当前服务器的 port/token/pid/tag/tunnelMode
├── runtime/<发行版>.json.lock   启动锁（启动中窗口持有）
├── data/                        服务器 user-data（日志在 data/logs/<时间戳>/）
├── extensions/                  发行版侧扩展
└── server-env-setup             可选：服务器启动前的钩子脚本
```

旧的载荷版本不会自动删；`Picket: 组件…` 里可以清理，或直接 `rm -rf payloads/server-<旧 tag>`。

## 停止与清理

- `Picket: Stop WSL Server`：停止该发行版的服务器。窗口关掉**不会**停服务器（重开
  窗口直接复用，这正是「一个发行版一个服务器」的实现方式）。
- 彻底清理：先在每个窗口执行 Stop，再 `rm -rf ~/.picket-code-server`（会连日志和已
  装扩展一起删掉）。

## 已知限制

- **只在 Windows 客户端 + WSL2 上工作**。Linux/macOS 客户端上没有 `wsl.exe`；视图
  声明了 `when: isWindows`，在这些平台上不可见。
- 一个发行版一个服务器、一份 `data/`。想同时跑两套配置请用两个发行版。
- 需要 `localhostForwarding` 或 `networkingMode=mirrored` 的机器走 stdio 隧道（自动
  选择），隧道是每窗口一条，重连频繁时开销高于直连。
- 没有遥测；没有 WSL1 支持；不支持在 WSL 窗口里再开一层远程。
- 市场来源切换是**构建级**能力（`product.overrides.json`），不是每个扩展单独开关。

## 相关文档

- 验收矩阵与自动化分层：[`docs/testing.md`](testing.md)、[`docs/wsl-verification.md`](wsl-verification.md)
- 真机手工清单（4 项）：[`docs/wsl-verification.md`](wsl-verification.md)
- 设计取舍与决策记录：[`docs/superpowers/specs/2026-11-04-picket-wsl-design.md`](superpowers/specs/2026-11-04-picket-wsl-design.md)
- 旧方法（微软 Remote-WSL 侧载，已不再需要）：[`docs/manual-remote-wsl.md`](manual-remote-wsl.md)
