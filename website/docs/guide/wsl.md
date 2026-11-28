# 在 WSL 中使用

Picket Code 自带 WSL 支持：一个内置扩展（`noware.picket-remote-wsl`）加一份**我们自己的 Linux 服务端载荷**。不需要侧载微软 Remote-WSL，也不需要手工预置 VS Code Server——首次连接时客户端自己把载荷装进目标发行版，之后每次开窗口都复用它。

> 官方 `ms-vscode-remote.remote-wsl` **必须卸载**。两个扩展抢同一个 `wsl+` authority 和同一个服务器端口，先解析到的那个独占文件夹。只要官方扩展还装着（启用、禁用、未激活都算），本扩展的所有 WSL 功能一律关闭。Picket Code 使用**独立数据根** `~/.picket-code-server`（不与 VS Code 共用），所以卸载官方扩展既不会删你的 VS Code 数据，也不影响本客户端自己的数据。

## 前提

| 项目 | 要求 |
|---|---|
| 宿主 | Windows 10 1903+ 或 Windows 11（需要 `\\wsl.localhost` 共享） |
| WSL | WSL2 + 至少一个发行版；`wsl -l -v` 能看到 |
| 客户端 | Picket Code **Windows x64** 包；WSL 支持不出现在 Linux/macOS 包与 Web 版里 |
| 官方扩展 | 已卸载（下面三条命令都能处理） |

WSL1、ARM64 发行版、Alpine 暂不支持。

## 首次连接

三条入口等价，任选一条：

1. **WSL 目标视图**：左侧「远程资源管理器」→ **WSL 目标**，点发行版上的打开图标；
2. **命令面板** → `Picket: Open Folder in WSL…` → 选发行版 → 在弹出的对话框里选文件夹（对话框直接落在该发行版的 `$HOME`，走 `\\wsl.localhost\<发行版>\...`）；
3. 已经用「文件 → 打开文件夹」打开了 `\\wsl.localhost\<发行版>\...`，再执行 **`Picket: Reopen Folder in WSL`**。

第一次连某个发行版时，客户端会问「WSL 里还没有服务器组件。从哪里获取？」，三选一：

| 选项 | 用在哪 |
|---|---|
| **自动下载** | 能出网时最省事：默认从镜像 `download.noware.cn` 取，取不到再回退到服务端仓的发行资产，两者都按 catalog 校验 |
| **从文件安装…** | 内网、气隙、镜像被拦时：先手工下载 `picket-code-server-<version>-linux-x64.tar.gz`（镜像根目录或 `noware-cn/picket-code-server` 的 `server-v<version>` 发行页），再选中它 |
| **取消** | 什么都不做，窗口不会开 |

装好之后窗口自动打开，之后再连同一发行版不再询问。

## 服务器载荷

载荷是 `picket-code-server-<server 版本>-linux-x64.tar.gz`（约 88 MB，扁平 tar，含 `bin/`、`out/`、`product.json`）。来源优先级：

1. `picket.wsl.serverPayloadPath` 指向的本地文件；
2. 构建内嵌的载荷（内网正式版才有，首次零交互）；
3. `picket.wsl.serverPayloadBaseUrl` 下的同名文件（配了就只用它）；
4. 都没配时：镜像 `https://download.noware.cn`，其次 `noware-cn/picket-code-server` 的 `server-v<version>` 发行资产。多个候选会依次尝试，某个源给了错的版本会跳到下一个，报错里列出每一个尝试过的地址。

无论哪种来源，都按**客户端自带 catalog** 的 `size` + `sha256` 双重校验：校验不过就拒绝安装，不会把半份东西塞进你的目录。因此**跨版本混用一定失败**——用与客户端同一个 tag 的离线包。

### 纯离线（气隙）

发行版不再附带 `offline-wsl.zip`：默认源已经能自动下载，随包多带 87 MB 只对"完全不出网"的机器有意义，而那种机器本来也要手工传文件。做法：

1. 在能出网的机器上下载 `picket-code-server-<version>-linux-x64.tar.gz`（镜像根目录或 `noware-cn/picket-code-server` 的 `server-v<version>` 发行页），连 `SHA256SUMS` 一起拷进去；
2. **首次连接时**在弹窗里选「从文件安装…」，选这个 `tar.gz`；
3. 已经装过想换：设 `picket.wsl.serverPayloadPath` 指向它，再执行 `Picket: 组件…` → 选 `wsl-server` → **重新安装**。

内网镜像只要保证 `<base>/picket-code-server-<version>-linux-x64.tar.gz` 可取即可；自签 HTTPS 用 `picket.wsl.caFile`，需要沿用 VS Code 代理时保持 `picket.wsl.useProxy`（默认开）。

### 装到哪

| 内容 | 位置（在**目标发行版**里） |
|---|---|
| 载荷 | `~/.picket-code-server/bin/picket-<server 版本>/`，同目录有 `.picket-payload.json` 记录来源与摘要，安装锁是 `.picket-install` |
| 运行时状态 | `~/.picket-code-server/runtime/<发行版>.json`（跨窗口复用同一个服务器，不做退出即杀） |
| 服务器数据 | `~/.picket-code-server`（**独立数据根**：VS Code 的 `~/.vscode-server` 不被读写；旧版本装在那里的载荷会在首次连接时自动迁移过来） |
| 命令行 | `~/.local/bin/picket-code`，链接到载荷里的 `bin/picket-code` |

