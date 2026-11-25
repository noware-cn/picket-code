# 部署到 Cloudflare Pages + R2 自定义域名（noware.cn）

Picket Code 官网是纯静态站点（VitePress 构建产物），托管在 **Cloudflare Pages**，域名 **`picket-code.noware.cn`**，构建由 **GitHub** 触发。发行包等大文件放 **Cloudflare R2**，通过 R2 桶的自定义域名 **`download.noware.cn`** 直出。

> **实际部署状态（2026-11-25）**：Pages 项目 `picket-code` 的 Git 连接已重新指向 `noware-cn/picket-code`
> （`source.config.owner = noware-cn`、`repo_id 1429677360`、production branch `main`、`deployments_enabled = true`），
> 由一次真实的 `github:push main → deploy/success` 验证；自定义域名 `picket-code.noware.cn` 仍绑定在同一个项目上
> （SSL 由 Google Trust Services 签发，有效期至 2027-01-26）。构建配置：Root directory `website`，
> Build command `npm ci && npm run docs:build`，Output directory `docs/.vitepress/dist`。
> Node 版本**不显式指定**，用 v3 构建镜像的默认 22.23.4（v3 起不再读取 `package.json` 的 `engines.node`）。
> Build watch paths 应设为 `website/*`，避免应用代码提交也触发站点重建。
> 项目状态用只读工作流 **Actions → Pages info** 复核（打印仓库接线、构建配置、环境变量名、最近部署）。
> 下载域名 `download.noware.cn` 为 R2 桶 `picket-releases` 的自定义域名。

## 总体架构

```
GitHub（源码 + website/ 站点）
    │ push 触发
    ├──────────────► Cloudflare Pages（构建 VitePress 静态站点）
    │                     │ 自定义域名
    │                     ▼
    │            picket-code.noware.cn（SSL、CDN、WAF 全自带）
    │
    └──────────────► Cloudflare R2 桶 picket-releases（发行包 + SHA256SUMS）
                          │ 自定义域名
                          ▼
                  download.noware.cn（对象直出）
```

两个主机名各司其职：

| 主机名 | 提供者 | 内容 |
|---|---|---|
| `picket-code.noware.cn` | Cloudflare Pages（`picket-code` 项目） | VitePress 文档站 |
| `download.noware.cn` | R2 桶 `picket-releases` 的自定义域名 | 发行包与 `SHA256SUMS`（路径 `/picket-code-*`） |

文档站里所有下载链接都指向 `download.noware.cn`；`picket-code.noware.cn` 只提供文档站，`/picket-code-*` 之类路径返回 404。

## 一、把站点放进仓库

把本 `website/`（或本目录内容）放入 `noware-cn/picket-code` 仓库根目录，提交后推送：

```bash
# 在仓库根目录（示例：放到 website/ 子目录）
git add website/
git commit -m "chore: add official website (VitePress)"
git push
```

## 二、Cloudflare Pages 接入

1. 打开 Cloudflare Dashboard → **Workers & Pages → Create → Pages → Connect to Git**；
2. 选择 `noware-cn/picket-code` 仓库；
3. 构建配置：

| 配置项 | 值 |
|---|---|
| Production branch | `main` |
| Root directory | `website` |
| Build command | `npm ci && npm run docs:build` |
| Build output directory | `docs/.vitepress/dist` |
| Framework preset | `None`（VitePress 暂无预设，手动填写即可） |

4. 点击 **Save and Deploy**，首次构建约 1–2 分钟。

> 站点更新流程：每次 `git push` 到 main（或 PR 合并），Pages 自动重新构建上线；PR 自动生成预览链接，方便审阅文档改动。

## 三、绑定子域名 picket-code.noware.cn

1. Pages 项目 → **Custom domains → Set up a custom domain**，输入 `picket-code.noware.cn`（已完成）；
2. **创建 DNS 记录**（已通过 API 创建，若重建：Cloudflare Dashboard → 域名 `noware.cn` → DNS → 添加记录）：
   - 类型：`CNAME`
   - 名称：`picket-code`
   - 目标：`picket-code.pages.dev`
   - 代理状态：**开启（橙色云朵）**
   - TTL：自动
3. 保存后 Cloudflare 自动为域名签发 SSL 证书（Google CA，约 1–15 分钟），状态从 pending → active；
4. 生效后即可通过 `https://picket-code.noware.cn` 访问（已完成，证书有效期至 2027-01-26）。

## 四、下载资源：R2 桶 + 自定义域名（已落地）

### 1. 下载地址的形式

对象键就是文件名，文件名带版本（示例 tag `v1.143.1`）：

- `https://download.noware.cn/picket-code-v1.143.1-win32-x64.zip`
- `https://download.noware.cn/picket-code-v1.143.1-linux-x64.tar.gz`
- `https://download.noware.cn/picket-code-v1.143.1-SHA256SUMS`

