# 实现详解（as-built）

> 这份文档描述**当前代码实际是怎么跑的**——换电脑 clone 后读这一篇就能接上。
> 设计期的方案权衡见 [architecture.md](architecture.md)（历史参考，非现状）。

---

## 0. 一句话架构

纯前端 Vite SPA：`#reader-main` 里渲染 PDF（canvas + 透明文本层）或 EPUB（epubjs iframe）。用户**划词/点词** → 抓「词 + 前后 ~300 字上下文」→ 调 **DeepSeek** 出中文释义 → 存 **欧陆**（远程）+ **IndexedDB**（本地）。跨域由可选的 **Cloudflare Worker** 透明代理解决。**批量模式**把「逐词查」换成「先标记、后统一生成、再复习」。**触屏层**让上述在平板上也成立。

```
                 ┌───────────────── main.js（装配一切）─────────────────┐
 加载文件 ──▶ pdf/render.js  或  epub/render.js
                 │                                                       │
 鼠标划词 ─ capture.js ─┐                          ┌─ panel.js（浮窗+面板）
 触屏手势 ─ gesture.js ─┼─▶ {word, context, rect} ─┤
 点词查词 ─ mark.js ────┘                          └─▶ api.js ─▶ DeepSeek
                                                              │
                                          renderResultInto ◀──┘
                                                   │
                                  存欧陆 saveToEudic ─┐
                                  存本地 appendVocab ─┴─▶ store/db.js (IndexedDB)

 批量：mode.js（状态机）── mark.js（标记）── pipeline.js（并发生成）── review.js（两栏复习）
```

---

## 1. 模块地图（每个文件干什么）

| 文件 | 职责 | 关键导出 |
|---|---|---|
| `main.js` | 入口。装配查词链路、批量控制器、触屏手势、加载文件、EPUB 事件绑定。持有 `currentBook` / `currentRendition`。 | — |
| `pdf/render.js` | PDF→每页 `canvas`（视觉）+ `.textLayer`（透明可选文本）。**按容器宽自适应缩放** + **懒加载**（占位 div + IntersectionObserver 按需渲染）。 | `renderPdf` |
| `epub/render.js` | EPUB→epubjs `rendition`（分页 iframe）。翻页按钮、方向键/滑动、**spread 按横竖屏**、进度（CFI）、挂载阅读设置。 | `renderEpub` |
| `epub/reading.js` | EPUB 阅读设置：字号/行距/主题（epubjs themes API），存 localStorage，控件在 nav。 | `setupReadingControls` |
| `lookup/capture.js` | 从**选区**构造 `{word, context, page, rect}`。块祖先查找、上下文截取、iframe→父文档坐标换算。 | `setupCapture`, `captureSelectionInWindow`, `extractContext`, `findBlockAncestor`, `findAncestorMatching`, `parentDocRect` |
| `lookup/gesture.js` | **触屏手势分类器**：把单指交互分成 选词/滑动/点击/滚动 并路由。 | `setupReaderGestures` |
| `lookup/panel.js` | 浮起「✦查词」按钮 + 释义面板（词性/释义/语境义/记忆点/词典外链/存欧陆）。`renderResultInto` 被复习窗右栏复用。 | `showButton`, `openPanel`, `dismissAll`, `installPanelLifecycle`, `renderResultInto` |
| `lookup/api.js` | DeepSeek 调用（含 5 级 JSON 容错）+ 欧陆两步存词 + key 读写。 | `lookupWord`, `saveToEudic`, `getKeys`, `setKeys` |
| `batch/mode.js` | 批量模式**状态机**：进/出入口（工具栏按钮 / Alt+B / 右键）、横幅 + 完成按钮、点击标记分发、EPUB 每章重绑。 | `createBatchController`, `isBatchActive` |
| `batch/mark.js` | **点→词→块**核心：caret 命中、单词边界扩展、块文本（PDF 去叠印）、标记渲染（PDF 覆盖框 / EPUB 包裹）、**点词查词** `wordContextAtPoint`。 | `markWordAtPoint`, `resolveWordAtPoint`, `wordContextAtPoint`, `findMarkElAtPoint`, `cleanupMark` |
| `batch/pipeline.js` | 批量结束后：去重 → 并发限流生成释义 → `appendVocab`(+batchId) → `saveToEudic`。 | `runBatch` |
| `batch/review.js` | 两栏复习全屏浮窗（左 70% 重排文章+内联释义，右 30% 复用面板）。流式回填。 | `openReview` |
| `settings/dialog.js` | ⚙ 三个 key 输入弹窗 → `setKeys`。 | `openSettings` |
| `store/db.js` | IndexedDB 封装。`library` / `vocab` / `batches`（v2）。 | `upsertBook`, `updateProgress`, `getProgress`, `appendVocab`, `listVocab`, `createBatch`, `getBatch`, `updateBatch` |
| `platform/index.js` | `pickFile()`（浏览器 input / Tauri 原生）；`isTauri`、`isTouch` 能力检测。 | `pickFile`, `isTauri`, `isTouch` |

