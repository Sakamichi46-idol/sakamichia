// サカミチア ドラフトオンライン対戦サーバー（Cloudflare Worker + Durable Objects）
// フェーズ1：土台（ヘルスチェック＋部屋へのWebSocket疎通）。ゲーム本体の進行はフェーズ2で実装する。
// 設計：部屋コード1つ = Durable Object 1インスタンスが状態を持ち、参加者全員の正とする。
export class DraftRoom {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }
  async fetch(request) {
    const url = new URL(request.url);
    if (request.headers.get("Upgrade") === "websocket") {
      const pair = new WebSocketPair();
      const client = pair[0], server = pair[1];
      this.ctx.acceptWebSocket(server); // ハイバネーション対応（待機中は課金されない）
      return new Response(null, { status: 101, webSocket: client });
    }
    return Response.json({
      ok: true,
      room: url.searchParams.get("room") || "",
      clients: this.ctx.getWebSockets().length
    });
  }
  async webSocketMessage(ws, message) {
    let data = {};
    try { data = JSON.parse(message); } catch (e) {}
    if (data.t === "ping") ws.send(JSON.stringify({ t: "pong", at: Date.now() }));
    else ws.send(JSON.stringify({ t: "echo", data }));
  }
  async webSocketClose(ws, code) {
    try { ws.close(code); } catch (e) {}
  }
  async webSocketError(ws) {
    try { ws.close(1011); } catch (e) {}
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/health")
      return Response.json({ ok: true, service: "sakamichia-draft", v: 1 });
    const m = url.pathname.match(/^\/api\/room\/([A-Za-z0-9]{4,8})$/);
    if (m) {
      const code = decodeURIComponent(m[1]).toUpperCase();
      const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
      return stub.fetch(new Request(`https://room.internal/?room=${code}`, request));
    }
    return new Response("not found", { status: 404 });
  }
};
