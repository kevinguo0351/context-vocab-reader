// Single-word click-marking, host-document agnostic (works in the PDF
// textLayer's parent document and inside the EPUB iframe's document).
//
// On a click we resolve the caret under the pointer, expand it to a word, wrap
// that word range in a <span class="batch-mark"> box, and return a record the
// controller stores. The recorded `word` + `charStart/charEnd` (offsets into
// the block's whitespace-collapsed text) drive both the AI lookup and the
// review window's inline gloss — so even if the visual box is imperfect, the
// data stays correct.

import { findBlockAncestor, extractContext, parentDocRect } from "../lookup/capture.js";

const WORD_RE = /[A-Za-z'’\-]/;

// Feature-detect both caret APIs: caretPositionFromPoint (Firefox / recent
// Chrome) and caretRangeFromPoint (WebKit / Blink legacy).
function caretFromPoint(doc, x, y) {
  if (doc.caretPositionFromPoint) {
    const p = doc.caretPositionFromPoint(x, y);
    return p ? { node: p.offsetNode, offset: p.offset } : null;
  }
  if (doc.caretRangeFromPoint) {
    const r = doc.caretRangeFromPoint(x, y);
    return r ? { node: r.startContainer, offset: r.startOffset } : null;
  }
  return null;
}

// Expand a caret (text node + offset) to the surrounding word, within the one
// text node. PDF textLayer emits one span (one text node) per run, so a word
// almost always lives in a single node.
function wordRangeAt(doc, node, offset) {
  const t = node.textContent;
  if (!t) return null;
  let o = offset;
  if (o >= t.length) o = t.length - 1;
  if (o < 0) return null;
  // Click landed just past the word (on a trailing space/punctuation).
  if (!WORD_RE.test(t[o] || "") && o > 0 && WORD_RE.test(t[o - 1])) o -= 1;
  if (!WORD_RE.test(t[o] || "")) return null;

  let s = o;
  let e = o + 1;
  while (s > 0 && WORD_RE.test(t[s - 1])) s -= 1;
  while (e < t.length && WORD_RE.test(t[e])) e += 1;

  const word = t.slice(s, e);
  if (!word.trim()) return null;
  const range = doc.createRange();
  range.setStart(node, s);
  range.setEnd(node, e);
  return { range, node, start: s, end: e, word };
}

// Running text up to (node, offset) within `block`, used to locate the word in
// the collapsed block text.
function textBefore(block, node, offset) {
  let acc = "";
  const walker = block.ownerDocument.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = walker.nextNode())) {
    if (n === node) return acc + n.textContent.slice(0, offset);
    acc += n.textContent;
  }
  return acc;
}

function collapse(s) {
  return s.replace(/\s+/g, " ").trim();
}

// Locate `word` in `blockText` near the caret's collapsed offset `approx`.
function locate(blockText, word, approx) {
  let charStart = blockText.indexOf(word, Math.max(0, approx - word.length - 1));
  if (charStart < 0) charStart = blockText.indexOf(word);
  if (charStart < 0) charStart = approx;
  return charStart;
}

// Identity key for an overprinted run: trimmed text + position bucketed to ~2px.
// Some PDFs (e.g. md→pdf exports) draw runs twice at the same spot, doubling the
// text layer. Two spans with the same key are the same painted run; keeping one
// de-doubles the review/AI text. Legit repeats elsewhere sit at a different
// position → different key → both kept.
function runKey(span) {
  const t = span.textContent.trim();
  if (!t) return null;
  const r = span.getBoundingClientRect();
  return `${t}@${Math.round(r.left / 2)},${Math.round(r.top / 2)}`;
}

// PDF block (one .textLayer = one page). Build the de-overprinted text and the
// caret's word offset within it, working over the flat span list. Normal PDFs
// have no same-position duplicates, so nothing is skipped and this matches
// textContent.
function pdfBlockRecord(tl, node, offset, word) {
  let caretSpan = node.parentElement;
  while (caretSpan && caretSpan.parentElement !== tl) caretSpan = caretSpan.parentElement;

  let raw = "";
  let caretRaw = -1;
  const keptStart = new Map(); // runKey -> raw start offset of the kept copy
  for (const span of tl.children) {
    if (span.tagName !== "SPAN") continue;
    const txt = span.textContent || "";
    const key = runKey(span);
    if (key && keptStart.has(key)) {
      // duplicate run → drop; map a caret inside it onto the kept copy
      if (span === caretSpan && caretRaw < 0) {
        caretRaw = keptStart.get(key) + Math.min(offset, txt.length);
      }
      continue;
    }
    if (span === caretSpan && caretRaw < 0) caretRaw = raw.length + offset;
    if (key) keptStart.set(key, raw.length);
    raw += txt;
  }

  const blockText = collapse(raw);
  const approx = collapse(raw.slice(0, Math.max(0, caretRaw))).length;
  const charStart = locate(blockText, word, approx);
  return { blockText, charStart, charEnd: charStart + word.length };
}

