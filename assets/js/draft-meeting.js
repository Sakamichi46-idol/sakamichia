// ドラフト会議（2〜4人・同じ端末で交代）：旧『坂道日和』ドラフト会議の移植。
// 競合判定・抽選・配置のルールは draft-engine.js（SakamichiDraftEngine）に委譲し、ここは画面と進行管理。
const KEY = "sakamichia-draft-meeting-v1";
const GLABEL = { nogi: "乃木坂46", keyaki: "欅坂46", sakura: "櫻坂46", hiragana: "けやき坂46", hinata: "日向坂46" };
const GCOL_D = { nogi: "#7e57c2", keyaki: "#5eba53", sakura: "#e77a9b", hiragana: "#a4c639", hinata: "#5aa9d6" };
let E = null;
let session = null;
/* 設定フォームの状態 */
let suGroups = new Set(["nogi", "keyaki", "sakura", "hiragana", "hinata"]);
let suGens = {}; // groupId -> Set(gen)（未設定なら全期）
let suRows = [5, 6, 7];
/* 対戦中のUI状態 */
let curPid = null, candGroup = "all", candGen = "all", candQuery = "";
let uiSlot = null, lastEvents = [], finishTab = null, selPoolId = null, selSlotIdx = null;
let lotQueue = [], lotIdx = 0, lotTimer = null, imgBlob = null;

const $ = id => document.getElementById(id);
const member = id => window.DraftMemberById.get(id);
const photoOf = id => (window.DraftPhotoById || {})[id] || "";
const playerName = pid => session?.players.find(p => p.id === pid)?.name || pid;
function save() { try { session ? localStorage.setItem(KEY, JSON.stringify(session)) : localStorage.removeItem(KEY); } catch (e) {} }
function msg(t) { const el = $("dmMsg"); if (el) el.textContent = t; }

