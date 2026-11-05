# 在 WSL 中使用 Picket Code

本发行版**内置** WSL 支持（扩展 `noware.picket-remote-wsl`），不需要手工预置服务端。
前提有两个：目标发行版能用 `wsl.exe -d <发行版> -e sh -lc ...` 跑命令，且**官方
Remote-WSL 扩展已卸载**（它装在本产品上时，WSL 功能整体关闭，见下节）。

不支持的场景：WSL1、ARM64 发行版、Alpine（musl）、Windows Server、在远程窗口里
再开远程窗口、浏览器版窗口。判断依据见本文件末的「已知限制」。

## 快速上手

1. Windows 上启动 Picket Code。
2. 命令面板执行 `Picket: Open Folder in WSL…`，选发行版 → 选文件夹。
3. 首次打开会取服务器载荷（见下节「组件来源」），装好后窗口连上去，左下角远程
   指示器显示 `WSL`。

已有本地窗口想换到 WSL：`Reopen Folder in WSL`。反向：`Reopen Folder in Windows`。

## 与官方 Remote-WSL 扩展的关系

本扩展与微软官方 `ms-vscode-remote.remote-wsl` 是**替代关系，不能共存**：两者抢同一个
`wsl+` 授权前缀、同一份 `~/.vscode-server` 目录、同一个服务端口，允许"同时装着、只用一个"
只会让用户在两次窗口重载之间得到随机结果。所以官方扩展**只要装着**（启用、禁用、是否激活
都算），本产品的 WSL 功能就整体关闭：

- `WSL 目标` 视图只剩一条"已禁用：检测到官方 Remote-WSL 扩展"；
- 所有 `Picket: …` WSL 命令从命令面板与远程指示器菜单里隐藏，只留 `诊断 WSL 支持` 与
  `如何卸载官方 Remote-WSL 扩展`（也就是出去的那条路）；
- 用 `picket-wsl+<发行版>` 或 `wsl+<发行版>` 打开文件夹会失败。

**卸载不会删除任何数据**——`~/.vscode-server` 里的服务器、扩展、设置、钩子，Windows 侧的
用户设置与下载缓存全部保留，本产品接管后直接使用（`wsl+<发行版>` 的旧工作区地址也会被自动
规范化）。三种卸载方式（禁用提示一键卸载 / 扩展视图 / 命令行）、保留清单与确认方法见
[`docs/uninstall-official-remote-wsl.md`](uninstall-official-remote-wsl.md)，扩展内也有
`Picket: 卸载官方 Remote-WSL 扩展（保留数据）` 与 `Picket: 如何卸载官方 Remote-WSL 扩展`。

从官方扩展迁过来的设置也会被读取：`remote.WSL.serverProbeRetryTimeout`（秒，0 表示不重试，
上限 300 秒）与 `remote.WSL.useShellEnvironment`（等价于 `picket.wsl.shell = login`）照旧生效；
其余 `remote.WSL.*` 描述的是官方服务端自己的构建方式，本产品不适用，`Picket: 诊断 WSL 支持`
会逐条列出被忽略的键与原因，不静默丢。

## 组件来源

窗口要连的服务器是 `picket-code-server-<版本>-linux-x64.tar.gz`（约 84 MB），它由独立仓库
`noware-cn/picket-code-server` 单独发行、**版本号独立演进**：本产品对它的要求只有两条——同一
个 vscode commit（握手时比对），以及版本不低于随包的 `catalog.json` 里写死的 `minVersion`。
所以升级服务端不必跟着客户端发版。三来源，优先级从高到低：

| 来源 | 设置 | 说明 |
|---|---|---|
| 本地文件 | `picket.wsl.serverPayloadPath` | 指向 tar.gz 或离线组件包解开后的 tar.gz；优先级最高，适合内网/无外网 |
| 随包内嵌 | — | 正式内网版（`PICKET_WSL_PAYLOAD=embedded`）内置载荷，首次零交互 |
| 下载 | `picket.wsl.serverPayloadBaseUrl` | 留空即不联网；填你自己的镜像根地址，扩展按**随包**的 `catalog.json` 校验下载到的文件的 sha256 与大小 |

公开版是**按需下载**（`ondemand`）：首次打开 WSL 文件夹会提示「自动下载 / 从文件
安装 / 取消」。SHA256 校验不通过一律拒绝安装——不要绕过它。

