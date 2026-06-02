# Context Vocab Reader — 架构与路线图

> ⚠️ **这是立项期（2026-05）的方案探索与决策文档（路线 A/B/C 对比），不是现状描述。**
> 实际实现走的是路线 A（PDF.js canvas + epubjs iframe）并在其上加了批量模式与平板触屏；
> **当前代码到底怎么跑，请读 [IMPLEMENTATION.md](IMPLEMENTATION.md)。** 本文保留作设计权衡参考。

> 范围：PC + iPad + Android 平板三端阅读器，核心功能是**划词 + 上下文 + DeepSeek 释义 + 一键存欧陆**。
> 主要内容是**文本型 PDF 和 EPUB**（不做扫描件 OCR，不做手写）。

---

## 1. 需求清单（按优先级）

### P0 · 核心闭环（必做）
1. 加载本地 PDF / EPUB 文件
2. 滚动 / 翻页阅读，进度可保存可恢复
3. 划词捕获（含前后 ~300 字上下文）
4. DeepSeek 释义面板（含「字典释义」+「在这段里的意思」+「记忆点」）
5. 一键存到欧陆（带语境笔记）
6. 本地词库（IndexedDB），可导出
7. API key 设置界面，纯本地存储

### P1 · 跨平台与体验
1. iPad 可用（Safari / 装到主屏 / 原生壳，三选一即可）
2. Android 平板可用（Chrome / 装到主屏 / 原生壳）
3. PC Windows 双击打开 `.pdf` `.epub` 直接进 app
4. 离线打开已读过的书
5. 触摸选词无原生菜单干扰
6. 字号 / 行距 / 主题切换（EPUB 专属）

### P2 · 打磨
1. 多本书的"书架"页
2. 词库导出 CSV / Anki tsv
3. 跨设备同步（要后端）
4. iOS 原生包（要 Mac）

### 显式不做
- 扫描件 OCR
- 笔记 / 高亮标注（先专注查词流）
- 多人 / 共享 / 社交
- DRM 保护的 EPUB（calibre 路线也搞不定）

---

## 2. PDF / EPUB → HTML 的可行方案

### 2.1 EPUB → HTML：本质上是免费午餐

EPUB **本身就是 HTML/XHTML 文件压缩成 zip**，标准结构：

```
book.epub  (ZIP)
├── META-INF/container.xml
├── OEBPS/
│   ├── content.opf      ← 章节清单 + 阅读顺序
│   ├── toc.ncx / nav.xhtml  ← 目录
│   ├── ch01.xhtml       ← 真正的内容，HTML
│   ├── ch02.xhtml
│   ├── styles.css
│   └── images/...
```

任何一个 EPUB 阅读器内部做的事都是：解压 → 按 spine 顺序拼章节 → 渲染 HTML。

**可选实现：**

| 方案 | 思路 | 评价 |
|---|---|---|
| **epub.js**（已用） | 解压 → 渲染到 iframe，提供翻页+CFI 定位 | ⭐⭐⭐⭐ 现状，缺点是 iframe 沙箱让选词复杂 |
| **JSZip + 自己拼** | 解压 → 把所有章节 HTML 串起来贴到主 DOM | ⭐⭐⭐⭐⭐ 选词最丝滑，CSS 隔离要自己处理 |
| **calibre 转换** | 服务端 / 离线转纯 HTML 单文件 | ⭐⭐ 适合归档，不适合 app |

**关键洞察**：如果换成"自己拼章节贴主 DOM"的方案，选词逻辑就和普通网页没区别，触摸选词在 iPad/Android 上是浏览器原生体验——这正是当前 EPUB iframe 路线最大的痛点修复。代价是要写一个轻量 EPUB 解析器（~150 行）和 CSS 隔离层（用 Shadow DOM 或 prefix-css）。

### 2.2 PDF → HTML：保真度 vs 简单度

PDF 不是 HTML，强行转一定会损失。但对**文本型 PDF**，损失可以小到看不见。

| 工具 | 输出 | 浏览器内可跑？ | 评价 |
|---|---|---|---|
| **PDF.js**（已用） | canvas + 透明 text layer | ✅ | 视觉 100% 还原，文本能选；当前方案 |
| **PDF.js + getTextContent** | 仅 HTML（丢图丢版式） | ✅ | 提取每页文本，自己排——读小说够，论文丑 |
| **pdf2htmlEX** | 极保真 HTML+CSS（每个字一个 span） | ❌ 命令行 | 输出最像原 PDF，但文件巨大、CSS 复杂 |
| **mupdf wasm** | HTML 或图片 | ✅ wasm | 性能比 PDF.js 好，API 没那么成熟 |
| **poppler `pdftohtml`** | 简陋 HTML | ❌ 命令行 | 老工具，输出粗糙 |
| **MinerU / marker / nougat** | 结构化 markdown / HTML | ❌ Python+GPU | AI 路线，质量最好但重，学术论文专用 |

