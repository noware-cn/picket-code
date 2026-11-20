# 设计总览

> 面向 AI 编码 agent 的加固版 Code-OSS 发行版——受控扩展、私有模型网关、按项目沙箱、iCode 一等公民。

完整设计文档见仓库 [docs/design.md](https://github.com/noware-cn/picket-code/blob/main/docs/design.md)（v1.0，2026-10-23 审核通过）。

## 背景与目标

**背景**：区域银行 AI Coding 落地受三方面约束——信创内网要求代码与数据不出网；金发〔2026〕8号要求模型备案、人工复核、日志留存不低于业务存续期；预算有限，倾向开源与自主可控方案。主流编码 agent 依赖公有云与国外服务（Copilot、Claude Code、Codex），SDK 与遥测和银行合规边界冲突，且不可裁剪。iCode 具备银行侧友好属性（全开源、BYO 模型、无遥测、OTel 就绪、workflow 与审批内建），但无现成 IDE 宿主与渠道。

**目标**：

| 编号 | 目标 | 验收口径 |
|---|---|---|
| G1 | 干净二进制：无遥测、无微软品牌、无微软市场 | 产物反查无遥测端点与微软标识 |
| G2 | 默认离线：不内置任何联网扩展 | 扩展最小集（32 保留 + 3 构建期） |
| G3 | 无国外 agent：产物不含 Copilot / Claude / Codex 的 provider 与 SDK | 产物反查无三套 SDK 依赖；agent host 运行时 import 图不含 `@vscode/copilot-api` / `@github/copilot-sdk`（57 号） |
| G4 | iCode 一等公民：AgentHost 注册 iCode，聊天面板可用 | P3 验证门：picker 出现 iCode，hello 往返成功 |
| G5 | 合规内建：人工审批、审计日志、数据不出网 | 金发〔2026〕8号关键条款映射可追溯 |
| G6 | 构建可重复：钉版 + 补丁体系 + CI 四段流水线 | L1 关键产物哈希一致（分级验收） |

**Non-goals（P0 不做）**：不做自有模型（模型一律 BYO）；不做云托管沙箱（devcontainer + 出站防火墙实现）；不兼容微软官方市场（Open VSX，可指向自建镜像）；不做 iOS/Android 等非常规平台（MVP 为 Linux x64 + Windows x64）。

## 设计原则

| # | 原则 | 说明 |
|---|---|---|
| P1 | 复用上游、减法优先 | 不重写 VS Code；沿 VSCodium 验证过的构建路径做减法，先删后补 |
| P2 | 对齐 VSCodium 机制 | 钉版 + prepare 脚本 + 分层补丁 + compile/package 分离 |
| P3 | 补丁锚点断言 | 每个补丁断言锚点文本；锚点失效时显式报错，不静默错补 |
| P4 | 证据驱动 | 关键设计决策标注 confirmed / inferred / unknown |
| P5 | 默认离线、默认无遥测 | 无遥测是出厂配置而非开关 |
| P6 | iCode 是唯一内置 agent | 不保留国外 agent 的任何注册路径 |
| P7 | 合规是产品属性 | 人工审批、审计日志、数据边界在架构层内建 |

## 分层架构（To Be）

```
┌─────────────────────────────────────────────────┐
│ 发行层：picket-code 品牌、Open VSX 市场、更新器关闭   │  ← P1 已落地
├─────────────────────────────────────────────────┤
│ 扩展层：最小内置集（32+3）＋受控市场按需安装     │  ← P1 已落地
├─────────────────────────────────────────────────┤
│ Workbench 核心：聊天 shell、设置、编辑器         │  ← 保留（含 agentHost 会话 UI）
├─────────────────────────────────────────────────┤
│ AgentHost 平台层：provider 注册、会话、审批、日志 │  ← 裁剪为"零 provider + 编排核心"
├─────────────────────────────────────────────────┤
│ 适配层：node/icode/（IAgent 实现）               │  ← P3–P4 新增
├─────────────────────────────────────────────────┤
│ iCode 引擎：Python CLI、workflow、审批、OTel     │  ← 外部进程，BYO 模型
└─────────────────────────────────────────────────┘
```

## 保留 / 删除边界（要点）

| 模块 | 处置 | 依据 |
|---|---|---|
| `src/vs/platform/agentHost/common/` 协议层 | 保留 | 零 provider 容忍 |
| `src/vs/platform/agentHost/node/` 编排器 | 保留 | 核心能力（providerService、sessionLifecycle、AHP） |
| `src/vs/workbench/contrib/chat/.../agentHost/` 聊天 UI | 保留 | 属 workbench 核心，52/53 不碰 |
| `node/copilot`、`node/claude`、`node/codex`、`node/otel`、`node/clientTools`、`common/otel` | 删除 | 复用 VSCodium 52 号清单（177 路径） |
| 三套 SDK 依赖 + gulp copilot 任务 + product 注入 | 删除 | 复用 VSCodium 53 号补丁（30 文件：28 修改 + 2 删除） |
| `extensions/copilot` 前端扩展 | 删除 | 52 号清单整目录删除 |
| 账号 UI 与 GitHub / Microsoft 登录 | 删除 | 构建剔除 `github`、`github-base`、`github-authentication`、`microsoft-authentication`；`product.json` 不再定义 `defaultChatAgent`、`trustedExtensionAuthAccess`、`builtInExtensionsEnabledWithAutoUpdates`（58 号让 `defaultAccount.ts` 容忍其缺失） |
| 遥测 / 云 / 更新 / 登录 / 签名 / onboarding | 删除 | 复用 VSCodium 00/10/11/60/80 系列补丁 |

**打包正确性**：`asar@3.2.0` 的 `Filesystem.insertFile` 在 await 完整性哈希**之前**记录 `this.offset`，并发插入因此拿到同一 offset——Windows 构建机上 3,765 个条目里有 751 个（约 20%）读回成别的文件，`tar/package.json` 返回一段 LICENSE 文本，agent host 启动时报 `ERR_INVALID_PACKAGE_CONFIG`。56 号补丁把插入串行化，CI 再用 `node build/check-asar.mjs` 解析产出的 `node_modules.asar` 断言布局；官方 VS Code 存在同一个潜伏竞态（其 Linux 构建机上约 0.1%）。原先为绕开该竞态而多解包 30 个包的清单已随之退役，解包清单回到上游的 11 条，`.asar.unpacked` 相应变小。

## 分阶段实施路线

| 阶段 | 目标 | 验证门 |
|---|---|---|
| P0 | 钉版与补丁体系落地 | 执行器与 52 已落地；53 rebase 后全量构建通过 |
| P1 | 品牌与微软绑定裁剪（已大部分完成） | 构建产物抓包无遥测 / 市场 / 更新出网 |
| P2 | 零 provider 核心：52/53 对齐 | host 启动正常、产物无三套 SDK |
| P2.5 | 核心 UI 验证 | 内置聊天面板可显示会话；通过则 UI 走核心面板直连 |
| P3 | iCode 骨架注册 | picker 出现 iCode，hello 往返成功 |
| P4 | 常驻 app-server | 多轮、工具审批、diff、中断全链路 |
| P5 | UI / 分发与品牌 | 安装包无国外 agent 字节；双平台冒烟 |

现状（2026-10-28）：P2 已完成——产物不含三套 SDK，agent host 在无 Copilot 包的情况下启动并说协议（57 号）；P2.5/P3 尚未验证，**发行版仍没有可用的 agent 后端**。

## 风险与未决问题

| 风险 | 等级 | 缓解 |
|---|---|---|
| 53 号补丁跨 30 文件，上游重构引发 rebase 成本 | 中 | 钉版节奏固定；补丁锚点断言显式报错 |
| 内置聊天面板对非 copilot provider 兼容性未知 | 中 | P2.5 用 mockAgent 先验证 |
| 扩展删除清单误删银行所需语言服务（SQL/Python） | 中 | 发布前按数据开发场景复核清单 |
| 无头 run 硬编码绕过审批（上游机制） | 高 | Picket Code 配置层禁用；合同与部署规范双重约束 |
| iCode 无认证 / SLA / 供应链台账 | 中 | 商务尽调 + 行内自建 SBOM / 依赖审计 |
