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
  $("dmCols").value = String(suRows.length);
  const names = $("dmNames");
  const count = Math.max(2, Math.min(50, +$("dmCount").value || 2));
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
  else nextCur();
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
  if (selPoolId) {
    try { session = E.placeMember(session, finishTab, gi, selPoolId); }
    catch (e) { msg(e.message); return; }
    selPoolId = null;
    save(); renderFinish();
    return;
  }
  const cur = session.placements[finishTab][gi];
  openSlotPicker({
    title: `配置するメンバーを選ぶ（${gi + 1}枠目）`,
    ids: session.acquired[finishTab].filter(id => id !== cur),
    current: cur,
    onChoose: id => {
      try { session = E.placeMember(session, finishTab, gi, id); }
      catch (e) { msg(e.message); return; }
      save(); renderFinish();
    }
  });
}

/* ---------- 配置先タップで開く候補ピッカー（ローカル・オンライン共用） ---------- */
let pickCtx = null, pickGroup = "all", pickGen = "all";
function openSlotPicker(ctx) {
  pickCtx = ctx; pickGroup = "all"; pickGen = "all";
  $("dmPickSearch").value = "";
  $("dmPickTitle").textContent = ctx.title;
  $("dmPickRemove").style.display = ctx.current ? "" : "none";
  renderSlotPicker();
  $("dmPickDlg").showModal();
}
function renderSlotPicker() {
  if (!pickCtx) return;
  const ids = pickCtx.ids;
  const gbox = $("dmPickGroups");
  const groups = GKEY_ORDER.filter(g => ids.some(id => { const m = member(id); return m && E.memberInGroup(m, g); }));
  gbox.innerHTML = ["all", ...groups].map(g => `<button type="button" class="ychip${pickGroup === g ? " on" : ""}" data-g="${g}">${g === "all" ? "全グループ" : GLABEL[g]}</button>`).join("");
  gbox.querySelectorAll("button").forEach(b => b.addEventListener("click", () => { pickGroup = b.dataset.g; renderSlotPicker(); }));
  const genSel = $("dmPickGen");
  const gens = [...new Set(ids.map(id => member(id)?.generation).filter(g => g !== undefined))].sort((a, b) => a - b);
  genSel.innerHTML = `<option value="all">すべての期</option>` + gens.map(g => `<option value="${g}">${g === 0 ? "交換留学生" : g + "期生"}</option>`).join("");
  if (!gens.includes(+pickGen)) pickGen = "all";
  genSel.value = pickGen;
  const q = ($("dmPickSearch").value || "").trim();
  const list = ids.map(id => member(id)).filter(m => m
    && (pickGroup === "all" || E.memberInGroup(m, pickGroup))
    && (pickGen === "all" || m.generation === +pickGen)
    && (!q || m.name.includes(q) || (m.reading || "").includes(q)));
  const sorted = [...list].sort((a, b) => E.compareMembersForGroup(a, b, pickGroup));
  $("dmPickList").innerHTML = sorted.map(m => netCandHTML(m, false)).join("")
    || `<p style="color:var(--muted)">候補がいません。絞り込みを変えてください。</p>`;
  $("dmPickList").querySelectorAll(".fm-cand").forEach(c => c.addEventListener("click", () => {
    const id = c.dataset.id;
    $("dmPickDlg").close();
    pickCtx?.onChoose(id);
  }));
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
    if (NET) return; // オンライン時は netLotStep 側が進める
    lotIdx++;
    if (lotIdx < lotQueue.length) { openLot(); return; }
    $("dmLotDlg").close();
    msg(session.status === "finished" ? session.message : (session.message || ""));
    nextCur();
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

/* ================= オンライン対戦（部屋コード式） =================
   サーバー（Worker + Durable Objects）が対戦の正。ここは接続と表示のみ。
   配置（フォーメーションへの割り当て）は端末ローカルで行う。 */
const NET_DEFAULT = "https://sakamichia-draft.pnlg11vs18ge.workers.dev";
const NET_BASE = (() => { try { return localStorage.getItem("sakamichia-net-base") || NET_DEFAULT; } catch (e) { return NET_DEFAULT; } })();
const GKEY_ORDER = ["nogi", "sakura", "hinata", "keyaki", "hiragana"];
let NET = null;
let netCandGroup = "all", netCandGen = "all", netTab = null;
let netSelPool = null, netSelSlot = null, netPlace = null, netLotBusy = false, netLastSeq = 0, netLotQueue = [];

function netToken() {
  try {
    let t = localStorage.getItem("sakamichia-player-token");
    if (!t) { t = "tok-" + Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem("sakamichia-player-token", t); }
    return t;
  } catch (e) { return "tok-ephemeral-" + Math.random().toString(36).slice(2); }
}
function netMyName() { return ($("dmMyName").value || "").trim().slice(0, 20) || "プレイヤー"; }
function netStatus(t) { $("dmNetStatus").textContent = t; }
function netSend(o) { try { NET?.ws?.send(JSON.stringify(o)); } catch (e) {} }
function netCandHTML(m, sel) {
  if (!m) return "";
  const url = photoOf(m.id);
  const ph = url ? `<img loading="lazy" src="${esc(url)}" alt="">` : `<span class="fm-initial" style="background:${GCOL_D[m.group]}">${esc(m.name.slice(0, 1))}</span>`;
  return `<button type="button" class="fm-cand${sel ? " sel" : ""}" data-id="${m.id}"><span class="mb-photo">${ph}</span><span class="fm-name">${esc(m.name)}</span><span class="fm-sub">${GLABEL[m.group]}${m.generation ? "・" + m.generation + "期" : "・交換留学生"}${m.graduated ? "・卒業" : ""}</span></button>`;
}
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
      try { sessionStorage.setItem("dm-room", code); } catch (err) {}
      netStatus(`接続中（部屋 ${code}）`);
      renderNet();
    } else if (m.t === "error") {
      netStatus("エラー");
      const el = !$("dmLobby").hidden ? $("dmLobbyMsg") : (NET.state ? $("dmNetMsg") : null);
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
  try { sessionStorage.removeItem("dm-room"); } catch (e) {}
  $("dmLobby").hidden = true; $("dmNetGame").hidden = true; $("dmNetFinish").hidden = true;
  netStatus("オフライン");
  if (!silent) { $("dmSetupPanel").open = true; if (session) renderGame(); }
}
function netShowPanels() {
  const st = NET?.state;
  $("dmLobby").hidden = !(st && st.phase === "lobby");
  $("dmNetGame").hidden = !(st && st.phase === "active");
  $("dmNetFinish").hidden = !(st && st.phase === "finished");
  if (st) { $("dmGame").hidden = true; $("dmFinish").hidden = true; $("dmSetupPanel").open = false; }
}
function renderNet() {
  if (!NET?.state) return;
  if (!window.SakamichiMembersData || !E) { setTimeout(renderNet, 700); return; }
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
  $("dmRoomCode").textContent = st.code || NET.code;
  $("dmLobbyPhase").textContent = `${st.players.length} / ${st.config.maxPlayers} 人`;
  $("dmLobbyInfo").textContent = st.config.label || "";
  $("dmLobbyPlayers").innerHTML = st.players.map(p =>
    `<p class="df-hist">${p.id === NET.you ? "👉 " : ""}<b>${esc(p.name)}</b>${p.host ? "（主催者）" : ""} ・ ${p.connected ? "接続中" : "切断（再接続待ち）"}</p>`).join("");
  const start = $("dmNetStart");
  start.disabled = !(netIsHost() && st.players.length >= 2);
  start.textContent = netIsHost()
    ? (st.players.length >= 2 ? `対戦開始（${st.players.length}人）` : "対戦開始（2人以上で開始できます）")
    : "主催者が開始するのを待っています";
  $("dmLobbyMsg").textContent = "部屋コードを一緒に遊ぶ人に伝えてください。全員そろったら主催者が開始します。";
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
  $("dmNetRound").textContent = `第${s.round}巡 ／ 全${st.config.rounds}巡`;
  $("dmNetReady").textContent = `${pickedCount} / ${pend.length} 人が指名済み`;
  $("dmNetPStats").innerHTML = st.players.map(p => {
    const won = s.roundWinners.includes(p.id);
    const pick = s.picks[p.id];
    const state = won ? `<span class="df-state ok">この巡は確定</span>`
      : pick ? `<span class="df-state ok">指名済み：${esc(member(pick)?.name || "")}</span>`
      : (p.id === NET.you ? `<span class="df-state turn">あなたの番です</span>` : `<span class="df-state">未指名</span>`);
    return `<div class="df-pstat"><b>${esc(p.name)}</b>${p.host ? "（主催者）" : ""}${p.id === NET.you ? "（あなた）" : ""}<br>獲得 ${s.acquired[p.id].length}人 ・ ${p.connected ? "接続中" : "切断中"}<br>${state}</div>`;
  }).join("");
  $("dmNetMsg").textContent = s.message || "";
  $("dmNetUnpick").disabled = !s.picks[NET.you];
  netRenderCands();
  netRenderResults();
}
function netRenderCands() {
  const st = NET.state, s = st.session;
  const pool = st.config.pool || [];
  const acquiredAny = new Set(Object.values(s.acquired).flat());
  const groups = GKEY_ORDER.filter(g => pool.some(id => { const m = member(id); return m && E.memberInGroup(m, g); }));
  const gbox = $("dmNetCandGroups");
  gbox.innerHTML = ["all", ...groups].map(g => `<button type="button" class="ychip${netCandGroup === g ? " on" : ""}" data-g="${g}">${g === "all" ? "全グループ" : GLABEL[g]}</button>`).join("");
  gbox.querySelectorAll("button").forEach(b => b.addEventListener("click", () => { netCandGroup = b.dataset.g; netRenderCands(); }));
  const genSel = $("dmNetCandGen");
  const gens = [...new Set(pool.map(id => member(id)?.generation).filter(g => g !== undefined))].sort((a, b) => a - b);
  genSel.innerHTML = `<option value="all">すべての期</option>` + gens.map(g => `<option value="${g}">${g === 0 ? "交換留学生" : g + "期生"}</option>`).join("");
  if (!gens.includes(+netCandGen)) netCandGen = "all";
  genSel.value = netCandGen;
  const q = ($("dmNetCandSearch").value || "").trim();
  const myTurn = netPending().some(p => p.id === NET.you) && !s.roundWinners.includes(NET.you);
  const list = pool.map(id => member(id)).filter(m => m && !acquiredAny.has(m.id)
    && (netCandGroup === "all" || E.memberInGroup(m, netCandGroup))
    && (netCandGen === "all" || m.generation === +netCandGen)
    && (!q || m.name.includes(q) || (m.reading || "").includes(q)));
  const sorted = [...list].sort((a, b) => E.compareMembersForGroup(a, b, netCandGroup));
  $("dmNetCandCount").textContent = myTurn ? `あなたの指名中 ／ 候補 ${sorted.length} 人` : `候補 ${sorted.length} 人（他の人の指名待ち）`;
  $("dmNetCands").innerHTML = sorted.map(m => netCandHTML(m, s.picks[NET.you] === m.id)).join("")
    || `<p style="color:var(--muted)">候補がいません。条件を変えてください。</p>`;
  $("dmNetCands").querySelectorAll(".fm-cand").forEach(c => c.addEventListener("click", () => {
    if (!myTurn) return;
    netSend({ t: "pick", item: c.dataset.id });
  }));
}
function netRenderResults() {
  const st = NET.state, s = st.session;
  $("dmNetHistCount").textContent = `全${s.history.length}件`;
  const evs = st.lastEvents || [];
  $("dmNetResults").innerHTML = evs.length
    ? `<p class="df-note" style="margin-bottom:4px">直近の抽選結果</p>` + evs.map(ev => {
        const losers = ev.candidates.filter(p => p !== ev.winner);
        return `<p class="df-hist">${esc(member(ev.item)?.name || "")} → <b>${esc(netPlayer(ev.winner)?.name || "")}</b>${ev.wasContested ? `（競合：${losers.map(p => esc(netPlayer(p)?.name || "")).join("・")} と抽選）` : ""}</p>`;
      }).join("")
    : `<p style="color:var(--muted)">まだ抽選結果はありません。</p>`;
  $("dmNetOwned").innerHTML = st.players.map(p => {
    const names = s.acquired[p.id].map(id => esc(member(id)?.name || "")).join("、");
    return `<p class="df-hist"><b>${esc(p.name)}</b>（${s.acquired[p.id].length}人）：${names || "―"}</p>`;
  }).join("");
}
/* 競合ルーレット（サーバーの抽選結果をアニメーションで見せるだけ） */
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
  if (!ev) { netLotBusy = false; try { $("dmLotDlg").close(); } catch (e) {} return; }
  $("dmLotCount").textContent = `${i + 1} / ${netLotQueue.length} 件目の競合`;
  $("dmLotMember").innerHTML = `指名が競合：<b>${esc(member(ev.item)?.name || "")}</b>（${ev.candidates.map(p => esc(netPlayer(p)?.name || "")).join(" vs ")}）`;
  $("dmLotResult").textContent = "";
  const next = $("dmLotNext");
  next.disabled = true;
  const dlg = $("dmLotDlg");
  if (!dlg.open) dlg.showModal();
  const names = ev.candidates.map(p => netPlayer(p)?.name || "");
  let step = 0;
  const el = $("dmLotName");
  clearInterval(lotTimer);
  lotTimer = setInterval(() => {
    el.textContent = names[step % names.length];
    step++;
    if (step > 16) {
      clearInterval(lotTimer);
      el.textContent = netPlayer(ev.winner)?.name || "";
      $("dmLotResult").innerHTML = `<b>${esc(netPlayer(ev.winner)?.name || "")}</b> さんが獲得しました！`;
      next.disabled = false;
      next.textContent = i + 1 < netLotQueue.length ? "次の抽選へ" : "結果を見る";
      next.onclick = () => netLotStep(i + 1);
    }
  }, 75);
}