**依赖方向**：`mark.js → capture.js`（单向，不可反向，否则循环）。`panel.js` 不依赖 batch。

---

## 2. 逐词查询链路（普通模式）

### 2.1 触发 → 抓词
- **桌面 PDF**：`setupCapture(main, onCapture)` 监听 `mouseup` → `captureSelectionInWindow(window, {rootSelector:'.textLayer'})`。
- **桌面 EPUB**：`rendition.on('selected')`（epubjs 给 CFI + iframe contents）→ `captureSelectionInWindow(contents.window)`。
- **触屏**（`isTouch` 才绑）：`gesture.js` 分类——
  - **点击**单词 → `wordContextAtPoint(win, x, y)`（mark.js，**不改 DOM**，复用 caret/词/`extractContext`/`parentDocRect`）→ 直接 `openPanel`（Kindle 式，无浮窗按钮）。
  - **拖拽选中** → 走 `captureSelectionInWindow` → 浮窗按钮（与桌面一致）。

抓词产物统一是 `{ word, context, page, rect, selectedAt }`：
- `context` = `extractContext(blockText, word)`：在块文本里找到词，取前后各 300 字（`CONTEXT_BEFORE/AFTER`），首尾加 `…`。
- `rect` = `parentDocRect(win, range)`：把 range 的视口矩形换算到**父文档坐标**（EPUB 在 iframe 里时加上 iframe 偏移），让浮窗 UI 定位一致。
- 块祖先：PDF 用 `.textLayer`（整页一个块），EPUB 用最近的块级标签（`<p>/<section>/…`）。

### 2.2 面板 + DeepSeek
- `openPanel(data, {onLookup, onSave})`：先建面板骨架（显示词 + loading），立刻 `onLookup({word, context})`。
- `api.js#lookupWord`：POST 到 `deepseekUrl()`（有 `worker_url` 走 `<worker>/deepseek`，否则直连），模型 `deepseek-v4-flash`，`response_format: json_object`，`temperature 0.3`，`max_tokens 500`。System prompt 要求输出四字段：`meaning`（字典义 10–30 字）/`in_context`（结合上下文 2–3 句）/`type`（词性）/`note`（记忆点）。
- `parseModelJson` **5 级容错**：①直接 parse ②去 ```` ```json ```` 围栏 ③抓第一个 `{…}` ④修中文引号 ⑤逐字段正则兜底。绝不把原始串塞进释义。
- `renderResult` → 内部调 `renderResultInto`（共享标记，复习窗右栏也用它）渲染：释义块 + 语境 callout + 记忆点 + 词典外链 + 存欧陆按钮。

### 2.3 存词（两路）
`main.js#onSave` 组合：
1. `saveToEudic(payload)`（api.js）——**两步**，见 [reference-eudic-openapi 记忆 / 下文 §7]：
   - `POST /studylist/word` `{language:'en', word, category_ids:[0]}`
   - `POST /studylist/note` `{language:'en', word, note}`（笔记单独一步；失败不致命，仅警告）
   - 笔记体 `buildNoteText`：`【此处含义】/【释义】/【词性】/【备注】/【原文】`，截断到 900 字。
   - 鉴权：`Authorization: <raw-token>`（**无 Bearer**）；401/403 时回退 `NIS <token>`。