**关键洞察**：
- 你不需要保版式——读文本型 PDF 看的是文字本身。**`PDF.js + getTextContent` 直接组装 HTML** 是最朴素也最够用的路线。
- 副作用：转出来的 HTML 没有原 PDF 那种"分页感"。对小说和散文是好事；对论文（多栏 / 公式 / 图表）会塌缩。
- 转一次缓存进 IndexedDB，下次秒开。

### 2.3 转换时机的三种策略

```
A. 实时渲染（现状）         加载 → PDF.js/epub.js 边读边渲
B. 上传时转 HTML            加载 → 后台转 HTML → 缓存 → 之后纯 HTML 读
C. 离线预转换 / 服务端       用户上传到服务器 → 后端转 → 客户端只读 HTML
```

A 是现在的样子。B 是这次想探讨的"换皮成纯 HTML 阅读器"。C 需要后端，超出 MVP 范围。

---

## 3. 三条主架构对比

### A. 当前路线：Web SPA + 在线渲染 + (可选) Tauri 壳

```
┌─────────────────────────┐
│ Vite SPA                │
│  ├─ PDF.js 渲染 PDF     │  ← canvas + text layer
│  └─ epub.js 渲染 EPUB   │  ← iframe per chapter
└────────┬────────────────┘
         ├─→ 浏览器 / PWA（三端）
         └─→ Tauri 壳（PC .msi / Android .apk）
```

**优点**：现状，已 Phase 0 完成。
**缺点**：iframe 选词麻烦，PDF.js worker ~2MB，触摸 UX 要打补丁。
**Tauri 加成**：CORS 绕开、文件关联、原生窗口。
**代价**：Rust 工具链（~3GB 安装），会增加构建复杂度。

### B. 转换路线：上传时转 HTML，纯 HTML 阅读器

```
┌─────────────────────────────────┐
│ Vite SPA                        │
│ ┌──────────────┐                │
│ │ Convert      │ ← 用 PDF.js 或自写  │
│ │ - PDF→HTML   │   EPUB 解析器一次性   │
│ │ - EPUB→HTML  │   产出纯 HTML       │
│ └──────┬───────┘                │
│        ↓ IndexedDB 缓存          │
│ ┌──────┴───────┐                │
│ │ HTML Reader  │ ← 一个 <article>，CSS 控制    │
│ │  + 划词      │   字号/暗色，划词 = 普通选词  │
│ └──────────────┘                │
└────────┬────────────────────────┘
         ├─→ 浏览器 / PWA（三端，触摸丝滑）
         └─→ 不需要 Tauri 也能用得很好
```

**优点**：
- 选词在主 DOM，触摸 UX 和普通网页一样
- 没有 iframe 沙箱跨边界拿选区的怪招
- HTML 可以缓存，二次打开秒开
- 字号 / 行距 / 暗色主题就是 CSS 一行的事
- **可能完全跳过 Tauri**——PWA 装到主屏就够好用

**缺点**：
- 复杂版式 PDF（双栏论文、表格、公式）转出来塌
- 写转换代码（PDF：~200 行，EPUB：~150 行）
- 长 PDF 转换耗时（10MB 论文 ~5–15 秒），需要进度反馈
- 图片要单独提取并转 base64 或 blob URL

**适用门槛**：你的目标是读小说和文本散文/文章，**版式不重要**——B 是正解。

### C. Tauri 路线（已规划的 Phase 1/2）

```
SPA 不变 + Rust 壳 + 文件关联 + 原生 dialog
       ↓
  Windows .msi
  Android .apk
  iOS .ipa（需要 Mac）
```

**优点**：原生体验顶配，文件关联，CORS 自动绕开，本地缓存最自然。
**缺点**：~3GB Rust 工具链；每次发版要打三种平台；调试链路更长。
**Tauri 是 A 或 B 的可选打包层**——它不是和 A/B 互斥，而是在它们之上的一层壳。

---

## 4. 推荐路径

> **B 优先 + Tauri 可选**

### 阶段 0（已完成）
- ✅ Vite SPA 骨架
- ✅ epub.js + PDF.js 在线渲染
- ✅ 划词 + 面板 + DeepSeek + Eudic
- ✅ IndexedDB 库 + 进度
- ✅ PWA
- ✅ Cloudflare Worker 代理