/* ---------- 終了・配置 ---------- */
function netPlaceKey() { return `dm-net-place-${NET.code}-${NET.you}`; }
function netEnsurePlace() {
  const st = NET.state, ex = st.config.extra || {};
  const rows = ex.formation?.rows || [st.config.rounds];
  const total = rows.reduce((a, b) => a + b, 0);
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(netPlaceKey())); } catch (e) {}
  const mine = st.session.acquired[NET.you] || [];
  if (!saved || !Array.isArray(saved.placements) || saved.placements.length !== total
      || saved.placements.some(id => id && !mine.includes(id))) {
    netPlace = { placements: Array(total).fill(null) };
  } else netPlace = saved;
  return rows;
}
function netSavePlace() { try { localStorage.setItem(netPlaceKey(), JSON.stringify(netPlace)); } catch (e) {} }
function netBoardHTML(rows) {
  const st = NET.state, ex = st.config.extra || {};
  const f = { rows, showCenter: !!ex.formation?.showCenter };
  const pos = netPlace.placements;
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
      html += `<button type="button" class="fm-tile${m ? " filled" : ""}${ctr ? " ctr" : ""}${netSelSlot === gi ? " sel" : ""}" data-slot="${gi}">${ph}<span class="fm-name">${m ? esc(m.name) : "―"}</span>${ctr ? `<span class="fm-star">★</span>` : ""}</button>`;
    }
    html += `</div>`;
  }
  return html + `</div>`;
}
function netRenderFinish() {
  const st = NET.state, s = st.session;
  const rows = netEnsurePlace();
  if (!netTab || !st.players.some(p => p.id === netTab)) netTab = NET.you;
  $("dmNetFinishInfo").textContent = `全${st.config.rounds}人 × ${st.players.length}人`;
  $("dmNetFinishMsg").textContent = s.message || "";
  $("dmNetTabs").innerHTML = st.players.map(p =>
    `<button type="button" class="ychip${netTab === p.id ? " on" : ""}" data-pid="${p.id}">${esc(p.name)}（${s.acquired[p.id].length}人）${p.id === NET.you ? "・あなた" : ""}</button>`).join("");
  $("dmNetTabs").querySelectorAll("button").forEach(b => b.addEventListener("click", () => { netTab = b.dataset.pid; netSelPool = null; netSelSlot = null; netRenderFinish(); }));
  $("dmNetToLobby").disabled = !netIsHost();
  $("dmNetToLobby").textContent = netIsHost() ? "ロビーに戻る（主催者）" : "ロビーに戻る（主催者のみ）";
  if (netTab !== NET.you) {
    $("dmNetPlaceBox").hidden = true;
    $("dmNetImg").disabled = true;
    $("dmNetView").innerHTML = `<div class="fm-grid">` + s.acquired[netTab].map(id => netCandHTML(member(id), false)).join("") + `</div>`;
    return;
  }
  $("dmNetPlaceBox").hidden = false;
  $("dmNetImg").disabled = false;
  const placed = netPlace.placements.filter(Boolean).length;
  const unplaced = s.acquired[NET.you].filter(id => !netPlace.placements.includes(id));
  $("dmNetView").innerHTML = `<div id="dmNetBoard">${netBoardHTML(rows)}</div>
    <p class="df-note" style="margin:8px 0 4px">未配置 ${unplaced.length}人（配置済み ${placed}人）</p>
    <div class="fm-grid">` + unplaced.map(id => netCandHTML(member(id), netSelPool === id)).join("") + `</div>`;
  $("dmNetView").querySelectorAll(".fm-cand").forEach(c => c.addEventListener("click", () => {
    netSelPool = netSelPool === c.dataset.id ? null : c.dataset.id;
    netSelSlot = null;
    netRenderFinish();
  }));
  $("dmNetBoard").querySelectorAll(".fm-tile").forEach(t => t.addEventListener("click", () => {
    const gi = +t.dataset.slot;
    // 配置の入れ替え規則は draft-engine の placeMember と同一（サーバーセッションが無いので同規則をここで適用）
    const placeInto = mid => {
      const pos = [...netPlace.placements];
      if (mid === null) pos[gi] = null;
      else {
        const old = pos.indexOf(mid), displaced = pos[gi];
        pos[gi] = mid;
        if (old >= 0 && old !== gi) pos[old] = displaced;
      }
      netPlace.placements = pos;
      netSavePlace();
      netRenderFinish();
    };
    if (netSelPool) { placeInto(netSelPool); netSelPool = null; return; }
    const cur = netPlace.placements[gi];
    openSlotPicker({
      title: `配置するメンバーを選ぶ（${gi + 1}枠目）`,
      ids: (NET.state.session.acquired[NET.you] || []).filter(id => id !== cur),
      current: cur,
      onChoose: id => placeInto(id)
    });
  }));
}
async function netBuildImage() {
  const st = NET.state, ex = st.config.extra || {};
  const rows = ex.formation?.rows || [st.config.rounds];
  const keep = session;
  session = { players: st.players.map(p => ({ id: p.id, name: p.name })),
    formation: { rows, placement: "after", showCenter: !!ex.formation?.showCenter },
    placements: { [NET.you]: netPlace.placements }, acquired: st.session.acquired };
  try { return await buildImage([NET.you]); }
  finally { session = keep; }
}

