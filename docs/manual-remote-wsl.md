# 手工安装 Remote-WSL 与 VS Code Server

目标是**不依赖任何在线解析**把 `ms-vscode-remote.remote-wsl` 跑起来：`.vsix` 离线安装，服务端产物手工预置。适用于 Picket Code 1.143.1（上游 commit `e646868227c`）＋ Remote-WSL 1.104.7。

两条前置事实决定了流程形状：

1. 发行版上报的版本号必须是**裸 `X.Y.Z`**，否则 `.vsix` 装不上（见第一节）。
2. 1.104.7 已经不用 `scripts/wslDownload.sh` 那套脚本了，主流程是「发行版里放一个 `code-cli`，由它起 server」。扩展的两个探针**只看目录是否存在**，所以把产物预先放好，它就不下载。

## 一、前置：版本号必须是裸 `X.Y.Z`

上游 `src/vs/platform/extensions/common/extensionValidator.ts` 用这个正则解析**产品版本**：

```js
const VERSION_REGEXP = /^(\^|>=)?((\d+)|x)\.((\d+)|x)\.((\d+)|x)(\-.*)?$/;
```

它只允许 `-prerelease`，**没有 `+build` 分支**。实测三种写法的后果：

| 产品版本 | `parseVersion()` | 后果 |
|---|---|---|
| `1.143.1` | 成功 | 正常 |
| `1.143.1+p4` | 返回 null | `isValidVersion()` 恒 false → **所有带 `main` 的扩展**都报 `not compatible with Code 1.143.1+p4` |
| `1.143.1-rc.4` | 成功 | VS Code 侧能过，但它在 semver 里是 prerelease，画廊侧 `semver.satisfies()` 匹配 `^1.x` 会失败 |

所以 `build/build.sh` 已去掉版本戳（见该文件第 77–85 行的注释），打包产物保持上游原值；发布流水线里由 `verify-release.yml` 的 "Assert the packaged product.json shapes" 兜底，版本不是裸 `X.Y.Z` 就直接失败。

**picket 版本号只出现在两处**：git tag（如 `v1.143.1-picket.1-rc.4`）与产物文件名。`product.json` 的 `version` 永远是上游的 `1.143.1`，`--version` 的期望值也一样。

构建后自检：

```powershell
& "D:\Downloads\picket-code-win32-x64\Picket Code.exe" --version
# 期望：1.143.1（带 +p 就说明是旧构建，装不了任何扩展）
```

影响面不止安装：`extensionsScannerService` 扫描**已安装**扩展时也走同一个校验，所以带 `+pN` 的构建里，已有扩展同样会被判为不兼容。

## 二、离线安装 Remote-WSL

`extensionKind` 是 `ui`，只能在 Windows 侧装。

```powershell
# CLI 方式
& "D:\Downloads\picket-code-win32-x64\Picket Code.exe" `
  --install-extension "D:\Downloads\ms-vscode-remote.remote-wsl-1.104.7.vsix"

# 或 GUI：扩展面板 → ··· → 从 VSIX 安装…

# 确认
& "D:\Downloads\picket-code-win32-x64\Picket Code.exe" --list-extensions --show-versions |
  Select-String remote-wsl
```

## 三、为什么服务端必须手工备

扩展里的下载器是 `EP()`：

```js
function EP(t, e, r, n, i, o = AU) {
  let { updateUrl: a, quality: u, commit: c } = r;
  if (!c || !u || !a) return { start() {}, stop() {}, async getOrDownloadBuild() { return "" } };
  return OU(c, a, u, t, e, n, i, o);
}
```

三个输入全部来自客户端 `product.json`。发行版当前是 `commit` 有值、`quality: "stable"`、但 **`updateUrl: null`**，于是直接返回空实现的下载器，拿不到 server 就起不来。这与「微软侧没有我们的 commit」无关——`commit` 是上游真实 commit，产物在微软 CDN 上都在（见第六节）。

## 四、用脚本

脚本：`build/manual-wsl-server.sh`。**在目标发行版内部执行**（不是 Windows 侧）；多发行版要各跑一遍，因为它写 `$HOME`。

```bash
# 在线：从 Windows 安装里读 commit / serverDataFolderName / quality
bash build/manual-wsl-server.sh \
  --product-json /mnt/d/Downloads/picket-code-win32-x64/resources/app/product.json

# 离线：两段归档已经在本地
bash build/manual-wsl-server.sh --commit e646868227c3e3a9e3f24277c8c7220be42c0be7 \
  --cli-tar /mnt/d/vscode_cli_linux_x64_cli.tar.gz \
  --server-tar /mnt/d/vscode-server-linux-x64.tar.gz

