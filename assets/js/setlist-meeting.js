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
  const n = +$("smCount").value, r = +$("smRounds").value;
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
  const count = +$("smCount").value;
  const prev = [...names.querySelectorAll("input")].map(i => i.value);
  names.innerHTML = Array.from({ length: count }, (_, i) =>
    `<input type="text" maxlength="20" placeholder="プレイヤー${i + 1}${i === 0 ? "（主催者）" : ""}" value="${esc(prev[i] || "")}">`).join("");
  probe();
}
function startGame() {
  try {
    S = newSession(playerNames(), [...suGroups], +$("smRounds").value);
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
  $("smEncore").addEventListener("input", e => { enc[finishTab] = +e.target.value; save(); renderFinish(); });
  $("smTitle").addEventListener("input", e => { titles[finishTab] = e.target.value; save(); });
  $("smLotNext").addEventListener("click", () => {
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