/* ---------- 設定 ---------- */
function buildOpts() {
  const allowedGenerations = {};
  for (const g of suGroups) {
    const full = E.availableGenerations(g);
    const sel = suGens[g];
    if (sel && sel.size < full.length) allowedGenerations[g] = [...sel].sort((a, b) => a - b);
  }
  const opts = {
    allowedGroups: [...suGroups], allowedGenerations,
    includeGraduates: $("dmGrad").checked,
    formation: { rows: [...suRows], placement: $("dmPlacement").value, showCenter: $("dmCenter").checked }
  };
  if ($("dmEra").checked && $("dmEraDate").value) opts.eraDate = $("dmEraDate").value;
  return opts;
}
function playerNames() {
  return [...$("dmNames").querySelectorAll("input")].map((inp, i) => inp.value.trim() || `プレイヤー${i + 1}`);
}
function probe() {
  const info = $("dmPoolInfo"), start = $("dmStart");
  try {
    const probeSession = E.createSession(playerNames(), buildOpts());
    const pool = E.eligibleMembers(probeSession).length;
    const need = probeSession.players.length * probeSession.roundLimit;
    info.textContent = `候補は ${pool} 人 ／ 必要 ${need} 人（${probeSession.players.length}人 × ${probeSession.roundLimit}巡）。この設定で開始できます。`;
    start.disabled = false;
  } catch (e) {
    info.textContent = e.message;
    start.disabled = true;
  }
  $("dmCountLabel").textContent = `${suRows.length}列・${suRows.reduce((a, b) => a + b, 0)}人`;
  $("dmSetupSummary").textContent = session ? `対戦中（第${session.round}巡）` : `${[...suGroups].map(g => GLABEL[g]).join("・")}／${suRows.reduce((a, b) => a + b, 0)}人編成`;
}
function renderSetup() {
  const gbox = $("dmGroups");
  gbox.innerHTML = E.GROUPS.map(g => `<button type="button" class="ychip${suGroups.has(g.id) ? " on" : ""}" data-g="${g.id}">${g.label}</button>`).join("");
  gbox.querySelectorAll("button").forEach(b => b.addEventListener("click", () => {
    const g = b.dataset.g;
    if (suGroups.has(g)) { if (suGroups.size > 1) suGroups.delete(g); } else suGroups.add(g);
    renderSetup();
  }));
  const gens = $("dmGens");
  gens.innerHTML = [...suGroups].map(g => {
    const full = E.availableGenerations(g);
    const sel = suGens[g] || new Set(full);
    const chips = full.map(n => `<button type="button" class="ychip${sel.has(n) ? " on" : ""}" data-g="${g}" data-n="${n}">${n === 0 ? "交換留学生" : n + "期"}</button>`).join("");
    return `<div class="df-genrow"><span class="df-genlabel">${GLABEL[g]}</span>${chips}</div>`;
  }).join("");
  gens.querySelectorAll("button").forEach(b => b.addEventListener("click", () => {
    const g = b.dataset.g, n = +b.dataset.n;
    const full = E.availableGenerations(g);
    const sel = new Set(suGens[g] || full);
    if (sel.has(n)) { if (sel.size > 1) sel.delete(n); } else sel.add(n);
    suGens[g] = sel;
    renderSetup();
  }));
  const names = $("dmNames");
  const count = +$("dmCount").value;
  const prev = [...names.querySelectorAll("input")].map(i => i.value);
  names.innerHTML = Array.from({ length: count }, (_, i) =>
    `<input type="text" maxlength="20" placeholder="プレイヤー${i + 1}${i === 0 ? "（主催者）" : ""}" value="${esc(prev[i] || "")}">`).join("");
  names.querySelectorAll("input").forEach(i => i.addEventListener("input", probe));
  const rc = $("dmRowCtl");
  rc.innerHTML = suRows.map((n, i) => `<span class="fm-stepper">${i + 1}列目 <button type="button" data-r="${i}" data-d="-1">−</button><b>${n}</b><button type="button" data-r="${i}" data-d="1">＋</button></span>`).join("");
  rc.querySelectorAll("button").forEach(b => b.addEventListener("click", () => {
    const r = +b.dataset.r, next = suRows[r] + (+b.dataset.d);
    if (next < 1 || next > 12) return;
    suRows = suRows.map((n, i) => i === r ? next : n);
    renderSetup();
  }));
  probe();
}
function startGame() {
  try {
    session = E.createSession(playerNames(), buildOpts());
  } catch (e) { alert(e.message); return; }
  curPid = session.players[0].id;
  candGroup = "all"; candGen = "all"; candQuery = ""; uiSlot = null; lastEvents = [];
  finishTab = null; selPoolId = null; selSlotIdx = null;
  save();
  $("dmSetupPanel").open = false;
  renderGame();
  msg("プレイヤー1から順に、指名するメンバーを選んでください。全員の指名が揃ったら抽選できます。");
}