因为文件名含版本，一个 URL 对应的对象永不覆盖，上传时即带 `cache-control: public, max-age=31536000, immutable`，可被 CDN 与客户端长期缓存。`SHA256SUMS` 另带 `content-type: text/plain; charset=utf-8`，浏览器直接显示而不是下载。桶里**没有** `latest` 别名，旧的无版本对象（`picket-code-win32-x64.zip`、`SHA256SUMS`）已删除且不再生成，请求返回 404（不提供兼容）。

### 2. R2 桶与保留策略

- 桶：`picket-releases`，绑定自定义域名 `download.noware.cn`；
- 上传：`release.yml` 的 `r2-sync` 任务从已发布的 Release 下载 `picket-code-*` 资产，`rclone copy release/ r2:picket-releases/`（用 `copy` 而非 `sync`，避免删除历史版本）；`SHA256SUMS` 单独用 `rclone copyto` 上传，以便带上 `content-type` 与 `cache-control` 头；
- 保留：`.github/scripts/prune-r2.sh` 只保留最近 **3 个版本**（`KEEP=3`，按 tag 的 `vX.Y.Z` + `-pN` 排序），更早的版本不承诺长期可下载；
- 凭据：GitHub Secrets `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_ENDPOINT`；
- 边缘缓存：R2 自定义域名的响应默认是 `cf-cache-status: DYNAMIC`（Cloudflare **不缓存**），每次下载都读 R2 一次。要让下载命中 Cloudflare 边缘缓存，需在 zone `noware.cn` 上加一条 Cache Rule（表达式 `http.host eq "download.noware.cn"`，开启 Cache eligibility: Eligible for cache、Edge TTL: 1 year）；这属于控制台/Zone 权限，不在 CI 里做。

## 五、备用方案：Wrangler 直接上传站点

不想接 Git 时，可用 Wrangler 直接上传 Pages 构建产物（`wrangler.toml.example`）。这只影响站点，发行包仍由 `release.yml` 同步到 R2：

```bash
npm install -g wrangler
wrangler login
cd website && npm ci && npm run docs:build
wrangler pages deploy docs/.vitepress/dist --project-name=picket-code
```

## 六、部署方式：Git 构建为主，`Deploy site` 工作流为兜底

2026-10-30 到 2026-11-25 之间站点在"默默不更新"：仓库从 `dantesun/picket-code` 转移到
`noware-cn/picket-code` 后，Pages 项目仍指向旧地址（`gh api repos/noware-cn/picket-code/hooks`
里只有 Gitee 镜像一条，没有 Cloudflare 的 push 回调）。2026-11-25 重新连接后恢复自动构建。

**主路径（自动）**：push 到 `main` → Pages 按项目构建配置构建 → 发布到 `picket-code.noware.cn`。
前提是 Cloudflare Pages 的 GitHub App 已在 `noware-cn` 组织上获得该仓库的访问权
（https://github.com/apps/cloudflare-pages/installations/new → 选组织 → 只勾 `picket-code`）。
换仓库/换组织时，只点 "Manage" 重新授权不管用，必须在 Settings → Builds → Git Repository
里**先 Disconnect 再重连**，否则项目会继续指向旧 org。

**兜底（手动）**：`.github/workflows/deploy-site.yml`。

- 触发：仅 `workflow_dispatch`（Actions → **Deploy site** → Run workflow）；
- 口令：仓库 Secret `CF_PAGES_TOKEN`（**Account → Cloudflare Pages → Edit**，不要附加 R2 或
  Zone 权限）＋ 仓库变量 `CF_ACCOUNT_ID`；`CF_API_TOKEN` 只有 R2 权限，仅作为缺省回退；
- 行为：`npm ci && npm run docs:build` 后 `wrangler pages deploy docs/.vitepress/dist
  --project-name=picket-code --branch=main`，即把该次构建作为 production 部署。
  与 Git 构建写同一个项目，谁最后跑谁生效。

**排障**：Actions → **Pages info**（只读，`.github/workflows/pages-info.yml`）打印仓库接线、
构建配置、环境变量名（不打印值）与最近 5 次部署状态。

## 七、GitHub Actions 一键部署（备用形态）

`deploy/.github/workflows/deploy-pages.yml.example` 提供了 GitHub Actions 直传 Pages 的另一种示例，需在仓库 Secrets 中配置：

| Secret | 说明 |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare API Token（权限：Pages Edit） |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare 账户 ID |

## 站点内的下载链接与变量

- 站内下载链接指向镜像主机 `https://download.noware.cn`，文件名形如 `picket-code-<tag>-<os>-<arch>.<ext>`；文档中的具体示例版本写在 `website/docs/guide/download.md`、`website/docs/guide/releases.md`，发版后按需更新示例；
- 仓库变量 `R2_PUBLIC_BASE_URL` 决定 Release 说明顶部的镜像链接（未设置时该步骤跳过，Release 只保留 GitHub 链接）；
- 站点的下载脚本（`build/download-verify.sh|ps1|bat`）不带版本时自行解析 GitHub 最新 release，因此脚本本身无需随版本改动；
- 如需让下载按钮动态读取最新版本，可后续在 Pages Functions 中加一层 `api/latest-release`，从 GitHub API 读取最新 tag。