# 只看看会发生什么
bash build/manual-wsl-server.sh --product-json <...> --dry-run
```

| 参数 | 说明 |
|---|---|
| `--commit <sha>` | 上游 commit，40 位小写十六进制 |
| `--product-json <路径>` | 从 `resources/app/product.json` 读 commit / `serverDataFolderName` / quality |
| `--folder <名>` | 发行版内数据目录，默认 `.picket-code-server` |
| `--arch <平台>` | `linux-x64`（默认按 `uname` 推断）/ `linux-arm64` / `linux-alpine` / `alpine-arm64` |
| `--quality` | `stable`（默认）/ `insider` |
| `--cli-tar` / `--server-tar` | 离线归档，给了就不联网 |
| `--force` / `--dry-run` | 重装 / 只打印 |

脚本行为：下载时用更新服务器 302 响应头里的 `x-sha256` 做校验（不写死哈希）→ 解包 → CLI 的单个 `code` 重命名为 `code-cli` 并 `chmod +x` → server 用 `--strip-components 1` 解开 → 打印最终路径。已存在的部分默认跳过。

## 五、等价的手工命令

不依赖脚本时（在发行版里执行）：

```bash
COMMIT=e646868227c3e3a9e3f24277c8c7220be42c0be7
FOLDER=.picket-code-server
ARCH=linux-x64
BASE="https://update.code.visualstudio.com/commit:$COMMIT"

# CLI：归档里只有一个可执行文件 code，扩展按 code-cli 命名
mkdir -p ~/$FOLDER/bin-cli/$COMMIT
curl -fsSL -o /tmp/cli.tar.gz "$BASE/cli-$ARCH/stable"
tar -xzf /tmp/cli.tar.gz -C ~/$FOLDER/bin-cli/$COMMIT
mv ~/$FOLDER/bin-cli/$COMMIT/code ~/$FOLDER/bin-cli/$COMMIT/code-cli
chmod +x ~/$FOLDER/bin-cli/$COMMIT/code-cli

# Server：归档自带顶层目录，按扩展的 --strip-components 1 解开
mkdir -p ~/$FOLDER/bin/$COMMIT
curl -fsSL -o /tmp/server.tar.gz "$BASE/server-$ARCH/stable"
tar -xzf /tmp/server.tar.gz -C ~/$FOLDER/bin/$COMMIT --strip-components 1
```

这两个路径不是猜的，来自扩展自身的探针：

```js
// extension.js: _probeInstallInWSL
let c = `$HOME/${productConfiguration.serverDataFolderName || ".vscode-remote"}/bin-cli`;
let a = `if [ -d "${c}/${commit}" ]; then printf 'install-found '; fi; ...`
// 命中后直接 spawnCli: wsl.exe -d <distro> <cliExe>，不下载
```

```js
// wslDaemon.js：server 侧
`if [ -d ~/${folder}/bin/${commit} ]; then printf 'install-found '; fi; ...`
```

CLI 可执行文件名也是从代码里取的（`eE = "code-cli"`），扩展自己下载时是用 `tee` 把归档流写进这个名字，所以手工要改名。

## 六、产物清单（commit `e646868227c`）

| 归档 | 平台名 | 大小 | sha256 |
|---|---|---|---|
| CLI | `cli-linux-x64` / `cli-linux-arm64` / `cli-alpine-arm64` | 12,921,992 B | `22da21dfa7051bf3a0f048cd7e875c4fe582ddd3e8451cd17a725d199029a9fe` |
| Server | `server-linux-x64` / `server-linux-arm64` / `server-linux-alpine` / `server-alpine-arm64` | 222,356,453 B | `5cc911f00c7fd762afa1f978485d9604ceac5984f2b5e6607d981092f894326a` |

URL 形状：`https://update.code.visualstudio.com/commit:<commit>/<平台名>/<quality>`。注意 **Alpine x64 没有 CLI 产物**（`cli-linux-alpine` 返回 404），只有 server 侧有 `server-linux-alpine`。

## 七、验证

```bash
ls -l ~/.picket-code-server/bin-cli/<commit>/code-cli     # 必须可执行
~/.picket-code-server/bin-cli/<commit>/code-cli --version # code 1.143.1 (commit <commit>)
ls ~/.picket-code-server/bin/<commit>/bin                 # server 的入口目录
```

Windows 侧打开/重载 WSL 窗口，WSL 输出面板（`remote.WSL.logLevel` 设 `trace` 更详细）应出现：

- `install-found` / `Server install found in WSL`
- **不应**出现 `Downloading VS Code Server`

## 八、已知限制

