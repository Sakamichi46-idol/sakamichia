// セトリ会議（2〜4人・同じ端末で交代）：楽曲を指名し合うセトリドラフト。
// 競合はルーレット抽選、落選者は同巡で再指名。終了後は各自が曲順を並べ替えてセットリストにする。
const KEY = "sakamichia-setlist-meeting-v1";
const GORDER = ["乃木坂46", "櫻坂46", "日向坂46", "欅坂46", "けやき坂46", "坂道AKB", "坂道選抜"];
const GCOL = { "乃木坂46": "#7e57c2", "櫻坂46": "#e77a9b", "日向坂46": "#5aa9d6", "欅坂46": "#5eba53", "けやき坂46": "#a4c639", "坂道AKB": "#d24a43", "坂道選抜": "#2f9e8f" };
let SONGS = [], BYID = new Map();
let S = null, order = {}, enc = {}, titles = {};
let suGroups = new Set(GORDER);
let curPid = null, candGroup = "all", candType = "all", candQuery = "";
let lastEvents = [], finishTab = null, lotQueue = [], lotIdx = 0, lotTimer = null, imgBlob = null;

const $ = id => document.getElementById(id);
const smCountVal = () => Math.max(2, Math.min(50, +$("smCount").value || 2));
const smRoundsVal = () => Math.max(1, Math.min(100, +$("smRounds").value || 12));
const song = id => BYID.get(id);
const playerName = pid => S?.players.find(p => p.id === pid)?.name || pid;
function save() {
  try {
    if (S) localStorage.setItem(KEY, JSON.stringify({ S, order, enc, titles }));
    else localStorage.removeItem(KEY);
  } catch (e) {}
}
function msg(t) { const el = $("smMsg"); if (el) el.textContent = t; }

/* ---------- セッション ---------- */
function newSession(names, groups, rounds) {
  const pool = SONGS.filter(s => groups.includes(s.group));
  if (pool.length < names.length * rounds)
    throw new Error(`候補は${pool.length}曲です。${names.length}人×${rounds}曲（合計${names.length * rounds}曲）には不足しています。`);
  const players = names.map((n, i) => ({ id: "p" + (i + 1), name: n }));
  return { v: 1, players, groups, rounds, round: 1, status: "active",
    acquired: Object.fromEntries(players.map(p => [p.id, []])),
    picks: {}, roundWinners: [], history: [], message: "" };
}
function pendingPlayers() { return S.players.filter(p => !S.roundWinners.includes(p.id)); }
function isAcquired(id) { return Object.values(S.acquired).some(a => a.includes(id)); }
function resolvePicks() {
  const pend = pendingPlayers();
  if (!pend.length || pend.some(p => !S.picks[p.id])) throw new Error("全員の指名が揃っていません。");
  const bySong = new Map();
  for (const p of pend) {
    const sid = S.picks[p.id];
    if (!bySong.has(sid)) bySong.set(sid, []);
    bySong.get(sid).push(p.id);
  }
  const events = [];
  for (const [sid, cands] of bySong) {
    const winner = cands[Math.floor(Math.random() * cands.length)];
    S.acquired[winner].push(sid);
    S.roundWinners.push(winner);
    events.push({ round: S.round, songId: sid, winner, candidates: [...cands], wasContested: cands.length > 1 });
  }
  S.history.push(...events);
  const completed = S.roundWinners.length === S.players.length;
  const finished = completed && S.round >= S.rounds;
  S.picks = {};
  if (finished) {
    S.status = "finished";
    S.message = `全${S.rounds}巡のドラフトが終了しました！曲順を並べ替えて、セットリストを完成させましょう。`;
    initFinish();
  } else if (completed) {
    S.round++; S.roundWinners = [];
    S.message = `第${S.round - 1}巡が確定しました。第${S.round}巡へ進みます。`;
  } else {
    S.message = "抽選結果が確定しました。落選したプレイヤーは再指名してください。";
  }
  return events;
}
function initFinish() {
  for (const p of S.players) {
    if (!order[p.id]) order[p.id] = [...S.acquired[p.id]];
    if (enc[p.id] === undefined) enc[p.id] = order[p.id].length;
    if (!titles[p.id]) titles[p.id] = `${p.name}のセットリスト`;
  }
  if (!finishTab) finishTab = S.players[0].id;
}

