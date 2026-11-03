# 测试体系与发布门禁

> 目标：每次发布（`v*` tag）自动跑完所有能自动化的检查，产出一份人与机器都能读的报告；自动化到不了的地方，给出固定的人工验收清单。
>
> 适用对象：picket-code（VS Code fork，`vscode/` 树）+ `platform/agentHost/node/icode/` 适配层。

## 1. GitHub Actions 能测到什么程度

| 层 | 被测对象 | 需要什么 | 能跑在 GH Actions | 单次耗时（实测/估算） |
|---|---|---|---|---|
| L1 单元 | 纯函数、reducer、映射、配置解析（现有 74 个 iCode 用例 + changeset 332 个） | `out/`（transpile 即可），无显示 | ✅ 完全 | 2–4 min（含 build scripts） |
| L2 进程集成 | **真实 `icode acp` 协议边界**：我们的 `createIcodeTransport`/`IcodeAcpClient` 与一个**假 ACP CLI**（真进程、真 stdio、真 NDJSON） | 同上 + Node | ✅ 完全 | 1–2 min |
| L3 宿主端到端 | 真实 agent host 进程（`agentHostServerMain.js`）+ 真实 provider + 假 ACP CLI，**AHP over WebSocket**：建会话、发消息、收到 `ChatDelta`/工具调用、恢复、审批、取消 | 同上 + `ws` | ✅ 完全（不需要 Electron/X） | 3–6 min |
| L4 UI 冒烟 | 真实 Electron 窗口 + Agents Window + 聊天面板：文本渲染、diff 视图、ask_user 表单、审批横幅、重启后历史回填 | 完整编译（gulp 全套 + 扩展）+ Electron 二进制 + **Xvfb** | ✅ 可以做，代价 ~35–45 min | 见 §4.3 |
| L5 打包产物 | 安装包启动、asar 布局、无 Copilot 残留、真实窗口在 Xvfb 下启动 | 打包产物 | ✅ 已存在（`verify-release.yml`） | 8–15 min |
| L6 真实模型质量 | iCode 回复内容是否合理、真实模型调用、Windows 真机 `.cmd` 启动 | 真模型、真 Windows | ❌ 不能自动化（无凭据、非确定性、成本不可控） | 人工 |

**结论**：除了「模型回答质量」「Windows 真机」「真实凭据路径」三类，其余全部可以在 Actions 里自动跑。UI 层也能自动跑，只是贵——放在 tag 触发的发布流水线里，不放在每次 push。

## 2. 测试分层与用例清单

### L1 单元（已在库，纳入门禁）

`vscode/src/vs/platform/agentHost/test/node/icode/` 七个文件：
`icodeAcpClient`(19)、`icodeLaunchConfig`(13)、`icodeAgent`(21)、`icodeMapEvents`(10)、`icodeHistory`(4)、`icodeProviderData`(3)、`icodeInputRequests`(4)。

加 `agentHostChangeset*` 三套（146/115/71）与 `chatContributions`(146)、`chatService`(257)。

### L2 进程集成：假 ACP CLI（新增）

**假数据规格** —— `vscode/test/fixtures/fake-icode-acp.mjs`（零依赖 Node 脚本，通过 `PICKET_ICODE_BIN` 注入）：

- 命令行契约：`fake-icode-acp.mjs acp --approval <mode> -a <agent>`；不匹配时退出码 2（防止我们改了参数而测试静默通过）。
- 场景由 `FAKE_ICODE_SCENARIO` 选择，未知值 → 退出码 3。场景表：

| 场景 | 行为 | 用于断言 |
|---|---|---|
| `text` | `session/new` 回 2 个模型；`session/prompt` 期间发 `session/update`（agent_message_chunk ×3、`tool_call` → `tool_call_update` in_progress → completed、`plan`、`usage_update`），最后回 `stopReason: end_turn` | 文本聚合、工具调用三条信号、plan/usage 映射 |
| `ask` | 先发 `_chrys/request_input`（1 题 2 选项），等客户端回答后继续输出文本 | ask_user 往返、答案形状 `{answers:[{values,note}],cancelled}` |
| `permission` | 发 `session/request_permission`（`allow`/`reject`），allow 后发工具结果 | 审批往返、`pending_confirmation` 映射 |
| `cancel` | 收到 `session/cancel` 后回 `stopReason: cancelled` | 打断不被当成错误 |
| `slow` | 每 200ms 一条 chunk，共 50 条 | 流式不丢、背压 |
| `restore` | `session/load` 回放 3 条历史 update 后回 result | 历史回填顺序 |
| `restore-fail` | `session/load` 回 JSON-RPC error `-32000` | 恢复失败降级（丢弃种子、下次重建） |
| `crash` | prompt 中途 `process.exit(1)`（不写 result） | turn 以错误结束、不挂起、`_activePrompts` 释放 |
| `garbage` | 先打印一行非 JSON、再打印一行 5MB 超长 JSON | 解析健壮、`MAX_LINE_LENGTH` 守卫 |
| `hang` | 收到 prompt 后什么都不做 | 我们的超时/取消路径（配合 `session/cancel`） |