### 代理与自签证书

下载走扩展自己的 HTTP 客户端（不是 `fetch`，它没法配代理和 CA），因此可以直接吃
VS Code 的代理设置：

- `http.proxy`：支持 `http://host:port`、`http://user:pass@host:port`、裸 `host:port`，
  以及 `off` / `direct` / 留空（直连）。`https://` 代理不支持（会明确报错而不是静默直连）。
- `http.proxyStrictSSL`：设为 `false` 连同证书校验一起关掉；默认严格校验。
- `picket.wsl.useProxy`：默认 `true`。设为 `false` 则下载永远直连——当 `http.proxy`
  是给浏览器/扩展市场用的、而镜像在内网直连可达时用这个。
- `picket.wsl.caFile`：PEM 文件路径，附加到下载时的信任链，用于内网镜像的自签证书。
  读不到文件会直接报错并指出路径，而不是抛一个语焉不详的 TLS 握手失败。

仍未支持：`no_proxy` / `NO_PROXY` 的按主机排除、PAC 脚本、`https://` 代理。这些场景请
用「从文件安装」或离线组件包。

不管走哪条路，SHA256 与大小都会按随包的 `catalog.json` 校验，校验失败一律拒绝安装。
代理凭证只用于 `Proxy-Authorization`，不进日志、不进状态文件。

`Picket: 组件…` 可以查看当前装了哪些版本、重新安装、清理旧版本（换来源改
`picket.wsl.serverPayloadPath` 设置，或用「从文件安装」）。

## 发行版管理

`WSL 目标` 视图（活动栏 `Remote Explorer` 容器内）列出所有可见发行版，掉 docker
自带的两个（`docker-desktop`、`docker-desktop-data`）。

- `Picket: 添加发行版…` / `设为默认发行版` / `删除发行版…` —— 调 `wsl.exe` 的
  安装/设置/卸载（也可以用 `wsl --install` 之类的原生命令，两边等价）。
- `picket.wsl.defaultDistro`：命令与文件夹对话框默认用哪个发行版；留空用 WSL
  自己的默认值。
- `Picket: 刷新 WSL 目标`：视图每次展开都会重新执行 `wsl --list --verbose`，发行版
  装/删之后点一下即可。

## 窗口里的终端与 iCode

服务器用**登录 shell**（`sh -lc`）启动，所以发行版里 `~/.profile`、`~/.bashrc`
导出的环境变量对窗口内所有进程可见。

如果你在发行版里装了 iCode，扩展会执行 `command -v icode` 并把它以
`PICKET_ICODE_BIN` 注入服务器，iCode 的 agent 就能被窗口内的 agent host 找到。
装在不常见的位置时用 `picket.wsl.icodePath` 指定绝对路径；指错了不会阻塞窗口，只是
这一项不生效（`Picket: 诊断 WSL 支持` 会显示实际结果）。

需要额外的初始化钩子：在发行版里建 `~/.vscode-server/server-env-setup`（普通
shell 脚本），服务器启动前会被 source。

## 命令行

`Picket: 在 WSL 中安装命令行…` 在发行版里放一个 `picket-code` shim（脚本在
`~/.vscode-server/bin/picket-<版本>/bin/picket-code`，链接在 `~/.local/bin/picket-code`）。
如果 `~/.local/bin/code` **还是空的**，会顺手链一份 `code` 别名；已经存在（比如官方 Remote-WSL
装的那个，或者你自己装的）就不动它——要用哪个名字都会明确告诉你。`~/.local/bin`
必须在该发行版的 `PATH` 里——绝大多数发行版默认如此，若提示 `command not found` 就往
`~/.profile` 里加一行。之后在发行版终端里：

```bash
cd ~/projects/foo
picket-code .          # 在 Windows 侧打开一个指向该目录的窗口
picket-code            # 打开该发行版的 home
```

卸载：`Picket: 从 WSL 中移除命令行`。它只删我们自己写的脚本和链接——`code` 若已指向别处
（被别的工具占用）会原样留下。

## 扩展市场

本构建没有微软账号服务，`marketplace.visualstudio.com` 走不通（它要求登录）。所以
市场来源默认是 **Open VSX**，可在命令面板用 `Picket: 选择扩展市场来源` 切换：
Open VSX / 自定义地址 / 关闭。

