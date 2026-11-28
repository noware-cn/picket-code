# Picket Code 一键下载安装命令

一条命令完成全部流程：**拉取最新下载脚本 → 解析最新版本 → 下载发行包（显式进度/失败重试/断点续传）→ SHA256 校验 → 解压**。

> 当前版本：**v1.143.1**（上游 VS Code `1.143.1`）。
> 脚本不带版本参数时自动解析 GitHub 上最新的 release；显式传入标签（如 `v1.143.1`）同样支持。
> 发行包发布在 GitHub Releases，并镜像到 `https://download.noware.cn`（保留最近 3 个版本，更早的版本不承诺长期可下载）。
> 脚本自带：显式进度（curl 进度条 / 百分比）、失败自动重试 5 次、断点续传（服务器支持 Range 时）。

---

## Windows（PowerShell 单行，自动走系统代理）

在目标目录（如 `D:\Downloads`）直接粘贴运行，脚本自动取最新版本：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -Command '$f=(Join-Path $PWD "download-verify.ps1");$wc=New-Object System.Net.WebClient;$wc.DownloadFile("https://raw.githubusercontent.com/dantesun/picket-code/main/build/download-verify.ps1",$f);& $f'
```

- 脚本从 GitHub raw 拉取（`main` 分支，永远是最新脚本）。
- WebClient 自动使用系统代理 + 当前 Windows 用户凭据，企业网络可直接下载（已解决 407 代理认证）。
- 若代理要求单独账号密码：`powershell -NoProfile -ExecutionPolicy Bypass -File .\download-verify.ps1 -ProxyCredential (Get-Credential)`
- 完成后程序位置：`<当前目录>\picket-code-win32-x64\code.exe`（压缩包文件名带版本，解压出的顶层目录不带）

**已下载过脚本、只想重新运行**（要指定版本就加 `-Tag`）：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\download-verify.ps1 -Tag v1.143.1
```

---

## Linux / macOS（bash 单行）

```bash
curl -fSL "https://raw.githubusercontent.com/dantesun/picket-code/main/build/download-verify.sh" -o dv.sh && bash dv.sh
```

完成后程序位置：解压后目录下的 `bin/picket-code`（顶层目录为 `picket-code-linux-x64/`）。

---

## 直接下载镜像直链（不跑脚本时）

文件名带版本号（示例 tag `v1.143.1`）：

```text
https://download.noware.cn/picket-code-v1.143.1-win32-x64.zip
https://download.noware.cn/picket-code-v1.143.1-linux-x64.tar.gz
https://download.noware.cn/picket-code-v1.143.1-SHA256SUMS
```

```bash
curl -fSL https://download.noware.cn/picket-code-v1.143.1-SHA256SUMS -o SHA256SUMS
sha256sum -c --ignore-missing SHA256SUMS
```

> 旧的无版本 URL（`/picket-code-win32-x64.zip`、`/SHA256SUMS`）已废弃，不提供兼容，请求返回 404。
> 镜像保留最近 3 个版本；更早的版本不承诺长期可下载。
> 文件名含版本，所以下载 URL 永久有效且可长期缓存。

---

## 脚本参数

| 参数 | 默认 | 说明 |
|------|------|------|
| Tag | 自动（GitHub 上最新的 release） | 版本标签，如 `v1.143.1`；不传则解析最新版本 |

示例：`bash dv.sh v1.143.1`

---

## 换版本 / 升级

1. 不传版本参数即取最新 release；要装指定版本就改命令/脚本中的版本号（`-Tag` / 第一个参数）
2. 校验值自动从该版本 Release 的 `picket-code-<tag>-SHA256SUMS` 读取，无需手工改
3. 内置更新器已禁用（构建产物 `product.json` 不含 `updateUrl`），升级方式就是下载新版本压缩包后解压覆盖

## 校验值

SHA256 不写死在本文件（每次发版都会变，写死只会过期）：
脚本会解析该版本的 `picket-code-<tag>-SHA256SUMS` 并自动比对；手工核对时同样以该文件
（或 Release 说明）为准。