/* ---------- 対戦 ---------- */
function pending() { return session ? E.pendingPlayers(session) : []; }
function nextCur() {
  const p = pending().find(x => !session.picks[x.id]) || pending()[0];
  if (p) curPid = p.id;
}
function slotIndexOf(rows, rowFront, col) { let b = 0; for (let r = 0; r < rowFront; r++) b += rows[r]; return b + col; }
function isCenterSlot(f, rowFront, col, count) {
  if (!f.showCenter || rowFront !== 0) return false;
  if (count % 2 === 1) return col === (count - 1) / 2;
  return col === count / 2 - 1 || col === count / 2;
}
function boardHTML(pid, editable) {
  const f = session.formation, rows = f.rows;
  const pos = session.placements[pid];
  const maxn = Math.max(...rows);
  let html = `<div style="--maxn:${maxn}">`;
  for (let v = rows.length - 1; v >= 0; v--) {
    const count = rows[v];
    html += `<div class="fm-row">`;
    for (let c = 0; c < count; c++) {
      const gi = slotIndexOf(rows, v, c);
      const id = pos[gi], m = id ? member(id) : null, url = id ? photoOf(id) : "";
      const ctr = isCenterSlot(f, v, c, count);
      const ph = m ? (url ? `<img src="${esc(url)}" alt="">` : `<span class="fm-initial" style="background:${GCOL_D[m.group]}">${esc(m.name.slice(0, 1))}</span>`) : "";
      const sel = editable && uiSlot === gi ? " sel" : editable && selSlotIdx === gi ? " sel" : "";
      html += `<button type="button" class="fm-tile${m ? " filled" : ""}${ctr ? " ctr" : ""}${sel}" data-slot="${gi}" ${editable ? "" : "disabled"}>${ph}<span class="fm-name">${m ? esc(m.name) : "―"}</span>${ctr ? `<span class="fm-star">★</span>` : ""}</button>`;
    }
    html += `</div>`;
  }
  return html + `</div>`;
}
function renderGame() {
  const active = session && session.status === "active";
  $("dmGame").hidden = !active;
  $("dmFinish").hidden = !(session && session.status === "finished");
  if (!session) return;
  if (session.status === "finished") { renderFinish(); return; }
  const pend = pending();
  const pickedCount = pend.filter(p => session.picks[p.id]).length;
  $("dmRound").textContent = `第${session.round}巡 ／ 全${session.roundLimit}巡`;
  $("dmReady").textContent = `${pickedCount} / ${pend.length} 人が指名済み`;
  $("dmPStats").innerHTML = session.players.map(p => {
    const won = session.roundWinners.includes(p.id);
    const pick = session.picks[p.id];
    const state = won ? `<span class="df-state ok">この巡は確定</span>`
      : pick ? `<span class="df-state ok">指名済み：${esc(member(pick)?.name || "")}</span>`
      : p.id === curPid ? `<span class="df-state turn">指名中…</span>` : `<span class="df-state">未指名</span>`;
    return `<button type="button" class="df-pstat${p.id === curPid && !won && !pick ? " turn" : ""}" data-pid="${p.id}" ${won || pick ? "disabled" : ""}><b>${esc(p.name)}</b>${p.id === session.hostId ? "（主催者）" : ""}<br>獲得 ${session.acquired[p.id].length}人<br>${state}</button>`;
  }).join("");
  $("dmPStats").querySelectorAll(".df-pstat").forEach(b => b.addEventListener("click", () => { curPid = b.dataset.pid; uiSlot = null; renderGame(); }));
  const allPicked = pend.length > 0 && pend.every(p => session.picks[p.id]);
  $("dmDraw").disabled = !allPicked;
  $("dmDraw").textContent = allPicked ? "抽選する" : `抽選する（あと ${pend.length - pickedCount} 人）`;
  $("dmUndoPick").disabled = !session.picks[curPid];
  /* during配置ボード */
  const during = session.formation.placement === "during";
  $("dmDuringWrap").hidden = !during;
  if (during) {
    $("dmDuringName").textContent = playerName(curPid);
    $("dmDuringBoard").innerHTML = boardHTML(curPid, true);
    $("dmDuringBoard").querySelectorAll(".fm-tile").forEach(t => t.addEventListener("click", () => {
      const gi = +t.dataset.slot;
      if (session.placements[curPid][gi]) return;
      uiSlot = uiSlot === gi ? null : gi;
      renderGame();
    }));
  }
  renderCands();
  renderResults();
}
function renderCands() {
  const gbox = $("dmCandGroups");
  const groups = ["all", ...session.allowedGroups];
  gbox.innerHTML = groups.map(g => `<button type="button" class="ychip${candGroup === g ? " on" : ""}" data-g="${g}">${g === "all" ? "全グループ" : GLABEL[g]}</button>`).join("");
  gbox.querySelectorAll("button").forEach(b => b.addEventListener("click", () => { candGroup = b.dataset.g; candGen = "all"; renderGame(); }));
  const genSel = $("dmCandGen");
  if (candGroup === "all") { genSel.innerHTML = `<option value="all">すべての期</option>`; genSel.disabled = true; }
  else {
    genSel.disabled = false;
    let gens = E.availableGenerations(candGroup);
    const allowed = session.allowedGenerations[candGroup];
    if (Array.isArray(allowed)) gens = gens.filter(n => allowed.includes(n));
    genSel.innerHTML = `<option value="all">すべての期</option>` + gens.map(n => `<option value="${n}">${n === 0 ? "交換留学生" : n + "期"}</option>`).join("");
    genSel.value = candGen;
  }
  const q = candQuery.trim();
  const list = E.MEMBERS.filter(m =>
    E.eligibleMember(session, m) && !E.isAcquired(session, m.id) &&
    (candGroup === "all" || E.memberInGroup(m, candGroup)) &&
    (candGen === "all" || m.generation === +candGen) &&
    (!q || m.name.includes(q) || (m.reading || "").includes(q)));
  const sorted = [...list].sort((a, b) => E.compareMembersForGroup(a, b, candGroup));
  $("dmCandCount").textContent = `${playerName(curPid)} が指名中 ／ 候補 ${sorted.length} 人`;
  const myPick = session.picks[curPid];
  $("dmCands").innerHTML = sorted.map(m => {
    const url = photoOf(m.id);
    const ph = url ? `<img loading="lazy" src="${esc(url)}" alt="">` : `<span class="fm-initial" style="background:${GCOL_D[m.group]}">${esc(m.name.slice(0, 1))}</span>`;
    return `<button type="button" class="fm-cand${myPick === m.id ? " sel" : ""}" data-id="${m.id}"><span class="mb-photo">${ph}</span><span class="fm-name">${esc(m.name)}</span><span class="fm-sub">${GLABEL[m.group]}${m.generation ? "・" + m.generation + "期" : "・交換留学生"}${m.graduated ? "・卒業" : ""}</span></button>`;
  }).join("") || `<p style="color:var(--muted)">候補がいません。絞り込みを変えてください。</p>`;
  $("dmCands").querySelectorAll(".fm-cand").forEach(c => c.addEventListener("click", () => doPick(c.dataset.id)));
}
function doPick(mid) {
  if (session.formation.placement === "during" && uiSlot === null) {
    msg("先に上のボードで、配置する空き枠を選んでください。");
    $("dmDuringWrap").scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
  try {
    session = E.setPick(session, curPid, mid, session.formation.placement === "during" ? uiSlot : null);
  } catch (e) { msg(e.message); return; }
  uiSlot = null;
  save();
  msg(`${playerName(curPid)} が ${member(mid).name} を指名しました。`);
  nextCur();
  renderGame();
}
function doDraw() {
  const before = session.history.length;
  try { session = E.resolvePicks(session); } catch (e) { msg(e.message); return; }
  lastEvents = session.history.slice(before);
  save();
  lotQueue = lastEvents.filter(ev => ev.wasContested);
  lotIdx = 0;
  if (lotQueue.length) openLot();
  renderGame();
  if (session.status === "finished") renderGame();
  else if (!lotQueue.length) msg(session.message);
}
function renderResults() {
  $("dmHistCount").textContent = `全${session.history.length}件`;
  const box = $("dmResults");
  if (lastEvents.length) {
    box.innerHTML = `<p class="df-note" style="margin-bottom:4px">直近の抽選結果</p>` + lastEvents.map(ev => {
      const losers = ev.candidates.filter(p => p !== ev.winner);
      return `<p class="df-hist">${esc(member(ev.memberId)?.name || "")} → <b>${esc(playerName(ev.winner))}</b>${ev.wasContested ? `（競合：${losers.map(playerName).join("・")} と抽選）` : ""}</p>`;
    }).join("");
  } else box.innerHTML = `<p style="color:var(--muted)">まだ抽選結果はありません。</p>`;
  $("dmOwned").innerHTML = session.players.map(p => {
    const names = session.acquired[p.id].map(id => esc(member(id)?.name || "")).join("、");
    return `<p class="df-hist"><b>${esc(p.name)}</b>（${session.acquired[p.id].length}人）：${names || "―"}</p>`;
  }).join("");
}

/* ---------- 競合ルーレット ---------- */
function openLot() {
  const ev = lotQueue[lotIdx];
  if (!ev) return;
  $("dmLotCount").textContent = `${lotIdx + 1} / ${lotQueue.length} 件目の競合`;
  $("dmLotMember").innerHTML = `指名が競合：<b>${esc(member(ev.memberId)?.name || "")}</b>（${ev.candidates.map(playerName).join(" vs ")}）`;
  $("dmLotResult").textContent = "";
  $("dmLotNext").disabled = true;
  const dlg = $("dmLotDlg");
  if (!dlg.open) dlg.showModal();
  const names = ev.candidates.map(playerName);
  let step = 0;
  const el = $("dmLotName");
  clearInterval(lotTimer);
  lotTimer = setInterval(() => {
    el.textContent = names[step % names.length];
    step++;
    if (step > 16) {
      clearInterval(lotTimer);
      el.textContent = playerName(ev.winner);
      $("dmLotResult").innerHTML = `<b>${esc(playerName(ev.winner))}</b> さんが獲得！ 落選した方はこの巡のうちに再指名してください。`;
      $("dmLotNext").disabled = false;
      $("dmLotNext").textContent = lotIdx + 1 < lotQueue.length ? "次の抽選へ" : "結果を見る";
    }
  }, 75);
}

/* ---------- 終了・配置 ---------- */
function renderFinish() {
  if (!finishTab || !session.players.some(p => p.id === finishTab)) finishTab = session.players[0].id;
  $("dmFinishInfo").textContent = `全${session.roundLimit}巡・${session.players.length}人`;
  $("dmFinishMsg").textContent = session.message;
  $("dmTabs").innerHTML = session.players.map(p =>
    `<button type="button" class="ychip${finishTab === p.id ? " on" : ""}" data-pid="${p.id}">${esc(p.name)}（${session.acquired[p.id].length}人）</button>`).join("");
  $("dmTabs").querySelectorAll("button").forEach(b => b.addEventListener("click", () => { finishTab = b.dataset.pid; selPoolId = null; selSlotIdx = null; renderFinish(); }));
  const after = session.formation.placement === "after";
  $("dmPlaceHint").hidden = !after;
  $("dmBoard").innerHTML = boardHTML(finishTab, after);
  $("dmBoard").style.setProperty("--dummy", "1");
  if (after) {
    $("dmBoard").querySelectorAll(".fm-tile").forEach(t => t.addEventListener("click", () => onFinishSlot(+t.dataset.slot)));
  }
  const placed = session.placements[finishTab].filter(Boolean).length;
  const poolIds = session.acquired[finishTab].filter(id => !session.placements[finishTab].includes(id));
  $("dmPoolCount").textContent = `${poolIds.length}人（配置済み ${placed}人）`;
  $("dmPool").innerHTML = poolIds.map(id => {
    const m = member(id), url = photoOf(id);
    const ph = url ? `<img loading="lazy" src="${esc(url)}" alt="">` : `<span class="fm-initial" style="background:${GCOL_D[m.group]}">${esc(m.name.slice(0, 1))}</span>`;
    return `<button type="button" class="fm-cand${selPoolId === id ? " sel" : ""}" data-id="${id}"><span class="mb-photo">${ph}</span><span class="fm-name">${esc(m.name)}</span><span class="fm-sub">${GLABEL[m.group]}</span></button>`;
  }).join("") || `<p style="color:var(--muted)">未配置のメンバーはいません。</p>`;
  $("dmPool").querySelectorAll(".fm-cand").forEach(c => c.addEventListener("click", () => {
    selPoolId = selPoolId === c.dataset.id ? null : c.dataset.id;
    selSlotIdx = null;
    renderFinish();
  }));
}
function onFinishSlot(gi) {
  try {
    if (selPoolId) {
      session = E.placeMember(session, finishTab, gi, selPoolId);
      selPoolId = null;
    } else if (selSlotIdx === null) {
      if (session.placements[finishTab][gi]) selSlotIdx = gi; else return;
    } else if (selSlotIdx === gi) {
      session = E.placeMember(session, finishTab, gi, null);
      selSlotIdx = null;
    } else {
      const mid = session.placements[finishTab][selSlotIdx];
      if (mid) session = E.placeMember(session, finishTab, gi, mid);
      selSlotIdx = null;
    }
  } catch (e) { msg(e.message); return; }
  save(); renderFinish();
}

/* ---------- 画像出力 ---------- */
async function drawBoard(ctx, pid, W, y0, title) {
  const f = session.formation, rows = f.rows;
  const maxn = Math.max(...rows);
  const gap = 12;
  const tileW = Math.min(150, Math.floor((W - (maxn - 1) * gap - 8) / maxn));
  const tileH = Math.round(tileW * 1.44), rowGap = 22;
  ctx.fillStyle = "#2b2430"; ctx.font = "700 34px sans-serif"; ctx.textAlign = "center";
  ctx.fillText(title.slice(0, 30), W / 2, y0 + 40);
  const load = src => new Promise(res => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = src; });
  const pos = session.placements[pid];
  for (let v = rows.length - 1; v >= 0; v--) {
    const count = rows[v];
    const y = y0 + 64 + (rows.length - 1 - v) * (tileH + rowGap);
    const x0 = (W - (count * tileW + (count - 1) * gap)) / 2;
    for (let c = 0; c < count; c++) {
      const id = pos[slotIndexOf(rows, v, c)];
      const x = x0 + c * (tileW + gap);
      ctx.fillStyle = "#fff"; ctx.strokeStyle = isCenterSlot(f, v, c, count) ? "#e77a9b" : "#e3dde8";
      ctx.lineWidth = isCenterSlot(f, v, c, count) ? 4 : 2;
      ctx.beginPath(); ctx.roundRect(x, y, tileW, tileH, 12); ctx.fill(); ctx.stroke();
      if (!id) continue;
      const m = member(id), url = photoOf(id);
      const im = url ? await load(url) : null;
      if (im) {
        ctx.save(); ctx.beginPath(); ctx.roundRect(x + 5, y + 5, tileW - 10, tileW - 10, 8); ctx.clip();
        const s = Math.max((tileW - 10) / im.width, (tileW - 10) / im.height);
        ctx.drawImage(im, x + 5 + (tileW - 10 - im.width * s) / 2, y + 5, im.width * s, im.height * s);
        ctx.restore();
      } else {
        ctx.fillStyle = GCOL_D[m.group]; ctx.font = "700 40px sans-serif";
        ctx.fillText(m.name.slice(0, 1), x + tileW / 2, y + tileW * 0.62);
      }
      ctx.fillStyle = "#2b2430"; ctx.font = `600 ${Math.max(13, Math.round(tileW * 0.14))}px sans-serif`;
      ctx.fillText(m.name, x + tileW / 2, y + tileH - 10);
    }
  }
  return 64 + rows.length * (tileH + rowGap) + 12;
}
async function buildImage(pids) {
  const W = 960;
  const probe = document.createElement("canvas").getContext("2d");
  const rows = session.formation.rows, maxn = Math.max(...rows);
  const tileW = Math.min(150, Math.floor((W - (maxn - 1) * 12 - 8) / maxn));
  const oneH = 64 + rows.length * (Math.round(tileW * 1.44) + 22) + 12;
  const H = 96 + pids.length * oneH + 16;
  const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
  const ctx = cv.getContext("2d");
  ctx.fillStyle = "#faf9fb"; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#2b2430"; ctx.font = "700 42px sans-serif"; ctx.textAlign = "center";
  ctx.fillText("ドラフト会議 結果", W / 2, 62);
  let y = 96;
  for (const pid of pids) y += await drawBoard(ctx, pid, W, y, `${playerName(pid)} の編成`);
  return new Promise(res => cv.toBlob(res, "image/png"));
}

