// Batch-mode controller: the on/off state machine, Alt+B hotkey, right-click
// menu, top banner, and click-marking dispatch for both PDF (parent document)
// and EPUB (per-chapter iframe documents). While active it suppresses the
// normal single-word lookup (main.js gates on isBatchActive()).

import { markWordAtPoint, findMarkElAtPoint, cleanupMark } from "./mark.js";
import { runBatch } from "./pipeline.js";
import { openReview } from "./review.js";
import { dismissAll } from "../lookup/panel.js";

let _active = false;
export function isBatchActive() {
  return _active;
}

// deps: { lookupWord, appendVocab, saveToEudic, createBatch, getBatch, updateBatch }
// getBook: () => ({ id, name, type }) | null ; getRendition: () => epub rendition | null
// onActiveChange: (active:boolean) => void — reflect state on the toolbar button.
export function createBatchController({ main, status, getBook, getRendition, deps, onActiveChange }) {
  const state = { batchId: null, host: null, marks: new Map() }; // markId -> record
  const bound = new WeakSet();
  let banner = null;
  let bannerText = null;
  let menuEl = null;

  // ---------- listeners ----------
  function bind(target) {
    if (!target || bound.has(target)) return;
    bound.add(target);
    target.addEventListener("click", onClick, true);
    target.addEventListener("contextmenu", onContextMenu, true);
  }

  // Mark (or unmark) the word at a point. `target` is the hit element when
  // known (a real click / tap), used to detect an existing mark to remove.
  function markAt(doc, x, y, target) {
    if (!_active) return;
    const hit = findMarkElAtPoint(doc, x, y, target);
    if (hit) {
      removeMark(hit.dataset.batchMarkId);
      return;
    }
    const rec = markWordAtPoint(doc, x, y);
    if (rec) {
      addMark(rec);
      doc.getSelection?.()?.removeAllRanges?.();
    }
  }

  // Desktop mouse path. On touch, marking is driven by the gesture layer's
  // touch coordinates (controller.markAt) — NOT this synthetic click — because
  // the post-tap synthetic click can land a word off inside the EPUB iframe.
  function onClick(e) {
    if (!_active) return;
    e.preventDefault();
    e.stopPropagation();
    markAt(e.target.ownerDocument || document, e.clientX, e.clientY, e.target);
  }

  function onContextMenu(e) {
    e.preventDefault();
    let px = e.clientX;
    let py = e.clientY;
    const doc = e.target.ownerDocument;
    if (doc && doc !== document) {
      const iframe = doc.defaultView?.frameElement;
      const r = iframe?.getBoundingClientRect();
      if (r) { px += r.left; py += r.top; }
    }
    showMenu(px, py);
  }

  function onKeyToggle(e) {
    if (!e.altKey || (e.key !== "b" && e.key !== "B")) return;
    const tag = e.target?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    e.preventDefault?.();
    toggle();
  }

  // EPUB: epubjs builds a fresh iframe per chapter, so (re)bind on every render.
  function attachEpub(rendition) {
    if (!rendition) return;
    const bindContents = () => (rendition.getContents?.() || []).forEach((c) => bind(c.document));
    bindContents();
    rendition.on("rendered", bindContents);
    rendition.on("keyup", onKeyToggle);
  }

  // ---------- marks ----------
  function addMark(rec) {
    const markId = crypto.randomUUID();
    rec.markId = markId;
    rec.els.forEach((el) => { el.dataset.batchMarkId = markId; });
    state.marks.set(markId, rec);
    updateBanner();
  }

  function removeMark(markId) {
    const rec = state.marks.get(markId);
    if (!rec) return;
    state.marks.delete(markId);
    cleanupMark(rec);
    updateBanner();
  }

  function buildBlocks() {
    const map = new Map();
    const order = [];
    for (const rec of state.marks.values()) {
      if (!map.has(rec.blockId)) {
        map.set(rec.blockId, { blockId: rec.blockId, text: rec.blockText, marks: [] });
        order.push(rec.blockId);
      }
      map.get(rec.blockId).marks.push({
        word: rec.word, charStart: rec.charStart, charEnd: rec.charEnd, vocabId: null,
      });
    }
    return order.map((id) => map.get(id));
  }

  // ---------- banner ----------
  // Text span + a tappable 完成 button (touch has no Alt+B). The button calls
  // end() directly; Alt+B and the right-click menu still work on desktop.
  function showBanner() {
    banner = document.createElement("div");
    banner.className = "batch-banner";
    bannerText = document.createElement("span");
    const doneBtn = document.createElement("button");
    doneBtn.type = "button";
    doneBtn.className = "batch-done-btn";
    doneBtn.textContent = "完成";
    doneBtn.addEventListener("click", () => end());
    banner.append(bannerText, doneBtn);
    document.body.appendChild(banner);
    updateBanner();
  }
  function updateBanner() {
    if (bannerText) bannerText.textContent = `批量模式 · 点词标记生词 · 已标 ${state.marks.size} 个`;
  }
  function hideBanner() {
    banner?.remove();
    banner = null;
    bannerText = null;
  }

  // ---------- context menu ----------
  function showMenu(x, y) {
    hideMenu();
    menuEl = document.createElement("div");
    menuEl.className = "batch-menu";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = _active ? "退出批量模式 (Alt+B)" : "进入批量模式 (Alt+B)";
    btn.addEventListener("click", () => { hideMenu(); toggle(); });
    menuEl.appendChild(btn);
    menuEl.style.left = `${x}px`;
    menuEl.style.top = `${y}px`;
    document.body.appendChild(menuEl);
    setTimeout(() => document.addEventListener("mousedown", onOutsideMenu, true), 0);
  }
  function onOutsideMenu(e) {
    if (!menuEl?.contains(e.target)) hideMenu();
  }
  function hideMenu() {
    document.removeEventListener("mousedown", onOutsideMenu, true);
    menuEl?.remove();
    menuEl = null;
  }

  // ---------- lifecycle ----------
  function start() {
    _active = true;
    state.batchId = crypto.randomUUID();
    state.host = main.dataset.kind || "pdf";
    state.marks.clear();
    dismissAll();
    bind(main);
    const rendition = getRendition?.();
    if (rendition) (rendition.getContents?.() || []).forEach((c) => bind(c.document));
    showBanner();
    onActiveChange?.(true);
    if (status) status.textContent = "批量模式：点击不认识的单词，读完点「完成」（或 Alt+B）";
  }

  async function end() {
    hideMenu();
    const marks = [...state.marks.values()];
    _active = false;
    hideBanner();
    onActiveChange?.(false);

    if (!marks.length) {
      if (status) status.textContent = "已退出批量模式（未标记单词）";
      return;
    }

    const blocks = buildBlocks();
    marks.forEach((rec) => cleanupMark(rec)); // restore the reader
    state.marks.clear();

    const book = getBook?.() || {};
    const batchId = state.batchId;
    const bookId = book.id || null;
    const bookName = book.name || null;

    await deps.createBatch({ batchId, bookId, bookName, host: state.host, blocks });
    const review = openReview({ batchId, blocks, deps });
    if (status) status.textContent = `批量生成 ${blocks.reduce((n, b) => n + b.marks.length, 0)} 个词的释义中…`;

    runBatch({ batchId, blocks, bookId, bookName, deps, onProgress: review.onProgress })
      .then(() => {
        review.onDone();
        if (status) status.textContent = "批量复习就绪 · 点左侧单词查看释义";
      })
      .catch((err) => {
        console.error("batch pipeline failed", err);
        if (status) status.textContent = `批量生成出错: ${err?.message || err}`;
      });
  }

  function toggle() {
    if (_active) end();
    else start();
  }

  // base wiring (always on, independent of active state)
  bind(main);
  document.addEventListener("keydown", onKeyToggle);

  return { toggle, isActive: () => _active, attachEpub, markAt };
}
