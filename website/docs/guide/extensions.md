# 扩展策略

> Picket Code 只内置**最小必要**的扩展：降低攻击面、移除微软 / Copilot 相关组件与遥测、缩小发行体积，并且**默认离线**。

数据来源：钉版上游 `microsoft/vscode@1.143.1` 的 `extensions/` 与 `product.json` 的 `builtInExtensions`（3 个构建时下载的 JS 调试扩展）。

## 决策原则

1. **只保留编辑器离不开的核心**：Web 基础栈语言服务（TS/JS、JSON、CSS、HTML、Markdown）、Git 本地版本控制、配置 / 扩展编辑、引用 / 搜索 / 合并 / 调试基础、主题与图标、JS 调试三件套。
2. **移除一切需要联网或依赖云服务的扩展**：GitHub 集成、GitHub OAuth 认证、VS Code 隧道 / 端口转发、内置浏览器。
3. **移除微软 / 云组件**：`copilot`（GitHub Copilot Chat）、`microsoft-authentication`。
4. **移除内部测试扩展**：`vscode-*` 测试 / 着色 / API 扩展。
5. **不内置非核心语言语法与工具链**：需要时从受控市场按需安装。
6. **只保留默认主题与图标**，移除冗余主题。

## 保留集（32 个）

### 核心（29 个，仓库内目录）

| 扩展 | 作用 |
|---|---|
| configuration-editing / extension-editing | 设置与 JSON / 扩展配置编辑 |
| emmet | HTML/CSS 快速编写 |
| references-view / search-result / merge-conflict | 引用 / 搜索结果 / 合并冲突 |
| debug-auto-launch / debug-server-ready | Node 自动调试 / 服务就绪调试 |
| media-preview | 媒体文件预览 |
| markdown-basics / markdown-language-features / markdown-math / mermaid-markdown-features | Markdown 语言服务与图表 |
| prompt-basics（prompt） | prompt 文件语法 |
| theme-defaults / theme-modern-icons | 默认主题与图标 |
| git / git-base | 本地版本控制（仅用户主动执行 Git 命令时才联网） |
| npm / terminal-suggest | npm 脚本运行器 / 终端命令补全 |
| ipynb / notebook-renderers | Notebook 支持 |
| typescript-basics / typescript-language-features / javascript / types | TS/JS 栈 |
| css / html / json 及其 language-features | CSS / HTML / JSON 栈 |

### 构建时下载（3 个）

- `ms-vscode.js-debug`、`ms-vscode.js-debug-companion`、`ms-vscode.vscode-js-profile-table`（本地调试，不联网）

## 移除（65 个）

| 类别 | 数量 | 示例 | 是否可恢复安装 |
|---|---|---|---|
| 语言语法 | 41 | python、php、shellscript、sql、go、rust、java、cpp 等 | 是，从受控市场 |
| 工具链 | 4 | grunt、gulp、jake、docker | 是 |
| **联网 / 云服务（必须移除）** | **5** | **github、github-base、github-authentication、tunnel-forwarding、simple-browser** | **否——默认离线，按需开放** |
| 微软 / 云组件（必须移除） | 2 | copilot、microsoft-authentication | 否——策略排除 |
| 内部测试 | 4 | vscode-api-tests 等 | 否 |
| 冗余主题 | 9 | theme-monokai、theme-seti、theme-solarized-* 等 | 是 |

> 语言语法类（含 SQL / Python）是否保留，按银行数据开发场景在发布前复核（见[设计总览](/architecture/overview)风险章节）。

## 没有 GitHub / Microsoft 账号体系

`github`、`github-base`、`github-authentication`、`microsoft-authentication` 被整体移除，`product.json` 也不再定义 `defaultChatAgent`、`trustedExtensionAuthAccess`、`builtInExtensionsEnabledWithAutoUpdates`。对扩展的实际影响：

- 扩展调用 `authentication.getSession('github', ...)` 拿不到会话（没有可用的认证 provider），需要自行降级或提示未登录；
- 依赖账号的特性不可用：Settings Sync、Publish to GitHub、GitHub 拉取请求 / Issues 集成、需要 Microsoft 账号的订阅类功能；
- 不需要认证的路径照常工作：Git over HTTPS / SSH（凭据来自系统凭据管理器或 SSH agent）、Open VSX 安装、本地语言服务与调试；
- CI 会断言 `extensions/` 与 `product.json` 中没有上述扩展和账号键，防止回潮。

## 受控市场（P0-3 规划）

- 默认市场：**Open VSX**，可指向自建镜像（`Picket: 选择扩展市场来源`）；
- 白名单策略：受控市场 + 扩展来源审查；**签名校验当前构建未启用**（载荷未带 `@vscode/vsce-sign`，安装时会记一条 `Signature verification was not executed`，扩展仍会装上）；
- 恢复某扩展：从 `build/extensions-remove.list` 删除对应行后重建，或从受控市场按需安装。

## 想用微软市场？可以配，但不建议

微软 MarketPlace 的使用条款把 API 访问限定给 Visual Studio Code 本身，其它客户端调用它属于**违约**（与版权无关）。我们**不预置**这个地址，也不代理、不镜像它的下载；下面只是"用户自担风险"的配置方法，出事与本产品无关：

1. 命令面板 → `Picket: 选择扩展市场来源` → 选"自定义"；
2. 填 `https://marketplace.visualstudio.com/_apis/public/gallery`；
3. 重载窗口后搜索安装。

风险清单：

- **条款风险**：可能被判违约，账号或 IP 被限流/封禁；企业环境请先问法务；
- **扩展许可风险**：专有扩展（Pylance、C# / C# Dev Kit、Copilot、Remote-SSH/Containers/WSL）把"只能配合 VS Code 使用"写进许可，装到这里属于超出授权；我们不内置、不推荐、不提供一键安装；
- **升级风险**：微软市场会推 `engines.vscode` 高于本版的版本，装上后可能不激活；本客户端 1.143.1 的 API 面与官方同版本一致，但内置扩展被裁过，依赖它们的扩展会降级（见下文"WSL 远程开发"与 GitHub 认证一条）。

**合法的替代路径**（同等能力，可分发）：Python 用 BasedPyright / Pyright，C# 用 OmniSharp，C/C++ 用 clangd + CodeLLDB，AI 补全用 iCode，远程开发用内置的 `picket-remote-wsl`。

## WSL 远程开发

WSL2 远程开发由内置扩展 `noware.picket-remote-wsl` 提供，服务端是我们自己构建的 Linux 载荷，不依赖也不分发微软的 Remote-WSL 扩展——**反过来，官方扩展必须卸载**，否则两边抢同一个 authority。用法、载荷来源与排错见[在 WSL 中使用](/guide/wsl)。

## 机制

- `build/extensions-remove.list`：每行一个扩展目录名；`build/build.sh` 在 `npm ci` / `gulp` 前删除这些目录。
- JS 调试三件套由 `product.json` 的 `builtInExtensions` 配置，构建期从各自 GitHub Release 直接下载 vsix（不经 Open VSX），不受本清单影响。
