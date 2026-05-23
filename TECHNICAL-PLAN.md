# Context Vocab Reader — 技术规划

> 这是开发文档，不是用户文档。规划 14 天 MVP 的技术细节、每天交付什么、如何验证。

---

## 北极星

**一个浏览器里就能用的"读外刊 / 读英文小说 / 读公版书"工具，每个生词都自带前后 300 字上下文，AI 用中文解释，一键存欧陆。**

适用平台：Web（PC + Android Chrome + iOS Safari），无需安装 / 无需账号。

---

## 架构

```
┌────────────────────────────────────────────────┐
│  Browser (read.contextvocab.app)               │
│                                                │
│  ┌──────────┐  ┌──────────┐  ┌──────────────┐  │
│  │  PDF.js  │  │ epub.js  │  │ Readability  │  │
│  │ (PDF)    │  │ (EPUB)   │  │ (web articles│  │
│  └────┬─────┘  └────┬─────┘  └──────┬───────┘  │
│       │             │                │         │
│       └──────┬──────┴────────────────┘         │
│              ▼                                 │
│       text layer / DOM                         │
│              │ (selection event)               │
│              ▼                                 │
│   capture.js  (REUSE from extension)           │
│   - getSelection() + 600-char ancestor walk    │
│              │                                 │
│              ▼                                 │
│   panel.js   (REUSE from extension)            │
│   - 释义 / 此处含义 / 词性 / 备注              │
│   - 朗文 / 韦氏 / 剑桥 deep-link               │
│   - "存到欧陆" 按钮                            │
│              │                                 │
│              ▼ (BYOK keys from localStorage)   │
└──────────────┼─────────────────────────────────┘
               ▼ (CORS-blocked direct)
┌──────────────┴─────────────────────────────────┐
│  Cloudflare Worker (workers.contextvocab.app)  │
│  Transparent BYOK proxy:                       │
│  - POST /api/deepseek → api.deepseek.com       │
│  - POST /api/eudic/word, /api/eudic/note       │
│       → api.frdic.com                          │
│  - GET  /api/fetch-article?url=...             │
│       → fetch the article HTML                 │
│  No state. No logging. Just CORS + forwarding. │
└────────────────────────────────────────────────┘
```

### 为什么需要 Worker

DeepSeek 和欧陆 API **大概率没有 CORS 头**（多数后端 API 都没有），浏览器直连会被拦。Worker 做透明代理，加上 `Access-Control-Allow-Origin` 即可。

**安全设计**：
- 用户 API key 存在浏览器 `localStorage`，每次请求带在 `Authorization` header 里
- Worker 不存任何 key、不写日志
- Worker 只做 forward + 加 CORS 头，不解析 body
- 代码 100% 开源，用户可自己 fork 部署到自己的 Cloudflare 账号下

---

## 技术选型

### 引入的库（不 fork，只当渲染引擎）

| 库 | 版本 | 用途 |
|---|---|---|
| `vite` | latest | 开发服务 + 打包 |
| `pdfjs-dist` | ^4.x | PDF 渲染（含 text layer） |
| `epubjs` | ^0.3.93 | EPUB 渲染 |
| `@mozilla/readability` | ^0.5 | 网页正文提取（Firefox Reader Mode 同款） |
| `dompurify` | ^3.x | 网页正文渲染前消毒（XSS 防御） |
| `idb` | ^8.x | IndexedDB 包装（存阅读库 + 语境档案） |

### 不引入的

- ❌ React / Vue / Svelte —— 复杂度不值得，vanilla 够用
- ❌ Tailwind —— 项目规模小，写 CSS 更直接
- ❌ TypeScript —— 跟 Chrome 扩展统一 vanilla JS
- ❌ Tauri / Electron —— Web 优先

### 设计参考（不复制代码，只看 UX 模式）

