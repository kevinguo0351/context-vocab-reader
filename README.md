# Context Vocab Reader

> 浏览器里就能用的"读外刊 + 读英文小说 + 读公版书"工具。每个生词都自带前后 300 字上下文，AI 中文解释，一键存欧陆。

**配套项目**：[Context Vocab Chrome Extension](https://github.com/kevinguo0351/context-vocab-extension) —— 处理"网页划词"场景。这个 Reader 处理 PDF / EPUB / 网页文章 三种"读完整内容"场景。

---

## 状态

🚧 **WIP** —— 14 天 MVP 开发中。详细路线见 [TECHNICAL-PLAN.md](TECHNICAL-PLAN.md)。

当前进度：
- [x] Vite vanilla JS 脚手架
- [x] 依赖装好（pdfjs-dist · epubjs · @mozilla/readability · dompurify · idb）
- [x] 技术规划文档
- [ ] PDF.js text-layer 选区 POC（Day 1-2）
- [ ] 移植查词面板 UI（Day 3）
- [ ] Cloudflare Worker 代理（Day 4）
- [ ] 端到端 PDF 查词（Day 5）
- [ ] EPUB 支持（Day 6-7）
- [ ] 网页文章导入（Day 8-9）
- [ ] 欧陆保存（Day 10）
- [ ] Settings + 阅读库 + 语境档案（Day 11-13）
- [ ] 部署 + landing（Day 14）

---

## 本地开发

```bash
npm install
npm run dev
```

打开 http://localhost:5173 看到目前的进度。

---

## 路线图

参见 [TECHNICAL-PLAN.md](TECHNICAL-PLAN.md)。

---

## License

MIT