多发行版各装各的，互不共享。

## iCode

装了 iCode 的发行版可以顺带把它接成 agent：设置 `picket.wsl.icodePath` 指向可执行文件；留空则在发行版的 `PATH` 里找 `icode`。找不到不会阻塞窗口，只是没有 agent。

## 连接方式

`picket.wsl.tunnelMode`：

| 值 | 行为 |
|---|---|
| `auto`（默认） | 读 `%USERPROFILE%\.wslconfig`：`[wsl2] localhostForwarding=false` 或 `networkingMode=mirrored` 时走 stdio 隧道，其余直连 `127.0.0.1` |
| `direct` | 强制直连转发端口 |
| `stdio` | 强制每个窗口一条本地管道隧道（跨窗口共享、不依赖端口转发） |

服务器启动 90 秒内没有输出会被判失败（`picket.wsl.startTimeoutSeconds`）；想固定用登录 shell 启动可设 `picket.wsl.shell`。

## 常用命令

| 命令 | 作用 |
|---|---|
| `Picket: Open Folder in WSL…` | 选发行版 + 文件夹，连接并开窗口 |
| `Picket: Reopen Folder in WSL` / `… in Windows` | 在 WSL 窗口与 Windows 窗口之间来回切 |
| `Picket: Show WSL Log` | 打开扩展日志（也落盘在 `%APPDATA%\picket-code\logs\<会话>\window*\exthost\noware.picket-remote-wsl\picket-wsl.log`） |
| `Picket: 组件…` | 查看/安装/重装/清理服务器载荷，显示当前状态与来源 |
| `Picket: 诊断 WSL 支持` | 一次性报告：发行版、载荷、运行时、端口、官方扩展拦截、iCode 探测 |
| `Picket: Stop WSL Server` | 阶梯停止目标发行版里的服务器（先 SIGTERM，再 SIGKILL） |
| `Picket: 在 WSL 中安装命令行…` / `从 WSL 中移除命令行` | 管理 `~/.local/bin/picket-code` |
| `Picket: 添加发行版…` / `设为默认发行版` / `删除发行版…` | 发行版管理（删除只清载荷与运行时记录） |
| `Picket: 选择扩展市场来源` / `从 VSIX 安装扩展…` | 内网环境下的扩展来源 |

## 卸载官方扩展

扩展一装上，本扩展就会在 WSL 目标视图里提示拦截。处理方式：

- `Picket: 卸载官方 Remote-WSL 扩展（保留数据）` —— 直接卸载扩展，**不碰**任何数据目录（本客户端本来就不写 VS Code 的 `~/.vscode-server`）；
- `Picket: 如何卸载官方 Remote-WSL 扩展` —— 打印手工卸载步骤（扩展面板 → 齿轮 → 卸载，或 `picket-code.exe --uninstall-extension ms-vscode-remote.remote-wsl`）。

两个扩展不能共存是硬约束，不是偏好。

## 常见问题

| 现象 | 原因与处理 |
|---|---|
| `File system provider for vscode-remote://picket-wsl%2Bubuntu/home/… is not available.` | **rc.8 的已知缺陷**：`Open Folder in WSL…` 用远端 URI 作为对话框默认目录，而那时还没有远端文件系统。修复在后续 RC。rc.8 上的变通：先用「文件 → 打开文件夹」打开 `\\wsl.localhost\<发行版>\home\<用户>`（这是本地文件夹），再执行 `Picket: Reopen Folder in WSL` |
| `Size mismatch for …: expected …, got …` | 选错了文件（例如把 iCode 的离线包当成载荷），或跨版本混用。用与客户端同一 tag 的载荷/离线包；下次报错会直接打印被读到的文件路径 |
| `Checksum mismatch for …` | 文件被截断或改过；重新下载并验证 `SHA256SUMS` |
| `这个构建没有 WSL 服务器组件` | `payloads/catalog.json` 缺失或被裁剪，重装客户端 |
| 弹窗一直要求下载 | 装到了另一个发行版（载荷按 `$HOME` 隔离），或 `serverDataFolderName` 被改 |
| `Failed to connect to the remote extension host server` | 服务器起来了但握手失败：看 `Picket: Show WSL Log` 与发行版内 `~/.picket-code-server/data/logs/<时间戳>/`；先 `Picket: Stop WSL Server` 再重连 |
| WSL 目标为空 | `wsl -l -v` 无输出 → 先装 WSL；有输出但视图空 → 执行 `Picket: 刷新 WSL 目标`、看 `Picket: 诊断 WSL 支持` |
| 所有 WSL 命令都提示被禁用 | 官方 Remote-WSL 还装着，见[卸载官方扩展](#卸载官方扩展) |

## 不用远程连接也行

只想在 Windows 侧编辑 WSL 里的文件时，可以直接打开 `\\wsl.localhost\<发行版>\home\<用户>\...`（文件监听与端口转发要自己处理），或在 WSL 里用 WSLg 启动 `picket-code .`。
