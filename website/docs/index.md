---
layout: home

hero:
  name: Picket Code
  text: 面向 AI 编码 agent 的加固版 VS Code 发行版
  tagline: 受控扩展 · 私有模型网关 · 按项目沙箱。默认离线、无遥测、无账号绑定，AgentHost 为 iCode 预留一等接入点 —— 为银行 / 信创内网而生的可信 IDE。
  image:
    # VitePress sizes the hero image for a square; the wordmark belongs in wide
    # slots (README, banners), so the emblem sits next to the hero title.
    src: /favicon.svg
    alt: Picket Code
  actions:
    - theme: brand
      text: 下载 v1.143.1
      link: /guide/download
    - theme: alt
      text: 快速开始
      link: /guide/quickstart
    - theme: alt
      text: GitHub 仓库
      link: https://github.com/dantesun/picket-code
---

<div class="pc-section">

<h2 class="pc-title">为什么需要 <span>Picket Code</span></h2>
<p class="pc-sub">主流编码 agent 依赖公有云与国外服务，SDK 与遥测和信创内网的合规边界冲突且不可裁剪。Picket Code 以 Code - OSS 为基底，裁掉微软绑定与国外 agent 实现，把 AgentHost 保留为干净的 agent 扩展点、以 iCode 作为唯一 agent 方向，形成"离线、可控、可审计"的内网 IDE 发行版。</p>

<div class="pc-grid">

<div class="pc-card">
  <div class="pc-icon">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.5 19.5 5.5V11c0 4.7-3.2 7.9-7.5 9.5C7.7 18.9 4.5 15.7 4.5 11V5.5Z"/><path d="m9 11.5 2 2 4-4.5"/></svg>
  </div>
  <h3>干净发行</h3>
  <p>MIT 许可的 Code - OSS 构建，移除微软定制：无遥测、无微软品牌、无微软市场。产物反查无遥测端点与微软标识。</p>
  <span class="pc-tag">P1 已落地</span>
</div>

<div class="pc-card">
  <div class="pc-icon">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 6.5 4.5 9 2 11.5"/><path d="M12 6.5 9.5 9 12 11.5"/><path d="M7 3.5v11"/><path d="M14 8h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-3"/></svg>
  </div>
  <h3>默认离线</h3>
  <p>发行版不内置任何联网扩展：无 Copilot、无 GitHub 云集成、无认证 / 隧道 / 浏览器扩展，核心编辑体验完全离线。也没有账号登录与设置同步：构建剔除了 github、github-base、github-authentication、microsoft-authentication 四个内置扩展，product.json 不再定义 defaultChatAgent 等账号键。</p>
  <span class="pc-tag">内置最小集 32 + 3</span>
</div>

<div class="pc-card">
  <div class="pc-icon">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4 4 7.5v9L12 20l8-3.5v-9Z"/><path d="m12 8-4.5 2v4.2L12 16l4.5-1.8V10Z"/><path d="M12 8v8"/></svg>
  </div>
  <h3>受控扩展</h3>
  <p>默认使用 Open VSX，可指向自建市场镜像，并在其上叠加白名单策略与扩展签名校验，扩展来源完全可控。</p>
  <span class="pc-tag">P0-3 规划</span>
</div>

<div class="pc-card">
  <div class="pc-icon">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="15" r="4"/><path d="m10.8 12.2 8-8"/><path d="M16 5.5 18.5 8"/><path d="M15 11 13 9"/><path d="m7 13 1.5 1.5"/></svg>
  </div>
  <h3>私有模型网关</h3>
  <p>设计上配合自托管网关（如 LiteLLM），让 agent 只访问你控制的模型端点，模型 BYO，数据不出网。</p>
  <span class="pc-tag">合规内建</span>
</div>

<div class="pc-card">
  <div class="pc-icon">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h7v7H4z"/><path d="M13 4h7v7h-7z"/><path d="M4 13h7v7H4z"/><path d="M13 16h4"/><path d="M17 14v4"/></svg>
  </div>
  <h3>按项目沙箱</h3>
  <p>devcontainer 模板与出站防火墙配置（默认拒绝出站，白名单放行网关端点），把 agent 的终端、构建与文件操作约束在项目内。</p>
  <span class="pc-tag">P0 规划</span>
