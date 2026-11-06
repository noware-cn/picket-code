# Picket Code

> 面向 AI 编码 agent 的加固版 VS Code 发行版——受控扩展、私有模型网关、按项目沙箱，开箱即用。

Picket Code 是 [Code - OSS](https://github.com/microsoft/vscode) 的发行版（fork），以干净、无遥测的二进制分发。它面向在可信、按项目隔离的环境中运行 AI 编码 agent 的团队，内置 [iCode](https://github.com/openJiuwen-ai/iCode) 作为唯一编码 agent——典型场景是银行 / 信创内网。整体设计思路见 [docs/design.md](docs/design.md)。

## 特性

- **干净发行**——MIT 许可的 Code-OSS 构建，移除微软定制（无遥测、无微软品牌、无微软市场）。
- **默认离线**——发行版不包含任何需要联网的扩展：无 Copilot、无 GitHub 云集成、无认证/隧道/浏览器扩展；核心编辑体验完全离线。
- **受控扩展**——默认使用 Open VSX，可指向自建市场；可在其上叠加白名单策略。
- **私有模型网关**——设计上配合自托管网关（如 LiteLLM），让 agent 只访问你控制的模型端点。
- **按项目沙箱**——devcontainer 模板与出站防火墙配置，把 agent 的终端、构建与文件操作约束在项目内。
- **iCode 一等公民支持**——内置 iCode 作为唯一编码 agent（BYO 模型、无遥测、OTel 就绪、支持 Workflows 与 Skills）；发行版不含 Copilot/Claude/Codex 等国外 agent 实现。

## 平台支持

MVP 范围（当前发行）：**Linux (x64)** 与 **Windows (x64)**——`tar.gz` 与 `zip` 压缩包。macOS 与 ARM64 在 P0 验证闭环后规划；见 `docs/roadmap.md`。

Windows 上还可在 WSL2 发行版里做远程开发：需自行侧载微软 Remote-WSL 并手工预置服务端载荷，**仅限个人自用**，步骤与许可边界见 [docs/manual-remote-wsl.md](docs/manual-remote-wsl.md)。

## 参与开发

- 分支模型、保护规则，以及"哪些事 AI 可以自己定、哪些必须人签字"：[docs/branching.md](docs/branching.md)
- 六层测试矩阵、GitHub Actions 能覆盖到哪一层、发布测试报告与人工验收清单：[docs/testing.md](docs/testing.md)
- 每次发布的人工验收步骤：[docs/release-checklist.md](docs/release-checklist.md)
- 发行版与上游的差异（补丁清单）：[build/patches/README.md](build/patches/README.md)

## 快速开始

当前发行版 **v1.143.1**（上游 VS Code `1.143.1`）。发行包文件名带版本号，推荐从镜像站下载（国内访问更快）：

| 平台 | 下载地址 |
|---|---|
| Windows (x64) | `https://download.noware.cn/picket-code-v1.143.1-win32-x64.zip` |
| Linux (x64) | `https://download.noware.cn/picket-code-v1.143.1-linux-x64.tar.gz` |
| 校验和 | `https://download.noware.cn/picket-code-v1.143.1-SHA256SUMS` |

```bash
curl -fSL https://download.noware.cn/picket-code-v1.143.1-SHA256SUMS -o SHA256SUMS
sha256sum -c --ignore-missing SHA256SUMS
```

解压后运行 `picket-code`（Linux）或 `Picket Code.exe`（Windows）；归档内的顶层目录不含版本号，仍是 `picket-code-win32-x64/`（Windows）与 `picket-code-linux-x64/`（Linux）。

- 镜像保留最近 **3 个版本**，更早的版本不承诺长期可下载；
- 旧的无版本 URL（`/picket-code-win32-x64.zip`、`/SHA256SUMS`）已废弃，不提供兼容，访问返回 404；
- 文件名含版本，因此下载 URL 永久有效且可长期缓存。

首次启动 iCode 时按 **F4** 添加模型配置。内置更新器已禁用（构建产物 `product.json` 不含 `updateUrl`），升级方式就是下载新版本压缩包。

## 从源码构建

构建分两个阶段（对齐 VSCodium 流水线）：先编译、后打包，两阶段互不串行重跑。

```bash
# 1. 编译阶段：clone 钉版 → 裁剪扩展 → 打补丁 → npm ci → 上游 min 构建
bash build/build.sh <vscode-version> <picket-code-version> <linux|win32> [x64|arm64]

# 2. 打包阶段：解包 → 重命名 → 归档
bash build/linux/package.sh <linux> [x64|arm64]     # Linux
bash build/win32/package.sh <win32> [x64|arm64]     # Windows
```

示例：

```bash
bash build/build.sh 1.142.0 0.1.0 linux x64
bash build/linux/package.sh linux x64
```

编译阶段会克隆 `microsoft/vscode@<vscode-version>`、按 `build/extensions-remove.list` 裁剪内置扩展、应用补丁（`build/product.json` 改名/关遥测/Open VSX 市场、copilot 移除等），构建并产出 `vscode.tar.gz` 供打包阶段消费。

## 发行流水线

推送 `v*` 标签（或手动 `workflow_dispatch`）触发 GitHub Actions 发行工作流（`.github/workflows/release.yml`），四段流水线：

1. **versions**：解析上游 VS Code tag 与 Node 版本。
2. **compile**（linux / win32 矩阵）：在钉版 tag 处克隆 `microsoft/vscode`，裁剪内置扩展（默认离线），应用补丁，`npm ci` 后执行上游 min 构建，产出 `vscode.tar.gz`。
3. **package**：按平台解包、重命名为 `picket-code-*`、归档并生成 SHA256SUMS。
4. **release**：将产物发布到 GitHub Release。

计划中的打包升级：AppImage 与 deb、dmg、NSIS 安装器、代码签名。见 `docs/roadmap.md`。

## 许可

本仓库为 MIT 许可。发行的二进制由 `microsoft/vscode`（MIT）构建，与 [VSCodium](https://vscodium.com) 采用相同模式。

> Picket Code 与微软无关。“Visual Studio Code”是微软的商标。本项目仅使用开源的 Code - OSS 源码。