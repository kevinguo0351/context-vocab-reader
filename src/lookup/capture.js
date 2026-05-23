// Selection + context capture, ported from the Chrome extension's content.js.
// Adapted: in PDFs the "block ancestor" is each page's .textLayer (all text
// spans are direct siblings), so we use that as the context window instead
// of climbing for <p> / <li> ancestors.
//
// For HTML article mode (later in week 2) we'll re-introduce the original
// block-ancestor walk; capture.js will dispatch on container type.

const MAX_SELECTION_LEN = 60;
const CONTEXT_BEFORE = 300;
const CONTEXT_AFTER = 300;

export function setupCapture(container) {
  container.addEventListener("mouseup", () => {
    // Defer one tick so the selection finalizes before we read it.
    setTimeout(() => {
      const data = captureSelection();
      if (!data) return;
      // Day 1 POC: log to console. Day 3 will hook up the floating button + panel.
      console.log("%c[capture]", "color:#7c83fd;font-weight:bold", data);
    }, 0);
  });
}

function findContextRoot(node) {
  let el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  while (el) {
    if (el.classList?.contains("textLayer")) return el;
    el = el.parentElement;
  }
  return null;
}

export function captureSelection() {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed) return null;
  const text = sel.toString().trim();
  if (!text || text.length > MAX_SELECTION_LEN) return null;

  const range = sel.getRangeAt(0);
  const root = findContextRoot(range.commonAncestorContainer);
  if (!root) return null;

  const rootText = (root.textContent || "").replace(/\s+/g, " ").trim();
  const idx = rootText.indexOf(text);

  let context;
  if (idx === -1) {
    context = rootText.slice(0, CONTEXT_BEFORE + CONTEXT_AFTER);
  } else {
    const start = Math.max(0, idx - CONTEXT_BEFORE);
    const end = Math.min(rootText.length, idx + text.length + CONTEXT_AFTER);
    context = rootText.slice(start, end);
    if (start > 0) context = "…" + context;
    if (end < rootText.length) context = context + "…";
  }

  return {
    word: text,
    context,
    page: root.dataset.pageNumber || null,
    selectedAt: new Date().toISOString(),
  };
}