- **两套布局并存**：扩展上层走 `bin-cli/<commit>`（`spawnCli`），daemon 侧还认 `bin/<commit>`。两者都放上最稳；只放 `bin-cli` 时如果日志显示还在下载，说明走到了 daemon 路径。
- **`serverApplicationName` 不一致**：发行版是 `picket-code-server`，而微软 server 归档的 `bin/` 里只有 `code-server`、`helpers`、`remote-cli`。`scripts/wslServer.sh` 最后一行是 `"$VSCODE_REMOTE_BIN/$COMMIT/bin/$SERVER_APPNAME" "$@"`，第三个参数正是 product.json 的 `serverApplicationName`，不补会以 `not found` 退出。补个软链接即可：
  ```bash
  cd ~/.picket-code-server/bin/<commit>/bin && ln -s code-server picket-code-server
  ./picket-code-server --version        # 应打印 1.143.1
  ```
- **必须改归档里的 product.json，否则与 VS Code 共用数据与扩展**：数据目录由 server 自己的 product.json 决定（`serverDataFolderName` → `~/<name>/{data,extensions}`），`wslServer.sh` 的第 4 个参数只用于 `bin/` 与 `server-env-setup`，**不会**传给 server；`code-cli` 也不传（它只在自己收到 `--server-data-dir` 时才转发）。归档里这些字段仍是微软的 `.vscode-server`/`code-server`，实测会写进 `~/.vscode-server/data/logs/<时间戳>/` 并加载那里的扩展。`build/manual-wsl-server.sh` 会用载荷自带的 `node` 改写 `product.json`：
  ```bash
  NODE=~/.picket-code-server/bin/<commit>/node
  PRODUCT=~/.picket-code-server/bin/<commit>/product.json
  "$NODE" -e '
    const fs = require("fs"); const [f, ...pairs] = process.argv.slice(1);
    const p = JSON.parse(fs.readFileSync(f, "utf8"));
    for (const s of pairs) { const i = s.indexOf("="); p[s.slice(0,i)] = JSON.parse(s.slice(i+1)); }
    fs.writeFileSync(f, JSON.stringify(p, null, 2) + "\n");
  ' "$PRODUCT" \
    'nameShort="Picket Code"' 'nameLong="Picket Code"' 'applicationName="picket-code"' \
    'dataFolderName=".picket-code"' 'serverDataFolderName=".picket-code-server"' \
    'serverApplicationName="picket-code-server"' \
    'extensionsGallery={"serviceUrl":"https://open-vsx.org/vscode/gallery","itemUrl":"https://open-vsx.org/vscode/item"}' \
    'updateUrl=null'
  ```
  改完在不同 HOME 下起一次，确认生成的是 `~/.picket-code-server/{data,extensions}`。副作用是**首次连接扩展列表为空**（完全隔离），要沿用 VS Code 那批扩展就自己复制过去或重装。
- **不要把 `updateUrl` 随便指向微软**：它同时是自更新入口，指向 `https://update.code.visualstudio.com` 会让应用去拉正版 VS Code 覆盖自己。真要设就同时配 `"update.mode": "none"`。
- **服务端必须关掉 vsda 才能连上**：握手最后一步（`ConnectionTypeRequest`）要求客户端提交 vsda 签名，而 `server-main.js` 里是 `let l = this._vsdaMod ? new this._vsdaMod.validator : null;` … `if (!l) E = !0;`——**只有服务端没有 vsda 校验器时才放行未签名客户端**。本发行版客户端用桩 vsda（见 9.3），签不出真签名，所以必须把服务端载荷里的 `node_modules/vsda` 移开（`manual-wsl-server.sh` 已自动重命名为 `vsda.disabled`）。否则表现为：WebSocket 建连成功、走到 `5/6. sending ConnectionTypeRequest` 后报 `Connection error: Unauthorized client refused`。
- **许可证**：Remote-WSL 与微软 server 都受微软自己的许可约束，能不能做取决于场景——**个人自用可以但属违约、随发行版分发明确禁止**，详见第九节。

## 九、许可边界与个人使用的正确做法

> 本页流程能不能做，取决于**谁做、在哪台机器上做、做完给不给别人**。条款原文来自 VSIX 里的 `LICENSE.txt`（微软 *Visual Studio Code Remote Development Extensions* 许可）和 server 包里的 `LICENSE`（同一份许可的 pre-release 版本）。

### 9.1 结论速览

