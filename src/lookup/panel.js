// Floating action button + lookup panel.
// Ported from the Chrome extension's content.js (src/content.js, ll. 89–354
// in context-vocab). Differences from the extension:
//   - No chrome.runtime — callers inject onLookup / onSave functions.
//   - data.rect is already in parent-doc coordinates (capture.js handles the
//     iframe→parent mapping for EPUB), so positioning is identical for PDF
//     and EPUB.
//   - dictionary links remain (LDOCE / M-W / Cambridge) so users have an
//     escape hatch when DeepSeek fails.

const BUTTON_ID = "ctxvocab-fab";
const PANEL_ID = "ctxvocab-panel";

export function dismissAll() {
  document.getElementById(BUTTON_ID)?.remove();
  document.getElementById(PANEL_ID)?.remove();
}

// Wire global dismiss behavior. Call once at app boot.
export function installPanelLifecycle() {
  document.addEventListener("mousedown", (e) => {
    if (e.target?.closest?.(`#${BUTTON_ID}, #${PANEL_ID}`)) return;
    dismissAll();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") dismissAll();
  });
  window.addEventListener("scroll", () => document.getElementById(BUTTON_ID)?.remove(), { passive: true });
  window.addEventListener("resize", () => document.getElementById(BUTTON_ID)?.remove(), { passive: true });
}

// Show the floating "✦ 查词" button anchored above the selection.
// onActivate is called when the user clicks it.
export function showButton(data, onActivate) {
  dismissAll();
  const btn = document.createElement("button");
  btn.id = BUTTON_ID;
  btn.className = "ctxvocab-fab";
  btn.textContent = "✦ 查词";
  btn.type = "button";

  const top = data.rect.top - 36;
  const left = data.rect.left + data.rect.width / 2 - 36;
  btn.style.top = `${Math.max(window.scrollY + 4, top)}px`;
  btn.style.left = `${Math.max(4, left)}px`;

  btn.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); });
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    btn.remove();
    onActivate?.();
  });
  document.body.appendChild(btn);
}

// Open the panel for `data`. Calls onLookup({word, context}) immediately;
// when the user clicks "save" we call onSave(payload) and reflect status.
export async function openPanel(data, { onLookup, onSave }) {
  dismissAll();
  const panel = buildPanelShell(data);
  document.body.appendChild(panel);

  try {
    const resp = await onLookup({ word: data.word, context: data.context });
    if (!resp || !resp.ok) {
      renderError(panel, resp?.error || "查询失败。");
      return;
    }
    renderResult(panel, data, resp.parsed, onSave);
  } catch (err) {
    renderError(panel, err?.message || "查询失败。");
  }
}

// ---------- internals ----------

// External-dictionary block, shared by the single-word panel and the batch
// review window's right column.
const DICTS_HTML = `
    <div class="ctxvocab-dicts" hidden>
      <div class="ctxvocab-dicts-label">查阅外部词典</div>
      <div class="ctxvocab-dicts-row">
        <a class="ctxvocab-link" data-dict="ldoce" target="_blank" rel="noopener">朗文 LDOCE</a>
        <a class="ctxvocab-link" data-dict="mw" target="_blank" rel="noopener">韦氏 M-W</a>
        <a class="ctxvocab-link" data-dict="cambridge" target="_blank" rel="noopener">剑桥 英汉</a>
      </div>
    </div>`;

// The meaning + in-context callout + note markup, shared by both renderers.
function resultBodyHtml(parsed) {
  const meaning = parsed.meaning || "（未返回释义）";
  const inContext = parsed.in_context || "";
  const note = parsed.note || "";
  return `
    <div class="ctxvocab-meaning">
      <div class="ctxvocab-meaning-text">${escapeHtml(meaning)}</div>
    </div>
    ${inContext ? `
    <div class="ctxvocab-callout">
      <div class="ctxvocab-callout-label">在这段里的意思</div>
      <div class="ctxvocab-callout-text">${escapeHtml(inContext)}</div>
    </div>` : ""}
    ${note ? `
    <div class="ctxvocab-note">
      <span class="ctxvocab-note-icon">💡</span>
      <span class="ctxvocab-note-text">${escapeHtml(note)}</span>
    </div>` : ""}
  `;
}

// Render the full result UI (word + type + meaning + context + note + dict
// links + save) into an arbitrary container. The batch review window reuses
// this for its right column so it matches the single-word panel exactly.
// `savedState === "saved"` shows the already-pushed-to-Eudic state instead of
// an active save button.
export function renderResultInto(container, data, parsed, { onSave, savedState } = {}) {
  const type = parsed.type || "";
  container.innerHTML = `
    <div class="ctxvocab-word-row">
      <div class="ctxvocab-word" title="${escapeHtml(data.word)}">${escapeHtml(data.word)}</div>
      ${type ? `<span class="ctxvocab-type-pill">${escapeHtml(type)}</span>` : ""}
    </div>
    <div class="ctxvocab-body">${resultBodyHtml(parsed)}</div>
    ${DICTS_HTML}
    <div class="ctxvocab-actions">
      <button class="ctxvocab-btn ctxvocab-save" type="button">＋ 存到欧陆（带语境笔记）</button>
    </div>
    <div class="ctxvocab-status" hidden></div>
  `;
  wireDictLinks(container, data.word);

  const saveBtn = container.querySelector(".ctxvocab-save");
  if (savedState === "saved") {
    saveBtn.textContent = "✓ 已存欧陆";
    saveBtn.classList.add("ctxvocab-saved");
    saveBtn.disabled = true;
  } else {
    saveBtn.addEventListener("click", () => handleSave(container, data, {
      meaning: parsed.meaning, in_context: parsed.in_context, type: parsed.type, note: parsed.note,
    }, onSave));
  }
}

