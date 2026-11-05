# 发布验收清单（人工，约 10 分钟）

> 来源：`docs/testing.md` §5。L1–L5 由 `tests.yml` / `tests-ui.yml` / `verify-release.yml`
> 自动跑完并产出 JUnit + Markdown 报告；本清单只覆盖自动化到不了的部分：真实模型、
> 真实凭据、真实 Windows 启动，以及只有人眼能判断的 UI 观感。
>
> 用法：发布人在发布 PR / Release 里逐项勾选。**没勾的项必须在 Release Notes 写明
> 「未验证项及原因」**，并在下面的第 3 节登记。

- 发布版本：`<tag>`
- 发布人：
- 日期：
- 平台 / 包：`picket-code-<tag>-linux-x64.tar.gz` / `picket-code-<tag>-win32-x64.zip`
- 测试报告附件：`test-report-<tag>.tar.gz` —— 链接：
- 自动化结果（逐项确认绿的 run 链接）：
  - [ ] `tests.yml`（contract / L1 / L2）
  - [ ] `tests-ui.yml` 的 `ui` job（L4 UI 冒烟）
  - [ ] `tests-ui.yml` 的 `wsl-acceptance` job（WSL 验收矩阵，`build/wsl/acceptance.sh --all`）
  - [ ] `verify-release.yml`（L5 打包产物启动）

## 0. 发布前置配置（一次性，改了就检查）

`build/build.sh` 从 WSL 组件装配开始就**要求**下面两个值，缺任一个编译直接失败：

- 仓库变量 `PICKET_SERVER_TAG`：`noware-cn/picket-code-server` 的载荷 tag，例如
  `v1.143.1-picket.1-rc.4`。它决定这个构建内部钉的是哪份服务器载荷。
- 仓库密钥 `PICKET_SERVER_TOKEN`：能读那个私有仓库 Release 的令牌。**应当是一个只读
  Contents 的 fine-grained PAT**；用个人 OAuth token（`gh auth token`）能跑通，但重新登录
  就会静默失效，而自检步骤在看到空字符串之前不会报警。
- `verify-release.yml` 跑完再确认一次：`gh release view <tag> --json assets` 里应有
  `…-offline-wsl.zip`（离线组件包），大小约 87 MB。

报告链接取法（发布后再补）：`gh release view <tag> --json assets --jq '.assets[].name'`
—— 附件里是全部 `test-results/*.xml` 与汇总 `summary.md`；同一次发布的 Markdown 汇总
同时出现在 Release workflow 的 Summary 页（`GITHUB_STEP_SUMMARY`）。

## 1. 每次发布必做

Linux x64 包上依次执行，任一项失败即停止发布。

- [ ] **真实模型往返**：装包 → Agents Window → 新会话（工作目录选一个 git 仓库）→ 发 `hello`
      → 回复文本出现。记录所用模型 / 凭据来源：
- [ ] **真实 diff**：让它改一个文件 → 响应下方出现可点开的 before/after（文件名 + 红绿）。
- [ ] **真实 ask_user**：输入 `用 ask_user 问我要用哪个数据库再继续` → 表单出现、能选、
      回合继续。
- [ ] **真实审批**：让它执行 `touch x.txt` → 审批横幅出现 → 点允许 → 工具结果出现。
- [ ] **重启恢复**：Ctrl+Q 关掉重开 → 同一会话历史仍在（顺序正确）。
- [ ] **失败可诊断**：把 `PICKET_ICODE_BIN` 指向不存在的路径后重启 → 面板给出明确错误，
      不是静默失败、不是空面板。

## 2. 平台矩阵

| 平台 | 自动化覆盖 | 人工项 | 结论 |
|---|---|---|---|
| Linux x64 | L1–L5 全绿 | 第 1 节 6 条 | - [ ] 通过 |
| Windows x64 | L1/L2 单测 + 打包产物启动冒烟 | `.cmd` 真实启动、审批、diff | - [ ] 通过 |
| Windows x64（历史欠账） | `.cmd` 转义只到单测（`icodeLaunchConfig`） | 在真机上用 `.cmd` 版 iCode 跑一轮对话 | - [ ] 通过 |
| Windows x64 + WSL2（远程窗口） | `.github/workflows/tests-ui.yml` 的 `wsl-acceptance` job（`workflow_dispatch` / 每日 `schedule` / `release.yml` 通过 `workflow_call` 调用），在 `xvfb-run` 下跑 `build/wsl/acceptance.sh --all`：remote / tunnel / ui / lifecycle / icode 五阶段 + 扩展单测，Linux 桌面跑，`wsl.exe` 用替身、服务器载荷是真的 + L4 冒烟用例 A5/A6 | `docs/wsl-verification.md` 四项：原生文件夹对话框、真实 `picket-code .`、界面观感、M4 末 15 分钟走查。**Windows Server 与 WSL1 不在范围** | - [ ] 通过 |
| macOS | 未覆盖 | v1 不发布 macOS 则跳过此项 | - [ ] 不适用 / - [ ] 通过 |

## 3. 未验证项及原因

> 每一条未勾选的项都在这里写清「为什么」和「影响」。Release Notes 的 Verification
> 段落直接引用本节内容。

| 项目 | 状态 | 原因 | 影响 / 后续动作 |
|---|---|---|---|
| | 未验证 | | |

## 4. Release Notes「Verification」段落模板

```text
Verification
- Automated: contract, L1 (iCode + agentHostChangeset), L2 (fake ACP CLI), L4 (UI smoke), L5 (packaged app) — all green.
  Report: test-report-<tag>.tar.gz (attached).
- Manual: <n>/6 of docs/release-checklist.md §1 verified on Linux x64.
- Not verified: <items, with the reason from §3>.
```