| 场景 | 合规性 | 依据 |
|---|---|---|
| 自己开发机上装微软官方 VS Code，从画廊装 Remote-WSL | ✅ 条款允许 | §1.a |
| 自己开发机上给 Picket Code 侧载 Remote-WSL 自用 | ⚠️ 超出授权范围（违约），无分发，实务风险低 | §1.a「with each validly licensed copy of **Microsoft Visual Studio Code**」 |
| 在上一条基础上手工预置微软 server 二进制 | ⚠️ 同上，server 是同一套条款的 pre-release 版 | server `LICENSE` §1.a、§7 |
| 组织内分发给同事 | ⚠️ 允许在"你的开发设备"上用，但每人须持 VS Code 许可，且仍限微软 VS Code | §1.a 第 2 句 |
| 打进发行版 / 提供镜像下载 / 做一键安装器 | ❌ 明确禁止 | §6「host, share, publish, rent or lease the software … or provide the software … for others to use」 |
| 内置 `vsda` 桩或默认 `VSCODE_DEV=1` 绕过"仅微软版"检查 | ❌ 明确禁止 | §6「work around any technical limitations in the software」 |

### 9.2 为什么"我装了 VS Code"也不构成授权

§1.a 的措辞是把**使用场景**绑在微软 VS Code 上——"与每一份合法授权的 *Microsoft Visual Studio Code* 副本一起使用"，而不是"你个人拥有许可"这一事实。Picket Code 是独立发行版（商标、`product.json`、`commit` 都不同），扩展被它加载的那一刻就已经在授权范围之外。这也正是扩展用 `vsda` 在激活时做技术判定的原因：技术限制本身就是条款 §6 要求用户遵守的对象。

### 9.3 个人自用的正确做法

1. **只在自己的开发机上做**，不要把它变成发行版能力，也不要替别人预置。
2. **产物不落地到任何公共位置**：`ms-vscode-remote.remote-wsl-*.vsix`、`server-*.tar.gz`、`cli-*.tar.gz` 都不要进仓库、Release、R2 或网盘。仓库里只放脚本，不放二进制。
3. **清楚两条绕过手段的实际状态**（都属 §6 的 "work around technical limitations"，仅限本机，不进发行版）：
   - `VSCODE_DEV=1`：**在本项目的压缩构建上不可用**。`mainImpl.js` 里 NLS 消息表的装载是 `if (!(process.env.VSCODE_DEV || !n)) { globalThis._VSCODE_NLS_MESSAGES = … }`，一旦设了该变量就不再加载消息表，而 `--min` 构建的 `localize()` 已被编译成数字索引，启动时立刻抛 `!!! NLS MISSING: 138 !!!`。dev 模式要求非压缩构建（松散的 `out/vs/**` 模块），与发行包不兼容。
   - `vsda` 桩：在 `resources/app/node_modules/vsda/` 放一个导出 `{ signer, validator }` 的包，即可让探测通过。导出值故意不是构造函数，core 的 `sign()` / `validate()` 会落进既有的 `try{…}catch{}`，退化为"不签名"——与当前缺少 vsda 时的行为一致。它改的是应用目录，换包即失效，不会跟着发行版走。
4. **用完可整体清掉**：

   ```bash
   rm -rf ~/.picket-code-server            # 发行版内的 CLI + server
   ```

   ```powershell
   & "<Picket Code>\Picket Code.exe" --uninstall-extension ms-vscode-remote.remote-wsl
   ```

如果目的只是"在 Windows 上编辑 WSL 里的工程"，其实**不需要** Remote-WSL：直接打开 `\\wsl.localhost\Ubuntu\home\<user>\...`，或在 WSL 内启动 `picket-code .` 走 WSLg 显示；代价是文件监听、端口转发要自己处理（分析文档第七节有两条相关结论）。

### 9.4 想产品化：走完整 MIT 链路

| 层 | 本页做法（不可分发） | 合规做法 |
|---|---|---|
| 客户端扩展 | 侧载微软 Remote-WSL | MIT 第三方实现（如 `jeanp413/open-remote-wsl`）或自写 |
| 服务端 | 从微软 CDN 取 `server-linux-x64` | 用上游 MIT 源码自行构建 reh server（`build/gulpfile.reh.ts`） |
| 分发 | 指向 `update.code.visualstudio.com` | 自建（R2）**只托管自己构建的产物** |
| 命名 | "Remote - WSL" / "VS Code Server" | 自有命名，避开微软商标 |

只走第一步（换客户端）不够：服务端仍是微软的受许可二进制，仍受 §7 的 host/share/publish 限制。

### 9.5 免责

以上是对条款字面的解读，不构成法律意见。个人使用风险自担；商业分发前请让法务过一遍。

## 十、参考

- 实现分析：`docs/remote-wsl-extension-analysis.md`
- 脚本：`build/manual-wsl-server.sh`
- 版本戳问题的源头：`build/build.sh`（已移除标记步骤，注释里记了原因）
- 关键代码位置（VSIX 内）：`dist/node/extension.js` 的 `_probeInstallInWSL` / `_installCliInWSL` / `_connectToCliInWsl` / `EP` / `LU` / `T`，`dist/node/wslDaemon.js` 的探针与 `tar -xz --strip-components 1` 解包