2. 欧陆成功后 `appendVocab({...payload, sourceBookId, sourceBookName})` 镜像到本地 `vocab`。

---

## 3. 批量模式

### 3.1 状态机（`mode.js`，`createBatchController`）
- `isBatchActive()` 模块级布尔，供 `main.js` 廉价门控（普通查词在批量激活时让路）。
- **进入** `start()`：置 `_active`、新 `batchId`、清空 marks、`dismissAll()`、绑监听（PDF 在 `main`、EPUB 在每个 iframe 文档）、显横幅、`onActiveChange(true)`（工具栏按钮高亮）。
- **退出** `end()`：解析 marks → `buildBlocks()` → 清掉页面上的标记 DOM → `createBatch()` 落库 → `openReview()` 立即开窗（占位）→ `runBatch()` 流式回填。
- **入口三选一**：工具栏 `#batch-btn`（`batch.toggle()`）/ `Alt+B`（document keydown + epub keyup）/ 右键自定义单项菜单。**退出**：横幅「完成」按钮 / 同样的快捷键。
- **EPUB 每章重绑**：epubjs 每章换新 iframe，旧监听失效——在 `rendition.on('rendered')` 重绑 click/contextmenu（`WeakSet` 防重复）。

### 3.2 点→词→块（`mark.js`，核心）
- `caretFromPoint(doc,x,y)`：双特性检测 `caretPositionFromPoint`（FF/新 Chrome）/ `caretRangeFromPoint`（WebKit/旧）。只接受文本节点。
- `wordRangeAt`：在该文本节点内按 `WORD_RE=/[A-Za-z'’\-]/` 左右扩展成单词。
- `buildRecord`：拿块祖先；`blockText`：EPUB = `collapse(block.textContent)`；**PDF = `pdfBlockRecord`**（见 §6 去叠印）。`charStart/charEnd` = 词在 `blockText` 里的偏移（供复习左栏切片定位）。
- 标记渲染（`markWordAtPoint` = `resolveWordAtPoint` + 渲染）：
  - **PDF → 覆盖框（Tier 2）**：pdf.js 给 span 加了 `scaleX` transform，包裹子串会破坏几何 → 改为按 `range.getClientRects()` 在 `.textLayer` 内画绝对定位 `.batch-mark-overlay`（不改 DOM）。
  - **EPUB → 包裹（Tier 1）**：`range.surroundContents(<span class=batch-mark>)`，失败回退 `extractContents+insertNode`。
- 取消标记：`findMarkElAtPoint`（先看事件 target，再用 caret 兜底）→ `cleanupMark`（覆盖框删 div / 包裹解包 + normalize）。

### 3.3 并发生成（`pipeline.js#runBatch`）
- 按 `word.toLowerCase()` **去重**（保首次出现块作上下文源）。
- ~12 行 **promise 池**，并发 3：每词 `extractContext` → `lookupWord` → 成功则 `appendVocab(+batchId)` → 再 `saveToEudic`（**try/catch，失败不阻断**，按词记 `eudicOk`）。
- `onProgress(done,total,word,{parsed,vocabId,eudicOk,ctx})` 流式回调；结束回填 `marks[].vocabId` + `updateBatch(finishedAt)`。

### 3.4 两栏复习（`review.js#openReview`）
- 全屏浮层，`z-index` 顶格，Esc/×/点外关闭。横屏左右 70/30，竖屏堆叠（纯 CSS）。
- **左栏**：每块渲成 `<p class=batch-block>`，按 `[charStart,charEnd)`（排序、跳重叠）切片插标记框：词 + 下方 `.batch-gloss`（短中文释义，pending 时「…」）。点框选中 → 渲右栏。
- **右栏**：`renderResultInto(...)` 与逐词面板**同版式零重复**；显示该词欧陆状态（已存 / 重试「存欧陆」）。
- `onProgress` 把每词 gloss 填进左栏所有同词框，并在选中词就绪时刷新右栏。

---

## 4. 平板 / 触屏模型

### 4.1 手势分类器（`gesture.js#setupReaderGestures`）
**故意用 touch 事件而非 pointer 事件**——因为 tap 时要 `preventDefault()` 抑制「兼容鼠标事件」（见 §6 坑3）。仅在 `isTouch` 时绑定；桌面鼠标走原有划词路径，互不干扰。