内网没有市场时用 `Picket: 从 VSIX 安装扩展…`，或把扩展目录投放到启动参数
`--extensions-dir` 指向的位置。WSL 窗口里的扩展要装在**发行版侧**：切换窗口后
从「扩展」视图安装即可，装的是 WSL 那一侧。

## 排障

- `Picket: Show WSL Log`：本扩展的输出（`wsl.exe` 调用、载荷安装、服务器启动行）。
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

全在发行版里，不写 Windows 侧。数据根是 **`~/.vscode-server`**——和官方 Remote-WSL 用的
是同一个目录，这正是"卸载官方扩展不丢任何东西"的原因：

```
~/.vscode-server/
├── bin/picket-<服务器版本>/     载荷（node、out/、bin/picket-code-server、remote-cli）
├── bin/<官方 commit>/           官方扩展装的那份服务器（接管后保留但不再使用）
├── data/                        服务器 user-data（日志在 data/logs/<时间戳>/），与官方共用
├── extensions/                  发行版侧扩展，与官方共用
└── server-env-setup             可选：服务器启动前的钩子脚本，与官方共用

~/.picket-code-server/           本产品私有的运行状态
├── runtime/<发行版>.json        当前服务器的 port/token/pid/版本/tunnelMode
└── runtime/<发行版>.json.lock   启动锁（启动中窗口持有）
```

只有 `~/.picket-code-server/` 是本产品私有的；其余位置与官方扩展重叠，所以两者不能同时工作。
旧的载荷版本不会自动删；`Picket: 组件…` → 「清理旧版本」只保留当前版本，或直接
`rm -rf ~/.vscode-server/bin/picket-<旧版本>`（别删 `bin/<40 位 commit>` 目录，那是官方
服务器，删了不影响本产品，但会让"装回官方扩展"重新下载一次）。

## 停止与清理

- `Picket: Stop WSL Server`：停止该发行版的服务器。窗口关掉**不会**停服务器（重开
  窗口直接复用，这正是「一个发行版一个服务器」的实现方式）。
- 彻底清理：先在每个窗口执行 Stop，再 `rm -rf ~/.picket-code-server ~/.vscode-server`。
  **注意** `~/.vscode-server` 是共用的：这一步会连在 WSL 里装的扩展、设置与日志一起删掉，
  官方扩展装回来也要重新下载服务器。只想清本产品的部分，就只删
  `~/.picket-code-server` 与 `~/.vscode-server/bin/picket-*`。

## 已知限制

- **只在 Windows 客户端 + WSL2 上工作**。Linux/macOS 客户端上没有 `wsl.exe`；视图
  声明了 `when: isWindows`，在这些平台上不可见。
- **必须卸载官方 Remote-WSL 扩展**（`ms-vscode-remote.remote-wsl`）。它在，本产品的 WSL
  功能就整体关闭，没有"只用一个"的开关。
- 一个发行版一个服务器、一份 `data/`。想同时跑两套配置请用两个发行版。
- 需要 `localhostForwarding` 或 `networkingMode=mirrored` 的机器走 stdio 隧道（自动
  选择），隧道是每窗口一条，重连频繁时开销高于直连。
- 没有遥测；没有 WSL1 支持；不支持在 WSL 窗口里再开一层远程。
- 市场来源切换是**构建级**能力（`product.overrides.json`），不是每个扩展单独开关。
- 下载只支持 HTTP 代理，不支持 `https://` 代理、PAC 与 `no_proxy` 主机排除。

## 相关文档

- 卸载官方 Remote-WSL 扩展（保留数据）：[`docs/uninstall-official-remote-wsl.md`](uninstall-official-remote-wsl.md)
- 服务端版本策略（独立演进 + 最低版本要求）：[`docs/wsl-server-releases.md`](wsl-server-releases.md)
- 验收矩阵与自动化分层：[`docs/testing.md`](testing.md)、[`docs/wsl-verification.md`](wsl-verification.md)
- 真机手工清单（7 项）：[`docs/wsl-verification.md`](wsl-verification.md)
- 设计取舍与决策记录：[`docs/superpowers/specs/2026-11-04-picket-wsl-design.md`](superpowers/specs/2026-11-04-picket-wsl-design.md)
- 已退役（微软 Remote-WSL 侧载的旧做法，只作历史参考）：[`docs/manual-remote-wsl.md`](manual-remote-wsl.md)
