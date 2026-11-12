import { defineConfig } from 'vitepress'

export default defineConfig({
  lang: 'zh-CN',
  title: 'Picket Code',
  description:
    '面向 AI 编码 agent 的加固版 VS Code 发行版 —— 受控扩展、私有模型网关、按项目沙箱，为银行 / 信创内网而生的可信 IDE。',

  head: [
    ['link', { rel: 'icon', href: '/favicon.svg' }],
    ['script', { src: '/analytics.js', defer: true }],
    ['meta', { name: 'theme-color', content: '#0b1220' }],
    ['meta', { property: 'og:title', content: 'Picket Code' }],
    [
      'meta',
      {
        property: 'og:description',
        content: '面向 AI 编码 agent 的加固版 VS Code 发行版 —— 受控扩展、私有模型网关、按项目沙箱',
      },
    ],
    ['meta', { property: 'og:type', content: 'website' }],
    // Absolute URLs: several crawlers will not resolve a relative og:image.
    ['meta', { property: 'og:image', content: 'https://picket-code.noware.cn/og-image.png' }],
    ['meta', { property: 'og:image:width', content: '1200' }],
    ['meta', { property: 'og:image:height', content: '630' }],
    ['meta', { property: 'og:image:alt', content: 'Picket Code' }],
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
  ],

  cleanUrls: true,
  lastUpdated: true,

  themeConfig: {
    appearance: 'force-dark',
    // The wordmark (logo.svg) is 760x180 and already spells the name, so VitePress
    // would draw it at 24px tall next to a second "Picket Code" from siteTitle.
    // The nav takes the square emblem and keeps the text title.
    logo: '/favicon.svg',
    siteTitle: 'Picket Code',

    nav: [
      { text: '首页', link: '/' },
      { text: '快速开始', link: '/guide/quickstart' },
      {
        text: '指南',
        items: [
          { text: '快速开始', link: '/guide/quickstart' },
          { text: '下载与安装', link: '/guide/download' },
          { text: '从源码构建', link: '/guide/build-from-source' },
          { text: '扩展策略', link: '/guide/extensions' },
          { text: '在 WSL 中使用', link: '/guide/wsl' },
          { text: '发行与版本', link: '/guide/releases' },
        ],
      },
      {
        text: '架构与安全',
        items: [
          { text: '设计总览', link: '/architecture/overview' },
          { text: 'AgentHost 与 iCode', link: '/architecture/agenthost' },
          { text: '安全与合规', link: '/architecture/security' },
        ],
      },
      {
        text: '项目',
        items: [
          { text: '路线图', link: '/project/roadmap' },
          { text: '许可', link: '/project/license' },
        ],
      },
      { text: 'GitHub', link: 'https://github.com/dantesun/picket-code' },
    ],

    sidebar: {
      '/guide/': [
        {
          text: '指南',
          items: [
            { text: '快速开始', link: '/guide/quickstart' },
            { text: '下载与安装', link: '/guide/download' },
            { text: '从源码构建', link: '/guide/build-from-source' },
            { text: '扩展策略', link: '/guide/extensions' },
            { text: '在 WSL 中使用', link: '/guide/wsl' },
            { text: '发行与版本', link: '/guide/releases' },
          ],
        },
      ],
      '/architecture/': [
        {
          text: '架构与安全',
          items: [
            { text: '设计总览', link: '/architecture/overview' },
            { text: 'AgentHost 与 iCode', link: '/architecture/agenthost' },
            { text: '安全与合规', link: '/architecture/security' },
          ],
        },
      ],
      '/project/': [
        {
          text: '项目',
          items: [
            { text: '路线图', link: '/project/roadmap' },
            { text: '许可', link: '/project/license' },
          ],
        },
      ],
    },

    outline: { label: '本页目录', level: [2, 3] },
    docFooter: { prev: '上一页', next: '下一页' },
    lastUpdated: { text: '更新于' },

    search: {
      provider: 'local',
      options: {
        translations: {
          button: { buttonText: '搜索文档', buttonAriaLabel: '搜索文档' },
          modal: {
            noResultsText: '无法找到相关结果',
            resetButtonTitle: '清除查询条件',
            footer: {
              selectText: '选择',
              navigateText: '切换',
              closeText: '关闭',
            },
          },
        },
      },
    },

    socialLinks: [{ icon: 'github', link: 'https://github.com/dantesun/picket-code' }],

    editLink: {
      pattern: 'https://github.com/dantesun/picket-code/edit/main/website/:path',
      text: '在 GitHub 上编辑此页',
    },

    footer: {
      message: 'MIT License · 与微软无关，仅基于开源 Code - OSS 构建',
      copyright: 'Copyright © 2026 dantesun · Picket Code',
    },
  },
})
