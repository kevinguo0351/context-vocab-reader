# Changelog

本项目所有值得记录的更新都写在这里（最新在上）。逻辑细节见 [docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md)。

格式参考 [Keep a Changelog](https://keepachangelog.com/)；日期为本地时间。

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
