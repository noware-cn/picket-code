# WSL 支持验收清单

自动化覆盖见 `build/wsl/acceptance.sh`（`--all` 跑全部；Linux 桌面即跑通全矩阵，
`wsl.exe` 边界由 `vscode/test/wsl-harness/fake-wsl.mjs` 替身承担，服务器载荷是真的）。
下面七项是自动化触不到、必须由人在 Windows 真机上看一眼的部分。每项都给出把现场
摆好的命令，检查人只需要"看"。

## 1. 原生文件夹对话框（唯一自动化触不到的交互）

`showOpenDialog` 是渲染进程之外的 OS 窗口，返回值没有任何可观测 API。

摆现场：在 Windows 上打开 Picket Code，命令面板执行 `Picket: Open Folder in WSL…`，
选择任意发行版。

看什么：
- 对话框的默认路径必须是 `/home/<user>`（经 `\\wsl.localhost\<distro>`），不能是 `C:\Users\…`；
- 选一个名字带空格（最好再带中文）的文件夹，窗口应打开且资源管理器路径正确；
- 直接"取消"也算过——默认路径对就行。

## 2. 真实 `picket-code .`（interop 链路的端到端）

shim 的写链路有 L2 argv 断言，但只有真实的 Windows 客户端能证明上游
`server.cli.ts` 遵守 `VSCODE_CLIENT_COMMAND` + `VSCODE_CLI_AUTHORITY`。

摆现场：WSL 窗口里执行 `Picket: 在 WSL 中安装命令行…`，然后在同一发行版的
终端里进入任意项目目录执行 `picket-code .`。

看什么：弹出的新窗口左下角远程指示器显示 `WSL`（不是裸的 `picket-wsl+…`），
文件夹就是执行命令的目录；看完关掉窗口即可。

## 3. 界面观感（自动化只断言字符串）

自动化断言的是 `WSL 目标` 这个字符串和树节点存在，不是它长得对不对。

摆现场：任意本地窗口打开 `WSL 目标` 视图（活动栏的 `Remote Explorer` 容器里）。

看什么：
- 视图图标与 Remote 探索器其他部分一致，标题不截断；
- 发行版节点的状态徽标（运行中/默认）渲染正常；
- 空状态（无任何发行版）是引导文案，不是空白面板。

## 4. 未卸载官方扩展时功能真的全禁用

自动化（`acceptance.sh --conflict`）断言的是"假官方扩展在位时五个命令消失、树只剩 blocked 节点"，
真机上还要确认这个禁用对用户是**说得清**的，而不是无理由的消失。

摆现场：Windows 上 `picket-code --install-extension ms-vscode-remote.remote-wsl`，重载窗口。

看什么：
- `WSL 目标` 视图只有一条「已禁用：检测到官方 Remote-WSL 扩展」，点它给出卸载确认；
- 命令面板搜 `Picket:` 只剩 `诊断 WSL 支持`、`卸载官方 Remote-WSL 扩展（保留数据）`、
  `如何卸载官方 Remote-WSL 扩展`，其余 WSL 命令搜不到；
- 左下角远程指示器菜单里的 WSL 条目同样消失。

## 5. 卸载官方扩展后：数据接管与旧链接

`acceptance.sh --takeover` 与 `--legacy-uri` 用的是夹具数据；这一步证明真实用户的历史数据也在。

摆现场：接第 4 项，在禁用提示上点「卸载（保留数据）」→ 重载窗口 → 打开任意发行版。
另用一个存着 `vscode-remote://wsl+<发行版>/home/…` 的旧工作区文件（或用
`vscode-remote://wsl+<发行版>/home/<user>` 手填地址）再开一个窗口。

看什么：
- 卸载后 `~/.vscode-server/{data,extensions}` 里的东西都在：原来的远程扩展出现在扩展视图里、
  原来的 `settings.json` 生效（`remote.Settings` 类设置仍在）；
- `WSL 目标` 视图恢复成发行版列表（不再是禁用提示）；
- 旧 `wsl+` 地址能直接打开，且 `诊断 WSL 支持` 的 `Extensions` 段逐条给出 `compatible=yes/no`，
  `no` 的那些写明是 `engines.vscode` 比本产品高。

## 6. 命令行别名

`installShim` 的 argv 有 L2 断言，但"`code` 已存在时不动它"只有真机看得见。

摆现场：在从未装过命令行的发行版里先 `command -v code`（Ubuntu 桌面默认没有），执行
`Picket: 在 WSL 中安装命令行…`；再换一个 `code` 已存在（例如官方扩展装过）的发行版重复一次。

看什么：
- 第一次提示「picket-code 命令行已就绪 …（以及 code 别名）」，`code .` 与 `picket-code .` 行为一致；
- 第二次提示「…（code 已被其他程序占用，未改动）」，`~/.local/bin/code` 仍指向原来的目标；
- `Picket: 从 WSL 中移除命令行` 后 `picket-code` 消失、被占用的 `code` 仍在。

## 7. M4 收尾 15 分钟端到端走查

自动化只检查它被告知的输入；这 15 分钟回答的是"用起来像不像一个产品"。

摆现场：真实发行版 + 真实 `picket-code .` 开一个窗口。

走查（不设阈值，凭手感）：
- 窗口重载（Ctrl+R）后连接恢复、编辑器状态保留；
- 打开 ≥2 个窗口指向同一发行版，互不干扰，服务器进程只有一个
  （`pgrep -f picket-code-server` 于发行版内）；
- 拖拽一个文件夹进窗口、从"最近的文件夹"重开，路径转换正确；
- 命令面板执行 `Picket: 诊断 WSL 支持`，输出里 iCode 一行与实际安装状态一致；
- 顺手看一眼 `picket.wsl.*` 设置页的中文文案有没有明显别扭的地方。