/* ---------- 設定 ---------- */
function playerNames() {
  return [...$("smNames").querySelectorAll("input")].map((inp, i) => inp.value.trim().slice(0, 20) || `プレイヤー${i + 1}`);
}
function probe() {
  const pool = SONGS.filter(s => suGroups.has(s.group)).length;
  const n = smCountVal(), r = smRoundsVal();
  const ok = pool >= n * r;
  $("smPoolInfo").textContent = ok
    ? `候補は ${pool} 曲 ／ 必要 ${n * r} 曲（${n}人 × ${r}曲）。この設定で開始できます。`
    : `候補は ${pool} 曲 ／ 必要 ${n * r} 曲（${n}人 × ${r}曲）で、足りません。グループを増やすか曲数を減らしてください。`;
  $("smStart").disabled = !ok;
  $("smSetupSummary").textContent = S ? `対戦中（第${S.round}巡）` : `${[...suGroups].join("・")}／${r}曲ずつ`;
}
function renderSetup() {
  const gbox = $("smGroups");
  gbox.innerHTML = GORDER.map(g => {
    const n = SONGS.filter(s => s.group === g).length;
    return `<button type="button" class="ychip${suGroups.has(g) ? " on" : ""}" data-g="${g}">${g}（${n}）</button>`;
  }).join("");
  gbox.querySelectorAll("button").forEach(b => b.addEventListener("click", () => {
    const g = b.dataset.g;
    if (suGroups.has(g)) { if (suGroups.size > 1) suGroups.delete(g); } else suGroups.add(g);
    renderSetup();
  }));
  const names = $("smNames");
  const count = smCountVal();
  const prev = [...names.querySelectorAll("input")].map(i => i.value);
  names.innerHTML = Array.from({ length: count }, (_, i) =>
    `<input type="text" maxlength="20" placeholder="プレイヤー${i + 1}${i === 0 ? "（主催者）" : ""}" value="${esc(prev[i] || "")}">`).join("");
  probe();
}
function startGame() {
  try {
    S = newSession(playerNames(), [...suGroups], smRoundsVal());
  } catch (e) { alert(e.message); return; }
  order = {}; enc = {}; titles = {};
  curPid = S.players[0].id;
  candGroup = "all"; candType = "all"; candQuery = ""; lastEvents = []; finishTab = null;
  save();
  $("smSetupPanel").open = false;
  renderGame();
  msg("プレイヤー1から順に、指名する曲を選んでください。全員の指名が揃ったら抽選できます。");
}

/* ---------- 対戦 ---------- */
function nextCur() {
  const p = pendingPlayers().find(x => !S.picks[x.id]) || pendingPlayers()[0];
  if (p) curPid = p.id;
}
function songRow(s, sel) {
  return `<button type="button" class="sg-row${sel ? " sel" : ""}" data-id="${s.id}"><span class="sg-bar" style="background:${GCOL[s.group] || "#999"}"></span><span class="sg-main"><span class="sg-title">${esc(s.title)}</span><span class="sg-sub">${esc(s.group)} ・ ${esc(s.type)} ・ ${s.year}年${s.center ? " ・ C：" + esc(s.center) : ""} ・ ${esc(s.release || "")}</span></span></button>`;
}
function renderGame() {
  const active = S && S.status === "active";
  $("smGame").hidden = !active;
  $("smFinish").hidden = !(S && S.status === "finished");
  if (!S) return;
  if (S.status === "finished") { renderFinish(); return; }
  const pend = pendingPlayers();
  const pickedCount = pend.filter(p => S.picks[p.id]).length;
  $("smRound").textContent = `第${S.round}巡 ／ 全${S.rounds}巡`;
  $("smReady").textContent = `${pickedCount} / ${pend.length} 人が指名済み`;
  $("smPStats").innerHTML = S.players.map(p => {
    const won = S.roundWinners.includes(p.id);
    const pick = S.picks[p.id];
    const state = won ? `<span class="df-state ok">この巡は確定</span>`
      : pick ? `<span class="df-state ok">指名済み：${esc(song(pick)?.title || "")}</span>`
      : p.id === curPid ? `<span class="df-state turn">指名中…</span>` : `<span class="df-state">未指名</span>`;
    return `<button type="button" class="df-pstat${p.id === curPid && !won && !pick ? " turn" : ""}" data-pid="${p.id}" ${won || pick ? "disabled" : ""}><b>${esc(p.name)}</b>${p.id === "p1" ? "（主催者）" : ""}<br>獲得 ${S.acquired[p.id].length}曲<br>${state}</button>`;
  }).join("");
  $("smPStats").querySelectorAll(".df-pstat").forEach(b => b.addEventListener("click", () => { curPid = b.dataset.pid; renderGame(); }));
  const allPicked = pend.length > 0 && pend.every(p => S.picks[p.id]);
  $("smDraw").disabled = !allPicked;
  $("smDraw").textContent = allPicked ? "抽選する" : `抽選する（あと ${pend.length - pickedCount} 人）`;
  $("smUndoPick").disabled = !S.picks[curPid];
  renderCands();
  renderResults();
}
function renderCands() {
  const gbox = $("smCandGroups");
  gbox.innerHTML = ["all", ...S.groups].map(g => `<button type="button" class="ychip${candGroup === g ? " on" : ""}" data-g="${g}">${g === "all" ? "全グループ" : g}</button>`).join("");
  gbox.querySelectorAll("button").forEach(b => b.addEventListener("click", () => { candGroup = b.dataset.g; renderGame(); }));
  const typeSel = $("smCandType");
  const types = [...new Set(SONGS.filter(s => S.groups.includes(s.group)).map(s => s.type))];
  typeSel.innerHTML = `<option value="all">すべての種別</option>` + types.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join("");
  typeSel.value = types.includes(candType) ? candType : "all";
  const q = candQuery.trim();
  const list = SONGS.filter(s =>
    S.groups.includes(s.group) && !isAcquired(s.id) &&
    (candGroup === "all" || s.group === candGroup) &&
    (typeSel.value === "all" || s.type === typeSel.value) &&
    (!q || s.title.includes(q) || (s.yomi || "").includes(q) || (s.center || "").includes(q)));
  const sorted = [...list].sort((a, b) =>
    GORDER.indexOf(a.group) - GORDER.indexOf(b.group) || (a.date || "").localeCompare(b.date || "") || (a.ord || 0) - (b.ord || 0));
  $("smCandCount").textContent = `${playerName(curPid)} が指名中 ／ 候補 ${sorted.length} 曲`;
  $("smCands").innerHTML = sorted.slice(0, 300).map(s => songRow(s, S.picks[curPid] === s.id)).join("")
    || `<p style="color:var(--muted)">候補がありません。絞り込みを変えてください。</p>`;
  if (sorted.length > 300) $("smCands").innerHTML += `<p class="df-note">候補が多いため先頭300曲まで表示しています。検索で絞り込んでください。</p>`;
  $("smCands").querySelectorAll(".sg-row").forEach(c => c.addEventListener("click", () => doPick(c.dataset.id)));
}
function doPick(sid) {
  S.picks[curPid] = sid;
  save();
  msg(`${playerName(curPid)} が「${song(sid).title}」を指名しました。`);
  nextCur();
  renderGame();
}
function doDraw() {
  try { lastEvents = resolvePicks(); } catch (e) { msg(e.message); return; }
  save();
  lotQueue = lastEvents.filter(ev => ev.wasContested);
  lotIdx = 0;
  if (lotQueue.length) openLot();
  else if (S.status !== "finished") msg(S.message);
  if (S.status !== "finished") nextCur();
  renderGame();
}
function renderResults() {
  $("smHistCount").textContent = `全${S.history.length}件`;
  const box = $("smResults");
  if (lastEvents.length) {
    box.innerHTML = `<p class="df-note" style="margin-bottom:4px">直近の抽選結果</p>` + lastEvents.map(ev => {
      const losers = ev.candidates.filter(p => p !== ev.winner);
      return `<p class="df-hist">「${esc(song(ev.songId)?.title || "")}」 → <b>${esc(playerName(ev.winner))}</b>${ev.wasContested ? `（競合：${losers.map(playerName).join("・")} と抽選）` : ""}</p>`;
    }).join("");
  } else box.innerHTML = `<p style="color:var(--muted)">まだ抽選結果はありません。</p>`;
  $("smOwned").innerHTML = S.players.map(p => {
    const names = S.acquired[p.id].map(id => esc(song(id)?.title || "")).join("、");
    return `<p class="df-hist"><b>${esc(p.name)}</b>（${S.acquired[p.id].length}曲）：${names || "―"}</p>`;
  }).join("");
}

