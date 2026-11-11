# 快速开始

> 面向 AI 编码 agent 的加固版 VS Code 发行版——受控扩展、私有模型网关、按项目沙箱，开箱即用。

Picket Code 是 [Code - OSS](https://github.com/microsoft/vscode) 的发行版（fork），以干净、无遥测的二进制分发。它面向在可信、按项目隔离的环境中运行 AI 编码 agent 的团队，以 [iCode](https://github.com/openJiuwen-ai/iCode) 作为唯一 agent 方向——典型场景是银行 / 信创内网。

> 当前发行版（v1.143.1）**没有可用的 agent 后端**：AgentHost 已在不装 Copilot 包的情况下启动并说协议，但 iCode 适配层（P3–P4）尚未实现。

## 1. 下载

从镜像站 `https://download.noware.cn` 下载对应平台的压缩包（文件名带版本号，示例版本 `v1.143.1`；同名资产也在 [GitHub Releases](https://github.com/dantesun/picket-code/releases) 上），或使用[一键下载安装命令](/guide/download)（自动解析最新版本并校验 SHA256）。

| 平台 | 压缩包 | 启动方式 |
|---|---|---|
| Linux (x64) | `picket-code-v1.143.1-linux-x64.tar.gz` | `./picket-code` |
| Windows (x64) | `picket-code-v1.143.1-win32-x64.zip` | `code.exe` |

> 镜像保留最近 3 个版本，更早的版本不承诺长期可下载；旧的无版本 URL（`/picket-code-win32-x64.zip`、`/SHA256SUMS`）已废弃，不提供兼容。解压出的顶层目录不带版本号：`picket-code-win32-x64/`、`picket-code-linux-x64/`。

## 2. 解压

**Linux**

```bash
tar -xzf picket-code-v1.143.1-linux-x64.tar.gz
cd picket-code-linux-x64
```

**Windows**

解压 zip 到目标目录（如 `D:\picket-code`）。

## 3. 启动

```bash
# Linux
./picket-code

# Windows
code.exe
```

无需安装、无需联网注册，核心编辑体验完全离线。

升级方式：下载新版本压缩包解压覆盖即可。内置更新器已禁用（构建产物 `product.json` 不含 `updateUrl`，更新器以「no update URL」退出，不再出网检查更新）。

## 4. 配置模型（待后端接入）

模型一律 BYO（自带），Picket Code 不内置任何模型服务：

1. 规划中的入口：iCode 的模型配置面板（`F4`），可添加模型端点；
2. 推荐指向自托管网关（如 LiteLLM），让 agent 只访问你控制的端点；
3. **当前发行版尚无 agent 后端**（AgentHost 已就绪但无 `IAgent` 实现），模型配置要等 iCode 适配层（P3–P4）落地后才会真正生效。

## 5. 可选：启用按项目沙箱

生产 / 内网环境建议配合沙箱使用：

- **devcontainer 模板**：把 agent 的终端、构建与文件操作约束在项目内；
- **出站防火墙配置**：默认拒绝出站，白名单放行网关端点；
- **AgentHost 路径授权**：workbench 侧 `agentHostSandboxPathGrant` 等机制随核心保留。

## 下一步

- [下载与安装](/guide/download)——一键脚本与 AI 提示词安装
- [扩展策略](/guide/extensions)——内置最小集与受控市场
- [在 WSL 中使用](/guide/wsl)——在 Windows 上打开 WSL 发行版里的工程
- [从源码构建](/guide/build-from-source)——两阶段构建管线
- [设计总览](/architecture/overview)——整体设计思路
