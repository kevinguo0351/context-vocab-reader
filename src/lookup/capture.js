// Selection + context capture, shared by PDF and EPUB readers.
//
// PDF: each page's .textLayer is a flat container of text spans, so we use
// the textLayer ancestor as the context window.
// EPUB: epubjs renders into a sandboxed <iframe>; selections live in that
// iframe's window, and the natural context root is a block-tag ancestor
// (<p>/<section>/...). The block-ancestor walk mirrors the Chrome extension's
// content.js — same logic, different host document.
//
// Returned `rect` is always in PARENT document coordinates (page-scrolled),
// so the floating UI can position itself uniformly regardless of host frame.

const MAX_SELECTION_LEN = 60;
const CONTEXT_BEFORE = 300;
const CONTEXT_AFTER = 300;
const BLOCK_TAGS = new Set([
  "P", "DIV", "LI", "TD", "BLOCKQUOTE", "ARTICLE",
  "SECTION", "PRE", "DD", "DT", "FIGCAPTION", "MAIN", "ASIDE",
]);

// Wire the parent-window mouseup capture used by the PDF reader.
// EPUB reader does NOT use this — it subscribes to rendition.on('selected', ...)
// and calls captureSelectionInWindow() directly with the iframe's window.
export function setupCapture(container, onCapture) {
  container.addEventListener("mouseup", () => {
    setTimeout(() => {
      const data = captureSelectionInWindow(window, { rootSelector: ".textLayer" });
      if (data) onCapture?.(data);
    }, 0);
  });
}

// Read the current selection inside `win` and build the capture record.
// rootSelector scopes the context root to that ancestor (PDF: ".textLayer");
// otherwise we walk up to the nearest block-tag element (EPUB).
export function captureSelectionInWindow(win, opts = {}) {
  const sel = win.getSelection();
  if (!sel || sel.isCollapsed) return null;
  const text = sel.toString().trim();
  if (!text || text.length > MAX_SELECTION_LEN) return null;

  const range = sel.getRangeAt(0);
  const root = opts.rootSelector
    ? findAncestorMatching(range.commonAncestorContainer, opts.rootSelector)
    : findBlockAncestor(range.commonAncestorContainer, win.document);
  if (!root) return null;

  const rect = parentDocRect(win, range);
  if (!rect) return null;

  const rootText = (root.textContent || "").replace(/\s+/g, " ").trim();
  return {
    word: text,
    context: extractContext(rootText, text),
    page: root.dataset?.pageNumber || null,
    selectedAt: new Date().toISOString(),
    rect,
  };
}

export function findAncestorMatching(node, selector) {
  let el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  while (el) {
    if (el.matches?.(selector)) return el;
    el = el.parentElement;
  }
  return null;
}

export function findBlockAncestor(node, doc) {
  let el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  while (el && el !== doc.body) {
    if (BLOCK_TAGS.has(el.tagName)) return el;
    el = el.parentElement;
  }
  return doc.body;
}

export function extractContext(rootText, selectedText) {
  const idx = rootText.indexOf(selectedText);
  if (idx === -1) return rootText.slice(0, CONTEXT_BEFORE + CONTEXT_AFTER);
  const start = Math.max(0, idx - CONTEXT_BEFORE);
  const end = Math.min(rootText.length, idx + selectedText.length + CONTEXT_AFTER);
  let s = rootText.slice(start, end);
  if (start > 0) s = "…" + s;
  if (end < rootText.length) s = s + "…";
  return s;
}

// Map a Range's bounding rect into parent-document coordinates so the floating
// UI sits in the right place even when the selection lives inside an iframe.
export function parentDocRect(win, range) {
  const r = range.getBoundingClientRect();
  if (!r || (r.width === 0 && r.height === 0)) return null;
  let offX = window.scrollX;
  let offY = window.scrollY;
  if (win !== window) {
    const iframe = win.frameElement;
    if (!iframe) return null;
    const iRect = iframe.getBoundingClientRect();
    offX += iRect.left;
    offY += iRect.top;
  }
  return {
    left: r.left + offX,
    top: r.top + offY,
    right: r.right + offX,
    bottom: r.bottom + offY,
    width: r.width,
    height: r.height,
  };
}