/* ---------- 競合ルーレット ---------- */
function openLot() {
  const ev = lotQueue[lotIdx];
  if (!ev) return;
  $("smLotCount").textContent = `${lotIdx + 1} / ${lotQueue.length} 件目の競合`;
  $("smLotSong").innerHTML = `指名が競合：<b>「${esc(song(ev.songId)?.title || "")}」</b>（${ev.candidates.map(playerName).join(" vs ")}）`;
  $("smLotResult").textContent = "";
  $("smLotNext").disabled = true;
  const dlg = $("smLotDlg");
  if (!dlg.open) dlg.showModal();
  const names = ev.candidates.map(playerName);
  let step = 0;
  const el = $("smLotName");
  clearInterval(lotTimer);
  lotTimer = setInterval(() => {
    el.textContent = names[step % names.length];
    step++;
    if (step > 16) {
      clearInterval(lotTimer);
      el.textContent = playerName(ev.winner);
      $("smLotResult").innerHTML = `<b>${esc(playerName(ev.winner))}</b> さんが獲得！ 落選した方はこの巡のうちに再指名してください。`;
      $("smLotNext").disabled = false;
      $("smLotNext").textContent = lotIdx + 1 < lotQueue.length ? "次の抽選へ" : "結果を見る";
    }
  }, 75);
}

/* ---------- 終了・並べ替え ---------- */
function numLabel(pid, i) {
  const st = enc[pid];
  return i < st ? `M${String(i + 1).padStart(2, "0")}` : `EN${i - st + 1}`;
}
function renderFinish() {
  if (!finishTab || !S.players.some(p => p.id === finishTab)) finishTab = S.players[0].id;
  $("smFinishInfo").textContent = `全${S.rounds}曲 × ${S.players.length}人`;
  $("smFinishMsg").textContent = S.message;
  $("smTabs").innerHTML = S.players.map(p =>
    `<button type="button" class="ychip${finishTab === p.id ? " on" : ""}" data-pid="${p.id}">${esc(p.name)}（${S.acquired[p.id].length}曲）</button>`).join("");
  $("smTabs").querySelectorAll("button").forEach(b => b.addEventListener("click", () => { finishTab = b.dataset.pid; renderFinish(); }));
  $("smTitle").value = titles[finishTab] || "";
  const list = order[finishTab];
  const encSel = $("smEncore");
  encSel.innerHTML = `<option value="${list.length}">アンコールなし</option>` +
    Array.from({ length: Math.max(0, list.length - 1) }, (_, i) => i + 1).map(i =>
      `<option value="${i}" ${enc[finishTab] === i ? "selected" : ""}>${i + 1}曲目からアンコール</option>`).join("");
  encSel.value = String(enc[finishTab]);
  let html = "";
  list.forEach((sid, i) => {
    const s = song(sid);
    if (enc[finishTab] < list.length && i === enc[finishTab]) html += `<div class="sl-encore-band">― アンコール ―</div>`;
    html += `<div class="sl-row"><span class="sl-num">${numLabel(finishTab, i)}</span><span class="sl-title">${esc(s.title)}<span class="sl-sub"> ／ ${esc(s.group)}${s.center ? " ・ C：" + esc(s.center) : ""}</span></span><button type="button" class="sl-mv" data-i="${i}" data-d="-1" ${i === 0 ? "disabled" : ""} aria-label="上へ">↑</button><button type="button" class="sl-mv" data-i="${i}" data-d="1" ${i === list.length - 1 ? "disabled" : ""} aria-label="下へ">↓</button></div>`;
  });
  $("smList").innerHTML = html || `<p style="color:var(--muted)">曲がありません。</p>`;
  $("smList").querySelectorAll(".sl-mv").forEach(b => b.addEventListener("click", () => {
    const i = +b.dataset.i, j = i + (+b.dataset.d);
    const arr = order[finishTab];
    [arr[i], arr[j]] = [arr[j], arr[i]];
    save(); renderFinish();
  }));
}

