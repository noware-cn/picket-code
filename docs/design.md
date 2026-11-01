# Picket Code 设计文档

> 面向 AI 编码 agent 的加固版 VS Code 发行版——受控扩展、私有模型网关、按项目沙箱、iCode 一等公民。

| 项目 | 内容 |
|---|---|
| 文档状态 | **已发布（v1.0，2026-10-23 审核通过）** |
| 版本日期 | 2026-10-23 |
| 适用范围 | dantesun/picket-code 仓库（Code - OSS 发行版 fork） |
| 目标读者 | 项目负责人、银行科技评审、参与实施的工程师 |
| 上游基准 | microsoft/vscode main（取证 SHA 29ea7eff）、VSCodium/vscodium master |

本文档梳理 Picket Code 的整体设计思路：背景与目标、设计原则、现状（As Is）、目标架构（To Be）、构建体系、AgentHost 裁剪与 iCode 集成、安全合规、实施路线、风险与未决问题。关键结论标注证据等级：`confirmed`（源码/仓库实证）、`inferred`（间接证据推断）、`unknown`（待验证）。

---

## 1. 背景与目标

### 1.1 背景

- **区域银行 AI Coding 落地受三方面约束**：信创内网要求代码与数据不出网；金发〔2026〕8号要求模型备案、人工复核、日志留存不低于业务存续期；预算有限，倾向开源与自主可控方案。
- **主流编码 agent 依赖公有云与国外服务**：Copilot、Claude Code、Codex 的 SDK 与遥测与银行合规边界冲突，且不可裁剪。
- **iCode 具备银行侧友好属性**：全开源（Apache-2.0）、BYO 模型、无遥测、OTel 就绪、workflow 与审批内建；但无现成 IDE 宿主与渠道，需要发行版承载。
- **Picket Code 的定位**：以 Code - OSS 为基底，裁掉微软绑定与国外 agent 实现，内置 iCode 作为唯一编码 agent，形成“离线、可控、可审计”的银行内网 IDE 发行版。

### 1.2 目标

| 编号 | 目标 | 验收口径 |
|---|---|---|
| G1 | 干净二进制：无遥测、无微软品牌、无微软市场 | 产物反查无遥测端点与微软标识 |
| G2 | 默认离线：不内置任何联网扩展 | 扩展最小集（32 保留 + 3 构建期） |
| G3 | 无国外 agent：产物不含 Copilot/Claude/Codex 的 provider 与 SDK | 产物反查无三套 SDK 依赖（`@github/copilot-sdk`、`@anthropic-ai/*`、`@openai/codex`） |
| G4 | iCode 一等公民：AgentHost 注册 iCode，聊天面板可用 | P3 验证门：picker 出现 iCode，hello 往返成功 |
| G5 | 合规内建：人工审批、审计日志、数据不出网 | 金发〔2026〕8号关键条款映射可追溯 |
| G6 | 构建可重复：钉版 + 补丁体系 + CI 四段流水线 | 分级验收（见 5.5）：L1 关键产物哈希一致；L2 内容级一致（剥离时间戳字段）；字节级完全一致列入后续工程项，不作 P0 承诺 |

### 1.3 Non-goals（P0 不做）

- 不做自有模型；模型一律 BYO（内置网关端点配置）。
- 不做云托管沙箱；沙箱在发行版内以 devcontainer + 出站防火墙配置实现。
- 不兼容微软官方市场；扩展来源为 Open VSX（可指向自建镜像）。
- 不做 iOS/Android 等非常规平台；MVP 为 Linux x64 + Windows x64。
- 不与 Cursor 等商业产品比拼编辑体验完整度；先验证核心链路。

---

## 2. 设计原则

| # | 原则 | 说明 |
|---|---|---|
| P1 | 复用上游、减法优先 | 不重写 VS Code；沿 VSCodium 验证过的构建路径做减法，先删后补 |
| P2 | 对齐 VSCodium 机制 | 钉版 + prepare 脚本 + 分层补丁 + compile/package 分离，照搬其被社区验证的流水线 |
| P3 | 补丁锚点断言 | 每个补丁断言锚点文本；上游升级导致锚点失效时显式报错，不静默错补 |
| P4 | 证据驱动 | 关键设计决策标注 confirmed/inferred/unknown；不凭架构常识填补 |
| P5 | 默认离线、默认无遥测 | 无遥测是出厂配置而非开关；联网扩展默认移除 |
| P6 | iCode 是唯一内置 agent | 不保留国外 agent 的任何注册路径，避免退化为“可切换”的混合发行版 |
| P7 | 合规是产品属性 | 人工审批、审计日志、数据边界在架构层内建，而非事后加装 |

