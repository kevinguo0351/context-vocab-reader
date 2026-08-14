// Must come before pdfjs-dist so Map.prototype is patched (Edge 140 lacks
// getOrInsertComputed) before any pdf.js code can reach for it.
import "./pdf/map-upsert-polyfill.js";
import "./style.css";
import * as pdfjsLib from "pdfjs-dist";
// Our own worker entry, which re-installs the polyfill inside the worker realm
// before loading pdf.worker.min.mjs. `?worker&url` gives the bundled worker's
// URL for GlobalWorkerOptions.workerSrc (pdf.js spawns the Worker itself).
import workerUrl from "./pdf/worker-entry.js?worker&url";
import { renderPdf } from "./pdf/render.js";
import { renderEpub } from "./epub/render.js";
import { setupCapture, captureSelectionInWindow } from "./lookup/capture.js";
import { showButton, openPanel, dismissAll, installPanelLifecycle } from "./lookup/panel.js";
import { setupReaderGestures } from "./lookup/gesture.js";
import { wordContextAtPoint } from "./batch/mark.js";
import { lookupWord, saveToEudic } from "./lookup/api.js";
import { openSettings } from "./settings/dialog.js";
import {
  upsertBook, updateProgress, getProgress, appendVocab,
  createBatch, getBatch, updateBatch,
} from "./store/db.js";
import { createBatchController, isBatchActive } from "./batch/mode.js";
import { pickFile, isTouch } from "./platform/index.js";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

const main = document.querySelector("#reader-main");
const status = document.querySelector("#status");

installPanelLifecycle();
document.querySelector("#settings-btn").addEventListener("click", openSettings);
document.querySelector("#open-file-btn").addEventListener("click", async () => {
  const file = await pickFile();
  if (file) await loadFile(file);
});

// Drag-and-drop a PDF/EPUB anywhere onto the window (desktop convenience;
// the 📂 button remains the path on touch where dragging isn't available).
document.addEventListener("dragover", (e) => e.preventDefault());
document.addEventListener("drop", (e) => {
  e.preventDefault();
  const file = e.dataTransfer?.files?.[0];
  if (file) loadFile(file);
});

// Track the currently-open book so vocab saves carry source metadata and
// EPUB progress can be persisted on relocation.
let currentBook = null;
let currentRendition = null;
let destroyCurrentReader = null;

const onCapture = (data) => {
  if (isBatchActive()) return; // batch mode handles clicks itself
  showButton(data, () => openPanel(data, { onLookup: lookupWord, onSave }));
};

// Batch-mode controller (toolbar 批量 button / Alt+B / right-click). Shares the
// same lookup + save primitives as the single-word flow.
const batchBtn = document.querySelector("#batch-btn");
const batch = createBatchController({
  main,
  status,
  getBook: () => currentBook,
  getRendition: () => currentRendition,
  deps: { lookupWord, appendVocab, saveToEudic, createBatch, getBatch, updateBatch },
  onActiveChange: (active) => batchBtn.classList.toggle("active", active),
});
batchBtn.addEventListener("click", () => batch.toggle());

// Compose: Eudic save first; on success, mirror to local vocab log.
const onSave = async (payload) => {
  const resp = await saveToEudic(payload);
  if (resp.ok) {
    await appendVocab({
      ...payload,
      sourceBookId: currentBook?.id || null,
      sourceBookName: currentBook?.name || null,
    });
  }
  return resp;
};

setupCapture(main, onCapture);

// Touch: tap a word → look it up (Kindle-style); drag-select → FAB. Desktop
// keeps mouse selection (gestures are touch-only). EPUB gets its own per-chapter
// binding in epub/render.js; this covers the PDF surface (main document).
if (isTouch) {
  setupReaderGestures(main, window, {
    isEpub: false,
    isBatchActive,
    onTap: (x, y) => {
      const data = wordContextAtPoint(window, x, y);
      if (data) openPanel(data, { onLookup: lookupWord, onSave });
      else dismissAll();
    },
    onSelect: () => {
      const data = captureSelectionInWindow(window, { rootSelector: ".textLayer" });
      if (data) onCapture(data);
    },
    onMarkTap: (x, y, targetEl) => batch.markAt(document, x, y, targetEl),
  });
}

// EPUB lives in a per-chapter iframe, so gestures must be (re)bound on each
// `rendered`. Tap → look up the word; swipe → turn the page; phrase selection
// is delivered by rendition.on('selected') (so isEpub skips onSelect here).
const epubGestureBound = new WeakSet();
function attachEpubGestures(rendition) {
  const bindAll = () => {
    for (const c of rendition.getContents?.() || []) {
      if (!c.document || epubGestureBound.has(c.document)) continue;
      epubGestureBound.add(c.document);
      setupReaderGestures(c.document, c.window, {
        isEpub: true,
        isBatchActive,
        onTap: (x, y) => {
          const data = wordContextAtPoint(c.window, x, y);
          if (data) openPanel(data, { onLookup: lookupWord, onSave });
          else dismissAll();
        },
        onMarkTap: (x, y, targetEl) => batch.markAt(c.document, x, y, targetEl),
        onSwipe: (dir) => (dir === "next" ? rendition.next() : rendition.prev()),
      });
    }
  };
  bindAll();
  rendition.on("rendered", bindAll);
}

async function loadFile(file) {
  status.textContent = `加载中: ${file.name}…`;
  try {
    const buf = await file.arrayBuffer();
    destroyCurrentReader?.();
    destroyCurrentReader = null;
    main.innerHTML = "";
    currentRendition = null;
    main.dataset.kind = pickKind(file.name);

    const id = await upsertBook({
      name: file.name,
      size: file.size,
      type: main.dataset.kind,
    });
    currentBook = { id, name: file.name, type: main.dataset.kind };

    if (main.dataset.kind === "epub") {
      const savedCfi = await getProgress(id);
      const { rendition, destroy } = await renderEpub(buf, main, { startCfi: savedCfi });
      currentRendition = rendition;
      destroyCurrentReader = destroy;
      batch.attachEpub(rendition);
      if (isTouch) attachEpubGestures(rendition);

      rendition.on("selected", (_cfiRange, contents) => {
        if (isBatchActive()) return; // batch mode handles clicks itself
        setTimeout(() => {
          const data = captureSelectionInWindow(contents.window);
          if (data) onCapture(data);
        }, 0);
      });
      rendition.on("click", () => { if (!isBatchActive()) dismissAll(); });
      rendition.on("relocated", (loc) => {
        if (loc?.start?.cfi) updateProgress(id, loc.start.cfi);
      });
      status.textContent = `${file.name} · 划词试试`;
    } else {
      await renderPdf(pdfjsLib, buf, main, (i, n) => {
        status.textContent = `渲染第 ${i}/${n} 页…`;
      });
      const pageCount = main.querySelectorAll(".pdf-page").length;
      status.textContent = `${file.name} · 共 ${pageCount} 页 · 划词试试`;
    }
  } catch (err) {
    console.error(err);
    status.textContent = `加载失败: ${err.message}`;
  }
}

function pickKind(name) {
  return name.toLowerCase().endsWith(".epub") ? "epub" : "pdf";
}