**用例（新增 `icodeAcpProcess.test.ts`）**：spawn 真进程 → 断言 id 分配、`session/cancel` 后 `stopReason`、进程被杀后 pending 请求全部 reject、stderr 进日志、`crash` 后 `exited=true` 且后续请求立即失败。

### L3 宿主端到端：AHP over WebSocket（新增）

`vscode/test/node/e2e/icodeAgentHostE2E.integrationTest.ts`（同 `test-node` 运行，无需 Electron）：

1. `startHost({ PICKET_ICODE_BIN: <fake>, PICKET_ICODE_AGENT_ENABLED: '1' })` → `READY:<port>`；
2. `session/new` → 断言出现的 provider 列表含 `icode`，模型目录 = 假服务器上报的两个；
3. **一轮对话**：`createSession`/`sendMessage` → 断言 `ChatDelta` 文本、`ChatToolCallStart/Ready/Complete`、`ChatTurnComplete`；
4. **审批**：`permission` 场景 → 断言 `pending_confirmation` → `respondToPermissionRequest(approve)` → 回合继续；
5. **ask_user**：`ask` 场景 → 断言 `ChatInputRequested` → 回答 → 回合继续；
6. **取消**：`slow` + `cancel` → 断言 `ChatTurnCancelled`；
7. **恢复**：`providerData` 落库后重启 host → `session/load` 被调用，历史条数与 `restore` 场景一致；
8. **崩溃**：`crash` → 断言收到错误信号、host 不挂、下一轮能重新起进程。

### L4 UI 冒烟（新增 `test/smoke/src/areas/agentsWindow/icode.test.ts`）

用 `setupAgentHostSuite` + `extraEnv: { PICKET_ICODE_BIN: <fake> }`，关掉真实 iCode：

| 用例 | 断言 |
|---|---|
| 会话类型出现 | 选 `iCode` 后 `waitForActiveSessionView()` |
| 一轮对话渲染 | `waitForAssistantText(<脚本文本>)` |
| per-turn diff | 假服务器先改工作区文件（场景 `diff`），响应下方出现文件名 + 点开有红绿 |
| ask_user 表单 | 出现表单、选第一项、回合继续 |
| 审批横幅 | 出现审批、点允许、工具结果出现 |
| 重启后历史回填 | 关窗重开同会话 → 历史文本仍在 |

> 前提：假 ACP CLI 需要真实改动工作区（`diff` 场景写文件），且会话工作目录必须由 workspace pill 指定为临时 git 仓库——该步骤本身就是被测行为。

### L5 打包产物（已存在，纳入报告）

`verify-release.yml` 的下载校验、product.json 断言、扩展扫描、Xvfb 真实启动。

### L6 人工验收清单（见 §5.3）

## 3. CI 编排

### 3.1 触发与门禁

| 工作流 | 触发 | 内容 | 阻断发布 |
|---|---|---|---|
| `tests.yml`（新） | `pull_request`、`push: main`、`workflow_call` | L1+L2+L3，ubuntu + windows 双平台（L1/L2 only，L3 只 ubuntu） | PR 必过 |
| `tests-ui.yml`（新） | `workflow_dispatch`、`schedule`（每日）、`workflow_call` | 编译 + L4 单个 shard | 发布前必须绿（人工触发或发布流水线调用） |
| `release.yml`（改） | `v*` tag | 先 `workflow_call: tests.yml` + `tests-ui.yml`，再编译/打包/发布 | ✅ 任一失败即不发布 |
| `verify-release.yml`（已存在） | 发布完成后 | L5 | 不再改 |

### 3.2 缓存与耗时预算

- 复用上游 `restore-node-modules` 思路：`actions/cache` 以 `package-lock.json` 哈希为 key；L1–L3 只需 `npm ci` + `transpile-client`（~6 min 冷、~2 min 热）。
- L4 需要完整 `gulp` 编译 + Electron：单独 job，`timeout-minutes: 60`，产物缓存 `.build/electron`。
- 所有 job 显式 `timeout-minutes`（当前 `release.yml` 一个都没有）。

### 3.3 ubuntu 依赖

