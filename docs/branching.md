# 分支策略与权责边界

> 一句话：**AI 写代码和测试，人决定发什么、签什么、承诺什么。** 自动化能证明"没坏"，人负责"对不对、敢不敢发"。

## 1. 分支模型

```
main ──●──●──●──●──●──●──●──●──●──→   （始终可发布；受保护）
        \      \        \
         feat/… fix/…   hotfix/…      （短命分支，< 3 天，PR 合入后删除）
                                     ⤷ tag v1.143.1-picket.N 触发发布
```

| 分支 | 用途 | 存活期 | 谁能推 |
|---|---|---|---|
| `main` | 唯一长期分支，必须始终可构建、可发布 | 永久 | 只经 PR 合入（含维护者） |
| `feat/<slug>` | 新功能（如 `feat/icode-p5`） | < 3 天 | AI 可推，人可推 |
| `fix/<slug>` | 缺陷修复 | < 2 天 | AI 可推，人可推 |
| `hotfix/<slug>` | 已发布版本紧急修复，从对应 tag 拉出 | < 1 天 | 人工发起，AI 可写代码 |
| `exp/<slug>` | 试验性 spike，不保证可构建 | < 1 周 | AI 可推；不合入则删 |

规则：

1. **不做长期 `develop` 分支**：我们没有并行发布需求，长期分支只会带来 cherry-pick 地狱。需要同时维护两个版本时，才从 tag 拉 `release/x.y`（只接受 hotfix）。
2. **一个 PR 一个主题**，不夹带格式化/重命名。
3. **补齐丁必须同 PR 内自带**：改 `vscode/` 源码 → 同 PR 重新导出对应 `build/patches/NN-*.patch` 并更新 `apply-list.txt`（若新增），PR 描述里贴 `git apply -R --check` 输出。
4. **tag 只由人打**，且只能打在 `main` 的已绿提交上。
5. 合入策略：squash merge（保持 `main` 线性，便于 `git bisect` 与回滚）；提交信息遵循 `<type>(<scope>): <summary>`。

## 2. 保护规则（GitHub 设置，人工配置一次）

`main`：

- 禁止直接 push、禁止 force push、禁止删除；
- 必需状态检查：`tests / unit`、`tests / acp-process`、`tests / host-e2e`、`contract`（`build/check-contract.sh`）；
- 必需 1 个人类 review（敏感路径见 §4 需 2 个或指定 owner）；
- 必需分支与 `main` 同步（不允许过期基线合入）；
- 线性历史（squash only）。

## 3. AI 能做什么

AI（含本仓库使用的编码代理）在**分支 + PR** 范围内可自主完成：

| 能力 | 边界 |
|---|---|
| 读代码、定位缺陷、写实现 | 只能改自己 PR 范围内的文件 |
| 写/改单测、集成测试、假数据、fixture | 不允许为了让测试通过而削弱断言；删除或跳过用例必须在 PR 里显式说明理由 |
| 改文档（`docs/`、`website/` 文案） | 不发布、不改域名/链接策略 |
| 重新生成补丁、跑 `check-contract.sh`、跑全套测试 | 必须贴出实际输出，不得声称"应该没问题" |
| 起草 PR 描述、变更说明、Release Notes 草稿 | Release Notes 定稿由人确认 |
| 提交到 `feat/*`、`fix/*`、`exp/*` 分支 | 不 push `main`、不 push tag、不强制推送 |

AI **不得**（即使被要求也要先停下并说明）：

1. 创建或推送 tag、触发发布、修改 GitHub Release、操作 R2 镜像；
2. 修改 `.github/workflows/**`（除非该 PR 的主题就是 CI，且需人类 review）；
3. 修改 `build/product.json`、`build/patches/apply-list.txt` 的启用集合、`apply-patches.sh` 的语义（同属发布契约，需人类 review）；
4. 处理凭据：读/写 `.env`、`~/.npmrc`、R2/Cloudflare token、模型 API key；
5. 关闭/跳过失败的测试、把 `timeout` 调大以掩盖挂起、删除失败用例；
6. 在未跑测试的情况下声明"已通过"；
7. 自行决定降低安全设置（`--no-sandbox`、关闭校验、放宽 CSP）。

## 4. 人类必须把关的点

| 关卡 | 为什么必须是人 | 判定标准 |
|---|---|---|
| **发布决定**（打 tag） | 承诺对外、不可撤回 | 自动化报告全绿 + §5.1 人工清单勾完 |
| **补丁语义**（`build/patches/**`、`apply-patches.sh`、`product.json`） | 决定"我们和上游差在哪"，是产品定义 | 每个补丁有 `README.md` 条目 + 反向 applicable 证明 |
| **CI/CD 与发布基础设施**（`.github/**`、`build/*.sh` 的发布段） | 影响所有后续发布 | 改动需 2 人 review，并在 `workflow_dispatch` 上先干跑一次 |
| **安全与凭据** | 泄露不可逆 | 有凭据相关改动一律拒绝由 AI 提交，人工单独处理 |
| **协议契约变更**（`IAgent` 实现面、AHP 字段） | 破坏面广、回归隐蔽 | 必须附 L3 端到端用例 + 更新 `docs/design.md` |
| **人工验收**（真实模型、Windows 真机） | 自动化覆盖不到 | 6 条清单逐项勾选，未勾项写进 Release Notes |
| **对外文案**（网站、Release Notes） | 涉及承诺 | 发布人定稿 |

## 5. 提交与 PR 约定

- 提交：`<type>(<scope>): <summary>`，`type ∈ feat|fix|test|docs|chore|patch|ci`；`scope` 例：`icode`、`changeset`、`chat`、`release`。
- PR 模板必填：**改了什么** / **怎么验的（贴命令与结果）** / **风险与回滚** / **是否影响补丁**。
- 每个 PR 必须让 `tests.yml` 绿；触及 `vscode/` 源码还需说明补丁是否重新生成。
- 合入后删除分支；`main` 上每个提交都应能独立构建。

## 6. 版本与热修

- 版本号：`<vscode 版本>-picket.<序号>`，如 `1.143.1-picket.1`。
- 发布：`main` 打 tag → `release.yml`（含测试门禁）→ 产物 + `test-report-<tag>.tar.gz`。
- 热修：从故障 tag 拉 `hotfix/<slug>` → 修复 + 针对性测试 → 合回 `main` → 打新 tag（**不移动旧 tag**）。
- 回滚：发布后 24h 内发现阻断问题，直接 `gh release delete` 撤销该版本并把镜像指针退回上一版；`main` 上对应提交用 revert PR 回滚，不做 `reset`。

## 7. AI 协作节奏（约定）

1. **任务进入前**：人给出目标 + 验收标准（能自动化的写成测试名，不能的写成人工步骤）。
2. **执行中**：AI 在分支上小步提交，每步跑相关测试；遇到需要人类决策的分叉（协议取舍、补丁范围）先停。
3. **交付时**：AI 给"改了什么 / 验证证据 / 未验证项"，未验证项由人决定是否接受。
4. **合入前**：人只审"意图、边界、风险"三件事；细节由测试兜底。
5. **发布时**：人跑 §5.1 清单、打 tag、写 Release Notes。