/* ---------- 画像出力 ---------- */
function drawSetlist(ctx, W, y0, pid, heading) {
  const list = order[pid];
  ctx.fillStyle = "#2b2430"; ctx.textAlign = "center";
  ctx.font = "700 30px sans-serif";
  ctx.fillText(heading.slice(0, 34), W / 2, y0 + 36);
  ctx.font = "700 24px sans-serif";
  ctx.fillText((titles[pid] || "").slice(0, 34), W / 2, y0 + 74);
  ctx.textAlign = "left";
  let y = y0 + 108;
  list.forEach((sid, i) => {
    const s = song(sid);
    if (enc[pid] < list.length && i === enc[pid]) {
      ctx.fillStyle = "#8a7f96"; ctx.font = "700 17px sans-serif"; ctx.textAlign = "center";
      ctx.fillText("― アンコール ―", W / 2, y + 6);
      ctx.textAlign = "left"; y += 30;
    }
    ctx.fillStyle = GCOL[s.group] || "#999";
    ctx.fillRect(56, y - 14, 7, 22);
    ctx.fillStyle = "#2b2430"; ctx.font = "800 19px sans-serif";
    ctx.fillText(numLabel(pid, i), 76, y + 4);
    ctx.font = "600 20px sans-serif";
    ctx.fillText(s.title.slice(0, 30), 150, y + 4);
    ctx.fillStyle = "#8a7f96"; ctx.font = "15px sans-serif";
    ctx.fillText(s.group, 700, y + 4);
    y += 32;
  });
  return y - y0 + 10;
}
async function buildImage(pids) {
  const W = 960;
  const per = pid => 118 + order[pid].length * 32 + (enc[pid] < order[pid].length ? 30 : 0) + 10;
  const H = 90 + pids.reduce((a, p) => a + per(p), 0) + 20;
  const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
  const ctx = cv.getContext("2d");
  ctx.fillStyle = "#faf9fb"; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#2b2430"; ctx.font = "700 40px sans-serif"; ctx.textAlign = "center";
  ctx.fillText("セトリ会議 結果", W / 2, 58);
  let y = 90;
  for (const pid of pids) y += drawSetlist(ctx, W, y, pid, `${playerName(pid)} のセットリスト`);
  return new Promise(res => cv.toBlob(res, "image/png"));
}

/* ---------- 初期化 ---------- */
async function init() {
  SONGS = await loadJSON("songs.json");
  BYID = new Map(SONGS.map(s => [s.id, s]));
  $("smCount").addEventListener("input", renderSetup);
  $("smRounds").addEventListener("input", probe);
  $("smStart").addEventListener("click", startGame);
  $("smDraw").addEventListener("click", doDraw);
  $("smUndoPick").addEventListener("click", () => {
    if (!S?.picks[curPid]) return;
    delete S.picks[curPid];
    save(); renderGame();
  });
  const reset = () => {
    if (!confirm("このドラフトを終了して、設定からやり直しますか？")) return;
    S = null; order = {}; enc = {}; titles = {}; save();
    $("smGame").hidden = true; $("smFinish").hidden = true;
    $("smSetupPanel").open = true;
    renderSetup();
  };
  $("smReset").addEventListener("click", reset);
  $("smReset2").addEventListener("click", reset);
  $("smCandSearch").addEventListener("input", e => { candQuery = e.target.value; renderCands(); });
  $("smCandType").addEventListener("input", e => { candType = e.target.value; renderCands(); });
  // 条件をリセット：候補の絞り込み（グループ・種別・検索）を初期状態に戻す
  $("smCandReset").addEventListener("click", () => { candGroup = "all"; candType = "all"; candQuery = ""; $("smCandSearch").value = ""; renderCands(); });
  $("smEncore").addEventListener("input", e => { enc[finishTab] = +e.target.value; save(); renderFinish(); });
  $("smTitle").addEventListener("input", e => { titles[finishTab] = e.target.value; save(); });
  $("smLotNext").addEventListener("click", () => {
    if (NET) return; // オンライン時は netLotStep 側が進める
    lotIdx++;
    if (lotIdx < lotQueue.length) { openLot(); return; }
    $("smLotDlg").close();
    if (S.status !== "finished") msg(S.message);
    renderGame();
  });
  const dlg = $("smImgDlg");
  const showImg = async pids => {
    imgBlob = await buildImage(pids);
    const box = $("smImgPreview");
    box.innerHTML = "";
    if (imgBlob) {
      const im = document.createElement("img");
      im.src = URL.createObjectURL(imgBlob);
      im.style.maxWidth = "100%";
      box.appendChild(im);
    }
    dlg.showModal();
  };
  $("smImg").addEventListener("click", () => showImg([finishTab]));
  $("smImgAll").addEventListener("click", () => showImg(S.players.map(p => p.id)));
  $("smImgClose").addEventListener("click", () => dlg.close());
  $("smImgDl").addEventListener("click", () => {
    if (!imgBlob) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(imgBlob); a.download = "sakamichia-setlist-meeting.png"; a.click();
  });
  $("smImgShare").addEventListener("click", async () => {
    if (!imgBlob) return;
    const file = new File([imgBlob], "sakamichia-setlist-meeting.png", { type: "image/png" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file] }); } catch (e) {}
    } else $("smImgDl").click();
  });
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const data = JSON.parse(raw);
      if (data && data.S && data.S.v === 1 && Array.isArray(data.S.players)) {
        S = data.S; order = data.order || {}; enc = data.enc || {}; titles = data.titles || {};
        $("smSetupPanel").open = false;
        if (S.status === "finished") { initFinish(); renderGame(); }
        else { nextCur(); renderGame(); msg("前回のドラフトの続きから再開しました。"); }
      }
    }
  } catch (e) {}
  renderSetup();
  if (!S) probe();
}
init();