/* ---------- 初期化 ---------- */
function netInit() {
  try { $("dmMyName").value = localStorage.getItem("dm-myname") || ""; } catch (e) {}
  $("dmMyName").addEventListener("input", e => { try { localStorage.setItem("dm-myname", e.target.value); } catch (err) {} });
  $("dmModeChips").querySelectorAll("button").forEach(b => b.addEventListener("click", () => {
    if (NET) { alert("オンライン対戦中です。先に「部屋を出る」を押してください。"); return; }
    $("dmModeChips").querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b));
    $("dmOnlineBox").hidden = b.dataset.mode !== "online";
  }));
  const roomParam = new URLSearchParams(location.search).get("room");
  if (roomParam) {
    $("dmJoinCode").value = roomParam.toUpperCase();
    $("dmModeChips").querySelector('[data-mode="online"]').click();
  }
  $("dmCreate").addEventListener("click", () => {
    if (!E) { alert("データを読み込み中です。少し待ってからもう一度押してください。"); return; }
    let probeS;
    try { probeS = E.createSession(["主催者", "参加者"], buildOpts()); }
    catch (e) { alert(e.message); return; }
    const pool = E.eligibleMembers(probeS).map(m => m.id || m);
    const maxPlayers = +$("dmCount").value;
    if (pool.length < 2 * probeS.roundLimit) { alert("候補が不足しています。設定を見直してください。"); return; }
    const code = Array.from({ length: 5 }, () => "ABCDEFGHJKMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 31)]).join("");
    const label = `${[...suGroups].map(g => GLABEL[g]).join("・")}／${probeS.roundLimit}人編成${$("dmEra").checked && $("dmEraDate").value ? `／${$("dmEraDate").value} 時点` : ""}`;
    netConnect(code, { code, config: { kind: "members", rounds: probeS.roundLimit, maxPlayers, pool, label,
      extra: { formation: buildOpts().formation } } });
  });
  $("dmJoin").addEventListener("click", () => {
    const code = ($("dmJoinCode").value || "").trim().toUpperCase();
    if (code.length < 4) { alert("部屋コードを入力してください。"); return; }
    netConnect(code, null);
  });
  $("dmCopyCode").addEventListener("click", async () => {
    const link = `${location.origin}${location.pathname}?room=${NET ? NET.code : ""}`;
    try { await navigator.clipboard.writeText(link); $("dmLobbyMsg").textContent = "参加用リンクをコピーしました。このリンクを開くとコードが入力された状態になります。"; }
    catch (e) { $("dmLobbyMsg").textContent = `参加用リンク：${link}`; }
  });
  $("dmNetStart").addEventListener("click", () => netSend({ t: "start" }));
  $("dmLeave").addEventListener("click", () => netLeave());
  $("dmLeave2").addEventListener("click", () => netLeave());
  $("dmNetUnpick").addEventListener("click", () => netSend({ t: "unpick" }));
  $("dmNetCandSearch").addEventListener("input", () => netRenderCands());
  $("dmNetCandGen").addEventListener("input", e => { netCandGen = e.target.value; netRenderCands(); });
  $("dmNetToLobby").addEventListener("click", () => netSend({ t: "backToLobby" }));
  $("dmNetImg").addEventListener("click", async () => {
    imgBlob = await netBuildImage();
    const box = $("dmImgPreview");
    box.innerHTML = "";
    if (imgBlob) {
      const im = document.createElement("img");
      im.src = URL.createObjectURL(imgBlob);
      im.style.maxWidth = "100%";
      box.appendChild(im);
    }
    $("dmImgDlg").showModal();
  });
  let savedRoom = null;
  try { savedRoom = sessionStorage.getItem("dm-room"); } catch (e) {}
  if (savedRoom) {
    $("dmModeChips").querySelector('[data-mode="online"]').click();
    netConnect(savedRoom, null);
  }
}
netInit();

/* 配置ピッカーの配線 */
$("dmPickSearch").addEventListener("input", renderSlotPicker);
$("dmPickGen").addEventListener("input", e => { pickGen = e.target.value; renderSlotPicker(); });
$("dmPickClose").addEventListener("click", () => $("dmPickDlg").close());
$("dmPickRemove").addEventListener("click", () => { $("dmPickDlg").close(); pickCtx?.onChoose(null); });
