# Changelog

本项目所有值得记录的更新都写在这里（最新在上）。逻辑细节见 [docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md)。

格式参考 [Keep a Changelog](https://keepachangelog.com/)；日期为本地时间。

---

## [0.1.5] - 2026-08-14 · PDF 打开是空白页

一整轮「PDF 能选、能进加载、但页面上什么都没有」的修复。四个独立原因，共同表现都是**空白页配一个说加载成功的状态栏**。

### Fixed
- **pdfjs 无条件调用的新 builtin 缺失 → 字体整体不画（本轮主因）**：pdfjs-dist 5.7 直接调 `Math.sumPrecise` / `Map.prototype.getOrInsertComputed` / `WeakMap.prototype.getOrInsertComputed`，**无特性检测无 fallback**。Chrome 151（V8 15.1）全有，**Edge 140（V8 14.0）一个都没有**（Node 24 也没有）。其中 `Math.sumPrecise` 位于 pdf.js 的**字体重建**路径（`TrueTypeTableBuilder` 的 glyph `getSize()`、`name` 表 `exactLength`）——一 throw 该字体就加载失败，而 pdf.js 只把它记成 **warning**，于是用该字体绘制的每个字都不画。原 `map-upsert-polyfill.js` 只补了三者中的一个（且只补 `Map`，漏了 XFA 用的 `WeakMap`）。现扩成 `pdf/pdfjs-polyfills.js` 补齐全部，**两个 realm 各装一次**（打过补丁的 prototype 不跨 worker 边界）。
  - 量化验证：Edge 140、固定 1000px 视口、同一份中英混排 PDF，非白像素 **162 077（12.23%）→ 225 066（16.98%）**，与 Chrome 151 **逐像素一致**，worker 报错清零。
  - 影响程度取决于字体：Latin 字体多半能 fallback 替代（像素几乎不变），**CJK/CID 嵌入字体无可替代 → 直接不画**。
- **CJK 字形空白**（`adbcd9e`）：pdf.js 运行时才按需拉 CMap 表与 14 个标准字体文件，缺了就报 "Ensure that the `cMapUrl` API parameter is provided" 并把这些字形画空。`vite.config.js` 新增 `pdfjsRuntimeAssets` 插件把两个目录挂到 `/pdfjs/`（dev 用中间件、build 时 `cpSync` 进 dist），`render.js` 传 `cMapUrl`/`cMapPacked`/`standardFontDataUrl`，并用 `BASE_URL` 兼容 GitHub Pages 子路径。2.3 MB 不进 PWA 预缓存，按需拉取。
- **首页失败被静默**（`b962603`）：原先每页都在游离的 async 回调里渲染，第 1 页渲染失败也照样报「加载成功」，用户只看到白页。现在第 1 页**同步 await**、错误直接冒泡到 `loadFile()` 的 catch，状态栏显示真实原因。
- **worker realm 漏打补丁**（`bc5f123`）：Map upsert 补丁在主线程装了但 worker 里没装。补丁过的 prototype 不跨 worker 边界，所以 `pdf/worker-entry.js`（我们塞给 `workerSrc` 的自定义 ES module 入口）必须再装一次。

### 验证
用 CDP 直连无头 Chrome 151 / Edge 140 驱动真实构建产物（非 dev server），按用户真实路径投放文件（合成 `DataTransfer` + `drop` 事件），断言**canvas 上真的有非白像素**而不只是 DOM 存在；每次运行换全新 profile，避免 PWA service worker 用旧构建的资源清单污染结果。覆盖：中英混排简历（1 页，含嵌入 CJK 字体）、扫描版 15 页 / 498 页 / 555 页大书（最大 137 MB，验多页懒加载）。已知**未能复现**的情形见下。

- **陈旧 PWA 缓存把应用锁死（线上实际报的那条）**：报错原文 `加载失败: Setting up fake worker failed: "Failed to fetch dynamically imported module: …/assets/pdf.worker.min-iDqQPrd3.mjs"`。根因是 `globPatterns` 漏了 **`mjs`**：早期构建的 worker 被输出成 `pdf.worker.min-<hash>.mjs`，**不匹配该列表 → 从未进 precache**；而同一构建的 `index.html` + `index-*.js`（`.html`/`.js`）**进了 precache**。于是装过旧版的浏览器手握一套完整缓存的 app shell，它引用的 worker 既不在缓存里、又在后续部署中被删除 —— **持久性 404，不是一次加载的竞态**，刷新也不一定救得回来（被服务的正是那份缓存 shell）。两处修复：
  1. `vite.config.js` 的 `globPatterns` 加入 `mjs`，让「已缓存的 shell 引用未缓存、且可被删除的资源」这个组合不再可能出现。（当前构建的 worker 已是 `worker-entry-*.js`，本身已进 precache。）
  2. `main.js` 新增自愈：`loadFile` 捕到这类「动态导入的模块拉不到」错误时，注销 service worker + 清空 caches 后**重载一次**（`sessionStorage` 上锁，每标签页只做一次，杜绝重载循环），下一次加载直接走网络拿到当前部署。
  - **局限**：自愈代码得先被缓存下来才能生效，所以**救不了已经卡在旧 shell 上的客户端** —— 那种情况只能手动清站点数据（iPad：设置 → Safari → 高级 → 网站数据 → 删除本站；已加到主屏的话删掉图标重加）。

### 已知未解
- 上述都不能解释「**整页 100% 全空**」——本机在 Chrome / Edge、4 份 PDF 上都无法复现完全空白，最坏情况是丢 39% 的字。若真机上仍是全空，需要抓状态栏原文再定位。

---

## [0.1.4] - 2026-06-03 · 简化（移除代理）

### Changed
- **去掉 Cloudflare Worker 代理，改为直连**：实测 DeepSeek（`api.deepseek.com`）与欧陆（`api.frdic.com`）都支持网页跨域、且国内可直连，**不需要任何代理/后端**。删除了 `worker/` 目录、⚙ 里的「代理 URL」字段，以及 `api.js` 的代理逻辑（`worker_url`/`workerBase`）。`*.workers.dev` 在中国大陆不稳定/常被墙，直连更可靠也更省事。

---

## [0.1.3] - 2026-06-03 · 修复

### Fixed
- **EPUB 批量模式标记错词（标到下一个词）**：批量标记原先依赖「触摸后浏览器合成的 click」坐标，在 EPUB iframe 里（尤其 iPad Safari）会偏到相邻的下一个词；而单词查询用的是触摸坐标、是对的。现批量模式改用与单词查询**完全相同的触摸坐标路径**（`gesture` 的 `onMarkTap` → `controller.markAt`），并 `preventDefault` 抑制合成 click 防止双触发。实测：同一次真实触摸下，批量标记与单词查询命中**同一个词**。

---

## [0.1.2] - 2026-06-03 · 修复

### Fixed
- **代理 URL 漏填 `https://` 导致 DeepSeek 405**：若 ⚙「代理 URL」只填了 `xxx.workers.dev`（无协议），浏览器把它当**相对路径**，请求实际打到静态站点（GitHub Pages）→ 返回 405 而非到达 Worker。`api.js` 的 `workerBase()` 现自动补 `https://`。

---

## [0.1.1] - 2026-06-03 · 修复

### Fixed
- **EPUB 加载后空白**：epubjs 在 flex 容器里用 `height:"100%"` 会把章节 iframe 塌成 0 高度（书已载入但什么都看不到，线上实测 viewer 777px 而 iframe 0px）。`epub/render.js` 改为**等一帧布局稳定后用显式像素尺寸** `renderTo`，并在旋转/窗口缩放时 `refit`。实测 iframe 恢复 696px、目录正常显示。

### Added
- **拖拽加载**：可把 PDF/EPUB 直接拖到窗口（桌面便利）；触屏仍用 📂 按钮（拖拽不可用）。

---

## [0.1.0] - 2026-06-02 · 平板优化打磨（首个发布版）

第一个打了 tag 的版本。整合了逐词查询、批量模式、平板触屏，并补齐了一轮平板体验打磨。

### Added
- **PDF 懒加载渲染**（`pdf/render.js`）：先给每页铺正确尺寸的占位 `.pdf-page`，再用 IntersectionObserver（rootMargin ~150%）只渲染视口附近页的 canvas+文本层。大文件秒开、内存有界；标记/查词在已渲染页正常（=用户能看到的页）。
- **EPUB 阅读设置**（新 `src/epub/reading.js`）：字号 A−/A+、行距循环、亮/暗/护眼主题切换；用 epubjs themes API，存 localStorage 跨书跨会话生效；控件在底部 nav，与正文 letterbox 背景同步。
- **PWA iOS/Android 图标**：生成 192/512（含 maskable）/apple-touch-180 PNG，写入 manifest + `apple-touch-icon` link，「添加到主屏」不再模糊。

### Changed
- **安全区 + 触摸细节**（`style.css`）：工具栏/EPUB nav 用 `env(safe-area-inset-*)` 避刘海与圆角；`#reader-main` 等加 `touch-action: manipulation` 去掉双击缩放 300ms 延迟（保留 pan/pinch/选择）；`overscroll-behavior: none` 防下拉刷新干扰阅读。
- EPUB nav 改 `flex-wrap` 以容纳阅读控件。

### 验证
chrome-devtools 触屏模拟：PDF 懒加载（5 页文档加载时仅渲染近视口 3 页，滚动后补齐）、标记仍 deltaX/W=0；EPUB 阅读控件 44px、切主题 viewer 背景同步 `#15151f`、设置持久化；触摸目标/安全区生效。EPUB 正文样式因 epubjs 在无头环境不渲染未能可视验证（同既有局限，真机生效）。

---

## 2026-06-02 · 平板 / 触屏支持

横竖屏都优化，目标符合平板使用习惯。桌面鼠标行为保持不变。

### Added
- `src/lookup/gesture.js`：触屏手势分类器（touch 事件），把单指交互分成 选词 / 滑动 / 点击 / 滚动 并路由。
- **单击单词即查**（Kindle 式）：`mark.js` 新增 `resolveWordAtPoint`（非变更）和 `wordContextAtPoint`，复用 caret/词/上下文/坐标，直接开面板（只读，不插标记框）。
- **批量模式触屏入口**：工具栏 `#batch-btn` 切换按钮（带激活高亮）+ 批量横幅上的「完成」按钮。`createBatchController` 增 `onActiveChange` 回调。
- **EPUB 左右滑动翻页**；EPUB 每章 iframe 在 `rendition.on('rendered')` 重绑 tap+swipe 手势。
- `platform/index.js` 导出 `isTouch`（手势仅触屏绑定）。
- 响应式 CSS：`@media (hover:none)(pointer:coarse)` 44px 触摸目标、`:active`/`:focus-visible`、复习窗竖屏堆叠、面板 `min(340px,92vw)`。

### Changed
- `pdf/render.js`：`RENDER_SCALE` 固定 1.5 → **按容器宽自适应** `fitScale`（clamp 0.75–2.0）+ canvas backing store ×min(dpr,2) 保清晰；`--total-scale-factor` 维持 = CSS scale 以保标记对齐。
- `epub/render.js`：横屏 `spread:'auto'`（双页）/ 竖屏 `'none'`（单页）+ 旋转重排。
- `panel.js`：`PANEL_W` 定位常量改为 `min(340, innerWidth*0.92)`，与 CSS 同步。

### 验证
chrome-devtools 触屏模拟实测：tap 查词、批量 tap 只标记不查词（互斥）、PDF 自适应不溢出且标记 deltaX/W=0、EPUB swipe 翻页；桌面回归 FAB 正常。
**局限**：EPUB 正文 tap 查词在自动化环境无法验证（epubjs headless 下 iframe 高度=0，caret 解析失败），与已验证的 PDF 路径同构，建议真机验证。

---

## 2026-06-02 · PDF 文本层对齐修复 + 叠印去重（Tier-2）

### Fixed
- **PDF 文本层与 canvas 错位（长期存在，影响划词选区和批量标记）**：`pdf/render.js` 现设 `--total-scale-factor`，`style.css` 补齐 pdf.js v5 的 span 规则（`font-size`/`scaleX` 从 CSS 变量算）。修复后标记覆盖框/选区与字形像素级对齐。

### Added / Changed
- **批量标记改为 Tier-2 覆盖框（PDF）**：`mark.js` 不再包裹 pdf.js 的 `scaleX` span（会毁几何），改为按 `range.getClientRects()` 画绝对定位 `.batch-mark-overlay`；EPUB 仍用包裹。
- **文字叠印去重**：`pdfBlockRecord` 按 文本+位置（~2px 桶）丢弃同位置重复 run，使复习/AI 文本不翻倍。不规则字形级叠印不彻底（已知局限）。

---

## 2026-05-29 · 批量模式（批量模式）

高生词密度阅读：先沉浸读、点词标记，结束后批量生成释义并进两栏复习窗。

### Added
- `src/batch/mode.js`（状态机 + 入口 + 横幅）、`mark.js`（点→词→块 + 标记）、`pipeline.js`（并发生成→存本地+推欧陆）、`review.js`（两栏复习窗）。
- IndexedDB **升级到 v2**：新增 `batches` store + `vocab.batchId` 索引；`appendVocab` 返回新 id。
- `panel.js` 抽出并导出 `renderResultInto`，供复习窗右栏复用（与逐词面板同版式）。
- `capture.js` 导出 `findBlockAncestor` / `findAncestorMatching` / `extractContext`。
- 入口：`Alt+B` 快捷键 + 右键自定义菜单（桌面）。

---

## 2026-05-24 ~ 28 · 逐词查询闭环 + EPUB + 代理 + PWA

把扩展的查词体验移植到 Reader，跑通端到端。

### Added
- `lookup/capture.js`（选区→词+上下文+坐标）、`lookup/panel.js`（浮窗+面板）、`lookup/api.js`（DeepSeek 释义 + 5 级 JSON 容错 + 欧陆两步存词）。
- `epub/render.js`（epubjs 分页渲染 + 进度 CFI）。
- `store/db.js`（IndexedDB：`library` + `vocab`）、`settings/dialog.js`（key 设置）、`platform/index.js`（文件选择 + Tauri 适配）。
- `worker/worker.js`：无状态 Cloudflare 代理（DeepSeek + 欧陆 CORS）。
- PWA（vite-plugin-pwa，`display: standalone`）。

---

## 2026-05-23 · 初始脚手架

### Added
- Vite + 原生 JS 脚手架；装好 pdfjs-dist / epubjs / @mozilla/readability / dompurify / idb。
- `TECHNICAL-PLAN.md`（14 天 MVP 计划）。
- PDF.js text-layer 选区 POC（`pdf/render.js` canvas + 透明文本层）。
