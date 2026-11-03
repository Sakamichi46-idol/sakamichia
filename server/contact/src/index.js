// サカミチア お問い合わせ（データの誤り・ご要望）受け側 Worker
// POST   /submit        : フォーム送信を受けて KV に保存する
// GET    /admin         : トークン認証つきで保存済み一覧を返す（?format=html で簡易HTML表示）
// DELETE /admin?key=... : トークン認証つきで1件削除する
// GET    /health        : 疎通確認
// 管理トークンは Worker シークレット ADMIN_TOKEN（GitHub シークレット CONTACT_ADMIN_TOKEN から
// デプロイ時に投入）。未設定の間は管理エンドポイントを閉じる（fail-closed）。

const ORIGIN_RE = /^https:\/\/([a-z0-9-]+\.)?sakamichia\.pages\.dev$/;
const TYPES = ["error", "bug", "request", "other"];
const TYPE_LABELS = { error: "データの誤り", bug: "バグ・不具合", request: "機能の要望", other: "その他" };

function corsHeaders(origin) {
  const h = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };
  if (origin && ORIGIN_RE.test(origin)) h["Access-Control-Allow-Origin"] = origin;
  return h;
}

function json(obj, status, extra) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: Object.assign({ "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }, extra || {}),
  });
}

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function checkAdmin(request, env, url) {
  if (!env.ADMIN_TOKEN) return json({ ok: false, error: "admin is not configured" }, 503);
  const token = url.searchParams.get("token") || request.headers.get("x-admin-token") || "";
  if (token !== env.ADMIN_TOKEN) return json({ ok: false, error: "unauthorized" }, 403);
  return null;
}

async function handleSubmit(request, env) {
  const origin = request.headers.get("Origin") || "";
  if (origin && !ORIGIN_RE.test(origin)) return json({ ok: false, error: "forbidden origin" }, 403, corsHeaders(origin));
  const len = Number(request.headers.get("Content-Length") || 0);
  if (len > 65536) return json({ ok: false, error: "too large" }, 413, corsHeaders(origin));
  let body;
  try { body = await request.json(); } catch (e) { return json({ ok: false, error: "invalid json" }, 400, corsHeaders(origin)); }
  // ハニーポット：ダミー項目に値が入っていたら、成功を装って保存しない
  if (typeof body.hp === "string" && body.hp !== "") return json({ ok: true }, 200, corsHeaders(origin));
  const type = String(body.type || "");
  const message = String(body.message || "").trim();
  const pageUrl = String(body.pageUrl || "").trim();
  const contact = String(body.contact || "").trim();
  if (!TYPES.includes(type)) return json({ ok: false, error: "invalid type" }, 400, corsHeaders(origin));
  if (!message) return json({ ok: false, error: "message is required" }, 400, corsHeaders(origin));
  if (message.length > 5000) return json({ ok: false, error: "message too long" }, 400, corsHeaders(origin));
  if (pageUrl.length > 1000) return json({ ok: false, error: "pageUrl too long" }, 400, corsHeaders(origin));
  if (contact.length > 300) return json({ ok: false, error: "contact too long" }, 400, corsHeaders(origin));
  const at = new Date().toISOString();
  const rand = Array.from(crypto.getRandomValues(new Uint8Array(4))).map((b) => b.toString(16).padStart(2, "0")).join("");
  const key = "msg:" + at + ":" + rand;
  const record = {
    type,
    message,
    pageUrl,
    contact,
    at,
    ua: String(request.headers.get("User-Agent") || "").slice(0, 200),
  };
  await env.CONTACT_KV.put(key, JSON.stringify(record));
  return json({ ok: true, id: key }, 200, corsHeaders(origin));
}

async function handleAdminGet(request, env, url) {
  const denied = checkAdmin(request, env, url);
  if (denied) return denied;
  const listed = await env.CONTACT_KV.list({ prefix: "msg:", limit: 200 });
  const items = [];
  for (const k of listed.keys) {
    const v = await env.CONTACT_KV.get(k.name);
    if (!v) continue;
    try { items.push(Object.assign({ key: k.name }, JSON.parse(v))); } catch (e) { /* 壊れた値は飛ばす */ }
  }
  items.sort((a, b) => (a.at < b.at ? 1 : -1));
  if (url.searchParams.get("format") === "html") {
    const rows = items.map((it) =>
      "<article style='border:1px solid #ccc;border-radius:8px;padding:10px 12px;margin:10px 0'>" +
      "<div style='color:#666;font-size:12px'>" + esc(it.at) + " / " + esc(TYPE_LABELS[it.type] || it.type) + "</div>" +
      "<p style='white-space:pre-wrap;margin:6px 0'>" + esc(it.message) + "</p>" +
      (it.pageUrl ? "<div style='font-size:12px'>対象: " + esc(it.pageUrl) + "</div>" : "") +
      (it.contact ? "<div style='font-size:12px'>連絡先: " + esc(it.contact) + "</div>" : "") +
      "</article>").join("");
    const html = "<!doctype html><html lang='ja'><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>" +
      "<title>お問い合わせ受信箱 | サカミチア</title><body style='font-family:sans-serif;max-width:760px;margin:16px auto;padding:0 12px'>" +
      "<h1 style='font-size:18px'>お問い合わせ受信箱（" + items.length + "件）</h1>" + (rows || "<p>まだ届いていません。</p>") + "</body></html>";
    return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
  }
  return json({ ok: true, count: items.length, items });
}

async function handleAdminDelete(request, env, url) {
  const denied = checkAdmin(request, env, url);
  if (denied) return denied;
  const key = url.searchParams.get("key") || "";
  if (!key.startsWith("msg:")) return json({ ok: false, error: "invalid key" }, 400);
  await env.CONTACT_KV.delete(key);
  return json({ ok: true });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (request.method === "OPTIONS" && url.pathname === "/submit") {
        return new Response(null, { status: 204, headers: corsHeaders(request.headers.get("Origin") || "") });
      }
      if (url.pathname === "/health") return json({ ok: true, service: "sakamichia-contact" });
      if (url.pathname === "/submit" && request.method === "POST") return await handleSubmit(request, env);
      if (url.pathname === "/admin" && request.method === "GET") return await handleAdminGet(request, env, url);
      if (url.pathname === "/admin" && request.method === "DELETE") return await handleAdminDelete(request, env, url);
      return json({ ok: false, error: "not found" }, 404);
    } catch (e) {
      return json({ ok: false, error: "internal error" }, 500);
    }
  },
};