---

## 3. 现状分析（As Is）

### 3.1 已落地构建体系

| 组件 | 职责 | 状态 |
|---|---|---|
| `build/build.sh` | 编译阶段：契约自检（`check-contract.sh`）→ clone 钉版 → 裁扩展（`extensions-remove.list`）→ `apply-patches.sh` 打补丁 → npm ci（重试 5 次）→ 写回版本号 → `vscode-<plat>-<arch>-min` → 打包 vscode.tar.gz | confirmed，已提交 main |
| `build/linux/package.sh` | 解包 → 重命名 `VSCode-linux-<arch>` → `picket-code-linux-<arch>` → tar.gz | confirmed，已提交 main |
| `build/win32/package.sh` | 解包 → 杀占用进程/清只读属性 → 带重试 mv → robocopy /MOVE 兜底 → 7z/tar/Compress-Archive 三级压缩 | confirmed，已提交 main（修复 Permission denied 根因） |
| `.github/workflows/release.yml` | 四 job：versions（解版本）→ compile（linux/win32 matrix）→ package → release | confirmed，已提交 main |
| `build/product.json` | 品牌（picket-code/Picket Code）、telemetry off、Open VSX 市场、移除 updateUrl（更新器自禁用，无更新服务） | confirmed |
| `build/apply-patches.sh` | 三步执行器：① product.json merge（内嵌 python3）② `patches/52*.json` 路径删除（缺失即 exit 4）③ `patches/apply-list.txt` 逐个 `git apply` | confirmed |
| `build/patches/61-build-source-adaptations.patch` | 构建脚本适配 6 处：copilot.ts 守卫改告警、npm/dirs.ts 过滤、gulpfile.extensions 过滤、lib/extensions 媒体过滤、AppX 跳过、signtool 缺失容忍，另加 `builtInExtensions.ts` 只走 GitHub 下载 | confirmed |
| `build/extensions-remove.list` | 内置扩展最小集清单（保留 32 + 构建期 3，移除 65） | confirmed |

### 3.2 关键缺口（复核确认）

| 编号 | 缺口 | 证据等级 | 影响 |
|---|---|---|---|
| K1 | **platform 层三套国外 provider 仍编译打包**：`extensions-remove.list` 只删 `extensions/copilot` 前端；`src/vs/platform/agentHost/node/` 下 `copilot/`、`claude/`、`codex/` 与 `otel/`、`clientTools/` 未裁剪，三套 SDK 依赖仍进入产物 | confirmed | 违反 G3；P2 阶段核心工作量。**2026-10-23 已部分落地**：52 号 JSON 删除已启用并本地验证 177/177 路径应用成功（`node/codex`、`node/otel`、`node/clientTools`、`common/otel`、`extensions/copilot` 及 `node/copilot`、`node/claude` 绝大部分源码已移除）；`node/copilot` 余 30 文件、`node/claude` 余 2 文件与三套 SDK 依赖待 53 号补丁 rebase 后清理 |
| K2 | 聊天 UI 判断：agentHost 聊天面板在 workbench 核心代码（`workbench/contrib/chat/browser/agentSessions/agentHost/`，544 文件命中），删扩展后能渲染非 Copilot provider | confirmed（P2.5，2026-11-01；仅 Agents Window + 需 62 号补丁） | 影响 UI 路线选择 |
| K3 | workbench 中约 56 个文件含 copilot 专属逻辑（多为引导/设置类），删除扩展后的降级行为未逐文件验证 | inferred | P2 后需完整构建 + 冒烟 |
| K4 | README 与 docs/roadmap.md 曾引用已删除的 `build/prepare.sh` | confirmed | 随本设计文档发布一并修订 |
| K5 | 扩展删除清单含大量语言扩展（python/sql/java/docker 等约 41 个），银行数据开发场景可能需保留 SQL/Python 语言服务 | confirmed | 发布前按场景复核清单 |
| K6 | iCode 无常驻流式 app-server：现有 `icode run --json` 为 one-shot | confirmed | P4 阶段需 iCode 侧新增 `app-server` 子命令 |

