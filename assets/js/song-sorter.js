// 楽曲ソート：2曲から好きな方を選んで自分のランキングを作る（エンジンは sorter-core.js、メンバーソートと共用）
const Core = window.SakamichiSorterCore;
const area = document.getElementById("songSortArea");
const GCOL = {"乃木坂46": "#7e57c2", "櫻坂46": "#e77a9b", "日向坂46": "#5aa9d6", "欅坂46": "#5eba53", "けやき坂46": "#a4c639", "坂道AKB": "#d24a43", "坂道選抜": "#2f9e8f"};
let SONGS = [], TYPES = [];
const LINEAGES = ["乃木坂46", "櫻坂46", "日向坂46", "合同"];
// groups / types は複数選択（Set）。types の初期値（全種別）は init で入れる
let scope = {groups: new Set(LINEAGES), types: new Set()};
let pool = [], sorter = null, inBattle = false;
let shareBlob = null;

function shuffle(a){ a = [...a]; for(let i = a.length - 1; i > 0; i--){ const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function releaseLabel(s){
  const r = s.release || "";
  let base = "";
  if(/SG$/.test(r)) base = r.replace(/SG$/, "シングル");
  else if(/BestAL$/.test(r)) base = r.replace(/BestAL$/, "ベストアルバム");
  else if(/UnderAL$/.test(r)) base = r.replace(/UnderAL$/, "アンダーアルバム");
  else if(/AL$/.test(r)) base = r.replace(/AL$/, "アルバム");
  else if(/Digital$/.test(r)) base = "配信シングル";
  else if(/Unreleased$/.test(r)) base = "未発売";
  else base = r;
  const parts = [];
  if(base) parts.push(base + "収録");
  if(s.year) parts.push(s.year + "年");
  return parts.join(" ・ ");
}
function scopePool(){
  return SONGS.filter(s => scope.groups.has(Core.songLineage(s)) && scope.types.has(s.type || ""));
}
// 選択中のグループ群に実在する種別を、件数つきで返す（並びは全体の件数順 TYPES に従う）。
// 種別チップはこの結果だけを描くので、選んだグループに無い種別は表示されない。
function visibleTypes(){
  const counts = {};
  SONGS.forEach(s => {
    if(!scope.groups.has(Core.songLineage(s))) return;
    const t = s.type || "";
    if(t) counts[t] = (counts[t] || 0) + 1;
  });
  return TYPES.filter(t => counts[t]).map(t => ({type: t, count: counts[t]}));
}
// グループ変更時の種別の引き継ぎ：新しいグループ群に実在する種別だけを残し、
// 1つも残らなければ表示される種別を全選択に戻す（グループを変えただけで対象が0に落ちないように）。
// 種別チップの手動操作では呼ばないので、手動で全て外した場合は0件のままになる。
function reconcileTypes(){
  const vis = new Set(visibleTypes().map(v => v.type));
  const kept = new Set([...scope.types].filter(t => vis.has(t)));
  scope.types = kept.size ? kept : vis;
}
function scopeLabel(){
  const gl = scope.groups.size === LINEAGES.length ? "全グループ"
    : (LINEAGES.filter(l => scope.groups.has(l)).join("・") || "未選択");
  const vis = visibleTypes().map(v => v.type);
  const sel = vis.filter(t => scope.types.has(t));
  const tl = vis.length && sel.length === vis.length ? "全種別" : (sel.join("・") || "未選択");
  return `${gl}／${tl}（${pool.length}曲）`;
}

async function init(){
  SONGS = await loadJSON("songs.json");
  if(!SONGS.length){ area.innerHTML = `<p style="color:var(--muted)">楽曲データを読み込めませんでした。</p>`; return; }
  const counts = {};
  SONGS.forEach(s => { const t = s.type || ""; if(t) counts[t] = (counts[t] || 0) + 1; });
  TYPES = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
  scope.types = new Set(TYPES); // 初期状態は全種別（従来の「すべての種別」と同じ）
  renderStart();
}

// ---------- スタート画面 ----------
function marqueeHTML(){
  const titles = shuffle(SONGS.filter(s => s.type === "表題曲"));
  const rows = [titles.slice(0, 12), titles.slice(12, 24)];
  return `<div class="mq" aria-hidden="true">${rows.map((row, ri) =>
    `<div class="mq-row${ri === 1 ? " rev" : ""}">${[0, 1].map(() =>
      row.map(s => `<span class="mq-song" style="border-left-color:${GCOL[s.group] || "#2b2430"}">${esc(s.title)}</span>`).join("")
    ).join("")}</div>`).join("")}</div>`;
}
function renderStart(){
  inBattle = false; sorter = null; shareBlob = null;
  area.innerHTML = `
  ${marqueeHTML()}
  <div class="card" style="margin-bottom:40px">
    <h3 style="margin-top:0">範囲を選んでスタート</h3>
    <p style="margin:4px 0 2px;color:var(--muted);font-size:13px">グループ（複数選択できます）</p>
    <div class="tabs sort-tabs" id="songSortGroups"></div>
    <p style="margin:8px 0 2px;color:var(--muted);font-size:13px">種別（複数選択できます）</p>
    <div class="tabs sort-tabs" id="songSortTypes"></div>
    <p id="songSortInfo" style="margin:12px 0 4px"></p>
    <p id="songSortWarn" style="margin:0 0 8px;color:var(--muted);font-size:13px"></p>
    <p style="margin:10px 0 0"><button type="button" id="songSortStart">スタート</button></p>
    <p style="margin:10px 0 0;color:var(--muted);font-size:12.5px">櫻坂46には欅坂46の曲、日向坂46にはけやき坂46の曲も含まれます。種別は選んだグループにあるものだけが表示されます。全曲（${SONGS.length}曲）だと対戦数が非常に多くなるため、「表題曲のみ」やグループ別がおすすめです。</p>
  </div>`;
  refreshSelection();
  document.getElementById("songSortStart").addEventListener("click", startBattle);
}
// 選択チップ（グループ・種別）を現在の scope で描き直し、件数表示を更新する
function refreshSelection(){
  const gAll = scope.groups.size === LINEAGES.length;
  const gEl = document.getElementById("songSortGroups");
  gEl.innerHTML =
    `<button type="button" data-g="all" class="${gAll ? "on" : ""}">すべて</button>` +
    LINEAGES.map(l => `<button type="button" data-g="${esc(l)}" class="${scope.groups.has(l) ? "on" : ""}">${esc(l)}</button>`).join("");
  gEl.querySelectorAll("button").forEach(b => b.addEventListener("click", () => {
    if(b.dataset.g === "all") scope.groups = gAll ? new Set() : new Set(LINEAGES);
    else if(scope.groups.has(b.dataset.g)) scope.groups.delete(b.dataset.g);
    else scope.groups.add(b.dataset.g);
    reconcileTypes(); // 種別チップはグループに連動して作り直す。種別の引き継ぎもここで行う
    refreshSelection();
  }));
  const vis = visibleTypes();
  const tAll = vis.length > 0 && vis.every(v => scope.types.has(v.type));
  const tEl = document.getElementById("songSortTypes");
  tEl.innerHTML =
    `<button type="button" data-t="all" class="${tAll ? "on" : ""}">すべて</button>` +
    vis.map(v => `<button type="button" data-t="${esc(v.type)}" class="${scope.types.has(v.type) ? "on" : ""}">${esc(v.type)}（${v.count}）</button>`).join("");
  tEl.querySelectorAll("button").forEach(b => b.addEventListener("click", () => {
    if(b.dataset.t === "all"){
      // 「すべて」は表示中の種別だけを全選択／全解除する
      if(tAll) vis.forEach(v => scope.types.delete(v.type));
      else vis.forEach(v => scope.types.add(v.type));
    }
    else if(scope.types.has(b.dataset.t)) scope.types.delete(b.dataset.t);
    else scope.types.add(b.dataset.t);
    refreshSelection();
  }));
  updateInfo();
}
function updateInfo(){
  const list = scopePool();
  const est = Core.estimate(list.length);
  document.getElementById("songSortInfo").innerHTML =
    `対象：<b>${list.length}曲</b> ／ 目安：約<b>${est}対戦</b>`;
  document.getElementById("songSortWarn").textContent =
    est > 400 ? "対戦数がとても多い範囲です。種別やグループで絞ると進めやすくなります。" : "";
  document.getElementById("songSortStart").disabled = list.length < 2;
}

// ---------- 対戦画面 ----------
function startBattle(){
  pool = shuffle(scopePool());
  if(pool.length < 2) return;
  sorter = Core.createSorter(pool.length);
  inBattle = true;
  renderBattle();
}
function songCard(s, side, tieSize){
  return `<button type="button" class="sort-card song" data-side="${side}">
    <span class="band" style="background:${GCOL[s.group] || "#2b2430"}"></span>
    <span class="ttl">${esc(s.title)}</span>
    <span>${groupChip(s.group)}<span class="tag">${esc(s.type || "")}</span></span>
    <span class="meta">${esc(releaseLabel(s))}</span>
    ${s.center ? `<span class="meta">センター：${esc(s.center)}</span>` : ""}
  </button>`;
}
function renderBattle(){
  const p = sorter.pair();
  if(!p){ renderResult(); return; }
  const a = pool[p.a], b = pool[p.b];
  const pct = sorter.progress();
  area.innerHTML = `
  <div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px;flex-wrap:wrap">
    <b>${sorter.battles() + 1}戦目</b>
    <span style="color:var(--muted);font-size:13px">${esc(scopeLabel())} ・ 進捗 約${pct}%</span>
  </div>
  <div class="sort-prog"><i style="width:${pct}%"></i></div>
  <p style="margin:10px 0 0;color:var(--muted);font-size:13.5px">好きな方をタップ（←／→キーでも選べます）</p>
  <div class="sort-vs">
    ${songCard(a, "left", p.aSize)}
    <span class="sort-mid">VS</span>
    ${songCard(b, "right", p.bSize)}
  </div>
  <div class="sort-actions">
    <button type="button" class="sub" id="songSortDraw">引き分け</button>
    <button type="button" class="sub" id="songSortUndo" ${sorter.canUndo() ? "" : "disabled"}>1つ戻る</button>
    <button type="button" class="sub" id="songSortQuit">やめる</button>
  </div>`;
  area.querySelector('[data-side="left"]').addEventListener("click", () => answer("left"));
  area.querySelector('[data-side="right"]').addEventListener("click", () => answer("right"));
  document.getElementById("songSortDraw").addEventListener("click", () => answer("draw"));
  document.getElementById("songSortUndo").addEventListener("click", () => { if(sorter.undo()) renderBattle(); });
  document.getElementById("songSortQuit").addEventListener("click", renderStart);
}
function answer(choice){
  if(!inBattle || !sorter) return;
  if(sorter.answer(choice)){
    if(sorter.done()){ inBattle = false; renderResult(); }
    else renderBattle();
  }
}
document.addEventListener("keydown", e => {
  if(!inBattle) return;
  if(e.key === "ArrowLeft") answer("left");
  else if(e.key === "ArrowRight") answer("right");
});

// ---------- 結果画面 ----------
function rankedRows(){
  const groups = sorter.result() || [];
  const rows = [];
  let rank = 1;
  for(const g of groups){
    for(const idx of g) rows.push({rank, s: pool[idx]});
    rank += g.length;
  }
  return rows;
}
function renderResult(){
  inBattle = false;
  const rows = rankedRows();
  area.innerHTML = `
  <div class="card" style="margin-bottom:18px">
    <h3 style="margin-top:0">あなたの楽曲ランキング</h3>
    <p style="color:var(--muted);margin:4px 0">${esc(scopeLabel())} ・ ${sorter.battles()}対戦で決定</p>
    <p style="margin:10px 0 0">
      <button type="button" id="songSortShareGen">上位10曲の画像を作る</button>
      <button type="button" class="sub" id="songSortAgain">もう一度（同じ範囲）</button>
      <button type="button" class="sub" id="songSortBack">範囲を変える</button>
    </p>
    <div id="songSortShareBox"></div>
  </div>
  <div class="sort-rank">${rows.map(r => `<div class="sort-rrow">
      <span class="sort-rnum ${r.rank <= 3 ? "r" + r.rank : ""}">${r.rank}</span>
      <span class="sort-rname">${esc(r.s.title)}</span>
      <span class="sort-rmeta">${esc(r.s.group)} ・ ${esc(r.s.type || "")}${r.s.center ? " ・ センター：" + esc(r.s.center) : ""}</span>
    </div>`).join("")}</div>`;
  document.getElementById("songSortAgain").addEventListener("click", startBattle);
  document.getElementById("songSortBack").addEventListener("click", renderStart);
  document.getElementById("songSortShareGen").addEventListener("click", () => makeShareImage(rows.slice(0, 10)));
}

// ---------- シェア画像 ----------
const FONT = `"Hiragino Maru Gothic ProN","Hiragino Sans","Noto Sans JP",sans-serif`;
function fitTitle(ctx, text, maxW, basePx){
  let px = basePx;
  ctx.font = `900 ${px}px ${FONT}`;
  while(px > 24 && ctx.measureText(text).width > maxW){
    px -= 2;
    ctx.font = `900 ${px}px ${FONT}`;
  }
  if(ctx.measureText(text).width > maxW){
    let t = text;
    while(t.length > 1 && ctx.measureText(t + "…").width > maxW) t = t.slice(0, -1);
    return t + "…";
  }
  return text;
}
async function makeShareImage(top){
  const box = document.getElementById("songSortShareBox");
  box.innerHTML = `<p style="color:var(--muted)">画像を作成中…</p>`;
  const W = 960, H = 1280, cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const ctx = cv.getContext("2d");
  ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, W, H);
  const cols = ["#7e57c2", "#e77a9b", "#5aa9d6"];
  cols.forEach((c, i) => { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(84 + i * 50, 84, 16, 0, Math.PI * 2); ctx.fill(); });
  ctx.fillStyle = "#2b2430";
  ctx.font = `900 54px ${FONT}`;
  ctx.fillText("楽曲ソート", 226, 103);
  ctx.fillStyle = "#7a7080";
  ctx.font = `400 28px ${FONT}`;
  ctx.fillText(scopeLabel(), 58, 168);
  ctx.strokeStyle = "#eadff0"; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(58, 196); ctx.lineTo(W - 58, 196); ctx.stroke();
  const rowH = 96, y0 = 216;
  top.forEach((r, i) => {
    const y = y0 + i * rowH;
    // グループカラーの帯
    ctx.fillStyle = GCOL[r.s.group] || "#2b2430";
    ctx.fillRect(58, y + 10, 8, 68);
    ctx.fillStyle = i < 3 ? cols[i] : "#2b2430";
    ctx.font = `900 42px ${FONT}`;
    ctx.textAlign = "center";
    ctx.fillText(String(r.rank), 118, y + 60);
    ctx.textAlign = "left";
    ctx.fillStyle = "#2b2430";
    const title = fitTitle(ctx, r.s.title, W - 190 - 58, 38);
    ctx.fillText(title, 190, y + 46);
    ctx.fillStyle = "#7a7080";
    ctx.font = `400 25px ${FONT}`;
    ctx.fillText(`${r.s.group} ・ ${r.s.type || ""}${r.s.center ? " ・ センター：" + r.s.center : ""}`, 190, y + 82);
  });
  ctx.fillStyle = "#7a7080";
  ctx.font = `400 24px ${FONT}`;
  ctx.fillText("サカミチア ｜ https://sakamichia.pages.dev/games/song-sorter/", 58, 1236);
  shareBlob = await new Promise((res, rej) => cv.toBlob(b => b ? res(b) : rej(new Error("画像を生成できませんでした。")), "image/png"));
  const url = URL.createObjectURL(shareBlob);
  box.innerHTML = `
    <img class="sort-share-img" src="${url}" alt="楽曲ソート上位10曲の画像">
    <p style="text-align:center;margin:8px 0 0"><button type="button" id="songSortShareBtn">共有／保存する</button></p>`;
  document.getElementById("songSortShareBtn").addEventListener("click", shareImage);
}
async function shareImage(){
  if(!shareBlob) return;
  try{
    const file = new File([shareBlob], "sakamichia-song-sort.png", {type: "image/png"});
    if(navigator.share && navigator.canShare && navigator.canShare({files: [file]})){
      await navigator.share({files: [file], text: "サカミチアの楽曲ソート結果\nhttps://sakamichia.pages.dev/games/song-sorter/"});
      return;
    }
    const url = URL.createObjectURL(shareBlob), a = document.createElement("a");
    a.href = url; a.download = "sakamichia-song-sort.png"; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  }catch(e){ /* 共有キャンセル時は何もしない */ }
}

init();
