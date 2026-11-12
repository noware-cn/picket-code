# Picket Code 官网 / 文档站

面向 AI 编码 agent 的加固版 VS Code 发行版 [Picket Code](https://github.com/dantesun/picket-code) 的官网与文档站，基于 [VitePress](https://vitepress.dev) 构建。

## 技术栈

- **VitePress**（Vue 生态静态站点生成器）
- 暗色安全主题 + 翠绿 / 天蓝品牌渐变，纯 CSS 定制，无额外 UI 依赖
- 本地全文搜索、代码组 Tab、分层架构图（内联 HTML/CSS）

## 目录结构

```
├── docs/
│   ├── .vitepress/
│   │   ├── config.mts        # 站点配置（导航、侧边栏、搜索、SEO）
│   │   └── theme/
│   │       ├── index.ts      # 主题入口
│   │       └── style.css     # 品牌样式（暗色安全主题）
│   ├── index.md              # 首页（Hero + 特性 + 架构图 + 下载 + 合规）
│   ├── guide/                # 指南：快速开始 / 下载 / 构建 / 扩展 / 发行
│   ├── architecture/         # 架构与安全：设计总览 / AgentHost / 合规
│   └── project/              # 项目：路线图 / 许可
├── public/                   # 独立徽记 favicon.svg + 横版字标 logo.svg / logo-light.svg
│                             # + 社交分享图 og-image.png（docs/public 下为同一份副本）
└── deploy/                   # Cloudflare Pages / R2 部署说明与示例
```

## 本地开发

```bash
npm install
npm run docs:dev        # 本地预览 http://localhost:5173
npm run docs:build      # 构建静态站点 → docs/.vitepress/dist
npm run docs:preview    # 本地预览构建产物
```

## 部署

详见 [deploy/README.md](deploy/README.md)：Cloudflare Pages + GitHub 自动构建 + noware.cn 域名 + R2 资源镜像。

## 更新站点内容

- 发新版时更新 `docs/guide/download.md` 中的版本号（当前 `v1.143.1`）；
- 文档内容以仓库 `README.md` 与 `docs/` 为唯一事实来源，站点页面保持同步。
