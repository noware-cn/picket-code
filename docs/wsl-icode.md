# 方案：Windows 客户端 + WSL 里的 iCode

目标：在 **Windows 上运行的 Picket Code** 里，让 iCode 跑在 **WSL 发行版（Ubuntu）**内，工具调用、文件读写、diff 都落在 WSL 的文件系统上。

## 0. 硬约束

| 约束 | 事实 | 后果 |
|---|---|---|
| Remote-WSL 扩展不可用 | 激活时用 `vsda` 判定"仅微软发行版"，我们的构建不带 vsda | **不能**走 `remoteAuthority=wsl+...`，即上游"远程窗口"那条路整体关闭（见 `docs/manual-remote-wsl.md` §9） |
| 不能分发绕过手段 | vsda 桩 / 改 `product.json` 冒充微软版 | 违反微软条款 §6，**不进发行版**、不进镜像 |
| agent host 归属 | 本机窗口 → Electron utility process（`electronAgentHostStarter.ts:167-195`），它用自己的 `process.env.PATH` 解析 `icode` | Windows 上的 host 看不到 `~/.local/bin/icode` |
| 会话目录校验 | `isAbsolute` + `statSync(...).isDirectory()`（`icodeAgent.ts:518-520`） | 传给 iCode 的 cwd 必须是 host 能 stat 的路径 |

结论：**必须自己做一个"WSL 传输层"**，而不是借远程扩展。

## 1. 三个候选

| | A. WSL 传输层 + UNC 工作区（推荐） | B. WebSocket 远端 agent host | C. WSLg 里跑 Linux 版 |
|---|---|---|---|
| 形态 | Windows UI + 本机 agent host，iCode 子进程经 `wsl.exe` 启动 | Windows UI 连接 WSL 内的 agent host（`chat.remoteAgentHosts`） | 在 WSL 里直接跑 `picket-code`，WSLg 显示 |
| 文件身份 | 工作区用 `\\wsl.localhost\<distro>\...` 打开，Windows 侧与 WSL 侧是同一批文件 | 同上，但远端 host 直读原生路径 | 原生，无歧义 |
| 改动量 | 小：1 个新模块 + 传输策略 + 路径回译；不改协议 | 大：要打开 editor 窗口的 `supportsWebSocketConnections`、自管远端 host 生命周期、鉴权、路径映射、每工作区一个 host | 零改动 |
| 主要风险 | 宿主侧仍走 9p 的是监视/搜索/语言服务（见 §2.8） | 只去掉 agent 与 git 的 9p；工作区仍以 UNC 打开，监视与搜索依旧跨界（除非自研远程 FS 提供者） | 两个窗口，不是"Windows 客户端"体验 |
| 授权 | 干净：不用任何微软扩展 | 干净 | 干净 |
| 结论 | **本次实现** | 作为 A 跑通后的演进（A 的路径映射代码可复用） | 文档里的兜底方案 |

C 之所以不作为主方案：用户明确要 Windows 客户端。但它零成本、行为最确定，写在文档里作为"今天就能用"的退路。

## 2. 方案 A：WSL 传输层

### 2.1 判定（不需要用户配置）

```
工作区路径 \\wsl.localhost\<distro>\<posix-path>   → WSL 传输，distro=<distro>
工作区路径 \\wsl$\<distro>\<posix-path>            → 同上（旧写法）
其他（C:\…、D:\…）                                 → 本机传输（现状）
```

可选设置 `picket.icode.wsl.distro`：把 `D:\proj` 这类工作区也强行映射成 `/mnt/d/proj` 交给 WSL。默认关闭——写 Windows 盘要过 `/mnt` 的 9p，性能与权限语义都更差。

### 2.2 注册门禁

现在是"能在本机 PATH 里找到 `icode` 才注册 provider"（`agentHostMain.ts:154-170`）。改成：

```
注册条件 = 本机能解析到 icode  ||  存在 C:\Windows\System32\wsl.exe
```