/* ================= オンライン対戦（部屋コード式） =================
   サーバー（Worker + Durable Objects）が対戦の正。完成セトリの並び順もサーバー経由で共有する。 */
const NET_DEFAULT = "https://sakamichia-draft.pnlg11vs18ge.workers.dev";
const NET_BASE = (() => { try { return localStorage.getItem("sakamichia-net-base") || NET_DEFAULT; } catch (e) { return NET_DEFAULT; } })();
let NET = null;
let netCandGroup = "all", netCandType = "all", netTab = null;
let netLotBusy = false, netLastSeq = 0, netLotQueue = [], netShareTimer = null;

function netToken() {
  try {
    let t = localStorage.getItem("sakamichia-player-token");
    if (!t) { t = "tok-" + Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem("sakamichia-player-token", t); }
    return t;
  } catch (e) { return "tok-ephemeral-" + Math.random().toString(36).slice(2); }
}
function netMyName() { return ($("smMyName").value || "").trim().slice(0, 20) || "プレイヤー"; }
function netStatus(t) { $("smNetStatus").textContent = t; }
function netSend(o) { try { NET?.ws?.send(JSON.stringify(o)); } catch (e) {} }
function netPlayer(pid) { return NET?.state?.players.find(p => p.id === pid); }
function netIsHost() { return NET?.state?.players.find(p => p.id === NET.you)?.host; }

function netConnect(code, create) {
  netLeave(true);
  const ws = new WebSocket(NET_BASE.replace(/^http/, "ws") + "/api/room/" + encodeURIComponent(code));
  NET = { ws, code, you: null, state: null, intentional: false };
  netStatus(`接続中…（部屋 ${code}）`);
  ws.onopen = () => netSend({ t: "hello", token: netToken(), name: netMyName(), create: create || undefined });
  ws.onmessage = e => {
    let m = {};
    try { m = JSON.parse(e.data); } catch (err) { return; }
    if (m.t === "state") {
      NET.you = m.you; NET.state = m.state;
      try { sessionStorage.setItem("sm-room", code); } catch (err) {}
      netStatus(`接続中（部屋 ${code}）`);
      renderNet();
    } else if (m.t === "error") {
      netStatus("エラー");
      const el = !$("smLobby").hidden ? $("smLobbyMsg") : (NET.state ? $("smNetMsg") : null);
      if (el) el.textContent = m.message;
      else alert(m.message);
      if (/存在しません|満員|始まっています/.test(m.message)) netLeave();
    }
  };
  ws.onclose = () => {
    if (!NET || NET.intentional) return;
    netStatus("再接続中…");
    setTimeout(() => { if (NET && !NET.intentional) netConnect(code, null); }, 2500);
  };
}
function netLeave(silent) {
  if (NET) { NET.intentional = true; try { NET.ws.close(); } catch (e) {} NET = null; }
  try { sessionStorage.removeItem("sm-room"); } catch (e) {}
  $("smLobby").hidden = true; $("smNetGame").hidden = true; $("smNetFinish").hidden = true;
  netStatus("オフライン");
  if (!silent) { $("smSetupPanel").open = true; if (S) renderGame(); }
}
function netShowPanels() {
  const st = NET?.state;
  $("smLobby").hidden = !(st && st.phase === "lobby");
  $("smNetGame").hidden = !(st && st.phase === "active");
  $("smNetFinish").hidden = !(st && st.phase === "finished");
  if (st) { $("smGame").hidden = true; $("smFinish").hidden = true; $("smSetupPanel").open = false; }
}
function renderNet() {
  if (!NET?.state) return;
  if (!SONGS.length) { setTimeout(renderNet, 700); return; }
  netShowPanels();
  const st = NET.state;
  if (st.phase === "lobby") netRenderLobby();
  else if (st.phase === "active") netRenderGame();
  else if (st.phase === "finished") netRenderFinish();
  netMaybeLottery();
}

/* ---------- ロビー ---------- */
function netRenderLobby() {
  const st = NET.state;
  $("smRoomCode").textContent = st.code || NET.code;
  $("smLobbyPhase").textContent = `${st.players.length} / ${st.config.maxPlayers} 人`;
  $("smLobbyInfo").textContent = st.config.label || "";
  $("smLobbyPlayers").innerHTML = st.players.map(p =>
    `<p class="df-hist">${p.id === NET.you ? "👉 " : ""}<b>${esc(p.name)}</b>${p.host ? "（主催者）" : ""} ・ ${p.connected ? "接続中" : "切断（再接続待ち）"}</p>`).join("");
  const start = $("smNetStart");
  start.disabled = !(netIsHost() && st.players.length >= 2);
  start.textContent = netIsHost()
    ? (st.players.length >= 2 ? `対戦開始（${st.players.length}人）` : "対戦開始（2人以上で開始できます）")
    : "主催者が開始するのを待っています";
  $("smLobbyMsg").textContent = "部屋コードを一緒に遊ぶ人に伝えてください。全員そろったら主催者が開始します。";
}