### 阶段 1（建议改：B 路线）
1. 写 `src/convert/epub-to-html.js`（~150 行）
   - 用 JSZip 解压 EPUB
   - 按 spine 顺序合并章节 HTML
   - 用 Shadow DOM 或 CSS scope 隔离样式
   - 内部图片转 blob URL
2. 写 `src/convert/pdf-to-html.js`（~200 行）
   - 用 PDF.js `getTextContent()` 抽每页文本
   - 简单段落聚合：基于 y 坐标判断换行/换段
   - （可选）`getOperatorList()` 抽页面图片
3. `src/reader/html-reader.js`
   - 简单 article + CSS（字号、行距、主题）
   - 沿用现有 `capture.js` 中 block-ancestor 路径，PDF 旧路径退役
4. 缓存：IndexedDB 加 `bookContent` store，按 bookId 存转换后的 HTML
5. 进度：scrollTop 或 章节 anchor

### 阶段 2（按需要才做）
- **如果浏览器/PWA 体验已经够**：完全跳过 Tauri，省 ~2 周时间
- **如果要文件关联 / 离线启动 / 资源占用更少**：Tauri 壳可以加，工程量比 A 路线下加更小（B 的前端已经平台无关）

### 阶段 3（远期）
- 词库导出 CSV / Anki
- 跨设备同步（接一个简单后端）
- iOS 包（找台 Mac）

---

## 5. 端别的具体打法

### PC（Windows）
- 浏览器即用：`npm run build && npm run preview`，火狐 / Edge 都行
- PWA："安装"到桌面，独立窗口运行
- Tauri：双击 `.pdf` 关联打开（仅这个值得为之装 Rust）

### iPad
- Safari 加到主屏 → 全屏阅读体验
- 触摸选词原生菜单：B 路线下没问题；A 路线 EPUB iframe 内会跳原生菜单干扰浮动按钮
- 离线：PWA service worker 缓存 + IndexedDB 缓存转换后 HTML
- 文件来源：Files.app → 分享到 Safari → 拖进页面

### Android 平板
- Chrome 加到主屏 → standalone 模式
- 触摸选词：同 iPad
- 文件来源：文件管理器 → 浏览器选文件
- Tauri Android：可选，需要 Android Studio + Rust

---

## 6. 风险与已知限制

| 风险 | 影响 | 缓解 |
|---|---|---|
| 复杂版式 PDF 转 HTML 塌 | 论文用户体验差 | 检测页面布局，复杂的 fallback 到当前 PDF.js canvas 模式 |
| 长 PDF 转换慢 | 首次打开等待长 | Web Worker 异步转 + 进度条 + 缓存 |
| EPUB 内联 CSS 冲突 | 排版样式乱 | Shadow DOM 隔离 |
| Eudic / DeepSeek 限流 | 高频用户被拒 | 请求节流 + 错误重试 + 本地排队 |
| iOS PWA 容量限 | 大书库放不下 | 检测 quota，提示用户 |
| DRM EPUB | 打不开 | 明确说明不支持 |

---

## 7. 决策结论

**优先方向**：把"PDF/EPUB → HTML 转一次"的方案做出来（路线 B），让阅读器变成一个**纯 HTML article 的查词工具**。

理由：
1. 触摸 UX 一步到位（小说类用户主要在平板上读）
2. 浏览器/PWA 即终态，**可以不用 Tauri**——最大化"代码简单"目标
3. 离线缓存逻辑统一（HTML 文本，不是 PDF 字节）
4. EPUB 本身就是 HTML，转换几乎免费；PDF 的损失对你的用例可接受

**不做**：
- 立刻继续 Tauri Phase 1（除非测出来 PWA 在某个端有 hard blocker）

**保留可选**：
- Tauri 作为以后的打包层，前端代码不会因为换路线作废

---

## 附录 A · 关键开源项目链接

| 项目 | 用途 | 地址 |
|---|---|---|
| PDF.js | PDF 渲染与文本抽取 | https://github.com/mozilla/pdf.js |
| epub.js | EPUB 渲染（在用） | https://github.com/futurepress/epub.js |
| JSZip | EPUB 解压（替代 epub.js 的核心） | https://github.com/Stuk/jszip |
| pdf2htmlEX | PDF → 高保真 HTML（CLI） | https://github.com/coolwanglu/pdf2htmlEX |
| MinerU | AI 驱动 PDF→Markdown | https://github.com/opendatalab/MinerU |
| marker | PDF→Markdown via deep learning | https://github.com/VikParuchuri/marker |
| Tauri 2 | 跨平台原生壳 | https://tauri.app |