`touchend` 时按**固定顺序**分类（阈值：移动≤10px、≤300ms 算 tap；横移>50px 且 |dx|>2|dy| 算 swipe）：
1. **选区非空** → DRAG-SELECT → `onSelect()`（仅 PDF；EPUB 选词交给 `on('selected')`，避免双发）。
2. **EPUB 且横向滑动** → SWIPE → `onSwipe(dir)` → `rendition.next/prev`。
3. **tap** → 若 `isBatchActive()` 直接 return（让合成 click 去标记）；否则 `preventDefault` + `onTap(x,y)` → 查词。
4. 否则 = 竖向滚动 → 忽略。

### 4.2 绑定点
- **PDF**：`main.js` 在 `main` 上绑一次（`isEpub:false`）。
- **EPUB**：`attachEpubGestures(rendition)` 在 `rendition.on('rendered')` 给每章 iframe 文档绑（`isEpub:true`，含 tap 查词 + swipe 翻页），`WeakSet` 防重复。

### 4.3 互斥（关键不变量）
普通模式 tap → 查词；批量模式 tap → 标记。靠**同一个 `isBatchActive()`**：
- `gesture.onTap` 仅 `!isBatchActive()` 时查词；
- `mode.onClick` 仅 `_active` 时标记；
- tap 走 `touchend`、标记走**合成 click**（真机 tap 自动产生），普通模式无人听 click、批量模式 onTap 提前 return —— **至多一条触发**。
- 点词查词只调 `wordContextAtPoint`（只读），**绝不**插标记框。

### 4.4 响应式（`style.css` 追加，不动旧规则）
- `@media (hover:none) and (pointer:coarse)`：按钮 ≥44px 触摸目标。
- 面板 `width: min(340px, 92vw)`（配 `panel.js` 的 `PANEL_W = min(340, innerWidth*0.92)` 同步）。
- 复习窗 `@media (orientation:portrait),(max-width:900px)` 竖向堆叠。
- 补 `:active`/`:focus-visible`（触屏无 hover）。

### 4.5 PDF 自适应缩放 + 懒加载（`pdf/render.js`）
- `fitScale` = `clamp((容器宽-32)/页面原始宽, 0.75, 2.0)` —— 替代原来写死的 1.5（会溢出窄屏）。
- canvas backing store = `cssViewport × min(dpr,2)` 保清晰，`style.width/height` 用 CSS 像素显示。
- **`--total-scale-factor` 仍 = CSS scale（不乘 dpr）**，否则文本层/标记框错位（见 §6 坑1）。
- **懒加载**：先用 page1 尺寸给每页铺正确尺寸的占位 `.pdf-page`（保证滚动高度正确），再用 `IntersectionObserver`（root=视口，`rootMargin:'150% 0px'`）在页面接近视口时才渲染该页的 canvas+文本层（渲染后 `unobserve` + `data-rendered` 防重复，并按该页真实尺寸校正占位）。200 页 PDF 秒开、内存有界。**只有渲染过的页（=用户看得到的页）能选词/标记**——符合直觉。

### 4.7 EPUB 阅读设置（`epub/reading.js`）
`setupReadingControls(rendition, viewer, nav)`：字号 A−/A+（80–220%）、行距循环（1.3/1.5/1.8/2.1）、主题循环（亮/暗/护眼）。用 epubjs `themes.register/select/fontSize/override`（epubjs 会自动应用到后续每章 iframe，故只需设一次 + 点击时更新）。设置存 localStorage（`epub_font`/`epub_lh`/`epub_theme`）跨书跨会话；切主题时同步 `.epub-viewer` 背景色（letterbox 边距配色一致）。

### 4.8 安全区 + 触摸细节（`style.css`）
工具栏/EPUB nav 用 `env(safe-area-inset-*)` 避刘海与圆角；`#reader-main` 与按钮 `touch-action: manipulation`（去 300ms 双击缩放延迟，保留 pan/pinch/选择）；`html,body { overscroll-behavior: none }` 防下拉刷新/回弹干扰阅读。

