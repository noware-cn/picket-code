# 下载与安装

> 当前版本：**v1.143.1**（上游 VS Code `1.143.1`）。发行包发布在 GitHub Releases，并镜像到 `https://download.noware.cn`（保留最近 3 个版本，更早的版本不承诺长期可下载）。

## 版本标签与产物

- 标签格式：`<上游 VS Code 版本>`，如 `v1.143.1`。同一上游版本重建时直接移动同名标签（删旧 Release → 打同名 tag → force push），不再追加 `-pN` 后缀；
- 文件名带版本号（`picket-code-<tag>-<os>-<arch>.<ext>`），GitHub Release 资产与镜像上的文件名完全一致：

| 平台 | 资产（示例 tag `v1.143.1`） |
|---|---|
| Linux (x64) | `picket-code-v1.143.1-linux-x64.tar.gz` |
| Windows (x64) | `picket-code-v1.143.1-win32-x64.zip` |
| 校验 | `picket-code-v1.143.1-SHA256SUMS` |

归档内的顶层目录**不带**版本号：`picket-code-win32-x64/`、`picket-code-linux-x64/`。

## 平台支持

| 平台 | 架构 | 格式 | 状态 |
|---|---|---|---|
| Linux | x64 | `tar.gz` | 当前发行 |
| Windows | x64 | `zip` | 当前发行 |
| macOS | - | - | P0 验证闭环后规划 |
| ARM64 | - | - | P0 验证闭环后规划 |

## 方式一：直接下载

镜像基地址：`https://download.noware.cn`（示例版本 `v1.143.1`）：

- Windows (x64)：`https://download.noware.cn/picket-code-v1.143.1-win32-x64.zip`
- Linux (x64)：`https://download.noware.cn/picket-code-v1.143.1-linux-x64.tar.gz`
- 校验和：`https://download.noware.cn/picket-code-v1.143.1-SHA256SUMS`

同一版本的同名资产也在 [GitHub Releases](https://github.com/dantesun/picket-code/releases) 上。

> 镜像保留最近 **3 个版本**，更早的版本不承诺长期可下载。
> 旧的无版本 URL（`/picket-code-win32-x64.zip`、`/SHA256SUMS`）已废弃，不提供兼容，请求返回 404。
> 文件名含版本，因此每个 URL 的内容永不改变：可以永久引用、长期缓存。

## 校验

```bash
curl -fSL https://download.noware.cn/picket-code-v1.143.1-SHA256SUMS -o SHA256SUMS
sha256sum -c --ignore-missing SHA256SUMS
```

Windows 上可用 `Get-FileHash .\picket-code-v1.143.1-win32-x64.zip -Algorithm SHA256`，再与该版本 `SHA256SUMS` 中同名的行比对。

## 方式二：一键下载安装命令

一条命令完成全部流程：**拉取最新下载脚本 → 解析最新版本 → 下载发行包（显式进度 / 失败重试 / 断点续传）→ SHA256 校验 → 解压**。不带版本参数时脚本自动解析最新的 release；传入标签（如 `v1.143.1`）则下载该版本。

### Windows（PowerShell 单行，自动走系统代理）

::: code-group

```powershell [PowerShell]
powershell -NoProfile -ExecutionPolicy Bypass -Command '$f=(Join-Path $PWD "download-verify.ps1");$wc=New-Object System.Net.WebClient;$wc.DownloadFile("https://raw.githubusercontent.com/dantesun/picket-code/main/build/download-verify.ps1",$f);& $f'
```

```cmd [CMD]
powershell -NoProfile -ExecutionPolicy Bypass -File .\download-verify.ps1 -Tag v1.143.1
```

:::

- 脚本从 GitHub raw 拉取（`main` 分支，永远是最新脚本）。
- 脚本从 GitHub Releases 解析并下载产物；国内网络可改用上面的镜像直链。
- WebClient 自动使用系统代理 + 当前 Windows 用户凭据，企业网络可直接下载。
- 若代理要求单独账号密码：`powershell -NoProfile -ExecutionPolicy Bypass -File .\download-verify.ps1 -ProxyCredential (Get-Credential)`
- 完成后程序位置：`<当前目录>\picket-code-win32-x64\code.exe`

### Linux（bash 单行）

```bash
curl -fSL "https://raw.githubusercontent.com/dantesun/picket-code/main/build/download-verify.sh" -o dv.sh && bash dv.sh
```

完成后程序位置：解压后目录下的 `bin/picket-code`。

### 脚本参数

| 参数 | 默认 | 说明 |
|---|---|---|
| `Tag` | 自动（GitHub 上最新的 release） | 版本标签，如 `v1.143.1`；不传则解析最新版本 |

## 校验机制

SHA256 不写死在脚本里（每次发版都会变）：脚本会解析该版本的 `picket-code-<tag>-SHA256SUMS` 并逐包比对。手工核对：

```bash
curl -fSL https://download.noware.cn/picket-code-v1.143.1-SHA256SUMS -o SHA256SUMS
sha256sum -c --ignore-missing SHA256SUMS
```

```powershell
Get-FileHash .\picket-code-v1.143.1-win32-x64.zip -Algorithm SHA256
```

`SHA256SUMS` 同时可从 GitHub Release 附件和镜像取得，两处文件名一致（`picket-code-<tag>-SHA256SUMS`）。

## 方式三：让 AI 助手自动安装

复制 [docs/ai-download-prompt.md](https://github.com/dantesun/picket-code/blob/main/docs/ai-download-prompt.md) 中的任务全文发给任意 AI 助手（豆包、Claude、Codex 等），AI 将自动完成下载、校验与安装，并报告发行包 SHA256、校验结果与安装路径。

## 常见问题

**Q：下载 GitHub 附件慢怎么办？**
优先用镜像地址 `https://download.noware.cn/picket-code-<tag>-<os>-<arch>.<ext>`；镜像保留最近 3 个版本，更早的版本不承诺长期可下载。

**Q：如何换版本？**
把地址里的版本号换掉，或给脚本传 `-Tag` / 第一个参数（如 `v1.143.1`）；校验值自动从该版本的 `picket-code-<tag>-SHA256SUMS` 读取，无需手工修改。镜像保留最近 3 个版本，更早的版本不承诺长期可下载。

**Q：为什么下载 URL 里带版本号？**
文件名带版本，一个 URL 背后的内容永不改变，因此可以永久引用并长期缓存；也正因如此，旧的固定 URL（`/picket-code-win32-x64.zip`、`/SHA256SUMS`）已废弃，不提供兼容。

**Q：怎么升级？**
重新下载新版本压缩包并解压覆盖即可。内置更新器已禁用：构建产物 `product.json` 不含 `updateUrl`，更新器启动时直接以「no update URL」退出，不再出网检查更新。

**Q：旧版本还能下载吗？**
不能。早期用 `-pN` 后缀区分的 `v1.143.1-p1` … `v1.143.1-p4` 已全部删除，策略改为「每个上游版本只保留一份发布」：重建时删旧 Release 并把同名标签移到新提交。现在 `v1.143.1` 始终指向最新一次构建。