// Build the mark record (does NOT touch the DOM). `block`/`blockId` group marks
// for the review window; `charStart/charEnd` index into the collapsed blockText.
function buildRecord(doc, node, start, word) {
  const block = findBlockAncestor(node, doc);
  if (!block.dataset.batchBlockId) block.dataset.batchBlockId = crypto.randomUUID();
  const blockId = block.dataset.batchBlockId;

  let blockText, charStart, charEnd;
  if (block.classList?.contains("textLayer")) {
    ({ blockText, charStart, charEnd } = pdfBlockRecord(block, node, start, word));
  } else {
    blockText = collapse(block.textContent || "");
    const approx = collapse(textBefore(block, node, start)).length;
    charStart = locate(blockText, word, approx);
    charEnd = charStart + word.length;
  }

  return { blockId, block, blockText, charStart, charEnd, word };
}

// Wrap the word range in a marker span. Tier 1: surroundContents; if that
// throws (range straddles element boundaries) fall back to extract+insert.
function wrapWord(range, doc, word) {
  const span = doc.createElement("span");
  span.className = "batch-mark";
  span.dataset.batchWord = word;
  try {
    range.surroundContents(span);
  } catch {
    span.appendChild(range.extractContents());
    range.insertNode(span);
  }
  return span;
}

// The nearest PDF text-layer ancestor, or null (EPUB / plain HTML).
function textLayerOf(node) {
  const el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  return el?.closest?.(".textLayer") || null;
}

// Tier 2 (PDF): draw absolutely-positioned overlay boxes over the word's
// client rects instead of wrapping. pdf.js applies a per-span transform
// (scaleX) to match glyph widths; injecting a wrapper span breaks that
// transform and misaligns the box, so we never mutate the textLayer — we
// position overlays relative to it (it's the absolute containing block).
function drawOverlay(range, tl) {
  const tlRect = tl.getBoundingClientRect();
  const overlays = [];
  for (const r of range.getClientRects()) {
    if (r.width === 0 && r.height === 0) continue;
    const div = tl.ownerDocument.createElement("div");
    div.className = "batch-mark-overlay";
    div.style.left = `${r.left - tlRect.left}px`;
    div.style.top = `${r.top - tlRect.top}px`;
    div.style.width = `${r.width}px`;
    div.style.height = `${r.height}px`;
    tl.appendChild(div);
    overlays.push(div);
  }
  return overlays;
}

// Resolve the word at (x, y) WITHOUT mutating the DOM. Returns the record
// (`word`, `blockId`, `block`, `blockText`, `charStart/charEnd`, `range`) or
// null. Shared by markWordAtPoint (which then draws) and wordContextAtPoint
// (tap-to-lookup, which only reads).
export function resolveWordAtPoint(doc, x, y) {
  const caret = caretFromPoint(doc, x, y);
  if (!caret || !caret.node || caret.node.nodeType !== Node.TEXT_NODE) return null;
  const wr = wordRangeAt(doc, caret.node, caret.offset);
  if (!wr) return null;
  const rec = buildRecord(doc, wr.node, wr.start, wr.word);
  return { ...rec, range: wr.range };
}

// Public: attempt to mark the word at (x, y) in `doc`. Returns the record
// (with `kind` + the inserted `els`) or null when the point isn't on a word.
// PDF text layer → overlay boxes (Tier 2); EPUB / HTML → wrap span (Tier 1).
export function markWordAtPoint(doc, x, y) {
  const r = resolveWordAtPoint(doc, x, y);
  if (!r) return null;

  const tl = textLayerOf(r.range.startContainer);
  if (tl) {
    const overlays = drawOverlay(r.range, tl);
    if (!overlays.length) return null;
    return { ...r, kind: "overlay", els: overlays };
  }
  return { ...r, kind: "wrap", els: [wrapWord(r.range, doc, r.word)] };
}

// Tap-to-lookup: build the same record shape as capture.js's
// captureSelectionInWindow, from a single point instead of a selection. No DOM
// mutation. Lives here (not capture.js) to keep the dependency one-way
// (mark → capture); reuses extractContext + parentDocRect from capture.js.
export function wordContextAtPoint(win, x, y) {
  const r = resolveWordAtPoint(win.document, x, y);
  if (!r) return null;
  const rect = parentDocRect(win, r.range);
  if (!rect) return null;
  return {
    word: r.word,
    context: extractContext(r.blockText, r.word),
    page: r.block?.dataset?.pageNumber || null,
    selectedAt: new Date().toISOString(),
    rect,
  };
}

// Public: find the element carrying a mark at (x, y) — an overlay box or a wrap
// span — or null. Checks the event target first (covers overlays, whose
// pointer-events intercept the click) then falls back to the caret (covers wrap
// spans even when the host's text spans set pointer-events: none).
export function findMarkElAtPoint(doc, x, y, target) {
  const viaTarget = target?.closest?.(".batch-mark, .batch-mark-overlay");
  if (viaTarget) return viaTarget;
  const caret = caretFromPoint(doc, x, y);
  const node = caret?.node;
  if (!node) return null;
  const el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  return el?.closest?.(".batch-mark") || null;
}

// Public: undo a mark — remove overlay boxes, or unwrap the span restoring the
// original text node.
export function cleanupMark(rec) {
  if (rec.kind === "overlay") {
    rec.els.forEach((el) => el.remove());
    return;
  }
  const span = rec.els[0];
  const parent = span?.parentNode;
  if (!parent) return;
  while (span.firstChild) parent.insertBefore(span.firstChild, span);
  parent.removeChild(span);
  parent.normalize();
}