### 4.6 EPUB spread（`epub/render.js`）
横屏且宽≥800 → `spread:'auto'`（双页），否则 `'none'`（单页）；旋转时 `rendition.spread(...)` 重排。

---

## 5. IndexedDB schema（DB 名 `context-vocab-reader`，version 2）

```
library (keyPath "id" = `${name}|${size}`)
  { id, name, type:'pdf'|'epub', size, lastOpenedAt, addedAt, progress }   // progress: EPUB 是 CFI

vocab (keyPath autoinc "id"；索引 savedAt / word / batchId)
  { id, word, meaning, in_context, type, note, context,
    sourceBookId, sourceBookName, savedAt, batchId? }                       // batchId 仅批量模式词有

batches (keyPath "batchId")                                                 // v2 新增
  { batchId, bookId, bookName, host:'pdf'|'epub', createdAt, finishedAt,
    blocks:[ { blockId, text, marks:[ {word, charStart, charEnd, vocabId} ] } ] }
```
- `appendVocab` 返回新 autoinc id（pipeline 用它回填 `marks[].vocabId`）。
- v1→v2 迁移：`upgrade(d, oldVersion, _, tx)` 里建 `batches` store + 给 `vocab` 加 `batchId` 索引（旧行无该字段、不入索引，安全）。

---

## 6. 三个关键坑 / 不变量（改代码前必读）

### 坑1 · PDF 文本层缩放（最隐蔽）
pdf.js v5 把每个 span 的尺寸/缩放写成**内联 CSS 变量** `--font-height` / `--scale-x`，靠样式表从 `--total-scale-factor` 算出真正的 `font-size` 和 `transform: scaleX(...)`。**必须**两件事齐全，否则文本层退回 16px、无 scaleX，整层与 canvas 错位（划词选区**和**批量标记框都会偏）：
1. `pdf/render.js`：textLayer 容器设 `--total-scale-factor = CSS scale`。
2. `style.css`：照搬 pdf_viewer.css 的 span 规则（`font-size: calc(var(--text-scale-factor) * var(--font-height)); transform: rotate(...) scaleX(var(--scale-x)) scale(var(--min-font-size-inv))`）。

### 坑2 · PDF 文字叠印去重
某些 PDF（md→pdf 导出）把每个 run 画两遍 → 文本层文字翻倍。`mark.js#pdfBlockRecord` 按 **文本+位置（~2px 桶）** 给 span 编 key，丢弃同位置重复 run（合法重复词在不同位置、key 不同 → 保留，安全）。**局限**：不规则的字形级叠印（同处被切成长短不一的重叠 item）无法用 span 级安全去重，接受。

### 坑3 · 触屏 tap 的「兼容鼠标事件」
真机 tap 会在 `touchend` 后合成 `mousedown/mouseup/click`。若不拦，`panel.js#installPanelLifecycle` 的 document `mousedown` 关窗逻辑会把**刚开的面板秒关**。解法：`gesture.js` 在普通模式 tap 时 `preventDefault()`（抑制合成鼠标事件）；批量模式**不拦**（让合成 click 去 `mode.onClick` 标记）。

---

## 7. Worker 代理契约（`worker/worker.js`）
无状态透明代理，**不存任何密钥**（key 由前端从 localStorage 取、放 `Authorization` 头转发）。三路由：
- `POST /deepseek` → `api.deepseek.com/v1/chat/completions`
- `POST /eudic/word` → `api.frdic.com/api/open/v1/studylist/word`
- `POST /eudic/note` → `api.frdic.com/api/open/v1/studylist/note`
- `OPTIONS *` → CORS 预检。
部署：Cloudflare Workers 新建 → 贴整个文件 → Deploy → URL 填进 ⚙「代理 URL」。

---

## 8. 已知限制
- **EPUB 在无头/自动化环境渲染不出来**（iframe 高度=0），导致 EPUB 的点词查词无法自动化验证；真机正常。swipe 翻页已验证。
- **复杂版式 PDF**（双栏论文/公式/表格）文本层会塌，逐词/批量仍可用但复习左栏是整页 run-on 文本（MVP 取舍）。
- **不规则字形级叠印 PDF** 正文去重不彻底（见坑2）。
- 不支持 DRM EPUB、扫描件 OCR。