两种都失败时保持现在的 `iCode provider not registered (reason)` 日志。真正的可用性判断推迟到首个 turn（失败即中断并给可读错误），因为 distro 名来自工作区，启动时还不知道。

### 2.3 启动命令

```
wsl.exe -d <distro> --cd <posixCwd> -- bash -lc 'exec icode acp --approval manual -a Code'
```

- 用 `bash -lc`（登录 shell）是为了让 `~/.local/bin` 进 PATH；`icode` 通常装在 `~/.local/bin`，非登录 shell 看不到。
- `--cd` 直接设初始终端目录（Win10 1903+）；不支持的老 WSL 用 `bash -lc 'cd "$1" && exec icode …' _ <posixCwd>` 兜底。
- 每个参数在进入 `bash -lc` 之前都要按 POSIX 单引号规则转义（新函数 `shQuote`，现有 `escapeCmdArg` 只适用于 cmd）。
- `PICKET_ICODE_BIN` 在 WSL 语义下解释为 **distro 内的绝对路径**（`/home/x/.local/bin/icode`）；给的是 `C:\…` 形式则直接报错，不做猜测。
- 环境变量里额外注入 `PICKET_ACP_SESSION=<uuid>`，供杀进程时定位。

### 2.4 路径映射（双向）

新增 `icodeWslPaths.ts`：

| 方向 | 例子 |
|---|---|
| UNC → POSIX | `\\wsl.localhost\Ubuntu\home\dsun\workspace\x` → `/home/dsun/workspace/x` |
| POSIX → UNC | `/home/dsun/workspace/x/a.ts` → `\\wsl.localhost\Ubuntu\home\dsun\workspace\x\a.ts` |
| 盘符 → POSIX（仅 `wsl.distro` 强制时） | `D:\proj` → `/mnt/d/proj` |

**回译是必须的**，否则 UI 会错：iCode 的工具调用与结果里是 POSIX 绝对路径（`rawInput.file_path`、`tool_call_result.content` 的文本、`diff` 头）。`icodeMapEvents.ts` 在生成 `ToolInput` / 编辑 URI 之前要做一次 `toHostPath()`，把 POSIX 转回 UNC，否则 diff 编辑器打开的是"不存在的 Windows 路径"。

### 2.5 杀掉进程

`wsl.exe` 是父进程，`killTree` 打不到 Linux 侧的 `icode`。三级阶梯改为：

1. 关 stdin（发送者关闭即可，iCode 读到 EOF 会退）；
2. `wsl.exe -d <distro> -- pkill -f 'PICKET_ACP_SESSION=<uuid>'`；
3. `killTree(wsl.exe)` 兜底（清掉 Windows 侧的转发进程）。

超时与 `gracePeriodMs` 沿用现有实现（`icodeAgent.ts` 的 `_shutdown` 阶梯）。

### 2.6 git 必须跑在 WSL 里（正确性问题，不是优化项）

`AgentHostGitService` 现在用**宿主机的 git** 对工作区执行命令：`cp.execFile('git', …)` 只有三处调用点（`agentHostGitService.ts:983` 读 blob、`:1095` 的 `update-ref --stdin`、`:1380` 的 `_runGit` 主入口），所以改造面很小；但**不能不做**：iCode 在 WSL 里自己也会跑 git（checkpoint、diff、提交），如果宿主侧用 Windows 的 git 去读同一批文件，两边看到的世界不一样：

| 分歧点 | 表现 |
|---|---|
| `core.autocrlf` / `.gitattributes` 的 eol | Git for Windows 默认 `autocrlf=true`，WSL 里是 `false` → 每个文件都被判为改动，或改动全部消失 |
| `core.filemode` | Windows git 置 `false`，WSL git 置 `true` → 只改了权限的变更一边可见一边不可见 |
| hooks | 仓库里的 `pre-commit` / `pre-push` 按 Linux 写（`#!/usr/bin/env bash`），Windows 侧执行会直接失败或跳过 |
| symlink / 大小写 | 9p 上 symlink 退化成文件；WSL 文件系统大小写敏感，Windows git 可能把小写相等当成同一个路径 |
| 性能 | 9p 上的 `git status` 慢一个数量级，既有 5 s 超时（`_runGit` 默认 `timeout: 5000`）会被打穿 |