---

## 4. 目标架构（To Be）

### 4.1 分层视图

```
┌─────────────────────────────────────────────────┐
│ 发行层：picket-code 品牌、Open VSX 市场、更新通道     │  ← P1 已落地
├─────────────────────────────────────────────────┤
│ 扩展层：最小内置集（32+3）＋受控市场按需安装     │  ← P1 已落地
├─────────────────────────────────────────────────┤
│ Workbench 核心：聊天 shell、设置、编辑器         │  ← 保留（含 agentHost 会话 UI）
├─────────────────────────────────────────────────┤
│ AgentHost 平台层：provider 注册、会话、审批、日志 │  ← 裁剪为“零 provider + 编排核心”
├─────────────────────────────────────────────────┤
│ 适配层：node/icode/（IAgent 实现）               │  ← P3–P4 新增
├─────────────────────────────────────────────────┤
│ iCode 引擎：Python CLI、workflow、审批、OTel     │  ← 外部进程，BYO 模型
└─────────────────────────────────────────────────┘
```

### 4.2 保留 / 删除边界（复核修正版）

| 模块 | 处置 | 依据 |
|---|---|---|
| `src/vs/platform/agentHost/common/` 协议层 | 保留 | 零 provider 容忍（confirmed） |
| `src/vs/platform/agentHost/node/` 编排器（providerService、sessionLifecycle、transport、会话 DB、AHP） | 保留 | 核心能力 |
| `src/vs/workbench/contrib/chat/browser/agentSessions/agentHost/` 聊天 UI | 保留 | **修正**：属 workbench 核心，52/53 不碰 |
| `node/copilot`、`node/claude`、`node/codex`、`node/otel`、`node/clientTools`、`common/otel` | 删除 | 复用 VSCodium 52 号清单（177 路径） |
| 三套 SDK 依赖（`@github/copilot-sdk`、`@anthropic-ai/*`、`@openai/codex`）、gulp copilot 任务、product 注入 | 删除 | 复用 VSCodium 53 号补丁（26 文件） |
| `test/node/mockAgent.ts` | 保留（裁剪版） | **修正**：53 号补丁就地裁剪而非删除，作 iCode 适配器参考 |
| `extensions/copilot` 前端扩展 | 删除 | 52 号清单整目录删除 |
| workbench 中 copilot 专属引导文件（约 56 命中） | 暂留观察 | P2.5 实测后决定是否追加补丁 |
| 遥测/云/更新/登录/签名/onboarding 相关代码 | 删除 | 复用 VSCodium 00/10/11/60/80 系列补丁 |

---

## 5. 构建体系设计

### 5.1 与 VSCodium 的对齐点

| 环节 | VSCodium 做法 | Picket Code 现状 | 差距 |
|---|---|---|---|
| 钉版 | version.sh 取 MS_COMMIT 钉版 | build.sh 由 CI versions job 传入 tag | 已对齐 |
| 品牌与产品配置 | prepare_vscode.sh 用 jq setpath 改 product.json | `apply-patches.sh` 内嵌 python3 做 product.json merge | 已对齐（机制不同，效果等价） |
| JSON 删除补丁 | `patches/*.json`（逐条 rm -rf，路径缺失 exit 4） | `patches/52-ext-copilot-remove-it.json`（177 条路径，同上语义） | 已对齐 |
| git apply 补丁 | `patches/*.patch`（占位符替换后 `git apply --ignore-whitespace`） | `patches/apply-list.txt`（53/54/55/61，逐个 `--check` 后应用） | 已对齐 |
| 构建 | `vscode-min-prepack` → `vscode-<plat>-<arch>-min-packing`（旧 gulp 任务） | `vscode-<plat>-<arch>-min`（现代 gulp 任务，产物完整目录） | 已对齐现代上游，**不能照抄旧任务名** |
| CI 分离 | compile job → package jobs → release | 四 job 流水线 | 已对齐 |
| Windows 打包 | 平台脚本 + 校验和 | 加固版（杀进程/只读清理/robocopy 兜底） | 已对齐且加固 |

### 5.2 补丁分层体系（目标态）

