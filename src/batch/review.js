// Two-column batch review overlay.
//   Left (70%): the marked paragraphs rebuilt as clean text, each marked word
//   boxed with its short Chinese gloss directly underneath. Glosses fill in
//   live as the pipeline streams results.
//   Right (30%): the full definition of the selected word, rendered by the
//   shared renderResultInto() so it matches the single-word panel exactly.

import { renderResultInto } from "../lookup/panel.js";
import { extractContext } from "../lookup/capture.js";

const OVERLAY_ID = "batch-review-overlay";

// openReview({ batchId, blocks, deps }) → { onProgress, onDone, close }
// deps: { saveToEudic }
export function openReview({ blocks, deps }) {
  document.getElementById(OVERLAY_ID)?.remove();

  const overlay = document.createElement("div");
  overlay.id = OVERLAY_ID;
  overlay.className = "batch-review-overlay";
  overlay.innerHTML = `
    <div class="batch-review-panel">
      <div class="batch-review-head">
        <span class="batch-review-title">批量复习 · 共 <b class="batch-review-count">0</b> 个生词</span>
        <span class="batch-review-progress"></span>
        <button class="batch-review-close" type="button" aria-label="关闭">×</button>
      </div>
      <div class="batch-review-cols">
        <div class="batch-review-left"></div>
        <div class="batch-review-right">
          <div class="batch-review-hint">点击左侧带框的单词查看完整释义</div>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const leftEl = overlay.querySelector(".batch-review-left");
  const rightEl = overlay.querySelector(".batch-review-right");
  const progressEl = overlay.querySelector(".batch-review-progress");

  // word(lower) -> { parsed, vocabId, eudicOk, ctx }
  const results = new Map();
  // word(lower) -> gloss <span> elements to fill on progress
  const glossEls = new Map();
  let selectedWord = null;
  let totalUnique = 0;

  function close() {
    overlay.remove();
    document.removeEventListener("keydown", onKey);
  }
  function onKey(e) {
    if (e.key === "Escape") close();
  }
  document.addEventListener("keydown", onKey);
  overlay.querySelector(".batch-review-close").addEventListener("click", close);
  overlay.addEventListener("mousedown", (e) => {
    if (e.target === overlay) close();
  });

  // ----- left column -----
  const uniqueSet = new Set();
  for (const block of blocks) {
    leftEl.appendChild(renderBlock(block));
    for (const m of block.marks) uniqueSet.add(m.word.toLowerCase());
  }
  totalUnique = uniqueSet.size;
  overlay.querySelector(".batch-review-count").textContent = String(totalUnique);

  function renderBlock(block) {
    const p = document.createElement("p");
    p.className = "batch-block";
    const marks = [...block.marks].sort((a, b) => a.charStart - b.charStart);
    let cursor = 0;
    for (const m of marks) {
      if (m.charStart < cursor) continue; // skip overlapping marks
      p.appendChild(document.createTextNode(block.text.slice(cursor, m.charStart)));

      const box = document.createElement("span");
      box.className = "batch-mark-box";
      box.dataset.word = m.word;
      const w = document.createElement("span");
      w.className = "batch-mark-word";
      w.textContent = block.text.slice(m.charStart, m.charEnd);
      const gloss = document.createElement("span");
      gloss.className = "batch-gloss";
      gloss.textContent = "…";
      box.append(w, gloss);
      box.addEventListener("click", () => selectWord(m.word, block.text, box));

      const key = m.word.toLowerCase();
      if (!glossEls.has(key)) glossEls.set(key, []);
      glossEls.get(key).push(gloss);

      p.appendChild(box);
      cursor = m.charEnd;
    }
    p.appendChild(document.createTextNode(block.text.slice(cursor)));
    return p;
  }

  // ----- right column -----
  function selectWord(word, blockText, box) {
    selectedWord = word;
    overlay.querySelectorAll(".batch-mark-box.selected").forEach((el) => el.classList.remove("selected"));
    box?.classList.add("selected");

    const r = results.get(word.toLowerCase());
    if (!r) {
      rightEl.innerHTML = `<div class="batch-review-hint">「${word}」释义生成中…</div>`;
      return;
    }
    const ctx = r.ctx || extractContext(blockText, word);
    renderResultInto(rightEl, { word, context: ctx }, r.parsed, {
      savedState: r.eudicOk ? "saved" : "idle",
      onSave: async (payload) => {
        const resp = await deps.saveToEudic(payload);
        if (resp?.ok) r.eudicOk = true;
        return resp;
      },
    });
  }

  // ----- streaming hooks -----
  function onProgress(done, total, word, meta) {
    const key = word.toLowerCase();
    results.set(key, meta);
    const gloss = meta.parsed?.meaning || "—";
    for (const el of glossEls.get(key) || []) el.textContent = gloss;
    progressEl.textContent = done < total ? `生成中 ${done}/${total}` : "已全部生成";
    if (selectedWord && selectedWord.toLowerCase() === key) {
      // refresh the open right column now that the result arrived
      const box = overlay.querySelector(".batch-mark-box.selected");
      selectWord(selectedWord, "", box);
    }
  }

  function onDone() {
    progressEl.textContent = "已全部生成";
  }

  return { onProgress, onDone, close };
}
