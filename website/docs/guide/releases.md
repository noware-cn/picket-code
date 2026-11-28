# 发行与版本

> 推送 `v*` 标签（或手动 `workflow_dispatch`）触发 GitHub Actions 发行工作流，四段发行流水线自动产出双平台发行包，末尾的 `r2-sync` 任务再把资产镜像到 Cloudflare R2（保留最近 3 个版本）。发行成功后 `verify-release` 工作流自动把产物下载回 runner 做实机验证。

## 发行流水线

```
versions ──► compile(linux) ──┐
             compile(win32) ──┼──► package(linux) ──┐
                              │    package(win32) ──┼──► release ──► r2-sync
                              └─────────────────────┘
```

| 阶段 | 职责 |
|---|---|
| **versions** | 从标签解析上游 VS Code tag（去掉 `-pN` 后缀）与 Node 版本（从上游 `.nvmrc` 读取） |
| **compile** | linux / win32 矩阵：钉版 tag 处克隆 `microsoft/vscode` → 裁剪内置扩展 → 应用补丁 → `npm ci` → 上游 min 构建，产出 `vscode.tar.gz` |
| **package** | 按平台解包、重命名为 `picket-code-*`、归档并生成 `SHA256SUMS`；同时跑三项门禁（见下） |
| **release** | 将产物发布到 GitHub Release，并把镜像地址写在 Release 说明顶部 |
| **r2-sync** | `rclone copy` 当前 Release 资产到 Cloudflare R2 桶 `picket-releases`，再跑 `prune-r2.sh` 只保留最近 3 个版本 |
| **verify-release** | 发行成功后自动触发（也可 `workflow_dispatch` 指定历史 tag）：下载产物 → 校验 `SHA256SUMS` → 断言 `product.json` 形状 → 跑 `--list-extensions` → 真实启动窗口并统计扩展宿主激活数量 |

## 发行后验证

`verify-release` 在 linux 与 win32 两条 runner 上各跑一遍，判据是**实测**而非"没报错"：

- `product.json` 形状：`builtInExtensionsEnabledWithAutoUpdates` 必须为空数组；`defaultChatAgent`、`trustedExtensionAuthAccess`、`updateUrl`、`tunnelApplicationConfig` 必须不存在；
- `--list-extensions --show-versions` 必须退出 0，且 stderr 不含 `is not iterable` / `Error scanning installed extensions` / `reading 'extensionId'`；
- 启动真实窗口（linux 走 Xvfb，win32 走桌面）60 秒后，扩展宿主的 `exthost.log` 里 `_doActivateExtension` 至少 3 条且包含 `vscode.git`；
- 全量应用日志不得出现上述三条错误签名。

## CI 门禁

`package` 阶段失败即中止发行，三项断言与动态检查：

- `node build/check-asar.mjs` 解析产出的 `node_modules.asar`，条目偏移重叠 / 数据区不匹配即失败；
- 账号残留断言：`product.json` 不得含 `defaultChatAgent`、`trustedExtensionAuthAccess`、`updateUrl`，且 `builtInExtensionsEnabledWithAutoUpdates` 必须为空数组（上游代码对它裸 `for…of`，缺失或 `null` 会让扩展扫描器构造时抛错）；内置扩展目录不得含 `github` / `github-base` / `github-authentication` / `microsoft-authentication`，发行包不得携带 copilot shim；
- 打包后的 Windows 应用实际启动 55 秒，日志命中 `ERR_INVALID_PACKAGE_CONFIG`、`Uncaught Exception`、`Could not locate the bindings file`、`Cannot find module`、`is not iterable`、`Error scanning installed extensions`、`reading 'extensionId'` 任一即失败。

## 触发方式

- **推送 `v*` 标签**：标签以上游 VS Code 版本命名，当前为 `v1.143.1`（上游 `1.143.1`）。同一上游版本重建时**移动标签**：删掉旧 Release（`gh release delete <tag> --yes --cleanup-tag`），把同名 tag 重新指向新提交后 `git push origin <tag> --force`，不复用 `-pN` 后缀；工作流对历史遗留的 `-pN` 标签仍会剥掉后缀再定位上游 tag。
- **手动触发**：`workflow_dispatch`，可指定上游版本与是否预发布。

### 预发行版（RC）

预发行版走同一条流水线，只是标签带 RC 后缀、Release 自动标注 Pre-release：

- 标签格式 `v<上游版本>-picket.<N>-rc.<M>`（如 `v1.143.1-picket.1-rc.8`）；`versions` 阶段把 `-picket…` 之后的部分整体剥掉后定位上游 tag；
- 推 `-rc.` 标签时 `tests-ui` 无论输入如何都会运行（L4 UI 冒烟 + WSL 验收矩阵），红色即不出产物；
- 资产名同样带标签，另有 `test-report-<tag>.tar.gz` 测试报告；服务器载荷不再随发行版附带，客户端会按 catalog 自动下载（见 [WSL 支持](/guide/wsl)）；
- RC 也镜像到 R2，但 `prune-r2.sh` 只识别 `vX.Y.Z` / `-pN` 形态，因此 RC 对象不会被自动清理。

> 历史：早期用 `-pN` 区分同一上游版本的重建（`v1.143.1-p1` … `v1.143.1-p4`）。`p1`/`p2` 因 `product.json` 两个字段被写成 `null` / `{}`，扩展扫描器构造即抛错、装后不加载任何扩展；`p3`/`p4` 修好了扩展加载但仍按旧策略命名。2026-10-31 起改为单一标签：`v1.143.1` 指向当前发行（含提案 API 白名单与 WSL 服务端打包脚本），`-p1`…`-p4` 的 Release 与 tag 已全部删除。

## 当前版本 v1.143.1