**设计**：把 git 的进程执行抽成一个执行器，按工作区身份选实现。

```
interface IGitExecutor {
  execFile(cwd: URI, args: readonly string[], opts): Promise<{ stdout, stderr }>;
}
LocalGitExecutor  → cp.execFile('git', args, { cwd: fsPath, … })        // 现状
WslGitExecutor    → cp.execFile('wsl.exe', ['-d', distro, '--cd', posix(cwd), '--', 'git', ...args])
```

三条规则：

1. **输出翻译按命令白名单，不做启发式**。只有 `rev-parse --show-toplevel`、`worktree list --porcelain`、`config --get core.worktree` 这类会吐绝对路径的命令才把 POSIX 转回 UNC；`status --porcelain`、`diff --numstat`、`ls-files` 吐的是相对路径，原样通过；`git show <rev>:<path>` 吐的是**文件内容**，绝不能碰（一个以 `/` 开头的注释行会被误翻译成路径）。
2. **超时要按传输加余量**。`wsl.exe` 冷启动 1–3 s，`_runGit` 的 5 s 默认超时对第一个 `status` 不够；改成 `timeout + wslOverheadMs`，并在会话创建时预热一次（`wsl.exe -d <distro> -- true`）。
3. **`GIT_OPTIONAL_LOCKS=0` 保留**（`_runGitStatus` 已经在用），避免后台探针与 iCode 的写操作抢 `index.lock`。

改造后 `AgentHostGitStateService`（分支状态、`ahead/behind`）与 `gitDiffContent`（diff 内容）都自动跟随，不需要各自加分支。

### 2.7 已知风险与缓解

| 风险 | 说明 | 缓解 |
|---|---|---|
| UNC 监视不可靠 | 宿主侧递归监视经 `ReadDirectoryChangesW` 打 `\\wsl.localhost`，事件不保证投递 | M3 主动刷新（按 turn 的变更列表），不依赖监视 |
| 搜索/语言服务吞吐 | rg 与 TS/eslint 在 Windows 侧扫 UNC，大仓库明显变慢 | 文档给出仓库规模建议；超过阈值推荐 C |
| 单文件读写 | 每次一次 9p 往返 | 接受，不做补偿 |
| `wsl.exe` 行尾转换 | 若 `wsl.exe` 在管道上做 CRLF 转换，NDJSON 会带 `\r` | 读取侧已按 `\n` 切行，补一条 `\r` 剥除 + 一条集成用例 |
| 首次冷启动 | 未启动的 distro 首个 `wsl.exe` 调用要 1–3 s | 会话创建时预热一次 `wsl.exe -d d -- true` |
| 权限 | `/mnt` 上的写权限与 NTFS ACL 交叉 | 文档明确推荐把工作区放在 distro 原生文件系统（`/home/...`），不要放在 `/mnt/d` |
| distro 名不一致 | 用户有多个发行版 | 从 UNC authority 取；设置可覆盖 |

## 3. 方案 B（演进方向，不在本次范围）

复用上游已有但只在 Agents 窗口生效的远端 host 设施：`AgentsWindowRemoteAgentHostService`（`supportsWebSocketConnections = true`）、`WSLRemoteAgentHostMainService`（`wslRemoteAgentHostService.ts:78`，已会 `wsl.exe -e bash -lc` 拉起）。要做的是：

1. 打开 editor 窗口的 `supportsWebSocketConnections`（现在是硬编码 `false`，`remoteAgentHostServiceImpl.ts:1225-1230`）；
2. 做每个 WSL 工作区一个 host 的生命周期与端口/token 分配；
3. 把 A 的路径映射复用过来；
4. 权限模型：远端 host 上的 `request_permission` 要回到 Windows UI。