L1–L3：`libkrb5-dev libx11-dev libxkbfile-dev libsecret-1-dev libxext-dev libxrender-dev libxrandr-dev`（编译期）。
L4 追加：`xvfb libnss3 libxss1 libatk-bridge2.0-0 libgtk-3-0 libasound2t64 libgbm1 libxkbcommon0`，用 `xvfb-run -a`。

## 4. 测试报告

每次运行产出三样东西：

1. **JUnit XML**（`test-results/*.xml`）——L1 用 `mocha-junit-reporter`（`test-node` 自身不产 junit，用直接调用 mocha 的包装脚本 `build/test/run-unit-junit.mjs`），L2/L3 复用同一包装，L4 由 smoke 自带的 `mocha-multi-reporters` 产出，L5 由现有脚本产出。
2. **`GITHUB_STEP_SUMMARY`**：`build/test/summarize.mjs` 汇总所有 xml → 一张表（层 / 用例数 / 通过 / 失败 / 耗时 / 失败用例名），失败用例直接列在 summary 里。
3. **Release 附件**：`release.yml` 把 `test-report/`（xml + markdown + 失败截图/trace）打包上传到 GitHub Release，命名 `test-report-<tag>.tar.gz`。

报告同时包含 **人工验收清单的状态**：`docs/release-checklist.md` 里的勾选项由发布人填写，结论写进 Release Notes 的「Verification」段。

### 4.1 报告样例（summary 渲染）

```
| 层 | 套件 | 用例 | 通过 | 失败 | 跳过 | 耗时 |
|---|---|---|---|---|---|---|
| L1 | icode (7) | 74 | 74 | 0 | 0 | 12s |
| L1 | changeset (4) | 478 | 478 | 0 | 0 | 41s |
| L2 | acp-process | 12 | 12 | 0 | 0 | 38s |
| L3 | agent-host e2e | 8 | 8 | 0 | 0 | 94s |
| L4 | agents-window ui | 6 | 6 | 0 | 0 | 21m |
```

## 5. 人工验收（无法自动化）

### 5.1 每次发布必做（发布人，10 分钟）

1. **真实模型往返**：装包 → Agents Window → 新会话（工作目录选 git 仓库）→ 发 `hello` → 回复出现。
2. **真实 diff**：让它改一个文件 → 响应下方出现可点开的 before/after。
3. **真实 ask_user**：`用 ask_user 问我要用哪个数据库再继续` → 表单出现、可选、回合继续。
4. **真实审批**：让它执行 `touch x.txt` → 审批横幅出现 → 允许 → 工具结果出现。
5. **重启恢复**：Ctrl+Q 重开 → 历史还在。
6. **失败可诊断**：故意把 `PICKET_ICODE_BIN` 指向不存在路径 → 面板给出明确错误而非静默失败。

### 5.2 平台矩阵（发布前）

| 平台 | 自动化覆盖 | 人工 |
|---|---|---|
| Linux x64 | L1–L5 全绿 | 上述 6 条 |
| Windows x64 | L1/L2 单测 + 打包产物启动冒烟 | `.cmd` 真实启动、审批、diff（历史欠账：`.cmd` 转义只到单测） |
| macOS | 未覆盖 | 等价于 5.1（v1 不发布 macOS 则跳过） |

### 5.3 记录方式

`docs/release-checklist.md` 每项 `- [ ]`，发布人在 PR/Release 里勾选；未勾项必须在 Release Notes 写明「未验证及原因」。

## 6. 与现有补丁的关系

- L2/L3/L4 都依赖 `PICKET_ICODE_BIN` 指向假 CLI —— 这是既有实现（`icodeLaunchConfig.ts:12`），**不需要新补丁**。
- 若需把 junit 报告接进 `test-node`，优先用外部包装脚本（`build/test/run-unit-junit.mjs`），不改 `test/unit/node/index.js`；确有必要时才追加 65 号补丁。
- 假 CLI 放 `vscode/test/fixtures/fake-icode-acp.mjs`，随 **63 号补丁**进入构建树（CI 从克隆树里取，不额外复制）；UI 冒烟用例与 page object 随 **65 号补丁**。两者都不修改上游运行时代码。

## 7. 已知限制

| 限制 | 影响 | 缓解 |
|---|---|---|
| 假 CLI 不验证 iCode 的真实字段演化 | iCode 改协议时测试仍绿 | 每次升级 iCode 版本跑一次真实 `scripts/test-icode-contract.sh`（用真 CLI 做 `session/new` + 一轮最小 prompt，无需模型质量断言） |
| L4 依赖 workspace pill 选文件夹 | 选错文件夹时 diff 用例失败 | 用例显式断言 pill 文本，失败信息直接指向 UI 回归 |
| Windows 无 UI 自动化 | `.cmd` 启动回归只能人工 | L1 覆盖转义字符串，人工清单强制勾选 |
