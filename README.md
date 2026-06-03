# Context Vocab Reader

> 浏览器里就能用的「读外刊 / 读英文小说 / 读公版书」工具。每个生词都自带前后 ~300 字上下文 → AI 中文释义 → 一键存欧陆词典。支持 **PDF 与 EPUB**，支持 **桌面鼠标 + 平板触屏**。

**🔗 在线地址**：https://kevinguo0351.github.io/context-vocab-reader/ （PWA，可「添加到主屏」当 App 用；首次在 ⚙ 填 DeepSeek key + 欧陆 token 即可）

**配套项目**：[Context Vocab Chrome Extension](https://github.com/kevinguo0351/context-vocab-extension) —— 处理「网页划词」。本 Reader 处理「读完整 PDF / EPUB」的另一半场景，复用同一套「上下文 + DeepSeek 释义 + 一键存欧陆」体验。

---

## 它能做什么

### 1. 逐词查询（普通模式）
- **桌面**：鼠标划词 → 浮起「✦ 查词」按钮 → 点开释义面板。
- **平板**：**单击单词即查**（Kindle 式），或长按拖拽选短语 → 浮起查词按钮。
- 释义面板由 DeepSeek 生成四段：**字典义** / **在这段里的意思（结合上下文）** / **词性** / **记忆点**；附朗文·韦氏·剑桥外链。
- 一键**存到欧陆生词本**（带语境笔记），同时镜像到**本地词库**（IndexedDB）。

### 2. 批量模式（生词密度高时用）
读一整段/一整页时生词太多、逐个查会打断节奏，于是：
1. **进入**：工具栏「批量」按钮（平板）/ `Alt+B` / 右键菜单（桌面）。
2. **沉浸读**，遇到不认识的词**点一下就标记**（不弹任何窗）。
3. **结束**：横幅「完成」按钮 / 再按 `Alt+B`。
4. 后台**并发批量生成**所有标记词的释义 → 自动存本地词库 + 推欧陆 → 弹出**两栏复习窗**：左栏重排文章、标记词加框且词下方显示中文释义；右栏显示选中词的完整释义。

### 3. 平板适配（横竖屏都优化）
- 单击查词 / 左右滑动翻 EPUB / 工具栏批量按钮 —— 无需键盘和右键。
- 44px 触摸目标、面板不溢出、复习窗竖屏自动堆叠、PDF 按屏宽自适应缩放、EPUB 横屏双页/竖屏单页。
- 已配置 PWA（`display: standalone`），可「添加到主屏幕」当独立 App 用。

### 其它
- **BYOK**（自带 key）：DeepSeek key 和欧陆 token 只存在浏览器 `localStorage`，不上传任何服务器。
- 纯前端 SPA，直接调用 DeepSeek / 欧陆（两者均支持网页 CORS，无需任何代理/后端）。
- 阅读进度自动保存（EPUB 按 CFI），书目记在本地。

---

## 快速开始

```bash
git clone https://github.com/kevinguo0351/context-vocab-reader.git
cd context-vocab-reader
npm install
npm run dev          # → http://localhost:1420  （端口固定，见 vite.config.js）
```

构建 / 预览：

```bash
npm run build        # 产物在 dist/
npm run preview
```

> Tauri 桌面壳（可选，未启用）：`npm run tauri:dev` / `npm run tauri:build`，需要 Rust 工具链。

---

## 配置 API Key（首次必做）

点右上角 **⚙ 设置**，填 key（都存在本地 `localStorage`）：

| 字段 | 用途 | 哪里拿 |
|---|---|---|
| **DeepSeek API key** | 生成中文释义 | https://platform.deepseek.com |
| **欧陆 token** | 存生词本（带笔记） | https://my.eudic.net/OpenAPI/Authorization |

App 直接调用 DeepSeek（`api.deepseek.com`）和欧陆（`api.frdic.com`）——两者都支持网页跨域、且国内可直连，**无需任何代理或后端**。

---

## 交互速查

| 操作 | 桌面 | 平板触屏 |
|---|---|---|
| 查单个词 | 鼠标划词 → ✦查词 | **单击单词** |
| 查短语 | 鼠标划词 → ✦查词 | 长按拖拽选中 → ✦查词 |
| 进/出批量模式 | `Alt+B` 或右键菜单 | 工具栏「批量」/ 横幅「完成」 |
| 批量里标词 | 点击单词 | 点击单词 |
| EPUB 翻页 | 方向键 / 底部按钮 | **左右滑动** / 底部按钮 |
| 关闭面板/复习窗 | `Esc` / × / 点外部 | × / 点外部 |

---

## 项目结构

```
context-vocab-reader/
├── index.html              # 工具栏 + #reader-main 容器
├── vite.config.js          # Vite + PWA（端口 1420 固定）
├── src/
│   ├── main.js             # 入口：装配查词/批量/触屏/加载文件
│   ├── style.css           # 全部样式（含触屏 @media、批量、复习窗）
│   ├── pdf/render.js        # PDF → canvas + 透明 textLayer（自适应缩放）
│   ├── epub/render.js       # EPUB → epubjs iframe（翻页/spread/进度）
│   ├── lookup/
│   │   ├── capture.js       # 选区 → {word, context, rect}（PDF+EPUB 通用）
│   │   ├── gesture.js       # 触屏手势分类器（tap/选词/滑动/滚动）
│   │   ├── panel.js         # 浮窗按钮 + 释义面板（renderResultInto 共享）
│   │   └── api.js           # DeepSeek 释义 + 欧陆存词 + 5 级 JSON 容错
│   ├── batch/
│   │   ├── mode.js          # 批量模式状态机（入口/横幅/快捷键/右键）
│   │   ├── mark.js          # 点→词→块 + 标记（PDF 覆盖框 / EPUB 包裹）+ 点词查词
│   │   ├── pipeline.js      # 批量并发生成释义 → 存本地 + 推欧陆
│   │   └── review.js        # 两栏复习浮窗
│   ├── settings/dialog.js   # ⚙ key 设置弹窗
│   ├── store/db.js          # IndexedDB（library / vocab / batches，v2）
│   └── platform/index.js    # 文件选择 + isTauri / isTouch
└── docs/
    ├── IMPLEMENTATION.md    # ★ 所有逻辑详解（先读这个）
    └── architecture.md      # 早期设计权衡与路线（A/B/C 方案对比）
```

---

## 文档导航

- **[docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md)** —— **as-built 全部逻辑详解**：数据流、每个模块职责、批量管线、触屏模型、IndexedDB schema、三个关键坑。**换新电脑 clone 后先读它。**
- [CHANGELOG.md](CHANGELOG.md) —— 每一次更新的日志。
- [docs/architecture.md](docs/architecture.md) —— 立项期的方案权衡（历史参考，非现状）。
- [TECHNICAL-PLAN.md](TECHNICAL-PLAN.md) —— 最初的 14 天 MVP 计划（历史）。

---

## 部署

- **前端**：推到 `main` 自动触发 GitHub Actions（`.github/workflows/deploy.yml`）→ 构建（`BASE_PATH=/context-vocab-reader/`）→ 发布到 GitHub Pages。在线地址见顶部。
- **无需后端/代理**：DeepSeek、欧陆均支持网页直连，纯静态站即可。

## 在平板上使用

1. 用 Safari / Chrome 打开在线地址 → 分享 → **添加到主屏幕**（全屏独立 App）。
2. 点 **⚙**：填 DeepSeek key、欧陆 token。
3. 点 **📂** 从「文件」App 选 PDF / EPUB。
4. **单击单词查词** / EPUB **左右滑动翻页** + 底部调字号·行距·主题 / 右上「批量」进批量模式。

## 技术栈

Vite + 原生 JS（无框架/TS/Tailwind，刻意与扩展保持一致） · pdfjs-dist · epubjs · idb · dompurify · @mozilla/readability（已装未用）· vite-plugin-pwa。

## License

MIT