</div>

<div class="pc-card">
  <div class="pc-icon">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m5 8 4-3.5L13 8l4-3.5L21 8v11a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 19Z"/><path d="M3 13h18"/><path d="M8 16.5h4"/></svg>
  </div>
  <h3>Agent 宿主就绪</h3>
  <p>AgentHost 在完全不装 Copilot 包的情况下启动并说协议（57 号补丁），保留 IAgent、registerProvider、providerConfigurations 与协议客户端等扩展点；iCode 经 ACP 接入（P3 注册、P4 会话恢复与 diff 预览，63/64 号补丁），<code>icode</code> 可解析时自动注册为唯一 provider。</p>
  <span class="pc-tag">宿主可用 · iCode 已接入</span>
</div>

</div>
</div>

<div class="pc-section">

<h2 class="pc-title">分层架构 <span>To Be</span></h2>
<p class="pc-sub">复用上游、减法优先：沿 VSCodium 验证过的构建路径做减法，先删后补。六层架构中，发行层与扩展层已落地，AgentHost 平台层裁剪为"零 provider + 编排核心"且已在无 Copilot 包的情况下启动，iCode 经适配层接入（P3 已通过：注册、单轮往返与打断在 Agents Window 实测可用；P4 已通过：会话恢复、审批与输入往返、模型目录、per-turn diff 预览）。</p>

<div class="pc-stack">
  <div class="pc-stack-head">
    <strong>PICKET CODE 六层架构</strong>
    <span>base: microsoft/vscode · mit</span>
  </div>
  <div class="pc-layer">
    <div>
      <div class="pc-l-name">发行层</div>
      <div class="pc-l-desc">picket-code 品牌、Open VSX 市场、更新器关闭（升级靠重新下载发行包）</div>
    </div>
    <span class="pc-l-status shipped">P1 已落地</span>
  </div>
  <div class="pc-layer">
    <div>
      <div class="pc-l-name">扩展层</div>
      <div class="pc-l-desc">最小内置集（32 保留 + 3 构建期）＋ 受控市场按需安装</div>
    </div>
    <span class="pc-l-status shipped">P1 已落地</span>
  </div>
  <div class="pc-layer">
    <div>
      <div class="pc-l-name">Workbench 核心</div>
      <div class="pc-l-desc">聊天 shell、设置、编辑器（含 agentHost 会话 UI）</div>
    </div>
    <span class="pc-l-status core">保留</span>
  </div>
  <div class="pc-layer">
    <div>
      <div class="pc-l-name">AgentHost 平台层</div>
      <div class="pc-l-desc">provider 注册、会话、审批、日志 —— 裁剪为"零 provider + 编排核心"</div>
    </div>
    <span class="pc-l-status core">保留核心</span>
  </div>
  <div class="pc-layer">
    <div>
      <div class="pc-l-name">适配层</div>
      <div class="pc-l-desc">node/icode/（IAgent 实现）：agent 适配、常驻客户端、启动配置、事件映射</div>
    </div>
    <span class="pc-l-status planned">P3–P4 新增</span>
  </div>
  <div class="pc-layer">
    <div>
      <div class="pc-l-name">iCode 引擎</div>
      <div class="pc-l-desc">Python CLI、workflow、审批、OTel —— 外部进程，BYO 模型</div>
    </div>
    <span class="pc-l-status planned">外部进程</span>
  </div>
</div>

</div>

<div class="pc-section">

<h2 class="pc-title">三步 <span>快速上手</span></h2>
<p class="pc-sub">从下载到启动编辑器，全程默认离线、无需联网注册（无账号、无登录）。</p>

