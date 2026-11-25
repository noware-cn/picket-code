# 许可

## 仓库许可

本仓库为 **MIT License**（[LICENSE](https://github.com/noware-cn/picket-code/blob/main/LICENSE)）。

## 发行二进制

发行的二进制由 `microsoft/vscode`（MIT）构建，与 [VSCodium](https://vscodium.com) 采用相同模式：以开源的 Code - OSS 源码为基底，做品牌、遥测与组件的裁剪后重新分发。

## 内置组件许可

- **iCode**：Apache-2.0，全开源，BYO 模型，可审计；
- **上游 VS Code（Code - OSS）**：MIT；
- 内置扩展与依赖遵循各自上游许可。

## WSL 支持与微软组件

[在 WSL 中使用](/guide/wsl) 不需要微软的 Remote-WSL 扩展或微软 CDN 上的 VS Code Server：客户端是本项目自研的内置扩展，服务端由上游 MIT 源码自行构建并随发行页分发载荷。官方扩展反而要求**卸载**——两个扩展抢同一个 authority，无法共存。

这条路是怎么选出来的（微软 *Visual Studio Code Remote Development Extensions* 条款限制了什么、为什么不侧载官方扩展也不重新打包它）见 [手工安装 Remote-WSL 与 VS Code Server](https://github.com/noware-cn/picket-code/blob/main/docs/manual-remote-wsl.md) 第九节——那份文档现在只作为合规分析保留，不再是使用步骤。

## 商标声明

> Picket Code 与微软无关。"Visual Studio Code" 是微软的商标。本项目仅使用开源的 Code - OSS 源码。