收益：agent host 也在 WSL 里，`git` 与 agent 的文件读写都是原生路径；但**工作区仍以 UNC 打开**，宿主侧的递归监视、搜索、语言服务照样跨界，所以 B 不会让 9p 风险消失——要彻底消除，得自己实现远程 FS 提供者（等于重造 `vscode-remote`），不在范围内。成本约为 A 的 3–4 倍，且要动上游判定逻辑（补丁面变大）。建议 A 上线、收集真实反馈后再决定。

### 2.8 宿主侧仍走 9p 的部分：真实评估

先回答对照问题：**官方 VS Code + Remote-WSL 里不存在这个风险，一个字节都不走 9p。** 远程窗口的工作区由 `vscode-remote` 通道服务，读、写、枚举、递归监视都在远端进程里执行：

- `src/vs/server/node/remoteFileSystemProviderServer.ts:20` — `RemoteAgentFileSystemProviderChannel extends AbstractDiskFileSystemProviderChannel`，客户端只是 RPC 转发，落盘由 server 自己的磁盘 FS 完成；
- 同文件 `:76`、`:91` — `IRecursiveWatcherOptions`、`--file-watcher-polling` 都在**服务端**配置，说明递归监视由远端进程执行。

也就是说远程窗口里 Windows 侧只有 UI 与 RPC 客户端；文件系统、`rg`、语言服务全在 WSL。官方文档反复警告"别把代码放 `/mnt/c`"，正是因为一旦跨界就掉到这条慢路径上。

我们的 A 方案框架不同：工作区在 Windows 侧以 UNC `\\wsl.localhost\<distro>\…` 打开，此后任何宿主侧的文件动作都经过 WSL 的重定向器（9p）。逐项评估：

| 宿主侧动作 | 走 9p？ | 实测预期 | 严重度 |
|---|---|---|---|
| iCode 自身的读、写、编辑 | 否（WSL 原生） | 原生速度 | — |
| git（`status`/`diff`/`commit`/`push`） | 否（§2.6 已改道 WSL） | 原生速度 | — |
| 打开/保存单个文件、diff 文档两侧内容 | 是，一次整文件读写 | 常见源文件毫秒级到几十毫秒 | 低，可接受 |
| 资源管理器目录枚举、首次展开 | 是 | 千级文件目录数百毫秒 | 低 |
| **全仓搜索（rg 在 Windows 侧跑）** | 是 | 慢一个数量级；10 万文件规模可能数十秒 | **中～高**（仓库越大越差） |
| **递归文件监视** | 是，且**不可靠** | `fs.watch` 走 `ReadDirectoryChangesW`，对 `\\wsl.localhost` 的重定向器不保证投递事件 | **高**：iCode 改完文件，编辑器可能不刷新、不重载 |
| 语言服务（TS server、eslint 等） | 是 | 这些扩展仍跑在 Windows 侧本地扩展宿主，扫描与诊断比官方远程窗口慢 | 中（大仓库明显） |

结论要精确：**"宿主侧读文件内容"本身不是问题**（一次读写，量级可接受）。真正的两处软肋是**递归监视的可靠性**（功能正确性）与**全仓搜索/语言服务的吞吐**（体验）。

所以 M3 里要做的不是"文件读取优化"，而是**摆脱对宿主监视的依赖**：每轮 turn 结束时宿主已经用 WSL git 拿到变更文件列表，据此主动刷新对应模型与状态（或退化为带 `files.watcherExclude` 的轮询监视）。这样即使 UNC 监视不触发，用户也能看到 iCode 改完的结果。搜索与语言服务不做补偿，改为在文档里给出仓库规模建议。

**先测再定（30 分钟，在你的 Windows 机器上）**：