/* ---------- 対戦 ---------- */
function netPending() {
  const s = NET.state.session;
  return NET.state.players.filter(p => !s.roundWinners.includes(p.id));
}
function netRenderGame() {
  const st = NET.state, s = st.session;
  const pend = netPending();
  const pickedCount = pend.filter(p => s.picks[p.id]).length;
  $("smNetRound").textContent = `第${s.round}巡 ／ 全${st.config.rounds}巡`;
  $("smNetReady").textContent = `${pickedCount} / ${pend.length} 人が指名済み`;
  $("smNetPStats").innerHTML = st.players.map(p => {
    const won = s.roundWinners.includes(p.id);
    const pick = s.picks[p.id];
    const state = won ? `<span class="df-state ok">この巡は確定</span>`
      : pick ? `<span class="df-state ok">指名済み：${esc(song(pick)?.title || "")}</span>`
      : (p.id === NET.you ? `<span class="df-state turn">あなたの番です</span>` : `<span class="df-state">未指名</span>`);
    return `<div class="df-pstat"><b>${esc(p.name)}</b>${p.host ? "（主催者）" : ""}${p.id === NET.you ? "（あなた）" : ""}<br>獲得 ${s.acquired[p.id].length}曲 ・ ${p.connected ? "接続中" : "切断中"}<br>${state}</div>`;
  }).join("");
  $("smNetMsg").textContent = s.message || "";
  $("smNetUnpick").disabled = !s.picks[NET.you];
  netRenderCands();
  netRenderResults();
}
function netRenderCands() {
  const st = NET.state, s = st.session;
  const pool = st.config.pool || [];
  const acquiredAny = new Set(Object.values(s.acquired).flat());
  const gbox = $("smNetCandGroups");
  const groups = GORDER.filter(g => pool.some(id => song(id)?.group === g));
  gbox.innerHTML = ["all", ...groups].map(g => `<button type="button" class="ychip${netCandGroup === g ? " on" : ""}" data-g="${g}">${g === "all" ? "全グループ" : g}</button>`).join("");
  gbox.querySelectorAll("button").forEach(b => b.addEventListener("click", () => { netCandGroup = b.dataset.g; netRenderCands(); }));
  const typeSel = $("smNetCandType");
  const types = [...new Set(pool.map(id => song(id)?.type).filter(Boolean))];
  typeSel.innerHTML = `<option value="all">すべての種別</option>` + types.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join("");
  if (!types.includes(netCandType)) netCandType = "all";
  typeSel.value = netCandType;
  const q = ($("smNetCandSearch").value || "").trim();
  const myTurn = netPending().some(p => p.id === NET.you) && !s.roundWinners.includes(NET.you);
  const list = pool.map(id => song(id)).filter(x => x && !acquiredAny.has(x.id)
    && (netCandGroup === "all" || x.group === netCandGroup)
    && (netCandType === "all" || x.type === netCandType)
    && (!q || x.title.includes(q) || (x.yomi || "").includes(q) || (x.center || "").includes(q)));
  const sorted = [...list].sort((a, b) =>
    GORDER.indexOf(a.group) - GORDER.indexOf(b.group) || (a.date || "").localeCompare(b.date || "") || (a.ord || 0) - (b.ord || 0));
  $("smNetCandCount").textContent = myTurn ? `あなたの指名中 ／ 候補 ${sorted.length} 曲` : `候補 ${sorted.length} 曲（他の人の指名待ち）`;
  $("smNetCands").innerHTML = sorted.slice(0, 300).map(x => songRow(x, s.picks[NET.you] === x.id)).join("")
    || `<p style="color:var(--muted)">候補がありません。絞り込みを変えてください。</p>`;
  if (sorted.length > 300) $("smNetCands").innerHTML += `<p class="df-note">候補が多いため先頭300曲まで表示しています。検索で絞り込んでください。</p>`;
  $("smNetCands").querySelectorAll(".sg-row").forEach(c => c.addEventListener("click", () => {
    if (!myTurn) return;
    netSend({ t: "pick", item: c.dataset.id });
  }));
}
function netRenderResults() {
  const st = NET.state, s = st.session;
  $("smNetHistCount").textContent = `全${s.history.length}件`;
  const evs = st.lastEvents || [];
  $("smNetResults").innerHTML = evs.length
    ? `<p class="df-note" style="margin-bottom:4px">直近の抽選結果</p>` + evs.map(ev => {
        const losers = ev.candidates.filter(p => p !== ev.winner);
        return `<p class="df-hist">「${esc(song(ev.item)?.title || "")}」 → <b>${esc(netPlayer(ev.winner)?.name || "")}</b>${ev.wasContested ? `（競合：${losers.map(p => esc(netPlayer(p)?.name || "")).join("・")} と抽選）` : ""}</p>`;
      }).join("")
    : `<p style="color:var(--muted)">まだ抽選結果はありません。</p>`;
  $("smNetOwned").innerHTML = st.players.map(p => {
    const names = s.acquired[p.id].map(id => esc(song(id)?.title || "")).join("、");
    return `<p class="df-hist"><b>${esc(p.name)}</b>（${s.acquired[p.id].length}曲）：${names || "―"}</p>`;
  }).join("");
}
function netMaybeLottery() {
  const st = NET?.state;
  if (!st || st.eventSeq === netLastSeq) return;
  netLastSeq = st.eventSeq;
  const contested = (st.lastEvents || []).filter(ev => ev.wasContested);
  if (!contested.length || netLotBusy) return;
  netLotQueue = contested; netLotBusy = true;
  netLotStep(0);
}
function netLotStep(i) {
  const ev = netLotQueue[i];
  if (!ev) { netLotBusy = false; try { $("smLotDlg").close(); } catch (e) {} return; }
  $("smLotCount").textContent = `${i + 1} / ${netLotQueue.length} 件目の競合`;
  $("smLotSong").innerHTML = `指名が競合：<b>「${esc(song(ev.item)?.title || "")}」</b>（${ev.candidates.map(p => esc(netPlayer(p)?.name || "")).join(" vs ")}）`;
  $("smLotResult").textContent = "";
  const next = $("smLotNext");
  next.disabled = true;
  const dlg = $("smLotDlg");
  if (!dlg.open) dlg.showModal();
  const names = ev.candidates.map(p => netPlayer(p)?.name || "");
  let step = 0;
  const el = $("smLotName");
  clearInterval(lotTimer);
  lotTimer = setInterval(() => {
    el.textContent = names[step % names.length];
    step++;
    if (step > 16) {
      clearInterval(lotTimer);
      el.textContent = netPlayer(ev.winner)?.name || "";
      $("smLotResult").innerHTML = `<b>${esc(netPlayer(ev.winner)?.name || "")}</b> さんが獲得しました！`;
      next.disabled = false;
      next.textContent = i + 1 < netLotQueue.length ? "次の抽選へ" : "結果を見る";
      next.onclick = () => netLotStep(i + 1);
    }
  }, 75);
}