本次重建（2026-10-31）在上一次基础上追加：

- **提案 API**：`product.json` 新增 `extensionEnabledApiProposals`，为 `ms-vscode-remote.remote-wsl` 放行 `resolvers`、`contribRemoteHelp`、`contribViewsRemote`、`telemetry`。此前该扩展激活即失败（`CANNOT use API proposal: resolvers`）——没有白名单时核心会把扩展声明的提案整段剥离。
- **WSL 服务端打包**：`build/manual-wsl-server.sh` 用载荷自带的 `node` 改写服务端 `product.json`，把数据与扩展目录隔离到 `~/.picket-code-server`（原先会写进 `~/.vscode-server`，与已装的 VS Code 共用 logs、globalStorage 与扩展）；同时补 `bin/picket-code-server` 入口、移开载荷里的 `vsda`。细节与许可边界见 `docs/manual-remote-wsl.md`。

上一版的改动仍然有效：

- **语音**：启动不再为云听写向 GitHub 认证要会话（此前每次启动等满 10 秒并打一条 WARN）；Voice Mode 整块不再加载（`agentsVoice.*` 命令、会话选择器、转录视图、onboarding、原生命令，约 7400 行），云听写入口随之消失；**本地离线听写保留**（`foundry-local-sdk`，无需登录、无需权益）。
- **欢迎页**：启动时不再自动打开（`workbench.startupEditor` 默认 `none`）；agents banner 不再拿到账户服务，因此不可能再出现无法完成的 "Sign in to GitHub"；移除两张 "Get started with VS Code" 走查卡片，无障碍走查保留（帮助菜单按 id 打开它），标题改为 Picket Code。
- **agent host**：不再为 Electron 主进程那条连接注册 BYOK 反向桥——那条连接从来没有这个通道，此前每次启动会打 `Unknown channel: agentHostClientByokLm`。
- **验证**：`verify-release` 新增三条运行时断言（日志中不得出现 `[chat-stt]`、`Unknown channel: agentHostClientByokLm`、`walkThrough://vscode_getting_started_page`），linux 与 win32 均通过；`--list-extensions` 退出 0，`vscode.git` 等 5 个内置扩展完成激活。

### 更早的修复（`-p3` 及之前）

- `builtInExtensionsEnabledWithAutoUpdates` 恢复为上游类型（空数组），`tunnelApplicationConfig` 整个键移除 → 扩展扫描器不再崩，用户扩展与内置扩展都可加载；
- `apply-patches.sh` 新增形状守卫（`build/check-product-shapes.py`）：覆盖项类型不符、删除上游数组/对象键未登记守卫、新增上游不存在的空容器，都会让构建失败；
- 无默认账户提供方时释放 `initBarrier`，GitHub 相关视图不再永远转圈，账户策略门禁不再停在 Inactive；
- 状态栏 Copilot 图标与看板、Welcome 的 "Use AI features with Copilot for free" 步骤、终端命令文案里的 `copilot` 均已消失（`ChatContextKeys.Setup.hidden` 未动，MCP 命令不受影响）。

## 版本策略

- 每次发布钉一个上游 tag（如 1.143.1），补丁按钉版应用；
- 同一上游版本的多次重建不升级钉版，直接移动同名标签（不复用 `-pN` 后缀）；
- 升级流程：更新钉版 → 逐补丁检查锚点 → 全量构建 → 冒烟；
- 长期维护成本：53 号补丁跨 30 个文件（28 修改 + 2 删除），上游每次重构都会引发 rebase（与 VSCodium 同处境，接受）。

## 产物

文件名带版本号（`picket-code-<tag>-<os>-<arch>.<ext>`），版本既由标签区分，也写在文件名里；GitHub Release 资产与镜像上的文件名完全一致。

| 平台 | 产物 | 校验 |
|---|---|---|
| Linux (x64) | `picket-code-<tag>-linux-x64.tar.gz` | `picket-code-<tag>-SHA256SUMS` |
| Windows (x64) | `picket-code-<tag>-win32-x64.zip` | `picket-code-<tag>-SHA256SUMS` |

归档内的顶层目录不带版本号：`picket-code-win32-x64/`、`picket-code-linux-x64/`。

## 镜像

Release 资产会 `rclone copy` 到 Cloudflare R2 桶 `picket-releases`，对外通过 R2 自定义域名 `https://download.noware.cn` 提供（文档站仍在 `https://picket-code.noware.cn`）。该主机名是 R2 桶的自定义域名，对象由 R2 直接返回（`cf-cache-status: DYNAMIC`，即不经 Cloudflare 边缘缓存），因此每次下载都会读取 R2。示例（tag `v1.143.1`）：

- `https://download.noware.cn/picket-code-v1.143.1-win32-x64.zip`
- `https://download.noware.cn/picket-code-v1.143.1-linux-x64.tar.gz`
- `https://download.noware.cn/picket-code-v1.143.1-SHA256SUMS`

```bash
curl -fSL https://download.noware.cn/picket-code-v1.143.1-SHA256SUMS -o SHA256SUMS
sha256sum -c --ignore-missing SHA256SUMS
```

- 镜像保留最近 **3 个版本**，更早的版本不承诺长期可下载；
- 没有 `latest` 别名：文件名含版本，一个 URL 的内容永不改变，因此 URL 永久有效且可长期缓存（`cache-control: immutable`）；
- 旧的无版本 URL（`/picket-code-win32-x64.zip`、`/SHA256SUMS`）已废弃，不提供兼容，请求返回 404。

## 计划中的打包升级

- AppImage 与 deb（Linux）、dmg（macOS）、NSIS 安装器（Windows）；
- 代码签名；
- macOS（darwin）在 P0 验证后加入发行矩阵；
- CI 矩阵加入 ARM64。