function buildPanelShell(data) {
  const panel = document.createElement("div");
  panel.id = PANEL_ID;
  panel.className = "ctxvocab-panel";

  const PANEL_W = Math.min(340, window.innerWidth * 0.92);
  const margin = 12;
  let left = data.rect.right + margin;
  if (left + PANEL_W > window.scrollX + window.innerWidth - margin) {
    left = data.rect.left - PANEL_W - margin;
  }
  if (left < window.scrollX + margin) left = window.scrollX + margin;

  let top = data.rect.top;
  if (top + 280 > window.scrollY + window.innerHeight - margin) {
    top = window.scrollY + window.innerHeight - 280 - margin;
  }
  if (top < window.scrollY + margin) top = window.scrollY + margin;

  panel.style.top = `${top}px`;
  panel.style.left = `${left}px`;

  panel.innerHTML = `
    <div class="ctxvocab-header">
      <div class="ctxvocab-word-row">
        <div class="ctxvocab-word" title="${escapeHtml(data.word)}">${escapeHtml(data.word)}</div>
        <span class="ctxvocab-type-pill" hidden></span>
      </div>
      <button class="ctxvocab-close" type="button" aria-label="关闭">×</button>
    </div>
    <div class="ctxvocab-body">
      <div class="ctxvocab-loading">分析语境中…</div>
    </div>
    ${DICTS_HTML}
    <div class="ctxvocab-actions" hidden>
      <button class="ctxvocab-btn ctxvocab-save" type="button">＋ 存到欧陆（带语境笔记）</button>
    </div>
    <div class="ctxvocab-status" hidden></div>
  `;

  panel.querySelector(".ctxvocab-close").addEventListener("click", () => panel.remove());
  panel.addEventListener("mousedown", (e) => e.stopPropagation());
  return panel;
}

function renderResult(panel, data, parsed, onSave) {
  const body = panel.querySelector(".ctxvocab-body");
  const meaning = parsed.meaning || "（未返回释义）";
  const inContext = parsed.in_context || "";
  const type = parsed.type || "";
  const note = parsed.note || "";

  if (type) {
    const pill = panel.querySelector(".ctxvocab-type-pill");
    pill.textContent = type;
    pill.hidden = false;
  }

  body.innerHTML = resultBodyHtml(parsed);

  wireDictLinks(panel, data.word);

  const actions = panel.querySelector(".ctxvocab-actions");
  actions.hidden = false;

  const saveBtn = panel.querySelector(".ctxvocab-save");
  saveBtn.addEventListener("click", () => handleSave(panel, data, {
    meaning, in_context: inContext, type, note,
  }, onSave));
}

function renderError(panel, msg) {
  const body = panel.querySelector(".ctxvocab-body");
  body.innerHTML = `<div class="ctxvocab-error">${escapeHtml(msg)}</div>`;
  wireDictLinks(panel, panel.querySelector(".ctxvocab-word")?.textContent || "");
}

async function handleSave(panel, data, parsed, onSave) {
  const btn = panel.querySelector(".ctxvocab-save");
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = "保存中…";
  setStatus(panel, "", null);

  try {
    const resp = await onSave({
      word: data.word,
      meaning: parsed.meaning,
      in_context: parsed.in_context,
      type: parsed.type,
      note: parsed.note,
      context: data.context,
      saved_at: new Date().toISOString(),
    });
    if (resp?.ok) {
      btn.textContent = "✓ 已存入欧陆";
      btn.classList.add("ctxvocab-saved");
      if (resp.warning) setStatus(panel, resp.warning, "error");
    } else if (resp?.code === "NO_TOKEN") {
      btn.textContent = "⚠ 请在设置里填欧陆 token";
      btn.disabled = false;
    } else {
      btn.textContent = original;
      btn.disabled = false;
      setStatus(panel, resp?.error || "保存失败。", "error");
    }
  } catch (err) {
    btn.textContent = original;
    btn.disabled = false;
    setStatus(panel, err?.message || "保存失败。", "error");
  }
}

function setStatus(panel, msg, kind) {
  const el = panel.querySelector(".ctxvocab-status");
  if (!el) return;
  el.hidden = !msg;
  el.textContent = msg || "";
  el.className = "ctxvocab-status" + (kind ? ` ctxvocab-status-${kind}` : "");
}

function wireDictLinks(panel, word) {
  const slug = word.toLowerCase().trim().replace(/\s+/g, "-");
  panel.querySelector('[data-dict="ldoce"]').href =
    `https://www.ldoceonline.com/dictionary/${encodeURIComponent(slug)}`;
  panel.querySelector('[data-dict="mw"]').href =
    `https://www.merriam-webster.com/dictionary/${encodeURIComponent(word.trim())}`;
  panel.querySelector('[data-dict="cambridge"]').href =
    `https://dictionary.cambridge.org/dictionary/english-chinese-simplified/${encodeURIComponent(slug)}`;
  panel.querySelector(".ctxvocab-dicts").hidden = false;
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