/* ---------- 終了・セトリ共有 ---------- */
function netShared(pid) {
  const st = NET.state, shared = (st.setlists || {})[pid];
  const base = st.session.acquired[pid] || [];
  if (shared && Array.isArray(shared.order) && shared.order.length) {
    return { order: shared.order.filter(id => base.includes(id)), encAt: shared.encAt, title: shared.title || `${netPlayer(pid)?.name || ""}のセットリスト` };
  }
  return { order: [...base], encAt: null, title: `${netPlayer(pid)?.name || ""}のセットリスト` };
}
function netShareMine() {
  clearTimeout(netShareTimer);
  netShareTimer = setTimeout(() => {
    const mine = netShared(NET.you);
    netSend({ t: "setlist", order: mine.order, encAt: mine.encAt, title: mine.title });
  }, 350);
}
function netNumLabel(encAt, len, i) {
  const st = encAt === null || encAt === undefined ? len : Math.min(encAt, len);
  return i < st ? `M${String(i + 1).padStart(2, "0")}` : `EN${i - st + 1}`;
}
function netRenderFinish() {
  const st = NET.state, s = st.session;
  if (!netTab || !st.players.some(p => p.id === netTab)) netTab = NET.you;
  const mine = netTab === NET.you;
  const view = netShared(netTab);
  $("smNetFinishInfo").textContent = `全${st.config.rounds}曲 × ${st.players.length}人`;
  $("smNetFinishMsg").textContent = s.message || "";
  $("smNetTabs").innerHTML = st.players.map(p =>
    `<button type="button" class="ychip${netTab === p.id ? " on" : ""}" data-pid="${p.id}">${esc(p.name)}（${s.acquired[p.id].length}曲）${p.id === NET.you ? "・あなた" : ""}</button>`).join("");
  $("smNetTabs").querySelectorAll("button").forEach(b => b.addEventListener("click", () => { netTab = b.dataset.pid; netRenderFinish(); }));
  $("smNetTitle").value = view.title;
  $("smNetTitle").disabled = !mine;
  const encSel = $("smNetEncore");
  encSel.disabled = !mine;
  encSel.innerHTML = `<option value="">アンコールなし</option>` +
    Array.from({ length: Math.max(0, view.order.length - 1) }, (_, i) => i + 1).map(i =>
      `<option value="${i}" ${view.encAt === i ? "selected" : ""}>${i + 1}曲目からアンコール</option>`).join("");
  encSel.value = view.encAt === null || view.encAt === undefined ? "" : String(view.encAt);
  let html = "";
  view.order.forEach((sid, i) => {
    const x = song(sid);
    if (!x) return;
    if (view.encAt !== null && view.encAt !== undefined && i === view.encAt) html += `<div class="sl-encore-band">― アンコール ―</div>`;
    html += `<div class="sl-row"><span class="sl-num">${netNumLabel(view.encAt, view.order.length, i)}</span><span class="sl-title">${esc(x.title)}<span class="sl-sub"> ／ ${esc(x.group)}${x.center ? " ・ C：" + esc(x.center) : ""}</span></span>${mine ? `<button type="button" class="sl-mv" data-i="${i}" data-d="-1" ${i === 0 ? "disabled" : ""} aria-label="上へ">↑</button><button type="button" class="sl-mv" data-i="${i}" data-d="1" ${i === view.order.length - 1 ? "disabled" : ""} aria-label="下へ">↓</button>` : ""}</div>`;
  });
  $("smNetList").innerHTML = html || `<p style="color:var(--muted)">曲がありません。</p>`;
  if (mine) {
    $("smNetList").querySelectorAll(".sl-mv").forEach(b => b.addEventListener("click", () => {
      const cur = netShared(NET.you);
      const i = +b.dataset.i, j = i + (+b.dataset.d);
      [cur.order[i], cur.order[j]] = [cur.order[j], cur.order[i]];
      NET.state.setlists = NET.state.setlists || {};
      NET.state.setlists[NET.you] = cur;
      netShareMine();
      netRenderFinish();
    }));
  }
  $("smNetToLobby").disabled = !netIsHost();
  $("smNetToLobby").textContent = netIsHost() ? "ロビーに戻る（主催者）" : "ロビーに戻る（主催者のみ）";
}
async function netBuildImage(pids) {
  const st = NET.state;
  const keepS = S, keepOrder = order, keepEnc = enc, keepTitles = titles;
  S = { players: st.players.map(p => ({ id: p.id, name: p.name })) };
  order = {}; enc = {}; titles = {};
  for (const pid of pids) {
    const v = netShared(pid);
    order[pid] = v.order;
    enc[pid] = v.encAt === null || v.encAt === undefined ? v.order.length : v.encAt;
    titles[pid] = v.title;
  }
  try { return await buildImage(pids); }
  finally { S = keepS; order = keepOrder; enc = keepEnc; titles = keepTitles; }
}

