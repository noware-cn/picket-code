# 卸载官方 Remote-WSL 扩展（保留全部数据）

Picket Code 的 WSL 支持与微软官方扩展 `ms-vscode-remote.remote-wsl` 是替代关系，不能共存：

- 两者都注册 `wsl+` 这个远程授权前缀，谁先解析到就归谁，另一个只会抛错；
- 两者都用 `~/.vscode-server` 这一份服务端目录，却各自管理进程与端口；
- 官方扩展的服务端二进制**不含** Picket Code 的补丁，连上去的窗口行为与本产品不一致。

所以只要官方扩展**已安装**（启用、禁用、是否激活都算），Picket Code 的 WSL 功能就是关闭的：
`WSL 目标` 视图只显示一条"已禁用"提示，所有 WSL 命令从命令面板与远程指示器菜单里隐藏。

**卸载官方扩展不会删除任何数据。** 下一节说明哪些东西会被保留。

---

## 一、三种卸载方式

### 方式 1：从"已禁用"提示直接卸载（推荐）

1. 打开远程资源管理器里的 `WSL 目标` 视图；
2. 点那条 **已禁用：检测到官方 Remote-WSL 扩展**；
3. 确认后扩展被卸载，提示按钮里点 **重新加载窗口**，WSL 功能立即恢复。

远程指示器（左下角）菜单里也有 **如何卸载官方 Remote-WSL 扩展**，效果相同。

### 方式 2：扩展视图手动卸载

1. `Ctrl+Shift+X` 打开扩展视图；
2. 搜索 `Remote - WSL`，认准 ID `ms-vscode-remote.remote-wsl`；
3. 点齿轮 → **卸载**；
4. `Ctrl+Shift+P` → **Developer: Reload Window**。

### 方式 3：命令行

Windows（Picket Code 安装目录下的命令行）：

```bat
picket-code --uninstall-extension ms-vscode-remote.remote-wsl
```

WSL 里（已装过 `picket-code` 命令行 shim 的发行版）：

```bash
picket-code --uninstall-extension ms-vscode-remote.remote-wsl
```

命令行卸载后同样需要重新加载窗口。

---

## 二、不会被删除的东西

卸载只动"这个扩展本身"，下列内容原样保留：

| 位置 | 内容 |
| --- | --- |
| `~/.vscode-server/bin/<commit>/` | 服务器程序（官方装的那份仍在，只是不再被使用） |
| `~/.vscode-server/data/` | `User` 设置、`Machine` 设置、`globalStorage`、`History`、`logs` |
| `~/.vscode-server/extensions/` | 在 WSL 里装的扩展与 `extensions.json` |
| `~/.vscode-server/server-env-setup` | 登录 shell 环境钩子 |
| `%APPDATA%\Picket Code\User\` | Windows 侧的用户设置、键绑定、代码片段 |
| `%USERPROFILE%\vscode-remote-wsl\` | 官方扩展的下载缓存 |
| Windows 侧已保存的远程连接历史 | 包括 `wsl+<发行版>` 形式的旧地址 |

Picket Code 接管时会**直接使用**上面这些数据：`wsl+<发行版>` 的老工作区地址会被自动规范化成本产品的地址，
`~/.vscode-server` 里已有的设置与扩展照旧生效。唯一的例外是远程扩展：官方服务器装的扩展若要求更高的
VS Code 版本（`engines.vscode` 比本产品高），它在本产品里不会激活 —— `Picket: WSL 诊断` 报告的
`Extensions` 段会逐条标出 `compatible=no`，按提示从本产品重装即可。

---

## 三、怎么确认已经卸载

任选一种：

- `picket-code --list-extensions | findstr remote-wsl`（WSL 里用 `grep`）不再输出该 ID；
- 扩展视图搜索 `Remote - WSL` 显示的是"安装"而不是"卸载"；
- 重新加载窗口后 `WSL 目标` 视图列出本机发行版（不再出现"已禁用"提示）。

如果卸载后仍显示"已禁用"，说明还有一份**内置**副本（随安装包分发）。本产品的正式安装包不包含它；
遇到这种情况请改用不带该扩展的安装包，而不是继续尝试卸载 —— 内置副本会在下次启动时被还原。

---

## 四、不卸载会怎样

官方扩展存在期间：

- `WSL 目标` 视图只有一条禁用提示，不列出任何发行版；
- 所有 `Picket: …` WSL 命令从命令面板与远程指示器菜单中隐藏（`WSL 诊断` 与"卸载说明"仍可用）；
- 用 `picket-wsl+<发行版>` 或 `wsl+<发行版>` 打开文件夹会失败：没有任何扩展认领这两个地址，
  窗口会提示找不到可解析该地址的远程扩展；先卸载官方扩展再打开即可；
- 已连接的旧窗口不会自动断开，但重新加载后同样会被拦下。

这是有意的硬性互斥：两个扩展抢同一份数据目录，允许"同时装着、只用一个"会让用户在两次重载之间
得到随机结果（端口冲突、服务端版本错配、文件监听重复），排查成本远高于一次卸载。

---

## 五、想装回去

官方扩展可以随时重装（`picket-code --install-extension ms-vscode-remote.remote-wsl`）。
装回后 Picket Code 的 WSL 功能会立即关闭，数据不变 —— 两者可以这样来回切换，只是不能同时工作。