沿用 VSCodium 编号语义，新增 Picket Code 自有分层：

| 区间 | 内容 | 来源 |
|---|---|---|
| 00-xx | 品牌、遥测、云、GitHub、扩展、远程、安全、设置、UI | VSCodium |
| 10-12 | 更新通道、下载 | VSCodium |
| 20-22 | keymap、policy、osproxy 自定义库 | VSCodium |
| 30-40 | 构建与 CLI | VSCodium |
| 50 | gulp 任务改进 | VSCodium |
| **52 / 53** | **copilot 全量删除（177 路径 + 26 文件引用清理）** | **VSCodium 复用** |
| 60-61 | 安全加固 | VSCodium |
| 80-81 | onboarding | VSCodium |
| **90-picket-code-*（新增）** | iCode 适配器注入、扩展清单、银行合规开关 | **Picket Code 自有** |

> 已决策（2026-10-23 审核）：补丁执行器**对齐 VSCodium 机制**——JSON actions（rm -rf）+ `git apply --ignore-whitespace`，替换当前 Python 锚点脚本作为主执行路径；Python 脚本降级为过渡工具，完成迁移后移除。
>
> **落地状态（2026-10-23）**：`build/apply-patches.sh` 已实现并集成进 build.sh；52 号 JSON 删除已启用（177/177 路径在 1.142.0 验证应用成功）；53 号补丁已入库但**未启用**——其 base 上下文为 VSCodium master，与 1.142.0 不匹配，需 rebase（失败文件清单与步骤见 `build/patches/README.md`，为 P2 首个任务）。

### 5.3 CI 流水线（已落地）

```
versions ──► compile(linux) ──┐
             compile(win32) ──┼──► package(linux) ──┐
                              │    package(win32) ──┼──► release
                              └─────────────────────┘
```

- compile：clone 钉版 → 裁扩展 → 补丁 → npm ci → `-min` 构建 → 产出 vscode.tar.gz（源码树 + 产物目录）。
- package：解包 → 重命名 → 归档 + SHA256SUMS。
- release：仅 tag 触发；softprops 上传产物。
- 说明：重构后的四 job 尚未在真实 runner 完整跑通，需手动 `workflow_dispatch` 验证。

### 5.4 版本钉版与升级策略

- 每次发布钉一个上游 tag（如 1.142.0），补丁按钉版应用。
- 升级流程：更新钉版 → 逐补丁检查锚点 → 全量构建 → 冒烟。
- 风险：53 号补丁 212KB、跨 26 文件，上游每次重构都会引发 rebase；这是长期维护成本，接受（与 VSCodium 同处境）。

### 5.5 可复现构建口径（G6 验收细化）

**为什么不能承诺“字节级完全一致”**：当前流水线没有任何确定性构建措施，同一 tag 两次构建的产物差异是必然的。非确定性来源分两类：

| 类别 | 来源 | 证据等级 |
|---|---|---|
| 时间戳类 | gzip/tar/zip 归档头部的 mtime 字段（`build.sh` 的 `tar czf` 每次写入当前时间；Windows 打包的 zip 条目时间戳同理） | confirmed |
| 时间戳类 | Windows 打包经 rcedit 改写图标/版本信息时写入 PE 头 timestamp | inferred |
| 内容类 | TypeScript 编译产物与 sourcemap 含绝对路径（CI runner 路径如 `D:\a\picket-code\picket-code` 每次一致但跨机器不同） | inferred |
| 内容类 | 不同 runner（ubuntu-latest 版本漂移、windows-2022 补丁差异）上原生模块编译指纹不同；npm ci 固定版本但部分 native 产物含机器指纹 | inferred |
| 内容类 | 上游产物中非 contenthash 命名的生成文件（构建时 manifest、SHASUMS 等） | inferred |

**分级验收标准**：

| 级别 | 定义 | 实现手段 | 承诺阶段 |
|---|---|---|---|
| L1 关键产物哈希一致 | `resources/app/out`、`product.json` 等核心产物 sha256 一致；归档外层允许差异 | 构建后脚本对白名单路径比对 | P0 即可承诺 |
| L2 内容级一致 | 解包后逐文件比对，剥离时间戳类字段后一致 | 比对脚本（diffoscope 或自定义忽略规则） | P1 后 |
| L3 字节级完全一致 | 归档与文件字节全等 | `SOURCE_DATE_EPOCH` 贯穿 + 归档固定 mtime（`tar --mtime`、`gzip -n`、7z/zip 关时间戳）+ strip-nondeterminism | 后续工程项，不作 P0 承诺 |

