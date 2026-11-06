# WSL 服务端版本策略（`picket-code-server`）

WSL 窗口连的服务器是 `picket-code-server`，它在独立仓库
`noware-cn/picket-code-server` 里单独构建、单独发版。**它的版本号与客户端版本号没有关系**：
客户端要求的只有两件事，其余随便改。

## 一、客户端要求的两个条件

| 条件 | 谁写在哪儿 | 说明 |
| --- | --- | --- |
| **commit 相同** | `catalog.json` 的 `components[].commit` 对 `product.json` 的 `commit` | 载荷必须由客户端这一版的 vscode 树构建。握手时比对的就是它，对不上连不进去 |
| **版本不低于下限** | `catalog.json` 的 `components[].version` ≥ `product.json` 的 `picketServerMinVersion` | 同一个 commit 上的服务端可以自己修 bug、自己发版；客户端只在"低于我要求的下限"时拒绝 |

选中逻辑（`vscode/extensions/picket-remote-wsl/src/version.js:75`）：先按 commit 过滤，再取
最高版本，最后和下限比较；一个都取不到就报错，不会静默降级。

所以：

- 改服务器版本号 **不需要** 改客户端版本号，也不需要客户端重新发版；
- 同 commit 上发了新服务端，老客户端只要下限满足就会用（`catalog.json` 随包，改它才需要重发客户端）；
- 客户端升到新 commit 后，必须有这个新 commit 的载荷——**这不是版本号问题，是构建来源问题**。

## 二、版本号与资产命名

- 版本：裸 semver，例如 `1.4.0`、`1.5.0-rc.1`。**不要**带 `v` 前缀、不要嵌日期：客户端用
  `parseVersion()` 解析，`v1.143.1-picket.1-rc.4` 这种旧形式会被判为不可解析。
- Release tag：`server-v<版本>`，例如 `server-v1.4.0`。
- 资产：
  - `picket-code-server-<版本>-linux-x64.tar.gz` —— 载荷本体；
  - `picket-code-server-<版本>-SHA256SUMS` —— 校验和。
- 载荷内置的 `product.json` 必须带 `commit`（与客户端相同）与 `version`：客户端装配时
  `build/wsl/fetch-payload.sh` 会从 tar 里读出它，`build/wsl/check.mjs` 再校验 catalog 与
  产品 `product.json` 一致（`minVersion` 相等、`commit` 相等、版本 ≥ 下限）。

## 三、客户端构建怎么用

`build/build.sh` / `release.yml` 读两个仓库变量：

| 变量 | 必填 | 含义 |
| --- | --- | --- |
| `PICKET_SERVER_MIN_VERSION` | 是 | 这个客户端能接受的最旧服务端版本，盖进 `product.json.picketServerMinVersion` 与 `catalog.json.minVersion`（两者必须相等，`check.mjs` 校验） |
| `PICKET_SERVER_VERSION` | 否 | 这次实际打包的载荷版本，默认等于下限 |

`build/wsl/fetch-payload.sh <版本>` 从 `server-v<版本>` 取资产并生成 schema 2 的
`catalog.json`；本地已有的 tar.gz 可以用 `--from-file <path>` 直接落盘（离线、内网），
校验和与大小都从该文件现算。

## 四、当前状态（2026-11-06）

- **服务端仓库已对齐新约定**：`noware-cn/picket-code-server` 的 `release-server.yml` 改为手工
  dispatch，三个输入 `version`（裸 semver）、`source_ref`（客户端分支或 tag）、`vscode_version`
  （上游 tag）；发布为 tag `server-v<版本>`、资产 `picket-code-server-<版本>-…`，不再由 tag push 触发。
- 首个新约定 release：**`server-v1.143.1`**（载荷 `picket-code-server-1.143.1-linux-x64.tar.gz`，
  87.8 MB，`commit e6468682…`，从客户端 `feat/picket-wsl` 构建）。
- 客户端仓库变量：`PICKET_SERVER_MIN_VERSION=1.143.1`、`PICKET_SERVER_VERSION=1.143.1`；
  旧变量 `PICKET_SERVER_TAG` 已删除。
- PR 上的 `WSL acceptance`（L4+）已用这个载荷跑通全部阶段：`remote / tunnel / ui / lifecycle /
  icode / conflict / hook / takeover / legacy / legacy-uri`。
- **已知缺口**：服务端仓库的 R2 镜像步骤仍失败（`NoSuchBucket`，`r2:picket-releases` 在现有
  secrets 对应的账号里不存在）。载荷的权威来源暂时只有 GitHub Release；镜像修好前
  `https://download.noware.cn` 不能用作 `picket.wsl.serverPayloadBaseUrl`。
- 载荷的 `product.json.version` 恒为上游版本（`1.143.1`）——扩展加载校验它；服务端自己的版本
  只出现在 release tag、资产名与 catalog 里。

## 五、相关

- 用户视角的 WSL 使用说明：[`docs/wsl.md`](wsl.md)
- 发布清单（客户端）：[`docs/release-checklist.md`](release-checklist.md)
- 构建契约检查：`build/wsl/check.mjs`、`build/check-contract.sh`