<div class="pc-steps">
  <div class="pc-step">
    <span class="pc-step-no">1</span>
    <h3>下载发行包</h3>
    <p>从镜像站 <a href="https://download.noware.cn/picket-code-v1.143.1-win32-x64.zip"><code>download.noware.cn</code></a>（或 <a href="https://github.com/dantesun/picket-code/releases">GitHub Releases</a>）获取对应平台的 <code>tar.gz</code> / <code>zip</code>，脚本自动完成 SHA256 校验。<a href="/guide/download">下载页</a> 有完整地址与校验命令。</p>
  </div>
  <div class="pc-step">
    <span class="pc-step-no">2</span>
    <h3>解压并启动</h3>
    <p>Linux 运行 <code>./picket-code</code>，Windows 运行 <code>code.exe</code>，无需安装、无需联网。</p>
  </div>
  <div class="pc-step">
    <span class="pc-step-no">3</span>
    <h3>模型 BYO（待接入）</h3>
    <p>模型一律自带（BYO），推荐指向自托管网关（如 LiteLLM）。当前发行版尚无 agent 后端，iCode 适配层（P3–P4）落地后模型配置才真正生效。</p>
  </div>
</div>

</div>

<div class="pc-section">

<h2 class="pc-title">平台支持与 <span>下载</span></h2>
<p class="pc-sub">当前发行：Linux (x64) 与 Windows (x64)，tar.gz 与 zip 压缩包；macOS 与 ARM64 在 P0 验证闭环后加入。下载走 <code>https://download.noware.cn</code>（保留最近 3 个版本，更早的版本不承诺长期可下载）。</p>

<div class="pc-dl-grid">
  <div class="pc-dl-card">
    <div class="pc-dl-os">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 16.5 2.5 12 4 7.5c.5-1.8 2-3 3.5-3H19a1.5 1.5 0 0 1 1.5 1.5v12a1.5 1.5 0 0 1-1.5 1.5H7.5c-1.5 0-3-1.2-3.5-3Z"/><path d="m2.5 12 1.5 4.5"/><path d="m2.5 12 1.5-4.5"/><path d="M9 9.5c.8-.6 2-.6 3 .4s2.2 1 3 .4"/></svg>
      Linux (x64)
    </div>
    <ul>
      <li>压缩包：<code>picket-code-v1.143.1-linux-x64.tar.gz</code>（文件名带版本）</li>
      <li>启动：<code>./picket-code</code></li>
      <li><a href="https://download.noware.cn/picket-code-v1.143.1-linux-x64.tar.gz">镜像直链</a> · <a href="/guide/download">一键下载安装命令 →</a></li>
    </ul>
  </div>
  <div class="pc-dl-card">
    <div class="pc-dl-os">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3.5" width="18" height="17" rx="2"/><path d="M3 9h18"/><path d="M9.5 12.5h5"/></svg>
      Windows (x64)
    </div>
    <ul>
      <li>压缩包：<code>picket-code-v1.143.1-win32-x64.zip</code>（文件名带版本）</li>
      <li>启动：<code>code.exe</code></li>
      <li><a href="https://download.noware.cn/picket-code-v1.143.1-win32-x64.zip">镜像直链</a> · <a href="/guide/download">一键下载安装命令 →</a></li>
    </ul>
  </div>
</div>

</div>

<div class="pc-section">

<h2 class="pc-title">合规与 <span>安全内建</span></h2>
<p class="pc-sub">合规是产品属性而非事后加装：无遥测出厂配置、人工审批与审计日志在架构层内建、数据不出网。</p>

<div class="pc-badges">
  <span class="pc-badge">默认无遥测</span>
  <span class="pc-badge">金发〔2026〕8号条款映射</span>
  <span class="pc-badge">人工复核 / pending_confirmation</span>
  <span class="pc-badge">会话日志留存（行内配置）</span>
  <span class="pc-badge">扩展白名单 + 签名校验</span>
  <span class="pc-badge">默认拒绝出站沙箱</span>
  <span class="pc-badge">禁用无头审批绕过</span>
  <span class="pc-badge">无账号 / 无登录 / 无设置同步</span>
  <span class="pc-badge">MIT 许可 · 供应链可审计</span>
</div>

</div>

<div class="pc-cta">
  <div class="pc-cta-box">
    <h2>开始使用 Picket Code</h2>
    <p>下载 v1.143.1，或在 GitHub 上查看源码、提交 Issue、参与路线图。</p>
    <div class="pc-cta-actions">
      <a class="primary" href="/guide/download">下载 v1.143.1</a>
      <a class="ghost" href="https://github.com/dantesun/picket-code">GitHub 仓库</a>
      <a class="ghost" href="/project/roadmap">查看路线图</a>
    </div>
  </div>
</div>
