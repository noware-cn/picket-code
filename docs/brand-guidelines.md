# Picket Code 品牌资产规范

## 品牌表达

Picket Code 是面向 AI 编码 agent 的加固版 Code-OSS 发行版。视觉表达围绕可信工程、受控自主、清晰安全边界与开发者生产力展开。

## 标志构成

独立几何工程徽记由四个分离的角部模块与中央菱形构成。四个模块表达模块化工程结构与边界隔离；中央菱形表达受控执行核心。该标志不依赖字母 P，也不采用盾牌、锁头或代码括号等常见符号。

## 色彩

| 名称 | 色值 | 用途 |
|---|---|---|
| Deep Navy | `#10243A` | 主文字、浅色背景标志 |
| Night Navy | `#081A2B` | 深色背景、图标底色 |
| Signal Cyan | `#19C6D8` | 图形核心、深色背景强调 |
| Text Teal | `#007E8A` | 浅色背景上的强调文字 |
| Cloud | `#F4F8FC` | 浅色背景、深色背景上的图形 |

## 字体

- Geist：品牌标题与界面标题。
- Geist Mono：代码、标识符、版本号等技术信息。

## 资产

- `logo.svg`：深色背景横版标志（760×180，横幅、演示封面、深色页面正文插图）。
- `logo-light.svg`：浅色背景横版标志（仓库 README 等浅色页面，README 通过
  `prefers-color-scheme` 在深色主题下自动换用 `logo.svg`）。
- `favicon.svg`：独立图形标识（160×160，网站导航、首页主图、favicon 与应用图标源图）。
- SVG 为主要矢量源文件；PNG 应按具体使用场景导出。

两份横版标志的文字已转为轮廓路径，不依赖本机安装 Geist，任何浏览器与
GitHub 的 camo 代理下渲染一致。改动字样或字距时用
`build/brand/build-wordmark.py` 重新生成，且 `website/public/` 与
`website/docs/public/` 下的副本必须保持逐字节相同。

## 应用与发行物

徽记是纯几何（四个角部模块 + 中央菱形），因此应用图标不经 SVG 光栅化，
而由 `build/brand/export-icons.py` 直接绘制并导出所有位图。改动徽记后重跑
该脚本，不要手工编辑下列文件：

| 产物 | 规格 |
|---|---|
| `vscode/resources/win32/code.ico` | 16/24/32/48/64/128/256，圆角 17.5%，透明圆角外 |
| `vscode/resources/win32/code_70x70.png` | 通知图标，同规格 |
| `vscode/resources/win32/code_150x150.png` | 源码运行时的窗口图标，同规格 |
| `vscode/resources/darwin/code.icns` | 16–1024 七个 PNG 块，底板 824/1024、圆角 22.45%，四周留 macOS 投影区 |
| `vscode/resources/linux/code.png` | 512，圆角 17.5%（`linuxIconName=picket-code`） |
| `vscode/resources/server/{favicon.ico,code-192.png,code-512.png}` | 浏览器版工作台的 favicon 与 PWA 图标；`manifest.json` 的应用名为 Picket Code |
| `vscode/extensions/picket-remote-wsl/resources/icon.png` | 128，扩展列表图标 |
| `website/public/og-image.png` | 1200×630，Night Navy 底 + 横版字标，宽 960 居中；`website/docs/public/` 下为逐字节相同的副本 |

窗口内还有两处品牌位，改动时同一批次处理：空编辑器水印
`vscode/src/vs/workbench/browser/parts/editor/media/letterpress-{light,dark,hcLight,hcDark}.svg`
（用徽记几何、单色、沿用各主题原有的不透明度 0.1/0.3/填充灰），以及登录回环页
`loopbackServer.ts` 里内联的默认背景图。

`node build/brand/check-assets.mjs` 校验上述全部产物：格式、帧尺寸集合、
与上游 VS Code 图标不是同一文件、水印与回环页仍是徽记。CI 的 Contract 作业
会运行它，任何一次与上游的重新合并如果把这些文件带回 VS Code 版本都会失败。

横版标志已经包含 "Picket Code" 字样，因此**不要**与站点标题文字并排使用，
也不要放进方形或 24px 高的槽位：导航栏与首页主图用 `favicon.svg` 加文字标题，
横版标志只出现在有足够横向空间的位置。

## 使用规则

1. 宽幅位置（README 横幅、演示封面、深色页面插图）使用横版组合标志；导航栏、
   首页主图、应用图标、favicon 这类方形或狭小位置使用独立图形标识。
2. 净空要求在放置时留白：标志外围至少留出一个图形模块（58 单位）的宽度。
   它不描述 SVG 内部边距——横版字标左边距 18 单位、独立徽记 10 单位。
3. 浅色背景使用深海军蓝版本，深色背景使用白色与工程青版本。
4. 不改变模块间距、中央菱形比例或图形方向。
5. 不添加渐变、投影、描边、立体效果或额外装饰。
6. 不与 Microsoft、Visual Studio Code 的商标或图形建立视觉混淆。