> 修正记录：原稿 G6 写作“字节级近似”，口径含糊，无法检验。现改为分级验收：L1 为可检验的默认承诺，L3 明示为专项工程投入。

---

## 6. AgentHost 裁剪与 iCode 集成设计

### 6.1 AgentHost 关键事实（源码级 confirmed）

| 事实 | 位置 | 含义 |
|---|---|---|
| agent 注册点只有两处 | `agentHostMain.ts`、`agentHostServerMain.ts` 的 `startAgentHost()` | 注入 iCode 只需改这两处 |
| 零 provider 不抛错 | `agentHostProviderService.ts`（列表空、默认 undefined、resolveProvider 返回 undefined）；`agentHostSessionLifecycle.ts` 有 `getProviders().length > 0` 守卫 | 删除全部 provider 后 host 可正常启动 |
| 首个注册者自动成为默认 | `registerProvider()`：`if (!this._defaultProvider) this._defaultProvider = provider.id` | 注册 iCode 即默认 |
| 注册门控模式 | Claude 用 env 开关 + SDK 可达性；Codex 用 env/配置 + SDK 可达性 | iCode 门控仿照：配置开关 + 二进制可达性 |

### 6.2 52/53 复用方案（P2）

- 下载 VSCodium `patches/52-ext-copilot-remove-it.json` 与 `53-ext-copilot-remove-it.patch`，随钉版固定。
- 52 号：177 条物理删除路径（含 80+ 测试文件、`historyRecordFixtures.ts`），workbench 路径 0 条。
- 53 号：26 文件引用清理（provider 注册块整段删除、`providerConfigurations: []`、SDK 依赖删除、OTel 钩子 no-op）。
- **修正**：`mockAgent.ts` 在 53 中被就地裁剪（移除 `historyRecordFixtures` 依赖）后保留，不需“恢复”，作 iCode 适配器参考。
- Picket Code 补丁执行器已决策对齐 VSCodium 机制：JSON actions（rm -rf）+ git apply；原 Python 锚点脚本的 6 处代码改写已全部迁入 `patches/61-build-source-adaptations.patch`，脚本本身删除。
- **落地状态（2026-10-27）**：执行器 `build/apply-patches.sh` 是唯一补丁入口（`build.sh` 只调用它一次），顺序为 product.json merge → 52 → 53 → 54 → 55 → 61；在 vscode `1.143.1`（`e646868227c`）上实测 52 删除 177/177 路径、53/54/55/61 全部干净应用。52 单独应用后完整编译预期失败（引用清理未完成），属预期中间态。

### 6.3 iCode 适配器四件套（P3）

```
src/vs/platform/agentHost/node/icode/
├── icodeAgent.ts           # 实现 IAgent；从裁剪后 mockAgent 抄结构
├── icodeAppServerClient.ts # spawn 常驻子进程；参考 node/codex/codexAppServerClient.ts（18KB）
├── icodeLaunchConfig.ts    # 解析系统 icode 或内置 Python 运行时
└── icodeMapEvents.ts       # 事件映射：markdown/tool/审批/diff/idle/usage
```

- 完整度参考：codex 适配器 `codexAgent.ts` 约 458KB + 35 个支撑文件；iCode 首版不需要对齐其全部功能。
- mockAgent 位于 `test/` 且依赖测试 fixture，不能整体搬进生产代码；复制结构后按生产标准重写。
- IAgent 是内部接口而非扩展 API：**必须 fork 上游代码实现适配**，不能以扩展方式接入。

### 6.4 常驻 app-server（P4，iCode 侧新增）

| 现状 | 目标 |
|---|---|
| `icode run "<prompt>" --agent QA --json`：one-shot，一次往返即退出 | `icode app-server`：常驻进程，JSON-RPC 流式会话 |
| 无增量上下文、无工具回调 | 支持多轮、工具审批、diff 预览、中断恢复 |
| 会话状态在 CLI 进程内 | 会话状态由 AgentHost 会话 DB 管理 |

