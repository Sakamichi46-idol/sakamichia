// サカミチア ドラフトオンライン対戦サーバー（Cloudflare Worker + Durable Objects）
// 部屋コード1つ = Durable Object 1インスタンスが対戦の状態を持ち、参加者全員の正とする。
// ゲームは「アイテムIDのプールから指名し合う」汎用ドラフトとして実装し、
// メンバー（ドラフト会議）でも楽曲（セトリ会議）でも同じサーバーで進行できる。
//
// クライアント → サーバー:
//   {t:"hello", token, name, create?:{config}}  接続直後に送る。create があれば部屋を作る（host）
//   {t:"start"}        host のみ。2人以上で開始
//   {t:"pick", item}   自分の指名をセット（差し替え可）
//   {t:"unpick"}       自分の指名を取り消す
//   {t:"setlist", order, encAt, title}  終了後、自分の並び順を共有（セトリ会議用）
//   {t:"backToLobby"}  host のみ。終了後にロビーへ戻す
//   {t:"ping"}
// サーバー → クライアント:
//   {t:"state", you, state}  変化のたび全員へ（you は自分のプレイヤーID）
//   {t:"error", message}
const MAX_PLAYERS = 4;

export class DraftRoom {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.state = null;
    this.ready = (async () => {
      this.state = (await ctx.storage.get("state")) || null;
    })();
  }
  async save() { await this.ctx.storage.put("state", this.state); }
  async touchAlarm() {
    try { await this.ctx.storage.setAlarm(Date.now() + 24 * 3600 * 1000); } catch (e) {}
  }
  async alarm() {
    for (const ws of this.ctx.getWebSockets()) { try { ws.close(1000, "room expired"); } catch (e) {} }
    await this.ctx.storage.deleteAll();
    this.state = null;
  }
  playerOf(ws) {
    try { return (ws.deserializeAttachment() || {}).pid || null; } catch (e) { return null; }
  }
  publicState() {
    const st = this.state;
    if (!st) return null;
    const socks = this.ctx.getWebSockets();
    const online = new Set();
    for (const ws of socks) { const pid = this.playerOf(ws); if (pid) online.add(pid); }
    return {
      code: st.code, phase: st.phase, eventSeq: st.eventSeq,
      config: { kind: st.config.kind, rounds: st.config.rounds, maxPlayers: st.config.maxPlayers, label: st.config.label || "", pool: st.config.pool, extra: st.config.extra || null },
      players: st.players.map(p => ({ id: p.id, name: p.name, host: p.id === st.hostId, connected: online.has(p.id) })),
      session: st.session, lastEvents: st.lastEvents || [],
      setlists: st.setlists || {}
    };
  }
  broadcast() {
    const pub = this.publicState();
    if (!pub) return;
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.send(JSON.stringify({ t: "state", you: this.playerOf(ws), state: pub })); } catch (e) {}
    }
  }
  send(ws, obj) { try { ws.send(JSON.stringify(obj)); } catch (e) {} }
  err(ws, message) { this.send(ws, { t: "error", message }); }

  async fetch(request) {
    const url = new URL(request.url);
    if (request.headers.get("Upgrade") === "websocket") {
      const pair = new WebSocketPair();
      const client = pair[0], server = pair[1];
      this.ctx.acceptWebSocket(server);
      return new Response(null, { status: 101, webSocket: client });
    }
    await this.ready;
    return Response.json({ ok: true, room: url.searchParams.get("room") || "",
      exists: !!this.state, phase: this.state?.phase || null,
      clients: this.ctx.getWebSockets().length });
  }

  /* ---------- ゲーム進行（draft-engine と同じ規則） ---------- */
  pendingPlayers() {
    const s = this.state.session;
    return this.state.players.filter(p => !s.roundWinners.includes(p.id));
  }
  resolveRound() {
    const st = this.state, s = st.session;
    const pend = this.pendingPlayers();
    if (!pend.length || pend.some(p => !s.picks[p.id])) return;
    const byItem = new Map();
    for (const p of pend) {
      const item = s.picks[p.id];
      if (!byItem.has(item)) byItem.set(item, []);
      byItem.get(item).push(p.id);
    }
    const events = [];
    for (const [item, cands] of byItem) {
      const winner = cands[Math.floor(Math.random() * cands.length)];
      s.acquired[winner].push(item);
      s.roundWinners.push(winner);
      events.push({ round: s.round, item, winner, candidates: [...cands], wasContested: cands.length > 1 });
    }
    s.history.push(...events);
    st.lastEvents = events;
    st.eventSeq++;
    const completed = s.roundWinners.length === st.players.length;
    const finished = completed && s.round >= st.config.rounds;
    s.picks = {};
    if (finished) {
      st.phase = "finished";
      s.status = "finished";
      s.message = `全${st.config.rounds}巡のドラフトが終了しました！`;
    } else if (completed) {
      s.round++; s.roundWinners = [];
      s.message = `第${s.round - 1}巡が確定しました。第${s.round}巡へ進みます。`;
    } else {
      s.message = "抽選結果が確定しました。落選したプレイヤーは再指名してください。";
    }
  }

  /* ---------- メッセージ処理 ---------- */
  async webSocketMessage(ws, message) {
    await this.ready;
    let msg = {};
    try { msg = JSON.parse(message); } catch (e) { return; }
    if (msg.t === "ping") { this.send(ws, { t: "pong", at: Date.now() }); return; }
    await this.touchAlarm();

    if (msg.t === "hello") {
      const token = String(msg.token || "");
      const name = String(msg.name || "").trim().slice(0, 20) || "プレイヤー";
      if (!token) { this.err(ws, "接続情報が不足しています。"); return; }
      if (!this.state) {
        if (!msg.create || !msg.create.config) { this.err(ws, "この部屋は存在しません。コードを確認してください。"); return; }
        const cfg = msg.create.config;
        const pool = Array.isArray(cfg.pool) ? cfg.pool.filter(x => typeof x === "string") : [];
        const rounds = Math.max(1, Math.min(40, +cfg.rounds || 12));
        const maxPlayers = Math.max(2, Math.min(MAX_PLAYERS, +cfg.maxPlayers || 4));
        if (pool.length < 2 * rounds) { this.err(ws, "候補プールが不足しています。設定を見直してください。"); return; }
        const extra = (cfg.extra && typeof cfg.extra === "object" && JSON.stringify(cfg.extra).length < 4000) ? cfg.extra : null;
        this.state = {
          code: String(msg.create.code || ""), phase: "lobby", eventSeq: 0,
          config: { kind: String(cfg.kind || "members"), rounds, maxPlayers, pool, label: String(cfg.label || "").slice(0, 120), extra },
          hostId: "p1",
          players: [{ id: "p1", token, name }],
          session: null, lastEvents: [], setlists: {}
        };
        ws.serializeAttachment({ pid: "p1", token });
        await this.save();
        this.broadcast();
        return;
      }
      const st = this.state;
      let pl = st.players.find(p => p.token === token);
      if (!pl) {
        if (st.phase !== "lobby") { this.err(ws, "この対戦はすでに始まっています。"); return; }
        if (st.players.length >= st.config.maxPlayers) { this.err(ws, "この部屋は満員です。"); return; }
        pl = { id: "p" + (st.players.length + 1), token, name };
        st.players.push(pl);
        await this.save();
      }
      ws.serializeAttachment({ pid: pl.id, token });
      this.broadcast();
      return;
    }

    const pid = this.playerOf(ws);
    if (!this.state || !pid) { this.err(ws, "まず hello を送ってください。"); return; }
    const st = this.state, s = st.session;
    const isHost = pid === st.hostId;

    if (msg.t === "start") {
      if (!isHost) { this.err(ws, "開始できるのは主催者だけです。"); return; }
      if (st.phase !== "lobby") return;
      if (st.players.length < 2) { this.err(ws, "2人以上そろうと開始できます。"); return; }
      if (st.config.pool.length < st.players.length * st.config.rounds) {
        this.err(ws, `候補は${st.config.pool.length}件です。${st.players.length}人×${st.config.rounds}巡には不足しています。`);
        return;
      }
      st.phase = "active";
      st.session = { round: 1, status: "active",
        acquired: Object.fromEntries(st.players.map(p => [p.id, []])),
        picks: {}, roundWinners: [], history: [],
        message: "第1巡：全員が指名すると自動で抽選します。" };
      st.lastEvents = [];
      await this.save(); this.broadcast();
      return;
    }

    if (msg.t === "pick" || msg.t === "unpick") {
      if (st.phase !== "active" || !s) return;
      if (s.roundWinners.includes(pid)) { this.err(ws, "この巡はすでに確定しています。"); return; }
      if (msg.t === "unpick") { delete s.picks[pid]; }
      else {
        const item = String(msg.item || "");
        if (!st.config.pool.includes(item)) { this.err(ws, "候補にないアイテムです。"); return; }
        if (Object.values(s.acquired).some(a => a.includes(item))) { this.err(ws, "すでに獲得済みのアイテムです。"); return; }
        s.picks[pid] = item;
      }
      await this.save();
      const pend = this.pendingPlayers();
      if (pend.length && pend.every(p => s.picks[p.id])) this.resolveRound();
      await this.save();
      this.broadcast();
      return;
    }

    if (msg.t === "setlist") {
      if (st.phase !== "finished") return;
      const orderArr = Array.isArray(msg.order) ? msg.order.filter(x => (s?.acquired[pid] || []).includes(x)) : [];
      st.setlists[pid] = { order: orderArr, encAt: (msg.encAt === null || msg.encAt === undefined) ? null : +msg.encAt,
        title: String(msg.title || "").slice(0, 40) };
      await this.save(); this.broadcast();
      return;
    }

    if (msg.t === "backToLobby") {
      if (!isHost) { this.err(ws, "戻せるのは主催者だけです。"); return; }
      st.phase = "lobby"; st.session = null; st.lastEvents = []; st.setlists = {};
      await this.save(); this.broadcast();
      return;
    }
  }
  async webSocketClose(ws) { this.broadcast(); }
  async webSocketError(ws) { try { ws.close(1011); } catch (e) {} }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/health")
      return Response.json({ ok: true, service: "sakamichia-draft", v: 2 });
    const m = url.pathname.match(/^\/api\/room\/([A-Za-z0-9]{4,8})$/);
    if (m) {
      const code = decodeURIComponent(m[1]).toUpperCase();
      const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
      return stub.fetch(new Request(`https://room.internal/?room=${code}`, request));
    }
    return new Response("not found", { status: 404 });
  }
};
