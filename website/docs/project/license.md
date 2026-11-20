# 许可

## 仓库许可

本仓库为 **MIT License**（[LICENSE](https://github.com/noware-cn/picket-code/blob/main/LICENSE)）。

## 发行二进制

发行的二进制由 `microsoft/vscode`（MIT）构建，与 [VSCodium](https://vscodium.com) 采用相同模式：以开源的 Code - OSS 源码为基底，做品牌、遥测与组件的裁剪后重新分发。

## 内置组件许可

- **iCode**：Apache-2.0，全开源，BYO 模型，可审计；
- **上游 VS Code（Code - OSS）**：MIT；
- 内置扩展与依赖遵循各自上游许可。

## 不随发行版分发的微软组件

[在 WSL 中使用](/guide/wsl) 需要微软的 **Remote-WSL 扩展**与 **VS Code Server**。这两样受微软 *Visual Studio Code Remote Development Extensions* 许可约束，本发行版**不内置、不镜像、不提供安装器**：

- 自行获取、自行安装，且仅限**个人自用**——条款把使用场景绑在微软 VS Code 上，本发行版加载该扩展即已超出授权范围；
- 打进发行版、对外镜像、做成一键安装器均属明确禁止；
- 想做成产品能力，客户端需换 MIT 实现（如 `open-remote-wsl`），服务端需用上游 MIT 源码自建 reh server，命名避开微软商标。

条款原文与逐条判断见 [手工安装 Remote-WSL 与 VS Code Server](https://github.com/noware-cn/picket-code/blob/main/docs/manual-remote-wsl.md) 第九节。

## 商标声明

> Picket Code 与微软无关。"Visual Studio Code" 是微软的商标。本项目仅使用开源的 Code - OSS 源码。