| 项目 | 参考点 |
|---|---|
| [Mozilla PDF.js viewer](https://github.com/mozilla/pdf.js) | text layer 与 selection API 配合的细节 |
| [Foliate](https://github.com/johnfactotum/foliate) | EPUB 字体 / 排版 / 翻页选项 |
| [Bibi](https://github.com/satorumurmur/bibi) | 极简 EPUB 阅读 UX |
| [Readest](https://github.com/readest/readest) | 多格式阅读 App 的 library 页布局 |
| [Reader View on Firefox](https://github.com/mozilla/readability) | Readability 的最佳实践 |

---

## 文件结构（目标）

```
context-vocab-reader/
├── package.json
├── vite.config.js
├── index.html                 # SPA shell
├── public/
│   └── samples/
│       └── frankenstein.pdf   # 测试用公版 PDF
├── src/
│   ├── main.js                # 入口 + 路由
│   ├── pages/
│   │   ├── library.js         # 默认页：最近阅读 + 上传文件
│   │   ├── reader-pdf.js
│   │   ├── reader-epub.js
│   │   ├── reader-article.js
│   │   ├── settings.js
│   │   └── log.js             # 语境档案
│   ├── lookup/
│   │   ├── capture.js         # ← 从扩展 content.js 移植
│   │   ├── panel.js           # ← 从扩展 content.js 移植
│   │   ├── panel.css          # ← 从扩展 panel.css 移植
│   │   └── api.js             # 调 Worker proxy
│   ├── storage/
│   │   ├── library.js         # IndexedDB: 文件 + 阅读进度
│   │   ├── settings.js        # localStorage: API keys + 偏好
│   │   └── log.js             # IndexedDB: 语境档案
│   └── styles/
│       ├── global.css
│       └── reader.css
├── worker/
│   ├── src/index.js           # Cloudflare Worker code
│   ├── wrangler.toml
│   └── package.json
├── TECHNICAL-PLAN.md
├── README.md
└── LICENSE
```

---

## 14 天路线图

### Week 1 — Vertical slice

| Day | 目标 | 验证标准 |
|---|---|---|
| **1-2** | PDF.js text-layer 选区 POC | 能加载本地 PDF、能拖选文字、`window.getSelection()` 返回正确字符串、能爬父元素抓 ~600 字上下文 |
| **3** | 移植查词面板 UI | 选词后浮现 ✦ 按钮，点击展开面板（用 mock 数据填充先），样式跟 Chrome 扩展一致 |
| **4** | Cloudflare Worker 透明代理 | `wrangler dev` 跑起来，浏览器 fetch `/api/deepseek` 转发到 DeepSeek 并返回 |
| **5** | PDF → 选词 → AI 解释 端到端 | 用真 DeepSeek key + 真 PDF，看到中文释义渲染在面板里 |
| **6-7** | EPUB.js 集成 + 选区适配 | 加载 EPUB 文件、章节翻页、选区在 iframe 里也能触发查词 |

### Week 2 — Coverage + polish

| Day | 目标 | 验证标准 |
|---|---|---|
| **8-9** | 网页文章导入 | 输入 URL → Worker 抓 HTML → Readability 提取正文 → 渲染 → 选词查词全流程 |
| **10** | 欧陆保存 | 两步 API（add word + add note）走 Worker，欧陆 App 端能看到笔记 |
| **11** | 设置页 + BYOK | 输入两个 key + 选 Worker URL，全部存 localStorage |
| **12** | 阅读库 + 语境档案 | IndexedDB 存最近文件，复用扩展的 log.html 三种导出（JSON / CSV / Anki） |
| **13** | 移动端响应式 + bug 修 | iOS Safari + Android Chrome 实测，触屏选词正常工作 |
| **14** | 部署 + landing | Cloudflare Pages 部署，写 README，做个简单的 landing page |

---

## MVP 不做的（v1.1+ 再说）

- 高亮 / 笔记 / 划线
- 阅读进度云同步（坚持本地优先）
- 多设备账号
- 字体定制 / 双栏排版
- TTS（朗读）
- 推送通知 / 复习排程

---

## 风险点 + 应对

| 风险 | 应对 |
|---|---|
| PDF.js text layer 的 selection 行为可能跟普通 DOM 不一样 | Day 1 优先验证。如果不行，退化到 `dispatchEvent('selectionchange')` 或自己监听 `mouseup` |
| EPUB 在 iframe 里渲染，content script 跨 iframe 选区 | epub.js 提供 `rendition.on("selected", ...)` 回调，直接用 |
| 网页文章付费墙 | 不绕过，遇到 paywall 显示提示让用户用浏览器原生打开 |
| DeepSeek / Eudic API 真有 CORS（不需要 Worker） | 测一下，如果有，Worker 改成只在 fetch-article 路径上代理 |
| 移动端选词触发 ✦ 按钮被系统选区菜单挡住 | 触屏用 long-press + 自定义菜单，PC 用 mouseup，分别处理 |

---

## 复用 Chrome 扩展的代码

直接拷贝、几乎不改的：

- `src/lookup/panel.css` ← `chrome-extension/src/panel.css`
- `src/lookup/panel.js` ← `chrome-extension/src/content.js`（移除 mouseup 全局监听，因为 reader 内是托管事件）
- `src/lookup/capture.js` ← `chrome-extension/src/content.js` 中 `getBlockAncestor` + `captureContext` 函数
- `src/storage/log.js` 三个导出函数 ← `chrome-extension/src/log.js`
- AI prompt（system + user message） ← `chrome-extension/src/background.js`
- `parseModelJson` 三层降级解析 ← `chrome-extension/src/background.js`
- 欧陆 API 两步 save 逻辑 ← `chrome-extension/src/background.js`

需要重写的：

- 入口 / 路由（main.js + 各 page）
- IndexedDB 库管理（替代 chrome.storage）
- Worker 代理（替代 service worker 直接 fetch）

估算：复用代码 ~700 行，新写 ~1500 行。
