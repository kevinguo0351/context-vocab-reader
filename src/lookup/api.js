// DeepSeek + Eudic OpenAPI client.
// Ported from C:\Users\guowenjie\context-vocab\src\background.js (lines 38–289).
// Differences from the extension:
//   - Settings live in localStorage, not chrome.storage.
//   - No service-worker IPC — exported async functions called directly from
//     panel.js via dependency injection.
//
// Both APIs support browser CORS, so we call them directly — no proxy. (They
// are also China-domestic and directly reachable.)

const DEEPSEEK_URL = "https://api.deepseek.com/v1/chat/completions";
const EUDIC_BASE = "https://api.frdic.com/api/open/v1";
const EUDIC_NOTE_MAX = 900;

function deepseekUrl() {
  return DEEPSEEK_URL;
}
function eudicUrl(path) {
  // path is "/word" or "/note".
  return `${EUDIC_BASE}/studylist${path}`;
}

const SYSTEM_PROMPT =
  "你是一个为中国英语学习者服务的词汇解释助手。" +
  "用户会给你一个在网页中选中的英文单词或短语，以及它前后约 300 字的英文上下文。" +
  "请按以下原则输出：\n" +
  "- meaning：这个词的**通用字典式释义**，简短、精炼，10–30 字以内，相当于词典首条解释。如果是多义词，给出与本语境最匹配的那条主释义即可，不要罗列。\n" +
  "- in_context：**结合上下文**展开解释——为什么在这一段里就是这个意思，引用上下文里的关键词，2–3 句话。这是和字典释义最大的区别。\n" +
  "- type：词性或类别，例如「名词」「专有名词 · 高速公路名」「短语动词」。\n" +
  "- note：一个对记忆有帮助的小知识——词源、构词法、易混词、地道用法、文化背景等，1 句话。\n" +
  "尤其注意缩写、专有名词、俚语、双关、比喻用法。\n" +
  "**输出格式硬性规定**：\n" +
  "- 必须是合法 JSON，且只输出 JSON 本身，不要 markdown 代码块、不要任何说明文字。\n" +
  "- 所有字段值都用简体中文。\n" +
  "- 在 JSON 字符串值的内部，如果需要引用原文里的英文词组或短语，请用中文全角引号「」 或 \" \"（U+201C / U+201D），**绝对不要在字符串值内放未转义的英文双引号**（这会破坏 JSON）。";

// ---------- Settings ----------

export function getKeys() {
  return {
    deepseek_key: localStorage.getItem("deepseek_key") || "",
    eudic_token: localStorage.getItem("eudic_token") || "",
  };
}

export function setKeys({ deepseek_key, eudic_token }) {
  if (deepseek_key !== undefined) localStorage.setItem("deepseek_key", deepseek_key);
  if (eudic_token !== undefined) localStorage.setItem("eudic_token", eudic_token);
}

// ---------- DeepSeek ----------