- 这是最大工作量判断，未变。
- 审批语义必须完整映射：iCode workflow 的 manual 审批 ↔ AgentHost 的 pending_confirmation 信号。

### 6.5 聊天 UI 结论（复核修正）

- agentHost 聊天面板在 **workbench 核心代码**（`agentHost.contribution.ts` 注册十几个 contribution，`AfterRestored` 阶段启动 host），不在 `extensions/copilot` 内。
- 删除 copilot 扩展后，聊天 shell 仍在；iCode 注册后**可能直接渲染 iCode 会话**。
- 结论：UI 路线已拍板——**先用 P2.5 验证核心面板直连**，通过则不引入外部 AHP client / 自建扩展；失败再降级评估替代路线（见第 9 章）。
- **P2.5 实测结论（2026-11-01，confirmed）**：核心面板直连成立，但有两条硬前提：
  1. 远程 agent host（WebSocket）**只在 Agents Window 生效** —— `EditorWindowRemoteAgentHostService.supportsWebSocketConnections` 被覆写为 `false`，编辑器窗口里 `chat.remoteAgentHosts` 永远读到空，聊天面板连 agent 选择器都不出现。冒烟与后续验收都要用 `./scripts/code.sh --agents`（CLI `--agents`）。
  2. 删除 Copilot 后**没有任何默认 chat agent**，`chatServiceImpl` 的默认 agent 前置检查会让所有会话型 agent 的发送直接失败（`No default agent available`）。已由 62 号补丁 `62-chat-default-agent-fallback.patch` 修复：全树无默认 agent 时回退到发送显式指定的 `agentIdSilent`。

---

## 7. 安全与合规设计

### 7.1 默认离线与无遥测

- `product.json`：`removeTelemetry: true`、`enableTelemetry: false`、无微软品牌。
- 内置扩展最小集：移除全部联网扩展（github、github-auth、tunnel、simple-browser、copilot、microsoft-auth）。
- 验收：构建产物反查无遥测端点、无微软市场 URL、无微软登录相关字节。

### 7.2 金发〔2026〕8号 关键条款映射

| 条款要求 | Picket Code/iCode 落点 | 状态 |
|---|---|---|
| 外部引入生成式模型需网信备案 | iCode BYO 模型，模型归属用户；备案责任在行内 | 产品可覆盖（行内自担） |
| 高风险场景人工复核（第22条） | AgentHost pending_confirmation ↔ iCode manual 审批 | 产品内建（confirmed 机制，待 POC 实测） |
| 日志保存期限不低于业务存续期（第21条） | AgentHost 会话 DB + iCode OTel；**留存期策略行内配置** | 待合同与配置验证 |
| 外包合同安全权责、名单制（第18条） | 供应商尽调 + DPA 条款 | 商务待办 |
| 开源台账、供应链防投毒（第19条） | iCode Apache-2.0 可审计；**SBOM/依赖审计需自建** | 缺口（confirmed） |
| 提示词注入、智能体安全（第25条） | iCode 护栏 + AgentHost 沙箱路径授权 | 待验证 |
| 无头自动化不得绕过审批 | **Picket Code 禁用无头审批 bypass 路径** | 设计红线（inferred → 落实为配置） |

### 7.3 扩展门控与受控市场

- 默认 Open VSX，可指向自建镜像。
- 后续叠加白名单策略：受控市场 + 扩展签名校验（规划，见 roadmap P0-3）。

### 7.4 沙箱与出站控制

- devcontainer 模板 + 出站防火墙配置（默认拒绝出站，白名单放行网关端点）。
- AgentHost 沙箱路径授权机制（workbench 侧 `agentHostSandboxPathGrant` 等）随核心保留。

---

## 8. 分阶段实施路线

