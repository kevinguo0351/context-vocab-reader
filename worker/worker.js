// Cloudflare Worker — pure proxy that adds CORS headers so the reader's
// browser/PWA build can hit DeepSeek + Eudic without same-origin restrictions.
// API keys still live in the user's localStorage and are forwarded as the
// Authorization header — the Worker does NOT store credentials.
//
// ---------- Deploy ----------
//
// 1) Cloudflare dashboard → Workers & Pages → Create → Hello World template.
// 2) Replace the editor contents with this entire file. Save & Deploy.
// 3) Note the assigned URL (e.g. https://<name>.<acct>.workers.dev).
// 4) In the reader's ⚙ settings, paste that URL into "代理 URL".
//
// That's it. No env vars, no KV, no secrets to manage.
//
// ---------- Routes ----------
//
// POST /deepseek      → POST https://api.deepseek.com/v1/chat/completions
// POST /eudic/word    → POST https://api.frdic.com/api/open/v1/studylist/word
// POST /eudic/note    → POST https://api.frdic.com/api/open/v1/studylist/note
// OPTIONS *           → CORS preflight ack

const ROUTES = {
  "/deepseek": "https://api.deepseek.com/v1/chat/completions",
  "/eudic/word": "https://api.frdic.com/api/open/v1/studylist/word",
  "/eudic/note": "https://api.frdic.com/api/open/v1/studylist/note",
};

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Max-Age": "86400",
};

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    const url = new URL(request.url);
    const target = ROUTES[url.pathname];
    if (!target) {
      return jsonResponse({ error: "Not found" }, 404);
    }
    if (request.method !== "POST") {
      return jsonResponse({ error: "POST only" }, 405);
    }

    const upstream = await fetch(target, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: request.headers.get("Authorization") || "",
      },
      body: await request.text(),
    });

    const body = await upstream.text();
    return new Response(body, {
      status: upstream.status,
      headers: {
        ...CORS,
        "Content-Type": upstream.headers.get("Content-Type") || "application/json",
      },
    });
  },
};

function jsonResponse(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