```powershell
# 1) 监视是否真的会触发 —— A 方案成立与否的关键
node -e "const fs=require('fs');fs.watch('\\wsl.localhost\Ubuntu\home\<user>\proj',{recursive:true},(e,f)=>console.log(e,f))"
#    同时在 WSL 里：touch /home/<user>/proj/x.txt

# 2) 全仓搜索耗时（Windows 侧 rg over UNC）
Measure-Command { rg --files "\\wsl.localhost\Ubuntu\home\<user>\proj" | Out-Null }

# 3) 枚举耗时
Measure-Command { Get-ChildItem -Recurse "\\wsl.localhost\Ubuntu\home\<user>\proj" | Out-Null }
```

判定：监视不触发 → M3 的主动刷新是必需项（当前设计已含）；`rg` 超过 ~30 s 或仓库超过 ~10 万文件 → 该仓库建议直接用 C（WSLg 里跑 Linux 版），A 只服务中等规模仓库。

## 4. 里程碑

| 阶段 | 内容 | 验证 |
|---|---|---|
| M1（0.5–1 天） | `icodeWslPaths.ts`（检测 + 双向映射 + `shQuote`）+ 单测；`icodeLaunchConfig` 增加 `wsl` 传输策略 | 纯单元，fixture 用假 `wsl.exe`（node 脚本记录 argv 并回显 NDJSON） |
| M2（1 天） | 注册门禁改造 + `icodeAgent` 按工作区选策略 + 启动失败的可读错误 | 单元：UNC 工作区 → 断言 spawn 的是 `wsl.exe` 且 argv 正确；非 UNC → 仍是本机 |
| M3（2 天） | `IGitExecutor` + `WslGitExecutor`（含命令白名单翻译、超时余量）；路径回译（`icodeMapEvents` 之前）；turn 结束按 WSL git 的变更列表主动刷新（不依赖 UNC 监视）；杀进程三级阶梯 + 预热 | 单元：假 `wsl.exe` 断言 git 调用被改道；POSIX 的 `rawInput` 回译成 UNC；`pkill` 被调用；变更列表驱动刷新被触发 |
| M4（0.5 天） | 文档（`docs/design.md` 一节 + `website/docs/guide/wsl.md` 排障）+ 手动验收清单 | 手工 |

CI 可自动化的部分：M1–M3 全部单元测试（`windows-2022` runner 上 `wsl.exe` 存在，假 distro 用假可执行文件替代；真实 distro 不进 CI）。真机验收项见下。

## 5. 验收清单（真机，Windows）

1. WSL 里 `command -v icode` 有输出；`\\wsl.localhost\Ubuntu\home\<user>\proj` 能在 Explorer 打开。
2. Picket Code 打开该 UNC 工作区 → Agents 窗口新建会话，类型选择器里出现 **iCode**（补丁 62 的回退会把它设为默认）。
3. 一轮对话触发一次 `read` + 一次 `edit`：diff 能在编辑器里正确打开并显示 `\\wsl.localhost\...` 路径。
4. 审批允许/拒绝各一次；`ask_user` 一次。
5. 中断（Stop）后 `wsl.exe -d Ubuntu -- pgrep -f PICKET_ACP_SESSION` 为空。
6. 关闭会话/退出应用后没有遗留 `wsl.exe` 进程。
7. 同一工作区里 `git status` 由 **WSL 的 git** 执行（日志出现 `wsl.exe … -- git status`），且改动列表与 WSL 里 `git status` 完全一致，没有"全仓库都是改动"的假象。
8. 在会话里跑一次"提交"类操作（PR 流程的 `commitAll` / `push`），hooks 能正常执行。
9. 打开 `D:\…` 工作区时行为不变（本机传输），且日志里能看到策略判定。
10. 未安装 iCode 的 distro 上打开 UNC 工作区：得到可读错误，而不是静默无响应。

## 6. 需要拍板

1. 是否要在 M1 就支持 `D:\…` 工作区强制走 WSL（`picket.icode.wsl.distro`）？默认建议只做 UNC 判定，减少失败面。
2. 是否接受 `/mnt/d` 工作区（性能差）——建议文档里明确"不推荐"，不做专门优化。
3. 方案 B 是否现在立项（会牵动上游 `supportsWebSocketConnections` 判定，补丁面变大）。