/* ---------- 初期化 ---------- */
function netInit() {
  try { $("smMyName").value = localStorage.getItem("sm-myname") || ""; } catch (e) {}
  $("smMyName").addEventListener("input", e => { try { localStorage.setItem("sm-myname", e.target.value); } catch (err) {} });
  $("smModeChips").querySelectorAll("button").forEach(b => b.addEventListener("click", () => {
    if (NET) { alert("オンライン対戦中です。先に「部屋を出る」を押してください。"); return; }
    $("smModeChips").querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b));
    $("smOnlineBox").hidden = b.dataset.mode !== "online";
  }));
  const roomParam = new URLSearchParams(location.search).get("room");
  if (roomParam) {
    $("smJoinCode").value = roomParam.toUpperCase();
    $("smModeChips").querySelector('[data-mode="online"]').click();
  }
  $("smCreate").addEventListener("click", () => {
    if (!SONGS.length) { alert("データを読み込み中です。少し待ってからもう一度押してください。"); return; }
    const groups = [...suGroups];
    const rounds = smRoundsVal();
    const maxPlayers = smCountVal();
    const pool = SONGS.filter(x => groups.includes(x.group)).map(x => x.id);
    if (pool.length < 2 * rounds) { alert("候補が不足しています。設定を見直してください。"); return; }
    const code = Array.from({ length: 5 }, () => "ABCDEFGHJKMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 31)]).join("");
    netConnect(code, { code, config: { kind: "songs", rounds, maxPlayers, pool, label: `${groups.join("・")}／1人${rounds}曲`, extra: null } });
  });
  $("smJoin").addEventListener("click", () => {
    const code = ($("smJoinCode").value || "").trim().toUpperCase();
    if (code.length < 4) { alert("部屋コードを入力してください。"); return; }
    netConnect(code, null);
  });
  $("smCopyCode").addEventListener("click", async () => {
    const link = `${location.origin}${location.pathname}?room=${NET ? NET.code : ""}`;
    try { await navigator.clipboard.writeText(link); $("smLobbyMsg").textContent = "参加用リンクをコピーしました。このリンクを開くとコードが入力された状態になります。"; }
    catch (e) { $("smLobbyMsg").textContent = `参加用リンク：${link}`; }
  });
  $("smNetStart").addEventListener("click", () => netSend({ t: "start" }));
  $("smLeave").addEventListener("click", () => netLeave());
  $("smNetLeave2").addEventListener("click", () => netLeave());
  $("smNetUnpick").addEventListener("click", () => netSend({ t: "unpick" }));
  $("smNetCandSearch").addEventListener("input", () => netRenderCands());
  $("smNetCandType").addEventListener("input", e => { netCandType = e.target.value; netRenderCands(); });
  // 条件をリセット：候補の絞り込み（グループ・種別・検索）を初期状態に戻す
  $("smNetCandReset").addEventListener("click", () => { netCandGroup = "all"; netCandType = "all"; $("smNetCandSearch").value = ""; netRenderCands(); });
  $("smNetEncore").addEventListener("input", e => {
    const cur = netShared(NET.you);
    cur.encAt = e.target.value === "" ? null : +e.target.value;
    NET.state.setlists = NET.state.setlists || {};
    NET.state.setlists[NET.you] = cur;
    netShareMine();
    netRenderFinish();
  });
  $("smNetTitle").addEventListener("input", e => {
    if (netTab !== NET.you) return;
    const cur = netShared(NET.you);
    cur.title = e.target.value;
    NET.state.setlists = NET.state.setlists || {};
    NET.state.setlists[NET.you] = cur;
    netShareMine();
  });
  $("smNetToLobby").addEventListener("click", () => netSend({ t: "backToLobby" }));
  const dlg = $("smImgDlg");
  const showImg = async pids => {
    imgBlob = await netBuildImage(pids);
    const box = $("smImgPreview");
    box.innerHTML = "";
    if (imgBlob) {
      const im = document.createElement("img");
      im.src = URL.createObjectURL(imgBlob);
      im.style.maxWidth = "100%";
      box.appendChild(im);
    }
    dlg.showModal();
  };
  $("smNetImg").addEventListener("click", () => showImg([netTab]));
  $("smNetImgAll").addEventListener("click", () => showImg(NET.state.players.map(p => p.id)));
  let savedRoom = null;
  try { savedRoom = sessionStorage.getItem("sm-room"); } catch (e) {}
  if (savedRoom) {
    $("smModeChips").querySelector('[data-mode="online"]').click();
    netConnect(savedRoom, null);
  }
}
netInit();