export async function lookupWord({ word, context }) {
  const { deepseek_key } = getKeys();
  if (!deepseek_key) {
    return { ok: false, code: "NO_KEY", error: "未设置 DeepSeek API key，点右上角 ⚙ 填一下。" };
  }

  const userMessage =
    `选中的词/短语: ${word}\n` +
    `上下文段落: ${context}\n\n` +
    "请按以下 JSON 格式回复（字段顺序与含义见 system 指令）：\n" +
    "{\n" +
    '  "meaning": "字典式简短释义，10–30 字",\n' +
    '  "in_context": "结合本段上下文展开解释，2–3 句",\n' +
    '  "type": "词性或类别",\n' +
    '  "note": "1 句记忆点 / 词源 / 地道用法"\n' +
    "}";

  let res;
  try {
    res = await fetch(deepseekUrl(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${deepseek_key}`,
      },
      body: JSON.stringify({
        // Cheapest in the DeepSeek lineup. Legacy `deepseek-chat` routes here too
        // but is scheduled for deprecation 2026-07-24; pin the explicit ID.
        model: "deepseek-v4-flash",
        max_tokens: 500,
        temperature: 0.3,
        // Force valid JSON — eliminates the "unescaped quotes inside string"
        // failure mode that used to dump raw JSON into the panel.
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userMessage },
        ],
      }),
    });
  } catch (err) {
    return { ok: false, error: `网络错误: ${err.message}` };
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { ok: false, error: `DeepSeek ${res.status}: ${text.slice(0, 200)}` };
  }

  const data = await res.json().catch(() => null);
  const raw = data?.choices?.[0]?.message?.content;
  if (!raw) return { ok: false, error: "DeepSeek 返回为空。" };

  return { ok: true, parsed: parseModelJson(raw), raw };
}

// 5-stage JSON resilience: strict → fenced → first {…} → smart-quote-fixed →
// per-field regex. We never dump the raw response into `meaning`.
function parseModelJson(raw) {
  if (!raw) return { meaning: "" };
  const original = String(raw);
  const tryParse = (s) => { try { return JSON.parse(s); } catch (_) { return null; } };

  let s = original.trim();
  let parsed = tryParse(s);
  if (parsed && typeof parsed === "object") return parsed;

  s = s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  parsed = tryParse(s);
  if (parsed && typeof parsed === "object") return parsed;

  const match = s.match(/\{[\s\S]*\}/);
  if (match) {
    parsed = tryParse(match[0]);
    if (parsed && typeof parsed === "object") return parsed;
  }

  const sFixed = s.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
  parsed = tryParse(sFixed);
  if (parsed && typeof parsed === "object") return parsed;
  const matchFixed = sFixed.match(/\{[\s\S]*\}/);
  if (matchFixed) {
    parsed = tryParse(matchFixed[0]);
    if (parsed && typeof parsed === "object") return parsed;
  }

  const fields = ["meaning", "in_context", "type", "note"];
  const out = {};
  for (const f of fields) {
    const re = new RegExp(
      `"${f}"\\s*:\\s*"([\\s\\S]*?)"\\s*(?=,\\s*"(?:meaning|in_context|type|note)"\\s*:|\\s*\\}\\s*$)`,
      "u",
    );
    const m = original.match(re);
    if (m) out[f] = m[1].replace(/\\"/g, '"').replace(/\\n/g, "\n").trim();
  }
  if (out.meaning || out.in_context) return out;

  return { meaning: "（解析模型回复失败，请重试一次）" };
}

// ---------- Eudic ----------

export async function saveToEudic(payload) {
  const { eudic_token } = getKeys();
  if (!eudic_token) {
    return { ok: false, code: "NO_TOKEN", error: "未设置欧陆 token，点右上角 ⚙ 填一下。" };
  }

  const wordBody = JSON.stringify({
    language: "en",
    word: payload.word,
    category_ids: [0],
  });
  const addResult = await eudicFetch(eudic_token, "/word", wordBody);
  if (!addResult.ok) return addResult;

  // Note attach is non-fatal — the word is already in the wordlist.
  let noteWarning = null;
  const noteText = buildNoteText(payload);
  if (noteText) {
    const noteBody = JSON.stringify({
      language: "en",
      word: payload.word,
      note: noteText,
    });
    const noteResult = await eudicFetch(eudic_token, "/note", noteBody);
    if (!noteResult.ok) {
      noteWarning = `单词已存入，但笔记写入失败：${noteResult.error}`;
    }
  }

  return { ok: true, warning: noteWarning };
}

// Try raw token first; on 401/403 retry with "NIS <token>" prefix
// (some accounts copy the token with that prefix from the dashboard).
async function eudicFetch(token, path, body) {
  const variants = [token, `NIS ${token}`];
  let lastError = "";
  for (const auth of variants) {
    try {
      const res = await fetch(eudicUrl(path), {
        method: "POST",
        headers: { Authorization: auth, "Content-Type": "application/json" },
        body,
      });
      if (res.ok) return { ok: true };
      const text = await res.text().catch(() => "");
      lastError = `Eudic ${res.status}: ${text.slice(0, 200)}`;
      if (res.status !== 401 && res.status !== 403) break;
    } catch (err) {
      lastError = `网络错误: ${err.message}`;
    }
  }
  return { ok: false, error: lastError || "Eudic 请求失败。" };
}

function buildNoteText(payload) {
  const parts = [];
  if (payload.in_context) parts.push(`【此处含义】${payload.in_context}`);
  if (payload.meaning && payload.meaning !== payload.in_context) {
    parts.push(`【释义】${payload.meaning}`);
  }
  if (payload.type) parts.push(`【词性】${payload.type}`);
  if (payload.note) parts.push(`【备注】${payload.note}`);
  if (payload.context) parts.push(`【原文】${payload.context}`);
  let text = parts.join("\n");
  if (text.length > EUDIC_NOTE_MAX) text = text.slice(0, EUDIC_NOTE_MAX - 1) + "…";
  return text;
}