/* ---------- 初期化 ---------- */
async function init() {
  await DraftData.load();
  await DraftData.loadScript(BASE + "assets/js/draft-era.js");
  await DraftData.loadScript(BASE + "assets/js/draft-engine.js");
  E = window.SakamichiDraftEngine;
  $("dmEra").addEventListener("input", () => { $("dmEraDateWrap").hidden = !$("dmEra").checked; probe(); });
  $("dmEraDate").addEventListener("input", probe);
  $("dmGrad").addEventListener("input", probe);
  $("dmCount").addEventListener("input", renderSetup);
  $("dmPlacement").addEventListener("input", probe);
  $("dmCenter").addEventListener("input", probe);
  $("dmCols").addEventListener("input", e => {
    const n = +e.target.value;
    if (n === suRows.length) return;
    suRows = Array.from({ length: n }, (_, i) => suRows[i] ?? 6);
    renderSetup();
  });
  $("dmStart").addEventListener("click", startGame);
  $("dmDraw").addEventListener("click", doDraw);
  $("dmUndoPick").addEventListener("click", () => {
    if (!session?.picks[curPid]) return;
    session = E.clearPick(session, curPid);
    save(); renderGame();
  });
  const reset = () => {
    if (!confirm("このドラフトを終了して、設定からやり直しますか？")) return;
    session = null; save();
    $("dmGame").hidden = true; $("dmFinish").hidden = true;
    $("dmSetupPanel").open = true;
    renderSetup();
  };
  $("dmReset").addEventListener("click", reset);
  $("dmReset2").addEventListener("click", reset);
  $("dmCandSearch").addEventListener("input", e => { candQuery = e.target.value; renderCands(); });
  $("dmCandGen").addEventListener("input", e => { candGen = e.target.value; renderCands(); });
  $("dmLotNext").addEventListener("click", () => {
    lotIdx++;
    if (lotIdx < lotQueue.length) { openLot(); return; }
    $("dmLotDlg").close();
    msg(session.status === "finished" ? session.message : (session.message || ""));
    renderGame();
  });
  const dlg = $("dmImgDlg");
  const showImg = async pids => {
    imgBlob = await buildImage(pids);
    const box = $("dmImgPreview");
    box.innerHTML = "";
    if (imgBlob) {
      const im = document.createElement("img");
      im.src = URL.createObjectURL(imgBlob);
      im.style.maxWidth = "100%";
      box.appendChild(im);
    }
    dlg.showModal();
  };
  $("dmImg").addEventListener("click", () => showImg([finishTab]));
  $("dmImgAll").addEventListener("click", () => showImg(session.players.map(p => p.id)));
  $("dmImgClose").addEventListener("click", () => dlg.close());
  $("dmImgDl").addEventListener("click", () => {
    if (!imgBlob) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(imgBlob); a.download = "sakamichia-draft-meeting.png"; a.click();
  });
  $("dmImgShare").addEventListener("click", async () => {
    if (!imgBlob) return;
    const file = new File([imgBlob], "sakamichia-draft-meeting.png", { type: "image/png" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file] }); } catch (e) {}
    } else $("dmImgDl").click();
  });
  /* 前回の続き */
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = E.normalizeSession(JSON.parse(raw));
      if (s && E.isValidSession(s)) {
        session = s;
        $("dmSetupPanel").open = false;
        if (session.status === "finished") { renderGame(); }
        else { nextCur(); renderGame(); msg("前回のドラフトの続きから再開しました。"); }
      }
    }
  } catch (e) {}
  renderSetup();
  if (!session) probe();
}
init();