| 阶段 | 目标 | 验证门（通过即进入下一阶段） |
|---|---|---|
| P0 | 钉版与补丁体系落地 | 执行器与 52 已落地（2026-10-23，本地实测 177/177）；53 rebase 后全量构建通过 |
| P1 | 品牌与微软绑定裁剪（已大部分完成） | 构建产物抓包无遥测/市场/更新出网 |
| P2 | 零 provider 核心：52/53 对齐 | host 启动正常、编辑器正常、产物无三套 SDK |
| P2.5 | 核心 UI 验证（新增，已决策路线） | ✅ 2026-11-01 实测通过：mock provider 会话在 **Agents Window** 可见、`createSession` 成功、`hello` 往返成功（编辑器窗口不支持远程 host；另需 62 号补丁修复默认 agent 门槛） |
| P3 | iCode 骨架注册 | picker 出现 iCode，hello 往返成功 |
| P4 | 常驻 app-server | 多轮、工具审批、diff、中断全链路 |
| P5 | UI/分发与品牌 | 安装包无国外 agent 字节；双平台冒烟 |

待验证项：56 个 copilot 引导文件降级行为、release.yml 四段真实 runner 验证（2026-10-23 run #13 已触发，versions 已通过，compile 进行中）、G6 L1 哈希比对脚本落地。（P2.5 面板渲染已于 2026-11-01 实测通过，见 §6.5。）

---

## 9. 风险与未决问题

| 风险 | 等级 | 缓解 |
|---|---|---|
| 53 号补丁跨 26 文件，上游重构引发 rebase 成本 | 中 | 钉版节奏固定；补丁锚点断言显式报错 |
| 内置聊天面板对非 copilot provider 兼容性未知 | 中 | ✅ 已解决（P2.5，2026-11-01）：Agents Window 可直接渲染远程 provider；配套 62 号补丁修复「删 Copilot 后无默认 agent」 |
| 扩展删除清单误删银行所需语言服务（SQL/Python） | 中 | 发布前按数据开发场景复核清单 |
| 无头 run 硬编码绕过审批（上游机制） | 高 | Picket Code 配置层禁用；合同与部署规范双重约束 |
| iCode 无认证/SLA/供应链台账 | 中 | 商务尽调 + 行内自建 SBOM/依赖审计 |
| 重构后 CI 未真实跑通 | 中 | 手动 workflow_dispatch 首跑验证 |

未决问题（已拍板两项，待定一项）：

1. ~~UI 路线~~ **已决**：先用 P2.5 验证内置面板；失败再评估外部 AHP client / 薄扩展。
2. ~~补丁执行器~~ **已决**：对齐 VSCodium（git apply + JSON actions），Python 锚点脚本作过渡后移除。
3. **扩展清单：待定**：银行场景是否恢复 SQL/Python 语言服务，发布前按数据开发场景复核。

---

## 10. 附录

### 10.1 事实—来源映射（关键证据）

| ID | 事实 | 来源 |
|---|---|---|
| F1 | 注册点两处、零 provider 容忍、首注册默认 | microsoft/vscode main `agentHostMain.ts`、`agentHostProviderService.ts`、`agentHostSessionLifecycle.ts`（SHA 29ea7eff） |
| F2 | 52 删 177 路径、53 改 26 文件、均不含 workbench；mockAgent 被 53 裁剪保留 | VSCodium master `patches/52-ext-copilot-remove-it.json`、`53-ext-copilot-remove-it.patch` |
| F3 | 聊天 UI 在 workbench 核心 | `workbench/contrib/chat/browser/agentSessions/agentHost/agentHost.contribution.ts` |
| F4 | iCode one-shot CLI、OTel gRPC 可用、HTTP/protobuf 缺依赖 | iCode 源码 + 本地 debug.log 实证 |
| F5 | 金发〔2026〕8号 八章三十二条，2026-06-18 印发 | nfra.gov.cn 官方全文 |
| F6 | Picket Code 构建现状（build.sh/package.sh/release.yml/product.json/apply-patches.sh/extensions-remove.list） | dantesun/picket-code main（2026-10-27 读取） |
| F7 | README/roadmap 曾引用已删除的 prepare.sh | 同上（K4 缺口，已随本版修订） |

### 10.2 术语表

| 术语 | 含义 |
|---|---|
| AgentHost | VS Code 内置的 agent 宿主平台：provider 注册、会话、审批、日志、AHP 传输 |
| AHP | Agent Host Protocol 0.7.0：renderer MessagePort + 本地 endpoint（unix socket/named pipe） |
| 52/53 | VSCodium 补丁编号：copilot 全量删除（json actions）与引用清理（git apply） |
| BYO | Bring Your Own（自带模型）；iCode 支持任意模型端点 |
| POC | Proof of Concept，验证阶段 |
